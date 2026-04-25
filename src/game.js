const canvas = document.getElementById("track");
const ctx = canvas.getContext("2d");
const eventFeed = document.getElementById("eventFeed");
const scoreboard = document.getElementById("scoreboard");
const resetBtn = document.getElementById("resetRace");
const modeSelect = document.getElementById("modeSelect");
const roomCode = document.getElementById("roomCode");
const connectBtn = document.getElementById("connectBtn");
const netStatus = document.getElementById("netStatus");
const touchButtons = [...document.querySelectorAll("#touchControls button")];

const TRACK = { cx: 600, cy: 350, outerA: 470, outerB: 260, innerA: 300, innerB: 120, laps: 8 };
const WEATHER = ["clear", "cloudy", "light-rain", "heavy-rain"];
const keys = new Set();

const CONTROLS = {
  p1: { throttle: "KeyW", brake: "KeyS", left: "KeyA", right: "KeyD", drs: "ShiftLeft", ers: "Space" },
  p2: { throttle: "ArrowUp", brake: "ArrowDown", left: "ArrowLeft", right: "ArrowRight", drs: "Enter", ers: "ControlRight" },
};

let raceClock = 0;
let raceActive = true;
let safetyCar = false;
let weatherState = "clear";
let weatherTimer = 14;
const cars = [];
const incidents = [];

const net = {
  mode: "local",
  peer: null,
  conn: null,
  connected: false,
  isHost: false,
  localSlot: 0,
  remoteInput: null,
  inputSeq: 0,
};

function addEvent(message, level = "") {
  incidents.unshift({ t: raceClock.toFixed(1), message, level });
  incidents.splice(12);
  eventFeed.innerHTML = `<h3>Race Control</h3>${incidents
    .map((e) => `<div class="event ${e.level}"><strong>T+${e.t}s</strong><br/>${e.message}</div>`)
    .join("")}`;
}

function newCar(name, color, controlSet = null, isAI = false) {
  return {
    name,
    color,
    controlSet,
    isAI,
    angle: -Math.PI / 2 + Math.random() * 0.07,
    laneBias: (Math.random() - 0.5) * 0.18,
    speed: 0,
    topSpeed: 96,
    accel: 32,
    brakePower: 38,
    handling: 2.2,
    lap: 1,
    lapProgress: 0,
    lastProgress: 0,
    bestLap: Infinity,
    lapStart: 0,
    tyres: 100,
    fuel: 100,
    engineTemp: 82,
    drsCharge: 100,
    ersCharge: 70,
    inPit: false,
    pitStopUntil: 0,
    penalty: 0,
    finished: false,
  };
}

function resetCarsForMode() {
  cars.length = 0;
  if (net.mode === "local") {
    cars.push(newCar("Player 1", "#EB5757", CONTROLS.p1));
    cars.push(newCar("Player 2", "#2F80ED", CONTROLS.p2));
    cars.push(newCar("AI - Falcon", "#F2C94C", null, true));
    cars.push(newCar("AI - Titan", "#6FCF97", null, true));
  } else {
    cars.push(newCar("Driver A", "#EB5757", null, false));
    cars.push(newCar("Driver B", "#2F80ED", null, false));
  }
}

function setupRace() {
  incidents.length = 0;
  raceClock = 0;
  raceActive = true;
  safetyCar = false;
  weatherState = "clear";
  weatherTimer = 12 + Math.random() * 8;
  resetCarsForMode();
  addEvent("Race started.", "good");
}

function weatherGrip() {
  if (weatherState === "clear") return 1;
  if (weatherState === "cloudy") return 0.95;
  if (weatherState === "light-rain") return 0.8;
  return 0.65;
}

function getControlFromKeys(controlSet) {
  return {
    throttle: keys.has(controlSet.throttle) ? 1 : 0,
    brake: keys.has(controlSet.brake) ? 1 : 0,
    steer: (keys.has(controlSet.left) ? -1 : 0) + (keys.has(controlSet.right) ? 1 : 0),
    drs: keys.has(controlSet.drs),
    ers: keys.has(controlSet.ers),
  };
}

function controlForCar(index) {
  if (net.mode === "local") {
    const car = cars[index];
    if (car.isAI) {
      return {
        throttle: 0.82 + Math.random() * 0.22,
        brake: weatherState === "heavy-rain" ? 0.15 : 0.06,
        steer: Math.sin(raceClock * 0.65 + car.laneBias * 9) * 0.2,
        drs: Math.random() > 0.87,
        ers: Math.random() > 0.8,
      };
    }
    return getControlFromKeys(car.controlSet);
  }

  // Online mode: car 0 controlled by host input, car 1 by joiner input.
  if (net.isHost) {
    if (index === 0) return getControlFromKeys(CONTROLS.p1);
    return net.remoteInput ?? { throttle: 0, brake: 0, steer: 0, drs: false, ers: false };
  }

  // Joiner only drives car 1 locally; host sends full state.
  if (index === 0) return { throttle: 0, brake: 0, steer: 0, drs: false, ers: false };
  return getControlFromKeys(CONTROLS.p1);
}

function updateCar(car, control, dt) {
  if (car.finished) return;

  const maxSpeed = car.topSpeed * weatherGrip() * (car.tyres / 100) * (safetyCar ? 0.45 : 1);
  const drsBoost = control.drs && car.drsCharge > 2 && weatherState !== "heavy-rain" ? 1.11 : 1;
  const ersBoost = control.ers && car.ersCharge > 2 ? 1.08 : 1;

  car.speed += (control.throttle * car.accel - control.brake * car.brakePower) * dt;
  const cap = maxSpeed * drsBoost * ersBoost;
  if (car.speed > cap) car.speed -= 17 * dt;
  if (car.speed < 0) car.speed = 0;

  car.angle += (car.speed / 340) * dt;
  car.angle += control.steer * car.handling * dt * (0.42 + car.speed / 130);

  car.tyres = Math.max(0, car.tyres - dt * (0.22 + (car.speed / 110) * 0.08 + Math.abs(control.steer) * 0.22));
  car.fuel = Math.max(0, car.fuel - dt * (0.12 + car.speed / 950));
  car.engineTemp += dt * (0.25 + control.throttle * 0.55 - control.brake * 0.42);
  car.engineTemp = Math.max(72, car.engineTemp - dt * 0.12);
  car.drsCharge = Math.max(0, Math.min(100, car.drsCharge + dt * (control.drs ? -14 : 6)));
  car.ersCharge = Math.max(0, Math.min(100, car.ersCharge + dt * (control.ers ? -18 : 8)));

  const rawProgress = ((car.angle + Math.PI / 2) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
  car.lapProgress = rawProgress / (Math.PI * 2);
  if (car.lapProgress < 0.1 && car.lastProgress > 0.9) {
    const lapTime = raceClock - car.lapStart + car.penalty;
    car.bestLap = Math.min(car.bestLap, lapTime);
    car.lapStart = raceClock;
    car.lap += 1;
    car.penalty = 0;
    addEvent(`${car.name} lap ${car.lap} | ${lapTime.toFixed(2)}s`, "good");
    if (car.lap > TRACK.laps) {
      car.finished = true;
      addEvent(`${car.name} finished!`, "good");
    }
  }
  car.lastProgress = car.lapProgress;

  if (!car.inPit && (car.tyres < 28 || car.fuel < 18 || car.engineTemp > 108) && car.lap > 1) {
    car.inPit = true;
    car.pitStopUntil = raceClock + 4.2 + Math.random() * 1.2;
    car.speed *= 0.55;
    addEvent(`${car.name} enters pit lane.`, "warn");
  }
  if (car.inPit && raceClock >= car.pitStopUntil) {
    car.inPit = false;
    car.tyres = 100;
    car.fuel = Math.min(100, car.fuel + 55);
    car.engineTemp = 84;
    addEvent(`${car.name} pit complete.`, "good");
  }
}

function maybeUpdateWeather(dt) {
  weatherTimer -= dt;
  if (weatherTimer > 0) return;
  const next = WEATHER[Math.floor(Math.random() * WEATHER.length)];
  if (next !== weatherState) {
    weatherState = next;
    addEvent(`Weather: ${next.replace("-", " ")}`, next.includes("rain") ? "warn" : "good");
    if (next === "heavy-rain") {
      safetyCar = true;
      addEvent("Safety car deployed.", "warn");
      setTimeout(() => {
        safetyCar = false;
        addEvent("Safety car ending.", "good");
      }, 7000);
    }
  }
  weatherTimer = 12 + Math.random() * 12;
}

function carPos(car) {
  const a = TRACK.outerA - 80 + car.laneBias * 50;
  const b = TRACK.outerB - 80 + car.laneBias * 35;
  return { x: TRACK.cx + Math.cos(car.angle) * a, y: TRACK.cy + Math.sin(car.angle) * b };
}

function drawTrack() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = weatherState.includes("rain") ? "#1a2631" : "#25384a";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#3d4f33";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.beginPath();
  ctx.ellipse(TRACK.cx, TRACK.cy, TRACK.outerA, TRACK.outerB, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#565b62";
  ctx.fill();

  ctx.beginPath();
  ctx.ellipse(TRACK.cx, TRACK.cy, TRACK.innerA, TRACK.innerB, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#3d4f33";
  ctx.fill();

  ctx.setLineDash([16, 12]);
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(TRACK.cx, TRACK.cy, (TRACK.outerA + TRACK.innerA) / 2, (TRACK.outerB + TRACK.innerB) / 2, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  if (safetyCar) {
    ctx.fillStyle = "rgba(255, 214, 10, 0.22)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
}

function drawCars() {
  for (const car of cars) {
    const { x, y } = carPos(car);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(car.angle + Math.PI / 2);
    ctx.fillStyle = car.color;
    ctx.fillRect(-12, -20, 24, 40);
    ctx.fillStyle = "#111";
    ctx.fillRect(-10, -17, 20, 10);
    ctx.fillRect(-10, 7, 20, 10);
    ctx.restore();

    ctx.fillStyle = "white";
    ctx.font = "12px sans-serif";
    ctx.fillText(car.name, x - 20, y - 24);
  }
}

function renderHUD() {
  const order = [...cars].sort((a, b) => b.lap + b.lapProgress - (a.lap + a.lapProgress));
  scoreboard.innerHTML = `
    <h3>Live Timing</h3>
    <p><strong>Mode:</strong> ${net.mode}</p>
    <p><strong>Network:</strong> ${net.connected ? "connected" : "offline"}</p>
    <p><strong>Weather:</strong> ${weatherState} | <strong>SC:</strong> ${safetyCar ? "YES" : "NO"}</p>
    <table>
      <thead><tr><th>Pos</th><th>Driver</th><th>Lap</th><th>Speed</th><th>Tyre</th><th>Fuel</th></tr></thead>
      <tbody>
        ${order
          .map(
            (c, i) => `<tr><td>${i + 1}</td><td>${c.name}</td><td>${Math.min(c.lap, TRACK.laps)}/${TRACK.laps}</td><td>${c.speed.toFixed(
              0
            )}</td><td>${c.tyres.toFixed(0)}%</td><td>${c.fuel.toFixed(0)}%</td></tr>`
          )
          .join("")}
      </tbody>
    </table>
    <p><small>Online: host simulates race, joiner sends controls. Works after Vercel deploy.</small></p>
  `;
}

function serializeState() {
  return {
    raceClock,
    safetyCar,
    weatherState,
    weatherTimer,
    raceActive,
    cars: cars.map((c) => ({ ...c })),
  };
}

function applyState(state) {
  raceClock = state.raceClock;
  safetyCar = state.safetyCar;
  weatherState = state.weatherState;
  weatherTimer = state.weatherTimer;
  raceActive = state.raceActive;
  state.cars.forEach((src, i) => Object.assign(cars[i], src));
}

function sendNet(msg) {
  if (net.conn && net.conn.open) net.conn.send(msg);
}

function setupNetwork() {
  connectBtn.onclick = () => {
    if (net.peer) {
      try {
        net.peer.destroy();
      } catch (_) {}
    }

    net.mode = modeSelect.value.startsWith("online") ? "online" : "local";
    net.connected = false;
    net.isHost = modeSelect.value === "online-host";
    netStatus.textContent = net.mode === "local" ? "Local mode" : "Connecting...";

    if (net.mode === "local") {
      setupRace();
      return;
    }

    const code = (roomCode.value.trim() || "f1-apex-room").toLowerCase();
    net.peer = new window.Peer(net.isHost ? code : undefined);

    net.peer.on("open", (id) => {
      if (net.isHost) {
        netStatus.textContent = `Hosting room: ${id}`;
        addEvent(`Room created: ${id}`, "good");
      } else {
        netStatus.textContent = `Your id: ${id} | connecting...`;
        const conn = net.peer.connect(code, { reliable: true });
        hookConnection(conn);
      }
    });

    net.peer.on("connection", (conn) => {
      if (!net.isHost) return;
      hookConnection(conn);
      addEvent("Remote driver connected.", "good");
    });

    net.peer.on("error", (err) => {
      netStatus.textContent = `Network error: ${err.type}`;
      addEvent(`Network error: ${err.type}`, "warn");
    });
  };
}

function hookConnection(conn) {
  net.conn = conn;

  conn.on("open", () => {
    net.connected = true;
    netStatus.textContent = "Connected";
    addEvent("Online link established.", "good");
    setupRace();
  });

  conn.on("data", (msg) => {
    if (!msg || typeof msg !== "object") return;

    if (msg.type === "remote-input" && net.isHost) {
      net.remoteInput = msg.payload;
    }

    if (msg.type === "state" && !net.isHost) {
      applyState(msg.payload);
    }

    if (msg.type === "hello" && net.isHost) {
      sendNet({ type: "hello-ack" });
    }
  });

  conn.on("close", () => {
    net.connected = false;
    netStatus.textContent = "Disconnected";
    addEvent("Connection closed.", "warn");
  });
}

function tick(now) {
  const dt = Math.min(0.05, (now - (tick.last || now)) / 1000);
  tick.last = now;

  if (raceActive) {
    if (net.mode === "local" || net.isHost) {
      raceClock += dt;
      maybeUpdateWeather(dt);
      cars.forEach((car, idx) => updateCar(car, controlForCar(idx), dt));
      if (net.mode === "online" && net.connected) sendNet({ type: "state", payload: serializeState() });
      if (cars.every((c) => c.finished)) {
        raceActive = false;
        addEvent("Race complete.", "good");
      }
    } else if (net.mode === "online" && !net.isHost && net.connected) {
      sendNet({ type: "remote-input", payload: controlForCar(1), seq: ++net.inputSeq });
    }
  }

  drawTrack();
  drawCars();
  renderHUD();
  requestAnimationFrame(tick);
}

window.addEventListener("keydown", (e) => keys.add(e.code));
window.addEventListener("keyup", (e) => keys.delete(e.code));

touchButtons.forEach((btn) => {
  const map = {
    left: "KeyA",
    right: "KeyD",
    throttle: "KeyW",
    brake: "KeyS",
    drs: "ShiftLeft",
    ers: "Space",
  };
  const code = map[btn.dataset.key];
  const on = (ev) => {
    ev.preventDefault();
    keys.add(code);
  };
  const off = (ev) => {
    ev.preventDefault();
    keys.delete(code);
  };
  btn.addEventListener("touchstart", on, { passive: false });
  btn.addEventListener("touchend", off, { passive: false });
  btn.addEventListener("mousedown", on);
  btn.addEventListener("mouseup", off);
  btn.addEventListener("mouseleave", off);
});

resetBtn.addEventListener("click", setupRace);
setupNetwork();
setupRace();
requestAnimationFrame(tick);

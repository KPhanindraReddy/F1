# F1 Apex — Online + Local Multiplayer Racing (Playable)

This is a browser-playable Formula-inspired racing game with:

- **Local multiplayer** (same device)
- **Online multiplayer over internet** (host/join room)
- Works on **phone or laptop** after deployment (including **Vercel** static deploy)

## Features

- 2-player racing (local or online)
- AI opponents in local mode
- Tyre wear, fuel burn, engine temperature
- ERS / DRS systems
- Dynamic weather + safety car
- Pit stop logic
- Penalties + race control event feed
- Live timing leaderboard
- Touch controls for mobile

## Run locally

```bash
python3 -m http.server 8000
```

Open <http://localhost:8000>.

## Online mode usage

1. Player A selects **Online Host**, enters room code (example: `f1-room-1`), clicks **Start / Connect**.
2. Player B opens the same deployed URL, selects **Online Join**, enters the same room code, clicks **Start / Connect**.
3. Once connected, race state is synchronized from host to joiner.

## Deploy to Vercel

1. Push this repo to GitHub.
2. Import repository into Vercel.
3. Framework preset: **Other** (static site is fine).
4. Deploy.
5. Share deployed URL to another device and use Online Host/Join.

## Controls

### Local mode

- Player 1: `W` `A` `S` `D`, `Shift` (DRS), `Space` (ERS)
- Player 2: Arrow keys, `Enter` (DRS), `Right Ctrl` (ERS)

### Online mode

- Each player uses Player 1 controls on their own device.
- On mobile, use on-screen touch buttons.

## Notes

- Online mode uses PeerJS peer-to-peer transport (internet playable after Vercel deploy).
- Host is authoritative for race simulation; joiner sends inputs.

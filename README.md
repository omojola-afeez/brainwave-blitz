# Brainwave Blitz

A real-time multiplayer trivia game for 2 to 12 players. One person creates a room, everyone else joins with a 5 character code or an invite link. Play solo or as Team A against Team B, with seven topics and five region sets (Nigeria, Africa, Europe, Asia, The Americas). No accounts. The server decides all scores and timing.

## Run it on your computer

Requires Node.js 22.

```
npm ci
npm run dev
```

Open http://localhost:5173. Open a second private window to act as a second player.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Server and website with live reload |
| `npm run build` | Production build into `dist/` |
| `npm start` | Run the production build on port 2567 |
| `npm run typecheck` | TypeScript check |
| `npm test` | Unit and integration tests (real WebSocket clients) |
| `npx playwright test` | Browser tests with separate browser contexts (needs `npm run build` first) |

## Layout

- `src/shared`: rules, scoring constants, message schemas, state shape (used by server and website)
- `src/server`: Colyseus room, match engine, question bank, HTTP app, optional Postgres store
- `src/web`: React website
- `tests`, `e2e`: automated tests
- `docs`: architecture, rules, deployment, operations, security, limitations

## Documents

- [Game rules and scoring](docs/GAME_RULES.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Deployment guide](docs/DEPLOYMENT.md)
- [Operations and recovery](docs/OPERATIONS.md)
- [Security and privacy](docs/SECURITY.md)
- [Known limitations](docs/KNOWN_LIMITATIONS.md)

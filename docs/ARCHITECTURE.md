# Architecture

One Node.js process serves both the website (static files) and the game (WebSocket) on a single port. This keeps hosting to one free service and avoids cross-site configuration.

```
Browser (React) --HTTPS/WSS--> Node process
                                 |- Express: static files, /healthz, /readyz, /api/metrics
                                 |- Colyseus: matchmaking and "blitz" rooms
                                 |    |- BlitzRoom: connections, validation, rate limits
                                 |    |- MatchEngine: phases, timers, answers, scoring
                                 |- optional Postgres: anonymous match results
```

## Server authority

Clients only send intentions: ready, change setting, start, answer. The server checks who sent it, the phase and the deadline, then changes state. Clients never send scores or times. The correct answer index is `-1` in the synchronized state until the reveal phase, so it is never on the wire during a question. Answer counts per option are also withheld until the reveal.

## State machine

LOBBY, COUNTDOWN, QUESTION, REVEAL, SCOREBOARD (repeat QUESTION to SCOREBOARD per round), RESULTS. Every timer carries a token, so a stale timer can never advance the game twice. The engine takes an injected clock, so unit tests run whole matches instantly.

## Time on the client

The state carries `phaseEndsAt` and `question.endsAt` as server timestamps. Each browser estimates its offset from the server clock with `sync` and `sync_reply` messages (lowest round trip sample wins) and draws countdowns from that. The server alone decides when time is up.

## Identity

- `id`: public player id in the roster.
- `clientId`: random value kept in the browser tab's session storage, never shown to others. It lets a refreshed tab take back its own seat.
- Colyseus reconnection token: used for the automatic 60 second reconnect.

## Validation and abuse limits

All messages pass strict Zod schemas. Room creation, joining and matchmaking are rate limited per IP. Connections that flood messages are dropped. The number of live rooms is capped by `MAX_ROOMS`. Cross-site matchmaking requests and WebSocket upgrades are refused by origin check.

## Persistence

Optional. With `DATABASE_URL` set, finished matches are saved (scores and per-question statistics, no names). If the database is down, games continue and the failure is logged.

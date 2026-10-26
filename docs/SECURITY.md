# Security and privacy

## What is stored

- In the browser: a random tab id and reconnect token (session storage, cleared when the tab closes), and your last name and color (local storage) so the form is prefilled.
- On the server: live rooms exist in memory only and disappear when the room closes or the server restarts.
- Optional database: match date, settings, scores and per-question counts. Player names are not saved.
- No cookies, no analytics, no third party scripts. Fonts are served from the same site.

## Protections

- Strict input validation on every message and join option.
- Names are limited to letters, numbers, spaces and `. _ ' -`, so no markup reaches other players. The UI renders text only.
- Server computes every score and decides every deadline.
- Correct answers are not sent before the reveal.
- Rate limits on creation, joining, matchmaking and message flood.
- Origin checks on matchmaking and WebSocket upgrade.
- Security headers on every response (no sniffing, no framing, referrer policy, content security policy).
- Room codes are random (crypto source, 5 characters from 31 symbols, about 28 million combinations) and rooms are short lived.

## Known gaps

- `/api/metrics` is public and returns only counters (rooms, players, errors). No personal data.
- Rate limits are per server process and reset on restart.
- A room code is the only secret protecting a room. Anyone with the code can join a lobby.
- `npm audit` reports an advisory in `elliptic`, which is pulled in by an unused part of Colyseus (`@colyseus/auth`). The game never loads it.

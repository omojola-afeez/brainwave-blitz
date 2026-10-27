# Acceptance report

Status key: PASS has evidence. NOT VERIFIED means no test was run for it. Nothing is marked PASS without evidence.

Date: 2026-10-26. Public URL: https://brainwave-blitz-v6q8.onrender.com

## Evidence sources

- A: automated tests in this repository (165 unit and integration tests, 6 Playwright browser tests), run on the build machine against a local server.
- B: manual test on the public URL by the owner, one computer and one phone on mobile data, with screenshots (health check, lobby, final results).

## Results

| Criterion | Result | Evidence |
| --- | --- | --- |
| Public HTTPS URL loads | PASS | B: `/healthz` returned `{"ok":true}` on the onrender.com address |
| Create a room and get a 5 character code | PASS | A and B (code 5ZSAV in the lobby screenshot) |
| Second player joins by code from a separate device | PASS | B: lobby showed both players on separate devices |
| Ready, host start, settings (5 questions, 20 s) | PASS | A and B |
| Full 5 question match on the public server | PASS | B: final results screenshot, John 1811, Farhan Omojola 0 |
| Both devices show identical final results | PASS | B: reported by the owner. Only one device's screenshot is saved. A: Playwright compares both leaderboards and they match |
| Unanswered question scores zero | PASS | B: first question grey for John in results. A: engine and integration tests |
| Play again returns both players to the countdown | PASS | B: reported by the owner. A: Playwright |
| Scores computed only by the server | PASS | A: forged, duplicate and late answers rejected in integration tests |
| Correct answer hidden until reveal | PASS | A: state tests check `correctIndex` is -1 during a question |
| Full room (12) rejects the 13th player | PASS (local only) | A: integration and Playwright. NOT VERIFIED on the public server |
| Match in progress rejects new players | PASS (local only) | A |
| Reconnect within 60 seconds restores the seat | PASS (local only) | A: integration tests. NOT VERIFIED on the public server |
| Refresh keeps the seat | PASS (local only) | A: Playwright |
| Host handoff when the host leaves | PASS (local only) | A |
| Invalid and unknown room codes show clear errors | PASS | A: Playwright |
| Rate limits and flood protection | PASS (local only) | A |
| Several rooms at once stay separate | PASS (local only) | A: Playwright, two rooms |
| Phone layout (390 px wide) | PASS | A: screenshots reviewed. B: used on a real phone |
| Keyboard answers (keys 1 to 4), labels, reduced motion support | NOT VERIFIED | Built in, but no keyboard or screen reader audit was run |
| Load test at many simultaneous rooms | NOT VERIFIED | No load test has been run. Free tier capacity is unknown |
| Behavior after the free service sleeps and wakes | NOT VERIFIED | Documented as a limitation. Not timed |
| Match history saved to a database | NOT VERIFIED | Feature exists and has tests. No database is connected in production |
| Region question sets (Nigeria, Africa, Europe, Asia, The Americas) | PASS (local only) | A: bank validation, pool size, Mixed excludes regions, region match asks only that region, answers hidden over real connections, browser test picks Nigeria and sees Nigeria questions. NOT VERIFIED on the public server until deployed |
| Region question accuracy | NOT VERIFIED | Written by hand. No outside fact check. Full list in `docs/REGION_QUESTIONS.md` for review |
| Team A vs Team B: split, switch, both teams required | PASS (local only) | A: unit tests, 4 player integration test over real connections, browser test with two contexts. NOT VERIFIED on the public server until deployed |
| Team scores equal on all devices, averages fair for uneven teams | PASS (local only) | A: unit tests (3 against 2 cases, mutation check that breaking the average fails them), integration and browser tests compare both devices |
| Power-ups, custom questions | NOT BUILT | Deferred by decision |

## Open items

- Run a 12 player and reconnect test on the public URL.
- Time a cold start after sleep.
- Run a load test and record the result.

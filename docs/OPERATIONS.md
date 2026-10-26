# Operations and recovery

## Check that it is alive

- `https://YOUR-URL/healthz` should show `{"ok":true}`.
- `https://YOUR-URL/api/metrics` shows active rooms and players.

## Common problems

| Symptom | Cause | Fix |
| --- | --- | --- |
| Site takes up to a minute to load | Free service was asleep | Wait, then reload. Open it early before a demo |
| "Can't reach the game server" | Server restarting or asleep | Wait 1 minute and retry |
| "No room with that code" | Wrong code, room closed, or server restarted | Create a new room |
| Everyone dropped at once | New deployment or restart | Create a new room |
| "The server is busy" | Room cap reached | Wait for rooms to close or raise `MAX_ROOMS` |

## Restart or redeploy (Render)

Dashboard, open the service, choose Manual Deploy, Deploy latest commit. Or Restart service from the same page. Logs are under Logs.

## Publish an update

Change files in the GitHub repository (edit on github.com or upload new files). Render rebuilds automatically on every commit to `main`. The CI workflow runs the tests on each commit and shows a green check or red cross on the commit.

## Roll back

On the Render service page open Events or Deploys, pick a previous successful deploy and choose Rollback. Or revert the commit on GitHub.

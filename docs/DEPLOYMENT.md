# Deployment guide

Current production setup: one Render free web service built from the GitHub repository `omojola-afeez/brainwave-blitz`, branch `main`.

Public URL: https://brainwave-blitz-v6q8.onrender.com

## Render settings in use

| Setting | Value |
| --- | --- |
| Language | Node |
| Region | Frankfurt |
| Branch | main |
| Build command | `npm ci --include=dev && npm run build` |
| Start command | `node dist/server/index.js` |
| Instance type | Free |
| Health check path | `/healthz` |
| Environment | `NODE_VERSION=22` |

Render sets `PORT` itself. No secrets are needed. `DATABASE_URL` is not set, so match history is off and the log shows `database_disabled`.

## Optional environment variables

| Name | Purpose | Default |
| --- | --- | --- |
| `ALLOWED_ORIGINS` | Extra website addresses allowed to connect, comma separated | none (same site only) |
| `MAX_ROOMS` | Cap on live rooms | 200 |
| `LOG_LEVEL` | debug, info, warn, error | info |
| `DATABASE_URL` | Postgres address to save anonymous match results | off |

Change them on Render: service page, Environment, Add Environment Variable, Save. The service restarts.

## Custom domain

Not needed and not set up. A custom domain costs money. The `onrender.com` address is free and uses HTTPS.

## Deploying an update

1. Open the file on GitHub, click the pencil icon, edit, and click Commit changes. Or use Add file, Upload files for new files.
2. Render notices the commit and rebuilds. Watch it under the service's Events tab.
3. When the page says Live, open `/healthz` to confirm.

A deploy ends any match in progress.

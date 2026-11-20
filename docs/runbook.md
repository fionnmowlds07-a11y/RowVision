# Runbook

## Local stack

```bash
cd apps/web
npm run db:start          # Supabase on ports 544xx. Never touches the other project on 54321 to 54324.
npm run db:status         # Keys, for .env and apps/web/.env.local
npm run dev               # Web app on port 3100
docker compose up worker  # Set ROWVISION_ENGINE=fake to skip the models
```

To preview the finished build instead, run `docker compose up -d --no-deps web`, after stopping `npm run dev`. Rebuild with `docker compose build web`.

Local email arrives at http://127.0.0.1:54424. Sign in as `admin@example.com` or `athlete@example.com`.

## Tests

| What | Command |
|---|---|
| Web unit | `npm test` in `apps/web` |
| Database | `npx supabase test db --workdir ../..` in `apps/web` |
| Browser | `CHROME_PATH=/usr/bin/chromium npm run test:browser`, with the app and a fake worker running |
| Acceptance | `npm run test:acceptance`, with the same running |
| Worker, vision, preview | `pytest`, inside the `rowvision-vision:dev` image |

Playwright's own Chromium cannot play H.264, so the tests use system Chrome.

## When something goes wrong

| What you see | What to do |
|---|---|
| Athletes see "Analysis is paused" | The worker is off. Check the admin page, then restart it |
| A job stays running | Its lease runs out after 60 seconds without a heartbeat, then it is requeued |
| A clip failed | Open it from the admin page, and read the worker's log |
| Old video is not going | The deletion schedule has stopped. Call it by hand: `curl -X POST https://YOUR-APP/api/retention -H "Authorization: Bearer $RETENTION_SECRET"` |
| Someone must be removed | Remove their email on the admin page. Their account is banned at once, but sessions last up to an hour |
| Someone asks for their data to go | Delete their clips or account. Their training copies go too |
| Deep health fails | The response names the failing service |

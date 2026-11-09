# RowVision desktop app

Electron, with a React page that imports the results, viewer, 3D model and logic straight from `apps/web`. See `docs/desktop-plan.md`.

| Task | Command |
|---|---|
| Install | `npm ci` |
| Build | `npm run build` |
| Start | `npm start` (after a build) |
| Lint, types, unit tests | `npm run lint`, `npm run typecheck`, `npm test` |
| App tests | `npm run test:app` (needs `ffmpeg`; makes its own test clip, never real footage) |

## Where things live

- Clips: `<app data>/clips/<id>/`, one folder each, holding what the engine writes (`working.mp4`, `video.json`, `summary.json`, `frames.json`) plus `clip.json` with the setup, trim, tap and where the original video is. Adding a video never copies it: the engine reads it in place. App data is `~/.config/RowVision` on Linux and `%APPDATA%\RowVision` on Windows. `ROWVISION_DATA_DIR` points it elsewhere, for tests.
- Settings: `<app data>/settings.json`. Colours, the last boat, side and seat, and how fast this computer analysed its last clip.

## Analysis

Clips are analysed one at a time, oldest first, by the engine in `services/worker/rowvision_worker/desktop.py`. The app writes `job.json` in the clip's folder, starts the engine and reads its progress lines. The engine's log goes to `engine.log` there.

- Where a clip is comes from its folder: `summary.json` means done, `pause.json` means it needs a tap, `state.json` means stopped or failed, and anything else is waiting. So a clip cut off by closing the app simply starts again next time.
- The packaged app looks for the engine in `resources/engine/` (shipping it is #157). Without it, clips wait and the screen says so. `ROWVISION_ENGINE` sets the command instead, for example `'["python", "-m", "rowvision_worker.desktop"]'`, and `ROWVISION_ENGINE_KIND=fake` gives a canned result.
- Deleting a clip removes its folder. Removing a video deletes `working.mp4` and `frames.json` and keeps the scores. The user's original video is never touched.
- Sending a clip (#156) goes to the service in `services/intake`, through one-time upload links. `ROWVISION_SEND_URL` says where it is; without it the Send button does not show.
- Tests use `tests/fake-engine.mjs`, which speaks the same lines without any models.

## Locked down

- The page has no Node access: `contextIsolation`, `sandbox`, no `nodeIntegration`. The preload exposes a fixed list of calls (`src/shared/bridge.ts`), and the main process checks every argument. A video path from the page must be absolute and end in a video extension and that the call comes from the app's own page.
- The page is served from `app://rowvision/`. Video and frame data come only from `rowvision://clip/<id>/working.mp4` and `frames.json`, with ids and file names checked so nothing outside the library can be read. The add page previews the picked video from a `blob:` address it makes itself.
- A strict content security policy, no remote requests at all, no new windows, no navigation away, and every permission refused. Research links open in the user's own browser.

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
- Settings: `<app data>/settings.json`. Colours and the last boat, side and seat.

## Locked down

- The page has no Node access: `contextIsolation`, `sandbox`, no `nodeIntegration`. The preload exposes a fixed list of calls (`src/shared/bridge.ts`), and the main process checks every argument. A video path from the page must be absolute and end in a video extension and that the call comes from the app's own page.
- The page is served from `app://rowvision/`. Video and frame data come only from `rowvision://clip/<id>/working.mp4` and `frames.json`, with ids and file names checked so nothing outside the library can be read. The add page previews the picked video from a `blob:` address it makes itself.
- A strict content security policy, no remote requests at all, no new windows, no navigation away, and every permission refused. Research links open in the user's own browser.

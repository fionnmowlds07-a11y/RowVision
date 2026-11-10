# RowVision desktop app

Electron, with a React page that imports the results, viewer, 3D model and logic straight from `apps/web`. See `docs/desktop-plan.md`.

| Task | Command |
|---|---|
| Install | `npm ci` |
| Build | `npm run build` |
| Start | `npm start` (after a build). Clips wait, as there is no measuring program |
| Start with the real engine | `npm run start:engine` (after a build; Linux, needs Docker, see below) |
| Lint, types, unit tests | `npm run lint`, `npm run typecheck`, `npm test` |
| Installer | `npm run dist` (a Windows installer on Windows, an AppImage on Linux, in `release/`) |
| Installed-app test | `npm run test:packaged`, after `npm run dist` |
| App tests | `npm run test:app` (needs `ffmpeg`; makes its own test clip, never real footage) |

## Where things live

- Clips: `<app data>/clips/<id>/`, one folder each, holding what the engine writes (`working.mp4`, `video.json`, `summary.json`, `frames.json`) plus `clip.json` with the setup, trim, tap and where the original video is. Adding a video never copies it: the engine reads it in place. App data is `~/.config/RowVision` on Linux and `%APPDATA%\RowVision` on Windows. `ROWVISION_DATA_DIR` points it elsewhere, for tests.
- Settings: `<app data>/settings.json`. Colours, the last boat, side and seat, how fast this computer analysed its last clip, whether the welcome is done, and the clips folder if the user moved it.

## First run

A three-step welcome (#175, First run A from #150) shows until it is finished, and never when clips already exist: where clips are kept (with the free space and Change), colours, and getting the measuring ready. Change puts clips in a `RowVision` folder inside the one picked, and only works while the library is empty.

Step 3 shows what is really on the computer. Without the measuring program it says so plainly. With it, the models download by themselves (#182), with progress, Cancel and Try again. "Ready" only shows once both files are there and checked. The same card is in Settings, and clips wait for the models: the analysis screen says so and links to Settings.

## Technique targets (#185)

Settings has a "Technique targets" card: the range for each body angle (catch and finish trunk, catch and finish knee), and whether each one counts towards the score. A range is 5° wide at most, and can be dragged on its bar or typed. Only the two trunk angles count at first. The overall score needs at least one catch and one finish measure counting.

The choices are saved in `settings.json` under `targets`. The engine does not know about them: it always scores with the general standard in `services/vision/reference/general.yaml`. The scores are worked out again when a clip is read (`rescore` in `apps/web/lib/targets.ts`), from the measurements saved in `summary.json`, so changing a range needs no new analysis and the file on disk is never changed. `GENERAL_TARGETS` in that file must match the yaml, and a test checks it does. "Legs before body" and drive share are not editable yet.

## Measuring models

Two models, about 145 MB in all (the "balanced" pair from rtmlib: a person detector and a pose model). The engine knows the list, so there is one place to change it: `services/worker/rowvision_worker/models.py` has each file's name, size and SHA-256. `rowvision-engine --models status` says what is missing, and `--models fetch` gets it, writing progress as JSON lines, from download.openmmlab.com with the Hugging Face copy as a fallback. Every file is checked before it is put in place, so a damaged or cut-off download is never used. The app tells the engine to keep them in `<app data>/models/rtmlib/hub/checkpoints/` (`TORCH_HOME`), where rtmlib looks, so it never downloads anything quietly itself. Removing the app's data removes them.

Tests use `ROWVISION_MODELS_BASE` for a local server, and `FAKE_MODELS_CONTROL` (`ready`, `missing`, `offline`, `slow`) for the stand-in engine. Tests set `ROWVISION_TEST_PICK_FOLDER` instead of opening the folder dialog.

## Analysis

Clips are analysed one at a time, oldest first, by the engine in `services/worker/rowvision_worker/desktop.py`. The app writes `job.json` in the clip's folder, starts the engine and reads its progress lines. The engine's log goes to `engine.log` there.

- Where a clip is comes from its folder: `summary.json` means done, `pause.json` means it needs a tap, `state.json` means stopped or failed, and anything else is waiting. So a clip cut off by closing the app simply starts again next time.
- The packaged app looks for the engine in `resources/engine/` (shipping it is #157). Without it, clips wait and the screen says so. `ROWVISION_ENGINE` sets the command instead, for example `'["python", "-m", "rowvision_worker.desktop"]'`, and `ROWVISION_ENGINE_KIND=fake` gives a canned result.
- Deleting a clip removes its folder. Removing a video deletes `working.mp4` and `frames.json` and keeps the scores. The user's original video is never touched.
- Sending a clip (#156) goes to the service in `services/intake`, through one-time upload links. `ROWVISION_SEND_URL` says where it is; without it the Send button does not show.
- Tests use `tests/fake-engine.mjs`, which speaks the same lines without any models.

## Running from source with the real engine

`npm run start:engine` starts the app with `scripts/dev-engine.sh` as its measuring program, until the installer carries its own (#157). It runs the engine in the `compvisionrowing-worker` Docker image with no network and 3 CPUs (`ROWVISION_ENGINE_CPUS`), and only lets it see the clip's folder and the folder the video is in. The models come from `private/cache/.cache/rtmlib` (`ROWVISION_MODELS` points elsewhere). The engine code is the repo's own, mounted over the image, so engine changes show up straight away.

The window switches Vulkan off at startup (#180): on Wayland, Chromium tries it and the window goes black in full screen.

## Locked down

- The page has no Node access: `contextIsolation`, `sandbox`, no `nodeIntegration`. The preload exposes a fixed list of calls (`src/shared/bridge.ts`), and the main process checks every argument. A video path from the page must be absolute and end in a video extension and that the call comes from the app's own page.
- The page is served from `app://rowvision/`. Video and frame data come only from `rowvision://clip/<id>/working.mp4` and `frames.json`, with ids and file names checked so nothing outside the library can be read. The add page previews the picked video from a `blob:` address it makes itself.
- A strict content security policy, no remote requests at all, no new windows, no navigation away, and every permission refused. Research links open in the user's own browser.

## Installers (#178)

`electron-builder.yml` builds a Windows installer (`RowVision-Setup-<version>.exe`) and a Linux AppImage (`RowVision-<version>.AppImage`). The icon is in `build/`: `icon.png`, `icon.ico` and one PNG for each size in `icons/`. The small sizes are a bolder, larger version of the rower so they stay readable. The artwork it came from is in `build/source/`.

The `Installers` workflow builds both in CI, only when started by hand, on a version tag, or when it or the installer settings change. It bundles the engine with PyInstaller (the same way as the engine bundle check), puts ffmpeg and ffprobe beside it (`scripts/fetch-ffmpeg.py`, pinned and checked against the published checksums), builds the installer, then runs the bundled engine on a clip made by the bundled ffmpeg with no Python on the path. Installers are kept for 7 days as workflow files.

- The app puts the engine's own folder first on the path, so the ffmpeg packed beside it is the one used.
- Without `engine/` the installer still builds, and the app says plainly the measuring program isn't installed.
- ffmpeg has to be a GPL build because the working copy uses libx264. Check this under #115 before giving the app to anyone.
- The Windows installer is not signed, so Windows shows a warning. Updates are not checked yet (#157).
- Models are not in the installer. The app downloads them on first run (#182). The installed-app test does this for real in CI, then checks the bundled engine loads what was downloaded. The model licences are still to be checked under #115.

## Building and installing on this computer (Linux)

`bash scripts/build-installer.sh` makes the full installer without CI: it bundles the engine in a Python 3.12 Docker container, puts ffmpeg beside it, then builds the AppImage (about 370 MB) in `release/`. An existing `engine/` is reused, so delete it to rebuild the measuring program. The Windows installer still has to be built on Windows (the Installers workflow).

`bash scripts/install-linux.sh` (or `build-installer.sh --install`) copies the unpacked build to `~/.local/share/rowvision` and adds a RowVision entry and icons to the app launcher, so it can be searched for and opened. It uses the unpacked build as AppImages need FUSE, which not every system has. `install-linux.sh --remove` takes it off again and keeps the clips.

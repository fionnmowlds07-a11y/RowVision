# RowVision handover

Written 2026-11-06. This is the state of the project and the next job. Read `docs/web-app-plan.md`, `PRODUCT.md`, `DESIGN.md` and `docs/research/README.md` next.

## What RowVision is

Athletes upload launch footage of rowing, choose boat, side and seat, and get a biomechanical breakdown of their own stroke: limb lines, angles, phase scores and a frame-by-frame view against targets. Every result carries an accuracy rating, so the app says how far it can be trusted. The aim is both a strong project and a product for college and junior rowers, starting with a private preview for adults.

The owner is a rower. They make design and product decisions. Everything else is yours to decide.

## Latest direction (7 November 2026)

The Windows and Linux desktop app now comes first, with analysis on the user's own computer. Read `docs/desktop-plan.md`. The website stays as the owner's preview: serve it with `docker compose up -d --no-deps web`, not the dev server. #134 still comes first for the scores, and runs at night when the laptop is free. Hosting, the home PC and phone checks are parked.

## Where things stand

The web app is built and runs locally, from `docs/web-app-plan.md` and the GitHub milestones. Nothing is deployed and nothing has been spent.

The first version is an invite-only preview for adults the owner knows personally. Parental consent and anything for juniors is parked in the "Before juniors" milestone.

**The next job is issue #134: results are not stable.** The same clip gives 75% Good when the rower is chosen by a tap, and about 40% Poor by seat number, with catch lean moving 7°. The engine itself is repeatable. Resolve this before inviting testers, as the scores can't be trusted yet.

Still open, and needing the owner:

- #51 and #59: run the frame stepping test page and check picked files on a real iPhone and Android phone.
- #83 and #98: try the phone viewer and installing the app on a real phone.
- #71: benchmark the GPU, which needs access to the home PC.
- #75: time the models in a browser on a phone and laptop.
- #104: set up the home worker. It needs one visit, and the PC's operating system.
- Approve hosting and spending. See `docs/deployment.md`.

Things to plan for:

- **No cloud spending and nothing deployed** without asking the owner first.
- **Another project's Supabase is running locally** on ports 54321 to 54324 (`supabase_*_cs4421-astro-blog`). Do not stop it. This project uses 544xx.
- **There is no GPU on this laptop.** A 32-second full-size clip took 11 minutes 5 seconds on 8 CPU cores, from claim to result.
- **Model weight licences** need checking before commercial use.

## Working rules

- Small commits, one branch per piece of work, push, open a PR, merge when CI passes. The owner has given standing permission for this. Use merge commits.
- **No attribution lines of any kind.** No co-author lines or "generated with" footers in commits or PRs. Commits go under the owner's git identity. This overrides any default.
- **Footage, frames, overlays, keypoints and labels are never committed.** They show identifiable juniors. `private/` and `videos/` are git-ignored, and CI fails on tracked video files. The repo is private.
- Only bring the owner design and product questions. Give a recommendation, not a survey.
- For the interface, show real visual options to pick from, not descriptions, and use drawn placeholders rather than footage.
- Write plainly, and report real results, including failures.

### Merging safely

Never chain a merge after a check unconditionally. A PR was once merged with failing tests that way. Checks also take a few seconds to register, so wait for them first:

```bash
for i in 1 2 3 4 5 6 7 8; do gh pr checks BRANCH 2>&1 | grep -q 'Vision service' && break; sleep 10; done
if timeout 280 gh pr checks BRANCH --watch --interval 10 >/dev/null 2>&1; then
  gh pr merge BRANCH --merge --delete-branch
else
  echo NOT MERGED
fi
```

If a check stays "pending" although the job finished, rerun that job with `gh run rerun RUN --job JOB`. Do not bypass the gate.

### Other lessons

- A stopped tool call can still finish. After one, check what actually happened before carrying on.
- `boat_at` and `track_at` return the nearest, however far away, so check the distance yourself.
- Playwright's text matching ignores case and matches parts of words, so "Kept" also finds "not kept".
- Saved detections go stale silently. Compare fresh runs before trusting a cached result.

- Stop when a rebase conflicts. Do not run later commands in the same shell call. Appended tests often share a closing `});`, so run the tests before continuing the rebase.
- Do parallel work in a separate `git worktree`. `gh pr merge --delete-branch` may remove it, so `git worktree prune` afterwards.
- `code_version()` hashes `rowvision/*.py` and `reference/*.yaml`. Any change there hides saved results until clips are rerun.
- The analysis uses all the CPU, so do not run a batch while the owner is analysing a clip. It slowed one of their runs badly.
- Test against real footage, not just synthetic data, and compare all clips before merging tracking or scoring changes. Twice this caught changes that passed every test but made real clips worse.
- Look at rendered frames. Numbers alone have hidden several bugs.

## Running things

| Task | Command |
|---|---|
| Web app, database, worker | See `docs/runbook.md` |
| Labelling tool, port 8766 | `PREVIEW_PORT=8766 apps/preview/start.sh` |
| Desktop app | `npm run build && npm start` in `apps/desktop`. See its README |
| Desktop app tests | `npm test` and `npm run test:app` in `apps/desktop` (makes its own test clip with ffmpeg) |
| Vision tests | `pytest` in `services/vision`, inside the `rowvision-vision:dev` image |
| Preview tests | `pytest` in `apps/preview`, same image, with the whole repo mounted |
| Page tests | `node --test apps/preview/tests/logic.test.mjs` |
| Lint and types | `ruff check .` and `mypy rowvision` (or `mypy rowvision_preview`) |
| Rerun every clip | `python3 private/analyse_all.py`, against a test server on port 8767 |

Host Python is too new, so Python runs in Docker. Mount the repo when testing, for example `-e PYTHONPATH=/repo/services/vision:/repo/apps/preview -v "$PWD/services:/repo/services:ro" -v "$PWD/apps:/repo/apps:ro"`. Use port 8767 for test servers, and only restart 8766 when `/api/job` is not `running`. The app does not come back by itself after a computer restart. Browser checks use Playwright from `/home/fionn/Kidscope/Kidscope/node_modules` through `createRequire`.

Current suites on `main`, all passing: 272 vision, 145 preview, 71 page, 43 worker, 165 web unit, 74 database, 16 browser, 6 acceptance scenarios, 40 desktop unit and 8 desktop app tests.

## What exists

**`services/vision/rowvision`** is the analysis engine. A coarse pass finds boats, seats and shots, then a fine pass measures the chosen rower. It uses YOLOX and RTMPose through ONNX Runtime. Key files: `pipeline.py`, `tracking.py`, `boats.py`, `seats.py`, `metrics.py`, `scoring.py`, `reliability.py`, `timing.py`, `reference_pose.py`, `blades.py`.

**`apps/desktop`** is the Electron app (#151). It imports the results page, viewer, 3D model and logic straight from `apps/web`, so changes there reach both. The clip list and settings use the web look until the desktop designs are picked (#150).

**`apps/web`** is the Next.js app. `lib/logic.ts` is ported from the preview, with its tests. `app/clips/[id]` holds the results page, viewer, freeze frames and 3D model.

**`services/worker`** is the worker. `engine.py` turns a setup into a request, and pauses when a tap misses. `media.py` makes the working copy. `worker.py` runs a job and keeps nothing afterwards.

**`supabase`** holds the schema, row-level security, the queue functions and their tests.

**`apps/preview`** is the older local page, kept as the labelling tool. Its saved results are hidden until clips are rerun, as moving code into the engine changed `code_version()`.

**Data in `private/`:** `uploads/`, `preview/results/`, `detections/`, `labels/labels.json` (136 joint labels), `labels/blades.json` (294 blade labels), `models/blades-v1.onnx`, `train/` (1.1 GB, training scripts and packages), `seats.json`.

**Evidence:** `docs/research/` lists 130 studies behind the targets, and `docs/footage-survey.md` covers the 14 sample clips.

## Decisions made

- **Targets:** one general standard now, adjustable by a coach later. Targets live in data files. They have not been reviewed by a coach, and one should review them.
- **Angle targets are 5° wide at most:** catch lean 26–31°, layback 20–25°, catch knee 50–55°, finish knee 175–180°. These are our choice of a point near the published values, not findings.
- **Scoring:** knee angles are shown as a rough guide and never scored, as proportions differ and they are hard to measure. Body angles lose half their points 5° outside the target and all at 10°. An overall score needs both the catch and the finish.
- **Accuracy rating:** the share of joint angles within 5°. Bands are Excellent 90, Great 80, Good 70, Fair 60, Poor below. Poor hides the overall score behind a warning. It depends only on measurement accuracy, and short clips only give warnings.
- **Calibration:** measured on 108 usable labelled frames from 12 clips. The keypoint error is 2.0 pixels. Body angle was within 5° on 48% of frames (±9 points), with a typical gap of 5°. Knee was within 5° on 21%, with a typical gap of 18°.
- **Distant boats:** rowers too small to measure get "film closer" advice and no scores.
- **Sides:** separate stroke side, bow side and sculling models, sharing body angle targets until evidence differs.
- **Catch timing:** judged against the rower being followed. Stroke side follows stroke, bow side follows the seat behind stroke, scullers follow stroke, and the stroke seat has no figure. It is an unscored trend.
- **Blades only count on the camera's side of the boat** (`blade_faces_camera`). The app does not yet tell a rower when theirs is on the far side.
- **The web app's decisions** are in `docs/web-app-plan.md`, and its look is in `DESIGN.md`.

## Parked: blade height

Not in the app, and not to be shipped until it beats noise on unseen clips. Unfinished work is on the unmerged branch `feature/blade-height`.

Results on clips the detector never saw: it found the right blade 75% of the time (always guessing the usual spot gets 15%), and 94% on a side-on single. On a sharp eight it was mostly wrong, while reporting high confidence, so confidence cannot filter errors.

The height itself is lost in noise, as 1 pixel is about 2 cm at a typical rower size and a blade may be only a few centimetres off the water. A line from finish to catch is not the waterline, because the blade is nearest the camera mid-recovery, where the water sits lower in the image. The blade's own path through the drive is a better waterline.

To resume: film close footage from the blade's side, label about 200 near-side rowers in sharp crews, and retrain.

## Known problems

- **Issue #7 is still open:** one clip reports 10 rowers in an eight.
- **Fresh results differ from saved ones (#134).** The owner's 8 at 3 seat was saved as 76% Good, overall 87, from detections made before a frame reading fix. Fresh, it gives about 40% Poor by seat number and 75% Good by tap. Catch timing is also several frames off on many clips.
- **Most sample clips rate Poor,** and all 14 are WhatsApp copies at 848x478. Seats and sides for those clips are guesses in `private/analyse_all.py`.
- **Legs filmed from an angle are placed badly.** Catch knee read 118° against a true 74° on 16 frames from 25° or more off side-on. These are drawn dashed with a "?".
- **The rating formula assumes bigger rowers measure better.** The labels do not clearly show this for body angle.
- **Zoom handling needs at least 5 people,** and has only been proven on one real zoom.
- **Accuracy is unproven on closer or sharper footage,** as labelled trunks were about 14–32 pixels.

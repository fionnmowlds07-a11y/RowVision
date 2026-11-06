# RowVision handover

Written 2026-11-06. This is the state of the project and the next job. Read `PRODUCT.md`, `DESIGN.md` and `docs/research/README.md` next.

## What RowVision is

Athletes upload launch footage of rowing, choose boat, side and seat, and get a biomechanical breakdown of their own stroke: limb lines, angles, phase scores and a frame-by-frame view against targets. Every result carries an accuracy rating, so the app says how far it can be trusted. The aim is both a strong project and a product for college and junior rowers.

The owner is a rower. They make design and product decisions. Everything else is yours to decide.

## Next job: build the real web app

The owner chose this on 2026-11-06, after blade height was parked. It covers milestones 4 to 6 of the plan at `/home/fionn/.claude/plans/i-have-an-idea-humble-conway.md`:

1. **Web app:** accounts, resumable upload from a phone, worker queue, results page, frame viewer.
2. **Product layer:** parental consent for under-age users, permission to upload teammates, 30-day deletion of source video, full account deletion, history, installable app, onboarding and a filming guide.
3. **Delivery:** full CI, acceptance and browser tests, infrastructure stacks, documentation.

Planned stack, which can change if there is a good reason: Next.js and TypeScript, Supabase with row-level security (local through its CLI), a Postgres job queue using `FOR UPDATE SKIP LOCKED`, and the Python worker in Docker. None of `apps/web`, `supabase/` or `infra/` exists yet.

**Start here:** `apps/preview` is the working reference for every behaviour. Reuse its logic and its visual design rather than reinventing them. Keep the vision package as the engine, and turn the preview's job runner into the worker.

Things to plan for:

- **No cloud spending and nothing deployed** without asking the owner first.
- **Another project's Supabase is running locally** on ports 54321 to 54324 (`supabase_*_cs4421-astro-blog`). Do not stop it, and use different ports.
- **There is no GPU.** A new 32 second clip takes about 8 minutes on 8 CPU cores, so progress reporting matters. Only 162 seconds of that is timed exactly, and a full run from drop to result has not been timed.
- **Juniors and privacy.** The digital consent age varies by country (16 in Ireland). A legal review is needed before public launch, and that is outside what we can do. Model weight licences also need checking before commercial use.
- **The filming guide should ask for** a side-on camera, the rower large in frame, at least 10 strokes, and the camera on the side of the rower's blade.

## Working rules

- Small commits, one branch per piece of work, push, open a PR, merge when CI passes. The owner has given standing permission for this. Use merge commits.
- **No attribution lines of any kind.** No co-author lines or "generated with" footers in commits or PRs. Commits go under the owner's git identity. This overrides any default.
- **Footage, frames, overlays, keypoints and labels are never committed.** They show identifiable juniors. `private/` and `videos/` are git-ignored, and CI fails on tracked video files. The repo is private.
- Only bring the owner design and product questions. Give a recommendation, not a survey.
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

- Stop when a rebase conflicts. Do not run later commands in the same shell call. Appended tests often share a closing `});`, so run the tests before continuing the rebase.
- Do parallel work in a separate `git worktree`. `gh pr merge --delete-branch` may remove it, so `git worktree prune` afterwards.
- `code_version()` hashes `rowvision/*.py` and `reference/*.yaml`. Any change there hides saved results until clips are rerun.
- The analysis uses all the CPU, so do not run a batch while the owner is analysing a clip. It slowed one of their runs badly.
- Test against real footage, not just synthetic data, and compare all clips before merging tracking or scoring changes. Twice this caught changes that passed every test but made real clips worse.
- Look at rendered frames. Numbers alone have hidden several bugs.

## Running things

| Task | Command |
|---|---|
| Owner's app, port 8766 | `PREVIEW_PORT=8766 apps/preview/start.sh` |
| Vision tests | `pytest` in `services/vision`, inside the `rowvision-vision:dev` image |
| Preview tests | `pytest` in `apps/preview`, same image, with the whole repo mounted |
| Page tests | `node --test apps/preview/tests/logic.test.mjs` |
| Lint and types | `ruff check .` and `mypy rowvision` (or `mypy rowvision_preview`) |
| Rerun every clip | `python3 private/analyse_all.py`, against a test server on port 8767 |

Host Python is too new, so Python runs in Docker. Mount the repo when testing, for example `-e PYTHONPATH=/repo/services/vision:/repo/apps/preview -v "$PWD/services:/repo/services:ro" -v "$PWD/apps:/repo/apps:ro"`. Use port 8767 for test servers, and only restart 8766 when `/api/job` is not `running`. The app does not come back by itself after a computer restart. Browser checks use Playwright from `/home/fionn/Kidscope/Kidscope/node_modules` through `createRequire`.

Current suites on `main`: 255 vision, 162 preview and 71 page tests, all passing.

## What exists

**`services/vision/rowvision`** is the analysis engine. A coarse pass finds boats, seats and shots, then a fine pass measures the chosen rower. It uses YOLOX and RTMPose through ONNX Runtime. Key files: `pipeline.py`, `tracking.py`, `boats.py`, `seats.py`, `metrics.py`, `scoring.py`, `reliability.py`, `timing.py`, `reference_pose.py`, `blades.py`.

**`apps/preview`** is a local web page on Python's `http.server` with static ES modules. It has drag-and-drop upload, a boat picker, the frame viewer with limb lines, angles and target wedges, the score panel, a 3D reference rower for stroke side, bow side and sculling, saved results, and labelling pages for joints and blades.

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
- **Upload replaces the clip dropdown.** The folder clips open from Saved results.

## Parked: blade height

Not in the app, and not to be shipped until it beats noise on unseen clips. Unfinished work is on the unmerged branch `feature/blade-height`.

Results on clips the detector never saw: it found the right blade 75% of the time (always guessing the usual spot gets 15%), and 94% on a side-on single. On a sharp eight it was mostly wrong, while reporting high confidence, so confidence cannot filter errors.

The height itself is lost in noise, as 1 pixel is about 2 cm at a typical rower size and a blade may be only a few centimetres off the water. A line from finish to catch is not the waterline, because the blade is nearest the camera mid-recovery, where the water sits lower in the image. The blade's own path through the drive is a better waterline.

To resume: film close footage from the blade's side, label about 200 near-side rowers in sharp crews, and retrain.

## Known problems

- **Issue #7 is still open:** one clip reports 10 rowers in an eight.
- **Most sample clips rate Poor,** which is honest about the footage. Seats and sides for those clips are guesses in `private/analyse_all.py`. Some hidden scores are still high (95 and 98). The owner's 8 at 3 seat is the best real test: 76% Good, overall 87.
- **Legs filmed from an angle are placed badly.** Catch knee read 118° against a true 74° on 16 frames from 25° or more off side-on. These are drawn dashed with a "?".
- **The rating formula assumes bigger rowers measure better.** The labels do not clearly show this for body angle.
- **Zoom handling needs at least 5 people,** and has only been proven on one real zoom.
- **Accuracy is unproven on closer or sharper footage,** as labelled trunks were about 14–32 pixels.

> **7 November 2026:** the Windows and Linux app now comes first. See `docs/desktop-plan.md`. This website stays as the owner's preview.

# RowVision web app: staged plan

Approved by the owner on 2026-11-06. Work runs from the GitHub milestones and issues made from this plan.

## Context

Blade height is parked. The next job is the real web app: milestones 4 to 6 of the original build plan. The owner did not want autonomous building from a loose plan, so the design was settled by question and answer, stage by stage. These answers become GitHub issues, and the work then runs from the issues, so the app is built right the first time.

The first version is a private preview for adults the owner knows personally. It should prove the app on real footage and show what is wrong with it.

## Decisions

| Area | Decision |
|---|---|
| Users | Invite-only preview, adults only. Nobody under 18 is approved. No date of birth is collected. |
| Accounts | Athletes only, each seeing only their own clips. The database leaves room for coaches. |
| Sign-in | Emailed 6-digit code. No passwords. |
| Invites | Approved email list on an admin page. Anyone else is turned away. |
| Devices | Equal weight. Every screen is fully designed for phone and laptop. |
| Long clips | The athlete picks a 60-second section. Only that part is analysed and kept. The whole file uploads. |
| Finding the rower | Tap yourself at setup. One tap picks boat and rower. "Boats in the video" goes. Seat is still asked for. Analysis only pauses if the tap misses. |
| Low quality | Warn that a clip looks like a compressed copy, then let them continue. |
| Result ready | One short email with a link, with no footage or scores in it. |
| Queue | Take turns: everyone's first clip before anyone's second, up to 2 waiting each. |
| Analysis location | All building and testing runs on the owner's laptop. When testers join, the worker moves to the owner's home desktop (Ryzen 5 2600, GTX 1650), always on, with the same code. Pay-per-clip cloud is the upgrade if use grows. |
| On-device analysis | Server analysis is built as planned. One experiment (3.11) times the real models in a browser on the owner's phone and laptop, to decide from real numbers whether "analyse on this device" is added later, starting with laptops. |
| Admin view | Everything. The admin can open any clip and result. Each view is logged. |
| Work on next | Up to 3 scored measures losing the most points, in plain words, each linking to its frames. No drills. On Poor, filming advice replaces it. |
| Phone results | Summary first. Tapping a measure opens the video full screen at that frame. Laptop keeps video left, scores right. |
| Per-stroke chart | Left out for now. |
| Old results | Kept as they were, labelled "Measured with an older version". Rerun is the athlete's choice while the video exists. |
| Progress | Clip list. Once 3 clips are rated Good or better, a trend for catch lean, layback and overall, from those clips only, with the margin of error. |
| Organising | Filming date, boat, seat and measured rate, plus an optional short note. No outings. |
| Compare two clips | Not in the first version. |
| Consent | No parental consent flow and no teammate declaration in this preview. Both are parked until under-18s are considered. |
| After 30 days | Scores only. Video, frames and joint positions are deleted, so that clip's frame viewer stops working. |
| Training use | Uploaded clips may be used for training. The owner tells testers in person. No notice in the app. |
| Training footage | A "Keep for training" button on the admin page copies a chosen clip to a private store, outside the 30-day deletion. All other clips are deleted on time. |
| Look | Chosen in two mock-up rounds and recorded in `DESIGN.md`: option B, black and green. |
| Custom colours | Athletes can change the ground and highlight colours, starting from the club greens (#116). |
| Bad results | "Something wrong?" on each result: a short form saved with the clip and listed for the admin. |
| Hosting | No monthly cost: Vercel free, Supabase free for accounts and scores, Cloudflare R2 for videos, Gmail for email, and the home PC as worker. Decided 7 November 2026. |
| Video after the change | Once the free hosting issues are built, video is kept 7 days, not 30. Athletes save up to 4 frames with limb lines, kept with the scores. If none are picked, a catch and a finish frame are saved. |

**Defaults taken, owner told:** setup remembers last boat, side and seat, and is filled in during upload. Uploads resume after a drop. Reruns with a changed setup reuse the kept section. Waiting shows queue position and rough time left, with cancel. A failed analysis retries once. Home is the clip list. No sharing or export. Athletes can delete any clip, and account deletion removes everything. Each video shows days left. Whole-crew analysis stays off. Hosted services use EU regions.

**Further defaults, approved with the plan:**
- A new section of the same video means a new upload, as only the chosen section is kept.
- The filming guide is a public page, so an athlete can send it to whoever films from the launch.
- Installable, with no offline mode.
- AWS CDK stacks are dropped. Hosting will not be on AWS, so milestone 6's infrastructure becomes Docker Compose, Supabase config and a deployment guide.
- If someone asks to be removed, their training copies are deleted too.

## How it works

1. The athlete picks a video. The browser shows it from the phone, and the upload starts straight away.
2. While it uploads, they choose a section if the clip is over 60 seconds, tap themselves on a clear frame, and fill in boat, side, seat and note.
3. The job joins the queue when the upload finishes.
4. The worker makes the working copy, finds boats, uses the tap to choose the rower, measures them, and saves the result.
5. The athlete gets an email and opens the results page.

**Key technical choices**

- **One working copy.** The worker cuts the section to H.264 at full size, with rotation baked in, short keyframe gaps and exactly one output frame per decoded frame, re-timed to a constant rate. Analysis and viewing both use this file, so overlays line up by frame number on any browser. The upload is deleted once the copy exists. Issue 0.7 proves this first. If stepping fails on phones, the viewer design changes before anything is built on it.
- **Accuracy check on that copy.** Real clips must score the same through the working copy as from the original, within noise, before it is merged.
- **Results are split.** Summary numbers go in Postgres and are kept. Per-frame poses and angles go in Storage and are deleted at 30 days.
- **Worker in `services/worker`.** It connects outward only, so no router changes are needed. It uses a Postgres queue with `FOR UPDATE SKIP LOCKED`, leases and a heartbeat, so a crash or power cut puts the job back in the queue.
- **Missed tap.** The job pauses and asks. On resume it reruns scouting instead of saving `Scouting`, which is simpler and only costs time in a rare case.
- **Deletion does not depend on the home PC.** The 30-day job runs on the database side, so it still happens when that PC is off.
- **3D model.** `pose_at` (200 lines of Python) is ported to TypeScript, checked against fixtures generated from the Python. This removes the need for `/api/reference`.
- **Version on each result.** `code_version()` is stored with the result instead of being used to hide it.
- **Tests without footage.** CI generates numbered clips with ffmpeg and uses a fake pose backend. Real clips stay local.

**Risks**

- Moving `results.py` and adding the GPU option both change `code_version()`, which hides the preview's saved results until clips are rerun. Both changes go in together so there is one rerun, and the batch only runs when the owner is not analysing.
- Timings are estimates from one clip. No full run from drop to result has been timed.
- The GTX 1650 is untested. On CPU alone that PC is estimated at about 11 minutes for a 32-second clip.

## Reuse

| Existing | Becomes |
|---|---|
| `services/vision/rowvision` | The engine, unchanged in behaviour. Adds a device setting in `pose.py:26` |
| `apps/preview/.../jobs.py` | Worker logic: `Settings.parse`, `_run`, `_watched`, `Cancelled`, `code_version` |
| `apps/preview/.../results.py` | Moves into the engine, shared by preview and worker |
| `static/logic.mjs` and `tests/logic.test.mjs` | TypeScript module with the same 71 behaviours |
| `static/panel.mjs`, `app.mjs` | React components for results and viewer |
| `static/model.mjs`, vendored Three.js | Lazy-loaded 3D reference model |
| `static/style.css`, `DESIGN.md`, Rubik | Design tokens and base styles |
| `apps/preview/tests/fakes.py` | Basis for the worker's fake backend |
| `apps/preview` | Stays as the local labelling tool |

## GitHub issues

One milestone per stage, about 70 issues. Each issue has why, what to build, what to reuse, done-when criteria, tests and dependencies. Labels: `design-review` (owner signs off before building), `owner-action`, `spike`, `parked`.

Each stage with new screens starts with a design issue. These use the same pick-and-refine format as the look and feel rounds below: several options for the screens in that stage, on phone and laptop, repeated until the owner is happy.

**Stage D: Look and feel rounds** (comes first, and no web screen is built until it is signed off)

The owner chooses the look by picking from mock-ups, over as many rounds as it takes. `DESIGN.md` is a starting point, not a fixed answer, and its colours can change.

- Every round is a private gallery page of clickable mock-ups, using drawn placeholders for rowers and footage. No real footage or frames appear.
- Each option shows the same key screens on phone and laptop, so options compare fairly: sign-in, clip list, add a video, results and frame viewer.
- Every option has its own colour palette, and all must pass the readable contrast rule. Colour never carries meaning alone.
- D.1 Round 1: about 6 clearly different directions in layout, colour and feel, including one based on the current design. The owner picks favourites and says what to mix.
- D.2 Round 2: about 4 variations on the favourites, with mixed parts combined.
- D.3 Round 3 onwards: fine tuning of colours, type, shapes and spacing, including colour swaps side by side. This repeats until the owner is happy.
- D.4 Record the final choice in `DESIGN.md` as tokens. `apps/web` is built from these.

**Stage 0: Foundations**
- 0.1 Record the plan and decisions in `docs/`, and update `PRODUCT.md` and the stale `.gitignore` comment
- 0.2 Scaffold `apps/web`: Next.js, TypeScript, ESLint with jsx-a11y, Vitest, one pinned Node version, with design tokens, font and icons from D.4
- 0.3 Local Supabase on ports 544xx (never touching 54321 to 54324), CLI as a dev dependency, 6-digit code email template
- 0.4 Schema, row-level security, storage buckets and database tests, including that one user cannot reach another's data
- 0.5 Compose stack and `/api/health?deep=1`
- 0.6 CI for web, database and worker, and extend the footage guard to image files
- 0.7 Spike: prove the working copy and frame-exact stepping on iPhone, Android and laptop

**Stage 1: Accounts**
- 1.1 Design: sign-in, app shell and admin page
- 1.2 Email-code sign-in and sessions
- 1.3 Approved email list, enforced by the before-user-created hook, with a clear turned-away message
- 1.4 Admin role and email list page
- 1.5 App shell, profile, settings and sign out

**Stage 2: Add a video**
- 2.1 Design: the add-a-video flow
- 2.2 Resumable upload with progress, resume after a drop, and a keep-this-page-open message
- 2.3 Check on real phones that picked files keep their full size
- 2.4 Checks on pick: length, size and the compressed-copy warning
- 2.5 60-second section picker
- 2.6 Tap yourself: frame picker with zoom, using the local file, with stills after upload as the fallback
- 2.7 Setup form with boat, side, seat and note, carrying over the `Settings.parse` rules and remembering the last setup
- 2.8 Submit a job, enforcing the 2-waiting limit

**Stage 3: Worker and waiting**
- 3.1 Design: waiting, paused, needs-a-tap and failed screens
- 3.2 Move result shaping into the engine, and create the worker package, Docker image and fake backend
- 3.3 Queue: fair claiming, leases, heartbeat, crash recovery, retry once, cancel
- 3.4 Working copy step: cut, normalise, stills, metadata, filming date, delete the upload
- 3.5 Analysis step: tap, boat and rower, progress, saving results with their version
- 3.6 Missed tap: pause, ask and resume, reusing the boat picker
- 3.7 GPU option, GPU Docker image and benchmark on the home PC
- 3.8 Status screen: queue position, rough time left, stage, cancel, plain failures, paused notice
- 3.9 Result-ready email
- 3.10 Admin queue, worker last seen, and failures
- 3.11 Spike: run YOLOX and RTMPose in a browser with ONNX Runtime Web on the owner's phone and laptop, using a generated clip. Report speed, heat, memory and how far the outputs differ from the server's. Build nothing further until the owner has seen the numbers

**Stage 4: Results and viewer**
- 4.1 Design: results page and viewer
- 4.2 Port `logic.mjs` to TypeScript with its tests
- 4.3 Results summary: rating, hidden overall with warning, phases, measures, timing, warnings, film closer
- 4.4 Work on next: ranking, wording and filming advice on Poor
- 4.5 Frame viewer core: frame-exact video, limb lines, angles, target marks, stroke lane
- 4.6 Freeze frames and evidence for each measure
- 4.7 Laptop viewer: keys, zoom, follow, resize handle
- 4.8 Phone viewer: full screen, sideways, touch controls
- 4.9 3D reference model and `pose_at` port
- 4.10 "Something wrong?" form and admin list

**Stage 5: History**
- 5.1 Design: clip list and trend
- 5.2 Clip list home, with filming date, boat, seat, rate, rating, score, status and notes
- 5.3 Older-version label, and rerun with a changed setup
- 5.4 Trend from 3 clips rated Good or better, with the margin of error

**Stage 6: Data and privacy**
- 6.1 30-day deletion, days left, and the scores-only results page
- 6.2 Delete a clip and delete an account
- 6.3 Admin opens any clip and result, with an access log
- 6.4 Keep for training: private store, outside deletion, export to the labelling tool, removal on request
- 6.5 `docs/privacy.md`: what is stored, where and for how long

**Stage 7: Onboarding**
- 7.1 Design: filming guide and first run
- 7.2 Public filming guide: side-on, rower large in frame, at least 10 strokes, camera on the blade side, send the original rather than a WhatsApp copy
- 7.3 First-run flow and empty states
- 7.4 Installable app
- 7.5 Interface review on every screen with the impeccable skill, fixing what it finds

**Stage 8: Delivery**
- 8.1 Cucumber acceptance tests against running containers
- 8.2 Playwright tests on desktop and mobile, with axe accessibility checks
- 8.3 Final CI order, with reports on failure
- 8.4 Real clips end to end, timed from drop to result, comparing all clips
- 8.5 Home worker setup guide: Docker, drivers, disk encryption, automatic restart, remote access
- 8.6 Deployment guide for database, web host and email sender, with nothing deployed
- 8.7 README, decision records and runbook

**Parked: Before juniors** (not started until the owner chooses): parental consent, teammate declaration, safeguarding review and legal review.

**Parked: Later:** coach accounts, coach review of targets and drills, compare two clips, per-stroke chart, pay-per-clip worker, name and model weight licence checks before commercial use.

Issue #7 stays open as it is.

## Verification

Each issue carries its own tests. The whole app is finished when:

- `docker compose up` gives a clean start and `/api/health?deep=1` is healthy.
- All suites pass in CI: lint and types, web unit, vision, worker, database security, Cucumber, and Playwright with axe on desktop and mobile. Real results are reported, including failures.
- Locally, a real clip goes through the browser from picking a section and tapping the rower to the email and results, with frame stepping checked by eye on rendered frames at phone and laptop sizes.
- All clips are compared before and after any change to tracking, scoring or the working copy.
- A second user cannot reach the first user's clips or results, an unapproved email cannot sign in, and each admin view is logged.
- With the clock moved forward 30 days, video and joint positions are gone, scores remain, and a clip kept for training is untouched.
- Killing the worker during a job puts it back in the queue, and it finishes after restart.

# RowVision 0.2.0 installer test: findings from one 8+ clip

Date: 2026-11-20. Written for review on another machine, so it is long and says where each claim comes from.

**What this is.** A fresh Linux laptop, RowVision 0.2.0 downloaded from rowvision.app, one 8+ clip analysed whole-crew with the real engine on CPU. The tester reported that the frame viewer could step back but not forward, that seats were swapping, that the stroke seat was reported as "only tracked for part of the video" when the rower was plainly in shot, and that some limbs drawn on the picture were obviously wrong. I went through the saved results and the video to check each of those and to look for anything else inconsistent.

**What this is not.** No code was changed. I did not re-run the engine, so where the cause of a tracking failure is not visible in the saved results it is marked as a hypothesis, with a way to test it.

Nothing from the clip itself (frames, keypoints, the video) is in this repository, as the README requires. Numbers, frame indices and short descriptions only. `clip_audit.py` in this folder reproduces every table below from the clip's folder.

---

## 0. Summary

| # | Finding | Severity | How sure |
|---|---|---|---|
| F1 | The frame viewer's label lags the picture by one frame on 48% of frames, so **Forward 1 gets stuck while Back 1 works**. Cause found, one-line fix tested in simulation. | High | Reproduced by simulation on the real file's timestamps. Matches the tester's screenshots exactly. Not yet run in a browser. |
| F2 | The stroke seat (8) has **no pose in 716 of 1793 frames (40%), mostly in the first 620, although the rower is in shot and clearly visible** (frames 0, 33, 500 checked by eye). Coverage 60.1% overall, 10.8% and 21.9% in the first two shots. | High | Data plus pictures. Cause undetermined. |
| F3 | Where seat 8 *is* tracked before about frame 1060, it is **the wrong person**: a rower in the other boat (frames 290–333) and the real seat 7 (run 620–921, checked at frames 689 and 800). The stroke seat is correctly followed only from about frame 1060 to the end (checked at 1100, 1300, 1500, 1750). | High | Data plus pictures. |
| F4 | **Seat labels shift by one or two seats** near the stroke end and at the start: frame 0 ("2" on the seat 4 rower), frame 33 (seat 3's skeleton split across two rowers, seat 4 missing), frame 689 ("7" on a far-boat rower), frame 800 ("7" on the real 6, "8" on the real 7). Seats 1–5 are clean from about frame 35 on. | High | Pictures, backed by jumps and spacing in the data. |
| F5 | **Seat 8's reported results blend three different people.** Of its 24 strokes with a catch angle, 7 come from the real seat 7 (mean 24.0°), 2 are 44–47° outliers from the far-boat run and a 2-frame run, and only 15 are the real seat 8 (mean 30.5°). The headline "catch lean 29.8°" is that mixture. | High | Data. Run identities from pictures. |
| F6 | The first catch (frame 34) sits in a **tracking start-up window** (tracks begin at frames 30–35, with jumps at 28, 32, 33). The viewer jumps to that catch first, so the first thing seen after switching rower is the least reliable frame. | Medium | Data plus pictures. |
| F7 | Far-boat rowers are being picked up in seats 6, 7 and 8 (the problem described in closed issue #217), for roughly 40–85 frames each. | Medium | Pictures at two frames, plus height and size outliers. |
| F8 | The model cannot tell left from right limbs at this size (the two knees sit within 0.35 trunk of each other in 86–96% of frames), yet the overlay draws them as separate limbs. Far-side joints have lower confidence. This is what the "inside knee" and "outside shoulder" screenshots show. | Medium | Data. |
| F9 | The knee **number** is blanked when the leg is anatomically implausible, but the knee is still **drawn** unless the camera estimate is 25° or more off side-on. The two checks do not agree. | Medium | Code plus data. |
| F10 | The camera-angle estimate splits into two clusters (about 21° and about 36°) on footage that looks the same by eye, and 41% of frames sit in shots called "oblique" because of it. It is computed from left/right shoulder separation, which `view.py` itself says is unreliable near side-on. | Medium | Data and code. True camera angle not measured. |
| F11 | **Timing is shared across the crew, not measured per rower.** Every seat has identical catch and finish frames, the per-stroke drive time takes 3 distinct values across 38 strokes, and seat 8 gets timing for 14 strokes in which it has no pose at all. | Medium | Data. |
| F12 | The **accuracy rating cannot see identity errors**: seats 6 and 7 carry wrong-person frames yet are "Great" (84, 87) with no warnings. Seat 8 shows "Good" with no overall score. | Medium | Data. |
| F13 | Only the first 60 s of a 66.2 s clip was analysed. `engine.log` is empty. | Low | Data. UI wording not checked. |
| F14 | The 0.2.0 installers are served from R2, not GitHub, and no `v0.2.0` tag exists, so they probably did not pass through the CI smoke test in `installers.yml`. | Low | Inference. |

**On hand labelling more frames:** not yet, and not in the form the current tool takes. See section 9.

---

## 1. What was tested

| | |
|---|---|
| App | RowVision 0.2.0, Linux build from rowvision.app/download (`/get/deb` redirects to `downloads.rowvision.app/RowVision-0.2.0.deb`, 303.5 MB; the AppImage is 358.6 MB). Installed under `/opt/RowVision`. |
| Clip | A phone clip: HEVC, 2336×1080, 1978 frames at 29.8836 fps (66.2 s), 332.8 MB. A 60 s working copy (1793 frames) was analysed. |
| Setup | 8+, scope **whole crew**, coach mode on, rig bow/stroke alternating from seat 1, followed seat **8** (stroke side), engine `real`, device CPU, priority normal. |
| Run | Started about 17:36, results written about 17:49, so around 13 minutes. `engine.log` is 0 bytes. |
| Footage | Filmed from the side of the water, rowers about 52–62 px of trunk each in a 2336 px wide frame. Two crews: the near boat (white hull, 8 rowers and a cox beyond the stroke) and a second 8 in a yellow boat behind it, in the same frame for the whole clip. The camera zooms out over the first second and pans along the boat. |
| Where the data lives | `~/.config/RowVision/clips/<clip id>/`: `summary.json`, `frames.json` (poses and angles for every seat and frame), `working.mp4` (321 MB), `video.json`, `job.json`, `clip.json`. |

The tester's three screenshots map to the data as follows. This was done by matching the on-screen readouts to each seat's saved angles.

| Screenshot | Viewer frame | Seat shown | Readouts | What the data says |
|---|---|---|---|---|
| 1 | 33 | **3** | Body 18°, Knee —, Elbow 28° | The skeleton is split across two rowers (see F4, F6). An elbow of 28° at the catch is impossible. Next frame the same seat reads trunk 20°, knee 73°, elbow 175°. |
| 2 | 221 | **6** | Body 26°, Knee —, Elbow 151° | The knee number is suppressed as unreadable, but a leg is drawn anyway (F8, F9). |
| 3 | 33 | **5** | Body 19°, Knee 70°, Elbow 173° | The numbers are plausible. The drawn shoulder points sit high on the back, near the neck (F8). |

---

## 2. F1: why Forward 1 gets stuck and Back 1 does not

This was the tester's first question, and it has a definite answer.

### What the code does

`apps/web/app/clips/[id]/viewer.tsx` (shared by the web app and the desktop app):

- `goTo(target)`, lines 55–60: pauses the video and sets `currentTime = (target + 0.5) / fps`.
- Lines 62–83: the frame number shown, and the frame whose pose is drawn, comes **back from the video**, not from the target: `setFrame(clampFrame(Math.floor(seconds * fps + 0.01), frames))` (line 66), fed by `requestVideoFrameCallback`.
- Forward 1 is `goTo(frame + 1)` and Back 1 is `goTo(frame - 1)` (lines 294–298; arrow keys at 148–149).

So the viewer assumes that the picture for frame N has a timestamp of N / fps, with only 0.01 frame of slack.

### What the video actually contains

`working.mp4` is made by `services/worker/rowvision_worker/media.py` `copy_command` (line 70 on): `settb=expr=1/fps,setpts=N` into libx264 and mp4. The clip's fps is 29.8836. Something in the encode or mux step (I did not trace which) snaps the timestamps onto a 1/30 s grid, in a 1/15360 s time base:

```
timestamp spacing in 1/15360 s ticks: {512: 1778, 768: 14}
   512 ticks = 1/30 s      768 ticks = 1/20 s
```

So the file is 1778 steps of 33.3 ms and 14 steps of 50 ms, averaging 29.88 fps. There is no cumulative drift (last frame at 59.9667 s against 59.9661 s ideal). But each frame's timestamp is up to **0.248 of a frame early or late** against N / fps. Whenever a frame's timestamp lands slightly early, `floor(t * fps + 0.01)` gives N - 1.

### The result

| | Today (`floor(t*fps+0.01)`) | Proposed (`round(t*fps)`) |
|---|---|---|
| Frames whose label is not their true number | **864 of 1793 (48%)** | 0 |
| Starting labels from which Forward 1 does not advance | **864 of 1790** | 0 |
| Starting labels from which Back 1 does not retreat | 0 | 0 |

The mechanism: the viewer is showing true frame N but reads it as N - 1. Forward 1 asks for N - 1 + 1 = N, which is the frame already on screen, so nothing moves and the label stays N - 1. Back 1 asks for N - 2, which is a real move, so Back always works. After the first successful Back the viewer is often on a frame that reads correctly, so Forward then works again, until it lands on another lagging frame.

This is exactly the tester's situation. The viewer jumps to the first catch (frame 34). The picture is frame 34, but the label reads **33**, which is what both screenshots show, and without the "Catch," prefix, because 33 is not in the catch list. Pressing Forward from there:

```
jump to first catch 34 -> picture frame 34, label 33
5 presses of Forward 1 (true frame, label): [(34,33), (34,33), (34,33), (34,33), (34,33)]
```

### Other effects of the same lag

- The overlay is drawn from `poses[label]`, so on 48% of frames the skeleton is one frame behind the picture. At 30 fps, one frame is small, but at the catch and finish it is enough to look off.
- Catch and finish markers ("Catch, frame N") and the jump buttons use the same label, so they are off by one on those frames.
- The same mapping feeds the angle read-out and `viewOf(scene, frame)` for the camera estimate.

### Why the tests did not catch it

`apps/desktop/tests/app/fixture.ts` uses `FPS = 30` exactly, 90 frames, with `-g 30 -bf 2`. At exactly 30 fps every timestamp is N / 30 and the formula is exact. Real phone footage is almost never exactly 30. The test "the viewer shows exactly the frame it says, stepping either way" (`app.spec.ts:142`) is the right test, but with the wrong fixture.

Open issue #168 ("Journey browser test sometimes misses the jump to the catch") is a flaky test that expected "Catch, frame 30" and saw "Frame 0 0:00". It is probably a different, timing-related cause, so I would not assume it is the same bug, but it is in the same code path and worth re-checking after the fix.

### Suggested fix

1. In `viewer.tsx:66`, use `Math.round(seconds * fps)` instead of `Math.floor(seconds * fps + 0.01)`. Deviations are at most 0.248 frames on this file, so rounding is safe up to 0.5. I tested this on the real timestamps (table above): no mislabelled frame, no stuck step in either direction.
2. Add a fixture at a non-integer rate (29.88 and 29.97) to `fixture.ts` and make the stepping test loop over it.
3. Longer term, `media.py` could write the real per-frame times into `video.json`, so neither side has to assume a constant rate.

Not yet verified: the simulation assumes Chromium shows "the frame in effect at the requested time" after a seek. That is the documented behaviour and it reproduces the tester's label (33) and symptom precisely, but I have not run it in Electron.

---

## 3. F2, F3, F4: tracking and seat identity

### 3.1 Coverage

Share of frames in which each seat has any pose:

| Seat | All | side_on 0–325 | oblique 325–690 | side_on 690–1420 | oblique 1420–1793 |
|---|---|---|---|---|---|
| 1 | 98.2% | 90.8% | 100% | 100% | 99.5% |
| 2 | 99.9% | 100% | 100% | 100% | 99.5% |
| 3 | 98.2% | 90.8% | 100% | 100% | 99.5% |
| 4 | 97.9% | 89.2% | 100% | 100% | 99.5% |
| 5 | 98.2% | 90.8% | 100% | 100% | 99.5% |
| 6 | 92.1% | 100% | 100% | 81.0% | 99.5% |
| 7 | 99.9% | 100% | 100% | 100% | 99.5% |
| **8** | **60.1%** | **10.8%** | **21.9%** | 81.0% | 99.5% |

Seat 8's tracked runs (frames) and gaps:

```
tracked: (290,333) (355,357) (620,921) (1060,1791)
gaps:    (0,290)  (333,355)  (357,620)  (921,1060)  (1791,1793)
```

That is 716 frames (40%) with no pose for seat 8: 290 + 22 + 263 + 139, plus the last 2. The "only tracked for part of the video" warning is therefore true as far as it goes. What the tester disputed is the implication that the stroke rower was out of shot, and the pictures bear the tester out.

### 3.2 What the pictures show

I drew each seat's skeleton and number on the video frame and looked at it. Eleven frames in all:

| Frame | Seats with a pose | What the picture shows | Verdict |
|---|---|---|---|
| 0 | 2, 6, 7 | Camera zoomed in: six rowers (seats 3–8 counting back from the cox) and the cox. Seat 8 (next to the cox) is large and clear. | "2" is on the rower who is seat 4. "6" and "7" are right. **Seat 8 missing.** |
| 33 | 1, 2, 3, 5, 6, 7 | All eight rowers in view. | Seat 3's skeleton is split across rowers 3 and 4. **Seat 4 missing.** **Seat 8 missing** (in view beside the cox). |
| 300 | 1–8 | Whole near boat in shot. | 1–7 on the right rowers. **"8" is on a rower in the far boat.** The real stroke has no skeleton. |
| 500 | 1–7 | Whole boat in shot, stroke beside the cox. | 1–7 right. **Seat 8 missing.** |
| 689 | 1–6 and "7", "8" | Near boat plus far boat behind. | **"7" is on a far-boat rower. "8" is on the real seat 7.** Real seat 8 has no skeleton. |
| 800 | 1–5, 7, 8 | Stroke at the right edge, partly out of frame. | **"7" is on the real seat 6, "8" on the real seat 7.** No seat 6 at all. Stroke untracked. |
| 1000 | 1–7 | Boat running off the right edge. | Seat 8 absent. This one is genuine: the stroke is out of shot. |
| 1100 | 1–8 | Stroke at the right edge but visible. | All correct. |
| 1300 | 1–8 | | All correct. |
| 1500 | 1–8 | | All correct. |
| 1750 | 1–8 | Boat small, far boat overlapping behind. | All correct. |

So seat 8 is genuinely out of shot for part of 690–1060, but **not** in the first 690 frames, where it is untracked in 78–89% of frames.

### 3.3 The shape of the swapping

Position data agrees with the pictures. For the neighbours of the stroke end (frames where both are tracked):

```
seats 5->6: out of order   0 | too close   0
seats 6->7: out of order  15 | too close  52
seats 7->8: out of order   6 | too close  75      (too close = under half the usual 172 px)
```

Seats 1–5 never swap or double up after the start. Everything wrong is at the stroke end. Centre jumps of more than 1.5 trunks between consecutive frames:

```
seat 1: [32]   seat 2: [28, 32]   seat 3: [33]   seat 4: none   seat 5: none
seat 6: [733]  seat 7: [643, 921]                 seat 8: [641]
```

Seat 7 is "tracked" from frame 0 to 1791 without a break, but jumps at 643 and 921. Reading the pictures alongside, **the seat 7 track passes through at least three different people between frames 640 and 925**: the real seat 7, a far-boat rower (frame 689), and the real seat 6 (frame 800). I have not checked every frame in between.

Seat 8's run at 290–333 is the far boat (frame 300, checked). Seat 8's run at 620–921 sits on the real seat 7 at the two frames checked (689, 800); the 641 jump at its start fits. It is possible that a short stretch inside it is right, which I did not check.

### 3.4 Far-boat intrusion

Frames where a seat's body centre is more than one trunk length above or below the crew's median height (the other boat sits clearly higher in the picture):

| Seat | Height outliers | Runs of 3+ frames |
|---|---|---|
| 1–5 | 0 | none |
| 6 | 52 | 734–786 |
| 7 | 83 | 644–728 |
| 8 | 69 | 290–333, 620–642 |

(The separate "trunk under 70% of the clip median" test also flags seats 1–4 in frames 1671–1791. I looked at frame 1750 and it is correct; the boat is receding so everyone shrinks. Treat those as not confirmed.)

This is the failure that closed issue #217 describes ("seats 1, 4 and 6 sit on rowers of the far crew for parts of the clip"). The fix for #217 (#219) separated the two crews into boats at the grouping step. On this clip the grouping seems to have worked, since seats 1–5 stay on the near boat for the whole clip, but individual far-boat tracks still get pulled into seats at the stroke end.

### 3.5 Start-up window (F6)

Seats 1, 3, 5 start at frame 30, seat 4 at 35, and only seats 2, 6, 7 have a pose at frame 0. The camera is zooming out over those frames (rower spacing roughly halves between frames 0 and 33). Centre jumps at 28 (seat 2), 32 (seats 1, 2), 33 (seat 3) are tracks settling.

The first detected catch for every seat is frame 34. The viewer opens on the first catch, so after switching rower the viewer lands on:

- frame 33/34, the first frame in which most seats have a pose at all;
- a frame where seat 3 is a chimera (frame 33) or only just recovered (frame 34);
- with the label lagging (F1), so it shows pose[33] over picture 34.

Whether frame 34 is a true catch, or just the first place the detector could put one, is worth checking: the catches run 34, 80, 126, 172, ... about 46 frames apart, and the first is at the point where the poses begin.

Frame 33 against 34 for the three seats in the screenshots:

```
seat 3 frame 33: trunk 18  knee —   elbow  28   L-R shoulder sep 0.76 trunk   scores .34-.57
seat 3 frame 34: trunk 20  knee 73  elbow 175   L-R shoulder sep 0.06 trunk   scores .66-.74
seat 5 frame 33: trunk 19  knee 70  elbow 173
seat 5 frame 34: trunk 20  knee 70  elbow 172
```

In the zoomed render of seat 3 at frame 33 the shoulders, hip and elbow are on seat 3, and the knee and ankle are on the rower beside. Confidence is low throughout (0.34–0.57). That is the "bad first frame" in screenshot 1.

### 3.6 Why: code pointers and hypotheses

I could not tell from the saved results which stage dropped or mislabelled seat 8, because the poses the engine blanks (`_leave_out_cox` writes NaN) are gone by the time they are saved, and `engine.log` is empty. The pipeline, as I read it:

1. `scout` (`pipeline.py`): coarse pass on every 5th frame (`COARSE_STEP = 5`), `track_people` and `_stitch` (`tracking.py:190, 229`), `side_changes`, `find_boats` (`boats.py:501`, `_boat_groups:379`).
2. `_crew_to_measure` picks one shot's crew. `_seats_of` (`pipeline.py:522`) fits that crew to seats with `fit_to_seats` (`boats.py:225`), then `fill_from_spare` (`boats.py:288`) brings in "spare" tracks seen at the same time as a rower, then `assign_seats` (`seats.py:118`).
3. `_leave_out_cox` (`pipeline.py:478`, helpers in `cox.py`) blanks the bow and stroke seat on frames where the person is facing the wrong way (`facing_backwards`) or sits more than 1.7 usual seat spacings from their neighbour (`beyond_neighbour`).

Hypotheses, in the order I would test them:

| | Hypothesis | For | Against |
|---|---|---|---|
| H1 | The stroke rower's track is never created, or is lost, in the coarse pass. Their box overlaps the cox and, when the camera pans, the edge of the frame. | The missing frames are exactly when the stroke is beside the cox. | In the first shot the stroke is large and fully in shot (frame 0, 33, 300, 500). |
| H2 | Seat 8 is then **filled from spare tracks** (`fill_from_spare`), and the spare includes far-boat rowers because they are "seen together" with a near-boat rower. | Explains the far-boat run (290–333) and why the missing seat is not simply empty. | Needs a log to confirm which tracks were spare. |
| H3 | Seats are **numbered along the boat from the bow end among the tracks present**, not anchored to the stern or cox. With the stroke absent the last present rower is given seat 8, so labels shift by one (frames 689, 800). | Matches the one-seat shift in both pictures. | `fit_to_seats` and the `#212` repair ("seats are now kept in their place along the boat") were meant to prevent this. |
| H4 | `_leave_out_cox` blanks the stroke seat because `facing_backwards` fires on a stroke seat rower turned slightly towards the cox. | The code comment says exactly this is what it is for. | The stroke here faces the same way as the crew in every picture I looked at. |

Suggested test: run the engine on this clip from a checkout (`apps/desktop/scripts/dev-engine.sh`), and write out, for each coarse frame, the track ids, their box centres and sizes, the boat each belongs to, the `fit_to_seats` output, the spare tracks, and the `_leave_out_cox` mask for seats 1 and 8. That would settle H1–H4 in one pass.

### 3.7 Design note on "label by position, count only when in frame"

The tester's expectation was that every rower is labelled by their position in the boat and counted only while in frame. The data shows the tracking *does* record absence as nulls, so the second half works. What does not work is the first: position labels are being decided per shot from whichever tracks are present, without an anchor. Things that would pin them down, in rough order of effort:

- Anchor to the **cox and the hull**, not to the first rower on screen. The cox is in shot whenever the stern is, and the stroke seat is the rower next to them.
- Reject a track for a seat when it is more than about one trunk higher or lower than the rest of the crew (cheap, and removes the far-boat runs above), or smaller than about 70% of the crew's median trunk at the same moment.
- Reject a seat's track when it sits closer than half the usual spacing to its neighbour (the 75 "too close" frames at seats 7→8).
- Require the order of seats along the boat to stay monotonic and the spacing roughly constant, and re-derive it from the whole crew each frame instead of per track.
- Use appearance (a colour histogram of the torso) as a tiebreaker. Kit often differs between rowers in a crew, so it would help most exactly where position is ambiguous.

---

## 4. F5: what the "seat 8" numbers are made of

Seat 8's strokes, grouped by which tracked run holds the catch frame:

| Run holding the catch | Strokes | Catch lean (mean, sd, n) | Finish lean (mean, sd, n) | Who it really is |
|---|---|---|---|---|
| no pose at the catch | 14 | — | −14.1 (1) | nobody |
| 290–333 | 1 | 43.8 (1) | — | **far boat** |
| 355–357 | 1 | 46.7 (1) | — | a 2-frame track, not checked |
| 620–921 | 7 | **24.0**, 3.3 (7) | **−20.5**, 1.9 (6) | **real seat 7** (frames 689, 800) |
| 1060–1791 | 15 | **30.5**, 2.6 (15) | **−28.4**, 6.8 (15) | real seat 8 |
| (seat 7, all strokes, for comparison) | 38 | 21.8, 3.4 | −23.3, 7.4 | |

The mean of the 24 catch-lean values is (43.8 + 46.7 + 7×24.0 + 15×30.5) / 24 = 29.8°. The card shows **29.78°** with a spread of 6.1°. So:

- The **29.8° "catch lean" is the average of seat 7's strokes, two outliers from other people, and 15 real seat 8 strokes.** The real seat 8 value is closer to 30.5° with a spread under 3°.
- The card marks **finish lean "Too inconsistent from stroke to stroke to trust"** (value −25.6°, spread 11.5°). The spread of seat 8's real strokes alone is 6.8°. The 11.5° includes seat 7's −20.5° and the far-boat strokes, so the inconsistency the app reports is at least partly the app mixing people.
- The fade figures, the stroke-by-stroke view and the timing against seat 8 are computed from the same strokes, so I would assume they carry the same mixture.

Other things on seat 8's row that do not add up:

- `overall` is **null** in `crew_summary` while `band` is "Good", and `leader_seat` is null. Seats 2, 4, 6 and 7 are timed against seat 8 as "leader" (screenshot 2: "Timing against seat 8").
- `rating.warnings` contains only "You were only tracked for part of the video". It says nothing about the wrong-person frames.
- `evidence.coverage` is 0.60. Without the far-boat run (43 frames) and the 2-frame run it is 0.58, and without the 301-frame run on the real seat 7 as well it is 0.41 (731 frames, 1060–1791).

---

## 5. F8, F9: the limbs drawn wrongly (screenshots 2 and 3)

### Left and right cannot be separated at this size

Mean keypoint confidence by side. The crew faces image-right, so the right-hand joints are nearer the camera and the left-hand ones are the far side (`view.py` makes the same assumption):

| Seat | Elbow L / R | Wrist L / R | Knee L / R | Ankle L / R |
|---|---|---|---|---|
| 3 | 0.65 / 0.74 | 0.64 / 0.73 | 0.64 / 0.66 | 0.58 / 0.60 |
| 5 | 0.61 / 0.73 | 0.59 / 0.72 | 0.60 / 0.67 | 0.52 / 0.60 |
| 7 | 0.57 / 0.72 | 0.54 / 0.71 | 0.57 / 0.65 | 0.48 / 0.57 |
| 8 | 0.61 / 0.70 | 0.58 / 0.70 | 0.55 / 0.61 | 0.45 / 0.50 |

Far-side arms are consistently less certain. Legs are uncertain on both sides: ankle scores are 0.45–0.63 everywhere, since the hull and the other rowers hide the feet (the code comment in `metrics.py:103` says as much).

Share of tracked frames in which the **left and right joint are within 0.35 trunk (about 19 px) of each other**:

| Seat | Knees | Shoulders |
|---|---|---|
| 1 | 88.5% | 50.3% |
| 2 | 90.6% | 28.9% |
| 3 | 85.7% | 54.5% |
| 4 | 91.4% | 40.0% |
| 5 | 95.5% | 66.8% |
| 6 | 90.1% | 45.1% |
| 7 | 88.7% | 64.7% |
| 8 | 90.3% | 54.3% |

So for roughly nine frames in ten the model puts both knees on top of each other, which is what a side-on view really looks like, but means any visible gap between the two drawn knees is noise, not a measurement. The overlay draws a left (cyan) and a right (magenta) limb regardless, so an offset between them reads as an obviously wrong knee or shoulder.

### What the two screenshots show

**Screenshot 2, seat 6, frame 221** ("inside knee"): L/R knee scores 0.58 / 0.50, L/R ankle scores 0.43 / 0.41, the two ankles 0.13 trunk apart, and the knee **angle is blank** (`Knee —`) for seat 6 at this frame. In my zoomed render the knee points sit in the right region, bunched together and low-confidence, so I cannot say from the render which one you consider wrong. The ankles are the weakest points. At frame 222 the scores drop again (knee 0.46 / 0.44, ankle 0.38 / 0.35).

**Screenshot 3, seat 5, frame 33** ("outside shoulder"): shoulder scores 0.64 / 0.67, the left and right shoulders only 0.17 trunk apart, and the knee, elbow and trunk numbers are all plausible (70°, 173°, 19°). In my render the shoulder points sit high on the back, near the neck, some way above where the near shoulder joint appears to be. That is a real placement error, but a modest one in the data, and the angle code partly averages it away by using the midpoint of the two shoulders. This one needs your eye on the 100% view. I may not be looking at the same joint.

### The knee number and the knee drawing disagree (F9)

- As I read it, the knee angle is gated on `legs_believable` (`metrics.py:103`), which checks anatomy on the near leg: the ankle must be below the hip by at least 0.02 trunk and the shin 0.5 to 1.7 times the thigh. If it fails, the angle is blank. Knee angles exist for only 1044 of seat 6's 1652 tracked frames (63%), 1377 of 1756 for seat 4 (78%), 792 of 1077 for seat 8 (74%).
- The overlay (`apps/web/app/clips/[id]/draw.ts:29`, `drawPose`) decides whether to draw the legs dashed (unsure) from `legsUnsure(viewOf(scene, frame))`, which is just `viewDeg >= 25` (`logic.ts:49, 55`). It does not look at `legs_believable`.

So a leg the engine has judged impossible can be drawn solid, as in screenshot 2, provided the per-frame camera estimate is under 25°. The fix is to save the per-frame believability flag in `frames.json` and have the overlay dash or hide those legs.

---

## 6. F10: the camera-angle estimate

`view.py` `estimate_view_deg` computes "how far from side-on" from the apparent shoulder width over trunk height. Its own docstring and constants say the left/right shoulder labels are unreliable near side-on ("Near side-on the model mixes up left and right, the two cancel").

Per-frame estimates by shot:

| Shot | Frames | Mean | Min | Max | Share above 25° |
|---|---|---|---|---|---|
| side_on | 0–325 | 21.1° | 15.1 | 25.4 | 3% |
| **oblique** | 325–690 | **34.9°** | 25.5 | 40.3 | 100% |
| side_on | 690–1420 | 21.5° | 17.5 | 26.3 | 4% |
| **oblique** | 1420–1793 | **36.7°** | 26.0 | 44.1 | 100% |

738 frames (41%) sit in shots labelled oblique, and 778 frames (43%) have an estimate above 25°. By eye the camera angle at frames 150 (side_on) and 500 (oblique) looks the same: boat roughly parallel to the picture, same spacing. I have not measured it, so I cannot say the 35° is wrong, but a camera 35° off axis would show visible foreshortening of the hull and the seat spacing, and I do not see that.

Why it matters:

- The per-frame view feeds `undo_foreshortening` and `forward_gain` in `metrics.py`, so, if I read `undo_foreshortening` right (I did not open it), a 36° estimate on a near side-on frame stretches horizontal distances by about 1/cos(36°) = 1.24 before the lean and elbow angles are computed.
- It sets the shot kinds, the "film side-on" advice, and the camera term in the accuracy rating (`reliability.py:114`).
- It is related to open issue #213, "Sweep rowers read differently on the two sides when filmed off side-on".
- The whole-clip number (`view_deg` 23.78°) is just under the 25° warning threshold (`reliability.py:29`), so the "camera is off side-on" warning did not appear, even though 43% of frames are estimated above it.

---

## 7. F11, F12: numbers that look measured per rower but are not

### Timing is crew-wide

- All 8 seats have **identical catch frames and identical finish frames** (39 catches, 39 finishes). `crew_timeline` in `pipeline.py` times strokes from the whole crew and shares the result, by design ("steadier than any one rower").
- Per-stroke `drive_s` has **3 distinct values** across 38 strokes, `recovery_s` 3, `drive_share` 7, `ratio` 7, the same for every seat. Those are a few whole frame counts (for example 24 or 25 frames of drive, 21 or 22 of recovery), not separate measurements.
- Seat 8 has drive and recovery times for **all 38 strokes**, including the 14 in which it has no pose.
- `crew_summary` catch and finish timing against the leader is always 0 or ±33.46 ms. 33.46 ms is exactly one frame at 29.88 fps. "In time" in the results page is therefore a statement that the shared catch frame is the same for everyone, which it is by construction, rather than a measurement. The page does say "Not scored, and good to about 50 ms", which is honest, but "Timing against seat 8" is shown for rowers using a seat 8 whose own tracking is mostly wrong.
- The rhythm score (screenshot 2: "Drive and recovery rhythm 80", "You 54%") is therefore the same for every rower in the crew.

### The accuracy rating cannot see identity errors

| Seat | Accuracy | Band | Coverage | Agreement | Overall score | Warnings |
|---|---|---|---|---|---|---|
| 1 | 85 | Great | 0.98 | 0.98 | 95 | none |
| 2 | 84 | Great | 1.00 | 0.95 | 91 | none |
| 3 | 78 | Good | 0.98 | 0.97 | 76 | none |
| 4 | 85 | Great | 0.98 | 0.95 | 83 | none |
| 5 | 89 | Great | 0.98 | 0.96 | 79 | none |
| **6** | **84** | **Great** | 0.92 | 0.95 | 69 | **none** |
| **7** | **87** | **Great** | 1.00 | 0.91 | 80 | **none** |
| 8 | 73 | Good | 0.60 | 0.86 | **null** | "only tracked for part of the video" |

- Seats 6 and 7 contain the wrong-person frames of section 3 and are rated "Great" with no warning. `rate()` in `reliability.py` works from trunk size, camera angle, stroke spread and coverage. A frame on the wrong rower counts as a good measurement.
- `band` is not a function of `overall`: seat 6's overall is 69 and its band "Great", seat 3's is 76 and "Good". The band comes from the accuracy figure, so a results table that shows both side by side will look contradictory.
- Seat 8 has a band and a rating but no overall score, while four other seats are timed against it.
- The accuracy figure is calibrated (`calibration.yaml`: 2.0 px, 108 labelled frames from 12 clips). The labelling tool has `MIN_SPAN_PX = 130` (`labels.py:24`). I did not read exactly what span that measures, but it implies larger rowers than the 52–62 px of trunk here. I have not measured whether the 2.0 px figure holds at this size.

---

## 8. Smaller things (F13, F14)

- **60 s cap.** `SECTION_SECONDS = 60` (`media.py:15`). The source is 66.2 s (1978 frames), so about 185 frames (6.2 s) at the end were not analysed. I did not check whether the UI says so.
- **`engine.log` is empty** (0 bytes) after a 13 minute run, so there is nothing to diagnose from after the fact.
- **Working copy timing.** The 14 longer frame gaps (50 ms) in `working.mp4` are the source of F1. Beyond the viewer, any code that turns a frame number into a time with `frame / fps` is correct to within a frame on average, but not per frame.
- **Release plumbing.**
  - `/get/deb` and `/get/appimage` redirect to `downloads.rowvision.app/RowVision-0.2.0.*` (Cloudflare R2), uploaded 16:45 and 17:06 UTC on 2026-11-20.
  - The only GitHub release is `1.0` "Production Website", with no assets. The only git tag is `1.0`.
  - `.github/workflows/installers.yml` runs on `v*` tags, a manual dispatch, or changes to the installer files. No `v0.2.0` tag exists. So I think these files were built by hand with `apps/desktop/scripts/build-installer.sh` and uploaded, rather than by CI. That is an inference, not something I checked. If true, the CI check "the installed engine runs a job with no Python and finds its own ffmpeg" did not run on these exact files. The tester's run is the first real test of them, and it did work end to end.
- **Disk.** The 60 s working copy is 321 MB (the sidebar shows 306 MiB), against 5.1 MB of scores and notes.

---

## 9. Should you hand-label another 100–200 frames?

**Not yet, and not the same kind of label.** Reasons:

1. **The biggest failures are not pose errors.** Missing stroke seat, far-boat rowers, labels shifted by a seat, and the viewer lag are tracking, association and viewer bugs. A pose model can be perfect and these still happen. Labelling joints does not touch them.
2. **What the labels do today is narrow.** `apps/preview/rowvision_preview/labels.py` labels the *midpoint* of each joint pair ("the centre of a joint pair, which is the point the analysis measures from"). That cancels left/right confusion, so it cannot see the "inside knee" and "outside shoulder" errors from the screenshots. The result goes into one number, `keypoint_error_px: 2.0` in `calibration.yaml`, which feeds the accuracy percentage. They do not train or fine-tune the pose model (`pose.py` uses stock RTMPose through rtmlib). More of the same labels would tighten one scalar.
3. **The labelled footage is probably a different size.** The tool has a 130 px minimum span (`MIN_SPAN_PX`) and takes about 9 frames per clip across 12 clips. This clip has 52–62 px of trunk per rower and seven neighbours in shot.

What I would do instead, in this order:

- **First**, fix the viewer lag (F1), then find out why seat 8 is lost (section 3.6) and anchor seat identity to the cox or hull. Re-run this same clip. That is a before-and-after test you already have.
- **Then, a different label set that targets what failed: who is who.** For perhaps 40 frames spread over 3–4 clips, click each rower and give a seat number. That is 8 clicks a frame, far quicker than joint labelling, and it measures the thing that is actually going wrong (does the seat number land on the right rower) with a number you can track from release to release. Include the start-up zoom, the frame edge, two-boat overlap, and a cox beside the stroke.
- **Then, if the pose model itself needs work**, label *per side* (left and right knee, shoulder, ankle separately) on small-rower footage like this clip, so you can find out whether far-side limbs are usable at all at 50–60 px. Fine-tuning RTMPose on 100–200 single-rower frames would be a small set. Eight rowers per frame, from several clips, is more useful: 100 frames then gives 800 skeletons.
- Keep the labels in the private folder, as the README requires. They cannot go on GitHub.

---

## 10. Suggested order of work

| Priority | What | Size | Why first |
|---|---|---|---|
| 1 | `viewer.tsx:66` to `Math.round`, plus a 29.88 fps fixture and the stepping test over it | Small | One line, verified in simulation, fixes the first thing any user will hit. |
| 2 | Run this clip through the engine with debug output of tracks, spare tracks, seat fit and the cox mask (section 3.6) | Small to medium | Needed to choose between H1–H4. |
| 3 | Seat identity: anchor to cox and hull, reject height, size and spacing outliers per seat, keep seat order monotonic | Medium | Fixes F2, F3, F4, F5, F7 together. |
| 4 | Do not count a stroke towards a seat unless that seat has a verified pose at its catch and finish. Show "not measured" for the rest. Stop reporting crew-shared timing as the rower's own. | Small | Removes the blended seat 8 numbers even before tracking is better (F5, F11). |
| 5 | Rating and warnings should react to identity problems (jumps, far-boat suspects, order violations), not only coverage | Small | F12 |
| 6 | Save `legs_believable` per frame and dash or hide legs the engine rejected | Small | F9 |
| 7 | Replace the shoulder-separation camera estimate with one that uses the boat's axis or the crew as a whole. Smooth it. | Medium | F10, and issue #213. |
| 8 | Write something to `engine.log`. Say in the UI when part of a clip was not analysed. Tag and build installers through CI. | Small | F13, F14 |

---

## 11. Method and limits

- Everything in sections 2–8 comes from the clip's saved results (`summary.json`, `frames.json`), the working video, and the source on GitHub. I read the code; I did not change or run it, apart from `ffprobe`/`ffmpeg` on the clip.
- I rendered the seat overlay onto 11 video frames (0, 33, 300, 500, 689, 800, 1000, 1100, 1300, 1500, 1750) and looked at each, plus zoomed crops of seats 3, 5 and 6 at frames 33, 34, 221, 222. Frames I did not look at are not covered by the "checked by eye" claims. In particular the run 620–921 was checked at 689 and 800 only.
- Seat-to-person identification at frame 0 counts back from the cox, since the first rowers are out of shot.
- The stepping result (F1) is a simulation on the real timestamps and the viewer's formula. It reproduces the tester's observed label and symptom. It has not been run in a browser.
- The far-boat and size outlier lists are statistical. The ones inside runs I looked at are confirmed. The seats 1–4 runs at 1671–1791 are not, and look like shrinking rowers.
- I can not see the tester's screen, so for the "blatantly wrong" joints in screenshots 2 and 3 I have given the numbers and what I see in my own render, and said where I am unsure I am looking at the same thing.
- Not examined: the 3D model, the PDF export, the compare page, the Settings targets, the stroke-by-stroke tab, and the welcome and model download flow.

## 12. Reproducing this on another machine

Copy the clip's folder (it cannot go through GitHub; `summary.json` and `frames.json` hold keypoints of real people and `working.mp4` is the footage):

```
scp -r laptop:~/.config/RowVision/clips/<clip id> ./clip
python3 docs/research/2026-11-20-8plus-clip-audit/clip_audit.py ./clip
python3 docs/research/2026-11-20-8plus-clip-audit/clip_audit.py ./clip --render 0 33 300 689 800   # writes ./audit_frames/
```

Needs `numpy`, `ffprobe` on the path (and `ffmpeg` and `Pillow` for `--render`). On this machine the bundled copies are at `/opt/RowVision/resources/engine/ffmpeg` and `ffprobe`; pass them with `--ffmpeg` and `--ffprobe`. The script prints sections 1–9; the appendix below is its output on this clip, with the table of centre positions (section 3 of the script) left out.

## 13. Code pointers

| What | Where |
|---|---|
| Viewer seek and frame mapping | `apps/web/app/clips/[id]/viewer.tsx:55-60, 62-83`, step buttons 292–298, keys 141–169 |
| Overlay legs and angles | `apps/web/app/clips/[id]/draw.ts:29` (`drawPose`), `apps/web/lib/logic.ts:49, 55` (`legsUnsure`) |
| Working copy encoding | `services/worker/rowvision_worker/media.py:15, 70-99` |
| Test fixture at exactly 30 fps | `apps/desktop/tests/app/fixture.ts:9`, stepping test `apps/desktop/tests/app/app.spec.ts:142` |
| Tracking | `services/vision/rowvision/tracking.py:91, 190, 229` |
| Boat grouping and seat fitting | `services/vision/rowvision/boats.py:225, 288, 379, 501` |
| Seat numbering | `services/vision/rowvision/seats.py:118`, `pipeline.py:522` (`_seats_of`), `pipeline.py:538` (`_crew_to_measure`) |
| Cox exclusion | `services/vision/rowvision/cox.py`, `pipeline.py:478` (`_leave_out_cox`) |
| Camera angle, shots | `services/vision/rowvision/view.py`, `shots.py`, `pipeline.py:218` (`view_by_frame`) |
| Leg believability | `services/vision/rowvision/metrics.py:15-17, 103` |
| Crew timing | `services/vision/rowvision/pipeline.py:298` (`crew_timeline`) |
| Rating | `services/vision/rowvision/reliability.py`, `reference/calibration.yaml` |
| Labelling tool | `apps/preview/rowvision_preview/labels.py` |
| Related issues | #7 (multiple boats and lost rowers, open), #213 (sweep sides off side-on, open), #217 (two crews grouped, closed), #168 (flaky jump-to-catch test, open) |

---

## Appendix: output of `clip_audit.py` on this clip

```text
clip <id>: 1793 frames at 29.8836 fps, shots [('side_on', 0, 325), ('oblique', 325, 690), ('side_on', 690, 1420), ('oblique', 1420, 1793)]

==============================================================================
1. Pose coverage per seat (share of frames that have a pose), overall and per shot
==============================================================================
seat |  all  | side_on 0-325 | oblique 325-690 | side_on 690-1420 | oblique 1420-1793
  1  | 98.2% |  90.8% | 100.0% | 100.0% |  99.5%
  2  | 99.9% | 100.0% | 100.0% | 100.0% |  99.5%
  3  | 98.2% |  90.8% | 100.0% | 100.0% |  99.5%
  4  | 97.9% |  89.2% | 100.0% | 100.0% |  99.5%
  5  | 98.2% |  90.8% | 100.0% | 100.0% |  99.5%
  6  | 92.1% | 100.0% | 100.0% |  81.0% |  99.5%
  7  | 99.9% | 100.0% | 100.0% | 100.0% |  99.5%
  8  | 60.1% |  10.8% |  21.9% |  81.0% |  99.5%

Tracked runs and gaps (frames) for the end seats and one middle seat:
 seat 8: tracked [(290, 333), (355, 357), (620, 921), (1060, 1791)]
         gaps    [(0, 290, 290), (333, 355, 22), (357, 620, 263), (921, 1060, 139), (1791, 1793, 2)]
 seat 7: tracked [(0, 1791)]
         gaps    [(1791, 1793, 2)]
 seat 6: tracked [(0, 786), (925, 1791)]
         gaps    [(786, 925, 139), (1791, 1793, 2)]
 seat 1: tracked [(30, 1791)]
         gaps    [(0, 30, 30), (1791, 1793, 2)]
 seat 4: tracked [(35, 1791)]
         gaps    [(0, 35, 35), (1791, 1793, 2)]

==============================================================================
2. Identity checks: far-boat intrusion, duplicates, order, teleports
==============================================================================
median trunk length 55px (per seat [55, 53, 58, 54, 62, 54, 61, 54])

Suspects: centre more than 1 trunk off the crew's median height, or trunk under 70% of the
clip median. Height is a strong sign of the other boat; a small trunk can also just mean the
boat is receding, so check the late frames by eye before counting them.
 seat 1: height-off   0 | any suspect  77 | runs>=3 [(1697, 1708), (1714, 1717), (1719, 1722), (1723, 1730), (1739, 1777), (1783, 1791)]
 seat 2: height-off   0 | any suspect  88 | runs>=3 [(1671, 1677), (1699, 1702), (1703, 1714), (1715, 1729), (1735, 1742), (1743, 1774), (1779, 1791)]
 seat 3: height-off   0 | any suspect  27 | runs>=3 [(1739, 1754), (1757, 1760), (1783, 1791)]
 seat 4: height-off   0 | any suspect  56 | runs>=3 [(1674, 1678), (1714, 1722), (1751, 1758), (1759, 1769), (1775, 1791)]
 seat 5: height-off   0 | any suspect   2 | runs>=3 []
 seat 6: height-off  52 | any suspect  58 | runs>=3 [(734, 786), (1786, 1789)]
 seat 7: height-off  83 | any suspect  84 | runs>=3 [(644, 728)]
 seat 8: height-off  69 | any suspect  84 | runs>=3 [(290, 333), (620, 642), (1715, 1719), (1759, 1765), (1766, 1769)]

Usual spacing between neighbouring seats: 172px (3.16 trunks)
Neighbours both tracked: frames out of order (x decreases) / closer than half the usual spacing
 seats 1->2: both 1761 | out of order   0 | too close   2
 seats 2->3: both 1761 | out of order   0 | too close   0
 seats 3->4: both 1756 | out of order   0 | too close   0
 seats 4->5: both 1756 | out of order   0 | too close   0
 seats 5->6: both 1622 | out of order   0 | too close   0
 seats 6->7: both 1652 | out of order  15 | too close  52
 seats 7->8: both 1077 | out of order   6 | too close  75

Centre jumps over 1.5 trunks between consecutive frames:
 seat 1: 1 [32]
 seat 2: 2 [28, 32]
 seat 3: 1 [33]
 seat 4: 0 []
 seat 5: 0 []
 seat 6: 1 [733]
 seat 7: 2 [643, 921]
 seat 8: 1 [641]

==============================================================================
4. Viewer frame mapping and stepping, simulated on the real timestamps
==============================================================================
frames in file 1793 (summary says 1793); analysis fps 29.883573
timestamp spacing in 1/15360 s ticks (512 = 1/30 s, 768 = 1/20 s): {512: 1778, 768: 14}
time x fps minus frame number: min -0.248 max +0.248 frames

today: floor(t*fps+0.01)
  frames whose label is not their true number: 864 of 1793
  'Forward 1' does not advance the label from 864 of 1790 starting labels
  'Back 1' does not retreat from 0

proposed: round(t*fps)
  frames whose label is not their true number: 0 of 1793
  'Forward 1' does not advance the label from 0 of 1790 starting labels
  'Back 1' does not retreat from 0

Jump to the first catch (34): picture is frame 34; label today 33, proposed 34
5 presses of Forward 1 from there (true frame, label) today: [(34, 33), (34, 33), (34, 33), (34, 33), (34, 33)]

==============================================================================
5. Which per-stroke numbers exist, and which are shared by the whole crew
==============================================================================
Same catch frames for every seat: True | same finish frames: True
catch-to-catch frames: {44: 2, 45: 17, 46: 16, 47: 3}

strokes with a value, out of 38
seat | catch_lea finish_le catch_kne finish_kn finish_el catch_elb body_swin legs_lead arms_brea stroke_le drive_sha   drive_s recovery_     ratio
  1  |        38        38        38        33        38        38        38        33        38        38        38        38        38        38
  2  |        38        38        38        27        38        33        38        27        33        38        38        38        38        38
  3  |        38        38        38        35        38        38        38        35        38        38        38        38        38        38
  4  |        37        38        29        23        17        31        37        21        11        37        38        38        38        38
  5  |        38        38        38        28        38        38        38        28        38        38        38        38        38        38
  6  |        35        35        19        18        23        35        34        16        23        34        38        38        38        38
  7  |        38        38        36        18        34        37        38        18        33        38        38        38        38        38
  8  |        24        22        19        11         9        23        21        11         8        21        38        38        38        38

Distinct values in the timing fields across all strokes (a measurement per stroke would vary):
  seat 1: {'drive_s': 3, 'recovery_s': 3, 'drive_share': 7, 'ratio': 7}
  seat 2: {'drive_s': 3, 'recovery_s': 3, 'drive_share': 7, 'ratio': 7}
  seat 3: {'drive_s': 3, 'recovery_s': 3, 'drive_share': 7, 'ratio': 7}
  seat 4: {'drive_s': 3, 'recovery_s': 3, 'drive_share': 7, 'ratio': 7}
  seat 5: {'drive_s': 3, 'recovery_s': 3, 'drive_share': 7, 'ratio': 7}
  seat 6: {'drive_s': 3, 'recovery_s': 3, 'drive_share': 7, 'ratio': 7}
  seat 7: {'drive_s': 3, 'recovery_s': 3, 'drive_share': 7, 'ratio': 7}
  seat 8: {'drive_s': 3, 'recovery_s': 3, 'drive_share': 7, 'ratio': 7}

Angle readouts available (non-null / frames with a pose):
  seat 1: trunk 1761/1761 | knee 1713/1761 | elbow 1761/1761
  seat 2: trunk 1790/1791 | knee 1521/1791 | elbow 1791/1791
  seat 3: trunk 1761/1761 | knee 1713/1761 | elbow 1761/1761
  seat 4: trunk 1755/1756 | knee 1377/1756 | elbow 1756/1756
  seat 5: trunk 1761/1761 | knee 1667/1761 | elbow 1761/1761
  seat 6: trunk 1652/1652 | knee 1044/1652 | elbow 1652/1652
  seat 7: trunk 1791/1791 | knee 1457/1791 | elbow 1791/1791
  seat 8: trunk 1077/1077 | knee 792/1077 | elbow 1077/1077

Ratings and evidence per seat:
  seat 1: accuracy 85 Great | coverage 0.98 agreement 0.98 trunk 56px | overall 95 | warnings []
  seat 2: accuracy 84 Great | coverage 1.00 agreement 0.95 trunk 54px | overall 91 | warnings []
  seat 3: accuracy 78 Good  | coverage 0.98 agreement 0.97 trunk 59px | overall 76 | warnings []
  seat 4: accuracy 85 Great | coverage 0.98 agreement 0.95 trunk 55px | overall 83 | warnings []
  seat 5: accuracy 89 Great | coverage 0.98 agreement 0.96 trunk 62px | overall 79 | warnings []
  seat 6: accuracy 84 Great | coverage 0.92 agreement 0.95 trunk 54px | overall 69 | warnings []
  seat 7: accuracy 87 Great | coverage 1.00 agreement 0.91 trunk 61px | overall 80 | warnings []
  seat 8: accuracy 73 Good  | coverage 0.60 agreement 0.86 trunk 52px | overall None | warnings ['You were only tracked for part of the video.']

==============================================================================
6. Seat 8: reported strokes grouped by the tracked run they fall in
==============================================================================
  no pose at the catch     strokes 14 | catch lean n= 0 mean    nan sd  nan | finish lean n= 1 mean  -14.1 sd  0.0
  run 290-333              strokes  1 | catch lean n= 1 mean   43.8 sd  0.0 | finish lean n= 0 mean    nan sd  nan
  run 355-357              strokes  1 | catch lean n= 1 mean   46.7 sd  0.0 | finish lean n= 0 mean    nan sd  nan
  run 620-921              strokes  7 | catch lean n= 7 mean   24.0 sd  3.3 | finish lean n= 6 mean  -20.5 sd  1.9
  run 1060-1791            strokes 15 | catch lean n=15 mean   30.5 sd  2.6 | finish lean n=15 mean  -28.4 sd  6.8
Check each run against the picture (--render) before trusting its numbers as this seat's.

==============================================================================
7. Keypoint confidence and left/right separation (L is the far side when the crew faces right)
==============================================================================
mean score   |   shoL  shoR   elbL  elbR   wriL  wriR   hipL  hipR   kneL  kneR   ankL  ankR
  seat 1    |   0.77  0.79   0.67  0.75   0.67  0.76   0.71  0.76   0.68  0.69   0.61  0.63
  seat 2    |   0.79  0.82   0.74  0.80   0.74  0.74   0.67  0.72   0.59  0.56   0.52  0.50
  seat 3    |   0.74  0.76   0.65  0.74   0.64  0.73   0.67  0.73   0.64  0.66   0.58  0.60
  seat 4    |   0.74  0.79   0.72  0.76   0.71  0.72   0.67  0.72   0.58  0.55   0.48  0.46
  seat 5    |   0.73  0.75   0.61  0.73   0.59  0.72   0.68  0.74   0.60  0.67   0.52  0.60
  seat 6    |   0.72  0.76   0.69  0.72   0.68  0.69   0.61  0.67   0.55  0.52   0.46  0.45
  seat 7    |   0.71  0.76   0.57  0.72   0.54  0.71   0.67  0.71   0.57  0.65   0.48  0.57
  seat 8    |   0.72  0.75   0.61  0.70   0.58  0.70   0.65  0.69   0.55  0.61   0.45  0.50

Share of tracked frames where the left and right joint are within 0.35 trunk of each other:
  seat 1: knees 88.5% | shoulders 50.3%
  seat 2: knees 90.6% | shoulders 28.9%
  seat 3: knees 85.7% | shoulders 54.5%
  seat 4: knees 91.4% | shoulders 40.0%
  seat 5: knees 95.5% | shoulders 66.8%
  seat 6: knees 90.1% | shoulders 45.1%
  seat 7: knees 88.7% | shoulders 64.7%
  seat 8: knees 90.3% | shoulders 54.3%

==============================================================================
8. Camera angle estimate per shot (SIDE_ON up to 25 deg, OBLIQUE up to 60 deg)
==============================================================================
  side_on     0- 325: mean  21.1 min  15.1 max  25.4 share>25   3%
  oblique   325- 690: mean  34.9 min  25.5 max  40.3 share>25 100%
  side_on   690-1420: mean  21.5 min  17.5 max  26.3 share>25   4%
  oblique  1420-1793: mean  36.7 min  26.0 max  44.1 share>25 100%
  summary view_deg 23.78; frames estimated above 25: 778

==============================================================================
9. Per-seat detail on chosen (seat, frame) pairs: angles, scores and separations only
==============================================================================
  seat 3 frame 33: angles {'trunk': 18, 'knee': None, 'elbow': 28} trunk 47px | L-R sep in trunks: shoulder 0.76 knee 0.32 ankle 0.17 | scores {'Lsho': 0.51, 'Rsho': 0.57, 'Lkne': 0.48, 'Rkne': 0.46, 'Lank': 0.45, 'Rank': 0.34}
  seat 3 frame 34: angles {'trunk': 20, 'knee': 73, 'elbow': 175} trunk 55px | L-R sep in trunks: shoulder 0.06 knee 0.33 ankle 0.14 | scores {'Lsho': 0.66, 'Rsho': 0.71, 'Lkne': 0.71, 'Rkne': 0.73, 'Lank': 0.72, 'Rank': 0.74}
  seat 5 frame 33: angles {'trunk': 19, 'knee': 70, 'elbow': 173} trunk 59px | L-R sep in trunks: shoulder 0.17 knee 0.1 ankle 0.09 | scores {'Lsho': 0.64, 'Rsho': 0.67, 'Lkne': 0.68, 'Rkne': 0.76, 'Lank': 0.6, 'Rank': 0.72}
  seat 5 frame 34: angles {'trunk': 20, 'knee': 70, 'elbow': 172} trunk 57px | L-R sep in trunks: shoulder 0.19 knee 0.14 ankle 0.1 | scores {'Lsho': 0.66, 'Rsho': 0.69, 'Lkne': 0.68, 'Rkne': 0.76, 'Lank': 0.57, 'Rank': 0.72}
  seat 6 frame 221: angles {'trunk': 26, 'knee': None, 'elbow': 151} trunk 49px | L-R sep in trunks: shoulder 0.54 knee 0.26 ankle 0.13 | scores {'Lsho': 0.71, 'Rsho': 0.75, 'Lkne': 0.58, 'Rkne': 0.5, 'Lank': 0.43, 'Rank': 0.41}
  seat 6 frame 222: angles {'trunk': 25, 'knee': None, 'elbow': 151} trunk 50px | L-R sep in trunks: shoulder 0.51 knee 0.33 ankle 0.17 | scores {'Lsho': 0.72, 'Rsho': 0.73, 'Lkne': 0.46, 'Rkne': 0.44, 'Lank': 0.38, 'Rank': 0.35}
```

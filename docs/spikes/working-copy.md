# Spike: the working copy and frame-exact stepping

Run on 2026-11-07 for issue #51. Real clips stayed local, and nothing from them is committed.

## The copy

The worker cuts the section and re-encodes it as H.264 at full size, with rotation baked in, a keyframe every 15 frames and no B-frames. Each decoded frame becomes one output frame, re-timed to a constant rate (`settb`, `setpts=N`, `-fps_mode passthrough`).

On a generated HEVC clip with uneven timing and a frame number in every frame:

- All 450 frames came through, in order.
- A cut from 5 seconds kept 240 consecutive frames.
- A rotated clip came out upright.
- The file's reported frame rate read 30.07 for a true 30, so the worker stores the rate itself.

## Stepping in a browser

Measured in headless Chromium on 211 steps forwards, backwards and at random, on a 2336x1080 clip. There was no graphics chip helping, so these are worst-case timings.

| Keyframe gap | Size per 6 seconds | Exact frames | Median step | 95th percentile |
|---|---|---|---|---|
| 15 | 6.1 MB | 211 of 211 | 134 ms | 217 ms |
| 5 | 15.4 MB | 211 of 211 | 165 ms | 185 ms |
| 1 | 25.6 MB | 211 of 211 | 83 ms | 87 ms |

A gap of 15 is used, as it is the smallest and still quick. Firefox could not be launched here. Real phones are still to be tested, with the test page sent to the owner.

## Does the copy change the results?

One real clip, run from the original and from the copy, with fresh detections both times:

| | Original | Copy |
|---|---|---|
| Strokes | 19 | 19 |
| Accuracy | 43.3% | 43.7% |
| Catch lean | 17.6° | 18.7° |
| Layback | 21.2° | 20.7° |
| Catch knee | 105.0° | 104.9° |
| Finish knee | 163.6° | 161.0° |
| Drive share | 0.41 | 0.40 |

These differences are small next to the 5° typical gap in body angle, so the copy is used for analysis. Encoding took 43 seconds and the copy was 125 MB against 153 MB. Only one clip could be compared, as the other sample stopped to ask for a boat in both runs.

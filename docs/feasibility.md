# Feasibility on real launch footage

Tested on one real clip of an eight: 848×478, 30 fps, 35 s, filmed from a moving launch by phone. The clip stays out of this repository because it shows identifiable athletes.

## Result

Off-the-shelf pose estimation is usable at this resolution, so the planned approach stands.

| Check | Result |
|---|---|
| People found per frame | 8–9 on sampled frames with the larger model (8 rowers plus cox) |
| Skeleton placement | Plausible by eye on inspected frames, including hips and knees that the model scored low |
| Stroke rate from joints | 21.4–21.7 spm across tracked rowers, measured independently per rower |
| Cross-check | Whole-frame motion peaks near 43 per minute, two motion peaks per stroke |
| Trunk angle range | About 21–26° forward to 16–20° back |

These figures have not been compared with hand-labelled ground truth. Stroke rate and angles are consistency checks, not accuracy measurements.

## Limits found

- **Trunk length is about 26 px.** One pixel of error moves the trunk angle by roughly 2°, so a ±5° target leaves little margin at this size. Rower size must be a major input to the accuracy rating.
- **Model confidence is a poor guide alone.** Hips and knees score low because the hull hides them, even when placement looks right. The rating cannot rely on keypoint confidence alone.
- **Lower legs are mostly hidden.** Ankle and shin measurements should be expected as "not scored" on footage like this.
- **Duplicate detections occur.** One rower produced two tracks, so tracking needs duplicate suppression.
- **The tracker is too simple.** Nearest-neighbour tracking lost the outer rowers (17–43% coverage) as they crossed the frame edge.
- **Detector.** The pose library uses YOLOX for person detection, not RTMDet. Its code is Apache-2.0, but licence terms for the pretrained weights and their training data still need checking before commercial launch.
- **Upscaling the whole frame adds little.** Pose already runs on a crop, so upscaling mostly costs time.
- **Real footage is messy.** Zoom changes, a finger over the lens and oblique final shots all appear in this clip.

## Speed

On 8 CPU cores with all people in frame: 4.1 s/frame with the large model and 2.2 s/frame with the balanced model, or about 39 minutes for this clip. Running pose only on the chosen rower should cut this substantially, but that has not been measured yet.

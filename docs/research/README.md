# Evidence summary

RowVision's technique targets come from published research, not opinion. This page explains how the evidence was gathered, what it supports, and where it runs out. The full list is in [studies.md](studies.md), and the values the app uses are in [`general.yaml`](../../services/vision/reference/general.yaml).

## How studies were found

PubMed was searched on 5 November 2026 across 12 topics: trunk and spine, lower limb, sequencing, stroke timing, reviews, on-water rowing, crew coordination, injury, juniors, ergometers, video analysis and pose estimation. This returned 602 records, of which 477 mention rowing. Titles were then screened for relevance, and the most relevant studies were read at abstract or full-text level.

This was a structured search, not a formal systematic review. No study was scored for quality, and only one database was searched in depth.

## What the targets are based on

| Measure | General target | Reported values | Main sources |
|---|---|---|---|
| Forward trunk angle at catch | 20–35° | About 26–32° (thorax); 33–36° in one study | Cardoso 2024; Penichet-Tomas 2025 |
| Trunk layback at finish | 15–30° | About 18–28° (thorax) | Cardoso 2024 |
| Knee angle at catch | 45–60° | About 44–52°; 56–61° | Bell 2013; Penichet-Tomas 2025 |
| Knee angle at finish | 165–180° | Mostly 160–164°; 167–169° | Our judgement, informed by Bell 2013 and Penichet-Tomas 2025 |
| Drive share of the stroke | About 39–47%, rising with rate | 39.4% at 22 spm, 43.0% at 26 spm, 46.8% at 32 spm | Engstrom 2023 |
| Legs lead the trunk off the catch | Legs first | Coaching principle, not a measured number | Rowing Canada and British Rowing technique models |

The target ranges are RowVision's own judgement from these figures. No study states them as ideal values.

The finish knee target is deliberately wider than the studies report. Those figures come from rowing machines, and legs are normally flat at the finish on the water, so a fully straight leg is not penalised. A coach should review this.

The drive shares are worked out from Engstrom 2023, which gives the point in the cycle where the catch occurs (60.6%, 57.0% and 53.2%).

## Limits of the evidence

- **Most data comes from ergometers.** Lumbar motion and arm kinematics differ between ergometers and boats (Wilson 2013; Trompeter 2021; Lamb 1989). Few studies report on-water body angles, so these targets are approximate for rowing on the water.
- **Measured values are not ideal values.** Studies describe what skilled rowers do. They do not prove that a given angle is best, and research on an ideal technique is limited (Soper 2004).
- **"Legs first" is a coaching principle.** National technique models describe it ([Rowing Canada](https://rowingcanada.org/uploads/2020/11/Canadian-Rowing-Model-Technique_FINAL.pdf), [British Rowing](https://www.britishrowing.org/knowledge/rower-development/british-rowing-technique/water-rowing-technique/)), but the reviewed studies do not set a numeric target, and coaches debate how separate the legs and trunk should be. RowVision only checks the direction.
- **Good technique varies.** Elite rowers show distinct individual patterns (Legge 2026), which is why adjustable targets are planned.
- **Studies measure angles differently.** Thorax angle, whole-trunk angle and joint flexion are not the same thing. For example, Cardoso 2024 reports knee values near 132°, which appear to use a different convention from Bell 2013. Those values are not used for knee targets.
- **Samples are small and mostly adult.** Several studies have fewer than 15 rowers, and few involve juniors. Junior targets are not separated yet.
- **One outlier is excluded.** The 44–49° finish layback in Penichet-Tomas 2025 is well above other studies, and that paper says its video tool is not yet validated, so it does not set the finish range.

## Back health

RowVision gives coaching feedback, not medical advice. Spinal curvature and pelvic rotation, which feature most in the back pain research (Nugent 2021), cannot be measured reliably from launch footage. The app does not claim to assess injury risk.

## Accuracy of video analysis

No study found validates pose estimation for on-water rowing, so RowVision has to establish this itself. Research on other movements supports the approach and shows its limits. Single-camera sagittal measures can come close to marker-based results on the camera side, but the hidden side is much less reliable (Wade 2023). Camera angle and distance also affect accuracy (Wang 2024).

## How the accuracy rating works

The rating estimates the share of joint angles within 5° of the true value. It depends on how big the rower is in pixels, the camera angle, and how much the angle varies between strokes. Clip length, tracking coverage and crew rhythm do not change it. They appear as separate notes, because they say how much evidence there is, not how accurate an angle is.

The rating uses a keypoint error measured against hand-labelled real footage, stored in `services/vision/reference/calibration.yaml`. It was first assumed to be 1.5 pixels. On 78 usable labelled frames, the value that matches real body angle accuracy is 2.0 pixels.

| Measured on 78 labelled frames | Result |
|---|---|
| Body angle within 5° of the labeller | 50% overall, 54% on side-on shots, 44% on oblique shots |
| Typical body angle gap | 5° |
| Knee angle within 5° | 26%, with a typical gap of about 13° |
| Typical joint gap, nearest side | About 2–3 pixels for shoulder, elbow, wrist and knee; 4.7 for hip; 7.9 for ankle |

These results have limits. Hand labels on small, blurry rowers carry their own error, so the true accuracy is probably somewhat better than measured. The set is small, so the body angle figure could be about 10 points either way. Rowers in these clips had trunks of about 17–32 pixels, so nothing here shows how the app performs on sharper or closer footage. Within that range, accuracy did not clearly improve with rower size. The rating formula assumes it does, which is not yet proven.

The app says the rating is based on labelled frames so far until 100 usable frames are reached.

## Review status

These targets have not yet been reviewed by a coach.

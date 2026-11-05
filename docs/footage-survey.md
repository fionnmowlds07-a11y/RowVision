# Footage survey

Fourteen unique real clips were reviewed to set requirements. One clip existed in two places as a byte-for-byte copy, so ingest should detect repeat uploads by checksum. The clips stay out of this repository.

## What real uploads look like

- **Format:** all are 848×478 H.264 at about 30 fps with variable timing, which is what WhatsApp compression produces. This should be treated as the normal case, not the worst case.
- **Length:** 10–64 seconds.
- **Boats:** singles, small boats, fours and eights.
- **Direction:** crews travel both left and right across the frame, so facing direction cannot be assumed.

## Requirements this adds

| Finding | Requirement |
|---|---|
| Angle changes within a clip, from side-on to directly behind the boat | Split each video into shots and rate each shot separately |
| Camera points at the launch floor for part of a clip | Detect and skip footage with no rowing in it |
| Launch bow and fingers enter the frame | Treat these as occlusion and lower the rating |
| Other crews appear in the background | Choose the target boat, using the athlete's tap on a frame |
| Zoom changes during clips | Do not assume constant scale; measure relative to body size |
| Stern-on views show oar symmetry but not side-view angles | Offer a limited analysis for these shots with a clear warning |
| Rowers span about 30 px in eights to much larger in small boats | Rower size must weigh heavily in the rating |

## Analysis scope

Analysis defaults to the chosen seat. Whole crew is a per-analysis option, because it takes much longer and processes more of teammates' data.

## Tracking results

Rowers found in each clip, against the crew visible in the footage. The boat class was supplied, as the athlete would supply it. Crew sizes were judged by eye from sampled frames, and these checks confirm the headcount only, not that each seat was matched to the right person.

| Result | Clips |
|---|---|
| Correct crew size | 11 of 14 |
| One too many (four) | 1 clip |
| Two too many (eight) | 1 clip, small rowers |
| No confirmed rowers (eight) | 1 clip, rowers about 25 px tall |

In the last clip, the larger pose model confirmed 4 of 8 rowers, at about 20 times the time per frame. Eights filmed from a distance remain the hardest case.

## Measured speed

Chosen-seat analysis on 8 CPU cores took 77 seconds for a 15-second clip and 248 seconds for a 35-second clip.

"""Build per-frame detections for a synthetic crew."""

import numpy as np

from rowvision.skeleton import FloatArray
from rowvision.synthetic import generate

SEAT_SPACING_PX = 300.0
FAR_BOAT_START_PX = 3000.0


def crew_detections(
    seats: int = 4, *, drift_px: float = 0.0, facing: int = -1
) -> tuple[list[FloatArray], list[FloatArray]]:
    clips = [generate(strokes=6, facing=facing, pixel_noise=0.5, seed=i) for i in range(seats)]
    frames = len(clips[0].points)
    points, scores = [], []
    for frame in range(frames):
        people = np.stack([clip.points[frame] for clip in clips])
        people[..., 0] += np.arange(seats)[:, None] * SEAT_SPACING_PX + drift_px * frame
        points.append(people)
        scores.append(np.full(people.shape[:2], 0.9))
    return points, scores


def two_boat_detections(*, crossing: bool = False) -> tuple[list[FloatArray], list[FloatArray]]:
    """Return a near four and a distant pair moving the opposite way.

    Without `crossing` the boats stay apart on screen. With it, the distant boat travels across
    the near one, so their outlines overlap for part of the clip.
    """
    near_points, near_scores = crew_detections(4)
    far = [
        generate(strokes=7, rate_spm=28, facing=1, pixels_per_metre=24, pixel_noise=0.1, seed=9 + i)
        for i in range(2)
    ]
    points, scores = [], []
    start = 1800.0 if crossing else FAR_BOAT_START_PX
    speed = -2.5 if crossing else -0.5
    height = 330.0 if crossing else 0.0
    for frame, (near, near_score) in enumerate(zip(near_points, near_scores)):
        people = np.stack([clip.points[frame] for clip in far])
        people[..., 0] += start + np.arange(2)[:, None] * 50 + speed * frame
        people[..., 1] += height - 260
        points.append(np.concatenate([near, people]))
        scores.append(np.concatenate([near_score, np.full(people.shape[:2], 0.9)]))
    return points, scores

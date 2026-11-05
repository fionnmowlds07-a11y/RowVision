"""Build per-frame detections for a synthetic crew."""

import numpy as np

from rowvision.skeleton import FloatArray
from rowvision.synthetic import generate

SEAT_SPACING_PX = 300.0


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

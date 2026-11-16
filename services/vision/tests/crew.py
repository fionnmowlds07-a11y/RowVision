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
    """Return a near four and a pair moving the opposite way.

    Without `crossing` the pair is far off, so its people are small. With it, the pair is close and
    of a similar size, and travels across the four.
    """
    near_points, near_scores = crew_detections(4)
    scale = 240 if crossing else 24
    far = [
        generate(strokes=7, rate_spm=28, facing=1, pixels_per_metre=scale, pixel_noise=0.1, seed=9 + i)
        for i in range(2)
    ]
    points, scores = [], []
    start = 1800.0 if crossing else FAR_BOAT_START_PX
    speed = -2.5 if crossing else -0.5
    spacing = 300 if crossing else 50
    height = 190.0 if crossing else -260.0
    for frame, (near, near_score) in enumerate(zip(near_points, near_scores, strict=True)):
        people = np.stack([clip.points[frame] for clip in far])
        people[..., 0] += start + np.arange(2)[:, None] * spacing + speed * frame
        people[..., 1] += height
        points.append(np.concatenate([near, people]))
        scores.append(np.concatenate([near_score, np.full(people.shape[:2], 0.9)]))
    return points, scores


def distant_people(frame: int) -> FloatArray:
    """Return two tiny motionless people far from the camera, with no provable stroke rhythm."""
    joints = np.arange(17.0)[:, None] * np.array([0.0, 1.2]) + np.array([3000.0, 100.0])
    return np.stack([joints, joints + np.array([60.0, 0.0])])


def side_by_side_detections() -> tuple[list[FloatArray], list[FloatArray]]:
    """Return two fours rowing side by side, the far one under half the size, and one person
    between them in size and height, as a real clip of two eights had."""
    scales = [240.0] * 4 + [105.0] * 4 + [160.0]
    clips = [
        generate(strokes=6, pixels_per_metre=scale, pixel_noise=0.2, seed=i)
        for i, scale in enumerate(scales)
    ]
    trunk = 0.55
    across = np.concatenate([np.arange(4) * 300.0, 150 + np.arange(4) * 130.0, [1300.0]])
    up = np.array([0.0] * 4 + [trunk * (240 + 160)] * 4 + [trunk * 240])
    points, scores = [], []
    for frame in range(len(clips[0].points)):
        people = np.stack([clip.points[frame] for clip in clips])
        people[..., 0] += across[:, None]
        people[..., 1] -= up[:, None]
        points.append(people)
        scores.append(np.full(people.shape[:2], 0.9))
    return points, scores


def crossing_sides_detections(
    seats: int = 4, *, second_share: float = 0.6
) -> tuple[list[FloatArray], list[FloatArray]]:
    """Return a crew filmed from one side, then, after a second out of view, from the other.

    From the other side the crew faces the other way and the seats run the other way across the
    picture, which is the first part mirrored.
    """
    points, scores = crew_detections(seats)
    width = 2400.0
    mirrored = []
    for people in points[: int(len(points) * second_share)]:
        flipped = people.copy()
        flipped[..., 0] = width - flipped[..., 0]
        # Left and right joints swap when a person is mirrored.
        swapped = flipped.copy()
        swapped[:, 1::2], swapped[:, 2::2] = flipped[:, 2::2], flipped[:, 1::2]
        mirrored.append(swapped)
    gap = [np.zeros((0, 17, 2))] * 30
    return (
        points + gap + mirrored,
        scores + [np.zeros((0, 17))] * 30 + scores[: len(mirrored)],
    )

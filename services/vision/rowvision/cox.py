"""Keep a cox out of the rowers at either end of the boat.

A cox sits beyond the stroke seat facing the crew, or lies in the bow beyond the bow seat facing
the stern. Tracking an end rower can slip onto them when the two are close in the picture, most
often where the boat runs out of the frame. Frames where an end seat is plainly someone else are
left out of that seat, so they are never measured as the rower.
"""

from itertools import pairwise

import numpy as np
import numpy.typing as npt

from rowvision import skeleton as sk
from rowvision.skeleton import FloatArray

FACING_WINDOW = 9
"""Frames either side used to read which way someone faces, so one jittery nose does not count."""
BACKWARDS_OFFSET = 0.08
"""How far, in trunk lengths, the nose must sit behind the ears to say someone faces backwards."""
FAR_SPACING = 1.7
"""An end seat this many times the usual seat spacing from its neighbour is someone beyond it."""


def _torso(points: FloatArray) -> FloatArray:
    centre: FloatArray = (sk.shoulders(points) + sk.hips(points)) / 2
    return centre


def _trunks(points: FloatArray) -> FloatArray:
    lengths: FloatArray = np.linalg.norm(sk.shoulders(points) - sk.hips(points), axis=-1)
    return lengths


def facing_backwards(points: FloatArray, facing: int) -> npt.NDArray[np.bool_]:
    """Return the frames where this person faces the other way from the crew, as a stern cox does.

    `facing` is which way the crew faces in the picture: +1 right, -1 left.
    """
    ears = sk.midpoint(points, sk.LEFT_EAR, sk.RIGHT_EAR)
    with np.errstate(invalid="ignore", divide="ignore"):
        ahead = (points[:, sk.NOSE, 0] - ears[:, 0]) / _trunks(points) * facing
    backwards = np.zeros(len(points), dtype=bool)
    if facing == 0:
        return backwards
    for frame in range(len(points)):
        window = ahead[max(frame - FACING_WINDOW, 0) : frame + FACING_WINDOW + 1]
        known = window[np.isfinite(window)]
        if len(known) > FACING_WINDOW and np.isfinite(ahead[frame]):
            backwards[frame] = float(np.median(known)) < -BACKWARDS_OFFSET
    return backwards


def seat_spacing(centres: list[FloatArray], trunk: float) -> float:
    """Return the usual distance between neighbouring seats, in trunk lengths, or NaN.

    `centres` are each seat's torso centre on every frame, in order along the boat.
    """
    gaps = [
        np.linalg.norm(first - second, axis=-1) / trunk
        for first, second in pairwise(centres)
    ]
    joined = np.concatenate(gaps) if gaps else np.zeros(0)
    known = joined[np.isfinite(joined)]
    return float(np.median(known)) if len(known) else float("nan")


def beyond_neighbour(
    points: FloatArray, neighbour: FloatArray, spacing: float
) -> npt.NDArray[np.bool_]:
    """Return the frames where this end seat sits much further from its neighbour than seats do,
    which is someone beyond the end of the crew, such as a cox lying in the bow."""
    if not np.isfinite(spacing) or spacing <= 0:
        return np.zeros(len(points), dtype=bool)
    with np.errstate(invalid="ignore", divide="ignore"):
        gap = np.linalg.norm(_torso(points) - neighbour, axis=-1) / _trunks(points)
    far: npt.NDArray[np.bool_] = np.isfinite(gap) & (gap > FAR_SPACING * spacing)
    return far

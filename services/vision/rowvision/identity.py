"""Find frames where a seat's tracking sits on someone in another boat.

A crew sits along a line in the picture, so a seat well off that line has slipped onto someone who
is not in the boat. Seats that slip onto a neighbour, or are numbered one along, stay on the line
and are not found here. A check on the gaps between seats could see that something was wrong, but
not who: it kept the biggest group, which on real clips dropped correct seats and could keep the
shifted ones (issue 240).
"""

from collections.abc import Sequence
from itertools import combinations

import numpy as np
from numpy.typing import NDArray

from rowvision.skeleton import FloatArray

OFF_LINE_TRUNKS = 1.0
"""Further than this from the line through the crew is someone in another boat, or on the bank."""
MIN_SEATS = 4
"""Below this a frame has too few seats to say which of them is out of place."""


def _boat_line(points: FloatArray, trunks: FloatArray) -> tuple[FloatArray, FloatArray]:
    """Return a point on the line through the most seats, and the line's normal."""
    best: tuple[tuple[int, float], FloatArray, FloatArray] | None = None
    for first, second in combinations(range(len(points)), 2):
        step = points[second] - points[first]
        length = float(np.linalg.norm(step))
        if length == 0:
            continue
        along = step / length
        normal = np.array([-along[1], along[0]])
        off = np.abs((points - points[first]) @ normal) / trunks
        near = off < OFF_LINE_TRUNKS
        key = (int(near.sum()), -float(off[near].sum()))
        if best is None or key > best[0]:
            best = key, points[first], normal
    if best is None:
        return points[0], np.array([0.0, 1.0])
    return best[1], best[2]


def misplaced(centres: Sequence[FloatArray], trunks: Sequence[float]) -> NDArray[np.bool_]:
    """Return, for each seat and frame, whether the seat's tracking sits outside the boat.

    `centres` holds each seat's torso centre on every frame, NaN where not seen, in seat order.
    `trunks` is each seat's usual trunk length in pixels. Frames with fewer than MIN_SEATS seats
    seen are never flagged.
    """
    stacked = np.stack(centres) if len(centres) else np.zeros((0, 0, 2))
    seats, frames = stacked.shape[:2]
    lengths = np.asarray(trunks, dtype=float)
    wrong = np.zeros((seats, frames), dtype=bool)
    if seats < MIN_SEATS:
        return wrong
    seen = np.isfinite(stacked[..., 0])
    for frame in np.flatnonzero(seen.sum(axis=0) >= MIN_SEATS):
        present = np.flatnonzero(seen[:, frame])
        points = stacked[present, frame]
        origin, normal = _boat_line(points, lengths[present])
        off = np.abs((points - origin) @ normal) / lengths[present] > OFF_LINE_TRUNKS
        wrong[present[off], frame] = True
    return wrong

"""Find frames where a seat's tracking sits on someone other than that seat's rower.

Seats are fixed in the hull, so in any one frame the crew lies along a line, in seat order, with
gaps that change only gradually from one seat to the next. A seat that has slipped onto a rower in
another boat sits off that line. A seat that has slipped onto its neighbour, or been numbered one
along, leaves a gap that is much shorter or longer than the gaps beside it.

Measured on three whole-crew eights, with the failures from a real 8+ clip copied in (issue 240):
this caught 100% of frames on the other boat and of frames numbered one seat along, and flagged 0
to 1.2% of frames on clean seats. Checks from a fitted spacing did not: the spacing changes along
the boat from 2 to 4 trunks on oblique shots, and a free fit absorbs a one-seat shift by squeezing.
"""

from collections.abc import Sequence
from itertools import combinations

import numpy as np
from numpy.typing import NDArray

from rowvision.skeleton import FloatArray

OFF_LINE_TRUNKS = 1.0
"""Further than this from the line through the crew is someone in another boat, or on the bank."""
SHORT_GAP, LONG_GAP = 0.65, 1.6
"""A gap per seat outside these shares of the gaps beside it means a seat is held by the wrong
person. A seat moved one along over a missing seat gives about 0.5."""
MIN_SEATS = 4
"""Below this a frame has too few seats to say which of them is out of place."""


def _boat_line(points: FloatArray, trunks: FloatArray) -> tuple[FloatArray, FloatArray, FloatArray]:
    """Return a point on the line through the most seats, its direction, and its normal."""
    best: tuple[tuple[int, float], FloatArray, FloatArray, FloatArray] | None = None
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
            best = key, points[first], along, normal
    if best is None:
        return points[0], np.array([1.0, 0.0]), np.array([0.0, 1.0])
    return best[1], best[2], best[3]


def _expected_gap(gaps: FloatArray, places: FloatArray, index: int) -> float:
    """Return the gap the other gaps lead to at this one.

    Perspective makes the gaps grow by about the same share from each seat to the next, so a gap
    at an end is compared with where its neighbours are heading, not with their middle. The trend
    is a straight line through the log of the gaps, with the median of the slopes between pairs,
    so one wrong gap among the others does not move it.
    """
    others = np.array([other for other in range(len(gaps)) if other != index and gaps[other] > 0])
    if len(others) < 2:
        return float("nan")
    logs, at = np.log(gaps[others]), places[others]
    slopes = [(logs[b] - logs[a]) / (at[b] - at[a]) for a, b in combinations(range(len(others)), 2)]
    slope = float(np.median(slopes))
    return float(np.exp(np.median(logs + slope * (places[index] - at))))


def _breaks(gaps: FloatArray, places: FloatArray) -> list[int]:
    """Return the gaps that do not match the gaps around them.

    `gaps` is each gap per seat it spans, and `places` where along the boat it lies, in seats.
    """
    if len(gaps) < MIN_SEATS - 1:
        return []
    found = []
    for index, gap in enumerate(gaps):
        expected = _expected_gap(gaps, places, index)
        if not np.isfinite(expected):
            continue
        share = gap / expected
        if share < SHORT_GAP or share > LONG_GAP:
            found.append(index)
    return found


def _out_of_place(along: FloatArray, numbers: NDArray[np.int_]) -> NDArray[np.bool_]:
    """Split the seats at every bad gap and keep the biggest group. A tie keeps neither."""
    if np.median(np.sign(np.diff(along))) < 0:
        along = -along
    per_seat = np.diff(along) / np.diff(numbers)
    breaks = _breaks(per_seat, (numbers[1:] + numbers[:-1]) / 2)
    wrong = np.zeros(len(along), dtype=bool)
    if not breaks:
        return wrong
    groups = np.split(np.arange(len(along)), [index + 1 for index in breaks])
    biggest = max(len(group) for group in groups)
    kept = [group for group in groups if len(group) == biggest]
    wrong[:] = True
    if len(kept) == 1:
        wrong[kept[0]] = False
    return wrong


def misplaced(centres: Sequence[FloatArray], trunks: Sequence[float], numbers: Sequence[int]) -> NDArray[np.bool_]:
    """Return, for each seat and frame, whether the seat's tracking sits on the wrong person.

    `centres` holds each seat's torso centre on every frame, NaN where not seen, in seat order.
    `trunks` is each seat's usual trunk length in pixels. Frames with fewer than MIN_SEATS seats
    seen are never flagged.
    """
    stacked = np.stack(centres) if len(centres) else np.zeros((0, 0, 2))
    seats, frames = stacked.shape[:2]
    lengths = np.asarray(trunks, dtype=float)
    seat_numbers = np.asarray(numbers, dtype=int)
    wrong = np.zeros((seats, frames), dtype=bool)
    if seats < MIN_SEATS:
        return wrong
    seen = np.isfinite(stacked[..., 0])
    for frame in np.flatnonzero(seen.sum(axis=0) >= MIN_SEATS):
        present = np.flatnonzero(seen[:, frame])
        points = stacked[present, frame]
        origin, along, normal = _boat_line(points, lengths[present])
        off = np.abs((points - origin) @ normal) / lengths[present] > OFF_LINE_TRUNKS
        wrong[present[off], frame] = True
        on_line = present[~off]
        if len(on_line) >= MIN_SEATS:
            positions = (stacked[on_line, frame] - origin) @ along
            wrong[on_line[_out_of_place(positions, seat_numbers[on_line])], frame] = True
    return wrong

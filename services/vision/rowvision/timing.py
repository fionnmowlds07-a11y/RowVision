"""Compare a rower's timing with the rower they follow.

Early or late only means something against who you are following. Sweep rowers follow the rower
nearest the stern on their own side, and scullers follow stroke. Sweep rowers on one side share a
view of the camera, so comparing along a side also cancels most of the near and far side effect.
"""

from dataclasses import dataclass

import numpy as np

from rowvision.skeleton import FloatArray
from rowvision.strokes import detect_strokes, reach_signal

MIN_PAIRED_STROKES = 3
MAX_OFFSET_PERIODS = 0.2
"""A gap bigger than this would mean comparing different strokes."""
WINDOW_PERIODS = 0.25
"""How much of the stroke either side of the moment is compared."""


@dataclass(frozen=True)
class FollowTiming:
    leader_seat: int
    catch_ms: float | None
    """Median gap to the leader's catch. Positive means later than the leader."""
    finish_ms: float | None
    catch_spread_ms: float | None
    finish_spread_ms: float | None
    strokes: int


def leader_seat(seat: int, boat_seats: int, side: str, stroke_side: str = "stroke") -> int | None:
    """Return the seat a rower follows, or None for the stroke seat and a single sculler.

    A sweep rower follows the rower nearest the stern on their own side. That is the stroke seat
    for the side the stroke seat rows on, and the seat behind it for the other side, whose own
    leader follows stroke. Most boats have the stroke seat on stroke side, but not all, so
    `stroke_side` says which side the stroke seat rows on.
    """
    if seat >= boat_seats:
        return None
    if side not in ("scull", stroke_side) and seat < boat_seats - 1:
        return boat_seats - 1
    return boat_seats


def seat_side(seat: int | None, own_seat: int | None, own_side: str) -> str:
    """Return the side a seat rows on, worked out from the athlete's own seat and side.

    Sides alternate along a sweep boat, so seats an even number apart row on the same side. With
    no seat to count from, the athlete's own side is used.
    """
    if own_side == "scull" or seat is None or own_seat is None or (seat - own_seat) % 2 == 0:
        return own_side
    return "bow" if own_side == "stroke" else "stroke"


def _lag(mine: FloatArray, theirs: FloatArray, centre: int, half: int, reach: int) -> int | None:
    """Return how many frames my movement trails the leader's around one moment.

    The catch is a flat peak, so comparing single frames lets a little noise move the answer a long
    way. Sliding one whole movement across the other uses every frame around the moment.
    """
    start, end = centre - half, centre + half + 1
    if start - reach < 0 or end + reach > len(mine) or end > len(theirs):
        return None
    leader = theirs[start:end]
    if not np.isfinite(leader).all() or np.ptp(leader) == 0:
        return None
    best, best_score = None, -np.inf
    for lag in range(-reach, reach + 1):
        window = mine[start + lag : end + lag]
        if not np.isfinite(window).all() or np.ptp(window) == 0:
            continue
        score = float(np.corrcoef(leader, window)[0, 1])
        if score > best_score:
            best, best_score = lag, score
    return best


def _lags(
    mine: FloatArray, theirs: FloatArray, moments: list[int], half: int, reach: int
) -> list[int]:
    found = [_lag(mine, theirs, moment, half, reach) for moment in moments]
    return [lag for lag in found if lag is not None]


def _summary(gaps: list[int], fps: float) -> tuple[float | None, float | None]:
    if len(gaps) < MIN_PAIRED_STROKES:
        return None, None
    milliseconds = np.array(gaps, dtype=float) / fps * 1000
    spread = np.subtract(*np.percentile(milliseconds, [75, 25]))
    return float(np.median(milliseconds)), float(spread)


def follow_timing(
    points: FloatArray, leader_points: FloatArray, leader: int, facing: int, fps: float
) -> FollowTiming | None:
    """Measure how a rower's catches and finishes sit against the leader's, across all strokes."""
    mine = reach_signal(points, facing)
    theirs = reach_signal(leader_points, facing)
    timeline = detect_strokes(theirs, fps)
    period = timeline.period_frames
    if not period:
        return None
    half = round(WINDOW_PERIODS * period)
    reach = round(MAX_OFFSET_PERIODS * period)
    catches = _lags(mine, theirs, timeline.catches, half, reach)
    finishes = _lags(mine, theirs, timeline.finishes, half, reach)
    catch_ms, catch_spread = _summary(catches, fps)
    finish_ms, finish_spread = _summary(finishes, fps)
    if catch_ms is None and finish_ms is None:
        return None
    return FollowTiming(
        leader, catch_ms, finish_ms, catch_spread, finish_spread, max(len(catches), len(finishes))
    )

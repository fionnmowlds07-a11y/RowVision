"""Compare a rower's timing with the rower they follow.

Early or late only means something against who you are following. Sweep rowers follow the rower
nearest the stern on their own side, and scullers follow stroke. Sweep rowers on one side share a
view of the camera, so comparing along a side also cancels most of the near and far side effect.
"""

from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

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


def leader_seat(
    seat: int,
    boat_seats: int,
    side: str,
    stroke_side: str = "stroke",
    rig: Sequence[str] | None = None,
) -> int | None:
    """Return the seat a rower follows, or None for the stroke seat and a single sculler.

    A sweep rower follows the rower nearest the stern on their own side, and the rower who leads
    the side away from the stroke seat follows stroke. With no `rig`, sides are taken to alternate,
    so that leader is the seat behind stroke. Most boats have the stroke seat on stroke side, but
    not all, so `stroke_side` says which side the stroke seat rows on. A `rig` gives each seat's
    side, bow seat first, for boats rigged otherwise, such as a bucket rig.
    """
    if seat >= boat_seats:
        return None
    if rig is not None and len(rig) == boat_seats and side != "scull":
        own = rig[seat - 1]
        sternmost = max(other for other in range(1, boat_seats + 1) if rig[other - 1] == own)
        return boat_seats if sternmost == seat else sternmost
    if side not in ("scull", stroke_side) and seat < boat_seats - 1:
        return boat_seats - 1
    return boat_seats


def seat_side(
    seat: int | None, own_seat: int | None, own_side: str, rig: Sequence[str] | None = None
) -> str:
    """Return the side a seat rows on.

    A `rig` gives each seat's side, bow seat first. Without one, sides are taken to alternate along
    a sweep boat, so seats an even number apart row on the same side, counted from the athlete's
    own seat and side. With no seat to count from, the athlete's own side is used.
    """
    if own_side != "scull" and rig is not None and seat is not None and 1 <= seat <= len(rig):
        return rig[seat - 1]
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
    # The best match at the very edge of the search means the true gap lies outside it, or there
    # is no clear match at all. Either way it is not a gap to report.
    return None if best is None or abs(best) == reach else best


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
    points: FloatArray,
    leader_points: FloatArray,
    leader: int,
    facing: int,
    fps: float,
    clear: NDArray[np.bool_] | None = None,
) -> FollowTiming | None:
    """Measure how a rower's catches and finishes sit against the leader's, across all strokes.

    `clear` is False on end-on frames. Movement along the boat can hardly be seen there, so those
    strokes are timed apart and their catches and finishes are not compared.
    """
    mine = reach_signal(points, facing)
    theirs = reach_signal(leader_points, facing)
    timeline = detect_strokes(theirs, fps, clear)
    period = timeline.period_frames
    if not period:
        return None
    half = round(WINDOW_PERIODS * period)
    reach = round(MAX_OFFSET_PERIODS * period)
    seen = [moment for moment in timeline.catches if clear is None or clear[moment]]
    catches = _lags(mine, theirs, seen, half, reach)
    seen = [moment for moment in timeline.finishes if clear is None or clear[moment]]
    finishes = _lags(mine, theirs, seen, half, reach)
    catch_ms, catch_spread = _summary(catches, fps)
    finish_ms, finish_spread = _summary(finishes, fps)
    if catch_ms is None and finish_ms is None:
        return None
    return FollowTiming(
        leader, catch_ms, finish_ms, catch_spread, finish_spread, max(len(catches), len(finishes))
    )

"""Work out which tracked person sits in which seat."""

from dataclasses import dataclass

import numpy as np

from rowvision.skeleton import FloatArray
from rowvision.strokes import detect_strokes, facing_direction, reach_signal
from rowvision.tracking import Track

MIN_COVERAGE = 0.25
MIN_REGULARITY = 0.4


@dataclass(frozen=True)
class SeatAssignment:
    seats: dict[int, Track]
    """Seat number to track. Seat 1 is bow and the highest seat is stroke."""
    facing: int
    complete: bool
    """False when fewer rowers were seen than the boat holds, so numbering needs confirming."""


def is_rowing(track: Track, fps: float) -> bool:
    """Return True if the track shows a stroke rhythm, which excludes the cox."""
    if track.coverage < MIN_COVERAGE:
        return False
    try:
        facing = facing_direction(track.points)
        timeline = detect_strokes(reach_signal(track.points, facing), fps)
    except ValueError:
        return False
    return timeline.regularity >= MIN_REGULARITY


def assign_seats(tracks: list[Track], boat_seats: int, fps: float) -> SeatAssignment:
    """Number rowers along the boat from which way they face.

    Rowers face the stern, so the one furthest in the facing direction is stroke. If rowers are
    missing from view the numbering is a best guess, and the athlete's tap decides.
    """
    rowers = [track for track in tracks if is_rowing(track, fps)]
    if not rowers:
        return SeatAssignment({}, 0, False)
    votes = [facing_direction(track.points) for track in rowers]
    facing = 1 if sum(votes) > 0 else -1
    positions = [float(np.nanmedian(track.centre()[:, 0])) * facing for track in rowers]
    ordered = [rowers[index] for index in np.argsort(positions)]
    ordered = ordered[-boat_seats:]
    complete = len(ordered) == boat_seats
    first_seat = boat_seats - len(ordered) + 1
    seats = {first_seat + offset: track for offset, track in enumerate(ordered)}
    return SeatAssignment(seats, facing, complete)


def track_at(tracks: list[Track], frame: int, point: FloatArray) -> Track | None:
    """Return the track nearest a tapped image point on a given frame."""
    best: Track | None = None
    best_distance = float("inf")
    for track in tracks:
        centre = track.centre()[frame]
        if not np.isfinite(centre).all():
            continue
        distance = float(np.linalg.norm(centre - point))
        if distance < best_distance:
            best, best_distance = track, distance
    return best

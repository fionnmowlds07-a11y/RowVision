"""Work out which tracked person sits in which seat."""

from dataclasses import dataclass
from itertools import combinations

import numpy as np

from rowvision import skeleton as sk
from rowvision.skeleton import FloatArray
from rowvision.strokes import detect_strokes, facing_direction, reach_signal
from rowvision.tracking import Track

MIN_SEEN_SECONDS = 5.0
MIN_REGULARITY = 0.4


@dataclass(frozen=True)
class SeatAssignment:
    seats: dict[int, Track]
    """Seat number to track. Seat 1 is bow and the highest seat is stroke."""
    facing: int
    complete: bool
    """False when fewer rowers were seen than the boat holds, so numbering needs confirming."""
    surplus: int = 0
    """Rowers beyond what the boat holds, which suggests two boats were grouped together."""


def is_rowing(track: Track, fps: float) -> bool:
    """Return True if the track shows a stroke rhythm, which excludes the cox and bystanders.

    Only frames where the person was seen count, so a rower visible for part of a clip qualifies.
    """
    seen = int(np.isfinite(track.points[:, sk.LEFT_SHOULDER, 0]).sum())
    if seen < MIN_SEEN_SECONDS * fps:
        return False
    facing = facing_direction(track.points)
    timeline = detect_strokes(reach_signal(track.points, facing), fps)
    return timeline.regularity >= MIN_REGULARITY


def _order_along_boat(rowers: list[Track], facing: int) -> list[Track]:
    """Sort rowers from bow to stroke by who is ahead of whom while both are in view.

    Comparing on shared frames keeps the order correct while the camera pans.
    """
    wins = [0] * len(rowers)
    centres = [track.centre()[:, 0] * facing for track in rowers]
    for first, second in combinations(range(len(rowers)), 2):
        shared = np.isfinite(centres[first]) & np.isfinite(centres[second])
        if not shared.any():
            continue
        ahead = np.median(centres[first][shared] - centres[second][shared])
        wins[first if ahead > 0 else second] += 1
    return [rowers[index] for index in np.argsort(wins, kind="stable")]


def assign_seats(tracks: list[Track], boat_seats: int, fps: float) -> SeatAssignment:
    """Number rowers along one boat from which way they face.

    Rowers face the stern, so the one furthest in the facing direction is stroke. If rowers are
    missing from view the numbering is a best guess, and the athlete's tap decides.
    """
    rowers = [track for track in tracks if is_rowing(track, fps)]
    if not rowers:
        return SeatAssignment({}, 0, False)
    votes = [facing_direction(track.points) for track in rowers]
    facing = 1 if sum(votes) > 0 else -1
    ordered = _order_along_boat(rowers, facing)
    surplus = max(len(ordered) - boat_seats, 0)
    ordered = ordered[-boat_seats:]
    first_seat = boat_seats - len(ordered) + 1
    seats = {first_seat + offset: track for offset, track in enumerate(ordered)}
    return SeatAssignment(seats, facing, len(ordered) == boat_seats, surplus)


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

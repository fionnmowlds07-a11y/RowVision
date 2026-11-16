"""Work out which tracked person sits in which seat."""

import warnings
from collections.abc import Sequence
from dataclasses import dataclass
from itertools import combinations

import numpy as np
import numpy.typing as npt

from rowvision import skeleton as sk
from rowvision.skeleton import FloatArray
from rowvision.strokes import detect_strokes, facing_direction, reach_signal
from rowvision.tracking import Track

MIN_SEEN_SECONDS = 5.0
MIN_REGULARITY = 0.4
CLEAR_GAP_TRUNKS = 0.5
"""Neighbours closer than this are too near end-on to say who is ahead. Seats in a boat are about
2.5 trunk lengths apart side-on."""


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


def _places(ordered: list[Track], facing: int) -> npt.NDArray[np.intp] | None:
    """Return which track sits in each place along the boat on every frame, or None if unknown.

    Only frames showing the whole crew, clearly apart, can say, and only when the next such frame
    agrees. Other frames take the answer from the nearest frame that can.
    """
    centres = np.array([track.centre()[:, 0] * facing for track in ordered])
    trunks = np.nanmedian(
        [np.linalg.norm(sk.shoulders(t.points) - sk.hips(t.points), axis=-1) for t in ordered],
        axis=0,
    )
    places = np.argsort(centres, axis=0, kind="stable")
    gaps = np.diff(np.take_along_axis(centres, places, axis=0), axis=0)
    clear = np.isfinite(centres).all(axis=0) & (gaps.min(axis=0) >= CLEAR_GAP_TRUNKS * trunks)
    known = np.where(clear)[0]
    if len(known) == 0:
        return None
    # One frame out of step with those around it is a stray detection, not a change of place.
    same = (places[:, known[1:]] == places[:, known[:-1]]).all(axis=0)
    known = known[np.append(same, False) | np.insert(same, 0, False)]
    if len(known) == 0:
        return None
    frames = np.arange(centres.shape[1])
    after = np.clip(np.searchsorted(known, frames), 0, len(known) - 1)
    before = np.clip(after - 1, 0, None)
    nearest = np.where(
        np.abs(known[before] - frames) <= np.abs(known[after] - frames), known[before], known[after]
    )
    return places[:, nearest]


def _untangle(ordered: list[Track], facing: int) -> list[Track]:
    """Give each seat whoever is in its place on every frame.

    Rowers cannot change places in a boat. Tracking can: when the camera zooms suddenly, it may
    pick everyone up one seat along. So a track that changes place is a different person from
    there on, and their joints belong to the seat they are now in. Tracks that never change place
    are returned as they are.
    """
    if len(ordered) < 2:
        return ordered
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        places = _places(ordered, facing)
    if places is None or (places == np.arange(len(ordered))[:, None]).all():
        return ordered
    points = np.array([track.points for track in ordered])
    scores = np.array([track.scores for track in ordered])
    frames = np.arange(points.shape[1])
    return [
        track if (holder == place).all() else Track(points[holder, frames], scores[holder, frames])
        for place, (track, holder) in enumerate(zip(ordered, places, strict=True))
    ]


def assign_seats(
    tracks: list[Track], boat_seats: int, fps: float, trusted: Sequence[Track] = ()
) -> SeatAssignment:
    """Number rowers along one boat from which way they face.

    Rowers face the stern, so the one furthest in the facing direction is stroke. If rowers are
    missing from view the numbering is a best guess, and the athlete's tap decides. `trusted` are
    people already taken for rowers, who need show no rhythm of their own.
    """
    rowers = [
        track
        for track in tracks
        if any(track is known for known in trusted) or is_rowing(track, fps)
    ]
    if not rowers:
        return SeatAssignment({}, 0, False)
    votes = [facing_direction(track.points) for track in rowers]
    facing = 1 if sum(votes) > 0 else -1
    ordered = _order_along_boat(rowers, facing)
    surplus = max(len(ordered) - boat_seats, 0)
    ordered = _untangle(ordered[-boat_seats:], facing)
    first_seat = boat_seats - len(ordered) + 1
    seats = {first_seat + offset: track for offset, track in enumerate(ordered)}
    return SeatAssignment(seats, facing, len(ordered) == boat_seats, surplus)


def seat_holding(seats: dict[int, Track], track: Track, frame: int) -> int | None:
    """Return the seat whose rower is this track on a frame, even if the track was joined to others."""
    wanted = track.points[frame]
    if not np.isfinite(wanted).all():
        return None
    return next((s for s, held in seats.items() if np.array_equal(held.points[frame], wanted)), None)


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

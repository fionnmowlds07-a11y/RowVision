"""Group tracked people into boats, so the athlete can say which boat is theirs."""

from dataclasses import dataclass
from itertools import combinations

import numpy as np
from numpy.typing import NDArray

from rowvision import skeleton as sk
from rowvision.seats import is_rowing
from rowvision.skeleton import FloatArray
from rowvision.tracking import MAX_SIZE_RATIO, Track

BoolArray = NDArray[np.bool_]

MIN_SHARED_SECONDS = 1.0
MIN_SHARED_FRAMES = 3
SAME_SEAT_TRUNKS = 1.2
"""Rowers in an eight sit about 2.5 trunk lengths apart, so this separates neighbours."""
SAME_LINE_TRUNKS = 1.2
"""Most that rowers in one boat differ in height in the frame, in trunk lengths."""
MIN_ANALYSIS_TRUNK_PX = 15.0
"""Below this, one pixel of error moves the trunk angle by about 4 degrees."""
OUTLINE_MARGIN_TRUNKS = 1.0
MAX_DISJOINT_OVERLAP = 0.1
DISTANT_LINE_TRUNKS = 2.5
MIN_DISTANT_PEOPLE = 2
MIN_DISTANT_SECONDS = 5.0


@dataclass
class Boat:
    tracks: list[Track]
    """Everyone grouped into this boat, including anyone who is not rowing, such as a cox."""
    rowers: list[Track]

    @property
    def confirmed(self) -> bool:
        """True if someone in the boat shows a stroke rhythm.

        Distant crews are too small for this, so they stay unconfirmed. They can be listed as a
        boat but never count as proof that the clip has more than one.
        """
        return bool(self.rowers)

    @property
    def members(self) -> list[Track]:
        return self.rowers or self.tracks

    @property
    def trunk_px(self) -> float:
        return float(np.median([track.trunk() for track in self.members]))

    @property
    def too_far(self) -> bool:
        return self.trunk_px < MIN_ANALYSIS_TRUNK_PX

    def crew(self) -> list[Track]:
        """Return the rowers from the shot showing the most of the crew.

        People in shots with no frames in common cannot be matched to each other, so seats come
        from one shot only.
        """
        links = [
            (first, second)
            for first, second in combinations(range(len(self.rowers)), 2)
            if _shared_frames(self.rowers[first], self.rowers[second]).sum() >= MIN_SHARED_FRAMES
        ]
        groups = _components(len(self.rowers), links)
        if not groups:
            return []
        best = max(groups, key=len)
        return [self.rowers[index] for index in best]

    def seen(self) -> BoolArray:
        """Return a mask of frames where anyone counted in the boat is visible."""
        return np.any([np.isfinite(track.centre()[:, 0]) for track in self.members], axis=0)

    def outline(self, frame: int) -> FloatArray | None:
        """Return the boat's x1, y1, x2, y2 on a frame, or None if it is out of view."""
        people = [track.points[frame] for track in self.members]
        visible = [points for points in people if np.isfinite(points).all()]
        if not visible:
            return None
        points = np.concatenate(visible)
        margin = OUTLINE_MARGIN_TRUNKS * self.trunk_px
        return np.array(
            [
                points[:, 0].min() - margin,
                points[:, 1].min() - margin,
                points[:, 0].max() + margin,
                points[:, 1].max() + margin,
            ]
        )


def _shared_frames(first: Track, second: Track) -> BoolArray:
    return np.isfinite(first.centre()[:, 0]) & np.isfinite(second.centre()[:, 0])


def _frame_trunks(track: Track) -> FloatArray:
    return np.linalg.norm(sk.shoulders(track.points) - sk.hips(track.points), axis=-1)


def _positions_along_boat(rowers: list[Track]) -> FloatArray:
    """Place rowers on one line, in trunk lengths, from their gaps while both are in view.

    Solving all the gaps together links people who were never on screen at the same time, through
    the rowers who overlap both. Positions are only comparable where such a chain exists.
    """
    rows = []
    gaps = []
    for first, second in combinations(range(len(rowers)), 2):
        shared = _shared_frames(rowers[first], rowers[second])
        if shared.sum() < MIN_SHARED_FRAMES:
            continue
        offset = rowers[first].centre()[shared, 0] - rowers[second].centre()[shared, 0]
        # Per-frame size, because zooming changes the distance between seats in pixels.
        sizes = (_frame_trunks(rowers[first])[shared] + _frame_trunks(rowers[second])[shared]) / 2
        row = np.zeros(len(rowers))
        row[first], row[second] = 1, -1
        rows.append(row)
        gaps.append(float(np.nanmedian(offset / sizes)))
    if not rows:
        return np.zeros(len(rowers))
    return np.linalg.lstsq(np.array(rows), np.array(gaps), rcond=None)[0]


def _joined(first: Track, second: Track) -> Track:
    points, scores = first.points.copy(), first.scores.copy()
    missing = ~np.isfinite(points[:, 5, 0]) & np.isfinite(second.points[:, 5, 0])
    points[missing] = second.points[missing]
    scores[missing] = second.scores[missing]
    return Track(points, scores)


def _merge_same_seat(rowers: list[Track]) -> list[Track]:
    """Join tracks of one person: same place in the boat, and almost never on screen together."""
    positions = _positions_along_boat(rowers)
    connected = _components(
        len(rowers),
        [
            (first, second)
            for first, second in combinations(range(len(rowers)), 2)
            if _shared_frames(rowers[first], rowers[second]).sum() >= MIN_SHARED_FRAMES
        ],
    )
    merged: list[Track] = []
    for group in connected:
        slots: list[tuple[float, Track]] = []
        for index in sorted(group, key=lambda item: rowers[item].coverage, reverse=True):
            track = rowers[index]
            for slot, (position, existing) in enumerate(slots):
                overlap = int(_shared_frames(existing, track).sum())
                shortest = min(existing.coverage, track.coverage) * len(track.points)
                close = abs(position - positions[index]) <= SAME_SEAT_TRUNKS
                if close and overlap <= MAX_DISJOINT_OVERLAP * shortest:
                    slots[slot] = (position, _joined(existing, track))
                    break
            else:
                slots.append((float(positions[index]), track))
        merged.extend(track for _, track in slots)
    return merged


def fit_to_seats(rowers: list[Track], seats: int) -> list[Track]:
    """Merge the closest tracks that never overlap until the crew fits the boat class.

    The athlete has told us how many people are in the boat, which is stronger evidence than any
    distance limit. Tracks seen together are always different people, so they are never merged.
    """
    crew = list(rowers)
    while len(crew) > seats:
        positions = _positions_along_boat(crew)
        best: tuple[float, int, int] | None = None
        for first, second in combinations(range(len(crew)), 2):
            overlap = int(_shared_frames(crew[first], crew[second]).sum())
            shortest = min(crew[first].coverage, crew[second].coverage) * len(crew[first].points)
            if overlap > MAX_DISJOINT_OVERLAP * shortest:
                continue
            gap = abs(float(positions[first] - positions[second]))
            if best is None or gap < best[0]:
                best = (gap, first, second)
        if best is None:
            return crew
        _, first, second = best
        joined = _joined(crew[first], crew[second])
        crew = [track for index, track in enumerate(crew) if index not in (first, second)]
        crew.append(joined)
    return crew


def _same_boat(first: Track, second: Track, fps: float) -> bool:
    """Return True if two people are seen together, at a similar size, on the same line."""
    a, b = first.centre(), second.centre()
    shared = np.isfinite(a[:, 0]) & np.isfinite(b[:, 0])
    if shared.sum() < MIN_SHARED_SECONDS * fps:
        return False
    sizes = first.trunk(), second.trunk()
    if max(sizes) / min(sizes) > MAX_SIZE_RATIO:
        return False
    height_gap = float(np.median(np.abs(a[shared, 1] - b[shared, 1])))
    return height_gap <= SAME_LINE_TRUNKS * max(sizes)


def _components(count: int, links: list[tuple[int, int]]) -> list[list[int]]:
    parent = list(range(count))

    def root(index: int) -> int:
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    for first, second in links:
        parent[root(first)] = root(second)
    groups: dict[int, list[int]] = {}
    for index in range(count):
        groups.setdefault(root(index), []).append(index)
    return list(groups.values())


def _merge_separate_shots(boats: list[Boat]) -> list[Boat]:
    """Join groups never on screen together, which is one boat seen before and after a pan."""
    merged: list[Boat] = []
    for boat in sorted(boats, key=lambda item: int(item.seen().sum()), reverse=True):
        for existing in merged:
            shared = int((existing.seen() & boat.seen()).sum())
            shortest = min(int(existing.seen().sum()), int(boat.seen().sum()))
            sizes = existing.trunk_px, boat.trunk_px
            if shared <= MAX_DISJOINT_OVERLAP * shortest and max(sizes) / min(sizes) <= 2.5:
                existing.tracks.extend(boat.tracks)
                existing.rowers.extend(boat.rowers)
                break
        else:
            merged.append(boat)
    return merged


def _distant_groups(tracks: list[Track], fps: float) -> list[Boat]:
    """Group people too small to prove a rhythm, by size and height in the frame."""
    small = [track for track in tracks if track.trunk() < MIN_ANALYSIS_TRUNK_PX]
    heights = [float(np.nanmedian(track.centre()[:, 1])) for track in small]
    links = [
        (first, second)
        for first, second in combinations(range(len(small)), 2)
        if abs(heights[first] - heights[second])
        <= DISTANT_LINE_TRUNKS * max(small[first].trunk(), small[second].trunk())
    ]
    groups = []
    for group in _components(len(small), links):
        boat = Boat([small[index] for index in group], [])
        if len(group) >= MIN_DISTANT_PEOPLE and boat.seen().sum() >= MIN_DISTANT_SECONDS * fps:
            groups.append(boat)
    return groups


def find_boats(tracks: list[Track], fps: float) -> list[Boat]:
    """Return confirmed boats, the most visible first, then any distant unconfirmed boats."""
    links = [
        (first, second)
        for first, second in combinations(range(len(tracks)), 2)
        if _same_boat(tracks[first], tracks[second], fps)
    ]
    boats = []
    for group in _components(len(tracks), links):
        people = [tracks[index] for index in group]
        rowers = [track for track in people if is_rowing(track, fps)]
        if rowers:
            boats.append(Boat(people, _merge_same_seat(rowers)))
    confirmed = sorted(
        _merge_separate_shots(boats), key=lambda boat: int(boat.seen().sum()), reverse=True
    )
    claimed = {id(track) for boat in confirmed for track in boat.tracks}
    spare = [track for track in tracks if id(track) not in claimed]
    return confirmed + _distant_groups(spare, fps)


def preview_frame(boats: list[Boat]) -> int:
    """Return the frame showing the most boats, for the athlete to pick from."""
    if not boats:
        return 0
    return int(np.sum([boat.seen() for boat in boats], axis=0).argmax())


def boat_at(boats: list[Boat], frame: int, point: FloatArray) -> Boat | None:
    """Return the boat nearest a tapped point on a frame."""
    best: Boat | None = None
    best_distance = float("inf")
    for boat in boats:
        outline = boat.outline(frame)
        if outline is None:
            continue
        nearest = np.clip(point, outline[:2], outline[2:])
        distance = float(np.linalg.norm(point - nearest))
        if distance < best_distance:
            best, best_distance = boat, distance
    return best


def overlap_frames(chosen: Boat, others: list[Boat], frames: int) -> BoolArray:
    """Return a mask of frames where another boat's outline crosses the chosen boat's."""
    mask = np.zeros(frames, dtype=bool)
    for frame in np.where(chosen.seen())[0]:
        mine = chosen.outline(int(frame))
        if mine is None:
            continue
        for other in others:
            theirs = other.outline(int(frame))
            if theirs is None:
                continue
            separate = (
                mine[2] < theirs[0]
                or theirs[2] < mine[0]
                or mine[3] < theirs[1]
                or theirs[3] < mine[1]
            )
            mask[frame] = mask[frame] or not separate
    return mask

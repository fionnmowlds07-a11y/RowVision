"""Group tracked people into boats, so the athlete can say which boat is theirs."""

from dataclasses import dataclass
from itertools import combinations

import numpy as np
from numpy.typing import NDArray

from rowvision.seats import is_rowing
from rowvision.skeleton import FloatArray
from rowvision.tracking import MAX_SIZE_RATIO, Track

BoolArray = NDArray[np.bool_]

MIN_SHARED_SECONDS = 1.0
SAME_LINE_TRUNKS = 1.2
"""Most that rowers in one boat differ in height in the frame, in trunk lengths."""
MIN_ANALYSIS_TRUNK_PX = 15.0
"""Below this, one pixel of error moves the trunk angle by about 4 degrees."""
OUTLINE_MARGIN_TRUNKS = 1.0
MAX_DISJOINT_OVERLAP = 0.1


@dataclass
class Boat:
    tracks: list[Track]
    """Everyone grouped into this boat, including anyone who is not rowing, such as a cox."""
    rowers: list[Track]

    @property
    def trunk_px(self) -> float:
        return float(np.median([track.trunk() for track in self.rowers]))

    @property
    def too_far(self) -> bool:
        return self.trunk_px < MIN_ANALYSIS_TRUNK_PX

    def seen(self) -> BoolArray:
        """Return a mask of frames where any rower in the boat is visible."""
        return np.any([np.isfinite(track.centre()[:, 0]) for track in self.rowers], axis=0)

    def outline(self, frame: int) -> FloatArray | None:
        """Return the boat's x1, y1, x2, y2 on a frame, or None if it is out of view."""
        people = [track.points[frame] for track in self.rowers]
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


def find_boats(tracks: list[Track], fps: float) -> list[Boat]:
    """Return each boat with at least one rower, the most visible first."""
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
            boats.append(Boat(people, rowers))
    return sorted(
        _merge_separate_shots(boats), key=lambda boat: int(boat.seen().sum()), reverse=True
    )


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

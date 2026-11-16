"""Group tracked people into boats, so the athlete can say which boat is theirs."""

from dataclasses import dataclass, field
from itertools import combinations

import numpy as np
from numpy.typing import NDArray

from rowvision import skeleton as sk
from rowvision.seats import is_rowing
from rowvision.skeleton import FloatArray
from rowvision.strokes import facing_direction, reach_signal
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
CONFUSION_TRUNKS = 1.5
MIN_AGREEMENT_CREW = 3
MIN_AGREEMENT_FRAMES = 12
OUT_OF_TIME_MARGIN = 0.25
DISTANT_LINE_TRUNKS = 2.5
MIN_DISTANT_PEOPLE = 2
MIN_DISTANT_SECONDS = 5.0
OFF_LINE_TRUNKS = 1.0
"""Most that anyone in a boat sits off the straight line through its people, in trunk lengths.
On 16 real clips of one boat the furthest person was within 0.3. Two eights side by side, joined
through three short tracks between them, came to 4.7."""
MIN_LINE_PEOPLE = 3
DOUBLE_TRUNKS = 0.6
"""Two tracks this close along the boat while both are in view are one person found twice.
Neighbours in a boat sit about 2.5 trunk lengths apart."""
MIN_SPARE_SECONDS = 5.0
MUCH_LONGER = 2.0
"""A spare person seen this many times longer than a crew member takes their seat."""
MIN_SPARE_REACH = 0.5
"""Least a person's hands travel, against the crew's, to be taken for a rower. A cox's stay put."""


@dataclass
class Boat:
    tracks: list[Track]
    """Everyone grouped into this boat, including anyone who is not rowing, such as a cox."""
    rowers: list[Track]
    spare: list[Track] = field(default_factory=list)
    """People in the boat who show no stroke rhythm of their own: a cox, or a rower seen badly."""

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

    def crews(self) -> list[list[Track]]:
        """Return the rowers of each shot, the shot showing the most of the crew first.

        People in shots with no frames in common cannot be matched to each other, so seats come
        from one shot only.
        """
        links = [
            (first, second)
            for first, second in combinations(range(len(self.rowers)), 2)
            if _shared_frames(self.rowers[first], self.rowers[second]).sum() >= MIN_SHARED_FRAMES
        ]
        groups = sorted(_components(len(self.rowers), links), key=len, reverse=True)
        return [[self.rowers[index] for index in group] for group in groups]

    def crew(self) -> list[Track]:
        """Return the rowers from the shot showing the most of the crew."""
        return next(iter(self.crews()), [])

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


def crew_agreement(crew: list[Track]) -> list[float]:
    """Return how closely each person's stroke follows the rest of the crew, from -1 to 1.

    Rowers in a boat move together and a cox does not. NaN means too little shared footage.
    """
    if len(crew) < MIN_AGREEMENT_CREW:
        return [float("nan")] * len(crew)
    votes = sum(facing_direction(track.points) for track in crew)
    facing = 1 if votes > 0 else -1
    signals = np.array([reach_signal(track.points, facing) for track in crew])
    scores = []
    for index, signal in enumerate(signals):
        others = np.delete(signals, index, axis=0)
        known = np.isfinite(others).any(axis=0) & np.isfinite(signal)
        if known.sum() < MIN_AGREEMENT_FRAMES:
            scores.append(float("nan"))
            continue
        scores.append(float(np.corrcoef(signal[known], np.nanmedian(others[:, known], axis=0))[0, 1]))
    return scores


def _without_outliers(crew: list[Track], seats: int) -> list[Track]:
    """Drop people clearly out of time with the crew, but only while the boat has too many."""
    kept = list(crew)
    while len(kept) > seats:
        scores = np.array(crew_agreement(kept))
        if not np.isfinite(scores).any():
            return kept
        worst = int(np.nanargmin(scores))
        if np.nanmedian(scores) - scores[worst] < OUT_OF_TIME_MARGIN:
            return kept
        del kept[worst]
    return kept


def fit_to_seats(rowers: list[Track], seats: int) -> list[Track]:
    """Fit tracks to the boat class, which the athlete has told us.

    Tracks that never overlap and sit close together are merged, because tracks seen together are
    always different people. Anyone left over who is clearly out of time, such as a cox, is dropped.
    """
    return _without_outliers(_merge_to_fit(_without_doubles(rowers), seats), seats)


def _along_gap(first: Track, second: Track) -> float:
    """Return how far apart two people sit while both are in view, in trunk lengths, or NaN."""
    shared = _shared_frames(first, second)
    if shared.sum() < MIN_SHARED_FRAMES:
        return float("nan")
    gap = np.linalg.norm(first.centre()[shared] - second.centre()[shared], axis=-1)
    sizes = (_frame_trunks(first)[shared] + _frame_trunks(second)[shared]) / 2
    return float(np.nanmedian(gap / sizes))


def _without_doubles(rowers: list[Track]) -> list[Track]:
    """Drop the shorter of two tracks that sit in the same place at the same time.

    Two people cannot share a seat, so the shorter track is the same person found twice.
    """
    kept: list[Track] = []
    for track in sorted(rowers, key=lambda item: item.coverage, reverse=True):
        if not any(_along_gap(track, other) < DOUBLE_TRUNKS for other in kept):
            kept.append(track)
    return kept


def _reach_range(track: Track) -> float:
    reach = reach_signal(track.points, 1)
    known = reach[np.isfinite(reach)]
    return float(np.subtract(*np.percentile(known, [90, 10]))) if len(known) else 0.0


def _could_row(person: Track, crew: list[Track], fps: float) -> bool:
    """Return True if someone with no clear rhythm of their own still looks like one of the crew:
    seen with them for long enough, their size, on their line, in a seat of their own, and with
    hands that travel as a rower's do."""
    together = np.any([_shared_frames(person, rower) for rower in crew], axis=0)
    if together.sum() < MIN_SPARE_SECONDS * fps:
        return False
    size = float(np.median([rower.trunk() for rower in crew]))
    if max(size, person.trunk()) / min(size, person.trunk()) > MAX_SIZE_RATIO:
        return False
    if any(_along_gap(person, rower) < DOUBLE_TRUNKS for rower in crew):
        return False
    if _off_line([*crew, person]) > OFF_LINE_TRUNKS:
        return False
    travel = float(np.median([_reach_range(rower) for rower in crew]))
    return _reach_range(person) >= MIN_SPARE_REACH * travel


def _out_of_time(crew: list[Track]) -> int | None:
    scores = np.array(crew_agreement(crew))
    if not np.isfinite(scores).any():
        return None
    worst = int(np.nanargmin(scores))
    return worst if np.nanmedian(scores) - scores[worst] >= OUT_OF_TIME_MARGIN else None


def fill_from_spare(
    crew: list[Track], spare: list[Track], seats: int, fps: float
) -> tuple[list[Track], list[Track]]:
    """Give empty seats to people in the boat who look like rowers but show no clear rhythm.

    Returns the crew and those added. A rower half hidden behind the cox may never show a rhythm,
    and leaving them out moves every seat number along by one. In a full crew, someone clearly
    out of time gives up their place, such as a cox whose arms happened to keep a beat. Failing
    that, so does someone seen for under half as long, which is a stray track and not a rower.
    """
    crew, added = list(crew), []
    waiting = sorted(spare, key=lambda item: item.coverage, reverse=True)
    while crew and waiting:
        person = next((item for item in waiting if _could_row(item, crew, fps)), None)
        if person is None:
            break
        if len(crew) >= seats:
            leaving = _out_of_time(crew)
            if leaving is None:
                briefest = min(range(len(crew)), key=lambda index: crew[index].coverage)
                if person.coverage < MUCH_LONGER * crew[briefest].coverage:
                    break
                leaving = briefest
            del crew[leaving]
        waiting.remove(person)
        crew.append(person)
        added.append(person)
    return crew, added


def _merge_to_fit(rowers: list[Track], seats: int) -> list[Track]:
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


def _line_gap(first: Track, second: Track, fps: float) -> float | None:
    """Return how far apart in height two people of one boat sit, in trunk lengths, or None if
    they are not seen together, at a similar size, on the same line."""
    a, b = first.centre(), second.centre()
    shared = np.isfinite(a[:, 0]) & np.isfinite(b[:, 0])
    if shared.sum() < MIN_SHARED_SECONDS * fps:
        return None
    sizes = first.trunk(), second.trunk()
    if max(sizes) / min(sizes) > MAX_SIZE_RATIO:
        return None
    gap = float(np.median(np.abs(a[shared, 1] - b[shared, 1]))) / max(sizes)
    return gap if gap <= SAME_LINE_TRUNKS else None


def _same_boat(first: Track, second: Track, fps: float) -> bool:
    """Return True if two people are seen together, at a similar size, on the same line."""
    return _line_gap(first, second, fps) is not None


def _off_line(people: list[Track]) -> float:
    """Return how far the furthest person sits from the straight line through everyone, in trunk
    lengths, as the median over frames showing enough people. Zero when no frame shows enough.

    A crew sits along its boat, so its people fall on one line from any camera position. Two boats
    side by side make two lines.
    """
    centres = np.array([track.centre() for track in people])
    trunks = np.array([_frame_trunks(track) for track in people])
    seen = np.isfinite(centres[:, :, 0]) & np.isfinite(trunks)
    furthest = []
    for frame in np.where(seen.sum(axis=0) >= MIN_LINE_PEOPLE)[0]:
        points = centres[seen[:, frame], frame]
        offsets = points - points.mean(axis=0)
        across = np.linalg.svd(offsets, full_matrices=False)[2][1]
        furthest.append(np.abs(offsets @ across).max() / np.median(trunks[seen[:, frame], frame]))
    return float(np.median(furthest)) if furthest else 0.0


def _boat_groups(tracks: list[Track], fps: float) -> list[list[int]]:
    """Group people into boats, joining the closest pairs first.

    A pair is only joined while everyone in the two groups still sits on one line. Without this, a
    few short tracks between two crews rowing side by side chained them into one boat.
    """
    gaps = []
    for first, second in combinations(range(len(tracks)), 2):
        gap = _line_gap(tracks[first], tracks[second], fps)
        if gap is not None:
            gaps.append((gap, first, second))
    group_of = {index: [index] for index in range(len(tracks))}
    for _, first, second in sorted(gaps):
        one, other = group_of[first], group_of[second]
        if one is other:
            continue
        joined = one + other
        if _off_line([tracks[index] for index in joined]) > OFF_LINE_TRUNKS:
            continue
        for index in joined:
            group_of[index] = joined
    return list({id(group): group for group in group_of.values()}.values())


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
                existing.spare.extend(boat.spare)
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
    boats = []
    for group in _boat_groups(tracks, fps):
        people = [tracks[index] for index in group]
        rowers = [track for track in people if is_rowing(track, fps)]
        if rowers:
            spare = [track for track in people if all(track is not rower for rower in rowers)]
            boats.append(Boat(people, _merge_same_seat(rowers), spare))
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
    """Return a mask of frames where someone in another boat could be confused with a rower here.

    Only people of a similar size count, so a distant boat passing behind does not, however much
    its outline overlaps. They must also be close to a rower, not just near the boat's outline.
    """
    mask = np.zeros(frames, dtype=bool)
    limit = CONFUSION_TRUNKS * chosen.trunk_px
    for other in others:
        sizes = chosen.trunk_px, other.trunk_px
        if max(sizes) / min(sizes) > MAX_SIZE_RATIO:
            continue
        for rower in chosen.members:
            for person in other.members:
                gap = np.linalg.norm(rower.centre() - person.centre(), axis=-1)
                mask |= gap[:frames] <= limit
    return mask

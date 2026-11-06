"""Follow each person through a clip, using per-frame pose detections."""

from dataclasses import dataclass

import numpy as np

from rowvision import skeleton as sk
from rowvision.skeleton import FloatArray

MIN_SHOULDER_SCORE = 0.1
"""Deliberately permissive. Small rowers score low even when placed correctly, and the rhythm and
boat checks reject false detections later. Hip scores are ignored because the hull hides hips."""
DUPLICATE_DISTANCE_TRUNKS = 0.5
MIN_TRUNK_PX = 6.0
"""Smaller than this is not a usable person, and a zero length would break size comparisons."""
MATCH_DISTANCE_TRUNKS = 1.0
MAX_MISSED_SECONDS = 1.0
MAX_SIZE_RATIO = 1.6
NEIGHBOUR_DISTANCE_TRUNKS = 8.0
MAX_STITCH_SECONDS = 3.0
STITCH_DISTANCE_TRUNKS = 2.0
ZOOM_MIN_RATIO = 1.25
"""A change in everyone's size this big between detections means the camera zoomed."""
ZOOM_MIN_PEOPLE = 4
ZOOM_FIT_TRUNKS = 0.6
ZOOM_MIN_FIT = 0.75
"""The share of people who must land on a detection, and agree in size, for a zoom to count."""
ZOOM_SIZE_AGREEMENT = 1.3
TORSO = [sk.LEFT_SHOULDER, sk.RIGHT_SHOULDER, sk.LEFT_HIP, sk.RIGHT_HIP]
SHOULDERS = [sk.LEFT_SHOULDER, sk.RIGHT_SHOULDER]


@dataclass
class Track:
    """One person across the clip. Frames where they were not seen hold NaN."""

    points: FloatArray
    scores: FloatArray

    @property
    def coverage(self) -> float:
        return float(np.isfinite(self.points[:, sk.LEFT_SHOULDER, 0]).mean())

    def centre(self) -> FloatArray:
        return self.points[:, TORSO, :].mean(axis=1)

    def trunk(self) -> float:
        return _median_trunk(self)


def _torso_centres(points: FloatArray) -> FloatArray:
    return points[:, TORSO, :].mean(axis=1)


def _trunk_lengths(points: FloatArray) -> FloatArray:
    return np.linalg.norm(sk.shoulders(points) - sk.hips(points), axis=-1)


def clean_detections(points: FloatArray, scores: FloatArray) -> tuple[FloatArray, FloatArray]:
    """Drop weak detections and duplicates of one person, keeping the strongest of each group."""
    usable = (scores[:, SHOULDERS].mean(axis=1) >= MIN_SHOULDER_SCORE) & np.isfinite(points).all(
        axis=(1, 2)
    )
    points, scores = points[usable], scores[usable]
    if len(points) == 0:
        return points, scores
    real = _trunk_lengths(points) >= MIN_TRUNK_PX
    points, scores = points[real], scores[real]
    if len(points) < 2:
        return points, scores
    trunks = _trunk_lengths(points)
    centres = _torso_centres(points)
    kept: list[int] = []
    for index in np.argsort(scores.mean(axis=1))[::-1]:
        duplicate = any(
            np.linalg.norm(centres[index] - centres[other])
            < DUPLICATE_DISTANCE_TRUNKS * min(trunks[index], trunks[other])
            for other in kept
        )
        if not duplicate:
            kept.append(int(index))
    return points[kept], scores[kept]


def _match(
    predicted: FloatArray, sizes: FloatArray, found: FloatArray, found_sizes: FloatArray
) -> list[tuple[int, int]]:
    """Pair tracks with detections, closest pairs first, each used at most once.

    Limits come from each track's own body size, because a small rower in a distant boat and a
    large rower in a near boat move by very different amounts in the image.
    """
    if len(predicted) == 0 or len(found) == 0:
        return []
    distances = np.linalg.norm(predicted[:, None, :] - found[None, :, :], axis=-1)
    ratio = np.maximum(sizes[:, None], found_sizes[None, :]) / np.minimum(
        sizes[:, None], found_sizes[None, :]
    )
    allowed = (distances <= MATCH_DISTANCE_TRUNKS * sizes[:, None]) & (ratio <= MAX_SIZE_RATIO)
    pairs: list[tuple[int, int]] = []
    used_tracks: set[int] = set()
    used_found: set[int] = set()
    for flat in np.argsort(distances, axis=None):
        track, detection = (int(value) for value in np.unravel_index(flat, distances.shape))
        if allowed[track, detection] and track not in used_tracks and detection not in used_found:
            pairs.append((track, detection))
            used_tracks.add(track)
            used_found.add(detection)
    return pairs


def _local_motion(predicted: FloatArray, sizes: FloatArray, found: FloatArray) -> FloatArray:
    """Estimate each track's motion from its neighbours, which is mostly the camera panning.

    Rowers in one boat move together in the image, so the median shift of nearby tracks follows
    the boat. Using neighbours rather than the whole frame keeps separate boats independent.
    """
    shifts = np.zeros_like(predicted)
    if len(predicted) == 0 or len(found) == 0:
        return shifts
    offsets = found[None, :, :] - predicted[:, None, :]
    nearest = np.linalg.norm(offsets, axis=-1).argmin(axis=1)
    moves = offsets[np.arange(len(predicted)), nearest]
    gaps = np.linalg.norm(predicted[:, None, :] - predicted[None, :, :], axis=-1)
    for index in range(len(predicted)):
        ratio = np.maximum(sizes, sizes[index]) / np.minimum(sizes, sizes[index])
        near = (gaps[index] <= NEIGHBOUR_DISTANCE_TRUNKS * sizes[index]) & (ratio <= MAX_SIZE_RATIO)
        shifts[index] = np.median(moves[near], axis=0)
    return shifts


def _zoom(
    previous: FloatArray, sizes: FloatArray, found: FloatArray, found_sizes: FloatArray
) -> tuple[FloatArray, FloatArray] | None:
    """Return where tracks should now be and their new sizes if the camera has just zoomed.

    A zoom moves each rower by a different amount, far too much for matching by distance, and the
    person who lands nearest is often someone else. Everyone keeps their place relative to one
    another, so the zoom is the scale and shift that lands the most tracks on detections. People
    coming and going also move the median size, so most of them must fit, each at the same scale.
    """
    if min(len(previous), len(found)) < ZOOM_MIN_PEOPLE:
        return None
    scale = float(np.median(found_sizes) / np.median(sizes))
    if max(scale, 1 / scale) < ZOOM_MIN_RATIO:
        return None
    scaled = previous * scale
    tolerance = ZOOM_FIT_TRUNKS * float(np.median(found_sizes))
    best: tuple[int, float] | None = None
    moved = scaled
    nearest = np.zeros(len(previous), dtype=int)
    close = np.zeros(len(previous), dtype=bool)
    for shift in (found[None, :, :] - scaled[:, None, :]).reshape(-1, 2):
        gaps = np.linalg.norm((scaled + shift)[:, None, :] - found[None, :, :], axis=-1)
        within = gaps.min(axis=1) <= tolerance
        fit = (int(within.sum()), -float(gaps.min(axis=1)[within].sum()))
        if best is None or fit > best:
            best, moved, nearest, close = fit, scaled + shift, gaps.argmin(axis=1), within
    if best is None or best[0] < ZOOM_MIN_FIT * min(len(previous), len(found)):
        return None
    ratios = found_sizes[nearest[close]] / (sizes[close] * scale)
    agreeing = np.mean((ratios > 1 / ZOOM_SIZE_AGREEMENT) & (ratios < ZOOM_SIZE_AGREEMENT))
    return (moved, sizes * scale) if agreeing >= ZOOM_MIN_FIT else None


def _stitch(tracks: list[Track], fps: float) -> list[Track]:
    """Join track pieces where one person continues after a gap, such as behind another rower."""
    max_gap = round(MAX_STITCH_SECONDS * fps)
    while True:
        best: tuple[float, int, int] | None = None
        spans = [_span(track) for track in tracks]
        for first, (_, end) in enumerate(spans):
            for second, (start, _) in enumerate(spans):
                gap = start - end
                if first == second or not 0 < gap <= max_gap:
                    continue
                size = _median_trunk(tracks[first])
                other = _median_trunk(tracks[second])
                if max(size, other) / min(size, other) > MAX_SIZE_RATIO:
                    continue
                distance = float(
                    np.linalg.norm(tracks[second].centre()[start] - tracks[first].centre()[end])
                )
                limit = STITCH_DISTANCE_TRUNKS * size
                if distance <= limit and (best is None or distance < best[0]):
                    best = (distance, first, second)
        if best is None:
            return tracks
        _, first, second = best
        seen = np.isfinite(tracks[second].points[:, sk.LEFT_SHOULDER, 0])
        tracks[first].points[seen] = tracks[second].points[seen]
        tracks[first].scores[seen] = tracks[second].scores[seen]
        del tracks[second]


def _span(track: Track) -> tuple[int, int]:
    seen = np.where(np.isfinite(track.points[:, sk.LEFT_SHOULDER, 0]))[0]
    return int(seen[0]), int(seen[-1])


def _median_trunk(track: Track) -> float:
    return float(np.nanmedian(_trunk_lengths(track.points)))


def track_people(
    frame_points: list[FloatArray], frame_scores: list[FloatArray], fps: float
) -> list[Track]:
    """Link per-frame detections into tracks, longest coverage first."""
    total = len(frame_points)
    max_missed = round(MAX_MISSED_SECONDS * fps)
    tracks: list[Track] = []
    last_seen: list[FloatArray] = []
    last_size: list[float] = []
    last_frame: list[int] = []

    for frame in range(total):
        points, scores = clean_detections(frame_points[frame], frame_scores[frame])
        centres = _torso_centres(points) if len(points) else np.zeros((0, 2))
        found_sizes = _trunk_lengths(points) if len(points) else np.zeros(0)
        active = [i for i, seen in enumerate(last_frame) if frame - seen <= max_missed]
        previous = np.array([last_seen[i] for i in active]).reshape(-1, 2)
        sizes = np.array([last_size[i] for i in active])
        zoomed = _zoom(previous, sizes, centres, found_sizes)
        if zoomed is not None:
            predicted, sizes = zoomed
        else:
            predicted = previous + _local_motion(previous, sizes, centres)
        for slot, index in enumerate(active):
            last_seen[index] = predicted[slot]

        matched = set()
        for slot, detection in _match(predicted, sizes, centres, found_sizes):
            index = active[slot]
            tracks[index].points[frame] = points[detection]
            tracks[index].scores[frame] = scores[detection]
            last_seen[index] = centres[detection]
            last_size[index] = float(found_sizes[detection])
            last_frame[index] = frame
            matched.add(detection)

        for detection in range(len(points)):
            if detection in matched:
                continue
            track = Track(
                np.full((total, sk.JOINT_COUNT, 2), np.nan), np.zeros((total, sk.JOINT_COUNT))
            )
            track.points[frame] = points[detection]
            track.scores[frame] = scores[detection]
            tracks.append(track)
            last_seen.append(centres[detection])
            last_size.append(float(found_sizes[detection]))
            last_frame.append(frame)

    return sorted(_stitch(tracks, fps), key=lambda track: track.coverage, reverse=True)

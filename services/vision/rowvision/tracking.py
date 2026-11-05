"""Follow each person through a clip, using per-frame pose detections."""

from dataclasses import dataclass

import numpy as np

from rowvision import skeleton as sk
from rowvision.skeleton import FloatArray

MIN_TORSO_SCORE = 0.3
DUPLICATE_DISTANCE_TRUNKS = 0.5
MATCH_DISTANCE_TRUNKS = 1.0
MAX_MISSED_SECONDS = 1.0
TORSO = [sk.LEFT_SHOULDER, sk.RIGHT_SHOULDER, sk.LEFT_HIP, sk.RIGHT_HIP]


@dataclass
class Track:
    """One person across the clip. Frames where they were not seen hold NaN."""

    points: FloatArray
    scores: FloatArray

    @property
    def coverage(self) -> float:
        return float(np.isfinite(self.points[:, sk.LEFT_SHOULDER, 0]).mean())

    def centre(self) -> FloatArray:
        return np.nanmean(self.points[:, TORSO, :], axis=1)


def _torso_centres(points: FloatArray) -> FloatArray:
    return points[:, TORSO, :].mean(axis=1)


def _trunk_length(points: FloatArray) -> float:
    return float(np.median(np.linalg.norm(sk.shoulders(points) - sk.hips(points), axis=-1)))


def clean_detections(points: FloatArray, scores: FloatArray) -> tuple[FloatArray, FloatArray]:
    """Drop weak detections and duplicates of one person, keeping the strongest of each group."""
    usable = (scores[:, TORSO].mean(axis=1) >= MIN_TORSO_SCORE) & np.isfinite(points).all(axis=(1, 2))
    points, scores = points[usable], scores[usable]
    if len(points) < 2:
        return points, scores
    limit = DUPLICATE_DISTANCE_TRUNKS * _trunk_length(points)
    centres = _torso_centres(points)
    kept: list[int] = []
    for index in np.argsort(scores.mean(axis=1))[::-1]:
        distances = [np.linalg.norm(centres[index] - centres[other]) for other in kept]
        if all(distance >= limit for distance in distances):
            kept.append(int(index))
    return points[kept], scores[kept]


def _match(predicted: FloatArray, found: FloatArray, limit: float) -> list[tuple[int, int]]:
    """Pair tracks with detections, closest pairs first, each used at most once."""
    if len(predicted) == 0 or len(found) == 0:
        return []
    distances = np.linalg.norm(predicted[:, None, :] - found[None, :, :], axis=-1)
    pairs: list[tuple[int, int]] = []
    used_tracks: set[int] = set()
    used_found: set[int] = set()
    for flat in np.argsort(distances, axis=None):
        track, detection = (int(value) for value in np.unravel_index(flat, distances.shape))
        if distances[track, detection] > limit:
            break
        if track not in used_tracks and detection not in used_found:
            pairs.append((track, detection))
            used_tracks.add(track)
            used_found.add(detection)
    return pairs


def _shared_motion(predicted: FloatArray, found: FloatArray) -> FloatArray:
    """Estimate frame-to-frame motion shared by everyone, which is mostly the camera panning.

    Rowers in a boat move together in the image, so the median nearest-neighbour shift follows the
    camera, and tracks survive pans that would otherwise exceed the matching distance.
    """
    if len(predicted) == 0 or len(found) == 0:
        return np.zeros(2)
    offsets = found[None, :, :] - predicted[:, None, :]
    nearest = np.linalg.norm(offsets, axis=-1).argmin(axis=1)
    return np.median(offsets[np.arange(len(predicted)), nearest], axis=0)


def track_people(
    frame_points: list[FloatArray], frame_scores: list[FloatArray], fps: float
) -> list[Track]:
    """Link per-frame detections into tracks, longest coverage first."""
    total = len(frame_points)
    max_missed = round(MAX_MISSED_SECONDS * fps)
    tracks: list[Track] = []
    last_seen: list[FloatArray] = []
    last_frame: list[int] = []

    for frame in range(total):
        points, scores = clean_detections(frame_points[frame], frame_scores[frame])
        centres = _torso_centres(points) if len(points) else np.zeros((0, 2))
        active = [i for i, seen in enumerate(last_frame) if frame - seen <= max_missed]
        predicted = np.array([last_seen[i] for i in active]).reshape(-1, 2)
        shift = _shared_motion(predicted, centres)
        predicted = predicted + shift
        for index in range(len(last_seen)):
            if index in active:
                last_seen[index] = last_seen[index] + shift

        limit = MATCH_DISTANCE_TRUNKS * (_trunk_length(points) if len(points) else 0.0)
        pairs = _match(predicted, centres, limit)
        matched = set()
        for slot, detection in pairs:
            index = active[slot]
            tracks[index].points[frame] = points[detection]
            tracks[index].scores[frame] = scores[detection]
            last_seen[index] = centres[detection]
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
            last_frame.append(frame)

    return sorted(tracks, key=lambda track: track.coverage, reverse=True)

"""Find where the camera crosses to the other side of the boat during a clip.

Everything measured along the boat depends on which way the crew faces in the picture. A camera
that goes round the bow or stern sees the crew turn round, and the order of the seats across the
picture reverses with it. Each stretch has to be worked out apart.
"""

from itertools import groupby, pairwise

import numpy as np

from rowvision import skeleton as sk
from rowvision.skeleton import FloatArray
from rowvision.tracking import Track

FACING_WINDOW_SECONDS = 2.0
MIN_FACING_OFFSET = 0.04
"""Least the nose sits ahead of the ears, in trunk lengths, to say which way a crew faces. From
dead astern or ahead it is near zero."""
MIN_SIDE_SECONDS = 3.0
"""A crew must face one way for this long, either side of a change, for it to count."""


def _nose_ahead(track: Track) -> FloatArray:
    """Return how far the nose is to the right of the ears on each frame, in trunk lengths."""
    points = track.points
    ears = sk.midpoint(points, sk.LEFT_EAR, sk.RIGHT_EAR)
    trunk = np.linalg.norm(sk.shoulders(points) - sk.hips(points), axis=-1)
    with np.errstate(invalid="ignore", divide="ignore"):
        ahead: FloatArray = (points[:, sk.NOSE, 0] - ears[:, 0]) / trunk
    return ahead


def crew_facing(tracks: list[Track], fps: float) -> FloatArray:
    """Return which way the people in view face on each frame: +1 right, -1 left, 0 unclear."""
    if not tracks:
        return np.zeros(0)
    ahead = np.array([_nose_ahead(track) for track in tracks])
    seen = np.isfinite(ahead)
    crew = np.full(ahead.shape[1], np.nan)
    crew[seen.any(axis=0)] = np.nanmedian(ahead[:, seen.any(axis=0)], axis=0)
    half = max(round(FACING_WINDOW_SECONDS * fps / 2), 1)
    facing = np.zeros(len(crew))
    for frame in range(len(crew)):
        window = crew[max(frame - half, 0) : frame + half + 1]
        known = window[np.isfinite(window)]
        if len(known) >= half and abs(float(np.median(known))) >= MIN_FACING_OFFSET:
            facing[frame] = np.sign(np.median(known))
    return facing


def side_changes(tracks: list[Track], fps: float) -> list[int]:
    """Return the frames where the camera crosses to the other side of the boat."""
    facing = crew_facing(tracks, fps)
    signed = [(frame, int(sign)) for frame, sign in enumerate(facing) if sign]
    stretches = []
    for sign, group in groupby(signed, key=lambda item: item[1]):
        frames = [frame for frame, _ in group]
        if len(frames) >= MIN_SIDE_SECONDS * fps:
            stretches.append((sign, frames[0], frames[-1]))
    changes = []
    for (before, _, end), (after, start, _) in pairwise(stretches):
        if before != after:
            changes.append((end + start + 1) // 2)
    return changes


def split_at(tracks: list[Track], changes: list[int]) -> list[Track]:
    """Cut every track at the given frames, so no track runs from one side of the boat to the
    other. Pieces keep the full clip length, with NaN outside their own stretch."""
    if not changes:
        return tracks
    edges = [0, *changes, len(tracks[0].points) if tracks else 0]
    pieces = []
    for track in tracks:
        for start, end in pairwise(edges):
            if not np.isfinite(track.points[start:end, sk.LEFT_SHOULDER, 0]).any():
                continue
            points = np.full_like(track.points, np.nan)
            scores = np.zeros_like(track.scores)
            points[start:end], scores[start:end] = track.points[start:end], track.scores[start:end]
            pieces.append(Track(points, scores))
    return pieces

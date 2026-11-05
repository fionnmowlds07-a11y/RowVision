"""Split a video into shots, because camera angle and framing change within real clips."""

from dataclasses import dataclass
from enum import StrEnum

import numpy as np

from rowvision.skeleton import FloatArray

SIDE_ON_LIMIT_DEG = 25.0
OBLIQUE_LIMIT_DEG = 60.0
MIN_SHOT_SECONDS = 1.5


class ShotKind(StrEnum):
    SIDE_ON = "side_on"
    OBLIQUE = "oblique"
    END_ON = "end_on"
    NO_ROWING = "no_rowing"


@dataclass(frozen=True)
class Shot:
    start: int
    end: int
    """Exclusive end frame."""
    kind: ShotKind

    @property
    def frames(self) -> int:
        return self.end - self.start


def classify_view(view_deg: float) -> ShotKind:
    if not np.isfinite(view_deg):
        return ShotKind.NO_ROWING
    if view_deg <= SIDE_ON_LIMIT_DEG:
        return ShotKind.SIDE_ON
    if view_deg <= OBLIQUE_LIMIT_DEG:
        return ShotKind.OBLIQUE
    return ShotKind.END_ON


def _runs(kinds: list[ShotKind]) -> list[Shot]:
    shots: list[Shot] = []
    start = 0
    for index in range(1, len(kinds) + 1):
        if index == len(kinds) or kinds[index] != kinds[start]:
            shots.append(Shot(start, index, kinds[start]))
            start = index
    return shots


def split_shots(view_deg: FloatArray, fps: float) -> list[Shot]:
    """Group frames into shots from a per-frame view angle, where NaN means no rower was seen.

    Runs shorter than MIN_SHOT_SECONDS are absorbed into the longer neighbour, so brief detection
    flickers do not fragment the clip.
    """
    if len(view_deg) == 0:
        return []
    kinds = [classify_view(float(value)) for value in view_deg]
    minimum = round(MIN_SHOT_SECONDS * fps)
    while True:
        shots = _runs(kinds)
        short = [shot for shot in shots if shot.frames < minimum]
        if not short or len(shots) == 1:
            return shots
        shot = min(short, key=lambda item: item.frames)
        position = shots.index(shot)
        neighbours = shots[max(position - 1, 0) : position] + shots[position + 1 : position + 2]
        replacement = max(neighbours, key=lambda item: item.frames).kind
        kinds[shot.start : shot.end] = [replacement] * shot.frames

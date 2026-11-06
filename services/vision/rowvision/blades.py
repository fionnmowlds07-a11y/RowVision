"""Rules for measuring a rower's blade."""

import math
from dataclasses import dataclass

import numpy as np

from rowvision.skeleton import FloatArray

TRUNK_CM = 55.0
"""Typical hip to shoulder length, which sets the scale. Rowers differ by a few centimetres."""
RECOVERY_WINDOW = (0.3, 0.7)
"""The part of the recovery measured. Near either end the blade is on its way to the water."""
ENTRY_FRAMES = 1
MIN_SWING_TRUNKS = 1.0
"""A blade that barely moves along the boat gives no usable waterline."""
MIN_RECOVERY_FRAMES = 3
MIN_BLADE_STROKES = 3


def blade_faces_camera(side: str, facing: int) -> bool:
    """Return True when the rower's blade is on the camera's side of the boat.

    A rower facing image-right shows the camera their right side. Stroke side rowers have their
    oar on the right and bow side on the left. Scullers have a blade on each side, so one always
    faces the camera. Blades on the far side are left out, as the hull hides the water below them.

    `facing` is +1 for image-right, -1 for image-left and 0 when it is not known.
    """
    if side == "scull":
        return True
    if side == "stroke":
        return facing > 0
    if side == "bow":
        return facing < 0
    raise ValueError(f"unknown side: {side}")


@dataclass(frozen=True)
class BladeHeight:
    """Height of the blade above the water through the middle of the recovery."""

    height_cm: float
    """Median across strokes."""
    spread_cm: float
    """Interquartile range across strokes. Small means consistent."""
    strokes: int


def recovery_height_cm(
    points: FloatArray, finish: int, next_catch: int, trunk_px: float
) -> float:
    """Return how far the blade sits above the water in the middle of one recovery, or NaN.

    Not yet usable. This takes the line from finish to catch as the waterline, which is wrong:
    the blade is nearest the camera mid-recovery, where the water sits lower in the image, so real
    clips came out negative. The blade's path through the drive is the better waterline, but on
    real footage the height is still lost in noise.
    """
    leaves = _position_at(points, finish)
    enters = _position_at(points, next_catch)
    if leaves is None or enters is None or abs(enters[0] - leaves[0]) < MIN_SWING_TRUNKS * trunk_px:
        return math.nan
    span = next_catch - finish
    start = finish + round(span * RECOVERY_WINDOW[0])
    end = finish + round(span * RECOVERY_WINDOW[1])
    middle = points[start : end + 1]
    middle = middle[np.isfinite(middle).all(axis=1)]
    if len(middle) < MIN_RECOVERY_FRAMES:
        return math.nan
    slope = (enters[1] - leaves[1]) / (enters[0] - leaves[0])
    water = leaves[1] + slope * (middle[:, 0] - leaves[0])
    return float(np.median(water - middle[:, 1]) / trunk_px * TRUNK_CM)


def _position_at(points: FloatArray, frame: int) -> FloatArray | None:
    """Return the median blade position around a frame, or None if it was not found there."""
    nearby = points[max(frame - ENTRY_FRAMES, 0) : frame + ENTRY_FRAMES + 1]
    nearby = nearby[np.isfinite(nearby).all(axis=1)]
    return np.median(nearby, axis=0) if len(nearby) else None


def blade_height(
    points: FloatArray, recoveries: list[tuple[int, int]], trunk_px: float
) -> BladeHeight | None:
    """Return the blade height across strokes, or None with too few good strokes to trust."""
    heights = np.array(
        [recovery_height_cm(points, start, end, trunk_px) for start, end in recoveries]
    )
    heights = heights[np.isfinite(heights)]
    if len(heights) < MIN_BLADE_STROKES:
        return None
    return BladeHeight(
        float(np.median(heights)),
        float(np.subtract(*np.percentile(heights, [75, 25]))),
        len(heights),
    )

"""Angle measurement in image space, with correction for an off-side camera."""

import numpy as np

from rowvision.skeleton import FloatArray

MAX_CORRECTABLE_VIEW_DEG = 75.0


def joint_angle(first: FloatArray, centre: FloatArray, last: FloatArray) -> FloatArray:
    """Return the inner angle in degrees at `centre`, for example the knee from hip and ankle."""
    a = first - centre
    b = last - centre
    dot = np.sum(a * b, axis=-1)
    cross = a[..., 0] * b[..., 1] - a[..., 1] * b[..., 0]
    return np.degrees(np.abs(np.arctan2(cross, dot)))


def lean_from_vertical(lower: FloatArray, upper: FloatArray, facing: int) -> FloatArray:
    """Return the segment's tilt from vertical in degrees, positive towards the facing direction.

    `facing` is -1 when the rower faces image-left and +1 when they face image-right.
    """
    dx = (upper[..., 0] - lower[..., 0]) * facing
    dy = lower[..., 1] - upper[..., 1]
    return np.degrees(np.arctan2(dx, dy))


def undo_foreshortening(
    points: FloatArray, origin: FloatArray, view_deg: float | FloatArray
) -> FloatArray:
    """Stretch points along the boat axis to recover a side-on view.

    A camera `view_deg` away from side-on compresses boat-axis distances by cos(view). Points
    are rescaled about `origin`. Vertical distances are unaffected by camera yaw. `view_deg` is
    one angle, or one per frame for points shaped (frames, joints, 2).
    """
    views = np.asarray(view_deg, dtype=float)
    if np.any(np.abs(views) > MAX_CORRECTABLE_VIEW_DEG):
        raise ValueError(f"view of {np.abs(views).max():.0f} degrees is too far from side-on to correct")
    corrected = np.array(points, dtype=float)
    scale = 1 / np.cos(np.radians(views))
    if scale.ndim:
        scale = scale[:, None]
    corrected[..., 0] = origin[..., 0] + (corrected[..., 0] - origin[..., 0]) * scale
    return corrected

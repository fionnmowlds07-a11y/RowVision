"""Estimate how far the camera is from side-on, using the rower's own proportions."""

import numpy as np

from rowvision import skeleton as sk
from rowvision.skeleton import FloatArray

SHOULDER_TO_TRUNK_RATIO = 0.73
"""Typical shoulder width over hip-to-shoulder length. Varies by athlete, so estimates are rough."""

TRUNK_PERCENTILE = 90


def estimate_view_deg(points: FloatArray) -> float:
    """Return the camera's angle away from side-on, from 0 (side-on) to 90 (end-on).

    Turning the camera towards the bow or stern widens the apparent shoulders but leaves vertical
    trunk height unchanged, so their ratio gives the angle. Direction of the turn is not known.
    Camera elevation is ignored, which is reasonable for a launch at water level.
    """
    separation = np.abs(points[:, sk.LEFT_SHOULDER, 0] - points[:, sk.RIGHT_SHOULDER, 0])
    height = np.abs(sk.shoulders(points)[:, 1] - sk.hips(points)[:, 1])
    trunk = np.nanpercentile(height, TRUNK_PERCENTILE)
    if not np.isfinite(trunk) or trunk <= 0:
        raise ValueError("cannot estimate view without a visible trunk")
    ratio = np.nanmedian(separation) / (SHOULDER_TO_TRUNK_RATIO * trunk)
    return float(np.degrees(np.arcsin(np.clip(ratio, 0, 1))))

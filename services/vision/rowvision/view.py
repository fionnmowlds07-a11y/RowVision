"""Estimate how far the camera is from side-on, using the rower's own proportions."""

import warnings

import numpy as np

from rowvision import skeleton as sk
from rowvision.skeleton import FloatArray

SHOULDER_TO_TRUNK_RATIO = 0.73
"""Typical shoulder width over hip-to-shoulder length. Varies by athlete, so estimates are rough."""

TRUNK_PERCENTILE = 90
TURN_WINDOW_FRAMES = 61
"""About two seconds, so the answer follows a camera that pans past the boat."""
MIN_TURN_AGREEMENT = 0.5
"""How far apart the named shoulders must sit on average, as a share of how far apart any two
sit. Near side-on the model mixes up left and right, the two cancel, and no direction is given.
At a half, three frames in four name them the same way round."""


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


def _rolling_mean(values: FloatArray, window: int) -> FloatArray:
    padded = np.pad(values, window // 2, constant_values=np.nan)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        return np.nanmean(np.lib.stride_tricks.sliding_window_view(padded, window), axis=1)


def camera_turn(
    points: FloatArray | list[FloatArray], facing: int, window: int = TURN_WINDOW_FRAMES
) -> FloatArray:
    """Return which way the camera is turned from side-on on each frame.

    Takes one rower's joints or a whole crew's. A crew shares one camera, so its answer is steadier.

    +1 is towards the stern, where it sees the rowers' fronts, -1 is towards the bow, and 0 is
    unclear. Rowers face the stern, so the shoulder nearer the camera is the right one when they
    face image-right. Turning the camera towards the stern moves that shoulder back in the picture,
    behind the far one.
    """
    near, far = (
        (sk.RIGHT_SHOULDER, sk.LEFT_SHOULDER) if facing > 0 else (sk.LEFT_SHOULDER, sk.RIGHT_SHOULDER)
    )
    crew = np.array(points if isinstance(points, list) else [points])
    each = (crew[:, :, near, 0] - crew[:, :, far, 0]) * facing
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        ahead = np.nanmedian(each, axis=0)
        gap = np.nanmedian(np.abs(each), axis=0)
    signed = _rolling_mean(ahead, window)
    apart = _rolling_mean(gap, window)
    with np.errstate(invalid="ignore"):
        clear = np.abs(signed) >= MIN_TURN_AGREEMENT * apart
    return np.where(clear & (apart > 0), -np.sign(signed), 0.0)


def rigger_towards_camera(side: str | None, facing: int) -> int:
    """Return +1 if a sweep rower's rigger is on the camera's side of the boat, -1 if on the far
    side, and 0 for a sculler or when the side is not known.

    Rowers face the stern, so stroke side is on their right. Facing image-right, their right is
    towards the camera.
    """
    if side not in ("stroke", "bow"):
        return 0
    return facing if side == "stroke" else -facing

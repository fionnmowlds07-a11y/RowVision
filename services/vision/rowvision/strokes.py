"""Find the rower's facing direction and split a clip into strokes."""

from dataclasses import dataclass

import numpy as np

from rowvision import skeleton as sk
from rowvision.skeleton import FloatArray

MIN_RATE_SPM = 14.0
MAX_RATE_SPM = 48.0
SMOOTHING_SECONDS = 0.15
HARMONIC_TOLERANCE = 0.85


@dataclass(frozen=True)
class StrokeTimeline:
    catches: list[int]
    finishes: list[int]
    rate_spm: float
    regularity: float
    """Autocorrelation at the stroke period, from 0 (no rhythm) to 1 (perfectly repeating)."""


def facing_direction(points: FloatArray) -> int:
    """Return -1 if the rower faces image-left and +1 if image-right, from nose against ears."""
    ears = sk.midpoint(points, sk.LEFT_EAR, sk.RIGHT_EAR)
    offset = points[..., sk.NOSE, 0] - ears[..., 0]
    return 1 if np.nanmedian(offset) > 0 else -1


def reach_signal(points: FloatArray, facing: int) -> FloatArray:
    """Return hand position ahead of the knees, in trunk lengths.

    Measuring between body points removes camera movement, and dividing by trunk length removes
    zoom. Knees are used because they stay close to fixed in the boat: hand-to-hip distance
    plateaus while the legs compress, which leaves the catch poorly defined. Frames without knees
    fall back to the hips.
    """
    trunk = np.linalg.norm(sk.shoulders(points) - sk.hips(points), axis=-1)
    anchor = sk.knees(points)[:, 0]
    anchor = np.where(np.isfinite(anchor), anchor, sk.hips(points)[:, 0])
    return (sk.wrists(points)[:, 0] - anchor) * facing / np.nanmedian(trunk)


def _fill_gaps(signal: FloatArray) -> FloatArray:
    known = np.isfinite(signal)
    if not known.any():
        raise ValueError("no usable frames in signal")
    positions = np.arange(len(signal))
    return np.interp(positions, positions[known], signal[known])


def _smooth(signal: FloatArray, fps: float) -> FloatArray:
    width = max(round(SMOOTHING_SECONDS * fps) | 1, 3)
    padded = np.pad(signal, width // 2, mode="edge")
    return np.convolve(padded, np.ones(width) / width, mode="valid")


def _stroke_period(signal: FloatArray, fps: float) -> tuple[int, float]:
    centred = signal - signal.mean()
    count = len(centred)
    correlation = np.correlate(centred, centred, "full")[count - 1 :]
    if correlation[0] <= 0:
        return 0, 0.0
    # Normalise for the shrinking overlap at longer lags, so that short clips are not penalised.
    correlation = correlation / correlation[0] * count / (count - np.arange(count))
    shortest = int(fps * 60 / MAX_RATE_SPM)
    longest = min(int(fps * 60 / MIN_RATE_SPM), count - 1)
    if longest <= shortest:
        return 0, 0.0
    window = correlation[shortest:longest]
    best = window.max()
    # Multiples of the true period score equally well, so take the earliest strong peak.
    rising = window[1:-1] >= window[:-2]
    falling = window[1:-1] > window[2:]
    strong = window[1:-1] >= HARMONIC_TOLERANCE * best
    peaks = np.where(rising & falling & strong)[0] + 1
    lag = shortest + (int(peaks[0]) if len(peaks) else int(np.argmax(window)))
    return lag, float(np.clip(correlation[lag], 0, 1))


def _peaks(signal: FloatArray, spacing: int) -> list[int]:
    """Return local maxima at least `spacing` frames apart, strongest first, then sorted."""
    threshold = signal.mean()
    inner = (signal[1:-1] >= signal[:-2]) & (signal[1:-1] > signal[2:]) & (signal[1:-1] > threshold)
    candidates = np.where(inner)[0] + 1
    chosen: list[int] = []
    for index in candidates[np.argsort(signal[candidates])[::-1]]:
        if all(abs(int(index) - other) >= spacing for other in chosen):
            chosen.append(int(index))
    return sorted(chosen)


def detect_strokes(reach: FloatArray, fps: float) -> StrokeTimeline:
    """Find catches (maximum reach) and finishes (minimum reach) in a reach signal."""
    smoothed = _smooth(_fill_gaps(reach), fps)
    lag, regularity = _stroke_period(smoothed, fps)
    if lag == 0:
        return StrokeTimeline([], [], 0.0, 0.0)
    spacing = int(lag * 0.6)
    catches = _peaks(smoothed, spacing)
    finishes = _peaks(-smoothed, spacing)
    return StrokeTimeline(catches, finishes, 60 * fps / lag, regularity)

"""Find the rower's facing direction and split a clip into strokes."""

from dataclasses import dataclass

import numpy as np

from rowvision import skeleton as sk
from rowvision.skeleton import FloatArray

MIN_RATE_SPM = 14.0
MAX_RATE_SPM = 48.0
SMOOTHING_SECONDS = 0.15
HARMONIC_TOLERANCE = 0.85
RHYTHM_TOLERANCE = 0.12
MAX_GAP_SECONDS = 1.0
MIN_REACH_RANGE = 0.3
"""Smallest hand travel, in trunk lengths, that counts as rowing. Excludes a still cox."""


@dataclass(frozen=True)
class StrokeTimeline:
    catches: list[int]
    finishes: list[int]
    rate_spm: float
    regularity: float
    """Autocorrelation at the stroke period, from 0 (no rhythm) to 1 (perfectly repeating)."""
    period_frames: float = 0.0


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


def _drop_outliers(frames: list[int], lag: int) -> list[int]:
    """Remove events that break the stroke rhythm, such as a false peak in noisy keypoints.

    An event is kept if a neighbour sits about one period (or a whole number of periods) away.
    """
    kept = []
    for frame in frames:
        gaps = [abs(frame - other) / lag for other in frames if other != frame]
        if any(abs(gap - round(gap)) <= RHYTHM_TOLERANCE for gap in gaps if gap >= 0.5):
            kept.append(frame)
    return kept


def _detect_run(reach: FloatArray, fps: float) -> StrokeTimeline:
    """Analyse one continuous stretch of footage."""
    smoothed = _smooth(_fill_gaps(reach), fps)
    if np.ptp(smoothed) < MIN_REACH_RANGE:
        return StrokeTimeline([], [], 0.0, 0.0)
    lag, regularity = _stroke_period(smoothed, fps)
    if lag == 0:
        return StrokeTimeline([], [], 0.0, 0.0)
    spacing = int(lag * 0.6)
    catches = _drop_outliers(_peaks(smoothed, spacing), lag)
    finishes = _drop_outliers(_peaks(-smoothed, spacing), lag)
    return StrokeTimeline(catches, finishes, 60 * fps / lag, regularity, float(lag))


def continuous_runs(reach: FloatArray, fps: float) -> list[tuple[int, int]]:
    """Return (start, end) for stretches of footage, allowing only short gaps inside a stretch."""
    seen = np.where(np.isfinite(reach))[0]
    if len(seen) == 0:
        return []
    breaks = np.where(np.diff(seen) > MAX_GAP_SECONDS * fps)[0]
    starts = [int(seen[0]), *(int(seen[index + 1]) for index in breaks)]
    ends = [*(int(seen[index]) + 1 for index in breaks), int(seen[-1]) + 1]
    return list(zip(starts, ends, strict=True))


def detect_strokes(reach: FloatArray, fps: float) -> StrokeTimeline:
    """Find catches (maximum reach) and finishes (minimum reach) in a reach signal.

    Each continuous stretch is analysed separately, because interpolating across a long gap would
    invent motion. Rate and regularity come from the longest stretch.
    """
    runs = continuous_runs(reach, fps)
    if not runs:
        raise ValueError("no usable frames in signal")
    catches: list[int] = []
    finishes: list[int] = []
    longest = max(runs, key=lambda run: run[1] - run[0])
    main = StrokeTimeline([], [], 0.0, 0.0)
    for start, end in runs:
        timeline = _detect_run(reach[start:end], fps)
        catches.extend(frame + start for frame in timeline.catches)
        finishes.extend(frame + start for frame in timeline.finishes)
        if (start, end) == longest:
            main = timeline
    return StrokeTimeline(catches, finishes, main.rate_spm, main.regularity, main.period_frames)

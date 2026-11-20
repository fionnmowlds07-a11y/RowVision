"""Find the rower's facing direction and split a clip into strokes."""

from dataclasses import dataclass
from itertools import pairwise

import numpy as np
from numpy.typing import NDArray

from rowvision import skeleton as sk
from rowvision.skeleton import FloatArray

MIN_RATE_SPM = 14.0
MAX_RATE_SPM = 48.0
SMOOTHING_SECONDS = 0.15
HARMONIC_TOLERANCE = 0.85
RHYTHM_TOLERANCE = 0.12
MAX_GAP_SECONDS = 1.0
MIN_STROKES_FOR_SHAPE = 3
ALIGN_SEARCH_SHARE = 0.3
ALIGN_PASSES = 2
CATCH_RUN_UP_SHARE = 0.35
MIN_EVENT_SPACING = 0.7
MIN_REACH_RANGE = 0.3
FILL_PERIODS = (0.7, 1.4)
"""Two catches this many stroke periods apart are one stroke, so a finish lies between them."""
FILL_SEARCH_SHARE = 0.15
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


def _window(signal: FloatArray, centre: int, half: int) -> FloatArray | None:
    if centre - half < 0 or centre + half + 1 > len(signal):
        return None
    return signal[centre - half : centre + half + 1]


def _stroke_shape(signal: FloatArray, events: list[int], half: int) -> FloatArray | None:
    windows = [window for e in events if (window := _window(signal, e, half)) is not None]
    return np.median(windows, axis=0) if len(windows) >= MIN_STROKES_FOR_SHAPE else None


def _catch_position(shape: FloatArray) -> int:
    """Return where the catch falls in an average stroke: the last moment before the drive.

    Many rowers get their hands out early and hold them there up the slide, so the furthest point
    is an unreliable plateau. The steepest fall marks the drive, so the catch is the highest point
    in the run-up to it. Where the fall starts is no use: real drives begin slowly and steepen when
    the arms pull in.
    """
    length = len(shape)
    bottom = int(np.argmin(shape))
    cycle = np.roll(shape, -bottom)
    fall = int(np.argmax(-np.diff(cycle)))
    start = max(fall - round(CATCH_RUN_UP_SHARE * length), 0)
    return (start + int(np.argmax(cycle[start : fall + 1])) + bottom) % length


def _align_to_shape(signal: FloatArray, events: list[int], lag: int, sign: int) -> list[int]:
    """Place each event by matching the whole stroke to the rower's average stroke.

    The catch and finish are broad, flat peaks, so noise in one keypoint can move the single
    highest point a long way. Matching a full stroke uses every frame of it instead. `sign` is 1
    for maxima and -1 for minima.
    """
    half = lag // 2
    search = max(round(lag * ALIGN_SEARCH_SHARE), 1)
    aligned = list(events)
    for _ in range(ALIGN_PASSES):
        shape = _stroke_shape(signal, aligned, half)
        if shape is None:
            return aligned
        centred = shape - shape.mean()
        moved = []
        for event in aligned:
            if _window(signal, event, half) is None:
                moved.append(event)
                continue
            best, best_score = event, -np.inf
            for shift in range(-search, search + 1):
                window = _window(signal, event + shift, half)
                if window is None:
                    continue
                score = float(np.dot(window - window.mean(), centred))
                if score > best_score:
                    best, best_score = event + shift, score
            moved.append(best)
        aligned = moved
    shape = _stroke_shape(signal, aligned, half)
    if shape is None:
        return aligned
    peak = (_catch_position(shape) if sign > 0 else int(np.argmin(shape))) - half
    # Strokes cut off by the clip edge cannot be matched, so they are left out.
    placed = sorted({event + peak for event in aligned if _window(signal, event, half) is not None})
    return _spaced(placed, lag)


def _spaced(events: list[int], lag: int) -> list[int]:
    """Drop events too close to the one before, which come from strokes cut off by the clip edge."""
    kept: list[int] = []
    for event in events:
        if not kept or event - kept[-1] >= MIN_EVENT_SPACING * lag:
            kept.append(event)
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
    catches = _align_to_shape(smoothed, _drop_outliers(_peaks(smoothed, spacing), lag), lag, 1)
    finishes = _align_to_shape(smoothed, _drop_outliers(_peaks(-smoothed, spacing), lag), lag, -1)
    finishes = _with_missing(smoothed, catches, finishes, lag, -1)
    catches = _with_missing(smoothed, finishes, catches, lag, 1)
    return StrokeTimeline(catches, finishes, 60 * fps / lag, regularity, float(lag))


def _with_missing(
    signal: FloatArray, around: list[int], events: list[int], lag: int, sign: int
) -> list[int]:
    """Add the event that must lie between two marks one stroke apart when none was found there.

    Every stroke has one finish between its catches, and one catch between its finishes. One weak
    peak used to lose the whole stroke. The missing event goes where the rower's other strokes
    put theirs, as a share of the way between the marks, then to the nearest turn of the signal.
    `sign` is 1 to add a maximum and -1 to add a minimum.
    """
    shares = [
        (event - before) / (after - before)
        for before, after in pairwise(around)
        for event in events
        if before < event < after
    ]
    if not shares:
        return events
    share = float(np.median(shares))
    added = []
    for before, after in pairwise(around):
        one_stroke = FILL_PERIODS[0] * lag <= after - before <= FILL_PERIODS[1] * lag
        if not one_stroke or any(before < event < after for event in events):
            continue
        guess = before + round(share * (after - before))
        reach = max(round(FILL_SEARCH_SHARE * lag), 1)
        start, end = max(guess - reach, before + 1), min(guess + reach + 1, after)
        if end > start:
            added.append(start + int(np.argmax(sign * signal[start:end])))
    return sorted([*events, *added])


def crew_reach(signals: list[FloatArray]) -> FloatArray:
    """Combine a crew's reach signals, so one rower's noise cannot move the stroke timing."""
    scaled = [(signal - np.nanmean(signal)) / np.nanstd(signal) for signal in signals]
    stacked = np.array(scaled)
    combined = np.full(stacked.shape[1], np.nan)
    seen = np.isfinite(stacked).any(axis=0)
    combined[seen] = np.nanmedian(stacked[:, seen], axis=0)
    return combined


def continuous_runs(
    reach: FloatArray, fps: float, clear: NDArray[np.bool_] | None = None
) -> list[tuple[int, int]]:
    """Return (start, end) for stretches of footage, allowing only short gaps inside a stretch.

    `clear` says on which frames movement along the boat shows in the picture. A stretch is also
    cut wherever that changes, so a stretch is all clear or all not.
    """
    seen = np.where(np.isfinite(reach))[0]
    if len(seen) == 0:
        return []
    apart = np.diff(seen) > MAX_GAP_SECONDS * fps
    if clear is not None:
        apart |= clear[seen[1:]] != clear[seen[:-1]]
    breaks = np.where(apart)[0]
    starts = [int(seen[0]), *(int(seen[index + 1]) for index in breaks)]
    ends = [*(int(seen[index]) + 1 for index in breaks), int(seen[-1]) + 1]
    return list(zip(starts, ends, strict=True))


def detect_strokes(
    reach: FloatArray, fps: float, clear: NDArray[np.bool_] | None = None
) -> StrokeTimeline:
    """Find catches (maximum reach) and finishes (minimum reach) in a reach signal.

    Each continuous stretch is analysed separately, because interpolating across a long gap would
    invent motion. Rate and regularity come from the longest stretch.

    `clear` is False on frames filmed from so near the bow or stern that reach along the boat
    barely shows. Those frames are timed on their own. Each stroke is placed by matching it to the
    average stroke of its stretch, and on a real clip that panned from side-on to the bow, the
    shapeless end-on strokes blurred that average until every catch landed on a finish. Rate and
    regularity come from the longest clear stretch when there is one.
    """
    runs = continuous_runs(reach, fps, clear)
    if not runs:
        raise ValueError("no usable frames in signal")
    catches: list[int] = []
    finishes: list[int] = []
    trusted = [run for run in runs if clear is None or clear[run[0]]]
    longest = max(trusted or runs, key=lambda run: run[1] - run[0])
    main = StrokeTimeline([], [], 0.0, 0.0)
    for start, end in runs:
        timeline = _detect_run(reach[start:end], fps)
        catches.extend(frame + start for frame in timeline.catches)
        finishes.extend(frame + start for frame in timeline.finishes)
        if (start, end) == longest:
            main = timeline
    return StrokeTimeline(catches, finishes, main.rate_spm, main.regularity, main.period_frames)

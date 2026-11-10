"""Turn keypoints and a stroke timeline into per-stroke biomechanical measurements."""

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from rowvision import skeleton as sk
from rowvision.geometry import joint_angle, lean_from_vertical, undo_foreshortening
from rowvision.skeleton import FloatArray
from rowvision.strokes import StrokeTimeline

ONSET_FRACTION = 0.2
MIN_ANKLE_DROP_TRUNKS = 0.02
"""Feet sit below the seat, so an ankle level with or above the hip has been misplaced."""
MIN_SHIN_TO_THIGH, MAX_SHIN_TO_THIGH = 0.5, 1.7
MAX_KNEE_HEIGHT_GAP, MAX_ANKLE_HEIGHT_GAP = 0.15, 0.2
"""How far apart, in trunk lengths, the left and right knees or ankles may sit vertically. In side view
the two legs are level, so more than this means the model has put the hidden leg in the wrong place.
Across real clips the gap is under 0.12 on a good frame, and often over 0.23 on a bad one."""
CATCH_KNEE_RANGE = (30.0, 115.0)
FINISH_KNEE_RANGE = (130.0, 185.0)
"""What a body can do at each moment. Values outside are misplaced joints, not poor technique."""
MAX_STROKE_PERIODS = 1.6


@dataclass(frozen=True)
class AngleSeries:
    """Per-frame angles in degrees, corrected for camera view."""

    trunk_lean: FloatArray
    knee: FloatArray
    elbow: FloatArray


@dataclass(frozen=True)
class StrokeMetrics:
    catch_frame: int
    finish_frame: int
    next_catch_frame: int
    catch_lean_deg: float
    finish_lean_deg: float
    catch_knee_deg: float
    finish_knee_deg: float
    finish_elbow_deg: float
    drive_share: float
    """Share of the stroke cycle spent on the drive."""
    legs_lead: float
    """How far the legs lead the trunk off the catch, as a share of the drive. Positive is legs first."""


def legs_believable(side_on: FloatArray) -> NDArray[np.bool_]:
    """Return which frames have a lower leg a real body could make.

    The hull hides the feet, so the pose model often guesses, and can put an ankle up by the hands, or
    put the far leg well above the near one. Averaging a misplaced joint into the knee would drag the
    angle, so such frames are left out. Model confidence does not reliably show this (left and right
    are about equally confident), so the check uses anatomy instead.
    """
    hip, knee, ankle = sk.hips(side_on), sk.knees(side_on), sk.ankles(side_on)
    trunk = np.linalg.norm(sk.shoulders(side_on) - hip, axis=-1)
    knee_gap = np.abs(side_on[..., sk.LEFT_KNEE, 1] - side_on[..., sk.RIGHT_KNEE, 1])
    ankle_gap = np.abs(side_on[..., sk.LEFT_ANKLE, 1] - side_on[..., sk.RIGHT_ANKLE, 1])
    shin = np.linalg.norm(knee - ankle, axis=-1)
    thigh = np.linalg.norm(knee - hip, axis=-1)
    with np.errstate(divide="ignore", invalid="ignore"):
        drop = (ankle[..., 1] - hip[..., 1]) / trunk
        ratio = shin / thigh
        level = (knee_gap <= MAX_KNEE_HEIGHT_GAP * trunk) & (ankle_gap <= MAX_ANKLE_HEIGHT_GAP * trunk)
    return level & (drop >= MIN_ANKLE_DROP_TRUNKS) & (ratio >= MIN_SHIN_TO_THIGH) & (ratio <= MAX_SHIN_TO_THIGH)


def _within(value: float, limits: tuple[float, float]) -> float:
    """Return the value if a body could reach it, or NaN if it could not."""
    return value if limits[0] <= value <= limits[1] else float("nan")


def angle_series(points: FloatArray, facing: int, view_deg: float | FloatArray) -> AngleSeries:
    hip = sk.hips(points)
    side_on = undo_foreshortening(points, hip[:, None, :], view_deg)
    hip = sk.hips(side_on)
    shoulder = sk.shoulders(side_on)
    knee = joint_angle(hip, sk.knees(side_on), sk.ankles(side_on))
    return AngleSeries(
        trunk_lean=lean_from_vertical(hip, shoulder, facing),
        knee=np.where(legs_believable(side_on), knee, np.nan),
        elbow=joint_angle(shoulder, sk.elbows(side_on), sk.wrists(side_on)),
    )


def _onset(values: FloatArray) -> int | None:
    """Return the first index where `values` has covered ONSET_FRACTION of its overall change."""
    start, end = values[0], values[-1]
    if not np.isfinite([start, end]).all() or start == end:
        return None
    progress = (values - start) / (end - start)
    moved = np.where(progress >= ONSET_FRACTION)[0]
    return int(moved[0]) if len(moved) else None


def _legs_lead(angles: AngleSeries, catch: int, finish: int) -> float:
    legs = _onset(angles.knee[catch : finish + 1])
    trunk = _onset(angles.trunk_lean[catch : finish + 1])
    if legs is None or trunk is None:
        return float("nan")
    return (trunk - legs) / (finish - catch)


def per_stroke(angles: AngleSeries, timeline: StrokeTimeline) -> list[StrokeMetrics]:
    """Measure each complete stroke: a catch, the finish after it, and the next catch."""
    results = []
    for catch, next_catch in zip(timeline.catches, timeline.catches[1:]):
        finishes = [frame for frame in timeline.finishes if catch < frame < next_catch]
        too_long = timeline.period_frames and next_catch - catch > MAX_STROKE_PERIODS * timeline.period_frames
        if not finishes or too_long:
            continue
        finish = finishes[0]
        results.append(
            StrokeMetrics(
                catch_frame=catch,
                finish_frame=finish,
                next_catch_frame=next_catch,
                catch_lean_deg=float(angles.trunk_lean[catch]),
                finish_lean_deg=float(angles.trunk_lean[finish]),
                catch_knee_deg=_within(float(angles.knee[catch]), CATCH_KNEE_RANGE),
                finish_knee_deg=_within(float(angles.knee[finish]), FINISH_KNEE_RANGE),
                finish_elbow_deg=float(angles.elbow[finish]),
                drive_share=(finish - catch) / (next_catch - catch),
                legs_lead=_legs_lead(angles, catch, finish),
            )
        )
    return results

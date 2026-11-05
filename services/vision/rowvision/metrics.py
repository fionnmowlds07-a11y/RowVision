"""Turn keypoints and a stroke timeline into per-stroke biomechanical measurements."""

from dataclasses import dataclass

import numpy as np

from rowvision import skeleton as sk
from rowvision.geometry import joint_angle, lean_from_vertical, undo_foreshortening
from rowvision.skeleton import FloatArray
from rowvision.strokes import StrokeTimeline

ONSET_FRACTION = 0.2
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


def angle_series(points: FloatArray, facing: int, view_deg: float) -> AngleSeries:
    hip = sk.hips(points)
    side_on = undo_foreshortening(points, hip[:, None, :], view_deg)
    hip = sk.hips(side_on)
    shoulder = sk.shoulders(side_on)
    return AngleSeries(
        trunk_lean=lean_from_vertical(hip, shoulder, facing),
        knee=joint_angle(hip, sk.knees(side_on), sk.ankles(side_on)),
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
                catch_knee_deg=float(angles.knee[catch]),
                finish_knee_deg=float(angles.knee[finish]),
                finish_elbow_deg=float(angles.elbow[finish]),
                drive_share=(finish - catch) / (next_catch - catch),
                legs_lead=_legs_lead(angles, catch, finish),
            )
        )
    return results

"""Measure a saved result again from its saved joints, without running the pose models.

The slow part of an analysis is finding the joints on every frame. They are saved with each result
while its video is kept, so newer measuring code can be applied to an older result in seconds.
The strokes stay where they were marked, as a crew's strokes are timed from every rower and only
one rower's joints are saved. Timing against the rower being followed is carried over for the same
reason.
"""

from dataclasses import replace
from typing import Any

import numpy as np

from rowvision import skeleton as sk
from rowvision.pipeline import RowerResult, measure_rower
from rowvision.reliability import Band, Rating
from rowvision.report import rower_json
from rowvision.skeleton import FloatArray
from rowvision.strokes import StrokeTimeline
from rowvision.timing import FollowTiming


class NoSkeleton(ValueError):
    """Raised when a result has no saved joints, as after its video was removed."""


def saved_points(poses: list[Any], frames: int) -> tuple[FloatArray, FloatArray]:
    """Rebuild joint positions and confidences from the saved per-frame list."""
    points = np.full((frames, sk.JOINT_COUNT, 2), np.nan)
    scores = np.zeros((frames, sk.JOINT_COUNT))
    for frame, pose in enumerate(poses[:frames]):
        for joint, found in enumerate(pose or []):
            if found is not None:
                points[frame, joint] = found[:2]
                scores[frame, joint] = found[2]
    return points, scores


def saved_views(views: list[float | None] | None, view_deg: float | None, frames: int) -> FloatArray:
    """Return the camera angle each frame was corrected by, using the clip's figure in any gap."""
    fallback = 0.0 if view_deg is None else float(view_deg)
    if not views:
        return np.full(frames, fallback)
    return np.array([fallback if view is None else view for view in views[:frames]], dtype=float)


def saved_timeline(rower: dict[str, Any], fps: float) -> StrokeTimeline:
    """Return the strokes as they were marked when the clip was analysed."""
    rate = rower.get("rate_spm") or 0.0
    period = 60 * fps / rate if rate else 0.0
    return StrokeTimeline(list(rower["catches"]), list(rower["finishes"]), rate, 0.0, period)


def _saved_timing(timing: dict[str, Any] | None) -> FollowTiming | None:
    if timing is None or timing.get("leader_seat") is None:
        return None
    return FollowTiming(
        timing["leader_seat"],
        timing["catch_ms"],
        timing["finish_ms"],
        timing["catch_spread_ms"],
        timing["finish_spread_ms"],
        timing["strokes"],
    )


def _saved_rating(rating: dict[str, Any]) -> Rating:
    return Rating(
        rating["accuracy"],
        Band(rating["band"]),
        rating["calibrated"],
        list(rating["warnings"]),
        rating.get("labelled_frames", 0),
    )


def remeasure_rower(summary: dict[str, Any], frames: dict[str, Any]) -> RowerResult:
    """Measure the saved rower with the current code."""
    saved = summary.get("rower")
    poses = frames.get("poses")
    if saved is None or not poses:
        raise NoSkeleton("this result has no saved joints to measure from")
    count = int(summary["frames"])
    fps = float(summary["fps"])
    points, scores = saved_points(poses, count)
    evidence = saved.get("evidence")
    result = measure_rower(
        saved.get("seat"),
        points,
        scores,
        int(summary["facing"]),
        float(summary.get("view_deg") or 0.0),
        saved_views(frames.get("views"), summary.get("view_deg"), count),
        fps,
        saved_timeline(saved, fps),
        trunk_px=float(evidence["trunk_px"]) if evidence else 1.0,
        coverage=float(evidence["coverage"]) if evidence else 1.0,
        agreement=evidence.get("agreement") if evidence else None,
    )
    result = replace(result, timing=_saved_timing(saved.get("timing")))
    if evidence:
        return result
    # Older results did not save what the rating came from, so the rating itself is kept.
    return replace(result, rating=_saved_rating(saved["rating"]), evidence=None)


def remeasure(summary: dict[str, Any], frames: dict[str, Any]) -> dict[str, Any]:
    """Return a full report for a saved result, measured with the current code."""
    rower = remeasure_rower(summary, frames)
    count = int(summary["frames"])
    views = saved_views(frames.get("views"), summary.get("view_deg"), count)
    kept = {key: value for key, value in summary.items() if key not in ("rower", "version")}
    return {
        **kept,
        "views": frames.get("views"),
        "rower": rower_json(rower, count, int(summary["facing"]), views),
    }

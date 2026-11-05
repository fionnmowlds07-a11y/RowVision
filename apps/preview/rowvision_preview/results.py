"""Turn an analysis into plain JSON for the page."""

from dataclasses import asdict
from typing import Any

import numpy as np
from rowvision.metrics import StrokeMetrics, angle_series
from rowvision.pipeline import FILM_CLOSER, Analysis, BoatChoice, RowerResult
from rowvision.reference import Target
from rowvision.reliability import Rating
from rowvision.scoring import ScoreCard
from rowvision.skeleton import FloatArray
from rowvision.timing import FollowTiming


def _finite(value: float) -> float | None:
    """Return the value, or None for NaN, which JSON cannot carry."""
    return float(value) if np.isfinite(value) else None


def _pose(points: FloatArray, scores: FloatArray) -> list[list[float] | None] | None:
    """Return [x, y, score] per joint, or None for a frame with no pose at all."""
    seen = np.isfinite(points).all(axis=1)
    if not seen.any():
        return None
    return [
        [round(float(x), 1), round(float(y), 1), round(float(score), 2)] if known else None
        for (x, y), score, known in zip(points, scores, seen, strict=True)
    ]


def stroke_markers(strokes: list[StrokeMetrics], frames: int) -> tuple[list[int], list[int]]:
    """Return catch and finish frames.

    The analysis only reports complete strokes, so a catch or finish in a stroke cut off by the
    clip edge or a gap has no marker.
    """
    catches = {stroke.catch_frame for stroke in strokes}
    catches |= {stroke.next_catch_frame for stroke in strokes}
    finishes = {stroke.finish_frame for stroke in strokes}
    return (
        sorted(frame for frame in catches if 0 <= frame < frames),
        sorted(frame for frame in finishes if 0 <= frame < frames),
    )


def _optional(value: float | None) -> float | None:
    return None if value is None else _finite(value)


def _target(target: Target | None) -> dict[str, Any] | None:
    if target is None:
        return None
    return {
        "low": _finite(target.low),
        "high": _finite(target.high),
        "sources": list(target.sources),
        "evidence": target.evidence,
    }


def _card(card: ScoreCard, spread: dict[str, float]) -> dict[str, Any]:
    return {
        "overall": _optional(card.overall),
        "phases": {phase.value: _finite(score) for phase, score in card.phases.items()},
        "metrics": [
            {
                "name": metric.name,
                "label": metric.label,
                "phase": metric.phase.value,
                "value": _optional(metric.value),
                "spread": _optional(spread.get(metric.name)),
                "target": _target(metric.target),
                "score": _optional(metric.score),
                "reason": metric.reason,
            }
            for metric in card.metrics
        ],
    }


def _rating(rating: Rating) -> dict[str, Any]:
    return {
        "accuracy": _finite(rating.accuracy),
        "band": rating.band.value,
        "calibrated": rating.calibrated,
        "warnings": rating.warnings,
    }


def _timing(timing: FollowTiming | None) -> dict[str, Any] | None:
    if timing is None:
        return None
    return {
        "leader_seat": timing.leader_seat,
        "catch_ms": _optional(timing.catch_ms),
        "finish_ms": _optional(timing.finish_ms),
        "catch_spread_ms": _optional(timing.catch_spread_ms),
        "finish_spread_ms": _optional(timing.finish_spread_ms),
        "strokes": timing.strokes,
    }


def _series(values: FloatArray) -> list[float | None]:
    return [round(float(value), 1) if np.isfinite(value) else None for value in values]


def _stroke(stroke: StrokeMetrics) -> dict[str, Any]:
    return {
        name: _finite(value) if isinstance(value, float) else value
        for name, value in asdict(stroke).items()
    }


def _rower(rower: RowerResult, frames: int, facing: int, view_deg: float) -> dict[str, Any]:
    catches, finishes = stroke_markers(rower.strokes, frames)
    view = view_deg if np.isfinite(view_deg) else 0.0
    angles = angle_series(rower.points, facing, view)
    return {
        "seat": rower.seat,
        "rate_spm": _finite(rower.rate_spm),
        "catches": catches,
        "finishes": finishes,
        "poses": [_pose(p, s) for p, s in zip(rower.points, rower.scores, strict=True)],
        "angles": {
            "trunk": _series(angles.trunk_lean),
            "knee": _series(angles.knee),
            "elbow": _series(angles.elbow),
        },
        "strokes": [_stroke(stroke) for stroke in rower.strokes],
        "timing": _timing(rower.timing),
        "card": _card(rower.card, rower.spread),
        "rating": _rating(rower.rating),
    }


def analysis_json(analysis: Analysis) -> dict[str, Any]:
    rower = (
        _rower(analysis.rowers[0], analysis.frames, analysis.facing, analysis.view_deg)
        if analysis.rowers
        else None
    )
    return {
        "fps": analysis.fps,
        "frames": analysis.frames,
        "view_deg": _finite(analysis.view_deg),
        "film_closer": FILM_CLOSER if FILM_CLOSER in analysis.warnings else None,
        "warnings": [warning for warning in analysis.warnings if warning != FILM_CLOSER],
        "shots": [
            {"start": shot.start, "end": shot.end, "kind": shot.kind.value}
            for shot in analysis.shots
        ],
        "facing": analysis.facing,
        "rower": rower,
    }


def boat_choices_json(choices: list[BoatChoice]) -> list[dict[str, Any]]:
    return [
        {
            "outline": None if choice.outline is None else [float(v) for v in choice.outline],
            "people": choice.people,
            "too_far": choice.too_far,
            "confirmed": choice.confirmed,
        }
        for choice in choices
    ]


def result_summary(name: str, result: dict[str, Any]) -> dict[str, Any]:
    """Return the few fields a list of saved results needs."""
    rower = result.get("rower")
    return {
        "name": name,
        "settings": result.get("settings"),
        "film_closer": result.get("film_closer") is not None,
        "accuracy": rower["rating"]["accuracy"] if rower else None,
        "band": rower["rating"]["band"] if rower else None,
        "overall": rower["card"]["overall"] if rower else None,
    }

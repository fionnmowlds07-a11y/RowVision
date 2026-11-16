"""Turn an analysis into plain JSON for the preview and the worker."""

from dataclasses import asdict
from typing import Any

import numpy as np

from rowvision.metrics import StrokeMetrics, angle_series
from rowvision.pipeline import FILM_CLOSER, Analysis, BoatChoice, RowerResult
from rowvision.reference import Target
from rowvision.reliability import Rating
from rowvision.scoring import MetricScore, ScoreCard
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


def _metric(metric: MetricScore, spread: dict[str, float]) -> dict[str, Any]:
    return {
        "name": metric.name,
        "label": metric.label,
        "phase": metric.phase.value,
        "value": _optional(metric.value),
        "spread": _optional(spread.get(metric.name)),
        "target": _target(metric.target),
        "score": _optional(metric.score),
        "reason": metric.reason,
    }


def _card(card: ScoreCard, spread: dict[str, float]) -> dict[str, Any]:
    return {
        "overall": _optional(card.overall),
        "phases": {phase.value: _finite(score) for phase, score in card.phases.items()},
        "metrics": [_metric(metric, spread) for metric in card.metrics],
        "extras": [_metric(metric, spread) for metric in card.extras],
    }


def _rating(rating: Rating) -> dict[str, Any]:
    return {
        "accuracy": _finite(rating.accuracy),
        "band": rating.band.value,
        "calibrated": rating.calibrated,
        "labelled_frames": rating.labelled_frames,
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


def _evidence(rower: RowerResult) -> dict[str, Any] | None:
    """Return what cannot be worked out again from the joints alone."""
    evidence = getattr(rower, "evidence", None)
    if evidence is None:
        return None
    return {
        "trunk_px": _finite(evidence.trunk_px),
        "coverage": _finite(evidence.coverage),
        "agreement": _optional(evidence.crew_agreement),
    }


def _series(values: FloatArray) -> list[float | None]:
    return [round(float(value), 1) if np.isfinite(value) else None for value in values]


def _stroke(stroke: StrokeMetrics) -> dict[str, Any]:
    return {
        name: _finite(value) if isinstance(value, float) else value
        for name, value in asdict(stroke).items()
    }


def rower_json(
    rower: RowerResult, frames: int, facing: int, view_deg: float | FloatArray
) -> dict[str, Any]:
    catches, finishes = stroke_markers(rower.strokes, frames)
    angles = getattr(rower, "angles", None) or angle_series(
        rower.points, facing, np.nan_to_num(view_deg)
    )
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
        "evidence": _evidence(rower),
        "fade": {name: _finite(change) for name, change in getattr(rower, "fade", {}).items()},
    }


def _value(rower: dict[str, Any], name: str) -> float | None:
    found = next((m for m in rower["card"]["metrics"] if m["name"] == name), None)
    return None if found is None else found["value"]


def _range(values: list[float | None]) -> float | None:
    """Return the gap between the highest and lowest value, which needs two seats."""
    known = [value for value in values if value is not None]
    return float(max(known) - min(known)) if len(known) >= 2 else None


def _range_of_all(seats: list[dict[str, Any]], name: str) -> float | None:
    return _range([seat[name] for seat in seats])


def _range_along_sides(seats: list[dict[str, Any]], name: str) -> float | None:
    """Return the widest gap between seats on one side. Sides alternate along a sweep boat."""
    gaps = [
        _range([seat[name] for seat in seats if seat["seat"] is not None and seat["seat"] % 2 == odd])
        for odd in (0, 1)
    ]
    known = [gap for gap in gaps if gap is not None]
    return max(known) if known else None


def crew_summary(crew: list[dict[str, Any]], along_sides: bool = False) -> dict[str, Any]:
    """Return each seat's headline figures side by side, and how well the crew matches.

    The match is the gap in degrees between the seats furthest apart, for the body angle at the
    catch and at the finish. `along_sides` is for sweep crews, where only seats on the same side are
    compared. To a camera off side-on the two sides read differently: on a real four filmed 55
    degrees off side-on, seats on one side agreed within 4 degrees while the two sides read 32
    degrees apart. The likely cause is that a sweep rower turns and leans out towards their own
    rigger, which such a camera sees as more or less forward lean. A pair has one rower a side, so
    it has no figure.
    """
    seats = [
        {
            "seat": rower["seat"],
            "overall": rower["card"]["overall"],
            "band": rower["rating"]["band"],
            "catch_lean_deg": _value(rower, "catch_lean_deg"),
            "finish_lean_deg": _value(rower, "finish_lean_deg"),
            "leader_seat": rower["timing"]["leader_seat"] if rower["timing"] else None,
            "catch_ms": rower["timing"]["catch_ms"] if rower["timing"] else None,
            "finish_ms": rower["timing"]["finish_ms"] if rower["timing"] else None,
        }
        for rower in crew
    ]
    spread = _range_along_sides if along_sides else _range_of_all
    return {
        "seats": seats,
        "along_sides": along_sides,
        "catch_lean_range_deg": spread(seats, "catch_lean_deg"),
        "finish_lean_range_deg": spread(seats, "finish_lean_deg"),
    }


def own_rower(crew: list[dict[str, Any]], own_seat: int | None) -> dict[str, Any] | None:
    """Return the athlete's own entry, or the first when their seat was not measured."""
    if not crew:
        return None
    return next((rower for rower in crew if rower["seat"] == own_seat), crew[0])


def analysis_json(analysis: Analysis) -> dict[str, Any]:
    """Return the report. `rower` is the athlete. `crew` lists every seat when all were measured."""
    views = analysis.frame_views
    view = analysis.view_deg if views is None else views
    rowers = [
        rower_json(rower, analysis.frames, analysis.facing, view) for rower in analysis.rowers
    ]
    whole_crew = getattr(analysis, "own_seat", None) is not None or len(rowers) > 1
    return {
        "fps": analysis.fps,
        "frames": analysis.frames,
        "view_deg": _finite(analysis.view_deg),
        "views": None if views is None else _series(views),
        "film_closer": FILM_CLOSER if FILM_CLOSER in analysis.warnings else None,
        "warnings": [warning for warning in analysis.warnings if warning != FILM_CLOSER],
        "shots": [
            {"start": shot.start, "end": shot.end, "kind": shot.kind.value}
            for shot in analysis.shots
        ],
        "facing": analysis.facing,
        "rower": own_rower(rowers, analysis.own_seat),
        "crew": rowers if whole_crew else None,
        "crew_summary": crew_summary(rowers, analysis.sweep) if whole_crew else None,
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

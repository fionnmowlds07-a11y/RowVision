"""Turn an analysis into plain JSON for the page."""

from typing import Any

import numpy as np
from rowvision.metrics import StrokeMetrics
from rowvision.pipeline import FILM_CLOSER, Analysis, BoatChoice, RowerResult
from rowvision.skeleton import FloatArray


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


def _rower(rower: RowerResult, frames: int) -> dict[str, Any]:
    catches, finishes = stroke_markers(rower.strokes, frames)
    return {
        "seat": rower.seat,
        "rate_spm": _finite(rower.rate_spm),
        "catches": catches,
        "finishes": finishes,
        "poses": [_pose(p, s) for p, s in zip(rower.points, rower.scores, strict=True)],
    }


def analysis_json(analysis: Analysis) -> dict[str, Any]:
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
        "rower": _rower(analysis.rowers[0], analysis.frames) if analysis.rowers else None,
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

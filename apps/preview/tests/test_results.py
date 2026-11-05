import json
from types import SimpleNamespace
from typing import Any

import numpy as np
from hypothesis import given
from hypothesis import strategies as st
from rowvision.metrics import StrokeMetrics
from rowvision.pipeline import FILM_CLOSER, Analysis, BoatChoice
from rowvision.reference import load_targets
from rowvision.reliability import Evidence, rate
from rowvision.scoring import score_stroke
from rowvision.shots import Shot, ShotKind

from rowvision_preview.results import (
    analysis_json,
    boat_choices_json,
    result_summary,
    stroke_markers,
)


def stroke(catch: int, finish: int, next_catch: int) -> StrokeMetrics:
    nan = float("nan")
    return StrokeMetrics(catch, finish, next_catch, 25.0, -20.0, nan, 165.0, 100.0, 0.4, nan)


def rower(frames: int = 4) -> Any:
    """Stand in for RowerResult, with only the fields the page uses."""
    points = np.full((frames, 17, 2), np.nan)
    points[1] = 10.04
    points[2, 5] = (3.0, 4.0)
    scores = np.full((frames, 17), 0.5)
    summary = {"catch_lean_deg": 25.0, "catch_knee_deg": 50.0}
    spread = {"catch_lean_deg": 2.0, "catch_knee_deg": 40.0}
    return SimpleNamespace(
        seat=3,
        points=points,
        scores=scores,
        rate_spm=float("nan"),
        strokes=[stroke(0, 1, 3)],
        spread=spread,
        card=score_stroke(summary, spread, 8, 24, load_targets()),
        rating=rate(Evidence(25, 10, 2, 1, 8)),
    )


def test_every_catch_is_marked_once_including_the_last() -> None:
    catches, finishes = stroke_markers([stroke(10, 20, 40), stroke(40, 55, 70)], 100)
    assert catches == [10, 40, 70]
    assert finishes == [20, 55]


def test_markers_outside_the_clip_are_dropped() -> None:
    assert stroke_markers([stroke(-2, 20, 100)], 100) == ([], [20])


def test_poses_follow_frames_with_gaps_as_null() -> None:
    poses = analysis_json(Analysis(30.0, 4, rowers=[rower()]))["rower"]["poses"]
    assert poses[0] is None
    assert poses[1][0] == [10.0, 10.0, 0.5]
    assert poses[2][0] is None
    assert poses[2][5] == [3.0, 4.0, 0.5]


def test_result_is_strict_json_despite_nan_measures() -> None:
    result = analysis_json(
        Analysis(30.0, 4, rowers=[rower()], shots=[Shot(0, 4, ShotKind.SIDE_ON)])
    )
    parsed = json.loads(json.dumps(result, allow_nan=False))
    assert parsed["view_deg"] is None
    assert parsed["rower"]["rate_spm"] is None
    assert parsed["shots"] == [{"start": 0, "end": 4, "kind": "side_on"}]


def test_film_closer_is_kept_apart_from_other_warnings() -> None:
    result = analysis_json(Analysis(30.0, 4, warnings=[FILM_CLOSER, "Other"]))
    assert result["film_closer"] == FILM_CLOSER
    assert result["warnings"] == ["Other"]
    assert result["rower"] is None


def test_no_film_closer_when_the_analysis_did_not_give_one() -> None:
    assert analysis_json(Analysis(30.0, 4))["film_closer"] is None


def test_boat_out_of_view_has_no_outline() -> None:
    choices = [
        BoatChoice(np.array([1.0, 2.0, 3.0, 4.0]), 4, False, True),
        BoatChoice(None, 2, True, False),
    ]
    assert boat_choices_json(choices) == [
        {"outline": [1.0, 2.0, 3.0, 4.0], "people": 4, "too_far": False, "confirmed": True},
        {"outline": None, "people": 2, "too_far": True, "confirmed": False},
    ]


@given(st.lists(st.tuples(st.integers(-5, 50), st.integers(1, 20), st.integers(1, 20))))
def test_markers_are_sorted_unique_and_in_range(spans: list[tuple[int, int, int]]) -> None:
    strokes = [stroke(start, start + a, start + a + b) for start, a, b in spans]
    for markers in stroke_markers(strokes, 40):
        assert markers == sorted(set(markers))
        assert all(0 <= frame < 40 for frame in markers)


def full_result() -> dict[str, Any]:
    analysis = Analysis(30.0, 4, facing=-1, view_deg=10.0, rowers=[rower()])
    return json.loads(json.dumps(analysis_json(analysis), allow_nan=False))


def test_every_measure_carries_its_evidence() -> None:
    metric = next(
        item for item in full_result()["rower"]["card"]["metrics"] if item["name"] == "catch_lean_deg"
    )
    assert metric["value"] == 25
    assert metric["spread"] == 2
    assert metric["target"]["low"] == 20
    assert metric["target"]["sources"]
    assert metric["score"] == 100


def test_a_measure_not_scored_still_shows_its_value_and_reason() -> None:
    metric = next(
        item for item in full_result()["rower"]["card"]["metrics"] if item["name"] == "catch_knee_deg"
    )
    assert metric["value"] == 50
    assert metric["score"] is None
    assert "inconsistent" in metric["reason"]


def test_an_open_ended_target_survives_json() -> None:
    metric = next(
        item for item in full_result()["rower"]["card"]["metrics"] if item["name"] == "legs_lead"
    )
    assert metric["target"]["low"] == 0
    assert metric["target"]["high"] is None


def test_rating_and_angles_are_included() -> None:
    result = full_result()["rower"]
    assert result["rating"]["calibrated"] is False
    assert result["rating"]["band"]
    assert len(result["angles"]["trunk"]) == 4
    assert result["angles"]["trunk"][0] is None


def test_strokes_keep_numbers_and_turn_nan_into_null() -> None:
    first = full_result()["rower"]["strokes"][0]
    assert first["catch_lean_deg"] == 25
    assert first["catch_knee_deg"] is None


def test_summary_lists_the_rating_and_score() -> None:
    summary = result_summary("a.json", {**full_result(), "settings": {"clip": "a.mp4"}})
    assert summary["name"] == "a.json"
    assert summary["settings"] == {"clip": "a.mp4"}
    assert summary["band"]


def test_summary_of_a_film_closer_result_has_no_scores() -> None:
    result = analysis_json(Analysis(30.0, 4, warnings=[FILM_CLOSER]))
    summary = result_summary("a.json", result)
    assert summary["film_closer"] is True
    assert summary["overall"] is None

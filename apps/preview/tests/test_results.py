import json

import numpy as np
from hypothesis import given
from hypothesis import strategies as st
from rowvision.metrics import StrokeMetrics
from rowvision.pipeline import FILM_CLOSER, Analysis, BoatChoice, RowerResult
from rowvision.shots import Shot, ShotKind

from rowvision_preview.results import analysis_json, boat_choices_json, stroke_markers


def stroke(catch: int, finish: int, next_catch: int) -> StrokeMetrics:
    nan = float("nan")
    return StrokeMetrics(catch, finish, next_catch, nan, nan, nan, nan, 0.4, nan)


def rower(frames: int = 4) -> RowerResult:
    points = np.full((frames, 17, 2), np.nan)
    points[1] = 10.04
    points[2, 5] = (3.0, 4.0)
    scores = np.full((frames, 17), 0.5)
    return RowerResult(3, points, scores, float("nan"), 0.0, [stroke(0, 1, 3)], {}, {})


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

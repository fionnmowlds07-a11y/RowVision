import pytest

from rowvision.reference import Target, load_targets
from rowvision.scoring import (
    ELBOW_GUIDE,
    EXTRAS,
    ROUGH_GUIDE,
    SHOWN_ONLY,
    TOO_INCONSISTENT,
    MetricScore,
    Phase,
    score_stroke,
    score_value,
)

GOOD = {
    "catch_lean_deg": 28.0,
    "catch_knee_deg": 52.0,
    "legs_lead": 0.1,
    "finish_lean_deg": -22.0,
    "finish_knee_deg": 177.0,
    "drive_share": 0.42,
}
STEADY = dict.fromkeys(GOOD, 0.01)


def card(summary: dict, spread: dict | None = None, strokes: int = 8, rate: float = 26):
    return score_stroke(summary, spread or STEADY, strokes, rate, load_targets())


def test_every_target_has_a_source() -> None:
    targets = load_targets()
    assert targets.status == "provisional"
    assert all(target.sources for target in targets.ranges.values())
    assert targets.drive_share_sources


def test_drive_share_target_follows_stroke_rate() -> None:
    targets = load_targets()
    low, high = targets.for_metric("drive_share", 22), targets.for_metric("drive_share", 32)
    assert low is not None and high is not None
    assert low.low < high.low


@pytest.mark.parametrize(
    ("value", "expected"), [(25, 100), (20, 100), (35, 100), (12.5, 50), (42.5, 50), (0, 0), (60, 0)]
)
def test_score_falls_away_outside_the_target(value: float, expected: float) -> None:
    assert score_value(value, Target(20, 35, ("x",), "ergometer"), 15) == pytest.approx(expected)


def test_good_technique_scores_full_marks() -> None:
    result = card(GOOD)
    assert result.overall == 100
    assert set(result.phases) == set(Phase)


def test_poor_catch_lowers_only_the_catch_score() -> None:
    result = card({**GOOD, "catch_lean_deg": 10.0})
    assert result.phases[Phase.CATCH] < 100
    assert result.phases[Phase.FINISH] == 100


def test_inconsistent_measure_is_not_scored_and_says_why() -> None:
    result = card(GOOD, {**STEADY, "catch_lean_deg": 58.0})
    lean = next(metric for metric in result.metrics if metric.name == "catch_lean_deg")
    assert lean.score is None
    assert lean.reason is not None and "inconsistent" in lean.reason
    assert Phase.CATCH not in result.phases


def test_unmeasured_value_is_never_given_a_number() -> None:
    result = card({key: value for key, value in GOOD.items() if key != "finish_knee_deg"})
    knee = next(metric for metric in result.metrics if metric.name == "finish_knee_deg")
    assert knee.score is None
    assert knee.value is None


def test_too_few_strokes_scores_nothing() -> None:
    result = card(GOOD, strokes=2)
    assert result.overall is None
    assert result.phases == {}


def test_knee_angles_are_shown_but_never_scored() -> None:
    result = card({**GOOD, "catch_knee_deg": 120.0, "finish_knee_deg": 120.0})
    knees = [metric for metric in result.metrics if "knee" in metric.name]
    assert [metric.value for metric in knees] == [120.0, 120.0]
    assert all(metric.score is None and metric.reason == ROUGH_GUIDE for metric in knees)
    assert result.overall == 100


def test_five_degrees_outside_an_angle_target_scores_half() -> None:
    result = card({**GOOD, "catch_lean_deg": 36.0})
    assert result.phases[Phase.CATCH] == pytest.approx(50)


@pytest.mark.parametrize("missing", ["catch_lean_deg", "finish_lean_deg"])
def test_no_overall_score_without_both_catch_and_finish(missing: str) -> None:
    result = card({key: value for key, value in GOOD.items() if key != missing})
    assert result.overall is None
    assert result.phases


EXTRA = {"drive_s": 1.1, "recovery_s": 1.6, "ratio": 1.45, "body_swing_deg": 50.0, "finish_elbow_deg": 60.0}


def extras(summary: dict[str, float], spread: dict[str, float] | None = None) -> dict[str, MetricScore]:
    result = score_stroke({**GOOD, **summary}, spread or {}, 8, 24, load_targets())
    return {metric.name: metric for metric in result.extras}


def test_extra_measures_are_shown_and_never_scored() -> None:
    shown = extras(EXTRA)
    assert set(shown) == set(EXTRAS)
    assert shown["ratio"].value == 1.45
    assert all(metric.score is None and metric.target is None for metric in shown.values())
    assert shown["drive_s"].reason == SHOWN_ONLY
    assert shown["finish_elbow_deg"].reason == ELBOW_GUIDE


def test_extra_measures_do_not_change_the_score() -> None:
    plain = score_stroke(GOOD, {}, 8, 24, load_targets())
    with_extras = score_stroke({**GOOD, **EXTRA}, {}, 8, 24, load_targets())
    assert with_extras.overall == plain.overall
    assert with_extras.phases == plain.phases
    assert [metric.name for metric in with_extras.metrics] == [metric.name for metric in plain.metrics]


def test_an_inconsistent_extra_measure_is_left_out() -> None:
    shown = extras(EXTRA, {"body_swing_deg": 20.0, "ratio": 0.1})
    assert shown["body_swing_deg"].value is None
    assert shown["body_swing_deg"].reason == TOO_INCONSISTENT
    assert shown["ratio"].value == 1.45


def test_an_extra_measure_that_was_not_seen_has_no_value() -> None:
    shown = extras({})
    assert shown["stroke_length"].value is None
    assert shown["stroke_length"].reason == "Could not be seen reliably in this video."

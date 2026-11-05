import pytest

from rowvision.reference import Target, load_targets
from rowvision.scoring import Phase, score_stroke, score_value

GOOD = {
    "catch_lean_deg": 28.0,
    "catch_knee_deg": 50.0,
    "legs_lead": 0.1,
    "finish_lean_deg": -22.0,
    "finish_knee_deg": 165.0,
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
    result = card(GOOD, {**STEADY, "catch_knee_deg": 58.0})
    knee = next(metric for metric in result.metrics if metric.name == "catch_knee_deg")
    assert knee.score is None
    assert knee.reason is not None and "inconsistent" in knee.reason
    assert result.phases[Phase.CATCH] == 100


def test_unmeasured_value_is_never_given_a_number() -> None:
    result = card({key: value for key, value in GOOD.items() if key != "finish_knee_deg"})
    knee = next(metric for metric in result.metrics if metric.name == "finish_knee_deg")
    assert knee.score is None
    assert knee.value is None


def test_too_few_strokes_scores_nothing() -> None:
    result = card(GOOD, strokes=2)
    assert result.overall is None
    assert result.phases == {}

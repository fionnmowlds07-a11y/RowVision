import numpy as np
import pytest
from hypothesis import given
from hypothesis import strategies as st

from rowvision.metrics import angle_series
from rowvision.reliability import (
    Band,
    Evidence,
    angle_error_deg,
    band_for,
    rate,
    share_within_tolerance,
)
from rowvision.synthetic import generate

CLEAR = Evidence(trunk_px=120, view_deg=5, stroke_spread_deg=1, coverage=1, strokes=12)


@pytest.mark.parametrize(
    ("accuracy", "band"),
    [
        (95, Band.EXCELLENT),
        (90, Band.EXCELLENT),
        (89.9, Band.GREAT),
        (80, Band.GREAT),
        (70, Band.GOOD),
        (60, Band.FAIR),
        (59.9, Band.POOR),
    ],
)
def test_bands_match_the_agreed_thresholds(accuracy: float, band: Band) -> None:
    assert band_for(accuracy) is band


@pytest.mark.parametrize(("pixels_per_metre", "noise"), [(60, 1.0), (100, 1.5), (100, 3.0), (300, 3.0)])
def test_predicted_accuracy_matches_measured_accuracy(pixels_per_metre: float, noise: float) -> None:
    """The accuracy figure must be a real prediction, tested against known angles."""
    clip = generate(strokes=40, pixels_per_metre=pixels_per_metre, pixel_noise=noise, seed=1)
    angles = angle_series(clip.points, clip.facing, 0)
    errors = np.abs(angles.trunk_lean - clip.trunk_lean_deg)
    measured = 100 * float(np.mean(errors <= 5))
    trunk_px = 0.55 * pixels_per_metre
    # Shoulders and hips are each the average of two keypoints, which halves the noise variance.
    predicted = share_within_tolerance(angle_error_deg(trunk_px, noise / np.sqrt(2)))
    assert predicted == pytest.approx(measured, abs=4)


def test_clear_footage_rates_highly_and_is_marked_uncalibrated() -> None:
    rating = rate(CLEAR)
    assert rating.band is Band.EXCELLENT
    assert not rating.calibrated
    assert rating.warnings == []


def test_rating_falls_as_the_camera_moves_off_side_on() -> None:
    accuracies = [rate(Evidence(60, view, 1, 1, 12)).accuracy for view in (0, 20, 40, 60, 75)]
    assert accuracies == sorted(accuracies, reverse=True)
    assert accuracies[0] > accuracies[-1] + 20


def test_rating_falls_as_the_rower_gets_smaller() -> None:
    accuracies = [rate(Evidence(size, 5, 1, 1, 12)).accuracy for size in (120, 60, 30, 15)]
    assert accuracies == sorted(accuracies, reverse=True)


def test_inconsistent_strokes_lower_the_rating() -> None:
    assert rate(Evidence(120, 5, 12, 1, 12)).accuracy < rate(CLEAR).accuracy


@pytest.mark.parametrize(
    ("evidence", "phrase"),
    [
        (Evidence(20, 5, 1, 1, 12), "Film closer"),
        (Evidence(120, 40, 1, 1, 12), "40 degrees off side-on"),
        (Evidence(120, 5, 1, 0.4, 12), "part of the video"),
        (Evidence(120, 5, 1, 1, 3), "3 full strokes"),
        (Evidence(120, 5, 1, 1, 12, 0.2), "crew's rhythm"),
    ],
)
def test_each_problem_gets_a_plain_warning(evidence: Evidence, phrase: str) -> None:
    assert any(phrase in warning for warning in rate(evidence).warnings)


@given(
    st.floats(6, 400),
    st.floats(0, 89),
    st.floats(0, 60),
    st.floats(0, 1),
    st.integers(0, 40),
    st.one_of(st.none(), st.floats(-1, 1)),
)
def test_accuracy_is_always_a_valid_percentage(
    trunk: float, view: float, spread: float, coverage: float, strokes: int, agreement: float | None
) -> None:
    assert 0 <= rate(Evidence(trunk, view, spread, coverage, strokes, agreement)).accuracy <= 100

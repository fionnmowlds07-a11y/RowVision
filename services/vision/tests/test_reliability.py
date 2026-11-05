from pathlib import Path

import numpy as np
import pytest
from hypothesis import given
from hypothesis import strategies as st

from rowvision.metrics import angle_series
from rowvision.reliability import (
    ASSUMED_KEYPOINT_ERROR_PX,
    Band,
    Calibration,
    Evidence,
    angle_error_deg,
    band_for,
    load_calibration,
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


GOOD_FOOTAGE = Evidence(trunk_px=60, view_deg=10, stroke_spread_deg=2, coverage=1, strokes=12)


def test_a_short_clip_does_not_lower_accuracy_but_is_flagged() -> None:
    short = rate(Evidence(60, 10, 2, 1, 2))
    assert short.accuracy == pytest.approx(rate(GOOD_FOOTAGE).accuracy)
    assert any("2 full strokes" in warning for warning in short.warnings)


def test_partial_tracking_does_not_lower_accuracy_but_is_flagged() -> None:
    partial = rate(Evidence(60, 10, 2, 0.3, 12))
    assert partial.accuracy == pytest.approx(rate(GOOD_FOOTAGE).accuracy)
    assert any("part of the video" in warning for warning in partial.warnings)


def test_weak_crew_rhythm_does_not_lower_accuracy_but_is_flagged() -> None:
    weak = rate(Evidence(60, 10, 2, 1, 12, 0.1))
    assert weak.accuracy == pytest.approx(rate(GOOD_FOOTAGE).accuracy)
    assert any("crew's rhythm" in warning for warning in weak.warnings)


def test_the_side_on_sculler_from_the_real_clip_is_not_poor() -> None:
    assert rate(Evidence(29.5, 12.5, 0, 0.99, 2)).band is Band.GOOD


def test_two_strokes_cannot_show_a_spread() -> None:
    assert rate(Evidence(60, 10, 30, 1, 2)).accuracy == rate(Evidence(60, 10, 0, 1, 2)).accuracy


def test_one_stroke_reads_properly() -> None:
    assert any("Only 1 full stroke was" in item for item in rate(Evidence(60, 10, 2, 1, 1)).warnings)


def test_a_measured_error_replaces_the_assumption() -> None:
    assumed = rate(GOOD_FOOTAGE, Calibration(ASSUMED_KEYPOINT_ERROR_PX, False))
    measured = rate(GOOD_FOOTAGE, Calibration(4.0, True))
    assert measured.accuracy < assumed.accuracy
    assert measured.calibrated
    assert not assumed.calibrated


def calibration_file(folder: Path, error: float | None, frames: int) -> Path:
    path = folder / "calibration.yaml"
    value = "null" if error is None else error
    path.write_text(f"keypoint_error_px: {value}\nlabelled_frames: {frames}\n")
    return path


def test_no_measurement_keeps_the_assumption(tmp_path: Path) -> None:
    loaded = load_calibration(calibration_file(tmp_path, None, 0))
    assert loaded == Calibration(ASSUMED_KEYPOINT_ERROR_PX, False)


def test_too_few_labels_do_not_count_as_calibrated(tmp_path: Path) -> None:
    loaded = load_calibration(calibration_file(tmp_path, 2.2, 40))
    assert loaded == Calibration(ASSUMED_KEYPOINT_ERROR_PX, False)


def test_enough_labels_calibrate_the_rating(tmp_path: Path) -> None:
    assert load_calibration(calibration_file(tmp_path, 2.2, 120)) == Calibration(2.2, True)


def test_the_repository_starts_uncalibrated() -> None:
    assert not load_calibration().calibrated

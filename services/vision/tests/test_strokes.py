import numpy as np
import pytest

from rowvision.strokes import detect_strokes, facing_direction, reach_signal
from rowvision.synthetic import generate


@pytest.mark.parametrize("rate", [18, 22, 28, 36])
def test_stroke_rate_is_recovered(rate: float) -> None:
    clip = generate(rate_spm=rate, strokes=6)
    timeline = detect_strokes(reach_signal(clip.points, clip.facing), clip.fps)
    assert timeline.rate_spm == pytest.approx(rate, abs=0.7)
    assert timeline.regularity > 0.8


@pytest.mark.parametrize("facing", [-1, 1])
def test_facing_direction_is_detected(facing: int) -> None:
    assert facing_direction(generate(facing=facing).points) == facing


def test_camera_panning_does_not_change_strokes() -> None:
    still = generate(strokes=6)
    panning = generate(strokes=6, camera_drift_px=3.0)
    first = detect_strokes(reach_signal(still.points, still.facing), still.fps)
    second = detect_strokes(reach_signal(panning.points, panning.facing), panning.fps)
    assert first.catches == second.catches


def test_catches_and_finishes_land_near_true_frames() -> None:
    clip = generate(strokes=6, pixel_noise=1.0)
    timeline = detect_strokes(reach_signal(clip.points, clip.facing), clip.fps)
    tolerance = 0.2 * clip.fps
    interior_catches = clip.catch_frames[1:]
    for truth in interior_catches:
        assert min(abs(found - truth) for found in timeline.catches) <= tolerance
    for truth in clip.finish_frames:
        assert min(abs(found - truth) for found in timeline.finishes) <= tolerance


def test_missing_frames_are_tolerated() -> None:
    clip = generate(strokes=6)
    reach = reach_signal(clip.points, clip.facing)
    reach[40:46] = np.nan
    assert detect_strokes(reach, clip.fps).rate_spm == pytest.approx(24, abs=0.7)


def test_motionless_footage_reports_no_rhythm() -> None:
    timeline = detect_strokes(np.zeros(200), 30)
    assert timeline.catches == []
    assert timeline.regularity == 0


def test_all_missing_signal_is_an_error() -> None:
    with pytest.raises(ValueError, match="no usable frames"):
        detect_strokes(np.full(100, np.nan), 30)


def test_false_peak_between_strokes_is_dropped() -> None:
    clip = generate(strokes=6)
    reach = reach_signal(clip.points, clip.facing)
    true_catches = detect_strokes(reach, clip.fps).catches
    false_peak = true_catches[2] + 30
    reach[false_peak - 2 : false_peak + 3] = reach.max() * 1.05
    assert false_peak not in detect_strokes(reach, clip.fps).catches

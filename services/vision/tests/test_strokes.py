import numpy as np
import pytest

from rowvision.strokes import crew_reach, detect_strokes, facing_direction, reach_signal
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
    half_stroke = 60 / clip.rate_spm * clip.fps / 2
    last = len(clip.points) - half_stroke
    for truth in [frame for frame in clip.catch_frames if half_stroke <= frame <= last]:
        assert min(abs(found - truth) for found in timeline.catches) <= tolerance
    for truth in [frame for frame in clip.finish_frames if half_stroke <= frame <= last]:
        assert min(abs(found - truth) for found in timeline.finishes) <= tolerance


def test_strokes_cut_off_by_the_clip_edge_are_left_out() -> None:
    clip = generate(strokes=6, pixel_noise=1.0)
    timeline = detect_strokes(reach_signal(clip.points, clip.facing), clip.fps)
    assert min(timeline.finishes) > 37


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


def test_motion_is_not_invented_across_a_long_gap() -> None:
    clip = generate(strokes=8)
    reach = reach_signal(clip.points, clip.facing)
    reach[150:300] = np.nan
    timeline = detect_strokes(reach, clip.fps)
    assert not any(150 <= frame < 300 for frame in timeline.catches + timeline.finishes)
    assert timeline.rate_spm == pytest.approx(24, abs=1.5)


def test_noisy_flat_peaks_do_not_scatter_the_timing() -> None:
    clip = generate(strokes=10)
    reach = reach_signal(clip.points, clip.facing)
    noisy = reach + np.random.default_rng(3).normal(0, 0.25, len(reach))
    timeline = detect_strokes(noisy, clip.fps)
    gaps = np.diff(timeline.catches)
    assert np.abs(gaps - 75).max() <= 8


def test_drive_length_stays_steady_on_noisy_signals() -> None:
    clip = generate(strokes=10)
    reach = reach_signal(clip.points, clip.facing)
    noisy = reach + np.random.default_rng(5).normal(0, 0.25, len(reach))
    timeline = detect_strokes(noisy, clip.fps)
    drives = [
        min(finish - catch for finish in timeline.finishes if finish > catch)
        for catch in timeline.catches[:-1]
    ]
    assert np.ptp(drives) <= 12


def plateau_stroke(period: int, strokes: int) -> np.ndarray:
    """A stroke with an early hump and a long plateau before the fall, starting at the finish.

    The values are one real rower's average reach, sampled every five frames.
    """
    measured = [-0.46, -0.39, -0.42, -0.25, -0.06, 0.23, 0.46, 0.32, 0.31,
                0.33, 0.34, 0.37, 0.35, 0.23, 0.14, -0.15, -0.40]  # fmt: skip
    cycle = np.interp(np.arange(period), np.arange(len(measured)) * 5, measured)
    return np.tile(cycle, strokes)


@pytest.mark.parametrize("seed", range(5))
def test_catch_is_the_end_of_a_plateau_not_where_the_hands_first_go_out(seed: int) -> None:
    period = 85
    signal = plateau_stroke(period, 10)
    noisy = signal + np.random.default_rng(seed).normal(0, 0.05, len(signal))
    timeline = detect_strokes(noisy, 30)
    offsets = [(frame % period) for frame in timeline.catches]
    assert all(50 <= offset <= 66 for offset in offsets)


def test_crew_timing_ignores_one_rower_with_a_misleading_stroke_shape() -> None:
    clip = generate(strokes=10)
    good = reach_signal(clip.points, clip.facing)
    rng = np.random.default_rng(7)
    crew = [good + rng.normal(0, 0.1, len(good)) for _ in range(3)]
    crew.append(np.roll(good, 25))
    timeline = detect_strokes(crew_reach(crew), clip.fps)
    truth = np.array(clip.catch_frames)
    errors = [frame - truth[np.abs(truth - frame).argmin()] for frame in timeline.catches]
    assert np.abs(errors).max() <= 3


def test_crew_signal_covers_frames_seen_by_anyone() -> None:
    first = np.array([0.0, 1.0, 2.0, np.nan, np.nan])
    second = np.array([np.nan, np.nan, 2.0, 1.0, 0.0])
    combined = crew_reach([first, second])
    assert np.isfinite(combined).all()


def end_on_after_side_on() -> tuple[np.ndarray, np.ndarray]:
    """Four clear strokes, then eight filmed from the bow, where reach is shapeless and out of step."""
    period = 55
    side_on = plateau_stroke(period, 4)
    rng = np.random.default_rng(3)
    end_on = 0.4 * np.roll(plateau_stroke(period, 8), period // 2) + rng.normal(0, 0.15, period * 8)
    clear = np.arange(period * 12) < len(side_on)
    return np.concatenate([side_on, end_on]), clear


def test_end_on_footage_does_not_move_the_catches_filmed_side_on() -> None:
    signal, clear = end_on_after_side_on()
    side_on = int(clear.sum())
    alone = detect_strokes(signal[:side_on], 30)
    timeline = detect_strokes(signal, 30, clear)
    assert [frame for frame in timeline.catches if frame < side_on] == alone.catches
    assert [frame for frame in timeline.finishes if frame < side_on] == alone.finishes


def test_rate_comes_from_clear_footage_even_when_end_on_footage_is_longer() -> None:
    signal, clear = end_on_after_side_on()
    slower = np.concatenate([signal[: clear.sum()], np.interp(np.arange(0, 440, 0.5), np.arange(440), signal[clear.sum() :])])
    timeline = detect_strokes(slower, 30, np.arange(len(slower)) < clear.sum())
    assert timeline.rate_spm == pytest.approx(60 * 30 / 55, abs=1)

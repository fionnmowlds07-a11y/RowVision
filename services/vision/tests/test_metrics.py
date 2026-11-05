import numpy as np
import pytest

from rowvision import skeleton as sk
from rowvision.metrics import AngleSeries, angle_series, legs_believable, per_stroke
from rowvision.strokes import StrokeTimeline, detect_strokes, reach_signal
from rowvision.synthetic import SyntheticClip, generate


def true_timeline(clip: SyntheticClip) -> StrokeTimeline:
    return StrokeTimeline(clip.catch_frames, clip.finish_frames, clip.rate_spm, 1.0)


@pytest.mark.parametrize("view", [0, 20, 40, 60])
@pytest.mark.parametrize("facing", [-1, 1])
def test_angles_match_truth_when_view_is_known(view: float, facing: int) -> None:
    clip = generate(view_deg=view, facing=facing)
    angles = angle_series(clip.points, facing, view)
    assert np.abs(angles.trunk_lean - clip.trunk_lean_deg).max() < 0.01
    assert np.abs(angles.knee - clip.knee_angle_deg).max() < 0.01
    assert np.abs(angles.elbow - clip.elbow_angle_deg).max() < 0.01


def test_ignoring_the_view_gives_wrong_angles() -> None:
    clip = generate(view_deg=45)
    uncorrected = angle_series(clip.points, clip.facing, 0)
    assert np.abs(uncorrected.trunk_lean - clip.trunk_lean_deg).max() > 5


def test_stroke_metrics_match_generated_values() -> None:
    clip = generate(catch_lean_deg=28, finish_lean_deg=-18)
    strokes = per_stroke(angle_series(clip.points, clip.facing, 0), true_timeline(clip))
    assert len(strokes) == 5
    for stroke in strokes:
        assert stroke.catch_lean_deg == pytest.approx(28, abs=0.5)
        assert stroke.finish_lean_deg == pytest.approx(-18, abs=0.5)
        assert stroke.drive_share == pytest.approx(0.4, abs=0.02)


def test_legs_lead_the_trunk_in_a_good_drive() -> None:
    clip = generate()
    strokes = per_stroke(angle_series(clip.points, clip.facing, 0), true_timeline(clip))
    assert all(stroke.legs_lead > 0 for stroke in strokes)


def test_full_chain_from_noisy_keypoints() -> None:
    clip = generate(strokes=8, pixel_noise=1.0, camera_drift_px=2.0)
    timeline = detect_strokes(reach_signal(clip.points, clip.facing), clip.fps)
    strokes = per_stroke(angle_series(clip.points, clip.facing, 0), timeline)
    assert len(strokes) >= 5
    assert np.median([stroke.catch_lean_deg for stroke in strokes]) == pytest.approx(25, abs=5)
    assert np.median([stroke.finish_lean_deg for stroke in strokes]) == pytest.approx(-20, abs=5)


def test_stroke_without_a_finish_is_skipped() -> None:
    clip = generate()
    timeline = StrokeTimeline([10, 60, 110], [80], 24, 1.0)
    strokes = per_stroke(angle_series(clip.points, clip.facing, 0), timeline)
    assert [stroke.catch_frame for stroke in strokes] == [60]


def test_gap_between_catches_is_not_counted_as_a_stroke() -> None:
    clip = generate(strokes=8)
    timeline = StrokeTimeline([0, 75, 375, 450], [30, 105, 405], 24, 1.0, 75.0)
    strokes = per_stroke(angle_series(clip.points, clip.facing, 0), timeline)
    assert [stroke.catch_frame for stroke in strokes] == [0, 375]


def test_the_synthetic_rower_has_a_human_shape() -> None:
    """Angle maths cannot see a limb bent backwards, so check the anatomy directly."""
    clip = generate()
    catch = clip.points[clip.catch_frames[1]]
    finish = clip.points[clip.finish_frames[1]]
    # Image y increases downwards, so a smaller value is higher up.
    assert catch[sk.LEFT_KNEE, 1] < catch[sk.LEFT_HIP, 1]
    assert finish[sk.LEFT_ELBOW, 1] > finish[sk.LEFT_SHOULDER, 1]


def misplaced_ankle(clip: SyntheticClip, frames: slice) -> np.ndarray:
    """Move the ankles up to the hands, as the pose model does when the hull hides the feet."""
    points = clip.points.copy()
    points[frames, sk.LEFT_ANKLE] = points[frames, sk.LEFT_WRIST]
    points[frames, sk.RIGHT_ANKLE] = points[frames, sk.RIGHT_WRIST]
    return points


def test_an_ankle_above_the_hip_is_not_believed() -> None:
    clip = generate()
    assert legs_believable(clip.points).all()
    assert not legs_believable(misplaced_ankle(clip, slice(None))).any()


def test_an_impossible_leg_gives_no_knee_angle() -> None:
    clip = generate()
    points = misplaced_ankle(clip, slice(40, 60))
    knee = angle_series(points, clip.facing, 0).knee
    assert np.isnan(knee[40:60]).all()
    assert np.isfinite(knee[:40]).all()


def test_a_straight_leg_at_the_catch_is_never_reported() -> None:
    clip = generate()
    angles = angle_series(clip.points, clip.facing, 0)
    forced = AngleSeries(angles.trunk_lean, np.full_like(angles.knee, 157.0), angles.elbow)
    strokes = per_stroke(forced, true_timeline(clip))
    assert all(np.isnan(stroke.catch_knee_deg) for stroke in strokes)
    assert all(stroke.finish_knee_deg == 157 for stroke in strokes)

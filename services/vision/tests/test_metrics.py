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
    assert legs_believable(clip.points, clip.facing).all()
    assert not legs_believable(misplaced_ankle(clip, slice(None)), clip.facing).any()


def test_a_lost_far_leg_does_not_move_the_knee_angle() -> None:
    """The far knee is often placed far from where it is. Only the near leg gives the angle."""
    clip = generate()
    near, far = (sk.RIGHT_KNEE, sk.LEFT_KNEE) if clip.facing > 0 else (sk.LEFT_KNEE, sk.RIGHT_KNEE)
    trunk = np.linalg.norm(sk.shoulders(clip.points) - sk.hips(clip.points), axis=-1)
    steady = angle_series(clip.points, clip.facing, 0).knee
    lost = clip.points.copy()
    lost[40:60, far, 1] -= 0.4 * trunk[40:60]
    assert np.allclose(angle_series(lost, clip.facing, 0).knee, steady, equal_nan=True)
    # The same misplacement of the near knee does change it.
    lost = clip.points.copy()
    lost[40:60, near, 1] -= 0.4 * trunk[40:60]
    assert not np.allclose(angle_series(lost, clip.facing, 0).knee, steady, equal_nan=True)


def test_the_near_leg_is_the_one_the_rower_faces_away_from() -> None:
    points = np.zeros((1, 17, 2))
    points[0, sk.LEFT_KNEE] = (1, 1)
    points[0, sk.RIGHT_KNEE] = (2, 2)
    assert sk.near_leg(points, 1)[1][0, 0] == 2  # facing right shows the right side
    assert sk.near_leg(points, -1)[1][0, 0] == 1


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


def test_a_camera_that_swings_is_corrected_frame_by_frame() -> None:
    side_on, angled = generate(view_deg=0), generate(view_deg=45)
    points = np.concatenate([side_on.points, angled.points])
    truth = np.concatenate([side_on.trunk_lean_deg, angled.trunk_lean_deg])
    views = np.repeat([0.0, 45.0], [len(side_on.points), len(angled.points)])
    assert np.abs(angle_series(points, side_on.facing, views).trunk_lean - truth).max() < 1
    one_figure = angle_series(points, side_on.facing, 22.5).trunk_lean
    assert np.abs(one_figure - truth).max() > 3


def lean_series(values: dict[int, float], frames: int = 120) -> AngleSeries:
    lean = np.full(frames, 20.0)
    for frame, value in values.items():
        lean[frame] = value
    flat = np.full(frames, 90.0)
    return AngleSeries(trunk_lean=lean, knee=flat, elbow=flat)


def test_one_bad_frame_at_the_catch_does_not_set_catch_lean() -> None:
    angles = lean_series({30: 45.0})
    strokes = per_stroke(angles, StrokeTimeline([30, 90], [60], 30.0, 1.0, 60.0))
    assert strokes[0].catch_lean_deg == pytest.approx(20.0)


def test_catch_lean_includes_the_frames_just_before_the_catch() -> None:
    angles = lean_series({27: 30.0, 28: 30.0, 29: 30.0, 30: 22.0})
    strokes = per_stroke(angles, StrokeTimeline([30, 90], [60], 30.0, 1.0, 60.0))
    assert strokes[0].catch_lean_deg == pytest.approx(30.0)


def test_catch_lean_ignores_missing_frames() -> None:
    angles = lean_series({27: np.nan, 28: np.nan, 29: 25.0, 30: 25.0})
    strokes = per_stroke(angles, StrokeTimeline([30, 90], [60], 30.0, 1.0, 60.0))
    assert strokes[0].catch_lean_deg == pytest.approx(25.0)

from itertools import pairwise

import numpy as np
import pytest

from rowvision import skeleton as sk
from rowvision.metrics import (
    LEAN_OUT_SHARE,
    AngleSeries,
    StrokeMetrics,
    angle_series,
    fade,
    forward_lean_readable,
    legs_believable,
    per_stroke,
    rate_steadiness,
)
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


def test_the_far_arm_does_not_move_the_elbow_angle() -> None:
    clip = generate()
    near, far = (sk.RIGHT_ELBOW, sk.LEFT_ELBOW) if clip.facing > 0 else (sk.LEFT_ELBOW, sk.RIGHT_ELBOW)
    trunk = np.linalg.norm(sk.shoulders(clip.points) - sk.hips(clip.points), axis=-1)
    steady = angle_series(clip.points, clip.facing, 0).elbow
    apart = clip.points.copy()
    apart[40:60, far, 0] += 0.4 * trunk[40:60]  # as in a sweep boat, where the arms sit apart
    assert np.allclose(angle_series(apart, clip.facing, 0).elbow, steady, equal_nan=True)
    # The same shift of the near elbow does change it.
    apart = clip.points.copy()
    apart[40:60, near, 0] += 0.4 * trunk[40:60]
    assert not np.allclose(angle_series(apart, clip.facing, 0).elbow, steady, equal_nan=True)


def test_the_near_arm_is_on_the_same_side_as_the_near_leg() -> None:
    points = np.zeros((1, 17, 2))
    points[0, sk.LEFT_ELBOW] = (1, 1)
    points[0, sk.RIGHT_ELBOW] = (2, 2)
    assert sk.near_arm(points, 1)[1][0, 0] == 2  # facing right shows the right side
    assert sk.near_arm(points, -1)[1][0, 0] == 1


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


TIMELINE = StrokeTimeline([30, 90], [60], 30.0, 1.0, 60.0)


def joint_series(name: str, values: dict[int, float], rest: float, frames: int = 120) -> AngleSeries:
    series = np.full(frames, rest)
    for frame, value in values.items():
        series[frame] = value
    flat = np.full(frames, 20.0)
    return AngleSeries(**{"trunk_lean": flat, "knee": flat, "elbow": flat, name: series})


def test_the_catch_knee_is_the_most_bent_in_the_run_up() -> None:
    angles = joint_series("knee", {27: 70.0, 28: 55.0, 29: 58.0, 30: 64.0}, rest=120.0)
    assert per_stroke(angles, TIMELINE)[0].catch_knee_deg == pytest.approx(55.0)


def test_the_catch_knee_looks_no_further_back_than_the_run_up() -> None:
    angles = joint_series("knee", {26: 40.0, 30: 64.0}, rest=100.0)
    assert per_stroke(angles, TIMELINE)[0].catch_knee_deg == pytest.approx(64.0)


def test_an_impossible_knee_in_the_run_up_is_not_taken_as_the_catch_knee() -> None:
    angles = joint_series("knee", {28: 5.0, 29: np.nan, 30: 64.0}, rest=100.0)
    assert per_stroke(angles, TIMELINE)[0].catch_knee_deg == pytest.approx(64.0)


def test_one_bad_frame_at_the_finish_does_not_set_the_elbow() -> None:
    angles = joint_series("elbow", {60: 170.0}, rest=60.0)
    assert per_stroke(angles, TIMELINE)[0].finish_elbow_deg == pytest.approx(60.0)


def test_the_finish_elbow_ignores_missing_frames() -> None:
    angles = joint_series("elbow", {58: np.nan, 59: np.nan, 60: 70.0, 61: np.nan, 62: np.nan}, rest=60.0)
    assert per_stroke(angles, TIMELINE)[0].finish_elbow_deg == pytest.approx(70.0)
    gone = joint_series("elbow", dict.fromkeys(range(58, 63), np.nan), rest=60.0)
    assert np.isnan(per_stroke(gone, TIMELINE)[0].finish_elbow_deg)


def test_times_and_ratio_come_from_the_frame_rate() -> None:
    angles = joint_series("knee", {}, rest=90.0)
    stroke = per_stroke(angles, TIMELINE, 30.0)[0]
    assert stroke.drive_s == pytest.approx(1.0)
    assert stroke.recovery_s == pytest.approx(1.0)
    assert stroke.ratio == pytest.approx(1.0)
    uneven = per_stroke(angles, StrokeTimeline([30, 90], [50], 30.0, 1.0, 60.0), 30.0)[0]
    assert uneven.ratio == pytest.approx(2.0)
    assert np.isnan(per_stroke(angles, TIMELINE)[0].drive_s)


def test_new_measures_match_the_generated_rower() -> None:
    clip = generate(strokes=6)
    strokes = per_stroke(angle_series(clip.points, clip.facing, 0), true_timeline(clip), clip.fps)
    assert len(strokes) >= 4
    for stroke in strokes:
        swing = clip.trunk_lean_deg[stroke.catch_frame] - clip.trunk_lean_deg[stroke.finish_frame]
        assert stroke.body_swing_deg == pytest.approx(swing, abs=3)
        assert stroke.catch_elbow_deg > 150
        assert stroke.finish_elbow_deg < stroke.catch_elbow_deg
        assert 0 < stroke.arms_break < 1
        assert stroke.stroke_length > 0.5
        assert stroke.drive_s + stroke.recovery_s == pytest.approx(60 / clip.rate_spm, abs=0.1)


def test_stroke_length_is_the_same_from_an_angle() -> None:
    def length(view: float) -> float:
        clip = generate(strokes=5, view_deg=view)
        strokes = per_stroke(angle_series(clip.points, clip.facing, view), true_timeline(clip), clip.fps)
        return float(np.median([stroke.stroke_length for stroke in strokes]))

    assert length(30) == pytest.approx(length(0), rel=0.05)


def test_stroke_length_is_not_given_far_from_side_on() -> None:
    clip = generate(strokes=5, view_deg=50)
    strokes = per_stroke(angle_series(clip.points, clip.facing, 50), true_timeline(clip), clip.fps)
    assert all(np.isnan(stroke.stroke_length) for stroke in strokes)
    assert all(np.isfinite(stroke.body_swing_deg) for stroke in strokes)


def test_arms_that_bend_late_read_later_than_arms_that_bend_early() -> None:
    late = np.concatenate([np.full(40, 170.0), np.linspace(170, 60, 21), np.full(59, 170.0)])
    early = np.concatenate([np.full(30, 170.0), np.linspace(170, 60, 11), np.full(20, 60.0), np.full(59, 170.0)])
    flat = np.full(120, 20.0)
    read = [
        per_stroke(AngleSeries(flat, flat, elbow), TIMELINE)[0].arms_break for elbow in (early, late)
    ]
    assert read[0] < 0.2
    assert read[1] > 0.4


def strokes_lasting(frames: list[int]) -> list[StrokeMetrics]:
    nan = float("nan")
    starts = np.concatenate([[0], np.cumsum(frames)])
    return [
        StrokeMetrics(int(a), int(a) + 10, int(b), 20.0 + index, -20.0, nan, nan, nan, 0.4, nan)
        for index, (a, b) in enumerate(pairwise(starts))
    ]


def test_rate_steadiness_is_zero_for_even_strokes_and_grows_with_uneven_ones() -> None:
    assert rate_steadiness(strokes_lasting([60, 60, 60, 60])) == pytest.approx(0)
    assert rate_steadiness(strokes_lasting([54, 66, 54, 66])) == pytest.approx(11.5, abs=0.1)
    assert np.isnan(rate_steadiness(strokes_lasting([60, 60])))


def test_fade_is_the_change_from_the_first_half_to_the_second() -> None:
    changes = fade(strokes_lasting([60] * 6))
    assert changes["catch_lean_deg"] == pytest.approx(3.0)
    assert changes["finish_lean_deg"] == pytest.approx(0.0)
    assert "catch_knee_deg" not in changes


def test_a_short_clip_gives_no_fade() -> None:
    assert fade(strokes_lasting([60] * 5)) == {}


def test_a_straight_arm_at_the_finish_is_not_believed() -> None:
    angles = joint_series("elbow", {}, rest=150.0)
    stroke = per_stroke(angles, TIMELINE)[0]
    assert np.isnan(stroke.finish_elbow_deg)
    assert stroke.catch_elbow_deg == pytest.approx(150.0)
    assert np.isnan(stroke.arms_break)


def test_an_arm_folded_at_the_catch_is_not_believed() -> None:
    angles = joint_series("elbow", {}, rest=60.0)
    stroke = per_stroke(angles, TIMELINE)[0]
    assert np.isnan(stroke.catch_elbow_deg)
    assert stroke.finish_elbow_deg == pytest.approx(60.0)
    assert np.isnan(stroke.arms_break)


def sweep_rower_filmed_from(
    side: str, camera_side: str, towards_stern_deg: float, lean_out: float = LEAN_OUT_SHARE
) -> tuple[np.ndarray, np.ndarray, int]:
    """Return the joints of a sweep rower filmed by a real camera, their true lean, and facing.

    Built in three dimensions and then projected, so it does not share the sums the correction
    uses. The boat's x is towards the bow, y towards stroke side (port), z up. The rower faces the
    stern, so stroke side is on their right. They lean out towards their own rigger as they come
    forward of the hips, and sit square behind them.
    """
    frames = 240
    lean = np.radians(5 + 25 * np.sin(np.linspace(0, 6 * np.pi, frames)))
    rigger = 1.0 if side == "stroke" else -1.0
    forward = np.sin(lean)
    out = lean_out * np.clip(forward, 0, None) * rigger
    up = np.sqrt(1 - forward**2 - out**2)
    top = 100 * np.stack([-forward, out, up], axis=1)
    joints = np.zeros((frames, 17, 3))
    joints[:, sk.RIGHT_SHOULDER] = top + [0, 20, 0]
    joints[:, sk.LEFT_SHOULDER] = top + [0, -20, 0]
    joints[:, sk.RIGHT_HIP] = [0, 15, 0]
    joints[:, sk.LEFT_HIP] = [0, -15, 0]
    for index in range(17):
        if index not in (sk.RIGHT_SHOULDER, sk.LEFT_SHOULDER, sk.RIGHT_HIP, sk.LEFT_HIP):
            joints[:, index] = [-40 - 3 * index, 0, -20 - index]
    port = 1.0 if camera_side == "stroke" else -1.0
    turn = np.radians(towards_stern_deg)
    camera = np.array([-np.sin(turn), port * np.cos(turn), 0.0])
    right = np.cross([0.0, 0.0, 1.0], camera)
    points = np.stack([joints @ right, -joints[..., 2]], axis=-1)
    return points, np.degrees(np.arctan2(forward, up)), 1 if camera_side == "stroke" else -1


@pytest.mark.parametrize("side", ["stroke", "bow"])
@pytest.mark.parametrize("camera_side", ["stroke", "bow"])
@pytest.mark.parametrize("towards_stern", [-30.0, -15.0, 20.0, 30.0])
def test_a_sweep_rower_reads_the_same_lean_from_any_camera(
    side: str, camera_side: str, towards_stern: float
) -> None:
    points, truth, facing = sweep_rower_filmed_from(side, camera_side, towards_stern)
    measured = angle_series(points, facing, abs(towards_stern), side).trunk_lean
    assert np.abs(measured - truth).max() < 1
    uncorrected = angle_series(points, facing, abs(towards_stern)).trunk_lean
    assert np.abs(uncorrected - truth).max() > 1.5


def test_a_lean_that_does_not_show_in_the_picture_is_not_read() -> None:
    # Riggers towards a camera turned well towards the stern: forward lean barely moves the shoulders.
    points, _, facing = sweep_rower_filmed_from("stroke", "stroke", 45.0)
    assert not forward_lean_readable(points, facing, 45.0, "stroke")
    measured = angle_series(points, facing, 45.0, "stroke").trunk_lean
    assert np.isnan(measured[np.argmax(points[:, sk.RIGHT_SHOULDER, 0])])
    assert forward_lean_readable(points, facing, 45.0, "bow")
    assert forward_lean_readable(points, facing, 45.0, None)
    timeline = StrokeTimeline([20, 100, 180], [60, 140, 220], 22.0, 1.0, 80.0)
    strokes = per_stroke(angle_series(points, facing, 45.0, "stroke"), timeline, catch_lean_readable=False)
    assert all(np.isnan(stroke.catch_lean_deg) and np.isnan(stroke.body_swing_deg) for stroke in strokes)
    assert all(np.isfinite(stroke.finish_lean_deg) for stroke in strokes)


def test_a_sculler_is_measured_as_before() -> None:
    clip = generate(strokes=4, view_deg=30)
    plain = angle_series(clip.points, clip.facing, 30).trunk_lean
    assert np.allclose(angle_series(clip.points, clip.facing, 30, "scull").trunk_lean, plain)

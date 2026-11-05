import numpy as np
import pytest
from hypothesis import given
from hypothesis import strategies as st

from rowvision.geometry import joint_angle, lean_from_vertical, undo_foreshortening


def test_right_angle_at_joint() -> None:
    angle = joint_angle(np.array([1.0, 0.0]), np.array([0.0, 0.0]), np.array([0.0, 1.0]))
    assert angle == pytest.approx(90)


def test_straight_limb_is_180_degrees() -> None:
    angle = joint_angle(np.array([-1.0, 0.0]), np.array([0.0, 0.0]), np.array([1.0, 0.0]))
    assert angle == pytest.approx(180)


@given(st.floats(-80, 80), st.sampled_from([-1, 1]))
def test_lean_recovers_any_tilt_in_either_facing_direction(tilt: float, facing: int) -> None:
    hip = np.array([100.0, 200.0])
    radians = np.radians(tilt)
    shoulder = hip + 50 * np.array([np.sin(radians) * facing, -np.cos(radians)])
    assert lean_from_vertical(hip, shoulder, facing) == pytest.approx(tilt, abs=1e-6)


@given(st.floats(-70, 70), st.floats(-200, 200))
def test_foreshortening_is_undone_for_any_view(view: float, distance: float) -> None:
    origin = np.array([10.0, 0.0])
    seen = np.array([10 + distance * np.cos(np.radians(view)), 5.0])
    restored = undo_foreshortening(seen, origin, view)
    assert restored[0] == pytest.approx(10 + distance, abs=1e-6)
    assert restored[1] == pytest.approx(5.0)


def test_end_on_views_are_refused_rather_than_amplified() -> None:
    with pytest.raises(ValueError, match="too far from side-on"):
        undo_foreshortening(np.zeros(2), np.zeros(2), 80)

import numpy as np
import pytest

from rowvision import skeleton as sk
from rowvision.synthetic import generate
from rowvision.view import camera_turn, estimate_view_deg, rigger_towards_camera


@pytest.mark.parametrize("view", [0, 15, 30, 45, 60])
def test_view_angle_is_recovered(view: float) -> None:
    assert estimate_view_deg(generate(view_deg=view).points) == pytest.approx(view, abs=4)


def test_turning_either_way_gives_the_same_magnitude() -> None:
    left = estimate_view_deg(generate(view_deg=-30).points)
    right = estimate_view_deg(generate(view_deg=30).points)
    assert left == pytest.approx(right, abs=0.1)


def test_missing_trunk_is_an_error() -> None:
    with pytest.raises(ValueError, match="visible trunk"):
        estimate_view_deg(np.full((10, 17, 2), np.nan))


def shoulders(near_ahead: float, frames: int = 120, facing: int = 1) -> np.ndarray:
    """Return joints whose camera-side shoulder sits `near_ahead` pixels ahead of the far one."""
    points = np.zeros((frames, 17, 2))
    near = sk.RIGHT_SHOULDER if facing > 0 else sk.LEFT_SHOULDER
    points[:, near, 0] = near_ahead * facing
    return points


@pytest.mark.parametrize("facing", [1, -1])
def test_the_camera_side_shoulder_sitting_back_means_the_camera_is_towards_the_stern(facing: int) -> None:
    assert (camera_turn(shoulders(-12.0, facing=facing), facing) == 1).all()
    assert (camera_turn(shoulders(12.0, facing=facing), facing) == -1).all()


def test_shoulders_named_either_way_round_give_no_direction() -> None:
    points = shoulders(12.0)
    points[::2, sk.RIGHT_SHOULDER, 0] = -12.0
    assert (camera_turn(points, 1) == 0).all()


def test_a_crew_decides_the_direction_together() -> None:
    mixed = shoulders(12.0)
    mixed[::2, sk.RIGHT_SHOULDER, 0] = -12.0
    crew = [shoulders(-12.0), shoulders(-10.0), mixed]
    assert (camera_turn(crew, 1) == 1).all()


def test_the_direction_follows_a_camera_that_pans_past() -> None:
    points = shoulders(-12.0, frames=400)
    points[200:, sk.RIGHT_SHOULDER, 0] = 12.0
    turn = camera_turn(points, 1)
    assert (turn[:150] == 1).all()
    assert (turn[250:] == -1).all()


def test_only_sweep_rowers_have_a_rigger_side() -> None:
    assert rigger_towards_camera("stroke", 1) == 1
    assert rigger_towards_camera("bow", 1) == -1
    assert rigger_towards_camera("stroke", -1) == -1
    assert rigger_towards_camera("scull", 1) == 0
    assert rigger_towards_camera(None, 1) == 0

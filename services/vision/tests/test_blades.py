import numpy as np
import pytest

from rowvision.blades import blade_faces_camera, blade_height, recovery_height_cm
from rowvision.skeleton import FloatArray


@pytest.mark.parametrize(
    ("side", "facing", "expected"),
    [
        ("stroke", 1, True),
        ("stroke", -1, False),
        ("bow", 1, False),
        ("bow", -1, True),
        ("scull", 1, True),
        ("scull", -1, True),
        ("scull", 0, True),
        ("stroke", 0, False),
        ("bow", 0, False),
    ],
)
def test_only_blades_on_the_camera_side_count(side: str, facing: int, expected: bool) -> None:
    assert blade_faces_camera(side, facing) is expected


def test_an_unknown_side_is_an_error() -> None:
    with pytest.raises(ValueError, match="unknown side"):
        blade_faces_camera("port", 1)


STROKE_FRAMES = 120
RECOVERY_FRAMES = 60


def path_with_height(height_px: float, slope: float = 0.0, frames: int = 720) -> FloatArray:
    """A blade that sweeps through the recovery above a waterline, then back through the drive."""
    points = np.full((frames, 2), np.nan)
    for start in range(0, frames, STROKE_FRAMES):
        for step in range(STROKE_FRAMES):
            share = step / RECOVERY_FRAMES
            recovering = share <= 1
            x = 100 + 300 * (share if recovering else 2 - share)
            lift = height_px * min(np.sin(np.pi * share) * 3, 1) if recovering else 0.0
            points[start + step] = (x, 500 + slope * x - lift)
    return points


RECOVERIES = [(start, start + RECOVERY_FRAMES) for start in range(0, 720, STROKE_FRAMES)]


def test_height_is_measured_in_centimetres_from_the_trunk() -> None:
    height = recovery_height_cm(path_with_height(20), 0, 60, trunk_px=55)
    assert height == pytest.approx(20, abs=1)


@pytest.mark.parametrize("slope", [-0.2, 0.2])
def test_a_tilted_camera_does_not_change_the_height(slope: float) -> None:
    level = recovery_height_cm(path_with_height(20), 120, 180, 55)
    tilted = recovery_height_cm(path_with_height(20, slope), 120, 180, 55)
    assert tilted == pytest.approx(level, abs=0.5)


def test_a_larger_rower_in_frame_scales_the_same_height_down() -> None:
    near = recovery_height_cm(path_with_height(20), 0, 60, 110)
    assert near == pytest.approx(10, abs=0.5)


def test_a_missing_blade_at_either_end_gives_no_height() -> None:
    points = path_with_height(20)
    points[58:63] = np.nan
    assert np.isnan(recovery_height_cm(points, 0, 60, 55))


def test_a_blade_that_does_not_swing_gives_no_height() -> None:
    points = np.tile([100.0, 500.0], (100, 1))
    assert np.isnan(recovery_height_cm(points, 0, 60, 55))


def test_height_and_consistency_across_strokes() -> None:
    result = blade_height(path_with_height(20), RECOVERIES, 55)
    assert result is not None
    assert result.height_cm == pytest.approx(20, abs=1)
    assert result.spread_cm == pytest.approx(0, abs=0.1)
    assert result.strokes == len(RECOVERIES)


def test_uneven_strokes_show_up_in_the_spread() -> None:
    points = path_with_height(20)
    points[0:120] = path_with_height(40)[0:120]
    points[240:360] = path_with_height(40)[240:360]
    points[480:600] = path_with_height(45)[480:600]
    result = blade_height(points, RECOVERIES, 55)
    assert result is not None
    assert result.spread_cm > 5


def test_too_few_strokes_gives_no_height() -> None:
    assert blade_height(path_with_height(20), RECOVERIES[:2], 55) is None

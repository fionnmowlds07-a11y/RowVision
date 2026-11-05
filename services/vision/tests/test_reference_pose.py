import numpy as np
import pytest
from hypothesis import given
from hypothesis import strategies as st

from rowvision import skeleton as sk
from rowvision.metrics import angle_series
from rowvision.reference_pose import CATCH_REACH, FINISH_REACH, pose_at

WIDTH = 0.1


def measured(lean: float, knee: float, reach: float) -> tuple[float, float]:
    """Put a reference pose through the same measuring code used on real footage."""
    joints = pose_at(lean, knee, reach)["joints"]
    assert isinstance(joints, dict)
    points = np.zeros((1, sk.JOINT_COUNT, 2))
    for pair, name in (
        ((sk.LEFT_SHOULDER, sk.RIGHT_SHOULDER), "shoulder"),
        ((sk.LEFT_ELBOW, sk.RIGHT_ELBOW), "elbow"),
        ((sk.LEFT_WRIST, sk.RIGHT_WRIST), "hand"),
        ((sk.LEFT_HIP, sk.RIGHT_HIP), "hip"),
        ((sk.LEFT_KNEE, sk.RIGHT_KNEE), "knee"),
        ((sk.LEFT_ANKLE, sk.RIGHT_ANKLE), "ankle"),
    ):
        x, z = joints[name]
        points[0, list(pair)] = (x * 300, -z * 300)
    angles = angle_series(points, -1, 0)
    return float(angles.trunk_lean[0]), float(angles.knee[0])


@given(st.floats(-40, 45), st.floats(45, 175), st.sampled_from([CATCH_REACH, FINISH_REACH]))
def test_a_reference_pose_measures_back_to_its_angles(lean: float, knee: float, reach: float) -> None:
    got_lean, got_knee = measured(lean, knee, reach)
    assert got_lean == pytest.approx(lean, abs=0.2)
    assert got_knee == pytest.approx(knee, abs=0.5)


@pytest.mark.parametrize(
    ("lean", "knee", "reach"),
    [(0, 20, 0.5), (90, 90, 0.5), (0, 90, 0.9), (0, 90, 0.0)],
)
def test_impossible_poses_are_refused(lean: float, knee: float, reach: float) -> None:
    with pytest.raises(ValueError, match="out of range"):
        pose_at(lean, knee, reach)

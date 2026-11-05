from typing import Any

import numpy as np
import pytest
from hypothesis import given
from hypothesis import strategies as st

from rowvision import skeleton as sk
from rowvision.metrics import angle_series
from rowvision.reference_pose import CATCH_REACH, FINISH_REACH, Style, pose_at
from rowvision.synthetic import FOREARM, UPPER_ARM

PAIRS = {
    "shoulder": (sk.LEFT_SHOULDER, sk.RIGHT_SHOULDER),
    "elbow": (sk.LEFT_ELBOW, sk.RIGHT_ELBOW),
    "hand": (sk.LEFT_WRIST, sk.RIGHT_WRIST),
    "hip": (sk.LEFT_HIP, sk.RIGHT_HIP),
    "knee": (sk.LEFT_KNEE, sk.RIGHT_KNEE),
    "ankle": (sk.LEFT_ANKLE, sk.RIGHT_ANKLE),
}


def pose(*args: Any) -> dict[str, Any]:
    return pose_at(*args)


def measured(lean: float, knee: float, reach: float, style: Style) -> tuple[float, float]:
    """Put a reference pose through the same measuring code used on real footage."""
    result = pose(lean, knee, reach, style)
    points = np.zeros((1, sk.JOINT_COUNT, 2))
    for name, (left, right) in PAIRS.items():
        for index, side in ((left, "left"), (right, "right")):
            x, _, z = result[side][name]
            points[0, index] = (x * 300, -z * 300)
    angles = angle_series(points, -1, 0)
    return float(angles.trunk_lean[0]), float(angles.knee[0])


@given(
    st.floats(-40, 45),
    st.floats(45, 175),
    st.sampled_from([CATCH_REACH, FINISH_REACH]),
    st.sampled_from(list(Style)),
)
def test_every_model_measures_back_to_its_angles(
    lean: float, knee: float, reach: float, style: Style
) -> None:
    got_lean, got_knee = measured(lean, knee, reach, style)
    assert got_lean == pytest.approx(lean, abs=0.2)
    assert got_knee == pytest.approx(knee, abs=0.5)


@pytest.mark.parametrize(
    ("lean", "knee", "reach"),
    [(0, 20, 0.5), (90, 90, 0.5), (0, 90, 0.9), (0, 90, 0.0)],
)
def test_impossible_poses_are_refused(lean: float, knee: float, reach: float) -> None:
    with pytest.raises(ValueError, match="out of range"):
        pose_at(lean, knee, reach)


def catch(style: Style) -> dict[str, Any]:
    return pose(27, 52, CATCH_REACH, style)


def test_sculling_has_an_oar_on_each_side() -> None:
    assert sorted(oar["side"] for oar in catch(Style.SCULL)["oars"]) == ["port", "starboard"]


def test_stroke_side_oar_is_on_the_rowers_right() -> None:
    (oar,) = catch(Style.STROKE_SIDE)["oars"]
    assert oar["side"] == "port"
    assert oar["pin"][1] > 0


def test_bow_side_oar_is_on_the_rowers_left() -> None:
    (oar,) = catch(Style.BOW_SIDE)["oars"]
    assert oar["side"] == "starboard"
    assert oar["pin"][1] < 0


def test_sculling_is_symmetrical() -> None:
    result = catch(Style.SCULL)
    assert result["twist_deg"] == 0
    assert result["left"]["hand"][1] == pytest.approx(-result["right"]["hand"][1], abs=1e-6)
    assert result["left"]["shoulder"][0] == pytest.approx(result["right"]["shoulder"][0])


def test_stroke_side_and_bow_side_mirror_each_other() -> None:
    stroke, bow = catch(Style.STROKE_SIDE), catch(Style.BOW_SIDE)
    for joint in ("shoulder", "elbow", "hand"):
        left, mirrored = stroke["left"][joint], bow["right"][joint]
        assert left == pytest.approx([mirrored[0], -mirrored[1], mirrored[2]], abs=1e-3)


@pytest.mark.parametrize(
    ("style", "outside"), [(Style.STROKE_SIDE, "left"), (Style.BOW_SIDE, "right")]
)
def test_outside_shoulder_reaches_towards_the_stern_at_the_catch(style: Style, outside: str) -> None:
    result = catch(style)
    inside = "right" if outside == "left" else "left"
    assert result[outside]["shoulder"][0] < result[inside]["shoulder"][0]
    assert result["twist_deg"] > 5


def test_sweep_twist_unwinds_by_the_finish() -> None:
    assert pose(-22, 165, FINISH_REACH, Style.STROKE_SIDE)["twist_deg"] == 0


def test_both_sweep_hands_hold_the_one_oar() -> None:
    result = catch(Style.STROKE_SIDE)
    (oar,) = result["oars"]
    assert result["left"]["hand"] == oar["handle"]
    gap = np.linalg.norm(np.subtract(result["left"]["hand"], result["right"]["hand"]))
    assert gap == pytest.approx(0.25, abs=0.01)


def test_scullers_reach_a_larger_catch_angle_than_sweep_rowers() -> None:
    scull = catch(Style.SCULL)["oars"][0]["angle_deg"]
    sweep = catch(Style.STROKE_SIDE)["oars"][0]["angle_deg"]
    assert scull > sweep


@pytest.mark.parametrize("style", list(Style))
def test_arms_keep_their_length_at_the_finish(style: Style) -> None:
    result = pose(-22, 165, FINISH_REACH, style)
    for side in ("left", "right"):
        joints = result[side]
        upper = np.linalg.norm(np.subtract(joints["shoulder"], joints["elbow"]))
        assert upper == pytest.approx(UPPER_ARM, abs=0.03)
        assert np.linalg.norm(np.subtract(joints["elbow"], joints["hand"])) <= FOREARM + 0.15

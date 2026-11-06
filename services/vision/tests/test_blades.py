import pytest

from rowvision.blades import blade_faces_camera


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

import numpy as np
import pytest

from rowvision.synthetic import generate
from rowvision.view import estimate_view_deg


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

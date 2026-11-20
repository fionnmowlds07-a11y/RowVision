from typing import Any

import numpy as np
import pytest

from rowvision.blade_detector import (
    CROP_HEIGHT,
    CROP_WIDTH,
    HEAT_STEP,
    BladeDetector,
    crop_transform,
)


class FakeSession:
    """Reports a blade at a chosen crop position and keeps what it was given."""

    def __init__(self, column: int, row: int, peak: float = 0.9) -> None:
        self.heat = np.zeros((1, 1, CROP_HEIGHT // HEAT_STEP, CROP_WIDTH // HEAT_STEP), np.float32)
        self.heat[0, 0, row, column] = peak
        self.image: Any = None

    def run(self, names: None, feed: dict[str, Any]) -> list[Any]:
        self.image = feed["image"]
        return [self.heat, np.array([[0.25]], np.float32)]


FRAME = np.zeros((480, 640, 3), np.uint8)
HIP = np.array([300.0, 200.0])
HANDS = np.array([340.0, 190.0])


def test_the_hip_sits_in_the_middle_of_the_crop_above_centre() -> None:
    transform = crop_transform(HIP, 20, 1)
    x, y = transform @ np.append(HIP, 1.0)
    assert x == pytest.approx(CROP_WIDTH / 2)
    assert y < CROP_HEIGHT / 2


def test_a_rower_facing_left_is_mirrored_to_face_right() -> None:
    right = crop_transform(HIP, 20, 1) @ np.append(HANDS, 1.0)
    left = crop_transform(HIP, 20, -1) @ np.append(HANDS, 1.0)
    assert right[0] > CROP_WIDTH / 2 > left[0]


@pytest.mark.parametrize("facing", [1, -1])
def test_the_blade_comes_back_in_video_pixels(facing: int) -> None:
    session = FakeSession(column=96, row=40)
    fix = BladeDetector(session).locate(FRAME, HIP, HANDS, 20, facing)
    across = fix.x - HIP[0]
    assert across * facing > 0, "a blade right of the crop centre is ahead of the rower"
    transform = crop_transform(HIP, 20, facing)
    back = transform @ np.array([fix.x, fix.y, 1.0])
    assert back == pytest.approx([96.5 * HEAT_STEP, 40.5 * HEAT_STEP], abs=0.01)
    assert fix.confidence == pytest.approx(0.9)
    assert fix.in_water == pytest.approx(0.25)


def test_the_hands_are_marked_for_the_network() -> None:
    session = FakeSession(10, 10)
    BladeDetector(session).locate(FRAME, HIP, HANDS, 20, 1)
    channel = session.image[0, 3]
    row, column = np.unravel_index(channel.argmax(), channel.shape)
    x, y = crop_transform(HIP, 20, 1) @ np.append(HANDS, 1.0)
    assert (column, row) == pytest.approx((x, y), abs=1)


def test_a_rower_with_no_hands_found_has_an_empty_marker() -> None:
    session = FakeSession(10, 10)
    BladeDetector(session).locate(FRAME, HIP, None, 20, 1)
    assert session.image[0, 3].max() == 0

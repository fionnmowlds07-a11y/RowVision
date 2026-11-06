from pathlib import Path

import cv2
import numpy as np
import pytest

from rowvision import video
from rowvision.video import VideoReader


@pytest.fixture
def clip(tmp_path: Path) -> Path:
    path = tmp_path / "clip.avi"
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter.fourcc(*"MJPG"), 30, (64, 48))
    for index in range(30):
        writer.write(np.full((48, 64, 3), index * 8, dtype=np.uint8))
    writer.release()
    return path


def brightness(frame: np.ndarray) -> float:
    return float(frame.mean())


def test_stepping_forward_reads_the_same_frames_as_seeking(
    clip: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    indexes = [0, 5, 10, 11, 25]
    reader = VideoReader(clip)
    stepped = [brightness(reader(index)) for index in indexes]
    monkeypatch.setattr(video, "MAX_STEP_FRAMES", 0)
    seeking = VideoReader(clip)
    assert [brightness(seeking(index)) for index in indexes] == pytest.approx(stepped, abs=1)


def test_going_backwards_still_works(clip: Path) -> None:
    reader = VideoReader(clip)
    later = brightness(reader(20))
    assert brightness(reader(5)) < later


def test_reading_past_the_end_is_an_error(clip: Path) -> None:
    with pytest.raises(ValueError, match="cannot read frame"):
        VideoReader(clip)(50)

import shutil
import subprocess
from pathlib import Path

import cv2
import numpy as np
import pytest

from rowvision.video import VideoReader


@pytest.fixture
def clip(tmp_path: Path) -> Path:
    path = tmp_path / "clip.avi"
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter.fourcc(*"MJPG"), 30, (64, 48))
    for index in range(30):
        writer.write(np.full((48, 64, 3), index * 8, dtype=np.uint8))
    writer.release()
    return path


def phone_like(tmp_path: Path, codec: str) -> Path:
    """A moving test pattern with uneven frame timing, long keyframe gaps and B-frames, as phones
    record. Seeking lands early on these."""
    path = tmp_path / f"{codec}.mp4"
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=160x90:rate=30:duration=10",
            "-vf",
            "setpts=(N+0.45*random(1))/30/TB",
            "-fps_mode",
            "passthrough",
            "-c:v",
            codec,
            "-g",
            "120",
            "-bf",
            "3",
            "-pix_fmt",
            "yuv420p",
            *(["-x265-params", "log-level=error"] if codec == "libx265" else []),
            str(path),
        ],
        check=True,
    )
    return path


def decoded_in_order(path: Path) -> list[np.ndarray]:
    capture = cv2.VideoCapture(str(path))
    frames = []
    while True:
        ok, frame = capture.read()
        if not ok:
            return frames
        frames.append(frame)


def brightness(frame: np.ndarray) -> float:
    return float(frame.mean())


def test_reads_the_frame_asked_for(clip: Path) -> None:
    reader = VideoReader(clip)
    assert [round(brightness(reader(index)) / 8) for index in [0, 5, 10, 11, 25]] == [
        0,
        5,
        10,
        11,
        25,
    ]


def test_going_backwards_still_works(clip: Path) -> None:
    reader = VideoReader(clip)
    later = brightness(reader(20))
    assert brightness(reader(5)) < later


def test_reading_past_the_end_is_an_error(clip: Path) -> None:
    with pytest.raises(ValueError, match="cannot read frame"):
        VideoReader(clip)(50)


def test_an_unreadable_file_is_an_error(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="cannot read video"):
        VideoReader(tmp_path / "missing.mp4")


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="needs ffmpeg")
@pytest.mark.parametrize("codec", ["libx264", "libx265"])
def test_every_jump_lands_on_the_exact_frame(tmp_path: Path, codec: str) -> None:
    """The analysis scouts forward, then jumps back to measure each rower, and far ahead."""
    path = phone_like(tmp_path, codec)
    truth = decoded_in_order(path)
    reader = VideoReader(path)
    asked = [*range(0, 300, 3), 10, 200, 201, 150, 290, 45, 46, 260, 0, 299]
    wrong = [index for index in asked if not np.array_equal(reader(index), truth[index])]
    assert wrong == []

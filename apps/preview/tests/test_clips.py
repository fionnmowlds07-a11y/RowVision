from pathlib import Path

import cv2
import numpy as np
import pytest
from fakes import write_video

from rowvision_preview import clips
from rowvision_preview.clips import ClipLibrary


@pytest.fixture
def library(tmp_path: Path) -> ClipLibrary:
    write_video(tmp_path / "b clip(1).avi")
    write_video(tmp_path / "a.AVI", frames=3)
    (tmp_path / "notes.txt").write_text("not a video")
    (tmp_path / "folder.avi").mkdir()
    return ClipLibrary(tmp_path)


def brightness(jpeg: bytes) -> float:
    image = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_GRAYSCALE)
    return float(image.mean())


def test_lists_only_video_files(library: ClipLibrary) -> None:
    assert library.names() == ["a.AVI", "b clip(1).avi"]


def test_path_refuses_names_outside_the_folder(library: ClipLibrary) -> None:
    with pytest.raises(KeyError):
        library.path("../b clip(1).avi")


def test_info_describes_the_clip(library: ClipLibrary) -> None:
    info = library.info("b clip(1).avi")
    assert (info.frames, info.width, info.height) == (12, 64, 48)
    assert info.fps == pytest.approx(30)


def test_frames_come_back_in_any_order(library: ClipLibrary) -> None:
    name = "b clip(1).avi"
    for index in (7, 2, 3, 11, 0):
        assert brightness(library.frame_jpeg(name, index)) == pytest.approx(index * 20, abs=4)


def test_switching_clips_reads_the_new_clip(library: ClipLibrary) -> None:
    library.frame_jpeg("b clip(1).avi", 11)
    assert brightness(library.frame_jpeg("a.AVI", 2)) == pytest.approx(40, abs=4)


@pytest.mark.parametrize("index", [-1, 12])
def test_frames_outside_the_clip_are_refused(library: ClipLibrary, index: int) -> None:
    with pytest.raises(ValueError):
        library.frame_jpeg("b clip(1).avi", index)


def test_clip_claiming_too_many_frames_still_serves_those_it_has(
    library: ClipLibrary, monkeypatch: pytest.MonkeyPatch
) -> None:
    class ShortReader(clips.VideoReader):
        def __call__(self, index: int) -> object:
            if index >= 5:
                raise ValueError(f"cannot read frame {index}")
            return super().__call__(index)

    monkeypatch.setattr(clips, "VideoReader", ShortReader)
    assert library.frame_jpeg("b clip(1).avi", 4)
    with pytest.raises(ValueError):
        library.frame_jpeg("b clip(1).avi", 8)

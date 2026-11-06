import io
from pathlib import Path

import cv2
import numpy as np
import pytest
from fakes import write_video

from rowvision_preview import clips
from rowvision_preview.clips import ClipLibrary, UploadError


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


@pytest.fixture
def uploads(tmp_path: Path) -> ClipLibrary:
    (tmp_path / "videos").mkdir()
    write_video(tmp_path / "videos" / "folder.avi")
    return ClipLibrary(tmp_path / "videos", tmp_path / "uploads")


def video(tmp_path: Path, frames: int) -> bytes:
    path = tmp_path / f"made-{frames}.avi"
    write_video(path, frames=frames)
    return path.read_bytes()


def add(library: ClipLibrary, name: str, data: bytes) -> str:
    return library.add(name, io.BytesIO(data), len(data))


def stored(tmp_path: Path) -> list[str]:
    return sorted(item.name for item in (tmp_path / "uploads").iterdir())


def test_added_videos_sit_beside_the_folder_clips(uploads: ClipLibrary, tmp_path: Path) -> None:
    name = add(uploads, "new.avi", video(tmp_path, 4))
    assert uploads.names() == ["folder.avi", "new.avi"]
    assert uploads.path(name) == tmp_path / "uploads" / "new.avi"
    assert uploads.info(name).frames == 4


def test_the_same_video_twice_keeps_one_copy(uploads: ClipLibrary, tmp_path: Path) -> None:
    data = video(tmp_path, 4)
    assert add(uploads, "new.avi", data) == add(uploads, "new.avi", data)
    assert stored(tmp_path) == ["new.avi"]


def test_a_different_video_with_the_same_name_keeps_both(
    uploads: ClipLibrary, tmp_path: Path
) -> None:
    first = add(uploads, "new.avi", video(tmp_path, 4))
    second = add(uploads, "new.avi", video(tmp_path, 6))
    assert first != second
    assert uploads.info(first).frames == 4
    assert uploads.info(second).frames == 6


def test_a_video_matching_a_folder_clip_is_not_copied(uploads: ClipLibrary, tmp_path: Path) -> None:
    data = (tmp_path / "videos" / "folder.avi").read_bytes()
    assert add(uploads, "folder.avi", data) == "folder.avi"
    assert stored(tmp_path) == []


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("../../escape.avi", "escape.avi"),
        ("..\\..\\escape.avi", "escape.avi"),
        ("/etc/odd name.AVI", "odd name.avi"),
        ("we<ird>.avi", "we_ird_.avi"),
        ("....avi", "clip.avi"),
    ],
)
def test_upload_names_cannot_leave_the_folder(
    uploads: ClipLibrary, tmp_path: Path, name: str, expected: str
) -> None:
    assert add(uploads, name, video(tmp_path, 4)) == expected
    assert stored(tmp_path) == [expected]


@pytest.mark.parametrize("name", ["virus.exe", "no-suffix", "clip.avi.txt"])
def test_other_file_types_are_refused(uploads: ClipLibrary, name: str) -> None:
    with pytest.raises(UploadError, match="not supported"):
        add(uploads, name, b"data")


def test_a_cut_off_upload_leaves_nothing_behind(uploads: ClipLibrary, tmp_path: Path) -> None:
    with pytest.raises(UploadError, match="did not finish"):
        uploads.add("new.avi", io.BytesIO(b"short"), 500)
    assert stored(tmp_path) == []


def test_an_oversized_upload_is_refused_before_reading(
    uploads: ClipLibrary, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(clips, "MAX_UPLOAD_BYTES", 3)
    with pytest.raises(UploadError, match="too big"):
        uploads.add("new.avi", io.BytesIO(b"data"), 4)


def test_a_library_without_uploads_refuses_them(library: ClipLibrary) -> None:
    with pytest.raises(UploadError, match="cannot accept"):
        library.add("new.avi", io.BytesIO(b"data"), 4)

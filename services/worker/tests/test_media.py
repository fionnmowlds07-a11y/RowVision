import subprocess
from fractions import Fraction
from pathlib import Path

import pytest

from rowvision_worker import media


def clip(path: Path, seconds: int = 3, extra: tuple[str, ...] = ()) -> Path:
    subprocess.check_call(
        ["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", f"testsrc2=size=320x180:rate=30:duration={seconds}",
         "-pix_fmt", "yuv420p", *extra, str(path)]
    )  # fmt: skip
    return path


def probe_report(**stream: object) -> dict[str, object]:
    base = {"codec_type": "video", "width": 1920, "height": 1080, "avg_frame_rate": "30/1", "nb_frames": "300"}
    return {"streams": [{"codec_type": "audio"}, {**base, **stream}], "format": {"duration": "10.0"}}


def test_the_average_rate_is_preferred() -> None:
    facts = media.parse_probe(probe_report(avg_frame_rate="30000/1001", r_frame_rate="90000/1"))
    assert facts.fps == Fraction(30000, 1001)


def test_a_timebase_is_not_taken_for_a_frame_rate() -> None:
    facts = media.parse_probe(probe_report(avg_frame_rate="0/0", r_frame_rate="30/1"))
    assert facts.fps == 30


def test_no_usable_rate_is_an_error() -> None:
    with pytest.raises(ValueError, match="frame rate"):
        media.parse_probe(probe_report(avg_frame_rate="0/0", r_frame_rate="90000/1"))


def test_frames_are_worked_out_when_missing() -> None:
    report = probe_report()
    del report["streams"][1]["nb_frames"]  # type: ignore[index]
    assert media.parse_probe(report).frames == 300


def test_the_filming_date_is_read() -> None:
    report = probe_report()
    report["format"]["tags"] = {"creation_time": "2026-11-01T08:30:00.000000Z"}  # type: ignore[index]
    assert media.parse_probe(report).filmed_at.isoformat() == "2026-11-01T08:30:00+00:00"  # type: ignore[union-attr]


def test_every_frame_survives(tmp_path: Path) -> None:
    source = clip(tmp_path / "source.mp4")
    facts = media.make_working_copy(source, tmp_path / "copy.mp4", 0)
    assert facts.frames == 90
    assert facts.fps == 30


def test_the_section_is_cut(tmp_path: Path) -> None:
    source = clip(tmp_path / "source.mp4", seconds=4)
    facts = media.make_working_copy(source, tmp_path / "copy.mp4", 2)
    assert 58 <= facts.frames <= 62


def test_a_trimmed_section_stops_where_the_athlete_chose(tmp_path: Path) -> None:
    source = clip(tmp_path / "source.mp4", seconds=4)
    facts = media.make_working_copy(source, tmp_path / "copy.mp4", 1, 2)
    assert 58 <= facts.frames <= 62


def test_a_section_stops_at_sixty_seconds(tmp_path: Path) -> None:
    source = clip(tmp_path / "source.mp4", seconds=62)
    facts = media.make_working_copy(source, tmp_path / "copy.mp4", 0)
    assert facts.frames == 1800


def test_the_copy_is_h264_with_short_gaps(tmp_path: Path) -> None:
    source = clip(tmp_path / "source.mp4", extra=("-c:v", "libx265", "-x265-params", "log-level=error"))
    copy = tmp_path / "copy.mp4"
    media.make_working_copy(source, copy, 0)
    report = subprocess.check_output(
        ["ffprobe", "-v", "error", "-select_streams", "v", "-show_entries", "stream=codec_name:frame=pict_type",
         "-of", "csv=p=0", str(copy)], text=True,
    )  # fmt: skip
    assert "h264" in report
    assert report.count("I") >= 6


def test_a_phone_clip_keeps_each_frame_at_its_own_time(tmp_path: Path) -> None:
    # Phones say 30 fps but drop the odd frame, so the average is a little under. Without care the
    # copy's frame times are rounded to 1/60 s and the viewer reads the wrong frame (#243).
    source = tmp_path / "phone.mp4"
    subprocess.check_call(
        ["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=60:duration=10",
         "-vf", "select='not(mod(n\\,2))*not(eq(mod(n\\,256)\\,6))'", "-fps_mode", "vfr",
         "-video_track_timescale", "90000", "-pix_fmt", "yuv420p", str(source)]
    )  # fmt: skip
    facts = media.make_working_copy(source, tmp_path / "copy.mp4", 0)
    assert facts.fps != 30
    times = subprocess.check_output(
        ["ffprobe", "-v", "error", "-select_streams", "v", "-show_entries", "frame=pts_time",
         "-of", "csv=p=0", str(tmp_path / "copy.mp4")], text=True,
    )  # fmt: skip
    shown = sorted(float(line.strip(", ")) for line in times.splitlines() if line.strip(", "))
    assert len(shown) == facts.frames
    assert max(abs(t * float(facts.fps) - n) for n, t in enumerate(shown)) < 0.01

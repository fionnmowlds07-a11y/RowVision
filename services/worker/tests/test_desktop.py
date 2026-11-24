import io
import json
import threading
from fractions import Fraction
from pathlib import Path
from typing import Any

import pytest

from rowvision_worker import desktop, media
from rowvision_worker.engine import Cancelled, Done, FakeEngine, NeedsTap, Setup, Tap, Video, fake_report
from rowvision_worker.media import Facts

FACTS = Facts(width=1280, height=720, fps=Fraction(30), frames=240, duration=8.0, filmed_at=None)
SETUP = {"boat_class": "2-", "side": "bow", "seat": 2}


def job_in(folder: Path, **changes: Any) -> desktop.DesktopJob:
    return desktop.parse_job({"folder": str(folder), "source": "clip.mov", **SETUP, **changes})


@pytest.fixture
def copies(monkeypatch: pytest.MonkeyPatch) -> list[Path]:
    made: list[Path] = []

    def make(source: Path, target: Path, start: float, length: float) -> Facts:
        target.write_bytes(b"video")
        made.append(target)
        return FACTS

    monkeypatch.setattr(media, "make_working_copy", make)
    return made


class Paused:
    def run(self, video: Video, setup: Setup, report: Any, stopped: Any) -> NeedsTap:
        return NeedsTap({"frame": 12, "boats": []})


class Stopping:
    def run(self, video: Video, setup: Setup, report: Any, stopped: Any) -> Done:
        raise Cancelled


class Broken:
    def run(self, video: Video, setup: Setup, report: Any, stopped: Any) -> Done:
        raise ValueError("bad frame")


class Noisy:
    def run(self, video: Video, setup: Setup, report: Any, stopped: Any) -> Done:
        for frame in range(1000):
            report("Measuring your rower", frame / 1000)
        return Done(fake_report(video), "test")


def test_a_job_keeps_its_tap_and_section() -> None:
    tap = {"t": 1.5, "x": 0.25, "y": 0.75}  # The same shape the add page saves
    job = job_in(Path("clip"), start=12, length=20, tap=tap)
    assert job.start == 12
    assert job.length == 20
    assert job_in(Path("clip")).length == 60
    assert job.setup.tap == Tap(1.5, 0.25, 0.75)
    assert job_in(Path("clip")).setup.tap is None


def test_a_finished_clip_leaves_everything_in_its_folder(tmp_path: Path, copies: list[Path]) -> None:
    events: list[dict[str, Any]] = []
    code = desktop.run(job_in(tmp_path), FakeEngine(), events.append, lambda: False)
    assert code == desktop.FINISHED
    assert (tmp_path / "working.mp4").read_bytes() == b"video"
    assert not (tmp_path / "working.part.mp4").exists()
    summary = json.loads((tmp_path / "summary.json").read_text())
    assert summary["version"] == "fake"
    assert "poses" not in summary["rower"]
    assert "poses" in json.loads((tmp_path / "frames.json").read_text())
    assert json.loads((tmp_path / "video.json").read_text())["frames"] == 240
    assert events[-1]["event"] == "done"
    assert events[-1]["band"] == "Good"


def test_a_finished_run_leaves_a_log_to_check_afterwards(
    tmp_path: Path, copies: list[Path], caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level("INFO", logger=desktop.__name__)
    desktop.run(job_in(tmp_path), FakeEngine(), lambda _: None, lambda: False)
    text = caplog.text
    assert "2-, seat athlete seat 2" in text
    assert "working copy: 240 frames at 30.0000 fps" in text
    assert "result: accuracy" in text
    assert "finished in" in text


def test_a_rerun_reuses_the_working_copy(tmp_path: Path, copies: list[Path]) -> None:
    desktop.run(job_in(tmp_path), FakeEngine(), lambda _: None, lambda: False)
    code = desktop.run(job_in(tmp_path, source=None), FakeEngine(), lambda _: None, lambda: False)
    assert code == desktop.FINISHED
    assert len(copies) == 1


def test_a_copy_cut_short_is_made_again(tmp_path: Path, copies: list[Path]) -> None:
    (tmp_path / "working.part.mp4").write_bytes(b"half")
    desktop.run(job_in(tmp_path), FakeEngine(), lambda _: None, lambda: False)
    assert (tmp_path / "working.mp4").read_bytes() == b"video"


def test_a_missed_tap_asks_again(tmp_path: Path, copies: list[Path]) -> None:
    events: list[dict[str, Any]] = []
    assert desktop.run(job_in(tmp_path), Paused(), events.append, lambda: False) == desktop.NEEDS_TAP
    assert events[-1] == {"event": "needs_tap", "pause": {"frame": 12, "boats": []}}
    assert json.loads((tmp_path / "pause.json").read_text())["frame"] == 12
    assert not (tmp_path / "summary.json").exists()

    desktop.run(job_in(tmp_path, source=None), FakeEngine(), lambda _: None, lambda: False)
    assert not (tmp_path / "pause.json").exists()


def test_cancelling_stops_and_saves_no_result(tmp_path: Path, copies: list[Path]) -> None:
    events: list[dict[str, Any]] = []
    assert desktop.run(job_in(tmp_path), Stopping(), events.append, lambda: False) == desktop.CANCELLED
    assert events[-1] == {"event": "cancelled"}
    assert not (tmp_path / "summary.json").exists()


def test_cancelling_before_analysis_skips_it(tmp_path: Path, copies: list[Path]) -> None:
    assert desktop.run(job_in(tmp_path), Broken(), lambda _: None, lambda: True) == desktop.CANCELLED


def test_a_failure_gives_a_plain_message(tmp_path: Path, copies: list[Path]) -> None:
    events: list[dict[str, Any]] = []
    assert desktop.run(job_in(tmp_path), Broken(), events.append, lambda: False) == desktop.FAILED
    assert events[-1] == {"event": "failed", "message": desktop.FAILED_MESSAGE}


def test_a_file_that_is_not_a_video_fails_cleanly(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    def refuse(source: Path, target: Path, start: float, length: float) -> Facts:
        raise ValueError("no video stream")

    monkeypatch.setattr(media, "make_working_copy", refuse)
    events: list[dict[str, Any]] = []
    assert desktop.run(job_in(tmp_path), FakeEngine(), events.append, lambda: False) == desktop.FAILED
    assert events[-1]["event"] == "failed"
    assert not (tmp_path / "working.mp4").exists()


def test_a_rerun_with_no_video_fails_cleanly(tmp_path: Path) -> None:
    events: list[dict[str, Any]] = []
    code = desktop.run(job_in(tmp_path, source=None), FakeEngine(), events.append, lambda: False)
    assert code == desktop.FAILED


def test_progress_is_not_sent_for_every_frame(tmp_path: Path, copies: list[Path]) -> None:
    events: list[dict[str, Any]] = []
    desktop.run(job_in(tmp_path), Noisy(), events.append, lambda: False)
    stages = [event for event in events if event["event"] == "stage"]
    assert 50 < len(stages) <= 102


@pytest.mark.parametrize("text", ["cancel\n", "", "something\ncancel\n", "something\n"])
def test_cancel_or_a_closed_stdin_stops_the_job(text: str) -> None:
    stop = threading.Event()
    desktop.watch_input(io.StringIO(text), stop)
    assert stop.is_set()


@pytest.mark.parametrize("text", ["not json", "{}", '{"folder": "c", "boat_class": "2-", "side": "bow"}'])
def test_a_bad_job_file_fails_cleanly(text: str, tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    path = tmp_path / "job.json"
    path.write_text(text)
    assert desktop.main([str(path)]) == desktop.FAILED
    assert json.loads(capsys.readouterr().out)["event"] == "failed"


def test_every_line_sent_is_json(capsys: pytest.CaptureFixture[str]) -> None:
    desktop.send_line({"event": "stage", "stage": "Finding boats", "progress": 0.5})
    assert json.loads(capsys.readouterr().out)["progress"] == 0.5


def finished(folder: Path, copies: list[Path]) -> None:
    desktop.run(job_in(folder), FakeEngine(), lambda event: None, lambda: False)


def test_measuring_again_rewrites_the_result_with_the_current_version(
    tmp_path: Path, copies: list[Path]
) -> None:
    finished(tmp_path, copies)
    events: list[dict[str, Any]] = []
    assert desktop.measure_again(tmp_path, events.append) == desktop.FINISHED
    summary = json.loads((tmp_path / "summary.json").read_text())
    assert summary["version"] == desktop.code_version() != "fake"
    assert summary["rower"]["catches"] == [30, 112, 194]
    assert "poses" not in summary["rower"]
    assert len(json.loads((tmp_path / "frames.json").read_text())["poses"]) == 240
    assert events == [{"event": "done", "version": summary["version"], "accuracy": 76.0, "band": "Good", "overall": None}]


def test_a_clip_with_its_video_removed_cannot_be_measured_again(tmp_path: Path, copies: list[Path]) -> None:
    finished(tmp_path, copies)
    (tmp_path / "frames.json").unlink()
    before = (tmp_path / "summary.json").read_text()
    events: list[dict[str, Any]] = []
    assert desktop.measure_again(tmp_path, events.append) == desktop.FAILED
    assert events == [{"event": "failed", "message": desktop.NO_SKELETON_MESSAGE}]
    assert (tmp_path / "summary.json").read_text() == before


def test_measuring_again_with_no_result_fails_cleanly(tmp_path: Path) -> None:
    events: list[dict[str, Any]] = []
    assert desktop.measure_again(tmp_path, events.append) == desktop.FAILED
    assert events == [{"event": "failed", "message": desktop.FAILED_MESSAGE}]


def test_the_program_measures_again_and_tells_its_version(
    tmp_path: Path, copies: list[Path], capsys: pytest.CaptureFixture[str]
) -> None:
    finished(tmp_path, copies)
    assert desktop.main(["--version"]) == desktop.FINISHED
    assert json.loads(capsys.readouterr().out) == {"event": "version", "version": desktop.code_version()}
    assert desktop.main(["--remeasure", str(tmp_path)]) == desktop.FINISHED
    assert json.loads(capsys.readouterr().out)["event"] == "done"


def test_a_job_can_ask_for_the_whole_crew() -> None:
    assert job_in(Path("clip")).setup.scope == "seat"
    assert job_in(Path("clip"), scope="crew").setup.scope == "crew"
    assert job_in(Path("clip"), scope="everyone").setup.scope == "seat"


def test_a_coach_job_is_only_a_coach_job_for_a_whole_crew() -> None:
    assert job_in(Path("clip"), scope="crew", coach=True).setup.coach is True
    assert job_in(Path("clip"), coach=True).setup.coach is False
    assert job_in(Path("clip"), scope="crew").setup.coach is False


def test_measuring_again_takes_the_rowers_side_from_the_job(
    tmp_path: Path, copies: list[Path]
) -> None:
    finished(tmp_path, copies)
    (tmp_path / "job.json").write_text(json.dumps({"seat": 2, "side": "bow"}))
    assert desktop.measure_again(tmp_path, lambda event: None) == desktop.FINISHED
    assert json.loads((tmp_path / "summary.json").read_text())["rower"]["side"] == "bow"


def test_measuring_again_works_without_a_job_file(tmp_path: Path, copies: list[Path]) -> None:
    finished(tmp_path, copies)
    (tmp_path / "job.json").unlink(missing_ok=True)
    assert desktop.measure_again(tmp_path, lambda event: None) == desktop.FINISHED
    assert json.loads((tmp_path / "summary.json").read_text())["rower"].get("side") is None


def test_a_rig_is_kept_only_when_it_gives_every_seat_a_side() -> None:
    eight = {"boat_class": "8+", "side": "stroke", "seat": 8}
    german = ["stroke", "bow", "stroke", "bow", "bow", "stroke", "bow", "stroke"]
    assert job_in(Path("clip"), **eight, rig=german).setup.rig == tuple(german)
    assert job_in(Path("clip"), **eight, rig=german[:7]).setup.rig is None
    assert job_in(Path("clip"), **eight, rig=["port"] * 8).setup.rig is None
    assert job_in(Path("clip"), **eight).setup.rig is None
    assert job_in(Path("clip"), boat_class="1x", side="scull", seat=1, rig=["bow"]).setup.rig is None


def test_the_job_says_how_hard_to_work() -> None:
    assert job_in(Path("clip"), threads=4, priority="low").threads == 4
    assert job_in(Path("clip"), threads=4, priority="low").priority == "low"
    assert job_in(Path("clip")).threads is None
    assert job_in(Path("clip")).priority == "below"
    assert job_in(Path("clip"), threads=0, priority="max").threads is None
    assert job_in(Path("clip"), threads=True).threads is None
    assert job_in(Path("clip"), priority="max").priority == "below"


@pytest.mark.parametrize(("priority", "nice"), [("normal", None), ("below", 10), ("low", 19)])
def test_the_priority_asked_for_is_the_one_given(
    monkeypatch: pytest.MonkeyPatch, priority: str, nice: int | None
) -> None:
    given: list[int] = []
    monkeypatch.setattr(desktop.sys, "platform", "linux")
    monkeypatch.setattr(desktop.os, "nice", given.append)
    desktop.lower_priority(priority)
    assert given == ([] if nice is None else [nice])

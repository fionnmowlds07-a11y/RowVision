from dataclasses import replace
from fractions import Fraction
from pathlib import Path
from typing import Any

import pytest

from rowvision_worker import worker
from rowvision_worker.db import Job
from rowvision_worker.engine import Cancelled, Done, FakeEngine, NeedsTap, Setup, Tap
from rowvision_worker.media import Facts

JOB = Job(
    id="j", clip_id="c", user_id="u", email="a@example.com", attempts=1, source_path="u/c/source",
    working_path=None, section_start=0, section_length=60, setup=Setup("8+", "bow", 3, Tap(1, 0.5, 0.5)),
    fps=None, frames=None, width=None, height=None,
)  # fmt: skip
FACTS = Fraction(30)


class FakeQueue:
    def __init__(self) -> None:
        self.calls: list[tuple[str, Any]] = []

    def next_job(self, name: str) -> Job | None:
        return None

    def renew(self, job: Job, stage: str, progress: float | None) -> bool:
        return False

    def save_copy(self, job: Job, path: str, facts: Facts) -> None:
        self.calls.append(("save_copy", path))

    def finish(self, job: Job, version: str, summary: dict[str, Any], frames_path: str | None, headline: Any) -> None:
        self.calls.append(("finish", (version, summary, frames_path, headline)))

    def pause(self, job: Job, pause: dict[str, Any]) -> None:
        self.calls.append(("pause", pause))

    def cancelled(self, job: Job) -> None:
        self.calls.append(("cancelled", None))

    def failed(self, job: Job, message: str) -> None:
        self.calls.append(("failed", message))

    def names(self) -> list[str]:
        return [name for name, _ in self.calls]


class FakeFiles:
    def __init__(self) -> None:
        self.uploaded: list[str] = []
        self.deleted: list[str] = []
        self.folders: list[Path] = []

    def download(self, bucket: str, name: str, target: Path) -> None:
        target.write_bytes(b"video")
        self.folders.append(target.parent)

    def upload(self, bucket: str, name: str, source: Path, content_type: str) -> None:
        self.uploaded.append(f"{bucket}/{name}")

    def delete(self, bucket: str, name: str) -> None:
        self.deleted.append(f"{bucket}/{name}")


class Engine:
    def __init__(self, outcome: Any) -> None:
        self.outcome = outcome

    def run(self, video: Any, setup: Any, report: Any, stopped: Any) -> Any:
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return self.outcome


@pytest.fixture(autouse=True)
def no_ffmpeg(monkeypatch: pytest.MonkeyPatch) -> None:
    def make(source: Path, target: Path, start: float, length: float) -> Facts:
        target.write_bytes(b"copy")
        return Facts(100, 50, FACTS, 90, 3.0, None)

    monkeypatch.setattr("rowvision_worker.media.make_working_copy", make)


def run(outcome: Any, job: Job = JOB) -> tuple[FakeQueue, FakeFiles, list[str]]:
    queue, files, told = FakeQueue(), FakeFiles(), []
    worker.run_job(job, queue, files, Engine(outcome), lambda _, what: told.append(what))
    return queue, files, told


REPORT = {"rower": None, "views": None, "warnings": []}


def test_a_finished_job_saves_its_result_and_tells_the_athlete() -> None:
    queue, files, told = run(Done(REPORT, "v1"))
    assert queue.names() == ["save_copy", "finish"]
    assert "frames/u/c/frames-j.json" in files.uploaded
    assert told == ["done"]


def test_the_upload_goes_once_the_copy_is_saved() -> None:
    queue, files, _ = run(Done(REPORT, "v1"))
    assert files.deleted == ["uploads/u/c/source"]
    assert "working/u/c/working.mp4" in files.uploaded
    assert queue.calls[0] == ("save_copy", "u/c/working.mp4")


def test_nothing_is_left_on_this_machine() -> None:
    _, files, _ = run(Done(REPORT, "v1"))
    assert files.folders
    assert not any(folder.exists() for folder in files.folders)


def test_nothing_is_left_after_a_failure() -> None:
    _, files, _ = run(RuntimeError("boom"))
    assert not any(folder.exists() for folder in files.folders)


def test_a_missed_tap_pauses_and_emails() -> None:
    queue, _, told = run(NeedsTap({"frame": 5}))
    assert ("pause", {"frame": 5}) in queue.calls
    assert told == ["needs_tap"]


def test_a_failure_is_reported_in_plain_words() -> None:
    queue, _, told = run(RuntimeError("boom"))
    assert queue.calls[-1] == ("failed", worker.FAILED_MESSAGE)
    assert "boom" not in worker.FAILED_MESSAGE
    assert told == []


def test_cancelling_stops_without_a_failure() -> None:
    queue, _, told = run(Cancelled())
    assert queue.names()[-1] == "cancelled"
    assert told == []


def test_a_rerun_reuses_the_working_copy() -> None:
    job = replace(JOB, source_path=None, working_path="u/c/working.mp4", fps=30.0, frames=90, width=100, height=50)
    queue, files, _ = run(Done(REPORT, "v1"), job)
    assert "save_copy" not in queue.names()
    assert files.deleted == []


def test_the_fake_engine_needs_no_models() -> None:
    outcome = FakeEngine().run(worker.Video(Path("x"), 30.0, 90, 100, 50), JOB.setup, lambda *_: None, lambda: False)
    assert isinstance(outcome, Done)
    assert outcome.report["rower"]["card"]["overall"] == 87.0


def test_a_cancelled_fake_stops() -> None:
    with pytest.raises(Cancelled):
        FakeEngine().run(worker.Video(Path("x"), 30.0, 90, 100, 50), JOB.setup, lambda *_: None, lambda: True)


def test_keep_alive_passes_on_a_stop_request() -> None:
    import threading

    class Stopping(FakeQueue):
        def renew(self, job: Job, stage: str, progress: float | None) -> bool:
            finished.set()
            return True

    finished = threading.Event()
    status = worker.Status()
    original = worker.RENEW_SECONDS
    worker.RENEW_SECONDS = 0.01
    try:
        worker.keep_alive(Stopping(), JOB, status, finished)
    finally:
        worker.RENEW_SECONDS = original
    assert status.stop.is_set()

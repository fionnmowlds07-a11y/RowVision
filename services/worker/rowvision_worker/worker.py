"""Do one job from start to finish, keeping nothing on this machine afterwards."""

import json
import logging
import tempfile
import threading
from collections.abc import Callable
from pathlib import Path
from typing import Protocol

from rowvision_worker import media
from rowvision_worker.db import Job, Queue
from rowvision_worker.engine import Cancelled, Done, Engine, NeedsTap, Video
from rowvision_worker.results import headline, split_report

RENEW_SECONDS = 10.0
FAILED_MESSAGE = "We couldn't analyse this clip. Try another clip, or report the problem."

log = logging.getLogger(__name__)


class Files(Protocol):
    def download(self, bucket: str, name: str, target: Path) -> None: ...
    def upload(self, bucket: str, name: str, source: Path, content_type: str) -> None: ...
    def delete(self, bucket: str, name: str) -> None: ...


Notify = Callable[[Job, str], None]
"""Email the athlete: 'done' or 'needs_tap'."""


class Status:
    """Shared between the job and the thread that keeps its lease alive."""

    def __init__(self) -> None:
        self.stage = "Getting ready"
        self.progress: float | None = None
        self.stop = threading.Event()

    def report(self, stage: str, progress: float | None) -> None:
        self.stage, self.progress = stage, progress


def keep_alive(queue: Queue, job: Job, status: Status, finished: threading.Event) -> None:
    while not finished.wait(RENEW_SECONDS):
        if queue.renew(job, status.stage, status.progress):
            status.stop.set()


def prepare(job: Job, queue: Queue, files: Files, folder: Path, status: Status) -> Video:
    """Fetch the working copy, making it first if this job has not got one."""
    copy = folder / "working.mp4"
    if job.working_path is not None:
        assert job.fps and job.frames and job.width and job.height
        files.download("working", job.working_path, copy)
        return Video(copy, job.fps, job.frames, job.width, job.height)

    assert job.source_path is not None
    status.report("Preparing your video", None)
    source = folder / "source"
    files.download("uploads", job.source_path, source)
    facts = media.make_working_copy(source, copy, job.section_start)
    path = f"{job.user_id}/{job.clip_id}/working.mp4"
    files.upload("working", path, copy, "video/mp4")
    queue.save_copy(job, path, facts)
    files.delete("uploads", job.source_path)
    source.unlink()
    return Video(copy, float(facts.fps), facts.frames, facts.width, facts.height)


def save_result(job: Job, done: Done, queue: Queue, files: Files, folder: Path) -> None:
    summary, frames = split_report(done.report)
    path = f"{job.user_id}/{job.clip_id}/frames-{job.id}.json"
    data = folder / "frames.json"
    data.write_text(json.dumps(frames, allow_nan=False, separators=(",", ":")))
    files.upload("frames", path, data, "application/json")
    queue.finish(job, done.version, summary, path, headline(summary))


def run_job(job: Job, queue: Queue, files: Files, engine: Engine, notify: Notify) -> None:
    status = Status()
    finished = threading.Event()
    thread = threading.Thread(target=keep_alive, args=(queue, job, status, finished), daemon=True)
    thread.start()
    try:
        with tempfile.TemporaryDirectory(prefix="rowvision-") as name:
            folder = Path(name)
            video = prepare(job, queue, files, folder, status)
            outcome = engine.run(video, job.setup, status.report, status.stop.is_set)
            if isinstance(outcome, NeedsTap):
                queue.pause(job, outcome.pause)
                notify(job, "needs_tap")
            else:
                save_result(job, outcome, queue, files, folder)
                notify(job, "done")
    except Cancelled:
        queue.cancelled(job)
    except Exception:  # noqa: BLE001 - one bad clip must not stop the worker
        log.exception("job %s failed", job.id)
        queue.failed(job, FAILED_MESSAGE)
    finally:
        finished.set()
        thread.join()

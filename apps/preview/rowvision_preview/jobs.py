"""Run one analysis at a time in the background, reporting progress and saving results.

The analysis takes minutes, so it runs in a thread that the page polls. Starting a new job stops
the old one. Results are saved as JSON, so a clip that has been analysed reopens at once.
"""

import hashlib
import json
import pickle
import re
import threading
import traceback
from collections.abc import Callable
from dataclasses import asdict, dataclass, field
from enum import StrEnum
from pathlib import Path
from typing import Any, Protocol

import numpy as np
import rowvision
from rowvision.boats import boat_at
from rowvision.pipeline import COARSE_STEP, Request, Scouting, analyse, scout
from rowvision.pose import PoseBackend
from rowvision.skeleton import FloatArray

from rowvision_preview.clips import ClipLibrary
from rowvision_preview.results import analysis_json, boat_choices_json, result_summary

BOAT_SEATS = {"1x": 1, "2x": 2, "2-": 2, "4x": 4, "4-": 4, "4+": 4, "8+": 8}
"""Rowing seats in each boat class. A cox has no seat number."""
SCULLING_BOATS = {"1x", "2x", "4x"}
SIDE_NAMES = {"stroke": "Stroke side", "bow": "Bow side", "scull": "Sculling"}
"""Rowing sides. Each gets its own reference model."""
MAX_BOATS = 20
RESULT_VERSION = 2
"""Raise this when the saved JSON changes shape, so older results are not reused."""


def sides_for(boat_class: str) -> list[str]:
    """Return the rowing sides a boat class allows."""
    return ["scull"] if boat_class in SCULLING_BOATS else ["stroke", "bow"]


class Source(Protocol):
    fps: float
    frames: int

    def __call__(self, index: int) -> Any: ...


class State(StrEnum):
    IDLE = "idle"
    RUNNING = "running"
    NEEDS_BOAT = "needs_boat"
    DONE = "done"
    FAILED = "failed"
    CANCELLED = "cancelled"


class Cancelled(Exception):
    """Raised inside the analysis to stop it at the next frame."""


@dataclass(frozen=True)
class Settings:
    clip: str
    boat_class: str
    boats_in_video: int
    seat: int
    side: str = "scull"

    @staticmethod
    def parse(body: dict[str, Any], clips: list[str]) -> "Settings":
        """Check what the page sent. Raises ValueError with a message to show."""
        clip, boat_class = body.get("clip"), body.get("boat_class")
        boats, seat = body.get("boats_in_video"), body.get("seat")
        if clip not in clips:
            raise ValueError("Pick a clip from the list.")
        if boat_class not in BOAT_SEATS:
            raise ValueError("Pick a boat class from the list.")
        if type(boats) is not int or not 1 <= boats <= MAX_BOATS:
            raise ValueError(f"Boats in the video must be a whole number from 1 to {MAX_BOATS}.")
        seats = BOAT_SEATS[boat_class]
        if type(seat) is not int or not 1 <= seat <= seats:
            raise ValueError(f"Seat must be from 1 to {seats} in a {boat_class}.")
        side = body.get("side")
        if side not in sides_for(boat_class):
            names = " or ".join(SIDE_NAMES[item].lower() for item in sides_for(boat_class))
            raise ValueError(f"A {boat_class} needs {names}.")
        return Settings(clip, boat_class, boats, seat, side)

    def request(self, boat_tap: tuple[int, float, float] | None = None) -> Request:
        return Request(
            boat_seats=BOAT_SEATS[self.boat_class],
            seat=self.seat,
            boats_in_video=self.boats_in_video,
            boat_tap=boat_tap,
        )


@dataclass
class Job:
    settings: Settings
    state: State = State.RUNNING
    stage: str = "Starting"
    progress: float | None = None
    """Share of the current stage finished, or None when that is not known."""
    preview: int = 0
    boats: list[dict[str, Any]] = field(default_factory=list)
    result: dict[str, Any] | None = None
    error: str | None = None
    scouting: Scouting | None = None
    cancel: threading.Event = field(default_factory=threading.Event)

    def status(self) -> dict[str, Any]:
        return {
            "state": self.state.value,
            "settings": asdict(self.settings),
            "stage": self.stage,
            "progress": self.progress,
            "preview": self.preview,
            "boats": self.boats,
            "result": self.result,
            "error": self.error,
        }


class _SavedDetections:
    """Replays saved coarse detections as a pose backend, where a frame is its own index.

    This lets scout() run unchanged, without decoding the video or running a model.
    """

    def __init__(self, points: list[FloatArray], scores: list[FloatArray]) -> None:
        self._points = points
        self._scores = scores

    def detect(self, frame: int) -> FloatArray:
        return np.zeros((0, 4))

    def estimate(self, frame: int, boxes: FloatArray) -> tuple[FloatArray, FloatArray]:
        return self._points[frame // COARSE_STEP], self._scores[frame // COARSE_STEP]


def load_detections(folder: Path, clip: str, source: Source) -> _SavedDetections | None:
    """Return saved detections for a clip, if they were made from a video matching this one."""
    # Downloads of the same clip get a suffix such as "(1)".
    stem = re.sub(r"\(\d+\)$", "", Path(clip).stem)
    path = folder / f"{stem}.pkl"
    if not path.exists():
        return None
    with path.open("rb") as handle:
        points, scores, fps, frames = pickle.load(handle)
    expected = -(-source.frames // COARSE_STEP)
    if fps != source.fps or frames != source.frames or len(points) != expected:
        return None
    return _SavedDetections(points, scores)


def code_version() -> str:
    """Hash the analysis code, so results from older code are not shown as current."""
    digest = hashlib.sha256(str(RESULT_VERSION).encode())
    for path in sorted(Path(rowvision.__file__).parent.glob("*.py")):
        digest.update(path.read_bytes())
    return digest.hexdigest()


class Runner:
    def __init__(
        self,
        clips: ClipLibrary,
        results: Path,
        detections: Path,
        open_source: Callable[[Path], Source],
        make_backend: Callable[[], PoseBackend],
    ) -> None:
        self._clips = clips
        self._results = results
        self._detections = detections
        self._open_source = open_source
        self._make_backend = make_backend
        self._backend: PoseBackend | None = None
        self._job: Job | None = None
        self._thread: threading.Thread | None = None
        self._lock = threading.Lock()

    def status(self) -> dict[str, Any]:
        return self._job.status() if self._job else {"state": State.IDLE.value}

    def start(self, settings: Settings) -> None:
        with self._lock:
            self._stop()
            job = Job(settings)
            self._job = job
            self._launch(job, None)

    def cancel(self) -> None:
        with self._lock:
            self._stop()

    def choose_boat(self, x: float, y: float) -> None:
        """Carry on a job that stopped to ask for a boat. Raises ValueError if none is waiting."""
        with self._lock:
            job = self._job
            if job is None or job.state is not State.NEEDS_BOAT:
                raise ValueError("No analysis is waiting for a boat.")
            job.state = State.RUNNING
            self._launch(job, (job.preview, x, y))

    def _launch(self, job: Job, boat_tap: tuple[int, float, float] | None) -> None:
        previous = self._thread
        self._thread = threading.Thread(
            target=self._guarded, args=(job, boat_tap, previous), daemon=True
        )
        self._thread.start()

    def _stop(self) -> None:
        """Mark the job as stopped without waiting, as grouping boats can run for minutes unbroken.

        Its thread stops at its next check, and any new job waits for that before starting.
        """
        job = self._job
        if job is not None and job.state in (State.RUNNING, State.NEEDS_BOAT):
            job.cancel.set()
            job.state = State.CANCELLED

    def _guarded(
        self,
        job: Job,
        boat_tap: tuple[int, float, float] | None,
        previous: threading.Thread | None,
    ) -> None:
        try:
            if previous is not None and previous.is_alive():
                job.stage = "Stopping the last analysis"
                previous.join()
            self._run(job, boat_tap)
        except Cancelled:
            pass
        except Exception as error:  # noqa: BLE001 - shown on the page instead of killing the thread
            traceback.print_exc()
            job.error = f"{type(error).__name__}: {error}"
            job.state = State.FAILED

    def _run(self, job: Job, boat_tap: tuple[int, float, float] | None) -> None:
        settings = job.settings
        clip = self._clips.path(settings.clip)
        boat = None if boat_tap is None else self._boat_index(job, boat_tap)
        saved = self._results / f"{clip.stem}-{self._key(job, clip, boat)}.json"
        if saved.exists():
            self._finish(job, json.loads(saved.read_text()))
            return

        source = self._open_source(clip)
        scouting = job.scouting or self._scout(job, source)
        job.scouting = scouting
        backend = self._get_backend(job)
        if job.cancel.is_set():
            raise Cancelled
        job.stage, job.progress = "Measuring your rower", 0.0
        analysis = analyse(
            self._watched(job, source),
            source.frames,
            source.fps,
            settings.request(boat_tap),
            backend,
            scouting,
        )
        if analysis.needs_boat_choice:
            job.preview = analysis.preview
            job.boats = boat_choices_json(analysis.boat_choices)
            job.state = State.NEEDS_BOAT
            return
        result = {**analysis_json(analysis), "settings": asdict(job.settings), "code": code_version()}
        self._save(saved, result)
        self._finish(job, result)

    def saved(self) -> list[dict[str, Any]]:
        """Return a summary of each result saved by the current analysis code."""
        summaries = []
        for path in sorted(self._results.glob("*.json")):
            result = json.loads(path.read_text())
            if result.get("code") == code_version():
                summaries.append(result_summary(path.name, result))
        return summaries

    def saved_result(self, name: str) -> dict[str, Any]:
        """Return one saved result. Only names from the folder listing are accepted."""
        known = {path.name: path for path in self._results.glob("*.json")}
        result: dict[str, Any] = json.loads(known[name].read_text())
        return result

    def _finish(self, job: Job, result: dict[str, Any]) -> None:
        job.result = result
        job.state = State.DONE

    def _boat_index(self, job: Job, boat_tap: tuple[int, float, float]) -> int | None:
        """Identify the tapped boat, so that any tap on the same boat reuses its saved result."""
        assert job.scouting is not None
        frame, x, y = boat_tap
        boats = job.scouting.boats
        chosen = boat_at(boats, frame // COARSE_STEP, np.array([x, y]))
        return None if chosen is None else boats.index(chosen)

    def _key(self, job: Job, clip: Path, boat: int | None) -> str:
        stat = clip.stat()
        parts = [code_version(), stat.st_size, stat.st_mtime_ns, asdict(job.settings), boat]
        return hashlib.sha256(json.dumps(parts).encode()).hexdigest()[:16]

    def _save(self, path: Path, result: dict[str, Any]) -> None:
        self._results.mkdir(parents=True, exist_ok=True)
        partial = path.with_suffix(".tmp")
        partial.write_text(json.dumps(result, allow_nan=False, separators=(",", ":")))
        partial.replace(path)

    def _get_backend(self, job: Job) -> PoseBackend:
        if self._backend is None:
            job.stage, job.progress = "Loading the pose model", None
            self._backend = self._make_backend()
        return self._backend

    def _scout(self, job: Job, source: Source) -> Scouting:
        job.stage, job.progress = "Finding boats", None
        cached = load_detections(self._detections, job.settings.clip, source)
        if cached is not None:
            return scout(lambda index: index, source.frames, source.fps, cached)
        backend = self._get_backend(job)
        job.stage, job.progress = "Finding boats", 0.0
        return scout(self._watched(job, source), source.frames, source.fps, backend)

    def _watched(self, job: Job, source: Source) -> Callable[[int], Any]:
        """Wrap frame reads to report progress and stop on request.

        Both passes read frames in order, so the frame index shows how far through they are.
        """

        def read(index: int) -> Any:
            if job.cancel.is_set():
                raise Cancelled
            job.progress = index / max(source.frames, 1)
            return source(index)

        return read

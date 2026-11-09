"""Analyse one clip on this computer, for the desktop app.

The app starts this program with the path of a job file. Everything is kept in the clip's own
folder, so nothing here touches the database or storage. Progress goes to stdout as one JSON
object per line. Sending "cancel", or closing stdin, stops the analysis at the next frame.
"""

import argparse
import ctypes
import json
import logging
import os
import sys
import threading
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, TextIO

from rowvision_worker import media, models
from rowvision_worker.engine import Cancelled, Done, Engine, NeedsTap, Setup, Tap, Video, make_engine
from rowvision_worker.results import headline, split_report

FAILED_MESSAGE = "We couldn't analyse this clip. Try another clip, or send it to us."
MODELS_FAILED_MESSAGE = "We couldn't get the measuring models. Check your internet connection and try again."
PROGRESS_STEP = 0.01
"""Smallest change in progress worth telling the app about."""
BELOW_NORMAL_PRIORITY = 0x00004000
FINISHED, NEEDS_TAP, CANCELLED, FAILED = 0, 3, 4, 1
"""Exit codes."""

log = logging.getLogger(__name__)

Send = Callable[[dict[str, Any]], None]


@dataclass(frozen=True)
class DesktopJob:
    folder: Path
    source: Path | None
    """The video to cut. None when the folder already has a working copy, as on a rerun."""
    start: float
    length: float
    setup: Setup
    engine: str
    device: str


def parse_job(data: dict[str, Any]) -> DesktopJob:
    tap = data.get("tap")
    source = data.get("source")
    return DesktopJob(
        folder=Path(data["folder"]),
        source=Path(source) if source else None,
        start=float(data.get("start", 0)),
        length=float(data.get("length", media.SECTION_SECONDS)),
        setup=Setup(
            boat_class=data["boat_class"],
            side=data["side"],
            seat=int(data["seat"]),
            tap=Tap(float(tap["t"]), float(tap["x"]), float(tap["y"])) if tap else None,
        ),
        engine=data.get("engine", "real"),
        device=data.get("device", "cpu"),
    )


def write_json(path: Path, value: Any) -> None:
    """Write beside the target first, so a crash never leaves half a file."""
    part = path.with_suffix(".part")
    part.write_text(json.dumps(value, allow_nan=False, separators=(",", ":")))
    part.replace(path)


def prepare(job: DesktopJob, send: Send) -> Video:
    """Make the working copy, or reuse the one already in the folder."""
    copy = job.folder / "working.mp4"
    facts = job.folder / "video.json"
    if copy.exists() and facts.exists():
        saved = json.loads(facts.read_text())
        return Video(copy, saved["fps"], saved["frames"], saved["width"], saved["height"])
    if job.source is None:
        raise FileNotFoundError("This clip has no video left to analyse")
    send({"event": "stage", "stage": "Preparing your video", "progress": None})
    part = job.folder / "working.part.mp4"
    made = media.make_working_copy(job.source, part, job.start, job.length)
    part.replace(copy)
    saved = {
        "fps": float(made.fps),
        "frames": made.frames,
        "width": made.width,
        "height": made.height,
        "duration": made.duration,
        "filmed_at": made.filmed_at.isoformat() if made.filmed_at else None,
    }
    write_json(facts, saved)
    return Video(copy, saved["fps"], made.frames, made.width, made.height)


def progress_sender(send: Send) -> Callable[[str, float | None], None]:
    """Pass on new stages and real movement, as the engine reports every frame."""
    last: tuple[str, float | None] = ("", None)

    def report(stage: str, progress: float | None) -> None:
        nonlocal last
        moved = progress is None or last[1] is None or abs(progress - last[1]) >= PROGRESS_STEP
        if stage != last[0] or moved:
            last = (stage, progress)
            send({"event": "stage", "stage": stage, "progress": progress})

    return report


def run(job: DesktopJob, engine: Engine, send: Send, stopped: Callable[[], bool]) -> int:
    job.folder.mkdir(parents=True, exist_ok=True)
    (job.folder / "pause.json").unlink(missing_ok=True)
    try:
        video = prepare(job, send)
        if stopped():
            raise Cancelled
        outcome = engine.run(video, job.setup, progress_sender(send), stopped)
        if isinstance(outcome, NeedsTap):
            write_json(job.folder / "pause.json", outcome.pause)
            send({"event": "needs_tap", "pause": outcome.pause})
            return NEEDS_TAP
        save(job.folder, outcome, send)
        return FINISHED
    except Cancelled:
        send({"event": "cancelled"})
        return CANCELLED
    except Exception:  # noqa: BLE001 - the app needs a message, not a traceback
        log.exception("analysis failed")
        send({"event": "failed", "message": FAILED_MESSAGE})
        return FAILED


def save(folder: Path, done: Done, send: Send) -> None:
    summary, frames = split_report(done.report)
    write_json(folder / "frames.json", frames)
    write_json(folder / "summary.json", {"version": done.version, **summary})
    accuracy, band, overall = headline(summary)
    send({"event": "done", "version": done.version, "accuracy": accuracy, "band": band, "overall": overall})


def watch_input(stream: TextIO, stop: threading.Event) -> None:
    """Stop on "cancel", or when the app goes away and stdin closes."""
    for line in stream:
        if line.strip() == "cancel":
            break
    stop.set()


def lower_priority() -> None:
    """Analysis can take many minutes, and the computer should stay usable."""
    if sys.platform == "win32":
        kernel = ctypes.windll.kernel32  # type: ignore[attr-defined]
        kernel.SetPriorityClass(kernel.GetCurrentProcess(), BELOW_NORMAL_PRIORITY)
    else:
        os.nice(10)


def send_line(event: dict[str, Any]) -> None:
    print(json.dumps(event, allow_nan=False), flush=True)


def models_main(args: list[str]) -> int:
    """`--models status` says whether the models are there. `--models fetch` gets them, with progress."""
    folder = models.checkpoints_dir()
    if args == ["status"]:
        send_line(models.status(folder))
        return FINISHED
    if args != ["fetch"]:
        send_line({"event": "failed", "message": MODELS_FAILED_MESSAGE})
        return FAILED
    stop = threading.Event()
    threading.Thread(target=watch_input, args=(sys.stdin, stop), daemon=True).start()
    try:
        models.fetch(folder, send_line, stop.is_set, os.environ.get("ROWVISION_MODELS_BASE") or None)
    except models.Cancelled:
        send_line({"event": "cancelled"})
        return CANCELLED
    except models.ModelError as error:
        send_line({"event": "failed", "message": str(error)})
        return FAILED
    except Exception:  # noqa: BLE001 - the app needs a message, not a traceback
        log.exception("could not get the models")
        send_line({"event": "failed", "message": MODELS_FAILED_MESSAGE})
        return FAILED
    send_line({"event": "done"})
    return FINISHED


def main(argv: list[str] | None = None) -> int:
    arguments_given = sys.argv[1:] if argv is None else argv
    if arguments_given[:1] == ["--models"]:
        logging.basicConfig(level=logging.INFO, stream=sys.stderr)
        return models_main(arguments_given[1:])
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("job", type=Path, help="Path of the job file")
    arguments = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, stream=sys.stderr)
    lower_priority()
    try:
        job = parse_job(json.loads(arguments.job.read_text()))
    except (OSError, ValueError, KeyError, TypeError):
        log.exception("could not read the job")
        send_line({"event": "failed", "message": FAILED_MESSAGE})
        return FAILED
    stop = threading.Event()
    threading.Thread(target=watch_input, args=(sys.stdin, stop), daemon=True).start()
    return run(job, make_engine(job.engine, job.device), send_line, stop.is_set)


if __name__ == "__main__":
    sys.exit(main())

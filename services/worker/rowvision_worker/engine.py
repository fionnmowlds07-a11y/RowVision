"""Run the analysis on a working copy, and decide when the athlete must be asked."""

from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

import numpy as np
from rowvision.boats import boat_at
from rowvision.pipeline import COARSE_STEP, Request, Scope, Scouting, analyse, scout
from rowvision.pose import PoseBackend, RtmBackend
from rowvision.report import analysis_json, boat_choices_json
from rowvision.seats import track_at
from rowvision.version import code_version
from rowvision.video import VideoReader

BOAT_SEATS = {"1x": 1, "2x": 2, "2-": 2, "4x": 4, "4-": 4, "4+": 4, "8+": 8}
MEASURING = {Scope.SEAT: "Measuring your rower", Scope.CREW: "Measuring your crew"}
TAP_REACH_TRUNKS = 2.5
"""How far from the middle of a rower's body a tap may land. Heads and feet are about this far."""


class Cancelled(Exception):
    """Raised inside the analysis to stop it at the next frame."""


@dataclass(frozen=True)
class Tap:
    seconds: float
    x: float
    y: float
    """Position as a share of the frame."""


@dataclass(frozen=True)
class Setup:
    boat_class: str
    side: str
    seat: int
    tap: Tap | None
    scope: str = "seat"
    """"seat" measures the athlete alone. "crew" measures every seat, which takes far longer."""


@dataclass(frozen=True)
class Video:
    path: Path
    fps: float
    frames: int
    width: int
    height: int


@dataclass(frozen=True)
class Done:
    report: dict[str, Any]
    version: str


@dataclass(frozen=True)
class NeedsTap:
    pause: dict[str, Any]


Report = Callable[[str, float | None], None]
"""Tell the worker the current stage and how far through it is."""


class Engine(Protocol):
    def run(
        self, video: Video, setup: Setup, report: Report, stopped: Callable[[], bool]
    ) -> Done | NeedsTap: ...


def plan_request(scouting: Scouting, setup: Setup, video: Video) -> Request | None:
    """Turn the setup into a request, or None when the athlete must be asked.

    The nearest boat and rower are always found, however far off the tap was, so this also checks
    that the tap really landed on someone.
    """
    confirmed = sum(boat.confirmed for boat in scouting.boats)
    base = {
        "boat_seats": BOAT_SEATS[setup.boat_class],
        "seat": setup.seat,
        "boats_in_video": max(confirmed, 1),
        "side": setup.side,
        "scope": Scope(setup.scope),
    }
    if not scouting.boats:
        return Request(**base)
    if setup.tap is None:
        return None if confirmed > 1 else Request(**base)

    frame = min(round(setup.tap.seconds * video.fps), video.frames - 1)
    point = np.array([setup.tap.x * video.width, setup.tap.y * video.height])
    boat = boat_at(scouting.boats, frame // COARSE_STEP, point)
    if boat is None:
        return None
    tapped = (frame, float(point[0]), float(point[1]))
    if boat.too_far:
        return Request(**base, boat_tap=tapped)
    track = track_at(boat.tracks, frame // COARSE_STEP, point)
    if track is None:
        return None
    centre = track.centre()[frame // COARSE_STEP]
    if float(np.linalg.norm(centre - point)) > TAP_REACH_TRUNKS * track.trunk():
        return None
    return Request(**base, tap=tapped, boat_tap=tapped)


def pause_for(scouting: Scouting, video: Video) -> NeedsTap:
    return NeedsTap(
        {
            "frame": scouting.preview,
            "seconds": scouting.preview / video.fps,
            "boats": boat_choices_json(scouting.choices()),
        }
    )


class RealEngine:
    def __init__(self, device: str) -> None:
        self._device = device
        self._backend: PoseBackend | None = None

    def _get_backend(self, report: Report) -> PoseBackend:
        if self._backend is None:
            report("Loading the pose model", None)
            self._backend = RtmBackend(device=self._device)
        return self._backend

    def run(
        self, video: Video, setup: Setup, report: Report, stopped: Callable[[], bool]
    ) -> Done | NeedsTap:
        source = VideoReader(video.path)
        backend = self._get_backend(report)

        def watched(stage: str) -> Callable[[int], Any]:
            def read(index: int) -> Any:
                if stopped():
                    raise Cancelled
                report(stage, index / max(video.frames, 1))
                return source(index)

            return read

        scouting = scout(watched("Finding boats"), video.frames, video.fps, backend)
        request = plan_request(scouting, setup, video)
        if request is None:
            return pause_for(scouting, video)
        analysis = analyse(
            watched(MEASURING[request.scope]), video.frames, video.fps, request, backend, scouting
        )
        if analysis.needs_boat_choice or (scouting.boats and not analysis.rowers and _unseen(analysis)):
            return pause_for(scouting, video)
        return Done(analysis_json(analysis), code_version())


def _unseen(analysis: Any) -> bool:
    """The seat could not be found, so a tap would settle it, unlike a boat that is too far off."""
    return any("not visible" in warning for warning in analysis.warnings)


class FakeEngine:
    """Gives a canned result with no models, for acceptance tests and local work."""

    def run(
        self, video: Video, setup: Setup, report: Report, stopped: Callable[[], bool]
    ) -> Done | NeedsTap:
        report("Measuring your rower", 0.5)
        if stopped():
            raise Cancelled
        return Done(fake_report(video), "fake")


def fake_report(video: Video) -> dict[str, Any]:
    frames = video.frames
    metric = {"phase": "catch", "spread": 2.0, "reason": None}
    return {
        "fps": video.fps,
        "frames": frames,
        "view_deg": 5.0,
        "views": [5.0] * frames,
        "film_closer": None,
        "warnings": [],
        "shots": [{"start": 0, "end": frames, "kind": "rowing"}],
        "facing": 1,
        "rower": {
            "seat": 3,
            "rate_spm": 22.0,
            "catches": [30, 112, 194],
            "finishes": [66, 148],
            "poses": [None] * frames,
            "angles": {"trunk": [None] * frames, "knee": [None] * frames, "elbow": [None] * frames},
            "strokes": [],
            "timing": None,
            "card": {
                "overall": 87.0,
                "phases": {"catch": 70.0, "finish": 80.0},
                "metrics": [
                    {
                        **metric,
                        "name": "catch_lean_deg",
                        "label": "Body angle at the catch",
                        "value": 23.0,
                        "target": {"low": 26.0, "high": 31.0, "sources": [], "evidence": "ergometer"},
                        "score": 70.0,
                    },
                    {
                        **metric,
                        "name": "catch_knee_deg",
                        "label": "Knee angle at the catch",
                        "value": 60.0,
                        "target": {"low": 50.0, "high": 55.0, "sources": [], "evidence": "ergometer"},
                        "score": None,
                    },
                ],
            },
            "rating": {
                "accuracy": 76.0,
                "band": "Good",
                "calibrated": True,
                "labelled_frames": 108,
                "warnings": [],
            },
        },
    }


def make_engine(kind: str, device: str) -> Engine:
    return FakeEngine() if kind == "fake" else RealEngine(device)

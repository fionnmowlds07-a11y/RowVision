"""Run the full analysis: find rowers and shots coarsely, then measure the chosen rowers finely."""

from collections.abc import Callable
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

import numpy as np

from rowvision import skeleton as sk
from rowvision.boats import (
    Boat,
    boat_at,
    find_boats,
    fit_to_seats,
    overlap_frames,
    preview_frame,
)
from rowvision.metrics import StrokeMetrics, angle_series, per_stroke
from rowvision.pose import PoseBackend
from rowvision.seats import assign_seats, track_at
from rowvision.shots import Shot, ShotKind, split_shots
from rowvision.skeleton import FloatArray
from rowvision.strokes import detect_strokes, reach_signal
from rowvision.tracking import Track, track_people
from rowvision.view import estimate_view_deg

COARSE_STEP = 5
BOX_MARGIN = 0.25
VIEW_WINDOW_SECONDS = 3.0
MIN_VIEW_FRAMES = 4
UNCORRECTABLE_VIEW_DEG = 60.0

FrameReader = Callable[[int], Any]
"""Return the frame at an index."""


class Scope(StrEnum):
    SEAT = "seat"
    CREW = "crew"


@dataclass(frozen=True)
class Request:
    boat_seats: int
    scope: Scope = Scope.SEAT
    seat: int | None = None
    tap: tuple[int, float, float] | None = None
    """Frame, x and y where the athlete tapped themselves. Overrides `seat`."""
    boats_in_video: int = 1
    """How many boats the athlete says are in the video."""
    boat_tap: tuple[int, float, float] | None = None
    """Frame, x and y where the athlete tapped their boat."""


@dataclass(frozen=True)
class RowerResult:
    seat: int | None
    points: FloatArray
    scores: FloatArray
    rate_spm: float
    regularity: float
    strokes: list[StrokeMetrics]
    summary: dict[str, float]
    """Median of each measure across strokes. Single strokes on small rowers are too noisy to use."""
    spread: dict[str, float]
    """Interquartile range of each measure, showing how far the median can be trusted."""


@dataclass(frozen=True)
class BoatChoice:
    """One boat to show the athlete on the preview frame."""

    outline: FloatArray | None
    people: int
    too_far: bool
    confirmed: bool


@dataclass(frozen=True)
class Scouting:
    """What the coarse pass found, ready for the athlete to choose from."""

    tracks: list[Track]
    boats: list[Boat]
    preview: int
    """Full-rate frame index showing the most boats."""

    def choices(self) -> list[BoatChoice]:
        frame = self.preview // COARSE_STEP
        return [
            BoatChoice(boat.outline(frame), len(boat.members), boat.too_far, boat.confirmed)
            for boat in self.boats
        ]


@dataclass(frozen=True)
class Analysis:
    fps: float
    frames: int
    facing: int = 0
    seats_complete: bool = False
    view_deg: float = float("nan")
    shots: list[Shot] = field(default_factory=list)
    rowers: list[RowerResult] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    needs_boat_choice: bool = False
    """True when the athlete must tap their boat before analysis can continue."""
    boat_choices: list[BoatChoice] = field(default_factory=list)
    preview: int = 0
    overlap_share: float = 0.0
    """Share of the chosen boat's frames dropped because another boat crossed it."""


def coarse_pass(
    read: FrameReader, frames: int, backend: PoseBackend
) -> tuple[list[FloatArray], list[FloatArray]]:
    points, scores = [], []
    for index in range(0, frames, COARSE_STEP):
        frame = read(index)
        found, confidence = backend.estimate(frame, backend.detect(frame))
        points.append(found)
        scores.append(confidence)
    return points, scores


def view_by_frame(tracks: list[Track], fps: float) -> FloatArray:
    """Return one view angle per frame, as the median across rowers in a sliding window."""
    frames = len(tracks[0].points) if tracks else 0
    views = np.full(frames, np.nan)
    half = max(round(VIEW_WINDOW_SECONDS * fps / 2), 1)
    for frame in range(frames):
        window = slice(max(frame - half, 0), frame + half + 1)
        estimates = []
        for track in tracks:
            points = track.points[window]
            if np.isfinite(points[:, sk.LEFT_SHOULDER, 0]).sum() >= MIN_VIEW_FRAMES:
                estimates.append(estimate_view_deg(points))
        if estimates:
            views[frame] = float(np.median(estimates))
    return views


def _boxes_for(track: Track, frames: int) -> FloatArray:
    """Interpolate a person box for every frame between coarse sightings. NaN outside them."""
    seen = np.where(np.isfinite(track.points[:, sk.LEFT_SHOULDER, 0]))[0]
    corners = np.stack(
        [
            np.nanmin(track.points[seen, :, 0], axis=1),
            np.nanmin(track.points[seen, :, 1], axis=1),
            np.nanmax(track.points[seen, :, 0], axis=1),
            np.nanmax(track.points[seen, :, 1], axis=1),
        ],
        axis=1,
    )
    margin = BOX_MARGIN * np.maximum(corners[:, 2] - corners[:, 0], corners[:, 3] - corners[:, 1])
    corners = corners + np.stack([-margin, -margin, margin, margin], axis=1)
    positions = seen * COARSE_STEP
    every = np.arange(frames)
    boxes = np.stack([np.interp(every, positions, corners[:, i]) for i in range(4)], axis=1)
    boxes[(every < positions[0]) | (every > positions[-1])] = np.nan
    return boxes


def _fine_pass(
    read: FrameReader, frames: int, track: Track, backend: PoseBackend
) -> tuple[FloatArray, FloatArray]:
    boxes = _boxes_for(track, frames)
    points = np.full((frames, sk.JOINT_COUNT, 2), np.nan)
    scores = np.zeros((frames, sk.JOINT_COUNT))
    for index in range(frames):
        if np.isfinite(boxes[index]).all():
            found, confidence = backend.estimate(read(index), boxes[index : index + 1])
            if len(found):
                points[index], scores[index] = found[0], confidence[0]
    return points, scores


def _usable_view(shots: list[Shot], views: FloatArray) -> float:
    side = [shot for shot in shots if shot.kind in (ShotKind.SIDE_ON, ShotKind.OBLIQUE)]
    if not side:
        return float("nan")
    return float(np.nanmedian(np.concatenate([views[shot.start : shot.end] for shot in side])))


def _measure(
    seat: int | None, points: FloatArray, scores: FloatArray, facing: int, view: float, fps: float
) -> RowerResult:
    timeline = detect_strokes(reach_signal(points, facing), fps)
    strokes = per_stroke(angle_series(points, facing, view), timeline)
    names = ("catch_lean_deg", "finish_lean_deg", "catch_knee_deg", "finish_elbow_deg",
             "drive_ratio", "legs_lead")  # fmt: skip
    summary: dict[str, float] = {}
    spread: dict[str, float] = {}
    for name in names:
        values = np.array([getattr(stroke, name) for stroke in strokes], dtype=float)
        values = values[np.isfinite(values)]
        if len(values):
            summary[name] = float(np.median(values))
            spread[name] = float(np.subtract(*np.percentile(values, [75, 25])))
    return RowerResult(
        seat, points, scores, timeline.rate_spm, timeline.regularity, strokes, summary, spread
    )


def scout(read: FrameReader, frames: int, fps: float, backend: PoseBackend) -> Scouting:
    """Find every person and boat in the clip from sampled frames."""
    coarse_fps = fps / COARSE_STEP
    tracks = track_people(*coarse_pass(read, frames, backend), coarse_fps)
    boats = find_boats(tracks, coarse_fps)
    return Scouting(tracks, boats, preview_frame(boats) * COARSE_STEP)


def needs_boat_choice(scouting: Scouting, request: Request) -> bool:
    """Ask the athlete unless exactly one boat was stated and exactly one was confirmed.

    Distant unconfirmed boats do not trigger a question on their own, because they may be people
    on the bank. They are listed when the athlete is asked.
    """
    if request.boat_tap is not None or not scouting.boats:
        return False
    confirmed = sum(boat.confirmed for boat in scouting.boats)
    return confirmed != 1 or request.boats_in_video != 1


def _chosen_boat(scouting: Scouting, request: Request) -> Boat | None:
    if request.boat_tap is None:
        return next((boat for boat in scouting.boats if boat.confirmed), None)
    frame, x, y = request.boat_tap
    return boat_at(scouting.boats, frame // COARSE_STEP, np.array([x, y]))


def _boat_warnings(
    boat: Boat, surplus: int, boat_seats: int, boats: list[Boat], stated: int
) -> list[str]:
    warnings = []
    confirmed = sum(item.confirmed for item in boats)
    if not confirmed <= stated <= len(boats):
        warnings.append(
            f"You said {stated} boat(s), but {len(boats)} were found. Check your selection."
        )
    if boat.too_far:
        warnings.append("This boat is too far away to analyse reliably.")
    if surplus:
        warnings.append(
            f"More rowers were found than a {boat_seats}-seat boat holds, "
            "so two boats may have been grouped together."
        )
    return warnings


def analyse(
    read: FrameReader,
    frames: int,
    fps: float,
    request: Request,
    backend: PoseBackend,
    scouting: Scouting | None = None,
) -> Analysis:
    """Measure the requested rowers, or stop and ask if the athlete must choose a boat first."""
    found = scouting if scouting is not None else scout(read, frames, fps, backend)
    if needs_boat_choice(found, request):
        return Analysis(
            fps,
            frames,
            needs_boat_choice=True,
            boat_choices=found.choices(),
            preview=found.preview,
        )
    boat = _chosen_boat(found, request)
    if boat is None:
        return Analysis(
            fps, frames, warnings=["No rowers with a stroke rhythm were found in this video."]
        )

    coarse_fps = fps / COARSE_STEP
    assignment = assign_seats(
        fit_to_seats(boat.crew(), request.boat_seats), request.boat_seats, coarse_fps
    )
    rowers = list(assignment.seats.values())

    coarse_views = view_by_frame(rowers, coarse_fps)
    nearest = np.minimum(np.arange(frames) // COARSE_STEP, max(len(coarse_views) - 1, 0))
    views = coarse_views[nearest] if len(coarse_views) else np.full(frames, np.nan)
    shots = split_shots(views, fps)
    view = _usable_view(shots, views)

    warnings = _boat_warnings(
        boat, assignment.surplus, request.boat_seats, found.boats, request.boats_in_video
    )
    if rowers and not assignment.complete and request.tap is None:
        warnings.append(
            f"Only {len(rowers)} of {request.boat_seats} rowers were seen, "
            "so seat numbers are a best guess. Tap yourself on a frame to confirm."
        )
    if not np.isfinite(view) or view > UNCORRECTABLE_VIEW_DEG:
        warnings.append("No side-on footage found, so side-view angles cannot be measured.")
        view = 0.0 if not np.isfinite(view) else UNCORRECTABLE_VIEW_DEG

    targets: list[tuple[int | None, Track]] = []
    if request.scope is Scope.CREW:
        targets = list(assignment.seats.items())
    elif request.tap is not None:
        frame, x, y = request.tap
        chosen = track_at(boat.tracks, frame // COARSE_STEP, np.array([x, y]))
        if chosen is not None:
            seat = next((s for s, t in assignment.seats.items() if t is chosen), None)
            targets = [(seat, chosen)]
    elif request.seat in assignment.seats:
        targets = [(request.seat, assignment.seats[request.seat])]
    elif rowers:
        warnings.append(f"Seat {request.seat} was not visible. Tap yourself on a frame to choose.")

    others = [other for other in found.boats if other is not boat]
    coarse_frames = len(boat.seen())
    crossed = overlap_frames(boat, others, coarse_frames)
    dropped = crossed[np.minimum(np.arange(frames) // COARSE_STEP, coarse_frames - 1)]
    overlap_share = float(crossed.sum()) / max(int(boat.seen().sum()), 1)
    if overlap_share:
        warnings.append(
            f"Another boat crossed yours for {overlap_share:.0%} of the time it was in view. "
            "Those frames were left out."
        )

    results = []
    for seat, track in targets:
        points, scores = _fine_pass(read, frames, track, backend)
        points[dropped] = np.nan
        scores[dropped] = 0
        results.append(_measure(seat, points, scores, assignment.facing, view, fps))
    return Analysis(
        fps,
        frames,
        assignment.facing,
        assignment.complete,
        view,
        shots,
        results,
        warnings,
        overlap_share=overlap_share,
    )

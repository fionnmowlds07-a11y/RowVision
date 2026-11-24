"""Run the full analysis: find rowers and shots coarsely, then measure the chosen rowers finely."""

import logging
from collections.abc import Callable
from dataclasses import dataclass, field, replace
from enum import StrEnum
from itertools import pairwise
from typing import Any

import numpy as np
from numpy.typing import NDArray

from rowvision import skeleton as sk
from rowvision.boats import (
    Boat,
    boat_at,
    crew_agreement,
    fill_from_spare,
    find_boats,
    fit_to_seats,
    joined,
    overlap_frames,
    preview_frame,
)
from rowvision.cox import beyond_neighbour, facing_backwards, seat_spacing
from rowvision.identity import misplaced
from rowvision.metrics import (
    MEASURES,
    AngleSeries,
    StrokeMetrics,
    angle_series,
    fade,
    forward_lean_readable,
    per_stroke,
    rate_steadiness,
)
from rowvision.pose import PoseBackend
from rowvision.reference import Targets, load_targets
from rowvision.reliability import Calibration, Evidence, Rating, load_calibration, rate
from rowvision.scoring import MIN_STROKES, ScoreCard, score_stroke, without_scores
from rowvision.seats import SeatAssignment, assign_seats, seat_holding, track_at
from rowvision.shots import OBLIQUE_LIMIT_DEG, Shot, ShotKind, clear_frames, split_shots
from rowvision.sides import as_one_side, side_changes, split_at
from rowvision.skeleton import FloatArray
from rowvision.strokes import StrokeTimeline, crew_reach, detect_strokes, reach_signal
from rowvision.timing import FollowTiming, follow_timing, leader_seat, seat_side
from rowvision.tracking import Track, track_people
from rowvision.view import (
    TURN_WINDOW_FRAMES,
    camera_turn,
    estimate_view_deg,
    rigger_towards_camera,
)

COARSE_STEP = 5
BOX_MARGIN = 0.25
MAX_BOX_GAP_FRAMES = 30
MIN_CREW_FOR_TIMING = 3
MIN_KNOWN_SHARE = 0.5
"""A measure needs a believable reading on this share of strokes to be shown at all."""
MIN_CLEAR_STROKES = 3
"""The fewest strokes clear of end-on for a rower's figures to come from those strokes alone."""
VIEW_WINDOW_SECONDS = 3.0
MIN_VIEW_FRAMES = 4
UNCORRECTABLE_VIEW_DEG = 60.0
MAX_FRAME_CORRECTION_DEG = 45.0
"""Past this the stretch magnifies small errors, which made real clips less consistent."""
FILM_CLOSER = (
    "The rowers are too small in this video to measure accurately, so no scores were given. "
    "Film closer, so that the boat fills most of the frame width."
)

MIN_KNEE_TRUNK_PX = 34.0
"""Below this trunk length the knee is too few pixels across to place. Against 99 hand-labelled
frames, smaller rowers had a typical knee error of 15 to 25 degrees, and larger ones 9 (issue 249)."""
FILM_CLOSER_FOR_KNEES = "Film closer to see knee angles. The rower is too small to place the knee."
KNEE_MEASURES = frozenset({"catch_knee_deg", "finish_knee_deg"})

FILM_SIDE_ON = (
    "Too much of this video was filmed from in front of or behind the boat, so the results are "
    "unreliable and no scores were given. Film side-on, from directly alongside the boat."
)

BOTH_SIDES = (
    "The camera moved to the other side of the boat during this video. Every stroke was used for "
    "timing, and body angles were taken from one side only. Film from one side for the best results."
)
OFF_OAR_SIDE = (
    "Not scored, as most of this video was filmed from the side away from your oar, where your body "
    "is turned from the camera. Film from your oar side."
)
TOO_FEW_ON_ONE_SIDE = "Not scored, as too few strokes were filmed from one side of the boat."
TIMING_MEASURES = frozenset({"drive_share", "drive_s", "recovery_s", "ratio", "rate_steadiness"})
"""Measures read from when the catch and finish happen, which look the same from either side."""

OTHER_SIDE = (
    "The camera moved to the other side of the boat during this video, "
    "so only the part with the best view was measured."
)

FrameReader = Callable[[int], Any]
"""Return the frame at an index."""


log = logging.getLogger(__name__)


def _runs(seen: NDArray[np.bool_], step: int = 1) -> str:
    """Describe the stretches of frames where something was seen, for the log."""
    edges = np.flatnonzero(np.diff(np.concatenate([[0], seen.astype(int), [0]])))
    spans = [f"{start * step}-{end * step}" for start, end in zip(edges[::2], edges[1::2], strict=True)]
    return " ".join(spans[:12]) + (" ..." if len(spans) > 12 else "") if spans else "none"


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
    side: str = "scull"
    """Stroke, bow or scull, which decides who this rower follows."""
    rig: tuple[str, ...] | None = None
    """Each seat's side, bow seat first, for a sweep boat. None takes sides to alternate."""


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
    card: ScoreCard
    rating: Rating
    timing: FollowTiming | None = None
    """Catch and finish timing against the rower being followed."""
    evidence: Evidence | None = None
    """What the accuracy rating was worked out from, kept so the rower can be measured again."""
    fade: dict[str, float] = field(default_factory=dict)
    """How each measure changes from the first half of the strokes to the second."""
    angles: AngleSeries | None = None
    """The angle on every frame, kept so the report need not work them out again."""
    side: str | None = None
    """The side a sweep rower rows on, kept so the rower can be measured again."""
    no_scores: str | None = None
    """Why no scores were given, when the footage cannot support any."""
    left_out: list[int] = field(default_factory=list)
    """Catch frames of strokes filmed end-on, which are listed but do not count."""
    unseen: list[int] = field(default_factory=list)
    """Catch frames of strokes with no pose of this rower at the catch or finish, which do not count."""
    crew_timed: bool = False
    """The catches and finishes were found from the whole crew, so drive and recovery times are the
    crew's, the same for every seat."""


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
    side_changes: list[int] = field(default_factory=list)
    """Sampled frames where the camera crossed to the other side of the boat."""

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
    frame_views: FloatArray | None = None
    """The camera angle used to correct each frame."""
    frame_turns: FloatArray | None = None
    """Which way the camera is turned from side-on on each frame: +1 stern, -1 bow, 0 unclear."""
    own_seat: int | None = None
    """The athlete's own seat, when a whole crew was measured."""
    sweep: bool = False
    """True for a sweep crew, whose two sides look different to a camera off side-on."""
    flipped: NDArray[np.bool_] | None = None
    """Frames filmed from the other side of the boat, where the crew faces the other way."""


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
    # Across a long gap the camera moves, so an interpolated box could land on a neighbour.
    for before, after in pairwise(positions):
        if after - before > MAX_BOX_GAP_FRAMES:
            boxes[before + 1 : after] = np.nan
    return boxes


def _fine_pass(
    read: FrameReader, frames: int, tracks: list[Track], backend: PoseBackend
) -> list[tuple[FloatArray, FloatArray]]:
    """Find the joints of every given person on every frame, reading each frame once.

    Reading and decoding a frame costs about as much as finding one person's joints, so a rower and
    the rower they follow are found together.
    """
    boxes = [_boxes_for(track, frames) for track in tracks]
    points = [np.full((frames, sk.JOINT_COUNT, 2), np.nan) for _ in tracks]
    scores = [np.zeros((frames, sk.JOINT_COUNT)) for _ in tracks]
    for index in range(frames):
        wanted = [person for person, box in enumerate(boxes) if np.isfinite(box[index]).all()]
        if not wanted:
            continue
        found, confidence = backend.estimate(
            read(index), np.stack([boxes[person][index] for person in wanted])
        )
        for person, joints, score in zip(wanted, found, confidence, strict=False):
            points[person][index], scores[person][index] = joints, score
    return list(zip(points, scores, strict=True))


def correction_views(views: FloatArray, clip_view: float) -> FloatArray:
    """Return the camera angle to correct each frame by, as the camera can move during a clip.

    Frames with no estimate use the figure for the whole clip.
    """
    return np.minimum(np.where(np.isfinite(views), views, clip_view), MAX_FRAME_CORRECTION_DEG)


def _usable_view(shots: list[Shot], views: FloatArray) -> float:
    side = [shot for shot in shots if shot.kind in (ShotKind.SIDE_ON, ShotKind.OBLIQUE)]
    if not side:
        return float("nan")
    return float(np.nanmedian(np.concatenate([views[shot.start : shot.end] for shot in side])))


def crew_timeline(
    crew: list[Track],
    facing: int,
    frames: int,
    fps: float,
    clear: NDArray[np.bool_] | None = None,
) -> StrokeTimeline | None:
    """Time strokes from the whole crew, which is steadier than any one rower.

    Rowers in a boat share one rhythm, so combining them stops one rower's stroke shape from moving
    the catch. Needs at least MIN_CREW_FOR_TIMING rowers, and otherwise returns None. `clear` is
    False on end-on frames, which are timed apart from the rest.
    """
    if len(crew) < MIN_CREW_FOR_TIMING:
        return None
    coarse = crew_reach([reach_signal(track.points, facing) for track in crew])
    seen = np.isfinite(coarse)
    if seen.sum() < 2:
        return None
    every = np.arange(frames)
    positions = np.arange(len(coarse)) * COARSE_STEP
    signal = np.interp(every, positions[seen], coarse[seen])
    signal[~seen[np.minimum(every // COARSE_STEP, len(coarse) - 1)]] = np.nan
    timeline = detect_strokes(signal, fps, clear)
    return timeline if timeline.catches else None


def measure_rower(
    seat: int | None,
    points: FloatArray,
    scores: FloatArray,
    facing: int,
    view: float,
    frame_views: FloatArray,
    fps: float,
    shared: StrokeTimeline | None = None,
    *,
    trunk_px: float,
    coverage: float,
    agreement: float | None = None,
    targets: Targets | None = None,
    calibration: Calibration | None = None,
    side: str | None = None,
    turns: FloatArray | None = None,
    clear: NDArray[np.bool_] | None = None,
    angle_frames: NDArray[np.bool_] | None = None,
    angle_note: str | None = None,
    misplaced: float = 0.0,
) -> RowerResult:
    """Measure one rower's strokes from their joints, and score and rate the result.

    Targets and calibration are read from their files unless given, which saves reading them again
    for each rower of a crew.
    """
    timeline = (
        shared
        if shared is not None
        else detect_strokes(reach_signal(points, facing), fps, clear)
    )
    angles = angle_series(points, facing, frame_views, side, turns)
    readable = forward_lean_readable(points, facing, frame_views, side, turns)
    # Where enough of the clip is clear of end-on, the rower's figures come from those strokes
    # alone. On a real clip that panned round from astern, the end-on strokes read a catch angle
    # near 3 degrees for a rower who read 20 side-on, and nine of them pulled the figure down.
    # A clip with too few clear strokes is measured whole. When as many of its strokes are end-on
    # as not, the figures are shown without scores, as the owner chose on issue 213.
    clear_strokes = 0 if clear is None else int(clear[timeline.catches[:-1]].sum())
    end_on_strokes = max(len(timeline.catches) - 1, 0) - clear_strokes
    in_clear = clear is not None and clear_strokes >= MIN_CLEAR_STROKES and not bool(clear.all())
    too_end_on = clear is not None and not in_clear and end_on_strokes >= max(clear_strokes, 1)
    if clear is not None and in_clear:
        angles = _without_end_on(angles, clear)
    strokes = per_stroke(angles, timeline, fps, catch_lean_readable=readable)
    # A crew's timeline gives every seat every stroke, including ones where this seat has no pose of
    # its own. Those would add crew timing, and nothing of the rower, to the rower's results. On an
    # eight, 14 of the stroke seat's 38 strokes had no pose at all (issue 239).
    posed = np.isfinite(points[:, sk.LEFT_SHOULDER, 0]) | np.isfinite(points[:, sk.RIGHT_SHOULDER, 0])
    seen = [s for s in strokes if posed[s.catch_frame] and posed[s.finish_frame]]
    counted = [s for s in seen if clear is None or not in_clear or clear[s.catch_frame]] or seen
    # When the camera crossed the boat, body angles come only from strokes on one side, where the
    # body is seen the same way. Timing reads the same from either side, so it uses every stroke.
    angled = counted if angle_frames is None else [s for s in counted if angle_frames[s.catch_frame]]
    summary: dict[str, float] = {}
    spread: dict[str, float] = {}
    for name in MEASURES:
        source = counted if name in TIMING_MEASURES else angled
        if not source:
            continue
        values = np.array([getattr(stroke, name) for stroke in source], dtype=float)
        values = values[np.isfinite(values)]
        if len(values) and len(values) >= MIN_KNOWN_SHARE * len(source):
            summary[name] = float(np.median(values))
            spread[name] = float(np.subtract(*np.percentile(values, [75, 25])))
    small = trunk_px < MIN_KNEE_TRUNK_PX
    if small:
        # The knee still times legs before body, which needs only when the leg starts to open, but
        # its angle is not shown, on the card or on the video.
        for name in KNEE_MEASURES:
            summary.pop(name, None)
            spread.pop(name, None)
    steadiness = rate_steadiness(counted)
    if np.isfinite(steadiness):
        summary["rate_steadiness"] = steadiness
    card = score_stroke(
        summary, spread, len(counted), timeline.rate_spm, targets if targets is not None else load_targets()
    )
    if small:
        card = _knees_hidden(card)
        angles = replace(angles, knee=np.full_like(angles.knee, np.nan))
    if angle_frames is not None and (angle_note or len(angled) < MIN_STROKES):
        body = {metric.name for metric in card.metrics} - TIMING_MEASURES
        card = without_scores(card, body, angle_note or TOO_FEW_ON_ONE_SIDE)
    evidence = Evidence(
        trunk_px, view, spread.get("catch_lean_deg", 0.0), coverage, len(counted), agreement, misplaced
    )
    rating = _with_lean_warning(rate(evidence, calibration), readable)
    if too_end_on:
        card = _unscored(card)
        rating = replace(rating, warnings=[FILM_SIDE_ON, *rating.warnings])
    return RowerResult(
        seat,
        points,
        scores,
        timeline.rate_spm,
        timeline.regularity,
        strokes,
        summary,
        spread,
        card,
        rating,
        evidence=evidence,
        fade=fade(counted),
        angles=angles,
        side=side,
        no_scores=FILM_SIDE_ON if too_end_on else None,
        left_out=[s.catch_frame for s in seen if all(s is not kept for kept in counted)],
        unseen=[s.catch_frame for s in strokes if all(s is not kept for kept in seen)],
        crew_timed=shared is not None,
    )


def angle_side(
    flipped: NDArray[np.bool_] | None, measured: NDArray[np.bool_], side: str | None, facing: int
) -> tuple[NDArray[np.bool_] | None, str | None]:
    """Choose the frames a rower's body angles come from when the camera crossed the boat.

    Returns None when it did not. A sweep rower is measured from their oar side, where the body
    opens towards the camera, as long as most of their video is from that side. Otherwise their
    body angles are taken from the side filmed most and left unscored, as the owner chose. A
    sculler has an oar on each side, so the side filmed most is used.
    """
    if flipped is None or not flipped.any():
        return None, None
    turned = flipped[: len(measured)]
    near, far = measured & ~turned, measured & turned
    most = ~turned if near.sum() >= far.sum() else turned
    towards = rigger_towards_camera(side, facing)
    if towards == 0:
        return most, None
    oar = ~turned if towards > 0 else turned
    oar_seen = near if towards > 0 else far
    if oar_seen.sum() * 2 >= measured.sum():
        return oar, None
    return most, OFF_OAR_SIDE


END_ON_REASON = "Not scored, as too much of this video was filmed end-on."


def _unscored(card: ScoreCard) -> ScoreCard:
    """Return the card with its figures kept and every score taken off."""
    metrics = [
        metric if metric.score is None else replace(metric, score=None, reason=END_ON_REASON)
        for metric in card.metrics
    ]
    return ScoreCard(metrics, {}, None, card.extras)


def _knees_hidden(card: ScoreCard) -> ScoreCard:
    """Return the card with the knee measures saying to film closer, instead of a vague reason."""
    metrics = [
        replace(metric, reason=FILM_CLOSER_FOR_KNEES) if metric.name in KNEE_MEASURES else metric
        for metric in card.metrics
    ]
    return replace(card, metrics=metrics)


def _without_end_on(angles: AngleSeries, clear: NDArray[np.bool_]) -> AngleSeries:
    """Blank the angles on end-on frames, where the body is seen from in front or behind."""
    return AngleSeries(
        np.where(clear, angles.trunk_lean, np.nan),
        np.where(clear, angles.knee, np.nan),
        np.where(clear, angles.elbow, np.nan),
        None if angles.reach is None else np.where(clear, angles.reach, np.nan),
    )


LEAN_UNREADABLE = (
    "Your body angle at the catch can't be read from this camera angle on your side of the boat. "
    "Film closer to side-on."
)


def _with_lean_warning(rating: Rating, readable: bool) -> Rating:
    return rating if readable else replace(rating, warnings=[*rating.warnings, LEAN_UNREADABLE])


def _leave_out_cox(
    fine: dict[int | None, tuple[FloatArray, FloatArray]],
    seats: dict[int, Track],
    facing: int,
    nearest: NDArray[np.intp],
    flipped: NDArray[np.bool_],
) -> None:
    """Take out the frames where the bow or stroke seat's tracking slipped onto a cox beyond them.

    A stern cox faces the crew, the other way from every rower. A cox lying in the bow faces the
    same way, but sits further beyond the bow seat than any two rowers sit apart.
    """
    order = sorted(seats)
    if len(order) < 2 or not len(nearest):
        return
    centres = [seats[seat].centre()[nearest] for seat in order]
    spacing = seat_spacing(centres, float(np.median([seats[seat].trunk() for seat in order])))
    for end, beside in ((order[0], order[1]), (order[-1], order[-2])):
        if end not in fine:
            continue
        points, scores = fine[end]
        neighbour = seats[beside].centre()[nearest]
        wrong = facing_backwards(as_one_side(points, flipped), facing)
        wrong |= beyond_neighbour(points, neighbour, spacing)
        log.info("seat %d: %d frames taken as the cox and left out", end, int((wrong & np.isfinite(points[:, sk.LEFT_SHOULDER, 0])).sum()))
        points[wrong] = np.nan
        scores[wrong] = 0


def _leave_out_misplaced(
    fine: dict[int | None, tuple[FloatArray, FloatArray]],
    seats: dict[int, Track],
    nearest: NDArray[np.intp],
    clear: NDArray[np.bool_],
) -> dict[int | None, float]:
    """Take out the frames where a seat's tracking sat on someone else, and return their share.

    Checked on the sampled frames, for every seat of the boat even when only one is measured, as
    a seat can only be seen to be out of place against the rest of the crew. A full-rate frame is
    left out when the sample on either side of it was out of place. End-on frames are not checked:
    the crew overlaps in the picture there, so seat order cannot be read.
    """
    order = sorted(seats)
    if not order or not len(nearest):
        return {}
    wrong = misplaced([seats[seat].centre() for seat in order], [seats[seat].trunk() for seat in order], order)
    later = np.minimum(nearest + 1, wrong.shape[1] - 1)
    shares: dict[int | None, float] = {}
    for row, seat in enumerate(order):
        if seat not in fine:
            continue
        points, scores = fine[seat]
        posed = np.isfinite(points[:, sk.LEFT_SHOULDER, 0])
        out = (wrong[row][nearest] | wrong[row][later]) & posed & clear
        shares[seat] = float(out.sum()) / max(int(posed.sum()), 1)
        if out.any():
            log.info("seat %d: on someone else in frames %s, left out", seat, _runs(out))
        points[out] = np.nan
        scores[out] = 0
    return shares


def scout(read: FrameReader, frames: int, fps: float, backend: PoseBackend) -> Scouting:
    """Find every person and boat in the clip from sampled frames."""
    coarse_fps = fps / COARSE_STEP
    tracks = track_people(*coarse_pass(read, frames, backend), coarse_fps)
    # Seat order and every angle depend on which way the crew faces in the picture, so no track
    # may run from one side of the boat to the other.
    changes = side_changes(tracks, coarse_fps)
    tracks = split_at(tracks, changes)
    boats = find_boats(tracks, coarse_fps)
    return Scouting(tracks, boats, preview_frame(boats) * COARSE_STEP, changes)


def _seen_together(first: Track, second: Track) -> bool:
    return bool((np.isfinite(first.centre()[:, 0]) & np.isfinite(second.centre()[:, 0])).any())


def _seats_of(
    crew: list[Track], boat: Boat, seats: int, fps: float
) -> tuple[SeatAssignment, bool]:
    """Fit one shot's rowers to the boat's seats and number them.

    Also returns whether every seat went to someone with a clear rhythm of their own, with nobody
    brought in to make up the number.
    """
    spare = [
        person for person in boat.spare if any(_seen_together(person, rower) for rower in crew)
    ]
    fitted, added = fill_from_spare(fit_to_seats(crew, seats), spare, seats, fps)
    assignment = assign_seats(fitted, seats, fps, added)
    log.info(
        "seats: %d rowers in the shot, %d spare seen with them, %d brought in, %d seats filled of %d, "
        "%d over, complete %s",
        len(crew), len(spare), len(added), len(assignment.seats), seats, assignment.surplus, assignment.complete,
    )
    return assignment, assignment.complete and not added and not assignment.surplus


def _crew_to_measure(boat: Boat, seats: int, fps: float, tap_frame: int | None) -> list[Track]:
    """Choose which shot of the boat to take the crew from.

    The shot the athlete tapped in comes first. Then the one showing the most of the crew, then the
    one with the most footage clear of end-on. On a real clip that swung round astern, the end-on
    part showed as many rowers as the side-on part.
    """
    crews = boat.crews()
    if not crews:
        return []

    def tapped(crew: list[Track]) -> bool:
        return tap_frame is not None and any(
            np.isfinite(track.centre()[tap_frame, 0]) for track in crew
        )

    def clear(crew: list[Track]) -> int:
        views = view_by_frame(crew, fps)
        return int((views <= OBLIQUE_LIMIT_DEG).sum())

    most = max(min(len(crew), seats) for crew in crews)
    return max(
        crews, key=lambda crew: (tapped(crew), min(len(crew), seats) == most, clear(crew))
    )


def needs_boat_choice(scouting: Scouting, request: Request) -> bool:
    """Ask the athlete unless exactly one boat was stated and exactly one was confirmed.

    Distant unconfirmed boats do not trigger a question on their own, because they may be people
    on the bank. They are listed when the athlete is asked.
    """
    if request.boat_tap is not None or not scouting.boats:
        return False
    confirmed = sum(boat.confirmed for boat in scouting.boats)
    if confirmed == 0:
        return False
    return confirmed > 1 or request.boats_in_video != 1


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
    log.info(
        "scouting: %d people tracked, boats of %s people, camera crossed the boat at sampled frames %s",
        len(found.tracks), [len(b.rowers) for b in found.boats], found.side_changes,
    )
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
        message = FILM_CLOSER if found.boats else "No rowers were found in this video."
        return Analysis(fps, frames, warnings=[message])
    if boat.too_far:
        return Analysis(fps, frames, warnings=[FILM_CLOSER])

    coarse_fps = fps / COARSE_STEP
    tap_frame = None if request.tap is None else request.tap[0] // COARSE_STEP
    crew = _crew_to_measure(boat, request.boat_seats, coarse_fps, tap_frame)
    assignment, sure = _seats_of(crew, boat, request.boat_seats, coarse_fps)
    # Other shots of the same boat are joined on seat by seat, but only when every seat in both
    # is held by someone with a clear rhythm of their own. On a real four, a second shot that
    # reached four seats by bringing in an unclear track put people in the wrong seats, and joining
    # it left almost nothing measurable. A shot from the other side of the boat is mirrored for
    # measuring, so the crew faces one way throughout.
    coarse_flipped = np.zeros(len(boat.seen()), dtype=bool)
    for other in boat.crews():
        if other is crew or not sure:
            continue
        also, also_sure = _seats_of(other, boat, request.boat_seats, coarse_fps)
        if not also_sure:
            continue
        if also.facing != assignment.facing:
            coarse_flipped |= np.any([np.isfinite(t.centre()[:, 0]) for t in also.seats.values()], axis=0)
        assignment = replace(
            assignment,
            seats={seat: joined(track, also.seats[seat]) for seat, track in assignment.seats.items()},
        )
    rowers = list(assignment.seats.values())
    for number, held in sorted(assignment.seats.items()):
        seen = np.isfinite(held.centre()[:, 0])
        log.info(
            "seat %d: seen in %.0f%% of sampled frames, trunk %.0f px, frames %s",
            number, 100 * seen.mean() if len(seen) else 0, held.trunk(), _runs(seen, COARSE_STEP),
        )
    level = [Track(as_one_side(track.points, coarse_flipped), track.scores) for track in rowers]

    coarse_views = view_by_frame(rowers, coarse_fps)
    nearest = np.minimum(np.arange(frames) // COARSE_STEP, max(len(coarse_views) - 1, 0))
    views = coarse_views[nearest] if len(coarse_views) else np.full(frames, np.nan)
    shots = split_shots(views, fps)
    view = _usable_view(shots, views)
    clear = clear_frames(shots, frames)

    warnings = _boat_warnings(
        boat, assignment.surplus, request.boat_seats, found.boats, request.boats_in_video
    )
    changed_side = any(
        boat.seen()[:change].any() and boat.seen()[change:].any() for change in found.side_changes
    )
    if changed_side and not coarse_flipped.any():
        warnings.append(OTHER_SIDE)
    elif coarse_flipped.any():
        warnings.append(BOTH_SIDES)
    if rowers and not assignment.complete and request.tap is None:
        warnings.append(
            f"Only {len(rowers)} of {request.boat_seats} rowers were seen, "
            "so seat numbers are a best guess. Tap yourself on a frame to confirm."
        )
    if not np.isfinite(view) or view > UNCORRECTABLE_VIEW_DEG:
        warnings.append("No side-on footage found, so side-view angles cannot be measured.")
        view = 0.0 if not np.isfinite(view) else UNCORRECTABLE_VIEW_DEG
    frame_views = correction_views(views, view)
    coarse_turns = camera_turn(
        [track.points for track in level], assignment.facing, TURN_WINDOW_FRAMES // COARSE_STEP | 1
    )
    # A sweep rower in mirrored frames appears to row on the other side. The lean-out correction
    # is the turn times the side, so turning the sign here corrects them as the side they are on.
    coarse_turns = np.where(coarse_flipped[: len(coarse_turns)], -coarse_turns, coarse_turns)
    frame_turns = coarse_turns[nearest] if len(coarse_turns) else np.zeros(frames)
    flipped = coarse_flipped[nearest] if len(coarse_flipped) else np.zeros(frames, dtype=bool)

    targets: list[tuple[int | None, Track]] = []
    own_seat = request.seat
    tapped: Track | None = None
    if request.tap is not None:
        frame, x, y = request.tap
        tapped = track_at(boat.tracks, frame // COARSE_STEP, np.array([x, y]))
        if tapped is not None:
            own_seat = seat_holding(assignment.seats, tapped, frame // COARSE_STEP)
            if own_seat is not None:
                tapped = assignment.seats[own_seat]
        if own_seat is None and request.scope is Scope.CREW:
            # The tap landed on someone who holds no seat, such as the cox. The seat the athlete
            # gave still tells the two sides of a sweep crew apart.
            own_seat = request.seat
    if request.scope is Scope.CREW:
        targets = list(assignment.seats.items())
    elif request.tap is not None:
        targets = [] if tapped is None else [(own_seat, tapped)]
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

    shared = crew_timeline(level, assignment.facing, frames, fps, clear)
    agreements = dict(zip(map(id, rowers), crew_agreement(level), strict=True))
    in_view = boat.seen()[np.minimum(np.arange(frames) // COARSE_STEP, coarse_frames - 1)]

    leaders: dict[int | None, int] = {}
    stroke_side = seat_side(request.boat_seats, own_seat, request.side, request.rig)
    for seat, _ in targets:
        side = seat_side(seat, own_seat, request.side, request.rig)
        leader = (
            None
            if seat is None
            else leader_seat(seat, request.boat_seats, side, stroke_side, request.rig)
        )
        if leader is not None and leader in assignment.seats:
            leaders[seat] = leader
    wanted = dict(targets)
    for leader in leaders.values():
        wanted.setdefault(leader, assignment.seats[leader])
    fine: dict[int | None, tuple[FloatArray, FloatArray]] = {}
    for seat, (points, scores) in zip(
        wanted, _fine_pass(read, frames, list(wanted.values()), backend), strict=True
    ):
        points[dropped] = np.nan
        scores[dropped] = 0
        fine[seat] = points, scores
    _leave_out_cox(fine, assignment.seats, assignment.facing, nearest, flipped)
    wrong_person = _leave_out_misplaced(fine, assignment.seats, nearest, clear)
    one_side = {seat: as_one_side(points, flipped) for seat, (points, _) in fine.items()}

    targets_file, calibration = load_targets(), load_calibration()
    results = []
    for seat, track in targets:
        points, scores = fine[seat]
        measured = np.isfinite(points[:, sk.LEFT_SHOULDER, 0])
        agreement = agreements.get(id(track))
        own_side = seat_side(seat, own_seat, request.side, request.rig)
        angle_frames, angle_note = angle_side(flipped, measured, own_side, assignment.facing)
        rower = measure_rower(
            seat,
            one_side[seat],
            scores,
            assignment.facing,
            view,
            frame_views,
            fps,
            shared,
            trunk_px=track.trunk(),
            coverage=float(measured[in_view].mean()) if in_view.any() else 0.0,
            agreement=None if agreement is None or np.isnan(agreement) else agreement,
            targets=targets_file,
            calibration=calibration,
            side=own_side,
            turns=frame_turns,
            clear=clear,
            angle_frames=angle_frames,
            angle_note=angle_note,
            misplaced=wrong_person.get(seat, 0.0),
        )
        if seat in leaders:
            leader = leaders[seat]
            timing = follow_timing(
                one_side[seat], one_side[leader], leader, assignment.facing, fps, clear
            )
            rower = replace(rower, timing=timing)
        # The joints are kept as filmed, for drawing over the picture.
        results.append(replace(rower, points=points))

    if results and not any(rower.strokes for rower in results):
        warnings.append(
            "No full strokes could be measured. Try a clip that shows more of the rower side-on."
        )
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
        frame_views=frame_views,
        frame_turns=frame_turns,
        own_seat=own_seat if request.scope is Scope.CREW else None,
        sweep=request.side != "scull",
        flipped=flipped if flipped.any() else None,
    )

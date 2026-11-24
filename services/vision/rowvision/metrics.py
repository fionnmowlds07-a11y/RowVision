"""Turn keypoints and a stroke timeline into per-stroke biomechanical measurements."""

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from rowvision import skeleton as sk
from rowvision.geometry import joint_angle, lean_from_vertical, undo_foreshortening
from rowvision.skeleton import FloatArray
from rowvision.strokes import StrokeTimeline
from rowvision.view import camera_turn, rigger_towards_camera

ONSET_FRACTION = 0.2
MIN_ANKLE_DROP_TRUNKS = 0.02
"""Feet sit below the seat, so an ankle level with or above the hip has been misplaced."""
MIN_SHIN_TO_THIGH, MAX_SHIN_TO_THIGH = 0.5, 1.7
CATCH_KNEE_RANGE = (30.0, 115.0)
FINISH_KNEE_RANGE = (130.0, 185.0)
"""What a body can do at each moment. Values outside are misplaced joints, not poor technique."""
CATCH_SHIN_RANGE = (-40.0, 30.0)
"""Wider than any real catch, so this only drops a misplaced ankle. Where the knee on the same
stroke was not believed, the shin is not either, as it is read from the same joints."""
CATCH_ELBOW_RANGE = (130.0, 185.0)
FINISH_ELBOW_RANGE = (20.0, 110.0)
"""The hands are at the body at the finish, which no arm can do without bending well past a right
angle. On small rowers the pose model often leaves the arm straight, and that is not believed."""
MAX_STROKE_PERIODS = 1.6
CATCH_LEAN_FRAMES_BEFORE = 3
"""The marked catch sits up to a few frames after the blade goes in, and one frame's lean is noisy,
so catch lean is the median of the catch frame and the frames just before it."""
FINISH_FRAMES_EITHER_SIDE = 2
"""The arms are close to still around the finish, so the frames either side of it show the same
position. Their median was steadier than one frame for the elbow on real clips. It was not for the
body angle or the knee, which are still read on the finish frame alone."""


LEAN_OUT_SHARE = 0.25
"""How far a sweep rower's shoulders move out towards their rigger for each unit they move forward
of the hips. Found on an eight filmed by a drone that swung from astern round to side-on, on both
sides of the boat: about 300 catches, each rower compared with their own side-on reading. Shares
from 0.2 to 0.3 fitted equally well, and rower by rower the best share ran from 0 to 0.5, so this is
a typical figure and not a measurement. It was 0.65 at first, chosen so that the two rowers of a
pair read the same forward lean. On the eight that read the side with riggers towards the camera
about 10 degrees too far forward at 25 to 45 degrees off side-on."""
MIN_FORWARD_GAIN = 0.55
"""Below this, leaning forward moves the shoulders too little in the picture for the lean to be
read. It happens to the side whose riggers face a camera turned well towards the stern, from about
44 degrees off side-on. On the eight, that side read within about 7 degrees of its side-on figure
at 30 to 40 degrees off, and 10 or more out beyond that."""


MAX_LENGTH_VIEW_DEG = 45.0
"""Stroke length is a distance along the boat, which the camera angle shrinks. From here on the
correction is capped, so the length would read short."""
MIN_STROKES_FOR_FADE = 6
MIN_STROKES_PER_HALF = 3


@dataclass(frozen=True)
class AngleSeries:
    """Per-frame angles in degrees, corrected for camera view."""

    trunk_lean: FloatArray
    knee: FloatArray
    elbow: FloatArray
    reach: FloatArray | None = None
    """How far the hands are ahead of the knees along the boat, in trunk lengths."""
    shin: FloatArray | None = None
    """How far the shin leans from vertical. Negative is short of vertical, with the knee still
    towards the bow from the ankle. Positive is past it."""


@dataclass(frozen=True)
class StrokeMetrics:
    catch_frame: int
    finish_frame: int
    next_catch_frame: int
    catch_lean_deg: float
    finish_lean_deg: float
    catch_knee_deg: float
    finish_knee_deg: float
    finish_elbow_deg: float
    drive_share: float
    """Share of the stroke cycle spent on the drive."""
    legs_lead: float
    """How far the legs lead the trunk off the catch, as a share of the drive. Positive is legs first."""
    drive_s: float = float("nan")
    recovery_s: float = float("nan")
    ratio: float = float("nan")
    """Recovery time over drive time. 2 means the recovery takes twice as long as the drive."""
    body_swing_deg: float = float("nan")
    """How far the body swings, from its forward lean at the catch to its layback at the finish."""
    catch_elbow_deg: float = float("nan")
    arms_break: float = float("nan")
    """How far through the drive the arms start to bend, as a share of the drive."""
    stroke_length: float = float("nan")
    """How far the hands travel along the boat from catch to finish, in trunk lengths."""
    catch_shin_deg: float = float("nan")
    """How far the shin leans from vertical at the catch. Negative is short of vertical."""


MEASURES = tuple(
    name
    for name, kind in StrokeMetrics.__annotations__.items()
    if kind is float
)
"""Every per-stroke measure, in the order they are defined."""


def legs_believable(side_on: FloatArray, facing: int) -> NDArray[np.bool_]:
    """Return which frames have a lower leg a real body could make.

    The hull hides the feet, so the pose model often guesses, and can put an ankle up by the hands.
    Model confidence does not reliably show this, so the check uses anatomy instead. Only the leg
    nearest the camera is checked, as it is the only one the knee angle is read from.
    """
    hip, knee, ankle = sk.near_leg(side_on, facing)
    trunk = np.linalg.norm(sk.shoulders(side_on) - sk.hips(side_on), axis=-1)
    shin = np.linalg.norm(knee - ankle, axis=-1)
    thigh = np.linalg.norm(knee - hip, axis=-1)
    with np.errstate(divide="ignore", invalid="ignore"):
        drop = (ankle[..., 1] - hip[..., 1]) / trunk
        ratio = shin / thigh
    return (drop >= MIN_ANKLE_DROP_TRUNKS) & (ratio >= MIN_SHIN_TO_THIGH) & (ratio <= MAX_SHIN_TO_THIGH)


def _within(value: float, limits: tuple[float, float]) -> float:
    """Return the value if a body could reach it, or NaN if it could not."""
    return float(value) if limits[0] <= value <= limits[1] else float("nan")


def forward_gain(
    points: FloatArray,
    facing: int,
    view_deg: float | FloatArray,
    side: str | None,
    turn: FloatArray | None = None,
) -> FloatArray:
    """Return how much of a forward lean shows along the boat in the picture, on each frame.

    A camera off side-on sees less of any movement along the boat, by cos(view). A sweep rower also
    leans out towards their own rigger as they come forward. The same camera sees part of that
    sideways lean as movement along the boat, added for one side of the boat and taken away for
    the other, depending on which way the camera is turned. `turn` is that direction on each frame,
    worked out from this rower alone if not given.
    """
    views = np.radians(np.broadcast_to(np.asarray(view_deg, dtype=float), len(points)))
    towards = rigger_towards_camera(side, facing)
    if not towards:
        return np.cos(views)
    turned = camera_turn(points, facing) if turn is None else turn
    lean_out = towards * turned * LEAN_OUT_SHARE
    return np.cos(views) - lean_out * np.sin(views)


def _sweep_lean(
    points: FloatArray,
    facing: int,
    view_deg: float | FloatArray,
    side: str,
    turn: FloatArray | None,
) -> FloatArray:
    """Return a sweep rower's forward lean, allowing for their lean out towards the rigger.

    Behind the hips, at the finish, rowers on both sides sit square, so only the forward half of
    the stroke is corrected.
    """
    hip, shoulder = sk.hips(points), sk.shoulders(points)
    forward = (shoulder[:, 0] - hip[:, 0]) * facing
    up = hip[:, 1] - shoulder[:, 1]
    views = np.radians(np.broadcast_to(np.asarray(view_deg, dtype=float), len(points)))
    gain = np.where(forward > 0, forward_gain(points, facing, view_deg, side, turn), np.cos(views))
    with np.errstate(invalid="ignore", divide="ignore"):
        lean = np.degrees(np.arctan2(forward / gain, up))
    return np.where(gain >= MIN_FORWARD_GAIN, lean, np.nan)


def forward_lean_readable(
    points: FloatArray,
    facing: int,
    view_deg: float | FloatArray,
    side: str | None,
    turn: FloatArray | None = None,
) -> bool:
    """Return False if this rower's forward lean cannot be read from where the camera is."""
    gain = forward_gain(points, facing, view_deg, side, turn)
    seen = np.isfinite(points[:, sk.LEFT_SHOULDER, 0]) & np.isfinite(gain)
    return not seen.any() or float(np.median(gain[seen])) >= MIN_FORWARD_GAIN


def angle_series(
    points: FloatArray,
    facing: int,
    view_deg: float | FloatArray,
    side: str | None = None,
    turn: FloatArray | None = None,
) -> AngleSeries:
    """Return the angle on every frame.

    `side` is a sweep rower's side, "stroke" or "bow". `turn` is which way the camera is turned
    from side-on on each frame, as `camera_turn` gives it.
    """
    hip = sk.hips(points)
    side_on = undo_foreshortening(points, hip[:, None, :], view_deg)
    hip = sk.hips(side_on)
    shoulder = sk.shoulders(side_on)
    # The knee is read from the near leg alone. Averaging in the far leg, which the model often loses,
    # dragged the angle up or down by the same amount the far knee was misplaced.
    knee = joint_angle(*sk.near_leg(side_on, facing))
    believable = legs_believable(side_on, facing)
    _, knee_point, ankle_point = sk.near_leg(side_on, facing)
    sweep = side in ("stroke", "bow")
    return AngleSeries(
        trunk_lean=_sweep_lean(points, facing, view_deg, str(side), turn)
        if sweep
        else lean_from_vertical(hip, shoulder, facing),
        knee=np.where(believable, knee, np.nan),
        # The elbow is read from the near arm alone, for the same reason. The midpoint of two arms that
        # sit apart in the picture is a point on neither of them.
        elbow=joint_angle(*sk.near_arm(side_on, facing)),
        reach=_reach(side_on, facing, view_deg),
        # From the picture's vertical, as the body angle is. The line of the boat would not do as a
        # level: off side-on it slopes by perspective, up to 47 degrees on real clips (issue 253).
        shin=np.where(believable, lean_from_vertical(ankle_point, knee_point, facing), np.nan),
    )


def _reach(side_on: FloatArray, facing: int, view_deg: float | FloatArray) -> FloatArray:
    """Return the hands' distance ahead of the knees, which stay close to fixed in the boat.

    This is measured on the corrected, side-on points, unlike the signal strokes are timed from, so
    that a length means the same from one camera angle to the next.
    """
    trunk = np.linalg.norm(sk.shoulders(side_on) - sk.hips(side_on), axis=-1)
    scale = np.nanmedian(trunk) if np.isfinite(trunk).any() else np.nan
    with np.errstate(invalid="ignore"):
        reach = (sk.wrists(side_on)[:, 0] - sk.knees(side_on)[:, 0]) * facing / scale
    return np.where(np.abs(np.asarray(view_deg, dtype=float)) < MAX_LENGTH_VIEW_DEG, reach, np.nan)


def _onset(values: FloatArray) -> int | None:
    """Return the first index where `values` has covered ONSET_FRACTION of its overall change."""
    start, end = values[0], values[-1]
    if not np.isfinite([start, end]).all() or start == end:
        return None
    progress = (values - start) / (end - start)
    moved = np.where(progress >= ONSET_FRACTION)[0]
    return int(moved[0]) if len(moved) else None


def _legs_lead(angles: AngleSeries, catch: int, finish: int) -> float:
    legs = _onset(angles.knee[catch : finish + 1])
    trunk = _onset(angles.trunk_lean[catch : finish + 1])
    if legs is None or trunk is None:
        return float("nan")
    return (trunk - legs) / (finish - catch)


def _catch_lean(trunk_lean: FloatArray, catch: int) -> float:
    window = trunk_lean[max(catch - CATCH_LEAN_FRAMES_BEFORE, 0) : catch + 1]
    if not np.isfinite(window).any():
        return float("nan")
    return float(np.nanmedian(window))


def _catch_shin(angles: AngleSeries, catch: int) -> float:
    """Return the shin's lean at the catch, or NaN where the leg was not one a body could make."""
    if angles.shin is None or not np.isfinite(_catch_knee(angles.knee, catch)):
        return float("nan")
    return _within(_catch_lean(angles.shin, catch), CATCH_SHIN_RANGE)


def _catch_knee(knee: FloatArray, catch: int) -> float:
    """Return the knee at its most bent as the rower arrives at the catch.

    The marked catch is a frame or two after the legs reach the front, by which time they have
    started to open. The smallest angle a body could make in the run-up is the one coaches mean.
    """
    window = knee[max(catch - CATCH_LEAN_FRAMES_BEFORE, 0) : catch + 1]
    possible = window[(window >= CATCH_KNEE_RANGE[0]) & (window <= CATCH_KNEE_RANGE[1])]
    return float(possible.min()) if len(possible) else float("nan")


def _finish_elbow(values: FloatArray, finish: int) -> float:
    window = values[max(finish - FINISH_FRAMES_EITHER_SIDE, 0) : finish + FINISH_FRAMES_EITHER_SIDE + 1]
    if not np.isfinite(window).any():
        return float("nan")
    return float(np.nanmedian(window))


def _arms_break(elbow: FloatArray, catch: int, finish: int) -> float:
    bend = _onset(elbow[catch : finish + 1])
    return float("nan") if bend is None else bend / (finish - catch)


def _stroke_length(reach: FloatArray | None, catch: int, finish: int) -> float:
    if reach is None:
        return float("nan")
    return _catch_lean(reach, catch) - _finish_elbow(reach, finish)


def per_stroke(
    angles: AngleSeries,
    timeline: StrokeTimeline,
    fps: float = float("nan"),
    *,
    catch_lean_readable: bool = True,
) -> list[StrokeMetrics]:
    """Measure each complete stroke: a catch, the finish after it, and the next catch.

    Without a frame rate the times in seconds are left out. When the forward lean cannot be read
    from where the camera is, the body angle at the catch is left out, and so is the body swing.
    """
    results = []
    for catch, next_catch in zip(timeline.catches, timeline.catches[1:]):
        finishes = [frame for frame in timeline.finishes if catch < frame < next_catch]
        too_long = timeline.period_frames and next_catch - catch > MAX_STROKE_PERIODS * timeline.period_frames
        if not finishes or too_long:
            continue
        finish = finishes[0]
        catch_lean = _catch_lean(angles.trunk_lean, catch) if catch_lean_readable else float("nan")
        finish_lean = float(angles.trunk_lean[finish])
        catch_elbow = _within(_catch_lean(angles.elbow, catch), CATCH_ELBOW_RANGE)
        finish_elbow = _within(_finish_elbow(angles.elbow, finish), FINISH_ELBOW_RANGE)
        arms_seen = np.isfinite(catch_elbow) and np.isfinite(finish_elbow)
        results.append(
            StrokeMetrics(
                catch_frame=catch,
                finish_frame=finish,
                next_catch_frame=next_catch,
                catch_lean_deg=catch_lean,
                finish_lean_deg=finish_lean,
                catch_knee_deg=_catch_knee(angles.knee, catch),
                finish_knee_deg=_within(float(angles.knee[finish]), FINISH_KNEE_RANGE),
                finish_elbow_deg=finish_elbow,
                drive_share=(finish - catch) / (next_catch - catch),
                legs_lead=_legs_lead(angles, catch, finish),
                drive_s=(finish - catch) / fps,
                recovery_s=(next_catch - finish) / fps,
                ratio=(next_catch - finish) / (finish - catch),
                body_swing_deg=catch_lean - finish_lean,
                catch_elbow_deg=catch_elbow,
                arms_break=_arms_break(angles.elbow, catch, finish) if arms_seen else float("nan"),
                stroke_length=_stroke_length(angles.reach, catch, finish),
                catch_shin_deg=_catch_shin(angles, catch),
            )
        )
    return results


def rate_steadiness(strokes: list[StrokeMetrics]) -> float:
    """Return how much the time for one stroke varies, as a percentage of the usual time.

    Needs three strokes, as two cannot show a spread.
    """
    lengths = np.array([stroke.next_catch_frame - stroke.catch_frame for stroke in strokes], dtype=float)
    if len(lengths) < MIN_STROKES_PER_HALF:
        return float("nan")
    return float(100 * np.std(lengths, ddof=1) / np.mean(lengths))


def fade(strokes: list[StrokeMetrics]) -> dict[str, float]:
    """Return how each measure changes from the first half of the clip to the second.

    Each figure is the second half's median minus the first half's. A short clip gives none, as a
    half needs enough strokes for its median to mean something.
    """
    if len(strokes) < MIN_STROKES_FOR_FADE:
        return {}
    middle = len(strokes) // 2
    changes: dict[str, float] = {}
    for name in MEASURES:
        early = np.array([getattr(stroke, name) for stroke in strokes[:middle]], dtype=float)
        late = np.array([getattr(stroke, name) for stroke in strokes[middle:]], dtype=float)
        early, late = early[np.isfinite(early)], late[np.isfinite(late)]
        if min(len(early), len(late)) >= MIN_STROKES_PER_HALF:
            changes[name] = float(np.median(late) - np.median(early))
    return changes

"""Generate a rower with exactly known joint angles, for testing without real footage.

The rower moves in the boat's vertical plane, with the boat axis as X, across-boat as Y and up
as Z. Feet are fixed and the rower faces -X, towards the stern. An orthographic camera at a
chosen yaw projects this to image pixels, so every measurement has a true answer to check.
"""

from dataclasses import dataclass

import numpy as np

from rowvision import skeleton as sk
from rowvision.skeleton import FloatArray

THIGH = SHIN = 0.45
TRUNK = 0.55
UPPER_ARM = FOREARM = 0.3
SHOULDER_WIDTH = 0.40
HIP_WIDTH = 0.30
HIP_HEIGHT = 0.25
HAND_HEIGHT = 0.45
HEAD = 0.22
DRIVE_FRACTION = 0.4


@dataclass(frozen=True)
class SyntheticClip:
    """Projected keypoints alongside the true values used to generate them."""

    points: FloatArray
    scores: FloatArray
    trunk_lean_deg: FloatArray
    knee_angle_deg: FloatArray
    elbow_angle_deg: FloatArray
    catch_frames: list[int]
    finish_frames: list[int]
    fps: float
    rate_spm: float
    view_deg: float
    facing: int


def _ease(value: FloatArray) -> FloatArray:
    clipped = np.clip(value, 0, 1)
    return 0.5 - 0.5 * np.cos(np.pi * clipped)


def _progress(phase: FloatArray) -> tuple[FloatArray, FloatArray, FloatArray]:
    """Return leg, trunk and arm progress from catch (0) to finish (1) for each stroke phase."""
    drive = phase < DRIVE_FRACTION
    through_drive = phase / DRIVE_FRACTION
    through_recovery = (phase - DRIVE_FRACTION) / (1 - DRIVE_FRACTION)
    legs = np.where(drive, _ease(through_drive / 0.75), 1 - _ease((through_recovery - 0.3) / 0.7))
    trunk = np.where(
        drive, _ease((through_drive - 0.1) / 0.8), 1 - _ease((through_recovery - 0.15) / 0.6)
    )
    arms = np.where(drive, _ease((through_drive - 0.55) / 0.45), 1 - _ease(through_recovery / 0.3))
    return legs, trunk, arms


def bend(start: FloatArray, end: FloatArray, first: float, second: float, sign: float) -> FloatArray:
    """Place the middle joint of a two-segment limb between `start` and `end` (X, Z arrays)."""
    offset = end - start
    distance = np.linalg.norm(offset, axis=-1, keepdims=True)
    along = (distance**2 + first**2 - second**2) / (2 * distance)
    height = np.sqrt(np.maximum(first**2 - along**2, 0))
    unit = offset / distance
    normal = np.stack([-unit[..., 1], unit[..., 0]], axis=-1)
    return start + along * unit + sign * height * normal


def _inner_angle(first: FloatArray, centre: FloatArray, last: FloatArray) -> FloatArray:
    a, b = first - centre, last - centre
    cosine = np.sum(a * b, axis=-1) / (np.linalg.norm(a, axis=-1) * np.linalg.norm(b, axis=-1))
    return np.degrees(np.arccos(np.clip(cosine, -1, 1)))


def generate(
    *,
    strokes: int = 6,
    rate_spm: float = 24.0,
    fps: float = 30.0,
    view_deg: float = 0.0,
    facing: int = -1,
    catch_lean_deg: float = 25.0,
    finish_lean_deg: float = -20.0,
    pixels_per_metre: float = 300.0,
    pixel_noise: float = 0.0,
    camera_drift_px: float = 0.0,
    seed: int = 0,
) -> SyntheticClip:
    """Generate `strokes` full strokes. Each one starts at the catch."""
    period = 60 / rate_spm
    frames = round(strokes * period * fps)
    time = np.arange(frames) / fps
    phase = (time / period) % 1
    legs, trunk_progress, arms = _progress(phase)

    lean = catch_lean_deg + (finish_lean_deg - catch_lean_deg) * trunk_progress
    hip = np.stack([0.30 + 0.55 * legs, np.full(frames, HIP_HEIGHT)], axis=-1)
    ankle = np.zeros((frames, 2))
    knee = bend(ankle, hip, SHIN, THIGH, 1.0)

    radians = np.radians(lean)
    shoulder = hip + TRUNK * np.stack([-np.sin(radians), np.cos(radians)], axis=-1)
    reach = 0.58 + (0.33 - 0.58) * arms
    drop = shoulder[:, 1] - HAND_HEIGHT
    hand = np.stack(
        [shoulder[:, 0] - np.sqrt(np.maximum(reach**2 - drop**2, 1e-6)), np.full(frames, HAND_HEIGHT)],
        axis=-1,
    )
    elbow = bend(shoulder, hand, UPPER_ARM, FOREARM, 1.0)

    head_centre = shoulder + HEAD * np.stack([-np.sin(radians), np.cos(radians)], axis=-1)
    nose = head_centre + np.array([-0.09, 0.0])

    world = np.zeros((frames, sk.JOINT_COUNT, 3))

    def place(left: int, right: int, position: FloatArray, half_width: float) -> None:
        for joint, side in ((left, 1), (right, -1)):
            world[:, joint, 0] = position[:, 0]
            world[:, joint, 1] = side * half_width
            world[:, joint, 2] = position[:, 1]

    place(sk.LEFT_SHOULDER, sk.RIGHT_SHOULDER, shoulder, SHOULDER_WIDTH / 2)
    place(sk.LEFT_ELBOW, sk.RIGHT_ELBOW, elbow, SHOULDER_WIDTH / 2)
    place(sk.LEFT_WRIST, sk.RIGHT_WRIST, hand, SHOULDER_WIDTH / 2)
    place(sk.LEFT_HIP, sk.RIGHT_HIP, hip, HIP_WIDTH / 2)
    place(sk.LEFT_KNEE, sk.RIGHT_KNEE, knee, HIP_WIDTH / 2)
    place(sk.LEFT_ANKLE, sk.RIGHT_ANKLE, ankle, HIP_WIDTH / 2)
    place(sk.LEFT_EAR, sk.RIGHT_EAR, head_centre, 0.07)
    world[:, sk.NOSE, 0], world[:, sk.NOSE, 2] = nose[:, 0], nose[:, 1]

    yaw = np.radians(view_deg)
    image_x = world[..., 0] * np.cos(yaw) + world[..., 1] * np.sin(yaw)
    points = np.stack([-facing * image_x, -world[..., 2]], axis=-1) * pixels_per_metre
    points[..., 0] += 400 + (camera_drift_px * np.arange(frames))[:, None]
    points[..., 1] += 400

    if pixel_noise:
        points = points + np.random.default_rng(seed).normal(0, pixel_noise, points.shape)

    frames_per_stroke = period * fps
    return SyntheticClip(
        points=points,
        scores=np.full((frames, sk.JOINT_COUNT), 0.9),
        trunk_lean_deg=lean,
        knee_angle_deg=_inner_angle(hip, knee, ankle),
        elbow_angle_deg=_inner_angle(shoulder, elbow, hand),
        catch_frames=[round(i * frames_per_stroke) for i in range(strokes)],
        finish_frames=[round((i + DRIVE_FRACTION) * frames_per_stroke) for i in range(strokes)],
        fps=fps,
        rate_spm=rate_spm,
        view_deg=view_deg,
        facing=facing,
    )

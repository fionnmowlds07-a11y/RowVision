"""Pose a rower at chosen angles, for showing what a target looks like.

This uses the same body model as the synthetic rower, so a reference pose measures back to the
angles that were asked for. X runs along the boat, Y is positive to the rower's right, Z is up,
and the rower faces -X, towards the stern.

Stroke side is port, so the oar sits on the rower's right. Bow side is starboard, so it sits on
their left. Rigging and torso twist are typical illustrative values, and are not scored.
"""

import math
from enum import StrEnum

import numpy as np
from numpy.typing import NDArray

from rowvision.synthetic import (
    FOREARM,
    HAND_HEIGHT,
    HEAD,
    HIP_HEIGHT,
    HIP_WIDTH,
    SHIN,
    SHOULDER_WIDTH,
    THIGH,
    TRUNK,
    UPPER_ARM,
    bend,
)

Vector = NDArray[np.floating]

CATCH_REACH = 0.58
FINISH_REACH = 0.33
MIN_KNEE_DEG, MAX_KNEE_DEG = 40.0, 180.0
MAX_LEAN_DEG = 60.0

PIN_HEIGHT = 0.30
HAND_GAP = 0.25
"""Distance between the hands on a sweep oar."""
MAX_TWIST_DEG = 14.0
"""Torso turn towards the rigger at full reach. Sweep only."""
TWIST_LEAN_RANGE_DEG = (-20.0, 25.0)


class Style(StrEnum):
    STROKE_SIDE = "stroke"
    BOW_SIDE = "bow"
    SCULL = "scull"


RIGGING = {
    # Pin position along the boat, pin distance from the centreline, inboard, outboard.
    Style.SCULL: (0.35, 0.80, 0.88, 1.97),
    Style.STROKE_SIDE: (0.45, 0.85, 1.15, 2.55),
    Style.BOW_SIDE: (0.45, 0.85, 1.15, 2.55),
}


def _rounded(point: Vector) -> list[float]:
    return [round(float(value), 4) for value in point]


def _place(sagittal: Vector, y: float = 0.0) -> Vector:
    return np.array([sagittal[0], y, sagittal[1]])


def _oar(style: Style, side: int, hand_x: float, hand_z: float) -> tuple[Vector, Vector, Vector]:
    """Return the pin, a unit vector from pin to handle, and the blade end, for one oar."""
    pin_x, pin_y, inboard, outboard = RIGGING[style]
    along = float(np.clip(hand_x - pin_x, -0.95 * inboard, 0.95 * inboard))
    across = math.sqrt(inboard**2 - along**2 - (hand_z - PIN_HEIGHT) ** 2)
    pin = np.array([pin_x, side * pin_y, PIN_HEIGHT])
    towards_handle = np.array([along, -side * across, hand_z - PIN_HEIGHT]) / inboard
    return pin, towards_handle, pin - outboard * towards_handle


def _elbow(shoulder: Vector, hand: Vector, side: int) -> Vector:
    """Place an elbow between shoulder and hand, bending outwards and down."""
    span = hand - shoulder
    distance = float(np.linalg.norm(span))
    along = (distance**2 + UPPER_ARM**2 - FOREARM**2) / (2 * distance)
    rise = math.sqrt(max(UPPER_ARM**2 - along**2, 0.0))
    unit = span / distance
    outward = np.array([0.0, float(side), -1.0])
    outward = outward - np.dot(outward, unit) * unit
    return shoulder + min(along, UPPER_ARM) * unit + rise * outward / np.linalg.norm(outward)


def _twist(style: Style, lean_deg: float) -> float:
    """Return the torso turn in radians. Positive turns the left shoulder towards the stern."""
    if style is Style.SCULL:
        return 0.0
    low, high = TWIST_LEAN_RANGE_DEG
    share = float(np.clip((lean_deg - low) / (high - low), 0, 1))
    direction = 1.0 if style is Style.STROKE_SIDE else -1.0
    return direction * math.radians(MAX_TWIST_DEG) * share


def pose_at(
    lean_deg: float, knee_deg: float, reach: float, style: Style = Style.SCULL
) -> dict[str, object]:
    """Return joints and oars in metres for a rower at the given angles.

    `lean_deg` is positive towards the stern, `knee_deg` is the inner knee angle, and `reach` is
    the distance from shoulder to hand. Raises ValueError for a pose a body cannot make.
    """
    if not MIN_KNEE_DEG <= knee_deg <= MAX_KNEE_DEG or abs(lean_deg) > MAX_LEAN_DEG:
        raise ValueError("angle out of range")
    if not 0.05 < reach <= UPPER_ARM + FOREARM:
        raise ValueError("reach out of range")

    leg = math.sqrt(THIGH**2 + SHIN**2 - 2 * THIGH * SHIN * math.cos(math.radians(knee_deg)))
    ankle = np.zeros(2)
    hip = np.array([math.sqrt(max(leg**2 - HIP_HEIGHT**2, 0.0)), HIP_HEIGHT])
    knee = bend(ankle, hip, SHIN, THIGH, -1.0)

    radians = math.radians(lean_deg)
    along_trunk = np.array([-math.sin(radians), math.cos(radians)])
    shoulder = hip + TRUNK * along_trunk
    head = shoulder + HEAD * along_trunk
    drop = min(shoulder[1] - HAND_HEIGHT, reach)
    hand_x = shoulder[0] - math.sqrt(reach**2 - drop**2)
    hand_z = shoulder[1] - drop

    turn = _twist(style, lean_deg)
    half = SHOULDER_WIDTH / 2
    shoulders = {
        -1: _place(shoulder) + half * np.array([-math.sin(turn), -math.cos(turn), 0.0]),
        1: _place(shoulder) + half * np.array([math.sin(turn), math.cos(turn), 0.0]),
    }

    oars = []
    hands: dict[int, Vector] = {}
    oar_sides = {Style.SCULL: (1, -1), Style.STROKE_SIDE: (1,), Style.BOW_SIDE: (-1,)}[style]
    for side in oar_sides:
        pin, towards_handle, blade = _oar(style, side, hand_x, hand_z)
        inboard = RIGGING[style][2]
        handle = pin + inboard * towards_handle
        if style is Style.SCULL:
            hands[side] = handle
        else:
            hands[-side] = handle
            hands[side] = handle - HAND_GAP * towards_handle
        angle = math.degrees(math.atan2(abs(towards_handle[0]), abs(towards_handle[1])))
        oars.append(
            {
                "side": "port" if side > 0 else "starboard",
                "handle": _rounded(handle),
                "pin": _rounded(pin),
                "blade": _rounded(blade),
                "angle_deg": round(angle, 1),
            }
        )

    def body_side(side: int) -> dict[str, list[float]]:
        width = side * HIP_WIDTH / 2
        return {
            "ankle": _rounded(_place(ankle, width)),
            "knee": _rounded(_place(knee, width)),
            "hip": _rounded(_place(hip, width)),
            "shoulder": _rounded(shoulders[side]),
            "elbow": _rounded(_elbow(shoulders[side], hands[side], side)),
            "hand": _rounded(hands[side]),
        }

    return {
        "style": style.value,
        "left": body_side(-1),
        "right": body_side(1),
        "head": _rounded(_place(head)),
        "oars": oars,
        "twist_deg": round(math.degrees(abs(turn)), 1),
    }

"""Pose a rower at chosen angles, for showing what a target looks like.

This uses the same body model as the synthetic rower, so a reference pose measures back to the
angles that were asked for.
"""

import math

import numpy as np

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

CATCH_REACH = 0.58
FINISH_REACH = 0.33
MIN_KNEE_DEG, MAX_KNEE_DEG = 40.0, 180.0
MAX_LEAN_DEG = 60.0


def pose_at(lean_deg: float, knee_deg: float, reach: float) -> dict[str, object]:
    """Return joints in metres, with X along the boat, Z up, and the rower facing -X.

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
    drop = min(shoulder[1] - HAND_HEIGHT, reach)
    hand = np.array([shoulder[0] - math.sqrt(reach**2 - drop**2), shoulder[1] - drop])
    elbow = bend(shoulder, hand, UPPER_ARM, FOREARM, -1.0)
    head = shoulder + HEAD * along_trunk

    joints = {
        "ankle": ankle,
        "knee": knee,
        "hip": hip,
        "shoulder": shoulder,
        "elbow": elbow,
        "hand": hand,
        "head": head,
    }
    return {
        "joints": {name: [round(float(v), 4) for v in point] for name, point in joints.items()},
        "shoulder_width": SHOULDER_WIDTH,
        "hip_width": HIP_WIDTH,
    }

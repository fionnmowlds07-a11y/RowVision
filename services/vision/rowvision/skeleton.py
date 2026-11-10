"""COCO-17 joint layout and helpers for reading body landmarks from keypoint arrays.

Keypoint arrays have shape (..., 17, 2) in image pixels, with y increasing downwards.
"""

import numpy as np
from numpy.typing import NDArray

FloatArray = NDArray[np.floating]

NOSE = 0
LEFT_EAR, RIGHT_EAR = 3, 4
LEFT_SHOULDER, RIGHT_SHOULDER = 5, 6
LEFT_ELBOW, RIGHT_ELBOW = 7, 8
LEFT_WRIST, RIGHT_WRIST = 9, 10
LEFT_HIP, RIGHT_HIP = 11, 12
LEFT_KNEE, RIGHT_KNEE = 13, 14
LEFT_ANKLE, RIGHT_ANKLE = 15, 16
JOINT_COUNT = 17


def midpoint(points: FloatArray, left: int, right: int) -> FloatArray:
    """Return the centre of a left/right joint pair, which cancels out body width."""
    return (points[..., left, :] + points[..., right, :]) / 2


def shoulders(points: FloatArray) -> FloatArray:
    return midpoint(points, LEFT_SHOULDER, RIGHT_SHOULDER)


def elbows(points: FloatArray) -> FloatArray:
    return midpoint(points, LEFT_ELBOW, RIGHT_ELBOW)


def wrists(points: FloatArray) -> FloatArray:
    return midpoint(points, LEFT_WRIST, RIGHT_WRIST)


def hips(points: FloatArray) -> FloatArray:
    return midpoint(points, LEFT_HIP, RIGHT_HIP)


def knees(points: FloatArray) -> FloatArray:
    return midpoint(points, LEFT_KNEE, RIGHT_KNEE)


def ankles(points: FloatArray) -> FloatArray:
    return midpoint(points, LEFT_ANKLE, RIGHT_ANKLE)


def near_leg(points: FloatArray, facing: int) -> tuple[FloatArray, FloatArray, FloatArray]:
    """Return the hip, knee and ankle of the leg nearest the camera.

    The camera sees the side of the rower that faces it, and which side that is follows from the
    direction they face in the picture: facing right shows their right side, facing left their left.
    The far leg is mostly hidden behind the body and the boat, so the pose model often loses it.
    """
    left = facing < 0
    hip, knee, ankle = (LEFT_HIP, LEFT_KNEE, LEFT_ANKLE) if left else (RIGHT_HIP, RIGHT_KNEE, RIGHT_ANKLE)
    return points[..., hip, :], points[..., knee, :], points[..., ankle, :]

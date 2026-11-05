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

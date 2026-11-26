"""Person detection and pose estimation, behind an interface tests can replace."""

from collections.abc import Callable
from typing import Any, Protocol

import numpy as np

from rowvision.skeleton import FloatArray


class JointFinder(Protocol):
    def estimate(self, frame: Any, boxes: FloatArray) -> tuple[FloatArray, FloatArray]:
        """Return keypoints (n, 17, 2) and scores (n, 17) for the given boxes."""
        ...


class PoseBackend(JointFinder, Protocol):
    def detect(self, frame: Any) -> FloatArray:
        """Return person boxes as (n, 4) rows of x1, y1, x2, y2."""
        ...


ACCURATE_POSE = (
    "https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/"
    "rtmpose-x_simcc-body7_pt-body7_700e-384x288-71d7b7e9_20230629.zip"
)
ACCURATE_INPUT = (288, 384)


def _capped(make: Callable[[], Any], threads: int | None) -> Any:
    """Load a model that uses at most this many processor cores. None lets it use them all."""
    if threads is None:
        return make()
    import cv2
    import onnxruntime as ort  # type: ignore[import-untyped]

    cv2.setNumThreads(threads)
    options = ort.SessionOptions()
    options.intra_op_num_threads = threads
    options.inter_op_num_threads = 1
    # rtmlib makes its sessions with no options, so the thread cap is handed in as they are made.
    made = ort.InferenceSession

    def capped(*args: Any, **kwargs: Any) -> Any:
        return made(*args, sess_options=options, **kwargs)

    ort.InferenceSession = capped
    try:
        return make()
    finally:
        ort.InferenceSession = made


class AccurateJoints:
    """RTMPose-x, which sees each rower in about twice the detail.

    On 47 close frames labelled by hand it placed legs better than the standard model (typical error
    at the catch: knee 5.6 against 9.8 degrees, shin 2.9 against 6.7), with body angle about the same.
    It only finds the joints that are measured. Finding the boats is tuned to the standard model.
    """

    def __init__(self, device: str = "cpu", threads: int | None = None) -> None:
        from rtmlib import RTMPose  # type: ignore[import-untyped]

        self._model = _capped(
            lambda: RTMPose(
                ACCURATE_POSE, model_input_size=ACCURATE_INPUT, backend="onnxruntime", device=device
            ),
            threads,
        )

    def estimate(self, frame: Any, boxes: FloatArray) -> tuple[FloatArray, FloatArray]:
        return _estimate(self._model, frame, boxes)


def _estimate(model: Any, frame: Any, boxes: FloatArray) -> tuple[FloatArray, FloatArray]:
    if len(boxes) == 0:
        return np.zeros((0, 17, 2)), np.zeros((0, 17))
    points, scores = model(frame, bboxes=boxes.tolist())
    return np.asarray(points, dtype=float), np.asarray(scores, dtype=float)


class RtmBackend:
    """YOLOX detection and RTMPose estimation through ONNX Runtime."""

    def __init__(
        self, mode: str = "balanced", device: str = "cpu", threads: int | None = None
    ) -> None:
        """`threads` caps how many processor cores the models use. None lets them use them all."""
        from rtmlib import Body

        self._model = _capped(
            lambda: Body(mode=mode, backend="onnxruntime", device=device), threads
        )

    def detect(self, frame: Any) -> FloatArray:
        return np.asarray(self._model.det_model(frame), dtype=float).reshape(-1, 4)

    def estimate(self, frame: Any, boxes: FloatArray) -> tuple[FloatArray, FloatArray]:
        return _estimate(self._model.pose_model, frame, boxes)

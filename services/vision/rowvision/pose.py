"""Person detection and pose estimation, behind an interface tests can replace."""

from typing import Any, Protocol

import numpy as np

from rowvision.skeleton import FloatArray


class PoseBackend(Protocol):
    def detect(self, frame: Any) -> FloatArray:
        """Return person boxes as (n, 4) rows of x1, y1, x2, y2."""
        ...

    def estimate(self, frame: Any, boxes: FloatArray) -> tuple[FloatArray, FloatArray]:
        """Return keypoints (n, 17, 2) and scores (n, 17) for the given boxes."""
        ...


class RtmBackend:
    """YOLOX detection and RTMPose estimation through ONNX Runtime."""

    def __init__(
        self, mode: str = "balanced", device: str = "cpu", threads: int | None = None
    ) -> None:
        """`threads` caps how many processor cores the models use. None lets them use them all."""
        from rtmlib import Body  # type: ignore[import-untyped]

        if threads is None:
            self._model = Body(mode=mode, backend="onnxruntime", device=device)
            return
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
            self._model = Body(mode=mode, backend="onnxruntime", device=device)
        finally:
            ort.InferenceSession = made

    def detect(self, frame: Any) -> FloatArray:
        return np.asarray(self._model.det_model(frame), dtype=float).reshape(-1, 4)

    def estimate(self, frame: Any, boxes: FloatArray) -> tuple[FloatArray, FloatArray]:
        if len(boxes) == 0:
            return np.zeros((0, 17, 2)), np.zeros((0, 17))
        points, scores = self._model.pose_model(frame, bboxes=boxes.tolist())
        return np.asarray(points, dtype=float), np.asarray(scores, dtype=float)

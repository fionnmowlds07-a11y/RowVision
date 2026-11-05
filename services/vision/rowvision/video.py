"""Random access to video frames, with a cache for sequential reads."""

from pathlib import Path
from typing import Any

import cv2


class VideoReader:
    def __init__(self, path: Path) -> None:
        self._capture = cv2.VideoCapture(str(path))
        if not self._capture.isOpened():
            raise ValueError(f"cannot read video: {path}")
        self.fps = float(self._capture.get(cv2.CAP_PROP_FPS))
        self.frames = int(self._capture.get(cv2.CAP_PROP_FRAME_COUNT))
        self._next = 0

    def __call__(self, index: int) -> Any:
        if index != self._next:
            self._capture.set(cv2.CAP_PROP_POS_FRAMES, index)
        ok, frame = self._capture.read()
        if not ok:
            raise ValueError(f"cannot read frame {index}")
        self._next = index + 1
        return frame

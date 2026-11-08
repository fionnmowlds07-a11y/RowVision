"""Frame-exact access to video frames by number.

Seeking is never used. On phone footage with long gaps between keyframes, OpenCV's seek lands
a few frames early (2 to 5 on HEVC phone clips, 1 on the H.264 working copy), so every frame is
reached by decoding forward from the start. Going backwards reopens the file.
"""

from pathlib import Path
from typing import Any

import cv2


class VideoReader:
    def __init__(self, path: Path) -> None:
        self._path = path
        self._capture = self._open()
        self.fps = float(self._capture.get(cv2.CAP_PROP_FPS))
        self.frames = int(self._capture.get(cv2.CAP_PROP_FRAME_COUNT))
        self._next = 0

    def _open(self) -> Any:
        capture = cv2.VideoCapture(str(self._path))
        if not capture.isOpened():
            raise ValueError(f"cannot read video: {self._path}")
        return capture

    def __call__(self, index: int) -> Any:
        if index < self._next:
            self._capture.release()
            self._capture = self._open()
            self._next = 0
        while self._next < index:
            if not self._capture.grab():
                raise ValueError(f"cannot read frame {index}")
            self._next += 1
        ok, frame = self._capture.read()
        if not ok:
            raise ValueError(f"cannot read frame {index}")
        self._next = index + 1
        return frame

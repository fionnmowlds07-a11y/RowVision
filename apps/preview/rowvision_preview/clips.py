"""List clips and serve single frames from them.

Frames come from the same decoder the analysis reads, not a browser video element. Real clips have
variable timing, so a browser could not be relied on to show the frame an overlay was measured on.

Seeking in these clips takes most of a second, which is too slow for stepping backwards. So the open
clip is decoded once, in order, to JPEGs held in memory. Nothing is written to disk.
"""

import threading
from dataclasses import dataclass
from pathlib import Path

import cv2
from rowvision.video import VideoReader

VIDEO_SUFFIXES = {".mp4", ".mov", ".m4v", ".avi", ".webm"}
JPEG_QUALITY = 85


@dataclass(frozen=True)
class ClipInfo:
    fps: float
    frames: int
    width: int
    height: int


class _DecodedClip:
    """Decodes a clip in the background. Requests wait until their frame is ready."""

    def __init__(self, path: Path) -> None:
        self._reader = VideoReader(path)
        self.fps = self._reader.fps
        self.frames = self._reader.frames
        self.size = (0, 0)
        self._jpegs: list[bytes] = []
        self._finished = False
        self._stopped = False
        self._ready = threading.Condition()
        threading.Thread(target=self._decode, daemon=True).start()

    def _decode(self) -> None:
        try:
            for index in range(self.frames):
                frame = self._reader(index)
                ok, encoded = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
                if not ok or self._stopped:
                    return
                with self._ready:
                    self.size = (frame.shape[1], frame.shape[0])
                    self._jpegs.append(encoded.tobytes())
                    self._ready.notify_all()
        except ValueError:
            return  # The clip has fewer readable frames than it claims. Keep those it has.
        finally:
            with self._ready:
                self._finished = True
                self._ready.notify_all()

    def stop(self) -> None:
        self._stopped = True

    def jpeg(self, index: int) -> bytes:
        if not 0 <= index < self.frames:
            raise ValueError(f"no frame {index}")
        with self._ready:
            self._ready.wait_for(lambda: len(self._jpegs) > index or self._finished)
            if index >= len(self._jpegs):
                raise ValueError(f"cannot read frame {index}")
            return self._jpegs[index]


class ClipLibrary:
    def __init__(self, folder: Path) -> None:
        self._folder = folder
        self._lock = threading.Lock()
        self._open_name: str | None = None
        self._clip: _DecodedClip | None = None

    def names(self) -> list[str]:
        return sorted(
            item.name
            for item in self._folder.iterdir()
            if item.is_file() and item.suffix.lower() in VIDEO_SUFFIXES
        )

    def path(self, name: str) -> Path:
        """Return a clip's path. Names are checked against the folder, so paths cannot escape it."""
        if name not in self.names():
            raise KeyError(name)
        return self._folder / name

    def _open(self, name: str) -> _DecodedClip:
        """Return the decoded clip, replacing the last one so that only one is held in memory."""
        with self._lock:
            if self._clip is None or self._open_name != name:
                path = self.path(name)
                if self._clip is not None:
                    self._clip.stop()
                self._clip = _DecodedClip(path)
                self._open_name = name
            return self._clip

    def info(self, name: str) -> ClipInfo:
        clip = self._open(name)
        clip.jpeg(0)
        return ClipInfo(clip.fps, clip.frames, *clip.size)

    def frame_jpeg(self, name: str, index: int) -> bytes:
        return self._open(name).jpeg(index)

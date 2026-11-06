"""List clips and serve single frames from them.

Frames come from the same decoder the analysis reads, not a browser video element. Real clips have
variable timing, so a browser could not be relied on to show the frame an overlay was measured on.

Seeking in these clips takes most of a second, which is too slow for stepping backwards. So the open
clip is decoded once, in order, to JPEGs held in memory. The only thing written to disk is a video
the athlete adds, which is kept in the private folder.
"""

import hashlib
import io
import re
import threading
import uuid
from dataclasses import dataclass
from pathlib import Path

import cv2
from rowvision.video import VideoReader

VIDEO_SUFFIXES = {".mp4", ".mov", ".m4v", ".avi", ".webm"}
JPEG_QUALITY = 85
MAX_UPLOAD_BYTES = 4 * 1024**3
CHUNK_BYTES = 1024 * 1024


class UploadError(ValueError):
    """The video could not be added. The message is written for the athlete."""


def _digest(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        while chunk := file.read(CHUNK_BYTES):
            digest.update(chunk)
    return digest.hexdigest()


def _safe_name(name: str) -> str:
    """Return a plain file name, with any folders and awkward characters taken out."""
    path = Path(name.replace("\\", "/"))
    suffix = path.suffix.lower()
    if suffix not in VIDEO_SUFFIXES:
        raise UploadError("That file type is not supported. Use an MP4, MOV, M4V, AVI or WebM.")
    stem = re.sub(r"[^\w .()-]", "_", path.stem).strip(" .")
    return f"{stem or 'clip'}{suffix}"


def _readable(path: Path) -> bool:
    try:
        return VideoReader(path).frames > 0
    except (ValueError, OSError):
        return False


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
    def __init__(self, folder: Path, uploads: Path | None = None) -> None:
        self._folder = folder
        self._uploads = uploads
        self._lock = threading.Lock()
        self._open_name: str | None = None
        self._clip: _DecodedClip | None = None

    def _folders(self) -> list[Path]:
        folders = [self._folder, self._uploads]
        return [folder for folder in folders if folder is not None and folder.is_dir()]

    def names(self) -> list[str]:
        return sorted(
            {
                item.name
                for folder in self._folders()
                for item in folder.iterdir()
                if item.is_file()
                and item.suffix.lower() in VIDEO_SUFFIXES
                and not item.name.startswith(".")
            }
        )

    def path(self, name: str) -> Path:
        """Return a clip's path. Names are checked against the folders, so paths cannot escape."""
        if name not in self.names():
            raise KeyError(name)
        return next(folder / name for folder in self._folders() if (folder / name).is_file())

    def add(self, name: str, source: io.BufferedIOBase, length: int) -> str:
        """Save a video from `source` and return its clip name.

        The same video added twice keeps one copy and one name, so its saved results still match.
        A different video with a name already in use gets a new name.
        """
        if self._uploads is None:
            raise UploadError("This server cannot accept videos.")
        safe = _safe_name(name)
        if not 0 < length <= MAX_UPLOAD_BYTES:
            raise UploadError("That video is too big. The limit is 4 GB.")
        self._uploads.mkdir(parents=True, exist_ok=True)
        partial = self._uploads / f".{uuid.uuid4().hex}{Path(safe).suffix}"
        try:
            digest = self._receive(source, length, partial)
            if not _readable(partial):
                raise UploadError("That file could not be read as a video.")
            if safe in self.names():
                if _digest(self.path(safe)) == digest:
                    return safe
                safe = f"{Path(safe).stem}-{digest[:8]}{Path(safe).suffix}"
            if safe not in self.names():
                partial.replace(self._uploads / safe)
            return safe
        finally:
            partial.unlink(missing_ok=True)

    def _receive(self, source: io.BufferedIOBase, length: int, target: Path) -> str:
        digest = hashlib.sha256()
        left = length
        with target.open("wb") as file:
            while left:
                chunk = source.read(min(CHUNK_BYTES, left))
                if not chunk:
                    raise UploadError("The video did not finish uploading. Try again.")
                file.write(chunk)
                digest.update(chunk)
                left -= len(chunk)
        return digest.hexdigest()

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

"""Generated stand-ins for video and pose models. No real footage is used."""

from pathlib import Path

import cv2
import numpy as np
from rowvision.skeleton import FloatArray

FPS = 30.0


def write_video(path: Path, frames: int = 12, size: tuple[int, int] = (64, 48)) -> None:
    """Write a clip whose brightness rises frame by frame, so frames can be told apart."""
    fourcc = cv2.VideoWriter.fourcc(*"MJPG")
    writer = cv2.VideoWriter(str(path), fourcc, FPS, size)
    for index in range(frames):
        writer.write(np.full((size[1], size[0], 3), index * 20, dtype=np.uint8))
    writer.release()


class FakeSource:
    """A clip where a frame is its own index, as the vision tests do."""

    def __init__(self, frames: int, fps: float = FPS) -> None:
        self.frames = frames
        self.fps = fps
        self.reads = 0

    def __call__(self, index: int) -> int:
        self.reads += 1
        return index


class FakeBackend:
    def __init__(self, points: list[FloatArray], scores: list[FloatArray]) -> None:
        self.points = points
        self.scores = scores

    def detect(self, frame: int) -> FloatArray:
        people = self.points[frame]
        return np.concatenate([people.min(axis=1), people.max(axis=1)], axis=1)

    def estimate(self, frame: int, boxes: FloatArray) -> tuple[FloatArray, FloatArray]:
        people = self.points[frame]
        centres = people.mean(axis=1)
        wanted = (boxes[:, :2] + boxes[:, 2:]) / 2
        chosen = [int(np.linalg.norm(centres - item, axis=1).argmin()) for item in wanted]
        return people[chosen], self.scores[frame][chosen]

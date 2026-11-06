"""Find a rower's blade in a frame, using a small network trained on hand labels."""

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

import cv2
import numpy as np

from rowvision.skeleton import FloatArray

CROP_WIDTH, CROP_HEIGHT = 256, 128
TRUNKS_WIDE, TRUNKS_HIGH = 14.0, 7.0
"""An oar is about seven trunks long, and the crop must reach the blade at either end."""
TRUNKS_BELOW_HIP = 1.0
HEAT_STEP = 2
HANDS_SPREAD_PX = 6.0
MIN_CONFIDENCE = 0.5


class Session(Protocol):
    def run(self, names: None, feed: dict[str, Any]) -> list[Any]: ...


@dataclass(frozen=True)
class BladeFix:
    x: float
    y: float
    confidence: float
    in_water: float


def crop_transform(hip: FloatArray, trunk_px: float, facing: int) -> FloatArray:
    """Return the 2x3 video-to-crop transform, scaled by body size and mirrored to face right."""
    across = CROP_WIDTH / (TRUNKS_WIDE * trunk_px)
    down = CROP_HEIGHT / (TRUNKS_HIGH * trunk_px)
    centre_y = hip[1] + TRUNKS_BELOW_HIP * trunk_px
    mirror = 1 if facing >= 0 else -1
    return np.array(
        [
            [across * mirror, 0.0, CROP_WIDTH / 2 - across * mirror * hip[0]],
            [0.0, down, CROP_HEIGHT / 2 - down * centre_y],
        ]
    )


def _hands_channel(hands: FloatArray | None, transform: FloatArray) -> FloatArray:
    """Mark the hands, which says whose blade to find among the crew's."""
    if hands is None or not np.isfinite(hands).all():
        return np.zeros((CROP_HEIGHT, CROP_WIDTH), dtype=np.float32)
    x, y = transform @ np.append(hands, 1.0)
    rows, columns = np.mgrid[0:CROP_HEIGHT, 0:CROP_WIDTH].astype(np.float32)
    return np.exp(-((columns - x) ** 2 + (rows - y) ** 2) / (2 * HANDS_SPREAD_PX**2))


class BladeDetector:
    def __init__(self, session: Session) -> None:
        self._session = session

    @classmethod
    def load(cls, path: Path) -> "BladeDetector":
        import onnxruntime  # type: ignore[import-untyped]

        return cls(onnxruntime.InferenceSession(str(path), providers=["CPUExecutionProvider"]))

    def locate(
        self,
        frame: Any,
        hip: FloatArray,
        hands: FloatArray | None,
        trunk_px: float,
        facing: int,
    ) -> BladeFix:
        """Return the blade in video pixels, however sure the network is."""
        transform = crop_transform(hip, trunk_px, facing)
        crop = cv2.warpAffine(
            frame, transform, (CROP_WIDTH, CROP_HEIGHT), borderMode=cv2.BORDER_REPLICATE
        )
        colours = crop.astype(np.float32).transpose(2, 0, 1) / 255
        image = np.concatenate([colours, _hands_channel(hands, transform)[None]])
        heat, water = self._session.run(None, {"image": image[None].astype(np.float32)})
        row, column = np.unravel_index(int(heat[0, 0].argmax()), heat[0, 0].shape)
        spot = np.array([(column + 0.5) * HEAT_STEP, (row + 0.5) * HEAT_STEP])
        back = cv2.invertAffineTransform(transform)
        x, y = back @ np.append(spot, 1.0)
        return BladeFix(float(x), float(y), float(heat[0, 0].max()), float(water[0, 0]))

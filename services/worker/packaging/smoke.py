"""Check that a bundled engine can load the real models and run them, with no Python installed."""

import json
import platform
import time

import numpy as np
from rowvision.pose import RtmBackend

from rowvision_worker.engine import make_engine


def main() -> None:
    make_engine("fake", "cpu")
    started = time.time()
    backend = RtmBackend()
    loaded = time.time()
    frame = np.zeros((720, 1280, 3), dtype=np.uint8)
    backend.detect(frame)
    backend.estimate(frame, np.array([[100, 100, 400, 600]], dtype=np.float32))
    print(json.dumps({
        "system": platform.platform(),
        "load_seconds": round(loaded - started, 2),
        "run_seconds": round(time.time() - loaded, 2),
    }))


if __name__ == "__main__":
    main()

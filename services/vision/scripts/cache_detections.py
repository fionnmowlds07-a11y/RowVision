"""Save coarse detections for a folder of clips, so tracking changes can be tested quickly.

Usage: python scripts/cache_detections.py FOLDER OUTPUT_DIR
"""

import argparse
import pickle
from pathlib import Path

from rowvision.pipeline import coarse_pass
from rowvision.pose import RtmBackend
from rowvision.video import VideoReader


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("folder", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    backend = RtmBackend()
    for path in sorted(args.folder.glob("*.mp4")):
        target = args.output / f"{path.stem}.pkl"
        if target.exists():
            continue
        reader = VideoReader(path)
        points, scores = coarse_pass(reader, reader.frames, backend)
        with target.open("wb") as handle:
            pickle.dump((points, scores, reader.fps, reader.frames), handle)
        print(path.stem, len(points), flush=True)


if __name__ == "__main__":
    main()

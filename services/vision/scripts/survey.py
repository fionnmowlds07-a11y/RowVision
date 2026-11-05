"""Run the coarse pass over a folder of clips and print what it found in each.

Usage: python scripts/survey.py FOLDER
"""

import argparse
from pathlib import Path

import numpy as np

from rowvision.pipeline import COARSE_STEP, scout, view_by_frame
from rowvision.pose import RtmBackend
from rowvision.seats import is_rowing
from rowvision.shots import split_shots
from rowvision.video import VideoReader


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("folder", type=Path)
    args = parser.parse_args()
    backend = RtmBackend()
    for number, path in enumerate(sorted(args.folder.glob("*.mp4")), 1):
        reader = VideoReader(path)
        tracks = scout(reader, reader.frames, reader.fps, backend)
        coarse_fps = reader.fps / COARSE_STEP
        rowers = [track for track in tracks if is_rowing(track, coarse_fps)]
        views = view_by_frame(rowers, coarse_fps)
        shots = split_shots(views, coarse_fps)
        seconds = [
            f"{shot.kind.value}:{shot.frames / coarse_fps:.0f}s"
            for shot in shots
        ]
        median_view = float(np.nanmedian(views)) if np.isfinite(views).any() else float("nan")
        print(
            f"{number:02d} {path.stem}: {reader.frames / reader.fps:.0f}s, "
            f"{len(tracks)} tracks, {len(rowers)} rowing, view {median_view:.0f}, "
            f"shots {seconds}",
            flush=True,
        )


if __name__ == "__main__":
    main()

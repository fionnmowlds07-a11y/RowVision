"""Report what tracking and boat grouping find in cached detections.

Create the cache with scripts/cache_detections.py.

Usage: python scripts/survey.py DETECTIONS_DIR
"""

import argparse
import pickle
from pathlib import Path

import numpy as np

from rowvision.boats import find_boats
from rowvision.pipeline import COARSE_STEP, view_by_frame
from rowvision.shots import split_shots
from rowvision.tracking import track_people


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("detections", type=Path)
    args = parser.parse_args()
    for number, path in enumerate(sorted(args.detections.glob("*.pkl")), 1):
        with path.open("rb") as handle:
            points, scores, fps, frames = pickle.load(handle)
        coarse_fps = fps / COARSE_STEP
        tracks = track_people(points, scores, coarse_fps)
        boats = find_boats(tracks, coarse_fps)
        print(f"{number:02d} {path.stem}: {frames / fps:.0f}s, {len(tracks)} tracks", flush=True)
        for boat in boats:
            views = view_by_frame(boat.rowers, coarse_fps)
            shots = split_shots(views, coarse_fps)
            parts = [f"{shot.kind.value}:{shot.frames / coarse_fps:.0f}s" for shot in shots]
            view = float(np.nanmedian(views)) if np.isfinite(views).any() else float("nan")
            print(
                f"   boat: {len(boat.rowers)} rowing, trunk {boat.trunk_px:.0f}px, "
                f"seen {boat.seen().mean():.0%}, view {view:.0f}, {parts}",
                flush=True,
            )


if __name__ == "__main__":
    main()

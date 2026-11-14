"""Measure saved results again with the current code, to compare measuring changes in seconds.

Each path is a clip folder holding summary.json and frames.json, a saved report with joints in it,
or a folder of such reports. For each rower this prints the median of every measure and how much
it varies from stroke to stroke. Run it before and after a change and compare the two.

Usage: python scripts/remeasure.py PATH [PATH ...]
"""

import argparse
import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import numpy as np

from rowvision.metrics import MEASURES
from rowvision.remeasure import NoSkeleton, remeasure_rower

MIN_STROKES = 3


def load(path: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    """Return the summary and frame data from a clip folder or a saved report."""
    if path.is_dir():
        summary = json.loads((path / "summary.json").read_text())
        return summary, json.loads((path / "frames.json").read_text())
    report = json.loads(path.read_text())
    rower = report.get("rower") or {}
    return report, {"views": report.get("views"), "poses": rower.get("poses")}


def sources(paths: list[Path]) -> Iterator[Path]:
    for path in paths:
        if path.is_dir() and not (path / "summary.json").exists():
            yield from sorted(path.glob("*.json"))
        else:
            yield path


def describe(values: list[float]) -> tuple[float, float] | None:
    """Return the median and the standard deviation across strokes."""
    known = np.array([value for value in values if np.isfinite(value)])
    if len(known) < MIN_STROKES:
        return None
    return float(np.median(known)), float(np.std(known, ddof=1))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("paths", type=Path, nargs="+")
    args = parser.parse_args()
    scatter: dict[str, list[float]] = {name: [] for name in MEASURES}
    for path in sources(args.paths):
        try:
            summary, frames = load(path)
            rower = remeasure_rower(summary, frames)
        except (NoSkeleton, KeyError, OSError, ValueError) as error:
            print(f"{path.name}: skipped ({error})")
            continue
        overall = "none" if rower.card.overall is None else f"{rower.card.overall:.1f}"
        print(f"{path.name}: seat {rower.seat}, {len(rower.strokes)} strokes, overall {overall}")
        for name in MEASURES:
            found = describe([getattr(stroke, name) for stroke in rower.strokes])
            if found is not None:
                print(f"  {name:18s} median {found[0]:8.2f}  sd {found[1]:6.2f}")
                scatter[name].append(found[1])
    print("Mean stroke-to-stroke sd across rowers:")
    for name, values in scatter.items():
        if values:
            print(f"  {name:18s} {np.mean(values):6.2f}  ({len(values)} rowers)")


if __name__ == "__main__":
    main()

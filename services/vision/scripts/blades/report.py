"""Report how well the blade detector did on clips it never saw, from the output of train.py."""

import argparse
import json
from pathlib import Path

import numpy as np

PX_PER_TRUNK = 256 / 14
CM_PER_PX = 55 / PX_PER_TRUNK
CONFIDENCE_LEVELS = (0.2, 0.3, 0.5, 0.7)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("results", type=Path, nargs="?", default=Path("/private/train/cv.json"))
    results = json.loads(parser.parse_args().results.read_text())

    seen = [r for r in results if r["state"] < 2]
    error = np.array([np.subtract(r["pred"], r["truth"]) for r in seen])
    distance = np.hypot(*error.T)
    baseline = np.hypot(*np.array([np.subtract(r["base"], r["truth"]) for r in seen]).T)
    hit = distance < PX_PER_TRUNK

    print("n", len(results), "seen", len(seen))
    print(
        "distance in trunks: median",
        round(np.median(distance) / PX_PER_TRUNK, 2),
        "baseline",
        round(np.median(baseline) / PX_PER_TRUNK, 2),
    )
    print(
        "within 1 trunk",
        round(hit.mean() * 100),
        "%, within 0.5",
        round((distance < PX_PER_TRUNK / 2).mean() * 100),
        "%, baseline within 1",
        round((baseline < PX_PER_TRUNK).mean() * 100),
        "%",
    )
    vertical = np.abs(error[:, 1])
    print(
        "vertical cm: median",
        round(np.median(vertical) * CM_PER_PX, 1),
        "p90",
        round(np.percentile(vertical, 90) * CM_PER_PX, 1),
        "| right blade only:",
        round(np.median(vertical[hit]) * CM_PER_PX, 1) if hit.any() else None,
    )

    confidence = np.array([r["conf"] for r in results])
    hidden = np.array([r["state"] == 2 for r in results])
    print(
        "confidence median: seen",
        round(np.median(confidence[~hidden]), 2),
        "hidden",
        round(np.median(confidence[hidden]), 2),
    )
    for level in CONFIDENCE_LEVELS:
        kept = np.array([r["conf"] >= level for r in seen])
        print(
            " confidence >=",
            level,
            "keeps",
            round(kept.mean() * 100),
            "%, within 1 trunk",
            round(hit[kept].mean() * 100) if kept.any() else None,
            "%, hidden accepted",
            round((confidence[hidden] >= level).mean() * 100),
            "%",
        )

    said_water = np.array([r["water"] > 0.5 for r in seen])
    in_water = np.array([r["state"] == 1 for r in seen])
    print(
        "water accuracy",
        round((said_water == in_water).mean() * 100),
        "%, water recall",
        round(said_water[in_water].mean() * 100),
        "%, air accuracy",
        round((~said_water[~in_water]).mean() * 100),
        "%",
    )
    for clip in sorted({r["clip"] for r in results}):
        mask = np.array([r["clip"] == clip for r in seen])
        if mask.any():
            print(
                clip[4:19],
                "n",
                mask.sum(),
                "median",
                round(np.median(distance[mask]) / PX_PER_TRUNK, 2),
                "within 1",
                round(hit[mask].mean() * 100),
                "%",
            )


if __name__ == "__main__":
    main()

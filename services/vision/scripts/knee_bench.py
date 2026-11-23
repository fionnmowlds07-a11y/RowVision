"""Score pose setups on the knee against the hand-labelled frames.

The labels come from the preview's labelling page and stay in the private folder. Each label names a
clip, a seat and a frame. The newest saved result for that clip and seat gives the facing direction
and the joints the engine found, and the source clip gives the frame to run the pose model on again.

    python scripts/knee_bench.py --private ../../private --videos ../../videos --setup stored
    python scripts/knee_bench.py ... --setup balanced --setup performance

Frames the engine would leave out, as their leg is not one a body could make, are counted apart.

Only the leg nearest the camera is compared, as it is the only one the knee angle is read from.
"""

import argparse
import json
import math
import statistics
from collections import defaultdict
from pathlib import Path
from typing import Any

import numpy as np

from rowvision import skeleton as sk
from rowvision.metrics import legs_believable

Point = list[float] | None


def _angle(hip: Point, knee: Point, ankle: Point) -> float | None:
    if not hip or not knee or not ankle:
        return None
    first = math.atan2(hip[1] - knee[1], hip[0] - knee[0])
    second = math.atan2(ankle[1] - knee[1], ankle[0] - knee[0])
    turn = abs(math.degrees(first - second)) % 360
    return min(turn, 360 - turn)


def _results(private: Path) -> dict[tuple[str, int], dict[str, Any]]:
    """Return the newest result for each clip and seat."""
    newest: dict[tuple[str, int], tuple[float, Path]] = {}
    for path in (private / "preview" / "results").glob("*.json"):
        head = json.loads(path.read_text())
        settings = head.get("settings") or {}
        if "clip" not in settings or not head.get("rower"):
            continue
        key = (settings["clip"], int(settings["seat"]))
        stamp = path.stat().st_mtime
        if key not in newest or stamp > newest[key][0]:
            newest[key] = (stamp, path)
    return {key: json.loads(path.read_text()) for key, (_, path) in newest.items()}


def _poses(result: dict[str, Any]) -> tuple[np.ndarray, np.ndarray]:
    """Return the followed rower's joints (frames, 17, 2) and scores (frames, 17), NaN where absent."""
    poses = result["rower"]["poses"]
    points = np.full((len(poses), sk.JOINT_COUNT, 2), np.nan)
    scores = np.zeros((len(poses), sk.JOINT_COUNT))
    for index, pose in enumerate(poses):
        for joint, value in enumerate(pose or []):
            if value:
                points[index, joint] = value[:2]
                scores[index, joint] = value[2] if len(value) > 2 else 1.0
    return points, scores


def _box_for(boxes: np.ndarray, joints: np.ndarray) -> np.ndarray | None:
    """Pick the detected box that holds most of the engine's joints for this rower."""
    seen = joints[np.isfinite(joints).all(axis=1)]
    if len(boxes) == 0 or len(seen) == 0:
        return None
    inside = [
        np.sum((seen[:, 0] >= x1) & (seen[:, 0] <= x2) & (seen[:, 1] >= y1) & (seen[:, 1] <= y2))
        for x1, y1, x2, y2 in boxes
    ]
    return boxes[int(np.argmax(inside))]


class Rerun:
    """Run the pose model again on labelled frames, reading each clip once in frame order."""

    def __init__(self, mode: str, videos: Path) -> None:
        from rowvision.pose import RtmBackend

        self.backend = RtmBackend(mode=mode)
        self.videos = videos

    def frames(
        self, clip: str, wanted: dict[int, np.ndarray]
    ) -> dict[int, tuple[np.ndarray, np.ndarray]]:
        from rowvision.video import VideoReader

        read = VideoReader(self.videos / clip)
        found: dict[int, tuple[np.ndarray, np.ndarray]] = {}
        for frame in sorted(wanted):
            image = read(frame)
            box = _box_for(self.backend.detect(image), wanted[frame])
            if box is None:
                continue
            points, scores = self.backend.estimate(image, box[None])
            found[frame] = (points[0], scores[0])
        return found


def bench(private: Path, videos: Path, setup: str) -> dict[str, Any]:
    labels: dict[str, dict[str, Any]] = json.loads((private / "labels" / "labels.json").read_text())
    results = _results(private)
    by_clip: dict[tuple[str, int], dict[int, dict[str, Any]]] = defaultdict(dict)
    for key, record in labels.items():
        name, seat_text, frame_text = key.rsplit("#", 2)
        by_clip[(name, int(seat_text))][int(frame_text)] = record["clicks"]

    rerun = None if setup == "stored" else Rerun(setup, videos)
    errors: list[float] = []
    dropped = 0
    per_clip: dict[str, list[float]] = defaultdict(list)
    for (clip, seat), frames in sorted(by_clip.items()):
        result = results.get((clip, seat))
        if result is None:
            continue
        facing = int(result["facing"])
        points, _ = _poses(result)
        if rerun is not None:
            fresh = rerun.frames(clip, {frame: points[frame] for frame in frames})
            for frame, (found, _confidence) in fresh.items():
                points[frame] = found
        believable = legs_believable(points, facing)
        for frame, clicks in frames.items():
            if not believable[frame]:
                dropped += 1
                continue
            truth = _angle(clicks["hip"], clicks["knee"], clicks["ankle"])
            hip, knee, ankle = (part[frame] for part in sk.near_leg(points, facing))
            if truth is None or not np.isfinite([hip, knee, ankle]).all():
                continue
            model = _angle(hip.tolist(), knee.tolist(), ankle.tolist())
            if model is None:
                continue
            errors.append(abs(truth - model))
            per_clip[clip].append(abs(truth - model))
    return {
        "setup": setup,
        "frames": len(errors),
        "left_out": dropped,
        "median_deg": statistics.median(errors) if errors else None,
        "within_5": sum(e <= 5 for e in errors) / len(errors) if errors else None,
        "within_10": sum(e <= 10 for e in errors) / len(errors) if errors else None,
        "over_20": sum(e > 20 for e in errors),
        "clips": {clip: round(statistics.median(e), 1) for clip, e in per_clip.items()},
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--private", type=Path, required=True)
    parser.add_argument("--videos", type=Path, required=True)
    parser.add_argument(
        "--setup", action="append", choices=["stored", "lightweight", "balanced", "performance"]
    )
    args = parser.parse_args()
    for setup in args.setup or ["stored"]:
        print(json.dumps(bench(args.private, args.videos, setup)), flush=True)


if __name__ == "__main__":
    main()

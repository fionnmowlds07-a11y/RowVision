"""Measure how well off-the-shelf detection and pose work on a real clip.

Compares native and upscaled inference on evenly spaced frames, printing rower counts and
per-joint confidence, and writes annotated frames to the output directory.

Usage: python scripts/feasibility.py VIDEO OUTPUT_DIR [--samples 8] [--scales 1 2 3]
"""

import argparse
import time
from pathlib import Path

import cv2
import numpy as np
from rtmlib import Body, draw_skeleton

COCO_JOINTS = {
    "shoulder": (5, 6),
    "elbow": (7, 8),
    "wrist": (9, 10),
    "hip": (11, 12),
    "knee": (13, 14),
    "ankle": (15, 16),
}
CONFIDENT = 0.5


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("video", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--samples", type=int, default=8)
    parser.add_argument("--scales", type=float, nargs="+", default=[1, 2, 3])
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)

    model = Body(mode="performance", backend="onnxruntime", device="cpu")
    capture = cv2.VideoCapture(str(args.video))
    total = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
    indices = np.linspace(0, total - 2, args.samples).astype(int)

    for scale in args.scales:
        counts: list[int] = []
        heights: list[float] = []
        joint_scores: dict[str, list[float]] = {name: [] for name in COCO_JOINTS}
        started = time.perf_counter()
        for index in indices:
            capture.set(cv2.CAP_PROP_POS_FRAMES, int(index))
            ok, frame = capture.read()
            if not ok:
                continue
            big = cv2.resize(frame, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
            keypoints, scores = model(big)
            keypoints, scores = np.asarray(keypoints), np.asarray(scores)
            people = 0
            for person, confidence in zip(keypoints, scores):
                if confidence[[5, 6, 11, 12]].mean() < 0.3:
                    continue
                people += 1
                visible = person[confidence > 0.3]
                heights.append(float(np.ptp(visible[:, 1])) / scale)
                for name, pair in COCO_JOINTS.items():
                    joint_scores[name].append(float(confidence[list(pair)].max()))
            counts.append(people)
            drawn = draw_skeleton(big.copy(), keypoints, scores, kpt_thr=0.3)
            cv2.imwrite(str(args.output / f"pose_s{scale:g}_f{index:04d}.jpg"), drawn)
        elapsed = (time.perf_counter() - started) / max(len(counts), 1)
        summary = {
            name: f"{np.mean(np.array(values) > CONFIDENT):.0%}"
            for name, values in joint_scores.items()
            if values
        }
        print(f"scale {scale:g}: people per frame {counts}, {elapsed:.1f}s/frame")
        print(f"  median body height {np.median(heights) if heights else 0:.0f}px")
        print(f"  share of people with joint confidence > {CONFIDENT}: {summary}")


if __name__ == "__main__":
    main()

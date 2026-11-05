"""Run pose estimation across a frame range and save the raw keypoints for offline analysis.

Usage: python scripts/extract_poses.py VIDEO OUTPUT.npz [--start 0] [--end 300] [--mode balanced]
"""

import argparse
import time
from pathlib import Path

import cv2
import numpy as np
from rtmlib import Body

MAX_PEOPLE = 12
JOINTS = 17


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("video", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--start", type=int, default=0)
    parser.add_argument("--end", type=int, default=300)
    parser.add_argument("--mode", default="balanced", choices=["lightweight", "balanced", "performance"])
    args = parser.parse_args()

    model = Body(mode=args.mode, backend="onnxruntime", device="cpu")
    capture = cv2.VideoCapture(str(args.video))
    capture.set(cv2.CAP_PROP_POS_FRAMES, args.start)
    frames = args.end - args.start
    points = np.full((frames, MAX_PEOPLE, JOINTS, 2), np.nan, dtype=np.float32)
    scores = np.zeros((frames, MAX_PEOPLE, JOINTS), dtype=np.float32)

    started = time.perf_counter()
    for offset in range(frames):
        ok, frame = capture.read()
        if not ok:
            points, scores = points[:offset], scores[:offset]
            break
        keypoints, confidence = model(frame)
        count = min(len(keypoints), MAX_PEOPLE)
        points[offset, :count] = np.asarray(keypoints)[:count]
        scores[offset, :count] = np.asarray(confidence)[:count]
    elapsed = time.perf_counter() - started
    print(f"{args.mode}: {len(points)} frames, {elapsed / max(len(points), 1):.2f}s/frame")
    np.savez_compressed(args.output, points=points, scores=scores, start=args.start)


if __name__ == "__main__":
    main()

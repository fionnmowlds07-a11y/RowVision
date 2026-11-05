"""Draw saved keypoints from extract_poses.py onto the source video.

Usage: python scripts/render_overlay.py VIDEO POSES.npz OUTPUT.mp4
"""

import argparse
from pathlib import Path

import cv2
import numpy as np

LIMBS = [(5, 7), (7, 9), (6, 8), (8, 10), (5, 11), (6, 12), (11, 13), (13, 15), (12, 14), (14, 16)]
MIN_SCORE = 0.3


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("video", type=Path)
    parser.add_argument("poses", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    data = np.load(args.poses)
    points, scores, start = data["points"], data["scores"], int(data["start"])
    capture = cv2.VideoCapture(str(args.video))
    capture.set(cv2.CAP_PROP_POS_FRAMES, start)
    size = (
        int(capture.get(cv2.CAP_PROP_FRAME_WIDTH)),
        int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT)),
    )
    fourcc = cv2.VideoWriter.fourcc(*"mp4v")
    writer = cv2.VideoWriter(str(args.output), fourcc, capture.get(cv2.CAP_PROP_FPS), size)

    for frame_points, frame_scores in zip(points, scores):
        ok, frame = capture.read()
        if not ok:
            break
        for person, confidence in zip(frame_points, frame_scores):
            for first, second in LIMBS:
                if min(confidence[first], confidence[second]) < MIN_SCORE:
                    continue
                start_point = tuple(int(v) for v in person[first])
                end_point = tuple(int(v) for v in person[second])
                cv2.line(frame, start_point, end_point, (0, 255, 255), 1, cv2.LINE_AA)
        writer.write(frame)
    writer.release()


if __name__ == "__main__":
    main()

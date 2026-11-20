"""Cut a crop around each labelled rower, scaled by body size and mirrored to face right.

Reads the hand labels and saved results from the private folder, which never goes in git, and
writes the crops the blade detector trains on, plus a contact sheet to check crops and labels agree.
Run inside the vision image with the private folder and videos mounted.
"""

import argparse
import json
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from rowvision.blades import blade_faces_camera

WIDTH, HEIGHT = 256, 128
SPAN_X_TRUNKS = 14.0
SPAN_Y_TRUNKS = 7.0
Y_SHIFT_TRUNKS = 1.0
STATES = {"air": 0, "water": 1, "hidden": 2}
SHEET_TILES = 24
SHEET_COLUMNS = 4


def newest_settings(results: Path) -> dict[str, dict[str, Any]]:
    """Return the facing direction and side from the newest saved result for each clip."""
    newest: dict[str, dict[str, Any]] = {}
    for path in sorted(results.glob("*.json"), key=lambda p: p.stat().st_mtime):
        result = json.loads(path.read_text())
        if result.get("rower") and result.get("settings"):
            clip = result["settings"]["clip"]
            newest[clip] = {"facing": result["facing"], "side": result["settings"]["side"]}
    return newest


def usable_labels(
    labels: dict[str, Any], newest: dict[str, dict[str, Any]]
) -> list[tuple[str, dict[str, Any], dict[str, Any]]]:
    """Keep labels with a known body size whose blade is on the camera's side of the boat."""
    rows = []
    for key, label in labels.items():
        setting = newest.get(label["clip"])
        if setting is None or not blade_faces_camera(setting["side"], setting["facing"] or 0):
            continue
        if label.get("hip") and label.get("trunk"):
            rows.append((key, label, setting))
    return rows


def crop_transform(hip: list[float], trunk: float, facing: int) -> np.ndarray:
    """Return the affine map from video to crop, mirrored so the rower faces right."""
    centre_x, centre_y = hip[0], hip[1] + Y_SHIFT_TRUNKS * trunk
    scale_x, scale_y = WIDTH / (SPAN_X_TRUNKS * trunk), HEIGHT / (SPAN_Y_TRUNKS * trunk)
    return np.array(
        [
            [scale_x * facing, 0, WIDTH / 2 - scale_x * facing * centre_x],
            [0, scale_y, HEIGHT / 2 - scale_y * centre_y],
        ],
        dtype=np.float32,
    )


def apply(matrix: np.ndarray, point: list[float] | None) -> list[float]:
    """Map a point into the crop, or mark it missing."""
    if not point:
        return [-1.0, -1.0]
    mapped: list[float] = (matrix @ np.array([point[0], point[1], 1.0])).tolist()
    return mapped


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--private", type=Path, default=Path("/private"))
    parser.add_argument("--videos", type=Path, default=Path("/videos"))
    args = parser.parse_args()

    labels = json.loads((args.private / "labels/blades.json").read_text())
    rows = usable_labels(labels, newest_settings(args.private / "preview/results"))
    print("rows", len(rows))

    trunks: dict[str, list[float]] = {}
    for _, label, _ in rows:
        trunks.setdefault(label["clip"], []).append(label["trunk"])
    median_trunk = {clip: float(np.median(values)) for clip, values in trunks.items()}

    out: dict[str, list[Any]] = {k: [] for k in ("img", "blade", "state", "hands", "clip", "trunk")}
    by_clip: dict[str, list[tuple[str, dict[str, Any], dict[str, Any]]]] = {}
    for row in rows:
        by_clip.setdefault(row[1]["clip"], []).append(row)

    for clip, items in by_clip.items():
        source = args.videos / clip
        if not source.exists():
            source = args.private / "uploads" / clip
        capture = cv2.VideoCapture(str(source))
        for key, label, setting in sorted(items, key=lambda item: item[1]["frame"]):
            capture.set(cv2.CAP_PROP_POS_FRAMES, label["frame"])
            ok, frame = capture.read()
            if not ok:
                print("bad", key)
                continue
            trunk = median_trunk[clip]
            matrix = crop_transform(label["hip"], trunk, setting["facing"] or 1)
            shrinking = matrix[1, 1] < 1
            crop = cv2.warpAffine(
                frame,
                matrix,
                (WIDTH, HEIGHT),
                flags=cv2.INTER_AREA if shrinking else cv2.INTER_LINEAR,
                borderMode=cv2.BORDER_REPLICATE,
            )
            out["img"].append(crop)
            out["state"].append(STATES[label["state"]])
            out["blade"].append(apply(matrix, label["blade"]))
            out["hands"].append(apply(matrix, label["hands"]))
            out["clip"].append(clip)
            out["trunk"].append(trunk)

    np.savez_compressed(
        args.private / "train/crops.npz",
        img=np.array(out["img"], np.uint8),
        blade=np.array(out["blade"], np.float32),
        state=np.array(out["state"]),
        hands=np.array(out["hands"], np.float32),
        clip=np.array(out["clip"]),
        trunk=np.array(out["trunk"], np.float32),
    )
    blades, states = np.array(out["blade"]), np.array(out["state"])
    inside = (blades[:, 0] >= 0) & (blades[:, 0] < WIDTH) & (blades[:, 1] >= 0)
    inside &= blades[:, 1] < HEIGHT
    print(len(blades), "inside", inside[states < 2].mean().round(3))

    tiles = []
    for i in np.linspace(0, len(blades) - 1, SHEET_TILES).astype(int):
        tile = out["img"][i].copy()
        if states[i] < 2:
            colour = (0, 255, 255) if states[i] == 0 else (0, 0, 255)
            point = tuple(int(v) for v in blades[i])
            cv2.drawMarker(tile, point, colour, cv2.MARKER_CROSS, 14, 2)
        hands = out["hands"][i]
        if hands[0] >= 0:
            cv2.circle(tile, (int(hands[0]), int(hands[1])), 4, (255, 255, 0), 1)
        tiles.append(tile)
    sheet = np.vstack(
        [np.hstack(tiles[i : i + SHEET_COLUMNS]) for i in range(0, SHEET_TILES, SHEET_COLUMNS)]
    )
    cv2.imwrite(str(args.private / "review/blades/crops.jpg"), sheet)


if __name__ == "__main__":
    main()

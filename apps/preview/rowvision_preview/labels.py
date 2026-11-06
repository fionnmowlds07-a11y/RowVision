"""Hand labels of joint positions, used to measure how accurate the pose model really is.

The page never shows the model's answer, so a label cannot be swayed by it. Labels come from real
athletes, so they are kept in the private folder and never committed.
"""

import json
import math
import threading
from pathlib import Path
from typing import Any

JOINTS = {
    "shoulder": (5, 6),
    "elbow": (7, 8),
    "wrist": (9, 10),
    "hip": (11, 12),
    "knee": (13, 14),
    "ankle": (15, 16),
}
FRAMES_PER_CLIP = 8
TARGET_FRAMES = 100
TOLERANCE_DEG = 5.0
MIN_SPAN_PX = 130.0
MEASURABLE_SHOTS = {"side_on", "oblique"}
TRUNKS_IN_VIEW = 5.0

Point = list[float] | None


def _middle(pose: list[Any], pair: tuple[int, int]) -> Point:
    """Return the centre of a joint pair, which is the point the analysis measures from."""
    left, right = pose[pair[0]], pose[pair[1]]
    if not left or not right:
        return None
    return [(left[0] + right[0]) / 2, (left[1] + right[1]) / 2]


def model_joints(pose: list[Any]) -> dict[str, Point]:
    return {name: _middle(pose, pair) for name, pair in JOINTS.items()}


def _spaced(frames: list[int], count: int) -> list[int]:
    """Pick up to `count` frames spread evenly through a sorted list."""
    if len(frames) <= count:
        return frames
    step = len(frames) / count
    return [frames[int(index * step)] for index in range(count)]


def _measurable(result: dict[str, Any], frame: int) -> bool:
    """Return True for frames seen from the side, as angles cannot be judged end-on."""
    shots = result.get("shots") or []
    kinds = [shot["kind"] for shot in shots if shot["start"] <= frame < shot["end"]]
    return not kinds or kinds[0] in MEASURABLE_SHOTS


def _moments(result: dict[str, Any]) -> list[int]:
    """Return catches, finishes and the points between them, so all stroke positions are sampled."""
    rower = result["rower"]
    frames: set[int] = set()
    for stroke in rower["strokes"]:
        catch, finish, following = (
            stroke["catch_frame"],
            stroke["finish_frame"],
            stroke["next_catch_frame"],
        )
        frames |= {catch, finish, (catch + finish) // 2, (finish + following) // 2}
    return sorted(
        frame for frame in frames if rower["poses"][frame] and _measurable(result, frame)
    )


def _trunk_px(joints: dict[str, Point]) -> float | None:
    shoulder, hip = joints["shoulder"], joints["hip"]
    return math.dist(shoulder, hip) if shoulder and hip else None


def _centre(pose: list[Any]) -> list[float]:
    seen = [joint for joint in pose if joint]
    return [sum(joint[axis] for joint in seen) / len(seen) for axis in (0, 1)]


def _trunk_angle(joints: dict[str, Point]) -> float | None:
    shoulder, hip = joints["shoulder"], joints["hip"]
    if not shoulder or not hip:
        return None
    return math.degrees(math.atan2(shoulder[0] - hip[0], hip[1] - shoulder[1]))


def _knee_angle(joints: dict[str, Point]) -> float | None:
    hip, knee, ankle = joints["hip"], joints["knee"], joints["ankle"]
    if not hip or not knee or not ankle:
        return None
    first = math.atan2(hip[1] - knee[1], hip[0] - knee[0])
    second = math.atan2(ankle[1] - knee[1], ankle[0] - knee[0])
    turn = abs(math.degrees(first - second)) % 360
    return min(turn, 360 - turn)


def _share_within(errors: list[float]) -> float | None:
    if not errors:
        return None
    return 100 * sum(error <= TOLERANCE_DEG for error in errors) / len(errors)


class LabelStore:
    def __init__(self, results: Path, path: Path) -> None:
        self._results = results
        self._path = path
        self._lock = threading.Lock()
        self._sample_key: list[tuple[str, int]] | None = None
        self._sample_items: list[dict[str, Any]] = []

    def _records(self) -> dict[str, dict[str, Any]]:
        if not self._path.exists():
            return {}
        records: dict[str, dict[str, Any]] = json.loads(self._path.read_text())
        return records

    def _write(self, records: dict[str, dict[str, Any]]) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        partial = self._path.with_suffix(".partial")
        partial.write_text(json.dumps(records, separators=(",", ":")))
        partial.replace(self._path)

    def _sample(self) -> list[dict[str, Any]]:
        """Return frames to label, reading the large result files only when they change."""
        key = sorted((path.name, path.stat().st_mtime_ns) for path in self._results.glob("*.json"))
        if key != self._sample_key:
            self._sample_items = self._read_sample()
            self._sample_key = key
        return self._sample_items

    def _read_sample(self) -> list[dict[str, Any]]:
        """Read frames to label, grouped by clip so that clips load once each."""
        items: dict[str, dict[str, Any]] = {}
        for path in sorted(self._results.glob("*.json")):
            result = json.loads(path.read_text())
            rower, settings = result.get("rower"), result.get("settings")
            if not rower or not settings or "strokes" not in rower:
                continue
            for frame in _spaced(_moments(result), FRAMES_PER_CLIP):
                pose = rower["poses"][frame]
                joints = model_joints(pose)
                key = f"{settings['clip']}#{settings['seat']}#{frame}"
                items[key] = {
                    "id": key,
                    "clip": settings["clip"],
                    "frame": frame,
                    "centre": _centre(pose),
                    "span": max(MIN_SPAN_PX, (_trunk_px(joints) or 0) * TRUNKS_IN_VIEW),
                    "model": joints,
                }
        return list(items.values())

    def next_item(self) -> dict[str, Any] | None:
        """Return the next frame to label, without the model's answer."""
        with self._lock:
            done = self._records()
            for item in self._sample():
                if item["id"] not in done:
                    return {key: value for key, value in item.items() if key != "model"}
        return None

    def save(self, item_id: str, clicks: dict[str, Any]) -> None:
        """Store a label with the model's joints as they stood, so later changes cannot alter it."""
        with self._lock:
            item = next((entry for entry in self._sample() if entry["id"] == item_id), None)
        if item is None:
            raise ValueError("That frame is not in the labelling set.")
        if set(clicks) != set(JOINTS):
            raise ValueError("Send every joint, using null for one that cannot be seen.")
        for point in clicks.values():
            valid = point is None or (
                isinstance(point, list)
                and len(point) == 2
                and all(isinstance(value, int | float) for value in point)
            )
            if not valid:
                raise ValueError("Each joint must be an x and y position, or null.")
        # One writer at a time, or two quick saves could lose a label or collide on the file.
        with self._lock:
            records = self._records()
            records[item_id] = {"clicks": clicks, "model": item["model"]}
            self._write(records)

    def undo(self) -> str | None:
        """Remove the newest label, so the frame comes up again. Returns its id."""
        with self._lock:
            records = self._records()
            if not records:
                return None
            newest = list(records)[-1]
            del records[newest]
            self._write(records)
            return newest

    def summary(self) -> dict[str, Any]:
        with self._lock:
            records = self._records()
            available = len(self._sample())
        by_joint: dict[str, list[float]] = {name: [] for name in JOINTS}
        hidden = dict.fromkeys(JOINTS, 0)
        trunk_errors: list[float] = []
        knee_errors: list[float] = []
        usable = 0
        for record in records.values():
            clicks, model = record["clicks"], record["model"]
            usable += any(clicks.values())
            for name in JOINTS:
                if clicks[name] is None:
                    hidden[name] += 1
                elif model[name]:
                    by_joint[name].append(math.dist(clicks[name], model[name]))
            for measure, errors in ((_trunk_angle, trunk_errors), (_knee_angle, knee_errors)):
                truth, found = measure(clicks), measure(model)
                if truth is not None and found is not None:
                    errors.append(abs(truth - found))
        distances = [distance for values in by_joint.values() for distance in values]
        per_axis = (
            math.sqrt(sum(value**2 for value in distances) / len(distances) / 2)
            if distances
            else None
        )
        return {
            "labelled": len(records),
            "usable": usable,
            "target": TARGET_FRAMES,
            "available": available,
            "keypoint_error_px": per_axis,
            "trunk_within_5_deg": _share_within(trunk_errors),
            "knee_within_5_deg": _share_within(knee_errors),
            "joints": {
                name: {
                    "clicked": len(values),
                    "hidden": hidden[name],
                    "typical_error_px": sorted(values)[len(values) // 2] if values else None,
                }
                for name, values in by_joint.items()
            },
        }

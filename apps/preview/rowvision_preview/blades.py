"""Hand labels of where the rower's blade is, used to train and test the blade detector.

Only rowers whose blade faces the camera are labelled, as those are the only blades measured.
Labels come from real athletes, so they are kept in the private folder and never committed.
"""

import json
import threading
from pathlib import Path
from typing import Any

from rowvision.blades import blade_faces_camera

from rowvision_preview.labels import _centre, _measurable, _spaced, _trunk_px, model_joints

FRAMES_PER_CLIP = 40
TARGET_FRAMES = 200
MIN_SPAN_PX = 260.0
TRUNKS_IN_VIEW = 14.0
"""An oar is about seven trunks long, so the blade can be far from the rower."""
SEEN_STATES = {"air", "water"}
HIDDEN = "hidden"
RECOVERY_SHARES = (0.25, 0.5, 0.75)
FRAMES_PER_TURN = 5
"""Changing clip means decoding it again, so a few frames are done from each clip at a time."""
LEFT_WRIST, RIGHT_WRIST = 9, 10


def _moments(result: dict[str, Any]) -> list[int]:
    """Return frames across the whole stroke, with most in the recovery, where height matters."""
    rower = result["rower"]
    frames: set[int] = set()
    for stroke in rower["strokes"]:
        catch, finish, following = (
            stroke["catch_frame"],
            stroke["finish_frame"],
            stroke["next_catch_frame"],
        )
        frames |= {catch, (catch + finish) // 2, finish}
        frames |= {finish + round((following - finish) * share) for share in RECOVERY_SHARES}
    return sorted(
        frame
        for frame in frames
        if frame < len(rower["poses"]) and rower["poses"][frame] and _measurable(result, frame)
    )


class BladeStore:
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
        key = sorted((path.name, path.stat().st_mtime_ns) for path in self._results.glob("*.json"))
        if key != self._sample_key:
            self._sample_items = self._read_sample()
            self._sample_key = key
        return self._sample_items

    def _read_sample(self) -> list[dict[str, Any]]:
        """Read frames from the newest result of each clip, as older ones may have followed the
        wrong person. Clips take turns in small groups, so stopping early still covers them all."""
        newest: dict[str, tuple[int, dict[str, Any]]] = {}
        for path in self._results.glob("*.json"):
            result = json.loads(path.read_text())
            rower, settings = result.get("rower"), result.get("settings")
            if not rower or not settings or "strokes" not in rower or "side" not in settings:
                continue
            made = path.stat().st_mtime_ns
            if settings["clip"] not in newest or made > newest[settings["clip"]][0]:
                newest[settings["clip"]] = (made, result)
        by_clip = [
            [_item(result, frame) for frame in _spaced(_moments(result), FRAMES_PER_CLIP)]
            for _, (_, result) in sorted(newest.items())
            if blade_faces_camera(result["settings"]["side"], result.get("facing") or 0)
        ]
        longest = max((len(items) for items in by_clip), default=0)
        return [
            item
            for start in range(0, longest, FRAMES_PER_TURN)
            for items in by_clip
            for item in items[start : start + FRAMES_PER_TURN]
        ]

    def next_item(self) -> dict[str, Any] | None:
        with self._lock:
            done = self._records()
            return next((item for item in self._sample() if item["id"] not in done), None)

    def save(self, item_id: str, blade: Any, state: str) -> None:
        with self._lock:
            item = next((entry for entry in self._sample() if entry["id"] == item_id), None)
            if item is None:
                raise ValueError("That frame is not in the labelling set.")
            if state == HIDDEN:
                if blade is not None:
                    raise ValueError("A hidden blade has no position.")
            elif state not in SEEN_STATES:
                raise ValueError("Say whether the blade is in the air, in the water or hidden.")
            elif not (
                isinstance(blade, list)
                and len(blade) == 2
                and all(isinstance(value, int | float) for value in blade)
            ):
                raise ValueError("A seen blade needs an x and y position.")
            records = self._records()
            records[item_id] = {**item, "blade": blade, "state": state}
            self._write(records)

    def undo(self) -> str | None:
        with self._lock:
            records = self._records()
            known = {item["id"] for item in self._sample()}
            counted = [item_id for item_id in records if item_id in known]
            if not counted:
                return None
            del records[counted[-1]]
            self._write(records)
            return counted[-1]

    def summary(self) -> dict[str, Any]:
        with self._lock:
            records = self._records()
            sample = self._sample()
        available = len(sample)
        # Labels for blades on the far side stay on disk but do not count.
        states = [records[item["id"]]["state"] for item in sample if item["id"] in records]
        return {
            "labelled": len(states),
            "usable": sum(state in SEEN_STATES for state in states),
            "target": TARGET_FRAMES,
            "available": available,
            "air": states.count("air"),
            "water": states.count("water"),
            "hidden": states.count(HIDDEN),
        }


def _hands(pose: list[Any]) -> list[float] | None:
    """Return the middle of the hands, or the one hand seen, as both are often not found."""
    seen = [pose[index] for index in (LEFT_WRIST, RIGHT_WRIST) if pose[index]]
    if not seen:
        return None
    return [sum(hand[axis] for hand in seen) / len(seen) for axis in (0, 1)]


def _top(pose: list[Any]) -> list[float]:
    """Return a point at the top of the rower, to mark who is being labelled."""
    seen = [joint for joint in pose if joint]
    return [sum(joint[0] for joint in seen) / len(seen), min(joint[1] for joint in seen)]


def _item(result: dict[str, Any], frame: int) -> dict[str, Any]:
    pose = result["rower"]["poses"][frame]
    joints = model_joints(pose)
    settings = result["settings"]
    return {
        "id": f"{settings['clip']}#{settings['seat']}#{frame}",
        "clip": settings["clip"],
        "frame": frame,
        "side": settings.get("side"),
        "centre": _centre(pose),
        "span": max(MIN_SPAN_PX, (_trunk_px(joints) or 0) * TRUNKS_IN_VIEW),
        "hands": _hands(pose),
        "top": _top(pose),
        "hip": joints["hip"],
        "trunk": _trunk_px(joints),
    }

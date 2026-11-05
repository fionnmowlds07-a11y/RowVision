import json
from pathlib import Path
from typing import Any

import pytest

from rowvision_preview.labels import JOINTS, LabelStore, model_joints


def pose(shift: float = 0.0) -> list[Any]:
    """A rower with joints at known places. Left and right share a position."""
    joints: list[Any] = [None] * 17
    spots = {
        "shoulder": (100, 100), "elbow": (80, 120), "wrist": (60, 120),
        "hip": (110, 160), "knee": (70, 130), "ankle": (60, 180),
    }  # fmt: skip
    for name, (left, right) in JOINTS.items():
        x, y = spots[name]
        joints[left] = [x + shift, y, 0.9]
        joints[right] = [x + shift, y, 0.9]
    return joints


def write_result(folder: Path, clip: str = "a.mp4", frames: int = 200) -> None:
    folder.mkdir(exist_ok=True)
    poses: list[Any] = [pose() for _ in range(frames)]
    strokes = [
        {"catch_frame": start, "finish_frame": start + 20, "next_catch_frame": start + 60}
        for start in range(10, frames - 70, 60)
    ]
    result = {
        "settings": {"clip": clip, "seat": 1},
        "rower": {"poses": poses, "strokes": strokes},
    }
    (folder / f"{clip}.json").write_text(json.dumps(result))


@pytest.fixture
def store(tmp_path: Path) -> LabelStore:
    write_result(tmp_path / "results")
    return LabelStore(tmp_path / "results", tmp_path / "labels" / "labels.json")


def clicks(shift: float = 0.0) -> dict[str, Any]:
    return {name: [point[0] + shift, point[1]] for name, point in model_joints(pose()).items()}


def test_the_model_answer_is_never_sent_to_the_page(store: LabelStore) -> None:
    item = store.next_item()
    assert item is not None
    assert "model" not in item
    assert "poses" not in item


def test_labelled_frames_do_not_come_up_again(store: LabelStore) -> None:
    first = store.next_item()
    assert first is not None
    store.save(first["id"], clicks())
    second = store.next_item()
    assert second is not None
    assert second["id"] != first["id"]


def test_frames_sample_every_part_of_the_stroke(store: LabelStore) -> None:
    frames = []
    while (item := store.next_item()) is not None:
        frames.append(item["frame"])
        store.save(item["id"], clicks())
    assert 4 <= len(frames) <= 8
    assert len(set(frames)) == len(frames)


def test_perfect_clicks_show_no_error(store: LabelStore) -> None:
    item = store.next_item()
    assert item is not None
    store.save(item["id"], clicks())
    summary = store.summary()
    assert summary["keypoint_error_px"] == 0
    assert summary["trunk_within_5_deg"] == 100
    assert summary["knee_within_5_deg"] == 100


def test_error_is_reported_per_axis_to_match_the_rating(store: LabelStore) -> None:
    item = store.next_item()
    assert item is not None
    store.save(item["id"], clicks(shift=3.0))
    assert store.summary()["keypoint_error_px"] == pytest.approx(3 / 2**0.5)


def test_a_wrong_knee_lowers_the_real_accuracy(store: LabelStore) -> None:
    item = store.next_item()
    assert item is not None
    moved = clicks()
    moved["knee"] = [moved["knee"][0] - 40, moved["knee"][1] - 30]
    store.save(item["id"], moved)
    assert store.summary()["knee_within_5_deg"] == 0


def test_hidden_joints_are_counted_not_measured(store: LabelStore) -> None:
    item = store.next_item()
    assert item is not None
    store.save(item["id"], clicks() | {"ankle": None})
    summary = store.summary()
    assert summary["joints"]["ankle"] == {"clicked": 0, "hidden": 1, "typical_error_px": None}
    assert summary["knee_within_5_deg"] is None


def test_a_skipped_frame_counts_as_done_but_not_as_data(store: LabelStore) -> None:
    item = store.next_item()
    assert item is not None
    store.save(item["id"], dict.fromkeys(JOINTS))
    summary = store.summary()
    assert summary["labelled"] == 1
    assert summary["usable"] == 0
    assert summary["keypoint_error_px"] is None


def test_undo_brings_the_last_frame_back(store: LabelStore) -> None:
    item = store.next_item()
    assert item is not None
    store.save(item["id"], clicks())
    assert store.undo() == item["id"]
    assert store.next_item() == item


def test_labels_survive_a_restart(store: LabelStore, tmp_path: Path) -> None:
    item = store.next_item()
    assert item is not None
    store.save(item["id"], clicks())
    reopened = LabelStore(tmp_path / "results", tmp_path / "labels" / "labels.json")
    assert reopened.summary()["labelled"] == 1


@pytest.mark.parametrize(
    "joints",
    [{}, {"shoulder": [1, 2]}, dict.fromkeys(JOINTS, "x"), {key: [1] for key in JOINTS}],
)
def test_bad_labels_are_refused(store: LabelStore, joints: dict[str, Any]) -> None:
    item = store.next_item()
    assert item is not None
    with pytest.raises(ValueError):
        store.save(item["id"], joints)


def test_unknown_frames_are_refused(store: LabelStore) -> None:
    with pytest.raises(ValueError, match="not in the labelling set"):
        store.save("other#1#5", clicks())


def test_clips_without_a_rower_are_ignored(tmp_path: Path) -> None:
    folder = tmp_path / "results"
    folder.mkdir()
    (folder / "none.json").write_text(json.dumps({"settings": {"clip": "a"}, "rower": None}))
    assert LabelStore(folder, tmp_path / "labels.json").next_item() is None


def test_end_on_frames_are_not_offered(tmp_path: Path) -> None:
    folder = tmp_path / "results"
    write_result(folder)
    path = folder / "a.mp4.json"
    result = json.loads(path.read_text())
    result["shots"] = [
        {"start": 0, "end": 100, "kind": "end_on"},
        {"start": 100, "end": 200, "kind": "side_on"},
    ]
    path.write_text(json.dumps(result))
    store = LabelStore(folder, tmp_path / "labels.json")
    frames = []
    while (item := store.next_item()) is not None:
        frames.append(item["frame"])
        store.save(item["id"], clicks())
    assert frames
    assert min(frames) >= 100

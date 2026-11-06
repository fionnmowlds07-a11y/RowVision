import json
import os
from pathlib import Path
from typing import Any

import pytest
from test_labels import pose

from rowvision_preview.blades import FRAMES_PER_CLIP, FRAMES_PER_TURN, BladeStore


def write_result(
    folder: Path,
    name: str,
    clip: str,
    seat: int = 1,
    frames: int = 500,
    side: str = "bow",
    facing: int = -1,
) -> None:
    folder.mkdir(exist_ok=True)
    strokes = [
        {"catch_frame": start, "finish_frame": start + 20, "next_catch_frame": start + 60}
        for start in range(10, frames - 70, 60)
    ]
    poses: list[Any] = [pose() for _ in range(frames)]
    result = {
        "settings": {"clip": clip, "seat": seat, "side": side},
        "facing": facing,
        "rower": {"poses": poses, "strokes": strokes},
    }
    (folder / name).write_text(json.dumps(result))


@pytest.fixture
def store(tmp_path: Path) -> BladeStore:
    write_result(tmp_path / "results", "a.json", "a.mp4")
    write_result(tmp_path / "results", "b.json", "b.mp4")
    return BladeStore(tmp_path / "results", tmp_path / "labels" / "blades.json")


def walk(store: BladeStore) -> list[dict[str, Any]]:
    seen = []
    while (item := store.next_item()) is not None:
        seen.append(item)
        store.save(item["id"], None, "hidden")
    return seen


def test_frames_cover_the_whole_stroke_and_stop_at_the_limit(store: BladeStore) -> None:
    frames = walk(store)
    assert len(frames) == 2 * FRAMES_PER_CLIP
    in_stroke = {(item["frame"] - 10) % 60 for item in frames}
    assert 0 in in_stroke or 20 in in_stroke
    assert any(value > 20 for value in in_stroke), "the recovery must be sampled"


def test_clips_take_turns_in_small_groups(store: BladeStore) -> None:
    clips = [item["clip"] for item in walk(store)]
    assert clips[:FRAMES_PER_TURN] == ["a.mp4"] * FRAMES_PER_TURN
    assert clips[FRAMES_PER_TURN : FRAMES_PER_TURN * 2] == ["b.mp4"] * FRAMES_PER_TURN


def test_one_hand_is_enough_to_mark_the_rower(tmp_path: Path) -> None:
    results = tmp_path / "results"
    write_result(results, "a.json", "a.mp4")
    saved = json.loads((results / "a.json").read_text())
    for joints in saved["rower"]["poses"]:
        joints[9] = None
    (results / "a.json").write_text(json.dumps(saved))
    item = BladeStore(results, tmp_path / "blades.json").next_item()
    assert item is not None
    assert item["hands"] == [60.0, 120.0]
    assert item["top"][1] == 100


def test_only_the_newest_result_of_a_clip_is_used(tmp_path: Path) -> None:
    results = tmp_path / "results"
    write_result(results, "old.json", "a.mp4", seat=1)
    write_result(results, "new.json", "a.mp4", seat=3)
    (results / "old.json").touch()
    (results / "new.json").touch()
    os.utime(results / "old.json", (1, 1))
    item = BladeStore(results, tmp_path / "blades.json").next_item()
    assert item is not None
    assert item["id"].startswith("a.mp4#3#")


def test_an_item_says_where_the_hands_are(store: BladeStore) -> None:
    item = store.next_item()
    assert item is not None
    assert item["hands"] == [60.0, 120.0]
    assert item["trunk"] > 0


def test_a_label_is_saved_with_what_training_needs(store: BladeStore, tmp_path: Path) -> None:
    item = store.next_item()
    assert item is not None
    store.save(item["id"], [10.5, 20.0], "air")
    saved = json.loads((tmp_path / "labels" / "blades.json").read_text())[item["id"]]
    assert saved["blade"] == [10.5, 20.0]
    assert saved["state"] == "air"
    assert saved["hip"] == item["hip"]
    summary = store.summary()
    assert (summary["usable"], summary["air"]) == (1, 1)


def test_hidden_blades_count_but_are_not_usable(store: BladeStore) -> None:
    item = store.next_item()
    assert item is not None
    store.save(item["id"], None, "hidden")
    summary = store.summary()
    assert (summary["labelled"], summary["usable"], summary["hidden"]) == (1, 0, 1)


@pytest.mark.parametrize(
    ("blade", "state"),
    [
        ([1, 2], "hidden"),
        (None, "air"),
        ([1], "water"),
        (["a", "b"], "air"),
        ([1, 2], "flying"),
    ],
)
def test_bad_labels_are_refused(store: BladeStore, blade: Any, state: str) -> None:
    item = store.next_item()
    assert item is not None
    with pytest.raises(ValueError):
        store.save(item["id"], blade, state)


def test_undo_brings_the_frame_back(store: BladeStore) -> None:
    item = store.next_item()
    assert item is not None
    store.save(item["id"], [1, 2], "water")
    assert store.undo() == item["id"]
    following = store.next_item()
    assert following is not None
    assert following["id"] == item["id"]
    assert store.undo() is None


def test_rowers_with_a_blade_on_the_far_side_are_left_out(tmp_path: Path) -> None:
    results = tmp_path / "results"
    write_result(results, "far.json", "far.mp4", side="bow", facing=1)
    write_result(results, "near.json", "near.mp4", side="stroke", facing=1)
    write_result(results, "single.json", "single.mp4", side="scull", facing=1)
    store = BladeStore(results, tmp_path / "blades.json")
    assert {item["clip"] for item in walk(store)} == {"near.mp4", "single.mp4"}


def test_a_sweep_rower_is_left_out_when_the_direction_is_unknown(tmp_path: Path) -> None:
    results = tmp_path / "results"
    write_result(results, "a.json", "a.mp4", side="stroke", facing=0)
    assert BladeStore(results, tmp_path / "blades.json").next_item() is None


def test_old_far_side_labels_stay_saved_but_do_not_count(tmp_path: Path) -> None:
    results = tmp_path / "results"
    write_result(results, "a.json", "a.mp4", side="bow", facing=-1)
    store = BladeStore(results, tmp_path / "blades.json")
    item = store.next_item()
    assert item is not None
    store.save(item["id"], [1, 2], "air")
    write_result(results, "a.json", "a.mp4", side="stroke", facing=-1)
    os.utime(results / "a.json", (9, 9))
    summary = store.summary()
    assert (summary["usable"], summary["available"]) == (0, 0)
    assert store.undo() is None, "undo must not remove a label that no longer counts"
    assert item["id"] in json.loads((tmp_path / "blades.json").read_text())

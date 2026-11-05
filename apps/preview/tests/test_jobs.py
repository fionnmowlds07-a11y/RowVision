import json
import pickle
import threading
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from crew import crew_detections, two_boat_detections
from fakes import FakeBackend, FakeSource
from rowvision.pipeline import COARSE_STEP, FILM_CLOSER

from rowvision_preview.clips import ClipLibrary
from rowvision_preview.jobs import Runner, Settings, State, code_version, load_detections

CLIP = "clip(1).mp4"
SETTLED = {"done", "failed", "cancelled", "needs_boat"}


def settings(boats: int = 1, boat_class: str = "4x", seat: int = 2) -> Settings:
    return Settings(CLIP, boat_class, boats, seat)


def wait(runner: Runner) -> dict[str, Any]:
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        status = runner.status()
        if status["state"] in SETTLED:
            return status
        time.sleep(0.01)
    raise AssertionError("job did not settle")


def near_boat(status: dict[str, Any]) -> list[float]:
    return next(boat["outline"] for boat in status["boats"] if not boat["too_far"])


class Rig:
    """A runner over generated detections."""

    def __init__(self, folder: Path, detections: tuple[list[Any], list[Any]]) -> None:
        (folder / "videos").mkdir()
        (folder / "videos" / CLIP).write_bytes(b"stand-in")
        self.folder = folder
        self.backend = FakeBackend(*detections)
        self.source = FakeSource(len(detections[0]))
        self.backends_made = 0
        self.runner = self.make_runner()

    def make_backend(self) -> FakeBackend:
        self.backends_made += 1
        return self.backend

    def make_runner(self) -> Runner:
        return Runner(
            ClipLibrary(self.folder / "videos"),
            self.folder / "results",
            self.folder / "detections",
            lambda path: self.source,
            self.make_backend,
        )


@pytest.fixture
def four(tmp_path: Path) -> Rig:
    return Rig(tmp_path, crew_detections(4))


@pytest.fixture
def two_boats(tmp_path: Path) -> Rig:
    return Rig(tmp_path, two_boat_detections())


def test_idle_before_any_job(four: Rig) -> None:
    assert four.runner.status() == {"state": "idle"}


def test_analysis_finishes_with_limb_lines_and_markers(four: Rig) -> None:
    four.runner.start(settings())
    status = wait(four.runner)
    assert status["state"] == "done"
    rower = status["result"]["rower"]
    assert rower["seat"] == 2
    assert len(rower["poses"]) == four.source.frames
    assert len(rower["catches"]) >= 4
    assert len(rower["finishes"]) >= 3


def test_result_is_saved_and_reused_without_reading_the_video(four: Rig) -> None:
    four.runner.start(settings())
    first = wait(four.runner)
    assert len(list((four.folder / "results").glob("*.json"))) == 1
    four.source.reads = 0
    fresh = four.make_runner()
    fresh.start(settings())
    assert wait(fresh)["result"] == first["result"]
    assert four.source.reads == 0


def test_different_seats_are_not_given_each_others_result(four: Rig) -> None:
    four.runner.start(settings(seat=2))
    wait(four.runner)
    four.runner.start(settings(seat=3))
    assert wait(four.runner)["result"]["rower"]["seat"] == 3


def test_stops_to_ask_for_a_boat_then_carries_on(two_boats: Rig) -> None:
    two_boats.runner.start(settings(boats=2))
    status = wait(two_boats.runner)
    assert status["state"] == "needs_boat"
    assert status["preview"] % COARSE_STEP == 0
    x1, y1, x2, y2 = near_boat(status)

    reads = two_boats.source.reads
    two_boats.runner.choose_boat((x1 + x2) / 2, (y1 + y2) / 2)
    status = wait(two_boats.runner)
    assert status["state"] == "done"
    assert status["result"]["rower"]["seat"] == 2
    # The boats found before the question are reused, so only the fine pass reads frames.
    assert two_boats.source.reads - reads <= two_boats.source.frames


def test_any_tap_on_the_same_boat_reuses_the_result(two_boats: Rig) -> None:
    two_boats.runner.start(settings(boats=2))
    x1, y1, x2, y2 = near_boat(wait(two_boats.runner))
    two_boats.runner.choose_boat(x1 + 1, y1 + 1)
    first = wait(two_boats.runner)
    two_boats.runner.start(settings(boats=2))
    wait(two_boats.runner)
    two_boats.source.reads = 0
    two_boats.runner.choose_boat(x2 - 1, y2 - 1)
    assert wait(two_boats.runner)["result"] == first["result"]
    assert two_boats.source.reads == 0


def test_tapping_a_distant_boat_gives_the_film_closer_message(two_boats: Rig) -> None:
    two_boats.runner.start(settings(boats=2))
    boats = wait(two_boats.runner)["boats"]
    index = next(i for i, boat in enumerate(boats) if boat["too_far"])
    x1, y1, x2, y2 = boats[index]["outline"]
    two_boats.runner.choose_boat((x1 + x2) / 2, (y1 + y2) / 2)
    result = wait(two_boats.runner)["result"]
    assert result["film_closer"] == FILM_CLOSER
    assert result["rower"] is None


def test_choosing_a_boat_with_nothing_waiting_is_refused(four: Rig) -> None:
    with pytest.raises(ValueError):
        four.runner.choose_boat(1, 2)


def test_clip_with_no_people_says_so(tmp_path: Path) -> None:
    empty = [np.zeros((0, 17, 2)) for _ in range(40)]
    rig = Rig(tmp_path, (empty, [np.zeros((0, 17)) for _ in range(40)]))
    rig.runner.start(settings())
    result = wait(rig.runner)["result"]
    assert result["warnings"] == ["No rowers were found in this video."]


def test_failure_is_reported_with_its_reason(four: Rig, capsys: pytest.CaptureFixture[str]) -> None:
    def broken(index: int) -> None:
        raise ValueError(f"cannot read frame {index}")

    four.source.__class__ = type("Broken", (FakeSource,), {"__call__": lambda _, i: broken(i)})
    four.runner.start(settings())
    status = wait(four.runner)
    assert status["state"] == "failed"
    assert status["error"] == "ValueError: cannot read frame 0"


def blocking_source(four: Rig) -> tuple[threading.Event, Callable[[int], int]]:
    reached = threading.Event()
    original = four.source

    class Slow(FakeSource):
        def __call__(self, index: int) -> int:
            reached.set()
            time.sleep(0.001)
            return original(index)

    four.source = Slow(original.frames)
    return reached, four.source


def test_progress_is_reported_while_running(four: Rig) -> None:
    reached, _ = blocking_source(four)
    four.runner.start(settings())
    assert reached.wait(10)
    seen = []
    while four.runner.status()["state"] == "running":
        seen.append(four.runner.status()["progress"])
        time.sleep(0.005)
    fractions = [value for value in seen if value is not None]
    assert fractions
    assert all(0 <= value < 1 for value in fractions)
    assert {status for status in seen if status} != {0.0}


def test_cancel_stops_at_the_next_frame(four: Rig) -> None:
    reached, source = blocking_source(four)
    four.runner.start(settings())
    assert reached.wait(10)
    four.runner.cancel()
    assert four.runner.status()["state"] == "cancelled"
    time.sleep(0.05)
    reads = source.reads
    time.sleep(0.05)
    assert source.reads == reads
    assert reads < source.frames
    assert not (four.folder / "results").exists()


def test_cancel_does_not_wait_for_a_step_that_cannot_be_interrupted(four: Rig) -> None:
    release = threading.Event()
    four.backend.detect = lambda frame: release.wait(30) and np.zeros((0, 4))  # type: ignore
    four.runner.start(settings())
    four.runner.cancel()
    assert four.runner.status()["state"] == "cancelled"
    four.runner.start(settings(seat=3))
    assert four.runner.status()["state"] == "running"
    release.set()
    four.backend.detect = FakeBackend(four.backend.points, four.backend.scores).detect  # type: ignore
    assert wait(four.runner)["result"]["rower"]["seat"] == 3


def test_cancel_while_waiting_for_a_boat(two_boats: Rig) -> None:
    two_boats.runner.start(settings(boats=2))
    wait(two_boats.runner)
    two_boats.runner.cancel()
    assert two_boats.runner.status()["state"] == "cancelled"
    with pytest.raises(ValueError):
        two_boats.runner.choose_boat(1, 2)


def test_starting_a_new_job_replaces_the_running_one(four: Rig) -> None:
    reached, _ = blocking_source(four)
    four.runner.start(settings(seat=2))
    assert reached.wait(10)
    four.runner.start(settings(seat=3))
    status = wait(four.runner)
    assert status["settings"]["seat"] == 3
    assert status["result"]["rower"]["seat"] == 3


def test_saved_detections_replace_the_coarse_pass(four: Rig) -> None:
    frames = four.source.frames
    points = four.backend.points[::COARSE_STEP]
    scores = four.backend.scores[::COARSE_STEP]
    (four.folder / "detections").mkdir()
    # Saved under the name without the "(1)" that a repeat download adds.
    with (four.folder / "detections" / "clip.pkl").open("wb") as handle:
        pickle.dump((points, scores, four.source.fps, frames), handle)

    four.runner.start(settings())
    with_saved = wait(four.runner)
    reads = four.source.reads
    assert with_saved["state"] == "done"
    # Only the fine pass read the video, and it never looks at the coarse frames twice.
    assert reads <= frames

    for path in (four.folder / "results").glob("*.json"):
        path.unlink()
    (four.folder / "detections" / "clip.pkl").unlink()
    four.runner.start(settings())
    assert wait(four.runner)["result"] == with_saved["result"]


def test_detections_for_a_different_video_are_ignored(tmp_path: Path) -> None:
    with (tmp_path / "clip.pkl").open("wb") as handle:
        pickle.dump(([], [], 30.0, 999), handle)
    assert load_detections(tmp_path, CLIP, FakeSource(100)) is None
    assert load_detections(tmp_path, "other.mp4", FakeSource(100)) is None


def test_saved_json_is_strict(four: Rig) -> None:
    four.runner.start(settings())
    wait(four.runner)
    [path] = (four.folder / "results").glob("*.json")

    def refuse(text: str) -> None:
        raise AssertionError(f"not strict JSON: {text}")

    json.loads(path.read_text(), parse_constant=refuse)


@pytest.mark.parametrize(
    ("change", "message"),
    [
        ({"clip": "missing.mp4"}, "clip"),
        ({"boat_class": "9x"}, "boat class"),
        ({"boats_in_video": 0}, "Boats"),
        ({"boats_in_video": 1.5}, "Boats"),
        ({"boats_in_video": True}, "Boats"),
        ({"seat": 5}, "Seat"),
        ({"seat": "2"}, "Seat"),
    ],
)
def test_bad_settings_are_refused(change: dict[str, Any], message: str) -> None:
    body = {"clip": CLIP, "boat_class": "4x", "boats_in_video": 1, "seat": 2, "side": "scull"}
    body = body | change
    with pytest.raises(ValueError, match=message):
        Settings.parse(body, [CLIP])


def test_seat_limit_follows_the_boat_class() -> None:
    body = {"clip": CLIP, "boat_class": "8+", "boats_in_video": 1, "seat": 8, "side": "bow"}
    assert Settings.parse(body, [CLIP]).request().boat_seats == 8
    single = body | {"seat": 1, "boat_class": "1x", "side": "scull"}
    assert Settings.parse(single, [CLIP]).request().boat_seats == 1


def test_state_values_match_the_page() -> None:
    assert {state.value for state in State} == SETTLED | {"idle", "running"}


@pytest.mark.parametrize(
    ("boat_class", "side", "allowed"),
    [
        ("1x", "scull", True),
        ("4x", "scull", True),
        ("8+", "stroke", True),
        ("2-", "bow", True),
        ("1x", "bow", False),
        ("8+", "scull", False),
        ("4+", None, False),
    ],
)
def test_rowing_side_must_suit_the_boat(boat_class: str, side: str | None, allowed: bool) -> None:
    body = {"clip": CLIP, "boat_class": boat_class, "boats_in_video": 1, "seat": 1, "side": side}
    if allowed:
        assert Settings.parse(body, [CLIP]).side == side
    else:
        with pytest.raises(ValueError, match="needs"):
            Settings.parse(body, [CLIP])


def test_changing_a_target_invalidates_saved_results(tmp_path: Path, monkeypatch: Any) -> None:
    package = tmp_path / "rowvision"
    package.mkdir()
    (package / "__init__.py").write_text("")
    targets = tmp_path / "reference"
    targets.mkdir()
    target_file = targets / "general.yaml"
    target_file.write_text("min: 160")
    monkeypatch.setattr("rowvision.__file__", str(package / "__init__.py"))
    before = code_version()
    target_file.write_text("min: 165")
    assert code_version() != before

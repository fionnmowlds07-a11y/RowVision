from dataclasses import dataclass, field
from pathlib import Path
from types import FunctionType
from typing import Any

import numpy as np
from rowvision.pipeline import COARSE_STEP, BoatChoice
from rowvision.tracking import Track

from rowvision_worker.engine import Setup, Tap, Video, pause_for, plan_request

VIDEO = Video(Path("x"), 30.0, 300, 1000, 500)


class FakeTrack:
    def __init__(self, x: float, y: float) -> None:
        self._centre = np.tile([x, y], (100, 1)).astype(float)

    def centre(self) -> Any:
        return self._centre

    def trunk(self) -> float:
        return 40.0


@dataclass
class FakeBoat:
    box: tuple[float, float, float, float]
    tracks: list[FakeTrack] = field(default_factory=list)
    confirmed: bool = True
    too_far: bool = False

    def outline(self, frame: int) -> Any:
        return np.array(self.box)


@dataclass
class FakeScouting:
    boats: list[FakeBoat]
    preview: int = 60

    def choices(self) -> list[BoatChoice]:
        return [BoatChoice(np.array(boat.box), len(boat.tracks), boat.too_far, boat.confirmed) for boat in self.boats]


def setup(tap: Tap | None) -> Setup:
    return Setup("8+", "bow", 3, tap)


def crew() -> FakeBoat:
    return FakeBoat((100, 200, 900, 300), [FakeTrack(300, 250), FakeTrack(500, 250)])


def test_a_tap_on_a_rower_picks_them() -> None:
    request = plan_request(FakeScouting([crew()]), setup(Tap(2.0, 0.5, 0.5)), VIDEO)
    assert request is not None
    assert request.tap == (60, 500.0, 250.0)
    assert request.boat_tap == request.tap
    assert request.seat == 3
    assert request.side == "bow"


def test_a_tap_on_open_water_asks_again() -> None:
    assert plan_request(FakeScouting([crew()]), setup(Tap(2.0, 0.5, 0.95)), VIDEO) is None


def test_a_tap_just_off_the_body_still_counts() -> None:
    assert plan_request(FakeScouting([crew()]), setup(Tap(2.0, 0.5, 0.65)), VIDEO) is not None


def test_a_tap_past_the_end_uses_the_last_frame() -> None:
    request = plan_request(FakeScouting([crew()]), setup(Tap(99.0, 0.5, 0.5)), VIDEO)
    assert request is not None and request.tap is not None
    assert request.tap[0] == 299
    assert 299 // COARSE_STEP < 100


def test_a_too_far_boat_goes_on_to_film_closer() -> None:
    far = FakeBoat((100, 200, 900, 300), too_far=True)
    request = plan_request(FakeScouting([far]), setup(Tap(1.0, 0.5, 0.5)), VIDEO)
    assert request is not None and request.boat_tap is not None
    assert request.tap is None


def test_no_tap_with_one_boat_uses_the_seat() -> None:
    request = plan_request(FakeScouting([crew()]), setup(None), VIDEO)
    assert request is not None and request.tap is None


def test_no_tap_with_two_boats_asks() -> None:
    assert plan_request(FakeScouting([crew(), crew()]), setup(None), VIDEO) is None


def test_no_boats_goes_on_to_report_it() -> None:
    assert plan_request(FakeScouting([]), setup(Tap(1.0, 0.5, 0.5)), VIDEO) is not None


def test_the_stated_boats_match_what_was_found() -> None:
    request = plan_request(FakeScouting([crew(), crew()]), setup(Tap(2.0, 0.5, 0.5)), VIDEO)
    assert request is not None
    assert request.boats_in_video == 2


def test_a_pause_gives_the_frame_and_boats() -> None:
    pause = pause_for(FakeScouting([crew()]), VIDEO).pause
    assert pause["seconds"] == 2.0
    assert pause["boats"][0]["people"] == 2


def test_the_fake_track_matches_the_real_one() -> None:
    assert isinstance(vars(Track)["trunk"], FunctionType)
    assert isinstance(vars(Track)["centre"], FunctionType)

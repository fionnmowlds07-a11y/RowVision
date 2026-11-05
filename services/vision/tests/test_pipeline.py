import numpy as np
import pytest
from crew import crew_detections

from rowvision.pipeline import Analysis, Request, Scope, analyse
from rowvision.shots import ShotKind
from rowvision.skeleton import FloatArray

FPS = 30.0


class FakeBackend:
    """Serves synthetic detections. A frame is its own index."""

    def __init__(self, seats: int) -> None:
        self.points, self.scores = crew_detections(seats)
        self.estimated_people = 0

    def detect(self, frame: int) -> FloatArray:
        people = self.points[frame]
        lows, highs = people.min(axis=1), people.max(axis=1)
        return np.concatenate([lows, highs], axis=1)

    def estimate(self, frame: int, boxes: FloatArray) -> tuple[FloatArray, FloatArray]:
        self.estimated_people += len(boxes)
        people = self.points[frame]
        centres = people.mean(axis=1)
        wanted = (boxes[:, :2] + boxes[:, 2:]) / 2
        chosen = [
            int(np.linalg.norm(centres - centre, axis=1).argmin()) for centre in wanted
        ]
        return people[chosen], self.scores[frame][chosen]


def run(backend: FakeBackend, request: Request) -> Analysis:
    return analyse(lambda index: index, len(backend.points), FPS, request, backend)


def test_chosen_seat_is_measured_at_full_frame_rate() -> None:
    result = run(FakeBackend(4), Request(boat_seats=4, seat=2))
    assert [rower.seat for rower in result.rowers] == [2]
    rower = result.rowers[0]
    assert rower.rate_spm == pytest.approx(24, abs=1)
    assert rower.summary["catch_lean_deg"] == pytest.approx(25, abs=5)
    assert rower.summary["finish_lean_deg"] == pytest.approx(-20, abs=5)
    assert np.isfinite(rower.points[:, 5, 0]).mean() > 0.9


def test_crew_scope_measures_every_seat() -> None:
    result = run(FakeBackend(4), Request(boat_seats=4, scope=Scope.CREW))
    assert sorted(rower.seat for rower in result.rowers) == [1, 2, 3, 4]


def test_seat_scope_does_far_less_pose_work_than_crew_scope() -> None:
    seat, crew = FakeBackend(4), FakeBackend(4)
    run(seat, Request(boat_seats=4, seat=2))
    run(crew, Request(boat_seats=4, scope=Scope.CREW))
    assert seat.estimated_people < crew.estimated_people / 2


def test_tap_selects_a_rower_when_seats_are_incomplete() -> None:
    backend = FakeBackend(3)
    centre = backend.points[100][1].mean(axis=0)
    result = run(backend, Request(boat_seats=8, tap=(100, float(centre[0]), float(centre[1]))))
    assert len(result.rowers) == 1
    assert not result.seats_complete
    assert not any("best guess" in warning for warning in result.warnings)


def test_missing_rowers_produce_a_warning() -> None:
    result = run(FakeBackend(3), Request(boat_seats=8, seat=7))
    assert any("best guess" in warning for warning in result.warnings)


def test_seat_out_of_view_asks_for_a_tap() -> None:
    result = run(FakeBackend(3), Request(boat_seats=8, seat=1))
    assert result.rowers == []
    assert any("Seat 1 was not visible" in warning for warning in result.warnings)


def test_side_on_clip_is_one_side_on_shot() -> None:
    result = run(FakeBackend(4), Request(boat_seats=4, seat=1))
    assert [shot.kind for shot in result.shots] == [ShotKind.SIDE_ON]


def test_footage_with_no_rowers_is_reported() -> None:
    backend = FakeBackend(1)
    backend.points = [np.zeros((0, 17, 2))] * 300
    backend.scores = [np.zeros((0, 17))] * 300
    result = run(backend, Request(boat_seats=1, seat=1))
    assert result.rowers == []
    assert any("No rowers" in warning for warning in result.warnings)

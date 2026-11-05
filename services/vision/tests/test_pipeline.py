import numpy as np
import pytest
from crew import crew_detections, distant_people, two_boat_detections

from rowvision.pipeline import (
    COARSE_STEP,
    FILM_CLOSER,
    Analysis,
    Request,
    Scope,
    _boxes_for,
    analyse,
)
from rowvision.shots import ShotKind
from rowvision.skeleton import FloatArray
from rowvision.tracking import Track

FPS = 30.0


class FakeBackend:
    """Serves synthetic detections. A frame is its own index."""

    def __init__(self, seats: int = 4, *, crossing: bool | None = None) -> None:
        if crossing is None:
            self.points, self.scores = crew_detections(seats)
        else:
            self.points, self.scores = two_boat_detections(crossing=crossing)
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
    assert result.warnings == ["No rowers were found in this video."]


def tap_on(result: Analysis, index: int) -> tuple[int, float, float]:
    outline = result.boat_choices[index].outline
    assert outline is not None
    centre = (outline[:2] + outline[2:]) / 2
    return result.preview, float(centre[0]), float(centre[1])


def test_two_boats_stop_and_ask_which_is_yours() -> None:
    result = run(FakeBackend(crossing=False), Request(boat_seats=4, seat=2, boats_in_video=2))
    assert result.needs_boat_choice
    assert result.rowers == []
    assert sorted(choice.people for choice in result.boat_choices) == [2, 4]


def test_analysis_continues_on_the_tapped_boat() -> None:
    backend = FakeBackend(crossing=False)
    first = run(backend, Request(boat_seats=4, seat=2, boats_in_video=2))
    index = next(i for i, choice in enumerate(first.boat_choices) if choice.people == 4)
    request = Request(boat_seats=4, seat=2, boats_in_video=2, boat_tap=tap_on(first, index))
    result = run(backend, request)
    assert not result.needs_boat_choice
    assert result.seats_complete
    assert [rower.seat for rower in result.rowers] == [2]


def test_choosing_a_boat_too_far_away_gives_advice_and_no_scores() -> None:
    backend = FakeBackend(crossing=False)
    first = run(backend, Request(boat_seats=2, seat=1, boats_in_video=2))
    index = next(i for i, choice in enumerate(first.boat_choices) if choice.too_far)
    request = Request(boat_seats=2, seat=1, boats_in_video=2, boat_tap=tap_on(first, index))
    result = run(backend, request)
    assert result.rowers == []
    assert result.warnings == [FILM_CLOSER]


def test_only_distant_people_gives_advice_without_asking() -> None:
    backend = FakeBackend(1)
    backend.points = [distant_people(frame) for frame in range(300)]
    backend.scores = [np.full((2, 17), 0.9)] * 300
    result = run(backend, Request(boat_seats=8, seat=3))
    assert not result.needs_boat_choice
    assert result.rowers == []
    assert result.warnings == [FILM_CLOSER]


def test_unconfirmed_distant_group_does_not_trigger_a_question() -> None:
    backend = FakeBackend(4)
    for frame in range(len(backend.points)):
        backend.points[frame] = np.concatenate([backend.points[frame], distant_people(frame)])
        backend.scores[frame] = np.concatenate([backend.scores[frame], np.full((2, 17), 0.9)])
    result = run(backend, Request(boat_seats=4, seat=2))
    assert not result.needs_boat_choice
    assert [rower.seat for rower in result.rowers] == [2]


def test_saying_one_boat_when_two_are_found_still_asks() -> None:
    result = run(FakeBackend(crossing=False), Request(boat_seats=4, seat=2, boats_in_video=1))
    assert result.needs_boat_choice


def test_saying_two_boats_when_one_is_found_still_asks() -> None:
    result = run(FakeBackend(4), Request(boat_seats=4, seat=2, boats_in_video=2))
    assert result.needs_boat_choice
    assert len(result.boat_choices) == 1


def test_count_mismatch_is_kept_as_a_warning_after_choosing() -> None:
    backend = FakeBackend(4)
    first = run(backend, Request(boat_seats=4, seat=2, boats_in_video=2))
    request = Request(boat_seats=4, seat=2, boats_in_video=2, boat_tap=tap_on(first, 0))
    result = run(backend, request)
    assert any("You said 2 boat(s), but 1 were found" in warning for warning in result.warnings)


def test_too_many_rowers_for_the_boat_class_warns() -> None:
    result = run(FakeBackend(4), Request(boat_seats=2, seat=1))
    assert any("two boats may have been grouped" in warning for warning in result.warnings)


def test_frames_where_another_boat_crosses_are_dropped() -> None:
    backend = FakeBackend(crossing=True)
    first = run(backend, Request(boat_seats=4, seat=2, boats_in_video=2))
    index = next(i for i, choice in enumerate(first.boat_choices) if choice.people == 4)
    request = Request(boat_seats=4, seat=2, boats_in_video=2, boat_tap=tap_on(first, index))
    result = run(backend, request)
    assert 0 < result.overlap_share < 1
    assert any("crossed yours" in warning for warning in result.warnings)
    assert np.isnan(result.rowers[0].points[:, 5, 0]).any()


def test_boxes_are_not_interpolated_across_a_long_gap() -> None:
    points = np.full((40, 17, 2), np.nan)
    points[:10] = 100.0 + np.arange(17.0)[:, None]
    points[30:] = 500.0 + np.arange(17.0)[:, None]
    boxes = _boxes_for(Track(points, np.ones((40, 17))), 40 * COARSE_STEP)
    assert np.isfinite(boxes[5 * COARSE_STEP]).all()
    assert np.isnan(boxes[20 * COARSE_STEP]).all()
    assert np.isfinite(boxes[35 * COARSE_STEP]).all()


def test_a_crew_shares_one_stroke_timeline() -> None:
    result = run(FakeBackend(4), Request(boat_seats=4, scope=Scope.CREW))
    catches = [[stroke.catch_frame for stroke in rower.strokes] for rower in result.rowers]
    assert all(frames == catches[0] for frames in catches)
    assert len(catches[0]) >= 4


def test_small_boats_use_their_own_timing() -> None:
    result = run(FakeBackend(2), Request(boat_seats=2, seat=1))
    assert result.rowers[0].rate_spm == pytest.approx(24, abs=1)
    assert len(result.rowers[0].strokes) >= 3

import numpy as np
import pytest
from crew import crew_detections, distant_people, two_boat_detections

from rowvision.pipeline import (
    COARSE_STEP,
    FILM_CLOSER,
    Analysis,
    Request,
    RowerResult,
    Scope,
    _boxes_for,
    analyse,
    correction_views,
    measure_rower,
)
from rowvision.report import analysis_json
from rowvision.shots import ShotKind
from rowvision.skeleton import FloatArray
from rowvision.strokes import StrokeTimeline, detect_strokes, reach_signal
from rowvision.synthetic import generate
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
    run(seat, Request(boat_seats=4, seat=4))
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


def test_results_come_with_scores_and_a_rating() -> None:
    result = run(FakeBackend(4), Request(boat_seats=4, seat=2))
    rower = result.rowers[0]
    assert rower.card.overall is not None
    assert 0 <= rower.rating.accuracy <= 100
    assert rower.rating.calibrated


def test_a_measure_seen_on_too_few_strokes_is_not_reported() -> None:
    backend = FakeBackend(4)
    for people in backend.points:
        people[:, 15:17] = people[:, 9:11]
    result = run(backend, Request(boat_seats=4, seat=2))
    rower = result.rowers[0]
    assert "catch_knee_deg" not in rower.summary
    knee = next(item for item in rower.card.metrics if item.name == "catch_knee_deg")
    assert knee.score is None
    assert knee.value is None
    assert rower.summary["catch_lean_deg"] == pytest.approx(25, abs=5)


def test_a_short_clip_shows_its_angles_but_does_not_score_them() -> None:
    backend = FakeBackend(4)
    backend.points = backend.points[:170]
    backend.scores = backend.scores[:170]
    rower = run(backend, Request(boat_seats=4, seat=2)).rowers[0]
    body = next(item for item in rower.card.metrics if item.name == "catch_lean_deg")
    assert 0 < len(rower.strokes) < 3
    assert body.value is not None
    assert body.score is None
    assert "3 full strokes" in (body.reason or "")


def test_a_rower_is_timed_against_the_seat_they_follow() -> None:
    result = run(FakeBackend(4), Request(boat_seats=4, seat=1, side="bow"))
    timing = result.rowers[0].timing
    assert timing is not None
    assert timing.leader_seat == 3
    assert timing.catch_ms == pytest.approx(0, abs=70)


def test_the_stroke_seat_has_no_timing_figure() -> None:
    result = run(FakeBackend(4), Request(boat_seats=4, seat=4, side="stroke"))
    assert result.rowers[0].timing is None


def test_a_leader_out_of_view_gives_no_timing_figure() -> None:
    result = run(FakeBackend(3), Request(boat_seats=8, seat=7, side="stroke", tap=None))
    assert result.rowers[0].timing is not None
    missing = run(FakeBackend(1), Request(boat_seats=2, seat=2, side="stroke"))
    assert missing.rowers[0].timing is None


def test_crew_scope_times_every_rower_without_extra_passes() -> None:
    backend = FakeBackend(4)
    result = run(backend, Request(boat_seats=4, scope=Scope.CREW, side="stroke"))
    timed = {rower.seat: rower.timing for rower in result.rowers}
    assert timed[4] is None
    assert all(timed[seat] is not None for seat in (1, 2, 3))


def test_each_frame_gets_a_camera_angle_to_correct_by() -> None:
    views = correction_views(np.array([10.0, np.nan, 80.0]), 20.0)
    assert views.tolist() == [10.0, 20.0, 45.0]


def test_an_analysis_keeps_the_view_for_every_frame() -> None:
    result = run(FakeBackend(4), Request(boat_seats=4, seat=2))
    assert result.frame_views is not None
    assert len(result.frame_views) == result.frames
    assert np.isfinite(result.frame_views).all()


def frames_read(request: Request) -> list[int]:
    backend = FakeBackend(4)
    reads: list[int] = []

    def read(index: int) -> int:
        reads.append(index)
        return index

    analyse(read, len(backend.points), FPS, request, backend)
    return reads


def test_a_rower_and_the_rower_they_follow_are_read_in_one_pass() -> None:
    alone = frames_read(Request(boat_seats=4, seat=4))
    following = frames_read(Request(boat_seats=4, seat=2, side="stroke"))
    assert len(following) == len(alone)


def test_a_whole_crew_is_read_in_one_pass() -> None:
    alone = frames_read(Request(boat_seats=4, seat=4))
    assert len(frames_read(Request(boat_seats=4, scope=Scope.CREW))) == len(alone)


def test_a_crew_result_knows_the_athletes_own_seat() -> None:
    result = run(FakeBackend(4), Request(boat_seats=4, scope=Scope.CREW, seat=2, side="bow"))
    assert result.own_seat == 2
    assert run(FakeBackend(4), Request(boat_seats=4, seat=2)).own_seat is None


def test_each_seat_of_a_sweep_crew_is_timed_against_who_it_follows() -> None:
    result = run(FakeBackend(4), Request(boat_seats=4, scope=Scope.CREW, seat=2, side="bow"))
    followed = {rower.seat: rower.timing.leader_seat if rower.timing else None for rower in result.rowers}
    # Seat 2 is bow side, so the stroke seat is too. Seat 2 follows it, and stroke side follows 3.
    assert followed == {1: 3, 2: 4, 3: 4, 4: None}


def test_a_usual_sweep_crew_has_bow_side_following_the_seat_behind_stroke() -> None:
    result = run(FakeBackend(4), Request(boat_seats=4, scope=Scope.CREW, seat=1, side="bow"))
    followed = {rower.seat: rower.timing.leader_seat if rower.timing else None for rower in result.rowers}
    assert followed == {1: 3, 2: 4, 3: 4, 4: None}


def test_every_sculler_is_timed_against_stroke() -> None:
    result = run(FakeBackend(4), Request(boat_seats=4, scope=Scope.CREW, seat=2))
    followed = {rower.seat: rower.timing.leader_seat if rower.timing else None for rower in result.rowers}
    assert followed == {1: 4, 2: 4, 3: 4, 4: None}


def test_a_crew_report_lists_every_seat_and_puts_the_athlete_first() -> None:
    result = run(FakeBackend(4), Request(boat_seats=4, scope=Scope.CREW, seat=3))
    report = analysis_json(result)
    assert report["rower"]["seat"] == 3
    assert [seat["seat"] for seat in report["crew"]] == [1, 2, 3, 4]
    summary = report["crew_summary"]
    assert [seat["seat"] for seat in summary["seats"]] == [1, 2, 3, 4]
    assert summary["seats"][0]["leader_seat"] == 4
    assert summary["seats"][3]["catch_ms"] is None
    assert 0 <= summary["catch_lean_range_deg"] < 10
    assert summary["finish_lean_range_deg"] is not None


def test_a_sweep_crew_has_body_angles_compared_along_each_side() -> None:
    request = Request(boat_seats=4, scope=Scope.CREW, seat=3, side="bow")
    summary = analysis_json(run(FakeBackend(4), request))["crew_summary"]
    assert summary["along_sides"]
    assert summary["catch_lean_range_deg"] is not None
    sculling = analysis_json(run(FakeBackend(4), Request(boat_seats=4, scope=Scope.CREW, seat=3)))
    assert not sculling["crew_summary"]["along_sides"]


def test_a_single_rower_report_has_no_crew() -> None:
    report = analysis_json(run(FakeBackend(4), Request(boat_seats=4, seat=3)))
    assert report["rower"]["seat"] == 3
    assert report["crew"] is None
    assert report["crew_summary"] is None


def test_a_tap_on_someone_without_a_seat_still_tells_the_two_sides_apart() -> None:
    # Five people in a four: one holds no seat, as a cox would not.
    backend = FakeBackend(5)
    sides = []
    for person in backend.points[0]:
        x, y = person.mean(axis=0)
        request = Request(boat_seats=4, scope=Scope.CREW, seat=2, side="bow", tap=(0, float(x), float(y)))
        result = analyse(lambda index: index, len(backend.points), FPS, request, backend)
        sides.append({rower.seat: rower.side for rower in result.rowers})
    assert all(set(found.values()) == {"bow", "stroke"} for found in sides)


def panned_to_end_on() -> tuple[FloatArray, np.ndarray, StrokeTimeline]:
    """Ten strokes, the last six filmed from astern, where the body shows almost no lean.

    The strokes are timed before the camera moves, as a crew's shared timing would be.
    """
    clip = generate(strokes=10, facing=1, pixel_noise=0.5, seed=5)
    timeline = detect_strokes(reach_signal(clip.points, 1), FPS)
    points = clip.points.copy()
    clear = np.arange(len(points)) < len(points) * 4 // 10
    hips = points[~clear][:, [11, 12], 0].mean(axis=1)[:, None]
    points[~clear, :, 0] = hips + 0.1 * (points[~clear, :, 0] - hips)
    return points, clear, timeline


def measured(points: FloatArray, clear: np.ndarray | None, timeline: StrokeTimeline) -> RowerResult:
    frames = len(points)
    return measure_rower(
        1, points, np.full((frames, 17), 0.9), 1, 0.0, np.zeros(frames), FPS, timeline,
        trunk_px=60.0, coverage=1.0, clear=clear,
    )  # fmt: skip


def test_strokes_filmed_end_on_do_not_count_towards_body_angles() -> None:
    points, clear, timeline = panned_to_end_on()
    assert measured(points, None, timeline).summary["catch_lean_deg"] < 18
    rower = measured(points, clear, timeline)
    assert rower.summary["catch_lean_deg"] == pytest.approx(25, abs=4)
    end_on = [stroke for stroke in rower.strokes if not clear[stroke.catch_frame]]
    assert end_on and all(np.isnan(stroke.catch_lean_deg) for stroke in end_on)
    assert rower.evidence is not None and rower.evidence.strokes == len(rower.strokes) - len(end_on)


def test_a_clip_filmed_end_on_throughout_is_measured_as_before() -> None:
    points, _, timeline = panned_to_end_on()
    whole = np.zeros(len(points), dtype=bool)
    assert measured(points, whole, timeline).summary == measured(points, None, timeline).summary


def test_a_clip_with_too_few_clear_strokes_is_measured_whole() -> None:
    points, clear, timeline = panned_to_end_on()
    barely = clear & (np.arange(len(points)) < timeline.catches[2])
    assert measured(points, barely, timeline).summary == measured(points, None, timeline).summary

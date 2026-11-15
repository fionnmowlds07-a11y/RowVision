import numpy as np
import pytest
from crew import crew_detections

from rowvision.seats import assign_seats, is_rowing, seat_holding, track_at
from rowvision.tracking import Track, track_people

FPS = 30


def still_person(frames: int, x: float) -> Track:
    """A cox-like person: present throughout, with no stroke cycle."""
    points = np.zeros((frames, 17, 2))
    points[..., 0] = x + np.arange(17)
    points[..., 1] = 300 + np.arange(17) * 5
    return Track(points, np.full((frames, 17), 0.9))


@pytest.mark.parametrize("facing", [-1, 1])
def test_stroke_seat_is_the_rower_furthest_towards_the_stern(facing: int) -> None:
    tracks = track_people(*crew_detections(4, facing=facing), FPS)
    result = assign_seats(tracks, 4, FPS)
    assert result.complete
    assert result.facing == facing
    positions = [float(np.median(result.seats[seat].centre()[:, 0])) for seat in (1, 2, 3, 4)]
    assert positions == sorted(positions, reverse=facing < 0)


def test_cox_is_not_given_a_seat() -> None:
    tracks = track_people(*crew_detections(4), FPS)
    cox = still_person(len(tracks[0].points), -500)
    assert not is_rowing(cox, FPS)
    assert len(assign_seats([*tracks, cox], 4, FPS).seats) == 4


def test_missing_rowers_flag_the_numbering_as_incomplete() -> None:
    tracks = track_people(*crew_detections(3), FPS)
    result = assign_seats(tracks, 8, FPS)
    assert not result.complete
    assert sorted(result.seats) == [6, 7, 8]


def test_no_rowers_gives_an_empty_result() -> None:
    assert assign_seats([], 8, FPS).seats == {}


def test_tap_selects_the_nearest_rower() -> None:
    tracks = track_people(*crew_detections(3), FPS)
    wanted = sorted(tracks, key=lambda track: float(np.median(track.centre()[:, 0])))[1]
    tap = wanted.centre()[20] + np.array([10.0, 5.0])
    assert track_at(tracks, 20, tap) is wanted


def test_tap_on_a_frame_with_nobody_finds_no_one() -> None:
    assert track_at([], 0, np.zeros(2)) is None


def one_seat_along(tracks: list[Track], at: int) -> list[Track]:
    """Return tracks that each pick up their neighbour from frame `at`, as after a sudden zoom."""
    ordered = sorted(tracks, key=lambda track: float(np.median(track.centre()[:, 0])))
    moved = []
    for track, neighbour in zip(ordered, ordered[1:] + ordered[:1], strict=True):
        points, scores = track.points.copy(), track.scores.copy()
        points[at:], scores[at:] = neighbour.points[at:], neighbour.scores[at:]
        moved.append(Track(points, scores))
    return moved


def test_rowers_tracked_one_seat_along_are_put_back_in_their_seats() -> None:
    tracks = track_people(*crew_detections(4), FPS)
    true = assign_seats(tracks, 4, FPS).seats
    mixed = assign_seats(one_seat_along(tracks, 60), 4, FPS).seats
    for seat, track in true.items():
        np.testing.assert_array_equal(mixed[seat].points, track.points)


def test_rowers_who_keep_their_places_are_left_alone() -> None:
    tracks = track_people(*crew_detections(4), FPS)
    assert {id(track) for track in assign_seats(tracks, 4, FPS).seats.values()} == {
        id(track) for track in tracks
    }


def test_one_stray_frame_does_not_move_anyone() -> None:
    tracks = track_people(*crew_detections(4), FPS)
    stray = min(tracks, key=lambda track: float(np.median(track.centre()[:, 0])))
    stray.points[50, :, 0] += 5000
    seats = assign_seats(tracks, 4, FPS).seats
    assert any(track is stray for track in seats.values())


def test_a_seat_is_found_from_a_track_that_was_put_back() -> None:
    tracks = track_people(*crew_detections(4), FPS)
    mixed = one_seat_along(tracks, 60)
    seats = assign_seats(mixed, 4, FPS).seats
    assert [seat_holding(seats, mixed[0], frame) for frame in (20, 100)] == [4, 3]
    assert seat_holding(seats, Track(np.full_like(mixed[0].points, np.nan), mixed[0].scores), 20) is None


def test_a_crew_never_seen_whole_is_left_alone() -> None:
    tracks = track_people(*crew_detections(4), FPS)
    tracks[0].points[::2] = np.nan
    tracks[1].points[1::2] = np.nan
    seats = assign_seats(tracks, 4, FPS).seats
    assert {id(track) for track in seats.values()} == {id(track) for track in tracks}

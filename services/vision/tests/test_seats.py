import numpy as np
import pytest
from crew import crew_detections

from rowvision.seats import assign_seats, is_rowing, track_at
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

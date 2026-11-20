"""A cox beyond the bow or stroke seat is never measured as that seat's rower."""

import numpy as np

from rowvision import skeleton as sk
from rowvision.cox import beyond_neighbour, facing_backwards, seat_spacing

FRAMES = 60


def person(x: float, facing: int, frames: int = FRAMES) -> np.ndarray:
    """A seated person at `x`, trunk 50 px, nose 10 px ahead of the ears the way they face."""
    points = np.full((frames, sk.JOINT_COUNT, 2), np.nan)
    points[:, [sk.LEFT_SHOULDER, sk.RIGHT_SHOULDER]] = [x, 100.0]
    points[:, [sk.LEFT_HIP, sk.RIGHT_HIP]] = [x, 150.0]
    points[:, [sk.LEFT_EAR, sk.RIGHT_EAR]] = [x, 80.0]
    points[:, sk.NOSE] = [x + 10.0 * facing, 82.0]
    return points


def test_someone_facing_the_crew_is_taken_out_and_the_rowers_are_not() -> None:
    assert not facing_backwards(person(500, +1), facing=+1).any()
    assert facing_backwards(person(500, -1), facing=+1).all()
    assert not facing_backwards(person(500, -1), facing=0).any()


def test_one_jittery_frame_does_not_make_a_rower_a_cox() -> None:
    rower = person(500, +1)
    rower[30, sk.NOSE, 0] = 480.0
    assert not facing_backwards(rower, facing=+1).any()


def test_the_end_seat_slipping_onto_a_stern_cox_loses_only_those_frames() -> None:
    stroke = person(1000, +1)
    stroke[20:30] = person(1600, -1)[20:30]
    assert np.flatnonzero(facing_backwards(stroke, facing=+1)).tolist() == list(range(20, 30))


def test_a_cox_lying_beyond_the_bow_seat_is_too_far_from_it_to_be_a_rower() -> None:
    seats = [person(x, +1) for x in (300, 450, 600, 750)]
    spacing = seat_spacing([(p[:, sk.LEFT_SHOULDER] + p[:, sk.LEFT_HIP]) / 2 for p in seats], 50.0)
    assert spacing == 3.0
    bow = person(300, +1)
    bow[40:] = person(-100, +1)[40:]
    neighbour = (seats[1][:, sk.LEFT_SHOULDER] + seats[1][:, sk.LEFT_HIP]) / 2
    assert np.flatnonzero(beyond_neighbour(bow, neighbour, spacing)).tolist() == list(
        range(40, FRAMES)
    )


def test_with_no_spacing_to_go_on_nothing_is_taken_out() -> None:
    neighbour = np.full((FRAMES, 2), np.nan)
    assert not beyond_neighbour(person(0, +1), neighbour, float("nan")).any()
    assert np.isnan(seat_spacing([], 50.0))

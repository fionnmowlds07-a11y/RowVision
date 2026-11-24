import numpy as np
import pytest

from rowvision.identity import misplaced

SEATS = list(range(1, 9))
TRUNK = 50.0


def crew(frames: int = 20, spacing: float = 150.0, slope: float = 0.0, shrink: float = 0.0) -> list[np.ndarray]:
    """Eight rowers in a line, bow on the left. `shrink` narrows the gaps towards the stroke end, as
    a camera turned towards the stern sees them."""
    centres = []
    x = 100.0
    for seat in SEATS:
        line = np.tile([x, 500.0 + slope * x], (frames, 1))
        line[:, 0] += np.random.default_rng(seat).normal(0, 3, frames)
        centres.append(line)
        x += spacing * (1 - shrink * (seat - 1) / 7)
    return centres


def flagged(centres: list[np.ndarray]) -> np.ndarray:
    return misplaced(centres, [TRUNK] * len(centres), SEATS)


def test_a_clean_crew_is_left_alone_even_at_an_angle_and_in_perspective() -> None:
    assert not flagged(crew()).any()
    assert not flagged(crew(slope=0.4, shrink=0.45)).any()


def test_a_seat_on_a_rower_in_another_boat_is_found() -> None:
    centres = crew()
    centres[6][5:10, 1] -= 2 * TRUNK
    wrong = flagged(centres)
    assert wrong[6, 5:10].all()
    assert not wrong[:, :5].any() and not np.delete(wrong, 6, axis=0).any()


def test_seats_numbered_one_along_over_a_missing_seat_are_found() -> None:
    centres = crew()
    shifted = [line.copy() for line in centres]
    shifted[7][5:15] = centres[6][5:15]
    shifted[6][5:15] = centres[5][5:15]
    shifted[5][5:15] = np.nan
    wrong = flagged(shifted)
    assert wrong[6, 5:15].all() and wrong[7, 5:15].all()
    assert not wrong[:5].any()


def test_two_seats_on_one_rower_are_found() -> None:
    centres = crew()
    centres[7][:, 0] = centres[6][:, 0] + 20
    wrong = flagged(centres)
    assert wrong[6:].any(axis=0).all()
    assert not wrong[:5].any()


def test_too_few_seats_say_nothing() -> None:
    centres = crew()
    for line in centres[3:]:
        line[:] = np.nan
    centres[2][:, 1] -= 3 * TRUNK
    assert not flagged(centres).any()
    assert not misplaced(crew()[:3], [TRUNK] * 3, [1, 2, 3]).any()


def test_frames_on_someone_else_are_left_out_of_the_measured_seat() -> None:
    from rowvision.pipeline import COARSE_STEP, _leave_out_misplaced
    from rowvision.tracking import Track

    def person(centre: np.ndarray) -> Track:
        points = np.zeros((len(centre), 17, 2))
        points[:, [5, 6], :] = centre[:, None, :] - [0, TRUNK / 2]
        points[:, [11, 12], :] = centre[:, None, :] + [0, TRUNK / 2]
        return Track(points, np.ones((len(centre), 17)))

    centres = crew()
    centres[6][5:10, 1] -= 2 * TRUNK
    seats = {seat: person(line) for seat, line in zip(SEATS, centres, strict=True)}
    frames = 20 * COARSE_STEP
    nearest = np.minimum(np.arange(frames) // COARSE_STEP, 19)
    fine = {7: (seats[7].points[nearest].copy(), np.ones((frames, 17)))}
    clear = np.ones(frames, dtype=bool)
    shares = _leave_out_misplaced(fine, seats, nearest, clear)
    gone = ~np.isfinite(fine[7][0][:, 5, 0])
    assert gone[5 * COARSE_STEP : 10 * COARSE_STEP].all()
    assert not gone[: 4 * COARSE_STEP].any() and not gone[11 * COARSE_STEP :].any()
    assert shares[7] == pytest.approx(gone.mean())
    fine = {7: (seats[7].points[nearest].copy(), np.ones((frames, 17)))}
    assert _leave_out_misplaced(fine, seats, nearest, ~clear) == {7: 0.0}

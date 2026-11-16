import numpy as np
import pytest

from rowvision.synthetic import generate
from rowvision.timing import follow_timing, leader_seat, seat_side


@pytest.mark.parametrize(
    ("seat", "boats", "side", "leader"),
    [
        (5, 8, "stroke", 8),
        (3, 8, "bow", 7),
        (7, 8, "bow", 8),
        (8, 8, "stroke", None),
        (1, 4, "bow", 3),
        (2, 4, "stroke", 4),
        (3, 4, "bow", 4),
        (4, 4, "stroke", None),
        (1, 2, "bow", 2),
        (1, 4, "scull", 4),
        (1, 2, "scull", 2),
        (1, 1, "scull", None),
    ],
)
def test_each_seat_follows_the_right_rower(
    seat: int, boats: int, side: str, leader: int | None
) -> None:
    assert leader_seat(seat, boats, side) == leader


@pytest.mark.parametrize(
    ("seat", "side", "leader"),
    [(1, "stroke", 3), (2, "bow", 4), (3, "stroke", 4), (4, "bow", None)],
)
def test_a_boat_with_stroke_on_bow_side_still_follows_along_each_side(
    seat: int, side: str, leader: int | None
) -> None:
    assert leader_seat(seat, 4, side, stroke_side="bow") == leader


def delayed(frames: int) -> tuple[np.ndarray, np.ndarray, float]:
    clip = generate(strokes=10, rate_spm=24)
    return np.roll(clip.points, frames, axis=0), clip.points, clip.fps


def test_a_late_rower_reads_as_late() -> None:
    mine, leader, fps = delayed(3)
    timing = follow_timing(mine, leader, 8, -1, fps)
    assert timing is not None
    assert timing.catch_ms == pytest.approx(100, abs=1)
    assert timing.finish_ms == pytest.approx(100, abs=1)
    assert timing.leader_seat == 8


def test_an_early_rower_reads_as_early() -> None:
    mine, leader, fps = delayed(-2)
    timing = follow_timing(mine, leader, 8, -1, fps)
    assert timing is not None
    assert timing.catch_ms == pytest.approx(-67, abs=1)


def test_rowers_in_time_read_as_zero() -> None:
    mine, leader, fps = delayed(0)
    timing = follow_timing(mine, leader, 8, -1, fps)
    assert timing is not None
    assert timing.catch_ms == 0
    assert timing.catch_spread_ms == 0


def test_too_few_strokes_give_no_figure() -> None:
    clip = generate(strokes=2)
    assert follow_timing(clip.points, clip.points, 8, -1, clip.fps) is None


def test_no_rhythm_gives_no_figure() -> None:
    still = np.tile(generate().points[:1], (200, 1, 1))
    assert follow_timing(still, still, 8, -1, 30) is None


@pytest.mark.parametrize("seed", range(6))
def test_noise_does_not_invent_a_timing_gap(seed: int) -> None:
    """Two rowers in perfect time, with separate pose noise, must read close to zero."""
    leader = generate(strokes=10, pixel_noise=0.5, seed=seed)
    follower = generate(strokes=10, pixel_noise=0.5, seed=seed + 50)
    timing = follow_timing(follower.points, leader.points, 8, -1, leader.fps)
    assert timing is not None
    assert timing.catch_ms is not None
    assert abs(timing.catch_ms) <= 34


@pytest.mark.parametrize("frames", [2, 4])
def test_a_real_gap_survives_noise(frames: int) -> None:
    leader = generate(strokes=10, pixel_noise=1.0, seed=1)
    follower = generate(strokes=10, pixel_noise=1.0, seed=2)
    moved = np.roll(follower.points, frames, axis=0)
    timing = follow_timing(moved, leader.points, 8, -1, leader.fps)
    assert timing is not None
    assert timing.catch_ms == pytest.approx(frames / leader.fps * 1000, abs=34)


@pytest.mark.parametrize(
    ("seat", "own_seat", "own_side", "side"),
    [
        (8, 8, "stroke", "stroke"),
        (7, 8, "stroke", "bow"),
        (2, 8, "stroke", "stroke"),
        (3, 6, "bow", "stroke"),
        (4, 6, "bow", "bow"),
        (1, 2, "scull", "scull"),
        (3, None, "bow", "bow"),
        (None, 4, "stroke", "stroke"),
    ],
)
def test_sides_alternate_along_a_sweep_boat(
    seat: int | None, own_seat: int | None, own_side: str, side: str
) -> None:
    assert seat_side(seat, own_seat, own_side) == side


def test_a_gap_too_big_to_be_one_stroke_gives_no_figure() -> None:
    """Half a stroke out matches best at the edge of the search, which is no match."""
    clip = generate(strokes=10, rate_spm=24)
    half_a_stroke = round(60 * clip.fps / 24 / 2)
    mine = np.roll(clip.points, half_a_stroke, axis=0)
    assert follow_timing(mine, clip.points, 8, -1, clip.fps) is None


def test_strokes_filmed_end_on_are_not_timed_against_the_leader() -> None:
    """The second half is end-on, where the rower seems 5 frames late. Only the first half counts."""
    mine, leader, fps = delayed(0)
    half = len(mine) // 2
    mine[half:] = np.roll(leader, 5, axis=0)[half:]
    clear = np.arange(len(mine)) < half
    whole = follow_timing(mine, leader, 8, -1, fps)
    timing = follow_timing(mine, leader, 8, -1, fps, clear)
    assert whole is not None and whole.strokes > 6
    assert timing is not None and timing.catch_ms == 0
    assert timing.strokes < whole.strokes

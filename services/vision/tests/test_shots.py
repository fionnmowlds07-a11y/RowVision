from itertools import pairwise

import numpy as np
from hypothesis import given
from hypothesis import strategies as st

from rowvision.shots import ShotKind, classify_view, split_shots

FPS = 30


def test_view_classification_boundaries() -> None:
    assert classify_view(10) is ShotKind.SIDE_ON
    assert classify_view(40) is ShotKind.OBLIQUE
    assert classify_view(80) is ShotKind.END_ON
    assert classify_view(float("nan")) is ShotKind.NO_ROWING


def test_clip_that_swings_behind_the_boat_is_split() -> None:
    view = np.concatenate([np.full(120, 10.0), np.full(120, 45.0), np.full(120, 85.0)])
    assert [shot.kind for shot in split_shots(view, FPS)] == [
        ShotKind.SIDE_ON,
        ShotKind.OBLIQUE,
        ShotKind.END_ON,
    ]


def test_camera_pointing_at_the_floor_becomes_a_no_rowing_shot() -> None:
    view = np.concatenate([np.full(100, 10.0), np.full(100, np.nan), np.full(100, 10.0)])
    shots = split_shots(view, FPS)
    assert [shot.kind for shot in shots] == [ShotKind.SIDE_ON, ShotKind.NO_ROWING, ShotKind.SIDE_ON]


def test_brief_detection_flicker_does_not_split_a_shot() -> None:
    view = np.full(300, 10.0)
    view[140:146] = np.nan
    shots = split_shots(view, FPS)
    assert len(shots) == 1
    assert shots[0].kind is ShotKind.SIDE_ON


def test_empty_input_has_no_shots() -> None:
    assert split_shots(np.array([]), FPS) == []


@given(st.lists(st.one_of(st.floats(0, 90), st.just(float("nan"))), min_size=1, max_size=300))
def test_shots_always_cover_every_frame_exactly_once(values: list[float]) -> None:
    shots = split_shots(np.array(values), FPS)
    assert shots[0].start == 0
    assert shots[-1].end == len(values)
    assert all(first.end == second.start for first, second in pairwise(shots))

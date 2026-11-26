import numpy as np
from crew import crew_detections, crossing_sides_detections

from rowvision import skeleton as sk
from rowvision.metrics import angle_series
from rowvision.sides import as_one_side, crew_facing, scores_one_side, side_changes, split_at
from rowvision.strokes import facing_direction
from rowvision.synthetic import generate
from rowvision.tracking import track_people

FPS = 30


def test_a_crew_filmed_from_one_side_has_no_change() -> None:
    tracks = track_people(*crew_detections(4), FPS)
    assert side_changes(tracks, FPS) == []
    assert set(crew_facing(tracks, FPS)) == {-1.0}


def test_the_camera_crossing_to_the_other_side_is_found() -> None:
    points, scores = crossing_sides_detections()
    first = len(crew_detections(4)[0])
    changes = side_changes(track_people(points, scores, FPS), FPS)
    assert len(changes) == 1
    assert first <= changes[0] <= first + 30


def test_a_brief_look_the_other_way_is_not_a_change() -> None:
    points, scores = crossing_sides_detections(second_share=0.1)
    assert side_changes(track_people(points, scores, FPS), FPS) == []


def test_no_track_runs_across_a_change() -> None:
    points, scores = crew_detections(2)
    tracks = track_people(points, scores, FPS)
    cut = len(points) // 2
    pieces = split_at(tracks, [cut])
    assert len(pieces) == 2 * len(tracks)
    for piece in pieces:
        seen = np.isfinite(piece.points[:, 5, 0])
        assert not (seen[:cut].any() and seen[cut:].any())
    assert split_at(tracks, []) is tracks


def test_mirrored_frames_measure_the_same_as_the_frames_they_mirror() -> None:
    clip = generate(strokes=4, facing=-1)
    mirrored = clip.points[:, [0, 2, 1, 4, 3, 6, 5, 8, 7, 10, 9, 12, 11, 14, 13, 16, 15]].copy()
    mirrored[..., 0] = 1900.0 - mirrored[..., 0]
    assert facing_direction(mirrored) == 1
    flipped = np.ones(len(mirrored), dtype=bool)
    back = as_one_side(mirrored, flipped)
    assert facing_direction(back) == -1
    before, after = angle_series(clip.points, -1, 0.0), angle_series(back, -1, 0.0)
    for name in ("trunk_lean", "knee", "elbow"):
        np.testing.assert_allclose(getattr(after, name), getattr(before, name), atol=1e-6)


def test_frames_from_the_usual_side_are_left_alone() -> None:
    clip = generate(strokes=2)
    assert as_one_side(clip.points, None) is clip.points
    assert as_one_side(clip.points, np.zeros(len(clip.points), dtype=bool)) is clip.points
    half = np.arange(len(clip.points)) >= len(clip.points) // 2
    part = as_one_side(clip.points, half)
    np.testing.assert_array_equal(part[~half], clip.points[~half])
    assert not np.allclose(part[half], clip.points[half])


def test_confidences_are_named_as_the_mirrored_joints_are() -> None:
    scores = np.tile(np.arange(17, dtype=float), (3, 1))
    flipped = np.array([False, True, False])
    out = scores_one_side(scores, flipped)
    assert (out[0] == scores[0]).all()
    assert out[1, sk.LEFT_ANKLE] == sk.RIGHT_ANKLE and out[1, sk.RIGHT_KNEE] == sk.LEFT_KNEE
    assert scores_one_side(scores, None) is scores

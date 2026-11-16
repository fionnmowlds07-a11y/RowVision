import numpy as np
from crew import crew_detections, crossing_sides_detections

from rowvision.sides import crew_facing, side_changes, split_at
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

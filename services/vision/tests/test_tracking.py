import numpy as np
from crew import crew_detections

from rowvision.tracking import clean_detections, track_people

FPS = 30


def test_every_rower_gets_one_full_track() -> None:
    tracks = track_people(*crew_detections(4), FPS)
    assert len(tracks) == 4
    assert all(track.coverage == 1 for track in tracks)


def test_tracks_survive_a_fast_camera_pan() -> None:
    tracks = track_people(*crew_detections(4, drift_px=25), FPS)
    assert len(tracks) == 4


def test_duplicate_detection_is_removed() -> None:
    points, scores = crew_detections(2)
    doubled = np.concatenate([points[0], points[0][:1] + 1.0])
    doubled_scores = np.concatenate([scores[0], scores[0][:1] - 0.1])
    kept, _ = clean_detections(doubled, doubled_scores)
    assert len(kept) == 2


def test_weak_detection_is_removed() -> None:
    points, scores = crew_detections(2)
    weak = scores[0].copy()
    weak[1] = 0.1
    kept, _ = clean_detections(points[0], weak)
    assert len(kept) == 1


def test_brief_dropout_keeps_the_same_track() -> None:
    points, scores = crew_detections(3)
    for frame in range(50, 60):
        points[frame] = points[frame][:2]
        scores[frame] = scores[frame][:2]
    tracks = track_people(points, scores, FPS)
    assert len(tracks) == 3
    assert min(track.coverage for track in tracks) > 0.9


def test_frames_with_nobody_are_handled() -> None:
    points, scores = crew_detections(2)
    points[10] = np.zeros((0, 17, 2))
    scores[10] = np.zeros((0, 17))
    assert len(track_people(points, scores, FPS)) == 2

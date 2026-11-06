import numpy as np
import pytest
from crew import crew_detections, two_boat_detections

from rowvision.skeleton import FloatArray
from rowvision.tracking import Track, _zoom, clean_detections, track_people

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


def test_hidden_hips_do_not_remove_a_rower() -> None:
    points, scores = crew_detections(2)
    hidden = scores[0].copy()
    hidden[:, 11:] = 0.05
    kept, _ = clean_detections(points[0], hidden)
    assert len(kept) == 2


def test_collapsed_skeleton_is_removed() -> None:
    points, scores = crew_detections(2)
    collapsed = points[0].copy()
    collapsed[1, :, :] = collapsed[1, 0, :]
    kept, _ = clean_detections(collapsed, scores[0])
    assert len(kept) == 1


def test_weak_detection_is_removed() -> None:
    points, scores = crew_detections(2)
    weak = scores[0].copy()
    weak[1] = 0.05
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


def test_pieces_of_one_person_are_stitched_after_a_long_gap() -> None:
    points, scores = crew_detections(2)
    for frame in range(100, 150):
        points[frame] = points[frame][:1]
        scores[frame] = scores[frame][:1]
    tracks = track_people(points, scores, FPS)
    assert len(tracks) == 2


def test_small_background_rowers_do_not_break_a_large_rower_apart() -> None:
    points, scores = two_boat_detections()
    assert len(track_people(points, scores, FPS)) == 6


def zoomed_crew(ratio: float, at: int = 40) -> tuple[list[FloatArray], list[FloatArray]]:
    """Return a crew where the camera zooms by `ratio` at frame `at`, about an off-centre point."""
    points, scores = crew_detections(8)
    centre = np.array([500.0, 240.0])
    return [
        (frame - centre) * ratio + centre if index >= at else frame
        for index, frame in enumerate(points)
    ], scores


def seat_order(tracks: list[Track], frame: int) -> list[int]:
    return np.argsort([track.centre()[frame, 0] for track in tracks]).tolist()


@pytest.mark.parametrize("ratio", [0.45, 0.6, 1.6, 2.2])
def test_rowers_keep_their_tracks_through_a_zoom(ratio: float) -> None:
    points, scores = zoomed_crew(ratio)
    tracks = track_people(points, scores, FPS)
    assert len(tracks) == 8
    assert all(track.coverage == 1 for track in tracks)
    assert seat_order(tracks, 0) == seat_order(tracks, len(points) - 1)


def test_one_person_changing_size_is_not_a_zoom() -> None:
    points, scores = crew_detections(4)
    grown = [frame.copy() for frame in points]
    for frame in grown[40:]:
        middle = frame[0].mean(axis=0)
        frame[0] = (frame[0] - middle) * 1.5 + middle
    assert len(track_people(grown, scores, FPS)) >= 4


def test_a_zoom_needs_the_whole_crew_to_fit() -> None:
    before = np.column_stack([np.arange(8.0) * 100, np.full(8, 200.0)])
    sizes = np.full(8, 40.0)
    after = before * 0.5 + 30
    assert _zoom(before, sizes, after, sizes * 0.5) is not None
    assert _zoom(before, sizes, after[:4], sizes[:4] * 0.5) is None, "half the crew left the frame"
    assert _zoom(before[:4], sizes[:4], after[:4], sizes[:4] * 0.5) is None, "too few to be sure"
    assert _zoom(before, sizes, before + 5, sizes) is None, "same size is not a zoom"

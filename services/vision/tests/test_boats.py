import numpy as np
from crew import crew_detections, distant_people, two_boat_detections

from rowvision.boats import boat_at, find_boats, overlap_frames, preview_frame
from rowvision.tracking import track_people

FPS = 30


def boats_from(points: list, scores: list) -> list:
    return find_boats(track_people(points, scores, FPS), FPS)


def test_one_crew_is_one_boat() -> None:
    boats = boats_from(*crew_detections(4))
    assert [len(boat.rowers) for boat in boats] == [4]


def test_two_boats_are_kept_apart() -> None:
    boats = boats_from(*two_boat_detections())
    assert sorted(len(boat.rowers) for boat in boats) == [2, 4]


def test_distant_boat_is_marked_too_far() -> None:
    boats = boats_from(*two_boat_detections())
    assert {len(boat.rowers): boat.too_far for boat in boats} == {4: False, 2: True}


def test_tap_picks_the_boat_under_it() -> None:
    boats = boats_from(*two_boat_detections())
    frame = preview_frame(boats)
    for boat in boats:
        outline = boat.outline(frame)
        assert outline is not None
        assert boat_at(boats, frame, (outline[:2] + outline[2:]) / 2) is boat


def test_preview_shows_every_boat() -> None:
    boats = boats_from(*two_boat_detections())
    assert all(boat.outline(preview_frame(boats)) is not None for boat in boats)


def test_boats_crossing_on_screen_are_reported() -> None:
    boats = boats_from(*two_boat_detections(crossing=True))
    assert len(boats) == 2
    near = max(boats, key=lambda boat: boat.trunk_px)
    others = [boat for boat in boats if boat is not near]
    crossed = overlap_frames(near, others, len(near.seen()))
    assert 0 < crossed.sum() < len(crossed)


def test_one_boat_seen_either_side_of_a_gap_stays_one_boat() -> None:
    points, scores = crew_detections(2)
    for frame in range(170, 300):
        points[frame] = np.zeros((0, 17, 2))
        scores[frame] = np.zeros((0, 17))
    assert len(boats_from(points, scores)) == 1


def test_bystanders_do_not_create_a_boat() -> None:
    points, scores = crew_detections(2)
    still = np.tile(np.arange(17.0)[:, None] * 12 + 50, (1, 2))
    still[:, 0] += 2000
    points = [np.concatenate([people, still[None]]) for people in points]
    scores = [np.concatenate([score, np.full((1, 17), 0.9)]) for score in scores]
    assert len(boats_from(points, scores)) == 1


def test_no_people_means_no_boats() -> None:
    assert find_boats([], FPS) == []
    assert preview_frame([]) == 0


def test_distant_crew_is_listed_but_not_confirmed() -> None:
    points, scores = crew_detections(2)
    points = [np.concatenate([p, distant_people(i)]) for i, p in enumerate(points)]
    scores = [np.concatenate([s, np.full((2, 17), 0.9)]) for s in scores]
    boats = boats_from(points, scores)
    assert [boat.confirmed for boat in boats] == [True, False]
    assert boats[1].too_far


def test_a_lone_distant_person_is_not_a_boat() -> None:
    points, scores = crew_detections(2)
    points = [np.concatenate([p, distant_people(i)[:1]]) for i, p in enumerate(points)]
    scores = [np.concatenate([s, np.full((1, 17), 0.9)]) for s in scores]
    assert len(boats_from(points, scores)) == 1

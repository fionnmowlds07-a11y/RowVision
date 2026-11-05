import numpy as np
from crew import crew_detections, distant_people, two_boat_detections

from rowvision.boats import (
    boat_at,
    crew_agreement,
    find_boats,
    fit_to_seats,
    overlap_frames,
    preview_frame,
)
from rowvision.synthetic import generate
from rowvision.tracking import Track, track_people

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


def test_rower_lost_and_found_again_in_a_pan_is_one_person() -> None:
    """Seats 1 and 2 stay in view, while seat 3 vanishes and returns as a separate track."""
    points, scores = crew_detections(3)
    tracks = track_people(points, scores, FPS)
    ordered = sorted(tracks, key=lambda track: float(np.nanmedian(track.centre()[:, 0])))
    last = ordered[2]
    early, late = Track(last.points.copy(), last.scores.copy()), Track(last.points.copy(), last.scores.copy())
    early.points[225:] = np.nan
    late.points[:225] = np.nan
    boats = find_boats([ordered[0], ordered[1], early, late], FPS)
    assert len(boats[0].rowers) == 3
    assert len(boats[0].crew()) == 3


def test_neighbours_are_never_merged() -> None:
    points, scores = crew_detections(4)
    boats = boats_from(points, scores)
    assert len(boats[0].rowers) == 4


def test_seats_come_from_the_shot_with_most_of_the_crew() -> None:
    points, scores = crew_detections(4)
    tracks = track_people(points, scores, FPS)
    for track in tracks[:1]:
        track.points[:] = np.nan
    lone = Track(np.full_like(tracks[1].points, np.nan), np.zeros_like(tracks[1].scores))
    boats = find_boats(tracks[1:], FPS)
    boats[0].rowers.append(lone)
    assert len(boats[0].crew()) == 3


def split_track(track: Track, frame: int) -> list[Track]:
    early = Track(track.points.copy(), track.scores.copy())
    late = Track(track.points.copy(), track.scores.copy())
    early.points[frame:] = np.nan
    late.points[:frame] = np.nan
    return [early, late]


def test_boat_class_merges_split_tracks_down_to_the_crew() -> None:
    tracks = track_people(*crew_detections(3), FPS)
    pieces = [*tracks[:2], *split_track(tracks[2], 225)]
    assert len(fit_to_seats(pieces, 3)) == 3


def test_people_seen_together_are_never_merged_to_fit() -> None:
    tracks = track_people(*crew_detections(3), FPS)
    assert len(fit_to_seats(tracks, 2)) == 3


def out_of_time_person(frames: int) -> Track:
    """A person with a rhythm of their own, unrelated to the crew's stroke."""
    clip = generate(strokes=8, rate_spm=31, seed=4)
    return Track(clip.points[:frames].copy(), np.full((frames, 17), 0.9))


def test_crew_in_time_agrees_closely() -> None:
    tracks = track_people(*crew_detections(4), FPS)
    assert min(crew_agreement(tracks)) > 0.9


def test_person_out_of_time_is_dropped_when_the_boat_is_over_full() -> None:
    tracks = track_people(*crew_detections(4), FPS)
    extra = out_of_time_person(len(tracks[0].points))
    crew = fit_to_seats([*tracks, extra], 4)
    assert len(crew) == 4
    assert all(track is not extra for track in crew)


def test_nobody_is_dropped_when_the_crew_already_fits() -> None:
    tracks = track_people(*crew_detections(4), FPS)
    extra = out_of_time_person(len(tracks[0].points))
    assert len(fit_to_seats([*tracks[:3], extra], 4)) == 4


def test_a_uniformly_noisy_crew_keeps_everyone() -> None:
    tracks = track_people(*crew_detections(3), FPS)
    assert len(fit_to_seats(tracks, 2)) == 3


def test_agreement_needs_a_crew_to_compare_against() -> None:
    tracks = track_people(*crew_detections(2), FPS)
    assert all(np.isnan(score) for score in crew_agreement(tracks))

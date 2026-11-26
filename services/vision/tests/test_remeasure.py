import json
from typing import Any

import numpy as np
import pytest

from rowvision.pipeline import Analysis, measure_rower
from rowvision.remeasure import NoSkeleton, remeasure, saved_points, saved_views, with_sides
from rowvision.report import analysis_json
from rowvision.synthetic import generate
from rowvision.timing import FollowTiming

FPS = 30.0


def saved(strokes: int = 6, *, evidence: bool = True) -> tuple[dict[str, Any], dict[str, Any]]:
    """Return a result as the app keeps it: a summary, and frame data holding the joints."""
    clip = generate(strokes=strokes, facing=1, pixel_noise=0.5, seed=3)
    frames = len(clip.points)
    views = np.full(frames, 10.0)
    rower = measure_rower(
        3,
        clip.points,
        np.full((frames, 17), 0.9),
        1,
        10.0,
        views,
        FPS,
        trunk_px=60.0,
        coverage=0.9,
        agreement=0.8,
    )
    analysis = Analysis(FPS, frames, 1, True, 10.0, rowers=[rower], frame_views=views)
    report = json.loads(json.dumps(analysis_json(analysis)))
    report["version"] = "old"
    report["rower"]["timing"] = {
        "leader_seat": 4,
        "catch_ms": 20.0,
        "finish_ms": None,
        "catch_spread_ms": 10.0,
        "finish_spread_ms": None,
        "strokes": 5,
    }
    if not evidence:
        report["rower"]["evidence"] = None
    pulled = {"views": report.pop("views"), "poses": report["rower"].pop("poses")}
    report["rower"].pop("angles")
    return report, pulled


def test_unchanged_code_gives_the_same_measures() -> None:
    summary, frames = saved()
    again = remeasure(summary, frames)
    before, after = summary["rower"], again["rower"]
    assert after["catches"] == before["catches"]
    assert after["finishes"] == before["finishes"]
    assert len(after["strokes"]) == len(before["strokes"]) >= 4
    for old, new in zip(before["card"]["metrics"], after["card"]["metrics"], strict=True):
        assert new["name"] == old["name"]
        # Saved joints are rounded to a tenth of a pixel, which moves an angle very slightly.
        assert new["value"] == pytest.approx(old["value"], abs=0.3)
    assert after["rating"]["accuracy"] == pytest.approx(before["rating"]["accuracy"], abs=1.0)
    assert after["rate_spm"] == pytest.approx(before["rate_spm"])


def test_measuring_again_twice_changes_nothing_more() -> None:
    summary, frames = saved()
    once = remeasure(summary, frames)
    poses = once["rower"]["poses"]
    views = once["views"]
    twice = remeasure(once, {"views": views, "poses": poses})
    assert twice["rower"]["card"] == once["rower"]["card"]
    assert twice["rower"]["strokes"] == once["rower"]["strokes"]


def test_the_report_keeps_the_clip_facts_and_drops_the_old_version() -> None:
    summary, frames = saved()
    summary["warnings"] = ["Another boat crossed yours."]
    again = remeasure(summary, frames)
    assert "version" not in again
    assert again["warnings"] == ["Another boat crossed yours."]
    assert again["fps"] == FPS
    assert again["views"] == frames["views"]
    assert len(again["rower"]["poses"]) == summary["frames"]
    assert json.dumps(again, allow_nan=False)


def test_timing_against_the_leader_is_carried_over() -> None:
    summary, frames = saved()
    timing = remeasure(summary, frames)["rower"]["timing"]
    assert timing["leader_seat"] == 4
    assert timing["catch_ms"] == 20.0
    assert timing["finish_ms"] is None


def test_an_older_result_keeps_its_rating() -> None:
    summary, frames = saved(evidence=False)
    summary["rower"]["rating"] = {
        "accuracy": 61.5,
        "band": "Fair",
        "calibrated": True,
        "labelled_frames": 108,
        "warnings": ["You were only tracked for part of the video."],
    }
    again = remeasure(summary, frames)["rower"]
    assert again["rating"] == summary["rower"]["rating"]
    assert again["evidence"] is None


def test_a_result_with_no_joints_cannot_be_measured_again() -> None:
    summary, frames = saved()
    with pytest.raises(NoSkeleton):
        remeasure(summary, {"views": frames["views"], "poses": None})
    with pytest.raises(NoSkeleton):
        remeasure({**summary, "rower": None}, frames)


def test_missing_joints_and_frames_stay_missing() -> None:
    points, scores = saved_points([None, [[1.0, 2.0, 0.5], None] + [None] * 15], 3)
    assert np.isnan(points[0]).all()
    assert points[1, 0].tolist() == [1.0, 2.0]
    assert scores[1, 0] == 0.5
    assert np.isnan(points[1, 1]).all()
    assert np.isnan(points[2]).all()


def test_gaps_in_the_camera_angle_use_the_clip_figure() -> None:
    assert saved_views([5.0, None], 12.0, 2).tolist() == [5.0, 12.0]
    assert saved_views(None, None, 2).tolist() == [0.0, 0.0]


def test_a_rower_with_no_follow_timing_has_none() -> None:
    summary, frames = saved()
    summary["rower"]["timing"] = None
    assert remeasure(summary, frames)["rower"]["timing"] is None
    assert isinstance(FollowTiming(4, None, None, None, None, 0), FollowTiming)


def saved_crew() -> tuple[dict[str, Any], dict[str, Any]]:
    """Return a whole-crew result as the app keeps it, with each seat's joints in the frame data."""
    summary, frames = saved()
    seats = []
    kept: dict[str, Any] = {}
    for seat in (1, 2):
        seats.append({**summary["rower"], "seat": seat})
        kept[str(seat)] = {"poses": frames["poses"], "angles": None}
    summary["rower"] = seats[1]
    summary["crew"] = seats
    summary["crew_summary"] = {"seats": [], "catch_lean_range_deg": 99.0, "finish_lean_range_deg": None}
    return summary, {**frames, "crew": kept}


def test_every_seat_of_a_crew_is_measured_again() -> None:
    summary, frames = saved_crew()
    again = remeasure(summary, frames)
    assert [seat["seat"] for seat in again["crew"]] == [1, 2]
    assert again["rower"]["seat"] == 2
    assert all(len(seat["poses"]) == summary["frames"] for seat in again["crew"])
    assert again["crew_summary"]["catch_lean_range_deg"] == pytest.approx(0.0)
    assert [seat["seat"] for seat in again["crew_summary"]["seats"]] == [1, 2]


def test_a_crew_with_a_seat_missing_its_joints_cannot_be_measured_again() -> None:
    summary, frames = saved_crew()
    del frames["crew"]["1"]
    with pytest.raises(NoSkeleton):
        remeasure(summary, frames)


def test_a_sweep_crew_stays_compared_along_each_side_when_measured_again() -> None:
    summary, frames = saved_crew()
    assert not remeasure(summary, frames)["crew_summary"]["along_sides"]
    summary["crew_summary"]["along_sides"] = True
    again = remeasure(summary, frames)["crew_summary"]
    assert again["along_sides"]
    assert again["catch_lean_range_deg"] is None


def test_sides_are_filled_in_for_results_from_before_they_were_kept() -> None:
    summary, _ = saved()
    assert with_sides(summary, 3, "bow")["rower"]["side"] == "bow"
    crew, _ = saved_crew()
    filled = with_sides(crew, 2, "bow")
    assert [seat["side"] for seat in filled["crew"]] == ["stroke", "bow"]
    assert filled["rower"]["side"] == "bow"
    kept = with_sides({**summary, "rower": {**summary["rower"], "side": "stroke"}}, 3, "bow")
    assert kept["rower"]["side"] == "stroke"


def test_a_sweep_rower_keeps_their_side_and_the_camera_turn_when_measured_again() -> None:
    summary, frames = saved()
    turned = {**frames, "turns": [1.0] * summary["frames"]}
    again = remeasure(with_sides(summary, 3, "stroke"), turned)
    assert again["rower"]["side"] == "stroke"
    assert again["turns"] == turned["turns"]
    assert remeasure(summary, frames)["rower"]["side"] is None


def test_measuring_again_leaves_out_strokes_from_end_on_shots() -> None:
    summary, frames = saved(8)
    count = summary["frames"]
    summary["shots"] = [
        {"start": 0, "end": count // 2, "kind": "side_on"},
        {"start": count // 2, "end": count, "kind": "end_on"},
    ]
    again = remeasure(summary, frames)["rower"]
    late = [stroke for stroke in again["strokes"] if stroke["catch_frame"] >= count // 2]
    early = [stroke for stroke in again["strokes"] if stroke["catch_frame"] < count // 2]
    assert late and all(stroke["catch_lean_deg"] is None for stroke in late)
    assert early and all(stroke["catch_lean_deg"] is not None for stroke in early)


def test_a_clip_from_the_larger_model_keeps_its_unsure_legs_hidden_when_measured_again() -> None:
    summary, frames = saved()
    # The near ankle (facing right shows the right side) is unsure everywhere.
    for pose in frames["poses"]:
        if pose:
            pose[16] = [*pose[16][:2], 0.2]
    plain = remeasure(summary, frames)["rower"]
    larger = remeasure({**summary, "pose_model": "accurate"}, frames)
    assert larger["pose_model"] == "accurate"
    knee = {m["name"]: m["value"] for m in larger["rower"]["card"]["metrics"]}.get("catch_knee_deg")
    assert knee is None
    assert {m["name"]: m["value"] for m in plain["card"]["metrics"]}["catch_knee_deg"] is not None

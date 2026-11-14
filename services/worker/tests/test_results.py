import json

from rowvision_worker.engine import Video, fake_report
from rowvision_worker.results import headline, split_report


def report() -> dict:
    return fake_report(Video(path=None, fps=30.0, frames=10, width=10, height=10))  # type: ignore[arg-type]


def test_joint_positions_stay_out_of_the_kept_summary() -> None:
    summary, frames = split_report(report())
    kept = json.dumps(summary)
    assert '"poses"' not in kept
    assert '"angles"' not in kept
    assert '"views"' not in kept
    assert len(frames["poses"]) == 10


def test_the_scores_are_kept() -> None:
    summary, _ = split_report(report())
    assert summary["rower"]["card"]["overall"] == 87.0
    assert headline(summary) == (76.0, "Good", 87.0)


def test_a_clip_with_no_rower_still_splits() -> None:
    summary, frames = split_report({"rower": None, "views": None, "warnings": ["Film closer"]})
    assert headline(summary) == (None, None, None)
    assert "poses" not in frames


def test_a_crew_keeps_its_scores_and_puts_every_seats_joints_with_the_frames() -> None:
    whole = report()
    whole["crew"] = [{**whole["rower"], "seat": seat} for seat in (2, 3)]
    whole["crew_summary"] = {"seats": [], "catch_lean_range_deg": 4.0, "finish_lean_range_deg": None}
    summary, frames = split_report(whole)
    kept = json.dumps(summary)
    assert '"poses"' not in kept
    assert '"angles"' not in kept
    assert [seat["seat"] for seat in summary["crew"]] == [2, 3]
    assert summary["crew"][0]["card"]["overall"] == 87.0
    assert summary["crew_summary"]["catch_lean_range_deg"] == 4.0
    assert sorted(frames["crew"]) == ["2", "3"]
    assert len(frames["crew"]["3"]["poses"]) == 10


def test_a_single_rower_has_no_crew_in_the_frames() -> None:
    _, frames = split_report(report())
    assert "crew" not in frames

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

"""Split a report: numbers that are kept, and per-frame data that is deleted with the video."""

from typing import Any


def split_report(report: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    """Return the summary and the frame data. Joint positions must only be in the frame data."""
    summary = {key: value for key, value in report.items() if key != "views"}
    frames: dict[str, Any] = {"views": report.get("views")}
    rower = report.get("rower")
    if rower is not None:
        summary["rower"] = {k: v for k, v in rower.items() if k not in ("poses", "angles")}
        frames["poses"] = rower.get("poses")
        frames["angles"] = rower.get("angles")
    return summary, frames


def headline(summary: dict[str, Any]) -> tuple[float | None, str | None, float | None]:
    """Return accuracy, band and overall for the list of clips."""
    rower = summary.get("rower")
    if rower is None:
        return None, None, None
    return rower["rating"]["accuracy"], rower["rating"]["band"], rower["card"]["overall"]

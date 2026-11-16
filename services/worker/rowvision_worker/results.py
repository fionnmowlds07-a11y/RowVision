"""Split a report: numbers that are kept, and per-frame data that is deleted with the video."""

from typing import Any

PER_FRAME = ("poses", "angles")


def split_report(report: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    """Return the summary and the frame data. Joint positions must only be in the frame data."""
    summary = {key: value for key, value in report.items() if key not in ("views", "turns")}
    frames: dict[str, Any] = {"views": report.get("views"), "turns": report.get("turns")}
    rower = report.get("rower")
    if rower is not None:
        summary["rower"] = {k: v for k, v in rower.items() if k not in PER_FRAME}
        frames["poses"] = rower.get("poses")
        frames["angles"] = rower.get("angles")
    crew = report.get("crew")
    if crew:
        summary["crew"] = [{k: v for k, v in seat.items() if k not in PER_FRAME} for seat in crew]
        frames["crew"] = {
            str(seat["seat"]): {"poses": seat.get("poses"), "angles": seat.get("angles")} for seat in crew
        }
    return summary, frames


def headline(summary: dict[str, Any]) -> tuple[float | None, str | None, float | None]:
    """Return accuracy, band and overall for the list of clips."""
    rower = summary.get("rower")
    if rower is None:
        return None, None, None
    return rower["rating"]["accuracy"], rower["rating"]["band"], rower["card"]["overall"]

"""Estimate how accurate a result is, and say why.

Accuracy means the share of joint-angle measurements expected to fall within +/-5 degrees of the
true value. It is derived from an error model, so synthetic footage can test it directly. It stays
"uncalibrated" until it has been checked against hand-labelled real footage.
"""

import math
from dataclasses import dataclass
from enum import StrEnum

TOLERANCE_DEG = 5.0
KEYPOINT_ERROR_PX = 1.5
"""Assumed error per keypoint on real footage. To be replaced by calibration."""
VIEW_ERROR_DEG = 3.0
"""Assumed error in the estimated camera angle."""
MIN_FULL_STROKES = 5
LOW_AGREEMENT = 0.5
LOW_COVERAGE = 0.7
OBLIQUE_VIEW_DEG = 25.0


class Band(StrEnum):
    EXCELLENT = "Excellent"
    GREAT = "Great"
    GOOD = "Good"
    FAIR = "Fair"
    POOR = "Poor"


@dataclass(frozen=True)
class Evidence:
    trunk_px: float
    view_deg: float
    stroke_spread_deg: float
    """Interquartile range of trunk angle across strokes."""
    coverage: float
    """Share of the boat's frames where this rower was measured."""
    strokes: int
    crew_agreement: float | None = None


@dataclass(frozen=True)
class Rating:
    accuracy: float
    band: Band
    calibrated: bool
    warnings: list[str]


def band_for(accuracy: float) -> Band:
    if accuracy >= 90:
        return Band.EXCELLENT
    if accuracy >= 80:
        return Band.GREAT
    if accuracy >= 70:
        return Band.GOOD
    if accuracy >= 60:
        return Band.FAIR
    return Band.POOR


def angle_error_deg(trunk_px: float, keypoint_error_px: float, view_deg: float = 0.0) -> float:
    """Return the expected standard error of a trunk angle.

    The angle comes from two keypoints a trunk length apart, so their errors combine as sqrt(2).
    An off-side camera shrinks horizontal distances by cos(view), which magnifies that error once
    corrected, and adds uncertainty from the camera estimate itself.
    """
    pixel = math.degrees(math.sqrt(2) * keypoint_error_px / trunk_px)
    pixel /= max(math.cos(math.radians(view_deg)), 0.1)
    view = VIEW_ERROR_DEG * math.tan(math.radians(min(view_deg, 80.0)))
    return math.hypot(pixel, view)


def share_within_tolerance(error_deg: float) -> float:
    """Return the percentage of normally distributed errors inside the tolerance."""
    if error_deg <= 0:
        return 100.0
    return 100.0 * math.erf(TOLERANCE_DEG / (error_deg * math.sqrt(2)))


def _warnings(evidence: Evidence) -> list[str]:
    warnings = []
    if evidence.trunk_px < 30:
        warnings.append("The rower is small in the frame. Film closer for better accuracy.")
    if evidence.view_deg > OBLIQUE_VIEW_DEG:
        warnings.append(
            f"The camera is about {evidence.view_deg:.0f} degrees off side-on, "
            "so angles are less reliable. Film from directly alongside the boat."
        )
    if evidence.coverage < LOW_COVERAGE:
        warnings.append("You were only tracked for part of the video.")
    if evidence.strokes < MIN_FULL_STROKES:
        warnings.append(f"Only {evidence.strokes} full strokes were measured. Film at least 10.")
    if evidence.crew_agreement is not None and evidence.crew_agreement < LOW_AGREEMENT:
        warnings.append("Tracking did not follow the crew's rhythm well, so check your results.")
    return warnings


def rate(evidence: Evidence, *, calibrated: bool = False) -> Rating:
    """Return the estimated accuracy, its band, and what is limiting it."""
    modelled = angle_error_deg(evidence.trunk_px, KEYPOINT_ERROR_PX, evidence.view_deg)
    # Interquartile range to standard deviation, for a normal distribution.
    observed = evidence.stroke_spread_deg / 1.35
    accuracy = share_within_tolerance(max(modelled, observed))
    accuracy *= min(evidence.coverage / LOW_COVERAGE, 1.0)
    accuracy *= min(evidence.strokes / MIN_FULL_STROKES, 1.0)
    if evidence.crew_agreement is not None:
        accuracy *= min(max(evidence.crew_agreement, 0.0) / LOW_AGREEMENT, 1.0)
    return Rating(accuracy, band_for(accuracy), calibrated, _warnings(evidence))

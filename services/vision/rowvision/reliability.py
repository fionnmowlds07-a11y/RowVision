"""Estimate how accurate a result is, and say why.

Accuracy means the share of joint-angle measurements expected to fall within +/-5 degrees of the
true value. It answers only that. How much footage there is, and how well the rower was followed,
are separate questions, reported as warnings. The figure stays "uncalibrated" until the keypoint
error has been measured against enough hand-labelled real footage.
"""

import math
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path

import yaml

TOLERANCE_DEG = 5.0
ASSUMED_KEYPOINT_ERROR_PX = 1.5
"""Used until calibration replaces it. This is an assumption, not a measurement."""
MIN_MEASURED_FRAMES = 50
"""From here a measured error is better than the assumption, though not yet final."""
MIN_CALIBRATION_FRAMES = 100
CALIBRATION_FILE = Path(__file__).parent.parent / "reference" / "calibration.yaml"
VIEW_ERROR_DEG = 3.0
"""Assumed error in the estimated camera angle."""
MIN_FULL_STROKES = 5
MIN_STROKES_FOR_SPREAD = 3
LOW_AGREEMENT = 0.5
LOW_COVERAGE = 0.7
MISPLACED_WARNING = 0.05
"""From this share of frames on the wrong person, the rower is told, as the frames left near them
may be wrong too."""
OBLIQUE_VIEW_DEG = 25.0


@dataclass(frozen=True)
class Calibration:
    keypoint_error_px: float
    calibrated: bool
    labelled_frames: int = 0


def load_calibration(path: Path = CALIBRATION_FILE) -> Calibration:
    """Return the measured keypoint error, or the assumption if too few frames are labelled."""
    data = yaml.safe_load(path.read_text())
    measured = data.get("keypoint_error_px")
    frames = data.get("labelled_frames", 0)
    if measured is None or frames < MIN_MEASURED_FRAMES:
        return Calibration(ASSUMED_KEYPOINT_ERROR_PX, False)
    return Calibration(float(measured), frames >= MIN_CALIBRATION_FRAMES, frames)


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
    misplaced: float = 0.0
    """Share of this rower's frames left out because their tracking sat on someone else."""


@dataclass(frozen=True)
class Rating:
    accuracy: float
    band: Band
    calibrated: bool
    warnings: list[str]
    labelled_frames: int = 0


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
        strokes = "1 full stroke was" if evidence.strokes == 1 else f"{evidence.strokes} full strokes were"
        warnings.append(f"Only {strokes} measured. Film at least 10.")
    if evidence.misplaced >= MISPLACED_WARNING:
        warnings.append(
            f"Tracking slipped onto another rower for {evidence.misplaced:.0%} of the time you were "
            "seen. Those frames were left out, so check your results."
        )
    if evidence.crew_agreement is not None and evidence.crew_agreement < LOW_AGREEMENT:
        warnings.append("Tracking did not follow the crew's rhythm well, so check your results.")
    return warnings


def rate(evidence: Evidence, calibration: Calibration | None = None) -> Rating:
    """Return the estimated accuracy of the angles, its band, and anything else to be aware of."""
    used = calibration if calibration is not None else load_calibration()
    modelled = angle_error_deg(evidence.trunk_px, used.keypoint_error_px, evidence.view_deg)
    # Interquartile range to standard deviation, for a normal distribution. Two strokes cannot
    # show a spread, so they do not count as evidence of one.
    observed = 0.0
    if evidence.strokes >= MIN_STROKES_FOR_SPREAD:
        observed = evidence.stroke_spread_deg / 1.35
    # Frames on the wrong person are measurements of someone else. They are left out, but tracking
    # that slipped is less likely to be right around them, so the accuracy falls by their share.
    accuracy = share_within_tolerance(max(modelled, observed)) * (1.0 - min(max(evidence.misplaced, 0.0), 1.0))
    return Rating(
        accuracy, band_for(accuracy), used.calibrated, _warnings(evidence), used.labelled_frames
    )

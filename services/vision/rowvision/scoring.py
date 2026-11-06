"""Score measurements against technique targets, leaving out anything too unreliable to score."""

from dataclasses import dataclass
from enum import StrEnum

import numpy as np

from rowvision.reference import Target, Targets

MIN_STROKES = 3
ANGLE_FALLOFF_DEG = 10.0
ROUGH_GUIDE = "Shown as a rough guide. Knee angles depend on body proportions and are hard to measure."
NEEDED_FOR_OVERALL = ("catch", "finish")


class Phase(StrEnum):
    CATCH = "catch"
    DRIVE = "drive"
    FINISH = "finish"
    RHYTHM = "rhythm"


@dataclass(frozen=True)
class MetricRule:
    phase: Phase
    label: str
    falloff: float
    """How far outside the target a value scores zero."""
    max_spread: float
    """Interquartile range across strokes above which the measure is not scored."""
    scored: bool = True
    """False for a measure shown as a rough guide only."""


RULES = {
    "catch_lean_deg": MetricRule(Phase.CATCH, "Body angle at the catch", ANGLE_FALLOFF_DEG, 10.0),
    "catch_knee_deg": MetricRule(
        Phase.CATCH, "Knee angle at the catch", ANGLE_FALLOFF_DEG, 10.0, scored=False
    ),
    "legs_lead": MetricRule(Phase.DRIVE, "Legs before body", 0.2, 0.3),
    "finish_lean_deg": MetricRule(Phase.FINISH, "Layback at the finish", ANGLE_FALLOFF_DEG, 10.0),
    "finish_knee_deg": MetricRule(
        Phase.FINISH, "Knee angle at the finish", ANGLE_FALLOFF_DEG, 10.0, scored=False
    ),
    "drive_share": MetricRule(Phase.RHYTHM, "Drive and recovery rhythm", 0.1, 0.05),
}


@dataclass(frozen=True)
class MetricScore:
    name: str
    label: str
    phase: Phase
    value: float | None
    target: Target | None
    score: float | None
    """0 to 100, or None when not scored."""
    reason: str | None = None
    """Why it was not scored."""


@dataclass(frozen=True)
class ScoreCard:
    metrics: list[MetricScore]
    phases: dict[Phase, float]
    """Only phases with at least one scored measure appear."""
    overall: float | None
    """Only given when the catch and finish were both scored, so easy measures cannot stand alone."""


def score_value(value: float, target: Target, falloff: float) -> float:
    """Return 100 inside the target, falling in a straight line to 0 at `falloff` outside it."""
    distance = max(target.low - value, value - target.high, 0.0)
    return float(max(0.0, 100.0 * (1 - distance / falloff)))


def _score_metric(
    name: str,
    summary: dict[str, float],
    spread: dict[str, float],
    strokes: int,
    rate_spm: float,
    targets: Targets,
) -> MetricScore:
    rule = RULES[name]
    target = targets.for_metric(name, rate_spm)

    def skip(reason: str, value: float | None = None) -> MetricScore:
        return MetricScore(name, rule.label, rule.phase, value, target, None, reason)

    value = summary.get(name)
    if value is None or not np.isfinite(value):
        return skip("Could not be seen reliably in this video.")
    if not rule.scored:
        return skip(ROUGH_GUIDE, value)
    if strokes < MIN_STROKES:
        return skip(f"Needs at least {MIN_STROKES} full strokes.", value)
    if spread.get(name, 0.0) > rule.max_spread:
        return skip("Too inconsistent from stroke to stroke to trust.", value)
    if target is None:
        return skip("No target for this measure.", value)
    return MetricScore(
        name, rule.label, rule.phase, value, target, score_value(value, target, rule.falloff)
    )


def score_stroke(
    summary: dict[str, float],
    spread: dict[str, float],
    strokes: int,
    rate_spm: float,
    targets: Targets,
) -> ScoreCard:
    """Score a rower's median measurements. Unreliable measures are left out, not guessed."""
    metrics = [
        _score_metric(name, summary, spread, strokes, rate_spm, targets) for name in RULES
    ]
    phases: dict[Phase, float] = {}
    for phase in Phase:
        scores = [m.score for m in metrics if m.phase is phase and m.score is not None]
        if scores:
            phases[phase] = float(np.mean(scores))
    complete = all(Phase(name) in phases for name in NEEDED_FOR_OVERALL)
    overall = float(np.mean(list(phases.values()))) if complete else None
    return ScoreCard(metrics, phases, overall)

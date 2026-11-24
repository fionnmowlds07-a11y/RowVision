"""Score measurements against technique targets, leaving out anything too unreliable to score."""

from dataclasses import dataclass, field, replace
from enum import StrEnum

import numpy as np

from rowvision.reference import Target, Targets

MIN_STROKES = 3
ANGLE_FALLOFF_DEG = 10.0
ROUGH_GUIDE = "Shown as a rough guide. Knee angles depend on body proportions and are hard to measure."
SHIN_GUIDE = (
    "Shown as a rough guide. The boat often hides the ankle, so this is often 10 degrees out or more."
)
NEEDED_FOR_OVERALL = ("catch", "finish")
SHOWN_ONLY = "Shown only. There is no published target for this yet, so it is not scored."
ELBOW_GUIDE = "Shown as a rough guide. The arm is small in the picture, so this varies a lot."
TOO_INCONSISTENT = "Too inconsistent from stroke to stroke to show."


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
    "catch_shin_deg": MetricRule(
        Phase.CATCH, "Shin angle at the catch", ANGLE_FALLOFF_DEG, 10.0, scored=False
    ),
    "legs_lead": MetricRule(Phase.DRIVE, "Legs before body", 0.2, 0.3),
    "finish_lean_deg": MetricRule(Phase.FINISH, "Layback at the finish", ANGLE_FALLOFF_DEG, 10.0),
    "finish_knee_deg": MetricRule(
        Phase.FINISH, "Knee angle at the finish", ANGLE_FALLOFF_DEG, 10.0, scored=False
    ),
    "drive_share": MetricRule(Phase.RHYTHM, "Drive and recovery rhythm", 0.1, 0.05),
}


EXTRAS = {
    "catch_elbow_deg": MetricRule(Phase.CATCH, "Arms at the catch", 0.0, 15.0, scored=False),
    "arms_break": MetricRule(Phase.DRIVE, "When the arms start to bend", 0.0, 0.3, scored=False),
    "body_swing_deg": MetricRule(Phase.DRIVE, "Body swing", 0.0, 12.0, scored=False),
    "stroke_length": MetricRule(Phase.DRIVE, "Stroke length", 0.0, 0.3, scored=False),
    "finish_elbow_deg": MetricRule(Phase.FINISH, "Elbow angle at the finish", 0.0, 25.0, scored=False),
    "drive_s": MetricRule(Phase.RHYTHM, "Time on the drive", 0.0, 0.15, scored=False),
    "recovery_s": MetricRule(Phase.RHYTHM, "Time on the recovery", 0.0, 0.25, scored=False),
    "ratio": MetricRule(Phase.RHYTHM, "Recovery against drive", 0.0, 0.4, scored=False),
    "rate_steadiness": MetricRule(Phase.RHYTHM, "Rate steadiness", 0.0, float("inf"), scored=False),
}
"""Measures that are shown and never scored, as none has a published target. Each is left out when
it varies more than `max_spread` from stroke to stroke."""


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
    extras: list[MetricScore] = field(default_factory=list)
    """Measures that are shown and never scored."""


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
    if name == "catch_shin_deg":
        # The ankle wanders more than any other joint, so a shin that swings is not shown at all.
        unsteady = spread.get(name, 0.0) > rule.max_spread
        return skip(TOO_INCONSISTENT) if unsteady else skip(SHIN_GUIDE, value)
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


def _extra(name: str, summary: dict[str, float], spread: dict[str, float]) -> MetricScore:
    rule = EXTRAS[name]
    value = summary.get(name)
    if value is None or not np.isfinite(value):
        reason = "Could not be seen reliably in this video."
        return MetricScore(name, rule.label, rule.phase, None, None, None, reason)
    if spread.get(name, 0.0) > rule.max_spread:
        return MetricScore(name, rule.label, rule.phase, None, None, None, TOO_INCONSISTENT)
    reason = ELBOW_GUIDE if name == "finish_elbow_deg" else SHOWN_ONLY
    return MetricScore(name, rule.label, rule.phase, value, None, None, reason)


def _phases(metrics: list[MetricScore]) -> tuple[dict[Phase, float], float | None]:
    phases: dict[Phase, float] = {}
    for phase in Phase:
        scores = [m.score for m in metrics if m.phase is phase and m.score is not None]
        if scores:
            phases[phase] = float(np.mean(scores))
    complete = all(Phase(name) in phases for name in NEEDED_FOR_OVERALL)
    return phases, float(np.mean(list(phases.values()))) if complete else None


def without_scores(card: ScoreCard, names: set[str], reason: str) -> ScoreCard:
    """Return the card with the named measures shown but not scored, and the totals worked again."""
    metrics = [
        replace(metric, score=None, reason=reason)
        if metric.name in names and metric.score is not None
        else metric
        for metric in card.metrics
    ]
    phases, overall = _phases(metrics)
    return ScoreCard(metrics, phases, overall, card.extras)


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
    phases, overall = _phases(metrics)
    extras = [_extra(name, summary, spread) for name in EXTRAS]
    return ScoreCard(metrics, phases, overall, extras)

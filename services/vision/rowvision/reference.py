"""Load technique targets from data files, so they can be reviewed and later adjusted by coaches."""

from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import yaml

GENERAL_TARGETS = Path(__file__).parent.parent / "reference" / "general.yaml"


@dataclass(frozen=True)
class Target:
    low: float
    high: float
    sources: tuple[str, ...]
    evidence: str


@dataclass(frozen=True)
class Targets:
    status: str
    ranges: dict[str, Target] = field(default_factory=dict)
    drive_share_by_rate: dict[float, float] = field(default_factory=dict)
    drive_share_tolerance: float = 0.05
    drive_share_sources: tuple[str, ...] = ()

    def for_metric(self, name: str, rate_spm: float) -> Target | None:
        """Return the target for a metric. Drive share depends on the stroke rate."""
        if name != "drive_share":
            return self.ranges.get(name)
        rates = sorted(self.drive_share_by_rate)
        centre = float(np.interp(rate_spm, rates, [self.drive_share_by_rate[r] for r in rates]))
        spread = self.drive_share_tolerance
        return Target(centre - spread, centre + spread, self.drive_share_sources, "ergometer")


def load_targets(path: Path = GENERAL_TARGETS) -> Targets:
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    entries = data["targets"]
    drive = entries.pop("drive_share")
    ranges = {
        name: Target(
            float(entry.get("min", float("-inf"))),
            float(entry.get("max", float("inf"))),
            tuple(entry["sources"]),
            entry["evidence"],
        )
        for name, entry in entries.items()
    }
    return Targets(
        data["status"],
        ranges,
        {float(rate): float(share) for rate, share in drive["by_rate_spm"].items()},
        float(drive["tolerance"]),
        tuple(drive["sources"]),
    )

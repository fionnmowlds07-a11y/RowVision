/** Compare two results of the same rower, without reading more into a change than the footage can show. */

import { MARGIN_DEG } from "./history";
import { formatChange } from "./logic";
import type { Metric, Rower } from "./result";

export type Verdict = "nearer" | "further" | "more" | "less" | "unclear" | "same";

export type Comparison = {
  name: string;
  label: string;
  before: number | null;
  after: number | null;
  /** After minus before, or null when either is missing. */
  change: number | null;
  /** Whether the measure has a target, so a change can be called better or worse. */
  target: Metric["target"];
  verdict: Verdict | null;
};

/** Smallest change worth calling a change, by the kind of measure. Angles use the measurement margin. */
export function margin(name: string): number {
  if (name.endsWith("_deg")) return MARGIN_DEG;
  if (name === "drive_s" || name === "recovery_s") return 0.07;
  if (name === "ratio") return 0.15;
  if (name === "stroke_length") return 0.2;
  if (name === "rate_steadiness") return 2;
  return 0.05;
}

function gap(value: number, target: NonNullable<Metric["target"]>): number {
  return Math.max(target.low - value, value - (target.high ?? Infinity), 0);
}

function verdict(name: string, before: number, after: number, target: Metric["target"]): Verdict {
  const change = after - before;
  if (change === 0) return "same";
  if (Math.abs(change) < margin(name)) return "unclear";
  if (!target) return change > 0 ? "more" : "less";
  const moved = gap(before, target) - gap(after, target);
  if (moved === 0) return "same";
  return moved > 0 ? "nearer" : "further";
}

function all(rower: Rower): Metric[] {
  return [...rower.card.metrics, ...(rower.card.extras ?? [])];
}

/** One row a measure, in the later clip's order, for measures either clip has. */
export function compareRowers(before: Rower, after: Rower): Comparison[] {
  const earlier = new Map(all(before).map((metric) => [metric.name, metric]));
  const later = all(after);
  const names = new Set(later.map((metric) => metric.name));
  const rows = [...later, ...all(before).filter((metric) => !names.has(metric.name))];
  return rows.map((metric) => {
    const was = earlier.get(metric.name)?.value ?? null;
    const now = names.has(metric.name) ? metric.value : null;
    const both = was !== null && now !== null;
    return {
      name: metric.name,
      label: metric.label,
      before: was,
      after: now,
      change: both ? now - was : null,
      target: metric.target,
      verdict: both ? verdict(metric.name, was, now, metric.target) : null,
    };
  });
}

/** The change in the overall score, or null when either clip has none. Small changes are not called. */
export const OVERALL_MARGIN = 5;

export function compareOverall(before: Rower, after: Rower): { change: number; clear: boolean } | null {
  const was = before.card.overall;
  const now = after.card.overall;
  if (was === null || now === null) return null;
  return { change: now - was, clear: Math.abs(now - was) >= OVERALL_MARGIN };
}

/** A few plain words for a row's verdict. */
export function verdictText(row: Pick<Comparison, "name" | "change" | "verdict">): string {
  if (row.verdict === null) return "Not in both clips";
  if (row.verdict === "same") return "Same";
  if (row.verdict === "unclear") return "Too close to call";
  if (row.verdict === "nearer") return "Nearer the target";
  if (row.verdict === "further") return "Further from the target";
  return formatChange(row.name, row.change);
}

/** Rhythm depends on the rate, so two clips at different rates are not like for like. */
export const RATE_MARGIN = 2;

export function ratesDiffer(before: Rower, after: Rower): boolean {
  if (before.rate_spm === null || after.rate_spm === null) return false;
  return Math.abs(before.rate_spm - after.rate_spm) > RATE_MARGIN;
}

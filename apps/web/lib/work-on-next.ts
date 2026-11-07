import { formatTarget, formatValue } from "./logic";
import type { Metric, Rower } from "./result";

const MAX_ITEMS = 3;
const FILMING_ADVICE = "Film from directly alongside the boat, with the rower large in the frame.";

export type Advice = { kind: "technique" | "filming" | "on_target"; items: { text: string; measure?: string }[] };

function gapText(gap: number): string {
  return `${Math.max(Math.round(gap), 1)}°`;
}

function wording(metric: Metric): string {
  const { name, label, value, target } = metric;
  const low = target!.low;
  const high = target!.high ?? Infinity;
  const v = value!;
  if (name === "catch_lean_deg") {
    return v < low
      ? `Your body angle at the catch is ${gapText(low - v)} short of the target.`
      : `Your body angle at the catch is ${gapText(v - high)} past the target.`;
  }
  if (name === "finish_lean_deg") {
    return v > high
      ? `Your layback at the finish is ${gapText(v - high)} short of the target.`
      : `Your layback at the finish is ${gapText(low - v)} past the target.`;
  }
  if (name === "legs_lead") return "Your body opens before your legs have started. Aim for legs first.";
  if (name === "drive_share") {
    return `Your drive takes ${formatValue(name, v)} of the stroke. The target at this rate is ${formatTarget(name, target)}.`;
  }
  return `${label}: you ${formatValue(name, v)}, target ${formatTarget(name, target)}.`;
}

/** The scored measures losing the most points, or filming advice when the footage can't be trusted. */
export function workOnNext(rower: Pick<Rower, "card" | "rating">): Advice {
  if (rower.rating.band === "Poor") {
    const notes = rower.rating.warnings.slice(0, MAX_ITEMS);
    const items = (notes.length ? notes : [FILMING_ADVICE]).map((text) => ({ text }));
    return { kind: "filming", items };
  }
  const losing = rower.card.metrics
    .filter((metric) => metric.score !== null && metric.score < 100 && metric.value !== null && metric.target !== null)
    .sort((a, b) => a.score! - b.score!)
    .slice(0, MAX_ITEMS);
  if (losing.length === 0) return { kind: "on_target", items: [{ text: "Everything scored here is on target." }] };
  return { kind: "technique", items: losing.map((metric) => ({ text: wording(metric), measure: metric.name })) };
}

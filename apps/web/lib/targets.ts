/**
 * The athlete's own technique targets: the range for each body angle, and whether it counts towards the score.
 *
 * The general standard is in `services/vision/reference/general.yaml`. The numbers here must match it, and
 * a test checks they do. The engine always scores with the general standard. These choices are applied when a
 * clip is read, from the measurements saved with it, so changing them needs no new analysis.
 */

import type { Metric, Rower } from "./result";

export type TargetName = "catch_lean_deg" | "finish_lean_deg" | "catch_knee_deg" | "finish_knee_deg";
export type TargetChoice = { low: number; high: number; counts: boolean };
export type TargetChoices = Record<TargetName, TargetChoice>;

/** A range can be this wide at most, so a score still tells good from very good. */
export const MAX_WIDTH = 5;
/** A body angle loses all its points this far outside the range, as in the engine. */
const FALLOFF_DEG = 10;
/** The engine does not score a measure that varies more than this from stroke to stroke. */
const MAX_SPREAD_DEG = 10;
const MIN_STROKES = 3;

export const TARGET_METRICS: { name: TargetName; label: string; help: string; phase: "catch" | "finish"; min: number; max: number }[] = [
  { name: "catch_lean_deg", label: "Body angle at the catch", help: "Trunk from vertical, forward is positive", phase: "catch", min: 0, max: 60 },
  { name: "finish_lean_deg", label: "Body angle at the finish", help: "Leaning back is negative", phase: "finish", min: -50, max: 10 },
  { name: "catch_knee_deg", label: "Knee angle at the catch", help: "Inner angle, 180 is a straight leg. The boat often hides the feet, so this is partly a guess", phase: "catch", min: 20, max: 100 },
  { name: "finish_knee_deg", label: "Knee angle at the finish", help: "Inner angle, 180 is a straight leg. The boat often hides the feet, so this is partly a guess", phase: "finish", min: 120, max: 185 },
];

/** Knees are shown as a rough guide until the athlete chooses to count them. */
export const GENERAL_TARGETS: TargetChoices = {
  catch_lean_deg: { low: 26, high: 31, counts: true },
  finish_lean_deg: { low: -25, high: -20, counts: true },
  catch_knee_deg: { low: 50, high: 55, counts: false },
  finish_knee_deg: { low: 175, high: 180, counts: false },
};

export function sameChoices(a: TargetChoices, b: TargetChoices): boolean {
  return TARGET_METRICS.every(({ name }) => a[name].low === b[name].low && a[name].high === b[name].high && a[name].counts === b[name].counts);
}

/** Says in plain words what is wrong with a range, or null when it is fine. */
export function rangeProblem(name: TargetName, low: number, high: number): string | null {
  const metric = TARGET_METRICS.find((item) => item.name === name);
  if (!metric || !Number.isFinite(low) || !Number.isFinite(high)) return "Type a number.";
  if (low < metric.min || high > metric.max) return `Keep it between ${metric.min}° and ${metric.max}°.`;
  if (high <= low) return "The top must be above the bottom.";
  if (high - low > MAX_WIDTH) return `Wider than ${MAX_WIDTH}° makes scores too easy. Narrow it to ${MAX_WIDTH}° or less.`;
  return null;
}

/** Says why the overall score cannot be given with these choices, or null. */
export function overallProblem(choices: TargetChoices): string | null {
  const on = (phase: string) => TARGET_METRICS.some((metric) => metric.phase === phase && choices[metric.name].counts);
  return on("catch") && on("finish") ? null : "The overall score needs at least one catch measure and one finish measure to count.";
}

/** Saved choices that are not all valid are dropped, and the general standard is used. */
export function cleanTargets(value: unknown): TargetChoices | null {
  if (!value || typeof value !== "object") return null;
  const saved = value as Record<string, unknown>;
  const result = {} as TargetChoices;
  for (const { name } of TARGET_METRICS) {
    const item = saved[name];
    if (!item || typeof item !== "object") return null;
    const { low, high, counts } = item as Record<string, unknown>;
    if (typeof low !== "number" || typeof high !== "number" || typeof counts !== "boolean") return null;
    if (rangeProblem(name, low, high) !== null) return null;
    result[name] = { low, high, counts };
  }
  return result;
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function choose(metric: Metric, choice: TargetChoice, strokes: number): Metric {
  const target = metric.target ? { ...metric.target, low: choice.low, high: choice.high } : null;
  const kept = { ...metric, target };
  if (metric.value === null) return kept;
  if (!choice.counts) {
    const reason = metric.score === null && metric.reason ? metric.reason : "Shown only. It does not count towards your score.";
    return { ...kept, score: null, reason };
  }
  if (strokes < MIN_STROKES) return { ...kept, score: null, reason: `Needs at least ${MIN_STROKES} full strokes.` };
  if ((metric.spread ?? 0) > MAX_SPREAD_DEG) return { ...kept, score: null, reason: "Too inconsistent from stroke to stroke to trust." };
  const distance = Math.max(choice.low - metric.value, metric.value - choice.high, 0);
  return { ...kept, score: Math.max(0, 100 * (1 - distance / FALLOFF_DEG)), reason: null };
}

/** The rower as the athlete's choices would have scored them. The measurements themselves never change. */
export function rescore(rower: Rower, choices: TargetChoices | null): Rower {
  if (!choices || sameChoices(choices, GENERAL_TARGETS)) return rower;
  const metrics = rower.card.metrics.map((metric) => {
    const choice = (choices as Record<string, TargetChoice>)[metric.name];
    return choice ? choose(metric, choice, rower.strokes.length) : metric;
  });
  const phases: Record<string, number | null> = {};
  for (const phase of new Set(metrics.map((metric) => metric.phase))) {
    const average = mean(metrics.filter((metric) => metric.phase === phase && metric.score !== null).map((metric) => metric.score as number));
    if (average !== null) phases[phase] = average;
  }
  const complete = phases.catch !== undefined && phases.finish !== undefined;
  const overall = complete ? mean(Object.values(phases) as number[]) : null;
  return { ...rower, card: { overall, phases, metrics } };
}

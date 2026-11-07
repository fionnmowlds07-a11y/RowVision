import type { Metric } from "./result";
import type { JobState } from "./waiting";

export const TREND_MINIMUM = 3;
/** The typical gap between a measured and a hand-labelled body angle, from docs/research. */
export const MARGIN_DEG = 5;
const TRUSTED = new Set(["Good", "Great", "Excellent"]);

export type ClipResult = {
  band: string | null;
  accuracy: number | null;
  overall: number | null;
  code_version: string;
  created_at: string;
  summary?: { rower?: { rate_spm?: number | null; card?: { metrics?: Pick<Metric, "name" | "value">[] } } | null };
};

export type ClipRow = {
  id: string;
  filmed_at: string | null;
  created_at: string;
  jobs: { state: JobState; created_at: string }[];
  results: ClipResult[];
};

export function latest<T extends { created_at: string }>(items: T[]): T | null {
  return items.reduce<T | null>((best, item) => (!best || item.created_at > best.created_at ? item : best), null);
}

/** A Poor score stays hidden in the list too. */
export function clipStatus(state: JobState | undefined, result: ClipResult | null): { text: string; score: string | null } {
  if (state === "uploading") return { text: "Uploading", score: null };
  if (state === "queued") return { text: "In the queue", score: null };
  if (state === "running") return { text: "Being analysed", score: null };
  if (state === "needs_tap") return { text: "Needs a tap from you", score: null };
  if (state === "failed") return { text: "Couldn't be analysed", score: null };
  if (state === "cancelled") return { text: "Cancelled", score: null };
  if (!result?.band) return { text: "No scores. Film closer next time", score: null };
  const accuracy = `Accuracy ${Math.round(result.accuracy ?? 0)}% ${result.band}`;
  if (result.band === "Poor") return { text: `${accuracy}, score hidden`, score: null };
  return { text: accuracy, score: result.overall === null ? null : String(Math.round(result.overall)) };
}

export function isOlder(result: { code_version: string }, current: string | null): boolean {
  return current !== null && result.code_version !== current;
}

export type TrendPoint = { when: string; catchLean: number | null; layback: number | null; overall: number | null; older: boolean };

function value(result: ClipResult, name: string): number | null {
  return result.summary?.rower?.card?.metrics?.find((metric) => metric.name === name)?.value ?? null;
}

/** Only clips rated Good or better count, as the rest would add noise that reads as real change. */
export function trendPoints(clips: ClipRow[], current: string | null): TrendPoint[] {
  const points = clips.flatMap((clip) => {
    const result = latest(clip.results);
    if (!result?.band || !TRUSTED.has(result.band)) return [];
    const layback = value(result, "finish_lean_deg");
    return [{
      when: clip.filmed_at ?? clip.created_at,
      catchLean: value(result, "catch_lean_deg"),
      layback: layback === null ? null : Math.abs(layback),
      overall: result.overall,
      older: isOlder(result, current),
    }];
  });
  return points.sort((a, b) => a.when.localeCompare(b.when));
}

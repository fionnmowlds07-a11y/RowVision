/** Each stroke of a clip, measure by measure, for the stroke-by-stroke charts and table. */

import { formatChange } from "./logic";
import type { Rower, Target } from "./result";

export type StrokePoint = { stroke: number; frame: number; value: number | null };

export type StrokeSeries = {
  name: string;
  label: string;
  points: StrokePoint[];
  target: Target | null;
  /** The second half's median minus the first half's, or null on a short clip. */
  fade: number | null;
};

/** The measures charted, in order. Rate is worked out here, from the frames between catches. */
export const CHARTED: { name: string; label: string }[] = [
  { name: "catch_lean_deg", label: "Body angle at the catch" },
  { name: "finish_lean_deg", label: "Layback at the finish" },
  { name: "body_swing_deg", label: "Body swing" },
  { name: "drive_s", label: "Time on the drive" },
  { name: "rate_spm", label: "Rate" },
];

function rateOf(stroke: Record<string, number | null>, fps: number): number | null {
  const next = stroke.next_catch_frame;
  if (next === null || next === undefined || next <= stroke.catch_frame!) return null;
  return (60 * fps) / (next - stroke.catch_frame!);
}

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** As the engine works out fade: 6 strokes or more, and 3 known values in each half. */
export function halfChange(values: (number | null)[]): number | null {
  if (values.length < 6) return null;
  const middle = Math.floor(values.length / 2);
  const known = (part: (number | null)[]) => part.filter((value): value is number => value !== null);
  const early = known(values.slice(0, middle));
  const late = known(values.slice(middle));
  if (early.length < 3 || late.length < 3) return null;
  return median(late) - median(early);
}

/** One series a charted measure, leaving out any the clip has no values for. */
export function strokeSeries(rower: Pick<Rower, "strokes" | "card" | "fade">, fps: number): StrokeSeries[] {
  const targets = new Map(rower.card.metrics.map((metric) => [metric.name, metric.target]));
  return CHARTED.flatMap(({ name, label }) => {
    const points = rower.strokes.map((stroke, index) => ({
      stroke: index + 1,
      frame: name.startsWith("finish") ? stroke.finish_frame : stroke.catch_frame,
      value: name === "rate_spm" ? rateOf(stroke, fps) : stroke[name] ?? null,
    }));
    if (!points.some((point) => point.value !== null)) return [];
    const saved = rower.fade?.[name];
    const fade = saved ?? halfChange(points.map((point) => point.value));
    return [{ name, label, points, target: targets.get(name) ?? null, fade }];
  });
}

export function formatStroke(name: string, value: number | null): string {
  if (value === null) return "–";
  if (name === "rate_spm") return String(Math.round(value));
  if (name === "drive_s") return `${value.toFixed(2)} s`;
  return `${Math.round(Math.abs(value))}°`;
}

/** What the second half did against the first, in a few words, or null when the clip is too short to say. */
export function fadeText(name: string, fade: number | null): string | null {
  if (fade === null) return null;
  if (name === "rate_spm") return Math.abs(fade) < 0.5 ? "Steady" : `Second half: ${Math.round(Math.abs(fade))} ${fade > 0 ? "higher" : "lower"}`;
  const change = formatChange(name, fade);
  return change === "same" ? "Steady" : `Second half: ${change}`;
}

export function outsideTarget(value: number | null, target: Target | null): boolean {
  if (value === null || !target) return false;
  return value < target.low || (target.high !== null && value > target.high);
}

export type Plot = {
  dots: { x: number; y: number; point: StrokePoint }[];
  /** The target band's top and height, or null when it has no target or the target is off the chart. */
  band: { y: number; height: number } | null;
  low: number;
  high: number;
};

/** Place a series in a box, with the target band on the same scale. Strokes with no value leave a gap. `left` leaves room for the scale's labels. */
export function plot(series: StrokeSeries, width: number, height: number, pad: number, left = pad): Plot {
  const known = series.points.filter((point) => point.value !== null);
  const values = known.map((point) => point.value as number);
  const { target } = series;
  const ends = target ? [target.low, target.high ?? target.low] : [];
  let low = Math.min(...values, ...ends);
  let high = Math.max(...values, ...ends);
  if (high - low < 1e-9) {
    low -= 1;
    high += 1;
  }
  const last = Math.max(series.points.length - 1, 1);
  const x = (index: number) => left + (index / last) * (width - left - pad);
  const y = (value: number) => height - pad - ((value - low) / (high - low)) * (height - 2 * pad);
  const dots = series.points.flatMap((point, index) => (point.value === null ? [] : [{ x: x(index), y: y(point.value), point }]));
  const top = target ? y(target.high ?? high) : 0;
  const band = target ? { y: top, height: Math.max(y(target.low) - top, 2) } : null;
  return { dots, band, low, high };
}

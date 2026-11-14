import { expect, test } from "vitest";
import type { Rower, Stroke } from "@/lib/result";
import { fadeText, formatStroke, halfChange, outsideTarget, plot, strokeSeries } from "@/lib/strokes";

const TARGET = { low: 26, high: 31, sources: [], evidence: "ergometer" };

function stroke(index: number, values: Record<string, number | null>): Stroke {
  return { catch_frame: index * 80, finish_frame: index * 80 + 30, next_catch_frame: index * 80 + 80, ...values } as Stroke;
}

function rower(strokes: Stroke[], fade?: Record<string, number | null>): Pick<Rower, "strokes" | "card" | "fade"> {
  const metric = { name: "catch_lean_deg", label: "Body angle at the catch", phase: "catch", value: 28, spread: 1, target: TARGET, score: 100, reason: null };
  return { strokes, fade, card: { overall: 90, phases: {}, metrics: [metric] } };
}

const SIX = [29, 28, 29, 26, 25, 24].map((lean, index) => stroke(index, { catch_lean_deg: lean, finish_lean_deg: -22, drive_s: 1.1 }));

test("each charted measure the clip has gets a series, with its target", () => {
  const series = strokeSeries(rower(SIX), 30);
  expect(series.map((item) => item.name)).toEqual(["catch_lean_deg", "finish_lean_deg", "drive_s", "rate_spm"]);
  expect(series[0].target).toEqual(TARGET);
  expect(series[1].target).toBeNull();
  expect(series[0].points[3]).toEqual({ stroke: 4, frame: 240, value: 26 });
});

test("a finish measure points at the finish frame", () => {
  expect(strokeSeries(rower(SIX), 30)[1].points[0].frame).toBe(30);
});

test("rate comes from the frames between catches", () => {
  const rate = strokeSeries(rower(SIX), 30).find((item) => item.name === "rate_spm")!;
  expect(rate.points[0].value).toBeCloseTo(22.5);
});

test("fade is the engine's figure when it gave one, and worked out here when it didn't", () => {
  expect(strokeSeries(rower(SIX, { catch_lean_deg: -9 }), 30)[0].fade).toBe(-9);
  expect(strokeSeries(rower(SIX), 30)[0].fade).toBe(-4);
});

test("a short clip, or one with too few known strokes, has no fade", () => {
  expect(halfChange([1, 2, 3, 4, 5])).toBeNull();
  expect(halfChange([1, null, null, 4, 5, 6])).toBeNull();
  expect(halfChange([1, 2, 3, 4, 5, 6])).toBe(3);
});

test("fade reads in a few plain words", () => {
  expect(fadeText("catch_lean_deg", -3.2)).toBe("Second half: 3° less");
  expect(fadeText("catch_lean_deg", 0.2)).toBe("Steady");
  expect(fadeText("rate_spm", 1.6)).toBe("Second half: 2 higher");
  expect(fadeText("rate_spm", -0.2)).toBe("Steady");
  expect(fadeText("drive_s", null)).toBeNull();
});

test("stroke values read without their direction", () => {
  expect(formatStroke("finish_lean_deg", -22.4)).toBe("22°");
  expect(formatStroke("drive_s", 1.114)).toBe("1.11 s");
  expect(formatStroke("rate_spm", 22.5)).toBe("23");
  expect(formatStroke("catch_lean_deg", null)).toBe("–");
});

test("a value is only outside a target it has", () => {
  expect(outsideTarget(24, TARGET)).toBe(true);
  expect(outsideTarget(28, TARGET)).toBe(false);
  expect(outsideTarget(24, null)).toBe(false);
  expect(outsideTarget(null, TARGET)).toBe(false);
  expect(outsideTarget(40, { ...TARGET, high: null })).toBe(false);
});

test("dots and the target band share one scale and stay inside the box", () => {
  const [series] = strokeSeries(rower(SIX), 30);
  const drawn = plot(series, 320, 80, 10);
  expect(drawn.dots).toHaveLength(6);
  expect(drawn.dots[0].x).toBe(10);
  expect(drawn.dots[5].x).toBe(310);
  expect(drawn.low).toBe(24);
  expect(drawn.high).toBe(31);
  expect(drawn.band!.y).toBe(10);
  expect(drawn.band!.y + drawn.band!.height).toBeCloseTo(80 - 10 - (2 / 7) * 60);
  for (const dot of drawn.dots) expect(dot.y).toBeGreaterThanOrEqual(10);
  for (const dot of drawn.dots) expect(dot.y).toBeLessThanOrEqual(70);
});

test("a stroke with no value leaves a gap, and a flat series still draws", () => {
  const strokes = [28, null, 28].map((lean, index) => stroke(index, { catch_lean_deg: lean }));
  const flat = rower(strokes);
  flat.card.metrics = [];
  const drawn = plot(strokeSeries(flat, 30)[0], 320, 80, 10);
  expect(drawn.dots.map((dot) => dot.point.stroke)).toEqual([1, 3]);
  expect(drawn.band).toBeNull();
  expect(drawn.dots[0].y).toBe(40);
});

test("room can be left for the scale's labels", () => {
  const drawn = plot(strokeSeries(rower(SIX), 30)[0], 320, 80, 10, 40);
  expect(drawn.dots[0].x).toBe(40);
  expect(drawn.dots[5].x).toBe(310);
});

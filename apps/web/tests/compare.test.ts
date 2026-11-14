import { expect, test } from "vitest";
import { compareOverall, compareRowers, margin } from "@/lib/compare";
import type { Metric, Rower } from "@/lib/result";

const TARGET = { low: 26, high: 31, sources: [], evidence: "ergometer" };

function metric(name: string, value: number | null, target: Metric["target"] = null): Metric {
  return { name, label: name, phase: "catch", value, spread: 1, target, score: null, reason: null };
}

function rower(metrics: Metric[], extras: Metric[] = [], overall: number | null = 80): Rower {
  return {
    seat: 2, rate_spm: 22, catches: [], finishes: [], strokes: [], timing: null,
    card: { overall, phases: {}, metrics, extras },
    rating: { accuracy: 75, band: "Good", calibrated: true, labelled_frames: 108, warnings: [] },
  };
}

const row = (before: Rower, after: Rower, name: string) => compareRowers(before, after).find((item) => item.name === name)!;

test("a change inside the measurement margin is not called", () => {
  const found = row(rower([metric("catch_lean_deg", 22, TARGET)]), rower([metric("catch_lean_deg", 25, TARGET)]), "catch_lean_deg");
  expect(found.change).toBe(3);
  expect(found.verdict).toBe("unclear");
});

test("a clear change towards the target is nearer, and away from it further", () => {
  const near = row(rower([metric("catch_lean_deg", 18, TARGET)]), rower([metric("catch_lean_deg", 27, TARGET)]), "catch_lean_deg");
  const far = row(rower([metric("catch_lean_deg", 30, TARGET)]), rower([metric("catch_lean_deg", 40, TARGET)]), "catch_lean_deg");
  expect(near.verdict).toBe("nearer");
  expect(far.verdict).toBe("further");
});

test("moving from one side of the target to the same distance on the other is the same", () => {
  const found = row(rower([metric("catch_lean_deg", 20, TARGET)]), rower([metric("catch_lean_deg", 37, TARGET)]), "catch_lean_deg");
  expect(found.verdict).toBe("same");
});

test("a measure with no target only says more or less", () => {
  const before = rower([], [metric("body_swing_deg", 38)]);
  expect(row(before, rower([], [metric("body_swing_deg", 49)]), "body_swing_deg").verdict).toBe("more");
  expect(row(before, rower([], [metric("body_swing_deg", 30)]), "body_swing_deg").verdict).toBe("less");
  expect(row(before, rower([], [metric("body_swing_deg", 38)]), "body_swing_deg").verdict).toBe("same");
});

test("a measure only one clip has is listed with no verdict", () => {
  const old = rower([metric("catch_lean_deg", 25, TARGET)]);
  old.card.extras = undefined;
  const rows = compareRowers(old, rower([metric("catch_lean_deg", 25, TARGET)], [metric("ratio", 1.4)]));
  expect(rows.map((item) => item.name)).toEqual(["catch_lean_deg", "ratio"]);
  expect(rows[1]).toMatchObject({ before: null, after: 1.4, change: null, verdict: null });
  const gone = compareRowers(rower([metric("catch_knee_deg", 60)]), rower([metric("catch_lean_deg", null, TARGET)]));
  expect(gone.map((item) => item.name)).toEqual(["catch_lean_deg", "catch_knee_deg"]);
  expect(gone[1]).toMatchObject({ before: 60, after: null, verdict: null });
});

test("each kind of measure has its own margin", () => {
  expect(margin("finish_lean_deg")).toBe(5);
  expect(margin("drive_s")).toBeLessThan(0.1);
  expect(margin("ratio")).toBeGreaterThan(margin("legs_lead"));
});

test("a small change in the overall score is not called", () => {
  expect(compareOverall(rower([], [], 84), rower([], [], 90))).toEqual({ change: 6, clear: true });
  expect(compareOverall(rower([], [], 84), rower([], [], 87))).toEqual({ change: 3, clear: false });
  expect(compareOverall(rower([], [], null), rower([], [], 87))).toBeNull();
});

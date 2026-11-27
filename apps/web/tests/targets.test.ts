import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Metric, Rower } from "@/lib/result";
import { GENERAL_TARGETS, TARGET_METRICS, cleanTargets, overallProblem, rangeProblem, rescore, type TargetChoices } from "@/lib/targets";

function metric(name: string, phase: string, value: number | null, low: number, high: number, score: number | null, extra: Partial<Metric> = {}): Metric {
  return { name, label: name, phase, value, spread: 2, target: { low, high, sources: [], evidence: "" }, score, reason: null, ...extra };
}

function rower(strokes = 12): Rower {
  return {
    strokes: Array.from({ length: strokes }, () => ({ catch_frame: 0, finish_frame: 1 })),
    card: {
      overall: 85,
      phases: { catch: 90, finish: 80 },
      metrics: [
        metric("catch_lean_deg", "catch", 39, 26, 31, 20),
        metric("finish_lean_deg", "finish", -22, -25, -20, 100),
        metric("catch_knee_deg", "catch", 58, 50, 55, null, { reason: "Shown as a rough guide." }),
        metric("finish_knee_deg", "finish", 172, 175, 180, null, { reason: "Shown as a rough guide." }),
        metric("drive_share", "rhythm", 0.43, 0.4, 0.5, 100),
      ],
    },
  } as unknown as Rower;
}

const mine = (change: Partial<TargetChoices>): TargetChoices => ({ ...GENERAL_TARGETS, ...change });
const found = (r: Rower, name: string) => r.card.metrics.find((item) => item.name === name)!;

describe("general targets", () => {
  it("match the reference file the engine reads", () => {
    const yaml = readFileSync(path.join(import.meta.dirname, "../../../services/vision/reference/general.yaml"), "utf8");
    for (const { name } of TARGET_METRICS) {
      const block = yaml.split(`  ${name}:`)[1]!.split("sources:")[0]!;
      const low = Number(/min:\s*(-?\d+)/.exec(block)![1]);
      const high = Number(/max:\s*(-?\d+)/.exec(block)![1]);
      expect([name, GENERAL_TARGETS[name].low, GENERAL_TARGETS[name].high]).toEqual([name, low, high]);
    }
  });
});

describe("rescore", () => {
  it("leaves the result alone for the general standard or no choices", () => {
    const original = rower();
    expect(rescore(original, null)).toBe(original);
    expect(rescore(original, GENERAL_TARGETS)).toBe(original);
  });

  it("scores again against a moved range, with the measurement unchanged", () => {
    const result = rescore(rower(), mine({ catch_lean_deg: { low: 36, high: 40, counts: true } }));
    expect(found(result, "catch_lean_deg").score).toBe(100);
    expect(found(result, "catch_lean_deg").value).toBe(39);
    expect(found(result, "catch_lean_deg").target).toMatchObject({ low: 36, high: 40 });
    expect(result.card.phases.catch).toBe(100);
    expect(result.card.overall).toBe(100);
  });

  it("falls to zero 10 degrees outside the range", () => {
    const result = rescore(rower(), mine({ catch_lean_deg: { low: 26, high: 29, counts: true } }));
    expect(found(result, "catch_lean_deg").score).toBe(0);
  });

  it("counts a knee when the athlete asks, and leaves it out otherwise", () => {
    const counted = rescore(rower(), mine({ catch_knee_deg: { low: 50, high: 55, counts: true } }));
    expect(found(counted, "catch_knee_deg").score).toBeCloseTo(70);
    expect(counted.card.phases.catch).toBeCloseTo(45);
    const left = rescore(rower(), mine({ finish_lean_deg: { low: -25, high: -20, counts: false } }));
    expect(found(left, "finish_lean_deg").score).toBeNull();
    expect(found(left, "finish_lean_deg").reason).toMatch(/does not count/);
    expect(found(left, "catch_knee_deg").reason).toBe("Shown as a rough guide.");
  });

  it("gives no overall when the catch or the finish has nothing counting", () => {
    const result = rescore(rower(), mine({ finish_lean_deg: { low: -25, high: -20, counts: false } }));
    expect(result.card.phases.finish).toBeUndefined();
    expect(result.card.overall).toBeNull();
    expect(overallProblem(mine({ finish_lean_deg: { low: -25, high: -20, counts: false } }))).toMatch(/finish/);
  });

  it("keeps the engine's reasons for too few or too uneven strokes", () => {
    const few = rescore(rower(2), mine({ catch_knee_deg: { low: 50, high: 55, counts: true } }));
    expect(found(few, "catch_knee_deg").reason).toMatch(/at least 3/);
    const uneven = rower();
    found(uneven, "catch_knee_deg").spread = 15;
    expect(found(rescore(uneven, mine({ catch_knee_deg: { low: 50, high: 55, counts: true } })), "catch_knee_deg").reason).toMatch(/inconsistent/);
  });

  it("does not touch measures it does not own", () => {
    const result = rescore(rower(), mine({ catch_lean_deg: { low: 36, high: 40, counts: true } }));
    expect(found(result, "drive_share").score).toBe(100);
    expect(result.card.phases.rhythm).toBe(100);
  });
});

describe("checks on a range", () => {
  it("allows 5 degrees at most, in order, inside the limits", () => {
    expect(rangeProblem("catch_lean_deg", 26, 31)).toBeNull();
    expect(rangeProblem("catch_lean_deg", 26, 32)).toMatch(/5°/);
    expect(rangeProblem("catch_lean_deg", 31, 26)).toMatch(/above/);
    expect(rangeProblem("catch_lean_deg", -3, 2)).toMatch(/between/);
    expect(rangeProblem("catch_lean_deg", Number.NaN, 2)).toMatch(/number/);
    expect(rangeProblem("finish_lean_deg", -30, -20)).toBeNull();
    expect(rangeProblem("finish_lean_deg", -31, -20)).toMatch(/10°/);
  });

  it("cleans saved choices, and drops them if any is wrong", () => {
    expect(cleanTargets(GENERAL_TARGETS)).toEqual(GENERAL_TARGETS);
    expect(cleanTargets({ ...GENERAL_TARGETS, catch_lean_deg: { low: 0, high: 40, counts: true } })).toBeNull();
    expect(cleanTargets({ ...GENERAL_TARGETS, catch_lean_deg: { low: 26, high: 31, counts: "yes" } })).toBeNull();
    expect(cleanTargets("nope")).toBeNull();
  });

  it("keeps choices saved before the shin was measured, with the shin shown only", () => {
    const before = Object.fromEntries(Object.entries(mine({ catch_knee_deg: { low: 70, high: 75, counts: true } })).filter(([name]) => name !== "catch_shin_deg"));
    const kept = cleanTargets(before);
    expect(kept?.catch_knee_deg).toEqual({ low: 70, high: 75, counts: true });
    expect(kept?.catch_shin_deg).toEqual(GENERAL_TARGETS.catch_shin_deg);
    expect(cleanTargets({ ...GENERAL_TARGETS, finish_knee_deg: undefined })).toBeNull();
  });
});

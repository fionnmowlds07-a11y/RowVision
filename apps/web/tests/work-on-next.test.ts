import { describe, expect, test } from "vitest";
import type { Metric, Rating } from "@/lib/result";
import { workOnNext } from "@/lib/work-on-next";

function metric(name: string, value: number | null, low: number, high: number | null, score: number | null): Metric {
  return { name, label: name, phase: "catch", value, spread: 1, target: { low, high, sources: [], evidence: "" }, score, reason: null };
}

const rating = (band: Rating["band"], warnings: string[] = []): Rating =>
  ({ accuracy: 70, band, calibrated: true, labelled_frames: 108, warnings });

const rower = (metrics: Metric[], band: Rating["band"] = "Good", warnings: string[] = []) => ({
  card: { overall: 80, phases: {}, metrics },
  rating: rating(band, warnings),
});

describe("work on next", () => {
  test("the measure losing most comes first", () => {
    const advice = workOnNext(rower([
      metric("finish_lean_deg", -18, -25, -20, 80),
      metric("catch_lean_deg", 23, 26, 31, 70),
    ]));
    expect(advice.items.map((item) => item.measure)).toEqual(["catch_lean_deg", "finish_lean_deg"]);
  });

  test("the words give the gap to the target", () => {
    const { items } = workOnNext(rower([metric("catch_lean_deg", 23, 26, 31, 70)]));
    expect(items[0].text).toBe("Your body angle at the catch is 3° short of the target.");
  });

  test("going too far is said differently", () => {
    const { items } = workOnNext(rower([metric("catch_lean_deg", 34, 26, 31, 70)]));
    expect(items[0].text).toBe("Your body angle at the catch is 3° past the target.");
  });

  test("layback reads the right way round", () => {
    const short = workOnNext(rower([metric("finish_lean_deg", -18, -25, -20, 80)]));
    const far = workOnNext(rower([metric("finish_lean_deg", -28, -25, -20, 70)]));
    expect(short.items[0].text).toBe("Your layback at the finish is 2° short of the target.");
    expect(far.items[0].text).toBe("Your layback at the finish is 3° past the target.");
  });

  test("rhythm gives both figures", () => {
    const { items } = workOnNext(rower([metric("drive_share", 0.34, 0.39, 0.49, 60)]));
    expect(items[0].text).toBe("Your drive takes 34% of the stroke. The target at this rate is 39–49%.");
  });

  test("legs first has its own words", () => {
    const { items } = workOnNext(rower([metric("legs_lead", -0.1, 0, null, 50)]));
    expect(items[0].text).toContain("legs first");
  });

  test("at most three are shown", () => {
    const metrics = ["a", "b", "c", "d"].map((name) => metric(name, 1, 2, 3, 50));
    expect(workOnNext(rower(metrics)).items).toHaveLength(3);
  });

  test("unscored measures never appear, such as knees", () => {
    const advice = workOnNext(rower([metric("catch_knee_deg", 80, 50, 55, null)]));
    expect(advice.kind).toBe("on_target");
  });

  test("full marks are left out", () => {
    expect(workOnNext(rower([metric("catch_lean_deg", 28, 26, 31, 100)])).kind).toBe("on_target");
  });

  test("Poor gives filming advice, never technique", () => {
    const advice = workOnNext(rower([metric("catch_lean_deg", 23, 26, 31, 70)], "Poor", ["Film closer."]));
    expect(advice).toEqual({ kind: "filming", items: [{ text: "Film closer." }] });
  });

  test("Poor with no notes still says what to do", () => {
    expect(workOnNext(rower([], "Poor")).items[0].text).toContain("alongside the boat");
  });
});

import { describe, expect, test } from "vitest";
import { clipStatus, isOlder, latest, trendPoints, type ClipResult, type ClipRow } from "@/lib/history";

const result = (band: string | null, overall: number | null = 80, created_at = "2026-01-01"): ClipResult => ({
  band, overall, accuracy: 70, code_version: "v1", created_at,
  summary: { rower: { card: { metrics: [{ name: "catch_lean_deg", value: 27 }, { name: "finish_lean_deg", value: -21 }] } } },
});

const clip = (filmed: string, ...results: ClipResult[]): ClipRow => ({
  id: filmed, filmed_at: filmed, created_at: filmed, jobs: [], results,
});

describe("clip list", () => {
  test("waiting states say what is happening", () => {
    expect(clipStatus("queued", null).text).toBe("In the queue");
    expect(clipStatus("needs_tap", null).text).toBe("Needs a tap from you");
  });
  test("a finished clip shows its accuracy and score", () => {
    expect(clipStatus("done", result("Good", 86.6))).toEqual({ text: "Accuracy 70% Good", score: "87" });
  });
  test("a Poor score stays hidden", () => {
    expect(clipStatus("done", result("Poor", 95))).toEqual({ text: "Accuracy 70% Poor, score hidden", score: null });
  });
  test("a clip with no rower says film closer", () => {
    expect(clipStatus("done", result(null)).text).toContain("Film closer");
  });
  test("the newest result is used", () => {
    expect(latest([result("Fair", 1, "2026-01-01"), result("Good", 2, "2026-02-01")])?.overall).toBe(2);
  });
});

describe("older results", () => {
  test("a different version is older", () => {
    expect(isOlder({ code_version: "a" }, "b")).toBe(true);
    expect(isOlder({ code_version: "a" }, "a")).toBe(false);
  });
  test("with no worker seen yet nothing is called older", () => {
    expect(isOlder({ code_version: "a" }, null)).toBe(false);
  });
});

describe("trend", () => {
  test("only Good or better clips count", () => {
    const points = trendPoints([clip("2026-01-01", result("Good")), clip("2026-01-02", result("Fair")), clip("2026-01-03", result("Poor"))], null);
    expect(points).toHaveLength(1);
  });
  test("points run in filming order", () => {
    const points = trendPoints([clip("2026-02-01", result("Great")), clip("2026-01-01", result("Excellent"))], null);
    expect(points.map((point) => point.when)).toEqual(["2026-01-01", "2026-02-01"]);
  });
  test("layback reads as a positive angle", () => {
    expect(trendPoints([clip("2026-01-01", result("Good"))], null)[0].layback).toBe(21);
  });
  test("body swing and rate are read when the clip has them", () => {
    const newer = result("Good");
    newer.summary = { rower: { rate_spm: 22, card: { metrics: [], extras: [{ name: "body_swing_deg", value: 52 }] } } };
    const [old, fresh] = trendPoints([clip("2026-01-01", result("Good")), clip("2026-01-02", newer)], null);
    expect(old).toMatchObject({ bodySwing: null, rate: null });
    expect(fresh).toMatchObject({ bodySwing: 52, rate: 22 });
  });
  test("older clips are marked", () => {
    expect(trendPoints([clip("2026-01-01", result("Good"))], "v2")[0].older).toBe(true);
  });
});

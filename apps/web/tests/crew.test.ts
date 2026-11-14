import { expect, test } from "vitest";
import { crewRows, degrees, seatLabel, timingBar } from "@/lib/crew";
import type { Rower, Timing } from "@/lib/result";

function rower(seat: number, catchLean: number, layback: number, timing: Partial<Timing> | null, band: Rower["rating"]["band"] = "Good"): Rower {
  const metric = (name: string, value: number) => ({ name, label: name, phase: "catch", value, spread: 1, target: null, score: null, reason: null });
  return {
    seat, rate_spm: 22, catches: [], finishes: [], strokes: [],
    timing: timing && { leader_seat: 4, catch_ms: 0, finish_ms: 0, catch_spread_ms: 20, finish_spread_ms: 20, strokes: 6, ...timing },
    card: { overall: 80 + seat, phases: {}, metrics: [metric("catch_lean_deg", catchLean), metric("finish_lean_deg", layback)] },
    rating: { accuracy: 75, band, calibrated: true, labelled_frames: 108, warnings: [] },
  };
}

const CREW = [
  rower(1, 27, -19, { catch_ms: 62 }),
  rower(2, 30, -15, { catch_ms: 10, finish_ms: -80 }, "Poor"),
  rower(3, 24, -22, { catch_ms: -90, leader_seat: 4 }),
  rower(4, 28, -24, null),
];

test("seats are listed stroke first, with the athlete marked", () => {
  const rows = crewRows(CREW, 3);
  expect(rows.map((row) => row.seat)).toEqual([4, 3, 2, 1]);
  expect(rows.map((row) => row.you)).toEqual([false, true, false, false]);
});

test("each seat reads its angles, with layback as a positive angle", () => {
  const [stroke, three] = crewRows(CREW, 3);
  expect(stroke).toMatchObject({ follows: null, catchLean: 28, layback: 24, catchTiming: "–", bar: null });
  expect(three).toMatchObject({ follows: 4, catchLean: 24, layback: 22, catchTiming: "About 90 ms early" });
});

test("a seat rated Poor keeps its overall hidden", () => {
  const rows = crewRows(CREW, 3);
  expect(rows[2].overall).toBeNull();
  expect(rows[3].overall).toBe(81);
});

test("late sits right of the middle, early left, and in time has no bar", () => {
  expect(timingBar(75, 20)).toEqual({ left: 50, width: 25 });
  expect(timingBar(-75, 20)).toEqual({ left: 25, width: 25 });
  expect(timingBar(30, 20)).toBeNull();
  expect(timingBar(400, 20)).toEqual({ left: 50, width: 50 });
});

test("a gap too variable to read, or missing, has no bar", () => {
  expect(timingBar(90, 120)).toBeNull();
  expect(timingBar(null, 20)).toBeNull();
  expect(timingBar(90, null)).toBeNull();
});

test("a seat's label says who it is and how it sits against who it follows", () => {
  const rows = crewRows(CREW, 3);
  expect(seatLabel(rows[1])).toBe("Seat 3, you, catch against seat 4: about 90 ms early, body angle at the catch 24°");
  expect(seatLabel(rows[0])).toBe("Seat 4, sets the rhythm, body angle at the catch 28°");
  expect(degrees(null)).toBe("–");
});

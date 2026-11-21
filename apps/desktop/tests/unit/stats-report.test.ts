import { expect, test } from "vitest";
import { handover, leadRower, middleOf, progress, reaches, resample, steady } from "@/lib/handover";
import type { FrameData, Rower } from "@/lib/result";
import { handoverNotes, statsDocument, statsPages, statsReport, statsRowers } from "../../src/renderer/stats-report";

const FPS = 50;
const CYCLE = 100;
const DRIVE = 40;
const target = { low: 26, high: 31, sources: [], evidence: "Test." };

/** Smooth 0 to 1 between two points of the drive. */
function ease(share: number, from: number, to: number) {
  if (share <= from) return 0;
  if (share >= to) return 1;
  return (1 - Math.cos(Math.PI * ((share - from) / (to - from)))) / 2;
}

/** A rower whose legs, back and arms each move in their own part of the drive. */
function angles(offset: number, back: [number, number], strokes = 6) {
  const trunk: number[] = [];
  const knee: number[] = [];
  const elbow: number[] = [];
  for (let frame = 0; frame < CYCLE * strokes + CYCLE; frame += 1) {
    const at = (frame - offset + CYCLE * 10) % CYCLE;
    if (at <= DRIVE) {
      const share = at / DRIVE;
      knee.push(55 + 120 * ease(share, 0, 0.6));
      trunk.push(30 - 55 * ease(share, back[0], back[1]));
      elbow.push(170 - 90 * ease(share, 0.65, 1));
    } else {
      const share = (at - DRIVE) / (CYCLE - DRIVE);
      elbow.push(80 + 90 * ease(share, 0, 0.3));
      trunk.push(-25 + 55 * ease(share, 0.1, 0.5));
      knee.push(175 - 120 * ease(share, 0.4, 1));
    }
  }
  return { trunk, knee, elbow };
}

function rower(seat: number, offset: number, extra: Partial<Rower> = {}): Rower {
  return {
    seat, rate_spm: 30, catches: [], finishes: [], timing: null,
    strokes: Array.from({ length: 6 }, (_, n) => ({ catch_frame: offset + n * CYCLE, finish_frame: offset + n * CYCLE + DRIVE, next_catch_frame: offset + (n + 1) * CYCLE, catch_lean_deg: 30, finish_lean_deg: -25 })),
    card: { overall: 80, phases: { catch: 90, finish: 70 }, metrics: [
      { name: "catch_lean_deg", label: "Body angle at the catch", phase: "catch", value: 30, spread: 2, target, score: 90, reason: null },
      { name: "finish_lean_deg", label: "Layback at the finish", phase: "finish", value: -25, spread: 2, target: { ...target, low: -25, high: -20 }, score: 70, reason: null },
    ] },
    rating: { accuracy: 90, band: "Excellent", calibrated: true, labelled_frames: 100, warnings: [] },
    ...extra,
  };
}

test("lines are steadied, resampled and turned into a share of the movement", () => {
  expect(steady([1, 100, 2, 3, 4])).toEqual([2, 2.5, 3, 3.5, 3]);
  expect(resample([0, 1, null, 3, 4], 5)).toEqual([0, 1, 2, 3, 4]);
  expect(resample([0, null, null, 3], 4)).toBeNull();
  expect(progress([10, 10, 10, 50, 90, 90, 90])).toEqual([0, 0, 0, 0.5, 1, 1, 1]);
  expect(progress([10, 11, 12, 13])).toBeNull();
  expect(reaches([0, 0.1, 0.4, 1], 0.3)).toBeCloseTo(2 / 3);
  expect(middleOf([0, 0, 10, 10, 10])).toBeCloseTo(0.375);
});

test("the hand-over finds legs, then back, then arms, and when the back opens", () => {
  const stroke = rower(2, 10);
  const hand = handover(stroke, angles(10, [0.3, 0.9]), FPS, stroke);
  expect(hand.strokes).toBe(6);
  expect(hand.driveS).toBeCloseTo(DRIVE / FPS);
  expect(hand.middle.legs!).toBeLessThan(hand.middle.back!);
  expect(hand.middle.back!).toBeLessThan(hand.middle.arms!);
  expect(hand.backOpensShare!).toBeGreaterThan(0.3);
  expect(hand.backOpensShare!).toBeLessThan(0.5);
  expect(hand.boat.legs!.start).toBeGreaterThan(0);
  expect(hand.boat.legs!.start).toBeLessThan(hand.boat.back!.start);
  expect(hand.drive.legs![40]).toBe(1);
  expect(hand.recovery.arms).not.toBeNull();
  expect(hand.cycle.finishShare).toBeCloseTo(0.4);
});

test("a rower whose back opens early is said to, against the rower they are timed from", () => {
  const stroke = rower(2, 10);
  const bow = rower(1, 10);
  const data: FrameData = { views: null, crew: { 2: { angles: angles(10, [0.3, 0.9]) }, 1: { angles: angles(10, [0, 0.55]) } } };
  const every = statsRowers([bow, stroke], data, FPS, 2, null);
  expect(every.map((item) => item.name)).toEqual(["Stroke", "Bow"]);
  expect(leadRower([bow, stroke]).seat).toBe(2);
  const notes = handoverNotes(statsReport("Crew statistics", "Pair", every, ["2", "1"]));
  const said = [notes.headline, ...notes.lines].join(" ");
  expect(said).toContain("Bow's back swings first");
  expect(said).toContain("Bow's back moves before the legs");
});

test("a pair fits on three pages, an eight takes more, and only the chosen rowers are in it", () => {
  const crew = Array.from({ length: 8 }, (_, n) => rower(n + 1, 10));
  const data: FrameData = { views: null, crew: Object.fromEntries(crew.map((item) => [String(item.seat), { angles: angles(10, [0.3, 0.9]) }])) };
  const every = statsRowers(crew, data, FPS, 8, null);
  expect(every[0].name).toBe("Stroke");
  expect(every[7].name).toBe("Bow");
  expect(new Set(every.map((item) => item.colour)).size).toBe(8);
  expect(statsPages(statsReport("Crew statistics", "Eight", every, every.map((item) => item.key)))).toHaveLength(5);
  const two = statsPages(statsReport("Crew statistics", "Eight", every, ["8", "3"]));
  expect(two).toHaveLength(3);
  expect(two[0]).toContain("Seat 3");
  expect(two[0]).not.toContain("Seat 4");
  expect(two[2]).toContain("page 3 of 3");
  expect(statsPages(statsReport("Crew statistics", "Eight", every, []))).toEqual([]);
  // The app's page allows no inline styles, so the previews would lose their colours.
  expect(statsPages(statsReport("Crew statistics", "Eight", every, every.map((item) => item.key))).join("")).not.toContain("style=");
});

test("the document carries its fonts and escapes what it is given", () => {
  const solo = rower(1, 10);
  const every = statsRowers([solo], { views: null, angles: angles(10, [0.3, 0.9]) }, FPS, 1, 1);
  expect(every[0].name).toBe("Rower");
  const html = statsDocument(statsReport("Rower statistics", "Single <1x>", every, ["1"]), ".rvs-sheet{}", [{ family: "DM Sans Variable", src: "data:font/woff2;base64,AA" }]);
  expect(html).toContain("@font-face{font-family:\"DM Sans Variable\"");
  expect(html).toContain("Single &lt;1x&gt;");
  expect(html).not.toContain("<1x>");
  expect(html.match(/class="rvs-sheet"/g)).toHaveLength(3);
});

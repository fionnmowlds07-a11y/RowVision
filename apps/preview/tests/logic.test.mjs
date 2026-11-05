import assert from "node:assert/strict";
import { test } from "node:test";

import {
  boatAt,
  boatLabel,
  clampFrame,
  limbSegments,
  nextMarker,
  openingFrame,
  resultSummary,
  seatOptions,
  shotAt,
  stageText,
  toVideoPoint,
} from "../rowvision_preview/static/logic.mjs";

test("seats run from bow to stroke", () => {
  assert.deepEqual(seatOptions(4).map((seat) => seat.label), ["1 (bow)", "2", "3", "4 (stroke)"]);
  assert.deepEqual(seatOptions(1), [{ value: 1, label: "1 (single)" }]);
});

test("frames stay inside the clip", () => {
  assert.equal(clampFrame(-3, 100), 0);
  assert.equal(clampFrame(100, 100), 99);
  assert.equal(clampFrame(4.6, 100), 5);
  assert.equal(clampFrame(4, 0), 0);
});

test("jumping skips the marker you are on", () => {
  const markers = [10, 20, 30];
  assert.equal(nextMarker(20, markers, 1), 30);
  assert.equal(nextMarker(20, markers, -1), 10);
  assert.equal(nextMarker(15, markers, 1), 20);
  assert.equal(nextMarker(15, markers, -1), 10);
});

test("jumping past the ends finds nothing", () => {
  assert.equal(nextMarker(30, [10, 30], 1), null);
  assert.equal(nextMarker(10, [10, 30], -1), null);
  assert.equal(nextMarker(5, [], 1), null);
});

test("frame zero can be jumped to", () => {
  assert.equal(nextMarker(9, [0], -1), 0);
});

test("limbs need both ends, and unsure ones are flagged", () => {
  const pose = Array(17).fill(null);
  pose[5] = [1, 2, 0.9];
  pose[7] = [3, 4, 0.9];
  pose[9] = [5, 6, 0.1];
  const segments = limbSegments(pose);
  assert.equal(segments.length, 2);
  assert.deepEqual(segments[0], { start: [1, 2, 0.9], end: [3, 4, 0.9], side: "left", sure: true });
  assert.equal(segments[1].sure, false);
});

test("the viewer opens on the first catch, else the first pose", () => {
  assert.equal(openingFrame({ catches: [40], poses: [null, []] }), 40);
  assert.equal(openingFrame({ catches: [], poses: [null, null, []] }), 2);
  assert.equal(openingFrame({ catches: [], poses: [null] }), 0);
  assert.equal(openingFrame(null), 0);
});

test("a frame with no pose draws nothing", () => {
  assert.deepEqual(limbSegments(null), []);
});

test("the shot end frame belongs to the next shot", () => {
  const shots = [{ start: 0, end: 10, kind: "a" }, { start: 10, end: 20, kind: "b" }];
  assert.equal(shotAt(shots, 9).kind, "a");
  assert.equal(shotAt(shots, 10).kind, "b");
  assert.equal(shotAt(shots, 20), null);
});

test("taps convert from the scaled canvas to video pixels", () => {
  const rect = { left: 100, top: 50, width: 424, height: 239 };
  assert.deepEqual(toVideoPoint(312, 169.5, rect, 848, 478), { x: 424, y: 239 });
});

test("a tap picks the boat it is in, or the nearest", () => {
  const boats = [
    { outline: [0, 0, 10, 10] },
    { outline: null },
    { outline: [100, 0, 110, 10] },
  ];
  assert.equal(boatAt(boats, { x: 5, y: 5 }), 0);
  assert.equal(boatAt(boats, { x: 105, y: 5 }), 2);
  assert.equal(boatAt(boats, { x: 80, y: 5 }), 2);
});

test("overlapping boats go to the first, as boat_at does", () => {
  const boats = [{ outline: [0, 0, 10, 10] }, { outline: [5, 0, 15, 10] }];
  assert.equal(boatAt(boats, { x: 7, y: 5 }), 0);
});

test("no boat in view gives no choice", () => {
  assert.equal(boatAt([{ outline: null }], { x: 1, y: 1 }), null);
});

test("boat labels say how many people and whether it is too far", () => {
  assert.equal(boatLabel({ people: 1, too_far: false }, 1), "Boat 1: 1 person");
  assert.equal(boatLabel({ people: 8, too_far: true }, 2), "Boat 2: 8 people, too far");
});

test("progress shows a percentage when known, and otherwise the time passing", () => {
  assert.equal(stageText({ stage: "Measuring", progress: 0.256 }, 9), "Measuring: 26%");
  assert.equal(stageText({ stage: "Loading", progress: null }, 8.6), "Loading... 9 s");
});

test("the summary leaves out what is unknown", () => {
  const rower = { seat: null, catches: [1], finishes: [], rate_spm: null };
  assert.equal(resultSummary({ rower, view_deg: null }), "Seat unknown · 1 catches · 0 finishes");
  const known = { seat: 2, catches: [], finishes: [], rate_spm: 24.04 };
  assert.match(resultSummary({ rower: known, view_deg: 12.4 }), /24\.0 strokes a minute · camera 12°/);
});

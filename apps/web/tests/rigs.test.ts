import { expect, test } from "vitest";
import { alternating, fitRig, flipSeat, hasRig, isRig, presetOf, presetsFor } from "@/lib/rigs";

test("a normal rig alternates, with the stroke seat on the side asked for", () => {
  expect(alternating(4)).toEqual(["bow", "stroke", "bow", "stroke"]);
  expect(alternating(2, "bow")).toEqual(["stroke", "bow"]);
});

test("only sweep crews have a rig", () => {
  expect(["2-", "4-", "4+", "8+"].every(hasRig)).toBe(true);
  expect(["1x", "2x", "4x"].some(hasRig)).toBe(false);
  expect(presetsFor("4x")).toEqual([]);
});

test("each boat offers its usual rigs, each a full boat's worth of sides", () => {
  expect(presetsFor("2-").map((preset) => preset.id)).toEqual(["normal", "reversed"]);
  expect(presetsFor("4+").map((preset) => preset.id)).toEqual(["normal", "reversed", "bucket"]);
  expect(presetsFor("8+").map((preset) => preset.id)).toEqual(["normal", "reversed", "german", "italian"]);
  for (const boat of ["2-", "4-", "8+"]) for (const preset of presetsFor(boat)) expect(isRig(boat, preset.sides)).toBe(true);
  // The bucket and German rigs put two seats in a row on one side, where the normal rig would not.
  const german = presetsFor("8+").find((preset) => preset.id === "german")!.sides;
  expect(german[3]).toBe(german[4]);
  expect(presetsFor("4-").find((preset) => preset.id === "bucket")!.sides.slice(1, 3)).toEqual(["bow", "bow"]);
});

test("clicking seats makes a custom rig, and going back finds the preset again", () => {
  const normal = alternating(8);
  const custom = flipSeat(normal, 3);
  expect(custom[2]).toBe("stroke");
  expect(presetOf("8+", custom)).toBeNull();
  expect(presetOf("8+", flipSeat(custom, 3))?.id).toBe("normal");
});

test("a rig that does not fit the boat falls back to the normal rig", () => {
  expect(fitRig("4-", ["bow", "bow"])).toEqual(alternating(4));
  expect(fitRig("4-", ["stroke", "bow", "bow", "stroke"])).toEqual(["stroke", "bow", "bow", "stroke"]);
  expect(isRig("4-", ["bow", "bow", "bow", "bow"])).toBe(false);
  expect(isRig("4x", alternating(4))).toBe(false);
});

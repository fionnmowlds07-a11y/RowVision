import { describe, expect, test } from "vitest";
import { PRESETS, colourVariables, contrast, isColour, textOn } from "@/lib/colours";

describe("your own colours", () => {
  test("text is readable on any colour", () => {
    for (let value = 0; value < 0xffffff; value += 0x0a1b3d) {
      const hex = `#${value.toString(16).padStart(6, "0")}`;
      expect(contrast(hex, textOn(hex))).toBeGreaterThanOrEqual(4.5);
    }
  });
  test("every preset is readable", () => {
    for (const { ground, highlight } of PRESETS) {
      expect(contrast(ground, textOn(ground))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(highlight, textOn(highlight))).toBeGreaterThanOrEqual(4.5);
    }
  });
  test("dark colours get white text and pale ones black", () => {
    expect(textOn("#070b09")).toBe("#ffffff");
    expect(textOn("#dff1e6")).toBe("#000000");
  });
  test("only real colours are accepted", () => {
    expect(isColour("#35d07f")).toBe(true);
    expect(isColour("red")).toBe(false);
    expect(isColour("#35d07f;}")).toBe(false);
  });
  test("no choice means the design system's colours stand", () => {
    expect(colourVariables(null, null)).toEqual({});
  });
  test("a choice sets its text too", () => {
    expect(colourVariables("#dff1e6", null)).toEqual({
      "--ground": "#dff1e6", "--on-ground": "#000000", "--on-ground-soft": "#000000",
    });
  });
  test("a bad stored value is ignored", () => {
    expect(colourVariables("nonsense", "nonsense")).toEqual({});
  });
});

import { describe, expect, test } from "vitest";
import { poseAt, type Style } from "@/lib/reference-pose";
import fixtures from "./fixtures/reference-poses.json";

function closeTo(actual: unknown, expected: unknown, path: string) {
  if (Array.isArray(expected) || (typeof expected === "object" && expected !== null)) {
    for (const key of Object.keys(expected)) {
      closeTo((actual as Record<string, unknown>)[key], (expected as Record<string, unknown>)[key], `${path}.${key}`);
    }
  } else if (typeof expected === "number") {
    expect(actual, path).toBeCloseTo(expected, 3);
  } else {
    expect(actual, path).toBe(expected);
  }
}

describe("the 3D pose matches the Python", () => {
  test.each(fixtures.map((item) => [`${item.style} ${item.lean} ${item.knee}`, item] as const))("%s", (_, item) => {
    closeTo(poseAt(item.lean, item.knee, item.reach, item.style as Style), item.pose, "pose");
  });
});

test("impossible angles are refused", () => {
  expect(() => poseAt(70, 90, 0.5, "scull")).toThrow(RangeError);
  expect(() => poseAt(0, 200, 0.5, "scull")).toThrow(RangeError);
  expect(() => poseAt(0, 90, 2, "scull")).toThrow(RangeError);
});

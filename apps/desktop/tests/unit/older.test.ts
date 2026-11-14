import { expect, test } from "vitest";
import type { ClipItem } from "../../src/shared/bridge";
import { olderClips, olderLine } from "../../src/renderer/older";

const clip = (id: string, changes: Partial<ClipItem> = {}): ClipItem => ({
  id, createdAt: "2026-11-08T09:00:00Z", setup: {}, state: "done", message: null, analysed: true, overall: 80, band: "Good", accuracy: 75, rate: 22,
  version: "old", metrics: [], bytes: 1, videoBytes: 1, hasVideo: true, sentAt: null, ...changes,
} as ClipItem);

test("only finished clips from another version, with their video, can be measured again", () => {
  const clips = [
    clip("a"),
    clip("b", { version: "new" }),
    clip("c", { hasVideo: false }),
    clip("d", { state: "waiting", version: null }),
    clip("e", { version: null }),
  ];
  expect(olderClips(clips, "new").map((item) => item.id)).toEqual(["a"]);
});

test("with no engine to ask, nothing is called older", () => {
  expect(olderClips([clip("a")], null)).toEqual([]);
});

test("the line counts the clips", () => {
  expect(olderLine(1)).toBe("1 clip was measured with an older version of RowVision.");
  expect(olderLine(3)).toBe("3 clips were measured with an older version of RowVision.");
});

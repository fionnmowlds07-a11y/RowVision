import { describe, expect, test } from "vitest";
import {
  MAX_UPLOAD_BYTES, clockTime, looksCompressed, refuseFile,
  refuseLength, firstTrim, trimEnd, trimStart, submitError, tapPoint,
} from "@/lib/clip-checks";

const facts = (width: number, height: number) => ({ duration: 30, width, height });

describe("file checks", () => {
  test("a video is accepted", () => {
    expect(refuseFile({ type: "video/mp4", name: "a.mp4", size: 100 })).toBeNull();
  });
  test("a video with no type is accepted by its name", () => {
    expect(refuseFile({ type: "", name: "a.MOV", size: 100 })).toBeNull();
  });
  test("other files are refused", () => {
    expect(refuseFile({ type: "image/png", name: "a.png", size: 100 })).toContain("isn't a video");
  });
  test("files over the limit are refused", () => {
    expect(refuseFile({ type: "video/mp4", name: "a.mp4", size: MAX_UPLOAD_BYTES + 1 })).toContain("4 GB");
  });
  test("very short clips are refused", () => {
    expect(refuseLength(4)).toContain("too short");
    expect(refuseLength(5)).toBeNull();
  });
});

describe("compressed copies", () => {
  test("a WhatsApp name warns, even at full size", () => {
    expect(looksCompressed("VID-20251027-WA0009.mp4", facts(1920, 1080))).toBe(true);
  });
  test("a small frame warns", () => {
    expect(looksCompressed("clip.mp4", facts(848, 478))).toBe(true);
  });
  test("an upright small frame warns", () => {
    expect(looksCompressed("clip.mp4", facts(478, 848))).toBe(true);
  });
  test("a full-size clip does not warn", () => {
    expect(looksCompressed("20250721_091841.mp4", facts(2336, 1080))).toBe(false);
  });
});

describe("trimming", () => {
  test("starts with as much as can be analysed", () => {
    expect(firstTrim(30)).toEqual({ start: 0, end: 30 });
    expect(firstTrim(200)).toEqual({ start: 0, end: 60 });
  });

  test("moving the start pushes the end to stay at 60 seconds or less", () => {
    expect(trimStart(50, { start: 0, end: 60 }, 200)).toEqual({ start: 50, end: 60 });
    expect(trimStart(100, { start: 0, end: 60 }, 200)).toEqual({ start: 100, end: 105 });
  });

  test("moving the end pulls the start to stay at 60 seconds or less", () => {
    expect(trimEnd(150, { start: 10, end: 60 }, 200)).toEqual({ start: 90, end: 150 });
    expect(trimEnd(30, { start: 10, end: 60 }, 200)).toEqual({ start: 10, end: 30 });
  });

  test("a trim is never shorter than 5 seconds", () => {
    expect(trimEnd(12, { start: 10, end: 60 }, 200)).toEqual({ start: 7, end: 12 });
    expect(trimStart(58, { start: 10, end: 60 }, 200)).toEqual({ start: 58, end: 63 });
  });

  test("times read as minutes and seconds", () => {
    expect(clockTime(75.9)).toBe("1:15");
  });

  test("a trim stays inside the clip", () => {
    expect(trimStart(29, { start: 0, end: 30 }, 30)).toEqual({ start: 25, end: 30 });
    expect(trimEnd(1, { start: 0, end: 30 }, 30)).toEqual({ start: 0, end: 5 });
    expect(trimEnd(99, { start: 0, end: 20 }, 30)).toEqual({ start: 0, end: 30 });
  });
});

describe("taps", () => {
  const rect = { left: 100, top: 50, width: 200, height: 100 };
  test("a tap becomes a share of the frame", () => {
    expect(tapPoint(200, 100, rect)).toEqual({ x: 0.5, y: 0.5 });
  });
  test("a tap outside stays inside the frame", () => {
    expect(tapPoint(0, 500, rect)).toEqual({ x: 0, y: 1 });
  });
});

test("a full queue is explained", () => {
  expect(submitError("queue_full")).toContain("2 clips waiting");
});

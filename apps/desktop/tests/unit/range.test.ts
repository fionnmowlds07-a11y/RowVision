import { expect, test } from "vitest";
import { parseRange } from "../../src/main/range";

test("no range means the whole file", () => {
  expect(parseRange(null, 100)).toBeNull();
});

test("ranges a video asks for", () => {
  expect(parseRange("bytes=0-", 100)).toEqual({ start: 0, end: 99 });
  expect(parseRange("bytes=10-19", 100)).toEqual({ start: 10, end: 19 });
  expect(parseRange("bytes=90-500", 100)).toEqual({ start: 90, end: 99 });
  expect(parseRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
  expect(parseRange("bytes=-500", 100)).toEqual({ start: 0, end: 99 });
});

test.each(["bytes=100-", "bytes=20-10", "bytes=-", "bytes=-0", "bytes=0-1,5-6", "items=0-1", "bytes=a-b"])("%s cannot be served", (header) => {
  expect(parseRange(header, 100)).toBe("invalid");
});

test("an empty file has no ranges", () => {
  expect(parseRange("bytes=0-", 0)).toBe("invalid");
});

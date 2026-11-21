import { expect, test } from "vitest";
import { readRoute } from "../../src/renderer/route";

test("pages come from the hash", () => {
  expect(readRoute("")).toEqual({ page: "clips" });
  expect(readRoute("#/settings")).toEqual({ page: "settings" });
  expect(readRoute("#/add")).toEqual({ page: "add" });
  expect(readRoute("#/guide")).toEqual({ page: "guide" });
  expect(readRoute("#/analysis/abc-1")).toEqual({ page: "analysis", id: "abc-1" });
  expect(readRoute("#/clip/abc-1")).toEqual({ page: "clip", id: "abc-1" });
  expect(readRoute("#/clip/..%2f")).toEqual({ page: "clips" });
  expect(readRoute("#/compare/abc-1/def-2")).toEqual({ page: "compare", first: "abc-1", second: "def-2" });
  expect(readRoute("#/compare/abc-1/abc-1")).toEqual({ page: "clips" });
  expect(readRoute("#/compare/abc-1")).toEqual({ page: "clips" });
  expect(readRoute("#/compare/abc-1/..%2f")).toEqual({ page: "clips" });
  expect(readRoute("#/rowers/abc-1/2/abc-1/1")).toEqual({ page: "rowers", first: { clip: "abc-1", seat: "2" }, second: { clip: "abc-1", seat: "1" } });
  expect(readRoute("#/rowers/abc-1/rower/def-2/rower")).toEqual({ page: "rowers", first: { clip: "abc-1", seat: "rower" }, second: { clip: "def-2", seat: "rower" } });
  expect(readRoute("#/rowers/abc-1/2")).toEqual({ page: "rowers", first: { clip: "abc-1", seat: "2" }, second: null });
  expect(readRoute("#/rowers/abc-1/2/abc-1/2")).toEqual({ page: "clips" });
  expect(readRoute("#/rowers/abc-1/..%2f")).toEqual({ page: "clips" });
  expect(readRoute("#/rowers/abc-1/2/..%2f/1")).toEqual({ page: "clips" });
});

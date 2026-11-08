import { expect, test } from "vitest";
import { readRoute } from "../../src/renderer/route";

test("pages come from the hash", () => {
  expect(readRoute("")).toEqual({ page: "clips" });
  expect(readRoute("#/settings")).toEqual({ page: "settings" });
  expect(readRoute("#/add")).toEqual({ page: "add" });
  expect(readRoute("#/clip/abc-1")).toEqual({ page: "clip", id: "abc-1" });
  expect(readRoute("#/clip/..%2f")).toEqual({ page: "clips" });
});

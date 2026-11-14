import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { COULDNT_MEASURE, askEngine, engineVersion, measureAgain } from "../../src/main/remeasure";

const ENGINE = [process.env.NODE ?? "node", path.resolve(__dirname, "../fake-engine.mjs")];

let folder: string;
beforeEach(() => {
  folder = mkdtempSync(path.join(tmpdir(), "rowvision-remeasure-"));
  writeFileSync(path.join(folder, "summary.json"), JSON.stringify({ version: "old", rower: null }));
  writeFileSync(path.join(folder, "frames.json"), JSON.stringify({ poses: [] }));
});
afterEach(() => rmSync(folder, { recursive: true, force: true }));

const saved = () => JSON.parse(readFileSync(path.join(folder, "summary.json"), "utf8")) as { version: string };

test("the engine says which version it is", async () => {
  expect(await engineVersion(ENGINE)).toBe("fake-2");
});

test("no engine means no version", async () => {
  expect(await engineVersion(null)).toBeNull();
  expect(await engineVersion(["/nowhere/rowvision-engine"])).toBeNull();
});

test("measuring again stamps the result with the engine's version", async () => {
  expect(await measureAgain(ENGINE, folder)).toBeNull();
  expect(saved().version).toBe("fake-2");
});

test("a clip whose video was removed says why, and keeps its scores", async () => {
  rmSync(path.join(folder, "frames.json"));
  expect(await measureAgain(ENGINE, folder)).toMatch(/video was removed/);
  expect(saved().version).toBe("old");
});

test("a missing or broken engine gives a plain message", async () => {
  expect(await measureAgain(null, folder)).toBe(COULDNT_MEASURE);
  expect(await measureAgain(["/nowhere/rowvision-engine"], folder)).toBe(COULDNT_MEASURE);
  expect(await measureAgain([process.env.NODE ?? "node", "-e", "console.log('not json')"], folder)).toBe(COULDNT_MEASURE);
});

test("only lines of JSON are read from the engine", async () => {
  const answer = await askEngine([process.env.NODE ?? "node", "-e", "console.log('hello'); console.log(JSON.stringify({ event: 'x' }))"], []);
  expect(answer).toEqual({ event: "x" });
});

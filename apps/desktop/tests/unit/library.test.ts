import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { existsSync } from "node:fs";
import { deleteClip, librarySpace, listClips, readClip, removeVideo } from "../../src/main/library";
import { cleanColours, readColours, writeColours } from "../../src/main/settings";

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "rowvision-library-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function addClip(id: string, files: Record<string, string>) {
  mkdirSync(path.join(root, id), { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(path.join(root, id, name), text);
}

test("an empty or missing library has no clips", async () => {
  expect(await listClips(path.join(root, "missing"))).toEqual([]);
  expect(await listClips(root)).toEqual([]);
});

test("clips are listed newest first, with their setup, score and size", async () => {
  addClip("older", { "clip.json": JSON.stringify({ created_at: "2026-11-01T10:00:00Z", boat_class: "8+", seat: 3 }) });
  const summary = { rower: { card: { overall: 81.4 }, rating: { band: "Good" }, rate_spm: 30 } };
  addClip("newer", { "clip.json": JSON.stringify({ created_at: "2026-11-02T10:00:00Z", boat_class: "2-", seat: 1, side: "bow" }), "summary.json": JSON.stringify(summary) });
  addClip("Not-A-Clip", {});
  writeFileSync(path.join(root, "loose-file"), "x");

  const clips = await listClips(root);
  expect(clips.map((clip) => clip.id)).toEqual(["newer", "older"]);
  expect(clips[0]).toMatchObject({ analysed: true, overall: 81.4, band: "Good", rate: 30, setup: { boat_class: "2-", seat: 1, side: "bow" } });
  expect(clips[1]).toMatchObject({ analysed: false, overall: null, band: null });
  expect(clips[0].bytes).toBeGreaterThan(0);
});

test("a broken setup file is ignored rather than trusted", async () => {
  addClip("odd", { "clip.json": JSON.stringify({ seat: "3; rm", boat_class: 8 }), "summary.json": "{ not json" });
  const clip = await readClip(root, "odd");
  expect(clip?.setup).toEqual({});
  expect(clip?.analysed).toBe(false);
});

test("bad ids are never read", async () => {
  expect(await readClip(root, "../etc")).toBeNull();
  expect(await readClip(root, "missing")).toBeNull();
});

test("colours are checked, saved and read back", async () => {
  const file = path.join(root, "settings.json");
  expect(await readColours(file)).toEqual({ ground: null, highlight: null });
  expect(cleanColours({ ground: "#0a3d27", highlight: null })).toEqual({ ground: "#0a3d27", highlight: null });
  expect(cleanColours({ ground: "red", highlight: null })).toBeNull();
  expect(cleanColours({ ground: "#0a3d27" })).toBeNull();
  await writeColours(file, { ground: "#0a3d27", highlight: "#4be38a" });
  expect(await readColours(file)).toEqual({ ground: "#0a3d27", highlight: "#4be38a" });
  writeFileSync(file, "{ broken");
  expect(await readColours(file)).toEqual({ ground: null, highlight: null });
});

test("space is split into videos and the rest, with the disk's free space", async () => {
  addClip("one", { "working.mp4": "x".repeat(1000), "summary.json": "{}", "clip.json": "{}" });
  const space = await librarySpace(root, await listClips(root));
  expect(space.videoBytes).toBe(1000);
  expect(space.otherBytes).toBe(4);
  expect(space.freeBytes).toBeGreaterThan(0);
  expect((await librarySpace(path.join(root, "not-made-yet"), [])).freeBytes).toBeGreaterThan(0);
});

test("a video is removed only once analysed, and the scores stay", async () => {
  addClip("waiting", { "working.mp4": "video", "clip.json": "{}" });
  await expect(removeVideo(root, "waiting")).rejects.toThrow();
  expect(existsSync(path.join(root, "waiting", "working.mp4"))).toBe(true);
  addClip("done", { "working.mp4": "video", "frames.json": "{}", "summary.json": "{}", "clip.json": "{}" });
  await removeVideo(root, "done");
  expect(existsSync(path.join(root, "done", "working.mp4"))).toBe(false);
  expect(existsSync(path.join(root, "done", "frames.json"))).toBe(false);
  expect((await readClip(root, "done"))?.state).toBe("done");
});

test("deleting takes the whole folder, and nothing outside the library", async () => {
  addClip("gone", { "clip.json": "{}" });
  await deleteClip(root, "gone");
  expect(existsSync(path.join(root, "gone"))).toBe(false);
  await expect(deleteClip(root, "..")).rejects.toThrow();
  expect(existsSync(root)).toBe(true);
});

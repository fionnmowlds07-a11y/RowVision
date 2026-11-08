import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { addClip, cleanAdd } from "../../src/main/add";
import { CLIP_ID } from "../../src/shared/bridge";

let folder: string;
let video: string;

beforeEach(() => {
  folder = mkdtempSync(path.join(tmpdir(), "rowvision-add-"));
  video = path.join(folder, "row.MOV");
  writeFileSync(video, "not really a video");
});
afterEach(() => rmSync(folder, { recursive: true, force: true }));

const good = () => ({
  source: video,
  filmedAt: "2026-11-08T09:30:00.000Z",
  setup: { boat: "2-", side: "bow", seat: 2 },
  note: " Saturday ",
  section: { start: 4.5, length: 30 },
  tap: { t: 1.2, x: 0.4, y: 0.6 },
});

test("a good request comes through tidied", () => {
  expect(cleanAdd(good())).toEqual({ ...good(), note: "Saturday" });
  expect(cleanAdd({ ...good(), section: { start: 0, length: null }, tap: null })).not.toBeNull();
});

test("anything odd is refused", () => {
  const bad: unknown[] = [
    null, "x", {},
    { ...good(), source: "row.mp4" },
    { ...good(), source: path.join(folder, "settings.json") },
    { ...good(), source: `${video}\0.mp4` },
    { ...good(), filmedAt: "soon" },
    { ...good(), setup: { boat: "2-", side: "scull", seat: 2 } },
    { ...good(), setup: { boat: "1x", side: "scull", seat: 2 } },
    { ...good(), setup: { boat: "9+", side: "stroke", seat: 1 } },
    { ...good(), note: "x".repeat(201) },
    { ...good(), section: { start: -1, length: 30 } },
    { ...good(), section: { start: 0, length: 61 } },
    { ...good(), section: { start: 0, length: 2 } },
    { ...good(), section: { start: Number.NaN, length: 30 } },
    { ...good(), tap: { t: 1, x: 1.5, y: 0.5 } },
    { ...good(), tap: "middle" },
  ];
  for (const request of bad) expect(cleanAdd(request), JSON.stringify(request)).toBeNull();
});

test("adding writes the clip's folder and leaves the video where it is", async () => {
  const library = path.join(folder, "clips");
  const id = await addClip(library, cleanAdd(good())!, new Date("2026-11-08T10:00:00.000Z"));
  expect(id).toMatch(CLIP_ID);
  const clip = JSON.parse(readFileSync(path.join(library, id, "clip.json"), "utf8"));
  expect(clip).toEqual({
    created_at: "2026-11-08T10:00:00.000Z", filmed_at: "2026-11-08T09:30:00.000Z", source: video, source_bytes: 18,
    boat_class: "2-", side: "bow", seat: 2, note: "Saturday", section_start: 4.5, section_length: 30, tap: { t: 1.2, x: 0.4, y: 0.6 },
  });
  expect(readFileSync(video, "utf8")).toBe("not really a video");
});

test("a missing video is refused", async () => {
  await expect(addClip(path.join(folder, "clips"), { ...cleanAdd(good())!, source: path.join(folder, "gone.mp4") })).rejects.toThrow(/can't be found/);
});

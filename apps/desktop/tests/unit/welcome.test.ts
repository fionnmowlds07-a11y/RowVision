import { chmodSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { readWelcome, saveSettings } from "../../src/main/settings";
import { checkFolder, clipsFolderIn, isEmptyLibrary } from "../../src/main/welcome";

let root: string;
beforeEach(() => { root = mkdtempSync(path.join(tmpdir(), "rowvision-welcome-")); });
afterEach(() => {
  chmodSync(root, 0o700);
  rmSync(root, { recursive: true, force: true });
});

test("clips get their own folder inside the one picked", () => {
  expect(clipsFolderIn("/home/me/Videos")).toBe(path.join("/home/me/Videos", "RowVision"));
  expect(clipsFolderIn("/home/me/Videos/RowVision")).toBe("/home/me/Videos/RowVision");
  expect(clipsFolderIn("/home/me/rowvision")).toBe("/home/me/rowvision");
});

test("a folder that can't be written to is refused in plain words", async () => {
  expect(await checkFolder(path.join(root, "clips"))).toBeNull();
  expect(await checkFolder("relative/clips")).toMatch(/isn't a folder/);
  if (process.platform !== "win32" && process.getuid?.() !== 0) {
    const locked = path.join(root, "locked");
    mkdirSync(locked);
    chmodSync(locked, 0o500);
    expect(await checkFolder(path.join(locked, "RowVision"))).toMatch(/can't save clips there/);
    chmodSync(locked, 0o700);
  }
});

test("the folder can only move while it holds no clips", async () => {
  expect(await isEmptyLibrary(path.join(root, "missing"))).toBe(true);
  expect(await isEmptyLibrary(root)).toBe(true);
  mkdirSync(path.join(root, "a-clip"));
  expect(await isEmptyLibrary(root)).toBe(false);
});

test("the welcome is remembered, with the folder picked", async () => {
  const file = path.join(root, "settings.json");
  expect(await readWelcome(file)).toEqual({ welcomed: false, clipsDir: null });
  await saveSettings(file, { clipsDir: "relative/not/allowed" });
  expect(await readWelcome(file)).toEqual({ welcomed: false, clipsDir: null });
  await saveSettings(file, { welcomed: true, clipsDir: "/data/RowVision" });
  expect(await readWelcome(file)).toEqual({ welcomed: true, clipsDir: "/data/RowVision" });
});

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { readEffort, readSpeed, saveSettings, saveSpeed } from "../../src/main/settings";
import { effortPlan } from "../../src/shared/effort";

const folders: string[] = [];
function settingsFile(content?: unknown): string {
  const folder = mkdtempSync(path.join(tmpdir(), "rowvision-effort-"));
  folders.push(folder);
  const file = path.join(folder, "settings.json");
  if (content !== undefined) writeFileSync(file, JSON.stringify(content));
  return file;
}
afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }); });

test("each effort gives the engine fewer cores and a lower priority", () => {
  expect(effortPlan("full", 8)).toEqual({ threads: null, priority: "normal" });
  expect(effortPlan("balanced", 8)).toEqual({ threads: 4, priority: "below" });
  expect(effortPlan("gentle", 8)).toEqual({ threads: 2, priority: "low" });
  expect(effortPlan("gentle", 2)).toEqual({ threads: 1, priority: "low" });
  expect(effortPlan("balanced", 1).threads).toBe(1);
});

test("balanced until chosen otherwise, and an odd value is ignored", async () => {
  expect(await readEffort(settingsFile())).toBe("balanced");
  expect(await readEffort(settingsFile({ effort: "turbo" }))).toBe("balanced");
  const file = settingsFile();
  await saveSettings(file, { effort: "gentle" });
  expect(await readEffort(file)).toBe("gentle");
});

test("speed is kept for each effort, and guessed from another until measured", async () => {
  const file = settingsFile({ speed: 10 });
  // The old single speed was close to full speed.
  expect(await readSpeed(file, "full")).toBe(10);
  expect(await readSpeed(file, "gentle")).toBe(30);
  await saveSpeed(file, "balanced", 20);
  expect(await readSpeed(file, "balanced")).toBe(20);
  expect(await readSpeed(file, "full")).toBeCloseTo(20 / 1.7);
  expect(await readSpeed(settingsFile(), "full")).toBeNull();
});

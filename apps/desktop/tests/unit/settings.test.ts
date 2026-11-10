import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { FIRST_SETUP, readColours, readSetup, saveSettings, writeColours } from "../../src/main/settings";

let file: string;
beforeEach(() => { file = path.join(mkdtempSync(path.join(tmpdir(), "rowvision-settings-")), "settings.json"); });
afterEach(() => rmSync(path.dirname(file), { recursive: true, force: true }));

test("colours and the last boat are kept side by side", async () => {
  expect(await readSetup(file)).toEqual(FIRST_SETUP);
  await Promise.all([
    writeColours(file, { ground: "#0a3d27", highlight: null }),
    saveSettings(file, { setup: { boat: "4x", side: "scull", seat: 3 } }),
  ]);
  expect(await readColours(file)).toEqual({ ground: "#0a3d27", highlight: null });
  expect(await readSetup(file)).toEqual({ boat: "4x", side: "scull", seat: 3 });
});

test("targets start as the general standard, are kept, and bad saved ones are dropped", async () => {
  const { GENERAL_TARGETS } = await import("../../../web/lib/targets");
  const { readTargets } = await import("../../src/main/settings");
  expect(await readTargets(file)).toEqual(GENERAL_TARGETS);
  const mine = { ...GENERAL_TARGETS, catch_lean_deg: { low: 34, high: 38, counts: true }, catch_knee_deg: { low: 50, high: 55, counts: true } };
  await saveSettings(file, { targets: mine });
  expect(await readTargets(file)).toEqual(mine);
  // A range wider than 5 degrees, written by hand, is not trusted.
  await saveSettings(file, { targets: { ...mine, catch_lean_deg: { low: 10, high: 40, counts: true } } });
  expect(await readTargets(file)).toEqual(GENERAL_TARGETS);
});

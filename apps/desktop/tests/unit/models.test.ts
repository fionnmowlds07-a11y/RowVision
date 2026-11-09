import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ModelsState } from "../../src/shared/bridge";
import { Models } from "../../src/main/models";

const FAKE = path.resolve(__dirname, "../fake-engine.mjs");
const TOTAL = 145_022_899;

let root: string;
let control: string;
let seen: ModelsState[];
let models: Models | null = null;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "rowvision-models-"));
  control = path.join(root, "models-control");
  process.env.FAKE_MODELS_CONTROL = control;
  seen = [];
});
afterEach(() => {
  models?.shutdown();
  models = null;
  delete process.env.FAKE_MODELS_CONTROL;
  rmSync(root, { recursive: true, force: true });
});

function make(engine: string[] | null = [process.env.NODE ?? "node", FAKE]): Models {
  models = new Models({ engine: () => engine, env: () => ({}), onChange: (state) => void seen.push(state) });
  return models;
}

const set = (value: string) => writeFileSync(control, value);

test("models that are there are reported ready, with their size", async () => {
  set("ready");
  const m = make();
  expect(m.snapshot().state).toBe("checking");
  await m.check();
  expect(m.ready()).toBe(true);
  expect(m.snapshot()).toMatchObject({ state: "ready", totalBytes: TOTAL, downloadedBytes: TOTAL, message: null });
});

test("models that are not there say how much there is to download", async () => {
  set("missing");
  const m = make();
  await m.check();
  expect(m.ready()).toBe(false);
  expect(m.snapshot()).toMatchObject({ state: "missing", totalBytes: TOTAL, downloadedBytes: 0 });
});

test("without the engine there is nothing to download", async () => {
  const m = make(null);
  await m.check();
  expect(m.snapshot().state).toBe("no_engine");
  await m.download();
  expect(m.snapshot().state).toBe("no_engine");
});

test("an engine that gives no answer is a failure with plain words, not a hang", async () => {
  const m = make([process.env.NODE ?? "node", "-e", "process.exit(1)"]);
  await m.check();
  expect(m.snapshot().state).toBe("failed");
  expect(m.snapshot().message).toMatch(/internet connection/);
});

test("downloading shows progress that only goes forward, then is ready", async () => {
  set("missing");
  const m = make();
  await m.check();
  seen = [];
  await m.download();
  const downloading = seen.filter((state) => state.state === "downloading").map((state) => state.downloadedBytes);
  expect(downloading.length).toBeGreaterThan(2);
  expect(downloading).toEqual([...downloading].sort((a, b) => a - b));
  expect(seen.at(-1)?.state).toBe("ready");
  expect(m.ready()).toBe(true);
  expect(readFileSync(control, "utf8")).toBe("ready");
});

test("a failed download says why, and trying again can work", async () => {
  set("offline");
  const m = make();
  await m.check();
  await m.download();
  expect(m.snapshot()).toMatchObject({ state: "failed", message: "Couldn't reach the download. Check your internet connection and try again." });
  set("missing");
  await m.download();
  expect(m.snapshot().state).toBe("ready");
  expect(m.snapshot().message).toBeNull();
});

test("what counts is what is on the disk, not what the engine said", async () => {
  // The engine says it is done, but the models are still not there when it is asked again.
  const script = `
    const status = process.argv.includes("status");
    console.log(JSON.stringify(status ? { event: "status", ready: false, download_bytes: 5, total_bytes: 5 } : { event: "done" }));
  `;
  const m = make([process.env.NODE ?? "node", "-e", script, "--"]);
  await m.check();
  expect(m.snapshot()).toMatchObject({ state: "missing", totalBytes: 5 });
  await m.download();
  expect(m.snapshot()).toMatchObject({ state: "failed", message: "We couldn't get the measuring models. Check your internet connection and try again." });
});

test("cancelling stops the download and leaves them missing", async () => {
  set("slow");
  const m = make();
  await m.check();
  expect(m.snapshot().state).toBe("missing");
  const finished = m.download();
  await vi.waitFor(() => expect(m.snapshot()).toMatchObject({ state: "downloading" }), { timeout: 5000 });
  await vi.waitFor(() => expect(m.snapshot().downloadedBytes).toBeGreaterThan(0), { timeout: 5000 });
  m.cancel();
  await finished;
  expect(m.snapshot().state).toBe("missing");
  expect(m.snapshot().downloadedBytes).toBe(0);
});

test("a second download while one is running does nothing extra", async () => {
  set("slow");
  const m = make();
  await m.check();
  const first = m.download();
  await vi.waitFor(() => expect(m.snapshot().state).toBe("downloading"), { timeout: 5000 });
  await m.download();
  set("missing");
  await first;
  expect(m.ready()).toBe(true);
});

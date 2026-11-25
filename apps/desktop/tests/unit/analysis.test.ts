import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { Analyser, ACCURATE_SEAT_SHARE, BEFORE, CREW_SEAT_SHARE, FIRST_SPEED, MOVED, UNEXPECTED, clipWork, jobFor, measuringLeft, overallProgress } from "../../src/main/analysis";
import { readClip } from "../../src/main/library";
import type { Analysis } from "../../src/shared/bridge";
import type { Effort } from "../../src/shared/effort";

const FAKE = path.resolve(__dirname, "../fake-engine.mjs");

let root: string;
let library: string;
let control: string;
let notices: string[];
let speed: number | null;
let engine: string[] | null;
let modelsReady = true;
let accurateReady = true;
let effort: Effort = "balanced";

beforeEach(() => {
  modelsReady = true;
  accurateReady = true;
  effort = "balanced";
  root = mkdtempSync(path.join(tmpdir(), "rowvision-analysis-"));
  library = path.join(root, "clips");
  control = path.join(root, "control");
  process.env.FAKE_ENGINE_CONTROL = control;
  writeFileSync(control, "done");
  notices = [];
  speed = null;
  engine = [process.execPath, FAKE];
});

let analyser: Analyser | null = null;
afterEach(() => {
  analyser?.shutdown();
  analyser = null;
  rmSync(root, { recursive: true, force: true });
});

function make(): Analyser {
  analyser = new Analyser({
    library: () => library,
    engine: () => engine,
    kind: "fake",
    onChange: (_: Analysis) => undefined,
    notify: (title) => void notices.push(title),
    onBattery: () => false,
    readSpeed: async () => speed,
    saveSpeed: async (_, value) => { speed = value; },
    effort: async () => effort,
    cores: () => 8,
    modelsReady: (model) => modelsReady && (model === "standard" || accurateReady),
  });
  return analyser;
}

function addClip(id: string, created: string, extra: Record<string, unknown> = {}) {
  const source = path.join(root, `${id}.mp4`);
  writeFileSync(source, "pretend video");
  mkdirSync(path.join(library, id), { recursive: true });
  writeFileSync(path.join(library, id, "clip.json"), JSON.stringify({
    created_at: created, source, boat_class: "2-", side: "bow", seat: 2, section_start: 3, section_length: 20, tap: null, ...extra,
  }));
}

const state = async (id: string) => (await readClip(library, id))?.state;
const settled = (id: string, want: string) => vi.waitFor(async () => expect(await state(id)).toBe(want), { timeout: 8000, interval: 50 });

test("progress runs across the stages and never goes back", () => {
  expect(overallProgress("Preparing your video", null, 0)).toBe(0);
  expect(overallProgress("Finding boats", 0.5, 0)).toBeCloseTo(0.275);
  expect(overallProgress("Measuring your rower", 1, 0)).toBe(1);
  expect(overallProgress("Finding boats", 0, 0.5)).toBe(0.5);
  expect(overallProgress("Something new", 0.9, 0.3)).toBe(0.3);
  expect(measuringLeft(0.01, 60)).toBeNull();
  expect(measuringLeft(0.5, 60)).toBe(60);
});

test("the job file carries the trim, and leaves the length out when the page could not play it", () => {
  const clip = { source: "/v.mp4", section_start: 3, section_length: 20, boat_class: "2-", side: "bow", seat: 2, tap: null };
  expect(jobFor("/lib/a", clip, "real")).toEqual({
    folder: "/lib/a", source: "/v.mp4", start: 3, length: 20, boat_class: "2-", side: "bow", seat: 2, tap: null, engine: "real", device: "cpu", scope: "seat", model: "standard",
  });
  expect(jobFor("/lib/a", { ...clip, section_length: null }, "real")).not.toHaveProperty("length");
});

test("clips are analysed one at a time, oldest first, and the speed is remembered", async () => {
  addClip("newer", "2026-11-08T11:00:00Z");
  addClip("older", "2026-11-08T10:00:00Z");
  writeFileSync(control, "hang");
  const runner = make();
  await runner.start();
  await vi.waitFor(() => expect(runner.snapshot().running?.id).toBe("older"));
  const waiting = runner.snapshot().waiting;
  expect(waiting.map((item) => item.id)).toEqual(["newer"]);
  expect(waiting[0].secondsUntil).toBeGreaterThan(0);
  writeFileSync(control, "done");
  await settled("older", "done");
  await settled("newer", "done");
  expect(notices).toEqual(["Your clip is ready", "Your clip is ready"]);
  expect(speed).not.toBeNull();
  expect(speed).not.toBe(FIRST_SPEED);
  expect(existsSync(path.join(library, "older", "working.mp4"))).toBe(true);
});

test("a cancelled clip is stopped, and can be started again", async () => {
  addClip("one", "2026-11-08T10:00:00Z");
  writeFileSync(control, "hang");
  const runner = make();
  await runner.start();
  await vi.waitFor(() => expect(runner.snapshot().running?.id).toBe("one"));
  await runner.stop("one");
  await settled("one", "stopped");
  await vi.waitFor(() => expect(runner.snapshot().running).toBeNull());
  writeFileSync(control, "done");
  await runner.restart("one");
  await settled("one", "done");
});

test("a waiting clip can be taken out of the queue", async () => {
  addClip("first", "2026-11-08T10:00:00Z");
  addClip("second", "2026-11-08T11:00:00Z");
  writeFileSync(control, "hang");
  const runner = make();
  await runner.start();
  await vi.waitFor(() => expect(runner.snapshot().running?.id).toBe("first"));
  await runner.stop("second");
  expect(runner.snapshot().waiting).toEqual([]);
  expect(await state("second")).toBe("stopped");
});

test("an engine that dies leaves the clip failed and the queue moving", async () => {
  addClip("first", "2026-11-08T10:00:00Z");
  addClip("second", "2026-11-08T11:00:00Z");
  writeFileSync(control, "hang");
  const runner = make();
  await runner.start();
  await vi.waitFor(() => expect(existsSync(path.join(library, "first", "engine.pid"))).toBe(true));
  process.kill(Number(readFileSync(path.join(library, "first", "engine.pid"), "utf8")), "SIGKILL");
  await settled("first", "failed");
  expect((await readClip(library, "first"))?.message).toBe(UNEXPECTED);
  await vi.waitFor(() => expect(runner.snapshot().running?.id).toBe("second"));
});

test("closing the app leaves the clip waiting, so it starts again next time", async () => {
  addClip("one", "2026-11-08T10:00:00Z");
  writeFileSync(control, "hang");
  const first = make();
  await first.start();
  await vi.waitFor(() => expect(first.snapshot().running?.id).toBe("one"));
  first.shutdown();
  await new Promise((done) => setTimeout(done, 300));
  expect(await state("one")).toBe("waiting");
  writeFileSync(control, "done");
  await make().start();
  await settled("one", "done");
});

test("a clip that needs a tap waits for one, then carries on", async () => {
  addClip("one", "2026-11-08T10:00:00Z");
  writeFileSync(control, "tap");
  const runner = make();
  await runner.start();
  await settled("one", "needs_tap");
  expect((await readClip(library, "one"))?.pauseSeconds).toBe(1);
  expect(notices).toEqual(["Which one is you?"]);
  await runner.tap("one", { t: 1, x: 0.4, y: 0.5 });
  await settled("one", "done");
  expect(JSON.parse(readFileSync(path.join(library, "one", "clip.json"), "utf8")).tap).toEqual({ t: 1, x: 0.4, y: 0.5 });
});

test("a clip measured for one rower can be measured again for the whole crew", async () => {
  addClip("one", "2026-11-08T10:00:00Z");
  const runner = make();
  await runner.start();
  await settled("one", "done");
  await vi.waitFor(() => expect(runner.snapshot().running).toBeNull());
  expect(await runner.measureCrew("one")).toBeNull();
  await vi.waitFor(() => expect(runner.snapshot().running).toBeNull());
  await settled("one", "done");
  expect(JSON.parse(readFileSync(path.join(library, "one", "job.json"), "utf8")).scope).toBe("crew");
  expect(existsSync(path.join(library, "one", BEFORE))).toBe(false);
  expect(await runner.measureCrew("one")).toBe("The whole crew is already measured.");
});

test("a crew run that is stopped gives back the one rower's results", async () => {
  addClip("one", "2026-11-08T10:00:00Z");
  const runner = make();
  await runner.start();
  await settled("one", "done");
  await vi.waitFor(() => expect(runner.snapshot().running).toBeNull());
  const before = readFileSync(path.join(library, "one", "summary.json"), "utf8");
  writeFileSync(control, "hang");
  expect(await runner.measureCrew("one")).toBeNull();
  await vi.waitFor(() => expect(runner.snapshot().running?.id).toBe("one"));
  expect(await state("one")).toBe("waiting");
  await runner.stop("one");
  await settled("one", "done");
  expect(readFileSync(path.join(library, "one", "summary.json"), "utf8")).toBe(before);
  expect(JSON.parse(readFileSync(path.join(library, "one", "clip.json"), "utf8")).scope).toBe("seat");
});

test("a single, or a clip not measured yet, is not measured as a crew", async () => {
  addClip("single", "2026-11-08T10:00:00Z", { boat_class: "1x", seat: 1 });
  addClip("fresh", "2026-11-08T11:00:00Z");
  const runner = make();
  expect(await runner.measureCrew("single")).toBe("This boat has one rower, who is already measured.");
  expect(await runner.measureCrew("fresh")).toBe("Measure this clip first.");
});

test("a moved video fails with a plain message", async () => {
  addClip("one", "2026-11-08T10:00:00Z", { source: path.join(root, "gone.mp4") });
  const runner = make();
  await runner.start();
  await settled("one", "failed");
  expect((await readClip(library, "one"))?.message).toBe(MOVED);
});

test("without the engine, clips wait and nothing runs", async () => {
  addClip("one", "2026-11-08T10:00:00Z");
  engine = null;
  const runner = make();
  await runner.start();
  expect(runner.snapshot()).toMatchObject({ running: null, engineMissing: true, waiting: [{ id: "one" }] });
});

test("clips wait for the measuring models, and start once they are there", async () => {
  modelsReady = false;
  addClip("a", "2026-11-08T09:00:00Z");
  const a = make();
  await a.start();
  expect(a.snapshot()).toMatchObject({ running: null, engineMissing: false, waiting: [{ id: "a", modelMissing: true }] });
  expect(a.snapshot().waiting.map((item) => item.id)).toEqual(["a"]);
  expect(await state("a")).toBe("waiting");
  modelsReady = true;
  await a.next();
  await settled("a", "done");
  expect(a.snapshot().waiting).toEqual([]);
});

test("a clip waiting for the more accurate model does not hold up one that needs only the standard one", async () => {
  accurateReady = false;
  addClip("accurate", "2026-11-08T09:00:00Z", { model: "accurate" });
  addClip("standard", "2026-11-08T10:00:00Z");
  const a = make();
  await a.start();
  await settled("standard", "done");
  await vi.waitFor(() => expect(a.snapshot().running).toBeNull());
  expect(a.snapshot().waiting).toMatchObject([{ id: "accurate", modelMissing: true }]);
  accurateReady = true;
  await a.next();
  await settled("accurate", "done");
  expect(JSON.parse(readFileSync(path.join(library, "accurate", "job.json"), "utf8")).model).toBe("accurate");
});

test("a clip can be analysed again with the more accurate model, keeping its crew", async () => {
  addClip("one", "2026-11-08T10:00:00Z", { scope: "crew" });
  const runner = make();
  await runner.start();
  await settled("one", "done");
  await vi.waitFor(() => expect(runner.snapshot().running).toBeNull());
  expect(await runner.analyseAccurately("one")).toBeNull();
  await vi.waitFor(() => expect(runner.snapshot().running).toBeNull());
  await settled("one", "done");
  expect(JSON.parse(readFileSync(path.join(library, "one", "job.json"), "utf8"))).toMatchObject({ scope: "crew", model: "accurate" });
  expect(existsSync(path.join(library, "one", BEFORE))).toBe(false);
  expect(await runner.analyseAccurately("one")).toBe("This clip already used the more accurate model.");
});

test("a more accurate run that is stopped gives back the results and the model it had", async () => {
  addClip("one", "2026-11-08T10:00:00Z", { scope: "crew" });
  const runner = make();
  await runner.start();
  await settled("one", "done");
  await vi.waitFor(() => expect(runner.snapshot().running).toBeNull());
  const before = readFileSync(path.join(library, "one", "summary.json"), "utf8");
  writeFileSync(control, "hang");
  expect(await runner.analyseAccurately("one")).toBeNull();
  await vi.waitFor(() => expect(runner.snapshot().running?.id).toBe("one"));
  await runner.stop("one");
  await settled("one", "done");
  expect(readFileSync(path.join(library, "one", "summary.json"), "utf8")).toBe(before);
  const clip = JSON.parse(readFileSync(path.join(library, "one", "clip.json"), "utf8"));
  expect(clip).toMatchObject({ scope: "crew", model: "standard" });
  expect(clip).not.toHaveProperty("before");
});

test("the more accurate model is expected to take longer, and a crew longer still", () => {
  const clip = { boat_class: "8+", section_length: 10 };
  expect(clipWork({ ...clip, model: "accurate" })).toBe(clipWork(clip) + 10 * ACCURATE_SEAT_SHARE);
  const crew = { ...clip, scope: "crew" };
  expect(clipWork({ ...crew, model: "accurate" })).toBe(clipWork(crew) + 80 * ACCURATE_SEAT_SHARE);
});

test("a crew job asks the engine for every seat, and is expected to take longer", () => {
  const clip = { boat_class: "4-", side: "bow", seat: 2, section_length: 30 };
  expect(jobFor("/lib/a", clip, "real").scope).toBe("seat");
  expect(jobFor("/lib/a", { ...clip, scope: "crew" }, "real").scope).toBe("crew");
  expect(clipWork(clip)).toBe(30);
  expect(clipWork({ ...clip, scope: "crew" })).toBeCloseTo(30 * (1 + 3 * CREW_SEAT_SHARE));
  expect(clipWork({ ...clip, scope: "crew", boat_class: "1x" })).toBe(30);
});

test("measuring a crew counts as the measuring stage", () => {
  expect(overallProgress("Measuring your crew", 0.5, 0)).toBeCloseTo(0.7);
});

test("a coach's crew tells the engine a click only picks the boat", () => {
  expect(jobFor("f", { scope: "crew", coach: true }, "real").coach).toBe(true);
  expect(jobFor("f", { scope: "seat", coach: true }, "real").coach).toBeUndefined();
  expect(jobFor("f", { scope: "crew" }, "real").coach).toBeUndefined();
});

test("the rig goes to the engine when the clip has one", () => {
  const rig = ["stroke", "bow", "bow", "stroke"];
  expect(jobFor("f", { boat_class: "4-", rig }, "real").rig).toEqual(rig);
  expect(jobFor("f", { boat_class: "4-" }, "real").rig).toBeUndefined();
});

test("the job says how many cores and what priority, from the effort chosen", async () => {
  addClip("one", "2026-11-08T10:00:00Z");
  effort = "gentle";
  const runner = make();
  await runner.start();
  await settled("one", "done");
  const job = JSON.parse(readFileSync(path.join(library, "one", "job.json"), "utf8"));
  expect([job.threads, job.priority]).toEqual([2, "low"]);
  expect(runner.snapshot().effort).toBe("gentle");
});

test("full speed leaves the cores to the engine and runs at normal priority", async () => {
  addClip("one", "2026-11-08T10:00:00Z");
  effort = "full";
  await make().start();
  await settled("one", "done");
  const job = JSON.parse(readFileSync(path.join(library, "one", "job.json"), "utf8"));
  expect(job.threads).toBeUndefined();
  expect(job.priority).toBe("normal");
});

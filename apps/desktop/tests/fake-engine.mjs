// Stands in for the real engine in tests: same job file, same progress lines, no models.
// What it does comes from the file named by FAKE_ENGINE_CONTROL, read again as it goes:
// "done" finishes, "hang" waits, "tap" asks which rower is you, "fail" fails.
import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

// `--models status` and `--models fetch`, as the real engine has. What it does comes from the file named by
// FAKE_MODELS_CONTROL (ready when there is none): "ready", "missing", "offline" (fetching fails) or "slow"
// (fetching stops part way until the file changes).
const TOTAL = 145_022_899;
if (process.argv[2] === "--models") {
  const state = () => {
    try {
      return readFileSync(process.env.FAKE_MODELS_CONTROL, "utf8").trim();
    } catch {
      return "ready";
    }
  };
  const say = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
  const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
  if (process.argv[3] === "status") {
    say({ event: "status", ready: state() === "ready", download_bytes: state() === "ready" ? 0 : TOTAL, total_bytes: TOTAL });
    process.exit(0);
  }
  let stopped = false;
  process.stdin.on("data", (chunk) => { if (chunk.toString().includes("cancel")) stopped = true; });
  process.stdin.on("end", () => { stopped = true; });
  process.stdin.resume();
  say({ event: "models", downloaded: 0, total: TOTAL });
  if (state() === "offline") {
    say({ event: "failed", message: "Couldn't reach the download. Check your internet connection and try again." });
    process.exit(1);
  }
  say({ event: "models", downloaded: Math.round(TOTAL * 0.4), total: TOTAL });
  while (state() === "slow" && !stopped) await sleep(50);
  if (stopped) {
    say({ event: "cancelled" });
    process.exit(4);
  }
  say({ event: "models", downloaded: Math.round(TOTAL * 0.8), total: TOTAL });
  await sleep(100);
  writeFileSync(process.env.FAKE_MODELS_CONTROL, "ready");
  say({ event: "models", downloaded: TOTAL, total: TOTAL });
  say({ event: "done" });
  process.exit(0);
}

// `--version` and `--remeasure FOLDER`, as the real engine has. Measuring again stamps the result with this version.
const VERSION = "fake-2";
if (process.argv[2] === "--version") {
  process.stdout.write(`${JSON.stringify({ event: "version", version: VERSION })}\n`);
  process.exit(0);
}
if (process.argv[2] === "--remeasure") {
  const say = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
  const kept = path.join(process.argv[3], "summary.json");
  if (!existsSync(path.join(process.argv[3], "frames.json"))) {
    say({ event: "failed", message: "This clip can't be measured again, as its video was removed. Its scores are unchanged." });
    process.exit(1);
  }
  const summary = { ...JSON.parse(readFileSync(kept, "utf8")), version: VERSION };
  writeFileSync(kept, JSON.stringify(summary));
  say({ event: "done", version: VERSION, accuracy: null, band: null, overall: null });
  process.exit(0);
}

const job = JSON.parse(readFileSync(process.argv[2], "utf8"));
const folder = job.folder;
const mode = () => {
  try {
    return readFileSync(process.env.FAKE_ENGINE_CONTROL, "utf8").trim();
  } catch {
    return "done";
  }
};
const send = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
let cancelled = false;
process.stdin.on("data", (chunk) => { if (chunk.toString().includes("cancel")) cancelled = true; });
process.stdin.on("end", () => { cancelled = true; });
process.stdin.resume();

function stopIfCancelled() {
  if (!cancelled) return;
  send({ event: "cancelled" });
  process.exit(4);
}

writeFileSync(path.join(folder, "engine.pid"), String(process.pid));
rmSync(path.join(folder, "pause.json"), { force: true });

const copy = path.join(folder, "working.mp4");
if (!existsSync(copy)) {
  send({ event: "stage", stage: "Preparing your video", progress: null });
  await wait(100);
  copyFileSync(job.source, copy);
  writeFileSync(path.join(folder, "video.json"), JSON.stringify({ fps: 30, frames: 180, width: 320, height: 180 }));
}
send({ event: "stage", stage: "Loading the pose model", progress: null });
await wait(100);
send({ event: "stage", stage: "Finding boats", progress: 0.5 });

while (mode() === "hang") {
  stopIfCancelled();
  await wait(100);
}
stopIfCancelled();

if (mode() === "fail") {
  send({ event: "failed", message: "We couldn't analyse this clip. Try another clip, or send it to us." });
  process.exit(1);
}
if (mode() === "tap" && !job.tap) {
  const pause = { frame: 30, seconds: 1, boats: [] };
  writeFileSync(path.join(folder, "pause.json"), JSON.stringify(pause));
  send({ event: "needs_tap", pause });
  process.exit(3);
}

send({ event: "stage", stage: "Measuring your rower", progress: 0.5 });
await wait(100);
const summary = { version: "fake", fps: 30, frames: 180, view_deg: 0, film_closer: null, warnings: [], shots: [], facing: 1, rower: null };
writeFileSync(path.join(folder, "frames.json"), JSON.stringify({ views: null, poses: [], angles: {} }));
writeFileSync(path.join(folder, "summary.json"), JSON.stringify(summary));
send({ event: "done", version: "fake", accuracy: null, band: null, overall: null });
process.exit(0);

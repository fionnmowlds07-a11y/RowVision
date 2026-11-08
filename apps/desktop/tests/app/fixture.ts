/**
 * Makes a throwaway clip for the app tests: never real footage. Each frame is one flat colour
 * that encodes its own number, so a test can read which frame the video is really showing.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export const FPS = 30;
export const FRAMES = 90;
export const WIDTH = 320;
export const HEIGHT = 180;
export const CATCHES = [12, 42, 72];
export const FINISHES = [27, 57, 87];
const BASE = 30;
const STEP = 22;

export function colourOf(frame: number): [number, number, number] {
  return [BASE + (frame % 10) * STEP, BASE + Math.floor(frame / 10) * STEP, 128];
}

/** The frame a colour stands for, or null when it is not close to any. */
export function frameOf([r, g]: number[]): number | null {
  const units = Math.round((r - BASE) / STEP);
  const tens = Math.round((g - BASE) / STEP);
  const [er, eg] = colourOf(tens * 10 + units);
  if (units < 0 || units > 9 || tens < 0 || Math.abs(er - r) > 8 || Math.abs(eg - g) > 8) return null;
  return tens * 10 + units;
}

/** Plays in Chromium unless an older codec is asked for, which only ffmpeg can read. */
export function makeVideo(file: string, { frames = FRAMES, codec = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "10"] } = {}) {
  const frame = Buffer.alloc(WIDTH * HEIGHT * 3);
  const raw: Buffer[] = [];
  for (let n = 0; n < frames; n++) {
    const [r, g, b] = colourOf(n % 100);
    for (let i = 0; i < frame.length; i += 3) {
      frame[i] = r;
      frame[i + 1] = g;
      frame[i + 2] = b;
    }
    raw.push(Buffer.from(frame));
  }
  // Keyframes a second apart, with B-frames, so stepping back has to decode from an earlier keyframe.
  const result = spawnSync(process.env.FFMPEG ?? "ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${WIDTH}x${HEIGHT}`, "-r", String(FPS), "-i", "pipe:0",
    ...codec, "-g", String(FPS), "-bf", "2",
    "-pix_fmt", "yuv420p", ...(file.endsWith(".mp4") ? ["-color_range", "tv", "-movflags", "+faststart"] : []), file,
  ], { input: Buffer.concat(raw) });
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${result.stderr?.toString() ?? result.error}`);
}

/** An MPEG-4 Part 2 video in AVI, as older cameras make: ffmpeg reads it, Chromium cannot. */
export const OLD_CODEC = ["-c:v", "mpeg4", "-q:v", "3"];

function pose(frame: number) {
  const sway = Math.sin((frame / 30) * 2 * Math.PI) * 20;
  const joint = (x: number, y: number) => [x + sway, y, 0.9];
  const points = [
    joint(160, 40), joint(162, 38), joint(158, 38), joint(165, 40), joint(155, 40),
    joint(170, 60), joint(150, 60), joint(185, 85), joint(140, 85), joint(200, 100), joint(130, 100),
    joint(165, 120), joint(155, 120), joint(195, 110), joint(185, 110), joint(220, 150), joint(210, 150),
  ];
  return points;
}

export function makeClip(library: string, id = "test-clip") {
  const folder = path.join(library, id);
  mkdirSync(folder, { recursive: true });
  makeVideo(path.join(folder, "working.mp4"));
  const series = (value: (n: number) => number) => Array.from({ length: FRAMES }, (_, n) => value(n));
  const target = { low: 26, high: 31, sources: [], evidence: "Test target." };
  const summary = {
    version: "test",
    fps: FPS,
    frames: FRAMES,
    view_deg: 0,
    film_closer: null,
    warnings: [],
    shots: [],
    facing: 1,
    rower: {
      seat: 2,
      rate_spm: 30,
      catches: CATCHES,
      finishes: FINISHES,
      strokes: CATCHES.map((c, i) => ({ catch_frame: c, finish_frame: FINISHES[i], catch_lean_deg: 28 })),
      timing: null,
      card: {
        overall: 84,
        phases: { catch: 84, finish: 80 },
        metrics: [
          { name: "catch_lean_deg", label: "Body angle at the catch", phase: "catch", value: 28, spread: 1, target, score: 100, reason: null },
          // Knees are shown but never scored.
          { name: "catch_knee_deg", label: "Knee at the catch", phase: "catch", value: 60, spread: 2, target: { ...target, low: 50, high: 55 }, score: null, reason: "Knees are a rough guide." },
        ],
      },
      rating: { accuracy: 76, band: "Good", calibrated: true, labelled_frames: 108, warnings: [] },
    },
  };
  const frames = {
    views: null,
    poses: series((n) => n).map(pose),
    angles: { trunk: series((n) => 20 + (n % 30)), knee: series((n) => 60 + (n % 30) * 3), elbow: series(() => 170) },
  };
  writeFileSync(path.join(folder, "summary.json"), JSON.stringify(summary));
  writeFileSync(path.join(folder, "frames.json"), JSON.stringify(frames));
  writeFileSync(path.join(folder, "video.json"), JSON.stringify({ fps: FPS, frames: FRAMES, width: WIDTH, height: HEIGHT }));
  writeFileSync(path.join(folder, "clip.json"), JSON.stringify({ created_at: "2026-11-08T09:00:00Z", boat_class: "2-", side: "bow", seat: 2, note: "Test clip" }));
  return folder;
}

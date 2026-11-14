import { promises as fs } from "node:fs";
import path from "node:path";
import type { Summary } from "../../../web/lib/result";
import { rescore, type TargetChoices } from "../../../web/lib/targets";
import { CLIP_ID, type ClipDetail, type ClipItem, type ClipSetup, type ClipState, type Space } from "../shared/bridge";

/** Kept in a clip's folder when the user stopped it or it failed. Gone when it goes back in the queue. */
export const STATE_FILE = "state.json";
/** Written by the engine when it needs the user to say which rower they are. */
export const PAUSE_FILE = "pause.json";

/** Each clip is a folder named by its id, holding what the engine writes. */
export async function listClips(library: string, targets: TargetChoices | null = null): Promise<ClipItem[]> {
  let names: string[];
  try {
    names = await fs.readdir(library);
  } catch {
    return [];
  }
  const clips = await Promise.all(names.filter((name) => CLIP_ID.test(name)).map((name) => readClip(library, name, targets)));
  return clips
    .filter((clip): clip is ClipDetail => clip !== null)
    .map(({ summary: _summary, pauseSeconds: _pause, ...item }) => item)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** With the athlete's targets, the scores are worked out again from the saved measurements. */
export async function readClip(library: string, id: string, targets: TargetChoices | null = null): Promise<ClipDetail | null> {
  if (!CLIP_ID.test(id)) return null;
  const folder = path.join(library, id);
  let stat;
  try {
    stat = await fs.stat(folder);
  } catch {
    return null;
  }
  if (!stat.isDirectory()) return null;
  const raw = (await readJson(path.join(folder, "clip.json"))) as Record<string, unknown> | null;
  const setup = asSetup(raw);
  // The desktop engine adds its version to the summary it writes.
  const saved = (await readJson(path.join(folder, "summary.json"))) as (Summary & { version?: string }) | null;
  const summary = saved?.rower ? { ...saved, rower: rescore(saved.rower, targets) } : saved;
  const rower = summary?.rower ?? null;
  const marked = (await readJson(path.join(folder, STATE_FILE))) as { state?: unknown; message?: unknown } | null;
  const pause = (await readJson(path.join(folder, PAUSE_FILE))) as { seconds?: unknown } | null;
  let state: ClipState = "waiting";
  if (summary) state = "done";
  else if (marked?.state === "stopped" || marked?.state === "failed") state = marked.state;
  else if (pause) state = "needs_tap";
  return {
    id,
    createdAt: typeof setup.created_at === "string" ? setup.created_at : stat.birthtime.toISOString(),
    setup,
    state,
    message: state === "failed" && typeof marked?.message === "string" ? marked.message : null,
    pauseSeconds: state === "needs_tap" && typeof pause?.seconds === "number" ? pause.seconds : null,
    analysed: summary !== null,
    overall: rower?.card.overall ?? null,
    band: rower?.rating.band ?? null,
    accuracy: rower?.rating.accuracy ?? null,
    rate: rower?.rate_spm ?? null,
    version: summary?.version ?? null,
    metrics: [...(rower?.card.metrics ?? []), ...(rower?.card.extras ?? [])].map(({ name, value }) => ({ name, value })),
    bytes: await folderBytes(folder),
    videoBytes: await fileBytes(path.join(folder, "working.mp4")),
    summary,
    hasVideo: await exists(path.join(folder, "working.mp4")),
    sentAt: typeof raw?.sent_at === "string" ? raw.sent_at : null,
  };
}

export async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return null;
  }
}

function asSetup(value: unknown): ClipSetup {
  if (!value || typeof value !== "object") return {};
  const raw = value as Record<string, unknown>;
  const setup: ClipSetup = {};
  if (typeof raw.created_at === "string") setup.created_at = raw.created_at;
  if (typeof raw.boat_class === "string") setup.boat_class = raw.boat_class;
  if (typeof raw.side === "string") setup.side = raw.side;
  if (typeof raw.seat === "number") setup.seat = raw.seat;
  if (typeof raw.note === "string") setup.note = raw.note;
  if (typeof raw.filmed_at === "string") setup.filmed_at = raw.filmed_at;
  return setup;
}

async function exists(file: string): Promise<boolean> {
  try {
    return (await fs.stat(file)).isFile();
  } catch {
    return false;
  }
}

async function fileBytes(file: string): Promise<number> {
  try {
    return (await fs.stat(file)).size;
  } catch {
    return 0;
  }
}

async function folderBytes(folder: string): Promise<number> {
  let total = 0;
  for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
    const full = path.join(folder, entry.name);
    if (entry.isFile()) total += (await fs.stat(full)).size;
    else if (entry.isDirectory()) total += await folderBytes(full);
  }
  return total;
}

/** Written beside the target first, so a crash never leaves half a file. */
export async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.writeFile(`${file}.tmp`, JSON.stringify(value, null, 2));
  await fs.rename(`${file}.tmp`, file);
}

/** Mark a clip stopped or failed, or with null put it back in the queue. */
export async function markClip(library: string, id: string, state: "stopped" | "failed" | null, message?: string): Promise<void> {
  const file = path.join(library, id, STATE_FILE);
  if (state === null) await fs.rm(file, { force: true });
  else await writeJson(file, { state, message: message ?? null });
}

/** What the library uses, and what is left on the disk it lives on. */
export async function librarySpace(library: string, clips: ClipItem[]): Promise<Space> {
  const videoBytes = clips.reduce((sum, clip) => sum + clip.videoBytes, 0);
  const otherBytes = clips.reduce((sum, clip) => sum + clip.bytes - clip.videoBytes, 0);
  let freeBytes: number | null = null;
  for (let folder = library; ; folder = path.dirname(folder)) {
    try {
      const disk = await fs.statfs(folder);
      freeBytes = disk.bavail * disk.bsize;
      break;
    } catch {
      if (path.dirname(folder) === folder) break;
    }
  }
  return { videoBytes, otherBytes, freeBytes };
}

export async function deleteClip(library: string, id: string): Promise<void> {
  if (!CLIP_ID.test(id)) throw new Error("Not a clip");
  // Windows can hold a file a moment after the engine closes it.
  await fs.rm(path.join(library, id), { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

/** Only once analysed, as the engine needs the working copy until then. */
export async function removeVideo(library: string, id: string): Promise<void> {
  const clip = await readClip(library, id);
  if (clip?.state !== "done") throw new Error("Not analysed yet");
  const folder = path.join(library, id);
  await fs.rm(path.join(folder, "working.mp4"), { force: true });
  await fs.rm(path.join(folder, "frames.json"), { force: true });
}

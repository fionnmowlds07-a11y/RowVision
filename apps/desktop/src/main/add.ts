import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { MIN_SECONDS, SECTION_SECONDS } from "../../../web/lib/clip-checks";
import { isRig } from "../../../web/lib/rigs";
import { BOAT_SEATS } from "../../../web/lib/setup";
import type { AddRequest } from "../shared/bridge";
import { poseModel } from "../shared/pose-model";
import { writeJson } from "./library";
import { cleanSetup } from "./settings";

/** Videos the engine's ffmpeg can read, even where the page cannot play them. */
export const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".m4v", ".avi", ".mkv", ".webm", ".mts", ".m2ts", ".3gp"]);
const NOTE_LIMIT = 200;

export function isVideoName(name: string): boolean {
  return VIDEO_EXTENSIONS.has(path.extname(name).toLowerCase());
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const share = (value: unknown) => finite(value) && value >= 0 && value <= 1;

/** Check everything the page sends, as the page is never trusted with the computer's files. */
export function cleanAdd(value: unknown): AddRequest | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const { source, filmedAt, note, section, tap } = raw;
  if (typeof source !== "string" || source.length > 4096 || source.includes("\0")) return null;
  if (!path.isAbsolute(source) || !isVideoName(source)) return null;
  if (typeof filmedAt !== "string" || Number.isNaN(Date.parse(filmedAt))) return null;
  const setup = cleanSetup(raw.setup);
  if (!setup) return null;
  if (typeof note !== "string" || note.length > NOTE_LIMIT) return null;

  if (!section || typeof section !== "object") return null;
  const { start, length } = section as Record<string, unknown>;
  if (!finite(start) || start < 0) return null;
  // A little slack, as the trim is made of half-second steps.
  if (length !== null && (!finite(length) || length < MIN_SECONDS - 0.01 || length > SECTION_SECONDS + 0.01)) return null;

  let point: AddRequest["tap"] = null;
  if (tap !== null) {
    if (!tap || typeof tap !== "object") return null;
    const { t, x, y } = tap as Record<string, unknown>;
    if (!finite(t) || t < 0 || !share(x) || !share(y)) return null;
    point = { t, x: x as number, y: y as number };
  }

  // Older pages send no scope. A single has no crew to measure.
  if (raw.scope !== undefined && raw.scope !== "seat" && raw.scope !== "crew") return null;
  const scope = raw.scope === "crew" && BOAT_SEATS[setup.boat] > 1 ? "crew" : "seat";

  // A coach's crew follows no one rower, so it has no tap.
  const coach = raw.coach === true && scope === "crew";
  // The rig decides each seat's side, so the side given must be the rig's side for that seat.
  if (raw.rig !== undefined && (!isRig(setup.boat, raw.rig) || raw.rig[setup.seat - 1] !== setup.side)) return null;
  const rig = raw.rig as AddRequest["rig"];
  if (raw.model !== undefined && raw.model !== "accurate" && raw.model !== "standard") return null;
  return { source, filmedAt: new Date(filmedAt).toISOString(), setup, note: note.trim(), section: { start, length: length as number | null }, tap: coach ? null : point, scope, coach, ...(rig ? { rig: [...rig] } : {}), model: poseModel(raw.model) };
}

/** Make the clip's folder. The video itself is left where it is. */
export async function addClip(library: string, request: AddRequest, now = new Date()): Promise<string> {
  const stat = await fs.stat(request.source).catch(() => null);
  if (!stat?.isFile()) throw new Error("That video can't be found. Has it been moved?");
  const id = randomUUID();
  const folder = path.join(library, id);
  await fs.mkdir(folder, { recursive: true });
  const clip = {
    created_at: now.toISOString(),
    filmed_at: request.filmedAt,
    source: request.source,
    source_bytes: stat.size,
    boat_class: request.setup.boat,
    side: request.setup.side,
    seat: request.setup.seat,
    note: request.note,
    section_start: request.section.start,
    section_length: request.section.length,
    tap: request.tap,
    scope: request.scope,
    ...(request.coach ? { coach: true } : {}),
    ...(request.rig ? { rig: request.rig } : {}),
    model: poseModel(request.model),
  };
  await writeJson(path.join(folder, "clip.json"), clip);
  return id;
}

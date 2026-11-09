import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { readClip, readJson, writeJson } from "./library";

export type Consent = { note: string; adult: boolean; allowed: boolean };

/** Only a short note and two ticks come from the page, and both ticks are needed. */
export function cleanConsent(value: unknown): Consent | null {
  if (!value || typeof value !== "object") return null;
  const { note, adult, allowed } = value as Record<string, unknown>;
  if (typeof note !== "string" || note.length > 1000 || adult !== true || allowed !== true) return null;
  return { note: note.trim(), adult, allowed };
}

/**
 * Send one analysed clip: its working copy, setup and results, and nothing else.
 * The service hands out one-time links, so the app holds no storage keys.
 */
export async function sendClip(library: string, id: string, consent: Consent, base: string, progress: (sent: number, total: number) => void): Promise<void> {
  const clip = await readClip(library, id);
  if (clip?.state !== "done" || !clip.hasVideo) throw new Error("Only analysed clips with their video can be sent");
  const folder = path.join(library, id);
  const record = ((await readJson(path.join(folder, "clip.json"))) ?? {}) as Record<string, unknown>;

  const asked = await fetch(new URL("/sends", base), { method: "POST" });
  if (!asked.ok) throw new Error("No upload links");
  const { id: sendId, uploads } = (await asked.json()) as { id: string; uploads: { video: string; meta: string } };

  const meta = Buffer.from(JSON.stringify({
    setup: { boat: record.boat_class, side: record.side, seat: record.seat, section_start: record.section_start, section_length: record.section_length },
    summary: clip.summary,
    note: consent.note,
    consent: { adult: consent.adult, allowed: consent.allowed },
  }));
  const video = path.join(folder, "working.mp4");
  const total = (await fs.stat(video)).size;
  let sent = 0;
  const counted = createReadStream(video).on("data", (chunk) => {
    sent += chunk.length;
    progress(sent, total);
  });
  const putVideo = await fetch(new URL(uploads.video, base), {
    method: "PUT", body: Readable.toWeb(counted) as ReadableStream, headers: { "content-length": String(total) }, duplex: "half",
  } as RequestInit);
  if (!putVideo.ok) throw new Error("Video upload failed");
  const putMeta = await fetch(new URL(uploads.meta, base), { method: "PUT", body: meta, headers: { "content-length": String(meta.length) } });
  if (!putMeta.ok) throw new Error("Results upload failed");
  const done = await fetch(new URL(`/sends/${sendId}/done`, base), { method: "POST" });
  if (!done.ok) throw new Error("Send not finished");
  await writeJson(path.join(folder, "clip.json"), { ...record, sent_at: new Date().toISOString() });
}

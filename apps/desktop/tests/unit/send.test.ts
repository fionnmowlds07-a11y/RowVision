import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { cleanConsent, sendClip } from "../../src/main/send";
import { makeServer } from "../../../../services/intake/server.mjs";

let root: string;
let received: string;
let server: Server;
let base: string;

beforeEach(async () => {
  root = mkdtempSync(path.join(tmpdir(), "rowvision-send-"));
  received = path.join(root, "received");
  server = makeServer({ folder: received, adminToken: "x" });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterEach(() => {
  server.close();
  rmSync(root, { recursive: true, force: true });
});

function clip(id: string, files: Record<string, string>) {
  mkdirSync(path.join(root, "clips", id), { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(path.join(root, "clips", id, name), text);
}

const agreed = { note: " late catch ", adult: true, allowed: true };

test("both ticks are needed, and the note is kept short", () => {
  expect(cleanConsent(agreed)).toEqual({ note: "late catch", adult: true, allowed: true });
  expect(cleanConsent({ ...agreed, adult: false })).toBeNull();
  expect(cleanConsent({ ...agreed, allowed: "yes" })).toBeNull();
  expect(cleanConsent({ ...agreed, note: "x".repeat(1001) })).toBeNull();
});

test("a clip is sent with its setup and results, and nothing about where it came from", async () => {
  const record = { created_at: "2026-11-08T10:00:00Z", source: "/home/someone/Videos/private name.mp4", boat_class: "2-", side: "bow", seat: 2, note: "my own note" };
  clip("one", { "working.mp4": "video bytes", "summary.json": JSON.stringify({ fps: 30, frames: 90, rower: null }), "clip.json": JSON.stringify(record) });
  const seen: number[] = [];
  await sendClip(path.join(root, "clips"), "one", cleanConsent(agreed)!, base, (sent) => seen.push(sent));
  const [sendId] = readdirSync(received);
  expect(readFileSync(path.join(received, sendId, "working.mp4"), "utf8")).toBe("video bytes");
  const meta = readFileSync(path.join(received, sendId, "meta.json"), "utf8");
  expect(JSON.parse(meta)).toMatchObject({ setup: { boat: "2-", side: "bow", seat: 2 }, note: "late catch", consent: { adult: true, allowed: true } });
  for (const secret of ["private name", "someone", "my own note"]) expect(meta).not.toContain(secret);
  expect(seen.at(-1)).toBe(11);
  expect(JSON.parse(readFileSync(path.join(root, "clips", "one", "clip.json"), "utf8")).sent_at).toBeTruthy();
});

test("a clip not yet analysed is not sent", async () => {
  clip("waiting", { "working.mp4": "video", "clip.json": "{}" });
  await expect(sendClip(path.join(root, "clips"), "waiting", cleanConsent(agreed)!, base, () => undefined)).rejects.toThrow();
  expect(existsSync(received)).toBe(false);
});

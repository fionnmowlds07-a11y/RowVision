// Receives clips athletes choose to send from the desktop app.
// The app asks for a send, gets one-time upload links, uploads, then says it is done.
// No storage keys are ever in the app. This is the local stand-in: files go to a folder.
// The hosted version would hand out R2 presigned links instead. Nothing is deployed.
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createWriteStream, promises as fs } from "node:fs";
import http from "node:http";
import path from "node:path";
import { pipeline } from "node:stream/promises";

export const FILES = { video: { name: "working.mp4", limit: 1024 ** 3 }, meta: { name: "meta.json", limit: 5 * 1024 ** 2 } };
const LINK_MS = 60 * 60 * 1000;
const ID = /^[0-9a-f-]{36}$/;

export function makeServer({ folder, adminToken, now = () => Date.now() }) {
  // One-time links: token -> where it may write, until when.
  const links = new Map();

  const json = (res, status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const same = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://intake");
      const parts = url.pathname.split("/").filter(Boolean);

      if (req.method === "POST" && url.pathname === "/sends") {
        const id = randomUUID();
        await fs.mkdir(path.join(folder, id), { recursive: true });
        const uploads = {};
        for (const kind of Object.keys(FILES)) {
          const token = randomBytes(24).toString("hex");
          links.set(token, { id, kind, until: now() + LINK_MS });
          uploads[kind] = `/upload/${token}`;
        }
        return json(res, 201, { id, uploads });
      }

      if (req.method === "PUT" && parts[0] === "upload" && parts.length === 2) {
        const link = links.get(parts[1]);
        links.delete(parts[1]);
        if (!link || link.until < now()) return json(res, 403, { error: "link_used_or_expired" });
        const { name, limit } = FILES[link.kind];
        const size = Number(req.headers["content-length"]);
        if (!Number.isFinite(size) || size > limit) return json(res, 413, { error: "too_big" });
        const part = path.join(folder, link.id, `${name}.part`);
        await pipeline(req, createWriteStream(part));
        if ((await fs.stat(part)).size !== size) return json(res, 400, { error: "incomplete" });
        await fs.rename(part, path.join(folder, link.id, name));
        return json(res, 200, { ok: true });
      }

      if (req.method === "POST" && parts[0] === "sends" && ID.test(parts[1] ?? "") && parts[2] === "done") {
        const where = path.join(folder, parts[1]);
        const have = await fs.readdir(where).catch(() => []);
        if (!Object.values(FILES).every(({ name }) => have.includes(name))) return json(res, 409, { error: "missing_files" });
        await fs.writeFile(path.join(where, "received.json"), JSON.stringify({ at: new Date(now()).toISOString() }));
        return json(res, 200, { ok: true });
      }

      // The owner's list of what has come in.
      if (req.method === "GET" && url.pathname === "/admin/sends") {
        const given = (req.headers.authorization ?? "").replace(/^Bearer /, "");
        if (!adminToken || !same(given, adminToken)) return json(res, 401, { error: "not_allowed" });
        const sends = [];
        for (const id of await fs.readdir(folder).catch(() => [])) {
          const received = await fs.readFile(path.join(folder, id, "received.json"), "utf8").catch(() => null);
          if (!received) continue;
          const meta = JSON.parse(await fs.readFile(path.join(folder, id, "meta.json"), "utf8"));
          sends.push({ id, received: JSON.parse(received).at, setup: meta.setup, note: meta.note, consent: meta.consent });
        }
        sends.sort((a, b) => b.received.localeCompare(a.received));
        return json(res, 200, { sends });
      }

      return json(res, 404, { error: "not_found" });
    } catch {
      return json(res, 500, { error: "failed" });
    }
  });
}

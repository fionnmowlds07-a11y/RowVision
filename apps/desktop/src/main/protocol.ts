import { createReadStream, promises as fs } from "node:fs";
import { Readable } from "node:stream";
import { protocol } from "electron";
import { APP_ORIGIN } from "../shared/bridge";
import { CSP } from "./csp";
import { clipFile, contentType, pageFile } from "./paths";
import { parseRange } from "./range";

/** Must run before the app is ready. */
export function registerSchemes() {
  protocol.registerSchemesAsPrivileged([
    { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } },
    { scheme: "rowvision", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
  ]);
}

export function serve(pageRoot: string, library: string) {
  protocol.handle("app", async (request) => {
    const file = request.method === "GET" ? pageFile(pageRoot, request.url) : null;
    if (!file) return notFound();
    const response = await sendFile(file, null);
    if (response.status === 200 && file.endsWith(".html")) response.headers.set("Content-Security-Policy", CSP);
    return response;
  });

  protocol.handle("rowvision", async (request) => {
    const file = request.method === "GET" ? clipFile(library, request.url) : null;
    if (!file) return notFound();
    const response = await sendFile(file, request.headers.get("range"));
    response.headers.set("Access-Control-Allow-Origin", APP_ORIGIN);
    response.headers.set("Cache-Control", "no-store");
    return response;
  });
}

async function sendFile(file: string, rangeHeader: string | null): Promise<Response> {
  let size: number;
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile()) return notFound();
    size = stat.size;
  } catch {
    return notFound();
  }
  const range = parseRange(rangeHeader, size);
  const type = contentType(file);
  if (range === "invalid") {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  }
  const { start, end } = range ?? { start: 0, end: Math.max(size - 1, 0) };
  const body = size === 0 ? null : (Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream);
  const headers = new Headers({
    "Content-Type": type,
    "Content-Length": String(size === 0 ? 0 : end - start + 1),
    "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff",
  });
  if (range) headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
  return new Response(body, { status: range ? 206 : 200, headers });
}

function notFound() {
  return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain" } });
}

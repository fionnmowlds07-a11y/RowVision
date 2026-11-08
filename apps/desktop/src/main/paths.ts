import path from "node:path";
import { CLIP_ID, SERVED_FILES } from "../shared/bridge";

/** The file a rowvision:// address points at, or null when it is not one the page may load. */
export function clipFile(library: string, url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "rowvision:" || parsed.host !== "clip" || parsed.search || parsed.hash) return null;
  // The raw path is checked, so encoded slashes and dots cannot sneak through.
  const parts = parsed.pathname.split("/");
  if (parts.length !== 3 || parts[0] !== "") return null;
  const [, id, file] = parts;
  if (!CLIP_ID.test(id) || !SERVED_FILES.has(file)) return null;
  return inside(library, path.join(library, id, file));
}

/** A file of the built page, or null when the address would leave it. */
export function pageFile(root: string, url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "app:" || parsed.host !== "rowvision") return null;
  let name: string;
  try {
    name = decodeURIComponent(parsed.pathname);
  } catch {
    return null;
  }
  if (name.includes("\0") || name.includes("\\")) return null;
  return inside(root, path.join(root, name === "/" ? "index.html" : name));
}

function inside(root: string, file: string): string | null {
  const relative = path.relative(path.resolve(root), path.resolve(file));
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? path.resolve(file) : null;
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".mp4": "video/mp4",
};

export function contentType(file: string): string {
  return TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}

export type Range = { start: number; end: number };

/**
 * Reads a single byte range, as a video element asks for when it seeks.
 * Returns null for no range, and "invalid" for one that cannot be served.
 */
export function parseRange(header: string | null, size: number): Range | null | "invalid" {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === "" && match[2] === "") || size === 0) return "invalid";
  if (match[1] === "") {
    const suffix = Number(match[2]);
    if (suffix === 0) return "invalid";
    return { start: Math.max(size - suffix, 0), end: size - 1 };
  }
  const start = Number(match[1]);
  const end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  if (start >= size || end < start) return "invalid";
  return { start, end };
}

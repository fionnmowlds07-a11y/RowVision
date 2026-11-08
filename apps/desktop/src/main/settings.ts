import { promises as fs } from "node:fs";
import path from "node:path";
import { isColour } from "../../../web/lib/colours";
import type { Colours } from "../shared/bridge";

const NONE: Colours = { ground: null, highlight: null };

/** Null means the design system's own colour. */
export function cleanColours(value: unknown): Colours | null {
  if (!value || typeof value !== "object") return null;
  const { ground, highlight } = value as Record<string, unknown>;
  const ok = (colour: unknown) => colour === null || (typeof colour === "string" && isColour(colour));
  if (!ok(ground) || !ok(highlight)) return null;
  return { ground: ground as string | null, highlight: highlight as string | null };
}

export async function readColours(file: string): Promise<Colours> {
  try {
    const saved = JSON.parse(await fs.readFile(file, "utf8")) as { colours?: unknown };
    return cleanColours(saved.colours) ?? NONE;
  } catch {
    return NONE;
  }
}

/** Written to a spare file first, so a crash never leaves half a settings file. */
export async function writeColours(file: string, colours: Colours): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const spare = `${file}.tmp`;
  await fs.writeFile(spare, JSON.stringify({ colours }, null, 2));
  await fs.rename(spare, file);
}

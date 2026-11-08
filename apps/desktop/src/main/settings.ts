import { promises as fs } from "node:fs";
import path from "node:path";
import { isColour } from "../../../web/lib/colours";
import { BOAT_SEATS, fitSetup, seatsFor, sidesFor, type Setup } from "../../../web/lib/setup";
import type { Colours } from "../shared/bridge";

const NONE: Colours = { ground: null, highlight: null };
export const FIRST_SETUP: Setup = { boat: "8+", side: "stroke", seat: 1 };

/** Speed is seconds of work per second of video, from the last clip this computer finished. */
type Settings = { colours: Colours; setup: Setup; speed: number | null };

/** Null means the design system's own colour. */
export function cleanColours(value: unknown): Colours | null {
  if (!value || typeof value !== "object") return null;
  const { ground, highlight } = value as Record<string, unknown>;
  const ok = (colour: unknown) => colour === null || (typeof colour === "string" && isColour(colour));
  if (!ok(ground) || !ok(highlight)) return null;
  return { ground: ground as string | null, highlight: highlight as string | null };
}

/** A boat, side and seat that go together, or null. */
export function cleanSetup(value: unknown): Setup | null {
  if (!value || typeof value !== "object") return null;
  const { boat, side, seat } = value as Record<string, unknown>;
  if (typeof boat !== "string" || !Object.hasOwn(BOAT_SEATS, boat)) return null;
  if (typeof side !== "string" || !sidesFor(boat).includes(side)) return null;
  if (typeof seat !== "number" || !seatsFor(boat).includes(seat)) return null;
  return { boat, side, seat };
}

async function readSettings(file: string): Promise<Settings> {
  try {
    const saved = JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
    const speed = typeof saved.speed === "number" && Number.isFinite(saved.speed) && saved.speed > 0 ? saved.speed : null;
    return { colours: cleanColours(saved.colours) ?? NONE, setup: cleanSetup(saved.setup) ?? FIRST_SETUP, speed };
  } catch {
    return { colours: NONE, setup: FIRST_SETUP, speed: null };
  }
}

export async function readColours(file: string): Promise<Colours> {
  return (await readSettings(file)).colours;
}

export async function readSetup(file: string): Promise<Setup> {
  return fitSetup((await readSettings(file)).setup);
}

export async function readSpeed(file: string): Promise<number | null> {
  return (await readSettings(file)).speed;
}

// One change at a time, so two saves close together cannot undo each other.
let pending: Promise<unknown> = Promise.resolve();

/** Written to a spare file first, so a crash never leaves half a settings file. */
export function saveSettings(file: string, change: Partial<Settings>): Promise<void> {
  const next = pending.then(async () => {
    const settings = { ...(await readSettings(file)), ...change };
    await fs.mkdir(path.dirname(file), { recursive: true });
    const spare = `${file}.tmp`;
    await fs.writeFile(spare, JSON.stringify(settings, null, 2));
    await fs.rename(spare, file);
  });
  pending = next.catch(() => undefined);
  return next;
}

export function writeColours(file: string, colours: Colours): Promise<void> {
  return saveSettings(file, { colours });
}

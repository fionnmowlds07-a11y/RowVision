import { promises as fs } from "node:fs";
import path from "node:path";
import { isColour } from "../../../web/lib/colours";
import { GENERAL_TARGETS, cleanTargets, type TargetChoices } from "../../../web/lib/targets";
import { BOAT_SEATS, fitSetup, seatsFor, sidesFor, type Setup } from "../../../web/lib/setup";
import type { Colours } from "../shared/bridge";
import { DEFAULT_EFFORT, SLOWER_THAN_FULL, isEffort, type Effort } from "../shared/effort";

const NONE: Colours = { ground: null, highlight: null };
export const FIRST_SETUP: Setup = { boat: "8+", side: "stroke", seat: 1 };

/** Speed is seconds of work per second of video, from the last clip this computer finished. */
type Settings = {
  colours: Colours;
  setup: Setup;
  /** From before speeds were kept for each effort. It was close to full speed. */
  speed: number | null;
  /** Seconds of work per second of video for each effort, from the last clip finished with it. */
  speeds: Partial<Record<Effort, number>>;
  /** How hard analysis works the computer. */
  effort: Effort;
  /** The welcome has been finished on this computer. */
  welcomed: boolean;
  /** Where clips are kept, when the user picked somewhere other than the app data folder. */
  clipsDir: string | null;
  /** The athlete's own ranges, and which measures count towards the score. */
  targets: TargetChoices;
};

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
    const welcomed = saved.welcomed === true;
    const clipsDir = typeof saved.clipsDir === "string" && path.isAbsolute(saved.clipsDir) ? saved.clipsDir : null;
    const speeds: Partial<Record<Effort, number>> = {};
    if (saved.speeds && typeof saved.speeds === "object") {
      for (const [effort, value] of Object.entries(saved.speeds as Record<string, unknown>)) {
        if (isEffort(effort) && typeof value === "number" && Number.isFinite(value) && value > 0) speeds[effort] = value;
      }
    }
    const effort = isEffort(saved.effort) ? saved.effort : DEFAULT_EFFORT;
    return { colours: cleanColours(saved.colours) ?? NONE, setup: cleanSetup(saved.setup) ?? FIRST_SETUP, speed, speeds, effort, welcomed, clipsDir, targets: cleanTargets(saved.targets) ?? GENERAL_TARGETS };
  } catch {
    return { colours: NONE, setup: FIRST_SETUP, speed: null, speeds: {}, effort: DEFAULT_EFFORT, welcomed: false, clipsDir: null, targets: GENERAL_TARGETS };
  }
}

export async function readColours(file: string): Promise<Colours> {
  return (await readSettings(file)).colours;
}

export async function readTargets(file: string): Promise<TargetChoices> {
  return (await readSettings(file)).targets;
}

export async function readSetup(file: string): Promise<Setup> {
  return fitSetup((await readSettings(file)).setup);
}

/** How fast this computer analyses at an effort: measured if it has finished a clip that way, else guessed from another. */
export async function readSpeed(file: string, effort: Effort): Promise<number | null> {
  const { speed, speeds } = await readSettings(file);
  if (speeds[effort]) return speeds[effort];
  const known = (Object.entries(speeds) as [Effort, number][]).map(([from, value]) => value / SLOWER_THAN_FULL[from]);
  const full = known[0] ?? speed;
  return full === null ? null : full * SLOWER_THAN_FULL[effort];
}

export function saveSpeed(file: string, effort: Effort, value: number): Promise<void> {
  return readSettings(file).then(({ speeds }) => saveSettings(file, { speeds: { ...speeds, [effort]: value } }));
}

export async function readEffort(file: string): Promise<Effort> {
  return (await readSettings(file)).effort;
}

export async function readWelcome(file: string): Promise<{ welcomed: boolean; clipsDir: string | null }> {
  const { welcomed, clipsDir } = await readSettings(file);
  return { welcomed, clipsDir };
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

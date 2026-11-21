// The numbers behind the app's hand-over, crew board and rower-against-rower screens. Plain data in
// and out, so the screens only draw.
import { PARTS, reaches, type Handover, type Part } from "@/lib/handover";
import type { Rower } from "@/lib/result";
import { deg, MEASURES, metricOf, pct, recoveryWords, secs, targetOf, targetText, type StatsRower } from "./stats-report";

/** One colour per rower on the dark app, stroke first, matching the order of the PDF's colours. */
export const APP_SEAT_COLOURS = ["#35d07f", "#7fb2ff", "#ff9f5a", "#b49cff", "#5fd4e6", "#e8c25a", "#ff86c0", "#c9d4cd"];
export const APP_PART_COLOURS: Record<Part, string> = { legs: "#35d07f", back: "#b49cff", arms: "#ff9f5a" };
/** The two rowers on the compare page, whichever seats they sit in. */
export const PAIR_COLOURS = ["#35d07f", "#7fb2ff"] as const;
/** Marks a gap or a number outside its target. */
export const AMBER = "#ffd27a";

export const appColour = (item: StatsRower) => APP_SEAT_COLOURS[item.tone % APP_SEAT_COLOURS.length];

// ---- Rower against rower ----

export type Lane = {
  name: string;
  label: string;
  /** Each rower's value as text, or a dash. */
  texts: [string, string];
  /** Where each value sits along the lane, 0 to 100, or null when it is missing. */
  at: [number | null, number | null];
  band: { left: number; width: number } | null;
  /** "14.5° apart", "close", or empty when one is missing. */
  gap: string;
  /** The gap is over a tenth of the lane. */
  wide: boolean;
  /** Knees and other shown-only numbers are a rough guide. */
  guide: boolean;
};

function gapText(name: string, gap: number): string {
  if (name.endsWith("_deg")) return `${gap.toFixed(1)}° apart`;
  if (name === "drive_share" || name === "legs_lead" || name === "arms_break") return `${Math.round(gap * 100)}% apart`;
  if (name === "drive_s" || name === "recovery_s") return `${gap.toFixed(2)} s apart`;
  if (name === "rate_steadiness") return `${gap.toFixed(1)}% apart`;
  return `${gap.toFixed(2)} apart`;
}

/** Every measure either rower has, on one lane each, with both values and the target. */
export function lanes(first: StatsRower, second: StatsRower): Lane[] {
  const pair = [first, second];
  return MEASURES.flatMap((measure) => {
    const values = pair.map((item) => metricOf(item.rower, measure.name)?.value) as (number | null | undefined)[];
    if (values.every((value) => typeof value !== "number")) return [];
    const found = targetOf(pair, measure.name);
    const seen = values.filter((value): value is number => typeof value === "number");
    const ends = [...seen, ...(found ? [found.target.low, found.target.high ?? found.target.low] : [])];
    let low = Math.min(...ends);
    let high = Math.max(...ends);
    // A lane is at least three target-widths long, so a small gap next to a narrow target isn't blown up.
    // Without a target, a floor by unit: 10°, a tenth of the drive, a tenth of a second, 5% of the rate.
    const floor = measure.name.endsWith("_deg") ? 10 : measure.name.endsWith("_s") || ["drive_share", "legs_lead", "arms_break"].includes(measure.name) ? 0.1 : measure.name === "ratio" ? 0.2 : measure.name === "rate_steadiness" ? 5 : 0;
    const least = Math.max(floor, found && found.target.high !== null ? 3 * (found.target.high - found.target.low) : 0);
    if (high - low < least) {
      const middle = (high + low) / 2;
      low = middle - least / 2;
      high = middle + least / 2;
    }
    const pad = Math.max((high - low) * 0.15, Math.abs(high) * 0.05, 1e-3);
    low -= pad;
    high += pad;
    const place = (value: number) => ((value - low) / (high - low)) * 100;
    const band = found ? { left: place(found.target.low), width: place(found.target.high ?? high) - place(found.target.low) } : null;
    const both = seen.length === 2 ? Math.abs(seen[0] - seen[1]) : null;
    const share = both === null ? 0 : both / (high - low);
    const scored = pair.some((item) => metricOf(item.rower, measure.name)?.score !== null && metricOf(item.rower, measure.name)?.score !== undefined);
    return [{
      name: measure.name,
      label: measure.label,
      texts: values.map((value) => (typeof value === "number" ? measure.show(value) : "—")) as [string, string],
      at: values.map((value) => (typeof value === "number" ? place(value) : null)) as [number | null, number | null],
      band,
      gap: both === null ? "" : share < 0.04 ? "close" : gapText(measure.name, both),
      wide: share > 0.1,
      guide: !scored,
    }];
  });
}

export const targetLine = (name: string, items: StatsRower[]) => targetText(name, targetOf(items, name));

/** The measure two rowers differ in most, as a share of its lane. */
export function biggestGap(rows: Lane[]): Lane | null {
  const kept = rows.filter((row) => row.at[0] !== null && row.at[1] !== null && !row.guide);
  if (kept.length === 0) return null;
  return kept.reduce((best, row) => (Math.abs(row.at[0]! - row.at[1]!) > Math.abs(best.at[0]! - best.at[1]!) ? row : best));
}

/** One sentence under each part's chart on the compare page. */
export function partSentence(part: Part, first: StatsRower, second: StatsRower): string {
  const pair = [first, second];
  if (part === "arms") {
    const rough = pair.filter((item) => item.hand?.armsRough);
    if (rough.length) return `${rough.map((item) => item.name).join(" and ")}: arms hard to see from this side, so the line is faded.`;
  }
  const level = { legs: 0.9, back: 0.5, arms: 0.15 }[part];
  const shares = pair.map((item) => reaches(item.hand?.drive[part] ?? null, level));
  if (shares.some((share) => share === null)) return `${part === "legs" ? "The legs" : part === "back" ? "The back" : "The arms"} could not be timed for both rowers.`;
  const [a, b] = shares as number[];
  if (part === "legs") return `${first.name}'s legs finish their push by ${pct(a)} of the drive, ${second.name}'s by ${pct(b)}.`;
  if (part === "back") return `${first.name}'s back is halfway at ${pct(a)} of the drive, ${second.name}'s at ${pct(b)}.`;
  return `${first.name}'s arms start to bend at ${pct(a)} of the drive, ${second.name}'s at ${pct(b)}.`;
}

/** A rower on the compare page: which clip and which seat. Seat "rower" is a clip with one rower. */
export type Pick = { clip: string; seat: string };

export const seatKey = (rower: Rower) => String(rower.seat ?? "rower");

/** Every rower of a clip, in the order the boat is written, stroke first. */
export function clipRowers(rowers: Rower[]): Rower[] {
  return [...rowers].sort((a, b) => (b.seat ?? 0) - (a.seat ?? 0));
}

// ---- The crew board ----

export type BoardColumn = "seat" | "overall" | "catch" | "finish" | "catch_lean" | "finish_lean" | "drive" | "ratio" | "back_opens";

export type BoardRow = {
  item: StatsRower;
  values: Record<BoardColumn, number | null>;
  texts: Record<BoardColumn, string>;
  /** Outside the target. */
  outside: Partial<Record<BoardColumn, boolean>>;
  /** The middle of each part's movement, as a share of the drive, for the small marker strip. */
  marks: Record<Part, number | null>;
};

export const BOARD_COLUMNS: { key: BoardColumn; label: string }[] = [
  { key: "seat", label: "Seat" },
  { key: "overall", label: "Overall" },
  { key: "catch", label: "Catch" },
  { key: "finish", label: "Finish" },
  { key: "catch_lean", label: "Catch lean" },
  { key: "finish_lean", label: "Finish lean" },
  { key: "drive", label: "Drive" },
  { key: "ratio", label: "Rec ÷ drive" },
  { key: "back_opens", label: "Back opens" },
];

const score = (value: number | null | undefined) => (value === null || value === undefined ? "–" : String(Math.round(value)));

export function boardRows(items: StatsRower[]): BoardRow[] {
  return items.map((item) => {
    const { rower, hand } = item;
    const metric = (name: string) => metricOf(rower, name);
    const outsideOf = (name: string) => {
      const found = metric(name);
      return Boolean(found && found.score !== null && found.target && typeof found.value === "number" && (found.value < found.target.low || found.value > (found.target.high ?? Infinity)));
    };
    const drive = metric("drive_s")?.value ?? hand?.driveS ?? null;
    const values: Record<BoardColumn, number | null> = {
      seat: rower.seat,
      overall: rower.card.overall,
      catch: rower.card.phases.catch ?? null,
      finish: rower.card.phases.finish ?? null,
      catch_lean: metric("catch_lean_deg")?.value ?? null,
      finish_lean: metric("finish_lean_deg")?.value ?? null,
      drive,
      ratio: metric("ratio")?.value ?? null,
      back_opens: hand?.backOpensShare ?? null,
    };
    return {
      item,
      values,
      texts: {
        seat: item.name,
        overall: score(values.overall),
        catch: score(values.catch),
        finish: score(values.finish),
        catch_lean: deg(values.catch_lean),
        finish_lean: deg(values.finish_lean),
        drive: secs(values.drive),
        ratio: values.ratio === null ? "—" : values.ratio.toFixed(2),
        back_opens: hand?.backOpensShare == null ? "—" : `${pct(hand.backOpensShare)} · legs ${pct(hand.legsWhenBackOpens)}`,
      },
      outside: { catch_lean: outsideOf("catch_lean_deg"), finish_lean: outsideOf("finish_lean_deg") },
      marks: hand ? hand.middle : { legs: null, back: null, arms: null },
    };
  });
}

/** Sorted by a column; rows without a value go last whichever way round. */
export function sortBoard(rows: BoardRow[], column: BoardColumn, up: boolean): BoardRow[] {
  return [...rows].sort((a, b) => {
    const x = a.values[column];
    const y = b.values[column];
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    return up ? x - y : y - x;
  });
}

/** Each rower's body angle at one point of the stroke, from catch (0) to next catch (1). */
export function anglesAt(items: StatsRower[], share: number): { item: StatsRower; value: number }[] {
  return items.flatMap((item) => {
    const line = item.hand?.cycle.trunk;
    if (!line) return [];
    return [{ item, value: line[Math.round(share * (line.length - 1))] }];
  });
}

// ---- The hand-over ----

/** Whether the parts move in order, legs then back then arms, for the small strip on the board. */
export function inOrder(hand: Handover | null): boolean | null {
  if (!hand) return null;
  const { legs, back, arms } = hand.middle;
  if (legs === null || back === null) return null;
  return legs < back && (arms === null || hand.armsRough || back < arms);
}

export const comingForward = (hand: Handover | null) => (hand ? recoveryWords(hand) : "");

/** The share of the drive by which the legs have done their push. */
export function legsDone(hand: Handover | null): number | null {
  return reaches(hand?.drive.legs ?? null, 0.9);
}

export { PARTS };

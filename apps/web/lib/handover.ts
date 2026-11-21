// The power hand-over: how a rower passes the drive from legs to back to arms, and the order
// coming forward. Worked out from the saved body, knee and elbow angles, so it needs no new analysis.
import type { FrameData, Rower, Series } from "./result";

export const PARTS = ["legs", "back", "arms"] as const;
export type Part = (typeof PARTS)[number];

/** Points along each drive and recovery line. */
export const POINTS = 41;
/** A part has started when it has done this share of its movement, and is done at the second. */
const STARTED = 0.15;
const DONE = 0.9;
/** A part that moves less than this, in degrees, is too still to time. */
const LEAST_MOVEMENT = 5;
/** Strokes need most of their frames seen to count. */
const MOST_SEEN = 0.8;

type Angles = { trunk: Series; knee: Series; elbow: Series };
export type Span = { start: number; middle: number; done: number };
export type BackOpens = { share: number; legs: number | null };

export type Handover = {
  seat: number | null;
  /** Strokes the lines are made from. */
  strokes: number;
  driveS: number | null;
  /** Each part's share of its movement done, from the catch to the finish. */
  drive: Record<Part, number[] | null>;
  /** The same from the finish to the next catch, as the arms, back and legs come forward. */
  recovery: Record<Part, number[] | null>;
  /** The middle of each part's movement, as a share of the rower's own drive. */
  middle: Record<Part, number | null>;
  /** When each part moves, in seconds after the lead rower's catch on the same stroke. */
  boat: Record<Part, Span | null>;
  finishS: number | null;
  /** Each stroke: how far into the drive the back starts to open, and how far the legs are by then. */
  backOpens: BackOpens[];
  backOpensShare: number | null;
  legsWhenBackOpens: number | null;
  /** Seconds after the rower's own catch. */
  backOpensS: number | null;
  /** The arms were hard to see, so their line is rough. */
  armsRough: boolean;
  /** Body and knee through one whole stroke, catch to next catch. */
  cycle: { trunk: number[] | null; knee: number[] | null; finishShare: number | null };
};

const finite = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value);

export function median(values: number[]): number | null {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** A running median over five frames, which steadies the line without moving its timing. */
export function steady(series: Series): (number | null)[] {
  return series.map((_, index) => median(series.slice(Math.max(0, index - 2), index + 3).filter(finite)));
}

/** Evenly spaced values along a stretch, filling short gaps, or null when too much is missing. */
export function resample(values: (number | null)[], points = POINTS): number[] | null {
  const seen = values.map((value, index) => [index, value] as const).filter((pair): pair is readonly [number, number] => finite(pair[1]));
  if (values.length < 2 || seen.length < MOST_SEEN * values.length) return null;
  const last = values.length - 1;
  return Array.from({ length: points }, (_, n) => {
    const at = (n / (points - 1)) * last;
    const after = seen.findIndex(([index]) => index >= at);
    if (after <= 0) return seen[Math.max(after, 0)][1];
    const [x0, y0] = seen[after - 1];
    const [x1, y1] = seen[after];
    return x1 === x0 ? y1 : y0 + ((y1 - y0) * (at - x0)) / (x1 - x0);
  });
}

/** The share of a movement done at each point, from 0 at the start to 1 at its end. */
export function progress(values: number[] | null, toEnd = true): number[] | null {
  if (!values) return null;
  const low = Math.min(...values.slice(0, 3));
  const high = toEnd ? Math.max(...values.slice(-3)) : Math.max(...values);
  if (high - low < LEAST_MOVEMENT) return null;
  return values.map((value) => Math.min(1, Math.max(0, (value - low) / (high - low))));
}

/** The share of the way along where a line first reaches a level. */
export function reaches(line: number[] | null, level: number): number | null {
  if (!line) return null;
  const index = line.findIndex((value) => value >= level);
  return index < 0 ? null : index / (line.length - 1);
}

/** The middle of a movement in time: where its speed is centred. */
export function middleOf(values: number[] | null): number | null {
  if (!values || values.length < 3) return null;
  let weight = 0;
  let sum = 0;
  for (let index = 1; index < values.length; index += 1) {
    const speed = Math.max(0, values[index] - values[index - 1]);
    weight += speed;
    sum += speed * (index - 0.5);
  }
  return weight > 0 ? sum / weight / (values.length - 1) : null;
}

const at = (line: number[], share: number) => line[Math.round(share * (line.length - 1))];

function averageLine(lines: (number[] | null)[]): number[] | null {
  const kept = lines.filter((line): line is number[] => line !== null);
  if (kept.length === 0) return null;
  return kept[0].map((_, index) => median(kept.map((line) => line[index]))!);
}

/** Angles that grow as each part does its drive: knees open, the body swings back, elbows bend. */
function driveValues(angles: Angles, part: Part, from: number, to: number): (number | null)[] {
  const pick = { legs: (v: number) => v, back: (v: number) => -v, arms: (v: number) => -v }[part];
  const series = { legs: angles.knee, back: angles.trunk, arms: angles.elbow }[part];
  return series.slice(from, to + 1).map((value) => (finite(value) ? pick(value) : null));
}

/** Coming forward the arms straighten, the body swings over and the knees bend. */
function recoveryValues(angles: Angles, part: Part, from: number, to: number): (number | null)[] {
  const pick = { legs: (v: number) => -v, back: (v: number) => v, arms: (v: number) => v }[part];
  const series = { legs: angles.knee, back: angles.trunk, arms: angles.elbow }[part];
  return series.slice(from, to + 1).map((value) => (finite(value) ? pick(value) : null));
}

export function anglesFor(rower: Rower, data: FrameData, crew: boolean): Angles | null {
  const angles = crew ? data.crew?.[String(rower.seat)]?.angles : data.angles;
  return angles ?? null;
}

function armsHardToSee(rower: Rower): boolean {
  const all = [...rower.card.metrics, ...(rower.card.extras ?? [])];
  const look = (name: string) => all.find((metric) => metric.name === name);
  return [look("finish_elbow_deg"), look("arms_break")].some((metric) => metric !== undefined && metric.value === null);
}

/** The hand-over for one rower. `lead` is the rower the boat times from: stroke, or the rower themself. */
export function handover(rower: Rower, raw: Angles, fps: number, lead: Rower): Handover {
  const angles: Angles = { trunk: steady(raw.trunk), knee: steady(raw.knee), elbow: steady(raw.elbow) };
  const lines: Record<Part, (number[] | null)[]> = { legs: [], back: [], arms: [] };
  const backLines: Record<Part, (number[] | null)[]> = { legs: [], back: [], arms: [] };
  const spans: Record<Part, Span[]> = { legs: [], back: [], arms: [] };
  const middles: Record<Part, number[]> = { legs: [], back: [], arms: [] };
  const opens: BackOpens[] = [];
  const drives: number[] = [];
  const finishes: number[] = [];
  const trunks: (number[] | null)[] = [];
  const knees: (number[] | null)[] = [];
  const shares: number[] = [];
  const leadCatches = lead.strokes.map((stroke) => stroke.catch_frame);
  let used = 0;

  for (const stroke of rower.strokes) {
    const { catch_frame: start, finish_frame: finish } = stroke;
    const next = typeof stroke.next_catch_frame === "number" ? stroke.next_catch_frame : null;
    if (finish <= start + 2) continue;
    used += 1;
    drives.push((finish - start) / fps);
    // The lead rower's catch on the same stroke, if one is close enough to be the same stroke.
    const nearest = leadCatches.reduce<number | null>((best, frame) => (best === null || Math.abs(frame - start) < Math.abs(best - start) ? frame : best), null);
    const reference = nearest !== null && Math.abs(nearest - start) <= fps * 0.5 ? nearest : null;
    if (reference !== null) finishes.push((finish - reference) / fps);
    const row: Partial<Record<Part, number[] | null>> = {};
    for (const part of PARTS) {
      const frames = driveValues(angles, part, start, finish);
      const line = progress(resample(frames), part !== "arms");
      row[part] = line;
      lines[part].push(line);
      const middle = middleOf(resample(frames));
      if (line && middle !== null) {
        middles[part].push(middle);
        const first = reaches(line, STARTED);
        const done = reaches(line, DONE);
        if (reference !== null && first !== null && done !== null) {
          const drive = (finish - start) / fps;
          const offset = (start - reference) / fps;
          spans[part].push({ start: offset + first * drive, middle: offset + middle * drive, done: offset + done * drive });
        }
      }
      if (next !== null && next > finish + 2) backLines[part].push(progress(resample(recoveryValues(angles, part, finish, next)), false));
    }
    const opensAt = reaches(row.back ?? null, STARTED);
    if (opensAt !== null) opens.push({ share: opensAt, legs: row.legs ? at(row.legs, opensAt) : null });
    if (next !== null && next > finish) {
      trunks.push(resample(angles.trunk.slice(start, next + 1)));
      knees.push(resample(angles.knee.slice(start, next + 1)));
      shares.push((finish - start) / (next - start));
    }
  }

  const drive = Object.fromEntries(PARTS.map((part) => [part, averageLine(lines[part])])) as Record<Part, number[] | null>;
  const recovery = Object.fromEntries(PARTS.map((part) => [part, averageLine(backLines[part])])) as Record<Part, number[] | null>;
  const middle = Object.fromEntries(PARTS.map((part) => [part, median(middles[part])])) as Record<Part, number | null>;
  const boat = Object.fromEntries(PARTS.map((part) => {
    const kept = spans[part];
    if (kept.length === 0) return [part, null];
    return [part, { start: median(kept.map((span) => span.start))!, middle: median(kept.map((span) => span.middle))!, done: median(kept.map((span) => span.done))! }];
  })) as Record<Part, Span | null>;
  const driveS = median(drives);
  const backOpensShare = median(opens.map((item) => item.share));
  return {
    seat: rower.seat,
    strokes: used,
    driveS,
    drive,
    recovery,
    middle,
    boat,
    finishS: median(finishes),
    backOpens: opens,
    backOpensShare,
    legsWhenBackOpens: median(opens.map((item) => item.legs).filter(finite)),
    backOpensS: backOpensShare !== null && driveS !== null ? backOpensShare * driveS : null,
    armsRough: armsHardToSee(rower),
    cycle: { trunk: averageLine(trunks), knee: averageLine(knees), finishShare: median(shares) },
  };
}

/** The rower the boat is timed from: the one the engine timed the crew against, else the stroke seat. */
export function leadRower(rowers: Rower[]): Rower {
  const named = rowers.find((rower) => rower.timing?.leader_seat !== undefined && rower.timing?.leader_seat !== null)?.timing?.leader_seat;
  return rowers.find((rower) => rower.seat === named) ?? [...rowers].sort((a, b) => (b.seat ?? 0) - (a.seat ?? 0))[0];
}

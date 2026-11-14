/** A whole crew side by side: who is early or late against the rower they follow, and how well body angles match. */

import { TIMING_IN_TIME_MS, TIMING_MAX_SPREAD_MS, timingText } from "./logic";
import type { Rower } from "./result";

/** A gap this big fills the bar. Bigger gaps are drawn the same, and read from the words. */
export const BAR_FULL_MS = 150;

export type Bar = { left: number; width: number };

export type CrewRow = {
  seat: number | null;
  you: boolean;
  /** The seat this rower follows, or null for the stroke seat. */
  follows: number | null;
  overall: number | null;
  catchLean: number | null;
  /** Layback as a positive angle. */
  layback: number | null;
  catchTiming: string;
  finishTiming: string;
  /** Where the catch gap sits on a bar whose middle is in time, or null when there is no clear gap. */
  bar: Bar | null;
};

/** Left of the middle is early and right is late, as shares of the bar from 0 to 100. */
export function timingBar(gap: number | null | undefined, spread: number | null | undefined): Bar | null {
  if (gap === null || gap === undefined || spread === null || spread === undefined) return null;
  if (spread > TIMING_MAX_SPREAD_MS || Math.abs(gap) < TIMING_IN_TIME_MS) return null;
  const width = (Math.min(Math.abs(gap), BAR_FULL_MS) / BAR_FULL_MS) * 50;
  return { left: gap > 0 ? 50 : 50 - width, width };
}

const value = (rower: Rower, name: string) => rower.card.metrics.find((metric) => metric.name === name)?.value ?? null;

/** One row a seat, stroke first, as a crew is listed. */
export function crewRows(crew: Rower[], ownSeat: number | null): CrewRow[] {
  return crew
    .slice()
    .sort((a, b) => (b.seat ?? 0) - (a.seat ?? 0))
    .map((rower) => {
      const { timing } = rower;
      const layback = value(rower, "finish_lean_deg");
      return {
        seat: rower.seat,
        you: rower.seat !== null && rower.seat === ownSeat,
        follows: timing?.leader_seat ?? null,
        overall: rower.card.overall !== null && rower.rating.band !== "Poor" ? rower.card.overall : null,
        catchLean: value(rower, "catch_lean_deg"),
        layback: layback === null ? null : Math.abs(layback),
        catchTiming: timing ? timingText(timing.catch_ms, timing.catch_spread_ms) : "–",
        finishTiming: timing ? timingText(timing.finish_ms, timing.finish_spread_ms) : "–",
        bar: timingBar(timing?.catch_ms, timing?.catch_spread_ms),
      };
    });
}

export function degrees(angle: number | null): string {
  return angle === null ? "–" : `${Math.round(angle)}°`;
}

/** What a seat's row says aloud, for the button that opens its results. */
export function seatLabel(row: CrewRow): string {
  const who = `Seat ${row.seat ?? "unknown"}${row.you ? ", you" : ""}`;
  const timing = row.follows === null ? "sets the rhythm" : `catch against seat ${row.follows}: ${row.catchTiming.toLowerCase()}`;
  return `${who}, ${timing}, body angle at the catch ${degrees(row.catchLean)}`;
}

const ANALYSIS_SECONDS_PER_SECOND = 21;
const TYPICAL_CLIP_MINUTES = 12;

export type JobState = "uploading" | "queued" | "running" | "needs_tap" | "done" | "failed" | "cancelled";

export function isWaiting(state: JobState): boolean {
  return state === "uploading" || state === "queued" || state === "running";
}

/** A rough guide only: one timed clip sets the rate, and a queue of clips varies. */
export function minutesLeft(place: number | null, seconds: number | null, progress: number | null): number {
  const own = ((seconds ?? 45) * ANALYSIS_SECONDS_PER_SECOND) / 60;
  const ahead = Math.max((place ?? 1) - 1, 0) * TYPICAL_CLIP_MINUTES;
  return Math.max(1, Math.ceil(ahead + own * (1 - (progress ?? 0))));
}

export function waitText(minutes: number): string {
  return minutes === 1 ? "About a minute" : `About ${minutes} minutes`;
}

const ORDINALS = ["First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth", "Ninth", "Tenth"];

export function placeText(place: number | null): string {
  if (place === null) return "In the queue";
  return place <= ORDINALS.length ? `${ORDINALS[place - 1]} in the queue` : `Number ${place} in the queue`;
}

/** Signed links are made with the server's own address, which a browser may not be able to reach. */
export function publicLink(link: string, serverUrl: string, publicUrl: string | undefined): string {
  return publicUrl ? link.replace(serverUrl, publicUrl) : link;
}

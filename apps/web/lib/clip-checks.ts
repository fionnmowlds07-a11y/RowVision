export const MAX_UPLOAD_BYTES = 4 * 1024 ** 3;
export const MIN_SECONDS = 5;
export const SECTION_SECONDS = 60;
const SMALL_SIDE = 720;

export type VideoFacts = { duration: number; width: number; height: number };

/** Return why a file cannot be used, before anything is uploaded. */
export function refuseFile(file: { type: string; name: string; size: number }): string | null {
  const video = file.type.startsWith("video/") || /\.(mp4|mov|m4v|avi|webm)$/i.test(file.name);
  if (!video) return "That file isn't a video. Choose a video from your phone or computer.";
  if (file.size > MAX_UPLOAD_BYTES) return "That video is over 4 GB. Trim it on your phone first, then try again.";
  return null;
}

export function refuseLength(duration: number): string | null {
  return duration < MIN_SECONDS ? "That clip is too short. Film at least 10 strokes." : null;
}

/** All the sample WhatsApp copies were 848x478, and nearly all rated Poor. */
export function looksCompressed(name: string, facts: VideoFacts): boolean {
  return /-WA\d+/i.test(name) || Math.min(facts.width, facts.height) < SMALL_SIDE;
}

export function needsSection(duration: number): boolean {
  return duration > SECTION_SECONDS;
}

export function lastSectionStart(duration: number): number {
  return Math.max(0, duration - SECTION_SECONDS);
}

export function sectionEnd(start: number, duration: number): number {
  return Math.min(start + SECTION_SECONDS, duration);
}

export function clockTime(seconds: number): string {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** Turn a tap into a share of the frame, as the screen size means nothing to the worker. */
export function tapPoint(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }) {
  const clamp = (value: number) => Math.min(Math.max(value, 0), 1);
  return { x: clamp((clientX - rect.left) / rect.width), y: clamp((clientY - rect.top) / rect.height) };
}

export function submitError(message: string): string {
  if (message.includes("queue_full")) return "You already have 2 clips waiting. Add another once one has finished.";
  if (message.includes("bad_seat") || message.includes("bad_side")) return "Check your boat, side and seat.";
  return "We couldn't send your clip for analysis. Check your connection and try again.";
}

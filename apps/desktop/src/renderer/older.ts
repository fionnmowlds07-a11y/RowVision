import type { ClipItem } from "../shared/bridge";

/**
 * The clips an older version of the measuring code measured, which can be measured again.
 * That needs the skeleton saved with the video, so a clip whose video was removed is left out.
 */
export function olderClips(clips: ClipItem[], version: string | null): ClipItem[] {
  if (version === null) return [];
  return clips.filter((clip) => clip.state === "done" && clip.hasVideo && clip.version !== null && clip.version !== version);
}

export function olderLine(count: number): string {
  return count === 1 ? "1 clip was measured with an older version of RowVision." : `${count} clips were measured with an older version of RowVision.`;
}

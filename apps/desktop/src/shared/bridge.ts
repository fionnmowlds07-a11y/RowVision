/** What the page may ask the main process for. Nothing else crosses the bridge. */

import type { Summary } from "../../../web/lib/result";

export type Colours = { ground: string | null; highlight: string | null };

/** Written by the add flow (#152). Every field is optional, as older folders may lack it. */
export type ClipSetup = {
  created_at?: string;
  boat_class?: string;
  side?: string;
  seat?: number;
  note?: string;
};

export type ClipItem = {
  id: string;
  createdAt: string;
  setup: ClipSetup;
  analysed: boolean;
  overall: number | null;
  band: string | null;
  rate: number | null;
  bytes: number;
};

export type ClipDetail = ClipItem & { summary: Summary | null; hasVideo: boolean };

export type Bridge = {
  listClips(): Promise<ClipItem[]>;
  getClip(id: string): Promise<ClipDetail | null>;
  getColours(): Promise<Colours>;
  setColours(colours: Colours): Promise<Colours>;
};

export const CHANNELS = {
  listClips: "clips:list",
  getClip: "clips:get",
  getColours: "colours:get",
  setColours: "colours:set",
} as const;

/** Lower-case letters, digits and dashes, so an id can never be a path. */
export const CLIP_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** The only files the page can load from a clip's folder. */
export const SERVED_FILES = new Set(["working.mp4", "frames.json"]);

export const APP_ORIGIN = "app://rowvision";
export const CLIP_ORIGIN = "rowvision://clip";

export function clipUrl(id: string, file: string): string {
  return `${CLIP_ORIGIN}/${id}/${file}`;
}

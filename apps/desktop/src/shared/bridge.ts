/** What the page may ask the main process for. Nothing else crosses the bridge. */

import type { Summary } from "../../../web/lib/result";
import type { Setup } from "../../../web/lib/setup";
import type { TargetChoices } from "../../../web/lib/targets";

export type Colours = { ground: string | null; highlight: string | null };

/** Written by the add flow (#152). Every field is optional, as older folders may lack it. */
export type ClipSetup = {
  created_at?: string;
  boat_class?: string;
  side?: string;
  seat?: number;
  note?: string;
  filmed_at?: string;
  /** "crew" when every seat was asked for. */
  scope?: string;
};

/** What the add page hands over. The video stays where it is and is read from there. */
export type AddRequest = {
  source: string;
  filmedAt: string;
  setup: Setup;
  note: string;
  /** Length is null when the page could not play the video, so the first 60 seconds are used. */
  section: { start: number; length: number | null };
  tap: { t: number; x: number; y: number } | null;
  /** "crew" measures every seat, which takes about as many times longer as there are seats. */
  scope: Scope;
};

export type Scope = "seat" | "crew";

/** Where a clip is in analysis, read from the files in its folder. */
export type ClipState = "waiting" | "running" | "needs_tap" | "stopped" | "failed" | "done";

export type Running = {
  id: string;
  stage: string;
  /** Share of the whole analysis done, 0 to 1. */
  progress: number;
  startedAt: string;
  secondsLeft: number | null;
};

export type Analysis = {
  running: Running | null;
  /** Clips waiting their turn, first in line first, with a rough wait each. */
  waiting: { id: string; secondsUntil: number }[];
  onBattery: boolean;
  /** The measuring program is not installed, so nothing can be analysed yet. */
  engineMissing: boolean;
  /** The measuring models are not downloaded yet, so clips wait for them. */
  modelsMissing: boolean;
};

/** The measuring models the engine needs, and whether they are on this computer. */
export type ModelsState = {
  state: "checking" | "ready" | "missing" | "downloading" | "failed" | "no_engine";
  downloadedBytes: number;
  totalBytes: number;
  /** Why it failed, in plain words. */
  message: string | null;
};

export type ClipItem = {
  id: string;
  createdAt: string;
  setup: ClipSetup;
  state: ClipState;
  /** Why a clip failed, in plain words. */
  message: string | null;
  analysed: boolean;
  overall: number | null;
  band: string | null;
  accuracy: number | null;
  rate: number | null;
  /** The engine version that measured it. */
  version: string | null;
  /** The measured angles, for the trend. */
  metrics: { name: string; value: number | null }[];
  /** Everything in the clip's folder. */
  bytes: number;
  /** The working copy alone, which is most of it. */
  videoBytes: number;
  hasVideo: boolean;
  /** When the user sent it to help RowVision learn, if they did. */
  sentAt: string | null;
};

export type Space = { videoBytes: number; otherBytes: number; freeBytes: number | null };

export type ClipDetail = ClipItem & {
  summary: Summary | null;
  /** Where the engine stopped to ask which rower is you, in seconds into the working copy. */
  pauseSeconds: number | null;
};

/** What the first-run welcome needs to show. */
export type Welcome = {
  /** True until the welcome is finished. Never shown when clips are already there. */
  show: boolean;
  clipsDir: string;
  freeBytes: number | null;
  /** The folder can only move while it holds no clips. */
  canMove: boolean;
  /** The measuring program is not installed, so nothing can be analysed yet. */
  engineMissing: boolean;
};

export type Bridge = {
  listClips(): Promise<ClipItem[]>;
  getClip(id: string): Promise<ClipDetail | null>;
  getColours(): Promise<Colours>;
  setColours(colours: Colours): Promise<Colours>;
  getSetup(): Promise<Setup>;
  getTargets(): Promise<TargetChoices>;
  /** Saves the athlete's targets, and refuses any that are not valid. Returns what was saved. */
  setTargets(targets: TargetChoices): Promise<TargetChoices>;
  addClip(request: AddRequest): Promise<string>;
  /** Where a picked or dropped file is on this computer, or "" when it is not a real file. */
  pathForFile(file: File): string;
  getAnalysis(): Promise<Analysis>;
  /** Calls back whenever analysis moves on. Returns a function that stops the calls. */
  onAnalysis(listener: (analysis: Analysis) => void): () => void;
  /** Cancels a running clip, or takes a waiting one out of the queue. */
  stopClip(id: string): Promise<void>;
  /** Puts a stopped or failed clip back in the queue. */
  startClip(id: string): Promise<void>;
  /** Measures every seat of a clip that was measured for one rower. Returns why not, or null once it is queued. */
  measureCrew(id: string): Promise<string | null>;
  /** Says which rower is you, then carries on. */
  tapAgain(id: string, tap: { t: number; x: number; y: number }): Promise<void>;
  getSpace(): Promise<Space>;
  /** Deletes the clip's folder. The original video, wherever it is, is never touched. */
  deleteClip(id: string): Promise<void>;
  /** Deletes an analysed clip's working copy and keeps its scores. */
  removeVideo(id: string): Promise<void>;
  /** Whether there is anywhere to send clips to yet. */
  canSend(): Promise<boolean>;
  sendClip(id: string, consent: { note: string; adult: boolean; allowed: boolean }): Promise<void>;
  /** Which version of the measuring code is installed, or null when it can't say. */
  engineVersion(): Promise<string | null>;
  /** Measures a finished clip again from its saved skeleton. Gives back why it couldn't, or null when it did. */
  measureAgain(id: string): Promise<string | null>;
  getModels(): Promise<ModelsState>;
  /** Starts the download when the models are missing. Progress arrives through onModels. */
  downloadModels(): Promise<void>;
  cancelModels(): Promise<void>;
  onModels(listener: (state: ModelsState) => void): () => void;
  getWelcome(): Promise<Welcome>;
  /** Asks where to keep clips. Says why in plain words when the folder can't be used. */
  changeClipsFolder(): Promise<{ welcome: Welcome; problem: string | null }>;
  finishWelcome(): Promise<void>;
  onSendProgress(listener: (progress: { id: string; sent: number; total: number }) => void): () => void;
};

export const CHANNELS = {
  listClips: "clips:list",
  getClip: "clips:get",
  getColours: "colours:get",
  setColours: "colours:set",
  getSetup: "setup:get",
  getTargets: "targets:get",
  setTargets: "targets:set",
  addClip: "clips:add",
  getAnalysis: "analysis:get",
  analysisChanged: "analysis:changed",
  stopClip: "analysis:stop",
  startClip: "analysis:start",
  measureCrew: "analysis:crew",
  tapAgain: "analysis:tap",
  getSpace: "space:get",
  deleteClip: "clips:delete",
  removeVideo: "clips:remove-video",
  canSend: "send:ready",
  sendClip: "send:clip",
  sendProgress: "send:progress",
  engineVersion: "engine:version",
  measureAgain: "clips:measure-again",
  getModels: "models:get",
  downloadModels: "models:download",
  cancelModels: "models:cancel",
  modelsChanged: "models:changed",
  getWelcome: "welcome:get",
  changeClipsFolder: "welcome:folder",
  finishWelcome: "welcome:finish",
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

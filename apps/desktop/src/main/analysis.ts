import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { SECTION_SECONDS } from "../../../web/lib/clip-checks";
import { BOAT_SEATS } from "../../../web/lib/setup";
import type { Analysis, Running } from "../shared/bridge";
import { STAGES, canonical } from "../shared/stages";
import { PAUSE_FILE, listClips, markClip, readJson, writeJson } from "./library";

/** A first guess before this computer has finished a clip: about 10 minutes for 30 seconds. */
export const FIRST_SPEED = 20;
const STOP_GRACE_MS = 15_000;
/** Finding the boats is done once, so each extra seat adds about this share of one rower's time. A first guess. */
export const CREW_SEAT_SHARE = 0.6;
export const UNEXPECTED = "Analysis stopped unexpectedly. Start again to try once more.";
export const MOVED = "The video can't be found. Has it been moved or deleted?";

/** How far through the whole run the engine is, never going backwards. */
export function overallProgress(stage: string, progress: number | null, before: number): number {
  const known = STAGES.find((item) => item.engine === canonical(stage));
  if (!known) return before;
  const share = progress === null ? 0 : Math.min(Math.max(progress, 0), 1);
  return Math.max(before, known.from + (known.to - known.from) * share);
}

/** Time left from how fast it has gone so far, once there is enough to go on. */
export function secondsLeft(progress: number, elapsedSeconds: number): number | null {
  if (progress < 0.2 || elapsedSeconds < 5) return null;
  return Math.round((elapsedSeconds * (1 - progress)) / progress);
}

type Clip = Record<string, unknown>;

/** How many seconds of video the engine will look at. */
export function clipSeconds(clip: Clip): number {
  return typeof clip.section_length === "number" ? clip.section_length : SECTION_SECONDS;
}

/** How much work a clip is, in seconds of video for one rower. A whole crew is most of the work again for each seat. */
export function clipWork(clip: Clip): number {
  const seats = clip.scope === "crew" && typeof clip.boat_class === "string" ? BOAT_SEATS[clip.boat_class] ?? 1 : 1;
  return clipSeconds(clip) * (1 + CREW_SEAT_SHARE * (seats - 1));
}

/** The engine's own folder goes first on the path, so the ffmpeg and ffprobe packed beside it are the ones it finds. */
export function engineEnv(program: string, env: NodeJS.ProcessEnv, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const wanted = { ...env, ...extra };
  if (!path.isAbsolute(program)) return Object.keys(extra).length === 0 ? env : wanted;
  // Windows calls it Path, and a second spelling would leave the first one in charge.
  const key = Object.keys(wanted).find((name) => name.toLowerCase() === "path") ?? "PATH";
  return { ...wanted, [key]: [path.dirname(program), wanted[key]].filter(Boolean).join(path.delimiter) };
}

/** The job file the engine reads, from the clip's own record. */
export function jobFor(folder: string, clip: Clip, kind: string): Record<string, unknown> {
  const job: Record<string, unknown> = {
    folder,
    source: typeof clip.source === "string" ? clip.source : null,
    start: typeof clip.section_start === "number" ? clip.section_start : 0,
    boat_class: clip.boat_class,
    side: clip.side,
    seat: clip.seat,
    tap: clip.tap ?? null,
    engine: kind,
    device: "cpu",
    scope: clip.scope === "crew" ? "crew" : "seat",
  };
  // Left out when the page could not play the video, so the engine takes the first 60 seconds.
  if (typeof clip.section_length === "number") job.length = clip.section_length;
  return job;
}

type Options = {
  library: () => string;
  /** The engine's command, or null when it is not installed. */
  engine: () => string[] | null;
  /** "real", or "fake" for tests. */
  kind: string;
  onChange: (analysis: Analysis) => void;
  notify: (title: string, body: string, id: string) => void;
  onBattery: () => boolean;
  readSpeed: () => Promise<number | null>;
  saveSpeed: (secondsPerSecond: number) => Promise<void>;
  /** Whether the measuring models are on this computer. Clips wait until they are. Defaults to yes. */
  modelsReady?: () => boolean;
  /** Extra environment for the engine, such as where it keeps its models. */
  env?: () => NodeJS.ProcessEnv;
};

type Current = Running & { child: ChildProcess; ended: boolean; stopping: boolean; forgotten?: boolean; seconds: number; timer?: NodeJS.Timeout };

/** Analyses one clip at a time, oldest first. Everything it knows is also in the clips' folders. */
export class Analyser {
  private current: Current | null = null;
  private waiting: { id: string; seconds: number }[] = [];
  private speed = FIRST_SPEED;
  private quitting = false;
  private busy: Promise<void> = Promise.resolve();

  constructor(private readonly options: Options) {}

  async start(): Promise<void> {
    this.speed = (await this.options.readSpeed()) ?? FIRST_SPEED;
    await this.next();
  }

  snapshot(): Analysis {
    const running = this.current
      ? { id: this.current.id, stage: this.current.stage, progress: this.current.progress, startedAt: this.current.startedAt, secondsLeft: this.current.secondsLeft }
      : null;
    let ahead = this.current ? (this.current.secondsLeft ?? Math.round(this.current.seconds * this.speed * (1 - this.current.progress))) : 0;
    const waiting = this.waiting.map(({ id, seconds }) => {
      const item = { id, secondsUntil: ahead };
      ahead += Math.round(seconds * this.speed);
      return item;
    });
    const modelsMissing = !(this.options.modelsReady?.() ?? true);
    return { running, waiting, onBattery: this.options.onBattery(), engineMissing: this.options.engine() === null, modelsMissing };
  }

  changed(): void {
    this.options.onChange(this.snapshot());
  }

  /** Look again at the library and start the next clip if nothing is running. Runs one at a time. */
  next(): Promise<void> {
    this.busy = this.busy.then(() => this.pickNext()).catch(() => undefined);
    return this.busy;
  }

  private async pickNext(): Promise<void> {
    const library = this.options.library();
    const clips = (await listClips(library)).filter((clip) => clip.state === "waiting" && clip.id !== this.current?.id);
    clips.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    this.waiting = await Promise.all(clips.map(async (clip) => ({ id: clip.id, seconds: clipWork(((await readJson(path.join(library, clip.id, "clip.json"))) ?? {}) as Clip) })));
    if (this.current || this.quitting || this.waiting.length === 0) return this.changed();
    const command = this.options.engine();
    if (!command || !(this.options.modelsReady?.() ?? true)) return this.changed();
    const { id } = this.waiting.shift()!;
    await this.run(id, command);
    this.changed();
  }

  private async run(id: string, command: string[]): Promise<void> {
    const library = this.options.library();
    const folder = path.join(library, id);
    const clip = ((await readJson(path.join(folder, "clip.json"))) ?? {}) as Clip;
    const hasCopy = await fs.stat(path.join(folder, "working.mp4")).then(() => true, () => false);
    const source = typeof clip.source === "string" ? clip.source : null;
    if (!hasCopy && (!source || !(await fs.stat(source).then((stat) => stat.isFile(), () => false)))) {
      await markClip(library, id, "failed", MOVED);
      return this.pickNext();
    }
    const jobFile = path.join(folder, "job.json");
    await writeJson(jobFile, jobFor(folder, clip, this.options.kind));

    const [program, ...rest] = command;
    const child = spawn(program, [...rest, jobFile], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true, env: engineEnv(program, process.env, this.options.env?.()) });
    const log = createWriteStream(path.join(folder, "engine.log"));
    child.stderr?.pipe(log);
    child.stdin?.on("error", () => undefined);
    const current: Current = {
      id, child, stage: "Getting ready", progress: 0, startedAt: new Date().toISOString(), secondsLeft: null,
      ended: false, stopping: false, seconds: clipWork(clip),
    };
    this.current = current;

    const finish = async (mark: "stopped" | "failed" | null, message?: string) => {
      if (current.ended) return;
      current.ended = true;
      if (current.timer) clearTimeout(current.timer);
      if (mark && !current.forgotten) await markClip(library, id, mark, message);
    };

    createInterface({ input: child.stdout! }).on("line", (line) => {
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }
      if (event.event === "stage" && typeof event.stage === "string") {
        current.stage = event.stage;
        current.progress = overallProgress(event.stage, typeof event.progress === "number" ? event.progress : null, current.progress);
        current.secondsLeft = secondsLeft(current.progress, (Date.now() - Date.parse(current.startedAt)) / 1000);
        this.changed();
      } else if (event.event === "done") {
        void finish(null).then(async () => {
          const taken = (Date.now() - Date.parse(current.startedAt)) / 1000;
          this.speed = taken / Math.max(current.seconds, 1);
          await this.options.saveSpeed(this.speed);
          const overall = typeof event.overall === "number" && event.band !== "Poor" ? `Overall ${Math.round(event.overall)}` : "No overall score";
          this.options.notify("Your clip is ready", `${overall}${typeof event.band === "string" ? `, accuracy ${event.band}` : ""}.`, id);
        });
      } else if (event.event === "needs_tap") {
        void finish(null).then(() => this.options.notify("Which one is you?", "Click on yourself so analysis can carry on.", id));
      } else if (event.event === "cancelled") {
        void finish("stopped");
      } else if (event.event === "failed") {
        void finish("failed", typeof event.message === "string" ? event.message : UNEXPECTED);
      }
    });

    child.on("error", () => void finish("failed", UNEXPECTED));
    child.on("close", () => {
      log.end();
      // Closing the app leaves the clip waiting, so it starts again next time.
      // A clip being deleted gets no mark, as its folder is about to go.
      const mark = this.quitting || current.forgotten ? Promise.resolve() : current.stopping ? finish("stopped") : finish("failed", UNEXPECTED);
      void mark.then(() => {
        if (this.current === current) this.current = null;
        if (!this.quitting) void this.next();
      });
    });
    this.changed();
  }

  /** Cancel a running clip, or take a waiting one out of the queue. */
  async stop(id: string): Promise<void> {
    const current = this.current;
    if (current?.id === id) {
      current.stopping = true;
      current.child.stdin?.end("cancel\n");
      current.timer = setTimeout(() => current.child.kill(), STOP_GRACE_MS);
      return;
    }
    await markClip(this.options.library(), id, "stopped");
    await this.next();
  }

  /** Before a clip is deleted: stop it if it is running, and wait for the engine to let go of its folder. */
  async forget(id: string): Promise<void> {
    const current = this.current;
    if (current?.id !== id) return;
    current.forgotten = true;
    const closed = new Promise<void>((done) => current.child.once("close", () => done()));
    current.child.stdin?.end("cancel\n");
    current.child.kill();
    await closed;
  }

  /** Put a stopped or failed clip back in the queue. */
  async restart(id: string): Promise<void> {
    await markClip(this.options.library(), id, null);
    await this.next();
  }

  /** Say which rower is you, as seconds into the working copy and a share of the frame. */
  async tap(id: string, tap: { t: number; x: number; y: number }): Promise<void> {
    const folder = path.join(this.options.library(), id);
    const clip = ((await readJson(path.join(folder, "clip.json"))) ?? {}) as Clip;
    await writeJson(path.join(folder, "clip.json"), { ...clip, tap });
    await fs.rm(path.join(folder, PAUSE_FILE), { force: true });
    await markClip(this.options.library(), id, null);
    await this.next();
  }

  /** Called as the app closes. The engine stops when its input closes, and is ended if it lingers. */
  shutdown(): void {
    this.quitting = true;
    const child = this.current?.child;
    if (!child) return;
    child.stdin?.end();
    child.kill();
  }
}

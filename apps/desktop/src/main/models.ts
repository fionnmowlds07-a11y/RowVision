import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import type { ModelsState } from "../shared/bridge";
import { engineEnv } from "./analysis";

export const COULDNT_GET = "We couldn't get the measuring models. Check your internet connection and try again.";

type Options = {
  /** The engine's command, or null when it is not installed. */
  engine: () => string[] | null;
  /** Where the engine is told to keep the models, so they live in the app's own folder. */
  env: () => NodeJS.ProcessEnv;
  onChange: (state: ModelsState) => void;
};

const START: ModelsState = { state: "checking", downloadedBytes: 0, totalBytes: 0, message: null };

/**
 * Knows whether the measuring models are on this computer, and fetches them. All of it goes through
 * the engine (`--models status` and `--models fetch`), so the list of models lives in one place.
 */
export class Models {
  private current: ModelsState = START;
  private child: ChildProcess | null = null;
  private quitting = false;

  constructor(private readonly options: Options) {}

  snapshot(): ModelsState {
    return this.current;
  }

  ready(): boolean {
    return this.current.state === "ready";
  }

  private set(next: Partial<ModelsState> & { state: ModelsState["state"] }): void {
    this.current = { ...this.current, message: null, ...next };
    this.options.onChange(this.current);
  }

  private run(mode: "status" | "fetch"): { child: ChildProcess; lines: ReturnType<typeof createInterface> } | null {
    const command = this.options.engine();
    if (!command) return null;
    const [program, ...rest] = command;
    const child = spawn(program, [...rest, "--models", mode], {
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
      env: engineEnv(program, process.env, this.options.env()),
    });
    child.stdin?.on("error", () => undefined);
    return { child, lines: createInterface({ input: child.stdout! }) };
  }

  /** Asks the engine what is on this computer, without changing what the app says. Null when it gave no answer. */
  private async probe(): Promise<Pick<ModelsState, "state" | "downloadedBytes" | "totalBytes"> | "no_engine" | null> {
    const started = this.run("status");
    if (!started) return "no_engine";
    const { child, lines } = started;
    let answer: Record<string, unknown> | null = null;
    lines.on("line", (line) => {
      try {
        const event = JSON.parse(line) as Record<string, unknown>;
        if (event.event === "status") answer = event;
      } catch {
        // Not a line for us.
      }
    });
    await new Promise<void>((done) => {
      child.on("error", () => done());
      child.on("close", () => done());
    });
    const reply = answer as Record<string, unknown> | null;
    if (!reply) return null;
    const total = typeof reply.total_bytes === "number" ? reply.total_bytes : 0;
    const needed = typeof reply.download_bytes === "number" ? reply.download_bytes : total;
    return reply.ready === true ? { state: "ready", downloadedBytes: total, totalBytes: total } : { state: "missing", downloadedBytes: 0, totalBytes: needed };
  }

  /** Asks the engine what is on this computer. */
  async check(): Promise<void> {
    if (this.child) return;
    const found = await this.probe();
    if (this.quitting) return;
    if (found === "no_engine") return this.set({ state: "no_engine" });
    this.set(found ?? { state: "failed", message: COULDNT_GET });
  }

  /** Downloads what is missing. Does nothing when it is already downloading or ready. */
  async download(): Promise<void> {
    if (this.child || this.current.state === "ready") return;
    const started = this.run("fetch");
    if (!started) return this.set({ state: "no_engine" });
    const { child, lines } = started;
    this.child = child;
    this.set({ state: "downloading", downloadedBytes: 0 });
    let failure: string | null = null;
    let cancelled = false;
    lines.on("line", (line) => {
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }
      if (event.event === "models" && typeof event.downloaded === "number" && typeof event.total === "number") {
        this.set({ state: "downloading", downloadedBytes: event.downloaded, totalBytes: event.total });
      } else if (event.event === "failed") {
        failure = typeof event.message === "string" ? event.message : COULDNT_GET;
      } else if (event.event === "cancelled") {
        cancelled = true;
      }
    });
    await new Promise<void>((done) => {
      child.on("error", () => done());
      child.on("close", () => done());
    });
    this.child = null;
    if (this.quitting) return;
    if (cancelled) return this.set({ state: "missing", downloadedBytes: 0 });
    // Whatever the engine said, what counts is what is really on the disk. A failure goes straight to
    // "failed", never back through "missing", which would start the download again.
    const found = await this.probe();
    if (this.quitting) return;
    if (found !== "no_engine" && found?.state === "ready") this.set(found);
    else this.set({ state: "failed", message: failure ?? COULDNT_GET });
  }

  /** Stops a download part way. What was fetched so far is thrown away by the engine. */
  cancel(): void {
    this.child?.stdin?.end("cancel\n");
  }

  shutdown(): void {
    this.quitting = true;
    this.child?.stdin?.end();
    this.child?.kill();
  }
}

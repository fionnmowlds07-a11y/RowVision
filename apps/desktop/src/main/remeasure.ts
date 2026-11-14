import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { engineEnv } from "./analysis";

export const COULDNT_MEASURE = "We couldn't measure this clip again. Its scores are unchanged.";

/** Runs the engine for a quick question and gives back the last thing it said, or null when it said nothing. */
export function askEngine(command: string[], args: string[], env: NodeJS.ProcessEnv = {}): Promise<Record<string, unknown> | null> {
  const [program, ...rest] = command;
  return new Promise((done) => {
    let last: Record<string, unknown> | null = null;
    const child = spawn(program, [...rest, ...args], { stdio: ["ignore", "pipe", "ignore"], windowsHide: true, env: engineEnv(program, process.env, env) });
    createInterface({ input: child.stdout! }).on("line", (line) => {
      try {
        last = JSON.parse(line);
      } catch {
        // Anything that is not a line of JSON is not for the app.
      }
    });
    child.on("error", () => done(null));
    child.on("close", () => done(last));
  });
}

/** Which version of the measuring code the engine is, or null when it can't say. */
export async function engineVersion(command: string[] | null, env: NodeJS.ProcessEnv = {}): Promise<string | null> {
  if (!command) return null;
  const answer = await askEngine(command, ["--version"], env);
  return answer?.event === "version" && typeof answer.version === "string" ? answer.version : null;
}

/**
 * Measures a finished clip again from the skeleton saved with it, which takes seconds.
 * Gives back null when it worked, or why it didn't in plain words.
 */
export async function measureAgain(command: string[] | null, folder: string, env: NodeJS.ProcessEnv = {}): Promise<string | null> {
  if (!command) return COULDNT_MEASURE;
  const answer = await askEngine(command, ["--remeasure", folder], env);
  if (answer?.event === "done") return null;
  return answer?.event === "failed" && typeof answer.message === "string" ? answer.message : COULDNT_MEASURE;
}

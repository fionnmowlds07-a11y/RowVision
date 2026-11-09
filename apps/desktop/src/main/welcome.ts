import { promises as fs } from "node:fs";
import path from "node:path";

/** Clips go in their own folder, so picking "Videos" never mixes them with the user's own files. */
export function clipsFolderIn(picked: string): string {
  const resolved = path.resolve(picked);
  return path.basename(resolved).toLowerCase() === "rowvision" ? resolved : path.join(resolved, "RowVision");
}

/** Makes the folder and checks a file can be written there. Returns a plain reason when it can't. */
export async function checkFolder(folder: string): Promise<string | null> {
  if (!path.isAbsolute(folder)) return "That isn't a folder on this computer.";
  try {
    await fs.mkdir(folder, { recursive: true });
    const probe = path.join(folder, `.rowvision-check-${process.pid}`);
    await fs.writeFile(probe, "");
    await fs.rm(probe, { force: true });
    return null;
  } catch {
    return "RowVision can't save clips there. Pick another folder.";
  }
}

/** True when the folder has no clips yet, so moving it loses nothing. */
export async function isEmptyLibrary(folder: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(folder, { withFileTypes: true });
    return !entries.some((entry) => entry.isDirectory());
  } catch {
    return true;
  }
}

import { useEffect, useState } from "react";
import type { ModelsState } from "../shared/bridge";

/** Whether the measuring models are on this computer, kept up to date by the main process. */
export function useModels(): ModelsState | null {
  const [models, setModels] = useState<ModelsState | null>(null);
  useEffect(() => {
    let live = true;
    void window.rowvision.getModels().then((first) => { if (live) setModels((now) => now ?? first); });
    const stop = window.rowvision.onModels((next) => { if (live) setModels(next); });
    return () => {
      live = false;
      stop();
    };
  }, []);
  return models;
}

/** Download sizes are quoted the way a network speed is, in millions of bytes. */
export function megabytes(bytes: number): string {
  return `${Math.round(bytes / 1_000_000)} MB`;
}

export function percent(models: { downloadedBytes: number; totalBytes: number }): number {
  return models.totalBytes > 0 ? Math.min(100, Math.floor((models.downloadedBytes / models.totalBytes) * 100)) : 0;
}

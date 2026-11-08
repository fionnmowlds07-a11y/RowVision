import { useEffect, useState } from "react";
import type { Analysis } from "../shared/bridge";

/** What is running and waiting, kept up to date by the main process. */
export function useAnalysis(): Analysis | null {
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  useEffect(() => {
    let live = true;
    void window.rowvision.getAnalysis().then((first) => { if (live) setAnalysis((now) => now ?? first); });
    const stop = window.rowvision.onAnalysis((next) => { if (live) setAnalysis(next); });
    return () => {
      live = false;
      stop();
    };
  }, []);
  return analysis;
}

export function minutesText(seconds: number): string {
  if (seconds < 60) return "under a minute";
  const minutes = Math.round(seconds / 60);
  return minutes === 1 ? "about 1 min" : `about ${minutes} min`;
}

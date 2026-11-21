import { useEffect, useMemo, useState } from "react";
import type { FrameData, Rower } from "@/lib/result";
import { BOAT_SEATS } from "@/lib/setup";
import { clipUrl, type ClipDetail } from "../shared/bridge";
import type { Drawn } from "./handover-charts";
import { appColour } from "./rower-stats";
import { statsReport, statsRowers, type StatsRower } from "./stats-report";

export type ClipStats = { every: StatsRower[]; leadName: string; problem: string | null; ready: boolean };

export function clipRowerList(clip: ClipDetail): Rower[] {
  const summary = clip.summary;
  if (!summary?.rower) return [];
  return summary.crew && summary.crew.length > 1 ? summary.crew : [summary.rower];
}

/** Every rower of a clip with their hand-over, worked out from the clip's saved angles. */
export function useClipStats(clip: ClipDetail | null): ClipStats {
  const [data, setData] = useState<FrameData | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const id = clip?.id ?? null;
  const usable = clip !== null && clip.state === "done" && Boolean(clip.summary?.rower);

  useEffect(() => {
    if (!id || !usable) return;
    let live = true;
    setData(null);
    setProblem(null);
    fetch(clipUrl(id, "frames.json"))
      .then((response) => response.json())
      .then((value: FrameData) => { if (live) setData(value); })
      .catch(() => { if (live) setProblem("The measurements for the hand-over couldn't be read."); });
    return () => { live = false; };
  }, [id, usable]);

  return useMemo(() => {
    if (!clip || !data) return { every: [], leadName: "the stroke", problem, ready: false };
    const seats = BOAT_SEATS[clip.setup.boat_class ?? ""] ?? 1;
    const own = clip.setup.coach ? null : clip.summary?.rower?.seat ?? null;
    const every = statsRowers(clipRowerList(clip), data, clip.summary!.fps, seats, own);
    return { every, leadName: statsReport("", "", every, []).leadName, problem, ready: true };
  }, [clip, data, problem]);
}

export const drawn = (item: StatsRower, colour = appColour(item)): Drawn => ({ key: item.key, name: item.name, colour, hand: item.hand });

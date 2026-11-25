// Runs in the browser: one rower's catch and finish report, every layout, drawn by the app's own code from a clip in the library.
import { makeScene } from "@/app/clips/[id]/draw";
import type { FrameData, Summary } from "@/lib/result";
import { capture } from "../../desktop/src/renderer/report-frames";
import { framesFor, LAYOUTS, reportPages, reportRower, type Pictures } from "../../desktop/src/renderer/report";

const read = async <T>(name: string) => (await (await fetch(`/clip/${name}`)).json()) as T;
(window as unknown as { makeReport: unknown }).makeReport = async (seat: number, seats: number, heading: string) => {
  const summary = await read<Summary>("summary.json");
  const data = await read<FrameData>("frames.json");
  const rower = (summary.crew ?? [summary.rower!]).find((item) => item.seat === seat)!;
  const item = reportRower(rower, summary.fps, seats, null);
  const scene = makeScene(rower, { ...data, ...data.crew?.[String(seat)] }, summary.facing, summary.view_deg, summary.other_side ?? []);
  const pictures: Pictures = { [item.key]: {} };
  await capture("/clip/working.mp4", summary.fps, [{ scene, frames: framesFor(item), done: (frame, picture) => { pictures[item.key][frame] = picture; } }], () => {}, () => false);
  return LAYOUTS.map(({ id }) => ({ id, pages: reportPages(id, { heading, rowers: [item] }, pictures) }));
};

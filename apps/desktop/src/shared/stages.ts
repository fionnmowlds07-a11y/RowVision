/** The engine's stages in order, with the name shown and the share of the whole run each one takes. */
export const STAGES = [
  { engine: "Preparing your video", name: "Preparing the video", from: 0, to: 0.1 },
  { engine: "Loading the pose model", name: "Getting the measuring ready", from: 0.1, to: 0.15 },
  { engine: "Finding boats", name: "Finding the boats and seats", from: 0.15, to: 0.4 },
  { engine: "Measuring your rower", name: "Measuring your rower", from: 0.4, to: 1 },
] as const;

/** Which stage is under way: -1 before the first, and STAGES.length when finished. */
export function stageIndex(stage: string): number {
  return STAGES.findIndex((item) => item.engine === canonical(stage));
}

/** A whole crew is measured in the same stage as one rower, under its own name. */
export const CREW_STAGE = "Measuring your crew";

export function canonical(stage: string): string {
  return stage === CREW_STAGE ? "Measuring your rower" : stage;
}

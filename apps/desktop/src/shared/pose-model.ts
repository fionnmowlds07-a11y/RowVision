/** Which model finds the joints. Accurate places knees and legs better and takes longer. */
export type PoseModel = "accurate" | "standard";

export const DEFAULT_MODEL: PoseModel = "accurate";

/** Clips from before there was a choice used the standard model. */
export function poseModel(value: unknown): PoseModel {
  return value === "accurate" ? "accurate" : "standard";
}

export const POSE_MODELS: { id: PoseModel; name: string; about: string }[] = [
  {
    id: "accurate",
    name: "More accurate",
    about: "Uses a larger model that places knees and legs better. It takes about two to three times as long, and longest for a big crew. Some legs can still be wrong.",
  },
  { id: "standard", name: "Faster", about: "Uses a smaller model. Body angles are about as good overall, and knees and legs are rougher." },
];

/** What the larger model needs, for anyone who has not downloaded it yet. */
export const ACCURATE_DOWNLOAD = "about 184 MB";

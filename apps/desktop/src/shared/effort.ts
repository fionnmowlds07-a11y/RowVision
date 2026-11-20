/** How hard analysis works the computer: all its cores, about half, or a few at the lowest priority. */
export type Effort = "full" | "balanced" | "gentle";
export type Priority = "normal" | "below" | "low";

export const DEFAULT_EFFORT: Effort = "balanced";

export const EFFORTS: { id: Effort; name: string; about: string }[] = [
  { id: "full", name: "Full speed", about: "Uses every core at normal priority. Fastest, but the computer may be slow to use, warm and loud until it finishes." },
  { id: "balanced", name: "Balanced", about: "Uses about half the cores and lets your other programs go first. A good choice while you use the computer." },
  { id: "gentle", name: "Gentle", about: "Uses a few cores at the lowest priority. Slowest, and the computer stays quiet and easy to use." },
];

export function isEffort(value: unknown): value is Effort {
  return value === "full" || value === "balanced" || value === "gentle";
}

/** The cores and priority the engine is given. Null cores means all of them. */
export function effortPlan(effort: Effort, cores: number): { threads: number | null; priority: Priority } {
  const all = Math.max(1, Math.floor(cores));
  if (effort === "full") return { threads: null, priority: "normal" };
  if (effort === "balanced") return { threads: Math.max(1, Math.round(all / 2)), priority: "below" };
  return { threads: Math.max(1, Math.round(all / 4)), priority: "low" };
}

/** How much longer each setting takes than full speed, a first guess until this computer has finished a clip with it. */
export const SLOWER_THAN_FULL: Record<Effort, number> = { full: 1, balanced: 1.7, gentle: 3 };

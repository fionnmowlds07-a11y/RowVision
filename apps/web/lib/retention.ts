export type Expired = { clip: string; working: string | null; frames: string[] };

type Store = {
  expired: () => Promise<Expired[]>;
  remove: (bucket: string, paths: string[]) => Promise<void>;
  mark: (clip: string) => Promise<void>;
};

/** Files go first, so that a failure leaves the clip to try again rather than an orphaned file. */
export async function deleteExpired(store: Store): Promise<number> {
  const clips = await store.expired();
  for (const { clip, working, frames } of clips) {
    if (working) await store.remove("working", [working]);
    if (frames.length) await store.remove("frames", frames);
    await store.mark(clip);
  }
  return clips.length;
}

export function daysLeft(expires: string | null, now: number): number | null {
  if (!expires) return null;
  return Math.max(0, Math.ceil((new Date(expires).getTime() - now) / 86_400_000));
}

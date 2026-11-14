import { useEffect, useState } from "react";
import { Compare } from "@/app/compare";
import type { ClipDetail } from "../shared/bridge";
import { longDate, setupLine } from "./format";

const filmed = (clip: ClipDetail) => clip.setup.filmed_at ?? clip.createdAt;

/** Two clips side by side, the earlier one first whichever way round they were picked. */
export function ComparePage({ first, second }: { first: string; second: string }) {
  const [clips, setClips] = useState<(ClipDetail | null)[] | undefined>(undefined);

  useEffect(() => {
    let live = true;
    void Promise.all([window.rowvision.getClip(first), window.rowvision.getClip(second)]).then((found) => { if (live) setClips(found); });
    return () => { live = false; };
  }, [first, second]);

  if (clips === undefined) return <p aria-busy="true">Loading…</p>;
  const [a, b] = clips;
  const ra = a?.summary?.rower;
  const rb = b?.summary?.rower;
  if (!a || !b || !ra || !rb) {
    return (
      <section className="card stack">
        <h1 style={{ fontSize: 24 }}>These clips can&apos;t be compared</h1>
        <p className="soft">Both clips need to be analysed, with a rower measured in each.</p>
        <a href="#/">Back to your clips</a>
      </section>
    );
  }
  const [before, after] = filmed(a) <= filmed(b) ? [a, b] : [b, a];
  const side = (clip: ClipDetail) => ({ label: longDate(filmed(clip)), rower: clip.summary!.rower! });
  return (
    <>
      <div>
        <h1 style={{ fontSize: 32 }}>Compare two clips</h1>
        <p style={{ margin: "8px 0 0", color: "var(--on-ground-soft)" }}>
          <a href={`#/clip/${before.id}`}>{longDate(filmed(before))}</a> ({setupLine(before.setup) || "no setup"}) against{" "}
          <a href={`#/clip/${after.id}`}>{longDate(filmed(after))}</a> ({setupLine(after.setup) || "no setup"})
        </p>
      </div>
      <Compare before={side(before)} after={side(after)} />
    </>
  );
}

/** On a clip: pick another analysed clip to compare it with. */
export function CompareWith({ id }: { id: string }) {
  const [others, setOthers] = useState<{ id: string; label: string }[]>([]);

  useEffect(() => {
    let live = true;
    void window.rowvision.listClips().then((clips) => {
      if (!live) return;
      const done = clips.filter((clip) => clip.id !== id && clip.state === "done" && clip.band !== null);
      done.sort((x, y) => (y.setup.filmed_at ?? y.createdAt).localeCompare(x.setup.filmed_at ?? x.createdAt));
      setOthers(done.map((clip) => ({ id: clip.id, label: [longDate(clip.setup.filmed_at ?? clip.createdAt), setupLine(clip.setup)].filter(Boolean).join(", ") })));
    });
    return () => { live = false; };
  }, [id]);

  if (others.length === 0) return null;
  return (
    <section className="card stack" aria-labelledby="compare-title">
      <h2 id="compare-title" style={{ fontSize: 19 }}>Compare with another clip</h2>
      <label className="field">
        <span>See what changed between this clip and another one</span>
        <select defaultValue="" onChange={(event) => { if (event.target.value) window.location.hash = `#/compare/${id}/${event.target.value}`; }}>
          <option value="">Choose a clip…</option>
          {others.map((clip) => <option key={clip.id} value={clip.id}>{clip.label}</option>)}
        </select>
      </label>
    </section>
  );
}

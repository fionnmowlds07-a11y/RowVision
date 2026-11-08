import { useEffect, useState } from "react";
import { Results } from "@/app/clips/[id]/results";
import { clipUrl, type ClipDetail } from "../shared/bridge";
import { longDate, setupLine } from "./format";

export function ClipPage({ id }: { id: string }) {
  const [clip, setClip] = useState<ClipDetail | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    void window.rowvision.getClip(id).then((found) => { if (live) setClip(found); });
    return () => { live = false; };
  }, [id]);

  if (clip === undefined) return <p aria-busy="true">Loading…</p>;
  if (clip === null) {
    return (
      <section className="card stack">
        <h1 style={{ fontSize: 24 }}>Clip not found</h1>
        <a href="#/">Back to your clips</a>
      </section>
    );
  }

  const { summary } = clip;
  return (
    <>
      <h1 style={{ fontSize: 32 }}>{longDate(clip.createdAt)}</h1>
      <p style={{ margin: 0, color: "var(--on-ground-soft)" }}>{setupLine(clip.setup)}{clip.setup.note ? `. ${clip.setup.note}` : ""}</p>
      {!summary ? (
        <section className="card stack">
          <h2 style={{ fontSize: 24 }}>Not analysed yet</h2>
        </section>
      ) : !summary.rower ? (
        <section className="card stack">
          <h2 style={{ fontSize: 24 }}>No scores for this clip</h2>
          <p className="soft">{summary.film_closer ?? summary.warnings[0] ?? "We couldn't find your rower in this clip."}</p>
        </section>
      ) : (
        <Results
          side={clip.setup.side ?? "stroke"}
          summary={summary}
          rower={summary.rower}
          videoLink={clip.hasVideo ? clipUrl(clip.id, "working.mp4") : null}
          framesLink={clip.hasVideo ? clipUrl(clip.id, "frames.json") : null}
          oldVersion={false}
          daysLeft={null}
        />
      )}
    </>
  );
}

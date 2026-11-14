import { useEffect, useState } from "react";
import { CompareWith } from "./compare-page";
import { SendClip } from "./send-dialog";
import { libraryChanged } from "./use-library";
import { Crew } from "@/app/clips/[id]/crew";
import { Results } from "@/app/clips/[id]/results";
import { clipUrl, type ClipDetail } from "../shared/bridge";
import { longDate, setupLine, size } from "./format";

export function ClipPage({ id }: { id: string }) {
  const [clip, setClip] = useState<ClipDetail | null | undefined>(undefined);
  const [count, setCount] = useState(0);
  // Which seat of a measured crew is shown. Undefined until one is pressed, which means the athlete's own.
  const [seat, setSeat] = useState<number | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    void window.rowvision.getClip(id).then((found) => { if (live) setClip(found); });
    return () => { live = false; };
  }, [id, count]);

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
  const crew = summary?.crew ?? null;
  const own = summary?.rower?.seat ?? null;
  const chosen = seat === undefined ? own : seat;
  const shown = crew?.find((rower) => rower.seat === chosen) ?? summary?.rower ?? null;
  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 32 }}>{longDate(clip.createdAt)}</h1>
          <p style={{ margin: "8px 0 0", color: "var(--on-ground-soft)" }}>{setupLine(clip.setup)}{clip.setup.note ? `. ${clip.setup.note}` : ""}</p>
        </div>
        <SendClip clip={clip} onSent={() => setCount((value) => value + 1)} />
      </div>
      {!summary ? (
        <section className="card stack">
          <h2 style={{ fontSize: 24 }}>Not analysed yet</h2>
          <a href={`#/analysis/${clip.id}`}>See how analysis is going</a>
        </section>
      ) : !summary.rower ? (
        <section className="card stack">
          <h2 style={{ fontSize: 24 }}>No scores for this clip</h2>
          <p className="soft">{summary.film_closer ?? summary.warnings[0] ?? "We couldn't find your rower in this clip."}</p>
        </section>
      ) : (
        <>
        {crew && crew.length > 1 ? <Crew crew={crew} summary={summary.crew_summary} ownSeat={own} chosen={chosen} onChoose={setSeat} /> : null}
        {crew && crew.length > 1 ? <h2 style={{ fontSize: 24 }}>{chosen === own ? "Your results" : `Seat ${chosen ?? "unknown"}`}</h2> : null}
        <Results
          key={chosen ?? "own"}
          side={clip.setup.side ?? "stroke"}
          summary={summary}
          rower={shown ?? summary.rower}
          crewSeat={crew && crew.length > 1 ? chosen : null}
          videoLink={clip.hasVideo ? clipUrl(clip.id, "working.mp4") : null}
          framesLink={clip.hasVideo ? clipUrl(clip.id, "frames.json") : null}
          oldVersion={false}
          daysLeft={null}
        />
        </>
      )}
      {summary?.rower ? <CompareWith id={clip.id} /> : null}
      <Manage clip={clip} onChange={() => { setCount((value) => value + 1); libraryChanged(); }} />
    </>
  );
}

type Asking = null | "video" | "clip";

/** Space for this clip: remove the video and keep the scores, or delete it all. */
function Manage({ clip, onChange }: { clip: ClipDetail; onChange: () => void }) {
  const [asking, setAsking] = useState<Asking>(null);
  const [busy, setBusy] = useState(false);
  const canRemoveVideo = clip.state === "done" && clip.hasVideo;

  async function go() {
    setBusy(true);
    if (asking === "video") {
      await window.rowvision.removeVideo(clip.id);
      setBusy(false);
      setAsking(null);
      onChange();
      return;
    }
    await window.rowvision.deleteClip(clip.id);
    libraryChanged();
    window.location.hash = "#/";
  }

  return (
    <section className="card stack" aria-labelledby="manage-title">
      <h2 id="manage-title" style={{ fontSize: 19 }}>This clip on your computer</h2>
      <p className="soft">
        Uses {size(clip.bytes)}{canRemoveVideo ? `, of which the video is ${size(clip.videoBytes)}` : ""}.
        {clip.state === "done" && !clip.hasVideo ? " The video was removed, and the scores were kept." : ""}
        {" "}Your original video is never changed or deleted.
      </p>
      {asking ? (
        <>
          <p><strong>{asking === "video" ? "Remove the video?" : "Delete this clip?"}</strong>{" "}
            {asking === "video" ? "The scores stay, but you won't be able to step through the frames." : "Its scores and video go for good."}</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="button quiet" disabled={busy} onClick={() => setAsking(null)}>Keep it</button>
            <button type="button" className="button primary" disabled={busy} onClick={() => void go()}>{asking === "video" ? "Remove video" : "Delete clip"}</button>
          </div>
        </>
      ) : (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {canRemoveVideo ? <button type="button" className="button quiet" onClick={() => setAsking("video")}>Remove video, keep scores</button> : null}
          <button type="button" className="button quiet" onClick={() => setAsking("clip")}>Delete clip</button>
        </div>
      )}
    </section>
  );
}

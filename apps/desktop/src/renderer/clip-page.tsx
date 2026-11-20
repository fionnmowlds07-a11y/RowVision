import { useEffect, useState } from "react";
import { CompareWith } from "./compare-page";
import { ExportPdf } from "./export-dialog";
import { SendClip } from "./send-dialog";
import { libraryChanged } from "./use-library";
import { Crew } from "@/app/clips/[id]/crew";
import { Results } from "@/app/clips/[id]/results";
import { BOAT_SEATS } from "@/lib/setup";
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
  // A coach's crew has no "you": it opens on the stroke seat, named by its number.
  const coach = clip.setup.coach === true;
  const own = coach ? null : summary?.rower?.seat ?? null;
  const chosen = seat === undefined ? summary?.rower?.seat ?? null : seat;
  const shown = crew?.find((rower) => rower.seat === chosen) ?? summary?.rower ?? null;
  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 32 }}>{longDate(clip.createdAt)}</h1>
          <p style={{ margin: "8px 0 0", color: "var(--on-ground-soft)" }}>{setupLine(clip.setup)}{clip.setup.note ? `. ${clip.setup.note}` : ""}</p>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          {summary?.rower ? <ExportPdf clip={clip} /> : null}
          <SendClip clip={clip} onSent={() => setCount((value) => value + 1)} />
        </div>
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
        {!(crew && crew.length > 1) && (BOAT_SEATS[clip.setup.boat_class ?? ""] ?? 1) > 1 && clip.hasVideo ? (
          <MeasureCrew id={clip.id} seats={BOAT_SEATS[clip.setup.boat_class ?? ""]} />
        ) : null}
        {crew && crew.length > 1 ? <Crew crew={crew} summary={summary.crew_summary} ownSeat={own} chosen={chosen} onChoose={setSeat} /> : null}
        {crew && crew.length > 1 ? <h2 style={{ fontSize: 24 }}>{chosen === own && !coach ? "Your results" : `Seat ${chosen ?? "unknown"}`}</h2> : null}
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
          measuresNote={<p className="soft" style={{ margin: "12px 0", fontSize: 14 }}>You can change what counts towards the score in <a href="#/settings">Settings</a>.</p>}
        />
        </>
      )}
      {summary?.rower ? <CompareWith id={clip.id} /> : null}
      <Manage clip={clip} onChange={() => { setCount((value) => value + 1); libraryChanged(); }} />
    </>
  );
}

/** A crew clip measured for one rower: one button measures every seat. */
function MeasureCrew({ id, seats }: { id: string; seats: number }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setProblem(null);
    const why = await window.rowvision.measureCrew(id);
    if (why) {
      setProblem(why);
      setBusy(false);
      return;
    }
    libraryChanged();
    window.location.hash = `#/analysis/${id}`;
  }

  return (
    <section className="card stack" aria-labelledby="crew-title">
      <h2 id="crew-title" style={{ fontSize: 19 }}>Measure the whole crew</h2>
      <p className="soft">
        Only you were measured. Measure all {seats} rowers to see each seat's angles and timing. It takes about {seats} times as long. If you stop it, your results now come back.
      </p>
      {problem ? <p className="error" role="alert">{problem}</p> : null}
      <div>
        <button type="button" className="button primary" disabled={busy} onClick={() => void go()}>{busy ? "Starting" : `Measure all ${seats} rowers`}</button>
      </div>
    </section>
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

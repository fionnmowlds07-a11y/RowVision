import { useEffect, useState } from "react";
import { TREND_MINIMUM, trendPoints, type ClipRow } from "@/lib/history";
import { Trend } from "@/app/trend";
import type { ClipItem } from "../shared/bridge";
import { setupLine, shortDate, size } from "./format";
import { MeasureAgain } from "./measure-again";
import { olderClips } from "./older";
import styles from "./library.module.css";

const STATE_TEXT = {
  waiting: "Waiting to be analysed",
  running: "Being analysed",
  needs_tap: "Needs you",
  stopped: "Stopped",
  failed: "Couldn't be analysed",
} as const;

type Sort = "date" | "score" | "size";

const filmed = (clip: ClipItem) => clip.setup.filmed_at ?? clip.createdAt;
/** A Poor score stays hidden, as on the website. */
const score = (clip: ClipItem) => (clip.state === "done" && clip.overall !== null && clip.band !== "Poor" ? Math.round(clip.overall) : null);

const ORDER: Record<Sort, (a: ClipItem, b: ClipItem) => number> = {
  date: (a, b) => filmed(b).localeCompare(filmed(a)),
  score: (a, b) => (score(b) ?? -1) - (score(a) ?? -1),
  size: (a, b) => b.bytes - a.bytes,
};

/** The website's trend works from rows shaped like its database's. */
function asRows(clips: ClipItem[]): ClipRow[] {
  return clips.map((clip) => ({
    id: clip.id,
    filmed_at: clip.setup.filmed_at ?? null,
    created_at: clip.createdAt,
    jobs: [],
    results: clip.state === "done" ? [{
      band: clip.band, accuracy: clip.accuracy, overall: clip.overall, code_version: clip.version ?? "", created_at: clip.createdAt,
      summary: { rower: { rate_spm: clip.rate, card: { metrics: clip.metrics } } },
    }] : [],
  }));
}

export function ClipsPage({ clips }: { clips: ClipItem[] | null }) {
  const [sort, setSort] = useState<Sort>("date");
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    void window.rowvision.engineVersion().then(setVersion);
  }, []);
  if (clips === null) return <p aria-busy="true">Loading your clips…</p>;
  const sorted = clips.slice().sort(ORDER[sort]);
  const newest = sort === "date" ? sorted.find((clip) => score(clip) !== null)?.id : undefined;
  const points = trendPoints(asRows(clips), null);
  const older = olderClips(clips, version);
  const isOlder = new Set(older.map((clip) => clip.id));

  const header = (name: Sort, label: string) => (
    <th scope="col" aria-sort={sort === name ? "descending" : undefined}>
      <button type="button" className={styles.sort} onClick={() => setSort(name)}>
        {label}<span aria-hidden="true">{sort === name ? " ↓" : ""}</span>
      </button>
    </th>
  );

  return (
    <>
      <div className={styles.head}>
        <h1 style={{ fontSize: 32 }}>Your clips</h1>
        <a className="button primary" href="#/add">Add a video</a>
      </div>
      {clips.length === 0 ? (
        <section className="card stack">
          <h2 style={{ fontSize: 19 }}>Nothing here yet</h2>
          <p className="soft">Add your first video to see your stroke measured. Side-on and close up works best.</p>
          <a href="#/guide">How to film a good clip</a>
        </section>
      ) : (
        <>
        <MeasureAgain older={older} />
        <div className={styles.tableCard}>
          <table className={styles.table}>
            <thead>
              <tr>
                {header("date", "Filmed")}
                <th scope="col">Boat and seat</th>
                {header("score", "Overall")}
                <th scope="col">Accuracy</th>
                {header("size", "Size")}
                <th scope="col">Video</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((clip) => {
                const shown = score(clip);
                return (
                  <tr key={clip.id}>
                    <td><a href={clip.state === "done" ? `#/clip/${clip.id}` : `#/analysis/${clip.id}`}>{shortDate(filmed(clip))}</a>{isOlder.has(clip.id) ? <span className={styles.older}>Older version</span> : null}</td>
                    <td>{setupLine(clip.setup) || "–"}{clip.setup.note ? <span className={styles.note}>{clip.setup.note}</span> : null}</td>
                    <td>
                      {shown !== null ? <span className={clip.id === newest ? styles.scoreMain : styles.score}>{shown}</span>
                        : clip.state === "done" && clip.band === "Poor" ? <span className={styles.soft}>Hidden</span> : <span className={styles.soft}>–</span>}
                    </td>
                    <td className={clip.band ? styles[`band${clip.band}`] : undefined}>{clip.state === "done" ? clip.band ?? "No scores" : STATE_TEXT[clip.state]}</td>
                    <td>{size(clip.bytes)}</td>
                    <td className={styles.soft}>{clip.state !== "done" ? "–" : clip.hasVideo ? "Kept" : "Removed"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}
      {clips.length > 0 ? (
        points.length >= TREND_MINIMUM ? <Trend points={points} /> : (
          <section className="card stack">
            <h2 style={{ fontSize: 19 }}>Your trend</h2>
            <p className="soft">Appears once {TREND_MINIMUM} clips are rated Good or better. You have {points.length} so far.</p>
          </section>
        )
      ) : null}
    </>
  );
}

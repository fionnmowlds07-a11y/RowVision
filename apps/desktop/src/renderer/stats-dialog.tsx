import { useEffect, useMemo, useRef, useState } from "react";
import bricolage from "@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2?inline";
import dmSans from "@fontsource-variable/dm-sans/files/dm-sans-latin-wght-normal.woff2?inline";
import type { FrameData, Rower } from "@/lib/result";
import { BOAT_NAMES, BOAT_SEATS } from "@/lib/setup";
import { clipUrl, type ClipDetail } from "../shared/bridge";
import { longDate } from "./format";
import { statsDocument, statsPages, statsReport, statsRowers, type StatsRower } from "./stats-report";
import statsCss from "./stats.css?raw";
import "./stats.css";
import styles from "./export.module.css";

const FONTS = [{ family: "Bricolage Grotesque Variable", src: bricolage }, { family: "DM Sans Variable", src: dmSans }];

type Saved = { file: string } | { problem: string } | null;

/** The statistics PDF: the coach picks the seats, sees every page, and downloads it. */
export function ExportStats({ clip }: { clip: ClipDetail }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const summary = clip.summary!;
  const seats = BOAT_SEATS[clip.setup.boat_class ?? ""] ?? 1;
  const own = clip.setup.coach ? null : summary.rower?.seat ?? null;
  const rowers: Rower[] = useMemo(() => (summary.crew && summary.crew.length > 1 ? summary.crew : summary.rower ? [summary.rower] : []), [summary]);
  const [data, setData] = useState<FrameData | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const every: StatsRower[] = useMemo(() => (data ? statsRowers(rowers, data, summary.fps, seats, own) : []), [data, rowers, summary.fps, seats, own]);
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<Saved>(null);

  // The angles for every frame are read once the window is opened.
  useEffect(() => {
    if (!open || data) return;
    let stopped = false;
    void (async () => {
      setProblem(null);
      try {
        const read = (await (await fetch(clipUrl(clip.id, "frames.json"))).json()) as FrameData;
        if (!stopped) setData(read);
      } catch {
        if (!stopped) setProblem("The measurements couldn't be read, so there is nothing to export.");
      }
    })();
    return () => { stopped = true; };
  }, [open, data, clip.id]);

  if (!summary.rower || clip.state !== "done") return null;

  const picked = chosen ?? every.map((item) => item.key);
  const boat = BOAT_NAMES[clip.setup.boat_class ?? ""] ?? clip.setup.boat_class ?? "";
  const meta = [boat, longDate(clip.createdAt)].filter(Boolean).join(", ");
  const report = statsReport(every.length > 1 ? "Crew statistics" : "Rower statistics", meta, every, picked);
  const pages = data ? statsPages(report) : [];

  function show() {
    setSaved(null);
    setOpen(true);
    dialog.current?.showModal();
  }

  function toggle(key: string) {
    setSaved(null);
    setChosen(every.filter((item) => (item.key === key ? !picked.includes(key) : picked.includes(item.key))).map((item) => item.key));
  }

  async function download() {
    setSaving(true);
    setSaved(null);
    try {
      const file = await window.rowvision.exportPdf(statsDocument(report, statsCss, FONTS), `RowVision ${longDate(clip.createdAt)} statistics`);
      setSaved(file ? { file } : null);
    } catch {
      setSaved({ problem: "The PDF couldn't be saved. Check there is space, then try again." });
    }
    setSaving(false);
  }

  const ready = data !== null && report.rowers.length > 0;
  return (
    <>
      <button type="button" className="button quiet" onClick={show}>Export stats</button>
      <dialog ref={dialog} className={styles.dialog} aria-labelledby="stats-title" onClose={() => setOpen(false)}>
        <div className={styles.bar}>
          <div>
            <h2 id="stats-title">Export the statistics</h2>
            <p className="soft">{meta}. Scores, every rower's stroke, every number, and how the drive passes from legs to back to arms.</p>
          </div>
          <button type="button" className="button quiet" onClick={() => dialog.current?.close()}>Close</button>
        </div>
        {every.length > 1 ? (
          <div className={styles.who} role="group" aria-label="Rowers in the statistics">
            {every.map((item) => (
              <button key={item.key} type="button" aria-pressed={picked.includes(item.key)} onClick={() => toggle(item.key)}>
                {item.name}{item.name.startsWith("Seat") ? null : <small>Seat {item.rower.seat}</small>}
              </button>
            ))}
          </div>
        ) : null}
        {problem ? <p role="alert" className={`error ${styles.note}`}>{problem}</p> : !data ? (
          <p className={`soft ${styles.note}`}>Reading the measurements…</p>
        ) : report.rowers.length === 0 ? (
          <p className={`soft ${styles.note}`}>Choose at least one rower.</p>
        ) : null}
        {saved ? (
          <p role="status" className={styles.note}>
            {"file" in saved ? <>Saved to {saved.file}. <button type="button" className={styles.link} onClick={() => void window.rowvision.showReport()}>Show in folder</button></> : <span className="error">{saved.problem}</span>}
          </p>
        ) : null}
        <div className={styles.statsBar}>
          <p className="soft">{ready ? `${pages.length} pages` : ""}</p>
          <button type="button" className="button primary" disabled={!ready || saving} onClick={() => void download()}>{saving ? "Saving" : "Download PDF"}</button>
        </div>
        <ul className={styles.pages} aria-label="Pages">
          {pages.map((page, index) => (
            <li key={index} className={styles.page} aria-label={`Page ${index + 1}`}>
              <div className={styles.pageInner} dangerouslySetInnerHTML={{ __html: page }} />
            </li>
          ))}
        </ul>
      </dialog>
    </>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import bricolage from "@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2?inline";
import dmSans from "@fontsource-variable/dm-sans/files/dm-sans-latin-wght-normal.woff2?inline";
import { makeScene, type Scene } from "@/app/clips/[id]/draw";
import type { FrameData, Rower } from "@/lib/result";
import { BOAT_NAMES, BOAT_SEATS } from "@/lib/setup";
import { clipUrl, type ClipDetail } from "../shared/bridge";
import { longDate } from "./format";
import { capture } from "./report-frames";
import { LAYOUTS, framesFor, pageCount, reportDocument, reportPages, reportRower, type Layout, type Pictures, type Report } from "./report";
import reportCss from "./report.css?raw";
import "./report.css";
import styles from "./export.module.css";

const FONTS = [{ family: "Bricolage Grotesque Variable", src: bricolage }, { family: "DM Sans Variable", src: dmSans }];

type Saving = { layout: Layout } | null;
type Saved = { layout: Layout; file: string } | { layout: Layout; problem: string } | null;

/** Export A: every layout drawn from this clip, side by side, and the coach downloads the one they want. */
export function ExportPdf({ clip }: { clip: ClipDetail }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const summary = clip.summary!;
  const seats = BOAT_SEATS[clip.setup.boat_class ?? ""] ?? 1;
  const own = clip.setup.coach ? null : summary.rower?.seat ?? null;
  const rowers: Rower[] = useMemo(() => (summary.crew && summary.crew.length > 1 ? summary.crew : summary.rower ? [summary.rower] : []), [summary]);
  const report = useMemo(() => rowers.map((rower) => reportRower(rower, summary.fps, seats, own)), [rowers, summary.fps, seats, own]);
  const [chosen, setChosen] = useState<string[]>(() => report.map((rower) => rower.key));
  const [pictures, setPictures] = useState<Pictures>({});
  const [step, setStep] = useState({ done: 0, total: 0 });
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState<Saving>(null);
  const [saved, setSaved] = useState<Saved>(null);

  const picked = report.filter((rower) => chosen.includes(rower.key));
  const missing = picked.filter((rower) => !pictures[rower.key]);
  const boat = BOAT_NAMES[clip.setup.boat_class ?? ""] ?? clip.setup.boat_class ?? "";
  const shown: Report = { heading: [boat, longDate(clip.createdAt)].filter(Boolean).join(", "), rowers: picked };

  // The pictures are taken once a rower is asked for, and kept while the window is open.
  useEffect(() => {
    if (!open || missing.length === 0) return;
    let stopped = false;
    void (async () => {
      setProblem(null);
      try {
        const data = (await (await fetch(clipUrl(clip.id, "frames.json"))).json()) as FrameData;
        const scenes = new Map<string, Scene | null>(missing.map((item) => {
          const rower = rowers.find((each) => String(each.seat ?? "rower") === item.key)!;
          const seat = summary.crew && summary.crew.length > 1 ? data.crew?.[String(rower.seat)] : undefined;
          return [item.key, makeScene(rower, seat ? { ...data, ...seat } : data, summary.facing, summary.view_deg, summary.other_side ?? [])];
        }));
        const found: Pictures = Object.fromEntries(missing.map((item) => [item.key, {}]));
        await capture(
          clipUrl(clip.id, "working.mp4"),
          summary.fps,
          missing.map((item) => ({ scene: scenes.get(item.key) ?? null, frames: framesFor(item), done: (frame, picture) => { found[item.key][frame] = picture; } })),
          (done, total) => { if (!stopped) setStep({ done, total }); },
          () => stopped,
        );
        if (!stopped) setPictures((before) => ({ ...before, ...found }));
      } catch {
        if (!stopped) setProblem("The video couldn't be read, so there are no pictures to export.");
      }
    })();
    return () => { stopped = true; };
    // Only a change in who is asked for starts it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, missing.map((rower) => rower.key).join()]);

  if (!summary.rower || !clip.hasVideo || clip.state !== "done") return null;

  function show() {
    setSaved(null);
    setOpen(true);
    dialog.current?.showModal();
  }

  function toggle(key: string) {
    setSaved(null);
    setChosen((before) => (before.includes(key) ? before.filter((item) => item !== key) : report.filter((rower) => rower.key === key || before.includes(rower.key)).map((rower) => rower.key)));
  }

  async function download(layout: Layout) {
    setSaving({ layout });
    setSaved(null);
    const name = LAYOUTS.find((item) => item.id === layout)!.name;
    try {
      const file = await window.rowvision.exportPdf(reportDocument(layout, shown, pictures, reportCss, FONTS), `RowVision ${longDate(clip.createdAt)} ${name}`);
      setSaved(file ? { layout, file } : null);
    } catch {
      setSaved({ layout, problem: "The PDF couldn't be saved. Check there is space, then try again." });
    }
    setSaving(null);
  }

  const ready = picked.length > 0 && missing.length === 0;
  return (
    <>
      <button type="button" className="button quiet" onClick={show}>Export PDF</button>
      <dialog ref={dialog} className={styles.dialog} aria-labelledby="export-title" onClose={() => setOpen(false)}>
        <div className={styles.bar}>
          <div>
            <h2 id="export-title">Export a PDF</h2>
            <p className="soft">{shown.heading}. Every catch and finish, with the lines and angles drawn on.</p>
          </div>
          <button type="button" className="button quiet" onClick={() => dialog.current?.close()}>Close</button>
        </div>
        {report.length > 1 ? (
          <div className={styles.who} role="group" aria-label="Rowers in the PDF">
            {report.map((rower) => (
              <button key={rower.key} type="button" aria-pressed={chosen.includes(rower.key)} onClick={() => toggle(rower.key)}>
                {rower.title}{rower.note ? <small>{rower.note}</small> : null}
              </button>
            ))}
          </div>
        ) : null}
        {problem ? <p role="alert" className={`error ${styles.note}`}>{problem}</p> : picked.length === 0 ? (
          <p className={`soft ${styles.note}`}>Choose at least one rower.</p>
        ) : !ready ? (
          <div className={styles.note}>
            <progress className={styles.progress} max={step.total || 1} value={step.done} aria-label="Taking the pictures" />
            <p className="soft">Taking the pictures: {step.done} of {step.total || "…"}</p>
          </div>
        ) : null}
        {saved ? (
          <p role="status" className={styles.note}>
            {"file" in saved ? <>Saved to {saved.file}. <button type="button" className={styles.link} onClick={() => void window.rowvision.showReport()}>Show in folder</button></> : <span className="error">{saved.problem}</span>}
          </p>
        ) : null}
        <ul className={styles.cards} aria-label="Layouts">
          {LAYOUTS.map((layout) => {
            const pages = pageCount(layout.id, picked);
            return (
              <li key={layout.id} className={styles.card}>
                <div className={styles.thumb} aria-hidden="true">
                  {ready ? <div dangerouslySetInnerHTML={{ __html: reportPages(layout.id, shown, pictures)[0] ?? "" }} /> : <div className={styles.blank} />}
                </div>
                <h3>{layout.name}</h3>
                <p className="soft">{layout.about}. {ready ? `${pages} ${pages === 1 ? "page" : "pages"}.` : ""}</p>
                <button type="button" className="button primary" disabled={!ready || saving !== null} onClick={() => void download(layout.id)} aria-label={`Download ${layout.name}`}>
                  {saving?.layout === layout.id ? "Saving" : "Download"}
                </button>
              </li>
            );
          })}
        </ul>
      </dialog>
    </>
  );
}

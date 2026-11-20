import { useEffect, useState } from "react";
import { ClipForm, PickCard, freshChoice, useVideoDrop, type Choice } from "@/app/add/clip-form";
import { fitRig, hasRig, isRig, type Rig } from "@/lib/rigs";
import { BOAT_SEATS } from "@/lib/setup";
import type { Scope } from "../shared/bridge";
import { RigPicker } from "./rig-picker";
import styles from "@/app/add/add.module.css";

/** A crew usually keeps its rig, so the last one used for each boat is offered again on this computer. */
const RIG_KEY = "rowvision.rigs";
function savedRigs(): Record<string, unknown> {
  try {
    return JSON.parse(window.localStorage.getItem(RIG_KEY) ?? "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}
function keepRig(boat: string, rig: Rig) {
  try {
    window.localStorage.setItem(RIG_KEY, JSON.stringify({ ...savedRigs(), [boat]: rig }));
  } catch {
    // Storage is blocked, so the normal rig is offered next time.
  }
}

const VIDEO_NAME = /\.(mp4|mov|m4v|avi|mkv|webm|mts|m2ts|3gp)$/i;

/** No size limit here, as nothing is uploaded. */
function refuse(file: File): string | null {
  return file.type.startsWith("video/") || VIDEO_NAME.test(file.name) ? null : "That file isn't a video. Choose a video from this computer.";
}

export function AddPage() {
  const [choice, setChoice] = useState<Choice | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>("seat");
  // Each boat's rig, bow seat first. Starts on the last one used, or the normal rig.
  const [rigs, setRigs] = useState<Record<string, unknown>>(savedRigs);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dragging = useVideoDrop(file ? null : take);

  useEffect(() => {
    let live = true;
    void window.rowvision.getSetup().then((setup) => { if (live) setChoice(freshChoice(setup)); });
    return () => { live = false; };
  }, []);

  function take(picked: File) {
    const problem = refuse(picked) ?? (window.rowvision.pathForFile(picked) ? null : "That file can't be read. Save it to this computer first.");
    setRefusal(problem);
    if (!problem) setFile(picked);
  }

  function reset() {
    setFile(null);
    setError(null);
    setChoice((old) => (old ? freshChoice(old.setup) : old));
  }

  async function save() {
    if (!file || !choice) return;
    const seats = BOAT_SEATS[choice.setup.boat] ?? 1;
    setSaving(true);
    setError(null);
    const { facts, trim, tap, setup, note } = choice;
    // A whole crew follows no one rower: the stroke seat and the rig say which side every seat rows.
    const crew = seats > 1 && scope === "crew";
    // A pair's rig follows from your side and seat. A four or eight can be rigged any way, so its rig is sent.
    const rig = hasRig(setup.boat) && (crew || seats > 2) ? fitRig(setup.boat, rigs[setup.boat]) : undefined;
    const seat = crew ? seats : setup.seat;
    const side = rig ? rig[seat - 1] : crew ? "scull" : setup.side;
    if (rig) keepRig(setup.boat, rig);
    try {
      const id = await window.rowvision.addClip({
        source: window.rowvision.pathForFile(file),
        filmedAt: new Date(file.lastModified).toISOString(),
        setup: { boat: setup.boat, seat, side },
        note,
        section: { start: facts ? trim.start : 0, length: facts ? trim.end - trim.start : null },
        tap: crew ? null : tap,
        scope: crew ? "crew" : "seat",
        coach: crew,
        ...(rig ? { rig } : {}),
      });
      window.location.hash = `#/analysis/${id}`;
    } catch {
      setError("We couldn't add this clip. Check the video is still there, then try again.");
      setSaving(false);
    }
  }

  if (!choice) return <p aria-busy="true">Loading…</p>;
  const seats = BOAT_SEATS[choice.setup.boat] ?? 1;
  const crew = seats > 1 && scope === "crew";
  const who = seats > 1 ? (
    <fieldset className={styles.who}>
      <legend>Who to measure</legend>
      <div className={styles.seg}>
        <button type="button" aria-pressed={scope === "seat"} onClick={() => setScope("seat")} disabled={saving}>Just me</button>
        <button type="button" aria-pressed={scope === "crew"} onClick={() => setScope("crew")} disabled={saving}>Whole crew</button>
      </div>
      <p className="soft" style={{ fontSize: 14 }}>
        {crew ? `Every seat is measured, with each rower's timing. No need to tap anyone. A crew of ${seats} takes about ${seats} times as long.` : "Only you are measured, which is quickest."}
      </p>
    </fieldset>
  ) : null;
  const boat = choice.setup.boat;
  const rigPicker = hasRig(boat) ? (
    <RigPicker className={styles.wide} boat={boat} rig={fitRig(boat, rigs[boat])} disabled={saving} onChange={(next) => setRigs((old) => ({ ...old, [boat]: next }))} />
  ) : null;
  const usedRig = hasRig(boat) && (crew || seats > 2) ? fitRig(boat, rigs[boat]) : null;
  const rigProblem = usedRig && !isRig(boat, usedRig) ? "Both sides need at least one rower. Click a seat to move it to the other side." : null;
  const crewField = rigPicker ?? <div className={`${styles.rig} ${styles.span}`}>Rig<p>Sculling, so nothing to set</p></div>;

  return (
    <>
      <h1 style={{ fontSize: 32 }}>Add a video</h1>
      {!file ? (
        <PickCard dragging={dragging} refusal={refusal} guide={null} onFile={take} />
      ) : (
        <ClipForm
          file={file}
          choice={choice}
          onChange={setChoice}
          onRefuse={(message) => { reset(); setRefusal(message); }}
          cannotShowNote={crew
            ? "This video can't be shown here, but it can still be analysed. Only the first 60 seconds are analysed."
            : "This video can't be shown here, but it can still be analysed. Carry on, and we'll ask you to tap yourself during analysis. Only the first 60 seconds are analysed."}
          who={who}
          crew={crew ? crewField : undefined}
          side={!crew && seats > 2 ? rigPicker ?? undefined : undefined}
        >
          <section className={`card stack ${styles.send}`} aria-label="Add the clip">
            <div className={styles.row}>
              <strong>{file.name}</strong>
              <button type="button" className="button quiet" onClick={reset} disabled={saving}>Change video</button>
            </div>
            <p className="soft">The video stays where it is and is read from there, so keep it until the clip is analysed.</p>
            {rigProblem ? <p role="alert" className="error">{rigProblem}</p> : null}
            {error ? <p role="alert" className="error">{error}</p> : null}
            <button type="button" className="button primary" onClick={save} disabled={saving || rigProblem !== null}>
              {saving ? "Adding" : "Add to your clips"}
            </button>
          </section>
        </ClipForm>
      )}
    </>
  );
}

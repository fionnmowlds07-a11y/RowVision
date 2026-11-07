"use client";

import { useActionState, useState } from "react";
import { BOAT_NAMES, BOAT_SEATS, SIDE_NAMES, fitSetup, seatsFor, sidesFor, type Setup } from "@/lib/setup";
import { deleteClip, keepForTraining, report, rerun, saveNote, stopKeeping, type ToolState } from "./actions";
import styles from "./clip.module.css";

type Props = {
  clip: string;
  result: string | null;
  note: string | null;
  setup: Setup;
  canRerun: boolean;
  own: boolean;
  admin: boolean;
  kept: boolean;
};

function Message({ state }: { state: ToolState }) {
  if (!state.message) return null;
  return <p role="status" className={state.failed ? "error" : "soft"}>{state.message}</p>;
}

export function Tools({ clip, result, note, setup: saved, canRerun, own, admin, kept }: Props) {
  const [noteState, noteAction] = useActionState(saveNote.bind(null, clip), {});
  const [rerunState, rerunAction] = useActionState(rerun.bind(null, clip), {});
  const [reportState, reportAction] = useActionState(report.bind(null, clip, result), {});
  const [setup, setSetup] = useState(saved);
  const [sure, setSure] = useState(false);

  return (
    <div className={styles.tools}>
      {own && result ? (
        <details className="card">
          <summary>Something wrong?</summary>
          <form action={reportAction} className="stack">
            <label className="field">
              What looks wrong?
              <select name="kind" defaultValue="wrong_rower">
                <option value="wrong_rower">It followed the wrong rower</option>
                <option value="angle_off">An angle looks off</option>
                <option value="other">Something else</option>
              </select>
            </label>
            <label className="field">
              Anything to add?
              <input name="message" maxLength={1000} />
            </label>
            <button className="button primary">Send</button>
            <Message state={reportState} />
          </form>
        </details>
      ) : null}
      {own ? (
        <details className="card">
          <summary>Your note</summary>
          <form action={noteAction} className="stack">
            <label className="field">
              Note
              <input name="note" defaultValue={note ?? ""} maxLength={200} />
            </label>
            <button className="button quiet">Save note</button>
            <Message state={noteState} />
          </form>
        </details>
      ) : null}
      {own && canRerun ? (
        <details className="card">
          <summary>Measure it again</summary>
          <form action={rerunAction} className="stack">
            <p className="soft">Use this if your boat, side or seat was wrong, or to use the latest version.</p>
            <label className="field">
              Boat
              <select name="boat" value={setup.boat} onChange={(e) => setSetup(fitSetup({ ...setup, boat: e.target.value }))}>
                {Object.keys(BOAT_SEATS).map((boat) => <option key={boat} value={boat}>{BOAT_NAMES[boat]}</option>)}
              </select>
            </label>
            <label className="field">
              Side
              <select name="side" value={setup.side} onChange={(e) => setSetup({ ...setup, side: e.target.value })}>
                {sidesFor(setup.boat).map((side) => <option key={side} value={side}>{SIDE_NAMES[side]}</option>)}
              </select>
            </label>
            <label className="field">
              Your seat
              <select name="seat" value={setup.seat} onChange={(e) => setSetup({ ...setup, seat: Number(e.target.value) })}>
                {seatsFor(setup.boat).map((seat) => <option key={seat} value={seat}>{seat}</option>)}
              </select>
            </label>
            <button className="button primary">Measure again</button>
            <Message state={rerunState} />
          </form>
        </details>
      ) : null}
      {admin && canRerun ? (
        <section className="card stack">
          <p className="soft">{kept ? "Kept for training. It won't be deleted after 30 days." : "Admin: not kept for training."}</p>
          <button type="button" className="button quiet" onClick={() => (kept ? stopKeeping(clip) : keepForTraining(clip))}>
            {kept ? "Stop keeping" : "Keep for training"}
          </button>
        </section>
      ) : null}
      {own ? (
        <section className="stack">
          {sure ? (
            <>
              <p className={styles.small}>This removes the video and results for good.</p>
              <button type="button" className="button quiet" onClick={() => deleteClip(clip)}>Yes, delete this clip</button>
              <button type="button" className="button quiet" onClick={() => setSure(false)}>Keep it</button>
            </>
          ) : (
            <button type="button" className="button quiet" onClick={() => setSure(true)}>Delete this clip</button>
          )}
        </section>
      ) : null}
    </div>
  );
}

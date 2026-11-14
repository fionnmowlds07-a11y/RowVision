import { useState } from "react";
import type { ClipItem } from "../shared/bridge";
import { olderLine } from "./older";
import { libraryChanged } from "./use-library";
import styles from "./library.module.css";

/** One button for every clip an older version measured. Each takes a few seconds, from its saved skeleton. */
export function MeasureAgain({ older }: { older: ClipItem[] }) {
  const [done, setDone] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  if (older.length === 0 && !problem) return null;

  async function go() {
    setProblem(null);
    let failed = 0;
    let why: string | null = null;
    for (const [index, clip] of older.entries()) {
      setDone(index);
      const message = await window.rowvision.measureAgain(clip.id);
      if (message) {
        failed += 1;
        why = message;
      }
    }
    setDone(null);
    if (failed) setProblem(failed === 1 && older.length === 1 ? why : `${failed} of ${older.length} couldn't be measured again. Their scores are unchanged.`);
    libraryChanged();
  }

  return (
    <section className={`card ${styles.again}`} aria-label="Older clips">
      <div>
        {older.length > 0 ? <p style={{ margin: 0 }}>{olderLine(older.length)}</p> : null}
        <p className="soft" style={{ fontSize: 14 }}>Measuring again takes a few seconds each and may change scores a little.</p>
        {problem ? <p className="error" role="alert">{problem}</p> : null}
      </div>
      {older.length > 0 ? (
        <button type="button" className="button primary" disabled={done !== null} onClick={() => void go()}>
          {done === null ? "Measure all again" : `Measuring ${done + 1} of ${older.length}…`}
        </button>
      ) : null}
    </section>
  );
}

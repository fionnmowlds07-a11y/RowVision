import { crewRows, degrees, seatLabel } from "@/lib/crew";
import type { CrewSummary, Rower } from "@/lib/result";
import styles from "./clip.module.css";

type Props = {
  crew: Rower[];
  summary: CrewSummary | null | undefined;
  ownSeat: number | null;
  /** The seat whose results are shown underneath. */
  chosen: number | null;
  onChoose: (seat: number | null) => void;
};

/** The boat from stroke to bow: each seat's catch timing against who it follows, and its body angle. */
export function Crew({ crew, summary, ownSeat, chosen, onChoose }: Props) {
  const rows = crewRows(crew, ownSeat);
  return (
    <section className="card stack" aria-labelledby="crew-title">
      <h2 id="crew-title" style={{ fontSize: 24 }}>Your crew</h2>
      <div className={styles.crewTiles}>
        <div className={styles.tile}><span>Catch angles within</span><strong>{degrees(summary?.catch_lean_range_deg ?? null)}</strong></div>
        <div className={styles.tile}><span>Laybacks within</span><strong>{degrees(summary?.finish_lean_range_deg ?? null)}</strong></div>
      </div>
      <p className={styles.small} style={{ color: "var(--ink-soft)" }}>
        Each bar is the catch against the rower that seat follows: left is early, right is late, and no bar is in time. Good to about 50 ms. Press a seat to see its results below.
      </p>
      <ul className={styles.boat}>
        {rows.map((row) => (
          <li key={row.seat ?? "unknown"}>
            <button type="button" className={styles.seat} aria-pressed={row.seat === chosen} aria-label={seatLabel(row)} onClick={() => onChoose(row.seat)}>
              <span className={styles.seatName}>
                <strong>{row.seat ?? "?"}</strong>
                {row.you ? <span className={styles.you}>You</span> : row.follows === null ? <span className={styles.pill}>Stroke</span> : null}
              </span>
              <span className={styles.timingBar} aria-hidden="true">
                {row.bar ? <i style={{ left: `${row.bar.left}%`, width: `${row.bar.width}%` }} /> : null}
              </span>
              <span className={styles.seatAngle}>{degrees(row.catchLean)}</span>
            </button>
          </li>
        ))}
      </ul>
      <details>
        <summary>See the numbers</summary>
        <div className={styles.scroll}>
          <table className={styles.strokeTable}>
            <thead>
              <tr><th scope="col">Seat</th><th scope="col">Overall</th><th scope="col">Catch</th><th scope="col">Layback</th><th scope="col">Follows</th><th scope="col">Catch timing</th><th scope="col">Finish timing</th></tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.seat ?? "unknown"}>
                  <th scope="row">{row.seat ?? "?"}{row.you ? " (you)" : ""}</th>
                  <td>{row.overall === null ? "–" : Math.round(row.overall)}</td>
                  <td>{degrees(row.catchLean)}</td>
                  <td>{degrees(row.layback)}</td>
                  <td>{row.follows === null ? "–" : `Seat ${row.follows}`}</td>
                  <td>{row.catchTiming}</td>
                  <td>{row.finishTiming}</td>
                </tr>
              ))}
              <tr className={styles.fadeRow}>
                <th scope="row">Furthest apart</th><td></td>
                <td>{degrees(summary?.catch_lean_range_deg ?? null)}</td>
                <td>{degrees(summary?.finish_lean_range_deg ?? null)}</td>
                <td></td><td></td><td></td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

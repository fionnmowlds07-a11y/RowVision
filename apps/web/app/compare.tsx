import { OVERALL_MARGIN, compareOverall, compareRowers, ratesDiffer, verdictText, type Comparison } from "@/lib/compare";
import { MARGIN_DEG } from "@/lib/history";
import { formatValue } from "@/lib/logic";
import type { Rower } from "@/lib/result";
import styles from "./compare.module.css";

export type Side = { label: string; rower: Rower };

const GOOD = new Set(["nearer"]);
const shown = (rower: Rower) => (rower.card.overall !== null && rower.rating.band !== "Poor" ? Math.round(rower.card.overall) : null);

function Row({ row }: { row: Comparison }) {
  return (
    <tr>
      <td><strong>{formatValue(row.name, row.before)}</strong></td>
      <th scope="row">
        <span className={styles.name}>{row.label}</span>
        <span className={GOOD.has(row.verdict ?? "") ? styles.good : styles.pill}>{verdictText(row)}</span>
      </th>
      <td><strong>{formatValue(row.name, row.after)}</strong></td>
    </tr>
  );
}

/** Two clips of the same rower, the earlier on the left, with the change in the middle. */
export function Compare({ before, after }: { before: Side; after: Side }) {
  const rows = compareRowers(before.rower, after.rower);
  const overall = compareOverall(before.rower, after.rower);
  const was = shown(before.rower);
  const now = shown(after.rower);
  const poor = before.rower.rating.band === "Poor" || after.rower.rating.band === "Poor";
  return (
    <section className="card stack" aria-label="Comparison">
      <p className="soft" style={{ fontSize: 14 }}>
        A change under about {MARGIN_DEG}° may only be measurement noise, so it is marked too close to call.
        {ratesDiffer(before.rower, after.rower) ? " These clips are at different rates, so the rhythm numbers are not like for like." : ""}
        {poor ? " A clip rated Poor keeps its overall score hidden, and its numbers are less sure." : ""}
      </p>
      <div className={styles.scroll}>
        <table className={styles.table}>
          <thead>
            <tr><th scope="col">{before.label}</th><th scope="col">Change</th><th scope="col">{after.label}</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><strong className={styles.big}>{was ?? "–"}</strong></td>
              <th scope="row">
                <span className={styles.name}>Overall</span>
                {was !== null && now !== null && overall ? (
                  <span className={overall.clear && overall.change > 0 ? styles.good : styles.pill}>
                    {overall.clear ? `${Math.round(Math.abs(overall.change))} ${overall.change > 0 ? "better" : "lower"}` : `Under ${OVERALL_MARGIN} points apart`}
                  </span>
                ) : <span className={styles.pill}>Not in both clips</span>}
              </th>
              <td><strong className={styles.big}>{now ?? "–"}</strong></td>
            </tr>
            <tr>
              <td><strong>{before.rower.rate_spm ? Math.round(before.rower.rate_spm) : "–"}</strong></td>
              <th scope="row"><span className={styles.name}>Rate</span></th>
              <td><strong>{after.rower.rate_spm ? Math.round(after.rower.rate_spm) : "–"}</strong></td>
            </tr>
            {rows.map((row) => <Row key={row.name} row={row} />)}
          </tbody>
        </table>
      </div>
    </section>
  );
}

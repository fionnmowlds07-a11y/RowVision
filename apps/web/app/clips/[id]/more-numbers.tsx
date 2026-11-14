import { formatValue } from "@/lib/logic";
import type { Metric } from "@/lib/result";
import styles from "./clip.module.css";

const GROUPS: { title: string; names: string[] }[] = [
  { title: "Rhythm", names: ["drive_s", "recovery_s", "ratio", "rate_steadiness"] },
  { title: "Body and arms", names: ["body_swing_deg", "catch_elbow_deg", "arms_break", "finish_elbow_deg", "stroke_length"] },
];

/** The measures that are shown and never scored. Nothing is drawn for a result from before they existed. */
export function MoreNumbers({ extras }: { extras: Metric[] | undefined }) {
  if (!extras?.length) return null;
  const byName = new Map(extras.map((metric) => [metric.name, metric]));
  return (
    <section className="card stack" aria-labelledby="more-title">
      <h2 id="more-title" style={{ fontSize: 19 }}>More numbers</h2>
      <p className={styles.small} style={{ color: "var(--ink-soft)" }}>Shown only. These don&apos;t count towards your score, as there are no published targets for them yet.</p>
      {GROUPS.map(({ title, names }) => {
        const rows = names.flatMap((name) => byName.get(name) ?? []);
        if (rows.length === 0) return null;
        return (
          <div key={title}>
            <h3 className={styles.group}>{title}</h3>
            <dl className={styles.numbers}>
              {rows.map((metric) => (
                <div key={metric.name}>
                  <dt>{metric.label}</dt>
                  <dd>{metric.value === null ? <span className={styles.unseen}>{metric.reason ?? "Not measured"}</span> : formatValue(metric.name, metric.value)}</dd>
                </div>
              ))}
            </dl>
          </div>
        );
      })}
    </section>
  );
}

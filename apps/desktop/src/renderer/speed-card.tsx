import { useEffect, useState } from "react";
import { EFFORTS, effortPlan, type Effort } from "../shared/effort";
import styles from "@/app/add/add.module.css";

/** How hard analysis works the computer: fast and busy, or slower and out of the way. */
export function SpeedCard() {
  const [now, setNow] = useState<{ effort: Effort; cores: number } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    void window.rowvision.getEffort().then((found) => { if (live) setNow(found); });
    return () => { live = false; };
  }, []);

  if (!now) return null;
  const chosen = EFFORTS.find((item) => item.id === now.effort)!;
  const plan = effortPlan(now.effort, now.cores);

  async function choose(effort: Effort) {
    if (!now || effort === now.effort) return;
    setSaving(true);
    await window.rowvision.setEffort(effort);
    setNow({ ...now, effort });
    setSaving(false);
  }

  return (
    <section className="card stack" style={{ maxWidth: 640 }} aria-labelledby="speed-title">
      <h2 id="speed-title" style={{ fontSize: 19 }}>Analysis speed</h2>
      <p className="soft">Analysing a clip works your computer hard for several minutes. It may get warm and the fan may run. Choose how much of it RowVision uses.</p>
      <div className={styles.seg} style={{ gridTemplateColumns: "repeat(3, 1fr)" }} role="group" aria-label="Analysis speed">
        {EFFORTS.map((item) => (
          <button key={item.id} type="button" aria-pressed={item.id === now.effort} disabled={saving} onClick={() => void choose(item.id)}>{item.name}</button>
        ))}
      </div>
      <p role="status">
        <strong>{chosen.name}.</strong> {chosen.about}{" "}
        <span className="soft">{plan.threads === null ? `All ${now.cores} cores` : `${plan.threads} of ${now.cores} cores`} on this computer.</span>
      </p>
      <p className="soft" style={{ fontSize: 14 }}>A change applies from the next clip analysed. Plugging a laptop in also makes analysis quicker.</p>
    </section>
  );
}

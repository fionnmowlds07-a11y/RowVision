import { ACCURATE_DOWNLOAD, POSE_MODELS, type PoseModel } from "../shared/pose-model";
import { useModels } from "./use-models";
import styles from "@/app/add/add.module.css";

/** Which model measures the clip: the larger one, or the quicker one. */
export function ModelPicker({ model, disabled, onChange }: { model: PoseModel; disabled: boolean; onChange: (model: PoseModel) => void }) {
  const models = useModels();
  const chosen = POSE_MODELS.find((item) => item.id === model)!;
  const needed = model === "accurate" && models?.standardReady === true && models.state !== "ready";
  return (
    <section className="card stack" aria-labelledby="model-title">
      <h2 id="model-title" style={{ fontSize: 19 }}>Accuracy</h2>
      <div className={styles.seg} role="group" aria-labelledby="model-title">
        {POSE_MODELS.map((item) => (
          <button key={item.id} type="button" aria-pressed={item.id === model} disabled={disabled} onClick={() => onChange(item.id)}>{item.name}</button>
        ))}
      </div>
      <p className="soft" style={{ fontSize: 14 }}>{chosen.about}</p>
      {needed ? <p className={styles.caution}>This needs a one-time download, {ACCURATE_DOWNLOAD}. It starts when you add the clip, and the clip waits for it.</p> : null}
    </section>
  );
}

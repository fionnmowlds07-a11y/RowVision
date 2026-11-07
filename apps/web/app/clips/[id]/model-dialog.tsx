"use client";

import { useEffect, useRef, useState } from "react";
import { formatTarget, formatValue, modelRequest } from "@/lib/logic";
import type { Metric } from "@/lib/result";
import type { ModelHandle } from "./model.mjs";
import styles from "./clip.module.css";

type Props = { name: string; side: string; metrics: Metric[]; onClose: () => void };

export function ModelDialog({ name, side, metrics, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const model = useRef<ModelHandle | null>(null);
  const [failed, setFailed] = useState(false);
  const metric = metrics.find((item) => item.name === name);
  const request = modelRequest(name, metrics as Parameters<typeof modelRequest>[1]);

  useEffect(() => {
    dialog.current?.showModal();
    let live = true;
    import("./model.mjs")
      .then(({ showModel }) => showModel(host.current!, request, side, true))
      .then((handle) => {
        if (live) model.current = handle;
        else handle.close();
      })
      .catch(() => setFailed(true));
    return () => {
      live = false;
      model.current?.close();
    };
    // The model is built once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <dialog ref={dialog} className={styles.model} aria-labelledby="model-title" onClose={onClose}>
      <h2 id="model-title" style={{ fontSize: 19 }}>{metric?.label}</h2>
      <p className="soft">Target {formatTarget(name, metric?.target ?? null)}. You {formatValue(name, metric?.value)}.</p>
      <div ref={host} className={styles.modelView} />
      {failed ? <p className="error">The 3D model could not open on this device.</p> : null}
      {request.assumed.length ? <p className="soft">{request.assumed.join(" and ")} could not be measured reliably, so your pose uses the target there.</p> : null}
      <div className={styles.controls}>
        {(["side", "stern", "above"] as const).map((view) => (
          <button key={view} type="button" className="button quiet" onClick={() => model.current?.setView(view)}>{view[0].toUpperCase() + view.slice(1)}</button>
        ))}
        <label className={styles.toggle}>
          <input type="checkbox" defaultChecked onChange={(event) => model.current?.setYours(event.target.checked)} />
          Show yours
        </label>
        <button type="button" className="button primary" onClick={onClose}>Close</button>
      </div>
      <p className="soft" style={{ fontSize: 13 }}>Drag to rotate, and pinch or scroll to zoom. Teal is the target and orange is you.</p>
    </dialog>
  );
}

import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import {
  GENERAL_TARGETS, MAX_WIDTH, TARGET_METRICS, maxWidth, overallProblem, rangeProblem, sameChoices,
  type TargetChoices, type TargetName,
} from "@/lib/targets";
import type { ClipItem } from "../shared/bridge";
import { libraryChanged } from "./use-library";
import styles from "./targets.module.css";

type Drag = { name: TargetName; mode: "low" | "high" | "move"; start: number; low: number; high: number };

/** Technique targets in Settings: which measures count towards the score, and the range for each. */
export function TargetsCard() {
  const [choices, setChoices] = useState<TargetChoices | null>(null);
  // What is typed in each box, which can be half-finished, so a number is only saved once it is valid.
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [latest, setLatest] = useState<ClipItem | null>(null);
  const drag = useRef<Drag | null>(null);

  const readLatest = useCallback(() => {
    void window.rowvision.listClips().then((clips) => setLatest(clips.find((clip) => clip.analysed) ?? null));
  }, []);
  useEffect(() => {
    void window.rowvision.getTargets().then(setChoices);
    readLatest();
  }, [readLatest]);

  if (!choices) return null;
  const changed = !sameChoices(choices, GENERAL_TARGETS);

  async function save(next: TargetChoices) {
    setChoices(next);
    setChoices(await window.rowvision.setTargets(next));
    libraryChanged();
    readLatest();
  }
  const set = (name: TargetName, patch: Partial<TargetChoices[TargetName]>) => {
    const next = { ...choices, [name]: { ...choices[name], ...patch } };
    setTyped((now) => ({ ...now, [`${name}-low`]: String(next[name].low), [`${name}-high`]: String(next[name].high) }));
    return save(next);
  };
  const type = (name: TargetName, end: "low" | "high", text: string) => {
    setTyped((now) => ({ ...now, [`${name}-${end}`]: text }));
    const other = Number(typed[`${name}-${end === "low" ? "high" : "low"}`] ?? choices[name][end === "low" ? "high" : "low"]);
    const value = text.trim() === "" ? Number.NaN : Number(text);
    const [low, high] = end === "low" ? [value, other] : [other, value];
    if (rangeProblem(name, low, high) === null) void save({ ...choices, [name]: { ...choices[name], low, high } });
  };
  const problem = (name: TargetName) => {
    const low = Number(typed[`${name}-low`] ?? choices[name].low);
    const high = Number(typed[`${name}-high`] ?? choices[name].high);
    return rangeProblem(name, low, high);
  };
  const nudge = (name: TargetName, end: "low" | "high", by: number) => {
    const next = { ...choices[name], [end]: choices[name][end] + by };
    if (rangeProblem(name, next.low, next.high) === null) void set(name, next);
    else setTyped((now) => ({ ...now, [`${name}-${end}`]: String(next[end]) }));
  };

  const metric = (name: TargetName) => TARGET_METRICS.find((item) => item.name === name)!;
  const valueAt = (name: TargetName, event: PointerEvent<HTMLElement>) => {
    const { min, max } = metric(name);
    const box = event.currentTarget.getBoundingClientRect();
    return min + ((event.clientX - box.left) / box.width) * (max - min);
  };
  const begin = (name: TargetName, event: PointerEvent<HTMLElement>) => {
    const at = valueAt(name, event);
    const { low, high } = choices[name];
    const mode = Math.abs(at - low) < 2 ? "low" : Math.abs(at - high) < 2 ? "high" : at > low && at < high ? "move" : at < low ? "low" : "high";
    drag.current = { name, mode, start: at, low, high };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (name: TargetName, event: PointerEvent<HTMLElement>) => {
    const now = drag.current;
    if (!now || now.name !== name) return;
    const { min, max } = metric(name);
    const at = valueAt(name, event);
    let { low, high } = now;
    if (now.mode === "move") {
      const by = Math.round(at - now.start);
      low = Math.min(Math.max(now.low + by, min), max - (now.high - now.low));
      high = low + (now.high - now.low);
    } else if (now.mode === "low") {
      low = Math.min(Math.max(Math.round(at), min, high - maxWidth(name)), high - 1);
    } else {
      high = Math.max(Math.min(Math.round(at), max, low + maxWidth(name)), low + 1);
    }
    setChoices({ ...choices, [name]: { ...choices[name], low, high } });
    setTyped((all) => ({ ...all, [`${name}-low`]: String(low), [`${name}-high`]: String(high) }));
  };
  const end = (name: TargetName) => {
    if (drag.current?.name === name) void save(choices);
    drag.current = null;
  };

  const percent = (name: TargetName, value: number) => ((value - metric(name).min) / (metric(name).max - metric(name).min)) * 100;
  const row = (name: TargetName) => {
    const info = metric(name);
    const mine = choices[name];
    const standard = GENERAL_TARGETS[name];
    const last = latest?.metrics.find((item) => item.name === name)?.value ?? null;
    const wrong = problem(name);
    const unchanged = mine.low === standard.low && mine.high === standard.high;
    return (
      <div className={styles.row} key={name} data-testid={`target-${name}`}>
        <div className={styles.name}>
          <b>{info.label}</b>
          <span className={styles.help}>{info.help}</span>
          {wrong ? <p className={styles.problem} role="alert">{wrong}</p> : null}
        </div>
        {/* The boxes beside it do the same job for the keyboard and screen readers. */}
        <div
          className={styles.bar}
          role="presentation"
          onPointerDown={(event) => begin(name, event)}
          onPointerMove={(event) => move(name, event)}
          onPointerUp={() => end(name)}
          onPointerCancel={() => end(name)}
        >
          <div className={styles.standard} style={{ left: `${percent(name, standard.low)}%`, width: `${percent(name, standard.high) - percent(name, standard.low)}%` }} />
          <div className={styles.band} style={{ left: `${percent(name, mine.low)}%`, width: `${Math.max(1, percent(name, mine.high) - percent(name, mine.low))}%` }} />
          {last !== null && last >= info.min && last <= info.max ? <div className={styles.last} style={{ left: `${percent(name, last)}%` }} title="Your latest clip" /> : null}
          <span className={styles.tick} style={{ left: "0%" }}>{info.min}°</span>
          <span className={styles.tick} style={{ left: "100%" }}>{info.max}°</span>
        </div>
        <div className={styles.side}>
          <div className={styles.numbers}>
            <button type="button" className={styles.step} aria-label={`Lower the bottom of ${info.label}`} onClick={() => nudge(name, "low", -1)}>−</button>
            <input type="number" step={1} aria-label={`Bottom of the range for ${info.label}`} aria-invalid={wrong !== null} value={typed[`${name}-low`] ?? String(mine.low)} onChange={(event) => type(name, "low", event.target.value)} />
            <button type="button" className={styles.step} aria-label={`Raise the bottom of ${info.label}`} onClick={() => nudge(name, "low", 1)}>+</button>
            <span className="soft">to</span>
            <button type="button" className={styles.step} aria-label={`Lower the top of ${info.label}`} onClick={() => nudge(name, "high", -1)}>−</button>
            <input type="number" step={1} aria-label={`Top of the range for ${info.label}`} aria-invalid={wrong !== null} value={typed[`${name}-high`] ?? String(mine.high)} onChange={(event) => type(name, "high", event.target.value)} />
            <button type="button" className={styles.step} aria-label={`Raise the top of ${info.label}`} onClick={() => nudge(name, "high", 1)}>+</button>
          </div>
          <div className={styles.actions}>
            {unchanged ? null : <button type="button" className="button quiet" onClick={() => void set(name, { low: standard.low, high: standard.high })}>Reset</button>}
            <button type="button" className={`button ${mine.counts ? "quiet" : "primary"}`} onClick={() => void set(name, { counts: !mine.counts })}>
              {mine.counts ? "Stop counting" : "Add to score"}
            </button>
          </div>
        </div>
      </div>
    );
  };

  const counting = TARGET_METRICS.filter((item) => choices[item.name].counts);
  const shown = TARGET_METRICS.filter((item) => !choices[item.name].counts);
  const missing = overallProblem(choices);
  return (
    <section className="card stack" aria-labelledby="targets-title" data-testid="targets-card">
      <div className={styles.head}>
        <h2 id="targets-title" style={{ fontSize: 19 }}>Technique targets</h2>
        <span className={`${styles.pill} ${changed ? styles.mine : ""}`}>{changed ? "Your own setup" : "General standard"}</span>
      </div>
      <p className="soft">Choose which measures count towards the score, and the range for each. Drag a bar or type the numbers. A range can be {MAX_WIDTH}° wide at most, or {maxWidth("finish_lean_deg")}° for the finish body angle. These ranges are provisional: a coach has not reviewed them.</p>
      <div className={styles.legend}>
        <span><i style={{ background: "var(--link)" }} />Your range</span>
        <span><i style={{ border: "2px dashed var(--ink)", opacity: 0.6 }} />General standard</span>
        <span><i style={{ background: "var(--ink)", width: 3 }} />Your latest clip</span>
      </div>
      <h3 className={styles.group}>Counts towards your score</h3>
      {counting.length ? counting.map((item) => row(item.name)) : <p className="soft">Nothing yet.</p>}
      <h3 className={styles.group}>Shown only, no points</h3>
      {shown.length ? shown.map((item) => row(item.name)) : <p className="soft">Every measure counts.</p>}
      <div className={styles.live} role="status">
        <div>
          <div className="soft">Your latest clip scores</div>
          <strong>{missing || latest?.overall == null ? "No score" : Math.round(latest.overall)}</strong>
        </div>
        <p className="soft" style={{ flex: 1, minWidth: 220 }}>
          {missing ?? (!latest ? "Analyse a clip and its score shows here." : latest.overall === null ? "This clip does not have enough measured to give an overall score." : "With these ranges, worked out again from what was measured. Nothing is analysed again.")}
        </p>
      </div>
      <div>
        <button type="button" className="button quiet" disabled={!changed} onClick={() => { setTyped({}); void save(GENERAL_TARGETS); }}>Reset everything to the general standard</button>
      </div>
    </section>
  );
}

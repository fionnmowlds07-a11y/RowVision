"use client";

import { useState, useTransition } from "react";
import { DEFAULT_COLOURS, PRESETS, textOn } from "@/lib/colours";
import { saveColours } from "./actions";
import styles from "./colours.module.css";

export function Colours({ ground: savedGround, highlight: savedHighlight }: { ground: string | null; highlight: string | null }) {
  const [ground, setGround] = useState(savedGround ?? DEFAULT_COLOURS.ground);
  const [highlight, setHighlight] = useState(savedHighlight ?? DEFAULT_COLOURS.highlight);
  const [saving, start] = useTransition();

  return (
    <section className="card stack" style={{ maxWidth: 480 }} aria-labelledby="colours-title">
      <h2 id="colours-title" style={{ fontSize: 19 }}>Your colours</h2>
      <p className="soft">Start from the club greens, or make it your own. Text switches between black and white by itself.</p>
      <div className={styles.presets}>
        {PRESETS.map((preset) => (
          <button
            key={preset.name}
            type="button"
            className={styles.preset}
            style={{ background: preset.ground, color: textOn(preset.ground) }}
            aria-pressed={preset.ground === ground && preset.highlight === highlight}
            onClick={() => { setGround(preset.ground); setHighlight(preset.highlight); }}
          >
            <span style={{ background: preset.highlight }} aria-hidden="true" />
            {preset.name}
          </button>
        ))}
      </div>
      <label className={styles.pick}>Background <input type="color" value={ground} onChange={(event) => setGround(event.target.value)} /></label>
      <label className={styles.pick}>Highlight <input type="color" value={highlight} onChange={(event) => setHighlight(event.target.value)} /></label>
      <div className={styles.sample} style={{ background: ground, color: textOn(ground) }}>
        Preview
        <span style={{ background: highlight, color: textOn(highlight) }}>87</span>
      </div>
      <button type="button" className="button primary" disabled={saving} onClick={() => start(() => saveColours(ground, highlight))}>Save colours</button>
      <button
        type="button"
        className="button quiet"
        disabled={saving}
        onClick={() => {
          setGround(DEFAULT_COLOURS.ground);
          setHighlight(DEFAULT_COLOURS.highlight);
          start(() => saveColours(null, null));
        }}
      >
        Reset to the club greens
      </button>
    </section>
  );
}

import { flipSeat, presetOf, presetsFor, type Rig } from "@/lib/rigs";
import styles from "./rig.module.css";

/** Which side each seat rows on: a usual rig from the list, or any rig by clicking seats in the drawing. */
export function RigPicker({ boat, rig, onChange, disabled, className }: { boat: string; rig: Rig; onChange: (rig: Rig) => void; disabled?: boolean; className?: string }) {
  const presets = presetsFor(boat);
  const preset = presetOf(boat, rig);
  return (
    <div className={`${styles.rig} ${className ?? ""}`}>
      <label className="field">
        Rig
        <select value={preset?.id ?? "custom"} disabled={disabled} onChange={(event) => {
          const chosen = presets.find((item) => item.id === event.target.value);
          if (chosen) onChange(chosen.sides);
        }}>
          {presets.map((item) => <option key={item.id} value={item.id}>{item.name}: {item.about.toLowerCase()}</option>)}
          <option value="custom" disabled={Boolean(preset)}>Custom: click the seats below</option>
        </select>
      </label>
      <div className={styles.boat} role="group" aria-label="Each seat's side. Click a seat to move it to the other side." style={{ gridTemplateColumns: `auto repeat(${rig.length}, minmax(0, 1fr)) auto` }}>
        <span className={styles.sideName}>Bow side</span>
        {rig.map((side, index) => <span key={`b${index}`} className={styles.oar}>{side === "bow" ? <i /> : null}</span>)}
        <span />
        <span className={styles.end}>Bow</span>
        {rig.map((side, index) => {
          const seat = index + 1;
          return (
            <button key={seat} type="button" className={styles.seat} data-side={side} disabled={disabled} onClick={() => onChange(flipSeat(rig, seat))}
              aria-label={`Seat ${seat}, ${side} side. Move to ${side === "stroke" ? "bow" : "stroke"} side`}>
              {seat}
            </button>
          );
        })}
        <span className={styles.end}>Stroke</span>
        <span className={styles.sideName}>Stroke side</span>
        {rig.map((side, index) => <span key={`s${index}`} className={styles.oar}>{side === "stroke" ? <i /> : null}</span>)}
        <span />
      </div>
    </div>
  );
}

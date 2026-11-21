import { handoverNotes, statsReport, type StatsRower } from "./stats-report";
import { BackOpensStrip, BoatTimeline, DriveChart, PartKey } from "./handover-charts";
import { comingForward } from "./rower-stats";
import { drawn } from "./use-clip-stats";
import styles from "./crew-stats.module.css";

type Props = {
  clipId: string;
  every: StatsRower[];
  leadName: string;
  /** The rowers whose lines are shown. */
  shown: string[];
  onToggle: (key: string) => void;
  /** Jumps the video to a frame, when there is a video. */
  onPick: ((frame: number) => void) | null;
};

/** How each rower passes the drive from legs to back to arms, and the order coming forward. */
export function HandOver({ clipId, every, leadName, shown, onToggle, onPick }: Props) {
  const items = every.filter((item) => shown.includes(item.key));
  const notes = handoverNotes(statsReport("", "", every, shown));
  const pair = every.length > 1 ? every.slice(0, 2) : null;
  return (
    <section className="card stack" aria-labelledby="handover-title">
      <div className={styles.titleRow}>
        <h2 id="handover-title" style={{ fontSize: 24 }}>Hand-over: legs, back, arms</h2>
        {every.length ? <a className="button quiet" href={pair ? `#/rowers/${clipId}/${pair[0].key}/${clipId}/${pair[1].key}` : `#/rowers/${clipId}/${every[0].key}`}>Compare two rowers</a> : null}
      </div>
      {every.length > 1 ? (
        <div className={styles.chips} role="group" aria-label="Rowers in the hand-over">
          {every.map((item) => (
            <button key={item.key} type="button" aria-pressed={shown.includes(item.key)} onClick={() => onToggle(item.key)}>
              <i style={{ background: drawn(item).colour }} />{item.name}
              <small>{item.rower.card.overall === null ? "–" : Math.round(item.rower.card.overall)}</small>
            </button>
          ))}
        </div>
      ) : null}
      {items.length === 0 ? <p className="soft">Choose at least one rower.</p> : (
        <>
          <div className={styles.callout}>
            <p className={styles.headline}>{notes.headline}</p>
            {notes.lines.length ? <p className="soft">{notes.lines.join(" ")}</p> : null}
          </div>
          <div className={styles.titleRow}><h3>The drive, as a share of each rower&apos;s own drive</h3><PartKey /></div>
          <div className={styles.drives}>
            {items.map((item) => <DriveChart key={item.key} item={drawn(item)} />)}
          </div>
          {every.length > 1 ? (
            <>
              <div className={styles.titleRow}><h3>In the boat: when each part moves</h3><span className="soft">seconds after {leadName}&apos;s catch · bar = moving · dot = middle · | = finish</span></div>
              <div className={styles.timeline}><BoatTimeline items={items.map((item) => drawn(item))} leadName={leadName} /></div>
            </>
          ) : null}
          <div className={styles.twoUp}>
            <div>
              <h3>When the back starts to open</h3>
              <p className="soft">Share of the drive gone, every stroke. The line is the typical stroke.{onPick ? " Press a dot to see that stroke in the video." : ""}</p>
              <div className={styles.timeline}><BackOpensStrip items={items.map((item) => drawn(item))} onPick={onPick} /></div>
            </div>
            <div>
              <h3>Coming forward</h3>
              <ul className={styles.forward}>
                {items.map((item) => (
                  <li key={item.key}><strong style={{ color: drawn(item).colour }}>{item.name}</strong> <span>{comingForward(item.hand) || "could not be timed"}</span></li>
                ))}
              </ul>
            </div>
          </div>
          <p className="soft" style={{ fontSize: 13 }}>Worked out from the body, knee and elbow angles, not from force on the handle.</p>
        </>
      )}
    </section>
  );
}

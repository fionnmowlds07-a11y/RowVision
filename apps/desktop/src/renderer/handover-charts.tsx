// The hand-over drawn for the app: each rower's drive, one part for two rowers, when each part moves
// in the boat, where the back opens stroke by stroke, and the body angle through one stroke.
import type { Handover, Part } from "@/lib/handover";
import { pct } from "./stats-report";
import { AMBER, APP_PART_COLOURS, PARTS } from "./rower-stats";
import styles from "./crew-stats.module.css";

export type Drawn = { key: string; name: string; colour: string; hand: Handover | null };

function path(values: number[], width: number, height: number, low = 0, high = 1): string {
  return "M" + values.map((value, index) => `${((index / (values.length - 1)) * width).toFixed(1)},${(height - ((value - low) / (high - low)) * height).toFixed(1)}`).join(" ");
}

/** One rower's legs, back and arms through the drive, as a share of each part's movement. */
export function DriveChart({ item }: { item: Drawn }) {
  const { hand } = item;
  const W = 300;
  const H = 130;
  if (!hand || hand.strokes === 0) return <div><h4 style={{ color: item.colour }}>{item.name}</h4><p className="soft">Could not be timed.</p></div>;
  const opens = hand.backOpensShare;
  const legs = hand.drive.legs ? hand.drive.legs.findIndex((value) => value >= 0.9) / (hand.drive.legs.length - 1) : null;
  return (
    <figure className={styles.figure}>
      <h4 style={{ color: item.colour }}>{item.name}</h4>
      <svg className={styles.chart} viewBox={`0 0 ${W + 44} ${H + 30}`} role="img" aria-label={`${item.name}: legs, back and arms through the drive${opens === null ? "" : `, back opens ${pct(opens)} in`}`}>
        <g transform="translate(36,6)">
          <line className={styles.rule} x1="0" y1={H} x2={W} y2={H} />
          <line className={styles.faint} x1="0" y1="0" x2={W} y2="0" />
          <line className={styles.faint} x1="0" y1={H / 2} x2={W} y2={H / 2} />
          {opens === null ? null : (
            <>
              <line x1={opens * W} y1="0" x2={opens * W} y2={H} stroke={APP_PART_COLOURS.back} strokeDasharray="3 3" />
              <text x={opens * W + 4} y="12" style={{ fill: APP_PART_COLOURS.back }}>back opens, {pct(opens)}</text>
            </>
          )}
          {PARTS.map((part) => {
            const values = hand.drive[part];
            if (!values) return null;
            const rough = part === "arms" && hand.armsRough;
            return <path key={part} d={path(values, W, H)} fill="none" stroke={APP_PART_COLOURS[part]} strokeWidth="2.5" strokeDasharray={rough ? "6 3" : undefined} opacity={rough ? 0.6 : 1} />;
          })}
          <text x="-6" y="4" textAnchor="end">100%</text>
          <text x="-6" y={H + 4} textAnchor="end">0</text>
          <text className={styles.strong} x="0" y={H + 18}>Catch</text>
          <text className={styles.strong} x={W} y={H + 18} textAnchor="end">Finish</text>
        </g>
      </svg>
      <figcaption className="soft">
        {hand.armsRough ? "Arms dashed: hard to see from this side." : legs !== null && legs > 0 ? `Legs done by ${pct(legs)} of the drive.` : ""}
      </figcaption>
    </figure>
  );
}

/** One body part through the drive for several rowers, so their timing can be laid over one another. */
export function PartChart({ part, items, caption }: { part: Part; items: Drawn[]; caption: string }) {
  const W = 300;
  const H = 120;
  return (
    <figure className={styles.figure}>
      <h4 style={{ color: APP_PART_COLOURS[part] }}>{part === "legs" ? "Legs" : part === "back" ? "Back" : "Arms"}</h4>
      <svg className={styles.chart} viewBox={`0 0 ${W + 16} ${H + 28}`} role="img" aria-label={`${part} through the drive for ${items.map((item) => item.name).join(" and ")}`}>
        <g transform="translate(8,6)">
          <line className={styles.rule} x1="0" y1={H} x2={W} y2={H} />
          <line className={styles.faint} x1="0" y1={H / 2} x2={W} y2={H / 2} />
          {items.map((item) => {
            const values = item.hand?.drive[part];
            if (!values) return null;
            const rough = part === "arms" && item.hand?.armsRough;
            return <path key={item.key} d={path(values, W, H)} fill="none" stroke={item.colour} strokeWidth="2.5" strokeDasharray={rough ? "6 3" : undefined} opacity={rough ? 0.5 : 1} />;
          })}
          <text className={styles.strong} x="0" y={H + 18}>Catch</text>
          <text className={styles.strong} x={W} y={H + 18} textAnchor="end">Finish</text>
        </g>
      </svg>
      <figcaption className="soft">{caption}</figcaption>
    </figure>
  );
}

/** When each rower's legs, back and arms move, in seconds after the lead rower's catch. */
export function BoatTimeline({ items, leadName }: { items: Drawn[]; leadName: string }) {
  const kept = items.filter((item) => item.hand && PARTS.some((part) => item.hand!.boat[part]));
  if (kept.length === 0) return <p className="soft">The rowers could not be timed against {leadName}&apos;s catch.</p>;
  const times = kept.flatMap((item) => [...PARTS.flatMap((part) => (item.hand!.boat[part] ? [item.hand!.boat[part]!.start, item.hand!.boat[part]!.done] : [])), item.hand!.finishS ?? 0]);
  const from = Math.min(0, Math.floor(Math.min(...times) * 5) / 5);
  const to = Math.max(1, Math.ceil(Math.max(...times) * 5) / 5);
  const left = 64;
  const W = 400;
  const x = (seconds: number) => left + ((seconds - from) / (to - from)) * W;
  const step = 54;
  const height = kept.length * step + 24;
  const ticks: number[] = [];
  for (let t = from; t <= to + 1e-6; t += 0.2) ticks.push(Math.round(t * 10) / 10);
  return (
    <svg className={styles.chart} viewBox={`0 0 ${left + W + 16} ${height}`} role="img" aria-label={`When each rower's legs, back and arms move, in seconds after ${leadName}'s catch`}>
      {ticks.map((t) => (
        <g key={t}>
          <line className={t === 0 ? styles.rule : styles.faint} x1={x(t)} y1="0" x2={x(t)} y2={kept.length * step - 6} />
          <text x={x(t)} y={kept.length * step + 10} textAnchor="middle">{t === 0 ? "0" : `${t.toFixed(1).replace("-", "−")} s`}</text>
        </g>
      ))}
      {kept.map((item, index) => {
        const y = index * step + 4;
        const finish = item.hand!.finishS;
        return (
          <g key={item.key}>
            <text className={styles.strong} x="0" y={y + 24} style={{ fill: item.colour }}>{item.name}</text>
            {PARTS.map((part, n) => {
              const span = item.hand!.boat[part];
              if (!span) return null;
              const rough = part === "arms" && item.hand!.armsRough;
              return (
                <g key={part} opacity={rough ? 0.45 : 1}>
                  <rect x={x(span.start)} y={y + n * 14} width={Math.max(2, x(span.done) - x(span.start))} height="10" rx="3" fill={APP_PART_COLOURS[part]} opacity="0.85" />
                  <circle className={styles.dot} cx={x(span.middle)} cy={y + n * 14 + 5} r="4.5" stroke={APP_PART_COLOURS[part]} strokeWidth="2" />
                </g>
              );
            })}
            {finish === null ? null : <line className={styles.finish} x1={x(finish)} y1={y - 2} x2={x(finish)} y2={y + 42} />}
          </g>
        );
      })}
    </svg>
  );
}

/** Where the back starts to open in each stroke. A dot can jump the video to its stroke. */
export function BackOpensStrip({ items, onPick }: { items: Drawn[]; onPick: ((frame: number) => void) | null }) {
  const kept = items.filter((item) => item.hand && item.hand.backOpens.length);
  if (kept.length === 0) return <p className="soft">The back could not be timed.</p>;
  const most = Math.max(0.5, ...kept.flatMap((item) => item.hand!.backOpens.map((open) => open.share + 0.05)));
  const left = 64;
  const W = 300;
  const x = (share: number) => left + (share / most) * W;
  const step = 36;
  const height = kept.length * step + 26;
  return (
    <svg className={styles.chart} viewBox={`0 0 ${left + W + 16} ${height}`} role="group" aria-label="Where in the drive the back starts to open, every stroke">
      {kept.map((item, index) => {
        const y = index * step + 16;
        const middle = item.hand!.backOpensShare;
        return (
          <g key={item.key}>
            <text className={styles.strong} x="0" y={y + 4} style={{ fill: item.colour }}>{item.name}</text>
            {item.hand!.backOpens.map((open, n) => {
              const label = `${item.name}, stroke ${n + 1}: back opens ${pct(open.share)} into the drive`;
              return onPick ? (
                <circle
                  key={n}
                  className={styles.pick}
                  cx={x(open.share)}
                  cy={y + ((n % 3) - 1) * 5}
                  r="6"
                  fill={item.colour}
                  role="button"
                  tabIndex={0}
                  aria-label={label}
                  onClick={() => onPick(open.frame)}
                  onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onPick(open.frame); } }}
                ><title>{label}</title></circle>
              ) : <circle key={n} cx={x(open.share)} cy={y + ((n % 3) - 1) * 5} r="5" fill={item.colour} opacity="0.75"><title>{label}</title></circle>;
            })}
            {middle === null ? null : <line className={styles.finish} x1={x(middle)} y1={y - 14} x2={x(middle)} y2={y + 14} />}
          </g>
        );
      })}
      <line className={styles.rule} x1={left} y1={kept.length * step} x2={left + W} y2={kept.length * step} />
      <text x={left} y={kept.length * step + 16}>0%</text>
      <text x={left + W / 2} y={kept.length * step + 16} textAnchor="middle">{pct(most / 2)}</text>
      <text x={left + W} y={kept.length * step + 16} textAnchor="end">{pct(most)}</text>
    </svg>
  );
}

/** Every rower's body angle from catch to next catch, with a marker the coach moves along the stroke. */
export function BodyOverlay({ items, at, band }: { items: Drawn[]; at: number; band: { catch: [number, number] | null; finish: [number, number] | null } }) {
  const drawn = items.filter((item) => item.hand?.cycle.trunk);
  if (drawn.length === 0) return <p className="soft">The body angle could not be followed through a whole stroke.</p>;
  const all = drawn.flatMap((item) => item.hand!.cycle.trunk!);
  const low = Math.min(-40, Math.floor(Math.min(...all) / 5) * 5 - 5);
  const high = Math.max(40, Math.ceil(Math.max(...all) / 5) * 5 + 5);
  const W = 600;
  const H = 200;
  const y = (value: number) => H - ((value - low) / (high - low)) * H;
  const finishes = drawn.map((item) => item.hand!.cycle.finishShare).filter((value): value is number => value !== null);
  const finishX = finishes.length ? (finishes.reduce((a, b) => a + b, 0) / finishes.length) * W : W * 0.45;
  const zone = (range: [number, number] | null) => (range ? <rect className={styles.zone} x="0" y={y(range[1])} width={W} height={y(range[0]) - y(range[1])} /> : null);
  return (
    <svg className={styles.chart} viewBox={`0 0 ${W + 56} ${H + 28}`} role="img" aria-label="Body angle through one stroke for every rower">
      <g transform="translate(46,6)">
        {zone(band.catch)}
        {zone(band.finish)}
        <line className={styles.rule} x1="0" y1={y(0)} x2={W} y2={y(0)} />
        {[30, 0, -30].filter((value) => value > low && value < high).map((value) => (
          <text key={value} x="-8" y={y(value) + 4} textAnchor="end">{value > 0 ? "+" : ""}{String(value).replace("-", "−")}°</text>
        ))}
        {[...drawn].reverse().map((item) => <path key={item.key} d={path(item.hand!.cycle.trunk!, W, H, low, high)} fill="none" stroke={item.colour} strokeWidth={drawn.length <= 2 ? 3 : 2.2} />)}
        <line className={styles.cursor} x1={at * W} y1="0" x2={at * W} y2={H} />
        {drawn.map((item) => {
          const values = item.hand!.cycle.trunk!;
          return <circle key={item.key} className={styles.dot} cx={at * W} cy={y(values[Math.round(at * (values.length - 1))])} r="5" stroke={item.colour} strokeWidth="2.5" />;
        })}
        <text className={styles.strong} x="0" y={H + 20}>Catch</text>
        <text className={styles.strong} x={finishX} y={H + 20} textAnchor="middle">Finish</text>
        <text className={styles.strong} x={W} y={H + 20} textAnchor="end">Next catch</text>
      </g>
    </svg>
  );
}

/** The middle of each part's movement as three small marks along the drive. */
export function OrderStrip({ marks, outOfOrder }: { marks: Record<Part, number | null>; outOfOrder: boolean }) {
  const W = 120;
  return (
    <svg className={styles.strip} viewBox={`0 0 ${W} 14`} aria-hidden="true">
      <line className={styles.rule} x1="0" y1="7" x2={W} y2="7" />
      {PARTS.map((part) => (marks[part] === null ? null : (
        <rect key={part} x={marks[part]! * W - 3} y="1" width="6" height="12" rx="2" fill={APP_PART_COLOURS[part]} stroke={outOfOrder ? AMBER : "none"} />
      )))}
    </svg>
  );
}

export function PartKey() {
  return (
    <p className={styles.key}>
      {PARTS.map((part) => <span key={part}><i style={{ background: APP_PART_COLOURS[part] }} />{part}</span>)}
    </p>
  );
}

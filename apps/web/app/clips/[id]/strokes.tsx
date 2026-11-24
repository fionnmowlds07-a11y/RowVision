import { useMemo } from "react";
import type { Rower } from "@/lib/result";
import { fadeText, formatStroke, outsideTarget, plot, strokeSeries, type StrokeSeries } from "@/lib/strokes";
import styles from "./clip.module.css";

const WIDTH = 320;
const HEIGHT = 84;
const PAD = 12;
const LEFT = 46;
const MIN_STROKES = 2;

type Props = {
  rower: Rower;
  fps: number;
  onPick: ((frame: number) => void) | null;
  /** Start with the table of numbers open, as when the stats have the whole page. */
  numbersOpen?: boolean;
};

function Chart({ series, onPick }: { series: StrokeSeries; onPick: Props["onPick"] }) {
  const drawn = plot(series, WIDTH, HEIGHT, PAD, LEFT);
  const fade = fadeText(series.name, series.fade);
  const finish = series.name.startsWith("finish");
  return (
    <figure className={styles.strokeChart}>
      <figcaption className={styles.line}>
        <span>{series.label}</span>
        {fade ? <span className={styles.pill}>{fade}</span> : null}
      </figcaption>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="group" aria-label={`${series.label}, stroke by stroke`}>
        {drawn.band ? <rect className={styles.chartBand} x={LEFT - 6} y={drawn.band.y} width={WIDTH - LEFT - PAD + 12} height={drawn.band.height} rx={4} /> : null}
        <text className={styles.chartScale} x={0} y={PAD + 4}>{formatStroke(series.name, drawn.high)}</text>
        <text className={styles.chartScale} x={0} y={HEIGHT - PAD + 4}>{formatStroke(series.name, drawn.low)}</text>
        <polyline className={styles.chartLine} points={drawn.dots.map((dot) => `${dot.x},${dot.y}`).join(" ")} />
        {drawn.dots.map(({ x, y, point }) => {
          const label = `Stroke ${point.stroke}, ${series.label.toLowerCase()}: ${formatStroke(series.name, point.value)}`;
          const go = onPick ? () => onPick(point.frame) : undefined;
          const shared = {
            className: styles.chartDot,
            role: go ? "button" : undefined,
            tabIndex: go ? 0 : undefined,
            "aria-label": go ? `${label}. Go to this stroke` : label,
            onClick: go,
            onKeyDown: go ? (event: React.KeyboardEvent) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); go(); } } : undefined,
          };
          // Catches are round and finishes square, as on the stroke lane.
          return finish
            ? <rect key={point.stroke} {...shared} x={x - 5} y={y - 5} width={10} height={10}><title>{label}</title></rect>
            : <circle key={point.stroke} {...shared} cx={x} cy={y} r={5}><title>{label}</title></circle>;
        })}
      </svg>
    </figure>
  );
}

/** Every stroke of the clip: a small chart a measure, and the same numbers in a table. */
export function Strokes({ rower, fps, onPick, numbersOpen = false }: Props) {
  const all = useMemo(() => strokeSeries(rower, fps), [rower, fps]);
  if (rower.strokes.length < MIN_STROKES || all.length === 0) return null;
  const fades = all.some((series) => series.fade !== null);
  const leftOut = new Set(rower.left_out ?? []);
  const unseen = new Set(rower.unseen ?? []);
  return (
    <section className="card stack" aria-labelledby="strokes-title">
      <h2 id="strokes-title" style={{ fontSize: 19 }}>Stroke by stroke</h2>
      <p className={styles.small} style={{ color: "var(--ink-soft)" }}>
        The green band is your target.{onPick ? " Press a stroke to see it in the video." : ""}
        {fades ? "" : " With 6 strokes or more, this also says whether you fade in the second half."}
        {leftOut.size ? " Strokes filmed end-on are listed but do not count towards your results." : ""}
        {unseen.size ? " Strokes where you were not tracked are listed but do not count either." : ""}
      </p>
      <div className={styles.strokeCharts}>
        {all.map((series) => <Chart key={series.name} series={series} onPick={onPick} />)}
      </div>
      <details open={numbersOpen}>
        <summary>See the numbers</summary>
        <div className={styles.scroll}>
          <table className={styles.strokeTable}>
            <thead>
              <tr><th scope="col">Stroke</th>{all.map((series) => <th key={series.name} scope="col">{series.label}</th>)}</tr>
            </thead>
            <tbody>
              {rower.strokes.map((stroke, index) => (
                <tr key={stroke.catch_frame} className={leftOut.has(stroke.catch_frame) || unseen.has(stroke.catch_frame) ? styles.fadeRow : undefined}>
                  <th scope="row">
                    {onPick ? <button type="button" className={styles.strokeLink} onClick={() => onPick(stroke.catch_frame)} aria-label={`Go to stroke ${index + 1}`}>{index + 1}</button> : index + 1}
                    {leftOut.has(stroke.catch_frame) ? <span className={styles.offMark}> end-on, not counted</span> : null}
                    {unseen.has(stroke.catch_frame) ? <span className={styles.offMark}> not tracked, not counted</span> : null}
                  </th>
                  {all.map((series) => {
                    const { value } = series.points[index];
                    const off = outsideTarget(value, series.target);
                    return <td key={series.name} className={off ? styles.off : undefined}>{formatStroke(series.name, value)}{off ? <span className={styles.offMark}> off target</span> : null}</td>;
                  })}
                </tr>
              ))}
              {fades ? (
                <tr className={styles.fadeRow}>
                  <th scope="row">Second half</th>
                  {all.map((series) => <td key={series.name}>{fadeText(series.name, series.fade)?.replace("Second half: ", "") ?? "–"}</td>)}
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

import { MARGIN_DEG, type TrendPoint } from "@/lib/history";
import styles from "./home.module.css";

const WIDTH = 320;
const HEIGHT = 110;
const PAD = 12;
const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

type Series = { title: string; unit: string; margin: number; read: (point: TrendPoint) => number | null };

const SERIES: Series[] = [
  { title: "Catch lean", unit: "°", margin: MARGIN_DEG, read: (point) => point.catchLean },
  { title: "Layback", unit: "°", margin: MARGIN_DEG, read: (point) => point.layback },
  { title: "Overall", unit: "", margin: 0, read: (point) => point.overall },
];

function Small({ series, points }: { series: Series; points: TrendPoint[] }) {
  const known = points.flatMap((point) => {
    const value = series.read(point);
    return value === null ? [] : [{ point, value }];
  });
  if (known.length === 0) return null;
  const values = known.map(({ value }) => value);
  const low = Math.min(...values) - series.margin - 2;
  const high = Math.max(...values) + series.margin + 2;
  const x = (index: number) => PAD + (index / Math.max(known.length - 1, 1)) * (WIDTH - 2 * PAD);
  const y = (value: number) => HEIGHT - PAD - ((value - low) / (high - low)) * (HEIGHT - 2 * PAD);
  const line = known.map(({ value }, index) => `${x(index)},${y(value)}`).join(" ");
  const upper = known.map(({ value }, index) => `${x(index)},${y(value + series.margin)}`);
  const lower = known.map(({ value }, index) => `${x(index)},${y(value - series.margin)}`).reverse();
  const last = values[values.length - 1];
  return (
    <figure className={styles.small}>
      <figcaption>
        <span>{series.title}</span>
        <strong>{Math.round(last)}{series.unit}</strong>
      </figcaption>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`${series.title} across ${known.length} clips, latest ${Math.round(last)}${series.unit}`}>
        {series.margin ? <polygon className={styles.margin} points={[...upper, ...lower].join(" ")} /> : null}
        <polyline className={styles.trendLine} points={line} />
        {known.map(({ point, value }, index) => (
          <circle key={point.when} className={point.older ? styles.older : styles.dot} cx={x(index)} cy={y(value)} r={5}>
            <title>{`${DATE.format(new Date(point.when))}: ${Math.round(value)}${series.unit}${point.older ? ", older version" : ""}`}</title>
          </circle>
        ))}
      </svg>
    </figure>
  );
}

export function Trend({ points }: { points: TrendPoint[] }) {
  return (
    <section className="card stack" aria-labelledby="trend-title">
      <h2 id="trend-title" style={{ fontSize: 19 }}>Your trend</h2>
      <p className="soft" style={{ fontSize: 14 }}>
        From clips rated Good or better. The shaded band is about ±{MARGIN_DEG}°, so a smaller change may just be measurement noise.
        {points.some((point) => point.older) ? " Hollow dots were measured with an older version." : ""}
      </p>
      <div className={styles.smalls}>
        {SERIES.map((series) => <Small key={series.title} series={series} points={points} />)}
      </div>
      <details>
        <summary>See the numbers</summary>
        <table className={styles.table}>
          <thead><tr><th scope="col">Clip</th><th scope="col">Catch lean</th><th scope="col">Layback</th><th scope="col">Overall</th></tr></thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.when}>
                <td>{DATE.format(new Date(point.when))}</td>
                {SERIES.map((series) => {
                  const value = series.read(point);
                  return <td key={series.title}>{value === null ? "–" : `${Math.round(value)}${series.unit}`}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}

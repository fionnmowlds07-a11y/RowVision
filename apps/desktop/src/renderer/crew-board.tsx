import { useState } from "react";
import { BodyOverlay, OrderStrip, PartKey } from "./handover-charts";
import { anglesAt, BOARD_COLUMNS, boardRows, inOrder, sortBoard, type BoardColumn } from "./rower-stats";
import { deg, pct, targetOf, type StatsRower } from "./stats-report";
import { drawn } from "./use-clip-stats";
import styles from "./crew-stats.module.css";

type Props = {
  every: StatsRower[];
  /** Opens one rower's results and hand-over. */
  onOpen: (item: StatsRower) => void;
};

const range = (items: StatsRower[], name: string): [number, number] | null => {
  const found = targetOf(items, name);
  return found && found.target.high !== null ? [found.target.low, found.target.high] : null;
};

/** Every rower in a row and every number in a column, with each rower's body angle laid over the others. */
export function CrewBoard({ every, onOpen }: Props) {
  const [at, setAt] = useState(0.45);
  const [sort, setSort] = useState<{ column: BoardColumn; up: boolean } | null>(null);
  const rows = boardRows(every);
  const sorted = sort ? sortBoard(rows, sort.column, sort.up) : rows;
  const here = anglesAt(every, at);

  function sortBy(column: BoardColumn) {
    setSort((old) => (old?.column === column ? { column, up: !old.up } : { column, up: column === "seat" }));
  }

  return (
    <>
      <section className="card stack" aria-labelledby="overlay-title">
        <div className={styles.titleRow}>
          <h2 id="overlay-title" style={{ fontSize: 19 }}>Body angle through one stroke</h2>
          <p className={styles.key}>{every.map((item) => <span key={item.key}><i style={{ background: drawn(item).colour }} />{item.name}</span>)}</p>
        </div>
        <BodyOverlay items={every.map((item) => drawn(item))} at={at} band={{ catch: range(every, "catch_lean_deg"), finish: range(every, "finish_lean_deg") }} />
        <label className={styles.scrub}>
          <span>Move along the stroke</span>
          <input type="range" min={0} max={100} value={Math.round(at * 100)} onChange={(event) => setAt(Number(event.target.value) / 100)} />
        </label>
        <p role="status" className={styles.readout}>
          <strong>At {pct(at)} of the stroke</strong>{" "}
          {here.map(({ item, value }) => <span key={item.key} style={{ color: drawn(item).colour }}>{item.name} {deg(value, 0)}</span>)}
        </p>
      </section>

      <section className="card stack" aria-labelledby="board-title">
        <div className={styles.titleRow}>
          <h2 id="board-title" style={{ fontSize: 19 }}>Every rower, every number</h2>
          <span className="soft">Press a heading to sort, or a rower to open their results.</span>
        </div>
        <div className={styles.scroll}>
          <table className={styles.board}>
            <thead>
              <tr>
                {BOARD_COLUMNS.slice(0, 8).map((column) => <SortHead key={column.key} column={column.key} label={column.label} sort={sort} onSort={sortBy} />)}
                <th scope="col">Hand-over</th>
                <SortHead column="back_opens" label="Back opens" sort={sort} onSort={sortBy} />
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => {
                const order = inOrder(row.item.hand);
                return (
                  <tr key={row.item.key}>
                    <th scope="row">
                      <button type="button" className={styles.rowButton} onClick={() => onOpen(row.item)}>
                        <i style={{ background: drawn(row.item).colour }} />{row.texts.seat}
                      </button>
                    </th>
                    {BOARD_COLUMNS.slice(1, 8).map((column) => (
                      <td key={column.key} className={row.outside[column.key] ? styles.outside : undefined}>{row.texts[column.key]}</td>
                    ))}
                    <td>
                      <OrderStrip marks={row.marks} outOfOrder={order === false} />
                      <span className={styles.hidden}>{order === null ? "not timed" : order ? "legs, back, arms in order" : "out of order"}</span>
                    </td>
                    <td>{row.texts.back_opens}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className={styles.titleRow}>
          <PartKey />
          <span className="soft">Each mark is the middle of that part&apos;s movement through the drive. Amber is outside the target, or out of order.</span>
        </div>
      </section>
    </>
  );
}

function SortHead({ column, label, sort, onSort }: { column: BoardColumn; label: string; sort: { column: BoardColumn; up: boolean } | null; onSort: (column: BoardColumn) => void }) {
  const on = sort?.column === column;
  return (
    <th scope="col" aria-sort={on ? (sort!.up ? "ascending" : "descending") : "none"}>
      <button type="button" className={styles.sortButton} onClick={() => onSort(column)}>{label}{on ? (sort!.up ? " ↑" : " ↓") : ""}</button>
    </th>
  );
}

import { useEffect, useMemo, useState } from "react";
import type { ClipDetail } from "../shared/bridge";
import { PartChart, PartKey } from "./handover-charts";
import { longDate } from "./format";
import { biggestGap, lanes, PAIR_COLOURS, partSentence, PARTS, seatKey, clipRowers, type Lane, type Pick } from "./rower-stats";
import { secs, shortName, type StatsRower } from "./stats-report";
import { clipRowerList, drawn, useClipStats } from "./use-clip-stats";
import { BOAT_SEATS } from "@/lib/setup";
import styles from "./crew-stats.module.css";

type Option = { value: string; label: string; pick: Pick };

const filmed = (clip: ClipDetail) => clip.setup.filmed_at ?? clip.createdAt;
const valueOf = (pick: Pick) => `${pick.clip}/${pick.seat}`;

function optionsFor(clips: ClipDetail[], home: string): Option[] {
  return clips.flatMap((clip) => {
    const seats = BOAT_SEATS[clip.setup.boat_class ?? ""] ?? 1;
    const own = clip.setup.coach ? null : clip.summary?.rower?.seat ?? null;
    return clipRowers(clipRowerList(clip)).map((rower) => {
      const pick = { clip: clip.id, seat: seatKey(rower) };
      return { value: valueOf(pick), label: `${shortName(rower, seats, own)} · ${clip.id === home ? "this clip" : longDate(filmed(clip))}`, pick };
    });
  });
}

/** Any two rowers, from one clip or two, measure by measure and part by part. */
export function RowersPage({ first, second }: { first: Pick; second: Pick | null }) {
  const [clips, setClips] = useState<ClipDetail[] | undefined>(undefined);

  useEffect(() => {
    let live = true;
    void (async () => {
      const list = await window.rowvision.listClips();
      const done = list.filter((clip) => clip.state === "done" && clip.band !== null);
      const found = (await Promise.all(done.map((clip) => window.rowvision.getClip(clip.id)))).filter((clip): clip is ClipDetail => Boolean(clip?.summary?.rower));
      // The clip the page was opened from comes first, then the newest.
      found.sort((a, b) => (a.id === first.clip ? -1 : b.id === first.clip ? 1 : filmed(b).localeCompare(filmed(a))));
      if (live) setClips(found);
    })();
    return () => { live = false; };
  }, [first.clip]);

  const options = useMemo(() => (clips ? optionsFor(clips, first.clip) : []), [clips, first.clip]);
  // With no second rower named, another seat of the same clip, else the same rower on another day.
  const other = second ?? options.find((option) => option.pick.clip === first.clip && option.pick.seat !== first.seat)?.pick
    ?? options.find((option) => option.pick.clip !== first.clip && option.pick.seat === first.seat)?.pick
    ?? options.find((option) => valueOf(option.pick) !== valueOf(first))?.pick ?? null;
  const clipA = clips?.find((clip) => clip.id === first.clip) ?? null;
  const clipB = clips?.find((clip) => clip.id === other?.clip) ?? null;
  const statsA = useClipStats(clipA);
  const statsB = useClipStats(clipB);

  if (clips === undefined) return <p aria-busy="true">Loading…</p>;
  if (!clipA) {
    return (
      <section className="card stack">
        <h1 style={{ fontSize: 24 }}>This rower can&apos;t be compared</h1>
        <p className="soft">The clip needs to be analysed, with a rower measured in it.</p>
        <a href="#/">Back to your clips</a>
      </section>
    );
  }

  const a = statsA.every.find((item) => item.key === first.seat) ?? null;
  const b = other ? statsB.every.find((item) => item.key === other.seat) ?? null : null;
  // The same name twice, such as stroke on two days, gets the day added.
  const label = (item: StatsRower, clip: ClipDetail | null, againstClip: ClipDetail | null, against: StatsRower | null) => (
    against && against.name === item.name && clip && againstClip && clip.id !== againstClip.id ? `${item.name}, ${longDate(filmed(clip))}` : item.name
  );
  const named = a && b ? [{ ...a, name: label(a, clipA, clipB, b) }, { ...b, name: label(b, clipB, clipA, a) }] as [StatsRower, StatsRower] : null;

  function go(which: 0 | 1, value: string) {
    const [clip, seat] = value.split("/");
    const chosen = { clip, seat };
    // Choosing the other rower again swaps the two round.
    const same = (pick: Pick | null) => pick !== null && valueOf(pick) === value;
    const picks = which === 0 ? [chosen, same(other) ? first : other] : [same(first) ? other : first, chosen];
    window.location.hash = `#/rowers/${picks.filter(Boolean).map((pick) => valueOf(pick!)).join("/")}`;
  }

  return (
    <>
      <div>
        <a href={`#/clip/${clipA.id}`}>Back to {longDate(filmed(clipA))}</a>
        <h1 style={{ fontSize: 32, marginTop: 8 }}>Compare two rowers</h1>
      </div>
      <section className={`card ${styles.pickers}`} aria-label="Rowers to compare">
        <label className="field">
          <span>First rower</span>
          <select value={valueOf(first)} onChange={(event) => go(0, event.target.value)}>
            {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Second rower</span>
          <select value={other ? valueOf(other) : ""} onChange={(event) => go(1, event.target.value)}>
            {other ? null : <option value="">Choose a rower…</option>}
            {options.filter((option) => option.value !== valueOf(first)).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <p className="soft">Any rower from any clip, so a rower can be compared with themself on another day too.</p>
      </section>
      {statsA.problem || statsB.problem ? <p role="alert" className="error">{statsA.problem ?? statsB.problem}</p> : null}
      {!other ? <p className="soft">There is no other rower to compare with yet.</p> : !statsA.ready || !statsB.ready ? <p aria-busy="true" className="soft">Reading the measurements…</p> : !named ? (
        <p className="soft">One of these rowers isn&apos;t in its clip any more.</p>
      ) : <Comparison pair={named} />}
    </>
  );
}

function Comparison({ pair }: { pair: [StatsRower, StatsRower] }) {
  const [first, second] = pair;
  const rows = lanes(first, second);
  const gap = biggestGap(rows);
  const drives = [first.hand?.driveS ?? null, second.hand?.driveS ?? null];
  const colour = (index: number) => PAIR_COLOURS[index];
  const items = pair.map((item, index) => drawn(item, colour(index)));
  const overall = (item: StatsRower) => (item.rower.card.overall === null ? "–" : String(Math.round(item.rower.card.overall)));
  return (
    <>
      <div className={styles.tiles}>
        <div className={styles.tile}><span>Overall</span><strong><b style={{ color: colour(0) }}>{overall(first)}</b> · <b style={{ color: colour(1) }}>{overall(second)}</b></strong></div>
        {gap ? <div className={styles.tile}><span>Biggest gap</span><strong>{gap.label}</strong><small>{gap.gap}</small></div> : null}
        {drives[0] !== null && drives[1] !== null ? (
          <div className={styles.tile}><span>Drive time</span><strong>{secs(drives[0])} · {secs(drives[1])}</strong><small>{Math.abs(drives[0] - drives[1]).toFixed(2)} s apart</small></div>
        ) : null}
      </div>

      <section className="card stack" aria-labelledby="lanes-title">
        <div className={styles.titleRow}>
          <h2 id="lanes-title" style={{ fontSize: 19 }}>Every measure, on one lane each</h2>
          <p className={styles.key}>
            <span><i style={{ background: colour(0) }} />{first.name}</span>
            <span><i style={{ background: colour(1) }} />{second.name}</span>
            <span><i className={styles.targetSwatch} />target</span>
          </p>
        </div>
        <ul className={styles.lanes} aria-label="Measures">
          {rows.map((row) => <LaneRow key={row.name} row={row} names={[first.name, second.name]} />)}
        </ul>
        <p className="soft" style={{ fontSize: 13 }}>Gaps over a tenth of the lane are marked in amber. Knees and other shown-only numbers are a rough guide and never scored.</p>
      </section>

      <section className="card stack" aria-labelledby="parts-title">
        <div className={styles.titleRow}>
          <h2 id="parts-title" style={{ fontSize: 19 }}>Hand-over, part by part</h2>
          <PartKey />
        </div>
        <p className="soft">Each chart is one body part through the drive, with both rowers on it. A line further left means that part moves earlier in the rower&apos;s own drive.</p>
        <div className={styles.parts}>
          {PARTS.map((part) => <PartChart key={part} part={part} items={items} caption={partSentence(part, first, second)} />)}
        </div>
        <p className="soft" style={{ fontSize: 13 }}>Worked out from the body, knee and elbow angles, not from force on the handle.</p>
      </section>
    </>
  );
}

function LaneRow({ row, names }: { row: Lane; names: [string, string] }) {
  return (
    <li className={styles.laneRow} aria-label={`${row.label}: ${names[0]} ${row.texts[0]}, ${names[1]} ${row.texts[1]}${row.gap ? `, ${row.gap}` : ""}`}>
      <span className={styles.laneLabel}>{row.label}</span>
      <span className={styles.laneValue} style={{ color: PAIR_COLOURS[0] }}>{row.texts[0]}</span>
      <span className={styles.laneValue} style={{ color: PAIR_COLOURS[1] }}>{row.texts[1]}</span>
      <span className={styles.lane} aria-hidden="true">
        {row.band ? <i className={styles.laneBand} style={{ left: `${row.band.left}%`, width: `${row.band.width}%` }} /> : null}
        {row.at[0] !== null && row.at[1] !== null ? (
          <i className={row.wide ? styles.laneGapWide : styles.laneGap} style={{ left: `${Math.min(row.at[0], row.at[1])}%`, width: `${Math.abs(row.at[0] - row.at[1])}%` }} />
        ) : null}
        {row.at.map((at, index) => (at === null ? null : <i key={index} className={styles.laneMark} style={{ left: `${at}%`, background: PAIR_COLOURS[index] }} />))}
      </span>
      <span className={row.wide ? styles.laneGapText : "soft"}>{row.guide ? `${row.gap || "—"} · guide only` : row.gap || "—"}</span>
    </li>
  );
}

import Link from "next/link";
import { Shell } from "@/components/shell";
import { TREND_MINIMUM, clipStatus, latest, trendPoints, type ClipRow } from "@/lib/history";
import { requireViewer } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import styles from "./home.module.css";
import { Trend } from "./trend";

const DATE = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" });

export default async function Home() {
  const viewer = await requireViewer();
  const supabase = await createClient();
  const [{ data }, { data: version }] = await Promise.all([
    supabase
      .from("clips")
      .select("id, boat_class, seat, side, note, filmed_at, created_at, jobs(state, created_at), results(band, accuracy, overall, code_version, created_at, summary)")
      .eq("user_id", viewer.id)
      .order("created_at", { ascending: false }),
    supabase.rpc("current_version"),
  ]);
  const clips = (data ?? []) as unknown as (ClipRow & { boat_class: string; seat: number; note: string | null })[];
  const points = trendPoints(clips, version ?? null);

  return (
    <Shell viewer={viewer}>
      <div className={styles.head}>
        <h1 style={{ fontSize: 32 }}>Your clips</h1>
        <Link className="button primary" href="/add">Add a video</Link>
      </div>
      {clips.length === 0 ? (
        <section className="card stack">
          <h2 style={{ fontSize: 19 }}>Nothing here yet</h2>
          <p className="soft">Add your first video to see your stroke measured. Side-on and close up works best.</p>
          <Link href="/guide">How to film a good clip</Link>
        </section>
      ) : null}
      <ul className={styles.list}>
        {clips.map((clip, index) => {
          const state = latest(clip.jobs)?.state;
          const result = latest(clip.results);
          const { text, score } = clipStatus(state, result);
          const rate = result?.summary?.rower?.rate_spm;
          return (
            <li key={clip.id}>
              <Link href={`/clips/${clip.id}`} className={index === 0 && score ? styles.clipMain : styles.clip}>
                <span className={styles.text}>
                  <strong>{DATE.format(new Date(clip.filmed_at ?? clip.created_at))}</strong>
                  <span>{clip.boat_class} seat {clip.seat}{rate ? `, ${Math.round(rate)} spm` : ""}</span>
                  {clip.note ? <span>{clip.note}</span> : null}
                  <span>{text}</span>
                </span>
                {score ? <span className={styles.score}>{score}</span> : null}
              </Link>
            </li>
          );
        })}
      </ul>
      {clips.length > 0 ? (
        points.length >= TREND_MINIMUM ? <Trend points={points} /> : (
          <section className="card stack">
            <h2 style={{ fontSize: 19 }}>Your trend</h2>
            <p className="soft">Appears once {TREND_MINIMUM} clips are rated Good or better. You have {points.length} so far.</p>
          </section>
        )
      ) : null}
    </Shell>
  );
}

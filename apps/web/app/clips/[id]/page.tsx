import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Shell } from "@/components/shell";
import { requireViewer } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { isWaiting, publicLink, type JobState } from "@/lib/waiting";
import { Status } from "./status";
import { TapAgain } from "./tap-again";

export const metadata: Metadata = { title: "Your clip" };

const DATE = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" });

export default async function Clip({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requireViewer();
  const supabase = await createClient();
  const { data: clip } = await supabase
    .from("clips")
    .select("id, boat_class, seat, side, note, filmed_at, created_at, duration_seconds, working_path")
    .eq("id", id)
    .maybeSingle();
  if (!clip) notFound();

  const [{ data: job }, { data: result }] = await Promise.all([
    supabase.from("jobs").select("state, stage, progress, error, pause").eq("clip_id", id)
      .order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("results").select("accuracy, band, overall").eq("clip_id", id)
      .order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const state = (job?.state ?? "failed") as JobState;
  const when = DATE.format(new Date(clip.filmed_at ?? clip.created_at));

  let waiting = null;
  if (isWaiting(state)) {
    const [{ data: place }, { data: online }] = await Promise.all([
      supabase.rpc("queue_position", { clip: id }),
      supabase.rpc("worker_online"),
    ]);
    waiting = (
      <Status
        clip={id}
        state={state}
        stage={job?.stage ?? null}
        progress={job?.progress ?? null}
        place={place ?? null}
        seconds={clip.duration_seconds}
        online={online ?? false}
      />
    );
  }

  let tap = null;
  if (state === "needs_tap" && clip.working_path) {
    const { data: signed } = await supabase.storage.from("working").createSignedUrl(clip.working_path, 3600);
    if (signed) {
      const link = publicLink(signed.signedUrl, process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLIC_URL);
      tap = <TapAgain clip={id} link={link} seconds={Number(job?.pause?.seconds ?? 0)} />;
    }
  }

  return (
    <Shell viewer={viewer}>
      <h1 style={{ fontSize: 32 }}>{when}</h1>
      <p style={{ margin: 0, color: "var(--on-ground-soft)" }}>{clip.boat_class} seat {clip.seat}{clip.note ? `. ${clip.note}` : ""}</p>
      {waiting}
      {tap}
      {state === "failed" ? (
        <section className="card stack">
          <h2 style={{ fontSize: 24 }}>This clip couldn&apos;t be analysed</h2>
          <p className="soft">{job?.error && job.error !== "stopped" ? job.error : "Something stopped the analysis. Try another clip, or report the problem."}</p>
          <Link className="button primary" href="/add">Add a video</Link>
        </section>
      ) : null}
      {state === "cancelled" ? (
        <section className="card stack">
          <h2 style={{ fontSize: 24 }}>Cancelled</h2>
          <Link className="button primary" href="/add">Add a video</Link>
        </section>
      ) : null}
      {state === "done" && result ? (
        <section className="card stack">
          <h2 style={{ fontSize: 24 }}>Accuracy {Math.round(result.accuracy ?? 0)}% {result.band}</h2>
          <p className="soft">Overall {result.overall === null ? "not given" : Math.round(result.overall)}</p>
        </section>
      ) : null}
    </Shell>
  );
}

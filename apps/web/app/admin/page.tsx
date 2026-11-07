import type { Metadata } from "next";
import Link from "next/link";
import { Shell } from "@/components/shell";
import { requireAdmin } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { removeEmail } from "./actions";
import { AddEmailForm } from "./add-form";

const TIME = new Intl.DateTimeFormat("en-GB", { dateStyle: "short", timeStyle: "short" });
const ONLINE_MS = 2 * 60 * 1000;

function isOnline(lastSeen: string): boolean {
  return new Date(lastSeen).getTime() > new Date().getTime() - ONLINE_MS;
}

export const metadata: Metadata = { title: "Admin" };

export default async function Admin() {
  const viewer = await requireAdmin();
  const supabase = await createClient();
  const { data: emails } = await supabase
    .from("approved_emails")
    .select("email, note")
    .order("added_at", { ascending: false });

  const [{ data: workers }, { data: jobs }] = await Promise.all([
    supabase.from("worker_status").select("worker_id, device, last_seen").order("last_seen", { ascending: false }),
    supabase.from("jobs").select("id, clip_id, state, stage, error, created_at").order("created_at", { ascending: false }).limit(30),
  ]);
  const waiting = (jobs ?? []).filter(({ state }) => ["uploading", "queued", "running", "needs_tap"].includes(state));
  const failed = (jobs ?? []).filter(({ state }) => state === "failed");

  return (
    <Shell viewer={viewer}>
      <h1 style={{ fontSize: 32 }}>Admin</h1>
      <section className="card stack" aria-labelledby="worker-title">
        <h2 id="worker-title" style={{ fontSize: 19 }}>Worker</h2>
        {(workers ?? []).length === 0 ? <p className="soft">No worker has connected yet.</p> : null}
        {(workers ?? []).map(({ worker_id, device, last_seen }) => (
          <p key={worker_id} style={{ margin: 0 }}>
            <strong>{isOnline(last_seen) ? "Online" : "Offline"}</strong> {worker_id} on {device}.{" "}
            <span className="soft">Last seen {TIME.format(new Date(last_seen))}</span>
          </p>
        ))}
      </section>
      <section className="card stack" aria-labelledby="queue-title">
        <h2 id="queue-title" style={{ fontSize: 19 }}>Queue</h2>
        {waiting.length === 0 ? <p className="soft">Nothing waiting.</p> : null}
        {waiting.map(({ id, clip_id, state, stage }) => (
          <p key={id} style={{ margin: 0 }}><Link href={`/clips/${clip_id}`}>{state}</Link> {stage}</p>
        ))}
      </section>
      <section className="card stack" aria-labelledby="failed-title">
        <h2 id="failed-title" style={{ fontSize: 19 }}>Recent failures</h2>
        {failed.length === 0 ? <p className="soft">None.</p> : null}
        {failed.map(({ id, clip_id, error }) => (
          <p key={id} style={{ margin: 0 }}><Link href={`/clips/${clip_id}`}>Open clip</Link> {error}</p>
        ))}
      </section>
      <AddEmailForm />
      <section className="card stack" aria-labelledby="list-title">
        <h2 id="list-title" style={{ fontSize: 19 }}>Approved emails</h2>
        {(emails ?? []).map(({ email, note }) => (
          <form key={email} action={removeEmail} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <input type="hidden" name="email" value={email} />
            <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>
              {email}
              {note ? <span className="soft" style={{ display: "block", fontSize: 14 }}>{note}</span> : null}
            </span>
            <button className="button quiet" aria-label={`Remove ${email}`}>Remove</button>
          </form>
        ))}
      </section>
    </Shell>
  );
}

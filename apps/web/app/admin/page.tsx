import type { Metadata } from "next";
import { Shell } from "@/components/shell";
import { requireAdmin } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { removeEmail } from "./actions";
import { AddEmailForm } from "./add-form";

export const metadata: Metadata = { title: "Admin" };

export default async function Admin() {
  const viewer = await requireAdmin();
  const supabase = await createClient();
  const { data: emails } = await supabase
    .from("approved_emails")
    .select("email, note")
    .order("added_at", { ascending: false });

  return (
    <Shell viewer={viewer}>
      <h1 style={{ fontSize: 32 }}>Admin</h1>
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

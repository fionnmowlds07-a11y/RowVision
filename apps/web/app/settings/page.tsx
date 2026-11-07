import type { Metadata } from "next";
import { Shell } from "@/components/shell";
import { requireViewer } from "@/lib/session";
import { saveName, signOut } from "./actions";

export const metadata: Metadata = { title: "Settings" };

export default async function Settings() {
  const viewer = await requireViewer();
  return (
    <Shell viewer={viewer}>
      <h1 style={{ fontSize: 32 }}>Settings</h1>
      <form action={saveName} className="card stack" style={{ maxWidth: 480 }}>
        <p className="soft">Signed in as {viewer.email}</p>
        <label className="field">
          Your name
          <input name="name" defaultValue={viewer.displayName ?? ""} maxLength={80} autoComplete="name" />
        </label>
        <button className="button primary">Save</button>
      </form>
      <form action={signOut}>
        <button className="button quiet">Sign out</button>
      </form>
    </Shell>
  );
}

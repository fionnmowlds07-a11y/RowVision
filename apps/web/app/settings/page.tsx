import type { Metadata } from "next";
import { Shell } from "@/components/shell";
import { requireViewer } from "@/lib/session";
import { deleteAccount, saveColours, saveName, signOut } from "./actions";
import { Colours } from "./colours";

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
      <Colours ground={viewer.ground} highlight={viewer.highlight} save={saveColours} />
      <form action={signOut}>
        <button className="button quiet">Sign out</button>
      </form>
      <form action={deleteAccount} className="card stack" style={{ maxWidth: 480 }}>
        <h2 style={{ fontSize: 19 }}>Delete your account</h2>
        <p className="soft">This removes your clips, results and account for good. It can&apos;t be undone.</p>
        <label className="field">
          Type delete to confirm
          <input name="confirm" autoComplete="off" required />
        </label>
        <button className="button quiet">Delete everything</button>
      </form>
    </Shell>
  );
}

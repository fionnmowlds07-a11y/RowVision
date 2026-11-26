import { useEffect, useState } from "react";

/** Whether the app looks for a new version when it opens. */
export function UpdatesCard() {
  const [on, setOn] = useState<boolean | null>(null);

  useEffect(() => {
    let live = true;
    void window.rowvision.getUpdateCheck().then((found) => { if (live) setOn(found); });
    return () => { live = false; };
  }, []);

  if (on === null) return null;
  async function change(next: boolean) {
    setOn(next);
    await window.rowvision.setUpdateCheck(next);
  }

  return (
    <section className="card stack" style={{ maxWidth: 640 }} aria-labelledby="updates-title">
      <h2 id="updates-title" style={{ fontSize: 19 }}>New versions</h2>
      <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <input type="checkbox" checked={on} onChange={(event) => void change(event.target.checked)} />
        Check for a new version when RowVision opens
      </label>
      <p className="soft" style={{ fontSize: 14 }}>It reads one small file from rowvision.app. Nothing about you or your clips is sent.</p>
    </section>
  );
}

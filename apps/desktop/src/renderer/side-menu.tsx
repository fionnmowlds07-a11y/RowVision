import { useState } from "react";
import type { ClipItem, Running, Space } from "../shared/bridge";
import { size } from "./format";
import type { Route } from "./route";
import { libraryChanged } from "./use-library";
import styles from "./shell.module.css";

const THREE_MONTHS_MS = 91 * 24 * 3600 * 1000;

/** Analysed clips filmed over three months ago that still have their video. */
export function oldVideos(clips: ClipItem[], now = Date.now()): ClipItem[] {
  return clips.filter((clip) => clip.state === "done" && clip.hasVideo && now - Date.parse(clip.setup.filmed_at ?? clip.createdAt) > THREE_MONTHS_MS);
}

const ICONS = {
  clips: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M10 9l5 3-5 3z" /></>,
  guide: <><path d="M4 5h6a2 2 0 0 1 2 2v12a2 2 0 0 0-2-2H4z" /><path d="M20 5h-6a2 2 0 0 0-2 2v12a2 2 0 0 1 2-2h6z" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" /></>,
  running: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
};

function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      {ICONS[name]}
    </svg>
  );
}

type Props = { route: Route; running: Running | null; clips: ClipItem[] | null; space: Space | null };

export function SideMenu({ route, running, clips, space }: Props) {
  const here = (page: Route["page"][]) => (page.includes(route.page) ? "page" : undefined);
  return (
    <aside className={styles.side}>
      <a href="#/" className={styles.logo}>RowVision</a>
      <nav aria-label="Main" className={styles.nav}>
        <a href="#/" aria-current={here(["clips", "clip", "add"])}><Icon name="clips" />Clips</a>
        <a href="#/guide" aria-current={here(["guide"])}><Icon name="guide" />Filming guide</a>
        <a href="#/settings" aria-current={here(["settings"])}><Icon name="settings" />Settings</a>
        {running ? (
          <a href={`#/analysis/${running.id}`} className={styles.running} aria-current={here(["analysis"])}>
            <Icon name="running" />Analysing {Math.round(running.progress * 100)}%
          </a>
        ) : null}
      </nav>
      <div className={styles.fill} />
      {space && clips ? <SpaceCard space={space} clips={clips} /> : null}
    </aside>
  );
}

function SpaceCard({ space, clips }: { space: Space; clips: ClipItem[] }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const old = oldVideos(clips);
  const total = space.videoBytes + space.otherBytes + (space.freeBytes ?? 0);
  const share = (bytes: number) => `${total ? Math.max((bytes / total) * 100, bytes ? 1 : 0) : 0}%`;

  async function remove() {
    setBusy(true);
    for (const clip of old) await window.rowvision.removeVideo(clip.id);
    setBusy(false);
    setConfirming(false);
    libraryChanged();
  }

  return (
    <section className={styles.space} aria-labelledby="space-title">
      <h2 id="space-title">Space on this computer</h2>
      <div className={styles.meter} aria-hidden="true">
        <span style={{ width: share(space.videoBytes) }} />
        <span style={{ width: share(space.otherBytes) }} />
      </div>
      <p>
        Videos {size(space.videoBytes)}<br />
        Scores and notes {size(space.otherBytes)}
        {space.freeBytes !== null ? <><br />{size(space.freeBytes)} free</> : null}
      </p>
      {old.length > 0 && !confirming ? (
        <button type="button" className="button quiet" onClick={() => setConfirming(true)}>Remove videos over 3 months old</button>
      ) : null}
      {confirming ? (
        <>
          <p>Remove {old.length === 1 ? "1 video" : `${old.length} videos`} over 3 months old? Their scores stay, and your original videos are not touched.</p>
          <button type="button" className="button primary" disabled={busy} onClick={() => void remove()}>{busy ? "Removing" : "Remove"}</button>
          <button type="button" className="button quiet" disabled={busy} onClick={() => setConfirming(false)}>Keep them</button>
        </>
      ) : null}
    </section>
  );
}

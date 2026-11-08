import { useEffect, useState } from "react";
import homeStyles from "@/app/home.module.css";
import type { ClipItem } from "../shared/bridge";
import { Placeholder } from "./placeholder";
import { setupLine, shortDate, size } from "./format";

export function ClipsPage() {
  const [clips, setClips] = useState<ClipItem[] | null>(null);

  useEffect(() => {
    let live = true;
    void window.rowvision.listClips().then((found) => { if (live) setClips(found); });
    return () => { live = false; };
  }, []);

  if (clips === null) return <p aria-busy="true">Loading your clips…</p>;
  const total = clips.reduce((sum, clip) => sum + clip.bytes, 0);

  return (
    <>
      <div className={homeStyles.head}>
        <h1 style={{ fontSize: 32 }}>Your clips</h1>
        <a className="button primary" href="#/add">Add a video</a>
      </div>
      <Placeholder>Placeholder in the website&apos;s look until the desktop design is picked.</Placeholder>
      {clips.length === 0 ? (
        <section className="card stack">
          <h2 style={{ fontSize: 19 }}>Nothing here yet</h2>
          <p className="soft">Clips you add are kept on this computer, one folder each.</p>
        </section>
      ) : (
        <>
          <ul className={homeStyles.list}>
            {clips.map((clip, index) => {
              const score = clip.overall !== null && clip.band !== "Poor" ? Math.round(clip.overall) : null;
              return (
                <li key={clip.id}>
                  <a href={`#/clip/${clip.id}`} className={index === 0 && score !== null ? homeStyles.clipMain : homeStyles.clip}>
                    <span className={homeStyles.text}>
                      <strong>{shortDate(clip.createdAt)}</strong>
                      <span>{setupLine(clip.setup)}{clip.rate ? `, ${Math.round(clip.rate)} spm` : ""}</span>
                      {clip.setup.note ? <span>{clip.setup.note}</span> : null}
                      <span>{clip.analysed ? (clip.band ? `Accuracy ${clip.band}` : "No scores") : "Not analysed yet"}</span>
                    </span>
                    {score !== null ? <span className={homeStyles.score}>{score}</span> : null}
                  </a>
                </li>
              );
            })}
          </ul>
          <p style={{ margin: 0, color: "var(--on-ground-soft)" }}>{clips.length} {clips.length === 1 ? "clip" : "clips"}, using {size(total)}.</p>
        </>
      )}
    </>
  );
}

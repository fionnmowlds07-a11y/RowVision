import { useEffect, useRef, useState, type MouseEvent } from "react";
import { tapPoint } from "@/lib/clip-checks";
import { clipUrl, type ClipDetail, type ClipItem } from "../shared/bridge";
import { CREW_STAGE, STAGES, stageIndex } from "../shared/stages";
import { shortDate, setupLine } from "./format";
import { minutesText, useAnalysis } from "./use-analysis";
import { percent, useModels } from "./use-models";
import styles from "./analysis.module.css";

const HEADINGS = {
  running: "Analysing your clip",
  waiting: "Waiting its turn",
  needs_tap: "Click on yourself to carry on",
  stopped: "Stopped",
  failed: "We couldn't analyse this clip",
  done: "Analysed",
} as const;

export function AnalysisPage({ id }: { id: string }) {
  const analysis = useAnalysis();
  const models = useModels();
  const [clip, setClip] = useState<ClipDetail | null | undefined>(undefined);
  const [clips, setClips] = useState<ClipItem[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [tap, setTap] = useState<{ x: number; y: number } | null>(null);
  const [sending, setSending] = useState(false);
  const video = useRef<HTMLVideoElement>(null);

  // Read the clip again when something other than the progress changes.
  const running = analysis?.running ?? null;
  const key = [running?.id, running?.stage, analysis?.waiting.map((item) => item.id).join()].join("|");
  useEffect(() => {
    let live = true;
    void Promise.all([window.rowvision.getClip(id), window.rowvision.listClips()]).then(([found, all]) => {
      if (!live) return;
      setClip(found);
      setClips(all);
      setSending(false);
    });
    return () => { live = false; };
  }, [id, key]);

  if (clip === undefined || analysis === null) return <p aria-busy="true">Loading…</p>;
  if (clip === null) {
    return (
      <section className="card stack">
        <h1 style={{ fontSize: 24 }}>Clip not found</h1>
        <a href="#/">Back to your clips</a>
      </section>
    );
  }

  const state = clip.state;
  const mine = running?.id === id ? running : null;
  const place = analysis.waiting.find((item) => item.id === id);
  const progress = state === "done" ? 1 : mine?.progress ?? 0;
  const at = state === "done" ? STAGES.length : mine ? Math.max(stageIndex(mine.stage), 0) : -1;
  const others = analysis.waiting.filter((item) => item.id !== id);
  const nameOf = (other: string) => {
    const found = clips.find((item) => item.id === other);
    return found ? [shortDate(found.createdAt), setupLine(found.setup)].filter(Boolean).join(", ") : "A clip";
  };

  let timeText = "";
  if (mine) timeText = mine.secondsLeft !== null ? `${minutesText(mine.secondsLeft)} left` : "Working out how long";
  else if (state === "waiting" && place) timeText = analysis.engineMissing || place.modelMissing ? "Not started" : `Starts in ${minutesText(place.secondsUntil)}`;
  else if (state === "needs_tap") timeText = "Paused";

  function tapFrame(event: MouseEvent<HTMLButtonElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    setTap(event.detail === 0 ? { x: 0.5, y: 0.5 } : tapPoint(event.clientX, event.clientY, box));
  }

  async function sendTap() {
    if (!tap || !clip) return;
    setSending(true);
    await window.rowvision.tapAgain(id, { t: clip.pauseSeconds ?? 0, ...tap });
    setTap(null);
  }

  return (
    <>
      <div>
        <h1 style={{ fontSize: 32 }}>{state === "needs_tap" && clip.setup.coach ? "Click on the crew to carry on" : HEADINGS[state]}</h1>
        <p className={styles.sub}>{[shortDate(clip.createdAt), setupLine(clip.setup), clip.setup.note].filter(Boolean).join(" · ")}</p>
      </div>

      <div className={styles.layout}>
        <div className={styles.stage}>
          {clip.hasVideo ? (
            <video
              ref={video}
              src={clipUrl(id, "working.mp4")}
              muted
              playsInline
              preload="auto"
              onLoadedMetadata={() => { if (video.current) video.current.currentTime = clip.pauseSeconds ?? Math.min(1, video.current.duration / 2); }}
            />
          ) : (
            <p className={styles.empty}>{state === "waiting" || state === "running" ? "Your video shows here once it is prepared." : "No video to show."}</p>
          )}
          {state === "needs_tap" && clip.hasVideo ? (
            <>
              <button type="button" className={styles.tapLayer} onClick={tapFrame} aria-label={clip.setup.coach ? "Click the crew on this frame" : "Tap yourself on this frame"}>
                {tap ? <span className={styles.ring} style={{ left: `${tap.x * 100}%`, top: `${tap.y * 100}%` }} /> : null}
              </button>
              {clip.setup.coach
                ? <p className={styles.banner}><strong>Which boat is it?</strong> There&apos;s more than one in view. Click on the crew in the picture.</p>
                : <p className={styles.banner}><strong>Which one is you?</strong> We couldn&apos;t tell. Click on yourself in the picture.</p>}
            </>
          ) : null}
        </div>

        <section className={styles.panel} aria-label="Progress">
          <div className={styles.headline}>
            <strong className={styles.pct}>{state === "waiting" ? "Waiting" : `${Math.round(progress * 100)}%`}</strong>
            <span className="soft" aria-live="polite">{timeText}</span>
          </div>
          <progress className={styles.bar} max={1} value={progress} aria-label="Analysis progress" />
          <ol className={styles.stages}>
            {STAGES.map((item, index) => {
              const done = index < at;
              const now = index === at && state === "running";
              return (
                <li key={item.engine} className={done ? styles.done : now ? styles.now : styles.later} aria-current={now ? "step" : undefined}>
                  <span className={styles.dot} aria-hidden="true">
                    {done ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5 9-10" /></svg> : null}
                  </span>
                  {item.engine === "Measuring your rower" && (mine?.stage === CREW_STAGE || clip?.setup.scope === "crew") ? CREW_STAGE : item.name}
                </li>
              );
            })}
          </ol>

          {!analysis.engineMissing && place?.modelMissing && state === "waiting" ? (
            <p className={styles.caution}>
              {models?.state === "downloading"
                ? `Downloading the measuring models, ${percent(models)}%. This clip starts when they are here.`
                : <>{models?.standardReady ? "The more accurate model isn't downloaded yet, so this clip waits here until it is." : "The measuring models aren't downloaded yet, so clips wait here until they are."} <a href="#/settings">Download them in Settings</a>.</>}
            </p>
          ) : null}
          {analysis.engineMissing && state === "waiting" ? (
            <p className={styles.caution}>The measuring part of RowVision isn&apos;t installed on this computer yet, so clips wait here until it is.</p>
          ) : null}
          {state === "running" || state === "waiting" ? (
            <p className="soft" style={{ fontSize: 14 }}>
              {analysis.effort === "full"
                ? "Running at full speed, using every core, so the computer may be slow to use until it finishes."
                : analysis.effort === "gentle"
                  ? "Running gently, so the computer stays easy to use. It takes longer."
                  : "Running balanced: about half the computer's power, leaving room for your other programs."}{" "}
              <a href="#/settings">Change the speed</a>
            </p>
          ) : null}
          {analysis.onBattery && (state === "running" || state === "waiting") ? (
            <p className={styles.caution}>This laptop is on battery. Analysis is quicker, and kinder to the battery, when it is plugged in.</p>
          ) : null}
          {state === "failed" && clip.message ? <p role="alert" className="error">{clip.message}</p> : null}

          {others.length > 0 ? (
            <div className={styles.queue}>
              <h2 className={styles.queueTitle}>Waiting next</h2>
              <ul>
                {others.map((other) => (
                  <li key={other.id}>
                    <a href={`#/analysis/${other.id}`}>{nameOf(other.id)}</a>
                    <span className="soft">{analysis.engineMissing || other.modelMissing ? "" : `in ${minutesText(other.secondsUntil)}`}</span>
                    <button type="button" className="button quiet" aria-label={`Remove ${nameOf(other.id)} from the queue`} onClick={() => void window.rowvision.stopClip(other.id)}>Remove</button>
                  </li>
                ))}
              </ul>
              <p className="soft">Add more videos any time. They run one after another.</p>
            </div>
          ) : null}

          <div className={styles.fill} />
          {state === "running" && !confirming ? (
            <p className="soft">Your computer may get warm and its fan may run. You can use other apps meanwhile, but keep RowVision open until it finishes.</p>
          ) : null}
          {confirming && (state === "running" || state === "waiting" || state === "needs_tap") ? (
            <div className={styles.confirm}>
              <p><strong>Stop analysing?</strong> The clip stays in your library and you can start again later.</p>
              <div className={styles.row}>
                <button type="button" className="button quiet" onClick={() => setConfirming(false)}>Keep going</button>
                <button type="button" className={`button ${styles.stop}`} onClick={() => { setConfirming(false); void window.rowvision.stopClip(id); }}>Stop</button>
              </div>
            </div>
          ) : null}
          {state === "needs_tap" ? (
            <button type="button" className="button primary" disabled={!tap || sending} onClick={() => void sendTap()}>{sending ? "Carrying on" : clip?.setup.coach ? "This is the boat" : "This is me"}</button>
          ) : null}
          {(state === "running" || state === "waiting" || state === "needs_tap") && !confirming ? (
            <button type="button" className="button quiet" onClick={() => setConfirming(true)}>Cancel</button>
          ) : null}
          {state === "done" ? <a href={`#/clip/${id}`} className="button primary">See your results</a> : null}
          {state === "stopped" || state === "failed" ? (
            <button type="button" className="button primary" onClick={() => void window.rowvision.startClip(id)}>Start again</button>
          ) : null}
        </section>
      </div>
    </>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { evidenceFrames, formatTarget, formatValue, laneMarks, overallGap, overallVisible, ratingNote, sourceLink, timingText } from "@/lib/logic";
import type { FrameData, Metric, Rower, Summary } from "@/lib/result";
import { workOnNext } from "@/lib/work-on-next";
import { Evidence } from "./evidence";
import { makeScene } from "./draw";
import { Viewer, type Jump } from "./viewer";
import styles from "./clip.module.css";

const MIN_STROKES = 3;

type Props = { summary: Summary; rower: Rower; videoLink: string | null; framesLink: string | null; oldVersion: boolean };

export function Results({ summary, rower, videoLink, framesLink, oldVersion }: Props) {
  const [data, setData] = useState<FrameData | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [asking, setAsking] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [fullScreen, setFullScreen] = useState(false);
  const [jump, setJump] = useState<Jump | null>(null);

  useEffect(() => {
    if (!framesLink) return;
    let live = true;
    fetch(framesLink).then((response) => response.json()).then((value) => { if (live) setData(value); }).catch(() => {});
    return () => { live = false; };
  }, [framesLink]);

  const scene = useMemo(
    () => (data ? makeScene(rower, data, summary.facing, summary.view_deg) : null),
    [data, rower, summary],
  );
  const advice = workOnNext(rower);
  const { card, rating } = rower;
  const visible = overallVisible(rating, revealed);

  function show(frame: number) {
    setJump((old) => ({ frame, nonce: (old?.nonce ?? 0) + 1 }));
    setFullScreen(true);
  }

  function openMeasure(metric: Metric) {
    setOpen((old) => (old === metric.name ? null : metric.name));
    const first = evidenceFrames(metric.name, rower.strokes)[0];
    if (first && videoLink && window.matchMedia("(max-width: 899px)").matches) show(first.frame);
    else if (first) setJump((old) => ({ frame: first.frame, nonce: (old?.nonce ?? 0) + 1 }));
  }

  return (
    <>
      <div className={styles.strip}>
        <div className={styles.tileMain}>
          <span>Overall</span>
          {card.overall === null ? (
            <p>{overallGap(rower.strokes.length, card.phases, MIN_STROKES)}</p>
          ) : visible ? (
            <strong>{Math.round(card.overall)}</strong>
          ) : (
            <>
              <p>Hidden, as the accuracy is Poor.</p>
              <button type="button" className="button quiet" onClick={() => setAsking(true)}>Show score anyway</button>
            </>
          )}
        </div>
        <div className={styles.tile}>
          <span>Accuracy</span>
          <strong>{Math.round(rating.accuracy)}%</strong>
          <small>{rating.band}. {ratingNote(rating)}</small>
        </div>
        {(["catch", "finish"] as const).map((phase) => (
          <div key={phase} className={`${styles.tile} ${styles.wideTile}`}>
            <span>{phase === "catch" ? "Catch" : "Finish"}</span>
            <strong>{card.phases[phase] === undefined || card.phases[phase] === null ? "–" : Math.round(card.phases[phase])}</strong>
          </div>
        ))}
        <div className={`${styles.tile} ${styles.wideTile}`}>
          <span>Rate</span>
          <strong>{rower.rate_spm ? Math.round(rower.rate_spm) : "–"}</strong>
          <small>strokes a minute</small>
        </div>
      </div>

      {asking ? (
        <div role="alertdialog" aria-labelledby="warn-title" className={`card stack ${styles.warn}`}>
          <h2 id="warn-title" style={{ fontSize: 19 }}>Show the score anyway?</h2>
          <p className="soft">This footage is rated Poor, so the overall score will be misleading. Treat it as a rough guide only, and don&apos;t use it to judge your technique.</p>
          <div className={styles.row}>
            <button type="button" className="button quiet" onClick={() => setAsking(false)}>Keep it hidden</button>
            <button type="button" className="button primary" onClick={() => { setRevealed(true); setAsking(false); }}>Show score</button>
          </div>
        </div>
      ) : null}

      {oldVersion ? <p className={styles.caution}>Measured with an older version of RowVision.</p> : null}
      {[...summary.warnings, ...rating.warnings].length ? (
        <ul className={styles.notes}>{[...summary.warnings, ...rating.warnings].map((text) => <li key={text}>{text}</li>)}</ul>
      ) : null}

      <div className={styles.body}>
        {videoLink ? (
          <div className={styles.videoColumn}>
            <button type="button" className={`button primary ${styles.openVideo}`} onClick={() => setFullScreen(true)}>Open video</button>
            <div className={fullScreen ? undefined : styles.videoHolder}>
              <Viewer
                link={videoLink}
                fps={summary.fps}
                frames={summary.frames}
                rower={rower}
                scene={scene}
                jump={jump}
                fullScreen={fullScreen}
                onClose={() => setFullScreen(false)}
              />
            </div>
          </div>
        ) : (
          <p className={styles.gone}>The video has been deleted, as it is after 30 days. Your scores stay here.</p>
        )}
        <div className={styles.side}>
          <section className="card stack">
            <h2 style={{ fontSize: 24 }}>{advice.kind === "filming" ? "Film it better next time" : "Work on next"}</h2>
            <ol className={styles.advice}>
              {advice.items.map(({ text, measure }) => (
                <li key={text}>
                  {measure ? <a href={`#${measure}`} onClick={() => setOpen(measure)}>{text}</a> : text}
                </li>
              ))}
            </ol>
          </section>
          <section className="card" aria-label="Measures">
            <ul className={styles.measures}>
              {card.metrics.map((metric) => (
                <li key={metric.name} id={metric.name}>
                  <button type="button" className={styles.measure} aria-expanded={open === metric.name} onClick={() => openMeasure(metric)}>
                    <span className={styles.line}>
                      <span>{metric.label}</span>
                      <strong>{metric.score === null ? "Not scored" : Math.round(metric.score)}</strong>
                    </span>
                    <small>
                      You {formatValue(metric.name, metric.value)}. {metric.target ? `Target ${formatTarget(metric.name, metric.target)}.` : "No target yet."}
                      {metric.score === null && metric.reason ? ` ${metric.reason}` : ""}
                    </small>
                    <MiniLane metric={metric} />
                  </button>
                  {open === metric.name ? (
                    <div className={styles.evidence}>
                      {videoLink ? <Evidence link={videoLink} fps={summary.fps} metric={metric} rower={rower} scene={scene} onPick={show} /> : null}
                      {metric.target?.sources.length ? (
                        <p className="soft">
                          Sources:{" "}
                          {metric.target.sources.map((source) => {
                            const { href, label } = sourceLink(source);
                            return <a key={source} href={href} target="_blank" rel="noreferrer">{label} </a>;
                          })}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
          {rower.timing ? (
            <section className="card stack">
              <h2 style={{ fontSize: 19 }}>Timing against seat {rower.timing.leader_seat}</h2>
              <p className={styles.line}><span>Catch</span><strong>{timingText(rower.timing.catch_ms, rower.timing.catch_spread_ms)}</strong></p>
              <p className={styles.line}><span>Finish</span><strong>{timingText(rower.timing.finish_ms, rower.timing.finish_spread_ms)}</strong></p>
              <p className="soft" style={{ fontSize: 13 }}>Trend across {rower.timing.strokes} strokes, from hand movement. Not scored, and good to about 50 ms.</p>
            </section>
          ) : null}
        </div>
      </div>
      <p className={styles.small}>Coaching feedback, not medical advice.</p>
    </>
  );
}

function MiniLane({ metric }: { metric: Metric }) {
  const marks = laneMarks(metric.value, metric.target);
  if (!marks) return null;
  return (
    <span className={styles.miniLane} aria-hidden="true">
      <span className={styles.band} style={{ left: `${marks.bandStart}%`, width: `${marks.bandWidth}%` }} />
      <span className={styles.value} style={{ left: `${marks.buoy}%` }} />
    </span>
  );
}

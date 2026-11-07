"use client";

import { useRef, useState, useTransition, type MouseEvent } from "react";
import { tapPoint } from "@/lib/clip-checks";
import { tapAgain } from "./actions";
import styles from "./clip.module.css";

type Props = { clip: string; link: string; seconds: number };

export function TapAgain({ clip, link, seconds }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const [tap, setTap] = useState<{ x: number; y: number } | null>(null);
  const [sending, startSend] = useTransition();

  function tapFrame(event: MouseEvent<HTMLButtonElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    setTap(tapPoint(event.clientX, event.clientY, box));
  }

  return (
    <section className="stack">
      <div className={styles.frame}>
        <video
          ref={video}
          src={link}
          muted
          playsInline
          preload="auto"
          onLoadedMetadata={() => { if (video.current) video.current.currentTime = seconds; }}
        />
        <button type="button" className={styles.tapLayer} onClick={tapFrame} aria-label="Tap yourself on this frame">
          {tap ? <span className={styles.ring} style={{ left: `${tap.x * 100}%`, top: `${tap.y * 100}%` }} /> : null}
        </button>
      </div>
      <div className="card stack">
        <h2 style={{ fontSize: 24 }}>Which rower is you?</h2>
        <p className="soft">We couldn&apos;t tell. Tap yourself on the frame and we&apos;ll carry on.</p>
        <button
          type="button"
          className="button primary"
          disabled={!tap || sending}
          onClick={() => tap && startSend(() => tapAgain(clip, { t: seconds, ...tap }))}
        >
          {sending ? "Sending" : "This is me"}
        </button>
      </div>
    </section>
  );
}

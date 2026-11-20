"use client";

import { useEffect, useEffectEvent, useMemo, useRef, useState, type ChangeEvent, type MouseEvent, type ReactNode } from "react";
import {
  clockTime, firstTrim, looksCompressed, refuseLength, tapPoint, trimEnd, trimStart, type Trim, type VideoFacts,
} from "@/lib/clip-checks";
import { BOAT_NAMES, BOAT_SEATS, SIDE_NAMES, fitSetup, seatsFor, sidesFor, type Setup } from "@/lib/setup";
import styles from "./add.module.css";

/** Shared by the website and the desktop app: picking a video, trimming it, tapping yourself and the boat. */

export type Tap = { t: number; x: number; y: number };

export type Choice = {
  facts: VideoFacts | null;
  cannotShow: boolean;
  trim: Trim;
  tap: Tap | null;
  setup: Setup;
  note: string;
};

export function freshChoice(setup: Setup): Choice {
  return { facts: null, cannotShow: false, trim: { start: 0, end: 0 }, tap: null, setup, note: "" };
}

/** A video dropped anywhere on the page counts, and the page would otherwise open it and lose the form. */
export function useVideoDrop(onFile: ((file: File) => void) | null): boolean {
  const [dragging, setDragging] = useState(false);
  const dropped = useEffectEvent((event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const picked = event.dataTransfer?.files[0];
    if (picked && onFile) onFile(picked);
  });
  const over = useEffectEvent((event: DragEvent) => {
    event.preventDefault();
    if (onFile) setDragging(true);
  });
  useEffect(() => {
    const onDrop = (event: DragEvent) => dropped(event);
    const onOver = (event: DragEvent) => over(event);
    const onLeave = (event: DragEvent) => { if (!event.relatedTarget) setDragging(false); };
    window.addEventListener("drop", onDrop);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    return () => {
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
    };
  }, []);
  return dragging;
}

type PickProps = { dragging: boolean; refusal: string | null; guide: ReactNode; onFile: (file: File) => void };

export function PickCard({ dragging, refusal, guide, onFile }: PickProps) {
  function choose(event: ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0];
    if (picked) onFile(picked);
  }
  return (
    <section className={`card stack ${styles.pick} ${dragging ? styles.dragging : ""}`}>
      <p className={styles.dropHint}>{dragging ? "Drop it anywhere" : "Drag a video here, or choose one"}</p>
      <p className="soft">Use the original video, side-on, with you large in the frame.</p>
      <label className="button primary">
        Choose a video
        <input type="file" accept="video/*,.mp4,.mov,.m4v" onChange={choose} className={styles.hiddenInput} />
      </label>
      {guide}
      {refusal ? <p role="alert" className="error">{refusal}</p> : null}
    </section>
  );
}

type FormProps = {
  file: File;
  choice: Choice;
  onChange: (choice: Choice) => void;
  /** Called when the video turns out too short to use. */
  onRefuse: (message: string) => void;
  /** Shown when this browser cannot play the video, saying what happens instead. */
  cannotShowNote: string;
  /** The last card, which sends or saves the clip. */
  children: ReactNode;
  /** A choice of who to measure, shown at the top of the boat card. */
  who?: ReactNode;
  /** In place of side, seat and the tap, when no one rower is followed, such as a whole crew filmed by a coach. */
  crew?: ReactNode;
  /** In place of the side, when the side comes from something else, such as the boat's rig. */
  side?: ReactNode;
};

export function ClipForm({ file, choice, onChange, onRefuse, cannotShowNote, children, who, crew, side }: FormProps) {
  const video = useRef<HTMLVideoElement>(null);
  const objectUrl = useMemo(() => URL.createObjectURL(file), [file]);
  const [frameTime, setFrameTime] = useState(0);
  const [zoom, setZoom] = useState(1);
  const { facts, trim, tap, setup, note } = choice;

  useEffect(() => () => URL.revokeObjectURL(objectUrl), [objectUrl]);

  function loaded() {
    const element = video.current;
    if (!element) return;
    const next = { duration: element.duration, width: element.videoWidth, height: element.videoHeight };
    if (!next.width) {
      onChange({ ...choice, cannotShow: true });
      return;
    }
    const tooShort = refuseLength(next.duration);
    if (tooShort) {
      onRefuse(tooShort);
      return;
    }
    onChange({ ...choice, facts: next, trim: firstTrim(next.duration) });
    element.currentTime = Math.min(1, next.duration / 2);
    setFrameTime(element.currentTime);
  }

  function seek(seconds: number, next: Choice) {
    setFrameTime(seconds);
    if (video.current) video.current.currentTime = seconds;
    onChange({ ...next, tap: null });
  }

  function moveStart(start: number) {
    if (!facts) return;
    const next = trimStart(start, trim, facts.duration);
    seek(next.start, { ...choice, trim: next });
  }

  function moveEnd(end: number) {
    if (!facts) return;
    const next = trimEnd(end, trim, facts.duration);
    seek(next.end, { ...choice, trim: next });
  }

  function tapFrame(event: MouseEvent<HTMLButtonElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const point = event.detail === 0 ? { x: 0.5, y: 0.5 } : tapPoint(event.clientX, event.clientY, box);
    onChange({ ...choice, tap: { t: frameTime - trim.start, ...point } });
  }

  return (
    <div className={styles.flow}>
      <div className={styles.stage}>
        <div className={styles.scroller}>
          <div className={styles.frame} style={{ width: `${zoom * 100}%` }}>
            <video ref={video} src={objectUrl} muted playsInline preload="auto" onLoadedMetadata={loaded} onError={() => onChange({ ...choice, cannotShow: true })} />
            {facts && !crew ? (
              <button type="button" className={styles.tapLayer} onClick={tapFrame} aria-label="Tap yourself on this frame">
                {tap ? <span className={styles.ring} style={{ left: `${tap.x * 100}%`, top: `${tap.y * 100}%` }} /> : null}
              </button>
            ) : null}
          </div>
        </div>
        {choice.cannotShow ? <p className={styles.stageNote}>{cannotShowNote}</p> : null}
      </div>

      <section className={`card stack ${styles.controls}`} aria-label="Choose your frame">
        {facts ? (
          <>
            <div className={styles.trim} role="group" aria-label="Trim your clip">
              <div className={styles.row}>
                <strong>Trim your clip</strong>
                <span className="soft" aria-live="polite">{Math.round(trim.end - trim.start)} of up to 60 seconds</span>
              </div>
              <label className="field">
                Start {clockTime(trim.start)}
                <input type="range" className={styles.range} min={0} max={facts.duration} step={0.5} value={trim.start} onChange={(e) => moveStart(Number(e.target.value))} />
              </label>
              <label className="field">
                End {clockTime(trim.end)}
                <input type="range" className={styles.range} min={0} max={facts.duration} step={0.5} value={trim.end} onChange={(e) => moveEnd(Number(e.target.value))} />
              </label>
            </div>
            {crew ? null : (
            <>
            <label className="field">
              Drag to a clear frame, then tap yourself
              <input type="range" className={styles.range} min={trim.start} max={trim.end} step={0.1} value={frameTime} onChange={(e) => seek(Number(e.target.value), choice)} />
            </label>
            <div className={styles.row}>
              <span className="soft" aria-live="polite">{tap ? "Got you. Tap again to change it." : "Not tapped yet"}</span>
              <div className={styles.zoom} role="group" aria-label="Zoom">
                {[1, 2, 3].map((level) => (
                  <button key={level} type="button" className="button quiet" aria-pressed={zoom === level} onClick={() => setZoom(level)}>{level}×</button>
                ))}
              </div>
            </div>
            </>
            )}
          </>
        ) : null}
        {facts && looksCompressed(file.name, facts) ? (
          <p className={styles.caution}>This looks like a compressed copy, such as one sent over WhatsApp. Ask whoever filmed it for the original for a better result. You can still carry on.</p>
        ) : null}
      </section>

      <section className={`card ${styles.setup}`} aria-label="Your boat">
        {who ? <div className={styles.wide}>{who}</div> : null}
        <label className="field">
          Boat
          <select value={setup.boat} onChange={(e) => onChange({ ...choice, setup: fitSetup({ ...setup, boat: e.target.value }) })}>
            {Object.keys(BOAT_SEATS).map((boat) => <option key={boat} value={boat}>{BOAT_NAMES[boat]}</option>)}
          </select>
        </label>
        {crew ?? (
        <>
        {side ?? (
        <label className="field">
          Side
          <select value={setup.side} onChange={(e) => onChange({ ...choice, setup: { ...setup, side: e.target.value } })}>
            {sidesFor(setup.boat).map((option) => <option key={option} value={option}>{SIDE_NAMES[option]}</option>)}
          </select>
        </label>
        )}
        <label className="field">
          Your seat
          <select value={setup.seat} onChange={(e) => onChange({ ...choice, setup: { ...setup, seat: Number(e.target.value) } })}>
            {seatsFor(setup.boat).map((seat) => <option key={seat} value={seat}>{seat}</option>)}
          </select>
        </label>
        </>
        )}
        <label className="field">
          Note, if you like
          <input value={note} maxLength={200} onChange={(e) => onChange({ ...choice, note: e.target.value })} placeholder="Saturday steady state" />
        </label>
      </section>

      {children}
    </div>
  );
}

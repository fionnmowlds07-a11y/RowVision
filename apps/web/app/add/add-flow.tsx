"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useRef, useState, type ChangeEvent, type MouseEvent } from "react";
import type { Upload } from "tus-js-client";
import {
  clockTime, lastSectionStart, looksCompressed, needsSection, refuseFile, refuseLength, sectionEnd,
  submitError, tapPoint, type VideoFacts,
} from "@/lib/clip-checks";
import { BOAT_NAMES, BOAT_SEATS, SIDE_NAMES, fitSetup, seatsFor, sidesFor, type Setup } from "@/lib/setup";
import { browserClient, type Connection } from "@/lib/supabase/browser";
import { clipIdFor, forgetUpload, startUpload } from "@/lib/upload";
import styles from "./add.module.css";

type Tap = { t: number; x: number; y: number };
type Props = { userId: string; setup: Setup; connection: Connection };

export function AddFlow({ userId, setup: saved, connection }: Props) {
  const router = useRouter();
  const video = useRef<HTMLVideoElement>(null);
  const upload = useRef<Upload | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [clipId, setClipId] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [facts, setFacts] = useState<VideoFacts | null>(null);
  const [cannotShow, setCannotShow] = useState(false);
  const [share, setShare] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [uploaded, setUploaded] = useState(false);
  const [uploadFailed, setUploadFailed] = useState(false);
  const [sectionStart, setSectionStart] = useState(0);
  const [frameTime, setFrameTime] = useState(0);
  const [tap, setTap] = useState<Tap | null>(null);
  const [zoom, setZoom] = useState(1);
  const [setup, setSetup] = useState(saved);
  const [note, setNote] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => void upload.current?.abort(), []);
  useEffect(() => () => { if (objectUrl) URL.revokeObjectURL(objectUrl); }, [objectUrl]);

  // A submitted clip waits here for its upload, then joins the queue.
  useEffect(() => {
    if (!submitted || !uploaded || !clipId || !file) return;
    browserClient(connection).rpc("finish_upload", { clip: clipId }).then(({ error: failed }) => {
      if (failed) {
        setError(submitError(failed.message));
        return;
      }
      forgetUpload(file);
      router.push(`/clips/${clipId}`);
    });
  }, [submitted, uploaded, clipId, file, connection, router]);

  function choose(event: ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0];
    if (picked) void take(picked);
  }

  async function take(picked: File) {
    const problem = refuseFile(picked);
    setRefusal(problem);
    if (problem) return;
    const { data } = await browserClient(connection).auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      setRefusal("Your session has ended. Sign in again.");
      return;
    }
    const id = clipIdFor(picked);
    setFile(picked);
    setClipId(id);
    setObjectUrl(URL.createObjectURL(picked));
    upload.current = startUpload({
      file: picked, url: connection.url, anonKey: connection.anonKey, token,
      path: `${userId}/${id}/source`,
      onProgress: setShare,
      onDone: () => { setUploaded(true); setUploadFailed(false); },
      onError: () => setUploadFailed(true),
    });
  }

  // A video dropped anywhere on the page counts, and a browser would otherwise open it and lose the form.
  const dropped = useEffectEvent((event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const picked = event.dataTransfer?.files[0];
    if (picked && !file) void take(picked);
  });
  const over = useEffectEvent((event: DragEvent) => {
    event.preventDefault();
    if (!file) setDragging(true);
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

  function reset() {
    upload.current?.abort();
    setFile(null); setObjectUrl(null); setClipId(null); setFacts(null); setCannotShow(false); setShare(0);
    setUploaded(false); setUploadFailed(false); setTap(null); setSectionStart(0); setFrameTime(0); setRefusal(null);
  }

  function loaded() {
    const element = video.current;
    if (!element) return;
    const next = { duration: element.duration, width: element.videoWidth, height: element.videoHeight };
    if (!next.width) {
      setCannotShow(true);
      return;
    }
    const tooShort = refuseLength(next.duration);
    if (tooShort) {
      reset();
      setRefusal(tooShort);
      return;
    }
    setFacts(next);
    element.currentTime = Math.min(1, next.duration / 2);
    setFrameTime(element.currentTime);
  }

  function seek(seconds: number) {
    setFrameTime(seconds);
    if (video.current) video.current.currentTime = seconds;
    setTap(null);
  }

  function moveSection(start: number) {
    setSectionStart(start);
    seek(start);
  }

  function tapFrame(event: MouseEvent<HTMLButtonElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const point = event.detail === 0 ? { x: 0.5, y: 0.5 } : tapPoint(event.clientX, event.clientY, box);
    setTap({ t: frameTime - sectionStart, ...point });
  }

  async function submit() {
    if (!file || !clipId) return;
    setError(null);
    const { error: failed } = await browserClient(connection).rpc("submit_clip", {
      clip: clipId, boat: setup.boat, rowing_side: setup.side, seat_number: setup.seat,
      section_start: sectionStart, tap_point: tap, clip_note: note,
      filmed: new Date(file.lastModified).toISOString(), uploaded,
    });
    if (failed) {
      setError(submitError(failed.message));
      return;
    }
    setSubmitted(true);
  }

  if (!file) {
    return (
      <section className={`card stack ${styles.pick} ${dragging ? styles.dragging : ""}`}>
        <p className={styles.dropHint}>{dragging ? "Drop it anywhere" : "Drag a video here, or choose one"}</p>
        <p className="soft">Use the original video, side-on, with you large in the frame.</p>
        <label className="button primary">
          Choose a video
          <input type="file" accept="video/*,.mp4,.mov,.m4v" onChange={choose} className={styles.hiddenInput} />
        </label>
        <Link href="/guide">How to film a good clip</Link>
        {refusal ? <p role="alert" className="error">{refusal}</p> : null}
      </section>
    );
  }

  const long = facts ? needsSection(facts.duration) : false;
  const end = facts ? sectionEnd(sectionStart, facts.duration) : 0;

  return (
    <div className={styles.flow}>
      <div className={styles.stage}>
        <div className={styles.scroller}>
          <div className={styles.frame} style={{ width: `${zoom * 100}%` }}>
            {objectUrl ? (
              <video ref={video} src={objectUrl} muted playsInline preload="auto" onLoadedMetadata={loaded} onError={() => setCannotShow(true)} />
            ) : null}
            {facts ? (
              <button type="button" className={styles.tapLayer} onClick={tapFrame} aria-label="Tap yourself on this frame">
                {tap ? <span className={styles.ring} style={{ left: `${tap.x * 100}%`, top: `${tap.y * 100}%` }} /> : null}
              </button>
            ) : null}
          </div>
        </div>
        {cannotShow ? (
          <p className={styles.stageNote}>This browser can&apos;t show this video. Carry on, and we&apos;ll ask you to tap yourself after it uploads. Only the first 60 seconds are analysed.</p>
        ) : null}
      </div>

      <section className={`card stack ${styles.controls}`} aria-label="Choose your frame">
        {long && facts ? (
          <label className="field">
            Your 60 seconds start at {clockTime(sectionStart)}
            <input type="range" className={styles.range} min={0} max={lastSectionStart(facts.duration)} step={1} value={sectionStart} onChange={(e) => moveSection(Number(e.target.value))} />
          </label>
        ) : null}
        {facts ? (
          <>
            <label className="field">
              Drag to a clear frame, then tap yourself
              <input type="range" className={styles.range} min={sectionStart} max={end} step={0.1} value={frameTime} onChange={(e) => seek(Number(e.target.value))} />
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
        ) : null}
        {facts && looksCompressed(file.name, facts) ? (
          <p className={styles.caution}>This looks like a compressed copy, such as one sent over WhatsApp. Ask whoever filmed it for the original for a better result. You can still carry on.</p>
        ) : null}
      </section>

      <section className={`card ${styles.setup}`} aria-label="Your boat">
        <label className="field">
          Boat
          <select value={setup.boat} onChange={(e) => setSetup(fitSetup({ ...setup, boat: e.target.value }))}>
            {Object.keys(BOAT_SEATS).map((boat) => <option key={boat} value={boat}>{BOAT_NAMES[boat]}</option>)}
          </select>
        </label>
        <label className="field">
          Side
          <select value={setup.side} onChange={(e) => setSetup({ ...setup, side: e.target.value })}>
            {sidesFor(setup.boat).map((side) => <option key={side} value={side}>{SIDE_NAMES[side]}</option>)}
          </select>
        </label>
        <label className="field">
          Your seat
          <select value={setup.seat} onChange={(e) => setSetup({ ...setup, seat: Number(e.target.value) })}>
            {seatsFor(setup.boat).map((seat) => <option key={seat} value={seat}>{seat}</option>)}
          </select>
        </label>
        <label className="field">
          Note, if you like
          <input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="Saturday steady state" />
        </label>
      </section>

      <section className={`card stack ${styles.send}`} aria-label="Upload">
        <div className={styles.row}>
          <strong>{uploaded ? "Uploaded" : `Uploading ${Math.round(share * 100)}%`}</strong>
          <button type="button" className="button quiet" onClick={reset} disabled={submitted}>Change video</button>
        </div>
        <progress className={styles.bar} max={1} value={share} aria-label="Upload progress" />
        {uploaded ? null : <p className="soft">Keep this page open until it finishes.</p>}
        {uploadFailed ? (
          <>
            <p role="alert" className="error">The upload stopped. Check your connection, then try again. It carries on from where it stopped.</p>
            <button type="button" className="button quiet" onClick={() => { setUploadFailed(false); upload.current?.start(); }}>Try again</button>
          </>
        ) : null}
        {error ? <p role="alert" className="error">{error}</p> : null}
        <button type="button" className="button primary" onClick={submit} disabled={submitted}>
          {submitted ? "Finishing your upload" : "Analyse"}
        </button>
      </section>
    </div>
  );
}

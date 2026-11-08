"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Upload } from "tus-js-client";
import { refuseFile, submitError } from "@/lib/clip-checks";
import type { Setup } from "@/lib/setup";
import { browserClient, type Connection } from "@/lib/supabase/browser";
import { clipIdFor, forgetUpload, startUpload } from "@/lib/upload";
import { ClipForm, PickCard, freshChoice, useVideoDrop } from "./clip-form";
import styles from "./add.module.css";

type Props = { userId: string; setup: Setup; connection: Connection };

export function AddFlow({ userId, setup: saved, connection }: Props) {
  const router = useRouter();
  const upload = useRef<Upload | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [clipId, setClipId] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [choice, setChoice] = useState(() => freshChoice(saved));
  const [share, setShare] = useState(0);
  const [uploaded, setUploaded] = useState(false);
  const [uploadFailed, setUploadFailed] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dragging = useVideoDrop(file ? null : (picked) => void take(picked));

  useEffect(() => () => void upload.current?.abort(), []);

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
    upload.current = startUpload({
      file: picked, url: connection.url, anonKey: connection.anonKey, token,
      path: `${userId}/${id}/source`,
      onProgress: setShare,
      onDone: () => { setUploaded(true); setUploadFailed(false); },
      onError: () => setUploadFailed(true),
    });
  }

  function reset() {
    upload.current?.abort();
    setFile(null); setClipId(null); setShare(0); setUploaded(false); setUploadFailed(false); setRefusal(null);
    setChoice((old) => freshChoice(old.setup));
  }

  async function submit() {
    if (!file || !clipId) return;
    setError(null);
    const { facts, trim, tap, setup, note } = choice;
    const { error: failed } = await browserClient(connection).rpc("submit_clip", {
      clip: clipId, boat: setup.boat, rowing_side: setup.side, seat_number: setup.seat,
      section_start: trim.start, section_length: facts ? trim.end - trim.start : null, tap_point: tap, clip_note: note,
      filmed: new Date(file.lastModified).toISOString(), uploaded,
    });
    if (failed) {
      setError(submitError(failed.message));
      return;
    }
    setSubmitted(true);
  }

  if (!file) {
    return <PickCard dragging={dragging} refusal={refusal} guide={<Link href="/guide">How to film a good clip</Link>} onFile={(picked) => void take(picked)} />;
  }

  return (
    <ClipForm
      file={file}
      choice={choice}
      onChange={setChoice}
      onRefuse={(message) => { reset(); setRefusal(message); }}
      cannotShowNote="This browser can't show this video. Carry on, and we'll ask you to tap yourself after it uploads. Only the first 60 seconds are analysed."
    >
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
    </ClipForm>
  );
}

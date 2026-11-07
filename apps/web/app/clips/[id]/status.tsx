"use client";

import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";
import { placeText, waitText, minutesLeft, type JobState } from "@/lib/waiting";
import { cancel } from "./actions";
import styles from "./clip.module.css";

type Props = {
  clip: string;
  state: JobState;
  stage: string | null;
  progress: number | null;
  place: number | null;
  seconds: number | null;
  online: boolean;
};

const REFRESH_MS = 4000;

export function Status({ clip, state, stage, progress, place, seconds, online }: Props) {
  const router = useRouter();
  const [cancelling, startCancel] = useTransition();

  useEffect(() => {
    const timer = setInterval(() => router.refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [router]);

  const title = state === "uploading" ? "Still uploading" : state === "queued" ? placeText(place) : stage ?? "Getting ready";
  return (
    <section className="card stack" aria-live="polite">
      <h2 style={{ fontSize: 24 }}>{title}</h2>
      {state === "running" && progress !== null ? (
        <progress className={styles.bar} max={1} value={progress} aria-label="Analysis progress" />
      ) : null}
      {online ? (
        <p className="soft">{waitText(minutesLeft(place, seconds, progress))}. You can leave this page, and we&apos;ll email you when it&apos;s ready.</p>
      ) : (
        <p className={styles.caution}>Analysis is paused at the moment. Your clip is safe in the queue and will carry on by itself.</p>
      )}
      <button type="button" className="button quiet" disabled={cancelling} onClick={() => startCancel(() => cancel(clip))}>
        {cancelling ? "Cancelling" : "Cancel"}
      </button>
    </section>
  );
}

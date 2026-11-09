import { useEffect, useRef, useState } from "react";
import type { ClipDetail } from "../shared/bridge";
import { size } from "./format";
import styles from "./send.module.css";

type Step = "ask" | "sending" | "sent" | "failed";

/** Send A: what is and isn't sent, an optional note, two ticks, then progress and thanks. */
export function SendClip({ clip, onSent }: { clip: ClipDetail; onSent: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [ready, setReady] = useState(false);
  const [step, setStep] = useState<Step>("ask");
  const [note, setNote] = useState("");
  const [adult, setAdult] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [progress, setProgress] = useState({ sent: 0, total: clip.videoBytes });

  useEffect(() => {
    void window.rowvision.canSend().then(setReady);
    return window.rowvision.onSendProgress((next) => { if (next.id === clip.id) setProgress(next); });
  }, [clip.id]);

  if (!ready || clip.state !== "done" || !clip.hasVideo) return clip.sentAt ? <SentMark /> : null;
  const seconds = clip.summary ? Math.round(clip.summary.frames / clip.summary.fps) : null;

  async function send() {
    setStep("sending");
    try {
      await window.rowvision.sendClip(clip.id, { note, adult, allowed });
      setStep("sent");
      onSent();
    } catch {
      setStep("failed");
    }
  }

  function open() {
    if (step !== "sending") setStep(clip.sentAt && step !== "failed" ? "sent" : "ask");
    dialog.current?.showModal();
  }

  return (
    <span className={styles.actions}>
      {clip.sentAt ? <SentMark /> : null}
      <button type="button" className="button quiet" onClick={open}>Send this clip</button>
      <dialog ref={dialog} className={styles.dialog} aria-labelledby="send-title">
        {step === "ask" || step === "failed" ? (
          <form method="dialog" className={styles.body} onSubmit={(event) => { event.preventDefault(); void send(); }}>
            <h2 id="send-title">Send this clip to help RowVision learn</h2>
            <div className={styles.facts}>
              <div>
                <strong>What is sent</strong>
                <span>{seconds ? `The ${seconds} seconds you analysed, ` : "The part you analysed, "}{size(clip.videoBytes)}<br />Boat, side and seat<br />These results</span>
              </div>
              <div>
                <strong>Never sent</strong>
                <span>Your name or email<br />Your other clips<br />Anything else on this computer</span>
              </div>
            </div>
            <label className="field">
              Anything wrong with the results? (optional)
              <textarea rows={3} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="For example: it followed seat 4, or the catch marks look late" />
            </label>
            <label className={styles.agree}><input type="checkbox" checked={adult} onChange={() => setAdult(!adult)} />Everyone who can be recognised in the clip is 18 or over.</label>
            <label className={styles.agree}><input type="checkbox" checked={allowed} onChange={() => setAllowed(!allowed)} />I filmed it, or the people in it are happy for it to be used to improve RowVision.</label>
            {step === "failed" ? <p role="alert" className="error">Sending stopped. Check your connection, then try again.</p> : null}
            <div className={styles.buttons}>
              <button type="button" className="button quiet" onClick={() => dialog.current?.close()}>Not now</button>
              <button type="submit" className="button primary" disabled={!adult || !allowed}>{step === "failed" ? "Try again" : "Send clip"}</button>
            </div>
          </form>
        ) : step === "sending" ? (
          <div className={styles.body}>
            <h2 id="send-title">Sending</h2>
            <progress className={styles.bar} max={progress.total || 1} value={progress.sent} aria-label="Sending progress" />
            <p className="soft">{size(progress.sent)} of {size(progress.total)}. You can close this box: it carries on in the background.</p>
            <div className={styles.buttons}><button type="button" className="button quiet" onClick={() => dialog.current?.close()}>Close</button></div>
          </div>
        ) : (
          <div className={styles.body}>
            <h2 id="send-title">Sent. Thank you</h2>
            <p className="soft">Your clip helps RowVision measure more crews well.</p>
            <div className={styles.buttons}><button type="button" className="button primary" onClick={() => dialog.current?.close()}>Done</button></div>
          </div>
        )}
      </dialog>
    </span>
  );
}

function SentMark() {
  return (
    <span className={styles.sent}>
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5 9-10" /></svg>
      Sent to RowVision
    </span>
  );
}

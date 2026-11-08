import { useEffect, useState } from "react";
import { ClipForm, PickCard, freshChoice, useVideoDrop, type Choice } from "@/app/add/clip-form";
import styles from "@/app/add/add.module.css";

const VIDEO_NAME = /\.(mp4|mov|m4v|avi|mkv|webm|mts|m2ts|3gp)$/i;

/** No size limit here, as nothing is uploaded. */
function refuse(file: File): string | null {
  return file.type.startsWith("video/") || VIDEO_NAME.test(file.name) ? null : "That file isn't a video. Choose a video from this computer.";
}

export function AddPage() {
  const [choice, setChoice] = useState<Choice | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dragging = useVideoDrop(file ? null : take);

  useEffect(() => {
    let live = true;
    void window.rowvision.getSetup().then((setup) => { if (live) setChoice(freshChoice(setup)); });
    return () => { live = false; };
  }, []);

  function take(picked: File) {
    const problem = refuse(picked) ?? (window.rowvision.pathForFile(picked) ? null : "That file can't be read. Save it to this computer first.");
    setRefusal(problem);
    if (!problem) setFile(picked);
  }

  function reset() {
    setFile(null);
    setError(null);
    setChoice((old) => (old ? freshChoice(old.setup) : old));
  }

  async function save() {
    if (!file || !choice) return;
    setSaving(true);
    setError(null);
    const { facts, trim, tap, setup, note } = choice;
    try {
      const id = await window.rowvision.addClip({
        source: window.rowvision.pathForFile(file),
        filmedAt: new Date(file.lastModified).toISOString(),
        setup,
        note,
        section: { start: facts ? trim.start : 0, length: facts ? trim.end - trim.start : null },
        tap,
      });
      window.location.hash = `#/analysis/${id}`;
    } catch {
      setError("We couldn't add this clip. Check the video is still there, then try again.");
      setSaving(false);
    }
  }

  if (!choice) return <p aria-busy="true">Loading…</p>;

  return (
    <>
      <h1 style={{ fontSize: 32 }}>Add a video</h1>
      {!file ? (
        <PickCard dragging={dragging} refusal={refusal} guide={null} onFile={take} />
      ) : (
        <ClipForm
          file={file}
          choice={choice}
          onChange={setChoice}
          onRefuse={(message) => { reset(); setRefusal(message); }}
          cannotShowNote="This video can't be shown here, but it can still be analysed. Carry on, and we'll ask you to tap yourself during analysis. Only the first 60 seconds are analysed."
        >
          <section className={`card stack ${styles.send}`} aria-label="Add the clip">
            <div className={styles.row}>
              <strong>{file.name}</strong>
              <button type="button" className="button quiet" onClick={reset} disabled={saving}>Change video</button>
            </div>
            <p className="soft">The video stays where it is and is read from there, so keep it until the clip is analysed.</p>
            {error ? <p role="alert" className="error">{error}</p> : null}
            <button type="button" className="button primary" onClick={save} disabled={saving}>
              {saving ? "Adding" : "Add to your clips"}
            </button>
          </section>
        </ClipForm>
      )}
    </>
  );
}

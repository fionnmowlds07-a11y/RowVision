import { useState } from "react";
import { PRESETS, textOn } from "@/lib/colours";
import type { Colours, Welcome } from "../shared/bridge";
import { size } from "./format";
import styles from "./welcome.module.css";

type Props = {
  welcome: Welcome;
  colours: Colours;
  save: (ground: string | null, highlight: string | null) => Promise<void>;
  /** Called once the welcome is finished, to show the add page. */
  done: () => void;
};

const STEPS = 3;

/** First run A from #150: where clips are kept, colours, then whether measuring is ready. */
export function WelcomePage({ welcome: first, colours, save, done }: Props) {
  const [step, setStep] = useState(1);
  const [welcome, setWelcome] = useState(first);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ground = colours.ground ?? PRESETS[0].ground;
  const highlight = colours.highlight ?? PRESETS[0].highlight;

  async function changeFolder() {
    setBusy(true);
    try {
      const result = await window.rowvision.changeClipsFolder();
      setWelcome(result.welcome);
      setProblem(result.problem);
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    setBusy(true);
    await window.rowvision.finishWelcome();
    done();
  }

  return (
    <div className={styles.page}>
      <section className={styles.card} aria-labelledby="welcome-title">
        <div className={styles.top}>
          <p>Step {step} of {STEPS}</p>
          <div className={styles.dots} aria-hidden="true">
            {[1, 2, 3].map((n) => <span key={n} className={n <= step ? styles.on : undefined} />)}
          </div>
        </div>

        {step === 1 ? (
          <>
            <h1 id="welcome-title">Welcome to RowVision</h1>
            <p className={styles.soft}>Your clips are measured on this computer. Nothing leaves it unless you press Send on a clip.</p>
            <div className={styles.box}>
              <div className={styles.folder}>
                <span className={styles.small}>Clips are kept in</span>
                <strong data-testid="clips-folder">{welcome.clipsDir}</strong>
                <span className={styles.small}>
                  {welcome.freeBytes !== null ? `${size(welcome.freeBytes)} free. ` : ""}A clip uses about 40 to 150 MB.
                </span>
              </div>
              <button type="button" className={`button ${styles.quiet}`} disabled={busy || !welcome.canMove} onClick={() => void changeFolder()}>Change</button>
            </div>
            {problem ? <p role="alert" className={styles.problem}>{problem}</p> : null}
          </>
        ) : null}

        {step === 2 ? (
          <>
            <h1 id="welcome-title">Pick your colours</h1>
            <p className={styles.soft}>Start from the club greens. You can change them any time in Settings.</p>
            <div className={styles.swatches}>
              {PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  type="button"
                  className={styles.swatch}
                  style={{ background: preset.ground, color: textOn(preset.ground) }}
                  aria-pressed={preset.ground === ground && preset.highlight === highlight}
                  onClick={() => void save(preset.ground, preset.highlight)}
                >
                  <span style={{ background: preset.highlight }} aria-hidden="true" />
                  {preset.name}
                </button>
              ))}
            </div>
          </>
        ) : null}

        {step === 3 ? (
          <>
            <h1 id="welcome-title">Get the measuring ready</h1>
            {welcome.engineMissing ? (
              <>
                <p className={styles.soft}>RowVision measures with a program and models of about 180 MB. They aren&apos;t included in this test version yet.</p>
                <div className={styles.box} data-testid="measuring">
                  <div className={styles.folder}>
                    <strong>Not ready yet</strong>
                    <span className={styles.small}>You can still add videos. They wait in your list, and are measured once the measuring part is installed.</span>
                  </div>
                </div>
              </>
            ) : (
              <>
                <p className={styles.soft}>Everything needed to measure is on this computer. It works without the internet.</p>
                <div className={styles.box} data-testid="measuring">
                  <div className={styles.row}><span>Ready</span><strong>100%</strong></div>
                  <div className={styles.bar} aria-hidden="true"><span /></div>
                </div>
              </>
            )}
            <p className={styles.small}>Analysis works best on a laptop that is plugged in. A 30 second clip takes about 10 minutes.</p>
          </>
        ) : null}

        <div className={styles.buttons}>
          {step > 1 ? <button type="button" className={`button ${styles.quiet}`} onClick={() => setStep(step - 1)}>Back</button> : <span />}
          {step < STEPS ? (
            <button type="button" className="button primary" onClick={() => { setProblem(null); setStep(step + 1); }}>Next</button>
          ) : (
            <button type="button" className="button primary" disabled={busy} onClick={() => void finish()}>Add your first video</button>
          )}
        </div>
      </section>
    </div>
  );
}

import styles from "./guide.module.css";

/** Shared by the website and the desktop app. */
const STEPS = [
  ["Film side-on", "Stay directly alongside the boat. The further off side-on, the less reliable the angles, and legs suffer most."],
  ["Fill the frame", "The rower should look large. The boat should fill most of the frame width, or use the zoom before you start."],
  ["Get at least 10 strokes", "Hold the shot for 30 seconds or more. One minute is plenty."],
  ["Film from the blade's side", "Stay on the same side as the rower's blade, so that nothing in the boat hides them."],
  ["Send the original", "Apps like WhatsApp shrink videos, and that costs accuracy. Share the original file instead."],
] as const;

export function GuideSteps() {
  return (
    <>
      <svg className={styles.plan} viewBox="0 0 320 130" role="img" aria-label="Seen from above: the launch runs level with the boat, with the camera pointing straight across at the rower">
        <rect x="30" y="24" width="260" height="14" rx="7" className={styles.boat} />
        <rect x="120" y="96" width="80" height="22" rx="8" className={styles.launch} />
        <path d="M160 94 V46" className={styles.sight} />
        <path d="M153 54 L160 44 L167 54" className={styles.sight} />
        <text x="160" y="16" textAnchor="middle">Boat</text>
        <text x="210" y="112">Launch, level with the boat</text>
      </svg>
      <ol className={styles.steps}>
        {STEPS.map(([title, text]) => (
          <li key={title} className="card">
            <h2>{title}</h2>
            <p className="soft">{text}</p>
          </li>
        ))}
      </ol>
    </>
  );
}

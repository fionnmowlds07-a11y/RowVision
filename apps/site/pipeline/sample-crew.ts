// A made-up crew for the sample statistics sheet on the site. Nobody rowed these strokes and no clip was measured.
// The angles are written first and every figure is read back from them, scored by the engine's own rules,
// so the sample hangs together the way a real sheet does.
import type { FrameData, Metric, Rower, Stroke } from "@/lib/result";
import { statsReport, statsRowers, type Stats } from "../../desktop/src/renderer/stats-report";

const FPS = 50;
const STROKES = 18;
const CYCLE = 107; // 28 strokes a minute

type Person = {
  seat: number; catchLean: number; finishLean: number; drift: [number, number]; catchKnee: number; finishKnee: number; catchElbow: number; finishElbow: number;
  drive: number; legs: [number, number]; back: [number, number]; arms: [number, number]; over: [number, number]; late: number; steadiness: number; length: number; accuracy: number;
};

/** Four rowers with one thing each to talk about: stroke is sound, 3 opens early, 2 is short and late, bow over-reaches the finish as the piece goes on. */
const CREW: Person[] = [
  { seat: 4, catchLean: 27.3, finishLean: -25.9, drift: [-0.6, -0.5], catchKnee: 53.5, finishKnee: 168.6, catchElbow: 169, finishElbow: 62, drive: 47, legs: [0.0, 0.72], back: [0.08, 0.92], arms: [0.5, 1], over: [0.08, 0.54], late: 0, steadiness: 1, length: 1.62, accuracy: 93 },
  { seat: 3, catchLean: 31.6, finishLean: -24.1, drift: [-0.8, -0.4], catchKnee: 56, finishKnee: 167.2, catchElbow: 166, finishElbow: 67, drive: 48, legs: [0.03, 0.82], back: [-0.05, 0.78], arms: [0.5, 1], over: [0.05, 0.5], late: 1, steadiness: 1.4, length: 1.55, accuracy: 89 },
  { seat: 2, catchLean: 21.6, finishLean: -19.2, drift: [-1.7, 1.2], catchKnee: 63, finishKnee: 164.4, catchElbow: 172, finishElbow: 69, drive: 45, legs: [0.0, 0.7], back: [0.1, 0.9], arms: [0.55, 1], over: [0.14, 0.7], late: 3, steadiness: 2.1, length: 1.41, accuracy: 86 },
  { seat: 1, catchLean: 26.8, finishLean: -28.7, drift: [-0.6, -5.2], catchKnee: 57, finishKnee: 170.3, catchElbow: 164, finishElbow: 58, drive: 54, legs: [0.0, 0.64], back: [0.07, 0.95], arms: [0.42, 0.97], over: [0.1, 0.46], late: -2, steadiness: 1.7, length: 1.68, accuracy: 82 },
];

const target = (low: number, high: number | null) => ({ low, high, sources: [], evidence: "sample" });
const TARGETS = { catch: target(26, 31), finish: target(-25, -20), catchKnee: target(50, 55), finishKnee: target(167, 172), catchShin: target(-2, 2), legsLead: target(0, null), driveShare: target(0.385, 0.485) };

/** The engine's scoring: 100 inside the target, down a straight line to 0 at `falloff` outside it. */
const score = (value: number, { low, high }: { low: number; high: number | null }, falloff: number) =>
  Math.max(0, 100 * (1 - Math.max(0, low - value, high === null ? 0 : value - high) / falloff));

function ease(at: number, from: number, to: number): number {
  if (at <= from) return 0;
  if (at >= to) return 1;
  return (1 - Math.cos(Math.PI * ((at - from) / (to - from)))) / 2;
}

/** The same numbers every time the sample is made. */
function dice(seed: number): () => number {
  let state = seed;
  return () => { state = (state * 1664525 + 1013904223) % 4294967296; return state / 2147483648 - 1; };
}

const median = (values: number[]) => { const s = [...values].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
/** Half the middle half, as the engine gives a spread. */
const spread = (values: number[]) => { const s = [...values].sort((a, b) => a - b); return (s[Math.floor(s.length * 0.75)] - s[Math.floor(s.length * 0.25)]) / 2; };

function build(person: Person, leadCatches: number[] | null): { rower: Rower; angles: { trunk: number[]; knee: number[]; elbow: number[] }; catches: number[] } {
  const roll = dice(person.seat * 7919);
  const total = CYCLE * (STROKES + 1);
  const [trunk, knee, elbow] = [new Array<number>(total + 40).fill(NaN), new Array<number>(total + 40).fill(NaN), new Array<number>(total + 40).fill(NaN)];
  const catches = Array.from({ length: STROKES + 1 }, (_, n) => 20 + n * CYCLE + person.late + Math.round(roll() * 1.1));
  const strokes: Stroke[] = [];
  const own = Array.from({ length: 8 }, roll);
  const seen = Array.from({ length: STROKES + 1 }, (_, n) => {
    const tired = n < STROKES / 2 ? -0.5 : 0.5;
    return { catchLean: person.catchLean + tired * person.drift[0] + roll() * 2.4, finishLean: person.finishLean + tired * person.drift[1] + roll() * 2.1, knee: person.catchKnee + roll() * 2, shift: roll() * 0.035, drive: person.drive + Math.round(roll() * 0.9) };
  });
  for (let n = 0; n < STROKES; n += 1) {
    const [start, next] = [catches[n], catches[n + 1]];
    const me = seen[n];
    const finish = start + me.drive;
    for (let frame = start; frame < next; frame += 1) {
      if (frame <= finish) {
        const at = (frame - start) / (finish - start);
        knee[frame] = me.knee + (person.finishKnee - me.knee) * ease(at, person.legs[0], person.legs[1]);
        trunk[frame] = me.catchLean + (me.finishLean - me.catchLean) * ease(at, person.back[0] + me.shift, person.back[1] + me.shift / 2);
        elbow[frame] = person.catchElbow + (person.finishElbow - person.catchElbow) * ease(at, person.arms[0], person.arms[1]);
      } else {
        const at = (frame - finish) / (next - finish);
        const ahead = seen[n + 1];
        elbow[frame] = person.finishElbow + (person.catchElbow - person.finishElbow) * ease(at, 0, 0.3);
        trunk[frame] = me.finishLean + (ahead.catchLean - me.finishLean) * ease(at, person.over[0], person.over[1]);
        knee[frame] = person.finishKnee + (ahead.knee - person.finishKnee) * ease(at, 0.34, 0.97);
      }
    }
    // Nobody moves in a smooth curve, and no joint is read perfectly: a wobble of the rower's own, and one for this stroke.
    for (let frame = start; frame < next; frame += 1) {
      const at = (frame - start) / (next - start);
      const fade = Math.sin(Math.PI * at) ** 0.7;
      const wave = (size: number, k: number) => size * fade * (Math.sin(2 * Math.PI * (k * at + own[k])) + 0.5 * Math.sin(2 * Math.PI * ((k + 4) * at + own[k + 1])) + 0.9 * Math.sin(2 * Math.PI * ((k + 1) * at + me.drive * 0.37 + n * 0.61)));
      trunk[frame] += wave(0.9, 3) + roll() * 0.8;
      knee[frame] += wave(2, 4) + roll() * 1.5;
      elbow[frame] += wave(2.4, 5) + roll() * 2;
    }
    const crosses = (from: number, to: number, share: number) => from + (to - from) * Math.acos(1 - 2 * share) / Math.PI;
    strokes.push({
      catch_frame: start, finish_frame: finish, next_catch_frame: next, catch_lean_deg: me.catchLean, finish_lean_deg: me.finishLean, catch_knee_deg: me.knee, finish_knee_deg: person.finishKnee + roll(),
      catch_shin_deg: 0.6 - (person.catchKnee - 53) * 0.55 + roll() * 1.5, catch_elbow_deg: person.catchElbow + roll() * 2, finish_elbow_deg: person.finishElbow + roll() * 4, drive_share: me.drive / (next - start), drive_s: me.drive / FPS, recovery_s: (next - finish) / FPS, ratio: (next - finish) / me.drive,
      body_swing_deg: me.catchLean - me.finishLean, stroke_length: person.length + roll() * 0.05, arms_break: crosses(person.arms[0], person.arms[1], 0.15) + roll() * 0.02,
      legs_lead: crosses(person.back[0] + me.shift, person.back[1], 0.15) - crosses(person.legs[0], person.legs[1], 0.15),
    });
  }
  const list = (name: string) => strokes.map((stroke) => stroke[name] as number);
  const metric = (name: string, label: string, phase: string, found: Metric["target"] = null, falloff = 0): Metric => {
    const value = median(list(name));
    return { name, label, phase, value, spread: spread(list(name)), target: found, score: found && falloff ? score(value, found, falloff) : null, reason: null };
  };
  const metrics = [
    metric("catch_lean_deg", "Body angle at the catch", "catch", TARGETS.catch, 10), metric("catch_knee_deg", "Knee angle at the catch", "catch", TARGETS.catchKnee),
    metric("catch_shin_deg", "Shin angle at the catch", "catch", TARGETS.catchShin), metric("legs_lead", "Legs before body", "drive", TARGETS.legsLead, 0.2), metric("finish_lean_deg", "Layback at the finish", "finish", TARGETS.finish, 10),
    metric("finish_knee_deg", "Knee angle at the finish", "finish", TARGETS.finishKnee), metric("drive_share", "Drive and recovery rhythm", "rhythm", TARGETS.driveShare, 0.1),
  ];
  const extras = [["catch_elbow_deg", "catch"], ["finish_elbow_deg", "finish"], ["body_swing_deg", "drive"], ["arms_break", "drive"], ["stroke_length", "drive"], ["drive_s", "rhythm"], ["recovery_s", "rhythm"], ["ratio", "rhythm"]].map(([name, phase]) => metric(name, name, phase));
  extras.push({ ...metric("ratio", "Rate steadiness", "rhythm"), name: "rate_steadiness", value: person.steadiness, spread: null });
  const phases = Object.fromEntries(["catch", "drive", "finish", "rhythm"].map((phase) => [phase, metrics.find((item) => item.phase === phase && item.score !== null)!.score!]));
  const gaps = leadCatches ? strokes.map((stroke, n) => ((stroke.catch_frame - leadCatches[n]) / FPS) * 1000) : [];
  const ends = leadCatches ? strokes.map((stroke, n) => ((stroke.finish_frame - leadCatches[n] - CREW[0].drive) / FPS) * 1000) : [];
  const half = STROKES / 2;
  const fade = Object.fromEntries(["catch_lean_deg", "finish_lean_deg", "body_swing_deg", "catch_knee_deg", "ratio", "stroke_length"].map((name) => [name, median(list(name).slice(half)) - median(list(name).slice(0, half))]));
  return {
    angles: { trunk, knee, elbow }, catches,
    rower: {
      seat: person.seat, rate_spm: (60 * FPS) / CYCLE, catches, finishes: strokes.map((stroke) => stroke.finish_frame), strokes, fade,
      timing: leadCatches ? { leader_seat: 4, catch_ms: median(gaps), finish_ms: median(ends), catch_spread_ms: spread(gaps), finish_spread_ms: spread(ends), strokes: STROKES } : null,
      card: { overall: Object.values(phases).reduce((a, b) => a + b, 0) / 4, phases, metrics, extras },
      rating: { accuracy: person.accuracy, band: person.accuracy >= 90 ? "Excellent" : person.accuracy >= 80 ? "Great" : "Good", calibrated: true, labelled_frames: 0, warnings: [] },
    },
  };
}

export function sampleStats(): Stats {
  const lead = build(CREW[0], null);
  const all = [lead, ...CREW.slice(1).map((person) => build(person, lead.catches))];
  const data: FrameData = { views: null, crew: Object.fromEntries(all.map(({ rower, angles }) => [String(rower.seat), { angles }])) };
  const every = statsRowers(all.map(({ rower }) => rower), data, FPS, CREW.length, null);
  return statsReport("Crew statistics", "Coxless four (4-), made-up sample crew", every, every.map((item) => item.key));
}

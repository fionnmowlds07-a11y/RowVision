// Pure helpers for the viewer, ported from apps/preview/rowvision_preview/static/logic.mjs.

import type { Metric, Pose, Rating, Series, Shot, Stroke, Target } from "./result";

export type Point = { x: number; y: number };
type Marked = Point & { score?: number };
type Box = { left: number; top: number; width: number; height: number };
export type View = { scale: number; x: number; y: number };
type ViewSource = { views?: Series | null; view_deg?: number | null };
type FrameAngles = { trunk: number | null; knee: number | null; elbow: number | null };
type TargetRower = {
  catches: number[];
  finishes: number[];
  card: { metrics: Pick<Metric, "name" | "score" | "target">[] };
  angles: { trunk: Series; knee: Series };
};
type ModelMetric = Pick<Metric, "name" | "label" | "value" | "score"> & { target: { low: number; high: number } };

// COCO-17 joints, as in services/vision/rowvision/skeleton.py.
export const LIMBS = [
  { from: 5, to: 7, side: "left" },
  { from: 7, to: 9, side: "left" },
  { from: 5, to: 11, side: "left" },
  { from: 11, to: 13, side: "left", leg: true },
  { from: 13, to: 15, side: "left", leg: true },
  { from: 6, to: 8, side: "right" },
  { from: 8, to: 10, side: "right" },
  { from: 6, to: 12, side: "right" },
  { from: 12, to: 14, side: "right", leg: true },
  { from: 14, to: 16, side: "right", leg: true },
  { from: 5, to: 6, side: "centre" },
  { from: 11, to: 12, side: "centre" },
];
export const MIN_SCORE = 0.3;

export function clampFrame(frame: number, frames: number) {
  return Math.min(Math.max(Math.round(frame), 0), Math.max(frames - 1, 0));
}

// The nearest marker strictly after (direction 1) or before (direction -1) a frame, or null.
export function nextMarker(frame: number, markers: number[], direction: number) {
  if (direction > 0) return markers.find((marker) => marker > frame) ?? null;
  return markers.findLast((marker) => marker < frame) ?? null;
}

// Each limb with both ends seen. Unsure limbs are kept and flagged, because seeing where the model
// went wrong is the point of this page.
// From this far off side-on, labelled frames showed the legs were often placed badly.
export const UNSURE_LEGS_VIEW_DEG = 25;

export function viewAt(result: ViewSource | null | undefined, frame: number) {
  return result?.views?.[frame] ?? result?.view_deg ?? 0;
}

export function legsUnsure(viewDeg: number) {
  return viewDeg >= UNSURE_LEGS_VIEW_DEG;
}

export function limbSegments(pose: Pose, unsureLegs = false) {
  if (!pose) return [];
  return LIMBS.flatMap(({ from, to, side, leg }) => {
    const start = pose[from];
    const end = pose[to];
    if (!start || !end) return [];
    const sure = Math.min(start[2], end[2]) >= MIN_SCORE && !(leg && unsureLegs);
    return [{ start, end, side, sure }];
  });
}

// Open on something worth checking: the first catch, or else the first frame with a pose.
export function openingFrame(rower: { catches: number[]; poses: Pose[] } | null) {
  if (!rower) return 0;
  return rower.catches[0] ?? Math.max(rower.poses.findIndex(Boolean), 0);
}

export function shotAt(shots: Shot[], frame: number) {
  return shots.find((shot) => shot.start <= frame && frame < shot.end) ?? null;
}

// Convert a pointer position on the scaled canvas to video pixels.
export function toVideoPoint(clientX: number, clientY: number, rect: Box, width: number, height: number) {
  return {
    x: ((clientX - rect.left) / rect.width) * width,
    y: ((clientY - rect.top) / rect.height) * height,
  };
}

// A Poor rating hides the overall score until the viewer accepts that it will mislead them.
export function overallVisible(rating: Pick<Rating, "band">, revealed: boolean) {
  return rating.band !== "Poor" || revealed;
}

// Why a rower has no overall score.
export function overallGap(strokes: number, phases: Record<string, unknown>, minStrokes: number) {
  if (strokes < minStrokes) return `No overall score: it needs at least ${minStrokes} full strokes.`;
  if (Object.keys(phases).length === 0) return "No overall score: nothing could be measured reliably.";
  return "No overall score: it needs both the catch and the finish to be scored.";
}

const isShare = (name: string) => name === "drive_share" || name === "legs_lead";

const isSeconds = (name: string) => name === "drive_s" || name === "recovery_s";

export function formatValue(name: string, value: number | null | undefined) {
  if (value === null || value === undefined) return "not measured";
  if (isShare(name)) return `${Math.round(value * 100)}%`;
  if (isSeconds(name)) return `${value.toFixed(2)} s`;
  if (name === "ratio") return `${value.toFixed(1)} to 1`;
  if (name === "rate_steadiness") return `within ${Math.max(Math.round(value), 1)}%`;
  if (name === "arms_break") return `${Math.round(value * 100)}% through the drive`;
  if (name === "stroke_length") return `${value.toFixed(1)} trunk lengths`;
  return `${Math.round(Math.abs(value))}°${leanWord(name, value)}`;
}

/** A change in a measure between two halves of a clip or two clips, in the measure's own units. */
export function formatChange(name: string, change: number | null | undefined) {
  if (change === null || change === undefined) return "not measured";
  const size = Math.abs(change);
  const word = change > 0 ? "more" : "less";
  if (isSeconds(name)) return size < 0.005 ? "same" : `${size.toFixed(2)} s ${word}`;
  if (name === "ratio" || name === "stroke_length") return size < 0.05 ? "same" : `${size.toFixed(1)} ${word}`;
  if (isShare(name) || name === "arms_break") return Math.round(size * 100) === 0 ? "same" : `${Math.round(size * 100)}% ${word}`;
  if (name === "rate_steadiness") return Math.round(size) === 0 ? "same" : `${Math.round(size)}% ${word}`;
  // Layback is stored as a negative lean, so a bigger layback is a smaller number.
  const degrees = Math.round(size);
  if (degrees === 0) return "same";
  return `${degrees}° ${name === "finish_lean_deg" ? (change < 0 ? "more" : "less") : word}`;
}

function leanWord(name: string, value: number) {
  if (!name.includes("lean")) return "";
  return value < 0 ? " back" : " forward";
}

export function formatTarget(name: string, target: Pick<Target, "low" | "high"> | null) {
  if (!target) return "no target";
  const { low, high } = target;
  if (high === null) return `at least ${formatValue(name, low)}`;
  if (name.includes("lean") && low < 0) {
    return `${Math.round(Math.abs(high))}–${Math.round(Math.abs(low))}° back`;
  }
  if (name.includes("lean")) return `${Math.round(low)}–${Math.round(high)}° forward`;
  if (isShare(name)) return `${Math.round(low * 100)}–${Math.round(high * 100)}%`;
  return `${Math.round(low)}–${Math.round(high)}°`;
}

// One frame per stroke, at the exact moment the measure was read.
export function evidenceFrames(name: string, strokes: Stroke[]) {
  const key = name.startsWith("finish") ? "finish_frame" : "catch_frame";
  return strokes.map((stroke, index) => ({
    stroke: index + 1,
    frame: stroke[key],
    value: stroke[name] ?? null,
  }));
}

export function sourceLink(source: string) {
  if (source.startsWith("http")) return { href: source, label: new URL(source).hostname };
  return { href: `https://pubmed.ncbi.nlm.nih.gov/${source}/`, label: `PubMed ${source}` };
}

function middle(pose: NonNullable<Pose>, left: number, right: number): Marked | null {
  const a = pose[left];
  const b = pose[right];
  if (!a || !b) return null;
  return { x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, score: Math.min(a[2], b[2]) };
}

function mark(
  kind: string, vertex: Marked | null, a: Marked | null, b: Marked | null,
  value: number | null | undefined, label: string,
) {
  if (!vertex || !a || !b || value === null || value === undefined) return [];
  const sure = Math.min(vertex.score ?? 1, a.score ?? 1, b.score ?? 1) >= MIN_SCORE;
  return [{ kind, vertex, a, b, label, sure }];
}

// The angles to draw on one frame. Labels use the measured value, which is corrected for camera
// view, while the arcs follow the image, so the two can differ on oblique shots.
// The joint nearest the camera, as the engine reads the knee and elbow from that side alone. A rower
// facing right shows their right side, facing left their left. With no facing known, the pair's
// centre is used.
function near(pose: NonNullable<Pose>, left: number, right: number, facing: number): Marked | null {
  if (!facing) return middle(pose, left, right);
  const joint = pose[facing < 0 ? left : right];
  return joint ? { x: joint[0], y: joint[1], score: joint[2] } : null;
}

export function angleMarks(pose: Pose, angles: FrameAngles, unsureLegs = false, facing = 0) {
  if (!pose) return [];
  const shoulder = middle(pose, 5, 6);
  const hip = middle(pose, 11, 12);
  const above = hip && { x: hip.x, y: hip.y - 30 };
  const [nearShoulder, elbow, wrist] = [5, 7, 9].map((left) => near(pose, left, left + 1, facing));
  const [nearHip, knee, ankle] = [11, 13, 15].map((left) => near(pose, left, left + 1, facing));
  return [
    ...mark("trunk", hip, above, shoulder, angles.trunk, formatValue("lean", angles.trunk)),
    ...mark("knee", knee, nearHip, ankle, angles.knee, formatValue("knee", angles.knee))
      .map((item) => ({ ...item, sure: item.sure && !unsureLegs })),
    ...mark("elbow", elbow, nearShoulder, wrist, angles.elbow, formatValue("elbow", angles.elbow)),
  ];
}

// Frames either side of a catch or finish that still show its target, so it can be seen in play.
export const TARGET_WINDOW = 2;

function phaseAt(frame: number, rower: TargetRower) {
  const near = (frames: number[]) => frames.some((marker) => Math.abs(marker - frame) <= TARGET_WINDOW);
  if (near(rower.catches)) return "catch";
  return near(rower.finishes) ? "finish" : null;
}

function scoredTarget(rower: TargetRower, name: string) {
  const metric = rower.card.metrics.find((item) => item.name === name);
  return metric && metric.score !== null ? metric.target : null;
}

/** Which way the rower faces on a frame: the other way in stretches filmed from the far side of the boat. */
export function facingAt(facing: number, otherSide: number[][], frame: number) {
  return otherSide.some(([start, end]) => frame >= start && frame < end) ? -facing : facing;
}

function trunkEdge(hip: Point, shoulder: Point, degrees: number, facing: number, squeeze: number) {
  const length = Math.hypot((shoulder.x - hip.x) / squeeze, shoulder.y - hip.y);
  const lean = (degrees * Math.PI) / 180;
  return {
    x: hip.x + facing * Math.sin(lean) * length * squeeze,
    y: hip.y - Math.cos(lean) * length,
  };
}

function shinEdge(knee: Point, hip: Point, ankle: Point, degrees: number, squeeze: number) {
  const thigh = { x: (hip.x - knee.x) / squeeze, y: hip.y - knee.y };
  const shin = { x: (ankle.x - knee.x) / squeeze, y: ankle.y - knee.y };
  const side = thigh.x * shin.y - thigh.y * shin.x < 0 ? -1 : 1;
  const turn = Math.atan2(thigh.y, thigh.x) + (side * degrees * Math.PI) / 180;
  const length = Math.hypot(shin.x, shin.y);
  return { x: knee.x + Math.cos(turn) * length * squeeze, y: knee.y + Math.sin(turn) * length };
}

function wedge(
  kind: string, vertex: Point, target: Target, value: number | null | undefined,
  edge: (degrees: number) => Point,
) {
  if (value === null || value === undefined) return [];
  const inside = value >= target.low && value <= (target.high ?? Infinity);
  return [{ kind, vertex, low: edge(target.low), high: edge(target.high ?? target.low), inside }];
}

// Where the trunk and shin should be at a catch or finish, as wedges from the athlete's own joints.
// Only scored measures get one, and targets are squeezed to match a camera that is not side-on.
export function targetMarks(pose: Pose, frame: number, rower: TargetRower, facing: number, viewDeg: number | null | undefined) {
  const phase = pose && phaseAt(frame, rower);
  if (!pose || !phase) return [];
  const squeeze = Math.cos(((viewDeg ?? 0) * Math.PI) / 180);
  const hip = middle(pose, 11, 12);
  const shoulder = middle(pose, 5, 6);
  const knee = middle(pose, 13, 14);
  const ankle = middle(pose, 15, 16);
  const lean = scoredTarget(rower, `${phase}_lean_deg`);
  const bend = scoredTarget(rower, `${phase}_knee_deg`);
  const { trunk, knee: kneeAngles } = rower.angles;
  return [
    ...(lean && hip && shoulder
      ? wedge("trunk", hip, lean, trunk[frame], (degrees: number) =>
          trunkEdge(hip, shoulder, degrees, facing, squeeze))
      : []),
    ...(bend && hip && knee && ankle
      ? wedge("knee", knee, bend, kneeAngles[frame], (degrees: number) =>
          shinEdge(knee, hip, ankle, degrees, squeeze))
      : []),
  ];
}

// Canvas arc settings for the short way round between two rays from a vertex.
export function arcBetween({ vertex, a, b }: { vertex: Point; a: Point; b: Point }) {
  const start = Math.atan2(a.y - vertex.y, a.x - vertex.x);
  const end = Math.atan2(b.y - vertex.y, b.x - vertex.x);
  const turn = Math.atan2(Math.sin(end - start), Math.cos(end - start));
  return { start, end, anticlockwise: turn < 0 };
}

// Views are { scale, x, y }, where x and y are the video pixel at the top left of the canvas.
export const FIT: View = { scale: 1, x: 0, y: 0 };
export const MAX_ZOOM = 12;

export function clampView(view: View, width: number, height: number): View {
  const scale = Math.min(Math.max(view.scale, 1), MAX_ZOOM);
  const limit = (value: number, size: number) => Math.min(Math.max(value, 0), size - size / scale);
  return { scale, x: limit(view.x, width), y: limit(view.y, height) };
}

// Zoom while keeping the video pixel under the pointer in place.
export function zoomAt(view: View, point: Point, factor: number, width: number, height: number) {
  const scale = Math.min(Math.max(view.scale * factor, 1), MAX_ZOOM);
  const shown = (point.x - view.x) * view.scale;
  const shownY = (point.y - view.y) * view.scale;
  return clampView({ scale, x: point.x - shown / scale, y: point.y - shownY / scale }, width, height);
}

export function centreOn(view: View, point: Point, width: number, height: number) {
  const x = point.x - width / view.scale / 2;
  const y = point.y - height / view.scale / 2;
  return clampView({ ...view, x, y }, width, height);
}

export function viewPoint(view: View, unzoomed: Point) {
  return { x: view.x + unzoomed.x / view.scale, y: view.y + unzoomed.y / view.scale };
}

// Where a rower sits on a frame, for following them and for cropping freeze frames.
export function bodyCentre(pose: Pose) {
  if (!pose) return null;
  const seen = pose.filter((joint) => joint !== null);
  if (seen.length === 0) return null;
  const mean = (index: 0 | 1) => seen.reduce((sum, joint) => sum + joint[index], 0) / seen.length;
  return { x: mean(0), y: mean(1) };
}

export function median(values: (number | null | undefined)[]) {
  const known = values.filter((value) => value !== null && value !== undefined).sort((a, b) => a - b);
  if (known.length === 0) return null;
  const half = Math.floor(known.length / 2);
  return known.length % 2 ? known[half] : (known[half - 1] + known[half]) / 2;
}

const REACH = { catch: 0.58, finish: 0.33 } as const;

const middleOf = (target: { low: number; high: number }) => (target.low + target.high) / 2;

// What the 3D model should show for a measure: the target pose, the athlete's pose if it can be
// trusted, and the range to shade. An unreliable angle falls back to the target and says so.
// The model poses the whole body, so it needs both the lean and the knee for that moment.
export function modelFits(name: string, metrics: { name: string }[]) {
  if (!measureKind(name) || name === "finish_elbow_deg") return false;
  const phase = name.startsWith("finish") ? "finish" : "catch";
  return [`${phase}_lean_deg`, `${phase}_knee_deg`].every((needed) => metrics.some((item) => item.name === needed));
}

export function modelRequest(name: string, metrics: ModelMetric[]) {
  const phase = name.startsWith("finish") ? "finish" : "catch";
  const lean = metrics.find((item) => item.name === `${phase}_lean_deg`)!;
  const knee = metrics.find((item) => item.name === `${phase}_knee_deg`)!;
  const reach = REACH[phase];
  const target = { lean: middleOf(lean.target), knee: middleOf(knee.target), reach };
  const usable = (item: ModelMetric) => item.value !== null && item.score !== null;
  const yours = {
    lean: usable(lean) ? lean.value! : target.lean,
    knee: usable(knee) ? knee.value! : target.knee,
    reach,
  };
  const assumed = [lean, knee].filter((item) => !usable(item)).map((item) => item.label);
  const shaded = name.includes("lean") ? "lean" : name.includes("knee") ? "knee" : null;
  const range = shaded === "lean" ? lean.target : shaded === "knee" ? knee.target : null;
  return { phase, target, yours, assumed, shaded, range };
}

// The measure a live angle should open, using the stroke moment nearest the current frame.
export function nearestMeasure(kind: string, frame: number, catches: number[], finishes: number[]) {
  if (kind === "elbow") return "finish_elbow_deg";
  const distance = (markers: number[]) => Math.min(...markers.map((marker) => Math.abs(marker - frame)), Infinity);
  const phase = distance(finishes) < distance(catches) ? "finish" : "catch";
  return `${phase}_${kind === "trunk" ? "lean" : "knee"}_deg`;
}

// Pose positions use X along the boat, Y to the rower's right and Z up. The 3D scene uses Y up.
export function toScene([x, y, z]: number[]) {
  return [x, z, -y];
}

// Which drawn angle belongs to a measure, or null when it has none of its own.
export function measureKind(name: string) {
  if (name.includes("lean")) return "trunk";
  if (name.includes("knee")) return "knee";
  if (name.includes("elbow")) return "elbow";
  return null;
}

// The video takes this share of the width. Past STACK_AT, or on a narrow screen, scores go below.
export const VIDEO_MIN = 40;
export const VIDEO_MAX = 100;
export const VIDEO_DEFAULT = 62;
export const STACK_AT = 76;
export const STACK_WIDTH = 980;

export function videoLayout(share: number, width: number) {
  const video = Math.min(Math.max(Math.round(share), VIDEO_MIN), VIDEO_MAX);
  return { video, stacked: video > STACK_AT || width < STACK_WIDTH };
}

// A share read back from storage may be missing or damaged.
export function savedShare(stored: string | null) {
  const share = Number(stored);
  if (stored === null || !Number.isFinite(share)) return VIDEO_DEFAULT;
  return Math.min(Math.max(share, VIDEO_MIN), VIDEO_MAX);
}

// Where a measure sits on its small lane, as percentages along it. Null when there is nothing to
// place, such as a measure with no target.
export function laneMarks(value: number | null | undefined, target: Pick<Target, "low" | "high"> | null) {
  if (!target || value === null || value === undefined) return null;
  const low = target.low;
  const high = target.high ?? Math.max(low, value) + 0.3;
  const margin = Math.max(high - low, Math.abs(value - (low + high) / 2) * 0.4, 0.01) * 0.75;
  const start = Math.min(low, value) - margin;
  const end = Math.max(high, value) + margin;
  const place = (point: number) => ((point - start) / (end - start)) * 100;
  return { bandStart: place(low), bandWidth: place(high) - place(low), buoy: place(value) };
}

// Each angle's label sits on its own side of the joint, so they do not pile up on small rowers.
export function labelSpot(kind: string, vertex: Point, width: number, height: number, gap: number) {
  if (kind === "trunk") return { x: vertex.x - width - gap, y: vertex.y + gap };
  if (kind === "knee") return { x: vertex.x - width / 2, y: vertex.y - height - gap * 1.6 };
  return { x: vertex.x + gap, y: vertex.y - height / 2 };
}

export function clipTime(frame: number, fps: number) {
  const seconds = Math.floor(frame / fps);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

// Which frame playback should show now. Following the clock keeps real time even when slow frames
// are skipped, so a rower's speed on screen is always true.
export function playbackFrame(start: number, elapsedMs: number, fps: number, speed: number, lastFrame: number) {
  return Math.min(start + Math.floor((elapsedMs / 1000) * fps * speed), lastFrame);
}

// Pressing play at the end starts again from the beginning.
export function playStart(frame: number, lastFrame: number) {
  return frame >= lastFrame ? 0 : frame;
}

// Comparing real rowers is only good to about two frames, so small gaps are not reported as gaps.
export const TIMING_IN_TIME_MS = 50;
export const TIMING_MAX_SPREAD_MS = 70;

export function timingText(gap: number | null | undefined, spread: number | null) {
  if (gap === null || gap === undefined) return "Not enough strokes";
  if (spread === null || spread > TIMING_MAX_SPREAD_MS) return "Too variable to read on this footage";
  if (Math.abs(gap) < TIMING_IN_TIME_MS) return "In time";
  const size = Math.round(Math.abs(gap) / 10) * 10;
  return `About ${size} ms ${gap > 0 ? "late" : "early"}`;
}

export function ratingNote({ calibrated, labelled_frames: frames }: Pick<Rating, "calibrated" | "labelled_frames">) {
  if (calibrated) return `Estimated accuracy, calibrated on ${frames} hand-labelled frames`;
  if (frames) return `Estimated accuracy, based on ${frames} hand-labelled frames so far`;
  return "Estimated accuracy, not yet checked against hand-labelled footage";
}

// Pure helpers for the page, kept apart from the DOM so they can be tested with node --test.

// COCO-17 joints, as in services/vision/rowvision/skeleton.py.
export const LIMBS = [
  { from: 5, to: 7, side: "left" },
  { from: 7, to: 9, side: "left" },
  { from: 5, to: 11, side: "left" },
  { from: 11, to: 13, side: "left" },
  { from: 13, to: 15, side: "left" },
  { from: 6, to: 8, side: "right" },
  { from: 8, to: 10, side: "right" },
  { from: 6, to: 12, side: "right" },
  { from: 12, to: 14, side: "right" },
  { from: 14, to: 16, side: "right" },
  { from: 5, to: 6, side: "centre" },
  { from: 11, to: 12, side: "centre" },
];
export const MIN_SCORE = 0.3;

export function seatOptions(seats) {
  if (seats === 1) return [{ value: 1, label: "1 (single)" }];
  return Array.from({ length: seats }, (_, index) => {
    const seat = index + 1;
    const role = seat === 1 ? " (bow)" : seat === seats ? " (stroke)" : "";
    return { value: seat, label: `${seat}${role}` };
  });
}

export function clampFrame(frame, frames) {
  return Math.min(Math.max(Math.round(frame), 0), Math.max(frames - 1, 0));
}

// The nearest marker strictly after (direction 1) or before (direction -1) a frame, or null.
export function nextMarker(frame, markers, direction) {
  if (direction > 0) return markers.find((marker) => marker > frame) ?? null;
  return markers.findLast((marker) => marker < frame) ?? null;
}

// Each limb with both ends seen. Unsure limbs are kept and flagged, because seeing where the model
// went wrong is the point of this page.
export function limbSegments(pose) {
  if (!pose) return [];
  return LIMBS.flatMap(({ from, to, side }) => {
    const start = pose[from];
    const end = pose[to];
    if (!start || !end) return [];
    return [{ start, end, side, sure: Math.min(start[2], end[2]) >= MIN_SCORE }];
  });
}

// Open on something worth checking: the first catch, or else the first frame with a pose.
export function openingFrame(rower) {
  if (!rower) return 0;
  return rower.catches[0] ?? Math.max(rower.poses.findIndex(Boolean), 0);
}

export function shotAt(shots, frame) {
  return shots.find((shot) => shot.start <= frame && frame < shot.end) ?? null;
}

// Convert a pointer position on the scaled canvas to video pixels.
export function toVideoPoint(clientX, clientY, rect, width, height) {
  return {
    x: ((clientX - rect.left) / rect.width) * width,
    y: ((clientY - rect.top) / rect.height) * height,
  };
}

// The index of the boat nearest a point, matching boat_at() in rowvision/boats.py.
export function boatAt(boats, point) {
  let best = null;
  let bestDistance = Infinity;
  boats.forEach((boat, index) => {
    if (!boat.outline) return;
    const [x1, y1, x2, y2] = boat.outline;
    const dx = point.x - Math.min(Math.max(point.x, x1), x2);
    const dy = point.y - Math.min(Math.max(point.y, y1), y2);
    const distance = Math.hypot(dx, dy);
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  });
  return best;
}

export function boatLabel(boat, number) {
  const people = `${boat.people} ${boat.people === 1 ? "person" : "people"}`;
  return `Boat ${number}: ${people}${boat.too_far ? ", too far" : ""}`;
}

// Some stages cannot report a share done, so show time passing to prove they are not stuck.
export function stageText(job, seconds) {
  if (job.progress === null) return `${job.stage}... ${Math.round(seconds)} s`;
  return `${job.stage}: ${Math.round(job.progress * 100)}%`;
}

export function resultSummary(result) {
  const { seat, catches, finishes, rate_spm: rate } = result.rower;
  const parts = [`Seat ${seat ?? "unknown"}`, `${catches.length} catches`, `${finishes.length} finishes`];
  if (rate) parts.push(`${rate.toFixed(1)} strokes a minute`);
  if (result.view_deg !== null) parts.push(`camera ${Math.round(result.view_deg)}° off side-on`);
  return parts.join(" · ");
}

// A Poor rating hides the overall score until the viewer accepts that it will mislead them.
export function overallVisible(rating, revealed) {
  return rating.band !== "Poor" || revealed;
}

const isShare = (name) => name === "drive_share" || name === "legs_lead";

export function formatValue(name, value) {
  if (value === null || value === undefined) return "not measured";
  if (isShare(name)) return `${Math.round(value * 100)}%`;
  return `${Math.round(Math.abs(value))}°${leanWord(name, value)}`;
}

function leanWord(name, value) {
  if (!name.includes("lean")) return "";
  return value < 0 ? " back" : " forward";
}

export function formatTarget(name, target) {
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
export function evidenceFrames(name, strokes) {
  const key = name.startsWith("finish") ? "finish_frame" : "catch_frame";
  return strokes.map((stroke, index) => ({
    stroke: index + 1,
    frame: stroke[key],
    value: stroke[name] ?? null,
  }));
}

export function sourceLink(source) {
  if (source.startsWith("http")) return { href: source, label: new URL(source).hostname };
  return { href: `https://pubmed.ncbi.nlm.nih.gov/${source}/`, label: `PubMed ${source}` };
}

function middle(pose, left, right) {
  const a = pose[left];
  const b = pose[right];
  if (!a || !b) return null;
  return { x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, score: Math.min(a[2], b[2]) };
}

function mark(kind, vertex, a, b, value, label) {
  if (!vertex || !a || !b || value === null || value === undefined) return [];
  const sure = Math.min(vertex.score, a.score ?? 1, b.score ?? 1) >= MIN_SCORE;
  return [{ kind, vertex, a, b, label, sure }];
}

// The angles to draw on one frame. Labels use the measured value, which is corrected for camera
// view, while the arcs follow the image, so the two can differ on oblique shots.
export function angleMarks(pose, angles) {
  if (!pose) return [];
  const shoulder = middle(pose, 5, 6);
  const elbow = middle(pose, 7, 8);
  const wrist = middle(pose, 9, 10);
  const hip = middle(pose, 11, 12);
  const knee = middle(pose, 13, 14);
  const ankle = middle(pose, 15, 16);
  const above = hip && { x: hip.x, y: hip.y - 30 };
  return [
    ...mark("trunk", hip, above, shoulder, angles.trunk, formatValue("lean", angles.trunk)),
    ...mark("knee", knee, hip, ankle, angles.knee, formatValue("knee", angles.knee)),
    ...mark("elbow", elbow, shoulder, wrist, angles.elbow, formatValue("elbow", angles.elbow)),
  ];
}

// Canvas arc settings for the short way round between two rays from a vertex.
export function arcBetween({ vertex, a, b }) {
  const start = Math.atan2(a.y - vertex.y, a.x - vertex.x);
  const end = Math.atan2(b.y - vertex.y, b.x - vertex.x);
  const turn = Math.atan2(Math.sin(end - start), Math.cos(end - start));
  return { start, end, anticlockwise: turn < 0 };
}

// Views are { scale, x, y }, where x and y are the video pixel at the top left of the canvas.
export const FIT = { scale: 1, x: 0, y: 0 };
export const MAX_ZOOM = 12;

export function clampView(view, width, height) {
  const scale = Math.min(Math.max(view.scale, 1), MAX_ZOOM);
  const limit = (value, size) => Math.min(Math.max(value, 0), size - size / scale);
  return { scale, x: limit(view.x, width), y: limit(view.y, height) };
}

// Zoom while keeping the video pixel under the pointer in place.
export function zoomAt(view, point, factor, width, height) {
  const scale = Math.min(Math.max(view.scale * factor, 1), MAX_ZOOM);
  const shown = (point.x - view.x) * view.scale;
  const shownY = (point.y - view.y) * view.scale;
  return clampView({ scale, x: point.x - shown / scale, y: point.y - shownY / scale }, width, height);
}

export function centreOn(view, point, width, height) {
  const x = point.x - width / view.scale / 2;
  const y = point.y - height / view.scale / 2;
  return clampView({ ...view, x, y }, width, height);
}

export function viewPoint(view, unzoomed) {
  return { x: view.x + unzoomed.x / view.scale, y: view.y + unzoomed.y / view.scale };
}

// Where a rower sits on a frame, for following them and for cropping freeze frames.
export function bodyCentre(pose) {
  if (!pose) return null;
  const seen = pose.filter(Boolean);
  if (seen.length === 0) return null;
  const mean = (index) => seen.reduce((sum, joint) => sum + joint[index], 0) / seen.length;
  return { x: mean(0), y: mean(1) };
}

export function median(values) {
  const known = values.filter((value) => value !== null && value !== undefined).sort((a, b) => a - b);
  if (known.length === 0) return null;
  const half = Math.floor(known.length / 2);
  return known.length % 2 ? known[half] : (known[half - 1] + known[half]) / 2;
}

const REACH = { catch: 0.58, finish: 0.33 };

const middleOf = (target) => (target.low + target.high) / 2;

// What the 3D model should show for a measure: the target pose, the athlete's pose if it can be
// trusted, and the range to shade. An unreliable angle falls back to the target and says so.
export function modelRequest(name, metrics) {
  const phase = name.startsWith("finish") ? "finish" : "catch";
  const lean = metrics.find((item) => item.name === `${phase}_lean_deg`);
  const knee = metrics.find((item) => item.name === `${phase}_knee_deg`);
  const reach = REACH[phase];
  const target = { lean: middleOf(lean.target), knee: middleOf(knee.target), reach };
  const usable = (item) => item.value !== null && item.score !== null;
  const yours = {
    lean: usable(lean) ? lean.value : target.lean,
    knee: usable(knee) ? knee.value : target.knee,
    reach,
  };
  const assumed = [lean, knee].filter((item) => !usable(item)).map((item) => item.label);
  const shaded = name.includes("lean") ? "lean" : name.includes("knee") ? "knee" : null;
  const range = shaded === "lean" ? lean.target : shaded === "knee" ? knee.target : null;
  return { phase, target, yours, assumed, shaded, range };
}

export function referenceUrl(pose, style) {
  const query = new URLSearchParams({ ...pose, style });
  return `/api/reference?${query}`;
}

// The measure a live angle should open, using the stroke moment nearest the current frame.
export function nearestMeasure(kind, frame, catches, finishes) {
  if (kind === "elbow") return "finish_elbow_deg";
  const distance = (markers) => Math.min(...markers.map((marker) => Math.abs(marker - frame)), Infinity);
  const phase = distance(finishes) < distance(catches) ? "finish" : "catch";
  return `${phase}_${kind === "trunk" ? "lean" : "knee"}_deg`;
}

// Pose positions use X along the boat, Y to the rower's right and Z up. The 3D scene uses Y up.
export function toScene([x, y, z]) {
  return [x, z, -y];
}

// Which drawn angle belongs to a measure, or null when it has none of its own.
export function measureKind(name) {
  if (name.includes("lean")) return "trunk";
  if (name.includes("knee")) return "knee";
  if (name.includes("elbow")) return "elbow";
  return null;
}

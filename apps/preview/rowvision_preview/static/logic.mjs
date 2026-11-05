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

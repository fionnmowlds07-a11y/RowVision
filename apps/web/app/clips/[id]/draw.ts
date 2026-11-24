import { angleMarks, arcBetween, facingAt, labelSpot, legsUnsure, limbSegments, targetMarks, viewAt } from "@/lib/logic";
import type { FrameData, Pose, Rower, Series } from "@/lib/result";

const COLOURS = { left: "#22d3ee", right: "#e879f9", centre: "#fde047" };
const ANGLE_COLOUR = "#fde047";
const TARGET_COLOURS = { inside: "74, 222, 128", outside: "251, 146, 60" };

export type Scene = {
  rower: Rower;
  poses: Pose[];
  angles: { trunk: Series; knee: Series; elbow: Series };
  views: Series | null;
  viewDeg: number | null;
  facing: number;
  /** Stretches of frames filmed from the other side of the boat, where the rower faces the other way. */
  otherSide: number[][];
};

export function makeScene(rower: Rower, data: FrameData, facing: number, viewDeg: number | null, otherSide: number[][] = []): Scene | null {
  if (!data.poses || !data.angles) return null;
  return { rower, poses: data.poses, angles: data.angles, views: data.views, viewDeg, facing, otherSide };
}

function viewOf(scene: Scene, frame: number): number {
  return viewAt({ views: scene.views, view_deg: scene.viewDeg }, frame);
}

function legsUnsureAt(scene: Scene, frame: number): boolean {
  // A result with no knee series at all says nothing about any one leg.
  return legsUnsure(viewOf(scene, frame), scene.angles.knee?.[frame]);
}

/** `size` keeps lines and labels the same on screen at any zoom. */
export function drawPose(target: CanvasRenderingContext2D, scene: Scene, frame: number, size: number) {
  target.lineWidth = 1.5 * size;
  target.lineCap = "round";
  for (const { start, end, side, sure } of limbSegments(scene.poses[frame], legsUnsureAt(scene, frame))) {
    target.strokeStyle = COLOURS[side as keyof typeof COLOURS];
    target.setLineDash(sure ? [] : [3 * size, 3 * size]);
    target.beginPath();
    target.moveTo(start[0], start[1]);
    target.lineTo(end[0], end[1]);
    target.stroke();
  }
  target.setLineDash([]);
}

export function drawAngles(target: CanvasRenderingContext2D, scene: Scene, frame: number, size: number, only?: string) {
  const pose = scene.poses[frame];
  if (!pose) return;
  const { trunk, knee, elbow } = scene.angles;
  target.font = `${11 * size}px "DM Sans Variable", sans-serif`;
  target.lineWidth = 1.5 * size;
  const angles = { trunk: trunk[frame], knee: knee[frame], elbow: elbow[frame] };
  const marks = angleMarks(pose, angles, legsUnsureAt(scene, frame), facingAt(scene.facing, scene.otherSide, frame));
  for (const item of marks.filter(({ kind }) => !only || kind === only)) {
    const { start, end, anticlockwise } = arcBetween({ vertex: item.vertex, a: item.a, b: item.b });
    const { x, y } = item.vertex;
    target.strokeStyle = ANGLE_COLOUR;
    target.setLineDash(item.sure ? [] : [2 * size, 2 * size]);
    target.beginPath();
    target.arc(x, y, 12 * size, start, end, anticlockwise);
    target.stroke();
    target.setLineDash([]);
    const label = item.sure ? item.label : `${item.label}?`;
    const width = target.measureText(label).width + 8 * size;
    const height = 15 * size;
    const spot = labelSpot(item.kind, item.vertex, width, height, 14 * size);
    target.fillStyle = "rgba(0, 0, 0, 0.82)";
    target.beginPath();
    target.roundRect(spot.x, spot.y, width, height, 5 * size);
    target.fill();
    target.fillStyle = "#fff";
    target.fillText(label, spot.x + 4 * size, spot.y + 11 * size);
  }
}

export function drawTargets(target: CanvasRenderingContext2D, scene: Scene, frame: number, size: number, only?: string) {
  const rower = { ...scene.rower, angles: scene.angles };
  for (const item of targetMarks(scene.poses[frame], frame, rower, facingAt(scene.facing, scene.otherSide, frame), viewOf(scene, frame))) {
    if (only && item.kind !== only) continue;
    const colour = TARGET_COLOURS[item.inside ? "inside" : "outside"];
    target.beginPath();
    target.moveTo(item.vertex.x, item.vertex.y);
    target.lineTo(item.low.x, item.low.y);
    target.lineTo(item.high.x, item.high.y);
    target.closePath();
    target.fillStyle = `rgba(${colour}, 0.3)`;
    target.fill();
    target.strokeStyle = `rgb(${colour})`;
    target.lineWidth = 1 * size;
    target.stroke();
  }
}

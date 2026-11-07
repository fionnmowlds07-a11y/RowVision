/**
 * Pose a rower at chosen angles for the 3D model. Ported from rowvision/reference_pose.py and
 * checked against fixtures generated from it. X runs along the boat, Y to the rower's right, Z up.
 */

const THIGH = 0.45;
const SHIN = 0.45;
const TRUNK = 0.55;
const UPPER_ARM = 0.3;
const FOREARM = 0.3;
const SHOULDER_WIDTH = 0.40;
const HIP_WIDTH = 0.30;
const HIP_HEIGHT = 0.25;
const HAND_HEIGHT = 0.45;
const HEAD = 0.22;
const MIN_KNEE_DEG = 40;
const MAX_KNEE_DEG = 180;
const MAX_LEAN_DEG = 60;
const PIN_HEIGHT = 0.3;
const SEAT_HEIGHT = 0.17;
const FOOTPLATE_ANGLE_DEG = 42;
const FOOT_LENGTH = 0.27;
const ANKLE_ABOVE_SOLE = 0.08;
const ANKLE_ALONG_SOLE = 0.07;
const FOOT_SPACING = 0.085;
const HAND_GAP = 0.25;
const MAX_TWIST_DEG = 14;
const TWIST_LEAN_RANGE_DEG = [-20, 25];

export type Style = "stroke" | "bow" | "scull";
type Vector = number[];

const RIGGING: Record<Style, [number, number, number, number]> = {
  scull: [0.35, 0.8, 0.88, 1.97],
  stroke: [0.45, 0.85, 1.15, 2.55],
  bow: [0.45, 0.85, 1.15, 2.55],
};

const radians = (degrees: number) => (degrees * Math.PI) / 180;
const clip = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);
const add = (a: Vector, b: Vector) => a.map((value, index) => value + b[index]);
const sub = (a: Vector, b: Vector) => a.map((value, index) => value - b[index]);
const scale = (a: Vector, factor: number) => a.map((value) => value * factor);
const dot = (a: Vector, b: Vector) => a.reduce((sum, value, index) => sum + value * b[index], 0);
const norm = (a: Vector) => Math.sqrt(dot(a, a));
const rounded = (a: Vector) => a.map((value) => Math.round(value * 1e4) / 1e4);
const place = (sagittal: Vector, y = 0): Vector => [sagittal[0], y, sagittal[1]];

/** Place the middle joint of a two-segment limb between two points. */
function bend(start: Vector, end: Vector, first: number, second: number, sign: number): Vector {
  const offset = sub(end, start);
  const distance = norm(offset);
  const along = (distance ** 2 + first ** 2 - second ** 2) / (2 * distance);
  const height = Math.sqrt(Math.max(first ** 2 - along ** 2, 0));
  const unit = scale(offset, 1 / distance);
  return add(add(start, scale(unit, along)), scale([-unit[1], unit[0]], sign * height));
}

function oar(style: Style, side: number, handX: number, handZ: number) {
  const [pinX, pinY, inboard, outboard] = RIGGING[style];
  const along = clip(handX - pinX, -0.95 * inboard, 0.95 * inboard);
  const across = Math.sqrt(inboard ** 2 - along ** 2 - (handZ - PIN_HEIGHT) ** 2);
  const pin = [pinX, side * pinY, PIN_HEIGHT];
  const towardsHandle = scale([along, -side * across, handZ - PIN_HEIGHT], 1 / inboard);
  return { pin, towardsHandle, blade: sub(pin, scale(towardsHandle, outboard)) };
}

function foot() {
  const angle = radians(FOOTPLATE_ANGLE_DEG);
  const along = [-Math.cos(angle), Math.sin(angle)];
  const towardsRower = [Math.sin(angle), Math.cos(angle)];
  const heel = scale(add(scale(towardsRower, ANKLE_ABOVE_SOLE), scale(along, ANKLE_ALONG_SOLE)), -1);
  return { heel, toe: add(heel, scale(along, FOOT_LENGTH)) };
}

function elbowAt(shoulder: Vector, hand: Vector, side: number): Vector {
  const span = sub(hand, shoulder);
  const distance = norm(span);
  const along = (distance ** 2 + UPPER_ARM ** 2 - FOREARM ** 2) / (2 * distance);
  const rise = Math.sqrt(Math.max(UPPER_ARM ** 2 - along ** 2, 0));
  const unit = scale(span, 1 / distance);
  const raw = [0, side, -1];
  const outward = sub(raw, scale(unit, dot(raw, unit)));
  return add(add(shoulder, scale(unit, Math.min(along, UPPER_ARM))), scale(outward, rise / norm(outward)));
}

function twist(style: Style, leanDeg: number): number {
  if (style === "scull") return 0;
  const [low, high] = TWIST_LEAN_RANGE_DEG;
  const share = clip((leanDeg - low) / (high - low), 0, 1);
  return (style === "stroke" ? 1 : -1) * radians(MAX_TWIST_DEG) * share;
}

export function poseAt(leanDeg: number, kneeDeg: number, reach: number, style: Style) {
  if (kneeDeg < MIN_KNEE_DEG || kneeDeg > MAX_KNEE_DEG || Math.abs(leanDeg) > MAX_LEAN_DEG) {
    throw new RangeError("angle out of range");
  }
  if (reach <= 0.05 || reach > UPPER_ARM + FOREARM) throw new RangeError("reach out of range");

  const leg = Math.sqrt(THIGH ** 2 + SHIN ** 2 - 2 * THIGH * SHIN * Math.cos(radians(kneeDeg)));
  const ankle = [0, 0];
  const hip = [Math.sqrt(Math.max(leg ** 2 - HIP_HEIGHT ** 2, 0)), HIP_HEIGHT];
  const knee = bend(ankle, hip, SHIN, THIGH, 1);

  const lean = radians(leanDeg);
  const alongTrunk = [-Math.sin(lean), Math.cos(lean)];
  const shoulder = add(hip, scale(alongTrunk, TRUNK));
  const head = add(shoulder, scale(alongTrunk, HEAD));
  const drop = Math.min(shoulder[1] - HAND_HEIGHT, reach);
  const handX = shoulder[0] - Math.sqrt(reach ** 2 - drop ** 2);
  const handZ = shoulder[1] - drop;

  const turn = twist(style, leanDeg);
  const half = SHOULDER_WIDTH / 2;
  const shoulders: Record<number, Vector> = {
    [-1]: add(place(shoulder), scale([-Math.sin(turn), -Math.cos(turn), 0], half)),
    [1]: add(place(shoulder), scale([Math.sin(turn), Math.cos(turn), 0], half)),
  };

  const hands: Record<number, Vector> = {};
  const oars = (style === "scull" ? [1, -1] : style === "stroke" ? [1] : [-1]).map((side) => {
    const { pin, towardsHandle, blade } = oar(style, side, handX, handZ);
    const handle = add(pin, scale(towardsHandle, RIGGING[style][2]));
    if (style === "scull") {
      hands[side] = handle;
    } else {
      hands[-side] = handle;
      hands[side] = sub(handle, scale(towardsHandle, HAND_GAP));
    }
    const angle = (Math.atan2(Math.abs(towardsHandle[0]), Math.abs(towardsHandle[1])) * 180) / Math.PI;
    return {
      side: side > 0 ? "port" : "starboard",
      handle: rounded(handle),
      pin: rounded(pin),
      blade: rounded(blade),
      angle_deg: Math.round(angle * 10) / 10,
    };
  });

  const { heel, toe } = foot();
  const bodySide = (side: number) => {
    const width = (side * HIP_WIDTH) / 2;
    const feet = side * FOOT_SPACING;
    return {
      heel: rounded(place(heel, feet)),
      toe: rounded(place(toe, feet)),
      ankle: rounded(place(ankle, feet)),
      knee: rounded(place(knee, width)),
      hip: rounded(place(hip, width)),
      shoulder: rounded(shoulders[side]),
      elbow: rounded(elbowAt(shoulders[side], hands[side], side)),
      hand: rounded(hands[side]),
    };
  };

  return {
    style,
    left: bodySide(-1),
    right: bodySide(1),
    head: rounded(place(head)),
    seat: rounded([hip[0], 0, SEAT_HEIGHT]),
    oars,
    twist_deg: Math.round(((Math.abs(turn) * 180) / Math.PI) * 10) / 10,
  };
}

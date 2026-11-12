// The sculling stroke as pure maths: give it a phase t in [0,1) and it returns where the seat, trunk,
// hands, oars and blades are. t = 0 is the catch. The body leads and the oar angle is solved from the
// arm reach, so the hands always stay on the handles.
import { BODY, D2R, INB, OUTB, GRIP_IN, BLADE_IN, PIN, PIN_LEFT_UP, HIP_Y, HIP_CATCH, TRAVEL } from './rig.js';
import { CURVES } from './stroke-data.js';

export const DRIVE = CURVES.drive;          // share of the cycle spent on the drive
const LEAN_CATCH = 27 * D2R, LEAN_FINISH = -19 * D2R; // trunk lean, + = forward towards the stern
const R_MAX = .985 * (BODY.upper + BODY.fore);        // shoulder to wrist with the arms long
const R_FIN = .325;                                     // and at the finish, hands drawn in to the ribs
const R_HANDLE = INB - GRIP_IN, R_BLADE = OUTB - BLADE_IN;
const BLADE_DEEP = -.105, BLADE_CARRY = .125;         // blade middle: buried on the drive, carried on the recovery

const clamp01 = x => Math.max(0, Math.min(1, x));
const lerp = (a, b, u) => a + (b - a) * u;
const sstep = (a, b, x) => { const u = clamp01((x - a) / (b - a)); return u * u * u * (u * (u * 6 - 15) + 10); };
// Periodic lookup into a sampled curve.
function sample(arr, t) { const n = arr.length, x = ((t % 1) + 1) % 1 * n, i = Math.floor(x), u = x - i;
  const p0 = arr[(i - 1 + n) % n], p1 = arr[i % n], p2 = arr[(i + 1) % n], p3 = arr[(i + 2) % n];
  return .5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u); }

// Legs, back and arms, each 0 at the catch and 1 at the finish.
export function parts(t) { return { L: clamp01(sample(CURVES.legs, t)), B: clamp01(sample(CURVES.back, t)), A: clamp01(sample(CURVES.arms, t)) }; }

export function gripPoint(phi, pitch, sd, out = [0, 0, 0]) {
  const c = Math.cos(pitch) * R_HANDLE;
  out[0] = PIN.x - c * Math.sin(phi); out[1] = PIN.y + (sd > 0 ? PIN_LEFT_UP : -PIN_LEFT_UP) + R_HANDLE * Math.sin(pitch); out[2] = sd * (PIN.z - c * Math.cos(phi));
  return out;
}
export function shoulderPoint(hipX, lean, reach, sd, out = [0, 0, 0]) {
  // reach = how far the shoulder blades slide forward (catch) or draw back (finish)
  out[0] = hipX - Math.sin(lean) * BODY.trunk - Math.cos(lean) * reach;
  out[1] = HIP_Y + Math.cos(lean) * BODY.trunk - Math.sin(lean) * reach;
  out[2] = sd * (BODY.shHalf - Math.abs(reach) * .25);
  return out;
}
const _g = [0, 0, 0], _s = [0, 0, 0];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
// Oar angle at which the grip is `r` from the shoulder.
function solvePhi(hipX, lean, reach, pitch, r) {
  shoulderPoint(hipX, lean, reach, 1, _s);
  let lo = -50 * D2R, hi = 82 * D2R;
  for (let i = 0; i < 26; i++) { const m = (lo + hi) / 2; if (dist(gripPoint(m, pitch, 1, _g), _s) < r) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

export function stroke(t) {
  t = ((t % 1) + 1) % 1;
  const { L, B, A } = parts(t), drive = t < DRIVE;
  const hipX = HIP_CATCH + TRAVEL * L;
  const lean = lerp(LEAN_CATCH, LEAN_FINISH, B);
  const reach = lerp(.045, -.03, clamp01(A * 1.4 + B * .2));
  // Blade: slips in over the last of the recovery, stays just covered, comes out square, then is carried flat.
  const u = drive ? 0 : (t - DRIVE) / (1 - DRIVE);
  const out = 1 - sstep(DRIVE - .035, DRIVE + .012, t);
  const buried = drive ? sstep(-.03, .03, t) * out : Math.max(out, sstep(-.03, .03, t - 1));
  const feather = drive ? 0 : sstep(.012, .11, u) * (1 - sstep(.66, .93, u)); // 1 = flat
  const carry = BLADE_CARRY + .045 * (1 - feather) * (1 - buried);           // lift a touch as the blade squares
  const bladeY = lerp(carry, BLADE_DEEP, buried);
  const pitch = Math.asin((PIN.y - bladeY) / R_BLADE);
  const phi = solvePhi(hipX, lean, reach, pitch, lerp(R_MAX, R_FIN, A) + BODY.grip);
  // Left hand leads and rides over the right through the crossover.
  const cross = Math.exp(-Math.pow(phi / (24 * D2R), 2));
  const oars = [-1, 1].map(sd => {
    const ph = phi + sd * cross * .9 * D2R, pi = pitch + sd * cross * .012 / R_HANDLE;
    const c = Math.cos(pi) * R_BLADE;
    return { sd, phi: ph, pitch: pi, feather, grip: gripPoint(ph, pi, sd, [0, 0, 0]),
      blade: [PIN.x + c * Math.sin(ph), PIN.y + (sd > 0 ? PIN_LEFT_UP : -PIN_LEFT_UP) - R_BLADE * Math.sin(pi), sd * (PIN.z + c * Math.cos(ph))] };
  });
  // Hull speed: slowest just after the catch, quickest early in the recovery as the rower's weight comes back.
  const speed = 1 - .105 * Math.cos(2 * Math.PI * (t - .075)) - .03 * Math.cos(4 * Math.PI * (t - .03));
  const phase = t < .03 || t > .985 ? 'Catch' : t < DRIVE - .03 ? 'Drive' : t < DRIVE + .05 ? 'Finish' : 'Recovery';
  return { t, L, B, A, drive, hipX, lean, reach, phi, pitch, feather, buried, bladeY, oars, speed, phase };
}

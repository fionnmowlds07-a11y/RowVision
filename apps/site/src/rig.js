// One table for how the single is rigged and how big the sculler is, so the boat, the oars and the
// body can never disagree. Boat-local axes: +x towards the bow, y up (0 = waterline), z across (+z = the rower's left).
// Lengths in metres. Body sizes are measured from public/models/rower.glb scaled to HEIGHT.
export const D2R = Math.PI / 180;

export const BODY = {
  height: 1.90,
  thigh: .520, calf: .461,      // hip to knee, knee to ankle
  upper: .293, fore: .284,      // shoulder to elbow, elbow to wrist
  trunk: .489,                  // hip joint to shoulder joint
  shHalf: .209, hipHalf: .112,  // half widths at the joints
  grip: .095,                   // wrist to the middle of the handle in the fingers
};

// Sculls: 288 cm long, 88 cm inboard, on a 160 cm span.
export const INB = .88, OUTB = 2.0;
export const GRIP_IN = .07;     // middle of the grip, measured in from the handle end
export const BLADE_IN = .22;    // middle of the blade, measured in from the tip
export const PIN = { x: -.52, y: .30, z: .80 };
export const PIN_LEFT_UP = .008; // the left gate sits a little higher so the left hand passes over the right

export const SEAT_TOP = .135;   // top of the seat above the water, just proud of the gunwales
export const HIP_Y = .23;       // hip joint when sitting on it

// Foot stretcher: an angled plate low in the cockpit, bottom towards the rower, top leaning away to the stern.
export const STRETCHER = {
  angle: 42 * D2R,              // plate angle from horizontal
  heel: { x: PIN.x - .355, y: -.035 }, // back of the heels, near the cockpit floor
  footHalf: .06,                // half the gap between the two feet
};
// Ankle joint: a little up the plate from the heel and off the sole.
export const ANKLE = {
  x: STRETCHER.heel.x - .055 * Math.cos(STRETCHER.angle) + .082 * Math.sin(STRETCHER.angle),
  y: STRETCHER.heel.y + .055 * Math.sin(STRETCHER.angle) + .082 * Math.cos(STRETCHER.angle),
  z: STRETCHER.footHalf,
};

// Slide: where the hip joint sits at the catch (shins vertical) and how far the seat travels to the finish.
export const HIP_CATCH = ANKLE.x + .41;
export const TRAVEL = .547;

// The 3D reference model. Loaded only when opened, so the page stays quick without it.
import * as THREE from "three";
import { OrbitControls } from "./vendor/OrbitControls.js";
import { referenceUrl, toScene } from "./logic.mjs";

const PALETTE = {
  target: { body: 0x0f9d8a, limb: 0x23b8a3, joint: 0xffffff },
  yours: { body: 0xf59e0b, limb: 0xfbbf24, joint: 0xfff7e6 },
  port: 0xdc2626,
  starboard: 0x16a34a,
  hull: 0xfbfcfd,
  deck: 0xdfe7ee,
  metal: 0xa9b4bf,
  rail: 0x7b8794,
};
const VIEWS = { side: [0.5, 1.0, 4.6], stern: [-4.6, 1.5, 0.01], above: [0.5, 5.2, 0.01] };
const HULL = { start: -3.6, end: 4.6, halfWidth: 0.2, rim: 0.03, keel: -0.2 };
const COCKPIT = { start: -0.42, end: 1.34 };
const FLOOR_HEIGHT = -0.14;
const WATER_HEIGHT = -0.07;
const RAIL_HEIGHT = 0.1;
const SEAT_TOP = 0.17;
const ARC_RADIUS = 0.34;

const vector = (point) => new THREE.Vector3(...toScene(point));
const midpoint = (a, b) => a.map((value, index) => (value + b[index]) / 2);

function material(colour, opacity = 1, options = {}) {
  return new THREE.MeshStandardMaterial({
    color: colour,
    roughness: 0.55,
    metalness: 0.02,
    transparent: opacity < 1,
    opacity,
    depthWrite: opacity === 1,
    ...options,
  });
}

function aim(mesh, from, to) {
  const start = vector(from);
  const end = vector(to);
  mesh.position.copy(start);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.sub(start).normalize());
  return mesh;
}

// A limb that tapers from `near` to `far`, with a slight muscle swell, so it reads as a real limb.
function limb(from, to, near, far, paint, swell = 0.12) {
  const length = vector(from).distanceTo(vector(to));
  const profile = [new THREE.Vector2(0.0001, 0)];
  const steps = 14;
  for (let step = 0; step <= steps; step += 1) {
    const along = step / steps;
    const radius = near + (far - near) * along + near * swell * Math.sin(Math.PI * along);
    profile.push(new THREE.Vector2(radius, along * length));
  }
  profile.push(new THREE.Vector2(0.0001, length));
  return aim(new THREE.Mesh(new THREE.LatheGeometry(profile, 20), paint), from, to);
}

function ball(point, radius, paint) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 20, 14), paint);
  mesh.position.copy(vector(point));
  return mesh;
}

function bar(from, to, radius, paint) {
  const length = vector(from).distanceTo(vector(to));
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 12), paint);
  const placed = aim(mesh, from, to);
  placed.position.add(vector(to).sub(vector(from)).multiplyScalar(0.5));
  return placed;
}

// Chest wider than it is deep, narrowing to the waist.
function torso(pose, paint) {
  const hip = midpoint(pose.left.hip, pose.right.hip);
  const shoulder = midpoint(pose.left.shoulder, pose.right.shoulder);
  const length = vector(hip).distanceTo(vector(shoulder));
  const profile = [
    [0.0001, -0.04], [0.1, -0.03], [0.135, 0.05], [0.125, 0.2], [0.15, 0.36],
    [0.175, 0.47], [0.155, 0.53], [0.07, 0.57], [0.0001, 0.58],
  ].map(([radius, along]) => new THREE.Vector2(radius, (along / 0.55) * length));
  const mesh = new THREE.Mesh(new THREE.LatheGeometry(profile, 28), paint);
  const placed = aim(mesh, hip, shoulder);
  const across = vector(pose.right.shoulder).sub(vector(pose.left.shoulder)).normalize();
  const up = vector(shoulder).sub(vector(hip)).normalize();
  const forward = new THREE.Vector3().crossVectors(across, up).normalize();
  placed.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(across, up, forward));
  placed.scale.set(1, 1, 0.68);
  return placed;
}

function head(pose, paint, skin) {
  const group = new THREE.Group();
  const shoulder = midpoint(pose.left.shoulder, pose.right.shoulder);
  group.add(limb(shoulder, pose.head, 0.05, 0.045, skin, 0));
  const skull = ball(pose.head, 0.1, skin);
  skull.scale.set(0.92, 1.12, 0.88);
  group.add(skull);
  return group;
}

function shoe(side, paint) {
  const heel = vector(side.heel);
  const toe = vector(side.toe);
  const length = heel.distanceTo(toe);
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, length - 0.09, 6, 14), paint);
  mesh.position.copy(heel.clone().add(toe).multiplyScalar(0.5));
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), toe.sub(heel).normalize());
  mesh.scale.set(1.1, 1, 0.8);
  return mesh;
}

function rower(pose, colours, opacity) {
  const group = new THREE.Group();
  const body = material(colours.body, opacity);
  const skin = material(colours.limb, opacity);
  const joint = material(colours.joint, opacity);
  for (const side of [pose.left, pose.right]) {
    group.add(
      limb(side.hip, side.knee, 0.082, 0.052, body),
      limb(side.knee, side.ankle, 0.056, 0.036, skin, 0.22),
      limb(side.shoulder, side.elbow, 0.05, 0.036, body),
      limb(side.elbow, side.hand, 0.038, 0.026, skin),
      shoe(side, body),
      ball(side.hand, 0.04, skin),
      ball(side.knee, 0.044, joint),
      ball(side.ankle, 0.032, joint),
      ball(side.elbow, 0.034, joint),
      ball(side.shoulder, 0.046, joint),
    );
  }
  const hip = midpoint(pose.left.hip, pose.right.hip);
  const pelvis = ball(hip, 0.135, body);
  pelvis.scale.set(1.1, 0.8, 1.2);
  group.add(pelvis, ball(hip, 0.05, joint), torso(pose, body), head(pose, body, skin));
  return group;
}

function blade(oar, opacity) {
  const shape = new THREE.Shape();
  shape.moveTo(-0.02, 0);
  shape.bezierCurveTo(-0.13, 0.08, -0.13, 0.36, -0.07, 0.48);
  shape.lineTo(0.07, 0.48);
  shape.bezierCurveTo(0.13, 0.36, 0.13, 0.08, 0.02, 0);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.012, bevelEnabled: false });
  const mesh = new THREE.Mesh(geometry, material(PALETTE[oar.side], opacity));
  const start = vector(oar.blade);
  const inwards = vector(oar.pin).sub(start).normalize();
  mesh.position.copy(start.addScaledVector(inwards, -0.1));
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), inwards.clone().negate());
  mesh.rotateY(Math.PI / 2);
  mesh.rotateZ(Math.PI);
  mesh.position.addScaledVector(inwards, 0.48);
  return mesh;
}

function oars(pose) {
  const group = new THREE.Group();
  const metal = material(PALETTE.metal);
  const rail = material(PALETTE.rail);
  for (const oar of pose.oars) {
    const side = Math.sign(oar.pin[1]);
    const gunwale = HULL.halfWidth * side;
    group.add(
      bar(oar.handle, oar.blade, 0.016, material(0xf4f6f8)),
      limb(oar.handle, oar.handle.map((v, i) => v + (oar.pin[i] - v) * 0.17), 0.021, 0.019, rail, 0),
      blade(oar, 1),
      ball(oar.pin, 0.034, material(PALETTE[oar.side])),
      bar([oar.pin[0] - 0.22, gunwale, HULL.rim], oar.pin, 0.012, metal),
      bar([oar.pin[0] + 0.22, gunwale, HULL.rim], oar.pin, 0.012, metal),
      bar([oar.pin[0], gunwale, HULL.rim - 0.02], oar.pin, 0.012, metal),
    );
  }
  return group;
}

const widthAt = (x) => {
  const middle = (HULL.start + HULL.end) / 2;
  const half = (HULL.end - HULL.start) / 2;
  return HULL.halfWidth * Math.max(1 - ((x - middle) / half) ** 2, 0.004) ** 0.75;
};

// An open shell, so the feet, seat and rails can be seen inside the cockpit.
function hullShell() {
  const stations = 90;
  const ribs = 14;
  const positions = [];
  const faces = [];
  for (let station = 0; station <= stations; station += 1) {
    const x = HULL.start + ((HULL.end - HULL.start) * station) / stations;
    const width = widthAt(x);
    for (let rib = 0; rib <= ribs; rib += 1) {
      const turn = Math.PI * (rib / ribs);
      positions.push(
        x,
        HULL.rim - Math.sin(turn) * (HULL.rim - HULL.keel) * (width / HULL.halfWidth) ** 0.5,
        Math.cos(turn) * width,
      );
    }
  }
  for (let station = 0; station < stations; station += 1) {
    for (let rib = 0; rib < ribs; rib += 1) {
      const a = station * (ribs + 1) + rib;
      const b = a + ribs + 1;
      faces.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(faces);
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, material(PALETTE.hull, 1, { side: THREE.DoubleSide }));
}

function deck(from, to) {
  const shape = new THREE.Shape();
  const steps = 40;
  const points = Array.from({ length: steps + 1 }, (_, i) => from + ((to - from) * i) / steps);
  points.forEach((x, i) => (i ? shape.lineTo(x, widthAt(x)) : shape.moveTo(x, widthAt(x))));
  points.reverse().forEach((x) => shape.lineTo(x, -widthAt(x)));
  const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), material(PALETTE.deck, 1, { side: THREE.DoubleSide }));
  mesh.rotation.x = Math.PI / 2;
  mesh.position.y = HULL.rim;
  return mesh;
}

function footplate(pose) {
  const left = pose.left;
  const middle = vector([(left.heel[0] + left.toe[0]) / 2, 0, (left.heel[2] + left.toe[2]) / 2]);
  const length = vector(left.heel).distanceTo(vector(left.toe)) + 0.08;
  const plate = new THREE.Mesh(new THREE.BoxGeometry(length, 0.018, 0.27), material(PALETTE.rail));
  const slope = Math.atan2(left.toe[2] - left.heel[2], left.toe[0] - left.heel[0]);
  plate.position.copy(middle);
  plate.rotation.z = slope;
  plate.translateY(-0.06);
  return plate;
}

function seat(pose) {
  const group = new THREE.Group();
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.05, 0.24), material(0x4b5563));
  const [x] = toScene(pose.seat);
  top.position.set(x, SEAT_TOP - 0.025, 0);
  group.add(top);
  for (const offset of [-0.075, 0.075]) {
    group.add(bar([x, offset, SEAT_TOP - 0.04], [x, offset, RAIL_HEIGHT], 0.012, material(PALETTE.metal)));
  }
  return group;
}

function boat(pose) {
  const group = new THREE.Group();
  group.add(hullShell(), deck(HULL.start + 0.03, COCKPIT.start), deck(COCKPIT.end, HULL.end - 0.03));
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(COCKPIT.end - COCKPIT.start, 0.012, 0.25),
    material(PALETTE.deck),
  );
  floor.position.set((COCKPIT.start + COCKPIT.end) / 2, FLOOR_HEIGHT, 0);
  group.add(floor);
  for (const offset of [-0.075, 0.075]) {
    group.add(bar([0.16, offset, RAIL_HEIGHT], [1.1, offset, RAIL_HEIGHT], 0.011, material(PALETTE.rail)));
    group.add(bar([0.2, offset, FLOOR_HEIGHT], [0.2, offset, RAIL_HEIGHT], 0.008, material(PALETTE.metal)));
    group.add(bar([1.05, offset, FLOOR_HEIGHT], [1.05, offset, RAIL_HEIGHT], 0.008, material(PALETTE.metal)));
  }
  group.add(footplate(pose), seat(pose));
  return group;
}

function water() {
  const mesh = new THREE.Mesh(
    new THREE.CircleGeometry(30, 48),
    new THREE.MeshStandardMaterial({ color: 0x7cc4e8, roughness: 0.4, transparent: true, opacity: 0.82 }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = WATER_HEIGHT;
  return mesh;
}

// Shade the target range at a joint, drawn on top so it can be seen through the body.
function arc(pose, request) {
  const { shaded, range } = request;
  if (!shaded) return null;
  const degrees = Math.PI / 180;
  let centre;
  let start;
  let length;
  if (shaded === "lean") {
    centre = midpoint(pose.left.hip, pose.right.hip);
    start = (90 + range.low) * degrees;
    length = (range.high - range.low) * degrees;
  } else {
    const knee = vector(pose.left.knee);
    const shin = vector(pose.left.ankle).sub(knee);
    const thigh = vector(pose.left.hip).sub(knee);
    const shinAngle = Math.atan2(shin.y, shin.x);
    const turn = Math.sign(shin.x * thigh.y - shin.y * thigh.x) || 1;
    centre = pose.left.knee;
    const from = shinAngle + turn * range.low * degrees;
    const to = shinAngle + turn * range.high * degrees;
    start = Math.min(from, to);
    length = Math.abs(to - from);
  }
  const mesh = new THREE.Mesh(
    new THREE.CircleGeometry(ARC_RADIUS, 40, start, length),
    new THREE.MeshBasicMaterial({
      color: 0xffd23f,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
      depthTest: false,
    }),
  );
  mesh.position.copy(vector(centre));
  mesh.position.z = 0;
  mesh.renderOrder = 2;
  return mesh;
}

async function reference(pose, style) {
  const response = await fetch(referenceUrl(pose, style));
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}

export async function showModel(host, request, style, showYours) {
  const [target, yours] = await Promise.all([
    reference(request.target, style),
    reference(request.yours, style),
  ]);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xe6f4fb);
  scene.fog = new THREE.Fog(0xe6f4fb, 14, 30);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x9fc4d8, 2.0));
  const sun = new THREE.DirectionalLight(0xffffff, 2.0);
  sun.position.set(-2, 6, 4);
  scene.add(sun, water(), boat(target), rower(target, PALETTE.target, 1), oars(target));
  const shade = arc(target, request);
  if (shade) scene.add(shade);
  const ghost = rower(yours, PALETTE.yours, 0.5);
  ghost.visible = showYours;
  scene.add(ghost);

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  host.replaceChildren(renderer.domElement);
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0.5, 0.42, 0);
  controls.maxPolarAngle = Math.PI / 2 - 0.03;
  controls.minDistance = 1.0;
  controls.maxDistance = 14;

  function setView(name) {
    camera.position.set(...VIEWS[name]);
    controls.update();
  }

  function resize() {
    const width = host.clientWidth || 640;
    const height = host.clientHeight || 420;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  let running = true;
  function frame() {
    if (!running) return;
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  resize();
  setView("side");
  frame();
  window.addEventListener("resize", resize);
  return {
    target,
    setView,
    setYours(visible) {
      ghost.visible = visible;
    },
    close() {
      running = false;
      window.removeEventListener("resize", resize);
      controls.dispose();
      renderer.dispose();
      host.replaceChildren();
    },
  };
}

// The 3D reference model. Loaded only when opened, so the page stays quick without it.
import * as THREE from "three";
import { OrbitControls } from "./vendor/OrbitControls.js";
import { referenceUrl, toScene } from "./logic.mjs";

const COLOURS = { target: 0x14b8a6, yours: 0xf59e0b, port: 0xdc2626, starboard: 0x16a34a };
const VIEWS = { side: [0.6, 1.1, 5], stern: [-5, 1.4, 0], above: [0.6, 5, 0.01] };
const LIMB_RADIUS = 0.045;
const ARC_RADIUS = 0.42;

const vector = (point) => new THREE.Vector3(...toScene(point));

function limb(from, to, radius, material) {
  const start = vector(from);
  const end = vector(to);
  const length = start.distanceTo(end);
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 6, 12), material);
  mesh.position.copy(start.clone().add(end).multiplyScalar(0.5));
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.clone().sub(start).normalize());
  return mesh;
}

const midpoint = (a, b) => a.map((value, index) => (value + b[index]) / 2);

function rower(pose, colour, opacity) {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    color: colour,
    transparent: opacity < 1,
    opacity,
    depthWrite: opacity === 1,
  });
  for (const side of [pose.left, pose.right]) {
    group.add(limb(side.ankle, side.knee, LIMB_RADIUS, material));
    group.add(limb(side.knee, side.hip, LIMB_RADIUS * 1.3, material));
    group.add(limb(side.shoulder, side.elbow, LIMB_RADIUS * 0.8, material));
    group.add(limb(side.elbow, side.hand, LIMB_RADIUS * 0.7, material));
  }
  const hip = midpoint(pose.left.hip, pose.right.hip);
  const shoulder = midpoint(pose.left.shoulder, pose.right.shoulder);
  group.add(limb(hip, shoulder, 0.12, material));
  group.add(limb(pose.left.shoulder, pose.right.shoulder, LIMB_RADIUS, material));
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 20, 14), material);
  head.position.copy(vector(pose.head));
  group.add(head);
  return group;
}

function oars(pose, opacity) {
  const group = new THREE.Group();
  for (const oar of pose.oars) {
    const colour = COLOURS[oar.side];
    const shaft = new THREE.MeshStandardMaterial({ color: 0xe5e7eb, transparent: opacity < 1, opacity });
    group.add(limb(oar.handle, oar.blade, 0.018, shaft));
    const blade = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.45, 0.02),
      new THREE.MeshStandardMaterial({ color: colour, transparent: opacity < 1, opacity }),
    );
    blade.position.copy(vector(oar.blade));
    blade.lookAt(vector(oar.pin));
    blade.rotateX(Math.PI / 2);
    group.add(blade);
    const rigger = new THREE.MeshStandardMaterial({ color: 0x9ca3af });
    group.add(limb([oar.pin[0], oar.pin[1] * 0.2, 0.12], oar.pin, 0.015, rigger));
    const pin = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), new THREE.MeshStandardMaterial({ color: colour }));
    pin.position.copy(vector(oar.pin));
    group.add(pin);
  }
  return group;
}

function boat() {
  const group = new THREE.Group();
  const hull = new THREE.Mesh(
    new THREE.SphereGeometry(1, 32, 16),
    new THREE.MeshStandardMaterial({ color: 0xf8fafc }),
  );
  hull.scale.set(4.2, 0.12, 0.2);
  hull.position.set(0.5, 0.02, 0);
  group.add(hull);
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshStandardMaterial({ color: 0x2563a8, transparent: true, opacity: 0.45 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = -0.04;
  group.add(water);
  return group;
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
      color: 0xfde047,
      transparent: true,
      opacity: 0.75,
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
  scene.background = new THREE.Color(0xbfd7ea);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(2, 5, 4);
  scene.add(sun, boat(), rower(target, COLOURS.target, 1), oars(target, 1));
  const shade = arc(target, request);
  if (shade) scene.add(shade);
  const ghost = new THREE.Group();
  ghost.add(rower(yours, COLOURS.yours, 0.55));
  ghost.visible = showYours;
  scene.add(ghost);

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  host.replaceChildren(renderer.domElement);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0.6, 0.55, 0);
  controls.maxPolarAngle = Math.PI / 2 - 0.02;
  controls.minDistance = 1.2;
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

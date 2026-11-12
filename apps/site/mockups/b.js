import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { createWater } from '../src/water.js';
import { loadPose, progress, seg, ease, BONES, FAR_BONES } from './shared/pose.js';

const $ = id => document.getElementById(id);
const pose = await loadPose();
const film = $('film'), canvas = $('gl');
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
const FIRST = pose.catches[0], LAST = pose.catches.at(-1), COUNT = LAST - FIRST;   // whole strokes only, catch to catch
$('nStrokes').textContent = pose.catches.length - 1; $('nFrames').textContent = COUNT;

const DZ = .035, LIFT = .34, HOME = 40;   // metres between moments; ankle height over the water; clear of the old hull shading at the origin
const MINT = new THREE.Color('#9ff5c8'), GREEN = new THREE.Color('#35d07f');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
const scene = new THREE.Scene(); scene.fog = new THREE.FogExp2(0x030f0b, .016);
const camera = new THREE.PerspectiveCamera(30, 1, .1, 6000);

// Sky before sunrise: black overhead, a low band of green-grey light on the horizon for the water to mirror.
scene.add(new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, fog: false, depthWrite: false,
  vertexShader: 'varying vec3 d; void main(){ d = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
  fragmentShader: 'varying vec3 d; void main(){ float h = max(d.y, 0.); float glow = exp(-h * 9.) * (.55 + .45 * smoothstep(-.9, .2, -d.z)); vec3 c = mix(vec3(.004, .018, .014), vec3(.07, .19, .15), glow); gl_FragColor = vec4(c, 1.); }',
})));
const lake = createWater({ sun: new THREE.Vector3(.1, .07, -1).normalize(), mirror: innerWidth < 760 ? 512 : 1024 });
lake.mesh.material.uniforms.sunColor.value.set(0x35604c); lake.mesh.material.uniforms.waterColor.value.set(0x020d09); lake.mesh.material.uniforms.distortionScale.value = 1.6;
// a dark mirror: drop the grey the stock water adds under its reflection
lake.mesh.material.fragmentShader = lake.mesh.material.fragmentShader.replace('vec3( 0.1 )', 'vec3( 0.0 )'); lake.mesh.material.needsUpdate = true;
scene.add(lake.mesh);

const world = new THREE.Group(); world.position.set(0, LIFT, HOME); scene.add(world);
const past = new THREE.Group(); world.add(past);

// One moment of the stroke as line segments: near side, far side, neck and a ring for the head.
function segments(b) {
  const o = [], w = [];
  BONES.forEach(([p, q]) => { o.push(b[p], b[q]); w.push(1, 1); });
  FAR_BONES.forEach(([p, q]) => { o.push(b.far[p], b.far[q]); w.push(.35, .35); });
  o.push(b.sh, b.hd); w.push(1, 1);
  for (let k = 0; k < 28; k++) { const a = k / 28 * 6.2832, c = (k + 1) / 28 * 6.2832; o.push([b.hd[0] + Math.cos(a) * .1, b.hd[1] + Math.sin(a) * .1], [b.hd[0] + Math.cos(c) * .1, b.hd[1] + Math.sin(c) * .1]); w.push(1, 1); }
  return { o, w };
}

// Every moment of the clip, standing where it was rowed.
{
  const pos = [], idx = [], wt = [];
  for (let j = FIRST; j <= LAST; j++) { const { o, w } = segments(pose.body(j)); o.forEach((p, k) => { pos.push(p[0], p[1], (j - FIRST) * DZ); idx.push(j - FIRST); wt.push(w[k] * (pose.catches.includes(j) ? 2.6 : 1)); }); }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('aIdx', new THREE.Float32BufferAttribute(idx, 1)); geo.setAttribute('aW', new THREE.Float32BufferAttribute(wt, 1));
  var ghosts = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uHead: { value: 0 }, uAll: { value: 0 }, uTrail: { value: 26 }, uCol: { value: MINT } },
    vertexShader: 'attribute float aIdx; attribute float aW; uniform float uHead, uAll, uTrail; varying float a; void main(){ float age = uHead - aIdx; float trail = age >= 0. ? exp(-age / uTrail) * .5 : 0.; a = max(trail * (1. - uAll * .5), .16 * uAll) * aW; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: 'uniform vec3 uCol; varying float a; void main(){ gl_FragColor = vec4(uCol * min(a, 1.), 1.); }',
  });
  const mesh = new THREE.LineSegments(geo, ghosts); mesh.frustumCulled = false; past.add(mesh);
}
// The paths the hands and the knee take through the whole clip.
const paths = ['wr', 'kn'].map((k, n) => {
  const pts = []; for (let j = FIRST; j <= LAST; j++) { const b = pose.body(j); pts.push(b[k][0], b[k][1], (j - FIRST) * DZ); }
  const mat = new LineMaterial({ color: n ? GREEN : 0xffffff, linewidth: n ? 1.5 : 2, transparent: true, opacity: 0, depthWrite: false });
  const line = new Line2(new LineGeometry().setPositions(pts), mat); line.frustumCulled = false; past.add(line); return mat;
});

// The rower now.
const liveGeo = new LineSegmentsGeometry(), liveMat = new LineMaterial({ linewidth: 3.2, vertexColors: true, transparent: true });
const live = new LineSegments2(liveGeo, liveMat); live.frustumCulled = false; world.add(live);
const glowMat = new LineMaterial({ linewidth: 12, color: GREEN, transparent: true, opacity: .16, blending: THREE.AdditiveBlending, depthWrite: false });
const glow = new LineSegments2(liveGeo, glowMat); glow.frustumCulled = false; world.add(glow);
const dotGeo = new THREE.BufferGeometry(); dotGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(18), 3));
const dots = new THREE.Points(dotGeo, new THREE.ShaderMaterial({
  transparent: true, depthTest: false, uniforms: { uSize: { value: 11 } },
  vertexShader: 'uniform float uSize; void main(){ gl_PointSize = uSize; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
  fragmentShader: 'void main(){ float r = length(gl_PointCoord - .5) * 2.; if (r > 1.) discard; gl_FragColor = vec4(mix(vec3(1.), vec3(.02, .08, .06), smoothstep(.42, .5, r) * (1. - smoothstep(.72, .8, r))), 1.); }',
})); dots.frustumCulled = false; dots.layers.set(1); camera.layers.enable(1); world.add(dots);   // layer 1: kept out of the water's mirror

// Angle arcs, drawn in the scene at the joint they measure.
const arcs = ['kn', 'hp', 'el'].map(() => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(26 * 3), 3)); const m = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthTest: false }); const l = new THREE.Line(g, m); l.frustumCulled = false; world.add(l); return l; });
const ARC = [['kn', 'hp', 'an', .15, 'aKnee', 'knee'], ['hp', 'sh', 'kn', .17, 'aHip', 'hip'], ['el', 'sh', 'wr', .1, 'aElbow', 'elbow']];

function setArc(line, b, [c, p, q, r]) {
  const C = b[c], a1 = Math.atan2(b[p][1] - C[1], b[p][0] - C[0]), a2 = Math.atan2(b[q][1] - C[1], b[q][0] - C[0]); let d = a2 - a1; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
  const pos = line.geometry.attributes.position; for (let k = 0; k < 26; k++) { const a = a1 + d * k / 25; pos.setXYZ(k, C[0] + Math.cos(a) * r, C[1] + Math.sin(a) * r, 0); } pos.needsUpdate = true;
  const am = a1 + d / 2; return [C[0] + Math.cos(am) * (r + .16), C[1] + Math.sin(am) * (r + .16)];
}

function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h;
  [liveMat, glowMat, ...paths].forEach(m => m.resolution.set(w, h));
  dots.material.uniforms.uSize.value = 11 * renderer.getPixelRatio();
}
addEventListener('resize', resize); resize();

const V = (x, y, z) => new THREE.Vector3(x, y, z), tmp = V(), tgt = V(), v3 = V();
const s1 = $('s1'), s2 = $('s2'), s3 = $('s3');
let last = performance.now(), clock = 0;
function frame(now) {
  const dt = Math.min(.05, (now - last) / 1000); last = now; if (!still) clock += dt;
  const p = progress(film), a = ease(seg(p, .14, .42)), b = ease(seg(p, .62, .86));     // a: turn to look down the strokes; b: come in close
  const t = FIRST + (still ? COUNT * .12 : (clock * 30) % COUNT), body = pose.body(t);
  const w = canvas.clientWidth, h = canvas.clientHeight, tall = h > w, far = Math.max(1, 1.2 / camera.aspect);

  // the rower now
  const { o, w: wt } = segments(body), pos = [], col = [];
  for (let k = 0; k < o.length; k += 2) { pos.push(o[k][0], o[k][1], 0, o[k + 1][0], o[k + 1][1], 0); const c = MINT.clone().lerp(new THREE.Color(0xffffff), .45).multiplyScalar(wt[k] < 1 ? .32 : 1); col.push(c.r, c.g, c.b, c.r, c.g, c.b); }
  liveGeo.setPositions(pos); liveGeo.setColors(col);
  ['wr', 'el', 'sh', 'hp', 'kn', 'an'].forEach((k, n) => dotGeo.attributes.position.setXYZ(n, body[k][0], body[k][1], 0)); dotGeo.attributes.position.needsUpdate = true;

  // the past, standing behind
  past.position.z = -(t - FIRST) * DZ;
  const all = a * (1 - b);
  ghosts.uniforms.uHead.value = t - FIRST; ghosts.uniforms.uAll.value = all; ghosts.uniforms.uTrail.value = 26 - b * 14;
  paths[0].opacity = all * .85; paths[1].opacity = all * .7;

  // camera: side-on, then round and above to look down the strokes, then in close
  const cx = .62, cy = .5;
  const P1 = V(cx - 1.5, .78, 4.3 * far), T1 = V(cx, cy - .02, 0);
  const P2 = V(cx - 4.2 * far, 2.7 * far, 3.6 * far), T2 = V(cx + .2, .1, -2.2);
  const P3 = V(cx + .5, .62, 3.1 * far), T3 = V(cx, cy, 0);
  tmp.copy(P1).lerp(P2, a).lerp(P3, b); tgt.copy(T1).lerp(T2, a).lerp(T3, b);
  camera.position.copy(tmp).add(world.position); camera.lookAt(tgt.add(world.position));
  // keep the figure clear of the words: off to the right on a wide screen, low on a phone
  const ox = tall ? 0 : -w * (.17 * (1 - a) + .05 * a * (1 - b) + .16 * b), oy = tall ? h * (.08 - .1 * a * (1 - b)) : -h * (.03 + .08 * a * (1 - b));
  camera.setViewOffset(w, h, ox, oy, w, h); camera.updateProjectionMatrix();

  // arcs and their numbers
  ARC.forEach((spec, n) => {
    const at = setArc(arcs[n], body, spec); arcs[n].material.opacity = b;
    const el = $(spec[4]); el.style.opacity = seg(b, .5, 1);
    v3.set(at[0], at[1], 0).add(world.position).project(camera);
    el.textContent = Math.round(pose.angle(spec[5], t)) + '°';
    el.style.transform = `translate(${(v3.x * .5 + .5) * w}px, ${(-v3.y * .5 + .5) * h}px) translate(-50%, -50%)`;
  });
  const i = Math.round(t);
  $('rKnee').textContent = Math.round(pose.knee[i]) + '°'; $('rHip').textContent = Math.round(pose.hip[i]) + '°'; $('rElbow').textContent = Math.round(pose.elbow[i]) + '°';
  $('rPhase').textContent = pose.knee[i] < 80 ? 'Catch' : pose.knee[i] > 150 && pose.elbow[i] < 120 ? 'Finish' : pose.knee[i] > (pose.knee[i - 3] ?? pose.knee[i]) ? 'Drive' : 'Recovery';

  s1.style.opacity = 1 - seg(p, .06, .16); s2.style.opacity = Math.min(seg(p, .3, .4), 1 - seg(p, .58, .66)); s3.style.opacity = seg(p, .76, .86);
  [s1, s2, s3].forEach(s => s.style.visibility = +s.style.opacity ? 'visible' : 'hidden');

  lake.update(dt, clock, dt * .25, 0);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
await document.fonts.ready;
requestAnimationFrame(frame); document.documentElement.dataset.ready = '1';

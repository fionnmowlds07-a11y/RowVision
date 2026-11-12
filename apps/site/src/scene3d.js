// Home page 3D scene: a graphite mannequin sculling a single at golden hour.
// Motion comes from a textbook stroke cycle, not from tracking, so it is perfectly smooth.
import * as THREE from 'three';
import { Water } from 'three/examples/jsm/objects/Water.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { buildBoat, PIN, INB, OUTB } from './boat3d.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

export const COL = { hl: '#35d07f', knee: '#ffb547', hip: '#5cc8ff', back: '#c49bff', elbow: '#ff7ab6' };
const STROKE_S = 2.0; // seconds per stroke (30 spm)
const clamp01 = x => Math.max(0, Math.min(1, x));
const ez = x => x < .5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;

// Stroke phase t in [0,1): drive 0..0.38, recovery after. Legs, then back, then arms; reverse on the way back.
function parts(t) {
  let L, B, A;
  if (t < .38) { const u = t / .38; L = ez(clamp01(u / .62)); B = ez(clamp01((u - .3) / .5)); A = ez(clamp01((u - .62) / .38)); }
  else { const u = (t - .38) / .62; A = 1 - ez(clamp01(u / .2)); B = 1 - ez(clamp01((u - .12) / .3)); L = 1 - ez(clamp01((u - .3) / .7)); }
  return { L, B, A };
}

// Two-bone IK in a plane: returns the middle joint. `hint` picks the bend direction.
function ik(a, c, l1, l2, hint) {
  const ac = c.clone().sub(a); let d = ac.length(); d = Math.min(d, l1 + l2 - 1e-4); ac.normalize();
  const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  const perp = hint.clone().sub(ac.clone().multiplyScalar(hint.dot(ac))).normalize();
  return a.clone().add(ac.multiplyScalar(x)).add(perp.multiplyScalar(h));
}

function waterNormals() {
  const N = 256, c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d'), img = g.createImageData(N, N);
  const hgt = new Float32Array(N * N), waves = [];
  for (let i = 0; i < 28; i++) waves.push([Math.round((Math.random() - .5) * 14), Math.round((Math.random() - .5) * 14), Math.random() * 6.28, 1 / (1 + i * .25)]);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { let v = 0; for (const [kx, ky, p, a] of waves) v += a * Math.sin(6.2832 * (kx * x + ky * y) / N + p); hgt[y * N + x] = v; }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const hx = hgt[y * N + (x + 1) % N] - hgt[y * N + (x - 1 + N) % N], hy = hgt[((y + 1) % N) * N + x] - hgt[((y - 1 + N) % N) * N + x];
    const n = new THREE.Vector3(-hx * .35, -hy * .35, 1).normalize(), o = (y * N + x) * 4;
    img.data[o] = (n.x * .5 + .5) * 255; img.data[o + 1] = (n.y * .5 + .5) * 255; img.data[o + 2] = (n.z * .5 + .5) * 255; img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

export function createScene(canvas, overlay) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = .55;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, .05, 4000);

  // Sky, distant shore and lighting come from a real 360° photo (Poly Haven, CC0).
  const ENV_ROT = 1.57; // turns the photo so the dawn sun sits off to the side of the hero shot
  const sun = new THREE.Vector3(.85, .14, -.5).normalize();
  new RGBELoader().load('/env/lakeside_dawn_2k.hdr', tex => {
    tex.mapping = THREE.EquirectangularReflectionMapping;
    scene.background = tex; scene.environment = tex;
    scene.backgroundRotation.y = scene.environmentRotation.y = ENV_ROT;
    scene.backgroundIntensity = .9; scene.environmentIntensity = .8;
  });
  scene.background = new THREE.Color(0x8d8f94);

  const key = new THREE.DirectionalLight(0xffd2a0, 2.2); key.position.copy(sun).multiplyScalar(40); key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048); Object.assign(key.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 120 }); key.shadow.bias = -.0004;
  scene.add(key, key.target, new THREE.HemisphereLight(0xbfd3ff, 0x2a3326, .55));

  const water = new Water(new THREE.PlaneGeometry(6000, 6000), {
    textureWidth: 1024, textureHeight: 1024, waterNormals: waterNormals(), sunDirection: sun.clone(), sunColor: 0xffe0b0,
    waterColor: 0x14261f, distortionScale: .9, fog: true, alpha: 1,
  });
  water.rotation.x = -Math.PI / 2; water.material.uniforms.size.value = 6; scene.add(water);

  const world = new THREE.Group(); scene.add(world); const PERIOD = 600;
  // Lane buoys every 12.5 m on both sides of the lane.
  const buoys = new THREE.Group(); scene.add(buoys); const BP = 12.5;
  const buoyGeo = new THREE.SphereGeometry(.09, 16, 12), bw = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: .35 }), bo = new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: .35 });
  for (let i = -24; i <= 24; i++) for (const z of [-6.5, 6.5]) { const b = new THREE.Mesh(buoyGeo, Math.abs(i) % 4 == 0 ? bo : bw); b.position.set(i * BP, .02, z); buoys.add(b); }

  const B = buildBoat(); const boat = B.boat, seat = B.seat, oars = B.oars; scene.add(boat);

  // Mannequin: smooth graphite segments with glowing joint markers.
  const skin = new THREE.MeshPhysicalMaterial({ color: 0x2a2f2d, roughness: .42, metalness: .15, clearcoat: .5, clearcoatRoughness: .3, sheen: .4, sheenColor: new THREE.Color(0x6b7a72) });
  const segs = {}; const seg = (name, r1, r2) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r2, r1, 1, 28), skin); m.castShadow = true; scene.add(m); segs[name] = m; return m; };
  const ball = (r, mat = skin) => { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 28, 20), mat); m.castShadow = true; scene.add(m); return m; };
  const place = (m, a, b) => { const d = b.clone().sub(a), len = d.length(); m.position.copy(a).add(b).multiplyScalar(.5); m.scale.set(1, len, 1); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); };
  for (const s of ['L', 'R']) { seg('thigh' + s, .075, .058); seg('shin' + s, .055, .04); seg('upper' + s, .048, .04); seg('fore' + s, .04, .03); }
  { const prof = [[0, -.02], [.13, 0], [.15, .12], [.135, .38], [.16, .62], [.2, .82], [.19, .93], [.12, 1], [0, 1.02]].map(([r, y]) => new THREE.Vector2(r, y));
    const tg = new THREE.LatheGeometry(prof, 40); tg.translate(0, -.5, 0); const t = new THREE.Mesh(tg, skin); t.castShadow = true; scene.add(t); segs.torso = t; }
  seg('neck', .05, .05);
  const head = ball(.1), pelvis = ball(.15); pelvis.scale.set(1, .75, 1.15);
  const shBalls = [ball(.06), ball(.06)], kneeBalls = [ball(.06), ball(.06)], elbBalls = [ball(.045), ball(.045)], handBalls = [ball(.04), ball(.04)], ankBalls = [ball(.045), ball(.045)];
  const glow = c => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(6), toneMapped: false });
  const markers = { knee: ball(.028, glow(COL.knee)), hip: ball(.03, glow(COL.hip)), back: ball(.03, glow(COL.back)), elbow: ball(.026, glow(COL.elbow)) };
  Object.values(markers).forEach(m => m.castShadow = false);
  const feet = [-1, 1].map(() => { const f = new THREE.Mesh(new THREE.BoxGeometry(.26, .06, .1), skin); f.castShadow = true; scene.add(f); return f; });

  // Splash particles at each catch.
  const SPL = 260, sg = new THREE.BufferGeometry(), spos = new Float32Array(SPL * 3), svel = new Float32Array(SPL * 3), slife = new Float32Array(SPL);
  sg.setAttribute('position', new THREE.BufferAttribute(spos, 3));
  const splash = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: .035, transparent: true, opacity: .85, depthWrite: false })); scene.add(splash);
  let sNext = 0; const burst = (p, k) => { for (let i = 0; i < k; i++) { const j = sNext++ % SPL; spos.set([p.x, p.y, p.z], j * 3); svel.set([(Math.random() - .5) * 1.2, 1 + Math.random() * 1.6, (Math.random() - .5) * 1.2], j * 3); slife[j] = .6 + Math.random() * .4; } };

  const composer = new EffectComposer(renderer); composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), .6, .4, 2.2); composer.addPass(bloom); composer.addPass(new OutputPass());

  // Camera chapters: [offset from rower hip, look-at target name, field of view]
  const SHOTS = [
    { pos: [3.4, 0.95, 5.4], look: 'hip', fov: 32, drift: .25 },
    { pos: [0.1, 0.75, 4.2], look: 'hip', fov: 34 },
    { pos: [-0.4, 0.55, 1.6], look: 'knee', fov: 36 },
    { pos: [0.6, 0.85, 1.8], look: 'hip', fov: 36 },
    { pos: [-1.5, 1.25, 1.5], look: 'elb', fov: 38 },
    { pos: [-2.2, 4.2, 3.2], look: 'hip', fov: 40 },
    { pos: [-9, 2.4, 10], look: 'hip', fov: 30, drift: .35 },
  ];
  let shot = 0; const camPos = new THREE.Vector3(3.4, 0.95, 5.4), camLook = new THREE.Vector3(), tmp = new THREE.Vector3();
  let dist = 0, last = performance.now(), time = 0, prevDrive = false; const J = {}, angles = {};

  function pose(t) {
    const { L, B, A } = parts(t);
    const hipX = -.5 + .44 * L; seat.position.set(hipX, .215, 0);
    const hipC = new THREE.Vector3(hipX, .36, 0);
    const lean = THREE.MathUtils.degToRad(30 - 52 * B); // + = towards the stern
    const up = new THREE.Vector3(-Math.sin(lean), Math.cos(lean), 0);
    const shC = hipC.clone().add(up.clone().multiplyScalar(.52));
    // Oar sweep follows the handle travel: legs carry most of it, then back, then arms.
    const prog = .55 * L + .27 * B + .18 * A;
    const phi = THREE.MathUtils.degToRad(52 - 66 * prog); // handle angle towards the stern
    const inWater = t < .38 ? 1 : (t > .97 ? (t - .97) / .03 : 0);
    const bladeY = THREE.MathUtils.lerp(.22, -.06, Math.min(1, inWater * 1.4));
    const pitch = Math.atan2(PIN.y - bladeY, OUTB); // oar tilts so the blade sits in or above water
    const feather = t > .4 && t < .93 ? Math.min(1, (t - .4) / .05, (.93 - t) / .05) : 0;
    const out = {};
    oars.forEach(o => {
      o.pivot.rotation.set(0, o.sd * phi, 0);
      o.arm.rotation.set(o.sd * pitch, 0, 0); o.blade.rotation.z = feather * Math.PI / 2;
      const handle = new THREE.Vector3(0, 0, -o.sd * (INB - .06)); o.arm.localToWorld(handle); boat.worldToLocal(handle);
      const bl = new THREE.Vector3(0, 0, o.sd * (OUTB - .2)); o.arm.localToWorld(bl); out['blade' + o.sd] = bl;
      out['hand' + o.sd] = handle;
    });
    const sides = [-1, 1].map(sd => {
      const z = sd * .1, hip = hipC.clone().setZ(z), ank = new THREE.Vector3(-1.02, .27, sd * .1);
      const knee = ik(hip, ank, .46, .45, new THREE.Vector3(.2, 1, 0));
      const sh = shC.clone().setZ(sd * .19), hand = out['hand' + sd].clone(); hand.z = THREE.MathUtils.clamp(hand.z, -.25, .25) + sd * .02;
      const elb = ik(sh, hand, .3, .29, new THREE.Vector3(.4, -1, sd * .8));
      return { hip, ank, knee, sh, hand, elb };
    });
    const W = p => boat.localToWorld(p.clone());
    sides.forEach((s, i) => {
      const S = i ? 'R' : 'L';
      place(segs['thigh' + S], W(s.hip), W(s.knee)); place(segs['shin' + S], W(s.knee), W(s.ank));
      place(segs['upper' + S], W(s.sh), W(s.elb)); place(segs['fore' + S], W(s.elb), W(s.hand));
      kneeBalls[i].position.copy(W(s.knee)); elbBalls[i].position.copy(W(s.elb)); handBalls[i].position.copy(W(s.hand)); shBalls[i].position.copy(W(s.sh)); ankBalls[i].position.copy(W(s.ank));
      feet[i].position.copy(W(s.ank.clone().add(new THREE.Vector3(.02, .05, 0)))); feet[i].rotation.z = -.7;
    });
    place(segs.torso, W(hipC.clone().add(up.clone().multiplyScalar(-.04))), W(shC.clone().add(up.clone().multiplyScalar(.04)))); segs.torso.scale.x = .72; segs.torso.scale.z = 1.05;
    const neckTop = shC.clone().add(up.clone().multiplyScalar(.14)); place(segs.neck, W(shC), W(neckTop));
    head.position.copy(W(neckTop.clone().add(up.clone().multiplyScalar(.09)).add(new THREE.Vector3(-.03, 0, 0))));
    pelvis.position.copy(W(hipC)); pelvis.rotation.z = lean;
    const n = sides[1];
    markers.knee.position.copy(W(n.knee)).add(new THREE.Vector3(0, 0, .07)); markers.hip.position.copy(W(n.hip)).add(new THREE.Vector3(0, 0, .1));
    markers.back.position.copy(W(n.sh)).add(new THREE.Vector3(0, 0, .07)); markers.elbow.position.copy(W(n.elb)).add(new THREE.Vector3(0, 0, .05));
    Object.assign(J, { hip: W(n.hip), knee: W(n.knee), ank: W(n.ank), sh: W(n.sh), elb: W(n.elb), hand: W(n.hand), up: W(n.hip.clone().add(new THREE.Vector3(0, .55, 0))) });
    const ang = (a, b, c) => THREE.MathUtils.radToDeg(a.clone().sub(b).angleTo(c.clone().sub(b)));
    angles.knee = ang(n.hip, n.knee, n.ank); angles.hip = ang(n.sh, n.hip, n.knee); angles.elbow = ang(n.sh, n.elb, n.hand); angles.back = 30 - 52 * B;
    angles.phase = t < .03 ? 'Catch' : t < .38 ? 'Drive' : t < .43 ? 'Finish' : 'Recovery';
    return { drive: t < .38, blades: [out['blade-1'], out.blade1] };
  }

  let lastW = 0, lastH = 0;
  function resize() {
    const r = canvas.getBoundingClientRect(), w = Math.max(1, r.width), h = Math.max(1, r.height);
    if (w === lastW && h === lastH) return; lastW = w; lastH = h;
    renderer.setSize(w, h, false); composer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    const d = Math.min(2, devicePixelRatio); overlay.width = w * d; overlay.height = h * d;
  }
  addEventListener('resize', resize); resize();

  const g2 = overlay.getContext('2d');
  function screen(p) { const v = p.clone().project(camera); return [(v.x * .5 + .5) * overlay.width, (-v.y * .5 + .5) * overlay.height, v.z]; }
  function arc(c, p, q, r, label, col, a) {
    const a1 = Math.atan2(p[1] - c[1], p[0] - c[0]), a2 = Math.atan2(q[1] - c[1], q[0] - c[0]); let d = a2 - a1; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    const g = g2; g.save(); g.globalAlpha = a; g.strokeStyle = col; g.lineWidth = Math.max(2, r * .045); g.fillStyle = col + '33';
    g.beginPath(); g.moveTo(...c); g.arc(c[0], c[1], r, a1, a1 + d, d < 0); g.closePath(); g.fill(); g.stroke();
    const am = a1 + d / 2, fs = Math.max(15, Math.min(34, r * .32)), tx = c[0] + Math.cos(am) * r * 1.45, ty = c[1] + Math.sin(am) * r * 1.45;
    g.font = `800 ${fs}px "Bricolage Grotesque",sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    const w = g.measureText(label).width + fs * .7; g.fillStyle = '#000000b0'; g.beginPath(); g.roundRect(tx - w / 2, ty - fs * .7, w, fs * 1.4, fs * .35); g.fill();
    g.fillStyle = col; g.fillText(label, tx, ty + fs * .04); g.restore();
  }
  const shown = { knee: 0, hip: 0, back: 0, elbow: 0 }; let want = [];

  function frame(now, reduce) {
    resize();
    const dt = Math.min(.05, (now - last) / 1000); last = now; time += reduce ? 0 : dt;
    const t = (time / STROKE_S) % 1;
    const res = pose(t);
    // Boat run: surges on the drive, checks slightly at the catch.
    const speed = 4.3 + 1.1 * Math.sin(Math.PI * Math.min(1, t / .5)) - .6 * Math.max(0, 1 - Math.abs(t - .98) / .06);
    dist += speed * dt;
    world.position.x = -(dist % PERIOD); buoys.position.x = -(dist % BP); water.position.x = -(dist % 400);
    water.material.uniforms.time.value = time * .6;
    if (res.drive && !prevDrive) res.blades.forEach(b => burst(boat.localToWorld(b.clone()).setY(0), 40));
    prevDrive = res.drive;
    for (let i = 0; i < SPL; i++) { if (slife[i] <= 0) { spos[i * 3 + 1] = -10; continue; } slife[i] -= dt; svel[i * 3 + 1] -= 9.8 * dt; spos[i * 3] += (svel[i * 3] - speed) * dt; spos[i * 3 + 1] = Math.max(-.02, spos[i * 3 + 1] + svel[i * 3 + 1] * dt); spos[i * 3 + 2] += svel[i * 3 + 2] * dt; }
    sg.attributes.position.needsUpdate = true;
    // Camera glides to the chapter's shot and keeps a slow drift so it never feels static.
    const S = SHOTS[shot], target = J[S.look] || J.hip, k = reduce ? 1 : 1 - Math.pow(.0015, dt);
    const drift = S.drift ? Math.sin(time * .15) * S.drift : Math.sin(time * .3) * .05;
    tmp.set(S.pos[0] + drift * 4, S.pos[1], S.pos[2] - drift * 2).add(J.hip);
    camPos.lerp(tmp, k); camLook.lerp(target, k); camera.fov += (S.fov - camera.fov) * k; camera.updateProjectionMatrix();
    camera.position.copy(camPos); camera.lookAt(camLook);
    key.target.position.copy(J.hip); key.position.copy(J.hip).add(sun.clone().multiplyScalar(40));
    composer.render();
    // 2D overlay: angle arcs fade in and out per chapter.
    g2.clearRect(0, 0, overlay.width, overlay.height);
    const P = {}; for (const k2 in J) P[k2] = screen(J[k2]);
    const body = Math.hypot(P.sh[0] - P.hip[0], P.sh[1] - P.hip[1]);
    for (const a in shown) shown[a] += ((want.includes(a) ? 1 : 0) - shown[a]) * Math.min(1, dt * 5);
    const R = body * .42;
    if (shown.knee > .02) arc(P.knee, P.hip, P.ank, R, Math.round(angles.knee) + '°', COL.knee, shown.knee);
    if (shown.hip > .02) arc(P.hip, P.sh, P.knee, R * .8, Math.round(angles.hip) + '°', COL.hip, shown.hip);
    if (shown.back > .02) { g2.save(); g2.globalAlpha = shown.back * .8; g2.strokeStyle = COL.back; g2.setLineDash([6, 6]); g2.lineWidth = 2; g2.beginPath(); g2.moveTo(...P.hip); g2.lineTo(...P.up); g2.stroke(); g2.restore();
      arc(P.hip, P.up, P.sh, R * 1.2, (angles.back > 0 ? '+' : '') + Math.round(angles.back) + '°', COL.back, shown.back); }
    if (shown.elbow > .02) arc(P.elb, P.sh, P.hand, R * .6, Math.round(angles.elbow) + '°', COL.elbow, shown.elbow);
  }
  return {
    frame, angles,
    setShot(n, angleList) { shot = Math.max(0, Math.min(SHOTS.length - 1, n)); want = angleList || []; },
  };
}

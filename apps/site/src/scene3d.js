// Home page 3D scene: a graphite athlete sculling a single at dawn.
// Motion comes from src/stroke.js (fitted to elite sculling), not from tracking, so it is perfectly smooth.
import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { buildBoat } from './boat3d.js';
import { createWater } from './water.js';
import { createRower } from './rower3d.js';
import { stroke } from './stroke.js';
import { ANKLE, HIP_Y, SEAT_TOP, STRETCHER } from './rig.js';

export const COL = { hl: '#35d07f', knee: '#ffb547', hip: '#5cc8ff', back: '#c49bff', elbow: '#ff7ab6' };
const STROKE_S = 2.3;   // seconds per stroke (26 strokes a minute)
const BOAT_V = 4.4;     // mean hull speed, m/s
const R2D = 180 / Math.PI;

// Test switches: /?shot=3&t=0.25#home freezes chapter 3 at a quarter of the way through the stroke.
const QS = new URLSearchParams(location.search);
// &cam=x,y,z,fov,look sets a free camera (offset from the hips).
const FIX_CAM = QS.has('cam') ? QS.get('cam').split(',') : null;
const FIX_T = QS.has('t') && !isNaN(parseFloat(QS.get('t'))) ? parseFloat(QS.get('t')) : null, FIX_SHOT = QS.has('shot') ? parseInt(QS.get('shot')) : null;

// Graphite "sculpture" body. The model's vertex colour marks the kit, which is a shade darker and glossier.
function athleteMaterial() {
  const m = new THREE.MeshPhysicalMaterial({ color: 0x7d8480, roughness: .6, metalness: .0, sheen: .7, sheenRoughness: .45, sheenColor: new THREE.Color(0x9fb0a6), vertexColors: true });
  m.onBeforeCompile = sh => {
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <color_fragment>', 'float kit = smoothstep(.35, .65, vColor.r); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.028, .034, .031), kit);')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = mix(roughnessFactor, .42, kit);');
  };
  return m;
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

  const lake = createWater({ sun }), water = lake.mesh; scene.add(water);

  // Lane buoys every 12.5 m on both sides of the lane.
  const buoys = new THREE.Group(); scene.add(buoys); const BP = 12.5;
  const buoyGeo = new THREE.SphereGeometry(.09, 16, 12), bw = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: .35 }), bo = new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: .35 });
  for (let i = -24; i <= 24; i++) for (const z of [-6.5, 6.5]) { const b = new THREE.Mesh(buoyGeo, Math.abs(i) % 4 == 0 ? bo : bw); b.position.set(i * BP, .02, z); buoys.add(b); }

  const B = buildBoat(); const boat = B.boat, seat = B.seat, oars = B.oars; scene.add(boat);
  const RW = createRower(boat, athleteMaterial());

  // Glowing joint markers on the near side (the rower's left, which faces the cameras).
  const glow = c => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(2.4), toneMapped: false });
  const mark = (r, c) => { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), glow(c)); m.visible = false; m.layers.enable(1); scene.add(m); return m; };
  const markers = { knee: mark(.016, COL.knee), hip: mark(.017, COL.hip), back: mark(.017, COL.back), elbow: mark(.014, COL.elbow) };

  // Splash particles at each catch.
  const SPL = 260, sg = new THREE.BufferGeometry(), spos = new Float32Array(SPL * 3), svel = new Float32Array(SPL * 3), slife = new Float32Array(SPL);
  sg.setAttribute('position', new THREE.BufferAttribute(spos, 3));
  const splash = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: .018, transparent: true, opacity: .7, depthWrite: false })); scene.add(splash);
  let sNext = 0; const burst = (p, k) => { for (let i = 0; i < k; i++) { const j = sNext++ % SPL; spos.set([p.x, p.y, p.z], j * 3); svel.set([(Math.random() - .5) * .9 + (p.vx || 0), .5 + Math.random() * .9, (Math.random() - .5) * .9], j * 3); slife[j] = .25 + Math.random() * .3; } };

  // Glow only for the joint markers: they are drawn alone (hidden where the body covers them), blurred, and added on top.
  // The sky never blooms, so the picture stays crisp when the camera looks towards the light.
  const depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false });
  class MarkerPass extends Pass {
    constructor() { super(); this.needsSwap = false; }
    render(r, _w, readBuffer) {
      const bg = scene.background, ac = r.autoClear; scene.background = null; water.visible = splash.visible = false;
      r.setRenderTarget(readBuffer); r.setClearColor(0x000000, 1); r.clear();
      scene.overrideMaterial = depthOnly; r.render(scene, camera); scene.overrideMaterial = null;
      r.autoClear = false; camera.layers.set(1); r.render(scene, camera); camera.layers.set(0); r.autoClear = ac;
      scene.background = bg; water.visible = splash.visible = true;
    }
  }
  const glowComposer = new EffectComposer(renderer); glowComposer.renderToScreen = false;
  glowComposer.addPass(new MarkerPass()); glowComposer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 1.0, .5, 0));
  const composer = new EffectComposer(renderer); composer.addPass(new RenderPass(scene, camera));
  const addGlow = new ShaderPass({ uniforms: { tDiffuse: { value: null }, tGlow: { value: glowComposer.readBuffer.texture } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: 'uniform sampler2D tDiffuse, tGlow; varying vec2 vUv; void main(){ gl_FragColor = texture2D(tDiffuse, vUv) + vec4(texture2D(tGlow, vUv).rgb, 0.); }' });
  addGlow.uniforms.tGlow.value = glowComposer.readBuffer.texture; // (ShaderPass clones its uniforms and drops render-target textures)
  composer.addPass(addGlow); composer.addPass(new OutputPass());
  renderer.shadowMap.autoUpdate = false;

  // Camera chapters: offset from the rower's hips, what to look at, field of view.
  const SHOTS = [
    { pos: [3.4, 0.95, 5.4], look: 'hip', fov: 32, drift: .25 },
    { pos: [0.1, 0.75, 4.2], look: 'hip', fov: 34 },
    { pos: [-0.4, 0.55, 1.6], look: 'knee', fov: 36 },
    { pos: [0.6, 0.85, 1.8], look: 'hip', fov: 36 },
    { pos: [-1.5, 1.25, 1.5], look: 'elb', fov: 38 },
    { pos: [-2.2, 4.2, 3.2], look: 'hip', fov: 40 },
    { pos: [-9, 2.4, 10], look: 'hip', fov: 30, drift: .35 },
  ];
  let shot = FIX_SHOT ?? 0; const camPos = new THREE.Vector3(3.4, 0.95, 5.4), camLook = new THREE.Vector3(), tmp = new THREE.Vector3();
  let dist = 0, last = performance.now(), time = 0, prevDrive = false; const J = {}, angles = { knee: 0, hip: 0, back: 0, elbow: 0, phase: 'Catch' };
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const ang = (a, b, c) => R2D * a.clone().sub(b).angleTo(c.clone().sub(b));
  // Feet lie on the stretcher plate: the ankle-to-toe line dips towards the plate by the foot's own wedge angle.
  const FA = STRETCHER.angle - .46, footDir = V3(-Math.cos(FA), Math.sin(FA), 0), sole = V3(-Math.sin(STRETCHER.angle), -Math.cos(STRETCHER.angle), 0);

  function pose(t) {
    const s = stroke(t);
    seat.position.set(s.hipX + .015, SEAT_TOP - .0125, 0);
    const side = {};
    oars.forEach(o => {
      const d = s.oars[o.sd > 0 ? 1 : 0], cp = Math.cos(d.pitch);
      o.pivot.rotation.set(0, o.sd * d.phi, 0); o.arm.rotation.set(o.sd * d.pitch, 0, 0); o.blade.rotation.z = d.feather * Math.PI / 2;
      side[o.sd > 0 ? 'l' : 'r'] = {
        ankle: V3(ANKLE.x, ANKLE.y, o.sd * ANKLE.z), footDir, sole, kneePole: V3(0, 1, o.sd * .1),
        grip: V3(...d.grip), handle: V3(-cp * Math.sin(d.phi), Math.sin(d.pitch), -o.sd * cp * Math.cos(d.phi)),
        pole: V3(.45, -.4, o.sd), roll: o.sd * d.feather * .3,
      };
    });
    const hipC = V3(s.hipX, HIP_Y, 0);
    boat.updateMatrixWorld(true);
    const P = RW.pose({ hip: hipC, lean: s.lean, flex: THREE.MathUtils.lerp(.3, .04, s.B), head: -.06, reach: s.reach, sides: side });
    if (P) {
      const q = P.l, z = boat.getWorldDirection(V3()); // boat z axis = towards the camera side
      markers.knee.position.copy(q.knee).addScaledVector(z, .068); markers.hip.position.copy(q.hip).addScaledVector(z, .085);
      markers.back.position.copy(q.sh).addScaledVector(z, .062); markers.elbow.position.copy(q.elb).addScaledVector(z, .05);
      for (const k in markers) markers[k].visible = true;
      Object.assign(J, { hip: q.hip, knee: q.knee, ank: q.ankle, sh: q.sh, elb: q.elb, hand: q.hand, up: q.hip.clone().add(V3(0, .55, 0)), ready: true });
      angles.knee = ang(q.hip, q.knee, q.ankle); angles.hip = ang(q.sh, q.hip, q.knee); angles.elbow = ang(q.sh, q.elb, q.hand);
    } else {
      const h = boat.localToWorld(hipC.clone()); Object.assign(J, { hip: h, knee: h, ank: h, sh: h, elb: h, hand: h, up: h });
    }
    angles.back = s.lean * R2D; angles.phase = s.phase;
    return { s, blades: s.oars.map(o => V3(...o.blade)) };
  }

  let lastW = 0, lastH = 0;
  function resize() {
    const r = canvas.getBoundingClientRect(), w = Math.max(1, r.width), h = Math.max(1, r.height);
    if (w === lastW && h === lastH) return; lastW = w; lastH = h;
    renderer.setSize(w, h, false); composer.setSize(w, h); glowComposer.setSize(Math.ceil(w / 2), Math.ceil(h / 2)); camera.aspect = w / h; camera.updateProjectionMatrix();
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
    const t = FIX_T ?? (time / STROKE_S) % 1;
    const res = pose(t), s = res.s;
    // Boat run: checks just after the catch, runs on through the early recovery.
    const speed = BOAT_V * s.speed;
    dist += speed * dt;
    buoys.position.x = -(dist % BP);
    // Water: flows past at hull speed; the working blades churn it and leave a puddle each at the release.
    lake.update(dt, time, speed * dt, s.speed);
    res.blades.forEach((b, i) => lake.blade(i, b.x, b.z, s.drive ? s.buried * (.35 + .65 * Math.sin(Math.PI * Math.min(1, s.t / .4))) : 0));
    if (s.drive && !prevDrive) res.blades.forEach(b => burst(boat.localToWorld(b.clone()).setY(0), 14));
    if (!s.drive && prevDrive) res.blades.forEach(b => { lake.puddle(b.x, b.z, 1); burst(boat.localToWorld(b.clone()).setY(0), 8); });
    prevDrive = s.drive;
    for (let i = 0; i < SPL; i++) { if (slife[i] <= 0) { spos[i * 3 + 1] = -10; continue; } slife[i] -= dt; svel[i * 3 + 1] -= 9.8 * dt; spos[i * 3] += (svel[i * 3] - speed) * dt; spos[i * 3 + 1] = Math.max(-.02, spos[i * 3 + 1] + svel[i * 3 + 1] * dt); spos[i * 3 + 2] += svel[i * 3 + 2] * dt; }
    sg.attributes.position.needsUpdate = true;
    // Camera glides to the chapter's shot and keeps a slow drift so it never feels static.
    const S = FIX_CAM ? { pos: FIX_CAM.slice(0, 3).map(Number), fov: +FIX_CAM[3] || 30, look: FIX_CAM[4] || 'hip' } : SHOTS[shot], target = J[S.look] || J.hip, k = reduce || FIX_T != null ? 1 : 1 - Math.pow(.0015, dt);
    const drift = S.drift ? Math.sin(time * .15) * S.drift : Math.sin(time * .3) * .05;
    tmp.set(S.pos[0] + drift * 4, S.pos[1], S.pos[2] - drift * 2).add(J.hip);
    camPos.lerp(tmp, k); camLook.lerp(target, k); camera.fov += (S.fov - camera.fov) * k; camera.updateProjectionMatrix();
    camera.position.copy(camPos); camera.lookAt(camLook);
    key.target.position.copy(J.hip); key.position.copy(J.hip).add(sun.clone().multiplyScalar(40));
    renderer.shadowMap.needsUpdate = true;
    glowComposer.render(); composer.render();
    // 2D overlay: angle arcs fade in and out per chapter.
    g2.clearRect(0, 0, overlay.width, overlay.height);
    if (!J.ready) return;
    const P = {}; for (const k2 in J) if (J[k2].isVector3) P[k2] = screen(J[k2]);
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
    setShot(n, angleList) { shot = FIX_SHOT ?? Math.max(0, Math.min(SHOTS.length - 1, n)); want = angleList || []; },
  };
}

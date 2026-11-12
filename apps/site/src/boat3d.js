// A racing single scull modelled on Filippi / Empacher / Falcon photos:
// 8.2 m knife-edged hull, crowned white deck with a stripe and "Y" mark,
// open carbon cockpit, back-mounted V wing rigger, and cleaver-bladed sculls.
// Boat-local axes: +x towards the bow, y up (0 = waterline), z across.
import * as THREE from 'three';
import { PIN, INB, OUTB, PIN_LEFT_UP, SEAT_TOP, STRETCHER, HIP_CATCH, TRAVEL } from './rig.js';

const HALF = 4.1;          // half length
const BEAM = .146;          // half beam at the widest point
const COCK = [STRETCHER.heel.x - .31, HIP_CATCH + TRAVEL + .25]; // cockpit opening, stern end to bow end
const SEAT_DECK = SEAT_TOP - .062, FOOTWELL = STRETCHER.heel.y - .012; // the slides sit on a raised deck; the feet sit low
const wellEnd = HIP_CATCH - .16;
const floorY = x => FOOTWELL + (SEAT_DECK - FOOTWELL) * smooth(wellEnd - .07, wellEnd, x);
const GREEN = '#0f8a4c', GRIP = '#35d07f';

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// Plan shape: widest just behind the cockpit, long fine ends, knife-edge tips.
const halfBeam = x => { const u = x / HALF; const s = u > 0 ? Math.pow(1 - u, .9) * Math.pow(1 + u, .35) : Math.pow(1 + u, .9) * Math.pow(1 - u, .35); return BEAM * Math.min(1, s * 1.05) * smooth(-1, -.97, u) * (1 - smooth(.97, 1, u)) + .002; };
const deckY = x => .032 + .078 * Math.pow(1 - Math.pow(x / HALF, 2), .7); // sheer: about 11 cm of freeboard amidships
const keelY = x => -.1 * Math.pow(1 - Math.pow(x / HALF, 2), .45) - .02;   // shallow round bottom with a slight rocker

function canvasTex(w, h, draw, repeat) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); } return t; }

function deckTexture() {
  return canvasTex(4096, 128, (g, w, h) => {
    g.fillStyle = '#f5f5f2'; g.fillRect(0, 0, w, h);
    const ux = x => (x + HALF) / (2 * HALF) * w, mid = h / 2;
    g.fillStyle = GREEN;
    // centre stripe on both decks, running into the bow and stern
    g.fillRect(ux(-HALF + .3), mid - 4, ux(COCK[0] - .25) - ux(-HALF + .3), 8);
    g.fillRect(ux(COCK[1] + .9), mid - 4, ux(HALF - .25) - ux(COCK[1] + .9), 8);
    // the "Y": the bow stripe splits into two arms that reach the cockpit corners
    g.beginPath(); g.moveTo(ux(COCK[1] + .9), mid - 4); g.lineTo(ux(COCK[1] + .15), 10); g.lineTo(ux(COCK[1] + .15), 22); g.lineTo(ux(COCK[1] + .9), mid + 4);
    g.lineTo(ux(COCK[1] + .15), h - 22); g.lineTo(ux(COCK[1] + .15), h - 10); g.lineTo(ux(COCK[1] + .9), mid + 4); g.fill();
    g.fillRect(ux(COCK[1] + .15), 10, 6, 12); g.fillRect(ux(COCK[1] + .15), h - 22, 6, 12);
  });
}
function carbonTexture() {
  return canvasTex(256, 256, (g, w, h) => {
    for (let y = 0; y < h; y += 16) for (let x = 0; x < w; x += 16) { const on = ((x + y) / 16) % 2; const gr = g.createLinearGradient(x, y, x + 16, y + 16); gr.addColorStop(0, on ? '#22272a' : '#14181a'); gr.addColorStop(1, on ? '#15191b' : '#1d2224'); g.fillStyle = gr; g.fillRect(x, y, 16, 16); }
  }, [6, 6]);
}

// Loft the hull: one ring of points per station. Deck surface and topsides/bottom are separate meshes.
function hullGeometries() {
  const NX = 220, NS = 28, sides = [], deck = [], sideIdx = [], deckIdx = [], sideUV = [], deckUV = [];
  for (let i = 0; i <= NX; i++) {
    const x = -HALF + 2 * HALF * i / NX, b = halfBeam(x), dy = deckY(x), ky = keelY(x);
    // topsides + bottom: from the port gunwale down round the keel to the starboard gunwale
    for (let j = 0; j <= NS; j++) { const a = Math.PI * j / NS; const ca = Math.cos(a), z = -b * Math.sign(ca) * Math.pow(Math.abs(ca), .45), y = dy - .02 - (dy - .02 - ky) * Math.pow(Math.sin(a), 1.6); sides.push(x, y, z); sideUV.push(i / NX, j / NS); }
    // crowned deck: 9 points across
    for (let j = 0; j <= 8; j++) { const v = j / 8, z = -b + 2 * b * v; deck.push(x, dy + .012 * (1 - Math.pow(2 * v - 1, 2)) - (j == 0 || j == 8 ? .02 : 0), z); deckUV.push(i / NX, v); }
  }
  const inCock = x => x > COCK[0] && x < COCK[1];
  for (let i = 0; i < NX; i++) {
    for (let j = 0; j < NS; j++) { const a = i * (NS + 1) + j, b2 = a + NS + 1; sideIdx.push(a, b2, a + 1, b2, b2 + 1, a + 1); }
    const x = -HALF + 2 * HALF * (i + .5) / NX;
    for (let j = 0; j < 8; j++) { if (inCock(x) && j > 0 && j < 7) continue; const a = i * 9 + j, b2 = a + 9; deckIdx.push(a, a + 1, b2, b2, a + 1, b2 + 1); }
  }
  const mk = (pos, idx, uv) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); return g; };
  return { sides: mk(sides, sideIdx, sideUV), deck: mk(deck, deckIdx, deckUV) };
}

// Cleaver ("hatchet") blade: straight top edge, long lower edge, square tip, slight cup and a spine.
function bladeGeometry() {
  const s = new THREE.Shape();
  s.moveTo(0, -.012); s.bezierCurveTo(.09, -.02, .14, -.06, .2, -.155); s.lineTo(.47, -.19);
  s.quadraticCurveTo(.5, -.19, .5, -.16); s.lineTo(.5, .055); s.quadraticCurveTo(.5, .075, .47, .075);
  s.lineTo(.16, .06); s.bezierCurveTo(.09, .05, .05, .015, 0, .012); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: .005, bevelEnabled: true, bevelThickness: .002, bevelSize: .002, bevelSegments: 2, curveSegments: 24 });
  const p = g.attributes.position; // cup the face
  for (let i = 0; i < p.count; i++) { const u = p.getX(i), v = p.getY(i) + .06; p.setZ(i, p.getZ(i) + .9 * v * v * Math.min(1, u / .2)); }
  g.computeVertexNormals(); g.translate(0, 0, -.004);
  // UVs in metres across the blade so the tip band lines up
  const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) / .5, (p.getY(i) + .19) / .27);
  return g;
}
function bladeTexture() {
  return canvasTex(512, 256, (g, w, h) => { g.fillStyle = '#f2f2ee'; g.fillRect(0, 0, w, h); g.fillStyle = GREEN; g.fillRect(w * .86, 0, w * .14, h); g.fillStyle = '#d9dbd6'; g.fillRect(0, h * .55, w * .5, 3); });
}

export function buildBoat() {
  const boat = new THREE.Group();
  const white = new THREE.MeshPhysicalMaterial({ color: 0xf4f4f1, roughness: .16, clearcoat: 1, clearcoatRoughness: .05 });
  const deckMat = new THREE.MeshPhysicalMaterial({ map: deckTexture(), roughness: .2, clearcoat: 1, clearcoatRoughness: .06 });
  const carbonMap = carbonTexture();
  const carbonPlain = new THREE.MeshPhysicalMaterial({ color: 0x16191b, roughness: .3, metalness: .25, clearcoat: .9, clearcoatRoughness: .12 });
  const carbonWeave = new THREE.MeshPhysicalMaterial({ map: carbonMap, roughness: .4, metalness: .2, clearcoat: .6, side: THREE.DoubleSide });
  const alu = new THREE.MeshStandardMaterial({ color: 0xc8ccce, roughness: .25, metalness: .95 });
  const steel = new THREE.MeshStandardMaterial({ color: 0xdfe3e6, roughness: .18, metalness: 1 });
  const plastic = new THREE.MeshStandardMaterial({ color: 0x1d2123, roughness: .55 });
  const shadow = m => { m.castShadow = true; m.receiveShadow = true; return m; };
  const box = (w, h, d, mat, x = 0, y = 0, z = 0) => { const m = shadow(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)); m.position.set(x, y, z); return m; };
  // A straight strut from a to b with an oval section: `chord` wide, `thick` deep, thin side facing `up`.
  const strut = (a, b, chord, thick, mat, up = new THREE.Vector3(0, 1, 0)) => {
    const d = b.clone().sub(a), len = d.length(); d.normalize();
    const zc = up.clone().addScaledVector(d, -up.dot(d)).normalize(), xc = d.clone().cross(zc);
    const m = shadow(new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 20), mat)); m.scale.set(chord / 2, len, thick / 2);
    m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xc, d, zc)); m.position.copy(a).add(b).multiplyScalar(.5); return m;
  };
  const V = (x, y, z) => new THREE.Vector3(x, y, z);

  // Wet line: the bottom couple of centimetres of topside are darker and glossier, with an uneven edge.
  white.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vHull;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvHull = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vHull;')
      .replace('#include <color_fragment>', 'float wet = 1. - smoothstep(.012, .03, vHull.y + .006 * sin(vHull.x * 9.) + .003 * sin(vHull.x * 31.)); diffuseColor.rgb *= 1. - .3 * wet;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = mix(roughnessFactor, .04, wet);');
  };
  const g = hullGeometries();
  boat.add(shadow(new THREE.Mesh(g.sides, white)), shadow(new THREE.Mesh(g.deck, deckMat)));
  const ball = shadow(new THREE.Mesh(new THREE.SphereGeometry(.021, 16, 12), new THREE.MeshStandardMaterial({ color: 0xf6f6f2, roughness: .6 }))); ball.position.set(HALF + .012, deckY(HALF) - .015, 0); boat.add(ball);

  // Cockpit tub: walls that follow the hull's own taper, a deep footwell and a raised deck for the slides.
  const cxs = []; for (let i = 0; i <= 60; i++) cxs.push(COCK[0] + (COCK[1] - COCK[0]) * i / 60);
  const tub = [], tubIdx = [], push = (x, y, z) => { tub.push(x, y, z); return tub.length / 3 - 1; };
  const wallIn = x => halfBeam(x) - .012;
  for (const sd of [-1, 1]) {
    let prev = null;
    for (const x of cxs) {
      const cur = [push(x, deckY(x) - .002, sd * wallIn(x)), push(x, floorY(x), sd * wallIn(x) * .84)];
      if (prev) tubIdx.push(prev[0], cur[0], prev[1], cur[0], cur[1], prev[1]);
      prev = cur;
    }
  }
  const fl = []; for (const x of cxs) { const w = wallIn(x) * .84; fl.push(push(x, floorY(x), -w), push(x, floorY(x), w)); }
  for (let i = 0; i < cxs.length - 1; i++) tubIdx.push(fl[2 * i], fl[2 * i + 2], fl[2 * i + 1], fl[2 * i + 2], fl[2 * i + 3], fl[2 * i + 1]);
  for (const x of COCK) { const w = wallIn(x), t = deckY(x) - .002, q = [push(x, t, -w), push(x, t, w), push(x, floorY(x), w * .84), push(x, floorY(x), -w * .84)]; tubIdx.push(q[0], q[1], q[2], q[0], q[2], q[3]); }
  const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.Float32BufferAttribute(tub, 3)); tg.setIndex(tubIdx); tg.computeVertexNormals();
  const tuv = []; for (let i = 0; i < tub.length / 3; i++) tuv.push(tub[i * 3] * 2, tub[i * 3 + 1] * 4 + tub[i * 3 + 2] * 4); tg.setAttribute('uv', new THREE.Float32BufferAttribute(tuv, 2));
  boat.add(shadow(new THREE.Mesh(tg, carbonWeave)));
  // Gunwale lip round the opening, and a V splash guard on the bow deck behind the rower.
  for (const sd of [-1, 1]) {
    const pts = cxs.filter((_, i) => i % 3 == 0).map(x => V(x, deckY(x) + .004, sd * (halfBeam(x) - .007)));
    boat.add(shadow(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, .0065, 8), carbonPlain)));
    const gx = COCK[1] + .02; boat.add(strut(V(gx, deckY(gx) + .012, sd * (halfBeam(gx) - .01)), V(gx + .2, deckY(gx + .2) + .014, 0), .006, .032, carbonPlain, V(0, 0, 1)));
  }
  for (const x of COCK) boat.add(strut(V(x, deckY(x) + .004, -halfBeam(x) + .007), V(x, deckY(x) + .004, halfBeam(x) - .007), .013, .013, carbonPlain));

  // Slides: two tracks on the seat deck, with end stops.
  const tr0 = HIP_CATCH - .13, tr1 = HIP_CATCH + TRAVEL + .16;
  for (const sd of [-1, 1]) {
    boat.add(box(tr1 - tr0, .014, .022, alu, (tr0 + tr1) / 2, SEAT_DECK + .007, sd * .088));
    for (const x of [tr0, tr1]) boat.add(box(.012, .022, .026, plastic, x, SEAT_DECK + .012, sd * .088));
  }
  // Seat: a shaped carbon top with two cut-outs, on an undercarriage with four wheels.
  const seat = new THREE.Group(); boat.add(seat);
  { const sh = new THREE.Shape(); const w = .15, l = .135; sh.moveTo(-l, -w + .03); sh.quadraticCurveTo(-l, -w, -l + .03, -w); sh.lineTo(l - .04, -w); sh.quadraticCurveTo(l, -w, l, -w + .04);
    sh.lineTo(l, w - .04); sh.quadraticCurveTo(l, w, l - .04, w); sh.lineTo(-l + .03, w); sh.quadraticCurveTo(-l, w, -l, w - .03); sh.closePath();
    for (const sd of [-1, 1]) { const h = new THREE.Path(); h.absellipse(.02, sd * .058, .045, .03, 0, Math.PI * 2); sh.holes.push(h); }
    const top = shadow(new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: .012, bevelEnabled: true, bevelThickness: .005, bevelSize: .005, bevelSegments: 2, curveSegments: 16 }), plastic));
    top.rotation.x = Math.PI / 2; top.position.y = .012; seat.add(top);
    seat.add(box(.2, .012, .2, plastic, 0, -.012, 0));
    for (const sx of [-1, 1]) { seat.add(box(.012, .012, .2, alu, sx * .075, -.026, 0));
      for (const sd of [-1, 1]) { const wh = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.017, .017, .014, 16), plastic)); wh.rotation.x = Math.PI / 2; wh.position.set(sx * .075, -.03, sd * .088); seat.add(wh); } }
  }

  // Foot stretcher: an angled carbon plate low in the footwell, bottom towards the rower and the top leaning away
  // to the stern, with the shoes fixed to it. In this group -x runs up the plate and +y points off it towards the rower.
  const st = new THREE.Group(); st.position.set(STRETCHER.heel.x, STRETCHER.heel.y, 0); st.rotation.z = -STRETCHER.angle; boat.add(st);
  const PL = .30, pw = wallIn(STRETCHER.heel.x - .1) * .84 - .004;
  st.add(box(PL, .008, pw * 2, carbonPlain, -PL / 2 + .01, -.005, 0));
  st.add(box(.02, .016, pw * 2, alu, -PL + .03, -.016, 0), box(.02, .016, pw * 2, alu, -.03, -.016, 0)); // cross rails behind the plate
  const shoeMat = new THREE.MeshPhysicalMaterial({ color: 0x17191b, roughness: .5, clearcoat: .25, clearcoatRoughness: .4 });
  const soleMat = new THREE.MeshStandardMaterial({ color: 0xe4e5e0, roughness: .6 });
  const shoeShape = new THREE.Shape(); // side profile: x = -(distance from heel towards the toe), y = height off the plate
  shoeShape.moveTo(.004, .012); shoeShape.lineTo(-.262, .012); shoeShape.quadraticCurveTo(-.292, .014, -.29, .04); shoeShape.quadraticCurveTo(-.286, .064, -.245, .07);
  shoeShape.lineTo(-.15, .098); shoeShape.quadraticCurveTo(-.125, .108, -.105, .1); shoeShape.quadraticCurveTo(-.05, .078, -.012, .104); shoeShape.quadraticCurveTo(.02, .075, .004, .012);
  const shoeGeo = new THREE.ExtrudeGeometry(shoeShape, { depth: .056, bevelEnabled: true, bevelThickness: .016, bevelSize: .012, bevelSegments: 4, curveSegments: 14 }); shoeGeo.translate(0, 0, -.028);
  for (const sd of [-1, 1]) {
    const shoe = shadow(new THREE.Mesh(shoeGeo, shoeMat)); shoe.position.z = sd * STRETCHER.footHalf; st.add(shoe);
    st.add(box(.292, .012, .084, soleMat, -.142, .006, sd * STRETCHER.footHalf));
    st.add(box(.05, .003, .094, plastic, -.19, .086, sd * STRETCHER.footHalf)); // strap across the forefoot
  }

  // Back-mounted wing rigger: two straight carbon arms from a foot on the bow deck out to the pins, a V from above.
  const mx = COCK[1] + .07, my = deckY(mx) + .03;
  boat.add(box(.11, .03, .2, carbonPlain, mx, my - .008, 0));
  for (const sd of [-1, 1]) {
    const sill = V(PIN.x + .012, PIN.y + sd * PIN_LEFT_UP - .052, sd * (PIN.z - .004)), shoulder = V(mx - .02, my, sd * .1);
    boat.add(strut(shoulder, sill, .062, .02, carbonPlain));
    boat.add(strut(V(mx, my, 0), shoulder, .07, .022, carbonPlain));
    boat.add(box(.07, .012, .05, carbonPlain, PIN.x, sill.y, sd * PIN.z));
    const pin = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.0065, .0065, .14, 12), steel)); pin.position.set(PIN.x, sill.y + .07, sd * PIN.z); boat.add(pin);
    const nut = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.011, .011, .012, 6), steel)); nut.position.set(PIN.x, sill.y + .142, sd * PIN.z); boat.add(nut);
  }

  // Sculls: pivot at the pin; arm pitches the oar; blade group feathers.
  const shaftMat = new THREE.MeshPhysicalMaterial({ color: 0x111416, roughness: .28, metalness: .3, clearcoat: 1, clearcoatRoughness: .1 });
  const sleeveMat = new THREE.MeshStandardMaterial({ color: 0xe9eae4, roughness: .5 });
  const gripMat = new THREE.MeshStandardMaterial({ color: GRIP, roughness: .85 });
  const gateMat = new THREE.MeshStandardMaterial({ color: 0x23282a, roughness: .45 });
  const bladeMat = new THREE.MeshPhysicalMaterial({ map: bladeTexture(), roughness: .25, clearcoat: 1, clearcoatRoughness: .08, side: THREE.DoubleSide });
  const bladeGeo = bladeGeometry();
  const along = (len, r1, r2, mat, z0) => { const m = shadow(new THREE.Mesh(new THREE.CylinderGeometry(r2, r1, len, 20), mat)); m.rotation.x = Math.PI / 2; m.position.z = z0 + len / 2; return m; };
  const oars = [-1, 1].map(sd => {
    const pivot = new THREE.Group(); pivot.position.set(PIN.x, PIN.y + sd * PIN_LEFT_UP, sd * PIN.z); boat.add(pivot);
    const arm = new THREE.Group(); pivot.add(arm);
    const inner = new THREE.Group(); inner.scale.z = sd; arm.add(inner); // build along +z, mirror for port
    inner.add(along(INB - .13, .0175, .019, shaftMat, -INB + .13));     // inboard shaft
    inner.add(along(.135, .0175, .0175, gripMat, -INB));                 // grip
    const cap = shadow(new THREE.Mesh(new THREE.SphereGeometry(.0175, 14, 10), gripMat)); cap.position.z = -INB; cap.scale.z = .5; inner.add(cap);
    inner.add(along(.3, .0235, .0235, sleeveMat, -.11));                 // sleeve through the gate
    const collar = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.036, .036, .022, 24), sleeveMat)); collar.rotation.x = Math.PI / 2; collar.position.z = -.043; inner.add(collar);
    inner.add(along(OUTB - .49, .019, .0135, shaftMat, .19));            // outboard shaft, tapering to the neck
    const blade = new THREE.Group(); blade.position.z = OUTB - .52; inner.add(blade);
    const face = shadow(new THREE.Mesh(bladeGeo, bladeMat)); face.rotation.y = -Math.PI / 2; blade.add(face);
    const spine = shadow(new THREE.Mesh(new THREE.BoxGeometry(.008, .014, .26), shaftMat)); spine.position.set(-.006, -.02, .13); blade.add(spine);
    // Oarlock: a swivel round the pin with a flat back face, a sill under the sleeve and a gate bar over it.
    const lock = new THREE.Group(); pivot.add(lock);
    lock.add(box(.014, .07, .058, gateMat, -.031, 0, 0), box(.07, .012, .058, gateMat, 0, -.03, 0), box(.076, .008, .016, steel, .004, .037, 0), box(.012, .07, .02, gateMat, .034, 0, 0));
    return { sd, pivot, arm, blade };
  });
  return { boat, seat, oars, half: HALF, halfBeam, deckY };
}

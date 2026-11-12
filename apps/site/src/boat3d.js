// A racing single scull modelled on Filippi / Empacher / Falcon photos:
// 8.2 m knife-edged hull, crowned white deck with a stripe and "Y" mark,
// open carbon cockpit, back-mounted V wing rigger, and cleaver-bladed sculls.
// Boat-local axes: +x towards the bow, y up (0 = waterline), z across.
import * as THREE from 'three';

const HALF = 4.1;          // half length
const BEAM = .155;          // half beam at the widest point
const COCK = [-1.35, .45]; // cockpit opening, stern end to bow end
export const PIN = { x: -.52, y: .36, z: .8 };
export const INB = .88, OUTB = 2.0;
const GREEN = '#0f8a4c', GRIP = '#35d07f';

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// Plan shape: widest just behind the cockpit, long fine ends, knife-edge tips.
const halfBeam = x => { const u = x / HALF; const s = u > 0 ? Math.pow(1 - u, .9) * Math.pow(1 + u, .35) : Math.pow(1 + u, .9) * Math.pow(1 - u, .35); return BEAM * Math.min(1, s * 1.05) * smooth(-1, -.97, u) * (1 - smooth(.97, 1, u)) + .002; };
const deckY = x => .035 + .085 * Math.pow(1 - Math.pow(x / HALF, 2), .7); // sheer: higher in the middle
const keelY = x => -.13 * Math.pow(1 - Math.pow(x / HALF, 2), .45) - .005;   // slight rocker

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
  const carbon = new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: carbonMap, roughness: .35, metalness: .2, clearcoat: .8, clearcoatRoughness: .15 });
  const carbonPlain = new THREE.MeshPhysicalMaterial({ color: 0x16191b, roughness: .3, metalness: .25, clearcoat: .9, clearcoatRoughness: .12 });
  const alu = new THREE.MeshStandardMaterial({ color: 0xc8ccce, roughness: .25, metalness: .95 });
  const shadow = m => { m.castShadow = true; m.receiveShadow = true; return m; };

  const g = hullGeometries();
  boat.add(shadow(new THREE.Mesh(g.sides, white)), shadow(new THREE.Mesh(g.deck, deckMat)));

  // Cockpit tub: floor and walls that follow the hull's own taper, so nothing pokes out of the sides.
  const FLOOR = -.01, cxs = [];
  for (let i = 0; i <= 40; i++) cxs.push(COCK[0] + (COCK[1] - COCK[0]) * i / 40);
  const tub = [], tubIdx = [], push = (x, y, z) => { tub.push(x, y, z); return tub.length / 3 - 1; };
  for (const sd of [-1, 1]) {
    let prev = null;
    for (const x of cxs) {
      const w = halfBeam(x) - .014, top = deckY(x) - .004;
      const cur = [push(x, top, sd * w), push(x, FLOOR, sd * w * .82)];
      if (prev) tubIdx.push(prev[0], cur[0], prev[1], cur[0], cur[1], prev[1]);
      prev = cur;
    }
  }
  // floor and the two end bulkheads
  const fl = []; for (const x of cxs) { const w = (halfBeam(x) - .014) * .82; fl.push(push(x, FLOOR, -w), push(x, FLOOR, w)); }
  for (let i = 0; i < cxs.length - 1; i++) tubIdx.push(fl[2 * i], fl[2 * i + 2], fl[2 * i + 1], fl[2 * i + 2], fl[2 * i + 3], fl[2 * i + 1]);
  for (const x of COCK) { const w = halfBeam(x) - .014, t = deckY(x) - .004, q = [push(x, t, -w), push(x, t, w), push(x, FLOOR, w * .82), push(x, FLOOR, -w * .82)]; tubIdx.push(q[0], q[1], q[2], q[0], q[2], q[3]); }
  const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.Float32BufferAttribute(tub, 3)); tg.setIndex(tubIdx); tg.computeVertexNormals();
  const tuv = []; for (let i = 0; i < tub.length / 3; i++) tuv.push(tub[i * 3] * 2, tub[i * 3 + 1] * 4 + tub[i * 3 + 2] * 4); tg.setAttribute('uv', new THREE.Float32BufferAttribute(tuv, 2));
  boat.add(shadow(new THREE.Mesh(tg, new THREE.MeshPhysicalMaterial({ map: carbonMap, roughness: .4, metalness: .2, clearcoat: .6, side: THREE.DoubleSide }))));
  // Slide rails and stretcher
  for (const sd of [-1, 1]) { const rail = shadow(new THREE.Mesh(new THREE.BoxGeometry(.8, .012, .012), alu)); rail.position.set(-.3, .055, sd * .07); boat.add(rail); }
  const stretcher = new THREE.Group(); stretcher.position.set(-1.1, FLOOR + .01, 0); stretcher.rotation.z = -.72; boat.add(stretcher);
  const plate = shadow(new THREE.Mesh(new THREE.BoxGeometry(.01, .24, .18), alu)); plate.position.y = .12; stretcher.add(plate);
  for (const sd of [-1, 1]) {
    const bar = shadow(new THREE.Mesh(new THREE.BoxGeometry(.008, .24, .025), alu)); bar.position.set(.004, .12, sd * .1); stretcher.add(bar);
    const shoe = shadow(new THREE.Mesh(new THREE.CapsuleGeometry(.045, .2, 6, 16), new THREE.MeshPhysicalMaterial({ color: 0x1f4fd1, roughness: .45, clearcoat: .4 })));
    shoe.position.set(.04, .14, sd * .05); shoe.scale.set(.8, .95, .8); stretcher.add(shoe);
  }
  // Seat: carbon pan with two hip hollows
  const seat = new THREE.Group(); boat.add(seat);
  const pan = shadow(new THREE.Mesh(new THREE.BoxGeometry(.26, .025, .24), carbonPlain)); seat.add(pan);
  for (const sd of [-1, 1]) { const hole = new THREE.Mesh(new THREE.CircleGeometry(.045, 24), new THREE.MeshBasicMaterial({ color: 0x050607 })); hole.rotation.x = -Math.PI / 2; hole.position.set(.02, .0135, sd * .055); hole.scale.set(1.3, 1, 1); seat.add(hole); }

  // Back-mounted wing rigger: one swept carbon wing, a V seen from above.
  const wingPath = new THREE.CatmullRomCurve3([
    new THREE.Vector3(PIN.x + .02, PIN.y - .07, -PIN.z + .02), new THREE.Vector3(-.12, .2, -.48), new THREE.Vector3(.3, .135, -.15),
    new THREE.Vector3(.4, .13, 0), new THREE.Vector3(.3, .135, .15), new THREE.Vector3(-.12, .2, .48), new THREE.Vector3(PIN.x + .02, PIN.y - .07, PIN.z - .02)], false, 'centripetal');
  const prof = new THREE.Shape(); prof.absellipse(0, 0, .016, .045, 0, Math.PI * 2);
  const wing = shadow(new THREE.Mesh(new THREE.ExtrudeGeometry(prof, { steps: 160, extrudePath: wingPath, bevelEnabled: false }), carbonPlain)); boat.add(wing);
  for (const sd of [-1, 1]) {
    const pin = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.008, .008, .16, 12), alu)); pin.position.set(PIN.x, PIN.y - .02, sd * PIN.z); boat.add(pin);
  }

  // Sculls: pivot at the pin; arm pitches the oar; blade group feathers.
  const shaftMat = new THREE.MeshPhysicalMaterial({ color: 0x111416, roughness: .28, metalness: .3, clearcoat: 1, clearcoatRoughness: .1 });
  const sleeveMat = new THREE.MeshStandardMaterial({ color: 0xe9eae4, roughness: .5 });
  const gripMat = new THREE.MeshStandardMaterial({ color: GRIP, roughness: .85 });
  const bladeMat = new THREE.MeshPhysicalMaterial({ map: bladeTexture(), roughness: .25, clearcoat: 1, clearcoatRoughness: .08, side: THREE.DoubleSide });
  const bladeGeo = bladeGeometry();
  const along = (len, r1, r2, mat, z0) => { const m = shadow(new THREE.Mesh(new THREE.CylinderGeometry(r2, r1, len, 20), mat)); m.rotation.x = Math.PI / 2; m.position.z = z0 + len / 2; return m; };
  const oars = [-1, 1].map(sd => {
    const pivot = new THREE.Group(); pivot.position.set(PIN.x, PIN.y, sd * PIN.z); boat.add(pivot);
    const arm = new THREE.Group(); pivot.add(arm);
    const inner = new THREE.Group(); inner.scale.z = sd; arm.add(inner); // build along +z, mirror for port
    inner.add(along(INB - .12, .0175, .019, shaftMat, -INB + .12));     // inboard shaft
    inner.add(along(.14, .021, .021, gripMat, -INB));                    // grip
    inner.add(along(.32, .024, .024, sleeveMat, -.12));                  // sleeve through the gate
    const collar = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.034, .034, .03, 20), sleeveMat)); collar.rotation.x = Math.PI / 2; collar.position.z = -.09; inner.add(collar);
    inner.add(along(OUTB - .5, .019, .014, shaftMat, .2));               // outboard shaft, tapering to the neck
    const blade = new THREE.Group(); blade.position.z = OUTB - .52; inner.add(blade);
    const face = shadow(new THREE.Mesh(bladeGeo, bladeMat)); face.rotation.y = -Math.PI / 2; blade.add(face);
    const spine = shadow(new THREE.Mesh(new THREE.BoxGeometry(.008, .014, .26), shaftMat)); spine.position.set(-.006, -.02, .13); blade.add(spine);
    // gate (swivel) round the sleeve
    const gate = shadow(new THREE.Mesh(new THREE.BoxGeometry(.06, .07, .05), new THREE.MeshStandardMaterial({ color: 0x2b2f31, roughness: .5 }))); pivot.add(gate);
    return { sd, pivot, arm, blade };
  });

  return { boat, seat, oars, carbon: carbonPlain };
}

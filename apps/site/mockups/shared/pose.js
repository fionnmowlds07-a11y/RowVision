// The owner's real sculling stroke, read from the pose file and turned into the things the mock-ups draw.
// Nothing here is invented: every point is a measured joint, smoothed over a few frames.
// Shoulders and hips are the average of both sides, as in the engine. Knee, elbow and wrist come from the near side only:
// averaging the two arms puts the elbow on the chest whenever the arms are apart on screen (sweep rowing, or any angle off side-on).

const L = [5, 7, 9, 11, 13, 15], R = [6, 8, 10, 12, 14, 16];
export const BONES = [['wr', 'el'], ['el', 'sh'], ['sh', 'hp'], ['hp', 'kn'], ['kn', 'an']];
export const FAR_BONES = [[0, 1], [1, 2], [0, 3], [3, 4], [4, 5]];
const KEYS = ['sh', 'el', 'wr', 'hp', 'kn', 'an', 'hd'];

const deg = (a, b, c) => {
  const v1 = [a[0] - b[0], a[1] - b[1]], v2 = [c[0] - b[0], c[1] - b[1]];
  return Math.acos(Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / (Math.hypot(...v1) * Math.hypot(...v2) || 1)))) * 180 / Math.PI;
};
const tri = (arr, i, k, get) => { let x = 0, y = 0, n = 0; for (let d = -k; d <= k; d++) { const q = arr[i + d]; if (q) { const w = k + 1 - Math.abs(d), p = get(q); x += p[0] * w; y += p[1] * w; n += w; } } return [x / n, y / n]; };

export async function loadPose(url = '/data/pose-scull.json', hz) {
  const P = await (await fetch(url)).json();
  // a frame where the rower was lost borrows the nearest frame where they were found
  const ar = P.w / P.h, F = P.frames.map((f, i, all) => { for (let d = 0; !f && d < all.length; d++) f = all[i - d] || all[i + d]; return f; });
  let tL = 0, tR = 0; F.forEach(f => { L.forEach(i => tL += f[i][2]); R.forEach(i => tR += f[i][2]); });
  const near = tL >= tR ? L : R, far = tL >= tR ? R : L;
  const mid = (f, a, b) => [(f[a][0] + f[b][0]) / 2, (f[a][1] + f[b][1]) / 2];
  // As filmed: x and y as shares of the frame's width and height, y down.
  const raw = F.map(f => ({
    sh: mid(f, 5, 6), el: f[near[1]].slice(0, 2), wr: f[near[2]].slice(0, 2), hp: mid(f, 11, 12), kn: f[near[4]].slice(0, 2), an: f[near[5]].slice(0, 2),
    hd: [(f[0][0] + f[3][0] + f[4][0]) / 3, (f[0][1] + f[3][1] + f[4][1]) / 3], far: far.map(i => f[i].slice(0, 2)),
  }));
  const S = raw.map((_, i) => { const o = { far: raw[i].far.map((__, k) => tri(raw, i, 3, q => q.far[k])) }; KEYS.forEach(k => o[k] = tri(raw, i, 3, q => q[k])); return o; });
  const sc = p => [p[0] * ar, p[1]];
  const knee = S.map(b => deg(sc(b.hp), sc(b.kn), sc(b.an))), hip = S.map(b => deg(sc(b.sh), sc(b.hp), sc(b.kn))), elbow = S.map(b => deg(sc(b.sh), sc(b.el), sc(b.wr)));
  const facing = Math.sign(S.reduce((s, b) => s + b.an[0] - b.hp[0], 0)) || 1;
  const back = S.map(b => Math.atan2((b.sh[0] - b.hp[0]) * facing * ar, b.hp[1] - b.sh[1]) * 180 / Math.PI);

  // The rower's own frame: feet stay on the stretcher, so the ankle is the fixed point. Metres, y up.
  const leg = S.map(b => Math.hypot(...sub(sc(b.hp), sc(b.kn))) + Math.hypot(...sub(sc(b.kn), sc(b.an))));
  const body = S.map((b, i) => {
    const a = tri(S, i, 7, q => sc(q.an)); let s = 0, n = 0; for (let d = -20; d <= 20; d++) if (leg[i + d]) { s += leg[i + d]; n++; }
    const k = .9 / (s / n), o = { far: b.far.map(p => m(sc(p), a, k)) }; KEYS.forEach(key => o[key] = m(sc(b[key]), a, k)); return o;
  });

  const catches = [], finishes = [];
  for (let i = 4; i < knee.length - 4; i++) {
    if (knee[i] < 95 && knee.slice(i - 4, i + 5).every(v => v >= knee[i]) && (!catches.length || i - catches.at(-1) > 30)) catches.push(i);
  }
  for (let c = 0; c < catches.length - 1; c++) { let best = catches[c]; for (let i = catches[c]; i < catches[c + 1]; i++) if (elbow[i] < elbow[best]) best = i; finishes.push(best); }

  const N = S.length, lerp = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
  const pick = (arr, t) => { t = Math.max(0, Math.min(N - 1.001, t)); const i = Math.floor(t), u = t - i, A = arr[i], B = arr[i + 1], o = { far: A.far.map((p, k) => lerp(p, B.far[k], u)) }; KEYS.forEach(k => o[k] = lerp(A[k], B[k], u)); return o; };
  const val = (arr, t) => { t = Math.max(0, Math.min(N - 1.001, t)); const i = Math.floor(t); return arr[i] + (arr[i + 1] - arr[i]) * (t - i); };
  return {
    N, ar, w: P.w, h: P.h, facing, knee, hip, elbow, back, catches, finishes,
    hz: hz || (P.start != null ? P.fps : 15),   // the first pose file was every 4th frame of a 60 fps clip
    frame: t => pick(S, t),      // as filmed: x and y in 0..1 of the frame
    body: t => pick(body, t),    // rower's frame: metres from the ankle, y up
    angle: (name, t) => val({ knee, hip, elbow, back }[name], t),
  };
}
function sub(a, b) { return [a[0] - b[0], a[1] - b[1]]; }
function m(p, a, k) { return [(p[0] - a[0]) * k, (a[1] - p[1]) * k]; }

// Scroll progress through a tall section with a pinned stage inside it: 0 at the top, 1 when the last screen is reached.
export function progress(section) {
  const r = section.getBoundingClientRect(), span = r.height - innerHeight;
  return span > 0 ? Math.max(0, Math.min(1, -r.top / span)) : 0;
}
export const seg = (p, a, b) => Math.max(0, Math.min(1, (p - a) / (b - a)));
export const ease = x => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
export const out = x => 1 - Math.pow(1 - x, 4);

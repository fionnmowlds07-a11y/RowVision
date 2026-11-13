import { loadPose, progress, seg, ease, out, BONES } from './shared/pose.js';

const $ = id => document.getElementById(id);
const T = 27;                                   // length of the film, in screens
const film = $('film'), cv = $('cv'), rig = $('rig'), fan = $('fan'), chart = $('chart');
film.style.height = (T + 1) * 100 + 'vh';
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
const HL = '#4be38a', PALE = '#b6f2c9';
// Three looks to choose between, picked with ?look= in the address: black, pale or ambient. Without it, the first green one.
const LOOK = new URLSearchParams(location.search).get('look') || 'green', light = LOOK == 'pale';
document.documentElement.dataset.look = LOOK;
const INK = light ? '#04140b' : '#fff', ACC = light ? '#0b7a4b' : HL, QUIET = light ? '#3d5a4a' : '#c4e4d2', MID = light ? '#6f9a82' : PALE;
const lerp = (a, b, u) => a + (b - a) * u, win = (x, a, b, f = .3) => Math.min(seg(x, a, a + f), 1 - seg(x, b - f, b));

// ---- clips: real phone footage, each with the pose RowVision's model reads from it ----
const FILES = { pair: 'pair', a: 'single-a', b: 'single-b', pxl: 'pxl', astern: 'astern', far: 'far' };
const CLIPS = {};
await Promise.all(Object.entries(FILES).map(async ([k, name]) => {
  const v = document.createElement('video'); v.muted = true; v.loop = true; v.playsInline = true; v.preload = 'auto'; v.src = `./private/clips/${name}.mp4`;
  CLIPS[k] = { v, want: false, pose: k == 'astern' || k == 'far' ? null : await loadPose(`./private/pose/${name}.json`) };
}));
const D = CLIPS.pair, A = CLIPS.a;
function use(k, at) {
  const c = CLIPS[k], v = c.v; c.want = true;
  if (at != null || still) { if (!v.paused) v.pause(); const t = at ?? 1; if (!v.seeking && Math.abs(v.currentTime - t) > .02) v.currentTime = t; }
  else if (v.paused) v.play().catch(() => {});
  return c;
}

// ---- one frame of a clip onto a canvas, with whatever RowVision has drawn over it at this point in the story ----
function arc(g, c, p, q, r, label, a, fs) {
  const a1 = Math.atan2(p[1] - c[1], p[0] - c[0]), a2 = Math.atan2(q[1] - c[1], q[0] - c[0]); let d = a2 - a1; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
  g.save(); g.globalAlpha = a; g.strokeStyle = '#fff'; g.fillStyle = 'rgba(75,227,138,.28)'; g.lineWidth = Math.max(2, r * .07);
  g.beginPath(); g.moveTo(...c); g.arc(c[0], c[1], r, a1, a1 + d, d < 0); g.closePath(); g.fill(); g.stroke();
  const am = a1 + d / 2, tx = c[0] + Math.cos(am) * (r + fs * 1.5), ty = c[1] + Math.sin(am) * (r + fs * 1.5);
  g.font = `800 ${fs}px Bricolage`; g.textAlign = 'center'; g.textBaseline = 'middle'; const w = g.measureText(label).width + fs * .7;
  g.fillStyle = '#04140b'; g.beginPath(); g.roundRect(tx - w / 2, ty - fs * .72, w, fs * 1.44, fs * .3); g.fill(); g.fillStyle = '#fff'; g.fillText(label, tx, ty + fs * .05); g.restore();
}
function draw(c, clip, o) {
  const g = c.getContext('2d'), W = c.width, H = c.height, v = clip.v, pose = clip.pose, z = o.zoom || 1; let ox = 0, oy = 0, b = null, t = 0;
  const src = o.img || v;
  if (!o.img && v.readyState < 2 && o.clear !== false) return;      // not ready: hold the last picture, never flash black
  if (pose) {
    t = Math.min(pose.N - 1.001, o.t ?? v.currentTime * pose.hz); b = pose.frame(t);
    const k = Math.min(1, (z - 1) * 1.2), fx = W / 2 + ((b.hp[0] + b.sh[0]) / 2 * W - W / 2) * k, fy = H / 2 + (((b.sh[1] + b.an[1]) / 2 - .03) * H - H / 2) * k;
    ox = Math.max(W - W * z, Math.min(0, W / 2 - fx * z)); oy = Math.max(H - H * z, Math.min(0, H / 2 - fy * z));
  }
  if (o.clear !== false) { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); }
  const al = o.alpha ?? 1;
  if (al > 0 && (o.img || v.readyState >= 2)) {
    g.globalAlpha = al; g.filter = (o.sat ?? 1) < 1 || (o.bright ?? 1) < 1 ? `saturate(${o.sat ?? 1}) brightness(${o.bright ?? 1})` : 'none'; g.imageSmoothingQuality = 'high'; g.drawImage(src, ox, oy, W * z, H * z);
    if (o.img2 && o.mix > 0) { g.globalAlpha = al * o.mix; g.drawImage(o.img2, ox, oy, W * z, H * z); }      // blend towards the next frame, so scrubbing glides
    g.filter = 'none'; g.globalAlpha = 1;
  }
  if (!b) return;
  const P = p => [ox + p[0] * W * z, oy + p[1] * H * z], J = Object.fromEntries(['sh', 'el', 'wr', 'hp', 'kn', 'an', 'hd'].map(k => [k, P(b[k])]));
  const bl = Math.hypot(J.sh[0] - J.hp[0], J.sh[1] - J.hp[1]), mid = [(J.sh[0] + J.hp[0] + J.kn[0]) / 3, (J.sh[1] + J.hp[1] + J.kn[1]) / 3];
  if (o.spot > 0) { const gr = g.createRadialGradient(mid[0], mid[1], bl * 1.2, mid[0], mid[1], bl * 4.5); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, `rgba(0,0,0,${o.spot})`); g.fillStyle = gr; g.fillRect(0, 0, W, H); }
  if (o.ring > 0 && o.ring < 1) { g.save(); g.strokeStyle = '#fff'; g.lineWidth = 4 * (1 - o.ring) + 1; g.globalAlpha = 1 - o.ring; g.beginPath(); g.arc(...mid, bl * (.3 + out(o.ring) * 1.6), 0, 7); g.stroke(); g.globalAlpha = 1 - o.ring * o.ring; g.fillStyle = '#fff'; g.beginPath(); g.arc(...mid, bl * .14, 0, 7); g.fill(); g.restore(); }
  if (o.box > 0) {
    const xs = [J.sh, J.hp, J.kn, J.an, J.wr, J.hd].map(p => p[0]), ys = [J.sh, J.hp, J.kn, J.an, J.hd].map(p => p[1]), x0 = Math.min(...xs) - bl * .45, x1 = Math.max(...xs) + bl * .45, y0 = Math.min(...ys) - bl * .55, y1 = Math.max(...ys) + bl * .35, fs = Math.max(15, W * .017);
    g.save(); g.globalAlpha = o.box; g.strokeStyle = HL; g.lineWidth = Math.max(2, W * .0028); g.beginPath(); g.roundRect(x0, y0, x1 - x0, y1 - y0, bl * .12); g.stroke();
    g.font = `700 ${fs}px "DM Sans"`; const tw = g.measureText('You').width + fs; g.fillStyle = HL; g.beginPath(); g.roundRect(x0, y0 - fs * 1.9, tw, fs * 1.6, fs * .35); g.fill(); g.fillStyle = '#04140b'; g.textBaseline = 'middle'; g.fillText('You', x0 + fs * .5, y0 - fs * 1.08); g.restore();
  }
  const sk = o.skel || 0;
  if (sk > .01) {
    const lw = Math.max(W * .0028, bl * .05);
    g.save(); g.lineCap = g.lineJoin = 'round'; g.shadowColor = 'rgba(0,0,0,.55)'; g.shadowBlur = lw * 2; g.strokeStyle = HL; g.lineWidth = lw;
    BONES.forEach(([p, q], i) => { const u = seg(sk, i * .16, i * .16 + .36); if (!u) return; g.beginPath(); g.moveTo(...J[q]); g.lineTo(J[q][0] + (J[p][0] - J[q][0]) * u, J[q][1] + (J[p][1] - J[q][1]) * u); g.stroke(); });
    g.shadowBlur = 0; ['an', 'kn', 'hp', 'sh', 'el', 'wr'].forEach((k, i) => { const u = seg(sk, i * .16 - .1, i * .16 + .1); if (!u) return; g.fillStyle = '#fff'; g.beginPath(); g.arc(...J[k], lw * 1.3 * u, 0, 7); g.fill(); });
    g.restore();
  }
  const ar = o.arcs; if (!ar) return;
  const i = Math.round(t), fs = Math.max(18, bl * .24);
  if (ar.knee > .01) arc(g, J.kn, J.hp, J.an, bl * .42, Math.round(pose.knee[i]) + '°', ar.knee, fs);
  if (ar.back > .01) { const up = [J.hp[0], J.hp[1] - bl * 1.15]; g.save(); g.globalAlpha = ar.back * .8; g.strokeStyle = '#fff'; g.setLineDash([bl * .06, bl * .06]); g.lineWidth = Math.max(2, bl * .02); g.beginPath(); g.moveTo(...J.hp); g.lineTo(...up); g.stroke(); g.restore(); arc(g, J.hp, up, J.sh, bl * .5, Math.abs(Math.round(pose.back[i])) + '°', ar.back, fs); }
  if (ar.elbow > .01) arc(g, J.el, J.sh, J.wr, bl * .32, Math.round(pose.elbow[i]) + '°', ar.elbow, fs);
}

// ---- the drive taken apart: nine moments of one stroke, each on its own sheet ----
const LAYERS = 9, sheets = [];
{
  const p = A.pose, c0 = p.catches[1] ?? p.catches[0], fin = p.finishes.find(f => f > c0) ?? c0 + 20;
  $('tKnee').textContent = Math.round(p.knee[c0]) + '°'; $('tHip').textContent = Math.round(p.hip[c0]) + '°'; $('tLean').textContent = Math.abs(Math.round(p.back[fin])) + '°'; $('tElbow').textContent = Math.round(p.elbow[fin]) + '°';
  $('tLeanL').textContent = p.back[fin] > 0 ? 'Body forward at the finish' : 'Layback at the finish';
  for (let k = 0; k < LAYERS; k++) {
    const c = document.createElement('canvas'); c.width = 1200; c.height = 840; const x = c.getContext('2d'), b = p.body(c0 + (fin - c0) * k / (LAYERS - 1)), f = p.facing;
    const Q = q => [(f < 0 ? 250 : 950) + q[0] * 600, 700 - q[1] * 600], edge = k == 0 || k == LAYERS - 1;
    x.lineCap = x.lineJoin = 'round'; x.strokeStyle = edge ? '#fff' : PALE; x.lineWidth = edge ? 9 : 5;
    BONES.forEach(([a, d]) => { x.beginPath(); x.moveTo(...Q(b[a])); x.lineTo(...Q(b[d])); x.stroke(); });
    x.beginPath(); x.moveTo(...Q(b.sh)); x.lineTo(...Q(b.hd)); x.stroke(); x.beginPath(); x.arc(...Q(b.hd), 60, 0, 7); x.stroke();
    ['wr', 'el', 'sh', 'hp', 'kn', 'an'].forEach(j => { x.fillStyle = edge ? HL : '#06281a'; x.beginPath(); x.arc(...Q(b[j]), edge ? 13 : 9, 0, 7); x.fill(); x.stroke(); });
    fan.append(c); sheets.push(c);
  }
}

// ---- every stroke in the clip as one line, then folded so the strokes lie over each other ----
const CH = (() => { const p = A.pose, c = p.catches; return { p, c, i0: c[0], i1: c.at(-1), n: c.length - 1 }; })();
$('nLast').textContent = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'][CH.n] ?? CH.n;
function drawChart(reveal, fold) {
  const d = Math.min(2, devicePixelRatio || 1), W = chart.clientWidth, H = chart.clientHeight; if (chart.width != W * d) { chart.width = W * d; chart.height = H * d; }
  const g = chart.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, W, H);
  const pad = Math.max(18, Math.min(52, W * .034)), x0 = pad + 44, x1 = W - pad, y0 = H * (W > 760 ? .5 : .46), y1 = H * .9, { p, c, i0, i1, n } = CH;
  const Y = v => y1 - (v - 30) / 155 * (y1 - y0);
  g.font = '500 13px "DM Sans"'; g.textBaseline = 'middle'; g.textAlign = 'right';
  [60, 120, 180].forEach(v => { g.strokeStyle = light ? 'rgba(4,20,11,.14)' : 'rgba(255,255,255,.12)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x0, Y(v)); g.lineTo(x1, Y(v)); g.stroke(); g.fillStyle = QUIET; g.fillText(v + '°', x0 - 10, Y(v)); });
  const X = (j, k) => lerp(x0 + (j - i0) / (i1 - i0) * (x1 - x0), x0 + (j - c[k]) / (c[k + 1] - c[k]) * (x1 - x0), fold);
  const lim = i0 + reveal * (i1 - i0);
  for (let k = 0; k < n; k++) {
    const first = k == 0, last = k == n - 1;
    g.strokeStyle = first ? INK : last ? ACC : MID; g.globalAlpha = first || last ? 1 : lerp(1, .4, fold); g.lineWidth = first || last ? 3.5 : 2.5; g.lineJoin = 'round';
    g.beginPath(); let any = 0; for (let j = c[k]; j <= c[k + 1] && j <= lim; j++) { any++ ? g.lineTo(X(j, k), Y(p.knee[j])) : g.moveTo(X(j, k), Y(p.knee[j])); } g.stroke();
    g.fillStyle = g.strokeStyle;
    if (c[k] <= lim) { g.beginPath(); g.arc(X(c[k], k), Y(p.knee[c[k]]), 6, 0, 7); g.fill(); }
    const f = p.finishes[k]; if (f != null && f <= lim) g.fillRect(X(f, k) - 5.5, Y(p.knee[f]) - 5.5, 11, 11);
  }
  g.globalAlpha = 1;
}
// measured lean at the catches and finishes of that clip, for the target lanes
const mean = a => a.reduce((s, v) => s + v, 0) / (a.length || 1);
const LEAN = { c: Math.max(0, Math.min(50, mean(CH.c.map(i => CH.p.back[i])))), f: Math.max(0, Math.min(50, mean(CH.p.finishes.map(i => -CH.p.back[i])))) };

// ---- the water behind everything: slow bands of light with fine chart lines, tinted to where you are in the story ----
const BG = (() => {
  const c = $('bg'), gl = c.getContext('webgl', { antialias: false, alpha: false }); if (!gl) return null;
  gl.getExtension('OES_standard_derivatives');
  const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); return o; }, pr = gl.createProgram();
  gl.attachShader(pr, sh(gl.VERTEX_SHADER, 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }'));
  gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, `precision highp float; uniform vec2 r; uniform float t, lines, vig; uniform vec3 a, b;
    float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
    float fbm(vec2 p){ float s = 0., w = .5; for (int i = 0; i < 4; i++) { s += w * n(p); p = p * 2.03 + 7.1; w *= .5; } return s; }
    void main(){ vec2 uv = gl_FragCoord.xy / r, p = vec2(uv.x * r.x / r.y, uv.y);
      float far = 1. + uv.y * 2.2;                                     // the water is seen low, so ripples tighten towards the top
      vec2 q = vec2(p.x * 1.1 + t * .012, p.y * 3.4 * far - t * .03);
      float f = fbm(q + fbm(q * .6 + t * .015) * 1.4);
      float glint = smoothstep(.5, .78, f);
      vec3 c = mix(a, b, glint * .75 + uv.y * .22);
      float iso = abs(fract(f * 11.) - .5) / (fwidth(f) * 11. + 1e-4);
      c += b * (1. - smoothstep(0., 1.3, iso)) * .22 * lines;
      c *= 1. - vig * pow(length(uv - .5) * 1.25, 2.2);
      c += (h(gl_FragCoord.xy + t) - .5) * .018;
      gl_FragColor = vec4(c, 1.); }`.replace('precision highp float;', '#extension GL_OES_standard_derivatives : enable\nprecision highp float;')));
  gl.linkProgram(pr); gl.useProgram(pr);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const U = n => gl.getUniformLocation(pr, n), hex = s => [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16) / 255);
  const STOPS = ({
    green: [[0, '#06281a', '#17704a', .7], [10, '#06281a', '#17704a', .7], [11.5, '#041c13', '#0f5035', .8], [17.6, '#041c13', '#0f5035', .8], [18.6, '#010806', '#0a3323', 1], [22.8, '#010806', '#0a3323', 1], [24, '#04180f', '#11573a', .8], [26, '#0a3d27', '#22895a', .6]],
    // black water: almost no colour in the ground, so the footage and the green lines are the only colour on the page
    black: [[0, '#020403', '#0d1f17', .5], [17.6, '#020403', '#0d1f17', .5], [18.6, '#000000', '#0a1812', .9], [24, '#000000', '#0a1812', .9], [26, '#030605', '#12301f', .5]],
    // first light: pale water and dark ink
    pale: [[0, '#dfeae2', '#f6faf6', -.2], [17.6, '#dfeae2', '#f6faf6', -.2], [18.6, '#d3e2d8', '#eef5ef', -.3], [24, '#d3e2d8', '#eef5ef', -.3], [26, '#dfeae2', '#f6faf6', -.2]],
    ambient: [[0, '#000000', '#000000', 0], [26, '#000000', '#000000', 0]],
  }[LOOK] || []).map(s => [s[0], hex(s[1]), hex(s[2]), s[3]]);
  return (x, time) => {
    const d = Math.min(1.5, devicePixelRatio || 1), w = Math.round(c.clientWidth * d * .6), hh = Math.round(c.clientHeight * d * .6); if (c.width != w || c.height != hh) { c.width = w; c.height = hh; gl.viewport(0, 0, w, hh); }
    let i = 0; while (i < STOPS.length - 2 && x > STOPS[i + 1][0]) i++; const s0 = STOPS[i], s1 = STOPS[i + 1], u = seg(x, s0[0], s1[0]);
    gl.uniform1f(U('vig'), light ? .12 : .55); gl.uniform2f(U('r'), w, hh); gl.uniform1f(U('t'), time); gl.uniform1f(U('lines'), lerp(s0[3], s1[3], u));
    gl.uniform3fv(U('a'), s0[1].map((v, k) => lerp(v, s1[1][k], u))); gl.uniform3fv(U('b'), s0[2].map((v, k) => lerp(v, s1[2][k], u)));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
})();

// ambient look: the ground is the footage itself, blown up and blurred, so each clip brings its own colour
const amb = document.getElementById('amb'), ag = amb.getContext('2d');

// ---- the film ----
const scenes = [...document.querySelectorAll('.scene')].map(el => ({ el, a: +el.dataset.a, b: +el.dataset.b }));
const cards = [...document.querySelectorAll('.card')].map(el => ({ el, c: el.querySelector('canvas'), clip: CLIPS[el.dataset.clip] }));
const l1 = document.querySelector('.l1'), l2 = document.querySelector('.l2'), lede = document.querySelector('.lede');
const stroke = (() => { const c = D.pose.catches, k = Math.max(0, Math.floor(c.length / 2) - 1); return [c[k], c[k + 1] ?? c[k] + 60]; })();
// The stroke you scrub through is decoded once into still frames, so scrolling never waits on the video to seek.
const SCRUB = { frames: [], n: stroke[1] - stroke[0] + 1, cur: 0, on: false, fade: 0, snap: document.createElement('canvas') };
SCRUB.snap.width = cv.width; SCRUB.snap.height = cv.height;
(async () => {
  const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = D.v.src;
  await new Promise(r => v.addEventListener('loadeddata', r, { once: true }));
  for (let k = 0; k < SCRUB.n; k++) { v.currentTime = (stroke[0] + k + .5) / D.pose.hz; await new Promise(r => v.addEventListener('seeked', r, { once: true })); SCRUB.frames[k] = await createImageBitmap(v); }
  document.documentElement.dataset.scrub = '1';
})();
const got = k => { for (let d = 0; d < SCRUB.n; d++) { if (SCRUB.frames[k - d]) return SCRUB.frames[k - d]; if (SCRUB.frames[k + d]) return SCRUB.frames[k + d]; } return null; };
let clock = 0, last = performance.now(), xs = null;

function frame(now) {
  const dt = Math.min(.05, (now - last) / 1000); last = now; if (!still) clock += dt;
  const xr = progress(film) * T; xs = still || xs == null ? xr : xs + (xr - xs) * Math.min(1, dt * 9);      // glide to where the scroll is, so a wheel click is not a jump
  const x = Math.abs(xr - xs) < .0005 ? xr : xs, W = innerWidth, H = innerHeight, small = W <= 760, vw = W / 100, vh = H / 100;
  BG?.(x, clock);

  // what the main screen shows
  const scrub = x >= 6.3 && x < 10.5, dz = ease(seg(x, 4.6, 6)) - ease(seg(x, 10.5, 11.3)), grade = seg(x, 4.8, 5.6) - seg(x, 10.5, 11.2);
  const m = ease(seg(x, 10.7, 11.8)) - ease(seg(x, 13.6, 14.5));
  const sf = seg(x, 6.3, 10.5) * (SCRUB.n - 1), s0 = Math.min(SCRUB.n - 1, Math.floor(sf)), simg = scrub ? got(s0) : null;
  if (scrub && !SCRUB.on) { SCRUB.snap.getContext('2d').drawImage(cv, 0, 0); SCRUB.fade = 1; }      // going in: keep the last moving frame to dissolve from
  SCRUB.on = scrub; SCRUB.fade = Math.max(0, SCRUB.fade - dt * 3.5);
  const poseT = scrub ? stroke[0] + sf : null;
  if (x < 14.5) draw(cv, use('pair', scrub ? (x < 8.4 ? stroke[0] : stroke[1]) / D.pose.hz : null), {
    img: simg, img2: simg && got(Math.min(SCRUB.n - 1, s0 + 1)), mix: sf - s0, t: simg ? poseT : undefined,
    zoom: 1 + dz * (small ? 2.6 : 1.5) + m * .8, bright: 1 - .4 * grade, sat: 1 - .55 * grade, ring: seg(x, 3.5, 3.95), box: Math.min(seg(x, 3.85, 4.1), 1 - seg(x, 4.8, 5.1)), spot: Math.min(seg(x, 3.6, 4.2), 1 - seg(x, 5, 5.6)) * .6,
    skel: seg(x, 4.9, 5.8), arcs: { knee: win(x, 6.4, 7.8), back: win(x, 7.9, 9.3), elbow: win(x, 9.4, 10.6) },
  });
  if (scrub && SCRUB.fade > 0) { const g = cv.getContext('2d'); g.globalAlpha = SCRUB.fade; g.drawImage(SCRUB.snap, 0, 0); g.globalAlpha = 1; }
  if (x > 13.9 && x < 16.5) draw(cv, use('astern'), { alpha: seg(x, 13.9, 14.4), clear: false });
  if (x > 16 && x < 18) draw(cv, use('far'), { alpha: seg(x, 16, 16.4), clear: false });
  if (x > 17.4 && x < 21) draw(cv, use('a'), { alpha: seg(x, 17.4, 17.9) * (1 - seg(x, 18, 18.7)), clear: x > 17.9, zoom: 1 + ease(seg(x, 17.6, 18.6)) * (small ? 2.6 : 1.8), skel: Math.min(seg(x, 17.8, 18.4), 1 - seg(x, 18.7, 19.1)), sat: 1 - seg(x, 17.9, 18.4) * .6 });
  if (x >= 21) draw(cv, use('pair'), { skel: 1, zoom: 1.7 });
  const i = Math.min(D.pose.N - 1, Math.round(poseT ?? D.v.currentTime * D.pose.hz));
  $('nKnee').textContent = Math.round(D.pose.knee[i]) + '°'; $('nBack').textContent = Math.abs(Math.round(D.pose.back[i])) + '°'; $('nElbow').textContent = Math.round(D.pose.elbow[i]) + '°';

  // where the main screen is: phone, full window, one of four, tipped back, phone again
  const rw = rig.offsetWidth, fill = small ? 1.04 : Math.max(W / (rw * .896), H / (rw * .896 * 9 / 16)) * 1.02;
  const push = ease(seg(x, 1.2, 2.8)), back = x < 22, tilt = back ? ease(seg(x, 18.5, 19.6)) : 0, spread = back ? ease(seg(x, 18.9, 20)) : 0, end = ease(seg(x, 24.9, 25.9));
  const tileS = (small ? W * .6 : 36 * vw) / rw, slot = k => small ? [0, (k - 1.5) * 128 + 76] : [(k % 2 ? 19.5 : -19.5) * vw, (k < 2 ? -6 : 26) * vh];
  const drift = (x - 12.6) * -1.4 * vh;
  let s = lerp(lerp(1 + (fill - 1) * push, tileS, m), small ? .92 : .8, tilt), tx = slot(0)[0] * m + (small ? 0 : tilt * 11 * vw), ty = (slot(0)[1] + drift * .5) * m + tilt * 1.5 * vh;
  if (!back) { s = small ? 1 : .86; tx = small ? 0 : 17 * vw; ty = small ? -10 * vh : -11 * vh; }
  rig.style.transform = `translate(-50%, -50%) translate(${tx}px, ${ty}px) scale(${s}) rotateX(${tilt * 12}deg) rotateY(${tilt * -36}deg)`;
  rig.style.opacity = back ? 1 - seg(x, 20.3, 20.8) : end;
  sheets.forEach((c, k) => { c.style.opacity = back ? seg(x, 18.6, 19) * (k == 0 || k == LAYERS - 1 ? 1 : .8) : 0; c.style.transform = `translateZ(${4 + spread * k * (small ? 36 : 54)}px)`; });

  // the other three clips fly in beside it, then leave
  cards.forEach((cd, k) => {
    const e = out(seg(x, 10.8 + k * .18, 11.9 + k * .18)), l = ease(seg(x, 13.4 + k * .12, 14.3 + k * .12)), on = e > 0 && l < 1;
    cd.el.style.opacity = on ? Math.min(1, e * 3) * (1 - l) : 0; if (!on) return;
    const sl = slot(k + 1), from = small ? [[W, 0], [-W, 0], [W, 0]][k] : [[70 * vw, -20 * vh], [-70 * vw, 50 * vh], [70 * vw, 60 * vh]][k];
    cd.el.style.transform = `translate(-50%, -50%) translate(${sl[0] + from[0] * (1 - e) + from[0] * .6 * l}px, ${sl[1] + from[1] * (1 - e) + drift * (.5 + (k + 1) * .35) * (small ? 0 : 1) - l * 20 * vh}px) scale(${tileS * (1 - l * .2)}) rotate(${(1 - e) * (k % 2 ? -8 : 8)}deg)`;
    draw(cd.c, use(cd.el.dataset.clip), { skel: 1, zoom: 1.8 });
  });

  // words
  scenes.forEach(sc => { const o = win(x, sc.a, sc.b), inn = seg(x, sc.a, sc.a + .3), ou = seg(x, sc.b - .3, sc.b); sc.el.style.opacity = o; sc.el.style.visibility = o > 0 ? 'visible' : 'hidden'; sc.el.style.transform = `translateY(${(1 - out(inn)) * 34 - ou * 34}px)`; });
  const h = ease(seg(x, .3, 1.1)); l1.style.transform = `translateX(${-h * 70}vw)`; l2.style.transform = `translateX(${h * 70}vw)`; lede.style.opacity = 1 - seg(x, .2, .6);
  $('scrim').style.opacity = small ? 0 : Math.max(Math.min(seg(x, 2, 2.6), 1 - seg(x, 10.6, 11)), Math.min(seg(x, 14.3, 14.7), 1 - seg(x, 17.9, 18.3)));
  $('chip').style.opacity = win(x, 16.5, 17.5, .2);
  $('strip').style.opacity = win(x, 19.6, 20.5);

  const ca = win(x, 20.7, 22.9); chart.style.opacity = ca; if (ca > 0) drawChart(seg(x, 20.9, 21.7), ease(seg(x, 21.8, 22.5)));
  const la = win(x, 23.1, 24.4), go = out(seg(x, 23.3, 24)); $('lanes').style.opacity = la;
  $('mCatch').style.left = LEAN.c * go * 2 + '%'; $('mFinish').style.left = LEAN.f * go * 2 + '%'; $('vCatch').textContent = Math.round(LEAN.c * go) + '°'; $('vFinish').textContent = Math.round(LEAN.f * go) + '°';

  if (LOOK == 'ambient') ag.drawImage(cv, 0, 0, amb.width, amb.height);
  for (const c of Object.values(CLIPS)) { if (!c.want && !c.v.paused) c.v.pause(); c.want = false; }
  requestAnimationFrame(frame);
}
await Promise.race([new Promise(r => D.v.addEventListener('loadeddata', r, { once: true })), new Promise(r => setTimeout(r, 4000))]);
await document.fonts.ready;
requestAnimationFrame(frame); document.documentElement.dataset.ready = '1';

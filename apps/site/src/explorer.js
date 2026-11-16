// The stroke explorer: one rower's joints from a real clip, with no picture. Drag through the clip and the angles are worked out
// from the joints you are looking at, the same way the app does it. Nothing here is drawn by hand.
import { loadPose, BONES } from './pose.js';

const box = document.getElementById('explorer');
if (box) {
  const cv = box.querySelector('canvas'), g = cv.getContext('2d'), range = box.querySelector('input'), play = box.querySelector('[data-play]');
  const out = n => box.querySelector(`[data-read="${n}"]`), phase = box.querySelector('[data-phase]');
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let P, t = 0, playing = false, last = 0;

  const size = () => { const d = Math.min(2, devicePixelRatio || 1), w = cv.clientWidth; cv.width = Math.round(w * d); cv.height = Math.round(w * .56 * d); };
  const HL = '#4be38a', PALE = '#b6f2c9';

  function draw() {
    const W = cv.width, H = cv.height, u = W / 1000;
    g.clearRect(0, 0, W, H);
    const b = P.body(t), s = H * .56, ox = W * (P.facing > 0 ? .36 : .64), oy = H * .68;
    const at = p => [ox + p[0] * s, oy - p[1] * s];

    // the waterline, and the path the hands have taken over the last second
    g.strokeStyle = 'rgba(255,255,255,.14)'; g.lineWidth = 1.5 * u; g.beginPath(); g.moveTo(W * .06, oy + s * .1); g.lineTo(W * .94, oy + s * .1); g.stroke();
    g.strokeStyle = 'rgba(75,227,138,.35)'; g.lineWidth = 2 * u; g.beginPath();
    for (let k = 0; k <= 30; k++) { const q = at(P.body(Math.max(0, t - k)).wr); k ? g.lineTo(...q) : g.moveTo(...q); } g.stroke();

    // far-side limbs first and fainter, then the side nearest the camera
    g.lineCap = g.lineJoin = 'round';
    const far = b.far.map(at); g.strokeStyle = 'rgba(255,255,255,.22)'; g.lineWidth = 5 * u;
    [[0, 1], [1, 2], [3, 4], [4, 5]].forEach(([a, c]) => { g.beginPath(); g.moveTo(...far[a]); g.lineTo(...far[c]); g.stroke(); });
    g.strokeStyle = '#fff'; g.lineWidth = 7 * u;
    BONES.forEach(([a, c]) => { g.beginPath(); g.moveTo(...at(b[a])); g.lineTo(...at(b[c])); g.stroke(); });
    const hd = at(b.hd); g.beginPath(); g.arc(hd[0], hd[1], s * .11, 0, 7); g.stroke();

    // the three angles the app reads: knee, hip and elbow, each drawn as an arc at its joint
    const arc = (a, v, c, r) => { const A = at(b[a]), V = at(b[v]), C = at(b[c]); let a0 = Math.atan2(A[1] - V[1], A[0] - V[0]), a1 = Math.atan2(C[1] - V[1], C[0] - V[0]), d = a1 - a0; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; g.beginPath(); g.arc(V[0], V[1], r * u, a0, a0 + d, d < 0); g.stroke(); };
    g.strokeStyle = HL; g.lineWidth = 4 * u; arc('hp', 'kn', 'an', 34); arc('sh', 'hp', 'kn', 40); arc('sh', 'el', 'wr', 26);
    g.fillStyle = HL; ['sh', 'el', 'wr', 'hp', 'kn', 'an'].forEach(k => { const q = at(b[k]); g.beginPath(); g.arc(q[0], q[1], 8 * u, 0, 7); g.fill(); });

    // the whole clip along the bottom: knee angle, with round marks at catches and square marks at finishes
    const x0 = W * .06, x1 = W * .94, y0 = H * .95, hh = H * .1, X = i => x0 + (x1 - x0) * i / (P.N - 1), Y = v => y0 - hh * (v - 40) / 140;
    g.strokeStyle = 'rgba(255,255,255,.4)'; g.lineWidth = 2 * u; g.beginPath(); for (let i = 0; i < P.N; i += 2) i ? g.lineTo(X(i), Y(P.knee[i])) : g.moveTo(X(i), Y(P.knee[i])); g.stroke();
    g.fillStyle = PALE; P.catches.forEach(i => { g.beginPath(); g.arc(X(i), Y(P.knee[i]), 6 * u, 0, 7); g.fill(); });
    P.finishes.forEach(i => g.fillRect(X(i) - 5 * u, Y(P.knee[i]) - 5 * u, 10 * u, 10 * u));
    g.strokeStyle = HL; g.lineWidth = 3 * u; g.beginPath(); g.moveTo(X(t), y0 - hh - 8 * u); g.lineTo(X(t), y0 + 6 * u); g.stroke();

    out('knee').textContent = Math.round(P.angle('knee', t)) + '°';
    out('hip').textContent = Math.round(P.angle('hip', t)) + '°';
    out('elbow').textContent = Math.round(P.angle('elbow', t)) + '°';
    const lean = P.angle('back', t); out('back').textContent = Math.abs(Math.round(lean)) + '°';
    box.querySelector('[data-lean]').textContent = lean >= 0 ? 'Body forward' : 'Layback';
    const marks = [...P.catches.map(i => [i, 'c']), ...P.finishes.map(i => [i, 'f'])].sort((a, c) => a[0] - c[0]);
    const before = marks.filter(m => m[0] <= t).at(-1), near = marks.find(m => Math.abs(m[0] - t) <= 2);
    phase.textContent = near ? (near[1] === 'c' ? 'The catch' : 'The finish') : !before ? 'Coming forward' : before[1] === 'c' ? 'The drive' : 'The recovery';
  }

  function set(v, fromRange) { t = Math.max(0, Math.min(P.N - 1.01, v)); if (!fromRange) range.value = t; range.setAttribute('aria-valuetext', `${(t / P.hz).toFixed(1)} seconds, ${phase.textContent.toLowerCase()}`); draw(); }
  function tick(now) { if (!playing) return; const dt = Math.min(.1, (now - last) / 1000); last = now; set(t + dt * P.hz * .5 >= P.N - 1.02 ? 0 : t + dt * P.hz * .5); requestAnimationFrame(tick); }
  function toggle(on) { playing = on; play.setAttribute('aria-pressed', on); play.textContent = on ? 'Pause' : 'Play at half speed'; if (on) { last = performance.now(); requestAnimationFrame(tick); } }

  loadPose('/data/pose-pair.json').then(p => {
    P = p; range.max = P.N - 1.01; range.step = .25; size(); set(P.catches[1] ?? 0); box.dataset.ready = '1';
    range.addEventListener('input', () => { toggle(false); set(+range.value, true); });
    play.addEventListener('click', () => toggle(!playing));
    box.querySelectorAll('[data-go]').forEach(bn => bn.addEventListener('click', () => {
      toggle(false); const list = bn.dataset.go === 'catch' ? P.catches : P.finishes; set(list.find(i => i > t + 2) ?? list[0]);
    }));
    // drag across the drawing to scrub, as well as the slider
    let down = false; const seek = e => { const r = cv.getBoundingClientRect(); set((e.clientX - r.left - r.width * .06) / (r.width * .88) * (P.N - 1)); };
    cv.addEventListener('pointerdown', e => { down = true; cv.setPointerCapture(e.pointerId); toggle(false); seek(e); });
    cv.addEventListener('pointermove', e => down && seek(e)); cv.addEventListener('pointerup', () => down = false); cv.addEventListener('pointercancel', () => down = false);
    addEventListener('resize', () => { size(); draw(); });
    if (!still) new IntersectionObserver(([e], io) => { if (e.isIntersecting) { toggle(true); io.disconnect(); } }, { threshold: .5 }).observe(box);
  }).catch(() => box.remove());
}

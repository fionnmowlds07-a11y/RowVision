import { loadPose, progress, seg, ease, out, BONES, FAR_BONES } from './shared/pose.js';

const $ = id => document.getElementById(id);
const film = $('film'), cv = $('cv'), g = cv.getContext('2d'), print = $('print');
const meta = await (await fetch('./private/meta.json')).json();
const pose = await loadPose();
const N = meta.frames.length;
const imgs = meta.frames.map((_, n) => { const im = new Image(); im.src = `./private/a/${String(n).padStart(3, '0')}.webp`; return im; });
const finish = pose.finishes.find(f => f > meta.first && f < meta.first + N) - meta.first;
$('ftot').textContent = String(N).padStart(3, '0');

// Catch is a round marker and finish a square one, as everywhere in RowVision.
[[0, 'c', 'Catch'], [finish, 'f', 'Finish']].forEach(([n, cls, name]) => { const b = document.createElement('b'); b.className = cls; b.style.left = n / (N - 1) * 100 + '%'; b.innerHTML = `<span>${name}</span>`; $('ruler').append(b); });
const picks = [...new Set([0, 8, 16, 24, 32, finish, 50, 58, 66, 74, 82, 90])].sort((a, b) => a - b);
picks.forEach(n => {
  const li = document.createElement('li'), tag = n == 0 ? 'Catch' : n == finish ? 'Finish' : '';
  li.className = tag.toLowerCase();
  li.innerHTML = `<img src="./private/a/${String(n).padStart(3, '0')}.webp" alt="${tag || 'Frame ' + (n + 1)}"><span>${String(n + 1).padStart(3, '0')}${tag ? `<em>${tag}</em>` : ''}</span>`;
  $('sheet').append(li);
});

function arc(c, p, q, r, label, a) {
  const a1 = Math.atan2(p[1] - c[1], p[0] - c[0]), a2 = Math.atan2(q[1] - c[1], q[0] - c[0]); let d = a2 - a1; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
  g.save(); g.globalAlpha = a; g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.arc(c[0], c[1], r, a1, a1 + d * a, d < 0); g.stroke();
  const am = a1 + d / 2, tx = c[0] + Math.cos(am) * (r + 34), ty = c[1] + Math.sin(am) * (r + 34);
  g.font = '900 30px Archivo'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const w = g.measureText(label).width + 16; g.fillStyle = '#000'; g.fillRect(tx - w / 2, ty - 19, w, 38); g.fillStyle = '#fff'; g.fillText(label, tx, ty + 2); g.restore();
}

function draw(t, skel) {
  const n = Math.round(t), im = imgs[n], W = cv.width, H = cv.height, k = W / meta.cw;
  g.clearRect(0, 0, W, H);
  if (im.complete && im.naturalWidth) g.drawImage(im, 0, 0, W, H);
  if (skel < .01) return;
  const b = pose.frame(meta.first + n), f = meta.frames[n], P = p => [(p[0] * meta.w - f.x0) * k, (p[1] * meta.h - f.y0) * k];
  const J = Object.fromEntries(['sh', 'el', 'wr', 'hp', 'kn', 'an'].map(key => [key, P(b[key])]));
  g.save(); g.lineCap = 'round'; g.lineJoin = 'round';
  g.globalAlpha = skel * .35; g.strokeStyle = '#fff'; g.lineWidth = 2; const Q = b.far.map(P);
  FAR_BONES.forEach(([x, y]) => { g.beginPath(); g.moveTo(...Q[x]); g.lineTo(...Q[y]); g.stroke(); });
  g.globalAlpha = skel; g.lineWidth = 4; g.shadowColor = '#000'; g.shadowBlur = 8;
  BONES.forEach(([x, y], i) => { const u = seg(skel, i * .15, i * .15 + .4); if (!u) return; g.beginPath(); g.moveTo(...J[x]); g.lineTo(J[x][0] + (J[y][0] - J[x][0]) * u, J[x][1] + (J[y][1] - J[x][1]) * u); g.stroke(); });
  g.shadowBlur = 0; Object.values(J).forEach(p => { g.fillStyle = '#000'; g.beginPath(); g.arc(...p, 8, 0, 7); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 3; g.stroke(); });
  g.restore();
  const a = seg(skel, .6, 1), i = meta.first + n;
  if (a > 0) { arc(J.kn, J.hp, J.an, 54, Math.round(pose.knee[i]) + '°', a); arc(J.el, J.sh, J.wr, 40, Math.round(pose.elbow[i]) + '°', a); }
}

const s1 = $('s1'), s2 = $('s2'), s3 = $('s3'), l1 = s1.querySelector('.l1'), l2 = s1.querySelector('.l2'), lede = s1.querySelector('.lede'), edge = $('edge');
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
function frame() {
  const p = progress(film), phone = innerWidth <= 760;
  const leave = ease(seg(p, .06, .24)), scrub = seg(p, .24, .7), sheet = ease(seg(p, .72, .88));
  const t = p < .24 ? 3 : scrub * (N - 1), n = Math.round(t), i = meta.first + n;
  draw(t, still ? (p > .2 ? 1 : 0) : seg(p, .2, .34));
  l1.style.transform = `translateX(${-leave * 60}vw)`; l2.style.transform = `translateX(${leave * 60}vw)`;
  s1.style.opacity = 1 - seg(p, .1, .22); lede.style.opacity = 1 - seg(p, .04, .12);
  s2.style.opacity = Math.min(seg(p, .2, .28), 1 - seg(p, .7, .76)); edge.style.opacity = s2.style.opacity;
  s3.style.opacity = seg(p, .76, .86);
  s2.style.visibility = +s2.style.opacity ? 'visible' : 'hidden'; s3.style.visibility = +s3.style.opacity ? 'visible' : 'hidden'; s1.style.visibility = +s1.style.opacity ? 'visible' : 'hidden';
  // The print lifts and shrinks as the contact sheet arrives, so it is always shown no bigger than the footage can bear.
  print.style.transform = `translate(${-50 + sheet * (phone ? 0 : 16)}%, ${-52 - sheet * (phone ? 6 : 14)}%) scale(${1 - sheet * (phone ? .2 : .45)})`;
  $('fno').textContent = String(n + 1).padStart(3, '0');
  $('phase').textContent = n < 3 || n > N - 4 ? 'Catch' : Math.abs(n - finish) < 3 ? 'Finish' : n < finish ? 'Drive' : 'Recovery';
  $('rKnee').textContent = Math.round(pose.knee[i]) + '°'; $('rBack').textContent = Math.abs(Math.round(pose.back[i])) + '°'; $('lBack').textContent = pose.back[i] > 0 ? 'Body forward' : 'Body laid back'; $('rElbow').textContent = Math.round(pose.elbow[i]) + '°';
  $('head').style.left = n / (N - 1) * 100 + '%';
  requestAnimationFrame(frame);
}
await Promise.all(imgs.slice(0, 6).map(im => im.decode().catch(() => {})));
await document.fonts.ready;
frame(); document.documentElement.dataset.ready = '1';

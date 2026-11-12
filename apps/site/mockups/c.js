import { loadPose, progress, seg, ease, BONES, FAR_BONES } from './shared/pose.js';

const $ = id => document.getElementById(id);
const film = $('film'), cv = $('cv'), g = cv.getContext('2d'), rig = $('rig'), phone = $('phone'), fan = $('fan');
const meta = await (await fetch('./private/meta.json')).json();
const pose = await loadPose();
const N = meta.frames.length, W = cv.width, H = cv.height;
const imgs = meta.frames.map((_, n) => { const im = new Image(); im.src = `./private/c/${String(n).padStart(3, '0')}.jpg`; return im; });
const finish = pose.finishes.find(f => f > meta.first && f < meta.first + N);
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
const HL = '#4be38a', PALE = '#b6f2c9';

// The readout: measured at this stroke's catch and finish.
$('tKnee').textContent = Math.round(pose.knee[meta.first]) + '°'; $('tHip').textContent = Math.round(pose.hip[meta.first]) + '°';
$('tLean').textContent = Math.abs(Math.round(pose.back[finish])) + '°'; $('tLeanL').textContent = pose.back[finish] > 0 ? 'Body forward at the finish' : 'Layback at the finish';
$('tElbow').textContent = Math.round(pose.elbow[finish]) + '°';

// Nine moments of the drive, each on its own sheet, ready to fan out in depth.
const LAYERS = 9, sheets = [];
for (let k = 0; k < LAYERS; k++) {
  const c = document.createElement('canvas'); c.width = 1200; c.height = 840; const x = c.getContext('2d'), b = pose.body(meta.first + (finish - meta.first) * k / (LAYERS - 1));
  const P = p => [250 + p[0] * 600, 700 - p[1] * 600], edge = k == 0 || k == LAYERS - 1;
  x.lineCap = x.lineJoin = 'round'; x.strokeStyle = edge ? '#fff' : PALE; x.lineWidth = edge ? 9 : 5;
  x.globalAlpha = 1; x.lineWidth = edge ? 9 : 5; BONES.forEach(([p, q]) => { x.beginPath(); x.moveTo(...P(b[p])); x.lineTo(...P(b[q])); x.stroke(); });
  x.beginPath(); x.moveTo(...P(b.sh)); x.lineTo(...P(b.hd)); x.stroke(); x.beginPath(); x.arc(...P(b.hd), 60, 0, 7); x.stroke();
  ['wr', 'el', 'sh', 'hp', 'kn', 'an'].forEach(j => { x.fillStyle = edge ? HL : '#0a3d27'; x.beginPath(); x.arc(...P(b[j]), edge ? 13 : 9, 0, 7); x.fill(); x.stroke(); });
  fan.append(c); sheets.push(c);
}

function draw(n, zoom, fade, skel) {
  const im = imgs[n], b = pose.frame(meta.first + n);
  const cx = (b.hp[0] + b.kn[0]) / 2 * W, cy = (b.sh[1] + b.an[1]) / 2 * H - H * .04;
  const fx = W / 2 + (cx - W / 2) * Math.min(1, (zoom - 1) * 1.2), fy = H / 2 + (cy - H / 2) * Math.min(1, (zoom - 1) * 1.2);
  const ox = Math.max(W - W * zoom, Math.min(0, W / 2 - fx * zoom)), oy = Math.max(H - H * zoom, Math.min(0, H / 2 - fy * zoom));
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  if (fade < 1 && im.complete && im.naturalWidth) { g.globalAlpha = 1 - fade; g.imageSmoothingQuality = 'high'; g.drawImage(im, ox, oy, W * zoom, H * zoom); g.globalAlpha = 1; }
  if (skel < .01) return;
  const P = p => [ox + p[0] * W * zoom, oy + p[1] * H * zoom], J = Object.fromEntries(['sh', 'el', 'wr', 'hp', 'kn', 'an', 'hd'].map(k => [k, P(b[k])]));
  const lw = Math.max(3, zoom * 2.4);
  g.save(); g.lineCap = g.lineJoin = 'round'; g.globalAlpha = skel * .4; g.strokeStyle = PALE; g.lineWidth = lw * .6; const Q = b.far.map(P);
  FAR_BONES.forEach(([p, q]) => { g.beginPath(); g.moveTo(...Q[p]); g.lineTo(...Q[q]); g.stroke(); });
  g.globalAlpha = skel; g.strokeStyle = HL; g.lineWidth = lw; BONES.forEach(([p, q]) => { g.beginPath(); g.moveTo(...J[p]); g.lineTo(...J[q]); g.stroke(); });
  ['wr', 'el', 'sh', 'hp', 'kn', 'an'].forEach(k => { g.fillStyle = '#fff'; g.beginPath(); g.arc(...J[k], lw * 1.25, 0, 7); g.fill(); });
  g.restore();
}

const s1 = $('s1'), s2 = $('s2'), s3 = $('s3'), l1 = s1.querySelector('.l1'), l2 = s1.querySelector('.l2');
let clock = 0, last = performance.now();
function frame(now) {
  const dt = Math.min(.05, (now - last) / 1000); last = now; if (!still) clock += dt;
  const p = progress(film), small = innerWidth <= 760;
  const push = ease(seg(p, .1, .36)), tilt = ease(seg(p, .46, .7)), spread = ease(seg(p, .52, .76));
  const n = still ? 4 : Math.floor(clock * 24) % N;
  draw(n, 1 + push * (small ? 2.4 : 1.25), seg(p, .3, .47), Math.min(seg(p, .16, .28), 1 - seg(p, .46, .54)));

  // Push in until the screen fills the window, then tip the frame back and let the stroke fan out of it.
  const fill = small ? 1.04 : Math.max(innerWidth / (rig.offsetWidth * .896), innerHeight / (rig.offsetWidth * .896 * 9 / 16)) * 1.02;
  const s = 1 + (fill - 1) * push - (fill - (small ? .92 : .8)) * tilt;
  const tx = small ? 0 : tilt * 11, ty = small ? tilt * 2 : tilt * 1;
  rig.style.transform = `translate(-50%, -50%) translate(${tx}vw, ${ty - (1 - push) * (small ? 2 : 0)}vh) scale(${s}) rotateX(${tilt * 12}deg) rotateY(${tilt * -36}deg)`;
  phone.style.boxShadow = tilt > .02 || push < .5 ? '' : 'none';
  sheets.forEach((c, k) => { c.style.opacity = seg(p, .48, .56) * (.35 + .65 * (k == 0 || k == LAYERS - 1 ? 1 : .75)); c.style.transform = `translateZ(${4 + spread * k * (small ? 36 : 54)}px)`; });

  l1.style.transform = `translateX(${-ease(seg(p, .04, .2)) * 70}vw)`; l2.style.transform = `translateX(${ease(seg(p, .04, .2)) * 70}vw)`;
  s1.style.opacity = 1 - seg(p, .08, .18); s2.style.opacity = Math.min(seg(p, .26, .34), 1 - seg(p, .44, .5)); s3.style.opacity = seg(p, .7, .8);
  [s1, s2, s3].forEach(x => x.style.visibility = +x.style.opacity ? 'visible' : 'hidden');
  requestAnimationFrame(frame);
}
await Promise.all(imgs.slice(0, 4).map(im => im.decode().catch(() => {})));
await document.fonts.ready;
requestAnimationFrame(frame); document.documentElement.dataset.ready = '1';

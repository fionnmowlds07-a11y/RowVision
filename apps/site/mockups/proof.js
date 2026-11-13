// Motion proof: each clip as filmed, beside the same frames with the joints the site will draw.
// Two strokes at real speed, then one at quarter speed. Nothing here is built on until the owner has judged it.
import { loadPose, BONES } from './shared/pose.js';

const cv = document.getElementById('cv'), g = cv.getContext('2d'), W = cv.width, H = cv.height;
const HL = '#4be38a', PALE = '#b6f2c9', SOFT = '#c4e4d2';
const LIST = [['pair', 'Pair, stroke seat'], ['single-a', 'Single, grey morning'], ['single-b', 'Single, crew passing behind'], ['pxl', 'Single, from the bank']];
const only = new URLSearchParams(location.search).get('clip');
const clips = [];
for (const [name, label] of LIST) {
  if (only && only != name) continue;
  const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = `./private/clips/${name}.mp4`;
  await new Promise(r => v.addEventListener('loadeddata', r, { once: true }));
  clips.push({ name, label, v, pose: await loadPose(`./private/pose/${name}.json`) });
}
await document.fonts.ready;

const PW = 696, PH = 522, PY = 84, LX = 16, RX = 728;
function arc(c, p, q, r, label) {
  const a1 = Math.atan2(p[1] - c[1], p[0] - c[0]), a2 = Math.atan2(q[1] - c[1], q[0] - c[0]); let d = a2 - a1; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
  g.strokeStyle = '#fff'; g.fillStyle = 'rgba(75,227,138,.28)'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(...c); g.arc(c[0], c[1], r, a1, a1 + d, d < 0); g.closePath(); g.fill(); g.stroke();
  const am = a1 + d / 2, tx = c[0] + Math.cos(am) * (r + 34), ty = c[1] + Math.sin(am) * (r + 34);
  g.font = '800 22px Bricolage'; g.textAlign = 'center'; g.textBaseline = 'middle'; const w = g.measureText(label).width + 16;
  g.fillStyle = '#04140b'; g.beginPath(); g.roundRect(tx - w / 2, ty - 16, w, 32, 7); g.fill(); g.fillStyle = '#fff'; g.fillText(label, tx, ty + 1);
}
function draw(c, t, rate, from, to) {
  const { v, pose } = c, b = pose.frame(t), i = Math.round(t);
  g.fillStyle = '#041a11'; g.fillRect(0, 0, W, H);
  // the crop follows the rower: wide enough for the whole stroke, centred between hips and knees
  const torso = Math.hypot((b.sh[0] - b.hp[0]) * pose.w, (b.sh[1] - b.hp[1]) * pose.h), cw = c.cw ??= Math.max(150, torso * 6.2), ch = cw * PH / PW;
  const cx = (b.hp[0] * .6 + b.kn[0] * .4) * pose.w, cy = (b.sh[1] * .5 + b.hp[1] * .5) * pose.h, sx = v.videoWidth / pose.w;
  const x0 = Math.max(0, Math.min(pose.w - cw, cx - cw / 2)), y0 = Math.max(0, Math.min(pose.h - ch, cy - ch / 2)), k = PW / cw;
  for (const px of [LX, RX]) { g.save(); g.beginPath(); g.roundRect(px, PY, PW, PH, 10); g.clip(); g.imageSmoothingQuality = 'high'; g.drawImage(v, x0 * sx, y0 * sx, cw * sx, ch * sx, px, PY, PW, PH); g.restore(); }
  // joints over the right-hand picture
  const P = p => [RX + (p[0] * pose.w - x0) * k, PY + (p[1] * pose.h - y0) * k], J = Object.fromEntries(['sh', 'el', 'wr', 'hp', 'kn', 'an', 'hd'].map(n => [n, P(b[n])]));
  g.save(); g.beginPath(); g.roundRect(RX, PY, PW, PH, 10); g.clip();
  g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(RX, PY, PW, PH);
  g.lineCap = g.lineJoin = 'round'; g.strokeStyle = HL; g.lineWidth = 5; g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 8;
  BONES.forEach(([p, q]) => { g.beginPath(); g.moveTo(...J[p]); g.lineTo(...J[q]); g.stroke(); });
  g.shadowBlur = 0; ['wr', 'el', 'sh', 'hp', 'kn', 'an'].forEach(n => { g.fillStyle = '#fff'; g.beginPath(); g.arc(...J[n], 6.5, 0, 7); g.fill(); });
  const bl = Math.hypot(J.sh[0] - J.hp[0], J.sh[1] - J.hp[1]);
  arc(J.kn, J.hp, J.an, bl * .42, Math.round(pose.knee[i]) + '°'); arc(J.el, J.sh, J.wr, bl * .32, Math.round(pose.elbow[i]) + '°');
  g.restore();
  // words
  g.textBaseline = 'alphabetic'; g.textAlign = 'left'; g.fillStyle = '#fff'; g.font = '800 34px Bricolage'; g.fillText(c.label, LX, 52);
  g.font = '600 15px "DM Sans"'; [['As filmed', LX], ['What RowVision reads', RX]].forEach(([txt, px]) => { const w = g.measureText(txt).width + 20; g.fillStyle = 'rgba(4,20,11,.82)'; g.beginPath(); g.roundRect(px + 12, PY + 12, w, 30, 8); g.fill(); g.fillStyle = '#fff'; g.fillText(txt, px + 22, PY + 32); });
  g.textAlign = 'right'; g.fillStyle = rate < 1 ? HL : '#fff'; g.font = '700 20px "DM Sans"'; g.fillText(rate < 1 ? 'Quarter speed' : 'Real speed', W - 16, 50);
  // knee angle through the strokes on screen, with the catches and finishes it found
  const tx0 = 60, tx1 = W - 16, ty0 = PY + PH + 58, ty1 = H - 18, X = j => tx0 + (j - from) / (to - from) * (tx1 - tx0), Y = a => ty1 - (a - 30) / 155 * (ty1 - ty0);
  g.font = '500 13px "DM Sans"'; g.textAlign = 'right'; g.textBaseline = 'middle';
  [60, 180].forEach(a => { g.strokeStyle = 'rgba(255,255,255,.14)'; g.lineWidth = 1; g.beginPath(); g.moveTo(tx0, Y(a)); g.lineTo(tx1, Y(a)); g.stroke(); g.fillStyle = SOFT; g.fillText(a + '°', tx0 - 8, Y(a)); });
  g.strokeStyle = PALE; g.lineWidth = 2.5; g.beginPath(); for (let j = from; j <= to; j++) j == from ? g.moveTo(X(j), Y(pose.knee[j])) : g.lineTo(X(j), Y(pose.knee[j])); g.stroke();
  g.fillStyle = HL; pose.catches.forEach(j => { if (j >= from && j <= to) { g.beginPath(); g.arc(X(j), Y(pose.knee[j]), 6, 0, 7); g.fill(); } });
  pose.finishes.forEach(j => { if (j >= from && j <= to) g.fillRect(X(j) - 5.5, Y(pose.knee[j]) - 5.5, 11, 11); });
  g.fillStyle = '#fff'; g.fillRect(X(Math.max(from, Math.min(to, t))) - 1, ty0 - 6, 2, ty1 - ty0 + 12);
  g.textAlign = 'left'; g.font = '500 16px "DM Sans"'; g.textBaseline = 'alphabetic'; g.fillStyle = SOFT; g.fillText('Knee angle through these strokes. Round marks are catches, square marks are finishes.', LX, PY + PH + 28);
}

// play frames [from, to] of a clip at a rate, drawing on every new video frame so picture and joints stay in step
function play(c, from, to, rate, span) {
  return new Promise(done => {
    const { v, pose } = c; v.playbackRate = rate; v.currentTime = from / pose.hz;
    const step = (_, meta) => { const t = Math.min(pose.N - 1.001, meta.mediaTime * pose.hz); draw(c, t, rate, span[0], span[1]); if (t >= to || v.ended) { v.pause(); done(); } else v.requestVideoFrameCallback(step); };
    v.addEventListener('seeked', () => { v.requestVideoFrameCallback(step); v.play(); }, { once: true });
  });
}
do {
  for (const c of clips) {
    const k = c.pose.catches, a = k.length > 3 ? 1 : 0, b = Math.min(k.length - 1, a + 2), span = [k[a], k[b]];
    await play(c, k[a], k[b], 1, span);
    await play(c, k[a], k[a + 1], .25, span);
  }
  document.documentElement.dataset.done = '1';
} while (!new URLSearchParams(location.search).has('once'));

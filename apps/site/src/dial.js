// The camera dial: move the launch round the boat and see what RowVision does with footage from there.
// The limits are the ones the measuring code uses: side-on up to 25 degrees, corrected up to 60, end-on beyond.
const box = document.getElementById('dial');
if (box) {
  const svg = box.querySelector('svg'), cam = svg.querySelector('#cam'), sight = svg.querySelector('#sight'), range = box.querySelector('input');
  const out = n => box.querySelector(`[data-read="${n}"]`), head = box.querySelector('[data-head]'), say = box.querySelector('[data-say]');
  const CX = 500, CY = 300, R = 235;
  const STATES = [
    [25, '', 'Side-on', 'Measured as filmed. This is the view to aim for, level with the boat.'],
    [60, 'state-warn', 'Off side-on', 'RowVision works out the angle and corrects the body angles for it. The result carries a warning that angles are less reliable, and knee angles are doubted first.'],
    [90, 'state-stop', 'End-on', 'Movement along the boat can hardly be seen from here. Strokes filmed end-on are listed but not counted, and a clip filmed mostly end-on gets no scores.'],
  ];
  function set(deg, fromRange) {
    deg = ((deg % 360) + 360) % 360;
    const a = deg * Math.PI / 180, x = CX + R * Math.sin(a), y = CY + R * Math.cos(a);      // 0 is straight out from the middle of the boat
    cam.setAttribute('transform', `translate(${x} ${y}) rotate(${-deg})`);
    sight.setAttribute('d', `M${x} ${y} L${CX} ${CY}`);
    const off = Math.round(Math.acos(Math.min(1, Math.abs(Math.cos(a)))) * 180 / Math.PI);
    const st = STATES.find(s => off <= s[0]);
    box.classList.remove('state-warn', 'state-stop'); if (st[1]) box.classList.add(st[1]);
    out('off').textContent = off + '°'; out('seen').textContent = Math.round(Math.cos(off * Math.PI / 180) * 100) + '%';
    head.textContent = st[2]; say.textContent = st[3];
    if (!fromRange) range.value = Math.round(deg);
    range.setAttribute('aria-valuetext', `${off} degrees off side-on, ${st[2].toLowerCase()}`);
  }
  range.addEventListener('input', () => set(+range.value, true));
  let down = false;
  const seek = e => { const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM().inverse()); set(Math.atan2(p.x - CX, p.y - CY) * 180 / Math.PI); };
  svg.addEventListener('pointerdown', e => { down = true; svg.setPointerCapture(e.pointerId); seek(e); });
  svg.addEventListener('pointermove', e => down && seek(e));
  ['pointerup', 'pointercancel'].forEach(n => svg.addEventListener(n, () => down = false));
  set(+range.value);
}

// Who you follow: the same rule the app uses to decide whose catch your timing is measured against.
// Scullers follow stroke. Sweep rowers follow the rower nearest the stern on their own side.
const box = document.getElementById('follow');
if (box) {
  const BOATS = { '1x': [1, false], '2x': [2, false], '2-': [2, true], '4x': [4, false], '4-': [4, true], '4+': [4, true], '8+': [8, true] };
  const hull = box.querySelector('.hull'), seatSeg = box.querySelector('[data-seats]'), sideSet = box.querySelector('[data-sides]');
  const val = n => box.querySelector(`input[name="${n}"]:checked`)?.value;
  const other = s => s === 'stroke' ? 'bow' : 'stroke';
  const sideOf = (seat, own, side) => (seat - own) % 2 === 0 ? side : other(side);

  function leader(seat, seats, side, strokeSide) {
    if (seat >= seats) return null;
    if (side !== 'scull' && side !== strokeSide && seat < seats - 1) return seats - 1;
    return seats;
  }

  function draw() {
    const cls = val('boat'), [seats, sweep] = BOATS[cls];
    if (seatSeg.dataset.n != seats) {
      const keep = Math.min(+val('seat') || seats, seats);
      seatSeg.innerHTML = Array.from({ length: seats }, (_, i) => `<label><input type="radio" name="seat" value="${i + 1}"${i + 1 === keep ? ' checked' : ''}><span>${i + 1}</span></label>`).join('');
      seatSeg.dataset.n = seats;
    }
    sideSet.hidden = !sweep;
    const seat = +val('seat'), own = sweep ? val('side') : 'scull';
    const strokeSide = sweep ? sideOf(seats, seat, own) : 'scull', lead = leader(seat, seats, own, strokeSide);
    const cox = cls.endsWith('+'), W = 1000, gap = Math.min(96, 640 / Math.max(seats, 2)), x0 = W / 2 - gap * (seats - 1) / 2, X = n => x0 + (n - 1) * gap, y = 110;
    const end = X(seats) + (cox ? gap : 0) + 70, start = X(1) - 80;
    let s = `<svg viewBox="0 0 ${W} 220" role="img" aria-label="The boat from above, bow on the left. Your seat is white and the rower you follow is green"><path d="M${start} ${y} C${start + 60} ${y - 26} ${end - 60} ${y - 26} ${end} ${y} C${end - 60} ${y + 26} ${start + 60} ${y + 26} ${start} ${y}Z" fill="none" stroke="rgba(255,255,255,.5)" stroke-width="3"/>`;
    for (let n = 1; n <= seats; n++) {
      const sd = sweep ? sideOf(n, seat, own) : 'scull', me = n === seat, ld = n === lead;
      // from above with the bow on the left, stroke side oars reach to the top of the drawing
      const oars = sd === 'scull' ? [-1, 1] : [sd === 'stroke' ? -1 : 1];
      oars.forEach(d => s += `<path d="M${X(n)} ${y} L${X(n) + 20} ${y + d * 78}" stroke="${me ? '#fff' : ld ? '#4be38a' : 'rgba(255,255,255,.4)'}" stroke-width="4" stroke-linecap="round"/>`);
      s += `<circle cx="${X(n)}" cy="${y}" r="20" fill="${me ? '#fff' : ld ? '#4be38a' : '#000'}" stroke="${me || ld ? 'none' : 'rgba(255,255,255,.6)'}" stroke-width="3"/><text x="${X(n)}" y="${y + 7}" text-anchor="middle" font-family="Bricolage, sans-serif" font-weight="800" font-size="20" fill="${me || ld ? '#04140b' : '#fff'}">${n}</text>`;
    }
    if (cox) s += `<circle cx="${X(seats) + gap}" cy="${y}" r="11" fill="none" stroke="rgba(255,255,255,.5)" stroke-width="3"/>`;
    if (lead) { const a = X(seat) + 26, b = X(lead) - 26; s += `<path d="M${a} ${y - 38} C${(a + b) / 2} ${y - 78} ${(a + b) / 2} ${y - 78} ${b} ${y - 38}" fill="none" stroke="#4be38a" stroke-width="3" stroke-dasharray="7 8" stroke-linecap="round"/><path d="M${b - 13} ${y - 50} L${b} ${y - 38} L${b - 16} ${y - 34}" fill="none" stroke="#4be38a" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`; }
    s += `<text x="${start - 12}" y="${y + 6}" text-anchor="end" font-family="DM Sans, sans-serif" font-size="18" fill="#a9bdb0">Bow</text><text x="${end + 12}" y="${y + 6}" font-family="DM Sans, sans-serif" font-size="18" fill="#a9bdb0">Stern</text></svg>`;
    const where = n => n === seats ? 'stroke' : n === 1 ? 'bow' : `seat ${n}`;
    const head = seats === 1 ? 'You are on your own. There is no one to follow.' : lead === null ? 'You are stroke. The crew follows you.' : `You follow ${where(lead)}.`;
    const why = seats === 1 ? 'A single has no timing to compare, so RowVision shows your own rhythm only.'
      : lead === null ? 'Stroke sets the rhythm, so there is no timing figure for this seat.'
      : !sweep ? 'Scullers all follow stroke. Your catch and finish are timed against theirs.'
      : lead === seats ? (own === strokeSide ? 'Stroke rows on your side, so you are timed against them directly.' : 'You are the rower nearest the stern on your side, so you follow stroke.')
      : `Seat ${lead} is the rower nearest the stern on your side. They follow stroke, and you follow them.`;
    hull.innerHTML = `${s}<p>${head}</p><p>${why}</p>`;
  }
  box.addEventListener('change', draw); draw();
}

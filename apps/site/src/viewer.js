// Reports open over the page, so nobody leaves the site to look at one. Back, Escape, Close or a click outside all return
// to the same place. Without script the links still open the plain files.
const papers = [...document.querySelectorAll('.papers')].map(list => [...list.querySelectorAll('a')].map(a => ({
  src: a.getAttribute('href'), alt: a.querySelector('img').alt, name: a.parentElement.querySelector('h3').textContent, pdf: list.dataset.pdf,
})));
const icon = d => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
const box = document.createElement('dialog');
box.className = 'viewer';
box.setAttribute('aria-label', 'Report viewer');
box.innerHTML = `<div class="vbar"><p aria-live="polite"><strong></strong> <span></span></p>
  <a class="save" download>Save PDF</a>
  <button type="button" data-zoom aria-pressed="false" aria-label="Zoom in">${icon('M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20.5 20.5 16 16M11 8v6M8 11h6')}</button>
  <button type="button" data-close aria-label="Close">${icon('M6 6l12 12M18 6 6 18')}</button></div>
  <button type="button" class="step" data-step="-1" aria-label="Previous page">${icon('M15 5l-7 7 7 7')}</button>
  <div class="vpage" tabindex="0" role="group" aria-label="Page"><img alt=""></div>
  <button type="button" class="step" data-step="1" aria-label="Next page">${icon('M9 5l7 7-7 7')}</button>`;
document.body.append(box);
const $ = s => box.querySelector(s), img = $('.vpage img'), page = $('.vpage'), zoomButton = $('[data-zoom]');
let set = [], at = 0, zoomed = false;

function zoom(on, x = .5, y = 0) {
  zoomed = on;
  box.classList.toggle('zoomed', on);
  zoomButton.setAttribute('aria-pressed', on);
  zoomButton.setAttribute('aria-label', on ? 'Zoom out' : 'Zoom in');
  page.scrollTo(on ? img.offsetWidth * x - page.clientWidth / 2 : 0, on ? img.offsetHeight * y - page.clientHeight / 2 : 0);
}
function show(n) {
  at = n;
  const it = set[at];
  img.src = it.src; img.alt = it.alt;
  $('.vbar strong').textContent = it.name;
  $('.vbar span').textContent = `${at + 1} of ${set.length}`;
  $('.save').hidden = !it.pdf;
  if (it.pdf) $('.save').href = it.pdf;
  $('[data-step="-1"]').disabled = at === 0;
  $('[data-step="1"]').disabled = at === set.length - 1;
  zoom(false);
}
const step = d => { if (set[at + d]) show(at + d); };
function open(src) {
  set = papers.find(list => list.some(it => it.src === src));
  if (!set) return false;
  show(set.findIndex(it => it.src === src));
  box.showModal();
  page.focus({ preventScroll: true });
  history.pushState({ viewer: true }, '');   // so the Back button closes the viewer and not the page
  return true;
}
const shut = () => { if (history.state?.viewer) history.back(); else box.close(); };

document.querySelector('main').addEventListener('click', e => {
  const a = e.target.closest('.papers a, .finds a, a[data-view]');
  if (a && !e.ctrlKey && !e.metaKey && !e.shiftKey && open(a.dataset.view ?? a.getAttribute('href'))) e.preventDefault();
});
addEventListener('popstate', () => { if (box.open) box.close(); });
if (history.state?.viewer) history.replaceState(null, '');   // a reload with the viewer open comes back to the page
box.addEventListener('cancel', e => { e.preventDefault(); shut(); });
box.addEventListener('keydown', e => {
  if (e.key === 'Escape') { e.preventDefault(); shut(); }
  else if (!zoomed && e.key === 'ArrowLeft') step(-1);
  else if (!zoomed && e.key === 'ArrowRight') step(1);
});
box.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (b?.dataset.step) step(+b.dataset.step);
  else if (b === zoomButton) zoom(!zoomed);
  else if (b || e.target === page || e.target === box) shut();
  else if (e.target === img) { const r = img.getBoundingClientRect(); zoom(!zoomed, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height); }
});
let from = null;
page.addEventListener('touchstart', e => { from = !zoomed && e.touches.length === 1 ? [e.touches[0].clientX, e.touches[0].clientY] : null; }, { passive: true });
page.addEventListener('touchend', e => {
  if (!from) return;
  const dx = e.changedTouches[0].clientX - from[0], dy = e.changedTouches[0].clientY - from[1];
  if (Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy)) step(dx < 0 ? 1 : -1);
}, { passive: true });

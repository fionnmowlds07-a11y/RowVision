// The header and menu, shared by every page. Without script the menu still opens: it is a details element.
const root = document.documentElement, menu = document.querySelector('.more');
const mark = () => root.classList.toggle('scrolled', scrollY > 24);
addEventListener('scroll', mark, { passive: true }); mark();
if (menu) {
  addEventListener('click', e => { if (menu.open && !menu.contains(e.target)) menu.open = false; });
  addEventListener('keydown', e => { if (e.key === 'Escape' && menu.open) { menu.open = false; menu.querySelector('summary').focus(); } });
}

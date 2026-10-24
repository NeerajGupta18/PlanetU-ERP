/**
 * "More than 4? Make it scroll." Lists and tables inside the signed-in screens show their first FOUR rows and
 * scroll for the rest, so a page never becomes one long column. It is done here, in one place, for every screen:
 * it finds the lists and tables, measures the first four rows (whatever their height) and caps the box there.
 *
 * Opt out for a working grid that must stay tall (mark sheets, mark entry): put data-noscroll on it or on a parent.
 * Change SCROLL_ROWS to change the number everywhere.
 */
export const SCROLL_ROWS = 4;

const LISTS = ['plain-list', 'todo-list', 'schedule', 'notices', 'bars', 'upcoming', 'timeline', 'day-events', 'lecture-rows', 'todo'];
const BOX = [
  { sel: '.table-wrap', rows: 'tbody > tr' },
  ...LISTS.map((c) => ({ sel: `ul.${c}, ol.${c}`, rows: ':scope > li' })),
];
const SKIP = '[data-noscroll], .modal, [role="dialog"], .picklist, .pick-list, .palette__list';

function fit(el, rowSel) {
  if (el.closest(SKIP)) return;
  const rows = el.querySelectorAll(rowSel);
  if (rows.length <= SCROLL_ROWS) {
    if (el.dataset.scrollCap) { el.style.maxHeight = ''; el.classList.remove('is-scroll'); delete el.dataset.scrollCap; }
    return;
  }
  const last = rows[SCROLL_ROWS - 1];
  if (last.getBoundingClientRect().height === 0) return; // on a hidden tab: measure when it is shown
  const top = el.getBoundingClientRect().top;
  const h = Math.ceil(last.getBoundingClientRect().bottom - top + el.scrollTop) + 3;
  if (el.dataset.scrollCap !== String(h)) {
    el.style.maxHeight = `${h}px`;
    el.classList.add('is-scroll');
    el.dataset.scrollCap = String(h);
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
    el.setAttribute('aria-label', el.getAttribute('aria-label') || 'Scrollable list. Scroll for more.');
  }
}

function run(root) {
  for (const { sel, rows } of BOX) root.querySelectorAll(sel).forEach((el) => fit(el, rows));
}

/** Starts watching `root`; returns a function that stops. */
export function startAutoScroll(root) {
  if (!root || typeof MutationObserver === 'undefined') return () => {};
  let frame = 0;
  const later = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => run(root)); };
  const mo = new MutationObserver(later);
  mo.observe(root, { childList: true, subtree: true });
  window.addEventListener('resize', later);
  later();
  return () => { mo.disconnect(); window.removeEventListener('resize', later); cancelAnimationFrame(frame); };
}

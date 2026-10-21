import { Spring, run } from './spring.js';
import { reducedMotion } from './motion.js';
import { paintPayout } from './register.js';

/* ---------- scroll reveal: staggered, spring driven ---------- */
export function initReveal() {
  const els = [...document.querySelectorAll('[data-reveal]')];
  const show = (el, delay) => {
    el.classList.add('is-in');
    if (reducedMotion()) return;
    const s = new Spring(0);
    s.t = 1;
    el.style.opacity = '0';
    el.style.transition = 'none';
    el.style.transform = 'translate3d(0, 28px, 0)';
    let wait = delay;
    run((dt) => {
      if (wait > 0) { wait -= dt * 1000; return true; }
      s.step(dt);
      el.style.opacity = String(Math.max(0, Math.min(1, s.x)));
      el.style.transform = `translate3d(0, ${((1 - s.x) * 28).toFixed(2)}px, 0)`;
      if (s.settled) {
        el.style.opacity = el.style.transform = el.style.transition = '';
        return false;
      }
      return true;
    });
  };
  if (reducedMotion() || typeof IntersectionObserver !== 'function') {
    els.forEach((el) => el.classList.add('is-in'));
    return;
  }
  const batch = new Map();
  let flushing = 0;
  const flush = () => {
    flushing = 0;
    const byParent = new Map();
    [...batch.keys()].forEach((el) => {
      const k = el.parentElement;
      byParent.set(k, (byParent.get(k) || 0) + 1);
    });
    const seen = new Map();
    batch.forEach((_, el) => {
      const k = el.parentElement;
      const i = seen.get(k) || 0;
      seen.set(k, i + 1);
      show(el, i * 70);
    });
    batch.clear();
  };
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      batch.set(e.target, 1);
    }
    if (batch.size && !flushing) flushing = requestAnimationFrame(flush);
  }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
  els.forEach((el) => io.observe(el));
}

/* ---------- progress bar ---------- */
export function initProgress() {
  const bar = document.getElementById('progress');
  let queued = false;
  const paint = () => {
    queued = false;
    const max = document.documentElement.scrollHeight - innerHeight;
    bar.style.transform = `scaleX(${max > 0 ? Math.min(1, scrollY / max) : 0})`;
  };
  const on = () => { if (!queued) { queued = true; requestAnimationFrame(paint); } };
  addEventListener('scroll', on, { passive: true });
  addEventListener('resize', on);
  paint();
}

/* ---------- hero parallax: pointer and scroll, springs on the individual translate property ---------- */
export function initParallax() {
  if (reducedMotion()) return;
  const hero = document.getElementById('hero');
  const layers = [...hero.querySelectorAll('[data-depth]')].map((el) => ({
    el, d: parseFloat(el.dataset.depth), x: new Spring(0, 90, 16), y: new Spring(0, 90, 16),
  }));
  let px = 0;
  let py = 0;
  let live = false;
  const tick = (dt) => {
    const sy = Math.min(scrollY, hero.offsetHeight);
    let busy = false;
    for (const l of layers) {
      l.x.t = px * l.d * 22;
      l.y.t = py * l.d * 16 - sy * (l.d - 0.2) * 0.14;
      l.x.step(dt); l.y.step(dt);
      l.el.style.translate = `${l.x.x.toFixed(2)}px ${l.y.x.toFixed(2)}px`;
      if (!l.x.settled || !l.y.settled) busy = true;
    }
    live = busy;
    return busy;
  };
  const wake = () => { if (!live) { live = true; run(tick); } };
  hero.addEventListener('pointermove', (e) => {
    const r = hero.getBoundingClientRect();
    px = ((e.clientX - r.left) / r.width - 0.5) * 2;
    py = ((e.clientY - r.top) / r.height - 0.5) * 2;
    wake();
  });
  hero.addEventListener('pointerleave', () => { px = 0; py = 0; wake(); });
  addEventListener('scroll', wake, { passive: true });
  wake();
}

/* ---------- spotlight ---------- */
export function initSpotlight() {
  document.addEventListener('pointermove', (e) => {
    const t = e.target instanceof Element ? e.target.closest('.spot') : null;
    if (!t) return;
    const r = t.getBoundingClientRect();
    t.style.setProperty('--mx', `${e.clientX - r.left}px`);
    t.style.setProperty('--my', `${e.clientY - r.top}px`);
  }, { passive: true });
}

/* ---------- tabs (payouts) ---------- */
export function initTabs() {
  const tabs = [...document.querySelectorAll('[data-tab]')];
  const table = document.querySelector('[data-table="payout-table"]');
  const select = (t, focus) => {
    tabs.forEach((b) => {
      const on = b === t;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    table.setAttribute('aria-labelledby', t.id);
    table.querySelector('[data-col-label]').textContent = t.dataset.tab === 'std' ? 'Advance' : 'Advance, wide';
    paintPayout(table, t.dataset.tab);
    if (focus) t.focus();
  };
  tabs.forEach((b, i) => {
    b.addEventListener('click', () => select(b));
    b.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      select(tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length], true);
    });
  });
}

/* ---------- copy with feedback ---------- */
export function initCopy() {
  const live = document.createElement('div');
  live.className = 'sr';
  live.setAttribute('aria-live', 'polite');
  document.body.appendChild(live);
  const write = async (text) => {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.className = 'sr';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  };
  document.addEventListener('click', async (e) => {
    const btn = e.target instanceof Element ? e.target.closest('[data-copy], [data-ca-copy]') : null;
    if (!btn || btn.disabled) return;
    const text = btn.dataset.copy || (btn.closest('[data-slot="ca"]') || {}).dataset?.address;
    if (!text) return;
    const ok = await write(text);
    const label = btn.querySelector('[data-copy-text]');
    btn.classList.add('is-done');
    if (label) label.textContent = ok ? 'Copied' : 'Select and copy';
    live.textContent = ok ? 'Address copied' : 'Copy failed, select the address manually';
    clearTimeout(btn._t);
    btn._t = setTimeout(() => {
      btn.classList.remove('is-done');
      if (label) label.textContent = 'Copy';
      live.textContent = '';
    }, 1800);
  });
}

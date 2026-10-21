// The register: every external fact is one record with a state (stated | absent | unconfirmed).
// Absent and unconfirmed records render inert and never carry a value or a url.
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const HEX = /^0x[0-9a-fA-F]{40}$/;

export function loadRegister() {
  const el = document.getElementById('register');
  return JSON.parse(el.textContent).records;
}
export const stated = (r) => !!r && r.state === 'stated';
export const isAddress = (v) => typeof v === 'string' && (B58.test(v) || HEX.test(v));

// Link rule: the url is stored, the handle is derived from it.
export function handleFrom(url, hosts) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return null;
    if (!hosts.includes(u.hostname.replace(/^www\./, ''))) return null;
    const h = u.pathname.split('/').filter(Boolean)[0];
    return h ? h.replace(/^@/, '') : null;
  } catch { return null; }
}

const SOCIALS = { x: ['x.com', 'twitter.com'], github: ['github.com'] };
const EXPLORERS = {
  dexscreener: ['DexScreener', (a) => `https://dexscreener.com/solana/${a}`],
  solscan: ['Solscan', (a) => `https://solscan.io/token/${a}`],
};

function setStat(el, rec) {
  const label = el.querySelector('.stat__label');
  if (label && rec && rec.label) label.textContent = rec.label;
  const val = el.querySelector('[data-val]');
  const ok = stated(rec) && rec.value != null && String(rec.value) !== '';
  el.dataset.state = ok ? 'stated' : (rec && rec.state === 'unconfirmed' ? 'unconfirmed' : 'absent');
  if (val) val.textContent = ok ? String(rec.value) : '—';
}

function applyCa(rec) {
  const ok = stated(rec) && isAddress(rec.value);
  document.querySelectorAll('[data-slot="ca"]').forEach((slot) => {
    const val = slot.querySelector('[data-ca-value]');
    const btn = slot.querySelector('[data-ca-copy]');
    const label = slot.querySelector('[data-ca-label]');
    if (label && rec.label) label.textContent = rec.label;
    if (ok) {
      slot.dataset.state = 'stated';
      slot.dataset.address = rec.value;
      val.removeAttribute('data-pending');
      val.textContent = rec.value;
      btn.disabled = false;
      btn.removeAttribute('aria-disabled');
      btn.setAttribute('aria-label', `Copy ${rec.label.toLowerCase()}`);
    } else {
      slot.dataset.state = rec && rec.state === 'unconfirmed' ? 'unconfirmed' : 'absent';
      delete slot.dataset.address;
    }
  });
  document.querySelectorAll('[data-explorer]').forEach((node) => {
    const [name, build] = EXPLORERS[node.dataset.explorer];
    if (ok) {
      const a = document.createElement('a');
      a.className = 'btn';
      a.dataset.explorer = node.dataset.explorer;
      a.href = build(rec.value);
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = name;
      node.replaceWith(a);
    } else {
      node.textContent = `${name} · pending`;
    }
  });
}

function applySocials(reg) {
  document.querySelectorAll('[data-social]').forEach((node) => {
    const id = node.dataset.social;
    const rec = reg[id];
    const handle = stated(rec) ? handleFrom(rec.url, SOCIALS[id]) : null;
    const name = (rec && rec.label) || id;
    if (handle) {
      const a = document.createElement('a');
      a.className = 'social';
      a.dataset.social = id;
      a.href = rec.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.setAttribute('aria-label', `${name}, @${handle}`);
      a.innerHTML = node.innerHTML;
      node.replaceWith(a);
    } else {
      node.setAttribute('aria-label', `${name}, pending`);
      node.setAttribute('title', `${name}, pending`);
    }
  });
}

const fmtPct = (n, unit) => `${Number(n).toFixed(2)}${unit}`;

function applySeries(rec) {
  const bars = document.querySelector('[data-bars]');
  const best = document.querySelector('[data-stat-derived="best"]');
  const latest = document.querySelector('[data-stat-derived="latest"]');
  const vals = stated(rec) && Array.isArray(rec.values) ? rec.values.map(Number).filter(Number.isFinite).slice(0, 12) : [];
  if (!vals.length) { bars.dataset.state = 'absent'; return; }
  const unit = rec.unit || '%';
  const max = Math.max(...vals, 1e-9);
  bars.dataset.state = 'stated';
  bars.setAttribute('aria-label', 'Collected each cycle');
  [...bars.children].forEach((li, i) => {
    const v = vals[i];
    li.querySelector('i').style.setProperty('--h', v == null ? '4%' : `${Math.max(4, (v / max) * 100)}%`);
    li.querySelector('span').textContent = v == null ? String(i + 1) : fmtPct(v, unit);
  });
  const set = (el, v) => { el.dataset.state = 'stated'; el.querySelector('[data-val]').textContent = fmtPct(v, unit); };
  set(best, max);
  set(latest, vals[vals.length - 1]);
}

function applyTable(tableEl, rec, map) {
  const rows = [...tableEl.querySelectorAll('[data-row]')];
  const data = stated(rec) && Array.isArray(rec.rows) ? rec.rows : [];
  tableEl.dataset.state = data.length ? 'stated' : 'absent';
  tableEl._rows = data;
  rows.forEach((row, i) => {
    const d = data[i];
    if (d && d.label) row.firstElementChild.textContent = d.label;
    map(row, d);
  });
  const note = document.querySelector(`[data-state-note="${tableEl.dataset.table}"]`);
  if (note) note.hidden = data.length > 0;
}

export function paintPayout(tableEl, tab) {
  const rows = [...tableEl.querySelectorAll('[data-row]')];
  rows.forEach((row, i) => {
    const d = (tableEl._rows || [])[i];
    row.querySelector('[data-c="move"]').textContent = d && d.move != null ? String(d.move) : '—';
    row.querySelector('[data-c="adv"]').textContent = d && d[tab] != null ? String(d[tab]) : '—';
  });
}

export function applyRegister(reg) {
  applyCa(reg.ca || {});
  applySocials(reg);
  document.querySelectorAll('[data-stat]').forEach((el) => setStat(el, reg[el.dataset.stat]));
  applySeries(reg['series-cycles']);
  const pay = document.querySelector('[data-table="payout-table"]');
  applyTable(pay, reg['payout-table'], () => {});
  paintPayout(pay, 'std');
  const cmp = document.querySelector('[data-table="compare-table"]');
  applyTable(cmp, reg['compare-table'], (row, d) => {
    row.querySelector('[data-c="other"]').textContent = d && d.other != null ? String(d.other) : '—';
    row.querySelector('[data-c="xylo"]').textContent = d && d.xylo != null ? String(d.xylo) : '—';
  });
  const other = stated(reg['compare-table']) && reg['compare-table'].otherName;
  if (other) cmp.querySelector('[data-cmp-other]').textContent = other;
  const dom = document.querySelector('[data-domain]');
  if (dom) {
    if (stated(reg.domain) && reg.domain.value) dom.textContent = reg.domain.value;
    else dom.textContent = 'pending';
  }
}

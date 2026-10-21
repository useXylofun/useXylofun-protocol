// Live market. Follows the market register record only: the CA record has no say here.
import { stated } from './register.js';
import { fmtPrice, fmtUsd, fmtChange } from './format.js';
import { reducedMotion } from './motion.js';

const POLL = 60000;
const BACKOFF_BASE = 3000;
const ROWS = 10;
const COPY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>';

const FEED_TEXT = {
  idle: 'Reaching the board',
  live: 'Live feed · Solana',
  retry: 'Feed retrying · showing last good rows',
  down: 'Feed unreachable · retrying',
  off: 'Feed pending',
};

function setFeed(state) {
  document.querySelectorAll('[data-feed]').forEach((el) => {
    el.dataset.feed = state;
    const t = el.querySelector('[data-feed-text]');
    if (t) t.textContent = FEED_TEXT[state];
  });
}

async function getJson(url, signal) {
  const res = await fetch(url, { signal, headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`http ${res.status}`);
  return res.json();
}

async function loadTop(rec, signal) {
  const boosts = await getJson(rec.boosts, signal);
  const list = Array.isArray(boosts) ? boosts : [];
  const icons = new Map();
  const addrs = [];
  for (const b of list) {
    if (!b || b.chainId !== 'solana' || typeof b.tokenAddress !== 'string') continue;
    if (!icons.has(b.tokenAddress)) {
      addrs.push(b.tokenAddress);
      icons.set(b.tokenAddress, typeof b.icon === 'string' && b.icon.startsWith('https://') ? b.icon : '');
    }
  }
  if (!addrs.length) throw new Error('no solana entries');
  const pairs = await getJson(rec.pairs + addrs.slice(0, 30).join(','), signal);
  const best = new Map();
  for (const p of Array.isArray(pairs) ? pairs : []) {
    const a = p && p.baseToken && p.baseToken.address;
    if (!a || p.chainId !== 'solana' || !icons.has(a)) continue;
    const liq = Number(p.liquidity && p.liquidity.usd) || 0;
    const prev = best.get(a);
    if (!prev || liq > prev.liq) best.set(a, { p, liq });
  }
  const rows = [];
  for (const [a, { p, liq }] of best) {
    const vol = Number(p.volume && p.volume.h24);
    if (!Number.isFinite(vol)) continue;
    const img = (p.info && typeof p.info.imageUrl === 'string' && p.info.imageUrl.startsWith('https://')) ? p.info.imageUrl : icons.get(a);
    rows.push({
      addr: a,
      symbol: String(p.baseToken.symbol || '?').slice(0, 12),
      name: String(p.baseToken.name || p.baseToken.symbol || '').slice(0, 40),
      price: Number(p.priceUsd),
      chg: p.priceChange && p.priceChange.h24 != null ? Number(p.priceChange.h24) : NaN,
      vol,
      liq,
      img,
    });
  }
  if (!rows.length) throw new Error('no pairs');
  rows.sort((x, y) => y.vol - x.vol);
  return rows.slice(0, ROWS);
}

/* ---------- rendering ---------- */

function tween(el, to, fmt, dur = 900) {
  const from = el._n ?? 0;
  el._n = to;
  if (reducedMotion() || !Number.isFinite(to) || !Number.isFinite(from) || from === to) { el.textContent = fmt(to); return; }
  const t0 = performance.now();
  const tick = (now) => {
    if (el._n !== to) return;
    const k = Math.min(1, (now - t0) / dur);
    const e = 1 - Math.pow(1 - k, 3);
    el.textContent = fmt(from + (to - from) * e);
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function flash(cell, dir) {
  if (reducedMotion()) return;
  cell.classList.remove('flash-up', 'flash-down');
  void cell.offsetWidth;
  cell.classList.add(dir > 0 ? 'flash-up' : 'flash-down');
}

function tile(row, big) {
  const span = document.createElement('span');
  span.className = big ? 'tile tile--lg' : 'tile';
  const letter = () => { span.textContent = (row.symbol || '?').charAt(0).toUpperCase(); };
  if (row.img) {
    const img = new Image();
    img.alt = '';
    img.decoding = 'async';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    img.width = 32; img.height = 32;
    img.onerror = () => { img.remove(); letter(); };
    img.src = row.img;
    span.appendChild(img);
  } else letter();
  return span;
}

const FIELDS = [
  ['price', 'Price', 'c-pr', (r) => r.price, fmtPrice],
  ['chg', '24h', 'c-ch', (r) => r.chg, fmtChange],
  ['vol', 'Volume', 'c-vo', (r) => r.vol, fmtUsd],
  ['liq', 'Liquidity', 'c-li', (r) => r.liq, fmtUsd],
];

function buildRow(row, i) {
  const li = document.createElement('div');
  li.className = 'brow spot is-in';
  li.setAttribute('role', 'row');
  li.style.setProperty('--i', i);
  li.dataset.addr = row.addr;
  const rank = document.createElement('span');
  rank.className = 'brow__rank';
  rank.setAttribute('role', 'cell');
  rank.textContent = String(i + 1);
  const tok = document.createElement('span');
  tok.className = 'brow__tok';
  tok.setAttribute('role', 'cell');
  const names = document.createElement('span');
  names.innerHTML = '<b></b><small></small>';
  names.firstChild.textContent = row.symbol;
  names.lastChild.textContent = row.name;
  tok.append(tile(row, true), names);
  li.append(rank, tok);
  for (const [k, lab, cls] of FIELDS) {
    const c = document.createElement('span');
    c.className = `cell r ${cls}`;
    c.dataset.k = k;
    c.setAttribute('role', 'cell');
    c.innerHTML = '<span class="lab"></span><span class="v"></span>';
    c.firstChild.textContent = lab;
    li.appendChild(c);
  }
  const cp = document.createElement('button');
  cp.type = 'button';
  cp.className = 'copy copy--ghost cp';
  cp.dataset.copy = row.addr;
  cp.setAttribute('aria-label', `Copy address for ${row.symbol}`);
  cp.innerHTML = COPY_ICON;
  li.appendChild(cp);
  return li;
}

function paintRow(li, row, first) {
  for (const [k, , , get, fmt] of FIELDS) {
    const cell = li.querySelector(`[data-k="${k}"]`);
    const v = cell.querySelector('.v');
    const next = get(row);
    const prev = v._n;
    if (k === 'chg') cell.classList.toggle('up', next >= 0), cell.classList.toggle('down', next < 0);
    if (!first && prev != null && next !== prev) flash(cell, next > prev ? 1 : -1);
    tween(v, next, fmt, first ? 1100 : 800);
  }
}

function skeletonRows(board) {
  board.textContent = '';
  for (let i = 0; i < ROWS; i++) {
    const li = document.createElement('div');
    li.className = 'brow brow--skel';
    li.setAttribute('role', 'row');
    li.setAttribute('aria-hidden', 'true');
    li.innerHTML = '<span class="sk sk--xs"></span><span class="brow__tok"><span class="sk sk--round"></span><span class="sk sk--md"></span></span><span class="sk r"></span><span class="sk r"></span><span class="sk r"></span><span class="sk r"></span><span></span>';
    board.appendChild(li);
  }
}

function dashRows(board) {
  board.textContent = '';
  for (let i = 0; i < ROWS; i++) {
    const li = document.createElement('div');
    li.className = 'brow';
    li.setAttribute('role', 'row');
    const cells = ['<span class="cell r c-pr" role="cell"><span class="lab">Price</span><span>—</span></span>',
      '<span class="cell r c-ch" role="cell"><span class="lab">24h</span><span>—</span></span>',
      '<span class="cell r c-vo" role="cell"><span class="lab">Volume</span><span>—</span></span>',
      '<span class="cell r c-li" role="cell"><span class="lab">Liquidity</span><span>—</span></span>'].join('');
    li.innerHTML = `<span class="brow__rank" role="cell">${i + 1}</span><span class="brow__tok" role="cell"><span class="tile tile--lg">–</span><span><b>—</b></span></span>${cells}<span></span>`;
    board.appendChild(li);
  }
}

function renderBoard(board, rows, first) {
  const keep = new Map([...board.querySelectorAll('[data-addr]')].map((el) => [el.dataset.addr, el]));
  if (first) board.textContent = '';
  rows.forEach((row, i) => {
    let li = keep.get(row.addr);
    const fresh = !li;
    if (fresh) li = buildRow(row, i);
    li.style.setProperty('--i', i);
    li.querySelector('.brow__rank').textContent = String(i + 1);
    board.appendChild(li);
    keep.delete(row.addr);
    paintRow(li, row, first || fresh);
  });
  keep.forEach((el) => el.remove());
}

function renderTicker(track, rows) {
  const dup = !reducedMotion();
  const key = rows.map((r) => r.addr).join(',') + (dup ? 'd' : 's');
  if (track._key === key) {
    rows.forEach((r, i) => track.querySelectorAll(`[data-tk="${i}"]`).forEach((el) => {
      el.querySelector('.tp').textContent = fmtPrice(r.price);
      const c = el.querySelector('.tc');
      c.textContent = fmtChange(r.chg);
      c.className = `tc ${r.chg >= 0 ? 'up' : 'down'}`;
    }));
    return;
  }
  track._key = key;
  track.textContent = '';
  const copies = dup ? 2 : 1;
  for (let n = 0; n < copies; n++) {
    rows.forEach((r, i) => {
      const el = document.createElement('span');
      el.className = 'tick';
      el.dataset.tk = String(i);
      if (n === 1) { el.setAttribute('aria-hidden', 'true'); }
      el.append(tile(r, false));
      const b = document.createElement('b');
      b.textContent = r.symbol;
      const p = document.createElement('span');
      p.className = 'tp tab-num';
      p.textContent = fmtPrice(r.price);
      const c = document.createElement('span');
      c.className = `tc tab-num ${r.chg >= 0 ? 'up' : 'down'}`;
      c.textContent = fmtChange(r.chg);
      el.append(b, p, c);
      track.appendChild(el);
    });
  }
}

/* ---------- loop ---------- */

export function startMarket(rec) {
  const board = document.querySelector('[data-board]');
  const msg = document.querySelector('[data-board-msg]');
  const track = document.querySelector('[data-ticker]');
  const done = () => { document.documentElement.dataset.marketReady = '1'; };
  skeletonRows(board);

  if (!stated(rec)) {
    setFeed('off');
    dashRows(board);
    msg.hidden = false;
    msg.textContent = 'The market source is pending.';
    track.parentElement.hidden = true;
    done();
    return;
  }

  let rows = null;
  let fails = 0;
  let timer = 0;
  let ctl = null;
  let busy = false;

  const schedule = (ms) => { clearTimeout(timer); timer = setTimeout(cycle, ms); };

  async function cycle() {
    if (document.hidden || busy) return;
    busy = true;
    ctl = new AbortController();
    const kill = setTimeout(() => ctl.abort(), 12000);
    try {
      const next = await loadTop(rec, ctl.signal);
      const first = !rows;
      rows = next;
      fails = 0;
      msg.hidden = true;
      renderBoard(board, rows, first);
      renderTicker(track, rows);
      setFeed('live');
      schedule(POLL);
    } catch (err) {
      if (document.hidden) { busy = false; clearTimeout(kill); return; }
      fails += 1;
      if (rows) {
        setFeed('retry');
        msg.hidden = false;
        msg.textContent = 'The feed missed a beat. Showing the last good rows while it retries.';
      } else {
        setFeed('down');
        dashRows(board);
        msg.hidden = false;
        msg.textContent = 'The feed did not answer. Retrying with a growing pause.';
        track.textContent = '';
        track._key = '';
      }
      schedule(Math.min(POLL, BACKOFF_BASE * 2 ** (fails - 1)) * (0.85 + Math.random() * 0.3));
    } finally {
      clearTimeout(kill);
      busy = false;
      done();
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearTimeout(timer);
      if (ctl) ctl.abort();
    } else {
      clearTimeout(timer);
      cycle();
    }
  });
  if (!document.hidden) cycle();
}

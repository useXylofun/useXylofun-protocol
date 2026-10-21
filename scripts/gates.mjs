// Gates: static scans of dist/, copy-overlap check, and a mutation harness that rebuilds the site
// with every register record forced into both states and checks the rendered DOM.
// Usage: node scripts/gates.mjs   (exit 0 only when every gate passes)
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { fakeAddress, marketFixtures, routeFixtures } from '../gates/fixtures/market.mjs';
import { ALLOW, grams, words } from './copy-tokens.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const reg = JSON.parse(readFileSync(join(root, 'register.json'), 'utf8'));
const results = [];
const gate = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `\n        ${String(detail).split('\n').slice(0, 6).join('\n        ')}`}`);
};
const sh = (name, fn) => { try { fn(); } catch (e) { gate(name, false, e.stack || e); } };

/* ---------- file helpers ---------- */
const TEXT = new Set(['.html', '.css', '.js', '.svg', '.txt', '.json', '.md', '.mjs']);
function walk(dir, skip = []) {
  const out = [];
  for (const n of readdirSync(dir)) {
    if (skip.includes(n)) continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...walk(p, skip));
    else out.push(p);
  }
  return out;
}
const rel = (p) => p.slice(root.length + 1).replace(/\\/g, '/');
const distText = () => walk(dist).filter((f) => TEXT.has(extname(f)) || f.endsWith('_headers')).map((f) => [f, readFileSync(f, 'utf8')]);

function build(regObj, out) {
  const tmp = join(out, '..', `${out.split(/[\\/]/).pop()}.json`);
  writeFileSync(tmp, JSON.stringify(regObj));
  let r;
  for (let i = 0; i < 4; i++) {
    r = spawnSync(process.execPath, [join(root, 'scripts/build.mjs'), '--register', tmp, '--out', out], { encoding: 'utf8' });
    if (r.status === 0 || /register rejected/.test(r.stderr)) break;
  }
  rmSync(tmp, { force: true });
  return r;
}

/* ---------- detectors ---------- */
const MONTH = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const DAY = '(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)';
const DATE_RES = [
  /\b\d{4}-\d{2}-\d{2}\b/, /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/, new RegExp(`\\b${MONTH}\\.?\\s+\\d{1,2}\\b`, 'i'), new RegExp(`\\b\\d{1,2}\\s+${MONTH}\\b`, 'i'),
  /\b\d{1,2}:\d{2}\b/, /\b(?:19|20)\d{2}\b/, /\bas of\b/i, /\bchecked\b/i, /\bago\b/i, /\bupdated\b/i, /\b\d+\s?(?:am|pm)\b/i, new RegExp(`\\b${DAY}s?\\b`, 'i'),
];
const findDate = (s) => { for (const re of DATE_RES) { const m = s.match(re); if (m) return m[0]; } return null; };
const HEX_RE = /#[0-9a-fA-F]{3,8}(?![0-9a-zA-Z_-])/g;
const FUNC_RE = /\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\(/i;
const NAMED_RE = /(?<![-\w#.])(?:white|black|red|green|blue|gray|grey|navy|teal|cyan|orange|purple|pink|yellow|silver)(?![-\w])/i;
const ADDR_RE = /0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44}/g;
const FORBID = new RegExp([['clau', 'de'], ['anthr', 'opic'], ['\\bA', 'I\\b'], ['\\bGP', 'T\\b'], ['generated ', 'by'], ['co-', 'authored']].map((p) => p.join('')).join('|'), 'i');

/* ======================= STATIC GATES ======================= */
if (!existsSync(join(dist, 'index.html'))) { console.error('dist/index.html missing: run npm run build first'); process.exit(1); }
const files = distText();
const tokensCss = readFileSync(join(root, 'src/css/tokens.css'), 'utf8');
const tokenHexes = new Set((tokensCss.match(HEX_RE) || []).map((h) => h.toLowerCase()));

sh('no dates, timestamps or clock strings in dist', () => {
  const bad = [];
  for (const [f, t] of files) {
    if (f.endsWith('.svg')) continue;
    const body = f.endsWith('.html') ? t.replace(/<script type="application\/json"[\s\S]*?<\/script>/, '') : t;
    const hit = findDate(body.replace(/min-width:\s*\d+px/g, ''));
    if (hit) bad.push(`${rel(f)}: "${hit}"`);
  }
  gate('no dates, timestamps or clock strings in dist', !bad.length, bad.join('\n'));
});

sh('colour literals live in tokens.css only', () => {
  const bad = [];
  for (const [f, t] of files) {
    if (f.endsWith('tokens.css')) continue;
    if (f.endsWith('favicon.svg')) {
      for (const m of t.matchAll(/fill="(#[0-9a-fA-F]{6})"/g)) if (!tokenHexes.has(m[1].toLowerCase())) bad.push(`${rel(f)}: ${m[1]} is not a token`);
      continue;
    }
    const body = f.endsWith('.html') ? t.replace(/<script type="application\/json"[\s\S]*?<\/script>/, '') : t;
    const h = body.match(HEX_RE);
    if (h) bad.push(`${rel(f)}: ${h[0]}`);
    if (FUNC_RE.test(body)) bad.push(`${rel(f)}: colour function`);
    if (f.endsWith('.css') && NAMED_RE.test(body.replace(/--[\w-]+/g, ''))) bad.push(`${rel(f)}: named colour`);
  }
  gate('colour literals live in tokens.css only', !bad.length, bad.join('\n'));
});

sh('tokens carry provenance', () => {
  gate('tokens.css documents palette provenance (k-means, snapped, coordinates)', /k-means/.test(tokensCss) && /snapped/.test(tokensCss) && /at \d+,\d+/.test(tokensCss));
});

sh('no ch units', () => {
  const bad = files.filter(([f, t]) => !f.endsWith('.svg') && /(?<![\w-])\d*\.?\d+ch\b/.test(t)).map(([f]) => rel(f));
  gate('no ch units anywhere in dist', !bad.length, bad.join('\n'));
});

sh('favicon', () => {
  const svg = readFileSync(join(dist, 'assets/favicon.svg'), 'utf8');
  gate('favicon is a 32x32 SVG with no comments and no double hyphens', /width="32" height="32" viewBox="0 0 32 32"/.test(svg) && !svg.includes('--') && !svg.includes('<!--'));
  const html = readFileSync(join(dist, 'index.html'), 'utf8');
  gate('favicon is linked from the page', /rel="icon"[^>]*favicon\.svg/.test(html));
});

sh('socials at every breakpoint', () => {
  const css = readFileSync(join(dist, 'assets/app.css'), 'utf8');
  const html = readFileSync(join(dist, 'index.html'), 'utf8');
  const hidden = /\.socials?\b[^{}]*\{[^}]*display:\s*none/.test(css);
  const icons = /data-social="x"/.test(html) && /data-social="github"/.test(html);
  const noText = !/data-social="(?:x|github)"[^>]*>[^<]*[A-Za-z]/.test(html.replace(/<svg[\s\S]*?<\/svg>/g, ''));
  gate('X and GitHub icons present, never hidden at a breakpoint, icon only', icons && !hidden && noText);
  const svgOk = html.includes('M18.244 2.25h3.308') && html.includes('M12 1C5.923 1 1 5.923 1 12');
  gate('official X mark and GitHub Octicon paths are used', svgOk);
});

sh('repo hygiene', () => {
  const bad = [];
  for (const f of ['CLAUDE.md', '.claude', 'claude.md']) if (existsSync(join(root, f))) bad.push(f);
  for (const f of walk(root, ['node_modules', '.git', 'brand', 'reference'])) {
    if (f.endsWith('gates.mjs') || !TEXT.has(extname(f)) && !f.endsWith('LICENSE')) continue;
    if (FORBID.test(readFileSync(f, 'utf8'))) bad.push(rel(f));
  }
  gate('no CLAUDE.md, no .claude/, no AI attribution in any file', !bad.length, bad.join('\n'));
  const need = ['README.md', 'docs/whitepaper.md', 'LICENSE'].filter((f) => !existsSync(join(root, f)));
  gate('README.md, docs/whitepaper.md and LICENSE exist in the project root', !need.length, need.join(', '));
  gate('repo files are not in dist/', !['README.md', 'LICENSE', 'whitepaper.md', 'register.json'].some((f) => existsSync(join(dist, f)) || existsSync(join(dist, 'docs', f))));
  gate('LICENSE is MIT, copyright XYLO 2026', /^MIT License/.test(readFileSync(join(root, 'LICENSE'), 'utf8')) && /Copyright \(c\) 2026 XYLO/.test(readFileSync(join(root, 'LICENSE'), 'utf8')));
});

sh('register shape', () => {
  const bad = [];
  for (const [id, r] of Object.entries(reg.records)) {
    if (!['stated', 'absent', 'unconfirmed'].includes(r.state)) bad.push(`${id}: state`);
    if (r.state !== 'stated') for (const k of ['value', 'url', 'values', 'rows']) if (k in r) bad.push(`${id}: inert record carries ${k}`);
  }
  gate('every record has a valid state and inert records carry no value or url', !bad.length, bad.join('\n'));
  const pub = JSON.parse(readFileSync(join(dist, 'index.html'), 'utf8').match(/<script type="application\/json" id="register">([\s\S]*?)<\/script>/)[1]);
  const keys = JSON.stringify(pub);
  gate('shipped register holds no dates', !findDate(keys));
});

/* ======================= RENDER HARNESS ======================= */
const B58A = fakeAddress(901);
const HEXA = '0x' + 'ab12'.repeat(10);

async function render(out, { reduced = true, fetchImpl, hidden = false } = {}) {
  const html = readFileSync(join(out, 'index.html'), 'utf8');
  const js = readFileSync(join(out, 'assets/app.js'), 'utf8');
  const calls = [];
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' });
  const w = dom.window;
  const fx = marketFixtures();
  w.matchMedia = (q) => ({ matches: reduced && /reduce/.test(q), media: q, addEventListener() {}, removeEventListener() {} });
  w.fetch = fetchImpl || (async (url, opt) => {
    calls.push(String(url));
    const body = routeFixtures(String(url), fx);
    if (String(url).includes('publicnode')) return { ok: true, json: async () => ({ result: { value: { uiAmountString: '1000' } } }) };
    return body ? { ok: true, status: 200, json: async () => body } : { ok: false, status: 404, json: async () => ({}) };
  });
  const writes = [];
  Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async (t) => { writes.push(t); } }, configurable: true });
  if (hidden) Object.defineProperty(w.document, 'hidden', { value: true, configurable: true });
  w.eval(js);
  for (let i = 0; i < 80 && !w.document.documentElement.dataset.marketReady; i++) await new Promise((r) => setTimeout(r, 25));
  await new Promise((r) => setTimeout(r, 30));
  return { dom, w, d: w.document, calls, writes, fx };
}

function visibleText(d) {
  const c = d.body.cloneNode(true);
  c.querySelectorAll('script,style,svg').forEach((e) => e.remove());
  return c.textContent.replace(/\s+/g, ' ');
}
function attrText(d) {
  const out = [d.title, ...[...d.querySelectorAll('meta[name=description]')].map((m) => m.content)];
  d.querySelectorAll('*').forEach((e) => { for (const a of ['aria-label', 'title', 'alt', 'placeholder', 'value']) if (e.hasAttribute(a)) out.push(e.getAttribute(a)); });
  return out.join(' | ');
}
const exempt = (el) => el.closest('[data-slot="ca"], [data-board], [data-ticker]');

// Address scanner: address-shaped strings must match a stated registry value. The CA slot and market rows are exempt.
export function scanAddresses(d, records) {
  const stated = new Set(Object.values(records).filter((r) => r.state === 'stated').flatMap((r) => [r.value, ...(r.url ? [] : [])]).filter(Boolean));
  const bad = [];
  const check = (s, where) => { for (const m of s.match(ADDR_RE) || []) if (!stated.has(m) && !/^[a-z]+$/i.test(m)) bad.push(`${m} in ${where}`); };
  d.querySelectorAll('body *').forEach((el) => {
    if (exempt(el) || ['SCRIPT', 'STYLE'].includes(el.tagName)) return;
    for (const n of el.childNodes) if (n.nodeType === 3) check(n.textContent, el.tagName.toLowerCase());
    for (const a of el.attributes) check(a.value, `${el.tagName.toLowerCase()}[${a.name}]`);
  });
  return bad;
}

/* ----- scanner self-tests (the gate must be able to fail, and must not blanket-reject 0x) ----- */
await (async () => {
  const out = mkTmp('scan');
  const r = build(reg, out);
  const { d } = await render(out);
  const mk = (txt) => { const p = d.createElement('p'); p.textContent = txt; d.body.appendChild(p); return p; };
  gate('address scanner passes the shipped page', scanAddresses(d, reg.records).length === 0, scanAddresses(d, reg.records).join('\n'));
  const p1 = mk(`stray ${B58A}`);
  gate('address scanner flags an unregistered base58 address', scanAddresses(d, reg.records).some((s) => s.startsWith(B58A)));
  p1.remove();
  const p2 = mk(`stray ${HEXA}`);
  gate('address scanner flags an unregistered 0x address', scanAddresses(d, reg.records).some((s) => s.startsWith(HEXA)));
  const withHex = { ...reg.records, probe: { state: 'stated', value: HEXA } };
  gate('address scanner accepts a 0x address that matches a stated record (no blanket reject)', !scanAddresses(d, withHex).length);
  p2.remove();
  const ca = d.querySelector('[data-slot="ca"]');
  const p3 = d.createElement('span'); p3.textContent = B58A; ca.appendChild(p3);
  gate('address scanner exempts the CA slot', !scanAddresses(d, reg.records).length);
  rmSync(out, { recursive: true, force: true });
  if (r.status !== 0) gate('scanner build', false, r.stderr);
})();

function mkTmp(tag) { return join(mkdtempSync(join(tmpdir(), `xylo-${tag}-`)), 'out'); }

/* ======================= COPY OVERLAP ======================= */
await (async () => {
  const { d } = await render(dist);
  const text = `${visibleText(d)} . ${attrText(d).replace(/\|/g, '.')}`;
  const fx = JSON.parse(readFileSync(join(root, 'gates/fixtures/ref-hashes.json'), 'utf8'));
  const h = (s) => createHash('sha1').update(s).digest('hex').slice(0, 12);
  const g = new Set(fx.grams);
  const wd = new Set(fx.words);
  const sharedG = [...new Set(grams(text))].filter((x) => g.has(h(x)));
  const sharedW = [...new Set(words(text))].filter((x) => wd.has(h(x)));
  gate('copy shares zero 2-grams with the reference', !sharedG.length, sharedG.join(', '));
  gate(`copy shares zero content words with the reference (allowlist: ${[...ALLOW].join(', ')})`, !sharedW.length, sharedW.join(', '));
})();

/* ======================= MUTATION HARNESS ======================= */
const clone = (o) => JSON.parse(JSON.stringify(o));
const TEST = {
  ca: { value: B58A },
  x: { url: 'https://x.com/xylotest' },
  github: { url: 'https://github.com/xylotest' },
  domain: { value: 'probe.example' },
  chain: {},
  market: {},
};
const SAMPLE = {
  'series-cycles': { values: [0.3, 0.5, 0.4, 0.45, 0.2, 0.6, 0.3, 0.4, 0.5, 0.35, 0.42, 0.38], unit: '%' },
  'payout-table': { rows: [{ label: 'ROWA', move: 'MV1', std: 'ST1', wide: 'WD1' }, { label: 'ROWB', move: 'MV2', std: 'ST2', wide: 'WD2' }] },
  'compare-table': { otherName: 'OTHERCOL', rows: [{ label: 'ROWC', other: 'OT1', xylo: 'XY1' }] },
};
const INERT_KEYS = ['value', 'url', 'values', 'rows', 'rpc', 'boosts', 'pairs', 'otherName', 'unit'];

// State-independent anchors: the current record is read, then forced both ways.
function forceAbsent(rec) {
  const r = clone(rec);
  for (const k of INERT_KEYS) delete r[k];
  r.state = 'absent';
  return r;
}
function forceStated(id, rec) {
  const r = { ...clone(rec), state: 'stated' };
  const add = TEST[id] || SAMPLE[id] || { value: 'TESTVAL' };
  if (id === 'chain' || id === 'market') {
    r.rpc ||= 'https://solana-rpc.publicnode.com';
    if (id === 'market') { r.boosts ||= 'https://api.dexscreener.com/token-boosts/top/v1'; r.pairs ||= 'https://api.dexscreener.com/tokens/v1/solana/'; }
    return r;
  }
  return { ...r, ...add };
}

function allowedHrefs(records) {
  const s = new Set();
  for (const id of ['x', 'github']) if (records[id].state === 'stated') s.add(records[id].url);
  if (records.ca.state === 'stated') { s.add(`https://dexscreener.com/solana/${records.ca.value}`); s.add(`https://solscan.io/token/${records.ca.value}`); }
  return s;
}

function universal(id, st, d, records) {
  const tag = `${id}=${st}`;
  const date = findDate(`${visibleText(d)} ${attrText(d)}`);
  const hrefs = [...d.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')).filter((h) => /^https?:/.test(h));
  const ok = allowedHrefs(records);
  const extra = hrefs.filter((h) => !ok.has(h));
  const inertHref = [...d.querySelectorAll('[data-social][aria-disabled="true"], [data-explorer][aria-disabled="true"]')].filter((e) => e.hasAttribute('href') || e.querySelector('[href]'));
  const scan = scanAddresses(d, records);
  return [
    [`[${tag}] no dates anywhere in rendered DOM (text, aria-labels, titles)`, !date, date],
    [`[${tag}] every external href maps to a stated record`, !extra.length, extra.join(', ')],
    [`[${tag}] inert slots have no href`, !inertHref.length],
    [`[${tag}] address scanner clean`, !scan.length, scan.join('\n')],
    [`[${tag}] both social icons present`, !!d.querySelector('[data-social="x"]') && !!d.querySelector('[data-social="github"]')],
  ];
}

async function checkRecord(id, st, d, w, ctx, records) {
  const tag = `${id}=${st}`;
  const on = st === 'stated';
  const out = [];
  const html = d.documentElement.outerHTML;
  if (id === 'ca') {
    const slots = [...d.querySelectorAll('[data-slot="ca"]')];
    out.push([`[${tag}] CA slot present in header (top of page) and in the token section`, slots.length >= 2 && !!d.querySelector('#top [data-slot="ca"]')]);
    if (on) {
      out.push([`[${tag}] full address shown in every CA slot`, slots.every((s) => s.querySelector('[data-ca-value]').textContent === B58A)]);
      out.push([`[${tag}] copy buttons enabled`, slots.every((s) => !s.querySelector('[data-ca-copy]').disabled)]);
      const btn = slots[0].querySelector('[data-ca-copy]');
      btn.click();
      await new Promise((r) => setTimeout(r, 40));
      out.push([`[${tag}] click copies the full address and shows feedback`, ctx.writes.includes(B58A) && btn.classList.contains('is-done') && /Copied/.test(btn.textContent)]);
      const links = [...d.querySelectorAll('[data-explorer]')];
      out.push([`[${tag}] explorer links derive from the stated address`, links.length === 2 && links.every((a) => a.tagName === 'A' && a.href.includes(B58A))]);
      out.push([`[${tag}] RPC mint check ran`, /Mint found/.test(d.querySelector('[data-verify]').textContent)]);
    } else {
      out.push([`[${tag}] no address anywhere in the page`, !html.includes(B58A) && !slots.some((s) => s.dataset.address)]);
      out.push([`[${tag}] slot shows pending, button disabled`, slots.every((s) => /pending/.test(s.textContent) && s.querySelector('[data-ca-copy]').disabled)]);
      out.push([`[${tag}] explorer chips inert`, [...d.querySelectorAll('[data-explorer]')].every((e) => e.tagName === 'SPAN' && /pending/.test(e.textContent))]);
    }
  } else if (id === 'x' || id === 'github') {
    const el = d.querySelector(`[data-social="${id}"]`);
    const inHeader = !!el.closest('.top__bar');
    out.push([`[${tag}] icon sits in the top bar`, inHeader && !!el.querySelector('svg')]);
    if (on) {
      const url = records[id].url;
      out.push([`[${tag}] link href equals the stored url, handle derived`, el.tagName === 'A' && el.getAttribute('href') === url && /@xylotest/.test(el.getAttribute('aria-label')) && /noopener/.test(el.rel)]);
    } else {
      out.push([`[${tag}] inert: no href, aria-disabled, label says pending`, el.tagName !== 'A' && !el.hasAttribute('href') && el.getAttribute('aria-disabled') === 'true' && /pending/.test(el.getAttribute('aria-label'))]);
    }
  } else if (id === 'market') {
    if (on) {
      const rows = d.querySelectorAll('[data-board] [data-addr]');
      out.push([`[${tag}] top 10 rows rendered, solana only`, rows.length === 10 && ![...rows].some((r) => r.dataset.addr === fakeAddress(3))]);
      out.push([`[${tag}] sorted by 24h volume`, [...rows].map((r) => r.querySelector('[data-k="vol"] .v')._n).every((v, i, a) => !i || a[i - 1] >= v)]);
      out.push([`[${tag}] each row has price, change, volume, liquidity and a copy button`, [...rows].every((r) => ['price', 'chg', 'vol', 'liq'].every((k) => r.querySelector(`[data-k="${k}"] .v`).textContent.length > 1) && r.querySelector('[data-copy]'))]);
      out.push([`[${tag}] letter tile fallback when imageUrl is missing`, [...rows].some((r) => { const t = r.querySelector('.tile'); return !t.querySelector('img') && /^[A-Z]$/.test(t.textContent); })]);
      out.push([`[${tag}] ticker built from the same data`, d.querySelectorAll('[data-ticker] .tick[data-tk]').length >= 10 && /TK/.test(d.querySelector('[data-ticker]').textContent)]);
      out.push([`[${tag}] live pill shows`, d.querySelector('[data-feed]').dataset.feed === 'live']);
    } else {
      out.push([`[${tag}] no market request is made`, ctx.calls.filter((c) => c.includes('dexscreener')).length === 0]);
      out.push([`[${tag}] board shows dashes and a pending message`, d.querySelectorAll('[data-board] .brow').length === 10 && /pending/.test(d.querySelector('[data-board-msg]').textContent)]);
    }
  } else if (id === 'domain') {
    out.push([`[${tag}] footer chip ${on ? 'shows the domain' : 'shows pending'}`, on ? d.querySelector('[data-domain]').textContent === 'probe.example' : d.querySelector('[data-domain]').textContent === 'pending']);
  } else if (id === 'chain') {
    out.push([`[${tag}] page builds and renders`, !!d.querySelector('#hero')]);
  } else if (id === 'series-cycles') {
    const bars = d.querySelector('[data-bars]');
    out.push([`[${tag}] bars ${on ? 'filled and derived tiles set' : 'hollow, tiles pending'}`, on ? bars.dataset.state === 'stated' && d.querySelector('[data-stat-derived="best"]').dataset.state === 'stated' : bars.dataset.state === 'absent' && d.querySelector('[data-stat-derived="best"] .stat__state').textContent === 'pending']);
  } else if (id === 'payout-table' || id === 'compare-table') {
    const t = d.querySelector(`[data-table="${id}"]`);
    const marker = id === 'payout-table' ? 'ST1' : 'XY1';
    out.push([`[${tag}] table ${on ? 'shows stated rows' : 'shows dashes and no sample values'}`, on ? t.textContent.includes(marker) : !html.includes(marker) && t.querySelector('[data-row] .num').textContent === '—']);
    if (id === 'payout-table' && on) {
      d.querySelector('[data-tab="wide"]').click();
      out.push([`[${tag}] wide tab swaps the advance column`, t.textContent.includes('WD1') && !t.textContent.includes('ST1')]);
    }
  } else {
    const el = d.querySelector(`[data-stat="${id}"]`);
    out.push([`[${tag}] slot ${on ? 'shows the stated value, pending chip hidden' : 'shows dash and pending only'}`, on ? el.querySelector('[data-val]').textContent === 'TESTVAL' && el.dataset.state === 'stated' : el.querySelector('[data-val]').textContent === '—' && el.querySelector('.stat__state').textContent === 'pending' && !html.includes('TESTVAL')]);
  }
  return out;
}

const ids = Object.keys(reg.records);
for (const id of ids) {
  for (const st of ['stated', 'absent']) {
    const records = clone(reg.records);
    records[id] = st === 'stated' ? forceStated(id, reg.records[id]) : forceAbsent(reg.records[id]);
    const out = mkTmp(`${id}-${st}`);
    const r = build({ records }, out);
    if (r.status !== 0) { gate(`[${id}=${st}] variant builds`, false, r.stderr); continue; }
    const ctx = await render(out);
    const checks = [...universal(id, st, ctx.d, records), ...(await checkRecord(id, st, ctx.d, ctx.w, ctx, records))];
    for (const [n, ok, det] of checks) gate(n, ok, det);
    ctx.w.close();
    rmSync(join(out, '..'), { recursive: true, force: true });
  }
  // Rule 1 at build time: an inert record that carries a value or url must be refused.
  const bad = clone(reg.records);
  bad[id] = { ...forceAbsent(reg.records[id]), value: 'LEAK', url: 'https://leak.example' };
  const out = mkTmp(`${id}-leak`);
  const r = build({ records: bad }, out);
  gate(`[${id}] build refuses an inert record that carries a value or url`, r.status !== 0);
  rmSync(join(out, '..'), { recursive: true, force: true });
}

/* ----- CA state has zero effect on market ----- */
await (async () => {
  const snap = async (st) => {
    const records = clone(reg.records);
    records.ca = st === 'stated' ? forceStated('ca', reg.records.ca) : forceAbsent(reg.records.ca);
    records.market = forceStated('market', reg.records.market);
    const out = mkTmp(`mk-${st}`);
    build({ records }, out);
    const c = await render(out);
    const s = [...c.d.querySelectorAll('[data-board], [data-ticker], [data-feed]')].map((e) => e.outerHTML).join('');
    const n = c.calls.filter((u) => u.includes('dexscreener')).length;
    c.w.close();
    rmSync(join(out, '..'), { recursive: true, force: true });
    return { s, n };
  };
  const a = await snap('stated');
  const b = await snap('absent');
  gate('CA state has zero effect on market DOM and market requests', a.s === b.s && a.n === b.n && a.n === 2, `requests ${a.n}/${b.n}`);
})();

/* ----- market runtime behaviour ----- */
await (async () => {
  const out = mkTmp('rt');
  build(reg, out);
  let failing = false;
  const fx = marketFixtures();
  const calls = [];
  const impl = async (url) => {
    calls.push(String(url));
    if (failing) throw new Error('offline');
    return { ok: true, status: 200, json: async () => routeFixtures(String(url), fx) };
  };
  const c = await render(out, { fetchImpl: impl });
  const before = c.d.querySelector('[data-board]').innerHTML;
  failing = true;
  const n0 = calls.length;
  c.w.document.dispatchEvent(new c.w.Event('visibilitychange'));
  await new Promise((r) => setTimeout(r, 120));
  gate('visible tab triggers an immediate fetch', calls.length > n0);
  gate('failed refresh keeps the last good rows', c.d.querySelector('[data-board]').innerHTML === before && c.d.querySelector('[data-feed]').dataset.feed === 'retry');
  c.w.close();
  const c2 = await render(out, { fetchImpl: async () => { throw new Error('offline'); } });
  gate('no data ever: dashes and an error message', c2.d.querySelectorAll('[data-board] .brow').length === 10 && !c2.d.querySelector('[data-board-msg]').hidden && c2.d.querySelector('[data-feed]').dataset.feed === 'down' && c2.d.querySelector('[data-board] .cell span:last-child').textContent === '—');
  c2.w.close();
  const c3 = await render(out, { hidden: true });
  gate('hidden tab makes no market request', c3.calls.filter((u) => u.includes('dexscreener')).length === 0);
  c3.w.close();
  const js = readFileSync(join(out, 'assets/app.js'), 'utf8');
  gate('market polls every 60s with exponential backoff', /6e4/.test(js) && /\*\*/.test(js));
  const src = readFileSync(join(root, 'src/js/market.js'), 'utf8');
  gate('market module never reads the CA record', !/\bca\b/.test(src.replace(/\/\/.*$/gm, '')));
  rmSync(join(out, '..'), { recursive: true, force: true });
})();

/* ----- motion ----- */
sh('motion', () => {
  const css = readFileSync(join(dist, 'assets/app.css'), 'utf8');
  gate('prefers-reduced-motion block disables animation, transition and parallax', /prefers-reduced-motion:\s*reduce/.test(css) && /animation:\s*none/.test(css) && /transition:\s*none/.test(css));
  const js = readFileSync(join(root, 'src/js/ui.js'), 'utf8') + readFileSync(join(root, 'src/js/market.js'), 'utf8');
  gate('JS checks reduced motion for reveal, parallax and count-up', (js.match(/reducedMotion\(\)/g) || []).length >= 4);
  gate('scroll progress bar, pulsing live dot and skeletons exist', css.includes('.progress') && css.includes('pulse') && css.includes('shimmer'));
});

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length} gates, ${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);

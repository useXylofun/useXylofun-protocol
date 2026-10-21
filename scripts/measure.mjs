// Measure: serves dist/, loads it in headless Edge at five widths, checks overflow, tap targets and the CA slot.
// Market endpoints are answered from fixtures so the numbers are repeatable. Usage: node scripts/measure.mjs
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { routeFixtures } from '../gates/fixtures/market.mjs';
import { serve } from './serve.mjs';

const EDGE = process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const WIDTHS = [360, 390, 430, 1366, 1440];
const shots = join(tmpdir(), 'xylo-measure');
mkdirSync(shots, { recursive: true });

const srv = await serve('dist', 4174);
const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, userDataDir: join(tmpdir(), 'xylo-edge-profile'), args: ['--no-sandbox', '--disable-gpu', '--no-first-run', '--disable-extensions'] });
let failed = 0;

for (const width of WIDTHS) {
  const page = await browser.newPage();
  await page.setViewport({ width, height: 900, deviceScaleFactor: 1, isMobile: width < 700, hasTouch: width < 700 });
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const u = req.url();
    if (u.includes('api.dexscreener.com')) {
      req.respond({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(routeFixtures(u)) });
    } else if (/cdn\.example\.test/.test(u)) req.abort();
    else req.continue();
  });
  await page.goto('http://127.0.0.1:4174/', { waitUntil: 'load' });
  await page.waitForFunction(() => document.documentElement.dataset.marketReady === '1', { timeout: 8000 });
  const total = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < total; y += 500) { await page.evaluate((v) => scrollTo(0, v), y); await new Promise((r) => setTimeout(r, 60)); }
  await new Promise((r) => setTimeout(r, 1500));
  await page.evaluate(() => scrollTo(0, 0));

  const m = await page.evaluate(() => {
    const vw = innerWidth;
    const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const taps = [...document.querySelectorAll('a[href], button, summary, [role="tab"], input, select, [data-social]')].filter(vis).map((e) => {
      const r = e.getBoundingClientRect();
      return { el: `${e.tagName.toLowerCase()}${e.className ? '.' + String(e.className).split(' ')[0] : ''}${e.dataset.social ? `[${e.dataset.social}]` : ''}`, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, text: (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 24) };
    });
    const smallTaps = taps.filter((t) => t.w < 43.5 || t.h < 43.5);
    const over = [...document.querySelectorAll('body *')].filter((e) => {
      if (e.closest('.ticker, .hero__mesh, .layer, .hero__art')) return false;
      const r = e.getBoundingClientRect();
      return vis(e) && (r.right > vw + 1 || r.left < -1);
    }).slice(0, 8).map((e) => `${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]}`);
    const ca = document.querySelector('#top [data-slot="ca"]');
    const cr = ca.getBoundingClientRect();
    const val = ca.querySelector('[data-ca-value]');
    const h1 = document.querySelector('h1');
    return {
      vw, scrollW: document.documentElement.scrollWidth, overflowX: document.documentElement.scrollWidth > vw,
      taps: taps.length, smallTaps, over,
      caTop: Math.round(cr.top), caH: Math.round(cr.height), caFont: getComputedStyle(val).fontSize, caVisible: cr.top >= 0 && cr.bottom <= innerHeight,
      h1Font: getComputedStyle(h1).fontSize, headerH: Math.round(document.querySelector('#top').getBoundingClientRect().height),
      socialRight: (() => { const s = [...document.querySelectorAll('.top__bar [data-social]')].map((e) => e.getBoundingClientRect()); return s.length === 2 && s.every((r) => r.right <= vw && r.left > vw / 2) ? 'top-right ok' : 'misplaced'; })(),
      boardRows: document.querySelectorAll('[data-board] [data-addr]').length,
    };
  });
  await page.screenshot({ path: join(shots, `w${width}.png`) });
  const ok = !m.overflowX && !m.smallTaps.length && !m.over.length && m.caVisible && m.socialRight === 'top-right ok' && m.boardRows === 10;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${width}px  scrollWidth ${m.scrollW}  overflowX ${m.overflowX}  taps ${m.taps} (under 44: ${m.smallTaps.length})  offscreen ${m.over.length}  header ${m.headerH}px  CA ${m.caFont} visible ${m.caVisible}  h1 ${m.h1Font}  socials ${m.socialRight}  rows ${m.boardRows}`);
  if (m.smallTaps.length) console.log('      small taps:', JSON.stringify(m.smallTaps.slice(0, 6)));
  if (m.over.length) console.log('      offscreen:', m.over.join(', '));
  await page.close();
}
await browser.close();
srv.close();
console.log(`\nscreenshots: ${shots}\n${WIDTHS.length - failed}/${WIDTHS.length} breakpoints pass`);
process.exit(failed ? 1 : 0);

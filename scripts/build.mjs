// Build: src/ + register.json -> dist/. Usage: node scripts/build.mjs [--register file] [--out dir]
import { build } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const out = resolve(root, arg('out', 'dist'));
const regPath = resolve(root, arg('register', 'register.json'));

const DATE_KEY = /date|recorded|checked|asof|stamp|time/i;

// Rule 1: absent and unconfirmed records are inert, so they may not carry a value or a url.
export function checkRegister(reg) {
  const errs = [];
  for (const [id, rec] of Object.entries(reg.records)) {
    if (!['stated', 'absent', 'unconfirmed'].includes(rec.state)) errs.push(`${id}: bad state "${rec.state}"`);
    if (rec.state !== 'stated') {
      for (const k of ['value', 'url', 'values', 'rows', 'rpc', 'boosts', 'pairs']) {
        if (k in rec) errs.push(`${id}: ${rec.state} record carries "${k}"`);
      }
    }
  }
  return errs;
}

function publicRegister(reg) {
  const strip = (v) => {
    if (Array.isArray(v)) return v.map(strip);
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v).filter(([k]) => !DATE_KEY.test(k) && k !== 'source' && k !== 'scope').map(([k, x]) => [k, strip(x)]));
    }
    return v;
  };
  return { records: strip(reg.records) };
}

const reg = JSON.parse(readFileSync(regPath, 'utf8'));
const errs = checkRegister(reg);
if (errs.length) {
  console.error(`register rejected:\n  ${errs.join('\n  ')}`);
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'assets'), { recursive: true });

await build({
  entryPoints: { app: join(root, 'src/js/main.js') },
  outdir: join(out, 'assets'),
  bundle: true, minify: true, format: 'esm', target: 'es2020', legalComments: 'none', logLevel: 'error',
});
await build({
  entryPoints: { app: join(root, 'src/css/main.css') },
  outdir: join(out, 'assets'),
  bundle: true, minify: true, external: ['*.woff2'], logLevel: 'error',
});

cpSync(join(root, 'src/css/tokens.css'), join(out, 'assets/tokens.css'));
for (const f of ['logo-x-192.png', 'logo-x-384.png', 'logo-x-768.png', 'clouds-low.webp', 'clouds-high.webp', 'favicon.svg']) {
  cpSync(join(root, 'src/assets', f), join(out, 'assets', f));
}
cpSync(join(root, 'src/assets/fonts'), join(out, 'fonts'), { recursive: true });

const pub = publicRegister(reg);
const json = JSON.stringify(pub).replace(/</g, '\\u003c');
let html = readFileSync(join(root, 'src/index.html'), 'utf8');
html = html.replace('/*REGISTER*/', () => json);
writeFileSync(join(out, 'index.html'), html);

// Cloudflare Pages headers. connect-src follows the register records.
const hosts = new Set();
for (const rec of Object.values(reg.records)) {
  for (const k of ['boosts', 'pairs', 'rpc']) if (rec.state === 'stated' && rec[k]) hosts.add(new URL(rec[k]).origin);
}
const csp = [
  "default-src 'self'", "script-src 'self'", "style-src 'self'", "img-src 'self' https: data:", "font-src 'self'",
  `connect-src 'self' ${[...hosts].join(' ')}`, "frame-ancestors 'none'", "base-uri 'none'", "form-action 'none'",
].join('; ');
writeFileSync(join(out, '_headers'), `/*\n  Content-Security-Policy: ${csp}\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n/assets/*\n  Cache-Control: public, max-age=3600\n/fonts/*\n  Cache-Control: public, max-age=31536000, immutable\n`);
writeFileSync(join(out, 'robots.txt'), 'User-agent: *\nAllow: /\n');

if (!existsSync(join(out, 'index.html'))) process.exit(1);
console.log(`built ${out}`);

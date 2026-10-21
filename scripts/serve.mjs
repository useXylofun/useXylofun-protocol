// Tiny static server for local checks. Usage: node scripts/serve.mjs [dir] [port]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const dir = resolve(process.argv[2] || 'dist');
const port = Number(process.argv[3] || 4173);
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.txt': 'text/plain',
};

export function serve(root = dir, p = port) {
  const srv = createServer(async (req, res) => {
    try {
      let path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
      let file = join(root, path);
      if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
      const s = await stat(file).catch(() => null);
      if (s && s.isDirectory()) file = join(file, 'index.html');
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' }).end(body);
    } catch { res.writeHead(404).end('not found'); }
  });
  return new Promise((ok) => srv.listen(p, '127.0.0.1', () => ok(srv)));
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('serve.mjs')) {
  await serve();
  console.log(`serving ${dir} on http://127.0.0.1:${port}`);
}

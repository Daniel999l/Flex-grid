// Local dev server: static files + the same /api handlers Vercel runs.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const routes = {
  '/api/state': () => import('./api/state.js'),
  '/api/portfolio': () => import('./api/portfolio.js'),
  '/api/swap': () => import('./api/swap.js'),
  '/api/claim': () => import('./api/claim.js'),
};
const types = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json',
};
const root = process.cwd();

createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  if (path === '/health') return res.end('ok');
  if (routes[path]) return (await routes[path]()).default(req, res);
  if (/^\/(api|lib|node_modules|brand)(\/|$)|^\/\.|^\/(server\.js|package(-lock)?\.json)$/.test(path)) {
    res.statusCode = 404;
    return res.end('Not found');
  }
  try {
    let file = normalize(join(root, path));
    if (!file.startsWith(root)) throw new Error('outside root');
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    res.setHeader('content-type', types[extname(file)] || 'application/octet-stream');
    if (file.includes('/assets/')) res.setHeader('cache-control', 'public, max-age=3600');
    res.end(await readFile(file));
  } catch {
    res.statusCode = 404;
    res.end('Not found');
  }
}).listen(Number(process.env.PORT) || 3000, '0.0.0.0', () => console.log(`quiver on http://localhost:${process.env.PORT || 3000}`));

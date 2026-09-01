// Local dev server for InfluenceIQ — no Vercel account, no dependencies.
//
//   node devserver.mjs            (run from inside web/)
//
// Serves the static site AND executes the api/*.js serverless functions, so
// /api/query?q=health works exactly as it does on Vercel.
// Reads credentials from web/.env.local (or web/.env).

import { createServer } from 'node:http';
import { readFile, readFileSync, existsSync } from 'node:fs';
import { extname, join, dirname, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

/* ---------- load .env.local / .env into process.env ---------- */
for (const f of ['.env.local', '.env']) {
  const p = join(__dirname, f);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2].trim().replace(/^["']|["']$/g, '');
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
  console.log(`loaded ${f}`);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/* ---------- minimal Vercel req/res shim ---------- */
function shimRes(res) {
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(o));
    return res;
  };
  return res;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // --- API routes: /api/<name> -> ./api/<name>.js ---
  if (url.pathname.startsWith('/api/')) {
    const name = url.pathname.slice(5).replace(/[^\w-]/g, '');
    const file = join(__dirname, 'api', name + '.js');
    if (!existsSync(file)) {
      shimRes(res).status(404).json({ error: 'no such function: ' + name });
      return;
    }
    try {
      const mod = await import(pathToFileURL(file).href);
      const handler = mod.default || mod;
      req.query = Object.fromEntries(url.searchParams);
      await handler(req, shimRes(res));
    } catch (e) {
      console.error(e);
      shimRes(res).status(500).json({ error: String(e && e.message || e) });
    }
    return;
  }

  // --- static files ---
  let p = decodeURIComponent(url.pathname);
  if (p === '/' || p.endsWith('/')) p += 'index.html';
  const full = join(__dirname, normalize(p).replace(/^(\.\.[/\\])+/, ''));
  readFile(full, (err, buf) => {
    if (err) { res.statusCode = 404; res.end('404 ' + p); return; }
    res.setHeader('Content-Type', MIME[extname(full).toLowerCase()] || 'application/octet-stream');
    res.end(buf);
  });
});

server.listen(PORT, () => {
  const ok = process.env.NEO4J_QUERY_URL && process.env.NEO4J_USER && process.env.NEO4J_PASSWORD;
  console.log(`\n  InfluenceIQ dev server → http://localhost:${PORT}`);
  console.log(`  Neo4j env: ${ok ? 'configured' : 'MISSING — /api/query will return 500'}`);
  console.log(`  Health check: http://localhost:${PORT}/api/query?q=health\n`);
});

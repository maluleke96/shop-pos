/**
 * Shop POS — Railway / local web server
 * Serves the existing UI from src/ and POST /rpc → Supabase Postgres.
 *
 * Start:
 *   node server.js
 *   npm run start:web
 *
 * Env: see .env.example (SHOP_POS_DB_* or SHOP_POS_DATABASE_URL)
 */
const path = require('path');
const fs = require('fs');
const http = require('http');

const ROOT = path.join(__dirname);
process.chdir(ROOT);

const { loadProjectEnv } = require('./lib/load-env');
loadProjectEnv(ROOT);

const { bootRpc, handleRpcPost } = require('./lib/rpc-app');

const PORT = Number(process.env.PORT || process.env.SHOP_POS_PORT || 3000);
const SRC = path.join(ROOT, 'src');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.webp': 'image/webp',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8'
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Session-Token, X-Idempotency-Key',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Expose-Headers': 'X-Session-Token'
  };
}

function writeJson(res, status, obj, extraHeaders) {
  const headers = {
    ...corsHeaders(),
    'Content-Type': 'application/json',
    ...(extraHeaders || {})
  };
  res.writeHead(status, headers);
  res.end(JSON.stringify(obj));
}

function safeJoin(root, reqPath) {
  const decoded = decodeURIComponent((reqPath || '/').split('?')[0]);
  const cleaned = path.normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  const full = path.join(root, cleaned);
  if (!full.startsWith(root)) return null;
  return full;
}

function serveStatic(req, res) {
  let urlPath = (req.url || '/').split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';

  const filePath = safeJoin(SRC, urlPath);
  if (!filePath) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      // SPA-ish fallback for unknown paths → index.html (keeps deep links usable)
      const index = path.join(SRC, 'index.html');
      return fs.readFile(index, (e2, buf) => {
        if (e2) {
          res.writeHead(404);
          return res.end('Not found');
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders() });
        res.end(buf);
      });
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    const cache =
      ext === '.html' || ext === '.js'
        ? 'no-cache'
        : 'public, max-age=86400';
    fs.readFile(filePath, (e2, buf) => {
      if (e2) {
        res.writeHead(500);
        return res.end('Read error');
      }
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': cache, ...corsHeaders() });
      res.end(buf);
    });
  });
}

/**
 * Inject public-only env into src/js/env.js at boot (Railway variables).
 * Never writes DB password or service role into the frontend.
 */
function syncPublicEnvJs() {
  const url =
    process.env.SHOP_POS_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    '';
  const anon =
    process.env.SHOP_POS_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    '';
  // Same-origin /rpc on Railway — leave empty unless overridden
  const rpc =
    process.env.SHOP_POS_PUBLIC_RPC_URL ||
    process.env.SHOP_POS_RPC_URL ||
    process.env.RPC_URL ||
    '';

  if (!url && !anon) return;

  const out = `/* Auto-synced public env at server start — no secrets */
window.__SHOP_POS_ENV__ = {
  SUPABASE_URL: ${JSON.stringify(url)},
  SUPABASE_ANON_KEY: ${JSON.stringify(anon)},
  SHOP_POS_SUPABASE_URL: ${JSON.stringify(url)},
  SHOP_POS_SUPABASE_ANON_KEY: ${JSON.stringify(anon)},
  RPC_URL: ${JSON.stringify(rpc)},
  SHOP_POS_RPC_URL: ${JSON.stringify(rpc)}
};
window.__SHOP_POS_USE_SUPABASE__ = true;
`;
  try {
    fs.writeFileSync(path.join(SRC, 'js', 'env.js'), out, 'utf8');
    console.log('[env] synced public src/js/env.js');
  } catch (e) {
    console.warn('[env] could not write env.js:', e.message);
  }
}

async function main() {
  syncPublicEnvJs();

  console.log('Connecting to Supabase Postgres…');
  const rpc = await bootRpc();
  console.log(`RPC ready — ${Object.keys(rpc.handlers).length} handlers`);

  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders());
      return res.end();
    }

    const urlPath = (req.url || '/').split('?')[0];

    if (urlPath === '/health') {
      return writeJson(res, 200, {
        ok: true,
        service: 'shop-pos-railway',
        backend: 'supabase-postgres',
        handlers: Object.keys(rpc.handlers).length
      });
    }

    if (urlPath === '/rpc') {
      if (req.method === 'GET') {
        return writeJson(res, 200, {
          ok: true,
          service: 'shop-pos-rpc',
          backend: 'supabase-postgres',
          handlers: Object.keys(rpc.handlers).length
        });
      }
      if (req.method !== 'POST') {
        return writeJson(res, 405, { success: false, error: 'Method Not Allowed' });
      }

      const chunks = [];
      for await (const c of req) chunks.push(c);
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      } catch {
        return writeJson(res, 400, { success: false, error: 'Invalid JSON' });
      }

      const idem = req.headers['x-idempotency-key'];
      if (idem && !body.clientRequestId) body.clientRequestId = String(idem);

      const result = await handleRpcPost({
        handlers: rpc.handlers,
        session: rpc.session,
        persistNow: rpc.persistNow,
        sessions: rpc.sessions,
        body,
        sessionTokenHeader: req.headers['x-session-token'] || ''
      });
      return writeJson(res, result.status, result.json, result.headers);
    }

    // Static UI
    serveStatic(req, res);
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log(`Shop POS online → http://0.0.0.0:${PORT}`);
    console.log(`  UI:     http://localhost:${PORT}/`);
    console.log(`  RPC:    http://localhost:${PORT}/rpc`);
    console.log(`  Health: http://localhost:${PORT}/health`);
    console.log('');
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

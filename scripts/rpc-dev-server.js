/**
 * Local full RPC server (same handlers as Netlify) for Electron/Android/dev testing.
 * Usage:
 *   $env:SHOP_POS_DATABASE_URL="postgresql://..."
 *   node scripts/rpc-dev-server.js
 * Listens on http://127.0.0.1:8787/rpc
 */
const http = require('http');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);
process.env.SHOP_POS_CLOUD = '1';

const PORT = Number(process.env.RPC_PORT || 8787);
const sessions = new Map();

function token() {
  return crypto.randomBytes(24).toString('hex');
}

async function main() {
  const { hasDatabaseConfig, missingDatabaseConfigMessage } = require('../electron/database/pg-connection');
  if (!hasDatabaseConfig()) {
    console.error(missingDatabaseConfigMessage());
    process.exit(1);
  }

  const { initDatabase, persistNow } = require('../electron/database/db');
  const session = require('../electron/services/session');
  console.log('Connecting to Supabase Postgres…');
  await initDatabase();
  const store = require('../electron/services/store');
  const { buildHandlers } = require('../mobile/handlers');
  const handlers = buildHandlers(store);
  console.log(`Handlers loaded: ${Object.keys(handlers).length}`);

  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Session-Token');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Expose-Headers', 'X-Session-Token');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    if (req.url === '/health' || (req.url === '/rpc' && req.method === 'GET')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        ok: true,
        service: 'shop-pos-rpc-dev',
        handlers: Object.keys(handlers).length
      }));
    }

    if (req.url !== '/rpc' || req.method !== 'POST') {
      res.writeHead(404);
      return res.end('Not found');
    }

    const chunks = [];
    for await (const c of req) chunks.push(c);
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'Invalid JSON' }));
    }

    const method = String(body.method || body.channel || '').trim();
    const args = Array.isArray(body.args) ? body.args : [];
    const key = method.replace(/[:.]/g, '_');
    const fn = handlers[key];
    if (!fn) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: `Unknown method: ${method}` }));
    }

    const tok = req.headers['x-session-token'] || '';
    const incoming = tok && sessions.has(tok)
      ? { token: tok, ...sessions.get(tok) }
      : { token: tok || null, userSession: null, employeeSession: null };

    try {
      const result = await session.runWithContext({
        userSession: incoming.userSession || null,
        employeeSession: incoming.employeeSession || null
      }, async () => {
        const out = await fn(...args);
        return { out, snap: session.snapshotContext() };
      });

      let sessionToken = incoming.token;
      const headers = { 'Content-Type': 'application/json' };
      if (result.snap.userSession || result.snap.employeeSession) {
        if (!sessionToken || !sessions.has(sessionToken)) sessionToken = token();
        sessions.set(sessionToken, result.snap);
        headers['X-Session-Token'] = sessionToken;
      } else if (sessionToken) {
        sessions.delete(sessionToken);
        sessionToken = null;
      }

      try { persistNow(); } catch (_) {}

      let payload = result.out;
      if (payload && typeof payload === 'object' && Object.prototype.hasOwnProperty.call(payload, 'success')) {
        if (sessionToken) payload = { ...payload, sessionToken };
        res.writeHead(200, headers);
        return res.end(JSON.stringify(payload));
      }
      res.writeHead(200, headers);
      res.end(JSON.stringify({ success: true, data: payload, sessionToken: sessionToken || undefined }));
    } catch (err) {
      console.error('[rpc]', method, err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message || String(err) }));
    }
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`\nShop POS RPC (full handlers) → http://127.0.0.1:${PORT}/rpc`);
    console.log('Point clients at this URL via SHOP_POS_RPC_URL / window.__SHOP_POS_ENV__.RPC_URL\n');
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

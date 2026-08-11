/**
 * Shared Shop POS RPC core — used by Railway Express server and local rpc:dev.
 * Handlers → store → Supabase Postgres (via electron/database pg adapter).
 */
const crypto = require('crypto');

function makeToken() {
  return crypto.randomBytes(24).toString('hex');
}

/**
 * @returns {Promise<{ handlers: Record<string, Function>, session: any, persistNow: Function, sessions: Map }>}
 */
async function bootRpc() {
  process.env.SHOP_POS_CLOUD = '1';
  const { hasDatabaseConfig, missingDatabaseConfigMessage } = require('../electron/database/pg-connection');
  if (!hasDatabaseConfig()) {
    throw new Error(missingDatabaseConfigMessage());
  }
  const { initDatabase, persistNow } = require('../electron/database/db');
  await initDatabase();
  const session = require('../electron/services/session');
  const store = require('../electron/services/store');
  const { buildHandlers } = require('../mobile/handlers');
  const handlers = buildHandlers(store);

  // Idempotency store for offline replay (sales + other writes)
  try {
    const { getDb } = require('../electron/database/db');
    getDb().exec(`
      CREATE TABLE IF NOT EXISTS rpc_idempotency (
        request_id TEXT PRIMARY KEY,
        method TEXT NOT NULL,
        response_json TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
  } catch (e) {
    console.warn('[rpc] idempotency table setup:', e.message);
  }

  return { handlers, session, persistNow, sessions: new Map() };
}

function resolveHandler(handlers, method) {
  const key = String(method || '')
    .trim()
    .replace(/[:.]/g, '_');
  return { key, fn: handlers[key] };
}

async function handleRpcPost({ handlers, session, persistNow, sessions, body, sessionTokenHeader }) {
  const method = String(body.method || body.channel || '').trim();
  const args = Array.isArray(body.args) ? body.args : [];
  const clientRequestId = String(
    body.clientRequestId || body.client_request_id || body.idempotencyKey || ''
  ).trim();

  if (!method) {
    return { status: 400, json: { success: false, error: 'method required' } };
  }

  const { key, fn } = resolveHandler(handlers, method);
  if (typeof fn !== 'function') {
    return { status: 404, json: { success: false, error: `Unknown method: ${method}` } };
  }

  // Duplicate offline replay → return cached success response
  if (clientRequestId) {
    try {
      const { getDb } = require('../electron/database/db');
      const row = getDb()
        .prepare('SELECT response_json FROM rpc_idempotency WHERE request_id = ?')
        .get(clientRequestId);
      if (row && row.response_json) {
        const cached = JSON.parse(row.response_json);
        return { status: 200, json: cached, headers: {} };
      }
    } catch (_) {
      /* continue */
    }
  }

  // Inject clientRequestId into sale payload when present
  if (clientRequestId && key === 'sales_complete' && args[0] && typeof args[0] === 'object') {
    args[0] = { ...args[0], client_request_id: clientRequestId };
  }

  const tok = sessionTokenHeader || '';
  const incoming =
    tok && sessions.has(tok)
      ? { token: tok, ...sessions.get(tok) }
      : { token: tok || null, userSession: null, employeeSession: null };

  try {
    const result = await session.runWithContext(
      {
        userSession: incoming.userSession || null,
        employeeSession: incoming.employeeSession || null
      },
      async () => {
        const out = await fn(...args);
        return { out, snap: session.snapshotContext() };
      }
    );

    let sessionToken = incoming.token;
    const headers = {};
    if (result.snap.userSession || result.snap.employeeSession) {
      if (!sessionToken || !sessions.has(sessionToken)) sessionToken = makeToken();
      sessions.set(sessionToken, result.snap);
      headers['X-Session-Token'] = sessionToken;
    } else if (sessionToken) {
      sessions.delete(sessionToken);
      sessionToken = null;
    }

    try {
      persistNow();
    } catch (_) {}

    let payload = result.out;
    if (payload && typeof payload === 'object' && Object.prototype.hasOwnProperty.call(payload, 'success')) {
      if (sessionToken) payload = { ...payload, sessionToken };
    } else {
      payload = { success: true, data: payload, sessionToken: sessionToken || undefined };
    }

    if (clientRequestId && payload && payload.success !== false) {
      try {
        const { getDb } = require('../electron/database/db');
        getDb()
          .prepare(
            `INSERT INTO rpc_idempotency (request_id, method, response_json)
             VALUES (?, ?, ?)
             ON CONFLICT (request_id) DO NOTHING`
          )
          .run(clientRequestId, key, JSON.stringify(payload));
      } catch (_) {
        /* best-effort */
      }
    }

    return { status: 200, json: payload, headers };
  } catch (err) {
    console.error('[rpc]', method, err);
    return {
      status: 500,
      json: { success: false, error: err.message || String(err) },
      headers: {}
    };
  }
}

module.exports = { bootRpc, handleRpcPost, makeToken };

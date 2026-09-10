/**
 * Shared Shop POS RPC core — used by Railway Express server and local rpc:dev.
 * Handlers → store → Postgres (Railway Postgres or Supabase via DATABASE_URL).
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
  try {
    require('../electron/services/delivery-platform').ensureSchema();
  } catch (e) {
    console.warn('[rpc] delivery schema bootstrap:', e.message || e);
  }
  try {
    require('../electron/services/notification-acks').ensureSchema();
  } catch (e) {
    console.warn('[rpc] notification-acks schema bootstrap:', e.message || e);
  }
  try {
    require('../electron/services/expense-app-platform').ensureSchema();
  } catch (e) {
    console.warn('[rpc] expense-app schema bootstrap:', e.message || e);
  }
  try {
    const branchesSvc = require('../electron/services/branches');
    branchesSvc.ensureBranchSchema();
    branchesSvc.ensureDefaultBranch();
  } catch (e) {
    console.warn('[rpc] branch bootstrap:', e.message || e);
  }
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

function rpcReplacer(_key, value) {
  if (value == null || typeof value !== 'object') return value;
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
    return { __shoppos_b64: value.toString('base64') };
  }
  if (value instanceof Uint8Array) {
    return { __shoppos_b64: Buffer.from(value).toString('base64') };
  }
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    return { __shoppos_b64: Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('base64') };
  }
  return value;
}

function encodeRpcPayload(payload) {
  try {
    return JSON.parse(JSON.stringify(payload, rpcReplacer));
  } catch (_) {
    return payload;
  }
}

const RECOVERY_METHODS = new Set([
  'auth:hasRecovery', 'auth:getRecoveryStatus', 'auth:recoverVerify', 'auth:recoverReset', 'auth:setRecoverySecret'
]);

function friendlyDbError(err) {
  const msg = String((err && err.message) || err || '');
  const code = String((err && err.code) || '');
  if (
    /tenant\/user .+ not found/i.test(msg) ||
    (code === 'ENOTFOUND' && /getaddrinfo|supabase|pooler|db\./i.test(msg)) ||
    /\(ENOTFOUND\)/i.test(msg)
  ) {
    return (
      'Database unreachable (ENOTFOUND). Your Supabase project may be paused or deleted. ' +
      'Open https://supabase.com/dashboard → restore/unpause the project (or create a new one), ' +
      'then update SHOP_POS_DATABASE_URL to the Session pooler URI and restart the server.'
    );
  }
  if (/ECONNREFUSED|ETIMEDOUT|ECONNRESET/i.test(code) || /ECONNREFUSED|ETIMEDOUT|ECONNRESET/i.test(msg)) {
    return (
      'Cannot connect to the database. Check SHOP_POS_DATABASE_URL (use the Supabase Session pooler) and that the project is running.'
    );
  }
  return msg || 'Database error';
}

async function handleRpcPost({ handlers, session, persistNow, sessions, body, sessionTokenHeader }) {
  const method = String(body.method || body.channel || '').trim();
  const args = Array.isArray(body.args) ? body.args : [];
  const clientRequestId = String(
    body.clientRequestId || body.client_request_id || body.idempotencyKey || ''
  ).trim();
  const t0 = Date.now();
  let pgCountBefore = 0;
  try {
    const pgDb = require('../electron/database/pg-db');
    if (pgDb.isPgMode?.() && pgDb.getQueryStats) pgCountBefore = pgDb.getQueryStats().count || 0;
  } catch (_) {}

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

    let payload = encodeRpcPayload(result.out);
    if (payload && typeof payload === 'object' && Object.prototype.hasOwnProperty.call(payload, 'success')) {
      if (payload.success === false && payload.error) {
        payload = { ...payload, error: friendlyDbError({ message: payload.error }) };
      }
      if (sessionToken) payload = { ...payload, sessionToken };
    } else {
      payload = { success: true, data: payload, sessionToken: sessionToken || undefined };
    }

    const ms = Date.now() - t0;
    headers['X-RPC-Time-Ms'] = String(ms);
    let dbQueries = null;
    try {
      const pgDb = require('../electron/database/pg-db');
      if (pgDb.isPgMode?.() && pgDb.getQueryStats) {
        dbQueries = Math.max(0, (pgDb.getQueryStats().count || 0) - pgCountBefore);
        headers['X-DB-Queries'] = String(dbQueries);
      }
    } catch (_) {}
    if (ms >= 400 || process.env.SHOP_POS_PERF === '1') {
      console.log(`[rpc-perf] ${method} ${ms}ms dbQueries=${dbQueries ?? '?'}`);
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
    if (RECOVERY_METHODS.has(method)) {
      console.error('[rpc]', method, err && err.message ? err.message : 'error');
    } else {
      console.error('[rpc]', method, err);
    }
    const ms = Date.now() - t0;
    return {
      status: 500,
      json: { success: false, error: friendlyDbError(err), rpcMs: ms },
      headers: { 'X-RPC-Time-Ms': String(ms) }
    };
  }
}

module.exports = { bootRpc, handleRpcPost, makeToken };

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
    const saasSync = require('../electron/services/saas-customer-sync');
    const boot = saasSync.applyFromEnvIfConfigured();
    if (boot && !boot.skipped) console.log('[saas] entitlement env bootstrap:', boot.shop_key, boot.package_id);
  } catch (e) {
    console.warn('[saas] entitlement env bootstrap:', e.message || e);
  }
  try {
    const { getDb } = require('../electron/database/db');
    const db = getDb();
    // Free space from safe ephemeral tables when the Postgres volume is nearly full.
    for (const sql of [
      `DELETE FROM rpc_idempotency WHERE created_at < (NOW() - INTERVAL '3 days')::text`,
      `DELETE FROM web_customer_sessions WHERE expires_at < NOW()::text`
    ]) {
      try { db.prepare(sql).run(); } catch (_) { /* dialect / missing table */ }
    }
    try { db.exec('VACUUM'); } catch (e) { console.warn('[rpc] vacuum:', e.message || e); }
  } catch (e) {
    console.warn('[rpc] disk hygiene:', e.message || e);
  }
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
    require('../electron/services/studio-app-platform').ensureSchema();
  } catch (e) {
    console.warn('[rpc] studio-app schema bootstrap:', e.message || e);
  }
  try {
    require('../electron/services/radio-platform').ensureSchema();
  } catch (e) {
    console.warn('[rpc] radio schema bootstrap:', e.message || e);
  }
  try {
    require('../electron/services/first-online-gift').ensureFirstOnlineGiftSchema();
  } catch (e) {
    console.warn('[rpc] first-online-gift schema bootstrap:', e.message || e);
  }
  try {
    require('../electron/services/taken-orders').ensureSchema();
  } catch (e) {
    console.warn('[rpc] taken-orders schema:', e.message || e);
  }
  try {
    require('../electron/services/mgr-hr-portal').ensureSchema();
  } catch (e) {
    console.warn('[rpc] mgr-hr-portal schema bootstrap:', e.message || e);
  }
  try {
    const ref = require('../electron/services/referral-commission');
    ref.ensureSchema();
    try { ref.syncApprovedAgentLogins(); } catch (e) { console.warn('[rpc] referral login sync:', e.message || e); }
    const repair = String(process.env.REFERRAL_REPAIR_AGENT || '').trim();
    if (repair) {
      console.log('[rpc] REFERRAL_REPAIR_AGENT configured: yes');
      try {
        const { getDb } = require('../electron/database/db');
        const rows = getDb().prepare(
          `SELECT id, username, status, CASE WHEN password_hash IS NULL OR TRIM(password_hash)='' THEN 0 ELSE 1 END AS has_pw FROM referral_agents ORDER BY id LIMIT 20`
        ).all();
        console.log('[rpc] referral_agents snapshot:', JSON.stringify(rows.map((r) => ({
          id: r.id, username: r.username, status: r.status, has_pw: !!r.has_pw
        }))));
      } catch (snapErr) {
        console.warn('[rpc] referral_agents snapshot failed:', snapErr.message || snapErr);
      }
    }
    if (repair.includes(':')) {
      const idx = repair.indexOf(':');
      const u = repair.slice(0, idx).trim();
      const rest = repair.slice(idx + 1);
      const renameMatch = rest.match(/^(.*)\|rename=(.+)$/i);
      const p = (renameMatch ? renameMatch[1] : rest).trim();
      const renameTo = renameMatch ? String(renameMatch[2] || '').trim() : '';
      if (u && p.length >= 6) {
        try {
          const bcrypt = require('bcryptjs');
          const { getDb } = require('../electron/database/db');
          const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
          const agent = getDb().prepare(
            `SELECT * FROM referral_agents
             WHERE LOWER(COALESCE(username,''))=LOWER(?)
                OR LOWER(COALESCE(email,''))=LOWER(?)
             LIMIT 1`
          ).get(u, u);
          if (!agent) {
            console.warn('[rpc] REFERRAL_REPAIR_AGENT user not found:', u);
          } else {
            const hash = bcrypt.hashSync(p, 10);
            if (renameTo && renameTo.toLowerCase() !== String(agent.username || '').toLowerCase()) {
              const taken = getDb().prepare(
                `SELECT id FROM users WHERE LOWER(username)=LOWER(?) AND id!=COALESCE(?,0)
                 UNION ALL
                 SELECT id FROM referral_agents WHERE LOWER(username)=LOWER(?) AND id!=?`
              ).get(renameTo, agent.user_id || 0, renameTo, agent.id);
              if (taken) {
                console.warn('[rpc] REFERRAL_REPAIR rename target taken:', renameTo);
              } else {
                getDb().prepare(`UPDATE referral_agents SET username=?, password_hash=?, updated_at=? WHERE id=?`)
                  .run(renameTo, hash, stamp, agent.id);
                if (agent.user_id) {
                  getDb().prepare(`UPDATE users SET username=?, password_hash=?, role='referral_agent', is_active=1, pin=NULL WHERE id=?`)
                    .run(renameTo, hash, agent.user_id);
                }
                const refreshed = getDb().prepare('SELECT * FROM referral_agents WHERE id=?').get(agent.id);
                ref.ensureAgentUserAccount({ ...refreshed, password_hash: hash });
                console.log('[rpc] referral agent renamed+repaired', u, '->', renameTo, 'id=', agent.id);
              }
            } else {
              getDb().prepare(`UPDATE referral_agents SET password_hash=?, updated_at=? WHERE id=?`)
                .run(hash, stamp, agent.id);
              const refreshed = getDb().prepare('SELECT * FROM referral_agents WHERE id=?').get(agent.id);
              // Ensure approved so loginApprovedAgent accepts them
              const st = String(refreshed.status || '').toUpperCase();
              if (!['APPROVED', 'ACTIVE'].includes(st)) {
                getDb().prepare(`UPDATE referral_agents SET status='APPROVED', approved_at=COALESCE(approved_at,?), updated_at=? WHERE id=?`)
                  .run(stamp, stamp, agent.id);
              }
              const again = getDb().prepare('SELECT * FROM referral_agents WHERE id=?').get(agent.id);
              ref.ensureAgentUserAccount({ ...again, password_hash: hash });
              console.log('[rpc] referral agent login repaired for', again.username, 'id=', again.id, 'status=', again.status);
            }
          }
        } catch (repairErr) {
          console.error('[rpc] REFERRAL_REPAIR_AGENT failed:', repairErr.message || repairErr);
        }
      }
    }
  } catch (e) {
    console.warn('[rpc] referral-commission schema bootstrap:', e.message || e);
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
  if (value instanceof ArrayBuffer) {
    return { __shoppos_b64: Buffer.from(value).toString('base64') };
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

  // Phase 4: entitlement enforcement (lab only when ENTITLEMENTS_ENFORCE=1)
  try {
    const entitlements = require('../electron/services/entitlements');
    const gate = entitlements.assertRpcAllowed(method);
    if (gate && gate.allowed === false) {
      const err = gate.error || {};
      return {
        status: err.status || 403,
        json: {
          success: false,
          error: err.message || 'FEATURE_NOT_INCLUDED',
          code: err.code || 'FEATURE_NOT_INCLUDED',
          module_id: err.module_id || null
        },
        headers: { 'X-Entitlement': 'denied' }
      };
    }
  } catch (_) { /* fail-open only when enforcement module missing */ }

  // Phase 5+: access gate — block customer RPCs when shop is suspended/expired
  try {
    const ns = String(method || '').split(':')[0];
    const allowNs = new Set(['platform', 'entitlements', 'saas', 'activation', 'license']);
    if (!allowNs.has(ns)) {
      const shops = require('../electron/services/platform-shops');
      shops.assertShopNotSuspended();
    }
  } catch (err) {
    if (err && (err.code === 'SHOP_SUSPENDED' || err.code === 'SHOP_EXPIRED')) {
      const access = err.access || {};
      const msg = access.message || {};
      return {
        status: err.status || 403,
        json: {
          success: false,
          error: err.message || 'SHOP_SUSPENDED',
          code: err.code || 'SHOP_SUSPENDED',
          access_state: access.access_state || err.code,
          message: (() => {
            const bodyText = msg.body || msg.body_text
              || 'Your shop access has been temporarily suspended.\n\nPlease contact your administrator for assistance.';
            return {
              title: msg.title || 'Service Temporarily Unavailable',
              body: bodyText,
              body_text: bodyText,
              contact_label: msg.contact_label || 'Contact Administrator'
            };
          })(),
          contact_admin_url: access.contact_admin_url || ''
        },
        headers: { 'X-Shop-Status': String(access.access_state || 'suspended').toLowerCase() }
      };
    }
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

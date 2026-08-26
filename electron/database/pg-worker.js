/**
 * Worker thread: runs pg queries for the sync sql.js-compatible adapter.
 * Writes result JSON to resultPath then notifies waitSab so the main thread can read it.
 */
const { parentPort, workerData } = require('worker_threads');
const { Pool, types } = require('pg');
const fs = require('fs');

// node-pg returns int8/bigint as strings by default. That breaks `n + 1` into string
// concat (e.g. "35"+1 → "351") and corrupts receipt/order counters past bigint range.
types.setTypeParser(types.builtins.INT8, (val) => {
  if (val == null) return null;
  const n = Number(val);
  if (!Number.isFinite(n)) return val;
  if (Math.abs(n) > Number.MAX_SAFE_INTEGER) return val;
  return n;
});

const pool = new Pool({
  connectionString: workerData.connectionString,
  ssl: workerData.sslDisable ? false : { rejectUnauthorized: false },
  max: 4,
  idleTimeoutMillis: 30000
});

let txClient = null;

function toPgParams(sql) {
  let i = 0;
  let out = '';
  let inSingle = false;
  let inDouble = false;
  for (let c = 0; c < sql.length; c++) {
    const ch = sql[c];
    if (ch === "'" && !inDouble) {
      if (inSingle && sql[c + 1] === "'") {
        out += "''";
        c++;
        continue;
      }
      inSingle = !inSingle;
      out += ch;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      out += ch;
      continue;
    }
    if (ch === '?' && !inSingle && !inDouble) {
      i += 1;
      out += `$${i}`;
      continue;
    }
    out += ch;
  }
  return out;
}

function runner() {
  return txClient || pool;
}

async function handle(method, payload) {
  switch (method) {
    case 'ping': {
      await pool.query('SELECT 1 AS ok');
      return { ok: true };
    }
    case 'begin': {
      if (txClient) throw new Error('Nested transaction not supported');
      txClient = await pool.connect();
      await txClient.query('BEGIN');
      return { ok: true };
    }
    case 'commit': {
      if (!txClient) return { ok: true };
      await txClient.query('COMMIT');
      txClient.release();
      txClient = null;
      return { ok: true };
    }
    case 'rollback': {
      if (!txClient) return { ok: true };
      try {
        await txClient.query('ROLLBACK');
      } finally {
        txClient.release();
        txClient = null;
      }
      return { ok: true };
    }
    case 'savepoint': {
      if (!txClient) throw new Error('SAVEPOINT requires an open transaction');
      const name = String(payload.name || 'sp').replace(/[^a-zA-Z0-9_]/g, '');
      await txClient.query(`SAVEPOINT ${name}`);
      return { ok: true };
    }
    case 'release': {
      if (!txClient) return { ok: true };
      const name = String(payload.name || 'sp').replace(/[^a-zA-Z0-9_]/g, '');
      await txClient.query(`RELEASE SAVEPOINT ${name}`);
      return { ok: true };
    }
    case 'rollback_to': {
      if (!txClient) return { ok: true };
      const name = String(payload.name || 'sp').replace(/[^a-zA-Z0-9_]/g, '');
      await txClient.query(`ROLLBACK TO SAVEPOINT ${name}`);
      return { ok: true };
    }
    case 'exec': {
      await runner().query(toPgParams(payload.sql));
      return { ok: true };
    }
    case 'get': {
      const res = await runner().query(toPgParams(payload.sql), payload.params || []);
      return res.rows[0];
    }
    case 'all': {
      const res = await runner().query(toPgParams(payload.sql), payload.params || []);
      return res.rows;
    }
    case 'run': {
      let sql = payload.sql;
      const params = payload.params || [];
      const isInsert = /^\s*INSERT\b/i.test(sql) && !/\bRETURNING\b/i.test(sql);
      if (isInsert) sql = `${sql} RETURNING *`;
      try {
        const res = await runner().query(toPgParams(sql), params);
        const row = res.rows?.[0] || {};
        return { lastInsertRowid: row.id != null ? row.id : 0, changes: res.rowCount || 0 };
      } catch (err) {
        // Never retry inside an open transaction — Postgres aborts the txn on first error,
        // and a retry only masks the real message as "current transaction is aborted".
        if (isInsert && !txClient) {
          try {
            const res2 = await runner().query(toPgParams(payload.sql), params);
            return { lastInsertRowid: 0, changes: res2.rowCount || 0 };
          } catch (_) {
            throw err;
          }
        }
        throw err;
      }
    }
    case 'batch': {
      // One worker wake / one result file for N statements (huge win for dashboards).
      const queries = Array.isArray(payload.queries) ? payload.queries : [];
      const out = [];
      for (const q of queries) {
        const m = q.method || 'all';
        out.push(await handle(m, { sql: q.sql, params: q.params || [] }));
      }
      return out;
    }
    default:
      throw new Error(`Unknown worker method: ${method}`);
  }
}

parentPort.on('message', async (msg) => {
  const { id, method, payload, waitSab, resultPath } = msg;
  try {
    const result = await handle(method, payload || {});
    if (resultPath) {
      fs.writeFileSync(resultPath, JSON.stringify({ ok: true, result }));
    }
    parentPort.postMessage({ id, result });
  } catch (err) {
    if (resultPath) {
      try {
        fs.writeFileSync(resultPath, JSON.stringify({ ok: false, error: err.message || String(err) }));
      } catch (_) {}
    }
    parentPort.postMessage({ id, error: err.message || String(err) });
  } finally {
    if (waitSab) {
      const ia = new Int32Array(waitSab);
      Atomics.store(ia, 0, 1);
      Atomics.notify(ia, 0);
    }
  }
});

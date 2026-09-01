/**
 * Postgres adapter mimicking sql.js API used by Shop POS store services.
 * Sync prepare/get/all/run via worker_threads + Atomics.wait + temp result files.
 */
const { Worker } = require('worker_threads');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { databaseUrl, hasDatabaseConfig, missingDatabaseConfigMessage } = require('./pg-connection');

let worker = null;
let nextId = 1;
let db = null;
let inTxn = false;
let txnUseSavepoints = true;
let savepointSeq = 0;
let queryStats = { count: 0, totalMs: 0, lastSlow: null, recent: [] };

function isPgMode() {
  return hasDatabaseConfig();
}

function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(path.join(__dirname, 'pg-worker.js'), {
    workerData: {
      connectionString: databaseUrl(),
      sslDisable: process.env.PGSSLMODE === 'disable'
    }
  });
  worker.on('error', (err) => console.error('[pg-worker]', err));
  return worker;
}

function callWorkerSync(method, payload) {
  ensureWorker();
  const id = nextId++;
  const waitSab = new SharedArrayBuffer(4);
  const waitIa = new Int32Array(waitSab);
  Atomics.store(waitIa, 0, 0);
  const resultPath = path.join(os.tmpdir(), `shoppos-pg-${process.pid}-${id}.json`);
  const t0 = Date.now();

  worker.postMessage({ id, method, payload, waitSab, resultPath });

  const deadline = Date.now() + 120000;
  while (Atomics.load(waitIa, 0) === 0) {
    const left = deadline - Date.now();
    if (left <= 0) throw new Error('Postgres query timed out (120s)');
    Atomics.wait(waitIa, 0, 0, Math.min(1000, left));
  }

  if (!fs.existsSync(resultPath)) throw new Error('Postgres worker produced no result file');
  const parsed = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  try { fs.unlinkSync(resultPath); } catch (_) {}
  const ms = Date.now() - t0;
  queryStats.count += 1;
  queryStats.totalMs += ms;
  if (queryStats.recent) {
    const sqlPreview = payload?.sql
      ? String(payload.sql).replace(/\s+/g, ' ').slice(0, 120)
      : method;
    queryStats.recent.push({ method, ms, sql: sqlPreview });
    if (queryStats.recent.length > 200) queryStats.recent.shift();
  }
  if (ms >= 250) {
    queryStats.lastSlow = { method, ms, at: new Date().toISOString() };
    if (process.env.SHOP_POS_PERF === '1') {
      console.warn('[pg-slow]', method, ms + 'ms');
    }
  }
  if (!parsed.ok) throw new Error(parsed.error || 'Postgres error');
  return parsed.result;
}

/** Inside a transaction, optionally wrap each statement in a SAVEPOINT so try/catch in store.js works on Postgres.
 *  Sale/checkout should use transaction(fn, { savepoints: false }) — savepoints triple round-trips. */
function callQuery(method, payload) {
  if (!inTxn || !txnUseSavepoints || method === 'begin' || method === 'commit' || method === 'rollback') {
    return callWorkerSync(method, payload);
  }
  const sp = 'sp_' + (++savepointSeq);
  callWorkerSync('savepoint', { name: sp });
  try {
    const result = callWorkerSync(method, payload);
    try {
      callWorkerSync('release', { name: sp });
    } catch (_) {}
    return result;
  } catch (err) {
    try {
      callWorkerSync('rollback_to', { name: sp });
    } catch (_) {}
    throw err;
  }
}

function rewriteSqliteSql(sql) {
  let s = String(sql || '');
  if (/^\s*PRAGMA\b/i.test(s)) return 'SELECT 1 AS ok';

  // Shared SQLite → Postgres date/time helpers (order matters: multi-arg / nested before single-arg).
  const rewriteDates = (input) =>
    input
      // printf('%.2f', expr) → to_char / round text (SQLite-only)
      .replace(/printf\s*\(\s*'%\.(\d+)f'\s*,\s*([^)]+?)\s*\)/gi, (_, d, expr) =>
        `to_char(ROUND(($expr)::numeric, ${Number(d)}), 'FM999999999990.${'0'.repeat(Number(d))}')`.replace('$expr', expr)
      )
      // GROUP_CONCAT(DISTINCT expr) / GROUP_CONCAT(DISTINCT expr, sep)
      .replace(
        /GROUP_CONCAT\s*\(\s*DISTINCT\s+([^,)]+?)\s*(?:,\s*('[^']*'|"[^"]*"))?\s*\)/gi,
        (_, expr, sep) => `string_agg(DISTINCT ($expr)::text, ${sep || "','"})`.replace('$expr', expr)
      )
      // GROUP_CONCAT(expr, sep) / GROUP_CONCAT(expr)
      .replace(
        /GROUP_CONCAT\s*\(\s*([^,)]+?)\s*(?:,\s*('[^']*'|"[^"]*"))?\s*\)/gi,
        (_, expr, sep) => `string_agg(($expr)::text, ${sep || "','"})`.replace('$expr', expr)
      )
      // date('now', 'localtime', '-30 days')
      .replace(
        /date\s*\(\s*'now'\s*,\s*'localtime'\s*,\s*'([+-]?\d+)\s+days?'\s*\)/gi,
        (_, n) => `(CURRENT_DATE + INTERVAL '${Number(n)} days')`
      )
      // date('now', '-30 days') / date('now', '+7 day')
      .replace(
        /date\s*\(\s*'now'\s*,\s*'([+-]?\d+)\s+days?'\s*\)/gi,
        (_, n) => `(CURRENT_DATE + INTERVAL '${Number(n)} days')`
      )
      // date('now', '-' || ? || ' days') / date('now', '+' || ? || ' days') — bound day counts
      .replace(
        /date\s*\(\s*'now'\s*,\s*'-'\s*\|\|\s*\?\s*\|\|\s*' days?'\s*\)/gi,
        `(CURRENT_DATE - ((?)::int) * INTERVAL '1 day')`
      )
      .replace(
        /date\s*\(\s*'now'\s*,\s*'\+'\s*\|\|\s*\?\s*\|\|\s*' days?'\s*\)/gi,
        `(CURRENT_DATE + ((?)::int) * INTERVAL '1 day')`
      )
      // date('now', ?)  — bound interval like '-30 day'
      .replace(
        /date\s*\(\s*'now'\s*,\s*\?\s*\)/gi,
        '(CURRENT_DATE + (?::text)::interval)'
      )
      // date(expr, 'localtime')
      .replace(
        /date\s*\(\s*([^,()]+?)\s*,\s*'localtime'\s*\)/gi,
        '(($1)::timestamptz)::date'
      )
      // date(expr, '-30 days') / date(?, '+7 days')
      .replace(
        /date\s*\(\s*([^,()]+?)\s*,\s*'([+-]?\d+)\s+days?'\s*\)/gi,
        (_, expr, n) => `((${expr})::date + INTERVAL '${Number(n)} days')`
      )
      // date('now', 'start of year') / fiscal year helpers
      .replace(/date\s*\(\s*'now'\s*,\s*'start of year'\s*\)/gi, "date_trunc('year', CURRENT_DATE)::date")
      .replace(
        /date\s*\(\s*'now'\s*,\s*'start of year'\s*,\s*'\+1 year'\s*,\s*'-1 day'\s*\)/gi,
        "(date_trunc('year', CURRENT_DATE) + INTERVAL '1 year' - INTERVAL '1 day')::date"
      )
      .replace(/date\s*\(\s*'now'\s*,\s*'start of month'\s*\)/gi, "date_trunc('month', CURRENT_DATE)::date")
      // datetime('now', …) / datetime('now')
      .replace(/datetime\s*\(\s*'now'\s*(?:,\s*'[^']*')?\s*\)/gi, 'NOW()')
      // date('now')
      .replace(/date\s*\(\s*'now'\s*\)/gi, 'CURRENT_DATE')
      // strftime('%H', col, 'localtime') before 2-arg forms
      .replace(
        /strftime\s*\(\s*'%H'\s*,\s*([^,]+?)\s*,\s*'localtime'\s*\)/gi,
        "TO_CHAR(($1)::timestamptz, 'HH24')"
      )
      .replace(
        /strftime\s*\(\s*'%Y-%m-%d'\s*,\s*([^,]+?)\s*,\s*'localtime'\s*\)/gi,
        "TO_CHAR(($1)::timestamptz, 'YYYY-MM-DD')"
      )
      // strftime('%Y-%m', col) — leave month filters (before '%Y')
      .replace(
        /strftime\s*\(\s*'%Y-%m'\s*,\s*([^)]+?)\s*\)/gi,
        "TO_CHAR(($1)::timestamptz, 'YYYY-MM')"
      )
      // strftime('%H', col) / strftime('%Y', col) / strftime('%Y-%m-%d', col)
      .replace(
        /strftime\s*\(\s*'%H'\s*,\s*([^)]+?)\s*\)/gi,
        "TO_CHAR(($1)::timestamptz, 'HH24')"
      )
      .replace(
        /strftime\s*\(\s*'%Y'\s*,\s*([^)]+?)\s*\)/gi,
        "TO_CHAR(($1)::timestamptz, 'YYYY')"
      )
      .replace(
        /strftime\s*\(\s*'%Y-%m-%d'\s*,\s*'now'\s*\)/gi,
        "TO_CHAR(NOW(), 'YYYY-MM-DD')"
      )
      .replace(
        /strftime\s*\(\s*'%Y-%m-%d'\s*,\s*([^)]+?)\s*\)/gi,
        "TO_CHAR(($1)::timestamptz, 'YYYY-MM-DD')"
      )
      // datetime(column)
      .replace(/datetime\s*\(\s*([^'()][^)]*?)\s*\)/gi, '(($1)::timestamptz)')
      // date(COALESCE(...))
      .replace(
        /date\s*\(\s*COALESCE\s*\(([^)]+)\)\s*\)/gi,
        '((COALESCE($1))::timestamptz)::date'
      )
      // date(?) or date(column) — no nested parens
      .replace(/date\s*\(\s*([^()]+?)\s*\)/gi, '(($1)::timestamptz)::date')
      .replace(/\bIFNULL\s*\(/gi, 'COALESCE(')
      .replace(/\bGLOB\b/gi, 'LIKE')
      // SQLite case-insensitive order — strip (Postgres has no COLLATE NOCASE)
      .replace(/\bCOLLATE\s+NOCASE\b/gi, '')
      // SQLite char(10) newline → Postgres chr(10)
      .replace(/\bchar\s*\(\s*(\d+)\s*\)/gi, 'chr($1)');

  if (/INSERT\s+OR\s+IGNORE\s+INTO/i.test(s)) {
    s = rewriteDates(s.replace(/INSERT\s+OR\s+IGNORE\s+INTO/gi, 'INSERT INTO'));
    if (!/\bON\s+CONFLICT\b/i.test(s)) s += ' ON CONFLICT DO NOTHING';
    return s;
  }
  if (/INSERT\s+OR\s+REPLACE\s+INTO/i.test(s)) {
    s = rewriteDates(s.replace(/INSERT\s+OR\s+REPLACE\s+INTO/gi, 'INSERT INTO'));
    if (!/\bON\s+CONFLICT\b/i.test(s)) s += ' ON CONFLICT DO NOTHING';
    return s;
  }
  return rewriteDates(s);
}

class Statement {
  constructor(sql) {
    this.sql = rewriteSqliteSql(sql);
  }

  run(...params) {
    return callQuery('run', {
      sql: this.sql,
      params: params.map((p) => (p === undefined ? null : p))
    });
  }

  get(...params) {
    return callQuery('get', {
      sql: this.sql,
      params: params.map((p) => (p === undefined ? null : p))
    });
  }

  all(...params) {
    return callQuery('all', {
      sql: this.sql,
      params: params.map((p) => (p === undefined ? null : p))
    });
  }
}

function wrapDatabase() {
  return {
    prepare(sql) {
      return new Statement(sql);
    },
    /** Run many statements in one worker round-trip. Each item: { sql, params?, method? }. */
    batch(queries) {
      const rewritten = (queries || []).map((q) => ({
        method: q.method || 'all',
        sql: rewriteSqliteSql(q.sql),
        params: (q.params || []).map((p) => (p === undefined ? null : p))
      }));
      return callQuery('batch', { queries: rewritten });
    },
    exec(sql) {
      callQuery('exec', { sql: rewriteSqliteSql(sql) });
    },
    pragma() {},
    /**
     * @param {Function} fn
     * @param {{ savepoints?: boolean }} [opts] — default savepoints:true for legacy try/catch.
     *   Use savepoints:false for atomic sale/stock txns (1 round-trip per statement, full rollback on error).
     */
    transaction(fn, opts = {}) {
      const useSp = opts.savepoints !== false;
      return (...args) => {
        callWorkerSync('begin', {});
        inTxn = true;
        txnUseSavepoints = useSp;
        savepointSeq = 0;
        try {
          const result = fn(...args);
          callWorkerSync('commit', {});
          inTxn = false;
          txnUseSavepoints = true;
          return result;
        } catch (err) {
          try {
            callWorkerSync('rollback', {});
          } catch (_) {}
          inTxn = false;
          txnUseSavepoints = true;
          throw err;
        }
      };
    },
    close() {}
  };
}

async function initPgDatabase() {
  if (!isPgMode()) throw new Error(missingDatabaseConfigMessage());
  ensureWorker();
  callWorkerSync('ping', {});
  db = wrapDatabase();
  return db;
}

function getPgDb() {
  if (!db) throw new Error('Postgres not initialized. Call initPgDatabase() first.');
  return db;
}

async function closePg() {
  if (worker) {
    await worker.terminate();
    worker = null;
  }
  db = null;
}

function persistNow() {}

function resetQueryStats() {
  queryStats = { count: 0, totalMs: 0, lastSlow: null, recent: [] };
}

function getQueryStats() {
  return { ...queryStats, recent: queryStats.recent ? [...queryStats.recent] : [] };
}

module.exports = {
  isPgMode,
  initPgDatabase,
  getPgDb,
  closePg,
  persistNow,
  rewriteSqliteSql,
  resetQueryStats,
  getQueryStats
};

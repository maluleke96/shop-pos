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
let savepointSeq = 0;

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
  if (!parsed.ok) throw new Error(parsed.error || 'Postgres error');
  return parsed.result;
}

/** Inside a transaction, wrap each statement in a SAVEPOINT so try/catch in store.js works on Postgres. */
function callQuery(method, payload) {
  if (!inTxn || method === 'begin' || method === 'commit' || method === 'rollback') {
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

  if (/INSERT\s+OR\s+IGNORE\s+INTO/i.test(s)) {
    s = s
      .replace(/INSERT\s+OR\s+IGNORE\s+INTO/gi, 'INSERT INTO')
      .replace(/datetime\s*\(\s*'now'\s*(?:,\s*'[^']*')?\s*\)/gi, 'NOW()')
      .replace(/date\s*\(\s*'now'\s*(?:,\s*'[^']*')?\s*\)/gi, 'CURRENT_DATE')
      .replace(/\bIFNULL\s*\(/gi, 'COALESCE(')
      .replace(/\bGLOB\b/gi, 'LIKE');
    if (!/\bON\s+CONFLICT\b/i.test(s)) s += ' ON CONFLICT DO NOTHING';
    return s;
  }
  if (/INSERT\s+OR\s+REPLACE\s+INTO/i.test(s)) {
    s = s
      .replace(/INSERT\s+OR\s+REPLACE\s+INTO/gi, 'INSERT INTO')
      .replace(/datetime\s*\(\s*'now'\s*(?:,\s*'[^']*')?\s*\)/gi, 'NOW()')
      .replace(/date\s*\(\s*'now'\s*(?:,\s*'[^']*')?\s*\)/gi, 'CURRENT_DATE')
      .replace(/\bIFNULL\s*\(/gi, 'COALESCE(');
    if (!/\bON\s+CONFLICT\b/i.test(s)) s += ' ON CONFLICT DO NOTHING';
    return s;
  }
  return s
    .replace(/datetime\s*\(\s*'now'\s*(?:,\s*'[^']*')?\s*\)/gi, 'NOW()')
    .replace(/date\s*\(\s*'now'\s*(?:,\s*'[^']*')?\s*\)/gi, 'CURRENT_DATE')
    .replace(/strftime\s*\(\s*'%Y-%m-%d'\s*,\s*'now'\s*\)/gi, "TO_CHAR(NOW(), 'YYYY-MM-DD')")
    .replace(/\bIFNULL\s*\(/gi, 'COALESCE(')
    .replace(/\bGLOB\b/gi, 'LIKE');
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
    exec(sql) {
      callQuery('exec', { sql: rewriteSqliteSql(sql) });
    },
    pragma() {},
    transaction(fn) {
      return (...args) => {
        callWorkerSync('begin', {});
        inTxn = true;
        savepointSeq = 0;
        try {
          const result = fn(...args);
          callWorkerSync('commit', {});
          inTxn = false;
          return result;
        } catch (err) {
          try {
            callWorkerSync('rollback', {});
          } catch (_) {}
          inTxn = false;
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

module.exports = {
  isPgMode,
  initPgDatabase,
  getPgDb,
  closePg,
  persistNow,
  databaseUrl
};

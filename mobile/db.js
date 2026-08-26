/**
 * Android / Capacitor SQLite via sql.js WASM (not ASM).
 * - Migrations gated by PRAGMA user_version
 * - Debounced persist of Uint8Array (no Array.from)
 * - Durable Documents mirror so APK update/reinstall restores shop + login
 */
const initSqlJs = require('sql.js/dist/sql-wasm.js');
const { SQL_FILES, SQL_NAMES } = require('./sql-bundle');

let rawDb = null;
let db = null;
let SQL = null;
let inTransaction = false;
let persistTimer = null;
let persistPending = false;
let durableTimer = null;
let durablePending = false;
let lastRecoverSource = null;
const IDB_NAME = 'ShopPOS';
const IDB_STORE = 'kv';
const IDB_KEY = 'shop-pos-db';
const PERSIST_MS = 450;
const DURABLE_MS = 2500;

function openIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function toUint8(data) {
  if (!data) return null;
  if (data instanceof Uint8Array) return data;
  if (Array.isArray(data)) return new Uint8Array(data);
  if (data.buffer instanceof ArrayBuffer) return new Uint8Array(data.buffer, data.byteOffset || 0, data.byteLength || data.length);
  try { return new Uint8Array(data); } catch { return null; }
}

async function loadDbBytes() {
  try {
    const idb = await openIdb();
    return new Promise((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE, 'readonly');
      const get = tx.objectStore(IDB_STORE).get(IDB_KEY);
      get.onsuccess = () => resolve(toUint8(get.result));
      get.onerror = () => reject(get.error);
    });
  } catch {
    return null;
  }
}

async function saveDbBytes(bytes) {
  try {
    const idb = await openIdb();
    return new Promise((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      if (bytes == null) store.delete(IDB_KEY);
      else store.put(bytes instanceof Uint8Array ? bytes : toUint8(bytes), IDB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (_) { /* ignore */ }
}

function persistNow(opts = {}) {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  persistPending = false;
  if (!rawDb) return;
  try {
    const bytes = rawDb.export();
    saveDbBytes(bytes);
    scheduleDurablePersist(bytes, !!opts.forceDurable);
  } catch (err) {
    console.warn('[Mobile DB] persist failed:', err.message);
  }
}

function schedulePersist() {
  persistPending = true;
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    if (!persistPending) return;
    persistNow();
  }, PERSIST_MS);
}

function scheduleDurablePersist(bytes, force = false) {
  durablePending = true;
  if (force) {
    if (durableTimer) {
      clearTimeout(durableTimer);
      durableTimer = null;
    }
    writeDurableMirror(bytes);
    durablePending = false;
    return;
  }
  if (durableTimer) return;
  durableTimer = setTimeout(() => {
    durableTimer = null;
    if (!durablePending || !rawDb) return;
    durablePending = false;
    try { writeDurableMirror(rawDb.export()); } catch (_) { /* ignore */ }
  }, DURABLE_MS);
}

function writeDurableMirror(bytes) {
  try {
    const capFiles = require('./capacitorFiles');
    if (!capFiles.isNative()) return;
    const arr = toUint8(bytes);
    if (!arr || arr.length < 100) return;
    Promise.resolve(capFiles.saveLiveDatabase(arr)).catch(err => {
      console.warn('[Mobile DB] durable mirror failed:', err?.message || err);
    });
  } catch (err) {
    console.warn('[Mobile DB] durable mirror unavailable:', err?.message || err);
  }
}

function probeCount(probe, sql) {
  try {
    const rows = probe.exec(sql);
    return rows.length ? Number(rows[0].values[0][0]) || 0 : 0;
  } catch {
    return 0;
  }
}

/** True if bytes contain a real shop (setup_complete OR users/products/sales/name). */
async function looksLikeBusinessDb(bytes) {
  try {
    await validateDatabaseBytes(bytes);
    await loadSqlJs();
    const probe = new SQL.Database(toUint8(bytes));
    try {
      const setupRows = probe.exec('SELECT setup_complete, shop_name, app_display_name FROM shop_settings WHERE id=1');
      const setup = setupRows.length ? Number(setupRows[0].values[0][0]) || 0 : 0;
      const shopName = setupRows.length
        ? String(setupRows[0].values[0][1] || setupRows[0].values[0][2] || '').trim()
        : '';
      if (setup === 1) return true;
      const users = probeCount(probe, 'SELECT COUNT(*) FROM users');
      const products = probeCount(probe, 'SELECT COUNT(*) FROM products');
      const employees = probeCount(probe, 'SELECT COUNT(*) FROM employees');
      const sales = probeCount(probe, 'SELECT COUNT(*) FROM sales');
      const customers = probeCount(probe, 'SELECT COUNT(*) FROM customers');
      return !!(users || products || employees || sales || customers || shopName);
    } finally {
      probe.close();
    }
  } catch {
    return false;
  }
}

async function looksLikeSetupDb(bytes) {
  return looksLikeBusinessDb(bytes);
}

async function recoverFromDurableStorage() {
  try {
    const capFiles = require('./capacitorFiles');
    if (!capFiles.isNative()) return null;
    const found = await capFiles.loadDurableDatabase();
    if (!found?.bytes) return null;
    const ok = await looksLikeBusinessDb(found.bytes);
    if (!ok) {
      // Still accept a valid DB even if detection fails — better than blank shop
      try { await validateDatabaseBytes(found.bytes); }
      catch { return null; }
    }
    lastRecoverSource = found.source || 'Documents/ShopPOS';
    console.info('[Mobile DB] Restored shop data from', lastRecoverSource);
    return toUint8(found.bytes);
  } catch (err) {
    console.warn('[Mobile DB] durable recover failed:', err?.message || err);
    return null;
  }
}

class Statement {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql;
  }
  run(...params) {
    const sanitized = params.map(p => (p === undefined ? null : p));
    this.database.run(this.sql, sanitized);
    if (!inTransaction) schedulePersist();
    const result = rawDb.exec('SELECT last_insert_rowid() AS id');
    const lastInsertRowid = result.length ? result[0].values[0][0] : 0;
    return { lastInsertRowid, changes: rawDb.getRowsModified() };
  }
  get(...params) {
    const stmt = rawDb.prepare(this.sql);
    try {
      if (params.length) stmt.bind(params);
      if (stmt.step()) return stmt.getAsObject();
      return undefined;
    } finally {
      stmt.free();
    }
  }
  all(...params) {
    const results = [];
    const stmt = rawDb.prepare(this.sql);
    try {
      if (params.length) stmt.bind(params);
      while (stmt.step()) results.push(stmt.getAsObject());
      return results;
    } finally {
      stmt.free();
    }
  }
}

function wrapDatabase(database) {
  return {
    prepare(sql) { return new Statement(database, sql); },
    exec(sql) { database.run(sql); schedulePersist(); },
    pragma() {},
    transaction(fn) {
      return (...args) => {
        inTransaction = true;
        database.run('BEGIN');
        try {
          const result = fn(...args);
          database.run('COMMIT');
          inTransaction = false;
          schedulePersist();
          return result;
        } catch (err) {
          try { database.run('ROLLBACK'); } catch (_) {}
          inTransaction = false;
          throw err;
        }
      };
    },
    close() { persistNow(); database.close(); }
  };
}

function isBenignMigrationError(message) {
  const msg = String(message || '').toLowerCase();
  return msg.includes('duplicate column')
    || msg.includes('already exists')
    || msg.includes('unique constraint')
    || msg.includes('duplicate key');
}

function fileVersion(name, index) {
  const m = String(name || '').match(/v(\d+)/i);
  if (m) return parseInt(m[1], 10);
  // schema.sql = 0, migrations.sql = 1, then numbered files
  if (index === 0) return 0;
  if (index === 1) return 1;
  return index;
}

function getUserVersion() {
  try {
    const rows = rawDb.exec('PRAGMA user_version');
    return rows.length ? Number(rows[0].values[0][0]) || 0 : 0;
  } catch {
    return 0;
  }
}

function setUserVersion(v) {
  try { rawDb.run(`PRAGMA user_version = ${Math.max(0, Math.floor(Number(v) || 0))}`); }
  catch (_) { /* ignore */ }
}

function runMigrations() {
  const names = SQL_NAMES || SQL_FILES.map((_, i) => `file-${i}`);
  const target = names.reduce((max, name, i) => Math.max(max, fileVersion(name, i)), 0);
  const current = getUserVersion();
  if (current >= target && target > 0) {
    return; // already up to date — skip replaying all SQL
  }
  // UPDATE SAFETY: timestamped backup before schema changes on existing data
  if (current > 0 && current < target) {
    try {
      const capFiles = require('./capacitorFiles');
      const bytes = rawDb.export();
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19).replace('T', '_');
      const name = `ShopPOS_Backup_${stamp}.db`;
      // Fire-and-forget async write; durable mirror still persists after migrations
      Promise.resolve(capFiles.saveSilent(name, new Uint8Array(bytes))).then((r) => {
        if (r?.success) console.log('[Mobile DB] Pre-migration backup:', r.path);
        else console.warn('[Mobile DB] Pre-migration backup failed', r?.error || r);
      }).catch((err) => console.warn('[Mobile DB] Pre-migration backup error', err?.message || err));
    } catch (err) {
      console.warn('[Mobile DB] Could not start pre-migration backup', err?.message || err);
    }
  }
  let applied = current;
  SQL_FILES.forEach((sqlFile, index) => {
    const ver = fileVersion(names[index], index);
    if (ver <= current && current > 0) return;
    sqlFile.split(';').map(s => s.trim()).filter(Boolean).forEach(sql => {
      try {
        rawDb.run(sql);
      } catch (err) {
        if (isBenignMigrationError(err.message)) return;
        console.error(`[Mobile migration ${index}] Statement failed:`, err.message);
        console.error('[Migration SQL]', sql.slice(0, 300));
      }
    });
    if (ver > applied) applied = ver;
  });
  setUserVersion(Math.max(applied, target));
}

async function loadSqlJs() {
  if (SQL) return SQL;
  SQL = await initSqlJs({
    locateFile: (file) => {
      // Capacitor serves www/ as app root
      if (typeof window !== 'undefined' && window.location?.href) {
        try {
          return new URL(`wasm/${file}`, window.location.href).href;
        } catch (_) { /* fall through */ }
      }
      return `wasm/${file}`;
    }
  });
  return SQL;
}

async function validateDatabaseBytes(bytes) {
  const arr = toUint8(bytes);
  if (!arr || arr.length < 100) throw new Error('Backup file is too small to be a valid database');
  const header = String.fromCharCode(...arr.slice(0, 15));
  if (header !== 'SQLite format 3') throw new Error('File is not a valid SQLite database');
  await loadSqlJs();
  let testDb;
  try {
    testDb = new SQL.Database(arr);
    const tables = testDb.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='shop_settings'");
    if (!tables.length || !tables[0].values?.length) {
      throw new Error('Invalid Shop POS backup: shop_settings table is missing');
    }
  } finally {
    testDb?.close();
  }
}

async function initDatabase(opts = {}) {
  if (db) return db;
  await loadSqlJs();
  lastRecoverSource = null;
  let saved = await loadDbBytes();
  let recovered = false;
  const skipRecover = !!opts.skipRecover;
  const idbEmpty = !saved || saved.length < 100;

  // IndexedDB can be empty after update/reinstall. Prefer Documents live mirror / backups.
  if (!skipRecover) {
    if (idbEmpty) {
      const durable = await recoverFromDurableStorage();
      if (durable) {
        saved = durable;
        recovered = true;
      }
    } else {
      // Prefer durable shop if IndexedDB is only an empty shell (setup_complete=0, no data)
      const idbReady = await looksLikeBusinessDb(saved);
      if (!idbReady) {
        const durable = await recoverFromDurableStorage();
        if (durable && (await looksLikeBusinessDb(durable))) {
          saved = durable;
          recovered = true;
        }
      }
    }
  }

  const openingBlank = !saved || saved.length < 100;
  rawDb = saved ? new SQL.Database(saved) : new SQL.Database();
  db = wrapDatabase(rawDb);
  runMigrations();

  // NEVER overwrite a good Documents live DB with a blank in-memory shell
  if (openingBlank && !recovered) {
    persistNow({ forceDurable: false });
    console.warn('[Mobile DB] Opened empty DB — durable mirror not overwritten');
  } else {
    persistNow({ forceDurable: true });
  }
  if (recovered && typeof window !== 'undefined') {
    window.__SHOP_POS_RECOVERED__ = lastRecoverSource;
  }
  return db;
}

function getDb() {
  if (!db) throw new Error('Database not initialized. Call initDatabase() first.');
  return db;
}

function closeDatabase() {
  if (rawDb) {
    persistNow();
    try { db.close(); } catch (_) { rawDb.close(); }
    rawDb = null;
    db = null;
  }
}

function getDbPath() { return 'shop-pos-mobile.db'; }
function getDbPathForBackup() { return getDbPath(); }

async function resetDatabaseFile() {
  await saveDbBytes(null);
  rawDb = null;
  db = null;
  // Intentionally wipe live mirror so factory reset does not auto-restore
  try {
    const capFiles = require('./capacitorFiles');
    if (capFiles.isNative()) {
      await loadSqlJs();
      const empty = new SQL.Database();
      const bytes = empty.export();
      empty.close();
      await capFiles.saveLiveDatabase(bytes);
    }
  } catch (_) { /* ignore */ }
  return initDatabase({ skipRecover: true });
}

async function importDatabaseBytes(bytes) {
  const arr = toUint8(bytes);
  if (!arr) throw new Error('Invalid database bytes');
  if (rawDb) {
    try { persistNow({ forceDurable: true }); rawDb.close(); } catch (_) {}
  }
  rawDb = null;
  db = null;
  await loadSqlJs();
  rawDb = new SQL.Database(arr);
  db = wrapDatabase(rawDb);
  await saveDbBytes(arr);
  writeDurableMirror(arr);
  return db;
}

function exportDatabaseBytes() {
  if (!rawDb) throw new Error('Database not initialized');
  persistNow({ forceDurable: true });
  // Keep Array for older backup callers that expect a plain array
  return Array.from(rawDb.export());
}

function getLastRecoverSource() {
  return lastRecoverSource;
}

module.exports = {
  initDatabase,
  getDb,
  closeDatabase,
  getDbPath,
  getDbPathForBackup,
  resetDatabaseFile,
  exportDatabaseBytes,
  importDatabaseBytes,
  validateDatabaseBytes,
  persistNow,
  schedulePersist,
  getLastRecoverSource
};

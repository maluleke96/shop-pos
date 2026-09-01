const initSqlJs = require('sql.js/dist/sql-asm.js');
const path = require('path');
const fs = require('fs');
const pgDb = require('./pg-db');

let rawDb = null;
let db = null;
let dbPath = null;
let SQL = null;
let usingPg = false;
let lastKnownMtimeMs = 0;

function sleepSync(ms) {
  const n = Math.max(1, Number(ms) || 1);
  try {
    const sab = new SharedArrayBuffer(4);
    Atomics.wait(new Int32Array(sab), 0, 0, n);
  } catch (_) {
    const end = Date.now() + n;
    while (Date.now() < end) { /* spin */ }
  }
}

function withDbFileLock(fn) {
  if (!dbPath) return fn();
  const lockPath = `${dbPath}.lock`;
  const started = Date.now();
  while (true) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      try {
        return fn();
      } finally {
        try { fs.closeSync(fd); } catch (_) { /* ignore */ }
        try { fs.unlinkSync(lockPath); } catch (_) { /* ignore */ }
      }
    } catch (err) {
      if (Date.now() - started > 8000) {
        try { fs.unlinkSync(lockPath); } catch (_) { /* stale */ }
        continue;
      }
      sleepSync(40);
    }
  }
}

function legacyAppDataCandidates(app) {
  const appData = app.getPath('appData');
  const names = [
    'Shop POS Admin',
    'Shop POS',
    'shop-pos',
    'Recipe & Production',
    'Marketing Agent',
    'Staff Portal',
    'com.shoppos.admin',
    'com.shoppos.pos',
    'com.shoppos.offline'
  ];
  return names.map((n) => path.join(appData, n, 'data', 'shop-pos.db'));
}

function migrateLegacyDbIfNeeded(sharedPath, app) {
  if (fs.existsSync(sharedPath)) return;
  const candidates = legacyAppDataCandidates(app)
    .filter((p) => p !== sharedPath && fs.existsSync(p))
    .map((p) => ({ p, size: fs.statSync(p).size }))
    .sort((a, b) => b.size - a.size);
  if (!candidates.length) return;
  try {
    fs.copyFileSync(candidates[0].p, sharedPath);
    console.log(`[DB] Migrated local database into shared store from ${candidates[0].p}`);
  } catch (err) {
    console.warn('[DB] Could not migrate legacy database:', err.message || err);
  }
}

function getDbPath() {
  // Cloud / headless server mode (no Electron)
  if (process.env.SHOP_POS_DATA) {
    const baseDir = path.resolve(process.env.SHOP_POS_DATA);
    if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });
    return path.join(baseDir, 'shop-pos.db');
  }
  let app;
  try {
    ({ app } = require('electron'));
  } catch (err) {
    const fallback = path.join(process.cwd(), 'data');
    if (!fs.existsSync(fallback)) fs.mkdirSync(fallback, { recursive: true });
    return path.join(fallback, 'shop-pos.db');
  }
  const isPortable = process.env.PORTABLE_EXECUTABLE_DIR;
  if (isPortable) {
    const baseDir = path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'data');
    if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });
    return path.join(baseDir, 'shop-pos.db');
  }

  // Local Admin / POS / Recipe share one SQLite file so sales and stock stay in sync.
  const useShared = process.env.SHOP_POS_LOCAL_INSTALLER === '1'
    || process.env.SHOP_POS_SHARED_DATA === '1';
  if (useShared) {
    const baseDir = path.join(app.getPath('appData'), 'ShopPOS', 'Shared');
    if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });
    const sharedPath = path.join(baseDir, 'shop-pos.db');
    migrateLegacyDbIfNeeded(sharedPath, app);
    return sharedPath;
  }

  const baseDir = path.join(app.getPath('userData'), 'data');
  if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });
  return path.join(baseDir, 'shop-pos.db');
}

let inTransaction = false;

function persist() {
  if (!rawDb || !dbPath) return;
  withDbFileLock(() => {
    const data = rawDb.export();
    fs.writeFileSync(dbPath, Buffer.from(data));
    try { lastKnownMtimeMs = fs.statSync(dbPath).mtimeMs; } catch (_) { /* ignore */ }
  });
}

let lastReloadCheckAt = 0;

/** Reload in-memory sql.js DB when another ShopPOS app wrote the shared file. */
function maybeReloadFromDisk(force = false) {
  if (usingPg || !rawDb || !dbPath || !fs.existsSync(dbPath)) return false;
  const now = Date.now();
  if (!force && now - lastReloadCheckAt < 1200) return false;
  lastReloadCheckAt = now;
  let mtime = 0;
  try { mtime = fs.statSync(dbPath).mtimeMs; } catch (_) { return false; }
  if (!mtime || mtime <= lastKnownMtimeMs) return false;
  return withDbFileLock(() => {
    try {
      mtime = fs.statSync(dbPath).mtimeMs;
      if (!mtime || mtime <= lastKnownMtimeMs) return false;
      const next = new SQL.Database(fs.readFileSync(dbPath));
      try { rawDb.close(); } catch (_) { /* ignore */ }
      rawDb = next;
      db = wrapDatabase(rawDb);
      lastKnownMtimeMs = mtime;
      return true;
    } catch (err) {
      console.warn('[DB] Reload from disk failed:', err.message || err);
      return false;
    }
  });
}

class Statement {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql;
  }

  run(...params) {
    try {
      const sanitized = params.map(p => (p === undefined ? null : p));
      this.database.run(this.sql, sanitized);
      if (!inTransaction) persist();
      let lastInsertRowid = 0;
      try {
        const stmt = rawDb.prepare('SELECT last_insert_rowid() AS id');
        if (stmt.step()) {
          const obj = stmt.getAsObject();
          lastInsertRowid = Number(obj.id) || 0;
        }
        stmt.free();
      } catch (_) {
        const result = rawDb.exec('SELECT last_insert_rowid() AS id');
        lastInsertRowid = result.length ? Number(result[0].values[0][0]) || 0 : 0;
      }
      return { lastInsertRowid, changes: rawDb.getRowsModified() };
    } catch (err) {
      throw new Error(err.message || 'Database error');
    }
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
    prepare(sql) {
      return new Statement(database, sql);
    },
    exec(sql) {
      database.run(sql);
      persist();
    },
    pragma() {},
    transaction(fn) {
      return (...args) => {
        inTransaction = true;
        database.run('BEGIN');
        try {
          const result = fn(...args);
          database.run('COMMIT');
          inTransaction = false;
          persist();
          return result;
        } catch (err) {
          try { database.run('ROLLBACK'); } catch (_) {}
          inTransaction = false;
          throw err;
        }
      };
    },
    close() {
      persist();
      database.close();
    }
  };
}

function isBenignMigrationError(message, sql) {
  const msg = String(message || '').toLowerCase();
  const stmt = String(sql || '').trim().toLowerCase();
  if (msg.includes('no such table')) {
    if (stmt.startsWith('alter table') || stmt.startsWith('create index')) return true;
  }
  return msg.includes('duplicate column')
    || msg.includes('already exists')
    || msg.includes('unique constraint')
    || msg.includes('duplicate key');
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
  rawDb.run(`PRAGMA user_version = ${Math.max(0, Math.floor(Number(v) || 0))}`);
}

function listMigrationVersions() {
  return fs.readdirSync(__dirname)
    .map(f => {
      const m = String(f).match(/^migrations-v(\d+)\.sql$/i);
      return m ? parseInt(m[1], 10) : null;
    })
    .filter(n => Number.isFinite(n))
    .sort((a, b) => a - b);
}

function stripSqlLineComments(sqlText) {
  // Remove -- comments so semicolons inside comments do not split statements.
  return String(sqlText || '')
    .split(/\r?\n/)
    .map((line) => {
      const idx = line.indexOf('--');
      return idx >= 0 ? line.slice(0, idx) : line;
    })
    .join('\n');
}

function runMigrationFile(versionLabel, filePath, { failHard = false } = {}) {
  if (!fs.existsSync(filePath)) return;
  const sqlText = stripSqlLineComments(fs.readFileSync(filePath, 'utf8'));
  sqlText.split(';').map(s => s.trim()).filter(Boolean).forEach(sql => {
    try {
      rawDb.run(sql);
    } catch (err) {
      if (isBenignMigrationError(err.message, sql)) return;
      console.error(`[Migration ${versionLabel}] Statement failed:`, err.message);
      console.error('[Migration SQL]', sql.slice(0, 300));
      if (failHard) throw new Error(`Migration ${versionLabel} failed: ${err.message}`);
    }
  });
}

async function validateDatabaseBytes(buffer) {
  if (!buffer || buffer.length < 100) throw new Error('Backup file is too small to be a valid database');
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (buf.slice(0, 15).toString('utf8') !== 'SQLite format 3') {
    throw new Error('File is not a valid SQLite database');
  }
  if (!SQL) SQL = await initSqlJs();
  let testDb;
  try {
    testDb = new SQL.Database(buf);
    const tables = testDb.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='shop_settings'");
    if (!tables.length || !tables[0].values?.length) {
      throw new Error('Invalid Shop POS backup: shop_settings table is missing');
    }
  } finally {
    testDb?.close();
  }
}

async function validateDatabaseFile(filePath) {
  if (!fs.existsSync(filePath)) throw new Error('Backup file not found');
  return validateDatabaseBytes(fs.readFileSync(filePath));
}

async function initDatabase() {
  if (db) return db;

  // Postgres mode (Railway Postgres / Supabase) — auto-create schema if empty
  if (pgDb.isPgMode()) {
    usingPg = true;
    process.env.SHOP_POS_CLOUD = '1';
    db = await pgDb.initPgDatabase();
    try {
      const { ensurePgSchema, ensureAccSchema } = require('./ensure-pg-schema');
      ensurePgSchema(db);
    } catch (err) {
      console.error('[DB] ensurePgSchema failed:', err.message || err);
      throw err;
    }
    try {
      const { ensurePgMigrations } = require('./ensure-pg-migrations');
      const { ensureAccSchema } = require('./ensure-pg-schema');
      const mig = ensurePgMigrations(db);
      const acc = ensureAccSchema(db);
      console.log('[DB] Accounting bootstrap:', JSON.stringify({ migrations: mig, accounting: acc }));
    } catch (err) {
      console.error('[DB] Accounting schema bootstrap failed (non-fatal):', err.message || err);
    }
    console.log('[DB] Using Postgres via SHOP_POS_DATABASE_URL / DATABASE_URL');
    return db;
  }

  SQL = await initSqlJs();
  dbPath = getDbPath();
  const dbFileExisted = fs.existsSync(dbPath);

  if (dbFileExisted) {
    rawDb = new SQL.Database(fs.readFileSync(dbPath));
    try { lastKnownMtimeMs = fs.statSync(dbPath).mtimeMs; } catch (_) { lastKnownMtimeMs = Date.now(); }
  } else {
    rawDb = new SQL.Database();
    lastKnownMtimeMs = 0;
  }

  db = wrapDatabase(rawDb);
  rawDb.run('PRAGMA foreign_keys=ON');
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  rawDb.exec(schema);

  const versions = listMigrationVersions();
  const latest = versions.length ? versions[versions.length - 1] : 0;
  let current = getUserVersion();

  // Legacy Electron DBs never set user_version but already applied migrations
  // through v64 under the old "replay everything" runner. Mark floor at 64 so
  // newer migrations (v65+) still apply once — never replay DROP/rebuilds.
  if (dbFileExisted && current === 0 && latest > 0) {
    const legacyFloor = Math.min(64, latest);
    console.log(`[DB] Legacy database detected — marking user_version=${legacyFloor} (will apply newer migrations only)`);
    setUserVersion(legacyFloor);
    current = legacyFloor;
  }

  // UPDATE SAFETY: timestamped backup before any schema migration on existing data
  if (dbFileExisted && current < latest) {
    try {
      const backupDir = path.join(path.dirname(dbPath), 'backups');
      if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const backupName = `ShopPOS_Backup_${stamp.replace('T', '_')}.db`;
      const backupPath = path.join(backupDir, backupName);
      fs.copyFileSync(dbPath, backupPath);
      console.log(`[DB] Pre-migration backup created: ${backupPath}`);
    } catch (err) {
      console.error('[DB] Failed to create pre-migration backup:', err.message);
      throw new Error('Could not backup database before upgrade. Update stopped to protect your data. ' + err.message);
    }
  }

  if (!dbFileExisted || current === 0) {
    runMigrationFile('base', path.join(__dirname, 'migrations.sql'), { failHard: !dbFileExisted });
  }

  for (const v of versions) {
    if (v <= current) continue;
    runMigrationFile(`v${v}`, path.join(__dirname, `migrations-v${v}.sql`), { failHard: true });
    setUserVersion(v);
    current = v;
  }

  if (current < latest) setUserVersion(latest);

  persist();
  return db;
}

function getDb() {
  if (!db) throw new Error('Database not initialized. Call initDatabase() first.');
  try { maybeReloadFromDisk(); } catch (_) { /* keep current */ }
  return db;
}

function closeDatabase() {
  if (usingPg) {
    usingPg = false;
    db = null;
    return pgDb.closePg();
  }
  if (rawDb) {
    db.close();
    rawDb = null;
    db = null;
  }
}

async function resetDatabaseFile() {
  if (usingPg) {
    throw new Error('Factory reset of cloud Postgres is disabled. Use Supabase backups / controlled SQL.');
  }
  closeDatabase();
  const p = dbPath || getDbPath();
  if (fs.existsSync(p)) fs.unlinkSync(p);
  dbPath = null;
  return initDatabase();
}

function getDbPathForBackup() {
  if (usingPg) return null;
  return dbPath || getDbPath();
}

function persistNow() {
  if (usingPg) return pgDb.persistNow();
  persist();
}

module.exports = {
  initDatabase,
  getDb,
  closeDatabase,
  getDbPathForBackup,
  getDbPath,
  resetDatabaseFile,
  validateDatabaseFile,
  validateDatabaseBytes,
  persistNow,
  maybeReloadFromDisk,
  isPgMode: () => usingPg || pgDb.isPgMode()
};

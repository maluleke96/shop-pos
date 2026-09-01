/**
 * Apply incremental Supabase/Postgres migrations on Railway boot.
 * Same database as POS — keeps online ordering tables in sync.
 */
const fs = require('fs');
const path = require('path');
const { stripSqlNoise, splitSqlStatements } = require('./ensure-pg-schema');

function ensurePgMigrations(db) {
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS pg_schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  } catch (err) {
    console.warn('[DB] pg_schema_migrations:', err.message);
    return { applied: [] };
  }

  const dir = path.join(__dirname, '..', '..', 'supabase', 'migrations');
  if (!fs.existsSync(dir)) return { applied: [] };

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const applied = [];

  for (const file of files) {
    let done = false;
    try {
      done = !!db.prepare('SELECT 1 AS ok FROM pg_schema_migrations WHERE name = ? LIMIT 1').get(file)?.ok;
    } catch (_) { /* */ }

    if (file.includes('accounting') && done) {
      let hasAcc = false;
      try {
        hasAcc = !!db.prepare(`
          SELECT 1 AS ok FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'acc_settings' LIMIT 1
        `).get()?.ok;
      } catch (_) { /* */ }
      if (!hasAcc) {
        console.warn(`[DB] ${file} marked applied but acc_settings missing — re-applying`);
        try { db.prepare('DELETE FROM pg_schema_migrations WHERE name = ?').run(file); } catch (_) { /* */ }
        done = false;
      }
    }

    if (done) continue;

    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    const stmts = splitSqlStatements(sql);
    console.log(`[DB] Applying Postgres migration ${file} (${stmts.length} statements)…`);
    for (const stmt of stmts) {
      try {
        db.exec(stmt);
      } catch (err) {
        const msg = String(err.message || err);
        if (/already exists|duplicate|does not exist.*column/i.test(msg)) continue;
        console.warn(`[DB] migration ${file}:`, msg.slice(0, 200));
      }
    }
    try {
      db.prepare('INSERT INTO pg_schema_migrations (name) VALUES (?) ON CONFLICT (name) DO NOTHING').run(file);
    } catch (_) {
      db.prepare('INSERT INTO pg_schema_migrations (name) VALUES (?)').run(file);
    }
    if (file.includes('accounting')) {
      let hasAcc = false;
      try {
        hasAcc = !!db.prepare(`
          SELECT 1 AS ok FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'acc_settings' LIMIT 1
        `).get()?.ok;
      } catch (_) { /* */ }
      if (!hasAcc) {
        console.error(`[DB] Migration ${file} did not create acc_settings — will retry on next boot`);
        try { db.prepare('DELETE FROM pg_schema_migrations WHERE name = ?').run(file); } catch (_) { /* */ }
        continue;
      }
    }
    applied.push(file);
  }

  if (applied.length) console.log('[DB] Postgres migrations applied:', applied.join(', '));
  return { applied };
}

module.exports = { ensurePgMigrations };

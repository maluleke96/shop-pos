/**
 * Ensure Postgres has Shop POS schema (Railway Postgres / any empty PG).
 * Runs COMPLETE_SUPABASE_SETUP.sql once when shop_settings is missing.
 */
const fs = require('fs');
const path = require('path');

function schemaSqlPath() {
  return path.join(__dirname, '..', '..', 'supabase', 'COMPLETE_SUPABASE_SETUP.sql');
}

function stripSqlNoise(sql) {
  // Remove block comments and line comments carefully enough for our dump
  return String(sql || '')
    .replace(/\/\*[\s\S]*?\*\//g, '\n')
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('--')) return '';
      return line;
    })
    .join('\n');
}

function splitSqlStatements(sql) {
  const cleaned = stripSqlNoise(sql);
  const parts = [];
  let buf = '';
  let inSingle = false;
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (ch === "'") {
      if (inSingle && cleaned[i + 1] === "'") {
        buf += "''";
        i++;
        continue;
      }
      inSingle = !inSingle;
      buf += ch;
      continue;
    }
    if (ch === ';' && !inSingle) {
      const stmt = buf.trim();
      if (stmt) parts.push(stmt);
      buf = '';
      continue;
    }
    buf += ch;
  }
  const tail = buf.trim();
  if (tail) parts.push(tail);
  return parts;
}

function ensurePgSchema(db) {
  let exists = false;
  try {
    const row = db.prepare(`
      SELECT 1 AS ok FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'shop_settings'
      LIMIT 1
    `).get();
    exists = !!row?.ok;
  } catch (_) {
    exists = false;
  }
  if (exists) {
    // Ensure seed row for empty but created schema
    try {
      db.prepare(`INSERT INTO shop_settings (id, shop_name, setup_complete)
        VALUES (1, 'My Shop', 0)
        ON CONFLICT (id) DO NOTHING`).run();
    } catch (_) { /* ignore */ }
    return { applied: false, reason: 'already-present' };
  }

  const file = schemaSqlPath();
  if (!fs.existsSync(file)) {
    throw new Error('Schema file missing: supabase/COMPLETE_SUPABASE_SETUP.sql');
  }
  const sql = fs.readFileSync(file, 'utf8');
  const stmts = splitSqlStatements(sql);
  console.log(`[DB] Applying Shop POS schema (${stmts.length} statements)…`);
  let ok = 0;
  let skipped = 0;
  for (const stmt of stmts) {
    try {
      db.exec(stmt);
      ok++;
    } catch (err) {
      const msg = String(err.message || err);
      // Idempotent / non-fatal for additive dumps
      if (/already exists|duplicate/i.test(msg)) {
        skipped++;
        continue;
      }
      console.warn('[DB] schema stmt warning:', msg.slice(0, 160));
      skipped++;
    }
  }
  try {
    db.prepare(`INSERT INTO shop_settings (id, shop_name, setup_complete)
      VALUES (1, 'My Shop', 0)
      ON CONFLICT (id) DO NOTHING`).run();
  } catch (_) { /* ignore */ }
  console.log(`[DB] Schema apply done (ok=${ok}, skipped=${skipped})`);
  return { applied: true, ok, skipped };
}

module.exports = { ensurePgSchema };

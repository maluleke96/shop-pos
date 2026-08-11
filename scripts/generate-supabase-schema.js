/**
 * Generate Postgres/Supabase DDL from a live Shop POS SQLite DB (authoritative columns).
 * Safe: CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS only — no DROP/TRUNCATE.
 *
 * Usage: node scripts/generate-supabase-schema.js <shop-pos.db> <outDir>
 */
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const ARCHIVE_TABLES = new Set(['online_orders_local', 'sync_outbox']);
const SKIP_TABLES = new Set([]); // none — we keep archive tables under legacy_* names

function mapType(sqliteType, colName, pk) {
  const t = String(sqliteType || '').toUpperCase();
  const n = String(colName || '').toLowerCase();
  if (pk && (t.includes('INT') || t === '' || t === 'INTEGER')) return 'bigint';
  if (n.endsWith('_json') || n === 'permissions' || n === 'cart_data' || n.includes('settings')) {
    if (t.includes('BLOB')) return 'bytea';
    return 'jsonb';
  }
  if (t.includes('BLOB')) return 'bytea';
  if (t.includes('INT') || t === 'BOOLEAN') return 'bigint';
  if (t.includes('REAL') || t.includes('FLOA') || t.includes('DOUB')) return 'numeric';
  if (t.includes('NUMERIC') || t.includes('DECIMAL')) return 'numeric';
  return 'text';
}

function qIdent(name) {
  return '"' + String(name).replace(/"/g, '""') + '"';
}

function defaultSql(dflt, pgType) {
  if (dflt == null || dflt === '') return null;
  let d = String(dflt).trim();
  if (/^datetime\s*\(\s*'now'\s*\)$/i.test(d) || /^current_timestamp$/i.test(d)) {
    return 'now()';
  }
  if (/^date\s*\(\s*'now'\s*\)$/i.test(d)) return 'CURRENT_DATE';
  if (d === "''") return "''";
  if (/^'.*'$/.test(d)) return d;
  if (/^-?\d+(\.\d+)?$/.test(d)) return d;
  if (pgType === 'jsonb' && (d === "'{}'" || d === '{}')) return "'{}'::jsonb";
  if (pgType === 'jsonb' && (d === "'[]'" || d === '[]')) return "'[]'::jsonb";
  // fallback quote
  if (!/^'/.test(d)) d = "'" + d.replace(/'/g, "''") + "'";
  return d;
}

async function main() {
  const dbPath = process.argv[2];
  const outDir = process.argv[3] || path.join(__dirname, '..', 'supabase');
  if (!dbPath || !fs.existsSync(dbPath)) {
    console.error('Usage: node scripts/generate-supabase-schema.js <shop-pos.db> [outDir]');
    process.exit(1);
  }
  fs.mkdirSync(outDir, { recursive: true });

  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(dbPath));

  const tableRows = db.exec(
    "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  );
  const tables = (tableRows[0] && tableRows[0].values) || [];

  const indexRows = db.exec(
    "SELECT name, tbl_name, sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL ORDER BY name"
  );
  const indexes = (indexRows[0] && indexRows[0].values) || [];

  const fkMap = {};
  for (const [name] of tables) {
    const safe = name.replace(/"/g, '""');
    const fk = db.exec(`PRAGMA foreign_key_list("${safe}")`);
    fkMap[name] = (fk[0] && fk[0].values.map((r) => ({
      id: r[0], seq: r[1], table: r[2], from: r[3], to: r[4],
      on_update: r[5], on_delete: r[6]
    }))) || [];
  }

  const lines = [];
  lines.push('-- AUTO-GENERATED from live SQLite — Shop POS → Supabase Postgres');
  lines.push('-- SAFE: CREATE IF NOT EXISTS only. No DROP / TRUNCATE.');
  lines.push(`-- Source: ${path.resolve(dbPath)}`);
  lines.push(`-- Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');
  lines.push('');

  // Schema tables
  for (const [name] of tables) {
    const targetName = ARCHIVE_TABLES.has(name) ? `legacy_${name}` : name;
    const note = ARCHIVE_TABLES.has(name)
      ? `-- Archived (online ordering / hub sync removed from product): ${name} → ${targetName}`
      : `-- Table: ${name}`;
    lines.push(note);

    const safe = name.replace(/"/g, '""');
    const info = db.exec(`PRAGMA table_info("${safe}")`);
    const cols = (info[0] && info[0].values) || [];
    const colDefs = [];
    const pkCols = cols.filter((c) => c[5]).sort((a, b) => a[5] - b[5]);

    for (const c of cols) {
      const colName = c[1];
      const pgType = mapType(c[2], colName, c[5] === 1 && pkCols.length === 1);
      let def = `${qIdent(colName)} ${pgType}`;
      if (c[3]) def += ' NOT NULL';
      const d = defaultSql(c[4], pgType);
      if (d != null) def += ` DEFAULT ${d}`;
      colDefs.push(def);
    }

    if (pkCols.length === 1) {
      const only = pkCols[0][1];
      // rewrite that column line to include PRIMARY KEY
      for (let i = 0; i < colDefs.length; i++) {
        if (colDefs[i].startsWith(qIdent(only) + ' ')) {
          colDefs[i] = colDefs[i] + ' PRIMARY KEY';
          break;
        }
      }
    } else if (pkCols.length > 1) {
      colDefs.push(`PRIMARY KEY (${pkCols.map((c) => qIdent(c[1])).join(', ')})`);
    }

    lines.push(`CREATE TABLE IF NOT EXISTS public.${qIdent(targetName)} (`);
    lines.push('  ' + colDefs.join(',\n  '));
    lines.push(');');
    lines.push('');

    // Sequences for bigint single PKs
    if (pkCols.length === 1) {
      const pk = pkCols[0][1];
      const pgType = mapType(pkCols[0][2], pk, true);
      if (pgType === 'bigint') {
        lines.push(`CREATE SEQUENCE IF NOT EXISTS public.${qIdent(targetName + '_' + pk + '_seq')};`);
        lines.push(`ALTER TABLE public.${qIdent(targetName)} ALTER COLUMN ${qIdent(pk)} SET DEFAULT nextval('public.${targetName}_${pk}_seq');`);
        lines.push(`SELECT setval('public.${targetName}_${pk}_seq', COALESCE((SELECT MAX(${qIdent(pk)}) FROM public.${qIdent(targetName)}), 1));`);
        lines.push('');
      }
    }
  }

  // Foreign keys (additive; skip if would fail on missing — use DO block)
  lines.push('-- Foreign keys (additive, idempotent)');
  for (const [name] of tables) {
    const targetName = ARCHIVE_TABLES.has(name) ? `legacy_${name}` : name;
    const fks = fkMap[name] || [];
    // group by id
    const groups = {};
    for (const fk of fks) {
      groups[fk.id] = groups[fk.id] || [];
      groups[fk.id].push(fk);
    }
    for (const id of Object.keys(groups)) {
      const g = groups[id].sort((a, b) => a.seq - b.seq);
      const refTable = ARCHIVE_TABLES.has(g[0].table) ? `legacy_${g[0].table}` : g[0].table;
      // skip FK to users from archived only if needed — keep all for integrity of business data
      const constraint = `${targetName}_fk_${id}`;
      const cols = g.map((x) => qIdent(x.from)).join(', ');
      const refs = g.map((x) => qIdent(x.to)).join(', ');
      let onDelete = '';
      if (String(g[0].on_delete).toUpperCase() === 'CASCADE') onDelete = ' ON DELETE CASCADE';
      else if (String(g[0].on_delete).toUpperCase() === 'SET NULL') onDelete = ' ON DELETE SET NULL';
      lines.push(`DO $$ BEGIN`);
      lines.push(`  ALTER TABLE public.${qIdent(targetName)} ADD CONSTRAINT ${qIdent(constraint)}`);
      lines.push(`    FOREIGN KEY (${cols}) REFERENCES public.${qIdent(refTable)}(${refs})${onDelete};`);
      lines.push(`EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;`);
    }
  }
  lines.push('');

  // Indexes
  lines.push('-- Indexes');
  for (const [, tbl, sql] of indexes) {
    const targetTbl = ARCHIVE_TABLES.has(tbl) ? `legacy_${tbl}` : tbl;
    // Convert SQLite CREATE INDEX to Postgres IF NOT EXISTS on public schema
    let s = String(sql);
    s = s.replace(/CREATE\s+(UNIQUE\s+)?INDEX\s+(IF\s+NOT\s+EXISTS\s+)?/i, (m, uniq) =>
      `CREATE ${uniq || ''}INDEX IF NOT EXISTS `
    );
    // Qualify table name roughly
    s = s.replace(new RegExp(`\\bON\\s+${tbl}\\b`, 'i'), `ON public.${qIdent(targetTbl)}`);
    s = s.replace(new RegExp(`\\bON\\s+"${tbl}"\\b`, 'i'), `ON public.${qIdent(targetTbl)}`);
    // Fix datetime functions if any
    s = s.replace(/datetime\('now'\)/gi, 'now()');
    lines.push(s + ';');
  }
  lines.push('');

  const schemaPath = path.join(outDir, '01_schema.sql');
  fs.writeFileSync(schemaPath, lines.join('\n'));
  console.log('wrote', schemaPath, 'tables', tables.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

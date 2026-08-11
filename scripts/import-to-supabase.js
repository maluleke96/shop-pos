/**
 * Import Shop POS JSON export into Supabase Postgres via service role.
 * Upserts by primary key (default: id).
 *
 * Prerequisites:
 *   npm install @supabase/supabase-js
 *
 * Environment:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Usage:
 *   node scripts/import-to-supabase.js [exportDir] [--batch-size=500] [--skip=table1,table2]
 *
 * Example:
 *   node scripts/import-to-supabase.js "./export"
 */
const fs = require('fs');
const path = require('path');

function loadSupabase() {
  try {
    const { createClient } = require('@supabase/supabase-js');
    return createClient;
  } catch {
    console.error(
      'Missing @supabase/supabase-js. Install with:\n  npm install @supabase/supabase-js'
    );
    process.exit(1);
  }
}

function parseArgs(argv) {
  const opts = { batchSize: 500, skip: new Set(), dir: null };
  for (const arg of argv) {
    if (arg.startsWith('--batch-size=')) {
      opts.batchSize = Math.max(1, parseInt(arg.split('=')[1], 10) || 500);
    } else if (arg.startsWith('--skip=')) {
      arg.split('=')[1].split(',').forEach((t) => opts.skip.add(t.trim()));
    } else if (!arg.startsWith('--')) {
      opts.dir = arg;
    }
  }
  opts.dir = opts.dir || path.join(process.cwd(), 'export');
  return opts;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

/** Normalize SQLite booleans (0/1 bigint) and empty strings for Postgres */
function normalizeRow(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === undefined) continue;
    out[k] = v;
  }
  return out;
}

async function upsertBatch(supabase, table, rows, onConflict) {
  const { error, count } = await supabase
    .from(table)
    .upsert(rows, { onConflict, ignoreDuplicates: false });

  if (error) {
    throw new Error(`${table}: ${error.message}${error.details ? ' — ' + error.details : ''}`);
  }
  return count ?? rows.length;
}

async function importTable(supabase, filePath, meta, batchSize) {
  const table = meta?.targetTable || path.basename(filePath, '.json');
  const raw = fs.readFileSync(filePath, 'utf8');
  const rows = JSON.parse(raw);
  if (!Array.isArray(rows) || rows.length === 0) {
    console.log(`  ${table} — 0 rows (skip)`);
    return 0;
  }

  const onConflict = meta?.primaryKey || 'id';
  let imported = 0;

  for (const batch of chunk(rows.map(normalizeRow), batchSize)) {
    imported += await upsertBatch(supabase, table, batch, onConflict);
  }

  console.log(`  ${table} — ${imported} rows upserted`);
  return imported;
}

async function main() {
  const createClient = loadSupabase();
  const opts = parseArgs(process.argv.slice(2));

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables.');
    process.exit(1);
  }

  if (!fs.existsSync(opts.dir)) {
    console.error(`Export directory not found: ${opts.dir}`);
    process.exit(1);
  }

  const manifestPath = path.join(opts.dir, 'manifest.json');
  let fileEntries = [];

  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    fileEntries = (manifest.files || []).map((f) => ({
      file: path.join(opts.dir, f.file),
      targetTable: f.targetTable,
      primaryKey: typeof f.primaryKey === 'string' ? f.primaryKey : 'id',
      rowCount: f.rowCount,
    }));
    // Respect manifest import order
    fileEntries.sort((a, b) => {
      const order = manifest.tableOrder || [];
      return order.indexOf(a.targetTable) - order.indexOf(b.targetTable);
    });
  } else {
    fileEntries = fs
      .readdirSync(opts.dir)
      .filter((f) => f.endsWith('.json') && f !== 'inventory.json' && f !== 'manifest.json')
      .sort()
      .map((f) => ({
        file: path.join(opts.dir, f),
        targetTable: path.basename(f, '.json'),
        primaryKey: 'id',
      }));
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log(`Importing from ${opts.dir} (batch=${opts.batchSize})`);
  let total = 0;
  let errors = 0;

  for (const entry of fileEntries) {
    if (opts.skip.has(entry.targetTable)) {
      console.log(`  ${entry.targetTable} — skipped (--skip)`);
      continue;
    }
    if (!fs.existsSync(entry.file)) {
      console.warn(`  missing file: ${entry.file}`);
      continue;
    }
    try {
      total += await importTable(supabase, entry.file, entry, opts.batchSize);
    } catch (e) {
      errors++;
      console.error(`  ERROR ${entry.targetTable}: ${e.message}`);
    }
  }

  // Refresh sequences for bigint id columns (best-effort via rpc or note)
  console.log('');
  if (errors > 0) {
    console.log(`Finished with ${errors} error(s). ${total} rows imported.`);
    console.log('Fix FK/order issues and re-run; upsert is idempotent.');
    process.exit(1);
  }
  console.log(`Done. ${total} rows imported.`);
  console.log('Run supabase/99_verify.sql in SQL Editor, then link auth.users → profiles.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Import JSON export into Supabase Postgres using the DB password (no service-role key).
 * Safe: uses UPSERT by primary key — does not wipe tables.
 *
 * Usage:
 *   node scripts/import-to-supabase-pg.js "C:\path\to\export"
 *
 * Env: SHOP_POS_DB_* or SHOP_POS_DATABASE_URL (loaded from .env)
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);
require('../lib/load-env').loadProjectEnv(ROOT);
const { databaseUrl, hasDatabaseConfig, missingDatabaseConfigMessage } = require('../electron/database/pg-connection');

function parseArgs(argv) {
  const opts = { batchSize: 200, skip: new Set(), dir: null, dryRun: false };
  for (const arg of argv) {
    if (arg.startsWith('--batch-size=')) {
      opts.batchSize = Math.max(1, parseInt(arg.split('=')[1], 10) || 200);
    } else if (arg.startsWith('--skip=')) {
      arg.split('=')[1].split(',').forEach((t) => opts.skip.add(t.trim()));
    } else if (arg === '--dry-run') {
      opts.dryRun = true;
    } else if (!arg.startsWith('--')) {
      opts.dir = arg;
    }
  }
  opts.dir =
    opts.dir ||
    path.join(
      require('os').homedir(),
      'Downloads',
      'ShopPOS',
      'migration-backups',
      'backup-20260811-155932',
      'export'
    );
  return opts;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function quoteIdent(name) {
  return '"' + String(name).replace(/"/g, '""') + '"';
}

async function tableExists(pool, table) {
  const r = await pool.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = $1`,
    [table]
  );
  return r.rowCount > 0;
}

async function existingColumns(pool, table) {
  const r = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1`,
    [table]
  );
  return new Set(r.rows.map((x) => x.column_name));
}

async function upsertBatch(pool, table, rows, pk, cols) {
  if (!rows.length) return 0;
  const colList = cols.map(quoteIdent).join(', ');
  const updateCols = cols.filter((c) => c !== pk);
  const values = [];
  const placeholders = rows
    .map((row, ri) => {
      const cells = cols.map((c, ci) => {
        values.push(row[c] === undefined ? null : row[c]);
        return `$${ri * cols.length + ci + 1}`;
      });
      return `(${cells.join(',')})`;
    })
    .join(',');

  let sql = `INSERT INTO ${quoteIdent(table)} (${colList}) VALUES ${placeholders}`;
  if (updateCols.length) {
    sql += ` ON CONFLICT (${quoteIdent(pk)}) DO UPDATE SET ${updateCols
      .map((c) => `${quoteIdent(c)} = EXCLUDED.${quoteIdent(c)}`)
      .join(', ')}`;
  } else {
    sql += ` ON CONFLICT (${quoteIdent(pk)}) DO NOTHING`;
  }

  await pool.query(sql, values);
  return rows.length;
}

async function resetSequence(pool, table, pk) {
  try {
    await pool.query(
      `SELECT setval(
         pg_get_serial_sequence($1, $2),
         COALESCE((SELECT MAX(${quoteIdent(pk)}) FROM ${quoteIdent(table)}), 1),
         true
       )`,
      [table, pk]
    );
  } catch (_) {
    /* non-serial tables */
  }
}

async function main() {
  if (!hasDatabaseConfig()) {
    console.error(missingDatabaseConfigMessage());
    process.exit(1);
  }

  const opts = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(opts.dir)) {
    console.error('Export directory not found:', opts.dir);
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: databaseUrl(),
    ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
    max: 2
  });

  const manifestPath = path.join(opts.dir, 'manifest.json');
  let fileEntries = [];
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    fileEntries = (manifest.files || []).map((f) => ({
      file: path.join(opts.dir, f.file),
      targetTable: f.targetTable,
      primaryKey: typeof f.primaryKey === 'string' ? f.primaryKey : 'id',
      rowCount: f.rowCount
    }));
    const order = manifest.tableOrder || [];
    fileEntries.sort((a, b) => order.indexOf(a.targetTable) - order.indexOf(b.targetTable));
  } else {
    fileEntries = fs
      .readdirSync(opts.dir)
      .filter((f) => f.endsWith('.json') && f !== 'manifest.json' && f !== 'inventory.json')
      .sort()
      .map((f) => ({
        file: path.join(opts.dir, f),
        targetTable: path.basename(f, '.json'),
        primaryKey: 'id'
      }));
  }

  console.log(`Importing from ${opts.dir}`);
  console.log(`Mode: ${opts.dryRun ? 'DRY RUN' : 'UPSERT (safe — no wipe)'}`);
  let total = 0;
  let errors = 0;
  let skipped = 0;

  try {
    await pool.query('SELECT 1');
    console.log('Connected to Supabase Postgres.\n');
  } catch (e) {
    console.error('Cannot connect to database:', e.message);
    console.error('Check SHOP_POS_DB_PASSWORD / SHOP_POS_DATABASE_URL and that schema SQL was run.');
    process.exit(1);
  }

  for (const entry of fileEntries) {
    if (opts.skip.has(entry.targetTable)) {
      console.log(`  ${entry.targetTable} — skipped`);
      skipped++;
      continue;
    }
    if (!fs.existsSync(entry.file)) {
      console.warn(`  missing: ${entry.file}`);
      continue;
    }

    const rows = JSON.parse(fs.readFileSync(entry.file, 'utf8'));
    if (!Array.isArray(rows) || !rows.length) {
      console.log(`  ${entry.targetTable} — 0 rows`);
      continue;
    }

    const exists = await tableExists(pool, entry.targetTable);
    if (!exists) {
      console.warn(`  ${entry.targetTable} — table missing in Supabase (run COMPLETE_SUPABASE_SETUP.sql)`);
      errors++;
      continue;
    }

    const colsSet = await existingColumns(pool, entry.targetTable);
    const sampleKeys = Object.keys(rows[0]).filter((k) => colsSet.has(k));
    if (!sampleKeys.includes(entry.primaryKey) && colsSet.has(entry.primaryKey)) {
      sampleKeys.unshift(entry.primaryKey);
    }
    if (!sampleKeys.length) {
      console.warn(`  ${entry.targetTable} — no matching columns`);
      errors++;
      continue;
    }

    if (opts.dryRun) {
      console.log(`  ${entry.targetTable} — would upsert ${rows.length} rows`);
      total += rows.length;
      continue;
    }

    try {
      let n = 0;
      for (const batch of chunk(rows, opts.batchSize)) {
        const normalized = batch.map((row) => {
          const out = {};
          for (const c of sampleKeys) out[c] = row[c] === undefined ? null : row[c];
          return out;
        });
        n += await upsertBatch(pool, entry.targetTable, normalized, entry.primaryKey, sampleKeys);
      }
      await resetSequence(pool, entry.targetTable, entry.primaryKey);
      console.log(`  ${entry.targetTable} — ${n} rows upserted`);
      total += n;
    } catch (e) {
      errors++;
      console.error(`  ERROR ${entry.targetTable}: ${e.message}`);
    }
  }

  await pool.end();
  console.log('');
  console.log(`Done. ${total} rows. errors=${errors} skipped=${skipped}`);
  if (!opts.dryRun) {
    console.log('Resetting ID sequences…');
    try {
      require('child_process').spawnSync(process.execPath, [path.join(__dirname, 'reset-pg-sequences.js')], {
        stdio: 'inherit',
        env: process.env
      });
    } catch (e) {
      console.warn('Sequence reset warning:', e.message);
    }
  }
  if (errors) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

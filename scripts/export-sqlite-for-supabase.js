/**
 * Export Shop POS SQLite database to JSON files for Supabase import.
 *
 * - One JSON array per table in the output folder
 * - Writes inventory.json + manifest.json
 * - Renames archive tables: online_orders_local → legacy_online_orders_local,
 *   sync_outbox → legacy_sync_outbox
 *
 * Usage:
 *   node scripts/export-sqlite-for-supabase.js <shop-pos.db> [outDir]
 *
 * Example:
 *   node scripts/export-sqlite-for-supabase.js "C:\ShopPOS\shop-pos.db" "./export"
 */
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const ARCHIVE_RENAMES = {
  online_orders_local: 'legacy_online_orders_local',
  sync_outbox: 'legacy_sync_outbox',
};

const JSON_COLUMN_PATTERN = /(_json$|^permissions$|^cart_data$|settings$|_settings$|condition_json|action_json|notification_settings)/i;

function targetTableName(sqliteName) {
  return ARCHIVE_RENAMES[sqliteName] || sqliteName;
}

function qIdent(name) {
  return '"' + String(name).replace(/"/g, '""') + '"';
}

function maybeParseJson(value, colName) {
  if (value == null || value === '') return value;
  if (!JSON_COLUMN_PATTERN.test(colName)) return value;
  if (typeof value === 'object') return value;
  const s = String(value).trim();
  if (!s) return value;
  if (s.startsWith('{') || s.startsWith('[')) {
    try {
      return JSON.parse(s);
    } catch {
      return value;
    }
  }
  return value;
}

function rowToObject(columns, values) {
  const row = {};
  for (let i = 0; i < columns.length; i++) {
    const col = columns[i];
    row[col] = maybeParseJson(values[i], col);
  }
  return row;
}

/** Topological-ish order: tables with no outgoing FKs first, then dependents */
function sortTablesForImport(db, tableNames) {
  const fkMap = {};
  for (const name of tableNames) {
    const safe = name.replace(/"/g, '""');
    const fk = db.exec(`PRAGMA foreign_key_list("${safe}")`);
    fkMap[name] = (fk[0] && fk[0].values.map((r) => r[2])) || [];
  }
  const sorted = [];
  const remaining = new Set(tableNames);
  let guard = 0;
  while (remaining.size > 0 && guard < tableNames.length * 3) {
    guard++;
    let progressed = false;
    for (const t of [...remaining]) {
      const refs = fkMap[t] || [];
      const unresolved = refs.filter((r) => remaining.has(r) && r !== t);
      if (unresolved.length === 0) {
        sorted.push(t);
        remaining.delete(t);
        progressed = true;
      }
    }
    if (!progressed) {
      sorted.push(...remaining);
      break;
    }
  }
  return sorted;
}

async function main() {
  const dbPath = process.argv[2];
  const outDir = process.argv[3] || path.join(process.cwd(), 'export');

  if (!dbPath || !fs.existsSync(dbPath)) {
    console.error('Usage: node scripts/export-sqlite-for-supabase.js <shop-pos.db> [outDir]');
    process.exit(1);
  }

  fs.mkdirSync(outDir, { recursive: true });

  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(dbPath));

  const tableRows = db.exec(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  );
  const sqliteTables = (tableRows[0] && tableRows[0].values.map((r) => r[0])) || [];
  const importOrder = sortTablesForImport(db, sqliteTables);

  const inventory = {
    source: path.resolve(dbPath),
    sizeBytes: fs.statSync(dbPath).size,
    exportedAt: new Date().toISOString(),
    tableCount: sqliteTables.length,
    totalRows: 0,
    tables: {},
    columns: {},
    renames: { ...ARCHIVE_RENAMES },
  };

  const manifest = {
    exportedAt: inventory.exportedAt,
    source: inventory.source,
    tableOrder: importOrder.map(targetTableName),
    files: [],
  };

  console.log(`Exporting ${sqliteTables.length} tables → ${outDir}`);

  for (const sqliteTable of sqliteTables) {
    const target = targetTableName(sqliteTable);
    const safe = sqliteTable.replace(/"/g, '""');

    let columns = [];
    try {
      const info = db.exec(`PRAGMA table_info("${safe}")`);
      columns = (info[0] && info[0].values.map((r) => r[1])) || [];
      inventory.columns[sqliteTable] = (info[0] && info[0].values.map((r) => ({
        name: r[1],
        type: r[2],
        notnull: r[3],
        dflt_value: r[4],
        pk: r[5],
      }))) || [];
    } catch (e) {
      inventory.columns[sqliteTable] = { error: e.message };
    }

    let rows = [];
    try {
      const result = db.exec(`SELECT * FROM ${qIdent(sqliteTable)}`);
      if (result[0]) {
        const cols = result[0].columns;
        rows = result[0].values.map((vals) => rowToObject(cols, vals));
      }
      inventory.tables[sqliteTable] = rows.length;
      inventory.totalRows += rows.length;
    } catch (e) {
      inventory.tables[sqliteTable] = { error: e.message };
      console.warn(`  skip ${sqliteTable}: ${e.message}`);
      continue;
    }

    const outFile = path.join(outDir, `${target}.json`);
    fs.writeFileSync(outFile, JSON.stringify(rows, null, 0));
    const pkCol = (inventory.columns[sqliteTable] || []).find((c) => c.pk === 1);
    manifest.files.push({
      sqliteTable,
      targetTable: target,
      file: `${target}.json`,
      rowCount: rows.length,
      primaryKey: pkCol ? pkCol.name : 'id',
    });

    const renameNote = sqliteTable !== target ? ` (${sqliteTable} → ${target})` : '';
    console.log(`  ${target}.json — ${rows.length} rows${renameNote}`);
  }

  fs.writeFileSync(path.join(outDir, 'inventory.json'), JSON.stringify(inventory, null, 2));
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  console.log('');
  console.log(`Done. tables=${inventory.tableCount} totalRows=${inventory.totalRows}`);
  console.log(`inventory → ${path.join(outDir, 'inventory.json')}`);
  console.log(`manifest  → ${path.join(outDir, 'manifest.json')}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

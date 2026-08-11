/**
 * Read-only inventory of a Shop POS SQLite DB.
 * Usage: node scripts/inventory-sqlite.js <path-to-shop-pos.db> [out.json]
 */
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

async function main() {
  const dbPath = process.argv[2];
  if (!dbPath || !fs.existsSync(dbPath)) {
    console.error('Usage: node scripts/inventory-sqlite.js <shop-pos.db> [out.json]');
    process.exit(1);
  }
  const outPath = process.argv[3] || path.join(path.dirname(dbPath), 'inventory.json');
  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(dbPath));

  const names = db.exec(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  );
  const tables = (names[0] && names[0].values.map((r) => r[0])) || [];
  const inv = {
    source: path.resolve(dbPath),
    sizeBytes: fs.statSync(dbPath).size,
    inventoriedAt: new Date().toISOString(),
    tableCount: tables.length,
    tables: {},
    columns: {},
    totalRows: 0
  };

  for (const t of tables) {
    const safe = t.replace(/"/g, '""');
    try {
      const c = db.exec(`SELECT COUNT(*) FROM "${safe}"`);
      const n = (c[0] && c[0].values[0][0]) || 0;
      inv.tables[t] = n;
      inv.totalRows += n;
    } catch (e) {
      inv.tables[t] = { error: e.message };
    }
    try {
      const info = db.exec(`PRAGMA table_info("${safe}")`);
      inv.columns[t] = (info[0] && info[0].values.map((r) => ({
        cid: r[0],
        name: r[1],
        type: r[2],
        notnull: r[3],
        dflt_value: r[4],
        pk: r[5]
      }))) || [];
    } catch (e) {
      inv.columns[t] = { error: e.message };
    }
  }

  fs.writeFileSync(outPath, JSON.stringify(inv, null, 2));
  console.log(`tables=${inv.tableCount} totalRows=${inv.totalRows}`);
  console.log(`wrote ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

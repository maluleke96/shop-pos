const initSqlJs = require('sql.js/dist/sql-asm.js');
const fs = require('fs');
const path = require('path');
const os = require('os');

const p = path.join(os.homedir(), 'AppData', 'Roaming', 'ShopPOS', 'Shared', 'shop-pos.db');
if (!fs.existsSync(p)) {
  console.log(JSON.stringify({ found: false }));
  process.exit(0);
}
initSqlJs().then((SQL) => {
  const db = new SQL.Database(fs.readFileSync(p));
  const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'acc_%'");
  let journals = 0;
  try {
    journals = db.exec('SELECT COUNT(*) FROM acc_journals')[0].values[0][0];
  } catch (_) { /* */ }
  console.log(JSON.stringify({
    found: true,
    path: p,
    acc_tables: (tables[0] && tables[0].values || []).length,
    local_journals: journals
  }));
  db.close();
});

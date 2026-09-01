const initSqlJs = require('sql.js/dist/sql-asm.js');
const fs = require('fs');
const path = require('path');
const os = require('os');
const p = path.join(os.homedir(), 'AppData', 'Roaming', 'ShopPOS', 'Shared', 'shop-pos.db');
initSqlJs().then((SQL) => {
  const db = new SQL.Database(fs.readFileSync(p));
  const users = db.exec('SELECT id, username, role, full_name FROM users');
  const j1 = db.exec("SELECT * FROM acc_journals WHERE reference='RCP-20260826-00002'");
  const j2 = db.exec("SELECT * FROM acc_journals WHERE reference='RCP-20260826-00001'");
  const s1 = db.exec("SELECT * FROM sales WHERE receipt_number='RCP-20260826-00002'");
  const s2 = db.exec("SELECT * FROM sales WHERE receipt_number='RCP-20260826-00001'");
  const cols = (r) => (r[0] ? r[0].columns.reduce((o, c, i) => ({ ...o, [c]: r[0].values[0][i] }), {}) : null);
  console.log(JSON.stringify({
    users: users[0]?.values,
    journal1: cols(j1),
    journal2: cols(j2),
    sale1: cols(s1),
    sale2: cols(s2)
  }, null, 2));
});

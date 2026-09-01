const initSqlJs = require('sql.js/dist/sql-asm.js');
const fs = require('fs');
const path = require('path');
const os = require('os');
const p = path.join(os.homedir(), 'AppData', 'Roaming', 'ShopPOS', 'Shared', 'shop-pos.db');
initSqlJs().then((SQL) => {
  const db = new SQL.Database(fs.readFileSync(p));
  const q = (sql) => {
    const r = db.exec(sql);
    if (!r[0]) return [];
    return r[0].values.map((v) => Object.fromEntries(r[0].columns.map((c, i) => [c, v[i]])));
  };
  console.log(JSON.stringify({
    shift5: q('SELECT * FROM shifts WHERE id=5'),
    cashup5: q('SELECT * FROM cashup_sessions WHERE shift_id=5'),
    latest_cashup: q('SELECT * FROM cashup_sessions ORDER BY id DESC LIMIT 1'),
    cashup_outbox: q("SELECT id,entity_id,synced_at,error FROM sync_outbox WHERE entity_type='acc_integrate' AND payload LIKE '%postFromCashup%' ORDER BY id DESC LIMIT 10"),
    sales: q('SELECT id,receipt_number,total,notes FROM sales ORDER BY id DESC LIMIT 3'),
    pays: q('SELECT * FROM sale_payments ORDER BY id DESC LIMIT 6'),
    outbox: q("SELECT id,entity_type,synced_at,error FROM sync_outbox WHERE entity_type='acc_integrate' ORDER BY id DESC LIMIT 8")
  }, null, 2));
});

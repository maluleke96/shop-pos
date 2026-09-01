const initSqlJs = require('sql.js/dist/sql-asm.js');
const fs = require('fs');
const path = require('path');
const os = require('os');
const p = path.join(os.homedir(), 'AppData', 'Roaming', 'ShopPOS', 'Shared', 'shop-pos.db');
initSqlJs().then((SQL) => {
  const db = new SQL.Database(fs.readFileSync(p));
  const q = (s) => {
    const r = db.exec(s);
    if (!r[0]) return [];
    return r[0].values.map((v) => Object.fromEntries(r[0].columns.map((c, i) => [c, v[i]])));
  };
  console.log(JSON.stringify({
    orders: q("SELECT id, remote_id, order_number, status, order_source, sale_id, total FROM online_orders_local WHERE order_number LIKE 'ONLINE-%' ORDER BY id"),
    sales: q('SELECT id, receipt_number, total, order_type, order_source, notes FROM sales ORDER BY id DESC LIMIT 8'),
    outbox: q("SELECT id, entity_type, entity_id, synced_at, substr(payload,1,80) AS payload FROM sync_outbox ORDER BY id DESC LIMIT 5")
  }, null, 2));
});

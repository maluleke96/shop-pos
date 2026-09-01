/**
 * Remaining live verification helper — local DB + Railway RPC.
 */
const initSqlJs = require('sql.js/dist/sql-asm.js');
const fs = require('fs');
const path = require('path');
const os = require('os');

const BASE = process.env.SMOKE_URL || 'https://peaceful-motivation-production-7dd2.up.railway.app';
const LOCAL_DB = path.join(os.homedir(), 'AppData', 'Roaming', 'ShopPOS', 'Shared', 'shop-pos.db');

async function rpc(method, args, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['X-Session-Token'] = token;
  const r = await fetch(`${BASE}/rpc`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ method, args: args || [] })
  });
  const data = await r.json().catch(() => ({}));
  const tok = r.headers.get('X-Session-Token') || data.sessionToken || token;
  return { status: r.status, data, token: tok };
}

async function inspectLocalDb() {
  if (!fs.existsSync(LOCAL_DB)) {
    return { found: false, path: LOCAL_DB };
  }
  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(LOCAL_DB));
  const q = (sql) => {
    try {
      const r = db.exec(sql);
      return (r[0] && r[0].values) || [];
    } catch (e) {
      return { error: e.message };
    }
  };
  const out = {
    found: true,
    path: LOCAL_DB,
    users: q('SELECT id, username, role, full_name FROM users'),
    acc_tables: q("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'acc_%'"),
    journals: q('SELECT id, journal_number, journal_date, description, source_type, source_id, reference, notes, total_debit, total_credit FROM acc_journals ORDER BY id'),
    online_orders: q("SELECT id, order_number, status, order_source, sale_id, total FROM online_orders_local WHERE order_number LIKE 'ONLINE-%' ORDER BY id DESC LIMIT 10"),
    sync_outbox: q("SELECT id, entity_type, entity_id, synced_at, substr(payload,1,120) FROM sync_outbox WHERE entity_type='acc_integrate' ORDER BY id DESC LIMIT 10"),
    recent_sales: q('SELECT id, receipt_number, total, order_type, order_source, notes FROM sales ORDER BY id DESC LIMIT 5')
  };
  out.acc_table_count = Array.isArray(out.acc_tables) ? out.acc_tables.length : 0;
  db.close();
  return out;
}

async function main() {
  const health = await fetch(`${BASE}/health`).then((r) => r.json());
  console.log('HEALTH', JSON.stringify(health));

  const local = await inspectLocalDb();
  console.log('LOCAL_DB', JSON.stringify(local, null, 2));

  const user = process.env.SMOKE_USER || 'chisa96';
  const pass = process.env.SMOKE_PASS || process.env.SHOP_POS_SMOKE_PASS || '';
  if (!pass) {
    console.log('NO_SMOKE_PASS — set SMOKE_PASS to run cloud RPC tests');
    return;
  }

  const login = await rpc('auth:login', [user, pass]);
  console.log('LOGIN', JSON.stringify({ ok: login.data?.success, user: login.data?.data?.user || login.data?.user, error: login.data?.error }));
  if (!login.data?.success && login.data?.data?.success !== true) return;
  const token = login.token;

  const orders = await rpc('web:adminOrders', [{ status: 'pending' }, { id: 2, username: user, role: 'owner' }], token);
  console.log('PENDING_ORDERS', JSON.stringify(orders.data, null, 2));

  const allOrders = await rpc('web:adminOrders', [{}], token);
  console.log('ALL_ORDERS_SAMPLE', JSON.stringify(allOrders.data?.data?.slice?.(0, 5) || allOrders.data, null, 2));

  const journals = await rpc('acc:journals', [{ limit: 20 }, { id: 2, username: user, role: 'owner' }], token);
  console.log('CENTRAL_JOURNALS', JSON.stringify(journals.data, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

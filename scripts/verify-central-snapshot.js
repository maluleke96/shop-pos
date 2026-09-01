/** Central ledger snapshot via live Railway RPC (no local Postgres boot). */
const path = require('path');
require('../lib/load-env').loadProjectEnv(path.join(__dirname, '..'));

const BASE = (process.env.SMOKE_URL || 'https://peaceful-motivation-production-7dd2.up.railway.app').replace(/\/$/, '');
const ACTOR = { id: 2, username: 'chisa96', role: 'owner', full_name: 'chisa96' };

async function rpc(method, args, token, ms = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['X-Session-Token'] = token;
    const r = await fetch(`${BASE}/rpc`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ method, args: args || [] }),
      signal: ctrl.signal
    });
    const data = await r.json().catch(() => ({}));
    const tok = r.headers.get('X-Session-Token') || data.sessionToken || token;
    return { data, token: tok };
  } finally {
    clearTimeout(t);
  }
}

(async () => {
  let token = '';
  const pass = process.env.SMOKE_PASS || process.env.SHOP_POS_DB_PASSWORD || '';
  if (pass) {
    const login = await rpc('auth:login', ['chisa96', pass], '', 25000);
    if (login.data?.success) token = login.token;
  }

  const orders = (await rpc('web:adminOrders', [{}, ACTOR], token)).data?.data || [];
  const journals = (await rpc('acc:journals', [{ limit: 100 }, ACTOR], token)).data?.data || [];

  const integrity = {};
  const payloads = [
    { hook: 'postFromSale', stable_source_id: 992001, snapshot: { sale: { id: 992001, total: 11, tax_amount: 0, receipt_number: 'V2-SALE', created_at: '2026-08-29' }, items: [{ quantity: 1, buying_price: 2 }], payments: [{ method: 'cash', amount: 11 }] } },
    { hook: 'postFromExpense', local_id: 992002, snapshot: { expense: { id: 992002, amount: 6, expense_date: '2026-08-29', category: 'Test', description: 'V2-EXP', payment_method: 'cash' } } }
  ];
  for (const p of payloads) {
    const a = await rpc('acc:integrate', [p], token);
    const b = await rpc('acc:integrate', [p], token);
    integrity[p.hook] = { ok: a.data?.success !== false, id1: a.data?.data?.id, id2: b.data?.data?.id, dup: a.data?.data?.id === b.data?.data?.id };
  }
  integrity.allOk = Object.values(integrity).filter((v) => typeof v === 'object').every((x) => x.ok && x.dup);

  const onlineJournal = journals.find((j) => String(j.reference || '').includes('ONLINE-1002'));
  process.stdout.write(JSON.stringify({ orders, journals, integrity, onlineJournal, login_ok: !!token }));
})().catch((e) => {
  process.stderr.write(String(e.stack || e));
  process.exit(1);
});

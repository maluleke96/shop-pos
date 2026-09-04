const path = require('path');
const ROOT = path.join(__dirname, '..');
require('../lib/load-env').loadProjectEnv(ROOT);
const BASE = (process.env.SMOKE_URL || 'https://chisafood.up.railway.app').replace(/\/$/, '');

async function rpc(method, args, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['X-Session-Token'] = token;
  const r = await fetch(`${BASE}/rpc`, {
    method: 'POST', headers,
    body: JSON.stringify({ method, args: args || [] })
  });
  const data = await r.json().catch(() => ({}));
  return { data, token: r.headers.get('X-Session-Token') || data.sessionToken || token };
}

(async () => {
  const login = await rpc('auth:login', ['chisa96', process.env.SMOKE_PASS || process.env.SHOP_POS_DB_PASSWORD || '']);
  const token = login.token;
  const journals = await rpc('acc:journals', [{ limit: 100 }], token);
  const cashupJ = (journals.data?.data || []).filter((j) => j.source_type === 'cashup' || String(j.description || '').includes('Cash-up'));
  const saleJ = (journals.data?.data || []).filter((j) => String(j.reference || '').includes('RCP-20260829-00008'));
  console.log(JSON.stringify({
    login: login.data?.success,
    cashup_journals: cashupJ,
    latest_sale_journal: saleJ[0] || null,
    journal_count: journals.data?.data?.length
  }, null, 2));
})();

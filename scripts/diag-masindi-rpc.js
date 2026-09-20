#!/usr/bin/env node
const B = 'https://chisafood.up.railway.app';
async function rpc(method, args, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['X-Session-Token'] = token;
  const r = await fetch(`${B}/rpc`, { method: 'POST', headers, body: JSON.stringify({ method, args }) });
  const j = await r.json();
  return { j, token: r.headers.get('X-Session-Token') || j.sessionToken || token };
}

(async () => {
  const user = process.argv[2] || 'chisa96';
  const pass = process.argv[3] || '123456';
  const login = await rpc('auth:login', [user, pass]);
  if (!login.j.success) {
    console.error('LOGIN FAILED', login.j);
    process.exit(1);
  }
  const t = login.token;
  const customerId = 24;

  const hist = await rpc('loyalty:history', [customerId], t);
  console.log('LOYALTY HISTORY:', JSON.stringify(hist.j, null, 2));

  const summary = await rpc('audit:customerSummary', [customerId], t);
  console.log('CUSTOMER SUMMARY:', JSON.stringify(summary.j, null, 2));

  const sales = await rpc('audit:salesList', [{ search: 'Masindi', limit: 20 }], t);
  console.log('SALES SEARCH Masindi:', JSON.stringify(sales.j, null, 2));

  const sales2 = await rpc('audit:salesList', [{ customer_id: customerId, limit: 20 }], t);
  console.log('SALES customer_id 24:', JSON.stringify(sales2.j, null, 2));

  const settings = await rpc('settings:getParsed', [], t);
  const ls = settings.j.data?.loyalty_settings || settings.j.loyalty_settings;
  console.log('LOYALTY SETTINGS:', JSON.stringify(ls, null, 2));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

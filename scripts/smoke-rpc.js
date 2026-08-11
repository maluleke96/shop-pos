/**
 * Smoke-test Shop POS RPC against a running server (local or Railway).
 * Usage:
 *   node scripts/smoke-rpc.js
 *   node scripts/smoke-rpc.js http://localhost:3000
 *   $env:SMOKE_USER="owner"; $env:SMOKE_PASS="..."; node scripts/smoke-rpc.js
 */
const base = (process.argv[2] || process.env.SMOKE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');

async function rpc(method, args, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['X-Session-Token'] = token;
  const r = await fetch(base + '/rpc', {
    method: 'POST',
    headers,
    body: JSON.stringify({ method, args: args || [] })
  });
  const data = await r.json().catch(() => ({}));
  const tok = r.headers.get('X-Session-Token') || data.sessionToken || token;
  return { status: r.status, data, token: tok };
}

async function main() {
  console.log('Smoke against', base);
  const health = await fetch(base + '/health').then((r) => r.json());
  console.log('health:', health);

  const user = process.env.SMOKE_USER || process.env.SHOP_POS_SMOKE_USER || '';
  const pass = process.env.SMOKE_PASS || process.env.SHOP_POS_SMOKE_PASS || '';
  if (!user || !pass) {
    console.log('Set SMOKE_USER and SMOKE_PASS to test login + products.');
    console.log('Partial smoke OK (health).');
    return;
  }

  const login = await rpc('auth:login', [user, pass]);
  console.log('login success:', !!(login.data && login.data.success));
  if (!login.data || !login.data.success) {
    console.error('login failed:', login.data);
    process.exit(1);
  }
  const token = login.token;
  const settings = await rpc('settings:getParsed', [], token);
  console.log('settings:', !!(settings.data && settings.data.success));
  const products = await rpc('products:get', [], token);
  const list = (products.data && products.data.data) || products.data || [];
  console.log('products count:', Array.isArray(list) ? list.length : 'n/a', products.data && products.data.success);
  console.log('Smoke OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

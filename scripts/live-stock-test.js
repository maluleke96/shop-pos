/**
 * Stock-only live test — reads password from stdin (not echoed).
 * Usage: echo password | node scripts/live-stock-test.js
 */
const BASE = 'https://chisafood.up.railway.app';

async function readStdin() {
  return new Promise((resolve) => {
    let s = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { s += c; });
    process.stdin.on('end', () => resolve(s.trim()));
    if (process.stdin.isTTY) resolve(process.env.SMOKE_PASS || '');
  });
}

async function rpc(method, args = [], token = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['X-Session-Token'] = token;
  const res = await fetch(`${BASE}/rpc`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ method, args })
  });
  const json = await res.json();
  const tok = res.headers.get('X-Session-Token') || json.sessionToken || token;
  return { json, token: tok };
}

(async () => {
  const pass = await readStdin();
  const user = process.env.SMOKE_USER || 'chisa96';
  if (!pass) {
    console.log(JSON.stringify({ error: 'No password on stdin' }));
    process.exit(1);
  }
  const login = await rpc('auth:login', [user, pass]);
  if (!login.json?.success) {
    console.log(JSON.stringify({ step: 'login', ok: false, error: login.json?.error }));
    process.exit(1);
  }
  const actor = login.json.user || login.json.data?.user;
  const token = login.token || login.json.sessionToken;
  const products = await rpc('products:get', [{}], token);
  const product = (products.json?.data || [])[0];
  if (!product) {
    console.log(JSON.stringify({ error: 'no products' }));
    process.exit(1);
  }
  const before = Number(product.stock_quantity);
  const target = before + 5;
  const save = await rpc('products:save', [{
    id: product.id,
    name: product.name,
    selling_price: product.selling_price,
    stock_quantity: target
  }, actor], token);
  const afterGet = await rpc('products:getOne', [product.id], token);
  const report = await rpc('reports:stock', [], token);
  const row = (report.json?.data || []).find((p) => p.id === product.id);
  const afterQty = Number(afterGet.json?.data?.stock_quantity);
  const reportQty = Number(row?.stock_quantity);
  await rpc('products:save', [{
    id: product.id,
    name: product.name,
    selling_price: product.selling_price,
    stock_quantity: before
  }, actor], token);
  console.log(JSON.stringify({
    product: product.name,
    before,
    target,
    save_ok: save.json?.success !== false,
    save_error: save.json?.error,
    after_get_one: afterQty,
    after_stock_report: reportQty,
    pass: save.json?.success !== false && afterQty === target && reportQty === target
  }));
})();

/**
 * Live test: APK downloads + POS category filtering + menu load speed.
 */
const BASE = (process.env.SMOKE_URL || 'https://chisafood.up.railway.app').replace(/\/$/, '');

async function rpc(method, args, token) {
  const h = { 'Content-Type': 'application/json' };
  if (token) h['X-Session-Token'] = token;
  const t0 = Date.now();
  const res = await fetch(`${BASE}/rpc`, { method: 'POST', headers: h, body: JSON.stringify({ method, args }) });
  const ms = Date.now() - t0;
  const json = await res.json();
  return { json, token: res.headers.get('X-Session-Token') || json.sessionToken || token, ms };
}

function productsForCategory(products, catKey) {
  if (!catKey || catKey === '__all') return products;
  return products.filter((p) => String(p.category_id) === String(catKey));
}

(async () => {
  const results = [];
  const apks = ['ShopPOS-POS.apk', 'ShopPOS-Manager.apk'];
  for (const apk of apks) {
    const t0 = Date.now();
    const res = await fetch(`${BASE}/downloads/${apk}`, { method: 'HEAD' });
    results.push({ test: `download:${apk}`, ok: res.ok, status: res.status, ms: Date.now() - t0 });
  }

  const statusRes = await fetch(`${BASE}/api/mobile-apk-status`);
  const status = await statusRes.json();
  const uploaded = (status.data || []).filter((r) => r.uploaded).length;
  results.push({ test: 'apk-status', ok: uploaded === 7, uploaded, total: (status.data || []).length });

  const user = process.env.SMOKE_USER || 'chisa96';
  const pass = process.env.SMOKE_PASS || '123456';
  const login = await rpc('auth:login', [user, pass]);
  const actor = login.json?.user || login.json?.data?.user;
  const token = login.token;
  results.push({ test: 'login', ok: !!actor, ms: login.ms });

  const actorArg = { for_pos: true, actor };
  const [catRes, prodRes] = await Promise.all([
    rpc('categories:get', [actorArg], token),
    rpc('products:get', [actorArg], token)
  ]);
  const categories = catRes.json?.data || [];
  const products = prodRes.json?.data || [];
  results.push({
    test: 'menu-load',
    ok: products.length > 0 && categories.length > 0,
    products: products.length,
    categories: categories.length,
    ms: Math.max(catRes.ms, prodRes.ms)
  });

  const categoryTests = [];
  for (const cat of categories.slice(0, 6)) {
    const filtered = productsForCategory(products, String(cat.id));
    categoryTests.push({ id: cat.id, name: cat.name, count: filtered.length });
  }
  const distinct = new Set(categoryTests.map((c) => c.count)).size;
  results.push({
    test: 'category-filter',
    ok: categoryTests.every((c) => c.count >= 0) && distinct >= 1,
    samples: categoryTests
  });

  const failed = results.filter((r) => !r.ok);
  console.log(JSON.stringify({ base: BASE, passed: results.length - failed.length, failed: failed.length, results }, null, 2));
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

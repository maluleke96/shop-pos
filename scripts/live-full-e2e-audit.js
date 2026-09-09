/**
 * Full live E2E audit — Admin, POS, Online Order, Manager panel wiring.
 * Usage: SMOKE_USER=chisa96 SMOKE_PASS=... node scripts/live-full-e2e-audit.js
 */
const BASE = (process.env.SMOKE_URL || 'https://chisafood.up.railway.app').replace(/\/$/, '');
const SLOW_MS = Number(process.env.SLOW_MS || 3000);

async function rpc(method, args = [], token = null, headers = {}) {
  const h = { 'Content-Type': 'application/json', ...headers };
  if (token) h['X-Session-Token'] = token;
  const t0 = Date.now();
  const res = await fetch(`${BASE}/rpc`, { method: 'POST', headers: h, body: JSON.stringify({ method, args }) });
  const ms = Date.now() - t0;
  const json = await res.json().catch(() => ({}));
  const tok = res.headers.get('X-Session-Token') || json.sessionToken || token;
  return { json, token: tok, status: res.status, ms };
}

function unwrap(d) {
  if (d == null) return d;
  if (Array.isArray(d)) return d;
  if (d.data != null) return d.data;
  return d;
}

function ok(r) {
  if (!r?.json) return false;
  if (r.json.success === false) return false;
  if (r.json.error) return false;
  return true;
}

const findings = [];
const summary = { tested: 0, passed: 0, failed: 0, warnings: 0, slow: 0 };

function record(name, detail = {}) {
  const f = { name, ok: !!detail.ok, severity: detail.severity || (detail.ok ? 'pass' : 'bug'), ...detail };
  findings.push(f);
  summary.tested++;
  if (f.ok) summary.passed++;
  else if (f.severity === 'warning') summary.warnings++;
  else summary.failed++;
  if (f.slow) summary.slow++;
}

async function testRpc(area, method, args, token, opts = {}) {
  const r = await rpc(method, args, token, opts.headers || {});
  const success = ok(r);
  const err = r.json?.error || (r.json?.success === false ? 'success=false' : null);
  const slow = r.ms > SLOW_MS;
  if (success) {
    record(`${area}:${method}`, { ok: true, ms: r.ms, slow, note: opts.note });
  } else if (err && /not found|unknown method|no such/i.test(String(err))) {
    record(`${area}:${method}`, { ok: false, severity: 'warning', error: err, ms: r.ms, note: 'method missing' });
  } else {
    record(`${area}:${method}`, { ok: false, error: err, ms: r.ms, status: r.status });
  }
  return { r, success, data: unwrap(r.json?.data ?? r.json) };
}

async function checkPage(path, mustContain = []) {
  const url = `${BASE}/${path.replace(/^\//, '')}`;
  const t0 = Date.now();
  const res = await fetch(url);
  const text = await res.text();
  const ms = Date.now() - t0;
  const missing = mustContain.filter((s) => !text.includes(s));
  record(`page:${path}`, {
    ok: res.ok && missing.length === 0,
    status: res.status,
    ms,
    missing: missing.length ? missing : undefined,
    severity: res.ok && missing.length ? 'bug' : (!res.ok ? 'critical' : 'pass')
  });
  return { ok: res.ok, text, ms };
}

(async () => {
  const user = process.env.SMOKE_USER || 'chisa96';
  const pass = process.env.SMOKE_PASS || process.env.SHOP_POS_SMOKE_PASS || '123456';
  const today = new Date().toISOString().slice(0, 10);

  // ── Health & static pages ──
  const health = await fetch(`${BASE}/health`).then((r) => r.json()).catch((e) => ({ error: e.message }));
  record('health', { ok: !!health.ok, handlers: health.handlers, error: health.error });

  await checkPage('?app=admin', ['admin-nav', 'AdminPage']);
  await checkPage('?app=pos', ['pos-layout', 'POSPage']);
  await checkPage('order/', ['OrderAPI', 'order-app']);
  await checkPage('manager/', ['ManagerAPI', 'ManagerApp']);

  const adminAssets = [
    'js/pages/admin.js', 'js/pages/admin-audit.js', 'js/pages/admin-pro.js',
    'js/pages/admin-staff.js', 'js/pages/admin-marketing.js', 'js/pages/admin-delivery.js',
    'js/pages/admin-hr.js', 'js/pages/admin-payroll.js', 'js/pages/admin-combos.js',
    'js/pages/admin-operations.js', 'js/pages/pos.js', 'js/online-orders-widget.js',
    'customer-web/js/app.js', 'manager-web/js/app.js'
  ];
  for (const p of adminAssets) {
    const url = `${BASE}/${p}`;
    const t0 = Date.now();
    const res = await fetch(url);
    record(`asset:${p}`, { ok: res.ok, status: res.status, ms: Date.now() - t0, severity: res.ok ? 'pass' : 'bug' });
  }

  // ── Admin login ──
  const login = await rpc('auth:login', [user, pass]);
  const actor = login.json?.user || login.json?.data?.user;
  const token = login.token;
  if (!login.json?.success || !actor) {
    record('admin:login', { ok: false, severity: 'critical', error: login.json?.error || 'login failed' });
    printReport();
    process.exit(1);
  }
  record('admin:login', { ok: true, user: actor.username, role: actor.role, ms: login.ms });

  const settingsRes = await testRpc('admin', 'settings:getParsed', [], token);
  const settings = settingsRes.data || {};

  // ── Admin sections — core RPC wiring ──
  const adminRpc = [
    ['dashboard:admin', [today, today]],
    ['dashboard:stats', [today, today, actor]],
    ['audit:dashboard', [today, today, actor]],
    ['audit:salesList', [{ from: today, to: today }, actor]],
    ['audit:saleDetail', [{ limit: 1 }, actor]],
    ['audit:soldProducts', [{ from: today, to: today }, actor]],
    ['audit:returns', [{ from: today, to: today }, actor]],
    ['audit:activity', [{ limit: 10 }, actor]],
    ['audit:exceptions', [{ limit: 10 }, actor]],
    ['audit:alerts', [actor]],
    ['audit:dailyClose', [today, actor]],
    ['audit:discountReport', [{ from: today, to: today }, actor]],
    ['products:get', [{}]],
    ['categories:get', [{}]],
    ['customers:get', ['']],
    ['suppliers:get', []],
    ['auth:getUsers', [actor]],
    ['branches:get', [actor]],
    ['branches:getDetailed', [actor]],
    ['shifts:list', [actor]],
    ['shifts:getOpen', [actor]],
    ['discounts:get', []],
    ['loyalty:getSettings', []],
    ['quotes:list', [actor]],
    ['returns:get', [{}]],
    ['settings:getPendingRequests', []],
    ['expenses:get', [{}]],
    ['po:get', []],
    ['inventory:stats', []],
    ['web:adminOrders', [{ status: 'pending' }, actor]],
    ['web:adminOrders', [{}]],
    ['delivery:listDrivers', [actor]],
    ['delivery:listOrders', [{}, actor]],
    ['delivery:dashboard', [{}, actor]],
    ['delivery:getSettings', [actor]],
    ['mktp:agents', [{ status: 'active' }, actor]],
    ['mktp:campaigns', [actor]],
    ['hr:employees', [actor]],
    ['payroll:runs', [actor]],
    ['acc:journals', [{ limit: 5 }, actor]],
    ['acc:accounts', [{}, actor]],
    ['recipe:foodCostAlerts', [actor]],
    ['ops:complianceDashboard', [actor]],
    ['combos:get', [actor]],
    ['mobile:users', [actor]],
    ['audit:log', [{ limit: 10 }, actor]],
    ['layby:list', [actor]],
    ['giftcards:list', [actor]],
    ['tables:get', [actor]],
    ['campaigns:active', [actor]],
  ];
  for (const [method, args] of adminRpc) {
    await testRpc('admin', method, args, token);
  }

  // Tax hub
  await testRpc('admin', 'tax:hubSummary', [{ from: today, to: today }, actor]);

  // ── POS wiring ──
  const posRpc = [
    ['products:get', [{ for_pos: true, actor }]],
    ['categories:get', [{ for_pos: true, actor }]],
    ['shifts:getOpen', [actor]],
    ['shifts:getSettings', []],
    ['sync:getOnlineOrders', ['']],
    ['held:get', [actor]],
    ['quotes:list', [actor]],
    ['tables:get', [actor]],
    ['campaigns:active', [actor]],
    ['customers:search', ['', actor]],
  ];
  for (const [method, args] of posRpc) {
    await testRpc('pos', method, args, token);
  }

  // ── Online ordering (customer web) ──
  const webHeaders = { 'X-Shop-Source': 'customer-web' };
  const webSettings = await testRpc('online', 'web:getSettings', [], null, { headers: webHeaders });
  const webBranches = await testRpc('online', 'web:getBranches', [], null, { headers: webHeaders });
  const branches = Array.isArray(webBranches.data) ? webBranches.data : [];
  const branchId = branches.find((b) => b.is_active !== false)?.id || branches[0]?.id;

  if (branchId) {
    const menu = await testRpc('online', 'web:getMenu', [branchId, {}], null, { headers: webHeaders });
    const items = Array.isArray(menu.data) ? menu.data : (menu.data?.products || menu.data?.items || []);
    const product = items.find((p) => p.is_available !== false && Number(p.selling_price || p.price) > 0) || items[0];
    if (product) {
      await testRpc('online', 'web:getProduct', [branchId, product.id], null, { headers: webHeaders });
      const cart = [{ product_id: product.id, qty: 1, name: product.name, price: Number(product.selling_price || product.price || 0) }];
      const validated = await testRpc('online', 'web:validateCart', [branchId, cart], null, { headers: webHeaders });
      if (validated.success) {
        record('online:validateCart:wiring', { ok: true, note: `product ${product.name}` });
      }
    } else {
      record('online:menu:empty', { ok: false, severity: 'warning', note: 'no products on menu' });
    }
  } else {
    record('online:branches:empty', { ok: false, severity: 'warning', note: 'no branches for online order' });
  }

  // Guest register smoke (don't persist if fails)
  const guestEmail = `e2e-${Date.now()}@test.local`;
  await testRpc('online', 'web:register', [{
    name: 'E2E Test', email: guestEmail, phone: '0700000000', password: 'Test1234!'
  }], null, { headers: webHeaders });

  // ── Manager panel ──
  const mgrLogin = await rpc('mobile:login', [user, pass, { platform: 'e2e-test', device_name: 'audit' }]);
  const mgrData = unwrap(mgrLogin.json) || mgrLogin.json;
  const mgrToken = (typeof mgrData === 'object' && mgrData?.token) ? mgrData.token : (mgrLogin.json?.token || null);
  const mgrOk = mgrLogin.json?.success !== false && mgrToken;
  record('manager:login', { ok: mgrOk, ms: mgrLogin.ms, error: mgrOk ? undefined : (mgrLogin.json?.error || 'no token') });

  if (mgrOk) {
    const mgrArgs = (args) => [mgrToken, ...args];
    const mgrTests = [
      ['mobile:profile', []],
      ['mobile:dashboard', [{}]],
      ['mobile:orders', [{}]],
      ['mobile:alerts', [50]],
      ['mobile:posStatus', []],
      ['mobile:getPrefs', []],
      ['mobile:staffActivity', [{}]],
      ['mobile:poll', [0]],
    ];
    for (const [method, args] of mgrTests) {
      const r = await rpc(method, mgrArgs(args));
      const success = ok(r);
      record(`manager:${method}`, {
        ok: success,
        ms: r.ms,
        slow: r.ms > SLOW_MS,
        error: success ? undefined : (r.json?.error || 'failed'),
        severity: success ? 'pass' : 'bug'
      });
    }
  }

  // ── Cross-wiring: online orders visible to POS sync ──
  const onlineOrders = await testRpc('pos', 'sync:getOnlineOrders', [''], token);
  const orderList = Array.isArray(onlineOrders.data) ? onlineOrders.data : [];
  record('wiring:pos-online-orders', {
    ok: onlineOrders.success,
    count: orderList.length,
    pending: orderList.filter((o) => String(o.status).toLowerCase() === 'pending').length
  });

  const adminPending = await testRpc('admin', 'web:adminOrders', [{ status: 'pending' }, actor], token);
  record('wiring:admin-online-orders', {
    ok: adminPending.success,
    count: Array.isArray(adminPending.data) ? adminPending.data.length : 0
  });

  // Branch stock wiring
  const branchesDetailed = await testRpc('admin', 'branches:getDetailed', [actor], token);
  const branchRows = Array.isArray(branchesDetailed.data) ? branchesDetailed.data : [];
  record('wiring:branches', {
    ok: branchRows.length > 0,
    count: branchRows.length,
    online_enabled: branchRows.filter((b) => b.online_ordering).length
  });

  printReport();
  process.exit(summary.failed > 0 ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

function printReport() {
  const failed = findings.filter((f) => !f.ok && f.severity !== 'warning');
  const warnings = findings.filter((f) => !f.ok && f.severity === 'warning');
  const slow = findings.filter((f) => f.slow);

  console.log('\n=== FULL E2E AUDIT REPORT ===\n');
  console.log(JSON.stringify({
    base: BASE,
    summary,
    failed: failed.map((f) => ({ name: f.name, error: f.error, ms: f.ms, note: f.note })),
    warnings: warnings.map((f) => ({ name: f.name, error: f.error, note: f.note })),
    slow: slow.map((f) => ({ name: f.name, ms: f.ms }))
  }, null, 2));
}

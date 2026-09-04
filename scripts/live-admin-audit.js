/**
 * Live admin audit — RPC + static asset checks.
 * Usage: SMOKE_USER=chisa96 SMOKE_PASS=... node scripts/live-admin-audit.js
 */
const BASE = (process.env.SMOKE_URL || 'https://chisafood.up.railway.app').replace(/\/$/, '');

async function rpc(method, args = [], token = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['X-Session-Token'] = token;
  const t0 = Date.now();
  const res = await fetch(`${BASE}/rpc`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ method, args })
  });
  const ms = Date.now() - t0;
  const json = await res.json().catch(() => ({}));
  const tok = res.headers.get('X-Session-Token') || json.sessionToken || token;
  return { json, token: tok, status: res.status, ms };
}

function ok(r) {
  if (!r?.json) return false;
  if (r.json.success === false) return false;
  if (r.json.error) return false;
  return true;
}

function fail(name, detail) {
  return { name, ok: false, severity: detail.severity || 'bug', ...detail };
}
function pass(name, detail = {}) {
  return { name, ok: true, ...detail };
}

async function checkAsset(path, mustContain = []) {
  const url = `${BASE}/${path.replace(/^\//, '')}`;
  const t0 = Date.now();
  const res = await fetch(url);
  const text = await res.text();
  const ms = Date.now() - t0;
  const missing = mustContain.filter((s) => !text.includes(s));
  return {
    url,
    status: res.status,
    ms,
    size: text.length,
    ok: res.ok && missing.length === 0,
    missing
  };
}

(async () => {
  const user = process.env.SMOKE_USER || 'chisa96';
  const passEnv = process.env.SMOKE_PASS || process.env.SHOP_POS_SMOKE_PASS || '123456';
  const findings = [];
  const summary = { tested: 0, passed: 0, failed: 0, warnings: 0 };

  function record(f) {
    findings.push(f);
    summary.tested++;
    if (f.ok) summary.passed++;
    else if (f.severity === 'warning') summary.warnings++;
    else summary.failed++;
  }

  // Health
  const health = await fetch(`${BASE}/health`).then((r) => r.json()).catch((e) => ({ error: e.message }));
  record(health.ok ? pass('health', { handlers: health.handlers }) : fail('health', { error: health.error }));

  // Static admin assets
  const assets = [
    ['js/pages/admin.js', ['AdminPage', 'renderOverview']],
    ['js/pages/admin-pro.js', ['AdminProPage']],
    ['js/pages/admin-staff.js', ['AdminStaffPage']],
    ['js/pages/admin-marketing.js', ['AdminMarketingPage']],
    ['js/pages/admin-delivery.js', ['AdminDeliveryPage']],
    ['js/pages/admin-hr.js', ['AdminHrPage']],
    ['js/pages/admin-payroll.js', ['AdminPayrollPage']],
    ['js/app.js', ['navigate', 'admin']],
  ];
  for (const [path, must] of assets) {
    const a = await checkAsset(path, must);
    record(a.ok ? pass(`asset:${path}`, { ms: a.ms, size: a.size }) : fail(`asset:${path}`, {
      severity: a.status === 200 ? 'bug' : 'critical',
      status: a.status,
      missing: a.missing
    }));
  }

  // Login
  const login = await rpc('auth:login', [user, passEnv]);
  const actor = login.json?.user || login.json?.data?.user;
  const token = login.token;
  if (!login.json?.success || !actor) {
    record(fail('login', { severity: 'critical', error: login.json?.error || 'login failed' }));
    console.log(JSON.stringify({ summary, findings }, null, 2));
    process.exit(1);
  }
  record(pass('login', { user: actor.username, role: actor.role, ms: login.ms }));

  const tests = [
    ['settings:getParsed', []],
    ['dashboard:stats', [new Date().toISOString().slice(0, 10), new Date().toISOString().slice(0, 10), actor]],
    ['dashboard:admin', [new Date().toISOString().slice(0, 10), new Date().toISOString().slice(0, 10), actor]],
    ['inventory:stats', []],
    ['products:get', [{}]],
    ['categories:get', [{}]],
    ['customers:get', ['']],
    ['suppliers:get', []],
    ['auth:getUsers', [actor]],
    ['branches:get', [actor]],
    ['branches:getDetailed', [actor]],
    ['web:adminOrders', [{ status: 'pending' }, actor]],
    ['web:adminOrders', [{}]],
    ['shifts:list', [actor]],
    ['discounts:get', []],
    ['loyalty:getSettings', []],
    ['expenses:get', [{}]],
    ['po:get', []],
    ['returns:get', [{}]],
    ['settings:getPendingRequests', []],
    ['mktp:agents', [{ status: 'active' }, actor]],
    ['mktp:agents', [{ status: 'pending' }, actor]],
    ['delivery:listDrivers', [actor]],
    ['delivery:listOrders', [{}, actor]],
    ['hr:employees', [actor]],
    ['payroll:runs', [actor]],
    ['acc:journals', [{ limit: 5 }, actor]],
    ['acc:accounts', [{}, actor]],
    ['recipe:foodCostAlerts', [actor]],
    ['ops:complianceDashboard', [actor]],
    ['combos:get', [actor]],
    ['quotes:list', [actor]],
    ['mobile:users', [actor]],
    ['audit:log', [{ limit: 10 }, actor]],
  ];

  for (const [method, args] of tests) {
    const r = await rpc(method, args, token);
    const success = ok(r);
    const err = r.json?.error || (r.json?.success === false ? 'success=false' : null);
    const slow = r.ms > 3000;
    if (success) {
      record(pass(`rpc:${method}`, {
        ms: r.ms,
        slow,
        count: Array.isArray(r.json?.data) ? r.json.data.length
          : Array.isArray(r.json?.data?.rows) ? r.json.data.rows.length
            : r.json?.data?.count
      }));
    } else if (err && /not found|unknown method|no such/i.test(String(err))) {
      record(fail(`rpc:${method}`, { severity: 'warning', error: err, ms: r.ms, note: 'method missing or renamed' }));
    } else {
      record(fail(`rpc:${method}`, { severity: 'bug', error: err, ms: r.ms, status: r.status }));
    }
    if (slow && success) {
      record(fail(`rpc:${method}:slow`, { severity: 'warning', ms: r.ms, note: 'response > 3s' }));
    }
  }

  // Branch stock integrity
  const branches = await rpc('branches:getDetailed', [actor], token);
  const branchRows = branches.json?.data || [];
  if (branchRows.length === 0) {
    record(fail('branches:empty', { severity: 'bug', note: 'No branches configured — stock saves may fail' }));
  } else {
    record(pass('branches:configured', { count: branchRows.length, active: branchRows.find((b) => b.is_active)?.name }));
  }

  // Products with zero stock overlay check
  const products = await rpc('products:get', [{}], token);
  const prods = products.json?.data || [];
  const zeroStock = prods.filter((p) => Number(p.stock_quantity) === 0).length;
  record(pass('products:loaded', { total: prods.length, zeroStock }));

  // Pending online orders
  const pending = await rpc('web:adminOrders', [{ status: 'pending' }, actor], token);
  const pendingOrders = pending.json?.data || [];
  if (pendingOrders.length > 0) {
    record(pass('online-orders:pending', { count: pendingOrders.length, numbers: pendingOrders.slice(0, 5).map((o) => o.order_number) }));
  }

  // Admin page HTTP
  const adminPage = await fetch(`${BASE}/?app=admin`);
  record(adminPage.ok ? pass('admin:page_http', { status: adminPage.status }) : fail('admin:page_http', { status: adminPage.status }));

  const failed = findings.filter((f) => !f.ok && f.severity !== 'warning');
  const warnings = findings.filter((f) => !f.ok && f.severity === 'warning');
  const slowRpc = findings.filter((f) => f.slow);

  console.log(JSON.stringify({
    summary,
    failed: failed.map((f) => ({ name: f.name, error: f.error, note: f.note, ms: f.ms })),
    warnings: warnings.map((f) => ({ name: f.name, error: f.error, note: f.note })),
    slow: slowRpc.map((f) => ({ name: f.name, ms: f.ms })),
    pass: summary.passed
  }, null, 2));

  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

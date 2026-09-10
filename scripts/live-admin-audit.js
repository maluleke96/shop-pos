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

  const health = await fetch(`${BASE}/health`).then((r) => r.json()).catch((e) => ({ error: e.message }));
  record(health.ok ? pass('health', { handlers: health.handlers }) : fail('health', { error: health.error }));

  const assets = [
    ['js/pages/admin.js', ['AdminPage', 'renderOverviewQuickPanel']],
    ['js/pages/admin-audit.js', ['renderBusinessDashboard', 'dashboardRes']],
    ['js/pages/admin-pro.js', ['AdminPage', 'renderAutomation']],
    ['js/pages/admin-staff.js', ['AdminPage']],
    ['js/pages/admin-delivery.js', ['AdminDeliveryPage']],
    ['js/pages/admin-hr.js', ['AdminHrPage']],
    ['js/pages/admin-payroll.js', ['renderPayrollCompliance']],
    ['js/app.js', ['bindGlobalCatalogSync', 'checkPosCatalogStamp']],
    ['js/data-cache.js', ['shop-pos-catalog-ts', 'BroadcastChannel']],
    ['js/pages/pos.js', ['reloadCatalog', 'shop-pos-catalog-updated']],
    ['js/api.js', ['getTillBranchId', 'branches:get']],
  ];
  for (const [path, must] of assets) {
    const a = await checkAsset(path, must);
    record(a.ok ? pass(`asset:${path}`, { ms: a.ms, size: a.size }) : fail(`asset:${path}`, {
      severity: a.status === 200 ? 'bug' : 'critical',
      status: a.status,
      missing: a.missing
    }));
  }

  const login = await rpc('auth:login', [user, passEnv]);
  const actor = login.json?.user || login.json?.data?.user;
  const token = login.token;
  if (!login.json?.success || !actor) {
    record(fail('login', { severity: 'critical', error: login.json?.error || 'login failed' }));
    console.log(JSON.stringify({ summary, findings }, null, 2));
    process.exit(1);
  }
  record(pass('login', { user: actor.username, role: actor.role, ms: login.ms }));

  const today = new Date().toISOString().slice(0, 10);
  const tests = [
    ['settings:getParsed', []],
    ['dashboard:stats', [today, today, actor]],
    ['audit:dashboard', [today, today, actor]],
    ['inventory:stats', []],
    ['products:get', [{}]],
    ['categories:get', [{}]],
    ['customers:get', ['']],
    ['suppliers:get', []],
    ['auth:getUsers', [actor]],
    ['branches:get', []],
    ['branches:getActive', []],
    ['branches:getView', []],
    ['web:adminOrders', [{ status: 'pending' }, actor]],
    ['web:adminOrders', [{}]],
    ['shifts:get', [50]],
    ['reports:discounts', [today, today]],
    ['loyalty:pointsSummary', [1]],
    ['expenses:get', [{}]],
    ['po:get', []],
    ['returns:get', [{}]],
    ['settings:getPendingRequests', []],
    ['mktp:agents', [{ status: 'active' }, actor]],
    ['delivery:drivers', [{}, actor]],
    ['delivery:list', [{}, actor]],
    ['hr:people', [{}, actor]],
    ['payroll:getSettings', []],
    ['acc:journals', [{ limit: 5 }, actor]],
    ['acc:accounts', [{}, actor]],
    ['recipe:foodCostAlerts', [actor]],
    ['ops:dashboard', []],
    ['combos:get', [actor]],
    ['quotes:get', [{}]],
    ['mobile:adminListUsers', [actor]],
    ['audit:get', [{ limit: 10 }]],
    ['bizModules:summary', [actor]],
    ['signage:summary', [actor]],
    ['meeting:summary', [actor]],
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

  const branches = await rpc('branches:get', [], token);
  const branchRows = branches.json?.data || [];
  if (branchRows.length === 0) {
    record(fail('branches:empty', { severity: 'bug', note: 'No branches configured — multi-branch stock/sales may fail' }));
  } else {
    record(pass('branches:configured', {
      count: branchRows.length,
      primary: branchRows[0]?.name,
      code: branchRows[0]?.code,
      id: branchRows[0]?.id
    }));
  }

  const active = await rpc('branches:getActive', [], token);
  const activeBranch = active.json?.data;
  if (branchRows.length && activeBranch?.id) {
    record(pass('branches:active', { id: activeBranch.id, name: activeBranch.name }));
  } else if (branchRows.length) {
    record(fail('branches:active-missing', { severity: 'warning', note: 'Active branch not resolved' }));
  }

  const products = await rpc('products:get', [{}], token);
  const prods = products.json?.data || [];
  record(pass('products:loaded', { total: prods.length }));

  const adminPage = await fetch(`${BASE}/?app=admin`);
  record(adminPage.ok ? pass('admin:page_http', { status: adminPage.status }) : fail('admin:page_http', { status: adminPage.status }));

  const failed = findings.filter((f) => !f.ok && f.severity !== 'warning');
  const warnings = findings.filter((f) => !f.ok && f.severity === 'warning');
  const slowRpc = findings.filter((f) => f.slow);

  console.log(JSON.stringify({
    summary,
    failed: failed.map((f) => ({ name: f.name, error: f.error, note: f.note, ms: f.ms, missing: f.missing })),
    warnings: warnings.map((f) => ({ name: f.name, error: f.error, note: f.note })),
    slow: slowRpc.map((f) => ({ name: f.name, ms: f.ms })),
    pass: summary.passed
  }, null, 2));

  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

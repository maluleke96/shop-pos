/**
 * Admin performance audit — RPC timings + static anti-pattern checks.
 * Usage: SMOKE_USER=chisa96 SMOKE_PASS=... node scripts/live-admin-performance-audit.js
 */
const fs = require('fs');
const path = require('path');

const BASE = (process.env.SMOKE_URL || 'https://chisafood.up.railway.app').replace(/\/$/, '');
const ROOT = path.join(__dirname, '..');
const SLOW_RPC_MS = Number(process.env.ADMIN_PERF_SLOW_MS || 2000);
const WARN_RPC_MS = Number(process.env.ADMIN_PERF_WARN_MS || 1000);

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
  return { json, token: tok, status: res.status, ms, method };
}

function read(rel) {
  try {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
  } catch {
    return '';
  }
}

function staticChecks() {
  const findings = [];
  const files = {
    'src/js/pages/admin.js': read('src/js/pages/admin.js'),
    'src/js/pages/admin-audit.js': read('src/js/pages/admin-audit.js'),
    'src/js/pages/admin-delivery.js': read('src/js/pages/admin-delivery.js'),
    'src/js/data-cache.js': read('src/js/data-cache.js'),
    'src/js/app.js': read('src/js/app.js')
  };

  const mustHave = [
    ['src/js/pages/admin.js', '_beginSectionRender', 'admin section lifecycle'],
    ['src/js/pages/admin.js', 'handleAdminSearchDebounced', 'debounced admin search'],
    ['src/js/pages/admin.js', '_leaveSection', 'section timer cleanup'],
    ['src/js/pages/admin.js', 'activate(el, app)', 'admin page revisit activate'],
    ['src/js/data-cache.js', 'AdminPerf', 'client perf diagnostics'],
    ['src/js/data-cache.js', 'globalSearch', 'cached global search'],
    ['src/js/pages/admin-audit.js', 'liveGen !== this._sectionGen', 'overview live feed gen guard']
  ];
  for (const [file, needle, label] of mustHave) {
    findings.push({
      kind: 'static',
      name: label,
      ok: (files[file] || read(file)).includes(needle),
      file
    });
  }

  const adminJs = files['src/js/pages/admin.js'];
  if (adminJs.includes('getSalesList?.({ from: today, to: today, limit: 500 })')) {
    findings.push({
      kind: 'static',
      name: 'prefetch avoids heavy sales list (500)',
      ok: false,
      file: 'src/js/pages/admin.js'
    });
  } else {
    findings.push({
      kind: 'static',
      name: 'prefetch avoids heavy sales list (500)',
      ok: true,
      file: 'src/js/pages/admin.js'
    });
  }

  const delivery = files['src/js/pages/admin-delivery.js'];
  findings.push({
    kind: 'static',
    name: 'delivery auto-refresh visibility guard',
    ok: delivery.includes('document.hidden'),
    file: 'src/js/pages/admin-delivery.js'
  });

  return findings;
}

function assetSizes() {
  const assets = [
    'src/js/pages/admin.js',
    'src/js/pages/admin-audit.js',
    'src/js/pages/admin-pro.js',
    'src/js/pages/admin-staff.js',
    'src/js/pages/admin-delivery.js',
    'src/js/data-cache.js',
    'src/js/app.js'
  ];
  return assets.map((rel) => {
    const full = path.join(ROOT, rel);
    const stat = fs.statSync(full);
    return { file: rel, bytes: stat.size, kb: Math.round(stat.size / 1024) };
  }).sort((a, b) => b.bytes - a.bytes);
}

async function benchmarkRpcs(token, actor) {
  const today = new Date().toISOString().slice(0, 10);
  const methods = [
    ['settings:getParsed', []],
    ['audit:dashboard', [today, today, actor]],
    ['dashboard:stats', [today, today, actor]],
    ['products:get', [{ admin_list: true }]],
    ['categories:get', [{}]],
    ['customers:get', ['']],
    ['suppliers:get', []],
    ['sales:list', [{ from: today, to: today, limit: 50 }]],
    ['search:global', ['chicken']],
    ['branches:get', []],
    ['web:adminOrders', [{ status: 'pending' }, actor]],
    ['inventory:stats', []]
  ];

  const results = [];
  for (const [method, args] of methods) {
    const runs = [];
    for (let i = 0; i < 2; i++) {
      const r = await rpc(method, args, token);
      runs.push(r.ms);
    }
    runs.sort((a, b) => a - b);
    const min = runs[0];
    const max = runs[runs.length - 1];
    const avg = Math.round(runs.reduce((a, b) => a + b, 0) / runs.length);
    const dupGain = runs.length > 1 ? runs[1] - runs[0] : 0;
    results.push({
      method,
      minMs: min,
      maxMs: max,
      avgMs: avg,
      duplicateDeltaMs: dupGain,
      ok: min < SLOW_RPC_MS,
      severity: min >= SLOW_RPC_MS ? 'critical' : (min >= WARN_RPC_MS ? 'warning' : 'ok')
    });
  }
  return results.sort((a, b) => b.avgMs - a.avgMs);
}

(async () => {
  const summary = { tested: 0, passed: 0, failed: 0, warnings: 0 };
  const findings = [];

  function record(f) {
    findings.push(f);
    summary.tested++;
    if (f.ok) summary.passed++;
    else if (f.severity === 'warning') summary.warnings++;
    else summary.failed++;
  }

  for (const f of staticChecks()) {
    record({ ...f, severity: f.ok ? 'ok' : 'critical' });
  }

  const sizes = assetSizes();
  const largeAssets = sizes.filter((a) => a.kb > 200);
  record({
    kind: 'assets',
    name: 'admin bundle sizes',
    ok: largeAssets.length <= 3,
    severity: largeAssets.length > 5 ? 'critical' : (largeAssets.length > 3 ? 'warning' : 'ok'),
    largest: sizes.slice(0, 5)
  });

  const user = process.env.SMOKE_USER || 'chisa96';
  const passEnv = process.env.SMOKE_PASS || process.env.SHOP_POS_SMOKE_PASS || '123456';
  const login = await rpc('auth:login', [user, passEnv]);
  const actor = login.json?.user || login.json?.data?.user;
  const token = login.token;
  if (!login.json?.success || !actor) {
    record({ kind: 'rpc', name: 'login', ok: false, severity: 'critical', error: login.json?.error || 'login failed' });
    console.log(JSON.stringify({ summary, findings, assets: sizes }, null, 2));
    process.exit(1);
  }
  record({ kind: 'rpc', name: 'login', ok: true, ms: login.ms });

  const rpcBench = await benchmarkRpcs(token, actor);
  for (const r of rpcBench) {
    record({
      kind: 'rpc',
      name: r.method,
      ok: r.ok,
      severity: r.severity,
      minMs: r.minMs,
      avgMs: r.avgMs,
      maxMs: r.maxMs,
      duplicateDeltaMs: r.duplicateDeltaMs
    });
  }

  const slowest = rpcBench.slice(0, 8);
  const report = {
    summary,
    targets: {
      menuResponseMs: '< 50 (client-side — verify in browser DevTools)',
      navigationMs: '0–1000 perceived',
      dbBackedPageMs: '1000–2000 typical',
      slowRpcThresholdMs: SLOW_RPC_MS,
      warnRpcThresholdMs: WARN_RPC_MS
    },
    slowestRpcs: slowest,
    staticFindings: findings.filter((f) => f.kind === 'static'),
    rpcFindings: findings.filter((f) => f.kind === 'rpc'),
    assets: sizes,
    browserDiagnostics: 'In Admin, open DevTools console and run: AdminPerf.logSlowest()'
  };

  console.log(JSON.stringify(report, null, 2));
  process.exit(summary.failed > 0 ? 1 : 0);
})();

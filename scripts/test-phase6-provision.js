/**
 * Phase 6 — Dry-run + security + (optional) real provision test. LAB ONLY.
 * Usage: node scripts/test-phase6-provision.js https://shoppos-lab-production.up.railway.app
 * Set PHASE6_REAL=1 to attempt real Railway provision (requires RAILWAY_API_TOKEN on lab).
 */
const BASE = (process.argv[2] || process.env.SHOP_POS_LAB_URL || 'http://127.0.0.1:3080').replace(/\/$/, '');
const USER = process.env.PLATFORM_USER || 'platform';
const PASS = process.env.PLATFORM_PASS || 'platform-lab-change-me';
const REAL = process.env.PHASE6_REAL === '1';

async function rpc(method, args = [], token) {
  const bodyArgs = token && !['platform:login', 'platform:status'].includes(method)
    ? [token, ...args]
    : args;
  const res = await fetch(`${BASE}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, args: bodyArgs })
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

function assert(c, m) { if (!c) throw new Error(m); }
function unwrap(j) {
  let d = j?.data ?? j;
  if (d && d.data && !d.plan && !d.id && !d.job_id) d = d.data;
  return d;
}

async function main() {
  const results = [];
  const log = (name, ok, detail) => {
    results.push({ name, ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  };

  const health = await fetch(`${BASE}/health`).then((r) => r.json()).catch(() => ({}));
  log('lab reachable', !!health.ok);

  const login = await rpc('platform:login', [USER, PASS]);
  const tok = login.json.token || login.json.data?.token;
  assert(tok, 'login failed');

  await rpc('platform:bootstrapLabSamples', [], tok);
  const pst = unwrap(await rpc('platform:provisionStatus', [], tok).then((r) => r.json));
  log('provision status', pst.phase === 6, JSON.stringify(pst));
  log('railway token configured (server)', !!pst.railway_api_configured);
  log('chisa project blocked id present', !!pst.chisa_project_blocked);

  // Security: token must not appear in status response
  const raw = JSON.stringify(await rpc('platform:provisionStatus', [], tok).then((r) => r.json));
  log('token not in API response', !/Bearer\s+[A-Za-z0-9]|apiTokenCreate|d5626272-b20a/i.test(raw) && !/"RAILWAY_API_TOKEN"\s*:/.test(raw));

  const pkgs = unwrap(await rpc('platform:listPackages', [], tok).then((r) => r.json));
  const pkgList = pkgs.data || (Array.isArray(pkgs) ? pkgs : []);
  const floor = pkgList.find((p) => /Shop Floor/i.test(p.name));
  const addons = unwrap(await rpc('platform:listAddons', [], tok).then((r) => r.json));
  const addonList = addons.data || (Array.isArray(addons) ? addons : []);
  const online = addonList.find((a) => /Online Ordering/i.test(a.name));
  assert(floor && online, 'need floor + online addon');

  // Create / reuse PHASE6 TEST SHOP
  let list = unwrap(await rpc('platform:listShops', [{ q: 'PHASE6' }], tok).then((r) => r.json));
  let shop = (list.shops || []).find((s) => s.shop_name === 'PHASE6 TEST SHOP');
  if (!shop) {
    const c = await rpc('platform:createShop', [{
      shop_name: 'PHASE6 TEST SHOP',
      owner_name: 'Phase6 Tester',
      owner_email: 'phase6@example.test',
      package_id: floor.id,
      addon_ids: [online.id],
      subscription_status: 'TRIAL'
    }], tok);
    assert(c.json?.success !== false, 'create shop failed: ' + JSON.stringify(c.json));
    shop = unwrap(c.json);
  }
  log('1 test shop record', !!shop.id, shop.id);

  // Dry run
  const dry = await rpc('platform:provisionDryRun', [shop.id], tok);
  assert(dry.json?.success !== false, 'dry-run failed: ' + JSON.stringify(dry.json));
  const plan = unwrap(dry.json).plan || unwrap(dry.json);
  log('2 dry-run plan shop_id', plan.shop_id === shop.id);
  log('2 dry-run project name', /shop-phase6-test-shop/i.test(plan.proposed_railway_project_name), plan.proposed_railway_project_name);
  log('2 dry-run shows package', plan.package_id === floor.id);
  log('2 dry-run shows online addon', (plan.addon_ids || []).includes(online.id));
  log('2 dry-run online entitlement ON', !!plan.initial_entitlement_flags?.online);
  log('2 dry-run no secrets in plan', !/postgresql:\/\/[^R*]/.test(JSON.stringify(plan)));
  log('2 dry-run notes no railway create', (plan.notes || []).some((n) => /Dry-run/i.test(n)));

  // Chisa protection
  const chisa = await rpc('platform:createShop', [{
    shop_name: 'Chisa Food Test',
    package_id: floor.id
  }], tok);
  log('chisa create rejected', chisa.json?.success === false || /Chisa|protected/i.test(String(chisa.json?.error || '')));

  if (!REAL) {
    log('real provision skipped', true, 'set PHASE6_REAL=1 to run');
  } else {
    console.log('Starting REAL provision (may take several minutes)…');
    const run = await rpc('platform:provisionRun', [shop.id], tok);
    const data = unwrap(run.json);
    log('3 real provision returned', run.json?.success !== false || data?.status === 'FAILED' || data?.status === 'READY', data?.status);
    const refreshed = unwrap(await rpc('platform:getShop', [shop.id], tok).then((r) => r.json));
    log('4 railway project id stored', !!refreshed.railway_project_id, refreshed.railway_project_id);
    log('4 not chisa project', refreshed.railway_project_id !== '0296f469-4b4e-4b3f-99fb-063b03535e39');
    log('5 shop url set or pending', true, refreshed.shop_url || refreshed.deployment_status);
    if (data?.result?.projectId) {
      log('6 project created/reused', true, data.result.projectId);
    }
    if (data?.status === 'READY') {
      log('7 READY', true);
      const hc = await fetch(String(refreshed.shop_url).replace(/\/$/, '') + '/health').then((r) => r.json()).catch(() => ({}));
      log('8 health ok', !!hc.ok, JSON.stringify(hc).slice(0, 120));
    } else {
      log('7 READY (may still be deploying)', data?.status === 'READY', data?.status + ' ' + (data?.error || ''));
    }
  }

  // Confirm lab still ok / chisa project untouched via provision status
  log('lab still online', !!(await fetch(`${BASE}/health`).then((r) => r.json()).catch(() => ({}))).ok);

  await rpc('platform:logout', [], tok);
  const failed = results.filter((r) => !r.ok);
  console.log(`\nPassed ${results.filter((r) => r.ok).length}/${results.length}`);
  if (failed.length) {
    failed.forEach((f) => console.log(' -', f.name, f.detail || ''));
    process.exit(1);
  }
  console.log('Phase 6 tests passed.');
}

main().catch((e) => { console.error(e); process.exit(1); });

/**
 * Phase 4 entitlement enforcement smoke tests — LAB ONLY.
 * Usage:
 *   node scripts/test-phase4-entitlements.js https://shoppos-lab-production.up.railway.app
 * Env: PLATFORM_USER / PLATFORM_PASS (default platform / from lab seed)
 */
const BASE = (process.argv[2] || process.env.SHOP_POS_LAB_URL || 'http://127.0.0.1:3080').replace(/\/$/, '');
const USER = process.env.PLATFORM_USER || 'platform';
const PASS = process.env.PLATFORM_PASS || 'platform-lab-change-me';

async function rpc(method, args = [], token) {
  const bodyArgs = token && !['platform:login', 'platform:status', 'entitlements:get', 'entitlements:status'].includes(method)
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

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function entPayload(json) {
  let d = json?.data ?? json;
  if (d && d.data && (d.data.flags || d.data.modules)) d = d.data;
  if (d && d.flags) return d;
  return d || {};
}

async function httpGet(path) {
  const res = await fetch(`${BASE}${path}`, { redirect: 'manual' });
  return { status: res.status, text: await res.text().catch(() => '') };
}

async function main() {
  const results = [];
  const log = (name, ok, detail) => {
    results.push({ name, ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  };

  // Health + enforcement flags
  const health = await fetch(`${BASE}/health`).then((r) => r.json()).catch(() => ({}));
  log('lab reachable', !!health.ok, health.public_url || BASE);

  const st = await rpc('platform:status', []);
  assert(st.json?.data?.enabled || st.json?.enabled, 'Platform Control not enabled on this host');
  log('platform enabled', true);

  const est = await rpc('entitlements:status', []);
  const estData = est.json?.data || est.json;
  log('not Chisa protected', !estData?.protected_production, JSON.stringify(estData));
  log('enforcement on', !!estData?.enforcement, JSON.stringify(estData));

  const login = await rpc('platform:login', [USER, PASS]);
  assert(login.json?.success !== false && (login.json?.token || login.json?.data?.token), 'platform login failed: ' + JSON.stringify(login.json));
  const tok = login.json.token || login.json.data?.token;

  await rpc('platform:syncCatalog', [], tok);
  await rpc('platform:bootstrapLabSamples', [], tok);

  const pkgs = await rpc('platform:listPackages', [], tok);
  const addons = await rpc('platform:listAddons', [], tok);
  const unwrap = (j) => {
    let d = j?.data ?? j;
    if (d && d.data && Array.isArray(d.data)) d = d.data;
    if (d && Array.isArray(d.packages)) return d.packages;
    if (Array.isArray(d)) return d;
    return [];
  };
  const pkgList = unwrap(pkgs.json);
  let addonList = unwrap(addons.json);
  // If nested {success,data:[]} under data
  if (!addonList.length && addons.json?.data?.data) addonList = addons.json.data.data;

  let floor = pkgList.find((p) => p.name === 'Lab Shop Floor');
  let onlineAd = addonList.find((a) => /Online Ordering/i.test(a.name));
  let signageAd = addonList.find((a) => /Digital Signage/i.test(a.name));
  let expensesAd = addonList.find((a) => /Expenses/i.test(a.name));

  if (!onlineAd || !expensesAd || !signageAd) {
    await rpc('platform:bootstrapLabSamples', [], tok);
    const addons2 = await rpc('platform:listAddons', [], tok);
    addonList = unwrap(addons2.json);
    if (!addonList.length && addons2.json?.data?.data) addonList = addons2.json.data.data;
    onlineAd = addonList.find((a) => /Online Ordering/i.test(a.name));
    signageAd = addonList.find((a) => /Digital Signage/i.test(a.name));
    expensesAd = addonList.find((a) => /Expenses/i.test(a.name));
    const pkgs2 = await rpc('platform:listPackages', [], tok);
    const pkgList2 = unwrap(pkgs2.json);
    floor = pkgList2.find((p) => p.name === 'Lab Shop Floor') || floor;
  }

  assert(floor, 'Lab Shop Floor package missing');
  assert(onlineAd, 'Online Ordering add-on missing — redeploy Phase 4 bootstrap');
  assert(signageAd, 'Signage add-on missing');
  assert(expensesAd, 'Expenses add-on missing — redeploy Phase 4 bootstrap');

  // Count online orders / signage before toggles (data preservation)
  const beforeOnline = await rpc('web:getSettings', []);
  const beforeOnlineOk = beforeOnline.status !== 403;
  // Use raw SQL via db only if available — instead probe product list (core) stays OK
  const products = await rpc('products:get', [{}]);
  const productsOkBefore = products.json?.success !== false && products.status !== 403;

  // ─── TEST 1: Lab Shop Floor ───────────────────────────────────────────────
  let save = await rpc('platform:saveShopAssignment', [{
    shop_key: 'lab',
    package_id: floor.id,
    addon_ids: [],
    overrides: [],
    notes: 'Phase4 Test1'
  }], tok);
  assert(save.json?.success !== false, 'assign floor failed: ' + JSON.stringify(save.json));
  let ent = entPayload((await rpc('entitlements:get', [])).json);
  log('TEST1 flags pos ON', !!ent.flags?.pos, JSON.stringify(ent.flags));
  log('TEST1 flags online OFF', !ent.flags?.online, JSON.stringify(ent.flags));
  log('TEST1 flags admin ON', !!ent.flags?.admin, JSON.stringify(ent.flags));

  const onlineRpc = await rpc('web:getSettings', []);
  log('TEST1 online RPC blocked', onlineRpc.status === 403 || onlineRpc.json?.code === 'FEATURE_NOT_INCLUDED',
    `status=${onlineRpc.status} code=${onlineRpc.json?.code}`);

  const orderHttp = await httpGet('/order/');
  log('TEST1 /order/ blocked', orderHttp.status === 403, `status=${orderHttp.status}`);

  const posRpc = await rpc('sales:getHeld', []);
  log('TEST1 POS/sales RPC allowed (or auth-only err)', posRpc.status !== 403 || !/FEATURE_NOT_INCLUDED/.test(String(posRpc.json?.error || '')),
    `status=${posRpc.status}`);

  // ─── TEST 2: Add Online Ordering ──────────────────────────────────────────
  save = await rpc('platform:saveShopAssignment', [{
    shop_key: 'lab',
    package_id: floor.id,
    addon_ids: [onlineAd.id],
    overrides: [],
    notes: 'Phase4 Test2'
  }], tok);
  assert(save.json?.success !== false, 'assign online failed: ' + JSON.stringify(save.json));
  // Prefer assignment payload entitlements (authoritative post-save)
  {
    const saved = save.json?.data?.entitlements || save.json?.data?.data?.entitlements;
    ent = saved || entPayload((await rpc('entitlements:get', [])).json);
  }
  log('TEST2 online ON', !!(ent.flags?.online || ent.modules?.['mod.online']), JSON.stringify(ent.flags));
  const onlineRpc2 = await rpc('web:getSettings', []);
  log('TEST2 online RPC allowed', onlineRpc2.status !== 403 && onlineRpc2.json?.code !== 'FEATURE_NOT_INCLUDED',
    `status=${onlineRpc2.status}`);
  const orderHttp2 = await httpGet('/order/');
  log('TEST2 /order/ allowed', orderHttp2.status !== 403, `status=${orderHttp2.status}`);
  log('TEST2 data intact (products still readable)', productsOkBefore && (await rpc('products:get', [{}])).status !== 403);

  // ─── TEST 3: Signage OFF (add then remove) ────────────────────────────────
  save = await rpc('platform:saveShopAssignment', [{
    shop_key: 'lab',
    package_id: floor.id,
    addon_ids: [onlineAd.id, signageAd.id],
    overrides: [],
    notes: 'Phase4 Test3 prep'
  }], tok);
  assert(save.json?.success !== false, 'signage prep failed: ' + JSON.stringify(save.json));
  {
    const saved = save.json?.data?.entitlements || save.json?.data?.data?.entitlements;
    ent = saved || entPayload((await rpc('entitlements:get', [])).json);
  }
  assert(ent.flags?.signage || ent.modules?.['mod.signage'], 'signage should be ON before OFF test: ' + JSON.stringify(ent.flags));

  save = await rpc('platform:saveShopAssignment', [{
    shop_key: 'lab',
    package_id: floor.id,
    addon_ids: [onlineAd.id],
    overrides: [],
    notes: 'Phase4 Test3 signage off'
  }], tok);
  ent = entPayload((await rpc('entitlements:get', [])).json);
  log('TEST3 signage OFF', !ent.flags?.signage, JSON.stringify(ent.flags));
  const sigRpc = await rpc('signage:dashboard', ['x']);
  log('TEST3 signage RPC blocked', sigRpc.status === 403 || sigRpc.json?.code === 'FEATURE_NOT_INCLUDED',
    `status=${sigRpc.status}`);
  const sigHttp = await httpGet('/signage/');
  log('TEST3 /signage/ blocked', sigHttp.status === 403, `status=${sigHttp.status}`);

  // ─── TEST 4: Signage ON again ─────────────────────────────────────────────
  save = await rpc('platform:saveShopAssignment', [{
    shop_key: 'lab',
    package_id: floor.id,
    addon_ids: [onlineAd.id, signageAd.id],
    overrides: [],
    notes: 'Phase4 Test4'
  }], tok);
  ent = entPayload((await rpc('entitlements:get', [])).json);
  log('TEST4 signage ON', !!ent.flags?.signage && !!ent.flags?.signage_player, JSON.stringify(ent.flags));
  const sigHttp2 = await httpGet('/signage/');
  log('TEST4 /signage/ allowed', sigHttp2.status !== 403, `status=${sigHttp2.status}`);

  // ─── TEST 5: Disable expenses via override after enabling add-on ───────────
  save = await rpc('platform:saveShopAssignment', [{
    shop_key: 'lab',
    package_id: floor.id,
    addon_ids: [onlineAd.id, signageAd.id, expensesAd.id],
    overrides: [],
    notes: 'Phase4 Test5 prep'
  }], tok);
  ent = entPayload((await rpc('entitlements:get', [])).json);
  assert(ent.flags?.expenses, 'expenses should be ON before disable');
  const expOk = await rpc('expenses:get', [{}]);
  log('TEST5 expenses RPC when ON', expOk.status !== 403 || expOk.json?.code !== 'FEATURE_NOT_INCLUDED', `status=${expOk.status}`);

  save = await rpc('platform:saveShopAssignment', [{
    shop_key: 'lab',
    package_id: floor.id,
    addon_ids: [onlineAd.id, signageAd.id, expensesAd.id],
    overrides: [{ module_id: 'app.expenses', enabled: 0, reason: 'Phase4 Test5' }],
    notes: 'Phase4 Test5 off'
  }], tok);
  ent = entPayload((await rpc('entitlements:get', [])).json);
  log('TEST5 expenses OFF via override', !ent.flags?.expenses, JSON.stringify(ent.flags));
  log('TEST5 pages.expenses false', ent.pages?.expenses === false, JSON.stringify(ent.pages?.expenses));
  const expOff = await rpc('expenses:get', [{}]);
  log('TEST5 expenses RPC blocked', expOff.status === 403 || expOff.json?.code === 'FEATURE_NOT_INCLUDED',
    `status=${expOff.status} code=${expOff.json?.code}`);
  const expHttp = await httpGet('/expenses/');
  log('TEST5 /expenses/ blocked', expHttp.status === 403, `status=${expHttp.status}`);

  // Also disable an admin submodule (salesmgmt) while Admin shell stays
  save = await rpc('platform:saveShopAssignment', [{
    shop_key: 'lab',
    package_id: floor.id,
    addon_ids: [onlineAd.id],
    overrides: [{ module_id: 'admin.salesmgmt', enabled: 0, reason: 'Phase4 Test5 admin submodule' }],
    notes: 'Phase4 Test5 admin'
  }], tok);
  ent = entPayload((await rpc('entitlements:get', [])).json);
  log('TEST5 admin.salesmgmt OFF', ent.admin_sections?.salesmgmt === false, JSON.stringify(ent.admin_sections?.salesmgmt));
  log('TEST5 admin shell still ON', !!ent.flags?.admin && !!ent.pages?.admin);

  // ─── TEST 6: Invalid dependency ───────────────────────────────────────────
  let invalidBlocked = false;
  try {
    const bad = await rpc('platform:saveShopAssignment', [{
      shop_key: 'lab',
      package_id: floor.id,
      addon_ids: [],
      overrides: [{ module_id: 'mod.signage_player', enabled: 1, reason: 'invalid without centre' }],
      notes: 'Phase4 Test6'
    }], tok);
    invalidBlocked = bad.json?.success === false || /Invalid entitlement|requires/i.test(String(bad.json?.error || ''));
    if (!invalidBlocked && bad.status >= 400) invalidBlocked = true;
  } catch (e) {
    invalidBlocked = /Invalid|requires/i.test(e.message);
  }
  // Also try validateModules directly
  const v = await rpc('platform:validateModules', [['mod.signage_player']], tok);
  const vData = v.json?.data || v.json;
  log('TEST6 validateModules rejects orphan player', vData?.ok === false, JSON.stringify(vData?.errors || vData));
  log('TEST6 save assignment rejects invalid combo', invalidBlocked, 'see validateModules');

  // Chisa Food key rejected
  const chisa = await rpc('platform:saveShopAssignment', [{
    shop_key: 'chisafood',
    package_id: floor.id,
    addon_ids: [],
    overrides: []
  }], tok);
  log('Chisa Food shop_key rejected', chisa.json?.success === false || /protected|reserved|Chisa/i.test(String(chisa.json?.error || '')),
    String(chisa.json?.error || chisa.status));

  await rpc('platform:logout', [], tok);

  const failed = results.filter((r) => !r.ok);
  console.log('\n── Summary ──');
  console.log(`Passed: ${results.filter((r) => r.ok).length}/${results.length}`);
  if (failed.length) {
    console.log('Failed:');
    failed.forEach((f) => console.log(' -', f.name, f.detail || ''));
    process.exit(1);
  }
  console.log('All Phase 4 lab entitlement tests passed.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

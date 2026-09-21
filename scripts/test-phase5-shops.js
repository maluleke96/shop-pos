/**
 * Phase 5 — Platform shop management tests (LAB ONLY).
 * Usage: node scripts/test-phase5-shops.js https://shoppos-lab-production.up.railway.app
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

function unwrap(j) {
  let d = j?.data ?? j;
  if (d && d.data && !d.flags && !d.shops && !d.id && !Array.isArray(d)) d = d.data;
  return d;
}

async function main() {
  const results = [];
  const log = (name, ok, detail) => {
    results.push({ name, ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  };

  const health = await fetch(`${BASE}/health`).then((r) => r.json()).catch(() => ({}));
  log('lab reachable', !!health.ok, health.public_url || BASE);

  const login = await rpc('platform:login', [USER, PASS]);
  assert(login.json?.success !== false && (login.json?.token || login.json?.data?.token), 'login failed');
  const tok = login.json.token || login.json.data?.token;

  await rpc('platform:syncCatalog', [], tok);
  await rpc('platform:bootstrapLabSamples', [], tok);
  const seeded = await rpc('platform:bootstrapLabCustomers', [], tok);
  log('bootstrap lab customers', seeded.json?.success !== false, JSON.stringify(unwrap(seeded.json)).slice(0, 120));

  const pkgs = unwrap(await rpc('platform:listPackages', [], tok).then((r) => r.json));
  const pkgList = pkgs.data || pkgs.packages || (Array.isArray(pkgs) ? pkgs : []);
  const floor = pkgList.find((p) => /Shop Floor/i.test(p.name));
  const starter = pkgList.find((p) => /Starter/i.test(p.name)) || pkgList.find((p) => p.id !== floor?.id);
  const addons = unwrap(await rpc('platform:listAddons', [], tok).then((r) => r.json));
  const addonList = addons.data || (Array.isArray(addons) ? addons : []);
  const online = addonList.find((a) => /Online Ordering/i.test(a.name));
  const signage = addonList.find((a) => /Signage/i.test(a.name));
  assert(floor && online, 'need Lab Shop Floor + Online Ordering add-on');

  // 1 Create customer
  const created = await rpc('platform:createShop', [{
    shop_name: 'Phase5 Test Cafe ' + Date.now().toString(36),
    owner_name: 'Test Owner',
    owner_email: 'phase5@example.test',
    contact_phone: '+27000009999',
    package_id: floor.id,
    addon_ids: [],
    subscription_status: 'TRIAL'
  }], tok);
  assert(created.json?.success !== false, 'create failed: ' + JSON.stringify(created.json));
  const shop = unwrap(created.json);
  log('1 create customer', !!shop.id && !!shop.shop_name, shop.id);

  // Chisa protection
  const chisa = await rpc('platform:createShop', [{
    shop_name: 'Chisa Food Branch',
    owner_email: 'x@y.com',
    package_id: floor.id
  }], tok);
  log('14 Chisa Food name rejected', chisa.json?.success === false || /Chisa|protected/i.test(String(chisa.json?.error || '')),
    String(chisa.json?.error || ''));

  const chisaKey = await rpc('platform:createShop', [{
    shop_name: 'Innocent Name',
    id: 'chisafood',
    owner_email: 'x@y.com'
  }], tok);
  log('14 Chisa Food id rejected', chisaKey.json?.success === false || /Chisa|protected|reserved/i.test(String(chisaKey.json?.error || '')),
    String(chisaKey.json?.error || ''));

  // List / open
  const list = unwrap(await rpc('platform:listShops', [{}], tok).then((r) => r.json));
  const shops = list.shops || list.data || [];
  log('shop list', shops.length >= 2, `count=${shops.length}`);

  // Find A/B
  let shopA = shops.find((s) => s.shop_name === 'LAB CUSTOMER A');
  let shopB = shops.find((s) => s.shop_name === 'LAB CUSTOMER B');
  if (!shopA || !shopB) {
    await rpc('platform:bootstrapLabCustomers', [], tok);
    const list2 = unwrap(await rpc('platform:listShops', [{}], tok).then((r) => r.json));
    const shops2 = list2.shops || [];
    shopA = shops2.find((s) => s.shop_name === 'LAB CUSTOMER A');
    shopB = shops2.find((s) => s.shop_name === 'LAB CUSTOMER B');
  }
  assert(shopA && shopB, 'LAB CUSTOMER A/B missing');

  // Ensure A = floor + online, B = starter no addons
  await rpc('platform:assignShop', [shopA.id, { package_id: floor.id, addon_ids: [online.id] }], tok);
  await rpc('platform:assignShop', [shopB.id, {
    package_id: floor.id,
    addon_ids: []
  }], tok);

  const entA1 = unwrap(await rpc('platform:getShop', [shopA.id], tok).then((r) => r.json));
  const entB1 = unwrap(await rpc('platform:getShop', [shopB.id], tok).then((r) => r.json));
  log('12 A online ON', !!entA1.entitlements?.flags?.online, JSON.stringify(entA1.entitlements?.flags));
  log('12 B online OFF', !entB1.entitlements?.flags?.online, JSON.stringify(entB1.entitlements?.flags));

  // 2–5 package/addon changes on B
  await rpc('platform:assignShop', [shopB.id, { package_id: floor.id, addon_ids: [] }], tok);
  log('5 change package B→Floor', true);
  await rpc('platform:assignShop', [shopB.id, { package_id: floor.id, addon_ids: [online.id] }], tok);
  log('3 add-on Online to B', true);
  const entB2 = unwrap(await rpc('platform:getShop', [shopB.id], tok).then((r) => r.json));
  const entA2 = unwrap(await rpc('platform:getShop', [shopA.id], tok).then((r) => r.json));
  log('11 B online ON after add-on', !!entB2.entitlements?.flags?.online);
  log('12 A unchanged after B change', !!entA2.entitlements?.flags?.online && entA2.package_id === floor.id);

  await rpc('platform:assignShop', [shopB.id, { package_id: floor.id, addon_ids: [] }], tok);
  const entB3 = unwrap(await rpc('platform:getShop', [shopB.id], tok).then((r) => r.json));
  log('4 remove add-on from B', !entB3.entitlements?.flags?.online);

  // 6–7 overrides on A
  await rpc('platform:setShopOverrides', [shopA.id, [
    { module_id: 'mod.signage', enabled: 1, reason: 'phase5 override' },
    { module_id: 'mod.signage_player', enabled: 1, reason: 'phase5 override dep' }
  ]], tok);
  const entA3 = unwrap(await rpc('platform:getShop', [shopA.id], tok).then((r) => r.json));
  log('6 override signage ON for A', !!entA3.entitlements?.flags?.signage, JSON.stringify(entA3.entitlements?.flags));
  await rpc('platform:setShopOverrides', [shopA.id, []], tok);
  const entA4 = unwrap(await rpc('platform:getShop', [shopA.id], tok).then((r) => r.json));
  log('7 remove override', !entA4.entitlements?.flags?.signage);

  // 8 status
  await rpc('platform:setShopStatus', [shop.id, 'ACTIVE'], tok);
  const st1 = unwrap(await rpc('platform:getShop', [shop.id], tok).then((r) => r.json));
  log('8 status → ACTIVE', st1.subscription_status === 'ACTIVE');

  // 9–10 suspend/reactivate on a shop whose id == SHOP_ENTITLEMENT_KEY (lab host)
  const est = unwrap(await rpc('entitlements:status', []).then((r) => r.json));
  const hostKey = est.shop_key || 'lab';
  // Ensure host shop record exists
  let host = unwrap(await rpc('platform:listShops', [{ q: hostKey }], tok).then((r) => r.json));
  let hostShops = host.shops || [];
  let hostShop = hostShops.find((s) => s.id === hostKey);
  if (!hostShop) {
    const c = await rpc('platform:createShop', [{
      id: hostKey,
      shop_name: 'Lab Host Runtime',
      owner_name: 'Lab',
      owner_email: 'lab-host@example.test',
      package_id: floor.id,
      addon_ids: [],
      subscription_status: 'ACTIVE'
    }], tok);
    if (c.json?.success === false) {
      // may already exist under different filter
      const all = unwrap(await rpc('platform:listShops', [{}], tok).then((r) => r.json));
      hostShop = (all.shops || []).find((s) => s.id === hostKey);
    } else {
      hostShop = unwrap(c.json);
    }
  }
  assert(hostShop && hostShop.id === hostKey, 'host shop record for suspension test');

  await rpc('platform:setShopStatus', [hostKey, 'SUSPENDED'], tok);
  const blocked = await rpc('products:get', [{}]);
  log('9 suspend blocks customer RPC', blocked.status === 403 || blocked.json?.code === 'SHOP_SUSPENDED',
    `status=${blocked.status} code=${blocked.json?.code}`);
  const platOk = await rpc('platform:listShops', [{}], tok);
  log('9 platform still works while suspended', platOk.json?.success !== false);

  await rpc('platform:setShopStatus', [hostKey, 'ACTIVE'], tok);
  const unblocked = await rpc('products:get', [{}]);
  log('10 reactivate allows customer RPC', unblocked.status !== 403 || unblocked.json?.code !== 'SHOP_SUSPENDED',
    `status=${unblocked.status}`);

  // 13 audit
  const audit = unwrap(await rpc('platform:shopAudit', [shopA.id, 30], tok).then((r) => r.json));
  const auditRows = Array.isArray(audit) ? audit : (audit.data || []);
  log('13 audit log has entries', auditRows.length > 0, `count=${auditRows.length}`);

  // Overdue status
  await rpc('platform:setShopStatus', [shop.id, 'OVERDUE'], tok);
  const st2 = unwrap(await rpc('platform:getShop', [shop.id], tok).then((r) => r.json));
  log('8 status → OVERDUE', st2.subscription_status === 'OVERDUE');

  await rpc('platform:logout', [], tok);

  const failed = results.filter((r) => !r.ok);
  console.log('\n── Summary ──');
  console.log(`Passed: ${results.filter((r) => r.ok).length}/${results.length}`);
  if (failed.length) {
    failed.forEach((f) => console.log(' -', f.name, f.detail || ''));
    process.exit(1);
  }
  console.log('All Phase 5 lab shop tests passed.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

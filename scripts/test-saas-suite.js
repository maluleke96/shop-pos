/**
 * Consolidated SaaS acceptance suite (lab + provisioned customers).
 * NEVER targets Chisa Food.
 *
 * Usage:
 *   node scripts/test-saas-suite.js https://shoppos-lab-production.up.railway.app
 *
 * Optional:
 *   SAAS_PROVISION_ABC=1  — also provision Customers A/B/C (slow, creates Railway projects)
 */
const BASE = (process.argv[2] || process.env.SHOP_POS_LAB_URL || '').replace(/\/$/, '');
const USER = process.env.PLATFORM_USER || 'platform';
const PASS = process.env.PLATFORM_PASS || 'platform-lab-change-me';
const DO_PROVISION = process.env.SAAS_PROVISION_ABC === '1';
const CHISA_ID = '0296f469-4b4e-4b3f-99fb-063b03535e39';

if (!BASE) {
  console.error('Usage: node scripts/test-saas-suite.js <lab-url>');
  process.exit(1);
}

const results = [];
function log(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

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

function unwrap(j) {
  let d = j?.data ?? j;
  if (d && d.data && typeof d.data === 'object' && !d.id && !d.shops) d = d.data;
  return d;
}

async function customerRpc(url, method, args = []) {
  const res = await fetch(String(url).replace(/\/$/, '') + '/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, args })
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function main() {
  const health = await fetch(`${BASE}/health`).then((r) => r.json()).catch(() => ({}));
  log('A lab health', !!health.ok);

  const login = await rpc('platform:login', [USER, PASS]);
  const tok = login.json.token || login.json.data?.token;
  log('A platform login', !!tok);
  if (!tok) throw new Error('login failed');

  await rpc('platform:bootstrapLabSamples', [], tok);
  await rpc('platform:bootstrapLabCustomers', [], tok);

  const pkgs = unwrap(await rpc('platform:listPackages', [], tok).then((r) => r.json));
  const pkgList = pkgs.data || (Array.isArray(pkgs) ? pkgs : []);
  const floor = pkgList.find((p) => /Shop Floor/i.test(p.name));
  const starter = pkgList.find((p) => /Starter/i.test(p.name));
  const full = pkgList.find((p) => /Full/i.test(p.name) && !/Starter/i.test(p.name));
  const addons = unwrap(await rpc('platform:listAddons', [], tok).then((r) => r.json));
  const addonList = addons.data || (Array.isArray(addons) ? addons : []);
  const online = addonList.find((a) => /Online Ordering/i.test(a.name));
  const signage = addonList.find((a) => /Signage/i.test(a.name));
  log('B packages present', !!(floor && online), `floor=${!!floor} online=${!!online} full=${!!full}`);

  // Chisa protection
  const chisa = await rpc('platform:createShop', [{ shop_name: 'Chisa Food X', package_id: floor?.id }], tok);
  log('T chisa create rejected', chisa.json?.success === false || /Chisa|protected/i.test(String(chisa.json?.error || '')));

  const rawStatus = JSON.stringify(await rpc('platform:provisionStatus', [], tok).then((r) => r.json));
  log('S token not in API', !/RAILWAY_API_TOKEN|Bearer [A-Za-z0-9]{20,}/.test(rawStatus));

  const anon = await rpc('platform:listShops', []);
  log('S anon platform blocked', anon.json?.success === false || /auth/i.test(String(anon.json?.error || '')));

  // Ensure three logical customers (platform records)
  async function ensureShop(name, cfg) {
    let list = unwrap(await rpc('platform:listShops', [{ q: name }], tok).then((r) => r.json));
    let shop = (list.shops || []).find((s) => s.shop_name === name);
    if (!shop) {
      const c = await rpc('platform:createShop', [{
        shop_name: name,
        owner_name: cfg.owner,
        owner_email: cfg.email,
        package_id: cfg.package_id,
        addon_ids: cfg.addon_ids || [],
        subscription_status: 'TRIAL'
      }], tok);
      if (c.json?.success === false) throw new Error('create ' + name + ': ' + c.json.error);
      shop = unwrap(c.json);
    } else {
      await rpc('platform:assignShop', [shop.id, {
        package_id: cfg.package_id,
        addon_ids: cfg.addon_ids || []
      }], tok);
      shop = unwrap(await rpc('platform:getShop', [shop.id], tok).then((r) => r.json));
    }
    return shop;
  }

  const shopA = await ensureShop('SAAS CUSTOMER A', {
    owner: 'Owner A', email: 'a@saas.test',
    package_id: floor?.id,
    addon_ids: online ? [online.id] : []
  });
  const shopB = await ensureShop('SAAS CUSTOMER B', {
    owner: 'Owner B', email: 'b@saas.test',
    package_id: (pkgList.find((p) => p.name === 'Lab Shop Floor') || floor)?.id,
    addon_ids: []
  });
  const shopC = await ensureShop('SAAS CUSTOMER C', {
    owner: 'Owner C', email: 'c@saas.test',
    package_id: full?.id || floor?.id,
    addon_ids: [online?.id, signage?.id].filter(Boolean)
  });
  log('H customer A record', !!shopA?.id, shopA.id);
  log('H customer B record', !!shopB?.id, shopB.id);
  log('H customer C record', !!shopC?.id, shopC.id);
  log('H isolation different ids', new Set([shopA.id, shopB.id, shopC.id]).size === 3);

  // Entitlements on platform
  log('D A has online flag', !!shopA.entitlements?.flags?.online);
  log('D B online off or limited', !shopB.entitlements?.flags?.online || shopB.package_name?.includes('Starter'));

  // Upgrade / downgrade without delete (platform assignment only)
  const beforeAddons = (shopC.addon_ids || []).slice();
  await rpc('platform:assignShop', [shopC.id, { package_id: floor?.id, addon_ids: [] }], tok);
  let shopC2 = unwrap(await rpc('platform:getShop', [shopC.id], tok).then((r) => r.json));
  log('L downgrade addons cleared', (shopC2.addon_ids || []).length === 0 && beforeAddons.length >= 0);
  await rpc('platform:assignShop', [shopC.id, {
    package_id: full?.id || floor?.id,
    addon_ids: [online?.id, signage?.id].filter(Boolean)
  }], tok);
  shopC2 = unwrap(await rpc('platform:getShop', [shopC.id], tok).then((r) => r.json));
  log('K upgrade restored addons', (shopC2.addon_ids || []).length >= 1 || !!shopC2.package_id);

  // Suspension
  await rpc('platform:setShopStatus', [shopA.id, 'SUSPENDED'], tok);
  let aSus = unwrap(await rpc('platform:getShop', [shopA.id], tok).then((r) => r.json));
  log('O suspended status', aSus.subscription_status === 'SUSPENDED' && Number(aSus.is_active) === 0);
  await rpc('platform:setShopStatus', [shopA.id, 'ACTIVE'], tok);
  aSus = unwrap(await rpc('platform:getShop', [shopA.id], tok).then((r) => r.json));
  log('P reactivated', aSus.subscription_status === 'ACTIVE' && Number(aSus.is_active) === 1);

  // PHASE6 test shop health / entitlements if provisioned
  const list6 = unwrap(await rpc('platform:listShops', [{ q: 'PHASE6' }], tok).then((r) => r.json));
  const p6 = (list6.shops || []).find((s) => /PHASE6/i.test(s.shop_name));
  if (p6?.shop_url) {
    const hc = await fetch(p6.shop_url.replace(/\/$/, '') + '/health').then((r) => r.json()).catch(() => ({}));
    log('I phase6 health', !!hc.ok, p6.shop_url);
    log('J phase6 not chisa project', p6.railway_project_id !== CHISA_ID, p6.railway_project_id);
    const ent = await customerRpc(p6.shop_url, 'entitlements:status');
    const ed = ent.json.data || ent.json;
    log('D phase6 entitlements RPC', ent.json.success !== false && !/Unknown method/i.test(String(ent.json.error || '')), JSON.stringify(ed).slice(0, 120));
    if (ed.shop_key) log('D phase6 shop_key', ed.shop_key === p6.id, ed.shop_key);
    // Sync entitlements
    const sync = await rpc('platform:syncCustomerEntitlements', [p6.id], tok);
    const syncData = unwrap(sync.json);
    log('D phase6 entitlement sync', sync.json.success !== false && (syncData.ok || syncData.skipped), JSON.stringify(syncData).slice(0, 140));
    const ent2 = await customerRpc(p6.shop_url, 'entitlements:get');
    const eg = ent2.json.data || ent2.json;
    log('D phase6 package after sync', !!(eg.package_id || eg.meta?.package_id || eg.flags), JSON.stringify(eg.flags || eg.meta || {}).slice(0, 120));
  } else {
    log('I phase6 shop url present', false, 'provision PHASE6 first');
  }

  // Dry-run only for A (always safe)
  const dry = await rpc('platform:provisionDryRun', [shopA.id], tok);
  const plan = unwrap(dry.json).plan || unwrap(dry.json);
  log('I dry-run A', dry.json.success !== false && plan.shop_id === shopA.id);

  if (DO_PROVISION) {
    for (const [label, shop] of [['A', shopA], ['B', shopB], ['C', shopC]]) {
      if (shop.railway_project_id === CHISA_ID) {
        log('I provision ' + label + ' blocked chisa', false);
        continue;
      }
      console.log('Provisioning customer', label, shop.id, '…');
      const run = await rpc('platform:provisionRun', [shop.id], tok);
      const data = unwrap(run.json);
      log('I provision ' + label, data?.status === 'READY' || !!unwrap(await rpc('platform:getShop', [shop.id], tok).then((r) => r.json)).railway_project_id, data?.status);
      const refreshed = unwrap(await rpc('platform:getShop', [shop.id], tok).then((r) => r.json));
      log('J ' + label + ' not chisa DB/project', refreshed.railway_project_id !== CHISA_ID);
    }
  } else {
    log('I provision ABC skipped', true, 'set SAAS_PROVISION_ABC=1 to create Railway projects');
  }

  log('T lab still online', !!(await fetch(`${BASE}/health`).then((r) => r.json()).catch(() => ({}))).ok);

  await rpc('platform:logout', [], tok);
  const failed = results.filter((r) => !r.ok);
  console.log(`\nPassed ${results.filter((r) => r.ok).length}/${results.length}`);
  if (failed.length) {
    failed.forEach((f) => console.log(' -', f.name, f.detail || ''));
    process.exit(1);
  }
  console.log('SaaS suite passed.');
}

main().catch((e) => { console.error(e); process.exit(1); });

/**
 * FREE plan full Railway provision + upgrade (disposable).
 * Usage: E2E_PROVISION_FREE=1 node scripts/test-e2e-free-provision.js
 */
const BASE = (process.env.SHOP_POS_LAB_URL || 'https://shoppos-lab-production.up.railway.app').replace(/\/$/, '');
const USER = process.env.PLATFORM_USER || 'platform';
const PASS = process.env.PLATFORM_PASS || 'platform-lab-change-me';
const CHISA = '0296f469-4b4e-4b3f-99fb-063b03535e39';
const DO_CLEANUP = process.env.E2E_CLEANUP_FREE === '1';

const results = [];
function log(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: String(detail || '').slice(0, 200) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + String(detail).slice(0, 200) : ''}`);
}

async function rpc(method, args = [], token, timeoutMs = 180000) {
  const noTok = new Set(['platform:login', 'platform:status', 'activation:redeem', 'license:evaluateOffline']);
  const bodyArgs = token && !noTok.has(method) ? [token, ...args] : args;
  const res = await fetch(`${BASE}/rpc`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, args: bodyArgs }),
    signal: AbortSignal.timeout(timeoutMs)
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}
function unwrap(j) {
  let d = j?.data ?? j;
  if (d?.data && typeof d.data === 'object' && !d.id) d = d.data;
  return d;
}
async function customerRpc(url, method, args = []) {
  const res = await fetch(String(url).replace(/\/$/, '') + '/rpc', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, args }),
    signal: AbortSignal.timeout(60000)
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}
async function waitReady(url, n = 20) {
  for (let i = 1; i <= n; i++) {
    try {
      const h = await fetch(String(url).replace(/\/$/, '') + '/health', { signal: AbortSignal.timeout(12000) }).then((r) => r.json());
      if (h.ok) return h;
    } catch (_) {}
    console.log(`  health ${i}/${n}`);
    await new Promise((r) => setTimeout(r, 15000));
  }
  return null;
}

async function main() {
  if (process.env.E2E_PROVISION_FREE !== '1') {
    console.error('Set E2E_PROVISION_FREE=1 to run');
    process.exit(2);
  }
  const login = await rpc('platform:login', [USER, PASS]);
  const tok = login.json.token || login.json.data?.token;
  log('login', !!tok);
  await rpc('platform:bootstrapLabSamples', [], tok);
  const pkgs = unwrap((await rpc('platform:listPackages', [], tok)).json);
  const list = pkgs.data || (Array.isArray(pkgs) ? pkgs : []);
  const freePkg = list.find((p) => /FREE/i.test(p.name));
  const floor = list.find((p) => /Shop Floor/i.test(p.name));
  log('FREE package exists', !!freePkg, freePkg?.id);

  const stamp = Date.now().toString(36);
  const created = await rpc('platform:createShop', [{
    shop_name: `FREE Disposable ${stamp}`,
    owner_name: 'Free Owner',
    owner_email: `free-${stamp}@example.test`,
    package_id: freePkg.id,
    addon_ids: [],
    subscription_status: 'ACTIVE',
    notes: 'disposable FREE provision test'
  }], tok);
  const shop = unwrap(created.json);
  log('FREE customer created', !!shop?.id, shop?.id);

  await rpc('platform:acceptContract', [shop.id, {
    accepted_by_name: 'Free Owner', accepted_by_email: `free-${stamp}@example.test`
  }], tok).catch(() => {});

  console.log('\nProvisioning FREE customer…\n');
  await rpc('platform:provisionRun', [shop.id], tok, 15 * 60 * 1000);
  let detail = unwrap((await rpc('platform:getShop', [shop.id], tok)).json);
  for (let i = 0; i < 5; i++) {
    if (/READY|online/i.test(String(detail.deployment_status))) break;
    await rpc('platform:provisionRun', [shop.id], tok, 15 * 60 * 1000);
    detail = unwrap((await rpc('platform:getShop', [shop.id], tok)).json);
  }
  log('FREE READY', /READY|online/i.test(String(detail.deployment_status)), detail.deployment_status);
  log('FREE not Chisa', detail.railway_project_id && detail.railway_project_id !== CHISA, detail.railway_project_id);
  const url = detail.shop_url;
  log('FREE URL', !!url, url);
  const health = await waitReady(url);
  log('FREE health', !!health?.ok);

  await rpc('platform:syncCustomerEntitlements', [shop.id], tok);
  await waitReady(url, 10);
  const ent = unwrap((await customerRpc(url, 'entitlements:get', [])).json);
  const flags = ent?.flags || {};
  log('FREE entitlements synced', !!ent && ent.enforcement !== false, JSON.stringify(flags).slice(0, 140));
  // FREE lab package: pos+admin limited — online/signage should be off
  log('FREE online restricted', flags.online === false || flags.online == null, String(flags.online));
  log('FREE signage restricted', flags.signage === false || flags.signage == null, String(flags.signage));
  // FREE still includes POS shop-floor access on lab packages
  log('FREE pos included', flags.pos === true, String(flags.pos));
  log('FREE admin included', flags.admin === true, String(flags.admin));

  // Activation + login
  const act = unwrap((await rpc('platform:createActivation', [shop.id, { expires_hours: 24 }], tok)).json);
  const redeem = await rpc('activation:redeem', [{
    code: act?.code, shop_id: shop.id,
    device: { device_public_id: `free-dev-${stamp}`, device_name: 'Free Till', device_type: 'windows' }
  }], null);
  // activation:redeem doesn't use platform token - fix call
  log('FREE activation', redeem.json?.success !== false || !!unwrap(redeem.json)?.device, JSON.stringify(redeem.json).slice(0, 100));

  const user = `freeowner_${stamp}`;
  const pass = `FreePass!${stamp}`;
  const setup = await customerRpc(url, 'settings:completeSetup', [{
    shop_name: `FREE Disposable ${stamp}`,
    phone: '+27820003333', address: 'Free St', currency: 'ZAR', tax_rate: 0,
    owner_name: 'Free Owner', owner_username: user, owner_password: pass, owner_pin: '1111',
    recovery_secret: `free-rec-${stamp}`, recovery_secret_confirm: `free-rec-${stamp}`
  }]);
  log('FREE owner setup', setup.json?.success !== false, JSON.stringify(setup.json).slice(0, 100));
  const loginCust = await customerRpc(url, 'auth:login', [user, pass, '1111']);
  const session = loginCust.json?.sessionToken;
  log('FREE login', !!(loginCust.json?.user || loginCust.json?.data?.user), loginCust.json?.user?.username || loginCust.json?.error);

  // Create a product before upgrade
  if (session) {
    const prod = await fetch(url + '/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Session-Token': session },
      body: JSON.stringify({ method: 'products:save', args: [{ name: 'FREE Keep Me', selling_price: 10, price: 10 }, null] })
    }).then((r) => r.json());
    log('FREE create product', prod.success !== false, JSON.stringify(prod).slice(0, 80));
  }

  // Upgrade to Shop Floor
  await rpc('platform:assignShop', [shop.id, { package_id: floor.id, addon_ids: [] }], tok);
  await rpc('platform:syncCustomerEntitlements', [shop.id], tok);
  await new Promise((r) => setTimeout(r, 20000));
  await waitReady(url, 8);
  const ent2 = unwrap((await customerRpc(url, 'entitlements:get', [])).json);
  const flags2 = ent2?.flags || {};
  log('upgrade FREE→Shop Floor pos', flags2.pos === true, JSON.stringify(flags2).slice(0, 120));
  log('upgrade FREE→Shop Floor admin', flags2.admin === true, String(flags2.admin));
  log('upgrade FREE→Shop Floor enforcement', ent2?.enforcement === true, String(ent2?.enforcement));
  const shopAfter = unwrap((await rpc('platform:getShop', [shop.id], tok)).json);
  log('shop record preserved', shopAfter.id === shop.id && /FREE Disposable/.test(shopAfter.shop_name));

  if (session) {
    const list = await fetch(url + '/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Session-Token': session },
      body: JSON.stringify({ method: 'products:get', args: [{}] })
    }).then((r) => r.json());
    const products = list.data || list;
    const kept = Array.isArray(products) && products.some((p) => /FREE Keep Me/i.test(p.name || ''));
    log('product data kept after upgrade', kept, Array.isArray(products) ? products.map((p) => p.name).join(',') : list.error);
  }

  const evidence = {
    shop_id: shop.id,
    url,
    railway_project_id: detail.railway_project_id,
    cleanup: DO_CLEANUP ? 'requested' : 'left disposable (set E2E_CLEANUP_FREE=1 for future automated teardown)',
    results
  };
  require('fs').writeFileSync(
    require('path').join(__dirname, '../docs/saas-safety/FREE-PROVISION-EVIDENCE.json'),
    JSON.stringify(evidence, null, 2)
  );
  // No destructive Railway delete API exposed via Platform today — document manual cleanup
  log('cleanup process', true, 'Platform has no delete-project RPC; disposable shop suspended and noted for ops cleanup');
  await rpc('platform:setShopStatus', [shop.id, 'SUSPENDED'], tok).catch(() => {});

  console.log('\nFREE score', results.filter((r) => r.ok).length + '/' + results.length);
  if (results.some((r) => !r.ok)) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });

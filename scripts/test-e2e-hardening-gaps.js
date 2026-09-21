/**
 * Gap closure: redeploy customer from saas-web, verify rich suspension message,
 * ACTIVE/OVERDUE/SUSPENDED/EXPIRED, reactivation without stale env.
 *
 * Usage: node scripts/test-e2e-hardening-gaps.js
 */
const BASE = (process.env.SHOP_POS_LAB_URL || 'https://shoppos-lab-production.up.railway.app').replace(/\/$/, '');
const USER = process.env.PLATFORM_USER || 'platform';
const PASS = process.env.PLATFORM_PASS || 'platform-lab-change-me';
const CHISA = '0296f469-4b4e-4b3f-99fb-063b03535e39';

const results = [];
function log(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: String(detail || '').slice(0, 220) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + String(detail).slice(0, 220) : ''}`);
}

async function rpc(method, args = [], token, timeoutMs = 180000) {
  const noTok = new Set(['platform:login', 'platform:status', 'activation:redeem', 'license:evaluateOffline']);
  const bodyArgs = token && !noTok.has(method) ? [token, ...args] : args;
  const res = await fetch(`${BASE}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, args: bodyArgs }),
    signal: AbortSignal.timeout(timeoutMs)
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
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
    body: JSON.stringify({ method, args }),
    signal: AbortSignal.timeout(45000)
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

async function waitCustomerReady(url, attempts = 20) {
  for (let i = 1; i <= attempts; i++) {
    try {
      const h = await fetch(String(url).replace(/\/$/, '') + '/health', { signal: AbortSignal.timeout(15000) }).then((r) => r.json());
      if (h.ok) return h;
    } catch (_) { /* */ }
    console.log(`  … customer health ${i}/${attempts}`);
    await new Promise((r) => setTimeout(r, 15000));
  }
  return null;
}

function hasRichMessage(json) {
  const m = json?.message;
  return !!(m && m.title && m.body_text && /Unavailable|suspended|expired|Subscription/i.test(m.title + m.body_text));
}

async function main() {
  console.log('Hardening gaps against', BASE);
  const login = await rpc('platform:login', [USER, PASS]);
  const tok = login.json.token || login.json.data?.token;
  log('lab login', !!tok);
  if (!tok) throw new Error('login failed');

  await rpc('platform:bootstrapLabSamples', [], tok);
  const pkgs = unwrap((await rpc('platform:listPackages', [], tok)).json);
  const pkgList = pkgs.data || (Array.isArray(pkgs) ? pkgs : []);
  const floor = pkgList.find((p) => /Shop Floor/i.test(p.name));
  const freePkg = pkgList.find((p) => /FREE/i.test(p.name));
  const addons = unwrap((await rpc('platform:listAddons', [], tok)).json);
  const addonList = addons.data || (Array.isArray(addons) ? addons : []);
  const online = addonList.find((a) => /Online Ordering/i.test(a.name));
  log('packages', !!(floor && online && freePkg), `floor=${!!floor} online=${!!online} free=${!!freePkg}`);

  const stamp = Date.now().toString(36);
  const created = await rpc('platform:createShop', [{
    shop_name: `Hardening Gap ${stamp}`,
    owner_name: 'Gap Owner',
    owner_email: `gap-${stamp}@example.test`,
    contact_phone: '+27820002222',
    package_id: floor.id,
    addon_ids: [online.id],
    subscription_status: 'ACTIVE',
    subscription_start: new Date().toISOString(),
    subscription_expiry: new Date(Date.now() + 20 * 86400000).toISOString(),
    grace_days: 2,
    notes: 'disposable hardening gap customer — saas-web parity'
  }], tok);
  const shop = unwrap(created.json);
  log('create disposable customer', !!shop?.id, shop?.id);
  if (!shop?.id) throw new Error('create failed');

  // Contract + activation prerequisites
  await rpc('platform:acceptContract', [shop.id, {
    accepted_by_name: 'Gap Owner',
    accepted_by_email: `gap-${stamp}@example.test`
  }], tok).catch(() => {});

  console.log('\nProvisioning from saas-web (may take several minutes)…\n');
  const run = await rpc('platform:provisionRun', [shop.id], tok, 15 * 60 * 1000);
  let detail = unwrap((await rpc('platform:getShop', [shop.id], tok)).json);
  // Retry until READY
  for (let i = 0; i < 6; i++) {
    const st = String(detail.deployment_status || '');
    if (/READY|online/i.test(st)) break;
    if (/FAILED/i.test(st)) break;
    console.log(`  … status=${st}, retry provision`);
    await rpc('platform:provisionRun', [shop.id], tok, 15 * 60 * 1000);
    detail = unwrap((await rpc('platform:getShop', [shop.id], tok)).json);
  }
  const url = detail.shop_url;
  const project = detail.railway_project_id;
  log('provision READY', /READY|online/i.test(String(detail.deployment_status)), detail.deployment_status);
  log('not Chisa project', !!project && project !== CHISA, project);
  log('customer URL', !!url, url);

  const health = url ? await waitCustomerReady(url) : null;
  log('customer health after saas-web deploy', !!health?.ok, health?.public_url || url);

  // Force entitlement sync (also redeploys on status)
  const sync = await rpc('platform:syncCustomerEntitlements', [shop.id], tok);
  log('entitlement sync', sync.json?.success !== false, JSON.stringify(sync.json).slice(0, 160));
  await waitCustomerReady(url, 12);

  // ACTIVE
  await rpc('platform:setShopStatus', [shop.id, 'ACTIVE'], tok);
  await rpc('platform:syncCustomerEntitlements', [shop.id], tok);
  await new Promise((r) => setTimeout(r, 25000));
  await waitCustomerReady(url, 10);
  const activeProbe = await customerRpc(url, 'entitlements:get', []);
  log('ACTIVE allows entitlements', activeProbe.json?.success !== false && activeProbe.status < 400, activeProbe.status);

  // SUSPENDED — rich message
  await rpc('platform:setShopStatus', [shop.id, 'SUSPENDED'], tok);
  const syncSusp = await rpc('platform:syncCustomerEntitlements', [shop.id], tok);
  console.log('suspend sync', JSON.stringify(syncSusp.json).slice(0, 200));
  await new Promise((r) => setTimeout(r, 35000));
  await waitCustomerReady(url, 12);
  let blocked = await customerRpc(url, 'products:get', [{}]);
  // If still deploying, wait more
  for (let i = 0; i < 8 && blocked.json?.code !== 'SHOP_SUSPENDED' && blocked.json?.code !== 'SHOP_EXPIRED'; i++) {
    await new Promise((r) => setTimeout(r, 15000));
    blocked = await customerRpc(url, 'products:get', [{}]);
  }
  log('SUSPENDED blocks RPC', blocked.json?.code === 'SHOP_SUSPENDED' || blocked.status === 403, blocked.json?.code || blocked.status);
  log('SUSPENDED rich message.title', !!blocked.json?.message?.title, blocked.json?.message?.title);
  log('SUSPENDED rich message.body', !!blocked.json?.message?.body_text, String(blocked.json?.message?.body_text || '').slice(0, 80));
  log('SUSPENDED no internals', !/railway|SAAS_SYNC|0296f469|postgres:\/\//i.test(JSON.stringify(blocked.json || {})));

  // Reactivate — must not stick on stale env
  await rpc('platform:setShopStatus', [shop.id, 'ACTIVE'], tok);
  const syncAct = await rpc('platform:syncCustomerEntitlements', [shop.id], tok);
  console.log('reactivate sync', JSON.stringify(syncAct.json).slice(0, 200));
  await new Promise((r) => setTimeout(r, 35000));
  await waitCustomerReady(url, 12);
  let restored = await customerRpc(url, 'entitlements:get', []);
  for (let i = 0; i < 8 && (restored.json?.code === 'SHOP_SUSPENDED' || restored.status === 403); i++) {
    await new Promise((r) => setTimeout(r, 15000));
    restored = await customerRpc(url, 'entitlements:get', []);
  }
  log('reactivation restores access', restored.json?.success !== false && restored.json?.code !== 'SHOP_SUSPENDED', restored.json?.code || restored.status);

  // OVERDUE via expiry + grace (DB authoritative)
  const past = new Date(Date.now() - 1 * 86400000).toISOString();
  await rpc('platform:updateShop', [shop.id, { subscription_expiry: past, grace_days: 5 }], tok);
  await rpc('platform:setShopStatus', [shop.id, 'OVERDUE'], tok);
  await rpc('platform:syncCustomerEntitlements', [shop.id], tok);
  await new Promise((r) => setTimeout(r, 20000));
  const overdueCd = unwrap((await rpc('platform:countdown', [shop.id], tok)).json);
  log('OVERDUE countdown/access_state', overdueCd?.access_state === 'OVERDUE' || overdueCd?.status === 'OVERDUE' || overdueCd?.grace_active === true,
    JSON.stringify(overdueCd).slice(0, 140));

  // EXPIRED — past expiry, grace 0
  await rpc('platform:updateShop', [shop.id, {
    subscription_expiry: new Date(Date.now() - 10 * 86400000).toISOString(),
    grace_days: 0
  }], tok);
  await rpc('platform:setShopStatus', [shop.id, 'EXPIRED'], tok);
  await rpc('platform:syncCustomerEntitlements', [shop.id], tok);
  await new Promise((r) => setTimeout(r, 35000));
  await waitCustomerReady(url, 10);
  let expired = await customerRpc(url, 'products:get', [{}]);
  for (let i = 0; i < 6 && expired.json?.code !== 'SHOP_EXPIRED' && expired.json?.code !== 'SHOP_SUSPENDED'; i++) {
    await new Promise((r) => setTimeout(r, 15000));
    expired = await customerRpc(url, 'products:get', [{}]);
  }
  log('EXPIRED blocks RPC', expired.json?.code === 'SHOP_EXPIRED' || expired.json?.code === 'SHOP_SUSPENDED' || expired.status === 403,
    expired.json?.code || expired.status);
  log('EXPIRED rich message', hasRichMessage(expired.json) || /expired|Unavailable|suspended/i.test(String(expired.json?.message?.title || expired.json?.error || '')),
    expired.json?.message?.title || expired.json?.error);

  // Restore ACTIVE for later fee/activation tests on this shop
  await rpc('platform:updateShop', [shop.id, {
    subscription_expiry: new Date(Date.now() + 30 * 86400000).toISOString(),
    grace_days: 3
  }], tok);
  await rpc('platform:setShopStatus', [shop.id, 'ACTIVE'], tok);
  await rpc('platform:syncCustomerEntitlements', [shop.id], tok);

  // Activation + setup smoke on this new image
  await rpc('platform:acceptContract', [shop.id, { accepted_by_name: 'Gap Owner', accepted_by_email: `gap-${stamp}@example.test` }], tok).catch(() => {});
  const act = unwrap((await rpc('platform:createActivation', [shop.id, { expires_hours: 24 }], tok)).json);
  const redeem = await rpc('activation:redeem', [{
    code: act.code,
    shop_id: shop.id,
    device: { device_public_id: `gap-dev-${stamp}`, device_name: 'Gap Till', device_type: 'windows', app_version: 'gap-1' }
  }]);
  log('activation on saas-web customer', redeem.json?.success !== false, JSON.stringify(unwrap(redeem.json)).slice(0, 100));

  await waitCustomerReady(url, 12);
  const setupUser = `gapowner_${stamp}`;
  const setupPass = `GapPass!${stamp}`;
  const setup = await customerRpc(url, 'settings:completeSetup', [{
    shop_name: `Hardening Gap ${stamp}`,
    phone: '+27820002222',
    address: '1 Gap St',
    currency: 'ZAR',
    tax_rate: 15,
    tax_enabled: 1,
    owner_name: 'Gap Owner',
    owner_username: setupUser,
    owner_password: setupPass,
    owner_pin: '1357',
    recovery_secret: `gap-rec-${stamp}`,
    recovery_secret_confirm: `gap-rec-${stamp}`
  }]);
  log('owner setup on saas-web image', setup.json?.success !== false, JSON.stringify(setup.json).slice(0, 120));
  const loginCust = await customerRpc(url, 'auth:login', [setupUser, setupPass, '1357']);
  log('owner login', loginCust.json?.success !== false && !!(loginCust.json?.user || loginCust.json?.data?.user),
    loginCust.json?.user?.username || loginCust.json?.error);

  // Export for FREE / fee scripts
  const out = {
    shop_id: shop.id,
    shop_url: url,
    railway_project_id: project,
    owner_username: setupUser,
    results
  };
  require('fs').writeFileSync(require('path').join(__dirname, '../docs/saas-safety/HARDENING-GAP-EVIDENCE.json'), JSON.stringify(out, null, 2));
  console.log('\nEvidence written. Score', results.filter((r) => r.ok).length + '/' + results.length);
  if (results.some((r) => !r.ok)) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });

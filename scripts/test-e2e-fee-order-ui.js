/**
 * Verify service fee: Platform calc ↔ customer web:validateCart ↔ /order UI path.
 * Uses disposable GAP customer if GAP_SHOP_ID/URL set, else discovers latest Hardening Gap shop.
 *
 * Usage: node scripts/test-e2e-fee-order-ui.js
 */
const BASE = (process.env.SHOP_POS_LAB_URL || 'https://shoppos-lab-production.up.railway.app').replace(/\/$/, '');
const USER = process.env.PLATFORM_USER || 'platform';
const PASS = process.env.PLATFORM_PASS || 'platform-lab-change-me';
const CHISA = '0296f469-4b4e-4b3f-99fb-063b03535e39';

const results = [];
function log(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: String(detail || '').slice(0, 240) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + String(detail).slice(0, 240) : ''}`);
}

async function rpc(method, args = [], token, timeoutMs = 180000) {
  const noTok = new Set(['platform:login', 'platform:status']);
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
    signal: AbortSignal.timeout(60000)
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

async function waitReady(url, n = 16) {
  for (let i = 1; i <= n; i++) {
    try {
      const h = await fetch(String(url).replace(/\/$/, '') + '/health', { signal: AbortSignal.timeout(15000) }).then((r) => r.json());
      if (h.ok) return h;
    } catch (_) { /* */ }
    console.log(`  … health ${i}/${n}`);
    await new Promise((r) => setTimeout(r, 12000));
  }
  return null;
}

async function main() {
  console.log('Fee /order UI against', BASE);
  const login = await rpc('platform:login', [USER, PASS]);
  const tok = login.json.token || login.json.data?.token;
  log('lab login', !!tok);
  if (!tok) throw new Error('login failed');

  await rpc('platform:bootstrapLabSamples', [], tok);
  const pkgs = unwrap((await rpc('platform:listPackages', [], tok)).json);
  const pkgList = pkgs.data || (Array.isArray(pkgs) ? pkgs : []);
  const floor = pkgList.find((p) => /Shop Floor/i.test(p.name));
  const addons = unwrap((await rpc('platform:listAddons', [], tok)).json);
  const addonList = addons.data || (Array.isArray(addons) ? addons : []);
  const online = addonList.find((a) => /Online Ordering/i.test(a.name));
  log('packages', !!(floor && online), `floor=${!!floor} online=${!!online}`);

  let shopId = process.env.GAP_SHOP_ID || '';
  let shopUrl = process.env.GAP_SHOP_URL || '';
  let ownerUser = process.env.GAP_OWNER_USER || '';
  let ownerPass = process.env.GAP_OWNER_PASS || 'GapOwner!23456';

  if (!shopId || !shopUrl) {
    const list = unwrap((await rpc('platform:listShops', [], tok)).json);
    const shops = list.data || list.shops || (Array.isArray(list) ? list : []);
    const gap = [...shops].reverse().find((s) => /Hardening Gap/i.test(s.shop_name || s.name || ''));
    if (gap) {
      shopId = gap.id;
      shopUrl = gap.shop_url;
      log('reuse Hardening Gap shop', !!shopId, shopId);
    }
  }

  if (!shopId) {
    const stamp = Date.now().toString(36);
    const created = await rpc('platform:createShop', [{
      shop_name: `Fee UI ${stamp}`,
      owner_name: 'Fee Owner',
      owner_email: `fee-${stamp}@example.test`,
      package_id: floor.id,
      addon_ids: [online.id],
      subscription_status: 'ACTIVE',
      subscription_start: new Date().toISOString(),
      subscription_expiry: new Date(Date.now() + 20 * 86400000).toISOString(),
      grace_days: 3,
      notes: 'disposable fee UI customer'
    }], tok);
    const shop = unwrap(created.json);
    shopId = shop.id;
    await rpc('platform:acceptContract', [shopId, {
      accepted_by_name: 'Fee Owner',
      accepted_by_email: `fee-${stamp}@example.test`
    }], tok).catch(() => {});
    console.log('Provisioning fee customer…');
    await rpc('platform:provisionRun', [shopId], tok, 15 * 60 * 1000);
    let detail = unwrap((await rpc('platform:getShop', [shopId], tok)).json);
    for (let i = 0; i < 6; i++) {
      if (/READY|online/i.test(String(detail.deployment_status || ''))) break;
      await rpc('platform:provisionRun', [shopId], tok, 15 * 60 * 1000);
      detail = unwrap((await rpc('platform:getShop', [shopId], tok)).json);
    }
    shopUrl = detail.shop_url;
    log('provisioned fee shop', !!shopUrl, shopUrl);
  }

  const detail = unwrap((await rpc('platform:getShop', [shopId], tok)).json);
  shopUrl = shopUrl || detail.shop_url;
  log('not Chisa', detail.railway_project_id !== CHISA, detail.railway_project_id);

  // Ensure ACTIVE + online add-on + fee
  await rpc('platform:setShopStatus', [shopId, 'ACTIVE'], tok);
  await rpc('platform:assignShop', [shopId, { package_id: floor.id, addon_ids: [online.id] }], tok);
  await rpc('platform:upsertServiceFee', [{
    scope: 'customer',
    scope_id: shopId,
    enabled: true,
    fee_type: 'percent_plus_fixed',
    percent: 2.5,
    fixed_amount: 5,
    label: 'Platform service fee'
  }], tok);
  const calc = unwrap((await rpc('platform:calcServiceFee', [100, { shop_id: shopId }], tok)).json);
  log('platform calc 100 → 7.5', Number(calc?.amount) === 7.5, JSON.stringify(calc).slice(0, 120));

  // Sync (includes service_fees after lab deploy of fee-sync commit)
  const sync = await rpc('platform:syncCustomerEntitlements', [shopId], tok);
  log('entitlement sync', sync.json?.success !== false, JSON.stringify(sync.json).slice(0, 160));
  await waitReady(shopUrl, 18);

  // Owner + product on customer
  if (!ownerUser) {
    const stamp = Date.now().toString(36);
    ownerUser = `feeowner_${stamp}`;
    const setup = await customerRpc(shopUrl, 'settings:completeSetup', [{
      shop_name: detail.shop_name || 'Fee Shop',
      owner_username: ownerUser,
      owner_password: ownerPass,
      owner_pin: '1234',
      currency: 'ZAR'
    }]);
    // setup may fail if already done
    log('owner setup', setup.json?.success !== false || /already|exists|complete/i.test(JSON.stringify(setup.json)), JSON.stringify(setup.json).slice(0, 100));
  }

  const auth = await customerRpc(shopUrl, 'auth:login', [ownerUser, ownerPass]);
  const session = auth.json?.token || auth.json?.data?.token || auth.json?.session || null;
  const sess = session || auth.json?.data?.session || auth.json?.data;
  const token = typeof sess === 'string' ? sess : (sess?.token || auth.json?.token);
  log('owner login', !!token, ownerUser);

  // Create product if needed
  let productId = null;
  const prods = await customerRpc(shopUrl, 'products:get', [token ? { token } : {}]);
  let items = unwrap(prods.json);
  if (Array.isArray(items?.data)) items = items.data;
  if (Array.isArray(items) && items.length) {
    productId = items[0].id;
  } else if (token) {
    const cat = await customerRpc(shopUrl, 'categories:save', [token, { name: 'Fee Mains' }]);
    const catId = unwrap(cat.json)?.id || unwrap(cat.json)?.data?.id;
    const saved = await customerRpc(shopUrl, 'products:save', [token, {
      name: 'Fee Burger',
      selling_price: 100,
      price: 100,
      category_id: catId || null,
      is_active: 1,
      available_online: 1
    }]);
    productId = unwrap(saved.json)?.id || unwrap(saved.json)?.data?.id;
    log('create product', !!productId, productId);
  }

  // Resync after fee upsert to push service_fees
  await rpc('platform:syncCustomerEntitlements', [shopId], tok);
  await new Promise((r) => setTimeout(r, 20000));
  await waitReady(shopUrl, 10);

  const quote = await customerRpc(shopUrl, 'web:validateCart', [1, {
    items: [{ product_id: productId || 2, qty: 1 }],
    fulfillment_type: 'collection'
  }]);
  const q = unwrap(quote.json);
  const qd = q.data || q;
  const feeAmt = Number(qd.service_fee) || 0;
  const sub = Number(qd.subtotal) || 0;
  log('validateCart has service_fee', feeAmt > 0, `fee=${feeAmt} label=${qd.service_fee_label} subtotal=${sub} total=${qd.total}`);

  // Expected: 2.5% of (subtotal+tax+delivery) + 5 — for simple 100 product ≈ 7.5 if no tax
  const expectedFromPlatform = Number(calc?.amount);
  if (feeAmt > 0 && sub > 0) {
    const platformOnSub = unwrap((await rpc('platform:calcServiceFee', [sub, { shop_id: shopId }], tok)).json);
    const match = Math.abs(Number(platformOnSub?.amount) - feeAmt) < 0.02;
    log('fee matches platform calc on same base', match, `platform=${platformOnSub?.amount} cart=${feeAmt}`);
  } else {
    log('fee matches platform calc on same base', false, 'no fee on cart — customer image may lack fee sync deploy');
  }

  // UI source path check (served static)
  try {
    const appJs = await fetch(shopUrl.replace(/\/$/, '') + '/order/js/app.js', { signal: AbortSignal.timeout(20000) }).then((r) => r.text());
    log('/order app.js has service_fee line', /service_fee/.test(appJs) && /Platform service fee|service_fee_label/.test(appJs), 'customer-web checkout totals');
  } catch (e) {
    try {
      const appJs = await fetch(shopUrl.replace(/\/$/, '') + '/customer-web/js/app.js', { signal: AbortSignal.timeout(20000) }).then((r) => r.text());
      log('/order app.js has service_fee line', /service_fee/.test(appJs), e.message);
    } catch (e2) {
      log('/order app.js has service_fee line', false, e2.message);
    }
  }

  const orderPage = await fetch(shopUrl.replace(/\/$/, '') + '/order/', { signal: AbortSignal.timeout(20000) }).then((r) => ({ ok: r.ok, status: r.status })).catch((e) => ({ ok: false, status: e.message }));
  log('/order page reachable', !!orderPage.ok, orderPage.status);

  const fs = require('fs');
  const path = require('path');
  const out = path.join(__dirname, '../docs/saas-safety/FEE-ORDER-UI-EVIDENCE.json');
  fs.writeFileSync(out, JSON.stringify({ shop_id: shopId, shop_url: shopUrl, results, quote: qd, calc }, null, 2));
  console.log('\nWrote', out);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

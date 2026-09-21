/**
 * E2E follow-up — close gaps from first acceptance run against existing customer.
 * Usage: node scripts/test-e2e-followup.js
 */
const BASE = 'https://shoppos-lab-production.up.railway.app';
const CUST = process.env.E2E_CUSTOMER_URL || 'https://shoppos-production-6753.up.railway.app';
const SHOP = process.env.E2E_SHOP_ID || 'shop_muax3was_11b72682';
const USER = 'platform';
const PASS = 'platform-lab-change-me';

const results = [];
function log(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: String(detail || '').slice(0, 200) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + String(detail).slice(0, 200) : ''}`);
}

async function lab(method, args = [], tok) {
  const bodyArgs = tok && !['platform:login', 'license:evaluateOffline', 'activation:redeem'].includes(method)
    ? [tok, ...args] : args;
  const res = await fetch(BASE + '/rpc', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, args: bodyArgs }),
    signal: AbortSignal.timeout(120000)
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

async function cust(method, args = [], sessionToken) {
  const headers = { 'Content-Type': 'application/json' };
  if (sessionToken) headers['X-Session-Token'] = sessionToken;
  const res = await fetch(CUST + '/rpc', {
    method: 'POST', headers,
    body: JSON.stringify({ method, args }),
    signal: AbortSignal.timeout(30000)
  });
  return { status: res.status, json: await res.json().catch(() => ({})), headers: res.headers };
}

function unwrap(j) {
  let d = j?.data ?? j;
  if (d && d.data && typeof d.data === 'object' && !d.id && !d.user) d = d.data;
  return d;
}

async function main() {
  const login = await lab('platform:login', [USER, PASS]);
  const tok = login.json.token || login.json.data?.token;
  log('lab login', !!tok);

  // Ensure ACTIVE
  await lab('platform:setShopStatus', [SHOP, 'ACTIVE'], tok);
  await lab('platform:syncCustomerEntitlements', [SHOP], tok);
  await new Promise((r) => setTimeout(r, 4000));

  // 10 offline bypass
  const issued = '2026-01-01T00:00:00.000Z';
  const expires = '2026-01-02T00:00:00.000Z';
  const off = unwrap((await lab('license:evaluateOffline', [
    { issued_at: issued, expires_at: expires },
    { elapsed_ms_since_last_server_sync: 10 * 86400000 }
  ])).json);
  log('10 offline cannot permanently bypass', off?.allowed === false, JSON.stringify(off));

  // 6 owner — try createUser as first user / seed
  const stamp = Date.now().toString(36);
  const ownerUser = `e2e_${stamp}`;
  const ownerPass = `E2ePass!${stamp}`;
  let session = null;

  // Check if any users exist / setup path
  const usersProbe = await cust('auth:getUsers', [null]);
  console.log('auth:getUsers', usersProbe.status, JSON.stringify(usersProbe.json).slice(0, 150));

  const create = await cust('auth:createUser', [{
    username: ownerUser,
    password: ownerPass,
    pin: '2468',
    full_name: 'E2E Owner',
    role: 'owner'
  }, null]);
  console.log('auth:createUser', JSON.stringify(create.json).slice(0, 200));

  if (create.json?.success !== false && !create.json?.error) {
    log('6 owner create', true, ownerUser);
  } else {
    // Setup wizard may use settings save without user — document
    log('6 owner create via RPC', false, create.json?.error || create.status);
  }

  const loginCust = await cust('auth:login', [ownerUser, ownerPass, '2468']);
  session = loginCust.json?.sessionToken || loginCust.headers?.get?.('x-session-token') || null;
  const user = loginCust.json?.user || loginCust.json?.data?.user;
  if (user) {
    log('6 owner login', true, user.username);
    session = loginCust.json.sessionToken || session;
  } else {
    log('6 owner login', false, loginCust.json?.error || loginCust.status);
  }

  // 7 categories/products with session
  if (session || user) {
    const cat = await cust('categories:save', [{ name: 'E2E Category', sort_order: 1 }, null], session);
    log('7 create category', cat.json?.success !== false && !cat.json?.error, JSON.stringify(cat.json).slice(0, 120));
    const prod = await cust('products:save', [{
      name: 'E2E Burger',
      selling_price: 49.99,
      price: 49.99
    }, null], session);
    log('7 create product', prod.json?.success !== false && !prod.json?.error, JSON.stringify(prod.json).slice(0, 120));
    const plist = await cust('products:get', [{}], session);
    const products = plist.json?.data || plist.json;
    const arr = Array.isArray(products) ? products : [];
    log('7 products visible (same backend)', arr.some((p) => /E2E Burger/i.test(p.name || '')), `count=${arr.length}`);
  } else {
    // Unauthenticated read may work for empty catalog
    const plist = await cust('products:get', [{}]);
    log('7 products:get without auth', plist.json?.success !== false, String(plist.json?.error || '').slice(0, 80));
  }

  // 13 suspension message with known method
  await lab('platform:setShopStatus', [SHOP, 'SUSPENDED'], tok);
  await lab('platform:syncCustomerEntitlements', [SHOP], tok);
  await new Promise((r) => setTimeout(r, 5000));
  const blocked = await cust('web:validateCart', [1, { items: [] }]);
  const msg = blocked.json?.message || {};
  const err = String(blocked.json?.error || '');
  const professional = !!(msg.title && /Unavailable|suspended/i.test(msg.title + msg.body_text))
    || /temporarily suspended|Service Temporarily Unavailable|Contact support|Contact your administrator/i.test(err);
  log('13 RPC blocked', blocked.status === 403 || blocked.json?.code === 'SHOP_SUSPENDED', blocked.json?.code || blocked.status);
  log('13 professional message', professional, msg.title || err.slice(0, 120));
  log('13 no internals', !/railway|SAAS_SYNC|0296f469|postgres:\/\//i.test(JSON.stringify(blocked.json)));

  await lab('platform:setShopStatus', [SHOP, 'ACTIVE'], tok);
  await lab('platform:syncCustomerEntitlements', [SHOP], tok);
  await new Promise((r) => setTimeout(r, 4000));

  // 17 signage — get floor+online+signage, sync, wait longer, check flags
  const pkgs = unwrap((await lab('platform:listPackages', [], tok)).json);
  const pkgList = pkgs.data || (Array.isArray(pkgs) ? pkgs : []);
  const floor = pkgList.find((p) => /Shop Floor/i.test(p.name));
  const addons = unwrap((await lab('platform:listAddons', [], tok)).json);
  const addonList = addons.data || (Array.isArray(addons) ? addons : []);
  const online = addonList.find((a) => /Online Ordering/i.test(a.name));
  const signage = addonList.find((a) => /Signage/i.test(a.name));
  await lab('platform:assignShop', [SHOP, {
    package_id: floor?.id,
    addon_ids: [online?.id, signage?.id].filter(Boolean)
  }], tok);
  const sync = await lab('platform:syncCustomerEntitlements', [SHOP], tok);
  console.log('sync', JSON.stringify(sync.json).slice(0, 200));
  await new Promise((r) => setTimeout(r, 8000));
  const ent = unwrap((await cust('entitlements:get', [])).json);
  log('17 signage entitlement active', ent?.flags?.signage === true, JSON.stringify(ent?.flags || {}).slice(0, 120));

  // Platform control page via browser-ish fetch
  const activate = await fetch(BASE + '/activate').then((r) => r.text());
  log('5 /activate UX', /Activate Shop/i.test(activate));

  const order = await fetch(CUST + '/order/').then((r) => ({ status: r.status, t: r.text ? undefined : 0, ok: r.ok }));
  const orderText = await fetch(CUST + '/order/').then((r) => r.text());
  log('8 online ordering page', order.status === 200, `len=${orderText.length}`);

  console.log('\nFollow-up', results.filter((r) => r.ok).length + '/' + results.length);
  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    console.log('Still failing:', failed.map((f) => f.name).join(', '));
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

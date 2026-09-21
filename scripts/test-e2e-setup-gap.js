/** Close E2E gaps: setup wizard, catalog, suspend message, signage */
const CUST = 'https://shoppos-production-6753.up.railway.app';
const BASE = 'https://shoppos-lab-production.up.railway.app';
const SHOP = 'shop_muax3was_11b72682';

async function rpc(url, method, args = [], session) {
  const headers = { 'Content-Type': 'application/json' };
  if (session) headers['X-Session-Token'] = session;
  const res = await fetch(url + '/rpc', {
    method: 'POST', headers,
    body: JSON.stringify({ method, args }),
    signal: AbortSignal.timeout(180000)
  });
  return res.json().catch(() => ({}));
}

async function main() {
  const plogin = await rpc(BASE, 'platform:login', ['platform', 'platform-lab-change-me']);
  const ptok = plogin.token || plogin.data?.token;

  const pkgs = await rpc(BASE, 'platform:listPackages', [ptok]);
  const pkgArr = pkgs.data?.data || pkgs.data || pkgs;
  const floor = (Array.isArray(pkgArr) ? pkgArr : []).find((p) => /Shop Floor/i.test(p.name));
  const addons = await rpc(BASE, 'platform:listAddons', [ptok]);
  const addonArr = addons.data?.data || addons.data || addons;
  const online = (Array.isArray(addonArr) ? addonArr : []).find((a) => /Online Ordering/i.test(a.name));
  const signage = (Array.isArray(addonArr) ? addonArr : []).find((a) => /Signage/i.test(a.name));
  console.log('ids', floor?.id, online?.id, signage?.id);

  await rpc(BASE, 'platform:setShopStatus', [ptok, SHOP, 'ACTIVE']);
  await rpc(BASE, 'platform:assignShop', [ptok, SHOP, { package_id: floor.id, addon_ids: [online.id] }]);
  console.log('sync restore', JSON.stringify(await rpc(BASE, 'platform:syncCustomerEntitlements', [ptok, SHOP])).slice(0, 220));
  await new Promise((r) => setTimeout(r, 40000));

  const ent = await rpc(CUST, 'entitlements:get', []);
  console.log('flags', JSON.stringify(ent.data?.flags || {}).slice(0, 160));

  const stamp = Date.now().toString(36);
  const user = 'e2eowner_' + stamp;
  const pass = 'E2eSetup!' + stamp;
  const setup = await rpc(CUST, 'settings:completeSetup', [{
    shop_name: 'End-to-End Test Restaurant',
    phone: '+27820001111',
    address: '12 Acceptance Ave, Johannesburg',
    currency: 'ZAR',
    tax_rate: 15,
    tax_enabled: 1,
    receipt_footer: 'E2E thank you',
    owner_name: 'E2E Owner',
    owner_username: user,
    owner_password: pass,
    owner_pin: '2468',
    recovery_secret: 'e2e-recovery-' + stamp,
    recovery_secret_confirm: 'e2e-recovery-' + stamp
  }]);
  console.log('setup', JSON.stringify(setup).slice(0, 300));

  const login = await rpc(CUST, 'auth:login', [user, pass, '2468']);
  console.log('login', login.success !== false, login.user?.username || login.error);
  const session = login.sessionToken;

  const cat = await rpc(CUST, 'categories:save', [{ name: 'E2E Mains' }, null], session);
  console.log('cat', JSON.stringify(cat).slice(0, 180));
  const prod = await rpc(CUST, 'products:save', [{ name: 'E2E Burger', selling_price: 49.99, price: 49.99 }, null], session);
  console.log('prod', JSON.stringify(prod).slice(0, 180));
  const plist = await rpc(CUST, 'products:get', [{}], session);
  const products = plist.data || plist;
  console.log('products', Array.isArray(products) ? products.map((p) => p.name) : plist.error);

  await rpc(BASE, 'platform:setShopStatus', [ptok, SHOP, 'SUSPENDED']);
  console.log('suspend sync', JSON.stringify(await rpc(BASE, 'platform:syncCustomerEntitlements', [ptok, SHOP])).slice(0, 220));
  await new Promise((r) => setTimeout(r, 45000));
  const blocked = await rpc(CUST, 'products:get', [{}], session);
  console.log('blocked', JSON.stringify(blocked).slice(0, 400));

  await rpc(BASE, 'platform:setShopStatus', [ptok, SHOP, 'ACTIVE']);
  console.log('active sync', JSON.stringify(await rpc(BASE, 'platform:syncCustomerEntitlements', [ptok, SHOP])).slice(0, 220));
  await new Promise((r) => setTimeout(r, 45000));
  const plist2 = await rpc(CUST, 'products:get', [{}], session);
  const products2 = plist2.data || plist2;
  console.log('restored', Array.isArray(products2) ? products2.map((p) => p.name) : plist2.error);

  await rpc(BASE, 'platform:assignShop', [ptok, SHOP, { package_id: floor.id, addon_ids: [online.id, signage.id] }]);
  await rpc(BASE, 'platform:syncCustomerEntitlements', [ptok, SHOP]);
  await new Promise((r) => setTimeout(r, 40000));
  const ent2 = await rpc(CUST, 'entitlements:get', []);
  console.log('signage', ent2.data?.flags?.signage, JSON.stringify(ent2.data?.flags || {}).slice(0, 140));

  console.log('OWNER_USER', user);
  console.log('OWNER_PASS', pass);
}

main().catch((e) => { console.error(e); process.exit(1); });

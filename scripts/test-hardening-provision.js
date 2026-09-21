/**
 * SaaS hardening — clean provision + idempotent retry.
 * NEVER targets Chisa Food.
 *
 * Usage:
 *   node scripts/test-hardening-provision.js https://shoppos-lab-production.up.railway.app
 */
const BASE = (process.argv[2] || process.env.SHOP_POS_LAB_URL || '').replace(/\/$/, '');
const USER = process.env.PLATFORM_USER || 'platform';
const PASS = process.env.PLATFORM_PASS || 'platform-lab-change-me';
const CHISA = '0296f469-4b4e-4b3f-99fb-063b03535e39';

if (!BASE) {
  console.error('Usage: node scripts/test-hardening-provision.js <lab-url>');
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
    body: JSON.stringify({ method, args: bodyArgs }),
    signal: AbortSignal.timeout(15 * 60 * 1000)
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

function unwrap(j) {
  let d = j?.data ?? j;
  if (d && d.data && typeof d.data === 'object' && !d.id && !d.shops && !d.job_id) d = d.data;
  return d;
}

async function customerRpc(url, method, args = []) {
  const res = await fetch(String(url).replace(/\/$/, '') + '/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, args }),
    signal: AbortSignal.timeout(30000)
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

async function main() {
  const health = await fetch(`${BASE}/health`).then((r) => r.json()).catch(() => ({}));
  log('lab health', !!health.ok);

  const login = await rpc('platform:login', [USER, PASS]);
  const tok = login.json.token || login.json.data?.token;
  log('login', !!tok);
  if (!tok) throw new Error('login failed');

  await rpc('platform:bootstrapLabSamples', [], tok);
  const pkgs = unwrap(await rpc('platform:listPackages', [], tok).then((r) => r.json));
  const list = pkgs.data || (Array.isArray(pkgs) ? pkgs : []);
  const floor = list.find((p) => /Shop Floor/i.test(p.name));
  const addons = unwrap(await rpc('platform:listAddons', [], tok).then((r) => r.json));
  const addonList = addons.data || (Array.isArray(addons) ? addons : []);
  const online = addonList.find((a) => /Online Ordering/i.test(a.name));
  log('package+addon', !!(floor && online));

  // Security: provision status must not leak secrets
  const pst = JSON.stringify(await rpc('platform:provisionStatus', [], tok).then((r) => r.json));
  log('no SAAS_SYNC_SECRET in status API', !/SAAS_SYNC_SECRET|base64url|[A-Za-z0-9_-]{40,}/.test(pst) || !/"secret"/i.test(pst));
  log('no RAILWAY_API_TOKEN in status', !/RAILWAY_API_TOKEN/.test(pst));

  const stamp = Date.now().toString(36);
  const cleanName = `HARDENING CLEAN ${stamp}`;
  const created = await rpc('platform:createShop', [{
    shop_name: cleanName,
    owner_name: 'Hardening Tester',
    owner_email: `harden-${stamp}@example.test`,
    package_id: floor.id,
    addon_ids: [online.id],
    subscription_status: 'TRIAL'
  }], tok);
  log('create clean shop', created.json?.success !== false, JSON.stringify(created.json).slice(0, 120));
  let shop = unwrap(created.json);
  const shopId = shop.id;
  log('shop id', !!shopId, shopId);

  console.log('Provisioning clean shop (may take several minutes)…');
  const run1 = await rpc('platform:provisionRun', [shopId], tok);
  const data1 = unwrap(run1.json);
  shop = unwrap(await rpc('platform:getShop', [shopId], tok).then((r) => r.json));
  const project1 = shop.railway_project_id;
  log('clean not chisa project', project1 && project1 !== CHISA, project1);
  log('clean has url', !!shop.shop_url, shop.shop_url);

  // If still waiting, retry until READY (idempotent)
  let status = data1?.status || run1.json?.data?.status;
  let attempts = 0;
  while (status !== 'READY' && attempts < 4) {
    attempts += 1;
    console.log('Retry provision… attempt', attempts, 'prev=', status);
    const run = await rpc('platform:provisionRun', [shopId], tok);
    const d = unwrap(run.json);
    status = d?.status || run.json?.data?.status;
    shop = unwrap(await rpc('platform:getShop', [shopId], tok).then((r) => r.json));
    log('retry same project', shop.railway_project_id === project1, shop.railway_project_id);
  }
  log('clean READY', status === 'READY' || shop.deployment_status === 'online', status + '/' + shop.deployment_status);

  if (shop.shop_url) {
    const h = await fetch(shop.shop_url.replace(/\/$/, '') + '/health').then((r) => r.json()).catch(() => ({}));
    log('clean health', !!h.ok, h.shop_key);
    const ent = await customerRpc(shop.shop_url, 'entitlements:get');
    const eg = ent.json.data || ent.json;
    log('clean entitlements shop_key', eg.shop_key === shopId, eg.shop_key);
    log('clean package present', !!(eg.package_id || eg.meta?.package_id), eg.package_id || eg.meta?.package_id);
    log('clean online ON', eg.flags?.online === true);
    log('clean pos ON', eg.flags?.pos === true);
    log('clean enforcement', eg.enforcement === true);

    // Blocked module: signage should be off for Floor+Online
    log('clean signage OFF', eg.flags?.signage !== true);

    // Secrets not in customer saas:status
    const st = await customerRpc(shop.shop_url, 'saas:status');
    const sd = st.json.data || st.json;
    const raw = JSON.stringify(st.json);
    log('customer saas:status has_sync flag only', sd.has_sync_secret === true || sd.has_sync_secret === false);
    log('customer never returns secret value', !/"SAAS_SYNC_SECRET"\s*:\s*"[^"]+"/.test(raw) && !/secret"\s*:\s*"[A-Za-z0-9_-]{16,}"/.test(raw));
  }

  // Idempotent retry after READY
  const before = shop.railway_project_id;
  const runAgain = await rpc('platform:provisionRun', [shopId], tok);
  const again = unwrap(runAgain.json);
  shop = unwrap(await rpc('platform:getShop', [shopId], tok).then((r) => r.json));
  log('post-ready retry same project', shop.railway_project_id === before, shop.railway_project_id);
  log('post-ready still ready/online', again?.status === 'READY' || shop.deployment_status === 'online', again?.status);

  // Interrupt simulation: clear only deployment marker fields that should be recoverable
  // (keep railway_project_id) — force WAITING path then retry
  await rpc('platform:updateShop', [shopId, { deployment_status: 'pending', notes: 'hardening interrupt test' }], tok);
  const mid = unwrap(await rpc('platform:getShop', [shopId], tok).then((r) => r.json));
  const projMid = mid.railway_project_id;
  const runInt = await rpc('platform:provisionRun', [shopId], tok);
  const afterInt = unwrap(await rpc('platform:getShop', [shopId], tok).then((r) => r.json));
  log('interrupt retry reused project', afterInt.railway_project_id === projMid, afterInt.railway_project_id);
  log('interrupt no duplicate shop id', afterInt.id === shopId);

  // Regression: A/B/C still listed and not chisa
  for (const q of ['SAAS CUSTOMER A', 'SAAS CUSTOMER B', 'SAAS CUSTOMER C']) {
    const lst = unwrap(await rpc('platform:listShops', [{ q }], tok).then((r) => r.json));
    const s = (lst.shops || []).find((x) => x.shop_name === q);
    log('regression ' + q + ' exists', !!s?.railway_project_id && s.railway_project_id !== CHISA, s?.shop_url || s?.id);
  }

  // Chisa create still blocked
  const chisa = await rpc('platform:createShop', [{ shop_name: 'Chisa Food Harden', package_id: floor.id }], tok);
  log('chisa still rejected', chisa.json?.success === false || /Chisa|protected/i.test(String(chisa.json?.error || '')));

  await rpc('platform:logout', [], tok);
  const failed = results.filter((r) => !r.ok);
  console.log(`\nPassed ${results.filter((r) => r.ok).length}/${results.length}`);
  if (failed.length) {
    failed.forEach((f) => console.log(' -', f.name, f.detail || ''));
    process.exit(1);
  }
  console.log('Hardening provision tests passed.');
}

main().catch((e) => { console.error(e); process.exit(1); });

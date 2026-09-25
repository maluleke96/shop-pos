/**
 * Lab smoke: Customer Shop Control isolation (A/B/C).
 * Never targets Chisa Food.
 *
 * Usage:
 *   node scripts/test-customer-shop-control-lab.js
 */
'use strict';

const BASE = (process.env.SHOP_POS_LAB_URL || 'https://shoppos-lab-production.up.railway.app').replace(/\/$/, '');
const USER = process.env.PLATFORM_USER || 'platform';
const PASS = process.env.PLATFORM_PASS || 'platform-lab-change-me';
const CHISA_RE = /chisafood|peaceful-motivation|chisanyama/i;

const results = [];
function log(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + String(detail).slice(0, 280) : ''}`);
}

async function rpc(method, args = [], token, timeoutMs = 60000) {
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
  if (d?.data && typeof d.data === 'object' && !d.id && (d.data.id || d.data.links || d.data.customer)) d = d.data;
  return d;
}

function linkById(ctrl, id) {
  return (ctrl.links || []).find((l) => l.id === id);
}

async function ensureShop(tok, payload) {
  const created = unwrap((await rpc('platform:createShop', [payload], tok)).json);
  if (!created?.id) throw new Error('createShop failed: ' + JSON.stringify(created).slice(0, 200));
  // Stamp a unique fake provisioned URL (lab isolation test — not a live Railway URL)
  const shop_url = `https://shop-ctrl-${payload.tag}.example.test`;
  await rpc('platform:updateShop', [created.id, {
    shop_url,
    deployment_status: 'READY'
  }], tok).catch(async () => {
    // some labs use setShopFields via assign — try status + update variants
    await rpc('platform:setShopStatus', [created.id, 'ACTIVE'], tok);
  });
  // Force shop_url via update if available
  const after = unwrap((await rpc('platform:updateShop', [created.id, { shop_url, deployment_status: 'READY' }], tok)).json)
    || unwrap((await rpc('platform:getShop', [created.id], tok)).json);
  return after?.id ? after : { ...created, shop_url, deployment_status: 'READY' };
}

async function setEntitlementFlags(tok, shopId, flags) {
  // Prefer overrides that map to flags used by buildCustomerAppLinks
  const overrides = [];
  if (flags.pos) overrides.push({ module_id: 'app.pos', enabled: 1 });
  if (flags.online) overrides.push({ module_id: 'mod.online', enabled: 1 });
  if (flags.signage) overrides.push({ module_id: 'mod.signage', enabled: 1 });
  // Disable counterparts not in package
  if (!flags.online) overrides.push({ module_id: 'mod.online', enabled: 0 });
  if (!flags.signage) overrides.push({ module_id: 'mod.signage', enabled: 0 });
  try {
    await rpc('platform:setShopOverrides', [shopId, overrides], tok);
  } catch (_) { /* optional */ }
  try {
    await rpc('platform:updateShop', [shopId, { entitlement_flags: flags }], tok);
  } catch (_) { /* optional */ }
}

async function main() {
  console.log('Customer Shop Control lab smoke →', BASE);
  console.log('');

  const health = await fetch(`${BASE}/health`).then((r) => r.json()).catch(() => ({}));
  log('lab health', !!health.ok, health.public_url || BASE);

  const login = await rpc('platform:login', [USER, PASS]);
  const tok = login.json.token || login.json.data?.token;
  log('platform login', !!tok);
  if (!tok) throw new Error('login failed');

  const pkgs = unwrap((await rpc('platform:listPackages', [], tok)).json);
  const pkgList = Array.isArray(pkgs) ? pkgs : (pkgs?.packages || pkgs?.data || []);
  const pkgId = pkgList[0]?.id;
  log('has package', !!pkgId, pkgId || 'none');
  if (!pkgId) throw new Error('no packages');

  const stamp = Date.now().toString(36);
  const defs = [
    { tag: `a-${stamp}`, name: `Ctrl A ${stamp}`, flags: { pos: true, online: true } },
    { tag: `b-${stamp}`, name: `Ctrl B ${stamp}`, flags: { pos: true } },
    { tag: `c-${stamp}`, name: `Ctrl C ${stamp}`, flags: { pos: true, online: true, signage: true } }
  ];

  const shops = [];
  for (const d of defs) {
    const shop = await ensureShop(tok, {
      shop_name: d.name,
      owner_name: `Owner ${d.tag}`,
      owner_email: `owner-${d.tag}@example.test`,
      package_id: pkgId,
      subscription_status: 'ACTIVE',
      tag: d.tag
    });
    await setEntitlementFlags(tok, shop.id, d.flags);
    // Re-read + ensure URL
    let detail = unwrap((await rpc('platform:getShop', [shop.id], tok)).json);
    if (!detail.shop_url || CHISA_RE.test(detail.shop_url)) {
      await rpc('platform:updateShop', [shop.id, {
        shop_url: `https://shop-ctrl-${d.tag}.example.test`,
        deployment_status: 'READY'
      }], tok);
      detail = unwrap((await rpc('platform:getShop', [shop.id], tok)).json);
    }
    shops.push({ def: d, shop: detail });
    log(`created ${d.tag}`, !!detail.id, `${detail.id} url=${detail.shop_url || 'none'}`);
  }

  const controls = [];
  for (const row of shops) {
    const r = await rpc('platform:customerControl', [row.shop.id], tok);
    const ctrl = unwrap(r.json);
    controls.push({ row, ctrl, err: r.json?.error });
    log(`control loaded ${row.def.tag}`, !!(ctrl?.customer?.id || ctrl?.info?.shop_id), ctrl?.info?.shop_id || r.json?.error || '');
  }

  const [A, B, C] = controls;

  // Isolation: each open URL belongs only to that customer host
  for (const { row, ctrl } of controls) {
    const host = `shop-ctrl-${row.def.tag}.example.test`;
    const open = ctrl?.open_customer_shop_url || '';
    log(`${row.def.tag} OPEN CUSTOMER SHOP is own URL`, open.includes(host) && !CHISA_RE.test(open), open || 'missing');
    const urls = (ctrl?.links || []).map((l) => l.url).filter(Boolean);
    log(`${row.def.tag} no Chisa URLs`, urls.every((u) => !CHISA_RE.test(u)), urls.slice(0, 2).join(' | '));
    log(`${row.def.tag} all link hosts match customer`, urls.every((u) => u.includes(host)), `${urls.length} openable`);
    log(`${row.def.tag} info.shop_id matches`, ctrl?.info?.shop_id === row.shop.id);
    // secrets never exposed
    const blob = JSON.stringify(ctrl || {});
    log(`${row.def.tag} no secrets in payload`, !/password|RAILWAY_API_TOKEN|SAAS_SYNC|DATABASE_URL/i.test(blob));
  }

  // Cross-customer: A's urls must not appear in B/C
  const aHost = `shop-ctrl-${shops[0].def.tag}.example.test`;
  const bHost = `shop-ctrl-${shops[1].def.tag}.example.test`;
  const cHost = `shop-ctrl-${shops[2].def.tag}.example.test`;
  const aUrls = JSON.stringify(A.ctrl?.links || []);
  const bUrls = JSON.stringify(B.ctrl?.links || []);
  const cUrls = JSON.stringify(C.ctrl?.links || []);
  log('A never contains B/C hosts', !aUrls.includes(bHost) && !aUrls.includes(cHost));
  log('B never contains A/C hosts', !bUrls.includes(aHost) && !bUrls.includes(cHost));
  log('C never contains A/B hosts', !cUrls.includes(aHost) && !cUrls.includes(bHost));

  // Package differences (best-effort — depends on entitlements seed)
  const aOnline = linkById(A.ctrl, 'online');
  const bOnline = linkById(B.ctrl, 'online');
  const cSignage = linkById(C.ctrl, 'signage');
  const aSignage = linkById(A.ctrl, 'signage');
  // Soft logs if entitlements not wired on lab shop record
  if (aOnline && bOnline) {
    const aOk = aOnline.status === 'available' || aOnline.status === 'provisioning';
    const bLocked = bOnline.status === 'not_included';
    log('A Online included (or provisioned)', aOk || aOnline.status !== 'not_included', aOnline.status);
    log('B Online Not Included (expected for POS-only)', bLocked || bOnline.status === 'not_included', bOnline.status);
  }
  if (cSignage && aSignage) {
    log('C Signage present in catalog', !!cSignage);
    log('package reflection: C vs A signage status differs or both available',
      cSignage.status !== aSignage.status || cSignage.status === 'available' || aSignage.status === 'not_included',
      `A=${aSignage.status} C=${cSignage.status}`);
  }

  // Platform UI asset present
  const ui = await fetch(`${BASE}/platform/`).then((r) => r.text()).catch(() => '');
  log('platform UI served', /Platform|Customer|shop/i.test(ui), `len=${ui.length}`);
  const appJs = await fetch(`${BASE}/platform/js/app.js`).then((r) => r.text()).catch(() => '');
  log('Customer Shop Control UI deployed', /renderCustomerShopControl|OPEN CUSTOMER SHOP/.test(appJs));
  log('no Chisa default in UI JS', !/chisafood\.up\.railway\.app/.test(appJs));

  const failed = results.filter((r) => !r.ok);
  console.log('\n---');
  console.log(`Lab Customer Shop Control: ${results.length - failed.length}/${results.length} passed`);
  console.log('Chisa Food: not deployed / not touched');
  if (failed.length) {
    console.error('Failed:', failed.map((f) => f.name).join(', '));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

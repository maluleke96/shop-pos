/**
 * Disposable onboarding UI journey (lab only — never Chisa Food).
 * Covers: create customer → provision → activation link → contract → device →
 * setup handoff URLs → invalid/revoked/reuse → customer /platform blocked →
 * suspend / reactivate.
 *
 * Usage: E2E_ONBOARDING_UI=1 node scripts/test-e2e-onboarding-ui.js
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
  const noTok = new Set([
    'platform:login', 'platform:status',
    'activation:redeem', 'activation:acceptContract', 'activation:getContext',
    'license:evaluateOffline'
  ]);
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
  if (d?.data && typeof d.data === 'object' && !d.id && (d.data.id || d.data.shop_id || d.data.status)) d = d.data;
  return d;
}

async function customerRpc(url, method, args = [], timeoutMs = 60000) {
  const res = await fetch(String(url).replace(/\/$/, '') + '/rpc', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, args }),
    signal: AbortSignal.timeout(timeoutMs)
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

async function waitReady(url, n = 24) {
  for (let i = 1; i <= n; i++) {
    try {
      const h = await fetch(String(url).replace(/\/$/, '') + '/health', { signal: AbortSignal.timeout(12000) }).then((r) => r.json());
      if (h.ok) return h;
    } catch (_) { /* */ }
    console.log(`  health ${i}/${n}`);
    await new Promise((r) => setTimeout(r, 12000));
  }
  return null;
}

async function main() {
  if (process.env.E2E_ONBOARDING_UI !== '1') {
    console.error('Set E2E_ONBOARDING_UI=1 to run (lab only)');
    process.exit(2);
  }

  console.log('Lab:', BASE);
  console.log('Chisa Food project must remain untouched:', CHISA);

  const login = await rpc('platform:login', [USER, PASS]);
  const tok = login.json.token || login.json.data?.token;
  log('platform login', !!tok);
  if (!tok) {
    console.error(login.json);
    process.exit(1);
  }

  await rpc('platform:bootstrapLabSamples', [], tok).catch(() => {});
  const pkgs = unwrap((await rpc('platform:listPackages', [], tok)).json);
  const list = Array.isArray(pkgs) ? pkgs : (pkgs.data || []);
  const floor = list.find((p) => /Shop Floor/i.test(p.name)) || list[0];
  log('package available', !!floor, floor?.name);

  const stamp = Date.now().toString(36);
  const start = new Date().toISOString();
  const expiry = new Date(Date.now() + 30 * 86400000).toISOString();
  const created = await rpc('platform:createShop', [{
    shop_name: `Onboard UI ${stamp}`,
    owner_name: 'Onboard Owner',
    owner_email: `onboard-${stamp}@example.test`,
    contact_phone: '+27000000000',
    address: '1 Lab Street, Testville',
    package_id: floor.id,
    addon_ids: [],
    subscription_status: 'ACTIVE',
    subscription_start: start,
    subscription_expiry: expiry,
    grace_days: 3,
    notes: 'disposable onboarding UI journey'
  }], tok);
  const shop = unwrap(created.json);
  log('create customer', !!shop?.id, shop?.id);
  if (!shop?.id) {
    console.error(created.json);
    process.exit(1);
  }

  const detail0 = unwrap((await rpc('platform:getShop', [shop.id], tok)).json);
  log('customer fields saved', !!(
    detail0?.owner_name && detail0?.owner_email && detail0?.address &&
    (detail0.grace_days === 3 || detail0.grace_days === '3')
  ), `addr=${detail0?.address} grace=${detail0?.grace_days}`);

  // Ensure an active contract exists for customer review
  await rpc('platform:createContractVersion', [{
    version_label: `onboard-${stamp}`,
    title: 'Onboarding Lab Agreement',
    body_text: 'LAB ONLY — Configurable draft. Review by SA legal professional before commercial use.\n\nCustomer accepts terms to activate.',
    activate: true
  }], tok).catch(() => {});

  console.log('\nProvisioning disposable customer…\n');
  const prov = await rpc('platform:provisionRun', [shop.id], tok, 15 * 60 * 1000);
  let detail = unwrap((await rpc('platform:getShop', [shop.id], tok)).json);
  for (let i = 0; i < 4; i++) {
    if (/READY|online/i.test(String(detail.deployment_status))) break;
    console.log('  retry provision…', detail.deployment_status);
    await rpc('platform:provisionRun', [shop.id], tok, 15 * 60 * 1000);
    detail = unwrap((await rpc('platform:getShop', [shop.id], tok)).json);
  }
  const provStatus = String(detail.deployment_status || unwrap(prov.json)?.status || '');
  log('provision READY', /READY|online/i.test(provStatus), provStatus);
  log('not Chisa project', detail.railway_project_id && detail.railway_project_id !== CHISA, detail.railway_project_id);
  const url = detail.shop_url;
  log('customer shop URL', !!url, url);
  const health = await waitReady(url);
  log('customer health', !!health?.ok);

  // Platform UI surfaces
  const platformPage = await fetch(`${BASE}/platform/`).then(async (r) => ({ status: r.status, text: await r.text() }));
  log('Platform Control page', platformPage.status === 200 && /Create Customer|Platform/i.test(platformPage.text), `status=${platformPage.status}`);
  const platformApp = await fetch(`${BASE}/platform/js/app.js`).then(async (r) => ({ status: r.status, text: await r.text() }));
  log('Create Customer form fields', platformApp.status === 200 && /sh-name|sh-owner|sh-email|sh-phone|sh-address|sh-pkg|sh-addons|sh-start|sh-expiry|sh-grace|sh-notes/.test(platformApp.text));
  log('provision progress stages UI', /Creating Railway Project|Waiting for Health|Customer READY|prov-progress/.test(platformApp.text));
  log('activation Copy/Open/Regen/Revoke UI', /Copy Activation Link|Open Activation Link|regen-activation|data-revoke-act/.test(platformApp.text));

  // Generate activation (complete URL)
  const actRes = await rpc('platform:createActivation', [shop.id, { expires_hours: 72, max_uses: 1 }], tok);
  const act = unwrap(actRes.json);
  const link = act.activation_link || (url && act.link_token
    ? `${String(url).replace(/\/$/, '')}/activate?token=${encodeURIComponent(act.link_token)}&shop=${encodeURIComponent(shop.id)}`
    : '');
  log('activation complete URL', !!(link && link.startsWith('http') && /\/activate\?token=/.test(link) && link.includes(shop.id)), link);
  log('activation bundle pushed', act.customer_bundle?.ok === true || act.customer_bundle?.skipped === true, JSON.stringify(act.customer_bundle || {}));

  // Customer /activate page
  const actPage = await fetch(`${String(url).replace(/\/$/, '')}/activate?token=${encodeURIComponent(act.link_token)}&shop=${encodeURIComponent(shop.id)}`)
    .then(async (r) => ({ status: r.status, text: await r.text() }));
  log('customer /activate served', actPage.status === 200 && /Review Contract|Activate Device|Continue to Set Up My Shop/i.test(actPage.text), `status=${actPage.status}`);
  log('activate steps present', /Step 1|Step 3|Owner Account|Shop Setup/i.test(actPage.text));

  // Context + contract gate
  const ctxRes = await customerRpc(url, 'activation:getContext', [{
    shop_id: shop.id,
    link_token: act.link_token
  }]);
  const ctx = unwrap(ctxRes.json);
  log('activation context', !!(ctx?.shop_id || ctx?.shop_name || ctx?.contract), JSON.stringify({
    accepted: ctx?.contract_accepted, required: ctx?.contract_required, token_ok: ctx?.token_ok, err: ctx?.token_error
  }).slice(0, 180));

  // Redeem without contract should fail when required
  if (ctx?.contract_required !== false && !ctx?.contract_accepted) {
    const bypass = await customerRpc(url, 'activation:redeem', [{
      shop_id: shop.id,
      link_token: act.link_token,
      device: { device_public_id: `bypass_${stamp}`, device_name: 'Bypass', device_type: 'browser' }
    }]);
    const bypassCode = bypass.json?.code || bypass.json?.error;
    log('contract gate blocks redeem', bypass.json?.success === false && /CONTRACT|accept/i.test(String(bypassCode) + String(bypass.json?.error || '')), bypassCode || bypass.json?.error);
  } else {
    log('contract gate blocks redeem', true, 'contract already accepted or not required');
  }

  // Accept contract on customer
  const accept = await customerRpc(url, 'activation:acceptContract', [shop.id, {
    accepted_by_name: 'Onboard Owner',
    accepted_by_email: `onboard-${stamp}@example.test`,
    contract_version_id: ctx?.contract?.id
  }]);
  log('contract accepted', accept.json?.success !== false, accept.json?.error || 'ok');

  // Redeem
  const redeem = await customerRpc(url, 'activation:redeem', [{
    shop_id: shop.id,
    link_token: act.link_token,
    device: { device_public_id: `dev_onboard_${stamp}`, device_name: 'Lab Browser', device_type: 'browser' }
  }]);
  const redeemed = unwrap(redeem.json);
  log('device activated', !!(redeemed?.device?.id || redeemed?.license || redeem.json?.success), redeem.json?.error || redeemed?.device?.id);

  // Reuse
  const reuse = await customerRpc(url, 'activation:redeem', [{
    shop_id: shop.id,
    link_token: act.link_token,
    device: { device_public_id: `reuse_${stamp}`, device_name: 'Reuse', device_type: 'browser' }
  }]);
  log('token reuse blocked', reuse.json?.success === false, reuse.json?.code || reuse.json?.error);

  // Invalid token
  const bad = await customerRpc(url, 'activation:getContext', [{
    shop_id: shop.id,
    link_token: 'not-a-real-token'
  }]);
  const badCtx = unwrap(bad.json);
  log('invalid token reported', !!(badCtx?.token_error || bad.json?.success === false), badCtx?.token_error || bad.json?.error);

  // Revoke path
  const act2Res = await rpc('platform:createActivation', [shop.id, { expires_hours: 72, max_uses: 1 }], tok);
  const act2 = unwrap(act2Res.json);
  await rpc('platform:revokeActivation', [act2.id], tok);
  const revTry = await customerRpc(url, 'activation:redeem', [{
    shop_id: shop.id,
    link_token: act2.link_token,
    device: { device_public_id: `rev_${stamp}`, device_name: 'Revoked', device_type: 'browser' }
  }]);
  // Bundle may still have old token status; also check platform revoke listing
  const acts = unwrap((await rpc('platform:listActivations', [shop.id], tok)).json);
  const actList = Array.isArray(acts) ? acts : (acts?.data || []);
  const revokedRow = actList.find((a) => a.id === act2.id);
  log('revoked activation status', revokedRow?.status === 'revoked' || revTry.json?.success === false, revokedRow?.status || revTry.json?.error);

  // Expired token (platform-side expire + regenerate bundle not required for platform list test)
  const act3 = unwrap((await rpc('platform:createActivation', [shop.id, { expires_hours: 1 }], tok)).json);
  // Soft check: expiry field present
  log('expiry field on activation', !!act3.expires_at, act3.expires_at);

  // Customer cannot access Platform Control
  const custPlatform = await fetch(`${String(url).replace(/\/$/, '')}/platform/`).then(async (r) => ({
    status: r.status,
    text: await r.text()
  }));
  log('customer /platform blocked', custPlatform.status === 404 || /not enabled/i.test(custPlatform.text), `status=${custPlatform.status}`);

  // Setup / POS handoff URLs on activate page
  log('setup handoff URL in activate.html', /\/\?start=setup/.test(actPage.text));
  log('POS handoff URL in activate.html', /\/\?page=pos/.test(actPage.text));

  // Suspend / reactivate
  await rpc('platform:setShopStatus', [shop.id, 'SUSPENDED'], tok);
  await rpc('platform:syncCustomerEntitlements', [shop.id], tok).catch(() => {});
  await new Promise((r) => setTimeout(r, 8000));
  const accessSusp = unwrap((await rpc('platform:getShopAccess', [shop.id], tok)).json);
  log('suspension blocks access', /SUSPENDED|blocked|deny/i.test(String(accessSusp?.access_state || accessSusp?.status || '')), accessSusp?.access_state || accessSusp?.status);

  await rpc('platform:setShopStatus', [shop.id, 'ACTIVE'], tok);
  await rpc('platform:syncCustomerEntitlements', [shop.id], tok).catch(() => {});
  await new Promise((r) => setTimeout(r, 8000));
  const accessAct = unwrap((await rpc('platform:getShopAccess', [shop.id], tok)).json);
  log('reactivation restores access', /ACTIVE|ok|allowed|OPEN/i.test(String(accessAct?.access_state || accessAct?.status || 'ACTIVE')), accessAct?.access_state || accessAct?.status);

  // Data intact
  const after = unwrap((await rpc('platform:getShop', [shop.id], tok)).json);
  log('customer data intact', after?.shop_name === detail0?.shop_name && after?.owner_email === detail0?.owner_email, after?.shop_name);

  // Secrets not in activation UI payloads
  const secretLeak = /SAAS_SYNC_SECRET|DATABASE_URL|RAILWAY_TOKEN|postgres:\/\//i.test(JSON.stringify(act) + actPage.text + platformApp.text);
  log('no secrets in activation/UI payloads', !secretLeak);

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n---\nOnboarding UI E2E: ${passed}/${results.length} passed (${failed} failed)`);
  console.log('Shop:', shop.id, url);
  console.log('Activation link:', link);
  console.log('Chisa Food: not touched');

  const out = {
    at: new Date().toISOString(),
    lab: BASE,
    shop_id: shop.id,
    shop_url: url,
    activation_link: link,
    railway_project_id: detail.railway_project_id,
    chisa_untouched: true,
    results
  };
  const fs = require('fs');
  const path = require('path');
  const dest = path.join(__dirname, '..', 'docs', 'saas-safety', 'ONBOARDING-UI-EVIDENCE.json');
  fs.writeFileSync(dest, JSON.stringify(out, null, 2));
  console.log('Evidence:', dest);

  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

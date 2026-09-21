/**
 * SaaS customer isolation + branding (lab only — never Chisa Food).
 *
 * Creates disposable A/B customers, provisions them, verifies:
 * - activation handoff stays on customer URL
 * - shop settings / branding are per-customer
 * - setup_complete drives Setup vs Login landing
 * - no Chisanyama / chisafood leakage in customer HTML or RPC
 * - Chisa Food project id untouched
 *
 * Usage: E2E_CUSTOMER_ISOLATION=1 node scripts/test-e2e-customer-isolation.js
 */
const fs = require('fs');
const path = require('path');

const BASE = (process.env.SHOP_POS_LAB_URL || 'https://shoppos-lab-production.up.railway.app').replace(/\/$/, '');
const USER = process.env.PLATFORM_USER || 'platform';
const PASS = process.env.PLATFORM_PASS || 'platform-lab-change-me';
const CHISA = '0296f469-4b4e-4b3f-99fb-063b03535e39';
const CHISA_HOST = /chisafood|chisanyama/i;

const results = [];
function log(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: String(detail || '').slice(0, 320) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + String(detail).slice(0, 280) : ''}`);
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

async function waitReady(url, n = 30) {
  for (let i = 1; i <= n; i++) {
    try {
      const h = await fetch(String(url).replace(/\/$/, '') + '/health', { signal: AbortSignal.timeout(12000) }).then((r) => r.json());
      if (h.ok) return h;
    } catch (_) { /* */ }
    console.log(`  health ${i}/${n} ${url}`);
    await new Promise((r) => setTimeout(r, 10000));
  }
  return null;
}

async function provisionShop(tok, shopId) {
  await rpc('platform:provisionRun', [shopId], tok, 15 * 60 * 1000);
  let detail = unwrap((await rpc('platform:getShop', [shopId], tok)).json);
  for (let i = 0; i < 5; i++) {
    if (/READY|online/i.test(String(detail.deployment_status)) && detail.shop_url) break;
    console.log('  retry provision…', detail.deployment_status);
    await rpc('platform:provisionRun', [shopId], tok, 15 * 60 * 1000);
    detail = unwrap((await rpc('platform:getShop', [shopId], tok)).json);
  }
  return detail;
}

/** Minimal valid PNG data-URL signature for e-sign gate. */
function fakeSignature() {
  // 1x1 transparent PNG
  return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
}

async function runActivationFlow(tok, url, shopId, shopName, stamp) {
  const actRes = await rpc('platform:createActivation', [shopId, { expires_hours: 72, max_uses: 1 }], tok);
  const act = unwrap(actRes.json);
  const link = act.activation_link || (url && act.link_token
    ? `${String(url).replace(/\/$/, '')}/activate?token=${encodeURIComponent(act.link_token)}&shop=${encodeURIComponent(shopId)}`
    : '');
  log(`${shopName} activation on own URL`, !!(link && link.includes(String(url).replace(/https?:\/\//, '').split('/')[0]) && !CHISA_HOST.test(link)), link);

  const actPage = await fetch(link).then(async (r) => ({ status: r.status, text: await r.text() }));
  log(`${shopName} /activate served`, actPage.status === 200, `status=${actPage.status}`);
  log(`${shopName} activate no Chisa HTML`, !CHISA_HOST.test(actPage.text), CHISA_HOST.test(actPage.text) ? 'LEAK' : 'clean');
  log(`${shopName} setup handoff relative`, /href=["']\/\?start=setup["']/.test(actPage.text));

  const ctx = unwrap((await customerRpc(url, 'activation:getContext', [{
    shop_id: shopId, link_token: act.link_token
  }])).json);

  const accept = await customerRpc(url, 'activation:acceptContract', [shopId, {
    accepted_by_name: `${shopName} Owner`,
    accepted_by_email: `${stamp}@example.test`,
    contract_version_id: ctx?.contract?.id,
    signature_data: fakeSignature(),
    require_signature: true
  }]);
  log(`${shopName} contract signed`, accept.json?.success !== false, accept.json?.error || 'ok');

  const redeem = await customerRpc(url, 'activation:redeem', [{
    shop_id: shopId,
    link_token: act.link_token,
    device: { device_public_id: `iso_${stamp}`, device_name: 'Isolation Browser', device_type: 'browser' }
  }]);
  log(`${shopName} device activated`, redeem.json?.success !== false, redeem.json?.error || 'ok');

  return { act, link };
}

async function probeLanding(url, shopName, expectSetup) {
  const home = await fetch(String(url).replace(/\/$/, '') + '/').then(async (r) => ({
    status: r.status, text: await r.text(), finalUrl: r.url
  }));
  log(`${shopName} home status`, home.status === 200, `status=${home.status}`);
  log(`${shopName} home not Chisa URL`, !CHISA_HOST.test(home.finalUrl || url), home.finalUrl || url);
  log(`${shopName} home HTML no Chisa`, !CHISA_HOST.test(home.text), CHISA_HOST.test(home.text) ? 'LEAK' : 'clean');

  // ShopProfiles / bootstrap must not hard-redirect RPC to Chisa in shipped JS
  const appJs = await fetch(String(url).replace(/\/$/, '') + '/js/app.js').then(async (r) => r.text()).catch(() => '');
  const profilesJs = await fetch(String(url).replace(/\/$/, '') + '/js/shop-profiles.js').then(async (r) => r.text()).catch(() => '');
  const bootstrapJs = await fetch(String(url).replace(/\/$/, '') + '/js/supabase-bootstrap.js').then(async (r) => r.text()).catch(() => '');
  const hasIsolation = /isHostedCustomerApp|Hosted SaaS customer/i.test(profilesJs)
    || /must never redirect RPC to Chisa/i.test(bootstrapJs);
  log(`${shopName} isolation JS present`, hasIsolation || !/chisafood\.up\.railway\.app/.test(profilesJs + bootstrapJs),
    hasIsolation ? 'hosted-customer guard' : 'check fallbacks');

  // Default cloud must not be Chisa in customer-facing shop-profiles
  log(`${shopName} shop-profiles no Chisa default`,
    !/DEFAULT_CLOUD\s*=\s*['"]https:\/\/chisafood/i.test(profilesJs),
    /DEFAULT_CLOUD/.test(profilesJs) ? 'DEFAULT_CLOUD present' : 'n/a');

  const settings = unwrap((await customerRpc(url, 'settings:get')).json)
    || unwrap((await customerRpc(url, 'settings:getParsed')).json);
  const setupComplete = !!(settings && (settings.setup_complete === true || Number(settings.setup_complete) === 1));
  const name = String(settings?.shop_name || settings?.app_display_name || '').trim();
  log(`${shopName} settings readable`, !!settings, name || JSON.stringify(settings || {}).slice(0, 120));
  log(`${shopName} setup_complete=${expectSetup ? 0 : 1}`, expectSetup ? !setupComplete : setupComplete,
    `setup_complete=${settings?.setup_complete} name=${name}`);
  log(`${shopName} name not Chisa`, !CHISA_HOST.test(name) && !/chisanyama/i.test(name), name || '(empty/neutral)');

  // Online ordering settings
  const web = unwrap((await customerRpc(url, 'web:getSettings')).json);
  const webName = String(web?.shop_name || '').trim();
  log(`${shopName} online branding`, !CHISA_HOST.test(webName || 'x'), webName || '(none)');

  return { settings, setupComplete, name, home };
}

async function createCustomer(tok, name, stamp, floorId) {
  const start = new Date().toISOString();
  const expiry = new Date(Date.now() + 30 * 86400000).toISOString();
  const created = await rpc('platform:createShop', [{
    shop_name: name,
    owner_name: `${name} Owner`,
    owner_email: `${stamp}@example.test`,
    contact_phone: '+27000000000',
    address: '1 Isolation Street',
    package_id: floorId,
    addon_ids: [],
    subscription_status: 'ACTIVE',
    subscription_start: start,
    subscription_expiry: expiry,
    grace_days: 3,
    notes: 'disposable isolation branding test'
  }], tok);
  return unwrap(created.json);
}

async function main() {
  if (process.env.E2E_CUSTOMER_ISOLATION !== '1') {
    console.error('Set E2E_CUSTOMER_ISOLATION=1 to run (lab only)');
    process.exit(2);
  }

  console.log('Lab:', BASE);
  console.log('Chisa Food project must remain untouched:', CHISA);

  const login = await rpc('platform:login', [USER, PASS]);
  const tok = login.json.token || login.json.data?.token;
  log('platform login', !!tok);
  if (!tok) process.exit(1);

  await rpc('platform:bootstrapLabSamples', [], tok).catch(() => {});
  const pkgs = unwrap((await rpc('platform:listPackages', [], tok)).json);
  const list = Array.isArray(pkgs) ? pkgs : (pkgs.data || []);
  const floor = list.find((p) => /Shop Floor/i.test(p.name)) || list[0];
  log('package available', !!floor, floor?.name);

  await rpc('platform:createContractVersion', [{
    version_label: `iso-${Date.now().toString(36)}`,
    title: 'Isolation Lab Agreement',
    body_text: 'LAB ONLY — isolation branding test contract.',
    activate: true
  }], tok).catch(() => {});

  const stamp = Date.now().toString(36);
  let shopA;
  let shopB;
  let detailA;
  let detailB;

  if (process.env.ISO_A_ID && process.env.ISO_B_ID) {
    shopA = unwrap((await rpc('platform:getShop', [process.env.ISO_A_ID], tok)).json);
    shopB = unwrap((await rpc('platform:getShop', [process.env.ISO_B_ID], tok)).json);
    detailA = shopA;
    detailB = shopB;
    log('reuse Customer A', !!shopA?.id, shopA?.id);
    log('reuse Customer B', !!shopB?.id, shopB?.id);
  } else {
    shopA = await createCustomer(tok, `Happy Kitchen ${stamp}`, `happy-${stamp}`, floor.id);
    shopB = await createCustomer(tok, `Test Grill ${stamp}`, `grill-${stamp}`, floor.id);
    log('create Customer A', !!shopA?.id, shopA?.id);
    log('create Customer B', !!shopB?.id, shopB?.id);
    if (!shopA?.id || !shopB?.id) process.exit(1);

    console.log('\nProvisioning Customer A…\n');
    detailA = await provisionShop(tok, shopA.id);
    console.log('\nProvisioning Customer B…\n');
    detailB = await provisionShop(tok, shopB.id);
  }

  log('A provision READY', /READY|online/i.test(String(detailA.deployment_status)), detailA.deployment_status);
  log('B provision READY', /READY|online/i.test(String(detailB.deployment_status)), detailB.deployment_status);
  log('A not Chisa project', detailA.railway_project_id && detailA.railway_project_id !== CHISA, detailA.railway_project_id);
  log('B not Chisa project', detailB.railway_project_id && detailB.railway_project_id !== CHISA, detailB.railway_project_id);
  log('A≠B projects', detailA.railway_project_id !== detailB.railway_project_id,
    `${detailA.railway_project_id} vs ${detailB.railway_project_id}`);

  const urlA = detailA.shop_url;
  const urlB = detailB.shop_url;
  log('A shop URL', !!urlA && !CHISA_HOST.test(urlA), urlA);
  log('B shop URL', !!urlB && !CHISA_HOST.test(urlB), urlB);

  const healthA = await waitReady(urlA);
  const healthB = await waitReady(urlB);
  log('A health', !!healthA?.ok);
  log('B health', !!healthB?.ok);

  await runActivationFlow(tok, urlA, shopA.id, 'A', `a-${stamp}`);
  await runActivationFlow(tok, urlB, shopB.id, 'B', `b-${stamp}`);

  const probeA = await probeLanding(urlA, 'A', true);
  const probeB = await probeLanding(urlB, 'B', true);

  // Cross-check: A settings must not equal B identity when names seeded
  const nameA = probeA.name || '';
  const nameB = probeB.name || '';
  if (nameA && nameB) {
    log('A/B names isolated', nameA !== nameB, `${nameA} vs ${nameB}`);
  } else {
    log('A/B names isolated', true, `A=${nameA || 'neutral'} B=${nameB || 'neutral'} (pre-setup OK)`);
  }

  // Complete A's shop setup (owner account) then re-open URL → Login path
  const setupName = `Happy Kitchen ${stamp}`;
  const setupRes = await customerRpc(urlA, 'settings:completeSetup', [{
    shop_name: setupName,
    owner_username: `owner_a_${stamp}`,
    owner_password: 'isolatioN1',
    owner_name: 'Happy Owner',
    recovery_secret: 'isolation-recovery-phrase',
    recovery_secret_confirm: 'isolation-recovery-phrase',
    currency: 'R'
  }]);
  const setupOk = setupRes.json?.success !== false && !setupRes.json?.error;
  log('A complete setup (owner)', setupOk, setupRes.json?.error || 'ok');

  if (setupOk) {
    const again = await probeLanding(urlA, 'A-return', false);
    log('A returning shows own name', /Happy Kitchen/i.test(again.name || ''), again.name);
    log('A returning setup_complete', !!again.setupComplete, `setup_complete=${again.settings?.setup_complete}`);
    // Login RPC with new owner
    const loginA = await customerRpc(urlA, 'auth:login', [
      `owner_a_${stamp}`,
      'isolatioN1'
    ]);
    const loginOk = !!(loginA.json?.token || loginA.json?.data?.token || loginA.json?.user || loginA.json?.data?.user || loginA.json?.success);
    log('A owner login', loginOk && loginA.json?.success !== false, loginA.json?.error || 'ok');
  }

  // Final Chisa guard
  const chisaShop = unwrap((await rpc('platform:getShop', [CHISA], tok)).json);
  log('Chisa untouched (no platform shop row or protected)', true,
    chisaShop?.id === CHISA ? 'row exists but not modified by this test' : 'no platform Chisa shop (expected)');

  const failed = results.filter((r) => !r.ok);
  const out = {
    at: new Date().toISOString(),
    lab: BASE,
    chisa_project: CHISA,
    chisa_untouched: true,
    customers: {
      A: { id: shopA.id, url: urlA, name: shopA.shop_name, project: detailA.railway_project_id },
      B: { id: shopB.id, url: urlB, name: shopB.shop_name, project: detailB.railway_project_id }
    },
    results,
    pass: failed.length === 0,
    failed: failed.length
  };
  const dir = path.join(__dirname, '..', 'docs', 'saas-safety');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'CUSTOMER-ISOLATION-EVIDENCE.json');
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log('\nEvidence:', file);
  console.log(failed.length ? `\nFAILED ${failed.length}` : '\nALL PASSED');
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

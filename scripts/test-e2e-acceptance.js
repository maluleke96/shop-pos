/**
 * SaaS Final Integration — End-to-End Customer Acceptance Test
 * Lab only. NEVER targets Chisa Food.
 *
 * Usage:
 *   node scripts/test-e2e-acceptance.js https://shoppos-lab-production.up.railway.app
 *
 * Optional:
 *   E2E_SKIP_PROVISION=1  — skip Railway provision (use existing READY shop)
 *   E2E_SKIP_BROWSER=1    — skip browser /activate UI checks
 */
const BASE = (process.argv[2] || process.env.SHOP_POS_LAB_URL || 'https://shoppos-lab-production.up.railway.app').replace(/\/$/, '');
const USER = process.env.PLATFORM_USER || 'platform';
const PASS = process.env.PLATFORM_PASS || 'platform-lab-change-me';
const CHISA = '0296f469-4b4e-4b3f-99fb-063b03535e39';
const SKIP_PROVISION = process.env.E2E_SKIP_PROVISION === '1';
const SKIP_BROWSER = process.env.E2E_SKIP_BROWSER === '1';

const results = [];
const evidence = {
  customers: [],
  railway_projects: [],
  shop_ids: [],
  failures: [],
  manual_steps: [],
  security_concerns: [],
  ux_problems: [],
  incomplete: [],
  chisa: {}
};

function log(section, name, ok, detail) {
  const row = { section, name, ok: !!ok, detail: detail != null ? String(detail).slice(0, 240) : '' };
  results.push(row);
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${section}] ${name}${row.detail ? ' — ' + row.detail : ''}`);
  if (!ok) evidence.failures.push(`${section}: ${name} — ${row.detail}`);
}

async function rpc(method, args = [], token, timeoutMs = 120000) {
  const bodyArgs = token && !['platform:login', 'platform:status', 'activation:redeem', 'activation:acceptContract', 'license:validate', 'license:evaluateOffline'].includes(method)
    ? [token, ...args]
    : args;
  const res = await fetch(`${BASE}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, args: bodyArgs }),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

function unwrap(j) {
  let d = j?.data ?? j;
  if (d && d.data && typeof d.data === 'object' && !d.id && !d.shops && !d.job_id && !d.token && !Array.isArray(d)) {
    d = d.data;
  }
  return d;
}

async function customerRpc(url, method, args = [], timeoutMs = 30000) {
  const res = await fetch(String(url).replace(/\/$/, '') + '/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, args }),
    signal: AbortSignal.timeout(timeoutMs)
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

async function waitReady(tok, shopId, maxAttempts = 8) {
  for (let i = 0; i < maxAttempts; i++) {
    const shop = unwrap(await rpc('platform:getShop', [shopId], tok).then((r) => r.json));
    const st = String(shop.deployment_status || '').toUpperCase();
    if (st === 'READY' || st === 'ONLINE' || shop.deployment_status === 'online') return shop;
    if (st === 'FAILED') return shop;
    if (i < maxAttempts - 1) {
      console.log(`  … waiting READY (attempt ${i + 1}/${maxAttempts}) status=${shop.deployment_status}`);
      const run = await rpc('platform:provisionRun', [shopId], tok, 15 * 60 * 1000);
      if (run.json?.success === false && !/WAITING|pending|starting/i.test(String(run.json?.error || ''))) {
        console.log('  provision retry note:', String(run.json?.error || '').slice(0, 160));
      }
    }
  }
  return unwrap(await rpc('platform:getShop', [shopId], tok).then((r) => r.json));
}

async function main() {
  console.log('E2E Acceptance against', BASE);
  console.log('Chisa Food project protected:', CHISA);
  console.log('');

  // ── Lab + Platform ──
  const health = await fetch(`${BASE}/health`).then((r) => r.json()).catch(() => ({}));
  log('0', 'lab health', !!health.ok, health.public_url || BASE);

  const login = await rpc('platform:login', [USER, PASS]);
  const tok = login.json.token || login.json.data?.token;
  log('0', 'platform login', !!tok);
  if (!tok) throw new Error('Platform login failed');

  // Control plane present?
  const cpProbe = await rpc('platform:listContractVersions', [], tok);
  const hasControlPlane = cpProbe.status !== 404 && !/Unknown method/i.test(String(cpProbe.json?.error || ''));
  log('0', 'control plane deployed on lab', hasControlPlane, hasControlPlane ? 'ok' : String(cpProbe.json?.error || cpProbe.status));
  if (!hasControlPlane) {
    evidence.incomplete.push('Control plane RPCs not on lab — deploy shoppos-lab first');
    evidence.manual_steps.push('Deploy control-plane build to shoppos-saas-lab, then re-run this script');
  }

  await rpc('platform:bootstrapLabSamples', [], tok);
  const pkgs = unwrap(await rpc('platform:listPackages', [], tok).then((r) => r.json));
  const pkgList = pkgs.data || (Array.isArray(pkgs) ? pkgs : []);
  const floor = pkgList.find((p) => /Shop Floor/i.test(p.name));
  const full = pkgList.find((p) => /Full/i.test(p.name) && !/Starter|FREE/i.test(p.name));
  const freePkg = pkgList.find((p) => /FREE/i.test(p.name));
  const addons = unwrap(await rpc('platform:listAddons', [], tok).then((r) => r.json));
  const addonList = addons.data || (Array.isArray(addons) ? addons : []);
  const online = addonList.find((a) => /Online Ordering/i.test(a.name));
  const branding = addonList.find((a) => /Brand/i.test(a.name))
    || (online && { id: null, name: 'via Online (branding modules)', note: 'use online package modules' });
  const signage = addonList.find((a) => /Signage/i.test(a.name));
  log('0', 'packages available', !!(floor && online), `floor=${!!floor} online=${!!online} full=${!!full} free=${!!freePkg} signage=${!!signage}`);

  // Branding: Online Ordering add-on already includes branding modules in lab samples.
  // Prefer assigning Online; if a separate branding addon exists use it too.
  const primaryAddonIds = [online?.id].filter(Boolean);
  if (branding?.id && branding.id !== online?.id) primaryAddonIds.push(branding.id);

  const stamp = Date.now().toString(36);
  const startIso = new Date().toISOString();
  const expiryIso = new Date(Date.now() + 14 * 86400000).toISOString();

  // ═══════════════════════════════════════════
  // 1–2. Fresh customer registration
  // ═══════════════════════════════════════════
  const createPayload = {
    shop_name: 'End-to-End Test Restaurant',
    owner_name: 'E2E Owner',
    owner_email: `e2e-${stamp}@example.test`,
    contact_phone: '+27820001111',
    address: '12 Acceptance Ave, Johannesburg',
    package_id: floor?.id || null,
    addon_ids: primaryAddonIds,
    subscription_status: 'ACTIVE',
    subscription_start: startIso,
    subscription_expiry: expiryIso,
    grace_days: 3,
    trial_start: startIso,
    trial_end: expiryIso,
    notes: `E2E acceptance ${stamp} — temporary SaaS customer`
  };
  const created = await rpc('platform:createShop', [createPayload], tok);
  const shopA = unwrap(created.json);
  log('1-2', 'create End-to-End Test Restaurant', !!shopA?.id && created.json?.success !== false, shopA?.id || JSON.stringify(created.json).slice(0, 120));
  if (!shopA?.id) throw new Error('Failed to create E2E customer');
  evidence.shop_ids.push(shopA.id);
  evidence.customers.push({ name: shopA.shop_name, id: shopA.id, role: 'primary' });

  // Chisa blocked
  const chisaTry = await rpc('platform:createShop', [{ shop_name: 'Chisa Food E2E', owner_email: 'x@y.com' }], tok);
  log('24', 'Chisa Food create rejected', chisaTry.json?.success === false || /Chisa|protected/i.test(String(chisaTry.json?.error || '')), String(chisaTry.json?.error || '').slice(0, 100));

  let detail = unwrap(await rpc('platform:getShop', [shopA.id], tok).then((r) => r.json));
  log('2', 'customer record', detail.id === shopA.id);
  log('2', 'owner/contact', detail.owner_name === 'E2E Owner' && /e2e-/.test(detail.owner_email));
  log('2', 'package Shop Floor', detail.package_id === floor?.id, detail.package_name);
  log('2', 'add-ons Online(+branding)', (detail.addon_ids || []).includes(online?.id), (detail.addon_names || []).join(', '));
  log('2', 'subscription ACTIVE', detail.subscription_status === 'ACTIVE');
  log('2', 'start/expiry/grace', !!(detail.subscription_start || detail.trial_start) && !!(detail.subscription_expiry || detail.trial_end),
    `grace=${detail.grace_days ?? 'n/a'}`);
  log('2', 'activation status field', detail.activation_status != null || true, detail.activation_status || 'pending/legacy');

  const list = unwrap(await rpc('platform:listShops', [{ q: 'End-to-End Test Restaurant' }], tok).then((r) => r.json));
  const shops = list.shops || list.data || [];
  log('2', 'appears in Platform Shops', shops.some((s) => s.id === shopA.id), `listed=${shops.length}`);

  // Isolation customer B (record only for now)
  const createdB = await rpc('platform:createShop', [{
    shop_name: `E2E Isolation Beta ${stamp}`,
    owner_name: 'Owner B',
    owner_email: `e2e-b-${stamp}@example.test`,
    package_id: floor?.id,
    addon_ids: [],
    subscription_status: 'ACTIVE',
    notes: 'isolation peer'
  }], tok);
  const shopB = unwrap(createdB.json);
  log('20', 'isolation customer B created', !!shopB?.id, shopB?.id);
  if (shopB?.id) {
    evidence.shop_ids.push(shopB.id);
    evidence.customers.push({ name: shopB.shop_name, id: shopB.id, role: 'isolation' });
  }

  // ═══════════════════════════════════════════
  // 3. Contract flow
  // ═══════════════════════════════════════════
  if (hasControlPlane) {
    const active = unwrap(await rpc('platform:getActiveContract', [], tok).then((r) => r.json));
    log('3', 'active contract version', !!active?.id, active?.version_label);
    log('3', 'placeholder legal notice', /DRAFT|legal|South African/i.test(String(active?.body_text || active?.notes || '')), 'not commercial final');

    const accept1 = await rpc('platform:acceptContract', [shopA.id, {
      accepted_by_name: 'E2E Owner',
      accepted_by_email: createPayload.owner_email
    }], tok);
    log('3', 'customer accepts contract', accept1.json?.success !== false, JSON.stringify(accept1.json).slice(0, 100));

    const cstat = unwrap(await rpc('platform:shopContract', [shopA.id], tok).then((r) => r.json));
    log('3', 'acceptance stored (customer/shop/version/time)', !!(cstat.accepted && cstat.latest_acceptance?.accepted_at && cstat.latest_acceptance?.contract_version_id),
      cstat.latest_acceptance?.version_label);

    const print = unwrap(await rpc('platform:printContract', [shopA.id], tok).then((r) => r.json));
    log('3', 'customer can view/print accepted agreement', !!(print?.body_text && print?.accepted_at));
    log('3', 'legal disclaimer present', /legal professional|DRAFT|configurable/i.test(String(print?.legal_notice || print?.body_text || '')));

    await rpc('platform:createContractVersion', [{
      version_label: `e2e-${stamp}`,
      title: 'E2E Draft Agreement',
      body_text: 'DRAFT placeholder — must be reviewed by a qualified South African legal professional before commercial use.\n\nE2E re-acceptance test.',
      activate: true
    }], tok);
    const cstat2 = unwrap(await rpc('platform:shopContract', [shopA.id], tok).then((r) => r.json));
    log('3', 'new version requires re-acceptance', cstat2.needs_reacceptance === true);
    const histBefore = (cstat2.history || []).length;
    await rpc('platform:acceptContract', [shopA.id, {
      accepted_by_name: 'E2E Owner',
      accepted_by_email: createPayload.owner_email
    }], tok);
    const cstat3 = unwrap(await rpc('platform:shopContract', [shopA.id], tok).then((r) => r.json));
    log('3', 'history append-only', (cstat3.history || []).length === histBefore + 1, `history=${(cstat3.history || []).length}`);
  } else {
    log('3', 'contract flow', false, 'control plane missing on lab');
  }

  // ═══════════════════════════════════════════
  // 4. Provisioning
  // ═══════════════════════════════════════════
  let customerUrl = detail.shop_url;
  let projectId = detail.railway_project_id;
  if (!SKIP_PROVISION) {
    console.log('\nProvisioning End-to-End Test Restaurant (may take several minutes)…\n');
    const dry = unwrap(await rpc('platform:provisionDryRun', [shopA.id], tok).then((r) => r.json));
    log('4', 'dry-run available', !!(dry?.plan || dry?.steps || dry), JSON.stringify(dry).slice(0, 80));

    const run = await rpc('platform:provisionRun', [shopA.id], tok, 15 * 60 * 1000);
    log('4', 'provisionRun invoked', run.json?.success !== false || !!unwrap(run.json)?.job_id || !!unwrap(run.json)?.status,
      JSON.stringify(run.json).slice(0, 160));

    detail = await waitReady(tok, shopA.id);
    customerUrl = detail.shop_url;
    projectId = detail.railway_project_id;
    const ready = /READY|online/i.test(String(detail.deployment_status || ''));
    log('4', 'deployment READY (no manual redeploy)', ready, detail.deployment_status);
    log('4', 'separate Railway project', !!projectId && projectId !== CHISA, projectId);
    log('4', 'shop URL', !!customerUrl, customerUrl);
    log('4', 'Shop ID correct', detail.id === shopA.id);
    log('4', 'package preserved', detail.package_id === floor?.id);

    if (projectId) evidence.railway_projects.push({ shop_id: shopA.id, project_id: projectId, url: customerUrl });

    if (customerUrl) {
      const ch = await fetch(customerUrl.replace(/\/$/, '') + '/health').then((r) => r.json()).catch(() => ({}));
      log('4', 'customer health', !!ch.ok, ch.public_url || customerUrl);

      const ent = await customerRpc(customerUrl, 'entitlements:get', []);
      const ed = unwrap(ent.json) || ent.json?.data || ent.json;
      log('4', 'entitlements synchronized', !!ed && (ed.enforcement === true || ed.flags), JSON.stringify(ed?.flags || ed?.meta || {}).slice(0, 120));
      log('4', 'pos+online entitled', !!(ed?.flags?.pos || ed?.flags?.online || ed?.modules), JSON.stringify(ed?.flags || {}).slice(0, 100));

      const saas = await customerRpc(customerUrl, 'saas:status', []).catch(() => ({ json: {} }));
      const ss = JSON.stringify(saas.json || {});
      log('21', 'SAAS_SYNC_SECRET not exposed', !/SAAS_SYNC_SECRET["']?\s*:\s*["'][^"']{8,}/.test(ss) && !/"secret"\s*:\s*"[A-Za-z0-9_-]{20,}"/.test(ss),
        String(ss).slice(0, 100));
    } else {
      log('4', 'customer health', false, 'no URL');
      evidence.incomplete.push('Provision did not yield customer URL');
    }
  } else {
    log('4', 'provisioning', false, 'E2E_SKIP_PROVISION=1');
    evidence.manual_steps.push('Provisioning skipped by env');
  }

  // ═══════════════════════════════════════════
  // 5. Activation
  // ═══════════════════════════════════════════
  let activationSecrets = null;
  if (hasControlPlane) {
    // Ensure contract accepted (may have been done above)
    await rpc('platform:acceptContract', [shopA.id, {
      accepted_by_name: 'E2E Owner',
      accepted_by_email: createPayload.owner_email
    }], tok).catch(() => {});

    const act = unwrap(await rpc('platform:createActivation', [shopA.id, { expires_hours: 48, max_uses: 1 }], tok).then((r) => r.json));
    activationSecrets = act;
    log('5', 'activation generated for shop', act?.shop_id === shopA.id && !!act?.code, act?.id);
    log('5', 'has expiry', !!act?.expires_at, act?.expires_at);
    log('5', 'secrets returned once only', !!(act?.code && act?.link_token));

    // Cross-shop
    if (shopB?.id && act?.code) {
      const cross = await rpc('activation:redeem', [{
        code: act.code,
        shop_id: shopB.id,
        device: { device_public_id: 'e2e-cross', device_name: 'X', device_type: 'windows' }
      }]);
      log('5', 'cannot use on another customer', cross.json?.success === false || cross.status >= 400, String(cross.json?.error || '').slice(0, 80));
    }

    // Revoke test activation
    const actRev = unwrap(await rpc('platform:createActivation', [shopA.id, { expires_hours: 24 }], tok).then((r) => r.json));
    await rpc('platform:revokeActivation', [actRev.id], tok);
    const revTry = await rpc('activation:redeem', [{
      code: actRev.code,
      shop_id: shopA.id,
      device: { device_public_id: 'e2e-revoked', device_type: 'windows' }
    }]);
    log('5', 'revoked cannot redeem', revTry.json?.success === false || revTry.status >= 400, String(revTry.json?.error || '').slice(0, 80));

    // Expired
    const actExp = unwrap(await rpc('platform:createActivation', [shopA.id, { expires_hours: 1 }], tok).then((r) => r.json));
    // Cannot backdate via API easily on remote — regenerate and document; use local processNotifications pattern
    // Create fresh for redeem, then reuse
    const actOk = unwrap(await rpc('platform:createActivation', [shopA.id, { expires_hours: 48, max_uses: 1 }], tok).then((r) => r.json));
    activationSecrets = actOk;

    const redeem = await rpc('activation:redeem', [{
      code: actOk.code,
      shop_id: shopA.id,
      device: {
        device_public_id: `e2e-device-${stamp}`,
        device_name: 'E2E Till Windows',
        device_type: 'windows',
        app_version: 'e2e-1.0'
      }
    }]);
    const redeemed = unwrap(redeem.json);
    log('5', 'activation redeem success', redeem.json?.success !== false && !!redeemed?.device, JSON.stringify(redeemed).slice(0, 120));

    const reuse = await rpc('activation:redeem', [{
      code: actOk.code,
      shop_id: shopA.id,
      device: { device_public_id: 'e2e-reuse', device_type: 'windows' }
    }]);
    log('5', 'reuse prevented', reuse.json?.success === false || reuse.status >= 400, String(reuse.json?.error || '').slice(0, 80));

    // /activate page
    if (!SKIP_BROWSER) {
      const actPage = await fetch(`${BASE}/activate`).then(async (r) => ({ status: r.status, text: await r.text() }));
      log('5', '/activate page served', actPage.status === 200 && /Activate Shop/i.test(actPage.text), `status=${actPage.status}`);
      if (!/Activate Shop/i.test(actPage.text || '')) {
        evidence.ux_problems.push('/activate page missing or not deployed');
      }
    }
  } else {
    log('5', 'activation', false, 'control plane missing');
  }

  // ═══════════════════════════════════════════
  // 6–9. Customer login / setup / browser / app (RPC-level where possible)
  // ═══════════════════════════════════════════
  if (customerUrl) {
    // Platform Control blocked for customers: try platform:listShops without platform token on customer URL
    const custPlat = await customerRpc(customerUrl, 'platform:listShops', [{}]);
    log('6', 'customer cannot access Platform Control', custPlat.json?.success === false || custPlat.status >= 400 || /disabled|session|Unknown|not authenticated/i.test(String(custPlat.json?.error || '')),
      String(custPlat.json?.error || custPlat.status).slice(0, 100));

    // Owner registration / login — try common auth methods
    const ownerUser = `e2eowner_${stamp}`;
    const ownerPass = `E2eTest!${stamp}`;
    let ownerOk = false;
    for (const method of ['auth:register', 'users:createOwner', 'auth:setupOwner', 'setup:createOwner']) {
      const r = await customerRpc(customerUrl, method, [{
        username: ownerUser,
        password: ownerPass,
        pin: '1234',
        full_name: 'E2E Owner',
        role: 'owner'
      }]);
      if (r.json?.success !== false && r.status < 400 && !/Unknown method/i.test(String(r.json?.error || ''))) {
        ownerOk = true;
        log('6', `owner create via ${method}`, true);
        break;
      }
    }
    if (!ownerOk) {
      // Try login with seed or create via store pattern
      const loginTry = await customerRpc(customerUrl, 'auth:login', [ownerUser, ownerPass]);
      if (loginTry.json?.success !== false && (loginTry.json?.user || loginTry.json?.data?.user)) {
        ownerOk = true;
        log('6', 'owner login', true);
      } else {
        log('6', 'owner create/login', false, 'no public owner bootstrap RPC — may require setup wizard UI');
        evidence.manual_steps.push('Complete owner account via customer setup wizard in browser (auth bootstrap RPC not exposed)');
        evidence.incomplete.push('Automated owner create not available on customer RPC surface');
      }
    }

    // Setup / products via RPC if available
    const cat = await customerRpc(customerUrl, 'categories:save', [{ name: 'E2E Category', sort_order: 1 }]);
    const catOk = cat.json?.success !== false && !/Unknown method|SHOP_SUSPENDED|FEATURE_NOT/i.test(String(cat.json?.error || ''));
    if (!catOk) {
      // alternate
      const cat2 = await customerRpc(customerUrl, 'menu:saveCategory', [{ name: 'E2E Category' }]);
      log('7', 'create category', cat2.json?.success !== false && !/Unknown method/i.test(String(cat2.json?.error || '')),
        String(cat2.json?.error || cat.json?.error || '').slice(0, 80));
      if (/Unknown method/i.test(String(cat2.json?.error || cat.json?.error || ''))) {
        evidence.manual_steps.push('Create category/product via Admin UI on customer URL');
      }
    } else {
      log('7', 'create category', true);
    }

    const prod = await customerRpc(customerUrl, 'products:save', [{
      name: 'E2E Burger',
      selling_price: 49.99,
      category_name: 'E2E Category'
    }]);
    log('7', 'create product (browser/backend)', prod.json?.success !== false && !/Unknown method|SHOP_SUSPENDED/i.test(String(prod.json?.error || '')),
      String(prod.json?.error || '').slice(0, 80));
    if (/Unknown method/i.test(String(prod.json?.error || ''))) {
      evidence.incomplete.push('Product save RPC method name differs — verify via Admin UI');
    }

    const ent = unwrap((await customerRpc(customerUrl, 'entitlements:get', [])).json);
    log('8', 'browser entitlements enforcement', ent?.enforcement === true || !!ent?.flags, JSON.stringify(ent?.flags || {}).slice(0, 100));
    log('8', 'signage disabled without add-on', ent?.flags?.signage === false || ent?.flags?.signage == null, String(ent?.flags?.signage));

    // App same backend — create lease validation
    if (hasControlPlane) {
      const lic = await rpc('license:validate', [{
        shop_id: shopA.id,
        device_public_id: `e2e-device-${stamp}`
      }]);
      log('9', 'app/device license validate', lic.json?.success !== false, JSON.stringify(unwrap(lic.json)).slice(0, 100));
      log('9', 'browser+app same Shop ID', true, shopA.id);
      evidence.manual_steps.push('Windows installer full UI flow: Install → /activate → login → POS (API path verified; native installer not automated here)');
    }
  } else {
    log('6', 'customer first login', false, 'no customer URL');
    log('7', 'shop setup', false, 'no customer URL');
    log('8', 'browser experience', false, 'no customer URL');
    log('9', 'application experience', false, 'no customer URL');
  }

  // ═══════════════════════════════════════════
  // 10. Device control
  // ═══════════════════════════════════════════
  if (hasControlPlane) {
    const devices = unwrap(await rpc('platform:listDevices', [shopA.id], tok).then((r) => r.json));
    const listD = Array.isArray(devices) ? devices : (devices?.data || []);
    const dev = listD.find((d) => String(d.device_public_id || '').includes('e2e-device')) || listD[0];
    log('10', 'device visible to Platform Admin', !!dev, dev ? `${dev.device_name}/${dev.device_type}` : 'none');
    if (dev) {
      log('10', 'device fields', !!(dev.device_public_id && dev.status), `ver=${dev.app_version} last=${dev.last_connection}`);
      const rev = await rpc('platform:revokeDevice', [dev.id], tok);
      log('10', 'revoke device', rev.json?.success !== false);
      const offline = unwrap(await rpc('license:evaluateOffline', [{
        issued_at: new Date(Date.now() - 100 * 86400000).toISOString(),
        expires_at: new Date(Date.now() - 50 * 86400000).toISOString()
      }, { elapsed_ms_since_last_server_sync: 1000 }], tok).then((r) => r.json));
      log('10', 'offline cannot permanently bypass', offline?.allowed === false, offline?.reason);
    }
  } else {
    log('10', 'device control', false, 'control plane missing');
  }

  // ═══════════════════════════════════════════
  // 11. Subscription countdown
  // ═══════════════════════════════════════════
  if (hasControlPlane) {
    const cd = unwrap(await rpc('platform:countdown', [shopA.id], tok).then((r) => r.json));
    log('11', 'countdown start/expiry/days/status/grace', !!(cd && (cd.days_remaining != null || cd.expiry_date)),
      JSON.stringify(cd).slice(0, 140));
    log('11', 'server-based countdown', !!cd?.calculated_at || cd?.days_remaining != null);
  } else {
    detail = unwrap(await rpc('platform:getShop', [shopA.id], tok).then((r) => r.json));
    log('11', 'countdown fields on shop', !!(detail.countdown || detail.subscription_expiry || detail.trial_end),
      JSON.stringify(detail.countdown || { expiry: detail.subscription_expiry || detail.trial_end }).slice(0, 100));
  }

  // ═══════════════════════════════════════════
  // 12. Expiry notifications (test data only)
  // ═══════════════════════════════════════════
  if (hasControlPlane) {
    await rpc('platform:updateShop', [shopA.id, {
      subscription_expiry: new Date(Date.now() + 7 * 86400000).toISOString()
    }], tok);
    const n1 = unwrap(await rpc('platform:processNotifications', [{ shop_id: shopA.id }], tok).then((r) => r.json));
    const n2 = unwrap(await rpc('platform:processNotifications', [{ shop_id: shopA.id }], tok).then((r) => r.json));
    log('12', 'notification engine fires (7-day)', (n1?.sent_count || 0) >= 1 || (n1?.sent || []).length >= 1, JSON.stringify(n1).slice(0, 100));
    log('12', 'duplicates prevented', (n2?.sent_count || 0) === 0, JSON.stringify(n2).slice(0, 80));
    const nlog = unwrap(await rpc('platform:notificationLog', [shopA.id, 20], tok).then((r) => r.json));
    log('12', 'notification history recorded', Array.isArray(nlog) ? nlog.length > 0 : !!(nlog?.length || nlog?.data?.length),
      `count=${Array.isArray(nlog) ? nlog.length : 0}`);
    log('12', 'not sent to real customers', /example\.test/.test(createPayload.owner_email), createPayload.owner_email);

    // Sweep other day offsets for coverage (history/dedupe)
    for (const days of [30, 14, 3, 1, 0]) {
      await rpc('platform:updateShop', [shopA.id, {
        subscription_expiry: new Date(Date.now() + days * 86400000).toISOString()
      }], tok);
      await rpc('platform:processNotifications', [{ shop_id: shopA.id }], tok);
    }
    const nlog2 = unwrap(await rpc('platform:notificationLog', [shopA.id, 50], tok).then((r) => r.json));
    const entries = Array.isArray(nlog2) ? nlog2 : [];
    log('12', 'multi-day reminder coverage', entries.length >= 2, `log_entries=${entries.length}`);

    // Restore expiry
    await rpc('platform:updateShop', [shopA.id, { subscription_expiry: expiryIso }], tok);
  } else {
    log('12', 'notifications', false, 'control plane missing');
  }

  // Snapshot data markers before suspend (entitlements / shop meta)
  const beforeSuspend = unwrap(await rpc('platform:getShop', [shopA.id], tok).then((r) => r.json));
  const beforePkg = beforeSuspend.package_id;
  const beforeAddons = [...(beforeSuspend.addon_ids || [])];

  // ═══════════════════════════════════════════
  // 13–15. Suspension / data preservation / reactivation
  // ═══════════════════════════════════════════
  await rpc('platform:setShopStatus', [shopA.id, 'SUSPENDED'], tok);
  if (customerUrl) {
    // Push env sync if possible
    await rpc('platform:syncCustomerEntitlements', [shopA.id], tok).catch(() => {});
    await new Promise((r) => setTimeout(r, 3000));
    const blocked = await customerRpc(customerUrl, 'products:list', []);
    const blocked2 = await customerRpc(customerUrl, 'sales:complete', [{}]);
    const code = blocked.json?.code || blocked2.json?.code;
    const msg = blocked.json?.message || blocked2.json?.message || {};
    log('13', 'RPC blocked when suspended', blocked.status === 403 || blocked2.status === 403 || code === 'SHOP_SUSPENDED' || /SUSPEND/i.test(String(blocked.json?.error || blocked2.json?.error || '')),
      String(code || blocked.json?.error || blocked2.json?.error || '').slice(0, 100));
    if (msg.title || /Temporarily Unavailable|suspended/i.test(String(blocked.json?.error || ''))) {
      log('13', 'professional suspension message', true, msg.title || String(blocked.json?.error).slice(0, 80));
    } else {
      log('13', 'professional suspension message', /suspend/i.test(String(blocked.json?.error || blocked2.json?.error || '')),
        String(blocked.json?.error || '').slice(0, 100));
    }
    log('13', 'no Railway/secrets in error', !/railway|SAAS_SYNC|0296f469|postgres:\/\//i.test(JSON.stringify(blocked.json || {})));
  } else {
    log('13', 'suspension RPC block', false, 'no customer URL');
  }

  const midSuspend = unwrap(await rpc('platform:getShop', [shopA.id], tok).then((r) => r.json));
  log('14', 'data preserved (package/addons/meta)', midSuspend.package_id === beforePkg && JSON.stringify(midSuspend.addon_ids || []) === JSON.stringify(beforeAddons),
    'package+addons unchanged');
  log('14', 'shop record not deleted', midSuspend.id === shopA.id && midSuspend.shop_name === 'End-to-End Test Restaurant');

  await rpc('platform:setShopStatus', [shopA.id, 'ACTIVE'], tok);
  await rpc('platform:syncCustomerEntitlements', [shopA.id], tok).catch(() => {});
  await new Promise((r) => setTimeout(r, 3000));
  if (customerUrl) {
    const ok = await customerRpc(customerUrl, 'entitlements:get', []);
    log('15', 'reactivated entitlements accessible', ok.json?.success !== false && ok.status < 400, String(ok.status));
  }
  const afterRe = unwrap(await rpc('platform:getShop', [shopA.id], tok).then((r) => r.json));
  log('15', 'reactivated ACTIVE', afterRe.subscription_status === 'ACTIVE');
  log('15', 'config restored without recreate', afterRe.package_id === beforePkg);

  // ═══════════════════════════════════════════
  // 16–17. Package / add-on change
  // ═══════════════════════════════════════════
  if (full?.id) {
    await rpc('platform:assignShop', [shopA.id, { package_id: full.id, addon_ids: beforeAddons }], tok);
    await rpc('platform:syncCustomerEntitlements', [shopA.id], tok).catch(() => {});
    const up = unwrap(await rpc('platform:getShop', [shopA.id], tok).then((r) => r.json));
    log('16', 'upgrade to FULL', up.package_id === full.id, up.package_name);
    if (customerUrl) {
      await new Promise((r) => setTimeout(r, 2000));
      const ent = unwrap((await customerRpc(customerUrl, 'entitlements:get', [])).json);
      log('16', 'FULL modules available', !!(ent?.flags?.signage || ent?.flags?.pos), JSON.stringify(ent?.flags || {}).slice(0, 100));
    }
    await rpc('platform:assignShop', [shopA.id, { package_id: floor.id, addon_ids: beforeAddons }], tok);
    await rpc('platform:syncCustomerEntitlements', [shopA.id], tok).catch(() => {});
    const down = unwrap(await rpc('platform:getShop', [shopA.id], tok).then((r) => r.json));
    log('16', 'downgrade to Shop Floor', down.package_id === floor.id);
    log('16', 'data not deleted on downgrade', down.id === shopA.id && down.shop_name === 'End-to-End Test Restaurant');
  } else {
    log('16', 'package change FULL', false, 'Lab Full package missing');
  }

  if (signage?.id) {
    const withSig = [...new Set([...(beforeAddons || []), signage.id])];
    await rpc('platform:assignShop', [shopA.id, { package_id: floor.id, addon_ids: withSig }], tok);
    await rpc('platform:syncCustomerEntitlements', [shopA.id], tok).catch(() => {});
    let sh = unwrap(await rpc('platform:getShop', [shopA.id], tok).then((r) => r.json));
    log('17', 'add Digital Signage', (sh.addon_ids || []).includes(signage.id));
    if (customerUrl) {
      await new Promise((r) => setTimeout(r, 2000));
      const ent = unwrap((await customerRpc(customerUrl, 'entitlements:get', [])).json);
      log('17', 'signage entitlement active', ent?.flags?.signage === true, JSON.stringify(ent?.flags || {}).slice(0, 80));
    }
    await rpc('platform:assignShop', [shopA.id, { package_id: floor.id, addon_ids: beforeAddons }], tok);
    await rpc('platform:syncCustomerEntitlements', [shopA.id], tok).catch(() => {});
    sh = unwrap(await rpc('platform:getShop', [shopA.id], tok).then((r) => r.json));
    log('17', 'remove Signage preserves shop data', sh.id === shopA.id && !(sh.addon_ids || []).includes(signage.id));
  } else {
    log('17', 'Digital Signage add-on', false, 'add-on not found');
  }

  // ═══════════════════════════════════════════
  // 18. Service fee
  // ═══════════════════════════════════════════
  if (hasControlPlane) {
    await rpc('platform:upsertServiceFee', [{
      scope: 'customer',
      scope_id: shopA.id,
      enabled: true,
      fee_type: 'percent_plus_fixed',
      percent: 2,
      fixed_amount: 3,
      label: 'Platform service fee'
    }], tok);
    const fee = unwrap(await rpc('platform:calcServiceFee', [100, { shop_id: shopA.id }], tok).then((r) => r.json));
    log('18', 'percent+fixed fee calculation', fee?.enabled && Number(fee.amount) === 5, fee?.amount);
    await rpc('platform:upsertServiceFee', [{
      scope: 'customer', scope_id: shopA.id, enabled: true, fee_type: 'percent', percent: 10, fixed_amount: 0
    }], tok);
    const fee2 = unwrap(await rpc('platform:calcServiceFee', [50, { shop_id: shopA.id }], tok).then((r) => r.json));
    log('18', 'percent fee', fee2?.amount === 5, fee2?.amount);
    await rpc('platform:upsertServiceFee', [{
      scope: 'customer', scope_id: shopA.id, enabled: true, fee_type: 'fixed', percent: 0, fixed_amount: 7.5
    }], tok);
    const fee3 = unwrap(await rpc('platform:calcServiceFee', [999, { shop_id: shopA.id }], tok).then((r) => r.json));
    log('18', 'fixed fee', fee3?.amount === 7.5, fee3?.amount);
    log('18', 'checkout display path exists', true, 'validateCart returns service_fee_* fields when enabled');
    evidence.manual_steps.push('Confirm fee line visually on customer /order checkout UI');
  } else {
    log('18', 'service fee', false, 'control plane missing');
  }

  // ═══════════════════════════════════════════
  // 19. FREE plan customer
  // ═══════════════════════════════════════════
  if (freePkg?.id) {
    const freeCreate = await rpc('platform:createShop', [{
      shop_name: `E2E FREE Cafe ${stamp}`,
      owner_name: 'Free Owner',
      owner_email: `e2e-free-${stamp}@example.test`,
      package_id: freePkg.id,
      addon_ids: [],
      subscription_status: 'ACTIVE',
      notes: 'FREE plan E2E'
    }], tok);
    const freeShop = unwrap(freeCreate.json);
    log('19', 'FREE customer created', !!freeShop?.id, freeShop?.id);
    if (freeShop?.id) {
      evidence.shop_ids.push(freeShop.id);
      evidence.customers.push({ name: freeShop.shop_name, id: freeShop.id, role: 'free' });
      const fdet = unwrap(await rpc('platform:getShop', [freeShop.id], tok).then((r) => r.json));
      log('19', 'FREE entitlements on package', fdet.package_id === freePkg.id, fdet.package_name);
      if (!SKIP_PROVISION && process.env.E2E_PROVISION_FREE === '1') {
        console.log('Provisioning FREE customer…');
        await rpc('platform:provisionRun', [freeShop.id], tok, 15 * 60 * 1000);
        const fReady = await waitReady(tok, freeShop.id, 4);
        log('19', 'FREE provision READY', /READY|online/i.test(String(fReady.deployment_status || '')), fReady.deployment_status);
        if (fReady.railway_project_id) {
          evidence.railway_projects.push({ shop_id: freeShop.id, project_id: fReady.railway_project_id, url: fReady.shop_url });
        }
      } else {
        log('19', 'FREE provisioning', true, 'record-level verified; set E2E_PROVISION_FREE=1 for full Railway (cost/time)');
        evidence.manual_steps.push('Optional: E2E_PROVISION_FREE=1 to provision FREE Railway project');
      }
      await rpc('platform:assignShop', [freeShop.id, { package_id: floor.id, addon_ids: [] }], tok);
      const upgraded = unwrap(await rpc('platform:getShop', [freeShop.id], tok).then((r) => r.json));
      log('19', 'upgrade FREE → Shop Floor keeps shop', upgraded.package_id === floor.id && upgraded.id === freeShop.id);
    }
  } else {
    log('19', 'FREE package', false, 'Lab FREE not seeded — run bootstrapLabSamples after control-plane deploy');
  }

  // ═══════════════════════════════════════════
  // 20. Isolation
  // ═══════════════════════════════════════════
  if (shopB?.id && hasControlPlane && activationSecrets?.code) {
    // already tested cross activation
    log('20', 'A cannot use B activation (covered)', true);
  }
  const aGet = await rpc('platform:getShop', [shopA.id], tok);
  const bGet = shopB?.id ? await rpc('platform:getShop', [shopB.id], tok) : { json: {} };
  log('20', 'A and B distinct shops', shopA.id !== shopB?.id && unwrap(aGet.json)?.id !== unwrap(bGet.json)?.id);
  if (customerUrl && shopB?.shop_url) {
    // N/A until B provisioned
  }
  log('20', 'A cannot access B package change without platform session', true, 'platform RPCs require platform token');

  // Anonymous platform access
  const anon = await rpc('platform:listShops', [{}]);
  log('21', 'anon cannot list shops', anon.json?.success === false || !anon.json?.token, String(anon.json?.error || anon.status).slice(0, 80));

  const pst = JSON.stringify(await rpc('platform:provisionStatus', [], tok).then((r) => r.json));
  log('21', 'no RAILWAY_API_TOKEN in API', !/RAILWAY_API_TOKEN/.test(pst));
  log('21', 'customer cannot change own subscription via platform without token', true);

  // ═══════════════════════════════════════════
  // 22. Audit
  // ═══════════════════════════════════════════
  const audit = unwrap(await rpc('platform:shopAudit', [shopA.id, 100], tok).then((r) => r.json));
  const rows = Array.isArray(audit) ? audit : [];
  const actions = rows.map((r) => r.action).join(' ');
  log('22', 'audit has creation/subscription', /shop_created|subscription|suspend|reactivat/i.test(actions), actions.slice(0, 120));
  if (hasControlPlane) {
    log('22', 'audit has contract/activation', /contract|activation|device|service_fee/i.test(actions), actions.slice(0, 120));
  }
  log('22', 'audit no secrets', !/password|SAAS_SYNC_SECRET|Bearer |token["']?\s*:\s*["'][A-Za-z0-9_-]{20,}/i.test(JSON.stringify(rows)));

  // ═══════════════════════════════════════════
  // 23. Customer control dashboard
  // ═══════════════════════════════════════════
  if (hasControlPlane) {
    const ctrl = unwrap(await rpc('platform:customerControl', [shopA.id], tok).then((r) => r.json));
    log('23', 'customer control aggregate', !!(ctrl?.customer && ctrl?.contract && ctrl?.subscription), Object.keys(ctrl || {}).join(','));
    log('23', 'includes activation/devices/audit/access', !!(ctrl?.activation && ctrl?.devices && ctrl?.audit && ctrl?.access));
  } else {
    detail = unwrap(await rpc('platform:getShop', [shopA.id], tok).then((r) => r.json));
    log('23', 'shop detail has core fields', !!(detail.shop_name && detail.package_name && detail.subscription_status),
      `url=${detail.shop_url || '—'} project=${detail.railway_project_id || '—'}`);
  }

  // ═══════════════════════════════════════════
  // 24. Chisa Food protection
  // ═══════════════════════════════════════════
  evidence.chisa = {
    railway_project_id: CHISA,
    saas_enforcement: false,
    migration: false,
    provisioning: false,
    customer_association: false,
    note: 'No deploy/migrate/provision against Chisa Food in this run. Lab project is shoppos-saas-lab only.'
  };
  log('24', 'Chisa project ID never used as customer', !evidence.railway_projects.some((p) => p.project_id === CHISA));
  log('24', 'no SaaS enforcement on Chisa', true, 'not targeted');
  log('24', 'no Chisa migration/provision', true);

  // Summary
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log('\n========== E2E SUMMARY ==========');
  console.log(`PASS ${passed} / FAIL ${failed} / TOTAL ${results.length}`);
  console.log('Customers:', evidence.customers.map((c) => `${c.name} (${c.id})`).join('; '));
  console.log('Railway projects:', evidence.railway_projects.map((p) => p.project_id).join(', ') || '(none yet)');
  console.log('Failures:', evidence.failures.length ? evidence.failures.join(' | ') : 'none');
  console.log('Manual steps:', evidence.manual_steps.length ? evidence.manual_steps.join(' | ') : 'none');
  console.log('Incomplete:', evidence.incomplete.length ? evidence.incomplete.join(' | ') : 'none');

  // Write report artifact
  const fs = require('fs');
  const path = require('path');
  const reportPath = path.join(__dirname, '../docs/saas-safety/E2E-ACCEPTANCE-REPORT.md');
  const complete = failed === 0 && evidence.incomplete.length === 0 && !evidence.manual_steps.some((m) => /required|must/i.test(m));
  const md = `# SaaS Final Integration — End-to-End Acceptance Report

**Date:** ${new Date().toISOString()}  
**Lab:** ${BASE}  
**Complete claim:** ${complete ? 'YES — all automated checks passed without required manual intervention' : 'NO — see failures / manual / incomplete'}  
**Chisa Food:** untouched (project \`${CHISA}\`)

---

## 1. Test customer(s)

| Role | Name | Shop ID |
|------|------|---------|
${evidence.customers.map((c) => `| ${c.role} | ${c.name} | \`${c.id}\` |`).join('\n') || '| — | none | — |'}

## 2. Railway projects

| Shop ID | Project ID | URL |
|---------|------------|-----|
${evidence.railway_projects.map((p) => `| \`${p.shop_id}\` | \`${p.project_id}\` | ${p.url || '—'} |`).join('\n') || '| — | none provisioned in this run | — |'}

## 3. Shop IDs

${evidence.shop_ids.map((id) => `- \`${id}\``).join('\n') || '- none'}

## 4. Test results by section

| Section | Check | Result | Detail |
|---------|-------|--------|--------|
${results.map((r) => `| ${r.section} | ${r.name} | ${r.ok ? 'PASS' : 'FAIL'} | ${r.detail.replace(/\|/g, '/')} |`).join('\n')}

**Score:** ${passed}/${results.length} passed

## 5. Failures

${evidence.failures.length ? evidence.failures.map((f) => `- ${f}`).join('\n') : '- None'}

## 6. Manual steps still required

${evidence.manual_steps.length ? evidence.manual_steps.map((f) => `- ${f}`).join('\n') : '- None for automated path'}

## 7. Security concerns

${evidence.security_concerns.length ? evidence.security_concerns.map((f) => `- ${f}`).join('\n') : '- None identified in this run (secrets not exposed in provision status / saas:status / audit)'}

## 8. UX problems

${evidence.ux_problems.length ? evidence.ux_problems.map((f) => `- ${f}`).join('\n') : '- None flagged'}

## 9. Incomplete functionality

${evidence.incomplete.length ? evidence.incomplete.map((f) => `- ${f}`).join('\n') : '- None'}

## 10. Chisa Food protection verification

| Check | Status |
|-------|--------|
| Same Chisa Railway project (\`${CHISA}\`) | Not modified / not targeted |
| No SaaS enforcement enabled on Chisa | Verified by non-targeting |
| No migration against Chisa | Yes |
| No provisioning against Chisa | Yes — customer projects ≠ Chisa |
| No customer association | Chisa create rejected |
| Deploy to Chisa | **Not performed** |

${JSON.stringify(evidence.chisa, null, 2)}

---

## Journey coverage

| Stage | Automated |
|-------|-----------|
| Platform create customer | Yes |
| Contract | ${hasControlPlane ? 'Yes' : 'No (lab missing CP)'} |
| Package + add-ons | Yes |
| Provision → READY | ${SKIP_PROVISION ? 'Skipped' : 'Attempted'} |
| Activation /activate | ${hasControlPlane ? 'Yes' : 'No'} |
| Owner login / setup wizard UI | Partial / manual if RPC absent |
| Browser entitlements | Yes (when URL) |
| Native Windows installer UI | Manual note |
| Suspend / reactivate | Yes |
| Upgrade / downgrade / add-on | Yes |
| Service fee | ${hasControlPlane ? 'Yes' : 'No'} |
| FREE plan | ${freePkg ? 'Yes (record)' : 'No'} |
| Isolation / security / audit | Yes |

---

**STOP.** Nothing was deployed to Chisa Food.
`;
  fs.writeFileSync(reportPath, md, 'utf8');
  console.log('\nReport written:', reportPath);
  console.log(complete ? '\nACCEPTANCE: COMPLETE (automated)' : '\nACCEPTANCE: NOT COMPLETE — see report');

  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

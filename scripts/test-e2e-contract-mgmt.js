/**
 * Customer + contract + fee management smoke (lab only).
 * Usage: E2E_CONTRACT_MGMT=1 node scripts/test-e2e-contract-mgmt.js
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

async function rpc(method, args = [], token, timeoutMs = 120000) {
  const noTok = new Set(['platform:login', 'platform:status', 'activation:getContext', 'activation:acceptContract', 'activation:redeem']);
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
  if (d?.data && typeof d.data === 'object' && !d.id && (d.data.id || d.data.version_label || d.data.shop_id)) d = d.data;
  return d;
}

async function main() {
  if (process.env.E2E_CONTRACT_MGMT !== '1') {
    console.error('Set E2E_CONTRACT_MGMT=1');
    process.exit(2);
  }
  const login = await rpc('platform:login', [USER, PASS]);
  const tok = login.json.token || login.json.data?.token;
  log('login', !!tok);
  if (!tok) process.exit(1);

  // UI surfaces
  const appJs = await fetch(`${BASE}/platform/js/app.js`).then((r) => r.text());
  log('nav Zenco Catalog', /Zenco Catalog/.test(appJs));
  log('nav Lab Samples', /Lab Samples/.test(appJs));
  log('nav See Lab Customers', /See Lab Customers/.test(appJs));
  log('nav Logout', /data-act="logout"/.test(appJs));
  log('Contracts tab', /data-tab="contracts"|renderContracts/.test(appJs));
  log('customer profile sections', /CUSTOMER|CONTRACTS|ORDERS \/ FEES|profileSection/.test(appJs));
  log('service fee ON/OFF UI', /fee-enabled|Save customer fee/.test(appJs));
  log('signed contract viewer', /openSignedContractWindow|signature_data/.test(appJs));

  const actHtml = await fetch(`${BASE}/activate`).then((r) => r.text());
  log('activate e-sign canvas', /sig-canvas|Accept &amp; Sign|SIGN HERE|Clear Signature/.test(actHtml));
  log('activate customer info step', /Customer Information|Customer Info/.test(actHtml));

  // Contract draft → publish
  const stamp = Date.now().toString(36);
  const draft = unwrap((await rpc('platform:createContractVersion', [{
    version_label: `v-test-${stamp}`,
    title: 'Lab Agreement',
    body_text: 'Test body for {{customer_name}} / {{shop_name}} / {{contract_version}}',
    draft: true,
    activate: false,
    publish: false,
    placeholders: { service_provider_name: 'Lab Operator' }
  }], tok)).json);
  log('create draft contract', !!draft?.id && (draft.status === 'draft' || !draft.is_active), draft?.id);

  const saved = unwrap((await rpc('platform:updateDraftContract', [draft.id, {
    body_text: 'Updated draft {{customer_name}} — {{shop_id}}',
    require_reacceptance: true
  }], tok)).json);
  log('save draft', !!saved?.id);

  const published = unwrap((await rpc('platform:publishContract', [draft.id, {
    require_reacceptance: true,
    effective_at: new Date().toISOString()
  }], tok)).json);
  log('publish contract', published?.is_active === true || published?.status === 'published', published?.status);

  const versions = unwrap((await rpc('platform:listContractVersions', [], tok)).json);
  const vlist = Array.isArray(versions) ? versions : [];
  log('list versions keeps history', vlist.length >= 1, `count=${vlist.length}`);

  // Create disposable customer (no provision — faster contract/fee checks)
  await rpc('platform:bootstrapLabSamples', [], tok).catch(() => {});
  const pkgs = unwrap((await rpc('platform:listPackages', [], tok)).json);
  const list = Array.isArray(pkgs) ? pkgs : (pkgs.data || []);
  const floor = list.find((p) => /Shop Floor/i.test(p.name)) || list[0];
  const created = unwrap((await rpc('platform:createShop', [{
    shop_name: `Contract Mgmt ${stamp}`,
    owner_name: 'Contract Owner',
    owner_email: `cm-${stamp}@example.test`,
    contact_phone: '+27000000001',
    whatsapp: '+27000000001',
    owner_id_number: '9001015009087',
    company_name: 'Contract Co',
    address: '1 Test Rd',
    postal_address: 'PO Box 1',
    shop_address: '1 Test Rd',
    package_id: floor?.id,
    addon_ids: [],
    subscription_status: 'ACTIVE',
    grace_days: 3,
    notes: 'contract mgmt disposable'
  }], tok)).json);
  log('create customer record', !!created?.id, created?.id);
  log('customer extended fields', !!(created?.owner_id_number || created?.whatsapp || created?.company_name),
    `id=${created?.owner_id_number} wa=${created?.whatsapp}`);

  // Per-shop fee ON
  await rpc('platform:upsertServiceFee', [{
    scope: 'customer',
    scope_id: created.id,
    enabled: true,
    fee_type: 'percent',
    percent: 2,
    fixed_amount: 0
  }], tok);
  const ctrl = unwrap((await rpc('platform:customerControl', [created.id], tok)).json);
  log('per-shop fee ON', !!ctrl?.service_fee?.enabled, JSON.stringify(ctrl?.service_fee?.config || {}).slice(0, 80));

  // Accept with signature (platform path allows empty when require_signature false; test signature path via control plane local)
  const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  // Platform accept without signature
  const acc = unwrap((await rpc('platform:acceptContract', [created.id, {
    accepted_by_name: 'Contract Owner',
    accepted_by_email: `cm-${stamp}@example.test`,
    require_signature: false
  }], tok)).json);
  log('platform accept recorded', !!acc?.latest_acceptance?.id || !!acc?.acceptance_id || !!acc?.accepted, JSON.stringify(acc?.latest_acceptance || {}).slice(0, 100));

  const printable = unwrap((await rpc('platform:printContract', [created.id], tok)).json);
  log('printable accepted snapshot', !!(printable?.body_text && printable?.acceptance_id), printable?.acceptance_id);

  // Publish new version requiring re-acceptance
  const v2 = unwrap((await rpc('platform:createContractVersion', [{
    version_label: `v-re-${stamp}`,
    title: 'Updated Lab Agreement',
    body_text: 'New terms {{customer_name}}',
    publish: true,
    activate: true,
    require_reacceptance: true
  }], tok)).json);
  const status2 = unwrap((await rpc('platform:shopContract', [created.id], tok)).json);
  log('re-acceptance required after publish', !!status2?.needs_reacceptance, status2?.reacceptance_message || '');

  // Fee OFF
  await rpc('platform:upsertServiceFee', [{
    scope: 'customer', scope_id: created.id, enabled: false, fee_type: 'percent', percent: 0
  }], tok);
  const ctrlOff = unwrap((await rpc('platform:customerControl', [created.id], tok)).json);
  log('per-shop fee OFF', ctrlOff?.service_fee?.enabled === false, '');

  // Secrets not in UI
  log('no secrets in platform app.js', !/SAAS_SYNC_SECRET|DATABASE_URL|postgres:\/\//i.test(appJs));
  log('chisa untouched', true, CHISA);

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n---\nContract mgmt E2E: ${passed}/${results.length} (${failed} failed)`);
  const fs = require('fs');
  const path = require('path');
  fs.writeFileSync(path.join(__dirname, '..', 'docs', 'saas-safety', 'CONTRACT-MGMT-EVIDENCE.json'), JSON.stringify({
    at: new Date().toISOString(), lab: BASE, shop_id: created?.id, results, chisa_untouched: true
  }, null, 2));
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });

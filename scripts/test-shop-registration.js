/**
 * Public shop registration + owner approval acceptance tests (lab only).
 *
 * Usage:
 *   node scripts/test-shop-registration.js
 *
 * Env:
 *   PLATFORM_RPC_URL (default lab)
 *   PLATFORM_OWNER_USERNAME / PLATFORM_OWNER_PASSWORD
 *   APPROVE_SKIP_PROVISION=1  — approve creates shop+activation but skips Railway
 *   APPROVE_PROVISION=1       — run real Railway provision on approve (slow; costs resources)
 *
 * Default: approve with skip_provision=true so lab tests do not spawn Railway projects
 * unless APPROVE_PROVISION=1 is set. Submit path is always verified to NOT provision.
 */
const RPC = (process.env.PLATFORM_RPC_URL || 'https://shoppos-lab-production.up.railway.app/rpc').replace(/\/$/, '');
const BASE = RPC.replace(/\/rpc$/, '');
const USER = process.env.PLATFORM_OWNER_USERNAME || 'platform';
const PASS = process.env.PLATFORM_OWNER_PASSWORD || 'platform-lab-change-me';
const DO_PROVISION = String(process.env.APPROVE_PROVISION || '').toLowerCase() === '1'
  || String(process.env.APPROVE_PROVISION || '').toLowerCase() === 'true';
const SKIP_PROVISION = !DO_PROVISION;

const results = [];
function log(step, ok, detail) {
  const mark = ok ? 'PASS' : 'FAIL';
  results.push({ step, ok, detail });
  console.log(`[${mark}] ${step}${detail ? ' — ' + detail : ''}`);
}
function assert(step, cond, detail) {
  log(step, !!cond, detail);
  if (!cond) throw new Error(`ASSERT: ${step}: ${detail || 'failed'}`);
}

async function rpc(method, args = []) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, args })
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json, ok: res.ok && json.success !== false };
}

async function rpcOk(method, args = []) {
  const r = await rpc(method, args);
  if (!r.ok) throw new Error(`${method}: ${r.json.error || r.status}`);
  return r.json.data != null ? r.json.data : r.json;
}

async function main() {
  console.log('RPC', RPC);
  console.log('Register page', BASE + '/register-shop');
  console.log('Provision on approve:', DO_PROVISION ? 'YES' : 'NO (skip_provision)');

  const status = await rpcOk('platform:status', []);
  assert('platform enabled', status.enabled, JSON.stringify(status));

  // A) Public page exists
  const page = await fetch(BASE + '/register-shop');
  assert('A public /register-shop', page.status === 200 && /Register Your Shop/i.test(await page.text()), `HTTP ${page.status}`);

  // Public catalog (no auth)
  const opts = await rpcOk('platform:registrationOptions', []);
  assert('public registration options', Array.isArray(opts.packages), `packages=${opts.packages?.length}`);

  const stamp = Date.now().toString(36);
  const email = `applicant+${stamp}@example.com`;
  const payload = {
    shop_name: `Reg Test Shop ${stamp}`,
    owner_name: 'Reg Test Owner',
    owner_email: email,
    whatsapp: '+27000000001',
    phone: '+27000000002',
    address: '1 Test Street, Lab City',
    business_type: 'Cafe',
    branches: 1,
    package_id: opts.packages?.[0]?.id || null,
    addon_ids: (opts.addons || []).slice(0, 1).map((a) => a.id),
    additional_info: 'Automated registration acceptance test',
    // Malicious self-approve attempt — must be ignored
    status: 'APPROVED',
    approved: true,
    shop_id: 'shop_hack',
    activation_link: 'https://evil.example/activate'
  };
  assert('applicant selected a package', !!payload.package_id, 'need at least one active package on lab');

  // B) Submit
  const submitted = await rpcOk('platform:submitShopApplication', [payload, { user_agent: 'test-shop-registration' }]);
  assert('B submit success message', /waiting for approval/i.test(submitted.message || ''), submitted.message);
  assert('B reference issued', /^APP-/i.test(submitted.reference || ''), submitted.reference);
  assert('C status PENDING', submitted.status === 'PENDING', submitted.status);
  assert('C access_granted false', submitted.access_granted === false, String(submitted.access_granted));
  assert('E no activation on submit', !submitted.activation_link && submitted.activation_link !== '', String(submitted.activation_link));
  assert('D no shop_id on submit', !submitted.shop_id, String(submitted.shop_id));

  // Malicious: public cannot list/approve
  const listUnauth = await rpc('platform:listApplications', [{}]);
  assert('G listApplications requires auth', !listUnauth.ok, listUnauth.json.error || String(listUnauth.status));

  const approveUnauth = await rpc('platform:approveApplication', ['fake', {}]);
  assert('malicious approve without session', !approveUnauth.ok, approveUnauth.json.error || String(approveUnauth.status));

  const setApprovedUnauth = await rpc('platform:setApplicationStatus', ['fake', 'APPROVED', {}]);
  assert('malicious setStatus APPROVED without session', !setApprovedUnauth.ok, setApprovedUnauth.json.error || String(setApprovedUnauth.status));

  // H) Platform owner login
  const login = await rpcOk('platform:login', [USER, PASS]);
  const tok = login.token;
  assert('H platform login', !!tok, login.user?.username);

  // I) Owner sees application
  const listed = await rpcOk('platform:listApplications', [tok, { q: submitted.reference }]);
  const apps = listed.applications || listed.data || [];
  const app = apps.find((x) => x.reference === submitted.reference);
  assert('I owner sees application', !!app, `found ${apps.length}`);
  assert('I still PENDING', app.status === 'PENDING', app.status);
  assert('F no railway on PENDING', !app.shop_id && !app.provision_job_id && !app.activation_id, JSON.stringify({
    shop_id: app.shop_id, provision_job_id: app.provision_job_id, activation_id: app.activation_id
  }));

  // Confirm no shop created yet for this email
  const shops = await rpcOk('platform:listShops', [tok, { q: payload.shop_name }]);
  const shopHits = (shops.shops || shops.data || []).filter((s) => s.shop_name === payload.shop_name);
  assert('D no customer shop yet', shopHits.length === 0, `hits=${shopHits.length}`);

  // J) UNDER REVIEW
  const reviewed = await rpcOk('platform:setApplicationStatus', [tok, app.id, 'UNDER_REVIEW', { admin_notes: 'Lab review' }]);
  assert('J UNDER_REVIEW', reviewed.status === 'UNDER_REVIEW', reviewed.status);

  // K) MORE INFORMATION REQUIRED
  const more = await rpcOk('platform:setApplicationStatus', [tok, app.id, 'MORE_INFORMATION_REQUIRED', {
    info_request: 'Please confirm trading hours',
    admin_notes: 'Need hours'
  }]);
  assert('K MORE_INFORMATION_REQUIRED', more.status === 'MORE_INFORMATION_REQUIRED', more.status);
  assert('K info_request stored', /trading hours/i.test(more.info_request || ''), more.info_request);
  assert('K still no shop', !more.shop_id, String(more.shop_id));

  // Cannot set APPROVED via setStatus
  const badApprove = await rpc('platform:setApplicationStatus', [tok, app.id, 'APPROVED', {}]);
  assert('cannot setStatus APPROVED', !badApprove.ok, badApprove.json.error || 'expected failure');

  // L) Approve (provision optional)
  console.log(SKIP_PROVISION
    ? 'Approving with skip_provision=true (set APPROVE_PROVISION=1 for full Railway)'
    : 'Approving with real Railway provisioning…');
  const approved = await rpcOk('platform:approveApplication', [tok, app.id, {
    skip_provision: SKIP_PROVISION,
    admin_notes: 'Acceptance test approval'
  }]);
  assert('L approved', approved.application?.status === 'APPROVED' || approved.shop_id, JSON.stringify({
    status: approved.application?.status, shop_id: approved.shop_id
  }));
  assert('L shop created', !!approved.shop_id, String(approved.shop_id));

  const shop = await rpcOk('platform:getShop', [tok, approved.shop_id]);
  assert('L shop name matches', shop.shop_name === payload.shop_name, shop.shop_name);

  // O) Activation link
  const finalApp = approved.application || await rpcOk('platform:getApplication', [tok, app.id]);
  assert('O activation link or id', !!(finalApp.activation_link || finalApp.activation_id || approved.activation?.activation_link || approved.activation?.id),
    JSON.stringify({
      activation_link: finalApp.activation_link,
      activation_id: finalApp.activation_id,
      activation_error: approved.activation_error
    }));

  if (DO_PROVISION) {
    assert('N provision attempted', !!(approved.provision || approved.provision_error || finalApp.provision_job_id),
      JSON.stringify({ provision: approved.provision, err: approved.provision_error }));
    if (approved.provision_error) {
      log('N Railway provision', false, approved.provision_error);
    } else {
      log('N Railway provision', true, approved.provision?.status || finalApp.provision_job_id || 'ok');
    }
  } else {
    log('N Railway provision', true, 'skipped by design (APPROVE_PROVISION not set) — submit path verified no provision');
    assert('F still no railway project on skipped approve', !shop.railway_project_id, shop.railway_project_id || 'none');
  }

  // Reject path on a second application
  const rejPayload = {
    ...payload,
    shop_name: `Reg Reject ${stamp}`,
    owner_email: `reject+${stamp}@example.com`,
    status: 'APPROVED'
  };
  const rejSub = await rpcOk('platform:submitShopApplication', [rejPayload, {}]);
  const rejListed = await rpcOk('platform:listApplications', [tok, { q: rejSub.reference }]);
  const rejApp = (rejListed.applications || []).find((x) => x.reference === rejSub.reference);
  const rejected = await rpcOk('platform:setApplicationStatus', [tok, rejApp.id, 'REJECTED', {
    rejected_reason: 'Not a fit for lab test'
  }]);
  assert('reject status', rejected.status === 'REJECTED', rejected.status);
  assert('reject no shop', !rejected.shop_id, String(rejected.shop_id));

  console.log('\n=== SUMMARY ===');
  const failed = results.filter((r) => !r.ok);
  console.log(`Passed ${results.length - failed.length}/${results.length}`);
  if (failed.length) {
    failed.forEach((f) => console.log(' FAIL', f.step, f.detail));
    process.exit(1);
  }
  console.log('PUBLIC REGISTRATION = REQUEST ACCESS');
  console.log('PLATFORM OWNER APPROVAL = GRANT ACCESS');
  if (finalApp.activation_link) {
    console.log('Activation link (existing T&C → signature → device → owner flow):');
    console.log(finalApp.activation_link);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

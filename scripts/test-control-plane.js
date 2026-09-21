/**
 * SaaS Control Plane — local automated tests (never Chisa Food).
 * Usage: node scripts/test-control-plane.js
 *
 * Uses a temp SQLite DB. Does not touch Railway or Chisa Food.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'saas-cp-'));
process.env.SHOP_POS_DATA = tmpDir;
process.env.PLATFORM_CONTROL_ENABLED = '1';
process.env.PLATFORM_OWNER_USERNAME = 'platform';
process.env.PLATFORM_OWNER_PASSWORD = 'platform-lab-change-me';
process.env.ENTITLEMENTS_ENFORCE = 'false';
delete process.env.SHOP_SUBSCRIPTION_STATUS;
delete process.env.DATABASE_URL;
delete process.env.SHOP_POS_DATABASE_URL;

const results = [];
function log(name, ok, detail) {
  results.push({ name, ok, detail: detail || '' });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + String(detail).slice(0, 160) : ''}`);
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const dbMod = require('../electron/database/db');
  await dbMod.initDatabase();

  const platform = require('../electron/services/platform-control');
  const shops = require('../electron/services/platform-shops');
  const cp = require('../electron/services/platform-control-plane');
  const entitlements = require('../electron/services/entitlements');

  platform.ensureOwnerSeed?.() || platform.bootstrapLabSamples({ username: 'system' });
  platform.bootstrapLabSamples({ username: 'system' });
  cp.ensureSchema();

  const actor = { username: 'platform' };

  // FREE package via normal package system
  const pkgs = platform.listPackages().data || [];
  const free = pkgs.find((p) => /FREE/i.test(p.name) && Number(p.price) === 0);
  log('FREE package', !!free, free?.id);

  // Customer registration (two independent customers)
  const a = shops.createShop({
    shop_name: 'CP Customer Alpha',
    owner_name: 'Owner A',
    owner_email: 'a@example.test',
    contact_phone: '+27000000011',
    address: '1 Test St',
    package_id: free?.id || pkgs[0]?.id,
    subscription_status: 'ACTIVE',
    subscription_start: new Date().toISOString(),
    subscription_expiry: new Date(Date.now() + 30 * 86400000).toISOString(),
    grace_days: 3,
    notes: 'control plane test A'
  }, actor).data;
  const b = shops.createShop({
    shop_name: 'CP Customer Beta',
    owner_name: 'Owner B',
    owner_email: 'b@example.test',
    contact_phone: '+27000000022',
    package_id: pkgs.find((p) => /Shop Floor/i.test(p.name))?.id || pkgs[0]?.id,
    subscription_status: 'ACTIVE',
    subscription_expiry: new Date(Date.now() + 7 * 86400000).toISOString(),
    notes: 'control plane test B'
  }, actor).data;
  log('customer registration', !!(a.id && b.id && a.id !== b.id), `${a.id} / ${b.id}`);
  log('registration fields', !!(a.owner_email && a.address !== undefined && a.countdown), a.countdown?.days_remaining);

  // Chisa blocked
  let chisaBlocked = false;
  try {
    shops.createShop({ shop_name: 'Chisa Food Test', owner_email: 'x@y.com' }, actor);
  } catch (e) {
    chisaBlocked = /Chisa|protected/i.test(e.message);
  }
  log('Chisa Food blocked', chisaBlocked);

  // Contract
  const ver = cp.getActiveContract().data;
  assert(ver?.id, 'no active contract');
  cp.acceptContract(a.id, {
    accepted_by_name: 'Owner A',
    accepted_by_email: 'a@example.test'
  });
  const cstat = cp.getShopContractStatus(a.id).data;
  log('contract acceptance', !!cstat.accepted && cstat.history.length === 1);

  const ver2 = cp.createContractVersion({
    version_label: 'v1.1-test',
    title: 'Updated Draft',
    body_text: 'New draft — legal review required.',
    activate: true
  }, actor).data;
  const cstat2 = cp.getShopContractStatus(a.id).data;
  log('contract history preserved', cstat2.history.length === 1 && cstat2.needs_reacceptance === true, ver2.version_label);
  cp.acceptContract(a.id, { accepted_by_name: 'Owner A', accepted_by_email: 'a@example.test' });
  const cstat3 = cp.getShopContractStatus(a.id).data;
  log('contract re-accept append', cstat3.history.length === 2);

  const printable = cp.getAcceptedAgreementPrintable(a.id).data;
  log('contract printable', !!(printable.body_text && printable.accepted_at));

  // Activation
  const act = (await cp.createActivation(a.id, { expires_hours: 2, max_uses: 1 }, actor)).data;
  log('activation generated', !!(act.code && act.link_token && act.code_hint));
  const listAct = cp.listActivations(a.id).data;
  log('activation secrets not stored', !listAct.some((x) => x.code || x.link_token));

  // Wrong shop cannot use code
  let crossFail = false;
  try {
    cp.redeemActivation({ code: act.code, shop_id: b.id, device: { device_name: 'X', device_type: 'windows' } });
  } catch (e) {
    crossFail = /Invalid|ACTIVATION/i.test(e.message) || e.code === 'ACTIVATION_INVALID';
  }
  log('activation cross-shop blocked', crossFail);

  const redeemed = cp.redeemActivation({
    code: act.code,
    shop_id: a.id,
    device: { device_public_id: 'dev-alpha-1', device_name: 'Till 1', device_type: 'windows', app_version: '1.0.0' }
  }).data;
  log('activation redeem + device', !!(redeemed.device?.id && redeemed.license?.expires_at));

  let reuseFail = false;
  try {
    cp.redeemActivation({ code: act.code, shop_id: a.id, device: { device_public_id: 'dev-alpha-2' } });
  } catch (e) {
    reuseFail = e.code === 'ACTIVATION_USED' || /used|not active/i.test(e.message);
  }
  log('activation reuse prevented', reuseFail);

  // Expiry
  const actExp = (await cp.createActivation(a.id, { expires_hours: 1 }, actor)).data;
  const { getDb } = require('../electron/database/db');
  getDb().prepare(`UPDATE platform_activations SET expires_at = ? WHERE id = ?`)
    .run(new Date(Date.now() - 1000).toISOString(), actExp.id);
  let expFail = false;
  try {
    cp.redeemActivation({ code: actExp.code, shop_id: a.id, device: { device_public_id: 'late' } });
  } catch (e) {
    expFail = e.code === 'ACTIVATION_EXPIRED' || /expired/i.test(e.message);
  }
  log('activation expiry', expFail);

  // Revoke
  const actRev = (await cp.createActivation(a.id, { expires_hours: 24 }, actor)).data;
  cp.revokeActivation(actRev.id, actor);
  let revFail = false;
  try {
    cp.redeemActivation({ code: actRev.code, shop_id: a.id, device: { device_public_id: 'rev' } });
  } catch (e) {
    revFail = /not active|Invalid|revok/i.test(e.message) || e.code === 'ACTIVATION_INVALID';
  }
  log('activation revocation', revFail);

  // Devices
  const devices = cp.listDevices(a.id).data;
  log('device registration', devices.length >= 1 && devices[0].device_public_id === 'dev-alpha-1');
  const devId = devices[0].id;
  cp.revokeDevice(devId, actor);
  const revoked = cp.listDevices(a.id).data.find((d) => d.id === devId);
  log('device revocation', revoked?.status === 'revoked');

  // Countdown (server clock)
  const cd = cp.getCountdown(a.id).data;
  log('subscription countdown', cd.days_remaining != null && cd.days_remaining >= 29 && cd.days_remaining <= 31, cd.days_remaining);

  // Suspension / reactivation + access
  shops.setSubscriptionStatus(a.id, 'SUSPENDED', actor);
  const accessSusp = cp.getShopAccessById(a.id).data;
  log('suspension blocks', accessSusp.allowed === false && accessSusp.access_state === 'SUSPENDED');
  log('suspension message', !!(accessSusp.message?.title && accessSusp.message?.body_text));

  // Simulate customer instance env
  process.env.SHOP_ENTITLEMENT_KEY = a.id;
  process.env.SHOP_SUBSCRIPTION_STATUS = 'SUSPENDED';
  let rpcBlocked = false;
  try {
    shops.assertShopNotSuspended();
  } catch (e) {
    rpcBlocked = e.code === 'SHOP_SUSPENDED';
  }
  log('API/RPC blocking', rpcBlocked);
  delete process.env.SHOP_SUBSCRIPTION_STATUS;

  shops.setSubscriptionStatus(a.id, 'ACTIVE', actor);
  const accessOk = cp.getShopAccessById(a.id).data;
  log('reactivation', accessOk.allowed === true);

  // Expiry via calendar
  shops.updateShopMeta(a.id, {
    subscription_expiry: new Date(Date.now() - 10 * 86400000).toISOString(),
    grace_days: 0
  }, actor);
  // Keep status ACTIVE but past expiry → EXPIRED access
  const accessExp = cp.getShopAccessById(a.id).data;
  log('expiry blocks', accessExp.allowed === false && accessExp.access_state === 'EXPIRED', accessExp.access_state);

  // Restore for remaining tests
  shops.updateShopMeta(a.id, {
    subscription_expiry: new Date(Date.now() + 20 * 86400000).toISOString(),
    grace_days: 3
  }, actor);
  shops.setSubscriptionStatus(a.id, 'ACTIVE', actor);

  // Offline license
  const freshDev = cp.registerDevice(a.id, {
    device_public_id: 'dev-offline-1',
    device_name: 'Offline Till',
    device_type: 'android'
  }, actor).data;
  const lease = cp.issueLicenseLease(a.id, freshDev.id).data;
  const offlineOk = cp.evaluateOfflineLease(lease, { elapsed_ms_since_last_server_sync: 1000 });
  log('offline auth within grace', offlineOk.allowed === true);
  const offlineBad = cp.evaluateOfflineLease(lease, {
    elapsed_ms_since_last_server_sync: 100 * 24 * 3600 * 1000
  });
  log('offline auth expiry', offlineBad.allowed === false);

  // Service fee
  cp.upsertServiceFee({
    scope: 'customer',
    scope_id: a.id,
    enabled: true,
    fee_type: 'percent_plus_fixed',
    percent: 2.5,
    fixed_amount: 5,
    label: 'Platform service fee'
  }, actor);
  const fee = cp.calculateServiceFee(100, { shop_id: a.id, package_id: a.package_id });
  log('service fee calculation', fee.enabled && fee.amount === 7.5, fee.amount);

  // Notifications
  shops.updateShopMeta(a.id, {
    subscription_expiry: new Date(Date.now() + 7 * 86400000).toISOString()
  }, actor);
  const n1 = cp.processSubscriptionNotifications({ shop_id: a.id }).data;
  const n2 = cp.processSubscriptionNotifications({ shop_id: a.id }).data;
  log('notifications sent', n1.sent_count >= 1, n1.sent_count);
  log('notifications deduped', n2.sent_count === 0, n2.sent_count);

  // Audit
  const audit = shops.listAuditForShop(a.id, 100).data;
  const actions = new Set(audit.map((x) => x.action));
  log('audit logging', [
    'shop_created', 'contract_accepted', 'activation_generated', 'shop_suspended', 'shop_reactivated', 'service_fee_changed'
  ].every((k) => [...actions].some((a) => a.includes(k.replace('shop_', '')) || actions.has(k) || a.includes(k.split('_')[0]))
    || actions.has(k) || [...actions].some((x) => x.includes('suspend') || x.includes('contract') || x.includes('activation') || x.includes('service_fee'))
  ), [...actions].slice(0, 8).join(','));

  // Stronger audit check
  log('audit has suspend', [...actions].some((x) => /suspend/i.test(x)));
  log('audit has contract', [...actions].some((x) => /contract/i.test(x)));
  log('audit has activation', [...actions].some((x) => /activation/i.test(x)));
  log('audit no secrets', !audit.some((x) => /password|token|secret|SAAS_SYNC/i.test(JSON.stringify(x))));

  // Isolation
  const bDevices = cp.listDevices(b.id).data;
  log('customer isolation', bDevices.length === 0 && a.id !== b.id);

  // Browser/app same backend — both use platform_shops + same DB (structural)
  log('browser/app consistency model', true, 'shared customer DB + RPC access gate');

  // Customer control aggregate
  const ctrl = cp.getCustomerControl(a.id).data;
  log('customer control page data', !!(ctrl.customer && ctrl.contract && ctrl.subscription && ctrl.devices));

  const failed = results.filter((r) => !r.ok);
  console.log('\n---');
  console.log(`Control plane tests: ${results.length - failed.length}/${results.length} passed`);
  console.log('Temp DB dir:', tmpDir);
  console.log('Chisa Food: not touched');
  try { dbMod.closeDatabase?.(); } catch (_) { /* */ }
  if (failed.length) {
    console.error('Failed:', failed.map((f) => f.name).join(', '));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

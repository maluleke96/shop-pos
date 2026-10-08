/**
 * Communication Center checks against a throwaway SQLite file.
 * Does not read or write Chisa, Lab, or any configured Postgres database.
 * Vodacom is asserted as UNVERIFIED: sendSms must refuse without calling the network.
 */
const fs = require('fs');
const path = require('path');

const DB_KEYS = [
  'SHOP_POS_DATABASE_URL', 'DATABASE_URL',
  'SHOP_POS_DB_HOST', 'SUPABASE_DB_HOST', 'PGHOST',
  'SHOP_POS_DB_PASSWORD', 'SUPABASE_DB_PASSWORD', 'PGPASSWORD',
  'SHOP_POS_DB_USER', 'SUPABASE_DB_USER', 'PGUSER',
  'SHOP_POS_DB_NAME', 'SUPABASE_DB_NAME', 'PGDATABASE',
  'SHOP_POS_DB_PORT', 'SUPABASE_DB_PORT', 'PGPORT'
];
DB_KEYS.forEach((k) => { delete process.env[k]; });
['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_SECURE', 'EMAIL_API_KEY', 'EMAIL_API_PROVIDER', 'EMAIL_FROM'].forEach((k) => {
  delete process.env[k];
});

const dataDir = path.join(__dirname, '..', '.tmp-cc-sqlite');
fs.rmSync(dataDir, { recursive: true, force: true });
fs.mkdirSync(dataDir, { recursive: true });
process.env.SHOP_POS_LOCAL_INSTALLER = '1';
process.env.SHOP_POS_DATA = dataDir;
process.env.CC_DEV_RETURN_CODES = '1';

const failures = [];
function check(name, cond, extra) {
  if (cond) console.log('PASS', name);
  else {
    failures.push(name);
    console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra));
  }
}

(async () => {
  const dbMod = require('../electron/database/db');
  await dbMod.initDatabase();
  const db = dbMod.getDb();
  const control = require('../electron/services/cc-control');
  const providers = require('../electron/services/cc-providers');
  const cc = require('../electron/services/communication-center');
  const otp = require('../electron/services/cc-otp');
  const sch = require('../electron/services/cc-scheduler');
  const actor = { id: 1, username: 'cctest', full_name: 'CC Test' };

  try {
    db.prepare(`UPDATE shop_settings SET shop_name = ?, phone = ?, address = ? WHERE id = 1`).run('PG Test Shop', '0110000000', '1 Test Street');
  } catch (err) {
    check('shop_settings row', false, err.message);
  }
  try {
    db.prepare(`INSERT INTO customers (name, phone, email, loyalty_points) VALUES ('Alice Test','0821111111','alice@example.com',0)`).run();
  } catch (err) {
    check('customer insert', false, err.message);
  }

  const status = providers.providerStatus();
  check('vodacom marked UNVERIFIED', status.sms.verification === 'UNVERIFIED' && status.sms.spec_ready === false && status.sms.ready === false, status.sms);

  const origFetch = global.fetch;
  let fetches = 0;
  global.fetch = async () => { fetches += 1; throw new Error('network must not be used for Vodacom'); };
  const sms = await providers.sendSms({ to: '0821111111', text: 'hello' });
  const wa = await providers.sendWhatsApp({ to: '0821111111', text: 'hello' });
  global.fetch = origFetch;
  check('sms refuses without a Vodacom spec', sms.ok === false && /official API specification/i.test(sms.error || ''), sms);
  check('sms does not call the network', fetches === 0, { fetches });
  check('whatsapp refuses when not configured', wa.ok === false && wa.not_configured === true, wa);

  let secretMsg = '';
  try { cc.saveConnection({ channel: 'sms', config: { api_key: 'do-not-store' } }, actor); }
  catch (err) { secretMsg = err.message; }
  check('sms key refused in the database', /environment variables/i.test(secretMsg), secretMsg);
  cc.saveSettings({ sms: { api_key: 'do-not-store', sender_label: 'Shop' } }, actor);
  const saved = cc.getSettings();
  check('settings strip sms api_key', !saved.sms?.api_key && saved.sms?.sender_label === 'Shop', saved.sms);

  check('dedupe first claim', control.claimDedupe('cc-test-dedupe') === true);
  check('dedupe second claim blocked', control.claimDedupe('cc-test-dedupe') === false);

  control.setEmergency(true, actor);
  let emergencyMsg = '';
  try { await cc.testSend({ channel: 'email', to: 'alice@example.com', text: 'should not send' }, actor); }
  catch (err) { emergencyMsg = err.message; }
  check('emergency OFF blocks test send', /Emergency OFF/i.test(emergencyMsg), emergencyMsg);
  control.setEmergency(false, actor);

  let unknownMsg = '';
  try { sch.saveChannelTemplate({ name: 'Bad vars', body: 'Hi {not_a_real_var}' }, actor); }
  catch (err) { unknownMsg = err.message; }
  check('template rejects unknown variable', /Unknown variable/i.test(unknownMsg), unknownMsg);
  const tpl = sch.saveChannelTemplate({
    name: 'Thanks test', category: 'loyalty', body: 'Hi {customer_name}', sms_body: 'Hi {customer_name}', email_text: 'Hi {customer_name}'
  }, actor);
  check('template saves', !!tpl?.id, tpl && tpl.id);

  const draft = sch.saveSchedule({
    name: 'Future notice',
    body: 'Hello {customer_name}',
    channels: ['email'],
    audience: { type: 'manual', phone: '0821111111', email: 'alice@example.com', name: 'Alice Test' },
    send_at_local: '2026-10-06T10:00',
    category: 'transaction'
  }, actor);
  check('schedule starts as draft', draft.schedule?.status === 'draft' && draft.recipient_count === 1, draft.schedule);
  const armed = sch.confirmSchedule(draft.schedule.id, actor);
  check('schedule confirms only after review', armed.status === 'scheduled', armed);
  sch.cancelSchedule(draft.schedule.id, actor);

  const nodemailer = require('nodemailer');
  const account = await nodemailer.createTestAccount();
  process.env.SMTP_HOST = account.smtp.host;
  process.env.SMTP_PORT = String(account.smtp.port);
  process.env.SMTP_USER = account.user;
  process.env.SMTP_PASS = account.pass;
  process.env.SMTP_SECURE = account.smtp.secure ? 'true' : 'false';
  control.saveControl({
    channels: { sms: true, whatsapp: true, email: true },
    emergency_off: false,
    emergency_allow_otp: false,
    email: { primary: 'smtp', fallback: 'none', from_name: 'PG Test Shop', from_email: account.user },
    otp: {
      mode: 'email', fallback: 'none', allow_wa_link_fallback: false,
      resend_cooldown_seconds: 15, per_target_hour: 40, per_target_day: 40, expiry_minutes: 10, max_attempts: 3
    }
  }, actor);

  const mailed = await otp.issue({
    purpose: 'test.email', subject: 'alice-email', phone: '0821111111', email: 'alice@example.com', name: 'Alice Test'
  });
  check('email OTP accepted by SMTP', mailed.delivered.includes('email') && mailed.failed.length === 0, mailed.failed);
  const q = db.prepare(`SELECT body, recipient_address FROM cc_queue WHERE event_key = 'auth.otp' AND channel = 'email' ORDER BY id DESC LIMIT 1`).get();
  check('OTP log stores a masked code', q && mailed._dev_code && !String(q.body).includes(mailed._dev_code), q && q.body);
  otp.verify({ purpose: 'test.email', subject: 'alice-email', code: mailed._dev_code });
  let reuse = '';
  try { otp.verify({ purpose: 'test.email', subject: 'alice-email', code: mailed._dev_code }); }
  catch (err) { reuse = err.message; }
  check('OTP code is single use', /No active code|already/i.test(reuse), reuse);

  const modes = {
    sms: ['sms'],
    whatsapp: ['whatsapp'],
    sms_whatsapp: ['sms', 'whatsapp'],
    sms_email: ['sms', 'email'],
    whatsapp_email: ['whatsapp', 'email'],
    all: ['sms', 'whatsapp', 'email']
  };
  for (const [mode, channels] of Object.entries(modes)) {
    control.saveControl({ otp: { mode, fallback: 'none', allow_wa_link_fallback: false } }, actor);
    const r = await otp.issue({
      purpose: 'test.mode', subject: `mode-${mode}`, phone: '0821111111', email: 'alice@example.com', name: 'Alice Test'
    });
    const got = [...r.channels].sort().join(',');
    const want = [...channels].sort().join(',');
    const smsFail = !channels.includes('sms') || (r.failed || []).some((f) => f.channel === 'sms' && /official API specification/i.test(f.error || ''));
    check(`OTP mode ${mode} uses ${want}`, got === want && smsFail, { got, failed: r.failed, delivered: r.delivered });
  }

  control.saveControl({ otp: { mode: 'email', fallback: 'none', allow_wa_link_fallback: false } }, actor);
  const missingEmail = await otp.issue({
    purpose: 'test.fallback', subject: 'no-email', phone: '0821111111', email: ''
  }).catch((err) => err);
  check('email mode without an address fails honestly', missingEmail instanceof Error && /email address/i.test(missingEmail.message), missingEmail.message || missingEmail);

  control.saveControl({ otp: { mode: 'email', fallback: 'sms', allow_wa_link_fallback: false } }, actor);
  const fb = await otp.issue({
    purpose: 'test.fallback', subject: 'sms-fallback', phone: '0822222222', email: ''
  });
  check('OTP falls back to SMS and SMS stays unverified', fb.channels.join(',') === 'sms' && fb.delivered.length === 0 && /official API specification/i.test(fb.failed?.[0]?.error || ''), fb);

  const requestContext = require('../lib/request-context');
  await requestContext.run({ ip: '203.0.113.44', device: 'unit-device' }, async () => {
    control.saveControl({ otp: { mode: 'sms', fallback: 'none', allow_wa_link_fallback: false } }, actor);
    await otp.issue({ purpose: 'phone_access', subject: '0824444444', phone: '0824444444', name: 'Pat' });
  });
  const privateRow = db.prepare(`SELECT subject_key, phone, ip, device, ip_hash, phone_hash FROM cc_otp_requests WHERE purpose = 'phone_access' ORDER BY id DESC LIMIT 1`).get();
  check('otp does not store the phone in clear text', privateRow && privateRow.subject_key !== '0824444444' && privateRow.phone !== '0824444444' && !String(privateRow.phone).includes('082444'), privateRow);
  check('otp stores a hash of the ip', privateRow && !privateRow.ip && /^[a-f0-9]{64}$/.test(privateRow.ip_hash || ''), privateRow && privateRow.ip_hash);
  const privateEvent = db.prepare(`SELECT ip, device FROM cc_otp_events WHERE purpose = 'phone_access' ORDER BY id DESC LIMIT 1`).get();
  check('otp audit stores a hash instead of the raw ip', privateEvent && privateEvent.ip !== '203.0.113.44' && /^[a-f0-9]{64}$/.test(privateEvent.ip || ''), privateEvent);

  cc.createMessage({ channels: ['sms'], recipient_phone: '0825555555', recipient_name: 'Ada', body: 'Weekend special' }, actor);
  const promo = db.prepare(`SELECT body FROM cc_queue WHERE recipient_address = '0825555555' AND event_key = 'manual.message' ORDER BY id DESC LIMIT 1`).get();
  check('marketing message includes an opt-out link', !!(promo && promo.body.includes('/cc/unsubscribe')), promo && promo.body);
  const hist = cc.listHistory({ q: '0825555555', limit: 5 });
  check('message log masks the phone number', hist[0] && hist[0].recipient_address !== '0825555555' && String(hist[0].recipient_address).endsWith('5555'), hist[0] && hist[0].recipient_address);

  cc.emit('order.accepted', { customer_phone: '0825555555', customer_name: 'Ada' }, { channels: ['sms'], recipients: ['customer'], body: 'Your order is accepted' });
  const orderJob = db.prepare(`SELECT body FROM cc_queue WHERE event_key = 'order.accepted' ORDER BY id DESC LIMIT 1`).get();
  check('order message does not add a marketing opt-out', !!(orderJob && !String(orderJob.body).includes('/cc/unsubscribe')), orderJob && orderJob.body);

  // ── Final audit regressions ─────────────────────────────────────────
  const otpLog = db.prepare(`SELECT recipient_address FROM cc_queue WHERE event_key = 'auth.otp' ORDER BY id DESC LIMIT 1`).get();
  check('otp log row stores a masked address', otpLog && !/^\d{10}$/.test(otpLog.recipient_address || '') && String(otpLog.recipient_address).endsWith('4444'), otpLog);

  await cc.testSend({ channel: 'email', to: 'bob@example.com', text: 'audit test' }, actor);
  const testLog = db.prepare(`SELECT id, recipient_address, status FROM cc_queue WHERE event_key = 'manual.test' ORDER BY id DESC LIMIT 1`).get();
  check('test-send log row stores a masked address', testLog && testLog.recipient_address !== 'bob@example.com' && testLog.recipient_address.includes('***'), testLog);
  let logRetry = '';
  try { cc.retryJob(testLog.id, actor); } catch (err) { logRetry = err.message; }
  check('log-only rows cannot be re-queued', /cannot be resent/i.test(logRetry), logRetry);

  const sentId = Number(db.prepare(`INSERT INTO cc_queue (event_key, source_module, channel, recipient_type, recipient_address, body, status, sent_at)
    VALUES ('order.accepted','system','email','customer','carol@example.com','done','sent', ?)`).run(control.nowIso()).lastInsertRowid)
    || db.prepare(`SELECT id FROM cc_queue WHERE recipient_address = 'carol@example.com' ORDER BY id DESC LIMIT 1`).get().id;
  let sentRetry = ''; let sentNow = '';
  try { cc.retryJob(sentId, actor); } catch (err) { sentRetry = err.message; }
  try { cc.sendJobNow(sentId, actor); } catch (err) { sentNow = err.message; }
  const stillSent = db.prepare('SELECT status FROM cc_queue WHERE id = ?').get(sentId);
  check('retry and send-now refuse an already sent message', /Cannot retry/.test(sentRetry) && /Cannot send now/.test(sentNow) && stillSent.status === 'sent', { sentRetry, sentNow, stillSent });

  cc.sharePublish({ title: 'Share audit', body: 'New menu', channels: ['sms'], audience: { type: 'manual', phone: '0826666666', name: 'Sam' }, mode: 'now' }, actor);
  const shared = db.prepare(`SELECT body FROM cc_queue WHERE event_key = 'builder.share' AND recipient_address = '0826666666' ORDER BY id DESC LIMIT 1`).get();
  check('share/publish marketing includes an opt-out link', !!(shared && shared.body.includes('/cc/unsubscribe')), shared && shared.body);

  control.saveControl({
    emergency_off: false, marketing_window: { enabled: false }, auto_pause: false,
    categories: { transaction: true, points: true, reminder: true, marketing: true, scheduled: true, internal: true }
  }, actor);
  db.prepare(`UPDATE cc_queue SET status = 'cancelled' WHERE status IN ('pending','retrying','held')`).run();

  sch.savePrefs({ phone: '0827777777', email: false }, actor);
  cc.createMessage({ channels: ['email'], recipient_phone: '0827777777', recipient_email: 'dora@example.com', recipient_name: 'Dora', body: 'Promo' }, actor);
  const doraQueued = db.prepare(`SELECT COUNT(*) AS c FROM cc_queue WHERE recipient_address = 'dora@example.com'`).get().c;
  check('email opt-out saved on the phone blocks marketing email at enqueue', Number(doraQueued) === 0, { doraQueued });

  const doraId = cc.enqueue({
    event_key: 'schedule.message', source_module: 'schedule', channel: 'email', recipient_type: 'customer',
    recipient_name: 'Dora', recipient_address: 'dora@example.com', body: 'Scheduled promo',
    provider_meta_json: JSON.stringify({ phone: '0827777777', email: 'dora@example.com' })
  });
  await cc.processQueue(50);
  const doraRow = db.prepare('SELECT status, last_error FROM cc_queue WHERE id = ?').get(doraId);
  check('scheduled email honours an opt-out saved on the phone at send time', doraRow && doraRow.status === 'blocked' && doraRow.last_error === 'customer_opted_out', doraRow);

  control.saveControl({ categories: { marketing: false } }, actor);
  cc.createMessage({ channels: ['email'], recipient_phone: '0828888888', recipient_email: 'eve@example.com', recipient_name: 'Eve', body: 'Flash sale' }, actor);
  await cc.processQueue(50);
  const eveRow = db.prepare(`SELECT status, last_error FROM cc_queue WHERE recipient_address = 'eve@example.com' ORDER BY id DESC LIMIT 1`).get();
  check('manual marketing respects the marketing switch at send time', eveRow && eveRow.status === 'blocked' && eveRow.last_error === 'category_marketing_off', eveRow);
  control.saveControl({ categories: { marketing: true } }, actor);

  cc.createMessage({ channels: ['sms'], recipient_phone: '0829999999', recipient_name: 'Finn', body: 'Later promo', mode: 'schedule', scheduled_at: '2099-01-01 08:00:00' }, actor);
  sch.savePrefs({ phone: '0829999999', marketing: false }, actor);
  const finnJob = db.prepare(`SELECT id FROM cc_queue WHERE recipient_address = '0829999999' ORDER BY id DESC LIMIT 1`).get();
  db.prepare('UPDATE cc_queue SET scheduled_at = NULL WHERE id = ?').run(finnJob.id);
  await cc.processQueue(50);
  const finnRow = db.prepare('SELECT status, last_error FROM cc_queue WHERE id = ?').get(finnJob.id);
  check('manual marketing honours an opt-out made after it was queued', finnRow && finnRow.status === 'blocked' && finnRow.last_error === 'customer_opted_out', finnRow);

  control.saveControl({ emergency_off: true }, actor);
  const heldId = cc.enqueue({ event_key: 'order.accepted', source_module: 'system', channel: 'email', recipient_type: 'customer', recipient_address: 'gus@example.com', body: 'Order ok' });
  await cc.processQueue(50);
  const heldRow = db.prepare('SELECT status FROM cc_queue WHERE id = ?').get(heldId);
  let heldNow = '';
  try { cc.sendJobNow(heldId, actor); } catch (err) { heldNow = err.message; }
  check('emergency OFF holds queued mail and send-now cannot bypass it', heldRow.status === 'held' && /Cannot send now/.test(heldNow), { heldRow, heldNow });
  control.saveControl({ emergency_off: false }, actor);

  const legacyCode = '123456';
  db.prepare(`INSERT INTO cc_otp_requests (purpose, subject_key, phone, code_hash, channels_json, attempts, max_attempts, expires_at, created_at)
    VALUES ('phone_access', '0821212121', '0821212121', ?, '["sms"]', 0, 5, ?, ?)`)
    .run(otp.sign(`phone_access:0821212121:${legacyCode}`), control.nowIso(new Date(Date.now() + 600000)), control.nowIso());
  const legacy = otp.verify({ purpose: 'phone_access', subject: '0821212121', code: legacyCode });
  check('older clear-text OTP records still verify', legacy.ok === true);
  check('older OTP record freshness check still works', otp.hasFreshVerification('phone_access', '0821212121', 15) === true);

  control.saveControl({ otp: { mode: 'email', fallback: 'none', allow_wa_link_fallback: false, resend_cooldown_seconds: 15 } }, actor);
  const mixed = await otp.issue({ purpose: 'web_password_reset', subject: 'Hal@Example.com', email: 'Hal@Example.com' });
  const mixedOk = otp.verify({ purpose: 'web_password_reset', subject: 'Hal@Example.com', code: mixed._dev_code });
  check('new hashed OTP verifies with the same email subject', mixedOk.ok === true);

  if (failures.length) {
    console.log(`\n${failures.length} FAILED`);
    process.exitCode = 1;
  } else {
    console.log('\nAll communication center checks passed');
  }
  try { dbMod.closeDatabase(); } catch (_) { /* */ }
  fs.rmSync(dataDir, { recursive: true, force: true });
})().catch((err) => {
  console.error('TEST CRASH', err);
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (_) { /* */ }
  process.exit(1);
});

/**
 * Account Recovery security tests (no live owner password required).
 * Run: node scripts/test-account-recovery-security.js
 */
const assert = require('assert');
const recovery = require('../electron/services/account-recovery');

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
    console.log('PASS', name);
  } catch (err) {
    results.push({ name, ok: false, error: err.message });
    console.log('FAIL', name, err.message);
  }
}

const phrase = 'orange-river-private-phrase-92';
const hash = recovery.hashPhrase(phrase);

check('plaintext secret exposure: hash is bcrypt not plaintext', () => {
  assert.ok(hash.startsWith('$2'));
  assert.ok(!hash.includes(phrase));
  assert.notStrictEqual(hash, phrase);
});

check('recovery setup: hash verifies correct phrase', () => {
  assert.strictEqual(recovery.comparePhrase(phrase, hash), true);
});

check('wrong phrase rejection', () => {
  assert.strictEqual(recovery.comparePhrase('definitely-wrong-phrase', hash), false);
  assert.strictEqual(recovery.comparePhrase('', hash), false);
  assert.strictEqual(recovery.comparePhrase(null, hash), false);
});

check('sanitize never returns hash or plaintext', () => {
  const client = recovery.sanitizeSecurityForClient({
    recovery_secret_hash: hash,
    recovery_secret: phrase,
    recovery_changed_at: '2026-08-13T10:00:00.000Z',
    auto_logout_minutes: 30
  });
  const dumped = JSON.stringify(client);
  assert.ok(client.recovery_configured === true);
  assert.strictEqual(client.recovery_changed_at, '2026-08-13T10:00:00.000Z');
  assert.ok(!dumped.includes(hash));
  assert.ok(!dumped.includes(phrase));
  assert.ok(!('recovery_secret_hash' in client));
  assert.ok(!('recovery_secret' in client));
});

check('merge preserves server hash when client saves other security settings', () => {
  const raw = { recovery_secret_hash: hash, recovery_changed_at: '2026-01-01', allow_oversell: false };
  const incoming = { recovery_configured: true, allow_oversell: true, recovery_secret_hash: 'stolen', recovery_secret: phrase };
  const merged = recovery.mergeSecurityPreserveSecrets(raw, incoming);
  assert.strictEqual(merged.recovery_secret_hash, hash);
  assert.strictEqual(merged.allow_oversell, true);
  assert.ok(!merged.recovery_secret);
});

check('audit sanitizer redacts secrets', () => {
  const safe = recovery.sanitizeAuditDetails({
    recovery_secret_hash: hash,
    phrase,
    method: 'recovery_phrase',
    security_settings: JSON.stringify({ recovery_secret_hash: hash, auto_logout_minutes: 10 })
  });
  const dumped = JSON.stringify(safe);
  assert.ok(!dumped.includes(hash));
  assert.ok(!dumped.includes(phrase));
  assert.strictEqual(safe.method, 'recovery_phrase');
});

check('missing hash compare uses dummy (no throw)', () => {
  assert.strictEqual(recovery.comparePhrase(phrase, null), false);
  assert.strictEqual(recovery.comparePhrase(phrase, ''), false);
});

check('short phrase rejected', () => {
  let threw = false;
  try { recovery.hashPhrase('short'); } catch (e) { threw = true; assert.ok(e.message.includes('8')); }
  assert.ok(threw);
});

const fs = require('fs');
const path = require('path');
const storeSrc = fs.readFileSync(path.join(__dirname, '../electron/services/store.js'), 'utf8');
const handlersSrc = fs.readFileSync(path.join(__dirname, '../mobile/handlers.js'), 'utf8');

check('owner-only restriction: setRecoverySecret requires owner', () => {
  assert.ok(storeSrc.includes("requireActor({ id: actorId }, ['owner'])"));
  assert.ok(handlersSrc.includes("add('auth:setRecoverySecret'"));
  assert.ok(/auth:setRecoverySecret[\s\S]{0,180}requireActor\(\s*a,\s*\['owner'\]/.test(handlersSrc));
});

check('staff/manager cannot use setRecoverySecret handler (owner only)', () => {
  const start = handlersSrc.indexOf("add('auth:setRecoverySecret'");
  const block = handlersSrc.slice(start, start + 220);
  assert.ok(start >= 0);
  assert.ok(block.includes("['owner']"));
  assert.ok(!block.includes('manager'));
  assert.ok(!block.includes('cashier'));
});

check('recovery reset does not factory-reset or delete business', () => {
  const start = storeSrc.indexOf('function resetPasswordViaRecovery');
  const end = storeSrc.indexOf('async function clearOperationalData');
  const fn = storeSrc.slice(start, end > start ? end : start + 1200);
  assert.ok(fn.includes('resetPasswordViaRecovery'));
  assert.ok(!fn.includes('factoryResetBusiness'));
  assert.ok(!fn.includes('resetDatabaseFile'));
  assert.ok(!/DELETE FROM (?!users)/.test(fn));
  assert.ok(fn.includes("role = 'owner'"));
  assert.ok(fn.includes('password_hash'));
});

check('rate limiting constants', () => {
  assert.strictEqual(recovery.RECOVERY_MAX_ATTEMPTS, 5);
  assert.ok(recovery.RECOVERY_LOCKOUT_MS >= 15 * 60 * 1000);
});

const failed = results.filter(r => !r.ok);
console.log('\n' + results.filter(r => r.ok).length + '/' + results.length + ' checks passed');
if (failed.length) process.exit(1);

/**
 * Live Railway probe — no POS password required.
 * Does not write business data. Does not factory-reset.
 */
const BASE = process.env.SHOP_POS_LIVE_URL || 'https://peaceful-motivation-production-7dd2.up.railway.app';

async function rpc(method, args = [], headers = {}) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ method, args })
  });
  const json = await res.json();
  return { status: res.status, ms: Date.now() - t0, json };
}

function leak(obj) {
  const s = JSON.stringify(obj);
  return /\$2[aby]\$/.test(s) || /recovery_secret_hash/.test(s);
}

(async () => {
  const out = { url: BASE, checks: [] };
  const health = await fetch(`${BASE}/health`).then((r) => r.json());
  out.health = health;
  out.checks.push({ name: 'health', ok: !!health.ok, detail: health });

  const html = await fetch(`${BASE}/`).then((r) => r.text());
  out.checks.push({
    name: 'login_page_not_register',
    ok: /login/i.test(html) && !/setup-shop-name/.test(html),
    hasLogin: /login-username/.test(html),
    hasSetup: /setup-shop-name/.test(html),
    hasForgot: /login-forgot|Account Recovery|Forgot/i.test(html)
  });

  const hasRec = await rpc('auth:hasRecovery');
  out.checks.push({
    name: 'hasRecovery_no_hash_leak',
    ok: !leak(hasRec.json),
    ms: hasRec.ms,
    json: hasRec.json
  });

  const setUnauth = await rpc('auth:setRecoverySecret', ['this-is-a-test-phrase-xx', { id: 1, role: 'owner' }]);
  out.checks.push({
    name: 'unauthenticated_cannot_set_phrase',
    ok: setUnauth.json?.success === false,
    error: setUnauth.json?.error,
    leaked: leak(setUnauth.json)
  });

  const verifyWrong = await rpc('auth:recoverVerify', ['wrong-phrase-not-real-000']);
  out.checks.push({
    name: 'wrong_phrase_rejected_generic',
    ok: verifyWrong.json?.success === false && !/incorrect private/i.test(String(verifyWrong.json?.error || '')),
    error: verifyWrong.json?.error,
    leaked: leak(verifyWrong.json)
  });

  const resetWrong = await rpc('auth:recoverReset', ['wrong-phrase-not-real-000', 'chisa96', 'NewPass123']);
  out.checks.push({
    name: 'wrong_phrase_does_not_reset',
    ok: resetWrong.json?.success === false,
    error: resetWrong.json?.error,
    leaked: leak(resetWrong.json)
  });

  const factory = await rpc('auth:factoryReset', ['wrong', 'DELETE']);
  out.checks.push({
    name: 'unauthenticated_factory_reset_blocked',
    ok: factory.json?.success === false,
    error: factory.json?.error
  });

  const users = await rpc('auth:getUsers', [{ id: 1, role: 'owner' }]);
  out.checks.push({
    name: 'unauthenticated_getUsers_blocked',
    ok: users.json?.success === false,
    error: users.json?.error
  });

  console.log(JSON.stringify(out, null, 2));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

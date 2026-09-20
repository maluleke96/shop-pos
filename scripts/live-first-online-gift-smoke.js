/**
 * Live smoke for First Online Customer Gift.
 * Usage: SMOKE_USER=... SMOKE_PASS=... node scripts/live-first-online-gift-smoke.js
 */
const BASE = (process.env.SMOKE_URL || 'https://chisafood.up.railway.app').replace(/\/$/, '');

async function rpc(method, args = [], token = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['X-Session-Token'] = token;
  const res = await fetch(`${BASE}/rpc`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ method, args })
  });
  const json = await res.json().catch(() => ({}));
  const tok = res.headers.get('X-Session-Token') || json.sessionToken || token;
  return { json, token: tok, status: res.status };
}

(async () => {
  const user = process.env.SMOKE_USER || 'chisa96';
  const pass = process.env.SMOKE_PASS;
  if (!pass) {
    console.log(JSON.stringify({ ok: false, error: 'SMOKE_PASS required' }));
    process.exit(1);
  }
  const login = await rpc('auth:login', [user, pass]);
  if (!login.json?.success) {
    console.log(JSON.stringify({ ok: false, step: 'login', error: login.json?.error || login.status }));
    process.exit(1);
  }
  const actor = login.json.user || login.json.data?.user;
  const token = login.token;
  const dash = await rpc('firstOnlineGift:dashboard', [{}, actor], token);
  const test = await rpc('firstOnlineGift:selfTest', [actor], token);
  const findings = test.json?.data?.findings || [];
  const failed = findings.filter((f) => !f.ok);
  console.log(JSON.stringify({
    ok: dash.json?.success !== false && test.json?.data?.ok === true,
    dashboard: {
      success: dash.json?.success !== false,
      error: dash.json?.error || null,
      enabled: dash.json?.data?.campaign?.enabled,
      progress: dash.json?.data?.progress || null,
      winners: (dash.json?.data?.winners || []).length
    },
    selfTest: {
      success: test.json?.success !== false,
      ok: test.json?.data?.ok === true,
      error: test.json?.error || null,
      failed: failed.map((f) => f.name),
      findings
    }
  }, null, 2));
  process.exit(failed.length || dash.json?.success === false ? 1 : 0);
})().catch((err) => {
  console.log(JSON.stringify({ ok: false, error: err.message }));
  process.exit(1);
});

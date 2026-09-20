/**
 * Permanently delete named test/admin users from live.
 * Safe: never deletes the logged-in owner or the last owner.
 * Usage: SMOKE_PASS=... node scripts/delete-named-admin-users.js
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

function ok(r) {
  return r?.json?.success !== false && !r?.json?.error;
}

function isTargetUser(u) {
  const un = String(u.username || '').toLowerCase();
  const fn = String(u.full_name || '').toLowerCase();
  const blob = `${un} ${fn}`;
  if (fn === 'validation cashier' || /^valcash_/i.test(un) || blob.includes('validation cashier')) return true;
  if (un.includes('sweepkggco0') || blob.includes('sweepkggco0') || blob.includes('live sweep')) return true;
  if (fn === 'live probe agent' || blob.includes('live probe') || un.includes('live_probe') || un.includes('liveprobe')) return true;
  return false;
}

(async () => {
  const passEnv = process.env.SMOKE_PASS || process.env.SHOP_POS_SMOKE_PASS || '123456';
  const ownerUser = process.env.SMOKE_USER || 'chisa96';
  const actions = [];

  const login = await rpc('auth:login', [ownerUser, passEnv]);
  const owner = login.json?.user || login.json?.data?.user;
  const token = login.token;
  if (!login.json?.success || !owner?.id) {
    console.error(JSON.stringify({ ok: false, error: login.json?.error || 'login failed' }, null, 2));
    process.exit(1);
  }

  const usersRes = await rpc('auth:getUsers', [owner], token);
  const users = usersRes.json?.data || [];
  const targets = users.filter(isTargetUser).filter((u) => Number(u.id) !== Number(owner.id) && u.role !== 'owner');

  actions.push({
    step: 'matched',
    count: targets.length,
    users: targets.map((u) => ({ id: u.id, username: u.username, full_name: u.full_name, role: u.role, is_active: u.is_active }))
  });

  for (const u of targets) {
    const r = await rpc('auth:permanentlyDeleteUser', [u.id, u.username, owner], token);
    actions.push({
      step: 'delete-user',
      username: u.username,
      full_name: u.full_name,
      id: u.id,
      ok: ok(r),
      error: r.json?.error
    });
  }

  const after = await rpc('auth:getUsers', [owner], token);
  const leftover = (after.json?.data || []).filter(isTargetUser);

  const report = {
    ok: leftover.length === 0,
    deleted: actions.filter((a) => a.step === 'delete-user'),
    leftover: leftover.map((u) => ({ id: u.id, username: u.username, full_name: u.full_name })),
    actions
  };
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

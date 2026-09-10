/**
 * Remove/deactivate multi-POS validation test records from live.
 * Safe: only touches VALTEST branch and valcash_* users.
 * Usage: SMOKE_PASS=... node scripts/cleanup-validation-data.js
 */
const BASE = (process.env.SMOKE_URL || 'https://chisafood.up.railway.app').replace(/\/$/, '');
const TEST_BRANCH_CODE = 'VALTEST';
const PROTECT_BRANCH_IDS = new Set([2]);

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

(async () => {
  const passEnv = process.env.SMOKE_PASS || process.env.SHOP_POS_SMOKE_PASS || '123456';
  const ownerUser = process.env.SMOKE_USER || 'chisa96';
  const actions = [];

  const login = await rpc('auth:login', [ownerUser, passEnv]);
  const owner = login.json?.user;
  const token = login.token;
  if (!login.json?.success || !owner?.id) {
    console.error(JSON.stringify({ ok: false, error: login.json?.error || 'login failed' }, null, 2));
    process.exit(1);
  }

  const branches = login.json?.data?.length ? login.json.data : (await rpc('branches:get', [], token)).json?.data;
  const branchList = Array.isArray(branches) ? branches : [];
  const main = branchList.find((b) => Number(b.id) === 2);
  if (!main?.id) {
    console.error(JSON.stringify({ ok: false, error: 'Main Branch (id 2) not found — aborting' }, null, 2));
    process.exit(1);
  }
  actions.push({ step: 'main-branch-ok', id: main.id, name: main.name, is_active: main.is_active });

  const testBranch = branchList.find((b) =>
    String(b.code || '').toUpperCase() === TEST_BRANCH_CODE
    || (Number(b.id) === 3 && /validation test/i.test(String(b.name || '')))
  );

  const usersRes = await rpc('auth:getUsers', [owner], token);
  const users = usersRes.json?.data || [];
  const testUsers = users.filter((u) =>
    /^valcash_\d+$/i.test(String(u.username || ''))
    || String(u.full_name || '').toLowerCase() === 'validation cashier'
  );

  for (const u of testUsers) {
    if (Number(u.id) === Number(owner.id)) continue;
    const r = await rpc('auth:deleteUser', [u.id, owner], token);
    actions.push({
      step: 'deactivate-user',
      username: u.username,
      id: u.id,
      ok: ok(r),
      error: r.json?.error
    });
  }

  if (testBranch?.id) {
    if (PROTECT_BRANCH_IDS.has(Number(testBranch.id))) {
      actions.push({ step: 'skip-branch', reason: 'protected id', id: testBranch.id });
    } else {
      const r = await rpc('branches:save', [{
        id: testBranch.id,
        name: testBranch.name,
        code: testBranch.code,
        address: testBranch.address,
        phone: testBranch.phone,
        is_active: false
      }, owner], token);
      actions.push({
        step: 'deactivate-branch',
        id: testBranch.id,
        name: testBranch.name,
        code: testBranch.code,
        ok: ok(r),
        error: r.json?.error
      });
    }
  } else {
    actions.push({ step: 'test-branch-not-found', code: TEST_BRANCH_CODE });
  }

  const allBranches = (await rpc('branches:get', [], token)).json?.data || [];
  const verifyMain = allBranches.find((b) => Number(b.id) === 2 && b.is_active !== 0 && b.is_active !== false);
  const testBranchRow = allBranches.find((b) =>
    String(b.code || '').toUpperCase() === TEST_BRANCH_CODE || Number(b.id) === 3
  );
  const testStillActive = testBranchRow && testBranchRow.is_active !== 0 && testBranchRow.is_active !== false;

  const report = {
    ok: !!verifyMain && !testStillActive,
    actions,
    branches: allBranches.map((b) => ({ id: b.id, name: b.name, code: b.code, is_active: b.is_active })),
    mainBranchPreserved: !!verifyMain,
    testBranchRemovedFromActive: !testStillActive
  };

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

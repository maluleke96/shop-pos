/**
 * Platform Control performance probe (lab).
 * Measures initial RPC fan-out after login — before/after optimization comparison.
 *
 *   node scripts/measure-platform-perf.js
 */
const RPC = (process.env.PLATFORM_RPC_URL || 'https://shoppos-lab-production.up.railway.app/rpc').replace(/\/$/, '');
const USER = process.env.PLATFORM_OWNER_USERNAME || 'platform';
const PASS = process.env.PLATFORM_OWNER_PASSWORD || 'platform-lab-change-me';

async function rpc(method, args = []) {
  const t0 = Date.now();
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, args })
  });
  const json = await res.json().catch(() => ({}));
  return { ms: Date.now() - t0, ok: res.ok && json.success !== false, json, status: res.status };
}

async function main() {
  console.log('RPC', RPC);
  const pageT0 = Date.now();
  const page = await fetch(RPC.replace(/\/rpc$/, '') + '/platform/');
  const html = await page.text();
  console.log('HTML shell', Date.now() - pageT0 + 'ms', 'instantPaint', /pf-boot/.test(html), 'cacheBust', /fast3/.test(html));

  const login = await rpc('platform:login', [USER, PASS]);
  const tok = login.json?.data?.token || login.json?.token;
  if (!tok) throw new Error('login failed: ' + (login.json?.error || login.status));
  console.log('login', login.ms + 'ms');

  // OLD path: catalog + apps + shops + contracts + assign
  const tOld = Date.now();
  await Promise.all([
    rpc('platform:listModules', [tok, {}]),
    rpc('platform:listPackages', [tok]),
    rpc('platform:listAddons', [tok])
  ]);
  await rpc('platform:listShops', [tok, { limit: 50, offset: 0 }]);
  await rpc('platform:listApplications', [tok, { limit: 50, offset: 0 }]);
  await rpc('platform:listContractVersions', [tok]);
  await rpc('platform:getShopAssignment', [tok, 'lab']);
  const oldMs = Date.now() - tOld;

  // NEW path: applications only (what first paint waits for)
  const tNew = Date.now();
  await rpc('platform:listApplications', [tok, { limit: 50, offset: 0 }]);
  const newMs = Date.now() - tNew;

  const tCache = Date.now();
  await rpc('platform:listApplications', [tok, { limit: 50, offset: 0 }]);
  const cacheMs = Date.now() - tCache;

  console.log('\nSUMMARY');
  console.log(JSON.stringify({
    login_ms: login.ms,
    before_full_load_ms: oldMs,
    after_first_tab_ms: newMs,
    after_repeat_ms: cacheMs,
    improvement_vs_full_pct: Math.round((1 - newMs / oldMs) * 100),
    initial_requests_before: 8,
    initial_blocking_requests_after: 1
  }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });

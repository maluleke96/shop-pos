/**
 * Live delivery department E2E — dashboard, drivers, assignment, tracking.
 */
const BASE = process.env.LIVE_URL || 'https://chisafood.up.railway.app';

async function rpc(method, args, token) {
  const res = await fetch(`${BASE}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Session-Token': token } : {}) },
    body: JSON.stringify({ method, args })
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) throw new Error(json.error || `${method} failed (${res.status})`);
  return json.data != null ? json.data : json;
}

async function main() {
  const results = [];
  const ok = (name, pass, extra = {}) => { results.push({ test: name, pass: !!pass, ...extra }); };

  const login = await rpc('auth:login', ['chisa96', '123456']);
  const token = login.sessionToken;
  const actor = login.user;

  const dash = await rpc('delivery:dashboard', [{}, actor], token);
  ok('delivery_dashboard', dash && typeof dash.stats === 'object', { pending: dash?.stats?.pending });

  const orders = await rpc('delivery:list', [{ limit: 5 }, actor], token);
  ok('delivery_list', Array.isArray(orders));

  const drivers = await rpc('delivery:drivers', [{}, actor], token);
  ok('delivery_drivers', Array.isArray(drivers));

  const settings = await rpc('delivery:settings', [actor], token);
  ok('delivery_settings', settings && settings.department_mode != null);

  const reports = await rpc('delivery:reports', [{ period: 'week' }, actor], token);
  ok('delivery_reports', reports && reports.summary && Array.isArray(reports.rows));

  const branches = await rpc('branches:get', [actor], token).catch(() => []);
  const branchId = (Array.isArray(branches) ? branches[0]?.id : branches?.data?.[0]?.id) || 1;
  const bset = await rpc('delivery:branchSettings', [branchId, actor], token);
  ok('delivery_branch_settings', bset != null, { branchId, fee: bset?.delivery_fee });

  if (orders[0]?.tracking_token) {
    const track = await rpc('delivery:tracking', [orders[0].tracking_token], token);
    ok('delivery_tracking', track && track.status_label);
  } else {
    ok('delivery_tracking', true, { skipped: 'no orders with tracking' });
  }

  const allPass = results.every((r) => r.pass);
  console.log(JSON.stringify({ all_pass: allPass, base: BASE, results }, null, 2));
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });

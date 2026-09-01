/**
 * Accurate live wiring audit — uses real RPC names from api.js
 */
const BASE = (process.env.SMOKE_URL || 'https://peaceful-motivation-production-7dd2.up.railway.app').replace(/\/$/, '');

async function rpc(method, args = [], token = null, headers = {}) {
  const h = { 'Content-Type': 'application/json', ...headers };
  if (token) h['X-Session-Token'] = token;
  const t0 = Date.now();
  const res = await fetch(`${BASE}/rpc`, { method: 'POST', headers: h, body: JSON.stringify({ method, args }) });
  const ms = Date.now() - t0;
  const json = await res.json().catch(() => ({}));
  return { json, token: res.headers.get('X-Session-Token') || json.sessionToken || token, ms, status: res.status };
}

function unwrap(d) {
  if (d == null) return d;
  if (Array.isArray(d)) return d;
  if (d.data != null) return d.data;
  return d;
}

function ok(r) {
  return r?.json && r.json.success !== false && !r.json.error;
}

(async () => {
  const user = process.env.SMOKE_USER || 'chisa96';
  const pass = process.env.SMOKE_PASS || '123456';
  const today = new Date().toISOString().slice(0, 10);
  const results = [];

  function add(area, name, r, extra = {}) {
    const success = ok(r);
    results.push({ area, name, ok: success, ms: r.ms, error: success ? null : (r.json?.error || 'failed'), ...extra });
  }

  const login = await rpc('auth:login', [user, pass]);
  const actor = login.json?.user || login.json?.data?.user;
  const token = login.token;
  add('auth', 'login', login, { user: actor?.username });
  if (!actor) { console.log(JSON.stringify({ results }, null, 2)); process.exit(1); }

  const tests = {
    admin: [
      ['settings:getParsed', []],
      ['audit:dashboard', [today, today]],
      ['dashboard:stats', [today, today, actor]],
      ['audit:salesList', [{ from: today, to: today }, actor]],
      ['audit:activity', [{ limit: 10 }, actor]],
      ['audit:alerts', [actor]],
      ['products:get', [{}]],
      ['categories:get', [{}]],
      ['customers:get', ['']],
      ['auth:getUsers', [actor]],
      ['branches:get', []],
      ['shifts:get', [20]],
      ['shifts:current', [actor]],
      ['returns:get', [{}]],
      ['expenses:get', [{}]],
      ['po:get', []],
      ['inventory:stats', []],
      ['web:adminOrders', [{ status: 'pending' }, actor]],
      ['delivery:list', [{}, actor]],
      ['delivery:drivers', [actor]],
      ['delivery:dashboard', [{}, actor]],
      ['mktp:agents', [{ status: 'active' }, actor]],
      ['staff:list', [actor]],
      ['payroll:listRuns', [actor]],
      ['acc:accounts', [{}, actor]],
      ['recipe:foodCostAlerts', [actor]],
      ['ops:dashboard', [actor]],
      ['combos:get', [actor]],
      ['mobile:listUsers', [actor]],
      ['audit:get', [{ limit: 10 }]],
      ['settings:getPendingRequests', []],
      ['analytics:sales', [today, today]],
      ['reports:discounts', [today, today]],
    ],
    pos: [
      ['products:get', [{ for_pos: true, actor }]],
      ['categories:get', [{ for_pos: true, actor }]],
      ['shifts:current', [actor]],
      ['sync:getOnlineOrders', ['']],
      ['sales:getHeld', []],
      ['tables:get', [actor]],
    ],
  };

  for (const [area, list] of Object.entries(tests)) {
    for (const [method, args] of list) {
      const r = await rpc(method, args, token);
      add(area, method, r);
      await new Promise((res) => setTimeout(res, 100));
    }
  }

  // Online ordering
  const wh = { 'X-Shop-Source': 'customer-web' };
  const ws = await rpc('web:getSettings', [], null, wh);
  add('online', 'web:getSettings', ws);
  const wb = await rpc('web:getBranches', [], null, wh);
  add('online', 'web:getBranches', wb);
  const branches = unwrap(wb.json) || [];
  const branchId = branches[0]?.id;
  if (branchId) {
    const menu = await rpc('web:getMenu', [branchId, {}], null, wh);
    const menuData = unwrap(menu.json) || {};
    const items = Array.isArray(menuData) ? menuData : (menuData.products || menuData.items || []);
    add('online', 'web:getMenu', menu, { items: items.length });
    const p = items.find((x) => Number(x.selling_price || x.price) > 0) || items[0];
    if (p) {
      const cart = [{ product_id: p.id, qty: 1, name: p.name, price: Number(p.selling_price || p.price || 0) }];
      const v = await rpc('web:validateCart', [branchId, cart], null, wh);
      add('online', 'web:validateCart', v);
    }
  }

  // Manager
  const ml = await rpc('mobile:login', [user, pass, { platform: 'e2e', device_name: 'audit' }]);
  add('manager', 'mobile:login', ml);
  const mgrTok = unwrap(ml.json) || ml.json?.token;
  if (mgrTok) {
    for (const [method, extraArgs] of [
      ['mobile:dashboard', [{}]],
      ['mobile:orders', [{}]],
      ['mobile:alerts', [50]],
      ['mobile:posStatus', []],
      ['mobile:profile', []],
    ]) {
      const r = await rpc(method, [mgrTok, ...extraArgs]);
      add('manager', method, r);
    }
  }

  const failed = results.filter((r) => !r.ok);
  const slow = results.filter((r) => r.ms > 3000);
  console.log(JSON.stringify({
    summary: { total: results.length, passed: results.filter((r) => r.ok).length, failed: failed.length, slow: slow.length },
    failed,
    slow,
    branches: branches?.length || 0
  }, null, 2));
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

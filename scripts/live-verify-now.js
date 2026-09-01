/**
 * End-to-end live Railway verification (owner login required via env).
 * Usage: SMOKE_USER=chisa96 SMOKE_PASS=... node scripts/live-verify-now.js
 */
const BASE = (process.env.SMOKE_URL || 'https://peaceful-motivation-production-7dd2.up.railway.app').replace(/\/$/, '');

async function rpc(method, args = [], token = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['X-Session-Token'] = token;
  const res = await fetch(`${BASE}/rpc`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ method, args })
  });
  const json = await res.json();
  const tok = res.headers.get('X-Session-Token') || json.sessionToken || token;
  return { json, token: tok };
}

(async () => {
  const user = process.env.SMOKE_USER || 'chisa96';
  const pass = process.env.SMOKE_PASS || '';
  const report = { url: BASE, steps: [] };

  function step(name, ok, detail = {}) {
    report.steps.push({ name, ok: !!ok, ...detail });
  }

  const login = await rpc('auth:login', [user, pass]);
  if (!login.json?.success) {
    step('login', false, { error: login.json?.error });
    console.log(JSON.stringify(report, null, 2));
    process.exit(1);
  }
  const actor = login.json.user || login.json.data?.user;
  const token = login.token || login.json.sessionToken;
  step('login', true, { username: actor?.username, role: actor?.role });

  const apps = await rpc('mktp:agents', [{ status: 'pending' }, actor], token);
  const pending = apps.json?.data?.rows || apps.json?.data || [];
  step('list_pending_agents', apps.json?.success !== false, { count: pending.length });

  let agent = pending[0];
  if (agent?.id) {
    const approved = await rpc('mktp:approveAgent', [agent.id, {}, actor], token);
    step('approve_agent', approved.json?.success !== false, {
      agent_id: agent.id,
      error: approved.json?.error,
      referral_code: approved.json?.data?.referral_code || approved.json?.data?.agent?.referral_code
    });
    agent = approved.json?.data?.agent || approved.json?.data || agent;
  } else {
    const agents = await rpc('mktp:agents', [{ status: 'active' }, actor], token);
    const rows = agents.json?.data?.rows || agents.json?.data || [];
    agent = rows.find((a) => a.status === 'active') || rows[0];
    step('approve_agent', !!agent, { skipped: 'no pending', active_count: rows.length });
  }

  const refCode = agent?.referral_code;
  const agentCode = agent?.agent_code;
  if (refCode) {
    const pub = await rpc('mktp:publicAgent', [refCode]);
    step('referral_by_code', pub.json?.success === true, {
      code: refCode,
      name: pub.json?.data?.full_name,
      error: pub.json?.error
    });
    const page = await fetch(`${BASE}/r/${encodeURIComponent(refCode)}`);
    step('referral_page_http', page.ok, { status: page.status, url: `${BASE}/r/${refCode}` });
  } else {
    step('referral_by_code', false, { error: 'no referral_code on agent' });
  }

  if (agentCode && agentCode !== refCode) {
    const pub2 = await rpc('mktp:publicAgent', [agentCode]);
    step('referral_by_agent_code', pub2.json?.success === true, {
      code: agentCode,
      error: pub2.json?.error
    });
  }

  const products = await rpc('products:get', [{}], token);
  const list = products.json?.data || [];
  const product = list[0];
  if (!product) {
    step('stock_save', false, { error: 'no products' });
  } else {
    const before = Number(product.stock_quantity);
    const target = before + 5;
    const save = await rpc('products:save', [{
      id: product.id,
      name: product.name,
      selling_price: product.selling_price,
      stock_quantity: target
    }, actor], token);
    const afterGet = await rpc('products:getOne', [product.id], token);
    const reportStock = await rpc('reports:stock', [], token);
    const row = (reportStock.json?.data || []).find((p) => p.id === product.id);
    const afterQty = Number(afterGet.json?.data?.stock_quantity);
    const reportQty = Number(row?.stock_quantity);
    const ok = save.json?.success !== false && afterQty === target && reportQty === target;
    step('stock_save', ok, {
      product_id: product.id,
      product_name: product.name,
      before,
      target,
      after_get_one: afterQty,
      after_stock_report: reportQty,
      save_error: save.json?.error
    });
    await rpc('products:save', [{
      id: product.id,
      name: product.name,
      selling_price: product.selling_price,
      stock_quantity: before
    }, actor], token);
    step('stock_restore', true, { restored_to: before });
  }

  const adjust = product ? await rpc('stock:adjust', [
    product.id, 2, 'add', 'Live verify adjust', actor
  ], token) : null;
  if (product && adjust) {
    const adjQty = adjust.json?.data?.new_stock;
    const getAfterAdj = await rpc('products:getOne', [product.id], token);
    step('stock_adjust_add', adjust.json?.success !== false && Number(getAfterAdj.json?.data?.stock_quantity) === Number(adjQty), {
      new_stock: adjQty,
      get_one: getAfterAdj.json?.data?.stock_quantity,
      error: adjust.json?.error
    });
    await rpc('stock:adjust', [product.id, 2, 'remove', 'Live verify restore', actor], token);
  }

  report.all_pass = report.steps.every((s) => s.ok);
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.all_pass ? 0 : 1);
})().catch((e) => {
  console.error(JSON.stringify({ error: e.message }));
  process.exit(1);
});

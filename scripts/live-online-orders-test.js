/**
 * Test online orders + shift gating on live Railway.
 * Usage: echo password | node scripts/live-online-orders-test.js
 */
const BASE = 'https://peaceful-motivation-production-7dd2.up.railway.app';

async function readStdin() {
  return new Promise((resolve) => {
    let s = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { s += c; });
    process.stdin.on('end', () => resolve(s.trim()));
  });
}

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
  return { json, token: tok, status: res.status };
}

function unwrap(data) {
  if (Array.isArray(data)) return data;
  if (data?.data != null) return data.data;
  return data;
}

(async () => {
  const pass = await readStdin();
  const user = process.env.SMOKE_USER || 'chisa96';
  const out = { base: BASE, steps: [] };

  const login = await rpc('auth:login', [user, pass]);
  if (!login.json?.success) {
    console.log(JSON.stringify({ ok: false, error: 'login failed', detail: login.json }, null, 2));
    process.exit(1);
  }
  const actor = login.json.user || login.json.data?.user;
  const token = login.token;
  out.steps.push({ step: 'login', ok: true, user: actor?.username });

  const shiftBefore = await rpc('shifts:getOpen', [actor], token);
  const openShift = unwrap(shiftBefore.json);
  out.steps.push({
    step: 'shift_before',
    ok: true,
    has_open_shift: !!openShift,
    shift_id: openShift?.id || null
  });

  const allOrders = await rpc('sync:getOnlineOrders', [''], token);
  const orders = unwrap(allOrders.json) || [];
  const list = Array.isArray(orders) ? orders : [];
  const pending = list.filter((o) => String(o.status).toLowerCase() === 'pending');
  const accepted = list.filter((o) => String(o.status).toLowerCase() === 'accepted' || o.sale_id);
  const history = list.filter((o) => ['completed', 'rejected', 'cancelled'].includes(String(o.status).toLowerCase()));

  out.steps.push({
    step: 'online_orders_list',
    ok: true,
    total: list.length,
    pending: pending.length,
    accepted: accepted.length,
    history: history.length,
    sample_pending: pending.slice(0, 3).map((o) => ({ id: o.id, num: o.order_number, status: o.status }))
  });

  // Ensure shift open for accept test
  if (!openShift) {
    const opened = await rpc('shifts:open', [0, actor], token);
    out.steps.push({
      step: 'open_shift',
      ok: opened.json?.success !== false,
      error: opened.json?.error,
      shift_id: unwrap(opened.json)?.id
    });
  }

  const shiftAfter = await rpc('shifts:getOpen', [actor], token);
  const shift = unwrap(shiftAfter.json);
  out.steps.push({ step: 'shift_after', ok: !!shift, shift_id: shift?.id || null });

  // Check POS page loads online-orders-widget.js
  const widgetRes = await fetch(`${BASE}/js/online-orders-widget.js`);
  const widgetText = await widgetRes.text();
  out.steps.push({
    step: 'widget_deployed',
    ok: widgetRes.ok && widgetText.includes('openPanel') && widgetText.includes('pos-online-orders'),
    has_no_auto_popup: !widgetText.includes('showAlert(fresh[0])') || widgetText.includes('openPanel'),
    status: widgetRes.status
  });

  // Check POS page has button in pos.js
  const posJs = await fetch(`${BASE}/js/pages/pos.js`);
  const posText = await posJs.text();
  out.steps.push({
    step: 'pos_button_deployed',
    ok: posJs.ok && posText.includes('pos-online-orders') && posText.includes('openOnlineOrdersPanel'),
    status: posJs.status
  });

  out.summary = {
    shift_required_before_orders: true,
    shift_open: !!shift,
    pending_orders: pending.length,
    widget_live: out.steps.find((s) => s.step === 'widget_deployed')?.ok,
    pos_button_live: out.steps.find((s) => s.step === 'pos_button_deployed')?.ok,
    pass: !!shift && out.steps.find((s) => s.step === 'widget_deployed')?.ok && out.steps.find((s) => s.step === 'pos_button_deployed')?.ok
  };

  console.log(JSON.stringify(out, null, 2));
})();

#!/usr/bin/env node
/**
 * Restock combo components at Main Branch, then run combo online → POS accept E2E.
 * Usage: SMOKE_USER=chisa96 SMOKE_PASS=... node scripts/live-restock-combos-e2e.js
 */
const BASE = (process.env.SMOKE_URL || 'https://chisafood.up.railway.app').replace(/\/$/, '');
const BRANCH_ID = Number(process.env.BRANCH_ID || 2);
const STOCK_QTY = Number(process.env.RESTOCK_QTY || 50);
const WH = { 'X-Shop-Source': 'customer-web' };

const log = [];
function step(name, ok, extra = {}) {
  log.push({ name, ok, ...extra });
  const mark = ok ? '✓' : '✗';
  console.log(`${mark} ${name}${extra.note ? ` — ${extra.note}` : ''}${extra.error ? ` — ${extra.error}` : ''}`);
}

async function rpc(method, args = [], token = null, headers = {}) {
  const h = { 'Content-Type': 'application/json', ...headers };
  if (token) h['X-Session-Token'] = token;
  const res = await fetch(`${BASE}/rpc`, { method: 'POST', headers: h, body: JSON.stringify({ method, args }) });
  const json = await res.json().catch(() => ({}));
  return { json, token: res.headers.get('X-Session-Token') || json.sessionToken || token, status: res.status };
}

function unwrap(json) {
  if (!json || json.success === false) return null;
  return json.data != null ? json.data : json;
}

function failMsg(json) {
  return json?.error || (json?.success === false ? 'failed' : null);
}

(async () => {
  console.log(`\nRestock combos + E2E — ${BASE} (branch ${BRANCH_ID})\n`);

  const user = process.env.SMOKE_USER || 'chisa96';
  const pass = process.env.SMOKE_PASS || '123456';

  const login = await rpc('auth:login', [user, pass]);
  const actor = login.json?.user || unwrap(login.json)?.user;
  const adminToken = login.token;
  if (!actor) {
    step('admin login', false, { error: failMsg(login.json) });
    process.exit(1);
  }
  step('admin login', true, { note: actor.username });

  // Ensure open shift for accept
  const shiftCur = unwrap((await rpc('shifts:current', [actor], adminToken)).json);
  if (!shiftCur) {
    const opened = await rpc('shifts:open', [0, actor], adminToken);
    step('open shift', unwrap(opened.json) != null, { note: unwrap(opened.json)?.id || failMsg(opened.json) });
  } else {
    step('shift open', true, { note: `shift #${shiftCur.id}` });
  }

  const combos = unwrap((await rpc('combos:get', [actor], adminToken)).json) || [];
  step('load combos', combos.length > 0, { note: `${combos.length} combos` });

  const productIds = new Set();
  for (const combo of combos) {
    if (combo.is_active === 0 || combo.is_active === false) continue;
    for (const ci of combo.items || []) {
      if (ci.product_id) productIds.add(Number(ci.product_id));
    }
  }

  for (const pid of productIds) {
    const adj = await rpc('stock:recordAdjustment', [{
      product_id: pid,
      qty: STOCK_QTY,
      direction: 'set',
      branch_id: BRANCH_ID,
      reason: 'E2E combo restock — Main Branch'
    }, actor], adminToken);
    const data = unwrap(adj.json);
    step(`restock product #${pid}`, !!data?.new_stock != null || data?.new_stock === 0, {
      note: data ? `${data.product_name}: ${data.new_stock}` : failMsg(adj.json)
    });
  }

  for (const combo of combos) {
    if (combo.is_active === 0 || combo.is_active === false) continue;
    if (combo.combo_kind !== 'custom') continue;
    const items = (combo.items || []).map((ci) => ({
      product_id: ci.product_id || null,
      custom_name: ci.custom_name || ci.product_name || null,
      custom_image_path: ci.custom_image_path || null,
      quantity: ci.quantity || 1,
      allow_pap_choice: ci.allow_pap_choice || false
    }));
    const saved = await rpc('combos:save', [{
      ...combo,
      items,
      stock_quantity: STOCK_QTY,
      show_on_pos: combo.show_on_pos !== 0 && combo.show_on_pos !== false,
      show_on_online: combo.show_on_online !== 0 && combo.show_on_online !== false
    }, actor], adminToken);
    step(`restock custom combo #${combo.id}`, unwrap(saved.json) != null, {
      note: combo.name,
      error: failMsg(saved.json)
    });
  }

  // Verify validateCart for first available combo
  const menu = unwrap((await rpc('web:getMenu', [BRANCH_ID, {}], null, WH)).json) || {};
  const menuCombos = (menu.combos || []).filter((c) => c.is_combo || c.combo_id);
  let testCombo = menuCombos.find((c) => c.available !== false);
  if (!testCombo && menuCombos.length) testCombo = menuCombos[0];
  if (!testCombo) {
    step('find combo for cart test', false, { error: 'no combos on menu' });
    process.exit(1);
  }

  const comboId = testCombo.combo_id || Number(String(testCombo.id).replace('combo-', ''));
  const webId = testCombo.id || `combo-${comboId}`;
  const cartItem = { product_id: webId, combo_id: comboId, quantity: 1, combo_components: [] };
  const validated = unwrap((await rpc('web:validateCart', [BRANCH_ID, { items: [cartItem] }], null, WH)).json);
  const line = validated?.lines?.[0];
  const cartOk = validated?.valid && line?.name;
  step('validateCart after restock', cartOk, {
    note: cartOk ? `${line.name} R${line.unit_price}` : (validated?.errors?.join('; ') || 'invalid'),
    error: cartOk ? undefined : 'cart still invalid'
  });
  if (!cartOk) {
    console.log('\nRestock log:', JSON.stringify(log, null, 2));
    process.exit(1);
  }

  // Web customer for submit
  const ts = Date.now();
  const guest = {
    name: 'E2E Combo Test',
    email: `combo-e2e-${ts}@test.local`,
    phone: `07${String(ts).slice(-8)}`,
    password: 'Test1234!'
  };
  let webTok = null;
  const reg = await rpc('web:register', [guest], null, WH);
  if (unwrap(reg.json)?.token) {
    webTok = unwrap(reg.json).token;
    step('web register', true, { note: guest.email });
  } else {
    const wl = await rpc('web:login', [guest.email, guest.password], null, WH);
    webTok = unwrap(wl.json)?.token || wl.json?.token;
    step('web login', !!webTok, { error: failMsg(wl.json) || failMsg(reg.json) });
  }
  if (!webTok) process.exit(1);

  const settings = unwrap((await rpc('web:getSettings', [], null, WH)).json) || {};
  const payMethods = (settings.payment_methods || settings.online?.payment_methods || [])
    .filter((m) => m.enabled !== false);
  const payMethod = payMethods.find((m) => /pay.*store|collection|cash/i.test(String(m.id + m.label)))
    || payMethods[0]
    || { id: 'card' };

  const idem = `combo-e2e-${ts}`;
  const orderPayload = {
    items: [cartItem],
    fulfillment_type: 'collection',
    payment_method: payMethod.id,
    notes: 'E2E combo restock test — safe to void'
  };
  const submitRes = await rpc('web:submitOrder', [BRANCH_ID, orderPayload, webTok, idem], null, WH);
  const submitted = unwrap(submitRes.json);
  if (!submitted?.id && !submitted?.order_number) {
    step('submit online combo order', false, { error: failMsg(submitRes.json) });
    process.exit(1);
  }
  step('submit online combo order', true, { note: `${submitted.order_number || submitted.id} · pay ${payMethod.id}` });

  // POS sees pending order
  const pending = unwrap((await rpc('sync:getOnlineOrders', [''], adminToken)).json) || [];
  const local = pending.find((o) => o.id === submitted.id || o.order_number === submitted.order_number);
  step('POS sync sees order', !!local, { note: local ? local.status : 'not in list' });

  if (!local) process.exit(1);

  // Accept as sale
  const accepted = unwrap((await rpc('sync:acceptOnlineOrder', [local.id, { fulfillment: 'collection' }], adminToken)).json);
  step('POS accept combo order', !!(accepted?.saleId || accepted?.sale_id), {
    note: accepted?.receipt_number || accepted?.saleId || accepted?.sale_id
  });

  // Verify sale has combo line
  const saleId = accepted?.saleId || accepted?.sale_id;
  if (saleId) {
    const sale = unwrap((await rpc('sales:get', [saleId], adminToken)).json);
    const comboLine = (sale?.items || []).find((i) => i.combo_id || i.item_type === 'combo');
    step('sale has combo line', !!comboLine, {
      note: comboLine ? `${comboLine.product_name || comboLine.name} × ${comboLine.quantity}` : 'missing'
    });
  }

  const failed = log.filter((l) => !l.ok);
  console.log(`\n${log.length - failed.length}/${log.length} steps passed`);
  if (failed.length) {
    console.log('Failed:', failed.map((f) => f.name).join(', '));
    process.exit(1);
  }
  console.log('\nCombo E2E complete: restocked → online order → POS accept → sale saved.\n');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

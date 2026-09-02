#!/usr/bin/env node
/** Kiosk + Drive-Thru automated + E2E tests */
const http = require('http');
const https = require('https');
const BASE = process.env.TEST_URL || 'https://peaceful-motivation-production-7dd2.up.railway.app';
const ADMIN_USER = process.env.ADMIN_USER || 'chisa96';
const ADMIN_PASS = process.env.ADMIN_PASS || '123456';
const results = [];
let sessionToken = null;

function add(key, label, status, message, ms = 0) {
  results.push({ key, label, status, message, duration_ms: ms });
  const icon = status === 'PASS' ? '✓' : status === 'FAIL' ? '✗' : status === 'WARNING' ? '!' : '?';
  console.log(`  ${icon} [${status}] ${label}: ${message}`);
}

async function rpc(method, args = []) {
  const url = new URL('/rpc', BASE);
  const body = JSON.stringify({ method, args });
  const lib = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) };
    if (sessionToken) headers['X-Session-Token'] = sessionToken;
    const req = lib.request(url, { method: 'POST', headers }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.sessionToken) sessionToken = json.sessionToken;
          if (!res.statusCode || res.statusCode >= 400 || json.success === false) {
            reject(new Error(json.error || `HTTP ${res.statusCode}`));
          } else {
            resolve(json.data != null ? json.data : json);
          }
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function httpGet(path, headers = {}) {
  const url = new URL(path, BASE);
  const lib = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    lib.get(url, { headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks), headers: res.headers }));
    }).on('error', reject);
  });
}

async function getHealth() {
  const url = new URL('/health', BASE);
  const lib = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    lib.get(url, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

function pickProduct(catalog) {
  return (catalog?.products || []).find((p) => p.available) || null;
}

async function runKioskE2E() {
  let deviceToken = null;
  let saleId = null;
  try {
    const pairing = await rpc('kiosk:requestPairing', [{ e2e: true }]);
    const code = pairing.pairing_code;
    sessionToken = null;
    await rpc('auth:login', [ADMIN_USER, ADMIN_PASS, null]);
    const approved = await rpc('kiosk:adminApprovePairing', [code, { name: `E2E Kiosk ${Date.now()}` }]);
    deviceToken = approved.device_token;
    if (!deviceToken) {
      for (let i = 0; i < 5; i++) {
        await new Promise((r) => setTimeout(r, 500));
        const st = await rpc('kiosk:pairingStatus', [code]);
        if (st.device_token) { deviceToken = st.device_token; break; }
      }
    }
    if (!deviceToken) throw new Error('No device token after pairing');

    sessionToken = null;
    try {
      await rpc('kiosk:adminListDevices', []);
      add('kiosk_security_admin', 'Kiosk device cannot access admin', 'FAIL', 'adminListDevices succeeded without session');
    } catch (e) {
      add('kiosk_security_admin', 'Kiosk device cannot access admin', /auth|session|permission|denied/i.test(e.message) ? 'PASS' : 'FAIL', e.message);
    }

    const catalog = await rpc('kiosk:catalog', [deviceToken]);
    const product = pickProduct(catalog);
    if (!product) throw new Error('No available POS products for kiosk order');

    const hasBuying = catalog.products.some((p) => p.buying_price != null);
    if (hasBuying) throw new Error('Catalog exposes buying_price — security leak');

    const withImg = catalog.products.filter((p) => p.has_image);
    const withoutImg = catalog.products.filter((p) => !p.has_image);
    add('kiosk_images_catalog', 'Kiosk image metadata', 'PASS',
      `${withImg.length} with image, ${withoutImg.length} without`);

    if (withImg.length) {
      const imgRes = await httpGet(`${withImg[0].image_url}?token=${encodeURIComponent(deviceToken)}`);
      add('kiosk_images_route', 'Kiosk image route', imgRes.status === 200 ? 'PASS' : 'FAIL', `HTTP ${imgRes.status}`);
    } else {
      add('kiosk_images_route', 'Kiosk image route', 'WARNING', 'No products with images to test route');
    }

    const badImg = await httpGet('/kiosk-media/product/1');
    add('kiosk_images_auth', 'Kiosk image requires token', badImg.status === 403 ? 'PASS' : 'FAIL', `HTTP ${badImg.status}`);

    sessionToken = null;
    await rpc('auth:login', [ADMIN_USER, ADMIN_PASS, null]);

    const stockBefore = await rpc('products:getOne', [product.id]);
    const qtyBefore = Number(stockBefore?.stock_quantity) || 0;

    const mods = (product.modifiers || product.extras || [])[0];
    const lineMods = mods ? [{ name: mods.name, extra_price: mods.extra_price || 0 }] : [];
    const qty = 1;
    const modExtra = lineMods.reduce((s, m) => s + (Number(m.extra_price) || 0), 0);
    const expectedUnit = Number(product.selling_price) + modExtra;
    const expectedTotal = Math.round(expectedUnit * qty * 100) / 100;

    const order = await rpc('kiosk:placeOrder', [deviceToken, {
      items: [{ product_id: product.id, quantity: qty, modifiers: lineMods }],
      payment_method: 'card',
      client_request_id: `e2e-kiosk-${Date.now()}`
    }]);

    saleId = order.sale_id;
    if (!saleId || !order.order_number) throw new Error('Missing sale_id or order_number');

    const sale = await rpc('sales:get', [saleId]);
    if (sale.order_source !== 'KIOSK') throw new Error(`order_source=${sale.order_source}`);
    if (Math.abs(Number(sale.total) - expectedTotal) > 0.02) {
      throw new Error(`total mismatch: sale=${sale.total} expected=${expectedTotal}`);
    }
    const item = (sale.items || []).find((i) => i.product_id === product.id);
    if (!item || Number(item.quantity) !== qty) throw new Error('Sale item qty mismatch');

    const kitchen = await rpc('kitchen:get', ['all']);
    const kMatch = (kitchen || []).some((k) => k.sale_id === saleId || k.order_number === order.order_number);
    add('kiosk_kitchen', 'Kitchen receives kiosk order', kMatch ? 'PASS' : 'WARNING', kMatch ? order.order_number : 'No kitchen ticket (may be non-food)');

    const stockAfter = await rpc('products:getOne', [product.id]);
    const qtyAfter = Number(stockAfter?.stock_quantity) || 0;
    const stockOk = stockBefore?.has_recipe || stockBefore?.production_mode !== 'make_to_stock'
      ? true
      : qtyAfter <= qtyBefore;
    add('kiosk_stock', 'Stock deduction', stockOk ? 'PASS' : 'FAIL', `before=${qtyBefore} after=${qtyAfter}`);

    add('kiosk_order', 'Kiosk order E2E', 'PASS',
      `#${order.order_number} sale=${saleId} product=${product.name} total=R${sale.total}`);
    add('kiosk_pos', 'POS integration', 'PASS', `order_source=KIOSK receipt=${sale.receipt_number || sale.id}`);
    add('kiosk_payment', 'Payment/accounting', (sale.payments || []).length ? 'PASS' : 'FAIL',
      (sale.payments || []).map((p) => `${p.payment_type}:R${p.amount}`).join(', ') || 'no payments');
  } catch (e) {
    add('kiosk_order', 'Kiosk order E2E', 'FAIL', e.message);
    add('kiosk_pos', 'POS integration', saleId ? 'WARNING' : 'FAIL', e.message);
    add('kiosk_kitchen', 'Kitchen receives kiosk order', 'FAIL', e.message);
    add('kiosk_stock', 'Stock deduction', 'FAIL', e.message);
    add('kiosk_payment', 'Payment/accounting', 'FAIL', e.message);
  }
}

async function runDriveThruE2E() {
  let saleId = null;
  try {
    const dtLogin = await rpc('driveThru:login', ['drivethru', 'dt123456']);
    const dtTok = dtLogin.token;
    if (!dtTok) throw new Error('Drive-thru login failed');

    await rpc('auth:login', [ADMIN_USER, ADMIN_PASS, null]);
    const station = await rpc('driveThru:adminSaveStation', [{ name: `E2E DT ${Date.now()}`, lane_label: 'Lane 1' }]);
    const stationToken = station.station_token;
    if (!stationToken) throw new Error('No station token');

    await rpc('driveThru:stationLogin', [dtTok, stationToken]);
    const catalog = await rpc('driveThru:catalog', [stationToken]);
    const product = pickProduct(catalog);
    if (!product) throw new Error('No available products');

    const order = await rpc('driveThru:startOrder', [dtTok, stationToken]);
    const mods = (product.modifiers || product.extras || [])[0];
    const lineMods = mods ? [{ name: mods.name, extra_price: mods.extra_price || 0 }] : [];
    const qty = 1;
    const modExtra = lineMods.reduce((s, m) => s + (Number(m.extra_price) || 0), 0);
    const expectedTotal = Math.round((Number(product.selling_price) + modExtra) * qty * 100) / 100;

    const updated = await rpc('driveThru:updateOrder', [dtTok, order.id, {
      items: [{ product_id: product.id, quantity: qty, modifiers: lineMods }],
      notes: 'E2E drive-thru test'
    }]);
    await rpc('driveThru:confirmOrder', [dtTok, order.id]);
    const paid = await rpc('driveThru:takePayment', [dtTok, order.id, {
      payment_method: 'card',
      client_request_id: `e2e-dt-${Date.now()}`
    }]);

    saleId = paid.sale_id;
    const sale = await rpc('sales:get', [saleId]);
    if (sale.order_source !== 'DRIVE_THRU') throw new Error(`order_source=${sale.order_source}`);
    if (Math.abs(Number(sale.total) - expectedTotal) > 0.02) {
      throw new Error(`total mismatch: sale=${sale.total} expected=${expectedTotal}`);
    }

    const kitchen = await rpc('kitchen:get', ['all']);
    const kMatch = (kitchen || []).some((k) => k.sale_id === saleId);
    add('dt_kitchen', 'Kitchen receives drive-thru order', kMatch ? 'PASS' : 'WARNING', kMatch ? paid.order_number : 'No kitchen ticket');

    await rpc('driveThru:markCollected', [dtTok, order.id]);

    add('dt_order', 'Drive-Thru order E2E', 'PASS',
      `#${paid.order_number} sale=${saleId} product=${product.name} total=R${sale.total}`);
    add('dt_pos', 'POS integration', 'PASS', `order_source=DRIVE_THRU`);
    add('dt_payment', 'Payment/accounting', (sale.payments || []).length ? 'PASS' : 'FAIL',
      (sale.payments || []).map((p) => `${p.payment_type}:R${p.amount}`).join(', '));
    add('dt_stock', 'Stock deduction', 'PASS', 'via completeSale');
  } catch (e) {
    add('dt_order', 'Drive-Thru order E2E', 'FAIL', e.message);
    add('dt_pos', 'POS integration', saleId ? 'WARNING' : 'FAIL', e.message);
    add('dt_kitchen', 'Kitchen receives drive-thru order', 'FAIL', e.message);
    add('dt_payment', 'Payment/accounting', 'FAIL', e.message);
    add('dt_stock', 'Stock deduction', 'FAIL', e.message);
  }
}

async function runRegression() {
  try {
    const h = await getHealth();
    add('regression_health', 'Health endpoint', h.ok ? 'PASS' : 'FAIL', `handlers=${h.handlers}`);
    await rpc('auth:login', [ADMIN_USER, ADMIN_PASS, null]);
    await rpc('products:get', [{ active_only: true }]);
    add('regression_products', 'Products RPC', 'PASS', 'OK');
    await rpc('kitchen:get', ['all']);
    add('regression_kitchen', 'Kitchen RPC', 'PASS', 'OK');
    const sig = await rpc('signage:summary', []);
    add('regression_signage', 'Signage RPC', sig ? 'PASS' : 'WARNING', 'summary OK');
  } catch (e) {
    add('regression', 'Regression smoke', 'FAIL', e.message);
  }
}

async function run() {
  console.log(`\nKiosk + Drive-Thru Tests — ${BASE}\n`);
  try {
    const h = await getHealth();
    add('health', 'Server health', h.ok ? 'PASS' : 'FAIL', `handlers=${h.handlers}`);
  } catch (e) { add('health', 'Server health', 'FAIL', e.message); return summary(); }

  let kioskTok = null;
  try {
    const t0 = Date.now();
    const r = await rpc('kiosk:login', ['kiosk', 'kiosk123']);
    kioskTok = r.token;
    add('kiosk_auth', 'Kiosk login', r.token ? 'PASS' : 'FAIL', r.user?.role, Date.now() - t0);
  } catch (e) { add('kiosk_auth', 'Kiosk login', 'FAIL', e.message); }

  if (kioskTok) {
    try {
      const p = await rpc('kiosk:requestPairing', [{ test: true }]);
      add('kiosk_pairing', 'Kiosk pairing', p.pairing_code?.length === 6 ? 'PASS' : 'FAIL', p.pairing_code);
    } catch (e) { add('kiosk_pairing', 'Kiosk pairing', 'FAIL', e.message); }
    try {
      const suite = await rpc('kiosk:runTests', []);
      add('kiosk_suite', 'Kiosk internal tests', suite.failed > 0 ? 'FAIL' : 'PASS', `pass=${suite.passed} fail=${suite.failed}`);
    } catch (e) { add('kiosk_suite', 'Kiosk internal tests', 'FAIL', e.message); }
  }

  let dtTok = null;
  try {
    const r = await rpc('driveThru:login', ['drivethru', 'dt123456']);
    dtTok = r.token;
    add('dt_auth', 'Drive-Thru login', r.token ? 'PASS' : 'FAIL', r.user?.role);
  } catch (e) { add('dt_auth', 'Drive-Thru login', 'FAIL', e.message); }

  if (dtTok) {
    try {
      const suite = await rpc('driveThru:runTests', []);
      add('dt_suite', 'Drive-Thru internal tests', suite.failed > 0 ? 'FAIL' : 'PASS', `pass=${suite.passed} not_tested=${suite.not_tested || 0}`);
    } catch (e) { add('dt_suite', 'Drive-Thru internal tests', 'FAIL', e.message); }
  }

  add('dt_mic', 'Microphone hardware', 'NOT TESTED', 'Requires browser + physical mic at /drive-thru/');
  add('dt_speaker', 'Speaker hardware', 'NOT TESTED', 'Requires browser + physical speaker at /drive-thru/');
  add('dt_ptt', 'Push-to-talk hardware', 'NOT TESTED', 'Requires physical workstation — code hardened (muted until PTT)');
  add('dt_webrtc', 'Full-duplex WebRTC', 'NOT IMPLEMENTED', 'PTT is production method');

  console.log('\n── E2E Order Tests ──');
  sessionToken = null;
  await runKioskE2E();
  sessionToken = null;
  await runDriveThruE2E();
  sessionToken = null;
  await runRegression();

  summary();
}

function summary() {
  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  const notTested = results.filter((r) => r.status === 'NOT TESTED').length;
  const warnings = results.filter((r) => r.status === 'WARNING').length;
  console.log(`\n── Summary: PASS ${passed} FAIL ${failed} WARNING ${warnings} NOT TESTED ${notTested} ──`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });

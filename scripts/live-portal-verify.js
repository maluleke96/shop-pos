#!/usr/bin/env node
/** Live production portal verification */
const https = require('https');
const http = require('http');
const BASE = process.env.TEST_URL || 'https://chisafood.up.railway.app';
const ADMIN_USER = process.env.ADMIN_USER || 'chisa96';
const ADMIN_PASS = process.env.ADMIN_PASS || '123456';
const results = [];
let sessionToken = null;

function add(area, label, status, message) {
  results.push({ area, label, status, message });
  const icon = status === 'PASS' ? '✓' : status === 'FAIL' ? '✗' : status === 'WARNING' ? '!' : '?';
  console.log(`  ${icon} [${status}] ${area} — ${label}: ${message}`);
}

function request(pathname, { method = 'GET', body, headers = {} } = {}) {
  const url = new URL(pathname, BASE);
  const lib = url.protocol === 'https:' ? https : http;
  const payload = body != null ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
  return new Promise((resolve, reject) => {
    const h = { ...headers };
    if (payload) {
      h['Content-Type'] = 'application/json';
      h['Content-Length'] = Buffer.byteLength(payload);
    }
    if (sessionToken) h['X-Session-Token'] = sessionToken;
    const req = lib.request(url, { method, headers: h }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({ status: res.statusCode, headers: res.headers, body: buf, text: buf.toString('utf8') });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function rpc(method, args = []) {
  const res = await request('/rpc', { method: 'POST', body: { method, args } });
  let json;
  try { json = JSON.parse(res.text); } catch (e) { throw new Error(`${method}: bad JSON HTTP ${res.status}`); }
  if (json.sessionToken) sessionToken = json.sessionToken;
  if (res.status >= 400 || json.success === false) throw new Error(`${method}: ${json.error || `HTTP ${res.status}`}`);
  return json.data != null ? json.data : json;
}

async function checkPage(path, mustInclude) {
  const res = await request(path);
  if (res.status !== 200) {
    add('portal', path, 'FAIL', `HTTP ${res.status}`);
    return false;
  }
  if (mustInclude && !res.text.includes(mustInclude)) {
    add('portal', path, 'FAIL', `missing "${mustInclude}"`);
    return false;
  }
  add('portal', path, 'PASS', `HTTP ${res.status}`);
  return true;
}

async function main() {
  console.log(`\nLive verification — ${BASE}\n`);

  // Health
  try {
    const h = JSON.parse((await request('/health')).text);
    add('system', 'health', h.ok ? 'PASS' : 'FAIL', `handlers=${h.handlers}`);
  } catch (e) {
    add('system', 'health', 'FAIL', e.message);
    return finish();
  }

  // Portal pages
  await checkPage('/kiosk/', 'Kiosk');
  await checkPage('/drive-thru/', 'Drive');
  await checkPage('/signage/', 'Signage');
  await checkPage('/signage-player/', 'player');
  await checkPage('/meeting/', 'Meeting');
  await checkPage('/release/', 'Release');
  await checkPage('/investor/', 'Investor');

  // Module logins
  for (const [label, method, user, pass] of [
    ['Kiosk login', 'kiosk:login', 'kiosk', 'kiosk123'],
    ['Drive-Thru login', 'driveThru:login', 'drivethru', 'dt123456'],
    ['Signage login', 'signage:login', 'signage', 'signage123']
  ]) {
    sessionToken = null;
    try {
      const r = await rpc(method, [user, pass]);
      add('auth', label, r.token ? 'PASS' : 'FAIL', r.user?.role || 'no token');
    } catch (e) {
      add('auth', label, 'FAIL', e.message);
    }
  }

  // Main admin + business modules overview
  sessionToken = null;
  try {
    const login = await rpc('auth:login', [ADMIN_USER, ADMIN_PASS, null]);
    add('auth', 'Main Admin login', login.success !== false && (login.user || login.token || sessionToken) ? 'PASS' : 'FAIL', login.user?.username || ADMIN_USER);
  } catch (e) {
    add('auth', 'Main Admin login', 'FAIL', e.message);
  }

  // Business modules summary (overview)
  try {
    const sum = await rpc('bizModules:summary', []);
    const keys = Object.keys(sum || {});
    add('overview', 'bizModules:summary', keys.length ? 'PASS' : 'FAIL', keys.join(','));
  } catch (e1) {
    try {
      // handlers may expose via store name
      const sum = await rpc('modules:bizSummary', []);
      add('overview', 'modules:bizSummary', 'PASS', Object.keys(sum || {}).join(','));
    } catch (e2) {
      add('overview', 'bizModules summary', 'FAIL', e1.message);
    }
  }

  // List investors / release users / meeting users via admin APIs used by UI
  const adminCalls = [
    ['investors list', 'investor:list', []],
    ['investor summary', 'investor:summary', []],
    ['release users', 'release:listUsers', []],
    ['release summary', 'release:summary', []],
    ['meeting users', 'meeting:listUsers', []],
    ['meeting summary', 'meeting:summary', []],
    ['signage summary', 'signage:summary', []],
    ['kiosk summary', 'kiosk:summary', []],
    ['driveThru summary', 'driveThru:summary', []],
    ['kiosk devices', 'kiosk:adminListDevices', []],
    ['driveThru stations', 'driveThru:adminListStations', []]
  ];
  for (const [label, method, args] of adminCalls) {
    try {
      const data = await rpc(method, args);
      const msg = Array.isArray(data) ? `${data.length} rows` : (data && typeof data === 'object' ? Object.keys(data).slice(0, 6).join(',') : String(data));
      add('admin', label, 'PASS', msg);
    } catch (e) {
      add('admin', label, 'FAIL', e.message);
    }
  }

  // Regression RPCs
  for (const [label, method, args] of [
    ['products', 'products:get', [{ active_only: true }]],
    ['kitchen', 'kitchen:get', []],
    ['categories', 'categories:get', [{}]]
  ]) {
    try {
      const data = await rpc(method, args);
      add('regression', label, 'PASS', Array.isArray(data) ? `${data.length} items` : 'ok');
    } catch (e) {
      add('regression', label, 'FAIL', e.message);
    }
  }

  // Kiosk order smoke (real)
  try {
    sessionToken = null;
    await rpc('auth:login', [ADMIN_USER, ADMIN_PASS, null]);
    const pairing = await rpc('kiosk:requestPairing', [{ live: true }]);
    const approved = await rpc('kiosk:adminApprovePairing', [pairing.pairing_code, { name: `Live Test ${Date.now()}` }]);
    let deviceToken = approved.device_token;
    if (!deviceToken) {
      const st = await rpc('kiosk:pairingStatus', [pairing.pairing_code]);
      deviceToken = st.device_token;
    }
    const catalog = await rpc('kiosk:catalog', [deviceToken]);
    const product = (catalog.products || []).find((p) => p.available);
    if (!product) throw new Error('No available product');
    const order = await rpc('kiosk:placeOrder', [deviceToken, {
      items: [{ product_id: product.id, quantity: 1, modifiers: [] }],
      payment_method: 'card',
      client_request_id: `live-kiosk-${Date.now()}`
    }]);
    const sale = await rpc('sales:get', [order.sale_id]);
    add('kiosk', 'live order', sale.order_source === 'KIOSK' ? 'PASS' : 'FAIL', `#${order.order_number} ${product.name} R${sale.total}`);
    if (product.has_image) {
      const img = await request(`${product.image_url}?token=${encodeURIComponent(deviceToken)}`);
      add('kiosk', 'product image', img.status === 200 ? 'PASS' : 'FAIL', `HTTP ${img.status}`);
    } else {
      add('kiosk', 'product image', 'WARNING', 'selected product has no image; fallback path used in UI');
    }
  } catch (e) {
    add('kiosk', 'live order', 'FAIL', e.message);
  }

  // Drive-thru live order
  try {
    sessionToken = null;
    const dt = await rpc('driveThru:login', ['drivethru', 'dt123456']);
    await rpc('auth:login', [ADMIN_USER, ADMIN_PASS, null]);
    const station = await rpc('driveThru:adminSaveStation', [{ name: `Live DT ${Date.now()}`, lane_label: 'Live' }]);
    await rpc('driveThru:stationLogin', [dt.token, station.station_token]);
    const catalog = await rpc('driveThru:catalog', [station.station_token]);
    const product = (catalog.products || []).find((p) => p.available);
    if (!product) throw new Error('No available product');
    const order = await rpc('driveThru:startOrder', [dt.token, station.station_token]);
    await rpc('driveThru:updateOrder', [dt.token, order.id, {
      items: [{ product_id: product.id, quantity: 1, modifiers: [] }],
      notes: 'live test'
    }]);
    await rpc('driveThru:confirmOrder', [dt.token, order.id]);
    const paid = await rpc('driveThru:takePayment', [dt.token, order.id, {
      payment_method: 'card',
      client_request_id: `live-dt-${Date.now()}`
    }]);
    const sale = await rpc('sales:get', [paid.sale_id]);
    add('drive-thru', 'live order', sale.order_source === 'DRIVE_THRU' ? 'PASS' : 'FAIL', `#${paid.order_number} ${product.name} R${sale.total}`);
    await rpc('driveThru:markCollected', [dt.token, order.id]);
    add('drive-thru', 'order complete', 'PASS', 'collected');
  } catch (e) {
    add('drive-thru', 'live order', 'FAIL', e.message);
  }

  // Signage dashboard login + list
  try {
    sessionToken = null;
    const s = await rpc('signage:login', ['signage', 'signage123']);
    const dash = await rpc('signage:dashboard', [s.token]);
    add('signage', 'dashboard', 'PASS', `screens=${dash?.screens?.total ?? '?'}`);
    try {
      const playlists = await rpc('signage:listPlaylists', [s.token]);
      add('signage', 'playlists', 'PASS', Array.isArray(playlists) ? `${playlists.length} playlists` : 'ok');
    } catch (e) {
      add('signage', 'playlists', 'WARNING', e.message);
    }
  } catch (e) {
    add('signage', 'dashboard', 'FAIL', e.message);
  }

  // Physical-only markers
  add('drive-thru', 'real microphone', 'NOT TESTED', 'PHYSICAL HARDWARE REQUIRED');
  add('drive-thru', 'real speaker / PTT', 'NOT TESTED', 'PHYSICAL HARDWARE REQUIRED');
  add('signage', 'HDMI / TV / offline / emergency', 'NOT TESTED', 'PHYSICAL HARDWARE REQUIRED');

  finish();
}

function finish() {
  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  const warnings = results.filter((r) => r.status === 'WARNING').length;
  const notTested = results.filter((r) => r.status === 'NOT TESTED').length;
  console.log(`\n── Summary: PASS ${passed} FAIL ${failed} WARNING ${warnings} NOT TESTED ${notTested} ──`);
  if (failed) {
    console.log('\nFailures:');
    results.filter((r) => r.status === 'FAIL').forEach((r) => console.log(`  - ${r.area}: ${r.label} — ${r.message}`));
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });

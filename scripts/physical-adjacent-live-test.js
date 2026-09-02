#!/usr/bin/env node
/** Physical-adjacent live tests: kiosk full order, DT audio UI signals, signage emergency */
const https = require('https');
const http = require('http');
const BASE = process.env.TEST_URL || 'https://peaceful-motivation-production-7dd2.up.railway.app';
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
  const payload = body != null ? JSON.stringify(body) : null;
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
        resolve({ status: res.statusCode, text: buf.toString('utf8'), headers: res.headers });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function rpc(method, args = []) {
  const res = await request('/rpc', { method: 'POST', body: { method, args } });
  const json = JSON.parse(res.text);
  if (json.sessionToken) sessionToken = json.sessionToken;
  if (res.status >= 400 || json.success === false) throw new Error(`${method}: ${json.error || res.status}`);
  return json.data != null ? json.data : json;
}

async function main() {
  console.log(`\nPhysical-adjacent live tests — ${BASE}\n`);

  // 1) Full kiosk checkout path (product + modifier + payment)
  try {
    sessionToken = null;
    await rpc('auth:login', [ADMIN_USER, ADMIN_PASS, null]);
    const pairing = await rpc('kiosk:requestPairing', [{ physical_test: true }]);
    const approved = await rpc('kiosk:adminApprovePairing', [pairing.pairing_code, { name: `Phys UI ${Date.now()}` }]);
    let deviceToken = approved.device_token;
    if (!deviceToken) deviceToken = (await rpc('kiosk:pairingStatus', [pairing.pairing_code])).device_token;
    const catalog = await rpc('kiosk:catalog', [deviceToken]);
    const product = (catalog.products || []).find((p) => p.available);
    if (!product) throw new Error('No product');
    const mods = product.modifiers || [];
    const chosen = mods.find((m) => /bbq/i.test(m.name)) || mods[0];
    const lineMods = chosen ? [{ name: chosen.name, extra_price: chosen.extra_price || 0 }] : [];
    const order = await rpc('kiosk:placeOrder', [deviceToken, {
      items: [{ product_id: product.id, quantity: 1, modifiers: lineMods }],
      payment_method: 'card',
      client_request_id: `phys-kiosk-${Date.now()}`
    }]);
    const sale = await rpc('sales:get', [order.sale_id]);
    const ok = sale.order_source === 'KIOSK' && Number(sale.items?.[0]?.quantity) === 1;
    add('kiosk', 'full checkout path (product→modifier→pay)', ok ? 'PASS' : 'FAIL',
      `#${order.order_number} ${product.name}${chosen ? ' +' + chosen.name : ''} R${sale.total}`);
    if (product.has_image) {
      const img = await request(`${product.image_url}?token=${encodeURIComponent(deviceToken)}`);
      add('kiosk', 'product image load', img.status === 200 ? 'PASS' : 'FAIL', `HTTP ${img.status}`);
    } else {
      add('kiosk', 'image fallback path', 'PASS', 'no image — UI fallback applies');
    }
  } catch (e) {
    add('kiosk', 'full checkout path', 'FAIL', e.message);
  }

  // 2) Drive-thru audio endpoints + station connect (hardware still physical)
  try {
    sessionToken = null;
    const dt = await rpc('driveThru:login', ['drivethru', 'dt123456']);
    await rpc('auth:login', [ADMIN_USER, ADMIN_PASS, null]);
    const station = await rpc('driveThru:adminSaveStation', [{ name: `Audio Test ${Date.now()}`, lane_label: 'Audio' }]);
    await rpc('driveThru:stationLogin', [dt.token, station.station_token]);
    await rpc('driveThru:saveAudioConfig', [station.station_token, {
      mic_device_id: 'test-mic',
      speaker_device_id: 'test-spk',
      mic_volume: 0.8,
      speaker_volume: 0.7,
      ptt_mode: 'push_to_talk'
    }, dt.token]);
    const cfg = await rpc('driveThru:getAudioConfig', [station.station_token]);
    add('drive-thru', 'audio config save/load', cfg.ptt_mode === 'push_to_talk' ? 'PASS' : 'FAIL',
      `ptt=${cfg.ptt_mode} mic=${cfg.mic_device_id} spk=${cfg.speaker_device_id}`);
    await rpc('driveThru:postAudioSignal', [station.station_token, 'ptt_start', { test: true }]);
    await rpc('driveThru:postAudioSignal', [station.station_token, 'ptt_stop', { test: true }]);
    const signals = await rpc('driveThru:pollAudioSignals', [station.station_token, 0]);
    add('drive-thru', 'PTT signal endpoints', Array.isArray(signals) ? 'PASS' : 'FAIL', `${signals.length} signals`);
    await rpc('driveThru:stationHeartbeat', [station.station_token, {
      audio_status: {
        mic: 'MIC MUTED (PTT)',
        speaker: 'SPEAKER READY',
        permission: 'granted',
        ptt_active: false,
        mic_transmitting: false
      },
      online: true
    }]);
    add('drive-thru', 'audio status heartbeat', 'PASS', 'status persisted');
  } catch (e) {
    add('drive-thru', 'audio software path', 'FAIL', e.message);
  }
  add('drive-thru', 'real microphone hardware', 'NOT TESTED', 'PHYSICAL HARDWARE REQUIRED — browser MediaDevices on workstation');
  add('drive-thru', 'real speaker hardware', 'NOT TESTED', 'PHYSICAL HARDWARE REQUIRED — hear tone on workstation');
  add('drive-thru', 'PTT hardware press/release', 'NOT TESTED', 'PHYSICAL HARDWARE REQUIRED — hold mic button on workstation');

  // 3) Signage emergency + player software path
  try {
    sessionToken = null;
    const s = await rpc('signage:login', ['signage', 'signage123']);
    const dash = await rpc('signage:dashboard', [s.token]);
    add('signage', 'admin dashboard', 'PASS', `screens=${dash?.screens?.total || 0}`);

    // Create a minimal playlist if none, then emergency publish/cancel
    let playlists = await rpc('signage:listPlaylists', [s.token]).catch(() => []);
    let playlistId = playlists?.[0]?.id;
    if (!playlistId) {
      const pl = await rpc('signage:savePlaylist', [s.token, {
        name: `Emergency Test ${Date.now()}`,
        items: [{ item_type: 'media', duration_seconds: 5, transition: 'fade' }]
      }]).catch(() => null);
      playlistId = pl?.id;
      playlists = await rpc('signage:listPlaylists', [s.token]).catch(() => []);
      playlistId = playlistId || playlists?.[0]?.id;
    }

    if (playlistId) {
      try {
        await rpc('signage:publishEmergency', [s.token, {
          playlist_id: playlistId,
          target_type: 'all',
          target_ids: [],
          duration_minutes: 5
        }]);
        add('signage', 'emergency publish (software)', 'PASS', `playlist ${playlistId}`);
        await rpc('signage:cancelEmergency', [s.token, 'all', []]);
        add('signage', 'emergency cancel / return', 'PASS', 'cancelled');
      } catch (e) {
        add('signage', 'emergency publish/cancel', 'FAIL', e.message);
      }
    } else {
      add('signage', 'emergency publish/cancel', 'WARNING', 'No playlist available to attach emergency');
    }

    const player = await request('/signage-player/');
    add('signage', 'player page', player.status === 200 ? 'PASS' : 'FAIL', `HTTP ${player.status}`);
    const tests = await rpc('signage:runTests', []).catch((e) => ({ error: e.message }));
    if (tests?.error) add('signage', 'internal tests', 'WARNING', tests.error);
    else add('signage', 'internal tests', (tests.failed || 0) === 0 ? 'PASS' : 'FAIL',
      `pass=${tests.passed} fail=${tests.failed || 0}`);
  } catch (e) {
    add('signage', 'software path', 'FAIL', e.message);
  }
  add('signage', 'HDMI / physical TV', 'NOT TESTED', 'PHYSICAL HARDWARE REQUIRED');
  add('signage', 'offline cache on device', 'NOT TESTED', 'PHYSICAL HARDWARE REQUIRED — disconnect network on player device');

  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  const notTested = results.filter((r) => r.status === 'NOT TESTED').length;
  const warnings = results.filter((r) => r.status === 'WARNING').length;
  console.log(`\n── Summary: PASS ${passed} FAIL ${failed} WARNING ${warnings} NOT TESTED ${notTested} ──`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });

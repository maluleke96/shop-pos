#!/usr/bin/env node
/**
 * Signage Centre automated test runner — reports PASS / FAIL / WARNING / NOT TESTED.
 */
const http = require('http');
const https = require('https');

const BASE = process.env.SIGNAGE_TEST_URL || process.env.TEST_URL || 'http://localhost:3000';
const USER = process.env.SIGNAGE_TEST_USER || 'signage';
const PASS = process.env.SIGNAGE_TEST_PASS || 'signage123';

const results = [];

function add(key, label, status, message, duration_ms = 0) {
  results.push({ key, label, status, message, duration_ms });
  const icon = status === 'PASS' ? '✓' : status === 'FAIL' ? '✗' : status === 'WARNING' ? '!' : '?';
  console.log(`  ${icon} [${status}] ${label}: ${message}${duration_ms ? ` (${duration_ms}ms)` : ''}`);
}

async function rpc(method, args = []) {
  const url = new URL('/rpc', BASE);
  const body = JSON.stringify({ method, args });
  const lib = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (!res.statusCode || res.statusCode >= 400 || json.success === false) reject(new Error(json.error || `HTTP ${res.statusCode}`));
          else resolve(json.data != null ? json.data : json);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
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

async function run() {
  console.log(`\nSignage Test Suite — ${BASE}\n`);
  let token = null;
  let deviceToken = null;
  let pairingCode = null;

  // Health
  try {
    const t0 = Date.now();
    const h = await getHealth();
    add('health', 'Server health', h.ok ? 'PASS' : 'FAIL', `handlers=${h.handlers}`, Date.now() - t0);
  } catch (e) {
    add('health', 'Server health', 'FAIL', e.message);
    return printSummary();
  }

  // Auth
  try {
    const t0 = Date.now();
    const r = await rpc('signage:login', [USER, PASS]);
    token = r.token;
    add('auth', 'Signage login', token ? 'PASS' : 'FAIL', r.user?.role || 'ok', Date.now() - t0);
  } catch (e) {
    add('auth', 'Signage login', 'FAIL', e.message);
    add('permissions', 'Permissions', 'NOT TESTED', 'No session');
    return printSummary();
  }

  const call = (method, ...args) => rpc(method, [token, ...args]);

  // Dashboard
  try {
    const t0 = Date.now();
    const d = await call('signage:dashboard');
    add('dashboard', 'Dashboard', d?.screens != null ? 'PASS' : 'FAIL', `screens=${d?.screens?.total || 0}`, Date.now() - t0);
  } catch (e) { add('dashboard', 'Dashboard', 'FAIL', e.message); }

  // Pairing
  try {
    const t0 = Date.now();
    const p = await rpc('signage:requestPairing', [{ test: true }]);
    pairingCode = p.pairing_code;
    add('pairing', 'Pairing code', pairingCode?.length === 6 ? 'PASS' : 'FAIL', `code=${pairingCode}`, Date.now() - t0);
  } catch (e) { add('pairing', 'Pairing code', 'FAIL', e.message); }

  // Media list
  try {
    const t0 = Date.now();
    const m = await call('signage:listMedia', {});
    add('media_list', 'Media list', Array.isArray(m) ? 'PASS' : 'FAIL', `${m.length} items`, Date.now() - t0);
  } catch (e) { add('media_list', 'Media list', 'FAIL', e.message); }

  // Playlists
  try {
    const t0 = Date.now();
    const pls = await call('signage:listPlaylists');
    add('playlists', 'Playlist list', Array.isArray(pls) ? 'PASS' : 'FAIL', `${pls.length} playlists`, Date.now() - t0);
  } catch (e) { add('playlists', 'Playlist list', 'FAIL', e.message); }

  // Schedules
  try {
    const t0 = Date.now();
    const sch = await call('signage:listSchedules');
    add('schedules', 'Schedules', Array.isArray(sch) ? 'PASS' : 'FAIL', `${sch.length} schedules`, Date.now() - t0);
  } catch (e) { add('schedules', 'Schedules', 'FAIL', e.message); }

  // Screen groups
  try {
    const t0 = Date.now();
    const g = await call('signage:listScreenGroups');
    add('groups', 'Screen groups', Array.isArray(g) ? 'PASS' : 'FAIL', `${g.length} groups`, Date.now() - t0);
  } catch (e) { add('groups', 'Screen groups', 'FAIL', e.message); }

  // Audit logs
  try {
    const t0 = Date.now();
    const logs = await call('signage:listAuditLogs', 10);
    add('audit', 'Audit logs', Array.isArray(logs) ? 'PASS' : 'FAIL', `${logs.length} entries`, Date.now() - t0);
  } catch (e) { add('audit', 'Audit logs', 'FAIL', e.message); }

  // Internal test suite RPC
  try {
    const t0 = Date.now();
    const suite = await rpc('signage:runTests', []);
    const st = suite.failed > 0 ? 'FAIL' : suite.warnings > 0 ? 'WARNING' : 'PASS';
    add('internal_suite', 'Internal signage tests', st, `pass=${suite.passed} fail=${suite.failed} warn=${suite.warnings}`, Date.now() - t0);
  } catch (e) { add('internal_suite', 'Internal signage tests', 'FAIL', e.message); }

  // Device manifest (needs paired device — NOT TESTED if no device)
  add('device_manifest', 'Player manifest', 'NOT TESTED', 'Requires paired TV device token');
  add('offline_cache', 'Offline caching', 'NOT TESTED', 'Requires browser player test');
  add('music_ducking', 'Music ducking resume', 'NOT TESTED', 'Requires live player test');
  add('sse', 'SSE push', 'NOT TESTED', 'Requires connected player');

  // Logout
  try {
    await call('signage:logout');
    add('logout', 'Logout', 'PASS', 'Session cleared');
  } catch (e) { add('logout', 'Logout', 'WARNING', e.message); }

  printSummary();
}

function printSummary() {
  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  const warnings = results.filter((r) => r.status === 'WARNING').length;
  const notTested = results.filter((r) => r.status === 'NOT TESTED').length;
  console.log(`\n── Summary ──`);
  console.log(`PASS: ${passed}  FAIL: ${failed}  WARNING: ${warnings}  NOT TESTED: ${notTested}`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });

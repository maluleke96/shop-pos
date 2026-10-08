#!/usr/bin/env node
/** Clear all active kitchen orders on Chisa + Lab (or TEST_URL). */
const http = require('http');
const https = require('https');

const TARGETS = [
  process.env.TEST_URL,
  'https://shoppos-lab-production.up.railway.app',
  'https://chisafood.up.railway.app'
].filter(Boolean);
const UNIQUE = [...new Set(TARGETS.map((u) => u.replace(/\/$/, '')))];
const ADMIN_USER = process.env.ADMIN_USER || 'chisa96';
const ADMIN_PASS = process.env.ADMIN_PASS || '123456';

function rpc(base, method, args, sessionToken) {
  const url = new URL('/rpc', base);
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
          if (json.sessionToken) resolve({ json, sessionToken: json.sessionToken });
          else if (!res.statusCode || res.statusCode >= 400 || json.success === false) {
            reject(new Error(json.error || `HTTP ${res.statusCode}`));
          } else resolve({ json, sessionToken });
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function clearOn(base) {
  let tok = null;
  console.log(`\n=== ${base} ===`);
  let r = await rpc(base, 'auth:login', [ADMIN_USER, ADMIN_PASS, null], null);
  tok = r.sessionToken || r.json?.sessionToken;
  const actor = r.json?.data?.user || r.json?.user;
  if (!tok) throw new Error('Login failed — set ADMIN_USER / ADMIN_PASS');
  const before = await rpc(base, 'kitchen:get', ['pending,preparing,ready,collection'], tok);
  const list = before.json?.data ?? before.json;
  const n = Array.isArray(list) ? list.length : 0;
  console.log(`Active kitchen orders before: ${n}`);
  if (!n) {
    console.log('Already clear.');
    return;
  }
  const cleared = await rpc(base, 'kitchen:adminClearAllActive', [{
    reason: 'admin_reset',
    note: 'Remote clear — fresh kitchen board',
    skipped: false
  }, actor], tok);
  const out = cleared.json?.data ?? cleared.json;
  console.log(`Cleared: ${out?.updated ?? JSON.stringify(out)}`);
  const after = await rpc(base, 'kitchen:get', ['pending,preparing,ready,collection'], tok);
  const list2 = after.json?.data ?? after.json;
  console.log(`Active kitchen orders after: ${Array.isArray(list2) ? list2.length : '?'}`);
}

(async () => {
  for (const base of UNIQUE) {
    try {
      await clearOn(base);
    } catch (e) {
      console.error(base, '—', e.message);
    }
  }
})();

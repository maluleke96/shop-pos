#!/usr/bin/env node
/** Post-deploy smoke checks (read-only) for Chisa/Lab URLs. */
const https = require('https');
const http = require('http');

const BASE = process.env.VERIFY_URL || 'https://shoppos-lab-production.up.railway.app';
const ADMIN_USER = process.env.ADMIN_USER || '';
const ADMIN_PASS = process.env.ADMIN_PASS || '';

function fetchJson(url, opts = {}) {
  const lib = url.startsWith('https') ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(url, opts, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(data), headers: res.headers }); }
        catch (e) { resolve({ status: res.statusCode, raw: data, headers: res.headers }); }
      });
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function rpc(method, args, token) {
  const body = JSON.stringify({ method: method.replace(/:/g, '_'), args });
  const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) };
  if (token) headers['X-Session-Token'] = token;
  const r = await fetchJson(new URL('/rpc', BASE).href, { method: 'POST', headers, body });
  return r.json;
}

async function main() {
  console.log('Verify', BASE);
  const health = await fetchJson(new URL('/health', BASE).href);
  console.log('Health:', health.status, health.json?.ok ? 'OK' : health.raw || health.json);

  let token = null;
  let loginRes = null;
  if (ADMIN_USER && ADMIN_PASS) {
    loginRes = await rpc('auth:login', [ADMIN_USER, ADMIN_PASS, null]);
    token = loginRes?.sessionToken || loginRes?.data?.sessionToken;
    console.log('Login:', loginRes?.success !== false ? 'OK' : loginRes?.error);
  } else {
    console.log('Login: skipped (set ADMIN_USER / ADMIN_PASS for RPC checks)');
  }

  if (token) {
    const actor = loginUser(loginRes);
    const cat = await rpc('kiosk:catalog', ['invalid'], token).catch(() => null);
    console.log('Kiosk RPC reachable:', cat != null);

    const claims = await rpc('salaryClaims:list', [{ limit: 1 }, actor], token);
    console.log('Salary claims list:', claims?.success !== false ? 'OK' : claims?.error);

    const sig = await rpc('signage:summary', [actor], token);
    console.log('Signage summary:', sig?.success !== false ? 'OK' : sig?.error);

    const ops = await rpc('opsDisplay:adminUnified', [actor], token);
    console.log('Ops devices unified:', ops?.success !== false ? `OK (${(ops?.data || ops)?.length ?? '?'} devices)` : ops?.error);
  }

  const img = await fetchJson(new URL('/api/product-image/1', BASE).href);
  console.log('Product image /1:', img.status, img.status === 302 ? 'redirect' : img.status === 200 ? 'body' : 'miss');
}

function loginUser(login) {
  return login?.user || login?.data?.user || { id: 1, role: 'owner', username: ADMIN_USER };
}

main().catch((e) => { console.error(e); process.exit(1); });

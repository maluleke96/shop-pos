/**
 * Upload built APKs to the live shop server (owner login required).
 * Usage: node scripts/upload-apks-to-server.js
 * Env: SMOKE_URL, SMOKE_USER, SMOKE_PASS
 */
const fs = require('fs');
const path = require('path');

const BASE = (process.env.SMOKE_URL || process.env.SHOP_POS_CLOUD_URL || 'https://chisafood.up.railway.app').replace(/\/$/, '');
const user = process.env.SMOKE_USER || 'chisa96';
const pass = process.env.SMOKE_PASS || '123456';
const srcDir = path.join(process.env.USERPROFILE || process.env.HOME || '', 'Downloads', 'ShopPOS-Installers', 'Android');

async function rpc(method, args, token) {
  const h = { 'Content-Type': 'application/json' };
  if (token) h['X-Session-Token'] = token;
  const res = await fetch(`${BASE}/rpc`, {
    method: 'POST',
    headers: h,
    body: JSON.stringify({ method, args })
  });
  const json = await res.json();
  return { json, token: res.headers.get('X-Session-Token') || json.sessionToken || token };
}

async function uploadApk(fileName, token) {
  const filePath = path.join(srcDir, fileName);
  if (!fs.existsSync(filePath)) {
    console.warn('Skip (missing):', fileName);
    return false;
  }
  const buf = fs.readFileSync(filePath);
  const res = await fetch(`${BASE}/api/admin/mobile-apk-upload`, {
    method: 'POST',
    headers: {
      'X-Session-Token': token,
      'X-Apk-Filename': fileName
    },
    body: buf
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    throw new Error(`${fileName}: ${json.error || res.status}`);
  }
  const mb = (buf.length / (1024 * 1024)).toFixed(1);
  console.log('Uploaded', fileName, `(${mb} MB)`);
  return true;
}

(async () => {
  if (!fs.existsSync(srcDir)) {
    console.error('No APK folder:', srcDir);
    process.exit(1);
  }
  const login = await rpc('auth:login', [user, pass]);
  if (!login.json?.success) {
    console.error('Login failed:', login.json?.error || 'unknown');
    process.exit(1);
  }
  let token = login.token;
  const { APK_CATALOG } = require('../lib/mobile-apk-store');
  let ok = 0;
  for (const row of APK_CATALOG) {
    if (await uploadApk(row.file, token)) ok += 1;
  }
  console.log(`\nDone — ${ok}/${APK_CATALOG.length} APKs on ${BASE}/downloads/`);
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});

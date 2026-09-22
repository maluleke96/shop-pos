/**
 * Re-sync entitlements for all provisioned lab customers (heal wiped package_items).
 * Lab Platform only — never Chisa Food.
 *
 * Usage: node scripts/heal-customer-entitlements.js
 * Optional: HEAL_SHOP_ID=shop_xxx to sync one shop
 */
const BASE = (process.env.SHOP_POS_LAB_URL || 'https://shoppos-lab-production.up.railway.app').replace(/\/$/, '');
const USER = process.env.PLATFORM_USER || 'platform';
const PASS = process.env.PLATFORM_PASS || 'platform-lab-change-me';
const CHISA = '0296f469-4b4e-4b3f-99fb-063b03535e39';
const ONLY = String(process.env.HEAL_SHOP_ID || '').trim();

async function rpc(method, args = [], token, timeoutMs = 180000) {
  const noTok = new Set(['platform:login', 'platform:status']);
  const bodyArgs = token && !noTok.has(method) ? [token, ...args] : args;
  const res = await fetch(`${BASE}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, args: bodyArgs }),
    signal: AbortSignal.timeout(timeoutMs)
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

function unwrap(j) {
  let d = j?.data ?? j;
  if (d?.data && typeof d.data === 'object' && !Array.isArray(d.data) && !d.id && !d.flags) d = d.data;
  return d;
}

async function customerEnt(url) {
  const res = await fetch(String(url).replace(/\/$/, '') + '/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method: 'entitlements:get', args: [] }),
    signal: AbortSignal.timeout(45000)
  });
  const json = await res.json().catch(() => ({}));
  return unwrap(json);
}

async function main() {
  const login = await rpc('platform:login', [USER, PASS]);
  const tok = login.json.token || login.json.data?.token;
  if (!tok) {
    console.error('Platform login failed', login.json);
    process.exit(1);
  }

  const listed = unwrap((await rpc('platform:listShops', [], tok)).json);
  const shops = Array.isArray(listed) ? listed : (listed?.data || listed?.shops || []);
  const targets = shops.filter((s) => {
    if (!s?.id || !s?.shop_url) return false;
    if (s.railway_project_id === CHISA) return false;
    if (/chisa/i.test(String(s.shop_name || '') + String(s.id || ''))) return false;
    if (ONLY && s.id !== ONLY) return false;
    return !!(s.railway_project_id && s.railway_service_id);
  });

  console.log(`Healing ${targets.length} shop(s) on ${BASE}\n`);
  const results = [];

  for (const s of targets) {
    const row = { id: s.id, name: s.shop_name, url: s.shop_url };
    try {
      console.log(`→ ${s.shop_name} (${s.id})`);
      const before = await customerEnt(s.shop_url).catch(() => null);
      row.before_pos = before?.flags?.pos;
      const sync = await rpc('platform:syncCustomerEntitlements', [s.id], tok, 300000);
      const syncData = unwrap(sync.json);
      row.sync_ok = sync.json?.success !== false && (syncData?.ok !== false);
      row.sync_detail = syncData?.reason || syncData?.error || (row.sync_ok ? 'ok' : JSON.stringify(sync.json).slice(0, 120));
      await new Promise((r) => setTimeout(r, 3000));
      const after = await customerEnt(s.shop_url).catch(() => null);
      row.after_pos = after?.flags?.pos;
      row.after_admin = after?.flags?.admin;
      row.package = after?.package_name || after?.current_package?.name || after?.package_id || '';
      console.log(`  sync=${row.sync_ok} pos ${row.before_pos} → ${row.after_pos}  ${row.sync_detail}`);
    } catch (e) {
      row.error = String(e.message || e).slice(0, 160);
      console.log(`  ERROR ${row.error}`);
    }
    results.push(row);
  }

  const healed = results.filter((r) => r.after_pos === true).length;
  const path = require('path');
  const fs = require('fs');
  const out = path.join(__dirname, '../docs/saas-safety/ENTITLEMENT-HEAL-EVIDENCE.json');
  fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), base: BASE, healed, total: results.length, results }, null, 2));
  console.log(`\nHealed pos:true = ${healed}/${results.length}`);
  console.log('Wrote', out);
  if (results.length && healed < results.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });

#!/usr/bin/env node
/** Quick live verification of combo features on Railway */
const BASE = (process.env.SMOKE_URL || 'https://chisafood.up.railway.app').replace(/\/$/, '');

async function fetchText(url) {
  const r = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } });
  return { status: r.status, text: await r.text() };
}

async function main() {
  const checks = [];
  const env = await fetchText(`${BASE}/js/env.js`);
  checks.push(['env.js deploy tag', /__SHOP_POS_DEPLOY__/.test(env.text) ? 'ok' : 'missing']);

  const admin = await fetchText(`${BASE}/js/pages/admin-combos.js`);
  checks.push(['admin delete button', /combo-del/.test(admin.text) ? 'ok' : 'missing']);
  checks.push(['admin remove photo', /cb-hero-remove/.test(admin.text) ? 'ok' : 'missing']);
  checks.push(['admin stock field', /cb-stock/.test(admin.text) ? 'ok' : 'missing']);

  const pos = await fetchText(`${BASE}/js/pages/pos.js`);
  checks.push(['POS pap confirm', /confirmWithoutOptionPrice/.test(pos.text) ? 'ok' : 'missing']);
  checks.push(['POS effectiveRemovals', /effectiveRemovals/.test(pos.text) ? 'ok' : 'missing']);

  const order = await fetchText(`${BASE}/order/js/app.js`);
  checks.push(['online pap confirm', /confirmWithoutOptionPrice/.test(order.text) ? 'ok' : 'missing']);
  checks.push(['online combo price', /calcComboUnitPrice/.test(order.text) ? 'ok' : 'missing']);

  const health = await fetchText(`${BASE}/health`);
  checks.push(['health', health.status === 200 ? 'ok' : `HTTP ${health.status}`]);

  console.log(`Live combo verification — ${BASE}\n`);
  let failed = 0;
  for (const [name, result] of checks) {
    const mark = result === 'ok' ? '✓' : '✗';
    if (result !== 'ok') failed++;
    console.log(`${mark} ${name}: ${result}`);
  }
  if (env.text.match(/__SHOP_POS_DEPLOY__\s*=\s*"([^"]+)"/)) {
    console.log(`\nDeploy tag: ${RegExp.$1}`);
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });

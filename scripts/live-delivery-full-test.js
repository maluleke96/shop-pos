#!/usr/bin/env node
/**
 * Full live delivery department ↔ driver app connectivity test.
 */
const BASE = (process.env.LIVE_URL || 'https://chisafood.up.railway.app').replace(/\/$/, '');
const USER = process.env.SMOKE_USER || 'chisa96';
const PASS = process.env.SMOKE_PASS || '123456';

const results = [];
function record(name, ok, extra = {}) {
  results.push({ name, ok: !!ok, ...extra });
  console.log(`${ok ? '✓' : '✗'} ${name}${extra.note ? ` — ${extra.note}` : ''}${extra.error ? ` — ${extra.error}` : ''}`);
}

async function rpc(method, args = [], token = null) {
  const h = { 'Content-Type': 'application/json' };
  if (token) h['X-Session-Token'] = token;
  const res = await fetch(`${BASE}/rpc`, { method: 'POST', headers: h, body: JSON.stringify({ method, args }) });
  const json = await res.json().catch(() => ({}));
  return { json, token: res.headers.get('X-Session-Token') || json.sessionToken || token, status: res.status };
}

function unwrap(json) {
  if (!json || json.success === false) return null;
  return json.data != null ? json.data : json;
}

async function driverRpc(method, args, driverToken) {
  return rpc(method, [driverToken, ...(args || [])]);
}

async function fetchText(path) {
  const r = await fetch(`${BASE}${path}`, { headers: { 'Cache-Control': 'no-cache' } });
  return { status: r.status, text: r.ok ? await r.text() : '' };
}

(async () => {
  console.log(`\nDelivery full live test — ${BASE}\n`);

  // ── Static assets / UI features deployed ──
  const adminJs = (await fetchText('/js/pages/admin-delivery.js')).text;
  record('admin:deployed', adminJs.length > 5000);
  record('admin:settings live summary', /Current settings \(live\)/.test(adminJs));
  record('admin:payout preview modal', /payout-preview|previewDriverPayout/.test(adminJs));
  record('admin:payment PDF/WhatsApp', /payoutPdf|whatsappLink/.test(adminJs));
  record('admin:all tabs', ['dashboard', 'pool', 'orders', 'drivers', 'pending', 'payments', 'settings', 'reports']
    .every((t) => adminJs.includes(`'${t}'`) || adminJs.includes(`"${t}"`)));

  const driverJs = (await fetchText('/driver/js/app.js')).text;
  record('driver:deployed', driverJs.length > 3000);
  record('driver:deptSettingsHtml', /deptSettingsHtml/.test(driverJs));
  record('driver:claim window', /claim_window|submit-claim/.test(driverJs));
  record('driver:payment popup', /checkNewPaymentPopupFrom|showPaymentReceivedModal/.test(driverJs));
  record('driver:payout PDF', /payout-pdf|payoutPdf/.test(driverJs));
  record('driver:assignment mode pool', /assignment_mode.*auto/.test(driverJs));

  const driverPage = await fetchText('/driver/');
  record('driver:page HTTP 200', driverPage.status === 200);

  // ── Admin login ──
  const login = await rpc('auth:login', [USER, PASS]);
  const actor = login.json?.user || unwrap(login.json)?.user;
  const token = login.token;
  if (!actor) {
    record('admin:login', false, { error: login.json?.error || 'failed' });
    process.exit(1);
  }
  record('admin:login', true, { note: actor.username });

  // ── Delivery dashboard ──
  const dashRes = await rpc('delivery:dashboard', [{}, actor], token);
  const dash = unwrap(dashRes.json);
  record('delivery:dashboard', dash && typeof dash.stats === 'object', { note: `pending ${dash?.stats?.pending ?? '?'}` });

  const settingsRes = await rpc('delivery:settings', [actor], token);
  const settingsBefore = unwrap(settingsRes.json);
  record('delivery:settings load', settingsBefore && settingsBefore.department_mode != null, {
    note: `${settingsBefore?.department_mode} / ${settingsBefore?.default_assignment_mode} / cycle ${settingsBefore?.payout_cycle_days}`
  });

  // Round-trip save (restore after)
  const snapshot = { ...settingsBefore };
  const testPayload = {
    department_mode: settingsBefore.department_mode === 'central' ? 'per_branch' : 'central',
    default_assignment_mode: settingsBefore.default_assignment_mode === 'auto' ? 'manual' : 'auto',
    payout_cycle_days: settingsBefore.payout_cycle_days === 14 ? 7 : 14,
    payout_day_of_week: settingsBefore.payout_day_of_week === 1 ? null : 1
  };
  const saveRes = await rpc('delivery:saveSettings', [testPayload, actor], token);
  const saved = unwrap(saveRes.json);
  const settingsMatch =
    saved?.department_mode === testPayload.department_mode &&
    saved?.default_assignment_mode === testPayload.default_assignment_mode &&
    Number(saved?.payout_cycle_days) === testPayload.payout_cycle_days &&
    (saved?.payout_day_of_week == null ? testPayload.payout_day_of_week == null : Number(saved.payout_day_of_week) === testPayload.payout_day_of_week);
  record('delivery:saveSettings round-trip', settingsMatch, {
    note: settingsMatch ? 'saved OK' : `got ${JSON.stringify(saved)}`
  });

  // Restore original settings
  await rpc('delivery:saveSettings', [{
    department_mode: snapshot.department_mode,
    default_assignment_mode: snapshot.default_assignment_mode,
    payout_cycle_days: snapshot.payout_cycle_days,
    payout_day_of_week: snapshot.payout_day_of_week
  }, actor], token);

  const driversRes = await rpc('delivery:drivers', [{}, actor], token);
  const drivers = unwrap(driversRes.json) || [];
  record('delivery:drivers', Array.isArray(drivers), { note: `${drivers.length} drivers` });

  const activeDrivers = drivers.filter((d) => d.status === 'active');
  record('delivery:active drivers', activeDrivers.length > 0, { note: `${activeDrivers.length} active` });

  // ── Driver login + settings sync ──
  const driverPasswords = ['driver123', '123456', PASS];
  let driverTok = null;
  let driverUser = null;
  for (const d of activeDrivers.slice(0, 5)) {
    const ident = d.phone || d.driver_code || d.email;
    if (!ident) continue;
    for (const pw of driverPasswords) {
      const dr = await rpc('driver:login', [ident, pw, { platform: 'e2e', device_name: 'live-test' }]);
      const data = unwrap(dr.json);
      if (data?.token) {
        driverTok = data.token;
        driverUser = { ...d, ident };
        record('driver:login', true, { note: `${d.full_name} (${ident})` });
        break;
      }
    }
    if (driverTok) break;
  }
  if (!driverTok) {
    record('driver:login', false, { error: 'no active driver credentials (tried common passwords)' });
  } else {
    const dDash = unwrap((await driverRpc('driver:dashboard', [], driverTok)).json);
    record('driver:dashboard', !!dDash?.driver, { note: dDash?.driver?.full_name });

    const adminSettings = unwrap((await rpc('delivery:settings', [actor], token)).json);
    const ds = dDash?.delivery_settings || {};
    const syncOk =
      ds.department_mode === adminSettings.department_mode &&
      ds.assignment_mode === adminSettings.default_assignment_mode &&
      Number(ds.payout_cycle_days) === Number(adminSettings.payout_cycle_days);
    record('driver:settings sync with admin', syncOk, {
      note: `admin ${adminSettings.default_assignment_mode}/${adminSettings.department_mode} · driver ${ds.assignment_mode}/${ds.department_mode}`
    });
    record('driver:payout fields', ds.payout_day_label != null || ds.payout_day_of_week == null, {
      note: `payout day: ${ds.payout_day_label || 'Any day'}, claim: ${ds.claim_window_open ? 'open' : 'closed'}`
    });

    const payments = unwrap((await driverRpc('driver:payments', [{}], driverTok)).json);
    record('driver:payments API', payments && Array.isArray(payments.payouts), {
      note: `owed R${payments?.owed_amount ?? 0}, ${payments?.payouts?.length ?? 0} payouts`
    });
    record('driver:payments has delivery_settings', !!payments?.delivery_settings?.assignment_mode);

    const earnings = unwrap((await driverRpc('driver:earnings', [{ from: '2020-01-01', to: '2099-12-31' }], driverTok)).json);
    record('driver:earnings API', earnings && typeof earnings.total === 'number', {
      note: `${earnings?.count ?? 0} deliveries, still owing R${earnings?.owed_amount ?? 0}`
    });

    // Toggle online and verify dashboard reflects
    await driverRpc('driver:availability', ['online'], driverTok);
    const dDash2 = unwrap((await driverRpc('driver:dashboard', [], driverTok)).json);
    record('driver:availability online', dDash2?.driver?.availability === 'online');
    await driverRpc('driver:availability', ['offline'], driverTok);
  }

  // ── Payout preview (admin) ──
  if (activeDrivers[0]) {
    const prev = await rpc('delivery:previewDriverPayout', [activeDrivers[0].id, {}, actor], token);
    record('delivery:previewDriverPayout', unwrap(prev.json) != null || prev.json?.success !== false, {
      note: prev.json?.error || 'ok'
    });
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log('Failed:', failed.map((f) => f.name).join(', '));
  console.log('');
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

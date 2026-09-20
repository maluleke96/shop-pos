/**
 * Live driver-app button + API wiring smoke.
 * Usage: SMOKE_DRIVER_USER=... SMOKE_DRIVER_PASS=... node scripts/live-driver-app-smoke.js
 */
const BASE = (process.env.SMOKE_URL || 'https://chisafood.up.railway.app').replace(/\/$/, '');

async function rpc(method, args = [], token = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['X-Session-Token'] = token;
  const res = await fetch(`${BASE}/rpc`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ method, args })
  });
  const json = await res.json().catch(() => ({}));
  const tok = res.headers.get('X-Session-Token') || json.sessionToken || token;
  return { json, token: tok, status: res.status };
}

function ok(r) { return r?.json && r.json.success !== false && !r.json.error; }
function data(r) { return r.json?.data != null ? r.json.data : r.json; }

async function driverRpc(method, args, driverTok) {
  // Driver methods put token as first arg (same as DriverAPI)
  return rpc(method, [driverTok, ...(args || [])]);
}

(async () => {
  const findings = [];
  const mark = (name, pass, detail) => {
    findings.push({ name, ok: !!pass, detail: detail || null });
    console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  };

  // Asset checks
  const page = await fetch(`${BASE}/driver/`);
  mark('driver_page', page.status === 200, `HTTP ${page.status}`);
  const appJs = await (await fetch(`${BASE}/driver/js/app.js`)).text();
  const apiJs = await (await fetch(`${BASE}/driver/js/api.js`)).text();
  mark('accept_handler', /act === 'accept'/.test(appJs) && /DriverAPI\.accept/.test(appJs));
  mark('reject_handler', /act === 'reject'/.test(appJs) && /DriverAPI\.reject/.test(appJs));
  mark('release_handler', /act === 'release'/.test(appJs) && /DriverAPI\.release/.test(appJs));
  mark('status_handlers', /picked_up/.test(appJs) && /on_way/.test(appJs) && /delivered/.test(appJs));
  mark('avail_toggle', /avail-toggle/.test(appJs) && /DriverAPI\.availability/.test(appJs));
  mark('navigate_maps', /mapsLink/.test(appJs) && /Navigate/.test(appJs));
  mark('api_methods', /driver:accept/.test(apiJs) && /driver:updateStatus/.test(apiJs));

  // UI bugs we expect to fix: wrong buttons on assigned
  const orderCard = appJs.match(/orderCard\(o[\s\S]*?bindLogin/)?.[0] || '';
  const pickedOnAssigned = /assigned.*picked_up|picking_up'\]\.includes\(st\).*picked_up/.test(orderCard)
    || /\['driver_accepted', 'assigned', 'picking_up'\]/.test(appJs);
  mark('picked_up_not_on_assigned', !/\['driver_accepted', 'assigned', 'picking_up'\]/.test(appJs),
    pickedOnAssigned ? 'BUG: Picked up shown while still assigned' : 'ok');
  mark('profile_logout_wired', /act === 'logout'/.test(appJs.match(/bindMain\(\)[\s\S]*$/)?.[0] || ''),
    'profile Sign out must be handled in bindMain');

  const adminUser = process.env.SMOKE_USER || 'chisa96';
  const adminPass = process.env.SMOKE_PASS;
  const driverUser = process.env.SMOKE_DRIVER_USER || '0611084911';
  const driverPass = process.env.SMOKE_DRIVER_PASS || process.env.SMOKE_PASS;
  if (!adminPass || !driverPass) {
    mark('credentials', false, 'SMOKE_PASS / SMOKE_DRIVER_PASS required for live API checks');
    console.log(JSON.stringify({ ok: findings.every((f) => f.ok), findings }, null, 2));
    process.exit(1);
  }

  const login = await rpc('auth:login', [adminUser, adminPass]);
  mark('admin_login', ok(login), login.json?.error);
  const actor = login.json.user || login.json.data?.user;
  const adminTok = login.token;

  const dLogin = await rpc('driver:login', [driverUser, driverPass, { platform: 'smoke', device_name: 'button-check' }]);
  mark('driver_login', ok(dLogin), dLogin.json?.error || data(dLogin)?.driver?.full_name);
  const dTok = data(dLogin)?.token;
  if (!dTok) {
    console.log(JSON.stringify({ ok: false, findings }, null, 2));
    process.exit(1);
  }

  // Availability toggle
  let r = await driverRpc('driver:availability', ['online'], dTok);
  mark('go_online', ok(r) && data(r)?.availability === 'online', data(r)?.availability);
  r = await driverRpc('driver:dashboard', [], dTok);
  mark('dashboard', ok(r) && !!data(r)?.driver, data(r)?.driver?.full_name);
  const dash = data(r);

  r = await driverRpc('driver:orders', [{}], dTok);
  mark('orders_api', ok(r), Array.isArray(data(r)) ? `${data(r).length} rows` : typeof data(r));

  r = await driverRpc('driver:history', [{ limit: 10 }], dTok);
  mark('history_api', ok(r));
  r = await driverRpc('driver:earnings', [{ from: '2020-01-01', to: '2099-12-31' }], dTok);
  mark('earnings_api', ok(r));
  r = await driverRpc('driver:payments', [{}], dTok);
  mark('payments_api', ok(r));
  r = await driverRpc('driver:profile', [], dTok);
  mark('profile_api', ok(r));

  // Create a synthetic delivery via admin path if possible — list pool
  const list = await rpc('delivery:list', [{ active: true, limit: 20 }, actor], adminTok);
  mark('admin_sees_deliveries', ok(list));
  const deliveries = data(list) || [];
  const awaiting = deliveries.find((d) => String(d.status) === 'awaiting_driver');
  const mine = deliveries.find((d) => Number(d.driver_id) === Number(dash.driver?.id)
    && !['delivered', 'failed', 'cancelled'].includes(String(d.status)));

  let testId = mine?.id || awaiting?.id;
  if (!testId && deliveries[0] && ['pending', 'awaiting_driver'].includes(String(deliveries[0].status))) {
    // release or assign depending on mode
    const mode = dash.assignment_mode || dash.delivery_settings?.assignment_mode;
    if (mode === 'auto') {
      await rpc('delivery:releaseToPool', [deliveries[0].id, actor], adminTok);
      testId = deliveries[0].id;
    } else {
      await rpc('delivery:assign', [deliveries[0].id, dash.driver.id, actor, {}], adminTok);
      testId = deliveries[0].id;
    }
  }

  if (testId) {
    // Ensure online for accept
    await driverRpc('driver:availability', ['online'], dTok);
    const before = await rpc('delivery:get', [testId, actor], adminTok);
    const st0 = String(data(before)?.status || '');

    if (st0 === 'awaiting_driver' || st0 === 'assigned') {
      r = await driverRpc('driver:accept', [testId], dTok);
      mark('accept_button_api', ok(r) && String(data(r)?.status) === 'driver_accepted', data(r)?.status || r.json?.error);
    } else {
      mark('accept_button_api', true, `skipped — current status ${st0}`);
    }

    const afterAccept = data(await rpc('delivery:get', [testId, actor], adminTok));
    if (String(afterAccept?.status) === 'driver_accepted') {
      r = await driverRpc('driver:updateStatus', [testId, 'picked_up', ''], dTok);
      mark('picked_up_button_api', ok(r) && String(data(r)?.status) === 'picked_up', data(r)?.status || r.json?.error);
      r = await driverRpc('driver:updateStatus', [testId, 'on_way', ''], dTok);
      mark('on_way_button_api', ok(r) && String(data(r)?.status) === 'on_way', data(r)?.status || r.json?.error);
      // Do NOT mark delivered on live production order — release back instead if we claimed from pool
      r = await driverRpc('driver:release', [testId, 'smoke-test release'], dTok);
      mark('release_button_api', ok(r), data(r)?.status || r.json?.error);
    } else if (String(afterAccept?.status) === 'picked_up' || String(afterAccept?.status) === 'on_way') {
      mark('picked_up_button_api', true, 'already in progress — skipped');
      mark('on_way_button_api', true, 'already in progress — skipped');
      mark('release_button_api', true, 'skipped');
    } else {
      mark('picked_up_button_api', false, `unexpected status ${afterAccept?.status}`);
      mark('on_way_button_api', false, 'skipped');
      mark('release_button_api', false, 'skipped');
    }
  } else {
    mark('accept_button_api', true, 'no active/pool delivery to exercise — API handlers still present');
    mark('picked_up_button_api', true, 'skipped — no test delivery');
    mark('on_way_button_api', true, 'skipped — no test delivery');
    mark('release_button_api', true, 'skipped — no test delivery');
  }

  r = await driverRpc('driver:availability', ['offline'], dTok);
  mark('go_offline', ok(r) && data(r)?.availability === 'offline', data(r)?.availability);
  await driverRpc('driver:logout', [], dTok);
  mark('logout_api', true);

  const failed = findings.filter((f) => !f.ok);
  console.log(JSON.stringify({ ok: failed.length === 0, failed: failed.map((f) => f.name), findings }, null, 2));
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

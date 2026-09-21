/**
 * Platform shop health checks (server-side). Never returns secrets / Railway tokens.
 */
async function checkShopHealth(shop) {
  const out = {
    shop_id: shop.id,
    shop_url: shop.shop_url || null,
    checked_at: new Date().toISOString(),
    online: false,
    http_status: null,
    database: null,
    shop_key: null,
    enforcement: null,
    package_id: null,
    subscription_hint: null,
    version: null,
    commit: null,
    errors: []
  };
  if (!shop.shop_url) {
    out.errors.push('no_shop_url');
    return out;
  }
  const base = String(shop.shop_url).replace(/\/$/, '');
  try {
    const h = await fetch(base + '/health', { signal: AbortSignal.timeout(15000) });
    out.http_status = h.status;
    const body = await h.json().catch(() => ({}));
    out.online = h.ok && !!body.ok;
    out.database = body.backend || null;
    out.shop_key = body.shop_key || null;
    out.version = body.version || body.deploy_version || null;
    if (!out.online) out.errors.push('health_not_ok');
  } catch (e) {
    out.errors.push('health: ' + String(e.message || e).slice(0, 100));
  }
  try {
    const r = await fetch(base + '/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'entitlements:status', args: [] }),
      signal: AbortSignal.timeout(15000)
    });
    const j = await r.json().catch(() => ({}));
    const d = j.data || j;
    if (j.success !== false && !/Unknown method/i.test(String(j.error || ''))) {
      out.shop_key = d.shop_key || out.shop_key;
      out.enforcement = d.enforcement;
    }
  } catch (e) {
    out.errors.push('entitlements: ' + String(e.message || e).slice(0, 80));
  }
  try {
    const r = await fetch(base + '/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'entitlements:get', args: [] }),
      signal: AbortSignal.timeout(15000)
    });
    const j = await r.json().catch(() => ({}));
    const d = j.data || j;
    if (d && (d.package_id || d.meta?.package_id)) {
      out.package_id = d.package_id || d.meta?.package_id;
    }
    if (d?.flags) out.flags = d.flags;
  } catch (_) { /* */ }
  out.ok = out.online && out.errors.length === 0;
  return out;
}

module.exports = { checkShopHealth };

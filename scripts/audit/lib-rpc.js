/** Shared RPC helper for operations audits */
const BASE = (process.env.SMOKE_URL || 'https://chisafood.up.railway.app').replace(/\/$/, '');
const SLOW_MS = Number(process.env.SLOW_MS || 2000);
const WARN_MS = Number(process.env.WARN_MS || 1000);

async function rpc(method, args = [], token = null, headers = {}) {
  const h = { 'Content-Type': 'application/json', ...headers };
  if (token) h['X-Session-Token'] = token;
  const t0 = Date.now();
  const res = await fetch(`${BASE}/rpc`, {
    method: 'POST',
    headers: h,
    body: JSON.stringify({ method, args })
  });
  const ms = Date.now() - t0;
  const json = await res.json().catch(() => ({}));
  const tok = res.headers.get('X-Session-Token') || json.sessionToken || token;
  return { json, token: tok, ms, status: res.status, method };
}

function ok(r) {
  return r?.json && r.json.success !== false && !r.json.error;
}

function unwrap(json) {
  if (json?.data != null) return json.data;
  return json;
}

function perfClass(ms) {
  if (ms >= SLOW_MS) return 'slow';
  if (ms >= WARN_MS) return 'warn';
  return 'ok';
}

module.exports = { BASE, SLOW_MS, WARN_MS, rpc, ok, unwrap, perfClass };

/**
 * Client-side offline license helper (Windows/Android/browser).
 * Uses server-issued timestamps + elapsed monotonic time — not the wall clock alone.
 */
(function (root) {
  const KEY_LEASE = 'shoppos_license_lease';
  const KEY_SYNC = 'shoppos_license_sync_mono';
  const KEY_SHOP = 'shoppos_shop_id';
  const KEY_DEVICE = 'shoppos_device_public_id';

  function monoNow() {
    if (typeof performance !== 'undefined' && performance.now) return performance.now();
    return Date.now();
  }

  function getLease() {
    try { return JSON.parse(localStorage.getItem(KEY_LEASE) || 'null'); } catch (_) { return null; }
  }

  function storeLease(lease) {
    localStorage.setItem(KEY_LEASE, JSON.stringify(lease || {}));
    localStorage.setItem(KEY_SYNC, String(monoNow()));
  }

  function elapsedMsSinceSync() {
    const sync = Number(localStorage.getItem(KEY_SYNC) || 0);
    if (!sync) return Number.MAX_SAFE_INTEGER;
    return Math.max(0, monoNow() - sync);
  }

  function canCreateProtectedTransaction() {
    const lease = getLease();
    if (!lease || !lease.expires_at || !lease.issued_at) {
      return { allowed: false, reason: 'no_lease', message: { title: 'License Validation Required', body_text: 'This device must activate and validate with the server.' } };
    }
    const issued = Date.parse(lease.issued_at);
    const expires = Date.parse(lease.expires_at);
    const estimated = issued + elapsedMsSinceSync();
    if (estimated >= expires) {
      return {
        allowed: false,
        reason: 'offline_auth_expired',
        message: {
          title: 'License Validation Required',
          body_text: 'This device must reconnect to validate its license before creating new protected transactions.'
        }
      };
    }
    return { allowed: true, expires_at: lease.expires_at };
  }

  async function validateWithServer(rpcUrl) {
    const shop_id = localStorage.getItem(KEY_SHOP);
    const device_public_id = localStorage.getItem(KEY_DEVICE);
    if (!shop_id || !device_public_id) throw new Error('Shop/device not activated');
    const res = await fetch((rpcUrl || '/rpc').replace(/\/$/, ''), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'license:validate', args: [{ shop_id, device_public_id }] })
    });
    const json = await res.json();
    if (!res.ok || json.success === false) {
      const err = new Error(json.error || 'License validation failed');
      err.payload = json;
      throw err;
    }
    const lease = json.data || json;
    storeLease(lease);
    return lease;
  }

  root.ShopPosLicense = {
    getLease,
    storeLease,
    canCreateProtectedTransaction,
    validateWithServer,
    elapsedMsSinceSync
  };
})(typeof window !== 'undefined' ? window : globalThis);

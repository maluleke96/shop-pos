/**
 * Full Shop POS cloud bootstrap — every posAPI channel goes to /rpc
 * (Railway server.js or local start:web) backed by Supabase Postgres.
 * Existing bcrypt passwords work via server-side store.login (preserved in users table).
 * Offline writes are queued in IndexedDB and auto-flushed when online.
 */
(function () {
  const loading = document.getElementById('mobile-loading');
  const setMsg = (msg) => {
    if (!loading) return;
    loading.style.display = 'flex';
    const p = loading.querySelector('p');
    if (p) p.textContent = msg;
  };

  const electronAPI = window.posAPI || null;
  const ELECTRON_PASSTHROUGH =
    /^(print_|printers_|file_|kitchen_open|kitchen_close|kitchen_refresh|customer_open|customer_close|customer_refresh|app_quit|export_|backup_|deviceSettings_)/;

  const TOKEN_KEY = 'shoppos_rpc_session';
  let sessionToken = localStorage.getItem(TOKEN_KEY) || '';
  let flushing = false;

  function env() {
    return window.__SHOP_POS_ENV__ || {};
  }

  function isHostedBrowser() {
    try {
      const proto = String(location.protocol || '');
      const host = String(location.hostname || '');
      if (proto === 'file:') return false;
      if (!host || host === 'localhost' || host === '127.0.0.1') {
        return !!(env().RPC_URL || env().SHOP_POS_RPC_URL);
      }
      return proto === 'http:' || proto === 'https:';
    } catch (_) {
      return false;
    }
  }

  function hasExplicitRpc() {
    const e = env();
    return !!(String(e.RPC_URL || e.SHOP_POS_RPC_URL || '').trim());
  }

  function useCloud() {
    // Installers (Windows Electron + Android) always use the local database.
    // Browser URL on Railway stays cloud-only.
    try {
      if (window.__SHOP_POS_MOBILE__ || window.Capacitor?.isNativePlatform?.()) return false;
    } catch (_) { /* ignore */ }
    try {
      if (window.__SHOP_POS_LOCAL_INSTALLER__) return false;
      if (location.protocol === 'file:' || (window.posAPI && !isHostedBrowser())) return false;
    } catch (_) { /* ignore */ }
    if (hasExplicitRpc()) return true;
    return isHostedBrowser();
  }

  function rpcUrl() {
    const e = env();
    const explicit = e.RPC_URL || e.SHOP_POS_RPC_URL || '';
    if (!explicit) return '/rpc';
    const base = String(explicit).replace(/\/$/, '');
    return /\/rpc$/i.test(base) ? base : base + '/rpc';
  }

  function saveToken(t) {
    sessionToken = t || '';
    if (sessionToken) localStorage.setItem(TOKEN_KEY, sessionToken);
    else localStorage.removeItem(TOKEN_KEY);
  }

  async function sendRpc(method, args, opts) {
    const headers = { 'Content-Type': 'application/json' };
    if (sessionToken) headers['X-Session-Token'] = sessionToken;
    const clientRequestId = opts && opts.clientRequestId ? String(opts.clientRequestId) : '';
    if (clientRequestId) headers['X-Idempotency-Key'] = clientRequestId;
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 60000) : null;
    let r;
    try {
      const body = { method, args: args || [] };
      if (clientRequestId) body.clientRequestId = clientRequestId;
      r = await fetch(rpcUrl(), {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: ctrl ? ctrl.signal : undefined
      });
    } catch (e) {
      const aborted = e && (e.name === 'AbortError' || /aborted/i.test(String(e.message || '')));
      return {
        success: false,
        error: aborted
          ? 'Cloud RPC timed out. Check Railway deployment and Supabase database connection.'
          : ('Cannot reach Cloud RPC at ' + rpcUrl() + '. ' + (e.message || e))
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (r.status === 404) {
      return {
        success: false,
        error:
          'Cloud RPC /rpc not found. Deploy this project to Railway (node server.js) — not static-only hosting.'
      };
    }
    const headerTok = r.headers.get('X-Session-Token');
    if (headerTok) saveToken(headerTok);
    const data = await r.json().catch(() => ({ success: false, error: 'Bad server response from /rpc' }));
    if (data && data.sessionToken) saveToken(data.sessionToken);
    if (method === 'auth_logout' || method === 'auth:logout') saveToken('');
    return data;
  }

  async function flushOfflineQueue() {
    const q = window.ShopPosOfflineQueue;
    if (!q || flushing || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
    flushing = true;
    try {
      const pending = await q.pendingCount();
      if (!pending) {
        try { window.ShopPosConnection?.set?.('online', 'Online'); } catch (_) { /* ignore */ }
        return;
      }
      try { window.ShopPosConnection?.set?.('syncing', `Syncing ${pending}…`); } catch (_) { /* ignore */ }
      await q.flush(sendRpc);
      try { window.ShopPosConnection?.set?.('online', 'Synced'); } catch (_) { /* ignore */ }
      setTimeout(() => {
        try { window.ShopPosConnection?.set?.('online', 'Online'); } catch (_) { /* ignore */ }
      }, 2500);
    } catch (e) {
      console.warn('[offline flush]', e);
      try { window.ShopPosConnection?.set?.('online', 'Sync paused'); } catch (_) { /* ignore */ }
    } finally {
      flushing = false;
      if (loading) loading.style.display = 'none';
    }
  }

  function ensureSaleClientRequestId(key, args) {
    if (!/^sales_complete$/i.test(key)) return { args, clientRequestId: '' };
    const sale = args && args[0] && typeof args[0] === 'object' ? { ...args[0] } : null;
    if (!sale) return { args, clientRequestId: '' };
    let id = String(sale.client_request_id || sale.clientRequestId || '').trim();
    if (!id) {
      id =
        (window.ShopPosOfflineQueue && typeof window.ShopPosOfflineQueue.newRequestId === 'function'
          ? window.ShopPosOfflineQueue.newRequestId()
          : null) ||
        (typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : 'sale-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10));
    }
    sale.client_request_id = id;
    delete sale.clientRequestId;
    const nextArgs = [sale, ...(args || []).slice(1)];
    return { args: nextArgs, clientRequestId: id };
  }

  function canQueueMethod(key) {
    const q = window.ShopPosOfflineQueue;
    if (!q) return false;
    if (typeof q.isQueueMethod === 'function') return q.isQueueMethod(key);
    if (typeof q.isWriteMethod === 'function') return q.isWriteMethod(key);
    return false;
  }

  function looksLikeNetworkFailure(res) {
    if (!res || res.success !== false) return false;
    return /Cannot reach Cloud RPC|timed out|Failed to fetch|NetworkError|Network request failed|fetch/i.test(
      String(res.error || '')
    );
  }

  async function invokeChannel(prop, args) {
    const key = String(prop).replace(/[:.]/g, '_');

    if (electronAPI && ELECTRON_PASSTHROUGH.test(key) && typeof electronAPI[key] === 'function') {
      try {
        return await electronAPI[key](...(args || []));
      } catch (e) {
        return { success: false, error: e.message || String(e) };
      }
    }

    const q = window.ShopPosOfflineQueue;
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    const canQueue = canQueueMethod(key);
    const prepared = ensureSaleClientRequestId(key, args || []);
    const callArgs = prepared.args;
    const saleRequestId = prepared.clientRequestId;

    try {
      if (offline && canQueue) {
        const enq = await q.enqueue(key, callArgs, { clientRequestId: saleRequestId });
        return {
          success: true,
          offlineQueued: true,
          data: { queued: true, clientRequestId: enq.clientRequestId },
          message: 'Saved offline — will sync when connection returns'
        };
      }
      const res = await sendRpc(key, callArgs, { clientRequestId: saleRequestId || undefined });
      if (canQueue && looksLikeNetworkFailure(res)) {
        const enq = await q.enqueue(key, callArgs, { clientRequestId: saleRequestId });
        return {
          success: true,
          offlineQueued: true,
          data: { queued: true, clientRequestId: enq.clientRequestId },
          message: 'Network error — queued offline (same sale id; will not duplicate)'
        };
      }
      return res;
    } catch (e) {
      if (canQueue) {
        const enq = await q.enqueue(key, callArgs, { clientRequestId: saleRequestId });
        return {
          success: true,
          offlineQueued: true,
          data: { queued: true, clientRequestId: enq.clientRequestId },
          message: 'Network error — queued offline'
        };
      }
      return { success: false, error: e.message || String(e) };
    }
  }

  async function boot() {
    if (!useCloud()) {
      if (electronAPI) {
        if (loading) loading.style.display = 'none';
        return;
      }
      setMsg('Configure SHOP_POS_RPC_URL / Supabase env to connect.');
      window.posAPI = new Proxy({}, {
        get(_t, prop) {
          if (typeof prop === 'symbol') return undefined;
          return async () => ({ success: false, error: 'Cloud RPC is not configured' });
        }
      });
      window.dispatchEvent(new Event('posAPIReady'));
      return;
    }

    setMsg('Connecting to Shop POS cloud…');
    window.__SHOP_POS_CLOUD__ = true;
    window.__SHOP_POS_SUPABASE__ = true;

    window.posAPI = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === 'onKitchenRefresh') return () => () => {};
          if (prop === 'onAppCloseBlocked') return () => () => {};
          if (typeof prop === 'symbol') return undefined;
          return async (...args) => invokeChannel(prop, args);
        }
      }
    );

    window.addEventListener('online', () => {
      try { window.ShopPosConnection?.set?.('online', 'Back online'); } catch (_) { /* ignore */ }
      flushOfflineQueue();
    });
    window.addEventListener('offline', () => {
      try { window.ShopPosConnection?.set?.('offline', 'Offline'); } catch (_) { /* ignore */ }
    });
    setTimeout(() => { flushOfflineQueue().catch(() => {}); }, 0);

    if (loading) loading.style.display = 'none';
    window.dispatchEvent(new Event('posAPIReady'));
  }

  boot();
})();

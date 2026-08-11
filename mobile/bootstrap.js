const { App } = require('@capacitor/app');

/**
 * Android bootstrap: when SHOP_POS_RPC_URL / Supabase env is present (injected into env.js),
 * use the same cloud RPC as Netlify/Electron. Otherwise fall back to local sql.js (legacy).
 */
async function bootstrap() {
  const loading = document.getElementById('mobile-loading');
  const setMsg = (msg) => {
    if (!loading) return;
    loading.style.display = 'flex';
    const p = loading.querySelector('p');
    if (p) p.textContent = msg;
  };

  const env = (typeof window !== 'undefined' && window.__SHOP_POS_ENV__) || {};
  const useCloud = !!(env.RPC_URL || env.SHOP_POS_RPC_URL || (env.SHOP_POS_SUPABASE_URL && env.SHOP_POS_SUPABASE_ANON_KEY));

  if (useCloud) {
    // index.html already loads offline-queue + supabase-bootstrap which owns posAPI.
    window.__SHOP_POS_MOBILE__ = true;
    document.documentElement.classList.add('capacitor-android');
    document.body?.classList.add('capacitor-android');
    if (loading) loading.style.display = 'none';
    return;
  }

  try {
    setMsg('Loading database…');
    const { initDatabase, persistNow } = require('./db');
    const { buildHandlers } = require('./handlers');
    await initDatabase();
    if (window.__SHOP_POS_RECOVERED__) {
      setMsg('Restored your shop from update backup…');
    }
    setMsg('Almost ready…');
    const store = require('../electron/services/store');
    const handlers = buildHandlers(store);

    window.posAPI = { ...handlers };
    window.posAPI.onKitchenRefresh = () => () => {};
    window.posAPI.onAppCloseBlocked = (cb) => {
      let handle = null;
      App.addListener('backButton', () => cb()).then((h) => { handle = h; });
      return () => { handle?.remove(); };
    };
    window.__SHOP_POS_MOBILE__ = true;
    document.documentElement.classList.add('capacitor-android');
    document.body?.classList.add('capacitor-android');

    const flushDb = () => { try { persistNow(); } catch (_) { /* ignore */ } };
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushDb();
    });
    window.addEventListener('pagehide', flushDb);

    if (loading) loading.style.display = 'none';
    window.dispatchEvent(new Event('posAPIReady'));
  } catch (err) {
    console.error(err);
    setMsg((err && err.message) || 'Failed to start');
  }
}

bootstrap();

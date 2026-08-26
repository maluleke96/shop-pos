const { App } = require('@capacitor/app');

function isNativePlatform() {
  try {
    const { Capacitor } = require('@capacitor/core');
    if (typeof Capacitor?.isNativePlatform === 'function') return !!Capacitor.isNativePlatform();
  } catch (_) { /* ignore */ }
  return !!(typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.());
}

/**
 * Android/iOS bootstrap — LOCAL-FIRST.
 *
 * Critical: APK updates must recover IndexedDB / Documents shop data and show LOGIN,
 * never "Register New Shop", just because Supabase keys exist in env.js.
 *
 * Cloud RPC is only used when:
 *   - not a native Capacitor app, AND
 *   - RPC_URL / Supabase env is present (web/Netlify path)
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
  const hasRpc = !!(env.RPC_URL || env.SHOP_POS_RPC_URL);
  const hasSupabase = !!(env.SHOP_POS_SUPABASE_URL && env.SHOP_POS_SUPABASE_ANON_KEY);
  const native = isNativePlatform();

  // Web/cloud only — never skip local DB on Capacitor Android/iOS
  if (!native && (hasRpc || hasSupabase)) {
    window.__SHOP_POS_MOBILE__ = true;
    document.documentElement.classList.add('capacitor-android');
    document.body?.classList.add('capacitor-android');
    if (loading) loading.style.display = 'none';
    return;
  }

  try {
    setMsg('Loading your shop…');
    const { initDatabase, persistNow } = require('./db');
    const { buildHandlers } = require('./handlers');
    await initDatabase();

    const store = require('../electron/services/store');
    // If shop data exists but setup_complete was lost/0, adopt it (UPDATE, not new shop)
    try {
      const adopted = store.adoptExistingBusiness();
      if (adopted?.adopted) {
        setMsg('Restored existing shop…');
        console.info('[Mobile] Adopted existing business', adopted);
      }
    } catch (err) {
      console.warn('[Mobile] adoptExistingBusiness:', err?.message || err);
    }

    if (window.__SHOP_POS_RECOVERED__) {
      setMsg('Restored your shop from device backup…');
    }
    setMsg('Almost ready…');
    const handlers = buildHandlers(store);

    window.posAPI = { ...handlers };
    window.posAPI.onKitchenRefresh = () => () => {};
    window.posAPI.onAppCloseBlocked = (cb) => {
      let handle = null;
      App.addListener('backButton', () => cb()).then((h) => { handle = h; });
      return () => { handle?.remove(); };
    };
    window.__SHOP_POS_MOBILE__ = true;
    window.__SHOP_POS_LOCAL__ = true;
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

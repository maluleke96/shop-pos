/**
 * Shared Supabase client for Shop POS (Web / Electron / Android).
 * Keys come from window.__SHOP_POS_ENV__ or process.env (Electron).
 */
(function (root) {
  function readEnv() {
    const w = typeof window !== 'undefined' ? window : {};
    const env = w.__SHOP_POS_ENV__ || {};
    const url =
      env.SUPABASE_URL ||
      env.SHOP_POS_SUPABASE_URL ||
      (typeof process !== 'undefined' && process.env && (process.env.SHOP_POS_SUPABASE_URL || process.env.SUPABASE_URL)) ||
      '';
    const anon =
      env.SUPABASE_ANON_KEY ||
      env.SHOP_POS_SUPABASE_ANON_KEY ||
      (typeof process !== 'undefined' && process.env && (process.env.SHOP_POS_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY)) ||
      '';
    return { url: String(url || '').trim(), anon: String(anon || '').trim() };
  }

  function createClient() {
    const { url, anon } = readEnv();
    if (!url || !anon) {
      throw new Error(
        'Supabase is not configured. Set SHOP_POS_SUPABASE_URL and SHOP_POS_SUPABASE_ANON_KEY (see .env.example).'
      );
    }
    if (!root.supabase || !root.supabase.createClient) {
      throw new Error('Supabase JS SDK not loaded. Include @supabase/supabase-js before supabase-client.js');
    }
    if (root.__shopPosSupabase) return root.__shopPosSupabase;
    root.__shopPosSupabase = root.supabase.createClient(url, anon, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });
    return root.__shopPosSupabase;
  }

  root.ShopPosSupabase = { readEnv, createClient };
})(typeof window !== 'undefined' ? window : globalThis);

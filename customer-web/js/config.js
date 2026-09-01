/* Fallback before Railway server writes live config — points to your cloud POS */
window.__ORDER_CONFIG__ = window.__ORDER_CONFIG__ || {
  rpcUrl: 'https://peaceful-motivation-production-7dd2.up.railway.app/rpc',
  apiBase: 'https://peaceful-motivation-production-7dd2.up.railway.app',
  orderPath: '/order/',
  supabaseUrl: 'https://khwohhrzlnmmrxwugtux.supabase.co',
  connected: 'railway-supabase-pos'
};

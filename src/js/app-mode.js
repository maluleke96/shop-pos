/**
 * App mode helpers — Admin vs POS vs Staff Portal vs Recipe vs Accounting.
 * Set via ?app=staff|recipe|accounting|admin|pos|referral|referral-commission or window.__SHOP_POS_APP_MODE__.
 */
(function () {
  function mapApp(a) {
    a = String(a || '').toLowerCase().trim();
    if (a === 'staff' || a === 'staff-portal') return 'staff';
    if (a === 'recipe' || a === 'recipe-production') return 'recipe';
    if (a === 'accounting' || a === 'bookkeeping' || a === 'finance') return 'accounting';
    if (a === 'hr' || a === 'hr-workspace') return 'hr';
    if (a === 'delivery' || a === 'delivery-dept' || a === 'delivery-department') return 'delivery';
    if (a === 'referral' || a === 'referral-agent' || a === 'referral-portal') return 'referral';
    if (a === 'referral-commission' || a === 'referralcommission' || a === 'commission') return 'referral-commission';
    if (a === 'mgr-hr' || a === 'mgrhr' || a === 'manager-hr' || a === 'supervisor-hr' || a === 'manager-supervisor') return 'mgr-hr';
    if (a === 'pos' || a === 'till') return 'pos';
    if (a === 'admin') return 'admin';
    if (a === 'studio' || a === 'studio-builder' || a === 'menu-promo-studio') return 'studio-builder';
    if (a === 'apply' || a === 'jobs' || a === 'careers') return 'apply';
    return '';
  }

  function fromQuery() {
    try {
      const q = new URLSearchParams(location.search || '');
      return mapApp(q.get('app'));
    } catch (_) { /* ignore */ }
    return '';
  }

  function fromHash() {
    try {
      const h = String(location.hash || '').replace(/^#/, '').toLowerCase();
      if (!h) return '';
      const p = new URLSearchParams(h.includes('=') ? h : '');
      const a = (p.get('app') || (h.startsWith('app=') ? h.split('&')[0].replace(/^app=/, '') : '')).trim();
      return mapApp(a);
    } catch (_) { /* ignore */ }
    return '';
  }

  function fromStorage() {
    try {
      return mapApp(sessionStorage.getItem('SHOP_POS_APP_MODE') || localStorage.getItem('SHOP_POS_APP_MODE'));
    } catch (_) { /* ignore */ }
    return '';
  }

  // Persist mode from query/hash so redirects and Capacitor entry pages keep the portal
  try {
    const fromUrl = fromQuery() || fromHash();
    if (fromUrl) {
      sessionStorage.setItem('SHOP_POS_APP_MODE', fromUrl);
      localStorage.setItem('SHOP_POS_APP_MODE', fromUrl);
    }
  } catch (_) { /* ignore */ }

  const mode =
    window.__SHOP_POS_APP_MODE__ ||
    fromQuery() ||
    fromHash() ||
    fromStorage() ||
    'admin';

  window.__SHOP_POS_APP_MODE__ = mode;
  try {
    sessionStorage.setItem('SHOP_POS_APP_MODE', mode);
    localStorage.setItem('SHOP_POS_APP_MODE', mode);
  } catch (_) { /* ignore */ }
  document.documentElement.dataset.appMode = mode;
  try { document.body.dataset.appMode = mode; } catch (_) { /* body may not exist yet */ }
  document.addEventListener('DOMContentLoaded', () => {
    try { document.body.dataset.appMode = mode; } catch (_) { /* ignore */ }
  });
  if (mode === 'pos') {
    document.documentElement.classList.add('pos-kiosk');
    document.body?.classList?.add('pos-kiosk');
  }
})();

/**
 * App mode helpers — Admin vs POS vs Staff Portal vs Marketing vs Recipe vs Accounting.
 * Set via ?app=staff|marketing|recipe|accounting|admin|pos or window.__SHOP_POS_APP_MODE__.
 */
(function () {
  function fromQuery() {
    try {
      const q = new URLSearchParams(location.search || '');
      const a = (q.get('app') || '').toLowerCase().trim();
      if (a === 'staff' || a === 'staff-portal') return 'staff';
      if (a === 'marketing' || a === 'marketing-agent') return 'marketing';
      if (a === 'recipe' || a === 'recipe-production') return 'recipe';
      if (a === 'accounting' || a === 'bookkeeping' || a === 'finance') return 'accounting';
      if (a === 'hr' || a === 'hr-workspace') return 'hr';
      if (a === 'delivery' || a === 'delivery-dept' || a === 'delivery-department') return 'delivery';
      if (a === 'pos' || a === 'till') return 'pos';
      if (a === 'admin') return 'admin';
    } catch (_) { /* ignore */ }
    return '';
  }

  function fromHash() {
    try {
      const h = String(location.hash || '').replace(/^#/, '').toLowerCase();
      if (!h) return '';
      const p = new URLSearchParams(h.includes('=') ? h : '');
      const a = (p.get('app') || (h.startsWith('app=') ? h.split('&')[0].replace(/^app=/, '') : '')).trim();
      if (a === 'staff' || a === 'staff-portal') return 'staff';
      if (a === 'marketing' || a === 'marketing-agent') return 'marketing';
      if (a === 'recipe' || a === 'recipe-production') return 'recipe';
      if (a === 'accounting' || a === 'bookkeeping' || a === 'finance') return 'accounting';
      if (a === 'hr' || a === 'hr-workspace') return 'hr';
      if (a === 'delivery' || a === 'delivery-dept' || a === 'delivery-department') return 'delivery';
      if (a === 'pos' || a === 'till') return 'pos';
      if (a === 'admin') return 'admin';
    } catch (_) { /* ignore */ }
    return '';
  }

  const mode =
    window.__SHOP_POS_APP_MODE__ ||
    fromQuery() ||
    fromHash() ||
    'admin';

  window.__SHOP_POS_APP_MODE__ = mode;
  document.documentElement.dataset.appMode = mode;
  if (mode === 'pos') {
    document.documentElement.classList.add('pos-kiosk');
    document.body?.classList?.add('pos-kiosk');
  }
})();

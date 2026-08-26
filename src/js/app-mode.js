/**
 * App mode helpers — Admin vs POS vs Staff Portal vs Marketing vs Recipe.
 * Set via ?app=staff|marketing|recipe|admin|pos or window.__SHOP_POS_APP_MODE__.
 */
(function () {
  function fromQuery() {
    try {
      const q = new URLSearchParams(location.search || '');
      const a = (q.get('app') || '').toLowerCase().trim();
      if (a === 'staff' || a === 'staff-portal') return 'staff';
      if (a === 'marketing' || a === 'marketing-agent') return 'marketing';
      if (a === 'recipe' || a === 'recipe-production') return 'recipe';
      if (a === 'pos' || a === 'till') return 'pos';
      if (a === 'admin') return 'admin';
    } catch (_) { /* ignore */ }
    return '';
  }

  function fromHash() {
    try {
      const h = String(location.hash || '').replace(/^#/, '').toLowerCase();
      if (h.startsWith('app=staff')) return 'staff';
      if (h.startsWith('app=marketing')) return 'marketing';
      if (h.startsWith('app=recipe')) return 'recipe';
      if (h.startsWith('app=pos') || h.startsWith('app=till')) return 'pos';
      if (h.startsWith('app=admin')) return 'admin';
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
})();

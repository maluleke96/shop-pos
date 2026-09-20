/** Apply shop logo + favicon on any panel login page (driver, order, etc.) */
(function () {
  const LOGO_URL = '/api/logo';
  let _cachedName = '';
  let _applied = false;

  function setLogoSlot(el) {
    const existing = el.querySelector('img');
    if (existing) {
      const src = existing.getAttribute('src') || '';
      if (src === LOGO_URL || src.startsWith(LOGO_URL + '?')) {
        existing.style.display = '';
        return;
      }
    }
    el.innerHTML = `<img src="${LOGO_URL}?v=1" alt="" style="max-height:36px;max-width:72px;width:auto;height:auto;object-fit:contain;border-radius:8px" onerror="this.style.display='none'">`;
  }

  async function applyBrand() {
    try {
      const res = await fetch('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'web:getSettings', args: [] })
      });
      const json = await res.json();
      const settings = json.data || json;
      const name = settings.shop_name || settings.app_display_name || 'Shop';
      _cachedName = name;
      document.title = document.title.includes(name) ? document.title : `${document.title} · ${name}`;
      let link = document.querySelector('link[rel="icon"]');
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.head.appendChild(link);
      }
      link.href = LOGO_URL;
      document.querySelectorAll('[data-shop-logo]').forEach(setLogoSlot);
      document.querySelectorAll('[data-shop-name]').forEach((el) => {
        el.textContent = name;
      });
      _applied = true;
    } catch (_) {
      document.querySelectorAll('[data-shop-logo]').forEach(setLogoSlot);
    }
  }

  /** Re-apply logo into empty slots only (after silent re-renders). */
  function refreshSlots() {
    document.querySelectorAll('[data-shop-logo]').forEach(setLogoSlot);
    if (_cachedName) {
      document.querySelectorAll('[data-shop-name]').forEach((el) => {
        if (!el.textContent || el.textContent === 'Business Manager') el.textContent = _cachedName;
      });
    }
    if (!_applied) applyBrand();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyBrand);
  else applyBrand();
  window.PanelBrand = { apply: applyBrand, refreshSlots, logoUrl: LOGO_URL };
})();

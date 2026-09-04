/** Apply shop logo + favicon on any panel login page (driver, order, etc.) */
(function () {
  const LOGO_URL = '/api/logo';
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
      document.title = document.title.includes(name) ? document.title : `${document.title} · ${name}`;
      let link = document.querySelector('link[rel="icon"]');
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.head.appendChild(link);
      }
      link.href = LOGO_URL;
      document.querySelectorAll('[data-shop-logo]').forEach((el) => {
        el.innerHTML = `<img src="${LOGO_URL}" alt="" style="max-height:48px;border-radius:8px" onerror="this.style.display='none'">`;
      });
      document.querySelectorAll('[data-shop-name]').forEach((el) => {
        el.textContent = name;
      });
    } catch (_) { /* optional */ }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyBrand);
  else applyBrand();
  window.PanelBrand = { apply: applyBrand, logoUrl: LOGO_URL };
})();

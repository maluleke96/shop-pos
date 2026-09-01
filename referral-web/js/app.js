(function () {
  const app = document.getElementById('app');
  const cfg = window.__REFERRAL_CONFIG__ || {};

  function parseCode() {
    const parts = (location.pathname || '').split('/').filter(Boolean);
    const rIdx = parts.indexOf('r');
    if (rIdx >= 0 && parts[rIdx + 1]) return decodeURIComponent(parts[rIdx + 1]);
    const q = new URLSearchParams(location.search).get('code');
    return q || '';
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function orderUrl() {
    const base = (cfg.apiBase || location.origin).replace(/\/$/, '');
    return `${base}/order/`;
  }

  async function main() {
    const code = parseCode();
    if (!code) {
      app.innerHTML = '<div class="ref-error">No referral code in this link.</div>';
      return;
    }
    try {
      await ReferralAPI.recordClick(code, { source: 'landing', user_agent: navigator.userAgent });
    } catch (_) { /* best effort */ }

    const res = await ReferralAPI.getPublicAgent(code);
    if (!res?.success || !res?.data) {
      app.innerHTML = `<div class="ref-error">${esc(res?.error || 'Referral code not recognised')}</div>`;
      return;
    }
    const p = res.data;
    const biz = p.business || {};
    const promos = (p.promotions || []).slice(0, 5);
    const campaigns = (p.campaigns || []).slice(0, 5);
    const shopUrl = `${orderUrl()}?ref=${encodeURIComponent(p.referral_code || code)}`;

    app.innerHTML = `
      <div class="ref-card ref-hero">
        ${biz.logo_path ? `<img src="${esc(biz.logo_path)}" alt="" style="max-height:64px;margin-bottom:12px">` : ''}
        <h1>${esc(p.full_name)}</h1>
        <p>Your referral agent${biz.name ? ` · ${esc(biz.name)}` : ''}</p>
        <div class="ref-code">${esc(p.referral_code || code)}</div>
      </div>
      <div class="ref-card">
        <p style="margin:0 0 12px;color:var(--muted)">Shop with this referral code and support your agent.</p>
        <a class="ref-btn" href="${esc(shopUrl)}">Order online</a>
        ${biz.whatsapp_number || biz.contact_phone ? `<a class="ref-btn secondary" href="https://wa.me/${esc(String(biz.whatsapp_number || biz.contact_phone).replace(/\D/g, ''))}">WhatsApp us</a>` : ''}
      </div>
      ${promos.length ? `<div class="ref-card"><h3 style="margin:0 0 12px">Promotions</h3><ul class="ref-list">${promos.map((pr) => `<li><strong>${esc(pr.name)}</strong><small>${esc(pr.promo_type || '')} ${pr.discount_value ? `· ${pr.discount_value}%` : ''}</small></li>`).join('')}</ul></div>` : ''}
      ${campaigns.length ? `<div class="ref-card"><h3 style="margin:0 0 12px">Campaigns</h3><ul class="ref-list">${campaigns.map((c) => `<li><strong>${esc(c.name)}</strong><small>${esc(c.description || '')}</small></li>`).join('')}</ul></div>` : ''}
    `;
  }

  main().catch((e) => {
    app.innerHTML = `<div class="ref-error">${esc(e.message || 'Failed to load referral page')}</div>`;
  });
})();

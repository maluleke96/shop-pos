/**
 * Customer app — App Notifications, Promotions, Ratings (extends OrderApp).
 * Does not replace existing WhatsApp/SMS/email consent; app prefs are separate.
 */
(function () {
  const App = window.OrderApp;
  if (!App) return;

  App._appUnread = 0;
  App._appInbox = [];
  App._appPrefs = null;
  App._appPromos = [];

  const PREF_KEYS = [
    ['special_offers', 'Special offers & promotions'],
    ['loyalty_rewards', 'Loyalty rewards'],
    ['new_products', 'New products'],
    ['branch_announcements', 'Branch announcements'],
    ['order_updates', 'Order updates']
  ];

  App.refreshAppUnread = async function () {
    if (!this.token) { this._appUnread = 0; return 0; }
    try {
      const n = await OrderAPI.getAppUnreadCount(this.token);
      this._appUnread = Number(n?.count ?? n) || 0;
    } catch (_) { this._appUnread = 0; }
    return this._appUnread;
  };

  App.maybeShowNotifyPrompt = async function () {
    if (!this.token) return;
    try {
      const prefs = await OrderAPI.getAppNotifyPrefs(this.token);
      this._appPrefs = prefs;
      if (prefs?.prompt_shown) return;
      if (sessionStorage.getItem('app_notify_prompt_dismissed') === '1') return;
      this.openNotifyPrompt(prefs);
    } catch (_) { /* optional */ }
  };

  App.openNotifyPrompt = function (prefs) {
    const root = document.getElementById('modal-root');
    const body = document.getElementById('modal-body');
    const foot = document.getElementById('modal-foot');
    const title = document.getElementById('modal-title');
    if (!root || !body) return;
    title.textContent = 'Stay Connected?';
    const shop = this.settings?.shop_name || 'us';
    body.innerHTML = `<p class="muted">Would you like to receive updates from ${this.esc(shop)}?</p>
      <div class="pref-list">${PREF_KEYS.map(([k, label]) =>
        `<label class="pref-row"><input type="checkbox" data-pref="${k}" ${prefs?.[k] !== 0 && prefs?.[k] !== false ? 'checked' : ''}> ${label}</label>`
      ).join('')}</div>
      <p class="muted" style="font-size:12px;margin-top:8px">You can change this anytime in Account → Notification Preferences. Marketing is optional.</p>`;
    foot.innerHTML = `<button type="button" class="btn-primary" data-act="app-notify-allow">Allow Notifications</button>
      <button type="button" class="btn-outline" data-act="app-notify-later">Not Now</button>`;
    root.classList.remove('hidden');
    root.setAttribute('aria-hidden', 'false');
  };

  App.saveNotifyPrompt = async function (allow) {
    const boxes = {};
    PREF_KEYS.forEach(([k]) => {
      const el = document.querySelector(`[data-pref="${k}"]`);
      boxes[k] = allow ? (el?.checked !== false ? 1 : 0) : 0;
    });
    boxes.prompt_shown = 1;
    if (allow) {
      boxes.os_permission = 1;
      try {
        if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
          const p = await Notification.requestPermission();
          boxes.os_permission = p === 'granted' ? 1 : 0;
        } else if (typeof Notification !== 'undefined') {
          boxes.os_permission = Notification.permission === 'granted' ? 1 : 0;
        }
      } catch (_) { /* */ }
      try {
        const tokenId = `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        localStorage.setItem('app_device_token', tokenId);
        await OrderAPI.registerAppDevice(this.token, { device_token: tokenId, platform: 'web', device_name: navigator.userAgent?.slice(0, 80) });
      } catch (_) { /* */ }
    }
    try { await OrderAPI.saveAppNotifyPrefs(this.token, boxes); } catch (_) { /* */ }
    try { sessionStorage.setItem('app_notify_prompt_dismissed', '1'); } catch (_) { /* */ }
    document.getElementById('modal-root')?.classList.add('hidden');
    this.toast(allow ? 'Notification preferences saved' : 'You can enable notifications later in Account', 'success');
  };

  App.openDeepLink = async function (item) {
    const type = String(item?.destination_type || 'home').toLowerCase();
    const id = item?.destination_id;
    if (item?.id) {
      try { await OrderAPI.markAppInboxClicked(this.token, item.id); } catch (_) { /* */ }
    }
    if (type === 'product' && id) {
      try {
        this.product = await OrderAPI.getProduct(this.branch?.id, id);
        this.view = 'product';
        return this.render();
      } catch (_) { this.view = 'menu'; return this.render(); }
    }
    if (type === 'menu') { this.view = 'menu'; return this.render(); }
    if (type === 'loyalty' || type === 'account') { this.view = 'account'; return this.render(); }
    if (type === 'order' || type === 'orders') { this.view = 'orders'; return this.render(); }
    if (type === 'promotions') { this.view = 'promotions'; return this.render(); }
    if (type === 'branch' && id) {
      // stay on current branch UI; branch switch is separate
      this.view = 'home';
      return this.render();
    }
    if (type === 'custom' && item.destination_url) {
      window.open(item.destination_url, '_blank', 'noopener');
      return;
    }
    this.view = 'home';
    return this.render();
  };

  const _origShell = App.shell.bind(App);
  App.shell = function (body, title) {
    const html = _origShell(body, title);
    if (!this.token) return html;
    const badge = this._appUnread > 0
      ? `<span class="app-bell-badge">${this._appUnread > 9 ? '9+' : this._appUnread}</span>`
      : '';
    const bell = `<button type="button" class="app-bell-btn" data-act="app-inbox" aria-label="Notifications" title="Notifications">🔔${badge}</button>`;
    return html.replace(
      '<div class="top-actions">',
      `<div class="top-actions">${bell}`
    );
  };

  const _origBind = App.bind.bind(App);
  App.bind = function () {
    _origBind();
    const app = document.getElementById('app');
    if (!app || app._appChannelBound) return;
    // Extend click handler via capture on document for our acts (orig bind replaces app.onclick each time)
    const prev = app.onclick;
    app.onclick = async (e) => {
      const btn = e.target.closest('[data-act]');
      const act = btn?.dataset?.act;
      if (act === 'app-inbox') {
        this.view = 'app-inbox';
        this.render();
        return;
      }
      if (act === 'app-notify-allow') { await this.saveNotifyPrompt(true); return; }
      if (act === 'app-notify-later') { await this.saveNotifyPrompt(false); return; }
      if (act === 'app-pref-toggle') {
        const key = btn.dataset.key;
        const on = btn.dataset.on !== '1';
        btn.dataset.on = on ? '1' : '0';
        btn.textContent = on ? 'ON' : 'OFF';
        btn.classList.toggle('pref-on', on);
        const prefs = { ...(this._appPrefs || {}), [key]: on ? 1 : 0 };
        this._appPrefs = prefs;
        try {
          await OrderAPI.saveAppNotifyPrefs(this.token, prefs);
          this.toast('Saved', 'success');
        } catch (err) { this.toast(err.message || 'Could not save', 'error'); }
        return;
      }
      if (act === 'app-inbox-open') {
        const id = btn.dataset.id;
        const item = (this._appInbox || []).find((x) => String(x.id) === String(id));
        try { await OrderAPI.markAppInboxRead(this.token, id); } catch (_) { /* */ }
        await this.openDeepLink(item || { destination_type: btn.dataset.dest, destination_id: btn.dataset.destId, destination_url: btn.dataset.url, id });
        return;
      }
      if (act === 'app-inbox-read-all') {
        try { await OrderAPI.markAppInboxRead(this.token, null); this._appUnread = 0; this.toast('Marked all read', 'success'); this.render(); } catch (err) { this.toast(err.message, 'error'); }
        return;
      }
      if (act === 'app-report-review') {
        const reviewId = btn.dataset.reviewId;
        const reason = prompt('Why are you reporting this review? (optional)') ?? '';
        try {
          await OrderAPI.reportAppReview(this.token, Number(reviewId), reason || null);
          this.toast('Report submitted', 'success');
        } catch (err) { this.toast(err.message || 'Could not report', 'error'); }
        return;
      }
      if (act === 'app-submit-review') {
        const rating = parseInt(document.getElementById('app-review-stars')?.value || btn.dataset.rating || '5', 10);
        const text = document.getElementById('app-review-text')?.value || '';
        const liked = Array.from(document.querySelectorAll('[data-liked]:checked')).map((el) => el.value);
        const orderId = btn.dataset.orderId || this.lastOrder?.id || this.selectedOrder?.id;
        try {
          await OrderAPI.submitAppReview(this.token, {
            order_id: orderId,
            rating,
            liked,
            review_text: text,
            branch_id: this.branch?.id
          });
          this.toast('Thank you for your review!', 'success');
          document.getElementById('app-review-box')?.remove();
        } catch (err) { this.toast(err.message || 'Could not submit review', 'error'); }
        return;
      }
      if (act === 'nav' && btn.dataset.view === 'promotions') {
        this.view = 'promotions';
        this.render();
        return;
      }
      if (typeof prev === 'function') return prev.call(app, e);
    };
  };

  const _origRender = App.render.bind(App);
  App.render = async function () {
    if (this.token && !this._appUnreadLoaded) {
      this._appUnreadLoaded = true;
      this.refreshAppUnread().then(() => {
        const badge = document.querySelector('.app-bell-badge');
        const btn = document.querySelector('.app-bell-btn');
        if (btn && this._appUnread > 0 && !badge) {
          btn.insertAdjacentHTML('beforeend', `<span class="app-bell-badge">${this._appUnread > 9 ? '9+' : this._appUnread}</span>`);
        }
      }).catch(() => {});
      setTimeout(() => this.maybeShowNotifyPrompt(), 1200);
    }

    if (this.view === 'app-inbox') {
      if (!this.token) { this.view = 'login'; this.authReturn = 'app-inbox'; return _origRender.call(this); }
      const appEl = document.getElementById('app');
      appEl.innerHTML = this.shell(`<section class="page"><h1>🔔 Notifications</h1><p class="muted">Loading…</p></section>`);
      this.bind();
      try {
        const rows = await OrderAPI.getAppInbox(this.token, 50);
        this._appInbox = Array.isArray(rows) ? rows : (rows?.items || []);
        await this.refreshAppUnread();
        appEl.innerHTML = this.shell(`<section class="page">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
            <h1 style="margin:0">🔔 Notifications</h1>
            <button type="button" class="link-btn" data-act="app-inbox-read-all">Mark all read</button>
          </div>
          ${this._appInbox.length ? this._appInbox.map((n) => `
            <button type="button" class="inbox-card${!n.read_at ? ' inbox-unread' : ''}" data-act="app-inbox-open" data-id="${n.id}"
              data-dest="${this.esc(n.destination_type || '')}" data-dest-id="${this.esc(n.destination_id || '')}" data-url="${this.esc(n.destination_url || '')}">
              <strong>${this.esc(n.title)}</strong>
              <div class="muted" style="font-size:12px">${this.esc(String(n.created_at || '').slice(0, 16))}</div>
              <p style="margin:6px 0 0">${this.esc(n.body || '')}</p>
              ${n.button_text ? `<span class="btn-primary btn-sm" style="margin-top:8px;display:inline-block">${this.esc(n.button_text)}</span>` : ''}
            </button>`).join('') : '<p class="muted">No notifications yet.</p>'}
        </section>`);
        this.bind();
      } catch (err) {
        appEl.innerHTML = this.shell(`<section class="page"><h1>Notifications</h1><p class="muted">${this.esc(err.message)}</p></section>`);
        this.bind();
      }
      return;
    }

    if (this.view === 'promotions') {
      const appEl = document.getElementById('app');
      appEl.innerHTML = this.shell(`<section class="page"><h1>Promotions</h1><p class="muted">Loading…</p></section>`);
      this.bind();
      try {
        const list = await OrderAPI.listAppPromotions(this.branch?.id, null);
        this._appPromos = Array.isArray(list) ? list : [];
        appEl.innerHTML = this.shell(`<section class="page"><h1>🎯 Promotions</h1>
          ${this._appPromos.length ? this._appPromos.map((p) => `
            <div class="promo-card">
              ${p.image_url ? `<img src="${this.esc(p.image_url)}" alt="" style="width:100%;max-height:160px;object-fit:cover;border-radius:10px">` : ''}
              <h3 style="margin:8px 0 4px">${this.esc(p.name)}</h3>
              <p class="muted">${this.esc(p.description || '')}</p>
              ${p.price != null ? `<strong>${this.money(p.price)}</strong>` : ''}
              <button type="button" class="btn-primary btn-block" style="margin-top:8px" data-act="app-inbox-open"
                data-dest="${this.esc(p.destination_type || 'product')}" data-dest-id="${this.esc(p.destination_id || p.product_id || '')}"
                data-url="${this.esc(p.destination_url || '')}">${this.esc(p.button_text || 'ORDER NOW')}</button>
            </div>`).join('') : '<p class="muted">No active promotions right now.</p>'}
        </section>`);
        this.bind();
      } catch (err) {
        appEl.innerHTML = this.shell(`<section class="page"><h1>Promotions</h1><p class="muted">${this.esc(err.message)}</p></section>`);
        this.bind();
      }
      return;
    }

    await _origRender.call(this);

    // Enhance account page with app notification prefs + my reviews
    if (this.view === 'account' && this.token) {
      const section = document.querySelector('.account-actions');
      if (section && !document.getElementById('app-prefs-card')) {
        let prefs = this._appPrefs;
        try { prefs = await OrderAPI.getAppNotifyPrefs(this.token); this._appPrefs = prefs; } catch (_) { /* */ }
        const card = document.createElement('div');
        card.id = 'app-prefs-card';
        card.className = 'checkout-card';
        let myReviewsHtml = '';
        try {
          const myReviews = await OrderAPI.listMyAppReviews(this.token);
          const rows = Array.isArray(myReviews) ? myReviews : [];
          myReviewsHtml = rows.length
            ? `<h4 style="margin:16px 0 8px">My Reviews</h4>
              ${rows.map((r) => `<div class="checkout-card" style="margin-bottom:8px;padding:10px">
                <div>${'⭐'.repeat(Math.min(5, Number(r.rating) || 0))} <span class="muted" style="font-size:12px">${this.esc(String(r.created_at || '').slice(0, 10))}</span></div>
                <p style="margin:6px 0 0">${this.esc(r.review_text || '')}</p>
                ${r.admin_reply ? `<p class="muted" style="margin:8px 0 0;font-size:12px"><strong>Shop reply:</strong> ${this.esc(r.admin_reply)}</p>` : ''}
              </div>`).join('')}`
            : '';
        } catch (_) { /* */ }
        card.innerHTML = `<h3>Notification Preferences</h3>
          <p class="muted" style="font-size:12px;margin:0 0 4px">App Notifications</p>
          <p class="muted" style="font-size:12px">WhatsApp, SMS, and email stay under Communication consent — these toggles are app-only.</p>
          ${PREF_KEYS.map(([k, label]) => {
            const on = prefs?.[k] !== 0 && prefs?.[k] !== false;
            return `<div class="pref-row" style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border,#e2e8f0)">
              <span>${label}</span>
              <button type="button" class="btn-sm ${on ? 'pref-on' : ''}" data-act="app-pref-toggle" data-key="${k}" data-on="${on ? '1' : '0'}">${on ? 'ON' : 'OFF'}</button>
            </div>`;
          }).join('')}
          <button type="button" class="link-btn" style="margin-top:10px" data-act="app-inbox">Notification history →</button>
          <button type="button" class="link-btn" data-act="nav" data-view="promotions">Promotions →</button>
          ${myReviewsHtml}`;
        section.parentNode.insertBefore(card, section);
        this.bind();
      }
    }

    if (this.view === 'home' && !document.getElementById('app-home-promo-strip')) {
      try {
        const homePromos = await OrderAPI.listAppPromotions(this.branch?.id, 'home');
        const promos = Array.isArray(homePromos) ? homePromos : [];
        if (promos.length) {
          const page = document.querySelector('.page');
          const hero = page?.querySelector('.hero-card');
          if (page && hero) {
            const strip = document.createElement('div');
            strip.id = 'app-home-promo-strip';
            strip.className = 'checkout-card';
            strip.style.marginTop = '12px';
            strip.innerHTML = `<h3 style="margin:0 0 8px">🎯 Promotions</h3>
              <div style="display:flex;gap:10px;overflow-x:auto;padding-bottom:4px">
              ${promos.slice(0, 5).map((p) => `
                <div style="min-width:200px;flex:0 0 auto;border:1px solid var(--border,#e2e8f0);border-radius:10px;padding:10px">
                  ${p.image_url ? `<img src="${this.esc(p.image_url)}" alt="" style="width:100%;height:80px;object-fit:cover;border-radius:8px">` : ''}
                  <strong style="display:block;margin-top:6px">${this.esc(p.name)}</strong>
                  <button type="button" class="btn-primary btn-sm" style="margin-top:6px" data-act="app-inbox-open"
                    data-dest="${this.esc(p.destination_type || 'product')}" data-dest-id="${this.esc(p.destination_id || p.product_id || '')}"
                    data-url="${this.esc(p.destination_url || '')}">${this.esc(p.button_text || 'View')}</button>
                </div>`).join('')}
              </div>
              <button type="button" class="link-btn" style="margin-top:8px" data-act="nav" data-view="promotions">See all promotions →</button>`;
            hero.insertAdjacentElement('afterend', strip);
            this.bind();
          }
        }
      } catch (_) { /* optional promos */ }
    }

    if (this.view === 'home' && !document.getElementById('app-public-reviews')) {
      try {
        const pub = await OrderAPI.listPublicAppReviews(5);
        const reviews = Array.isArray(pub) ? pub : [];
        if (reviews.length) {
          const page = document.querySelector('.page');
          if (page) {
            const block = document.createElement('div');
            block.id = 'app-public-reviews';
            block.innerHTML = `<h2>Customer reviews</h2>
              ${reviews.map((r) => `<div class="checkout-card" style="margin-bottom:8px">
                <div>${'⭐'.repeat(Math.min(5, Number(r.rating) || 0))} · ${this.esc(r.customer_name || 'Customer')}</div>
                <p style="margin:6px 0">${this.esc(r.review_text || '')}</p>
                ${r.admin_reply ? `<p class="muted" style="font-size:12px"><strong>Shop:</strong> ${this.esc(r.admin_reply)}</p>` : ''}
                ${this.token ? `<button type="button" class="link-btn" data-act="app-report-review" data-review-id="${r.id}">Report review</button>` : ''}
              </div>`).join('')}`;
            page.appendChild(block);
            this.bind();
          }
        }
      } catch (_) { /* */ }
    }

    const reviewOrder = this.view === 'order-detail' ? this.selectedOrder : this.lastOrder;
    const reviewViewOk = (this.view === 'confirmed' || this.view === 'order-detail')
      && reviewOrder && this.token && !document.getElementById('app-review-box');
    if (reviewViewOk) {
      const st = String(reviewOrder.status || '').toLowerCase();
      const canReview = this.view === 'confirmed' || ['completed', 'delivered'].includes(st);
      if (!canReview) { /* skip */ } else {
      let alreadyReviewed = false;
      try {
        const mine = await OrderAPI.listMyAppReviews(this.token);
        alreadyReviewed = (Array.isArray(mine) ? mine : []).some((r) => String(r.order_id) === String(reviewOrder.id));
      } catch (_) { /* */ }
      if (!alreadyReviewed) {
      const page = this.view === 'order-detail'
        ? document.querySelector('.page')
        : document.querySelector('.page.confirmed');
      if (page) {
        const box = document.createElement('div');
        box.id = 'app-review-box';
        box.className = 'checkout-card';
        box.style.marginTop = '16px';
        box.innerHTML = `<h3>How was your order?</h3>
          <label class="muted">Rating</label>
          <select id="app-review-stars" style="width:100%;margin:4px 0 8px;padding:8px">
            <option value="5">⭐⭐⭐⭐⭐</option>
            <option value="4">⭐⭐⭐⭐</option>
            <option value="3">⭐⭐⭐</option>
            <option value="2">⭐⭐</option>
            <option value="1">⭐</option>
          </select>
          <div class="muted" style="margin-bottom:6px">What did you like?</div>
          ${['Food quality', 'Service', 'Delivery', 'Value for money'].map((l) =>
            `<label style="display:block;margin:4px 0"><input type="checkbox" data-liked value="${l}"> ${l}</label>`
          ).join('')}
          <textarea id="app-review-text" rows="2" placeholder="Write a review (optional)" style="width:100%;margin-top:8px;padding:8px"></textarea>
          <button type="button" class="btn-primary btn-block" style="margin-top:8px" data-act="app-submit-review" data-order-id="${reviewOrder.id}">Submit Review</button>`;
        page.appendChild(box);
        this.bind();
      }
      }
      }
    }
  };

  // Deep link from URL ?app_dest=product&app_id=123
  try {
    const u = new URL(location.href);
    const dest = u.searchParams.get('app_dest');
    const id = u.searchParams.get('app_id');
    if (dest) {
      sessionStorage.setItem('app_pending_deeplink', JSON.stringify({ destination_type: dest, destination_id: id, destination_url: u.searchParams.get('app_url') }));
    }
  } catch (_) { /* */ }

  const _boot = setInterval(() => {
    if (!window.OrderApp?.token) return;
    try {
      const raw = sessionStorage.getItem('app_pending_deeplink');
      if (!raw) return;
      sessionStorage.removeItem('app_pending_deeplink');
      const link = JSON.parse(raw);
      if (OrderApp.branch) OrderApp.openDeepLink(link);
    } catch (_) { /* */ }
  }, 800);
  setTimeout(() => clearInterval(_boot), 15000);
})();

/**
 * Phone-style notifications for Referral Agent + Referral Commission apps.
 * Uses PanelNotify (browser + Capacitor LocalNotifications) and PanelSound.
 * Rings until the user opens or dismisses each unread alert.
 */
window.ReferralNotify = {
  _timer: null,
  _panel: 'referral',
  _audience: 'agent',
  _actor: null,
  _seen: new Set(),
  _boundNative: false,

  init(opts = {}) {
    this._panel = opts.panel || 'referral';
    this._audience = opts.audience === 'admin' ? 'admin' : 'agent';
    this._actor = opts.actor || null;
    if (!window.PanelNotify) return;
    PanelNotify.init({
      panel: this._panel,
      loggedIn: () => !!this._actor,
      requestPermission: true,
      rpc: null
    });
    this._bindNativeActions();
    PanelNotify.requestPermission?.();
  },

  _bindNativeActions() {
    if (this._boundNative) return;
    const LN = window.Capacitor?.Plugins?.LocalNotifications;
    if (!LN?.addListener) return;
    this._boundNative = true;
    try {
      LN.addListener('localNotificationActionPerformed', (ev) => {
        const extra = ev?.notification?.extra || {};
        const id = Number(String(extra.eventKey || '').replace(/^ref_notif:/, ''));
        if (id) this.ack(id, 'opened', { openApp: true });
        try { window.focus(); } catch (_) { /* */ }
      });
      LN.addListener('localNotificationReceived', () => { /* tray shown */ });
    } catch (_) { /* ignore */ }
  },

  start(actor) {
    this._actor = actor || this._actor;
    this.stop();
    this.poll().catch(() => {});
    this._timer = setInterval(() => this.poll().catch(() => {}), 8000);
  },

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    window.PanelSound?.stop();
  },

  eventKey(n) {
    return `ref_notif:${n.id}`;
  },

  async poll() {
    if (!this._actor || !window.API?.referralUnreadNotifications) return;
    const res = await API.referralUnreadNotifications({ audience: this._audience }, this._actor);
    const rows = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
    const soundOn = window.PanelNotify?.isSoundEnabled(this._panel) !== false;
    PanelNotify?.syncPendingAlert(rows, (n) => this.eventKey(n), soundOn);

    for (const n of rows) {
      const key = this.eventKey(n);
      if (this._seen.has(key) || PanelNotify?.isAcked(key)) continue;
      this._seen.add(key);
      const title = n.title || (this._audience === 'admin' ? 'Referral Commission' : 'Referral Agent');
      const body = n.message || 'You have a new referral update';
      PanelNotify?.notifyPhone(title, body, key, {
        url: this._panel === 'referral-commission' ? '/referral-commission-app.html' : '/referral-app.html',
        eventKey: key
      });
      this._showInAppBanner(n);
    }

    // If nothing unread, clear banner
    if (!rows.length) this._hideInAppBanner();
  },

  _bannerId() {
    return `ref-notify-banner-${this._panel}`;
  },

  _showInAppBanner(n) {
    let el = document.getElementById(this._bannerId());
    if (!el) {
      el = document.createElement('div');
      el.id = this._bannerId();
      el.setAttribute('role', 'alert');
      el.style.cssText = 'position:fixed;left:12px;right:12px;top:12px;z-index:10050;max-width:480px;margin:0 auto;background:#0f2744;color:#e2e8f0;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.35);padding:14px 16px;font-family:system-ui,Segoe UI,sans-serif';
      document.body.appendChild(el);
    }
    el.innerHTML = `
      <div style="font-weight:800;font-size:15px;margin-bottom:4px">${this._esc(n.title || 'Notification')}</div>
      <div style="font-size:13px;color:#cbd5e1;line-height:1.4;margin-bottom:12px">${this._esc(n.message || '')}</div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button type="button" data-ref-dismiss="${n.id}" style="background:transparent;border:1px solid #64748b;color:#e2e8f0;border-radius:10px;padding:8px 14px;font-weight:700;cursor:pointer">Dismiss</button>
        <button type="button" data-ref-open="${n.id}" style="background:#0d9488;border:0;color:#fff;border-radius:10px;padding:8px 14px;font-weight:700;cursor:pointer">Open</button>
      </div>`;
    el.querySelector('[data-ref-dismiss]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.ack(Number(e.currentTarget.dataset.refDismiss), 'dismissed', { openApp: false });
    });
    el.querySelector('[data-ref-open]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.ack(Number(e.currentTarget.dataset.refOpen), 'opened', { openApp: true });
    });
    // Tap anywhere in banner (except dismiss) opens
    el.onclick = (e) => {
      if (e.target.closest('[data-ref-dismiss]')) return;
      this.ack(Number(n.id), 'opened', { openApp: true });
    };
  },

  _hideInAppBanner() {
    document.getElementById(this._bannerId())?.remove();
  },

  _esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  },

  async ack(id, ackType, opts = {}) {
    if (!id) return;
    const key = `ref_notif:${id}`;
    try { await PanelNotify?.ack(key, ackType || 'dismissed'); } catch (_) { /* */ }
    try {
      if (window.API?.referralAckNotification && this._actor) {
        await API.referralAckNotification(id, { ack_type: ackType || 'dismissed' }, this._actor);
      }
    } catch (_) { /* */ }
    this._seen.delete(key);
    this._hideInAppBanner();
    if (opts.openApp) {
      try {
        if (this._panel === 'referral' && window.ReferralAgentApp) {
          ReferralAgentApp.view = 'notifications';
          ReferralAgentApp.renderShell?.();
        } else if (this._panel === 'referral-commission' && window.AdminReferralPage) {
          /* stay on commission app — already open */
          try { window.focus(); } catch (_) { /* */ }
        } else {
          try { window.focus(); } catch (_) { /* */ }
        }
      } catch (_) { /* */ }
    }
    this.poll().catch(() => {});
  }
};

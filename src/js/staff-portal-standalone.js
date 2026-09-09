/** Standalone staff portal entry from login screen (no POS login required) */
const StaffPortalStandalone = {
  employee: null,
  step: 'login',

  async render(container, app) {
    this.container = container;
    this.app = app;
    if (this.step === 'login') return this.renderLogin();
    if (this.step === 'selfie') return this.renderSelfie();
    return this.renderPortal();
  },

  renderLogin() {
    const shop = this.app?.settings?.app_display_name || this.app?.settings?.shop_name || 'Staff Portal';
    const logo = this.app?.settings?.logo_path;
    this.container.innerHTML = `<div class="login-card" style="max-width:420px;margin:40px auto">
      <div class="login-logo" id="sp-login-logo">👷</div>
      <h1>${Utils.escHtml(shop)}</h1>
      <p class="login-sub">Employee Staff Portal</p>
      <p id="sp-login-err" class="error-msg hidden" style="margin-bottom:12px"></p>
      <div class="field"><label>Employee ID</label><input id="sp-code" placeholder="EMP0001" autofocus autocomplete="username"></div>
      <div class="field"><label>PIN</label><input type="password" id="sp-pin" maxlength="12" inputmode="numeric" autocomplete="current-password"></div>
      <button type="button" class="btn btn-primary btn-lg btn-block" id="sp-login">Sign In</button>
      <button type="button" class="btn btn-ghost btn-sm btn-block ${window.__SHOP_POS_APP_MODE__ === 'staff' ? 'hidden' : ''}" id="sp-back" style="margin-top:12px">← Back to POS Login</button>
    </div>`;
    document.getElementById('sp-back')?.addEventListener('click', () => {
      if (window.__SHOP_POS_APP_MODE__ === 'staff') return;
      App.closeStaffPortal();
    });
    document.getElementById('sp-login').addEventListener('click', () => this.doLogin());
    document.getElementById('sp-pin').addEventListener('keydown', (e) => { if (e.key === 'Enter') this.doLogin(); });
    if (logo) {
      API.getImageDataUrl(logo).then(img => {
        const el = document.getElementById('sp-login-logo');
        if (el && img?.success && (img.dataUrl || img.data)) {
          el.innerHTML = `<img src="${img.dataUrl || img.data}" alt="" class="brand-logo-img">`;
        }
      }).catch(() => {});
    }
  },

  async doLogin() {
    const code = document.getElementById('sp-code').value.trim();
    const pin = document.getElementById('sp-pin').value.trim();
    const errEl = document.getElementById('sp-login-err');
    const btn = document.getElementById('sp-login');
    if (!code || !pin) {
      if (errEl) { errEl.textContent = 'Employee ID and PIN required'; errEl.classList.remove('hidden'); }
      return;
    }
    if (btn) { btn.disabled = true; btn.textContent = 'Signing in…'; }
    if (errEl) errEl.classList.add('hidden');
    const r = await API.staffLogin(code, pin);
    if (btn) { btn.disabled = false; btn.textContent = 'Sign In'; }
    if (!r.success) {
      const msg = r.error || 'Wrong PIN or employee ID';
      if (errEl) { errEl.textContent = /pin|password|invalid|incorrect/i.test(msg) ? msg : 'Wrong PIN or employee ID — please try again'; errEl.classList.remove('hidden'); }
      return;
    }
    this.employee = r.data;
    this.employeePin = pin;
    this.step = window.StaffSelfieCapture?.selfieRequired?.() ? 'selfie' : 'portal';
    this.render(this.container, this.app);
  },

  renderSelfie() {
    try {
      App?.showScreen?.('staff-portal');
      document.getElementById('screen-staff-portal')?.classList.remove('hidden');
    } catch (_) { /* ignore */ }
    if (!window.StaffSelfieCapture?.render) {
      this.container.innerHTML = `<div class="login-card" style="max-width:420px;margin:40px auto;text-align:center">
        <p class="error-msg">Camera screen failed to load.</p>
        <p class="muted">Login selfie is required. Retry after the camera script loads.</p>
        <button type="button" class="btn btn-primary" id="sp-selfie-retry">Retry camera</button>
        <button type="button" class="btn btn-ghost" id="sp-selfie-back" style="margin-top:8px">Back</button>
      </div>`;
      document.getElementById('sp-selfie-retry')?.addEventListener('click', () => {
        this.render(this.container, this.app);
      });
      document.getElementById('sp-selfie-back')?.addEventListener('click', () => {
        this.step = 'login';
        this.render(this.container, this.app);
      });
      return;
    }
    StaffSelfieCapture.render(this.container, this.employee, (emp) => {
      this.employee = emp;
      this.employeePin = null;
      this.step = 'portal';
      this.render(this.container, this.app);
    }, { pin: this.employeePin });
  },

  async goLogin() {
    window.PanelNotifyHub?.stop('staff');
    try { await API.staffLogout?.(); } catch (_) { /* ignore */ }
    this.employee = null;
    this.employeePin = null;
    this.step = 'login';
    StaffSelfieCapture?.stopCamera?.();
    if (this.container) this.render(this.container, this.app);
  },

  async renderPortal() {
    try {
      App?.showScreen?.('staff-portal');
      document.getElementById('screen-staff-portal')?.classList.remove('hidden');
    } catch (_) { /* ignore */ }

    if (!window.StaffPage?.renderWorkerPanel && typeof App?.ensurePageScripts === 'function') {
      try {
        await App.ensurePageScripts('staff');
      } catch (err) {
        console.error('[StaffPortal] module load failed', err?.message || err);
      }
    }

    this.container.innerHTML = `<div class="staff-portal-shell">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px">
        <h2 style="margin:0">👷 Staff Portal</h2>
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          ${window.PanelNotify ? PanelNotify.soundToggleHtml('staff', { id: 'sp-notify-sound', label: 'Alerts' }) : ''}
          <button type="button" class="btn btn-ghost btn-sm" id="sp-exit">Exit Portal</button>
        </div>
      </div>
      <div id="sp-portal-root"><p class="muted">Loading your portal…</p></div>
    </div>`;
    const spNotify = document.getElementById('sp-notify-sound');
    if (spNotify && window.PanelNotify) PanelNotify.bindSoundToggle(spNotify, 'staff');
    document.getElementById('sp-exit')?.addEventListener('click', async () => {
      StaffSelfieCapture?.stopCamera?.();
      try { await API.staffLogout?.(); } catch (_) { /* ignore */ }
      this.employee = null;
      this.employeePin = null;
      this.step = 'login';
      App.closeStaffPortal();
    });
    const inner = document.getElementById('sp-portal-root');
    const page = window.StaffPage;
    if (!page?.renderWorkerPanel) {
      inner.innerHTML = `<div class="card" style="padding:20px">
        <p class="error-msg">Staff portal modules failed to load. Tap Retry.</p>
        <button type="button" class="btn btn-primary" id="sp-retry-portal">Retry</button>
        <button type="button" class="btn btn-ghost" id="sp-back-login" style="margin-left:8px">Back to login</button>
      </div>`;
      document.getElementById('sp-retry-portal')?.addEventListener('click', async () => {
        try { await App.ensurePageScripts('staff'); } catch (_) { /* ignore */ }
        this.renderPortal();
      });
      document.getElementById('sp-back-login')?.addEventListener('click', () => this.goLogin());
      return;
    }
    page.app = this.app;
    page.el = inner;
    page.unlocked = true;
    page.employee = this.employee;
    page.employeePin = null;
    page._standalone = true;
    page.onStandaloneLogout = () => this.goLogin();
    const watchdog = setTimeout(() => {
      if (!inner || !inner.isConnected) return;
      // Only show timeout if clock never appeared
      if (!inner.querySelector('[data-clock]')) {
        inner.innerHTML = `<div class="card" style="padding:20px">
          <p class="error-msg">Staff portal is taking too long. Retry.</p>
          <button type="button" class="btn btn-primary" id="sp-retry-portal">Retry</button>
          <button type="button" class="btn btn-ghost" id="sp-back-login" style="margin-left:8px">Back to login</button>
        </div>`;
        document.getElementById('sp-retry-portal')?.addEventListener('click', () => this.renderPortal());
        document.getElementById('sp-back-login')?.addEventListener('click', () => this.goLogin());
      }
    }, 20000);
    try {
      await page.renderWorkerPanel(inner);
      clearTimeout(watchdog);
      if (window.PanelNotifyHub && this.employee?.id) {
        PanelNotifyHub.initPanel('staff', () => !!this.employee);
        PanelNotifyHub.startPoll(
          'staff',
          () => PanelNotifyHub.pollStaff(this.employee.id, page.hrActor?.(this.employee) || this.app?.user),
          25000
        );
      }
    } catch (err) {
      clearTimeout(watchdog);
      // Never wipe a working clock shell — secondary sections can fail independently
      if (inner.querySelector('[data-clock]')) {
        const secondary = inner.querySelector('#staff-portal-secondary');
        if (secondary) {
          secondary.innerHTML = `<div class="card" style="padding:16px;margin-top:12px">
            <p class="error-msg">${Utils.escHtml(err.message || 'Some portal sections failed to load')}</p>
            <button type="button" class="btn btn-primary" id="sp-retry-portal">Retry sections</button>
          </div>`;
          document.getElementById('sp-retry-portal')?.addEventListener('click', () => this.renderPortal());
        }
        console.error('[StaffPortal] phase error after clock', err);
        return;
      }
      inner.innerHTML = `<div class="card" style="padding:20px">
        <p class="error-msg">${Utils.escHtml(err.message || 'Could not open staff portal')}</p>
        <button type="button" class="btn btn-primary" id="sp-retry-portal">Retry</button>
        <button type="button" class="btn btn-ghost" id="sp-back-login" style="margin-left:8px">Back to login</button>
      </div>`;
      document.getElementById('sp-retry-portal')?.addEventListener('click', () => this.renderPortal());
      document.getElementById('sp-back-login')?.addEventListener('click', () => this.goLogin());
    }
  }
};

window.StaffPortalStandalone = StaffPortalStandalone;

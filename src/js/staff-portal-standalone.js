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
      <h1>${shop}</h1>
      <p class="login-sub">Employee Staff Portal</p>
      <div class="field"><label>Employee ID</label><input id="sp-code" placeholder="EMP0001" autofocus></div>
      <div class="field"><label>PIN</label><input type="password" id="sp-pin" maxlength="6" inputmode="numeric"></div>
      <button type="button" class="btn btn-primary btn-lg btn-block" id="sp-login">Sign In</button>
      <button type="button" class="btn btn-ghost btn-sm btn-block" id="sp-back" style="margin-top:12px">← Back to POS Login</button>
    </div>`;
    document.getElementById('sp-back').addEventListener('click', () => App.closeStaffPortal());
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
    if (!code || !pin) return Utils.toast('Employee ID and PIN required', 'error');
    const r = await API.staffLogin(code, pin);
    if (!r.success) return Utils.toast(r.error || 'Login failed', 'error');
    this.employee = r.data;
    this.employeePin = pin;
    this.step = 'selfie';
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
        <button type="button" class="btn btn-primary" id="sp-selfie-skip">Continue without selfie</button>
        <button type="button" class="btn btn-ghost" id="sp-selfie-back" style="margin-top:8px">Back</button>
      </div>`;
      document.getElementById('sp-selfie-skip')?.addEventListener('click', () => {
        this.step = 'portal';
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
      this.step = 'portal';
      this.render(this.container, this.app);
    });
  },

  async renderPortal() {
    try {
      App?.showScreen?.('staff-portal');
      document.getElementById('screen-staff-portal')?.classList.remove('hidden');
    } catch (_) { /* ignore */ }

    // Ensure StaffPage is loaded (Android core bundle does not include page scripts)
    if (!window.StaffPage?.renderWorkerPanel && typeof App?.ensurePageScripts === 'function') {
      try { await App.ensurePageScripts('staff'); } catch (_) { /* ignore */ }
    }

    this.container.innerHTML = `<div style="max-width:960px;margin:0 auto;padding:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px">
        <h2 style="margin:0">👷 Staff Portal</h2>
        <button type="button" class="btn btn-ghost btn-sm" id="sp-exit">Exit Portal</button>
      </div>
      <div id="sp-portal-root"><p class="muted">Loading your portal…</p></div>
    </div>`;
    document.getElementById('sp-exit')?.addEventListener('click', () => {
      this.employee = null;
      this.step = 'login';
      StaffSelfieCapture?.stopCamera?.();
      App.closeStaffPortal();
    });
    const inner = document.getElementById('sp-portal-root');
    const page = window.StaffPage;
    if (!page?.renderWorkerPanel) {
      inner.innerHTML = `<div class="card" style="padding:20px">
        <p class="error-msg">Staff portal modules are not loaded. Close and open Staff Portal again.</p>
        <button type="button" class="btn btn-primary" id="sp-retry-portal">Retry</button>
        <button type="button" class="btn btn-ghost" id="sp-back-login" style="margin-left:8px">Back to login</button>
      </div>`;
      document.getElementById('sp-retry-portal')?.addEventListener('click', () => this.renderPortal());
      document.getElementById('sp-back-login')?.addEventListener('click', () => {
        this.step = 'login';
        this.render(this.container, this.app);
      });
      return;
    }
    page.app = this.app;
    page.el = inner;
    page.unlocked = true;
    page.employee = this.employee;
    page.employeePin = this.employeePin;
    try {
      await Promise.race([
        page.renderWorkerPanel(inner),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Portal is taking too long — tap Retry')), 20000))
      ]);
    } catch (err) {
      inner.innerHTML = `<div class="card" style="padding:20px">
        <p class="error-msg">${err.message || 'Could not open staff portal'}</p>
        <button type="button" class="btn btn-primary" id="sp-retry-portal">Retry</button>
        <button type="button" class="btn btn-ghost" id="sp-back-login" style="margin-left:8px">Back to login</button>
      </div>`;
      document.getElementById('sp-retry-portal')?.addEventListener('click', () => this.renderPortal());
      document.getElementById('sp-back-login')?.addEventListener('click', () => {
        this.step = 'login';
        this.render(this.container, this.app);
      });
      return;
    }
    const logoutBtn = inner.querySelector('#staff-logout-worker');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => {
        page.employee = null;
        page.employeePin = null;
        this.employee = null;
        this.employeePin = null;
        this.step = 'login';
        StaffSelfieCapture?.stopCamera?.();
        this.render(this.container, this.app);
      }, { once: true });
    }
  }
};

window.StaffPortalStandalone = StaffPortalStandalone;

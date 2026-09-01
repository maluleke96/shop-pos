/** Login gate for standalone kitchen / customer displays (cloud + direct URL). */
const DisplayAuth = {
  async waitForApi(maxMs = 8000) {
    if (window.posAPI) return true;
    return new Promise((resolve) => {
      const done = () => resolve(!!window.posAPI);
      window.addEventListener('posAPIReady', done, { once: true });
      setTimeout(() => resolve(!!window.posAPI), maxMs);
    });
  },

  async trySession() {
    try {
      if (window.parent !== window) {
        try {
          if (window.parent.App?.user) {
            window.App = window.App || {};
            window.App.user = window.parent.App.user;
            return window.parent.App.user;
          }
        } catch (_) { /* cross-origin */ }
      }
      if (!window.API?.getSession) return null;
      const r = await API.getSession();
      const user = r?.user || r?.data?.user;
      if (user && r?.success !== false) {
        window.App = window.App || {};
        window.App.user = user;
        return user;
      }
    } catch (_) { /* ignore */ }
    return null;
  },

  showLogin(title, onSuccess) {
    const existing = document.getElementById('display-auth-overlay');
    if (existing) existing.remove();
    const overlay = document.createElement('div');
    overlay.id = 'display-auth-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:#0f172a;z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px';
    overlay.innerHTML = `<form class="auth-card" style="background:#1e293b;padding:28px;border-radius:14px;max-width:380px;width:100%;color:#f8fafc" onsubmit="return false">
      <h2 style="margin:0 0 8px">${title || 'Sign in'}</h2>
      <p style="color:#94a3b8;font-size:14px;margin:0 0 16px">Staff login required to open this screen.</p>
      <label style="display:block;margin-bottom:12px;font-size:13px">Username<input id="da-user" autocomplete="username" required style="width:100%;margin-top:6px;padding:10px;border-radius:8px;border:1px solid #334155;background:#0f172a;color:#fff"></label>
      <label style="display:block;margin-bottom:16px;font-size:13px">Password<input type="password" id="da-pass" autocomplete="current-password" required style="width:100%;margin-top:6px;padding:10px;border-radius:8px;border:1px solid #334155;background:#0f172a;color:#fff"></label>
      <button type="button" id="da-submit" class="btn" style="width:100%;padding:12px;border:none;border-radius:8px;background:#3b82f6;color:#fff;font-weight:700;cursor:pointer">Sign in</button>
      <p id="da-error" style="color:#f87171;font-size:13px;margin:12px 0 0;display:none"></p>
    </form>`;
    document.body.appendChild(overlay);
    const submit = async () => {
      const errEl = document.getElementById('da-error');
      const btn = document.getElementById('da-submit');
      const username = document.getElementById('da-user')?.value?.trim();
      const password = document.getElementById('da-pass')?.value || '';
      if (!username || !password) return;
      btn.disabled = true;
      errEl.style.display = 'none';
      try {
        const r = await API.login(username, password);
        if (r?.success === false || r?.error) throw new Error(r.error || 'Login failed');
        const user = r.user || r.data?.user;
        if (!user) throw new Error('Login failed');
        window.App = window.App || {};
        window.App.user = user;
        overlay.remove();
        onSuccess(user);
      } catch (err) {
        errEl.textContent = err.message || 'Login failed';
        errEl.style.display = 'block';
      } finally {
        btn.disabled = false;
      }
    };
    document.getElementById('da-submit')?.addEventListener('click', submit);
    document.getElementById('da-pass')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    document.getElementById('da-user')?.focus();
  },

  async requireSession(title) {
    await this.waitForApi();
    const user = await this.trySession();
    if (user) return user;
    return new Promise((resolve) => {
      this.showLogin(title, (u) => resolve(u));
    });
  }
};

window.DisplayAuth = DisplayAuth;

const InvestorApp = {
  view: 'login',
  dash: null,

  esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; },
  money(n) { return `R${(Number(n) || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2 })}`; },
  toast(msg, type) {
    const el = document.createElement('div');
    el.className = `toast ${type === 'error' ? 'error' : ''}`;
    el.textContent = msg;
    document.getElementById('toast-root').appendChild(el);
    setTimeout(() => el.remove(), 3500);
  },

  async init() {
    const tok = localStorage.getItem('investor_token');
    if (tok) {
      try {
        this.dash = await InvestorAPI.dashboard();
        this.view = 'main';
      } catch (_) {
        localStorage.removeItem('investor_token');
        this.view = 'login';
      }
    }
    this.render();
  },

  async refresh() {
    this.dash = await InvestorAPI.dashboard();
    this.render();
  },

  render() {
    const app = document.getElementById('app');
    if (this.view === 'login') {
      app.innerHTML = `<div class="portal-card">
        <h1>Investor Portal</h1>
        <p class="muted">Secure access to your investment information only.</p>
        <label>Username<input id="inv-user" autocomplete="username"></label>
        <label>Password<input id="inv-pass" type="password" autocomplete="current-password"></label>
        <button class="btn" data-act="login">Sign in</button>
      </div>`;
    } else {
      const inv = this.dash?.investor || {};
      const agreements = this.dash?.agreements || [];
      const payments = this.dash?.payments || [];
      const distributions = this.dash?.distributions || [];
      const docs = this.dash?.documents || [];
      const announcements = this.dash?.announcements || [];
      app.innerHTML = `<div class="portal-card">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">
          <div><h1>${this.esc(inv.name)}</h1><p class="muted">${this.esc(inv.company || '')}</p></div>
          <button class="btn secondary" data-act="logout">Logout</button>
        </div>
        <div class="stat-grid">
          <div class="stat"><span class="muted">Investment</span><b>${this.money(inv.investment_amount)}</b></div>
          <div class="stat"><span class="muted">Equity</span><b>${Number(inv.equity_percent || 0)}%</b></div>
          <div class="stat"><span class="muted">Status</span><b>${this.esc(inv.status)}</b></div>
        </div>
      </div>
      ${announcements.length ? `<div class="portal-card"><h2>Announcements</h2>${announcements.map((a) => `<p><strong>${this.esc(a.title)}</strong><br>${this.esc(a.body)}</p>`).join('')}</div>` : ''}
      <div class="portal-card"><h2>Agreements</h2>
        ${agreements.length ? `<table class="table"><thead><tr><th>Title</th><th>Status</th></tr></thead><tbody>
          ${agreements.map((a) => `<tr><td>${this.esc(a.title)}</td><td><span class="badge">${this.esc(a.status)}</span></td></tr>`).join('')}
        </tbody></table>` : '<p class="muted">No agreements on file.</p>'}
      </div>
      <div class="portal-card"><h2>Payment history</h2>
        ${payments.length ? `<table class="table"><thead><tr><th>Date</th><th>Amount</th><th>Type</th></tr></thead><tbody>
          ${payments.map((p) => `<tr><td>${this.esc(p.paid_at || p.created_at)}</td><td>${this.money(p.amount)}</td><td>${this.esc(p.payment_type)}</td></tr>`).join('')}
        </tbody></table>` : '<p class="muted">No payments recorded.</p>'}
      </div>
      <div class="portal-card"><h2>Distributions / returns</h2>
        ${distributions.length ? `<table class="table"><thead><tr><th>Date</th><th>Amount</th></tr></thead><tbody>
          ${distributions.map((d) => `<tr><td>${this.esc(d.paid_at || d.created_at)}</td><td>${this.money(d.amount)}</td></tr>`).join('')}
        </tbody></table>` : '<p class="muted">No distributions yet.</p>'}
      </div>
      <div class="portal-card"><h2>Documents</h2>
        ${docs.length ? `<ul>${docs.map((d) => `<li>${this.esc(d.title)} (${this.esc(d.doc_type)})</li>`).join('')}</ul>` : '<p class="muted">No documents uploaded.</p>'}
      </div>`;
    }
    this.bind();
  },

  bind() {
    document.getElementById('app').onclick = async (e) => {
      const act = e.target.closest('[data-act]')?.dataset?.act;
      if (act === 'login') {
        try {
          const r = await InvestorAPI.login(document.getElementById('inv-user').value.trim(), document.getElementById('inv-pass').value);
          localStorage.setItem('investor_token', r.token);
          await this.refresh();
          this.view = 'main';
          this.render();
        } catch (err) { this.toast(err.message, 'error'); }
      }
      if (act === 'logout') {
        await InvestorAPI.logout().catch(() => {});
        localStorage.removeItem('investor_token');
        this.view = 'login';
        this.render();
      }
    };
  }
};
InvestorApp.init();

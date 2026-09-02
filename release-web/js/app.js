const ReleaseApp = {
  view: 'login',
  user: null,
  dash: null,
  lastTest: null,
  running: false,

  esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; },
  toast(msg, type) {
    const el = document.createElement('div');
    el.className = `toast ${type === 'error' ? 'error' : ''}`;
    el.textContent = msg;
    document.getElementById('toast-root').appendChild(el);
    setTimeout(() => el.remove(), 4000);
  },

  async init() {
    const tok = localStorage.getItem('release_token');
    if (tok) {
      try {
        this.dash = await ReleaseAPI.dashboard();
        this.user = JSON.parse(localStorage.getItem('release_user') || '{}');
        this.view = 'main';
      } catch (_) {
        localStorage.removeItem('release_token');
        localStorage.removeItem('release_user');
        this.view = 'login';
      }
    }
    this.render();
  },

  async refresh() {
    this.dash = await ReleaseAPI.dashboard();
    this.render();
  },

  render() {
    const app = document.getElementById('app');
    if (this.view === 'login') {
      app.innerHTML = `<div class="portal-card">
        <h1>App Release Centre</h1>
        <p class="muted">DEVELOPMENT → PREVIEW → TEST → APPROVE → PUBLISH → LIVE</p>
        <label>Username<input id="rel-user"></label>
        <label>Password<input id="rel-pass" type="password"></label>
        <button class="btn" data-act="login">Sign in</button>
      </div>`;
    } else {
      const d = this.dash || {};
      const perms = this.user?.permissions || {};
      const lastRun = d.last_test;
      const versions = d.recent_versions || [];
      app.innerHTML = `<div class="portal-card">
        <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px">
          <div><h1>Release Centre</h1><p class="muted">${this.esc(this.user?.full_name || this.user?.username)} · ${this.esc(this.user?.role)}</p></div>
          <button class="btn secondary" data-act="logout">Logout</button>
        </div>
        <div class="stat-grid">
          <div class="stat"><span class="muted">Current version</span><b>${this.esc(d.current_version || '—')}</b></div>
          <div class="stat"><span class="muted">Last test</span><b>${lastRun ? `${lastRun.passed}P / ${lastRun.failed}F` : '—'}</b></div>
        </div>
        ${d.preview_url ? `<p class="muted">Preview: <a href="${this.esc(d.preview_url)}" target="_blank" rel="noopener">${this.esc(d.preview_url)}</a></p>` : ''}
      </div>
      <div class="portal-card">
        <h2>Run system tests</h2>
        <p class="muted">Runs real health checks against database, auth, products, stock, sales, accounting, and more.</p>
        <button class="btn" data-act="run-tests" ${!perms.run_tests || this.running ? 'disabled' : ''}>${this.running ? 'Running…' : 'RUN FULL SYSTEM TEST'}</button>
        ${this.lastTest ? `<div style="margin-top:16px">
          <p><strong>${this.lastTest.total}</strong> tests · <span class="badge pass">${this.lastTest.passed} PASS</span>
          <span class="badge fail">${this.lastTest.failed} FAIL</span> <span class="badge warn">${this.lastTest.warnings} WARN</span>
          · ${this.lastTest.duration_ms}ms · ${this.esc(this.lastTest.tested_at || '')}</p>
          ${(this.lastTest.results || []).map((r) => `<div class="release-test-row ${r.status.toLowerCase()}"><span>${this.esc(r.test_label)}</span><span class="status">${r.status} — ${this.esc(r.message || '')}</span></div>`).join('')}
        </div>` : ''}
      </div>
      <div class="portal-card">
        <h2>Releases</h2>
        <button class="btn secondary" data-act="new-version">New version</button>
        <table class="table" style="margin-top:12px"><thead><tr><th>Version</th><th>Name</th><th>Approval</th><th>Published</th><th></th></tr></thead>
        <tbody>${versions.map((v) => `<tr>
          <td>${this.esc(v.version_number)}</td><td>${this.esc(v.release_name || '—')}</td>
          <td>${this.esc(v.approval_status || 'pending')}</td><td>${this.esc(v.published_status || '—')}</td>
          <td>
            ${perms.approve && v.approval_status !== 'approved' ? `<button class="btn secondary" data-act="approve" data-id="${v.id}" data-ver="${this.esc(v.version_number)}">Approve</button>` : ''}
            ${perms.publish && v.approval_status === 'approved' && v.published_status !== 'published' ? `<button class="btn warn" data-act="publish" data-id="${v.id}" data-ver="${this.esc(v.version_number)}">Publish</button>` : ''}
          </td>
        </tr>`).join('') || '<tr><td colspan="5" class="muted">No versions yet</td></tr>'}
        </tbody></table>
      </div>
      <div class="banner info">Publishing updates deploy-version.txt and logs deployment. Railway deploy must be triggered separately (railway up or CI).</div>`;
    }
    this.bind();
  },

  bind() {
    document.getElementById('app').onclick = async (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'login') {
        try {
          const r = await ReleaseAPI.login(document.getElementById('rel-user').value.trim(), document.getElementById('rel-pass').value);
          localStorage.setItem('release_token', r.token);
          localStorage.setItem('release_user', JSON.stringify(r.user));
          this.user = r.user;
          await this.refresh();
          this.view = 'main';
          this.render();
        } catch (err) { this.toast(err.message, 'error'); }
      }
      if (act === 'logout') {
        await ReleaseAPI.logout().catch(() => {});
        localStorage.removeItem('release_token');
        localStorage.removeItem('release_user');
        this.view = 'login';
        this.render();
      }
      if (act === 'run-tests') {
        this.running = true;
        this.render();
        try {
          this.lastTest = await ReleaseAPI.runTests();
          this.toast(`Tests complete: ${this.lastTest.passed} passed, ${this.lastTest.failed} failed`, this.lastTest.failed ? 'error' : 'success');
          await this.refresh();
        } catch (err) { this.toast(err.message, 'error'); }
        this.running = false;
        this.render();
      }
      if (act === 'new-version') {
        const version_number = prompt('Version number (e.g. 2.7.4):');
        if (!version_number) return;
        const release_name = prompt('Release name:') || '';
        const changes = (prompt('Changes (comma-separated):') || '').split(',').map((s) => s.trim()).filter(Boolean);
        try {
          await ReleaseAPI.createVersion({ version_number, release_name, changes });
          this.toast('Version created', 'success');
          await this.refresh();
        } catch (err) { this.toast(err.message, 'error'); }
      }
      if (act === 'approve') {
        const ver = btn.dataset.ver;
        if (!confirm(`Approve release version ${ver}?`)) return;
        try {
          await ReleaseAPI.approve(Number(btn.dataset.id), true);
          this.toast('Release approved', 'success');
          await this.refresh();
        } catch (err) { this.toast(err.message, 'error'); }
      }
      if (act === 'publish') {
        const ver = btn.dataset.ver;
        if (!confirm(`Are you sure you want to publish version ${ver} to production?`)) return;
        try {
          const r = await ReleaseAPI.publish(Number(btn.dataset.id), true);
          this.toast(r.note || r.log || 'Published', r.success ? 'success' : 'error');
          await this.refresh();
        } catch (err) { this.toast(err.message, 'error'); }
      }
    };
  }
};
ReleaseApp.init();

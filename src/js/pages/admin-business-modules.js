/** Business Modules — Admin Panel (Investor, Release, Meeting) */
window.AdminBusinessModulesPage = {
  tab: 'overview',
  summary: null,
  settings: null,
  investors: [],
  releaseUsers: [],
  meetingUsers: [],
  actor: null,

  async render(el, admin) {
    this.el = el;
    this.admin = admin;
    this.actor = admin?.app?.user || admin?.user;
    el.innerHTML = `<div class="admin-section">
      <h2>🏢 Business Modules</h2>
      <p class="muted">Central control for Investor Management, App Release Centre, and AI Meeting Centre. Each module has its own login portal.</p>
      <div class="admin-tabs" id="bm-tabs">
        ${['overview', 'investors', 'release-users', 'meeting-users'].map((t) =>
          `<button class="admin-tab ${this.tab === t ? 'active' : ''}" data-tab="${t}">${this.tabLabel(t)}</button>`).join('')}
      </div>
      <div id="bm-body"><p class="muted">Loading…</p></div>
    </div>`;
    el.querySelector('#bm-tabs').onclick = (e) => {
      const b = e.target.closest('[data-tab]');
      if (!b) return;
      this.tab = b.dataset.tab;
      el.querySelectorAll('.admin-tab').forEach((x) => x.classList.toggle('active', x.dataset.tab === this.tab));
      this.renderTab();
    };
    await this.load();
    this.renderTab();
  },

  tabLabel(t) {
    return { overview: 'Overview', investors: 'Investors', 'release-users': 'Release Users', 'meeting-users': 'Meeting Users' }[t] || t;
  },

  esc(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  },

  money(n) { return Utils.formatMoney(n); },

  async load() {
    try {
      const [sum, settings, investors, relUsers, mtgUsers] = await Promise.all([
        API.bizModulesSummary(this.actor),
        API.getBizModuleSettings(this.actor),
        API.listInvestors({}, this.actor),
        API.listReleaseUsers(this.actor),
        API.listMeetingUsers(this.actor)
      ]);
      this.summary = sum?.data || sum;
      this.settings = settings?.data || settings;
      this.investors = investors?.data || investors || [];
      this.releaseUsers = relUsers?.data || relUsers || [];
      this.meetingUsers = mtgUsers?.data || mtgUsers || [];
    } catch (e) {
      Utils.toast(e.message || 'Failed to load business modules', 'error');
    }
  },

  renderTab() {
    const body = this.el.querySelector('#bm-body');
    if (this.tab === 'overview') return this.renderOverview(body);
    if (this.tab === 'investors') return this.renderInvestors(body);
    if (this.tab === 'release-users') return this.renderReleaseUsers(body);
    if (this.tab === 'meeting-users') return this.renderMeetingUsers(body);
  },

  renderOverview(body) {
    const s = this.summary || {};
    const inv = s.investor || {};
    const rel = s.release || {};
    const mtg = s.meeting || {};
    const sig = s.signage || {};
    const cfg = this.settings || s.settings || {};
    body.innerHTML = `
      <div class="stats-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin:16px 0">
        <div class="card card-body" style="cursor:pointer" data-open="/investor/">
          <h4>Investor Management</h4>
          <p><strong>${inv.active_investors || 0}</strong> active investors</p>
          <p class="muted">${inv.pending_agreements || 0} pending agreements</p>
          <a href="/investor/" target="_blank" rel="noopener" class="btn btn-ghost" style="margin-top:8px">Open Investor Portal</a>
        </div>
        <div class="card card-body" style="cursor:pointer" data-open="/release/">
          <h4>App Release Centre</h4>
          <p>Version <strong>${this.esc(rel.current_version || '—')}</strong></p>
          <p class="muted">Last test: ${this.esc(rel.last_test_status || 'NOT_TESTED')}</p>
          <a href="/release/" target="_blank" rel="noopener" class="btn btn-ghost" style="margin-top:8px">Open Release Centre</a>
        </div>
        <div class="card card-body" style="cursor:pointer" data-open="/meeting/">
          <h4>AI Meeting Centre</h4>
          <p><strong>${mtg.meetings_this_month || 0}</strong> meetings this month</p>
          <p class="muted">${mtg.outstanding_action_items || 0} outstanding action items</p>
          <a href="/meeting/" target="_blank" rel="noopener" class="btn btn-ghost" style="margin-top:8px">Open Meeting Centre</a>
        </div>
        <div class="card card-body">
          <h4>Digital Signage</h4>
          <p><strong>${sig.online_screens || 0}</strong> / ${sig.total_screens || 0} screens online</p>
          <p class="muted">Last pub: ${this.esc(sig.last_publication?.name || '—')}</p>
          <a href="/signage/" target="_blank" rel="noopener" class="btn btn-ghost" style="margin-top:8px">Open Signage Centre</a>
          <a href="/signage-player/" target="_blank" rel="noopener" class="btn btn-ghost" style="margin-top:4px">TV Player</a>
        </div>
      </div>
      <div class="card"><div class="card-body">
        <h4>Module settings</h4>
        <form id="bm-settings-form" style="display:grid;gap:12px;max-width:480px">
          <label><input type="checkbox" name="investor_enabled" ${cfg.investor_enabled !== 0 ? 'checked' : ''}> Investor Management enabled</label>
          <label><input type="checkbox" name="release_enabled" ${cfg.release_enabled !== 0 ? 'checked' : ''}> App Release Centre enabled</label>
          <label><input type="checkbox" name="meeting_enabled" ${cfg.meeting_enabled !== 0 ? 'checked' : ''}> AI Meeting Centre enabled</label>
          <div class="field"><label>Release preview URL</label><input name="release_preview_url" value="${this.esc(cfg.release_preview_url || '')}" placeholder="https://staging.example.com"></div>
          <div class="field"><label>Meeting retention (days)</label><input type="number" name="meeting_retention_days" value="${cfg.meeting_retention_days || 365}"></div>
          <button type="submit" class="btn btn-primary">Save settings</button>
        </form>
        <p class="muted" style="margin-top:12px">AI transcription requires <code>SHOP_POS_AI_API_KEY</code> or <code>OPENAI_API_KEY</code> on the server. Video conferencing is not yet implemented (WebRTC signaling required).</p>
      </div></div>`;
    body.querySelector('#bm-settings-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await API.saveBizModuleSettings({
          investor_enabled: fd.get('investor_enabled') ? 1 : 0,
          release_enabled: fd.get('release_enabled') ? 1 : 0,
          meeting_enabled: fd.get('meeting_enabled') ? 1 : 0,
          release_preview_url: fd.get('release_preview_url') || null,
          meeting_retention_days: Number(fd.get('meeting_retention_days')) || 365
        }, this.actor);
        Utils.toast('Settings saved', 'success');
        await this.load();
      } catch (err) { Utils.toast(err.message, 'error'); }
    });
  },

  renderInvestors(body) {
    body.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin:12px 0">
        <h3>Investors</h3>
        <button class="btn btn-primary" id="bm-add-investor">Add investor</button>
      </div>
      <div class="table-wrap"><table><thead><tr><th>Name</th><th>Company</th><th>Investment</th><th>Equity %</th><th>Status</th><th></th></tr></thead>
        <tbody>${(this.investors || []).map((i) => `<tr>
          <td>${this.esc(i.name)}</td><td>${this.esc(i.company || '—')}</td>
          <td>${this.money(i.investment_amount)}</td><td>${Number(i.equity_percent || 0)}%</td>
          <td><span class="badge">${this.esc(i.status)}</span></td>
          <td><button class="btn btn-ghost btn-sm" data-inv="${i.id}">View</button></td>
        </tr>`).join('') || '<tr><td colspan="6" class="muted">No investors yet</td></tr>'}
      </tbody></table></div>
      <div id="bm-inv-detail"></div>`;
    body.querySelector('#bm-add-investor')?.addEventListener('click', () => this.promptInvestor());
    body.querySelectorAll('[data-inv]').forEach((btn) => {
      btn.addEventListener('click', () => this.showInvestor(btn.dataset.inv));
    });
  },

  async promptInvestor(existing) {
    const name = prompt('Investor name:', existing?.name || '');
    if (!name) return;
    const company = prompt('Company:', existing?.company || '') || '';
    const amount = Number(prompt('Investment amount (R):', existing?.investment_amount || 0) || 0);
    const equity = Number(prompt('Equity %:', existing?.equity_percent || 0) || 0);
    try {
      await API.saveInvestor({ id: existing?.id, name, company, investment_amount: amount, equity_percent: equity, status: existing?.status || 'active' }, this.actor);
      Utils.toast('Investor saved', 'success');
      await this.load();
      this.renderTab();
    } catch (e) { Utils.toast(e.message, 'error'); }
  },

  async showInvestor(id) {
    const detail = this.el.querySelector('#bm-inv-detail');
    try {
      const inv = await API.getInvestor(id, this.actor);
      const i = inv?.data || inv;
      detail.innerHTML = `<div class="card" style="margin-top:16px"><div class="card-body">
        <h4>${this.esc(i.name)}</h4>
        <p>${this.esc(i.email || '')} · ${this.esc(i.phone || '')}</p>
        <p>Investment: ${this.money(i.investment_amount)} · Equity: ${Number(i.equity_percent || 0)}%</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
          <button class="btn btn-ghost" id="bm-inv-edit">Edit</button>
          <button class="btn btn-ghost" id="bm-inv-portal">Create portal login</button>
          <button class="btn btn-ghost" id="bm-inv-payment">Record payment</button>
          <button class="btn btn-ghost" id="bm-inv-proposal">New proposal</button>
        </div>
        <h5 style="margin-top:16px">Agreements</h5>
        <ul>${(i.agreements || []).map((a) => `<li>${this.esc(a.title)} — ${this.esc(a.status)}</li>`).join('') || '<li class="muted">None</li>'}</ul>
        <h5>Portal users</h5>
        <ul>${(i.portal_users || []).map((u) => `<li>${this.esc(u.username)} ${u.is_active ? '' : '(disabled)'}</li>`).join('') || '<li class="muted">None — create one for investor login</li>'}</ul>
      </div></div>`;
      detail.querySelector('#bm-inv-edit')?.addEventListener('click', () => this.promptInvestor(i));
      detail.querySelector('#bm-inv-portal')?.addEventListener('click', async () => {
        const username = prompt('Portal username:');
        const password = prompt('Password (min 6 chars):');
        if (!username || !password) return;
        try {
          await API.createInvestorPortalUser(id, { username, password }, this.actor);
          Utils.toast('Portal user created', 'success');
          this.showInvestor(id);
        } catch (e) { Utils.toast(e.message, 'error'); }
      });
      detail.querySelector('#bm-inv-payment')?.addEventListener('click', async () => {
        const amount = Number(prompt('Payment amount (R):') || 0);
        if (!amount) return;
        try {
          await API.recordInvestorPayment({ investor_id: Number(id), amount }, this.actor);
          Utils.toast('Payment recorded', 'success');
          this.showInvestor(id);
        } catch (e) { Utils.toast(e.message, 'error'); }
      });
      detail.querySelector('#bm-inv-proposal')?.addEventListener('click', async () => {
        const title = prompt('Proposal title:', 'Investment Proposal');
        if (!title) return;
        try {
          const r = await API.saveInvestmentProposal({ investor_id: Number(id), title, business_info: prompt('Business info:') || '' }, this.actor);
          const pid = r?.data?.id || r?.id;
          if (pid && confirm('Download proposal PDF?')) {
            const pdf = await API.investmentProposalPdf(pid, this.actor);
            const data = pdf?.data || pdf;
            if (data?.pdf_base64) {
              const a = document.createElement('a');
              a.href = data.pdf_base64;
              a.download = data.filename || 'proposal.pdf';
              a.click();
            }
          }
          Utils.toast('Proposal created', 'success');
        } catch (e) { Utils.toast(e.message, 'error'); }
      });
    } catch (e) { Utils.toast(e.message, 'error'); }
  },

  renderReleaseUsers(body) {
    body.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin:12px 0">
        <h3>Release Centre users</h3>
        <div><a href="/release/" target="_blank" class="btn btn-ghost">Open Release Centre</a>
        <button class="btn btn-primary" id="bm-add-rel-user">Add user</button></div>
      </div>
      <div class="table-wrap"><table><thead><tr><th>Username</th><th>Name</th><th>Role</th><th>Active</th></tr></thead>
        <tbody>${(this.releaseUsers || []).map((u) => `<tr>
          <td>${this.esc(u.username)}</td><td>${this.esc(u.full_name)}</td>
          <td>${this.esc(u.role)}</td><td>${u.is_active ? 'Yes' : 'No'}</td>
        </tr>`).join('') || '<tr><td colspan="4" class="muted">No users — add one to access Release Centre</td></tr>'}
      </tbody></table></div>`;
    body.querySelector('#bm-add-rel-user')?.addEventListener('click', async () => {
      const username = prompt('Username:');
      const password = prompt('Password (min 6):');
      const full_name = prompt('Full name:', username) || username;
      const role = prompt('Role (owner/developer/tester/release_manager):', 'tester') || 'tester';
      if (!username || !password) return;
      try {
        await API.saveReleaseUser({ username, password, full_name, role }, this.actor);
        Utils.toast('Release user created', 'success');
        await this.load();
        this.renderTab();
      } catch (e) { Utils.toast(e.message, 'error'); }
    });
  },

  renderMeetingUsers(body) {
    body.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin:12px 0">
        <h3>Meeting Centre users</h3>
        <div><a href="/meeting/" target="_blank" class="btn btn-ghost">Open Meeting Centre</a>
        <button class="btn btn-primary" id="bm-add-mtg-user">Add user</button></div>
      </div>
      <div class="table-wrap"><table><thead><tr><th>Username</th><th>Name</th><th>Role</th><th>Active</th></tr></thead>
        <tbody>${(this.meetingUsers || []).map((u) => `<tr>
          <td>${this.esc(u.username)}</td><td>${this.esc(u.full_name)}</td>
          <td>${this.esc(u.role)}</td><td>${u.is_active ? 'Yes' : 'No'}</td>
        </tr>`).join('') || '<tr><td colspan="4" class="muted">No users — add one to access Meeting Centre</td></tr>'}
      </tbody></table></div>
      <p class="muted" style="margin-top:12px">Audio recording works in the Meeting Centre portal. AI transcription requires server API key. Video conferencing: NOT IMPLEMENTED.</p>`;
    body.querySelector('#bm-add-mtg-user')?.addEventListener('click', async () => {
      const username = prompt('Username:');
      const password = prompt('Password (min 6):');
      const full_name = prompt('Full name:', username) || username;
      if (!username || !password) return;
      try {
        await API.saveMeetingUser({ username, password, full_name, role: 'meeting_user' }, this.actor);
        Utils.toast('Meeting user created', 'success');
        await this.load();
        this.renderTab();
      } catch (e) { Utils.toast(e.message, 'error'); }
    });
  }
};

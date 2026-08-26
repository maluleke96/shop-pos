/**
 * Admin — Marketing Agent System
 * Overview | Agents | Tasks | Customers | Campaigns | Designs | Media | Feedback | Reports | Audit
 */
const AdminMarketingPage = {
  tab: 'overview',
  app: null,
  filters: { agent_id: '', branch_id: '', date_from: '', date_to: '', status: '' },

  actor() {
    return this.app?.user || (typeof App !== 'undefined' && App.user) || null;
  },

  esc(v) {
    return (typeof Utils !== 'undefined' && Utils.escHtml) ? Utils.escHtml(v) : String(v ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  },

  money(n) {
    const c = this.app?.settings?.currency || 'R';
    return (typeof Utils !== 'undefined' && Utils.formatMoney) ? Utils.formatMoney(Number(n) || 0, c) : `${c}${Number(n || 0).toFixed(2)}`;
  },

  toast(msg, type) {
    if (typeof Utils !== 'undefined' && Utils.toast) Utils.toast(msg, type || 'info');
    else alert(msg);
  },

  async apiOk(promise, fallbackMsg) {
    const r = await promise;
    if (!r || r.success === false) {
      this.toast((r && r.error) || fallbackMsg || 'Request failed', 'error');
      return null;
    }
    return r.data !== undefined ? r.data : r;
  },

  filterPayload() {
    const f = {};
    if (this.filters.agent_id) f.agent_id = parseInt(this.filters.agent_id, 10);
    if (this.filters.branch_id) f.branch_id = parseInt(this.filters.branch_id, 10);
    if (this.filters.date_from) f.date_from = this.filters.date_from;
    if (this.filters.date_to) f.date_to = this.filters.date_to;
    if (this.filters.status) f.status = this.filters.status;
    return f;
  },

  TABS: [
    ['overview', 'Overview'],
    ['agents', 'Agents'],
    ['tasks', 'Tasks'],
    ['customers', 'Customers'],
    ['campaigns', 'Campaigns'],
    ['designs', 'Designs'],
    ['media', 'Media'],
    ['feedback', 'Feedback'],
    ['reports', 'Reports'],
    ['audit', 'Audit']
  ],

  filterBarHtml() {
    return `
      <div class="card" style="margin-bottom:12px"><div class="card-body" style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end">
        <div class="field" style="margin:0;min-width:110px"><label>Agent ID</label>
          <input id="amkt-f-agent" value="${this.esc(this.filters.agent_id)}" placeholder="All"></div>
        <div class="field" style="margin:0;min-width:110px"><label>Branch ID</label>
          <input id="amkt-f-branch" value="${this.esc(this.filters.branch_id)}" placeholder="All"></div>
        <div class="field" style="margin:0"><label>From</label>
          <input type="date" id="amkt-f-from" value="${this.esc(this.filters.date_from)}"></div>
        <div class="field" style="margin:0"><label>To</label>
          <input type="date" id="amkt-f-to" value="${this.esc(this.filters.date_to)}"></div>
        <div class="field" style="margin:0;min-width:120px"><label>Status</label>
          <input id="amkt-f-status" value="${this.esc(this.filters.status)}" placeholder="Any"></div>
        <button type="button" class="btn btn-primary btn-sm" id="amkt-f-apply">Apply filters</button>
        <button type="button" class="btn btn-ghost btn-sm" id="amkt-f-clear">Clear</button>
      </div></div>`;
  },

  bindFilters(el) {
    document.getElementById('amkt-f-apply')?.addEventListener('click', () => {
      this.filters.agent_id = document.getElementById('amkt-f-agent')?.value.trim() || '';
      this.filters.branch_id = document.getElementById('amkt-f-branch')?.value.trim() || '';
      this.filters.date_from = document.getElementById('amkt-f-from')?.value || '';
      this.filters.date_to = document.getElementById('amkt-f-to')?.value || '';
      this.filters.status = document.getElementById('amkt-f-status')?.value.trim() || '';
      this.render(this.el, this.app);
    });
    document.getElementById('amkt-f-clear')?.addEventListener('click', () => {
      this.filters = { agent_id: '', branch_id: '', date_from: '', date_to: '', status: '' };
      this.render(this.el, this.app);
    });
  },

  async render(el, app) {
    this.el = el;
    this.app = app || this.app;
    if (!this.tab) this.tab = 'overview';

    el.innerHTML = `
      <div class="admin-section">
        <div class="page-toolbar">
          <h3 style="margin:0">Marketing Management</h3>
        </div>
        <p class="muted">Control agents, tasks, approvals, media, feedback, and audit — connected to the Marketing Agent System.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0" id="amkt-tabs">
          ${this.TABS.map(([id, label]) =>
            `<button type="button" class="btn ${this.tab === id ? 'btn-primary' : 'btn-ghost'} btn-sm" data-amkt-tab="${id}">${this.esc(label)}</button>`
          ).join('')}
        </div>
        <div id="amkt-content"><p class="muted">Loading…</p></div>
      </div>`;

    el.querySelectorAll('[data-amkt-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.tab = btn.dataset.amktTab;
        this.render(el, this.app);
      });
    });

    const content = document.getElementById('amkt-content');
    try {
      await this.renderTab(content);
    } catch (err) {
      content.innerHTML = `<p class="error-msg">${this.esc(err.message || 'Failed to load')}</p>`;
    }
  },

  async renderTab(el) {
    const map = {
      overview: () => this.renderOverview(el),
      agents: () => this.renderAgents(el),
      tasks: () => this.renderTasks(el),
      customers: () => this.renderCustomers(el),
      campaigns: () => this.renderCampaigns(el),
      designs: () => this.renderDesigns(el),
      media: () => this.renderMedia(el),
      feedback: () => this.renderFeedback(el),
      reports: () => this.renderReports(el),
      audit: () => this.renderAudit(el)
    };
    await (map[this.tab] || map.overview)();
  },

  async renderOverview(el) {
    const s = (await this.apiOk(API.mktAdminSummary(this.filterPayload(), this.actor()), 'Summary failed')) || {};
    el.innerHTML = `
      ${this.filterBarHtml()}
      <div class="stats-grid">
        <div class="stat-card"><div class="label">Active agents</div><div class="value">${s.active_agents || 0}</div></div>
        <div class="stat-card"><div class="label">Recruited</div><div class="value">${s.customers_recruited || 0}</div></div>
        <div class="stat-card"><div class="label">Active campaigns</div><div class="value">${s.active_campaigns || 0}</div></div>
        <div class="stat-card"><div class="label">Tasks completed</div><div class="value">${s.tasks_completed || 0}</div></div>
        <div class="stat-card"><div class="label">Referrals</div><div class="value">${s.referrals || 0}</div></div>
        <div class="stat-card"><div class="label">Attributed sales</div><div class="value">${this.money(s.attributed_sales)}</div></div>
        <div class="stat-card"><div class="label">Pending approvals</div><div class="value">${s.pending_approvals || 0}</div></div>
      </div>
      ${(s.pending_designs || []).length ? `
        <div class="card"><div class="card-header"><h3>Pending designs</h3></div>
        <div class="card-body"><ul>
          ${(s.pending_designs || []).map(d =>
            `<li>${this.esc(d.design_type)} · ${this.esc(d.name)} <span class="tag">${this.esc(d.approval_status)}</span></li>`
          ).join('')}
        </ul></div></div>` : '<p class="muted">No pending designs in summary.</p>'}`;
    this.bindFilters(el);
  },

  async renderAgents(el) {
    const agents = (await this.apiOk(API.mktAgents(this.filterPayload(), this.actor()), 'Agents failed')) || [];
    el.innerHTML = `
      ${this.filterBarHtml()}
      <div class="card" style="margin-bottom:16px"><div class="card-body">
        <h4 style="margin-top:0">Assign / update agent</h4>
        <div class="form-grid">
          <div class="field"><label>User ID *</label><input type="number" id="amkt-user-id" min="1"></div>
          <div class="field"><label>Branch ID</label><input type="number" id="amkt-branch-id" min="0"></div>
          <div class="field"><label>Customers / month</label><input type="number" id="amkt-t-cust" value="100"></div>
          <div class="field"><label>Customers / week</label><input type="number" id="amkt-t-week" value="25"></div>
          <div class="field"><label>Campaigns / month</label><input type="number" id="amkt-t-camp" value="4"></div>
          <div class="field"><label>Flyers / month</label><input type="number" id="amkt-t-fly" value="8"></div>
          <div class="field"><label>Menus / month</label><input type="number" id="amkt-t-menu" value="2"></div>
          <div class="field"><label>Referrals / month</label><input type="number" id="amkt-t-ref" value="20"></div>
          <div class="field"><label>Tasks / week</label><input type="number" id="amkt-t-task" value="10"></div>
          <div class="field"><label><input type="checkbox" id="amkt-perm-price"> Allow price override</label></div>
          <div class="field full"><label>Notes</label><input id="amkt-notes"></div>
        </div>
        <button type="button" class="btn btn-primary" id="amkt-assign" style="margin-top:12px">Save agent assignment</button>
      </div></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Name</th><th>User</th><th>Referral</th><th>Branch</th><th>Status</th><th>Price override</th><th>Recruited</th><th></th></tr></thead>
        <tbody>
          ${agents.map(a => {
            const perms = a.permissions || {};
            return `<tr>
            <td>${this.esc(a.full_name || '—')}</td>
            <td>${this.esc(a.username)} <span class="muted">#${a.user_id}</span></td>
            <td><code>${this.esc(a.referral_code)}</code></td>
            <td>${this.esc(a.branch_id ?? '—')}</td>
            <td><span class="tag">${this.esc(a.status)}</span></td>
            <td>${perms.allow_price_override ? 'Yes' : 'No'}</td>
            <td>${this.esc(a.customers_recruited ?? 0)}</td>
            <td style="white-space:nowrap">
              ${a.status === 'active'
                ? `<button type="button" class="btn btn-sm btn-warning amkt-deact" data-id="${a.id}">Deactivate</button>`
                : `<button type="button" class="btn btn-sm btn-success amkt-act" data-id="${a.id}">Activate</button>`}
              <button type="button" class="btn btn-sm btn-ghost amkt-token" data-id="${a.id}">Issue token</button>
              <button type="button" class="btn btn-sm btn-ghost amkt-tokens" data-id="${a.id}">Tokens</button>
            </td>
          </tr>`;
          }).join('') || '<tr><td colspan="8" class="muted">No agents yet</td></tr>'}
        </tbody>
      </table></div>
      <div id="amkt-token-box" style="margin-top:12px"></div>`;

    this.bindFilters(el);

    document.getElementById('amkt-assign')?.addEventListener('click', async () => {
      const userId = parseInt(document.getElementById('amkt-user-id').value, 10);
      if (!userId) return this.toast('User ID required', 'error');
      const branchRaw = document.getElementById('amkt-branch-id').value;
      const targets = {
        customers_recruit_month: parseInt(document.getElementById('amkt-t-cust').value, 10) || 100,
        customers_recruit_week: parseInt(document.getElementById('amkt-t-week').value, 10) || 25,
        campaigns_month: parseInt(document.getElementById('amkt-t-camp').value, 10) || 4,
        flyers_month: parseInt(document.getElementById('amkt-t-fly').value, 10) || 8,
        menus_month: parseInt(document.getElementById('amkt-t-menu').value, 10) || 2,
        referrals_month: parseInt(document.getElementById('amkt-t-ref').value, 10) || 20,
        tasks_week: parseInt(document.getElementById('amkt-t-task').value, 10) || 10
      };
      const r = await this.apiOk(API.mktSaveAgent(userId, {
        branch_id: branchRaw === '' ? null : parseInt(branchRaw, 10),
        targets,
        permissions: {
          allow_price_override: !!document.getElementById('amkt-perm-price')?.checked
        },
        notes: document.getElementById('amkt-notes').value.trim() || null,
        status: 'active'
      }, this.actor()), 'Assign failed');
      if (!r) return;
      this.toast('Agent saved', 'success');
      this.render(this.el, this.app);
    });

    el.querySelectorAll('.amkt-act').forEach((b) => {
      b.addEventListener('click', async () => {
        const r = await this.apiOk(API.mktSetAgentStatus(parseInt(b.dataset.id, 10), 'active', this.actor()), 'Activate failed');
        if (!r) return;
        this.toast('Agent activated', 'success');
        this.render(this.el, this.app);
      });
    });
    el.querySelectorAll('.amkt-deact').forEach((b) => {
      b.addEventListener('click', async () => {
        if (!confirm('Deactivate this marketing agent? Active tokens will be revoked.')) return;
        const r = await this.apiOk(API.mktSetAgentStatus(parseInt(b.dataset.id, 10), 'inactive', this.actor()), 'Deactivate failed');
        if (!r) return;
        this.toast('Agent deactivated', 'success');
        this.render(this.el, this.app);
      });
    });
    el.querySelectorAll('.amkt-token').forEach((b) => {
      b.addEventListener('click', async () => {
        const hoursStr = prompt('Token validity (hours):', '24');
        if (hoursStr === null) return;
        const deviceId = prompt('Optional device ID (binds token to device):', '') || null;
        const hours = parseInt(hoursStr, 10) || 24;
        const r = await this.apiOk(API.mktIssueToken(parseInt(b.dataset.id, 10), hours, deviceId || null, this.actor()), 'Token failed');
        if (!r) return;
        alert(`Temporary access token (shown once):\n\n${r.token}\n\nExpires: ${r.expires_at || ''}\nDevice: ${deviceId || 'any (binds on first use)'}`);
        this.toast('Token issued — copy it now', 'success');
      });
    });
    el.querySelectorAll('.amkt-tokens').forEach((b) => {
      b.addEventListener('click', async () => {
        const tokens = (await this.apiOk(API.mktListTokens(parseInt(b.dataset.id, 10), this.actor()), 'Tokens failed')) || [];
        const box = document.getElementById('amkt-token-box');
        box.innerHTML = `<div class="card"><div class="card-header"><h3>Tokens for agent #${this.esc(b.dataset.id)}</h3></div>
          <div class="card-body"><div class="table-wrap"><table>
            <thead><tr><th>ID</th><th>Expires</th><th>Device</th><th>Revoked</th><th></th></tr></thead>
            <tbody>${tokens.map(t => `<tr>
              <td>${t.id}</td><td>${this.esc(t.expires_at)}</td><td>${this.esc(t.device_id || '—')}</td>
              <td>${t.revoked_at ? this.esc(t.revoked_at) : 'Active'}</td>
              <td>${!t.revoked_at ? `<button type="button" class="btn btn-sm btn-danger amkt-revoke" data-id="${t.id}">Revoke</button>` : '—'}</td>
            </tr>`).join('') || '<tr><td colspan="5" class="muted">No tokens</td></tr>'}
          </tbody></table></div></div></div>`;
        box.querySelectorAll('.amkt-revoke').forEach((rb) => {
          rb.addEventListener('click', async () => {
            const r = await this.apiOk(API.mktRevokeToken(parseInt(rb.dataset.id, 10), this.actor()), 'Revoke failed');
            if (!r && r !== true) return;
            this.toast('Token revoked', 'success');
            b.click();
          });
        });
      });
    });
  },

  async renderTasks(el) {
    const agents = (await this.apiOk(API.mktAgents({}, this.actor()), 'Agents failed')) || [];
    const tasks = (await this.apiOk(API.mktTasks(this.filterPayload(), this.actor()), 'Tasks failed')) || [];
    const agentOpts = agents.map(a => `<option value="${a.id}">${this.esc(a.full_name || a.username)} (#${a.id})</option>`).join('');
    el.innerHTML = `
      ${this.filterBarHtml()}
      <div class="card" style="margin-bottom:16px"><div class="card-body">
        <h4 style="margin-top:0">Assign task</h4>
        <div class="form-grid">
          <div class="field"><label>Agent *</label><select id="amkt-task-agent">${agentOpts || '<option value="">No agents</option>'}</select></div>
          <div class="field"><label>Title *</label><input id="amkt-task-title" placeholder="Recruit 50 customers"></div>
          <div class="field"><label>Type</label>
            <select id="amkt-task-type">
              <option value="recruit">Recruit customers</option>
              <option value="flyer">Create flyer</option>
              <option value="menu">Create menu</option>
              <option value="promote">Promote special</option>
              <option value="reviews">Collect reviews</option>
              <option value="whatsapp">Grow WhatsApp group</option>
              <option value="referral">Referral campaign</option>
              <option value="branch">Promote branch</option>
              <option value="inactive">Contact inactive</option>
              <option value="general">General</option>
            </select>
          </div>
          <div class="field"><label>Target value</label><input type="number" id="amkt-task-target" value="0"></div>
          <div class="field"><label>Due date</label><input type="date" id="amkt-task-due"></div>
          <div class="field full"><label>Description</label><textarea id="amkt-task-desc" rows="2"></textarea></div>
        </div>
        <button type="button" class="btn btn-primary" id="amkt-task-save" style="margin-top:12px">Assign task</button>
      </div></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Title</th><th>Agent</th><th>Type</th><th>Due</th><th>Status</th><th>Target</th><th>Actual</th></tr></thead>
        <tbody>
          ${tasks.map(t => `<tr>
            <td><strong>${this.esc(t.title)}</strong><br><small class="muted">${this.esc(t.description || '')}</small></td>
            <td>${this.esc(t.agent_id)}</td>
            <td>${this.esc(t.task_type)}</td>
            <td>${this.esc(t.due_date || '—')}</td>
            <td><span class="tag">${this.esc(t.status)}</span></td>
            <td>${this.esc(t.target_value)}</td>
            <td>${this.esc(t.actual_value)}</td>
          </tr>`).join('') || '<tr><td colspan="7" class="muted">No tasks</td></tr>'}
        </tbody>
      </table></div>`;
    this.bindFilters(el);
    document.getElementById('amkt-task-save')?.addEventListener('click', async () => {
      const agent_id = parseInt(document.getElementById('amkt-task-agent').value, 10);
      const title = document.getElementById('amkt-task-title').value.trim();
      if (!agent_id || !title) return this.toast('Agent and title required', 'error');
      const r = await this.apiOk(API.mktSaveTask({
        agent_id,
        title,
        description: document.getElementById('amkt-task-desc').value.trim(),
        task_type: document.getElementById('amkt-task-type').value,
        target_value: parseFloat(document.getElementById('amkt-task-target').value) || 0,
        due_date: document.getElementById('amkt-task-due').value || null
      }, this.actor()), 'Assign failed');
      if (!r) return;
      this.toast('Task assigned', 'success');
      this.render(this.el, this.app);
    });
  },

  async renderCustomers(el) {
    const customers = (await this.apiOk(API.mktCustomers(this.filterPayload(), this.actor()), 'Customers failed')) || [];
    el.innerHTML = `
      ${this.filterBarHtml()}
      <p class="muted">All marketing customers (agent attribution)</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Name</th><th>Phone</th><th>POS customer</th><th>Agent</th><th>Group</th><th>Source</th><th>Status</th><th>Consent</th><th>Created</th></tr></thead>
        <tbody>
          ${customers.map(c => `<tr>
            <td>${this.esc(c.full_name)}</td>
            <td>${this.esc(c.phone || '—')}</td>
            <td>${c.customer_id ? '#' + c.customer_id : '—'}</td>
            <td>${this.esc(c.agent_id ?? '—')}</td>
            <td>${this.esc(c.group_tag || '—')}</td>
            <td>${this.esc(c.source || '—')}</td>
            <td><span class="tag">${this.esc(c.conversion_status || '—')}</span></td>
            <td>${c.marketing_consent ? 'Yes' : 'No'}</td>
            <td>${this.esc(c.created_at || '')}</td>
          </tr>`).join('') || '<tr><td colspan="9" class="muted">No customers</td></tr>'}
        </tbody>
      </table></div>`;
    this.bindFilters(el);
  },

  async renderCampaigns(el) {
    const campaigns = (await this.apiOk(API.mktCampaigns(this.filterPayload(), this.actor()), 'Campaigns failed')) || [];
    el.innerHTML = `
      ${this.filterBarHtml()}
      <div class="table-wrap"><table>
        <thead><tr><th>Name</th><th>Objective</th><th>Offer</th><th>Flyer</th><th>Menu</th><th>Dates</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${campaigns.map(c => `<tr>
            <td>${this.esc(c.name)}</td>
            <td>${this.esc(c.objective || '—')}</td>
            <td>${this.esc(c.offer_text || '—')}</td>
            <td>${c.flyer_id ? '#' + c.flyer_id : '—'}</td>
            <td>${c.menu_id ? '#' + c.menu_id : '—'}</td>
            <td>${this.esc(c.start_date || '—')} → ${this.esc(c.end_date || '—')}</td>
            <td><span class="tag">${this.esc(c.status)}</span></td>
            <td style="white-space:nowrap">
              ${c.status === 'pending_approval' ? `
                <button type="button" class="btn btn-sm btn-success amkt-camp-ok" data-id="${c.id}">Approve</button>
                <button type="button" class="btn btn-sm btn-danger amkt-camp-no" data-id="${c.id}">Reject</button>
              ` : '—'}
            </td>
          </tr>`).join('') || '<tr><td colspan="8" class="muted">No campaigns</td></tr>'}
        </tbody>
      </table></div>`;
    this.bindFilters(el);
    el.querySelectorAll('.amkt-camp-ok').forEach((b) => {
      b.addEventListener('click', async () => {
        const notes = prompt('Approval notes (optional):') || '';
        const r = await this.apiOk(API.mktApproveCampaign(parseInt(b.dataset.id, 10), true, notes, this.actor()), 'Approve failed');
        if (!r) return;
        this.toast('Campaign approved', 'success');
        this.render(this.el, this.app);
      });
    });
    el.querySelectorAll('.amkt-camp-no').forEach((b) => {
      b.addEventListener('click', async () => {
        const notes = prompt('Rejection notes:') || '';
        const r = await this.apiOk(API.mktApproveCampaign(parseInt(b.dataset.id, 10), false, notes, this.actor()), 'Reject failed');
        if (!r) return;
        this.toast('Campaign rejected', 'success');
        this.render(this.el, this.app);
      });
    });
  },

  async renderDesigns(el) {
    const menus = (await this.apiOk(API.mktMenus({ approval_status: 'pending' }, this.actor()), 'Menus failed')) || [];
    const flyersRes = await API.getFlyers({ approval_status: 'pending' });
    const flyers = (flyersRes?.success === false ? [] : (flyersRes?.data || flyersRes || [])).filter(f => (f.approval_status || '') === 'pending');
    el.innerHTML = `
      <div class="card" style="margin-bottom:16px"><div class="card-body">
        <p class="muted" style="margin:0">Approve flyers and menus here. Flyer Studio remains the full editor.</p>
      </div></div>
      <h4>Pending flyers</h4>
      <div class="table-wrap" style="margin-bottom:16px"><table>
        <thead><tr><th>Title</th><th>Number</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${flyers.map(f => `<tr>
            <td>${this.esc(f.title || f.name || 'Flyer')}</td>
            <td>${this.esc(f.flyer_number || f.id)}</td>
            <td><span class="tag">${this.esc(f.approval_status || f.status || 'pending')}</span></td>
            <td style="white-space:nowrap">
              <button type="button" class="btn btn-sm btn-success amkt-fly-ok" data-id="${f.id}">Approve</button>
              <button type="button" class="btn btn-sm btn-danger amkt-fly-no" data-id="${f.id}">Reject</button>
            </td>
          </tr>`).join('') || '<tr><td colspan="4" class="muted">No pending flyers</td></tr>'}
        </tbody>
      </table></div>
      <h4>Pending menus</h4>
      <div class="table-wrap"><table>
        <thead><tr><th>Title</th><th>Type</th><th>Agent</th><th>Submitted</th><th></th></tr></thead>
        <tbody>
          ${menus.map(m => `<tr>
            <td>${this.esc(m.title)}</td>
            <td>${this.esc(m.menu_type)}</td>
            <td>${this.esc(m.agent_id ?? '—')}</td>
            <td>${this.esc(m.submitted_at || m.updated_at || '')}</td>
            <td style="white-space:nowrap">
              <button type="button" class="btn btn-sm btn-success amkt-menu-ok" data-id="${m.id}">Approve + QR</button>
              <button type="button" class="btn btn-sm btn-danger amkt-menu-no" data-id="${m.id}">Reject</button>
            </td>
          </tr>`).join('') || '<tr><td colspan="5" class="muted">No pending menus</td></tr>'}
        </tbody>
      </table></div>`;
    el.querySelectorAll('.amkt-fly-ok').forEach((b) => {
      b.addEventListener('click', async () => {
        const r = await this.apiOk(API.approveFlyer(parseInt(b.dataset.id, 10), this.actor()), 'Approve failed');
        if (!r) return;
        this.toast('Flyer approved', 'success');
        this.render(this.el, this.app);
      });
    });
    el.querySelectorAll('.amkt-fly-no').forEach((b) => {
      b.addEventListener('click', async () => {
        const notes = prompt('Rejection notes:') || 'Please revise';
        const r = await this.apiOk(API.rejectFlyer(parseInt(b.dataset.id, 10), this.actor(), notes), 'Reject failed');
        if (!r) return;
        this.toast('Flyer rejected', 'success');
        this.render(this.el, this.app);
      });
    });
    el.querySelectorAll('.amkt-menu-ok').forEach((b) => {
      b.addEventListener('click', async () => {
        const notes = prompt('Approval notes (optional):') || '';
        const r = await this.apiOk(API.mktReviewMenu(parseInt(b.dataset.id, 10), true, notes, this.actor()), 'Approve failed');
        if (!r) return;
        this.toast('Menu approved — digital slug & QR payload created', 'success');
        this.render(this.el, this.app);
      });
    });
    el.querySelectorAll('.amkt-menu-no').forEach((b) => {
      b.addEventListener('click', async () => {
        const notes = prompt('Rejection notes:') || 'Please revise';
        const r = await this.apiOk(API.mktReviewMenu(parseInt(b.dataset.id, 10), false, notes, this.actor()), 'Reject failed');
        if (!r) return;
        this.toast('Menu rejected', 'success');
        this.render(this.el, this.app);
      });
    });
  },

  async renderMedia(el) {
    const media = (await this.apiOk(API.mktMedia(this.actor()), 'Media failed')) || [];
    el.innerHTML = `
      <p class="muted">Mark library files Approved, Restricted, or Archived.</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Title</th><th>Type</th><th>Status</th><th>Path</th><th></th></tr></thead>
        <tbody>
          ${media.map(m => `<tr>
            <td>${this.esc(m.title)}</td>
            <td>${this.esc(m.media_type)}</td>
            <td><span class="tag">${this.esc(m.approval_status)}</span></td>
            <td class="muted" style="max-width:220px;overflow:hidden;text-overflow:ellipsis">${this.esc(m.file_path)}</td>
            <td style="white-space:nowrap">
              <button type="button" class="btn btn-sm btn-success amkt-media-st" data-id="${m.id}" data-st="approved">Approved</button>
              <button type="button" class="btn btn-sm btn-warning amkt-media-st" data-id="${m.id}" data-st="restricted">Restricted</button>
              <button type="button" class="btn btn-sm btn-ghost amkt-media-st" data-id="${m.id}" data-st="archived">Archived</button>
            </td>
          </tr>`).join('') || '<tr><td colspan="5" class="muted">No media</td></tr>'}
        </tbody>
      </table></div>`;
    el.querySelectorAll('.amkt-media-st').forEach((b) => {
      b.addEventListener('click', async () => {
        const r = await this.apiOk(API.mktSetMediaStatus(parseInt(b.dataset.id, 10), b.dataset.st, this.actor()), 'Update failed');
        if (!r) return;
        this.toast(`Media → ${b.dataset.st}`, 'success');
        this.render(this.el, this.app);
      });
    });
  },

  async renderFeedback(el) {
    const rows = (await this.apiOk(API.mktFeedback(this.filterPayload(), this.actor()), 'Feedback failed')) || [];
    el.innerHTML = `
      ${this.filterBarHtml()}
      <div class="table-wrap"><table>
        <thead><tr><th>When</th><th>Type</th><th>Customer</th><th>Phone</th><th>Notes</th><th>Product request</th><th>Agent</th></tr></thead>
        <tbody>
          ${rows.map(f => `<tr>
            <td>${this.esc(f.created_at || '')}</td>
            <td><span class="tag">${this.esc(f.feedback_type)}</span></td>
            <td>${this.esc(f.customer_name || '—')}</td>
            <td>${this.esc(f.phone || '—')}</td>
            <td>${this.esc(f.notes || '')}</td>
            <td>${this.esc(f.product_request || '—')}</td>
            <td>${this.esc(f.agent_id ?? '—')}</td>
          </tr>`).join('') || '<tr><td colspan="7" class="muted">No feedback yet</td></tr>'}
        </tbody>
      </table></div>`;
    this.bindFilters(el);
  },

  async renderReports(el) {
    const reports = (await this.apiOk(API.mktReports(this.filterPayload(), this.actor()), 'Reports failed')) || [];
    const conflicts = (await this.apiOk(API.mktSyncConflicts(this.actor()), 'Conflicts failed')) || [];
    el.innerHTML = `
      ${this.filterBarHtml()}
      <div class="table-wrap"><table>
        <thead><tr><th>Agent</th><th>Period</th><th>Work</th><th>Attachments</th><th>Status</th><th>Response</th><th></th></tr></thead>
        <tbody>
          ${reports.map(r => {
            let atts = [];
            try { atts = typeof r.attachments_json === 'string' ? JSON.parse(r.attachments_json) : (r.attachments_json || []); } catch { atts = []; }
            return `<tr>
            <td>${this.esc(r.agent_name || r.agent_id)}</td>
            <td>${this.esc(r.period_label)}</td>
            <td>${this.esc((r.work_completed || '').slice(0, 80))}</td>
            <td>${atts.length || 0}</td>
            <td><span class="tag">${this.esc(r.status)}</span></td>
            <td>${this.esc(r.admin_response || '—')}</td>
            <td>${r.status !== 'reviewed'
              ? `<button type="button" class="btn btn-sm btn-primary amkt-rep-resp" data-id="${r.id}">Respond</button>`
              : '—'}</td>
          </tr>`;
          }).join('') || '<tr><td colspan="7" class="muted">No progress reports</td></tr>'}
        </tbody>
      </table></div>
      ${conflicts.length ? `<div class="card" style="margin-top:16px"><div class="card-header"><h3>Open sync conflicts</h3></div>
        <div class="card-body"><div class="table-wrap"><table>
          <thead><tr><th>Entity</th><th>UID</th><th>Local v</th><th>Remote v</th><th></th></tr></thead>
          <tbody>${conflicts.map(c => `<tr>
            <td>${this.esc(c.entity_type)}</td><td>${this.esc(c.entity_uid)}</td>
            <td>${this.esc(c.local_version)}</td><td>${this.esc(c.remote_version)}</td>
            <td>
              <button type="button" class="btn btn-sm btn-primary amkt-cf" data-id="${c.id}" data-keep="local">Keep local</button>
              <button type="button" class="btn btn-sm btn-ghost amkt-cf" data-id="${c.id}" data-keep="remote">Keep remote</button>
            </td>
          </tr>`).join('')}</tbody></table></div></div></div>` : ''}`;
    this.bindFilters(el);
    el.querySelectorAll('.amkt-rep-resp').forEach((b) => {
      b.addEventListener('click', async () => {
        const response = prompt('Admin response / feedback:');
        if (response === null) return;
        const r = await this.apiOk(API.mktRespondReport(parseInt(b.dataset.id, 10), response, this.actor()), 'Respond failed');
        if (!r) return;
        this.toast('Response saved', 'success');
        this.render(this.el, this.app);
      });
    });
    el.querySelectorAll('.amkt-cf').forEach((b) => {
      b.addEventListener('click', async () => {
        const r = await this.apiOk(API.mktResolveConflict(parseInt(b.dataset.id, 10), b.dataset.keep, this.actor()), 'Resolve failed');
        if (r === null) return;
        this.toast('Conflict resolved', 'success');
        this.render(this.el, this.app);
      });
    });
  },

  async renderAudit(el) {
    const rows = (await this.apiOk(API.mktAudit(this.filterPayload(), this.actor()), 'Audit failed')) || [];
    el.innerHTML = `
      ${this.filterBarHtml()}
      <div class="table-wrap"><table>
        <thead><tr><th>When</th><th>User</th><th>Agent</th><th>Action</th><th>Entity</th><th>Device</th><th>Details</th></tr></thead>
        <tbody>
          ${rows.map(a => `<tr>
            <td>${this.esc(a.created_at || '')}</td>
            <td>${this.esc(a.username || a.user_id || '—')}</td>
            <td>${this.esc(a.agent_id ?? '—')}</td>
            <td>${this.esc(a.action)}</td>
            <td>${this.esc(a.entity_type || '')} ${a.entity_id != null ? '#' + this.esc(a.entity_id) : ''}</td>
            <td>${this.esc(a.device_id || '—')}</td>
            <td class="muted" style="max-width:240px;overflow:hidden;text-overflow:ellipsis">${this.esc(a.details_json || '')}</td>
          </tr>`).join('') || '<tr><td colspan="7" class="muted">No audit entries</td></tr>'}
        </tbody>
      </table></div>`;
    this.bindFilters(el);
  }
};

window.AdminMarketingPage = AdminMarketingPage;

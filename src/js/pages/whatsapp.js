// WhatsApp Communication Center
const WhatsAppPage = {
  esc(v) {
    return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  },
  tab: 'templates',
  templates: [],
  campaigns: [],
  messages: [],
  customers: [],
  employees: [],
  branches: [],
  settings: {},
  audiencePreview: [],

  PLACEHOLDERS: '{{CustomerName}}, {{LoyaltyPoints}}, {{Branch}}, {{PromotionName}}, {{VoucherCode}}, {{Coupon}}, {{OrderNumber}}, {{TotalPurchase}}, {{Phone}}, {{EmployeeName}}, {{PayPeriod}}, {{NetPay}}, {{Date}}, {{AttendanceStatus}}, {{WarningReason}}, {{AnnouncementText}}',

  async render(el, app) {
    this.app = app;
    this.currency = app.settings?.currency || 'R';
    if (!['owner', 'manager', 'assistant_manager'].includes(app.user?.role)) {
      el.innerHTML = '<p class="muted">WhatsApp Communication Center is available to owner, manager, and assistant manager.</p>';
      return;
    }
    const [tplRes, campRes, brRes, setRes] = await Promise.all([
      API.getWhatsAppTemplates({}),
      API.getWhatsAppCampaigns({}),
      API.getBranches(),
      API.getWhatsAppSettings()
    ]);
    this.templates = tplRes.data || [];
    this.campaigns = campRes.data || [];
    this.branches = brRes.data || [];
    this.settings = setRes.data || app.settings?.whatsapp_settings || {};

    el.innerHTML = `<div class="page-toolbar"><h3>💬 WhatsApp Communication Center</h3></div>
      <div class="form-tabs" id="wa-tabs">
        ${[
          ['templates', 'Templates'],
          ['campaigns', 'Marketing Campaigns'],
          ['customers', 'Customer Messages'],
          ['numbers', 'Customer Numbers'],
          ['employees', 'Employee Center'],
          ['history', 'History'],
          ['settings', 'Settings']
        ].map(([id, label]) =>
          `<button type="button" class="form-tab ${this.tab === id ? 'active' : ''}" data-tab="${id}">${label}</button>`
        ).join('')}
      </div>
      <div id="wa-panel"></div>`;

    el.querySelectorAll('[data-tab]').forEach(btn => btn.addEventListener('click', () => {
      this.tab = btn.dataset.tab;
      this.render(el, app);
    }));

    const panel = document.getElementById('wa-panel');
    if (this.tab === 'templates') await this.renderTemplates(panel);
    else if (this.tab === 'campaigns') await this.renderCampaigns(panel);
    else if (this.tab === 'customers') await this.renderCustomers(panel);
    else if (this.tab === 'numbers') await this.renderCustomerNumbers(panel);
    else if (this.tab === 'employees') await this.renderEmployees(panel);
    else if (this.tab === 'history') await this.renderHistory(panel);
    else if (this.tab === 'settings') await this.renderSettings(panel);
  },

  async renderTemplates(panel) {
    panel.innerHTML = `<div class="page-toolbar" style="margin-top:12px">
      <p class="muted" style="margin:0">Create and manage message templates. Placeholders: ${this.PLACEHOLDERS}</p>
      <button class="btn btn-primary" id="wa-new-tpl">+ New Template</button>
    </div>
    <div class="card"><div class="table-wrap"><table>
      <thead><tr><th>Name</th><th>Category</th><th>Built-in</th><th>Active</th><th>Preview</th><th></th></tr></thead>
      <tbody>${this.templates.map(t => `<tr>
        <td>${t.name}${t.slug ? `<br><code class="muted">${t.slug}</code>` : ''}</td>
        <td><span class="tag">${t.category}</span></td>
        <td>${t.is_builtin ? '✓' : '—'}</td>
        <td>${t.is_active ? '✓' : '—'}</td>
        <td class="muted" style="max-width:280px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${this.esc(t.body.slice(0, 80))}…</td>
        <td class="actions">
          <button class="btn btn-sm btn-ghost wa-edit-tpl" data-id="${t.id}">Edit</button>
          ${t.is_builtin ? '' : `<button class="btn btn-sm btn-danger wa-del-tpl" data-id="${t.id}">Delete</button>`}
        </td></tr>`).join('') || '<tr><td colspan="6" class="muted">No templates</td></tr>'}
      </tbody></table></div></div>`;

    document.getElementById('wa-new-tpl')?.addEventListener('click', () => this.showTemplateForm());
    panel.querySelectorAll('.wa-edit-tpl').forEach(b => b.addEventListener('click', () => {
      const t = this.templates.find(x => x.id == b.dataset.id);
      if (t) this.showTemplateForm(t);
    }));
    panel.querySelectorAll('.wa-del-tpl').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Delete this template?')) return;
      const r = await API.deleteWhatsAppTemplate(parseInt(b.dataset.id), this.app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      Utils.toast('Template deleted', 'success');
      this.render(document.getElementById('page-content'), this.app);
    }));
  },

  showTemplateForm(tpl = null) {
    Utils.showModal(tpl ? 'Edit Template' : 'New Template', `
      <div class="field"><label>Name</label><input id="wa-tpl-name" value="${this.esc(tpl?.name || '')}"></div>
      <div class="field"><label>Category</label>
        <select id="wa-tpl-cat"><option value="customer" ${tpl?.category === 'customer' ? 'selected' : ''}>Customer</option>
        <option value="employee" ${tpl?.category === 'employee' ? 'selected' : ''}>Employee</option>
        <option value="supplier" ${tpl?.category === 'supplier' ? 'selected' : ''}>Supplier</option></select></div>
      <div class="field"><label>Body</label><textarea id="wa-tpl-body" rows="6" style="width:100%">${this.esc(tpl?.body || '')}</textarea></div>
      <p class="muted" style="font-size:12px">${this.PLACEHOLDERS}</p>
      ${tpl ? `<label><input type="checkbox" id="wa-tpl-active" ${tpl.is_active ? 'checked' : ''}> Active</label>` : ''}`,
      '<button class="btn btn-primary" id="wa-save-tpl">Save Template</button>');
    document.getElementById('wa-save-tpl').addEventListener('click', async () => {
      const data = {
        id: tpl?.id,
        name: document.getElementById('wa-tpl-name').value.trim(),
        category: document.getElementById('wa-tpl-cat').value,
        body: document.getElementById('wa-tpl-body').value.trim(),
        is_active: tpl ? document.getElementById('wa-tpl-active').checked : true
      };
      const r = await API.saveWhatsAppTemplate(data, this.app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      Utils.hideModal();
      Utils.toast('Template saved', 'success');
      this.render(document.getElementById('page-content'), this.app);
    });
  },

  async renderCampaigns(panel) {
    panel.innerHTML = `<div class="page-toolbar" style="margin-top:12px">
      <p class="muted" style="margin:0">Schedule or send marketing campaigns to customer audiences.</p>
      <button class="btn btn-primary" id="wa-new-camp">+ New Campaign</button>
    </div>
    <div class="card"><div class="table-wrap"><table>
      <thead><tr><th>Name</th><th>Template</th><th>Audience</th><th>Scheduled</th><th>Status</th><th>Sent</th><th></th></tr></thead>
      <tbody>${this.campaigns.map(c => {
        const tpl = this.templates.find(t => t.id === c.template_id);
        return `<tr>
          <td>${c.name}</td>
          <td>${tpl?.name || '—'}</td>
          <td>${c.audience_filter || '—'}</td>
          <td>${c.scheduled_at ? Utils.formatDate(c.scheduled_at) : '—'}</td>
          <td><span class="tag">${c.status}</span></td>
          <td>${c.sent_count || 0}</td>
          <td class="actions">
            <button class="btn btn-sm btn-primary wa-send-camp" data-id="${c.id}">Send Now</button>
            <button class="btn btn-sm btn-ghost wa-edit-camp" data-id="${c.id}">Edit</button>
            <button class="btn btn-sm btn-danger wa-del-camp" data-id="${c.id}">Delete</button>
          </td></tr>`;
      }).join('') || '<tr><td colspan="7" class="muted">No campaigns yet</td></tr>'}
      </tbody></table></div></div>`;

    document.getElementById('wa-new-camp')?.addEventListener('click', () => this.showCampaignForm());
    panel.querySelectorAll('.wa-edit-camp').forEach(b => b.addEventListener('click', () => {
      const c = this.campaigns.find(x => x.id == b.dataset.id);
      if (c) this.showCampaignForm(c);
    }));
    panel.querySelectorAll('.wa-del-camp').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Delete campaign?')) return;
      const r = await API.deleteWhatsAppCampaign(parseInt(b.dataset.id), this.app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      Utils.toast('Campaign deleted', 'success');
      this.render(document.getElementById('page-content'), this.app);
    }));
    panel.querySelectorAll('.wa-send-camp').forEach(b => b.addEventListener('click', () =>
      this.runCampaignSend(parseInt(b.dataset.id))));
  },

  showCampaignForm(camp = null) {
    const custTpl = this.templates.filter(t => t.category === 'customer' && t.is_active);
    Utils.showModal(camp ? 'Edit Campaign' : 'New Campaign', `
      <div class="field"><label>Campaign Name</label><input id="wa-camp-name" value="${this.esc(camp?.name || '')}"></div>
      <div class="field"><label>Template</label>
        <select id="wa-camp-tpl">${custTpl.map(t =>
          `<option value="${t.id}" ${camp?.template_id == t.id ? 'selected' : ''}>${t.name}</option>`).join('')}</select></div>
      <div class="field"><label>Audience</label>
        <select id="wa-camp-aud">
          ${['all', 'branch', 'loyalty', 'birthdays', 'inactive', 'selected'].map(a =>
            `<option value="${a}" ${camp?.audience_filter === a ? 'selected' : ''}>${a}</option>`).join('')}
        </select></div>
      <div class="field" id="wa-camp-branch-wrap" style="display:none"><label>Branch</label>
        <select id="wa-camp-branch"><option value="">All branches</option>
          ${this.branches.map(b => `<option value="${b.id}">${b.name}</option>`).join('')}</select></div>
      <div class="field"><label>Schedule (optional)</label><input type="datetime-local" id="wa-camp-sched" value="${camp?.scheduled_at ? camp.scheduled_at.replace(' ', 'T').slice(0, 16) : ''}"></div>
      <button class="btn btn-ghost btn-sm" id="wa-preview-aud" type="button">Preview Audience</button>
      <p id="wa-aud-count" class="muted"></p>`,
      '<button class="btn btn-primary" id="wa-save-camp">Save Campaign</button>');

    const audSel = document.getElementById('wa-camp-aud');
    const branchWrap = document.getElementById('wa-camp-branch-wrap');
    const toggleBranch = () => { branchWrap.style.display = audSel.value === 'branch' ? '' : 'none'; };
    audSel.addEventListener('change', toggleBranch);
    toggleBranch();

    document.getElementById('wa-preview-aud').addEventListener('click', async () => {
      const filter = { type: audSel.value };
      if (audSel.value === 'branch') filter.branch_id = parseInt(document.getElementById('wa-camp-branch').value) || null;
      if (audSel.value === 'loyalty') filter.min_points = 1;
      if (audSel.value === 'inactive') filter.inactive_days = 90;
      const r = await API.getWhatsAppAudience(filter);
      const list = r.data || [];
      document.getElementById('wa-aud-count').textContent = `${list.length} recipient(s) with phone numbers`;
    });

    document.getElementById('wa-save-camp').addEventListener('click', async () => {
      const sched = document.getElementById('wa-camp-sched').value;
      const data = {
        id: camp?.id,
        name: document.getElementById('wa-camp-name').value.trim(),
        template_id: parseInt(document.getElementById('wa-camp-tpl').value),
        audience_filter: audSel.value,
        audience: audSel.value === 'branch'
          ? { branch_id: parseInt(document.getElementById('wa-camp-branch').value) || null } : {},
        scheduled_at: sched ? sched.replace('T', ' ') + ':00' : null,
        status: sched ? 'scheduled' : 'draft',
        branch_id: parseInt(document.getElementById('wa-camp-branch').value) || null
      };
      const r = await API.saveWhatsAppCampaign(data, this.app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      Utils.hideModal();
      Utils.toast('Campaign saved', 'success');
      this.render(document.getElementById('page-content'), this.app);
    });
  },

  async runCampaignSend(campaignId) {
    if (!confirm('Send this campaign? Messages will be logged and wa.me links prepared for each recipient.')) return;
    const r = await API.sendWhatsAppCampaign(campaignId, this.app.user);
    if (!r.success) return Utils.toast(r.error, 'error');
    const data = r.data || {};
    Utils.toast(`Campaign sent — ${data.sent_count || 0} message(s) logged`, 'success');
    if (data.recipients?.length === 1) {
      window.open(data.recipients[0].url, '_blank');
      await API.markWhatsAppOpened(data.recipients[0].id, this.app.user);
    } else if (data.recipients?.length > 1) {
      this.showCampaignResults(data.recipients);
    }
    this.render(document.getElementById('page-content'), this.app);
  },

  showCampaignResults(recipients) {
    Utils.showModal('Campaign Recipients', `
      <p class="muted">Open each WhatsApp chat manually. Messages are logged in History.</p>
      <div style="max-height:320px;overflow:auto">${recipients.map(r =>
        `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">
          <span>${r.name} · ${r.phone}</span>
          <button class="btn btn-sm btn-primary wa-open-link" data-id="${r.id}" data-url="${encodeURIComponent(r.url)}">Open</button>
        </div>`).join('')}</div>`,
      '<button class="btn btn-ghost" onclick="Utils.hideModal()">Close</button>');
    document.querySelectorAll('.wa-open-link').forEach(b => b.addEventListener('click', async () => {
      window.open(decodeURIComponent(b.dataset.url), '_blank');
      await API.markWhatsAppOpened(parseInt(b.dataset.id), this.app.user);
    }));
  },

  async renderCustomers(panel) {
    const custRes = await API.getCustomers();
    this.customers = (custRes.data || []).filter(c => c.phone);
    const custTpl = this.templates.filter(t => t.category === 'customer' && t.is_active);

    panel.innerHTML = `<div class="card" style="margin-top:12px"><div class="card-body">
      <h4 style="margin:0 0 12px">Quick Send to Customer</h4>
      <div class="form-grid">
        <div class="field"><label>Customer</label>
          <select id="wa-cust-pick"><option value="">— Select —</option>
            ${this.customers.map(c => `<option value="${c.id}">${c.name} (${c.phone})</option>`).join('')}
          </select></div>
        <div class="field"><label>Template</label>
          <select id="wa-cust-tpl"><option value="">Custom message</option>
            ${custTpl.map(t => `<option value="${t.id}">${t.name}</option>`).join('')}
          </select></div>
        <div class="field full"><label>Message (or template preview)</label>
          <textarea id="wa-cust-body" rows="4" style="width:100%"></textarea></div>
        <div class="field"><label>Promotion Name</label><input id="wa-cust-promo"></div>
        <div class="field"><label>Voucher Code</label><input id="wa-cust-voucher"></div>
      </div>
      <button class="btn btn-primary" id="wa-cust-send">Send WhatsApp</button>
    </div></div>`;

    const tplSel = document.getElementById('wa-cust-tpl');
    const bodyEl = document.getElementById('wa-cust-body');
    tplSel.addEventListener('change', () => {
      const t = custTpl.find(x => x.id == tplSel.value);
      bodyEl.value = t?.body || '';
    });

    document.getElementById('wa-cust-send').addEventListener('click', async () => {
      const custId = parseInt(document.getElementById('wa-cust-pick').value);
      const c = this.customers.find(x => x.id === custId);
      if (!c) return Utils.toast('Select a customer with a phone number', 'error');
      const tplId = parseInt(tplSel.value) || null;
      const tpl = tplId ? custTpl.find(x => x.id === tplId) : null;
      const r = await API.sendWhatsAppMessage({
        phone: c.phone,
        customer_id: c.id,
        recipient_type: 'customer',
        recipient_name: c.name,
        customer_name: c.name,
        loyalty_points: Math.floor(c.loyalty_points || 0),
        branch: this.app.settings?.shop_name,
        message_type: tpl?.slug || 'custom',
        template_id: tplId,
        body: bodyEl.value.trim() || undefined,
        promotion_name: document.getElementById('wa-cust-promo').value.trim(),
        voucher_code: document.getElementById('wa-cust-voucher').value.trim()
      }, this.app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      window.open(r.data.url, '_blank');
      await API.markWhatsAppOpened(r.data.id, this.app.user);
      Utils.toast('WhatsApp opened — message logged', 'success');
    });
  },

  async renderCustomerNumbers(panel) {
    const from = this._custNumFrom || Utils.daysAgo(30);
    const to = this._custNumTo || Utils.today();
    const currency = this.currency || 'R';
    const res = await API.getCustomerPhoneReport({ from, to });
    const rows = res.data || [];

    panel.innerHTML = `<div class="card" style="margin-top:12px"><div class="card-body">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;margin-bottom:12px">
        <div>
          <h4 style="margin:0">Customer WhatsApp Numbers</h4>
          <p class="muted" style="margin:4px 0 0">Customers with phone numbers from POS sales — filter by visit date range.</p>
        </div>
        <button class="btn btn-primary" id="wa-num-pdf">Export PDF</button>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:end;margin-bottom:12px">
        <div class="field"><label>From</label><input type="date" id="wa-num-from" value="${from}"></div>
        <div class="field"><label>To</label><input type="date" id="wa-num-to" value="${to}"></div>
        <button class="btn btn-ghost" id="wa-num-filter">Filter</button>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Name</th><th>Phone</th><th>Last Visit</th><th>Visits</th><th>Total Spent</th><th></th></tr></thead>
        <tbody>${rows.map(r => `<tr>
          <td>${this.esc(r.name)}</td>
          <td>${this.esc(r.phone)}</td>
          <td>${r.last_visit ? Utils.formatDateTime(r.last_visit) : '—'}</td>
          <td>${r.visit_count || 0}</td>
          <td>${Utils.formatMoney(r.total_spent || 0, currency)}</td>
          <td><button class="btn btn-sm btn-success wa-num-row" data-phone="${this.esc(r.phone)}" data-name="${this.esc(r.name)}">WhatsApp</button></td>
        </tr>`).join('') || '<tr><td colspan="6" class="muted">No customers with phone numbers in this date range</td></tr>'}
        </tbody></table></div>
      <p class="muted" style="margin-top:8px;font-size:12px">${rows.length} customer(s) with phone numbers</p>
    </div></div>`;

    document.getElementById('wa-num-filter')?.addEventListener('click', () => {
      this._custNumFrom = document.getElementById('wa-num-from').value;
      this._custNumTo = document.getElementById('wa-num-to').value;
      this.renderCustomerNumbers(panel);
    });
    document.getElementById('wa-num-pdf')?.addEventListener('click', async () => {
      const f = document.getElementById('wa-num-from').value;
      const t = document.getElementById('wa-num-to').value;
      const buf = await API.getCustomerPhoneReportPdf({ from: f, to: t });
      if (!buf.success) return Utils.toast(buf.error, 'error');
      await API.saveFile(`customer-whatsapp-numbers-${f}-${t}.pdf`, [{ name: 'PDF', extensions: ['pdf'] }], buf.data);
      Utils.toast('PDF exported', 'success');
    });
    panel.querySelectorAll('.wa-num-row').forEach(btn => {
      btn.addEventListener('click', () => {
        const name = btn.dataset.name;
        const phone = btn.dataset.phone;
        const msg = `Hi ${name}, thank you for shopping with us at ${this.app.settings?.shop_name || 'our store'}!`;
        Utils.openWhatsApp(phone, msg);
      });
    });
  },

  async renderEmployees(panel) {
    const empRes = await API.getEmployees({ status: 'Active' });
    this.employees = (empRes.data || []).filter(e => e.phone);
    const empTpl = this.templates.filter(t => t.category === 'employee' && t.is_active);
    const isOwner = this.app.user?.role === 'owner';

    panel.innerHTML = `<div class="card" style="margin-top:12px"><div class="card-body">
      <h4 style="margin:0 0 12px">Employee Center</h4>
      <p class="muted">Send payslip, attendance, warning, or announcement messages to staff.</p>
      ${!isOwner ? '<p class="muted" style="color:var(--warning)">Payslip and warning templates require owner role.</p>' : ''}
      <div class="form-grid">
        <div class="field"><label>Employee</label>
          <select id="wa-emp-pick"><option value="">— Select —</option>
            ${this.employees.map(e => `<option value="${e.id}">${e.full_name || e.name} (${e.phone})</option>`).join('')}
          </select></div>
        <div class="field"><label>Template</label>
          <select id="wa-emp-tpl">${empTpl.map(t =>
            `<option value="${t.id}">${t.name}${['payslip', 'warning'].includes(t.slug) ? ' (owner)' : ''}</option>`).join('')}
          </select></div>
        <div class="field full"><label>Message</label><textarea id="wa-emp-body" rows="4" style="width:100%">${this.esc(empTpl[0]?.body || '')}</textarea></div>
        <div class="field"><label>Pay Period / Date</label><input id="wa-emp-date" value="${Utils.today()}"></div>
        <div class="field"><label>Extra (Net Pay / Status / Reason / Announcement)</label><input id="wa-emp-extra"></div>
      </div>
      <button class="btn btn-primary" id="wa-emp-send">Send WhatsApp</button>
    </div></div>`;

    const tplSel = document.getElementById('wa-emp-tpl');
    const bodyEl = document.getElementById('wa-emp-body');
    tplSel.addEventListener('change', () => {
      const t = empTpl.find(x => x.id == tplSel.value);
      bodyEl.value = t?.body || '';
    });

    document.getElementById('wa-emp-send').addEventListener('click', async () => {
      const empId = parseInt(document.getElementById('wa-emp-pick').value);
      const e = this.employees.find(x => x.id === empId);
      if (!e) return Utils.toast('Select an employee with a phone number', 'error');
      const tpl = empTpl.find(x => x.id == tplSel.value);
      const extra = document.getElementById('wa-emp-extra').value.trim();
      const payload = {
        phone: e.phone,
        employee_id: e.id,
        recipient_type: 'employee',
        recipient_name: e.full_name || e.name,
        employee_name: e.full_name || e.name,
        branch: e.branch || this.app.settings?.shop_name,
        message_type: tpl?.slug || 'announcement',
        template_id: tpl?.id,
        body: bodyEl.value.trim() || undefined,
        date: document.getElementById('wa-emp-date').value,
        pay_period: document.getElementById('wa-emp-date').value,
        net_pay: tpl?.slug === 'payslip' ? extra : undefined,
        attendance_status: tpl?.slug === 'attendance' ? extra : undefined,
        warning_reason: tpl?.slug === 'warning' ? extra : undefined,
        announcement_text: tpl?.slug === 'announcement' ? extra : undefined
      };
      const r = await API.sendWhatsAppMessage(payload, this.app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      window.open(r.data.url, '_blank');
      await API.markWhatsAppOpened(r.data.id, this.app.user);
      Utils.toast('WhatsApp opened — message logged', 'success');
    });
  },

  async renderHistory(panel) {
    const from = Utils.daysAgo(30);
    const to = Utils.today();
    const msgRes = await API.getWhatsAppMessages({ from, to, limit: 200 });
    this.messages = msgRes.data || [];

    panel.innerHTML = `<div class="card" style="margin-top:12px"><div class="card-body">
      <div class="form-grid" style="margin-bottom:12px">
        <div class="field"><label>From</label><input type="date" id="wa-hist-from" value="${from}"></div>
        <div class="field"><label>To</label><input type="date" id="wa-hist-to" value="${to}"></div>
        <div class="field"><label>Type</label>
          <select id="wa-hist-type"><option value="">All</option>
            ${['thank_you', 'review_request', 'promotion', 'birthday', 'payslip', 'attendance', 'warning', 'announcement', 'gift_card', 'campaign', 'custom'].map(t =>
              `<option value="${t}">${t}</option>`).join('')}
          </select></div>
        <div class="field"><label>Status</label>
          <select id="wa-hist-status"><option value="">All</option>
            ${['pending', 'sent', 'opened', 'failed'].map(s => `<option value="${s}">${s}</option>`).join('')}
          </select></div>
        <div class="field"><label>Search</label><input id="wa-hist-search" placeholder="Name, phone, body…"></div>
        <div class="field" style="align-self:end"><button class="btn btn-primary" id="wa-hist-filter">Filter</button></div>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Date</th><th>Recipient</th><th>Phone</th><th>Type</th><th>Status</th><th>Sender</th><th>Preview</th><th></th></tr></thead>
        <tbody id="wa-hist-body">${this.renderHistoryRows()}</tbody>
      </table></div>
    </div></div>`;

    document.getElementById('wa-hist-filter').addEventListener('click', async () => {
      const r = await API.getWhatsAppMessages({
        from: document.getElementById('wa-hist-from').value,
        to: document.getElementById('wa-hist-to').value,
        message_type: document.getElementById('wa-hist-type').value || undefined,
        status: document.getElementById('wa-hist-status').value || undefined,
        search: document.getElementById('wa-hist-search').value.trim() || undefined,
        limit: 200
      });
      this.messages = r.data || [];
      document.getElementById('wa-hist-body').innerHTML = this.renderHistoryRows();
      this.bindHistoryOpen(panel);
    });
    this.bindHistoryOpen(panel);
  },

  renderHistoryRows() {
    return this.messages.map(m => {
      let meta = m.metadata;
      if (!meta && m.metadata_json) {
        try { meta = JSON.parse(m.metadata_json); } catch { meta = {}; }
      }
      meta = meta || {};
      return `<tr>
      <td>${Utils.formatDate(m.sent_at || m.created_at)}</td>
      <td>${m.recipient_name || '—'}</td>
      <td>${m.phone}</td>
      <td><span class="tag">${m.message_type}</span></td>
      <td>${m.status}</td>
      <td>${m.sender_name || '—'}</td>
      <td class="muted" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${this.esc((m.body || '').slice(0, 60))}</td>
      <td>${meta.url ? `<button class="btn btn-sm btn-ghost wa-hist-open" data-id="${m.id}" data-url="${encodeURIComponent(meta.url)}">Open</button>` : ''}</td>
    </tr>`;
    }).join('') || '<tr><td colspan="8" class="muted">No messages in this period</td></tr>';
  },

  bindHistoryOpen(panel) {
    panel.querySelectorAll('.wa-hist-open').forEach(b => b.addEventListener('click', async () => {
      window.open(decodeURIComponent(b.dataset.url), '_blank');
      await API.markWhatsAppOpened(parseInt(b.dataset.id), this.app.user);
    }));
  },

  async renderSettings(panel) {
    const s = this.settings;
    panel.innerHTML = `<div class="card" style="margin-top:12px"><div class="card-body">
      <h4 style="margin:0 0 12px">WhatsApp Business API (optional)</h4>
      <p class="muted">Manual wa.me links are used today. Save API credentials here for future automated sending.</p>
      <div class="form-grid">
        <div class="field"><label>API Key</label><input id="wa-set-api" type="password" value="${this.esc(s.api_key || '')}" placeholder="Future use"></div>
        <div class="field"><label>Phone Number ID</label><input id="wa-set-phone-id" value="${this.esc(s.phone_number_id || '')}"></div>
        <div class="field"><label>Business Account ID</label><input id="wa-set-biz-id" value="${this.esc(s.business_account_id || '')}"></div>
        <div class="field"><label>Cashout WhatsApp Number</label><input id="wa-set-cashout-phone" value="${this.esc(s.cashout_whatsapp_phone || '')}" placeholder="Admin/manager number for cash-out shares"></div>
        <div class="field"><label>Default Branch Phone</label><input id="wa-set-branch-phone" value="${this.esc(s.default_branch_phone || this.app.settings?.phone || '')}"></div>
        <div class="field"><label>Default Branch</label>
          <select id="wa-set-branch"><option value="">—</option>
            ${this.branches.map(b => `<option value="${b.id}" ${s.default_branch_id == b.id ? 'selected' : ''}>${b.name}</option>`).join('')}
          </select></div>
      </div>
      <button class="btn btn-primary" id="wa-save-settings">Save Settings</button>
    </div></div>`;

    document.getElementById('wa-save-settings').addEventListener('click', async () => {
      const data = {
        api_key: document.getElementById('wa-set-api').value.trim(),
        phone_number_id: document.getElementById('wa-set-phone-id').value.trim(),
        business_account_id: document.getElementById('wa-set-biz-id').value.trim(),
        cashout_whatsapp_phone: document.getElementById('wa-set-cashout-phone').value.trim(),
        default_branch_phone: document.getElementById('wa-set-branch-phone').value.trim(),
        default_branch_id: parseInt(document.getElementById('wa-set-branch').value) || null
      };
      const r = await API.saveWhatsAppSettings(data, this.app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      Utils.toast('WhatsApp settings saved', 'success');
      this.settings = r.data || data;
    });
  }
};
window.WhatsAppPage = WhatsAppPage;

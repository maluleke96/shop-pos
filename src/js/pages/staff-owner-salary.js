const StaffOwnerSalaryPage = {
  tab: 'overview',
  _cache: null,
  _cacheTab: null,

  canManage(user) {
    return user?.role === 'owner' || user?.role === 'manager';
  },

  async render(el, app) {
    this.el = el;
    this.app = app;
    const currency = app.settings?.currency || 'R';
    const canManage = this.canManage(app.user);

    if (this.tab === 'profile' && canManage) {
      const pr = await API.getOwnerSalaryProfile();
      this.renderShell(el, app, [], currency, canManage);
      return this.renderProfile(document.getElementById('os-content'), pr.data);
    }

    const cacheKey = `owner_salary_${this.tab}`;
    if (this._cacheTab === this.tab && this._cache && Utils.sessionCacheGet(cacheKey)) {
      this.data = this._cache;
    } else {
      const syncRes = await API.syncOwnerSalary();
      this.data = syncRes.data || {};
      this._cache = this.data;
      this._cacheTab = this.tab;
      Utils.sessionCacheSet(cacheKey, this.data);
    }
    const profile = this.data.profile;
    this.renderShell(el, app, this.data.notifications || [], currency, canManage);

    const content = document.getElementById('os-content');
    if (!profile && canManage) {
      content.innerHTML = `<div class="card"><div class="card-body"><p>No owner salary profile yet.</p>
        <button class="btn btn-primary" id="os-setup">Set Up Owner Profile</button></div></div>`;
      document.getElementById('os-setup').addEventListener('click', () => { this.tab = 'profile'; this.render(el, app); });
      return;
    }
    if (!profile) {
      content.innerHTML = '<p class="muted">Owner salary profile has not been set up yet. Ask the owner or manager.</p>';
      return;
    }

    const renderers = {
      overview: () => this.renderOverview(content, profile, currency),
      history: () => this.renderHistory(content, profile, currency),
      pay: () => this.renderPay(content, profile, currency),
      draws: () => this.renderDraws(content, profile, currency),
      reports: () => this.renderReports(content, profile, currency)
    };
    await (renderers[this.tab] || renderers.overview)();
  },

  renderShell(el, app, notifications, currency, canManage) {
    const tabs = [
      ['overview', 'Overview'], ['history', 'Salary History'], ['pay', 'Pay Salary'],
      ['draws', 'Owner Draws'], ['reports', 'Reports']
    ];
    if (canManage) tabs.unshift(['profile', 'Owner Profile']);

    el.innerHTML = `<div class="staff-owner-salary">
      <div class="page-toolbar"><h3>💼 Owner Salary</h3></div>
      ${notifications.length ? `<div style="margin-bottom:12px">${notifications.map(n =>
        `<div class="card" style="margin-bottom:8px;border-color:${n.type === 'overdue' ? 'var(--danger)' : 'var(--warning)'}">
          <div class="card-body" style="padding:10px 14px"><strong>${n.title}</strong><br><small>${n.message}</small></div></div>`).join('')}</div>` : ''}
      <div class="form-tabs" id="os-tabs">${tabs.map(([id, label]) =>
        `<button type="button" class="form-tab ${this.tab === id ? 'active' : ''}" data-tab="${id}">${label}</button>`).join('')}</div>
      <div id="os-content"><p class="muted">Loading…</p></div>
    </div>`;

    el.querySelector('#os-tabs').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-tab]');
      if (!btn || btn.dataset.tab === this.tab) return;
      this.tab = btn.dataset.tab;
      this.render(el, app);
    });
  },

  async renderProfile(el, existing) {
    const p = existing || {};
    const isWeekly = p.salary_type === 'weekly';
    const empRes = await API.getEmployees({ status: 'Active' }).catch(() => ({ success: false }));
    const employees = empRes.data || [];
    const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const paymentDayField = isWeekly
      ? `<select id="os-pday">${weekdays.map((d, i) =>
          `<option value="${i}" ${Number(p.payment_day ?? 5) === i ? 'selected' : ''}>${d}</option>`).join('')}</select>
         <small class="muted">Day of the week when owner salary is due (triggers admin notification)</small>`
      : `<input type="number" id="os-pday" min="1" max="28" value="${p.payment_day ?? 25}">
         <small class="muted">Day of the month when owner salary is due (1–28, triggers admin notification)</small>`;

    el.innerHTML = `<div class="card"><div class="card-body"><h4>Owner Profile</h4><div class="form-grid">
      <div class="field"><label>Owner Name *</label><input id="os-name" value="${p.owner_name || ''}"></div>
      <div class="field"><label>Position</label><input id="os-pos" value="${p.position || 'Owner'}"></div>
      <div class="field"><label>Salary Type</label>
        <select id="os-type"><option value="monthly" ${!isWeekly ? 'selected' : ''}>Monthly</option>
        <option value="weekly" ${isWeekly ? 'selected' : ''}>Weekly</option></select></div>
      <div class="field"><label>Basic Salary</label><input type="number" id="os-basic" step="0.01" value="${p.basic_salary || 0}"></div>
      <div class="field" id="os-pday-wrap"><label>Payment Day</label>${paymentDayField}</div>
      <div class="field"><label>Custom Pay Date (optional override)</label><input type="date" id="os-custom" value="${p.custom_pay_date || ''}"></div>
      <div class="field"><label>Default Bonus</label><input type="number" id="os-bonus" step="0.01" value="${p.default_bonus || 0}"></div>
      <div class="field"><label>Default Allowances</label><input type="number" id="os-allow" step="0.01" value="${p.default_allowances || 0}"></div>
      <div class="field"><label>Default Deductions</label><input type="number" id="os-ded" step="0.01" value="${p.default_deductions || 0}"></div>
      <div class="field"><label>Linked Employee Record</label>
        <select id="os-employee"><option value="">— None —</option>
          ${employees.map(e => `<option value="${e.id}" ${p.employee_id == e.id ? 'selected' : ''}>${e.full_name}</option>`).join('')}
        </select><small class="muted">Links owner to employee record for UIF/tax registration</small></div>
      <div class="field"><label>UIF Registration No.</label><input id="os-uif-reg" value="${p.uif_registration || ''}"></div>
      <div class="field"><label>Tax Number</label><input id="os-tax-no" value="${p.tax_number || ''}"></div>
      <div class="field"><label><input type="checkbox" id="os-uif-enabled" ${p.uif_enabled !== 0 ? 'checked' : ''}> Auto-calculate UIF on payslip</label></div>
      <div class="field"><label><input type="checkbox" id="os-paye-enabled" ${p.paye_enabled !== 0 ? 'checked' : ''}> Auto-calculate PAYE on payslip</label></div>
      <div class="field full"><label><input type="checkbox" id="os-active" ${p.is_active !== 0 ? 'checked' : ''}> Active</label></div>
    </div>
    <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-primary" id="os-save-profile">Save Profile</button>
      ${existing?.id ? '<button class="btn btn-danger" id="os-delete-profile">Delete Profile</button>' : ''}
    </div></div></div>`;

    const refreshPaymentDay = () => {
      const weekly = document.getElementById('os-type').value === 'weekly';
      const wrap = document.getElementById('os-pday-wrap');
      wrap.innerHTML = weekly
        ? `<label>Payment Day</label><select id="os-pday">${weekdays.map((d, i) =>
            `<option value="${i}" ${i === 5 ? 'selected' : ''}>${d}</option>`).join('')}</select>
           <small class="muted">Day of the week when owner salary is due (triggers admin notification)</small>`
        : `<label>Payment Day</label><input type="number" id="os-pday" min="1" max="28" value="25">
           <small class="muted">Day of the month when owner salary is due (1–28, triggers admin notification)</small>`;
    };
    document.getElementById('os-type').addEventListener('change', refreshPaymentDay);

    document.getElementById('os-save-profile').addEventListener('click', async () => {
      const btn = document.getElementById('os-save-profile');
      btn.disabled = true;
      btn.textContent = 'Saving…';
      const salaryType = document.getElementById('os-type').value;
      const r = await API.saveOwnerSalaryProfile({
        owner_name: document.getElementById('os-name').value.trim(),
        position: document.getElementById('os-pos').value.trim(),
        salary_type: salaryType,
        basic_salary: parseFloat(document.getElementById('os-basic').value) || 0,
        payment_day: parseInt(document.getElementById('os-pday').value, 10),
        custom_pay_date: document.getElementById('os-custom').value || null,
        default_bonus: parseFloat(document.getElementById('os-bonus').value) || 0,
        default_allowances: parseFloat(document.getElementById('os-allow').value) || 0,
        default_deductions: parseFloat(document.getElementById('os-ded').value) || 0,
        employee_id: parseInt(document.getElementById('os-employee')?.value, 10) || null,
        uif_registration: document.getElementById('os-uif-reg')?.value.trim() || null,
        tax_number: document.getElementById('os-tax-no')?.value.trim() || null,
        uif_enabled: document.getElementById('os-uif-enabled')?.checked !== false,
        paye_enabled: document.getElementById('os-paye-enabled')?.checked !== false,
        is_active: document.getElementById('os-active').checked
      }, this.app.user);
      btn.disabled = false;
      btn.textContent = 'Save Profile';
      if (!r.success) return Utils.toast(r.error, 'error');
      Utils.toast('Owner profile saved', 'success');
      this.tab = 'overview';
      this.app.loadNotifications?.();
      this.render(this.el, this.app);
    });

    document.getElementById('os-delete-profile')?.addEventListener('click', async () => {
      if (!confirm('Delete the owner salary profile and all salary history? This cannot be undone.')) return;
      const r = await API.deleteOwnerSalaryProfile(this.app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      Utils.toast('Owner profile deleted', 'success');
      this.tab = 'overview';
      this.render(this.el, this.app);
      this.app.loadNotifications?.();
    });
  },

  renderOverview(el, profile, currency) {
    const outstanding = this.data.outstanding || 0;
    const periods = this.data.periods || [];
    const current = periods[0];
    el.innerHTML = `<div class="stats-grid">
      <div class="stat-card"><div class="label">Owner</div><div class="value" style="font-size:18px">${profile.owner_name}</div></div>
      <div class="stat-card"><div class="label">Salary Type</div><div class="value" style="font-size:18px;text-transform:capitalize">${profile.salary_type}</div></div>
      <div class="stat-card"><div class="label">Basic Salary</div><div class="value">${Utils.formatMoney(profile.basic_salary, currency)}</div></div>
      <div class="stat-card" style="${outstanding > 0 ? 'border-color:var(--warning)' : ''}"><div class="label">Outstanding Balance</div>
        <div class="value" style="color:${outstanding > 0 ? 'var(--danger)' : 'inherit'}">${Utils.formatMoney(outstanding, currency)}</div></div>
    </div>
    ${current ? `<div class="card" style="margin-top:16px"><div class="card-body">
      <h4>Current Pay Period</h4>
      <p><strong>${current.period_start} – ${current.period_end}</strong> (${current.period_type})</p>
      <p>Gross: ${Utils.formatMoney(current.gross_amount, currency)} · Net: ${Utils.formatMoney(current.net_pay ?? current.outstanding_balance, currency)} · Paid: ${Utils.formatMoney(current.amount_paid, currency)} · Due: ${Utils.formatMoney(current.outstanding_balance, currency)}</p>
      ${Number(current.paye) > 0 || Number(current.uif_employee) > 0 || Number(current.draw_deductions) > 0 ? `<p class="muted">Deductions — PAYE: ${Utils.formatMoney(current.paye, currency)} · UIF: ${Utils.formatMoney(current.uif_employee, currency)} · Draws: ${Utils.formatMoney(current.draw_deductions, currency)}</p>` : ''}
      <p class="muted">Payment due: ${current.due_date || '—'} · Payslip: ${current.payslip_number}</p>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="btn btn-primary btn-sm" id="os-view-slip" data-id="${current.id}">View Payslip</button>
        <button class="btn btn-ghost btn-sm" id="os-dl-slip" data-id="${current.id}">Download PDF</button>
      </div></div></div>` : ''}`;
    el.querySelector('#os-view-slip')?.addEventListener('click', (e) => this.viewPayslip(parseInt(e.target.dataset.id), currency));
    el.querySelector('#os-dl-slip')?.addEventListener('click', (e) => this.downloadPayslip(parseInt(e.target.dataset.id)));
  },

  async renderHistory(el, profile, currency) {
    const periods = this.data.periods || [];
    el.innerHTML = `<div class="table-wrap"><table><thead><tr>
      <th>Pay Period</th><th>Type</th><th>Gross</th><th>Paid</th><th>Outstanding</th><th>Due Date</th><th>Status</th><th></th></tr></thead>
      <tbody>${periods.map(p => `<tr><td>${p.period_start} – ${p.period_end}</td><td>${p.period_type}</td>
        <td>${Utils.formatMoney(p.gross_amount, currency)}</td><td>${Utils.formatMoney(p.amount_paid, currency)}</td>
        <td>${Utils.formatMoney(p.outstanding_balance, currency)}</td><td>${p.due_date || '—'}</td>
        <td><span class="tag ${p.status === 'paid' ? 'tag-ok' : p.status === 'partially_paid' ? 'tag-low' : 'tag-out'}">${p.status.replace('_', ' ')}</span></td>
        <td><button class="btn btn-sm btn-ghost os-slip" data-id="${p.id}">Payslip</button></td></tr>`).join('') || '<tr><td colspan="8" class="muted">No salary history yet</td></tr>'}
      </tbody></table></div>`;
    el.querySelectorAll('.os-slip').forEach(b => b.addEventListener('click', () => this.downloadPayslip(parseInt(b.dataset.id))));
  },

  renderPay(el, profile, currency) {
    const outstanding = this.data.outstanding || 0;
    const unpaid = (this.data.periods || []).filter(p => p.outstanding_balance > 0);
    el.innerHTML = `<div class="card"><div class="card-body">
      <p>Total outstanding: <strong>${Utils.formatMoney(outstanding, currency)}</strong></p>
      ${unpaid.length ? `<p class="muted">Select periods to pay (leave all checked to pay oldest first).</p>
        <div style="margin:12px 0">${unpaid.map(p => `<label style="display:block;padding:4px 0">
          <input type="checkbox" class="os-period" value="${p.id}" checked> ${p.period_start}–${p.period_end} — ${Utils.formatMoney(p.outstanding_balance, currency)} outstanding</label>`).join('')}</div>` : '<p class="muted">No outstanding salaries.</p>'}
      <div class="form-grid" style="margin-top:12px">
        <div class="field"><label>Payment Date</label><input type="date" id="os-pay-date" value="${Utils.today()}"></div>
        <div class="field"><label>Amount (${currency})</label><input type="number" id="os-pay-amt" step="0.01" value="${outstanding || ''}"></div>
        <div class="field"><label>Payment Method</label>
          <select id="os-pay-method"><option value="cash">Cash</option><option value="eft">EFT</option><option value="bank_transfer">Bank Transfer</option></select></div>
        <div class="field"><label>Payment Reference</label><input id="os-pay-ref" placeholder="Optional"></div>
        <div class="field full"><label>Notes</label><input id="os-pay-notes"></div>
      </div>
      <button class="btn btn-primary" id="os-pay-btn" style="margin-top:16px" ${!outstanding ? 'disabled' : ''}>Pay Owner Salary</button>
    </div></div>`;
    document.getElementById('os-pay-btn')?.addEventListener('click', async () => {
      const period_ids = [...document.querySelectorAll('.os-period:checked')].map(c => parseInt(c.value));
      const amount = parseFloat(document.getElementById('os-pay-amt').value);
      if (!amount) return Utils.toast('Enter payment amount', 'error');
      const r = await API.payOwnerSalary({
        amount, period_ids,
        payment_date: document.getElementById('os-pay-date').value,
        payment_method: document.getElementById('os-pay-method').value,
        payment_reference: document.getElementById('os-pay-ref').value.trim(),
        notes: document.getElementById('os-pay-notes').value.trim()
      }, this.app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      Utils.toast('Owner salary payment recorded', 'success');
      this.app.loadNotifications?.();
      this.render(this.el, this.app);
    });
  },

  renderDraws(el, profile, currency) {
    const draws = this.data.draws || [];
    el.innerHTML = `<div class="card"><div class="card-body">
      <h4>Owner Draws / Account Charges</h4>
      <p class="muted">Track cash, food, or other amounts taken by the owner — deducted from the next payslip.</p>
      <div class="form-grid" style="margin:12px 0">
        <div class="field"><label>Date</label><input type="date" id="od-date" value="${Utils.today()}"></div>
        <div class="field"><label>Type</label>
          <select id="od-type"><option value="cash">Cash</option><option value="food">Food</option><option value="other">Other</option></select></div>
        <div class="field"><label>Amount (${currency})</label><input type="number" id="od-amt" step="0.01" min="0"></div>
        <div class="field full"><label>Description</label><input id="od-desc" placeholder="Optional notes"></div>
      </div>
      <button class="btn btn-primary" id="od-add">Record Draw</button>
      <div class="table-wrap" style="margin-top:16px"><table><thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>Description</th><th></th></tr></thead>
      <tbody>${draws.map(d => `<tr><td>${d.draw_date}</td><td>${d.draw_type}</td>
        <td>${Utils.formatMoney(d.amount, currency)}</td><td>${d.description || '—'}</td>
        <td><button class="btn btn-sm btn-danger od-del" data-id="${d.id}">Delete</button></td></tr>`).join('')
        || '<tr><td colspan="5" class="muted">No draws recorded</td></tr>'}
      </tbody></table></div></div></div>`;
    document.getElementById('od-add')?.addEventListener('click', async () => {
      const amount = parseFloat(document.getElementById('od-amt').value);
      if (!amount) return Utils.toast('Enter draw amount', 'error');
      const r = await API.addOwnerDraw({
        draw_date: document.getElementById('od-date').value,
        draw_type: document.getElementById('od-type').value,
        amount,
        description: document.getElementById('od-desc').value.trim()
      }, this.app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      Utils.toast('Owner draw recorded', 'success');
      this._cache = null;
      this.render(this.el, this.app);
    });
    el.querySelectorAll('.od-del').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Delete this draw record?')) return;
      const r = await API.deleteOwnerDraw(parseInt(b.dataset.id, 10), this.app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      Utils.toast('Draw deleted', 'success');
      this._cache = null;
      this.render(this.el, this.app);
    }));
  },

  renderReports(el, profile, currency) {
    el.innerHTML = `<div class="card"><div class="card-body">
      ${Utils.dateFilterHTML('os-report-filter', Utils.daysAgo(30), Utils.today())}
      <p class="muted" style="margin-top:8px">Reports print to the A4 printer configured in Admin → Printer Setup → Invoice (A4).</p>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:16px">
        <button class="btn btn-ghost os-rpt" data-type="monthly">Monthly Report</button>
        <button class="btn btn-ghost os-rpt" data-type="weekly">Weekly Report</button>
        <button class="btn btn-ghost os-rpt" data-type="outstanding">Outstanding Report</button>
        <button class="btn btn-ghost os-rpt" data-type="payments">Payment History</button>
        <button class="btn btn-ghost os-rpt" data-type="annual">Annual Summary</button>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px">
        <button class="btn btn-primary os-rpt-print" data-type="monthly">Print Monthly (A4)</button>
        <button class="btn btn-primary os-rpt-print" data-type="outstanding">Print Outstanding (A4)</button>
        <button class="btn btn-primary os-rpt-print" data-type="payments">Print Payments (A4)</button>
      </div></div></div>`;
    let from = Utils.daysAgo(30), to = Utils.today();
    Utils.bindDateFilter('os-report-filter', (f, t) => { from = f; to = t; });
    el.querySelectorAll('.os-rpt').forEach(b => b.addEventListener('click', async () => {
      const buf = await API.getOwnerSalaryReportPdf(b.dataset.type, from, to);
      if (buf.success) {
        await API.saveFile(`owner-salary-${b.dataset.type}.pdf`, [{ name: 'PDF', extensions: ['pdf'] }], buf.data);
        Utils.toast('Report downloaded', 'success');
      } else Utils.toast(buf.error || 'Export failed', 'error');
    }));
    el.querySelectorAll('.os-rpt-print').forEach(b => b.addEventListener('click', () =>
      this.printOwnerReport(b.dataset.type, from, to, profile, currency)));
  },

  async printOwnerReport(type, from, to, profile, currency) {
    const res = await API.getOwnerSalaryReport(type, from, to);
    const rows = res.data || [];
    const shop = this.app.settings?.shop_name || 'Shop POS';
    let head = '';
    let body = '';
    if (type === 'payments') {
      head = '<tr><th>Date</th><th>Amount</th><th>Method</th><th>Reference</th><th>Notes</th></tr>';
      body = rows.map(r => `<tr><td>${r.payment_date || '—'}</td><td>${Utils.formatMoney(r.total_amount ?? r.amount, currency)}</td>
        <td>${r.payment_method || '—'}</td><td>${r.payment_reference || '—'}</td><td>${r.notes || '—'}</td></tr>`).join('');
    } else if (type === 'outstanding') {
      head = '<tr><th>Period</th><th>Gross</th><th>Paid</th><th>Outstanding</th><th>Status</th></tr>';
      body = rows.map(r => `<tr><td>${r.period_start} – ${r.period_end}</td><td>${Utils.formatMoney(r.gross_amount, currency)}</td>
        <td>${Utils.formatMoney(r.amount_paid, currency)}</td><td>${Utils.formatMoney(r.outstanding_balance, currency)}</td><td>${r.status}</td></tr>`).join('');
    } else {
      head = '<tr><th>Period</th><th>Type</th><th>Gross</th><th>Paid</th><th>Outstanding</th><th>Status</th></tr>';
      body = rows.map(r => `<tr><td>${r.period_start} – ${r.period_end}</td><td>${r.period_type || '—'}</td>
        <td>${Utils.formatMoney(r.gross_amount, currency)}</td><td>${Utils.formatMoney(r.amount_paid, currency)}</td>
        <td>${Utils.formatMoney(r.outstanding_balance, currency)}</td><td>${r.status}</td></tr>`).join('');
    }
    const totalOutstanding = rows.reduce((s, r) => s + Number(r.outstanding_balance || r.amount || 0), 0);
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Owner Salary Report</title></head>
      <body style="font-family:Arial,sans-serif;padding:24px;color:#111">
      <h2 style="margin:0 0 4px">${shop}</h2>
      <h3 style="margin:0 0 12px">Owner Salary — ${type.replace('_', ' ')}</h3>
      <p style="margin:0 0 16px;color:#555">Owner: ${profile?.owner_name || '—'} · ${from || '—'} to ${to || '—'}</p>
      <table style="width:100%;border-collapse:collapse;font-size:12px" border="1" cellpadding="6">
      <thead>${head}</thead><tbody>${body || '<tr><td colspan="6">No records</td></tr>'}</tbody></table>
      <p style="margin-top:16px;font-weight:bold">Total: ${Utils.formatMoney(totalOutstanding, currency)}</p>
      <p style="color:#888;font-size:11px">Generated ${new Date().toLocaleString()}</p></body></html>`;
    const pr = await API.printA4(html);
    if (pr.success) Utils.toast('Report sent to A4 printer', 'success');
    else Utils.toast(pr.error || 'Print failed — configure A4 printer in Admin', 'error');
  },

  async viewPayslip(periodId, currency) {
    const periods = this.data.periods || [];
    const p = periods.find(x => x.id === periodId);
    if (!p) return;
    const profile = this.data.profile;
    const net = p.net_pay ?? p.outstanding_balance;
    Utils.showModal(`Payslip ${p.payslip_number}`, `
      <p><strong>Period:</strong> ${p.period_start} – ${p.period_end}</p>
      <p><strong>Gross:</strong> ${Utils.formatMoney(p.gross_amount, currency)}</p>
      <p><strong>PAYE:</strong> ${Utils.formatMoney(p.paye, currency)} · <strong>UIF:</strong> ${Utils.formatMoney(p.uif_employee, currency)}</p>
      <p><strong>Owner Draws:</strong> ${Utils.formatMoney(p.draw_deductions, currency)} · <strong>Other:</strong> ${Utils.formatMoney(p.deductions, currency)}</p>
      <p><strong>Net Pay:</strong> ${Utils.formatMoney(net, currency)}</p>
      <p><strong>Paid:</strong> ${Utils.formatMoney(p.amount_paid, currency)}</p>
      <p><strong>Outstanding:</strong> ${Utils.formatMoney(p.outstanding_balance, currency)}</p>
      <p><strong>Status:</strong> ${p.status.replace('_', ' ')}</p>`,
      `<button class="btn btn-primary" id="os-modal-dl">Download PDF</button>
       <button class="btn btn-ghost" id="os-modal-print">Print</button>
       <button class="btn btn-success" id="os-modal-wa">WhatsApp</button>
       <button class="btn btn-ghost" id="os-modal-close">Close</button>`);
    document.getElementById('os-modal-close')?.addEventListener('click', Utils.hideModal);
    document.getElementById('os-modal-dl')?.addEventListener('click', () => { Utils.hideModal(); this.downloadPayslip(periodId); });
    document.getElementById('os-modal-print')?.addEventListener('click', async () => {
      const buf = await API.getOwnerSalaryPayslipPdf(periodId);
      if (!buf.success) return Utils.toast(buf.error || 'Print failed', 'error');
      await API.openPdf(buf.data, `owner-payslip-${periodId}.pdf`);
      Utils.toast('Payslip opened — use Print in PDF viewer', 'success');
    });
    document.getElementById('os-modal-wa')?.addEventListener('click', async () => {
      const phone = this.app.settings?.phone || Utils.getCashoutWhatsAppPhone(this.app.settings);
      if (!phone) return Utils.toast('No WhatsApp phone configured in settings', 'error');
      const shop = this.app.settings?.shop_name || 'Shop POS';
      const msg = `${shop} — Owner Payslip ${p.payslip_number}\nPeriod: ${p.period_start} – ${p.period_end}\nGross: ${Utils.formatMoney(p.gross_amount, currency)}\nPAYE: ${Utils.formatMoney(p.paye, currency)} · UIF: ${Utils.formatMoney(p.uif_employee, currency)}\nDraws: ${Utils.formatMoney(p.draw_deductions, currency)}\nNet: ${Utils.formatMoney(net, currency)}\nOutstanding: ${Utils.formatMoney(p.outstanding_balance, currency)}`;
      if (['owner', 'manager'].includes(this.app.user?.role)) {
        const waRes = await API.sendWhatsAppMessage({
          phone, recipient_name: profile?.owner_name, message_type: 'payslip', template_slug: 'payslip',
          pay_period: `${p.period_start} – ${p.period_end}`, gross_pay: p.gross_amount,
          paye_amount: p.paye, uif_amount: p.uif_employee, net_pay: net
        }, this.app.user).catch(() => ({ success: false }));
        if (waRes.success && waRes.data?.url) {
          window.open(waRes.data.url, '_blank');
          return;
        }
      }
      Utils.openWhatsApp(phone, msg);
    });
  },

  async downloadPayslip(periodId) {
    const buf = await API.getOwnerSalaryPayslipPdf(periodId);
    if (buf.success) {
      await API.saveFile(`owner-payslip-${periodId}.pdf`, [{ name: 'PDF', extensions: ['pdf'] }], buf.data);
      Utils.toast('Payslip saved', 'success');
    } else Utils.toast(buf.error || 'Failed', 'error');
  }
};
window.StaffOwnerSalaryPage = StaffOwnerSalaryPage;

// Admin Staff / HR Management
(function () {
  if (!window.AdminPage) return;

  async function saveStaffPdf(filename, buf) {
    return Utils.savePdfBuffer(filename, buf);
  }

  async function printStaffA4(html, title) {
    const pr = await Utils.printToA4(html);
    if (pr?.success) return true;
    const preview = await API.printPreview?.(html, title || 'Print');
    if (preview?.success) {
      Utils.toast('Print preview opened — use Print there', 'success');
      return true;
    }
    return false;
  }

  if (!AdminPage.sections.some(s => s.id === 'onaccount')) {
    AdminPage.sections.splice(3, 0,
      { id: 'onaccount', label: '📒 On Account', icon: 'onaccount' },
      { id: 'staffhr', label: '👷 Staff & HR', icon: 'staffhr' }
    );
  }

  const origRenderSection = AdminPage.renderSection.bind(AdminPage);
  AdminPage.renderSection = async function (el) {
    if (this.section === 'onaccount') return this.renderOnAccount(el);
    if (this.section === 'staffhr') return this.renderStaffHR(el);
    if (this.section === 'staffportal') return this.renderStaffPortalHub(el);
    return origRenderSection(el);
  };

  AdminPage.renderStaffPortalHub = async function (el) {
    if (window.App?.ensurePageScripts) {
      try { await App.ensurePageScripts('staff'); } catch (_) { /* ignore */ }
      try { await App.ensureFeatureScript?.('js/staff-selfie-ui.js'); } catch (_) { /* ignore */ }
    }
    if (!window.StaffPage?.renderAdminHub) {
      el.innerHTML = `<div class="admin-section"><h3>Staff Portal</h3>
        <p class="muted">Staff Portal module not loaded. Open <strong>Staff Portal</strong> from the main sidebar once, then try again.</p></div>`;
      return;
    }
    StaffPage._embeddedInAdmin = true;
    StaffPage.app = this.app;
    StaffPage.el = el;
    StaffPage.unlocked = true;
    const openId = this._openPortalEmployeeId;
    this._openPortalEmployeeId = null;
    if (openId) return StaffPage.openEmployeeAsAdmin(openId, el);
    StaffPage.employee = null;
    StaffPage._adminOverride = false;
    StaffPage._forceWorkerLogin = false;
    return StaffPage.renderAdminHub(el);
  };

  AdminPage.renderOnAccount = async function (el) {
    const as = this.settings.account_settings || {};
    const pm = this.settings.payment_settings || {};
    const custRes = await API.getCustomers();
    const customers = custRes.data || [];
    const currency = this.settings.currency || 'R';
    el.innerHTML = `<div class="admin-section"><h3>On Account Settings</h3>
      <p class="muted">Approve customers before they can buy on account. Set credit limit, payment period, late fee %, and freeze accounts. Receipts can be sent from POS and Admin via WhatsApp.</p>
      <div class="card"><div class="card-body"><div class="form-grid">
        <div class="field full"><label><input type="checkbox" id="oa-enabled" ${as.enabled !== false ? 'checked' : ''}> Enable On Account payments</label></div>
        <div class="field full"><label><input type="checkbox" id="oa-allowlist" ${as.require_allowlist !== false ? 'checked' : ''}> Only approved customers can use On Account</label></div>
        <div class="field full"><label><input type="checkbox" id="oa-require-approval" ${as.require_approval !== false ? 'checked' : ''}> Require admin approval before first on-account purchase</label></div>
        <div class="field"><label>Default credit limit (${currency})</label>
          <input type="number" id="oa-limit" step="0.01" min="0" value="${as.default_credit_limit || 0}">
          <small class="muted">0 = unlimited unless customer has their own limit</small></div>
        <div class="field"><label>Default payment period (days)</label>
          <input type="number" id="oa-period" min="1" value="${as.default_period_days || 30}"></div>
        <div class="field"><label>Late payment fee (%)</label>
          <input type="number" id="oa-late" step="0.01" min="0" value="${as.late_fee_percent || 0}">
          <small class="muted">Charged on overdue balance when they buy again</small></div>
        <div class="field full"><label><input type="checkbox" id="pm-account-sync" ${pm.account_enabled !== false ? 'checked' : ''}> Show On Account at POS checkout</label></div>
      </div>
      <button class="btn btn-primary" id="save-onaccount" style="margin-top:16px">Save On Account Settings</button>
      </div></div>
      <div class="card" style="margin-top:16px"><div class="card-header"><h3>Customer Accounts</h3></div><div class="card-body table-wrap">
        <table><thead><tr><th>Name</th><th>Phone</th><th>Balance</th><th>Limit</th><th>Period</th><th>Due</th><th>Approved</th><th>Frozen</th><th></th></tr></thead>
        <tbody>${customers.map(c => `<tr>
          <td><strong>${c.name}</strong></td><td>${c.phone || '—'}</td>
          <td>${Utils.formatMoney(c.balance, currency)}</td>
          <td><input type="number" class="oa-limit-i" data-id="${c.id}" step="0.01" value="${c.credit_limit ?? ''}" style="width:90px" placeholder="Default"></td>
          <td><input type="number" class="oa-period-i" data-id="${c.id}" min="1" value="${c.on_account_period_days || ''}" style="width:70px" placeholder="${as.default_period_days || 30}"></td>
          <td>${c.on_account_due_date || '—'}</td>
          <td><label><input type="checkbox" class="oa-cust" data-id="${c.id}" ${c.allow_on_account || c.on_account_approved ? 'checked' : ''}> Yes</label></td>
          <td><label><input type="checkbox" class="oa-freeze" data-id="${c.id}" ${c.on_account_frozen ? 'checked' : ''}> Freeze</label></td>
          <td>${c.phone ? `<button class="btn btn-sm btn-ghost oa-wa" data-id="${c.id}" data-phone="${Utils.escHtml(c.phone)}" data-name="${Utils.escHtml(c.name)}" data-bal="${c.balance || 0}">WA Receipt</button>` : ''}</td>
        </tr>`).join('') || '<tr><td colspan="9" class="muted">No customers — add customers first</td></tr>'}
        </tbody></table>
        <button class="btn btn-primary" id="save-oa-customers" style="margin-top:12px">Save Customer Approvals</button>
      </div></div></div>`;

    document.getElementById('save-onaccount').addEventListener('click', async () => {
      const accountData = {
        enabled: document.getElementById('oa-enabled').checked,
        require_allowlist: document.getElementById('oa-allowlist').checked,
        default_credit_limit: parseFloat(document.getElementById('oa-limit').value) || 0
      };
      const v2 = {
        require_approval: document.getElementById('oa-require-approval').checked,
        default_period_days: parseInt(document.getElementById('oa-period').value, 10) || 30,
        late_fee_percent: parseFloat(document.getElementById('oa-late').value) || 0
      };
      await API.saveJsonSetting('account_settings', accountData, this.app.user);
      await API.saveSettings({ account_settings_v2: JSON.stringify(v2) }, this.app.user);
      const pmData = { ...(this.settings.payment_settings || {}), account_enabled: document.getElementById('pm-account-sync').checked };
      await API.saveJsonSetting('payment_settings', pmData, this.app.user);
      this.settings.account_settings = { ...accountData, ...v2 };
      this.settings.payment_settings = pmData;
      Utils.toast('On account settings saved', 'success');
    });

    document.getElementById('save-oa-customers').addEventListener('click', async () => {
      for (const cb of document.querySelectorAll('.oa-cust')) {
        const id = cb.dataset.id;
        const c = customers.find(x => x.id == id);
        if (!c) continue;
        const limitEl = el.querySelector(`.oa-limit-i[data-id="${id}"]`);
        const periodEl = el.querySelector(`.oa-period-i[data-id="${id}"]`);
        const freezeEl = el.querySelector(`.oa-freeze[data-id="${id}"]`);
        const limitVal = limitEl?.value;
        await API.saveCustomer({
          ...c,
          allow_on_account: cb.checked,
          on_account_approved: cb.checked ? 1 : 0,
          on_account_frozen: freezeEl?.checked ? 1 : 0,
          credit_limit: limitVal === '' || limitVal == null ? null : parseFloat(limitVal),
          on_account_period_days: periodEl?.value ? parseInt(periodEl.value, 10) : null
        }, this.app.user);
      }
      Utils.toast('Customer account settings saved', 'success');
      this.renderOnAccount(el);
    });

    el.querySelectorAll('.oa-wa').forEach(b => b.addEventListener('click', async () => {
      const body = `${this.settings.shop_name || 'Shop'} — On Account Statement\nCustomer: ${b.dataset.name}\nBalance: ${Utils.formatMoney(parseFloat(b.dataset.bal) || 0, currency)}\nDate: ${Utils.today()}`;
      await Utils.deliverWhatsApp(await API.sendWhatsAppMessage({
        phone: b.dataset.phone,
        recipient_name: b.dataset.name,
        message_type: 'account_receipt',
        body
      }, this.app.user), b.dataset.phone, body);
    }));
  };

  AdminPage.renderStaffHR = async function (el) {
    this.staffTab = this.staffTab || 'employees';
    const tabs = [
      ['employees', 'Employees'], ['attendance', 'Attendance'], ['leave', 'Leave'],
      ['payroll', 'Payroll'], ['shifts', 'Shifts'], ['hrdocs', 'HR Documents'],
      ['selfies', 'Login Selfies'], ['logins', 'Login Events'], ['disciplinary', 'Disciplinary'],
      ['recruitment', 'Recruitment'], ['reports', 'Reports'], ['notifications', 'Alerts']
    ];
    const ps = this.settings?.staff_portal_settings || {};
    const visHtml = window.StaffPage?.portalToggleHtml ? StaffPage.portalToggleHtml(ps) : '';
    el.innerHTML = `<div class="admin-section">
      <div class="page-toolbar" style="margin-bottom:8px">
        <h3 style="margin:0">Staff & HR Management</h3>
        <button type="button" class="btn btn-primary btn-sm" id="staffhr-open-portal">Open Staff Portal</button>
      </div>
      ${visHtml}
      ${visHtml ? '<button type="button" class="btn btn-primary" id="staffhr-save-portal-vis" style="margin:0 0 16px">Save portal visibility</button>' : ''}
      <div class="form-tabs" id="staff-admin-tabs">${tabs.map(([id, label]) =>
        `<button type="button" class="form-tab ${this.staffTab === id ? 'active' : ''}" data-tab="${id}">${label}</button>`).join('')}</div>
      <div id="staff-admin-content"><p class="muted">Loading…</p></div></div>`;
    window.StaffPage?.bindPortalToggleStates?.(el);
    document.getElementById('staffhr-save-portal-vis')?.addEventListener('click', async () => {
      const data = {
        ...(this.settings.staff_portal_settings || {}),
        ...(window.StaffPage?.collectPortalToggles ? StaffPage.collectPortalToggles() : {})
      };
      const r = await API.saveJsonSetting('staff_portal_settings', data, this.app.user);
      if (!r.success) return Utils.toast(r.error || 'Could not save', 'error');
      this.settings.staff_portal_settings = data;
      this.app.settings = { ...this.app.settings, staff_portal_settings: data };
      window.StaffPage?.bindPortalToggleStates?.(el);
      Utils.toast('Portal visibility saved — staff see these immediately', 'success');
    });
    document.getElementById('staffhr-open-portal')?.addEventListener('click', () => {
      this.section = 'staffportal';
      document.querySelectorAll('.admin-nav-btn').forEach(n => n.classList.toggle('active', n.dataset.section === 'staffportal'));
      this.renderSection(document.getElementById('admin-content'));
    });
    el.querySelector('#staff-admin-tabs').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-tab]');
      if (!btn) return;
      this.staffTab = btn.dataset.tab;
      this.renderStaffHR(el);
    });
    const content = document.getElementById('staff-admin-content');
    const renderers = {
      employees: () => this.renderStaffEmployees(content),
      attendance: () => this.renderStaffAttendance(content),
      leave: () => this.renderStaffLeaveAdmin(content),
      payroll: () => this.renderStaffPayroll(content),
      shifts: () => this.renderStaffShifts(content),
      hrdocs: () => this.renderStaffHrDocs(content),
      selfies: () => this.renderStaffSelfies(content),
      logins: () => this.renderStaffLoginEvents(content),
      disciplinary: () => this.renderStaffDisciplinaryAdmin(content),
      recruitment: () => {
        if (window.AdminRecruitmentPage) return AdminRecruitmentPage.render(content, this);
        content.innerHTML = '<p class="muted">Recruitment module not loaded.</p>';
      },
      reports: () => this.renderStaffReports(content),
      notifications: () => this.renderStaffNotifications(content)
    };
    await (renderers[this.staffTab] || renderers.employees)();
  };

  AdminPage.renderStaffEmployees = async function (el) {
    const res = await API.getEmployees({ search: this._staffSearch || '' });
    const emps = res.data || [];
    el.innerHTML = `<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
      <input type="search" id="staff-search" placeholder="Search employees…" value="${this._staffSearch || ''}" style="flex:1;min-width:200px;padding:8px;border-radius:8px;border:1px solid var(--border)">
      <button class="btn btn-primary" id="staff-add">+ Add Employee</button></div>
      <div class="table-wrap"><table><thead><tr><th></th><th>ID</th><th>Name</th><th>Position</th><th>Department</th><th>Status</th><th>Net Salary</th><th></th></tr></thead>
      <tbody>${emps.map(e => `<tr>
        <td><div class="emp-photo-cell" data-photo="${Utils.escHtml(e.photo_path || '')}" style="width:40px;height:40px;border-radius:50%;background:var(--border);overflow:hidden;display:flex;align-items:center;justify-content:center;font-size:12px;color:var(--text-muted)">${e.photo_path ? '' : '👤'}</div></td>
        <td>${e.employee_code}</td><td><strong>${e.full_name}</strong></td><td>${e.position || '—'}</td>
        <td>${e.department || '—'}</td><td>${e.status}</td><td>${Utils.formatMoney(calcNet(e), this.settings.currency || 'R')}</td>
        <td class="actions"><button class="btn btn-sm btn-primary staff-open-portal" data-id="${e.id}">Portal</button>
        <button class="btn btn-sm btn-ghost staff-edit" data-id="${e.id}">Edit</button>
        <button class="btn btn-sm btn-ghost staff-files" data-id="${e.id}">Files</button>
        <button class="btn btn-sm btn-danger staff-del" data-id="${e.id}">Delete</button></td></tr>`).join('') || '<tr><td colspan="8" class="muted">No employees</td></tr>'}
      </tbody></table></div>`;
    el.querySelectorAll('.emp-photo-cell[data-photo]').forEach(async (cell) => {
      const path = cell.getAttribute('data-photo');
      if (!path) return;
      const r = await API.getImageDataUrl(path);
      const url = r?.dataUrl || r?.data;
      if (r?.success && url) {
        cell.innerHTML = `<img src="${url}" alt="" style="width:40px;height:40px;object-fit:cover;display:block">`;
      }
    });
    document.getElementById('staff-search').addEventListener('input', (e) => {
      this._staffSearch = e.target.value;
      this.renderStaffEmployees(el);
    });
    document.getElementById('staff-add').addEventListener('click', () => this.showEmployeeForm());
    el.querySelectorAll('.staff-open-portal').forEach(b => b.addEventListener('click', () => {
      this._openPortalEmployeeId = parseInt(b.dataset.id, 10);
      this.section = 'staffportal';
      document.querySelectorAll('.admin-nav-btn').forEach(n => n.classList.toggle('active', n.dataset.section === 'staffportal'));
      this.renderSection(document.getElementById('admin-content'));
    }));
    el.querySelectorAll('.staff-edit').forEach(b => b.addEventListener('click', async () => {
      const r = await API.getEmployee(parseInt(b.dataset.id));
      if (r.success) this.showEmployeeForm(r.data);
    }));
    el.querySelectorAll('.staff-files').forEach(b => b.addEventListener('click', () => this.showEmployeeFiles(parseInt(b.dataset.id, 10), emps)));
    el.querySelectorAll('.staff-del').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Delete employee?')) return;
      await API.deleteEmployee(parseInt(b.dataset.id), this.app.user);
      this.renderStaffEmployees(el);
    }));
  };

  function calcNet(e) {
    return Math.max(0, (Number(e.basic_salary) || 0) + (Number(e.overtime_rate) || 0) + (Number(e.bonus) || 0) +
      (Number(e.commission) || 0) + (Number(e.allowances) || 0) - (Number(e.deductions) || 0));
  }

  AdminPage.showEmployeeFiles = async function (employeeId, emps) {
    const emp = (emps || []).find(x => x.id === employeeId);
    const res = await API.getStaffDocuments(employeeId);
    const docs = res.data || [];
    Utils.showModal(`Files — ${emp?.full_name || 'Employee'}`, `
      <p class="muted">Uploaded staff files (IDs, contracts, certificates). HR-generated letters are under HR Documents.</p>
      <div class="table-wrap"><table><thead><tr><th>Type</th><th>File</th><th>Notes</th><th>Date</th></tr></thead>
        <tbody>${docs.map(d => `<tr><td>${d.doc_type || '—'}</td><td>${d.file_name || '—'}</td><td>${d.notes || '—'}</td><td>${Utils.formatDateTime?.(d.created_at) || d.created_at || ''}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No files yet</td></tr>'}</tbody></table></div>
      <div class="form-grid" style="margin-top:12px">
        <div class="field"><label>Type</label><input id="ef-type" placeholder="ID / Contract / Certificate"></div>
        <div class="field"><label>Notes</label><input id="ef-notes"></div>
      </div>`,
      '<button class="btn btn-primary" id="ef-upload">Choose file &amp; save</button>');
    document.getElementById('ef-upload')?.addEventListener('click', async () => {
      const pick = await API.selectDocument('staff-doc');
      if (pick?.cancelled) return;
      if (!pick?.success || !(pick.path || pick.data)) return Utils.toast(pick?.error || 'No file selected', 'error');
      const r = await API.saveStaffDocument({
        employee_id: employeeId,
        doc_type: document.getElementById('ef-type').value.trim() || 'file',
        file_path: pick.path || pick.data,
        file_name: pick.name || pick.file_name || 'document',
        notes: document.getElementById('ef-notes').value.trim()
      }, this.app.user);
      if (!r.success) return Utils.toast(r.error || 'Upload failed', 'error');
      Utils.hideModal();
      Utils.toast('File saved', 'success');
    });
  };

  AdminPage.showEmployeeForm = function (emp = null) {
    const e = emp || {};
    API.getUsers(this.app.user).then(res => {
      const users = (res.data || []).filter(u => u.is_active !== 0);
      this._renderEmployeeFormModal(emp, e, users);
    });
  };

  AdminPage._renderEmployeeFormModal = function (emp, e, users) {
    const ws = e.work_schedule || {};
    const payType = ws.pay_type || (e.salary_type === 'Hourly' ? 'hourly' : e.salary_type === 'Daily' ? 'daily' : 'monthly');
    Utils.showModal(emp ? 'Edit Employee' : 'Add Employee', `
      <div class="form-tabs"><button type="button" class="form-tab active" data-et="basic">Basic</button>
        <button type="button" class="form-tab" data-et="job">Employment</button>
        <button type="button" class="form-tab" data-et="pay">Salary</button>
        <button type="button" class="form-tab" data-et="schedule">Work Schedule</button>
        <button type="button" class="form-tab" data-et="tax">Tax & Bank</button></div>
      <div id="et-basic" class="tab-panel"><div class="form-grid">
        <div class="field"><label>Employee ID</label><input id="em-code" value="${e.employee_code || ''}" placeholder="Auto if empty"></div>
        <div class="field"><label>Full Name *</label><input id="em-name" value="${e.full_name || ''}"></div>
        <div class="field"><label>Phone</label><input id="em-phone" value="${e.phone || ''}"></div>
        <div class="field"><label>Email</label><input id="em-email" value="${e.email || ''}"></div>
        <div class="field"><label>ID/Passport</label><input id="em-idnum" value="${e.id_number || ''}"></div>
        <div class="field"><label>Date of Birth</label><input type="date" id="em-dob" value="${e.date_of_birth || ''}"></div>
        <div class="field"><label>Gender</label><input id="em-gender" value="${e.gender || ''}"></div>
        <div class="field full"><label>Address</label><input id="em-address" value="${e.address || ''}"></div>
        <div class="field"><label>Emergency Contact</label><input id="em-ec" value="${e.emergency_contact || ''}"></div>
        <div class="field"><label>Emergency Phone</label><input id="em-ep" value="${e.emergency_phone || ''}"></div>
        <div class="field"><label>PIN (for clocking)</label><input id="em-pin" type="password" maxlength="12" placeholder="${emp ? 'Leave blank to keep' : '1234'}"></div>
        <div class="field full"><label>Profile Photo</label>
          <div id="em-photo-preview" style="margin-bottom:8px"></div>
          <input id="em-photo-path" type="hidden" value="${Utils.escHtml(e.photo_path || '')}">
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button type="button" class="btn btn-sm btn-primary" id="em-pick-photo">Choose Photo</button>
            <button type="button" class="btn btn-sm btn-ghost ${e.photo_path ? '' : 'hidden'}" id="em-clear-photo">Remove Photo</button>
          </div>
          <small class="muted">JPG, PNG, GIF or WebP. Save employee after choosing a photo.</small>
        </div>
      </div></div>
      <div id="et-job" class="tab-panel hidden"><div class="form-grid">
        <div class="field"><label>Position</label><input id="em-pos" value="${e.position || ''}"></div>
        <div class="field"><label>Department</label><input id="em-dept" value="${e.department || ''}"></div>
        <div class="field"><label>Branch</label><input id="em-branch" value="${e.branch || ''}"></div>
        <div class="field"><label>Date Hired</label><input type="date" id="em-hired" value="${e.date_hired || ''}"></div>
        <div class="field"><label>Employment Type</label><select id="em-type">${['Permanent', 'Part-Time', 'Casual', 'Contract'].map(t =>
          `<option ${e.employment_type === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <div class="field"><label>Status</label><select id="em-status">${['Active', 'Suspended', 'Resigned', 'Inactive'].map(t =>
          `<option ${e.status === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <div class="field full"><label>Linked POS User <span class="muted">(for shift login blocking)</span></label>
          <select id="em-user"><option value="">— None —</option>
          ${users.map(u => `<option value="${u.id}" ${e.user_id == u.id ? 'selected' : ''}>${u.username} — ${u.full_name} (${u.role})</option>`).join('')}
          </select></div>
      </div></div>
      <div id="et-pay" class="tab-panel hidden"><div class="form-grid">
        <div class="field"><label>Salary Type</label><select id="em-stype">${['Monthly', 'Weekly', 'Daily', 'Hourly'].map(t =>
          `<option ${e.salary_type === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <div class="field"><label>Basic Salary</label><input type="number" id="em-basic" step="0.01" value="${e.basic_salary || 0}"></div>
        <div class="field"><label>Overtime Rate</label><input type="number" id="em-ot" step="0.01" value="${e.overtime_rate || 0}"></div>
        <div class="field"><label>Bonus</label><input type="number" id="em-bonus" step="0.01" value="${e.bonus || 0}"></div>
        <div class="field"><label>Commission</label><input type="number" id="em-comm" step="0.01" value="${e.commission || 0}"></div>
        <div class="field"><label>Allowances</label><input type="number" id="em-allow" step="0.01" value="${e.allowances || 0}"></div>
        <div class="field"><label>Deductions (other)</label><input type="number" id="em-deduct" step="0.01" value="${e.deductions || 0}"></div>
        <div class="field"><label>Payment Date</label><input id="em-paydate" placeholder="e.g. 25th or pick a date" value="${e.payment_date || ''}"></div>
        <div class="field"><label>Or pick date</label><input type="date" id="em-paydate-pick"></div>
      </div></div>
      <div id="et-schedule" class="tab-panel hidden"><div class="form-grid">
        <div class="field"><label>Pay Type</label><select id="ws-pay-type">
          ${['monthly', 'hourly', 'daily'].map(t => `<option value="${t}" ${payType === t ? 'selected' : ''}>${t.charAt(0).toUpperCase() + t.slice(1)}</option>`).join('')}
        </select></div>
        <div class="field ws-monthly"><label>Monthly Salary</label><input type="number" id="ws-monthly" step="0.01" value="${ws.monthly_salary || e.basic_salary || 0}"></div>
        <div class="field ws-hourly hidden"><label>Hourly Rate</label><input type="number" id="ws-hourly" step="0.01" value="${ws.hourly_rate || 0}"></div>
        <div class="field ws-daily hidden"><label>Daily Wage</label><input type="number" id="ws-daily" step="0.01" value="${ws.daily_wage || 0}"></div>
        <div class="field"><label>Expected Hours/Day</label><input type="number" id="ws-hours-day" step="0.5" value="${ws.expected_hours_per_day ?? 8}"></div>
        <div class="field"><label>Expected Days/Week</label><input type="number" id="ws-days-week" min="1" max="7" value="${ws.expected_days_per_week ?? 5}"></div>
        <div class="field full"><label>Work days (for shift generate)</label>
          <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:6px">${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((n, i) => {
            const days = Array.isArray(ws.work_days) && ws.work_days.length
              ? ws.work_days.map(Number)
              : Array.from({ length: Number(ws.expected_days_per_week) || 5 }, (_, d) => d);
            return `<label><input type="checkbox" class="ws-wday" value="${i}" ${days.includes(i) ? 'checked' : ''}> ${n}</label>`;
          }).join('')}</div>
          <small class="muted">Unchecked days become Rest Day when you generate weekly / 4-week shifts.</small>
        </div>
        <div class="field"><label>Hours Limit / Day</label><input type="number" id="ws-hpd" step="0.5" value="${ws.hours_per_day ?? ws.expected_hours_per_day ?? 8}"></div>
        <div class="field"><label>Hours Limit / Week</label><input type="number" id="ws-hpw" step="0.5" value="${ws.hours_per_week ?? 40}"></div>
        <div class="field"><label>Hours Limit / Month</label><input type="number" id="ws-hpm" step="0.5" value="${ws.hours_per_month ?? 173}"></div>
        <div class="field"><label>Bonus Period Type</label><select id="ws-period-type">
          ${['day', 'week', 'month'].map(t => `<option value="${t}" ${(ws.period_type || 'day') === t ? 'selected' : ''}>${t.charAt(0).toUpperCase() + t.slice(1)}</option>`).join('')}
        </select></div>
        <div class="field"><label>Bonus Rate (hourly, beyond limit)</label><input type="number" id="ws-bonus-rate" step="0.01" value="${ws.bonus_rate ?? 0}" placeholder="0 = use OT multiplier"></div>
        <div class="field"><label>Shift Start</label><input type="time" id="ws-start" value="${ws.shift_start || '08:00'}"></div>
        <div class="field"><label>Shift End</label><input type="time" id="ws-end" value="${ws.shift_end || '17:00'}"></div>
        <div class="field"><label>Grace Minutes</label><input type="number" id="ws-grace" min="0" value="${ws.grace_minutes ?? 5}"></div>
        <div class="field"><label>OT Multiplier</label><input type="number" id="ws-ot-mult" step="0.1" value="${ws.overtime_rate_multiplier ?? 1.5}"></div>
        <div class="field"><label>Weekend Multiplier</label><input type="number" id="ws-wknd" step="0.1" value="${ws.weekend_rate_multiplier ?? 2}"></div>
        <div class="field"><label>Holiday Multiplier</label><input type="number" id="ws-hol" step="0.1" value="${ws.holiday_rate_multiplier ?? 2}"></div>
        <div class="field"><label>Max payment / period (0 = no cap)</label><input type="number" id="ws-max-pay" step="0.01" min="0" value="${ws.max_payment ?? 0}"></div>
        <div class="field full"><label><input type="checkbox" id="ws-allow-beyond" ${ws.allow_hours_beyond_limit !== false ? 'checked' : ''}> Allow hours beyond daily/weekly/monthly limit to count for pay</label></div>
        <div class="field full"><label><input type="checkbox" id="ws-allow-ot" ${ws.allow_overtime_pay !== false ? 'checked' : ''}> Pay overtime / bonus for hours beyond the limit</label></div>
        <div class="field full"><label><input type="checkbox" id="ws-ded-late" ${ws.deduct_late !== false ? 'checked' : ''}> Deduct for lateness</label></div>
        <div class="field full"><label><input type="checkbox" id="ws-ded-early" ${ws.deduct_early_departure !== false ? 'checked' : ''}> Deduct for early departure</label></div>
        <div class="field full"><label><input type="checkbox" id="ws-ded-abs" ${ws.deduct_unpaid_absence !== false ? 'checked' : ''}> Deduct unpaid absences</label></div>
      </div></div>
      <div id="et-tax" class="tab-panel hidden"><div class="form-grid">
        <div class="field"><label>Tax Number</label><input id="em-tax" value="${e.tax_number || ''}"></div>
        <div class="field"><label>UIF Number</label><input id="em-uif" value="${e.uif_number || ''}"></div>
        <div class="field"><label>Bank Name</label><input id="em-bank" value="${e.bank_name || ''}"></div>
        <div class="field"><label>Bank Account</label><input id="em-account" value="${e.bank_account || ''}"></div>
        <div class="field"><label>Pension Contribution</label><input type="number" id="em-pension" step="0.01" value="${e.pension_contribution || 0}"></div>
        <div class="field"><label>Medical Aid Contribution</label><input type="number" id="em-medical" step="0.01" value="${e.medical_aid_contribution || 0}"></div>
        <div class="field full" style="margin-top:8px"><strong>Statutory deductions on payslip</strong>
          <p class="muted" style="margin:4px 0 8px">Only checked items appear on PDF payslips when amounts apply.</p></div>
        <div class="field"><label><input type="checkbox" id="em-paye-reg" ${e.paye_registered ? 'checked' : ''}> Registered for PAYE</label></div>
        <div class="field"><label><input type="checkbox" id="em-uif-reg" ${e.uif_registered ? 'checked' : ''}> Registered for UIF</label></div>
        <div class="field"><label><input type="checkbox" id="em-sdl-reg" ${e.sdl_registered ? 'checked' : ''}> Registered for SDL</label></div>
        <div class="field"><label><input type="checkbox" id="em-pension-reg" ${e.pension_registered ? 'checked' : ''}> Registered for Pension</label></div>
        <div class="field"><label><input type="checkbox" id="em-medical-reg" ${e.medical_registered ? 'checked' : ''}> Registered for Medical Aid</label></div>
      </div></div>`,
      '<button type="button" class="btn btn-primary" id="em-save">Save Employee</button>');
    document.querySelectorAll('[data-et]').forEach(tab => tab.addEventListener('click', () => {
      document.querySelectorAll('[data-et]').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('[id^="et-"]').forEach(p => p.classList.add('hidden'));
      tab.classList.add('active');
      document.getElementById('et-' + tab.dataset.et).classList.remove('hidden');
    }));
    const syncPayTypeFields = () => {
      const pt = document.getElementById('ws-pay-type').value;
      document.querySelectorAll('.ws-monthly, .ws-hourly, .ws-daily').forEach(el => el.classList.add('hidden'));
      document.querySelector('.ws-' + pt)?.classList.remove('hidden');
    };
    document.getElementById('ws-pay-type')?.addEventListener('change', syncPayTypeFields);
    syncPayTypeFields();
    document.getElementById('em-paydate-pick')?.addEventListener('change', (ev) => {
      if (ev.target.value) document.getElementById('em-paydate').value = ev.target.value;
    });
    const previewEmpPhoto = async (path) => {
      const preview = document.getElementById('em-photo-preview');
      const clearBtn = document.getElementById('em-clear-photo');
      if (!preview) return;
      if (!path?.trim()) {
        preview.innerHTML = '<p class="muted">No profile photo</p>';
        clearBtn?.classList.add('hidden');
        return;
      }
      clearBtn?.classList.remove('hidden');
      preview.innerHTML = '<p class="muted">Loading photo…</p>';
      const r = await API.getImageDataUrl(path.trim());
      const url = r?.dataUrl || r?.data;
      preview.innerHTML = r?.success && url
        ? `<img src="${url}" alt="Profile" style="max-width:140px;max-height:140px;object-fit:cover;border-radius:10px;border:1px solid var(--border)">`
        : `<p class="muted">Could not preview photo${r?.error ? ` — ${Utils.escHtml(r.error)}` : ''}</p>`;
    };
    previewEmpPhoto(e.photo_path || '');
    document.getElementById('em-pick-photo')?.addEventListener('click', async () => {
      const btn = document.getElementById('em-pick-photo');
      if (btn) btn.disabled = true;
      try {
        const pick = await API.selectImage('employee-profile');
        if (pick?.cancelled) return;
        if (!pick?.success || !pick.path) {
          return Utils.toast(pick?.error || 'Could not choose photo', 'error');
        }
        document.getElementById('em-photo-path').value = pick.path;
        await previewEmpPhoto(pick.path);
        Utils.toast('Photo selected — click Save Employee to keep it', 'success');
      } finally {
        if (btn) btn.disabled = false;
      }
    });
    document.getElementById('em-clear-photo')?.addEventListener('click', async () => {
      document.getElementById('em-photo-path').value = '';
      await previewEmpPhoto('');
      Utils.toast('Photo removed — save employee to apply', 'info');
    });
    document.getElementById('em-save')?.addEventListener('click', async () => {
      const pin = document.getElementById('em-pin').value.trim();
      const data = {
        id: emp?.id, employee_code: document.getElementById('em-code').value.trim() || undefined,
        full_name: document.getElementById('em-name').value.trim(),
        phone: document.getElementById('em-phone').value.trim(), email: document.getElementById('em-email').value.trim(),
        id_number: document.getElementById('em-idnum').value.trim(), date_of_birth: document.getElementById('em-dob').value,
        gender: document.getElementById('em-gender').value.trim(), address: document.getElementById('em-address').value.trim(),
        emergency_contact: document.getElementById('em-ec').value.trim(), emergency_phone: document.getElementById('em-ep').value.trim(),
        pin: pin || undefined, photo_path: document.getElementById('em-photo-path')?.value.trim() || null,
        position: document.getElementById('em-pos').value.trim(),
        department: document.getElementById('em-dept').value.trim(), branch: document.getElementById('em-branch').value.trim(),
        date_hired: document.getElementById('em-hired').value, employment_type: document.getElementById('em-type').value,
        status: document.getElementById('em-status').value, salary_type: document.getElementById('em-stype').value,
        basic_salary: parseFloat(document.getElementById('em-basic').value) || 0,
        overtime_rate: parseFloat(document.getElementById('em-ot').value) || 0,
        bonus: parseFloat(document.getElementById('em-bonus').value) || 0,
        commission: parseFloat(document.getElementById('em-comm').value) || 0,
        allowances: parseFloat(document.getElementById('em-allow').value) || 0,
        deductions: parseFloat(document.getElementById('em-deduct').value) || 0,
        payment_date: document.getElementById('em-paydate').value.trim() || null,
        tax_number: document.getElementById('em-tax').value.trim(),
        uif_number: document.getElementById('em-uif').value.trim(),
        bank_name: document.getElementById('em-bank').value.trim(),
        bank_account: document.getElementById('em-account').value.trim(),
        pension_contribution: parseFloat(document.getElementById('em-pension').value) || 0,
        medical_aid_contribution: parseFloat(document.getElementById('em-medical').value) || 0,
        paye_registered: document.getElementById('em-paye-reg')?.checked || false,
        uif_registered: document.getElementById('em-uif-reg')?.checked || false,
        sdl_registered: document.getElementById('em-sdl-reg')?.checked || false,
        pension_registered: document.getElementById('em-pension-reg')?.checked || false,
        medical_registered: document.getElementById('em-medical-reg')?.checked || false,
        user_id: parseInt(document.getElementById('em-user').value) || null
      };
      if (!data.full_name) return Utils.toast('Name required', 'error');
      // Pre-validate links so admin sees exact missing pieces before save
      if (typeof API.validateEmployeeLinks === 'function') {
        const check = await API.validateEmployeeLinks(data);
        if (check?.success === false) return Utils.toast(check.error || 'Could not validate employee links', 'error');
        const payload = check?.data || check;
        if (payload && payload.ok === false && (payload.errors || []).length) {
          return Utils.toast(payload.errors.join(' · '), 'error');
        }
      }
      const r = await API.saveEmployee(data, this.app.user);
      if (!r.success) return Utils.toast(r.error || 'Could not save employee', 'error');
      const empId = r.data?.id || emp?.id;
      if (empId) {
        const schedule = {
          pay_type: document.getElementById('ws-pay-type').value,
          monthly_salary: parseFloat(document.getElementById('ws-monthly').value) || 0,
          hourly_rate: parseFloat(document.getElementById('ws-hourly').value) || 0,
          daily_wage: parseFloat(document.getElementById('ws-daily').value) || 0,
          expected_hours_per_day: parseFloat(document.getElementById('ws-hours-day').value) || 8,
          expected_days_per_week: parseInt(document.getElementById('ws-days-week').value, 10) || 5,
          work_days: [...document.querySelectorAll('.ws-wday:checked')].map(cb => parseInt(cb.value, 10)),
          hours_per_day: parseFloat(document.getElementById('ws-hpd').value) || 8,
          hours_per_week: parseFloat(document.getElementById('ws-hpw').value) || 40,
          hours_per_month: parseFloat(document.getElementById('ws-hpm').value) || 173,
          period_type: document.getElementById('ws-period-type').value || 'day',
          bonus_rate: parseFloat(document.getElementById('ws-bonus-rate').value) || 0,
          shift_start: document.getElementById('ws-start').value || '08:00',
          shift_end: document.getElementById('ws-end').value || '17:00',
          grace_minutes: parseInt(document.getElementById('ws-grace').value, 10) || 0,
          overtime_rate_multiplier: parseFloat(document.getElementById('ws-ot-mult').value) || 1.5,
          weekend_rate_multiplier: parseFloat(document.getElementById('ws-wknd').value) || 2,
          holiday_rate_multiplier: parseFloat(document.getElementById('ws-hol').value) || 2,
          max_payment: parseFloat(document.getElementById('ws-max-pay')?.value) || 0,
          allow_hours_beyond_limit: document.getElementById('ws-allow-beyond')?.checked !== false,
          allow_overtime_pay: document.getElementById('ws-allow-ot')?.checked !== false,
          deduct_late: document.getElementById('ws-ded-late').checked,
          deduct_early_departure: document.getElementById('ws-ded-early').checked,
          deduct_unpaid_absence: document.getElementById('ws-ded-abs').checked
        };
        const schedRes = await API.saveEmployeeWorkSchedule(empId, schedule, this.app.user);
        if (!schedRes.success) {
          Utils.toast(schedRes.error || 'Employee saved, but work schedule failed — set schedule before clock-in', 'error');
        }
      }
      Utils.hideModal();
      const warnings = r.data?._link_warnings || [];
      const genPin = r.data?._generated_pin;
      let msg = 'Employee saved';
      if (genPin) msg += ` · Temporary PIN: ${genPin} (share securely)`;
      Utils.toast(msg, 'success');
      if (warnings.length) {
        setTimeout(() => Utils.toast(warnings.join(' · '), 'info'), 400);
      }
      const content = document.getElementById('staff-admin-content');
      if (content) this.renderStaffEmployees(content);
    });
  };

  AdminPage.renderStaffAttendance = async function (el) {
    const from = this._attFrom || Utils.daysAgo(7);
    const to = this._attTo || Utils.today();
    const branch = this._attBranch || '';
    const employeeId = this._attEmp || '';
    const empsRes = await API.getEmployees({});
    const emps = empsRes.data || [];
    const branches = [...new Set(emps.map(e => e.branch).filter(Boolean))];
    const canEdit = ['owner', 'manager'].includes(this.app.user?.role);
    const canResolve = ['owner', 'manager', 'supervisor', 'assistant_manager'].includes(this.app.user?.role);
    const res = await API.getStaffAttendance({
      from, to, branch: branch || undefined, employee_id: employeeId || undefined
    });
    const rows = res.data || [];
    const penRes = canEdit ? await API.getAttendancePenalties({ status: 'pending' }, this.app.user) : { data: [] };
    const penalties = penRes.data || [];
    const inboxRes = canResolve ? await API.getMissedClockOutInbox({ days: 21 }, this.app.user) : { data: [] };
    const inbox = inboxRes.success ? (inboxRes.data || []) : [];
    const openInbox = inbox.filter(r => r.inbox_kind === 'open');
    const autoInbox = inbox.filter(r => r.inbox_kind === 'auto_closed');
    const inboxCard = canResolve ? `<div class="card" style="margin-bottom:12px;border-color:${openInbox.length ? 'var(--warning)' : 'var(--border)'}">
      <div class="card-body">
        <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center">
          <div>
            <h4 style="margin:0">Missed clock-out inbox</h4>
            <p class="muted" style="margin:4px 0 0;font-size:13px">Open shifts still clocked in, plus recent auto-closes for review.</p>
          </div>
          <button class="btn btn-ghost btn-sm" id="att-inbox-refresh">Refresh</button>
        </div>
        ${!inboxRes.success ? `<p style="color:var(--danger)">${Utils.escHtml(inboxRes.error || 'Could not load inbox')}</p>` : ''}
        ${!inbox.length ? '<p class="muted" style="margin:12px 0 0">No open or auto-closed clock-outs to review.</p>' : `
        <div class="table-wrap" style="margin-top:12px"><table><thead><tr>
          <th>Date</th><th>Employee</th><th>In</th><th>Issue</th><th>Scheduled end</th><th></th>
        </tr></thead><tbody>
          ${inbox.map(r => `<tr>
            <td>${r.work_date}</td>
            <td>${Utils.escHtml(r.full_name)}<br><small class="muted">${Utils.escHtml(r.employee_code || '')}</small></td>
            <td>${r.clock_in ? Utils.formatDateTime(r.clock_in) : '—'}</td>
            <td>${r.inbox_kind === 'open'
              ? `<span style="color:var(--warning)">Still open${r.shift_ended ? ' (shift ended)' : ''} · ${r.hours_open}h</span>`
              : '<span class="muted">Auto-closed</span>'}</td>
            <td>${r.scheduled_end || '—'}</td>
            <td style="white-space:nowrap">
              ${r.inbox_kind === 'open' ? `
                <button class="btn btn-sm btn-primary inbox-now" data-id="${r.id}">Clock out now</button>
                <button class="btn btn-sm btn-ghost inbox-end" data-id="${r.id}">Close at shift end</button>` : `
                <button class="btn btn-sm btn-ghost inbox-ok" data-id="${r.id}">Mark reviewed</button>`}
              ${canEdit ? `<button class="btn btn-sm btn-warning inbox-pen" data-id="${r.id}" data-emp="${r.employee_id}" data-date="${r.work_date}">Penalty</button>` : ''}
            </td>
          </tr>`).join('')}
        </tbody></table></div>
        <p class="muted" style="margin:8px 0 0;font-size:12px">${openInbox.length} open · ${autoInbox.length} auto-closed (21 days)</p>`}
      </div></div>` : '';
    el.innerHTML = `${inboxCard}<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center">
      ${Utils.extendedDateFilterHTML('att-date-filter', from, to)}
      <select id="att-branch" style="padding:8px;border-radius:8px;border:1px solid var(--border)">
        <option value="">All branches</option>
        ${branches.map(b => `<option value="${b}" ${branch === b ? 'selected' : ''}>${b}</option>`).join('')}
      </select>
      <select id="att-emp" style="padding:8px;border-radius:8px;border:1px solid var(--border)">
        <option value="">All employees</option>
        ${emps.map(e => `<option value="${e.id}" ${String(employeeId) === String(e.id) ? 'selected' : ''}>${e.full_name}</option>`).join('')}
      </select>
      ${canEdit ? '<button class="btn btn-success" id="att-add">+ Add clock record</button>' : ''}
      <button class="btn btn-primary" id="att-pdf">PDF</button>
      <button class="btn btn-ghost" id="att-excel">Excel</button></div>
      ${canEdit && penalties.length ? `<div class="card" style="margin-bottom:12px;border-color:var(--warning)"><div class="card-body">
        <h4>Pending clock-out / attendance penalties</h4>
        <p class="muted" style="font-size:13px">Deducted from the next payroll when generated.</p>
        <div class="table-wrap"><table><thead><tr><th>Employee</th><th>Date</th><th>Type</th><th>Amount</th><th>Reason</th><th>By</th><th></th></tr></thead>
        <tbody>${penalties.map(p => `<tr>
          <td>${Utils.escHtml(p.full_name)}</td><td>${p.work_date || '—'}</td>
          <td>${p.penalty_type}</td>
          <td>${p.penalty_type === 'money' ? Utils.formatMoney(p.amount, this.settings?.currency || 'R') : `${p.amount}h`}</td>
          <td>${Utils.escHtml(p.reason || '')}</td>
          <td>${Utils.escHtml(p.created_by_name || '')}</td>
          <td><button class="btn btn-sm btn-ghost att-pen-cancel" data-id="${p.id}">Cancel</button></td>
        </tr>`).join('')}</tbody></table></div></div></div>` : ''}
      <div class="table-wrap"><table><thead><tr>
        <th>Date</th><th>Employee</th><th>Branch</th><th>In</th><th>Out</th>
        <th>Worked</th><th>Scheduled</th><th>Missed</th><th>Late</th><th>OT</th><th>Status</th>${canEdit ? '<th></th>' : ''}
      </tr></thead>
      <tbody>${rows.map(a => `<tr><td>${a.work_date}</td><td>${a.full_name}${a.admin_entered ? '<br><small class="muted">Admin: ' + Utils.escHtml(a.created_by_name || a.created_by_user_name || a.edited_by_name || '') + '</small>' : ''}${a.auto_closed ? '<br><small style="color:var(--warning)">Auto-closed</small>' : ''}</td><td>${a.branch || '—'}</td>
        <td>${a.clock_in ? Utils.formatDateTime(a.clock_in) : '—'}</td>
        <td>${a.clock_out ? Utils.formatDateTime(a.clock_out) : '—'}</td>
        <td>${a.hours_worked ?? 0}h</td>
        <td>${a.scheduled_hours ?? '—'}</td>
        <td>${a.hours_missed ?? '—'}</td>
        <td>${a.late_minutes > 0 ? `${a.late_minutes}m` : '—'}</td>
        <td>${a.overtime_minutes > 0 ? `${(a.overtime_minutes / 60).toFixed(1)}h` : '—'}</td>
        <td>${a.status || '—'}</td>
        ${canEdit ? `<td style="white-space:nowrap">${a.id ? `<button class="btn btn-sm btn-ghost att-edit" data-id="${a.id}">Edit</button>
          <button class="btn btn-sm btn-danger att-del" data-id="${a.id}">Delete</button>
          ${a.clock_in ? `<button class="btn btn-sm btn-warning att-penalty" data-id="${a.id}" data-emp="${a.employee_id}" data-date="${a.work_date}">Penalty</button>` : ''}` : '<span class="muted">—</span>'}</td>` : ''}
      </tr>`).join('') || `<tr><td colspan="${canEdit ? 12 : 11}" class="muted">No records</td></tr>`}
      </tbody></table></div>`;
    document.getElementById('att-inbox-refresh')?.addEventListener('click', () => this.renderStaffAttendance(el));
    const resolveInbox = async (id, action) => {
      const r = await API.resolveMissedClockOut(parseInt(id, 10), action, this.app.user);
      if (!r.success) return Utils.toast(r.error || 'Could not resolve', 'error');
      Utils.toast(action === 'dismiss_auto_close' ? 'Marked reviewed' : 'Clock-out resolved', 'success');
      this.renderStaffAttendance(el);
    };
    el.querySelectorAll('.inbox-now').forEach(b => b.addEventListener('click', () => resolveInbox(b.dataset.id, 'clock_out_now')));
    el.querySelectorAll('.inbox-end').forEach(b => b.addEventListener('click', () => resolveInbox(b.dataset.id, 'clock_out_shift_end')));
    el.querySelectorAll('.inbox-ok').forEach(b => b.addEventListener('click', () => resolveInbox(b.dataset.id, 'dismiss_auto_close')));
    el.querySelectorAll('.inbox-pen').forEach(b => b.addEventListener('click', () => {
      Utils.showModal('Attendance Penalty', `
        <p class="muted">Applies on the next payroll for this employee (money or hours deducted).</p>
        <div class="field"><label>Type</label><select id="pen-type"><option value="money">Money amount</option><option value="hours">Hours deducted</option></select></div>
        <div class="field"><label>Amount</label><input type="number" id="pen-amt" min="0.01" step="0.01"></div>
        <div class="field"><label>Reason</label><textarea id="pen-reason" rows="2">Missed clock-out / attendance penalty</textarea></div>`,
        '<button class="btn btn-warning" id="pen-save">Issue Penalty</button>');
      document.getElementById('pen-save')?.addEventListener('click', async () => {
        const r = await API.addAttendancePenalty({
          employee_id: parseInt(b.dataset.emp, 10),
          attendance_id: parseInt(b.dataset.id, 10),
          work_date: b.dataset.date,
          penalty_type: document.getElementById('pen-type').value,
          amount: parseFloat(document.getElementById('pen-amt').value),
          reason: document.getElementById('pen-reason').value.trim()
        }, this.app.user);
        if (!r.success) return Utils.toast(r.error, 'error');
        Utils.hideModal();
        Utils.toast('Penalty queued for next payroll', 'success');
        this.renderStaffAttendance(el);
      });
    }));
    Utils.bindDateFilter(document.getElementById('att-date-filter'), (f, t) => {
      this._attFrom = f;
      this._attTo = t;
      this._attBranch = document.getElementById('att-branch').value;
      this._attEmp = document.getElementById('att-emp').value;
      this.renderStaffAttendance(el);
    });
    document.getElementById('att-branch').addEventListener('change', () => {
      this._attBranch = document.getElementById('att-branch').value;
      this._attEmp = document.getElementById('att-emp').value;
      this.renderStaffAttendance(el);
    });
    document.getElementById('att-emp').addEventListener('change', () => {
      this._attBranch = document.getElementById('att-branch').value;
      this._attEmp = document.getElementById('att-emp').value;
      this.renderStaffAttendance(el);
    });
    document.getElementById('att-pdf').addEventListener('click', async () => {
      const buf = await API.getStaffReportPdf('attendance', rows);
      await saveStaffPdf(`attendance-${from}-${to}.pdf`, buf);
    });
    document.getElementById('att-excel').addEventListener('click', async () => {
      await Export.toExcel(`attendance-${from}-${to}.xlsx`, [{
        name: 'Attendance',
        headers: ['Date', 'Employee', 'Branch', 'In', 'Out', 'Worked', 'Scheduled', 'Missed', 'Late', 'OT', 'Status'],
        rows: rows.map(a => [
          a.work_date, a.full_name, a.branch || '', a.clock_in || '', a.clock_out || '',
          a.hours_worked ?? 0, a.scheduled_hours ?? '', a.hours_missed ?? '',
          a.late_minutes || 0, a.overtime_minutes || 0, a.status || ''
        ])
      }]);
    });
    if (canEdit) {
      document.getElementById('att-add')?.addEventListener('click', () => {
        Utils.showModal('Add Clock Record (Admin)', `<div class="form-grid">
          <div class="field"><label>Employee *</label><select id="na-emp">${emps.map(e => `<option value="${e.id}">${Utils.escHtml(e.full_name)}</option>`).join('')}</select></div>
          <div class="field"><label>Work date *</label><input type="date" id="na-date" value="${Utils.today()}"></div>
          <div class="field"><label>Clock In</label><input type="datetime-local" id="na-in"></div>
          <div class="field"><label>Clock Out</label><input type="datetime-local" id="na-out"></div>
          <div class="field"><label>Hours worked (optional override)</label><input type="number" id="na-hours" step="0.01" min="0" placeholder="Auto from in/out"></div>
          <div class="field full"><label>Notes</label><textarea id="na-notes" rows="2" placeholder="Reason for admin entry"></textarea></div>
        </div>`, '<button class="btn btn-primary" id="na-save">Save Record</button>');
        document.getElementById('na-save')?.addEventListener('click', async () => {
          const hoursVal = document.getElementById('na-hours').value;
          const r = await API.createStaffAttendance({
            employee_id: parseInt(document.getElementById('na-emp').value, 10),
            work_date: document.getElementById('na-date').value,
            clock_in: document.getElementById('na-in').value ? new Date(document.getElementById('na-in').value).toISOString() : null,
            clock_out: document.getElementById('na-out').value ? new Date(document.getElementById('na-out').value).toISOString() : null,
            hours_worked: hoursVal !== '' ? parseFloat(hoursVal) : null,
            notes: document.getElementById('na-notes').value.trim()
          }, this.app.user);
          if (!r.success) return Utils.toast(r.error, 'error');
          Utils.hideModal();
          Utils.toast('Admin clock record saved', 'success');
          this.renderStaffAttendance(el);
        });
      });
      el.querySelectorAll('.att-pen-cancel').forEach(b => b.addEventListener('click', async () => {
        const r = await API.cancelAttendancePenalty(parseInt(b.dataset.id, 10), this.app.user);
        if (!r.success) return Utils.toast(r.error, 'error');
        Utils.toast('Penalty cancelled', 'success');
        this.renderStaffAttendance(el);
      }));
      el.querySelectorAll('.att-penalty').forEach(b => b.addEventListener('click', () => {
        Utils.showModal('Attendance Penalty', `
          <p class="muted">Applies on the next payroll for this employee (money or hours deducted).</p>
          <div class="field"><label>Type</label><select id="pen-type"><option value="money">Money amount</option><option value="hours">Hours deducted</option></select></div>
          <div class="field"><label>Amount</label><input type="number" id="pen-amt" min="0.01" step="0.01"></div>
          <div class="field"><label>Reason</label><textarea id="pen-reason" rows="2">Missed clock-out / attendance penalty</textarea></div>`,
          '<button class="btn btn-warning" id="pen-save">Issue Penalty</button>');
        document.getElementById('pen-save')?.addEventListener('click', async () => {
          const r = await API.addAttendancePenalty({
            employee_id: parseInt(b.dataset.emp, 10),
            attendance_id: parseInt(b.dataset.id, 10),
            work_date: b.dataset.date,
            penalty_type: document.getElementById('pen-type').value,
            amount: parseFloat(document.getElementById('pen-amt').value),
            reason: document.getElementById('pen-reason').value.trim()
          }, this.app.user);
          if (!r.success) return Utils.toast(r.error, 'error');
          Utils.hideModal();
          Utils.toast('Penalty queued for next payroll', 'success');
          this.renderStaffAttendance(el);
        });
      }));
      el.querySelectorAll('.att-edit').forEach(b => b.addEventListener('click', () => {
        const row = rows.find(x => x.id == b.dataset.id);
        if (!row) return;
        Utils.showModal('Edit Attendance', `<div class="form-grid">
          <div class="field"><label>Clock In</label><input type="datetime-local" id="ea-in" value="${row.clock_in ? row.clock_in.slice(0, 16) : ''}"></div>
          <div class="field"><label>Clock Out</label><input type="datetime-local" id="ea-out" value="${row.clock_out ? row.clock_out.slice(0, 16) : ''}"></div>
          <div class="field"><label>Hours worked</label><input type="number" id="ea-hours" step="0.01" value="${row.hours_worked ?? ''}"></div>
          <div class="field"><label>Status</label><select id="ea-status">
            ${['present', 'absent', 'late', 'half_day', 'leave', 'auto_closed'].map(s => `<option ${row.status === s ? 'selected' : ''}>${s}</option>`).join('')}
          </select></div>
          <div class="field"><label>Late (min)</label><input type="number" id="ea-late" value="${row.late_minutes || 0}"></div>
          <div class="field"><label>Early Departure (min)</label><input type="number" id="ea-early" value="${row.early_departure_minutes || 0}"></div>
          <div class="field"><label>OT (min)</label><input type="number" id="ea-ot" value="${row.overtime_minutes || 0}"></div>
          <div class="field full"><label><input type="checkbox" id="ea-paid" ${row.is_paid_absence !== 0 ? 'checked' : ''}> Paid absence</label></div>
          <div class="field full"><label>Notes</label><textarea id="ea-notes" rows="2">${row.notes || ''}</textarea></div>
        </div>`, '<button class="btn btn-primary" id="ea-save">Save Changes</button>');
        document.getElementById('ea-save').addEventListener('click', async () => {
          const hoursVal = document.getElementById('ea-hours').value;
          const r = await API.updateStaffAttendance(parseInt(b.dataset.id), {
            clock_in: document.getElementById('ea-in').value ? new Date(document.getElementById('ea-in').value).toISOString() : null,
            clock_out: document.getElementById('ea-out').value ? new Date(document.getElementById('ea-out').value).toISOString() : null,
            hours_worked: hoursVal !== '' ? parseFloat(hoursVal) : undefined,
            status: document.getElementById('ea-status').value,
            late_minutes: parseInt(document.getElementById('ea-late').value, 10) || 0,
            early_departure_minutes: parseInt(document.getElementById('ea-early').value, 10) || 0,
            overtime_minutes: parseInt(document.getElementById('ea-ot').value, 10) || 0,
            is_paid_absence: document.getElementById('ea-paid').checked,
            notes: document.getElementById('ea-notes').value.trim()
          }, this.app.user);
          if (!r.success) return Utils.toast(r.error, 'error');
          Utils.hideModal();
          Utils.toast('Attendance updated', 'success');
          this.renderStaffAttendance(el);
        });
      }));
      el.querySelectorAll('.att-del').forEach(b => b.addEventListener('click', async () => {
        const row = rows.find(x => String(x.id) === String(b.dataset.id));
        if (!row) return;
        if (!confirm(`Delete attendance for ${row.full_name} on ${row.work_date}? This cannot be undone.`)) return;
        const r = await API.deleteStaffAttendance(parseInt(b.dataset.id, 10), this.app.user);
        if (!r.success) return Utils.toast(r.error || 'Could not delete', 'error');
        Utils.toast('Attendance deleted', 'success');
        this.renderStaffAttendance(el);
      }));
    }
  };

  AdminPage.renderStaffLeaveAdmin = async function (el) {
    const ps = this.settings.staff_portal_settings || {};
    const [res, proofRes] = await Promise.all([API.getAllStaffLeave(), API.getPendingStaffLeaveProofs()]);
    const rows = res.data || [];
    const pendingProofs = proofRes.data || [];
    const blackouts = ps.leave_blackouts || [];
    const leaveOpen = ps.leave_requests_open !== false;
    el.innerHTML = `<div class="card" style="margin-bottom:16px"><div class="card-body"><h4>Leave Portal Controls</h4>
      <p class="muted">Close leave to block staff requests (sick leave is always allowed). Set date blackouts and request limits.</p>
      <div class="stats-grid" style="margin:12px 0">
        <div class="stat-card ${leaveOpen ? 'success' : 'danger'}"><div class="label">Portal Status</div>
          <div class="value" style="font-size:18px">${leaveOpen ? 'OPEN' : 'CLOSED'}</div>
          <small class="muted">Non-sick leave ${leaveOpen ? 'accepted' : 'blocked'}</small></div>
        <div class="stat-card"><div class="label">Pending Requests</div><div class="value">${rows.filter(l => l.status === 'pending').length}</div></div>
        <div class="stat-card"><div class="label">Active Blackouts</div><div class="value">${blackouts.length}</div></div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
        <button class="btn btn-success btn-sm" id="lv-open-portal" ${leaveOpen ? 'disabled' : ''}>Open Leave Requests</button>
        <button class="btn btn-danger btn-sm" id="lv-close-portal" ${!leaveOpen ? 'disabled' : ''}>Close Leave Requests</button>
      </div>
      <div class="form-grid">
        <div class="field"><label>Minimum notice (days)</label><input type="number" id="lv-notice" min="0" value="${ps.min_leave_notice_days ?? 1}"></div>
        <div class="field"><label>Max requests / month</label>
          <input type="number" id="lv-max-month" min="0" placeholder="Unlimited" value="${ps.max_leave_requests_per_month ?? ''}">
          <small class="muted">0 or blank = unlimited (non-sick)</small></div>
        <div class="field"><label>Max requests / year</label>
          <input type="number" id="lv-max-year" min="0" placeholder="Unlimited" value="${ps.max_leave_requests_per_year ?? ''}">
          <small class="muted">0 or blank = unlimited (non-sick)</small></div>
        <div class="field full"><label>Allowed leave types (comma-separated)</label>
          <input id="lv-types" value="${(ps.leave_types || []).join(', ')}"></div>
        <div class="field full"><label><input type="checkbox" id="lv-approval" ${ps.leave_requires_approval !== false ? 'checked' : ''}> Require admin approval</label></div>
        <div class="field full"><label><input type="checkbox" id="lv-require-selfie" ${ps.require_login_selfie ? 'checked' : ''}> Require verification selfie before Staff Portal (off = camera/upload optional, worker can skip)</label></div>
        <div class="field full"><label><input type="checkbox" id="lv-show-disc" ${ps.show_disciplinary !== false ? 'checked' : ''}> Show disciplinary / warnings on Staff Portal</label></div>
        <div class="field full"><label><input type="checkbox" id="lv-show-pay" ${ps.show_payslips !== false ? 'checked' : ''}> Show payslips on Staff Portal</label></div>
        <div class="field full"><label><input type="checkbox" id="lv-dresp" ${ps.require_disciplinary_response !== false ? 'checked' : ''}> Require worker response on disciplinary records</label></div>
      </div>
      <button class="btn btn-primary btn-sm" id="save-leave-settings" style="margin-top:8px">Save Leave Settings</button>
      </div></div>
      <div class="card" style="margin-bottom:16px"><div class="card-body"><h4>Leave Blackouts</h4>
      <p class="muted">Block non-sick leave for specific days, months, or ranges. Sick leave remains allowed.</p>
      <div class="form-grid" style="margin-top:8px">
        <div class="field"><label>Label</label><input id="lv-bo-label" placeholder="e.g. December shutdown"></div>
        <div class="field"><label>Block type</label>
          <select id="lv-bo-type"><option value="range">Date range</option><option value="day">Single day</option><option value="month">Whole month</option></select></div>
        <div class="field" id="lv-bo-start-wrap"><label>Start / Date</label><input type="date" id="lv-bo-start"></div>
        <div class="field" id="lv-bo-end-wrap"><label>End date</label><input type="date" id="lv-bo-end"></div>
        <div class="field hidden" id="lv-bo-month-wrap"><label>Month</label><input type="month" id="lv-bo-month"></div>
      </div>
      <button class="btn btn-warning btn-sm" id="lv-add-blackout" style="margin-top:8px">Add Blackout Period</button>
      <div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>Label</th><th>From</th><th>To</th><th></th></tr></thead>
        <tbody id="lv-blackout-rows">${blackouts.map((b, i) => `<tr><td>${b.label || 'Blackout'}</td><td>${b.start_date}</td><td>${b.end_date || b.start_date}</td>
          <td><button class="btn btn-sm btn-danger lv-bo-del" data-i="${i}">Remove</button></td></tr>`).join('') || '<tr><td colspan="4" class="muted">No blackout periods</td></tr>'}
        </tbody></table></div>
      </div></div>
      ${pendingProofs.length ? `<div class="card" style="margin-bottom:16px;border-color:var(--warning)"><div class="card-body">
        <h4 style="color:var(--warning)">Pending Proof Confirmations (${pendingProofs.length})</h4>
        <div class="table-wrap"><table><thead><tr><th>Employee</th><th>Leave</th><th>Submitted</th><th>Proof</th><th></th></tr></thead>
        <tbody>${pendingProofs.map(p => `<tr><td>${p.full_name}</td><td>${p.leave_type}<br><small>${p.start_date} – ${p.end_date}</small></td>
          <td>${p.proof_submitted_at ? Utils.formatDateTime(p.proof_submitted_at) : '—'}</td>
          <td>${p.proof_path ? `<img data-image-path="${p.proof_path}" alt="proof" style="width:48px;height:48px;object-fit:cover;border-radius:6px;cursor:pointer" class="lv-proof-thumb">` : '—'}</td>
          <td><button class="btn btn-sm btn-success lv-confirm-proof" data-id="${p.id}">Confirm Proof</button></td></tr>`).join('')}
        </tbody></table></div></div></div>` : ''}
      <h4 style="margin-bottom:8px">Leave Requests</h4>
      <div class="table-wrap"><table><thead><tr><th>Employee</th><th>Type</th><th>From</th><th>To</th><th>Days</th><th>Status</th><th>Proof</th><th></th></tr></thead>
      <tbody>${rows.map(l => `<tr><td>${l.full_name}</td><td>${l.leave_type}</td><td>${l.start_date}</td><td>${l.end_date}</td>
        <td>${l.days}</td><td>${l.status}</td>
        <td>${l.proof_confirmed_at ? '<span class="tag success">Confirmed</span>' : l.proof_path ? '<span class="tag warning">Pending</span>' : '—'}</td>
        <td style="white-space:nowrap">${l.status === 'pending' ? `
          <button class="btn btn-sm btn-success lv-appr" data-id="${l.id}">Approve</button>
          <button class="btn btn-sm btn-danger lv-rej" data-id="${l.id}">Reject</button>` : ''}
          ${l.status === 'approved' ? `
          <button class="btn btn-sm btn-ghost lv-pdf-admin" data-id="${l.id}">PDF</button>
          <button class="btn btn-sm btn-success lv-wa-admin" data-id="${l.id}" data-emp="${l.employee_id}">WhatsApp</button>` : ''}
        </td></tr>`).join('') || '<tr><td colspan="8" class="muted">No leave requests</td></tr>'}
      </tbody></table></div>`;

    this._leaveBlackouts = blackouts.slice();
    window.StaffPage?.bindPortalToggleStates?.(el);

    const syncBlackoutFields = () => {
      const type = document.getElementById('lv-bo-type').value;
      document.getElementById('lv-bo-end-wrap').classList.toggle('hidden', type !== 'range');
      document.getElementById('lv-bo-month-wrap').classList.toggle('hidden', type !== 'month');
      document.getElementById('lv-bo-start-wrap').classList.toggle('hidden', type === 'month');
    };
    document.getElementById('lv-bo-type')?.addEventListener('change', syncBlackoutFields);
    syncBlackoutFields();

    const collectLeaveSettings = (overrides = {}) => ({
      ...(this.settings.staff_portal_settings || {}),
      min_leave_notice_days: parseInt(document.getElementById('lv-notice').value, 10) || 0,
      max_leave_requests_per_month: (() => {
        const v = document.getElementById('lv-max-month').value;
        return v === '' ? null : parseInt(v, 10) || null;
      })(),
      max_leave_requests_per_year: (() => {
        const v = document.getElementById('lv-max-year').value;
        return v === '' ? null : parseInt(v, 10) || null;
      })(),
      leave_types: document.getElementById('lv-types').value.split(',').map(s => s.trim()).filter(Boolean),
      leave_requires_approval: document.getElementById('lv-approval').checked,
      require_login_selfie: !!document.getElementById('lv-require-selfie')?.checked,
      show_disciplinary: document.getElementById('lv-show-disc')
        ? !!document.getElementById('lv-show-disc').checked
        : (this.settings.staff_portal_settings || {}).show_disciplinary !== false,
      show_payslips: document.getElementById('lv-show-pay')
        ? !!document.getElementById('lv-show-pay').checked
        : (this.settings.staff_portal_settings || {}).show_payslips !== false,
      require_disciplinary_response: document.getElementById('lv-dresp')
        ? !!document.getElementById('lv-dresp').checked
        : (this.settings.staff_portal_settings || {}).require_disciplinary_response !== false,
      leave_blackouts: this._leaveBlackouts || [],
      ...(window.StaffPage?.collectPortalToggles ? StaffPage.collectPortalToggles() : {}),
      ...overrides
    });

    const persistLeaveSettings = async (overrides = {}) => {
      const data = collectLeaveSettings(overrides);
      await API.saveJsonSetting('staff_portal_settings', data, this.app.user);
      this.settings.staff_portal_settings = data;
      this.app.settings = { ...this.app.settings, staff_portal_settings: data };
      return data;
    };

    document.getElementById('lv-open-portal')?.addEventListener('click', async () => {
      await persistLeaveSettings({ leave_requests_open: true });
      Utils.toast('Leave requests opened for staff', 'success');
      this.renderStaffLeaveAdmin(el);
    });
    document.getElementById('lv-close-portal')?.addEventListener('click', async () => {
      if (!confirm('Close leave requests? Staff can still submit sick leave.')) return;
      await persistLeaveSettings({ leave_requests_open: false });
      Utils.toast('Leave requests closed (sick leave still allowed)', 'success');
      this.renderStaffLeaveAdmin(el);
    });

    document.getElementById('save-leave-settings')?.addEventListener('click', async () => {
      await persistLeaveSettings();
      Utils.toast('Leave settings saved', 'success');
    });

    document.getElementById('lv-add-blackout')?.addEventListener('click', async () => {
      const type = document.getElementById('lv-bo-type').value;
      const label = document.getElementById('lv-bo-label').value.trim() || 'Blackout';
      let start_date, end_date;
      if (type === 'month') {
        const m = document.getElementById('lv-bo-month').value;
        if (!m) return Utils.toast('Select a month', 'error');
        start_date = `${m}-01`;
        const last = new Date(`${m}-01T12:00:00`);
        last.setMonth(last.getMonth() + 1);
        last.setDate(0);
        end_date = last.toLocaleDateString('en-CA');
      } else if (type === 'day') {
        start_date = document.getElementById('lv-bo-start').value;
        if (!start_date) return Utils.toast('Select a date', 'error');
        end_date = start_date;
      } else {
        start_date = document.getElementById('lv-bo-start').value;
        end_date = document.getElementById('lv-bo-end').value || start_date;
        if (!start_date) return Utils.toast('Start date required', 'error');
        if (end_date < start_date) return Utils.toast('End date must be on or after start date', 'error');
      }
      this._leaveBlackouts.push({ id: Date.now(), label, start_date, end_date });
      await persistLeaveSettings({ leave_blackouts: this._leaveBlackouts });
      Utils.toast('Blackout period added', 'success');
      this.renderStaffLeaveAdmin(el);
    });

    el.querySelectorAll('.lv-bo-del').forEach(b => b.addEventListener('click', async () => {
      const i = parseInt(b.dataset.i, 10);
      this._leaveBlackouts.splice(i, 1);
      await persistLeaveSettings({ leave_blackouts: this._leaveBlackouts });
      Utils.toast('Blackout removed', 'success');
      this.renderStaffLeaveAdmin(el);
    }));

    el.querySelectorAll('.lv-appr').forEach(b => b.addEventListener('click', async () => {
      await API.approveStaffLeave(parseInt(b.dataset.id, 10), this.app.user, true);
      Utils.toast('Leave approved — PDF generated with admin signature', 'success');
      this.renderStaffLeaveAdmin(el);
    }));
    el.querySelectorAll('.lv-rej').forEach(b => b.addEventListener('click', async () => {
      await API.approveStaffLeave(parseInt(b.dataset.id, 10), this.app.user, false);
      this.renderStaffLeaveAdmin(el);
    }));
    el.querySelectorAll('.lv-confirm-proof').forEach(b => b.addEventListener('click', async () => {
      const r = await API.confirmStaffLeaveProof(parseInt(b.dataset.id, 10), this.app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      Utils.toast('Proof confirmed', 'success');
      this.renderStaffLeaveAdmin(el);
    }));
    el.querySelectorAll('.lv-pdf-admin').forEach(b => b.addEventListener('click', async () => {
      const buf = await API.getStaffLeavePdf(parseInt(b.dataset.id, 10));
      await saveStaffPdf(`leave-${b.dataset.id}.pdf`, buf);
    }));
    el.querySelectorAll('.lv-wa-admin').forEach(b => b.addEventListener('click', async () => {
      const leave = rows.find(x => String(x.id) === b.dataset.id);
      const empRes = await API.getEmployee(parseInt(b.dataset.emp, 10));
      if (!leave || !empRes.data) return;
      const waRes = await Utils.sendLeaveWhatsApp(this.app, leave, empRes.data);
      if (!waRes.success) Utils.toast(waRes.error || 'WhatsApp failed', 'error');
    }));
    el.querySelectorAll('.lv-proof-thumb').forEach(img => {
      img.addEventListener('click', async () => {
        const src = await Utils.resolveImageUrl(img.dataset.imagePath);
        Utils.showModal('Leave Proof', `<img src="${src}" style="max-width:100%;border-radius:8px">`, '');
      });
    });
    Utils.hydrateImages(el);
  };

  AdminPage.renderStaffPayroll = async function (el) {
    const currency = this.settings.currency || 'R';
    const from = this._prDashFrom || Utils.daysAgo(30);
    const to = this._prDashTo || Utils.today();
    const branch = this._prDashBranch || '';
    const employeeId = this._prDashEmp || '';
    const empsRes = await API.getEmployees({});
    const emps = empsRes.data || [];
    const branches = [...new Set(emps.map(e => e.branch).filter(Boolean))];
    const dashRes = await API.getPayrollDashboard({
      from, to, branch: branch || undefined, employee_id: employeeId || undefined
    }, this.app.user);
    const dashRows = dashRes.success ? (dashRes.data || []) : [];
    el.innerHTML = `<div class="card" style="margin-bottom:16px"><div class="card-header"><h4>Payroll Dashboard</h4></div><div class="card-body">
      <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center">
        ${Utils.extendedDateFilterHTML('pr-dash-filter', from, to)}
        <select id="pr-branch" style="padding:8px;border-radius:8px;border:1px solid var(--border)">
          <option value="">All branches</option>
          ${branches.map(b => `<option value="${b}" ${branch === b ? 'selected' : ''}>${b}</option>`).join('')}
        </select>
        <select id="pr-emp" style="padding:8px;border-radius:8px;border:1px solid var(--border)">
          <option value="">All employees</option>
          ${emps.map(e => `<option value="${e.id}" ${String(employeeId) === String(e.id) ? 'selected' : ''}>${e.full_name}</option>`).join('')}
        </select>
        <button class="btn btn-ghost" id="pr-dash-pdf">PDF</button>
        <button class="btn btn-ghost" id="pr-dash-excel">Excel</button>
      </div>
      ${!dashRes.success ? `<p class="muted" style="color:var(--danger)">${dashRes.error || 'Could not load dashboard'}</p>` : ''}
      <div class="table-wrap"><table><thead><tr>
        <th>Employee</th><th>Scheduled</th><th>Worked</th><th>Missed</th><th>Late</th><th>OT</th><th>Gross</th><th>Deductions</th><th>Net</th>
      </tr></thead><tbody>
        ${dashRows.map(r => `<tr><td><strong>${r.full_name}</strong></td>
          <td>${Number(r.scheduled_hours || 0).toFixed(1)}h</td>
          <td>${Number(r.hours_worked || 0).toFixed(1)}h</td>
          <td>${Number(r.hours_missed || 0).toFixed(1)}h</td>
          <td>${r.late_minutes > 0 ? `${r.late_minutes}m` : '—'}</td>
          <td>${Number(r.overtime_hours || 0).toFixed(1)}h</td>
          <td>${Utils.formatMoney(r.gross_pay, currency)}</td>
          <td>${Utils.formatMoney(r.total_deductions, currency)}</td>
          <td><strong>${Utils.formatMoney(r.net_salary, currency)}</strong></td></tr>`).join('') ||
          '<tr><td colspan="9" class="muted">No payroll data for selected period</td></tr>'}
      </tbody></table></div></div></div>
      <div class="card"><div class="card-header"><h4>Generate Payroll</h4></div><div class="card-body">
      <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
      <input type="date" id="pr-start" value="${from}"><input type="date" id="pr-end" value="${to}">
      <button class="btn btn-ghost" id="pr-preview">Preview payroll</button>
      <button class="btn btn-primary" id="pr-gen">Generate Payroll</button></div>
      <div id="pr-preview-box"></div>
      <div id="pr-list"><p class="muted">Preview first to see OT caps and max-pay flags, then generate payroll records for active employees</p></div></div></div>`;
    Utils.bindDateFilter(document.getElementById('pr-dash-filter'), (f, t) => {
      this._prDashFrom = f;
      this._prDashTo = t;
      this._prDashBranch = document.getElementById('pr-branch').value;
      this._prDashEmp = document.getElementById('pr-emp').value;
      this.renderStaffPayroll(el);
    });
    document.getElementById('pr-branch').addEventListener('change', () => {
      this._prDashBranch = document.getElementById('pr-branch').value;
      this._prDashEmp = document.getElementById('pr-emp').value;
      this.renderStaffPayroll(el);
    });
    document.getElementById('pr-emp').addEventListener('change', () => {
      this._prDashBranch = document.getElementById('pr-branch').value;
      this._prDashEmp = document.getElementById('pr-emp').value;
      this.renderStaffPayroll(el);
    });
    document.getElementById('pr-dash-pdf').addEventListener('click', async () => {
      const buf = await API.getStaffReportPdf('payroll_dashboard', dashRows);
      await saveStaffPdf(`payroll-dashboard-${from}-${to}.pdf`, buf);
    });
    document.getElementById('pr-dash-excel').addEventListener('click', async () => {
      await Export.toExcel(`payroll-dashboard-${from}-${to}.xlsx`, [{
        name: 'Payroll',
        headers: ['Employee', 'Scheduled Hours', 'Worked', 'Missed', 'Late Min', 'OT Hours', 'Gross', 'Deductions', 'Net'],
        rows: dashRows.map(r => [
          r.full_name, r.scheduled_hours, r.hours_worked, r.hours_missed, r.late_minutes,
          r.overtime_hours, r.gross_pay, r.total_deductions, r.net_salary
        ])
      }]);
    });
    document.getElementById('pr-preview').addEventListener('click', async () => {
      const start = document.getElementById('pr-start').value;
      const end = document.getElementById('pr-end').value;
      const r = await API.previewStaffPayroll(start, end, {
        branch: document.getElementById('pr-branch')?.value || undefined,
        employee_id: document.getElementById('pr-emp')?.value || undefined
      }, this.app.user);
      if (!r.success) return Utils.toast(r.error || 'Preview failed', 'error');
      const list = r.data || [];
      const box = document.getElementById('pr-preview-box');
      box.innerHTML = `<div class="card" style="margin-bottom:12px;border-color:var(--primary)"><div class="card-body">
        <h4 style="margin-top:0">Payroll preview · ${start} → ${end}</h4>
        <p class="muted" style="font-size:13px">Shows estimated net before generate. Flags show max-pay / OT settings from each employee schedule.</p>
        <div class="table-wrap"><table><thead><tr>
          <th>Employee</th><th>Worked</th><th>OT</th><th>Gross</th><th>Deductions</th><th>Net</th><th>Flags</th>
        </tr></thead><tbody>
          ${list.map(p => `<tr>
            <td>${Utils.escHtml(p.full_name)}</td>
            <td>${Number(p.hours_worked || 0).toFixed(1)}h</td>
            <td>${Number(p.overtime_hours || 0).toFixed(1)}h</td>
            <td>${Utils.formatMoney(p.gross_pay, currency)}</td>
            <td>${Utils.formatMoney(p.total_deductions, currency)}</td>
            <td><strong>${Utils.formatMoney(p.net_salary, currency)}</strong></td>
            <td><small>${(p.flags || []).length ? Utils.escHtml((p.flags || []).join(' · ')) : '—'}</small></td>
          </tr>`).join('') || '<tr><td colspan="7" class="muted">No employees</td></tr>'}
        </tbody></table></div></div></div>`;
      Utils.toast(`Preview ready for ${list.length} employee(s)`, 'success');
    });
    document.getElementById('pr-gen').addEventListener('click', async () => {
      const r = await API.generateStaffPayroll(
        document.getElementById('pr-start').value,
        document.getElementById('pr-end').value,
        null,
        this.app.user
      );
      if (!r.success) return Utils.toast(r.error, 'error');
      const list = r.data || [];
      const empName = (id) => emps.find(e => String(e.id) === String(id))?.full_name || `Employee #${id}`;
      document.getElementById('pr-list').innerHTML = `<table><thead><tr><th>Employee</th><th>Period</th><th>Net</th><th>Status</th><th></th></tr></thead>
        <tbody>${list.map(p => `<tr data-pay-row="${p.id}"><td>${Utils.escHtml(empName(p.employee_id))}</td><td>${p.period_start}–${p.period_end}</td>
          <td>${Utils.formatMoney(p.net_salary, currency)}</td><td class="pr-status">${p.status}</td><td>
          ${p.status === 'pending' ? `<button class="btn btn-sm btn-success pr-pay" data-id="${p.id}">Mark Paid</button>` : ''}
          <button class="btn btn-sm btn-ghost pr-pdf" data-id="${p.id}">PDF</button>
          <button class="btn btn-sm btn-success pr-wa" data-id="${p.id}" data-emp="${p.employee_id}">WhatsApp</button></td></tr>`).join('')}</tbody></table>`;
      document.querySelectorAll('.pr-pay').forEach(b => b.addEventListener('click', async () => {
        const payRes = await API.payStaffSalary(parseInt(b.dataset.id), 'cash', this.app.user);
        if (payRes && payRes.success === false) return Utils.toast(payRes.error || 'Could not mark paid', 'error');
        Utils.toast('Marked as paid', 'success');
        const row = document.querySelector(`[data-pay-row="${b.dataset.id}"]`);
        if (row) {
          row.querySelector('.pr-status').textContent = 'paid';
          b.remove();
        }
      }));
      document.querySelectorAll('.pr-pdf').forEach(b => b.addEventListener('click', async () => {
        const buf = await API.getStaffPayslipPdf(parseInt(b.dataset.id));
        await saveStaffPdf(`payslip-${b.dataset.id}.pdf`, buf);
      }));
      document.querySelectorAll('.pr-wa').forEach(b => b.addEventListener('click', async () => {
        const p = list.find(x => String(x.id) === b.dataset.id);
        const empRes = await API.getEmployee(parseInt(b.dataset.emp, 10));
        if (!p || !empRes.data) return;
        const waRes = await Utils.sendPayslipWhatsApp(this.app, p, empRes.data);
        if (!waRes.success) Utils.toast(waRes.error || 'WhatsApp failed', 'error');
      }));
    });
  };

  AdminPage.renderStaffLoginEvents = async function (el) {
    const from = this._loginFrom || Utils.daysAgo(7);
    const to = this._loginTo || Utils.today();
    const res = await API.getStaffLoginEvents({ from, to });
    const rows = res.data || [];
    el.innerHTML = `<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
      <input type="date" id="login-from" value="${from}"><input type="date" id="login-to" value="${to}">
      <button class="btn btn-ghost" id="login-filter">Filter</button></div>
      <div class="table-wrap"><table><thead><tr><th>When</th><th>User</th><th>Event</th><th>Scheduled</th><th>Late</th><th>Early</th><th>Notes</th></tr></thead>
      <tbody>${rows.map(e => `<tr>
        <td>${Utils.formatDateTime(e.event_at)}</td>
        <td><strong>${e.full_name || e.username}</strong></td>
        <td>${e.event_type}</td>
        <td>${e.scheduled_start && e.scheduled_end ? `${e.scheduled_start} – ${e.scheduled_end}` : '—'}</td>
        <td>${e.late_minutes > 0 ? `${e.late_minutes} min` : '—'}</td>
        <td>${e.early_minutes > 0 ? `${e.early_minutes} min` : '—'}</td>
        <td><small class="muted">${e.notes || '—'}</small></td></tr>`).join('') || '<tr><td colspan="7" class="muted">No login events</td></tr>'}
      </tbody></table></div>`;
    document.getElementById('login-filter').addEventListener('click', () => {
      this._loginFrom = document.getElementById('login-from').value;
      this._loginTo = document.getElementById('login-to').value;
      this.renderStaffLoginEvents(el);
    });
  };

  AdminPage.renderStaffShifts = async function (el) {
    const from = Utils.weekStart();
    const empsRes = await API.getEmployees({ status: 'Active' });
    const emps = empsRes.data || [];

    const parseEmpWorkSchedule = (emp) => {
      const defaults = { shift_start: '08:00', shift_end: '17:00', expected_days_per_week: 5, work_days: null };
      if (!emp.work_schedule) return defaults;
      if (typeof emp.work_schedule === 'object') return { ...defaults, ...emp.work_schedule };
      try { return { ...defaults, ...JSON.parse(emp.work_schedule) }; } catch { return defaults; }
    };

    const getDefaultWorkDays = (n) => {
      const days = Math.min(7, Math.max(1, Number(n) || 5));
      return Array.from({ length: days }, (_, i) => i);
    };

    const jsDayToMonBased = (jsDay) => (jsDay + 6) % 7;

    const buildShiftForDate = (emp, shiftDate, overrides = {}) => {
      const ws = parseEmpWorkSchedule(emp);
      const shiftStart = overrides.shift_start || ws.shift_start || '08:00';
      const shiftEnd = overrides.shift_end || ws.shift_end || '17:00';
      const workDays = Array.isArray(ws.work_days) && ws.work_days.length ? ws.work_days : getDefaultWorkDays(ws.expected_days_per_week);
      const monDay = jsDayToMonBased(new Date(shiftDate + 'T12:00:00').getDay());
      const isRest = !workDays.includes(monDay);
      return {
        employee_id: emp.id,
        shift_date: shiftDate,
        shift_name: isRest ? 'Rest Day' : (emp.position ? `${emp.position} Shift` : 'Regular Shift'),
        start_time: isRest ? null : shiftStart,
        end_time: isRest ? null : shiftEnd,
        is_rest_day: isRest,
        branch: emp.branch
      };
    };

    this._shiftPreset = this._shiftPreset || '4w';
    this._shiftCustomWeeks = this._shiftCustomWeeks || 6;
    el.innerHTML = `<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:end">
      <div class="field" style="margin:0"><label>Start date</label><input type="date" id="sh-week" value="${from}"></div>
      <div class="field" style="margin:0"><label>Generate / view for</label>
        <select id="sh-preset">
          <option value="1w" ${this._shiftPreset === '1w' ? 'selected' : ''}>1 week</option>
          <option value="2w" ${this._shiftPreset === '2w' ? 'selected' : ''}>2 weeks</option>
          <option value="3w" ${this._shiftPreset === '3w' ? 'selected' : ''}>3 weeks</option>
          <option value="4w" ${this._shiftPreset === '4w' ? 'selected' : ''}>4 weeks</option>
          <option value="1m" ${this._shiftPreset === '1m' ? 'selected' : ''}>1 month</option>
          <option value="2m" ${this._shiftPreset === '2m' ? 'selected' : ''}>2 months</option>
          <option value="cw" ${this._shiftPreset === 'cw' ? 'selected' : ''}>Custom weeks</option>
          <option value="ce" ${this._shiftPreset === 'ce' ? 'selected' : ''}>Custom end date</option>
        </select></div>
      <div class="field" style="margin:0${this._shiftPreset === 'cw' ? '' : ';display:none'}" id="sh-custom-weeks-wrap">
        <label>Weeks</label><input type="number" id="sh-custom-weeks" min="1" max="12" value="${this._shiftCustomWeeks}" style="width:72px"></div>
      <div class="field" style="margin:0${this._shiftPreset === 'ce' ? '' : ';display:none'}" id="sh-custom-end-wrap">
        <label>End date</label><input type="date" id="sh-custom-end" value="${this._shiftCustomEnd || ''}"></div>
      <button class="btn btn-ghost" id="sh-snap-mon">Snap start to Monday</button>
      <button class="btn btn-primary" id="sh-add">+ Add Shift</button>
      <button class="btn btn-primary" id="sh-auto">Generate shifts</button>
      <button class="btn btn-ghost" id="sh-regen">Regenerate range</button>
      <button class="btn btn-ghost" id="sh-print-a4">Print A4</button>
      <button class="btn btn-ghost" id="sh-pdf">Download Schedule PDF</button></div>
      <div class="card" style="margin-bottom:12px;padding:12px"><strong>Select workers for shift generation</strong>
        <p class="muted" style="font-size:13px">Set opening/closing times per worker below, then generate. Workers on approved leave are excluded automatically.</p>
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px" id="sh-emp-picks">
          ${emps.map(e => `<label><input type="checkbox" class="sh-emp" value="${e.id}" checked> ${e.full_name}</label>`).join('') || '<span class="muted">No active employees</span>'}
        </div></div>
      <div class="card" style="margin-bottom:12px;padding:12px" id="sh-times-card">
        <strong>Worker shift times (before generate)</strong>
        <p class="muted" style="font-size:13px;margin:4px 0 8px">Adjust opening/closing times for selected workers. Save to profiles to persist, or generate directly with these times.</p>
        <div id="sh-times-table"></div>
        <button class="btn btn-ghost" id="sh-save-times" style="margin-top:8px">Save times to profiles</button>
      </div>
      <div id="sh-list"><p class="muted">Generate shifts for selected workers</p></div>`;

    const selectedIds = () => [...el.querySelectorAll('.sh-emp:checked')].map(cb => parseInt(cb.value));

    const getOverrides = () => {
      const map = {};
      el.querySelectorAll('.sh-time-row').forEach(row => {
        const id = parseInt(row.dataset.id, 10);
        map[id] = {
          shift_start: row.querySelector('.sh-open').value || '08:00',
          shift_end: row.querySelector('.sh-close').value || '17:00'
        };
      });
      return map;
    };

    const renderTimesTable = () => {
      const selected = emps.filter(e => selectedIds().includes(e.id));
      const container = document.getElementById('sh-times-table');
      if (!container) return;
      if (!selected.length) {
        container.innerHTML = '<p class="muted">Select at least one worker above</p>';
        return;
      }
      container.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Employee</th><th>Opening</th><th>Closing</th></tr></thead>
        <tbody>${selected.map(e => {
          const ws = parseEmpWorkSchedule(e);
          const open = ws.shift_start || '08:00';
          const close = ws.shift_end || '17:00';
          return `<tr class="sh-time-row" data-id="${e.id}"><td>${e.full_name}</td>
            <td><input type="time" class="sh-open" value="${open}"></td>
            <td><input type="time" class="sh-close" value="${close}"></td></tr>`;
        }).join('')}</tbody></table></div>`;
    };

    const addDaysIso = (iso, n) => {
      const d = new Date(iso + 'T12:00:00');
      d.setDate(d.getDate() + n);
      return d.toLocaleDateString('en-CA');
    };
    const mondayOf = (iso) => {
      const d = new Date((iso || Utils.weekStart()) + 'T12:00:00');
      const day = d.getDay();
      const diff = day === 0 ? -6 : 1 - day;
      d.setDate(d.getDate() + diff);
      return d.toLocaleDateString('en-CA');
    };
    const addMonthsEnd = (iso, months) => {
      const d = new Date((iso || Utils.today()) + 'T12:00:00');
      d.setMonth(d.getMonth() + months);
      d.setDate(d.getDate() - 1);
      return d.toLocaleDateString('en-CA');
    };
    const currentRange = () => {
      const startEl = document.getElementById('sh-week');
      const start = startEl?.value || Utils.weekStart();
      const preset = document.getElementById('sh-preset')?.value || this._shiftPreset || '4w';
      this._shiftPreset = preset;
      const weeksMap = { '1w': 1, '2w': 2, '3w': 3, '4w': 4 };
      let end;
      if (weeksMap[preset]) end = addDaysIso(start, weeksMap[preset] * 7 - 1);
      else if (preset === '1m') end = addMonthsEnd(start, 1);
      else if (preset === '2m') end = addMonthsEnd(start, 2);
      else if (preset === 'cw') {
        const n = Math.max(1, Math.min(12, parseInt(document.getElementById('sh-custom-weeks')?.value, 10) || this._shiftCustomWeeks || 6));
        this._shiftCustomWeeks = n;
        end = addDaysIso(start, n * 7 - 1);
      } else if (preset === 'ce') {
        const customEnd = document.getElementById('sh-custom-end')?.value || this._shiftCustomEnd;
        end = customEnd && customEnd >= start ? customEnd : addDaysIso(start, 27);
        this._shiftCustomEnd = end;
      } else end = addDaysIso(start, 27);
      const days = Math.max(1, Math.round((new Date(end + 'T12:00:00') - new Date(start + 'T12:00:00')) / 86400000) + 1);
      const weeks = Math.max(1, Math.ceil(days / 7));
      return { week: start, start, end, days, weeks, preset };
    };
    const syncPresetUi = () => {
      const preset = document.getElementById('sh-preset')?.value || '4w';
      const cw = document.getElementById('sh-custom-weeks-wrap');
      const ce = document.getElementById('sh-custom-end-wrap');
      if (cw) cw.style.display = preset === 'cw' ? '' : 'none';
      if (ce) ce.style.display = preset === 'ce' ? '' : 'none';
    };
    const shiftRowHtml = (s) => `<tr><td>${s.shift_date}</td><td>${s.full_name}</td><td>${s.shift_name}</td>
      <td>${s.is_rest_day ? '—' : (s.start_time || '—')}</td>
      <td>${s.is_rest_day ? '—' : (s.end_time || '—')}</td>
      <td style="white-space:nowrap">
        ${s.id ? `<button class="btn btn-sm btn-ghost sh-edit" data-id="${s.id}">Edit</button>
          <button class="btn btn-sm btn-ghost sh-redo" data-id="${s.id}">Redo</button>
          <button class="btn btn-sm btn-danger sh-del" data-id="${s.id}">Delete</button>` : '<span class="muted">Default hours</span>'}
      </td></tr>`;

    const loadShifts = async () => {
      const { week, weeks, end, days } = currentRange();
      const sres = await API.getStaffSchedules(week, end);
      const rows = (sres.data || []).filter((s) => s.id && !s._from_work_schedule);
      const groups = [];
      for (let w = 0; w < weeks; w++) {
        const ws = addDaysIso(week, w * 7);
        const we = addDaysIso(week, Math.min(w * 7 + 6, days - 1));
        groups.push({
          label: `Week ${w + 1}: ${ws} → ${we}`,
          rows: rows.filter(s => s.shift_date >= ws && s.shift_date <= we)
        });
      }
      document.getElementById('sh-list').innerHTML = `
        <p class="muted">Showing <strong>${days} day${days > 1 ? 's' : ''}</strong> (${week} → ${end}) · <strong>${rows.length} generated shift(s)</strong>. PDF / Print use this exact range.</p>
        ${groups.map(g => `<h4 style="margin:16px 0 8px">${g.label} · ${g.rows.length} generated row(s)</h4>
          ${g.rows.length
            ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Employee</th><th>Shift</th><th>Opening</th><th>Closing</th><th></th></tr></thead>
              <tbody>${g.rows.map(shiftRowHtml).join('')}</tbody></table></div>`
            : '<p class="muted">No generated shifts this week — generate above</p>'}`).join('')}`;

      el.querySelectorAll('.sh-edit').forEach(b => b.addEventListener('click', async () => {
        const sched = rows.find(x => x.id == b.dataset.id);
        if (!sched) return;
        Utils.showModal('Edit Shift', `<div class="form-grid">
          <div class="field"><label>Shift Name</label><input id="es-name" value="${sched.shift_name || ''}"></div>
          <div class="field"><label>Opening</label><input type="time" id="es-start" value="${sched.start_time || ''}"></div>
          <div class="field"><label>Closing</label><input type="time" id="es-end" value="${sched.end_time || ''}"></div>
          <div class="field full"><label><input type="checkbox" id="es-rest" ${sched.is_rest_day ? 'checked' : ''}> Rest day</label></div>
        </div>`, '<button class="btn btn-primary" id="es-save">Save</button>');
        document.getElementById('es-save').addEventListener('click', async () => {
          await API.saveStaffSchedule({
            id: sched.id, employee_id: sched.employee_id, shift_date: sched.shift_date,
            shift_name: document.getElementById('es-name').value.trim(),
            start_time: document.getElementById('es-start').value,
            end_time: document.getElementById('es-end').value,
            is_rest_day: document.getElementById('es-rest').checked
          }, this.app.user);
          Utils.hideModal();
          loadShifts();
        });
      }));

      el.querySelectorAll('.sh-del').forEach(b => b.addEventListener('click', async () => {
        if (!confirm('Delete this shift?')) return;
        const r = await API.deleteStaffSchedule(parseInt(b.dataset.id, 10), this.app.user);
        if (!r.success) return Utils.toast(r.error || 'Could not delete shift', 'error');
        Utils.toast('Shift deleted', 'success');
        loadShifts();
      }));

      el.querySelectorAll('.sh-redo').forEach(b => b.addEventListener('click', async () => {
        const sched = rows.find(x => x.id == b.dataset.id);
        if (!sched) return;
        const emp = emps.find(e => e.id === sched.employee_id);
        if (!emp) return Utils.toast('Employee not found', 'error');
        const overrides = getOverrides();
        const empOv = overrides[sched.employee_id] || {};
        const del = await API.deleteStaffSchedule(sched.id, this.app.user);
        if (!del.success) return Utils.toast(del.error || 'Could not delete shift', 'error');
        const shiftData = buildShiftForDate(emp, sched.shift_date, empOv);
        const r = await API.saveStaffSchedule(shiftData, this.app.user);
        if (!r.success) return Utils.toast(r.error || 'Could not recreate shift', 'error');
        Utils.toast('Shift recreated from worker schedule', 'success');
        loadShifts();
      }));
    };

    const runGenerate = async (confirmRegen = false) => {
      const { start, end, days } = currentRange();
      document.getElementById('sh-week').value = start;
      const ids = selectedIds();
      if (!ids.length) return Utils.toast('Select at least one worker', 'error');
      if (confirmRegen && !confirm(`Regenerate shifts for ${start} → ${end} (${days} days)? Existing shifts for selected workers in that range will be replaced.`)) return;
      const overrides = getOverrides();
      const r = await API.autoGenerateStaffShifts(start, null, ids, overrides, this.app.user, { days, endDate: end });
      if (!r.success) return Utils.toast(r.error, 'error');
      Utils.toast(`Created ${(r.data || []).length} generated shift(s) for ${start} → ${end}`, 'success');
      loadShifts();
    };

    el.querySelectorAll('.sh-emp').forEach(cb => cb.addEventListener('change', renderTimesTable));

    document.getElementById('sh-save-times').addEventListener('click', async () => {
      const overrides = getOverrides();
      let saved = 0;
      for (const [empId, times] of Object.entries(overrides)) {
        const emp = emps.find(e => e.id === parseInt(empId, 10));
        if (!emp) continue;
        const ws = parseEmpWorkSchedule(emp);
        const r = await API.saveEmployeeWorkSchedule(parseInt(empId, 10), {
          ...ws,
          shift_start: times.shift_start,
          shift_end: times.shift_end
        }, this.app.user);
        if (r.success) saved++;
      }
      Utils.toast(saved ? `Saved times for ${saved} worker(s)` : 'Nothing to save', saved ? 'success' : 'info');
    });

    document.getElementById('sh-add').addEventListener('click', () => {
      Utils.showModal('Add Shift', `<div class="form-grid">
        <div class="field"><label>Employee</label><select id="as-emp">${emps.map(e => `<option value="${e.id}">${e.full_name}</option>`).join('')}</select></div>
        <div class="field"><label>Date</label><input type="date" id="as-date" value="${document.getElementById('sh-week').value}"></div>
        <div class="field"><label>Shift Name</label><input id="as-name" value="Regular Shift"></div>
        <div class="field"><label>Opening</label><input type="time" id="as-start" value="08:00"></div>
        <div class="field"><label>Closing</label><input type="time" id="as-end" value="17:00"></div>
        <div class="field full"><label><input type="checkbox" id="as-rest"> Rest day</label></div>
      </div>`, '<button class="btn btn-primary" id="as-save">Save Shift</button>');
      document.getElementById('as-save').addEventListener('click', async () => {
        const r = await API.saveStaffSchedule({
          employee_id: parseInt(document.getElementById('as-emp').value),
          shift_date: document.getElementById('as-date').value,
          shift_name: document.getElementById('as-name').value.trim() || 'Shift',
          start_time: document.getElementById('as-start').value,
          end_time: document.getElementById('as-end').value,
          is_rest_day: document.getElementById('as-rest').checked
        }, this.app.user);
        if (!r.success) return Utils.toast(r.error || 'Could not save shift', 'error');
        Utils.hideModal();
        Utils.toast('Shift saved', 'success');
        loadShifts();
      });
    });

    document.getElementById('sh-week').addEventListener('change', () => loadShifts());
    document.getElementById('sh-preset')?.addEventListener('change', () => {
      syncPresetUi();
      loadShifts();
    });
    document.getElementById('sh-custom-weeks')?.addEventListener('change', () => loadShifts());
    document.getElementById('sh-custom-end')?.addEventListener('change', () => loadShifts());
    document.getElementById('sh-snap-mon')?.addEventListener('click', () => {
      const elDate = document.getElementById('sh-week');
      if (elDate) elDate.value = mondayOf(elDate.value);
      loadShifts();
    });

    document.getElementById('sh-print-a4').addEventListener('click', async () => {
      const { start, end } = currentRange();
      const htmlRes = await API.getStaffSchedulePrintHtml(start, end);
      if (!htmlRes.success) return Utils.toast(htmlRes.error || 'Could not build schedule', 'error');
      await printStaffA4(htmlRes.data, `Shifts ${start} – ${end}`);
    });

    document.getElementById('sh-auto').addEventListener('click', () => {
      runGenerate(false);
    });
    document.getElementById('sh-regen').addEventListener('click', () => {
      runGenerate(true);
    });

    document.getElementById('sh-pdf').addEventListener('click', async () => {
      const { start, end, days } = currentRange();
      const buf = await API.getStaffSchedulePdf(start, end);
      if (!buf?.success) return Utils.toast(buf?.error || 'Could not build PDF', 'error');
      await saveStaffPdf(`shift-schedule-${start}-to-${end}-${days}d.pdf`, buf);
    });
    syncPresetUi();

    renderTimesTable();
    loadShifts();
  };

  AdminPage.renderStaffDisciplinaryAdmin = async function (el) {
    const empsRes = await API.getEmployees();
    const emps = empsRes.data || [];
    const res = await API.getAllStaffDisciplinary({}, this.app.user);
    const rows = res.data || [];
    el.innerHTML = `<div style="display:flex;gap:8px;margin-bottom:12px">
      <button class="btn btn-primary" id="disc-add">+ Add Record</button></div>
      <div class="table-wrap"><table><thead><tr><th>Employee</th><th>Type</th><th>Date</th><th>Description</th><th>Status</th><th>Worker Response</th><th></th></tr></thead>
      <tbody>${rows.map(d => `<tr><td>${d.full_name}</td><td>${d.record_type}</td><td>${d.incident_date}</td>
        <td><small>${(d.description || '').slice(0, 80)}</small></td><td>${d.status || 'open'}</td>
        <td><small>${d.worker_response || '—'}</small></td>
        <td style="white-space:nowrap">
          <button class="btn btn-sm btn-ghost disc-view" data-id="${d.id}">View</button>
          <button class="btn btn-sm btn-primary disc-print-admin" data-id="${d.id}">Print</button>
          <button class="btn btn-sm btn-ghost disc-save-admin" data-id="${d.id}">Download PDF</button>
          <button class="btn btn-sm btn-success disc-wa-admin" data-id="${d.id}" data-emp="${d.employee_id}">WhatsApp</button>
        </td></tr>`).join('') || '<tr><td colspan="7" class="muted">No records</td></tr>'}
      </tbody></table></div>`;

    const openDiscPdf = async (id, mode = 'view') => {
      const buf = await API.getStaffDisciplinaryPdf(parseInt(id, 10), 'admin');
      if (!buf.success) return Utils.toast(buf.error, 'error');
      if (mode === 'save') {
        await saveStaffPdf(`disciplinary-admin-${id}.pdf`, buf);
        return;
      }
      if (mode === 'print') {
        await Utils.printToA4(buf, `disciplinary-admin-${id}.pdf`);
        return;
      }
      await API.openPdf(buf.data, `disciplinary-admin-${id}.pdf`);
    };

    document.getElementById('disc-add').addEventListener('click', () => {
      Utils.showModal('Add Disciplinary Record', `<div class="form-grid">
        <div class="field"><label>Employee</label><select id="disc-emp">${emps.map(e => `<option value="${e.id}">${e.full_name}</option>`).join('')}</select></div>
        <div class="field"><label>Type</label><select id="disc-type"><option>Warning</option><option>Hearing</option><option>Disciplinary Action</option><option>Suspension</option></select></div>
        <div class="field"><label>Incident Date</label><input type="date" id="disc-date" value="${Utils.today()}"></div>
        <div class="field full"><label>Description</label><textarea id="disc-desc" rows="2"></textarea></div>
        <div class="field full"><label>Action Taken</label><input id="disc-action"></div>
        <div class="field full"><label><input type="checkbox" id="disc-req" ${(this.settings?.staff_portal_settings?.require_disciplinary_response !== false) ? 'checked' : ''}> Require worker response in staff portal</label></div>
        <div class="field full"><label><input type="checkbox" id="disc-wa-send" checked> Send WhatsApp notification after save</label></div>
      </div>`, '<button class="btn btn-primary" id="disc-save">Save Record</button>');
      document.getElementById('disc-save').addEventListener('click', async () => {
        const empId = parseInt(document.getElementById('disc-emp').value, 10);
        const r = await API.saveStaffDisciplinary({
          employee_id: empId,
          record_type: document.getElementById('disc-type').value,
          incident_date: document.getElementById('disc-date').value,
          description: document.getElementById('disc-desc').value.trim(),
          action_taken: document.getElementById('disc-action').value.trim(),
          requires_response: document.getElementById('disc-req').checked,
          status: 'open'
        }, this.app.user);
        if (!r.success) return Utils.toast(r.error, 'error');
        Utils.hideModal();
        Utils.toast('Record saved — PDF generated for admin & staff', 'success');
        if (document.getElementById('disc-wa-send')?.checked) {
          const emp = emps.find(e => e.id === empId);
          if (emp?.phone && r.data) {
            const waRes = await Utils.sendDisciplinaryWhatsApp(this.app, r.data, emp);
            if (!waRes.success) Utils.toast(waRes.error || 'WhatsApp not sent', 'error');
          }
        }
        this.renderStaffDisciplinaryAdmin(el);
      });
    });

    el.querySelectorAll('.disc-view').forEach(b => b.addEventListener('click', () => openDiscPdf(b.dataset.id, 'view')));
    el.querySelectorAll('.disc-save-admin').forEach(b => b.addEventListener('click', () => openDiscPdf(b.dataset.id, 'save')));
    el.querySelectorAll('.disc-print-admin').forEach(b => b.addEventListener('click', () => openDiscPdf(b.dataset.id, 'print')));
    el.querySelectorAll('.disc-wa-admin').forEach(b => b.addEventListener('click', async () => {
      const record = rows.find(x => String(x.id) === b.dataset.id);
      const emp = emps.find(e => String(e.id) === b.dataset.emp);
      if (!record || !emp) return;
      const waRes = await Utils.sendDisciplinaryWhatsApp(this.app, record, emp);
      if (!waRes.success) Utils.toast(waRes.error || 'WhatsApp failed', 'error');
    }));
  };

  AdminPage.renderStaffReports = async function (el) {
    el.innerHTML = `<div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-primary" id="sr-staff">Staff List PDF</button>
      <button class="btn btn-ghost" id="sr-att">Attendance PDF</button>
      <button class="btn btn-ghost" id="sr-att-excel">Attendance Excel</button>
      <button class="btn btn-ghost" id="sr-payroll">Payroll Dashboard PDF</button>
      <button class="btn btn-ghost" id="sr-payroll-excel">Payroll Dashboard Excel</button></div>`;
    document.getElementById('sr-staff').addEventListener('click', async () => {
      const r = await API.getEmployees({});
      const buf = await API.getStaffReportPdf('staff_list', r.data || []);
      await saveStaffPdf('staff-list.pdf', buf);
    });
    document.getElementById('sr-att').addEventListener('click', async () => {
      const r = await API.getStaffAttendance({ from: Utils.daysAgo(30), to: Utils.today() });
      const buf = await API.getStaffReportPdf('attendance', r.data || []);
      await saveStaffPdf('attendance-report.pdf', buf);
    });
    document.getElementById('sr-att-excel').addEventListener('click', async () => {
      const r = await API.getStaffAttendance({ from: Utils.daysAgo(30), to: Utils.today() });
      const rows = r.data || [];
      await Export.toExcel('attendance-report.xlsx', [{
        name: 'Attendance',
        headers: ['Date', 'Employee', 'Branch', 'In', 'Out', 'Worked', 'Late', 'Status'],
        rows: rows.map(a => [a.work_date, a.full_name, a.branch || '', a.clock_in || '', a.clock_out || '', a.hours_worked, a.late_minutes, a.status])
      }]);
    });
    document.getElementById('sr-payroll').addEventListener('click', async () => {
      const from = Utils.daysAgo(30);
      const to = Utils.today();
      const r = await API.getPayrollDashboard({ from, to }, this.app.user);
      const buf = await API.getStaffReportPdf('payroll_dashboard', r.data || []);
      await saveStaffPdf('payroll-dashboard.pdf', buf);
    });
    document.getElementById('sr-payroll-excel').addEventListener('click', async () => {
      const from = Utils.daysAgo(30);
      const to = Utils.today();
      const r = await API.getPayrollDashboard({ from, to }, this.app.user);
      const rows = r.data || [];
      await Export.toExcel('payroll-dashboard.xlsx', [{
        name: 'Payroll',
        headers: ['Employee', 'Scheduled', 'Worked', 'Missed', 'Late', 'OT', 'Gross', 'Deductions', 'Net'],
        rows: rows.map(x => [x.full_name, x.scheduled_hours, x.hours_worked, x.hours_missed, x.late_minutes, x.overtime_hours, x.gross_pay, x.total_deductions, x.net_salary])
      }]);
    });
  };

  AdminPage.renderStaffHrDocs = async function (el) {
    const empsRes = await API.getEmployees({});
    const emps = empsRes.data || [];
    const selectedEmp = this._hrEmp || (emps[0]?.id || '');
    let docs = [];
    if (selectedEmp) {
      const res = await API.getHrDocuments(parseInt(selectedEmp, 10), this.app.user);
      docs = res.success ? (res.data || []) : [];
    }
    const templates = {
      warning: 'This letter serves as a formal written warning regarding the incident described below. You are required to improve your conduct and adhere to company policies.',
      disciplinary: 'You are hereby notified of disciplinary action following the incident below. Failure to comply may result in further action up to and including dismissal.',
      suspension: 'You are suspended from duty effective immediately pending investigation of the matter below.',
      termination: 'This letter confirms termination of employment effective from the date below, following the circumstances described.',
      general: 'Please find the HR document below for your records.'
    };
    el.innerHTML = `<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center">
      <select id="hr-emp" style="padding:8px;border-radius:8px;border:1px solid var(--border)">
        ${emps.map(e => `<option value="${e.id}" ${String(selectedEmp) === String(e.id) ? 'selected' : ''}>${e.full_name}</option>`).join('')}
      </select>
      <button class="btn btn-primary" id="hr-new">+ New Document</button></div>
      <div class="table-wrap"><table><thead><tr><th>Date</th><th>Type</th><th>Title</th><th>Created</th><th></th></tr></thead>
      <tbody>${docs.map(d => `<tr><td>${d.incident_date || '—'}</td><td>${d.document_type}</td><td>${d.title}</td>
        <td>${d.created_at ? Utils.formatDateTime(d.created_at) : '—'}</td>
        <td class="actions">
          <button class="btn btn-sm btn-ghost hr-view" data-id="${d.id}">View</button>
          <button class="btn btn-sm btn-ghost hr-print" data-id="${d.id}">Print</button>
        </td></tr>`).join('') || '<tr><td colspan="5" class="muted">No HR documents for this employee</td></tr>'}
      </tbody></table></div>`;
    document.getElementById('hr-emp').addEventListener('change', () => {
      this._hrEmp = document.getElementById('hr-emp').value;
      this.renderStaffHrDocs(el);
    });
    document.getElementById('hr-new').addEventListener('click', () => {
      const empId = parseInt(document.getElementById('hr-emp').value, 10);
      Utils.showModal('New HR Document', `<div class="form-grid">
        <div class="field"><label>Document Type</label><select id="hr-type">
          ${['Warning', 'Disciplinary', 'Suspension', 'Termination', 'General'].map(t => `<option>${t}</option>`).join('')}
        </select></div>
        <div class="field"><label>Title</label><input id="hr-title" value="Written Warning"></div>
        <div class="field"><label>Incident Date</label><input type="date" id="hr-date" value="${Utils.today()}"></div>
        <div class="field full"><label>Content</label><textarea id="hr-content" rows="6">${templates.warning}</textarea></div>
      </div>`, '<button class="btn btn-ghost" id="hr-preview">Preview</button><button class="btn btn-primary" id="hr-save">Save Document</button>');
      document.getElementById('hr-type').addEventListener('change', (e) => {
        const key = e.target.value.toLowerCase();
        document.getElementById('hr-content').value = templates[key] || templates.general;
        document.getElementById('hr-title').value = e.target.value === 'General' ? 'HR Document' : `${e.target.value} Letter`;
      });
      document.getElementById('hr-preview').addEventListener('click', async () => {
        const r = await API.buildHrDocumentHtml({
          employee_id: empId,
          document_type: document.getElementById('hr-type').value,
          title: document.getElementById('hr-title').value.trim(),
          content: document.getElementById('hr-content').value.trim(),
          incident_date: document.getElementById('hr-date').value
        }, this.app.user);
        if (!r.success) return Utils.toast(r.error, 'error');
        const w = window.open('', '_blank');
        w.document.write(r.data);
        w.document.close();
      });
      document.getElementById('hr-save').addEventListener('click', async () => {
        const r = await API.saveHrDocument({
          employee_id: empId,
          document_type: document.getElementById('hr-type').value,
          title: document.getElementById('hr-title').value.trim(),
          content: document.getElementById('hr-content').value.trim(),
          incident_date: document.getElementById('hr-date').value
        }, this.app.user);
        if (!r.success) return Utils.toast(r.error, 'error');
        Utils.hideModal();
        Utils.toast('HR document saved', 'success');
        this.renderStaffHrDocs(el);
      });
    });
    const openDoc = async (id, print = false) => {
      const r = await API.getHrDocument(parseInt(id, 10), this.app.user);
      if (!r.success || !r.data) return Utils.toast(r.error || 'Document not found', 'error');
      const html = r.data.html_content || '';
      if (print) {
        await printStaffA4(html, r.data.title || 'HR Document');
      } else {
        const w = window.open('', '_blank');
        w.document.write(html);
        w.document.close();
      }
    };
    el.querySelectorAll('.hr-view').forEach(b => b.addEventListener('click', () => openDoc(b.dataset.id, false)));
    el.querySelectorAll('.hr-print').forEach(b => b.addEventListener('click', () => openDoc(b.dataset.id, true)));
  };

  AdminPage.renderStaffSelfies = async function (el) {
    const from = this._selfieFrom || new Date(Date.now() - 30 * 86400000).toLocaleDateString('en-CA');
    const to = this._selfieTo || Utils.today();
    const res = await API.getStaffSelfies({ from, to }, this.app.user);
    const rows = res.data || [];
    el.innerHTML = `<div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0;align-items:end">
      <div class="field"><label>From</label><input type="date" id="sf-from" value="${from}"></div>
      <div class="field"><label>To</label><input type="date" id="sf-to" value="${to}"></div>
      <button class="btn btn-primary" id="sf-filter">Filter</button></div>
      <div class="table-wrap"><table><thead><tr><th>Photo</th><th>Employee</th><th>Date</th><th>Time</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows.map(s => `<tr>
        <td><img src="${s.photo_data}" alt="" style="width:56px;height:56px;object-fit:cover;border-radius:8px;cursor:pointer" class="sf-thumb" data-id="${s.id}"></td>
        <td><strong>${s.employee_name}</strong><br><small>${s.employee_code || ''} · ${s.branch || '—'}</small></td>
        <td>${s.login_date}</td>
        <td>${Utils.formatDateTime(s.login_at)}</td>
        <td>${s.is_edited ? '<span class="tag" style="background:var(--warning)">Edited</span>' : '<span class="tag">Original</span>'}</td>
        <td><button class="btn btn-sm btn-ghost sf-view" data-id="${s.id}">View</button>
          <button class="btn btn-sm btn-ghost sf-edit" data-id="${s.id}">Replace</button>
          <button class="btn btn-sm btn-danger sf-del" data-id="${s.id}">Delete</button></td>
      </tr>`).join('') || '<tr><td colspan="6" class="muted">No login selfies in this period</td></tr>'}
      </tbody></table></div>`;
    document.getElementById('sf-filter').addEventListener('click', () => {
      this._selfieFrom = document.getElementById('sf-from').value;
      this._selfieTo = document.getElementById('sf-to').value;
      this.renderStaffSelfies(el);
    });
    const showSelfie = async (id, edit = false) => {
      const r = await API.getStaffSelfie(parseInt(id, 10), this.app.user);
      const s = r.data;
      if (!s) return Utils.toast('Not found', 'error');
      Utils.showModal(`${s.employee_name} — ${s.login_date}${s.is_edited ? ' (Edited)' : ''}`, `
        <img src="${s.photo_data}" alt="" style="width:100%;max-width:400px;border-radius:12px;display:block;margin:0 auto">
        ${s.is_edited ? `<p class="muted" style="margin-top:8px">Edited by ${s.edited_by_name || 'admin'} on ${Utils.formatDateTime(s.edited_at)}${s.edit_notes ? ` — ${s.edit_notes}` : ''}</p>
          <details style="margin-top:8px"><summary>View original photo</summary><img src="${s.original_photo_data}" alt="" style="width:100%;max-width:400px;margin-top:8px;border-radius:8px"></details>` : ''}
        ${edit ? `<div class="field" style="margin-top:12px"><label>Replacement photo</label><input type="file" id="sf-replace" accept="image/*"></div>
          <div class="field"><label>Edit notes</label><input id="sf-notes" placeholder="Reason for change"></div>` : ''}`,
        edit ? '<button type="button" class="btn btn-primary" id="sf-save-replace">Save Replacement</button>' : '<button type="button" class="btn btn-ghost" id="sf-close">Close</button>');
      if (edit) {
        document.getElementById('sf-save-replace').addEventListener('click', async () => {
          const file = document.getElementById('sf-replace').files?.[0];
          if (!file) return Utils.toast('Choose a replacement photo', 'error');
          const reader = new FileReader();
          reader.onload = async () => {
            const ur = await API.updateStaffSelfie(s.id, reader.result, document.getElementById('sf-notes').value.trim(), this.app.user);
            if (!ur.success) return Utils.toast(ur.error || 'Update failed', 'error');
            Utils.hideModal();
            Utils.toast('Photo updated', 'success');
            this.renderStaffSelfies(el);
          };
          reader.readAsDataURL(file);
        });
      } else {
        document.getElementById('sf-close')?.addEventListener('click', Utils.hideModal);
      }
    };
    el.querySelectorAll('.sf-view, .sf-thumb').forEach(b => b.addEventListener('click', () => showSelfie(b.dataset.id, false)));
    el.querySelectorAll('.sf-edit').forEach(b => b.addEventListener('click', () => showSelfie(b.dataset.id, true)));
    el.querySelectorAll('.sf-del').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Delete this login selfie record?')) return;
      const dr = await API.deleteStaffSelfie(parseInt(b.dataset.id, 10), this.app.user);
      if (!dr.success) return Utils.toast(dr.error || 'Delete failed', 'error');
      Utils.toast('Deleted', 'success');
      this.renderStaffSelfies(el);
    }));
  };

  AdminPage.renderStaffNotifications = async function (el) {
    const res = await API.getStaffNotifications();
    const notes = res.data || [];
    el.innerHTML = notes.length ? notes.map(n =>
      `<div class="card" style="margin-bottom:8px"><div class="card-body"><strong>${n.title}</strong><p class="muted">${n.message}</p></div></div>`).join('')
      : '<p class="muted">No alerts right now</p>';
  };
})();

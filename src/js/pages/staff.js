const StaffPage = {
  unlocked: false,
  employee: null,
  staffTab: null,
  pendingSelfie: false,

  isStaffAdmin(app) {
    const u = (app || this.app)?.user;
    if (!u) return false;
    if (['owner', 'manager', 'supervisor', 'assistant_manager'].includes(u.role)) return true;
    return !!Utils.canAccessAdmin?.(u);
  },

  _rerender() {
    if (!this.employee?.id && window.StaffPortalStandalone?.restoreSession) {
      const restored = StaffPortalStandalone.restoreSession();
      if (restored?.id) {
        this.employee = restored;
        if (window.StaffPortalStandalone) StaffPortalStandalone.employee = restored;
      }
    }
    if (this._embeddedInAdmin) return this.renderEmployeePortal(this.el);
    // Standalone login portal + admin "open employee portal" must stay on worker panel
    if (this._standalone || (this._adminOverride && this.employee)) {
      return this.renderWorkerPanel(this.el);
    }
    return this.render(this.el, this.app);
  },

  canAccessOwnerSalary(app) {
    const u = app?.user;
    if (!u) return false;
    if (u.role === 'owner' || u.role === 'manager') return true;
    return Utils.hasPermission(u, 'owner_salary');
  },

  canDoRoutines(app, employee) {
    if (!employee?.id) return false;
    const ps = app?.settings?.staff_portal_settings || {};
    if (ps.show_routines === false) return false;
    return ps.show_morning_routines !== false || ps.show_closing_routines !== false;
  },

  portalSettings(app) {
    return (app || this.app)?.settings?.staff_portal_settings || {};
  },

  portalToggleHtml(ps) {
    const on = (k, def = true) => (def ? ps[k] !== false : !!ps[k]);
    const row = (id, checked, title, hint) => `
      <label class="portal-switch"><span>
          <strong>${title}</strong>
          ${hint ? `<small class="muted">${hint}</small>` : ''}
        </span>
        <span class="portal-switch-track">
          <input type="checkbox" id="${id}" ${checked ? 'checked' : ''}>
          <span class="portal-switch-state">${checked ? 'ON' : 'OFF'}</span>
        </span>
      </label>`;
    return `<div class="portal-vis-card staffhr-portal-settings" id="portal-vis-card">
      <div class="staffhr-portal-settings-head">
        <h4>Staff portal sections</h4>
        <p class="muted">Turn each section ON or OFF. Staff only see what is enabled — changes apply immediately after save.</p>
      </div>
      <div class="portal-switch-grid">
      ${row('sp-set-routines', on('show_routines'), 'Routines (master)', 'Off hides morning & closing routines from staff')}
      ${row('sp-set-morning', on('show_morning_routines'), 'Morning opening routines', 'Opening checklist tasks on the portal')}
      ${row('sp-set-closing', on('show_closing_routines'), 'Closing routines', 'End-of-day tasks on the portal')}
      ${row('sp-set-shifts', on('show_shifts'), 'Shift schedule', 'My Shifts — weekly roster each employee sees')}
      ${row('sp-set-require-shift', on('require_scheduled_shift'), 'Require shift to clock in', 'Off = clock in/out without an assigned shift')}
      ${row('sp-set-show-leave', on('show_leave'), 'Leave', 'Leave balance, requests, and sick-leave proof on the portal')}
      ${row('sp-set-payslips', on('show_payslips'), 'Payslips', 'Recent payslips and PDF download on the portal')}
      ${row('sp-set-disciplinary', on('show_disciplinary'), 'Disciplinary', 'Warnings, hearings, and written responses')}
      ${row('sp-set-hr-docs', on('show_hr_docs'), 'HR documents', 'Warning / HR letters created in Staff & HR')}
      ${row('sp-set-company-rules', on('show_company_rules'), 'Company rules', 'Published rules from Operations & Compliance')}
      ${row('sp-set-my-files', on('show_my_files'), 'My files', 'ID, contract, and certificate files from Employees → Files')}
      </div>
    </div>`;
  },

  bindPortalToggleStates(root) {
    (root || document).querySelectorAll('.portal-switch input[type="checkbox"]').forEach((input) => {
      const bump = () => {
        const state = input.parentElement?.querySelector('.portal-switch-state');
        if (state) state.textContent = input.checked ? 'ON' : 'OFF';
      };
      input.addEventListener('change', bump);
      bump();
    });
  },

  collectPortalToggles(base) {
    const g = (id) => document.getElementById(id);
    const pick = (id, key) => {
      const el = g(id);
      return el ? { [key]: !!el.checked } : {};
    };
    return {
      ...(base || {}),
      ...pick('sp-set-routines', 'show_routines'),
      ...pick('sp-set-morning', 'show_morning_routines'),
      ...pick('sp-set-closing', 'show_closing_routines'),
      ...pick('sp-set-shifts', 'show_shifts'),
      _hide_shifts: g('sp-set-shifts') ? !g('sp-set-shifts').checked : !!(base || {})._hide_shifts,
      ...pick('sp-set-require-shift', 'require_scheduled_shift'),
      ...pick('sp-set-show-leave', 'show_leave'),
      ...pick('sp-set-payslips', 'show_payslips'),
      ...pick('sp-set-disciplinary', 'show_disciplinary'),
      ...pick('sp-set-hr-docs', 'show_hr_docs'),
      ...pick('sp-set-company-rules', 'show_company_rules'),
      ...pick('sp-set-my-files', 'show_my_files')
    };
  },

  canShowMorningRoutines(app) {
    const ps = this.portalSettings(app);
    return ps.show_routines !== false && ps.show_morning_routines !== false;
  },

  canShowClosingRoutines(app) {
    const ps = this.portalSettings(app);
    return ps.show_routines !== false && ps.show_closing_routines !== false;
  },

  canShowShifts(app, ps) {
    const settings = ps || this.portalSettings(app);
    return settings._hide_shifts !== true && settings.show_shifts !== false;
  },

  /** Actor for HR APIs — supports POS login user OR standalone portal employee */
  hrActor(emp) {
    if (this.app?.user?.id) return this.app.user;
    const e = emp || this.employee;
    if (!e?.id) return null;
    return {
      id: e.user_id || null,
      employee_id: e.id,
      full_name: e.full_name,
      username: e.employee_code || e.full_name,
      role: 'employee'
    };
  },

  mgrHrEmpActor(emp) {
    const e = emp || this.employee;
    const base = this.hrActor(e) || {};
    return {
      ...base,
      employee_id: e?.id,
      full_name: e?.full_name || base.full_name,
      role: base.role || 'employee'
    };
  },

  async _openStaffMgrHrCase(caseId, emp) {
    const actor = this.mgrHrEmpActor(emp);
    const r = await API.mgrHrGetEmployeeCase(caseId, actor);
    if (!r.success || !r.data) return Utils.toast(r.error || 'Case not found', 'error');
    const c = r.data;
    const responses = c.responses || [];
    const canRespond = !!c.can_respond && !this._adminOverride;
    const respHtml = responses.length
      ? responses.map((resp) => `<div style="padding:8px 0;border-bottom:1px solid var(--border)">
          <strong>Your response v${this._esc(resp.version)}</strong>
          ${resp.is_locked ? ' <span class="tag">Locked</span>' : ''}
          ${resp.submitted_at ? `<br><small class="muted">${Utils.formatDateTime?.(resp.submitted_at) || resp.submitted_at}</small>` : ''}
          ${resp.agree_disagree ? `<br><small>Position: ${this._esc(resp.agree_disagree)}</small>` : ''}
          <p style="margin:6px 0 0;white-space:pre-wrap">${this._esc(resp.response_text || '')}</p>
          ${resp.explanation ? `<p class="muted" style="white-space:pre-wrap">${this._esc(resp.explanation)}</p>` : ''}
        </div>`).join('')
      : '<p class="muted">No response submitted yet.</p>';

    Utils.showModal(c.case_number || 'HR Case', `
      <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:12px;margin-bottom:12px;color:#1e3a8a;font-size:13px">
        <strong>Your response is required.</strong> Please explain your side clearly. Once submitted, this version is locked — amendments create a new version.
      </div>
      <p><strong>${this._esc(c.incident_type || 'Incident')}</strong>
        · <span class="tag">${this._esc(c.status || '')}</span>
        ${c.severity ? ` · ${this._esc(c.severity)}` : ''}
      </p>
      <p class="muted" style="font-size:13px">${this._esc(c.incident_date || '')}${c.incident_time ? ' · ' + this._esc(c.incident_time) : ''}
        ${c.branch_name ? ' · ' + this._esc(c.branch_name) : ''}</p>
      ${c.description ? `<p style="white-space:pre-wrap">${this._esc(c.description)}</p>` : ''}
      ${c.what_happened ? `<p><strong>What happened</strong></p><p style="white-space:pre-wrap">${this._esc(c.what_happened)}</p>` : ''}
      ${c.final_decision ? `<p><strong>Decision:</strong> ${this._esc(c.final_decision)}</p>
        ${c.final_decision_notes ? `<p class="muted" style="white-space:pre-wrap">${this._esc(c.final_decision_notes)}</p>` : ''}` : ''}
      <h4 style="margin-top:16px">Your responses</h4>
      ${respHtml}
      ${this._adminOverride ? '<p class="muted" style="margin-top:12px">Admin view — the employee must submit their response from their own Staff Portal login.</p>' : ''}
      ${canRespond ? `
        <div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--border)">
          <p><strong>Submit response</strong></p>
          <div class="field"><label>Do you agree with the report?</label>
            <select id="mgrhr-agree"><option value="">Select…</option>
              <option value="agree">Agree</option><option value="disagree">Disagree</option>
              <option value="partially">Partially agree</option></select></div>
          <div class="field"><label>Your explanation</label>
            <textarea id="mgrhr-response" rows="3" placeholder="Write your explanation…" style="width:100%"></textarea></div>
          <div class="field"><label>Further details</label>
            <textarea id="mgrhr-explain" rows="2" placeholder="Additional context…" style="width:100%"></textarea></div>
          <div class="field"><label>Supporting information</label>
            <textarea id="mgrhr-support" rows="2" placeholder="Witnesses, receipts, etc." style="width:100%"></textarea></div>
        </div>` : ''}
    `, canRespond
      ? '<button class="btn btn-primary" id="mgrhr-submit-resp">Submit response</button>'
      : '<button class="btn btn-primary" id="mgrhr-close-case">Close</button>');

    document.getElementById('mgrhr-close-case')?.addEventListener('click', () => Utils.hideModal());
    document.getElementById('mgrhr-submit-resp')?.addEventListener('click', async () => {
      const response_text = document.getElementById('mgrhr-response')?.value.trim() || '';
      if (!response_text) return Utils.toast('Enter your response', 'error');
      const payload = {
        response_text,
        agree_disagree: document.getElementById('mgrhr-agree')?.value || '',
        explanation: document.getElementById('mgrhr-explain')?.value.trim() || '',
        supporting_info: document.getElementById('mgrhr-support')?.value.trim() || ''
      };
      const submitActor = this.mgrHrEmpActor(emp);
      // Admin override must not forge employee responses
      if (this._adminOverride) return Utils.toast('Use the employee Staff Portal login to submit a response', 'error');
      const sr = await API.mgrHrSubmitEmployeeResponse(caseId, payload, submitActor);
      if (!sr.success) return Utils.toast(sr.error || 'Could not submit', 'error');
      this._markAlertAttended('#staff-mgr-hr-cases::You have been asked to respond to an HR/disciplinary matter');
      this._markAlertAttended('mgrhr-respond');
      Utils.hideModal();
      Utils.toast('Response submitted', 'success');
      this._rerender();
    });
  },

  canAccessRecruitment(app) {
    const role = app.user?.role;
    return !!role && !['cashier'].includes(role)
      && ['owner', 'manager', 'supervisor', 'assistant_manager'].includes(role);
  },

  async render(el, app) {
    this.app = app;
    this.el = el;
    this._embeddedInAdmin = false;
    if (this._standalone && this.employee) {
      return this.renderWorkerPanel(el);
    }
    const canOwnerSalary = this.canAccessOwnerSalary(app);
    const canRecruit = this.canAccessRecruitment(app);
    const showEmployees = app.user?.role !== 'cashier' || !Utils.hasPermission(app.user, 'owner_salary_only');
    const needsTabs = canOwnerSalary || canRecruit;

    if (needsTabs) {
      const tabs = [];
      if (showEmployees || app.user?.role !== 'cashier') tabs.push(['employees', 'Employee Portal']);
      if (canRecruit) tabs.push(['recruitment', 'Recruitment']);
      if (canOwnerSalary) tabs.push(['owner-salary', 'Owner Salary']);
      if (!this.staffTab || !tabs.find(t => t[0] === this.staffTab)) {
        this.staffTab = app.user?.role === 'cashier' && canOwnerSalary ? 'owner-salary' : (tabs[0]?.[0] || 'employees');
      }
      el.innerHTML = `<div class="form-tabs" id="staff-main-tabs" style="margin-bottom:16px">${tabs.map(([id, label]) =>
        `<button type="button" class="form-tab ${this.staffTab === id ? 'active' : ''}" data-tab="${id}">${label}</button>`).join('')}</div>
        <div id="staff-main-content"><p class="muted" style="padding:16px">Opening…</p></div>`;
      el.querySelector('#staff-main-tabs').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-tab]');
        if (!btn) return;
        this.staffTab = btn.dataset.tab;
        if (!this.isStaffAdmin(app)) {
          this.unlocked = false;
          this.employee = null;
          this._adminOverride = false;
        }
        this.render(el, app);
      });
      const inner = document.getElementById('staff-main-content');
      if (!inner) return;

      if (this.staffTab === 'owner-salary') {
        if (!window.StaffOwnerSalaryPage?.render) {
          try {
            if (typeof Utils?.loadScript === 'function') await Utils.loadScript('js/pages/staff-owner-salary.js');
          } catch (_) { /* */ }
        }
        if (!window.StaffOwnerSalaryPage?.render) {
          inner.innerHTML = `<div class="card" style="padding:16px"><p class="error-msg">Owner Salary module failed to load.</p>
            <button type="button" class="btn btn-primary" id="sp-retry-os">Retry</button></div>`;
          document.getElementById('sp-retry-os')?.addEventListener('click', () => this.render(el, app));
          return;
        }
        return StaffOwnerSalaryPage.render(inner, app);
      }

      if (this.staffTab === 'recruitment') {
        if (!window.AdminRecruitmentPage?.render) {
          try {
            if (typeof Utils?.loadScript === 'function') await Utils.loadScript('js/pages/admin-recruitment.js');
          } catch (_) { /* */ }
        }
        if (!window.AdminRecruitmentPage?.render) {
          inner.innerHTML = `<div class="card" style="padding:16px"><p class="error-msg">Recruitment module failed to load.</p>
            <button type="button" class="btn btn-primary" id="sp-retry-rec">Retry</button></div>`;
          document.getElementById('sp-retry-rec')?.addEventListener('click', () => this.render(el, app));
          return;
        }
        return AdminRecruitmentPage.render(inner, { app: this.app });
      }

      return this.renderEmployeePortal(inner);
    }
    return this.renderEmployeePortal(el);
  },

  async renderEmployeePortal(el) {
    if (this.isStaffAdmin(this.app)) this.unlocked = true;
    else if (['owner', 'manager'].includes(this.app.user?.role)) this.unlocked = true;
    if (!this.unlocked) return this.renderSupervisorGate(el);

    if (this.isStaffAdmin(this.app) && !this.employee && !this._forceWorkerLogin) {
      return this.renderAdminHub(el);
    }

    if (!this.employee && this.app.user?.id) {
      const linkRes = await API.getEmployeeByUserId(this.app.user.id);
      if (linkRes.success && linkRes.data) {
        this.employee = linkRes.data;
      } else if (this.app.user?.role === 'cashier') {
        return this.renderNoEmployeeLink(el);
      }
    }
    if (!this.employee) return this.renderWorkerLogin(el);
    let needSelfie = this.pendingSelfie && !this._adminOverride && !!window.StaffSelfieCapture?.selfieRequired?.();
    if (needSelfie && this.employee?.id) {
      try {
        const attRes = await API.getStaffTodayAttendance(this.employee.id);
        if (attRes?.data?.clock_in) needSelfie = false;
      } catch (_) { /* keep selfie */ }
    }
    if (this.pendingSelfie && !needSelfie) this.pendingSelfie = false;
    if (needSelfie) return StaffSelfieCapture.render(el, this.employee, (emp) => {
      this.employee = emp;
      this.employeePin = null;
      this.pendingSelfie = false;
      this._rerender();
    }, { pin: this.employeePin });
    return this.renderWorkerPanel(el);
  },

  async renderAdminHub(el) {
    const ps = this.app.settings?.staff_portal_settings || {};
    const search = this._hubSearch || '';
    const paintSettings = () => `<div class="admin-section"><div class="page-toolbar" style="margin-bottom:12px"><h3 style="margin:0">Staff Portal</h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn btn-primary" id="sp-hub-hr">Manage Staff &amp; HR</button>
          <button type="button" class="btn btn-ghost" id="sp-hub-worker-login">Sign in as employee</button>
        </div>
      </div>
      <p class="muted">Open any worker's portal without their PIN. Change what staff see below.</p>
      ${this.portalToggleHtml(ps)}
      <div class="card" style="margin:16px 0"><div class="card-body"><h4>More portal settings</h4>
        <div class="form-grid"><div class="field full"><label><input type="checkbox" id="sp-set-selfie" ${ps.require_login_selfie ? 'checked' : ''}> Require verification selfie before workers enter</label></div>
          <div class="field full"><label><input type="checkbox" id="sp-set-leave" ${ps.leave_requests_open !== false ? 'checked' : ''}> Leave requests open (sick leave always allowed)</label></div>
          <div class="field full"><label><input type="checkbox" id="sp-set-dresp" ${ps.require_disciplinary_response !== false ? 'checked' : ''}> Require worker response on disciplinary records</label></div>
          <div class="field full"><label><input type="checkbox" id="sp-set-approval" ${ps.leave_requires_approval !== false ? 'checked' : ''}> Leave requests require admin approval</label></div>
        </div>
        <button type="button" class="btn btn-primary" id="sp-save-settings" style="margin-top:12px">Save portal settings</button>
      </div></div>
      <div class="card"><div class="card-body"><h4>Open an employee portal</h4>
        <div id="sp-hub-emp-wrap"><p class="muted">Loading employees...</p></div>
      </div></div>
    </div>`;

    el.innerHTML = paintSettings();
    this.bindPortalToggleStates(el);

    document.getElementById('sp-hub-hr')?.addEventListener('click', () => {
      try { API.staffLogout?.(); } catch (_) { /* ignore */ }
      this.employee = null;
      this._adminOverride = false;
      if (this._embeddedInAdmin && window.AdminPage) {
        AdminPage.section = 'staffhr';
        AdminPage.staffTab = 'employees';
        document.querySelectorAll('.admin-nav-btn').forEach(n => n.classList.toggle('active', n.dataset.section === 'staffhr'));
        AdminPage.renderSection(document.getElementById('admin-content'));
        return;
      }
      App.navigateToAdminSection?.('staffhr', 'employees');
    });
    document.getElementById('sp-hub-worker-login')?.addEventListener('click', () => {
      this._forceWorkerLogin = true;
      this.employee = null;
      this._adminOverride = false;
      this.renderWorkerLogin(el);
    });
    document.getElementById('sp-save-settings')?.addEventListener('click', async () => {
      const data = {
        ...(this.app.settings?.staff_portal_settings || {}),
        require_login_selfie: !!document.getElementById('sp-set-selfie')?.checked,
        leave_requests_open: !!document.getElementById('sp-set-leave')?.checked,
        require_disciplinary_response: !!document.getElementById('sp-set-dresp')?.checked,
        leave_requires_approval: !!document.getElementById('sp-set-approval')?.checked,
        ...this.collectPortalToggles()
      };
      const r = await API.saveJsonSetting('staff_portal_settings', data, this.app.user);
      if (!r.success) return Utils.toast(r.error || 'Could not save', 'error');
      this.app.settings = { ...this.app.settings, staff_portal_settings: data };
      if (window.AdminPage?.settings) AdminPage.settings.staff_portal_settings = data;
      try { window.DataCache?.invalidate?.('settings'); } catch (_) { /* ignore */ }
      this.bindPortalToggleStates(el);
      Utils.toast('Portal settings saved — staff see these immediately', 'success');
    });

    const empWrap = document.getElementById('sp-hub-emp-wrap');
    const res = await this._staffLoadSafe(API.getEmployees({ search }, this.app.user), 'hub_employees', 6000);
    if (!empWrap) return;
    if (res.success === false) {
      empWrap.innerHTML = `<p class="error-msg">Could not load employees.</p>
        <button type="button" class="btn btn-primary" id="sp-hub-retry">Retry</button>`;
      document.getElementById('sp-hub-retry')?.addEventListener('click', () => this.renderAdminHub(el));
      return;
    }
    const emps = res.data || [];
    empWrap.innerHTML = `<div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0"><input type="search" id="sp-hub-search" placeholder="Search employees..." value="${Utils.escHtml(search)}" style="flex:1;min-width:200px;padding:8px;border-radius:8px;border:1px solid var(--border)">
      </div>
      <div class="table-wrap"><table><thead><tr><th>ID</th><th>Name</th><th>Position</th><th>Status</th><th></th></tr></thead>
        <tbody>${emps.map(e => `<tr>
          <td>${Utils.escHtml(e.employee_code || '')}</td>
          <td><strong>${Utils.escHtml(e.full_name || '')}</strong></td>
          <td>${Utils.escHtml(e.position || '—')}</td>
          <td>${Utils.escHtml(e.status || '—')}</td>
          <td class="actions">
            <button type="button" class="btn btn-sm btn-primary sp-open-emp" data-id="${e.id}">Open portal</button>
            <button type="button" class="btn btn-sm btn-ghost sp-edit-emp" data-id="${e.id}">Edit in HR</button>
          </td>
        </tr>`).join('') || '<tr><td colspan="5" class="muted">No employees yet — add them in Staff &amp; HR</td></tr>'}
      </tbody></table></div>`;
    let searchTimer;
    document.getElementById('sp-hub-search')?.addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        this._hubSearch = e.target.value;
        this.renderAdminHub(el);
      }, 200);
    });
    el.querySelectorAll('.sp-open-emp').forEach(b => b.addEventListener('click', () => {
      this.openEmployeeAsAdmin(parseInt(b.dataset.id, 10), el);
    }));
    el.querySelectorAll('.sp-edit-emp').forEach(b => b.addEventListener('click', async () => {
      const empId = parseInt(b.dataset.id, 10);
      try { await API.staffLogout?.(); } catch (_) { /* ignore */ }
      this.employee = null;
      this._adminOverride = false;
      if (this._embeddedInAdmin && window.AdminPage) {
        AdminPage.section = 'staffhr';
        AdminPage.staffTab = 'employees';
        document.querySelectorAll('.admin-nav-btn').forEach(n => n.classList.toggle('active', n.dataset.section === 'staffhr'));
        await AdminPage.renderSection(document.getElementById('admin-content'));
        const r = await API.getEmployee(empId, this.app.user);
        if (r.success) AdminPage.showEmployeeForm?.(r.data);
        return;
      }
      App.navigateToAdminSection?.('staffhr', 'employees');
      setTimeout(async () => {
        const r = await API.getEmployee(empId, this.app.user);
        if (r.success) AdminPage.showEmployeeForm?.(r.data);
      }, 400);
    }));
  },
  async openEmployeeAsAdmin(employeeId, el) {
    const r = await API.adminOpenStaffPortal(employeeId, this.app.user);
    if (!r.success) return Utils.toast(r.error || 'Could not open portal', 'error');
    this.employee = r.data;
    this._adminOverride = true;
    this._forceWorkerLogin = false;
    this.pendingSelfie = false;
    this.unlocked = true;
    return this.renderWorkerPanel(el || this.el);
  },

  renderNoEmployeeLink(el) {
    el.innerHTML = `<div class="staff-gate card" style="max-width:480px;margin:40px auto;padding:32px;text-align:center"><h2>Staff Portal</h2>
      <p class="muted">Your user account is not linked to an employee profile.</p>
      <p><strong>Ask admin to link your user account to your employee profile</strong> (Admin -> Staff -> edit employee -> User Account).</p>
      <button class="btn btn-ghost" id="staff-retry-link" style="margin-top:16px">Check Again</button>
    </div>`;
    document.getElementById('staff-retry-link').addEventListener('click', () => this._rerender());
  },

  renderSupervisorGate(el) {
    el.innerHTML = `<div class="staff-gate card" style="max-width:420px;margin:40px auto;padding:32px;text-align:center"><h2>Staff Portal</h2>
      <p class="muted">Manager or supervisor PIN required to open staff clocking.</p>
      <div class="field"><label>Supervisor / Manager PIN</label>
        <input type="password" id="staff-super-pin" maxlength="12" inputmode="numeric" placeholder="Daily code or manager PIN" autofocus></div>
      <button class="btn btn-primary btn-lg" id="staff-unlock-btn" style="width:100%;margin-top:12px">Unlock Staff Portal</button>
    </div>`;
    document.getElementById('staff-unlock-btn').addEventListener('click', () => this.tryUnlock());
    document.getElementById('staff-super-pin').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.tryUnlock();
    });
  },

  async tryUnlock() {
    const pin = document.getElementById('staff-super-pin').value.trim();
    if (!pin) return Utils.toast('Enter supervisor PIN', 'error');
    if (['owner', 'manager'].includes(this.app.user?.role)) {
      const r = await API.verifyManagerPin(pin);
      if (r.success) { this.unlocked = true; return this._rerender(); }
    }
    const codeRes = await API.verifySupervisorCode(pin, 'staff');
    if (codeRes.success) {
      this.unlocked = true;
      Utils.toast('Staff portal unlocked', 'success');
      return this._rerender();
    }
    Utils.toast(codeRes.error || 'Invalid supervisor PIN " ask manager for today\'s code', 'error');
  },

  renderWorkerLogin(el) {
    el.innerHTML = `<div class="staff-gate card" style="max-width:420px;margin:40px auto;padding:32px"><h2 style="text-align:center">Employee Sign In</h2>
      <p class="muted" style="text-align:center">Enter your Employee ID and secret PIN, or ask admin to link your POS user to your employee profile.</p>
      <p id="staff-emp-login-err" class="error-msg hidden" style="margin-bottom:12px"></p>
      <div class="field"><label>Employee ID</label><input id="staff-emp-code" placeholder="EMP0001" autofocus></div>
      <div class="field"><label>PIN</label><input type="password" id="staff-emp-pin" maxlength="12" inputmode="numeric"></div>
      <button class="btn btn-primary btn-lg" id="staff-emp-login" style="width:100%">Sign In</button>
      ${this.isStaffAdmin(this.app) ? `<button class="btn btn-ghost btn-sm" id="staff-back-hub-login" style="width:100%;margin-top:8px"><- Back to employee list</button>` : ''}
      ${!['owner', 'manager'].includes(this.app.user?.role) ? '' : `<button class="btn btn-ghost btn-sm" id="staff-relock" style="width:100%;margin-top:8px">Lock Portal</button>`}
    </div>`;
    document.getElementById('staff-emp-login').addEventListener('click', () => this.workerLogin());
    document.getElementById('staff-emp-pin').addEventListener('keydown', (e) => { if (e.key === 'Enter') this.workerLogin(); });
    document.getElementById('staff-back-hub-login')?.addEventListener('click', () => {
      this._forceWorkerLogin = false;
      this.employee = null;
      this._adminOverride = false;
      if (this._embeddedInAdmin) return this.renderAdminHub(el);
      this._rerender();
    });
    document.getElementById('staff-relock')?.addEventListener('click', () => {
      this.unlocked = false; this.employee = null; this._forceWorkerLogin = false; this._rerender();
    });
  },

  async workerLogin() {
    const code = document.getElementById('staff-emp-code').value.trim();
    const pin = document.getElementById('staff-emp-pin').value.trim();
    const errEl = document.getElementById('staff-emp-login-err');
    if (!code || !pin) {
      if (errEl) { errEl.textContent = 'Employee ID and PIN required'; errEl.classList.remove('hidden'); }
      return;
    }
    if (errEl) errEl.classList.add('hidden');
    const r = await API.staffLogin(code, pin);
    if (!r.success) {
      const msg = r.error || 'Wrong PIN or employee ID';
      if (errEl) { errEl.textContent = msg; errEl.classList.remove('hidden'); }
      return;
    }
    this.employee = r.data;
    this.employeePin = pin;
    this.pendingSelfie = !!window.StaffSelfieCapture?.selfieRequired?.();
    if (this.pendingSelfie) {
      try {
        const attRes = await API.getStaffTodayAttendance(this.employee.id);
        if (attRes?.data?.clock_in) this.pendingSelfie = false;
      } catch (_) { /* ask for selfie if attendance is unknown */ }
    }
    Utils.toast(`Welcome, ${this.employee.full_name}`, 'success');
    this._rerender();
  },

  _staffLogError(section, err) {
    const msg = (err && (err.message || err.error || err)) || 'unknown';
    console.error('[StaffPortal]', section, String(msg).slice(0, 300));
  },

  _staffLoadSafe(promise, section, ms = 8000) {
    let timer;
    return Promise.race([
      Promise.resolve(promise).then((r) => {
        clearTimeout(timer);
        if (r && r.success === false) {
          this._staffLogError(section, r.error || 'failed');
          return { success: false, data: null, error: r.error || 'load failed', _section: section };
        }
        return { success: true, data: r?.data !== undefined ? r.data : r, error: null, _section: section };
      }).catch((err) => {
        clearTimeout(timer);
        this._staffLogError(section, err);
        return { success: false, data: null, error: 'load failed', _section: section };
      }),
      new Promise((resolve) => {
        timer = setTimeout(() => {
          this._staffLogError(section, 'timeout');
          resolve({ success: false, data: null, error: 'timeout', _section: section });
        }, ms);
      })
    ]);
  },

  _portalAlive(seq, el) {
    if (seq !== this._portalSeq || !el) return false;
    if (typeof el.isConnected === 'boolean') return el.isConnected;
    return !!(document.body?.contains(el) || document.contains(el));
  },

  _esc(v) {
    return Utils.escHtml(v == null ? '' : String(v));
  },

  _staffSectionFail(res, label) {
    if (res && res.success !== false) return '';
    return `<div class="staff-section-error" style="padding:10px;margin:8px 0;border:1px dashed var(--border);border-radius:8px;background:var(--bg-secondary,rgba(0,0,0,.03))"><p class="error-msg" style="margin:0 0 8px">${this._esc(label)} could not be loaded. Retry.</p>
      <button type="button" class="btn btn-sm btn-primary staff-section-retry">Retry</button>
    </div>`;
  },

  _staffAlertAttendedKey() {
    const id = this.employee?.id || 'anon';
    return `shoppos_staff_alerts_attended_${id}`;
  },
  _getAttendedAlerts() {
    try {
      return new Set(JSON.parse(sessionStorage.getItem(this._staffAlertAttendedKey()) || '[]'));
    } catch (_) {
      return new Set();
    }
  },
  _markAlertAttended(key) {
    const set = this._getAttendedAlerts();
    set.add(key);
    try { sessionStorage.setItem(this._staffAlertAttendedKey(), JSON.stringify([...set])); } catch (_) { /* ignore */ }
  },
  _alertKey(item) {
    return `${item.target || ''}::${item.label || ''}`;
  },

  _staffAlertItems(data = {}) {
    const items = [];
    if ((data.hrDocs || []).length) items.push({ target: '#staff-hr-docs', label: 'HR documents waiting', id: 'hrdocs' });
    if ((data.hrSubmissions || []).some(s => !s.submitted_at)) items.push({ target: '#staff-hr-docs', label: 'HR form to complete', id: 'hrform' });
    if ((data.leaves || []).some(l => l.status === 'approved' && !l.worker_seen)) {
      items.push({ target: '#staff-leave', label: 'Leave approved', id: 'leave-approved' });
    }
    if ((data.leaves || []).some(l => l.status === 'pending' || l.status === 'submitted')) {
      items.push({ target: '#staff-leave', label: 'Leave request pending', id: 'leave-pending' });
    }
    if ((data.payroll || []).length) items.push({ target: '#staff-payslips', label: 'Payslip available', id: 'payslip' });
    if ((data.disciplinary || []).some(d => !d.worker_response && d.requires_response !== 0)) {
      items.push({ target: '#staff-disciplinary', label: 'Warning / disciplinary — response required', id: 'disc-respond' });
    }
    const mgrCases = data.mgrHrCases || [];
    if (mgrCases.some((c) => ['EMPLOYEE_RESPONSE_REQUESTED', 'REPORTED', 'UNDER_REVIEW'].includes(c.status)
      && !(c.has_response || c.employee_responded))) {
      items.push({ target: '#staff-mgr-hr-cases', label: 'You have been asked to respond to an HR/disciplinary matter', id: 'mgrhr-respond' });
    }
    if ((data.training || []).length) items.push({ target: '#staff-training', label: 'Training assigned', id: 'training' });
    if ((data.probation || []).length) items.push({ target: '#staff-probation', label: 'Probation on file', id: 'probation' });
    if ((data.contracts || []).some(c => ['pending_signatures', 'open'].includes(c.status) && !c.employee_signed_at)) {
      items.push({ target: '#staff-contracts', label: 'Employment contract to sign', id: 'contract-sign' });
    }
    if ((data.claims || []).some(cl => ['open', 'rejected'].includes(cl.status)
      && (!cl.claim_opens_at || new Date() >= new Date(cl.claim_opens_at))
      && (!cl.claim_deadline || new Date() <= new Date(cl.claim_deadline)))) {
      items.push({ target: '#staff-claims', label: 'Salary claim is open', id: 'claim' });
    }
    if ((data.checklistWarnings || []).length) {
      items.push({ target: '#staff-checklist-warnings', label: 'Checklist warning', id: 'checklist' });
    }
    const attended = this._getAttendedAlerts();
    return items.filter((a) => !attended.has(this._alertKey(a)) && !attended.has(a.id || ''));
  },

  _staffAlertsHtml(items) {
    if (!items?.length) return '';
    return `<div class="card staff-portal-alerts-card" style="margin-bottom:12px;border-color:var(--warning);background:rgba(245,158,11,.08)"><div class="card-body">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
        <strong>Notifications</strong>
        <button type="button" class="btn btn-sm btn-ghost" id="staff-alerts-clear-all">Mark all attended</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;margin-top:8px">
        ${items.map(a => `<div style="display:flex;gap:6px;align-items:stretch">
          <button type="button" class="btn btn-sm btn-ghost staff-alert-go" data-target="${this._esc(a.target)}" data-key="${this._esc(this._alertKey(a))}" style="flex:1;justify-content:flex-start;text-align:left">${this._esc(a.label)} →</button>
          <button type="button" class="btn btn-sm btn-primary staff-alert-attend" data-key="${this._esc(this._alertKey(a))}" title="Mark attended">Attended</button>
        </div>`).join('')}
      </div>
    </div></div>`;
  },

  _bindStaffAlerts(root) {
    const scope = root || document;
    scope.querySelectorAll('.staff-alert-go').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = document.querySelector(btn.dataset.target);
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          target.style.outline = '2px solid var(--primary)';
          setTimeout(() => { target.style.outline = ''; }, 1600);
        }
      });
    });
    const refreshAlerts = () => {
      const box = document.getElementById('staff-portal-alerts');
      if (!box) return;
      // Re-collect from last known data if available
      const items = this._lastStaffAlertData
        ? this._staffAlertItems(this._lastStaffAlertData)
        : [];
      box.innerHTML = this._staffAlertsHtml(items);
      this._bindStaffAlerts(box);
    };
    scope.querySelectorAll('.staff-alert-attend').forEach((btn) => {
      btn.addEventListener('click', () => {
        this._markAlertAttended(btn.dataset.key);
        refreshAlerts();
        Utils.toast('Notification cleared', 'success');
      });
    });
    document.getElementById('staff-alerts-clear-all')?.addEventListener('click', () => {
      scope.querySelectorAll('.staff-alert-attend, .staff-alert-go').forEach((b) => {
        if (b.dataset.key) this._markAlertAttended(b.dataset.key);
      });
      refreshAlerts();
      Utils.toast('All notifications marked attended', 'success');
    });
  },

  async _staffSignOut() {
    try { await API.staffLogout?.(); } catch (_) { /* ignore */ }
    try { window.StaffPortalStandalone?.clearSession?.(); } catch (_) { /* ignore */ }
    this.employee = null;
    this.employeePin = null;
    this._adminOverride = false;
    this._forceWorkerLogin = false;
    if (this._standalone && typeof this.onStandaloneLogout === 'function') {
      return this.onStandaloneLogout();
    }
    this._rerender();
  },

  _newClientRequestId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'staff-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
  },

  _staffAvatarHtml(emp, size = 40) {
    const px = Number(size) || 40;
    const path = (emp?.photo_path || '').trim();
    if (!path) {
      return `<div class="staff-portal-avatar" style="width:${px}px;height:${px}px;border-radius:50%;background:var(--border);display:inline-flex;align-items:center;justify-content:center;font-size:${Math.round(px * 0.45)}px;flex-shrink:0;font-weight:700;color:var(--muted)">${String(emp?.full_name || '?').trim().charAt(0).toUpperCase() || '?'}</div>`;
    }
    return `<div class="staff-portal-avatar" data-photo="${this._esc(path)}" style="width:${px}px;height:${px}px;border-radius:50%;background:var(--border);overflow:hidden;flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;font-size:12px;color:var(--text-muted)"></div>`;
  },

  async _hydrateStaffAvatars(root) {
    const scope = root || document;
    const cells = scope.querySelectorAll?.('.staff-portal-avatar[data-photo]') || [];
    for (const cell of cells) {
      const path = cell.getAttribute('data-photo');
      if (!path) continue;
      try {
        const r = await API.getImageDataUrl(path);
        if (r?.success && (r.dataUrl || r.data)) {
          cell.innerHTML = `<img src="${r.dataUrl || r.data}" alt="" style="width:100%;height:100%;object-fit:cover">`;
        } else {
          cell.textContent = '';
        }
      } catch (_) {
        cell.textContent = '';
      }
    }
  },

  _paintWorkerClockNow(el, emp, attRes, schedRes) {
    const att = attRes.success !== false ? (attRes.data || {}) : {};
    const myShifts = attRes && schedRes && schedRes.success !== false ? (schedRes.data || []) : [];
    const todayStr = Utils.today();
    const yestStr = Utils.daysAgo(1);
    const todayShift = myShifts.find(s => s.shift_date === todayStr && !s.is_rest_day)
      || myShifts.find(s => s.shift_date === yestStr && !s.is_rest_day
        && String(s.end_time || '').slice(0, 5) <= String(s.start_time || '').slice(0, 5));
    el.dataset.clockBound = '';
    el.innerHTML = `<div class="staff-worker staff-portal-pro"><div class="staff-portal-hero">${this._staffAvatarHtml(emp, 48)}
        <h3 style="margin:0;flex:1">${this._esc(emp.full_name)}</h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap">${this._adminOverride ? `<button class="btn btn-ghost" id="staff-back-hub"><- All employees</button>
            <button class="btn btn-ghost" id="staff-goto-hr">Edit in Staff &amp; HR</button>` : ''}
          <button class="btn btn-ghost" id="staff-logout-worker">${this._adminOverride ? 'Close portal' : 'Sign Out'}</button>
        </div></div>
      ${this._adminOverride ? `<div class="card" style="margin-bottom:12px;border-color:var(--primary)"><div class="card-body"><strong>Admin view</strong> — you are in ${this._esc(emp.full_name)}'s Staff Portal.
      </div></div>` : ''}
      <div class="stats-grid" id="staff-clock-stats"><div class="stat-card"><div class="label">Employee ID</div><div class="value" style="font-size:16px">${this._esc(emp.employee_code)}</div></div>
        <div class="stat-card"><div class="label">Position</div><div class="value" style="font-size:16px">${this._esc(emp.position || '"')}</div></div>
        <div class="stat-card"><div class="label">Today's Status</div><div class="value" style="font-size:16px">${att.clock_in ? (att.clock_out ? 'Completed' : 'On Shift') : (attRes.success === false ? '"' : 'Loading...')}</div></div>
        <div class="stat-card"><div class="label">Hours Today</div><div class="value">${att.hours_worked || 0}h</div></div>
      </div>
      <div class="card" style="margin-top:16px"><div class="card-body" id="staff-clock-card"><h4>Clock In / Out</h4>
        ${attRes.success === false ? this._staffSectionFail(attRes, "Today's attendance / clock") : `
        <p class="muted" style="margin:4px 0 0;font-size:13px">Clock-in is only allowed on your scheduled shift
          ${todayShift ? ` (${todayShift.shift_date === yestStr ? 'overnight from yesterday' : 'today'} ${this._esc(todayShift.start_time || '?')}"${this._esc(todayShift.end_time || '?')})` : ' " no shift assigned for today'}.
        </p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button class="btn btn-success" data-clock="clock_in" ${att.clock_in ? 'disabled' : ''}>Clock In</button>
          <button class="btn btn-warning" data-clock="break_start" ${!att.clock_in || att.clock_out ? 'disabled' : ''}>Start Break</button>
          <button class="btn btn-ghost" data-clock="break_end" ${!att.break_start || att.break_end ? 'disabled' : ''}>End Break</button>
          <button class="btn btn-danger" data-clock="clock_out" ${!att.clock_in || att.clock_out ? 'disabled' : ''}>Clock Out</button>
        </div>
        <p class="muted" style="margin-top:10px;font-size:13px">
          In: ${att.clock_in ? Utils.formatDateTime(att.clock_in) : '"'} ·
          Out: ${att.clock_out ? Utils.formatDateTime(att.clock_out) : '"'}
        </p>`}
      </div></div>
      <div id="staff-portal-banner"></div>
      <div id="staff-routines-panel" style="margin-top:16px"></div>
      <div id="staff-portal-secondary"><p class="muted" style="padding:16px 0">Loading attendance, leave, payroll &amp; HR...</p></div>
    </div>`;
    this._hydrateStaffAvatars(el);
  },

  /** Refresh stats + clock buttons after attendance loads " never wipes banner/secondary/routines */
  _updateClockCard(el, emp, attRes, schedRes) {
    const att = attRes.success !== false ? (attRes.data || {}) : {};
    const myShifts = schedRes && schedRes.success !== false ? (schedRes.data || []) : [];
    const todayStr = Utils.today();
    const yestStr = Utils.daysAgo(1);
    const todayShift = myShifts.find(s => s.shift_date === todayStr && !s.is_rest_day)
      || myShifts.find(s => s.shift_date === yestStr && !s.is_rest_day
        && String(s.end_time || '').slice(0, 5) <= String(s.start_time || '').slice(0, 5));
    const stats = el.querySelector('#staff-clock-stats');
    if (stats) {
      stats.innerHTML = `
        <div class="stat-card"><div class="label">Employee ID</div><div class="value" style="font-size:16px">${this._esc(emp.employee_code)}</div></div>
        <div class="stat-card"><div class="label">Position</div><div class="value" style="font-size:16px">${this._esc(emp.position || '"')}</div></div>
        <div class="stat-card"><div class="label">Today's Status</div><div class="value" style="font-size:16px">${att.clock_in ? (att.clock_out ? 'Completed' : 'On Shift') : (attRes.success === false ? '"' : 'Not Clocked In')}</div></div>
        <div class="stat-card"><div class="label">Hours Today</div><div class="value">${att.hours_worked || 0}h</div></div>`;
    }
    const card = el.querySelector('#staff-clock-card');
    if (card) {
      card.innerHTML = attRes.success === false ? this._staffSectionFail(attRes, "Today's attendance / clock") : `
        <h4>Clock In / Out</h4>
        <p class="muted" style="margin:4px 0 0;font-size:13px">Clock-in is only allowed on your scheduled shift
          ${todayShift ? ` (${todayShift.shift_date === yestStr ? 'overnight from yesterday' : 'today'} ${this._esc(todayShift.start_time || '?')}"${this._esc(todayShift.end_time || '?')})` : ' " no shift assigned for today'}.
          If you miss clock-out, the system auto-closes at shift end.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button class="btn btn-success" data-clock="clock_in" ${att.clock_in ? 'disabled' : ''}>Clock In</button>
          <button class="btn btn-warning" data-clock="break_start" ${!att.clock_in || att.clock_out ? 'disabled' : ''}>Start Break</button>
          <button class="btn btn-ghost" data-clock="break_end" ${!att.break_start || att.break_end ? 'disabled' : ''}>End Break</button>
          <button class="btn btn-danger" data-clock="clock_out" ${!att.clock_in || att.clock_out ? 'disabled' : ''}>Clock Out</button>
        </div>
        <p class="muted" style="margin-top:10px;font-size:13px">
          In: ${att.clock_in ? Utils.formatDateTime(att.clock_in) : '"'} ·
          Break: ${att.break_start ? Utils.formatDateTime(att.break_start) : '"'} -> ${att.break_end ? Utils.formatDateTime(att.break_end) : '"'} ·
          Out: ${att.clock_out ? Utils.formatDateTime(att.clock_out) : '"'}
          ${att.auto_closed ? ' · <span style="color:var(--warning)">Auto-closed</span>' : ''}
        </p>`;
      el.dataset.clockBound = '';
      this._bindWorkerClockOnly(el, emp);
    }
  },

  _clockActionLabel(action) {
    return {
      clock_in: 'Clock In',
      break_start: 'Start Break',
      break_end: 'End Break',
      clock_out: 'Clock Out'
    }[action] || action;
  },

  _staffTimeOnly(iso) {
    if (!iso) return '—';
    const s = Utils.formatDateTime(iso);
    const parts = String(s).split(' ');
    return parts.length > 1 ? parts.slice(1).join(' ') : s;
  },

  _ruleBodyHtml(r, opts = {}) {
    const sections = (r.sections || []).map((s) =>
      `<div style="margin-top:10px"><strong>${this._esc(s.heading || '')}</strong>
        <p style="margin:4px 0 0;white-space:pre-wrap;font-size:13px">${this._esc(s.body || '')}</p></div>`
    ).join('');
    const adminSig = opts.adminSignaturePath
      ? `<div style="margin-top:14px;padding-top:10px;border-top:1px solid var(--border)">
          <p class="muted" style="font-size:12px;margin:0 0 6px">Administrator signature</p>
          <img src="${this._esc(Utils.fileUrl(opts.adminSignaturePath))}" alt="Admin signature" style="max-height:64px;max-width:220px;object-fit:contain;background:#fff;border:1px solid var(--border);border-radius:6px;padding:4px">
        </div>`
      : `<p class="muted" style="font-size:12px;margin:10px 0 0">Administrator signature on file for this policy set.</p>`;
    return `<div class="staff-rule-doc" style="margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--border)">
      <h4 style="margin:0 0 4px">${this._esc(r.title || r.rule_number || 'Company rule')}</h4>
      <p class="muted" style="font-size:12px;margin:0 0 8px">${r.rule_number ? `${this._esc(r.rule_number)} · ` : ''}Set on ${this._esc(r.effective_date || r.admin_signed_at || '—')}${r.category ? ` · ${this._esc(r.category)}` : ''}${r.version ? ` · v${r.version}` : ''}</p>
      ${r.description ? `<p style="white-space:pre-wrap;font-size:14px">${this._esc(r.description)}</p>` : ''}
      ${sections}
      ${adminSig}
    </div>`;
  },

  _allRulesHtml(rules, adminSignaturePath) {
    if (!(rules || []).length) {
      return '<p class="muted">No company rules have been released to the Staff Portal yet. Ask your manager to publish rules in Operations &amp; Compliance.</p>';
    }
    return rules.map((r) => this._ruleBodyHtml(r, { adminSignaturePath })).join('');
  },

  async _getAdminSignaturePath() {
    try {
      const fromSettings = this.app?.settings?.admin_signature_path;
      if (fromSettings) return fromSettings;
      const res = await API.getAdminSignature?.();
      return res?.data?.admin_signature_path || res?.admin_signature_path || null;
    } catch (_) {
      return null;
    }
  },

  _bindSignaturePad(canvas) {
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    let drawing = false;
    const pos = (e) => {
      const rec = canvas.getBoundingClientRect();
      const t = e.touches ? e.touches[0] : e;
      return {
        x: (t.clientX - rec.left) * (canvas.width / rec.width),
        y: (t.clientY - rec.top) * (canvas.height / rec.height)
      };
    };
    const start = (e) => { drawing = true; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); e.preventDefault(); };
    const move = (e) => { if (!drawing) return; const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); e.preventDefault(); };
    const end = () => { drawing = false; };
    canvas.addEventListener('mousedown', start);
    canvas.addEventListener('mousemove', move);
    canvas.addEventListener('mouseup', end);
    canvas.addEventListener('mouseleave', end);
    canvas.addEventListener('touchstart', start, { passive: false });
    canvas.addEventListener('touchmove', move, { passive: false });
    canvas.addEventListener('touchend', end);
    return {
      clear: () => ctx.clearRect(0, 0, canvas.width, canvas.height),
      isBlank: () => {
        const blank = document.createElement('canvas');
        blank.width = canvas.width;
        blank.height = canvas.height;
        return canvas.toDataURL() === blank.toDataURL();
      },
      toDataURL: () => canvas.toDataURL('image/png')
    };
  },

  async _openViewRulesModal(companyRules) {
    const adminSig = await this._getAdminSignaturePath();
    Utils.showModal(
      'Company rules',
      `<p class="muted" style="margin-top:0">Read the full policy set below. Use <strong>Sign</strong> on the portal if you still need to acknowledge.</p>
       <div style="max-height:min(62vh,480px);overflow:auto;padding:4px 2px">${this._allRulesHtml(companyRules, adminSig)}</div>`,
      '<button type="button" class="btn btn-ghost" id="staff-rule-close">Close</button>',
      { wide: true }
    );
    document.getElementById('staff-rule-close')?.addEventListener('click', () => Utils.hideModal());
  },

  async _openSignRulesModal(emp, companyRules, signedRuleIds, onDone) {
    const unsigned = (companyRules || []).filter((r) => !signedRuleIds.has(Number(r.id)));
    if (!unsigned.length) {
      Utils.toast('You have already signed all released company rules', 'success');
      return;
    }
    const adminSig = await this._getAdminSignaturePath();
    const nameParts = String(emp.full_name || '').trim().split(/\s+/);
    const firstPrefill = this._esc(nameParts[0] || '');
    const lastPrefill = this._esc(nameParts.slice(1).join(' ') || '');
    Utils.showModal(
      'Sign company rules',
      `<p class="muted" style="margin-top:0">Read every rule below. When you have finished reading, write your <strong>name</strong> and <strong>surname</strong>, tick acknowledge, then sign manually.</p>
       <div style="max-height:min(42vh,320px);overflow:auto;padding:8px;border:1px solid var(--border);border-radius:8px;margin-bottom:12px;background:var(--bg-secondary)">
         ${this._allRulesHtml(unsigned, adminSig)}
       </div>
       <p class="muted" style="font-size:13px;margin:0 0 8px">Acknowledgement · today&apos;s date will be recorded for management.</p>
       <div class="form-grid">
         <div class="field"><label>Name</label><input id="rule-ack-first" value="${firstPrefill}" autocomplete="given-name"></div>
         <div class="field"><label>Surname</label><input id="rule-ack-last" value="${lastPrefill}" autocomplete="family-name"></div>
       </div>
       <label class="field full" style="margin:10px 0;display:flex;gap:8px;align-items:flex-start">
         <input type="checkbox" id="rule-ack-box" style="margin-top:3px">
         <span>I have read these company rules and acknowledge them.</span>
       </label>
       <canvas id="rule-sig-canvas" width="420" height="110" style="border:1px solid var(--border);border-radius:8px;touch-action:none;width:100%;max-width:420px;background:#fff"></canvas>
       <button type="button" class="btn btn-ghost btn-sm" id="rule-sig-clear" style="margin-top:8px">Clear signature</button>`,
      '<button type="button" class="btn btn-ghost" id="rule-sig-cancel">Cancel</button><button type="button" class="btn btn-primary" id="rule-sig-go">Sign &amp; acknowledge</button>',
      { wide: true }
    );
    document.getElementById('rule-sig-cancel')?.addEventListener('click', () => Utils.hideModal());
    const pad = this._bindSignaturePad(document.getElementById('rule-sig-canvas'));
    document.getElementById('rule-sig-clear')?.addEventListener('click', () => pad?.clear());
    document.getElementById('rule-sig-go')?.addEventListener('click', async () => {
      const first = document.getElementById('rule-ack-first')?.value.trim();
      const last = document.getElementById('rule-ack-last')?.value.trim();
      if (!first || !last) return Utils.toast('Enter your name and surname', 'error');
      if (!document.getElementById('rule-ack-box')?.checked) {
        return Utils.toast('Tick acknowledge after you have read the rules', 'error');
      }
      if (!pad || pad.isBlank()) return Utils.toast('Draw your signature first', 'error');
      const payload = JSON.stringify({
        signature: pad.toDataURL(),
        first_name: first,
        last_name: last,
        acknowledged: true,
        signed_name: `${first} ${last}`
      });
      const actor = this.hrActor(emp);
      let ok = 0;
      let lastErr = '';
      for (const rule of unsigned) {
        const r = await API.signCompanyRule(rule.id, emp.id, payload, actor);
        if (r?.success !== false && !r?.error) ok += 1;
        else lastErr = r?.error || 'Could not sign';
      }
      if (!ok) return Utils.toast(lastErr || 'Could not sign', 'error');
      Utils.hideModal();
      Utils.toast(ok === unsigned.length
        ? 'Rules signed and acknowledged'
        : `Signed ${ok} of ${unsigned.length} rules${lastErr ? ` — ${lastErr}` : ''}`, ok === unsigned.length ? 'success' : 'warning');
      if (typeof onDone === 'function') onDone();
      else this._rerender();
    });
  },

  _trainingStatusChip(t) {
    const raw = String(t.status || t.form?.status || '').toLowerCase();
    if (/complete|passed|done/.test(raw)) return { label: 'Completed', cls: 'day-worked' };
    if (/fail|unsuccess/.test(raw)) return { label: 'Failed', cls: 'day-off' };
    if (/progress|active|assigned|open|pending/.test(raw) || !raw) return { label: 'In progress', cls: 'day-open' };
    return { label: t.status || 'In progress', cls: 'day-open' };
  },

  _probationStatusChip(p) {
    const raw = String(p.status || '').toLowerCase();
    if (/success|passed|complete|confirmed/.test(raw)) return { label: 'Probation successful', cls: 'day-worked' };
    if (/fail|unsuccess|terminat/.test(raw)) return { label: 'Probation unsuccessful', cls: 'day-off' };
    return { label: 'In progress', cls: 'day-open' };
  },

  _openMyShiftsModal(emp, shifts, from, to) {
    const settings = this.app?.settings || {};
    const company = settings.app_display_name || settings.shop_name || 'Company';
    const branch = emp.branch || '—';
    const rows = (shifts || []).map((s) => {
      const overnight = !s.is_rest_day && String(s.end_time || '').slice(0, 5) <= String(s.start_time || '').slice(0, 5);
      const times = s.is_rest_day ? 'Rest day' : `${s.start_time || '?'} – ${s.end_time || '?'}${overnight ? ' (+1)' : ''}`;
      return `<tr><td>${this._esc(s.shift_date)}</td><td>${this._esc(s.shift_name || (s.is_rest_day ? 'Off' : 'Shift'))}</td><td>${this._esc(times)}</td><td>${this._esc(s.branch || branch)}</td></tr>`;
    }).join('') || '<tr><td colspan="4" class="muted">No shifts in this period</td></tr>';
    Utils.showModal(
      'My Shifts',
      `<p class="muted" style="margin-top:0"><strong>${this._esc(company)}</strong> · ${this._esc(branch)}<br>${from} → ${to}</p>
       <div class="table-wrap" style="max-height:360px;overflow:auto"><table><thead><tr><th>Date</th><th>Shift</th><th>Times</th><th>Branch</th></tr></thead><tbody>${rows}</tbody></table></div>`,
      `<button type="button" class="btn btn-ghost" id="sp-shifts-close">Close</button>
       <button type="button" class="btn btn-primary" id="sp-shifts-wa">Send to WhatsApp (PDF)</button>`
    );
    document.getElementById('sp-shifts-close')?.addEventListener('click', () => Utils.hideModal());
    document.getElementById('sp-shifts-wa')?.addEventListener('click', async () => {
      await this._shareShiftsWhatsAppPdf(emp, shifts, from, to, company, branch);
    });
  },

  async _shareShiftsWhatsAppPdf(emp, shifts, from, to, company, branch) {
    const phone = (emp.phone || '').replace(/\D/g, '');
    if (!phone) return Utils.toast('Add your phone number on your employee profile first', 'error');
    const lines = [
      `${company}`,
      `Branch: ${branch}`,
      `Employee: ${emp.full_name}`,
      `Shifts ${from} → ${to}`,
      ''
    ];
    for (const s of (shifts || [])) {
      if (s.is_rest_day) lines.push(`${s.shift_date}: Rest day`);
      else lines.push(`${s.shift_date}: ${s.shift_name || 'Shift'} ${s.start_time || ''}–${s.end_time || ''}${s.branch ? ` @ ${s.branch}` : ''}`);
    }
    const text = lines.join('\n');
    if (typeof Export?.toPDF === 'function') {
      const headers = ['Date', 'Shift', 'Times', 'Branch'];
      const pdfRows = (shifts || []).map((s) => [
        s.shift_date,
        s.is_rest_day ? 'Rest day' : (s.shift_name || 'Shift'),
        s.is_rest_day ? '—' : `${s.start_time || ''} – ${s.end_time || ''}`,
        s.branch || branch
      ]);
      try {
        const st = this.app?.settings || {};
        await Export.toPDF(`shifts-${emp.employee_code || emp.id}.pdf`, `My Shifts — ${emp.full_name}`, headers, pdfRows, {
          name: company, phone: st.phone || '', address: st.address || ''
        });
      } catch (_) { /* fall through to text */ }
    }
    Utils.openWhatsApp(phone, text);
    Utils.toast('WhatsApp opened — attach the PDF if you downloaded it', 'success');
  },

  _confirmClockAction(action) {
    const label = this._clockActionLabel(action);
    const copy = {
      clock_in: 'You are about to clock in. Your actual time is stored. Within grace time, payroll counts the scheduled start.',
      break_start: 'Start your break now? This is recorded on today’s attendance.',
      break_end: 'End your break now? Time after this counts as working hours.',
      clock_out: 'You are about to clock out. Your actual time is stored. After shift end, payroll counts the scheduled end (auto-close).'
    };
    return new Promise((resolve) => {
      Utils.showModal(
        label,
        `<p style="margin:0 0 8px">${copy[action] || `Confirm you want to <strong>${label.toLowerCase()}</strong> now.`}</p>
         <p class="muted" style="margin:0;font-size:13px">A selfie is required next. If you are already ${label.toLowerCase().replace('clock ', 'clocked ')}, the system will tell you.</p>`,
        `<button type="button" class="btn btn-ghost" id="sp-clk-cancel">Cancel</button>
         <button type="button" class="btn btn-primary" id="sp-clk-ok">Yes, ${label}</button>`
      );
      document.getElementById('sp-clk-cancel')?.addEventListener('click', () => {
        Utils.hideModal();
        resolve(false);
      });
      document.getElementById('sp-clk-ok')?.addEventListener('click', () => {
        Utils.hideModal();
        resolve(true);
      });
    });
  },

  _bindWorkerClockOnly(el, emp) {
    if (el.dataset.clockBound === '1') return;
    el.dataset.clockBound = '1';
    document.getElementById('staff-logout-worker')?.addEventListener('click', () => this._staffSignOut());
    document.getElementById('staff-back-hub')?.addEventListener('click', () => this._staffSignOut());
    el.querySelectorAll('[data-clock]').forEach(btn => {
      if (btn.dataset.clockBound === '1') return;
      btn.dataset.clockBound = '1';
      btn.addEventListener('click', async () => {
        if (btn.disabled) {
          const action = btn.dataset.clock;
          const msg = action === 'clock_in'
            ? 'You are already clocked in'
            : action === 'break_start'
              ? 'Start break is not available right now'
              : action === 'break_end'
                ? 'End break is not available right now'
                : 'Clock out is not available right now';
          return Utils.toast(msg, 'error');
        }
        const action = btn.dataset.clock;
        const ok = await this._confirmClockAction(action);
        if (!ok) return;
        btn.disabled = true;
        try {
          if (!this._adminOverride && window.StaffSelfieCapture?.promptForAction) {
            try {
              await StaffSelfieCapture.promptForAction(emp, action, { pin: this.employeePin });
            } catch (_) {
              Utils.toast('Photo required — clock action was not saved', 'error');
              return;
            }
          }
          let timer;
          const r = await Promise.race([
            API.staffClock(emp.id, action, {
              pin: this._adminOverride ? undefined : (this.employeePin || undefined),
              clientRequestId: this._newClientRequestId(),
              actor: this._adminOverride ? this.app.user : undefined
            }).finally(() => clearTimeout(timer)),
            new Promise((resolve) => {
              timer = setTimeout(() => resolve({ success: false, error: 'Clock action timed out " try again' }), 12000);
            })
          ]);
          if (!r || r.success === false) {
            return Utils.toast(r?.error || 'Could not record clock action', 'error');
          }
          const doneMsg = {
            clock_in: 'You are clocked in',
            break_start: 'Break started',
            break_end: 'Break ended',
            clock_out: 'You are clocked out — have a good day'
          }[action] || 'Recorded';
          Utils.toast(
            r.offlineQueued || r.data?.offlineQueued ? (r.message || 'Saved offline') : doneMsg,
            'success'
          );
          const attRes = await this._staffLoadSafe(API.getStaffTodayAttendance(emp.id), 'attendance_today', 4000);
          const yestStr = Utils.daysAgo(1);
          const todayStr = Utils.today();
          const schedRes = await this._staffLoadSafe(API.getStaffSchedules(yestStr, todayStr, emp.id), 'schedules_today', 4000);
          this._updateClockCard(el, emp, attRes, schedRes);
        } catch (err) {
          Utils.toast(err?.message || 'Could not record clock action', 'error');
        } finally {
          btn.disabled = false;
        }
      });
    });
    el.querySelectorAll('.staff-section-retry').forEach(btn => {
      btn.addEventListener('click', () => this._rerender());
    });
  },

  async renderWorkerPanel(el) {
    this._portalSeq = (this._portalSeq || 0) + 1;
    const seq = this._portalSeq;
    const emp = this.employee;
    if (!emp?.id) {
      el.innerHTML = `<div class="card" style="padding:20px"><p class="error-msg">No employee session. Please sign in again.</p>
        <button type="button" class="btn btn-primary" id="staff-relogin">Sign In</button></div>`;
      document.getElementById('staff-relogin')?.addEventListener('click', () => {
        this.employee = null;
        this._rerender();
      });
      return;
    }
    const scheduleStart = Utils.weekStart();
    const endDate = new Date(scheduleStart + 'T12:00:00');
    endDate.setDate(endDate.getDate() + 55);
    const scheduleEnd = endDate.toLocaleDateString('en-CA');
    const weekStart = Utils.weekStart();
    const weekEndDate = new Date(weekStart + 'T12:00:00');
    weekEndDate.setDate(weekEndDate.getDate() + 6);
    const weekEnd = weekEndDate.toLocaleDateString('en-CA');
    const histFrom = this._attHistFrom || weekStart;
    const histTo = this._attHistTo || weekEnd;
    const empId = parseInt(emp.id, 10);
    const actor = this.hrActor(emp);
    const yestStrEarly = Utils.daysAgo(1);
    const todayStrEarly = Utils.today();

    el.innerHTML = `<div class="staff-worker staff-portal-pro"><div class="staff-portal-hero">${this._staffAvatarHtml(emp, 40)}<h3 style="margin:0;flex:1">${this._esc(emp.full_name)}</h3>
      <button class="btn btn-ghost" id="staff-logout-worker">${this._adminOverride ? 'Close portal' : 'Sign Out'}</button></div>
      <p class="muted" style="padding:8px 0">Loading clock...</p></div>`;
    document.getElementById('staff-logout-worker')?.addEventListener('click', () => this._staffSignOut());

    // Paint clock shell immediately " never wait on APIs before buttons appear
    this._paintWorkerClockNow(el, emp, { success: true, data: {} }, { success: true, data: [] });
    this._bindWorkerClockOnly(el, emp);
    if (this.canDoRoutines(this.app, emp)) {
      const routinesElEarly = document.getElementById('staff-routines-panel');
      if (routinesElEarly) {
        routinesElEarly.dataset.routinesStarted = '1';
        this.renderStaffRoutines(routinesElEarly).catch((err) => this._staffLogError('routines', err));
      }
    }

    const [attRes, schedResToday] = await Promise.all([
      this._staffLoadSafe(API.getStaffTodayAttendance(empId), 'attendance_today', 4000),
      this._staffLoadSafe(API.getStaffSchedules(yestStrEarly, todayStrEarly, empId), 'schedules_today', 4000)
    ]);
    if (!this._portalAlive(seq, el)) return;

    this._updateClockCard(el, emp, attRes, schedResToday);

    // PHASE 2 " remaining sections load in background (never blocks clock)
    this._loadWorkerPortalSecondary(el, seq, emp, attRes, {
      scheduleStart, scheduleEnd, weekStart, weekEnd, histFrom, histTo, empId, actor
    }).catch((err) => this._staffLogError('phase2', err));
  },

  async _loadWorkerPortalSecondary(el, seq, emp, attRes, ctx) {
    const { scheduleStart, scheduleEnd, weekStart, weekEnd, histFrom, histTo, empId, actor } = ctx;
    try {
    const ps0 = this.portalSettings(this.app);
    const empty = { success: true, data: [] };
    const load = (fn, key, ms) => this._staffLoadSafe(fn, key, ms);
    // Wave 1 — essentials for the first screen
    const [balRes, leaveRes, payRes, histRes, schedRes, rulesRes, ruleAckRes] = await Promise.all([
      ps0.show_leave === false ? empty : load(API.getStaffLeaveBalance(empId), 'leave_balance', 3500),
      ps0.show_leave === false ? empty : load(API.getStaffLeave(empId), 'leave_list', 3500),
      ps0.show_payslips === false ? empty : load(API.getStaffPayroll(empId, actor), 'payroll', 3500),
      load(API.getStaffAttendanceSummary(empId, histFrom, histTo), 'attendance_history', 3500),
      load(API.getStaffSchedules(scheduleStart, scheduleEnd, empId), 'schedules', 3500),
      ps0.show_company_rules === false ? empty : load(API.getCompanyRules({ portal_only: true }), 'company_rules', 3000),
      ps0.show_company_rules === false ? empty : load(API.getRuleAcknowledgements({ employee_id: empId }), 'rule_acks', 3000)
    ]);
    if (!this._portalAlive(seq, el)) return;
    // Wave 2 — secondary (does not block first paint of wave-1 data)
    const [discRes, policyRes, warnRes, hrSubRes, feedRes, hrDocRes, filesRes, penRes, mgrHrCasesRes] = await Promise.all([
      ps0.show_disciplinary === false ? empty : load(API.getStaffDisciplinary(empId), 'disciplinary', 3500),
      load(API.getStaffLeavePolicy(empId), 'leave_policy', 3500),
      ps0.show_routines === false ? empty : load(API.getStaffChecklistWarnings(this.app.user?.id || null, empId), 'checklist_warnings', 3000),
      load(API.getHrStaffSubmissions({ employee_id: empId }, actor), 'hr_forms', 3500),
      load(API.getStaffPortalFeed(empId), 'portal_feed', 3000),
      ps0.show_hr_docs === false ? empty : load(API.getHrDocuments(empId, actor), 'hr_docs', 3000),
      ps0.show_my_files === false ? empty : load(API.getStaffDocuments(empId, actor), 'my_files', 3000),
      load(API.getAttendancePenalties({ employee_id: empId }, actor), 'penalties', 3000),
      load(API.mgrHrListEmployeeCases({ ...(actor || {}), employee_id: empId, full_name: emp.full_name, role: actor?.role || 'employee' }), 'mgr_hr_cases', 4000)
    ]);
    if (!this._portalAlive(seq, el)) return;
    const att = attRes.success !== false ? (attRes.data || {}) : {};
    const bal = balRes.success !== false ? (balRes.data || {}) : {};
    const leaves = leaveRes.success !== false ? (leaveRes.data || []) : [];
    const payroll = payRes.success !== false ? ((payRes.data || []).slice(0, 5)) : [];
    const disciplinary = discRes.success !== false ? (discRes.data || []) : [];
    const mgrHrCases = mgrHrCasesRes.success !== false ? (mgrHrCasesRes.data || []) : [];
    const myShifts = (schedRes.success !== false ? (schedRes.data || []) : []).filter((s) => {
      const day = new Date(`${s.shift_date}T12:00:00`).getDay();
      const weekend = day === 0 || day === 6;
      if (weekend && (s.is_rest_day || s._from_work_schedule)) return false;
      return true;
    });
    const penalties = penRes?.success !== false ? (penRes.data || []) : [];
    const portalSettings = policyRes.success !== false ? (policyRes.data || this.app.settings?.staff_portal_settings || {}) : (this.app.settings?.staff_portal_settings || {});
    const checklistWarnings = (warnRes.success !== false ? (warnRes.data || []) : [])
      .filter(w => {
        if (portalSettings.show_routines === false) return false;
        if (w.run_type === 'opening' && portalSettings.show_morning_routines === false) return false;
        if (w.run_type === 'closing' && portalSettings.show_closing_routines === false) return false;
        return true;
      });
    const hrSubmissions = hrSubRes.success !== false ? (hrSubRes.data || []) : [];
    let myContracts = [];
    let salaryClaims = [];
    const portalFeed = (feedRes.success !== false ? (feedRes.data || []) : []).filter(f => f.feed_type === 'employee_of_month');
    const eomFeed = portalFeed[0];
    const hist = histRes.success !== false ? (histRes.data || { days: [], total_hours: 0 }) : { days: [], total_hours: 0 };
    const hrDocs = (portalSettings.show_hr_docs !== false && hrDocRes?.success !== false) ? (hrDocRes.data || []) : [];
    const myFiles = (portalSettings.show_my_files !== false && filesRes?.success !== false) ? (filesRes.data || []) : [];
    const companyRules = (portalSettings.show_company_rules !== false && rulesRes?.success !== false)
      ? (rulesRes.data || []).filter(r => !r.status || r.status === 'active' || r.status === 'published')
      : [];
    const signedRuleIds = new Set((ruleAckRes?.success !== false ? (ruleAckRes.data || []) : []).map(a => Number(a.rule_id)));
    const todayStr = Utils.today();
    const yestStr = Utils.daysAgo(1);
    const todayShift = myShifts.find(s => s.shift_date === todayStr && !s.is_rest_day)
      || myShifts.find(s => s.shift_date === yestStr && !s.is_rest_day
        && String(s.end_time || '').slice(0, 5) <= String(s.start_time || '').slice(0, 5));
    const eomPhotoPath = (eomFeed?.photo_path || emp.photo_path || '').trim();
    const eomPhotoHtml = eomPhotoPath
      ? `<div class="staff-portal-avatar" data-photo="${this._esc(eomPhotoPath)}" style="width:72px;height:72px;border-radius:50%;background:var(--border);overflow:hidden;flex-shrink:0"></div>`
      : '';
    const leaveTypes = portalSettings.leave_types || ['Annual Leave', 'Sick Leave', 'Family Responsibility', 'Unpaid Leave'];
    const leaveOpen = portalSettings.leave_requests_open !== false;
    const maxMonth = portalSettings.max_leave_requests_per_month;
    const maxYear = portalSettings.max_leave_requests_per_year;
    const currency = this.app.settings?.currency || 'R';

    const earlyAlerts = this._staffAlertItems({ leaves, payroll, disciplinary, hrDocs, hrSubmissions, checklistWarnings, mgrHrCases });
    this._lastStaffAlertData = { leaves, payroll, disciplinary, hrDocs, hrSubmissions, checklistWarnings, mgrHrCases };
    const bannerHtml = `
      <div id="staff-portal-alerts">${this._staffAlertsHtml(earlyAlerts)}</div>
      ${eomFeed ? `<div class="card" style="margin-bottom:16px;border:2px solid var(--primary);background:var(--surface-alt, rgba(99,102,241,0.06))"><div class="card-body" style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">${eomPhotoHtml || '<div style="font-size:48px"></div>'}
        <div style="flex:1;min-width:200px"><div style="font-size:12px;text-transform:uppercase;letter-spacing:0.05em;color:var(--primary);font-weight:600">${this._esc(eomFeed.title || 'Employee of the Month')}</div>
          <p style="margin:8px 0 0">${this._esc(eomFeed.message || 'Congratulations on your award!')}</p>
          ${eomFeed.created_at ? `<small class="muted">${Utils.formatDateTime(eomFeed.created_at)}</small>` : ''}
          ${emp.phone ? `<div style="margin-top:10px"><button class="btn btn-sm btn-success" id="eom-self-wa">Send Congratulations via WhatsApp</button></div>` : ''}
        </div>
      </div></div>` : ''}
      ${checklistWarnings.length ? `<div class="card" style="margin-bottom:16px;border-color:var(--warning)"><div class="card-body"><h4 style="color:var(--warning)">Checklist Compliance Warnings</h4>
        ${checklistWarnings.map(w => `<div style="padding:8px 0;border-bottom:1px solid var(--border)"><strong>${w.run_type === 'opening' ? 'Morning Opening' : 'Closing'}</strong> " ${this._esc(w.run_date)}<br>
          <small>${this._esc(w.message || 'Routine not submitted by deadline')}</small>
          ${w.whatsapp_url ? `<br><a href="${this._esc(w.whatsapp_url)}" target="_blank" rel="noopener" class="btn btn-sm btn-ghost" style="margin-top:6px">Send WhatsApp Reminder</a>` : ''}
          ${w._worker_run ? '' : `<button class="btn btn-sm btn-ghost ack-portal-warn" data-id="${w.id}" style="margin-top:6px">Dismiss</button>`}
        </div>`).join('')}
        <p class="muted" style="margin-top:8px;font-size:12px">Complete your assigned morning/closing tasks in the panel above, then Submit to Admin.</p>
      </div></div>` : ''}
`;

    const secondaryHtml = `
      <div class="card" style="margin-top:16px"><div class="card-body"><h4>Hours &amp; History</h4>
        ${histRes.success === false ? this._staffSectionFail(histRes, 'Attendance history') : ''}
        <p class="muted" style="font-size:13px">Showing <strong>${histFrom}</strong> -> <strong>${histTo}</strong>.
          This week is ${weekStart} -> ${weekEnd}. Filter any dates to review older records; a new week starts each Monday.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0;align-items:center"><input type="date" id="att-hist-from" value="${histFrom}">
          <span>to</span>
          <input type="date" id="att-hist-to" value="${histTo}">
          <button class="btn btn-sm btn-primary" id="att-hist-go">Show records</button>
          <button class="btn btn-sm btn-ghost" id="att-hist-week">This week</button>
        </div>
        ${(() => {
          const byDate = {};
          (hist.days || []).forEach((d) => { byDate[d.work_date] = d; });
          const dates = [];
          const cur = new Date(histFrom + 'T12:00:00');
          const last = new Date(histTo + 'T12:00:00');
          while (cur <= last) {
            dates.push(cur.toLocaleDateString('en-CA'));
            cur.setDate(cur.getDate() + 1);
          }
          const cal = dates.map((dt) => {
            const d = byDate[dt];
            const worked = !!(d && (d.clock_in || Number(d.hours_worked) > 0));
            const open = !!(d && d.clock_in && !d.clock_out);
            const cls = open ? 'day-open' : (worked ? 'day-worked' : 'day-off');
            const label = open ? 'On shift' : (worked ? 'Worked' : 'Not worked');
            return `<div class="cal-day ${cls}"><div>${dt.slice(5)}</div><span class="staff-day-chip ${cls}">${label}</span></div>`;
          }).join('');
          const rowsHtml = dates.map((dt) => {
            const d = byDate[dt] || { work_date: dt };
            const worked = !!(d.clock_in || Number(d.hours_worked) > 0);
            const open = !!(d.clock_in && !d.clock_out);
            const chip = open ? 'On shift' : (worked ? 'Worked' : 'Not worked');
            const cls = open ? 'day-open' : (worked ? 'day-worked' : 'day-off');
            const payIn = d.payroll_clock_in || d.clock_in;
            const payOut = d.payroll_clock_out || d.clock_out;
            const countedDiff = payIn && d.clock_in && payIn !== d.clock_in;
            const countedOutDiff = payOut && d.clock_out && payOut !== d.clock_out;
            const autoCloseAt = d.auto_closed ? (d.payroll_clock_out || d.clock_out) : null;
            return `<tr>
              <td>${dt} <span class="staff-day-chip ${cls}">${chip}</span></td>
              <td>${d.clock_in ? this._staffTimeOnly(d.clock_in) : '—'}${countedDiff ? `<br><small class="muted">Counted ${this._staffTimeOnly(payIn)}</small>` : ''}</td>
              <td>${d.break_start ? this._staffTimeOnly(d.break_start) : '—'}${d.break_end ? ` → ${this._staffTimeOnly(d.break_end)}` : ''}</td>
              <td>${d.clock_out ? this._staffTimeOnly(d.clock_out) : '—'}${countedOutDiff ? `<br><small class="muted">Counted ${this._staffTimeOnly(payOut)}</small>` : ''}</td>
              <td>${autoCloseAt ? this._staffTimeOnly(autoCloseAt) : '—'}</td>
              <td><strong>${d.hours_worked ?? 0}h</strong></td>
              <td>${d.auto_closed ? 'Auto-closed (counted to shift end)' : (d.admin_entered ? 'Admin entry' : (d.status || chip))}</td>
            </tr>`;
          }).join('');
          const earn = hist.earnings || {};
          const earnBanner = earn.exceeds_basic ? `<div class="staff-earn-alert" style="margin:10px 0;padding:10px 12px;border-radius:8px;border:1px solid var(--warning);background:rgba(245,158,11,.1);font-size:13px">
            <strong>Hours earnings above basic salary</strong> — ${Utils.formatMoney(earn.attendance_gross || 0, currency)} from hours in this period vs basic reference ${Utils.formatMoney(earn.basic_reference || 0, currency)}.
            ${earn.hourly_rate ? `<br><small class="muted">Hourly rate: ${Utils.formatMoney(earn.hourly_rate, currency)}/h</small>` : ''}
          </div>` : (earn.hourly_rate ? `<p class="muted" style="font-size:13px;margin:8px 0 0">Hourly rate: <strong>${Utils.formatMoney(earn.hourly_rate, currency)}/h</strong>${earn.basic_reference ? ` · Basic reference: ${Utils.formatMoney(earn.basic_reference, currency)}` : ''}</p>` : '');
          return `${earnBanner}<div class="staff-worked-cal">${cal}</div>
        <div class="table-wrap"><table><thead><tr><th>Date</th><th>In (actual / counted)</th><th>Break</th><th>Out (actual / counted)</th><th>Auto-close</th><th>Hours</th><th>Status</th></tr></thead>
          <tbody>${rowsHtml || '<tr><td colspan="7" class="muted">No days in this range</td></tr>'}
        </tbody></table></div>`;
        })()}
        <p style="margin-top:8px"><strong>Period total: ${hist.total_hours || 0}h</strong> · Days worked: ${hist.days_worked || (hist.days || []).filter(d => d.clock_in || Number(d.hours_worked) > 0).length}</p>
      </div></div>
      ${this.canShowShifts(this.app, portalSettings) ? `<div class="card staff-shifts-card" style="margin-top:16px"><div class="card-body">
        <div class="staff-shifts-head" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
          <div><h4 style="margin:0">My Shifts</h4>
          <span class="muted" style="font-size:13px">${scheduleStart} → ${scheduleEnd} · ${myShifts.length} day(s)</span></div>
          <button type="button" class="btn btn-primary btn-sm" id="staff-open-shifts">View my shifts</button>
        </div>
        ${schedRes.success === false ? this._staffSectionFail(schedRes, 'Shift information') : (myShifts.length
          ? '<p class="muted" style="margin:8px 0 0">Tap <strong>View my shifts</strong> to see your roster or send it to WhatsApp as PDF.</p>'
          : '<p class="muted" style="margin:8px 0 0">No shifts scheduled in this period. Ask admin to generate shifts in Admin → Staff & HR → Shifts.</p>')}
      </div></div>` : ''}
      ${portalSettings.show_hr_docs !== false ? `<div class="card" id="staff-hr-docs" style="margin-top:16px"><div class="card-body"><h4>HR Documents</h4>
        <p class="muted" style="font-size:13px">Letters created in Admin → Staff &amp; HR → HR Documents.</p>
        ${hrDocRes.success === false ? this._staffSectionFail(hrDocRes, 'HR documents') : (hrDocs.length ? hrDocs.map(d => `<div style="padding:8px 0;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px"><span><strong>${this._esc(d.document_type || d.doc_type || 'Document')}</strong>
          ${d.title ? ` — ${this._esc(d.title)}` : ''}
          ${d.incident_date || d.created_at ? `<br><small class="muted">${this._esc(d.incident_date || Utils.formatDate(d.created_at))}</small>` : ''}
        </span>
          <span style="display:flex;gap:4px;flex-wrap:wrap">
            <button class="btn btn-sm btn-ghost hr-doc-view" data-id="${d.id}">View</button>
            <button class="btn btn-sm btn-primary hr-doc-print" data-id="${d.id}">Print</button>
          </span>
        </div>`).join('') : '<p class="muted">No HR documents yet</p>')}
      </div></div>` : ''}
      ${portalSettings.show_my_files !== false ? `<div class="card" style="margin-top:16px"><div class="card-body"><h4>My Files</h4>
        <p class="muted" style="font-size:13px">Upload ID, certificates, or other documents. Admin sees the same files under Staff &amp; HR → Employees → Files.</p>
        <button type="button" class="btn btn-sm btn-primary" id="my-file-upload" style="margin-bottom:8px">Upload document</button>
        ${filesRes.success === false ? this._staffSectionFail(filesRes, 'My files') : (myFiles.length ? myFiles.map(d => `<div style="padding:8px 0;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px"><span><strong>${this._esc(d.doc_type || 'File')}</strong>
          ${d.file_name ? ` — ${this._esc(d.file_name)}` : ''}
          ${d.notes ? `<br><small class="muted">${this._esc(d.notes)}</small>` : ''}
          ${d.created_at ? `<br><small class="muted">${Utils.formatDateTime?.(d.created_at) || d.created_at}</small>` : ''}
        </span>
          ${d.file_path ? `<button class="btn btn-sm btn-ghost my-file-view" data-id="${d.id}">View</button>` : ''}
        </div>`).join('') : '<p class="muted">No files uploaded yet</p>')}
      </div></div>` : ''}
      ${portalSettings.show_company_rules !== false ? `<div class="card" id="staff-company-rules" style="margin-top:16px"><div class="card-body">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap">
          <div>
            <h4 style="margin:0">Company Rules</h4>
            <p class="muted" style="font-size:13px;margin:6px 0 0">View the full policy, then sign and acknowledge with your name and surname.</p>
          </div>
          <span style="display:flex;gap:8px;flex-wrap:wrap">
            <button type="button" class="btn btn-sm btn-primary" id="staff-view-all-rules">View rules</button>
            <button type="button" class="btn btn-sm btn-warning" id="staff-sign-all-rules"${companyRules.length && companyRules.some((r) => !signedRuleIds.has(Number(r.id))) ? '' : ' disabled'}>${companyRules.length && !companyRules.some((r) => !signedRuleIds.has(Number(r.id))) ? '✓ Signed' : 'Sign'}</button>
          </span>
        </div>
        ${rulesRes.success === false ? this._staffSectionFail(rulesRes, 'Company rules') : ''}
        ${!companyRules.length && rulesRes.success !== false
          ? '<p class="muted" style="margin:12px 0 0">No rules released to the portal yet. Ask management to publish rules in Operations &amp; Compliance (Permit on Staff Portal).</p>'
          : `<div style="margin-top:12px">${companyRules.slice(0, 30).map((r) => {
            const signed = signedRuleIds.has(Number(r.id));
            return `<div class="staff-rule-card" data-id="${r.id}" style="padding:10px 0;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap">
              <div><strong>${this._esc(r.title || r.rule_number || 'Rule')}</strong>
                ${r.category ? `<span class="muted"> · ${this._esc(r.category)}</span>` : ''}
                ${signed
                  ? '<br><span class="staff-day-chip day-worked">✓ Signed</span>'
                  : '<br><span class="staff-day-chip day-open">Needs signature</span>'}
              </div>
              <span style="display:flex;gap:6px;flex-wrap:wrap">
                <button type="button" class="btn btn-sm btn-ghost staff-view-rule" data-id="${r.id}">View</button>
                ${signed
                  ? '<button type="button" class="btn btn-sm btn-ghost" disabled>✓ Signed</button>'
                  : `<button type="button" class="btn btn-sm btn-primary staff-sign-rule" data-id="${r.id}">Sign</button>`}
              </span>
            </div>`;
          }).join('')}</div>
          <p class="muted" style="font-size:12px;margin:10px 0 0">${[...signedRuleIds].filter((id) => companyRules.some((r) => Number(r.id) === Number(id))).length} of ${companyRules.length} signed · management can see who signed in Operations &amp; Compliance</p>`}
      </div></div>` : ''}
      ${hrSubmissions.length ? `<div class="card" style="margin-top:16px;border-color:var(--primary)"><div class="card-body"><h4>HR Forms & Documents</h4>
        <p class="muted" style="font-size:13px">Complete assigned training, probation, or employment forms and upload supporting documents.</p>
        ${hrSubmissions.map(s => `<div style="padding:10px 0;border-bottom:1px solid var(--border)"><strong>${s.template_type}</strong> " ${s.template_title || 'Form'} · <span class="tag">${s.submitted_at ? 'Submitted' : 'Pending'}</span>
          ${s.status === 'pending' && !s.submitted_at ? `<details style="margin-top:8px"><summary class="muted" style="cursor:pointer;font-size:12px">View agreement template</summary>
            <pre style="white-space:pre-wrap;font-size:11px;max-height:160px;overflow:auto;margin-top:8px;background:var(--bg-secondary);padding:8px;border-radius:6px">${Utils.escHtml((s.filled_data?.template_body || '').slice(0, 2000))}</pre></details>
            <div style="margin-top:8px"><textarea id="hr-form-${s.id}" rows="4" style="width:100%" placeholder="Fill in employee details and sign-off notes...">${Utils.escHtml(s.filled_data?.employee_response || '')}</textarea>
            <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap"><button class="btn btn-sm btn-ghost hr-upload-doc" data-id="${s.id}">Upload CV / Document</button>
              <button class="btn btn-sm btn-primary hr-submit-form" data-id="${s.id}">Submit to Admin</button>
            </div>
          </div>` : `<p class="muted" style="font-size:12px;margin-top:4px">${s.submitted_at ? `Submitted ${Utils.formatDateTime(s.submitted_at)}` : `Updated ${Utils.formatDateTime(s.updated_at || s.created_at)}`} · ${s.status}</p>`}
        </div>`).join('')}
      </div></div>` : ''}
      <div class="staff-portal-split">${portalSettings.show_leave !== false ? `<div class="card" id="staff-leave-balance"><div class="card-body">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
            <h4 style="margin:0">Leave Balance</h4>
            <button type="button" class="btn btn-sm btn-ghost" id="staff-leave-view-all">View leave</button>
          </div>
          ${balRes.success === false ? this._staffSectionFail(balRes, 'Leave balance') : `
          <div class="stats-grid" style="margin-top:12px">
            <div class="stat-card"><div class="label">Annual</div><div class="value">${(bal.annual?.total || 0) - (bal.annual?.used || 0)}</div><small class="muted">${bal.annual?.used || 0} used of ${bal.annual?.total || 0}</small></div>
            <div class="stat-card"><div class="label">Sick</div><div class="value">${(bal.sick?.total || 0) - (bal.sick?.used || 0)}</div><small class="muted">${bal.sick?.used || 0} used of ${bal.sick?.total || 0}</small></div>
            <div class="stat-card"><div class="label">Family</div><div class="value">${(bal.family?.total || 0) - (bal.family?.used || 0)}</div><small class="muted">${bal.family?.used || 0} used of ${bal.family?.total || 0}</small></div>
          </div>`}
          <p class="muted" style="font-size:12px;margin-top:8px">
            Portal: <strong>${leaveOpen ? 'Open' : 'Closed'}</strong> · Sick leave always allowed
            ${maxMonth ? `<br>Requests this month: ${portalSettings.requests_this_month || 0} / ${maxMonth}` : ''}
            ${maxYear ? `<br>Requests this year: ${portalSettings.requests_this_year || 0} / ${maxYear}` : ''}
          </p>
          ${(portalSettings.active_blackouts || []).length ? `<p class="muted" style="font-size:12px;color:var(--warning)">Blackout periods apply — only sick leave allowed on blocked dates.</p>` : ''}
          <button class="btn btn-primary btn-sm" id="staff-request-leave" style="margin-top:8px">Request Leave</button>
        </div></div>` : ''}
        ${portalSettings.show_payslips !== false ? `<div class="card" id="staff-payslips"><div class="card-body"><h4>Recent Payslips</h4>
          ${payRes.success === false ? this._staffSectionFail(payRes, 'Payroll') : (payroll.length ? payroll.map(p => {
            const items = (p.deduction_items || []).filter((d) => !d.is_employer && Number(d.amount) > 0);
            const pens = p.penalties || [];
            return `<div style="padding:6px 0;border-bottom:1px solid var(--border)"><div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px"><span>${p.period_start} — ${p.period_end}<br><small class="muted">${p.status}${p.gross_salary != null ? ` · Gross ${Utils.formatMoney(p.gross_salary, currency)}` : ''}</small></span>
            <span style="display:flex;align-items:center;gap:4px;flex-wrap:wrap">
              <strong>${Utils.formatMoney(p.net_salary, currency)}</strong>
              <button class="btn btn-sm btn-ghost dl-payslip" data-id="${p.id}" title="Download PDF">Download PDF</button>
              ${emp.phone ? `<button class="btn btn-sm btn-success wa-payslip" data-id="${p.id}" title="WhatsApp payslip summary">WhatsApp</button>` : ''}
            </span></div>
            ${(Number(p.deductions) || Number(p.attendance_deductions) || items.length || pens.length) ? `<div style="margin-top:6px;font-size:12px">
              ${Number(p.attendance_deductions) ? `<div>Attendance deductions: <strong>${Utils.formatMoney(p.attendance_deductions, currency)}</strong></div>` : ''}
              ${Number(p.other_deductions) ? `<div>Other deductions: <strong>${Utils.formatMoney(p.other_deductions, currency)}</strong></div>` : ''}
              ${Number(p.deductions) && !items.length ? `<div>Total deductions: <strong>${Utils.formatMoney(p.deductions, currency)}</strong></div>` : ''}
              ${items.map((d) => `<div>${this._esc(d.description || d.deduction_type || 'Deduction')}: <strong>${Utils.formatMoney(d.amount, currency)}</strong></div>`).join('')}
              ${pens.map((x) => `<div>Penalty (${this._esc(x.penalty_type)}): <strong>${x.penalty_type === 'hours' ? `${x.amount}h` : Utils.formatMoney(x.amount, currency)}</strong> · ${this._esc(x.reason || x.status)}</div>`).join('')}
            </div>` : ''}
          </div>`;
          }).join('') : '<p class="muted">No payslips yet</p>')}
        </div></div>` : ''}
      </div>
      ${portalSettings.show_leave !== false ? `<div class="card" id="staff-leave" style="margin-top:16px"><div class="card-body"><h4>My Leave Requests</h4>
        ${leaveRes.success === false ? this._staffSectionFail(leaveRes, 'Leave requests') : ''}
        ${leaveRes.success === false ? '' : (leaves.length ? leaves.slice(0, 8).map(l => {
          const ended = (l.end_date || l.start_date) <= Utils.today();
          const needsProof = l.status === 'approved' && ended && /sick/i.test(l.leave_type || '') && !l.proof_confirmed_at;
          const proofPending = l.proof_path && !l.proof_confirmed_at;
          return `<div style="padding:10px 0;border-bottom:1px solid var(--border)"><div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px"><span>${l.leave_type} · ${l.start_date} " ${l.end_date} · <strong>${l.status}</strong>
                ${proofPending ? '<br><small style="color:var(--warning)">Proof submitted " awaiting admin confirmation</small>' : ''}
                ${l.proof_confirmed_at ? '<br><small style="color:var(--success)">Proof confirmed</small>' : ''}
              </span>
              ${l.status === 'approved' ? `<span style="display:flex;gap:4px;flex-wrap:wrap">
                <button class="btn btn-sm btn-ghost lv-pdf" data-id="${l.id}">Download PDF</button>
                ${emp.phone ? `<button class="btn btn-sm btn-success lv-wa" data-id="${l.id}">WhatsApp</button>` : ''}
              </span>` : ''}
            </div>
            ${needsProof && !l.proof_path ? `<div style="margin-top:8px;padding:10px;background:var(--bg-secondary);border-radius:8px"><small class="muted">Upload sick leave proof (doctor's note / certificate)</small>
              <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap"><button class="btn btn-sm btn-ghost lv-proof-upload" data-id="${l.id}" title="Upload picture">Upload</button>
                <button class="btn btn-sm btn-primary lv-proof-camera" data-id="${l.id}" title="Take photo">Take Photo</button>
              </div>
            </div>` : ''}
          </div>`;
        }).join('') : '<p class="muted">No leave requests</p>')}
      </div></div>` : ''}
      ${penalties.length ? `<div class="card" style="margin-top:16px"><div class="card-body"><h4>Deductions &amp; Penalties</h4>
        <p class="muted" style="font-size:13px">These amounts apply to your pay when payroll is generated.</p>
        ${penalties.map((x) => `<div style="padding:8px 0;border-bottom:1px solid var(--border)"><strong>${this._esc(x.penalty_type === 'hours' ? `${x.amount} hours` : Utils.formatMoney(x.amount, currency))}</strong>
          · ${this._esc(x.reason || 'Attendance penalty')} · <span class="tag">${this._esc(x.status)}</span>
          ${x.work_date ? `<br><small class="muted">${this._esc(x.work_date)}</small>` : ''}
        </div>`).join('')}
      </div></div>` : ''}
      <div class="card" id="staff-mgr-hr-cases" style="margin-top:16px;border-color:var(--warning)"><div class="card-body">
        <h4>HR / Disciplinary Cases</h4>
        <p class="muted" style="font-size:13px">Cases reported by your Manager or Supervisor. Open a case to view details and submit your response when requested.</p>
        ${mgrHrCasesRes.success === false ? this._staffSectionFail(mgrHrCasesRes, 'HR cases') : ''}
        ${mgrHrCasesRes.success === false ? '' : (mgrHrCases.length ? mgrHrCases.map((c) => {
          const needsResp = ['EMPLOYEE_RESPONSE_REQUESTED', 'REPORTED', 'UNDER_REVIEW'].includes(c.status);
          return `<div style="padding:10px 0;border-bottom:1px solid var(--border)">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">
              <span><strong>${this._esc(c.case_number || ('#' + c.id))}</strong>
                · <span class="tag">${this._esc(c.status || '')}</span>
                ${c.severity ? ` · <span class="tag">${this._esc(c.severity)}</span>` : ''}
                <br><small>${this._esc(c.incident_type || c.title || 'Incident')} · ${this._esc(c.incident_date || '')}</small>
                ${c.branch_name ? `<br><small class="muted">${this._esc(c.branch_name)}</small>` : ''}
              </span>
              <button type="button" class="btn btn-sm ${needsResp ? 'btn-primary' : 'btn-ghost'} mgr-hr-case-open" data-id="${c.id}">
                ${needsResp ? 'Respond' : 'View'}
              </button>
            </div>
          </div>`;
        }).join('') : '<p class="muted">No Manager/Supervisor HR cases</p>')}
      </div></div>
      ${portalSettings.show_disciplinary !== false ? `<div class="card" id="staff-disciplinary" style="margin-top:16px"><div class="card-body">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
          <h4 style="margin:0">HR &amp; Discipline</h4>
          <button type="button" class="btn btn-sm btn-primary" id="staff-open-discipline">View cases</button>
        </div>
        <p class="muted" style="font-size:13px">Warnings, hearings, and written responses from Admin → Staff &amp; HR.</p>
        ${discRes.success === false ? this._staffSectionFail(discRes, 'Disciplinary records') : ''}
        ${discRes.success === false ? '' : (disciplinary.length ? disciplinary.map(d => `<div style="padding:10px 0;border-bottom:1px solid var(--border)"><div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px"><span><strong>${this._esc(d.record_type)}</strong> · ${this._esc(d.incident_date)}<br>
            <small>${this._esc(d.description || '')}</small>
            ${d.action_taken ? `<br><small class="muted">Action: ${this._esc(d.action_taken)}</small>` : ''}
            ${d.worker_response ? `<br><small style="color:var(--success)">Your response: ${this._esc(d.worker_response)}</small>` : ''}
            </span>
            <span style="display:flex;gap:4px;flex-wrap:wrap">
              <button class="btn btn-sm btn-ghost disc-pdf" data-id="${d.id}">Download PDF</button>
              <button class="btn btn-sm btn-primary disc-print" data-id="${d.id}">Print</button>
              ${emp.phone ? `<button class="btn btn-sm btn-success disc-wa" data-id="${d.id}">WhatsApp</button>` : ''}
            </span>
          </div>
          ${!d.worker_response && (d.requires_response || portalSettings.require_disciplinary_response) && d.status !== 'responded' ? `<div style="margin-top:8px"><textarea id="disc-resp-${d.id}" rows="2" placeholder="Your written response..." style="width:100%"></textarea>
            <button class="btn btn-sm btn-primary disc-respond" data-id="${d.id}" style="margin-top:6px">Submit Response</button>
          </div>` : ''}
        </div>`).join('') : '<p class="muted">No disciplinary records</p>')}
      </div></div>` : ''}
      <div id="staff-portal-deferred"><p class="muted" style="font-size:13px;padding:8px 0">Loading contracts &amp; salary claims...</p></div>
`;

    const secondaryEl = el.querySelector('#staff-portal-secondary');
    const bannerEl = el.querySelector('#staff-portal-banner');
    const clockAlive = !!el.querySelector('[data-clock]');
    if (clockAlive && secondaryEl) {
      if (bannerEl) bannerEl.innerHTML = bannerHtml;
      secondaryEl.innerHTML = secondaryHtml;
      this._bindStaffAlerts(el);
    } else {
      el.dataset.clockBound = '';
      el.innerHTML = `<div class="staff-worker staff-portal-pro"><div class="staff-portal-hero">${this._staffAvatarHtml(emp, 48)}
        <h3 style="margin:0;flex:1">${this._esc(emp.full_name)}</h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap">${this._adminOverride ? `<button class="btn btn-ghost" id="staff-back-hub"><- All employees</button>
            <button class="btn btn-ghost" id="staff-goto-hr">Edit in Staff &amp; HR</button>` : ''}
          <button class="btn btn-ghost" id="staff-logout-worker">${this._adminOverride ? 'Close portal' : 'Sign Out'}</button>
        </div></div>
      ${this._adminOverride ? `<div class="card" style="margin-bottom:12px;border-color:var(--primary)"><div class="card-body"><strong>Admin view</strong> — you are in ${this._esc(emp.full_name)}'s Staff Portal.
      </div></div>` : ''}
      <div id="staff-portal-banner">${bannerHtml}</div>
      ${this.canDoRoutines(this.app, emp) ? '<div id="staff-routines-panel" style="margin-bottom:16px"></div>' : ''}
      <div class="stats-grid"><div class="stat-card"><div class="label">Employee ID</div><div class="value" style="font-size:16px">${this._esc(emp.employee_code)}</div></div>
        <div class="stat-card"><div class="label">Position</div><div class="value" style="font-size:16px">${this._esc(emp.position || '"')}</div></div>
        <div class="stat-card"><div class="label">Today's Status</div><div class="value" style="font-size:16px">${att.clock_in ? (att.clock_out ? 'Completed' : 'On Shift') : 'Not Clocked In'}</div></div>
        <div class="stat-card"><div class="label">Hours Today</div><div class="value">${att.hours_worked || 0}h</div></div>
      </div>
      <div class="card" style="margin-top:16px"><div class="card-body"><h4>Clock In / Out</h4>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button class="btn btn-success" data-clock="clock_in" ${att.clock_in ? 'disabled' : ''}>Clock In</button>
          <button class="btn btn-warning" data-clock="break_start" ${!att.clock_in || att.clock_out ? 'disabled' : ''}>Start Break</button>
          <button class="btn btn-ghost" data-clock="break_end" ${!att.break_start || att.break_end ? 'disabled' : ''}>End Break</button>
          <button class="btn btn-danger" data-clock="clock_out" ${!att.clock_in || att.clock_out ? 'disabled' : ''}>Clock Out</button>
        </div>
      </div></div>
      <div id="staff-portal-secondary">${secondaryHtml}</div>
    </div>`;
      this._bindWorkerClockOnly(el, emp);
    }
    this._bindStaffAlerts(el);

    if (el.dataset.clockBound !== '1') this._bindWorkerClockOnly(el, emp);
    document.getElementById('att-hist-go')?.addEventListener('click', () => {
      this._attHistFrom = document.getElementById('att-hist-from')?.value || weekStart;
      this._attHistTo = document.getElementById('att-hist-to')?.value || weekEnd;
      this._rerender();
    });
    document.getElementById('att-hist-week')?.addEventListener('click', () => {
      this._attHistFrom = weekStart;
      this._attHistTo = weekEnd;
      this._rerender();
    });
    document.getElementById('staff-logout-worker')?.addEventListener('click', () => this._staffSignOut());
    document.getElementById('staff-back-hub')?.addEventListener('click', () => this._staffSignOut());
    document.getElementById('staff-goto-hr')?.addEventListener('click', async () => {
      const empId = emp.id;
      try { await API.staffLogout?.(); } catch (_) { /* ignore */ }
      this.employee = null;
      this._adminOverride = false;
      if (this._embeddedInAdmin && window.AdminPage) {
        AdminPage.section = 'staffhr';
        AdminPage.staffTab = 'employees';
        document.querySelectorAll('.admin-nav-btn').forEach(n => n.classList.toggle('active', n.dataset.section === 'staffhr'));
        await AdminPage.renderSection(document.getElementById('admin-content'));
        const r = await API.getEmployee(empId, this.app.user);
        if (r.success) AdminPage.showEmployeeForm?.(r.data);
        return;
      }
      App.navigateToAdminSection?.('staffhr', 'employees');
      setTimeout(async () => {
        const r = await API.getEmployee(empId, this.app.user);
        if (r.success) AdminPage.showEmployeeForm?.(r.data);
      }, 400);
    });
    el.querySelectorAll('.staff-section-retry').forEach(btn => {
      btn.addEventListener('click', () => this._rerender());
    });
    el.querySelectorAll('.ack-portal-warn').forEach(btn => btn.addEventListener('click', async () => {
      const r = await API.ackChecklistWarning(parseInt(btn.dataset.id, 10), this.hrActor(emp) || this.app.user);
      if (!r?.success) return Utils.toast(r?.error || 'Could not dismiss warning', 'error');
      Utils.toast('Warning dismissed', 'success');
      this._rerender();
    }));
    API.getRuleAcknowledgements({ employee_id: emp.id }).then((ackRes) => {
      const signed = new Set((ackRes.data || []).map(a => Number(a.rule_id)));
      el.querySelectorAll('.staff-sign-rule').forEach((btn) => {
        if (signed.has(Number(btn.dataset.id))) {
          btn.disabled = true;
          btn.textContent = '✓ Signed';
        }
      });
    }).catch(() => {});
    document.getElementById('staff-view-all-rules')?.addEventListener('click', () => {
      this._openViewRulesModal(companyRules);
    });
    document.getElementById('staff-sign-all-rules')?.addEventListener('click', () => {
      this._openSignRulesModal(emp, companyRules, signedRuleIds, () => this._rerender());
    });
    el.querySelectorAll('.staff-view-rule').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const rule = companyRules.find((x) => String(x.id) === String(btn.dataset.id));
        if (!rule) return;
        const adminSig = await this._getAdminSignaturePath();
        Utils.showModal(rule.title || 'Company rule', this._ruleBodyHtml(rule, { adminSignaturePath: adminSig }),
          '<button type="button" class="btn btn-ghost" id="staff-rule-close">Close</button>', { wide: true });
        document.getElementById('staff-rule-close')?.addEventListener('click', () => Utils.hideModal());
      });
    });
    el.querySelectorAll('.staff-sign-rule').forEach((btn) => btn.addEventListener('click', () => {
      const ruleId = Number(btn.dataset.id);
      const one = companyRules.filter((x) => Number(x.id) === ruleId);
      this._openSignRulesModal(emp, one.length ? one : companyRules, signedRuleIds, () => this._rerender());
    }));
    el.querySelectorAll('.hr-submit-form').forEach(btn => btn.addEventListener('click', async () => {
      const id = parseInt(btn.dataset.id, 10);
      const response = document.getElementById(`hr-form-${id}`)?.value.trim();
      if (!response) return Utils.toast('Fill in the form before submitting', 'error');
      const r = await API.submitHrStaffForm({ id, require_cv: true, filled_data: { employee_response: response, completed_form: response } }, this.hrActor(emp));
      if (!r.success) return Utils.toast(r.error, 'error');
      Utils.toast('Form submitted to admin', 'success');
      this._rerender();
    }));
    el.querySelectorAll('.hr-upload-doc').forEach(btn => btn.addEventListener('click', async () => {
      const pick = await API.selectDocument('doc');
      if (!pick.success || !pick.path) return;
      const r = await API.attachHrSubmissionDoc(parseInt(btn.dataset.id, 10), pick.path, this.hrActor(emp));
      if (!r.success) return Utils.toast(r.error, 'error');
      Utils.toast('Document attached', 'success');
    }));
    el.querySelectorAll('.ctr-pdf').forEach(btn => btn.addEventListener('click', async () => {
      await Utils.savePdfBuffer(`contract-${btn.dataset.id}.pdf`, await API.getHrContractPdf(parseInt(btn.dataset.id, 10), this.hrActor(emp)));
    }));
    el.querySelectorAll('.ctr-upload').forEach(btn => btn.addEventListener('click', async () => {
      const pick = await API.selectDocument('doc');
      if (!pick.success || !pick.path) return;
      const r = await API.attachHrContractDoc(parseInt(btn.dataset.id, 10), pick.path, pick.name || pick.fileName || 'document', this.hrActor(emp));
      if (!r.success) return Utils.toast(r.error || 'Upload failed', 'error');
      Utils.toast('Document uploaded for re-sign', 'success');
      this._rerender();
    }));
    el.querySelectorAll('.ctr-sign').forEach(btn => btn.addEventListener('click', () => {
      const id = parseInt(btn.dataset.id, 10);
      Utils.showModal('Sign employment contract', `
        <p class="muted">Draw your signature below (documents must be uploaded first if this is a re-sign).</p>
        <canvas id="ctr-sig-pad" width="400" height="160" style="width:100%;max-width:400px;border:1px solid var(--border);border-radius:8px;touch-action:none;background:#fff"></canvas>
        <div style="margin-top:8px"><button type="button" class="btn btn-ghost btn-sm" id="ctr-sig-clear">Clear</button></div>`,
        '<button class="btn btn-primary" id="ctr-sig-save">Save signature</button>');
      const canvas = document.getElementById('ctr-sig-pad');
      const ctx = canvas.getContext('2d');
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 2;
      let drawing = false;
      const pos = (e) => {
        const r = canvas.getBoundingClientRect();
        const t = e.touches?.[0] || e;
        return { x: (t.clientX - r.left) * (canvas.width / r.width), y: (t.clientY - r.top) * (canvas.height / r.height) };
      };
      const start = (e) => { e.preventDefault(); drawing = true; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); };
      const move = (e) => { if (!drawing) return; e.preventDefault(); const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); };
      const end = () => { drawing = false; };
      canvas.addEventListener('mousedown', start);
      canvas.addEventListener('mousemove', move);
      canvas.addEventListener('mouseup', end);
      canvas.addEventListener('mouseleave', end);
      canvas.addEventListener('touchstart', start, { passive: false });
      canvas.addEventListener('touchmove', move, { passive: false });
      canvas.addEventListener('touchend', end);
      document.getElementById('ctr-sig-clear')?.addEventListener('click', () => ctx.clearRect(0, 0, canvas.width, canvas.height));
      document.getElementById('ctr-sig-save')?.addEventListener('click', async () => {
        const blank = document.createElement('canvas');
        blank.width = canvas.width; blank.height = canvas.height;
        if (canvas.toDataURL() === blank.toDataURL()) return Utils.toast('Please sign first', 'error');
        const r = await API.signHrContract(id, 'employee', canvas.toDataURL('image/png'), this.hrActor(emp));
        if (!r.success) return Utils.toast(r.error || 'Sign failed', 'error');
        Utils.hideModal();
        Utils.toast('Contract signed', 'success');
        this._rerender();
      });
    }));
    el.querySelectorAll('.sc-claim').forEach(btn => btn.addEventListener('click', async () => {
      const id = parseInt(btn.dataset.id, 10);
      Utils.showModal('Claim salary', `
        <p class="muted">Confirm you want to claim this salary period. Admin must approve before payment.</p>
        <div class="field"><label>Notes (optional)</label><input id="sc-notes" placeholder="e.g. bank details confirmed"></div>`,
        '<button class="btn btn-primary" id="sc-claim-go">Submit claim</button>');
      document.getElementById('sc-claim-go')?.addEventListener('click', async () => {
        const notes = document.getElementById('sc-notes')?.value.trim() || '';
        const r = await API.claimSalary(id, notes, this.hrActor(emp));
        if (!r.success) return Utils.toast(r.error || 'Claim failed', 'error');
        Utils.hideModal();
        Utils.toast('Salary claim submitted', 'success');
        this._rerender();
      });
    }));
    el.querySelectorAll('.sc-pdf').forEach(btn => btn.addEventListener('click', async () => {
      await Utils.savePdfBuffer(`salary-claim-${btn.dataset.id}.pdf`, await API.getSalaryClaimPdf(parseInt(btn.dataset.id, 10), this.hrActor(emp)));
    }));
    document.getElementById('staff-request-leave')?.addEventListener('click', () => this.showLeaveForm(leaveTypes, portalSettings));
    document.getElementById('staff-leave-view-all')?.addEventListener('click', () => {
      const rows = (leaves || []).map((l) =>
        `<tr><td>${this._esc(l.leave_type || '')}</td><td>${this._esc(l.start_date || '')}</td><td>${this._esc(l.end_date || '')}</td><td>${this._esc(l.status || '')}</td></tr>`
      ).join('') || '<tr><td colspan="4" class="muted">No leave records yet</td></tr>';
      Utils.showModal('Leave history', `
        <div class="table-wrap" style="max-height:360px;overflow:auto"><table>
          <thead><tr><th>Type</th><th>From</th><th>To</th><th>Status</th></tr></thead>
          <tbody>${rows}</tbody></table></div>`,
        '<button type="button" class="btn btn-ghost" id="lv-hist-close">Close</button>');
      document.getElementById('lv-hist-close')?.addEventListener('click', () => Utils.hideModal());
    });
    document.getElementById('staff-open-discipline')?.addEventListener('click', () => {
      const casesHtml = (disciplinary || []).map((d) =>
        `<div style="padding:10px 0;border-bottom:1px solid var(--border)"><strong>${this._esc(d.record_type || 'Case')}</strong> · ${this._esc(d.incident_date || '')}
          <div style="font-size:13px;margin-top:4px">${this._esc(d.description || '')}</div>
          ${d.action_taken ? `<small class="muted">Action: ${this._esc(d.action_taken)}</small>` : ''}
          ${d.worker_response ? `<div style="color:var(--success);font-size:12px;margin-top:4px">Your response: ${this._esc(d.worker_response)}</div>` : ''}
        </div>`
      ).join('') || '<p class="muted">No warnings or disciplinary records</p>';
      Utils.showModal('HR & Discipline', casesHtml, '<button type="button" class="btn btn-ghost" id="disc-hist-close">Close</button>');
      document.getElementById('disc-hist-close')?.addEventListener('click', () => Utils.hideModal());
    });
    el.querySelectorAll('.disc-respond').forEach(btn => {
      btn.addEventListener('click', async () => {
        const text = document.getElementById(`disc-resp-${btn.dataset.id}`)?.value.trim();
        if (!text) return Utils.toast('Enter your response', 'error');
        const r = await API.respondStaffDisciplinary(parseInt(btn.dataset.id), emp.id, text);
        if (!r.success) return Utils.toast(r.error, 'error');
        this._markAlertAttended('#staff-disciplinary::Warning / disciplinary — response required');
        this._markAlertAttended('disc-respond');
        Utils.toast('Response saved', 'success');
        this._rerender();
      });
    });
    el.querySelectorAll('.mgr-hr-case-open').forEach((btn) => {
      btn.addEventListener('click', () => this._openStaffMgrHrCase(Number(btn.dataset.id), emp));
    });
    el.querySelectorAll('.dl-payslip').forEach(btn => {
      btn.addEventListener('click', async () => {
        const pdfAuth = this._adminOverride ? undefined : (this.employeePin ? { pin: this.employeePin } : undefined);
        await Utils.savePdfBuffer(`payslip-${btn.dataset.id}.pdf`, await API.getStaffPayslipPdf(parseInt(btn.dataset.id, 10), pdfAuth));
      });
    });
    el.querySelectorAll('.wa-payslip').forEach(btn => {
      btn.addEventListener('click', async () => {
        const p = payroll.find(x => String(x.id) === btn.dataset.id);
        if (!p) return;
        const waRes = await Utils.sendPayslipWhatsApp(this.app, p, emp);
        if (!waRes.success) Utils.toast(waRes.error || 'WhatsApp failed', 'error');
      });
    });
    el.querySelectorAll('.lv-pdf').forEach(btn => {
      btn.addEventListener('click', async () => {
        await Utils.savePdfBuffer(`leave-${btn.dataset.id}.pdf`, await API.getStaffLeavePdf(parseInt(btn.dataset.id, 10)));
      });
    });
    el.querySelectorAll('.lv-wa').forEach(btn => {
      btn.addEventListener('click', async () => {
        const l = leaves.find(x => String(x.id) === btn.dataset.id);
        if (!l) return;
        const waRes = await Utils.sendLeaveWhatsApp(this.app, l, emp);
        if (!waRes.success) Utils.toast(waRes.error || 'WhatsApp failed', 'error');
      });
    });
    const submitProof = async (leaveId, imageData) => {
      try { window.StaffPortalStandalone?.saveSession?.(emp); } catch (_) { /* ignore */ }
      const r = await API.submitStaffLeaveProof(parseInt(leaveId, 10), emp.id, imageData);
      if (!r.success) return Utils.toast(r.error, 'error');
      Utils.toast('Proof submitted — admin will confirm', 'success');
      this._rerender();
    };
    el.querySelectorAll('.lv-proof-upload').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          try { window.StaffPortalStandalone?.saveSession?.(emp); } catch (_) { /* ignore */ }
          const data = await Utils.pickProofImage();
          await submitProof(btn.dataset.id, data);
        } catch (err) {
          Utils.toast(err.message || 'Upload cancelled', 'error');
        }
      });
    });
    el.querySelectorAll('.lv-proof-camera').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          try { window.StaffPortalStandalone?.saveSession?.(emp); } catch (_) { /* ignore */ }
          const data = await Utils.captureProofPhoto();
          if (!data) return Utils.toast('No photo captured', 'error');
          await submitProof(btn.dataset.id, data);
        } catch (err) {
          Utils.toast(err.message || 'Camera unavailable', 'error');
        }
      });
    });
    el.querySelectorAll('.disc-pdf').forEach(btn => {
      btn.addEventListener('click', async () => {
        await Utils.savePdfBuffer(`disciplinary-${btn.dataset.id}.pdf`, await API.getStaffDisciplinaryPdf(parseInt(btn.dataset.id, 10), 'staff'));
      });
    });
    el.querySelectorAll('.disc-print').forEach(btn => {
      btn.addEventListener('click', async () => {
        await Utils.printToA4(
          await API.getStaffDisciplinaryPdf(parseInt(btn.dataset.id, 10), 'staff'),
          `disciplinary-${btn.dataset.id}.pdf`
        );
      });
    });
    el.querySelectorAll('.disc-wa').forEach(btn => {
      btn.addEventListener('click', async () => {
        const d = disciplinary.find(x => String(x.id) === btn.dataset.id);
        if (!d) return;
        const phone = emp.phone;
        if (!phone) return Utils.toast('No phone on your employee record', 'error');
        const waRes = await Utils.sendDisciplinaryWhatsApp(this.app, d, emp);
        if (!waRes?.success) Utils.openWhatsApp(phone, `${d.record_type} " ${d.incident_date}\n${d.description || ''}`);
      });
    });
    const openHrDoc = async (id, print = false) => {
      const r = await API.getHrDocument(parseInt(id, 10), this.hrActor(emp));
      if (!r.success || !r.data) return Utils.toast(r.error || 'Document not found', 'error');
      const html = r.data.html_content || '';
      if (!html) return Utils.toast('Document has no content yet', 'error');
      if (print) {
        const pr = await Utils.printToA4(html, r.data.title || 'HR Document');
        if (pr?.success) return;
        const preview = await API.printPreview?.(html, r.data.title || 'HR Document');
        if (preview?.success) return Utils.toast('Print preview opened', 'success');
        return Utils.toast(pr?.error || 'Could not print', 'error');
      }
      const w = window.open('', '_blank');
      if (w) {
        w.document.write(html);
        w.document.close();
        return;
      }
      Utils.showModal(r.data.title || 'HR Document', html, '');
    };
    document.getElementById('staff-open-shifts')?.addEventListener('click', () => {
      this._openMyShiftsModal(emp, myShifts, scheduleStart, scheduleEnd);
    });
    el.querySelectorAll('.hr-doc-view').forEach(btn => btn.addEventListener('click', () => openHrDoc(btn.dataset.id, false)));
    el.querySelectorAll('.hr-doc-print').forEach(btn => btn.addEventListener('click', () => openHrDoc(btn.dataset.id, true)));
    document.getElementById('my-file-upload')?.addEventListener('click', async () => {
      Utils.showModal('Upload document', `<div class="form-grid">
        <div class="field"><label>Type</label><input id="mf-type" placeholder="ID / Certificate / Other"></div>
        <div class="field"><label>Notes</label><input id="mf-notes"></div>
      </div>
      <p class="muted" style="font-size:13px">Take a photo or choose a file. Admin will see this under your employee files.</p>`,
        '<button class="btn btn-ghost" id="mf-camera">Take photo</button><button class="btn btn-primary" id="mf-pick">Choose file</button>');
      const saveFile = async (pathOrData, name) => {
        const r = await API.saveStaffDocument({
          employee_id: emp.id,
          doc_type: document.getElementById('mf-type')?.value.trim() || 'file',
          file_path: pathOrData,
          file_name: name || 'document',
          notes: document.getElementById('mf-notes')?.value.trim() || ''
        }, this.hrActor(emp));
        if (!r.success) return Utils.toast(r.error || 'Upload failed', 'error');
        Utils.hideModal();
        Utils.toast('Document uploaded — admin can see it', 'success');
        this._rerender();
      };
      document.getElementById('mf-camera')?.addEventListener('click', async () => {
        try {
          try { window.StaffPortalStandalone?.saveSession?.(emp); } catch (_) { /* ignore */ }
          const data = await (Utils.captureSelfiePhoto?.() || Utils.captureProofPhoto());
          if (!data) return;
          await saveFile(data, `photo-${Date.now()}.jpg`);
        } catch (err) {
          Utils.toast(err.message || 'Camera cancelled', 'error');
        }
      });
      document.getElementById('mf-pick')?.addEventListener('click', async () => {
        const pick = await API.selectDocument('staff-doc');
        if (pick?.cancelled) return;
        if (!pick?.success || !(pick.path || pick.data)) return Utils.toast(pick?.error || 'No file selected', 'error');
        await saveFile(pick.path || pick.data, pick.name || pick.file_name || 'document');
      });
    });
    el.querySelectorAll('.my-file-view').forEach(btn => {
      btn.addEventListener('click', async () => {
        const file = myFiles.find(x => String(x.id) === btn.dataset.id);
        if (!file?.file_path) return Utils.toast('File not found', 'error');
        if (String(file.file_path).startsWith('data:')) {
          Utils.showModal(file.file_name || file.doc_type || 'File',
            `<img src="${file.file_path}" alt="" style="width:100%;max-width:480px;border-radius:8px;display:block;margin:0 auto">`,
            '');
          return;
        }
        const img = await API.getImageDataUrl(file.file_path);
        if (img?.success && (img.dataUrl || img.data)) {
          Utils.showModal(file.file_name || file.doc_type || 'File',
            `<img src="${img.dataUrl || img.data}" alt="" style="width:100%;max-width:480px;border-radius:8px;display:block;margin:0 auto">
             ${file.notes ? `<p class="muted" style="margin-top:8px">${this._esc(file.notes)}</p>` : ''}`,
            '');
          return;
        }
        Utils.showModal(file.file_name || file.doc_type || 'File',
          `<p><strong>Type:</strong> ${this._esc(file.doc_type || 'File')}</p>
           <p><strong>Name:</strong> ${this._esc(file.file_name || '—')}</p>
           ${file.notes ? `<p class="muted">${this._esc(file.notes)}</p>` : ''}
           <p class="muted">This file is on record. Ask admin if you need a printed copy.</p>`,
          '');
      });
    });

    const routinesElLate = document.getElementById('staff-routines-panel');
    if (this.canDoRoutines(this.app, emp) && routinesElLate && routinesElLate.dataset.routinesStarted !== '1') {
      routinesElLate.dataset.routinesStarted = '1';
      this.renderStaffRoutines(routinesElLate).catch((err) => this._staffLogError('routines', err));
    }

    this._hydrateStaffAvatars(el);
    document.getElementById('eom-self-wa')?.addEventListener('click', async () => {
      const actor = this.hrActor(emp) || { employee_id: emp.id, full_name: emp.full_name, username: emp.employee_code, role: 'employee' };
      const r = await API.sendEmployeeOfMonthCertificateWhatsApp(emp.id, actor);
      if (!r.success) return Utils.toast(r.error, 'error');
      await Utils.deliverWhatsApp(r, emp.phone);
    });

    // WAVE 2 " contracts & salary claims (never blocks clock)
    (async () => {
      const deferred = el.querySelector('#staff-portal-deferred');
      if (!deferred) return;
      const [contractRes, claimRes, trainRes, probRes, evalHistRes] = await Promise.all([
        this._staffLoadSafe(API.getHrContractsForEmployee(empId, actor), 'contracts', 5000),
        this._staffLoadSafe(API.listSalaryClaims({ employee_id: empId }, actor), 'salary_claims', 5000),
        this._staffLoadSafe(API.getHrTrainingRecords({ employee_id: empId }, actor), 'training', 5000),
        this._staffLoadSafe(API.getProbations({ employee_id: empId }, actor), 'probation', 5000),
        this._staffLoadSafe(API.getProbationEvaluationHistory({ employee_id: empId }, actor), 'probation_reviews', 5000)
      ]);
      if (!this._portalAlive(seq, el)) return;
      myContracts = (contractRes.success !== false && Array.isArray(contractRes.data)) ? contractRes.data : [];
      salaryClaims = (claimRes.success !== false && Array.isArray(claimRes.data)) ? claimRes.data : [];
      const myTraining = (trainRes.success !== false && Array.isArray(trainRes.data)) ? trainRes.data : [];
      const myProbation = (probRes.success !== false && Array.isArray(probRes.data)) ? probRes.data : [];
      const myReviews = (evalHistRes.success !== false && Array.isArray(evalHistRes.data)) ? evalHistRes.data : [];
      deferred.innerHTML = `
      <div class="card" id="staff-training" style="margin-top:16px"><div class="card-body"><h4>Training</h4>
        <p class="muted" style="font-size:13px">Training records assigned to you by admin.</p>
        ${myTraining.map(t => {
          const form = t.form || {};
          const evals = t.evaluations || [];
          const st = this._trainingStatusChip(t);
          return `<div style="padding:10px 0;border-bottom:1px solid var(--border)"><strong>${this._esc(form.course_title || t.template_title || 'Training')}</strong>
            · <span class="staff-day-chip ${st.cls}">${this._esc(st.label)}</span>
            <br><small class="muted">${this._esc(t.start_date || '')}${t.expiry_date ? ` → ${this._esc(t.expiry_date)}` : ''}</small>
            ${form.trainer ? `<br><small>Trainer: ${this._esc(form.trainer)}</small>` : ''}
            ${form.venue ? `<br><small>Venue: ${this._esc(form.venue)}</small>` : ''}
            ${evals.length ? `<br><small>${evals.length} review(s) from admin</small>` : ''}
            <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
              <button class="btn btn-sm btn-primary tr-open" data-id="${t.id}">Open training</button>
              <button class="btn btn-sm btn-ghost tr-pdf" data-id="${t.id}">Download training</button>
            </div>
          </div>`;
        }).join('') || '<p class="muted">No training record yet. When admin creates your training, a button appears here.</p>'}
      </div></div>
      <div class="card" id="staff-probation" style="margin-top:16px"><div class="card-body"><h4>Probation</h4>
        <p class="muted" style="font-size:13px">Your probation contract and end date.</p>
        ${myProbation.map(p => {
          const rules = p.rules || (() => { try { return JSON.parse(p.rules_json || '{}'); } catch { return {}; } })();
          const reviews = myReviews.filter(r => Number(r.probation_id) === Number(p.id));
          const st = this._probationStatusChip(p);
          return `<div style="padding:10px 0;border-bottom:1px solid var(--border)"><strong>${this._esc(p.employee_name || emp.full_name)}</strong>
            · <span class="staff-day-chip ${st.cls}">${this._esc(st.label)}</span>
            <br><small class="muted">${this._esc(p.start_date)} → ${this._esc(p.end_date)} · ${p.duration_days || ''} days</small>
            ${rules.company_name ? `<br><small>Company: ${this._esc(rules.company_name)}</small>` : ''}
            ${rules.id_number ? `<br><small>ID: ${this._esc(rules.id_number)}</small>` : ''}
            ${rules.position ? `<br><small>Position: ${this._esc(rules.position)}</small>` : ''}
            ${reviews.length ? `<br><small>${reviews.length} admin review(s)</small>` : ''}
            <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
              <button class="btn btn-sm btn-primary pr-open" data-id="${p.id}">Open probation</button>
              <button class="btn btn-sm btn-ghost pr-pdf" data-id="${p.id}">Download probation</button>
            </div>
          </div>`;
        }).join('') || '<p class="muted">No probation record yet. When admin starts your probation, a button appears here.</p>'}
      </div></div>
      <div class="card" id="staff-contracts" style="margin-top:16px;border-color:var(--warning)"><div class="card-body"><h4>Employment Contracts</h4>
        <p class="muted" style="font-size:13px">When a contract expires, admin opens a re-sign window. Upload your documents, then sign.</p>
        ${myContracts.map(c => {
          const docs = (() => { try { return typeof c.doc_paths_json === 'string' ? JSON.parse(c.doc_paths_json || '[]') : (c.doc_paths || []); } catch { return []; } })();
          const data = (() => { try { return typeof c.contract_data_json === 'string' ? JSON.parse(c.contract_data_json || '{}') : (c.contract_data || {}); } catch { return {}; } })();
          const etype = data.employment_type || '—';
          const needsSign = ['pending_signatures', 'open'].includes(c.status) && !c.employee_signed_at;
          const windowOpen = !c.resign_opens_at || new Date() >= new Date(c.resign_opens_at);
          const windowClosed = c.resign_closes_at && new Date() > new Date(c.resign_closes_at);
          return `<div style="padding:10px 0;border-bottom:1px solid var(--border)"><strong>${Utils.escHtml(c.template_name || c.emp_position || 'Contract')}</strong>
            · <span class="tag">${this._esc(etype)}</span> · <span class="tag">${c.status}</span>
            ${data.basic_salary || data.salary_amount ? `<br><small>Pay: ${Utils.formatMoney(data.basic_salary || data.salary_amount, data.currency || currency)} · ${this._esc(data.salary_type || '')}</small>` : ''}
            ${c.expires_at ? `<br><small class="muted">Expires: ${Utils.formatDateTime(c.expires_at)}</small>` : ''}
            ${c.resign_opens_at ? `<br><small class="muted">Re-sign from: ${Utils.formatDateTime(c.resign_opens_at)}${c.resign_closes_at ? ' until ' + Utils.formatDateTime(c.resign_closes_at) : ''}</small>` : ''}
            ${docs.length ? `<br><small style="color:var(--success)">${docs.length} document(s) uploaded</small>` : ''}
            <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap"><button class="btn btn-sm btn-primary ctr-open" data-id="${c.id}">Open contract</button>
              <button class="btn btn-sm btn-ghost ctr-pdf" data-id="${c.id}">PDF</button>
              ${needsSign && windowOpen && !windowClosed ? `
                <button class="btn btn-sm btn-ghost ctr-upload" data-id="${c.id}">Upload documents</button>
                <button class="btn btn-sm btn-primary ctr-sign" data-id="${c.id}">Sign contract</button>` : ''}
              ${['expired', 'terminated'].includes(c.status) || (c.expires_at && new Date(c.expires_at) < new Date()) ? `<span class="muted" style="font-size:12px">Contract ended — ask admin to press Renew, then sign the new one here.</span>` : ''}
              ${needsSign && !windowOpen ? `<span class="muted" style="font-size:12px">Waiting for re-sign window...</span>` : ''}
              ${needsSign && windowClosed ? `<span class="muted" style="font-size:12px;color:var(--danger)">Re-sign window closed — contact admin</span>` : ''}
            </div>
          </div>`;
        }).join('') || '<p class="muted">No open contract yet. When admin creates or opens a contract, it appears here.</p>'}
      </div></div>
      <div class="card" id="staff-claims" style="margin-top:16px;border-color:var(--success)"><div class="card-body"><h4>Salary Claims &amp; Payslip Advice</h4>
        <p class="muted" style="font-size:13px">When payday opens, your payslip appears above and you can claim salary here. Admin (and HR can view) must approve the claim before payment. Download the claim PDF as your salary advice.</p>
        ${salaryClaims.length ? salaryClaims.map(cl => {
          const canClaim = ['open', 'rejected'].includes(cl.status)
            && (!cl.claim_opens_at || new Date() >= new Date(cl.claim_opens_at))
            && (!cl.claim_deadline || new Date() <= new Date(cl.claim_deadline));
          return `<div style="padding:10px 0;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px"><span><strong>${cl.period_start} — ${cl.period_end}</strong><br>
              <small>Net ${Utils.formatMoney(cl.amount || cl.net_amount, currency)} · <span class="tag">${cl.status}</span></small>
              <br><small class="muted">Claim by: ${Utils.formatDateTime(cl.claim_deadline)}${cl.payment_date ? ' · Pay date: ' + cl.payment_date : ''}</small>
            </span>
            <span style="display:flex;gap:4px;flex-wrap:wrap">
              ${canClaim ? `<button class="btn btn-sm btn-primary sc-claim" data-id="${cl.id}">Claim salary</button>` : ''}
              ${['approved','paid','claimed','open'].includes(cl.status) ? `<button class="btn btn-sm btn-ghost sc-pdf" data-id="${cl.id}">Advice PDF</button>` : ''}
            </span>
          </div>`;
        }).join('') : '<p class="muted">No open salary claim yet. When admin opens payday, it appears here.</p>'}
      </div></div>
`;
      const alertBox = el.querySelector('#staff-portal-alerts');
      if (alertBox) {
        const alertData = {
          leaves, payroll, disciplinary, hrDocs, hrSubmissions,
          training: myTraining, probation: myProbation, contracts: myContracts, claims: salaryClaims,
          mgrHrCases
        };
        this._lastStaffAlertData = { ...this._lastStaffAlertData, ...alertData };
        alertBox.innerHTML = this._staffAlertsHtml(this._staffAlertItems(alertData));
        this._bindStaffAlerts(el);
      }
      const openClaim = salaryClaims.find(cl => ['open', 'rejected'].includes(cl.status)
        && (!cl.claim_opens_at || new Date() >= new Date(cl.claim_opens_at))
        && (!cl.claim_deadline || new Date() <= new Date(cl.claim_deadline)));
      if (openClaim && !sessionStorage.getItem(`claim-popup-${openClaim.id}`)) {
        sessionStorage.setItem(`claim-popup-${openClaim.id}`, '1');
        Utils.showModal('Salary claim is open', `
          <p style="font-size:18px;font-weight:700;margin:0 0 8px">It is time to claim your salary</p>
          <p class="muted">Period ${openClaim.period_start} – ${openClaim.period_end}. Claim by ${Utils.formatDateTime(openClaim.claim_deadline)}${openClaim.payment_date ? ` · Pay date ${openClaim.payment_date}` : ''}.</p>`,
          '<button class="btn btn-primary" id="sc-popup-go">Go to claim</button>');
        document.getElementById('sc-popup-go')?.addEventListener('click', () => {
          Utils.hideModal();
          document.getElementById('staff-claims')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      }
      deferred.querySelectorAll('.tr-open').forEach(btn => btn.addEventListener('click', () => {
        const t = myTraining.find(x => Number(x.id) === Number(btn.dataset.id));
        if (!t) return;
        const form = t.form || {};
        const evals = t.evaluations || [];
        Utils.showModal(form.course_title || t.template_title || 'Training', `
          <p><strong>Status:</strong> ${this._esc(t.status)} · ${this._esc(t.start_date || '')}${t.expiry_date ? ` → ${this._esc(t.expiry_date)}` : ''}</p>
          ${form.trainer ? `<p>Trainer: ${this._esc(form.trainer)}</p>` : ''}
          ${form.venue ? `<p>Venue: ${this._esc(form.venue)}</p>` : ''}
          ${form.duties ? `<p>${this._esc(form.duties)}</p>` : ''}
          <h4>Admin reviews</h4>
          ${evals.length ? evals.map(ev => `<div style="padding:8px 0;border-bottom:1px solid var(--border)"><strong>${this._esc(ev.date || ev.eval_date || '')}</strong>
            <br><small>${this._esc(ev.notes || '')}</small>
            ${(ev.items || []).length ? `<br><small>${(ev.items || []).map(it => this._esc(typeof it === 'string' ? it : it.task)).join('; ')}</small>` : ''}
          </div>`).join('') : '<p class="muted">No review yet. When admin saves an evaluation, it appears here.</p>'}`,
          '<button class="btn btn-primary" id="tr-open-ok">Close</button>');
        document.getElementById('tr-open-ok')?.addEventListener('click', () => Utils.hideModal());
      }));
      deferred.querySelectorAll('.tr-pdf').forEach(btn => btn.addEventListener('click', async () => {
        await Utils.savePdfBuffer(`training-${btn.dataset.id}.pdf`, await API.getHrTrainingEvalPdf(parseInt(btn.dataset.id, 10), this.hrActor(emp)));
      }));
      deferred.querySelectorAll('.pr-open').forEach(btn => btn.addEventListener('click', () => {
        const p = myProbation.find(x => Number(x.id) === Number(btn.dataset.id));
        if (!p) return;
        const reviews = myReviews.filter(r => Number(r.probation_id) === Number(p.id));
        Utils.showModal('Probation', `
          <p><strong>Status:</strong> ${this._esc(p.status)} · ${this._esc(p.start_date)} → ${this._esc(p.end_date)}</p>
          <h4>Admin reviews</h4>
          ${reviews.length ? reviews.map(ev => `<div style="padding:8px 0;border-bottom:1px solid var(--border)"><strong>${this._esc(ev.eval_date || ev.created_at || '')}</strong>
            ${ev.overall_score != null ? ` · Score ${this._esc(ev.overall_score)}` : ''}
            <br><small>${this._esc(ev.comments || ev.notes || '')}</small>
          </div>`).join('') : '<p class="muted">No review yet. When admin evaluates you, it appears here.</p>'}`,
          '<button class="btn btn-primary" id="pr-open-ok">Close</button>');
        document.getElementById('pr-open-ok')?.addEventListener('click', () => Utils.hideModal());
      }));
      deferred.querySelectorAll('.pr-pdf').forEach(btn => btn.addEventListener('click', async () => {
        await Utils.savePdfBuffer(`probation-${btn.dataset.id}.pdf`, await API.getProbationPdf(parseInt(btn.dataset.id, 10), this.hrActor(emp)));
      }));
      deferred.querySelectorAll('.ctr-open').forEach(btn => btn.addEventListener('click', () => {
        const c = myContracts.find(x => Number(x.id) === Number(btn.dataset.id));
        if (!c) return;
        const data = (() => { try { return typeof c.contract_data_json === 'string' ? JSON.parse(c.contract_data_json || '{}') : (c.contract_data || {}); } catch { return {}; } })();
        Utils.showModal(c.template_name || 'Employment contract', `
          <p><strong>Status:</strong> ${this._esc(c.status)}</p>
          <p>${this._esc(data.employment_type || '')} · ${this._esc(data.start_date || '')}${data.end_date ? ` → ${this._esc(data.end_date)}` : ''}</p>
          ${c.expires_at ? `<p class="muted">Expires ${Utils.formatDateTime(c.expires_at)}</p>` : ''}
          <p class="muted">If this contract ended, admin presses Renew on Contracts &amp; Probation. The new contract then appears here for you to sign.</p>`,
          '<button class="btn btn-primary" id="ctr-open-ok">Close</button>');
        document.getElementById('ctr-open-ok')?.addEventListener('click', () => Utils.hideModal());
      }));
      deferred.querySelectorAll('.ctr-pdf').forEach(btn => btn.addEventListener('click', async () => {
        await Utils.savePdfBuffer(`contract-${btn.dataset.id}.pdf`, await API.getHrContractPdf(parseInt(btn.dataset.id, 10), this.hrActor(emp)));
      }));
      deferred.querySelectorAll('.ctr-upload').forEach(btn => btn.addEventListener('click', async () => {
        const pick = await API.selectDocument('doc');
        if (!pick.success || !pick.path) return;
        const r = await API.attachHrContractDoc(parseInt(btn.dataset.id, 10), pick.path, pick.name || pick.fileName || 'document', this.hrActor(emp));
        if (!r.success) return Utils.toast(r.error || 'Upload failed', 'error');
        Utils.toast('Document uploaded for re-sign', 'success');
        this._rerender();
      }));
      deferred.querySelectorAll('.ctr-sign').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = parseInt(btn.dataset.id, 10);
          Utils.showModal('Sign employment contract', `
            <p class="muted">Draw your signature below (documents must be uploaded first if this is a re-sign).</p>
            <canvas id="ctr-sig-pad" width="400" height="160" style="width:100%;max-width:400px;border:1px solid var(--border);border-radius:8px;touch-action:none;background:#fff"></canvas>
            <div style="margin-top:8px"><button type="button" class="btn btn-ghost btn-sm" id="ctr-sig-clear">Clear</button></div>`,
            '<button class="btn btn-primary" id="ctr-sig-save">Save signature</button>');
          const canvas = document.getElementById('ctr-sig-pad');
          const ctx = canvas.getContext('2d');
          ctx.strokeStyle = '#111';
          ctx.lineWidth = 2;
          let drawing = false;
          const pos = (e) => {
            const r = canvas.getBoundingClientRect();
            const t = e.touches?.[0] || e;
            return { x: (t.clientX - r.left) * (canvas.width / r.width), y: (t.clientY - r.top) * (canvas.height / r.height) };
          };
          const start = (e) => { e.preventDefault(); drawing = true; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); };
          const move = (e) => { if (!drawing) return; e.preventDefault(); const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); };
          const endDraw = () => { drawing = false; };
          canvas.addEventListener('mousedown', start);
          canvas.addEventListener('mousemove', move);
          canvas.addEventListener('mouseup', endDraw);
          canvas.addEventListener('mouseleave', endDraw);
          canvas.addEventListener('touchstart', start, { passive: false });
          canvas.addEventListener('touchmove', move, { passive: false });
          canvas.addEventListener('touchend', endDraw);
          document.getElementById('ctr-sig-clear')?.addEventListener('click', () => ctx.clearRect(0, 0, canvas.width, canvas.height));
          document.getElementById('ctr-sig-save')?.addEventListener('click', async () => {
            const blank = document.createElement('canvas');
            blank.width = canvas.width; blank.height = canvas.height;
            if (canvas.toDataURL() === blank.toDataURL()) return Utils.toast('Please sign first', 'error');
            const r = await API.signHrContract(id, 'employee', canvas.toDataURL('image/png'), this.hrActor(emp));
            if (!r.success) return Utils.toast(r.error || 'Sign failed', 'error');
            Utils.hideModal();
            Utils.toast('Contract signed', 'success');
            this._rerender();
          });
        });
      });
      deferred.querySelectorAll('.sc-claim').forEach(btn => btn.addEventListener('click', async () => {
        const id = parseInt(btn.dataset.id, 10);
        Utils.showModal('Claim salary', `
          <p class="muted">Confirm you want to claim this salary period. Admin must approve before payment.</p>
          <div class="field"><label>Notes (optional)</label><input id="sc-notes" placeholder="e.g. bank details confirmed"></div>`,
          '<button class="btn btn-primary" id="sc-claim-go">Submit claim</button>');
        document.getElementById('sc-claim-go')?.addEventListener('click', async () => {
          const notes = document.getElementById('sc-notes')?.value.trim() || '';
          const r = await API.claimSalary(id, notes, this.hrActor(emp));
          if (!r.success) return Utils.toast(r.error || 'Claim failed', 'error');
          Utils.hideModal();
          Utils.toast('Salary claim submitted', 'success');
          this._rerender();
        });
      }));
      deferred.querySelectorAll('.sc-pdf').forEach(btn => btn.addEventListener('click', async () => {
        await Utils.savePdfBuffer(`salary-claim-${btn.dataset.id}.pdf`, await API.getSalaryClaimPdf(parseInt(btn.dataset.id, 10), this.hrActor(emp)));
      }));
      deferred.querySelectorAll('.staff-section-retry').forEach(btn => {
        btn.addEventListener('click', () => this._rerender());
      });
    })().catch((err) => this._staffLogError('deferred_contracts_claims', err));
    } catch (phase2Err) {
      this._staffLogError('phase2', phase2Err);
      const secondary = el.querySelector('#staff-portal-secondary');
      if (secondary) {
        secondary.innerHTML = `<div class="card" style="padding:16px;margin-top:12px"><p class="error-msg">${this._esc(phase2Err?.message || 'Could not load portal sections')}</p>
          <button type="button" class="btn btn-primary staff-section-retry">Retry</button>
        </div>`;
        secondary.querySelectorAll('.staff-section-retry').forEach(btn => {
          btn.addEventListener('click', () => this._rerender());
        });
      }
    }
  },

  async renderStaffRoutines(el) {
    const showMorning = this.canShowMorningRoutines(this.app);
    const showClosing = this.canShowClosingRoutines(this.app);
    if (!showMorning && !showClosing) {
      el.innerHTML = '';
      return;
    }
    if (!this._routineTab || (this._routineTab === 'opening' && !showMorning) || (this._routineTab === 'closing' && !showClosing)) {
      this._routineTab = showMorning ? 'opening' : 'closing';
    }
    const tabButtons = [
      showMorning ? `<button type="button" class="form-tab ${this._routineTab === 'opening' ? 'active' : ''}" data-rtab="opening">Morning Tasks</button>` : '',
      showClosing ? `<button type="button" class="form-tab ${this._routineTab === 'closing' ? 'active' : ''}" data-rtab="closing">Closing Tasks</button>` : ''
    ].filter(Boolean).join('');
    el.innerHTML = `<div class="card" style="border:2px solid var(--primary)"><div class="card-body"><h4>Today's Assigned Tasks</h4>
      <p class="muted">Admin assigns these in Operations -> Morning/Closing. Tick every checkbox, then <strong>Submit to Admin</strong>.</p>
      <div class="form-tabs" id="staff-routine-tabs">${tabButtons}</div>
      <div id="staff-routine-content"><p class="muted">Loading...</p></div>
    </div></div>`;

    el.querySelector('#staff-routine-tabs')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-rtab]');
      if (!btn) return;
      this._routineTab = btn.dataset.rtab;
      this.renderStaffRoutines(el);
    });

    await this.renderStaffRoutineTab(document.getElementById('staff-routine-content'), this._routineTab);
  },

  staffRoutineActor(employeeId) {
    const empId = employeeId != null ? employeeId : this.employee?.id;
    if (this.app?.user?.id) return { ...this.app.user, employee_id: empId };
    return this.hrActor(this.employee) || {
      id: this.employee?.user_id || null,
      employee_id: empId,
      full_name: this.employee?.full_name,
      username: this.employee?.employee_code || this.employee?.full_name,
      role: 'employee'
    };
  },

  async renderStaffRoutineTab(el, type) {
    const label = type === 'opening' ? 'Morning Tasks' : 'Closing Tasks';
    const employeeId = this.employee?.id != null ? Number(this.employee.id) : null;
    const empIdOk = Number.isFinite(employeeId) ? employeeId : null;
    const tplFn = type === 'opening' ? API.getOpeningChecklistTemplates : API.getClosingChecklistTemplates;
    const [runsRes, settingsRes, tplRes] = await Promise.all([
      API.getChecklistRuns({
        run_type: type,
        run_date: Utils.today(),
        ...(empIdOk != null ? { employee_id: empIdOk } : {})
      }),
      API.getChecklistSettings(),
      tplFn()
    ]);
    const runs = (runsRes.data || []).filter(r => r.status !== 'cancelled');
    const allTemplates = tplRes.data || [];
    const myTemplates = allTemplates.filter(t => {
      const assigned = t.assigned_employee_id != null && t.assigned_employee_id !== ''
        ? Number(t.assigned_employee_id) : null;
      return assigned == null || (empIdOk != null && assigned === empIdOk);
    });
    const intervalKey = type === 'opening' ? 'morning_checkbox_interval_minutes' : 'closing_checkbox_interval_minutes';
    const intervalMin = Number(settingsRes.data?.[intervalKey]) || 0;
    let activeRun = this._staffRoutineRun?.run_type === type ? this._staffRoutineRun : null;
    if (!activeRun && runs[0]) {
      const r = await API.getChecklistRun(runs[0].id);
      if (r.success) activeRun = r.data;
    }
    // Auto-start today's run so Any worker + assigned tasks show as checkboxes.
    let loadError = null;
    if ((!activeRun || (activeRun.status === 'failed' && !(activeRun.items || []).length))
        && empIdOk != null && myTemplates.length) {
      const r = await API.startChecklistRun(
        { run_type: type, employee_id: empIdOk, run_date: Utils.today() },
        this.staffRoutineActor(empIdOk)
      );
      if (r.success) {
        activeRun = r.data;
        this._staffRoutineRun = r.data;
      } else {
        loadError = r.error || 'Could not load today\'s tasks';
      }
    }
    const isFailed = activeRun?.status === 'failed';
    const canEdit = activeRun && activeRun.status === 'in_progress';
    const items = activeRun?.items || [];
    const allDone = items.length > 0 && items.every(i => i.item_status === 'done' || i.item_status === 'skipped' || (!i.item_status && i.completed));
    const deadlineKey = type === 'opening' ? 'morning_deadline' : 'closing_deadline';
    const deadline = settingsRes.data?.[deadlineKey] || (type === 'opening' ? '11:00' : '22:00');
    const nowHHMM = `${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}`;
    const pastDeadline = nowHHMM >= deadline;
    const canSubmit = canEdit && allDone && !pastDeadline;
    const emptyMsg = loadError
      || (myTemplates.length
        ? 'Could not start your task list. Tap Start to try again.'
        : `No ${type === 'opening' ? 'morning' : 'closing'} tasks are assigned to you. Ask admin to assign tasks to your name (or "Any worker").`);

    el.innerHTML = `
      <h4 style="margin-top:12px">${label}</h4>
      <p class="muted" style="margin:4px 0 0">Tick <strong>every</strong> task checkbox, then submit before <strong>${deadline}</strong>.${intervalMin > 0 ? ` Wait <strong>${intervalMin} min</strong> between checkboxes.` : ''} After the deadline you cannot submit " it is recorded as failed and affects Employee of the Month.</p>
      ${canEdit && pastDeadline ? `<p style="color:var(--danger);margin:8px 0 0">Deadline ${deadline} has passed " submit is locked.</p>` : ''}
      ${canEdit && !allDone ? `<p class="muted" style="margin:8px 0 0">Submit unlocks when all ${items.length} checkbox(es) are done (${items.filter(i => i.item_status === 'done' || (!i.item_status && i.completed)).length}/${items.length}).</p>` : ''}
      <div style="display:flex;gap:8px;margin:12px 0;flex-wrap:wrap">${!activeRun || activeRun.status === 'confirmed' || (isFailed && !(activeRun.items || []).length) ? `<button class="btn btn-primary btn-sm" id="sr-start">Start Today's Tasks</button>` : ''}
        ${canEdit ? `<button class="btn btn-success btn-sm" id="sr-submit" ${canSubmit ? '' : 'disabled title="Complete all checkboxes before the deadline"'}>Submit to Admin</button>` : ''}
        ${activeRun ? `<button class="btn btn-ghost btn-sm" id="sr-pdf">PDF</button>
          <button class="btn btn-ghost btn-sm" id="sr-print">Print</button>` : ''}
      </div>
      ${activeRun ? `<p><strong>Status:</strong> ${activeRun.status}
        ${activeRun.submitted_at ? ` · Submitted ${Utils.formatDateTime(activeRun.submitted_at)}` : ''}
        ${isFailed ? ` · <span style="color:var(--danger)">${Utils.escHtml(activeRun.failure_reason || 'Failed " deadline missed')}</span>` : ''}</p>
        ${(activeRun.items || []).map(i => {
          const done = i.item_status === 'done' || (!i.item_status && i.completed);
          const locked = activeRun.status === 'submitted' || activeRun.status === 'confirmed' || isFailed;
          return `<label style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);cursor:${canEdit && !locked ? 'pointer' : 'default'}"><input type="checkbox" class="sr-check" data-id="${i.id}" ${done ? 'checked' : ''} ${!canEdit || locked || done ? 'disabled' : ''} style="width:18px;height:18px;accent-color:var(--success)">
            <span style="flex:1">${i.task_name}</span>
            ${done ? `<small class="muted">${i.employee_name || ''}${i.comments ? ` " ${i.comments}` : ''}</small>` : ''}
          </label>`;
        }).join('') || '<p class="muted">This run has no tasks.</p>'}` : `<p class="muted">${emptyMsg}</p>
        ${!activeRun && myTemplates.length ? `<div style="margin-top:8px">${myTemplates.map(t => `<label style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);opacity:0.7"><input type="checkbox" disabled style="width:18px;height:18px"><span>${t.task_name}</span>
            <small class="muted">${t.assigned_employee_id ? '' : 'Any worker'}</small>
          </label>`).join('')}</div>` : ''}`}`;

    document.getElementById('sr-start')?.addEventListener('click', async () => {
      const payload = { run_type: type, run_date: Utils.today() };
      if (empIdOk != null) payload.employee_id = empIdOk;
      const r = await API.startChecklistRun(payload, this.staffRoutineActor(empIdOk));
      if (r.success) { this._staffRoutineRun = r.data; this.renderStaffRoutineTab(el, type); }
      else Utils.toast(r.error, 'error');
    });
    document.getElementById('sr-submit')?.addEventListener('click', async () => {
      if (pastDeadline) return Utils.toast(`Deadline ${deadline} has passed " cannot submit`, 'error');
      if (!allDone) return Utils.toast('Tick every task checkbox before submitting', 'error');
      const r = await API.submitChecklistRun(activeRun.id, this.staffRoutineActor(empIdOk));
      if (r.success) {
        Utils.toast('Submitted to admin', 'success');
        this._staffRoutineRun = r.data;
        this.renderStaffRoutineTab(el, type);
      } else Utils.toast(r.error, 'error');
    });
    document.getElementById('sr-pdf')?.addEventListener('click', async () => {
      await Utils.savePdfBuffer(`${type}-routine-${Utils.today()}.pdf`, await API.getChecklistReportPdf(activeRun.id));
    });
    document.getElementById('sr-print')?.addEventListener('click', async () => {
      await Utils.printToA4(await API.getChecklistReportPdf(activeRun.id), `${type}-routine.pdf`);
    });
    el.querySelectorAll('.sr-check').forEach(cb => cb.addEventListener('change', async () => {
      if (!cb.checked) { cb.checked = true; return; }
      const r = await API.completeChecklistItem(parseInt(cb.dataset.id, 10), { item_status: 'done', comments: '' }, this.staffRoutineActor(empIdOk));
      if (!r.success) {
        cb.checked = false;
        return Utils.toast(r.error || 'Could not tick task', 'error');
      }
      this._staffRoutineRun = null;
      this.renderStaffRoutineTab(el, type);
    }));
  },

  showLeaveForm(leaveTypes = ['Annual Leave', 'Sick Leave', 'Family Responsibility', 'Unpaid Leave'], portalSettings = {}) {
    const minNotice = portalSettings.min_leave_notice_days || 0;
    const leaveOpen = portalSettings.leave_requests_open !== false;
    const isSick = (t) => /sick/i.test(t || '');
    const defaultTypes = leaveOpen ? leaveTypes : leaveTypes.filter(isSick);
    if (!defaultTypes.length) {
      return Utils.toast('Leave requests are closed. Contact admin " only sick leave is accepted when closed.', 'error');
    }
    Utils.showModal('Request Leave', `
      <div class="form-grid">${!leaveOpen ? `<p class="muted full" style="color:var(--warning)">Leave portal is closed. Only sick leave can be submitted.</p>` : ''}
        <div class="field"><label>Leave Type</label>
          <select id="sl-type">${defaultTypes.map(t => `<option>${t}</option>`).join('')}</select></div>
        <div class="field"><label>Start Date</label><input type="date" id="sl-start" value="${Utils.today()}"></div>
        <div class="field"><label>End Date</label><input type="date" id="sl-end" value="${Utils.today()}"></div>
        <div class="field"><label>Days</label><input type="number" id="sl-days" min="0.5" step="0.5" value="1"></div>
        <div class="field full"><label>Notes</label><input id="sl-notes"></div>
        ${minNotice ? `<p class="muted full">Minimum ${minNotice} day(s) notice required for non-sick leave.</p>` : ''}
        ${(portalSettings.active_blackouts || []).length ? `<p class="muted full">Some dates are blocked by admin " sick leave is exempt.</p>` : ''}
      </div>`,
      '<button class="btn btn-primary" id="sl-save">Submit Request</button>');
    document.getElementById('sl-save').addEventListener('click', async () => {
      const leaveType = document.getElementById('sl-type').value;
      const start = document.getElementById('sl-start').value;
      if (minNotice && !isSick(leaveType)) {
        const diff = (new Date(start + 'T12:00:00') - new Date()) / 86400000;
        if (diff < minNotice) return Utils.toast(`Leave must be requested at least ${minNotice} day(s) in advance`, 'error');
      }
      const r = await API.saveStaffLeave({
        employee_id: this.employee.id,
        leave_type: leaveType,
        start_date: start,
        end_date: document.getElementById('sl-end').value,
        days: parseFloat(document.getElementById('sl-days').value) || 1,
        notes: document.getElementById('sl-notes').value.trim()
      });
      if (!r.success) return Utils.toast(r.error, 'error');
      Utils.hideModal();
      Utils.toast(r.data?.status === 'approved' ? 'Leave approved' : 'Leave request submitted', 'success');
      this._rerender();
    });
  }
};
window.StaffPage = StaffPage;

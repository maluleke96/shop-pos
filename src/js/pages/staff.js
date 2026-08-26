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
      <label class="portal-switch">
        <span>
          <strong>${title}</strong>
          ${hint ? `<small class="muted">${hint}</small>` : ''}
        </span>
        <input type="checkbox" id="${id}" ${checked ? 'checked' : ''}>
        <span class="portal-switch-state">${checked ? 'ON' : 'OFF'}</span>
      </label>`;
    return `<div class="portal-vis-card" id="portal-vis-card">
      <h4 style="margin:0 0 4px">Turn staff portal sections ON or OFF</h4>
      <p class="muted" style="margin:0 0 12px">Use these switches for morning routines, closing routines, shift schedule, and whether a shift is required to clock in. Staff only see what is ON.</p>
      ${row('sp-set-routines', on('show_routines'), 'Routines (master switch)', 'Off hides both morning and closing from staff')}
      ${row('sp-set-morning', on('show_morning_routines'), 'Morning opening routines', 'Show morning tasks on the staff portal')}
      ${row('sp-set-closing', on('show_closing_routines'), 'Closing routines', 'Show closing tasks on the staff portal')}
      ${row('sp-set-shifts', on('show_shifts'), 'Show shift schedule', 'Hide the My Shifts list from staff')}
      ${row('sp-set-require-shift', on('require_scheduled_shift'), 'Require assigned shift to clock in', 'Off = staff can clock in/out even without a shift')}
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
    return {
      ...(base || {}),
      show_routines: !!g('sp-set-routines')?.checked,
      show_morning_routines: !!g('sp-set-morning')?.checked,
      show_closing_routines: !!g('sp-set-closing')?.checked,
      show_shifts: !!g('sp-set-shifts')?.checked,
      require_scheduled_shift: !!g('sp-set-require-shift')?.checked
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

  canShowShifts(app) {
    return this.portalSettings(app).show_shifts !== false;
  },

  /** Actor for HR APIs â€” supports POS login user OR standalone portal employee */
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

  canAccessRecruitment(app) {
    const role = app.user?.role;
    return !!role && !['cashier', 'marketing_agent'].includes(role)
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
      if (showEmployees || app.user?.role !== 'cashier') tabs.push(['employees', 'ðŸ‘· Employee Portal']);
      if (canRecruit) tabs.push(['recruitment', 'ðŸ’¼ Recruitment']);
      if (canOwnerSalary) tabs.push(['owner-salary', 'ðŸ’¼ Owner Salary']);
      if (!this.staffTab || !tabs.find(t => t[0] === this.staffTab)) {
        this.staffTab = app.user?.role === 'cashier' && canOwnerSalary ? 'owner-salary' : (tabs[0]?.[0] || 'employees');
      }
      el.innerHTML = `<div class="form-tabs" id="staff-main-tabs" style="margin-bottom:16px">${tabs.map(([id, label]) =>
        `<button type="button" class="form-tab ${this.staffTab === id ? 'active' : ''}" data-tab="${id}">${label}</button>`).join('')}</div>
        <div id="staff-main-content"></div>`;
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
      if (this.staffTab === 'owner-salary') return StaffOwnerSalaryPage.render(inner, app);
      if (this.staffTab === 'recruitment' && window.AdminRecruitmentPage) {
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
    const needSelfie = this.pendingSelfie && !this._adminOverride && !!window.StaffSelfieCapture?.selfieRequired?.();
    if (this.pendingSelfie && !needSelfie) this.pendingSelfie = false;
    if (needSelfie) return StaffSelfieCapture.render(el, this.employee, (emp) => {
      this.employee = emp;
      this.pendingSelfie = false;
      this._rerender();
    });
    return this.renderWorkerPanel(el);
  },

  async renderAdminHub(el) {
    const ps = this.app.settings?.staff_portal_settings || {};
    const search = this._hubSearch || '';
    const paintSettings = () => `<div class="admin-section">
      <div class="page-toolbar" style="margin-bottom:12px">
        <h3 style="margin:0">ðŸ‘· Staff Portal</h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" class="btn btn-primary" id="sp-hub-hr">Manage Staff &amp; HR</button>
          <button type="button" class="btn btn-ghost" id="sp-hub-worker-login">Sign in as employee</button>
        </div>
      </div>
      <p class="muted">Open any workerâ€™s portal without their PIN. Change what staff see below.</p>
      ${this.portalToggleHtml(ps)}
      <div class="card" style="margin:16px 0"><div class="card-body">
        <h4>More portal settings</h4>
        <div class="form-grid">
          <div class="field full"><label><input type="checkbox" id="sp-set-selfie" ${ps.require_login_selfie ? 'checked' : ''}> Require verification selfie before workers enter</label></div>
          <div class="field full"><label><input type="checkbox" id="sp-set-leave" ${ps.leave_requests_open !== false ? 'checked' : ''}> Leave requests open (sick leave always allowed)</label></div>
          <div class="field full"><label><input type="checkbox" id="sp-set-disc" ${ps.show_disciplinary !== false ? 'checked' : ''}> Show disciplinary / warnings on portal</label></div>
          <div class="field full"><label><input type="checkbox" id="sp-set-pay" ${ps.show_payslips !== false ? 'checked' : ''}> Show payslips on portal</label></div>
          <div class="field full"><label><input type="checkbox" id="sp-set-dresp" ${ps.require_disciplinary_response !== false ? 'checked' : ''}> Require worker response on disciplinary records</label></div>
          <div class="field full"><label><input type="checkbox" id="sp-set-approval" ${ps.leave_requires_approval !== false ? 'checked' : ''}> Leave requests require admin approval</label></div>
          <div class="field full"><label><input type="checkbox" id="sp-set-hrdocs" ${ps.show_hr_docs !== false ? 'checked' : ''}> Show HR documents on portal</label></div>
          <div class="field full"><label><input type="checkbox" id="sp-set-rules" ${ps.show_company_rules !== false ? 'checked' : ''}> Show company rules on portal</label></div>
        </div>
        <button type="button" class="btn btn-primary" id="sp-save-settings" style="margin-top:12px">Save portal settings</button>
      </div></div>
      <div class="card"><div class="card-body">
        <h4>Open an employee portal</h4>
        <div id="sp-hub-emp-wrap"><p class="muted">Loading employeesâ€¦</p></div>
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
        show_disciplinary: !!document.getElementById('sp-set-disc')?.checked,
        show_payslips: !!document.getElementById('sp-set-pay')?.checked,
        require_disciplinary_response: !!document.getElementById('sp-set-dresp')?.checked,
        leave_requires_approval: !!document.getElementById('sp-set-approval')?.checked,
        show_hr_docs: !!document.getElementById('sp-set-hrdocs')?.checked,
        show_company_rules: !!document.getElementById('sp-set-rules')?.checked,
        ...this.collectPortalToggles()
      };
      const r = await API.saveJsonSetting('staff_portal_settings', data, this.app.user);
      if (!r.success) return Utils.toast(r.error || 'Could not save', 'error');
      this.app.settings = { ...this.app.settings, staff_portal_settings: data };
      if (window.AdminPage?.settings) AdminPage.settings.staff_portal_settings = data;
      try { window.DataCache?.invalidate?.('settings'); } catch (_) { /* ignore */ }
      this.bindPortalToggleStates(el);
      Utils.toast('Portal settings saved â€” staff see these immediately', 'success');
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
    empWrap.innerHTML = `<div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0">
        <input type="search" id="sp-hub-search" placeholder="Search employeesâ€¦" value="${Utils.escHtml(search)}" style="flex:1;min-width:200px;padding:8px;border-radius:8px;border:1px solid var(--border)">
      </div>
      <div class="table-wrap"><table><thead><tr><th>ID</th><th>Name</th><th>Position</th><th>Status</th><th></th></tr></thead>
        <tbody>${emps.map(e => `<tr>
          <td>${Utils.escHtml(e.employee_code || '')}</td>
          <td><strong>${Utils.escHtml(e.full_name || '')}</strong></td>
          <td>${Utils.escHtml(e.position || 'â€”')}</td>
          <td>${Utils.escHtml(e.status || 'â€”')}</td>
          <td class="actions">
            <button type="button" class="btn btn-sm btn-primary sp-open-emp" data-id="${e.id}">Open portal</button>
            <button type="button" class="btn btn-sm btn-ghost sp-edit-emp" data-id="${e.id}">Edit in HR</button>
          </td>
        </tr>`).join('') || '<tr><td colspan="5" class="muted">No employees yet â€” add them in Staff &amp; HR</td></tr>'}
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
    el.innerHTML = `<div class="staff-gate card" style="max-width:480px;margin:40px auto;padding:32px;text-align:center">
      <h2>ðŸ‘· Staff Portal</h2>
      <p class="muted">Your user account is not linked to an employee profile.</p>
      <p><strong>Ask admin to link your user account to your employee profile</strong> (Admin â†’ Staff â†’ edit employee â†’ User Account).</p>
      <button class="btn btn-ghost" id="staff-retry-link" style="margin-top:16px">Check Again</button>
    </div>`;
    document.getElementById('staff-retry-link').addEventListener('click', () => this._rerender());
  },

  renderSupervisorGate(el) {
    el.innerHTML = `<div class="staff-gate card" style="max-width:420px;margin:40px auto;padding:32px;text-align:center">
      <h2>ðŸ‘· Staff Portal</h2>
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
    Utils.toast(codeRes.error || 'Invalid supervisor PIN â€” ask manager for today\'s code', 'error');
  },

  renderWorkerLogin(el) {
    el.innerHTML = `<div class="staff-gate card" style="max-width:420px;margin:40px auto;padding:32px">
      <h2 style="text-align:center">Employee Sign In</h2>
      <p class="muted" style="text-align:center">Enter your Employee ID and secret PIN, or ask admin to link your POS user to your employee profile.</p>
      <div class="field"><label>Employee ID</label><input id="staff-emp-code" placeholder="EMP0001" autofocus></div>
      <div class="field"><label>PIN</label><input type="password" id="staff-emp-pin" maxlength="12" inputmode="numeric"></div>
      <button class="btn btn-primary btn-lg" id="staff-emp-login" style="width:100%">Sign In</button>
      ${this.isStaffAdmin(this.app) ? `<button class="btn btn-ghost btn-sm" id="staff-back-hub-login" style="width:100%;margin-top:8px">â† Back to employee list</button>` : ''}
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
    if (!code || !pin) return Utils.toast('Employee ID and PIN required', 'error');
    const r = await API.staffLogin(code, pin);
    if (!r.success) return Utils.toast(r.error || 'Login failed', 'error');
    this.employee = r.data;
    // Do not retain raw PIN â€” staff:login already established pinVerified session
    this.employeePin = null;
    this.pendingSelfie = !!window.StaffSelfieCapture?.selfieRequired?.();
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
    return `<div class="staff-section-error" style="padding:10px;margin:8px 0;border:1px dashed var(--border);border-radius:8px;background:var(--bg-secondary,rgba(0,0,0,.03))">
      <p class="error-msg" style="margin:0 0 8px">${this._esc(label)} could not be loaded. Retry.</p>
      <button type="button" class="btn btn-sm btn-primary staff-section-retry">Retry</button>
    </div>`;
  },

  async _staffSignOut() {
    try { await API.staffLogout?.(); } catch (_) { /* ignore */ }
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
      return `<div class="staff-portal-avatar" style="width:${px}px;height:${px}px;border-radius:50%;background:var(--border);display:inline-flex;align-items:center;justify-content:center;font-size:${Math.round(px * 0.45)}px;flex-shrink:0">ðŸ‘¤</div>`;
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
          cell.textContent = 'ðŸ‘¤';
        }
      } catch (_) {
        cell.textContent = 'ðŸ‘¤';
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
    el.innerHTML = `<div class="staff-worker">
      <div class="page-toolbar" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        ${this._staffAvatarHtml(emp, 48)}
        <h3 style="margin:0;flex:1">ðŸ‘· ${this._esc(emp.full_name)}</h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${this._adminOverride ? `<button class="btn btn-ghost" id="staff-back-hub">â† All employees</button>
            <button class="btn btn-ghost" id="staff-goto-hr">Edit in Staff &amp; HR</button>` : ''}
          <button class="btn btn-ghost" id="staff-logout-worker">${this._adminOverride ? 'Close portal' : 'Sign Out'}</button>
        </div></div>
      ${this._adminOverride ? `<div class="card" style="margin-bottom:12px;border-color:var(--primary)"><div class="card-body">
        <strong>Admin view</strong> â€” you are in ${this._esc(emp.full_name)}â€™s Staff Portal.
      </div></div>` : ''}
      <div class="stats-grid" id="staff-clock-stats">
        <div class="stat-card"><div class="label">Employee ID</div><div class="value" style="font-size:16px">${this._esc(emp.employee_code)}</div></div>
        <div class="stat-card"><div class="label">Position</div><div class="value" style="font-size:16px">${this._esc(emp.position || 'â€”')}</div></div>
        <div class="stat-card"><div class="label">Today's Status</div><div class="value" style="font-size:16px">${att.clock_in ? (att.clock_out ? 'Completed' : 'On Shift') : (attRes.success === false ? 'â€”' : 'Loadingâ€¦')}</div></div>
        <div class="stat-card"><div class="label">Hours Today</div><div class="value">${att.hours_worked || 0}h</div></div>
      </div>
      <div class="card" style="margin-top:16px"><div class="card-body" id="staff-clock-card">
        <h4>Clock In / Out</h4>
        ${attRes.success === false ? this._staffSectionFail(attRes, "Today's attendance / clock") : `
        <p class="muted" style="margin:4px 0 0;font-size:13px">Clock-in is only allowed on your scheduled shift
          ${todayShift ? ` (${todayShift.shift_date === yestStr ? 'overnight from yesterday' : 'today'} ${this._esc(todayShift.start_time || '?')}â€“${this._esc(todayShift.end_time || '?')})` : ' â€” no shift assigned for today'}.
        </p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
          <button class="btn btn-success" data-clock="clock_in" ${att.clock_in ? 'disabled' : ''}>Clock In</button>
          <button class="btn btn-warning" data-clock="break_start" ${!att.clock_in || att.clock_out ? 'disabled' : ''}>Start Break</button>
          <button class="btn btn-ghost" data-clock="break_end" ${!att.break_start || att.break_end ? 'disabled' : ''}>End Break</button>
          <button class="btn btn-danger" data-clock="clock_out" ${!att.clock_in || att.clock_out ? 'disabled' : ''}>Clock Out</button>
        </div>
        <p class="muted" style="margin-top:10px;font-size:13px">
          In: ${att.clock_in ? Utils.formatDateTime(att.clock_in) : 'â€”'} Â·
          Out: ${att.clock_out ? Utils.formatDateTime(att.clock_out) : 'â€”'}
        </p>`}
      </div></div>
      <div id="staff-portal-banner"></div>
      <div id="staff-routines-panel" style="margin-top:16px"></div>
      <div id="staff-portal-secondary"><p class="muted" style="padding:16px 0">Loading attendance, leave, payroll &amp; HRâ€¦</p></div>
    </div>`;
    this._hydrateStaffAvatars(el);
  },

  /** Refresh stats + clock buttons after attendance loads â€” never wipes banner/secondary/routines */
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
        <div class="stat-card"><div class="label">Position</div><div class="value" style="font-size:16px">${this._esc(emp.position || 'â€”')}</div></div>
        <div class="stat-card"><div class="label">Today's Status</div><div class="value" style="font-size:16px">${att.clock_in ? (att.clock_out ? 'Completed' : 'On Shift') : (attRes.success === false ? 'â€”' : 'Not Clocked In')}</div></div>
        <div class="stat-card"><div class="label">Hours Today</div><div class="value">${att.hours_worked || 0}h</div></div>`;
    }
    const card = el.querySelector('#staff-clock-card');
    if (card) {
      card.innerHTML = attRes.success === false ? this._staffSectionFail(attRes, "Today's attendance / clock") : `
        <h4>Clock In / Out</h4>
        <p class="muted" style="margin:4px 0 0;font-size:13px">Clock-in is only allowed on your scheduled shift
          ${todayShift ? ` (${todayShift.shift_date === yestStr ? 'overnight from yesterday' : 'today'} ${this._esc(todayShift.start_time || '?')}â€“${this._esc(todayShift.end_time || '?')})` : ' â€” no shift assigned for today'}.
          If you miss clock-out, the system auto-closes at shift end.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
          <button class="btn btn-success" data-clock="clock_in" ${att.clock_in ? 'disabled' : ''}>Clock In</button>
          <button class="btn btn-warning" data-clock="break_start" ${!att.clock_in || att.clock_out ? 'disabled' : ''}>Start Break</button>
          <button class="btn btn-ghost" data-clock="break_end" ${!att.break_start || att.break_end ? 'disabled' : ''}>End Break</button>
          <button class="btn btn-danger" data-clock="clock_out" ${!att.clock_in || att.clock_out ? 'disabled' : ''}>Clock Out</button>
        </div>
        <p class="muted" style="margin-top:10px;font-size:13px">
          In: ${att.clock_in ? Utils.formatDateTime(att.clock_in) : 'â€”'} Â·
          Break: ${att.break_start ? Utils.formatDateTime(att.break_start) : 'â€”'} â†’ ${att.break_end ? Utils.formatDateTime(att.break_end) : 'â€”'} Â·
          Out: ${att.clock_out ? Utils.formatDateTime(att.clock_out) : 'â€”'}
          ${att.auto_closed ? ' Â· <span style="color:var(--warning)">Auto-closed</span>' : ''}
        </p>`;
      el.dataset.clockBound = '';
      this._bindWorkerClockOnly(el, emp);
    }
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
        if (btn.disabled) return;
        btn.disabled = true;
        try {
          let timer;
          const r = await Promise.race([
            API.staffClock(emp.id, btn.dataset.clock, {
              clientRequestId: this._newClientRequestId(),
              actor: this._adminOverride ? this.app.user : undefined
            }).finally(() => clearTimeout(timer)),
            new Promise((resolve) => {
              timer = setTimeout(() => resolve({ success: false, error: 'Clock action timed out â€” try again' }), 12000);
            })
          ]);
          if (!r || r.success === false) {
            return Utils.toast(r?.error || 'Could not record clock action', 'error');
          }
          Utils.toast(
            r.offlineQueued || r.data?.offlineQueued
              ? (r.message || 'Saved offline')
              : 'Recorded',
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
    endDate.setDate(endDate.getDate() + 27);
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

    el.innerHTML = `<div class="staff-worker"><div class="page-toolbar" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">${this._staffAvatarHtml(emp, 40)}<h3 style="margin:0;flex:1">ðŸ‘· ${this._esc(emp.full_name)}</h3>
      <button class="btn btn-ghost" id="staff-logout-worker">${this._adminOverride ? 'Close portal' : 'Sign Out'}</button></div>
      <p class="muted" style="padding:8px 0">Loading clockâ€¦</p></div>`;
    document.getElementById('staff-logout-worker')?.addEventListener('click', () => this._staffSignOut());

    // Paint clock shell immediately â€” never wait on APIs before buttons appear
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
      this.portalSettings(this.app).show_shifts === false
        ? Promise.resolve({ success: true, data: [] })
        : this._staffLoadSafe(API.getStaffSchedules(yestStrEarly, todayStrEarly, empId), 'schedules_today', 4000)
    ]);
    if (!this._portalAlive(seq, el)) return;

    this._updateClockCard(el, emp, attRes, schedResToday);

    // PHASE 2 â€” remaining sections load in background (never blocks clock)
    this._loadWorkerPortalSecondary(el, seq, emp, attRes, {
      scheduleStart, scheduleEnd, weekStart, weekEnd, histFrom, histTo, empId, actor
    }).catch((err) => this._staffLogError('phase2', err));
  },

  async _loadWorkerPortalSecondary(el, seq, emp, attRes, ctx) {
    const { scheduleStart, scheduleEnd, weekStart, weekEnd, histFrom, histTo, empId, actor } = ctx;
    try {
    const ps0 = this.portalSettings(this.app);
    const empty = { success: true, data: [] };
    const [balRes, leaveRes, payRes, discRes, policyRes, warnRes, hrSubRes, feedRes, histRes, schedRes, hrDocRes, rulesRes] = await Promise.all([
      this._staffLoadSafe(API.getStaffLeaveBalance(empId), 'leave_balance', 4000),
      this._staffLoadSafe(API.getStaffLeave(empId), 'leave_list', 4000),
      ps0.show_payslips === false ? empty : this._staffLoadSafe(API.getStaffPayroll(empId, actor), 'payroll', 4000),
      ps0.show_disciplinary === false ? empty : this._staffLoadSafe(API.getStaffDisciplinary(empId), 'disciplinary', 4000),
      this._staffLoadSafe(API.getStaffLeavePolicy(empId), 'leave_policy', 4000),
      ps0.show_routines === false ? empty : this._staffLoadSafe(API.getStaffChecklistWarnings(this.app.user?.id || null, empId), 'checklist_warnings', 3500),
      this._staffLoadSafe(API.getHrStaffSubmissions({ employee_id: empId }, actor), 'hr_forms', 4000),
      this._staffLoadSafe(API.getStaffPortalFeed(empId), 'portal_feed', 3500),
      this._staffLoadSafe(API.getStaffAttendanceSummary(empId, histFrom, histTo), 'attendance_history', 4000),
      ps0.show_shifts === false ? empty : this._staffLoadSafe(API.getStaffSchedules(scheduleStart, scheduleEnd, empId), 'schedules', 4000),
      ps0.show_hr_docs === false ? empty : this._staffLoadSafe(API.getHrDocuments(empId, actor), 'hr_docs', 3500),
      ps0.show_company_rules === false ? empty : this._staffLoadSafe(API.getCompanyRules({}), 'company_rules', 3500)
    ]);
    if (!this._portalAlive(seq, el)) return;
    const att = attRes.success !== false ? (attRes.data || {}) : {};
    const bal = balRes.success !== false ? (balRes.data || {}) : {};
    const leaves = leaveRes.success !== false ? (leaveRes.data || []) : [];
    const payroll = payRes.success !== false ? ((payRes.data || []).slice(0, 5)) : [];
    const disciplinary = discRes.success !== false ? (discRes.data || []) : [];
    const myShifts = schedRes.success !== false ? (schedRes.data || []) : [];
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
    const companyRules = (portalSettings.show_company_rules !== false && rulesRes?.success !== false)
      ? (rulesRes.data || []).filter(r => !r.status || r.status === 'active' || r.status === 'published')
      : [];
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

    const bannerHtml = `
      ${eomFeed ? `<div class="card" style="margin-bottom:16px;border:2px solid var(--primary);background:var(--surface-alt, rgba(99,102,241,0.06))"><div class="card-body" style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">
        ${eomPhotoHtml || '<div style="font-size:48px">ðŸ†</div>'}
        <div style="flex:1;min-width:200px">
          <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.05em;color:var(--primary);font-weight:600">${this._esc(eomFeed.title || 'Employee of the Month')}</div>
          <p style="margin:8px 0 0">${this._esc(eomFeed.message || 'Congratulations on your award!')}</p>
          ${eomFeed.created_at ? `<small class="muted">${Utils.formatDateTime(eomFeed.created_at)}</small>` : ''}
          ${emp.phone ? `<div style="margin-top:10px"><button class="btn btn-sm btn-success" id="eom-self-wa">Send Congratulations via WhatsApp</button></div>` : ''}
        </div>
      </div></div>` : ''}
      ${checklistWarnings.length ? `<div class="card" style="margin-bottom:16px;border-color:var(--warning)"><div class="card-body">
        <h4 style="color:var(--warning)">âš ï¸ Checklist Compliance Warnings</h4>
        ${checklistWarnings.map(w => `<div style="padding:8px 0;border-bottom:1px solid var(--border)">
          <strong>${w.run_type === 'opening' ? 'Morning Opening' : 'Closing'}</strong> â€” ${this._esc(w.run_date)}<br>
          <small>${this._esc(w.message || 'Routine not submitted by deadline')}</small>
          ${w.whatsapp_url ? `<br><a href="${this._esc(w.whatsapp_url)}" target="_blank" rel="noopener" class="btn btn-sm btn-ghost" style="margin-top:6px">Send WhatsApp Reminder</a>` : ''}
          ${w._worker_run ? '' : `<button class="btn btn-sm btn-ghost ack-portal-warn" data-id="${w.id}" style="margin-top:6px">Dismiss</button>`}
        </div>`).join('')}
        <p class="muted" style="margin-top:8px;font-size:12px">Complete your assigned morning/closing tasks in the panel above, then Submit to Admin.</p>
      </div></div>` : ''}
`;

    const secondaryHtml = `
      <div class="card" style="margin-top:16px"><div class="card-body">
        <h4>Hours &amp; History</h4>
        ${histRes.success === false ? this._staffSectionFail(histRes, 'Attendance history') : ''}
        <p class="muted" style="font-size:13px">Showing <strong>${histFrom}</strong> â†’ <strong>${histTo}</strong>.
          This week is ${weekStart} â†’ ${weekEnd}. Filter any dates to review older records; a new week starts each Monday.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0;align-items:center">
          <input type="date" id="att-hist-from" value="${histFrom}">
          <span>to</span>
          <input type="date" id="att-hist-to" value="${histTo}">
          <button class="btn btn-sm btn-primary" id="att-hist-go">Show records</button>
          <button class="btn btn-sm btn-ghost" id="att-hist-week">This week</button>
        </div>
        <div class="table-wrap"><table><thead><tr><th>Date</th><th>In</th><th>Break</th><th>Out</th><th>Hours</th><th>Status</th></tr></thead>
          <tbody>${(hist.days || []).map(d => `<tr>
            <td>${d.work_date}</td>
            <td>${d.clock_in ? Utils.formatDateTime(d.clock_in) : 'â€”'}</td>
            <td>${d.break_start ? Utils.formatDateTime(d.break_start) : 'â€”'}${d.break_end ? ` â†’ ${Utils.formatDateTime(d.break_end)}` : ''}</td>
            <td>${d.clock_out ? Utils.formatDateTime(d.clock_out) : 'â€”'}</td>
            <td><strong>${d.hours_worked ?? 0}h</strong></td>
            <td>${d.auto_closed ? 'Auto-closed' : (d.admin_entered ? 'Admin entry' : (d.status || 'â€”'))}</td>
          </tr>`).join('') || '<tr><td colspan="6" class="muted">No clock records in this range (no clock-in = 0 hours)</td></tr>'}
        </tbody></table></div>
        <p style="margin-top:8px"><strong>Period total: ${hist.total_hours || 0}h</strong> Â· Days with clock-in: ${hist.days_worked || 0}</p>
      </div></div>
      ${portalSettings.show_shifts !== false ? `<div class="card" style="margin-top:16px"><div class="card-body">
        <h4>My Shifts â€” 4 weeks (${scheduleStart} â†’ ${scheduleEnd})</h4>
        ${schedRes.success === false ? this._staffSectionFail(schedRes, 'Shift information') : (myShifts.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Shift</th><th>Opening</th><th>Closing</th></tr></thead>
          <tbody>${myShifts.map(s => `<tr><td>${this._esc(s.shift_date)}</td><td>${s.is_rest_day ? 'Rest day' : this._esc(s.shift_name || 'â€”')}</td>
            <td>${s.is_rest_day ? 'â€”' : this._esc(s.start_time || 'â€”')}</td>
            <td>${s.is_rest_day ? 'â€”' : this._esc(s.end_time || 'â€”')}</td></tr>`).join('')}</tbody></table></div>`
          : '<p class="muted">No shifts scheduled in this period. Ask admin to generate shifts in Admin â†’ Staff â†’ Shifts and link your user to your employee profile.</p>')}
      </div></div>` : ''}
      ${hrDocs.length ? `<div class="card" style="margin-top:16px"><div class="card-body">
        <h4>HR Documents</h4>
        ${hrDocs.map(d => `<div style="padding:8px 0;border-bottom:1px solid var(--border)">
          <strong>${this._esc(d.doc_type || d.document_type || 'Document')}</strong>
          ${d.title ? ` â€” ${this._esc(d.title)}` : ''}
          ${d.created_at ? `<small class="muted"> Â· ${Utils.formatDate(d.created_at)}</small>` : ''}
        </div>`).join('')}
      </div></div>` : ''}
      ${companyRules.length ? `<div class="card" style="margin-top:16px"><div class="card-body">
        <h4>Company Rules</h4>
        ${companyRules.slice(0, 20).map(r => `<div style="padding:8px 0;border-bottom:1px solid var(--border)">
          <strong>${this._esc(r.title || r.rule_number || 'Rule')}</strong>
          ${r.category ? `<span class="muted"> Â· ${this._esc(r.category)}</span>` : ''}
          ${r.description ? `<p class="muted" style="margin:4px 0 0;font-size:13px">${this._esc(String(r.description).slice(0, 400))}</p>` : ''}
        </div>`).join('')}
      </div></div>` : ''}
      ${hrSubmissions.length ? `<div class="card" style="margin-top:16px;border-color:var(--primary)"><div class="card-body">
        <h4>HR Forms & Documents</h4>
        <p class="muted" style="font-size:13px">Complete assigned training, probation, or employment forms and upload supporting documents.</p>
        ${hrSubmissions.map(s => `<div style="padding:10px 0;border-bottom:1px solid var(--border)">
          <strong>${s.template_type}</strong> â€” ${s.template_title || 'Form'} Â· <span class="tag">${s.submitted_at ? 'Submitted' : 'Pending'}</span>
          ${s.status === 'pending' && !s.submitted_at ? `<details style="margin-top:8px"><summary class="muted" style="cursor:pointer;font-size:12px">View agreement template</summary>
            <pre style="white-space:pre-wrap;font-size:11px;max-height:160px;overflow:auto;margin-top:8px;background:var(--bg-secondary);padding:8px;border-radius:6px">${Utils.escHtml((s.filled_data?.template_body || '').slice(0, 2000))}</pre></details>
            <div style="margin-top:8px">
            <textarea id="hr-form-${s.id}" rows="4" style="width:100%" placeholder="Fill in employee details and sign-off notesâ€¦">${Utils.escHtml(s.filled_data?.employee_response || '')}</textarea>
            <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
              <button class="btn btn-sm btn-ghost hr-upload-doc" data-id="${s.id}">Upload CV / Document</button>
              <button class="btn btn-sm btn-primary hr-submit-form" data-id="${s.id}">Submit to Admin</button>
            </div>
          </div>` : `<p class="muted" style="font-size:12px;margin-top:4px">${s.submitted_at ? `Submitted ${Utils.formatDateTime(s.submitted_at)}` : `Updated ${Utils.formatDateTime(s.updated_at || s.created_at)}`} Â· ${s.status}</p>`}
        </div>`).join('')}
      </div></div>` : ''}
      <div class="staff-portal-split">
        <div class="card"><div class="card-body">
          <h4>Leave Balance</h4>
          ${balRes.success === false ? this._staffSectionFail(balRes, 'Leave balance') : `
          <p>Annual: ${(bal.annual?.total || 0) - (bal.annual?.used || 0)} left</p>
          <p>Sick: ${(bal.sick?.total || 0) - (bal.sick?.used || 0)} left</p>
          <p>Family: ${(bal.family?.total || 0) - (bal.family?.used || 0)} left</p>`}
          <p class="muted" style="font-size:12px;margin-top:8px">
            Portal: <strong>${leaveOpen ? 'Open' : 'Closed'}</strong> Â· Sick leave always allowed
            ${maxMonth ? `<br>Requests this month: ${portalSettings.requests_this_month || 0} / ${maxMonth}` : ''}
            ${maxYear ? `<br>Requests this year: ${portalSettings.requests_this_year || 0} / ${maxYear}` : ''}
          </p>
          ${(portalSettings.active_blackouts || []).length ? `<p class="muted" style="font-size:12px;color:var(--warning)">Blackout periods apply â€” only sick leave allowed on blocked dates.</p>` : ''}
          <button class="btn btn-primary btn-sm" id="staff-request-leave" style="margin-top:8px">Request Leave</button>
        </div></div>
        ${portalSettings.show_payslips !== false ? `<div class="card"><div class="card-body">
          <h4>Recent Payslips</h4>
          ${payRes.success === false ? this._staffSectionFail(payRes, 'Payroll') : (payroll.length ? payroll.map(p => `<div style="padding:6px 0;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px">
            <span>${p.period_start} â€“ ${p.period_end}<br><small class="muted">${p.status}</small></span>
            <span style="display:flex;align-items:center;gap:4px;flex-wrap:wrap">
              <strong>${Utils.formatMoney(p.net_salary, currency)}</strong>
              <button class="btn btn-sm btn-ghost dl-payslip" data-id="${p.id}" title="Download PDF">Download PDF</button>
              ${emp.phone ? `<button class="btn btn-sm btn-success wa-payslip" data-id="${p.id}" title="WhatsApp payslip summary">WhatsApp</button>` : ''}
            </span>
          </div>`).join('') : '<p class="muted">No payslips yet</p>')}
        </div></div>` : ''}
      </div>
      <div class="card" style="margin-top:16px"><div class="card-body">
        <h4>My Leave Requests</h4>
        ${leaveRes.success === false ? this._staffSectionFail(leaveRes, 'Leave requests') : ''}
        ${leaveRes.success === false ? '' : (leaves.length ? leaves.slice(0, 8).map(l => {
          const ended = (l.end_date || l.start_date) <= Utils.today();
          const needsProof = l.status === 'approved' && ended && /sick/i.test(l.leave_type || '') && !l.proof_confirmed_at;
          const proofPending = l.proof_path && !l.proof_confirmed_at;
          return `<div style="padding:10px 0;border-bottom:1px solid var(--border)">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">
              <span>${l.leave_type} Â· ${l.start_date} â€“ ${l.end_date} Â· <strong>${l.status}</strong>
                ${proofPending ? '<br><small style="color:var(--warning)">Proof submitted â€” awaiting admin confirmation</small>' : ''}
                ${l.proof_confirmed_at ? '<br><small style="color:var(--success)">Proof confirmed</small>' : ''}
              </span>
              ${l.status === 'approved' ? `<span style="display:flex;gap:4px;flex-wrap:wrap">
                <button class="btn btn-sm btn-ghost lv-pdf" data-id="${l.id}">Download PDF</button>
                ${emp.phone ? `<button class="btn btn-sm btn-success lv-wa" data-id="${l.id}">WhatsApp</button>` : ''}
              </span>` : ''}
            </div>
            ${needsProof && !l.proof_path ? `<div style="margin-top:8px;padding:10px;background:var(--bg-secondary);border-radius:8px">
              <small class="muted">Upload sick leave proof (doctor's note / certificate)</small>
              <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
                <button class="btn btn-sm btn-ghost lv-proof-upload" data-id="${l.id}" title="Upload picture">ðŸ–¼ Upload</button>
                <button class="btn btn-sm btn-primary lv-proof-camera" data-id="${l.id}" title="Take photo">ðŸ“· Take Photo</button>
              </div>
            </div>` : ''}
          </div>`;
        }).join('') : '<p class="muted">No leave requests</p>')}
      </div></div>
      ${portalSettings.show_disciplinary !== false ? `<div class="card" style="margin-top:16px"><div class="card-body">
        <h4>Warnings, Hearings & Disciplinary</h4>
        ${discRes.success === false ? this._staffSectionFail(discRes, 'Disciplinary records') : ''}
        ${discRes.success === false ? '' : (disciplinary.length ? disciplinary.map(d => `<div style="padding:10px 0;border-bottom:1px solid var(--border)">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">
            <span><strong>${this._esc(d.record_type)}</strong> Â· ${this._esc(d.incident_date)}<br>
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
          ${!d.worker_response && (d.requires_response || portalSettings.require_disciplinary_response) && d.status !== 'responded' ? `<div style="margin-top:8px">
            <textarea id="disc-resp-${d.id}" rows="2" placeholder="Your written responseâ€¦" style="width:100%"></textarea>
            <button class="btn btn-sm btn-primary disc-respond" data-id="${d.id}" style="margin-top:6px">Submit Response</button>
          </div>` : ''}
        </div>`).join('') : '<p class="muted">No disciplinary records</p>')}
      </div></div>` : ''}
      <div id="staff-portal-deferred"><p class="muted" style="font-size:13px;padding:8px 0">Loading contracts &amp; salary claimsâ€¦</p></div>
`;

    const secondaryEl = el.querySelector('#staff-portal-secondary');
    const bannerEl = el.querySelector('#staff-portal-banner');
    const clockAlive = !!el.querySelector('[data-clock]');
    if (clockAlive && secondaryEl) {
      if (bannerEl) bannerEl.innerHTML = bannerHtml;
      secondaryEl.innerHTML = secondaryHtml;
    } else {
      el.dataset.clockBound = '';
      el.innerHTML = `<div class="staff-worker">
      <div class="page-toolbar" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        ${this._staffAvatarHtml(emp, 48)}
        <h3 style="margin:0;flex:1">ðŸ‘· ${this._esc(emp.full_name)}</h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${this._adminOverride ? `<button class="btn btn-ghost" id="staff-back-hub">â† All employees</button>
            <button class="btn btn-ghost" id="staff-goto-hr">Edit in Staff &amp; HR</button>` : ''}
          <button class="btn btn-ghost" id="staff-logout-worker">${this._adminOverride ? 'Close portal' : 'Sign Out'}</button>
        </div></div>
      ${this._adminOverride ? `<div class="card" style="margin-bottom:12px;border-color:var(--primary)"><div class="card-body">
        <strong>Admin view</strong> â€” you are in ${this._esc(emp.full_name)}â€™s Staff Portal.
      </div></div>` : ''}
      <div id="staff-portal-banner">${bannerHtml}</div>
      ${this.canDoRoutines(this.app, emp) ? '<div id="staff-routines-panel" style="margin-bottom:16px"></div>' : ''}
      <div class="stats-grid">
        <div class="stat-card"><div class="label">Employee ID</div><div class="value" style="font-size:16px">${this._esc(emp.employee_code)}</div></div>
        <div class="stat-card"><div class="label">Position</div><div class="value" style="font-size:16px">${this._esc(emp.position || 'â€”')}</div></div>
        <div class="stat-card"><div class="label">Today's Status</div><div class="value" style="font-size:16px">${att.clock_in ? (att.clock_out ? 'Completed' : 'On Shift') : 'Not Clocked In'}</div></div>
        <div class="stat-card"><div class="label">Hours Today</div><div class="value">${att.hours_worked || 0}h</div></div>
      </div>
      <div class="card" style="margin-top:16px"><div class="card-body">
        <h4>Clock In / Out</h4>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
          <button class="btn btn-success" data-clock="clock_in" ${att.clock_in ? 'disabled' : ''}>Clock In</button>
          <button class="btn btn-warning" data-clock="break_start" ${!att.clock_in || att.clock_out ? 'disabled' : ''}>Start Break</button>
          <button class="btn btn-ghost" data-clock="break_end" ${!att.break_start || att.break_end ? 'disabled' : ''}>End Break</button>
          <button class="btn btn-danger" data-clock="clock_out" ${!att.clock_in || att.clock_out ? 'disabled' : ''}>Clock Out</button>
        </div>
      </div></div>
      <div id="staff-portal-secondary">${secondaryHtml}</div>
    </div>`;
      this._bindWorkerClockOnly(el, emp);
    }

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
    el.querySelectorAll('.disc-respond').forEach(btn => {
      btn.addEventListener('click', async () => {
        const text = document.getElementById(`disc-resp-${btn.dataset.id}`)?.value.trim();
        if (!text) return Utils.toast('Enter your response', 'error');
        const r = await API.respondStaffDisciplinary(parseInt(btn.dataset.id), emp.id, text);
        if (!r.success) return Utils.toast(r.error, 'error');
        Utils.toast('Response saved', 'success');
        this._rerender();
      });
    });
    el.querySelectorAll('.dl-payslip').forEach(btn => {
      btn.addEventListener('click', async () => {
        await Utils.savePdfBuffer(`payslip-${btn.dataset.id}.pdf`, await API.getStaffPayslipPdf(parseInt(btn.dataset.id, 10)));
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
      const r = await API.submitStaffLeaveProof(parseInt(leaveId, 10), emp.id, imageData);
      if (!r.success) return Utils.toast(r.error, 'error');
      Utils.toast('Proof submitted â€” admin will confirm', 'success');
      this._rerender();
    };
    el.querySelectorAll('.lv-proof-upload').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
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
        if (!waRes?.success) Utils.openWhatsApp(phone, `${d.record_type} â€” ${d.incident_date}\n${d.description || ''}`);
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

    // WAVE 2 â€” contracts & salary claims (never blocks clock)
    (async () => {
      const deferred = el.querySelector('#staff-portal-deferred');
      if (!deferred) return;
      const [contractRes, claimRes] = await Promise.all([
        this._staffLoadSafe(API.getHrContractsForEmployee(empId, actor), 'contracts', 5000),
        this._staffLoadSafe(API.listSalaryClaims({ employee_id: empId }, actor), 'salary_claims', 5000)
      ]);
      if (!this._portalAlive(seq, el)) return;
      myContracts = (contractRes.success !== false && Array.isArray(contractRes.data)) ? contractRes.data : [];
      salaryClaims = (claimRes.success !== false && Array.isArray(claimRes.data)) ? claimRes.data : [];
      deferred.innerHTML = `
      ${myContracts.length ? `<div class="card" style="margin-top:16px;border-color:var(--warning)"><div class="card-body">
        <h4>Employment Contracts</h4>
        <p class="muted" style="font-size:13px">When a contract expires, admin opens a re-sign window. Upload your documents, then sign.</p>
        ${myContracts.map(c => {
          const docs = (() => { try { return typeof c.doc_paths_json === 'string' ? JSON.parse(c.doc_paths_json || '[]') : (c.doc_paths || []); } catch { return []; } })();
          const needsSign = c.status === 'pending_signatures' && !c.employee_signed_at;
          const windowOpen = !c.resign_opens_at || new Date() >= new Date(c.resign_opens_at);
          const windowClosed = c.resign_closes_at && new Date() > new Date(c.resign_closes_at);
          return `<div style="padding:10px 0;border-bottom:1px solid var(--border)">
            <strong>${Utils.escHtml(c.template_name || c.emp_position || 'Contract')}</strong>
            Â· <span class="tag">${c.status}</span>
            ${c.expires_at ? `<br><small class="muted">Expires: ${Utils.formatDateTime(c.expires_at)}</small>` : ''}
            ${c.resign_opens_at ? `<br><small class="muted">Re-sign from: ${Utils.formatDateTime(c.resign_opens_at)}${c.resign_closes_at ? ' until ' + Utils.formatDateTime(c.resign_closes_at) : ''}</small>` : ''}
            ${docs.length ? `<br><small style="color:var(--success)">${docs.length} document(s) uploaded</small>` : ''}
            <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
              <button class="btn btn-sm btn-ghost ctr-pdf" data-id="${c.id}">PDF</button>
              ${needsSign && windowOpen && !windowClosed ? `
                <button class="btn btn-sm btn-ghost ctr-upload" data-id="${c.id}">Upload documents</button>
                <button class="btn btn-sm btn-primary ctr-sign" data-id="${c.id}">Sign contract</button>` : ''}
              ${needsSign && !windowOpen ? `<span class="muted" style="font-size:12px">Waiting for re-sign windowâ€¦</span>` : ''}
              ${needsSign && windowClosed ? `<span class="muted" style="font-size:12px;color:var(--danger)">Re-sign window closed â€” contact admin</span>` : ''}
            </div>
          </div>`;
        }).join('')}
      </div></div>` : ''}
      ${salaryClaims.length ? `<div class="card" style="margin-top:16px;border-color:var(--success)"><div class="card-body">
        <h4>Salary Claims</h4>
        <p class="muted" style="font-size:13px">Claim your salary before the deadline. Admin must approve (with their signature) before payment.</p>
        ${salaryClaims.map(cl => {
          const canClaim = ['open', 'rejected'].includes(cl.status)
            && (!cl.claim_opens_at || new Date() >= new Date(cl.claim_opens_at))
            && (!cl.claim_deadline || new Date() <= new Date(cl.claim_deadline));
          return `<div style="padding:10px 0;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">
            <span><strong>${cl.period_start} â€“ ${cl.period_end}</strong><br>
              <small>Net ${Utils.formatMoney(cl.amount || cl.net_amount, currency)} Â· <span class="tag">${cl.status}</span></small>
              <br><small class="muted">Claim by: ${Utils.formatDateTime(cl.claim_deadline)}${cl.payment_date ? ' Â· Pay date: ' + cl.payment_date : ''}</small>
            </span>
            <span style="display:flex;gap:4px;flex-wrap:wrap">
              ${canClaim ? `<button class="btn btn-sm btn-primary sc-claim" data-id="${cl.id}">Claim salary</button>` : ''}
              ${['approved','paid','claimed'].includes(cl.status) ? `<button class="btn btn-sm btn-ghost sc-pdf" data-id="${cl.id}">PDF</button>` : ''}
            </span>
          </div>`;
        }).join('')}
      </div></div>` : ''}
      ${!myContracts.length && !salaryClaims.length
        ? '<p class="muted" style="font-size:13px;padding:4px 0">No open contracts or salary claims.</p>' : ''}
`;
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
        secondary.innerHTML = `<div class="card" style="padding:16px;margin-top:12px">
          <p class="error-msg">${this._esc(phase2Err?.message || 'Could not load portal sections')}</p>
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
    el.innerHTML = `<div class="card" style="border:2px solid var(--primary)"><div class="card-body">
      <h4>âœ… Today's Assigned Tasks</h4>
      <p class="muted">Admin assigns these in Operations â†’ Morning/Closing. Tick every checkbox, then <strong>Submit to Admin</strong>.</p>
      <div class="form-tabs" id="staff-routine-tabs">${tabButtons}</div>
      <div id="staff-routine-content"><p class="muted">Loadingâ€¦</p></div>
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
        : `No ${type === 'opening' ? 'morning' : 'closing'} tasks are assigned to you. Ask admin to assign tasks to your name (or â€œAny workerâ€).`);

    el.innerHTML = `
      <h4 style="margin-top:12px">${label}</h4>
      <p class="muted" style="margin:4px 0 0">Tick <strong>every</strong> task checkbox, then submit before <strong>${deadline}</strong>.${intervalMin > 0 ? ` Wait <strong>${intervalMin} min</strong> between checkboxes.` : ''} After the deadline you cannot submit â€” it is recorded as failed and affects Employee of the Month.</p>
      ${canEdit && pastDeadline ? `<p style="color:var(--danger);margin:8px 0 0">Deadline ${deadline} has passed â€” submit is locked.</p>` : ''}
      ${canEdit && !allDone ? `<p class="muted" style="margin:8px 0 0">Submit unlocks when all ${items.length} checkbox(es) are done (${items.filter(i => i.item_status === 'done' || (!i.item_status && i.completed)).length}/${items.length}).</p>` : ''}
      <div style="display:flex;gap:8px;margin:12px 0;flex-wrap:wrap">
        ${!activeRun || activeRun.status === 'confirmed' || (isFailed && !(activeRun.items || []).length) ? `<button class="btn btn-primary btn-sm" id="sr-start">Start Today's Tasks</button>` : ''}
        ${canEdit ? `<button class="btn btn-success btn-sm" id="sr-submit" ${canSubmit ? '' : 'disabled title="Complete all checkboxes before the deadline"'}>Submit to Admin</button>` : ''}
        ${activeRun ? `<button class="btn btn-ghost btn-sm" id="sr-pdf">PDF</button>
          <button class="btn btn-ghost btn-sm" id="sr-print">Print</button>` : ''}
      </div>
      ${activeRun ? `<p><strong>Status:</strong> ${activeRun.status}
        ${activeRun.submitted_at ? ` Â· Submitted ${Utils.formatDateTime(activeRun.submitted_at)}` : ''}
        ${isFailed ? ` Â· <span style="color:var(--danger)">${Utils.escHtml(activeRun.failure_reason || 'Failed â€” deadline missed')}</span>` : ''}</p>
        ${(activeRun.items || []).map(i => {
          const done = i.item_status === 'done' || (!i.item_status && i.completed);
          const locked = activeRun.status === 'submitted' || activeRun.status === 'confirmed' || isFailed;
          return `<label style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);cursor:${canEdit && !locked ? 'pointer' : 'default'}">
            <input type="checkbox" class="sr-check" data-id="${i.id}" ${done ? 'checked' : ''} ${!canEdit || locked || done ? 'disabled' : ''} style="width:18px;height:18px;accent-color:var(--success)">
            <span style="flex:1">${i.task_name}</span>
            ${done ? `<small class="muted">${i.employee_name || ''}${i.comments ? ` â€” ${i.comments}` : ''}</small>` : ''}
          </label>`;
        }).join('') || '<p class="muted">This run has no tasks.</p>'}` : `<p class="muted">${emptyMsg}</p>
        ${!activeRun && myTemplates.length ? `<div style="margin-top:8px">${myTemplates.map(t => `<label style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);opacity:0.7">
            <input type="checkbox" disabled style="width:18px;height:18px"><span>${t.task_name}</span>
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
      if (pastDeadline) return Utils.toast(`Deadline ${deadline} has passed â€” cannot submit`, 'error');
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
      return Utils.toast('Leave requests are closed. Contact admin â€” only sick leave is accepted when closed.', 'error');
    }
    Utils.showModal('Request Leave', `
      <div class="form-grid">
        ${!leaveOpen ? `<p class="muted full" style="color:var(--warning)">Leave portal is closed. Only sick leave can be submitted.</p>` : ''}
        <div class="field"><label>Leave Type</label>
          <select id="sl-type">${defaultTypes.map(t => `<option>${t}</option>`).join('')}</select></div>
        <div class="field"><label>Start Date</label><input type="date" id="sl-start" value="${Utils.today()}"></div>
        <div class="field"><label>End Date</label><input type="date" id="sl-end" value="${Utils.today()}"></div>
        <div class="field"><label>Days</label><input type="number" id="sl-days" min="0.5" step="0.5" value="1"></div>
        <div class="field full"><label>Notes</label><input id="sl-notes"></div>
        ${minNotice ? `<p class="muted full">Minimum ${minNotice} day(s) notice required for non-sick leave.</p>` : ''}
        ${(portalSettings.active_blackouts || []).length ? `<p class="muted full">Some dates are blocked by admin â€” sick leave is exempt.</p>` : ''}
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

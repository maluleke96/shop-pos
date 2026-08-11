const StaffPage = {
  unlocked: false,
  employee: null,
  staffTab: null,
  pendingSelfie: false,

  canAccessOwnerSalary(app) {
    const u = app.user;
    if (!u) return false;
    if (u.role === 'owner' || u.role === 'manager') return true;
    return Utils.hasPermission(u, 'owner_salary');
  },

  canDoRoutines(app, employee) {
    // Opening & Closing management lives on Operations (manager/supervisor).
    // Staff portal only shows the daily morning/closing task list for linked workers.
    return !!employee?.id;
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

  canAccessRecruitment(app) {
    const role = app.user?.role;
    return !!role && !['cashier', 'marketing_agent'].includes(role)
      && ['owner', 'manager', 'supervisor', 'assistant_manager'].includes(role);
  },

  async render(el, app) {
    this.app = app;
    this.el = el;
    const canOwnerSalary = this.canAccessOwnerSalary(app);
    const canRecruit = this.canAccessRecruitment(app);
    const showEmployees = app.user?.role !== 'cashier' || !Utils.hasPermission(app.user, 'owner_salary_only');
    const needsTabs = canOwnerSalary || canRecruit;

    if (needsTabs) {
      const tabs = [];
      if (showEmployees || app.user?.role !== 'cashier') tabs.push(['employees', '👷 Employee Portal']);
      if (canRecruit) tabs.push(['recruitment', '💼 Recruitment']);
      if (canOwnerSalary) tabs.push(['owner-salary', '💼 Owner Salary']);
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
        this.unlocked = false;
        this.employee = null;
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
    if (['owner', 'manager'].includes(this.app.user?.role)) this.unlocked = true;
    if (!this.unlocked) return this.renderSupervisorGate(el);
    if (!this.employee && this.app.user?.id) {
      const linkRes = await API.getEmployeeByUserId(this.app.user.id);
      if (linkRes.success && linkRes.data) {
        this.employee = linkRes.data;
      } else if (this.app.user?.role === 'cashier') {
        return this.renderNoEmployeeLink(el);
      }
    }
    if (!this.employee) return this.renderWorkerLogin(el);
    if (this.pendingSelfie) return StaffSelfieCapture.render(el, this.employee, (emp) => {
      this.employee = emp;
      this.pendingSelfie = false;
      this.render(this.el, this.app);
    });
    return this.renderWorkerPanel(el);
  },

  renderNoEmployeeLink(el) {
    el.innerHTML = `<div class="staff-gate card" style="max-width:480px;margin:40px auto;padding:32px;text-align:center">
      <h2>👷 Staff Portal</h2>
      <p class="muted">Your user account is not linked to an employee profile.</p>
      <p><strong>Ask admin to link your user account to your employee profile</strong> (Admin → Staff → edit employee → User Account).</p>
      <button class="btn btn-ghost" id="staff-retry-link" style="margin-top:16px">Check Again</button>
    </div>`;
    document.getElementById('staff-retry-link').addEventListener('click', () => this.render(this.el, this.app));
  },

  renderSupervisorGate(el) {
    el.innerHTML = `<div class="staff-gate card" style="max-width:420px;margin:40px auto;padding:32px;text-align:center">
      <h2>👷 Staff Portal</h2>
      <p class="muted">Manager or supervisor PIN required to open staff clocking.</p>
      <div class="field"><label>Supervisor / Manager PIN</label>
        <input type="password" id="staff-super-pin" maxlength="6" inputmode="numeric" placeholder="Daily code or manager PIN" autofocus></div>
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
      if (r.success) { this.unlocked = true; return this.render(this.el, this.app); }
    }
    const codeRes = await API.verifySupervisorCode(pin, 'staff');
    if (codeRes.success) {
      this.unlocked = true;
      Utils.toast('Staff portal unlocked', 'success');
      return this.render(this.el, this.app);
    }
    Utils.toast(codeRes.error || 'Invalid supervisor PIN — ask manager for today\'s code', 'error');
  },

  renderWorkerLogin(el) {
    el.innerHTML = `<div class="staff-gate card" style="max-width:420px;margin:40px auto;padding:32px">
      <h2 style="text-align:center">Employee Sign In</h2>
      <p class="muted" style="text-align:center">Enter your Employee ID and secret PIN, or ask admin to link your POS user to your employee profile.</p>
      <div class="field"><label>Employee ID</label><input id="staff-emp-code" placeholder="EMP0001" autofocus></div>
      <div class="field"><label>PIN</label><input type="password" id="staff-emp-pin" maxlength="6" inputmode="numeric"></div>
      <button class="btn btn-primary btn-lg" id="staff-emp-login" style="width:100%">Sign In</button>
      ${!['owner', 'manager'].includes(this.app.user?.role) ? '' : `<button class="btn btn-ghost btn-sm" id="staff-relock" style="width:100%;margin-top:8px">Lock Portal</button>`}
    </div>`;
    document.getElementById('staff-emp-login').addEventListener('click', () => this.workerLogin());
    document.getElementById('staff-emp-pin').addEventListener('keydown', (e) => { if (e.key === 'Enter') this.workerLogin(); });
    document.getElementById('staff-relock')?.addEventListener('click', () => {
      this.unlocked = false; this.employee = null; this.render(this.el, this.app);
    });
  },

  async workerLogin() {
    const code = document.getElementById('staff-emp-code').value.trim();
    const pin = document.getElementById('staff-emp-pin').value.trim();
    if (!code || !pin) return Utils.toast('Employee ID and PIN required', 'error');
    const r = await API.staffLogin(code, pin);
    if (!r.success) return Utils.toast(r.error || 'Login failed', 'error');
    this.employee = r.data;
    this.employeePin = pin;
    this.pendingSelfie = true;
    Utils.toast(`Welcome, ${this.employee.full_name}`, 'success');
    this.render(this.el, this.app);
  },

  async renderWorkerPanel(el) {
    const emp = this.employee;
    if (!emp?.id) {
      el.innerHTML = `<div class="card" style="padding:20px"><p class="error-msg">No employee session. Please sign in again.</p></div>`;
      return;
    }
    const soft = (p) => Promise.resolve(p).catch(() => ({ success: false, data: null }));
    const withTimeout = (p, ms = 12000) => Promise.race([
      soft(p),
      new Promise(resolve => setTimeout(() => resolve({ success: false, data: null, error: 'timeout' }), ms))
    ]);
    const scheduleStart = Utils.weekStart();
    const endDate = new Date(scheduleStart + 'T12:00:00');
    endDate.setDate(endDate.getDate() + 20);
    const scheduleEnd = endDate.toLocaleDateString('en-CA');
    const weekStart = Utils.weekStart();
    const weekEndDate = new Date(weekStart + 'T12:00:00');
    weekEndDate.setDate(weekEndDate.getDate() + 6);
    const weekEnd = weekEndDate.toLocaleDateString('en-CA');
    const histFrom = this._attHistFrom || weekStart;
    const histTo = this._attHistTo || weekEnd;
    const empId = parseInt(emp.id, 10);
    const actor = this.hrActor(emp);
    const [attRes, balRes, leaveRes, payRes, discRes, schedRes, policyRes, warnRes, hrSubRes, feedRes, histRes] = await Promise.all([
      withTimeout(API.getStaffTodayAttendance(empId), 10000),
      withTimeout(API.getStaffLeaveBalance(empId), 10000),
      withTimeout(API.getStaffLeave(empId), 10000),
      withTimeout(API.getStaffPayroll(empId, actor), 10000),
      withTimeout(API.getStaffDisciplinary(empId), 10000),
      withTimeout(API.getStaffSchedules(scheduleStart, scheduleEnd, empId), 10000),
      withTimeout(API.getStaffLeavePolicy(empId), 10000),
      this.app.user?.id
        ? withTimeout(API.getStaffChecklistWarnings(this.app.user.id), 8000)
        : Promise.resolve({ success: true, data: [] }),
      withTimeout(API.getHrStaffSubmissions({ employee_id: empId }, actor), 8000),
      withTimeout(API.getStaffPortalFeed(empId), 8000),
      withTimeout(API.getStaffAttendanceSummary(empId, histFrom, histTo), 10000)
    ]);
    const att = attRes.data || {};
    const bal = balRes.data || {};
    const leaves = leaveRes.data || [];
    const payroll = (payRes.data || []).slice(0, 5);
    const disciplinary = discRes.data || [];
    const myShifts = schedRes.data || [];
    const portalSettings = policyRes.data || this.app.settings?.staff_portal_settings || {};
    const checklistWarnings = warnRes.data || [];
    const hrSubmissions = (hrSubRes.data || []).filter(s => !s.assigned_to_user_id || s.submitted_at);
    const portalFeed = (feedRes.data || []).filter(f => f.feed_type === 'employee_of_month');
    const eomFeed = portalFeed[0];
    const hist = histRes.data || { days: [], total_hours: 0 };
    const todayShift = myShifts.find(s => s.shift_date === Utils.today() && !s.is_rest_day);
    let eomPhotoHtml = '';
    if (eomFeed?.photo_path) {
      const imgRes = await withTimeout(API.getImageDataUrl(eomFeed.photo_path), 5000);
      if (imgRes?.success && (imgRes.data || imgRes.dataUrl)) {
        eomPhotoHtml = `<img src="${imgRes.data || imgRes.dataUrl}" alt="Employee of the Month" style="width:96px;height:96px;object-fit:cover;border-radius:12px;border:2px solid var(--primary)">`;
      }
    }
    const leaveTypes = portalSettings.leave_types || ['Annual Leave', 'Sick Leave', 'Family Responsibility', 'Unpaid Leave'];
    const leaveOpen = portalSettings.leave_requests_open !== false;
    const maxMonth = portalSettings.max_leave_requests_per_month;
    const maxYear = portalSettings.max_leave_requests_per_year;
    const currency = this.app.settings?.currency || 'R';

    el.innerHTML = `<div class="staff-worker">
      <div class="page-toolbar"><h3>👷 ${emp.full_name}</h3>
        <button class="btn btn-ghost" id="staff-logout-worker">Sign Out</button></div>
      ${eomFeed ? `<div class="card" style="margin-bottom:16px;border:2px solid var(--primary);background:var(--surface-alt, rgba(99,102,241,0.06))"><div class="card-body" style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">
        ${eomPhotoHtml || '<div style="font-size:48px">🏆</div>'}
        <div style="flex:1;min-width:200px">
          <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.05em;color:var(--primary);font-weight:600">${eomFeed.title || 'Employee of the Month'}</div>
          <p style="margin:8px 0 0">${eomFeed.message || 'Congratulations on your award!'}</p>
          ${eomFeed.created_at ? `<small class="muted">${Utils.formatDateTime(eomFeed.created_at)}</small>` : ''}
          ${emp.phone ? `<div style="margin-top:10px"><button class="btn btn-sm btn-success" id="eom-self-wa">Send Congratulations via WhatsApp</button></div>` : ''}
        </div>
      </div></div>` : ''}
      ${this.canDoRoutines(this.app, emp) ? `<div id="staff-routines-panel" style="margin-bottom:16px"></div>` : ''}
      ${checklistWarnings.length ? `<div class="card" style="margin-bottom:16px;border-color:var(--warning)"><div class="card-body">
        <h4 style="color:var(--warning)">⚠️ Checklist Compliance Warnings</h4>
        ${checklistWarnings.map(w => `<div style="padding:8px 0;border-bottom:1px solid var(--border)">
          <strong>${w.run_type === 'opening' ? 'Morning Opening' : 'Closing'}</strong> — ${w.run_date}<br>
          <small>${w.message || 'Routine not submitted by deadline'}</small>
          ${w.whatsapp_url ? `<br><a href="${w.whatsapp_url}" target="_blank" rel="noopener" class="btn btn-sm btn-ghost" style="margin-top:6px">Send WhatsApp Reminder</a>` : ''}
          <button class="btn btn-sm btn-ghost ack-portal-warn" data-id="${w.id}" style="margin-top:6px">Dismiss</button>
        </div>`).join('')}
        <p class="muted" style="margin-top:8px;font-size:12px">Complete your assigned morning/closing tasks in the panel above, then Submit to Admin.</p>
      </div></div>` : ''}
      <div class="stats-grid">
        <div class="stat-card"><div class="label">Employee ID</div><div class="value" style="font-size:16px">${emp.employee_code}</div></div>
        <div class="stat-card"><div class="label">Position</div><div class="value" style="font-size:16px">${emp.position || '—'}</div></div>
        <div class="stat-card"><div class="label">Today's Status</div><div class="value" style="font-size:16px">${att.clock_in ? (att.clock_out ? 'Completed' : 'On Shift') : 'Not Clocked In'}</div></div>
        <div class="stat-card"><div class="label">Hours Today</div><div class="value">${att.hours_worked || 0}h</div></div>
      </div>
      <div class="card" style="margin-top:16px"><div class="card-body">
        <h4>Clock In / Out</h4>
        <p class="muted" style="margin:4px 0 0;font-size:13px">Clock-in is only allowed on your scheduled shift
          ${todayShift ? ` (today ${todayShift.start_time || '?'}–${todayShift.end_time || '?'})` : ' — no shift assigned for today'}.
          If you miss clock-out, the system auto-closes at shift end.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
          <button class="btn btn-success" data-clock="clock_in" ${att.clock_in ? 'disabled' : ''}>Clock In</button>
          <button class="btn btn-warning" data-clock="break_start" ${!att.clock_in || att.clock_out ? 'disabled' : ''}>Start Break</button>
          <button class="btn btn-ghost" data-clock="break_end" ${!att.break_start || att.break_end ? 'disabled' : ''}>End Break</button>
          <button class="btn btn-danger" data-clock="clock_out" ${!att.clock_in || att.clock_out ? 'disabled' : ''}>Clock Out</button>
        </div>
        <p class="muted" style="margin-top:10px;font-size:13px">
          In: ${att.clock_in ? Utils.formatDateTime(att.clock_in) : '—'} ·
          Break: ${att.break_start ? Utils.formatDateTime(att.break_start) : '—'} → ${att.break_end ? Utils.formatDateTime(att.break_end) : '—'} ·
          Out: ${att.clock_out ? Utils.formatDateTime(att.clock_out) : '—'}
          ${att.auto_closed ? ' · <span style="color:var(--warning)">Auto-closed</span>' : ''}
        </p>
      </div></div>
      <div class="card" style="margin-top:16px"><div class="card-body">
        <h4>Hours &amp; History</h4>
        <p class="muted" style="font-size:13px">Showing <strong>${histFrom}</strong> → <strong>${histTo}</strong>.
          This week is ${weekStart} → ${weekEnd}. Filter any dates to review older records; a new week starts each Monday.</p>
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
            <td>${d.clock_in ? Utils.formatDateTime(d.clock_in) : '—'}</td>
            <td>${d.break_start ? Utils.formatDateTime(d.break_start) : '—'}${d.break_end ? ` → ${Utils.formatDateTime(d.break_end)}` : ''}</td>
            <td>${d.clock_out ? Utils.formatDateTime(d.clock_out) : '—'}</td>
            <td><strong>${d.hours_worked ?? 0}h</strong></td>
            <td>${d.auto_closed ? 'Auto-closed' : (d.admin_entered ? 'Admin entry' : (d.status || '—'))}</td>
          </tr>`).join('') || '<tr><td colspan="6" class="muted">No clock records in this range (no clock-in = 0 hours)</td></tr>'}
        </tbody></table></div>
        <p style="margin-top:8px"><strong>Period total: ${hist.total_hours || 0}h</strong> · Days with clock-in: ${hist.days_worked || 0}</p>
      </div></div>
      <div class="card" style="margin-top:16px"><div class="card-body">
        <h4>My Shifts (${scheduleStart} → ${scheduleEnd})</h4>
        ${myShifts.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Shift</th><th>Opening</th><th>Closing</th></tr></thead>
          <tbody>${myShifts.map(s => `<tr><td>${s.shift_date}</td><td>${s.is_rest_day ? 'Rest day' : (s.shift_name || '—')}</td>
            <td>${s.is_rest_day ? '—' : (s.start_time || '—')}</td>
            <td>${s.is_rest_day ? '—' : (s.end_time || '—')}</td></tr>`).join('')}</tbody></table></div>`
          : '<p class="muted">No shifts scheduled in this period. Ask admin to generate shifts in Admin → Staff → Shifts and link your user to your employee profile.</p>'}
      </div></div>
      ${hrSubmissions.length ? `<div class="card" style="margin-top:16px;border-color:var(--primary)"><div class="card-body">
        <h4>HR Forms & Documents</h4>
        <p class="muted" style="font-size:13px">Complete assigned training, probation, or employment forms and upload supporting documents.</p>
        ${hrSubmissions.map(s => `<div style="padding:10px 0;border-bottom:1px solid var(--border)">
          <strong>${s.template_type}</strong> — ${s.template_title || 'Form'} · <span class="tag">${s.submitted_at ? 'Submitted' : 'Pending'}</span>
          ${s.status === 'pending' && !s.submitted_at ? `<details style="margin-top:8px"><summary class="muted" style="cursor:pointer;font-size:12px">View agreement template</summary>
            <pre style="white-space:pre-wrap;font-size:11px;max-height:160px;overflow:auto;margin-top:8px;background:var(--bg-secondary);padding:8px;border-radius:6px">${Utils.escHtml((s.filled_data?.template_body || '').slice(0, 2000))}</pre></details>
            <div style="margin-top:8px">
            <textarea id="hr-form-${s.id}" rows="4" style="width:100%" placeholder="Fill in employee details and sign-off notes…">${Utils.escHtml(s.filled_data?.employee_response || '')}</textarea>
            <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
              <button class="btn btn-sm btn-ghost hr-upload-doc" data-id="${s.id}">Upload CV / Document</button>
              <button class="btn btn-sm btn-primary hr-submit-form" data-id="${s.id}">Submit to Admin</button>
            </div>
          </div>` : `<p class="muted" style="font-size:12px;margin-top:4px">${s.submitted_at ? `Submitted ${Utils.formatDateTime(s.submitted_at)}` : `Updated ${Utils.formatDateTime(s.updated_at || s.created_at)}`} · ${s.status}</p>`}
        </div>`).join('')}
      </div></div>` : ''}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px">
        <div class="card"><div class="card-body">
          <h4>Leave Balance</h4>
          <p>Annual: ${(bal.annual?.total || 0) - (bal.annual?.used || 0)} left</p>
          <p>Sick: ${(bal.sick?.total || 0) - (bal.sick?.used || 0)} left</p>
          <p>Family: ${(bal.family?.total || 0) - (bal.family?.used || 0)} left</p>
          <p class="muted" style="font-size:12px;margin-top:8px">
            Portal: <strong>${leaveOpen ? 'Open' : 'Closed'}</strong> · Sick leave always allowed
            ${maxMonth ? `<br>Requests this month: ${portalSettings.requests_this_month || 0} / ${maxMonth}` : ''}
            ${maxYear ? `<br>Requests this year: ${portalSettings.requests_this_year || 0} / ${maxYear}` : ''}
          </p>
          ${(portalSettings.active_blackouts || []).length ? `<p class="muted" style="font-size:12px;color:var(--warning)">Blackout periods apply — only sick leave allowed on blocked dates.</p>` : ''}
          <button class="btn btn-primary btn-sm" id="staff-request-leave" style="margin-top:8px">Request Leave</button>
        </div></div>
        <div class="card"><div class="card-body">
          <h4>Recent Payslips</h4>
          ${payroll.length ? payroll.map(p => `<div style="padding:6px 0;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px">
            <span>${p.period_start} – ${p.period_end}<br><small class="muted">${p.status}</small></span>
            <span style="display:flex;align-items:center;gap:4px;flex-wrap:wrap">
              <strong>${Utils.formatMoney(p.net_salary, currency)}</strong>
              <button class="btn btn-sm btn-ghost dl-payslip" data-id="${p.id}" title="Download PDF">PDF</button>
              ${emp.phone ? `<button class="btn btn-sm btn-success wa-payslip" data-id="${p.id}" title="WhatsApp payslip summary">WhatsApp</button>` : ''}
            </span>
          </div>`).join('') : '<p class="muted">No payslips yet</p>'}
        </div></div>
      </div>
      <div class="card" style="margin-top:16px"><div class="card-body">
        <h4>My Leave Requests</h4>
        ${leaves.length ? leaves.slice(0, 8).map(l => {
          const ended = (l.end_date || l.start_date) <= Utils.today();
          const needsProof = l.status === 'approved' && ended && /sick/i.test(l.leave_type || '') && !l.proof_confirmed_at;
          const proofPending = l.proof_path && !l.proof_confirmed_at;
          return `<div style="padding:10px 0;border-bottom:1px solid var(--border)">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">
              <span>${l.leave_type} · ${l.start_date} – ${l.end_date} · <strong>${l.status}</strong>
                ${proofPending ? '<br><small style="color:var(--warning)">Proof submitted — awaiting admin confirmation</small>' : ''}
                ${l.proof_confirmed_at ? '<br><small style="color:var(--success)">Proof confirmed</small>' : ''}
              </span>
              ${l.status === 'approved' ? `<span style="display:flex;gap:4px;flex-wrap:wrap">
                <button class="btn btn-sm btn-ghost lv-pdf" data-id="${l.id}">PDF</button>
                ${emp.phone ? `<button class="btn btn-sm btn-success lv-wa" data-id="${l.id}">WhatsApp</button>` : ''}
              </span>` : ''}
            </div>
            ${needsProof && !l.proof_path ? `<div style="margin-top:8px;padding:10px;background:var(--bg-secondary);border-radius:8px">
              <small class="muted">Upload sick leave proof (doctor's note / certificate)</small>
              <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
                <button class="btn btn-sm btn-ghost lv-proof-upload" data-id="${l.id}" title="Upload picture">🖼 Upload</button>
                <button class="btn btn-sm btn-primary lv-proof-camera" data-id="${l.id}" title="Take photo">📷 Take Photo</button>
              </div>
            </div>` : ''}
          </div>`;
        }).join('') : '<p class="muted">No leave requests</p>'}
      </div></div>
      ${portalSettings.show_disciplinary !== false ? `<div class="card" style="margin-top:16px"><div class="card-body">
        <h4>Warnings, Hearings & Disciplinary</h4>
        ${disciplinary.length ? disciplinary.map(d => `<div style="padding:10px 0;border-bottom:1px solid var(--border)">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">
            <span><strong>${d.record_type}</strong> · ${d.incident_date}<br>
            <small>${d.description || ''}</small>
            ${d.action_taken ? `<br><small class="muted">Action: ${d.action_taken}</small>` : ''}
            ${d.worker_response ? `<br><small style="color:var(--success)">Your response: ${d.worker_response}</small>` : ''}
            </span>
            <span style="display:flex;gap:4px;flex-wrap:wrap">
              <button class="btn btn-sm btn-ghost disc-pdf" data-id="${d.id}">PDF</button>
              <button class="btn btn-sm btn-ghost disc-print" data-id="${d.id}">Print</button>
              ${emp.phone ? `<button class="btn btn-sm btn-success disc-wa" data-id="${d.id}">WhatsApp</button>` : ''}
            </span>
          </div>
          ${!d.worker_response && d.requires_response && d.status !== 'responded' ? `<div style="margin-top:8px">
            <textarea id="disc-resp-${d.id}" rows="2" placeholder="Your written response…" style="width:100%"></textarea>
            <button class="btn btn-sm btn-primary disc-respond" data-id="${d.id}" style="margin-top:6px">Submit Response</button>
          </div>` : ''}
        </div>`).join('') : '<p class="muted">No disciplinary records</p>'}
      </div></div>` : ''}
    </div>`;

    el.querySelectorAll('[data-clock]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const r = await API.staffClock(emp.id, btn.dataset.clock, this.employeePin ? { pin: this.employeePin } : undefined);
        if (!r.success) return Utils.toast(r.error, 'error');
        Utils.toast('Recorded', 'success');
        this.render(this.el, this.app);
      });
    });
    document.getElementById('att-hist-go')?.addEventListener('click', () => {
      this._attHistFrom = document.getElementById('att-hist-from')?.value || weekStart;
      this._attHistTo = document.getElementById('att-hist-to')?.value || weekEnd;
      this.render(this.el, this.app);
    });
    document.getElementById('att-hist-week')?.addEventListener('click', () => {
      this._attHistFrom = weekStart;
      this._attHistTo = weekEnd;
      this.render(this.el, this.app);
    });
    document.getElementById('staff-logout-worker').addEventListener('click', () => {
      this.employee = null;
      this.employeePin = null;
      this.render(this.el, this.app);
    });
    el.querySelectorAll('.ack-portal-warn').forEach(btn => btn.addEventListener('click', async () => {
      await API.ackChecklistWarning(parseInt(btn.dataset.id, 10), this.app.user);
      Utils.toast('Warning dismissed', 'success');
      this.render(this.el, this.app);
    }));
    el.querySelectorAll('.hr-submit-form').forEach(btn => btn.addEventListener('click', async () => {
      const id = parseInt(btn.dataset.id, 10);
      const response = document.getElementById(`hr-form-${id}`)?.value.trim();
      if (!response) return Utils.toast('Fill in the form before submitting', 'error');
      const r = await API.submitHrStaffForm({ id, require_cv: true, filled_data: { employee_response: response, completed_form: response } }, this.hrActor(emp));
      if (!r.success) return Utils.toast(r.error, 'error');
      Utils.toast('Form submitted to admin', 'success');
      this.render(this.el, this.app);
    }));
    el.querySelectorAll('.hr-upload-doc').forEach(btn => btn.addEventListener('click', async () => {
      const pick = await API.selectDocument('doc');
      if (!pick.success || !pick.path) return;
      const r = await API.attachHrSubmissionDoc(parseInt(btn.dataset.id, 10), pick.path, this.hrActor(emp));
      if (!r.success) return Utils.toast(r.error, 'error');
      Utils.toast('Document attached', 'success');
    }));
    document.getElementById('staff-request-leave').addEventListener('click', () => this.showLeaveForm(leaveTypes, portalSettings));
    el.querySelectorAll('.disc-respond').forEach(btn => {
      btn.addEventListener('click', async () => {
        const text = document.getElementById(`disc-resp-${btn.dataset.id}`)?.value.trim();
        if (!text) return Utils.toast('Enter your response', 'error');
        const r = await API.respondStaffDisciplinary(parseInt(btn.dataset.id), emp.id, text);
        if (!r.success) return Utils.toast(r.error, 'error');
        Utils.toast('Response saved', 'success');
        this.render(this.el, this.app);
      });
    });
    el.querySelectorAll('.dl-payslip').forEach(btn => {
      btn.addEventListener('click', async () => {
        const buf = await API.getStaffPayslipPdf(parseInt(btn.dataset.id, 10));
        if (!buf.success) return Utils.toast(buf.error, 'error');
        await API.saveFile(`payslip-${btn.dataset.id}.pdf`, [{ name: 'PDF', extensions: ['pdf'] }], buf.data);
        Utils.toast('Payslip saved', 'success');
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
        const buf = await API.getStaffLeavePdf(parseInt(btn.dataset.id, 10));
        if (!buf.success) return Utils.toast(buf.error, 'error');
        await API.saveFile(`leave-${btn.dataset.id}.pdf`, [{ name: 'PDF', extensions: ['pdf'] }], buf.data);
        Utils.toast('Leave PDF saved', 'success');
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
      Utils.toast('Proof submitted — admin will confirm', 'success');
      this.render(this.el, this.app);
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
        const buf = await API.getStaffDisciplinaryPdf(parseInt(btn.dataset.id, 10), 'staff');
        if (!buf.success) return Utils.toast(buf.error, 'error');
        await API.saveFile(`disciplinary-${btn.dataset.id}.pdf`, [{ name: 'PDF', extensions: ['pdf'] }], buf.data);
        Utils.toast('PDF saved', 'success');
      });
    });
    el.querySelectorAll('.disc-print').forEach(btn => {
      btn.addEventListener('click', async () => {
        const buf = await API.getStaffDisciplinaryPdf(parseInt(btn.dataset.id, 10), 'staff');
        if (!buf.success) return Utils.toast(buf.error, 'error');
        await API.saveFile(`disciplinary-${btn.dataset.id}.pdf`, [{ name: 'PDF', extensions: ['pdf'] }], buf.data);
      });
    });
    el.querySelectorAll('.disc-wa').forEach(btn => {
      btn.addEventListener('click', async () => {
        const d = disciplinary.find(x => String(x.id) === btn.dataset.id);
        if (!d) return;
        const phone = emp.phone;
        if (!phone) return Utils.toast('No phone on your employee record', 'error');
        const msg = `${d.record_type} — ${d.incident_date}\n${d.description || ''}\n${d.action_taken ? `Action: ${d.action_taken}` : ''}`;
        Utils.openWhatsApp(phone, msg);
      });
    });

    if (this.canDoRoutines(this.app, emp)) {
      const routinesEl = document.getElementById('staff-routines-panel');
      if (routinesEl) await this.renderStaffRoutines(routinesEl);
    }

    document.getElementById('eom-self-wa')?.addEventListener('click', async () => {
      const actor = { ...this.app.user, employee_id: emp.id };
      const r = await API.sendEmployeeOfMonthCertificateWhatsApp(emp.id, actor);
      if (!r.success) return Utils.toast(r.error, 'error');
      if (r.data?.url) window.open(r.data.url, '_blank');
      Utils.toast('Certificate sent to your WhatsApp', 'success');
    });
  },

  async renderStaffRoutines(el) {
    this._routineTab = this._routineTab || 'opening';
    el.innerHTML = `<div class="card" style="border:2px solid var(--primary)"><div class="card-body">
      <h4>✅ Today's Assigned Tasks</h4>
      <p class="muted">Admin assigns these in Operations → Morning/Closing. Tick every checkbox, then <strong>Submit to Admin</strong>.</p>
      <div class="form-tabs" id="staff-routine-tabs">
        <button type="button" class="form-tab ${this._routineTab === 'opening' ? 'active' : ''}" data-rtab="opening">Morning Tasks</button>
        <button type="button" class="form-tab ${this._routineTab === 'closing' ? 'active' : ''}" data-rtab="closing">Closing Tasks</button>
      </div>
      <div id="staff-routine-content"><p class="muted">Loading…</p></div>
    </div></div>`;

    el.querySelector('#staff-routine-tabs').addEventListener('click', (e) => {
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
        : `No ${type === 'opening' ? 'morning' : 'closing'} tasks are assigned to you. Ask admin to assign tasks to your name (or “Any worker”).`);

    el.innerHTML = `
      <h4 style="margin-top:12px">${label}</h4>
      <p class="muted" style="margin:4px 0 0">Tick <strong>every</strong> task checkbox, then submit before <strong>${deadline}</strong>.${intervalMin > 0 ? ` Wait <strong>${intervalMin} min</strong> between checkboxes.` : ''} After the deadline you cannot submit — it is recorded as failed and affects Employee of the Month.</p>
      ${canEdit && pastDeadline ? `<p style="color:var(--danger);margin:8px 0 0">Deadline ${deadline} has passed — submit is locked.</p>` : ''}
      ${canEdit && !allDone ? `<p class="muted" style="margin:8px 0 0">Submit unlocks when all ${items.length} checkbox(es) are done (${items.filter(i => i.item_status === 'done' || (!i.item_status && i.completed)).length}/${items.length}).</p>` : ''}
      <div style="display:flex;gap:8px;margin:12px 0;flex-wrap:wrap">
        ${!activeRun || activeRun.status === 'confirmed' || (isFailed && !(activeRun.items || []).length) ? `<button class="btn btn-primary btn-sm" id="sr-start">Start Today's Tasks</button>` : ''}
        ${canEdit ? `<button class="btn btn-success btn-sm" id="sr-submit" ${canSubmit ? '' : 'disabled title="Complete all checkboxes before the deadline"'}>Submit to Admin</button>` : ''}
        ${activeRun ? `<button class="btn btn-ghost btn-sm" id="sr-pdf">PDF</button>
          <button class="btn btn-ghost btn-sm" id="sr-print">Print</button>` : ''}
      </div>
      ${activeRun ? `<p><strong>Status:</strong> ${activeRun.status}
        ${activeRun.submitted_at ? ` · Submitted ${Utils.formatDateTime(activeRun.submitted_at)}` : ''}
        ${isFailed ? ` · <span style="color:var(--danger)">${Utils.escHtml(activeRun.failure_reason || 'Failed — deadline missed')}</span>` : ''}</p>
        ${(activeRun.items || []).map(i => {
          const done = i.item_status === 'done' || (!i.item_status && i.completed);
          const locked = activeRun.status === 'submitted' || activeRun.status === 'confirmed' || isFailed;
          return `<label style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);cursor:${canEdit && !locked ? 'pointer' : 'default'}">
            <input type="checkbox" class="sr-check" data-id="${i.id}" ${done ? 'checked' : ''} ${!canEdit || locked || done ? 'disabled' : ''} style="width:18px;height:18px;accent-color:var(--success)">
            <span style="flex:1">${i.task_name}</span>
            ${done ? `<small class="muted">${i.employee_name || ''}${i.comments ? ` — ${i.comments}` : ''}</small>` : ''}
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
      if (pastDeadline) return Utils.toast(`Deadline ${deadline} has passed — cannot submit`, 'error');
      if (!allDone) return Utils.toast('Tick every task checkbox before submitting', 'error');
      const r = await API.submitChecklistRun(activeRun.id, this.staffRoutineActor(empIdOk));
      if (r.success) {
        Utils.toast('Submitted to admin', 'success');
        this._staffRoutineRun = r.data;
        this.renderStaffRoutineTab(el, type);
      } else Utils.toast(r.error, 'error');
    });
    const pdfFn = async () => {
      const r = await API.getChecklistReportPdf(activeRun.id);
      if (!r.success) { Utils.toast(r.error, 'error'); return null; }
      return r;
    };
    document.getElementById('sr-pdf')?.addEventListener('click', async () => {
      const r = await pdfFn();
      if (r?.success) await API.saveFile(`${type}-routine-${Utils.today()}.pdf`, [{ name: 'PDF', extensions: ['pdf'] }], r.data);
    });
    document.getElementById('sr-print')?.addEventListener('click', async () => {
      const r = await pdfFn();
      if (r?.success) await API.openPdf(r.data, `${type}-routine.pdf`);
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
      return Utils.toast('Leave requests are closed. Contact admin — only sick leave is accepted when closed.', 'error');
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
        ${(portalSettings.active_blackouts || []).length ? `<p class="muted full">Some dates are blocked by admin — sick leave is exempt.</p>` : ''}
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
      Utils.toast('Leave request submitted', 'success');
      this.render(this.el, this.app);
    });
  }
};
window.StaffPage = StaffPage;

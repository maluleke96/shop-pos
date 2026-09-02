/**
 * HR, Payroll & Documents — unified workspace
 * Export: window.HrApp
 */
const HR_APP_BUILD = '2026.09.02-hr-full-parity';

const HrApp = {
  build: HR_APP_BUILD,
  view: 'login',
  section: 'dashboard',
  user: null,
  container: null,
  app: null,
  profileId: null,
  loginError: '',
  _delegated: false,
  _navOpen: false,
  _exportCache: {},

  NAV: [
    ['Dashboard', [['dashboard', 'Dashboard']]],
    ['Workers', [
      ['employees', 'All Workers'], ['casual-workers', 'Casual Workers'], ['contractors', 'Contractors'],
      ['applicants', 'Applicants'], ['employee-profile', 'Worker Profile']
    ]],
    ['Payroll', [
      ['payroll-runs', 'Payroll Runs'], ['salaries', 'Salaries'], ['payslips', 'Payslips'],
      ['salary-claims', 'Salary Claims'], ['deductions', 'Deductions'], ['bonuses', 'Bonuses'],
      ['commissions', 'Commissions'], ['advances', 'Advances'], ['loans', 'Loans']
    ]],
    ['Tax & Statutory', [
      ['sars', 'SARS / EMP201'], ['paye', 'PAYE'], ['uif', 'UIF'], ['sdl', 'SDL'], ['coida', 'COIDA'],
      ['statutory', 'Other Statutory'], ['employer-records', 'Employer Records'], ['deadlines', 'Deadlines']
    ]],
    ['Attendance', [
      ['clock-ins', 'Clock-ins'], ['hours', 'Hours'], ['overtime', 'Overtime'],
      ['absences', 'Absences'], ['late-arrivals', 'Late Arrivals'], ['shifts', 'Shift Schedule'],
      ['login-selfies', 'Login Selfies'], ['login-events', 'Login Events']
    ]],
    ['Leave', [['leave-requests', 'Requests'], ['leave-balances', 'Balances'], ['leave-approvals', 'Approvals']]],
    ['Contracts', [
      ['contract-templates', 'Templates'], ['contracts-active', 'Active Contracts'],
      ['contracts-expiring', 'Expiring'], ['contracts-expired', 'Expired']
    ]],
    ['Documents', [
      ['documents-all', 'All Documents'], ['documents-required', 'Required'],
      ['documents-expiring', 'Expiring'], ['documents-expired', 'Expired']
    ]],
    ['Onboarding', [['onboarding', 'Onboarding']]],
    ['Offboarding', [['offboarding', 'Offboarding']]],
    ['Discipline', [
      ['incidents', 'Incidents'], ['investigations', 'Investigations'], ['warnings', 'Warnings'],
      ['penalties', 'Penalties'], ['hearings', 'Hearings'], ['appeals', 'Appeals']
    ]],
    ['Performance', [['performance', 'Performance']]],
    ['Training', [['training', 'Training']]],
    ['Policies', [['policies', 'Policies']]],
    ['Business Rules', [['business-rules', 'Business Rules']]],
    ['Forms', [['forms', 'Forms']]],
    ['Requests', [['requests', 'Requests']]],
    ['Approvals', [['approvals', 'Approvals']]],
    ['Compliance', [['compliance', 'Compliance']]],
    ['Reports', [['reports', 'Reports'], ['alerts', 'Alerts']]],
    ['Audit', [['audit-log', 'Audit Log']]],
    ['Administration', [['settings', 'Settings']]]
  ],

  SECTION_META: {
    dashboard: ['Dashboard', 'Workforce, payroll, documents and compliance overview.'],
    employees: ['All Workers', 'Permanent and active workers — same records as Admin → Staff & HR.'],
    'casual-workers': ['Casual Workers', 'Casual and temporary staff.'],
    contractors: ['Contractors', 'Independent contractors and consultants.'],
    applicants: ['Applicants', 'Job candidates from recruitment.'],
    'employee-profile': ['Worker Profile', 'Complete worker hub — contracts, payroll, history.'],
    'payroll-runs': ['Payroll Runs', 'Draft, review, approve and finalize payroll.'],
    salaries: ['Salaries', 'Salary and wage configuration per employee.'],
    payslips: ['Payslips', 'Generated payslips — also visible on Staff Portal when payday opens.'],
    'salary-claims': ['Salary Claims', 'Staff claim windows — Admin must approve before payment. Same as Admin → Payroll.'],
    deductions: ['Deductions', 'Payroll deductions from processed runs.'],
    bonuses: ['Bonuses', 'Bonus payments in payroll records.'],
    commissions: ['Commissions', 'Commission payments in payroll records.'],
    advances: ['Salary Advances', 'Outstanding and recovered salary advances.'],
    loans: ['Employee Loans', 'Active loans and balances.'],
    sars: ['SARS / EMP201', 'Monthly EMP201 liability, tax office and IRP5-year totals — linked to Admin Payroll.'],
    paye: ['PAYE', 'Pay-As-You-Earn totals and configuration (SARS).'],
    uif: ['UIF', 'Unemployment Insurance Fund totals and settings.'],
    sdl: ['SDL', 'Skills Development Levy totals and settings.'],
    coida: ['COIDA', 'Compensation for Occupational Injuries and Diseases.'],
    statutory: ['Other Statutory', 'Additional statutory deductions and notes.'],
    'employer-records': ['Employer Records', 'UIF/SDL/PAYE/COIDA employer registration records.'],
    deadlines: ['Compliance Deadlines', 'Upcoming statutory and HR deadlines (EMP201, UIF, SARS).'],
    'clock-ins': ['Clock-ins', 'Staff clock-in and clock-out records (shared with Staff Portal).'],
    hours: ['Hours Worked', 'Hours worked per shift and day.'],
    overtime: ['Overtime', 'Overtime hours and pay.'],
    absences: ['Absences', 'Missed shifts and absent days.'],
    'late-arrivals': ['Late Arrivals', 'Late clock-ins and attendance penalties.'],
    shifts: ['Shift Schedule', 'Weekly shift rota — same data as Admin Staff & HR.'],
    'login-selfies': ['Login Selfies', 'Staff Portal verification selfies — same as Admin → Staff & HR.'],
    'login-events': ['Login Events', 'Late/early Staff Portal login log.'],
    'leave-requests': ['Leave Requests', 'All leave applications.'],
    'leave-balances': ['Leave Balances', 'Annual, sick and family leave balances.'],
    'leave-approvals': ['Leave Approvals', 'Pending leave awaiting manager approval.'],
    'contract-templates': ['Contract Templates', 'Reusable contract templates from Admin → Contracts.'],
    'contracts-active': ['Active Contracts', 'Signed and active worker contracts.'],
    'contracts-expiring': ['Expiring Contracts', 'Contracts due to expire soon.'],
    'contracts-expired': ['Expired Contracts', 'Contracts that have ended.'],
    'documents-all': ['All Documents', 'Worker documents on file — shared with Admin Staff & HR.'],
    'documents-required': ['Required Documents', 'ID, contracts and other required worker documents.'],
    'documents-expiring': ['Expiring Documents', 'Documents expiring within 30 days.'],
    'documents-expired': ['Expired Documents', 'Documents past their expiry date.'],
    policies: ['Policies', 'Policy centre with version control and acknowledgements.'],
    compliance: ['Compliance Centre', 'Statutory, contracts, documents and policy status.'],
    incidents: ['Incidents', 'Incident register and investigations.'],
    investigations: ['Investigations', 'Open disciplinary investigations.'],
    warnings: ['Warnings', 'Formal warnings and disciplinary records.'],
    penalties: ['Penalties', 'Attendance penalties pending approval.'],
    hearings: ['Disciplinary Hearings', 'Scheduled and completed hearings.'],
    appeals: ['Appeals', 'Disciplinary appeals in progress.'],
    onboarding: ['Onboarding', 'Employee onboarding checklists and progress.'],
    offboarding: ['Offboarding', 'Employee exit workflows and checklists.'],
    performance: ['Performance', 'Probation reviews and sales performance.'],
    training: ['Training', 'Training records, templates and staff submissions.'],
    'business-rules': ['Business Rules', 'Rules that apply to roles, branches and employment types.'],
    forms: ['Forms', 'HR forms and staff submission templates.'],
    requests: ['HR Requests', 'Employee requests awaiting review.'],
    approvals: ['Approvals', 'HR submits actions here; owner/manager finalizes. Includes salary claims awaiting approve.'],
    reports: ['Reports', 'Export and print HR reports.'],
    alerts: ['Alerts', 'Staff & payroll notifications — same feed as Admin Staff & HR Alerts.'],
    'audit-log': ['Audit Log', 'Recent HR-related system audit entries.'],
    settings: ['Settings', 'HR platform and payroll configuration.']
  },

  ensureCss() {
    const href = 'css/hr-command.css';
    if (typeof Utils !== 'undefined' && Utils.loadStylesheet) Utils.loadStylesheet(href).catch(() => {});
    else if (!document.querySelector(`link[href$="${href}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      document.head.appendChild(link);
    }
  },

  esc(v) {
    return (typeof Utils !== 'undefined' && Utils.escHtml) ? Utils.escHtml(v) : String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },

  money(n) {
    const c = this.app?.settings?.currency || 'R';
    return (typeof Utils !== 'undefined' && Utils.formatMoney) ? Utils.formatMoney(Number(n) || 0, c) : `${c}${(Number(n) || 0).toFixed(2)}`;
  },

  toast(msg, type) {
    if (typeof Utils !== 'undefined' && Utils.toast) Utils.toast(msg, type || 'info');
    else console.log(`[${type}]`, msg);
  },

  today() {
    return (typeof Utils !== 'undefined' && Utils.today) ? Utils.today() : new Date().toLocaleDateString('en-CA');
  },

  dateOffset(days) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toLocaleDateString('en-CA');
  },

  attendanceView() {
    const map = {
      'clock-ins': 'clock-ins', hours: 'hours', overtime: 'overtime',
      absences: 'absences', 'late-arrivals': 'late-arrivals'
    };
    return map[this.section] || 'clock-ins';
  },

  disciplinarySection() {
    if (['investigations', 'hearings', 'appeals'].includes(this.section)) return this.section;
    return null;
  },

  async staffApi(method, ...args) {
    if (typeof API === 'undefined' || typeof API[method] !== 'function') return null;
    const withActor = new Set([
      'getAllStaffLeave', 'getAttendancePenalties', 'getSalaryAdvances', 'getEmployeeLoans',
      'getJobCandidates', 'getHrTrainingRecords', 'getHrStaffSubmissions', 'getAllStaffDisciplinary',
      'getHrContracts', 'getContractTemplates', 'approveStaffLeave', 'payStaffSalary',
      'issueSalaryAdvance', 'saveEmployeeLoan', 'saveStaffLeave', 'saveStaffDisciplinary',
      'addAttendancePenalty', 'cancelAttendancePenalty', 'saveStaffSchedule', 'getStaffSchedulePrintHtml',
      'getPayrollReport', 'getPayrollCompliancePdf', 'adminOpenStaffPortal'
    ]);
    const callArgs = withActor.has(method) ? [...args, this.user] : args;
    return this.apiOk(API[method](...callArgs), `${method} failed`);
  },

  async apiCall(method, ...args) {
    if (typeof API === 'undefined' || typeof API[method] !== 'function') {
      this.toast(`HR API unavailable: ${method}. Quit and reopen the app, or reinstall the latest Admin/HR build.`, 'error');
      return null;
    }
    const noActor = new Set(['hrLogin']);
    const callArgs = (method.startsWith('hr') && !noActor.has(method)) ? [...args, this.user] : args;
    return this.apiOk(API[method](...callArgs), `${method} failed`);
  },

  async apiOk(promise, fallbackMsg) {
    let r;
    try { r = await promise; } catch (err) {
      this.toast(err?.message || fallbackMsg, 'error');
      return null;
    }
    if (!r || r.success === false) {
      const msg = (r && (r.error || r.message)) || fallbackMsg;
      if (msg) this.toast(msg, 'error');
      return null;
    }
    return r.data !== undefined ? r.data : r;
  },

  /** Coerce API payloads to arrays (handles null, {rows}, accidental objects). */
  asRows(data) {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.rows)) return data.rows;
    if (data && Array.isArray(data.items)) return data.items;
    if (data && Array.isArray(data.documents)) return data.documents;
    return [];
  },

  btn(label, act, data = {}, cls = '') {
    const attrs = Object.entries(data).map(([k, v]) => `data-hr-${k}="${this.esc(v)}"`).join(' ');
    return `<button type="button" class="btn btn-sm ${cls}" data-hr-act="${this.esc(act)}" ${attrs}>${this.esc(label)}</button>`;
  },

  panel(title, body, actions = '') {
    return `<div class="hr-panel"><div class="hr-panel-head"><strong>${this.esc(title)}</strong>${actions}</div><div class="hr-panel-body">${body}</div></div>`;
  },

  table(headers, rows, empty = 'No records') {
    if (!rows) return `<div class="hr-empty">${this.esc(empty)}</div>`;
    return `<div class="hr-table-wrap"><table class="hr-table"><thead><tr>${headers.map((h) => `<th>${this.esc(h)}</th>`).join('')}</tr></thead><tbody>${rows || `<tr><td colspan="${headers.length}" class="hr-empty">${this.esc(empty)}</td></tr>`}</tbody></table></div>`;
  },

  kpi(label, value, hint = '', tone = 'accent') {
    return `<div class="hr-kpi hr-kpi-${tone}"><div class="hr-kpi-label">${this.esc(label)}</div><div class="hr-kpi-value">${this.esc(value)}</div>${hint ? `<div class="hr-kpi-hint">${this.esc(hint)}</div>` : ''}</div>`;
  },

  sectionHead(actions = '') {
    const meta = this.SECTION_META[this.section] || ['HR', ''];
    return `<div class="hr-section-head"><div><h2>${this.esc(meta[0])}</h2><p class="muted">${this.esc(meta[1])}</p></div><div class="hr-section-actions">${actions}</div></div>`;
  },

  navHtml() {
    return this.NAV.map(([group, items]) => `<div class="hr-nav-group"><div class="hr-nav-label">${this.esc(group)}</div>${items.map(([id, label]) =>
      `<button type="button" class="hr-nav-btn ${this.section === id ? 'active' : ''}" data-hr-act="nav" data-section="${id}">${this.esc(label)}</button>`).join('')}</div>`).join('');
  },

  async render(container, app) {
    this.container = container;
    this.app = app;
    this.ensureCss();
    if (this.view === 'login') return this.renderLogin();
    return this.renderShell();
  },

  renderLogin() {
    this.container.innerHTML = `<div class="hr-root"><div class="hr-login-card">
      <div class="hr-brand-mark">HR</div>
      <h1>HR, Payroll &amp; Documents</h1>
      <p class="muted">Human Resources, Payroll, Employee Records, Contracts &amp; Compliance</p>
      ${this.loginError ? `<p class="error-msg">${this.esc(this.loginError)}</p>` : ''}
      <div class="field"><label>Username</label><input id="hr-login-user" autocomplete="username"></div>
      <div class="field"><label>Password</label><input type="password" id="hr-login-pass" autocomplete="current-password"></div>
      <button type="button" class="btn btn-primary btn-block" data-hr-act="login-submit">Sign In</button>
      <button type="button" class="btn btn-ghost btn-block" data-hr-act="close">Close</button>
    </div></div>`;
    this.bindActions();
    document.getElementById('hr-login-pass')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.doLogin(); });
  },

  async doLogin() {
    const username = document.getElementById('hr-login-user')?.value?.trim();
    const password = document.getElementById('hr-login-pass')?.value || '';
    this.loginError = '';
    if (!username || !password) { this.loginError = 'Enter username and password.'; this.renderLogin(); return; }
    let r;
    try { r = await API.hrLogin(username, password); } catch (err) { this.loginError = err.message; this.renderLogin(); return; }
    if (!r || r.success === false) { this.loginError = r?.error || 'Login failed'; this.renderLogin(); return; }
    let user = r.data ?? r.user;
    if (user && typeof user === 'object' && user.success && (user.data || user.user)) {
      user = user.data ?? user.user;
    }
    this.user = user;
    this.view = 'app';
    this.toast(`Welcome, ${this.user.full_name || this.user.username}`, 'success');
    await this.renderShell();
  },

  async renderShell() {
    const name = this.user?.full_name || this.user?.username || 'User';
    this.container.innerHTML = `<div class="hr-root"><div class="hr-shell${this._navOpen ? ' hr-nav-open' : ''}">
      <div class="hr-sidebar-backdrop" data-hr-act="nav-close"></div>
      <aside class="hr-sidebar"><div class="hr-brand"><div class="hr-brand-mark">HR</div><div><strong>HR &amp; Payroll</strong><small>Documents &amp; Compliance</small><small class="hr-build-tag">Build ${this.esc(this.build || HR_APP_BUILD)}</small></div></div>
        <nav class="hr-nav" id="hr-nav">${this.navHtml()}</nav></aside>
      <div class="hr-main-wrap">
        <header class="hr-topbar">
          <button type="button" class="btn btn-ghost btn-sm" data-hr-act="nav-toggle">☰</button>
          <div class="hr-search-wrap field"><label for="hr-global-search">Search</label>
            <input type="search" id="hr-global-search" placeholder="Employees, contracts, policies…"></div>
          <div class="hr-topbar-spacer"></div>
          <span class="hr-user-chip">${this.esc(name)}</span>
          <button type="button" class="btn btn-ghost btn-sm" data-hr-act="close">Close</button>
        </header>
        <main class="hr-main" id="hr-body"><p class="muted">Loading…</p></main>
      </div></div></div>`;
    this.bindActions();
    document.getElementById('hr-global-search')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.doSearch(e.target.value);
    });
    await this.refreshSection();
  },

  bindActions() {
    if (this._clickHandler) document.removeEventListener('click', this._clickHandler);
    this._clickHandler = async (e) => {
      const btn = e.target.closest?.('[data-hr-act]');
      if (!btn || !btn.closest('.hr-root')) return;
      const act = btn.dataset.hrAct;
      let fn = this.ACT[act];
      if (!fn) {
        if (act.startsWith('export-')) fn = () => this.exportSection(act.slice(7), 'pdf');
        else if (act.startsWith('print-')) fn = () => this.exportSection(act.slice(6), 'print');
      }
      if (!fn) {
        this.toast(`Action not available: ${act}`, 'warning');
        return;
      }
      e.preventDefault();
      btn.disabled = true;
      try { await fn.call(this, this._actData(btn), btn); } catch (err) { this.toast(err?.message || 'Action failed', 'error'); }
      finally { if (btn.isConnected) btn.disabled = false; }
    };
    document.addEventListener('click', this._clickHandler);
    this._delegated = true;
  },

  _actData(btn) {
    const d = {};
    for (const [key, val] of Object.entries(btn.dataset)) {
      if (key === 'hrAct') continue;
      let k = key;
      if (k.startsWith('hr') && k.length > 2) k = k.charAt(2).toLowerCase() + k.slice(3);
      d[k] = val;
    }
    return d;
  },

  async refreshSection() {
    const nav = document.getElementById('hr-nav');
    if (nav) nav.innerHTML = this.navHtml();
    await this.renderSection();
  },

  closeApp() {
    if (typeof this.app?.closeHr === 'function') { this.app.closeHr(); return; }
    this.user = null;
    this.view = 'login';
    this.render(this.container, this.app);
  },

  async renderSection() {
    const body = document.getElementById('hr-body');
    if (!body) return;
    const map = {
      dashboard: 'renderDashboard',
      employees: 'renderPeople',
      'casual-workers': 'renderPeople',
      contractors: 'renderPeople',
      applicants: 'renderApplicants',
      'employee-profile': 'renderEmployeeProfile',
      'payroll-runs': 'renderPayrollRuns',
      salaries: 'renderSalaries',
      payslips: 'renderPayslips',
      'salary-claims': 'renderSalaryClaims',
      deductions: 'renderDeductions',
      bonuses: 'renderBonuses',
      commissions: 'renderCommissions',
      advances: 'renderAdvances',
      loans: 'renderLoans',
      paye: 'renderStatutory',
      uif: 'renderStatutory',
      sdl: 'renderStatutory',
      coida: 'renderStatutory',
      statutory: 'renderStatutory',
      sars: 'renderSars',
      'employer-records': 'renderEmployerRecords',
      deadlines: 'renderDeadlines',
      'clock-ins': 'renderAttendance',
      hours: 'renderAttendance',
      overtime: 'renderAttendance',
      absences: 'renderAttendance',
      'late-arrivals': 'renderAttendance',
      shifts: 'renderShifts',
      'login-selfies': 'renderLoginSelfies',
      'login-events': 'renderLoginEvents',
      'leave-requests': 'renderLeave',
      'leave-balances': 'renderLeave',
      'leave-approvals': 'renderLeave',
      'contract-templates': 'renderContracts',
      'contracts-active': 'renderContracts',
      'contracts-expiring': 'renderContracts',
      'contracts-expired': 'renderContracts',
      'documents-all': 'renderDocuments',
      'documents-required': 'renderDocuments',
      'documents-expiring': 'renderDocuments',
      'documents-expired': 'renderDocuments',
      onboarding: 'renderOnboarding',
      offboarding: 'renderOffboarding',
      incidents: 'renderIncidents',
      investigations: 'renderDisciplinary',
      warnings: 'renderWarnings',
      penalties: 'renderPenalties',
      hearings: 'renderDisciplinary',
      appeals: 'renderDisciplinary',
      performance: 'renderPerformance',
      training: 'renderTraining',
      policies: 'renderPolicies',
      'business-rules': 'renderBusinessRules',
      forms: 'renderForms',
      requests: 'renderRequests',
      approvals: 'renderApprovals',
      compliance: 'renderCompliance',
      reports: 'renderReports',
      alerts: 'renderAlerts',
      'audit-log': 'renderAudit',
      settings: 'renderSettings'
    };
    const fn = map[this.section] || 'renderDashboard';
    const token = (this._sectionToken = (this._sectionToken || 0) + 1);
    const sectionAtStart = this.section;
    body.innerHTML = `<p class="muted">Loading…</p>`;
    try {
      await this[fn].call(this, body);
      if (token !== this._sectionToken || this.section !== sectionAtStart) return;
    } catch (err) {
      if (token !== this._sectionToken || this.section !== sectionAtStart) return;
      body.innerHTML = `${this.sectionHead('')}<p class="error-msg">${this.esc(err.message)}</p>`;
    }
  },

  peopleType() {
    if (this.section === 'casual-workers') return 'casual';
    if (this.section === 'contractors') return 'contractor';
    return 'active';
  },

  async renderDashboard(el) {
    const d = await this.apiCall('hrDashboard', {}) || {};
    const summary = await this.apiCall('hrStatutorySummary', {}) || {};
    const w = d.workforce || {};
    const p = d.payroll || {};
    const c = d.compliance || {};
    const emp201 = summary.emp201 || {};
    el.innerHTML = `
      ${this.sectionHead(`${this.btn('+ Add Worker', 'add-employee', {}, 'btn-primary')}${this.btn('+ Run Payroll', 'nav', { section: 'payroll-runs' })}${this.btn('SARS / EMP201', 'nav', { section: 'sars' })}`)}
      <div class="hr-quick-actions">
        ${this.btn('Workers', 'nav', { section: 'employees' })}${this.btn('Contracts', 'nav', { section: 'contracts-active' })}
        ${this.btn('Payroll', 'nav', { section: 'payroll-runs' })}${this.btn('UIF', 'nav', { section: 'uif' })}
        ${this.btn('PAYE', 'nav', { section: 'paye' })}${this.btn('Documents', 'nav', { section: 'documents-all' })}
        ${this.btn('Approvals', 'nav', { section: 'approvals' })}${this.btn('Compliance', 'nav', { section: 'compliance' })}
      </div>
      <div class="hr-kpis">
        ${this.kpi('Workers', String(w.total || summary.workers?.total || 0), 'All records', 'accent')}
        ${this.kpi('Active', String(w.active || summary.workers?.active || 0), 'Currently employed', 'good')}
        ${this.kpi('Casual', String(w.casual || summary.workers?.casual || 0), '', 'info')}
        ${this.kpi('Contractors', String(w.contractor || summary.workers?.contractors || 0), '', 'slate')}
        ${this.kpi('Payroll net', this.money(p.net), 'This period', 'accent')}
        ${this.kpi('EMP201 due', this.money(emp201.total_liability), emp201.due_by ? `Due ${emp201.due_by}` : 'This month', 'warn')}
      </div>
      <div class="hr-grid-2">
        ${this.panel('Documents & Contracts', `<div class="hr-note">Expiring documents: <strong>${d.documents?.expiring || 0}</strong><br>Contracts expiring: <strong>${d.contracts?.expiring || 0}</strong><br>Awaiting signature: <strong>${d.contracts?.awaiting_signature || 0}</strong></div>
          ${this.btn('All Documents', 'nav', { section: 'documents-all' })} ${this.btn('Staff & HR Admin', 'open-admin-section', { section: 'staffhr' })}`)}
        ${this.panel('SARS & statutory', `<div class="hr-note">PAYE: <strong>${this.money(emp201.paye)}</strong> · UIF: <strong>${this.money(emp201.uif_total)}</strong> · SDL: <strong>${this.money(emp201.sdl)}</strong><br>
          Policy acknowledgements pending: <strong>${c.pending_acknowledgements || 0}</strong></div>
          ${this.btn('Open SARS / EMP201', 'nav', { section: 'sars' }, 'btn-primary')} ${this.btn('Admin Payroll', 'open-admin-section', { section: 'payroll' })}`)}
      </div>`;
  },

  async renderPeople(el) {
    const type = this.peopleType();
    const rows = this.asRows(await this.apiCall('hrPeople', { personnel_type: type }));
    const exportRows = rows.map((e) => [
      e.employee_code, e.full_name, e.employment_type || '—', e.position || '—', e.department || '—', e.status || 'Active',
      e.paye_registered ? 'Y' : 'N', e.uif_registered ? 'Y' : 'N'
    ]);
    this.cacheExport(this.section, this.SECTION_META[this.section]?.[0] || 'Workers',
      ['ID', 'Name', 'Type', 'Position', 'Department', 'Status', 'PAYE', 'UIF'], exportRows);
    el.innerHTML = `
      ${this.sectionHead(`${this.btn('Add Worker', 'add-employee', {}, 'btn-primary')}${this.btn('Staff & HR Admin', 'open-admin-section', { section: 'staffhr' })}${this.btn('Print', `print-${this.section}`)}${this.btn('PDF', `export-${this.section}`)}${this.btn('Refresh', 'refresh')}`)}
      <p class="muted">Same worker records as Admin → Staff &amp; HR / Staff Portal. Edit employment type and statutory flags there.</p>
      ${this.table(['Employee ID', 'Name', 'Type', 'Position', 'Department', 'PAYE', 'UIF', 'Status', ''],
        rows.map((e) => `<tr>
          <td><span class="hr-code">${this.esc(e.employee_code)}</span></td>
          <td><button type="button" class="btn btn-link" data-hr-act="view-employee" data-id="${e.id}">${this.esc(e.full_name)}</button></td>
          <td>${this.esc(e.employment_type || '—')}</td>
          <td>${this.esc(e.position)}</td><td>${this.esc(e.department)}</td>
          <td>${e.paye_registered ? 'Yes' : '—'}</td><td>${e.uif_registered ? 'Yes' : '—'}</td>
          <td>${this.esc(e.status)}</td>
          <td>${this.btn('Profile', 'view-employee', { id: e.id })}</td></tr>`).join(''), 'No workers found')}`;
  },

  async renderApplicants(el) {
    const rows = await this.staffApi('getJobCandidates', {}) || [];
    el.innerHTML = `
      ${this.sectionHead(`${this.btn('Recruitment Admin', 'open-admin-section', { section: 'recruitment' }, 'btn-primary')}${this.btn('Refresh', 'refresh')}`)}
      ${this.table(['Name', 'Phone', 'Email', 'Posting', 'Status', ''],
        rows.map((c) => `<tr><td>${this.esc(c.full_name || c.name)}</td><td>${this.esc(c.phone)}</td><td>${this.esc(c.email)}</td><td>${this.esc(c.posting_title || c.job_title || c.posting_id)}</td><td>${this.esc(c.status)}</td><td>${this.btn('Open Admin', 'open-admin-section', { section: 'recruitment' })}</td></tr>`).join(''), 'No applicants — add job postings in Admin → Recruitment')}`;
  },

  async renderEmployeeProfile(el) {
    const id = this.profileId || new URLSearchParams(location.hash.replace(/^#/, '')).get('emp');
    if (!id) {
      el.innerHTML = `${this.sectionHead('')}<div class="hr-empty">Select an employee from People → Employees, or search.</div>`;
      return;
    }
    const profile = await this.apiCall('hrEmployeeProfile', parseInt(id, 10));
    if (!profile) return;
    const e = profile.employee;
    const timeline = await this.apiCall('hrEmployeeTimeline', parseInt(id, 10));
    el.innerHTML = `
      ${this.sectionHead(`${this.btn('← Back', 'nav', { section: 'employees' })}${this.btn('Edit in Admin', 'open-admin-section', { section: 'staffhr' })}${this.btn('SARS', 'nav', { section: 'sars' })}`)}
      <div class="hr-profile-header"><h2>${this.esc(e.full_name)}</h2>
        <p><span class="hr-code">${this.esc(e.employee_code)}</span> · ${this.esc(e.status)} · ${this.esc(e.position)} · ${this.esc(e.branch || e.department)}</p></div>
      <div class="hr-kpis">
        ${this.kpi('Basic salary', this.money(e.basic_salary), e.salary_type || 'Monthly')}
        ${this.kpi('Contracts', String(profile.contracts?.length || 0))}
        ${this.kpi('Documents', String(profile.documents?.length || 0))}
        ${this.kpi('Leave records', String(profile.leave?.length || 0))}
      </div>
      <div class="hr-grid-2">
        ${this.panel('Employment', `<dl class="hr-dl"><dt>Start date</dt><dd>${this.esc(e.date_hired || '—')}</dd><dt>Type</dt><dd>${this.esc(e.employment_type)}</dd><dt>Department</dt><dd>${this.esc(e.department)}</dd>
          <dt>PAYE</dt><dd>${e.paye_registered ? 'Registered' : '—'}</dd><dt>UIF</dt><dd>${e.uif_registered ? 'Registered' : '—'}</dd><dt>SDL</dt><dd>${e.sdl_registered ? 'Registered' : '—'}</dd>
          <dt>Tax number</dt><dd>${this.esc(e.tax_number || '—')}</dd><dt>UIF number</dt><dd>${this.esc(e.uif_number || '—')}</dd></dl>`)}
        ${this.panel('Timeline', (timeline?.events || []).slice(-8).reverse().map((ev) =>
          `<div class="hr-timeline-item"><small>${this.esc(String(ev.date).slice(0, 10))}</small> ${this.esc(ev.label)}</div>`).join('') || '<div class="hr-empty">No history yet</div>')}
      </div>
      ${this.panel('Salary history', this.table(['Date', 'Previous', 'New', 'Reason'],
        (profile.salary_history || []).map((s) => `<tr><td>${this.esc(s.effective_date)}</td><td>${this.money(s.previous_amount)}</td><td>${this.money(s.new_amount)}</td><td>${this.esc(s.reason)}</td></tr>`).join(''), 'No salary changes'))}`;
  },

  async renderPayrollRuns(el) {
    const rows = this.asRows(await this.apiCall('hrListPayroll', {}));
    el.innerHTML = `
      ${this.sectionHead(`${this.btn('Generate Payroll', 'generate-payroll', {}, 'btn-primary')}${this.btn('Open Admin Payroll', 'open-admin-section', { section: 'payroll' })}${this.btn('Refresh', 'refresh')}`)}
      ${this.table(['Period', 'Employee', 'Gross', 'Net', 'Status', ''],
        rows.map((r) => `<tr><td>${this.esc(r.period_start)} — ${this.esc(r.period_end)}</td><td>${this.esc(r.full_name || r.employee_name)}</td><td>${this.money(r.gross_salary || r.basic_salary)}</td><td>${this.money(r.net_salary)}</td><td>${this.esc(r.status)}</td><td>${
          r.status === 'pending' ? this.btn('Mark Paid', 'mark-payroll-paid', { id: r.id }) : ''
        }${r.status === 'paid' ? this.btn('Post to Accounting', 'post-payroll-accounting', { id: r.id }) : ''}${this.btn('PDF', 'payslip-pdf', { id: r.id })}</td></tr>`).join(''), 'No payroll runs')}`;
  },

  async renderBonuses(el) {
    const rows = this.asRows(await this.apiCall('hrListPayroll', { bonus: true }));
    el.innerHTML = `${this.sectionHead(this.btn('Refresh', 'refresh'))}
      ${this.table(['Employee', 'Period', 'Bonus', 'Gross', 'Status'],
        rows.map((r) => `<tr><td>${this.esc(r.full_name)}</td><td>${this.esc(r.period_end)}</td><td>${this.money(r.bonus)}</td><td>${this.money(r.gross_salary)}</td><td>${this.esc(r.status)}</td></tr>`).join(''), 'No bonus payments')}`;
  },

  async renderCommissions(el) {
    const rows = this.asRows(await this.apiCall('hrListPayroll', { commission: true }));
    el.innerHTML = `${this.sectionHead(this.btn('Refresh', 'refresh'))}
      ${this.table(['Employee', 'Period', 'Commission', 'Gross', 'Status'],
        rows.map((r) => `<tr><td>${this.esc(r.full_name)}</td><td>${this.esc(r.period_end)}</td><td>${this.money(r.commission)}</td><td>${this.money(r.gross_salary)}</td><td>${this.esc(r.status)}</td></tr>`).join(''), 'No commission payments')}`;
  },

  async renderSalaries(el) {
    const rows = this.asRows(await this.apiCall('hrPeople', { personnel_type: 'active' }));
    el.innerHTML = `
      ${this.sectionHead(`${this.btn('Refresh', 'refresh')}`)}
      ${this.table(['Employee', 'Type', 'Basic salary', 'Overtime rate', ''],
        rows.map((e) => `<tr><td>${this.esc(e.full_name)}</td><td>${this.esc(e.salary_type)}</td><td>${this.money(e.basic_salary)}</td><td>${this.money(e.overtime_rate)}</td><td>${this.btn('Change', 'salary-change', { id: e.id })}</td></tr>`).join(''))}`;
  },

  async renderPayslips(el) {
    const items = this.asRows(await this.apiCall('hrListPayroll', { status: 'paid' }));
    const pending = this.asRows(await this.apiCall('hrListPayroll', { status: 'pending' }));
    el.innerHTML = `
      ${this.sectionHead(`${this.btn('Salary Claims', 'nav', { section: 'salary-claims' })}${this.btn('Refresh', 'refresh')}`)}
      <p class="muted">Paid payslips appear on Staff Portal. Pending payslips open claim windows when payroll is generated.</p>
      ${this.panel('Pending (awaiting claim / payment)', this.table(['Employee', 'Period', 'Net pay', 'Status', ''],
        pending.map((r) => `<tr><td>${this.esc(r.full_name)}</td><td>${this.esc(r.period_start)} — ${this.esc(r.period_end)}</td><td>${this.money(r.net_salary)}</td><td>${this.esc(r.status)}</td><td>${this.btn('PDF', 'payslip-pdf', { id: r.id })}</td></tr>`).join(''), 'No pending payslips'))}
      ${this.panel('Paid', this.table(['Employee', 'Period', 'Net pay', 'Status', ''],
        items.map((r) => `<tr><td>${this.esc(r.full_name)}</td><td>${this.esc(r.period_start)} — ${this.esc(r.period_end)}</td><td>${this.money(r.net_salary)}</td><td>${this.esc(r.status)}</td><td>${this.btn('PDF', 'payslip-pdf', { id: r.id })}</td></tr>`).join(''), 'No paid payslips'))}`;
  },

  async renderSalaryClaims(el) {
    const rows = await this.apiOk(API.listSalaryClaims?.({}, this.user), 'Claims load failed') || [];
    const list = Array.isArray(rows) ? rows : (rows.items || []);
    const canFinalize = ['owner', 'manager'].includes(String(this.user?.role || '').toLowerCase());
    el.innerHTML = `${this.sectionHead(`${this.btn('Open Admin Payroll Claims', 'open-admin-section', { section: 'payroll' }, 'btn-primary')}${this.btn('Refresh', 'refresh')}`)}
      <p class="muted">Staff claim salary in Staff Portal. HR can view every claim; only owner/manager can approve and mark paid.</p>
      ${this.table(['Employee', 'Period', 'Net', 'Deadline', 'Status', ''],
        list.map((c) => `<tr>
          <td>${this.esc(c.employee_name)}</td>
          <td>${this.esc(c.period_start)} — ${this.esc(c.period_end)}</td>
          <td>${this.money(c.net_amount || c.amount)}</td>
          <td>${this.esc(String(c.claim_deadline || '').slice(0, 16))}</td>
          <td>${this.esc(c.status)}</td>
          <td>${c.status === 'claimed' && canFinalize ? this.btn('Approve', 'approve-salary-claim', { id: c.id }) + this.btn('Reject', 'reject-salary-claim', { id: c.id }) : ''}
            ${c.status === 'approved' && canFinalize ? this.btn('Mark Paid', 'pay-salary-claim', { id: c.id }) : ''}
            ${this.btn('PDF', 'salary-claim-pdf', { id: c.id })}</td></tr>`).join(''), 'No salary claims — generate payroll to open claim windows')}`;
  },

  async renderLoginSelfies(el) {
    const rows = await this.apiOk(API.getStaffSelfies?.({ from: this.dateOffset(-30), to: this.today() }, this.user), 'Selfies load failed') || [];
    const list = Array.isArray(rows) ? rows : (rows.items || rows.data || []);
    el.innerHTML = `${this.sectionHead(`${this.btn('Staff & HR Admin', 'open-admin-section', { section: 'staffhr' })}${this.btn('Refresh', 'refresh')}`)}
      ${this.table(['Date', 'Employee', 'Status', 'Notes', ''],
        list.slice(0, 200).map((s) => `<tr><td>${this.esc(String(s.created_at || s.captured_at || '').slice(0, 19))}</td><td>${this.esc(s.employee_name || s.full_name)}</td><td>${this.esc(s.status || '—')}</td><td>${this.esc(s.notes || '—')}</td><td></td></tr>`).join(''), 'No login selfies in the last 30 days')}`;
  },

  async renderLoginEvents(el) {
    const rows = await this.apiOk(API.getStaffLoginEvents?.({ from: this.dateOffset(-30), to: this.today() }), 'Login events failed') || [];
    const list = Array.isArray(rows) ? rows : (rows.items || rows.data || []);
    el.innerHTML = `${this.sectionHead(`${this.btn('Staff & HR Admin', 'open-admin-section', { section: 'staffhr' })}${this.btn('Refresh', 'refresh')}`)}
      ${this.table(['Date', 'Employee', 'Event', 'Notes'],
        list.slice(0, 200).map((e) => `<tr><td>${this.esc(String(e.created_at || e.event_at || '').slice(0, 19))}</td><td>${this.esc(e.employee_name || e.full_name)}</td><td>${this.esc(e.event_type || e.status || '—')}</td><td>${this.esc(e.notes || '—')}</td></tr>`).join(''), 'No login events')}`;
  },

  async renderAlerts(el) {
    const rows = await this.apiOk(API.getStaffNotifications?.(), 'Alerts load failed') || [];
    const list = Array.isArray(rows) ? rows : (rows.items || rows.data || []);
    el.innerHTML = `${this.sectionHead(`${this.btn('Refresh', 'refresh')}`)}
      ${this.table(['When', 'Type', 'Title', 'Message'],
        list.slice(0, 100).map((n) => `<tr><td>${this.esc(String(n.created_at || '').slice(0, 19))}</td><td>${this.esc(n.type || n.category)}</td><td>${this.esc(n.title)}</td><td>${this.esc(n.message || n.body || '')}</td></tr>`).join(''), 'No alerts')}`;
  },

  async renderDeductions(el) {
    const rows = this.asRows(await this.apiCall('hrPayrollDeductions', {}));
    el.innerHTML = `${this.sectionHead(`${this.btn('Payroll Settings', 'open-admin-section', { section: 'payroll' })}${this.btn('Refresh', 'refresh')}`)}
      ${this.table(['Employee', 'Period', 'Type', 'Amount', 'Employer', ''],
        rows.map((r) => `<tr><td>${this.esc(r.full_name)}</td><td>${this.esc(r.period_start)} — ${this.esc(r.period_end)}</td><td>${this.esc(r.deduction_type)}</td><td>${this.money(r.amount)}</td><td>${r.is_employer ? 'Yes' : 'No'}</td><td>${this.esc(r.payroll_status)}</td></tr>`).join(''), 'No deductions yet — generate payroll first')}`;
  },

  async renderAdvances(el) {
    const rows = await this.staffApi('getSalaryAdvances', {}) || [];
    el.innerHTML = `${this.sectionHead(`${this.btn('Issue Advance', 'issue-advance', {}, 'btn-primary')}${this.btn('Refresh', 'refresh')}`)}
      ${this.table(['Employee', 'Amount', 'Balance', 'Date', 'Status', ''],
        rows.map((r) => `<tr><td>${this.esc(r.full_name || r.employee_name)}</td><td>${this.money(r.amount)}</td><td>${this.money(r.balance)}</td><td>${this.esc(r.advance_date || r.created_at)}</td><td>${this.esc(r.status)}</td><td></td></tr>`).join(''), 'No salary advances')}`;
  },

  async renderLoans(el) {
    const rows = await this.staffApi('getEmployeeLoans', {}) || [];
    el.innerHTML = `${this.sectionHead(`${this.btn('Add Loan', 'add-loan', {}, 'btn-primary')}${this.btn('Refresh', 'refresh')}`)}
      ${this.table(['Employee', 'Principal', 'Monthly', 'Balance', 'Status', ''],
        rows.map((r) => `<tr><td>${this.esc(r.full_name || r.employee_name)}</td><td>${this.money(r.loan_amount || r.principal)}</td><td>${this.money(r.monthly_deduction)}</td><td>${this.money(r.balance)}</td><td>${this.esc(r.status)}</td><td></td></tr>`).join(''), 'No employee loans')}`;
  },

  async renderStatutory(el) {
    const summary = await this.apiCall('hrStatutorySummary', {}) || {};
    const totals = summary.totals || {};
    const taxYear = summary.tax_year || {};
    const settings = summary.settings || {};
    const workers = summary.workers || {};
    const byEmp = summary.by_employee || [];
    const key = this.section;
    const label = key === 'statutory' ? 'Other / COIDA' : key === 'coida' ? 'COIDA' : key.toUpperCase();
    const amountMap = {
      paye: totals.paye,
      uif: this.num(totals.uif_employee) + this.num(totals.uif_employer),
      sdl: totals.sdl,
      coida: totals.coida,
      statutory: totals.coida
    };
    const monthAmt = amountMap[key] ?? 0;
    const tyAmt = {
      paye: taxYear.paye,
      uif: this.num(taxYear.uif_employee) + this.num(taxYear.uif_employer),
      sdl: taxYear.sdl,
      coida: taxYear.coida,
      statutory: taxYear.coida
    }[key] ?? 0;
    const enabledKey = `${key === 'statutory' ? 'coida' : key}_enabled`;
    const enabled = settings[enabledKey];
    const regMap = {
      paye: settings.paye_registration_number || settings.company_paye_number,
      uif: settings.uif_registration_number || settings.company_uif_number,
      sdl: settings.sdl_registration_number || settings.company_sdl_number,
      coida: settings.coida_registration_number || settings.company_coida_number,
      statutory: settings.coida_registration_number
    };
    const workerReg = {
      paye: workers.paye_registered, uif: workers.uif_registered, sdl: workers.sdl_registered
    }[key];
    const pdfType = key === 'statutory' ? 'coida' : key;
    const empRows = byEmp.filter((r) => {
      if (key === 'paye') return this.num(r.paye) > 0 || r.paye_registered;
      if (key === 'uif') return this.num(r.uif_employee) + this.num(r.uif_employer) > 0 || r.uif_registered;
      if (key === 'sdl') return this.num(r.sdl) > 0 || r.sdl_registered;
      return this.num(r.coida) > 0;
    });
    el.innerHTML = `${this.sectionHead(`${this.btn('SARS / EMP201', 'nav', { section: 'sars' })}${this.btn('Payroll Admin', 'open-admin-section', { section: 'payroll' })}${this.btn('Compliance PDF', 'statutory-pdf', { type: pdfType })}${this.btn('Settings', 'nav', { section: 'settings' })}${this.btn('Refresh', 'refresh')}`)}
      <div class="hr-kpis">
        ${this.kpi(`${label} this month`, this.money(monthAmt), `From ${summary.month_start || this.today()}`, 'accent')}
        ${this.kpi(`${label} tax year`, this.money(tyAmt), `${summary.tax_year_start || ''} → ${summary.tax_year_end || ''}`, 'info')}
        ${this.kpi('Status', enabled ? 'Enabled' : 'Off', enabled === false ? 'Enable in Settings / Admin Payroll' : 'Shared with Admin Payroll', enabled ? 'good' : 'warn')}
        ${this.kpi('Registration', regMap[key] || 'Not set', 'Employer reference', regMap[key] ? 'good' : 'warn')}
        ${workerReg != null ? this.kpi('Workers registered', String(workerReg), `of ${workers.active || 0} active`, 'slate') : ''}
      </div>
      <div class="hr-grid-2">
        ${this.panel('Month totals (all statutory)', `<dl class="hr-dl"><dt>PAYE</dt><dd>${this.money(totals.paye)}</dd><dt>UIF employee</dt><dd>${this.money(totals.uif_employee)}</dd><dt>UIF employer</dt><dd>${this.money(totals.uif_employer)}</dd><dt>SDL</dt><dd>${this.money(totals.sdl)}</dd><dt>COIDA</dt><dd>${this.money(totals.coida)}</dd><dt>Gross payroll</dt><dd>${this.money(totals.gross)}</dd><dt>Net paid</dt><dd>${this.money(totals.net)}</dd><dt>Payslips</dt><dd>${this.esc(totals.payroll_count || 0)}</dd></dl>`)}
        ${this.panel(`${label} configuration`, `<dl class="hr-dl">
          <dt>Enabled</dt><dd>${enabled ? 'Yes' : 'No'}</dd>
          <dt>Registration / ref</dt><dd>${this.esc(regMap[key] || '—')}</dd>
          ${key === 'uif' ? `<dt>EE rate %</dt><dd>${this.esc(settings.uif_employee_rate)}</dd><dt>ER rate %</dt><dd>${this.esc(settings.uif_employer_rate)}</dd><dt>Ceiling</dt><dd>${this.money(settings.uif_ceiling)}</dd>` : ''}
          ${key === 'sdl' ? `<dt>Rate %</dt><dd>${this.esc(settings.sdl_rate)}</dd>` : ''}
          ${key === 'coida' || key === 'statutory' ? `<dt>Rate %</dt><dd>${this.esc(settings.coida_rate)}</dd><dt>Employer ref</dt><dd>${this.esc(settings.coida_employer_ref || '—')}</dd>` : ''}
          ${key === 'paye' ? `<dt>Tax number</dt><dd>${this.esc(settings.tax_number || '—')}</dd><dt>SARS office</dt><dd>${this.esc(settings.sars_tax_office || '—')}</dd>` : ''}
        </dl>${this.btn('Edit in Settings', 'nav', { section: 'settings' }, 'btn-primary')}`)}
      </div>
      ${this.panel(`Workers — ${label} this month`, this.table(['Code', 'Name', 'Type', 'Gross', label, ''],
        empRows.slice(0, 100).map((r) => {
          const amt = key === 'paye' ? r.paye
            : key === 'uif' ? this.num(r.uif_employee) + this.num(r.uif_employer)
              : key === 'sdl' ? r.sdl : r.coida;
          return `<tr><td>${this.esc(r.employee_code)}</td><td>${this.esc(r.full_name)}</td><td>${this.esc(r.employment_type || '—')}</td><td>${this.money(r.gross)}</td><td>${this.money(amt)}</td><td>${this.btn('Profile', 'view-employee', { id: r.id })}</td></tr>`;
        }).join(''), `No ${label} amounts this month — process payroll in Admin → Payroll`))}`;
  },

  async renderSars(el) {
    const summary = await this.apiCall('hrStatutorySummary', {}) || {};
    const emp201 = summary.emp201 || {};
    const totals = summary.totals || {};
    const taxYear = summary.tax_year || {};
    const workers = summary.workers || {};
    const settings = summary.settings || {};
    el.innerHTML = `${this.sectionHead(`${this.btn('Admin Payroll', 'open-admin-section', { section: 'payroll' }, 'btn-primary')}${this.btn('PAYE PDF', 'statutory-pdf', { type: 'paye' })}${this.btn('UIF PDF', 'statutory-pdf', { type: 'uif' })}${this.btn('SDL PDF', 'statutory-pdf', { type: 'sdl' })}${this.btn('Settings', 'nav', { section: 'settings' })}${this.btn('Refresh', 'refresh')}`)}
      <div class="hr-kpis">
        ${this.kpi('EMP201 liability', this.money(emp201.total_liability), `Period ${emp201.period || '—'} · due ${emp201.due_by || '7th'}`, 'accent')}
        ${this.kpi('PAYE', this.money(emp201.paye), 'Employee tax', 'warn')}
        ${this.kpi('UIF total', this.money(emp201.uif_total), `EE ${this.money(emp201.uif_employee)} + ER ${this.money(emp201.uif_employer)}`, 'info')}
        ${this.kpi('SDL', this.money(emp201.sdl), 'Skills levy', 'slate')}
      </div>
      <div class="hr-grid-2">
        ${this.panel('EMP201-style summary (month)', `<dl class="hr-dl">
          <dt>PAYE registration</dt><dd>${this.esc(emp201.employer_paye_ref || '—')}</dd>
          <dt>UIF registration</dt><dd>${this.esc(emp201.employer_uif_ref || '—')}</dd>
          <dt>SDL registration</dt><dd>${this.esc(emp201.employer_sdl_ref || '—')}</dd>
          <dt>SARS tax office</dt><dd>${this.esc(emp201.sars_tax_office || settings.sars_tax_office || '—')}</dd>
          <dt>Gross payroll</dt><dd>${this.money(totals.gross)}</dd>
          <dt>Payslips counted</dt><dd>${this.esc(totals.payroll_count || 0)}</dd>
          <dt>Total remittance</dt><dd><strong>${this.money(emp201.total_liability)}</strong></dd>
        </dl>
        <p class="muted">Figures come from processed payroll (same as Admin → Payroll &amp; Compliance). File EMP201 on eFiling by the 7th.</p>
        ${this.btn('Deadlines', 'nav', { section: 'deadlines' })} ${this.btn('Employer Records', 'nav', { section: 'employer-records' })}`)}
        ${this.panel('Tax year (Mar–Feb) / IRP5 totals', `<dl class="hr-dl">
          <dt>Tax year</dt><dd>${this.esc(summary.tax_year_start)} → ${this.esc(summary.tax_year_end)}</dd>
          <dt>PAYE YTD</dt><dd>${this.money(taxYear.paye)}</dd>
          <dt>UIF YTD (EE+ER)</dt><dd>${this.money(this.num(taxYear.uif_employee) + this.num(taxYear.uif_employer))}</dd>
          <dt>SDL YTD</dt><dd>${this.money(taxYear.sdl)}</dd>
          <dt>COIDA YTD</dt><dd>${this.money(taxYear.coida)}</dd>
          <dt>Gross YTD</dt><dd>${this.money(taxYear.gross)}</dd>
          <dt>Payslips YTD</dt><dd>${this.esc(taxYear.payroll_count || 0)}</dd>
        </dl>
        <p class="muted">Use these year-to-date totals when preparing IRP5 / IT3(a) employee tax certificates.</p>
        ${this.btn('Workers', 'nav', { section: 'employees' })} ${this.btn('COIDA', 'nav', { section: 'coida' })}`)}
      </div>
      ${this.panel('Workforce statutory coverage', `<div class="hr-kpis">
        ${this.kpi('Active workers', String(workers.active || 0))}
        ${this.kpi('PAYE flagged', String(workers.paye_registered || 0))}
        ${this.kpi('UIF flagged', String(workers.uif_registered || 0))}
        ${this.kpi('SDL flagged', String(workers.sdl_registered || 0))}
      </div>
      <p class="muted">Flag workers for PAYE/UIF/SDL in Admin → Staff &amp; HR when editing an employee.</p>
      ${this.btn('Open Staff & HR', 'open-admin-section', { section: 'staffhr' }, 'btn-primary')}`)}`;
  },

  num(v) { return Number(v) || 0; },

  async renderEmployerRecords(el) {
    const rows = this.asRows(await this.apiCall('hrEmployerRecords', {}));
    const summary = await this.apiCall('hrStatutorySummary', {}) || {};
    const s = summary.settings || {};
    el.innerHTML = `${this.sectionHead(`${this.btn('Add Record', 'add-employer-record', {}, 'btn-primary')}${this.btn('SARS / EMP201', 'nav', { section: 'sars' })}${this.btn('Payroll Settings', 'nav', { section: 'settings' })}${this.btn('Refresh', 'refresh')}`)}
      ${this.panel('From payroll settings', `<dl class="hr-dl"><dt>PAYE</dt><dd>${this.esc(s.paye_registration_number || s.company_paye_number || '—')}</dd><dt>UIF</dt><dd>${this.esc(s.uif_registration_number || s.company_uif_number || '—')}</dd><dt>SDL</dt><dd>${this.esc(s.sdl_registration_number || s.company_sdl_number || '—')}</dd><dt>COIDA</dt><dd>${this.esc(s.coida_registration_number || s.company_coida_number || '—')}</dd><dt>SARS office</dt><dd>${this.esc(s.sars_tax_office || '—')}</dd></dl>`)}
      ${this.table(['Type', 'Title', 'Reference', 'Expiry', 'Status', ''],
        rows.map((r) => `<tr><td>${this.esc(r.record_type)}</td><td>${this.esc(r.title)}</td><td>${this.esc(r.reference_number)}</td><td>${this.esc(r.expiry_date)}</td><td>${this.esc(r.status)}</td><td>${this.btn('Edit', 'edit-employer-record', { id: r.id })}</td></tr>`).join(''), 'No employer records — add UIF/SDL/PAYE/COIDA registration details')}`;
  },

  async renderDeadlines(el) {
    const rows = this.asRows(await this.apiCall('hrComplianceEvents', { upcoming_days: 365 }));
    const today = this.today();
    el.innerHTML = `${this.sectionHead(`${this.btn('Add Deadline', 'add-deadline', {}, 'btn-primary')}${this.btn('SARS / EMP201', 'nav', { section: 'sars' })}${this.btn('Refresh', 'refresh')}`)}
      <p class="muted">Tracks EMP201, PAYE, UIF, SDL and COIDA return dates. Defaults are seeded when you open SARS / statutory pages.</p>
      ${this.table(['Type', 'Title', 'Due', 'Status', ''],
        rows.map((r) => {
          const overdue = r.due_date && r.due_date < today && r.status !== 'completed';
          return `<tr class="${overdue ? 'hr-row-warn' : ''}"><td>${this.esc(r.event_type)}</td><td>${this.esc(r.title)}</td><td>${this.esc(r.due_date)}${overdue ? ' overdue' : ''}</td><td>${this.esc(r.status)}</td><td>${r.status !== 'completed' ? this.btn('Complete', 'complete-deadline', { id: r.id }) : ''}</td></tr>`;
        }).join(''), 'No deadlines — open SARS / EMP201 or add EMP201, UIF, PAYE, SDL, COIDA events')}`;
  },

  async renderAttendance(el) {
    const view = this.attendanceView();
    const hub = await this.apiCall('hrAttendanceHub', { view, from: this.dateOffset(-30), to: this.today() }) || {};
    const rows = hub.rows || [];
    const missed = hub.missed_clock_outs || [];
    const cols = view === 'hours' || view === 'overtime'
      ? ['Date', 'Employee', 'Clock in', 'Clock out', 'Hours', 'OT min', '']
      : ['Date', 'Employee', 'Branch', 'Clock in', 'Clock out', 'Status', ''];
    el.innerHTML = `${this.sectionHead(`${this.btn('Staff Portal', 'open-admin-section', { section: 'staffportal' })}${this.btn('Staff HR', 'open-admin-section', { section: 'staffhr' })}${this.btn('Refresh', 'refresh')}`)}
      ${missed.length ? this.panel('Missed clock-outs (Staff Portal)', this.table(['Date', 'Employee', 'Clock in', 'Hours open'],
        missed.slice(0, 10).map((r) => `<tr><td>${this.esc(r.work_date)}</td><td>${this.esc(r.full_name)}</td><td>${this.esc(r.clock_in)}</td><td>${this.esc(r.hours_open)}</td></tr>`).join(''))) : ''}
      ${this.table(cols,
        rows.map((r) => view === 'hours' || view === 'overtime'
          ? `<tr><td>${this.esc(r.work_date)}</td><td>${this.esc(r.full_name)}</td><td>${this.esc(r.clock_in)}</td><td>${this.esc(r.clock_out)}</td><td>${this.esc(r.hours_worked)}</td><td>${this.esc(r.overtime_minutes)}</td><td>${this.btn('Profile', 'view-employee', { id: r.employee_id })}</td></tr>`
          : `<tr><td>${this.esc(r.work_date)}</td><td>${this.esc(r.full_name)}</td><td>${this.esc(r.branch)}</td><td>${this.esc(r.clock_in)}</td><td>${this.esc(r.clock_out)}</td><td>${this.esc(r.status || (r.late_minutes > 0 ? 'Late' : 'Present'))}</td><td>${this.btn('Profile', 'view-employee', { id: r.employee_id })}</td></tr>`).join(''),
        'No attendance records — staff clock in via Staff Portal or Admin')}`;
  },

  async renderShifts(el) {
    const hub = await this.apiCall('hrSchedules', { from: this.dateOffset(-7), to: this.dateOffset(21) }) || {};
    const rows = hub.rows || [];
    el.innerHTML = `${this.sectionHead(`${this.btn('Edit in Admin', 'open-admin-section', { section: 'staffhr' }, 'btn-primary')}${this.btn('Print Schedule', 'print-schedule')}${this.btn('Refresh', 'refresh')}`)}
      <p class="muted">Showing ${this.esc(hub.from)} to ${this.esc(hub.to)} — same shift table as Admin → Staff &amp; HR.</p>
      ${this.table(['Date', 'Employee', 'Shift', 'Start', 'End', 'Rest day'],
        rows.map((r) => `<tr><td>${this.esc(r.shift_date)}</td><td>${this.esc(r.full_name)}</td><td>${this.esc(r.shift_name || '—')}</td><td>${this.esc(r.start_time)}</td><td>${this.esc(r.end_time)}</td><td>${r.is_rest_day ? 'Yes' : 'No'}</td></tr>`).join(''), 'No shifts scheduled — set up rota in Admin → Staff & HR')}`;
  },

  async renderLeave(el) {
    if (this.section === 'leave-balances') {
      const rows = this.asRows(await this.apiCall('hrLeaveBalances'));
      el.innerHTML = `${this.sectionHead(this.btn('Refresh', 'refresh'))}
        ${this.table(['Employee', 'Annual left', 'Sick left', 'Family left', ''],
          rows.map((r) => `<tr><td>${this.esc(r.full_name)}</td><td>${this.esc(r.annual_left)} / ${this.esc(r.annual_total)}</td><td>${this.esc(r.sick_left)} / ${this.esc(r.sick_total)}</td><td>${this.esc(r.family_left)} / ${this.esc(r.family_total)}</td><td>${this.btn('Profile', 'view-employee', { id: r.employee_id })}</td></tr>`).join(''), 'No active employees')}`;
      return;
    }
    const pendingOnly = this.section === 'leave-approvals';
    const rows = await this.staffApi('getAllStaffLeave', pendingOnly ? 'pending' : null) || [];
    el.innerHTML = `${this.sectionHead(`${this.btn('New Leave', 'add-leave', {}, 'btn-primary')}${this.btn('Refresh', 'refresh')}`)}
      ${this.table(['Employee', 'Type', 'From', 'To', 'Days', 'Status', ''],
        rows.map((r) => `<tr><td>${this.esc(r.employee_name || r.full_name)}</td><td>${this.esc(r.leave_type)}</td><td>${this.esc(r.start_date)}</td><td>${this.esc(r.end_date)}</td><td>${this.esc(r.days)}</td><td>${this.esc(r.status)}</td>
          <td>${r.status === 'pending' ? this.btn('Approve', 'approve-leave', { id: r.id }) + this.btn('Reject', 'reject-leave', { id: r.id }) + this.btn('PDF', 'leave-pdf', { id: r.id }) : this.btn('PDF', 'leave-pdf', { id: r.id })}</td></tr>`).join(''), 'No leave records')}`;
  },

  async renderContracts(el) {
    const filters = {};
    if (this.section === 'contracts-expiring') filters.expiring = true;
    if (this.section === 'contracts-expired') filters.expired = true;
    if (this.section === 'contracts-active') filters.status = 'active';
    if (this.section === 'contract-templates') {
      const tpls = await this.staffApi('getContractTemplates') || [];
      el.innerHTML = `${this.sectionHead(this.btn('Templates in Admin', 'open-admin-section', { section: 'hrcontracts' }, 'btn-primary'))}
        ${this.table(['Title', 'Type', ''], tpls.map((t) => `<tr><td>${this.esc(t.title || t.name)}</td><td>${this.esc(t.type)}</td><td></td></tr>`).join(''))}`;
      return;
    }
    const rows = await this.staffApi('getHrContracts', filters) || [];
    el.innerHTML = `${this.sectionHead(this.btn('New Contract', 'open-admin-section', { section: 'hrcontracts' }, 'btn-primary'))}
      ${this.table(['Number', 'Employee', 'Status', 'Start', 'Expiry'],
        rows.map((c) => `<tr><td>${this.esc(c.contract_number)}</td><td>${this.esc(c.employee_name)}</td><td>${this.esc(c.status)}</td><td>${this.esc(c.start_date)}</td><td>${this.esc(c.expiry_date)}</td></tr>`).join(''))}`;
  },

  async renderDocuments(el) {
    let docs = this.asRows(await this.apiCall('hrEmployeeDocuments', {}));
    const today = this.today();
    if (this.section === 'documents-expiring') {
      const soon = new Date();
      soon.setDate(soon.getDate() + 30);
      const soonStr = soon.toLocaleDateString('en-CA');
      docs = docs.filter((d) => d.expiry_date && d.expiry_date >= today && d.expiry_date <= soonStr);
    } else if (this.section === 'documents-expired') {
      docs = docs.filter((d) => d.expiry_date && d.expiry_date < today);
    } else if (this.section === 'documents-required') {
      docs = docs.filter((d) => d.required || d.is_required || d.doc_type === 'ID' || d.doc_type === 'Contract');
    }
    el.innerHTML = `${this.sectionHead(`${this.btn('Upload in Admin', 'open-admin-section', { section: 'staffhr' }, 'btn-primary')}${this.btn('Refresh', 'refresh')}`)}
      ${this.table(['Employee', 'Type', 'Name', 'Expiry', 'Status', ''],
        docs.slice(0, 200).map((d) => `<tr><td>${this.esc(d.employee_name)}</td><td>${this.esc(d.doc_type || d.type)}</td><td>${this.esc(d.name || d.file_name || d.title)}</td><td>${this.esc(d.expiry_date || '—')}</td><td>${this.esc(d.status || 'on file')}</td><td>${this.btn('Profile', 'view-employee', { id: d.employee_id })}</td></tr>`).join(''), 'No documents on file')}`;
  },

  async renderOnboarding(el) {
    const tpls = this.asRows(await this.apiCall('hrOnboardingTemplates'));
    const progress = this.asRows(await this.apiCall('hrOnboardingList'));
    el.innerHTML = `${this.sectionHead(`${this.btn('Start Onboarding', 'start-onboarding', {}, 'btn-primary')}${this.btn('Refresh', 'refresh')}`)}
      ${this.panel('Active onboarding', this.table(['Employee', 'Template', 'Status', ''],
        progress.map((p) => `<tr><td>${this.esc(p.full_name)}</td><td>${this.esc(p.template_name || '—')}</td><td>${this.esc(p.status)}</td><td>${this.btn('Profile', 'view-employee', { id: p.employee_id })}</td></tr>`).join(''), 'No active onboarding'))}
      ${this.panel('Templates', this.table(['Name', 'Employment type', ''],
        tpls.map((t) => `<tr><td>${this.esc(t.name)}</td><td>${this.esc(t.employment_type)}</td><td>${this.btn('Start', 'start-onboarding')}</td></tr>`).join('')) )}`;
  },

  async renderOffboarding(el) {
    const rows = this.asRows(await this.apiCall('hrOffboardingList', {}));
    el.innerHTML = `${this.sectionHead(`${this.btn('Start Offboarding', 'start-offboarding', {}, 'btn-primary')}${this.btn('Refresh', 'refresh')}`)}
      ${this.table(['Employee', 'Exit type', 'Effective', 'Final day', 'Status', ''],
        rows.map((r) => `<tr><td>${this.esc(r.full_name)}</td><td>${this.esc(r.exit_type)}</td><td>${this.esc(r.effective_date)}</td><td>${this.esc(r.final_working_date || '—')}</td><td>${this.esc(r.status)}</td><td>${r.status !== 'completed' ? this.btn('Complete', 'complete-offboarding', { id: r.id, employee_id: r.employee_id }) : ''}</td></tr>`).join(''), 'No offboarding records')}`;
  },

  async renderIncidents(el) {
    const rows = this.asRows(await this.apiCall('hrIncidents', {}));
    el.innerHTML = `${this.sectionHead(`${this.btn('Record Incident', 'add-incident', {}, 'btn-primary')}${this.btn('Refresh', 'refresh')}`)}
      ${this.table(['Number', 'Date', 'Employee', 'Title', 'Severity', 'Status', ''],
        rows.map((i) => `<tr><td>${this.esc(i.incident_number)}</td><td>${this.esc(i.incident_date)}</td><td>${this.esc(i.employee_name || '—')}</td><td>${this.esc(i.title)}</td><td>${this.esc(i.severity)}</td><td>${this.esc(i.status)}</td><td>${i.status !== 'resolved' ? this.btn('Resolve', 'resolve-incident', { id: i.id }) : ''}</td></tr>`).join(''), 'No incidents recorded')}`;
  },

  async renderWarnings(el) {
    const rows = this.asRows(await this.apiCall('hrStaffWarnings', {}));
    el.innerHTML = `${this.sectionHead(`${this.btn('Add Warning', 'add-warning', {}, 'btn-primary')}${this.btn('Refresh', 'refresh')}`)}
      ${this.table(['Date', 'Employee', 'Type', 'Reason', 'Status', ''],
        rows.map((w) => `<tr><td>${this.esc(w.incident_date)}</td><td>${this.esc(w.employee_name)}</td><td>${this.esc(w.warning_type)}</td><td>${this.esc(w.reason || w.description)}</td><td>${this.esc(w.status)}</td><td>${this.btn('PDF', 'warning-pdf', { id: w.id })}</td></tr>`).join(''), 'No warnings on file')}`;
  },

  async renderPenalties(el) {
    const rows = await this.staffApi('getAttendancePenalties', {}) || [];
    el.innerHTML = `${this.sectionHead(`${this.btn('Add Penalty', 'add-penalty', {}, 'btn-primary')}${this.btn('Refresh', 'refresh')}`)}
      <div class="hr-note">Penalties require approval before payroll deduction.</div>
      ${this.table(['Date', 'Employee', 'Amount', 'Reason', 'Status', ''],
        rows.map((p) => `<tr><td>${this.esc(p.penalty_date || p.created_at)}</td><td>${this.esc(p.employee_name)}</td><td>${this.money(p.amount)}</td><td>${this.esc(p.reason)}</td><td>${this.esc(p.status)}</td><td>${p.status === 'pending' ? this.btn('Approve', 'approve-penalty', { id: p.id }) + this.btn('Cancel', 'cancel-penalty', { id: p.id }) : ''}</td></tr>`).join(''), 'No attendance penalties')}`;
  },

  async renderDisciplinary(el) {
    const section = this.disciplinarySection();
    const rows = this.asRows(await this.apiCall('hrDisciplinaryCases', section ? { section } : {}));
    const title = section === 'hearings' ? 'hearings' : section === 'appeals' ? 'appeals' : section === 'investigations' ? 'investigations' : 'disciplinary';
    el.innerHTML = `${this.sectionHead(`${this.btn('New Case', 'add-disciplinary', {}, 'btn-primary')}${this.btn('Refresh', 'refresh')}`)}
      ${this.table(['Case', 'Employee', 'Stage', 'Hearing', 'Appeal', 'Status', ''],
        rows.map((c) => `<tr><td>${this.esc(c.case_number)}</td><td>${this.esc(c.employee_name)}</td><td>${this.esc(c.stage)}</td><td>${this.esc(c.hearing_date || '—')}</td><td>${this.esc(c.appeal_status || '—')}</td><td>${this.esc(c.status)}</td><td>${this.btn('Update', 'update-disciplinary', { id: c.id })}</td></tr>`).join(''), `No ${title} cases`)}`;
  },

  async renderPerformance(el) {
    const hub = await this.apiCall('hrPerformanceHub', { from: this.dateOffset(-30), to: this.today() }) || {};
    const probations = hub.probations || [];
    const sales = hub.sales_performance || [];
    el.innerHTML = `${this.sectionHead(`${this.btn('Probation Admin', 'open-admin-section', { section: 'hrcontracts' })}${this.btn('Refresh', 'refresh')}`)}
      ${this.panel('Probation reviews', this.table(['Employee', 'Start', 'End', 'Status', ''],
        probations.map((p) => `<tr><td>${this.esc(p.employee_name || p.full_name)}</td><td>${this.esc(p.start_date)}</td><td>${this.esc(p.end_date)}</td><td>${this.esc(p.status)}</td><td>${this.btn('Admin', 'open-admin-section', { section: 'hrcontracts' })}</td></tr>`).join(''), 'No active probations'))}
      ${this.panel('Sales performance (30 days)', this.table(['Employee', 'Sales count', 'Sales total', ''],
        sales.map((s) => `<tr><td>${this.esc(s.full_name)}</td><td>${this.esc(s.sales_count)}</td><td>${this.money(s.sales_total)}</td><td>${this.btn('Profile', 'view-employee', { id: s.employee_id })}</td></tr>`).join(''), 'No linked POS sales for staff'))}`;
  },

  async renderTraining(el) {
    const records = await this.staffApi('getHrTrainingRecords', {}) || [];
    const submissions = await this.staffApi('getHrStaffSubmissions', { status: 'pending' }) || [];
    el.innerHTML = `${this.sectionHead(`${this.btn('Training Admin', 'open-admin-section', { section: 'staffhr' }, 'btn-primary')}${this.btn('Refresh', 'refresh')}`)}
      ${this.panel('Training records', this.table(['Employee', 'Course', 'Start', 'Expiry', 'Status', ''],
        records.map((t) => `<tr><td>${this.esc(t.employee_name || t.employee_id)}</td><td>${this.esc(t.template_name || t.course_name || t.title)}</td><td>${this.esc(t.start_date)}</td><td>${this.esc(t.expiry_date)}</td><td>${this.esc(t.status)}</td><td></td></tr>`).join(''), 'No training records'))}
      ${this.panel('Pending submissions', this.table(['Employee', 'Template', 'Submitted', ''],
        submissions.map((s) => `<tr><td>${this.esc(s.employee_name)}</td><td>${this.esc(s.template_name || s.form_name)}</td><td>${this.esc(String(s.submitted_at || s.created_at).slice(0, 10))}</td><td>${this.btn('Review', 'open-admin-section', { section: 'staffhr' })}</td></tr>`).join(''), 'No pending submissions'))}`;
  },

  async renderPolicies(el) {
    const rows = this.asRows(await this.apiCall('hrPolicies', {}));
    el.innerHTML = `${this.sectionHead(`${this.btn('Add Policy', 'add-policy', {}, 'btn-primary')}${this.btn('Refresh', 'refresh')}`)}
      ${this.table(['Code', 'Title', 'Version', 'Category', 'Ack', 'Status', ''],
        rows.map((p) => `<tr><td>${this.esc(p.code)}</td><td>${this.esc(p.title)}</td><td>${this.esc(p.version)}</td><td>${this.esc(p.category)}</td><td>${p.requires_ack ? 'Yes' : 'No'}</td><td>${this.esc(p.status)}</td><td>${p.requires_ack ? this.btn('Acknowledge', 'ack-policy', { id: p.id }) : ''}</td></tr>`).join(''), 'No policies')}`;
  },

  async renderBusinessRules(el) {
    const rows = this.asRows(await this.apiCall('hrBusinessRules', {}));
    el.innerHTML = `${this.sectionHead(`${this.btn('Add Rule', 'add-rule', {}, 'btn-primary')}${this.btn('Refresh', 'refresh')}`)}
      ${this.table(['Title', 'Applies to', 'Position', 'Department', ''],
        rows.map((r) => `<tr><td>${this.esc(r.title)}</td><td>${this.esc(r.applies_to)}</td><td>${this.esc(r.position || '—')}</td><td>${this.esc(r.department || '—')}</td><td>${this.btn('View', 'view-rule', { id: r.id })}</td></tr>`).join(''), 'No business rules')}`;
  },

  async renderForms(el) {
    const rows = this.asRows(await this.apiCall('hrForms', {}));
    const submissions = await this.staffApi('getHrStaffSubmissions', {}) || [];
    el.innerHTML = `${this.sectionHead(`${this.btn('Create Form', 'add-form', {}, 'btn-primary')}${this.btn('Refresh', 'refresh')}`)}
      ${this.panel('Form templates', this.table(['Title', 'Type', 'Status', ''],
        rows.map((f) => `<tr><td>${this.esc(f.title)}</td><td>${this.esc(f.form_type)}</td><td>${this.esc(f.status)}</td><td>${this.btn('Assign', 'open-admin-section', { section: 'staffhr' })}</td></tr>`).join(''), 'No forms'))}
      ${this.panel('Recent submissions', this.table(['Employee', 'Form', 'Status', 'Date'],
        submissions.slice(0, 30).map((s) => `<tr><td>${this.esc(s.employee_name)}</td><td>${this.esc(s.template_name)}</td><td>${this.esc(s.status)}</td><td>${this.esc(String(s.submitted_at || '').slice(0, 10))}</td></tr>`).join(''), 'No submissions'))}`;
  },

  async renderRequests(el) {
    const rows = this.asRows(await this.apiCall('hrRequests', {}));
    el.innerHTML = `${this.sectionHead(`${this.btn('New Request', 'add-request', {}, 'btn-primary')}${this.btn('Refresh', 'refresh')}`)}
      ${this.table(['Number', 'Employee', 'Type', 'Title', 'Status', ''],
        rows.map((r) => `<tr><td>${this.esc(r.request_number)}</td><td>${this.esc(r.employee_name)}</td><td>${this.esc(r.request_type)}</td><td>${this.esc(r.title || r.details)}</td><td>${this.esc(r.status)}</td>
          <td>${['submitted', 'review'].includes(r.status) ? this.btn('Approve', 'decide-request', { id: r.id, decision: 'approved' }) + this.btn('Reject', 'decide-request', { id: r.id, decision: 'rejected' }) : ''}</td></tr>`).join(''), 'No HR requests')}`;
  },

  async renderApprovals(el) {
    const rows = this.asRows(await this.apiCall('hrApprovals', {}));
    const canFinalize = ['owner', 'manager'].includes(String(this.user?.role || '').toLowerCase());
    el.innerHTML = `${this.sectionHead(`${this.btn('Admin HR Approvals', 'open-admin-section', { section: 'hr-approvals' })}${this.btn('Refresh', 'refresh')}`)}
      <p class="muted">HR prepares actions; owner/manager finalizes. Leave can be actioned by HR; payroll pay, salary claims, employee create/update and salary changes need Admin approval.</p>
      ${this.table(['Type', 'Title', 'Employee', 'Date', 'Status', 'Action'],
        rows.map((a) => {
          let actions = '';
          if (a.type === 'leave' && a.status === 'pending') {
            actions = this.btn('Approve', 'approve-leave', { id: a.id }) + this.btn('Reject', 'reject-leave', { id: a.id });
          } else if ((a.type === 'hr_action' || a.type === 'request') && canFinalize) {
            actions = this.btn('Approve & apply', 'decide-request', { id: a.id, decision: 'approved' })
              + this.btn('Reject', 'decide-request', { id: a.id, decision: 'rejected' });
          } else if (a.type === 'payroll' && a.status === 'pending') {
            actions = canFinalize
              ? this.btn('Mark Paid', 'mark-payroll-paid', { id: a.id })
              : this.btn('Request pay', 'request-payroll-pay', { id: a.id });
          } else if (a.type === 'salary_claim' && canFinalize) {
            actions = this.btn('Approve claim', 'approve-salary-claim', { id: a.id })
              + this.btn('Reject', 'reject-salary-claim', { id: a.id });
          } else if (!canFinalize && a.finalize) {
            actions = '<span class="muted">Awaiting Admin</span>';
          }
          return `<tr><td>${this.esc(a.type)}${a.request_type ? ` / ${this.esc(a.request_type)}` : ''}</td><td>${this.esc(a.title)}</td><td>${this.esc(a.employee)}</td><td>${this.esc(String(a.date).slice(0, 10))}</td><td>${this.esc(a.status)}</td><td>${actions}</td></tr>`;
        }).join(''), 'No pending approvals')}`;
  },

  async renderCompliance(el) {
    const c = await this.apiCall('hrComplianceCentre', {}) || {};
    const summary = await this.apiCall('hrStatutorySummary', {}) || {};
    const emp201 = summary.emp201 || {};
    el.innerHTML = `
      ${this.sectionHead(`${this.btn('Add Deadline', 'add-deadline', {}, 'btn-primary')}${this.btn('SARS / EMP201', 'nav', { section: 'sars' })}${this.btn('Refresh', 'refresh')}`)}
      <div class="hr-compliance-strip">
        <div class="hr-compliance-item">Payroll: <strong>${this.esc(c.payroll)}</strong></div>
        <div class="hr-compliance-item">UIF: <strong>${this.esc(c.uif)}</strong></div>
        <div class="hr-compliance-item">PAYE: <strong>${this.esc(c.paye)}</strong></div>
        <div class="hr-compliance-item">EMP201: <strong>${this.money(emp201.total_liability)}</strong> due ${this.esc(emp201.due_by || '—')}</div>
        <div class="hr-compliance-item">Contracts expiring: <strong>${c.contracts_expiring || 0}</strong></div>
        <div class="hr-compliance-item">Policies awaiting: <strong>${c.policies_awaiting || 0}</strong></div>
        <div class="hr-compliance-item">Open incidents: <strong>${c.incidents_open || 0}</strong></div>
      </div>
      ${this.panel('Upcoming deadlines', this.table(['Type', 'Title', 'Due', 'Status', ''],
        (c.items || []).map((e) => `<tr><td>${this.esc(e.event_type)}</td><td>${this.esc(e.title)}</td><td>${this.esc(e.due_date)}</td><td>${this.esc(e.status)}</td><td>${e.status !== 'completed' ? this.btn('Complete', 'complete-deadline', { id: e.id }) : ''}</td></tr>`).join(''), 'No upcoming events'))}`;
  },

  async renderReports(el) {
    el.innerHTML = `${this.sectionHead('')}
      <div class="hr-quick-actions">
        ${this.btn('Worker list PDF', 'report-pdf', { type: 'employees' })}
        ${this.btn('Payroll report', 'report-pdf', { type: 'payroll' })}
        ${this.btn('Leave report', 'report-pdf', { type: 'leave' })}
        ${this.btn('Attendance report', 'report-pdf', { type: 'attendance' })}
        ${this.btn('PAYE / SARS PDF', 'statutory-pdf', { type: 'paye' })}
        ${this.btn('UIF compliance PDF', 'statutory-pdf', { type: 'uif' })}
        ${this.btn('SDL compliance PDF', 'statutory-pdf', { type: 'sdl' })}
        ${this.btn('COIDA PDF', 'statutory-pdf', { type: 'coida' })}
        ${this.btn('Shift schedule print', 'print-schedule')}
        ${this.btn('Open SARS hub', 'nav', { section: 'sars' })}
      </div>
      <p class="muted">Reports use the same data as Admin. Statutory PDFs and EMP201 figures come from processed payroll (PAYE, UIF, SDL, COIDA).</p>`;
  },

  async renderAudit(el) {
    const rows = await this.apiOk(API.getAuditLog?.({ limit: 200 }), 'Audit load failed') || [];
    const items = rows.items || rows || [];
    el.innerHTML = `${this.sectionHead(`${this.btn('Full Audit Log', 'open-admin-audit')}${this.btn('Refresh', 'refresh')}`)}
      ${this.table(['Date', 'User', 'Action', 'Entity', 'Details'],
        items.slice(0, 150).map((a) => `<tr><td>${this.esc(String(a.created_at).slice(0, 19))}</td><td>${this.esc(a.user_name || a.username)}</td><td>${this.esc(a.action)}</td><td>${this.esc(a.entity_type)} #${this.esc(a.entity_id)}</td><td>${this.esc(String(a.details || '').slice(0, 60))}</td></tr>`).join(''), 'No audit entries')}`;
  },

  async renderSettings(el) {
    const s = await this.apiCall('hrSettings') || {};
    const p = s.payroll || {};
    const chk = (id, on) => `<label class="hr-check"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}> Enabled</label>`;
    el.innerHTML = `${this.sectionHead(`${this.btn('Save', 'save-settings', {}, 'btn-primary')}${this.btn('Admin Payroll', 'open-admin-section', { section: 'payroll' })}${this.btn('SARS / EMP201', 'nav', { section: 'sars' })}`)}
      <p class="muted">Payroll statutory settings are shared with Admin → Payroll &amp; Compliance. Saving here updates both panels.</p>
      <div class="hr-grid-2">
        ${this.panel('PAYE (SARS)', `${chk('hr-paye-enabled', p.paye_enabled)}
          <div class="field full"><label>PAYE registration number</label><input id="hr-paye-reg" class="input-block" value="${this.esc(p.paye_registration_number || p.company_paye_number || '')}"></div>
          <div class="field full"><label>Tax number</label><input id="hr-tax-number" class="input-block" value="${this.esc(p.tax_number || '')}"></div>
          <div class="field full"><label>SARS tax office</label><input id="hr-sars-office" class="input-block" value="${this.esc(p.sars_tax_office || '')}"></div>`)}
        ${this.panel('UIF', `${chk('hr-uif-enabled', p.uif_enabled)}
          <div class="field full"><label>UIF registration number</label><input id="hr-uif-reg" class="input-block" value="${this.esc(p.uif_registration_number || p.company_uif_number || '')}"></div>
          <div class="field full"><label>Employee rate %</label><input id="hr-uif-ee" type="number" step="0.01" class="input-block" value="${this.esc(p.uif_employee_rate ?? 1)}"></div>
          <div class="field full"><label>Employer rate %</label><input id="hr-uif-er" type="number" step="0.01" class="input-block" value="${this.esc(p.uif_employer_rate ?? 1)}"></div>
          <div class="field full"><label>Ceiling (R)</label><input id="hr-uif-ceiling" type="number" step="0.01" class="input-block" value="${this.esc(p.uif_ceiling ?? 17712)}"></div>`)}
        ${this.panel('SDL', `${chk('hr-sdl-enabled', p.sdl_enabled)}
          <div class="field full"><label>SDL registration number</label><input id="hr-sdl-reg" class="input-block" value="${this.esc(p.sdl_registration_number || p.company_sdl_number || '')}"></div>
          <div class="field full"><label>Rate %</label><input id="hr-sdl-rate" type="number" step="0.01" class="input-block" value="${this.esc(p.sdl_rate ?? 1)}"></div>`)}
        ${this.panel('COIDA', `${chk('hr-coida-enabled', p.coida_enabled)}
          <div class="field full"><label>COIDA registration</label><input id="hr-coida-reg" class="input-block" value="${this.esc(p.coida_registration_number || p.company_coida_number || '')}"></div>
          <div class="field full"><label>Employer reference</label><input id="hr-coida-ref" class="input-block" value="${this.esc(p.coida_employer_ref || '')}"></div>
          <div class="field full"><label>Rate %</label><input id="hr-coida-rate" type="number" step="0.01" class="input-block" value="${this.esc(p.coida_rate ?? 0)}"></div>`)}
      </div>
      ${this.panel('HR notes', `<div class="field full"><textarea id="hr-set-notes" rows="3" class="input-block">${this.esc(s.hr?.notes || '')}</textarea></div>`)}`;
  },

  cacheExport(key, title, headers, rows) {
    this._exportCache[key] = { title, headers, rows: rows || [] };
  },

  async exportSection(key, mode) {
    const cache = this._exportCache[key || this.section];
    if (!cache?.rows?.length) { this.toast('Nothing to export — refresh first', 'warning'); return; }
    if (typeof Export === 'undefined') { this.toast('Export module not loaded', 'error'); return; }
    const filename = `hr_${String(key || this.section).replace(/-/g, '_')}_${this.today()}`;
    if (mode === 'print') await Export.print(cache.title, cache.headers, cache.rows, {});
    else await Export.toPDF(filename, cache.title, cache.headers, cache.rows, {});
  },

  async doSearch(q) {
    const data = await this.apiCall('hrSearch', q);
    if (!data) return;
    const html = [
      ...(data.employees || []).map((e) => `<button type="button" class="hr-search-item" data-hr-act="view-employee" data-id="${e.id}">👤 ${this.esc(e.full_name)} (${this.esc(e.employee_code)})</button>`),
      ...(data.policies || []).map((p) => `<div class="hr-search-item">📋 ${this.esc(p.title)} v${this.esc(p.version)}</div>`)
    ].join('') || '<div class="hr-empty">No results</div>';
    this.openModal('Search results', html);
  },

  openModal(title, body) {
    if (typeof Utils !== 'undefined' && Utils.showModal) {
      Utils.showModal(title, body);
      return;
    }
    this.toast(title, 'info');
  },

  async promptForm(title, fields = []) {
    if (typeof Utils === 'undefined' || !Utils.showModal) {
      this.toast('Dialog unavailable — restart the app', 'error');
      return null;
    }
    return new Promise((resolve) => {
      const uid = `hr-f-${Date.now()}`;
      const body = fields.map((f) => {
        const fid = `${uid}-${f.id}`;
        if (f.type === 'select') {
          const opts = (f.options || []).map((o) => {
            const val = typeof o === 'object' ? o.value : o;
            const label = typeof o === 'object' ? o.label : o;
            return `<option value="${this.esc(val)}"${String(val) === String(f.value) ? ' selected' : ''}>${this.esc(label)}</option>`;
          }).join('');
          return `<div class="field full"><label>${this.esc(f.label)}</label><select id="${fid}" class="input-block">${opts}</select></div>`;
        }
        if (f.type === 'textarea') {
          return `<div class="field full"><label>${this.esc(f.label)}</label><textarea id="${fid}" class="input-block" rows="${f.rows || 3}">${this.esc(f.value || '')}</textarea></div>`;
        }
        const inputType = f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : 'text';
        return `<div class="field full"><label>${this.esc(f.label)}</label><input type="${inputType}" id="${fid}" class="input-block" value="${this.esc(f.value || '')}"></div>`;
      }).join('');
      Utils.showModal(title, body, `
        <button type="button" class="btn btn-ghost" id="${uid}-cancel">Cancel</button>
        <button type="button" class="btn btn-primary" id="${uid}-ok">Save</button>`);
      const close = (val) => { Utils.hideModal(); resolve(val); };
      document.getElementById(`${uid}-cancel`)?.addEventListener('click', () => close(null));
      document.getElementById(`${uid}-ok`)?.addEventListener('click', () => {
        const out = {};
        for (const f of fields) {
          const el = document.getElementById(`${uid}-${f.id}`);
          const v = (el?.value ?? '').trim();
          if (f.required && !v) { this.toast(`${f.label} is required`, 'warning'); return; }
          out[f.id] = v;
        }
        close(out);
      });
      setTimeout(() => document.getElementById(`${uid}-${fields[0]?.id}`)?.focus(), 50);
    });
  },

  async promptValue(label, defaultValue = '', options = {}) {
    const result = await this.promptForm(label, [{
      id: 'value',
      label,
      value: defaultValue,
      type: options.type || 'text',
      required: !options.optional
    }]);
    if (!result) return null;
    const v = String(result.value ?? '').trim();
    return v || null;
  },

  async pickEmployee(promptLabel) {
    const people = await this.apiCall('hrPeople', {}) || [];
    if (!people.length) { this.toast('No employees found', 'warning'); return null; }
    const result = await this.promptForm(promptLabel, [{
      id: 'employee_id',
      label: 'Employee',
      type: 'select',
      required: true,
      options: people.map((e) => ({ value: e.id, label: `${e.full_name} (${e.employee_code})` }))
    }]);
    if (!result) return null;
    const id = parseInt(result.employee_id, 10);
    return people.find((e) => e.id === id) || (id ? { id } : null);
  },

  ACT: {
    'login-submit': function () { return this.doLogin(); },
    close: function () { this.closeApp(); },
    'nav-toggle': function () {
      this._navOpen = !this._navOpen;
      document.querySelector('.hr-shell')?.classList.toggle('hr-nav-open', this._navOpen);
    },
    'nav-close': function () {
      this._navOpen = false;
      document.querySelector('.hr-shell')?.classList.remove('hr-nav-open');
    },
    nav: function (d) {
      if (d.section) { this.section = d.section; this._navOpen = false; document.querySelector('.hr-shell')?.classList.remove('hr-nav-open'); this.refreshSection(); }
    },
    refresh: function () { return this.refreshSection(); },
    'view-employee': function (d) { this.profileId = d.id; this.section = 'employee-profile'; this.refreshSection(); },
    'open-admin-section': function (d) {
      if (this.app?.navigate) { this.app.navigate('admin'); setTimeout(() => { if (window.AdminPage) { AdminPage.section = d.section; AdminPage.renderSection(document.getElementById('admin-content')); } }, 300); }
      else this.toast('Open Admin Panel from the main app', 'info');
    },
    'open-admin-audit': function () { this.ACT['open-admin-section'].call(this, { section: 'overview' }); },
    'approve-leave': async function (d) {
      const r = await this.apiOk(API.approveStaffLeave(d.id, this.user, true), 'Approve failed');
      if (r != null) { this.toast('Leave approved', 'success'); this.refreshSection(); }
    },
    'reject-leave': async function (d) {
      const r = await this.apiOk(API.approveStaffLeave(d.id, this.user, false), 'Reject failed');
      if (r != null) { this.toast('Leave rejected', 'info'); this.refreshSection(); }
    },
    'decide-request': async function (d) {
      const r = await this.apiCall('hrDecideRequest', parseInt(d.id, 10), d.decision || 'approved', '');
      if (r) { this.toast('Request updated', 'success'); this.refreshSection(); }
    },
    'payslip-pdf': async function (d) {
      const r = await API.getStaffPayslipPdf?.(d.id);
      if (r?.path) this.toast(`Payslip saved: ${r.path}`, 'success');
    },
    'generate-payroll': async function () {
      const start = await this.promptValue('Period start (YYYY-MM-DD):', this.dateOffset(-30));
      if (!start) return;
      const end = await this.promptValue('Period end (YYYY-MM-DD):', this.today());
      if (!end) return;
      const canFinalize = ['owner', 'manager'].includes(String(this.user?.role || '').toLowerCase());
      if (canFinalize) {
        const r = await this.apiOk(API.generateStaffPayroll?.(start, end), 'Generate failed');
        if (r != null) {
          this.toast('Payroll generated — payslips & salary claim windows opened for Staff Portal', 'success');
          this.section = 'salary-claims';
          this.refreshSection();
        }
        return;
      }
      const r = await this.apiCall('hrSubmitForApproval', {
        request_type: 'payroll_generate',
        title: `Generate payroll ${start} – ${end}`,
        details: 'Submitted by HR — Admin must approve to run',
        payload: { period_start: start, period_end: end }
      });
      if (r) { this.toast('Payroll generate sent for Admin approval', 'success'); this.section = 'approvals'; this.refreshSection(); }
    },
    'mark-payroll-paid': async function (d) {
      const canFinalize = ['owner', 'manager'].includes(String(this.user?.role || '').toLowerCase());
      const method = await this.promptValue('Payment method (cash/eft/card):', 'eft') || 'eft';
      if (canFinalize) {
        const r = await this.apiOk(API.payStaffSalary?.(parseInt(d.id, 10), method, this.user), 'Payment failed');
        if (r != null) { this.toast('Payroll marked as paid', 'success'); this.refreshSection(); }
        return;
      }
      const r = await this.apiCall('hrSubmitForApproval', {
        request_type: 'payroll_pay',
        title: `Mark payroll #${d.id} paid (${method})`,
        payload: { payroll_id: parseInt(d.id, 10), payment_method: method }
      });
      if (r) { this.toast('Pay request sent for Admin approval', 'success'); this.section = 'approvals'; this.refreshSection(); }
    },
    'request-payroll-pay': async function (d) {
      return this.ACT['mark-payroll-paid'].call(this, d);
    },
    'post-payroll-accounting': async function (d) {
      const r = await this.apiCall('hrPostPayrollAccounting', parseInt(d.id, 10));
      if (r) { this.toast('Posted to accounting', 'success'); }
    },
    'add-incident': async function () {
      const emp = await this.pickEmployee('Record incident for employee');
      if (!emp) return;
      const title = await this.promptValue('Incident title:');
      if (!title) return;
      const r = await this.apiCall('hrSaveIncident', { employee_id: emp.id, title, incident_date: this.today() });
      if (r) { this.toast('Incident recorded', 'success'); this.refreshSection(); }
    },
    'add-policy': async function () {
      const title = await this.promptValue('Policy title:');
      if (!title) return;
      const r = await this.apiCall('hrSavePolicy', { title, category: 'general', version: '1.0' });
      if (r) { this.toast('Policy created', 'success'); this.refreshSection(); }
    },
    'add-rule': async function () {
      const form = await this.promptForm('Add business rule', [
        { id: 'title', label: 'Rule title', required: true },
        { id: 'body', label: 'Rule details', type: 'textarea', rows: 4 },
        { id: 'applies_to', label: 'Applies to', value: 'all' }
      ]);
      if (!form) return;
      const r = await this.apiCall('hrSaveBusinessRule', { ...form, rule_type: 'general', status: 'active' });
      if (r) { this.toast('Rule saved', 'success'); this.refreshSection(); }
    },
    'add-form': async function () {
      const title = await this.promptValue('Form title:');
      if (!title) return;
      const r = await this.apiCall('hrSaveForm', { title, form_type: 'general' });
      if (r) { this.toast('Form created', 'success'); this.refreshSection(); }
    },
    'salary-change': async function (d) {
      const amount = await this.promptValue('New basic salary amount:');
      if (!amount) return;
      const reason = await this.promptValue('Reason for change:', 'Salary review') || 'Salary review';
      const r = await this.apiCall('hrSaveSalaryChange', { employee_id: parseInt(d.id, 10), new_amount: amount, reason });
      if (r) {
        this.toast(r.request_number ? 'Salary change submitted for Admin approval' : 'Salary updated', 'success');
        if (r.request_number) this.section = 'approvals';
        this.refreshSection();
      }
    },
    'add-employer-record': async function () {
      const form = await this.promptForm('Add employer record', [
        { id: 'title', label: 'Record title', required: true },
        { id: 'record_type', label: 'Type', type: 'select', value: 'other', options: ['uif', 'sdl', 'paye', 'coida', 'other'] },
        { id: 'reference_number', label: 'Reference number' },
        { id: 'expiry_date', label: 'Expiry date', type: 'date' }
      ]);
      if (!form) return;
      const r = await this.apiCall('hrSaveEmployerRecord', form);
      if (r) { this.toast('Employer record saved', 'success'); this.refreshSection(); }
    },
    'edit-employer-record': async function (d) {
      const rows = this.asRows(await this.apiCall('hrEmployerRecords', {}));
      const existing = rows.find((r) => String(r.id) === String(d.id));
      const form = await this.promptForm('Edit employer record', [
        { id: 'title', label: 'Record title', required: true, value: existing?.title || '' },
        { id: 'record_type', label: 'Type', type: 'select', value: existing?.record_type || 'other', options: ['uif', 'sdl', 'paye', 'coida', 'other'] },
        { id: 'reference_number', label: 'Reference number', value: existing?.reference_number || '' },
        { id: 'expiry_date', label: 'Expiry date', type: 'date', value: existing?.expiry_date || '' },
        { id: 'status', label: 'Status', type: 'select', value: existing?.status || 'active', options: ['active', 'expired', 'pending'] }
      ]);
      if (!form) return;
      const r = await this.apiCall('hrSaveEmployerRecord', { ...form, id: parseInt(d.id, 10) });
      if (r) { this.toast('Employer record updated', 'success'); this.refreshSection(); }
    },
    'add-deadline': async function () {
      const form = await this.promptForm('Add compliance deadline', [
        { id: 'title', label: 'Deadline title', required: true },
        { id: 'event_type', label: 'Type', type: 'select', value: 'emp201', options: ['emp201', 'paye', 'uif', 'sdl', 'coida', 'deadline', 'other'] },
        { id: 'due_date', label: 'Due date', type: 'date', value: this.today(), required: true }
      ]);
      if (!form) return;
      const r = await this.apiCall('hrSaveComplianceEvent', { title: form.title, event_type: form.event_type, due_date: form.due_date });
      if (r) { this.toast('Deadline added', 'success'); this.refreshSection(); }
    },
    'add-disciplinary': async function () {
      const emp = await this.pickEmployee('Disciplinary case for employee');
      if (!emp) return;
      const allegation = await this.promptValue('Allegation summary:');
      if (!allegation) return;
      const r = await this.apiCall('hrSaveDisciplinaryCase', { employee_id: emp.id, allegation });
      if (r) { this.toast('Disciplinary case opened', 'success'); this.refreshSection(); }
    },
    'start-offboarding': async function () {
      const emp = await this.pickEmployee('Start offboarding for employee');
      if (!emp) return;
      const exitType = await this.promptValue('Exit type (resignation/termination/retirement):', 'resignation') || 'resignation';
      const r = await this.apiCall('hrSaveOffboarding', { employee_id: emp.id, exit_type: exitType, effective_date: this.today() });
      if (r) { this.toast('Offboarding started', 'success'); this.section = 'offboarding'; this.refreshSection(); }
    },
    'start-onboarding': async function () {
      const emp = await this.pickEmployee('Start onboarding for employee');
      if (!emp) return;
      const tpls = await this.apiCall('hrOnboardingTemplates') || [];
      const tplId = tpls[0]?.id;
      const r = await this.apiCall('hrSaveOnboardingProgress', { employee_id: emp.id, template_id: tplId, status: 'in_progress', progress_percent: 0 });
      if (r) { this.toast('Onboarding started', 'success'); this.section = 'onboarding'; this.refreshSection(); }
    },
    'complete-offboarding': async function (d) {
      const r = await this.apiCall('hrSaveOffboarding', { id: parseInt(d.id, 10), employee_id: parseInt(d.employeeId, 10), status: 'completed' });
      if (r) { this.toast('Offboarding completed', 'success'); this.refreshSection(); }
    },
    'complete-deadline': async function (d) {
      const r = await this.apiCall('hrSaveComplianceEvent', { id: parseInt(d.id, 10), status: 'completed' });
      if (r) { this.toast('Deadline marked complete', 'success'); this.refreshSection(); }
    },
    'resolve-incident': async function (d) {
      const resolution = await this.promptValue('Resolution notes:', 'Resolved') || 'Resolved';
      const r = await this.apiCall('hrSaveIncident', { id: parseInt(d.id, 10), status: 'resolved', resolution });
      if (r) { this.toast('Incident resolved', 'success'); this.refreshSection(); }
    },
    'issue-advance': async function () {
      const emp = await this.pickEmployee('Issue salary advance to');
      if (!emp) return;
      const amount = await this.promptValue('Advance amount:');
      if (!amount) return;
      const canFinalize = ['owner', 'manager'].includes(String(this.user?.role || '').toLowerCase());
      if (canFinalize) {
        const r = await this.staffApi('issueSalaryAdvance', { employee_id: emp.id, amount: parseFloat(amount), advance_date: this.today() });
        if (r) { this.toast('Advance issued', 'success'); this.refreshSection(); }
        return;
      }
      const r = await this.apiCall('hrSubmitForApproval', {
        request_type: 'advance_issue', employee_id: emp.id,
        title: `Advance R${amount} — ${emp.full_name}`,
        payload: { employee_id: emp.id, amount: parseFloat(amount), advance_date: this.today() }
      });
      if (r) { this.toast('Advance sent for Admin approval', 'success'); this.section = 'approvals'; this.refreshSection(); }
    },
    'add-loan': async function () {
      const emp = await this.pickEmployee('Add loan for employee');
      if (!emp) return;
      const amount = await this.promptValue('Loan amount:');
      if (!amount) return;
      const canFinalize = ['owner', 'manager'].includes(String(this.user?.role || '').toLowerCase());
      if (canFinalize) {
        const r = await this.staffApi('saveEmployeeLoan', { employee_id: emp.id, loan_amount: parseFloat(amount), loan_date: this.today() });
        if (r) { this.toast('Loan saved', 'success'); this.refreshSection(); }
        return;
      }
      const r = await this.apiCall('hrSubmitForApproval', {
        request_type: 'loan_add', employee_id: emp.id,
        title: `Loan R${amount} — ${emp.full_name}`,
        payload: { employee_id: emp.id, loan_amount: parseFloat(amount), amount: parseFloat(amount), loan_date: this.today() }
      });
      if (r) { this.toast('Loan sent for Admin approval', 'success'); this.section = 'approvals'; this.refreshSection(); }
    },
    'approve-salary-claim': async function (d) {
      const r = await this.apiOk(API.approveSalaryClaim?.(parseInt(d.id, 10), '', this.user), 'Approve failed');
      if (r != null) { this.toast('Salary claim approved', 'success'); this.refreshSection(); }
    },
    'reject-salary-claim': async function (d) {
      const notes = await this.promptValue('Rejection notes:', 'Rejected') || 'Rejected';
      const r = await this.apiOk(API.rejectSalaryClaim?.(parseInt(d.id, 10), notes, this.user), 'Reject failed');
      if (r != null) { this.toast('Salary claim rejected', 'info'); this.refreshSection(); }
    },
    'pay-salary-claim': async function (d) {
      const r = await this.apiOk(API.markSalaryClaimPaid?.(parseInt(d.id, 10), this.user), 'Pay failed');
      if (r != null) { this.toast('Claim marked paid', 'success'); this.refreshSection(); }
    },
    'salary-claim-pdf': async function (d) {
      await this.apiOk(API.getSalaryClaimPdf?.(parseInt(d.id, 10), this.user), 'PDF failed');
      this.toast('Salary claim PDF ready', 'success');
    },
    'add-leave': async function () {
      const emp = await this.pickEmployee('Leave request for employee');
      if (!emp) return;
      const leaveType = await this.promptValue('Leave type (Annual/Sick/Family):', 'Annual') || 'Annual';
      const start = await this.promptValue('Start date (YYYY-MM-DD):', this.today()) || this.today();
      const end = await this.promptValue('End date (YYYY-MM-DD):', start) || start;
      const days = await this.promptValue('Days:', '1') || '1';
      const r = await this.staffApi('saveStaffLeave', { employee_id: emp.id, leave_type: leaveType, start_date: start, end_date: end, days: parseFloat(days), status: 'pending' });
      if (r) { this.toast('Leave request saved', 'success'); this.refreshSection(); }
    },
    'add-request': async function () {
      const people = await this.apiCall('hrPeople', {}) || [];
      if (!people.length) { this.toast('No employees found', 'warning'); return; }
      const form = await this.promptForm('New HR request', [
        { id: 'employee_id', label: 'Employee', type: 'select', required: true, options: people.map((e) => ({ value: e.id, label: `${e.full_name} (${e.employee_code})` })) },
        { id: 'title', label: 'Request title', required: true },
        { id: 'request_type', label: 'Type', type: 'select', value: 'general', options: ['general', 'leave', 'payroll', 'disciplinary', 'other'] }
      ]);
      if (!form) return;
      const r = await this.apiCall('hrSaveRequest', {
        employee_id: parseInt(form.employee_id, 10),
        title: form.title,
        request_type: form.request_type,
        status: 'submitted'
      });
      if (r) { this.toast('Request submitted', 'success'); this.refreshSection(); }
    },
    'add-warning': async function () {
      const emp = await this.pickEmployee('Warning for employee');
      if (!emp) return;
      const warningType = await this.promptValue('Warning type (Verbal/Written/Final):', 'Written') || 'Written';
      const reason = await this.promptValue('Reason:');
      if (!reason) return;
      const r = await this.staffApi('saveStaffDisciplinary', { employee_id: emp.id, warning_type: warningType, reason, incident_date: this.today(), status: 'active' });
      if (r) { this.toast('Warning recorded', 'success'); this.refreshSection(); }
    },
    'add-penalty': async function () {
      const emp = await this.pickEmployee('Penalty for employee');
      if (!emp) return;
      const amount = await this.promptValue('Penalty amount:');
      if (!amount) return;
      const reason = await this.promptValue('Reason:') || 'Attendance penalty';
      const r = await this.staffApi('addAttendancePenalty', { employee_id: emp.id, amount: parseFloat(amount), reason, penalty_date: this.today() });
      if (r) { this.toast('Penalty added', 'success'); this.refreshSection(); }
    },
    'approve-penalty': async function (d) {
      const r = await this.staffApi('addAttendancePenalty', { id: parseInt(d.id, 10), status: 'approved' });
      if (r != null) { this.toast('Penalty approved', 'success'); this.refreshSection(); }
    },
    'cancel-penalty': async function (d) {
      const r = await this.apiOk(API.cancelAttendancePenalty?.(parseInt(d.id, 10), this.user), 'Cancel failed');
      if (r != null) { this.toast('Penalty cancelled', 'info'); this.refreshSection(); }
    },
    'update-disciplinary': async function (d) {
      const stage = await this.promptValue('New stage (investigation/hearing/appeal/closed):', 'investigation');
      if (!stage) return;
      const r = await this.apiCall('hrSaveDisciplinaryCase', { id: parseInt(d.id, 10), stage });
      if (r) { this.toast('Case updated', 'success'); this.refreshSection(); }
    },
    'ack-policy': async function (d) {
      const emp = await this.pickEmployee('Acknowledge policy for employee');
      if (!emp) return;
      const r = await this.apiCall('hrAcknowledgePolicy', parseInt(d.id, 10), emp.id, {});
      if (r) { this.toast('Policy acknowledged', 'success'); this.refreshSection(); }
    },
    'view-rule': async function (d) {
      const rows = this.asRows(await this.apiCall('hrBusinessRules', {}));
      const rule = rows.find((r) => String(r.id) === String(d.id));
      if (rule) this.openModal(rule.title, `<pre class="hr-pre">${this.esc(rule.body || 'No body text')}</pre>`);
    },
    'leave-pdf': async function (d) {
      const r = await API.getStaffLeavePdf?.(parseInt(d.id, 10));
      if (r?.path) this.toast(`Leave PDF saved: ${r.path}`, 'success');
    },
    'warning-pdf': async function (d) {
      const r = await API.getStaffDisciplinaryPdf?.(parseInt(d.id, 10));
      if (r?.path) this.toast(`Warning PDF saved: ${r.path}`, 'success');
    },
    'print-schedule': async function () {
      const html = await this.staffApi('getStaffSchedulePrintHtml', this.dateOffset(-7), this.dateOffset(21));
      if (!html) return;
      if (typeof Export !== 'undefined' && Export.printHtml) await Export.printHtml('Shift Schedule', html);
      else { const w = window.open('', '_blank'); w.document.write(html); w.print(); }
    },
    'statutory-pdf': async function (d) {
      const type = d.type || 'paye';
      const from = this.dateOffset(-30);
      const to = this.today();
      const r = await this.apiOk(API.getPayrollCompliancePdf?.(type, from, to), 'PDF failed');
      if (r?.path) this.toast(`Report saved: ${r.path}`, 'success');
    },
    'report-pdf': async function (d) {
      const type = d.type || 'employees';
      const people = await this.apiCall('hrPeople', {}) || [];
      const data = type === 'employees' ? { employees: people }
        : type === 'payroll' ? { rows: await this.apiCall('hrListPayroll', {}) }
          : type === 'leave' ? { rows: await this.staffApi('getAllStaffLeave') }
            : { rows: (await this.apiCall('hrAttendanceHub', { view: 'clock-ins' }))?.rows };
      const r = await this.apiOk(API.getStaffReportPdf?.(type, data), 'Report failed');
      if (r?.path) this.toast(`Report saved: ${r.path}`, 'success');
    },
    'add-employee': async function () {
      const form = await this.promptForm('Add worker (Admin must approve)', [
        { id: 'full_name', label: 'Full name', required: true },
        { id: 'position', label: 'Position' },
        { id: 'department', label: 'Department' },
        { id: 'employment_type', label: 'Type', type: 'select', value: 'permanent', options: ['permanent', 'casual', 'contract', 'intern'] },
        { id: 'basic_salary', label: 'Basic salary', type: 'number' },
        { id: 'phone', label: 'Phone' }
      ]);
      if (!form) return;
      const r = await this.apiCall('hrSubmitForApproval', {
        request_type: 'employee_create',
        title: `Add worker — ${form.full_name}`,
        details: form.position || form.employment_type,
        payload: {
          full_name: form.full_name,
          position: form.position,
          department: form.department,
          employment_type: form.employment_type,
          basic_salary: parseFloat(form.basic_salary) || 0,
          phone: form.phone,
          status: 'Active'
        }
      });
      if (r) { this.toast('New worker submitted for Admin approval', 'success'); this.section = 'approvals'; this.refreshSection(); }
    },
    'save-settings': async function () {
      const on = (id) => !!document.getElementById(id)?.checked;
      const val = (id) => document.getElementById(id)?.value ?? '';
      const num = (id) => {
        const n = parseFloat(val(id));
        return Number.isFinite(n) ? n : undefined;
      };
      const payroll = {
        paye_enabled: on('hr-paye-enabled'),
        paye_registration_number: val('hr-paye-reg'),
        company_paye_number: val('hr-paye-reg'),
        tax_number: val('hr-tax-number'),
        sars_tax_office: val('hr-sars-office'),
        uif_enabled: on('hr-uif-enabled'),
        uif_registration_number: val('hr-uif-reg'),
        company_uif_number: val('hr-uif-reg'),
        uif_employee_rate: num('hr-uif-ee'),
        uif_employer_rate: num('hr-uif-er'),
        uif_ceiling: num('hr-uif-ceiling'),
        sdl_enabled: on('hr-sdl-enabled'),
        sdl_registration_number: val('hr-sdl-reg'),
        company_sdl_number: val('hr-sdl-reg'),
        sdl_rate: num('hr-sdl-rate'),
        coida_enabled: on('hr-coida-enabled'),
        coida_registration_number: val('hr-coida-reg'),
        company_coida_number: val('hr-coida-reg'),
        coida_employer_ref: val('hr-coida-ref'),
        coida_rate: num('hr-coida-rate')
      };
      const r = await this.apiCall('hrSaveSettings', {
        hr: { notes: val('hr-set-notes') },
        payroll
      });
      if (r) this.toast('HR & payroll statutory settings saved (shared with Admin)', 'success');
    }
  }
};

window.HrApp = HrApp;
if (typeof window.HrParityInit === 'function') window.HrParityInit();

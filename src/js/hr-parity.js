/**
 * HR workspace parity with Admin — Training, Probation, Recruitment, Payroll hub, EOM, Ops.
 * HR can view and prepare; owner/manager finalizes (or actions queue in HR Approvals).
 */
(function () {
  const Hr = window.HrApp;
  if (!Hr || Hr._parityLoaded) return;
  Hr._parityLoaded = true;
  Hr.build = '2026.09.02-hr-full-parity';

  Hr.canFinalize = function () {
    return ['owner', 'manager'].includes(String(this.user?.role || '').toLowerCase());
  };

  Hr._approvalGateDepth = 0;

  const GATED_APIS = {
    saveHrTrainingRecord: {
      type: 'training_save',
      title: (data) => `Training — ${data?.status || 'update'} (${data?.employee_id || 'staff'})`,
      payload: (data) => ({ data })
    },
    saveHrTrainingEvaluation: {
      type: 'training_eval',
      title: (_, data) => `Training evaluation — day ${data?.day_number || '?'}`,
      payload: (recordId, data) => ({ recordId, data })
    },
    deleteHrTrainingRecord: {
      type: 'training_delete',
      title: () => 'Delete training record',
      payload: (id) => ({ id })
    },
    saveHrTrainingTemplate: {
      type: 'training_template_save',
      title: (data) => `Training template — ${data?.title || 'update'}`,
      payload: (data) => ({ data })
    },
    deleteHrTrainingTemplate: {
      type: 'training_template_delete',
      title: () => 'Delete training template',
      payload: (id) => ({ id })
    },
    updateHrStaffSubmission: {
      type: 'staff_submission_update',
      title: () => 'Update staff submission',
      payload: (id, data) => ({ id, data })
    },
    deleteHrStaffSubmission: {
      type: 'staff_submission_delete',
      title: () => 'Delete staff submission',
      payload: (id) => ({ id })
    },
    saveProbation: {
      type: 'probation_save',
      title: (data) => `Probation setup — employee #${data?.employee_id || '?'}`,
      payload: (data) => ({ data })
    },
    deleteProbation: {
      type: 'probation_delete',
      title: () => 'Delete probation record',
      payload: (id) => ({ id })
    },
    saveProbationEvaluation: {
      type: 'probation_eval',
      title: (data) => `Probation evaluation — day ${data?.day_number || '?'}`,
      payload: (data) => ({ data })
    },
    finalProbationDecision: {
      type: 'probation_decision',
      title: (_, decision) => `Probation decision — ${decision}`,
      payload: (probationId, decision, reason, extendDays) => ({ probationId, decision, reason, extendDays })
    },
    saveHrContract: {
      type: 'hr_contract_save',
      title: (data) => `Employment contract — employee #${data?.employee_id || '?'}`,
      payload: (data) => ({ data })
    },
    openHrContractResign: {
      type: 'hr_contract_resign',
      title: () => 'Open contract re-sign window',
      payload: (id, opensAt, closesAt) => ({ id, opensAt, closesAt })
    },
    saveContractTemplate: {
      type: 'contract_template_save',
      title: (data) => `Contract template — ${data?.title || 'update'}`,
      payload: (data) => ({ data })
    },
    deleteContractTemplate: {
      type: 'contract_template_delete',
      title: () => 'Delete contract template',
      payload: (id) => ({ id })
    },
    decideJobCandidate: {
      type: 'recruitment_hire',
      title: (_, decision) => `Recruitment — ${decision} candidate`,
      payload: (id, decision, notes) => ({ candidateId: id, decision, notes })
    },
    saveJobPosting: {
      type: 'recruitment_posting_save',
      title: (data) => `Job posting — ${data?.title || 'update'}`,
      payload: (data) => ({ data })
    },
    deleteJobPosting: {
      type: 'recruitment_posting_delete',
      title: () => 'Delete job posting',
      payload: (id) => ({ id })
    },
    saveJobCandidate: {
      type: 'recruitment_candidate_save',
      title: (data) => `Candidate — ${data?.name || 'update'}`,
      payload: (data) => ({ data })
    },
    saveRecruitmentSettings: {
      type: 'recruitment_settings',
      title: () => 'Recruitment settings',
      payload: (data) => ({ data })
    },
    saveEmployeeOfMonth: {
      type: 'eom_save',
      title: (data) => `Employee of Month — ${data?.month_year || ''}`,
      payload: (data) => ({ data })
    },
    deleteEmployeeOfMonth: {
      type: 'eom_delete',
      title: () => 'Delete Employee of Month record',
      payload: (id) => ({ id })
    },
    savePayrollSettings: {
      type: 'payroll_settings',
      title: () => 'Payroll & compliance settings',
      payload: (data) => ({ partial: data })
    },
    issueSalaryAdvance: {
      type: 'advance_issue',
      title: (data) => `Salary advance — employee #${data?.employee_id || '?'}`,
      payload: (data) => ({ data })
    },
    saveEmployeeLoan: {
      type: 'loan_add',
      title: (data) => `Employee loan — employee #${data?.employee_id || '?'}`,
      payload: (data) => ({ data })
    },
    saveDamageCost: {
      type: 'damage_cost',
      title: (data) => `Damage cost — employee #${data?.employee_id || '?'}`,
      payload: (data) => ({ data })
    },
    generateStaffPayroll: {
      type: 'payroll_generate',
      title: (start, end) => `Generate payroll ${start} – ${end}`,
      payload: (start, end) => ({ period_start: start, period_end: end })
    },
    payStaffSalary: {
      type: 'payroll_pay',
      title: (id) => `Mark payroll #${id} paid`,
      payload: (id, method) => ({ payroll_id: id, payment_method: method || 'eft' })
    },
    saveCompanyRule: {
      type: 'ops_rule_save',
      title: (data) => `Company rule — ${data?.title || 'update'}`,
      payload: (data) => ({ data })
    },
    archiveCompanyRule: {
      type: 'ops_rule_delete',
      title: () => 'Archive company rule',
      payload: (id) => ({ id })
    },
    saveOpeningTemplate: {
      type: 'ops_opening_save',
      title: () => 'Morning opening routine',
      payload: (data) => ({ data })
    },
    saveClosingTemplate: {
      type: 'ops_closing_save',
      title: () => 'Closing routine',
      payload: (data) => ({ data })
    },
    saveAdminSignature: {
      type: 'ops_signature_save',
      title: () => 'Admin signature for compliance PDFs',
      payload: (path) => ({ path })
    },
    updateStaffSelfie: {
      type: 'selfie_update',
      title: () => 'Replace login selfie',
      payload: (id, photoData, notes) => ({ id, photoData, notes })
    },
    deleteStaffSelfie: {
      type: 'selfie_delete',
      title: () => 'Delete login selfie',
      payload: (id) => ({ id })
    }
  };

  Hr.installApprovalGate = function () {
    if (this.canFinalize() || typeof API === 'undefined') return () => {};
    const self = this;
    const restore = {};
    Object.entries(GATED_APIS).forEach(([method, meta]) => {
      if (typeof API[method] !== 'function') return;
      restore[method] = API[method];
      API[method] = async function (...args) {
        const dataArg = args[0];
        const title = typeof meta.title === 'function' ? meta.title(...args) : meta.title;
        const payload = meta.payload(...args);
        const employeeId = payload.data?.employee_id || dataArg?.employee_id || null;
        const r = await self.apiCall('hrSubmitForApproval', {
          request_type: meta.type,
          title,
          employee_id: employeeId,
          details: 'Submitted from HR workspace — awaiting Admin approval',
          payload
        });
        if (r) self.toast('Sent for Admin approval', 'success');
        return { success: !!r, pending_approval: true, data: r };
      };
    });
    self._approvalGateDepth += 1;
    return () => {
      Object.assign(API, restore);
      self._approvalGateDepth = Math.max(0, self._approvalGateDepth - 1);
    };
  };

  Hr.ensureAdminStub = async function () {
    if (!this.app) return null;
    if (!window.AdminPage) {
      window.AdminPage = {
        sections: [],
        app: this.app,
        settings: this.app.settings || {},
        section: 'overview',
        payrollTab: 'settings',
        toggleOpsComplianceLayout() {},
        renderSection() {}
      };
    }
    window.AdminPage.app = this.app;
    window.AdminPage.settings = this.app.settings || {};
    return window.AdminPage;
  };

  Hr.ensureScript = async function (path) {
    if (this.app?.ensureFeatureScript) await this.app.ensureFeatureScript(path);
    else if (typeof Utils?.loadScript === 'function') await Utils.loadScript(path);
  };

  Hr.hrModeBanner = function () {
    if (this.canFinalize()) return '';
    return `<div class="hr-note" style="margin-bottom:12px;border-left:3px solid var(--warning);padding:10px 12px">
      <strong>HR mode</strong> — you can view, evaluate, and prepare actions. Saves and final decisions are sent to <button type="button" class="btn btn-link" data-hr-act="nav" data-section="approvals">Admin Approvals</button> for owner/manager sign-off.</div>`;
  };

  Hr.renderEmbedded = async function (el, opts) {
    const { script, render, tabKey, tab } = opts;
    el.innerHTML = `${this.hrModeBanner()}<div id="hr-embed-root"><p class="muted">Loading…</p></div>`;
    const root = document.getElementById('hr-embed-root');
    await this.ensureAdminStub();
    await this.ensureScript(script);
    const fakeAdmin = { app: this.app, settings: this.app.settings || {} };
    if (tabKey && tab && window[render]) window[render][tabKey] = tab;
    const page = window[render];
    if (!page?.render) {
      root.innerHTML = '<p class="error-msg">Module failed to load. Reload the app.</p>';
      return;
    }
    await page.render(root, fakeAdmin);
    root.querySelector('#ops-back-admin')?.remove();
    root.querySelector('button[id="ops-back-admin"]')?.remove();
  };

  Hr.renderHrTraining = function (el) {
    return this.renderEmbedded(el, { script: 'js/pages/admin-hr.js', render: 'AdminHrPage', tabKey: 'tab', tab: 'training' });
  };
  Hr.renderHrProbation = function (el) {
    return this.renderEmbedded(el, { script: 'js/pages/admin-hr.js', render: 'AdminHrPage', tabKey: 'tab', tab: 'probation' });
  };
  Hr.renderHrEmploymentContracts = function (el) {
    return this.renderEmbedded(el, { script: 'js/pages/admin-hr.js', render: 'AdminHrPage', tabKey: 'tab', tab: 'contracts' });
  };
  Hr.renderHrTpForms = function (el) {
    return this.renderEmbedded(el, { script: 'js/pages/admin-hr.js', render: 'AdminHrPage', tabKey: 'tab', tab: 'templates' });
  };
  Hr.renderHrContractTemplates = function (el) {
    return this.renderEmbedded(el, { script: 'js/pages/admin-hr.js', render: 'AdminHrPage', tabKey: 'tab', tab: 'contract-templates' });
  };
  Hr.renderHrProbationEvals = function (el) {
    return this.renderEmbedded(el, { script: 'js/pages/admin-hr.js', render: 'AdminHrPage', tabKey: 'tab', tab: 'evaluations' });
  };
  Hr.renderHrStaffSubmissions = function (el) {
    return this.renderEmbedded(el, { script: 'js/pages/admin-hr.js', render: 'AdminHrPage', tabKey: 'tab', tab: 'submissions' });
  };
  Hr.renderRecruitment = function (el) {
    return this.renderEmbedded(el, { script: 'js/pages/admin-recruitment.js', render: 'AdminRecruitmentPage' });
  };
  Hr.renderPayrollCompliance = async function (el) {
    el.innerHTML = `${this.hrModeBanner()}<div id="hr-embed-root"><p class="muted">Loading…</p></div>`;
    const root = document.getElementById('hr-embed-root');
    await this.ensureAdminStub();
    await this.ensureScript('js/pages/admin-payroll.js');
    if (!window.AdminPage?.renderPayrollCompliance) {
      root.innerHTML = '<p class="error-msg">Payroll module failed to load</p>';
      return;
    }
    window.AdminPage.payrollTab = this._payrollTab || 'settings';
    await window.AdminPage.renderPayrollCompliance(root);
    root.querySelector('#payroll-tabs')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-tab]');
      if (!btn) return;
      this._payrollTab = btn.dataset.tab;
    });
  };
  Hr.renderEmployeeMonth = function (el) {
    return this.renderEmbedded(el, { script: 'js/pages/admin-employee-month.js', render: 'AdminEmployeeMonthPage' });
  };
  Hr.renderOperations = async function (el) {
    el.innerHTML = `${this.hrModeBanner()}<div id="hr-embed-root"><p class="muted">Loading…</p></div>`;
    const root = document.getElementById('hr-embed-root');
    await this.ensureAdminStub();
    await this.ensureScript('js/pages/admin-operations.js');
    if (!window.AdminPage?.renderOpsCompliance) {
      root.innerHTML = '<p class="error-msg">Operations module failed to load</p>';
      return;
    }
    await window.AdminPage.renderOpsCompliance(root);
    root.querySelector('#ops-back-admin')?.remove();
  };

  Hr.renderLoginSelfies = async function (el) {
    const from = this._selfieFrom || this.dateOffset(-30);
    const to = this._selfieTo || this.today();
    const rows = await this.apiOk(API.getStaffSelfies?.({ from, to }, this.user), 'Selfies load failed') || [];
    const list = Array.isArray(rows) ? rows : (rows.items || rows.data || []);
    const canEdit = this.canFinalize();
    const esc = (v) => this.esc(v);
    const fmtDt = (v) => (typeof Utils !== 'undefined' && Utils.formatDateTime) ? Utils.formatDateTime(v) : String(v || '').slice(0, 19);
    el.innerHTML = `${this.sectionHead(`${this.btn('Refresh', 'refresh')}`)}
      <p class="muted">Staff Portal login verification selfies — shared with Admin → Staff &amp; HR. HR and Admin can view; edits need Admin approval unless you are owner/manager.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0;align-items:end">
        <div class="field"><label>From</label><input type="date" id="hr-sf-from" value="${esc(from)}"></div>
        <div class="field"><label>To</label><input type="date" id="hr-sf-to" value="${esc(to)}"></div>
        <button type="button" class="btn btn-primary" data-hr-act="filter-selfies">Filter</button>
      </div>
      ${this.table(['Photo', 'Employee', 'Date', 'Time', 'Status', ''],
        list.map((s) => `<tr>
          <td>${s.photo_data ? `<img src="${s.photo_data}" alt="" style="width:56px;height:56px;object-fit:cover;border-radius:8px;cursor:pointer" data-hr-act="view-selfie" data-id="${s.id}">` : '—'}</td>
          <td><strong>${esc(s.employee_name)}</strong><br><small>${esc(s.employee_code || '')} · ${esc(s.branch || '—')}</small></td>
          <td>${esc(s.login_date)}</td>
          <td>${esc(fmtDt(s.login_at))}</td>
          <td>${s.is_edited ? '<span class="tag" style="background:var(--warning)">Edited</span>' : '<span class="tag">Original</span>'}</td>
          <td style="white-space:nowrap">
            <button type="button" class="btn btn-sm btn-ghost" data-hr-act="view-selfie" data-id="${s.id}">View</button>
            ${canEdit ? `<button type="button" class="btn btn-sm btn-ghost" data-hr-act="edit-selfie" data-id="${s.id}">Replace</button>
            <button type="button" class="btn btn-sm btn-danger" data-hr-act="delete-selfie" data-id="${s.id}">Delete</button>` : ''}
          </td></tr>`).join(''), 'No login selfies in this period')}`;
  };

  Hr.renderTraining = function (el) {
    return Hr.renderHrTraining(el);
  };

  const NAV_INSERT = [
    ['Training & Probation', [
      ['hr-training', 'Training'],
      ['hr-probation', 'Probation'],
      ['hr-employment-contracts', 'Employment Contracts'],
      ['hr-tp-forms', 'Training & Probation Forms'],
      ['hr-hr-contract-templates', 'Contract Templates'],
      ['hr-probation-evals', 'Probation Evaluations'],
      ['hr-staff-submissions', 'Staff Submissions']
    ]],
    ['Recruitment', [['recruitment', 'Recruitment']]],
    ['Payroll Hub', [['payroll-compliance', 'Payroll & Compliance']]],
    ['Recognition', [['employee-month', 'Employee of the Month']]],
    ['Operations', [['operations', 'Operations & Compliance']]]
  ];

  const trainingIdx = Hr.NAV.findIndex(([g]) => g === 'Training');
  if (trainingIdx >= 0) Hr.NAV.splice(trainingIdx, 1);
  const perfIdx = Hr.NAV.findIndex(([g]) => g === 'Performance');
  const insertAt = perfIdx >= 0 ? perfIdx : Hr.NAV.length - 3;
  Hr.NAV.splice(insertAt, 0, ...NAV_INSERT);

  Object.assign(Hr.SECTION_META, {
    'hr-training': ['Training', 'Daily evaluations, pass to probation, PDF/print/WhatsApp — same as Admin Contracts & Probation.'],
    'hr-probation': ['Probation', 'Setup probation, daily evaluations, final decision and letters.'],
    'hr-employment-contracts': ['Employment Contracts', 'Issue contracts after probation; re-sign windows and PDFs.'],
    'hr-tp-forms': ['Training & Probation Forms', 'Chisanyama Connection training and probation agreement templates.'],
    'hr-hr-contract-templates': ['Contract Templates', 'Reusable employment contract templates.'],
    'hr-probation-evals': ['Probation Evaluations', 'Probation evaluation history and scoring.'],
    'hr-staff-submissions': ['Staff Submissions', 'Forms staff completed in Staff Portal — review and approve.'],
    recruitment: ['Recruitment', 'Job postings, candidates, interviews, WhatsApp — hire/reject needs Admin approval.'],
    'payroll-compliance': ['Payroll & Compliance', 'UIF, PAYE, SDL, COIDA, advances, loans, damage, run payroll, salary claims.'],
    'employee-month': ['Employee of the Month', 'Confirm winner, portal display, bonus on next salary — Admin approves if HR submits.'],
    operations: ['Operations & Compliance', 'Company rules, opening/closing checklists, admin signature on PDFs.']
  });

  const RENDER_MAP = {
    'hr-training': 'renderHrTraining',
    'hr-probation': 'renderHrProbation',
    'hr-employment-contracts': 'renderHrEmploymentContracts',
    'hr-tp-forms': 'renderHrTpForms',
    'hr-hr-contract-templates': 'renderHrContractTemplates',
    'hr-probation-evals': 'renderHrProbationEvals',
    'hr-staff-submissions': 'renderHrStaffSubmissions',
    recruitment: 'renderRecruitment',
    'payroll-compliance': 'renderPayrollCompliance',
    'employee-month': 'renderEmployeeMonth',
    operations: 'renderOperations'
  };

  const origRefresh = Hr.refreshSection.bind(Hr);
  Hr.refreshSection = async function () {
    if (this._gateRestore) {
      this._gateRestore();
      this._gateRestore = null;
    }
    const extra = RENDER_MAP[this.section];
    if (extra && typeof this[extra] === 'function') {
      if (!this.canFinalize()) this._gateRestore = this.installApprovalGate();
      const body = document.getElementById('hr-section-body');
      if (!body) return origRefresh();
      const token = (this._sectionToken = (this._sectionToken || 0) + 1);
      const sectionAtStart = this.section;
      body.innerHTML = '<p class="muted">Loading…</p>';
      try {
        await this[extra].call(this, body);
        if (token !== this._sectionToken || this.section !== sectionAtStart) return;
      } catch (err) {
        if (token !== this._sectionToken || this.section !== sectionAtStart) return;
        body.innerHTML = `${this.sectionHead('')}<p class="error-msg">${this.esc(err.message)}</p>`;
      }
      return;
    }
    return origRefresh();
  };

  Object.assign(Hr.ACT, {
    'filter-selfies': function () {
      this._selfieFrom = document.getElementById('hr-sf-from')?.value;
      this._selfieTo = document.getElementById('hr-sf-to')?.value;
      this.refreshSection();
    },
    'view-selfie': async function (d) {
      const r = await API.getStaffSelfie(parseInt(d.id, 10), this.user);
      const s = r?.data;
      if (!s) return this.toast('Not found', 'error');
      const esc = (v) => this.esc(v);
      const fmtDt = (v) => (typeof Utils !== 'undefined' && Utils.formatDateTime) ? Utils.formatDateTime(v) : v;
      if (typeof Utils !== 'undefined' && Utils.showModal) {
        Utils.showModal(`${s.employee_name} — ${s.login_date}`, `
          <img src="${s.photo_data}" alt="" style="width:100%;max-width:400px;border-radius:12px;display:block;margin:0 auto">
          ${s.is_edited ? `<p class="muted" style="margin-top:8px">Edited by ${esc(s.edited_by_name || 'admin')} on ${esc(fmtDt(s.edited_at))}</p>` : ''}`,
          '<button type="button" class="btn btn-ghost" onclick="Utils.hideModal()">Close</button>');
      }
    },
    'edit-selfie': async function (d) {
      if (!this.canFinalize()) {
        const notes = await this.promptValue('Reason for replacement (sent for Admin approval):');
        if (!notes) return;
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*';
        fileInput.onchange = async () => {
          const file = fileInput.files?.[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = async () => {
            const restore = this.installApprovalGate();
            try {
              const r = await API.updateStaffSelfie(parseInt(d.id, 10), reader.result, notes, this.user);
              if (r?.pending_approval) this.section = 'approvals';
              this.refreshSection();
            } finally { restore(); }
          };
          reader.readAsDataURL(file);
        };
        fileInput.click();
        return;
      }
      this.ACT['view-selfie'].call(this, d);
    },
    'delete-selfie': async function (d) {
      if (!confirm('Delete this login selfie?')) return;
      if (!this.canFinalize()) {
        const restore = this.installApprovalGate();
        try {
          await API.deleteStaffSelfie(parseInt(d.id, 10), this.user);
          this.toast('Delete request sent for Admin approval', 'success');
          this.section = 'approvals';
          this.refreshSection();
        } finally { restore(); }
        return;
      }
      const r = await this.apiOk(API.deleteStaffSelfie(parseInt(d.id, 10), this.user), 'Delete failed');
      if (r != null) { this.toast('Deleted', 'success'); this.refreshSection(); }
    }
  });
})();

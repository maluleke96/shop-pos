// Admin Payroll & Compliance
(function () {
  if (!window.AdminPage) return;

  if (!AdminPage.sections.some(s => s.id === 'payroll')) {
    AdminPage.sections.splice(4, 0, { id: 'payroll', label: '💼 Payroll & Compliance', icon: 'payroll' });
  }

  const origRenderSection = AdminPage.renderSection.bind(AdminPage);
  AdminPage.renderSection = async function (el) {
    if (this.section === 'payroll') return this.renderPayrollCompliance(el);
    return origRenderSection(el);
  };

  AdminPage.renderPayrollCompliance = async function (el) {
    this.payrollTab = this.payrollTab || 'settings';
    const tabs = [
      ['settings', 'Settings'], ['uif', 'UIF'], ['paye', 'PAYE / SARS'], ['sdl', 'SDL'], ['coida', 'COIDA'],
      ['setup', 'Payroll Setup'], ['advances', 'Salary Advances'], ['loans', 'Loans'],
      ['damage', 'Damage Costs'], ['payroll', 'Run Payroll'], ['claims', 'Salary Claims'],
      ['compliance', 'Compliance'], ['reports', 'Reports']
    ];
    el.innerHTML = `<div class="admin-section"><h3>Payroll & Compliance</h3>
      <p class="muted">UIF, PAYE, SDL, COIDA, salary advances, loans, damage costs, and statutory reports.</p>
      <div class="form-tabs" id="payroll-tabs" style="flex-wrap:wrap">${tabs.map(([id, label]) =>
        `<button type="button" class="form-tab ${this.payrollTab === id ? 'active' : ''}" data-tab="${id}">${label}</button>`).join('')}</div>
      <div id="payroll-content"><p class="muted">Loading…</p></div></div>`;
    el.querySelector('#payroll-tabs').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-tab]');
      if (!btn) return;
      this.payrollTab = btn.dataset.tab;
      this.renderPayrollCompliance(el);
    });
    const content = document.getElementById('payroll-content');
    const res = await API.getPayrollSettings();
    this.payrollSettings = res.data || {};
    const renderers = {
      settings: () => this.renderPayrollCompanySettings(content),
      uif: () => this.renderPayrollUif(content),
      paye: () => this.renderPayrollPaye(content),
      sdl: () => this.renderPayrollSdl(content),
      coida: () => this.renderPayrollCoida(content),
      setup: () => this.renderPayrollSetup(content),
      advances: () => this.renderPayrollAdvances(content),
      loans: () => this.renderPayrollLoans(content),
      damage: () => this.renderPayrollDamage(content),
      payroll: () => this.renderPayrollRun(content),
      claims: () => this.renderSalaryClaims(content),
      compliance: () => this.renderPayrollComplianceTab(content),
      reports: () => this.renderPayrollReports(content)
    };
    await (renderers[this.payrollTab] || renderers.settings)();
  };

  AdminPage.savePayrollSettingsPartial = async function (partial) {
    const r = await API.savePayrollSettings(partial, this.app.user);
    if (r.success) {
      this.payrollSettings = { ...this.payrollSettings, ...partial };
      Utils.toast('Settings saved', 'success');
      this.app.loadNotifications?.();
    } else Utils.toast(r.error || 'Save failed', 'error');
  };

  AdminPage.renderPayrollCompanySettings = function (el) {
    const s = this.payrollSettings;
    el.innerHTML = `<div class="card"><div class="card-body"><div class="form-grid">
      <div class="field"><label>Company PAYE Number</label><input id="pc-paye" value="${s.company_paye_number || ''}"></div>
      <div class="field"><label>Company UIF Number</label><input id="pc-uif" value="${s.company_uif_number || ''}"></div>
      <div class="field"><label>Company SDL Number</label><input id="pc-sdl" value="${s.company_sdl_number || ''}"></div>
      <div class="field"><label>Company COIDA Number</label><input id="pc-coida" value="${s.company_coida_number || ''}"></div>
      <div class="field full"><label>SARS Tax Office Details</label><input id="pc-office" value="${s.sars_tax_office || ''}"></div>
      <div class="field full"><label><input type="checkbox" id="pc-reminders" ${s.compliance_reminders !== false ? 'checked' : ''}> Enable compliance reminders</label></div>
    </div><button class="btn btn-primary" id="pc-save" style="margin-top:16px">Save Company Settings</button></div></div>`;
    document.getElementById('pc-save').addEventListener('click', () => this.savePayrollSettingsPartial({
      company_paye_number: document.getElementById('pc-paye').value.trim(),
      company_uif_number: document.getElementById('pc-uif').value.trim(),
      company_sdl_number: document.getElementById('pc-sdl').value.trim(),
      company_coida_number: document.getElementById('pc-coida').value.trim(),
      sars_tax_office: document.getElementById('pc-office').value.trim(),
      compliance_reminders: document.getElementById('pc-reminders').checked
    }));
  };

  AdminPage.renderPayrollUif = function (el) {
    const s = this.payrollSettings;
    el.innerHTML = `<div class="card"><div class="card-body"><div class="form-grid">
      <div class="field full"><label><input type="checkbox" id="uif-en" ${s.uif_enabled ? 'checked' : ''}> Enable UIF <span class="muted">(off until you allow it)</span></label></div>
      <div class="field"><label>UIF Registration Number</label><input id="uif-reg" value="${s.uif_registration_number || ''}"></div>
      <div class="field"><label>Employee UIF Contribution (%)</label><input type="number" id="uif-emp" step="0.01" value="${s.uif_employee_rate ?? 1}"></div>
      <div class="field"><label>Employer UIF Contribution (%)</label><input type="number" id="uif-er" step="0.01" value="${s.uif_employer_rate ?? 1}"></div>
      <div class="field"><label>Monthly Remuneration Ceiling (R)</label><input type="number" id="uif-ceil" step="0.01" value="${s.uif_ceiling ?? 17712}"></div>
      <div class="field full"><label><input type="checkbox" id="uif-auto" ${s.uif_auto_calculate !== false ? 'checked' : ''}> Auto Calculate UIF</label></div>
      <div class="field full"><label><input type="checkbox" id="uif-slip" ${s.uif_on_payslip !== false ? 'checked' : ''}> Include UIF on Payslip</label></div>
    </div><button class="btn btn-primary" id="uif-save" style="margin-top:16px">Save UIF Settings</button>
    <button class="btn btn-ghost" id="uif-export" style="margin-top:16px;margin-left:8px">Export UIF Report (PDF)</button></div></div>`;
    document.getElementById('uif-save').addEventListener('click', () => this.savePayrollSettingsPartial({
      uif_enabled: document.getElementById('uif-en').checked,
      uif_registration_number: document.getElementById('uif-reg').value.trim(),
      uif_employee_rate: parseFloat(document.getElementById('uif-emp').value) || 1,
      uif_employer_rate: parseFloat(document.getElementById('uif-er').value) || 1,
      uif_ceiling: parseFloat(document.getElementById('uif-ceil').value) || 17712,
      uif_auto_calculate: document.getElementById('uif-auto').checked,
      uif_on_payslip: document.getElementById('uif-slip').checked
    }));
    document.getElementById('uif-export').addEventListener('click', () => this.exportPayrollReport('uif'));
  };

  AdminPage.renderPayrollPaye = function (el) {
    const s = this.payrollSettings;
    el.innerHTML = `<div class="card"><div class="card-body"><div class="form-grid">
      <div class="field full"><label><input type="checkbox" id="paye-en" ${s.paye_enabled ? 'checked' : ''}> Enable PAYE <span class="muted">(off until you allow it)</span></label></div>
      <div class="field"><label>PAYE Registration Number</label><input id="paye-reg" value="${s.paye_registration_number || ''}"></div>
      <div class="field"><label>Tax Number</label><input id="paye-tax" value="${s.tax_number || ''}"></div>
      <div class="field full"><label><input type="checkbox" id="paye-auto" ${s.paye_auto_calculate !== false ? 'checked' : ''}> Auto Calculate PAYE (SARS 2024/25 brackets)</label></div>
      <p class="full muted" style="font-size:13px;margin:0">Tax is calculated from monthly gross using annual SARS tax tables.</p>
    </div><button class="btn btn-primary" id="paye-save" style="margin-top:16px">Save PAYE Settings</button>
    <button class="btn btn-ghost" id="paye-export" style="margin-left:8px">Monthly Tax Report (PDF)</button>
    <button class="btn btn-ghost" id="paye-annual" style="margin-left:8px">Annual Tax Report (PDF)</button></div></div>`;
    document.getElementById('paye-save').addEventListener('click', () => this.savePayrollSettingsPartial({
      paye_enabled: document.getElementById('paye-en').checked,
      paye_registration_number: document.getElementById('paye-reg').value.trim(),
      tax_number: document.getElementById('paye-tax').value.trim(),
      paye_auto_calculate: document.getElementById('paye-auto').checked
    }));
    document.getElementById('paye-export').addEventListener('click', () => this.exportPayrollReport('paye'));
    document.getElementById('paye-annual').addEventListener('click', () => {
      const now = new Date();
      const startYear = now.getMonth() >= 2 ? now.getFullYear() : now.getFullYear() - 1;
      const endYear = startYear + 1;
      const lastFeb = new Date(endYear, 2, 0).getDate();
      this.exportPayrollReport('paye', `${startYear}-03-01`, `${endYear}-02-${String(lastFeb).padStart(2, '0')}`);
    });
  };

  AdminPage.renderPayrollSdl = function (el) {
    const s = this.payrollSettings;
    el.innerHTML = `<div class="card"><div class="card-body"><div class="form-grid">
      <div class="field full"><label><input type="checkbox" id="sdl-en" ${s.sdl_enabled ? 'checked' : ''}> Enable SDL <span class="muted">(off until you allow it)</span></label></div>
      <div class="field"><label>SDL Registration Number</label><input id="sdl-reg" value="${s.sdl_registration_number || ''}"></div>
      <div class="field"><label>SDL Rate (%)</label><input type="number" id="sdl-rate" step="0.01" value="${s.sdl_rate ?? 1}"></div>
      <div class="field full"><label><input type="checkbox" id="sdl-auto" ${s.sdl_auto_calculate !== false ? 'checked' : ''}> Auto Calculate SDL</label></div>
    </div><button class="btn btn-primary" id="sdl-save" style="margin-top:16px">Save SDL Settings</button>
    <button class="btn btn-ghost" id="sdl-export" style="margin-left:8px">Monthly SDL Report (PDF)</button></div></div>`;
    document.getElementById('sdl-save').addEventListener('click', () => this.savePayrollSettingsPartial({
      sdl_enabled: document.getElementById('sdl-en').checked,
      sdl_registration_number: document.getElementById('sdl-reg').value.trim(),
      sdl_rate: parseFloat(document.getElementById('sdl-rate').value) || 1,
      sdl_auto_calculate: document.getElementById('sdl-auto').checked
    }));
    document.getElementById('sdl-export').addEventListener('click', () => this.exportPayrollReport('sdl'));
  };

  AdminPage.renderPayrollCoida = function (el) {
    const s = this.payrollSettings;
    el.innerHTML = `<div class="card"><div class="card-body"><div class="form-grid">
      <div class="field full"><label><input type="checkbox" id="coida-en" ${s.coida_enabled ? 'checked' : ''}> Enable COIDA</label></div>
      <div class="field"><label>COIDA Registration Number</label><input id="coida-reg" value="${s.coida_registration_number || ''}"></div>
      <div class="field"><label>Employer Reference Number</label><input id="coida-ref" value="${s.coida_employer_ref || ''}"></div>
      <div class="field"><label>COIDA Rate (%)</label><input type="number" id="coida-rate" step="0.01" value="${s.coida_rate || 0}"></div>
      <div class="field full"><label><input type="checkbox" id="coida-auto" ${s.coida_auto_calculate ? 'checked' : ''}> Auto Calculate COIDA</label></div>
    </div><button class="btn btn-primary" id="coida-save" style="margin-top:16px">Save COIDA Settings</button>
    <button class="btn btn-ghost" id="coida-export" style="margin-left:8px">COIDA Report (PDF)</button></div></div>`;
    document.getElementById('coida-save').addEventListener('click', () => this.savePayrollSettingsPartial({
      coida_enabled: document.getElementById('coida-en').checked,
      coida_registration_number: document.getElementById('coida-reg').value.trim(),
      coida_employer_ref: document.getElementById('coida-ref').value.trim(),
      coida_rate: parseFloat(document.getElementById('coida-rate').value) || 0,
      coida_auto_calculate: document.getElementById('coida-auto').checked
    }));
    document.getElementById('coida-export').addEventListener('click', () => this.exportPayrollReport('coida'));
  };

  AdminPage.renderPayrollSetup = function (el) {
    const s = this.payrollSettings;
    const currency = this.settings.currency || 'R';
    const freq = s.pay_frequency || 'monthly';
    const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const isWeeklyLike = freq === 'weekly' || freq === 'fortnightly';
    const paydayField = isWeeklyLike
      ? `<div class="field" id="ps-payday-wrap"><label>Payday (day of week)</label>
          <select id="ps-weekday">${weekdays.map((d, i) =>
            `<option value="${i}" ${Number(s.payday_weekday ?? 5) === i ? 'selected' : ''}>${d}</option>`).join('')}</select>
          <small class="muted">Admin gets a notification on this day each ${freq === 'fortnightly' ? 'second ' : ''}week</small></div>`
      : `<div class="field" id="ps-payday-wrap"><label>Payday (day of month)</label>
          <input type="number" id="ps-day" min="1" max="28" value="${s.payday ?? 25}">
          <small class="muted">Admin gets a notification on this day each month (1–28)</small></div>`;

    el.innerHTML = `<div class="card"><div class="card-body"><div class="form-grid">
      <div class="field"><label>Pay Frequency</label>
        <select id="ps-freq">${['weekly', 'fortnightly', 'monthly'].map(f =>
          `<option value="${f}" ${freq === f ? 'selected' : ''}>${f.charAt(0).toUpperCase() + f.slice(1)}</option>`).join('')}</select></div>
      ${paydayField}
      <div class="field"><label>Overtime Multiplier</label><input type="number" id="ps-ot" step="0.1" value="${s.overtime_multiplier ?? 1.5}"></div>
      <div class="field"><label>Public Holiday Multiplier</label><input type="number" id="ps-ph" step="0.1" value="${s.public_holiday_multiplier ?? 2}"></div>
      <div class="field"><label>Sunday Pay Multiplier</label><input type="number" id="ps-sun" step="0.1" value="${s.sunday_multiplier ?? 2}"></div>
      <div class="field"><label>Night Shift Multiplier</label><input type="number" id="ps-night" step="0.1" value="${s.night_shift_multiplier ?? 1.5}"></div>
      <div class="field full"><label><input type="checkbox" id="ps-pension" ${s.pension_enabled ? 'checked' : ''}> Enable Pension Deductions</label></div>
      <div class="field full"><label><input type="checkbox" id="ps-medical" ${s.medical_aid_enabled ? 'checked' : ''}> Enable Medical Aid Deductions</label></div>
    </div><button class="btn btn-primary" id="ps-save" style="margin-top:16px">Save Payroll Setup</button></div></div>
    <p class="muted" style="margin-top:12px">Set pension and medical aid amounts per employee in Staff & HR → Employees → Edit → Salary tab.</p>`;

    document.getElementById('ps-freq').addEventListener('change', () => this.renderPayrollSetup(el));

    document.getElementById('ps-save').addEventListener('click', () => {
      const payFreq = document.getElementById('ps-freq').value;
      const weeklyLike = payFreq === 'weekly' || payFreq === 'fortnightly';
      const payload = {
        pay_frequency: payFreq,
        overtime_multiplier: parseFloat(document.getElementById('ps-ot').value) || 1.5,
        public_holiday_multiplier: parseFloat(document.getElementById('ps-ph').value) || 2,
        sunday_multiplier: parseFloat(document.getElementById('ps-sun').value) || 2,
        night_shift_multiplier: parseFloat(document.getElementById('ps-night').value) || 1.5,
        pension_enabled: document.getElementById('ps-pension').checked,
        medical_aid_enabled: document.getElementById('ps-medical').checked
      };
      if (weeklyLike) {
        payload.payday_weekday = parseInt(document.getElementById('ps-weekday').value, 10);
      } else {
        payload.payday = parseInt(document.getElementById('ps-day').value, 10) || 25;
      }
      this.savePayrollSettingsPartial(payload);
    });
  };

  AdminPage.renderPayrollAdvances = async function (el) {
    const currency = this.settings.currency || 'R';
    const empsRes = await API.getEmployees({ status: 'Active' });
    const emps = empsRes.data || [];
    const res = await API.getSalaryAdvances({});
    const rows = res.data || [];
    el.innerHTML = `<div style="display:flex;gap:8px;margin-bottom:12px"><button class="btn btn-primary" id="adv-add">+ Give Salary Advance</button>
      <button class="btn btn-ghost" id="adv-export">Export Report (PDF)</button></div>
      <div class="table-wrap"><table><thead><tr><th>Date</th><th>Employee</th><th>Amount</th><th>Balance</th><th>Recovery/Period</th><th>Reason</th><th>Approved By</th><th>Status</th></tr></thead>
      <tbody>${rows.map(a => `<tr><td>${a.advance_date}</td><td>${a.full_name}</td>
        <td>${Utils.formatMoney(a.amount, currency)}</td><td>${Utils.formatMoney(a.balance, currency)}</td>
        <td>${Utils.formatMoney(a.recovery_per_period, currency)}</td><td>${a.reason || '—'}</td>
        <td>${a.approved_by_name || '—'}</td><td>${a.status}</td></tr>`).join('') || '<tr><td colspan="8" class="muted">No advances recorded</td></tr>'}
      </tbody></table></div>`;
    document.getElementById('adv-add').addEventListener('click', () => {
      Utils.showModal('Give Salary Advance', `<div class="form-grid">
        <div class="field"><label>Employee *</label><select id="adv-emp">${emps.map(e => `<option value="${e.id}">${e.full_name} (${e.employee_code})</option>`).join('')}</select></div>
        <div class="field"><label>Advance Date</label><input type="date" id="adv-date" value="${Utils.today()}"></div>
        <div class="field"><label>Amount (${currency}) *</label><input type="number" id="adv-amt" step="0.01" min="0"></div>
        <div class="field"><label>Recovery Per Period</label><input type="number" id="adv-rec" step="0.01" placeholder="Leave blank = full amount"></div>
        <div class="field full"><label>Reason</label><input id="adv-reason"></div>
        <div class="field full"><label><input type="checkbox" id="adv-auto" checked> Automatic deduction from salary</label></div>
      </div>`, '<button class="btn btn-primary" id="adv-save">Save Advance</button>');
      document.getElementById('adv-save').addEventListener('click', async () => {
        const amt = parseFloat(document.getElementById('adv-amt').value);
        if (!amt) return Utils.toast('Amount required', 'error');
        const r = await API.issueSalaryAdvance({
          employee_id: parseInt(document.getElementById('adv-emp').value),
          advance_date: document.getElementById('adv-date').value,
          amount: amt,
          recovery_per_period: parseFloat(document.getElementById('adv-rec').value) || amt,
          reason: document.getElementById('adv-reason').value.trim(),
          auto_deduct: document.getElementById('adv-auto').checked
        }, this.app.user);
        if (!r.success) return Utils.toast(r.error, 'error');
        Utils.hideModal();
        Utils.toast('Advance recorded', 'success');
        this.renderPayrollAdvances(el);
      });
    });
    document.getElementById('adv-export').addEventListener('click', () => this.exportPayrollReport('outstanding'));
  };

  AdminPage.renderPayrollLoans = async function (el) {
    const currency = this.settings.currency || 'R';
    const empsRes = await API.getEmployees({ status: 'Active' });
    const emps = empsRes.data || [];
    const res = await API.getEmployeeLoans({});
    const rows = res.data || [];
    el.innerHTML = `<div style="display:flex;gap:8px;margin-bottom:12px"><button class="btn btn-primary" id="loan-add">+ Create Employee Loan</button></div>
      <div class="table-wrap"><table><thead><tr><th>Date</th><th>Employee</th><th>Loan Amount</th><th>Interest %</th><th>Monthly Deduction</th><th>Installments</th><th>Balance</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows.map(l => `<tr><td>${l.loan_date}</td><td>${l.full_name}</td>
        <td>${Utils.formatMoney(l.loan_amount, currency)}</td><td>${l.interest_rate || 0}%</td>
        <td>${Utils.formatMoney(l.monthly_deduction, currency)}</td><td>${l.installments || '—'}</td>
        <td>${Utils.formatMoney(l.balance, currency)}</td><td>${l.status}</td>
        <td>${l.status === 'active' && l.balance > 0 ? `<button class="btn btn-sm btn-ghost loan-settle" data-id="${l.id}">Early Settlement</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="9" class="muted">No loans</td></tr>'}
      </tbody></table></div>`;
    document.getElementById('loan-add').addEventListener('click', () => {
      Utils.showModal('Create Employee Loan', `<div class="form-grid">
        <div class="field"><label>Employee *</label><select id="loan-emp">${emps.map(e => `<option value="${e.id}">${e.full_name}</option>`).join('')}</select></div>
        <div class="field"><label>Loan Date</label><input type="date" id="loan-date" value="${Utils.today()}"></div>
        <div class="field"><label>Loan Amount *</label><input type="number" id="loan-amt" step="0.01"></div>
        <div class="field"><label>Interest Rate (%)</label><input type="number" id="loan-int" step="0.01" value="0"></div>
        <div class="field"><label>Monthly Deduction *</label><input type="number" id="loan-ded" step="0.01"></div>
        <div class="field"><label>Number of Installments</label><input type="number" id="loan-inst" min="1"></div>
        <div class="field full"><label>Notes</label><input id="loan-notes"></div>
      </div>`, '<button class="btn btn-primary" id="loan-save">Create Loan</button>');
      document.getElementById('loan-save').addEventListener('click', async () => {
        const amt = parseFloat(document.getElementById('loan-amt').value);
        const ded = parseFloat(document.getElementById('loan-ded').value);
        if (!amt || !ded) return Utils.toast('Amount and monthly deduction required', 'error');
        const r = await API.saveEmployeeLoan({
          employee_id: parseInt(document.getElementById('loan-emp').value),
          loan_date: document.getElementById('loan-date').value,
          loan_amount: amt, interest_rate: parseFloat(document.getElementById('loan-int').value) || 0,
          monthly_deduction: ded, installments: parseInt(document.getElementById('loan-inst').value) || Math.ceil(amt / ded),
          notes: document.getElementById('loan-notes').value.trim()
        }, this.app.user);
        if (!r.success) return Utils.toast(r.error, 'error');
        Utils.hideModal();
        Utils.toast('Loan created', 'success');
        this.renderPayrollLoans(el);
      });
    });
    el.querySelectorAll('.loan-settle').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Mark loan as fully settled?')) return;
      await API.settleEmployeeLoan(parseInt(b.dataset.id), this.app.user);
      Utils.toast('Loan settled', 'success');
      this.renderPayrollLoans(el);
    }));
  };

  AdminPage.renderPayrollDamage = async function (el) {
    const currency = this.settings.currency || 'R';
    const empsRes = await API.getEmployees({ status: 'Active' });
    const emps = empsRes.data || [];
    const res = await API.getDamageCosts({});
    const rows = res.data || [];
    el.innerHTML = `<div style="display:flex;gap:8px;margin-bottom:12px"><button class="btn btn-primary" id="dmg-add">+ Record Damage / Loss</button></div>
      <div class="table-wrap"><table><thead><tr><th>Date</th><th>Employee</th><th>Product</th><th>Qty</th><th>Value</th><th>Balance</th><th>Reason</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows.map(d => `<tr><td>${d.incident_date}</td><td>${d.full_name}</td><td>${d.product_name || '—'}</td>
        <td>${d.quantity}</td><td>${Utils.formatMoney(d.damage_value, currency)}</td>
        <td>${Utils.formatMoney(d.balance, currency)}</td><td>${d.reason || '—'}</td><td>${d.status}</td>
        <td>${d.status === 'pending' ? `<button class="btn btn-sm btn-success dmg-appr" data-id="${d.id}">Approve</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="9" class="muted">No damage records</td></tr>'}
      </tbody></table></div>`;
    document.getElementById('dmg-add').addEventListener('click', () => {
      Utils.showModal('Record Damage / Loss Cost', `<div class="form-grid">
        <div class="field"><label>Employee Responsible *</label><select id="dmg-emp">${emps.map(e => `<option value="${e.id}">${e.full_name}</option>`).join('')}</select></div>
        <div class="field"><label>Date</label><input type="date" id="dmg-date" value="${Utils.today()}"></div>
        <div class="field"><label>Product Name</label><input id="dmg-prod"></div>
        <div class="field"><label>Quantity</label><input type="number" id="dmg-qty" value="1" min="1"></div>
        <div class="field"><label>Damage Value *</label><input type="number" id="dmg-val" step="0.01"></div>
        <div class="field"><label>Deduction Method</label><select id="dmg-method"><option value="installments">Installments</option><option value="full">Full (next payroll)</option></select></div>
        <div class="field"><label>Recovery Per Period</label><input type="number" id="dmg-rec" step="0.01" placeholder="For installments"></div>
        <div class="field full"><label>Reason</label><input id="dmg-reason"></div>
      </div>`, '<button class="btn btn-primary" id="dmg-save">Save Record</button>');
      document.getElementById('dmg-save').addEventListener('click', async () => {
        const val = parseFloat(document.getElementById('dmg-val').value);
        if (!val) return Utils.toast('Damage value required', 'error');
        const method = document.getElementById('dmg-method').value;
        const r = await API.saveDamageCost({
          employee_id: parseInt(document.getElementById('dmg-emp').value),
          incident_date: document.getElementById('dmg-date').value,
          product_name: document.getElementById('dmg-prod').value.trim(),
          quantity: parseFloat(document.getElementById('dmg-qty').value) || 1,
          damage_value: val, deduction_method: method,
          recovery_per_period: parseFloat(document.getElementById('dmg-rec').value) || (method === 'full' ? val : val),
          reason: document.getElementById('dmg-reason').value.trim()
        }, this.app.user);
        if (!r.success) return Utils.toast(r.error, 'error');
        Utils.hideModal();
        Utils.toast('Damage cost recorded — approve to deduct from payroll', 'success');
        this.renderPayrollDamage(el);
      });
    });
    el.querySelectorAll('.dmg-appr').forEach(b => b.addEventListener('click', async () => {
      await API.approveDamageCost(parseInt(b.dataset.id), this.app.user);
      Utils.toast('Approved for payroll deduction', 'success');
      this.renderPayrollDamage(el);
    }));
  };

  AdminPage.renderPayrollRun = async function (el) {
    const currency = this.settings.currency || 'R';
    const shop = this.settings.shop_name || 'Shop POS';
    const self = this;
    el.innerHTML = `<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:end">
      <div class="field" style="margin:0"><label>From</label><input type="date" id="pr-start" value="${Utils.daysAgo(30)}"></div>
      <div class="field" style="margin:0"><label>To</label><input type="date" id="pr-end" value="${Utils.today()}"></div>
      <button class="btn btn-primary" id="pr-gen">Generate Payroll</button></div>
      <p class="muted" style="margin-bottom:12px">Generates payroll with UIF, PAYE, SDL, advances, loans, damage, attendance and late cash-out penalties. Salary advice: WhatsApp, email (mailto), PDF, or print.</p>
      <div id="pr-list"><p class="muted">Click Generate Payroll to run for all active employees in the selected period.</p></div>`;

    const bindPayrollRows = (list, emps) => {
      const nameMap = Object.fromEntries(emps.map(e => [e.id, e.full_name]));
      const empMap = Object.fromEntries(emps.map(e => [e.id, e]));
      document.getElementById('pr-list').innerHTML = list.length
        ? `<div class="table-wrap"><table><thead><tr>
        <th>Employee</th><th>Period</th><th>Gross</th><th>PAYE</th><th>UIF</th><th>Adv/Loan/Dmg</th><th>Net</th><th>Status</th><th>Salary advice</th></tr></thead>
        <tbody>${list.map(p => `<tr><td>${nameMap[p.employee_id] || p.employee_id}</td><td>${p.period_start}–${p.period_end}</td>
          <td>${Utils.formatMoney(p.gross_salary, currency)}</td><td>${Utils.formatMoney(p.paye, currency)}</td>
          <td>${Utils.formatMoney(p.uif_employee, currency)}</td>
          <td>${Utils.formatMoney((Number(p.advance_recovery)||0)+(Number(p.loan_recovery)||0)+(Number(p.damage_recovery)||0), currency)}</td>
          <td><strong>${Utils.formatMoney(p.net_salary, currency)}</strong></td><td>${p.status}</td><td style="white-space:nowrap">
          ${p.status === 'pending' ? `<button class="btn btn-sm btn-success pr-pay" data-id="${p.id}">Mark Paid</button> ` : ''}
          <button class="btn btn-sm btn-ghost pr-pdf" data-id="${p.id}">PDF</button>
          <button class="btn btn-sm btn-ghost pr-print" data-id="${p.id}">Print</button>
          <button class="btn btn-sm btn-ghost pr-wa" data-id="${p.id}" data-eid="${p.employee_id}">WhatsApp</button>
          <button class="btn btn-sm btn-ghost pr-email" data-id="${p.id}" data-eid="${p.employee_id}">Email</button>
          </td></tr>`).join('')}</tbody></table></div>`
        : '<p class="muted">No payroll rows for this period yet.</p>';

      const adviceText = (p, emp) => {
        const name = emp?.full_name || nameMap[p.employee_id] || 'Staff';
        return `${shop} — Salary Advice\nEmployee: ${name}\nPeriod: ${p.period_start} to ${p.period_end}\nGross: ${Utils.formatMoney(p.gross_salary, currency)}\nPAYE: ${Utils.formatMoney(p.paye, currency)}\nUIF: ${Utils.formatMoney(p.uif_employee, currency)}\nNet pay: ${Utils.formatMoney(p.net_salary, currency)}\nStatus: ${p.status}`;
      };

      document.querySelectorAll('.pr-pay').forEach(b => b.addEventListener('click', async () => {
        const r = await API.payStaffSalary(parseInt(b.dataset.id, 10), 'cash', self.app.user);
        if (!r.success) return Utils.toast(r.error || 'Pay failed', 'error');
        Utils.toast('Marked paid — recoveries applied', 'success');
        document.getElementById('pr-gen')?.click();
      }));
      document.querySelectorAll('.pr-pdf').forEach(b => b.addEventListener('click', async () => {
        await Utils.savePdfBuffer(`salary-advice-${b.dataset.id}.pdf`, await API.getStaffPayslipPdf(parseInt(b.dataset.id, 10)));
      }));
      document.querySelectorAll('.pr-print').forEach(b => b.addEventListener('click', async () => {
        const p = list.find(x => x.id == b.dataset.id);
        const emp = empMap[p?.employee_id];
        if (!p) return;
        Export.print(`Salary Advice — ${nameMap[p.employee_id] || p.employee_id}`,
          ['Field', 'Value'],
          [
            ['Employee', nameMap[p.employee_id] || String(p.employee_id)],
            ['Period', `${p.period_start} – ${p.period_end}`],
            ['Gross', Utils.formatMoney(p.gross_salary, currency)],
            ['PAYE', Utils.formatMoney(p.paye, currency)],
            ['UIF', Utils.formatMoney(p.uif_employee, currency)],
            ['Net', Utils.formatMoney(p.net_salary, currency)],
            ['Status', p.status]
          ],
          Utils.companyInfo(self.settings));
      }));
      document.querySelectorAll('.pr-wa').forEach(b => b.addEventListener('click', async () => {
        const p = list.find(x => x.id == b.dataset.id);
        const emp = empMap[p?.employee_id] || (await API.getEmployee(parseInt(b.dataset.eid, 10))).data;
        if (!p) return;
        const phone = emp?.phone || emp?.whatsapp || '';
        if (!phone) return Utils.toast('No phone on employee profile', 'error');
        const msg = adviceText(p, emp);
        await Utils.deliverWhatsApp(await API.sendWhatsAppMessage({
          phone, recipient_name: emp?.full_name || 'Staff', message_type: 'salary_advice', body: msg
        }, self.app.user), phone, msg);
      }));
      document.querySelectorAll('.pr-email').forEach(b => b.addEventListener('click', async () => {
        const p = list.find(x => x.id == b.dataset.id);
        const emp = empMap[p?.employee_id] || (await API.getEmployee(parseInt(b.dataset.eid, 10))).data;
        if (!p) return;
        const email = (emp?.email || '').trim();
        if (!email) return Utils.toast('No email on employee profile — use WhatsApp, PDF, or print', 'error');
        const subject = encodeURIComponent(`${shop} Salary Advice ${p.period_start}–${p.period_end}`);
        const body = encodeURIComponent(adviceText(p, emp));
        window.open(`mailto:${email}?subject=${subject}&body=${body}`, '_blank');
      }));
    };

    document.getElementById('pr-gen').addEventListener('click', async () => {
      const btn = document.getElementById('pr-gen');
      const start = document.getElementById('pr-start').value;
      const end = document.getElementById('pr-end').value;
      if (!start || !end) return Utils.toast('Select start and end dates', 'error');
      btn.disabled = true;
      btn.textContent = 'Generating…';
      try {
        const r = await API.generateStaffPayroll(start, end, null, self.app.user);
        if (!r.success) {
          Utils.toast(r.error || 'Generate payroll failed', 'error');
          return;
        }
        const list = Array.isArray(r.data) ? r.data : [];
        const empsRes = await API.getEmployees({});
        const emps = empsRes.data || [];
        bindPayrollRows(list, emps);
        Utils.toast(list.length ? `Payroll ready — ${list.length} employee(s)` : 'No payroll rows generated', 'success');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Generate Payroll';
      }
    });
  };

  AdminPage.renderSalaryClaims = async function (el) {
    const currency = this.settings.currency || 'R';
    const shop = this.settings.shop_name || 'Shop POS';
    const self = this;
    const [claimsRes, empsRes] = await Promise.all([
      API.listSalaryClaims({ limit: 300 }, this.app.user),
      API.getEmployees({ status: 'Active' })
    ]);
    const claims = claimsRes.data || [];
    const emps = empsRes.data || [];
    el.innerHTML = `<div class="card" style="margin-bottom:16px"><div class="card-body">
      <h4>Open salary claim window</h4>
      <p class="muted">Generate payroll first, then open claims. Employees must claim in Staff Portal <strong>before</strong> the deadline. Approve uses your uploaded admin signature.</p>
      <div class="form-grid">
        <div class="field"><label>Period from</label><input type="date" id="sc-from" value="${Utils.daysAgo(30)}"></div>
        <div class="field"><label>Period to</label><input type="date" id="sc-to" value="${Utils.today()}"></div>
        <div class="field"><label>Payment date</label><input type="date" id="sc-paydate"></div>
        <div class="field"><label>Claim opens (optional)</label><input type="datetime-local" id="sc-opens"></div>
        <div class="field"><label>Claim deadline *</label><input type="datetime-local" id="sc-deadline" required></div>
      </div>
      <button class="btn btn-primary" id="sc-open-window" style="margin-top:12px">Create claims from payroll</button>
      <button class="btn btn-ghost" id="sc-add-one" style="margin-top:12px;margin-left:8px">+ Single claim</button>
    </div></div>
    <div class="table-wrap"><table><thead><tr>
      <th>Employee</th><th>Period</th><th>Net</th><th>Deadline</th><th>Status</th><th>Record</th><th></th>
    </tr></thead><tbody>
      ${claims.map(c => `<tr>
        <td><strong>${Utils.escHtml(c.employee_name || '')}</strong><br><small>${c.employee_code || ''}</small></td>
        <td>${c.period_start} – ${c.period_end}${c.payment_date ? `<br><small class="muted">Pay: ${c.payment_date}</small>` : ''}</td>
        <td>${Utils.formatMoney(c.amount || c.net_amount, currency)}</td>
        <td>${Utils.formatDateTime(c.claim_deadline)}</td>
        <td><span class="tag">${c.status}</span>
          ${c.claimed_at ? `<br><small>Claimed ${Utils.formatDateTime(c.claimed_at)}</small>` : ''}
          ${c.approved_at ? `<br><small>Approved ${Utils.formatDateTime(c.approved_at)}</small>` : ''}
        </td>
        <td><small>#${c.id}</small></td>
        <td style="white-space:nowrap">
          ${['claimed','open'].includes(c.status) ? `<button class="btn btn-sm btn-success sc-approve" data-id="${c.id}">Approve</button>
            <button class="btn btn-sm btn-warning sc-reject" data-id="${c.id}">Reject</button>` : ''}
          ${c.status === 'approved' ? `<button class="btn btn-sm btn-success sc-paid" data-id="${c.id}">Mark Paid</button>` : ''}
          <button class="btn btn-sm btn-ghost sc-edit" data-id="${c.id}">Edit</button>
          ${c.status !== 'paid' ? `<button class="btn btn-sm btn-danger sc-del" data-id="${c.id}">Delete</button>` : ''}
          <button class="btn btn-sm btn-ghost sc-pdf" data-id="${c.id}">PDF</button>
          <button class="btn btn-sm btn-ghost sc-print" data-id="${c.id}">Print</button>
          <button class="btn btn-sm btn-ghost sc-wa" data-id="${c.id}">WhatsApp</button>
        </td>
      </tr>`).join('') || '<tr><td colspan="7" class="muted">No salary claims yet</td></tr>'}
    </tbody></table></div>`;

    const toIsoLocal = (v) => {
      if (!v) return null;
      try { return new Date(v).toISOString(); } catch { return v; }
    };

    document.getElementById('sc-open-window')?.addEventListener('click', async () => {
      const from = document.getElementById('sc-from').value;
      const to = document.getElementById('sc-to').value;
      const deadline = document.getElementById('sc-deadline').value;
      if (!from || !to || !deadline) return Utils.toast('Period and claim deadline required', 'error');
      const r = await API.createSalaryClaimsFromPayroll(
        from, to, toIsoLocal(deadline),
        document.getElementById('sc-paydate').value || null,
        toIsoLocal(document.getElementById('sc-opens').value),
        self.app.user
      );
      if (!r.success) return Utils.toast(r.error || 'Failed', 'error');
      const n = Array.isArray(r.data) ? r.data.length : 0;
      Utils.toast(n ? `Opened ${n} salary claim(s)` : 'No new claims (already open or no payroll)', 'success');
      self.renderSalaryClaims(el);
    });

    document.getElementById('sc-add-one')?.addEventListener('click', () => {
      Utils.showModal('New salary claim', `
        <div class="form-grid">
          <div class="field"><label>Employee</label><select id="sc1-emp">${emps.map(e => `<option value="${e.id}">${e.full_name}</option>`).join('')}</select></div>
          <div class="field"><label>Period from</label><input type="date" id="sc1-from" value="${Utils.daysAgo(30)}"></div>
          <div class="field"><label>Period to</label><input type="date" id="sc1-to" value="${Utils.today()}"></div>
          <div class="field"><label>Net amount</label><input type="number" step="0.01" id="sc1-amt" value="0"></div>
          <div class="field"><label>Payment date</label><input type="date" id="sc1-pay"></div>
          <div class="field"><label>Claim deadline *</label><input type="datetime-local" id="sc1-dead"></div>
          <div class="field full"><label>Admin notes</label><input id="sc1-notes"></div>
        </div>`,
        '<button class="btn btn-primary" id="sc1-save">Save claim</button>');
      document.getElementById('sc1-save')?.addEventListener('click', async () => {
        const dead = document.getElementById('sc1-dead').value;
        if (!dead) return Utils.toast('Deadline required', 'error');
        const amt = parseFloat(document.getElementById('sc1-amt').value) || 0;
        const r = await API.saveSalaryClaim({
          employee_id: parseInt(document.getElementById('sc1-emp').value, 10),
          period_start: document.getElementById('sc1-from').value,
          period_end: document.getElementById('sc1-to').value,
          payment_date: document.getElementById('sc1-pay').value || null,
          claim_deadline: toIsoLocal(dead),
          net_amount: amt, amount: amt, gross_amount: amt,
          admin_notes: document.getElementById('sc1-notes').value.trim() || null,
          status: 'open'
        }, self.app.user);
        if (!r.success) return Utils.toast(r.error || 'Save failed', 'error');
        Utils.hideModal();
        Utils.toast('Claim created', 'success');
        self.renderSalaryClaims(el);
      });
    });

    el.querySelectorAll('.sc-approve').forEach(b => b.addEventListener('click', async () => {
      const notes = prompt('Approval notes (optional)') || '';
      const r = await API.approveSalaryClaim(parseInt(b.dataset.id, 10), notes, self.app.user);
      if (!r.success) return Utils.toast(r.error || 'Approve failed — upload admin signature in Operations', 'error');
      Utils.toast('Claim approved (signature stamped)', 'success');
      self.renderSalaryClaims(el);
    }));
    el.querySelectorAll('.sc-reject').forEach(b => b.addEventListener('click', async () => {
      const notes = prompt('Rejection reason') || '';
      const r = await API.rejectSalaryClaim(parseInt(b.dataset.id, 10), notes, self.app.user);
      if (!r.success) return Utils.toast(r.error || 'Reject failed', 'error');
      Utils.toast('Claim rejected', 'success');
      self.renderSalaryClaims(el);
    }));
    el.querySelectorAll('.sc-paid').forEach(b => b.addEventListener('click', async () => {
      const r = await API.markSalaryClaimPaid(parseInt(b.dataset.id, 10), self.app.user);
      if (!r.success) return Utils.toast(r.error || 'Failed', 'error');
      Utils.toast('Marked paid', 'success');
      self.renderSalaryClaims(el);
    }));
    el.querySelectorAll('.sc-del').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Delete this claim record? Paid claims cannot be deleted.')) return;
      const r = await API.deleteSalaryClaim(parseInt(b.dataset.id, 10), self.app.user);
      if (!r.success) return Utils.toast(r.error || 'Delete failed', 'error');
      Utils.toast('Claim deleted', 'success');
      self.renderSalaryClaims(el);
    }));
    el.querySelectorAll('.sc-edit').forEach(b => b.addEventListener('click', () => {
      const c = claims.find(x => x.id == b.dataset.id);
      if (!c) return;
      Utils.showModal('Edit salary claim', `
        <div class="form-grid">
          <div class="field"><label>Net amount</label><input type="number" step="0.01" id="sce-amt" value="${Number(c.amount || c.net_amount) || 0}"></div>
          <div class="field"><label>Claim deadline</label><input type="datetime-local" id="sce-dead"></div>
          <div class="field"><label>Payment date</label><input type="date" id="sce-pay" value="${c.payment_date || ''}"></div>
          <div class="field full"><label>Admin notes</label><input id="sce-notes" value="${Utils.escHtml(c.admin_notes || '')}"></div>
        </div>`,
        '<button class="btn btn-primary" id="sce-save">Save</button>');
      if (c.claim_deadline) {
        try {
          const x = new Date(c.claim_deadline);
          x.setMinutes(x.getMinutes() - x.getTimezoneOffset());
          document.getElementById('sce-dead').value = x.toISOString().slice(0, 16);
        } catch (_) { /* ignore */ }
      }
      document.getElementById('sce-save')?.addEventListener('click', async () => {
        const amt = parseFloat(document.getElementById('sce-amt').value) || 0;
        const dead = document.getElementById('sce-dead').value;
        const r = await API.saveSalaryClaim({
          id: c.id,
          employee_id: c.employee_id,
          period_start: c.period_start,
          period_end: c.period_end,
          payroll_id: c.payroll_id,
          payment_date: document.getElementById('sce-pay').value || null,
          claim_deadline: dead ? toIsoLocal(dead) : c.claim_deadline,
          claim_opens_at: c.claim_opens_at,
          net_amount: amt, amount: amt, gross_amount: c.gross_amount || amt,
          admin_notes: document.getElementById('sce-notes').value.trim() || null,
          status: c.status
        }, self.app.user);
        if (!r.success) return Utils.toast(r.error || 'Save failed', 'error');
        Utils.hideModal();
        Utils.toast('Claim updated', 'success');
        self.renderSalaryClaims(el);
      });
    }));
    el.querySelectorAll('.sc-pdf').forEach(b => b.addEventListener('click', async () => {
      await Utils.savePdfBuffer(`salary-claim-${b.dataset.id}.pdf`, await API.getSalaryClaimPdf(parseInt(b.dataset.id, 10), self.app.user));
    }));
    el.querySelectorAll('.sc-print').forEach(b => b.addEventListener('click', async () => {
      await Utils.printToA4(
        await API.getSalaryClaimPdf(parseInt(b.dataset.id, 10), self.app.user),
        `salary-claim-${b.dataset.id}.pdf`
      );
    }));
    el.querySelectorAll('.sc-wa').forEach(b => b.addEventListener('click', async () => {
      const c = claims.find(x => x.id == b.dataset.id);
      if (!c?.phone) return Utils.toast('No phone on employee profile', 'error');
      const msg = `${shop} — Salary Claim\nEmployee: ${c.employee_name}\nPeriod: ${c.period_start} to ${c.period_end}\nAmount: ${Utils.formatMoney(c.amount || c.net_amount, currency)}\nStatus: ${c.status}\nDeadline: ${c.claim_deadline}\n(Full signed PDF available in Staff Portal / Admin)`;
      await Utils.deliverWhatsApp(await API.sendWhatsAppMessage({
        phone: c.phone, recipient_name: c.employee_name, message_type: 'salary_advice', body: msg
      }, self.app.user), c.phone, msg);
    }));
  };

  AdminPage.renderPayrollComplianceTab = async function (el) {
    const res = await API.getComplianceSubmissions();
    const subs = res.data || [];
    const certRes = await API.getComplianceCertificates();
    const certs = certRes.data || [];
    el.innerHTML = `<div class="card" style="margin-bottom:16px"><div class="card-header"><h3>Submission Tracking</h3>
      <button class="btn btn-sm btn-primary" id="sub-add">+ Track Submission</button></div><div class="card-body table-wrap">
      <table><thead><tr><th>Type</th><th>Period</th><th>Status</th><th>Submitted</th><th>By</th><th></th></tr></thead>
      <tbody>${subs.map(s => `<tr><td>${s.submission_type.toUpperCase()}</td><td>${s.period_month}</td><td>${s.status}</td>
        <td>${s.submitted_at ? Utils.formatDateTime(s.submitted_at) : '—'}</td><td>${s.submitted_by || '—'}</td>
        <td>${s.status !== 'submitted' ? `<button class="btn btn-sm btn-success sub-mark" data-id="${s.id}">Mark Submitted</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No submissions tracked</td></tr>'}
      </tbody></table></div></div>
      <div class="card"><div class="card-header"><h3>Registration Certificates</h3>
      <button class="btn btn-sm btn-primary" id="cert-add">+ Add Certificate</button></div><div class="card-body">
      ${certs.length ? certs.map(c => `<div style="padding:8px 0;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;gap:8px">
        <div><strong>${c.cert_type}</strong>
        ${c.file_name ? ` — ${c.file_name}` : ''} ${c.expiry_date ? `(expires ${c.expiry_date})` : ''}
        ${c.notes ? `<br><small class="muted">${c.notes}</small>` : ''}</div>
        <button class="btn btn-sm btn-danger cert-del" data-id="${c.id}">Delete</button></div>`).join('') : '<p class="muted">No certificates stored</p>'}
      </div></div>`;
    document.getElementById('sub-add').addEventListener('click', () => {
      Utils.showModal('Track Compliance Submission', `<div class="form-grid">
        <div class="field"><label>Type</label><select id="sub-type"><option value="uif">UIF</option><option value="paye">PAYE</option><option value="sdl">SDL</option><option value="coida">COIDA</option></select></div>
        <div class="field"><label>Period (YYYY-MM)</label><input id="sub-period" placeholder="2026-08"></div>
        <div class="field full"><label>Notes</label><input id="sub-notes"></div>
      </div>`, '<button class="btn btn-primary" id="sub-save">Save</button>');
      document.getElementById('sub-save').addEventListener('click', async () => {
        await API.saveComplianceSubmission({
          submission_type: document.getElementById('sub-type').value,
          period_month: document.getElementById('sub-period').value.trim(),
          status: 'pending', notes: document.getElementById('sub-notes').value.trim()
        }, this.app.user);
        Utils.hideModal();
        this.renderPayrollComplianceTab(el);
      });
    });
    el.querySelectorAll('.sub-mark').forEach(b => b.addEventListener('click', async () => {
      await API.saveComplianceSubmission({ id: parseInt(b.dataset.id), status: 'submitted' }, this.app.user);
      Utils.toast('Marked as submitted', 'success');
      this.renderPayrollComplianceTab(el);
    }));
    document.getElementById('cert-add').addEventListener('click', async () => {
      Utils.showModal('Add Registration Certificate', `<div class="form-grid">
        <div class="field"><label>Certificate Type</label><select id="cert-type"><option>UIF Registration</option><option>PAYE Registration</option><option>SDL Registration</option><option>COIDA Registration</option><option>Tax Clearance</option></select></div>
        <div class="field"><label>Expiry Date</label><input type="date" id="cert-exp"></div>
        <div class="field full"><label>Attach File (optional)</label><button type="button" class="btn btn-ghost" id="cert-pick">Choose image/PDF</button><span id="cert-file-label" class="muted" style="margin-left:8px"></span></div>
        <div class="field full"><label>Notes</label><input id="cert-notes"></div>
      </div>`, '<button class="btn btn-primary" id="cert-save">Save</button>');
      let certFile = null;
      document.getElementById('cert-pick').addEventListener('click', async () => {
        const r = await API.selectImage('cert');
        if (r.success) {
          certFile = { path: r.path, fileName: r.fileName || 'certificate' };
          document.getElementById('cert-file-label').textContent = certFile.fileName;
        }
      });
      document.getElementById('cert-save').addEventListener('click', async () => {
        await API.saveComplianceCertificate({
          cert_type: document.getElementById('cert-type').value,
          expiry_date: document.getElementById('cert-exp').value,
          notes: document.getElementById('cert-notes').value.trim(),
          file_path: certFile?.path || null,
          file_name: certFile?.fileName || null
        });
        Utils.hideModal();
        this.renderPayrollComplianceTab(el);
      });
    });
    el.querySelectorAll('.cert-del').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Delete this certificate record?')) return;
      await API.deleteComplianceCertificate(parseInt(b.dataset.id));
      Utils.toast('Certificate removed', 'success');
      this.renderPayrollComplianceTab(el);
    }));
  };

  AdminPage.renderPayrollReports = function (el) {
    el.innerHTML = `<div class="card"><div class="card-body">
      <p class="muted">Select date range then download report PDF.</p>
      ${Utils.dateFilterHTML('payroll-report-filter', Utils.daysAgo(30), Utils.today())}
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:16px">
        ${[
          ['summary', 'Payroll Summary'], ['uif', 'UIF Report'], ['paye', 'PAYE Report'], ['sdl', 'SDL Report'],
          ['coida', 'COIDA Report'], ['deductions', 'Deduction Report'], ['outstanding', 'Outstanding Balances']
        ].map(([id, label]) => `<button class="btn btn-ghost payroll-rpt" data-type="${id}">${label}</button>`).join('')}
      </div></div></div>`;
    let from = Utils.daysAgo(30), to = Utils.today();
    Utils.bindDateFilter('payroll-report-filter', (f, t) => { from = f; to = t; });
    el.querySelectorAll('.payroll-rpt').forEach(b => b.addEventListener('click', () => this.exportPayrollReport(b.dataset.type, from, to)));
  };

  AdminPage.exportPayrollReport = async function (type, from, to) {
    from = from || Utils.daysAgo(30);
    to = to || Utils.today();
    await Utils.savePdfBuffer(`${type}-report-${from}.pdf`, await API.getPayrollCompliancePdf(type, from, to));
  };
})();

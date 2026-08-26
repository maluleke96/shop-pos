const { getDb } = require('../database/db');
const { jsPDF } = require('jspdf');
require('jspdf-autotable');

function defaultPayrollSettings() {
  return {
    // Off until admin explicitly enables in Payroll settings
    uif_enabled: false,
    uif_registration_number: '',
    uif_employee_rate: 1,
    uif_employer_rate: 1,
    uif_ceiling: 17712,
    uif_auto_calculate: true,
    uif_on_payslip: true,
    paye_enabled: false,
    paye_registration_number: '',
    tax_number: '',
    paye_auto_calculate: true,
    sdl_enabled: false,
    sdl_registration_number: '',
    sdl_rate: 1,
    sdl_auto_calculate: true,
    coida_enabled: false,
    coida_registration_number: '',
    coida_employer_ref: '',
    coida_rate: 0,
    coida_auto_calculate: false,
    pay_frequency: 'monthly',
    payday: 25,
    payday_weekday: 5,
    overtime_multiplier: 1.5,
    public_holiday_multiplier: 2,
    sunday_multiplier: 2,
    night_shift_multiplier: 1.5,
    pension_enabled: false,
    medical_aid_enabled: false,
    company_paye_number: '',
    company_uif_number: '',
    company_sdl_number: '',
    company_coida_number: '',
    sars_tax_office: '',
    compliance_reminders: true
  };
}

function parseJsonField(val, fallback) {
  if (!val) return fallback;
  if (typeof val === 'object') return val;
  try { return JSON.parse(val); } catch { return fallback; }
}

function getPayrollSettings() {
  const row = getDb().prepare('SELECT payroll_settings FROM shop_settings WHERE id = 1').get();
  return { ...defaultPayrollSettings(), ...parseJsonField(row?.payroll_settings, {}) };
}

function savePayrollSettings(data, actorId, actorName) {
  const merged = { ...getPayrollSettings(), ...data };
  getDb().prepare(`UPDATE shop_settings SET payroll_settings = ?, updated_at = datetime('now') WHERE id = 1`)
    .run(JSON.stringify(merged));
  return merged;
}

function calcAnnualPaye(annualTaxable) {
  const income = Math.max(0, Number(annualTaxable) || 0);
  if (income <= 95750) return 0;
  if (income <= 237100) return (income - 95750) * 0.18;
  if (income <= 370500) return 25443 + (income - 237100) * 0.26;
  if (income <= 512800) return 60127 + (income - 370500) * 0.31;
  if (income <= 673000) return 104240 + (income - 512800) * 0.36;
  if (income <= 857900) return 161911 + (income - 673000) * 0.39;
  if (income <= 1817000) return 233995 + (income - 857900) * 0.41;
  return 627893 + (income - 1817000) * 0.45;
}

function calcMonthlyPaye(monthlyTaxable) {
  return Math.max(0, calcAnnualPaye(Number(monthlyTaxable) * 12) / 12);
}

function calcUif(remuneration, settings) {
  if (!settings.uif_enabled) return { employee: 0, employer: 0 };
  const capped = Math.min(Number(remuneration) || 0, Number(settings.uif_ceiling) || 17712);
  const empRate = (Number(settings.uif_employee_rate) || 1) / 100;
  const erRate = (Number(settings.uif_employer_rate) || 1) / 100;
  return {
    employee: Math.round(capped * empRate * 100) / 100,
    employer: Math.round(capped * erRate * 100) / 100
  };
}

function calcSdl(remuneration, settings) {
  if (!settings.sdl_enabled) return 0;
  const rate = (Number(settings.sdl_rate) || 1) / 100;
  return Math.round((Number(remuneration) || 0) * rate * 100) / 100;
}

function calcCoida(remuneration, settings) {
  if (!settings.coida_enabled) return 0;
  const rate = (Number(settings.coida_rate) || 0) / 100;
  return Math.round((Number(remuneration) || 0) * rate * 100) / 100;
}

function getOutstandingAdvanceRecovery(employeeId) {
  const rows = getDb().prepare(`
    SELECT * FROM employee_advances WHERE employee_id = ? AND status IN ('outstanding','recovering') AND balance > 0
      AND auto_deduct = 1 ORDER BY advance_date`).all(employeeId);
  let total = 0;
  const items = [];
  for (const row of rows) {
    const amt = Math.min(Number(row.balance), Number(row.recovery_per_period) || Number(row.balance));
    if (amt > 0) { total += amt; items.push({ type: 'advance', id: row.id, amount: amt, description: `Salary advance recovery` }); }
  }
  return { total, items };
}

function getOutstandingLoanRecovery(employeeId) {
  const rows = getDb().prepare(`
    SELECT * FROM employee_loans WHERE employee_id = ? AND status = 'active' AND balance > 0 ORDER BY loan_date`).all(employeeId);
  let total = 0;
  const items = [];
  for (const row of rows) {
    const amt = Math.min(Number(row.balance), Number(row.monthly_deduction) || Number(row.balance));
    if (amt > 0) { total += amt; items.push({ type: 'loan', id: row.id, amount: amt, description: `Loan repayment` }); }
  }
  return { total, items };
}

function getOutstandingDamageRecovery(employeeId) {
  const rows = getDb().prepare(`
    SELECT * FROM employee_damage_costs WHERE employee_id = ? AND status IN ('approved','recovering') AND balance > 0
    ORDER BY incident_date`).all(employeeId);
  let total = 0;
  const items = [];
  for (const row of rows) {
    const per = Number(row.recovery_per_period) || Number(row.balance);
    const amt = Math.min(Number(row.balance), per);
    if (amt > 0) { total += amt; items.push({ type: 'damage', id: row.id, amount: amt, description: `Damage cost: ${row.product_name || 'Item'}` }); }
  }
  return { total, items };
}

function calculatePayrollBreakdown(emp, settings) {
  const basic = Number(emp.basic_salary) || 0;
  const overtime = Number(emp.overtime_rate) || 0;
  const bonus = Number(emp.bonus) || 0;
  const commission = Number(emp.commission) || 0;
  const allowances = Number(emp.allowances) || 0;
  const gross = basic + overtime + bonus + commission + allowances;

  const advanceRec = getOutstandingAdvanceRecovery(emp.id);
  const loanRec = getOutstandingLoanRecovery(emp.id);
  const damageRec = getOutstandingDamageRecovery(emp.id);

  const pension = settings.pension_enabled ? (Number(emp.pension_contribution) || 0) : 0;
  const medical = settings.medical_aid_enabled ? (Number(emp.medical_aid_contribution) || 0) : 0;
  const otherManual = Number(emp.deductions) || 0;

  let paye = 0;
  let uifEmployee = 0;
  let uifEmployer = 0;
  let sdl = 0;
  let coida = 0;

  const taxableForPaye = gross - pension - medical;
  // Company must enable + employee must be registered (admin allow) before PAYE/UIF/SDL apply
  const empPaye = !!(emp.paye_registered === 1 || emp.paye_registered === true);
  const empUif = !!(emp.uif_registered === 1 || emp.uif_registered === true);
  const empSdl = !!(emp.sdl_registered === 1 || emp.sdl_registered === true);
  if (settings.paye_enabled && settings.paye_auto_calculate && empPaye) {
    paye = calcMonthlyPaye(taxableForPaye);
  }
  if (settings.uif_enabled && settings.uif_auto_calculate && empUif) {
    const uif = calcUif(gross, settings);
    uifEmployee = uif.employee;
    uifEmployer = uif.employer;
  }
  if (settings.sdl_enabled && settings.sdl_auto_calculate && empSdl) {
    sdl = calcSdl(gross, settings);
  }
  if (settings.coida_enabled && settings.coida_auto_calculate) {
    coida = calcCoida(gross, settings);
  }

  const totalDeductions = paye + uifEmployee + pension + medical + advanceRec.total + loanRec.total + damageRec.total + otherManual;
  const net = Math.max(0, gross - totalDeductions);

  const deductionItems = [
    ...advanceRec.items,
    ...loanRec.items,
    ...damageRec.items
  ];
  if (paye > 0) deductionItems.push({ type: 'paye', id: null, amount: paye, description: 'PAYE' });
  if (uifEmployee > 0) deductionItems.push({ type: 'uif', id: null, amount: uifEmployee, description: 'UIF (Employee)' });
  if (pension > 0) deductionItems.push({ type: 'pension', id: null, amount: pension, description: 'Pension' });
  if (medical > 0) deductionItems.push({ type: 'medical', id: null, amount: medical, description: 'Medical Aid' });
  if (otherManual > 0) deductionItems.push({ type: 'other', id: null, amount: otherManual, description: 'Other deductions' });

  const employerItems = [];
  if (uifEmployer > 0) employerItems.push({ type: 'uif_employer', amount: uifEmployer, description: 'UIF (Employer)' });
  if (sdl > 0) employerItems.push({ type: 'sdl', amount: sdl, description: 'SDL' });
  if (coida > 0) employerItems.push({ type: 'coida', amount: coida, description: 'COIDA' });

  return {
    gross, basic, overtime, bonus, commission, allowances,
    paye, uifEmployee, uifEmployer, sdl, coida,
    advanceRecovery: advanceRec.total, loanRecovery: loanRec.total, damageRecovery: damageRec.total,
    pensionDeduction: pension, medicalDeduction: medical, otherDeductions: otherManual,
    totalDeductions, net,
    deductionItems, employerItems,
    advanceItems: advanceRec.items, loanItems: loanRec.items, damageItems: damageRec.items
  };
}

function applyRecoveries(employeeId, advanceItems, loanItems, damageItems) {
  const db = getDb();
  for (const item of advanceItems) {
    const row = db.prepare('SELECT balance FROM employee_advances WHERE id = ?').get(item.id);
    if (!row) continue;
    const newBal = Math.max(0, Number(row.balance) - item.amount);
    db.prepare(`UPDATE employee_advances SET balance = ?, status = ?, settled_at = CASE WHEN ? <= 0 THEN datetime('now') ELSE settled_at END WHERE id = ?`)
      .run(newBal, newBal <= 0 ? 'settled' : 'recovering', newBal, item.id);
  }
  for (const item of loanItems) {
    const row = db.prepare('SELECT balance FROM employee_loans WHERE id = ?').get(item.id);
    if (!row) continue;
    const newBal = Math.max(0, Number(row.balance) - item.amount);
    db.prepare(`UPDATE employee_loans SET balance = ?, status = ?, settled_at = CASE WHEN ? <= 0 THEN datetime('now') ELSE settled_at END WHERE id = ?`)
      .run(newBal, newBal <= 0 ? 'completed' : 'active', newBal, item.id);
  }
  for (const item of damageItems) {
    const row = db.prepare('SELECT balance FROM employee_damage_costs WHERE id = ?').get(item.id);
    if (!row) continue;
    const newBal = Math.max(0, Number(row.balance) - item.amount);
    db.prepare(`UPDATE employee_damage_costs SET balance = ?, status = ?, settled_at = CASE WHEN ? <= 0 THEN datetime('now') ELSE settled_at END WHERE id = ?`)
      .run(newBal, newBal <= 0 ? 'settled' : 'recovering', newBal, item.id);
  }
}

function savePayrollDeductions(payrollId, items, isEmployer = false) {
  const stmt = getDb().prepare(`
    INSERT INTO employee_payroll_deductions (payroll_id, deduction_type, reference_id, description, amount, is_employer)
    VALUES (?, ?, ?, ?, ?, ?)`);
  for (const item of items) {
    stmt.run(payrollId, item.type, item.id || null, item.description, item.amount, isEmployer ? 1 : 0);
  }
}

function getPayrollDeductions(payrollId) {
  return getDb().prepare('SELECT * FROM employee_payroll_deductions WHERE payroll_id = ? ORDER BY id').all(payrollId);
}

// ─── Advances ───────────────────────────────────────────────────────────────

function getAdvances(filters = {}) {
  let sql = `SELECT a.*, e.full_name, e.employee_code FROM employee_advances a JOIN employees e ON e.id = a.employee_id WHERE 1=1`;
  const params = [];
  if (filters.employee_id) { sql += ' AND a.employee_id = ?'; params.push(filters.employee_id); }
  if (filters.status) { sql += ' AND a.status = ?'; params.push(filters.status); }
  return getDb().prepare(sql + ' ORDER BY a.advance_date DESC').all(...params);
}

function issueAdvance(data, actor) {
  const amount = Number(data.amount);
  if (!data.employee_id || amount <= 0) throw new Error('Employee and amount required');
  const recovery = Number(data.recovery_per_period) || amount;
  const r = getDb().prepare(`
    INSERT INTO employee_advances (employee_id, amount, advance_date, reason, approved_by, approved_by_name, balance, recovery_per_period, repayment_method, auto_deduct, status, notes)
    VALUES (?,?,?,?,?,?,?,?,?,?, 'outstanding', ?)`).run(
    data.employee_id, amount, data.advance_date || new Date().toLocaleDateString('en-CA'),
    data.reason || null, actor?.id || null, actor?.full_name || actor?.username || null,
    amount, recovery, data.repayment_method || 'salary_deduction', data.auto_deduct !== false ? 1 : 0, data.notes || null
  );
  return getDb().prepare('SELECT * FROM employee_advances WHERE id = ?').get(r.lastInsertRowid);
}

// ─── Loans ──────────────────────────────────────────────────────────────────

function getLoans(filters = {}) {
  let sql = `SELECT l.*, e.full_name, e.employee_code FROM employee_loans l JOIN employees e ON e.id = l.employee_id WHERE 1=1`;
  const params = [];
  if (filters.employee_id) { sql += ' AND l.employee_id = ?'; params.push(filters.employee_id); }
  if (filters.status) { sql += ' AND l.status = ?'; params.push(filters.status); }
  return getDb().prepare(sql + ' ORDER BY l.loan_date DESC').all(...params);
}

function saveLoan(data) {
  const amount = Number(data.loan_amount);
  if (!data.employee_id || amount <= 0) throw new Error('Employee and loan amount required');
  const deduction = Number(data.monthly_deduction) || amount;
  if (data.id) {
    getDb().prepare(`
      UPDATE employee_loans SET loan_amount=?, interest_rate=?, loan_date=?, monthly_deduction=?, installments=?, balance=?, status=?, notes=? WHERE id=?`)
      .run(amount, Number(data.interest_rate) || 0, data.loan_date, deduction, Number(data.installments) || 0,
        Number(data.balance ?? amount), data.status || 'active', data.notes || null, data.id);
    return getDb().prepare('SELECT * FROM employee_loans WHERE id = ?').get(data.id);
  }
  const r = getDb().prepare(`
    INSERT INTO employee_loans (employee_id, loan_amount, interest_rate, loan_date, monthly_deduction, installments, balance, status, notes)
    VALUES (?,?,?,?,?,?,?, 'active', ?)`).run(
    data.employee_id, amount, Number(data.interest_rate) || 0, data.loan_date || new Date().toLocaleDateString('en-CA'),
    deduction, Number(data.installments) || Math.ceil(amount / deduction), amount, data.notes || null
  );
  return getDb().prepare('SELECT * FROM employee_loans WHERE id = ?').get(r.lastInsertRowid);
}

function settleLoanEarly(id) {
  getDb().prepare(`UPDATE employee_loans SET balance = 0, status = 'completed', settled_at = datetime('now') WHERE id = ?`).run(id);
  return getDb().prepare('SELECT * FROM employee_loans WHERE id = ?').get(id);
}

// ─── Damage costs ───────────────────────────────────────────────────────────

function getDamageCosts(filters = {}) {
  let sql = `SELECT d.*, e.full_name, e.employee_code FROM employee_damage_costs d JOIN employees e ON e.id = d.employee_id WHERE 1=1`;
  const params = [];
  if (filters.employee_id) { sql += ' AND d.employee_id = ?'; params.push(filters.employee_id); }
  if (filters.status) { sql += ' AND d.status = ?'; params.push(filters.status); }
  return getDb().prepare(sql + ' ORDER BY d.incident_date DESC').all(...params);
}

function saveDamageCost(data, actor) {
  const value = Number(data.damage_value);
  if (!data.employee_id || value <= 0) throw new Error('Employee and damage value required');
  const per = data.deduction_method === 'full' ? value : (Number(data.recovery_per_period) || value);
  const r = getDb().prepare(`
    INSERT INTO employee_damage_costs (employee_id, product_name, quantity, damage_value, incident_date, reason, approved_by, approved_by_name, photo_path, deduction_method, recovery_per_period, balance, status, notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    data.employee_id, data.product_name || null, Number(data.quantity) || 1, value,
    data.incident_date || new Date().toLocaleDateString('en-CA'), data.reason || null,
    actor?.id || null, actor?.full_name || actor?.username || null, data.photo_path || null,
    data.deduction_method || 'installments', per, value,
    data.status || 'pending', data.notes || null
  );
  return getDb().prepare('SELECT * FROM employee_damage_costs WHERE id = ?').get(r.lastInsertRowid);
}

function approveDamageCost(id, actor) {
  getDb().prepare(`UPDATE employee_damage_costs SET status = 'approved', approved_by = ?, approved_by_name = ? WHERE id = ?`)
    .run(actor?.id || null, actor?.full_name || actor?.username || null, id);
  return getDb().prepare('SELECT * FROM employee_damage_costs WHERE id = ?').get(id);
}

// ─── Compliance ─────────────────────────────────────────────────────────────

function getComplianceSubmissions(type) {
  let sql = 'SELECT * FROM payroll_compliance_submissions WHERE 1=1';
  const params = [];
  if (type) { sql += ' AND submission_type = ?'; params.push(type); }
  return getDb().prepare(sql + ' ORDER BY period_month DESC').all(...params);
}

function saveComplianceSubmission(data, actor) {
  if (data.id) {
    getDb().prepare(`UPDATE payroll_compliance_submissions SET status=?, submitted_at=?, submitted_by=?, notes=? WHERE id=?`)
      .run(data.status, data.status === 'submitted' ? new Date().toISOString() : null,
        actor?.full_name || actor?.username || null, data.notes || null, data.id);
    return getDb().prepare('SELECT * FROM payroll_compliance_submissions WHERE id = ?').get(data.id);
  }
  const r = getDb().prepare(`
    INSERT INTO payroll_compliance_submissions (submission_type, period_month, status, submitted_at, submitted_by, notes)
    VALUES (?,?,?,?,?,?)`).run(
    data.submission_type, data.period_month, data.status || 'pending',
    data.status === 'submitted' ? new Date().toISOString() : null,
    actor?.full_name || actor?.username || null, data.notes || null
  );
  return getDb().prepare('SELECT * FROM payroll_compliance_submissions WHERE id = ?').get(r.lastInsertRowid);
}

function getComplianceCertificates() {
  return getDb().prepare('SELECT * FROM compliance_certificates ORDER BY created_at DESC').all();
}

function saveComplianceCertificate(data) {
  if (data.id) {
    getDb().prepare(`UPDATE compliance_certificates SET cert_type=?, file_path=?, file_name=?, expiry_date=?, notes=? WHERE id=?`)
      .run(data.cert_type, data.file_path, data.file_name, data.expiry_date, data.notes, data.id);
    return getDb().prepare('SELECT * FROM compliance_certificates WHERE id = ?').get(data.id);
  }
  const r = getDb().prepare(`INSERT INTO compliance_certificates (cert_type, file_path, file_name, expiry_date, notes) VALUES (?,?,?,?,?)`)
    .run(data.cert_type, data.file_path || null, data.file_name || null, data.expiry_date || null, data.notes || null);
  return getDb().prepare('SELECT * FROM compliance_certificates WHERE id = ?').get(r.lastInsertRowid);
}

function deleteComplianceCertificate(id) {
  getDb().prepare('DELETE FROM compliance_certificates WHERE id = ?').run(id);
}

function getComplianceReminders() {
  const settings = getPayrollSettings();
  if (settings.compliance_reminders === false) return [];
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const notes = [];
  const schemeEnabled = {
    uif: settings.uif_enabled !== false,
    paye: settings.paye_enabled !== false,
    sdl: settings.sdl_enabled !== false,
    coida: !!settings.coida_enabled
  };
  for (const t of ['uif', 'paye', 'sdl', 'coida']) {
    if (!schemeEnabled[t]) continue;
    const row = getDb().prepare(`
      SELECT id FROM payroll_compliance_submissions
      WHERE submission_type = ? AND period_month = ? AND status = 'submitted' LIMIT 1`).get(t, month);
    if (!row) {
      notes.push({
        type: 'compliance',
        title: `${t.toUpperCase()} submission due`,
        message: `No submitted ${t.toUpperCase()} record for ${month}. Track in Payroll & Compliance.`
      });
    }
  }
  const certs = getDb().prepare(`
    SELECT * FROM compliance_certificates
    WHERE expiry_date IS NOT NULL AND date(expiry_date) <= date('now', '+30 days')`).all();
  for (const c of certs) {
    notes.push({
      type: 'cert',
      title: 'Certificate expiring',
      message: `${c.cert_type}${c.expiry_date ? ` expires ${c.expiry_date}` : ''}`
    });
  }
  return notes;
}

// ─── Reports ────────────────────────────────────────────────────────────────

function getPayrollReport(from, to) {
  return getDb().prepare(`
    SELECT p.*, e.full_name, e.employee_code, e.position FROM employee_payroll p
    JOIN employees e ON e.id = p.employee_id
    WHERE date(p.period_end) >= date(?) AND date(p.period_start) <= date(?)
    ORDER BY p.period_end DESC`).all(from, to);
}

function getStatutoryReport(type, from, to) {
  const rows = getPayrollReport(from, to);
  if (type === 'uif') {
    return rows.map(r => ({
      employee: r.full_name, code: r.employee_code, period: `${r.period_start}–${r.period_end}`,
      employee_uif: r.uif_employee, employer_uif: r.uif_employer, total: (Number(r.uif_employee) || 0) + (Number(r.uif_employer) || 0)
    }));
  }
  if (type === 'paye') {
    return rows.map(r => ({
      employee: r.full_name, code: r.employee_code, period: `${r.period_start}–${r.period_end}`,
      gross: r.gross_salary, paye: r.paye
    }));
  }
  if (type === 'sdl') {
    return rows.map(r => ({
      employee: r.full_name, code: r.employee_code, period: `${r.period_start}–${r.period_end}`,
      gross: r.gross_salary, sdl: r.sdl
    }));
  }
  if (type === 'coida') {
    return rows.map(r => ({
      employee: r.full_name, code: r.employee_code, period: `${r.period_start}–${r.period_end}`,
      gross: r.gross_salary, coida: r.coida
    }));
  }
  if (type === 'deductions') {
    return rows.map(r => ({
      employee: r.full_name, code: r.employee_code,
      advance: r.advance_recovery, loan: r.loan_recovery, damage: r.damage_recovery,
      paye: r.paye, uif: r.uif_employee, pension: r.pension_deduction, medical: r.medical_deduction,
      other: r.other_deductions, total: r.deductions
    }));
  }
  if (type === 'outstanding') {
    const advances = getAdvances({ status: 'outstanding' }).concat(getAdvances({ status: 'recovering' }));
    const loans = getLoans({ status: 'active' });
    const damage = getDamageCosts({ status: 'approved' }).concat(getDamageCosts({ status: 'recovering' }));
    return {
      advances: advances.filter(a => a.balance > 0),
      loans: loans.filter(l => l.balance > 0),
      damage: damage.filter(d => d.balance > 0)
    };
  }
  return rows;
}

function buildComplianceReportPdf(type, from, to, shopName, currency) {
  const data = getStatutoryReport(type, from, to);
  const doc = new jsPDF({ orientation: type === 'outstanding' ? 'portrait' : 'landscape' });
  doc.setFontSize(14);
  doc.text(`${shopName || 'Shop POS'} — ${type.toUpperCase()} Report`, 14, 16);
  doc.setFontSize(10);
  doc.text(`${from} to ${to}`, 14, 22);

  if (type === 'outstanding') {
    doc.text('Salary Advances', 14, 32);
    doc.autoTable({
      startY: 36, head: [['Employee', 'Amount', 'Balance', 'Date']],
      body: (data.advances || []).map(a => [a.full_name, `${currency}${Number(a.amount).toFixed(2)}`, `${currency}${Number(a.balance).toFixed(2)}`, a.advance_date])
    });
    let y = doc.lastAutoTable.finalY + 10;
    doc.text('Loans', 14, y);
    doc.autoTable({
      startY: y + 4, head: [['Employee', 'Loan', 'Balance', 'Monthly']],
      body: (data.loans || []).map(l => [l.full_name, `${currency}${Number(l.loan_amount).toFixed(2)}`, `${currency}${Number(l.balance).toFixed(2)}`, `${currency}${Number(l.monthly_deduction).toFixed(2)}`])
    });
    y = doc.lastAutoTable.finalY + 10;
    doc.text('Damage Costs', 14, y);
    doc.autoTable({
      startY: y + 4, head: [['Employee', 'Item', 'Value', 'Balance']],
      body: (data.damage || []).map(d => [d.full_name, d.product_name || '—', `${currency}${Number(d.damage_value).toFixed(2)}`, `${currency}${Number(d.balance).toFixed(2)}`])
    });
  } else if (type === 'uif') {
    doc.autoTable({
      startY: 28, head: [['Employee', 'Code', 'Period', 'Employee UIF', 'Employer UIF', 'Total']],
      body: data.map(r => [r.employee, r.code, r.period, `${currency}${Number(r.employee_uif).toFixed(2)}`, `${currency}${Number(r.employer_uif).toFixed(2)}`, `${currency}${Number(r.total).toFixed(2)}`])
    });
  } else if (type === 'paye') {
    doc.autoTable({
      startY: 28, head: [['Employee', 'Code', 'Period', 'Gross', 'PAYE']],
      body: data.map(r => [r.employee, r.code, r.period, `${currency}${Number(r.gross).toFixed(2)}`, `${currency}${Number(r.paye).toFixed(2)}`])
    });
  } else if (type === 'sdl') {
    doc.autoTable({
      startY: 28, head: [['Employee', 'Code', 'Period', 'Gross', 'SDL']],
      body: data.map(r => [r.employee, r.code, r.period, `${currency}${Number(r.gross).toFixed(2)}`, `${currency}${Number(r.sdl).toFixed(2)}`])
    });
  } else if (type === 'deductions') {
    doc.autoTable({
      startY: 28, head: [['Employee', 'Advance', 'Loan', 'Damage', 'PAYE', 'UIF', 'Pension', 'Medical', 'Other']],
      body: data.map(r => [r.employee, `${currency}${Number(r.advance).toFixed(2)}`, `${currency}${Number(r.loan).toFixed(2)}`,
        `${currency}${Number(r.damage).toFixed(2)}`, `${currency}${Number(r.paye).toFixed(2)}`, `${currency}${Number(r.uif).toFixed(2)}`,
        `${currency}${Number(r.pension).toFixed(2)}`, `${currency}${Number(r.medical).toFixed(2)}`, `${currency}${Number(r.other).toFixed(2)}`])
    });
  } else {
    doc.autoTable({
      startY: 28, head: [['Employee', 'Code', 'Period', 'Gross', 'Net']],
      body: data.map(r => [r.full_name, r.employee_code, `${r.period_start}–${r.period_end}`, `${currency}${Number(r.gross_salary).toFixed(2)}`, `${currency}${Number(r.net_salary).toFixed(2)}`])
    });
  }
  return doc.output('arraybuffer');
}

function buildEnhancedPayslipPdf(row, deductions, shopName, currency, settings) {
  const doc = new jsPDF();
  const cur = currency || 'R';
  const shop = settings || {};
  const pageW = doc.internal.pageSize.getWidth();
  let y = 16;

  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageW, 34, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18);
  doc.setFont(undefined, 'bold');
  doc.text(shopName || shop.shop_name || 'Shop POS', 14, 14);
  doc.setFontSize(9);
  doc.setFont(undefined, 'normal');
  const headerLines = [shop.address, shop.phone, shop.email].filter(Boolean);
  headerLines.forEach((line, i) => doc.text(String(line), 14, 21 + i * 4));
  doc.setFontSize(14);
  doc.setFont(undefined, 'bold');
  doc.text('PAYSLIP', pageW - 14, 14, { align: 'right' });
  doc.setFontSize(9);
  doc.setFont(undefined, 'normal');
  doc.text(`Period: ${row.period_start || '—'} to ${row.period_end || '—'}`, pageW - 14, 22, { align: 'right' });
  doc.text(`Generated: ${new Date().toLocaleDateString()}`, pageW - 14, 27, { align: 'right' });

  doc.setTextColor(0, 0, 0);
  y = 44;
  doc.setDrawColor(220, 220, 220);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(14, y, pageW - 28, 24, 2, 2, 'FD');
  doc.setFontSize(11);
  doc.setFont(undefined, 'bold');
  doc.text(String(row.full_name || 'Employee'), 18, y + 8);
  doc.setFont(undefined, 'normal');
  doc.setFontSize(10);
  doc.text(`Employee code: ${row.employee_code || '—'}`, 18, y + 15);
  doc.text(`Position: ${row.position || '—'}`, 18, y + 21);
  doc.text(`Status: ${row.status || 'draft'}`, pageW - 18, y + 15, { align: 'right' });
  y += 32;

  let attSummary = null;
  try {
    if (row.attendance_json) {
      attSummary = typeof row.attendance_json === 'string' ? JSON.parse(row.attendance_json) : row.attendance_json;
    }
  } catch (_) {}

  const bonusPay = Number(attSummary?.totals?.bonus_pay ?? attSummary?.bonus_pay ?? 0);
  const earnings = [
    ['Basic Salary', Number(row.basic_salary)],
    ['Overtime', Number(row.overtime_pay)],
    ['Bonus Hours Pay', bonusPay],
    ['Bonus', Number(row.bonus)],
    ['Commission', Number(row.commission)],
    ['Allowances', Number(row.allowances)]
  ].filter(([, v]) => v > 0).map(([l, v]) => [l, `${cur}${v.toFixed(2)}`]);
  const grossTotal = Number(row.gross_salary) || [Number(row.basic_salary), Number(row.overtime_pay), bonusPay, Number(row.bonus), Number(row.commission), Number(row.allowances)].reduce((a, b) => a + b, 0);

  const deductRows = [];
  const seen = new Set();
  const empFlags = {
    paye: !!row.paye_registered,
    uif: !!row.uif_registered,
    sdl: !!row.sdl_registered,
    pension: !!row.pension_registered,
    medical: !!row.medical_registered
  };
  const statLabels = {
    paye: 'PAYE (Tax)', uif: 'UIF (Employee)', uif_employee: 'UIF (Employee)',
    sdl: 'SDL (Skills Development Levy)', pension: 'Pension Fund', medical: 'Medical Aid',
    medical_aid: 'Medical Aid', advance: 'Salary Advance', loan: 'Loan Repayment',
    damage: 'Damage Cost', attendance: 'Attendance Deduction', other: 'Other Deduction'
  };
  const skipStatDeduction = (type) => {
    const t = String(type || '').toLowerCase();
    if (['paye', 'tax'].includes(t)) return !empFlags.paye || !settings.paye_enabled;
    if (['uif', 'uif_employee'].includes(t)) return !empFlags.uif || !settings.uif_enabled || !settings.uif_on_payslip;
    if (t === 'sdl') return !empFlags.sdl || !settings.sdl_enabled;
    if (['pension', 'pension_fund'].includes(t)) return !empFlags.pension;
    if (['medical', 'medical_aid'].includes(t)) return !empFlags.medical;
    return false;
  };
  const addDed = (label, amt) => {
    const n = Number(amt) || 0;
    if (n <= 0 || seen.has(label)) return;
    seen.add(label);
    deductRows.push([label, `-${cur}${n.toFixed(2)}`]);
  };
  if (Array.isArray(deductions) && deductions.length) {
    for (const d of deductions.filter(x => !x.is_employer)) {
      const type = String(d.deduction_type || '').toLowerCase();
      if (skipStatDeduction(type)) continue;
      const label = d.description || statLabels[type] || statLabels[d.deduction_type] || d.deduction_type || 'Deduction';
      addDed(label, d.amount);
    }
  } else {
    addDed('Salary Advance', row.advance_recovery);
    addDed('Loan Repayment', row.loan_recovery);
    addDed('Damage Cost', row.damage_recovery);
    if (empFlags.paye && settings.paye_enabled) addDed('PAYE (Tax)', row.paye);
    if (empFlags.uif && settings.uif_enabled && settings.uif_on_payslip) addDed('UIF (Employee)', row.uif_employee);
    if (empFlags.sdl && settings.sdl_enabled) addDed('SDL (Skills Development Levy)', row.sdl);
    if (empFlags.pension) addDed('Pension Fund', row.pension_deduction);
    if (empFlags.medical) addDed('Medical Aid', row.medical_deduction);
    addDed('Other Deductions', row.other_deductions);
    addDed('Attendance (late/absence)', row.attendance_deductions);
  }

  const totalDeductions = deductRows.reduce((sum, [, v]) => sum + Math.abs(parseFloat(String(v).replace(/[^\d.-]/g, '')) || 0), 0);

  if (attSummary?.totals) {
    const t = attSummary.totals;
    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.text('Attendance Summary', 14, y);
    doc.autoTable({
      startY: y + 3,
      head: [['Metric', 'Value']],
      body: [
        ['Scheduled Hours', Number(t.scheduled_hours || 0).toFixed(1)],
        ['Hours Worked', Number(t.hours_worked || 0).toFixed(1)],
        ['Late Minutes', String(t.late_minutes || 0)],
        ['Overtime Hours', Number(t.overtime_hours || 0).toFixed(1)]
      ],
      theme: 'striped',
      headStyles: { fillColor: [15, 23, 42] },
      margin: { left: 14, right: 14 }
    });
    y = doc.lastAutoTable.finalY + 8;
  }

  doc.setFontSize(11);
  doc.setFont(undefined, 'bold');
  doc.text('Earnings', 14, y);
  doc.autoTable({
    startY: y + 3,
    head: [['Description', 'Amount']],
    body: earnings.length ? earnings : [['No earnings recorded', `${cur}0.00`]],
    theme: 'striped',
    headStyles: { fillColor: [22, 101, 52] },
    margin: { left: 14, right: 14 }
  });
  y = doc.lastAutoTable.finalY + 4;
  doc.setFont(undefined, 'bold');
  doc.text(`Total Earnings: ${cur}${grossTotal.toFixed(2)}`, pageW - 14, y, { align: 'right' });
  y += 10;

  doc.setFont(undefined, 'bold');
  doc.text('Deductions', 14, y);
  doc.autoTable({
    startY: y + 3,
    head: [['Description', 'Amount']],
    body: deductRows.length ? deductRows : [['No deductions', `${cur}0.00`]],
    theme: 'striped',
    headStyles: { fillColor: [153, 27, 27] },
    margin: { left: 14, right: 14 }
  });
  y = doc.lastAutoTable.finalY + 4;
  doc.text(`Total Deductions: ${cur}${totalDeductions.toFixed(2)}`, pageW - 14, y, { align: 'right' });
  y += 12;

  doc.setFillColor(15, 23, 42);
  doc.roundedRect(14, y, pageW - 28, 18, 2, 2, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(13);
  doc.setFont(undefined, 'bold');
  doc.text('NET PAY', 20, y + 11);
  doc.setFontSize(16);
  doc.text(`${cur}${Number(row.net_salary).toFixed(2)}`, pageW - 20, y + 12, { align: 'right' });
  doc.setTextColor(0, 0, 0);
  y += 26;

  if (row.status === 'paid' && row.paid_at) {
    doc.setFontSize(9);
    doc.setTextColor(100);
    doc.text(`Payment recorded: ${row.paid_at} via ${row.payment_method || 'cash'}`, 14, y);
    doc.setTextColor(0);
    y += 8;
  }

  // Admin signature (uploaded in Operations)
  try {
    const fs = require('fs');
    const path = require('path');
    const { getDb } = require('../database/db');
    const sigPath = getDb().prepare('SELECT admin_signature_path FROM shop_settings WHERE id = 1').get()?.admin_signature_path;
    if (sigPath && fs.existsSync(sigPath)) {
      if (y > 240) { doc.addPage(); y = 24; }
      doc.setFontSize(10);
      doc.setFont(undefined, 'bold');
      doc.setTextColor(0);
      doc.text('Authorised by Administrator', 14, y);
      y += 4;
      const ext = path.extname(sigPath).toLowerCase();
      const fmt = ext === '.png' ? 'PNG' : 'JPEG';
      const imgData = fs.readFileSync(sigPath).toString('base64');
      try { doc.addImage(imgData, fmt, 14, y, 48, 16); } catch (_) { doc.line(14, y + 14, 62, y + 14); }
      y += 22;
      doc.setFontSize(8);
      doc.setFont(undefined, 'normal');
      doc.text('Signature', 14, y);
      y += 6;
    }
  } catch (_) { /* signature optional */ }

  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text('This payslip is computer-generated and serves as an official record of remuneration.', 14, 285);
  doc.text(`${shopName || shop.shop_name || 'Shop POS'} — Confidential`, pageW - 14, 285, { align: 'right' });

  return doc.output('arraybuffer');
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function isPayrollDueToday(settings) {
  const now = new Date();
  const freq = settings?.pay_frequency || 'monthly';
  if (freq === 'weekly') {
    return now.getDay() === Number(settings.payday_weekday ?? 5);
  }
  if (freq === 'fortnightly') {
    if (now.getDay() !== Number(settings.payday_weekday ?? 5)) return false;
    const jan1 = new Date(now.getFullYear(), 0, 1);
    const weekNum = Math.floor((now - jan1) / (7 * 24 * 60 * 60 * 1000));
    return weekNum % 2 === 0;
  }
  const day = Math.min(Math.max(Number(settings.payday) || 25, 1), 28);
  return now.getDate() === day;
}

function getPayrollPaymentNotifications() {
  const settings = getPayrollSettings();
  if (!isPayrollDueToday(settings)) return [];
  const freq = settings.pay_frequency || 'monthly';
  const dayLabel = freq === 'monthly'
    ? `day ${settings.payday || 25} of the month`
    : WEEKDAY_NAMES[Number(settings.payday_weekday ?? 5)] || 'Friday';
  return [{
    type: 'payroll_due',
    title: 'Staff Pay Day',
    message: `Today is staff ${freq} pay day (${dayLabel}). Process payroll in Admin → Payroll.`
  }];
}

module.exports = {
  defaultPayrollSettings, getPayrollSettings, savePayrollSettings,
  calculatePayrollBreakdown, applyRecoveries, savePayrollDeductions, getPayrollDeductions,
  calcMonthlyPaye, calcUif, calcSdl, calcCoida,
  getAdvances, issueAdvance, getLoans, saveLoan, settleLoanEarly,
  getDamageCosts, saveDamageCost, approveDamageCost,
  getComplianceSubmissions, saveComplianceSubmission,
  getComplianceCertificates, saveComplianceCertificate, deleteComplianceCertificate,
  getComplianceReminders, isPayrollDueToday, getPayrollPaymentNotifications,
  getPayrollReport, getStatutoryReport, buildComplianceReportPdf, buildEnhancedPayslipPdf
};

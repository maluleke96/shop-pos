const { getDb } = require('../database/db');
const { jsPDF } = require('jspdf');
require('jspdf-autotable');

function today() {
  return new Date().toLocaleDateString('en-CA');
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('en-CA');
}

function addMonths(dateStr, months) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setMonth(d.getMonth() + months);
  return d.toLocaleDateString('en-CA');
}

function startOfWeek(dateStr) {
  const d = new Date((dateStr || today()) + 'T12:00:00');
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toLocaleDateString('en-CA');
}

function endOfWeek(dateStr) {
  return addDays(startOfWeek(dateStr), 6);
}

function monthStart(dateStr) {
  const d = new Date((dateStr || today()) + 'T12:00:00');
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function monthEnd(dateStr) {
  const d = new Date((dateStr || today()) + 'T12:00:00');
  d.setMonth(d.getMonth() + 1, 0);
  return d.toLocaleDateString('en-CA');
}

function nextPayslipNumber() {
  const row = getDb().prepare('SELECT COUNT(*) as c FROM owner_salary_periods').get();
  const n = (row?.c || 0) + 1;
  return `OS-${String(n).padStart(5, '0')}`;
}

function calcPeriodGross(p) {
  return Math.max(0,
    (Number(p.basic_salary) || 0) + (Number(p.bonus) || 0) + (Number(p.allowances) || 0)
    + (Number(p.carried_forward) || 0)
  );
}

function sumOwnerDraws(profileId, from, to) {
  try {
    const row = getDb().prepare(`
      SELECT COALESCE(SUM(amount), 0) as total FROM owner_draws
      WHERE profile_id = ? AND date(draw_date) BETWEEN date(?) AND date(?)`).get(profileId, from, to);
    return Number(row?.total) || 0;
  } catch (_) {
    return 0;
  }
}

function calcOwnerCompliance(profile, periodData) {
  const payroll = require('./payroll-compliance');
  const settings = payroll.getPayrollSettings();
  const earnings = (Number(periodData.basic_salary) || 0) + (Number(periodData.bonus) || 0) + (Number(periodData.allowances) || 0);
  const uifEnabled = profile?.uif_enabled !== 0 && profile?.uif_enabled !== false;
  const payeEnabled = profile?.paye_enabled !== 0 && profile?.paye_enabled !== false;
  const uif = uifEnabled ? payroll.calcUif(earnings, settings) : { employee: 0, employer: 0 };
  const paye = payeEnabled && settings.paye_enabled ? payroll.calcMonthlyPaye(earnings) : 0;
  const sdl = settings.sdl_auto_calculate ? payroll.calcSdl(earnings, settings) : 0;
  const draws = sumOwnerDraws(profile.id, periodData.period_start, periodData.period_end);
  const manualDed = Number(periodData.deductions) || Number(profile.default_deductions) || 0;
  const gross = calcPeriodGross(periodData);
  const totalDeductions = (uif.employee || 0) + paye + draws + manualDed;
  const netPay = Math.max(0, gross - totalDeductions);
  return {
    uif_employee: uif.employee || 0,
    uif_employer: uif.employer || 0,
    paye,
    sdl,
    draw_deductions: draws,
    net_pay: netPay,
    gross_amount: gross,
    outstanding_balance: netPay,
    deductions_detail: JSON.stringify({
      manual: manualDed,
      draws,
      uif_employee: uif.employee || 0,
      uif_employer: uif.employer || 0,
      paye,
      sdl
    })
  };
}

function applyPeriodCompliance(profile, period) {
  if (!profile || !period) return period;
  const comp = calcOwnerCompliance(profile, period);
  try {
    getDb().prepare(`
      UPDATE owner_salary_periods SET gross_amount=?, uif_employee=?, uif_employer=?, paye=?, sdl=?,
        draw_deductions=?, net_pay=?, deductions_detail=?,
        outstanding_balance = MAX(0, ? - amount_paid), updated_at=datetime('now')
      WHERE id=?`).run(
      comp.gross_amount, comp.uif_employee, comp.uif_employer, comp.paye, comp.sdl,
      comp.draw_deductions, comp.net_pay, comp.deductions_detail,
      comp.net_pay, period.id
    );
  } catch (_) {
    getDb().prepare(`
      UPDATE owner_salary_periods SET gross_amount=?, outstanding_balance = MAX(0, ? - amount_paid)
      WHERE id=?`).run(comp.gross_amount, comp.net_pay, period.id);
  }
  return getDb().prepare('SELECT * FROM owner_salary_periods WHERE id = ?').get(period.id);
}

function getOwnerDraws(profileId, filters = {}) {
  try {
    let sql = 'SELECT * FROM owner_draws WHERE profile_id = ?';
    const params = [profileId];
    if (filters.from) { sql += ' AND date(draw_date) >= date(?)'; params.push(filters.from); }
    if (filters.to) { sql += ' AND date(draw_date) <= date(?)'; params.push(filters.to); }
    return getDb().prepare(sql + ' ORDER BY draw_date DESC, id DESC').all(...params);
  } catch (_) {
    return [];
  }
}

function addOwnerDraw(data, actor) {
  const profile = getOwnerProfile();
  if (!profile) throw new Error('Owner salary profile not set up');
  const amount = Number(data.amount);
  if (amount <= 0) throw new Error('Draw amount must be greater than zero');
  const r = getDb().prepare(`
    INSERT INTO owner_draws (profile_id, draw_date, draw_type, amount, description, period_id, created_by, created_by_name)
    VALUES (?,?,?,?,?,?,?,?)`).run(
    profile.id, data.draw_date || today(), data.draw_type || 'cash', amount,
    data.description || null, data.period_id || null,
    actor?.id || null, actor?.full_name || actor?.username || null
  );
  const periods = getDb().prepare(`
    SELECT * FROM owner_salary_periods WHERE profile_id = ? AND status IN ('unpaid','partially_paid')`).all(profile.id);
  for (const p of periods) applyPeriodCompliance(profile, p);
  return getDb().prepare('SELECT * FROM owner_draws WHERE id = ?').get(r.lastInsertRowid);
}

function deleteOwnerDraw(id, actor) {
  const profile = getOwnerProfile();
  const row = getDb().prepare('SELECT * FROM owner_draws WHERE id = ? AND profile_id = ?').get(id, profile?.id);
  if (!row) throw new Error('Draw not found');
  getDb().prepare('DELETE FROM owner_draws WHERE id = ?').run(id);
  const periods = getDb().prepare(`
    SELECT * FROM owner_salary_periods WHERE profile_id = ? AND status IN ('unpaid','partially_paid')`).all(profile.id);
  for (const p of periods) applyPeriodCompliance(profile, p);
  return { success: true };
}

function getOwnerProfile() {
  return getDb().prepare('SELECT * FROM owner_salary_profile ORDER BY id LIMIT 1').get();
}

function saveOwnerProfile(data) {
  if (!data.owner_name?.trim()) throw new Error('Owner name is required');
  const existing = getOwnerProfile();
  const payload = {
    owner_name: data.owner_name.trim(),
    position: data.position?.trim() || 'Owner',
    salary_type: data.salary_type === 'weekly' ? 'weekly' : 'monthly',
    basic_salary: Number(data.basic_salary) || 0,
    payment_day: (() => {
      const raw = parseInt(data.payment_day, 10);
      if (data.salary_type === 'weekly') return Number.isFinite(raw) ? Math.min(6, Math.max(0, raw)) : 5;
      return Number.isFinite(raw) ? Math.min(28, Math.max(1, raw)) : 25;
    })(),
    custom_pay_date: data.custom_pay_date || null,
    default_bonus: Number(data.default_bonus) || 0,
    default_allowances: Number(data.default_allowances) || 0,
    default_deductions: Number(data.default_deductions) || 0,
    is_active: data.is_active === false || data.is_active === 0 ? 0 : 1,
    employee_id: data.employee_id ? parseInt(data.employee_id, 10) : null,
    uif_registration: data.uif_registration?.trim() || null,
    tax_number: data.tax_number?.trim() || null,
    uif_enabled: data.uif_enabled === false || data.uif_enabled === 0 ? 0 : 1,
    paye_enabled: data.paye_enabled === false || data.paye_enabled === 0 ? 0 : 1
  };
  if (existing) {
    try {
      getDb().prepare(`
        UPDATE owner_salary_profile SET owner_name=?, position=?, salary_type=?, basic_salary=?, payment_day=?,
          custom_pay_date=?, default_bonus=?, default_allowances=?, default_deductions=?, is_active=?,
          employee_id=?, uif_registration=?, tax_number=?, uif_enabled=?, paye_enabled=?, updated_at=datetime('now')
        WHERE id=?`).run(
        payload.owner_name, payload.position, payload.salary_type, payload.basic_salary, payload.payment_day,
        payload.custom_pay_date, payload.default_bonus, payload.default_allowances, payload.default_deductions,
        payload.is_active, payload.employee_id, payload.uif_registration, payload.tax_number,
        payload.uif_enabled, payload.paye_enabled, existing.id
      );
    } catch (_) {
      getDb().prepare(`
        UPDATE owner_salary_profile SET owner_name=?, position=?, salary_type=?, basic_salary=?, payment_day=?,
          custom_pay_date=?, default_bonus=?, default_allowances=?, default_deductions=?, is_active=?, updated_at=datetime('now')
        WHERE id=?`).run(
        payload.owner_name, payload.position, payload.salary_type, payload.basic_salary, payload.payment_day,
        payload.custom_pay_date, payload.default_bonus, payload.default_allowances, payload.default_deductions,
        payload.is_active, existing.id
      );
    }
    const profile = getOwnerProfile();
    if (profile?.is_active) {
      try { ensureCurrentPeriod(profile); } catch (_) { /* ignore */ }
    }
    return profile;
  }
  const r = getDb().prepare(`
    INSERT INTO owner_salary_profile (owner_name, position, salary_type, basic_salary, payment_day, custom_pay_date,
      default_bonus, default_allowances, default_deductions, is_active)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    payload.owner_name, payload.position, payload.salary_type, payload.basic_salary, payload.payment_day,
    payload.custom_pay_date, payload.default_bonus, payload.default_allowances, payload.default_deductions, payload.is_active
  );
  const profile = getDb().prepare('SELECT * FROM owner_salary_profile WHERE id = ?').get(r.lastInsertRowid);
  if (profile?.is_active) {
    try { ensureCurrentPeriod(profile); } catch (_) { /* ignore */ }
  }
  return profile;
}

function getOutstandingTotal(profileId) {
  const row = getDb().prepare(`
    SELECT COALESCE(SUM(outstanding_balance), 0) as total FROM owner_salary_periods
    WHERE profile_id = ? AND status IN ('unpaid', 'partially_paid') AND outstanding_balance > 0`).get(profileId);
  return Number(row?.total) || 0;
}

function computeDueDate(profile, periodEnd) {
  if (profile.custom_pay_date) return profile.custom_pay_date;
  if (profile.salary_type === 'weekly') {
    const dow = Number(profile.payment_day) || 5;
    const d = new Date(periodEnd + 'T12:00:00');
    let diff = dow - d.getDay();
    if (diff < 0) diff += 7;
    d.setDate(d.getDate() + diff);
    return d.toLocaleDateString('en-CA');
  }
  const day = Math.min(Math.max(Number(profile.payment_day) || 25, 1), 28);
  const end = new Date(periodEnd + 'T12:00:00');
  end.setDate(day);
  if (end.toLocaleDateString('en-CA') < periodEnd) {
    end.setMonth(end.getMonth() + 1);
  }
  return end.toLocaleDateString('en-CA');
}

function rollForwardOutstanding(profileId) {
  const unpaid = getDb().prepare(`
    SELECT * FROM owner_salary_periods WHERE profile_id = ? AND outstanding_balance > 0
      AND status IN ('unpaid', 'partially_paid') ORDER BY period_end`).all(profileId);
  let total = 0;
  for (const p of unpaid) {
    total += Number(p.outstanding_balance) || 0;
    getDb().prepare(`
      UPDATE owner_salary_periods SET outstanding_balance = 0, status = 'paid',
        notes = TRIM(COALESCE(notes, '') || ' [Balance carried forward to next period]') WHERE id = ?`).run(p.id);
  }
  return total;
}

function ensureCurrentPeriod(profile) {
  if (!profile?.is_active) return null;
  const now = today();
  let periodStart, periodEnd, periodType;
  if (profile.salary_type === 'weekly') {
    periodStart = startOfWeek(now);
    periodEnd = endOfWeek(now);
    periodType = 'weekly';
  } else {
    periodStart = monthStart(now);
    periodEnd = monthEnd(now);
    periodType = 'monthly';
  }
  let period = getDb().prepare(`
    SELECT * FROM owner_salary_periods WHERE profile_id = ? AND period_start = ? AND period_end = ?`).get(profile.id, periodStart, periodEnd);
  if (period) return period;

  const carriedForward = rollForwardOutstanding(profile.id);
  const basic = Number(profile.basic_salary) || 0;
  const bonus = Number(profile.default_bonus) || 0;
  const allowances = Number(profile.default_allowances) || 0;
  const deductions = Number(profile.default_deductions) || 0;
  const periodDraft = {
    basic_salary: basic, bonus, allowances, deductions, carried_forward: carriedForward,
    period_start: periodStart, period_end: periodEnd
  };
  const comp = calcOwnerCompliance(profile, periodDraft);
  const dueDate = computeDueDate(profile, periodEnd);
  try {
    const r = getDb().prepare(`
      INSERT INTO owner_salary_periods (profile_id, period_start, period_end, period_type, basic_salary, bonus, allowances,
        deductions, carried_forward, gross_amount, uif_employee, uif_employer, paye, sdl, draw_deductions, net_pay,
        deductions_detail, outstanding_balance, status, due_date, payslip_number)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, ?, 'unpaid', ?, ?)`).run(
      profile.id, periodStart, periodEnd, periodType, basic, bonus, allowances, deductions,
      carriedForward, comp.gross_amount, comp.uif_employee, comp.uif_employer, comp.paye, comp.sdl,
      comp.draw_deductions, comp.net_pay, comp.deductions_detail, comp.net_pay, dueDate, nextPayslipNumber()
    );
    period = getDb().prepare('SELECT * FROM owner_salary_periods WHERE id = ?').get(r.lastInsertRowid);
  } catch (_) {
    const gross = comp.gross_amount;
    const r = getDb().prepare(`
      INSERT INTO owner_salary_periods (profile_id, period_start, period_end, period_type, basic_salary, bonus, allowances,
        deductions, carried_forward, gross_amount, outstanding_balance, status, due_date, payslip_number)
      VALUES (?,?,?,?,?,?,?,?,?,?,?, 'unpaid', ?, ?)`).run(
      profile.id, periodStart, periodEnd, periodType, basic, bonus, allowances, deductions,
      carriedForward, gross, comp.net_pay, dueDate, nextPayslipNumber()
    );
    period = getDb().prepare('SELECT * FROM owner_salary_periods WHERE id = ?').get(r.lastInsertRowid);
  }
  return period;
}

function refreshOpenPeriodCompliance(profile) {
  if (!profile) return;
  const open = getDb().prepare(`
    SELECT * FROM owner_salary_periods WHERE profile_id = ? AND status IN ('unpaid','partially_paid')`).all(profile.id);
  for (const p of open) applyPeriodCompliance(profile, p);
}

function syncOwnerSalaryPeriods() {
  const profile = getOwnerProfile();
  if (!profile) return { profile: null, periods: [], outstanding: 0, notifications: [] };
  ensureCurrentPeriod(profile);
  refreshOpenPeriodCompliance(profile);
  const periods = getOwnerSalaryPeriods(profile.id);
  const notifications = getOwnerSalaryNotifications(profile);
  return {
    profile,
    periods,
    draws: getOwnerDraws(profile.id),
    outstanding: getOutstandingTotal(profile.id),
    notifications
  };
}

function getOwnerSalaryPeriods(profileId, filters = {}) {
  let sql = 'SELECT * FROM owner_salary_periods WHERE profile_id = ?';
  const params = [profileId];
  if (filters.status) { sql += ' AND status = ?'; params.push(filters.status); }
  if (filters.from) { sql += ' AND date(period_end) >= date(?)'; params.push(filters.from); }
  if (filters.to) { sql += ' AND date(period_start) <= date(?)'; params.push(filters.to); }
  return getDb().prepare(sql + ' ORDER BY period_end DESC').all(...params);
}

function getOwnerSalaryPayments(profileId) {
  return getDb().prepare(`
    SELECT p.*, GROUP_CONCAT(a.period_id || ':' || a.amount) as allocations
    FROM owner_salary_payments p
    LEFT JOIN owner_salary_payment_allocations a ON a.payment_id = p.id
    WHERE p.profile_id = ?
    GROUP BY p.id ORDER BY p.payment_date DESC, p.id DESC`).all(profileId);
}

function payOwnerSalary(data, actor) {
  const profile = getOwnerProfile();
  if (!profile) throw new Error('Owner salary profile not set up');
  const amount = Number(data.amount);
  if (amount <= 0) throw new Error('Payment amount must be greater than zero');

  const periodIds = Array.isArray(data.period_ids) ? data.period_ids.map(Number).filter(Boolean) : [];
  let periods = periodIds.length
    ? periodIds.map(id => getDb().prepare('SELECT * FROM owner_salary_periods WHERE id = ? AND profile_id = ?').get(id, profile.id)).filter(Boolean)
    : getDb().prepare(`SELECT * FROM owner_salary_periods WHERE profile_id = ? AND outstanding_balance > 0 ORDER BY period_end`).all(profile.id);

  if (!periods.length) throw new Error('No outstanding salary periods to pay');

  const r = getDb().prepare(`
    INSERT INTO owner_salary_payments (profile_id, payment_date, payment_method, payment_reference, total_amount, notes, paid_by_user_id, paid_by_name)
    VALUES (?,?,?,?,?,?,?,?)`).run(
    profile.id, data.payment_date || today(), data.payment_method || 'cash',
    data.payment_reference || null, amount, data.notes || null, actor?.id || null,
    actor?.full_name || actor?.username || null
  );
  const paymentId = r.lastInsertRowid;
  let remaining = amount;
  const allocStmt = getDb().prepare('INSERT INTO owner_salary_payment_allocations (payment_id, period_id, amount) VALUES (?,?,?)');
  const updStmt = getDb().prepare(`
    UPDATE owner_salary_periods SET amount_paid = ?, outstanding_balance = ?, status = ? WHERE id = ?`);

  for (const period of periods) {
    if (remaining <= 0) break;
    const pay = Math.min(remaining, Number(period.outstanding_balance) || 0);
    if (pay <= 0) continue;
    allocStmt.run(paymentId, period.id, pay);
    const newPaid = (Number(period.amount_paid) || 0) + pay;
    const newOut = Math.max(0, (Number(period.outstanding_balance) || 0) - pay);
    const status = newOut <= 0 ? 'paid' : 'partially_paid';
    updStmt.run(newPaid, newOut, status, period.id);
    remaining -= pay;
  }

  return {
    payment: getDb().prepare('SELECT * FROM owner_salary_payments WHERE id = ?').get(paymentId),
    periods: getOwnerSalaryPeriods(profile.id)
  };
}

function getOwnerSalaryNotifications(profile) {
  if (!profile?.is_active) return [];
  const notes = [];
  const outstanding = getOutstandingTotal(profile.id);
  const periods = getDb().prepare(`
    SELECT * FROM owner_salary_periods WHERE profile_id = ? AND status IN ('unpaid','partially_paid') ORDER BY due_date`).all(profile.id);
  const now = today();
  for (const p of periods) {
    if (p.due_date === now) {
      notes.push({ type: 'due', title: 'Owner Salary Due Today', message: `${profile.owner_name}: ${p.payslip_number} — ${Number(p.outstanding_balance).toFixed(2)} due today` });
    } else if (p.due_date && p.due_date < now) {
      notes.push({ type: 'overdue', title: 'Owner Salary Overdue', message: `${profile.owner_name}: ${p.payslip_number} overdue since ${p.due_date}` });
    }
  }
  if (outstanding > 0) {
    notes.push({ type: 'outstanding', title: 'Outstanding Owner Salary', message: `Total outstanding balance: ${outstanding.toFixed(2)}` });
  }
  return notes;
}

function getOwnerSalaryReport(type, from, to) {
  const profile = getOwnerProfile();
  if (!profile) return [];
  if (type === 'outstanding') {
    return getDb().prepare(`
      SELECT * FROM owner_salary_periods WHERE profile_id = ? AND outstanding_balance > 0 ORDER BY period_end`).all(profile.id);
  }
  if (type === 'payments') {
    return getOwnerSalaryPayments(profile.id);
  }
  if (type === 'annual') {
    const year = (from || today()).slice(0, 4);
    return getDb().prepare(`
      SELECT * FROM owner_salary_periods WHERE profile_id = ? AND strftime('%Y', period_end) = ? ORDER BY period_end`).all(profile.id, year);
  }
  return getOwnerSalaryPeriods(profile.id, { from, to });
}

function buildOwnerPayslipPdf(periodId, shopName, currency) {
  const row = getDb().prepare(`
    SELECT p.*, pr.owner_name, pr.position, pr.salary_type, pr.uif_registration, pr.tax_number
    FROM owner_salary_periods p
    JOIN owner_salary_profile pr ON pr.id = p.profile_id WHERE p.id = ?`).get(periodId);
  if (!row) throw new Error('Salary period not found');
  const payments = getDb().prepare(`
    SELECT pay.* FROM owner_salary_payments pay
    JOIN owner_salary_payment_allocations a ON a.payment_id = pay.id
    WHERE a.period_id = ? ORDER BY pay.payment_date DESC`).all(periodId);
  const lastPay = payments[0];
  const fmt = (n) => `${currency}${Number(n || 0).toFixed(2)}`;
  const netPay = Number(row.net_pay ?? row.outstanding_balance) || 0;

  const doc = new jsPDF();
  doc.setFillColor(30, 41, 59);
  doc.rect(0, 0, 210, 36, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18);
  doc.text(shopName || 'Shop POS', 14, 16);
  doc.setFontSize(11);
  doc.text('OWNER PAYSLIP', 14, 26);
  doc.setTextColor(30, 41, 59);
  doc.setFontSize(10);
  let y = 46;
  const lines = [
    ['Payslip No', row.payslip_number],
    ['Owner', row.owner_name],
    ['Position', row.position || 'Owner'],
    ['Pay Period', `${row.period_start} to ${row.period_end}`],
    ['Salary Type', row.salary_type === 'weekly' ? 'Weekly' : 'Monthly'],
    ['Status', String(row.status || '').replace('_', ' ')]
  ];
  if (row.uif_registration) lines.push(['UIF Reg', row.uif_registration]);
  if (row.tax_number) lines.push(['Tax No', row.tax_number]);
  lines.forEach(([k, v]) => { doc.text(`${k}:`, 14, y); doc.text(String(v), 70, y); y += 6; });

  const earnings = [
    ['Basic Salary', fmt(row.basic_salary)],
    ...(Number(row.carried_forward) > 0 ? [['Carried Forward', fmt(row.carried_forward)]] : []),
    ...(Number(row.bonus) > 0 ? [['Bonus', fmt(row.bonus)]] : []),
    ...(Number(row.allowances) > 0 ? [['Allowances', fmt(row.allowances)]] : []),
    ['Gross Earnings', fmt(row.gross_amount)]
  ];
  const deductions = [
    ...(Number(row.paye) > 0 ? [['PAYE', `-${fmt(row.paye)}`]] : []),
    ...(Number(row.uif_employee) > 0 ? [['UIF (Employee)', `-${fmt(row.uif_employee)}`]] : []),
    ...(Number(row.draw_deductions) > 0 ? [['Owner Draws', `-${fmt(row.draw_deductions)}`]] : []),
    ...(Number(row.deductions) > 0 ? [['Other Deductions', `-${fmt(row.deductions)}`]] : []),
    ...(Number(row.sdl) > 0 ? [['SDL (Employer ref)', fmt(row.sdl)]] : [])
  ];

  doc.autoTable({ startY: y + 4, head: [['Earnings', 'Amount']], body: earnings, theme: 'grid' });
  const dedY = doc.lastAutoTable.finalY + 8;
  doc.autoTable({
    startY: dedY,
    head: [['Deductions', 'Amount']],
    body: deductions.length ? deductions : [['None', fmt(0)]],
    theme: 'grid'
  });
  const summaryY = doc.lastAutoTable.finalY + 10;
  doc.setFont(undefined, 'bold');
  doc.text(`Net Pay Due: ${fmt(netPay)}`, 14, summaryY);
  doc.text(`Amount Paid: ${fmt(row.amount_paid)}`, 14, summaryY + 7);
  doc.text(`Outstanding: ${fmt(row.outstanding_balance)}`, 14, summaryY + 14);
  doc.setFont(undefined, 'normal');
  if (lastPay) {
    doc.setFontSize(9);
    doc.text(`Last payment: ${lastPay.payment_date} via ${lastPay.payment_method || '—'}${lastPay.payment_reference ? ` (${lastPay.payment_reference})` : ''}`, 14, summaryY + 22);
  }
  doc.setFontSize(8);
  doc.setTextColor(100, 100, 100);
  doc.text(`Generated ${new Date().toLocaleString()}`, 14, 285);
  return doc.output('arraybuffer');
}

function buildOwnerSalaryReportPdf(type, from, to, shopName, currency) {
  const profile = getOwnerProfile();
  const data = getOwnerSalaryReport(type, from, to);
  const doc = new jsPDF({ orientation: type === 'payments' ? 'landscape' : 'portrait' });
  doc.setFontSize(14);
  doc.text(`${shopName || 'Shop POS'} — Owner Salary ${type.replace('_', ' ')} Report`, 14, 16);
  doc.setFontSize(10);
  doc.text(`${from || '—'} to ${to || '—'}`, 14, 22);

  if (type === 'outstanding') {
    doc.autoTable({
      startY: 28,
      head: [['Period', 'Due', 'Gross', 'Paid', 'Outstanding', 'Status']],
      body: data.map(p => [ `${p.period_start}–${p.period_end}`, p.due_date || '—',
        `${currency}${Number(p.gross_amount).toFixed(2)}`, `${currency}${Number(p.amount_paid).toFixed(2)}`,
        `${currency}${Number(p.outstanding_balance).toFixed(2)}`, p.status ])
    });
  } else if (type === 'payments') {
    doc.autoTable({
      startY: 28,
      head: [['Date', 'Method', 'Reference', 'Amount', 'Paid By', 'Notes']],
      body: data.map(p => [ p.payment_date, p.payment_method, p.payment_reference || '—',
        `${currency}${Number(p.total_amount).toFixed(2)}`, p.paid_by_name || '—', p.notes || '—' ])
    });
  } else {
    doc.autoTable({
      startY: 28,
      head: [['Period', 'Type', 'Gross', 'Paid', 'Outstanding', 'Status', 'Payslip #']],
      body: data.map(p => [ `${p.period_start}–${p.period_end}`, p.period_type,
        `${currency}${Number(p.gross_amount).toFixed(2)}`, `${currency}${Number(p.amount_paid).toFixed(2)}`,
        `${currency}${Number(p.outstanding_balance).toFixed(2)}`, p.status, p.payslip_number ])
    });
  }
  if (profile) {
    doc.setFontSize(9);
    doc.text(`Owner: ${profile.owner_name}`, 14, doc.lastAutoTable.finalY + 10);
  }
  return doc.output('arraybuffer');
}

function deleteOwnerProfile(actorId, actorName) {
  const profile = getOwnerProfile();
  if (!profile) throw new Error('No owner salary profile to delete');
  const db = getDb();
  db.prepare(`
    DELETE FROM owner_salary_payment_allocations WHERE period_id IN (
      SELECT id FROM owner_salary_periods WHERE profile_id = ?)`).run(profile.id);
  db.prepare('DELETE FROM owner_salary_payments WHERE profile_id = ?').run(profile.id);
  db.prepare('DELETE FROM owner_salary_periods WHERE profile_id = ?').run(profile.id);
  db.prepare('DELETE FROM owner_salary_profile WHERE id = ?').run(profile.id);
  db.prepare(`
    INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, details)
    VALUES (?, ?, ?, ?, ?, ?)`).run(
    actorId, actorName, 'delete_owner_profile', 'owner_salary_profile', profile.id,
    JSON.stringify({ owner_name: profile.owner_name })
  );
  return { success: true };
}

module.exports = {
  getOwnerProfile, saveOwnerProfile, deleteOwnerProfile, syncOwnerSalaryPeriods, ensureCurrentPeriod,
  getOwnerSalaryPeriods, getOwnerSalaryPayments, payOwnerSalary, getOutstandingTotal,
  getOwnerSalaryNotifications, getOwnerSalaryReport, getOwnerDraws, addOwnerDraw, deleteOwnerDraw,
  buildOwnerPayslipPdf, buildOwnerSalaryReportPdf
};

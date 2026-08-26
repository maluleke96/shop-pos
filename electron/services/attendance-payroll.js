const { getDb } = require('../database/db');
const payroll = require('./payroll-compliance');

function parseJson(val, fallback = {}) {
  if (!val) return fallback;
  try { return typeof val === 'string' ? JSON.parse(val) : val; } catch { return fallback; }
}

function defaultWorkSchedule() {
  return {
    pay_type: 'monthly',
    monthly_salary: 0,
    hourly_rate: 0,
    daily_wage: 0,
    expected_hours_per_day: 8,
    expected_days_per_week: 5,
    hours_per_day: 8,
    hours_per_week: 40,
    hours_per_month: 173,
    period_type: 'day',
    bonus_rate: 0,
    max_payment: 0,
    allow_overtime_pay: true,
    allow_hours_beyond_limit: true,
    shift_start: '08:00',
    shift_end: '17:00',
    grace_minutes: 5,
    overtime_rate_multiplier: 1.5,
    weekend_rate_multiplier: 2,
    holiday_rate_multiplier: 2,
    deduct_late: true,
    deduct_early_departure: true,
    deduct_unpaid_absence: true
  };
}

function dayHourLimit(sched) {
  return Number(sched.hours_per_day) || Number(sched.expected_hours_per_day) || 8;
}

function periodHourLimit(sched) {
  const pt = sched.period_type || 'day';
  if (pt === 'week') {
    return Number(sched.hours_per_week) || dayHourLimit(sched) * (Number(sched.expected_days_per_week) || 5);
  }
  if (pt === 'month') {
    return Number(sched.hours_per_month) || dayHourLimit(sched) * (Number(sched.expected_days_per_week) || 5) * 4.33;
  }
  return dayHourLimit(sched);
}

function getEmployeeWorkSchedule(emp) {
  const ws = parseJson(emp?.work_schedule, {});
  const merged = { ...defaultWorkSchedule(), ...ws };
  if (merged.pay_type === 'hourly' && !merged.hourly_rate && emp?.basic_salary) {
    merged.hourly_rate = Number(emp.basic_salary) / (merged.expected_hours_per_day * 22) || 0;
  }
  if (merged.pay_type === 'monthly' && !merged.monthly_salary) {
    merged.monthly_salary = Number(emp?.basic_salary) || 0;
  }
  return merged;
}

function hourlyRateFromSchedule(sched) {
  if (sched.pay_type === 'hourly') return Number(sched.hourly_rate) || 0;
  if (sched.pay_type === 'daily') return (Number(sched.daily_wage) || 0) / (Number(sched.expected_hours_per_day) || 8);
  const monthly = Number(sched.monthly_salary) || 0;
  const hoursPerMonth = (Number(sched.expected_hours_per_day) || 8) * (Number(sched.expected_days_per_week) || 5) * 4.33;
  return hoursPerMonth > 0 ? monthly / hoursPerMonth : 0;
}

function scheduledHoursForDay(sched) {
  return dayHourLimit(sched);
}

function enumerateDates(from, to) {
  const dates = [];
  const d = new Date(from + 'T12:00:00');
  const end = new Date(to + 'T12:00:00');
  while (d <= end) {
    dates.push(d.toLocaleDateString('en-CA'));
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

function calcDayAttendance(emp, att, sched, settings) {
  const hourly = hourlyRateFromSchedule(sched);
  const scheduledH = scheduledHoursForDay(sched);
  const grace = Number(sched.grace_minutes) || 0;
  let worked = Number(att?.hours_worked) || 0;
  let lateMin = Number(att?.late_minutes) || 0;
  let earlyMin = Number(att?.early_departure_minutes) || 0;
  let overtimeMin = Number(att?.overtime_minutes) || 0;
  let breakMin = 0;
  if (att?.break_start && att?.break_end) {
    breakMin = Math.max(0, Math.floor((new Date(att.break_end) - new Date(att.break_start)) / 60000));
  }

  const status = att?.status || 'absent';
  const missedClockIn = att && !att.clock_in && status !== 'absent';
  const missedClockOut = att?.clock_in && !att.clock_out;

  if (!att || status === 'absent') {
    // No attendance row = unpaid absence (unless explicitly marked paid absence)
    const isPaidAbsence = !!att && Number(att.is_paid_absence) === 1;
    const unpaid = !isPaidAbsence && (!!sched.deduct_unpaid_absence || !att);
    const deduction = unpaid ? scheduledH * hourly : 0;
    const normalPay = isPaidAbsence ? scheduledH * hourly : 0;
    return {
      work_date: att?.work_date,
      status: 'absent',
      scheduled_hours: scheduledH,
      hours_worked: 0,
      hours_missed: scheduledH,
      late_minutes: 0,
      early_minutes: 0,
      overtime_hours: 0,
      break_minutes: 0,
      late_deduction: 0,
      early_deduction: 0,
      absence_deduction: deduction,
      overtime_pay: 0,
      normal_pay: normalPay,
      gross: Math.max(0, normalPay - deduction)
    };
  }

  const lateHours = Math.max(0, (lateMin - grace) / 60);
  const earlyHours = Math.max(0, (earlyMin - grace) / 60);
  const allowBeyond = sched.allow_hours_beyond_limit !== false;
  const allowOtPay = sched.allow_overtime_pay !== false;
  const dayLimit = dayHourLimit(sched);
  // Hours used for pay follow admin day limit unless admin allows beyond-limit hours
  const paidWorked = allowBeyond ? worked : Math.min(worked, dayLimit);
  const missedHours = Math.max(0, scheduledH - paidWorked - lateHours - earlyHours);
  const otMult = Number(sched.overtime_rate_multiplier) || Number(settings.overtime_multiplier) || 1.5;
  const bonusRate = Number(sched.bonus_rate) || 0;
  let overtimeHours = 0;
  if (allowOtPay && allowBeyond) {
    overtimeHours = overtimeMin > 0 ? overtimeMin / 60 : Math.max(0, worked - dayLimit);
  }
  const normalHours = Math.min(paidWorked, dayLimit);
  let bonusHours = (allowOtPay && allowBeyond && bonusRate > 0) ? Math.max(0, worked - dayLimit) : 0;
  if (bonusHours > 0) overtimeHours = 0;

  const lateDeduction = sched.deduct_late ? lateHours * hourly : 0;
  const earlyDeduction = sched.deduct_early_departure ? earlyHours * hourly : 0;
  const absenceDeduction = missedHours * hourly;
  const normalPay = normalHours * hourly;
  const bonusPay = bonusHours * bonusRate;
  const overtimePay = bonusHours > 0 ? 0 : overtimeHours * hourly * otMult;
  let gross = normalPay + overtimePay + bonusPay;
  const maxPay = Number(sched.max_payment) || 0;
  if (maxPay > 0) gross = Math.min(gross, maxPay);
  const totalDeduction = lateDeduction + earlyDeduction + absenceDeduction;

  return {
    work_date: att.work_date,
    status: att.status || 'present',
    scheduled_hours: scheduledH,
    hours_worked: Math.round(worked * 100) / 100,
    hours_paid: Math.round(paidWorked * 100) / 100,
    hours_missed: Math.round(missedHours * 100) / 100,
    late_minutes: lateMin,
    early_minutes: earlyMin,
    overtime_hours: Math.round(overtimeHours * 100) / 100,
    bonus_hours: Math.round(bonusHours * 100) / 100,
    bonus_pay: Math.round(bonusPay * 100) / 100,
    break_minutes: breakMin,
    missed_clock_in: missedClockIn,
    missed_clock_out: missedClockOut,
    late_deduction: Math.round(lateDeduction * 100) / 100,
    early_deduction: Math.round(earlyDeduction * 100) / 100,
    absence_deduction: Math.round(absenceDeduction * 100) / 100,
    overtime_pay: Math.round(overtimePay * 100) / 100,
    normal_pay: Math.round(normalPay * 100) / 100,
    max_payment: maxPay || null,
    gross: Math.round(Math.max(0, gross - totalDeduction) * 100) / 100,
    total_deduction: Math.round(totalDeduction * 100) / 100
  };
}

function calculateEmployeePeriodPayroll(employeeId, periodStart, periodEnd) {
  const db = getDb();
  const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(employeeId);
  if (!emp) throw new Error('Employee not found');
  const sched = getEmployeeWorkSchedule(emp);
  const settings = payroll.getPayrollSettings();
  const dates = enumerateDates(periodStart, periodEnd);
  const attendance = db.prepare(`
    SELECT * FROM employee_attendance WHERE employee_id = ? AND work_date >= ? AND work_date <= ?
  `).all(employeeId, periodStart, periodEnd);
  const attByDate = Object.fromEntries(attendance.map(a => [a.work_date, a]));

  const days = [];
  let totals = {
    scheduled_hours: 0, hours_worked: 0, hours_missed: 0, late_minutes: 0,
    early_minutes: 0, overtime_hours: 0, bonus_hours: 0, bonus_pay: 0,
    late_deduction: 0, early_deduction: 0,
    absence_deduction: 0, overtime_pay: 0, normal_pay: 0, gross: 0
  };

  for (const date of dates) {
    const day = calcDayAttendance(emp, attByDate[date], sched, settings);
    day.work_date = date;
    days.push(day);
    totals.scheduled_hours += day.scheduled_hours;
    totals.hours_worked += day.hours_worked;
    totals.hours_missed += day.hours_missed;
    totals.late_minutes += day.late_minutes;
    totals.early_minutes += day.early_minutes || 0;
    totals.overtime_hours += day.overtime_hours;
    totals.bonus_hours += day.bonus_hours || 0;
    totals.bonus_pay += day.bonus_pay || 0;
    totals.late_deduction += day.late_deduction || 0;
    totals.early_deduction += day.early_deduction || 0;
    totals.absence_deduction += day.absence_deduction || 0;
    totals.overtime_pay += day.overtime_pay;
    totals.normal_pay += day.normal_pay;
    totals.gross += day.gross;
  }

  const bonusRate = Number(sched.bonus_rate) || 0;
  const pt = sched.period_type || 'day';
  const allowBeyond = sched.allow_hours_beyond_limit !== false;
  const allowOtPay = sched.allow_overtime_pay !== false;
  if (allowOtPay && allowBeyond && bonusRate > 0 && (pt === 'week' || pt === 'month')) {
    const limit = periodHourLimit(sched);
    const beyond = Math.max(0, totals.hours_worked - limit);
    const dailyBonus = totals.bonus_pay;
    const periodBonus = beyond * bonusRate;
    if (periodBonus > dailyBonus) {
      totals.bonus_pay = Math.round(periodBonus * 100) / 100;
      totals.bonus_hours = Math.round(beyond * 100) / 100;
      totals.overtime_pay = 0;
      totals.gross = totals.normal_pay + totals.bonus_pay;
      days.forEach(d => {
        if ((d.bonus_pay || 0) > 0) {
          totals.gross -= d.bonus_pay;
          d.bonus_pay = 0;
          d.bonus_hours = 0;
        }
      });
      totals.gross = Math.round((totals.normal_pay + totals.bonus_pay - totals.late_deduction - totals.early_deduction - totals.absence_deduction) * 100) / 100;
    }
  }
  if (!allowOtPay) {
    totals.overtime_pay = 0;
    totals.bonus_pay = 0;
    totals.bonus_hours = 0;
    totals.overtime_hours = 0;
    totals.gross = Math.round((totals.normal_pay - totals.late_deduction - totals.early_deduction - totals.absence_deduction) * 100) / 100;
  }
  const maxPay = Number(sched.max_payment) || 0;
  if (maxPay > 0 && totals.gross > maxPay) {
    totals.gross = maxPay;
    totals.max_payment_applied = maxPay;
  }

  const attendanceDeductions = totals.late_deduction + totals.early_deduction + totals.absence_deduction;
  let basicFromAttendance = sched.pay_type === 'monthly'
    ? Math.min(Number(sched.monthly_salary) || Number(emp.basic_salary) || 0, totals.gross + attendanceDeductions)
    : totals.normal_pay;
  let otForStatutory = allowOtPay ? (totals.overtime_pay + totals.bonus_pay) : 0;
  if (maxPay > 0) {
    // Cap combined basic + OT so period pay cannot exceed admin max
    const room = Math.max(0, maxPay - basicFromAttendance);
    if (otForStatutory > room) otForStatutory = room;
    if (basicFromAttendance > maxPay) basicFromAttendance = maxPay;
  }

  const statutory = payroll.calculatePayrollBreakdown({
    ...emp,
    basic_salary: basicFromAttendance,
    overtime_rate: otForStatutory,
    bonus: Number(emp.bonus) || 0,
    commission: Number(emp.commission) || 0,
    allowances: Number(emp.allowances) || 0,
    deductions: (Number(emp.deductions) || 0) + attendanceDeductions
  }, settings);

  return {
    employee_id: employeeId,
    full_name: emp.full_name,
    employee_code: emp.employee_code,
    period_start: periodStart,
    period_end: periodEnd,
    work_schedule: sched,
    days,
    totals: {
      ...totals,
      attendance_deductions: Math.round(attendanceDeductions * 100) / 100
    },
    payroll: statutory,
    net_salary: Math.max(0, statutory.net),
    hourly_rate: hourlyRateFromSchedule(sched)
  };
}

function getPayrollDashboard(filters = {}) {
  const db = getDb();
  const from = filters.from || new Date(Date.now() - 30 * 86400000).toLocaleDateString('en-CA');
  const to = filters.to || new Date().toLocaleDateString('en-CA');
  let emps = db.prepare("SELECT * FROM employees WHERE status = 'Active'").all();
  if (filters.employee_id) emps = emps.filter(e => e.id === parseInt(filters.employee_id, 10));
  if (filters.branch) emps = emps.filter(e => (e.branch || '') === filters.branch);
  return emps.map(emp => {
    const calc = calculateEmployeePeriodPayroll(emp.id, from, to);
    return {
      employee_id: emp.id,
      full_name: emp.full_name,
      branch: emp.branch,
      scheduled_hours: calc.totals.scheduled_hours,
      hours_worked: calc.totals.hours_worked,
      hours_missed: calc.totals.hours_missed,
      late_minutes: calc.totals.late_minutes,
      overtime_hours: calc.totals.overtime_hours,
      gross_pay: calc.payroll.gross,
      attendance_deductions: calc.totals.attendance_deductions,
      total_deductions: calc.payroll.totalDeductions,
      net_salary: calc.net_salary,
      hourly_rate: calc.hourly_rate
    };
  });
}

function saveEmployeeWorkSchedule(employeeId, schedule, actorId, actorName) {
  const db = getDb();
  db.prepare('UPDATE employees SET work_schedule = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .run(JSON.stringify({ ...defaultWorkSchedule(), ...schedule }), employeeId);
  db.prepare(`INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, details) VALUES (?,?,?,?,?,?)`)
    .run(actorId, actorName, 'update_work_schedule', 'employee', employeeId, JSON.stringify(schedule));
  return getEmployeeWorkSchedule(db.prepare('SELECT * FROM employees WHERE id = ?').get(employeeId));
}

function buildHrDocumentHtml(doc, shopSettings = {}) {
  const s = shopSettings;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${doc.title}</title>
    <style>body{font-family:Arial,sans-serif;padding:40px;max-width:800px;margin:0 auto;font-size:13px;line-height:1.5}
    .header{text-align:center;margin-bottom:24px;border-bottom:2px solid #333;padding-bottom:16px}
    .logo{font-size:28px;margin-bottom:8px}.sig{margin-top:40px;display:grid;grid-template-columns:1fr 1fr;gap:24px}
    .sig-box{border-top:1px solid #333;padding-top:8px;margin-top:48px}</style></head><body>
    <div class="header">${s.logo_path ? `<img src="${s.logo_path}" style="max-height:60px">` : `<div class="logo">🏪</div>`}
    <h2>${s.shop_name || 'Company'}</h2>${s.address ? `<p>${s.address}</p>` : ''}${doc.branch ? `<p>Branch: ${doc.branch}</p>` : ''}</div>
    <h3 style="text-align:center;text-transform:uppercase">${doc.title}</h3>
    <p><strong>Date:</strong> ${doc.incident_date || new Date().toLocaleDateString('en-ZA')}</p>
    <p><strong>Employee:</strong> ${doc.employee_name} (${doc.employee_code || ''})</p>
    ${doc.position ? `<p><strong>Position:</strong> ${doc.position}</p>` : ''}
    <div style="margin:24px 0">${doc.content || ''}</div>
    <div class="sig"><div><div class="sig-box">Employee Signature</div></div>
    <div><div class="sig-box">Manager / Supervisor Signature</div></div></div>
    <div class="sig-box" style="max-width:300px">Witness (if applicable)</div>
    </body></html>`;
}

function saveHrDocument(data, actorId, actorName) {
  const db = getDb();
  const emp = db.prepare('SELECT full_name, employee_code, position, branch FROM employees WHERE id = ?').get(data.employee_id);
  const settings = db.prepare('SELECT shop_name, address, logo_path FROM shop_settings WHERE id = 1').get() || {};
  const html = buildHrDocumentHtml({
    ...data,
    employee_name: emp?.full_name,
    employee_code: emp?.employee_code,
    position: emp?.position,
    branch: emp?.branch
  }, settings);
  const r = db.prepare(`
    INSERT INTO employee_hr_documents (employee_id, document_type, title, content, html_content, incident_date, created_by, created_by_name)
    VALUES (?,?,?,?,?,?,?,?)`).run(
    data.employee_id, data.document_type, data.title, data.content || '', html,
    data.incident_date || new Date().toLocaleDateString('en-CA'), actorId, actorName
  );
  db.prepare(`INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, details) VALUES (?,?,?,?,?,?)`)
    .run(actorId, actorName, 'create_hr_document', 'hr_document', r.lastInsertRowid, JSON.stringify({ type: data.document_type, employee_id: data.employee_id }));
  return db.prepare('SELECT * FROM employee_hr_documents WHERE id = ?').get(r.lastInsertRowid);
}

function getHrDocuments(employeeId) {
  return getDb().prepare('SELECT * FROM employee_hr_documents WHERE employee_id = ? ORDER BY created_at DESC').all(employeeId);
}

function getHrDocument(id) {
  return getDb().prepare('SELECT * FROM employee_hr_documents WHERE id = ?').get(id);
}

module.exports = {
  defaultWorkSchedule, getEmployeeWorkSchedule, hourlyRateFromSchedule,
  dayHourLimit, periodHourLimit,
  calculateEmployeePeriodPayroll, getPayrollDashboard, saveEmployeeWorkSchedule,
  buildHrDocumentHtml, saveHrDocument, getHrDocuments, getHrDocument, calcDayAttendance
};

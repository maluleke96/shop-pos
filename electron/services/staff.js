const fs = require('fs');
const { getDb } = require('../database/db');
const { jsPDF } = require('jspdf');
require('jspdf-autotable');
const payroll = require('./payroll-compliance');
const attendancePayroll = require('./attendance-payroll');
const hrPdf = require('./hr-pdf');
const { hashPin, verifyPin, verifyPinWithUpgrade } = require('./pin');

function today() {
  return new Date().toLocaleDateString('en-CA');
}

function addDaysIso(dateStr, n) {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString('en-CA');
}

function yesterday() {
  return addDaysIso(today(), -1);
}

function jsDayToMonBased(jsDay) {
  return (jsDay + 6) % 7;
}

function scheduleTimeToDate(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;
  const t = String(timeStr).length === 5 ? `${timeStr}:00` : String(timeStr);
  const dt = new Date(`${dateStr}T${t}`);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function isOvernightSched(sched) {
  if (!sched?.start_time || !sched?.end_time) return false;
  return String(sched.end_time).slice(0, 5) <= String(sched.start_time).slice(0, 5);
}

function scheduleWindow(sched) {
  if (!sched) return { start: null, end: null, overnight: false };
  const start = scheduleTimeToDate(sched.shift_date, sched.start_time);
  let end = scheduleTimeToDate(sched.shift_date, sched.end_time);
  const overnight = isOvernightSched(sched);
  if (start && end && overnight) end = new Date(end.getTime() + 24 * 60 * 60 * 1000);
  return { start, end, overnight };
}

function defaultWorkDaysFromSchedule(ws) {
  if (Array.isArray(ws?.work_days) && ws.work_days.length) return ws.work_days;
  const n = Math.min(7, Math.max(1, Number(ws?.expected_days_per_week) || 5));
  return Array.from({ length: n }, (_, i) => i);
}

/** Generated shift row, or virtual hours from employee work_schedule when admin never generated shifts. */
function getEmployeeScheduleForDate(employeeId, dateStr) {
  const row = getDb().prepare(
    'SELECT * FROM employee_schedules WHERE employee_id = ? AND shift_date = ?'
  ).get(employeeId, dateStr);
  if (row) return row.is_rest_day ? null : row;
  const emp = getDb().prepare('SELECT work_schedule FROM employees WHERE id = ?').get(employeeId);
  if (!emp) return null;
  const ws = attendancePayroll.getEmployeeWorkSchedule({ work_schedule: emp.work_schedule });
  if (!ws.shift_start || !ws.shift_end) return null;
  const monDay = jsDayToMonBased(new Date(`${dateStr}T12:00:00`).getDay());
  if (!defaultWorkDaysFromSchedule(ws).includes(monDay)) return null;
  return {
    employee_id: employeeId,
    shift_date: dateStr,
    shift_name: 'Default hours',
    start_time: ws.shift_start,
    end_time: ws.shift_end,
    is_rest_day: 0,
    _from_work_schedule: true
  };
}

function getActiveShiftContext(employeeId, now = new Date()) {
  const d = today();
  const y = yesterday();
  const yestSched = getEmployeeScheduleForDate(employeeId, y);
  if (yestSched && isOvernightSched(yestSched)) {
    const { start, end } = scheduleWindow(yestSched);
    if (end && now <= end) return { workDate: y, sched: yestSched, start, end };
  }
  const todaySched = getEmployeeScheduleForDate(employeeId, d);
  if (todaySched) {
    const { start, end } = scheduleWindow(todaySched);
    return { workDate: d, sched: todaySched, start, end };
  }
  return null;
}

function attendanceWorkDate(employeeId) {
  return getActiveShiftContext(employeeId)?.workDate || today();
}

function assertSessionCanAccessEmployee(employeeId) {
  const session = require('./session');
  const empSess = session.getEmployeeSession();
  if (empSess?.employee_id != null) {
    if (Number(empSess.employee_id) !== Number(employeeId)) throw new Error('Authentication required');
    return;
  }
  if (!session.getUserSession()?.id) throw new Error('Authentication required');
}

function calcNetSalary(emp) {
  const basic = Number(emp.basic_salary) || 0;
  const ot = Number(emp.overtime_rate) || 0;
  const bonus = Number(emp.bonus) || 0;
  const comm = Number(emp.commission) || 0;
  const allow = Number(emp.allowances) || 0;
  const deduct = Number(emp.deductions) || 0;
  return Math.max(0, basic + ot + bonus + comm + allow - deduct);
}

function nextEmployeeCode() {
  const row = getDb().prepare('SELECT COUNT(*) as c FROM employees').get();
  const n = (row?.c || 0) + 1;
  return `EMP${String(n).padStart(4, '0')}`;
}

function sanitizeEmployee(emp) {
  if (!emp) return emp;
  const { pin, ...safe } = emp;
  return { ...safe, has_pin: !!pin };
}

function getEmployees(filters = {}) {
  let sql = 'SELECT * FROM employees WHERE 1=1';
  const params = [];
  if (filters.search) {
    sql += ' AND (full_name LIKE ? OR employee_code LIKE ? OR phone LIKE ? OR position LIKE ?)';
    const q = `%${filters.search}%`;
    params.push(q, q, q, q);
  }
  if (filters.position) { sql += ' AND position = ?'; params.push(filters.position); }
  if (filters.status) { sql += ' AND status = ?'; params.push(filters.status); }
  sql += ' ORDER BY full_name';
  return getDb().prepare(sql).all(...params).map(sanitizeEmployee);
}

function getEmployee(id) {
  const emp = getDb().prepare('SELECT * FROM employees WHERE id = ?').get(id);
  if (!emp) return null;
  let workSchedule = attendancePayroll.defaultWorkSchedule();
  if (emp.work_schedule) {
    try {
      workSchedule = { ...workSchedule, ...JSON.parse(emp.work_schedule) };
    } catch (_) {}
  }
  return sanitizeEmployee({ ...emp, work_schedule: workSchedule, net_salary: calcNetSalary(emp) });
}

function getEmployeeByCode(code) {
  const c = String(code || '').trim();
  if (!c) return null;
  return getDb().prepare('SELECT * FROM employees WHERE lower(employee_code) = lower(?)').get(c);
}

function verifyEmployeePin(employeeId, pin) {
  const emp = getDb().prepare('SELECT id, pin, status, full_name, employee_code FROM employees WHERE id = ?').get(employeeId);
  if (!emp) throw new Error('Employee not found');
  if (emp.status !== 'Active') throw new Error('Employee account is not active');
  if (!emp.pin) throw new Error('No PIN set for this employee');
  const check = verifyPinWithUpgrade(emp.pin, pin);
  if (!check.ok) throw new Error('Incorrect PIN');
  if (check.needsUpgrade && check.hash) {
    try { getDb().prepare('UPDATE employees SET pin = ? WHERE id = ?').run(check.hash, emp.id); } catch (_) { /* ignore */ }
  }
  return emp;
}

function verifyEmployeeCodePin(code, pin) {
  const session = require('./session');
  const emp = getEmployeeByCode(code);
  if (!emp) throw new Error('Employee ID not found');
  verifyEmployeePin(emp.id, pin);
  const full = getEmployee(emp.id);
  // Shift lock applies to clock-in only — portal login must still open for payslips, leave, HR.
  session.setEmployeeSession({
    employee_id: full.id,
    user_id: full.user_id || null,
    full_name: full.full_name,
    employee_code: full.employee_code
  });
  return sanitizeEmployee(full);
}

/** Owner/manager/supervisor opens a worker portal without the employee PIN. */
function adminOpenEmployeePortal(employeeId, actor) {
  const { assertUserActor } = require('./authz');
  assertUserActor(actor, ['owner', 'manager', 'supervisor', 'assistant_manager']);
  const emp = getEmployee(employeeId);
  if (!emp) throw new Error('Employee not found');
  const session = require('./session');
  session.setEmployeeSession({
    employee_id: emp.id,
    user_id: emp.user_id || null,
    full_name: emp.full_name,
    employee_code: emp.employee_code,
    pinVerified: true,
    adminOverride: true
  });
  return sanitizeEmployee(emp);
}

/**
 * Validate employee ↔ user ↔ branch ↔ role ↔ schedule linkage before save.
 * Hard errors block save; warnings are returned for the admin UI.
 */
function validateEmployeeLinks(data = {}) {
  const errors = [];
  const warnings = [];
  const db = getDb();
  const status = data.status || 'Active';
  const isActive = status === 'Active';
  const empId = data.id ? Number(data.id) : 0;

  if (!data.full_name?.trim()) errors.push('Employee full name is required');

  const code = (data.employee_code || '').trim();
  if (code) {
    const dup = db.prepare('SELECT id, full_name FROM employees WHERE employee_code = ? AND id != ?').get(code, empId || 0);
    if (dup) errors.push(`Employee ID "${code}" is already used by ${dup.full_name}`);
  } else if (!empId) {
    warnings.push('Employee ID will be auto-generated');
  }

  const userId = data.user_id != null && data.user_id !== '' ? parseInt(data.user_id, 10) : null;
  if (userId) {
    const user = db.prepare('SELECT id, username, full_name, role, is_active, permissions FROM users WHERE id = ?').get(userId);
    if (!user) {
      errors.push('Linked user account was not found — select a valid POS user or clear the link');
    } else {
      if (Number(user.is_active) === 0) {
        errors.push(`Linked user "${user.username}" is inactive — reactivate the user or choose another account`);
      }
      const other = db.prepare('SELECT id, full_name, employee_code FROM employees WHERE user_id = ? AND id != ?')
        .get(userId, empId || 0);
      if (other) {
        errors.push(`User "${user.username}" is already linked to ${other.full_name} (${other.employee_code})`);
      }
      if (!user.role) warnings.push('Linked user has no role assigned');
    }
  } else if (isActive) {
    warnings.push('No POS user account linked — staff can still use Employee ID + PIN in Staff Portal, but cashier login will not open their portal automatically');
  }

  if (isActive && !(data.branch || '').trim()) {
    warnings.push('Branch is not set — assign a branch so schedules and reports stay correct');
  }
  if (isActive && !(data.position || '').trim()) {
    warnings.push('Position/role title is not set');
  }

  if (empId) {
    const existing = db.prepare('SELECT pin, work_schedule FROM employees WHERE id = ?').get(empId);
    if (existing && !existing.pin && !data.pin) {
      errors.push('Employee PIN is missing — set a PIN so Staff Portal login works');
    }
    let hasSchedule = false;
    if (existing?.work_schedule) {
      try {
        const ws = typeof existing.work_schedule === 'string' ? JSON.parse(existing.work_schedule) : existing.work_schedule;
        hasSchedule = !!(ws && (ws.shift_start || ws.hours_per_day || ws.pay_type));
      } catch (_) { /* ignore */ }
    }
    if (data.work_schedule) {
      const ws = typeof data.work_schedule === 'string' ? JSON.parse(data.work_schedule) : data.work_schedule;
      hasSchedule = !!(ws && (ws.shift_start || ws.hours_per_day || ws.pay_type));
    }
    try {
      const upcoming = db.prepare(`
        SELECT COUNT(*) AS c FROM employee_schedules
        WHERE employee_id = ? AND date(shift_date) >= date('now') AND COALESCE(is_rest_day, 0) = 0`).get(empId);
      if (isActive && !hasSchedule && !(upcoming?.c > 0)) {
        warnings.push('No work schedule / upcoming shifts — clock-in will fail until shifts are assigned (Admin → Staff → Shifts)');
      }
    } catch (_) {
      if (isActive && !hasSchedule) {
        warnings.push('No work schedule — clock-in will fail until shifts are assigned (Admin → Staff → Shifts)');
      }
    }
  } else if (isActive && !data.pin) {
    warnings.push('PIN will be auto-generated if left blank — share it with the employee securely');
  }

  return { ok: errors.length === 0, errors, warnings };
}

function saveEmployee(data, actorId) {
  const linkCheck = validateEmployeeLinks(data);
  if (!linkCheck.ok) {
    throw new Error(linkCheck.errors.join(' · '));
  }
  if (!data.full_name?.trim()) throw new Error('Full name is required');
  // Empty date/text fields from forms must be null (Postgres rejects '' for some casts)
  for (const k of ['date_of_birth', 'date_hired', 'payment_date', 'photo_path', 'email', 'phone', 'address']) {
    if (data[k] === '') data[k] = null;
  }
  const net = calcNetSalary(data);
  let pin = data.pin ? String(data.pin).trim() : null;
  if (!data.id && !pin) {
    pin = String(Math.floor(1000 + Math.random() * 9000));
    data.pin = pin;
  }
  const pinStored = pin ? hashPin(pin) : null;
  if (data.id) {
    const existing = getEmployee(data.id);
    if (!existing) throw new Error('Employee not found');
    getDb().prepare(`
      UPDATE employees SET employee_code=?, full_name=?, photo_path=?, phone=?, email=?, address=?,
        id_number=?, date_of_birth=?, gender=?, emergency_contact=?, emergency_phone=?,
        position=?, department=?, branch=?, date_hired=?, employment_type=?, status=?,
        salary_type=?, basic_salary=?, overtime_rate=?, bonus=?, commission=?, allowances=?, deductions=?,
        tax_number=?, uif_number=?, bank_name=?, bank_account=?, pension_contribution=?, medical_aid_contribution=?,
        paye_registered=?, uif_registered=?, pension_registered=?, medical_registered=?, sdl_registered=?,
        payment_date=?, pin=COALESCE(?, pin), leave_annual=?, leave_sick=?, leave_family=?, notes=?, user_id=?, updated_at=datetime('now')
      WHERE id=?`).run(
      data.employee_code || existing.employee_code, data.full_name.trim(), data.photo_path || null,
      data.phone || null, data.email || null, data.address || null, data.id_number || null,
      data.date_of_birth || null, data.gender || null, data.emergency_contact || null, data.emergency_phone || null,
      data.position || null, data.department || null, data.branch || null, data.date_hired || null,
      data.employment_type || 'Permanent', data.status || 'Active', data.salary_type || 'Monthly',
      Number(data.basic_salary) || 0, Number(data.overtime_rate) || 0, Number(data.bonus) || 0,
      Number(data.commission) || 0, Number(data.allowances) || 0, Number(data.deductions) || 0,
      data.tax_number || null, data.uif_number || null, data.bank_name || null, data.bank_account || null,
      Number(data.pension_contribution) || 0, Number(data.medical_aid_contribution) || 0,
      data.paye_registered ? 1 : 0, data.uif_registered ? 1 : 0, data.pension_registered ? 1 : 0,
      data.medical_registered ? 1 : 0, data.sdl_registered ? 1 : 0,
      data.payment_date || null, pinStored,
      data.leave_annual != null ? Number(data.leave_annual) : 15,
      data.leave_sick != null ? Number(data.leave_sick) : 10,
      data.leave_family != null ? Number(data.leave_family) : 3,
      data.notes || null, data.user_id || null, data.id
    );
    const saved = getEmployee(data.id);
    return { ...saved, _link_warnings: linkCheck.warnings };
  }
  const code = data.employee_code?.trim() || nextEmployeeCode();
  const dup = getDb().prepare('SELECT id FROM employees WHERE employee_code = ?').get(code);
  if (dup) throw new Error('Employee ID already exists');
  const r = getDb().prepare(`
    INSERT INTO employees (employee_code, full_name, photo_path, phone, email, address, id_number, date_of_birth,
      gender, emergency_contact, emergency_phone, position, department, branch, date_hired, employment_type, status,
      salary_type, basic_salary, overtime_rate, bonus, commission, allowances, deductions,
      tax_number, uif_number, bank_name, bank_account, pension_contribution, medical_aid_contribution,
      paye_registered, uif_registered, pension_registered, medical_registered, sdl_registered,
      payment_date, pin, leave_annual, leave_sick, leave_family, notes, user_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    code, data.full_name.trim(), data.photo_path || null, data.phone || null, data.email || null, data.address || null,
    data.id_number || null, data.date_of_birth || null, data.gender || null, data.emergency_contact || null,
    data.emergency_phone || null, data.position || null, data.department || null, data.branch || null,
    data.date_hired || today(), data.employment_type || 'Permanent', data.status || 'Active',
    data.salary_type || 'Monthly', Number(data.basic_salary) || 0, Number(data.overtime_rate) || 0,
    Number(data.bonus) || 0, Number(data.commission) || 0, Number(data.allowances) || 0, Number(data.deductions) || 0,
    data.tax_number || null, data.uif_number || null, data.bank_name || null, data.bank_account || null,
    Number(data.pension_contribution) || 0, Number(data.medical_aid_contribution) || 0,
    data.paye_registered ? 1 : 0, data.uif_registered ? 1 : 0, data.pension_registered ? 1 : 0,
    data.medical_registered ? 1 : 0, data.sdl_registered ? 1 : 0,
    data.payment_date || null, pinStored,
    data.leave_annual != null ? Number(data.leave_annual) : 15,
    data.leave_sick != null ? Number(data.leave_sick) : 10,
    data.leave_family != null ? Number(data.leave_family) : 3,
    data.notes || null, data.user_id || null
  );
  const saved = getEmployee(r.lastInsertRowid);
  return { ...saved, _link_warnings: linkCheck.warnings, _generated_pin: !data.id && pin ? pin : undefined };
}

function deleteEmployee(id, actorId, actorName) {
  const emp = getEmployee(id);
  if (!emp) throw new Error('Employee not found');
  getDb().prepare('DELETE FROM employees WHERE id = ?').run(id);
  if (actorId) {
    getDb().prepare(`
      INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, details)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(actorId, actorName || 'system', 'delete_employee', 'employees', id, JSON.stringify(emp.full_name));
  }
}

function getTodayAttendance(employeeId) {
  try { autoCloseOpenAttendance(employeeId); } catch (_) { /* ignore */ }
  const open = getDb().prepare(`
    SELECT * FROM employee_attendance
    WHERE employee_id = ? AND clock_in IS NOT NULL AND (clock_out IS NULL OR clock_out = '')
    ORDER BY work_date DESC, id DESC LIMIT 1`).get(employeeId);
  if (open) return open;
  const d = attendanceWorkDate(employeeId);
  return getDb().prepare('SELECT * FROM employee_attendance WHERE employee_id = ? AND work_date = ? ORDER BY id DESC LIMIT 1')
    .get(employeeId, d);
}

function assertCanClockIn(employeeId) {
  const now = new Date();
  const ctx = getActiveShiftContext(employeeId, now);
  const workDate = ctx?.workDate || today();
  const onLeave = getDb().prepare(`
    SELECT 1 FROM employee_leave WHERE employee_id = ? AND status = 'approved'
    AND date(?) BETWEEN date(start_date) AND date(COALESCE(end_date, start_date))`).get(employeeId, workDate);
  if (onLeave) throw new Error('You are on approved leave — clock-in is not allowed.');

  const ps = getLeavePortalSettings();
  // Admin turned off shift enforcement — staff may clock in/out without assigned shifts
  if (ps.require_scheduled_shift === false) {
    return ctx || { workDate, sched: null };
  }

  if (!ctx?.sched) {
    throw new Error('You can only clock in on your scheduled shift day. Ask admin to assign a shift (Admin → Staff → Shifts) or set default hours on your employee profile.');
  }
  const { start, end } = ctx;
  if (start && now < new Date(start.getTime() - 60 * 60000)) {
    throw new Error(`Clock-in opens 60 minutes before your shift (${ctx.sched.start_time}).`);
  }
  if (end && now > end) {
    throw new Error(`Your shift ended at ${ctx.sched.end_time}. Clock-in is closed.`);
  }
  return ctx;
}

function autoCloseOpenAttendance(employeeId) {
  const db = getDb();
  const now = new Date();
  let sql = `
    SELECT a.*, e.full_name
    FROM employee_attendance a
    JOIN employees e ON e.id = a.employee_id
    WHERE a.clock_in IS NOT NULL AND (a.clock_out IS NULL OR a.clock_out = '')
  `;
  const params = [];
  if (employeeId != null && employeeId !== '') {
    sql += ' AND a.employee_id = ?';
    params.push(parseInt(employeeId, 10));
  }
  const openRows = db.prepare(sql).all(...params);
  for (const row of openRows) {
    const sched = getEmployeeScheduleForDate(row.employee_id, row.work_date);
    if (!sched) continue;
    const { end } = scheduleWindow(sched);
    if (!end || now < end) continue;
    const outIso = end.toISOString();
    if (row.break_start && !row.break_end) {
      db.prepare('UPDATE employee_attendance SET break_end = ? WHERE id = ?').run(outIso, row.id);
    }
    const note = `[Auto-closed at shift end ${sched.end_time} — failed to clock out]`;
    db.prepare(`UPDATE employee_attendance SET clock_out = ?, auto_closed = 1, status = CASE WHEN status = 'present' THEN 'auto_closed' ELSE status END,
      notes = TRIM(COALESCE(notes,'') || char(10) || ?) WHERE id = ?`).run(outIso, note, row.id);
    applyAttendanceScheduleVariance(row.id, row.employee_id);
    recalcAttendanceHours(row.id);
    try {
      require('./store').addNotification('attendance_auto_close', 'Missed clock-out',
        `${row.full_name} was auto clocked out at shift end (${sched.end_time}). Admin may apply a penalty.`, {
          entity_type: 'employee_attendance',
          entity_id: row.id,
          action_page: 'staffhr:attendance',
          audience_roles: ['owner', 'manager', 'supervisor', 'assistant_manager']
        });
    } catch (_) { /* ignore */ }
  }
}

function performClockAction(employeeId, action, clientRequestId) {
  autoCloseOpenAttendance(employeeId);
  const nowIso = new Date().toISOString();
  const db = getDb();
  const reqId = clientRequestId ? String(clientRequestId).slice(0, 80) : null;
  const openRow = db.prepare(`
    SELECT * FROM employee_attendance
    WHERE employee_id = ? AND clock_in IS NOT NULL AND (clock_out IS NULL OR clock_out = '')
    ORDER BY work_date DESC, id DESC LIMIT 1`).get(employeeId);
  const d = (action === 'clock_in' ? (getActiveShiftContext(employeeId)?.workDate || today())
    : (openRow?.work_date || attendanceWorkDate(employeeId)));

  if (reqId) {
    try {
      const prior = db.prepare(`
        SELECT a.*, e.full_name, e.employee_code FROM employee_attendance a
        JOIN employees e ON e.id = a.employee_id
        WHERE a.employee_id = ? AND a.work_date = ? AND a.client_request_id = ?`).get(employeeId, d, reqId);
      if (prior) return prior;
    } catch (_) { /* column may not exist on very old DBs until migration */ }
  }

  let row = action === 'clock_in'
    ? db.prepare('SELECT * FROM employee_attendance WHERE employee_id = ? AND work_date = ? ORDER BY id DESC LIMIT 1').get(employeeId, d)
    : (openRow || db.prepare('SELECT * FROM employee_attendance WHERE employee_id = ? AND work_date = ? ORDER BY id DESC LIMIT 1').get(employeeId, d));
  if (!row) {
    const ins = db.prepare(`INSERT INTO employee_attendance (employee_id, work_date, status) VALUES (?,?, 'present')`).run(employeeId, d);
    row = db.prepare('SELECT * FROM employee_attendance WHERE id = ?').get(ins.lastInsertRowid);
  }
  const id = row.id;
  row = db.prepare('SELECT * FROM employee_attendance WHERE id = ?').get(id) || row;

  if (action === 'clock_in') {
    if (row.clock_in) throw new Error('Already clocked in today');
    assertCanClockIn(employeeId);
    try {
      db.prepare('UPDATE employee_attendance SET clock_in = ?, status = ?, client_request_id = COALESCE(?, client_request_id) WHERE id = ? AND clock_in IS NULL')
        .run(nowIso, 'present', reqId, id);
    } catch (_) {
      db.prepare('UPDATE employee_attendance SET clock_in = ?, status = ? WHERE id = ? AND clock_in IS NULL').run(nowIso, 'present', id);
    }
    const after = db.prepare('SELECT clock_in FROM employee_attendance WHERE id = ?').get(id);
    if (!after?.clock_in) throw new Error('Already clocked in today');
  } else if (action === 'clock_out') {
    if (!row.clock_in) throw new Error('Clock in first');
    if (row.clock_out) throw new Error('Already clocked out');
    if (row.break_start && !row.break_end) {
      db.prepare('UPDATE employee_attendance SET break_end = ? WHERE id = ?').run(nowIso, id);
    }
    try {
      db.prepare('UPDATE employee_attendance SET clock_out = ?, client_request_id = COALESCE(?, client_request_id) WHERE id = ? AND (clock_out IS NULL OR clock_out = \'\')')
        .run(nowIso, reqId, id);
    } catch (_) {
      db.prepare('UPDATE employee_attendance SET clock_out = ? WHERE id = ? AND (clock_out IS NULL OR clock_out = \'\')').run(nowIso, id);
    }
    const after = db.prepare('SELECT clock_out FROM employee_attendance WHERE id = ?').get(id);
    if (!after?.clock_out) throw new Error('Already clocked out');
  } else if (action === 'break_start') {
    if (!row.clock_in) throw new Error('Clock in first');
    if (row.clock_out) throw new Error('Already clocked out');
    if (row.break_start && !row.break_end) throw new Error('Break already started');
    db.prepare('UPDATE employee_attendance SET break_start = ?, break_end = NULL WHERE id = ?').run(nowIso, id);
  } else if (action === 'break_end') {
    if (!row.break_start) throw new Error('Start break first');
    if (row.break_end) throw new Error('Break already ended');
    db.prepare('UPDATE employee_attendance SET break_end = ? WHERE id = ?').run(nowIso, id);
  } else throw new Error('Unknown action');
  applyAttendanceScheduleVariance(id, employeeId);
  recalcAttendanceHours(id);
  return db.prepare(`
    SELECT a.*, e.full_name, e.employee_code FROM employee_attendance a
    JOIN employees e ON e.id = a.employee_id WHERE a.id = ?`).get(id);
}

function clockAction(employeeId, action, pin, clientRequestId) {
  verifyEmployeePin(employeeId, pin);
  return performClockAction(employeeId, action, clientRequestId);
}

function clockActionVerified(employeeId, action, clientRequestId) {
  return performClockAction(employeeId, action, clientRequestId);
}

function recalcHours(attendanceId) {
  const row = getDb().prepare('SELECT * FROM employee_attendance WHERE id = ?').get(attendanceId);
  if (!row?.clock_in || !row?.clock_out) return;
  let ms = new Date(row.clock_out) - new Date(row.clock_in);
  if (row.break_start && row.break_end) ms -= Math.max(0, new Date(row.break_end) - new Date(row.break_start));
  const hours = Math.max(0, ms / 3600000);
  getDb().prepare('UPDATE employee_attendance SET hours_worked = ? WHERE id = ?').run(Math.round(hours * 100) / 100, attendanceId);
}

function recalcAttendanceHours(attendanceId) {
  recalcHours(attendanceId);
  const row = getDb().prepare('SELECT * FROM employee_attendance WHERE id = ?').get(attendanceId);
  if (!row) return;
  applyAttendanceScheduleVariance(attendanceId, row.employee_id);
  const emp = getDb().prepare('SELECT * FROM employees WHERE id = ?').get(row.employee_id);
  if (!emp) return;
  const updated = getDb().prepare('SELECT * FROM employee_attendance WHERE id = ?').get(attendanceId);
  const workSched = attendancePayroll.getEmployeeWorkSchedule(emp);
  const settings = payroll.getPayrollSettings();
  const calc = attendancePayroll.calcDayAttendance(emp, updated, workSched, settings);
  getDb().prepare('UPDATE employee_attendance SET scheduled_hours = ?, hours_worked = ?, overtime_minutes = ? WHERE id = ?')
    .run(calc.scheduled_hours, calc.hours_worked, Math.round((calc.overtime_hours || 0) * 60), attendanceId);
}

function enrichAttendanceRow(row) {
  const emp = getDb().prepare('SELECT * FROM employees WHERE id = ?').get(row.employee_id);
  if (!emp) return row;
  const workSched = attendancePayroll.getEmployeeWorkSchedule(emp);
  const settings = payroll.getPayrollSettings();
  const calc = attendancePayroll.calcDayAttendance(emp, row, workSched, settings);
  return {
    ...row,
    full_name: row.full_name || emp.full_name,
    branch: row.branch || emp.branch,
    scheduled_hours: calc.scheduled_hours,
    hours_worked: calc.hours_worked ?? row.hours_worked ?? 0,
    hours_missed: calc.hours_missed,
    late_minutes: calc.late_minutes ?? row.late_minutes ?? 0,
    early_departure_minutes: calc.early_minutes ?? row.early_departure_minutes ?? 0,
    overtime_minutes: row.overtime_minutes || Math.round((calc.overtime_hours || 0) * 60),
    status: row.status || calc.status
  };
}

function getAttendance(filters = {}) {
  let sql = `SELECT a.*, e.full_name, e.employee_code, e.position, e.branch,
    u.full_name AS edited_by_name, cu.full_name AS created_by_user_name
    FROM employee_attendance a
    JOIN employees e ON e.id = a.employee_id
    LEFT JOIN users u ON u.id = a.edited_by
    LEFT JOIN users cu ON cu.id = a.created_by
    WHERE 1=1`;
  const params = [];
  if (filters.employee_id) { sql += ' AND a.employee_id = ?'; params.push(filters.employee_id); }
  if (filters.branch) { sql += ' AND e.branch = ?'; params.push(filters.branch); }
  if (filters.from) { sql += ' AND a.work_date >= ?'; params.push(filters.from); }
  if (filters.to) { sql += ' AND a.work_date <= ?'; params.push(filters.to); }
  sql += ' ORDER BY a.work_date DESC, a.clock_in DESC LIMIT 500';
  let rows = getDb().prepare(sql).all(...params).map(enrichAttendanceRow);

  if (filters.include_scheduled !== false && filters.from && filters.to) {
    const existing = new Set(rows.map(r => `${r.employee_id}:${r.work_date}`));
    let schedSql = `SELECT s.employee_id, s.shift_date, e.full_name, e.branch FROM employee_schedules s
      JOIN employees e ON e.id = s.employee_id
      WHERE s.is_rest_day = 0 AND s.shift_date >= ? AND s.shift_date <= ? AND e.status = 'Active'`;
    const schedParams = [filters.from, filters.to];
    if (filters.employee_id) { schedSql += ' AND s.employee_id = ?'; schedParams.push(filters.employee_id); }
    if (filters.branch) { schedSql += ' AND e.branch = ?'; schedParams.push(filters.branch); }
    const shifts = getDb().prepare(schedSql).all(...schedParams);
    for (const sh of shifts) {
      const key = `${sh.employee_id}:${sh.shift_date}`;
      if (existing.has(key)) continue;
      const emp = getDb().prepare('SELECT * FROM employees WHERE id = ?').get(sh.employee_id);
      if (!emp) continue;
      const workSched = attendancePayroll.getEmployeeWorkSchedule(emp);
      const settings = payroll.getPayrollSettings();
      const calc = attendancePayroll.calcDayAttendance(emp, null, workSched, settings);
      rows.push({
        id: null,
        employee_id: sh.employee_id,
        work_date: sh.shift_date,
        clock_in: null,
        clock_out: null,
        full_name: sh.full_name,
        branch: sh.branch,
        status: 'absent',
        scheduled_hours: calc.scheduled_hours,
        hours_worked: 0,
        hours_missed: calc.hours_missed,
        late_minutes: 0,
        overtime_minutes: 0,
        scheduled_only: true
      });
      existing.add(key);
    }
    rows.sort((a, b) => (b.work_date || '').localeCompare(a.work_date || '')
      || (a.full_name || '').localeCompare(b.full_name || ''));
  }
  return rows;
}

function updateAttendance(id, data, actorId, actorName) {
  const row = getDb().prepare('SELECT * FROM employee_attendance WHERE id = ?').get(id);
  if (!row) throw new Error('Attendance record not found');
  const allowed = ['clock_in', 'clock_out', 'break_start', 'break_end', 'status', 'late_minutes', 'early_departure_minutes',
    'overtime_minutes', 'hours_worked', 'is_paid_absence', 'notes'];
  const updates = {};
  for (const key of allowed) {
    if (data[key] !== undefined) {
      updates[key] = key === 'is_paid_absence' ? (data[key] ? 1 : 0) : data[key];
    }
  }
  if (!Object.keys(updates).length) return getAttendance({ employee_id: row.employee_id, from: row.work_date, to: row.work_date })[0];
  const setClause = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  getDb().prepare(`UPDATE employee_attendance SET ${setClause}, edited_by = ?, edited_at = datetime('now') WHERE id = ?`)
    .run(...Object.values(updates), actorId, id);
  if (data.hours_worked == null) recalcAttendanceHours(id);
  applyAttendanceScheduleVariance(id, row.employee_id);
  getDb().prepare(`INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, details) VALUES (?,?,?,?,?,?)`)
    .run(actorId, actorName, 'update_attendance', 'employee_attendance', id, JSON.stringify(updates));
  return getDb().prepare(`
    SELECT a.*, e.full_name, e.employee_code, e.position, e.branch, u.full_name AS edited_by_name
    FROM employee_attendance a
    JOIN employees e ON e.id = a.employee_id
    LEFT JOIN users u ON u.id = a.edited_by
    WHERE a.id = ?`).get(id);
}

function deleteAttendance(id, actor) {
  const { assertUserActor } = require('./authz');
  const user = assertUserActor(actor, ['owner', 'manager']);
  const row = getDb().prepare('SELECT * FROM employee_attendance WHERE id = ?').get(id);
  if (!row) throw new Error('Attendance record not found');
  getDb().prepare('DELETE FROM attendance_penalties WHERE attendance_id = ?').run(id);
  getDb().prepare('DELETE FROM employee_attendance WHERE id = ?').run(id);
  getDb().prepare(`INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, details) VALUES (?,?,?,?,?,?)`)
    .run(user.id, user.username || user.full_name || 'manager', 'delete_attendance', 'employee_attendance', id,
      JSON.stringify({ employee_id: row.employee_id, work_date: row.work_date }));
  return { ok: true, id };
}

function createManualAttendance(data, actor) {
  const { assertUserActor } = require('./authz');
  const user = assertUserActor(actor, ['owner', 'manager']);
  if (!data.employee_id) throw new Error('Employee required');
  if (!data.work_date) throw new Error('Work date required');
  const emp = getDb().prepare('SELECT * FROM employees WHERE id = ?').get(data.employee_id);
  if (!emp) throw new Error('Employee not found');
  const existing = getDb().prepare('SELECT id FROM employee_attendance WHERE employee_id = ? AND work_date = ?')
    .get(data.employee_id, data.work_date);
  if (existing) throw new Error('Attendance already exists for that date — edit the existing record');
  let hours = data.hours_worked != null ? Number(data.hours_worked) : null;
  if (hours == null && data.clock_in && data.clock_out) {
    let ms = new Date(data.clock_out) - new Date(data.clock_in);
    if (data.break_start && data.break_end) ms -= Math.max(0, new Date(data.break_end) - new Date(data.break_start));
    hours = Math.max(0, Math.round((ms / 3600000) * 100) / 100);
  }
  const noteTag = `[Admin entry by ${user.full_name || user.username} at ${new Date().toISOString()}]`;
  const notes = [data.notes || '', noteTag].filter(Boolean).join('\n');
  const r = getDb().prepare(`
    INSERT INTO employee_attendance (employee_id, work_date, clock_in, clock_out, break_start, break_end,
      hours_worked, status, notes, admin_entered, created_by, created_by_name, edited_by, edited_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`).run(
    data.employee_id, data.work_date,
    data.clock_in || null, data.clock_out || null,
    data.break_start || null, data.break_end || null,
    hours || 0, data.status || 'present', notes,
    1, user.id, user.full_name || user.username, user.id
  );
  const id = r.lastInsertRowid;
  if (hours == null || data.hours_worked == null) recalcAttendanceHours(id);
  else applyAttendanceScheduleVariance(id, data.employee_id);
  getDb().prepare(`INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, details) VALUES (?,?,?,?,?,?)`)
    .run(user.id, user.username, 'create_attendance', 'employee_attendance', id, JSON.stringify({ work_date: data.work_date, hours }));
  return getDb().prepare(`
    SELECT a.*, e.full_name, e.employee_code, e.position, e.branch FROM employee_attendance a
    JOIN employees e ON e.id = a.employee_id WHERE a.id = ?`).get(id);
}

function addAttendancePenalty(data, actor) {
  const { assertUserActor } = require('./authz');
  const user = assertUserActor(actor, ['owner', 'manager']);
  if (!data.employee_id) throw new Error('Employee required');
  if (!['money', 'hours'].includes(data.penalty_type)) throw new Error('Penalty type must be money or hours');
  const amount = Number(data.amount);
  if (!(amount > 0)) throw new Error('Penalty amount must be greater than zero');
  const r = getDb().prepare(`
    INSERT INTO attendance_penalties (employee_id, attendance_id, work_date, penalty_type, amount, reason, status, created_by, created_by_name)
    VALUES (?,?,?,?,?,?, 'pending', ?, ?)`).run(
    data.employee_id, data.attendance_id || null, data.work_date || today(),
    data.penalty_type, amount, data.reason || 'Missed clock-out penalty',
    user.id, user.full_name || user.username
  );
  try {
    require('./store').addNotification('attendance_penalty', 'Attendance penalty issued',
      `Penalty for employee #${data.employee_id}: ${data.penalty_type === 'money' ? 'R' + amount : amount + 'h'} — applies on next payroll.`, {
        entity_type: 'attendance_penalty',
        entity_id: r.lastInsertRowid,
        action_page: 'staffhr:attendance',
        audience_roles: ['owner', 'manager']
      });
  } catch (_) { /* ignore */ }
  return getDb().prepare('SELECT * FROM attendance_penalties WHERE id = ?').get(r.lastInsertRowid);
}

function getAttendancePenalties(filters = {}) {
  let sql = `SELECT p.*, e.full_name, e.employee_code FROM attendance_penalties p
    JOIN employees e ON e.id = p.employee_id WHERE 1=1`;
  const params = [];
  if (filters.employee_id) { sql += ' AND p.employee_id = ?'; params.push(filters.employee_id); }
  if (filters.status) { sql += ' AND p.status = ?'; params.push(filters.status); }
  sql += ' ORDER BY p.created_at DESC LIMIT 200';
  return getDb().prepare(sql).all(...params);
}

function cancelAttendancePenalty(id, actor) {
  const { assertUserActor } = require('./authz');
  assertUserActor(actor, ['owner', 'manager']);
  getDb().prepare(`UPDATE attendance_penalties SET status = 'cancelled' WHERE id = ? AND status = 'pending'`).run(id);
  return getDb().prepare('SELECT * FROM attendance_penalties WHERE id = ?').get(id);
}

function applyPendingPenaltiesToPayroll(employeeId, payrollId, hourlyRate) {
  const pending = getDb().prepare(`
    SELECT * FROM attendance_penalties WHERE employee_id = ? AND status = 'pending'`).all(employeeId);
  let moneyTotal = 0;
  let hoursTotal = 0;
  for (const p of pending) {
    if (p.penalty_type === 'money') moneyTotal += Number(p.amount) || 0;
    else hoursTotal += Number(p.amount) || 0;
  }
  const hoursMoney = hoursTotal * (Number(hourlyRate) || 0);
  const total = Math.round((moneyTotal + hoursMoney) * 100) / 100;
  if (total > 0) {
    payroll.savePayrollDeductions(payrollId, [{
      type: 'attendance_penalty', id: null, amount: total,
      description: `Clock-out / attendance penalties (${moneyTotal ? `R${moneyTotal.toFixed(2)}` : ''}${moneyTotal && hoursTotal ? ' + ' : ''}${hoursTotal ? `${hoursTotal}h` : ''})`
    }], false);
    getDb().prepare(`UPDATE attendance_penalties SET status = 'applied', applied_payroll_id = ? WHERE employee_id = ? AND status = 'pending'`)
      .run(payrollId, employeeId);
  }
  return total;
}

function getAttendanceSummary(employeeId, from, to) {
  try { autoCloseOpenAttendance(employeeId); } catch (_) { /* ignore */ }
  const rows = getAttendance({ employee_id: employeeId, from, to, include_scheduled: false });
  const totalHours = rows.reduce((s, r) => s + (Number(r.hours_worked) || 0), 0);
  const byDate = {};
  for (const r of rows) {
    byDate[r.work_date] = (byDate[r.work_date] || 0) + (Number(r.hours_worked) || 0);
  }
  return {
    from, to,
    days: rows,
    daily_totals: byDate,
    total_hours: Math.round(totalHours * 100) / 100,
    days_worked: rows.filter(r => r.clock_in).length
  };
}

function isSickLeaveType(leaveType) {
  return /sick/i.test(String(leaveType || ''));
}

function getLeavePortalSettings() {
  const row = getDb().prepare('SELECT staff_portal_settings FROM shop_settings WHERE id = 1').get();
  let ps = {};
  try { ps = JSON.parse(row?.staff_portal_settings || '{}'); } catch (_) {}
  return {
    leave_requests_open: ps.leave_requests_open !== false,
    leave_types: ps.leave_types || ['Annual Leave', 'Sick Leave', 'Family Responsibility', 'Unpaid Leave'],
    leave_requires_approval: ps.leave_requires_approval !== false,
    min_leave_notice_days: ps.min_leave_notice_days ?? 1,
    max_leave_requests_per_month: ps.max_leave_requests_per_month ?? null,
    max_leave_requests_per_year: ps.max_leave_requests_per_year ?? null,
    leave_blackouts: Array.isArray(ps.leave_blackouts) ? ps.leave_blackouts : [],
    require_login_selfie: !!ps.require_login_selfie,
    show_disciplinary: ps.show_disciplinary !== false,
    show_payslips: ps.show_payslips !== false,
    require_disciplinary_response: ps.require_disciplinary_response !== false,
    show_routines: ps.show_routines !== false,
    show_morning_routines: ps.show_morning_routines !== false,
    show_closing_routines: ps.show_closing_routines !== false,
    show_shifts: ps.show_shifts !== false,
    require_scheduled_shift: ps.require_scheduled_shift !== false,
    show_hr_docs: ps.show_hr_docs !== false,
    show_company_rules: ps.show_company_rules !== false
  };
}

function eachDateInRange(startDate, endDate, fn) {
  const start = new Date(`${startDate}T12:00:00`);
  const end = new Date(`${(endDate || startDate)}T12:00:00`);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    fn(d.toLocaleDateString('en-CA'));
  }
}

function isDateInLeaveBlackout(dateStr, blackouts) {
  return (blackouts || []).some(b => {
    const from = b.start_date;
    const to = b.end_date || b.start_date;
    return dateStr >= from && dateStr <= to;
  });
}

function isLeaveRangeBlocked(startDate, endDate, blackouts) {
  let blocked = false;
  eachDateInRange(startDate, endDate, (d) => {
    if (isDateInLeaveBlackout(d, blackouts)) blocked = true;
  });
  return blocked;
}

function countLeaveRequestsForMonth(employeeId, yearMonth, excludeSick = true, excludeId = null) {
  // PG-safe month match (also covered by strftime rewriter)
  let sql = `SELECT COUNT(*) as c FROM employee_leave WHERE employee_id = ?
    AND status IN ('pending', 'approved') AND to_char(start_date::timestamp, 'YYYY-MM') = ?`;
  const params = [employeeId, yearMonth];
  if (excludeSick) sql += " AND leave_type NOT LIKE '%sick%'";
  if (excludeId) { sql += ' AND id != ?'; params.push(excludeId); }
  return getDb().prepare(sql).get(...params).c || 0;
}

function countLeaveRequestsForYear(employeeId, year, excludeSick = true, excludeId = null) {
  let sql = `SELECT COUNT(*) as c FROM employee_leave WHERE employee_id = ?
    AND status IN ('pending', 'approved') AND to_char(start_date::timestamp, 'YYYY') = ?`;
  const params = [employeeId, String(year)];
  if (excludeSick) sql += " AND leave_type NOT LIKE '%sick%'";
  if (excludeId) { sql += ' AND id != ?'; params.push(excludeId); }
  return getDb().prepare(sql).get(...params).c || 0;
}

function validateLeaveRequest(data) {
  const ps = getLeavePortalSettings();
  const leaveType = data.leave_type;
  const sick = isSickLeaveType(leaveType);
  const start = data.start_date;
  const end = data.end_date || data.start_date;
  if (!data.employee_id || !leaveType || !start) throw new Error('Employee, leave type and start date required');

  if (!sick) {
    if (!ps.leave_requests_open) {
      throw new Error('Leave requests are currently closed by admin. You may still submit sick leave.');
    }
    if (isLeaveRangeBlocked(start, end, ps.leave_blackouts)) {
      throw new Error('Leave is blocked for the selected dates (admin blackout). Sick leave is still allowed.');
    }
    const minNotice = Number(ps.min_leave_notice_days) || 0;
    if (minNotice > 0 && !data.id) {
      const diff = (new Date(`${start}T12:00:00`) - new Date()) / 86400000;
      if (diff < minNotice) throw new Error(`Leave must be requested at least ${minNotice} day(s) in advance`);
    }
    const ym = start.slice(0, 7);
    const maxMonth = Number(ps.max_leave_requests_per_month);
    if (maxMonth > 0) {
      const count = countLeaveRequestsForMonth(data.employee_id, ym, true, data.id || null);
      if (count >= maxMonth) throw new Error(`Maximum ${maxMonth} non-sick leave request(s) per month reached`);
    }
    const maxYear = Number(ps.max_leave_requests_per_year);
    if (maxYear > 0) {
      const count = countLeaveRequestsForYear(data.employee_id, start.slice(0, 4), true, data.id || null);
      if (count >= maxYear) throw new Error(`Maximum ${maxYear} non-sick leave request(s) per year reached`);
    }
  }
  return ps;
}

function getLeavePolicyForEmployee(employeeId) {
  const ps = getLeavePortalSettings();
  const d = today();
  const ym = d.slice(0, 7);
  const year = d.slice(0, 4);
  const activeBlackouts = (ps.leave_blackouts || []).filter(b => {
    const to = b.end_date || b.start_date;
    return to >= d;
  });
  return {
    ...ps,
    sick_leave_always_allowed: true,
    requests_this_month: countLeaveRequestsForMonth(employeeId, ym, true),
    requests_this_year: countLeaveRequestsForYear(employeeId, year, true),
    active_blackouts: activeBlackouts
  };
}

function getLeave(employeeId) {
  return getDb().prepare('SELECT * FROM employee_leave WHERE employee_id = ? ORDER BY created_at DESC').all(employeeId);
}

function getAllLeave(status) {
  let sql = `SELECT l.*, e.full_name, e.employee_code FROM employee_leave l JOIN employees e ON e.id = l.employee_id`;
  if (status) { sql += ' WHERE l.status = ?'; return getDb().prepare(sql + ' ORDER BY l.created_at DESC').all(status); }
  return getDb().prepare(sql + ' ORDER BY l.created_at DESC').all();
}

function isLeaveManager(actor) {
  if (!actor?.id) return false;
  try {
    const { assertUserActor } = require('./authz');
    assertUserActor(actor, ['owner', 'manager', 'supervisor', 'assistant_manager']);
    return true;
  } catch {
    return false;
  }
}

function assertLeaveBalance(employeeId, leaveType, days) {
  const bal = getLeaveBalance(employeeId);
  const type = String(leaveType || '').toLowerCase();
  let bucket = null;
  if (type.includes('annual')) bucket = bal.annual;
  else if (type.includes('sick')) bucket = bal.sick;
  else if (type.includes('family')) bucket = bal.family;
  if (bucket && Number(bucket.total) > 0) {
    const remaining = Number(bucket.total) - Number(bucket.used || 0);
    if (Number(days) > remaining + 0.001) {
      throw new Error(`Insufficient leave balance (remaining ${remaining} days)`);
    }
  }
}

function attachLeaveApprovalPdf(id, byId, approverLabel) {
  const db = getDb();
  const row = db.prepare(`
    SELECT l.*, e.full_name, e.employee_code FROM employee_leave l
    JOIN employees e ON e.id = l.employee_id WHERE l.id = ?`).get(id);
  if (!row) throw new Error('Leave request not found');
  const now = new Date().toISOString();
  const shop = hrPdf.getShopPdfSettings();
  const buf = hrPdf.buildLeaveApprovalPdf({ ...row, approved_at: now }, shop, approverLabel || 'Management');
  const pdfPath = hrPdf.savePdfBuffer(buf, `leave-${id}`);
  db.prepare(`UPDATE employee_leave SET status = 'approved', approved_by = ?, approved_at = ?, pdf_path = ? WHERE id = ?`)
    .run(byId || null, now, pdfPath, id);
  return db.prepare('SELECT * FROM employee_leave WHERE id = ?').get(id);
}

function saveLeave(data, actor) {
  validateLeaveRequest(data);
  const end = data.end_date || data.start_date;
  const manager = isLeaveManager(actor);
  const needsApproval = getLeavePortalSettings().leave_requires_approval !== false;
  const status = manager && data.status
    ? data.status
    : (needsApproval ? 'pending' : 'approved');
  const days = Number(data.days) || 1;
  if (status === 'approved') assertLeaveBalance(data.employee_id, data.leave_type, days);
  let id = data.id;
  if (data.id) {
    getDb().prepare(`UPDATE employee_leave SET leave_type=?, start_date=?, end_date=?, days=?, status=?, notes=? WHERE id=?`)
      .run(data.leave_type, data.start_date, end, days, status, data.notes || null, data.id);
  } else {
    const r = getDb().prepare(`INSERT INTO employee_leave (employee_id, leave_type, start_date, end_date, days, status, notes)
      VALUES (?,?,?,?,?,?,?)`).run(data.employee_id, data.leave_type, data.start_date, end, days, status, data.notes || null);
    id = r.lastInsertRowid;
  }
  if (status === 'approved') {
    return attachLeaveApprovalPdf(id, actor?.id || null, actor?.full_name || actor?.username || 'Management');
  }
  return getDb().prepare('SELECT * FROM employee_leave WHERE id = ?').get(id);
}

function approveLeave(id, approvedBy, approve = true, approverName, actor) {
  if (actor) {
    const { assertUserActor } = require('./authz');
    assertUserActor(actor, ['owner', 'manager', 'supervisor', 'assistant_manager']);
  } else if (approvedBy) {
    const { assertUserActor } = require('./authz');
    assertUserActor({ id: approvedBy }, ['owner', 'manager', 'supervisor', 'assistant_manager']);
  } else {
    throw new Error('Authentication required');
  }
  const db = getDb();
  const row = db.prepare(`
    SELECT l.*, e.full_name, e.employee_code FROM employee_leave l
    JOIN employees e ON e.id = l.employee_id WHERE l.id = ?`).get(id);
  if (!row) throw new Error('Leave request not found');
  const now = new Date().toISOString();
  const byId = actor?.id || approvedBy;
  if (approve) {
    assertLeaveBalance(row.employee_id, row.leave_type, row.days);
    const approver = approverName || db.prepare('SELECT full_name, username FROM users WHERE id = ?').get(byId);
    const approverLabel = (typeof approver === 'string' ? approver : null)
      || approver?.full_name || approver?.username || 'Management';
    return attachLeaveApprovalPdf(id, byId, approverLabel);
  }
  db.prepare(`UPDATE employee_leave SET status = 'rejected', approved_by = ?, approved_at = ? WHERE id = ?`)
    .run(byId, now, id);
  return db.prepare('SELECT * FROM employee_leave WHERE id = ?').get(id);
}

function buildLeavePdf(leaveId) {
  const row = getDb().prepare(`
    SELECT l.*, e.full_name, e.employee_code FROM employee_leave l
    JOIN employees e ON e.id = l.employee_id WHERE l.id = ?`).get(leaveId);
  if (!row) throw new Error('Leave request not found');
  if (row.pdf_path && fs.existsSync(row.pdf_path)) {
    return fs.readFileSync(row.pdf_path);
  }
  if (row.status !== 'approved') throw new Error('Leave PDF is only available for approved leave');
  const shop = hrPdf.getShopPdfSettings();
  const approver = row.approved_by
    ? getDb().prepare('SELECT full_name, username FROM users WHERE id = ?').get(row.approved_by)
    : null;
  return hrPdf.buildLeaveApprovalPdf(row, shop, approver?.full_name || approver?.username || 'Management');
}

function submitLeaveProof(leaveId, employeeId, imageData) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM employee_leave WHERE id = ? AND employee_id = ?').get(leaveId, employeeId);
  if (!row) throw new Error('Leave request not found');
  if (row.status !== 'approved') throw new Error('Proof can only be submitted for approved leave');
  const endDate = row.end_date || row.start_date;
  if (endDate > today()) throw new Error('Proof can be submitted after your leave ends');
  const proofPath = hrPdf.saveProofImage(imageData, leaveId);
  db.prepare(`UPDATE employee_leave SET proof_path = ?, proof_submitted_at = datetime('now'),
    proof_confirmed_by = NULL, proof_confirmed_at = NULL WHERE id = ?`).run(proofPath, leaveId);
  return db.prepare('SELECT * FROM employee_leave WHERE id = ?').get(leaveId);
}

function confirmLeaveProof(leaveId, actorId) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM employee_leave WHERE id = ?').get(leaveId);
  if (!row) throw new Error('Leave request not found');
  if (!row.proof_path) throw new Error('No proof submitted for this leave');
  db.prepare(`UPDATE employee_leave SET proof_confirmed_by = ?, proof_confirmed_at = datetime('now') WHERE id = ?`)
    .run(actorId, leaveId);
  return db.prepare('SELECT * FROM employee_leave WHERE id = ?').get(leaveId);
}

function getPendingLeaveProofs() {
  return getDb().prepare(`
    SELECT l.*, e.full_name, e.employee_code FROM employee_leave l
    JOIN employees e ON e.id = l.employee_id
    WHERE l.proof_path IS NOT NULL AND l.proof_confirmed_at IS NULL
    ORDER BY l.proof_submitted_at DESC`).all();
}

function leaveNeedsProof(row) {
  if (!row || row.status !== 'approved') return false;
  const endDate = row.end_date || row.start_date;
  if (endDate > today()) return false;
  return /sick/i.test(row.leave_type || '') || !row.proof_confirmed_at;
}

function getLeaveBalance(employeeId) {
  const emp = getEmployee(employeeId);
  if (!emp) return null;
  const used = getDb().prepare(`
    SELECT leave_type, COALESCE(SUM(days),0) as used FROM employee_leave
    WHERE employee_id = ? AND status = 'approved' GROUP BY leave_type`).all(employeeId);
  const map = {};
  used.forEach(u => { map[u.leave_type] = u.used; });
  return {
    annual: { total: emp.leave_annual, used: map['Annual'] || map['Annual Leave'] || 0 },
    sick: { total: emp.leave_sick, used: map['Sick'] || map['Sick Leave'] || 0 },
    family: { total: emp.leave_family, used: map['Family'] || map['Family Responsibility'] || 0 }
  };
}

function getMissedClockOutInbox(filters = {}) {
  const db = getDb();
  const days = Math.max(1, Math.min(90, Number(filters.days) || 21));
  const open = db.prepare(`
    SELECT a.*, e.full_name, e.employee_code, e.branch, e.phone, e.position
    FROM employee_attendance a
    JOIN employees e ON e.id = a.employee_id
    WHERE e.status = 'Active'
      AND a.clock_in IS NOT NULL
      AND (a.clock_out IS NULL OR a.clock_out = '')
    ORDER BY a.work_date DESC, a.clock_in DESC
    LIMIT 300`).all();
  const autoClosed = db.prepare(`
    SELECT a.*, e.full_name, e.employee_code, e.branch, e.phone, e.position
    FROM employee_attendance a
    JOIN employees e ON e.id = a.employee_id
    WHERE e.status = 'Active'
      AND a.auto_closed = 1
      AND date(a.work_date) >= date('now', ?)
      AND IFNULL(a.notes, '') NOT LIKE '%Auto-close reviewed OK%'
    ORDER BY a.work_date DESC, a.id DESC
    LIMIT 200`).all(`-${days} days`);

  const now = new Date();
  const enrich = (row, kind) => {
    const sched = getEmployeeScheduleForDate(row.employee_id, row.work_date);
    const { end } = sched ? scheduleWindow(sched) : { end: null };
    const shiftEnded = !!(end && now >= end);
    const hoursOpen = row.clock_in
      ? Math.max(0, Math.round(((now - new Date(row.clock_in)) / 3600000) * 10) / 10)
      : 0;
    return {
      ...row,
      inbox_kind: kind,
      scheduled_end: sched?.end_time || null,
      shift_ended: shiftEnded,
      hours_open: hoursOpen,
      needs_action: kind === 'open' || kind === 'auto_closed'
    };
  };

  const rows = [
    ...open.map(r => enrich(r, 'open')),
    ...autoClosed.map(r => enrich(r, 'auto_closed'))
  ];
  // Prefer open; de-dupe by id
  const seen = new Set();
  const unique = [];
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    unique.push(r);
  }
  unique.sort((a, b) => {
    if (a.inbox_kind !== b.inbox_kind) return a.inbox_kind === 'open' ? -1 : 1;
    return String(b.work_date).localeCompare(String(a.work_date));
  });
  return unique;
}

function resolveMissedClockOut(id, action, actor) {
  const { assertUserActor } = require('./authz');
  const user = assertUserActor(actor, ['owner', 'manager', 'supervisor', 'assistant_manager']);
  const row = getDb().prepare(`
    SELECT a.*, e.full_name FROM employee_attendance a
    JOIN employees e ON e.id = a.employee_id WHERE a.id = ?`).get(id);
  if (!row) throw new Error('Attendance record not found');

  if (action === 'clock_out_now') {
    if (row.clock_out) throw new Error('Already clocked out');
    const nowIso = new Date().toISOString();
    if (row.break_start && !row.break_end) {
      getDb().prepare('UPDATE employee_attendance SET break_end = ? WHERE id = ?').run(nowIso, id);
    }
    const note = `[Admin clock-out now by ${user.full_name || user.username} at ${nowIso}]`;
    getDb().prepare(`UPDATE employee_attendance SET clock_out = ?, edited_by = ?, edited_at = datetime('now'),
      notes = TRIM(COALESCE(notes,'') || char(10) || ?) WHERE id = ?`)
      .run(nowIso, user.id, note, id);
    recalcAttendanceHours(id);
    applyAttendanceScheduleVariance(id, row.employee_id);
  } else if (action === 'clock_out_shift_end') {
    if (row.clock_out && !row.auto_closed) throw new Error('Already clocked out');
    const sched = getEmployeeScheduleForDate(row.employee_id, row.work_date);
    if (!sched) throw new Error('No schedule for that day — use Clock out now or Edit');
    const { end } = scheduleWindow(sched);
    if (!end) throw new Error('Schedule has no end time');
    const outIso = end.toISOString();
    if (row.break_start && !row.break_end) {
      getDb().prepare('UPDATE employee_attendance SET break_end = ? WHERE id = ?').run(outIso, id);
    }
    const note = `[Admin closed at shift end ${sched.end_time} by ${user.full_name || user.username}]`;
    getDb().prepare(`UPDATE employee_attendance SET clock_out = ?, auto_closed = 1,
      status = CASE WHEN status = 'present' THEN 'auto_closed' ELSE status END,
      edited_by = ?, edited_at = datetime('now'),
      notes = TRIM(COALESCE(notes,'') || char(10) || ?) WHERE id = ?`)
      .run(outIso, user.id, note, id);
    recalcAttendanceHours(id);
    applyAttendanceScheduleVariance(id, row.employee_id);
  } else if (action === 'dismiss_auto_close') {
    getDb().prepare(`UPDATE employee_attendance SET notes = TRIM(COALESCE(notes,'') || char(10) || ?),
      edited_by = ?, edited_at = datetime('now') WHERE id = ?`)
      .run(`[Auto-close reviewed OK by ${user.full_name || user.username}]`, user.id, id);
  } else {
    throw new Error('Unknown action');
  }

  getDb().prepare(`INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, details) VALUES (?,?,?,?,?,?)`)
    .run(user.id, user.username || user.full_name, 'resolve_missed_clock_out', 'employee_attendance', id,
      JSON.stringify({ action, work_date: row.work_date, employee_id: row.employee_id }));

  return getDb().prepare(`
    SELECT a.*, e.full_name, e.employee_code, e.branch FROM employee_attendance a
    JOIN employees e ON e.id = a.employee_id WHERE a.id = ?`).get(id);
}

function previewPayroll(periodStart, periodEnd, filters = {}) {
  if (!periodStart || !periodEnd) throw new Error('Select period start and end dates');
  if (String(periodEnd) < String(periodStart)) throw new Error('Period end must be on or after period start');
  const db = getDb();
  let emps = getEmployees({ status: 'Active' });
  if (filters.employee_id) emps = emps.filter(e => e.id === parseInt(filters.employee_id, 10));
  if (filters.branch) emps = emps.filter(e => (e.branch || '') === filters.branch);
  return emps.map(emp => {
    const calc = attendancePayroll.calculateEmployeePeriodPayroll(emp.id, periodStart, periodEnd);
    const sched = calc.work_schedule || {};
    const existing = db.prepare(`
      SELECT id, status, net_salary FROM employee_payroll
      WHERE employee_id = ? AND period_start = ? AND period_end = ?`).get(emp.id, periodStart, periodEnd);
    const maxPay = Number(sched.max_payment) || 0;
    const flags = [];
    if (maxPay > 0 && (calc.totals.max_payment_applied || calc.totals.gross >= maxPay)) {
      flags.push(`Max pay cap R${maxPay.toFixed(2)}`);
    }
    if (sched.allow_overtime_pay === false) flags.push('OT pay off');
    if (sched.allow_hours_beyond_limit === false) flags.push('Hours capped');
    if (Number(calc.totals.overtime_hours || 0) > 0 && sched.allow_overtime_pay !== false) {
      flags.push(`OT ${Number(calc.totals.overtime_hours).toFixed(1)}h`);
    }
    if (existing) flags.push(existing.status === 'paid' ? 'Already paid' : 'Already generated');
    return {
      employee_id: emp.id,
      full_name: emp.full_name,
      employee_code: emp.employee_code,
      branch: emp.branch,
      period_start: periodStart,
      period_end: periodEnd,
      scheduled_hours: calc.totals.scheduled_hours,
      hours_worked: calc.totals.hours_worked,
      hours_missed: calc.totals.hours_missed,
      late_minutes: calc.totals.late_minutes,
      overtime_hours: calc.totals.overtime_hours,
      overtime_pay: calc.totals.overtime_pay,
      attendance_deductions: calc.totals.attendance_deductions,
      gross_pay: calc.payroll.gross,
      total_deductions: calc.payroll.totalDeductions,
      net_salary: calc.net_salary,
      max_payment: maxPay || null,
      allow_overtime_pay: sched.allow_overtime_pay !== false,
      allow_hours_beyond_limit: sched.allow_hours_beyond_limit !== false,
      already_generated: !!existing,
      existing_payroll_id: existing?.id || null,
      existing_status: existing?.status || null,
      flags
    };
  });
}

function getPayroll(employeeId) {
  return getDb().prepare('SELECT * FROM employee_payroll WHERE employee_id = ? ORDER BY period_end DESC').all(employeeId);
}

function generatePayroll(periodStart, periodEnd, employeeIds) {
  if (!periodStart || !periodEnd) throw new Error('Select period start and end dates');
  if (String(periodEnd) < String(periodStart)) throw new Error('Period end must be on or after period start');
  const emps = employeeIds?.length
    ? employeeIds.map(id => getEmployee(id)).filter(Boolean)
    : getEmployees({ status: 'Active' });
  if (!emps.length) throw new Error('No active employees to generate payroll for');
  const results = [];
  const errors = [];
  for (const emp of emps) {
    try {
      const existing = getDb().prepare(`
        SELECT id FROM employee_payroll WHERE employee_id = ? AND period_start = ? AND period_end = ?`).get(emp.id, periodStart, periodEnd);
      if (existing) {
        results.push(getDb().prepare('SELECT * FROM employee_payroll WHERE id = ?').get(existing.id));
        continue;
      }
      const attCalc = attendancePayroll.calculateEmployeePeriodPayroll(emp.id, periodStart, periodEnd);
      const calc = attCalc.payroll;
      const r = getDb().prepare(`
        INSERT INTO employee_payroll (employee_id, period_start, period_end, basic_salary, overtime_pay, bonus, commission,
          allowances, deductions, net_salary, gross_salary, paye, uif_employee, uif_employer, sdl, coida,
          advance_recovery, loan_recovery, damage_recovery, pension_deduction, medical_deduction, other_deductions,
          scheduled_hours, hours_worked, hours_missed, late_minutes, overtime_hours, attendance_deductions, attendance_json, status)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        emp.id, periodStart, periodEnd, calc.basic, attCalc.totals.overtime_pay || calc.overtime, calc.bonus, calc.commission,
        calc.allowances, calc.totalDeductions, attCalc.net_salary, calc.gross, calc.paye, calc.uifEmployee, calc.uifEmployer,
        calc.sdl, calc.coida, calc.advanceRecovery, calc.loanRecovery, calc.damageRecovery,
        calc.pensionDeduction, calc.medicalDeduction, calc.otherDeductions,
        attCalc.totals.scheduled_hours, attCalc.totals.hours_worked, attCalc.totals.hours_missed,
        attCalc.totals.late_minutes, attCalc.totals.overtime_hours, attCalc.totals.attendance_deductions,
        JSON.stringify(attCalc), 'pending'
      );
      const payrollId = r.lastInsertRowid;
      payroll.savePayrollDeductions(payrollId, calc.deductionItems, false);
      payroll.savePayrollDeductions(payrollId, calc.employerItems, true);
      if (attCalc.totals.attendance_deductions > 0) {
        payroll.savePayrollDeductions(payrollId, [{
          type: 'attendance', id: null, amount: attCalc.totals.attendance_deductions,
          description: 'Late / early / absence deductions'
        }], false);
      }
      const penaltyAmt = applyPendingPenaltiesToPayroll(emp.id, payrollId, attCalc.hourly_rate);
      const cashoutPenalty = applyPendingCashoutPenaltiesToPayroll(emp.id, payrollId);
      const extraPenalty = (penaltyAmt || 0) + (cashoutPenalty || 0);
      if (extraPenalty > 0) {
        getDb().prepare(`UPDATE employee_payroll SET deductions = deductions + ?, net_salary = max(0, net_salary - ?),
          attendance_deductions = COALESCE(attendance_deductions,0) + ? WHERE id = ?`)
          .run(extraPenalty, extraPenalty, extraPenalty, payrollId);
      }
      results.push(getDb().prepare('SELECT * FROM employee_payroll WHERE id = ?').get(payrollId));
    } catch (err) {
      errors.push(`${emp.full_name || emp.id}: ${err.message || err}`);
    }
  }
  if (!results.length && errors.length) {
    throw new Error(errors.slice(0, 3).join('; '));
  }
  if (errors.length) {
    console.error('[generatePayroll] partial failures:', errors);
  }
  // Open salary claim window + notify so Staff Portal can claim / see payslips
  try {
    const payroll = require('./payroll-compliance');
    const settings = payroll.getPayrollSettings?.() || {};
    const deadlineDays = Number(settings.claim_deadline_days) || 7;
    const deadline = new Date();
    deadline.setDate(deadline.getDate() + deadlineDays);
    const claimDeadline = deadline.toISOString();
    const claims = require('./salary-claims').createClaimsFromPayroll(
      periodStart, periodEnd, claimDeadline, periodEnd, null, null, 'payroll-generate'
    );
    try {
      require('./store').addNotification?.('salary_advice', 'Payslips & salary claims ready',
        `Payroll ${periodStart} – ${periodEnd}: ${results.length} payslip(s), ${claims?.length || 0} claim window(s) opened for Staff Portal.`, {
          entity_type: 'payroll',
          action_page: 'admin:payroll',
          audience_roles: ['owner', 'manager']
        });
    } catch (_) { /* */ }
  } catch (err) {
    console.warn('[generatePayroll] salary claims auto-open skipped:', err.message || err);
  }
  return results;
}

function applyPendingCashoutPenaltiesToPayroll(employeeId, payrollId) {
  const pending = getDb().prepare(`
    SELECT * FROM cashout_penalties WHERE employee_id = ? AND status = 'pending'`).all(employeeId);
  const total = Math.round(pending.reduce((s, p) => s + (Number(p.amount) || 0), 0) * 100) / 100;
  if (total > 0) {
    payroll.savePayrollDeductions(payrollId, [{
      type: 'cashout_penalty', id: null, amount: total,
      description: `Late POS cash-out penalty (${pending.length} incident(s))`
    }], false);
    getDb().prepare(`UPDATE cashout_penalties SET status = 'applied', applied_payroll_id = ? WHERE employee_id = ? AND status = 'pending'`)
      .run(payrollId, employeeId);
  }
  return total;
}

function paySalary(payrollId, paymentMethod) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM employee_payroll WHERE id = ?').get(payrollId);
  if (!row) throw new Error('Payroll record not found');
  if (row.status === 'paid') throw new Error('This payroll record has already been marked as paid');
  const deductions = payroll.getPayrollDeductions(payrollId);
  const advanceItems = deductions.filter(d => d.deduction_type === 'advance' && !d.is_employer).map(d => ({
    id: d.reference_id, amount: d.amount
  }));
  const loanItems = deductions.filter(d => d.deduction_type === 'loan' && !d.is_employer).map(d => ({
    id: d.reference_id, amount: d.amount
  }));
  const damageItems = deductions.filter(d => d.deduction_type === 'damage' && !d.is_employer).map(d => ({
    id: d.reference_id, amount: d.amount
  }));
  db.transaction(() => {
    payroll.applyRecoveries(row.employee_id, advanceItems, loanItems, damageItems);
    db.prepare(`UPDATE employee_payroll SET status = 'paid', payment_method = ?, paid_at = datetime('now') WHERE id = ?`)
      .run(paymentMethod || 'cash', payrollId);
  })();
  try {
    const { runIntegration } = require('./accounting-central');
    runIntegration('postFromPayroll', payrollId);
  } catch (err) {
    console.warn('[payroll] accounting post:', err.message);
  }
}

function getEmployeeByUserId(userId) {
  const uid = parseInt(userId, 10);
  if (!uid) return null;
  const emp = getDb().prepare('SELECT * FROM employees WHERE user_id = ? AND status = ?').get(uid, 'Active');
  if (!emp) return null;
  return { ...emp, net_salary: calcNetSalary(emp) };
}

function getSchedules(from, to, employeeId) {
  let sql = `SELECT s.*, e.full_name, e.employee_code FROM employee_schedules s JOIN employees e ON e.id = s.employee_id WHERE 1=1`;
  const params = [];
  if (from) { sql += ' AND s.shift_date >= ?'; params.push(from); }
  if (to) { sql += ' AND s.shift_date <= ?'; params.push(to); }
  if (employeeId != null && employeeId !== '') {
    sql += ' AND s.employee_id = ?';
    params.push(parseInt(employeeId, 10));
  }
  const rows = getDb().prepare(sql + ' ORDER BY s.shift_date, s.start_time').all(...params);
  if (employeeId == null || employeeId === '' || !from || !to) return rows;
  const empId = parseInt(employeeId, 10);
  const existing = new Set(rows.map(r => r.shift_date));
  const emp = getDb().prepare('SELECT full_name, employee_code, work_schedule FROM employees WHERE id = ?').get(empId);
  const ws = attendancePayroll.getEmployeeWorkSchedule({ work_schedule: emp?.work_schedule });
  const workDays = defaultWorkDaysFromSchedule(ws);
  const d = new Date(`${from}T12:00:00`);
  const end = new Date(`${to}T12:00:00`);
  while (d <= end) {
    const dateStr = d.toLocaleDateString('en-CA');
    if (!existing.has(dateStr) && ws.shift_start && ws.shift_end) {
      const monDay = jsDayToMonBased(d.getDay());
      if (workDays.includes(monDay)) {
        rows.push({
          employee_id: empId,
          shift_date: dateStr,
          shift_name: 'Default hours',
          start_time: ws.shift_start,
          end_time: ws.shift_end,
          is_rest_day: 0,
          _from_work_schedule: true,
          full_name: emp?.full_name,
          employee_code: emp?.employee_code,
          id: null
        });
      }
    }
    d.setDate(d.getDate() + 1);
  }
  rows.sort((a, b) => String(a.shift_date).localeCompare(String(b.shift_date))
    || String(a.start_time || '').localeCompare(String(b.start_time || '')));
  return rows;
}

function saveSchedule(data) {
  if (data.id) {
    getDb().prepare(`UPDATE employee_schedules SET employee_id=?, shift_name=?, shift_date=?, start_time=?, end_time=?, is_rest_day=?, branch=?, notes=? WHERE id=?`)
      .run(data.employee_id, data.shift_name, data.shift_date, data.start_time, data.end_time, data.is_rest_day ? 1 : 0, data.branch, data.notes, data.id);
    return getDb().prepare('SELECT * FROM employee_schedules WHERE id = ?').get(data.id);
  }
  const r = getDb().prepare(`INSERT INTO employee_schedules (employee_id, shift_name, shift_date, start_time, end_time, is_rest_day, branch, notes)
    VALUES (?,?,?,?,?,?,?,?)`).run(data.employee_id, data.shift_name || 'Morning', data.shift_date, data.start_time, data.end_time, data.is_rest_day ? 1 : 0, data.branch, data.notes);
  return getDb().prepare('SELECT * FROM employee_schedules WHERE id = ?').get(r.lastInsertRowid);
}

function deleteSchedule(id) {
  const row = getDb().prepare('SELECT * FROM employee_schedules WHERE id = ?').get(id);
  if (!row) throw new Error('Shift not found');
  getDb().prepare('DELETE FROM employee_schedules WHERE id = ?').run(id);
  return { ok: true };
}

function getDefaultWorkDays(expectedDaysPerWeek) {
  const n = Math.min(7, Math.max(1, Number(expectedDaysPerWeek) || 5));
  return Array.from({ length: n }, (_, i) => i);
}

function isEmployeeOnLeave(employeeId, date) {
  return !!getDb().prepare(`
    SELECT 1 FROM employee_leave WHERE employee_id = ? AND status = 'approved'
    AND date(?) BETWEEN date(start_date) AND date(COALESCE(end_date, start_date))`).get(employeeId, date);
}

function autoGenerateShifts(weekStart, shiftTemplates, employeeIds, employeeOverrides = {}, options = {}) {
  let emps = getEmployees({ status: 'Active' });
  if (employeeIds?.length) emps = emps.filter(e => employeeIds.includes(e.id));
  const start = weekStart;
  let days = 7;
  if (options?.endDate) {
    const s = new Date(`${start}T12:00:00`);
    const e = new Date(`${options.endDate}T12:00:00`);
    days = Math.round((e - s) / 86400000) + 1;
  } else if (options?.days != null) {
    days = Number(options.days);
  } else if (options?.weeks != null) {
    days = Number(options.weeks) * 7;
  }
  days = Math.max(1, Math.min(92, Math.floor(days) || 7));
  const weekEndDate = addDaysIso(start, days - 1);
  for (const emp of emps) {
    getDb().prepare('DELETE FROM employee_schedules WHERE employee_id = ? AND shift_date >= ? AND shift_date <= ?')
      .run(emp.id, start, weekEndDate);
  }
  const created = [];
  for (let day = 0; day < days; day++) {
    const dt = new Date(start + 'T12:00:00');
    dt.setDate(dt.getDate() + day);
    const shiftDate = dt.toLocaleDateString('en-CA');
    const monDay = jsDayToMonBased(dt.getDay());
    for (const emp of emps) {
      if (isEmployeeOnLeave(emp.id, shiftDate)) continue;
      const schedule = attendancePayroll.getEmployeeWorkSchedule(emp);
      const overrides = employeeOverrides[emp.id] || employeeOverrides[String(emp.id)] || {};
      const shiftStart = overrides.shift_start || schedule.shift_start || '08:00';
      const shiftEnd = overrides.shift_end || schedule.shift_end || '17:00';
      const workDays = Array.isArray(schedule.work_days) && schedule.work_days.length
        ? schedule.work_days
        : getDefaultWorkDays(schedule.expected_days_per_week);
      const isRest = !workDays.includes(monDay);
      const shiftName = isRest ? 'Rest Day' : (emp.position ? `${emp.position} Shift` : 'Regular Shift');
      const r = saveSchedule({
        employee_id: emp.id, shift_name: shiftName, shift_date: shiftDate,
        start_time: isRest ? null : shiftStart, end_time: isRest ? null : shiftEnd,
        is_rest_day: isRest, branch: emp.branch
      });
      created.push(r);
    }
  }
  return created;
}

function getDocuments(employeeId) {
  return getDb().prepare('SELECT * FROM employee_documents WHERE employee_id = ? ORDER BY created_at DESC').all(employeeId);
}

function saveDocument(data) {
  const r = getDb().prepare('INSERT INTO employee_documents (employee_id, doc_type, file_path, file_name, notes) VALUES (?,?,?,?,?)')
    .run(data.employee_id, data.doc_type, data.file_path, data.file_name, data.notes);
  return getDb().prepare('SELECT * FROM employee_documents WHERE id = ?').get(r.lastInsertRowid);
}

function getDisciplinary(employeeId) {
  return getDb().prepare('SELECT * FROM employee_disciplinary WHERE employee_id = ? ORDER BY incident_date DESC').all(employeeId);
}

function saveDisciplinary(data, actorId) {
  const db = getDb();
  const requireResp = data.requires_response != null
    ? !!data.requires_response
    : getLeavePortalSettings().require_disciplinary_response !== false;
  const r = db.prepare(`INSERT INTO employee_disciplinary (employee_id, record_type, incident_date, description, action_taken, notes, created_by, requires_response, status)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(data.employee_id, data.record_type, data.incident_date, data.description, data.action_taken, data.notes, actorId, requireResp ? 1 : 0, data.status || 'open');
  const id = r.lastInsertRowid;
  const record = db.prepare(`
    SELECT d.*, e.full_name, e.employee_code FROM employee_disciplinary d
    JOIN employees e ON e.id = d.employee_id WHERE d.id = ?`).get(id);
  const shop = hrPdf.getShopPdfSettings();
  const adminBuf = hrPdf.buildDisciplinaryPdf(record, shop, 'admin');
  const staffBuf = hrPdf.buildDisciplinaryPdf(record, shop, 'staff');
  const pdfPath = hrPdf.savePdfBuffer(adminBuf, `disc-admin-${id}`);
  const staffPdfPath = hrPdf.savePdfBuffer(staffBuf, `disc-staff-${id}`);
  db.prepare('UPDATE employee_disciplinary SET pdf_path = ?, staff_pdf_path = ? WHERE id = ?')
    .run(pdfPath, staffPdfPath, id);
  return db.prepare('SELECT * FROM employee_disciplinary WHERE id = ?').get(id);
}

function buildDisciplinaryPdfBuffer(id, copyType = 'staff') {
  const db = getDb();
  const owner = db.prepare('SELECT employee_id FROM employee_disciplinary WHERE id = ?').get(id);
  if (!owner) throw new Error('Disciplinary record not found');
  assertSessionCanAccessEmployee(owner.employee_id);
  const record = db.prepare(`
    SELECT d.*, e.full_name, e.employee_code FROM employee_disciplinary d
    JOIN employees e ON e.id = d.employee_id WHERE d.id = ?`).get(id);
  if (!record) throw new Error('Disciplinary record not found');
  const pathKey = copyType === 'admin' ? 'pdf_path' : 'staff_pdf_path';
  if (record[pathKey] && fs.existsSync(record[pathKey])) {
    return fs.readFileSync(record[pathKey]);
  }
  const shop = hrPdf.getShopPdfSettings();
  return hrPdf.buildDisciplinaryPdf(record, shop, copyType);
}

function markDisciplinaryWhatsAppSent(id) {
  getDb().prepare(`UPDATE employee_disciplinary SET whatsapp_sent_at = datetime('now') WHERE id = ?`).run(id);
}

function respondDisciplinary(id, employeeId, response) {
  const db = getDb();
  const row = db.prepare(`
    SELECT d.*, e.full_name, e.employee_code FROM employee_disciplinary d
    JOIN employees e ON e.id = d.employee_id
    WHERE d.id = ? AND d.employee_id = ?`).get(id, employeeId);
  if (!row) throw new Error('Record not found');
  db.prepare(`UPDATE employee_disciplinary SET worker_response = ?, worker_response_at = datetime('now'), status = 'responded' WHERE id = ?`)
    .run(response, id);
  const updated = db.prepare(`
    SELECT d.*, e.full_name, e.employee_code FROM employee_disciplinary d
    JOIN employees e ON e.id = d.employee_id WHERE d.id = ?`).get(id);
  const shop = hrPdf.getShopPdfSettings();
  const staffBuf = hrPdf.buildDisciplinaryPdf(updated, shop, 'staff');
  const staffPdfPath = hrPdf.savePdfBuffer(staffBuf, `disc-staff-${id}`);
  db.prepare('UPDATE employee_disciplinary SET staff_pdf_path = ? WHERE id = ?').run(staffPdfPath, id);
  return db.prepare('SELECT * FROM employee_disciplinary WHERE id = ?').get(id);
}

function getAllDisciplinary(filters = {}) {
  let sql = `SELECT d.*, e.full_name, e.employee_code FROM employee_disciplinary d
    JOIN employees e ON e.id = d.employee_id WHERE 1=1`;
  const params = [];
  if (filters.employee_id) { sql += ' AND d.employee_id = ?'; params.push(filters.employee_id); }
  if (filters.status) { sql += ' AND d.status = ?'; params.push(filters.status); }
  sql += ' ORDER BY d.incident_date DESC';
  return getDb().prepare(sql).all(...params);
}

function getEmployeePerformance(employeeId, from, to) {
  const userLink = getDb().prepare('SELECT user_id FROM employees WHERE id = ?').get(employeeId);
  if (!userLink?.user_id) return { sales_count: 0, sales_total: 0, refunds: 0 };
  const sales = getDb().prepare(`
    SELECT COUNT(*) as cnt, COALESCE(SUM(total),0) as total FROM sales
    WHERE user_id = ? AND status = 'completed' AND date(created_at) BETWEEN date(?) AND date(?)`).get(userLink.user_id, from, to);
  return { sales_count: sales?.cnt || 0, sales_total: sales?.total || 0 };
}

function getStaffNotifications() {
  const notes = [];
  const emps = getEmployees({ status: 'Active' });
  const d = today();
  for (const emp of emps) {
    if (emp.date_of_birth) {
      const bday = emp.date_of_birth.slice(5);
      if (d.slice(5) === bday) notes.push({ type: 'birthday', employee_id: emp.id, title: 'Birthday', message: `${emp.full_name}'s birthday today` });
    }
    if (isEmployeeOnLeave(emp.id, d)) continue;
    const att = getTodayAttendance(emp.id);
    if (!att?.clock_in) notes.push({ type: 'missing_clock_in', employee_id: emp.id, title: 'Missing Clock-In', message: `${emp.full_name} has not clocked in` });
    else if (att.clock_in && !att.clock_out) notes.push({ type: 'missing_clock_out', employee_id: emp.id, title: 'Still On Shift', message: `${emp.full_name} not clocked out` });
  }
  const pendingLeave = getAllLeave('pending');
  pendingLeave.forEach(l => notes.push({ type: 'leave', employee_id: l.employee_id, title: 'Leave Pending', message: `${l.full_name}: ${l.leave_type}` }));
  payroll.getPayrollPaymentNotifications().forEach(n => notes.push(n));
  return notes;
}

function buildPayslipPdf(payrollId, shopName, currency) {
  const owner = getDb().prepare('SELECT employee_id FROM employee_payroll WHERE id = ?').get(payrollId);
  if (!owner) throw new Error('Payroll record not found');
  assertSessionCanAccessEmployee(owner.employee_id);
  const row = getDb().prepare(`
    SELECT p.*, e.full_name, e.employee_code, e.position, e.department,
      e.paye_registered, e.uif_registered, e.pension_registered, e.medical_registered, e.sdl_registered
    FROM employee_payroll p
    JOIN employees e ON e.id = p.employee_id WHERE p.id = ?`).get(payrollId);
  if (!row) throw new Error('Payroll record not found');
  const settings = payroll.getPayrollSettings();
  const deductions = payroll.getPayrollDeductions(payrollId);
  return payroll.buildEnhancedPayslipPdf(row, deductions, shopName, currency || 'R', settings);
}

function generatedScheduleRows(from, to, employeeId) {
  return getSchedules(from, to, employeeId).filter((r) => r.id && !r._from_work_schedule);
}

function buildSchedulePdf(from, to, shopName) {
  const rows = generatedScheduleRows(from, to);
  const doc = new jsPDF({ orientation: 'landscape' });
  doc.setFontSize(14);
  doc.text(`${shopName || 'Shop POS'} — Shift Schedule`, 14, 16);
  doc.setFontSize(10);
  doc.text(`${from} to ${to} · ${rows.length} generated shift(s)`, 14, 22);
  const { pdfBytes } = require('./pdf-bytes');
  if (!rows.length) {
    doc.text('No generated shifts in this range. Generate shifts in Staff & HR first.', 14, 36);
    return pdfBytes(doc);
  }
  doc.autoTable({
    startY: 28,
    head: [['Date', 'Employee', 'Shift', 'Start', 'End', 'Branch']],
    body: rows.map(r => [r.shift_date, r.full_name, r.shift_name, r.start_time || '—', r.end_time || '—', r.branch || '—'])
  });
  return pdfBytes(doc);
}

function buildStaffReportPdf(type, data, shopName, currency) {
  const doc = new jsPDF({ orientation: type === 'attendance' ? 'landscape' : 'portrait' });
  doc.setFontSize(14);
  doc.text(`${shopName || 'Shop POS'} — ${type} Report`, 14, 16);
  if (type === 'staff_list') {
    doc.autoTable({
      startY: 24,
      head: [['Code', 'Name', 'Position', 'Department', 'Status']],
      body: data.map(e => [e.employee_code, e.full_name, e.position || '—', e.department || '—', e.status])
    });
  } else if (type === 'attendance') {
    doc.autoTable({
      startY: 24,
      head: [['Date', 'Employee', 'Branch', 'In', 'Out', 'Worked', 'Scheduled', 'Missed', 'Late', 'OT', 'Status']],
      body: data.map(a => [
        a.work_date, a.full_name, a.branch || '—',
        a.clock_in ? a.clock_in.slice(11, 16) : '—', a.clock_out ? a.clock_out.slice(11, 16) : '—',
        a.hours_worked ?? 0, a.scheduled_hours ?? '—', a.hours_missed ?? '—',
        a.late_minutes > 0 ? `${a.late_minutes}m` : '—',
        a.overtime_minutes > 0 ? `${(a.overtime_minutes / 60).toFixed(1)}h` : (a.overtime_hours ?? '—'),
        a.status || '—'
      ])
    });
  } else if (type === 'payroll_dashboard') {
    doc.autoTable({
      startY: 24,
      head: [['Employee', 'Scheduled', 'Worked', 'Missed', 'Late', 'OT', 'Gross', 'Deductions', 'Net']],
      body: data.map(r => [
        r.full_name, Number(r.scheduled_hours || 0).toFixed(1), Number(r.hours_worked || 0).toFixed(1),
        Number(r.hours_missed || 0).toFixed(1), r.late_minutes > 0 ? `${r.late_minutes}m` : '—',
        Number(r.overtime_hours || 0).toFixed(1),
        `${currency}${Number(r.gross_pay || 0).toFixed(2)}`,
        `${currency}${Number(r.total_deductions || 0).toFixed(2)}`,
        `${currency}${Number(r.net_salary || 0).toFixed(2)}`
      ])
    });
  } else if (type === 'payroll') {
    doc.autoTable({
      startY: 24,
      head: [['Employee', 'Period', 'Net', 'Status', 'Method']],
      body: data.map(p => [p.full_name || p.employee_id, `${p.period_start}–${p.period_end}`, `${currency}${Number(p.net_salary).toFixed(2)}`, p.status, p.payment_method])
    });
  }
  return require('./pdf-bytes').pdfBytes(doc);
}

function minutesAfterScheduledStart(schedule, actualIso) {
  if (!schedule?.start_time) return 0;
  const { start: expected } = scheduleWindow(schedule);
  const actual = new Date(actualIso);
  if (!expected || Number.isNaN(expected.getTime())) return 0;
  const diff = actual - expected - (5 * 60000);
  return diff > 0 ? Math.floor(diff / 60000) : 0;
}

function minutesBeforeScheduledEnd(schedule, actualIso) {
  if (!schedule?.end_time) return 0;
  const { end: expected } = scheduleWindow(schedule);
  const actual = new Date(actualIso);
  if (!expected || Number.isNaN(expected.getTime())) return 0;
  const diff = expected - actual - (5 * 60000);
  return diff > 0 ? Math.floor(diff / 60000) : 0;
}

function applyAttendanceScheduleVariance(attendanceId, employeeId) {
  const row = getDb().prepare('SELECT * FROM employee_attendance WHERE id = ?').get(attendanceId);
  if (!row) return;
  const sched = getEmployeeScheduleForDate(employeeId, row.work_date);
  if (!sched) return;
  const late = row.clock_in ? minutesAfterScheduledStart(sched, row.clock_in) : 0;
  const early = row.clock_out ? minutesBeforeScheduledEnd(sched, row.clock_out) : 0;
  getDb().prepare('UPDATE employee_attendance SET late_minutes = ?, early_departure_minutes = ? WHERE id = ?')
    .run(late, early, attendanceId);
}

function recordUserLoginEvent(user, eventType) {
  if (!user?.id) return;
  const db = getDb();
  const d = today();
  const emp = db.prepare('SELECT id FROM employees WHERE user_id = ? AND status = ?').get(user.id, 'Active');
  const sched = emp ? getEmployeeScheduleForDate(emp.id, d) : null;
  const now = new Date().toISOString();
  let late = 0;
  let early = 0;
  let notes = null;
  if (eventType === 'login' && sched) {
    late = minutesAfterScheduledStart(sched, now);
    if (late > 0) notes = `Late login by ${late} min (scheduled start ${sched.start_time})`;
  }
  if (eventType === 'logout' && sched) {
    early = minutesBeforeScheduledEnd(sched, now);
    if (early > 0) notes = `Early logout by ${early} min (scheduled until ${sched.end_time})`;
  }
  db.prepare(`
    INSERT INTO user_login_events (user_id, username, full_name, event_type, event_at, scheduled_start, scheduled_end, late_minutes, early_minutes, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    user.id, user.username, user.full_name, eventType, now,
    sched?.start_time || null, sched?.end_time || null, late, early, notes
  );
}

function getUserLoginEvents(filters = {}) {
  let sql = 'SELECT * FROM user_login_events WHERE 1=1';
  const params = [];
  if (filters.from) { sql += ' AND date(event_at) >= date(?)'; params.push(filters.from); }
  if (filters.to) { sql += ' AND date(event_at) <= date(?)'; params.push(filters.to); }
  if (filters.user_id) { sql += ' AND user_id = ?'; params.push(filters.user_id); }
  sql += ' ORDER BY event_at DESC LIMIT 500';
  return getDb().prepare(sql).all(...params);
}

function buildSchedulePrintHtml(from, to, shopName) {
  const rows = generatedScheduleRows(from, to);
  const body = rows.map(s => `<tr>
    <td>${s.shift_date}</td><td>${s.full_name || ''}</td><td>${s.shift_name || ''}</td>
    <td>${s.is_rest_day ? 'Rest day' : `${s.start_time || ''} – ${s.end_time || ''}`}</td></tr>`).join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Shift Schedule</title></head>
    <body style="font-family:Arial,sans-serif;padding:24px">
    <h2>${shopName || 'Shop POS'} — Shift Schedule</h2>
    <p>${from} to ${to}</p>
    <table border="1" cellpadding="6" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:12px">
    <thead><tr><th>Date</th><th>Employee</th><th>Shift</th><th>Hours</th></tr></thead>
    <tbody>${body || '<tr><td colspan="4">No shifts</td></tr>'}</tbody></table></body></html>`;
}

function validateOnAccount(customerId, amount, accountSettings) {
  const settings = accountSettings || {};
  if (settings.enabled === false) return { ok: false, error: 'On account payments are disabled in Admin settings' };
  const customer = getDb().prepare('SELECT * FROM customers WHERE id = ?').get(customerId);
  if (!customer) return { ok: false, error: 'Select a customer for On Account payment' };
  if (customer.on_account_frozen) {
    return { ok: false, error: `${customer.name}'s account is frozen. Contact admin.` };
  }
  const approved = !!(customer.allow_on_account || customer.on_account_approved);
  if (settings.require_allowlist !== false && !approved) {
    return { ok: false, error: `${customer.name} is not approved for On Account. Enable in Admin → On Account or edit customer.` };
  }
  if (settings.require_approval !== false && !approved) {
    return { ok: false, error: `${customer.name} is awaiting admin approval for On Account.` };
  }
  let balance = Number(customer.balance) || 0;
  let lateFeeApplied = 0;
  const latePct = Number(settings.late_fee_percent) || 0;
  const due = customer.on_account_due_date;
  const today = new Date().toLocaleDateString('en-CA');
  if (latePct > 0 && due && due < today && balance > 0) {
    lateFeeApplied = Math.round(balance * (latePct / 100) * 100) / 100;
    balance += lateFeeApplied;
    getDb().prepare('UPDATE customers SET balance = ? WHERE id = ?').run(balance, customerId);
    customer.balance = balance;
  }
  const defaultLimit = Number(settings.default_credit_limit) || 0;
  const limit = customer.credit_limit != null && customer.credit_limit > 0 ? Number(customer.credit_limit) : defaultLimit;
  const chargeAmount = Number(amount) || 0;
  const newBalance = balance + chargeAmount;
  if (limit > 0 && newBalance > limit + 0.01) {
    return { ok: false, error: `Credit limit exceeded for ${customer.name}. Limit: ${limit}, current balance: ${balance}, sale: ${chargeAmount}` };
  }
  const periodDays = customer.on_account_period_days || settings.default_period_days || 30;
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + Number(periodDays));
  const nextDue = dueDate.toLocaleDateString('en-CA');
  return { ok: true, customer, limit, newBalance, lateFeeApplied, periodDays, nextDue };
}

module.exports = {
  nextEmployeeCode, calcNetSalary, getEmployees, getEmployee, getEmployeeByCode, getEmployeeByUserId,
  verifyEmployeePin, verifyEmployeeCodePin, adminOpenEmployeePortal, validateEmployeeLinks, saveEmployee, deleteEmployee,
  getTodayAttendance, clockAction, clockActionVerified, getAttendance, updateAttendance,
  deleteAttendance, createManualAttendance, addAttendancePenalty, getAttendancePenalties, cancelAttendancePenalty,
  getMissedClockOutInbox, resolveMissedClockOut, previewPayroll,
  getAttendanceSummary, autoCloseOpenAttendance,
  getLeave, getAllLeave, saveLeave, approveLeave, buildLeavePdf, submitLeaveProof, confirmLeaveProof, getPendingLeaveProofs, leaveNeedsProof,
  getLeaveBalance, getLeavePortalSettings, getLeavePolicyForEmployee, validateLeaveRequest,
  getPayroll, generatePayroll, paySalary,
  getSchedules, saveSchedule, deleteSchedule, autoGenerateShifts,
  recordUserLoginEvent, getUserLoginEvents, buildSchedulePrintHtml,
  getDocuments, saveDocument, getDisciplinary, saveDisciplinary, respondDisciplinary, getAllDisciplinary,
  buildDisciplinaryPdfBuffer, markDisciplinaryWhatsAppSent,
  getEmployeePerformance, getStaffNotifications,
  buildPayslipPdf, buildSchedulePdf, buildStaffReportPdf, validateOnAccount,
  getCustomerPhoneReport: hrPdf.getCustomerPhoneReport,
  buildCustomerPhoneReportPdf: (filters, shopName, currency) => {
    const rows = hrPdf.getCustomerPhoneReport(filters);
    const shop = hrPdf.getShopPdfSettings();
    return hrPdf.buildCustomerPhoneReportPdf(rows, { ...shop, shop_name: shopName || shop.shop_name }, filters.from, filters.to, currency);
  },
  getPayrollDashboard: attendancePayroll.getPayrollDashboard,
  saveEmployeeWorkSchedule: attendancePayroll.saveEmployeeWorkSchedule,
  calculateEmployeePeriodPayroll: attendancePayroll.calculateEmployeePeriodPayroll,
  saveHrDocument: attendancePayroll.saveHrDocument,
  getHrDocuments: attendancePayroll.getHrDocuments,
  getHrDocument: attendancePayroll.getHrDocument,
  buildHrDocumentHtml: attendancePayroll.buildHrDocumentHtml,
  ...payroll
};

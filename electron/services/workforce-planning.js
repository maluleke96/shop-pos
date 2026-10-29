/**
 * Workforce planning — extends the existing employee_schedules generator.
 * Reuses employees.work_schedule, leave, attendance payroll, and sales targets.
 */
const { getDb } = require('../database/db');

function dbGet(sql, p = []) { return getDb().prepare(sql).get(...p); }
function dbAll(sql, p = []) { return getDb().prepare(sql).all(...p); }
function dbRun(sql, p = []) { return getDb().prepare(sql).run(...p); }
function nowIso() { return new Date().toISOString(); }
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DEFAULT_REWARD_RULES = {
  target: 2000,
  tiers: [
    { min: 2000, max: 2999.99, amount: 20 },
    { min: 3000, max: 3999.99, amount: 30 },
    { min: 4000, max: null, amount: 50 }
  ]
};

let _schemaReady = false;
function ensureWorkforceSchema() {
  if (_schemaReady) return;
  const cols = [
    ['is_locked', 'INTEGER DEFAULT 0'],
    ['is_published', 'INTEGER DEFAULT 1'],
    ['published_at', 'TEXT'],
    ['job_role', 'TEXT'],
    ['schedule_status', "TEXT DEFAULT 'published'"]
  ];
  for (const [name, type] of cols) {
    try { dbRun(`ALTER TABLE employee_schedules ADD COLUMN ${name} ${type}`); } catch (_) { /* */ }
  }
  dbRun(`CREATE TABLE IF NOT EXISTS staffing_requirements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    branch TEXT,
    day_of_week INTEGER NOT NULL,
    min_workers INTEGER NOT NULL DEFAULT 1,
    target_workers INTEGER NOT NULL DEFAULT 1,
    max_workers INTEGER,
    classification TEXT NOT NULL DEFAULT 'normal',
    shift_slot TEXT NOT NULL DEFAULT 'all',
    role_requirements_json TEXT,
    special_date TEXT,
    notes TEXT,
    updated_at TEXT
  )`);
  dbRun(`CREATE TABLE IF NOT EXISTS staff_performance_reward_rules (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    enabled INTEGER NOT NULL DEFAULT 0,
    rules_json TEXT NOT NULL,
    require_approval INTEGER NOT NULL DEFAULT 1,
    eligible_roles_json TEXT,
    updated_at TEXT
  )`);
  dbRun(`CREATE TABLE IF NOT EXISTS staff_performance_rewards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reward_date TEXT NOT NULL,
    branch TEXT,
    employee_id INTEGER NOT NULL,
    sales_total REAL NOT NULL DEFAULT 0,
    target_amount REAL NOT NULL DEFAULT 0,
    reward_amount REAL NOT NULL DEFAULT 0,
    tier_label TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    calc_key TEXT NOT NULL UNIQUE,
    payroll_id INTEGER,
    approved_by INTEGER,
    approved_at TEXT,
    created_at TEXT
  )`);
  dbRun(`CREATE TABLE IF NOT EXISTS employee_schedule_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    schedule_id INTEGER,
    employee_id INTEGER,
    shift_date TEXT,
    action TEXT NOT NULL,
    previous_json TEXT,
    new_json TEXT,
    actor_id INTEGER,
    actor_name TEXT,
    created_at TEXT
  )`);
  try { dbRun('CREATE INDEX IF NOT EXISTS idx_staffing_req_day ON staffing_requirements(day_of_week)'); } catch (_) { /* */ }
  try { dbRun('CREATE INDEX IF NOT EXISTS idx_staff_perf_rewards_date ON staff_performance_rewards(reward_date)'); } catch (_) { /* */ }
  _schemaReady = true;
}

function jsDayToMonBased(jsDay) { return (jsDay + 6) % 7; }

function addDaysIso(iso, n) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString('en-CA');
}

function parseJson(val, fallback) {
  if (val == null || val === '') return fallback;
  try { return typeof val === 'string' ? JSON.parse(val) : val; } catch (_) { return fallback; }
}

function classificationRank(c) {
  const s = String(c || 'normal').toLowerCase();
  if (s === 'very_busy' || s === 'very busy') return 3;
  if (s === 'busy') return 2;
  return 1;
}

function defaultStaffingWeek() {
  return DAY_NAMES.map((_, i) => ({
    day_of_week: i,
    min_workers: 1,
    target_workers: i >= 3 && i <= 5 ? (i === 5 ? 4 : 3) : (i === 6 ? 2 : 1),
    max_workers: null,
    classification: i >= 3 && i <= 4 ? 'busy' : (i === 5 ? 'very_busy' : 'normal'),
    shift_slot: 'all',
    role_requirements: {},
    branch: null,
    special_date: null,
    notes: ''
  }));
}

function listStaffingRequirements(filters = {}) {
  ensureWorkforceSchema();
  const rows = dbAll('SELECT * FROM staffing_requirements ORDER BY COALESCE(special_date, \'\'), day_of_week, id');
  let out = rows.map((r) => ({
    ...r,
    role_requirements: parseJson(r.role_requirements_json, {})
  }));
  if (filters.branch) out = out.filter((r) => !r.branch || r.branch === filters.branch);
  if (!out.length && !filters.rawOnly) {
    return defaultStaffingWeek().map((d) => ({ ...d, id: null, role_requirements_json: '{}' }));
  }
  return out;
}

function saveStaffingRequirements(rows = [], actor) {
  ensureWorkforceSchema();
  const { assertUserActor } = require('./authz');
  assertUserActor(actor, ['owner', 'manager']);
  const list = Array.isArray(rows) ? rows : [];
  dbRun('DELETE FROM staffing_requirements WHERE special_date IS NULL OR special_date = \'\'');
  for (const row of list) {
    const dow = Number(row.day_of_week);
    if (!Number.isFinite(dow) || dow < 0 || dow > 6) continue;
    const minW = Math.max(0, parseInt(row.min_workers, 10) || 0);
    const target = Math.max(minW, parseInt(row.target_workers, 10) || minW || 1);
    const maxW = row.max_workers != null && row.max_workers !== '' ? Math.max(target, parseInt(row.max_workers, 10) || target) : null;
    const cls = ['normal', 'busy', 'very_busy'].includes(String(row.classification))
      ? String(row.classification) : 'normal';
    dbRun(`INSERT INTO staffing_requirements
      (branch, day_of_week, min_workers, target_workers, max_workers, classification, shift_slot,
       role_requirements_json, special_date, notes, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [row.branch || null, dow, minW, target, maxW, cls, row.shift_slot || 'all',
        JSON.stringify(row.role_requirements || {}), row.special_date || null, row.notes || null, nowIso()]);
  }
  try {
    require('./store').audit?.(actor?.id, actor?.username || actor?.full_name, 'save_staffing_requirements',
      'staffing_requirements', 0, { count: list.length });
  } catch (_) { /* */ }
  return listStaffingRequirements({ rawOnly: true });
}

function requirementForDate(dateStr, branch) {
  ensureWorkforceSchema();
  const special = dbGet(`SELECT * FROM staffing_requirements WHERE special_date = ?
    AND (branch IS NULL OR branch = '' OR branch = ?) ORDER BY CASE WHEN branch = ? THEN 0 ELSE 1 END LIMIT 1`,
    [dateStr, branch || '', branch || '']);
  if (special) {
    return {
      ...special,
      role_requirements: parseJson(special.role_requirements_json, {}),
      source: 'special'
    };
  }
  const monDay = jsDayToMonBased(new Date(`${dateStr}T12:00:00`).getDay());
  const weekly = dbGet(`SELECT * FROM staffing_requirements WHERE (special_date IS NULL OR special_date = '')
    AND day_of_week = ? AND (branch IS NULL OR branch = '' OR branch = ?)
    ORDER BY CASE WHEN branch = ? THEN 0 ELSE 1 END LIMIT 1`, [monDay, branch || '', branch || '']);
  if (weekly) {
    return {
      ...weekly,
      role_requirements: parseJson(weekly.role_requirements_json, {}),
      source: 'weekly'
    };
  }
  const def = defaultStaffingWeek()[monDay];
  return { ...def, source: 'default' };
}

function logScheduleHistory(action, previous, next, actor) {
  ensureWorkforceSchema();
  try {
    dbRun(`INSERT INTO employee_schedule_history
      (schedule_id, employee_id, shift_date, action, previous_json, new_json, actor_id, actor_name, created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`,
      [next?.id || previous?.id || null, next?.employee_id || previous?.employee_id || null,
        next?.shift_date || previous?.shift_date || null, action,
        previous ? JSON.stringify(previous) : null, next ? JSON.stringify(next) : null,
        actor?.id || null, actor?.username || actor?.full_name || null, nowIso()]);
  } catch (_) { /* */ }
}

function enrichWorkSchedule(emp) {
  const attendancePayroll = require('./attendance-payroll');
  const ws = attendancePayroll.getEmployeeWorkSchedule(emp);
  return {
    ...ws,
    unavailable_days: Array.isArray(ws.unavailable_days) ? ws.unavailable_days.map(Number) : [],
    max_days_per_week: ws.max_days_per_week != null ? Number(ws.max_days_per_week) : null,
    max_hours_per_week: ws.max_hours_per_week != null ? Number(ws.max_hours_per_week) : (Number(ws.hours_per_week) || 40),
    min_rest_hours: Number(ws.min_rest_hours) || 0,
    can_overtime: ws.can_overtime !== false && ws.allow_overtime_pay !== false,
    eligible_duties: Array.isArray(ws.eligible_duties) ? ws.eligible_duties : []
  };
}

function isOnLeave(employeeId, date) {
  return !!dbGet(`SELECT 1 FROM employee_leave WHERE employee_id = ? AND status = 'approved'
    AND date(?) BETWEEN date(start_date) AND date(COALESCE(end_date, start_date))`, [employeeId, date]);
}

function hoursBetween(start, end) {
  if (!start || !end) return 0;
  const [sh, sm] = String(start).split(':').map(Number);
  const [eh, em] = String(end).split(':').map(Number);
  let mins = (eh * 60 + (em || 0)) - (sh * 60 + (sm || 0));
  if (mins < 0) mins += 24 * 60;
  return round2(mins / 60);
}

/**
 * Coverage-aware generator. Preserves locked shifts. Returns created rows + conflict report.
 */
function generateIntelligentShifts(weekStart, employeeIds, employeeOverrides = {}, options = {}, actor = null) {
  ensureWorkforceSchema();
  const staff = require('./staff');
  let emps = staff.getEmployees({ status: 'Active' });
  if (employeeIds?.length) {
    const want = new Set(employeeIds.map((id) => Number(id)).filter(Number.isFinite));
    emps = emps.filter((e) => want.has(Number(e.id)));
  }
  if (options.branch) {
    emps = emps.filter((e) => !e.branch || e.branch === options.branch);
  }
  let days = 7;
  if (options?.endDate) {
    days = Math.round((new Date(`${options.endDate}T12:00:00`) - new Date(`${weekStart}T12:00:00`)) / 86400000) + 1;
  } else if (options?.days != null) days = Number(options.days);
  else if (options?.weeks != null) days = Number(options.weeks) * 7;
  days = Math.max(1, Math.min(92, Math.floor(days) || 7));
  const weekEnd = addDaysIso(weekStart, days - 1);
  const weekendOnly = !!options.weekendOnly;
  const dryRun = !!options.dryRun;
  // Draft by default — admin must publish to staff portal
  const publish = options.publish === true;

  const conflicts = [];
  const coverage = [];
  const created = [];
  const preservedLocked = [];

  // Clear unlocked rows for selected employees in range
  for (const emp of emps) {
    const rows = dbAll(`SELECT * FROM employee_schedules WHERE employee_id = ? AND shift_date >= ? AND shift_date <= ?`,
      [emp.id, weekStart, weekEnd]);
    for (const row of rows) {
      const jsDay = new Date(`${row.shift_date}T12:00:00`).getDay();
      if (weekendOnly && jsDay !== 0 && jsDay !== 6) continue;
      if (Number(row.is_locked) === 1) {
        preservedLocked.push(row);
        continue;
      }
      if (!dryRun) {
        logScheduleHistory('regenerate_delete', row, null, actor);
        dbRun('DELETE FROM employee_schedules WHERE id = ?', [row.id]);
      }
    }
  }

  // Preload locked working counts
  const assignedDays = {};
  const assignedHours = {};
  for (const emp of emps) {
    assignedDays[emp.id] = 0;
    assignedHours[emp.id] = 0;
  }
  for (const row of preservedLocked) {
    if (!row.is_rest_day) {
      assignedDays[row.employee_id] = (assignedDays[row.employee_id] || 0) + 1;
      assignedHours[row.employee_id] = (assignedHours[row.employee_id] || 0) + hoursBetween(row.start_time, row.end_time);
    }
  }

  const dates = [];
  for (let i = 0; i < days; i++) {
    const dateStr = addDaysIso(weekStart, i);
    const jsDay = new Date(`${dateStr}T12:00:00`).getDay();
    if (weekendOnly && jsDay !== 0 && jsDay !== 6) continue;
    dates.push(dateStr);
  }

  // Busy days first
  dates.sort((a, b) => {
    const ra = classificationRank(requirementForDate(a, options.branch).classification);
    const rb = classificationRank(requirementForDate(b, options.branch).classification);
    return rb - ra || a.localeCompare(b);
  });

  for (const dateStr of dates) {
    const monDay = jsDayToMonBased(new Date(`${dateStr}T12:00:00`).getDay());
    const req = requirementForDate(dateStr, options.branch);
    const target = Math.max(0, Number(req.target_workers) || 0);
    const minW = Math.max(0, Number(req.min_workers) || 0);
    const maxW = req.max_workers != null ? Number(req.max_workers) : null;
    const roleNeed = req.role_requirements || {};

    const lockedToday = preservedLocked.filter((r) => r.shift_date === dateStr && !r.is_rest_day);
    const working = [...lockedToday];

    // Weekend-only mode: put every selected available worker on that weekend day.
    if (weekendOnly) {
      for (const emp of emps) {
        if (isOnLeave(emp.id, dateStr)) continue;
        if (lockedToday.some((r) => Number(r.employee_id) === Number(emp.id))) continue;
        if (working.some((w) => Number(w.employee_id) === Number(emp.id))) continue;
        const ws = enrichWorkSchedule(emp);
        const overrides = employeeOverrides[emp.id] || employeeOverrides[String(emp.id)] || {};
        const shiftH = hoursBetween(overrides.shift_start || ws.shift_start || '08:00', overrides.shift_end || ws.shift_end || '17:00');
        working.push({ employee_id: emp.id, emp, ws, overrides, is_rest_day: 0, _generated: true });
        assignedDays[emp.id] = (assignedDays[emp.id] || 0) + 1;
        assignedHours[emp.id] = (assignedHours[emp.id] || 0) + shiftH;
      }
    }

    const candidates = emps.map((emp) => {
      const ws = enrichWorkSchedule(emp);
      const overrides = employeeOverrides[emp.id] || employeeOverrides[String(emp.id)] || {};
      const workDays = Array.isArray(ws.work_days) && ws.work_days.length
        ? ws.work_days.map(Number)
        : Array.from({ length: Math.min(7, Math.max(1, Number(ws.expected_days_per_week) || 5)) }, (_, i) => i);
      const unavailable = ws.unavailable_days || [];
      const onLeave = isOnLeave(emp.id, dateStr);
      const preferred = workDays.includes(monDay);
      const blocked = unavailable.includes(monDay) || onLeave;
      const targetDays = Number(ws.expected_days_per_week) || workDays.length || 5;
      const maxDays = ws.max_days_per_week != null ? Number(ws.max_days_per_week) : targetDays;
      const already = assignedDays[emp.id] || 0;
      const hours = assignedHours[emp.id] || 0;
      const shiftH = hoursBetween(overrides.shift_start || ws.shift_start || '08:00', overrides.shift_end || ws.shift_end || '17:00');
      const overDays = already >= maxDays;
      const overHours = hours + shiftH > (Number(ws.max_hours_per_week) || 40) + 0.01;
      const lockedSelf = lockedToday.some((r) => Number(r.employee_id) === Number(emp.id));
      return {
        emp, ws, overrides, preferred, blocked, onLeave, targetDays, maxDays, already,
        overDays, overHours, shiftH, lockedSelf,
        score: (preferred ? 10 : 0)
          + (already < targetDays ? 5 : -3)
          + (classificationRank(req.classification) >= 2 && preferred ? 4 : 0)
          - already
          - (overDays ? 100 : 0)
          - (overHours ? 50 : 0)
          - (blocked ? 1000 : 0)
          - (lockedSelf ? 1000 : 0)
      };
    }).filter((c) => !c.blocked && !c.lockedSelf)
      .sort((a, b) => b.score - a.score || String(a.emp.full_name).localeCompare(String(b.emp.full_name)));

    if (!weekendOnly) {
      const need = Math.max(target, minW);
      const cap = maxW != null ? maxW : need + 2;
      const assignCandidate = (c, forceOverTarget) => {
        if (working.some((w) => Number(w.employee_id) === Number(c.emp.id))) return false;
        if (c.overDays && !forceOverTarget && !options.allowOverTarget) return false;
        if (c.overHours && !c.ws.can_overtime) return false;
        working.push({
          employee_id: c.emp.id,
          emp: c.emp,
          ws: c.ws,
          overrides: c.overrides,
          is_rest_day: 0,
          _generated: true,
          _over_target: !!(c.overDays && forceOverTarget)
        });
        assignedDays[c.emp.id] = (assignedDays[c.emp.id] || 0) + 1;
        assignedHours[c.emp.id] = (assignedHours[c.emp.id] || 0) + c.shiftH;
        return true;
      };
      // Prefer workers still under their weekly target
      for (const c of candidates) {
        if (working.length >= need) break;
        if (working.length >= cap) break;
        assignCandidate(c, false);
      }
      // Priority: meet minimum coverage even if it exceeds a worker's day target
      if (working.length < minW) {
        for (const c of candidates) {
          if (working.length >= minW) break;
          if (working.length >= cap) break;
          if (assignCandidate(c, true) && c.overDays) {
            conflicts.push({
              date: dateStr,
              type: 'over_target_for_coverage',
              employee_id: c.emp.id,
              employee_name: c.emp.full_name,
              required: minW,
              available: working.length,
              reason: `${c.emp.full_name} assigned above weekly target to meet minimum staffing`
            });
          }
        }
      }
    }

    // Role coverage warnings
    for (const [role, count] of Object.entries(roleNeed)) {
      const have = working.filter((w) => {
        const pos = String(w.emp?.position || w.job_role || '').toLowerCase();
        const duties = enrichWorkSchedule(w.emp || {}).eligible_duties.map((d) => String(d).toLowerCase());
        return pos.includes(String(role).toLowerCase()) || duties.includes(String(role).toLowerCase());
      }).length;
      if (have < Number(count)) {
        conflicts.push({
          date: dateStr,
          type: 'role_coverage',
          required: Number(count),
          available: have,
          role,
          reason: `Need ${count} ${role}, have ${have}`,
          classification: req.classification
        });
      }
    }

    if (working.length < minW) {
      conflicts.push({
        date: dateStr,
        type: 'understaffed',
        required: minW,
        available: working.length,
        reason: `Need at least ${minW} workers (${req.classification}), scheduled ${working.length}`,
        classification: req.classification,
        needed: Math.max(0, minW - working.length)
      });
    } else if (working.length < target) {
      conflicts.push({
        date: dateStr,
        type: 'below_target',
        required: target,
        available: working.length,
        reason: `Target ${target} workers, scheduled ${working.length}`,
        classification: req.classification
      });
    } else if (maxW != null && working.length > maxW) {
      conflicts.push({
        date: dateStr,
        type: 'overstaffed',
        required: maxW,
        available: working.length,
        reason: `Max ${maxW} workers, scheduled ${working.length}`,
        classification: req.classification
      });
    }

    coverage.push({
      date: dateStr,
      classification: req.classification,
      required_min: minW,
      required_target: target,
      scheduled: working.length,
      status: working.length < minW ? 'understaffed'
        : (maxW != null && working.length > maxW ? 'overstaffed'
          : (working.length < target ? 'below_target' : 'ok'))
    });

    // Persist working shifts + rest days for selected employees
    const workingIds = new Set(working.map((w) => Number(w.employee_id)));
    for (const emp of emps) {
      if (lockedToday.some((r) => Number(r.employee_id) === Number(emp.id))) continue;
      const ws = enrichWorkSchedule(emp);
      const overrides = employeeOverrides[emp.id] || employeeOverrides[String(emp.id)] || {};
      const isWork = workingIds.has(Number(emp.id));
      const onLeave = isOnLeave(emp.id, dateStr);
      const isRest = !isWork || onLeave;
      const shiftStart = overrides.shift_start || ws.shift_start || '08:00';
      const shiftEnd = overrides.shift_end || ws.shift_end || '17:00';
      const shiftName = isRest
        ? (onLeave ? 'Approved Leave' : 'Rest Day')
        : (emp.position ? `${emp.position} Shift` : 'Regular Shift');
      if (dryRun) {
        created.push({
          employee_id: emp.id, shift_date: dateStr, shift_name: shiftName,
          start_time: isRest ? null : shiftStart, end_time: isRest ? null : shiftEnd,
          is_rest_day: isRest ? 1 : 0, branch: emp.branch, dry_run: true
        });
        continue;
      }
      const row = staff.saveSchedule({
        employee_id: emp.id,
        shift_name: shiftName,
        shift_date: dateStr,
        start_time: isRest ? null : shiftStart,
        end_time: isRest ? null : shiftEnd,
        is_rest_day: isRest,
        branch: emp.branch,
        job_role: emp.position || null,
        is_locked: 0,
        is_published: publish ? 1 : 0,
        schedule_status: publish ? 'published' : 'draft',
        published_at: publish ? nowIso() : null
      });
      logScheduleHistory('generate', null, row, actor);
      created.push(row);
    }
  }

  // Fairness / target warnings
  for (const emp of emps) {
    const ws = enrichWorkSchedule(emp);
    const want = Number(ws.expected_days_per_week) || 5;
    const got = assignedDays[emp.id] || 0;
    if (got < want) {
      conflicts.push({
        date: `${weekStart}→${weekEnd}`,
        type: 'worker_target',
        employee_id: emp.id,
        employee_name: emp.full_name,
        required: want,
        available: got,
        reason: `${emp.full_name} target ${want} days/week, assigned ${got}`
      });
    }
  }

  return {
    created,
    preserved_locked: preservedLocked.length,
    conflicts,
    coverage,
    period: { start: weekStart, end: weekEnd, days },
    ok: !conflicts.some((c) => c.type === 'understaffed' || c.type === 'role_coverage')
  };
}

function setScheduleLock(id, locked, actor) {
  ensureWorkforceSchema();
  const { assertUserActor } = require('./authz');
  assertUserActor(actor, ['owner', 'manager', 'supervisor', 'assistant_manager']);
  const prev = dbGet('SELECT * FROM employee_schedules WHERE id = ?', [id]);
  if (!prev) throw new Error('Shift not found');
  dbRun('UPDATE employee_schedules SET is_locked = ? WHERE id = ?', [locked ? 1 : 0, id]);
  const next = dbGet('SELECT * FROM employee_schedules WHERE id = ?', [id]);
  logScheduleHistory(locked ? 'lock' : 'unlock', prev, next, actor);
  return next;
}

function publishSchedules(from, to, employeeIds, actor) {
  ensureWorkforceSchema();
  const { assertUserActor } = require('./authz');
  assertUserActor(actor, ['owner', 'manager', 'supervisor', 'assistant_manager']);
  let sql = `UPDATE employee_schedules SET is_published = 1, schedule_status = 'published', published_at = ?
    WHERE shift_date >= ? AND shift_date <= ?`;
  const params = [nowIso(), from, to];
  if (employeeIds?.length) {
    sql += ` AND employee_id IN (${employeeIds.map(() => '?').join(',')})`;
    params.push(...employeeIds.map(Number));
  }
  const r = dbRun(sql, params);
  try {
    require('./store').addNotification?.('schedule_published', 'Shifts published',
      `Schedule ${from} – ${to} is now visible in the staff portal.`, {
        entity_type: 'employee_schedules',
        action_page: 'admin:staffhr',
        audience_roles: ['owner', 'manager']
      });
  } catch (_) { /* */ }
  return { ok: true, updated: r?.changes || 0 };
}

function labourCostForecast(from, to, employeeIds) {
  ensureWorkforceSchema();
  const staff = require('./staff');
  const attendancePayroll = require('./attendance-payroll');
  let emps = staff.getEmployees({ status: 'Active' });
  if (employeeIds?.length) {
    const want = new Set(employeeIds.map(Number));
    emps = emps.filter((e) => want.has(Number(e.id)));
  }
  const rows = dbAll(`SELECT * FROM employee_schedules WHERE shift_date >= ? AND shift_date <= ? AND COALESCE(is_rest_day,0) = 0`,
    [from, to]);
  const byEmp = {};
  let total = 0;
  for (const emp of emps) {
    const ws = attendancePayroll.getEmployeeWorkSchedule(emp);
    const hourly = attendancePayroll.hourlyRateFromSchedule
      ? attendancePayroll.hourlyRateFromSchedule(ws)
      : (Number(ws.hourly_rate) || 0);
    const mine = rows.filter((r) => Number(r.employee_id) === Number(emp.id));
    const hours = mine.reduce((s, r) => s + hoursBetween(r.start_time, r.end_time), 0);
    let cost = 0;
    if (ws.pay_type === 'daily') {
      cost = mine.length * (Number(ws.daily_wage) || 0);
    } else if (ws.pay_type === 'monthly') {
      // Estimate only — allocation of monthly salary over scheduled days
      const daysInPeriod = Math.max(1, Math.round((new Date(`${to}T12:00:00`) - new Date(`${from}T12:00:00`)) / 86400000) + 1);
      const monthShare = (Number(ws.monthly_salary) || Number(emp.basic_salary) || 0) * (daysInPeriod / 30);
      cost = monthShare;
    } else {
      cost = hours * hourly;
    }
    cost = round2(cost);
    total += cost;
    byEmp[emp.id] = {
      employee_id: emp.id,
      full_name: emp.full_name,
      pay_type: ws.pay_type,
      scheduled_days: mine.length,
      scheduled_hours: round2(hours),
      estimated_cost: cost,
      estimate_note: ws.pay_type === 'monthly' ? 'Monthly salary allocation (not extra pay)' : null
    };
  }
  return { from, to, total_estimated: round2(total), employees: Object.values(byEmp) };
}

function coverageReport(from, to, branch) {
  ensureWorkforceSchema();
  const out = [];
  let d = from;
  while (d <= to) {
    const req = requirementForDate(d, branch);
    const scheduled = Number(dbGet(`SELECT COUNT(*) AS n FROM employee_schedules
      WHERE shift_date = ? AND COALESCE(is_rest_day,0) = 0
      AND (branch IS NULL OR branch = '' OR ? IS NULL OR ? = '' OR branch = ?)`,
      [d, branch || null, branch || null, branch || ''])?.n) || 0;
    const minW = Number(req.min_workers) || 0;
    const target = Number(req.target_workers) || 0;
    out.push({
      date: d,
      classification: req.classification,
      required_min: minW,
      required_target: target,
      scheduled,
      status: scheduled < minW ? 'understaffed'
        : (scheduled < target ? 'below_target' : 'ok')
    });
    d = addDaysIso(d, 1);
  }
  return out;
}

/* ——— Performance rewards ——— */

function getRewardRules() {
  ensureWorkforceSchema();
  const row = dbGet('SELECT * FROM staff_performance_reward_rules WHERE id = 1');
  if (!row) {
    return {
      enabled: false,
      require_approval: true,
      eligible_roles: [],
      ...DEFAULT_REWARD_RULES
    };
  }
  const rules = parseJson(row.rules_json, DEFAULT_REWARD_RULES);
  return {
    enabled: Number(row.enabled) === 1,
    require_approval: Number(row.require_approval) !== 0,
    eligible_roles: parseJson(row.eligible_roles_json, []),
    target: Number(rules.target) || 2000,
    tiers: Array.isArray(rules.tiers) ? rules.tiers : DEFAULT_REWARD_RULES.tiers,
    updated_at: row.updated_at
  };
}

function saveRewardRules(data, actor) {
  ensureWorkforceSchema();
  const { assertUserActor } = require('./authz');
  assertUserActor(actor, ['owner', 'manager']);
  const next = {
    enabled: !!data.enabled,
    require_approval: data.require_approval !== false,
    eligible_roles: Array.isArray(data.eligible_roles) ? data.eligible_roles : [],
    target: Number(data.target) || 0,
    tiers: Array.isArray(data.tiers) ? data.tiers : DEFAULT_REWARD_RULES.tiers
  };
  const payload = JSON.stringify({ target: next.target, tiers: next.tiers });
  const existing = dbGet('SELECT id FROM staff_performance_reward_rules WHERE id = 1');
  if (existing) {
    dbRun(`UPDATE staff_performance_reward_rules SET enabled=?, rules_json=?, require_approval=?,
      eligible_roles_json=?, updated_at=? WHERE id=1`,
      [next.enabled ? 1 : 0, payload, next.require_approval ? 1 : 0,
        JSON.stringify(next.eligible_roles), nowIso()]);
  } else {
    dbRun(`INSERT INTO staff_performance_reward_rules
      (id, enabled, rules_json, require_approval, eligible_roles_json, updated_at) VALUES (1,?,?,?,?,?)`,
      [next.enabled ? 1 : 0, payload, next.require_approval ? 1 : 0,
        JSON.stringify(next.eligible_roles), nowIso()]);
  }
  return getRewardRules();
}

function tierForSales(sales, rules) {
  const amount = Number(sales) || 0;
  const tiers = [...(rules.tiers || [])].sort((a, b) => Number(a.min) - Number(b.min));
  let hit = null;
  for (const t of tiers) {
    const min = Number(t.min) || 0;
    const max = t.max == null || t.max === '' ? Infinity : Number(t.max);
    if (amount >= min && amount <= max) hit = t;
  }
  return hit;
}

function daySalesTotal(dateStr, branch) {
  try {
    const store = require('./store');
    if (typeof store.getTodayTargetProgress === 'function' && dateStr === new Date().toLocaleDateString('en-CA')) {
      const prog = store.getTodayTargetProgress(null);
      return Number(prog?.sales_total ?? prog?.total ?? prog?.sales) || 0;
    }
  } catch (_) { /* */ }
  try {
    let sql = `SELECT COALESCE(SUM(total),0) AS t FROM sales
      WHERE status = 'completed' AND date(created_at) = date(?)`;
    const params = [dateStr];
    // branch filter via users if needed — total shop for now
    return Number(dbGet(sql, params)?.t) || 0;
  } catch (_) {
    return 0;
  }
}

function calculateDayRewards(dateStr, actor, opts = {}) {
  ensureWorkforceSchema();
  const rules = getRewardRules();
  if (!rules.enabled && !opts.force) return { skipped: 'disabled', rewards: [] };
  const sales = opts.sales_total != null ? Number(opts.sales_total) : daySalesTotal(dateStr, opts.branch);
  const tier = tierForSales(sales, rules);
  const rewardAmt = tier ? Number(tier.amount) || 0 : 0;
  const staff = require('./staff');
  let emps = staff.getEmployees({ status: 'Active' });
  if (opts.branch) emps = emps.filter((e) => !e.branch || e.branch === opts.branch);
  if (rules.eligible_roles?.length) {
    const roles = rules.eligible_roles.map((r) => String(r).toLowerCase());
    emps = emps.filter((e) => roles.some((r) => String(e.position || '').toLowerCase().includes(r)));
  }
  // Only staff who worked / were scheduled that day
  const scheduled = new Set(dbAll(`SELECT employee_id FROM employee_schedules
    WHERE shift_date = ? AND COALESCE(is_rest_day,0) = 0`, [dateStr]).map((r) => Number(r.employee_id)));
  const worked = new Set(dbAll(`SELECT employee_id FROM employee_attendance
    WHERE work_date = ? AND clock_in IS NOT NULL`, [dateStr]).map((r) => Number(r.employee_id)));
  emps = emps.filter((e) => scheduled.has(Number(e.id)) || worked.has(Number(e.id)));

  const out = [];
  for (const emp of emps) {
    const calcKey = `${dateStr}|${emp.id}|${round2(rewardAmt)}`;
    const existing = dbGet('SELECT * FROM staff_performance_rewards WHERE calc_key = ?', [calcKey]);
    if (existing) {
      out.push(existing);
      continue;
    }
    // Void older calc for same day/employee if amount changed
    dbRun(`UPDATE staff_performance_rewards SET status = 'void'
      WHERE reward_date = ? AND employee_id = ? AND status IN ('pending','approved')`, [dateStr, emp.id]);
    if (!(rewardAmt > 0)) continue;
    const status = rules.require_approval ? 'pending' : 'approved';
    dbRun(`INSERT INTO staff_performance_rewards
      (reward_date, branch, employee_id, sales_total, target_amount, reward_amount, tier_label, status, calc_key, approved_at, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [dateStr, emp.branch || null, emp.id, sales, rules.target, rewardAmt,
        tier ? `R${tier.min}+` : null, status, calcKey,
        status === 'approved' ? nowIso() : null, nowIso()]);
    out.push(dbGet('SELECT * FROM staff_performance_rewards WHERE calc_key = ?', [calcKey]));
  }
  return { date: dateStr, sales_total: sales, target: rules.target, reward_amount: rewardAmt, rewards: out };
}

function listRewards(filters = {}) {
  ensureWorkforceSchema();
  let sql = `SELECT r.*, e.full_name, e.employee_code, e.position FROM staff_performance_rewards r
    JOIN employees e ON e.id = r.employee_id WHERE 1=1`;
  const params = [];
  if (filters.from) { sql += ' AND r.reward_date >= ?'; params.push(filters.from); }
  if (filters.to) { sql += ' AND r.reward_date <= ?'; params.push(filters.to); }
  if (filters.employee_id) { sql += ' AND r.employee_id = ?'; params.push(Number(filters.employee_id)); }
  if (filters.status) { sql += ' AND r.status = ?'; params.push(filters.status); }
  sql += ' ORDER BY r.reward_date DESC, e.full_name';
  return dbAll(sql, params);
}

function approveReward(id, actor) {
  ensureWorkforceSchema();
  const { assertUserActor } = require('./authz');
  const user = assertUserActor(actor, ['owner', 'manager']);
  const row = dbGet('SELECT * FROM staff_performance_rewards WHERE id = ?', [id]);
  if (!row) throw new Error('Reward not found');
  if (row.status === 'paid') throw new Error('Reward already paid in payroll');
  dbRun(`UPDATE staff_performance_rewards SET status = 'approved', approved_by = ?, approved_at = ? WHERE id = ?`,
    [user.id, nowIso(), id]);
  return dbGet('SELECT * FROM staff_performance_rewards WHERE id = ?', [id]);
}

function applyApprovedRewardsToPayroll(employeeId, payrollId, periodStart, periodEnd) {
  ensureWorkforceSchema();
  const rows = dbAll(`SELECT * FROM staff_performance_rewards
    WHERE employee_id = ? AND status = 'approved' AND reward_date >= ? AND reward_date <= ?
      AND payroll_id IS NULL`, [employeeId, periodStart, periodEnd]);
  const total = round2(rows.reduce((s, r) => s + (Number(r.reward_amount) || 0), 0));
  if (!(total > 0)) return 0;
  for (const r of rows) {
    dbRun(`UPDATE staff_performance_rewards SET status = 'paid', payroll_id = ? WHERE id = ?`, [payrollId, r.id]);
  }
  try {
    dbRun(`UPDATE employee_payroll SET bonus = COALESCE(bonus,0) + ?,
      gross_salary = COALESCE(gross_salary,0) + ?, net_salary = net_salary + ?,
      notes = TRIM(COALESCE(notes,'') || char(10) || ?) WHERE id = ?`,
      [total, total, total, `Performance rewards (${rows.length} day(s))`, payrollId]);
  } catch (_) {
    dbRun(`UPDATE employee_payroll SET bonus = COALESCE(bonus,0) + ?,
      gross_salary = COALESCE(gross_salary,0) + ?, net_salary = net_salary + ? WHERE id = ?`,
      [total, total, total, payrollId]);
  }
  return total;
}

function workforceDashboard() {
  ensureWorkforceSchema();
  const today = new Date().toLocaleDateString('en-CA');
  const staff = require('./staff');
  const active = staff.getEmployees({ status: 'Active' }) || [];
  const req = requirementForDate(today, null);
  const scheduledToday = Number(dbGet(`SELECT COUNT(*) AS n FROM employee_schedules
    WHERE shift_date = ? AND COALESCE(is_rest_day,0) = 0`, [today])?.n) || 0;
  const under = coverageReport(today, today).filter((c) => c.status === 'understaffed').length;
  const missingAtt = Number(dbGet(`SELECT COUNT(*) AS n FROM employee_schedules s
    WHERE s.shift_date = ? AND COALESCE(s.is_rest_day,0) = 0
    AND NOT EXISTS (SELECT 1 FROM employee_attendance a WHERE a.employee_id = s.employee_id AND a.work_date = s.shift_date AND a.clock_in IS NOT NULL)`,
    [today])?.n) || 0;
  const rewardsPeriod = listRewards({
    from: today.slice(0, 8) + '01',
    to: today
  }).filter((r) => r.status !== 'void');
  const rewardSum = round2(rewardsPeriod.reduce((s, r) => s + (Number(r.reward_amount) || 0), 0));
  const pendingPayroll = Number(dbGet(`SELECT COUNT(*) AS n FROM employee_payroll WHERE status = 'pending'`)?.n) || 0;
  return {
    active_employees: active.length,
    scheduled_today: scheduledToday,
    required_today: Number(req.target_workers) || 0,
    understaffed_today: under,
    attendance_issues_today: missingAtt,
    rewards_this_month: rewardSum,
    payroll_awaiting_approval: pendingPayroll,
    today_classification: req.classification
  };
}

module.exports = {
  ensureWorkforceSchema,
  listStaffingRequirements,
  saveStaffingRequirements,
  requirementForDate,
  generateIntelligentShifts,
  setScheduleLock,
  publishSchedules,
  labourCostForecast,
  coverageReport,
  getRewardRules,
  saveRewardRules,
  calculateDayRewards,
  listRewards,
  approveReward,
  applyApprovedRewardsToPayroll,
  workforceDashboard,
  enrichWorkSchedule,
  logScheduleHistory
};

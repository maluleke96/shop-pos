'use strict';
/**
 * Manager & Supervisor HR / Disciplinary Portal
 * Reuses employees, users, branches, employee_disciplinary — scoped by assignments.
 */
const { getDb } = require('../database/db');

const INCIDENT_TYPES = [
  'Poor performance', 'Late arrival', 'Absence', 'Failure to follow instructions',
  'Misconduct', 'Customer complaint', 'Food/product wastage', 'Damage to company property',
  'Cash/POS discrepancy', 'Failure to follow procedure', 'Delivery issue',
  'Workplace behaviour', 'Other'
];

const STATUSES = [
  'REPORTED', 'UNDER_REVIEW', 'EMPLOYEE_RESPONSE_REQUESTED', 'EMPLOYEE_RESPONDED',
  'MANAGER_RECOMMENDATION', 'ADMIN_REVIEW', 'DECISION', 'CLOSED'
];

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS manager_hr_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL UNIQUE,
  portal_role TEXT NOT NULL DEFAULT 'supervisor', branch_id INTEGER,
  is_active INTEGER NOT NULL DEFAULT 1, can_create_warnings INTEGER NOT NULL DEFAULT 0,
  can_recommend_recovery INTEGER NOT NULL DEFAULT 1, notes TEXT,
  created_by INTEGER, updated_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS manager_hr_assignment_employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT, assignment_id INTEGER NOT NULL, employee_id INTEGER NOT NULL,
  UNIQUE(assignment_id, employee_id)
);
CREATE TABLE IF NOT EXISTS manager_hr_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT, case_number TEXT NOT NULL UNIQUE,
  employee_id INTEGER NOT NULL, branch_id INTEGER, reported_by_user_id INTEGER NOT NULL,
  reporter_portal_role TEXT, incident_date TEXT, incident_time TEXT, incident_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium', title TEXT, description TEXT, what_happened TEXT,
  witnesses TEXT, recommended_action TEXT, additional_notes TEXT,
  status TEXT NOT NULL DEFAULT 'REPORTED', evidence_paths TEXT, warning_id INTEGER, hr_case_id INTEGER,
  final_decision TEXT, final_decision_notes TEXT, decided_by INTEGER, decided_at TEXT, closed_at TEXT,
  created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS manager_hr_case_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, case_id INTEGER NOT NULL, actor_user_id INTEGER,
  actor_role TEXT, actor_name TEXT, action TEXT NOT NULL, previous_status TEXT, new_status TEXT,
  notes TEXT, meta_json TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS manager_hr_case_responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT, case_id INTEGER NOT NULL, employee_id INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, response_text TEXT, agree_disagree TEXT, explanation TEXT,
  supporting_info TEXT, attachment_paths TEXT, is_locked INTEGER NOT NULL DEFAULT 1,
  submitted_at TEXT DEFAULT (datetime('now')), UNIQUE(case_id, version)
);
CREATE TABLE IF NOT EXISTS manager_hr_case_recommendations (
  id INTEGER PRIMARY KEY AUTOINCREMENT, case_id INTEGER NOT NULL, recommended_by INTEGER NOT NULL,
  recommendation_text TEXT, recommended_warning_type TEXT, recommended_recovery_amount REAL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS manager_hr_case_costs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, case_id INTEGER NOT NULL UNIQUE,
  reported_loss REAL NOT NULL DEFAULT 0, recommended_recovery REAL NOT NULL DEFAULT 0,
  approved_recovery REAL NOT NULL DEFAULT 0, actual_payroll_deduction REAL NOT NULL DEFAULT 0,
  currency TEXT DEFAULT 'R', notes TEXT, approved_by INTEGER, approved_at TEXT,
  created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS manager_hr_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT, audience TEXT NOT NULL, user_id INTEGER, employee_id INTEGER,
  case_id INTEGER, title TEXT NOT NULL, message TEXT, is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS manager_hr_recordings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recording_number TEXT NOT NULL UNIQUE,
  title TEXT,
  party_a TEXT,
  party_b TEXT,
  conversation_type TEXT DEFAULT 'conversation',
  recorded_by_user_id INTEGER,
  recorded_by_name TEXT,
  branch_id INTEGER,
  case_id INTEGER,
  audio_mime TEXT,
  audio_data TEXT,
  duration_seconds INTEGER DEFAULT 0,
  transcript_original TEXT,
  transcript_summary TEXT,
  ai_key_points_json TEXT,
  ai_suggested_decision TEXT,
  ai_status TEXT DEFAULT 'pending',
  admin_highlights_json TEXT,
  final_decision TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
`;

let _ready = false;

function db() { return getDb(); }
function dbAll(sql, p = []) { return db().prepare(sql).all(...p); }
function dbGet(sql, p = []) { return db().prepare(sql).get(...p); }
function dbRun(sql, p = []) { return db().prepare(sql).run(...p); }
function now() { return new Date().toISOString().replace('T', ' ').slice(0, 19); }
function num(v, d = 0) { const n = Number(v); return Number.isFinite(n) ? n : d; }
function text(v) { const s = String(v ?? '').trim(); return s || null; }
function parseJson(v, fb) {
  if (v == null || v === '') return fb;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch (_) { return fb; }
}

function ensureSchema() {
  if (_ready) {
    try { if (dbGet('SELECT 1 AS x FROM manager_hr_assignments LIMIT 1') || true) return; } catch (_) { _ready = false; }
  }
  for (const stmt of SCHEMA_SQL.split(';').map((s) => s.trim()).filter(Boolean)) {
    try { db().exec(stmt); } catch (e) { console.warn('[mgr-hr] schema:', e.message); }
  }
  for (const sql of [
    'CREATE INDEX IF NOT EXISTS idx_mgr_hr_assign_user ON manager_hr_assignments(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_mgr_hr_cases_emp ON manager_hr_cases(employee_id)',
    'CREATE INDEX IF NOT EXISTS idx_mgr_hr_cases_status ON manager_hr_cases(status)',
    'CREATE INDEX IF NOT EXISTS idx_mgr_hr_events_case ON manager_hr_case_events(case_id)',
    'CREATE INDEX IF NOT EXISTS idx_mgr_hr_notif_emp ON manager_hr_notifications(employee_id, is_read)',
    'CREATE INDEX IF NOT EXISTS idx_mgr_hr_rec_created ON manager_hr_recordings(created_at)',
    `ALTER TABLE manager_hr_cases ADD COLUMN decision_taken TEXT`
  ]) {
    try { db().exec(sql); } catch (_) { /* ignore exists */ }
  }
  _ready = true;
}

function audit(actor, action, entityType, entityId, details) {
  try {
    dbRun(
      `INSERT INTO audit_log (user_id, user_name, action, entity_type, entity_id, details, created_at)
       VALUES (?,?,?,?,?,?,?)`,
      [actor?.id || null, actor?.full_name || actor?.username || 'system', action, entityType,
        entityId || null, details ? JSON.stringify(details) : null, now()]
    );
  } catch (_) { /* ignore */ }
}

function roleOf(actor) {
  return String(actor?.role || '').toLowerCase();
}

/** Controllers who manage assignments in Admin Staff & HR */
function assertAdminController(actor) {
  if (!actor?.id) throw new Error('Authentication required');
  if (!['owner', 'manager', 'assistant_manager', 'admin'].includes(roleOf(actor))) {
    throw new Error('Admin access required to finalise decisions and manage this portal');
  }
  return actor;
}

/** Unrestricted portal view (all branches/employees) — Admin Access */
function isUnrestrictedAdmin(actor) {
  return ['owner', 'assistant_manager', 'admin'].includes(roleOf(actor));
}

function getActiveAssignment(actor) {
  ensureSchema();
  if (!actor?.id) return null;
  return dbGet(
    `SELECT a.*, b.name AS branch_name, u.full_name AS user_name, u.username, u.role AS user_role
     FROM manager_hr_assignments a
     LEFT JOIN branches b ON b.id = a.branch_id
     LEFT JOIN users u ON u.id = a.user_id
     WHERE a.user_id=? AND a.is_active=1`,
    [actor.id]
  );
}

function canAccessPortal(actor) {
  if (!actor?.id) return false;
  if (isUnrestrictedAdmin(actor)) return true;
  if (roleOf(actor) === 'owner') return true;
  if (['manager', 'assistant_manager', 'admin'].includes(roleOf(actor))) return true;
  return !!getActiveAssignment(actor);
}

function assertPortalAccess(actor) {
  if (!actor?.id) throw new Error('Authentication required');
  if (roleOf(actor) === 'owner' || isUnrestrictedAdmin(actor)) {
    return { admin_access: true, assignment: null };
  }
  // Manager/assistant_manager: Admin Access without assignment (no extra permission needed)
  if (['manager', 'assistant_manager', 'admin'].includes(roleOf(actor))) {
    const asg = getActiveAssignment(actor);
    if (asg) return { admin_access: false, assignment: asg };
    return { admin_access: true, assignment: null };
  }
  const asg = getActiveAssignment(actor);
  if (!asg) throw new Error('Manager/Supervisor Portal access is not assigned or is inactive');
  return { admin_access: false, assignment: asg };
}

function scopedEmployeeIds(actor) {
  const ctx = assertPortalAccess(actor);
  if (ctx.admin_access) return null; // null = all
  const rows = dbAll(
    'SELECT employee_id FROM manager_hr_assignment_employees WHERE assignment_id=?',
    [ctx.assignment.id]
  );
  return rows.map((r) => Number(r.employee_id));
}

function assertCanAccessEmployee(actor, employeeId) {
  const ids = scopedEmployeeIds(actor);
  if (ids == null) return true;
  if (!ids.includes(Number(employeeId))) {
    throw new Error('You are not authorised to manage this employee');
  }
  return true;
}

function assertCanAccessCase(actor, caseRow) {
  if (!caseRow) throw new Error('Case not found');
  const ctx = assertPortalAccess(actor);
  if (ctx.admin_access) return true;
  if (Number(caseRow.reported_by_user_id) === Number(actor.id)) return true;
  assertCanAccessEmployee(actor, caseRow.employee_id);
  return true;
}

/** Resolve employee id for Staff Portal case APIs (PIN session or Admin viewing a worker). */
function resolveEmployeePortalId(employeeActor, { forSubmit = false } = {}) {
  if (!employeeActor) throw new Error('Employee authentication required');
  let employeeId = Number(employeeActor.employee_id || 0);
  const role = roleOf(employeeActor);

  if (!employeeId && employeeActor.id) {
    const linked = dbGet('SELECT id FROM employees WHERE user_id=?', [employeeActor.id]);
    employeeId = linked?.id || 0;
  }
  if (!employeeId) throw new Error('Employee authentication required');

  // Submitting a response: only the employee themself (linked user or employee session)
  if (forSubmit) {
    if (['owner', 'manager', 'assistant_manager', 'supervisor', 'cashier'].includes(role)) {
      const linked = dbGet('SELECT id FROM employees WHERE user_id=?', [employeeActor.id]);
      if (!linked || Number(linked.id) !== Number(employeeId)) {
        throw new Error('Only the employee can submit a response to this case');
      }
    }
  }
  return employeeId;
}

function nextCaseNumber() {
  const year = new Date().getFullYear();
  const prefix = `CASE-${year}-`;
  const row = dbGet(
    `SELECT case_number FROM manager_hr_cases WHERE case_number LIKE ? ORDER BY id DESC LIMIT 1`,
    [`${prefix}%`]
  );
  let seq = 1;
  if (row?.case_number) {
    const m = String(row.case_number).match(/CASE-\d+-(\d+)/);
    if (m) seq = parseInt(m[1], 10) + 1;
  }
  return `${prefix}${String(seq).padStart(6, '0')}`;
}

function addEvent(caseId, actor, action, prev, next, notes, meta) {
  dbRun(
    `INSERT INTO manager_hr_case_events
      (case_id, actor_user_id, actor_role, actor_name, action, previous_status, new_status, notes, meta_json, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [caseId, actor?.id || null, roleOf(actor) || actor?.portal_role || null,
      actor?.full_name || actor?.username || null, action, prev || null, next || null,
      notes || null, meta ? JSON.stringify(meta) : null, now()]
  );
}

function notify({ audience, userId, employeeId, caseId, title, message }) {
  try {
    dbRun(
      `INSERT INTO manager_hr_notifications (audience, user_id, employee_id, case_id, title, message, created_at)
       VALUES (?,?,?,?,?,?,?)`,
      [audience, userId || null, employeeId || null, caseId || null, title, message || '', now()]
    );
  } catch (_) { /* ignore */ }
  if (audience === 'admin') {
    try {
      require('./store').addNotification('hr_mgr_case', title, message, {
        entity_type: 'manager_hr_case',
        entity_id: caseId,
        audience_roles: ['owner', 'manager', 'assistant_manager'],
        action_page: 'admin:staffhr'
      });
    } catch (_) { /* ignore */ }
  }
  if (audience === 'employee' && employeeId) {
    try {
      dbRun(
        `INSERT INTO employee_portal_feed (employee_id, feed_type, title, message, ref_id, is_read)
         VALUES (?,?,?,?,?,0)`,
        [employeeId, 'hr_case', title, message || '', caseId || null]
      );
    } catch (_) { /* ignore */ }
  }
}

function formatAssignment(row) {
  if (!row) return null;
  const employees = dbAll(
    `SELECT e.id, e.full_name, e.employee_code, e.position, e.branch, e.branch_id, e.status
     FROM manager_hr_assignment_employees s
     JOIN employees e ON e.id = s.employee_id
     WHERE s.assignment_id=? ORDER BY e.full_name`,
    [row.id]
  );
  return {
    ...row,
    is_active: !!Number(row.is_active),
    can_create_warnings: !!Number(row.can_create_warnings),
    can_recommend_recovery: !!Number(row.can_recommend_recovery),
    employees,
    employee_ids: employees.map((e) => e.id)
  };
}

function listAssignments(actor) {
  assertAdminController(actor);
  ensureSchema();
  const rows = dbAll(
    `SELECT a.*, u.full_name AS user_name, u.username, u.role AS user_role, b.name AS branch_name
     FROM manager_hr_assignments a
     LEFT JOIN users u ON u.id = a.user_id
     LEFT JOIN branches b ON b.id = a.branch_id
     ORDER BY a.is_active DESC, u.full_name`
  );
  return rows.map(formatAssignment);
}

function getAssignment(id, actor) {
  assertAdminController(actor);
  ensureSchema();
  const row = dbGet(
    `SELECT a.*, u.full_name AS user_name, u.username, u.role AS user_role, b.name AS branch_name
     FROM manager_hr_assignments a
     LEFT JOIN users u ON u.id = a.user_id
     LEFT JOIN branches b ON b.id = a.branch_id WHERE a.id=?`,
    [id]
  );
  return formatAssignment(row);
}

function saveAssignment(data = {}, actor) {
  assertAdminController(actor);
  ensureSchema();
  const userId = Number(data.user_id);
  if (!userId) throw new Error('Select a staff user account');
  const user = dbGet('SELECT id, role, full_name, is_active FROM users WHERE id=?', [userId]);
  if (!user) throw new Error('User not found');
  if (user.is_active === 0 || user.is_active === false || user.is_active === '0') {
    throw new Error('That user account is inactive');
  }
  const portalRole = String(data.portal_role || 'supervisor').toLowerCase() === 'manager' ? 'manager' : 'supervisor';
  // Promote login role when assigning a general worker so they can use the portal account normally
  const curRole = String(user.role || '').toLowerCase();
  if (!['owner', 'assistant_manager'].includes(curRole) && curRole !== portalRole) {
    try {
      dbRun('UPDATE users SET role=? WHERE id=?', [portalRole, userId]);
    } catch (_) { /* ignore if column locked */ }
  }
  const branchId = data.branch_id != null && data.branch_id !== '' ? Number(data.branch_id) : null;
  const active = data.is_active === false || data.is_active === 0 ? 0 : 1;
  const canWarn = data.can_create_warnings ? 1 : 0;
  const canRec = data.can_recommend_recovery === false || data.can_recommend_recovery === 0 ? 0 : 1;
  const empIds = Array.isArray(data.employee_ids)
    ? [...new Set(data.employee_ids.map(Number).filter((n) => n > 0))]
    : [];

  let id = data.id ? Number(data.id) : null;
  const existing = id
    ? dbGet('SELECT * FROM manager_hr_assignments WHERE id=?', [id])
    : dbGet('SELECT * FROM manager_hr_assignments WHERE user_id=?', [userId]);

  if (existing) {
    id = existing.id;
    dbRun(
      `UPDATE manager_hr_assignments SET portal_role=?, branch_id=?, is_active=?, can_create_warnings=?,
        can_recommend_recovery=?, notes=?, updated_by=?, updated_at=? WHERE id=?`,
      [portalRole, branchId, active, canWarn, canRec, text(data.notes), actor.id, now(), id]
    );
  } else {
    const r = dbRun(
      `INSERT INTO manager_hr_assignments
        (user_id, portal_role, branch_id, is_active, can_create_warnings, can_recommend_recovery, notes, created_by, updated_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [userId, portalRole, branchId, active, canWarn, canRec, text(data.notes), actor.id, actor.id, now(), now()]
    );
    id = Number(r?.lastInsertRowid) || 0;
    if (!id) {
      id = Number(dbGet('SELECT id FROM manager_hr_assignments WHERE user_id=?', [userId])?.id) || 0;
    }
    if (!id) throw new Error('Failed to create Manager/Supervisor assignment');
  }

  dbRun('DELETE FROM manager_hr_assignment_employees WHERE assignment_id=?', [id]);
  for (const eid of empIds) {
    const emp = dbGet('SELECT id FROM employees WHERE id=?', [eid]);
    if (!emp) continue;
    dbRun(
      'INSERT OR IGNORE INTO manager_hr_assignment_employees (assignment_id, employee_id) VALUES (?,?)',
      [id, eid]
    );
  }

  audit(actor, existing ? 'mgr_hr_assignment_update' : 'mgr_hr_assignment_create', 'manager_hr_assignment', id, {
    user_id: userId, portal_role: portalRole, branch_id: branchId, is_active: active, employee_ids: empIds
  });
  return getAssignment(id, actor);
}

function setAssignmentActive(id, active, actor) {
  assertAdminController(actor);
  ensureSchema();
  const row = dbGet('SELECT * FROM manager_hr_assignments WHERE id=?', [id]);
  if (!row) throw new Error('Assignment not found');
  dbRun(
    'UPDATE manager_hr_assignments SET is_active=?, updated_by=?, updated_at=? WHERE id=?',
    [active ? 1 : 0, actor.id, now(), id]
  );
  audit(actor, active ? 'mgr_hr_assignment_activate' : 'mgr_hr_assignment_revoke', 'manager_hr_assignment', id, {});
  return getAssignment(id, actor);
}

function getPortalContext(actor) {
  ensureSchema();
  const ctx = assertPortalAccess(actor);
  const adminAccess = !!ctx.admin_access || roleOf(actor) === 'owner';
  let employees = [];
  if (adminAccess) {
    employees = dbAll(
      `SELECT id, full_name, employee_code, position, branch, branch_id, status
       FROM employees WHERE LOWER(COALESCE(status,'')) NOT IN ('terminated','inactive','deleted')
       ORDER BY full_name LIMIT 500`
    );
  } else {
    employees = dbAll(
      `SELECT e.id, e.full_name, e.employee_code, e.position, e.branch, e.branch_id, e.status
       FROM manager_hr_assignment_employees s
       JOIN employees e ON e.id = s.employee_id
       WHERE s.assignment_id=? ORDER BY e.full_name`,
      [ctx.assignment.id]
    );
  }
  const branches = dbAll('SELECT id, name, code FROM branches WHERE COALESCE(is_active,1)=1 ORDER BY name');
  return {
    admin_access: adminAccess,
    mode: adminAccess ? 'admin' : (ctx.assignment?.portal_role || 'supervisor'),
    assignment: ctx.assignment ? formatAssignment(ctx.assignment) : null,
    actor: { id: actor.id, full_name: actor.full_name, username: actor.username, role: actor.role },
    employees,
    branches,
    incident_types: INCIDENT_TYPES,
    statuses: STATUSES,
    can_create_warnings: adminAccess || !!Number(ctx.assignment?.can_create_warnings)
  };
}

function listMyStaff(actor) {
  return getPortalContext(actor).employees;
}

function formatCaseBrief(row) {
  return {
    ...row,
    employee_name: row.employee_name || null,
    branch_name: row.branch_name || null,
    reporter_name: row.reporter_name || null,
    reported_loss: row.reported_loss != null ? num(row.reported_loss) : null
  };
}

function caseSelectSql() {
  return `SELECT c.*, e.full_name AS employee_name, e.employee_code, e.phone AS employee_phone, b.name AS branch_name,
    u.full_name AS reporter_name, cost.reported_loss, cost.recommended_recovery, cost.approved_recovery,
    cost.actual_payroll_deduction
    FROM manager_hr_cases c
    LEFT JOIN employees e ON e.id = c.employee_id
    LEFT JOIN branches b ON b.id = c.branch_id
    LEFT JOIN users u ON u.id = c.reported_by_user_id
    LEFT JOIN manager_hr_case_costs cost ON cost.case_id = c.id`;
}

function listCases(filters = {}, actor) {
  ensureSchema();
  const ctx = assertPortalAccess(actor);
  const where = ['1=1'];
  const params = [];
  if (!ctx.admin_access && roleOf(actor) !== 'owner') {
    const ids = scopedEmployeeIds(actor) || [];
    if (!ids.length) {
      where.push('(c.reported_by_user_id=?)');
      params.push(actor.id);
    } else {
      where.push(`(c.reported_by_user_id=? OR c.employee_id IN (${ids.map(() => '?').join(',')}))`);
      params.push(actor.id, ...ids);
    }
  }
  if (filters.status) { where.push('c.status=?'); params.push(filters.status); }
  if (filters.employee_id) { where.push('c.employee_id=?'); params.push(Number(filters.employee_id)); }
  if (filters.branch_id) { where.push('c.branch_id=?'); params.push(Number(filters.branch_id)); }
  if (filters.severity) { where.push('c.severity=?'); params.push(filters.severity); }
  if (filters.q) {
    where.push('(c.case_number LIKE ? OR e.full_name LIKE ? OR c.incident_type LIKE ?)');
    const q = `%${filters.q}%`;
    params.push(q, q, q);
  }
  const limit = Math.min(Number(filters.limit) || 100, 300);
  const includePreview = filters.include_response_preview !== false;
  const rows = dbAll(
    `${caseSelectSql()} WHERE ${where.join(' AND ')} ORDER BY c.id DESC LIMIT ${limit}`,
    params
  );
  if (!includePreview) return rows.map(formatCaseBrief);
  // One query for all last responses instead of N+1 (keeps portal fast)
  const ids = rows.map((r) => Number(r.id)).filter(Boolean);
  const lastByCase = {};
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    const lasts = dbAll(
      `SELECT r.case_id, r.response_text, r.agree_disagree, r.submitted_at, r.version
       FROM manager_hr_case_responses r
       INNER JOIN (
         SELECT case_id, MAX(version) AS mv FROM manager_hr_case_responses
         WHERE case_id IN (${placeholders}) GROUP BY case_id
       ) t ON t.case_id = r.case_id AND t.mv = r.version`,
      ids
    );
    for (const last of lasts) lastByCase[Number(last.case_id)] = last;
  }
  return rows.map((row) => {
    const brief = formatCaseBrief(row);
    const last = lastByCase[Number(row.id)];
    return {
      ...brief,
      has_response: !!last,
      last_response_preview: last?.response_text || null,
      last_response_agree: last?.agree_disagree || null,
      last_response_at: last?.submitted_at || null
    };
  });
}

function getCase(id, actor) {
  ensureSchema();
  const row = dbGet(`${caseSelectSql()} WHERE c.id=?`, [id]);
  if (!row) throw new Error('Case not found');
  assertCanAccessCase(actor, row);
  const events = dbAll(
    'SELECT * FROM manager_hr_case_events WHERE case_id=? ORDER BY id ASC',
    [id]
  );
  const responses = dbAll(
    'SELECT * FROM manager_hr_case_responses WHERE case_id=? ORDER BY version ASC',
    [id]
  );
  const recommendations = dbAll(
    `SELECT r.*, u.full_name AS recommended_by_name FROM manager_hr_case_recommendations r
     LEFT JOIN users u ON u.id = r.recommended_by WHERE r.case_id=? ORDER BY r.id ASC`,
    [id]
  );
  const cost = dbGet('SELECT * FROM manager_hr_case_costs WHERE case_id=?', [id]) || null;
  return {
    ...formatCaseBrief(row),
    evidence_paths: parseJson(row.evidence_paths, []),
    events,
    responses: responses.map((r) => ({ ...r, attachment_paths: parseJson(r.attachment_paths, []), is_locked: !!Number(r.is_locked) })),
    recommendations,
    cost
  };
}

function createCase(data = {}, actor) {
  ensureSchema();
  const ctx = assertPortalAccess(actor);
  const employeeId = Number(data.employee_id);
  if (!employeeId) throw new Error('Select an employee');
  assertCanAccessEmployee(actor, employeeId);
  const emp = dbGet('SELECT * FROM employees WHERE id=?', [employeeId]);
  if (!emp) throw new Error('Employee not found');

  const incidentType = text(data.incident_type) || 'Other';
  const severity = ['low', 'medium', 'high', 'critical'].includes(String(data.severity || '').toLowerCase())
    ? String(data.severity).toLowerCase()
    : 'medium';
  const requestResponse = data.request_employee_response !== false && data.request_employee_response !== 0;
  const status = requestResponse ? 'EMPLOYEE_RESPONSE_REQUESTED' : 'REPORTED';
  const caseNumber = nextCaseNumber();
  const branchId = data.branch_id != null && data.branch_id !== ''
    ? Number(data.branch_id)
    : (emp.branch_id || ctx.assignment?.branch_id || null);
  const evidence = Array.isArray(data.evidence_paths) ? data.evidence_paths : parseJson(data.evidence_paths, []);
  const portalRole = ctx.admin_access ? 'admin' : (ctx.assignment?.portal_role || roleOf(actor));

  const r = dbRun(
    `INSERT INTO manager_hr_cases
      (case_number, employee_id, branch_id, reported_by_user_id, reporter_portal_role,
       incident_date, incident_time, incident_type, severity, title, description, what_happened,
       witnesses, recommended_action, additional_notes, status, evidence_paths, decision_taken,
       created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [caseNumber, employeeId, branchId, actor.id, portalRole,
      text(data.incident_date) || now().slice(0, 10), text(data.incident_time),
      incidentType, severity, text(data.title) || incidentType, text(data.description),
      text(data.what_happened), text(data.witnesses), text(data.recommended_action),
      text(data.additional_notes), status, JSON.stringify(evidence),
      text(data.decision_taken) || text(data.decision),
      now(), now()]
  );
  let caseId = Number(r?.lastInsertRowid) || 0;
  if (!caseId) {
    caseId = Number(dbGet('SELECT id FROM manager_hr_cases WHERE case_number=?', [caseNumber])?.id) || 0;
  }
  if (!caseId) throw new Error('Failed to create case record');

  addEvent(caseId, actor, 'case_created', null, status,
    `Incident reported: ${incidentType}`, { admin_access: ctx.admin_access });

  const reportedLoss = num(data.reported_loss);
  const recRecovery = num(data.recommended_recovery);
  if (reportedLoss > 0 || recRecovery > 0 || data.cost_notes) {
    dbRun(
      `INSERT INTO manager_hr_case_costs
        (case_id, reported_loss, recommended_recovery, currency, notes, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?)`,
      [caseId, reportedLoss, recRecovery, text(data.currency) || 'R', text(data.cost_notes), now(), now()]
    );
  }

  notify({
    audience: 'admin',
    caseId,
    title: `New Manager/Supervisor case ${caseNumber}`,
    message: `${emp.full_name}: ${incidentType} (${severity})`
  });
  if (requestResponse) {
    notify({
      audience: 'employee',
      employeeId,
      caseId,
      title: 'You have been asked to respond to an HR/disciplinary matter',
      message: `Case ${caseNumber} — ${incidentType}. Open Staff Portal to respond.`
    });
  }
  if (severity === 'high' || severity === 'critical') {
    notify({
      audience: 'admin',
      caseId,
      title: `High-severity case ${caseNumber}`,
      message: `${severity.toUpperCase()}: ${emp.full_name} — ${incidentType}`
    });
  }

  audit(actor, 'mgr_hr_case_create', 'manager_hr_case', caseId, { case_number: caseNumber, employee_id: employeeId, status });
  return getCase(caseId, actor);
}

function updateCaseStatus(id, newStatus, notes, actor) {
  ensureSchema();
  const row = dbGet('SELECT * FROM manager_hr_cases WHERE id=?', [id]);
  if (!row) throw new Error('Case not found');
  assertCanAccessCase(actor, row);
  const next = String(newStatus || '').toUpperCase();
  if (!STATUSES.includes(next)) throw new Error('Invalid status');
  const prev = row.status;
  dbRun('UPDATE manager_hr_cases SET status=?, updated_at=? WHERE id=?', [next, now(), id]);
  if (next === 'CLOSED') {
    dbRun('UPDATE manager_hr_cases SET closed_at=? WHERE id=?', [now(), id]);
  }
  addEvent(id, actor, 'status_change', prev, next, notes || null);
  audit(actor, 'mgr_hr_case_status', 'manager_hr_case', id, { from: prev, to: next, notes });

  notify({
    audience: 'manager',
    userId: row.reported_by_user_id,
    caseId: id,
    title: `Case ${row.case_number} updated`,
    message: `Status: ${prev} → ${next}`
  });
  notify({
    audience: 'employee',
    employeeId: row.employee_id,
    caseId: id,
    title: `Case ${row.case_number} updated`,
    message: `Status is now ${next.replace(/_/g, ' ')}`
  });
  return getCase(id, actor);
}

function requestEmployeeResponse(id, notes, actor) {
  return updateCaseStatus(id, 'EMPLOYEE_RESPONSE_REQUESTED', notes || 'Employee response requested', actor);
}

function submitEmployeeResponse(caseId, data = {}, employeeActor) {
  ensureSchema();
  const employeeId = resolveEmployeePortalId(employeeActor, { forSubmit: true });

  const row = dbGet('SELECT * FROM manager_hr_cases WHERE id=?', [caseId]);
  if (!row) throw new Error('Case not found');
  if (Number(row.employee_id) !== Number(employeeId)) {
    throw new Error('You can only respond to your own case');
  }

  const last = dbGet(
    'SELECT MAX(version) AS v FROM manager_hr_case_responses WHERE case_id=?',
    [caseId]
  );
  const version = (Number(last?.v) || 0) + 1;
  const attachments = Array.isArray(data.attachment_paths) ? data.attachment_paths : parseJson(data.attachment_paths, []);

  dbRun(
    `INSERT INTO manager_hr_case_responses
      (case_id, employee_id, version, response_text, agree_disagree, explanation, supporting_info, attachment_paths, is_locked, submitted_at)
     VALUES (?,?,?,?,?,?,?,?,1,?)`,
    [caseId, employeeId, version, text(data.response_text) || text(data.response),
      text(data.agree_disagree), text(data.explanation), text(data.supporting_info),
      JSON.stringify(attachments), now()]
  );

  const prev = row.status;
  dbRun(
    'UPDATE manager_hr_cases SET status=?, updated_at=? WHERE id=?',
    ['EMPLOYEE_RESPONDED', now(), caseId]
  );
  const actor = {
    id: employeeActor.user_id || employeeActor.id || null,
    full_name: employeeActor.full_name || 'Employee',
    role: 'employee'
  };
  addEvent(caseId, actor, 'employee_response', prev, 'EMPLOYEE_RESPONDED',
    `Response v${version} submitted`, { version });

  const empName = text(employeeActor.full_name)
    || text(dbGet('SELECT full_name FROM employees WHERE id=?', [employeeId])?.full_name)
    || 'Employee';
  const replyPreview = (text(data.response_text) || text(data.response) || '').slice(0, 280);

  notify({
    audience: 'manager',
    userId: row.reported_by_user_id,
    caseId,
    title: `Employee response received — ${row.case_number}`,
    message: `Reply v${version}: ${replyPreview}`
  });
  notify({
    audience: 'admin',
    caseId,
    title: `Employee response — ${row.case_number}`,
    message: `${empName} replied (v${version}): ${replyPreview}`
  });
  audit(actor, 'mgr_hr_employee_response', 'manager_hr_case', caseId, { version });

  // Return employee-safe view
  return getEmployeeCase(caseId, employeeActor);
}

function addRecommendation(caseId, data = {}, actor) {
  ensureSchema();
  const row = dbGet('SELECT * FROM manager_hr_cases WHERE id=?', [caseId]);
  if (!row) throw new Error('Case not found');
  assertCanAccessCase(actor, row);

  dbRun(
    `INSERT INTO manager_hr_case_recommendations
      (case_id, recommended_by, recommendation_text, recommended_warning_type, recommended_recovery_amount, created_at)
     VALUES (?,?,?,?,?,?)`,
    [caseId, actor.id, text(data.recommendation_text) || text(data.recommended_action),
      text(data.recommended_warning_type), num(data.recommended_recovery_amount), now()]
  );

  const prev = row.status;
  dbRun(
    'UPDATE manager_hr_cases SET status=?, recommended_action=COALESCE(?, recommended_action), updated_at=? WHERE id=?',
    ['MANAGER_RECOMMENDATION', text(data.recommendation_text), now(), caseId]
  );

  const costAmt = num(data.recommended_recovery_amount);
  if (costAmt > 0) {
    const cost = dbGet('SELECT id FROM manager_hr_case_costs WHERE case_id=?', [caseId]);
    if (cost) {
      dbRun(
        'UPDATE manager_hr_case_costs SET recommended_recovery=?, updated_at=? WHERE case_id=?',
        [costAmt, now(), caseId]
      );
    } else {
      dbRun(
        `INSERT INTO manager_hr_case_costs (case_id, recommended_recovery, created_at, updated_at) VALUES (?,?,?,?)`,
        [caseId, costAmt, now(), now()]
      );
    }
  }

  addEvent(caseId, actor, 'recommendation', prev, 'MANAGER_RECOMMENDATION', text(data.recommendation_text));
  notify({
    audience: 'admin',
    caseId,
    title: `Recommendation ready — ${row.case_number}`,
    message: 'Manager/Supervisor submitted a recommendation for Admin review'
  });
  audit(actor, 'mgr_hr_recommendation', 'manager_hr_case', caseId, {});
  return updateCaseStatus(caseId, 'ADMIN_REVIEW', 'Escalated for Admin/HR review', actor);
}

function createWarningFromCase(caseId, data = {}, actor) {
  ensureSchema();
  const ctx = assertPortalAccess(actor);
  const canWarn = ctx.admin_access || roleOf(actor) === 'owner' || !!Number(ctx.assignment?.can_create_warnings);
  if (!canWarn) throw new Error('You do not have permission to create warnings');

  const row = dbGet('SELECT * FROM manager_hr_cases WHERE id=?', [caseId]);
  if (!row) throw new Error('Case not found');
  assertCanAccessCase(actor, row);

  const staff = require('./staff');
  const disc = staff.saveDisciplinary({
    employee_id: row.employee_id,
    record_type: text(data.record_type) || text(data.warning_type) || 'Warning',
    incident_date: row.incident_date || now().slice(0, 10),
    description: text(data.description) || `${row.incident_type}: ${row.description || row.what_happened || ''}`.trim(),
    action_taken: text(data.action_taken) || row.recommended_action || 'Warning issued',
    notes: `Linked to ${row.case_number}. ${text(data.notes) || ''}`.trim(),
    requires_response: data.requires_response !== false,
    status: 'open'
  }, actor.id);

  const warningId = disc?.id || disc?.data?.id || disc?.lastInsertRowid;
  if (warningId) {
    dbRun('UPDATE manager_hr_cases SET warning_id=?, updated_at=? WHERE id=?', [warningId, now(), caseId]);
  }
  addEvent(caseId, actor, 'warning_created', row.status, row.status,
    `Warning linked (${data.record_type || 'Warning'})`, { warning_id: warningId });
  notify({
    audience: 'employee',
    employeeId: row.employee_id,
    caseId,
    title: 'Warning issued',
    message: `A warning was issued related to case ${row.case_number}`
  });
  audit(actor, 'mgr_hr_warning', 'manager_hr_case', caseId, { warning_id: warningId });
  return getCase(caseId, actor);
}

function adminDecide(caseId, data = {}, actor) {
  ensureSchema();
  assertAdminController(actor);
  const row = dbGet('SELECT * FROM manager_hr_cases WHERE id=?', [caseId]);
  if (!row) throw new Error('Case not found');

  const decision = text(data.final_decision) || text(data.decision) || 'Decision recorded';
  const notes = text(data.final_decision_notes) || text(data.notes);
  const prev = row.status;
  dbRun(
    `UPDATE manager_hr_cases SET status=?, final_decision=?, final_decision_notes=?, decided_by=?, decided_at=?, updated_at=? WHERE id=?`,
    ['DECISION', decision, notes, actor.id, now(), now(), caseId]
  );

  const approved = num(data.approved_recovery);
  if (approved > 0 || data.approve_recovery) {
    const cost = dbGet('SELECT id FROM manager_hr_case_costs WHERE case_id=?', [caseId]);
    if (cost) {
      dbRun(
        `UPDATE manager_hr_case_costs SET approved_recovery=?, approved_by=?, approved_at=?, updated_at=? WHERE case_id=?`,
        [approved, actor.id, now(), now(), caseId]
      );
    } else if (approved > 0) {
      dbRun(
        `INSERT INTO manager_hr_case_costs (case_id, approved_recovery, approved_by, approved_at, created_at, updated_at)
         VALUES (?,?,?,?,?,?)`,
        [caseId, approved, actor.id, now(), now(), now()]
      );
    }
  }

  addEvent(caseId, actor, 'admin_decision', prev, 'DECISION', notes || decision, {
    approved_recovery: approved || 0,
    note: 'Approved recovery is NOT an automatic payroll deduction'
  });
  notify({
    audience: 'manager',
    userId: row.reported_by_user_id,
    caseId,
    title: `Admin decision — ${row.case_number}`,
    message: decision
  });
  notify({
    audience: 'employee',
    employeeId: row.employee_id,
    caseId,
    title: `Decision on case ${row.case_number}`,
    message: decision
  });
  audit(actor, 'mgr_hr_admin_decision', 'manager_hr_case', caseId, { decision, approved_recovery: approved });

  if (data.close) {
    return updateCaseStatus(caseId, 'CLOSED', 'Case closed after decision', actor);
  }
  return getCase(caseId, actor);
}

function deleteCase(caseId, actor) {
  ensureSchema();
  assertAdminController(actor);
  const row = dbGet('SELECT id, case_number FROM manager_hr_cases WHERE id=?', [caseId]);
  if (!row) throw new Error('Case not found');
  dbRun('DELETE FROM manager_hr_case_events WHERE case_id=?', [caseId]);
  dbRun('DELETE FROM manager_hr_case_responses WHERE case_id=?', [caseId]);
  dbRun('DELETE FROM manager_hr_case_recommendations WHERE case_id=?', [caseId]);
  dbRun('DELETE FROM manager_hr_case_costs WHERE case_id=?', [caseId]);
  try { dbRun('DELETE FROM manager_hr_notifications WHERE case_id=?', [caseId]); } catch (_) { /* ignore */ }
  try { dbRun('UPDATE manager_hr_recordings SET case_id=NULL WHERE case_id=?', [caseId]); } catch (_) { /* ignore */ }
  dbRun('DELETE FROM manager_hr_cases WHERE id=?', [caseId]);
  audit(actor, 'mgr_hr_case_delete', 'manager_hr_case', caseId, { case_number: row.case_number });
  return { success: true, id: Number(caseId), case_number: row.case_number };
}

function dashboard(actor) {
  ensureSchema();
  assertPortalAccess(actor);
  const cases = listCases({ limit: 200 }, actor);
  const open = cases.filter((c) => c.status !== 'CLOSED' && c.status !== 'DECISION');
  const pendingResponses = cases.filter((c) => c.status === 'EMPLOYEE_RESPONSE_REQUESTED');
  const responded = cases.filter((c) => c.status === 'EMPLOYEE_RESPONDED');
  const needingAction = cases.filter((c) =>
    ['REPORTED', 'EMPLOYEE_RESPONDED', 'MANAGER_RECOMMENDATION', 'ADMIN_REVIEW'].includes(c.status));
  const warnings = cases.filter((c) => c.warning_id);
  return {
    counts: {
      open: open.length,
      pending_responses: pendingResponses.length,
      responded: responded.length,
      needing_action: needingAction.length,
      warnings: warnings.length,
      total: cases.length
    },
    open_cases: open.slice(0, 15),
    pending_responses: pendingResponses.slice(0, 15),
    recent: cases.slice(0, 15),
    needing_action: needingAction.slice(0, 15)
  };
}

function listNotifications(actor, audience) {
  ensureSchema();
  if (audience === 'employee') {
    const employeeId = Number(actor.employee_id || 0);
    return dbAll(
      `SELECT * FROM manager_hr_notifications WHERE audience='employee' AND employee_id=? ORDER BY id DESC LIMIT 50`,
      [employeeId]
    );
  }
  assertPortalAccess(actor);
  if (isUnrestrictedAdmin(actor) || roleOf(actor) === 'owner' || roleOf(actor) === 'manager') {
    return dbAll(
      `SELECT * FROM manager_hr_notifications WHERE audience='admin' OR user_id=? ORDER BY id DESC LIMIT 50`,
      [actor.id]
    );
  }
  return dbAll(
    `SELECT * FROM manager_hr_notifications WHERE user_id=? ORDER BY id DESC LIMIT 50`,
    [actor.id]
  );
}

function markNotificationRead(id, actor) {
  ensureSchema();
  dbRun('UPDATE manager_hr_notifications SET is_read=1 WHERE id=?', [id]);
  return { success: true };
}

function listEmployeeCases(employeeActor) {
  ensureSchema();
  const employeeId = resolveEmployeePortalId(employeeActor, { forSubmit: false });
  return dbAll(
    `${caseSelectSql()} WHERE c.employee_id=? ORDER BY c.id DESC LIMIT 50`,
    [employeeId]
  ).map((row) => {
    const brief = formatCaseBrief(row);
    const respCount = Number(dbGet(
      'SELECT COUNT(*) AS n FROM manager_hr_case_responses WHERE case_id=?',
      [row.id]
    )?.n) || 0;
    return {
      ...brief,
      has_response: respCount > 0,
      employee_responded: respCount > 0 || brief.status === 'EMPLOYEE_RESPONDED'
    };
  });
}

function getEmployeeCase(caseId, employeeActor) {
  ensureSchema();
  const employeeId = resolveEmployeePortalId(employeeActor, { forSubmit: false });
  const row = dbGet(`${caseSelectSql()} WHERE c.id=?`, [caseId]);
  if (!row || Number(row.employee_id) !== Number(employeeId)) {
    throw new Error('Case not found');
  }
  const responses = dbAll(
    'SELECT * FROM manager_hr_case_responses WHERE case_id=? ORDER BY version ASC',
    [caseId]
  );
  const events = dbAll(
    `SELECT id, action, previous_status, new_status, notes, created_at, actor_name
     FROM manager_hr_case_events WHERE case_id=? ORDER BY id ASC`,
    [caseId]
  );
  return {
    id: row.id,
    case_number: row.case_number,
    incident_type: row.incident_type,
    severity: row.severity,
    incident_date: row.incident_date,
    incident_time: row.incident_time,
    title: row.title,
    description: row.description,
    what_happened: row.what_happened,
    status: row.status,
    final_decision: row.final_decision,
    final_decision_notes: row.final_decision_notes,
    branch_name: row.branch_name,
    evidence_paths: parseJson(row.evidence_paths, []),
    responses: responses.map((r) => ({
      ...r,
      attachment_paths: parseJson(r.attachment_paths, []),
      is_locked: !!Number(r.is_locked)
    })),
    events,
    can_respond: !['CLOSED', 'DECISION'].includes(String(row.status || ''))
  };
}

function listEligibleUsers(actor) {
  assertAdminController(actor);
  // Admin may assign ANY active system user (cashier, cook, etc.) — portal_role is set on the assignment.
  return dbAll(
    `SELECT u.id, u.full_name, u.username, u.role, u.branch_id, u.is_active,
            e.id AS employee_id, e.employee_code, e.position
     FROM users u
     LEFT JOIN employees e ON e.user_id = u.id
     WHERE COALESCE(u.is_active, 1) = 1
     ORDER BY u.full_name`
  );
}

function listActivity(filters = {}, actor) {
  assertAdminController(actor);
  ensureSchema();
  const where = ["entity_type IN ('manager_hr_assignment','manager_hr_case','manager_hr_recording')"];
  const params = [];
  if (filters.user_id) {
    where.push('user_id=?');
    params.push(Number(filters.user_id));
  }
  return dbAll(
    `SELECT * FROM audit_log WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT 100`,
    params
  );
}

function nextRecordingNumber() {
  const d = now().slice(0, 10).replace(/-/g, '');
  const n = num(dbGet(`SELECT COUNT(*) AS c FROM manager_hr_recordings WHERE recording_number LIKE ?`, [`REC-${d}-%`])?.c) + 1;
  return `REC-${d}-${String(n).padStart(3, '0')}`;
}

function formatRecording(row, { includeAudio = true } = {}) {
  if (!row) return null;
  const out = {
    ...row,
    duration_seconds: num(row.duration_seconds),
    ai_key_points: parseJson(row.ai_key_points_json, []),
    admin_highlights: parseJson(row.admin_highlights_json, []),
    has_audio: row.has_audio != null ? !!Number(row.has_audio) : !!(row.audio_data && String(row.audio_data).length > 32)
  };
  if (!includeAudio) delete out.audio_data;
  return out;
}

function buildParagraphs(text, maxLines = 6) {
  const clean = String(text || '').replace(/\r/g, '').trim();
  if (!clean) return [];
  const words = clean.split(/\s+/).filter(Boolean);
  const wordsPerPara = 14 * maxLines;
  const paras = [];
  for (let i = 0; i < words.length; i += wordsPerPara) {
    paras.push(words.slice(i, i + wordsPerPara).join(' '));
  }
  return paras.length ? paras : [clean];
}

function localAiAnalyze(transcript, parties) {
  const paras = buildParagraphs(transcript, 6);
  const sentences = String(transcript || '')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20);
  const keyPoints = sentences.slice(0, 8);
  const summary = paras.slice(0, 3).join('\n\n') || (keyPoints.join(' ') || 'No transcript available to summarise.');
  const suggested = keyPoints.length
    ? `Based on the recorded conversation between ${parties.party_a || 'Party A'} and ${parties.party_b || 'Party B'}, consider: review the key points, confirm facts with both parties, and record a written decision.`
    : 'Add or complete the transcript so a decision can be suggested.';
  return {
    transcript_summary: summary,
    ai_key_points: keyPoints.length ? keyPoints : paras.slice(0, 5),
    ai_suggested_decision: suggested,
    ai_status: 'ready_local'
  };
}

async function runRecordingAi(transcript, parties) {
  const apiKey = process.env.SHOP_POS_AI_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) return localAiAnalyze(transcript, parties);
  const prompt = `You are an HR assistant. Analyze this workplace recording transcript.
Return JSON with keys:
- transcript_summary: clear multi-paragraph summary (each paragraph about 4-6 lines)
- ai_key_points: array of important factual points
- ai_suggested_decision: suggested HR/management decision and next steps
Only use what is in the transcript. Parties: ${parties.party_a || 'A'} and ${parties.party_b || 'B'}.

Transcript:
${transcript}`;
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.SHOP_POS_AI_MODEL || 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' }
      })
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error?.message || 'AI API error');
    const content = JSON.parse(json.choices?.[0]?.message?.content || '{}');
    return {
      transcript_summary: text(content.transcript_summary) || localAiAnalyze(transcript, parties).transcript_summary,
      ai_key_points: Array.isArray(content.ai_key_points) ? content.ai_key_points : [],
      ai_suggested_decision: text(content.ai_suggested_decision) || '',
      ai_status: 'ready'
    };
  } catch (err) {
    const fallback = localAiAnalyze(transcript, parties);
    fallback.ai_status = 'ready_local';
    fallback.ai_suggested_decision = `${fallback.ai_suggested_decision} (AI service unavailable: ${err.message})`;
    return fallback;
  }
}

function createRecording(data = {}, actor) {
  ensureSchema();
  assertPortalAccess(actor);
  const partyA = text(data.party_a);
  const partyB = text(data.party_b);
  if (!partyA || !partyB) throw new Error('Enter both people in the conversation / hearing');
  const audio = text(data.audio_data);
  if (!audio || !String(audio).startsWith('data:')) throw new Error('Recording audio is required');
  if (String(audio).length > 12_000_000) throw new Error('Recording is too large — keep it shorter and try again');
  const transcript = text(data.transcript_original) || text(data.transcript) || '';
  const recNo = nextRecordingNumber();
  const convType = text(data.conversation_type) || 'conversation';
  const title = text(data.title) || `${convType === 'hearing' ? 'Hearing' : 'Conversation'}: ${partyA} & ${partyB}`;
  const mime = text(data.audio_mime) || (String(audio).match(/^data:([^;]+);/) || [])[1] || 'audio/webm';

  const r = dbRun(
    `INSERT INTO manager_hr_recordings
      (recording_number, title, party_a, party_b, conversation_type, recorded_by_user_id, recorded_by_name,
       branch_id, case_id, audio_mime, audio_data, duration_seconds, transcript_original, ai_status,
       created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?)`,
    [recNo, title, partyA, partyB, convType, actor.id, actor.full_name || actor.username,
      data.branch_id != null && data.branch_id !== '' ? Number(data.branch_id) : null,
      data.case_id ? Number(data.case_id) : null, mime, audio, num(data.duration_seconds),
      transcript, now(), now()]
  );
  let id = Number(r?.lastInsertRowid) || 0;
  if (!id) {
    id = Number(dbGet('SELECT id FROM manager_hr_recordings WHERE recording_number=?', [recNo])?.id) || 0;
  }
  if (!id) throw new Error('Failed to save recording');

  notify({
    audience: 'admin',
    title: `New portal recording ${recNo}`,
    message: `${title} — recorded by ${actor.full_name || actor.username}`
  });
  audit(actor, 'mgr_hr_recording_create', 'manager_hr_recording', id, { recording_number: recNo, party_a: partyA, party_b: partyB });
  return getRecording(id, actor);
}

async function analyzeRecording(id, data = {}, actor) {
  ensureSchema();
  assertPortalAccess(actor);
  const row = dbGet('SELECT * FROM manager_hr_recordings WHERE id=?', [id]);
  if (!row) throw new Error('Recording not found');
  if (!isUnrestrictedAdmin(actor) && Number(row.recorded_by_user_id) !== Number(actor.id)) {
    assertAdminController(actor);
  }
  let transcript = text(data.transcript_original) || text(data.transcript) || row.transcript_original;
  if (data.transcript_original != null || data.transcript != null) {
    dbRun('UPDATE manager_hr_recordings SET transcript_original=?, updated_at=? WHERE id=?',
      [transcript, now(), id]);
  }
  if (!transcript) throw new Error('Add a transcript (or speak during recording) before AI analysis');

  const ai = await runRecordingAi(transcript, { party_a: row.party_a, party_b: row.party_b });
  dbRun(
    `UPDATE manager_hr_recordings SET transcript_summary=?, ai_key_points_json=?, ai_suggested_decision=?,
      ai_status=?, updated_at=? WHERE id=?`,
    [ai.transcript_summary, JSON.stringify(ai.ai_key_points || []), ai.ai_suggested_decision,
      ai.ai_status || 'ready', now(), id]
  );
  audit(actor, 'mgr_hr_recording_ai', 'manager_hr_recording', id, { ai_status: ai.ai_status });
  return getRecording(id, actor);
}

function getRecording(id, actor) {
  ensureSchema();
  assertPortalAccess(actor);
  const row = dbGet('SELECT * FROM manager_hr_recordings WHERE id=?', [id]);
  if (!row) throw new Error('Recording not found');
  if (!isUnrestrictedAdmin(actor) && Number(row.recorded_by_user_id) !== Number(actor.id)) {
    try { assertAdminController(actor); } catch (_) {
      throw new Error('Access denied');
    }
  }
  return formatRecording(row, { includeAudio: true });
}

function listRecordings(filters = {}, actor) {
  ensureSchema();
  assertPortalAccess(actor);
  let admin = isUnrestrictedAdmin(actor);
  if (!admin) {
    try { assertAdminController(actor); admin = true; } catch (_) { admin = false; }
  }
  const rows = admin
    ? dbAll(`SELECT id, recording_number, title, party_a, party_b, conversation_type, recorded_by_name,
        duration_seconds, ai_status, transcript_summary, ai_suggested_decision, final_decision,
        created_at, updated_at, CASE WHEN audio_data IS NOT NULL AND length(audio_data)>32 THEN 1 ELSE 0 END AS has_audio
      FROM manager_hr_recordings ORDER BY id DESC LIMIT 200`)
    : dbAll(`SELECT id, recording_number, title, party_a, party_b, conversation_type, recorded_by_name,
        duration_seconds, ai_status, transcript_summary, ai_suggested_decision, final_decision,
        created_at, updated_at, CASE WHEN audio_data IS NOT NULL AND length(audio_data)>32 THEN 1 ELSE 0 END AS has_audio
      FROM manager_hr_recordings WHERE recorded_by_user_id=? ORDER BY id DESC LIMIT 200`, [actor.id]);
  return rows.map((r) => formatRecording(r, { includeAudio: false }));
}

function updateRecording(id, data = {}, actor) {
  ensureSchema();
  const row = dbGet('SELECT * FROM manager_hr_recordings WHERE id=?', [id]);
  if (!row) throw new Error('Recording not found');
  if (!isUnrestrictedAdmin(actor) && Number(row.recorded_by_user_id) !== Number(actor.id)) {
    assertAdminController(actor);
  }
  const highlights = data.admin_highlights !== undefined
    ? JSON.stringify(Array.isArray(data.admin_highlights) ? data.admin_highlights : parseJson(data.admin_highlights, []))
    : row.admin_highlights_json;
  dbRun(
    `UPDATE manager_hr_recordings SET
      transcript_original=COALESCE(?, transcript_original),
      transcript_summary=COALESCE(?, transcript_summary),
      final_decision=COALESCE(?, final_decision),
      admin_highlights_json=?,
      title=COALESCE(?, title),
      updated_at=?
     WHERE id=?`,
    [
      data.transcript_original !== undefined ? text(data.transcript_original) : null,
      data.transcript_summary !== undefined ? text(data.transcript_summary) : null,
      data.final_decision !== undefined ? text(data.final_decision) : null,
      highlights,
      data.title !== undefined ? text(data.title) : null,
      now(), id
    ]
  );
  audit(actor, 'mgr_hr_recording_update', 'manager_hr_recording', id, { fields: Object.keys(data || {}) });
  return getRecording(id, actor);
}

function deleteRecording(id, actor) {
  ensureSchema();
  assertAdminController(actor);
  const row = dbGet('SELECT id, recording_number FROM manager_hr_recordings WHERE id=?', [id]);
  if (!row) throw new Error('Recording not found');
  dbRun('DELETE FROM manager_hr_recordings WHERE id=?', [id]);
  audit(actor, 'mgr_hr_recording_delete', 'manager_hr_recording', id, { recording_number: row.recording_number });
  return { success: true, id: Number(id) };
}

function buildRecordingDocumentHtml(rec, shopName) {
  const shop = shopName || 'Company';
  const originalParas = buildParagraphs(rec.transcript_original || '', 6);
  const summaryParas = buildParagraphs(rec.transcript_summary || '', 6);
  const highlights = Array.isArray(rec.admin_highlights) ? rec.admin_highlights : [];
  const applyHighlights = (raw) => {
    let t = String(raw || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    for (const h of highlights) {
      const phrase = String(h?.text || h || '').trim();
      if (!phrase || phrase.length < 3) continue;
      const safe = phrase.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      t = t.split(safe).join(`<mark>${safe}</mark>`);
    }
    return t;
  };
  const points = Array.isArray(rec.ai_key_points) ? rec.ai_key_points : [];
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${rec.recording_number || 'Recording'}</title>
  <style>
    @page { size: A4; margin: 18mm; }
    body { font-family: Georgia, 'Times New Roman', serif; color: #111; font-size: 12pt; line-height: 1.55; }
    h1 { text-align: center; font-size: 16pt; margin: 0 0 6px; }
    .meta { text-align: center; color: #444; font-size: 10pt; margin-bottom: 18px; }
    h2 { font-size: 12pt; margin: 18px 0 8px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
    p { margin: 0 0 12px; text-align: justify; }
    mark { background: #fef08a; }
    ul { margin: 0 0 12px 18px; }
    .foot { margin-top: 28px; padding-top: 10px; border-top: 1px solid #ccc; font-size: 10pt; color: #333; }
  </style></head><body>
  <h1>${String(shop).replace(/</g, '')}</h1>
  <div class="meta">
    <strong>${rec.conversation_type === 'hearing' ? 'Hearing record' : 'Conversation record'}</strong><br>
    Between <strong>${applyHighlights(rec.party_a || '—')}</strong> and <strong>${applyHighlights(rec.party_b || '—')}</strong><br>
    ${rec.recording_number || ''} · Recorded by ${applyHighlights(rec.recorded_by_name || '—')}
  </div>
  <h2>Original transcript</h2>
  ${originalParas.map((p) => `<p>${applyHighlights(p)}</p>`).join('') || '<p>—</p>'}
  <h2>AI summary / key points</h2>
  ${summaryParas.map((p) => `<p>${applyHighlights(p)}</p>`).join('') || '<p>—</p>'}
  ${points.length ? `<ul>${points.map((p) => `<li>${applyHighlights(p)}</li>`).join('')}</ul>` : ''}
  <h2>AI suggested decision</h2>
  <p>${applyHighlights(rec.ai_suggested_decision || '—')}</p>
  <h2>Decision taken</h2>
  <p>${applyHighlights(rec.final_decision || '—')}</p>
  <div class="foot">
    Date &amp; time of recording: ${rec.created_at || '—'}<br>
    Duration: ${num(rec.duration_seconds)} seconds<br>
    Document generated: ${now()}
  </div>
  </body></html>`;
}

function escHtmlDoc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildCaseDocumentHtml(c, shopInfo = {}) {
  const shop = shopInfo.shop_name || shopInfo.name || 'Company';
  const address = shopInfo.address || '';
  const phone = shopInfo.phone || '';
  const email = shopInfo.email || '';
  const responses = Array.isArray(c.responses) ? c.responses : [];
  const recommendations = Array.isArray(c.recommendations) ? c.recommendations : [];
  const events = Array.isArray(c.events) ? c.events : [];
  const cost = c.cost || {};
  const paras = (raw) => buildParagraphs(raw || '', 5).map((p) => `<p>${escHtmlDoc(p)}</p>`).join('') || '<p>—</p>';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escHtmlDoc(c.case_number || 'Case')}</title>
  <style>
    @page { size: A4; margin: 16mm; }
    body { font-family: Georgia, 'Times New Roman', serif; color: #111; font-size: 11.5pt; line-height: 1.5; }
    h1 { text-align: center; font-size: 18pt; margin: 0 0 4px; }
    .sub { text-align: center; color: #444; font-size: 10pt; margin-bottom: 6px; }
    .meta { text-align: center; margin-bottom: 16px; font-size: 10.5pt; }
    h2 { font-size: 12pt; margin: 16px 0 8px; border-bottom: 1px solid #bbb; padding-bottom: 3px; }
    p { margin: 0 0 10px; text-align: justify; }
    table { width: 100%; border-collapse: collapse; margin: 8px 0 14px; font-size: 10.5pt; }
    th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; vertical-align: top; }
    th { background: #f3f4f6; width: 32%; }
    .box { border: 1px solid #ddd; border-radius: 6px; padding: 10px; margin-bottom: 10px; }
    .foot { margin-top: 24px; padding-top: 10px; border-top: 1px solid #ccc; font-size: 9.5pt; color: #444; }
  </style></head><body>
  <h1>${escHtmlDoc(shop)}</h1>
  <div class="sub">${[address, phone, email].filter(Boolean).map(escHtmlDoc).join(' · ')}</div>
  <div class="meta">
    <strong>Manager / Supervisor HR Case</strong><br>
    Case number: <strong>${escHtmlDoc(c.case_number || '—')}</strong>
    ${c.title ? ` · ${escHtmlDoc(c.title)}` : ''}
  </div>
  <table>
    <tr><th>Employee</th><td>${escHtmlDoc(c.employee_name || '')} ${c.employee_code ? `(${escHtmlDoc(c.employee_code)})` : ''}</td></tr>
    <tr><th>Branch</th><td>${escHtmlDoc(c.branch_name || '—')}</td></tr>
    <tr><th>Reported by</th><td>${escHtmlDoc(c.reporter_name || '—')}</td></tr>
    <tr><th>Incident date</th><td>${escHtmlDoc(c.incident_date || '—')} ${escHtmlDoc(c.incident_time || '')}</td></tr>
    <tr><th>Type / severity</th><td>${escHtmlDoc(c.incident_type || '—')} · ${escHtmlDoc(c.severity || '—')}</td></tr>
    <tr><th>Status</th><td>${escHtmlDoc(String(c.status || '').replace(/_/g, ' '))}</td></tr>
  </table>
  <h2>Incident details</h2>
  ${paras(c.description)}
  <h2>What happened</h2>
  ${paras(c.what_happened)}
  <h2>Witnesses</h2>
  <p>${escHtmlDoc(c.witnesses || '—')}</p>
  <h2>Decision taken (at report)</h2>
  ${paras(c.decision_taken || '—')}
  <h2>Recommended action</h2>
  ${paras(c.recommended_action || '—')}
  <h2>Costs</h2>
  <p>Reported loss: ${escHtmlDoc(cost.reported_loss ?? c.reported_loss ?? '0')} ·
     Recommended recovery: ${escHtmlDoc(cost.recommended_recovery ?? c.recommended_recovery ?? '0')} ·
     Approved recovery: ${escHtmlDoc(cost.approved_recovery ?? c.approved_recovery ?? '0')}
     (approved recovery is not an automatic payroll deduction)</p>
  <h2>Employee responses</h2>
  ${responses.length ? responses.map((r) => `<div class="box">
    <strong>Version ${escHtmlDoc(r.version)}</strong>
    ${r.agree_disagree ? ` · Position: ${escHtmlDoc(r.agree_disagree)}` : ''}<br>
    <small>${escHtmlDoc(r.submitted_at || '')}</small>
    ${paras(r.response_text)}
    ${r.explanation ? `<p><em>Further details:</em> ${escHtmlDoc(r.explanation)}</p>` : ''}
    ${r.supporting_info ? `<p><em>Supporting information:</em> ${escHtmlDoc(r.supporting_info)}</p>` : ''}
  </div>`).join('') : '<p>No employee response submitted.</p>'}
  <h2>Recommendations</h2>
  ${recommendations.length ? recommendations.map((r) => `<div class="box">
    <strong>${escHtmlDoc(r.recommended_by_name || 'Manager')}</strong>
    ${paras(r.recommendation_text)}
    ${r.recommended_recovery_amount ? `<p>Recovery: ${escHtmlDoc(r.recommended_recovery_amount)}</p>` : ''}
  </div>`).join('') : '<p>No recommendations yet.</p>'}
  <h2>Final Admin / HR decision</h2>
  ${paras(c.final_decision || '—')}
  ${c.final_decision_notes ? paras(c.final_decision_notes) : ''}
  <h2>Status history</h2>
  ${events.length ? `<ul>${events.map((e) => `<li><strong>${escHtmlDoc(e.action)}</strong>
    ${e.previous_status ? `${escHtmlDoc(e.previous_status)} → ${escHtmlDoc(e.new_status)}` : ''}
    — ${escHtmlDoc(e.actor_name || '')} · ${escHtmlDoc(String(e.created_at || '').slice(0, 16))}
    ${e.notes ? `<br>${escHtmlDoc(e.notes)}` : ''}</li>`).join('')}</ul>` : '<p>—</p>'}
  <div class="foot">
    Document generated: ${now()}<br>
    ${escHtmlDoc(shop)} — confidential HR record
  </div>
  </body></html>`;
}

module.exports = {
  INCIDENT_TYPES,
  STATUSES,
  ensureSchema,
  listAssignments,
  getAssignment,
  saveAssignment,
  setAssignmentActive,
  listEligibleUsers,
  listActivity,
  getPortalContext,
  listMyStaff,
  dashboard,
  createCase,
  getCase,
  listCases,
  updateCaseStatus,
  requestEmployeeResponse,
  submitEmployeeResponse,
  addRecommendation,
  createWarningFromCase,
  adminDecide,
  deleteCase,
  listNotifications,
  markNotificationRead,
  listEmployeeCases,
  getEmployeeCase,
  canAccessPortal,
  isUnrestrictedAdmin,
  createRecording,
  getRecording,
  listRecordings,
  updateRecording,
  deleteRecording,
  analyzeRecording,
  buildRecordingDocumentHtml,
  buildCaseDocumentHtml
};

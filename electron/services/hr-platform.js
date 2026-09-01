/**
 * HR, Payroll & Documents — unified platform service
 * Reuses employees, staff, hr-contracts, payroll-compliance — no duplicate records.
 */
const crypto = require('crypto');
const { getDb } = require('../database/db');

const HR_ROLES = new Set(['owner', 'manager', 'supervisor', 'assistant_manager', 'admin']);

function db() { return getDb(); }
function dbGet(sql, p = []) { return db().prepare(sql).get(...p); }
function dbAll(sql, p = []) { return db().prepare(sql).all(...p); }
function dbRun(sql, p = []) { return db().run(sql, ...p); }
function today() { return new Date().toLocaleDateString('en-CA'); }
function num(v, fb = 0) { const n = Number(v); return Number.isFinite(n) ? n : fb; }
function textOrNull(v) { const s = v == null ? '' : String(v).trim(); return s || null; }
function round2(n) { return Math.round(num(n) * 100) / 100; }

function parseJson(val, fb = {}) {
  if (!val) return fb;
  if (typeof val === 'object') return val;
  try { return JSON.parse(val); } catch (_) { return fb; }
}

function audit(actor, action, entityType, entityId, details) {
  try {
    const id = actor?.id || actor?.user_id || null;
    const name = actor?.full_name || actor?.username || 'system';
    dbRun(
      `INSERT INTO audit_log (user_id, user_name, action, entity_type, entity_id, details, created_at)
       VALUES (?,?,?,?,?,?,datetime('now'))`,
      [id, name, action, entityType, entityId || null, details ? JSON.stringify(details) : null]
    );
  } catch (_) { /* ignore */ }
}

function requireHrUser(actor) {
  if (!actor || !actor.id) throw new Error('Authentication required');
  const role = String(actor.role || '').toLowerCase();
  if (!HR_ROLES.has(role)) throw new Error('Not authorized for HR & Payroll');
  return actor;
}

function requireHrWrite(actor) {
  const user = requireHrUser(actor);
  if (!['owner', 'manager', 'supervisor', 'assistant_manager'].includes(String(user.role || '').toLowerCase())) {
    throw new Error('Insufficient permissions for this HR action');
  }
  return user;
}

function nextNumber(prefix, table, col) {
  const rows = dbAll(`SELECT ${col} FROM ${table} WHERE ${col} LIKE ? ORDER BY id DESC LIMIT 1`, [`${prefix}-%`]);
  const last = rows[0]?.[col] || '';
  const n = parseInt(String(last).split('-').pop(), 10) || 0;
  return `${prefix}-${String(n + 1).padStart(6, '0')}`;
}

function hrLogin(username, password) {
  const store = require('./store');
  const r = store.login(username, password);
  if (!r || r.success === false) return r;
  const user = r.user || r.data;
  if (!user) return { success: false, error: 'Login failed' };
  const role = String(user.role || '').toLowerCase();
  if (!HR_ROLES.has(role)) return { success: false, error: 'Your account is not authorized for HR & Payroll' };
  return { success: true, data: user };
}

function hrSession(actor) {
  if (actor?.id) return requireHrUser(actor);
  const session = require('./session');
  const user = session.getUserSession?.();
  if (!user) throw new Error('Not signed in');
  return requireHrUser(user);
}

function getDashboard(filters = {}, actor) {
  requireHrUser(actor);
  const branchId = filters.branch_id || null;
  const params = [];
  let empSql = `SELECT COUNT(*) AS c FROM employees WHERE 1=1`;
  if (branchId) { empSql += ` AND branch_id=?`; params.push(branchId); }
  const total = dbGet(empSql, params)?.c || 0;
  const active = dbGet(`${empSql} AND LOWER(COALESCE(status,'active')) IN ('active','')`, params)?.c || 0;
  const casual = dbGet(`${empSql} AND LOWER(employment_type) LIKE '%casual%'`, params)?.c || 0;
  const contractor = dbGet(`${empSql} AND LOWER(employment_type) LIKE '%contract%'`, params)?.c || 0;
  const intern = dbGet(`${empSql} AND LOWER(employment_type) LIKE '%intern%'`, params)?.c || 0;
  const terminated = dbGet(`${empSql} AND LOWER(status) IN ('terminated','inactive','left')`, params)?.c || 0;
  const monthStart = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-01`;
  const newHires = dbGet(`${empSql} AND date(date_hired) >= date(?)`, [...params, monthStart])?.c || 0;

  let contractsActive = 0; let contractsExpiring = 0; let contractsAwaiting = 0;
  try {
    contractsActive = dbGet(`SELECT COUNT(*) AS c FROM employee_contracts WHERE status IN ('active','signed')`)?.c || 0;
    contractsExpiring = dbGet(
      `SELECT COUNT(*) AS c FROM employee_contracts WHERE status IN ('active','signed') AND expiry_date IS NOT NULL AND date(expiry_date) BETWEEN date('now') AND date('now','+30 day')`
    )?.c || 0;
    contractsAwaiting = dbGet(`SELECT COUNT(*) AS c FROM employee_contracts WHERE status IN ('draft','pending_signature','awaiting_employee')`)?.c || 0;
  } catch (_) { /* table may vary */ }

  let docsMissing = 0; let docsExpiring = 0;
  try {
    docsExpiring = dbGet(
      `SELECT COUNT(*) AS c FROM employee_documents WHERE expiry_date IS NOT NULL AND date(expiry_date) BETWEEN date('now') AND date('now','+30 day')`
    )?.c || 0;
  } catch (_) { /* ignore */ }

  let payrollPending = 0; let payrollProcessed = 0; let grossTotal = 0; let netTotal = 0;
  try {
    payrollPending = dbGet(`SELECT COUNT(*) AS c FROM employee_payroll WHERE status='pending'`)?.c || 0;
    payrollProcessed = dbGet(`SELECT COUNT(*) AS c FROM employee_payroll WHERE status IN ('paid','processed') AND date(period_end) >= date(?)`, [monthStart])?.c || 0;
    const sums = dbGet(
      `SELECT COALESCE(SUM(basic_salary+overtime_pay+bonus+commission+allowances),0) AS gross,
              COALESCE(SUM(net_salary),0) AS net
       FROM employee_payroll WHERE date(period_end) >= date(?)`, [monthStart]
    );
    grossTotal = round2(sums?.gross);
    netTotal = round2(sums?.net);
  } catch (_) { /* ignore */ }

  let leavePending = 0; let requestsPending = 0; let incidentsOpen = 0;
  try { leavePending = dbGet(`SELECT COUNT(*) AS c FROM employee_leave WHERE status='pending'`)?.c || 0; } catch (_) {}
  try { requestsPending = dbGet(`SELECT COUNT(*) AS c FROM hr_requests WHERE status IN ('submitted','review')`)?.c || 0; } catch (_) {}
  try { incidentsOpen = dbGet(`SELECT COUNT(*) AS c FROM hr_incidents WHERE status NOT IN ('resolved','closed')`)?.c || 0; } catch (_) {}

  let policyPending = 0;
  try {
    policyPending = dbGet(
      `SELECT COUNT(*) AS c FROM hr_policies p
       WHERE p.status='active' AND p.requires_ack=1
       AND NOT EXISTS (
         SELECT 1 FROM hr_policy_acknowledgements a
         WHERE a.policy_id=p.id AND a.policy_version=p.version
       )`
    )?.c || 0;
  } catch (_) {}

  return {
    workforce: { total, active, casual, contractor, intern, new_hires: newHires, terminated, leaving: 0 },
    documents: { submitted: 0, missing: docsMissing, expiring: docsExpiring, expired: 0, pending_verification: 0 },
    contracts: { active: contractsActive, awaiting_signature: contractsAwaiting, expiring: contractsExpiring, expired: 0, terminated: 0 },
    payroll: { current: payrollProcessed, pending_approval: payrollPending, processed: payrollProcessed, gross: grossTotal, deductions: round2(grossTotal - netTotal), employer_cost: grossTotal, net: netTotal },
    compliance: { outstanding: incidentsOpen + requestsPending, pending_acknowledgements: policyPending, expiring_certificates: docsExpiring, disciplinary_open: incidentsOpen },
    approvals: { leave: leavePending, requests: requestsPending, payroll: payrollPending }
  };
}

function listPeople(filters = {}, actor) {
  requireHrUser(actor);
  const staff = require('./staff');
  const rows = staff.getEmployees(filters) || [];
  if (filters.personnel_type) {
    const t = String(filters.personnel_type).toLowerCase();
    return rows.filter((e) => {
      const et = String(e.employment_type || '').toLowerCase();
      const st = String(e.status || '').toLowerCase();
      if (t === 'applicant') return false;
      if (t === 'casual') return et.includes('casual');
      if (t === 'contractor') return et.includes('contract');
      if (t === 'intern') return et.includes('intern');
      if (t === 'terminated') return ['terminated', 'inactive', 'left'].includes(st);
      if (t === 'active') return !['terminated', 'inactive', 'left'].includes(st);
      return true;
    });
  }
  return rows;
}

function getEmployeeProfile(employeeId, actor) {
  requireHrUser(actor);
  const staff = require('./staff');
  const emp = staff.getEmployee(employeeId);
  if (!emp) throw new Error('Employee not found');
  let contracts = []; let documents = []; let payroll = []; let leave = []; let disciplinary = [];
  let training = []; let salaryHistory = []; let onboarding = null;
  try {
    const hrContracts = require('./hr-contracts');
    contracts = hrContracts.getContracts({ employee_id: employeeId }) || [];
  } catch (_) {}
  try { documents = staff.getDocuments?.(employeeId) || []; } catch (_) {}
  try {
    const hub = require('./document-hub');
    const hubDocs = hub.getDocuments?.({ employee_id: employeeId }) || [];
    documents = documents.concat(hubDocs);
  } catch (_) {}
  try { payroll = staff.getPayroll?.(employeeId) || []; } catch (_) {}
  try { leave = staff.getLeave?.(employeeId) || []; } catch (_) {}
  try { disciplinary = staff.getDisciplinary?.(employeeId) || []; } catch (_) {}
  try {
    const hrTraining = require('./hr-training');
    training = hrTraining.getTrainingRecords?.({ employee_id: employeeId }) || [];
  } catch (_) {}
  try {
    salaryHistory = dbAll(`SELECT * FROM hr_salary_history WHERE employee_id=? ORDER BY effective_date DESC`, [employeeId]);
  } catch (_) {}
  try {
    onboarding = dbGet(`SELECT * FROM hr_onboarding_progress WHERE employee_id=? ORDER BY updated_at DESC LIMIT 1`, [employeeId]);
  } catch (_) {}
  return { employee: emp, contracts, documents, payroll, leave, disciplinary, training, salary_history: salaryHistory, onboarding };
}

function getEmployeeTimeline(employeeId, actor) {
  requireHrUser(actor);
  const events = [];
  const push = (date, type, label, meta = {}) => events.push({ date, type, label, ...meta });
  const emp = dbGet(`SELECT * FROM employees WHERE id=?`, [employeeId]);
  if (emp?.date_hired) push(emp.date_hired, 'employment', 'Joined business');
  try {
    dbAll(`SELECT * FROM employee_contracts WHERE employee_id=? ORDER BY created_at`, [employeeId]).forEach((c) => {
      push(c.signed_at || c.created_at, 'contract', `Contract ${c.contract_number || c.id} — ${c.status}`);
    });
  } catch (_) {}
  try {
    dbAll(`SELECT * FROM hr_salary_history WHERE employee_id=? ORDER BY effective_date`, [employeeId]).forEach((s) => {
      push(s.effective_date, 'salary', `Salary changed to ${s.new_amount}`, { reason: s.reason });
    });
  } catch (_) {}
  try {
    dbAll(`SELECT * FROM employee_leave WHERE employee_id=? ORDER BY start_date`, [employeeId]).forEach((l) => {
      push(l.start_date, 'leave', `${l.leave_type} leave — ${l.status}`);
    });
  } catch (_) {}
  try {
    dbAll(`SELECT * FROM employee_disciplinary WHERE employee_id=? ORDER BY incident_date`, [employeeId]).forEach((d) => {
      push(d.incident_date, 'disciplinary', `${d.warning_type || 'Warning'} — ${d.status || 'recorded'}`);
    });
  } catch (_) {}
  try {
    dbAll(`SELECT * FROM hr_incidents WHERE employee_id=? ORDER BY incident_date`, [employeeId]).forEach((i) => {
      push(i.incident_date, 'incident', i.title);
    });
  } catch (_) {}
  try {
    dbAll(`SELECT * FROM employee_payroll WHERE employee_id=? AND status IN ('paid','processed') ORDER BY period_end`, [employeeId]).forEach((p) => {
      push(p.period_end, 'payroll', `Payroll processed — ${p.net_salary}`);
    });
  } catch (_) {}
  events.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return { employee_id: employeeId, events };
}

function listApprovals(filters = {}, actor) {
  requireHrUser(actor);
  const items = [];
  try {
    dbAll(`SELECT l.*, e.full_name, e.employee_code FROM employee_leave l JOIN employees e ON e.id=l.employee_id WHERE l.status='pending' ORDER BY l.created_at DESC LIMIT 100`).forEach((r) => {
      items.push({ id: r.id, type: 'leave', title: `${r.leave_type} leave — ${r.full_name}`, employee: r.full_name, date: r.start_date, status: r.status });
    });
  } catch (_) {}
  try {
    dbAll(`SELECT * FROM hr_requests WHERE status IN ('submitted','review') ORDER BY requested_at DESC LIMIT 100`).forEach((r) => {
      const emp = dbGet(`SELECT full_name FROM employees WHERE id=?`, [r.employee_id]);
      items.push({ id: r.id, type: 'request', title: r.title || r.request_type, employee: emp?.full_name, date: r.requested_at, status: r.status });
    });
  } catch (_) {}
  try {
    dbAll(`SELECT p.*, e.full_name FROM employee_payroll p JOIN employees e ON e.id=p.employee_id WHERE p.status='pending' ORDER BY p.period_end DESC LIMIT 50`).forEach((r) => {
      items.push({ id: r.id, type: 'payroll', title: `Payroll ${r.period_start} — ${r.period_end}`, employee: r.full_name, date: r.period_end, status: r.status });
    });
  } catch (_) {}
  if (filters.type) return items.filter((i) => i.type === filters.type);
  return items;
}

function getComplianceCentre(actor) {
  requireHrUser(actor);
  const dash = getDashboard({}, actor);
  let payeStatus = 'review';
  let uifStatus = 'configured';
  try {
    const payroll = require('./payroll-compliance');
    const settings = payroll.getPayrollSettings?.();
    if (settings?.paye_enabled) payeStatus = 'configured';
    if (settings?.uif_enabled === false) uifStatus = 'review';
  } catch (_) {}
  return {
    payroll: dash.payroll.processed > 0 ? 'current' : 'review',
    uif: uifStatus,
    paye: payeStatus,
    contracts_expiring: dash.contracts.expiring,
    documents_missing: dash.documents.missing,
    policies_awaiting: dash.compliance.pending_acknowledgements,
    incidents_open: dash.compliance.disciplinary_open,
    items: listComplianceEvents({ upcoming_days: 60 }, actor)
  };
}

function listComplianceEvents(filters = {}, actor) {
  requireHrUser(actor);
  const days = num(filters.upcoming_days, 90);
  return dbAll(
    `SELECT * FROM hr_compliance_events
     WHERE status != 'completed' AND date(due_date) <= date('now', '+' || ? || ' day')
     ORDER BY due_date LIMIT 200`, [days]
  );
}

function saveComplianceEvent(data = {}, actor) {
  const user = requireHrWrite(actor);
  if (data.id) {
    dbRun(
      `UPDATE hr_compliance_events SET event_type=?, title=?, due_date=?, reminder_days=?, status=?, notes=?, assigned_to=?, updated_at=datetime('now') WHERE id=?`,
      [data.event_type, data.title, data.due_date, data.reminder_days || '30,14,7,1', data.status || 'pending', textOrNull(data.notes), data.assigned_to || null, data.id]
    );
    audit(user, 'update_compliance_event', 'hr_compliance_event', data.id, data);
    return dbGet(`SELECT * FROM hr_compliance_events WHERE id=?`, [data.id]);
  }
  const r = dbRun(
    `INSERT INTO hr_compliance_events (event_type, title, due_date, reminder_days, status, notes, assigned_to, related_entity_type, related_entity_id, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [data.event_type || 'general', data.title, data.due_date || today(), data.reminder_days || '30,14,7,1',
      data.status || 'pending', textOrNull(data.notes), data.assigned_to || null, textOrNull(data.related_entity_type),
      data.related_entity_id || null, user.id]
  );
  audit(user, 'create_compliance_event', 'hr_compliance_event', r.lastInsertRowid, data);
  return dbGet(`SELECT * FROM hr_compliance_events WHERE id=?`, [r.lastInsertRowid]);
}

function listPolicies(filters = {}, actor) {
  requireHrUser(actor);
  let sql = `SELECT * FROM hr_policies WHERE 1=1`;
  const p = [];
  if (filters.status) { sql += ` AND status=?`; p.push(filters.status); }
  if (filters.category) { sql += ` AND category=?`; p.push(filters.category); }
  sql += ` ORDER BY title, version DESC`;
  return dbAll(sql, p);
}

function savePolicy(data = {}, actor) {
  const user = requireHrWrite(actor);
  if (data.id) {
    dbRun(
      `UPDATE hr_policies SET code=?, title=?, category=?, version=?, body=?, status=?, requires_ack=?, applies_to=?, effective_date=?, review_date=?, updated_at=datetime('now') WHERE id=?`,
      [textOrNull(data.code), data.title, data.category || 'general', data.version || '1.0', textOrNull(data.body),
        data.status || 'active', data.requires_ack === 0 ? 0 : 1, textOrNull(data.applies_to), textOrNull(data.effective_date),
        textOrNull(data.review_date), data.id]
    );
    audit(user, 'update_policy', 'hr_policy', data.id, { version: data.version });
    return dbGet(`SELECT * FROM hr_policies WHERE id=?`, [data.id]);
  }
  const r = dbRun(
    `INSERT INTO hr_policies (code, title, category, version, body, status, requires_ack, applies_to, effective_date, review_date, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [textOrNull(data.code), data.title, data.category || 'general', data.version || '1.0', textOrNull(data.body),
      data.status || 'active', data.requires_ack === 0 ? 0 : 1, textOrNull(data.applies_to), textOrNull(data.effective_date),
      textOrNull(data.review_date), user.id]
  );
  audit(user, 'create_policy', 'hr_policy', r.lastInsertRowid, data);
  return dbGet(`SELECT * FROM hr_policies WHERE id=?`, [r.lastInsertRowid]);
}

function acknowledgePolicy(policyId, employeeId, data = {}, actor) {
  const user = requireHrWrite(actor);
  const policy = dbGet(`SELECT * FROM hr_policies WHERE id=?`, [policyId]);
  if (!policy) throw new Error('Policy not found');
  dbRun(
    `INSERT OR REPLACE INTO hr_policy_acknowledgements (policy_id, employee_id, policy_version, signature_data, created_by)
     VALUES (?,?,?,?,?)`,
    [policyId, employeeId, policy.version, textOrNull(data.signature_data), user.id]
  );
  audit(user, 'acknowledge_policy', 'hr_policy', policyId, { employee_id: employeeId, version: policy.version });
  return { success: true };
}

function listBusinessRules(filters = {}, actor) {
  requireHrUser(actor);
  return dbAll(`SELECT * FROM hr_business_rules WHERE status='active' ORDER BY title`);
}

function saveBusinessRule(data = {}, actor) {
  const user = requireHrWrite(actor);
  if (data.id) {
    dbRun(
      `UPDATE hr_business_rules SET code=?, title=?, body=?, applies_to=?, position=?, department=?, branch_id=?, employment_type=?, status=?, updated_at=datetime('now') WHERE id=?`,
      [textOrNull(data.code), data.title, textOrNull(data.body), data.applies_to || 'all', textOrNull(data.position),
        textOrNull(data.department), data.branch_id || null, textOrNull(data.employment_type), data.status || 'active', data.id]
    );
    return dbGet(`SELECT * FROM hr_business_rules WHERE id=?`, [data.id]);
  }
  const r = dbRun(
    `INSERT INTO hr_business_rules (code, title, body, applies_to, position, department, branch_id, employment_type, created_by)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [textOrNull(data.code), data.title, textOrNull(data.body), data.applies_to || 'all', textOrNull(data.position),
      textOrNull(data.department), data.branch_id || null, textOrNull(data.employment_type), user.id]
  );
  audit(user, 'create_business_rule', 'hr_business_rule', r.lastInsertRowid, data);
  return dbGet(`SELECT * FROM hr_business_rules WHERE id=?`, [r.lastInsertRowid]);
}

function listIncidents(filters = {}, actor) {
  requireHrUser(actor);
  let sql = `SELECT i.*, e.full_name AS employee_name FROM hr_incidents i LEFT JOIN employees e ON e.id=i.employee_id WHERE 1=1`;
  const p = [];
  if (filters.status) { sql += ` AND i.status=?`; p.push(filters.status); }
  if (filters.employee_id) { sql += ` AND i.employee_id=?`; p.push(filters.employee_id); }
  sql += ` ORDER BY i.incident_date DESC LIMIT 300`;
  return dbAll(sql, p);
}

function saveIncident(data = {}, actor) {
  const user = requireHrWrite(actor);
  if (data.id) {
    dbRun(
      `UPDATE hr_incidents SET employee_id=?, incident_type=?, incident_date=?, title=?, description=?, status=?, severity=?, resolution=?, resolved_by=?, resolved_at=?, updated_at=datetime('now') WHERE id=?`,
      [data.employee_id || null, data.incident_type || 'other', data.incident_date || today(), data.title, textOrNull(data.description),
        data.status || 'reported', data.severity || 'medium', textOrNull(data.resolution),
        data.status === 'resolved' ? user.id : null, data.status === 'resolved' ? new Date().toISOString() : null, data.id]
    );
    audit(user, 'update_incident', 'hr_incident', data.id, data);
    return dbGet(`SELECT * FROM hr_incidents WHERE id=?`, [data.id]);
  }
  const number = nextNumber('INC', 'hr_incidents', 'incident_number');
  const r = dbRun(
    `INSERT INTO hr_incidents (incident_number, employee_id, reporter_id, branch_id, incident_type, incident_date, title, description, status, severity, evidence_paths, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`,
    [number, data.employee_id || null, user.id, data.branch_id || null, data.incident_type || 'other',
      data.incident_date || today(), data.title, textOrNull(data.description), data.status || 'reported',
      data.severity || 'medium', data.evidence_paths ? JSON.stringify(data.evidence_paths) : null]
  );
  audit(user, 'create_incident', 'hr_incident', r.lastInsertRowid, data);
  return dbGet(`SELECT * FROM hr_incidents WHERE id=?`, [r.lastInsertRowid]);
}

function listDisciplinaryCases(filters = {}, actor) {
  requireHrUser(actor);
  let sql = `SELECT c.*, e.full_name AS employee_name FROM hr_disciplinary_cases c JOIN employees e ON e.id=c.employee_id WHERE 1=1`;
  const p = [];
  if (filters.status) { sql += ` AND c.status=?`; p.push(filters.status); }
  if (filters.stage) { sql += ` AND c.stage=?`; p.push(filters.stage); }
  if (filters.section === 'investigations') {
    sql += ` AND c.stage IN ('investigation','investigating','review','open')`;
  } else if (filters.section === 'hearings') {
    sql += ` AND (c.stage='hearing' OR c.hearing_date IS NOT NULL)`;
  } else if (filters.section === 'appeals') {
    sql += ` AND c.appeal_status IS NOT NULL AND c.appeal_status != ''`;
  }
  sql += ` ORDER BY c.created_at DESC LIMIT 200`;
  return dbAll(sql, p);
}

function saveDisciplinaryCase(data = {}, actor) {
  const user = requireHrWrite(actor);
  if (data.id) {
    dbRun(
      `UPDATE hr_disciplinary_cases SET status=?, stage=?, allegation=?, employee_response=?, outcome=?, hearing_date=?, appeal_status=?, appeal_notes=?, decided_by=?, decided_at=?, updated_at=datetime('now') WHERE id=?`,
      [data.status, data.stage, textOrNull(data.allegation), textOrNull(data.employee_response), textOrNull(data.outcome),
        textOrNull(data.hearing_date), textOrNull(data.appeal_status), textOrNull(data.appeal_notes),
        data.decided_by || user.id, data.decided_at || (data.outcome ? new Date().toISOString() : null), data.id]
    );
    audit(user, 'update_disciplinary_case', 'hr_disciplinary_case', data.id, data);
    return dbGet(`SELECT * FROM hr_disciplinary_cases WHERE id=?`, [data.id]);
  }
  const number = nextNumber('DC', 'hr_disciplinary_cases', 'case_number');
  const r = dbRun(
    `INSERT INTO hr_disciplinary_cases (case_number, employee_id, incident_id, status, stage, allegation, created_by)
     VALUES (?,?,?,?,?,?,?)`,
    [number, data.employee_id, data.incident_id || null, data.status || 'investigation', data.stage || 'investigation',
      textOrNull(data.allegation), user.id]
  );
  audit(user, 'create_disciplinary_case', 'hr_disciplinary_case', r.lastInsertRowid, data);
  return dbGet(`SELECT * FROM hr_disciplinary_cases WHERE id=?`, [r.lastInsertRowid]);
}

function listOnboardingTemplates(actor) {
  requireHrUser(actor);
  return dbAll(`SELECT * FROM hr_onboarding_templates WHERE is_active=1 ORDER BY name`);
}

function getOnboardingProgress(employeeId, actor) {
  requireHrUser(actor);
  const row = dbGet(`SELECT * FROM hr_onboarding_progress WHERE employee_id=? ORDER BY updated_at DESC LIMIT 1`, [employeeId]);
  if (!row) {
    const tpl = dbGet(`SELECT * FROM hr_onboarding_templates WHERE is_active=1 ORDER BY id LIMIT 1`);
    if (!tpl) return null;
    const checklist = parseJson(tpl.checklist_json, []);
    return { employee_id: employeeId, template_id: tpl.id, template_name: tpl.name, checklist, completion_pct: 0, status: 'not_started' };
  }
  return { ...row, checklist: parseJson(row.progress_json, parseJson(dbGet(`SELECT checklist_json FROM hr_onboarding_templates WHERE id=?`, [row.template_id])?.checklist_json, [])) };
}

function saveOnboardingProgress(data = {}, actor) {
  const user = requireHrWrite(actor);
  const checklist = data.checklist || parseJson(data.progress_json, []);
  const total = checklist.length || 1;
  const done = checklist.filter((c) => c === true || c?.done).length;
  const pct = round2((done / total) * 100);
  const status = pct >= 100 ? 'completed' : 'in_progress';
  const existing = dbGet(`SELECT id FROM hr_onboarding_progress WHERE employee_id=? AND template_id=?`, [data.employee_id, data.template_id]);
  const progressJson = JSON.stringify(checklist);
  if (existing) {
    dbRun(
      `UPDATE hr_onboarding_progress SET progress_json=?, completion_pct=?, status=?, completed_at=?, updated_at=datetime('now') WHERE id=?`,
      [progressJson, pct, status, status === 'completed' ? new Date().toISOString() : null, existing.id]
    );
    return dbGet(`SELECT * FROM hr_onboarding_progress WHERE id=?`, [existing.id]);
  }
  const r = dbRun(
    `INSERT INTO hr_onboarding_progress (employee_id, template_id, progress_json, completion_pct, status, completed_at)
     VALUES (?,?,?,?,?,?)`,
    [data.employee_id, data.template_id, progressJson, pct, status, status === 'completed' ? new Date().toISOString() : null]
  );
  audit(user, 'update_onboarding', 'hr_onboarding', r.lastInsertRowid, { employee_id: data.employee_id, pct });
  return dbGet(`SELECT * FROM hr_onboarding_progress WHERE id=?`, [r.lastInsertRowid]);
}

function listForms(filters = {}, actor) {
  requireHrUser(actor);
  return dbAll(`SELECT * FROM hr_forms WHERE status='active' ORDER BY title`);
}

function saveForm(data = {}, actor) {
  const user = requireHrWrite(actor);
  if (data.id) {
    dbRun(`UPDATE hr_forms SET code=?, title=?, form_type=?, schema_json=?, status=?, updated_at=datetime('now') WHERE id=?`,
      [textOrNull(data.code), data.title, data.form_type || 'general', textOrNull(data.schema_json), data.status || 'active', data.id]);
    return dbGet(`SELECT * FROM hr_forms WHERE id=?`, [data.id]);
  }
  const r = dbRun(
    `INSERT INTO hr_forms (code, title, form_type, schema_json, created_by) VALUES (?,?,?,?,?)`,
    [textOrNull(data.code), data.title, data.form_type || 'general', textOrNull(data.schema_json), user.id]
  );
  return dbGet(`SELECT * FROM hr_forms WHERE id=?`, [r.lastInsertRowid]);
}

function createExternalLink(data = {}, actor) {
  const user = requireHrWrite(actor);
  const token = crypto.randomBytes(24).toString('hex');
  const expires = new Date(Date.now() + (num(data.expires_hours, 72) * 3600000)).toISOString();
  const r = dbRun(
    `INSERT INTO hr_external_links (link_type, token, employee_id, contract_id, form_id, payload_json, expires_at, created_by)
     VALUES (?,?,?,?,?,?,?,?)`,
    [data.link_type || 'onboarding', token, data.employee_id || null, data.contract_id || null, data.form_id || null,
      data.payload_json ? JSON.stringify(data.payload_json) : null, expires, user.id]
  );
  audit(user, 'create_external_link', 'hr_external_link', r.lastInsertRowid, { link_type: data.link_type });
  return { id: r.lastInsertRowid, token, expires_at: expires, url: `hr-portal://${token}` };
}

function listRequests(filters = {}, actor) {
  requireHrUser(actor);
  let sql = `SELECT r.*, e.full_name AS employee_name FROM hr_requests r JOIN employees e ON e.id=r.employee_id WHERE 1=1`;
  const p = [];
  if (filters.status) { sql += ` AND r.status=?`; p.push(filters.status); }
  if (filters.request_type) { sql += ` AND r.request_type=?`; p.push(filters.request_type); }
  if (filters.employee_id) { sql += ` AND r.employee_id=?`; p.push(filters.employee_id); }
  sql += ` ORDER BY r.requested_at DESC LIMIT 300`;
  return dbAll(sql, p);
}

function saveRequest(data = {}, actor) {
  const user = requireHrWrite(actor);
  if (data.id) {
    dbRun(
      `UPDATE hr_requests SET title=?, details=?, status=?, payload_json=?, effective_date=?, updated_at=datetime('now') WHERE id=?`,
      [textOrNull(data.title), textOrNull(data.details), data.status || 'submitted', data.payload_json ? JSON.stringify(data.payload_json) : null,
        textOrNull(data.effective_date), data.id]
    );
    return dbGet(`SELECT * FROM hr_requests WHERE id=?`, [data.id]);
  }
  const number = nextNumber('REQ', 'hr_requests', 'request_number');
  const r = dbRun(
    `INSERT INTO hr_requests (request_number, employee_id, request_type, title, details, status, payload_json, effective_date)
     VALUES (?,?,?,?,?,?,?,?)`,
    [number, data.employee_id, data.request_type || 'general', textOrNull(data.title), textOrNull(data.details),
      data.status || 'submitted', data.payload_json ? JSON.stringify(data.payload_json) : null, textOrNull(data.effective_date)]
  );
  audit(user, 'create_hr_request', 'hr_request', r.lastInsertRowid, data);
  return dbGet(`SELECT * FROM hr_requests WHERE id=?`, [r.lastInsertRowid]);
}

function decideRequest(id, decision, notes, actor) {
  const user = requireHrWrite(actor);
  dbRun(
    `UPDATE hr_requests SET status=?, reviewed_by=?, reviewed_at=datetime('now'), review_notes=?, updated_at=datetime('now') WHERE id=?`,
    [decision === 'approved' ? 'approved' : 'rejected', user.id, textOrNull(notes), id]
  );
  audit(user, 'decide_hr_request', 'hr_request', id, { decision, notes });
  return dbGet(`SELECT * FROM hr_requests WHERE id=?`, [id]);
}

function listEmployerRecords(filters = {}, actor) {
  requireHrUser(actor);
  let sql = `SELECT * FROM hr_employer_records WHERE 1=1`;
  const p = [];
  if (filters.record_type) { sql += ` AND record_type=?`; p.push(filters.record_type); }
  sql += ` ORDER BY title`;
  return dbAll(sql, p);
}

function saveEmployerRecord(data = {}, actor) {
  const user = requireHrWrite(actor);
  if (data.id) {
    dbRun(
      `UPDATE hr_employer_records SET record_type=?, title=?, reference_number=?, value_json=?, doc_path=?, expiry_date=?, status=?, notes=?, updated_at=datetime('now') WHERE id=?`,
      [data.record_type, data.title, textOrNull(data.reference_number), data.value_json ? JSON.stringify(data.value_json) : null,
        textOrNull(data.doc_path), textOrNull(data.expiry_date), data.status || 'active', textOrNull(data.notes), data.id]
    );
    return dbGet(`SELECT * FROM hr_employer_records WHERE id=?`, [data.id]);
  }
  const r = dbRun(
    `INSERT INTO hr_employer_records (record_type, title, reference_number, value_json, doc_path, expiry_date, status, notes, created_by)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [data.record_type || 'general', data.title, textOrNull(data.reference_number), data.value_json ? JSON.stringify(data.value_json) : null,
      textOrNull(data.doc_path), textOrNull(data.expiry_date), data.status || 'active', textOrNull(data.notes), user.id]
  );
  audit(user, 'create_employer_record', 'hr_employer_record', r.lastInsertRowid, data);
  return dbGet(`SELECT * FROM hr_employer_records WHERE id=?`, [r.lastInsertRowid]);
}

function listSalaryHistory(employeeId, actor) {
  requireHrUser(actor);
  return dbAll(`SELECT h.*, u.full_name AS approved_by_name FROM hr_salary_history h
    LEFT JOIN users u ON u.id=h.approved_by WHERE h.employee_id=? ORDER BY h.effective_date DESC`, [employeeId]);
}

function saveSalaryChange(data = {}, actor) {
  const user = requireHrWrite(actor);
  const emp = dbGet(`SELECT * FROM employees WHERE id=?`, [data.employee_id]);
  if (!emp) throw new Error('Employee not found');
  const prev = num(emp.basic_salary);
  const next = num(data.new_amount);
  const r = dbRun(
    `INSERT INTO hr_salary_history (employee_id, effective_date, previous_amount, new_amount, salary_type, reason, approved_by, requested_by, doc_path)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [data.employee_id, data.effective_date || today(), prev, next, data.salary_type || emp.salary_type,
      textOrNull(data.reason), user.id, data.requested_by || user.id, textOrNull(data.doc_path)]
  );
  dbRun(`UPDATE employees SET basic_salary=?, updated_at=datetime('now') WHERE id=?`, [next, data.employee_id]);
  audit(user, 'salary_change', 'employee', data.employee_id, { previous: prev, new: next, reason: data.reason });
  return dbGet(`SELECT * FROM hr_salary_history WHERE id=?`, [r.lastInsertRowid]);
}

function saveOffboarding(data = {}, actor) {
  const user = requireHrWrite(actor);
  if (data.id) {
    dbRun(
      `UPDATE hr_offboarding SET exit_type=?, effective_date=?, final_working_date=?, reason=?, checklist_json=?, status=?, approved_by=?, completed_at=?, updated_at=datetime('now') WHERE id=?`,
      [data.exit_type, data.effective_date, textOrNull(data.final_working_date), textOrNull(data.reason),
        data.checklist_json ? JSON.stringify(data.checklist_json) : null, data.status || 'in_progress',
        data.approved_by || user.id, data.status === 'completed' ? new Date().toISOString() : null, data.id]
    );
    if (data.status === 'completed' && data.employee_id) {
      dbRun(`UPDATE employees SET status='Terminated', updated_at=datetime('now') WHERE id=?`, [data.employee_id]);
    }
    return dbGet(`SELECT * FROM hr_offboarding WHERE id=?`, [data.id]);
  }
  const r = dbRun(
    `INSERT INTO hr_offboarding (employee_id, exit_type, effective_date, final_working_date, reason, checklist_json, status, created_by)
     VALUES (?,?,?,?,?,?,?,?)`,
    [data.employee_id, data.exit_type || 'resignation', data.effective_date || today(), textOrNull(data.final_working_date),
      textOrNull(data.reason), data.checklist_json ? JSON.stringify(data.checklist_json) : null, data.status || 'in_progress', user.id]
  );
  audit(user, 'start_offboarding', 'hr_offboarding', r.lastInsertRowid, data);
  return dbGet(`SELECT * FROM hr_offboarding WHERE id=?`, [r.lastInsertRowid]);
}

function globalSearch(q, actor) {
  requireHrUser(actor);
  const term = `%${String(q || '').trim()}%`;
  if (!term || term === '%%') return { employees: [], contracts: [], documents: [], policies: [] };
  const employees = dbAll(
    `SELECT id, employee_code, full_name, position, department, status FROM employees
     WHERE full_name LIKE ? OR employee_code LIKE ? OR position LIKE ? LIMIT 30`, [term, term, term]
  );
  let contracts = [];
  try {
    contracts = dbAll(
      `SELECT c.id, c.contract_number, c.status, e.full_name FROM employee_contracts c
       JOIN employees e ON e.id=c.employee_id WHERE c.contract_number LIKE ? OR e.full_name LIKE ? LIMIT 20`, [term, term]
    );
  } catch (_) {}
  const policies = dbAll(`SELECT id, title, version, category FROM hr_policies WHERE title LIKE ? OR code LIKE ? LIMIT 20`, [term, term]);
  return { employees, contracts, documents: [], policies, query: q };
}

function getSettings(actor) {
  requireHrUser(actor);
  const payroll = require('./payroll-compliance');
  let payrollSettings = {};
  try { payrollSettings = payroll.getPayrollSettings(); } catch (_) {}
  let hrSettings = {};
  try {
    const row = dbGet(`SELECT hr_platform_settings FROM shop_settings WHERE id=1`);
    hrSettings = parseJson(row?.hr_platform_settings, {});
  } catch (_) {}
  return { payroll: payrollSettings, hr: hrSettings };
}

function saveSettings(data = {}, actor) {
  const user = requireHrWrite(actor);
  if (data.payroll) {
    const payroll = require('./payroll-compliance');
    payroll.savePayrollSettings(data.payroll, user.id, user.full_name || user.username);
  }
  if (data.hr) {
    dbRun(`UPDATE shop_settings SET hr_platform_settings=?, updated_at=datetime('now') WHERE id=1`, [JSON.stringify(data.hr)]);
  }
  audit(user, 'save_hr_settings', 'hr_settings', null, {});
  return getSettings(user);
}

function dateOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('en-CA');
}

function listAttendanceHub(filters = {}, actor) {
  requireHrUser(actor);
  const staff = require('./staff');
  const from = filters.from || dateOffset(-30);
  const to = filters.to || today();
  let rows = staff.getAttendance({ ...filters, from, to, include_scheduled: filters.view === 'absences' }) || [];
  const view = filters.view || 'clock-ins';
  if (view === 'overtime') {
    rows = rows.filter((r) => num(r.overtime_minutes) > 0 || num(r.overtime_hours) > 0);
  } else if (view === 'absences') {
    rows = rows.filter((r) => r.status === 'absent' || r.scheduled_only || (!r.clock_in && !r.clock_out));
  } else if (view === 'late-arrivals') {
    rows = rows.filter((r) => num(r.late_minutes) > 0);
  } else if (view === 'hours') {
    rows = rows.filter((r) => r.clock_in || num(r.hours_worked) > 0);
  } else {
    rows = rows.filter((r) => r.clock_in || r.clock_out);
  }
  const missedClockOuts = staff.getMissedClockOutInbox?.({ days: 14 }) || [];
  return { from, to, view, rows: rows.slice(0, 500), missed_clock_outs: missedClockOuts };
}

function listShiftSchedules(filters = {}, actor) {
  requireHrUser(actor);
  const staff = require('./staff');
  const from = filters.from || dateOffset(-7);
  const to = filters.to || dateOffset(21);
  return {
    from, to,
    rows: staff.getSchedules(from, to, filters.employee_id || null) || []
  };
}

function listLeaveBalances(actor) {
  requireHrUser(actor);
  const staff = require('./staff');
  return (staff.getEmployees({ status: 'Active' }) || []).map((e) => {
    const bal = staff.getLeaveBalance(e.id) || {};
    return {
      employee_id: e.id,
      full_name: e.full_name,
      employee_code: e.employee_code,
      annual_total: bal.annual?.total || 0,
      annual_used: bal.annual?.used || 0,
      annual_left: num(bal.annual?.total) - num(bal.annual?.used),
      sick_total: bal.sick?.total || 0,
      sick_used: bal.sick?.used || 0,
      sick_left: num(bal.sick?.total) - num(bal.sick?.used),
      family_total: bal.family?.total || 0,
      family_used: bal.family?.used || 0,
      family_left: num(bal.family?.total) - num(bal.family?.used)
    };
  });
}

function listAllEmployeeDocuments(filters = {}, actor) {
  requireHrUser(actor);
  let sql = `SELECT d.*, e.full_name AS employee_name, e.employee_code
    FROM employee_documents d JOIN employees e ON e.id=d.employee_id WHERE 1=1`;
  const p = [];
  if (filters.employee_id) { sql += ` AND d.employee_id=?`; p.push(filters.employee_id); }
  sql += ` ORDER BY d.expiry_date IS NULL, d.expiry_date LIMIT 500`;
  return dbAll(sql, p);
}

function listOffboardingRecords(filters = {}, actor) {
  requireHrUser(actor);
  let sql = `SELECT o.*, e.full_name, e.employee_code, e.position FROM hr_offboarding o
    JOIN employees e ON e.id=o.employee_id WHERE 1=1`;
  const p = [];
  if (filters.status) { sql += ` AND o.status=?`; p.push(filters.status); }
  sql += ` ORDER BY o.created_at DESC LIMIT 200`;
  return dbAll(sql, p);
}

function listOnboardingProgressAll(actor) {
  requireHrUser(actor);
  return dbAll(
    `SELECT p.*, e.full_name, e.employee_code, t.name AS template_name
     FROM hr_onboarding_progress p
     JOIN employees e ON e.id=p.employee_id
     LEFT JOIN hr_onboarding_templates t ON t.id=p.template_id
     ORDER BY p.updated_at DESC LIMIT 200`
  );
}

function listPayrollDeductions(filters = {}, actor) {
  requireHrUser(actor);
  return dbAll(
    `SELECT d.*, p.period_start, p.period_end, p.status AS payroll_status, e.full_name, e.employee_code
     FROM employee_payroll_deductions d
     JOIN employee_payroll p ON p.id=d.payroll_id
     JOIN employees e ON e.id=p.employee_id
     ORDER BY p.period_end DESC, d.id DESC LIMIT 400`
  );
}

function getStatutorySummary(filters = {}, actor) {
  requireHrUser(actor);
  const monthStart = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-01`;
  const totals = dbGet(
    `SELECT COALESCE(SUM(paye),0) AS paye,
            COALESCE(SUM(uif_employee),0) AS uif_employee,
            COALESCE(SUM(uif_employer),0) AS uif_employer,
            COALESCE(SUM(sdl),0) AS sdl,
            COALESCE(SUM(coida),0) AS coida,
            COALESCE(SUM(gross_salary),0) AS gross,
            COALESCE(SUM(net_salary),0) AS net,
            COUNT(*) AS payroll_count
     FROM employee_payroll WHERE date(period_end) >= date(?)`, [monthStart]
  ) || {};
  let settings = {};
  try { settings = require('./payroll-compliance').getPayrollSettings() || {}; } catch (_) {}
  return { month_start: monthStart, totals, settings };
}

function getPerformanceHub(filters = {}, actor) {
  requireHrUser(actor);
  const staff = require('./staff');
  const from = filters.from || dateOffset(-30);
  const to = filters.to || today();
  let probations = [];
  try { probations = require('./hr-contracts').getProbations({}) || []; } catch (_) {}
  const employees = staff.getEmployees({ status: 'Active' }) || [];
  const sales = employees.map((e) => {
    const perf = staff.getEmployeePerformance(e.id, from, to);
    return {
      employee_id: e.id,
      full_name: e.full_name,
      employee_code: e.employee_code,
      sales_count: perf?.sales_count || 0,
      sales_total: round2(perf?.sales_total || 0)
    };
  }).filter((r) => r.sales_count > 0 || r.sales_total > 0);
  return { from, to, probations: probations.slice(0, 100), sales_performance: sales };
}

function listStaffWarnings(filters = {}, actor) {
  requireHrUser(actor);
  const staff = require('./staff');
  return staff.getAllDisciplinary?.(filters) || [];
}

function listPayrollRecords(filters = {}, actor) {
  requireHrUser(actor);
  let sql = `SELECT p.*, e.full_name, e.employee_code FROM employee_payroll p JOIN employees e ON e.id=p.employee_id WHERE 1=1`;
  const params = [];
  if (filters.employee_id) { sql += ` AND p.employee_id=?`; params.push(filters.employee_id); }
  if (filters.status) { sql += ` AND p.status=?`; params.push(filters.status); }
  if (filters.period_start) { sql += ` AND p.period_start >= ?`; params.push(filters.period_start); }
  if (filters.period_end) { sql += ` AND p.period_end <= ?`; params.push(filters.period_end); }
  if (filters.bonus) { sql += ` AND COALESCE(p.bonus,0) > 0`; }
  if (filters.commission) { sql += ` AND COALESCE(p.commission,0) > 0`; }
  sql += ` ORDER BY p.period_end DESC, p.id DESC LIMIT ?`;
  params.push(filters.limit || 300);
  return dbAll(sql, params);
}

function postPayrollToAccounting(payrollId, actor) {
  const user = requireHrWrite(actor);
  const row = dbGet(`SELECT * FROM employee_payroll WHERE id=?`, [payrollId]);
  if (!row) throw new Error('Payroll record not found');
  if (row.status !== 'paid') throw new Error('Mark payroll as paid before posting to accounting');
  const { runIntegration } = require('./accounting-central');
  const journal = runIntegration('postFromPayroll', payrollId);
  audit(user, 'post_payroll_accounting', 'employee_payroll', payrollId, { journal_id: journal?.id, net: row.net_salary });
  return { posted: true, payroll_id: payrollId, journal_id: journal?.id, queued: journal == null };
}

module.exports = {
  hrLogin,
  hrSession,
  getDashboard,
  listPeople,
  getEmployeeProfile,
  getEmployeeTimeline,
  listApprovals,
  getComplianceCentre,
  listComplianceEvents,
  saveComplianceEvent,
  listPolicies,
  savePolicy,
  acknowledgePolicy,
  listBusinessRules,
  saveBusinessRule,
  listIncidents,
  saveIncident,
  listDisciplinaryCases,
  saveDisciplinaryCase,
  listOnboardingTemplates,
  getOnboardingProgress,
  saveOnboardingProgress,
  listForms,
  saveForm,
  createExternalLink,
  listRequests,
  saveRequest,
  decideRequest,
  listEmployerRecords,
  saveEmployerRecord,
  listSalaryHistory,
  saveSalaryChange,
  saveOffboarding,
  globalSearch,
  getSettings,
  saveSettings,
  listPayrollRecords,
  listAttendanceHub,
  listShiftSchedules,
  listLeaveBalances,
  listAllEmployeeDocuments,
  listOffboardingRecords,
  listOnboardingProgressAll,
  listPayrollDeductions,
  getStatutorySummary,
  getPerformanceHub,
  listStaffWarnings,
  postPayrollToAccounting
};

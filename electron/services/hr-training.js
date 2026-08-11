const fs = require('fs');
const path = require('path');
const { getDb, getDbPathForBackup } = require('../database/db');
const { assertUserActor } = require('./authz');

function parseJson(val, fallback = {}) {
  if (!val) return fallback;
  try { return typeof val === 'string' ? JSON.parse(val) : val; } catch { return fallback; }
}

function today() {
  return new Date().toLocaleDateString('en-CA');
}

function audit(actorId, actorName, action, entityType, entityId, details) {
  getDb().prepare(`INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, details) VALUES (?,?,?,?,?,?)`)
    .run(actorId || null, actorName || 'system', action, entityType, entityId || null, details ? JSON.stringify(details) : null);
}

function requireHrRole(actor) {
  assertUserActor(actor, ['owner', 'manager', 'supervisor', 'assistant_manager']);
}

function requireAdminRole(actor) {
  assertUserActor(actor, ['owner', 'manager']);
}

function getHrAssetsDir(sub) {
  const dir = path.join(path.dirname(getDbPathForBackup()), 'assets', 'hr', sub || 'submissions');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function isHrAdmin(actor) {
  try {
    assertUserActor(actor, ['owner', 'manager']);
    return true;
  } catch {
    return false;
  }
}

function getHrContractTemplates(type, actor) {
  requireHrRole(actor);
  let sql = 'SELECT t.*, u.full_name AS created_by_name FROM hr_contract_templates t LEFT JOIN users u ON u.id = t.created_by WHERE 1=1';
  const params = [];
  if (type) { sql += ' AND t.type = ?'; params.push(type); }
  sql += ' ORDER BY t.type, t.title';
  return getDb().prepare(sql).all(...params);
}

function saveHrContractTemplate(data, actor) {
  requireAdminRole(actor);
  const db = getDb();
  if (!data.title?.trim() || !data.body?.trim()) throw new Error('Title and body are required');
  const type = data.type || 'training';
  if (!['training', 'probation', 'employment'].includes(type)) throw new Error('Invalid template type');
  if (data.id) {
    db.prepare(`UPDATE hr_contract_templates SET type=?, title=?, body=?, updated_at=datetime('now') WHERE id=?`)
      .run(type, data.title.trim(), data.body.trim(), data.id);
    audit(actor?.id, actor?.username, 'update_hr_template', 'hr_contract_template', data.id, { type });
    return db.prepare('SELECT * FROM hr_contract_templates WHERE id = ?').get(data.id);
  }
  const r = db.prepare(`INSERT INTO hr_contract_templates (type, title, body, created_by) VALUES (?,?,?,?)`)
    .run(type, data.title.trim(), data.body.trim(), actor?.id || null);
  audit(actor?.id, actor?.username, 'create_hr_template', 'hr_contract_template', r.lastInsertRowid, { type });
  return db.prepare('SELECT * FROM hr_contract_templates WHERE id = ?').get(r.lastInsertRowid);
}

function deleteHrContractTemplate(id, actor) {
  requireAdminRole(actor);
  getDb().prepare('DELETE FROM hr_contract_templates WHERE id = ?').run(id);
  audit(actor?.id, actor?.username, 'delete_hr_template', 'hr_contract_template', id, null);
  return { success: true };
}

function getTrainingRecords(filters = {}, actor) {
  requireHrRole(actor);
  let sql = `SELECT tr.*, e.full_name AS employee_name, e.employee_code, t.title AS template_title
    FROM hr_training_records tr
    JOIN employees e ON e.id = tr.employee_id
    LEFT JOIN hr_contract_templates t ON t.id = tr.template_id WHERE 1=1`;
  const params = [];
  if (filters.employee_id) { sql += ' AND tr.employee_id = ?'; params.push(filters.employee_id); }
  if (filters.status) { sql += ' AND tr.status = ?'; params.push(filters.status); }
  sql += ' ORDER BY tr.expiry_date ASC, tr.start_date DESC';
  return getDb().prepare(sql).all(...params).map(r => ({
    ...r,
    evaluations: parseJson(r.evaluations_json, [])
  }));
}

function saveTrainingRecord(data, actor) {
  requireHrRole(actor);
  const db = getDb();
  const evals = JSON.stringify(data.evaluations || data.evaluations_json || []);
  if (data.id) {
    db.prepare(`UPDATE hr_training_records SET employee_id=?, start_date=?, expiry_date=?, status=?, evaluations_json=?, template_id=?, updated_at=datetime('now') WHERE id=?`)
      .run(data.employee_id, data.start_date, data.expiry_date || null, data.status || 'active', evals, data.template_id || null, data.id);
    return getTrainingRecords({ employee_id: data.employee_id }, actor).find(x => x.id === data.id)
      || db.prepare('SELECT * FROM hr_training_records WHERE id = ?').get(data.id);
  }
  const r = db.prepare(`INSERT INTO hr_training_records (employee_id, start_date, expiry_date, status, evaluations_json, template_id, created_by)
    VALUES (?,?,?,?,?,?,?)`).run(
    data.employee_id, data.start_date || today(), data.expiry_date || null, data.status || 'active',
    evals, data.template_id || null, actor?.id || null
  );
  audit(actor?.id, actor?.username, 'create_training_record', 'hr_training_record', r.lastInsertRowid, null);
  return db.prepare('SELECT * FROM hr_training_records WHERE id = ?').get(r.lastInsertRowid);
}

function deleteTrainingRecord(id, actor) {
  requireAdminRole(actor);
  getDb().prepare('DELETE FROM hr_training_records WHERE id = ?').run(id);
  audit(actor?.id, actor?.username, 'delete_training_record', 'hr_training_record', id, null);
  return { deleted: true, id };
}

function deleteStaffSubmission(id, actor) {
  requireAdminRole(actor);
  getDb().prepare('DELETE FROM hr_staff_submissions WHERE id = ?').run(id);
  audit(actor?.id, actor?.username, 'delete_hr_submission', 'hr_staff_submission', id, null);
  return { deleted: true, id };
}

function updateStaffSubmission(id, data, actor) {
  requireAdminRole(actor);
  const sub = getDb().prepare('SELECT * FROM hr_staff_submissions WHERE id = ?').get(id);
  if (!sub) throw new Error('Submission not found');
  const filled = { ...parseJson(sub.filled_data, {}), ...(data.filled_data || {}) };
  getDb().prepare(`UPDATE hr_staff_submissions SET filled_data=?, status=COALESCE(?, status), review_notes=COALESCE(?, review_notes), updated_at=datetime('now') WHERE id=?`)
    .run(JSON.stringify(filled), data.status || null, data.review_notes || null, id);
  audit(actor?.id, actor?.username, 'update_hr_submission', 'hr_staff_submission', id, null);
  return getStaffSubmission(id, actor);
}

function buildTrainingEvalPdf(recordId, actor) {
  requireHrRole(actor);
  const { jsPDF } = require('jspdf');
  const rows = getTrainingRecords({}, actor);
  const rec = rows.find(r => r.id === Number(recordId)) || getDb().prepare(`
    SELECT tr.*, e.full_name AS employee_name FROM hr_training_records tr
    JOIN employees e ON e.id = tr.employee_id WHERE tr.id = ?`).get(recordId);
  if (!rec) throw new Error('Training record not found');
  const evals = rec.evaluations || parseJson(rec.evaluations_json, []);
  const doc = new jsPDF();
  doc.setFontSize(16);
  doc.text('Training Evaluation Report', 14, 20);
  doc.setFontSize(11);
  let y = 32;
  [`Employee: ${rec.employee_name || ''}`, `Start: ${rec.start_date || ''}`, `Expiry: ${rec.expiry_date || '—'}`, `Status: ${rec.status || ''}`, ''].forEach(line => {
    doc.text(line, 14, y); y += 7;
  });
  evals.forEach((ev, i) => {
    if (y > 270) { doc.addPage(); y = 20; }
    doc.text(`Evaluation ${i + 1} — ${ev.date || ''}`, 14, y); y += 7;
    doc.text(`Notes: ${(ev.notes || '').slice(0, 90)}`, 14, y); y += 7;
    (ev.items || []).slice(0, 8).forEach(it => {
      doc.text(`• ${typeof it === 'string' ? it : (it.task || JSON.stringify(it))}`, 18, y);
      y += 6;
    });
    y += 4;
  });
  return Buffer.from(doc.output('arraybuffer'));
}

function saveTrainingEvaluation(recordId, evalEntry, actor) {
  requireHrRole(actor);
  const rec = getDb().prepare('SELECT * FROM hr_training_records WHERE id = ?').get(recordId);
  if (!rec) throw new Error('Training record not found');
  const evals = parseJson(rec.evaluations_json, []);
  evals.push({
    date: evalEntry.date || today(),
    items: evalEntry.items || [],
    notes: evalEntry.notes || '',
    evaluator: actor?.full_name || actor?.username || 'Manager'
  });
  getDb().prepare(`UPDATE hr_training_records SET evaluations_json=?, updated_at=datetime('now') WHERE id=?`)
    .run(JSON.stringify(evals), recordId);
  return getDb().prepare('SELECT * FROM hr_training_records WHERE id = ?').get(recordId);
}

function canAccessHr(actor, employeeId) {
  try {
    const u = assertUserActor(actor, null);
    if (['owner', 'manager', 'supervisor', 'assistant_manager'].includes(u.role)) return true;
    if (employeeId && u.id) {
      const emp = getDb().prepare('SELECT user_id FROM employees WHERE id = ?').get(employeeId);
      if (emp?.user_id === u.id) return true;
    }
  } catch { /* not an authenticated privileged user */ }
  if (employeeId && actor?.employee_id && Number(actor.employee_id) === Number(employeeId)) {
    try {
      const { assertEmployeeActor } = require('./authz');
      assertEmployeeActor(actor);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

function getStaffSubmissions(filters = {}, actor) {
  if (!canAccessHr(actor, filters.employee_id)) requireHrRole(actor);
  let sql = `SELECT s.*, e.full_name AS employee_name, e.employee_code, t.title AS template_title,
    au.full_name AS assigned_to_name, su.full_name AS submitted_by_name
    FROM hr_staff_submissions s
    JOIN employees e ON e.id = s.employee_id
    LEFT JOIN hr_contract_templates t ON t.id = s.template_id
    LEFT JOIN users au ON au.id = s.assigned_to_user_id
    LEFT JOIN users su ON su.id = s.submitted_by
    WHERE 1=1`;
  const params = [];
  if (filters.employee_id) { sql += ' AND s.employee_id = ?'; params.push(filters.employee_id); }
  if (filters.status) { sql += ' AND s.status = ?'; params.push(filters.status); }
  if (filters.template_type) { sql += ' AND s.template_type = ?'; params.push(filters.template_type); }
  if (filters.assigned_to_user_id) { sql += ' AND s.assigned_to_user_id = ?'; params.push(filters.assigned_to_user_id); }
  if (!isHrAdmin(actor) && ['manager', 'supervisor', 'assistant_manager'].includes(require('./authz').loadUserById(actor?.id)?.role)) {
    sql += ' AND (s.assigned_to_user_id = ? OR s.assigned_to_user_id IS NULL)';
    params.push(actor.id);
  }
  sql += ' ORDER BY s.created_at DESC';
  return getDb().prepare(sql).all(...params).map(s => ({
    ...s,
    filled_data: parseJson(s.filled_data, {}),
    doc_paths: parseJson(s.doc_paths, [])
  }));
}

function getStaffSubmission(id, actor) {
  const rows = getStaffSubmissions({}, actor);
  return rows.find(x => x.id === id) || null;
}

function assignStaffTemplate(data, actor) {
  requireAdminRole(actor);
  const db = getDb();
  const emp = db.prepare('SELECT full_name, id_number, position FROM employees WHERE id = ?').get(data.employee_id);
  if (!emp) throw new Error('Employee not found');
  const tpl = data.template_id ? db.prepare('SELECT * FROM hr_contract_templates WHERE id = ?').get(data.template_id) : null;
  const assignedTo = data.assigned_to_user_id || null;
  if (assignedTo) {
    const u = db.prepare('SELECT id, role FROM users WHERE id = ?').get(assignedTo);
    if (!u || !['owner', 'manager', 'supervisor', 'assistant_manager'].includes(u.role)) {
      throw new Error('Assign to a manager or supervisor user');
    }
  }
  const r = db.prepare(`INSERT INTO hr_staff_submissions (employee_id, template_type, template_id, filled_data, doc_paths, status, assigned_to_user_id)
    VALUES (?,?,?,?,?,?,?)`).run(
    data.employee_id,
    data.template_type || tpl?.type || 'training',
    data.template_id || null,
    JSON.stringify({
      template_body: tpl?.body || '',
      assigned_at: today(),
      assigned_to_user_id: assignedTo,
      employee_name: emp.full_name,
      id_number: emp.id_number || '',
      position: emp.position || '',
      branch: data.branch || '',
      notes: data.notes || ''
    }),
    JSON.stringify([]),
    'pending',
    assignedTo
  );
  audit(actor?.id, actor?.username, 'assign_hr_template', 'hr_staff_submission', r.lastInsertRowid, {
    employee_id: data.employee_id,
    assigned_to_user_id: assignedTo
  });
  return getStaffSubmission(r.lastInsertRowid, actor);
}

function submitStaffForm(data, actor) {
  const db = getDb();
  const sub = db.prepare('SELECT * FROM hr_staff_submissions WHERE id = ?').get(data.id);
  if (!sub) throw new Error('Submission not found');
  if (!canAccessHr(actor, sub.employee_id)) requireHrRole(actor);
  if (sub.status !== 'pending') throw new Error('Submission already reviewed');
  if (sub.assigned_to_user_id && sub.assigned_to_user_id !== actor?.id && !isHrAdmin(actor)) {
    throw new Error('This form is assigned to another manager/supervisor');
  }
  const filled = parseJson(sub.filled_data, {});
  Object.assign(filled, data.filled_data || {});
  filled.submitted_at = today();
  filled.submitted_by_name = actor?.full_name || actor?.username || '';
  let docPaths = parseJson(sub.doc_paths, []);
  if (data.doc_paths?.length) docPaths = [...docPaths, ...data.doc_paths];
  if (data.require_cv && !docPaths.length) throw new Error('Upload a CV or supporting document before submitting');
  db.prepare(`UPDATE hr_staff_submissions SET filled_data=?, doc_paths=?, submitted_by=?, submitted_at=datetime('now'), updated_at=datetime('now') WHERE id=?`)
    .run(JSON.stringify(filled), JSON.stringify(docPaths), actor?.id || null, data.id);
  audit(actor?.id, actor?.username, 'submit_hr_form', 'hr_staff_submission', data.id, null);
  return getStaffSubmission(data.id, actor);
}

function reviewStaffSubmission(id, decision, notes, actor) {
  requireAdminRole(actor);
  if (!['approved', 'rejected'].includes(decision)) throw new Error('Decision must be approved or rejected');
  getDb().prepare(`UPDATE hr_staff_submissions SET status=?, reviewed_by=?, reviewed_at=datetime('now'), review_notes=?, updated_at=datetime('now') WHERE id=?`)
    .run(decision, actor?.id || null, notes || null, id);
  audit(actor?.id, actor?.username, `hr_submission_${decision}`, 'hr_staff_submission', id, { notes });
  return getStaffSubmission(id, actor);
}

function saveStaffSubmissionDoc(submissionId, filePath, actor) {
  const sub = getDb().prepare('SELECT * FROM hr_staff_submissions WHERE id = ?').get(submissionId);
  if (!sub) throw new Error('Submission not found');
  if (!canAccessHr(actor, sub.employee_id)) requireHrRole(actor);
  const docs = parseJson(sub.doc_paths, []);
  docs.push(filePath);
  getDb().prepare(`UPDATE hr_staff_submissions SET doc_paths=?, updated_at=datetime('now') WHERE id=?`)
    .run(JSON.stringify(docs), submissionId);
  return getStaffSubmission(submissionId, actor);
}

function copyStaffDocToAssets(srcPath, submissionId, label) {
  if (!srcPath || !fs.existsSync(srcPath)) throw new Error('File not found');
  const ext = path.extname(srcPath) || '.bin';
  const dest = path.join(getHrAssetsDir('submissions'), `sub-${submissionId}-${label || 'doc'}-${Date.now()}${ext}`);
  fs.copyFileSync(srcPath, dest);
  return dest;
}

const CHISANYAMA_PROBATION_TEMPLATE = `# CHISANYAMA CONNECTION

# PROBATION EMPLOYMENT AGREEMENT

## Employee Details

Employee Name: ___________________________________

ID Number: _______________________________________

Position: _________________________________________

Branch: __________________________________________

Probation Start Date: _____________________________

Probation End Date: _______________________________

Probation Period: ______ Months

---

## Purpose of Probation

The purpose of this probation period is to assess whether the employee is suitable for the position by evaluating performance, conduct, reliability, attendance, punctuality, and ability to meet company standards.

---

## Conditions During Probation

During the probation period, the employee is expected to:

* Arrive at work on time.
* Follow all company rules and procedures.
* Maintain good customer service.
* Handle company property responsibly.
* Maintain high standards of hygiene.
* Perform assigned duties diligently.
* Work cooperatively with other employees.
* Follow instructions from supervisors and managers.

---

## Performance Reviews

The employee's performance may be reviewed regularly during the probation period.

Areas of assessment include:

* Attendance
* Punctuality
* Work quality
* Productivity
* Customer service
* Teamwork
* Discipline
* Ability to learn
* Compliance with company policies

---

## Outcomes of Probation

At the end of the probation period, the employer may:

* Confirm permanent employment.
* Extend the probation period where appropriate and lawful.
* End the employment relationship if the employee has not met the required standards, following applicable labour laws and a fair process.

---

## Confidentiality

The employee agrees not to disclose confidential business information, recipes, pricing, customer information, financial information, or company procedures during or after employment.

---

## Company Property

All company property must be returned immediately upon request or when employment ends.

---

## Declaration

I confirm that I have read and understood this probation agreement and agree to comply with the company's policies and procedures.

Employee Signature:

---

Date:

---

Employer Signature:

---

Date:

---`;

const CHISANYAMA_TRAINING_TEMPLATE = `# CHISANYAMA CONNECTION

# EMPLOYEE TRAINING AGREEMENT

## Employee Information

Employee Name: ___________________________________

ID Number: _______________________________________

Position: _________________________________________

Branch: __________________________________________

Training Start Date: _______________________________

Training End Date: _________________________________

Trainer/Supervisor: ________________________________

---

## Purpose of Training

This training is designed to equip the employee with the knowledge and practical skills required to perform their duties safely, professionally, and according to the standards of Chisanyama Connection.

---

## Training Programme

The employee will receive training on:

* Company rules and policies
* Customer service
* Food safety and hygiene
* Kitchen procedures
* Braai procedures
* POS system operation
* Cash handling
* Stock receiving
* Inventory and recipe management
* Waste and damaged stock reporting
* Cleaning procedures
* Health and safety
* Opening and closing procedures
* Teamwork and communication
* Emergency procedures

---

## Employee Responsibilities

The employee agrees to:

* Attend all training sessions.
* Follow instructions from trainers and supervisors.
* Complete all practical exercises.
* Respect company policies.
* Protect company equipment and information.
* Maintain confidentiality.

---

## Employer Responsibilities

The employer agrees to:

* Provide the required training.
* Provide supervision during training.
* Evaluate performance fairly.
* Give constructive feedback.
* Provide a safe training environment.

---

## Training Evaluation

The employee's performance will be assessed based on:

* Attendance
* Punctuality
* Customer service
* Practical skills
* Teamwork
* Hygiene
* Work ethic
* Ability to operate the POS
* Ability to follow company procedures

---

## Completion

Successful completion of training does not automatically guarantee permanent employment. Employment decisions remain at the discretion of the employer, subject to performance, business needs, and applicable labour laws.

---

Employee Signature:

---

Date:

---

Trainer Signature:

---

Date:

---

Employer Signature:

---

Date:

---`;

function upsertHrTemplate(db, { key, type, title, body }) {
  const byKey = db.prepare('SELECT id, body FROM hr_contract_templates WHERE template_key = ?').get(key);
  if (byKey) {
    const shouldSeedBody = !byKey.body?.trim() || !String(byKey.body).includes('CHISANYAMA CONNECTION');
    if (shouldSeedBody) {
      db.prepare(`UPDATE hr_contract_templates SET type=?, title=?, body=?, updated_at=datetime('now') WHERE template_key=?`)
        .run(type, title, body, key);
    }
    return;
  }
  const legacy = db.prepare(`SELECT id FROM hr_contract_templates WHERE type = ? AND (template_key IS NULL OR template_key = '') ORDER BY id LIMIT 1`).get(type);
  if (legacy) {
    db.prepare(`UPDATE hr_contract_templates SET template_key=?, type=?, title=?, body=?, updated_at=datetime('now') WHERE id=?`)
      .run(key, type, title, body, legacy.id);
    return;
  }
  db.prepare('INSERT INTO hr_contract_templates (type, title, body, template_key) VALUES (?,?,?,?)').run(type, title, body, key);
}

function ensureDefaultHrTemplates() {
  const db = getDb();
  upsertHrTemplate(db, {
    key: 'chisanyama_probation',
    type: 'probation',
    title: 'Chisanyama Connection — Probation Employment Agreement',
    body: CHISANYAMA_PROBATION_TEMPLATE
  });
  upsertHrTemplate(db, {
    key: 'chisanyama_training',
    type: 'training',
    title: 'Chisanyama Connection — Employee Training Agreement',
    body: CHISANYAMA_TRAINING_TEMPLATE
  });
  const empCount = db.prepare(`SELECT COUNT(*) AS c FROM hr_contract_templates WHERE type = 'employment'`).get().c;
  if (!empCount) {
    db.prepare('INSERT INTO hr_contract_templates (type, title, body, template_key) VALUES (?,?,?,?)').run(
      'employment',
      'Chisanyama Connection — Employment Contract Acknowledgement',
      'I, {{employee_name}}, acknowledge receipt and acceptance of my employment contract dated {{date}}.',
      'chisanyama_employment'
    );
  }
}

module.exports = {
  getHrContractTemplates,
  saveHrContractTemplate,
  deleteHrContractTemplate,
  getTrainingRecords,
  saveTrainingRecord,
  deleteTrainingRecord,
  saveTrainingEvaluation,
  buildTrainingEvalPdf,
  getStaffSubmissions,
  getStaffSubmission,
  assignStaffTemplate,
  submitStaffForm,
  reviewStaffSubmission,
  updateStaffSubmission,
  deleteStaffSubmission,
  saveStaffSubmissionDoc,
  copyStaffDocToAssets,
  ensureDefaultHrTemplates
};

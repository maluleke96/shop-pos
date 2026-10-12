/**
 * Employee document centre.
 * Uses existing employees, hr_forms, hr_form_submissions and hr_external_links.
 * A signed form does not change employment, probation or payroll status.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getDb, getDbDir } = require('../database/db');

const CONSENT = 'I confirm that I have read this version of the document. My drawn signature is my acknowledgement. This is an ordinary electronic signature under the Electronic Communications and Transactions Act. It is not an advanced electronic signature, and signing it does not by itself change my job, probation or pay.';

const FIELDS = {
  person: [
    { key: 'full_legal_name', label: 'Full legal name', type: 'text', required: true },
    { key: 'position', label: 'Position', type: 'text', required: true },
    { key: 'branch', label: 'Branch', type: 'text', required: true },
    { key: 'start_date', label: 'Date', type: 'date', required: true }
  ],
  ack: [
    { key: 'acknowledged', label: 'I have read and understand this document', type: 'checkbox', required: true },
    { key: 'notes', label: 'Notes', type: 'longtext', required: false }
  ],
  review: [
    { key: 'period', label: 'Review period', type: 'text', required: true },
    { key: 'outcome_notes', label: 'Comments', type: 'longtext', required: true },
    { key: 'acknowledged', label: 'I have read this review', type: 'checkbox', required: true }
  ]
};

function tpl(code, title, audience, fields, body, formType) {
  return {
    code,
    title,
    audience,
    form_type: formType || (audience === 'manager' ? 'manager_record' : 'employee_sign'),
    needs_employee_sign: audience !== 'manager',
    needs_manager_sign: audience === 'both' || audience === 'manager',
    needs_otp: audience !== 'manager',
    fields,
    body
  };
}

const CATALOG = [
  tpl('job-application', 'Job Application Form', 'employee', FIELDS.person, 'Application for work at Chisanyama Connection. This form does not appoint the applicant.'),
  tpl('interview-assessment', 'Interview and Assessment Form', 'both', FIELDS.review, 'Interview notes. A signature records that the interview happened. It does not make a job offer.'),
  tpl('reference-verification', 'Reference Verification Record', 'manager', FIELDS.review, 'Manager record of a reference check. Not sent to the employee for signature.'),
  tpl('job-offer-acceptance', 'Job Offer and Acceptance', 'employee', FIELDS.person.concat(FIELDS.ack), 'Offer acknowledgement. Appointment still follows the existing employment record and contract.'),
  tpl('employee-personal-details', 'Employee Personal Details', 'employee', FIELDS.person.concat([{ key: 'phone', label: 'Phone', type: 'text', required: true }, { key: 'address', label: 'Address', type: 'longtext', required: true }]), 'Personal details for the employee file. Do not put bank or medical information in this form.'),
  tpl('document-receipt-checklist', 'Employee Document Receipt Checklist', 'employee', FIELDS.ack, 'Checklist that copies of the listed workplace documents were received.'),
  tpl('employment-contract', 'Employment Contract', 'employee', FIELDS.ack, 'The binding contract remains the existing Contracts and Probation record. This link collects the employee signature on that contract.', 'existing_contract'),
  tpl('job-description', 'Job Description and Duties Agreement', 'employee', FIELDS.person.concat(FIELDS.ack), 'Duties agreement for the named position.'),
  tpl('code-of-conduct', 'Code of Conduct', 'employee', FIELDS.ack, 'Workplace conduct acknowledgement.'),
  tpl('confidentiality-agreement', 'Confidentiality and Trade Secrets Agreement', 'employee', FIELDS.ack, 'Confidentiality acknowledgement. It does not replace a separately negotiated restraint.'),
  tpl('restraint-annexure', 'Non-Solicitation and Restraint Annexure', 'both', FIELDS.ack, 'Annexure only. A restraint must be reviewed before it is treated as enforceable.'),
  tpl('pos-access-agreement', 'POS, Cash, Stock and System Access Agreement', 'employee', FIELDS.ack, 'Rules for till, cash and stock access.'),
  tpl('popia-acknowledgement', 'POPIA and Customer Information Acknowledgement', 'employee', FIELDS.ack, 'Acknowledgement of customer-information duties.'),
  tpl('handbook-acknowledgement', 'Employee Handbook Acknowledgement', 'employee', FIELDS.ack, 'Acknowledgement that the handbook was received.'),
  tpl('probation-agreement', 'Probation Agreement and Performance Standards', 'employee', FIELDS.person.concat(FIELDS.ack), 'Probation standards. Signing does not pass, extend or fail probation.'),
  tpl('induction-checklist', 'Induction and Orientation Checklist', 'employee', FIELDS.ack, 'Induction items completed with the employee.'),
  tpl('training-attendance', 'Training Attendance Register', 'manager', [{ key: 'session', label: 'Session', type: 'text', required: true }, { key: 'attendees', label: 'Who attended', type: 'longtext', required: true }], 'Manager register. Use the existing training record for the official result.'),
  tpl('recipe-competency', 'Food Preparation and Recipe Competency Checklist', 'both', FIELDS.review, 'Competency checklist. It does not by itself certify the employee.'),
  tpl('hygiene-training', 'Food Hygiene and Safety Training Record', 'both', FIELDS.review, 'Hygiene training record.'),
  tpl('pos-training-assessment', 'POS, Cash and Stock Training Assessment', 'both', FIELDS.review, 'Till training assessment.'),
  tpl('competency-assessment', 'Employee Competency Assessment', 'both', FIELDS.review, 'Competency assessment.'),
  tpl('probation-review', 'Probation Review Form', 'both', FIELDS.review, 'Review comments. The existing probation screen still records the decision.'),
  tpl('probation-outcome', 'Probation Outcome Record', 'manager', FIELDS.review, 'Manager note of an outcome. It does not change the probation record by itself.'),
  tpl('attendance-register', 'Attendance and Working Hours Register', 'manager', [{ key: 'period', label: 'Period', type: 'text', required: true }, { key: 'notes', label: 'Notes', type: 'longtext', required: false }], 'Manager register. Daily attendance stays on the attendance clock.'),
  tpl('shift-handover', 'Shift Handover Checklist', 'manager', FIELDS.ack, 'Manager handover checklist.'),
  tpl('cashup-reconciliation', 'Cash-Up and POS Reconciliation', 'manager', [{ key: 'shift', label: 'Shift', type: 'text', required: true }, { key: 'notes', label: 'Notes', type: 'longtext', required: true }], 'Manager cash-up record. It does not post money.'),
  tpl('stock-receiving', 'Stock Receiving and Counting Register', 'manager', FIELDS.ack, 'Manager stock count note. It does not adjust stock.'),
  tpl('waste-report', 'Waste and Spoilage Report', 'manager', [{ key: 'item', label: 'Item', type: 'text', required: true }, { key: 'notes', label: 'What happened', type: 'longtext', required: true }], 'Manager waste note. It does not write off stock.'),
  tpl('cleaning-checklist', 'Cleaning and Food Safety Checklist', 'manager', FIELDS.ack, 'Manager cleaning checklist.'),
  tpl('property-issue', 'Equipment and Property Issue Register', 'both', [{ key: 'item', label: 'Item issued', type: 'text', required: true }, { key: 'acknowledged', label: 'I received this item', type: 'checkbox', required: true }], 'Record of property handed to the employee.'),
  tpl('incident-report', 'Incident and Customer Complaint Report', 'manager', [{ key: 'incident_date', label: 'Incident date', type: 'date', required: true }, { key: 'notes', label: 'What happened', type: 'longtext', required: true }], 'Manager incident note. Use the existing incident case for the official record.'),
  tpl('leave-request', 'Leave and Absence Request', 'employee', [{ key: 'start_date', label: 'From', type: 'date', required: true }, { key: 'end_date', label: 'To', type: 'date', required: true }, { key: 'reason', label: 'Reason', type: 'longtext', required: true }], 'Leave request. It does not approve leave. The existing leave workflow still decides.'),
  tpl('performance-review', 'Performance Review', 'both', FIELDS.review, 'Performance review acknowledgement.'),
  tpl('written-warning', 'Written Warning', 'both', [{ key: 'warning_date', label: 'Warning date', type: 'date', required: true }, { key: 'details', label: 'What the warning says', type: 'longtext', required: true }, { key: 'acknowledged', label: 'I have received this warning', type: 'checkbox', required: true }], 'Receipt of a warning. Signing is not an admission unless the employee writes that it is.'),
  tpl('disciplinary-meeting', 'Disciplinary Meeting Record', 'both', FIELDS.review, 'Meeting record. It does not dismiss the employee.'),
  tpl('employee-response', 'Employee Written Response', 'employee', [{ key: 'response', label: 'My response', type: 'longtext', required: true }], 'The employee’s own written response.'),
  tpl('investigation-register', 'Investigation and Evidence Register', 'manager', FIELDS.review, 'Manager investigation note.'),
  tpl('discrepancy-investigation', 'Cash or Stock Discrepancy Investigation', 'manager', FIELDS.review, 'Manager discrepancy note. It does not deduct pay.'),
  tpl('data-incident', 'Confidentiality or Data Incident Report', 'both', FIELDS.review, 'Data incident report.'),
  tpl('corrective-action', 'Corrective Action Plan', 'both', [{ key: 'action', label: 'Action agreed', type: 'longtext', required: true }, { key: 'due_date', label: 'Due date', type: 'date', required: true }], 'Corrective action. It does not change employment status.'),
  tpl('resignation-termination', 'Resignation or Termination Record', 'both', [{ key: 'last_day', label: 'Last working day', type: 'date', required: true }, { key: 'notes', label: 'Notes', type: 'longtext', required: true }], 'Record only. It does not terminate the employee record.'),
  tpl('exit-interview', 'Exit Interview', 'employee', [{ key: 'feedback', label: 'Feedback', type: 'longtext', required: true }], 'Exit interview.'),
  tpl('property-return', 'Return of Business Property', 'both', [{ key: 'items', label: 'Items returned', type: 'longtext', required: true }, { key: 'acknowledged', label: 'These items were returned', type: 'checkbox', required: true }], 'Property return checklist.'),
  tpl('access-revocation', 'System Access Revocation Checklist', 'manager', FIELDS.ack, 'Manager checklist. It does not disable the user account by itself.'),
  tpl('final-pay-reconciliation', 'Final Pay and Leave Reconciliation', 'manager', FIELDS.review, 'Manager payroll note. It does not pay or deduct wages.'),
  tpl('exit-confidentiality', 'Exit Confidentiality Reminder', 'employee', FIELDS.ack, 'Reminder that confidentiality continues after the last day.'),
  tpl('file-closure', 'Employee File Closure Checklist', 'manager', FIELDS.ack, 'Manager file-closure checklist. It does not delete the employee.')
];

function db() { return getDb(); }
function nowIso() { return new Date().toISOString(); }
function num(v) { return Math.floor(Number(v) || 0); }

function execIgnore(sql) {
  try { db().exec(sql); } catch (_) { /* table already present */ }
}

function ensureDocCentre() {
  execIgnore(`CREATE TABLE IF NOT EXISTS hr_doc_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    link_id INTEGER,
    submission_id INTEGER,
    actor_id INTEGER,
    action TEXT NOT NULL,
    detail_json TEXT,
    created_at TEXT
  )`);
  execIgnore(`CREATE TABLE IF NOT EXISTS hr_signed_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    submission_id INTEGER,
    reference_code TEXT,
    sha256 TEXT,
    pdf_base64 TEXT,
    created_at TEXT
  )`);
  seedTemplates();
}

function seedTemplates() {
  const insert = db().prepare(`INSERT INTO hr_forms (code, title, form_type, schema_json, status, created_at, updated_at)
    VALUES (?,?,?,?, 'active', ?, ?)`);
  const now = nowIso();
  for (const item of CATALOG) {
    const existing = db().prepare('SELECT id FROM hr_forms WHERE code = ?').get(item.code);
    if (existing) continue;
    insert.run(item.code, item.title, item.form_type, JSON.stringify(schemaOf(item)), now, now);
  }
}

function schemaOf(item) {
  return {
    version: 1,
    audience: item.audience,
    needs_employee_sign: item.needs_employee_sign,
    needs_manager_sign: item.needs_manager_sign,
    needs_otp: item.needs_otp,
    fields: item.fields,
    body: item.body,
    effective_date: '2026-10-11'
  };
}

function parseJson(value, fallback) {
  try { return value ? JSON.parse(value) : fallback; } catch (_) { return fallback; }
}

function event(linkId, submissionId, actor, action, detail) {
  try {
    db().prepare(`INSERT INTO hr_doc_events (link_id, submission_id, actor_id, action, detail_json, created_at)
      VALUES (?,?,?,?,?,?)`).run(linkId || null, submissionId || null, actor?.id || null, action, JSON.stringify(detail || {}), nowIso());
  } catch (_) { /* audit must not block the document */ }
}

function requireHr(actor, write) {
  if (!actor?.id) throw new Error('Authentication required');
  const role = String(actor.role || '').toLowerCase();
  const allowed = ['owner', 'manager', 'supervisor', 'assistant_manager', 'admin'];
  if (!allowed.includes(role)) throw new Error('Not authorized for employee documents');
  if (write && !['owner', 'manager', 'supervisor', 'assistant_manager', 'admin'].includes(role)) {
    throw new Error('Not authorized to issue documents');
  }
  return actor;
}

function employeeById(id) {
  return db().prepare('SELECT id, employee_code, full_name, phone, email, position, branch, status FROM employees WHERE id = ?').get(num(id));
}

function assertBranch(actor, employee) {
  const role = String(actor.role || '').toLowerCase();
  if (role === 'owner' || role === 'manager' || role === 'admin') return;
  if (!actor.branch_id || !employee?.branch) return;
  let branchName = '';
  try { branchName = db().prepare('SELECT name FROM branches WHERE id = ?').get(num(actor.branch_id))?.name || ''; } catch (_) { branchName = ''; }
  if (branchName && String(employee.branch).trim().toLowerCase() !== String(branchName).trim().toLowerCase()) {
    throw new Error('This employee is not in your branch');
  }
}

function formByCode(code) {
  const row = db().prepare('SELECT * FROM hr_forms WHERE code = ?').get(String(code || ''));
  if (!row) throw new Error('Document template not found');
  row.schema = parseJson(row.schema_json, {});
  return row;
}

function hashContent(schema, fields) {
  return crypto.createHash('sha256').update(JSON.stringify({ version: schema.version, body: schema.body, fields: fields || {} })).digest('hex');
}

function publicOrigin() {
  return String(process.env.SHOP_POS_PUBLIC_URL || process.env.SHOP_POS_SYNC_URL || '').replace(/\/$/, '');
}

function linkUrl(token) {
  const pathPart = `/hr-sign/?t=${encodeURIComponent(token)}`;
  const origin = publicOrigin();
  return origin ? origin + pathPart : pathPart;
}

function loadLink(token) {
  ensureDocCentre();
  const row = db().prepare('SELECT * FROM hr_external_links WHERE token = ?').get(String(token || ''));
  if (!row) throw new Error('This link is not valid');
  row.payload = parseJson(row.payload_json, {});
  row.form = db().prepare('SELECT * FROM hr_forms WHERE id = ?').get(row.form_id);
  if (row.form) row.form.schema = parseJson(row.form.schema_json, {});
  return row;
}

function assertOpen(link) {
  if (['revoked', 'cancelled', 'submitted', 'declined'].includes(String(link.status))) {
    throw new Error('This link can no longer be used');
  }
  if (link.used_at) throw new Error('This document was already submitted');
  if (link.expires_at && new Date(link.expires_at).getTime() < Date.now()) {
    db().prepare(`UPDATE hr_external_links SET status = 'expired' WHERE id = ? AND status NOT IN ('submitted','revoked','cancelled')`).run(link.id);
    throw new Error('This link has expired');
  }
}

function dashboard(actor, filters) {
  ensureDocCentre();
  requireHr(actor, false);
  const f = filters || {};
  let where = '1=1';
  const params = [];
  if (f.employee_id) { where += ' AND l.employee_id = ?'; params.push(num(f.employee_id)); }
  if (f.status) { where += ' AND l.status = ?'; params.push(String(f.status)); }
  if (f.code) { where += ' AND f.code = ?'; params.push(String(f.code)); }
  const rows = db().prepare(`SELECT l.id, l.status, l.expires_at, l.created_at, l.used_at, l.employee_id, l.form_id,
      f.title, f.code, f.form_type, e.full_name, e.branch, e.employee_code
    FROM hr_external_links l
    LEFT JOIN hr_forms f ON f.id = l.form_id
    LEFT JOIN employees e ON e.id = l.employee_id
    WHERE ${where}
    ORDER BY l.id DESC LIMIT 200`).all(...params).filter((row) => {
    if (!row.employee_id) return String(actor.role || '').toLowerCase() !== 'supervisor';
    try { assertBranch(actor, { branch: row.branch }); return true; } catch (_) { return false; }
  });
  const now = Date.now();
  const count = (pred) => rows.filter(pred).length;
  return {
    templates: db().prepare(`SELECT COUNT(*) AS c FROM hr_forms WHERE code IS NOT NULL`).get()?.c || 0,
    awaiting_employee: count((r) => ['active', 'opened'].includes(r.status)),
    completed: count((r) => r.status === 'submitted'),
    declined: count((r) => r.status === 'declined'),
    expired: count((r) => r.status === 'expired' || (r.expires_at && new Date(r.expires_at).getTime() < now && ['active', 'opened'].includes(r.status))),
    overdue: count((r) => {
      const due = parseJson(db().prepare('SELECT payload_json FROM hr_external_links WHERE id = ?').get(r.id)?.payload_json, {}).due_at;
      return due && new Date(due).getTime() < now && ['active', 'opened'].includes(r.status);
    }),
    drafts: count((r) => r.status === 'draft'),
    revoked: count((r) => r.status === 'revoked' || r.status === 'cancelled'),
    documents: rows.map((r) => ({
      id: r.id,
      status: r.status,
      title: r.title,
      code: r.code,
      employee: r.full_name || 'Applicant',
      employee_code: r.employee_code || '',
      branch: r.branch || '',
      expires_at: r.expires_at,
      created_at: r.created_at
    }))
  };
}

function listTemplates(actor) {
  ensureDocCentre();
  requireHr(actor, false);
  return db().prepare(`SELECT id, code, title, form_type, status FROM hr_forms WHERE code IS NOT NULL ORDER BY id`).all();
}

function listEmployees(actor) {
  requireHr(actor, false);
  return db().prepare(`SELECT id, full_name, employee_code, position, branch, phone, status FROM employees ORDER BY full_name LIMIT 400`).all()
    .filter((row) => {
      try { assertBranch(actor, row); return true; } catch (_) { return false; }
    })
    .map((row) => ({ id: row.id, name: row.full_name, code: row.employee_code, position: row.position, branch: row.branch, status: row.status }));
}

async function notifyPhone(phone, text) {
  if (!phone) return { ok: false, error: 'No phone number on the employee' };
  try {
    const result = await require('./cc-providers').sendWhatsApp({ to: phone, text });
    return result || { ok: false, error: 'WhatsApp did not send' };
  } catch (err) {
    return { ok: false, error: err.message || 'WhatsApp did not send' };
  }
}

async function issue(actor, body) {
  ensureDocCentre();
  requireHr(actor, true);
  const data = body || {};
  const form = formByCode(data.code);
  if (form.schema.audience === 'manager' && data.public_link) {
    throw new Error('This record stays inside HR and is not sent to an employee');
  }
  const employee = data.employee_id ? employeeById(data.employee_id) : null;
  if (data.employee_id && !employee) throw new Error('Employee not found');
  if (employee) assertBranch(actor, employee);
  if (!employee && !data.applicant_name) throw new Error('Choose an employee or enter the applicant name');
  let contractId = null;
  if (form.form_type === 'existing_contract' && employee) {
    try {
      const contracts = require('./hr-contracts');
      const pending = db().prepare(`SELECT id FROM employee_contracts WHERE employee_id = ? AND status = 'pending_signatures' ORDER BY id DESC LIMIT 1`).get(employee.id);
      if (pending) contractId = pending.id;
      else {
        const populated = contracts.populateContractFromEmployee(employee.id, null);
        const saved = contracts.saveContract({
          employee_id: employee.id,
          template_id: populated.template_id || null,
          contract_data: populated,
          status: 'pending_signatures'
        }, actor.id, actor.full_name || actor.username || '');
        contractId = saved?.id || saved?.lastInsertRowid || null;
      }
    } catch (_) { contractId = null; }
  }
  const token = crypto.randomBytes(32).toString('hex');
  const days = Math.min(30, Math.max(1, num(data.expires_days) || 7));
  const expires = new Date(Date.now() + days * 86400000).toISOString();
  const due = data.due_at || expires;
  const payload = {
    due_at: due,
    version: form.schema.version || 1,
    applicant_name: employee ? null : String(data.applicant_name || '').slice(0, 120),
    branch: employee?.branch || data.branch || '',
    position: employee?.position || data.position || '',
    otp_hash: null,
    otp_expires: null,
    otp_tries: 0,
    opened_at: null
  };
  const linkStatus = form.schema.audience === 'manager' ? 'draft' : 'active';
  const inserted = db().prepare(`INSERT INTO hr_external_links
    (link_type, token, employee_id, contract_id, form_id, payload_json, expires_at, status, created_by, created_at)
    VALUES ('employee_document', ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    token, employee?.id || null, contractId, form.id, JSON.stringify(payload), expires, linkStatus, actor.id, nowIso()
  );
  const url = linkUrl(token);
  let notification = { ok: false, manual: true };
  if (form.schema.audience !== 'manager' && employee?.phone) {
    notification = await notifyPhone(employee.phone, `Chisanyama Connection sent you a private document to complete: ${url}`);
  }
  event(inserted.lastInsertRowid, null, actor, 'issued', { code: form.code, notification_ok: !!notification.ok });
  return {
    id: inserted.lastInsertRowid,
    url: linkStatus === 'draft' ? '' : url,
    expires_at: expires,
    title: form.title,
    notification_sent: !!notification.ok,
    notification_error: notification.ok ? '' : (notification.error || 'Send the link yourself. WhatsApp Cloud is not configured.')
  };
}

function setStatus(actor, id, status) {
  ensureDocCentre();
  requireHr(actor, true);
  const link = db().prepare('SELECT * FROM hr_external_links WHERE id = ?').get(num(id));
  if (!link) throw new Error('Document link not found');
  if (link.employee_id) assertBranch(actor, employeeById(link.employee_id));
  if (status === 'revoked' && link.status === 'submitted') throw new Error('A completed document cannot be revoked');
  db().prepare('UPDATE hr_external_links SET status = ? WHERE id = ?').run(status, link.id);
  event(link.id, null, actor, status, {});
  return { id: link.id, status };
}

async function resend(actor, id) {
  const existing = db().prepare('SELECT * FROM hr_external_links WHERE id = ?').get(num(id));
  if (!existing) throw new Error('Document link not found');
  const form = db().prepare('SELECT code FROM hr_forms WHERE id = ?').get(existing.form_id);
  const payload = parseJson(existing.payload_json, {});
  if (existing.status !== 'submitted') setStatus(actor, id, 'revoked');
  const created = await issue(actor, {
    code: form?.code,
    employee_id: existing.employee_id,
    applicant_name: payload.applicant_name,
    branch: payload.branch,
    position: payload.position
  });
  event(existing.id, null, actor, 'replaced', { new_id: created.id });
  return created;
}

function assertEmployeeFacing(link) {
  if (link.form?.schema?.audience === 'manager') throw new Error('This record is completed inside HR');
}

function publicDoc(token) {
  const link = loadLink(token);
  assertEmployeeFacing(link);
  assertOpen(link);
  if (!link.payload.opened_at) {
    link.payload.opened_at = nowIso();
    db().prepare(`UPDATE hr_external_links SET status = 'opened', payload_json = ? WHERE id = ? AND status = 'active'`).run(JSON.stringify(link.payload), link.id);
    event(link.id, null, null, 'opened', {});
  }
  const employee = link.employee_id ? employeeById(link.employee_id) : null;
  const schema = link.form?.schema || {};
  return {
    title: link.form?.title || 'Document',
    reference: `HR-${link.id}`,
    version: schema.version || 1,
    body: schema.body || '',
    fields: schema.fields || [],
    consent: CONSENT,
    needs_otp: schema.needs_otp !== false && schema.audience !== 'manager',
    employee_name: employee?.full_name || link.payload.applicant_name || '',
    position: employee?.position || link.payload.position || '',
    branch: employee?.branch || link.payload.branch || '',
    employer: shopName(),
    expires_at: link.expires_at
  };
}

function shopName() {
  try { return db().prepare('SELECT shop_name FROM shop_settings WHERE id = 1').get()?.shop_name || 'Chisanyama Connection'; } catch (_) { return 'Chisanyama Connection'; }
}

function publicDecline(token, reason) {
  const link = loadLink(token);
  assertEmployeeFacing(link);
  assertOpen(link);
  db().prepare(`UPDATE hr_external_links SET status = 'declined' WHERE id = ? AND used_at IS NULL`).run(link.id);
  event(link.id, null, null, 'declined', { reason: String(reason || '').slice(0, 500) });
  return { declined: true, reference: `HR-${link.id}` };
}

async function publicOtp(token) {
  const link = loadLink(token);
  assertEmployeeFacing(link);
  assertOpen(link);
  const employee = link.employee_id ? employeeById(link.employee_id) : null;
  const code = String(crypto.randomInt(100000, 1000000));
  link.payload.otp_hash = crypto.createHash('sha256').update(code).digest('hex');
  link.payload.otp_expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  link.payload.otp_tries = 0;
  db().prepare('UPDATE hr_external_links SET payload_json = ? WHERE id = ?').run(JSON.stringify(link.payload), link.id);
  const sent = await notifyPhone(employee?.phone, `Your Chisanyama Connection document code is ${code}. It expires in 10 minutes.`);
  event(link.id, null, null, sent.ok ? 'otp_sent' : 'otp_not_sent', { channel: 'whatsapp' });
  const out = { sent: !!sent.ok, channel: sent.ok ? 'whatsapp' : 'unavailable' };
  if (!sent.ok) out.error = 'The code could not be sent to the phone on file. Ask the shop to resend the document.';
  if (process.env.HR_DOC_OTP_DEBUG === '1') out.code = code;
  return out;
}

function checkOtp(link, code) {
  const schema = link.form?.schema || {};
  if (schema.needs_otp === false || schema.audience === 'manager') return;
  if (!link.payload.otp_hash) throw new Error('Request a code first');
  if (link.payload.otp_expires && new Date(link.payload.otp_expires).getTime() < Date.now()) throw new Error('The code has expired');
  if (num(link.payload.otp_tries) >= 5) throw new Error('Too many code attempts');
  const hash = crypto.createHash('sha256').update(String(code || '')).digest('hex');
  if (hash !== link.payload.otp_hash) {
    link.payload.otp_tries = num(link.payload.otp_tries) + 1;
    db().prepare('UPDATE hr_external_links SET payload_json = ? WHERE id = ?').run(JSON.stringify(link.payload), link.id);
    throw new Error('That code is not correct');
  }
}

function validateFields(schema, input, noteFallback) {
  const out = {};
  const note = String(noteFallback || '').trim();
  for (const field of schema.fields || []) {
    let value = input?.[field.key];
    const empty = value === undefined || value === null || value === '' || value === false;
    if (field.required && empty) {
      if (!note) throw new Error(`${field.label} is required`);
      if (field.type === 'checkbox') value = true;
      else if (field.type === 'date') value = new Date().toISOString().slice(0, 10);
      else value = note;
    }
    out[field.key] = field.type === 'checkbox' ? !!value : String(value || '').slice(0, 4000);
  }
  return out;
}

function buildPdf(link, fields, signature, contentHash) {
  const { jsPDF } = require('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const schema = link.form.schema || {};
  let y = 18;
  doc.setFontSize(16);
  doc.text(shopName(), 105, y, { align: 'center' });
  y += 8;
  doc.setFontSize(13);
  doc.text(link.form.title || 'Employee document', 14, y);
  y += 7;
  doc.setFontSize(9);
  const employee = link.employee_id ? employeeById(link.employee_id) : null;
  const lines = [
    `Reference HR-${link.id}`,
    `Version ${schema.version || 1}`,
    `Employee ${employee?.full_name || link.payload.applicant_name || ''}`,
    `Position ${employee?.position || link.payload.position || ''}`,
    `Branch ${employee?.branch || link.payload.branch || ''}`,
    `Content check ${contentHash}`,
    `Signed ${nowIso()}`
  ];
  lines.forEach((line) => { doc.text(String(line).slice(0, 110), 14, y); y += 5; });
  y += 3;
  doc.setFontSize(10);
  const body = doc.splitTextToSize(String(schema.body || ''), 180);
  doc.text(body, 14, y);
  y += body.length * 5 + 4;
  Object.entries(fields).forEach(([key, value]) => {
    if (y > 270) { doc.addPage(); y = 18; }
    doc.text(`${key}: ${String(value).slice(0, 140)}`, 14, y);
    y += 5;
  });
  y += 4;
  doc.setFontSize(8);
  const consent = doc.splitTextToSize(CONSENT, 180);
  doc.text(consent, 14, y);
  y += consent.length * 4 + 4;
  if (signature && String(signature).startsWith('data:image')) {
    try { doc.addImage(signature, 'PNG', 14, y, 60, 22); } catch (_) { doc.text('Signature captured', 14, y); }
  }
  const data = doc.output('arraybuffer');
  return Buffer.from(data).toString('base64');
}

async function staffComplete(actor, linkId, body) {
  ensureDocCentre();
  requireHr(actor, true);
  const row = db().prepare('SELECT token FROM hr_external_links WHERE id = ?').get(num(linkId));
  if (!row) throw new Error('Document not found');
  const link = loadLink(row.token);
  if (link.form?.schema?.audience !== 'manager') throw new Error('Use the employee signing link for this document');
  if (link.employee_id) assertBranch(actor, employeeById(link.employee_id));
  if (['submitted', 'revoked', 'cancelled'].includes(String(link.status))) throw new Error('This record is already closed');
  const fields = validateFields(link.form.schema || {}, (body || {}).fields || {}, (body || {}).note);
  const contentHash = hashContent(link.form.schema || {}, fields);
  const pdf = buildPdf(link, fields, '', contentHash);
  const marked = db().prepare(`UPDATE hr_external_links SET status = 'submitted', used_at = ? WHERE id = ? AND used_at IS NULL`).run(nowIso(), link.id);
  if (!marked.changes) throw new Error('This document was already submitted');
  const inserted = db().prepare(`INSERT INTO hr_form_submissions
    (form_id, employee_id, external_token, filled_data, status, submitted_at, created_at)
    VALUES (?,?,?,?, 'submitted', ?, ?)`).run(
    link.form_id, link.employee_id, row.token,
    JSON.stringify({ fields, content_hash: contentHash, signed_at: nowIso(), manager_id: actor.id, version: link.form.schema?.version || 1 }),
    nowIso(), nowIso()
  );
  db().prepare(`INSERT INTO hr_signed_files (submission_id, reference_code, sha256, pdf_base64, created_at) VALUES (?,?,?,?,?)`)
    .run(inserted.lastInsertRowid, `HR-${link.id}`, contentHash, pdf, nowIso());
  event(link.id, inserted.lastInsertRowid, actor, 'manager_completed', { content_hash: contentHash });
  return { reference: `HR-${link.id}`, submitted: true };
}

async function publicSubmit(token, body) {
  const link = loadLink(token);
  assertEmployeeFacing(link);
  assertOpen(link);
  const data = body || {};
  if (!data.consent) throw new Error('The electronic signature acknowledgement is required');
  checkOtp(link, data.code);
  const signature = String(data.signature || '');
  if (!signature.startsWith('data:image/png')) throw new Error('Draw your signature before submitting');
  const fields = validateFields(link.form.schema || {}, data.fields || {});
  const contentHash = hashContent(link.form.schema || {}, fields);
  const pdf = buildPdf(link, fields, signature, contentHash);
  const filled = {
    fields,
    consent: true,
    consent_text: CONSENT,
    signature,
    content_hash: contentHash,
    signed_at: nowIso(),
    version: link.form.schema?.version || 1,
    signer_name: data.signer_name || ''
  };
  const marked = db().prepare(`UPDATE hr_external_links SET status = 'submitted', used_at = ? WHERE id = ? AND used_at IS NULL`).run(nowIso(), link.id);
  if (!marked.changes) throw new Error('This document was already submitted');
  const inserted = db().prepare(`INSERT INTO hr_form_submissions
    (form_id, employee_id, external_token, filled_data, status, submitted_at, created_at)
    VALUES (?,?,?,?, 'submitted', ?, ?)`).run(link.form_id, link.employee_id, token, JSON.stringify(filled), nowIso(), nowIso());
  db().prepare(`INSERT INTO hr_signed_files (submission_id, reference_code, sha256, pdf_base64, created_at) VALUES (?,?,?,?,?)`)
    .run(inserted.lastInsertRowid, `HR-${link.id}`, contentHash, pdf, nowIso());
  try {
    const dir = path.join(getDbDir(), 'hr-signed');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `HR-${link.id}.pdf`), Buffer.from(pdf, 'base64'));
  } catch (_) { /* the database copy remains the record */ }
  if (link.contract_id && link.employee_id) {
    try {
      const contract = db().prepare('SELECT signature_data_json FROM employee_contracts WHERE id = ?').get(link.contract_id);
      const sigs = parseJson(contract?.signature_data_json, {});
      sigs.employee = { image: signature, at: nowIso(), content_hash: contentHash };
      db().prepare(`UPDATE employee_contracts SET employee_signed_at = ?, signature_data_json = ? WHERE id = ? AND employee_signed_at IS NULL`)
        .run(nowIso(), JSON.stringify(sigs), link.contract_id);
    } catch (_) { /* contract attachment is best effort */ }
  }
  if (link.employee_id) {
    try {
      db().prepare(`INSERT INTO employee_hr_documents (employee_id, document_type, title, content, created_at)
        VALUES (?,?,?,?,?)`).run(link.employee_id, link.form?.code || 'employee_document', link.form?.title || 'Employee document', `Signed reference HR-${link.id}`, nowIso());
    } catch (_) { /* profile note is optional */ }
  }
  event(link.id, inserted.lastInsertRowid, null, 'submitted', { content_hash: contentHash });
  return { reference: `HR-${link.id}`, submitted: true };
}

function pdfForToken(token) {
  const link = loadLink(token);
  if (link.status !== 'submitted') throw new Error('This document is not complete');
  const file = db().prepare(`SELECT f.pdf_base64, f.sha256, f.reference_code FROM hr_signed_files f
    JOIN hr_form_submissions s ON s.id = f.submission_id
    WHERE s.external_token = ? ORDER BY f.id DESC LIMIT 1`).get(token);
  if (!file) throw new Error('The signed file is not available');
  return { filename: `${file.reference_code}.pdf`, pdf_base64: file.pdf_base64, sha256: file.sha256 };
}

function pdfForStaff(actor, linkId) {
  ensureDocCentre();
  requireHr(actor, false);
  const link = db().prepare('SELECT * FROM hr_external_links WHERE id = ?').get(num(linkId));
  if (!link) throw new Error('Document not found');
  if (link.employee_id) assertBranch(actor, employeeById(link.employee_id));
  event(link.id, null, actor, 'downloaded', {});
  return pdfForToken(link.token);
}

module.exports = {
  CATALOG,
  CONSENT,
  ensureDocCentre,
  dashboard,
  listTemplates,
  listEmployees,
  issue,
  setStatus,
  resend,
  publicDoc,
  publicDecline,
  publicOtp,
  publicSubmit,
  staffComplete,
  pdfForToken,
  pdfForStaff
};

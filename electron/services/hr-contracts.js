const { getDb } = require('../database/db');
const { jsPDF } = require('jspdf');
require('jspdf-autotable');
const path = require('path');
const attendancePayroll = require('./attendance-payroll');
const CHISANYAMA_BODY = require('./chisanyama-contract-template');

const EVAL_CATEGORIES = [
  'Punctuality', 'Attendance', 'Appearance', 'Teamwork', 'Communication',
  'Customer Service', 'Work Quality', 'Productivity', 'Initiative', 'Following Instructions',
  'Safety Compliance', 'Equipment Care', 'Honesty', 'Adaptability', 'Overall Attitude'
];

function parseJson(val, fallback = {}) {
  if (!val) return fallback;
  try { return typeof val === 'string' ? JSON.parse(val) : val; } catch { return fallback; }
}

function today() {
  return new Date().toLocaleDateString('en-CA');
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + Number(days) || 0);
  return d.toLocaleDateString('en-CA');
}

function audit(actorId, actorName, action, entityType, entityId, details) {
  getDb().prepare(`INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, details) VALUES (?,?,?,?,?,?)`)
    .run(actorId || null, actorName || 'system', action, entityType, entityId || null, details ? JSON.stringify(details) : null);
}

function addNotification(type, title, message) {
  const db = getDb();
  const existing = db.prepare(
    'SELECT id FROM notifications WHERE type = ? AND message = ? AND is_read = 0 AND date(created_at) = date(\'now\')'
  ).get(type, message);
  if (!existing) {
    db.prepare('INSERT INTO notifications (type, title, message) VALUES (?, ?, ?)').run(type, title, message);
  }
}

function getShopSettings() {
  const row = getDb().prepare('SELECT shop_name, address, phone, logo_path, currency, email FROM shop_settings WHERE id = 1').get() || {};
  return row;
}

function ensureEmployeeNumber(employeeId) {
  const db = getDb();
  const emp = db.prepare('SELECT employee_number, employee_code FROM employees WHERE id = ?').get(employeeId);
  if (!emp) return null;
  if (emp.employee_number) return emp.employee_number;
  const num = emp.employee_code || `EMP${String(employeeId).padStart(4, '0')}`;
  db.prepare('UPDATE employees SET employee_number = ? WHERE id = ?').run(num, employeeId);
  return num;
}

function checkbox(checked) {
  return checked ? '☑' : '☐';
}

function fillContractTemplate(body, data) {
  const d = data || {};
  const type = (d.employment_type || 'Permanent').toLowerCase();
  const prob = (d.probation_period || 'Three Months').toLowerCase();
  const salaryType = (d.salary_type || d.salary_type_label || 'Monthly').toLowerCase();
  const payMethod = (d.payment_method || 'Bank Transfer').toLowerCase();
  const days = Array.isArray(d.working_days) ? d.working_days.map(x => String(x).toLowerCase()) : [];
  const map = {
    business_name: d.business_name || 'Chisanyama Connection',
    branch: d.branch || '—',
    business_address: d.business_address || '—',
    business_phone: d.business_phone || '—',
    business_email: d.business_email || '—',
    employee_name: d.employee_name || '—',
    id_number: d.id_number || '—',
    employee_number: d.employee_number || '—',
    address: d.address || '—',
    phone: d.phone || '—',
    email: d.email || '—',
    position: d.position || '—',
    department: d.department || '—',
    reports_to: d.reports_to || '—',
    start_date: d.start_date || '—',
    end_date: d.end_date || '—',
    shift_start: d.shift_start || '—',
    shift_end: d.shift_end || '—',
    break_minutes: d.break_minutes || '30',
    currency: d.currency || 'R',
    salary_amount: Number(d.basic_salary || d.salary_amount || 0).toFixed(2),
    payment_date: d.payment_date || '—',
    employer_name: d.employer_name || '—',
    employer_position: d.employer_position || '—',
    signature_date: d.signature_date || today(),
    witness_name: d.witness_name || '—',
    probation_other_text: d.probation_other_text || '—',
    employment_type_permanent: checkbox(type.includes('permanent')),
    employment_type_fixed: checkbox(type.includes('fixed')),
    employment_type_temporary: checkbox(type.includes('temporary')),
    employment_type_casual: checkbox(type.includes('casual')),
    employment_type_parttime: checkbox(type.includes('part')),
    probation_two_weeks: checkbox(prob.includes('two week')),
    probation_one_month: checkbox(prob.includes('one month')),
    probation_two_months: checkbox(prob.includes('two month')),
    probation_three_months: checkbox(prob.includes('three month') || prob === ''),
    probation_other: checkbox(prob.includes('other')),
    day_monday: checkbox(days.includes('monday')),
    day_tuesday: checkbox(days.includes('tuesday')),
    day_wednesday: checkbox(days.includes('wednesday')),
    day_thursday: checkbox(days.includes('thursday')),
    day_friday: checkbox(days.includes('friday')),
    day_saturday: checkbox(days.includes('saturday')),
    day_sunday: checkbox(days.includes('sunday')),
    salary_monthly: checkbox(salaryType.includes('month')),
    salary_weekly: checkbox(salaryType.includes('week')),
    salary_daily: checkbox(salaryType.includes('day')),
    salary_hourly: checkbox(salaryType.includes('hour')),
    pay_bank: checkbox(payMethod.includes('bank')),
    pay_cash: checkbox(payMethod.includes('cash')),
    pay_other: checkbox(payMethod.includes('other')),
    custom_clauses: (d.custom_clauses || (d.clauses || []).map((c, i) => `\n### Additional Clause ${i + 1}\n${typeof c === 'string' ? c : c.text || c.title || ''}`).join('\n')) || ''
  };
  let out = body || CHISANYAMA_BODY;
  Object.entries(map).forEach(([k, v]) => {
    out = out.split(`{{${k}}}`).join(String(v));
  });
  return out;
}

function ensureDefaultTemplates() {
  const db = getDb();
  try {
    const hasBody = db.prepare('SELECT body_template FROM employee_contract_templates LIMIT 1').get();
    if (!hasBody) return;
  } catch (_) { return; }
  const existing = db.prepare('SELECT id, body_template FROM employee_contract_templates WHERE is_default = 1 ORDER BY id LIMIT 1').get();
  if (existing && existing.body_template) return;
  const tplId = existing?.id;
  if (tplId) {
    db.prepare(`UPDATE employee_contract_templates SET name=?, body_template=?, clauses_json=? WHERE id=?`)
      .run('Chisanyama Connection Employment Contract', CHISANYAMA_BODY, '[]', tplId);
  } else {
    db.prepare(`INSERT INTO employee_contract_templates (name, position, clauses_json, body_template, is_default) VALUES (?,?,?,?,1)`)
      .run('Chisanyama Connection Employment Contract', 'General Staff', '[]', CHISANYAMA_BODY);
  }
}

function populateContractFromEmployee(employeeId, templateId) {
  const db = getDb();
  const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(employeeId);
  if (!emp) throw new Error('Employee not found');
  const shop = getShopSettings();
  const tpl = templateId
    ? db.prepare('SELECT * FROM employee_contract_templates WHERE id = ?').get(templateId)
    : db.prepare('SELECT * FROM employee_contract_templates WHERE is_default = 1 ORDER BY id LIMIT 1').get();
  const clauses = parseJson(tpl?.clauses_json, []);
  const schedule = parseJson(emp.work_schedule, {});
  ensureEmployeeNumber(employeeId);
  return {
    employee_id: employeeId,
    template_id: tpl?.id || null,
    employee_name: emp.full_name,
    employee_number: emp.employee_number || emp.employee_code,
    position: emp.position || tpl?.position || '',
    department: emp.department || '',
    branch: emp.branch || '',
    id_number: emp.id_number || '',
    date_hired: emp.date_hired || today(),
    employment_type: emp.employment_type || 'Permanent',
    basic_salary: emp.basic_salary || 0,
    salary_amount: emp.basic_salary || 0,
    salary_type: emp.salary_type || 'Monthly',
    address: emp.address || '',
    phone: emp.phone || '',
    email: emp.email || '',
    business_name: shop.shop_name || 'Chisanyama Connection',
    business_address: shop.address || '',
    business_phone: shop.phone || '',
    business_email: shop.email || '',
    reports_to: schedule.reports_to || '',
    start_date: emp.date_hired || today(),
    end_date: '',
    probation_period: schedule.probation_period || 'Three Months',
    shift_start: schedule.shift_start || '08:00',
    shift_end: schedule.shift_end || '17:00',
    working_days: schedule.working_days || ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
    break_minutes: schedule.break_minutes || 30,
    payment_method: schedule.payment_method || 'Bank Transfer',
    payment_date: schedule.payment_date || '25th of each month',
    clauses: Array.isArray(clauses) ? clauses : [],
    body_template: tpl?.body_template || CHISANYAMA_BODY,
    filled_body: fillContractTemplate(tpl?.body_template || CHISANYAMA_BODY, {
      employee_name: emp.full_name,
      employee_number: emp.employee_number || emp.employee_code,
      position: emp.position,
      department: emp.department,
      branch: emp.branch,
      id_number: emp.id_number,
      address: emp.address,
      phone: emp.phone,
      email: emp.email,
      basic_salary: emp.basic_salary,
      employment_type: emp.employment_type,
      business_name: shop.shop_name,
      business_address: shop.address,
      business_phone: shop.phone,
      business_email: shop.email,
      salary_type: emp.salary_type,
      start_date: emp.date_hired || today(),
      shift_start: schedule.shift_start,
      shift_end: schedule.shift_end,
      working_days: schedule.working_days,
      break_minutes: schedule.break_minutes,
      payment_method: schedule.payment_method,
      payment_date: schedule.payment_date,
      currency: shop.currency || 'R'
    }),
    probation_days: 90
  };
}

function getContractTemplates() {
  return getDb().prepare('SELECT * FROM employee_contract_templates ORDER BY is_default DESC, name').all();
}

function saveContractTemplate(data, actorId, actorName) {
  const db = getDb();
  const clauses = JSON.stringify(data.clauses || parseJson(data.clauses_json, []));
  const bodyTemplate = data.body_template || null;
  if (data.id) {
    db.prepare(`UPDATE employee_contract_templates SET name=?, position=?, clauses_json=?, body_template=?, is_default=? WHERE id=?`)
      .run(data.name, data.position || null, clauses, bodyTemplate, data.is_default ? 1 : 0, data.id);
    if (data.is_default) db.prepare('UPDATE employee_contract_templates SET is_default = 0 WHERE id != ?').run(data.id);
    audit(actorId, actorName, 'update_contract_template', 'contract_template', data.id, { name: data.name });
    return db.prepare('SELECT * FROM employee_contract_templates WHERE id = ?').get(data.id);
  }
  const r = db.prepare(`INSERT INTO employee_contract_templates (name, position, clauses_json, body_template, is_default) VALUES (?,?,?,?,?)`)
    .run(data.name, data.position || null, clauses, bodyTemplate, data.is_default ? 1 : 0);
  if (data.is_default) db.prepare('UPDATE employee_contract_templates SET is_default = 0 WHERE id != ?').run(r.lastInsertRowid);
  audit(actorId, actorName, 'create_contract_template', 'contract_template', r.lastInsertRowid, { name: data.name });
  return db.prepare('SELECT * FROM employee_contract_templates WHERE id = ?').get(r.lastInsertRowid);
}

function deleteContractTemplate(id, actorId, actorName) {
  getDb().prepare('DELETE FROM employee_contract_templates WHERE id = ?').run(id);
  audit(actorId, actorName, 'delete_contract_template', 'contract_template', id, null);
  return true;
}

function getContracts(filters = {}) {
  let sql = `SELECT c.*, e.full_name as employee_name, e.employee_code, e.position as emp_position, t.name as template_name
    FROM employee_contracts c JOIN employees e ON e.id = c.employee_id
    LEFT JOIN employee_contract_templates t ON t.id = c.template_id WHERE 1=1`;
  const params = [];
  if (filters.employee_id) { sql += ' AND c.employee_id = ?'; params.push(filters.employee_id); }
  if (filters.status) { sql += ' AND c.status = ?'; params.push(filters.status); }
  sql += ' ORDER BY c.created_at DESC';
  return getDb().prepare(sql).all(...params);
}

function getContract(id) {
  const c = getDb().prepare(`
    SELECT c.*, e.full_name as employee_name, e.employee_code, e.position as emp_position, t.name as template_name
    FROM employee_contracts c JOIN employees e ON e.id = c.employee_id
    LEFT JOIN employee_contract_templates t ON t.id = c.template_id WHERE c.id = ?`).get(id);
  if (!c) return null;
  c.contract_data = parseJson(c.contract_data_json, {});
  c.signatures = parseJson(c.signature_data_json, {});
  c.doc_paths = parseJson(c.doc_paths_json, []);
  return c;
}

function saveContract(data, actorId, actorName) {
  const db = getDb();
  let contractData = data.contract_data || parseJson(data.contract_data_json, populateContractFromEmployee(data.employee_id, data.template_id));
  const tpl = data.template_id ? db.prepare('SELECT body_template FROM employee_contract_templates WHERE id = ?').get(data.template_id) : null;
  const bodyTpl = tpl?.body_template || contractData.body_template || CHISANYAMA_BODY;
  contractData.filled_body = fillContractTemplate(bodyTpl, contractData);
  contractData.body_template = bodyTpl;
  const sigs = data.signatures || parseJson(data.signature_data_json, {});
  const payload = JSON.stringify(contractData);
  const sigPayload = JSON.stringify(sigs);
  const expiresAt = data.expires_at != null ? data.expires_at : (contractData.end_date || null);
  const resignOpens = data.resign_opens_at != null ? data.resign_opens_at : null;
  const resignCloses = data.resign_closes_at != null ? data.resign_closes_at : null;
  const docsJson = data.doc_paths_json != null
    ? (typeof data.doc_paths_json === 'string' ? data.doc_paths_json : JSON.stringify(data.doc_paths_json))
    : (data.doc_paths ? JSON.stringify(data.doc_paths) : null);
  const requireDocs = data.require_docs_on_resign === 0 || data.require_docs_on_resign === false ? 0 : 1;
  if (data.id) {
    try {
      db.prepare(`UPDATE employee_contracts SET employee_id=?, template_id=?, contract_data_json=?, status=?,
        employee_signed_at=?, manager_signed_at=?, admin_signed_at=?, witness_signed_at=?, signature_data_json=?, pdf_path=?,
        expires_at=COALESCE(?, expires_at), resign_opens_at=COALESCE(?, resign_opens_at), resign_closes_at=COALESCE(?, resign_closes_at),
        doc_paths_json=COALESCE(?, doc_paths_json), require_docs_on_resign=?, renewed_from_id=COALESCE(?, renewed_from_id)
        WHERE id=?`).run(
        data.employee_id, data.template_id || null, payload, data.status || 'draft',
        data.employee_signed_at || null, data.manager_signed_at || null, data.admin_signed_at || null,
        data.witness_signed_at || null, sigPayload, data.pdf_path || null,
        expiresAt, resignOpens, resignCloses, docsJson, requireDocs, data.renewed_from_id || null, data.id
      );
    } catch (_) {
      db.prepare(`UPDATE employee_contracts SET employee_id=?, template_id=?, contract_data_json=?, status=?,
        employee_signed_at=?, manager_signed_at=?, admin_signed_at=?, witness_signed_at=?, signature_data_json=?, pdf_path=?
        WHERE id=?`).run(
        data.employee_id, data.template_id || null, payload, data.status || 'draft',
        data.employee_signed_at || null, data.manager_signed_at || null, data.admin_signed_at || null,
        data.witness_signed_at || null, sigPayload, data.pdf_path || null, data.id
      );
    }
    audit(actorId, actorName, 'update_contract', 'employee_contract', data.id, { status: data.status });
    return getContract(data.id);
  }
  let r;
  try {
    r = db.prepare(`INSERT INTO employee_contracts (employee_id, template_id, contract_data_json, status, signature_data_json, created_by, expires_at, resign_opens_at, resign_closes_at, doc_paths_json, require_docs_on_resign, renewed_from_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      data.employee_id, data.template_id || null, payload, data.status || 'draft', sigPayload, actorId,
      expiresAt, resignOpens, resignCloses, docsJson, requireDocs, data.renewed_from_id || null
    );
  } catch (_) {
    r = db.prepare(`INSERT INTO employee_contracts (employee_id, template_id, contract_data_json, status, signature_data_json, created_by)
      VALUES (?,?,?,?,?,?)`).run(data.employee_id, data.template_id || null, payload, data.status || 'draft', sigPayload, actorId);
  }
  audit(actorId, actorName, 'create_contract', 'employee_contract', r.lastInsertRowid, { employee_id: data.employee_id });
  return getContract(r.lastInsertRowid);
}

function ensureContractExpiry() {
  const db = getDb();
  try {
    const due = db.prepare(`
      SELECT id, employee_id FROM employee_contracts
      WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at != ''
        AND datetime(expires_at) <= datetime('now')
    `).all();
    for (const row of due) {
      db.prepare(`UPDATE employee_contracts SET status='expired' WHERE id=?`).run(row.id);
      try {
        const emp = db.prepare('SELECT full_name FROM employees WHERE id=?').get(row.employee_id);
        addNotification('contract_expired', 'Employment contract expired',
          `${emp?.full_name || 'Employee'} contract #${row.id} expired — open re-sign window in Contracts.`);
      } catch (_) { /* ignore */ }
    }
    return due.length;
  } catch (_) {
    return 0;
  }
}

/** Admin opens a re-sign window: clear employee signature, set opens/closes datetime, pending_signatures */
function openContractResign(contractId, resignOpensAt, resignClosesAt, actorId, actorName) {
  const c = getContract(contractId);
  if (!c) throw new Error('Contract not found');
  if (!['expired', 'active', 'terminated', 'pending_signatures'].includes(c.status)) {
    throw new Error('Only active/expired contracts can be opened for re-sign');
  }
  if (!resignOpensAt) throw new Error('Set the date/time when the employee may re-sign');
  const sigs = { ...(c.signatures || {}) };
  delete sigs.employee;
  const patch = {
    id: contractId,
    employee_id: c.employee_id,
    template_id: c.template_id,
    contract_data: c.contract_data,
    signatures: sigs,
    status: 'pending_signatures',
    employee_signed_at: null,
    manager_signed_at: c.manager_signed_at,
    admin_signed_at: c.admin_signed_at,
    witness_signed_at: c.witness_signed_at,
    expires_at: c.expires_at,
    resign_opens_at: resignOpensAt,
    resign_closes_at: resignClosesAt || null,
    doc_paths: [],
    require_docs_on_resign: 1
  };
  const saved = saveContract(patch, actorId, actorName);
  audit(actorId, actorName, 'open_contract_resign', 'employee_contract', contractId, {
    resign_opens_at: resignOpensAt, resign_closes_at: resignClosesAt
  });
  try {
    addNotification('contract_resign', 'Contract re-sign required',
      `${c.employee_name} must re-sign their employment contract from ${resignOpensAt}`);
  } catch (_) { /* ignore */ }
  return saved;
}

function attachContractResignDoc(contractId, filePath, fileName, employeeId) {
  const c = getContract(contractId);
  if (!c) throw new Error('Contract not found');
  if (Number(c.employee_id) !== Number(employeeId)) throw new Error('Not your contract');
  if (c.status !== 'pending_signatures') throw new Error('Contract is not open for re-sign');
  const docs = Array.isArray(c.doc_paths) ? [...c.doc_paths] : [];
  docs.push({ path: filePath, name: fileName || path.basename(filePath), uploaded_at: new Date().toISOString() });
  try {
    getDb().prepare(`UPDATE employee_contracts SET doc_paths_json=? WHERE id=?`).run(JSON.stringify(docs), contractId);
  } catch (_) {
    throw new Error('Could not save document — update the app / migrate database');
  }
  try {
    require('./staff').saveDocument({
      employee_id: employeeId,
      doc_type: 'contract_resign',
      file_path: filePath,
      file_name: fileName || path.basename(filePath),
      notes: `Re-sign contract #${contractId}`
    });
  } catch (_) { /* ignore */ }
  return getContract(contractId);
}

function employeeCanResignContract(c) {
  if (!c || c.status !== 'pending_signatures') return { ok: false, reason: 'Not open for signing' };
  const now = new Date();
  if (c.resign_opens_at && now < new Date(c.resign_opens_at)) {
    return { ok: false, reason: `Re-sign opens at ${c.resign_opens_at}` };
  }
  if (c.resign_closes_at && now > new Date(c.resign_closes_at)) {
    return { ok: false, reason: `Re-sign window closed at ${c.resign_closes_at}` };
  }
  const requireDocs = c.require_docs_on_resign !== 0;
  const docs = Array.isArray(c.doc_paths) ? c.doc_paths : [];
  if (requireDocs && c.resign_opens_at && docs.length < 1) {
    return { ok: false, reason: 'Upload your documents before signing' };
  }
  return { ok: true };
}

function signContract(contractId, role, signatureBase64, actorId, actorName) {
  const c = getContract(contractId);
  if (!c) throw new Error('Contract not found');
  const { assertUserActor, getEmployeeSession } = require('./authz');
  let slot = role;
  const empSess = getEmployeeSession();
  if (empSess?.employee_id != null && Number(empSess.employee_id) === Number(c.employee_id)) {
    slot = 'employee';
    const gate = employeeCanResignContract(c);
    // Allow first-time sign when no resign window set (classic flow)
    if (c.resign_opens_at || c.status === 'pending_signatures') {
      if (c.resign_opens_at) {
        const now = new Date();
        if (now < new Date(c.resign_opens_at)) throw new Error(gate.reason || 'Re-sign not open yet');
        if (c.resign_closes_at && now > new Date(c.resign_closes_at)) throw new Error(gate.reason || 'Re-sign window closed');
      }
      if (c.require_docs_on_resign !== 0 && c.resign_opens_at) {
        const docs = Array.isArray(c.doc_paths) ? c.doc_paths : [];
        if (docs.length < 1) throw new Error('Upload your documents before signing the contract');
      }
    }
  } else if (actorId) {
    const user = assertUserActor({ id: actorId }, ['owner', 'manager', 'supervisor', 'assistant_manager']);
    if (user.role === 'owner') slot = role === 'witness' ? 'witness' : 'admin';
    else if (user.role === 'manager' || user.role === 'assistant_manager') slot = role === 'witness' ? 'witness' : 'manager';
    else slot = role === 'witness' ? 'witness' : 'manager';
  } else {
    throw new Error('Authentication required to sign contract');
  }
  if (!['employee', 'manager', 'admin', 'witness'].includes(slot)) {
    throw new Error('Invalid signature role');
  }
  const sigs = c.signatures || {};
  sigs[slot] = signatureBase64;
  const now = new Date().toISOString();
  const patch = {
    id: contractId, employee_id: c.employee_id, template_id: c.template_id, contract_data: c.contract_data,
    signatures: sigs, status: c.status,
    expires_at: c.expires_at, resign_opens_at: c.resign_opens_at, resign_closes_at: c.resign_closes_at,
    doc_paths: c.doc_paths, require_docs_on_resign: c.require_docs_on_resign
  };
  if (slot === 'employee') patch.employee_signed_at = now;
  if (slot === 'manager') patch.manager_signed_at = now;
  if (slot === 'admin') patch.admin_signed_at = now;
  if (slot === 'witness') patch.witness_signed_at = now;
  const allSigned = sigs.employee && sigs.manager && sigs.admin;
  if (allSigned) patch.status = 'active';
  else patch.status = 'pending_signatures';
  audit(actorId, actorName, 'sign_contract', 'employee_contract', contractId, { role: slot });
  return saveContract(patch, actorId, actorName);
}

function buildContractPdf(contractId, shopSettings) {
  const c = getContract(contractId);
  if (!c) throw new Error('Contract not found');
  const s = shopSettings || getShopSettings();
  const d = c.contract_data || {};
  const doc = new jsPDF();
  const bodyTpl = d.body_template || CHISANYAMA_BODY;
  const filled = d.filled_body || fillContractTemplate(bodyTpl, { ...d, currency: s.currency || 'R', business_name: d.business_name || s.shop_name });
  doc.setFontSize(11);
  const lines = filled.split('\n');
  let y = 16;
  lines.forEach(line => {
    const trimmed = line.trim();
    if (trimmed.startsWith('# ')) {
      doc.setFontSize(14);
      doc.text(trimmed.replace(/^#\s*/, ''), 105, y, { align: 'center' });
      y += 10;
      doc.setFontSize(11);
      return;
    }
    if (trimmed.startsWith('## ')) {
      doc.setFontSize(12);
      doc.text(trimmed.replace(/^##\s*/, ''), 14, y);
      y += 8;
      doc.setFontSize(11);
      return;
    }
    if (trimmed.startsWith('### ')) {
      doc.setFont(undefined, 'bold');
      doc.text(trimmed.replace(/^###\s*/, ''), 14, y);
      doc.setFont(undefined, 'normal');
      y += 7;
      return;
    }
    if (trimmed === '---') { y += 4; return; }
    if (!trimmed) { y += 4; return; }
    const wrapped = doc.splitTextToSize(trimmed.replace(/^\*\s*/, '• '), 180);
    doc.text(wrapped, 14, y);
    y += wrapped.length * 5 + 2;
    if (y > 280) { doc.addPage(); y = 16; }
  });
  return doc.output('arraybuffer');
}

function getProbations(filters = {}) {
  let sql = `SELECT p.*, e.full_name as employee_name, e.employee_code, e.branch, m.full_name as manager_name
    FROM employee_probation p JOIN employees e ON e.id = p.employee_id
    LEFT JOIN employees m ON m.id = p.manager_id WHERE 1=1`;
  const params = [];
  if (filters.employee_id) { sql += ' AND p.employee_id = ?'; params.push(filters.employee_id); }
  if (filters.status) { sql += ' AND p.status = ?'; params.push(filters.status); }
  if (filters.manager_id) { sql += ' AND p.manager_id = ?'; params.push(filters.manager_id); }
  sql += ' ORDER BY p.end_date ASC';
  return getDb().prepare(sql).all(...params);
}

function getProbation(id) {
  const p = getDb().prepare(`
    SELECT p.*, e.full_name as employee_name, e.employee_code, e.branch, m.full_name as manager_name
    FROM employee_probation p JOIN employees e ON e.id = p.employee_id
    LEFT JOIN employees m ON m.id = p.manager_id WHERE p.id = ?`).get(id);
  if (!p) return null;
  p.rules = parseJson(p.rules_json, {});
  return p;
}

function saveProbation(data, actorId, actorName) {
  const db = getDb();
  const duration = Number(data.duration_days) || 90;
  const start = data.start_date || today();
  const end = data.end_date || addDays(start, duration);
  const rules = JSON.stringify(data.rules || parseJson(data.rules_json, {}));
  if (data.id) {
    db.prepare(`UPDATE employee_probation SET employee_id=?, start_date=?, end_date=?, duration_days=?, manager_id=?, status=?, rules_json=? WHERE id=?`)
      .run(data.employee_id, start, end, duration, data.manager_id || null, data.status || 'active', rules, data.id);
    audit(actorId, actorName, 'update_probation', 'employee_probation', data.id, null);
    return getProbation(data.id);
  }
  const r = db.prepare(`INSERT INTO employee_probation (employee_id, start_date, end_date, duration_days, manager_id, status, rules_json)
    VALUES (?,?,?,?,?,?,?)`).run(data.employee_id, start, end, duration, data.manager_id || null, data.status || 'active', rules);
  audit(actorId, actorName, 'create_probation', 'employee_probation', r.lastInsertRowid, { employee_id: data.employee_id });
  return getProbation(r.lastInsertRowid);
}

function deleteProbation(id, actorId, actorName) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM employee_probation WHERE id = ?').get(id);
  if (!row) throw new Error('Probation not found');
  db.prepare('DELETE FROM probation_daily_evaluations WHERE probation_id = ?').run(id);
  db.prepare('DELETE FROM employee_probation WHERE id = ?').run(id);
  audit(actorId, actorName, 'delete_probation', 'employee_probation', id, { employee_id: row.employee_id });
  return { deleted: true, id };
}

function getDecisionRules() {
  return getDb().prepare('SELECT * FROM probation_decision_rules ORDER BY is_active DESC, name').all();
}

function saveDecisionRule(data, actorId, actorName) {
  const db = getDb();
  if (data.id) {
    db.prepare(`UPDATE probation_decision_rules SET name=?, min_overall_score=?, min_attendance_pct=?, max_late=?, max_absences=?, min_work_quality=?, is_active=? WHERE id=?`)
      .run(data.name, data.min_overall_score, data.min_attendance_pct, data.max_late, data.max_absences, data.min_work_quality, data.is_active ? 1 : 0, data.id);
    return db.prepare('SELECT * FROM probation_decision_rules WHERE id = ?').get(data.id);
  }
  const r = db.prepare(`INSERT INTO probation_decision_rules (name, min_overall_score, min_attendance_pct, max_late, max_absences, min_work_quality, is_active)
    VALUES (?,?,?,?,?,?,?)`).run(data.name, data.min_overall_score, data.min_attendance_pct, data.max_late, data.max_absences, data.min_work_quality, data.is_active !== false ? 1 : 0);
  audit(actorId, actorName, 'create_probation_rule', 'probation_decision_rules', r.lastInsertRowid, null);
  return db.prepare('SELECT * FROM probation_decision_rules WHERE id = ?').get(r.lastInsertRowid);
}

function saveDailyEvaluation(data, actorId, actorName) {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM probation_daily_evaluations WHERE probation_id = ? AND eval_date = ?')
    .get(data.probation_id, data.eval_date);
  if (existing) throw new Error(`Evaluation for ${data.eval_date} already exists — cannot overwrite`);
  const scores = data.scores || parseJson(data.scores_json, {});
  const vals = Object.values(scores).map(Number).filter(n => !Number.isNaN(n));
  const overall = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : Number(data.overall_score) || 0;
  const r = db.prepare(`INSERT INTO probation_daily_evaluations (probation_id, employee_id, eval_date, manager_id, scores_json, comments, overall_score)
    VALUES (?,?,?,?,?,?,?)`).run(
    data.probation_id, data.employee_id, data.eval_date, data.manager_id || actorId || null,
    JSON.stringify(scores), data.comments || null, overall
  );
  audit(actorId, actorName, 'probation_daily_eval', 'probation_evaluation', r.lastInsertRowid, { eval_date: data.eval_date });
  return db.prepare('SELECT * FROM probation_daily_evaluations WHERE id = ?').get(r.lastInsertRowid);
}

function getEvaluationHistory(filters = {}) {
  let sql = `SELECT ev.*, e.full_name as employee_name, e.employee_code, e.branch, p.start_date, p.end_date, m.full_name as manager_name
    FROM probation_daily_evaluations ev
    JOIN employees e ON e.id = ev.employee_id
    JOIN employee_probation p ON p.id = ev.probation_id
    LEFT JOIN employees m ON m.id = ev.manager_id WHERE 1=1`;
  const params = [];
  if (filters.probation_id) { sql += ' AND ev.probation_id = ?'; params.push(filters.probation_id); }
  if (filters.employee_id) { sql += ' AND ev.employee_id = ?'; params.push(filters.employee_id); }
  if (filters.from) { sql += ' AND date(ev.eval_date) >= date(?)'; params.push(filters.from); }
  if (filters.to) { sql += ' AND date(ev.eval_date) <= date(?)'; params.push(filters.to); }
  if (filters.branch) { sql += ' AND e.branch = ?'; params.push(filters.branch); }
  if (filters.manager_id) { sql += ' AND ev.manager_id = ?'; params.push(filters.manager_id); }
  sql += ' ORDER BY ev.eval_date DESC, ev.created_at DESC';
  return getDb().prepare(sql).all(...params).map(row => ({ ...row, scores: parseJson(row.scores_json, {}) }));
}

function calcProbationAttendance(employeeId, from, to) {
  const db = getDb();
  const dates = [];
  const d = new Date(from + 'T12:00:00');
  const end = new Date(to + 'T12:00:00');
  while (d <= end) { dates.push(d.toLocaleDateString('en-CA')); d.setDate(d.getDate() + 1); }
  if (!dates.length) return { scheduled: 0, present: 0, late: 0, absences: 0, pct: 100 };
  const rows = db.prepare(`SELECT * FROM employee_attendance WHERE employee_id = ? AND work_date BETWEEN ? AND ?`).all(employeeId, from, to);
  const byDate = Object.fromEntries(rows.map(r => [r.work_date, r]));
  let present = 0; let late = 0; let absences = 0;
  for (const dt of dates) {
    const att = byDate[dt];
    if (!att || att.status === 'absent') absences++;
    else {
      present++;
      if ((att.late_minutes || 0) > 0) late++;
    }
  }
  const scheduled = dates.length;
  const pct = scheduled ? Math.round((present / scheduled) * 1000) / 10 : 100;
  return { scheduled, present, late, absences, pct };
}

function getRecommendation(probationId) {
  const p = getProbation(probationId);
  if (!p) throw new Error('Probation not found');
  const evals = getDb().prepare('SELECT * FROM probation_daily_evaluations WHERE probation_id = ? ORDER BY eval_date').all(probationId);
  const avgScore = evals.length
    ? evals.reduce((s, e) => s + (Number(e.overall_score) || 0), 0) / evals.length
    : 0;
  const workQualityScores = evals.map(e => parseJson(e.scores_json, {})['Work Quality']).filter(v => v != null);
  const avgWorkQuality = workQualityScores.length
    ? workQualityScores.reduce((a, b) => a + Number(b), 0) / workQualityScores.length
    : avgScore;
  const att = calcProbationAttendance(p.employee_id, p.start_date, p.end_date);
  const rule = getDb().prepare('SELECT * FROM probation_decision_rules WHERE is_active = 1 ORDER BY id LIMIT 1').get()
    || { min_overall_score: 3.5, min_attendance_pct: 90, max_late: 5, max_absences: 2, min_work_quality: 3 };
  const checks = {
    overall_score: avgScore >= Number(rule.min_overall_score),
    attendance: att.pct >= Number(rule.min_attendance_pct),
    late: att.late <= Number(rule.max_late),
    absences: att.absences <= Number(rule.max_absences),
    work_quality: avgWorkQuality >= Number(rule.min_work_quality)
  };
  const pass = Object.values(checks).every(Boolean);
  const missedEvals = [];
  const d = new Date(p.start_date + 'T12:00:00');
  const end = new Date(Math.min(Date.now(), new Date(p.end_date + 'T12:00:00').getTime()));
  const evalDates = new Set(evals.map(e => e.eval_date));
  while (d <= end) {
    const ds = d.toLocaleDateString('en-CA');
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6 && !evalDates.has(ds)) missedEvals.push(ds);
    d.setDate(d.getDate() + 1);
  }
  return {
    probation_id: probationId,
    recommendation: pass ? 'confirm' : (avgScore >= Number(rule.min_overall_score) * 0.85 ? 'extend' : 'terminate'),
    pass,
    checks,
    rule,
    avg_overall_score: Math.round(avgScore * 100) / 100,
    avg_work_quality: Math.round(avgWorkQuality * 100) / 100,
    attendance: att,
    evaluation_count: evals.length,
    missed_evaluations: missedEvals.slice(-14)
  };
}

function finalProbationDecision(probationId, decision, reason, actorId, actorName, extendDays) {
  const p = getProbation(probationId);
  if (!p) throw new Error('Probation not found');
  const db = getDb();
  const now = today();
  let status = p.status;
  if (decision === 'confirm' || decision === 'passed') status = 'passed';
  else if (decision === 'extend') status = 'extended';
  else if (decision === 'terminate' || decision === 'failed') status = decision === 'terminate' ? 'terminated' : 'failed';
  let endDate = p.end_date;
  if (decision === 'extend') {
    endDate = addDays(p.end_date, Number(extendDays) || 30);
    db.prepare('UPDATE employee_probation SET end_date = ?, duration_days = duration_days + ? WHERE id = ?')
      .run(endDate, Number(extendDays) || 30, probationId);
  }
  db.prepare(`UPDATE employee_probation SET status=?, final_decision=?, decision_date=?, decision_by=?, decision_reason=? WHERE id=?`)
    .run(status, decision, now, actorId, reason || null, probationId);
  audit(actorId, actorName, 'probation_decision', 'employee_probation', probationId, { decision, reason });
  if (decision === 'confirm' || decision === 'passed') {
    autoGenerateContractOnProbationPass(p.employee_id, actorId, actorName);
  }
  return getProbation(probationId);
}

function autoGenerateContractOnProbationPass(employeeId, actorId, actorName) {
  const existing = getDb().prepare(`SELECT id FROM employee_contracts WHERE employee_id = ? AND status IN ('active','pending_signatures') LIMIT 1`).get(employeeId);
  if (existing) return getContract(existing.id);
  const data = populateContractFromEmployee(employeeId, null);
  return saveContract({ employee_id: employeeId, contract_data: data, status: 'draft' }, actorId, actorName);
}

function getProbationDashboard(filters = {}) {
  const active = getProbations({ status: 'active', ...filters });
  const endingSoon = active.filter(p => {
    const daysLeft = Math.ceil((new Date(p.end_date + 'T12:00:00') - Date.now()) / 86400000);
    return daysLeft >= 0 && daysLeft <= 7;
  });
  const evalsToday = getDb().prepare(`
    SELECT p.id, p.employee_id, e.full_name, p.end_date FROM employee_probation p
    JOIN employees e ON e.id = p.employee_id
    WHERE p.status = 'active' AND date(?) BETWEEN date(p.start_date) AND date(p.end_date)
    AND NOT EXISTS (SELECT 1 FROM probation_daily_evaluations ev WHERE ev.probation_id = p.id AND ev.eval_date = date(?))
  `).all(today(), today());
  const trends = getDb().prepare(`
    SELECT date(eval_date) as d, AVG(overall_score) as avg_score, COUNT(*) as cnt
    FROM probation_daily_evaluations WHERE eval_date >= date('now', '-30 days')
    GROUP BY date(eval_date) ORDER BY d`).all();
  return { active_count: active.length, ending_soon: endingSoon, pending_evals_today: evalsToday, trends, active };
}

function buildProbationPdf(probationId, shopSettings) {
  const p = getProbation(probationId);
  if (!p) throw new Error('Probation not found');
  const s = shopSettings || getShopSettings();
  const doc = new jsPDF();
  doc.setFontSize(14);
  doc.text(s.shop_name || 'Company', 105, 16, { align: 'center' });
  doc.text('PROBATION PERIOD RECORD', 105, 24, { align: 'center' });
  doc.setFontSize(11);
  let y = 36;
  [`Employee: ${p.employee_name}`, `Period: ${p.start_date} to ${p.end_date}`, `Duration: ${p.duration_days} days`, `Manager: ${p.manager_name || '—'}`, `Status: ${p.status}`]
    .forEach(l => { doc.text(l, 14, y); y += 7; });
  const rec = getRecommendation(probationId);
  y += 4;
  doc.text(`Evaluations: ${rec.evaluation_count} · Avg score: ${rec.avg_overall_score}`, 14, y); y += 7;
  doc.text(`Attendance: ${rec.attendance.pct}% · Recommendation: ${rec.recommendation.toUpperCase()}`, 14, y);
  return doc.output('arraybuffer');
}

function buildEvaluationReportPdf(probationId, shopSettings) {
  const evals = getEvaluationHistory({ probation_id: probationId });
  const p = getProbation(probationId);
  const s = shopSettings || getShopSettings();
  const doc = new jsPDF();
  doc.text(s.shop_name || 'Company', 105, 14, { align: 'center' });
  doc.text(`Daily Evaluations — ${p?.employee_name || ''}`, 105, 22, { align: 'center' });
  doc.autoTable({
    startY: 30,
    head: [['Date', 'Overall', 'Comments']],
    body: evals.map(e => [e.eval_date, Number(e.overall_score).toFixed(2), (e.comments || '').slice(0, 60)])
  });
  return doc.output('arraybuffer');
}

function buildProbationLetterPdf(probationId, decision, shopSettings) {
  const p = getProbation(probationId);
  if (!p) throw new Error('Probation not found');
  const s = shopSettings || getShopSettings();
  const doc = new jsPDF();
  doc.setFontSize(14);
  doc.text(s.shop_name || 'Company', 105, 18, { align: 'center' });
  const title = decision === 'confirm' || decision === 'passed' ? 'PROBATION CONFIRMATION'
    : decision === 'extend' ? 'PROBATION EXTENSION' : 'PROBATION TERMINATION NOTICE';
  doc.text(title, 105, 28, { align: 'center' });
  doc.setFontSize(11);
  const body = decision === 'confirm' || decision === 'passed'
    ? `We are pleased to confirm that ${p.employee_name} has successfully completed the probation period (${p.start_date} to ${p.end_date}). Employment continues on a permanent basis.`
    : decision === 'extend'
      ? `${p.employee_name}'s probation period is extended to ${p.end_date}. Continued performance will be reviewed.`
      : `This letter serves as notice regarding the probation outcome for ${p.employee_name}. Reason: ${p.decision_reason || 'Performance standards not met'}.`;
  doc.text(doc.splitTextToSize(body, 180), 14, 44);
  doc.text(`Date: ${today()}`, 14, 100);
  doc.text('Authorised Signature: _________________________', 14, 120);
  return doc.output('arraybuffer');
}

function getEmployeePersonnelFile(employeeId) {
  const db = getDb();
  const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(employeeId);
  if (!emp) throw new Error('Employee not found');
  return {
    employee: emp,
    contracts: getContracts({ employee_id: employeeId }),
    probations: getProbations({ employee_id: employeeId }),
    evaluations: getEvaluationHistory({ employee_id: employeeId }),
    hr_documents: attendancePayroll.getHrDocuments(employeeId),
    documents: db.prepare('SELECT * FROM employee_documents WHERE employee_id = ? ORDER BY created_at DESC').all(employeeId),
    disciplinary: db.prepare('SELECT * FROM employee_disciplinary WHERE employee_id = ? ORDER BY created_at DESC').all(employeeId)
  };
}

function ensureProbationNotifications() {
  const db = getDb();
  const todayStr = today();
  const pending = db.prepare(`
    SELECT p.id, e.full_name, m.full_name as manager_name, p.manager_id
    FROM employee_probation p JOIN employees e ON e.id = p.employee_id
    LEFT JOIN employees m ON m.id = p.manager_id
    WHERE p.status = 'active' AND date(?) BETWEEN date(p.start_date) AND date(p.end_date)
    AND NOT EXISTS (SELECT 1 FROM probation_daily_evaluations ev WHERE ev.probation_id = p.id AND ev.eval_date = date(?))
  `).all(todayStr, todayStr);
  for (const row of pending) {
    addNotification('probation_eval_due', 'Probation Evaluation Due',
      `Daily evaluation pending for ${row.full_name}${row.manager_name ? ` (Manager: ${row.manager_name})` : ''}`);
  }
  const ending = db.prepare(`
    SELECT p.id, e.full_name, p.end_date FROM employee_probation p
    JOIN employees e ON e.id = p.employee_id
    WHERE p.status = 'active' AND date(p.end_date) BETWEEN date(?) AND date(?, '+7 days')
  `).all(todayStr, todayStr);
  for (const row of ending) {
    addNotification('probation_ending', 'Probation Ending Soon',
      `${row.full_name}'s probation ends on ${row.end_date}. Review recommendation and make final decision.`);
  }
}

module.exports = {
  EVAL_CATEGORIES,
  CHISANYAMA_BODY,
  fillContractTemplate,
  ensureDefaultTemplates,
  populateContractFromEmployee,
  getContractTemplates, saveContractTemplate, deleteContractTemplate,
  getContracts, getContract, saveContract, signContract, buildContractPdf,
  ensureContractExpiry, openContractResign, attachContractResignDoc, employeeCanResignContract,
  getProbations, getProbation, saveProbation, deleteProbation,
  getDecisionRules, saveDecisionRule,
  saveDailyEvaluation, getEvaluationHistory, getRecommendation, finalProbationDecision,
  getProbationDashboard, buildProbationPdf, buildEvaluationReportPdf, buildProbationLetterPdf,
  getEmployeePersonnelFile, ensureProbationNotifications, ensureEmployeeNumber
};

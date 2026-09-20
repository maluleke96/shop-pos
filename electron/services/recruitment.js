const fs = require('fs');
const path = require('path');
const { jsPDF } = require('jspdf');
const { getDb } = require('../database/db');
const { assertUserActor } = require('./authz');
const { assetsDir, fileDataUrl } = require('./local-assets');

function audit(actorId, actorName, action, entityType, entityId, details) {
  getDb().prepare(`INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, details) VALUES (?,?,?,?,?,?)`)
    .run(actorId || null, actorName || 'system', action, entityType, entityId || null, details ? JSON.stringify(details) : null);
}

function requireRecruitmentRole(actor) {
  assertUserActor(actor, ['owner', 'manager', 'supervisor', 'assistant_manager']);
}

function requireAdminRole(actor) {
  assertUserActor(actor, ['owner', 'manager']);
}

function today() {
  return new Date().toLocaleDateString('en-CA');
}

function parseJson(v, fb) {
  if (!v) return fb;
  try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return fb; }
}

const DEFAULT_HIRE_MSG = `Dear {{CandidateName}},

Congratulations. We are pleased to offer you the position of {{JobTitle}} at {{Branch}}.

Please reply to this message to confirm your acceptance, or contact us on {{Phone}} if you have any questions about your start date, hours, or documents.

Kind regards,
{{Branch}} Management`;

const DEFAULT_REJECT_MSG = `Dear {{CandidateName}},

Thank you for your interest in the {{JobTitle}} position at {{Branch}}, and for the time you invested in the application process.

After careful consideration we will not be proceeding with your application on this occasion. This decision is not a reflection of your potential, and we wish you every success in your career.

Kind regards,
{{Branch}} Management`;

const DEFAULT_INTERVIEW_MSG = `Dear {{CandidateName}},

Thank you for applying for {{JobTitle}} at {{Branch}}. We would like to invite you to an interview.

Date / time: {{InterviewAt}}
Venue: {{InterviewLocation}}

Please reply to confirm whether you can attend, or contact us on {{Phone}} to reschedule.

Kind regards,
{{Branch}} Management`;

const DEFAULT_WAITLIST_MSG = `Dear {{CandidateName}},

Thank you for applying for {{JobTitle}} at {{Branch}}.

Your application has been placed on our waitlist. We will contact you if a suitable vacancy becomes available.

Kind regards,
{{Branch}} Management`;

function getRecruitmentSettings() {
  const row = getDb().prepare('SELECT recruitment_settings FROM shop_settings WHERE id = 1').get() || {};
  const parsed = parseJson(row.recruitment_settings, {});
  return {
    max_pictures: Math.max(1, Math.min(20, Number(parsed.max_pictures) || 5)),
    hire_message: parsed.hire_message || DEFAULT_HIRE_MSG,
    reject_message: parsed.reject_message || DEFAULT_REJECT_MSG,
    interview_message: parsed.interview_message || DEFAULT_INTERVIEW_MSG,
    waitlist_message: parsed.waitlist_message || DEFAULT_WAITLIST_MSG
  };
}

function saveRecruitmentSettings(data, actor) {
  requireAdminRole(actor);
  const current = getRecruitmentSettings();
  const merged = {
    max_pictures: data.max_pictures != null ? Math.max(1, Math.min(20, Number(data.max_pictures) || 5)) : current.max_pictures,
    hire_message: data.hire_message != null ? String(data.hire_message) : current.hire_message,
    reject_message: data.reject_message != null ? String(data.reject_message) : current.reject_message,
    interview_message: data.interview_message != null ? String(data.interview_message) : current.interview_message,
    waitlist_message: data.waitlist_message != null ? String(data.waitlist_message) : current.waitlist_message
  };
  getDb().prepare(`UPDATE shop_settings SET recruitment_settings = ?, updated_at = datetime('now') WHERE id = 1`)
    .run(JSON.stringify(merged));
  audit(actor?.id, actor?.username, 'save_recruitment_settings', 'shop_settings', 1, { max_pictures: merged.max_pictures });
  return merged;
}

function getCvAssetsDir() {
  return assetsDir('recruitment', 'cv');
}

function getPicAssetsDir() {
  return assetsDir('recruitment', 'pics');
}

function getDocAssetsDir() {
  return assetsDir('recruitment', 'docs');
}

function copyCvToAssets(srcPath, candidateId) {
  if (!srcPath || !fs.existsSync(srcPath)) throw new Error('CV file not found');
  const ext = path.extname(srcPath) || '.pdf';
  const dest = path.join(getCvAssetsDir(), `cv-${candidateId}-${Date.now()}${ext}`);
  fs.copyFileSync(srcPath, dest);
  return dest;
}

function copyPicToAssets(srcPath, candidateId) {
  if (!srcPath || !fs.existsSync(srcPath)) throw new Error('Picture not found');
  const ext = path.extname(srcPath) || '.jpg';
  const dest = path.join(getPicAssetsDir(), `pic-${candidateId}-${Date.now()}${ext}`);
  fs.copyFileSync(srcPath, dest);
  return dest;
}

function notifyRecruitment(type, title, message, entityId) {
  try {
    require('./store').addNotification(type, title, message, {
      entity_type: 'job_candidate',
      entity_id: entityId || null,
      action_page: 'staffhr:recruitment',
      audience_roles: ['owner', 'manager', 'supervisor', 'assistant_manager']
    });
  } catch (_) { /* ignore */ }
}

function ensurePostingSchema() {
  const db = getDb();
  const cols = [
    ['extra_json', 'TEXT'],
    ['apply_token', 'TEXT'],
    ['closes_at', 'TEXT'],
    ['salary_text', 'TEXT'],
    ['position_title', 'TEXT'],
    ['rejection_notes', 'TEXT']
  ];
  for (const [name, typ] of cols) {
    try { db.exec(`ALTER TABLE job_postings ADD COLUMN IF NOT EXISTS ${name} ${typ}`); } catch (_) {
      try { db.exec(`ALTER TABLE job_postings ADD COLUMN ${name} ${typ}`); } catch (__) { /* exists */ }
    }
  }
  try { db.exec(`ALTER TABLE job_candidates ADD COLUMN notes TEXT`); } catch (_) { /* exists */ }
  try { db.exec(`ALTER TABLE job_candidates ADD COLUMN email TEXT`); } catch (_) { /* exists */ }
  try { db.exec(`ALTER TABLE job_candidates ADD COLUMN cv_data TEXT`); } catch (_) { /* exists */ }
  try { db.exec(`ALTER TABLE job_candidates ADD COLUMN edit_token TEXT`); } catch (_) { /* exists */ }
  const missing = db.prepare(`SELECT id FROM job_candidates WHERE edit_token IS NULL OR edit_token = ''`).all();
  for (const row of missing) {
    db.prepare(`UPDATE job_candidates SET edit_token = ? WHERE id = ?`).run(makeEditToken(), row.id);
  }
}

function makeApplyToken() {
  return `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function makeEditToken() {
  return `ed-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function postingExtra(row) {
  return { ...parseJson(row?.extra_json, {}), closes_at: row?.closes_at || parseJson(row?.extra_json, {}).closes_at || null };
}

function enrichPosting(row) {
  if (!row) return null;
  const extra = postingExtra(row);
  return {
    ...row,
    extra,
    salary_text: row.salary_text || extra.salary_text || extra.salary || null,
    position_title: row.position_title || extra.position || extra.position_title || row.title,
    closes_at: row.closes_at || extra.closes_at || extra.closing_date || null,
    apply_token: row.apply_token || null
  };
}

function getJobPostings(filters = {}, actor) {
  requireRecruitmentRole(actor);
  ensurePostingSchema();
  let sql = `SELECT jp.*, u.full_name AS created_by_name, a.full_name AS approved_by_name
    FROM job_postings jp
    LEFT JOIN users u ON u.id = jp.created_by
    LEFT JOIN users a ON a.id = jp.approved_by WHERE 1=1`;
  const params = [];
  if (filters.status) { sql += ' AND jp.status = ?'; params.push(filters.status); }
  if (filters.active_only) { sql += ` AND jp.status = 'active'`; }
  sql += ' ORDER BY jp.created_at DESC';
  return getDb().prepare(sql).all(...params).map(enrichPosting);
}

function getJobPosting(id, actor) {
  if (actor) {
    const rows = getJobPostings({}, actor);
    const found = rows.find(p => p.id === id);
    if (found) return found;
  }
  ensurePostingSchema();
  return enrichPosting(getDb().prepare('SELECT * FROM job_postings WHERE id = ?').get(id));
}

function collectPostingExtra(data) {
  const extra = {
    ...(data.extra && typeof data.extra === 'object' ? data.extra : {}),
    position: data.position || data.position_title || data.extra?.position || '',
    department: data.department || data.extra?.department || '',
    branch: data.branch || data.extra?.branch || '',
    employment_type: data.employment_type || data.extra?.employment_type || '',
    hours: data.hours || data.extra?.hours || '',
    salary_text: data.salary_text || data.salary || data.extra?.salary_text || '',
    salary_type: data.salary_type || data.extra?.salary_type || '',
    vacancies: data.vacancies || data.extra?.vacancies || '',
    experience: data.experience || data.extra?.experience || '',
    education: data.education || data.extra?.education || '',
    requirements: data.requirements || data.extra?.requirements || '',
    duties: data.duties || data.extra?.duties || '',
    benefits: data.benefits || data.extra?.benefits || '',
    how_to_apply: data.how_to_apply || data.extra?.how_to_apply || '',
    contact_name: data.contact_name || data.extra?.contact_name || '',
    contact_phone: data.contact_phone || data.extra?.contact_phone || '',
    contact_email: data.contact_email || data.extra?.contact_email || '',
    closing_date: data.closes_at || data.closing_date || data.extra?.closing_date || ''
  };
  return extra;
}

function saveJobPosting(data, actor) {
  requireRecruitmentRole(actor);
  ensurePostingSchema();
  const db = getDb();
  if (!data.title?.trim()) throw new Error('Job title is required');
  const user = assertUserActor(actor || require('./session').getUserSession(), []);
  const isAdmin = ['owner', 'manager'].includes(user.role);
  const extra = collectPostingExtra(data);
  const extraJson = JSON.stringify(extra);
  const closesAt = extra.closing_date || null;
  const salaryText = extra.salary_text || null;
  const positionTitle = extra.position || data.title.trim();
  if (data.id) {
    const existing = db.prepare('SELECT * FROM job_postings WHERE id = ?').get(data.id);
    if (!existing) throw new Error('Job posting not found');
    let status = data.status || existing.status;
    if (status === 'approved' && !isAdmin) throw new Error('Only admin can approve postings');
    if (status === 'rejected') status = 'closed';
    const token = existing.apply_token || makeApplyToken();
    const params = [data.title.trim(), data.description || null, status, extraJson, token, closesAt, salaryText, positionTitle, data.id];
    try {
      db.prepare(`UPDATE job_postings SET title=?, description=?, status=?, rejection_notes=COALESCE(?, rejection_notes),
        extra_json=?, apply_token=?, closes_at=?, salary_text=?, position_title=?, updated_at=datetime('now') WHERE id=?`)
        .run(data.title.trim(), data.description || null, status, data.rejection_notes || null,
          extraJson, token, closesAt, salaryText, positionTitle, data.id);
    } catch (err) {
      const msg = String(err.message || err);
      if (!/rejection_notes|column/i.test(msg)) throw err;
      db.prepare(`UPDATE job_postings SET title=?, description=?, status=?,
        extra_json=?, apply_token=?, closes_at=?, salary_text=?, position_title=?, updated_at=datetime('now') WHERE id=?`)
        .run(...params);
    }
    return getJobPosting(data.id, actor);
  }
  const status = isAdmin && (data.status === 'active' || data.publish_now !== false) ? 'active' : (isAdmin ? 'active' : 'pending');
  const token = makeApplyToken();
  const r = db.prepare(`INSERT INTO job_postings (title, description, status, created_by, extra_json, apply_token, closes_at, salary_text, position_title)
    VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(data.title.trim(), data.description || null, status, actor?.id || user.id || null,
      extraJson, token, closesAt, salaryText, positionTitle);
  audit(actor?.id || user.id, actor?.username || user.username, 'create_job_posting', 'job_posting', r.lastInsertRowid, { title: data.title });
  if (status === 'pending') {
    notifyRecruitment('recruitment_posting', 'Job posting pending approval', `${data.title} needs admin approval.`, r.lastInsertRowid);
  }
  return getJobPosting(r.lastInsertRowid, actor);
}

function approveJobPosting(id, actor) {
  requireAdminRole(actor);
  getDb().prepare(`UPDATE job_postings SET status='active', approved_by=?, approved_at=datetime('now'), updated_at=datetime('now') WHERE id=?`)
    .run(actor?.id || null, id);
  audit(actor?.id, actor?.username, 'approve_job_posting', 'job_posting', id, null);
  return getJobPosting(id, actor);
}

function closeJobPosting(id, actor) {
  requireAdminRole(actor);
  getDb().prepare(`UPDATE job_postings SET status='closed', updated_at=datetime('now') WHERE id=?`).run(id);
  audit(actor?.id, actor?.username, 'close_job_posting', 'job_posting', id, null);
  return getJobPosting(id, actor);
}

function deleteJobPosting(id, actor) {
  requireAdminRole(actor);
  const existing = getDb().prepare('SELECT * FROM job_postings WHERE id = ?').get(id);
  if (!existing) throw new Error('Job posting not found');
  getDb().prepare('DELETE FROM job_candidates WHERE posting_id = ?').run(id);
  getDb().prepare('DELETE FROM job_postings WHERE id = ?').run(id);
  audit(actor?.id, actor?.username, 'delete_job_posting', 'job_posting', id, { title: existing.title });
  return { deleted: true, id };
}

function enrichCandidate(c) {
  if (!c) return null;
  return {
    ...c,
    address: c.address || c.location || null,
    pictures: parseJson(c.pictures_json, [])
  };
}

function getJobCandidates(filters = {}, actor) {
  requireRecruitmentRole(actor);
  let sql = `SELECT c.*, jp.title AS posting_title, jp.status AS posting_status,
    u.full_name AS employ_request_by_name, a.full_name AS admin_decision_by_name
    FROM job_candidates c
    JOIN job_postings jp ON jp.id = c.posting_id
    LEFT JOIN users u ON u.id = c.employ_request_by
    LEFT JOIN users a ON a.id = c.admin_decision_by WHERE 1=1`;
  const params = [];
  if (filters.posting_id) { sql += ' AND c.posting_id = ?'; params.push(filters.posting_id); }
  if (filters.status) { sql += ' AND c.status = ?'; params.push(filters.status); }
  if (filters.employ_requested) { sql += ` AND c.employ_request_by IS NOT NULL AND (c.admin_decision IS NULL OR c.admin_decision = '')`; }
  if (filters.interview_pending) { sql += ` AND c.interview_status IN ('scheduled','pending_result','result_uploaded')`; }
  sql += ' ORDER BY c.created_at DESC';
  return getDb().prepare(sql).all(...params).map(enrichCandidate);
}

function getJobCandidate(id, actor) {
  requireRecruitmentRole(actor);
  const c = getDb().prepare(`SELECT c.*, jp.title AS posting_title FROM job_candidates c
    JOIN job_postings jp ON jp.id = c.posting_id WHERE c.id = ?`).get(id);
  return enrichCandidate(c);
}

function saveJobCandidate(data, actor) {
  requireRecruitmentRole(actor);
  const db = getDb();
  if (!data.name?.trim()) throw new Error('Candidate name is required');
  if (!data.posting_id) throw new Error('Job posting is required');
  const posting = db.prepare('SELECT * FROM job_postings WHERE id = ?').get(data.posting_id);
  if (!posting) throw new Error('Job posting not found');
  const address = data.address || data.location || null;
  const location = data.location || data.address || null;
  if (data.id) {
    db.prepare(`UPDATE job_candidates SET name=?, phone=?, location=?, address=COALESCE(?, address),
      cv_path=COALESCE(?, cv_path), status=?, updated_at=datetime('now') WHERE id=?`)
      .run(data.name.trim(), data.phone || null, location, address, data.cv_path || null, data.status || 'new', data.id);
    return getJobCandidate(data.id, actor);
  }
  const r = db.prepare(`INSERT INTO job_candidates (posting_id, name, phone, location, address, cv_path, status, pictures_json, edit_token)
    VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(data.posting_id, data.name.trim(), data.phone || null, location, address, data.cv_path || null, data.status || 'new', '[]', makeEditToken());
  audit(actor?.id, actor?.username, 'add_job_candidate', 'job_candidate', r.lastInsertRowid, { name: data.name });
  notifyRecruitment('recruitment_candidate', 'New candidate recorded',
    `${data.name} added for ${posting.title} — pending admin review.`, r.lastInsertRowid);
  return getJobCandidate(r.lastInsertRowid, actor);
}

function attachJobCandidateCv(candidateId, filePath, actor) {
  requireRecruitmentRole(actor);
  const dest = copyCvToAssets(filePath, candidateId);
  getDb().prepare(`UPDATE job_candidates SET cv_path=?, updated_at=datetime('now') WHERE id=?`).run(dest, candidateId);
  return getJobCandidate(candidateId, actor);
}

function attachJobCandidatePicture(candidateId, filePath, actor) {
  requireRecruitmentRole(actor);
  const settings = getRecruitmentSettings();
  const c = getJobCandidate(candidateId, actor);
  if (!c) throw new Error('Candidate not found');
  const pics = c.pictures || [];
  if (pics.length >= settings.max_pictures) {
    throw new Error(`Maximum ${settings.max_pictures} picture(s) allowed (set by admin)`);
  }
  const dest = copyPicToAssets(filePath, candidateId);
  pics.push(dest);
  getDb().prepare(`UPDATE job_candidates SET pictures_json=?, updated_at=datetime('now') WHERE id=?`)
    .run(JSON.stringify(pics), candidateId);
  return getJobCandidate(candidateId, actor);
}

function requestEmployCandidate(id, actor) {
  requireRecruitmentRole(actor);
  getDb().prepare(`UPDATE job_candidates SET employ_request_by=?, employ_request_at=datetime('now'), status='employ_requested', updated_at=datetime('now') WHERE id=?`)
    .run(actor?.id || null, id);
  audit(actor?.id, actor?.username, 'request_employ_candidate', 'job_candidate', id, null);
  notifyRecruitment('recruitment_employ', 'Employment request pending',
    `Candidate #${id} requested for hire — admin approval required.`, id);
  return getJobCandidate(id, actor);
}

function decideJobCandidate(id, decision, notes, actor) {
  requireAdminRole(actor);
  if (!['approved', 'rejected', 'waitlisted'].includes(decision)) throw new Error('Decision must be approved, waitlisted or rejected');
  const c = getJobCandidate(id, actor);
  if (!c) throw new Error('Candidate not found');
  let hiredEmployee = null;
  let hireNote = notes || null;
  if (decision === 'approved') {
    try {
      const staff = require('./staff');
      hiredEmployee = staff.saveEmployee({
        full_name: c.name,
        phone: c.phone || null,
        address: c.address || c.location || null,
        position: c.posting_title || 'Staff',
        date_hired: today(),
        status: 'Active',
        notes: `Hired from recruitment candidate #${id}${notes ? ` — ${notes}` : ''}`
      }, actor?.id);
      hireNote = [notes, hiredEmployee?.employee_code ? `Employee ${hiredEmployee.employee_code} created` : null]
        .filter(Boolean).join('\n') || null;
    } catch (err) {
      hireNote = [notes, `Employee create failed: ${err.message || err}`].filter(Boolean).join('\n');
    }
  }
  const nextStatus = decision === 'approved' ? 'hired' : (decision === 'waitlisted' ? 'waitlisted' : 'rejected');
  getDb().prepare(`UPDATE job_candidates SET admin_decision=?, admin_decision_by=?, admin_decision_at=datetime('now'), admin_notes=?, status=?, updated_at=datetime('now') WHERE id=?`)
    .run(decision, actor?.id || null, hireNote, nextStatus, id);
  audit(actor?.id, actor?.username, `candidate_${decision}`, 'job_candidate', id, { notes: hireNote, employee_id: hiredEmployee?.id });
  const out = getJobCandidate(id, actor);
  const waType = decision === 'approved' ? 'hire' : (decision === 'waitlisted' ? 'waitlist' : 'reject');
  let whatsapp = null;
  try { whatsapp = previewCandidateWhatsApp(id, waType, actor); } catch (_) { /* optional */ }
  return { ...out, _employee: hiredEmployee, _generated_pin: hiredEmployee?._generated_pin, _whatsapp: whatsapp };
}

function scheduleInterview(data, actor) {
  requireRecruitmentRole(actor);
  const ids = (data.candidate_ids || [data.candidate_id]).filter(Boolean).map(Number);
  if (!ids.length) throw new Error('Select at least one candidate');
  if (!data.interview_at) throw new Error('Interview date/time required');
  const db = getDb();
  for (const id of ids) {
    db.prepare(`UPDATE job_candidates SET interview_at=?, interview_location=?, interview_notes=?,
      interview_assigned_to=?, interview_status='scheduled', status='interview_scheduled', updated_at=datetime('now') WHERE id=?`)
      .run(data.interview_at, data.interview_location || null, data.interview_notes || null,
        data.interview_assigned_to || null, id);
  }
  audit(actor?.id, actor?.username, 'schedule_interview', 'job_candidate', ids[0], { ids, interview_at: data.interview_at });
  notifyRecruitment('recruitment_interview', 'Interviews scheduled',
    `${ids.length} candidate(s) scheduled for ${data.interview_at}. Admin approval still required for hire.`, ids[0]);
  return ids.map(id => getJobCandidate(id, actor));
}

function renderRecruitmentMessage(template, vars) {
  let out = String(template || '');
  Object.keys(vars || {}).forEach(k => {
    out = out.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'gi'), vars[k] != null ? String(vars[k]) : '');
  });
  return out.replace(/\{\{[A-Za-z0-9_]+\}\}/g, '').trim();
}

function buildCandidateWhatsApp(candidateId, messageType, actor, customBody) {
  requireRecruitmentRole(actor);
  const c = getJobCandidate(candidateId, actor);
  if (!c) throw new Error('Candidate not found');
  if (!c.phone) throw new Error('Candidate has no phone number');
  const settings = getRecruitmentSettings();
  const shop = getDb().prepare('SELECT shop_name, phone FROM shop_settings WHERE id = 1').get() || {};
  const tpl = customBody
    || (messageType === 'hire' ? settings.hire_message
      : messageType === 'reject' ? settings.reject_message
        : messageType === 'waitlist' ? settings.waitlist_message
          : settings.interview_message);
  const body = renderRecruitmentMessage(tpl, {
    CandidateName: c.name,
    JobTitle: c.posting_title || 'the position',
    Branch: shop.shop_name || 'our store',
    Phone: shop.phone || '',
    InterviewAt: c.interview_at || '',
    InterviewLocation: c.interview_location || shop.shop_name || ''
  });
  const whatsapp = require('./whatsapp');
  return whatsapp.sendMessage({
    phone: c.phone,
    recipient_type: 'customer',
    recipient_name: c.name,
    message_type: `recruitment_${messageType}`,
    body
  }, actor);
}

function sendBulkInterviewWhatsApp(candidateIds, actor, customBody) {
  requireRecruitmentRole(actor);
  const results = [];
  for (const id of candidateIds || []) {
    try {
      results.push({ id, ...buildCandidateWhatsApp(id, 'interview', actor, customBody) });
    } catch (err) {
      results.push({ id, error: err.message });
    }
  }
  return results;
}

function createInterviewDocument(candidateId, actor) {
  requireRecruitmentRole(actor);
  const c = getJobCandidate(candidateId, actor);
  if (!c) throw new Error('Candidate not found');
  const shop = getDb().prepare('SELECT shop_name, address, phone FROM shop_settings WHERE id = 1').get() || {};
  const doc = new jsPDF();
  doc.setFontSize(16);
  doc.text('Interview Assessment Form', 14, 20);
  doc.setFontSize(11);
  const lines = [
    `Company: ${shop.shop_name || ''}`,
    `Candidate: ${c.name}`,
    `Phone: ${c.phone || ''}`,
    `Address: ${c.address || c.location || ''}`,
    `Position: ${c.posting_title || ''}`,
    `Interview: ${c.interview_at || 'TBC'}`,
    `Venue: ${c.interview_location || ''}`,
    `Interviewer: ${c.interview_assigned_to || ''}`,
    '',
    'Scoring (1–5): Communication ___ | Experience ___ | Attitude ___ | Overall ___',
    '',
    'Notes / questions asked:',
    '_______________________________________________',
    '_______________________________________________',
    '',
    'Recommendation: Hire / Hold / Reject',
    'Interviewer signature: ________________  Date: ________'
  ];
  let y = 32;
  lines.forEach(line => { doc.text(line, 14, y); y += 8; });
  const buf = require('./pdf-bytes').pdfBytes(doc);
  const filePath = path.join(getDocAssetsDir(), `interview-${candidateId}-${Date.now()}.pdf`);
  fs.writeFileSync(filePath, buf);
  getDb().prepare(`UPDATE job_candidates SET interview_doc_path=?, interview_status='pending_result', updated_at=datetime('now') WHERE id=?`)
    .run(filePath, candidateId);
  audit(actor?.id, actor?.username, 'create_interview_doc', 'job_candidate', candidateId, { path: filePath });
  return { path: filePath, buffer: buf, candidate: getJobCandidate(candidateId, actor) };
}

function uploadInterviewResult(candidateId, filePath, actor) {
  requireRecruitmentRole(actor);
  if (!filePath || !fs.existsSync(filePath)) throw new Error('Result file not found');
  const ext = path.extname(filePath) || '.pdf';
  const dest = path.join(getDocAssetsDir(), `result-${candidateId}-${Date.now()}${ext}`);
  fs.copyFileSync(filePath, dest);
  getDb().prepare(`UPDATE job_candidates SET interview_result_path=?, interview_status='result_uploaded',
    status='interview_complete', updated_at=datetime('now') WHERE id=?`).run(dest, candidateId);
  audit(actor?.id, actor?.username, 'upload_interview_result', 'job_candidate', candidateId, { path: dest });
  notifyRecruitment('recruitment_result', 'Interview result uploaded',
    `Interview result for candidate #${candidateId} uploaded — admin must approve hire/reject.`, candidateId);
  return getJobCandidate(candidateId, actor);
}

function previewCandidateWhatsApp(candidateId, messageType, actor) {
  const c = actor ? getJobCandidate(candidateId, actor) : getDb().prepare(`
    SELECT c.*, jp.title AS posting_title FROM job_candidates c
    JOIN job_postings jp ON jp.id = c.posting_id WHERE c.id = ?`).get(candidateId);
  if (!c) throw new Error('Candidate not found');
  const settings = getRecruitmentSettings();
  const shop = getDb().prepare('SELECT shop_name, phone FROM shop_settings WHERE id = 1').get() || {};
  const tpl = messageType === 'hire' ? settings.hire_message
    : messageType === 'reject' ? settings.reject_message
      : messageType === 'waitlist' ? settings.waitlist_message
        : settings.interview_message;
  const body = renderRecruitmentMessage(tpl, {
    CandidateName: c.name,
    JobTitle: c.posting_title || 'the position',
    Branch: shop.shop_name || 'our store',
    Phone: shop.phone || '',
    InterviewAt: c.interview_at || '',
    InterviewLocation: c.interview_location || shop.shop_name || ''
  });
  return { phone: c.phone || '', body, name: c.name, type: messageType };
}

function applyLinkFor(token, shop) {
  const raw = String(shop?.cloud_base_url || process.env.SHOP_POS_SYNC_URL || process.env.SHOP_POS_PUBLIC_URL || 'https://chisafood.up.railway.app').replace(/\/$/, '');
  return `${raw}/apply/?job=${encodeURIComponent(token)}`;
}

function orderLinkFor(shop) {
  const raw = String(shop?.cloud_base_url || process.env.SHOP_POS_SYNC_URL || process.env.SHOP_POS_PUBLIC_URL || 'https://chisafood.up.railway.app').replace(/\/$/, '');
  return `${raw}/order/`;
}

function postingCloseDate(closesAt) {
  if (!closesAt) return null;
  const s = String(closesAt).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T23:59:59`);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function shopPublic() {
  const shop = getDb().prepare('SELECT shop_name, address, phone, email, logo_path FROM shop_settings WHERE id = 1').get() || {};
  return {
    ...shop,
    logo_url: '/api/logo',
    logo_data_url: fileDataUrl(shop.logo_path)
  };
}

function publicPostingView(row) {
  const posting = enrichPosting(row);
  const closeAt = postingCloseDate(posting.closes_at);
  const closed = posting.status !== 'active' || !!(closeAt && closeAt.getTime() <= Date.now());
  return {
    id: posting.id,
    title: posting.title,
    description: posting.description,
    extra: posting.extra,
    salary_text: posting.salary_text,
    position_title: posting.position_title,
    closes_at: posting.closes_at,
    apply_token: posting.apply_token,
    closed,
    shop: shopPublic()
  };
}

function getPublicPosting(token) {
  ensurePostingSchema();
  if (!token) throw new Error('Job link is missing');
  const row = getDb().prepare('SELECT * FROM job_postings WHERE apply_token = ?').get(String(token).trim());
  if (!row) throw new Error('This job posting was not found');
  return publicPostingView(row);
}

function listPublicOpenPostings() {
  ensurePostingSchema();
  const rows = getDb().prepare(`SELECT * FROM job_postings WHERE status = 'active' ORDER BY created_at DESC`).all();
  return rows.map(publicPostingView).filter((p) => !p.closed);
}

function publicApplicationView(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email || '',
    address: row.address || row.location || '',
    location: row.location || '',
    notes: row.notes || '',
    has_cv: !!(row.cv_path || row.cv_data),
    status: row.status,
    edit_token: row.edit_token,
    posting_id: row.posting_id,
    posting_title: row.posting_title || null
  };
}

function getCandidateByEditToken(editToken) {
  ensurePostingSchema();
  const token = String(editToken || '').trim();
  if (!token) throw new Error('Application link is missing');
  const row = getDb().prepare(`
    SELECT c.*, jp.title AS posting_title, jp.apply_token, jp.status AS posting_status, jp.closes_at
    FROM job_candidates c
    JOIN job_postings jp ON jp.id = c.posting_id
    WHERE c.edit_token = ?
  `).get(token);
  if (!row) throw new Error('Application not found');
  return row;
}

function getPublicApplication(editToken) {
  return publicApplicationView(getCandidateByEditToken(editToken));
}

function lookupPublicApplication(jobToken, phone) {
  ensurePostingSchema();
  if (!jobToken) throw new Error('Job link is missing');
  const digits = normalizePhone(phone);
  if (digits.length < 7) throw new Error('Enter the phone number you used to apply');
  const posting = getDb().prepare('SELECT id FROM job_postings WHERE apply_token = ?').get(String(jobToken).trim());
  if (!posting) throw new Error('This job posting was not found');
  const rows = getDb().prepare(`SELECT c.*, jp.title AS posting_title FROM job_candidates c
    JOIN job_postings jp ON jp.id = c.posting_id
    WHERE c.posting_id = ?`).all(posting.id);
  const match = rows.find((c) => normalizePhone(c.phone) === digits || normalizePhone(c.phone).endsWith(digits.slice(-9)));
  if (!match) throw new Error('No application found for that phone number');
  if (!match.edit_token) {
    match.edit_token = makeEditToken();
    getDb().prepare(`UPDATE job_candidates SET edit_token = ? WHERE id = ?`).run(match.edit_token, match.id);
  }
  return publicApplicationView(match);
}

function saveCvFromBase64(candidateId, fileName, dataUrl) {
  const match = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error('CV file is invalid');
  const mime = match[1] || '';
  const raw = match[2];
  let ext = path.extname(fileName || '') || '';
  if (!ext) {
    if (mime.includes('pdf')) ext = '.pdf';
    else if (mime.includes('word') || mime.includes('officedocument')) ext = '.docx';
    else if (mime.includes('png')) ext = '.png';
    else ext = '.pdf';
  }
  let dest = `db://cv/${candidateId}`;
  try {
    dest = path.join(getCvAssetsDir(), `cv-${candidateId}-${Date.now()}${ext}`);
    fs.writeFileSync(dest, Buffer.from(raw, 'base64'));
  } catch (err) {
    dest = `db://cv/${candidateId}`;
    if (!raw) throw err;
  }
  getDb().prepare(`UPDATE job_candidates SET cv_path=?, cv_data=?, updated_at=datetime('now') WHERE id=?`)
    .run(dest, dataUrl, candidateId);
  return dest;
}

function applyPublicFields(data) {
  if (!data.name?.trim()) throw new Error('Full name is required');
  if (!data.phone?.trim()) throw new Error('WhatsApp / phone number is required');
  return {
    name: data.name.trim(),
    phone: data.phone.trim(),
    location: data.location || data.address || null,
    address: data.address || data.location || null,
    email: data.email || null,
    notes: data.notes || data.cover_letter || null
  };
}

function submitPublicApplication(token, data = {}) {
  if (data.edit_token) {
    return updatePublicApplication(data.edit_token, data);
  }
  const posting = getPublicPosting(token);
  if (posting.closed) throw new Error('Applications for this job have closed');
  const fields = applyPublicFields(data);
  const db = getDb();
  const existing = db.prepare(`SELECT * FROM job_candidates WHERE posting_id = ?`).all(posting.id)
    .find((c) => normalizePhone(c.phone) === normalizePhone(fields.phone));
  if (existing) {
    return updatePublicApplication(existing.edit_token || existing.id, { ...data, _byId: !existing.edit_token ? existing.id : null });
  }
  const editToken = makeEditToken();
  const r = db.prepare(`INSERT INTO job_candidates (posting_id, name, phone, location, address, email, notes, cv_path, status, pictures_json, edit_token)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(posting.id, fields.name, fields.phone, fields.location, fields.address, fields.email, fields.notes,
      null, 'new', '[]', editToken);
  const id = r.lastInsertRowid;
  if (data.cv_data) {
    try { saveCvFromBase64(id, data.cv_name, data.cv_data); } catch (err) {
      db.prepare('DELETE FROM job_candidates WHERE id = ?').run(id);
      throw err;
    }
  }
  notifyRecruitment('recruitment_candidate', 'New online application',
    `${fields.name} applied for ${posting.title}.`, id);
  return { id, ok: true, name: fields.name, edit_token: editToken, updated: false };
}

function updatePublicApplication(editToken, data = {}) {
  ensurePostingSchema();
  let row;
  if (data._byId) {
    row = getDb().prepare('SELECT * FROM job_candidates WHERE id = ?').get(data._byId);
  } else {
    row = getCandidateByEditToken(editToken);
  }
  if (!row) throw new Error('Application not found');
  if (['hired', 'rejected'].includes(row.status)) {
    throw new Error('This application can no longer be changed');
  }
  const fields = applyPublicFields(data);
  const db = getDb();
  const token = row.edit_token || makeEditToken();
  db.prepare(`UPDATE job_candidates SET name=?, phone=?, location=?, address=?, email=?, notes=?, edit_token=?, updated_at=datetime('now') WHERE id=?`)
    .run(fields.name, fields.phone, fields.location, fields.address, fields.email, fields.notes, token, row.id);
  if (data.cv_data) saveCvFromBase64(row.id, data.cv_name, data.cv_data);
  return { id: row.id, ok: true, name: fields.name, edit_token: token, updated: true };
}

function deletePublicApplication(editToken) {
  const row = getCandidateByEditToken(editToken);
  const db = getDb();
  if (row.cv_path && !String(row.cv_path).startsWith('db://') && fs.existsSync(row.cv_path)) {
    try { fs.unlinkSync(row.cv_path); } catch (_) { /* ignore */ }
  }
  db.prepare('DELETE FROM job_candidates WHERE id = ?').run(row.id);
  audit(null, 'applicant', 'delete_own_application', 'job_candidate', row.id, { name: row.name, posting_id: row.posting_id });
  return { deleted: true, id: row.id };
}

function deleteJobCandidate(id, actor) {
  requireAdminRole(actor);
  const existing = getDb().prepare('SELECT * FROM job_candidates WHERE id = ?').get(id);
  if (!existing) throw new Error('Candidate not found');
  if (existing.cv_path && !String(existing.cv_path).startsWith('db://') && fs.existsSync(existing.cv_path)) {
    try { fs.unlinkSync(existing.cv_path); } catch (_) { /* ignore */ }
  }
  getDb().prepare('DELETE FROM job_candidates WHERE id = ?').run(id);
  audit(actor?.id, actor?.username, 'delete_job_candidate', 'job_candidate', id, { name: existing.name, posting_id: existing.posting_id });
  return { deleted: true, id };
}

function downloadCandidateCv(candidateId, actor) {
  requireRecruitmentRole(actor);
  const c = getJobCandidate(candidateId, actor);
  if (!c?.cv_path && !c?.cv_data) throw new Error('No CV uploaded');
  if (c.cv_data && String(c.cv_data).startsWith('data:')) {
    const match = String(c.cv_data).match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      return {
        filename: path.basename(c.cv_path || `cv-${candidateId}.pdf`),
        buffer: require('./pdf-bytes').toUint8(Buffer.from(match[2], 'base64')),
        mime: match[1] || 'application/pdf'
      };
    }
  }
  if (!c?.cv_path || !fs.existsSync(c.cv_path)) throw new Error('CV file is no longer on the server');
  return {
    filename: path.basename(c.cv_path),
    buffer: require('./pdf-bytes').toUint8(fs.readFileSync(c.cv_path)),
    mime: String(c.cv_path).toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream'
  };
}

function buildJobPosterPdf(postingId, actor) {
  requireRecruitmentRole(actor);
  const posting = getJobPosting(postingId, actor);
  if (!posting) throw new Error('Job posting not found');
  const shop = shopPublic();
  const extra = posting.extra || {};
  const token = posting.apply_token || makeApplyToken();
  if (!posting.apply_token) {
    getDb().prepare(`UPDATE job_postings SET apply_token=? WHERE id=?`).run(token, postingId);
  }
  const applyUrl = applyLinkFor(token, shop);
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  doc.setFillColor(30, 58, 95);
  doc.rect(0, 0, pageW, 40, 'F');
  if (shop.logo_data_url) {
    try {
      const fmt = /png/i.test(shop.logo_data_url) ? 'PNG' : 'JPEG';
      doc.addImage(shop.logo_data_url, fmt, 12, 8, 22, 22);
    } catch (_) { /* skip logo */ }
  }
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(String(shop.shop_name || 'Now hiring').toUpperCase(), pageW / 2, 14, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text([shop.address, shop.phone, shop.email].filter(Boolean).join('  ·  '), pageW / 2, 22, { align: 'center' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(posting.closes_at ? `Applications close: ${String(posting.closes_at).slice(0, 10)}` : 'Applications open now', pageW / 2, 30, { align: 'center' });
  doc.setTextColor(0, 0, 0);
  let y = 48;
  doc.setFontSize(18);
  doc.text(posting.title, 14, y);
  y += 8;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  const rows = [
    ['Position', extra.position || posting.position_title || posting.title],
    ['Employment type', extra.employment_type || '—'],
    ['Department', extra.department || '—'],
    ['Branch / site', extra.branch || shop.shop_name || '—'],
    ['Hours', extra.hours || '—'],
    ['Salary', extra.salary_text || posting.salary_text || 'To be discussed'],
    ['Vacancies', extra.vacancies || '1'],
    ['Experience', extra.experience || '—'],
    ['Education', extra.education || '—']
  ].filter(([, v]) => v && v !== '—');
  doc.autoTable({
    startY: y,
    theme: 'plain',
    styles: { fontSize: 10, cellPadding: 2 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 42 }, 1: { cellWidth: 140 } },
    body: rows
  });
  y = doc.lastAutoTable.finalY + 8;
  const blocks = [
    ['About the role', posting.description],
    ['Key duties', extra.duties],
    ['Requirements', extra.requirements],
    ['Benefits', extra.benefits]
  ];
  blocks.forEach(([heading, text]) => {
    if (!text) return;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text(heading, 14, y);
    y += 6;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    const lines = doc.splitTextToSize(String(text), pageW - 28);
    doc.text(lines, 14, y);
    y += lines.length * 5 + 6;
    if (y > 250) { doc.addPage(); y = 20; }
  });
  if (y > 230) { doc.addPage(); y = 20; }
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(14, y, pageW - 28, 28, 2, 2, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Apply online', 18, y + 8);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(doc.splitTextToSize(applyUrl, pageW - 40), 18, y + 15);
  return {
    buffer: require('./pdf-bytes').pdfBytes(doc),
    apply_url: applyUrl,
    order_url: orderLinkFor(shop),
    posting: getJobPosting(postingId, actor),
    shop,
    logo_data_url: shop.logo_data_url || null,
    share: buildJobShareMessage(postingId, actor)
  };
}

function buildJobShareMessage(postingId, actor) {
  requireRecruitmentRole(actor);
  const posting = getJobPosting(postingId, actor);
  if (!posting) throw new Error('Job posting not found');
  const shop = getDb().prepare('SELECT shop_name, address, phone FROM shop_settings WHERE id = 1').get() || {};
  const extra = posting.extra || {};
  const token = posting.apply_token || makeApplyToken();
  if (!posting.apply_token) {
    getDb().prepare(`UPDATE job_postings SET apply_token=? WHERE id=?`).run(token, postingId);
  }
  const applyUrl = applyLinkFor(token, shop);
  const orderUrl = orderLinkFor(shop);
  const body = [
    `${shop.shop_name || 'We'} are hiring`,
    '',
    `Position: ${extra.position || posting.title}`,
    extra.employment_type ? `Type: ${extra.employment_type}` : null,
    extra.salary_text || posting.salary_text ? `Salary: ${extra.salary_text || posting.salary_text}` : null,
    extra.hours ? `Hours: ${extra.hours}` : null,
    posting.closes_at ? `Applications close: ${String(posting.closes_at).slice(0, 10)}` : null,
    '',
    posting.description ? String(posting.description).slice(0, 280) : null,
    extra.requirements ? `Requirements: ${String(extra.requirements).slice(0, 180)}` : null,
    '',
    `Apply online (name, phone, CV): ${applyUrl}`,
    `Order from us: ${orderUrl}`,
    shop.phone ? `Call: ${shop.phone}` : null,
    '',
    `${shop.shop_name || 'Management'}`
  ].filter(Boolean).join('\n');
  return { body, apply_url: applyUrl, order_url: orderUrl, phone: shop.phone || '' };
}

function approveInterviewOutcome(candidateId, decision, notes, actor) {
  requireAdminRole(actor);
  if (!['approved', 'rejected'].includes(decision)) throw new Error('Decision must be approved or rejected');
  getDb().prepare(`UPDATE job_candidates SET admin_decision=?, admin_decision_by=?, admin_decision_at=datetime('now'),
    admin_notes=?, status=?, interview_status=?, updated_at=datetime('now') WHERE id=?`)
    .run(decision, actor?.id || null, notes || null,
      decision === 'approved' ? 'hired' : 'rejected',
      decision === 'approved' ? 'hired' : 'rejected', candidateId);
  audit(actor?.id, actor?.username, `interview_${decision}`, 'job_candidate', candidateId, { notes });
  return getJobCandidate(candidateId, actor);
}

module.exports = {
  getRecruitmentSettings,
  saveRecruitmentSettings,
  getJobPostings,
  getJobPosting,
  saveJobPosting,
  approveJobPosting,
  closeJobPosting,
  deleteJobPosting,
  getJobCandidates,
  getJobCandidate,
  saveJobCandidate,
  requestEmployCandidate,
  decideJobCandidate,
  copyCvToAssets,
  attachJobCandidateCv,
  attachJobCandidatePicture,
  scheduleInterview,
  buildCandidateWhatsApp,
  previewCandidateWhatsApp,
  sendBulkInterviewWhatsApp,
  createInterviewDocument,
  uploadInterviewResult,
  approveInterviewOutcome,
  getPublicPosting,
  listPublicOpenPostings,
  getPublicApplication,
  lookupPublicApplication,
  submitPublicApplication,
  updatePublicApplication,
  deletePublicApplication,
  deleteJobCandidate,
  downloadCandidateCv,
  buildJobPosterPdf,
  buildJobShareMessage
};

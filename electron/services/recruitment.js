const fs = require('fs');
const path = require('path');
const { jsPDF } = require('jspdf');
const { getDb, getDbPathForBackup } = require('../database/db');
const { assertUserActor } = require('./authz');

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

function parseJson(v, fb) {
  if (!v) return fb;
  try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return fb; }
}

function getRecruitmentSettings() {
  const row = getDb().prepare('SELECT recruitment_settings FROM shop_settings WHERE id = 1').get() || {};
  const parsed = parseJson(row.recruitment_settings, {});
  return {
    max_pictures: Math.max(1, Math.min(20, Number(parsed.max_pictures) || 5)),
    hire_message: parsed.hire_message || 'Dear {{CandidateName}},\n\nCongratulations! We are pleased to offer you the position of {{JobTitle}} at {{Branch}}.\n\nPlease reply to confirm, or contact us on {{Phone}}.\n\nKind regards,\n{{Branch}} Management',
    reject_message: parsed.reject_message || 'Dear {{CandidateName}},\n\nThank you for interviewing for {{JobTitle}} at {{Branch}}.\n\nAfter careful consideration we will not be proceeding with your application. We wish you every success.\n\nKind regards,\n{{Branch}} Management',
    interview_message: parsed.interview_message || 'Dear {{CandidateName}},\n\nYou are invited to an interview for {{JobTitle}} at {{Branch}}.\n\nDate/time: {{InterviewAt}}\nVenue: {{InterviewLocation}}\n\nPlease confirm attendance.\n\nKind regards,\n{{Branch}} Management'
  };
}

function saveRecruitmentSettings(data, actor) {
  requireAdminRole(actor);
  const current = getRecruitmentSettings();
  const merged = {
    max_pictures: data.max_pictures != null ? Math.max(1, Math.min(20, Number(data.max_pictures) || 5)) : current.max_pictures,
    hire_message: data.hire_message != null ? String(data.hire_message) : current.hire_message,
    reject_message: data.reject_message != null ? String(data.reject_message) : current.reject_message,
    interview_message: data.interview_message != null ? String(data.interview_message) : current.interview_message
  };
  getDb().prepare(`UPDATE shop_settings SET recruitment_settings = ?, updated_at = datetime('now') WHERE id = 1`)
    .run(JSON.stringify(merged));
  audit(actor?.id, actor?.username, 'save_recruitment_settings', 'shop_settings', 1, { max_pictures: merged.max_pictures });
  return merged;
}

function getCvAssetsDir() {
  const dir = path.join(path.dirname(getDbPathForBackup()), 'assets', 'recruitment', 'cv');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getPicAssetsDir() {
  const dir = path.join(path.dirname(getDbPathForBackup()), 'assets', 'recruitment', 'pics');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getDocAssetsDir() {
  const dir = path.join(path.dirname(getDbPathForBackup()), 'assets', 'recruitment', 'docs');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
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

function getJobPostings(filters = {}, actor) {
  requireRecruitmentRole(actor);
  let sql = `SELECT jp.*, u.full_name AS created_by_name, a.full_name AS approved_by_name
    FROM job_postings jp
    LEFT JOIN users u ON u.id = jp.created_by
    LEFT JOIN users a ON a.id = jp.approved_by WHERE 1=1`;
  const params = [];
  if (filters.status) { sql += ' AND jp.status = ?'; params.push(filters.status); }
  if (filters.active_only) { sql += ` AND jp.status = 'active'`; }
  sql += ' ORDER BY jp.created_at DESC';
  return getDb().prepare(sql).all(...params);
}

function getJobPosting(id, actor) {
  const rows = getJobPostings({}, actor);
  return rows.find(p => p.id === id) || getDb().prepare('SELECT * FROM job_postings WHERE id = ?').get(id);
}

function saveJobPosting(data, actor) {
  requireRecruitmentRole(actor);
  const db = getDb();
  if (!data.title?.trim()) throw new Error('Job title is required');
  const user = assertUserActor(actor, []);
  const isAdmin = ['owner', 'manager'].includes(user.role);
  if (data.id) {
    const existing = db.prepare('SELECT * FROM job_postings WHERE id = ?').get(data.id);
    if (!existing) throw new Error('Job posting not found');
    let status = data.status || existing.status;
    if (status === 'approved' && !isAdmin) throw new Error('Only admin can approve postings');
    if (status === 'rejected') status = 'closed';
    db.prepare(`UPDATE job_postings SET title=?, description=?, status=?, rejection_notes=COALESCE(?, rejection_notes), updated_at=datetime('now') WHERE id=?`)
      .run(data.title.trim(), data.description || null, status, data.rejection_notes || null, data.id);
    return getJobPosting(data.id, actor);
  }
  const status = isAdmin && data.status === 'active' ? 'active' : 'pending';
  const r = db.prepare(`INSERT INTO job_postings (title, description, status, created_by) VALUES (?,?,?,?)`)
    .run(data.title.trim(), data.description || null, status, actor?.id || null);
  audit(actor?.id, actor?.username, 'create_job_posting', 'job_posting', r.lastInsertRowid, { title: data.title });
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
  const r = db.prepare(`INSERT INTO job_candidates (posting_id, name, phone, location, address, cv_path, status, pictures_json)
    VALUES (?,?,?,?,?,?,?,?)`)
    .run(data.posting_id, data.name.trim(), data.phone || null, location, address, data.cv_path || null, data.status || 'new', '[]');
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
  if (!['approved', 'rejected'].includes(decision)) throw new Error('Decision must be approved or rejected');
  getDb().prepare(`UPDATE job_candidates SET admin_decision=?, admin_decision_by=?, admin_decision_at=datetime('now'), admin_notes=?, status=?, updated_at=datetime('now') WHERE id=?`)
    .run(decision, actor?.id || null, notes || null, decision === 'approved' ? 'hired' : 'rejected', id);
  audit(actor?.id, actor?.username, `candidate_${decision}`, 'job_candidate', id, { notes });
  return getJobCandidate(id, actor);
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
  const buf = Buffer.from(doc.output('arraybuffer'));
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
  sendBulkInterviewWhatsApp,
  createInterviewDocument,
  uploadInterviewResult,
  approveInterviewOutcome
};

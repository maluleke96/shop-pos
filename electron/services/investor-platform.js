/**
 * Investor Management — portal auth, CRUD, proposals, contracts, payments.
 */
const path = require('path');
const fs = require('fs');
const { assertUserActor } = require('./authz');
const {
  dbGet, dbAll, dbRun, nowIso, parseJson, uid, ensureMigration, moduleAudit,
  createModuleSession, resolveModuleSession, hashPassword, verifyPassword
} = require('./biz-modules-common');

const AUDIT = 'investor_audit_logs';

function auditInvestor(row) { moduleAudit(AUDIT, { module: 'investor', ...row }); }

function assetsDir() {
  const { getDbDir } = require('../database/db');
  const dir = path.join(getDbDir?.() || path.join(process.cwd(), 'data'), 'assets', 'investor');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function saveDocBase64(investorId, filename, dataUrl) {
  const m = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error('Invalid file data');
  const buf = Buffer.from(m[2], 'base64');
  const safe = String(filename || 'document').replace(/[^a-zA-Z0-9._-]/g, '_');
  const rel = `investor/${investorId}/${Date.now()}_${safe}`;
  const full = path.join(assetsDir(), '..', rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, buf);
  return rel;
}

// ─── Portal auth ─────────────────────────────────────────────────────────────

function investorLogin(username, password) {
  ensureMigration();
  const user = dbGet(`SELECT u.*, i.name AS investor_name, i.status AS investor_status
    FROM investor_portal_users u JOIN investors i ON i.id = u.investor_id
    WHERE lower(u.username) = lower(?) AND u.is_active = 1`, [username]);
  if (!user || !verifyPassword(password, user.password_hash)) {
    throw new Error('Invalid username or password');
  }
  if (user.investor_status === 'terminated' || user.investor_status === 'inactive') {
    throw new Error('Investor account is not active');
  }
  const sess = createModuleSession('investor_sessions', user.id);
  dbRun('UPDATE investor_portal_users SET last_login_at = ? WHERE id = ?', [nowIso(), user.id]);
  auditInvestor({ investor_id: user.investor_id, user_id: user.id, user_name: user.username, action: 'login' });
  return {
    token: sess.token,
    user: {
      id: user.id, username: user.username, investor_id: user.investor_id,
      investor_name: user.investor_name, role: 'investor'
    }
  };
}

function investorLogout(token) {
  try {
    dbRun('DELETE FROM investor_sessions WHERE token_hash = ?', [require('crypto').createHash('sha256').update(String(token)).digest('hex')]);
  } catch (_) { /* */ }
  return { success: true };
}

function resolveInvestorSession(token) {
  const row = resolveModuleSession('investor_sessions', 'investor_portal_users', token);
  const investor = dbGet('SELECT * FROM investors WHERE id = ?', [row.investor_id]);
  if (!investor || investor.status === 'terminated') throw new Error('Investor access revoked');
  return { user: row, investor };
}

function investorDashboard(token) {
  const { investor } = resolveInvestorSession(token);
  const agreements = dbAll('SELECT * FROM investment_agreements WHERE investor_id = ? ORDER BY id DESC', [investor.id]);
  const payments = dbAll('SELECT * FROM investor_payments WHERE investor_id = ? ORDER BY paid_at DESC, id DESC', [investor.id]);
  const distributions = dbAll('SELECT * FROM investor_distributions WHERE investor_id = ? ORDER BY paid_at DESC, id DESC', [investor.id]);
  const documents = dbAll('SELECT * FROM investor_documents WHERE investor_id = ? ORDER BY id DESC', [investor.id]);
  const announcements = dbAll(`SELECT * FROM investor_announcements WHERE investor_id = ? OR is_global = 1 ORDER BY id DESC LIMIT 20`, [investor.id]);
  return {
    investor: sanitizeInvestor(investor),
    agreements, payments, distributions, documents, announcements
  };
}

function sanitizeInvestor(i) {
  if (!i) return null;
  return { ...i, terms: parseJson(i.terms_json, {}) };
}

// ─── Admin CRUD ──────────────────────────────────────────────────────────────

function listInvestors(actor, filters = {}) {
  assertUserActor(actor, ['owner', 'manager']);
  ensureMigration();
  let sql = 'SELECT * FROM investors WHERE 1=1';
  const params = [];
  if (filters.status) { sql += ' AND status = ?'; params.push(filters.status); }
  sql += ' ORDER BY name';
  return dbAll(sql, params).map(sanitizeInvestor);
}

function getInvestor(id, actor) {
  assertUserActor(actor, ['owner', 'manager']);
  const inv = sanitizeInvestor(dbGet('SELECT * FROM investors WHERE id = ?', [id]));
  if (!inv) throw new Error('Investor not found');
  inv.payments = dbAll('SELECT * FROM investor_payments WHERE investor_id = ? ORDER BY id DESC', [id]);
  inv.distributions = dbAll('SELECT * FROM investor_distributions WHERE investor_id = ? ORDER BY id DESC', [id]);
  inv.agreements = dbAll('SELECT * FROM investment_agreements WHERE investor_id = ? ORDER BY id DESC', [id]);
  inv.documents = dbAll('SELECT * FROM investor_documents WHERE investor_id = ? ORDER BY id DESC', [id]);
  inv.portal_users = dbAll('SELECT id, username, email, is_active, last_login_at FROM investor_portal_users WHERE investor_id = ?', [id]);
  inv.audit = dbAll('SELECT * FROM investor_audit_logs WHERE investor_id = ? ORDER BY id DESC LIMIT 50', [id]);
  return inv;
}

function saveInvestor(data, actor) {
  assertUserActor(actor, ['owner', 'manager']);
  ensureMigration();
  const name = String(data.name || '').trim();
  if (!name) throw new Error('Investor name is required');
  const fields = {
    name,
    company: data.company?.trim() || null,
    email: data.email?.trim() || null,
    phone: data.phone?.trim() || null,
    address: data.address?.trim() || null,
    investment_amount: Number(data.investment_amount) || 0,
    equity_percent: Number(data.equity_percent) || 0,
    profit_share_percent: Number(data.profit_share_percent) || 0,
    agreement_date: data.agreement_date || null,
    status: data.status || 'active',
    terms_json: JSON.stringify(data.terms || {}),
    notes: data.notes?.trim() || null
  };
  if (data.id) {
    const sets = Object.keys(fields).map((k) => `${k} = ?`).join(', ');
    dbRun(`UPDATE investors SET ${sets}, updated_at = ? WHERE id = ?`, [...Object.values(fields), nowIso(), data.id]);
    auditInvestor({ investor_id: data.id, user_id: actor.id, user_name: actor.full_name || actor.username, action: 'investor_updated', entity_type: 'investor', entity_id: data.id });
    return getInvestor(data.id, actor);
  }
  const code = uid('INV');
  const r = dbRun(`INSERT INTO investors (investor_code, name, company, email, phone, address, investment_amount, equity_percent, profit_share_percent, agreement_date, status, terms_json, notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [code, fields.name, fields.company, fields.email, fields.phone, fields.address,
      fields.investment_amount, fields.equity_percent, fields.profit_share_percent,
      fields.agreement_date, fields.status, fields.terms_json, fields.notes]);
  const id = r.lastInsertRowid;
  auditInvestor({ investor_id: id, user_id: actor.id, user_name: actor.full_name || actor.username, action: 'investor_created', entity_type: 'investor', entity_id: id });
  return getInvestor(id, actor);
}

function createInvestorPortalUser(investorId, data, actor) {
  assertUserActor(actor, ['owner', 'manager']);
  const username = String(data.username || '').trim();
  const password = String(data.password || '');
  if (!username || password.length < 6) throw new Error('Username and password (min 6 chars) required');
  const existing = dbGet('SELECT id FROM investor_portal_users WHERE lower(username) = lower(?)', [username]);
  if (existing) throw new Error('Username already taken');
  dbRun(`INSERT INTO investor_portal_users (investor_id, username, password_hash, email, is_active)
    VALUES (?,?,?,?,?)`,
    [investorId, username, hashPassword(password), data.email || null, data.is_active !== false ? 1 : 0]);
  auditInvestor({ investor_id: investorId, user_id: actor.id, user_name: actor.full_name || actor.username, action: 'portal_user_created', entity_type: 'investor_portal_user' });
  return getInvestor(investorId, actor);
}

function saveProposal(data, actor) {
  assertUserActor(actor, ['owner', 'manager']);
  ensureMigration();
  const title = String(data.title || 'Investment Proposal').trim();
  const payload = {
    investor_id: data.investor_id || null,
    title,
    business_info: data.business_info || '',
    amount_requested: Number(data.amount_requested) || 0,
    amount_offered: Number(data.amount_offered) || 0,
    percent_offered: Number(data.percent_offered) || 0,
    return_arrangement: data.return_arrangement || '',
    duration: data.duration || '',
    investor_responsibilities: data.investor_responsibilities || '',
    business_responsibilities: data.business_responsibilities || '',
    terms: data.terms || '',
    risks: data.risks || '',
    notes: data.notes || '',
    status: data.status || 'draft',
    created_by: actor.id
  };
  if (data.id) {
    const sets = Object.keys(payload).filter((k) => k !== 'created_by').map((k) => `${k} = ?`).join(', ');
    dbRun(`UPDATE investment_proposals SET ${sets}, updated_at = ? WHERE id = ?`,
      [...Object.keys(payload).filter((k) => k !== 'created_by').map((k) => payload[k]), nowIso(), data.id]);
    return dbGet('SELECT * FROM investment_proposals WHERE id = ?', [data.id]);
  }
  const r = dbRun(`INSERT INTO investment_proposals (investor_id, title, business_info, amount_requested, amount_offered, percent_offered, return_arrangement, duration, investor_responsibilities, business_responsibilities, terms, risks, notes, status, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [payload.investor_id, payload.title, payload.business_info, payload.amount_requested, payload.amount_offered,
      payload.percent_offered, payload.return_arrangement, payload.duration, payload.investor_responsibilities,
      payload.business_responsibilities, payload.terms, payload.risks, payload.notes, payload.status, payload.created_by]);
  return dbGet('SELECT * FROM investment_proposals WHERE id = ?', [r.lastInsertRowid]);
}

function buildProposalPdf(proposalId, actor) {
  assertUserActor(actor, ['owner', 'manager']);
  const p = dbGet('SELECT * FROM investment_proposals WHERE id = ?', [proposalId]);
  if (!p) throw new Error('Proposal not found');
  const { jsPDF } = require('jspdf');
  const doc = new jsPDF();
  let y = 20;
  doc.setFontSize(16);
  doc.text(p.title || 'Investment Proposal', 14, y);
  y += 12;
  doc.setFontSize(10);
  const lines = [
    ['Amount requested', `R${Number(p.amount_requested).toFixed(2)}`],
    ['Investor contribution', `R${Number(p.amount_offered).toFixed(2)}`],
    ['Percentage offered', `${Number(p.percent_offered)}%`],
    ['Duration', p.duration || '—'],
    ['Return arrangement', p.return_arrangement || '—']
  ];
  lines.forEach(([k, v]) => { doc.text(`${k}: ${v}`, 14, y); y += 7; });
  y += 5;
  const sections = [
    ['Business information', p.business_info],
    ['Investor responsibilities', p.investor_responsibilities],
    ['Business responsibilities', p.business_responsibilities],
    ['Terms', p.terms],
    ['Risks / disclosures', p.risks],
    ['Notes', p.notes]
  ];
  sections.forEach(([title, body]) => {
    if (!body) return;
    doc.setFont(undefined, 'bold');
    doc.text(title, 14, y); y += 6;
    doc.setFont(undefined, 'normal');
    doc.splitTextToSize(String(body), 180).forEach((ln) => { if (y > 270) { doc.addPage(); y = 20; } doc.text(ln, 14, y); y += 5; });
    y += 4;
  });
  return { pdf_base64: doc.output('datauristring'), filename: `proposal-${proposalId}.pdf` };
}

function saveAgreement(data, actor) {
  assertUserActor(actor, ['owner', 'manager']);
  ensureMigration();
  if (!data.investor_id) throw new Error('Investor required');
  const status = data.status || 'DRAFT';
  let filePath = data.file_path || null;
  if (data.file_data && data.file_name) {
    filePath = saveDocBase64(data.investor_id, data.file_name, data.file_data);
  }
  if (data.id) {
    dbRun(`UPDATE investment_agreements SET title=?, file_path=?, status=?, notes=?, expires_at=?, updated_at=? WHERE id=?`,
      [data.title || 'Agreement', filePath, status, data.notes || null, data.expires_at || null, nowIso(), data.id]);
    auditInvestor({ investor_id: data.investor_id, user_id: actor.id, user_name: actor.full_name || actor.username, action: 'agreement_updated', entity_type: 'agreement', entity_id: data.id });
    return dbGet('SELECT * FROM investment_agreements WHERE id = ?', [data.id]);
  }
  const r = dbRun(`INSERT INTO investment_agreements (investor_id, proposal_id, title, file_path, status, notes, expires_at)
    VALUES (?,?,?,?,?,?,?)`,
    [data.investor_id, data.proposal_id || null, data.title || 'Agreement', filePath, status, data.notes || null, data.expires_at || null]);
  auditInvestor({ investor_id: data.investor_id, user_id: actor.id, user_name: actor.full_name || actor.username, action: 'agreement_created', entity_type: 'agreement', entity_id: r.lastInsertRowid });
  return dbGet('SELECT * FROM investment_agreements WHERE id = ?', [r.lastInsertRowid]);
}

function recordPayment(data, actor) {
  assertUserActor(actor, ['owner', 'manager']);
  dbRun(`INSERT INTO investor_payments (investor_id, amount, payment_type, reference, notes, paid_at, recorded_by) VALUES (?,?,?,?,?,?,?)`,
    [data.investor_id, Number(data.amount) || 0, data.payment_type || 'contribution', data.reference || null, data.notes || null, data.paid_at || nowIso(), actor.id]);
  auditInvestor({ investor_id: data.investor_id, user_id: actor.id, user_name: actor.full_name || actor.username, action: 'payment_recorded' });
  return { success: true };
}

function recordDistribution(data, actor) {
  assertUserActor(actor, ['owner', 'manager']);
  dbRun(`INSERT INTO investor_distributions (investor_id, amount, distribution_type, reference, notes, paid_at, recorded_by) VALUES (?,?,?,?,?,?,?)`,
    [data.investor_id, Number(data.amount) || 0, data.distribution_type || 'return', data.reference || null, data.notes || null, data.paid_at || nowIso(), actor.id]);
  auditInvestor({ investor_id: data.investor_id, user_id: actor.id, user_name: actor.full_name || actor.username, action: 'distribution_recorded' });
  return { success: true };
}

function listProposals(actor, filters = {}) {
  assertUserActor(actor, ['owner', 'manager']);
  ensureMigration();
  let sql = 'SELECT p.*, i.name AS investor_name FROM investment_proposals p LEFT JOIN investors i ON i.id = p.investor_id WHERE 1=1';
  const params = [];
  if (filters.investor_id) { sql += ' AND p.investor_id = ?'; params.push(filters.investor_id); }
  sql += ' ORDER BY p.id DESC LIMIT 100';
  return dbAll(sql, params);
}

function uploadInvestorDocument(data, actor) {
  assertUserActor(actor, ['owner', 'manager']);
  if (!data.investor_id) throw new Error('Investor required');
  const filePath = saveDocBase64(data.investor_id, data.file_name || data.title, data.file_data);
  const r = dbRun(`INSERT INTO investor_documents (investor_id, agreement_id, doc_type, title, file_path, uploaded_by) VALUES (?,?,?,?,?,?)`,
    [data.investor_id, data.agreement_id || null, data.doc_type || 'general', data.title || 'Document', filePath, actor.id]);
  auditInvestor({ investor_id: data.investor_id, user_id: actor.id, user_name: actor.full_name || actor.username, action: 'document_uploaded', entity_type: 'document', entity_id: r.lastInsertRowid });
  return dbGet('SELECT * FROM investor_documents WHERE id = ?', [r.lastInsertRowid]);
}

function investorSummary() {
  ensureMigration();
  return {
    active_investors: dbGet("SELECT COUNT(*) AS c FROM investors WHERE status = 'active'")?.c || 0,
    pending_agreements: dbGet("SELECT COUNT(*) AS c FROM investment_agreements WHERE status IN ('DRAFT','SENT','VIEWED')")?.c || 0,
    total_invested: Number(dbGet('SELECT COALESCE(SUM(investment_amount),0) AS t FROM investors WHERE status = \'active\'')?.t) || 0
  };
}

module.exports = {
  investorLogin, investorLogout, resolveInvestorSession, investorDashboard,
  listInvestors, getInvestor, saveInvestor, createInvestorPortalUser,
  saveProposal, listProposals, buildProposalPdf, saveAgreement, uploadInvestorDocument,
  recordPayment, recordDistribution, investorSummary
};

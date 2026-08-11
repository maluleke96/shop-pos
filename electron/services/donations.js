const { getDb } = require('../database/db');
const { buildExcelBuffer, buildPdfBuffer } = require('./export');

const DONATION_TYPES = ['Cash', 'Food', 'Equipment', 'Clothing', 'Services', 'Other'];
const PAYMENT_METHODS = ['Cash', 'EFT', 'Cheque', 'In-Kind', 'Other'];
const STATUSES = ['draft', 'pending_manager', 'pending_admin', 'approved', 'rejected'];

function audit(actorId, actorName, action, entityId, details) {
  getDb().prepare(`INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, details) VALUES (?,?,?,?,?,?)`)
    .run(actorId || null, actorName || 'system', action, 'donation', entityId || null, details ? JSON.stringify(details) : null);
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

function nextDonationNumber() {
  const db = getDb();
  const count = db.prepare('SELECT COUNT(*) AS c FROM donations').get().c || 0;
  const year = new Date().getFullYear();
  return `DON-${year}-${String(count + 1).padStart(5, '0')}`;
}

function requireRole(actor, roles) {
  const { assertUserActor } = require('./authz');
  return assertUserActor(actor, roles);
}

function rowWithDocs(row) {
  if (!row) return null;
  const docs = getDb().prepare('SELECT id, doc_type, file_name, mime_type, created_at FROM donation_documents WHERE donation_id = ?').all(row.id);
  return { ...row, documents: docs };
}

function getDonations(filters = {}) {
  const db = getDb();
  let sql = `SELECT d.*, e.full_name AS employee_name, u.full_name AS recorded_by_name
    FROM donations d
    LEFT JOIN employees e ON e.id = d.employee_id
    LEFT JOIN users u ON u.id = d.recorded_by WHERE 1=1`;
  const params = [];
  if (filters.status) { sql += ' AND d.status = ?'; params.push(filters.status); }
  if (filters.branch_id) { sql += ' AND d.branch_id = ?'; params.push(filters.branch_id); }
  if (filters.donation_type) { sql += ' AND d.donation_type = ?'; params.push(filters.donation_type); }
  if (filters.from) { sql += ' AND date(d.donation_date) >= date(?)'; params.push(filters.from); }
  if (filters.to) { sql += ' AND date(d.donation_date) <= date(?)'; params.push(filters.to); }
  if (filters.search) {
    sql += ' AND (d.recipient_org LIKE ? OR d.donation_number LIKE ? OR d.purpose LIKE ?)';
    const q = `%${filters.search}%`;
    params.push(q, q, q);
  }
  sql += ' ORDER BY d.donation_date DESC, d.id DESC';
  return db.prepare(sql).all(...params).map(r => rowWithDocs(r));
}

function getDonation(id) {
  const row = getDb().prepare(`
    SELECT d.*, e.full_name AS employee_name, u.full_name AS recorded_by_name
    FROM donations d LEFT JOIN employees e ON e.id = d.employee_id LEFT JOIN users u ON u.id = d.recorded_by
    WHERE d.id = ?`).get(id);
  return rowWithDocs(row);
}

function saveDonation(data, actor) {
  const user = requireRole(actor, ['owner', 'manager', 'supervisor', 'assistant_manager', 'cashier']);
  const db = getDb();
  const payload = {
    donation_date: data.donation_date || new Date().toLocaleDateString('en-CA'),
    amount: Number(data.amount) || 0,
    donation_type: data.donation_type || 'Cash',
    recipient_org: data.recipient_org || null,
    org_reg_number: data.org_reg_number || null,
    tax_ref_number: data.tax_ref_number || null,
    purpose: data.purpose || null,
    payment_method: data.payment_method || 'Cash',
    branch_id: data.branch_id || null,
    employee_id: data.employee_id || null,
    notes: data.notes || null,
    status: data.status || 'draft'
  };
  // Non-managers cannot self-approve via spoofed status
  try {
    requireRole(actor, ['owner', 'manager']);
  } catch {
    payload.status = data.id ? (getDonation(data.id)?.status || 'draft') : 'draft';
    if (!['draft', 'pending_manager'].includes(payload.status)) payload.status = 'draft';
  }
  void user;
  if (data.id) {
    const prev = getDonation(data.id);
    db.prepare(`
      UPDATE donations SET donation_date=?, amount=?, donation_type=?, recipient_org=?, org_reg_number=?,
        tax_ref_number=?, purpose=?, payment_method=?, branch_id=?, employee_id=?, notes=?, status=?
      WHERE id=?`).run(
      payload.donation_date, payload.amount, payload.donation_type, payload.recipient_org, payload.org_reg_number,
      payload.tax_ref_number, payload.purpose, payload.payment_method, payload.branch_id, payload.employee_id,
      payload.notes, payload.status, data.id
    );
    audit(actor?.id, actor?.username, 'update_donation', data.id, payload);
    return getDonation(data.id);
  }
  const num = nextDonationNumber();
  const r = db.prepare(`
    INSERT INTO donations (donation_number, donation_date, amount, donation_type, recipient_org, org_reg_number,
      tax_ref_number, purpose, payment_method, branch_id, employee_id, recorded_by, status, notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    num, payload.donation_date, payload.amount, payload.donation_type, payload.recipient_org, payload.org_reg_number,
    payload.tax_ref_number, payload.purpose, payload.payment_method, payload.branch_id, payload.employee_id,
    actor?.id || null, payload.status, payload.notes
  );
  audit(actor?.id, actor?.username, 'create_donation', r.lastInsertRowid, { donation_number: num });
  return getDonation(r.lastInsertRowid);
}

function deleteDonation(id, actor) {
  requireRole(actor, ['owner', 'manager']);
  getDb().prepare('DELETE FROM donations WHERE id = ?').run(id);
  audit(actor?.id, actor?.username, 'delete_donation', id, null);
  return true;
}

function uploadDocument(donationId, doc, actor) {
  const mime = doc.mime_type || 'application/octet-stream';
  const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
  if (!allowed.includes(mime)) throw new Error('Only PDF, JPG and PNG files are allowed');
  const r = getDb().prepare(`
    INSERT INTO donation_documents (donation_id, doc_type, file_name, file_data, mime_type, uploaded_by)
    VALUES (?,?,?,?,?,?)`).run(
    donationId, doc.doc_type || 'receipt', doc.file_name, doc.file_data || null, mime, actor?.id || null
  );
  audit(actor?.id, actor?.username, 'upload_donation_doc', donationId, { doc_id: r.lastInsertRowid, file_name: doc.file_name });
  return getDb().prepare('SELECT * FROM donation_documents WHERE id = ?').get(r.lastInsertRowid);
}

function getDocument(id) {
  return getDb().prepare('SELECT * FROM donation_documents WHERE id = ?').get(id);
}

function submitForApproval(id, actor) {
  const d = getDonation(id);
  if (!d) throw new Error('Donation not found');
  getDb().prepare('UPDATE donations SET status = ? WHERE id = ?').run('pending_manager', id);
  addNotification('donation', 'Donation pending approval', `${d.donation_number} — ${d.recipient_org || 'Unknown org'} requires manager approval`);
  audit(actor?.id, actor?.username, 'submit_donation', id, null);
  return getDonation(id);
}

function approveDonation(id, data, actor) {
  const d = getDonation(id);
  if (!d) throw new Error('Donation not found');
  const user = requireRole(actor, ['owner', 'manager']);
  const role = user.role;
  const now = new Date().toISOString();
  if (role === 'manager' || (role === 'owner' && ['pending_manager', 'draft'].includes(d.status) && data.as_manager)) {
    if (!['pending_manager', 'draft'].includes(d.status)) throw new Error('Donation is not awaiting manager approval');
    const nextStatus = data.approved ? 'pending_admin' : 'rejected';
    getDb().prepare(`
      UPDATE donations SET status=?, manager_approved_by=?, manager_approved_at=?, manager_comments=? WHERE id=?`).run(
      nextStatus, user.id, now, data.comments || null, id
    );
    if (data.approved) {
      addNotification('donation', 'Donation needs admin approval', `${d.donation_number} approved by manager — awaiting admin`);
    }
    audit(user.id, user.username, data.approved ? 'manager_approve_donation' : 'manager_reject_donation', id, data);
    return getDonation(id);
  }
  if (role === 'owner') {
    if (!['pending_admin', 'pending_manager'].includes(d.status)) throw new Error('Donation is not awaiting admin approval');
    const nextStatus = data.approved ? 'approved' : 'rejected';
    getDb().prepare(`
      UPDATE donations SET status=?, admin_approved_by=?, admin_approved_at=?, admin_comments=? WHERE id=?`).run(
      nextStatus, user.id, now, data.comments || null, id
    );
    audit(user.id, user.username, data.approved ? 'admin_approve_donation' : 'admin_reject_donation', id, data);
    return getDonation(id);
  }
  throw new Error('Insufficient permissions to approve donations');
}

function getDonationsDashboardStats(filters = {}) {
  const db = getDb();
  const from = filters.from || new Date(Date.now() - 365 * 86400000).toLocaleDateString('en-CA');
  const to = filters.to || new Date().toLocaleDateString('en-CA');
  const total = db.prepare(`
    SELECT COUNT(*) AS count, COALESCE(SUM(amount),0) AS total FROM donations
    WHERE date(donation_date) BETWEEN date(?) AND date(?) AND status = 'approved'`).get(from, to);
  const pending = db.prepare(`SELECT COUNT(*) AS c FROM donations WHERE status IN ('pending_manager','pending_admin')`).get().c;
  const byType = db.prepare(`
    SELECT donation_type, COUNT(*) AS count, COALESCE(SUM(amount),0) AS total FROM donations
    WHERE date(donation_date) BETWEEN date(?) AND date(?) AND status = 'approved'
    GROUP BY donation_type`).all(from, to);
  const taxEligible = db.prepare(`
    SELECT COUNT(*) AS count, COALESCE(SUM(amount),0) AS total FROM donations
    WHERE date(donation_date) BETWEEN date(?) AND date(?) AND status = 'approved' AND tax_ref_number IS NOT NULL AND tax_ref_number != ''`).get(from, to);
  return { total, pending, byType, taxEligible, from, to };
}

function getDonationReport(filters = {}) {
  const rows = getDonations({ ...filters, status: filters.status || undefined });
  const approved = filters.tax_eligible
    ? rows.filter(r => r.status === 'approved' && r.tax_ref_number)
    : rows.filter(r => !filters.status || r.status === filters.status);
  const byMonth = {};
  const byOrg = {};
  const byBranch = {};
  approved.forEach(r => {
    const month = (r.donation_date || '').slice(0, 7);
    if (!byMonth[month]) byMonth[month] = { count: 0, total: 0 };
    byMonth[month].count++;
    byMonth[month].total += Number(r.amount) || 0;
    const org = r.recipient_org || 'Unknown';
    if (!byOrg[org]) byOrg[org] = { count: 0, total: 0 };
    byOrg[org].count++;
    byOrg[org].total += Number(r.amount) || 0;
    const br = String(r.branch_id || 'main');
    if (!byBranch[br]) byBranch[br] = { count: 0, total: 0 };
    byBranch[br].count++;
    byBranch[br].total += Number(r.amount) || 0;
  });
  return { rows: approved, byMonth, byOrg, byBranch, summary: { count: approved.length, total: approved.reduce((s, r) => s + (Number(r.amount) || 0), 0) } };
}

function buildDonationReportPdf(filters, shopName, currency) {
  const report = getDonationReport(filters);
  const headers = ['Number', 'Date', 'Type', 'Org', 'Amount', 'Tax Ref', 'Status'];
  const rows = report.rows.map(r => [
    r.donation_number, r.donation_date, r.donation_type, r.recipient_org || '—',
    `${currency}${Number(r.amount).toFixed(2)}`, r.tax_ref_number || '—', r.status
  ]);
  return buildPdfBuffer('Donations & SARS Tax Report', headers, rows, {
    shop_name: shopName, dateRange: filters.from && filters.to ? `${filters.from} to ${filters.to}` : null
  });
}

function buildDonationReportExcel(filters) {
  const report = getDonationReport(filters);
  return buildExcelBuffer([{
    name: 'Donations',
    data: report.rows.map(r => ({
      Number: r.donation_number, Date: r.donation_date, Type: r.donation_type,
      Recipient: r.recipient_org, Amount: r.amount, 'Org Reg': r.org_reg_number,
      'Tax Ref': r.tax_ref_number, Purpose: r.purpose, Status: r.status
    }))
  }]);
}

module.exports = {
  DONATION_TYPES, PAYMENT_METHODS, STATUSES,
  getDonations, getDonation, saveDonation, deleteDonation,
  uploadDocument, getDocument, submitForApproval, approveDonation,
  getDonationsDashboardStats, getDonationReport, buildDonationReportPdf, buildDonationReportExcel
};

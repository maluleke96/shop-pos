const { getDb } = require('../database/db');
const { jsPDF } = require('jspdf');
require('jspdf-autotable');
const fs = require('fs');
const path = require('path');

function parseJson(val, fallback) {
  if (!val) return fallback;
  if (typeof val === 'object') return val;
  try { return JSON.parse(val); } catch { return fallback; }
}

function audit(userId, username, action, entityType, entityId, details) {
  try {
    getDb().prepare(`
      INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, details)
      VALUES (?,?,?,?,?,?)
    `).run(userId || null, username || null, action, entityType, entityId || null,
      details ? JSON.stringify(details) : null);
  } catch (_) { /* ignore */ }
}

function readImageBase64(filePath) {
  if (!filePath) return null;
  try {
    if (String(filePath).startsWith('data:image')) return filePath;
    if (!fs.existsSync(filePath)) return null;
    const ext = path.extname(filePath).toLowerCase().replace('.', '') || 'png';
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'jpeg' : ext === 'webp' ? 'webp' : 'png';
    return `data:image/${mime};base64,${fs.readFileSync(filePath).toString('base64')}`;
  } catch (_) {
    return null;
  }
}

function getAdminSignatureDataUrl() {
  try {
    const row = getDb().prepare('SELECT admin_signature_path FROM shop_settings WHERE id = 1').get();
    return readImageBase64(row?.admin_signature_path);
  } catch (_) {
    return null;
  }
}

function rowClaim(id) {
  const c = getDb().prepare(`
    SELECT sc.*, e.full_name as employee_name, e.employee_code, e.phone, e.email,
      u.full_name as approved_by_name
    FROM salary_claims sc
    JOIN employees e ON e.id = sc.employee_id
    LEFT JOIN users u ON u.id = sc.approved_by
    WHERE sc.id = ?
  `).get(id);
  if (!c) return null;
  c.claim_data = parseJson(c.claim_data_json, {});
  return c;
}

function listSalaryClaims(filters = {}) {
  let sql = `
    SELECT sc.*, e.full_name as employee_name, e.employee_code, e.phone,
      u.full_name as approved_by_name
    FROM salary_claims sc
    JOIN employees e ON e.id = sc.employee_id
    LEFT JOIN users u ON u.id = sc.approved_by
    WHERE 1=1`;
  const params = [];
  if (filters.employee_id) { sql += ' AND sc.employee_id = ?'; params.push(filters.employee_id); }
  if (filters.status) { sql += ' AND sc.status = ?'; params.push(filters.status); }
  if (filters.from) { sql += ' AND date(sc.period_start) >= date(?)'; params.push(filters.from); }
  if (filters.to) { sql += ' AND date(sc.period_end) <= date(?)'; params.push(filters.to); }
  sql += ' ORDER BY sc.created_at DESC, sc.id DESC';
  if (filters.limit) { sql += ' LIMIT ?'; params.push(Number(filters.limit) || 200); }
  return getDb().prepare(sql).all(...params).map((c) => {
    c.claim_data = parseJson(c.claim_data_json, {});
    return c;
  });
}

function saveSalaryClaim(data, actorId, actorName) {
  const db = getDb();
  if (!data.employee_id) throw new Error('Employee is required');
  if (!data.period_start || !data.period_end) throw new Error('Period start and end are required');
  if (!data.claim_deadline) throw new Error('Claim deadline is required — employees must claim before this date/time');
  const payload = {
    employee_id: Number(data.employee_id),
    payroll_id: data.payroll_id ? Number(data.payroll_id) : null,
    period_start: data.period_start,
    period_end: data.period_end,
    payment_date: data.payment_date || null,
    claim_deadline: data.claim_deadline,
    claim_opens_at: data.claim_opens_at || null,
    gross_amount: Number(data.gross_amount) || 0,
    net_amount: Number(data.net_amount) || 0,
    amount: Number(data.amount != null ? data.amount : data.net_amount) || 0,
    status: data.status || 'open',
    employee_notes: data.employee_notes || null,
    admin_notes: data.admin_notes || null,
    claim_data_json: JSON.stringify(data.claim_data || parseJson(data.claim_data_json, {}))
  };
  if (data.id) {
    const existing = rowClaim(data.id);
    if (!existing) throw new Error('Claim not found');
    if (existing.status === 'paid' && data.status && data.status !== 'paid') {
      throw new Error('Paid claims stay on record — edit notes only via a new claim if needed');
    }
    db.prepare(`
      UPDATE salary_claims SET employee_id=?, payroll_id=?, period_start=?, period_end=?, payment_date=?,
        claim_deadline=?, claim_opens_at=?, gross_amount=?, net_amount=?, amount=?,
        status=COALESCE(?, status), employee_notes=?, admin_notes=?, claim_data_json=?,
        updated_at=datetime('now')
      WHERE id=?
    `).run(
      payload.employee_id, payload.payroll_id, payload.period_start, payload.period_end, payload.payment_date,
      payload.claim_deadline, payload.claim_opens_at, payload.gross_amount, payload.net_amount, payload.amount,
      data.status || null, payload.employee_notes, payload.admin_notes, payload.claim_data_json, data.id
    );
    audit(actorId, actorName, 'update_salary_claim', 'salary_claim', data.id, { status: data.status });
    return rowClaim(data.id);
  }
  const r = db.prepare(`
    INSERT INTO salary_claims (
      employee_id, payroll_id, period_start, period_end, payment_date, claim_deadline, claim_opens_at,
      gross_amount, net_amount, amount, status, employee_notes, admin_notes, claim_data_json, created_by
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    payload.employee_id, payload.payroll_id, payload.period_start, payload.period_end, payload.payment_date,
    payload.claim_deadline, payload.claim_opens_at, payload.gross_amount, payload.net_amount, payload.amount,
    payload.status, payload.employee_notes, payload.admin_notes, payload.claim_data_json, actorId || null
  );
  audit(actorId, actorName, 'create_salary_claim', 'salary_claim', r.lastInsertRowid, {
    employee_id: payload.employee_id, deadline: payload.claim_deadline
  });
  return rowClaim(r.lastInsertRowid);
}

function deleteSalaryClaim(id, actorId, actorName) {
  const c = rowClaim(id);
  if (!c) throw new Error('Claim not found');
  if (c.status === 'paid') throw new Error('Cannot delete a paid claim — keep it for records');
  getDb().prepare('DELETE FROM salary_claims WHERE id = ?').run(id);
  audit(actorId, actorName, 'delete_salary_claim', 'salary_claim', id, { employee_id: c.employee_id, status: c.status });
  return { success: true };
}

function nowIso() {
  return new Date().toISOString();
}

function claimSalaryByEmployee(claimId, notes, employeeId) {
  const c = rowClaim(claimId);
  if (!c) throw new Error('Claim not found');
  if (Number(c.employee_id) !== Number(employeeId)) throw new Error('Not your salary claim');
  if (!['open', 'rejected'].includes(c.status)) {
    throw new Error(`Claim is already ${c.status}`);
  }
  const now = new Date();
  if (c.claim_opens_at && now < new Date(c.claim_opens_at)) {
    throw new Error(`Claiming opens at ${c.claim_opens_at}`);
  }
  if (c.claim_deadline && now > new Date(c.claim_deadline)) {
    throw new Error(`Claim deadline passed (${c.claim_deadline}). Contact admin.`);
  }
  getDb().prepare(`
    UPDATE salary_claims SET status='claimed', claimed_at=?, employee_notes=?, updated_at=datetime('now')
    WHERE id=?
  `).run(nowIso(), notes || c.employee_notes || null, claimId);
  audit(null, `employee:${employeeId}`, 'employee_claim_salary', 'salary_claim', claimId, null);
  try {
    require('./store').addNotification?.('salary_claim', 'Salary claim submitted',
      `${c.employee_name} claimed salary for ${c.period_start} – ${c.period_end}`, {
        entity_type: 'salary_claim',
        entity_id: claimId,
        action_page: 'admin:payroll',
        audience_roles: ['owner', 'manager']
      });
  } catch (_) { /* ignore */ }
  return rowClaim(claimId);
}

function approveSalaryClaim(claimId, adminNotes, actorId, actorName) {
  const c = rowClaim(claimId);
  if (!c) throw new Error('Claim not found');
  if (!['claimed', 'open'].includes(c.status)) {
    throw new Error(`Cannot approve a claim with status ${c.status}`);
  }
  const sig = getAdminSignatureDataUrl();
  if (!sig) {
    throw new Error('Upload an admin signature first (Admin → Operations → Admin signature)');
  }
  getDb().prepare(`
    UPDATE salary_claims SET status='approved', approved_at=?, approved_by=?, admin_notes=?,
      signature_snapshot=?, updated_at=datetime('now')
    WHERE id=?
  `).run(nowIso(), actorId, adminNotes != null ? adminNotes : c.admin_notes, sig, claimId);
  audit(actorId, actorName, 'approve_salary_claim', 'salary_claim', claimId, null);
  return rowClaim(claimId);
}

function rejectSalaryClaim(claimId, adminNotes, actorId, actorName) {
  const c = rowClaim(claimId);
  if (!c) throw new Error('Claim not found');
  if (!['claimed', 'open', 'approved'].includes(c.status)) {
    throw new Error(`Cannot reject a claim with status ${c.status}`);
  }
  getDb().prepare(`
    UPDATE salary_claims SET status='rejected', rejected_at=?, rejected_by=?, admin_notes=?,
      updated_at=datetime('now')
    WHERE id=?
  `).run(nowIso(), actorId, adminNotes || c.admin_notes, claimId);
  audit(actorId, actorName, 'reject_salary_claim', 'salary_claim', claimId, null);
  return rowClaim(claimId);
}

function markSalaryClaimPaid(claimId, actorId, actorName) {
  const c = rowClaim(claimId);
  if (!c) throw new Error('Claim not found');
  if (c.status !== 'approved') throw new Error('Approve the claim before marking paid');
  getDb().prepare(`
    UPDATE salary_claims SET status='paid', paid_at=?, updated_at=datetime('now') WHERE id=?
  `).run(nowIso(), claimId);
  if (c.payroll_id) {
    try {
      getDb().prepare(`UPDATE employee_payroll SET status='paid', paid_at=datetime('now'), payment_method=COALESCE(payment_method,'claim') WHERE id=? AND status!='paid'`)
        .run(c.payroll_id);
    } catch (_) { /* ignore */ }
  }
  audit(actorId, actorName, 'pay_salary_claim', 'salary_claim', claimId, { payroll_id: c.payroll_id });
  return rowClaim(claimId);
}

function buildSalaryClaimPdf(claimId, shopSettings) {
  const c = rowClaim(claimId);
  if (!c) throw new Error('Claim not found');
  const s = shopSettings || {};
  const currency = s.currency || 'R';
  const doc = new jsPDF();
  doc.setFontSize(16);
  doc.text(s.shop_name || 'Shop POS', 105, 18, { align: 'center' });
  doc.setFontSize(13);
  doc.text('Salary Claim / Payment Advice', 105, 28, { align: 'center' });
  doc.setFontSize(10);
  const rows = [
    ['Employee', c.employee_name || '—'],
    ['Employee code', c.employee_code || '—'],
    ['Period', `${c.period_start} – ${c.period_end}`],
    ['Payment date', c.payment_date || '—'],
    ['Claim deadline', c.claim_deadline || '—'],
    ['Gross', `${currency} ${Number(c.gross_amount || 0).toFixed(2)}`],
    ['Net / Claim amount', `${currency} ${Number(c.amount || c.net_amount || 0).toFixed(2)}`],
    ['Status', String(c.status || '').toUpperCase()],
    ['Claimed at', c.claimed_at || '—'],
    ['Approved at', c.approved_at || '—'],
    ['Approved by', c.approved_by_name || '—'],
    ['Employee notes', c.employee_notes || '—'],
    ['Admin notes', c.admin_notes || '—']
  ];
  doc.autoTable({
    startY: 36,
    head: [['Field', 'Value']],
    body: rows,
    theme: 'grid',
    styles: { fontSize: 10 }
  });
  let y = (doc.lastAutoTable?.finalY || 120) + 16;
  doc.setFontSize(11);
  doc.text('Authorised signature', 14, y);
  y += 4;
  const sig = c.signature_snapshot || getAdminSignatureDataUrl();
  if (sig) {
    try {
      doc.addImage(sig, 'PNG', 14, y, 50, 20);
      y += 24;
    } catch (_) {
      y += 8;
    }
  } else {
    doc.setFontSize(9);
    doc.text('(No admin signature on file)', 14, y + 8);
    y += 16;
  }
  doc.setFontSize(8);
  doc.text(`Generated ${new Date().toLocaleString()} · Claim #${c.id}`, 14, Math.min(y + 10, 285));
  return doc.output('arraybuffer');
}

function createClaimsFromPayroll(periodStart, periodEnd, claimDeadline, paymentDate, claimOpensAt, actorId, actorName) {
  if (!claimDeadline) throw new Error('Claim deadline is required');
  const db = getDb();
  const payrollRows = db.prepare(`
    SELECT * FROM employee_payroll
    WHERE date(period_start)=date(?) AND date(period_end)=date(?)
  `).all(periodStart, periodEnd);
  if (!payrollRows.length) {
    throw new Error('No payroll rows for that period — generate payroll first');
  }
  const created = [];
  for (const p of payrollRows) {
    const existing = db.prepare(`
      SELECT id FROM salary_claims
      WHERE employee_id=? AND date(period_start)=date(?) AND date(period_end)=date(?)
        AND status IN ('open','claimed','approved')
      LIMIT 1
    `).get(p.employee_id, periodStart, periodEnd);
    if (existing) continue;
    created.push(saveSalaryClaim({
      employee_id: p.employee_id,
      payroll_id: p.id,
      period_start: periodStart,
      period_end: periodEnd,
      payment_date: paymentDate || null,
      claim_deadline: claimDeadline,
      claim_opens_at: claimOpensAt || null,
      gross_amount: p.gross_salary,
      net_amount: p.net_salary,
      amount: p.net_salary,
      status: 'open'
    }, actorId, actorName));
  }
  return created;
}

module.exports = {
  listSalaryClaims,
  getSalaryClaim: rowClaim,
  saveSalaryClaim,
  deleteSalaryClaim,
  claimSalaryByEmployee,
  approveSalaryClaim,
  rejectSalaryClaim,
  markSalaryClaimPaid,
  buildSalaryClaimPdf,
  createClaimsFromPayroll,
  getAdminSignatureDataUrl
};

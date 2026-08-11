const fs = require('fs');
const path = require('path');
const { getDb, getDbPathForBackup } = require('../database/db');
const { jsPDF } = require('jspdf');
require('jspdf-autotable');

function getShopPdfSettings() {
  return getDb().prepare(`
    SELECT shop_name, address, phone, email, logo_path, currency, admin_signature_path
    FROM shop_settings WHERE id = 1`).get() || {};
}

function readImageBase64(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    const ext = path.extname(filePath).toLowerCase();
    const fmt = ext === '.png' ? 'PNG' : 'JPEG';
    return { data: fs.readFileSync(filePath).toString('base64'), format: fmt };
  } catch {
    return null;
  }
}

function drawPdfLetterhead(doc, shop, title, subtitle) {
  let y = 16;
  doc.setFontSize(18);
  doc.setFont(undefined, 'bold');
  doc.text(shop.shop_name || 'Company', 105, y, { align: 'center' });
  y += 8;
  doc.setFontSize(9);
  doc.setFont(undefined, 'normal');
  [shop.address, shop.phone ? `Tel: ${shop.phone}` : null, shop.email].filter(Boolean).forEach(line => {
    doc.text(line, 105, y, { align: 'center' });
    y += 4;
  });
  y += 4;
  doc.setDrawColor(180);
  doc.line(14, y, 196, y);
  y += 10;
  doc.setFontSize(14);
  doc.setFont(undefined, 'bold');
  doc.text(title, 14, y);
  y += 7;
  if (subtitle) {
    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    doc.text(subtitle, 14, y);
    y += 6;
  }
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text(`Generated: ${new Date().toLocaleString()}`, 14, y);
  doc.setTextColor(0);
  return y + 8;
}

function addPdfSignatureBlock(doc, startY, shop, label = 'Administrator') {
  let y = startY + 12;
  if (y > 235) { doc.addPage(); y = 24; }
  doc.setFontSize(10);
  doc.setFont(undefined, 'bold');
  doc.text('AUTHORISATION', 14, y);
  y += 10;
  doc.setFont(undefined, 'normal');
  const sigImg = readImageBase64(shop.admin_signature_path);
  doc.text(label, 14, y);
  y += 4;
  const lineY = y + 18;
  if (sigImg) {
    try { doc.addImage(sigImg.data, sigImg.format, 14, y, 52, 18); } catch (_) {
      doc.line(14, lineY, 66, lineY);
    }
  } else {
    doc.line(14, lineY, 66, lineY);
  }
  y = lineY + 6;
  doc.setFontSize(8);
  doc.text('Signature', 14, y);
  y += 10;
  doc.setFontSize(10);
  doc.text(`Date: ${new Date().toLocaleDateString()}`, 14, y);
  return y + 8;
}

function hrAssetsDir(sub = 'hr') {
  const dir = path.join(path.dirname(getDbPathForBackup()), 'assets', sub);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function savePdfBuffer(buf, prefix) {
  const file = path.join(hrAssetsDir('hr'), `${prefix}-${Date.now()}.pdf`);
  fs.writeFileSync(file, Buffer.from(buf));
  return file;
}

function saveProofImage(imageData, leaveId) {
  if (!imageData) throw new Error('Image data required');
  const dir = hrAssetsDir('hr-proofs');
  let ext = '.jpg';
  let raw = imageData;
  const match = String(imageData).match(/^data:image\/(\w+);base64,(.+)$/);
  if (match) {
    ext = match[1] === 'png' ? '.png' : '.jpg';
    raw = match[2];
  }
  const file = path.join(dir, `leave-${leaveId}-${Date.now()}${ext}`);
  fs.writeFileSync(file, Buffer.from(raw, 'base64'));
  return file;
}

function buildLeaveApprovalPdf(leave, shop, approverName) {
  const doc = new jsPDF();
  let y = drawPdfLetterhead(doc, shop, 'LEAVE APPROVAL', `${leave.leave_type} — Approved`);
  doc.setFontSize(11);
  const rows = [
    ['Employee', `${leave.full_name} (${leave.employee_code || ''})`],
    ['Leave Type', leave.leave_type],
    ['Start Date', leave.start_date],
    ['End Date', leave.end_date || leave.start_date],
    ['Days', String(leave.days ?? 1)],
    ['Status', 'APPROVED'],
    ['Approved By', approverName || 'Management'],
    ['Approved At', leave.approved_at || new Date().toLocaleString()]
  ];
  if (leave.notes) rows.push(['Notes', leave.notes]);
  doc.autoTable({ startY: y, head: [['Field', 'Value']], body: rows, theme: 'plain' });
  y = doc.lastAutoTable.finalY + 8;
  doc.text('This document confirms approved leave as requested above.', 14, y, { maxWidth: 180 });
  addPdfSignatureBlock(doc, y + 8, shop);
  return doc.output('arraybuffer');
}

function buildDisciplinaryPdf(record, shop, copyType = 'staff') {
  const doc = new jsPDF();
  const typeLabel = record.record_type || 'Disciplinary Record';
  const copyLabel = copyType === 'admin' ? 'Management Copy' : 'Employee Copy';
  let y = drawPdfLetterhead(doc, shop, typeLabel.toUpperCase(), copyLabel);
  doc.setFontSize(11);
  const body = [
    ['Employee', `${record.full_name} (${record.employee_code || ''})`],
    ['Incident Date', record.incident_date || '—'],
    ['Record Type', record.record_type || '—'],
    ['Status', record.status || 'open']
  ];
  if (record.action_taken) body.push(['Action Taken', record.action_taken]);
  doc.autoTable({ startY: y, head: [['Field', 'Value']], body, theme: 'plain' });
  y = doc.lastAutoTable.finalY + 10;
  doc.setFont(undefined, 'bold');
  doc.text('Description / Details', 14, y);
  y += 6;
  doc.setFont(undefined, 'normal');
  doc.setFontSize(10);
  const desc = record.description || '—';
  doc.text(desc, 14, y, { maxWidth: 180 });
  y += Math.max(12, Math.ceil(desc.length / 70) * 5) + 8;
  if (record.notes) {
    doc.setFont(undefined, 'bold');
    doc.text('Additional Notes', 14, y);
    y += 6;
    doc.setFont(undefined, 'normal');
    doc.text(record.notes, 14, y, { maxWidth: 180 });
    y += 16;
  }
  if (record.worker_response) {
    doc.setFont(undefined, 'bold');
    doc.text('Employee Response', 14, y);
    y += 6;
    doc.setFont(undefined, 'normal');
    doc.text(record.worker_response, 14, y, { maxWidth: 180 });
    if (record.worker_response_at) {
      y += 14;
      doc.setFontSize(9);
      doc.setTextColor(100);
      doc.text(`Submitted: ${record.worker_response_at}`, 14, y);
      doc.setTextColor(0);
    }
    y += 12;
  }
  if (copyType === 'admin') {
    addPdfSignatureBlock(doc, y, shop, 'Authorised Manager');
  } else {
    y += 20;
    doc.line(14, y, 90, y);
    doc.setFontSize(9);
    doc.text('Employee acknowledgement signature', 14, y + 6);
  }
  return doc.output('arraybuffer');
}

function getCustomerPhoneReport(filters = {}) {
  const db = getDb();
  const from = filters.from || null;
  const to = filters.to || null;
  let sql = `
    SELECT c.id, c.name, c.phone, c.email, c.loyalty_points,
      MAX(s.created_at) AS last_visit,
      COALESCE(SUM(s.total), 0) AS total_spent,
      COUNT(s.id) AS visit_count
    FROM customers c
    LEFT JOIN sales s ON s.customer_id = c.id AND s.status = 'completed'`;
  const params = [];
  if (from) { sql += ' AND date(s.created_at) >= date(?)'; params.push(from); }
  if (to) { sql += ' AND date(s.created_at) <= date(?)'; params.push(to); }
  sql += `
    WHERE c.phone IS NOT NULL AND TRIM(c.phone) != ''
    GROUP BY c.id
    ORDER BY last_visit DESC, c.name`;
  const rows = db.prepare(sql).all(...params);
  if (from || to) return rows.filter(r => (r.visit_count || 0) > 0);
  return rows;
}

function buildCustomerPhoneReportPdf(rows, shop, from, to, currency) {
  const doc = new jsPDF({ orientation: 'landscape' });
  let y = drawPdfLetterhead(doc, shop, 'Customer WhatsApp Numbers', `${from || 'All time'} → ${to || 'Today'}`);
  doc.autoTable({
    startY: y,
    head: [['Name', 'Phone', 'Email', 'Last Visit', 'Visits', `Total Spent (${currency || 'R'})`, 'Loyalty Pts']],
    body: rows.map(r => [
      r.name,
      r.phone,
      r.email || '—',
      r.last_visit ? String(r.last_visit).slice(0, 10) : '—',
      String(r.visit_count || 0),
      `${currency || 'R'}${Number(r.total_spent || 0).toFixed(2)}`,
      String(r.loyalty_points || 0)
    ])
  });
  return doc.output('arraybuffer');
}

module.exports = {
  getShopPdfSettings,
  savePdfBuffer,
  saveProofImage,
  buildLeaveApprovalPdf,
  buildDisciplinaryPdf,
  getCustomerPhoneReport,
  buildCustomerPhoneReportPdf
};

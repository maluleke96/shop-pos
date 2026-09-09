/** Save and serve expense invoice / receipt photos. */
const path = require('path');
const fs = require('fs');
const { mimeFromExt } = require('./product-images');

function dataRoot() {
  try {
    const db = require('../electron/database/db');
    return path.dirname(db.getDbPathForBackup?.() || db.getDbPath?.() || path.join(process.cwd(), 'data'));
  } catch (_) {
    return path.join(process.cwd(), 'data');
  }
}

function expenseDocDir(expenseId) {
  return path.join(dataRoot(), 'expense-docs', String(expenseId));
}

function saveDataUrl(expenseId, dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const m = dataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
  if (!m) return null;
  const ext = m[1].includes('png') ? '.png' : m[1].includes('webp') ? '.webp' : '.jpg';
  const dir = expenseDocDir(expenseId);
  fs.mkdirSync(dir, { recursive: true });
  const filename = `invoice${ext}`;
  const full = path.join(dir, filename);
  fs.writeFileSync(full, Buffer.from(m[2], 'base64'));
  return `expense-docs/${expenseId}/${filename}`;
}

function getExpenseInvoice(expenseId) {
  const dir = expenseDocDir(expenseId);
  for (const ext of ['.jpg', '.jpeg', '.png', '.webp']) {
    const full = path.join(dir, `invoice${ext}`);
    if (fs.existsSync(full)) {
      return { path: full, mime: mimeFromExt(ext) };
    }
  }
  throw new Error('Invoice not found');
}

function publicInvoiceUrl(expenseId) {
  if (!expenseId) return null;
  return `/api/expense-invoice/${expenseId}`;
}

function resolveInvoiceUrl(expense) {
  if (!expense?.id) return null;
  if (expense.invoice_path) return publicInvoiceUrl(expense.id);
  return null;
}

module.exports = {
  saveDataUrl,
  getExpenseInvoice,
  publicInvoiceUrl,
  resolveInvoiceUrl,
  dataRoot
};

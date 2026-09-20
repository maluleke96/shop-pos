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

function parseDataUrl(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const m = dataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
  if (!m) return null;
  return { mime: m[1], base64: m[2] };
}

function extFromMime(mime) {
  const m = String(mime || '');
  if (m.includes('png')) return '.png';
  if (m.includes('webp')) return '.webp';
  return '.jpg';
}

function getDb() {
  return require('../electron/database/db').getDb();
}

function ensureInvoiceStore() {
  const db = getDb();
  try { db.exec('ALTER TABLE expenses ADD COLUMN invoice_path TEXT'); } catch (_) { /* exists */ }
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS expense_invoices (
        expense_id INTEGER PRIMARY KEY,
        mime TEXT,
        data_base64 TEXT NOT NULL
      )
    `);
  } catch (_) { /* exists */ }
}

function saveInvoiceToDb(expenseId, parsed) {
  if (!expenseId || !parsed?.base64) return false;
  ensureInvoiceStore();
  const db = getDb();
  try {
    db.prepare('DELETE FROM expense_invoices WHERE expense_id = ?').run(expenseId);
    db.prepare('INSERT INTO expense_invoices (expense_id, mime, data_base64) VALUES (?,?,?)')
      .run(expenseId, parsed.mime || 'image/jpeg', parsed.base64);
    return true;
  } catch (err) {
    console.warn('[expense-docs] invoice db persist failed', err.message || err);
    return false;
  }
}

function saveDataUrl(expenseId, dataUrl) {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return null;
  const ext = extFromMime(parsed.mime);
  const rel = `expense-docs/${expenseId}/invoice${ext}`;
  try {
    const dir = expenseDocDir(expenseId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `invoice${ext}`), Buffer.from(parsed.base64, 'base64'));
  } catch (err) {
    console.warn('[expense-docs] invoice file save failed', err.message || err);
  }
  saveInvoiceToDb(expenseId, parsed);
  return rel;
}

function invoiceFromDb(expenseId) {
  const db = getDb();
  try {
    const row = db.prepare('SELECT mime, data_base64 FROM expense_invoices WHERE expense_id = ?').get(expenseId);
    if (row?.data_base64) {
      return { buffer: Buffer.from(row.data_base64, 'base64'), mime: row.mime || 'image/jpeg' };
    }
  } catch (_) { /* table may not exist yet */ }
  try {
    const row = db.prepare('SELECT invoice_path, invoice_data FROM expenses WHERE id = ?').get(expenseId);
    if (row?.invoice_path) {
      const abs = path.isAbsolute(row.invoice_path)
        ? row.invoice_path
        : path.join(dataRoot(), row.invoice_path);
      if (fs.existsSync(abs)) {
        return { path: abs, mime: mimeFromExt(path.extname(abs) || '.jpg') };
      }
    }
    const parsed = parseDataUrl(row?.invoice_data);
    if (parsed) {
      return { buffer: Buffer.from(parsed.base64, 'base64'), mime: parsed.mime };
    }
  } catch (_) { /* column may not exist */ }
  return null;
}

function getExpenseInvoice(expenseId) {
  const dir = expenseDocDir(expenseId);
  for (const ext of ['.jpg', '.jpeg', '.png', '.webp']) {
    const full = path.join(dir, `invoice${ext}`);
    if (fs.existsSync(full)) {
      return { path: full, mime: mimeFromExt(ext) };
    }
  }
  const fromDb = invoiceFromDb(expenseId);
  if (fromDb) return fromDb;
  throw new Error('Invoice not found');
}

function publicInvoiceUrl(expenseId) {
  if (!expenseId) return null;
  return `/api/expense-invoice/${expenseId}`;
}

function hasInvoice(expense) {
  if (!expense) return false;
  if (expense.has_invoice === true || expense.has_invoice === 1) return true;
  if (expense.invoice_path || expense.invoice_data || expense.invoice_url) return true;
  return false;
}

function resolveInvoiceUrl(expense) {
  if (!expense?.id) return null;
  if (hasInvoice(expense)) return publicInvoiceUrl(expense.id);
  return null;
}

module.exports = {
  saveDataUrl,
  getExpenseInvoice,
  publicInvoiceUrl,
  resolveInvoiceUrl,
  hasInvoice,
  ensureInvoiceStore,
  dataRoot
};

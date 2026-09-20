/**
 * Expense smart features: budgets, recurring, owner funding, OCR parse helpers.
 */
const { getDb } = require('../database/db');

function ensureExpenseExtrasSchema() {
  const db = getDb();
  const alters = [
    'ALTER TABLE expenses ADD COLUMN vendor_name TEXT',
    'ALTER TABLE expenses ADD COLUMN purchase_order_id INTEGER',
    'ALTER TABLE expenses ADD COLUMN funding_source TEXT DEFAULT \'business\'',
    'ALTER TABLE expenses ADD COLUMN receipt_ocr_text TEXT'
  ];
  for (const sql of alters) {
    try { db.prepare(sql).run(); } catch (_) { /* exists */ }
  }
  db.prepare(`CREATE TABLE IF NOT EXISTS expense_budgets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    month_key TEXT NOT NULL,
    amount REAL NOT NULL DEFAULT 0,
    branch_id INTEGER,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(category, month_key, branch_id)
  )`).run();
  db.prepare(`CREATE TABLE IF NOT EXISTS expense_recurring (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    amount REAL NOT NULL,
    vendor_name TEXT,
    payment_method TEXT DEFAULT 'eft',
    funding_source TEXT DEFAULT 'business',
    day_of_month INTEGER DEFAULT 1,
    next_due TEXT,
    is_active INTEGER DEFAULT 1,
    notes TEXT,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    last_posted_at TEXT,
    last_expense_id INTEGER
  )`).run();
  db.prepare(`CREATE TABLE IF NOT EXISTS owner_fundings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    funding_date TEXT NOT NULL,
    amount REAL NOT NULL,
    funding_type TEXT NOT NULL DEFAULT 'purchase',
    description TEXT,
    expense_id INTEGER,
    payment_method TEXT,
    vendor_name TEXT,
    category TEXT,
    created_by INTEGER,
    created_by_name TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    notes TEXT
  )`).run();
}

function monthKey(d = new Date()) {
  const x = typeof d === 'string' ? new Date(d.slice(0, 10) + 'T12:00:00') : d;
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`;
}

function todayStr() {
  return new Date().toLocaleDateString('en-CA');
}

/** Parse pasted receipt / OCR text into amount, date, vendor hints */
function parseReceiptText(text) {
  const raw = String(text || '');
  const out = { amount: null, expense_date: null, vendor_name: null, hints: [] };
  if (!raw.trim()) return out;

  // Amounts: R123.45 / 123,45 / TOTAL 123.45
  const amountMatches = [...raw.matchAll(/(?:R|ZAR|TOTAL|AMT|AMOUNT)[^\d]{0,12}(\d[\d\s]*[.,]\d{2})/gi)];
  const plainAmounts = [...raw.matchAll(/\b(\d{1,6}[.,]\d{2})\b/g)];
  const pick = amountMatches[amountMatches.length - 1] || plainAmounts[plainAmounts.length - 1];
  if (pick) {
    out.amount = Math.round(parseFloat(String(pick[1]).replace(/\s/g, '').replace(',', '.')) * 100) / 100;
    out.hints.push(`Amount ${out.amount}`);
  }

  const dateMatch = raw.match(/\b(\d{4}[-/]\d{2}[-/]\d{2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4})\b/);
  if (dateMatch) {
    let d = dateMatch[1].replace(/\//g, '-');
    const parts = d.split('-');
    if (parts[0].length === 4) out.expense_date = d;
    else if (parts.length === 3) {
      const [a, b, c] = parts;
      const y = c.length === 2 ? `20${c}` : c;
      out.expense_date = `${y}-${a.padStart(2, '0')}-${b.padStart(2, '0')}`;
    }
    if (out.expense_date) out.hints.push(`Date ${out.expense_date}`);
  }

  const firstLine = raw.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 2 && !/total|amount|vat|tax/i.test(l));
  if (firstLine) {
    out.vendor_name = firstLine.slice(0, 80);
    out.hints.push(`Vendor ${out.vendor_name}`);
  }
  return out;
}

function listBudgets(filters = {}) {
  ensureExpenseExtrasSchema();
  const mk = filters.month_key || monthKey();
  return getDb().prepare(`
    SELECT * FROM expense_budgets WHERE month_key = ? ORDER BY category
  `).all(mk);
}

function saveBudget(data, actor) {
  ensureExpenseExtrasSchema();
  const category = String(data.category || '').trim();
  const amount = Math.round((Number(data.amount) || 0) * 100) / 100;
  const month_key = data.month_key || monthKey();
  if (!category) throw new Error('Category required');
  if (!(amount >= 0)) throw new Error('Budget amount invalid');
  const db = getDb();
  const existing = db.prepare(`
    SELECT id FROM expense_budgets WHERE category = ? AND month_key = ? AND (branch_id IS ? OR (branch_id IS NULL AND ? IS NULL))
  `).get(category, month_key, data.branch_id || null, data.branch_id || null);
  if (existing) {
    db.prepare('UPDATE expense_budgets SET amount = ? WHERE id = ?').run(amount, existing.id);
    return db.prepare('SELECT * FROM expense_budgets WHERE id = ?').get(existing.id);
  }
  const r = db.prepare(`
    INSERT INTO expense_budgets (category, month_key, amount, branch_id, created_by) VALUES (?,?,?,?,?)
  `).run(category, month_key, amount, data.branch_id || null, actor?.id || null);
  return db.prepare('SELECT * FROM expense_budgets WHERE id = ?').get(r.lastInsertRowid);
}

function deleteBudget(id) {
  ensureExpenseExtrasSchema();
  getDb().prepare('DELETE FROM expense_budgets WHERE id = ?').run(id);
  return { ok: true };
}

function listRecurring() {
  ensureExpenseExtrasSchema();
  return getDb().prepare('SELECT * FROM expense_recurring ORDER BY is_active DESC, name').all();
}

function saveRecurring(data, actor) {
  ensureExpenseExtrasSchema();
  const name = String(data.name || '').trim();
  const category = String(data.category || '').trim();
  const amount = Math.round((Number(data.amount) || 0) * 100) / 100;
  if (!name || !category || !(amount > 0)) throw new Error('Name, category and amount required');
  const day = Math.min(28, Math.max(1, parseInt(data.day_of_month, 10) || 1));
  let next_due = data.next_due;
  if (!next_due) {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    next_due = new Date(y, m, day).toLocaleDateString('en-CA');
    if (next_due < todayStr()) next_due = new Date(y, m + 1, day).toLocaleDateString('en-CA');
  }
  const db = getDb();
  if (data.id) {
    db.prepare(`UPDATE expense_recurring SET name=?, category=?, amount=?, vendor_name=?, payment_method=?,
      funding_source=?, day_of_month=?, next_due=?, is_active=?, notes=? WHERE id=?`).run(
      name, category, amount, data.vendor_name || null, data.payment_method || 'eft',
      data.funding_source || 'business', day, next_due, data.is_active === 0 ? 0 : 1, data.notes || null, data.id
    );
    return db.prepare('SELECT * FROM expense_recurring WHERE id = ?').get(data.id);
  }
  const r = db.prepare(`INSERT INTO expense_recurring
    (name, category, amount, vendor_name, payment_method, funding_source, day_of_month, next_due, is_active, notes, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    name, category, amount, data.vendor_name || null, data.payment_method || 'eft',
    data.funding_source || 'business', day, next_due, 1, data.notes || null, actor?.id || null
  );
  return db.prepare('SELECT * FROM expense_recurring WHERE id = ?').get(r.lastInsertRowid);
}

function deleteRecurring(id) {
  ensureExpenseExtrasSchema();
  getDb().prepare('DELETE FROM expense_recurring WHERE id = ?').run(id);
  return { ok: true };
}

function postDueRecurring(actor, saveExpenseFn) {
  ensureExpenseExtrasSchema();
  const due = getDb().prepare(`
    SELECT * FROM expense_recurring WHERE is_active = 1 AND next_due IS NOT NULL AND date(next_due) <= date('now','localtime')
  `).all();
  const posted = [];
  for (const row of due) {
    const exp = saveExpenseFn({
      category: row.category,
      description: `Recurring: ${row.name}${row.notes ? ` — ${row.notes}` : ''}`,
      amount: row.amount,
      expense_date: row.next_due || todayStr(),
      payment_method: row.payment_method || 'eft',
      vendor_name: row.vendor_name || null,
      funding_source: row.funding_source || 'business'
    }, actor?.id, actor?.full_name || actor?.username);
    const expenseId = typeof exp === 'object' && exp != null
      ? (exp.id || exp.expenseId || exp.expense_id)
      : exp;
    const next = new Date((row.next_due || todayStr()) + 'T12:00:00');
    next.setMonth(next.getMonth() + 1);
    const nextDue = next.toLocaleDateString('en-CA');
    getDb().prepare(`UPDATE expense_recurring SET last_posted_at=datetime('now'), last_expense_id=?, next_due=? WHERE id=?`)
      .run(expenseId || null, nextDue, row.id);
    posted.push({ recurring_id: row.id, expense_id: expenseId, name: row.name });
  }
  return { posted, count: posted.length };
}

function recordOwnerFunding(data, actor) {
  ensureExpenseExtrasSchema();
  const amount = Math.round((Number(data.amount) || 0) * 100) / 100;
  if (!(amount > 0)) throw new Error('Amount required');
  const funding_type = data.funding_type === 'cash_injection' ? 'cash_injection' : 'purchase';
  const funding_date = data.funding_date || todayStr();
  const description = String(data.description || '').trim()
    || (funding_type === 'cash_injection' ? 'Owner cash into business' : 'Owner-funded purchase');
  const r = getDb().prepare(`INSERT INTO owner_fundings
    (funding_date, amount, funding_type, description, expense_id, payment_method, vendor_name, category, created_by, created_by_name, notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    funding_date, amount, funding_type, description,
    data.expense_id || null, data.payment_method || null, data.vendor_name || null, data.category || null,
    actor?.id || null, actor?.full_name || actor?.username || null, data.notes || null
  );
  try {
    getDb().prepare('INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, details) VALUES (?,?,?,?,?,?)')
      .run(actor?.id || null, actor?.full_name || actor?.username || null, 'owner_funding', 'owner_funding', r.lastInsertRowid,
        JSON.stringify({ amount, funding_type, description }));
  } catch (_) { /* */ }
  return getDb().prepare('SELECT * FROM owner_fundings WHERE id = ?').get(r.lastInsertRowid);
}

function listOwnerFundings(filters = {}) {
  ensureExpenseExtrasSchema();
  let sql = 'SELECT * FROM owner_fundings WHERE 1=1';
  const params = [];
  if (filters.from) { sql += ' AND funding_date >= ?'; params.push(filters.from); }
  if (filters.to) { sql += ' AND funding_date <= ?'; params.push(filters.to); }
  sql += ' ORDER BY funding_date DESC, id DESC LIMIT ?';
  params.push(Math.min(Number(filters.limit) || 200, 1000));
  return getDb().prepare(sql).all(...params);
}

function budgetStatus(month_key) {
  ensureExpenseExtrasSchema();
  const mk = month_key || monthKey();
  const budgets = listBudgets({ month_key: mk });
  const from = `${mk}-01`;
  const to = todayStr();
  const spent = getDb().prepare(`
    SELECT category, COALESCE(SUM(amount),0) as total FROM expenses
    WHERE expense_date >= ? AND expense_date <= ?
    GROUP BY category
  `).all(from, to);
  const spentMap = Object.fromEntries(spent.map((s) => [String(s.category || '').toLowerCase(), Number(s.total) || 0]));
  return budgets.map((b) => {
    const used = spentMap[String(b.category).toLowerCase()] || 0;
    const cap = Number(b.amount) || 0;
    const pct = cap > 0 ? Math.round((used / cap) * 1000) / 10 : 0;
    return {
      ...b,
      spent: used,
      remaining: Math.round((cap - used) * 100) / 100,
      pct,
      status: pct >= 100 ? 'over' : pct >= 80 ? 'warn' : 'ok'
    };
  });
}

module.exports = {
  ensureExpenseExtrasSchema,
  parseReceiptText,
  listBudgets,
  saveBudget,
  deleteBudget,
  listRecurring,
  saveRecurring,
  deleteRecurring,
  postDueRecurring,
  recordOwnerFunding,
  listOwnerFundings,
  budgetStatus,
  monthKey
};

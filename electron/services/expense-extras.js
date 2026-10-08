/**
 * Expense smart features: budgets, recurring, owner funding, OCR parse helpers.
 */
const { getDb, isPgMode } = require('../database/db');

let _schemaDb = null;
let _altersDb = null;

function expenseAltersNeeded(db) {
  if (_altersDb !== db) return true;
  // Postgres: ALTER takes an exclusive table lock, so only once per process.
  if (isPgMode()) return false;
  // Local SQLite: a table rebuild migration can drop the added columns mid-session.
  try {
    return !db.prepare('PRAGMA table_info(expenses)').all().some((c) => c.name === 'cash_source');
  } catch (_) {
    return true;
  }
}

function ensureExpenseExtrasSchema() {
  const db = getDb();
  if (expenseAltersNeeded(db)) {
    const alters = [
      'ALTER TABLE expenses ADD COLUMN vendor_name TEXT',
      'ALTER TABLE expenses ADD COLUMN purchase_order_id INTEGER',
      'ALTER TABLE expenses ADD COLUMN funding_source TEXT DEFAULT \'business\'',
      'ALTER TABLE expenses ADD COLUMN receipt_ocr_text TEXT',
      'ALTER TABLE expenses ADD COLUMN cash_source TEXT'
    ];
    for (const sql of alters) {
      try { db.prepare(sql).run(); } catch (_) { /* exists */ }
    }
    _altersDb = db;
  }
  if (_schemaDb && _schemaDb === db) return;
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
  db.prepare(`CREATE TABLE IF NOT EXISTS owner_withdrawals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    withdrawal_date TEXT NOT NULL,
    amount REAL NOT NULL,
    purpose TEXT,
    taken_by TEXT,
    given_by TEXT,
    authorised_by TEXT,
    cash_source TEXT DEFAULT 'today',
    payment_method TEXT DEFAULT 'cash',
    branch_id INTEGER,
    notes TEXT,
    client_request_id TEXT,
    created_by INTEGER,
    created_by_name TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`).run();
  db.prepare(`CREATE TABLE IF NOT EXISTS expense_app_requests (
    client_request_id TEXT PRIMARY KEY,
    method TEXT,
    user_id INTEGER,
    result_json TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`).run();
  _schemaDb = db;
}

function normCashSource(v) {
  return String(v || 'today').toLowerCase() === 'previous' ? 'previous' : 'today';
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Replays the stored result when an offline-queued mobile write is retried. */
function idempotent(clientRequestId, method, userId, fn) {
  const key = String(clientRequestId || '').trim().slice(0, 80);
  if (!key) return fn();
  ensureExpenseExtrasSchema();
  const db = getDb();
  const prev = db.prepare('SELECT result_json FROM expense_app_requests WHERE client_request_id = ?').get(key);
  if (prev) {
    try { return { ...JSON.parse(prev.result_json || '{}'), __replayed: true }; } catch (_) { return { __replayed: true }; }
  }
  const result = fn();
  try {
    db.prepare('INSERT INTO expense_app_requests (client_request_id, method, user_id, result_json) VALUES (?,?,?,?)')
      .run(key, method, userId || null, JSON.stringify(result == null ? {} : result).slice(0, 20000));
  } catch (_) { /* duplicate race */ }
  return result;
}

function recordWithdrawal(data, actor) {
  ensureExpenseExtrasSchema();
  const amount = round2(data.amount);
  if (!(amount > 0)) throw new Error('Withdrawal amount must be greater than zero');
  const purpose = String(data.purpose || '').trim();
  if (!purpose) throw new Error('Purpose is required');
  const taken_by = String(data.taken_by || '').trim();
  const given_by = String(data.given_by || '').trim();
  const authorised_by = String(data.authorised_by || '').trim();
  if (!taken_by) throw new Error('Who took the money is required');
  if (!given_by) throw new Error('Who gave the money is required');
  if (!authorised_by) throw new Error('Who authorised it is required');
  const withdrawal_date = String(data.withdrawal_date || todayStr()).slice(0, 10);
  const cash_source = normCashSource(data.cash_source);
  const payment_method = ['cash', 'eft', 'card', 'bank'].includes(String(data.payment_method || '').toLowerCase())
    ? String(data.payment_method).toLowerCase() : 'cash';
  const branch_id = data.branch_id != null && data.branch_id !== '' && data.branch_id !== 'all'
    ? Number(data.branch_id) : (actor?.branch_id != null ? Number(actor.branch_id) : null);
  const db = getDb();
  const r = db.prepare(`INSERT INTO owner_withdrawals
    (withdrawal_date, amount, purpose, taken_by, given_by, authorised_by, cash_source, payment_method, branch_id, notes,
     client_request_id, created_by, created_by_name)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    withdrawal_date, amount, purpose.slice(0, 300), taken_by.slice(0, 120), given_by.slice(0, 120), authorised_by.slice(0, 120),
    cash_source, payment_method, branch_id, data.notes ? String(data.notes).slice(0, 1000) : null,
    data.client_request_id || null, actor?.id || null, actor?.full_name || actor?.username || null
  );
  const newId = Number(r?.lastInsertRowid) || 0;
  const row = (newId && db.prepare('SELECT * FROM owner_withdrawals WHERE id = ?').get(newId))
    || db.prepare('SELECT * FROM owner_withdrawals ORDER BY id DESC LIMIT 1').get();
  try {
    db.prepare('INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, details) VALUES (?,?,?,?,?,?)')
      .run(actor?.id || null, actor?.full_name || actor?.username || null, 'money_withdrawal', 'owner_withdrawal', row?.id || null,
        JSON.stringify({ amount, purpose, taken_by, given_by, authorised_by, cash_source }));
  } catch (_) { /* */ }
  try {
    if (row && !require('./accounting-central').isLocalInstallerProcess()) {
      require('./accounting-platform').postFromOwnerWithdrawal(row);
    }
  } catch (err) {
    console.warn('[acc] postFromOwnerWithdrawal:', err.message || err);
  }
  return row;
}

function listWithdrawals(filters = {}) {
  ensureExpenseExtrasSchema();
  let sql = 'SELECT * FROM owner_withdrawals WHERE 1=1';
  const params = [];
  if (filters.from) { sql += ' AND withdrawal_date >= ?'; params.push(filters.from); }
  if (filters.to) { sql += ' AND withdrawal_date <= ?'; params.push(filters.to); }
  if (filters.branch_id != null && filters.branch_id !== '' && filters.branch_id !== 'all') {
    sql += ' AND branch_id = ?';
    params.push(Number(filters.branch_id));
  }
  sql += ' ORDER BY withdrawal_date DESC, id DESC LIMIT ?';
  params.push(Math.min(Number(filters.limit) || 200, 1000));
  return getDb().prepare(sql).all(...params);
}

const NON_MONEY_TENDERS = new Set(['giftcard', 'gift_card', 'loyalty', 'points', 'store_credit', 'account', 'credit', 'voucher']);

function dateList(from, to) {
  const out = [];
  const d = new Date(`${from}T12:00:00`);
  const end = new Date(`${to}T12:00:00`);
  while (d <= end && out.length < 370) {
    out.push(d.toLocaleDateString('en-CA'));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

/**
 * Daily money: takings per day (sale payments), what was paid out of today's takings
 * (expenses + withdrawals marked "today"), what came from previous days' money, and the net.
 */
function dailyMoneyReport(filters = {}) {
  ensureExpenseExtrasSchema();
  const db = getDb();
  const today = todayStr();
  let from = String(filters.from || filters.date || today).slice(0, 10);
  let to = String(filters.to || filters.date || from).slice(0, 10);
  if (to < from) [from, to] = [to, from];
  const branchId = filters.branch_id != null && filters.branch_id !== '' && filters.branch_id !== 'all'
    ? Number(filters.branch_id) : null;

  const dateKeys = dateList(from, to);
  const emptyDay = (d) => ({
    date: d, money_in: 0, cash_in: 0, card_in: 0, eft_in: 0, other_in: 0, sale_count: 0,
    expenses_today: 0, expenses_previous: 0, expenses_owner: 0,
    withdrawals_today: 0, withdrawals_previous: 0, owner_cash_in: 0,
    out_today: 0, net_today: 0
  });
  const days = new Map(dateKeys.map((d) => [d, emptyDay(d)]));
  // Per-branch breakdown is built from the same rows — one pass, no per-branch re-query.
  const wantBranches = branchId == null && (filters.include_branches !== false || filters.include_branch_days);
  const branchDays = new Map();
  const targets = (d, bid) => {
    const key = String(d || '').slice(0, 10);
    const row = days.get(key);
    if (!row) return [];
    if (!wantBranches || bid == null || bid === '') return [row];
    const b = Number(bid);
    if (!branchDays.has(b)) branchDays.set(b, new Map(dateKeys.map((x) => [x, emptyDay(x)])));
    return [row, branchDays.get(b).get(key)];
  };

  const salesBranch = branchId != null ? ' AND s.branch_id = ?' : '';
  const salesParams = branchId != null ? [from, to, branchId] : [from, to];
  const paySql = (dateExpr) => `
    SELECT date(${dateExpr}) AS d, s.branch_id AS bid, LOWER(COALESCE(sp.payment_type, 'cash')) AS method, COALESCE(SUM(sp.amount), 0) AS total
    FROM sale_payments sp JOIN sales s ON sp.sale_id = s.id
    WHERE date(${dateExpr}) >= date(?) AND date(${dateExpr}) <= date(?)
      AND s.status IN ('completed', 'partial_return')${salesBranch}
    GROUP BY date(${dateExpr}), s.branch_id, LOWER(COALESCE(sp.payment_type, 'cash'))`;
  let payRows = [];
  try { payRows = db.prepare(paySql('COALESCE(s.sale_datetime, s.created_at)')).all(...salesParams); } catch (_) {
    try { payRows = db.prepare(paySql('s.created_at')).all(...salesParams); } catch (_2) { payRows = []; }
  }
  for (const r of payRows) {
    const amt = Number(r.total) || 0;
    const m = String(r.method || '');
    if (NON_MONEY_TENDERS.has(m)) continue;
    for (const row of targets(r.d, r.bid)) {
      row.money_in += amt;
      if (m === 'cash') row.cash_in += amt;
      else if (m === 'card' || m.includes('card') || m === 'yoco' || m === 'speedpoint') row.card_in += amt;
      else if (m === 'eft' || m.includes('transfer') || m === 'bank') row.eft_in += amt;
      else row.other_in += amt;
    }
  }
  const countSql = (dateExpr) => `
    SELECT date(${dateExpr}) AS d, s.branch_id AS bid, COUNT(*) AS c FROM sales s
    WHERE date(${dateExpr}) >= date(?) AND date(${dateExpr}) <= date(?)
      AND s.status IN ('completed', 'partial_return')${salesBranch}
    GROUP BY date(${dateExpr}), s.branch_id`;
  try {
    let rows;
    try { rows = db.prepare(countSql('COALESCE(s.sale_datetime, s.created_at)')).all(...salesParams); } catch (_) {
      rows = db.prepare(countSql('s.created_at')).all(...salesParams);
    }
    for (const r of rows) {
      for (const row of targets(r.d, r.bid)) row.sale_count += Number(r.c) || 0;
    }
  } catch (_) { /* */ }

  let expSql = `SELECT * FROM expenses WHERE expense_date >= ? AND expense_date <= ?`;
  const expParams = [from, to];
  if (branchId != null) { expSql += ' AND branch_id = ?'; expParams.push(branchId); }
  let expRows = [];
  try { expRows = db.prepare(expSql).all(...expParams); } catch (_) { expRows = []; }
  for (const e of expRows) {
    if (String(e.approval_status || '').toLowerCase() === 'rejected') continue;
    const amt = Number(e.amount) || 0;
    for (const row of targets(e.expense_date, e.branch_id)) {
      if (String(e.funding_source || '').toLowerCase() === 'owner') row.expenses_owner += amt;
      else if (normCashSource(e.cash_source) === 'previous') row.expenses_previous += amt;
      else row.expenses_today += amt;
    }
  }

  const withdrawalRows = listWithdrawals({ from, to, branch_id: branchId, limit: 1000 });
  for (const w of withdrawalRows) {
    const amt = Number(w.amount) || 0;
    for (const row of targets(w.withdrawal_date, w.branch_id)) {
      if (normCashSource(w.cash_source) === 'previous') row.withdrawals_previous += amt;
      else row.withdrawals_today += amt;
    }
  }

  if (branchId == null) {
    for (const f of listOwnerFundings({ from, to, limit: 1000 })) {
      if (f.funding_type !== 'cash_injection') continue;
      const row = days.get(String(f.funding_date || '').slice(0, 10));
      if (row) row.owner_cash_in += Number(f.amount) || 0;
    }
  }

  const keys = ['money_in', 'cash_in', 'card_in', 'eft_in', 'other_in', 'expenses_today', 'expenses_previous', 'expenses_owner',
    'withdrawals_today', 'withdrawals_previous', 'owner_cash_in', 'out_today', 'net_today'];
  const finish = (dayMap) => {
    const totals = { sale_count: 0 };
    keys.forEach((k) => { totals[k] = 0; });
    const list = [...dayMap.values()].map((r) => {
      r.out_today = r.expenses_today + r.withdrawals_today;
      r.net_today = r.money_in - r.out_today;
      keys.forEach((k) => { r[k] = round2(r[k]); totals[k] += r[k]; });
      totals.sale_count += r.sale_count;
      return r;
    });
    keys.forEach((k) => { totals[k] = round2(totals[k]); });
    return { days: list, totals };
  };
  const { days: rows, totals } = finish(days);

  let branch = null;
  if (branchId != null) {
    try { branch = db.prepare('SELECT * FROM branches WHERE id = ?').get(branchId) || null; } catch (_) { branch = null; }
  }
  let by_branch = [];
  if (wantBranches) {
    let branches = [];
    try { branches = db.prepare('SELECT id, name FROM branches ORDER BY id').all(); } catch (_) { branches = []; }
    if (branches.length > 1 || filters.include_branch_days) {
      by_branch = branches.map((b) => {
        const bd = branchDays.get(Number(b.id)) || new Map(dateKeys.map((x) => [x, emptyDay(x)]));
        const done = finish(bd);
        const out = { branch_id: b.id, branch_name: b.name, totals: done.totals };
        if (filters.include_branch_days) out.days = done.days;
        return out;
      });
    }
  }
  const withdrawals = withdrawalRows.slice(0, 500);
  return { from, to, branch_id: branchId, branch, days: rows, totals, by_branch, withdrawals };
}

function dailyMoneyPdf(filters = {}, meta = {}) {
  const { jsPDF } = require('jspdf');
  require('jspdf-autotable');
  const { pdfBytes } = require('./pdf-bytes');
  const report = dailyMoneyReport(filters);
  let s = {};
  try {
    const st = require('./store');
    s = (st.getSettingsParsed && st.getSettingsParsed()) || st.getSettings() || {};
    if (typeof s === 'string') s = JSON.parse(s);
  } catch (_) { s = {}; }
  const cur = s.currency || 'R';
  const money = (n) => `${cur}${(Number(n) || 0).toFixed(2)}`;
  const doc = new jsPDF();
  let y = 14;
  let textX = 14;
  try {
    const { getShopLogo } = require('../../lib/product-images');
    const file = getShopLogo();
    const buf = file.buffer || (file.path ? require('fs').readFileSync(file.path) : null);
    const fmt = /png/i.test(file.mime || '') ? 'PNG' : (/jpe?g/i.test(file.mime || '') ? 'JPEG' : null);
    if (buf && fmt) {
      doc.addImage(`data:${file.mime};base64,${Buffer.from(buf).toString('base64')}`, fmt, 14, y - 2, 22, 22);
      textX = 40;
    }
  } catch (_) { /* no logo */ }
  doc.setFontSize(17);
  doc.setFont(undefined, 'bold');
  doc.text(String(s.shop_name || 'Shop POS'), textX, y + 4);
  doc.setFont(undefined, 'normal');
  doc.setFontSize(9);
  let hy = y + 10;
  const b = report.branch;
  const lines = b
    ? [`Branch: ${b.name || `#${b.id}`}`, b.address || s.address, (b.phone || s.phone) ? `Tel: ${b.phone || s.phone}` : '']
    : ['All stores / branches', s.address, s.phone ? `Tel: ${s.phone}` : ''];
  if (s.vat_number) lines.push(`VAT: ${s.vat_number}`);
  lines.filter(Boolean).forEach((l) => { doc.text(String(l), textX, hy); hy += 4.5; });
  y = Math.max(hy, y + 24) + 2;
  doc.setDrawColor(200);
  doc.line(14, y, 196, y);
  y += 8;
  doc.setFontSize(14);
  doc.setFont(undefined, 'bold');
  doc.text('Daily Money Report', 14, y);
  doc.setFont(undefined, 'normal');
  doc.setFontSize(9);
  y += 6;
  doc.text(`Period: ${report.from === report.to ? report.from : `${report.from} to ${report.to}`}`, 14, y);
  y += 4.5;
  doc.text(`Generated: ${new Date().toLocaleString('en-ZA')}${meta.by ? ` by ${meta.by}` : ''}`, 14, y);
  y += 5;

  const t = report.totals;
  doc.autoTable({
    startY: y,
    head: [['Summary', 'Amount']],
    body: [
      ['Money in (sales takings)', money(t.money_in)],
      ['   Cash', money(t.cash_in)],
      ['   Card', money(t.card_in)],
      ['   EFT / transfer', money(t.eft_in)],
      ['   Other', money(t.other_in)],
      ["Expenses paid from today's money", money(t.expenses_today)],
      ["Withdrawals from today's money", money(t.withdrawals_today)],
      ["NET of today's money", money(t.net_today)],
      ["Expenses paid from previous days' money", money(t.expenses_previous)],
      ["Withdrawals from previous days' money", money(t.withdrawals_previous)],
      ['Owner-funded expenses (owner pocket)', money(t.expenses_owner)],
      ['Owner cash put into business', money(t.owner_cash_in)]
    ],
    styles: { fontSize: 9 },
    headStyles: { fillColor: [49, 46, 129] },
    columnStyles: { 1: { halign: 'right' } },
    didParseCell: (d) => {
      if (d.section === 'body' && d.row.index === 7) { d.cell.styles.fontStyle = 'bold'; d.cell.styles.fillColor = [224, 231, 255]; }
    }
  });
  y = doc.lastAutoTable.finalY + 6;

  if (report.days.length > 1) {
    doc.autoTable({
      startY: y,
      head: [['Date', 'Sales', 'Money in', 'Expenses (today)', 'Withdrawals (today)', 'Net today', 'From previous']],
      body: report.days.map((d) => [d.date, d.sale_count, money(d.money_in), money(d.expenses_today), money(d.withdrawals_today),
        money(d.net_today), money(d.expenses_previous + d.withdrawals_previous)]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [49, 46, 129] },
      columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' } }
    });
    y = doc.lastAutoTable.finalY + 6;
  }

  if (report.by_branch && report.by_branch.length) {
    doc.autoTable({
      startY: y,
      head: [['Branch', 'Money in', 'Out (today)', 'Net today', 'From previous']],
      body: report.by_branch.map((r) => [r.branch_name, money(r.totals.money_in), money(r.totals.out_today), money(r.totals.net_today),
        money(r.totals.expenses_previous + r.totals.withdrawals_previous)]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [49, 46, 129] },
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } }
    });
    y = doc.lastAutoTable.finalY + 6;
  }

  if (report.withdrawals && report.withdrawals.length) {
    doc.autoTable({
      startY: y,
      head: [['Date', 'Amount', 'Purpose', 'Taken by', 'Given by', 'Authorised by', 'Money']],
      body: report.withdrawals.map((w) => [w.withdrawal_date, money(w.amount), w.purpose || '', w.taken_by || '', w.given_by || '',
        w.authorised_by || '', w.cash_source === 'previous' ? 'Previous' : 'Today']),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [153, 27, 27] },
      columnStyles: { 1: { halign: 'right' } }
    });
  }

  const pages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(128);
    doc.text(`${s.shop_name || 'Shop POS'} — Daily Money Report — Page ${i} of ${pages}`, 14, 290);
  }
  const bytes = pdfBytes(doc);
  const tag = report.from === report.to ? report.from : `${report.from}_to_${report.to}`;
  return {
    filename: `daily-money-${tag}${b ? `-${String(b.name || b.id).replace(/[^a-z0-9]+/gi, '-').toLowerCase()}` : '-all'}.pdf`,
    base64: Buffer.from(bytes).toString('base64'),
    report
  };
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
  const bid = data.branch_id == null || data.branch_id === '' ? null : data.branch_id;
  const existing = db.prepare(`
    SELECT id FROM expense_budgets
    WHERE category = ? AND month_key = ?
      AND ((branch_id IS NULL AND ? IS NULL) OR branch_id = ?)
  `).get(category, month_key, bid, bid);
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
  const row = getDb().prepare('SELECT * FROM owner_fundings WHERE id = ?').get(r.lastInsertRowid)
    || getDb().prepare('SELECT * FROM owner_fundings ORDER BY id DESC LIMIT 1').get();
  try {
    if (!require('./accounting-central').isLocalInstallerProcess()) {
      require('./accounting-platform').postFromOwnerFunding(row);
    }
  } catch (err) {
    console.warn('[acc] postFromOwnerFunding:', err.message || err);
  }
  return row;
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

function expenseItemSummary(filters = {}) {
  ensureExpenseExtrasSchema();
  const li = require('../../lib/expense-line-items');
  let sql = 'SELECT * FROM expenses WHERE 1=1';
  const params = [];
  if (filters.from) { sql += ' AND expense_date >= ?'; params.push(filters.from); }
  if (filters.to) { sql += ' AND expense_date <= ?'; params.push(filters.to); }
  if (filters.category) { sql += ' AND category = ?'; params.push(filters.category); }
  const groups = new Map();
  const add = (name, category, qty, total, expenseId, date) => {
    const label = String(name || '').trim() || 'Unnamed';
    const key = label.toLowerCase();
    if (!groups.has(key)) {
      groups.set(key, { item: label, category: category || '', purchases: 0, quantity: 0, total: 0, last_date: null, _ids: new Set() });
    }
    const g = groups.get(key);
    if (!g._ids.has(expenseId)) { g._ids.add(expenseId); g.purchases += 1; }
    g.quantity += Number(qty) || 0;
    g.total += Number(total) || 0;
    if (date && (!g.last_date || date > g.last_date)) g.last_date = date;
  };
  for (const e of getDb().prepare(sql).all(...params)) {
    let items = [];
    try { items = li.normalizeLineItems(JSON.parse(e.line_items_json || '[]')); } catch (_) { items = []; }
    if (items.length) {
      items.forEach((r) => add(r.name, e.category, r.quantity, r.amount, e.id, e.expense_date));
    } else {
      add(e.description || e.category, e.category, 1, e.amount, e.id, e.expense_date);
    }
  }
  const rows = [...groups.values()].map(({ _ids, ...g }) => ({
    ...g,
    quantity: Math.round(g.quantity * 1000) / 1000,
    total: Math.round(g.total * 100) / 100
  })).sort((a, b) => b.total - a.total);
  const grand = rows.reduce((a, r) => ({ purchases: a.purchases + r.purchases, total: a.total + r.total }), { purchases: 0, total: 0 });
  grand.total = Math.round(grand.total * 100) / 100;
  return { items: rows, grand_total: grand, from: filters.from || null, to: filters.to || null };
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
  expenseItemSummary,
  recordWithdrawal,
  listWithdrawals,
  dailyMoneyReport,
  dailyMoneyPdf,
  idempotent,
  normCashSource,
  budgetStatus,
  monthKey
};

/**
 * Accounting Command Centre — double-entry financial layer over Shop POS.
 * Tables: migrations-v77.sql (acc_*)
 */
const bcrypt = require('bcryptjs');
const { getDb } = require('../database/db');

let session;
try { session = require('./session'); } catch { session = { getUserSession: () => null, clearAll: () => {} }; }

const SYSTEM_ACTOR = { _system: true, full_name: 'System', role: 'owner' };

const ACC_ROLES = new Set([
  'owner', 'manager', 'accountant', 'bookkeeper', 'auditor', 'admin', 'finance_manager',
  'finance', 'payroll', 'hr', 'supervisor', 'assistant_manager', 'viewer', 'read_only'
]);
const WRITE_BLOCKED = new Set(['auditor', 'viewer', 'read_only']);

function db() { return getDb(); }
function dbGet(sql, params = []) { return db().prepare(sql).get(...params); }
function dbAll(sql, params = []) { return db().prepare(sql).all(...params); }
function dbRun(sql, params = []) { return db().prepare(sql).run(...params); }
function nowIso() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }
function today() { return new Date().toLocaleDateString('en-CA'); }
function num(v, d = 0) { const n = Number(v); return Number.isFinite(n) ? n : d; }
function textOrNull(v) { const s = v == null ? '' : String(v).trim(); return s || null; }
function parseJson(v, fb = {}) { try { return typeof v === 'string' ? JSON.parse(v || 'null') || fb : (v || fb); } catch { return fb; } }
function round2(n) { return Math.round((num(n) + Number.EPSILON) * 100) / 100; }
function money(n) { return round2(n); }
function toJson(v, fb = '{}') { try { return v == null ? fb : (typeof v === 'string' ? v : JSON.stringify(v)); } catch { return fb; } }

function audit(actor, action, entityType, entityId, prev, next) {
  try {
    dbRun(
      `INSERT INTO acc_audit (user_id, user_name, action, entity_type, entity_id, previous_json, new_json)
       VALUES (?,?,?,?,?,?,?)`,
      [actor?.id || null, actor?.full_name || actor?.username || null, action, entityType || null, entityId || null,
        prev != null ? JSON.stringify(prev) : null, next != null ? JSON.stringify(next) : null]
    );
  } catch (_) { /* ignore */ }
}

function ensureReady() {
  dbRun(`INSERT OR IGNORE INTO acc_settings (id) VALUES (1)`);
  const tax = dbGet(`SELECT id FROM acc_tax_rates WHERE is_default = 1 LIMIT 1`);
  if (!tax) {
    dbRun(`INSERT INTO acc_tax_rates (name, rate, tax_type, is_default, is_active) VALUES ('VAT Standard', 15, 'vat', 1, 1)`);
  }
  if (!dbGet(`SELECT id FROM acc_accounts LIMIT 1`)) {
    // Migration seed should have run; minimal fallback
    dbRun(`INSERT OR IGNORE INTO acc_accounts (id, code, name, type, subtype, is_system) VALUES
      (1,'1000','Cash on Hand','asset','cash',1),(3,'1100','Bank Account','asset','bank',1),
      (4,'1200','Accounts Receivable','asset','receivable',1),(5,'1300','Inventory','asset','inventory',1),
      (12,'2000','Accounts Payable','liability','payable',1),(13,'2100','VAT Payable (Output)','liability','tax',1),
      (20,'4000','Product Sales','income','sales',1),(25,'5000','Cost of Goods Sold','cogs','cogs',1),
      (43,'6900','Other Expenses','expense','operating',1),(44,'1150','Card Clearing','asset','clearing',1)`);
  }
  if (!dbGet(`SELECT id FROM acc_bank_accounts LIMIT 1`)) {
    dbRun(`INSERT INTO acc_bank_accounts (name, bank_name, gl_account_id) VALUES ('Main Business Account','Primary Bank',3)`);
  }
  if (!dbGet(`SELECT id FROM acc_cash_accounts LIMIT 1`)) {
    dbRun(`INSERT INTO acc_cash_accounts (name, gl_account_id, is_petty) VALUES ('Till Cash',1,0),('Petty Cash',2,1)`);
  }
  if (!dbGet(`SELECT id FROM acc_periods WHERE status='open' LIMIT 1`)) {
    dbRun(`INSERT INTO acc_periods (name, start_date, end_date, status) VALUES ('Current Year', date('now','start of year'), date('now','start of year','+1 year','-1 day'), 'open')`);
  }
}

function getSettings() {
  ensureReady();
  const row = dbGet(`SELECT * FROM acc_settings WHERE id = 1`) || {};
  const shop = dbGet(`SELECT shop_name, currency, vat_number, tax_rate, tax_enabled FROM shop_settings WHERE id = 1`) || {};
  const financeRoles = ['owner', 'manager', 'accountant', 'bookkeeper', 'auditor', 'finance_manager', 'supervisor', 'assistant_manager'];
  let accountingUsers = [];
  try {
    accountingUsers = dbAll(
      `SELECT id, username, full_name, role, is_active FROM users
       WHERE lower(role) IN ('owner','manager','accountant','bookkeeper','auditor','finance_manager','supervisor','assistant_manager')
       ORDER BY full_name, username`
    ) || [];
  } catch (_) {
    try {
      accountingUsers = dbAll(
        `SELECT id, username, full_name, role, is_active FROM users ORDER BY full_name, username LIMIT 200`
      ) || [];
    } catch (__) { /* ignore */ }
  }
  const parsed = parseJson(row.settings_json, {});
  const extraUsers = Array.isArray(parsed.accounting_users) ? parsed.accounting_users : [];
  return {
    ...row,
    business_name: row.business_name || shop.shop_name || 'Business',
    currency: row.currency || shop.currency || 'R',
    vat_number: row.vat_number || shop.vat_number || null,
    settings: parsed,
    users: accountingUsers,
    accounting_users: accountingUsers.length ? accountingUsers : extraUsers
  };
}

function saveSettings(data = {}, actor) {
  requireAccWrite(actor);
  ensureReady();

  if (data.action === 'add_user') {
    const username = String(data.username || '').trim();
    const fullName = String(data.full_name || data.name || username).trim();
    const role = String(data.role || 'bookkeeper').toLowerCase();
    if (!username) throw new Error('Username is required');
    if (!ACC_ROLES.has(role) && !['supervisor', 'assistant_manager'].includes(role)) {
      throw new Error('Invalid accounting role');
    }
    const existing = dbGet(`SELECT id FROM users WHERE lower(username) = lower(?)`, [username]);
    if (existing) {
      dbRun(`UPDATE users SET role = ?, full_name = COALESCE(?, full_name), is_active = 1 WHERE id = ?`,
        [role, fullName || null, existing.id]);
      audit(actor, 'grant_accounting_access', 'user', existing.id, null, { username, role });
      return getSettings();
    }
    throw new Error('User not found — create the user in Admin → User Management first, then grant accounting access here');
  }

  if (data.action === 'set_user_role') {
    const userId = Number(data.user_id || data.id);
    const role = String(data.role || '').toLowerCase();
    if (!userId || !role) throw new Error('User and role required');
    dbRun(`UPDATE users SET role = ? WHERE id = ?`, [role, userId]);
    audit(actor, 'set_accounting_role', 'user', userId, null, { role });
    return getSettings();
  }

  const prev = getSettings();
  dbRun(
    `UPDATE acc_settings SET
      business_name=?, registration_number=?, vat_number=?, tax_registered=?,
      fiscal_year_start=?, accounting_basis=?, currency=?,
      invoice_prefix=?, receipt_prefix=?, credit_note_prefix=?, debit_note_prefix=?, journal_prefix=?, bill_prefix=?,
      payment_terms_days=?, default_tax_rate_id=?,
      approval_expense_threshold=?, approval_payment_threshold=?, two_factor_enabled=?,
      settings_json=?, updated_at=datetime('now')
     WHERE id=1`,
    [
      textOrNull(data.business_name) || prev.business_name,
      textOrNull(data.registration_number),
      textOrNull(data.vat_number),
      data.tax_registered ? 1 : 0,
      data.fiscal_year_start || prev.fiscal_year_start || '03-01',
      data.accounting_basis || prev.accounting_basis || 'accrual',
      data.currency || prev.currency || 'R',
      data.invoice_prefix || prev.invoice_prefix || 'INV-',
      data.receipt_prefix || prev.receipt_prefix || 'RCP-',
      data.credit_note_prefix || prev.credit_note_prefix || 'CN-',
      data.debit_note_prefix || prev.debit_note_prefix || 'DN-',
      data.journal_prefix || prev.journal_prefix || 'JE-',
      data.bill_prefix || prev.bill_prefix || 'BILL-',
      num(data.payment_terms_days, prev.payment_terms_days || 30),
      data.default_tax_rate_id || prev.default_tax_rate_id || 1,
      num(data.approval_expense_threshold, prev.approval_expense_threshold || 5000),
      num(data.approval_payment_threshold, prev.approval_payment_threshold || 10000),
      data.two_factor_enabled ? 1 : 0,
      JSON.stringify(data.settings || prev.settings || {})
    ]
  );
  const next = getSettings();
  audit(actor, 'save_settings', 'acc_settings', 1, prev, next);
  return next;
}

function requireAccUser(actor) {
  ensureReady();
  if (actor && actor._system) return actor;
  const user = actor || session.getUserSession?.();
  if (!user?.id) throw new Error('Authentication required');
  const role = String(user.role || '').toLowerCase();
  if (!ACC_ROLES.has(role) && !role.includes('account') && !role.includes('finance')) {
    throw new Error('Accounting access denied for this role');
  }
  const financeRoles = new Set(['owner', 'accountant', 'bookkeeper', 'finance_manager', 'finance', 'admin']);
  if (!financeRoles.has(role) && process.env.SHOP_POS_CLOUD === '1') {
    try {
      const { hasUserPermission } = require('./authz');
      if (!hasUserPermission(user, 'bookkeeping')) {
        throw new Error('Bookkeeping permission required for accounting access');
      }
    } catch (e) {
      if (e.message.includes('Bookkeeping')) throw e;
    }
  }
  return user;
}

function requireAccWrite(actor) {
  const user = requireAccUser(actor);
  if (WRITE_BLOCKED.has(String(user.role || '').toLowerCase())) {
    throw new Error('Auditors have read-only access');
  }
  return user;
}

function nextNumber(prefixCol, nextCol) {
  ensureReady();
  const s = dbGet(`SELECT ${prefixCol} AS p, ${nextCol} AS n FROM acc_settings WHERE id=1`);
  const n = num(s?.n, 1);
  dbRun(`UPDATE acc_settings SET ${nextCol}=? WHERE id=1`, [n + 1]);
  return `${s?.p || ''}${String(n).padStart(5, '0')}`;
}

function periodIsOpen(dateStr) {
  const d = dateStr || today();
  const closed = dbGet(
    `SELECT id FROM acc_periods WHERE status IN ('closed','locked') AND date(?) BETWEEN date(start_date) AND date(end_date) LIMIT 1`,
    [d]
  );
  return !closed;
}

function accountBalance(accountId, asOfDate) {
  const asOf = asOfDate || today();
  const row = dbGet(
    `SELECT COALESCE(SUM(jl.debit),0) AS debits, COALESCE(SUM(jl.credit),0) AS credits
     FROM acc_journal_lines jl
     JOIN acc_journals j ON j.id = jl.journal_id
     WHERE jl.account_id = ? AND j.status = 'posted' AND date(j.journal_date) <= date(?)`,
    [accountId, asOf]
  );
  const acct = dbGet(`SELECT type FROM acc_accounts WHERE id=?`, [accountId]);
  const debits = num(row?.debits); const credits = num(row?.credits);
  const type = acct?.type || 'asset';
  if (type === 'asset' || type === 'expense' || type === 'cogs') return round2(debits - credits);
  return round2(credits - debits);
}

function defaults() {
  const s = getSettings();
  return {
    cash: s.default_cash_account_id || 1,
    bank: s.default_bank_account_id || 3,
    ar: s.default_ar_account_id || 4,
    inventory: s.default_inventory_account_id || 5,
    vatIn: s.default_vat_input_id || 6,
    ap: s.default_ap_account_id || 12,
    vatOut: s.default_vat_output_id || 13,
    sales: s.default_sales_account_id || 20,
    cogs: s.default_cogs_account_id || 25,
    card: 44,
    expense: 43
  };
}

function postJournal(data = {}, actor) {
  const user = data.status === 'draft' ? requireAccUser(actor) : requireAccWrite(actor);
  ensureReady();
  const lines = Array.isArray(data.lines) ? data.lines : [];
  if (!lines.length) throw new Error('Journal needs at least one line');
  let debit = 0; let credit = 0;
  lines.forEach((l) => { debit += num(l.debit); credit += num(l.credit); });
  debit = round2(debit); credit = round2(credit);
  if (Math.abs(debit - credit) > 0.01) throw new Error(`Unbalanced journal: debit ${debit} ≠ credit ${credit}`);

  const jDate = data.date || data.journal_date || today();
  if (!periodIsOpen(jDate) && data.status === 'posted') {
    throw new Error('Accounting period is closed for this date');
  }

  if (data.source_type && data.event_key) {
    const dup = dbGet(
      `SELECT id FROM acc_journals WHERE source_type=? AND source_id=? AND event_key=? AND status='posted'`,
      [data.source_type, data.source_id || null, data.event_key]
    );
    if (dup) return getJournal(dup.id);
  }

  const status = data.status || 'posted';
  const journalNumber = data.journal_number || nextNumber('journal_prefix', 'journal_next');
  const r = dbRun(
    `INSERT INTO acc_journals (journal_number, journal_date, journal_type, description, reference,
      source_type, source_id, event_key, status, total_debit, total_credit, branch_id, business_id,
      document_path, created_by, created_by_name, posted_at, notes)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      journalNumber, jDate, data.journal_type || data.type || 'general',
      textOrNull(data.description), textOrNull(data.reference),
      textOrNull(data.source_type), data.source_id || null, textOrNull(data.event_key),
      status, debit, credit, data.branch_id || null, data.business_id || null,
      textOrNull(data.document_path), user.id, user.full_name || user.username,
      status === 'posted' ? nowIso() : null, textOrNull(data.notes)
    ]
  );
  const journalId = r.lastInsertRowid;
  lines.forEach((l, i) => {
    dbRun(
      `INSERT INTO acc_journal_lines (journal_id, line_no, account_id, description, debit, credit,
        customer_id, supplier_id, product_id, tax_rate_id, tax_amount)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        journalId, i + 1, Number(l.account_id), textOrNull(l.description),
        round2(l.debit), round2(l.credit),
        l.customer_id || null, l.supplier_id || null, l.product_id || null,
        l.tax_rate_id || null, round2(l.tax_amount || 0)
      ]
    );
  });
  audit(user, 'post_journal', 'acc_journal', journalId, null, { journalNumber, debit, credit, status });
  return getJournal(journalId);
}

function getJournal(id) {
  const j = dbGet(`SELECT * FROM acc_journals WHERE id=?`, [id]);
  if (!j) return null;
  j.lines = dbAll(
    `SELECT jl.*, a.code AS account_code, a.name AS account_name
     FROM acc_journal_lines jl LEFT JOIN acc_accounts a ON a.id = jl.account_id
     WHERE jl.journal_id=? ORDER BY jl.line_no`,
    [id]
  );
  return j;
}

function listJournals(filters = {}, actor) {
  requireAccUser(actor);
  const params = [];
  let sql = `SELECT * FROM acc_journals WHERE 1=1`;
  if (filters.status) { sql += ` AND status=?`; params.push(filters.status); }
  if (filters.from) { sql += ` AND date(journal_date)>=date(?)`; params.push(filters.from); }
  if (filters.to) { sql += ` AND date(journal_date)<=date(?)`; params.push(filters.to); }
  if (filters.q) { sql += ` AND (journal_number LIKE ? OR description LIKE ? OR reference LIKE ?)`; const q = `%${filters.q}%`; params.push(q, q, q); }
  sql += ` ORDER BY journal_date DESC, id DESC LIMIT ?`;
  params.push(Math.min(num(filters.limit, 200), 500));
  return dbAll(sql, params);
}

function publishJournal(id, actor) {
  const user = requireAccWrite(actor);
  ensureReady();
  const j = dbGet('SELECT * FROM acc_journals WHERE id = ?', [id]);
  if (!j) throw new Error('Journal not found');
  if (j.status === 'posted') return getJournal(id);
  if (j.status !== 'draft') throw new Error('Only draft journals can be posted');
  if (!periodIsOpen(j.journal_date)) throw new Error('Accounting period is closed for this date');
  const lines = dbAll('SELECT * FROM acc_journal_lines WHERE journal_id = ? ORDER BY line_no', [id]);
  if (!lines.length) throw new Error('Journal has no lines');
  let debit = 0;
  let credit = 0;
  lines.forEach((l) => { debit += num(l.debit); credit += num(l.credit); });
  debit = round2(debit);
  credit = round2(credit);
  if (Math.abs(debit - credit) > 0.01) throw new Error(`Unbalanced journal: debit ${debit} ≠ credit ${credit}`);
  dbRun(`UPDATE acc_journals SET status = 'posted', posted_at = ?, total_debit = ?, total_credit = ? WHERE id = ?`,
    [nowIso(), debit, credit, id]);
  audit(user, 'publish_journal', 'acc_journal', id, null, { journalNumber: j.journal_number, debit, credit });
  return getJournal(id);
}

function reverseJournal(id, actor) {
  const user = requireAccWrite(actor);
  const j = getJournal(id);
  if (!j) throw new Error('Journal not found');
  if (j.status !== 'posted') throw new Error('Only posted journals can be reversed');
  if (j.reversed_journal_id) throw new Error('Already reversed');
  const lines = (j.lines || []).map((l) => ({
    account_id: l.account_id,
    debit: l.credit,
    credit: l.debit,
    description: `Reversal: ${l.description || ''}`,
    customer_id: l.customer_id,
    supplier_id: l.supplier_id,
    product_id: l.product_id
  }));
  const rev = postJournal({
    date: today(),
    type: 'reversal',
    description: `Reversal of ${j.journal_number}`,
    reference: j.journal_number,
    source_type: j.source_type,
    source_id: j.source_id,
    event_key: j.event_key ? `${j.event_key}_rev_${Date.now()}` : `rev_${j.id}`,
    lines,
    status: 'posted'
  }, user);
  dbRun(`UPDATE acc_journals SET status='reversed', reversed_journal_id=?, updated_at=datetime('now') WHERE id=?`, [rev.id, id]);
  audit(user, 'reverse_journal', 'acc_journal', id, j, rev);
  return rev;
}

function listLedger(filters = {}, actor) {
  requireAccUser(actor);
  const params = [];
  let sql = `
    SELECT jl.*, j.journal_number, j.journal_date, j.description AS journal_description, j.reference,
           a.code AS account_code, a.name AS account_name, j.created_by_name
    FROM acc_journal_lines jl
    JOIN acc_journals j ON j.id = jl.journal_id
    JOIN acc_accounts a ON a.id = jl.account_id
    WHERE j.status = 'posted'`;
  if (filters.account_id) { sql += ` AND jl.account_id=?`; params.push(filters.account_id); }
  if (filters.from) { sql += ` AND date(j.journal_date)>=date(?)`; params.push(filters.from); }
  if (filters.to) { sql += ` AND date(j.journal_date)<=date(?)`; params.push(filters.to); }
  sql += ` ORDER BY j.journal_date, j.id, jl.line_no LIMIT ?`;
  params.push(Math.min(num(filters.limit, 500), 2000));
  const rows = dbAll(sql, params);
  let running = 0;
  return rows.map((r) => {
    running = round2(running + num(r.debit) - num(r.credit));
    return { ...r, running_balance: running };
  });
}

function listAccounts(filters = {}, actor) {
  requireAccUser(actor);
  ensureReady();
  let sql = `SELECT * FROM acc_accounts WHERE 1=1`;
  const params = [];
  if (filters.type) { sql += ` AND type=?`; params.push(filters.type); }
  if (filters.active != null) { sql += ` AND is_active=?`; params.push(filters.active ? 1 : 0); }
  else sql += ` AND is_active=1`;
  sql += ` ORDER BY code`;
  return dbAll(sql, params).map((a) => ({ ...a, balance: accountBalance(a.id, filters.as_of) }));
}

function saveAccount(data = {}, actor) {
  requireAccWrite(actor);
  if (data.id) {
    dbRun(
      `UPDATE acc_accounts SET code=?, name=?, type=?, subtype=?, parent_id=?, description=?, is_active=?, updated_at=datetime('now') WHERE id=?`,
      [data.code, data.name, data.type, textOrNull(data.subtype), data.parent_id || null, textOrNull(data.description), data.is_active === 0 ? 0 : 1, data.id]
    );
    audit(actor, 'update_account', 'acc_account', data.id, null, data);
    return dbGet(`SELECT * FROM acc_accounts WHERE id=?`, [data.id]);
  }
  const r = dbRun(
    `INSERT INTO acc_accounts (code, name, type, subtype, parent_id, description, is_system) VALUES (?,?,?,?,?,?,0)`,
    [data.code, data.name, data.type, textOrNull(data.subtype), data.parent_id || null, textOrNull(data.description)]
  );
  audit(actor, 'create_account', 'acc_account', r.lastInsertRowid, null, data);
  return dbGet(`SELECT * FROM acc_accounts WHERE id=?`, [r.lastInsertRowid]);
}

function setAccountActive(id, active, actor) {
  requireAccWrite(actor);
  dbRun(`UPDATE acc_accounts SET is_active=?, updated_at=datetime('now') WHERE id=?`, [active ? 1 : 0, id]);
  return dbGet(`SELECT * FROM acc_accounts WHERE id=?`, [id]);
}

function listPeriods(actor) {
  requireAccUser(actor);
  return dbAll(`SELECT * FROM acc_periods ORDER BY start_date DESC`);
}

function closePeriod(id, actor) {
  const user = requireAccWrite(actor);
  dbRun(`UPDATE acc_periods SET status='closed', closed_at=datetime('now'), closed_by=? WHERE id=?`, [user.id, id]);
  audit(user, 'close_period', 'acc_period', id, null, { status: 'closed' });
  return dbGet(`SELECT * FROM acc_periods WHERE id=?`, [id]);
}

function reopenPeriod(id, actor) {
  const user = requireAccWrite(actor);
  if (!['owner', 'manager', 'admin', 'accountant'].includes(String(user.role || '').toLowerCase())) {
    throw new Error('Only owner/manager/accountant can reopen periods');
  }
  dbRun(`UPDATE acc_periods SET status='open', closed_at=NULL, closed_by=NULL WHERE id=?`, [id]);
  audit(user, 'reopen_period', 'acc_period', id, null, { status: 'open' });
  return dbGet(`SELECT * FROM acc_periods WHERE id=?`, [id]);
}

function lockPeriod(id, actor) {
  const user = requireAccWrite(actor);
  dbRun(`UPDATE acc_periods SET status='locked', closed_at=datetime('now'), closed_by=? WHERE id=?`, [user.id, id]);
  return dbGet(`SELECT * FROM acc_periods WHERE id=?`, [id]);
}

function runYearEnd(actor) {
  const user = requireAccWrite(actor);
  const from = dbGet(`SELECT start_date FROM acc_periods WHERE status='open' ORDER BY start_date LIMIT 1`)?.start_date
    || `${new Date().getFullYear()}-01-01`;
  const to = today();
  const income = listAccounts({ type: 'income' }, user);
  const cogs = listAccounts({ type: 'cogs' }, user);
  const expenses = listAccounts({ type: 'expense' }, user);
  const lines = [];
  let net = 0;
  [...income].forEach((a) => {
    const bal = accountBalance(a.id, to);
    if (Math.abs(bal) < 0.01) return;
    lines.push({ account_id: a.id, debit: bal > 0 ? bal : 0, credit: bal < 0 ? Math.abs(bal) : 0, description: 'Year-end close' });
    net += bal;
  });
  [...cogs, ...expenses].forEach((a) => {
    const bal = accountBalance(a.id, to);
    if (Math.abs(bal) < 0.01) return;
    lines.push({ account_id: a.id, debit: bal < 0 ? Math.abs(bal) : 0, credit: bal > 0 ? bal : 0, description: 'Year-end close' });
    net -= bal;
  });
  if (Math.abs(net) >= 0.01) {
    lines.push(net > 0
      ? { account_id: 19, credit: round2(net), debit: 0, description: 'Retained earnings' }
      : { account_id: 19, debit: round2(Math.abs(net)), credit: 0, description: 'Retained earnings' });
  }
  if (!lines.length) return { closed: false, message: 'Nothing to close' };
  // Balance check — force balance into RE if needed
  let d = 0; let c = 0;
  lines.forEach((l) => { d += num(l.debit); c += num(l.credit); });
  const diff = round2(d - c);
  if (Math.abs(diff) > 0.01) {
    if (diff > 0) lines.push({ account_id: 19, credit: diff, debit: 0, description: 'Year-end balancing' });
    else lines.push({ account_id: 19, debit: Math.abs(diff), credit: 0, description: 'Year-end balancing' });
  }
  const journal = postJournal({
    date: to, type: 'year_end', description: `Year-end close ${from} to ${to}`,
    event_key: `year_end_${from}_${to}`, source_type: 'year_end', source_id: 1,
    lines, status: 'posted'
  }, user);
  dbAll(`SELECT id FROM acc_periods WHERE status='open'`).forEach((p) => closePeriod(p.id, user));
  const y = new Date().getFullYear() + 1;
  dbRun(`INSERT INTO acc_periods (name, start_date, end_date, status) VALUES (?,?,?, 'open')`,
    [`FY ${y}`, `${y}-01-01`, `${y}-12-31`]);
  return { closed: true, journal, retained: net };
}

function tenderAccount(method) {
  const m = String(method || 'cash').toLowerCase();
  const d = defaults();
  if (m === 'card') return d.card;
  if (m === 'eft' || m === 'bank' || m === 'transfer') return d.bank;
  if (m === 'on_account' || m === 'credit' || m === 'account') return d.ar;
  return d.cash;
}

function queueIntegrationError(system, type, id, err, payload) {
  try {
    dbRun(
      `INSERT INTO acc_integration_errors (source_system, source_type, source_id, error_message, payload_json, status)
       VALUES (?,?,?,?,?, 'failed')`,
      [system, type, id || null, String(err?.message || err), payload ? JSON.stringify(payload) : null]
    );
  } catch (_) { /* ignore */ }
}

function postFromSale(saleId) {
  ensureReady();
  try {
    const sale = dbGet(`SELECT * FROM sales WHERE id=?`, [saleId]);
    if (!sale) throw new Error('Sale not found');
    const items = dbAll(`SELECT si.*, p.buying_price FROM sale_items si LEFT JOIN products p ON p.id = si.product_id WHERE si.sale_id=?`, [saleId]);
    let payments = [];
    try { payments = dbAll(`SELECT * FROM sale_payments WHERE sale_id=?`, [saleId]); } catch (_) { /* optional */ }
    if (!payments.length) {
      payments = [{ method: sale.payment_method || 'cash', amount: sale.total }];
    }
    const d = defaults();
    const total = round2(sale.total);
    const tax = round2(sale.tax_amount || 0);
    const netSales = round2(total - tax);
    const lines = [];

    payments.forEach((p) => {
      const amt = round2(p.amount);
      if (amt <= 0) return;
      lines.push({
        account_id: tenderAccount(p.method || p.payment_method),
        debit: amt, credit: 0,
        description: `Sale ${sale.receipt_number || saleId} ${p.method || ''}`,
        customer_id: sale.customer_id || null
      });
    });
    const paid = round2(payments.reduce((s, p) => s + num(p.amount), 0));
    if (paid < total - 0.01 && sale.customer_id) {
      lines.push({ account_id: d.ar, debit: round2(total - paid), credit: 0, description: 'On account', customer_id: sale.customer_id });
    }
    lines.push({ account_id: d.sales, debit: 0, credit: netSales, description: 'Sales revenue' });
    if (tax > 0) lines.push({ account_id: d.vatOut, debit: 0, credit: tax, description: 'Output VAT' });

    let cogs = 0;
    items.forEach((it) => {
      cogs += num(it.quantity) * num(it.buying_price || it.cost || 0);
    });
    cogs = round2(cogs);
    if (cogs > 0) {
      lines.push({ account_id: d.cogs, debit: cogs, credit: 0, description: 'COGS' });
      lines.push({ account_id: d.inventory, debit: 0, credit: cogs, description: 'Inventory relief' });
    }

    // Balance safety
    let deb = 0; let cre = 0;
    lines.forEach((l) => { deb += num(l.debit); cre += num(l.credit); });
    const diff = round2(deb - cre);
    if (Math.abs(diff) > 0.01) {
      if (diff > 0) lines.push({ account_id: d.sales, debit: 0, credit: diff, description: 'Rounding' });
      else lines.push({ account_id: d.sales, debit: Math.abs(diff), credit: 0, description: 'Rounding' });
    }

    return postJournal({
      date: String(sale.created_at || today()).slice(0, 10),
      type: 'sale',
      description: `POS Sale ${sale.receipt_number || saleId}`,
      reference: sale.receipt_number || String(saleId),
      source_type: 'sale',
      source_id: saleId,
      event_key: 'sale_main',
      branch_id: sale.branch_id || null,
      lines,
      status: 'posted'
    }, SYSTEM_ACTOR);
  } catch (err) {
    queueIntegrationError('pos', 'sale', saleId, err);
    throw err;
  }
}

/** Post journal from a sale snapshot (central ledger / cross-device integration). */
function postFromSaleSnapshot(snapshot = {}, stableSourceId = null) {
  ensureReady();
  try {
    const sale = snapshot.sale;
    if (!sale) throw new Error('Sale snapshot missing');
    const items = Array.isArray(snapshot.items) ? snapshot.items : [];
    let payments = Array.isArray(snapshot.payments) ? snapshot.payments : [];
    if (!payments.length) {
      payments = [{ method: sale.payment_method || 'cash', amount: sale.total }];
    }
    const saleId = stableSourceId || sale.id;
    const sourceLabel = sale.order_source === 'ONLINE' || sale.order_type === 'online'
      ? 'Online order'
      : 'POS Sale';
    const d = defaults();
    const total = round2(sale.total);
    const tax = round2(sale.tax_amount || 0);
    const netSales = round2(total - tax);
    const lines = [];

    payments.forEach((p) => {
      const amt = round2(p.amount);
      if (amt <= 0) return;
      lines.push({
        account_id: tenderAccount(p.method || p.payment_method || p.type),
        debit: amt, credit: 0,
        description: `${sourceLabel} ${sale.receipt_number || saleId} ${p.method || p.type || ''}`,
        customer_id: sale.customer_id || null
      });
    });
    const paid = round2(payments.reduce((s, p) => s + num(p.amount), 0));
    if (paid < total - 0.01 && sale.customer_id) {
      lines.push({ account_id: d.ar, debit: round2(total - paid), credit: 0, description: 'On account', customer_id: sale.customer_id });
    }
    lines.push({ account_id: d.sales, debit: 0, credit: netSales, description: 'Sales revenue' });
    if (tax > 0) lines.push({ account_id: d.vatOut, debit: 0, credit: tax, description: 'Output VAT' });

    let cogs = 0;
    items.forEach((it) => {
      cogs += num(it.quantity) * num(it.buying_price || it.cost || 0);
    });
    cogs = round2(cogs);
    if (cogs > 0) {
      lines.push({ account_id: d.cogs, debit: cogs, credit: 0, description: 'COGS' });
      lines.push({ account_id: d.inventory, debit: 0, credit: cogs, description: 'Inventory relief' });
    }

    let deb = 0; let cre = 0;
    lines.forEach((l) => { deb += num(l.debit); cre += num(l.credit); });
    const diff = round2(deb - cre);
    if (Math.abs(diff) > 0.01) {
      if (diff > 0) lines.push({ account_id: d.sales, debit: 0, credit: diff, description: 'Rounding' });
      else lines.push({ account_id: d.sales, debit: Math.abs(diff), credit: 0, description: 'Rounding' });
    }

    return postJournal({
      date: String(sale.created_at || today()).slice(0, 10),
      type: sale.order_type === 'online' ? 'online_sale' : 'sale',
      description: `${sourceLabel} ${sale.receipt_number || saleId}`,
      reference: sale.receipt_number || String(saleId),
      source_type: 'sale',
      source_id: saleId,
      event_key: 'sale_main',
      branch_id: sale.branch_id || null,
      lines,
      status: 'posted',
      notes: sale.order_source ? `source=${sale.order_source}` : null
    }, SYSTEM_ACTOR);
  } catch (err) {
    queueIntegrationError('pos', 'sale', snapshot?.sale?.id, err, snapshot);
    throw err;
  }
}

function reverseSaleAccounting(saleId, reason) {
  ensureReady();
  const sale = dbGet(`SELECT * FROM sales WHERE id=?`, [saleId]);
  if (!sale) return null;

  const voidReason = reason || 'Sale voided';
  const actor = { id: null, username: 'system', role: 'owner', full_name: voidReason };

  let journal = dbGet(
    `SELECT id FROM acc_journals WHERE source_type='sale' AND source_id=? AND event_key='sale_main' AND status='posted'`,
    [saleId]
  );
  if (!journal) {
    try {
      const central = require('./accounting-central');
      const sid = central.stableSourceId(central.deviceUid(), saleId, sale.receipt_number);
      journal = dbGet(
        `SELECT id FROM acc_journals WHERE source_type='sale' AND source_id=? AND event_key='sale_main' AND status='posted'`,
        [sid]
      );
    } catch (_) { /* ignore */ }
  }
  if (!journal && sale.receipt_number) {
    journal = dbGet(
      `SELECT id FROM acc_journals WHERE source_type='sale' AND reference=? AND event_key='sale_main' AND status='posted'`,
      [sale.receipt_number]
    );
  }
  if (journal) return reverseJournal(journal.id, actor);

  try {
    const central = require('./accounting-central');
    if (central.isLocalInstallerProcess()) {
      central.runIntegration('reverseSale', saleId, voidReason);
    }
  } catch (_) { /* ignore */ }
  return null;
}

function reverseSaleAccountingSnapshot(snapshot = {}, stableSourceId = null, reason) {
  ensureReady();
  const sale = snapshot.sale;
  if (!sale) throw new Error('Sale snapshot missing for reversal');
  const saleId = stableSourceId || sale.id;
  const voidReason = reason || snapshot.reason || 'Sale voided';
  const actor = SYSTEM_ACTOR;

  const existing = dbGet(
    `SELECT id FROM acc_journals WHERE source_type='sale' AND source_id=? AND event_key='sale_main' AND status='posted'`,
    [saleId]
  );
  if (!existing && sale.receipt_number) {
    const byRef = dbGet(
      `SELECT id FROM acc_journals WHERE source_type='sale' AND reference=? AND event_key='sale_main' AND status='posted'`,
      [sale.receipt_number]
    );
    if (byRef) return reverseJournal(byRef.id, actor);
  }
  if (!existing) return null;
  return reverseJournal(existing.id, actor);
}

function postFromExpense(expenseId) {
  ensureReady();
  try {
    const e = dbGet(`SELECT * FROM expenses WHERE id=?`, [expenseId]);
    if (!e) throw new Error('Expense not found');
    const d = defaults();
    const amt = round2(e.amount);
    const lines = [
      { account_id: d.expense, debit: amt, credit: 0, description: e.category || e.description || 'Expense' },
      { account_id: tenderAccount(e.payment_method), debit: 0, credit: amt, description: 'Expense payment' }
    ];
    return postJournal({
      date: String(e.expense_date || e.created_at || today()).slice(0, 10),
      type: 'expense',
      description: e.description || e.category || 'Expense',
      source_type: 'expense', source_id: expenseId, event_key: 'expense_main',
      lines, status: 'posted'
    }, { id: e.created_by, role: 'owner', username: 'system', full_name: 'Expense sync' });
  } catch (err) {
    queueIntegrationError('expenses', 'expense', expenseId, err);
    throw err;
  }
}

function postFromPurchaseReceive(poId) {
  ensureReady();
  try {
    const po = dbGet(`SELECT * FROM purchase_orders WHERE id=?`, [poId]);
    if (!po) throw new Error('PO not found');
    const items = dbAll(`SELECT * FROM purchase_order_items WHERE purchase_order_id=?`, [poId]);
    const d = defaults();
    let sub = 0;
    items.forEach((it) => { sub += num(it.quantity) * num(it.unit_cost || it.buying_price || it.cost || 0); });
    sub = round2(sub || po.total || 0);
    const tax = round2(po.tax_amount || po.vat_amount || 0);
    const total = round2(sub + tax);
    const lines = [
      { account_id: d.inventory, debit: sub, credit: 0, description: `PO #${poId} inventory`, supplier_id: po.supplier_id },
      { account_id: d.ap, debit: 0, credit: total, description: `PO #${poId} payable`, supplier_id: po.supplier_id }
    ];
    if (tax > 0) lines.splice(1, 0, { account_id: d.vatIn, debit: tax, credit: 0, description: 'Input VAT', supplier_id: po.supplier_id });
    return postJournal({
      date: today(), type: 'purchase', description: `Stock received PO #${poId}`,
      source_type: 'purchase_order', source_id: poId, event_key: 'po_receive',
      lines, status: 'posted'
    }, { role: 'owner', username: 'system', full_name: 'PO sync' });
  } catch (err) {
    queueIntegrationError('purchasing', 'purchase_order', poId, err);
    throw err;
  }
}

function postFromSupplierPayment(paymentId) {
  ensureReady();
  try {
    let p = null;
    try { p = dbGet(`SELECT * FROM supplier_payments WHERE id=?`, [paymentId]); } catch (_) { return null; }
    if (!p) return null;
    const d = defaults();
    const amt = round2(p.amount);
    const lines = [
      { account_id: d.ap, debit: amt, credit: 0, description: 'Supplier payment', supplier_id: p.supplier_id },
      { account_id: tenderAccount(p.payment_method), debit: 0, credit: amt, description: 'Payment out' }
    ];
    return postJournal({
      date: String(p.payment_date || p.created_at || today()).slice(0, 10),
      type: 'payment', description: 'Supplier payment',
      source_type: 'supplier_payment', source_id: paymentId, event_key: 'supplier_pay',
      lines, status: 'posted'
    }, { role: 'owner', username: 'system', full_name: 'Supplier pay sync' });
  } catch (err) {
    queueIntegrationError('purchasing', 'supplier_payment', paymentId, err);
    throw err;
  }
}

function postFromCustomerCreditPayment(ledgerId) {
  ensureReady();
  try {
    const row = dbGet(`SELECT * FROM customer_credit_ledger WHERE id=?`, [ledgerId]);
    if (!row) return null;
    return postFromCustomerCreditPaymentSnapshot({ ledger: row }, ledgerId);
  } catch (err) {
    queueIntegrationError('customers', 'credit_ledger', ledgerId, err);
    throw err;
  }
}

function postFromExpenseSnapshot(snapshot = {}, stableSourceId = null, meta = {}) {
  ensureReady();
  const e = snapshot.expense;
  if (!e) throw new Error('Expense snapshot missing');
  const expenseId = stableSourceId || e.id;
  const voided = !!(meta.void || snapshot.void);
  const existing = dbGet(
    `SELECT id FROM acc_journals WHERE source_type='expense' AND source_id=? AND event_key='expense_main' AND status='posted'`,
    [expenseId]
  );
  if (voided) {
    if (existing) return reverseJournal(existing.id, SYSTEM_ACTOR);
    return null;
  }
  if (existing && meta.repost) reverseJournal(existing.id, SYSTEM_ACTOR);
  else if (existing) return getJournal(existing.id);
  const d = defaults();
  const amt = round2(e.amount);
  if (amt <= 0) return null;
  const lines = [
    { account_id: d.expense, debit: amt, credit: 0, description: e.category || e.description || 'Expense' },
    { account_id: tenderAccount(e.payment_method), debit: 0, credit: amt, description: 'Expense payment' }
  ];
  return postJournal({
    date: String(e.expense_date || e.created_at || today()).slice(0, 10),
    type: 'expense',
    description: e.description || e.category || 'Expense',
    reference: e.reference || `EXP-${e.id}`,
    source_type: 'expense', source_id: expenseId, event_key: 'expense_main',
    lines, status: 'posted'
  }, SYSTEM_ACTOR);
}

function postFromPurchaseReceiveSnapshot(snapshot = {}, stableSourceId = null) {
  ensureReady();
  const po = snapshot.po;
  if (!po) throw new Error('Purchase order snapshot missing');
  const poId = stableSourceId || po.id;
  const existing = dbGet(
    `SELECT id FROM acc_journals WHERE source_type='purchase_order' AND source_id=? AND event_key='po_receive' AND status='posted'`,
    [poId]
  );
  if (existing) return getJournal(existing.id);
  const items = Array.isArray(snapshot.items) ? snapshot.items : [];
  const d = defaults();
  let sub = 0;
  items.forEach((it) => { sub += num(it.quantity) * num(it.unit_cost || it.buying_price || it.cost || 0); });
  sub = round2(sub || po.total || 0);
  const tax = round2(po.tax_amount || po.vat_amount || 0);
  const total = round2(sub + tax);
  const ref = po.po_number || po.reference || `PO-${po.id}`;
  const lines = [
    { account_id: d.inventory, debit: sub, credit: 0, description: `${ref} inventory`, supplier_id: po.supplier_id },
    { account_id: d.ap, debit: 0, credit: total, description: `${ref} payable`, supplier_id: po.supplier_id }
  ];
  if (tax > 0) lines.splice(1, 0, { account_id: d.vatIn, debit: tax, credit: 0, description: 'Input VAT', supplier_id: po.supplier_id });
  return postJournal({
    date: String(po.received_at || po.updated_at || po.created_at || today()).slice(0, 10),
    type: 'purchase', description: `Stock received ${ref}`,
    reference: ref,
    source_type: 'purchase_order', source_id: poId, event_key: 'po_receive',
    lines, status: 'posted'
  }, SYSTEM_ACTOR);
}

function postFromSupplierPaymentSnapshot(snapshot = {}, stableSourceId = null) {
  ensureReady();
  const p = snapshot.payment;
  if (!p) throw new Error('Supplier payment snapshot missing');
  const paymentId = stableSourceId || p.id;
  const existing = dbGet(
    `SELECT id FROM acc_journals WHERE source_type='supplier_payment' AND source_id=? AND event_key='supplier_pay' AND status='posted'`,
    [paymentId]
  );
  if (existing) return getJournal(existing.id);
  const d = defaults();
  const amt = round2(p.amount);
  if (amt <= 0) return null;
  const ref = p.reference || p.payment_reference || `SPAY-${p.id}`;
  const lines = [
    { account_id: d.ap, debit: amt, credit: 0, description: 'Supplier payment', supplier_id: p.supplier_id },
    { account_id: tenderAccount(p.payment_method), debit: 0, credit: amt, description: 'Payment out' }
  ];
  return postJournal({
    date: String(p.payment_date || p.created_at || today()).slice(0, 10),
    type: 'payment', description: 'Supplier payment',
    reference: ref,
    source_type: 'supplier_payment', source_id: paymentId, event_key: 'supplier_pay',
    lines, status: 'posted'
  }, SYSTEM_ACTOR);
}

function postFromReturnSnapshot(snapshot = {}, stableSourceId = null) {
  ensureReady();
  const ret = snapshot.return;
  if (!ret) throw new Error('Return snapshot missing');
  const returnId = stableSourceId || ret.id;
  const existing = dbGet(
    `SELECT id FROM acc_journals WHERE source_type='return' AND source_id=? AND event_key='return_main' AND status='posted'`,
    [returnId]
  );
  if (existing) return getJournal(existing.id);
  const sale = snapshot.sale;
  const amt = round2(ret.total_refund);
  if (amt <= 0) return null;
  const d = defaults();
  const method = ret.refund_method || 'cash';
  const lines = [
    { account_id: d.sales, debit: amt, credit: 0, description: `Refund ${ret.return_number || returnId}` },
    { account_id: tenderAccount(method), debit: 0, credit: amt, description: 'Refund paid out' }
  ];
  let cogs = 0;
  const items = Array.isArray(snapshot.items) ? snapshot.items : [];
  items.forEach((it) => { cogs += num(it.quantity) * num(it.buying_price || it.cost || 0); });
  cogs = round2(cogs);
  if (cogs > 0) {
    lines.push({ account_id: d.inventory, debit: cogs, credit: 0, description: 'Inventory return' });
    lines.push({ account_id: d.cogs, debit: 0, credit: cogs, description: 'COGS reversal' });
  }
  const saleRef = sale?.receipt_number || ret.return_number || String(returnId);
  return postJournal({
    date: String(ret.created_at || today()).slice(0, 10),
    type: 'refund',
    description: `POS Return ${ret.return_number || returnId}`,
    reference: saleRef,
    source_type: 'return', source_id: returnId, event_key: 'return_main',
    lines, status: 'posted'
  }, SYSTEM_ACTOR);
}

function postFromCustomerCreditPaymentSnapshot(snapshot = {}, stableSourceId = null) {
  ensureReady();
  const row = snapshot.ledger || snapshot;
  if (!row || String(row.type || '').toLowerCase() !== 'payment') return null;
  const ledgerId = stableSourceId || row.id;
  const existing = dbGet(
    `SELECT id FROM acc_journals WHERE source_type='customer_credit' AND source_id=? AND event_key='ccp_pay' AND status='posted'`,
    [ledgerId]
  );
  if (existing) return getJournal(existing.id);
  const amt = round2(Math.abs(row.amount || row.payment_amount || 0));
  if (amt <= 0) return null;
  const d = defaults();
  const lines = [
    { account_id: tenderAccount(row.payment_method), debit: amt, credit: 0, description: 'Customer receipt', customer_id: row.customer_id },
    { account_id: d.ar, debit: 0, credit: amt, description: 'AR reduction', customer_id: row.customer_id }
  ];
  return postJournal({
    date: String(row.created_at || today()).slice(0, 10),
    type: 'receipt', description: 'Customer credit payment',
    reference: row.reference || `CCP-${row.id}`,
    source_type: 'customer_credit', source_id: ledgerId, event_key: 'ccp_pay',
    lines, status: 'posted'
  }, SYSTEM_ACTOR);
}

function postFromPayroll(payrollId) {
  ensureReady();
  try {
    const existing = dbGet(`SELECT id FROM acc_journals WHERE source_type='employee_payroll' AND source_id=? AND event_key='payroll_main'`, [payrollId]);
    if (existing) return getJournal(existing.id);
    const p = dbGet(`SELECT p.*, e.full_name FROM employee_payroll p JOIN employees e ON e.id=p.employee_id WHERE p.id=?`, [payrollId]);
    if (!p) throw new Error('Payroll not found');
    if (p.status !== 'paid') throw new Error('Payroll must be paid before posting to accounting');
    const gross = round2(p.gross_salary || num(p.basic_salary) + num(p.overtime_pay) + num(p.bonus) + num(p.commission) + num(p.allowances));
    const employerCosts = round2(num(p.uif_employer) + num(p.sdl) + num(p.coida) + num(p.employer_pension) + num(p.employer_medical) + num(p.employer_other));
    const totalExpense = round2(gross + employerCosts);
    const net = round2(p.net_salary);
    const lines = [
      { account_id: 32, debit: totalExpense, credit: 0, description: `Payroll — ${p.full_name}`, employee_id: p.employee_id }
    ];
    if (net > 0) {
      lines.push({
        account_id: tenderAccount(p.payment_method || 'eft'), debit: 0, credit: net,
        description: 'Net salary payment', employee_id: p.employee_id
      });
    }
    const liabilityAmt = round2(totalExpense - net);
    if (liabilityAmt > 0.009) {
      lines.push({
        account_id: 16, debit: 0, credit: liabilityAmt,
        description: 'Payroll liabilities & deductions', employee_id: p.employee_id
      });
    }
    const journal = postJournal({
      date: String(p.paid_at || p.period_end || today()).slice(0, 10),
      type: 'payroll',
      description: `Payroll ${p.period_start}–${p.period_end} — ${p.full_name}`,
      source_type: 'employee_payroll', source_id: payrollId, event_key: 'payroll_main',
      lines, status: 'posted'
    }, SYSTEM_ACTOR);
    return journal;
  } catch (err) {
    queueIntegrationError('payroll', 'employee_payroll', payrollId, err);
    throw err;
  }
}

function postFromPayrollSnapshot(snapshot = {}, stableSourceId = null) {
  ensureReady();
  const p = snapshot.payroll || snapshot;
  if (!p) throw new Error('Payroll snapshot missing');
  const payrollId = stableSourceId || p.id;
  try {
    const existing = dbGet(`SELECT id FROM acc_journals WHERE source_type='employee_payroll' AND source_id=? AND event_key='payroll_main'`, [payrollId]);
    if (existing) return getJournal(existing.id);
    const gross = round2(p.gross_salary || num(p.basic_salary) + num(p.overtime_pay) + num(p.bonus) + num(p.commission) + num(p.allowances));
    const employerCosts = round2(num(p.uif_employer) + num(p.sdl) + num(p.coida) + num(p.employer_pension) + num(p.employer_medical) + num(p.employer_other));
    const totalExpense = round2(gross + employerCosts);
    const net = round2(p.net_salary);
    const name = p.full_name || p.employee_name || 'Employee';
    const lines = [
      { account_id: 32, debit: totalExpense, credit: 0, description: `Payroll — ${name}`, employee_id: p.employee_id }
    ];
    if (net > 0) {
      lines.push({
        account_id: tenderAccount(p.payment_method || 'eft'), debit: 0, credit: net,
        description: 'Net salary payment', employee_id: p.employee_id
      });
    }
    const liabilityAmt = round2(totalExpense - net);
    if (liabilityAmt > 0.009) {
      lines.push({
        account_id: 16, debit: 0, credit: liabilityAmt,
        description: 'Payroll liabilities & deductions', employee_id: p.employee_id
      });
    }
    return postJournal({
      date: String(p.paid_at || p.period_end || today()).slice(0, 10),
      type: 'payroll',
      description: `Payroll ${p.period_start}–${p.period_end} — ${name}`,
      source_type: 'employee_payroll', source_id: payrollId, event_key: 'payroll_main',
      lines, status: 'posted'
    }, SYSTEM_ACTOR);
  } catch (err) {
    queueIntegrationError('payroll', 'employee_payroll', payrollId, err, snapshot);
    throw err;
  }
}

function postFromCashup(cashupId, data = {}) {
  ensureReady();
  const sourceId = data.cashup_id != null ? data.cashup_id : cashupId;
  const existingFinance = dbGet(
    `SELECT * FROM acc_cashup_finance WHERE cashup_id=?`,
    [sourceId]
  );
  if (existingFinance) return existingFinance;
  const expected = num(data.expected_cash) + num(data.expected_card) + num(data.expected_eft);
  const actual = num(data.actual_cash) + num(data.actual_card) + num(data.actual_eft);
  const difference = round2(actual - expected);
  const r = dbRun(
    `INSERT INTO acc_cashup_finance (cashup_id, shift_id, cashup_date, cashier_name,
      expected_cash, expected_card, expected_eft, actual_cash, actual_card, actual_eft,
      difference, reason, approved_by, approved_by_name)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      sourceId || null, data.shift_id || null, data.cashup_date || today(), data.cashier_name || null,
      num(data.expected_cash), num(data.expected_card), num(data.expected_eft),
      num(data.actual_cash), num(data.actual_card), num(data.actual_eft),
      difference, textOrNull(data.reason), data.approved_by || null, data.approved_by_name || null
    ]
  );
  let journal = null;
  if (Math.abs(difference) >= 0.01) {
    const d = defaults();
    const lines = difference < 0
      ? [
        { account_id: 43, debit: Math.abs(difference), credit: 0, description: 'Cash-up shortage' },
        { account_id: d.cash, debit: 0, credit: Math.abs(difference), description: 'Cash-up shortage' }
      ]
      : [
        { account_id: d.cash, debit: difference, credit: 0, description: 'Cash-up overage' },
        { account_id: 24, debit: 0, credit: difference, description: 'Cash-up overage' }
      ];
    journal = postJournal({
      date: data.cashup_date || today(), type: 'cashup', description: 'Cash-up variance',
      source_type: 'cashup', source_id: sourceId || r.lastInsertRowid, event_key: 'cashup_var',
      lines, status: 'posted'
    }, SYSTEM_ACTOR);
    dbRun(`UPDATE acc_cashup_finance SET journal_id=? WHERE id=?`, [journal.id, r.lastInsertRowid]);
  }
  return dbGet(`SELECT * FROM acc_cashup_finance WHERE id=?`, [r.lastInsertRowid]);
}

function listIntegrationErrors(filters = {}, actor) {
  requireAccUser(actor);
  let sql = `SELECT * FROM acc_integration_errors WHERE 1=1`;
  const params = [];
  if (filters.status) { sql += ` AND status=?`; params.push(filters.status); }
  sql += ` ORDER BY id DESC LIMIT 200`;
  return dbAll(sql, params);
}

function retryIntegrationError(id, actor) {
  requireAccWrite(actor);
  const row = dbGet(`SELECT * FROM acc_integration_errors WHERE id=?`, [id]);
  if (!row) throw new Error('Error not found');
  try {
    let payload = null;
    try { payload = row.payload_json ? JSON.parse(row.payload_json) : null; } catch (_) { /* */ }
    const central = require('./accounting-central');
    if (payload?.hook && payload?.snapshot) {
      central.runIntegratePayload(payload);
    } else if (row.source_type === 'sale') postFromSale(row.source_id);
    else if (row.source_type === 'expense') postFromExpense(row.source_id);
    else if (row.source_type === 'purchase_order') postFromPurchaseReceive(row.source_id);
    else if (row.source_type === 'employee_payroll') postFromPayroll(row.source_id);
    else if (row.source_type === 'return') postFromReturn(row.source_id);
    else if (row.source_type === 'supplier_payment') postFromSupplierPayment(row.source_id);
    else if (row.source_type === 'customer_credit') postFromCustomerCreditPayment(row.source_id);
    else if (row.source_type === 'cashup') {
      const fin = dbGet(`SELECT * FROM acc_cashup_finance WHERE cashup_id=?`, [row.source_id]);
      if (fin) {
        postFromCashup(fin.cashup_id, {
          shift_id: fin.shift_id, cashup_date: fin.cashup_date, cashier_name: fin.cashier_name,
          expected_cash: fin.expected_cash, expected_card: fin.expected_card, expected_eft: fin.expected_eft,
          actual_cash: fin.actual_cash, actual_card: fin.actual_card, actual_eft: fin.actual_eft,
          reason: fin.reason, cashup_id: fin.cashup_id
        });
      } else {
        const built = central.buildIntegrationPayload('postFromCashup', [row.source_id, {}]);
        if (built?.snapshot) central.runIntegratePayload(built);
        else throw new Error('Cash-up snapshot not available for retry');
      }
    } else throw new Error(`Unsupported integration source: ${row.source_type}`);
    dbRun(`UPDATE acc_integration_errors SET status='resolved', retry_count=retry_count+1, last_retry_at=datetime('now') WHERE id=?`, [id]);
    return { success: true };
  } catch (err) {
    dbRun(`UPDATE acc_integration_errors SET retry_count=retry_count+1, last_retry_at=datetime('now'), error_message=? WHERE id=?`, [err.message, id]);
    throw err;
  }
}

/* ─── Documents AR/AP (condensed but working) ─── */

function listInvoices(filters = {}, actor) {
  requireAccUser(actor);
  let sql = `SELECT * FROM acc_invoices WHERE 1=1`;
  const params = [];
  if (filters.status) { sql += ` AND status=?`; params.push(filters.status); }
  if (filters.customer_id) { sql += ` AND customer_id=?`; params.push(filters.customer_id); }
  sql += ` ORDER BY invoice_date DESC, id DESC LIMIT 200`;
  return dbAll(sql, params);
}

function getInvoice(id) {
  const inv = dbGet(`SELECT * FROM acc_invoices WHERE id=?`, [id]);
  if (!inv) return null;
  inv.lines = dbAll(`SELECT * FROM acc_invoice_lines WHERE invoice_id=?`, [id]);
  return inv;
}

function saveInvoice(data = {}, actor) {
  const user = requireAccWrite(actor);
  let lines = data.lines || [];
  const amount = num(data.amount);
  if (!lines.length && amount > 0) {
    lines = [{
      description: data.notes || data.description || 'Invoice line',
      quantity: 1,
      unit_price: amount,
      discount: 0,
      tax_amount: 0
    }];
  }
  let subtotal = 0; let taxTotal = 0;
  lines.forEach((l) => {
    const lt = round2(num(l.quantity, 1) * num(l.unit_price) - num(l.discount));
    subtotal += lt;
    taxTotal += num(l.tax_amount);
  });
  subtotal = round2(subtotal); taxTotal = round2(taxTotal);
  const total = round2(subtotal + taxTotal);
  const customerName = textOrNull(data.customer_name || data.customer);
  const invoiceDate = data.invoice_date || data.date || today();
  if (data.id) {
    dbRun(
      `UPDATE acc_invoices SET customer_id=?, customer_name=?, invoice_date=?, due_date=?, status=?,
        subtotal=?, tax_total=?, total=?, balance=?, notes=?, updated_at=datetime('now') WHERE id=?`,
      [data.customer_id || null, customerName, invoiceDate, data.due_date || null,
        data.status || 'draft', subtotal, taxTotal, total, total - num(data.amount_paid), textOrNull(data.notes), data.id]
    );
    dbRun(`DELETE FROM acc_invoice_lines WHERE invoice_id=?`, [data.id]);
    lines.forEach((l) => {
      const lt = round2(num(l.quantity, 1) * num(l.unit_price) - num(l.discount));
      dbRun(`INSERT INTO acc_invoice_lines (invoice_id, product_id, description, quantity, unit_price, discount, tax_rate_id, tax_amount, line_total)
             VALUES (?,?,?,?,?,?,?,?,?)`,
        [data.id, l.product_id || null, l.description || 'Item', num(l.quantity, 1), num(l.unit_price), num(l.discount),
          l.tax_rate_id || null, num(l.tax_amount), lt]);
    });
    return getInvoice(data.id);
  }
  const number = nextNumber('invoice_prefix', 'invoice_next');
  const r = dbRun(
    `INSERT INTO acc_invoices (invoice_number, customer_id, customer_name, invoice_date, due_date, status,
      subtotal, tax_total, total, balance, notes, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [number, data.customer_id || null, customerName, invoiceDate, data.due_date || null,
      'draft', subtotal, taxTotal, total, total, textOrNull(data.notes), user.id]
  );
  lines.forEach((l) => {
    const lt = round2(num(l.quantity, 1) * num(l.unit_price) - num(l.discount));
    dbRun(`INSERT INTO acc_invoice_lines (invoice_id, product_id, description, quantity, unit_price, discount, tax_rate_id, tax_amount, line_total)
           VALUES (?,?,?,?,?,?,?,?,?)`,
      [r.lastInsertRowid, l.product_id || null, l.description || 'Item', num(l.quantity, 1), num(l.unit_price), num(l.discount),
        l.tax_rate_id || null, num(l.tax_amount), lt]);
  });
  return getInvoice(r.lastInsertRowid);
}

function postInvoice(id, actor) {
  const user = requireAccWrite(actor);
  const inv = getInvoice(id);
  if (!inv) throw new Error('Invoice not found');
  if (inv.status === 'paid' || inv.journal_id) throw new Error('Invoice already posted');
  const d = defaults();
  const lines = [
    { account_id: d.ar, debit: inv.total, credit: 0, description: inv.invoice_number, customer_id: inv.customer_id },
    { account_id: d.sales, debit: 0, credit: inv.subtotal, description: 'Invoice sales' }
  ];
  if (inv.tax_total > 0) lines.push({ account_id: d.vatOut, debit: 0, credit: inv.tax_total, description: 'Output VAT' });
  const j = postJournal({
    date: inv.invoice_date, type: 'invoice', description: `Invoice ${inv.invoice_number}`,
    source_type: 'invoice', source_id: id, event_key: 'invoice_post', lines, status: 'posted'
  }, user);
  dbRun(`UPDATE acc_invoices SET status='sent', journal_id=?, updated_at=datetime('now') WHERE id=?`, [j.id, id]);
  return getInvoice(id);
}

function listCreditNotes(filters = {}, actor) {
  requireAccUser(actor);
  return dbAll(`SELECT * FROM acc_credit_notes ORDER BY id DESC LIMIT 200`);
}

function saveCreditNote(data = {}, actor) {
  const user = requireAccWrite(actor);
  const total = round2(num(data.total) || num(data.amount));
  const taxTotal = round2(num(data.tax_total));
  const noteDate = data.note_date || data.date || today();
  const reason = textOrNull(data.reason || data.notes || data.reference);
  let customerId = data.customer_id || null;
  if (!customerId && data.customer) {
    const n = Number(data.customer);
    if (Number.isFinite(n) && n > 0) customerId = n;
    else {
      const row = dbGet(`SELECT id FROM customers WHERE name LIKE ? LIMIT 1`, [`%${String(data.customer).trim()}%`]);
      customerId = row?.id || null;
    }
  }
  if (data.id) {
    dbRun(`UPDATE acc_credit_notes SET invoice_id=?, customer_id=?, note_date=?, reason=?, total=?, tax_total=?, status=? WHERE id=?`,
      [data.invoice_id || null, customerId, noteDate, reason,
        total, taxTotal, data.status || 'draft', data.id]);
    return dbGet(`SELECT * FROM acc_credit_notes WHERE id=?`, [data.id]);
  }
  const number = nextNumber('credit_note_prefix', 'credit_note_next');
  const r = dbRun(
    `INSERT INTO acc_credit_notes (credit_note_number, invoice_id, customer_id, note_date, reason, total, tax_total, status, created_by)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [number, data.invoice_id || null, customerId, noteDate, reason,
      total, taxTotal, 'draft', user.id]
  );
  const newId = r.lastInsertRowid || dbGet(`SELECT id FROM acc_credit_notes WHERE credit_note_number=?`, [number])?.id;
  return dbGet(`SELECT * FROM acc_credit_notes WHERE id=?`, [newId]);
}

function postCreditNote(id, actor) {
  const user = requireAccWrite(actor);
  const cn = dbGet(`SELECT * FROM acc_credit_notes WHERE id=?`, [id]);
  if (!cn) throw new Error('Credit note not found');
  const existing = dbGet(
    `SELECT id FROM acc_journals WHERE source_type='credit_note' AND source_id=? AND event_key='cn_post' AND status='posted'`,
    [id]
  );
  if (existing) return dbGet(`SELECT * FROM acc_credit_notes WHERE id=?`, [id]);
  const d = defaults();
  const net = round2(num(cn.total) - num(cn.tax_total));
  const lines = [
    { account_id: d.sales, debit: net, credit: 0, description: cn.credit_note_number },
    { account_id: d.ar, debit: 0, credit: num(cn.total), description: 'Credit note AR', customer_id: cn.customer_id }
  ];
  if (cn.tax_total > 0) lines.splice(1, 0, { account_id: d.vatOut, debit: num(cn.tax_total), credit: 0, description: 'VAT reverse' });
  const j = postJournal({
    date: cn.note_date, type: 'credit_note', description: cn.credit_note_number,
    source_type: 'credit_note', source_id: id, event_key: 'cn_post', lines, status: 'posted'
  }, user);
  dbRun(`UPDATE acc_credit_notes SET status='posted', journal_id=? WHERE id=?`, [j.id, id]);
  return dbGet(`SELECT * FROM acc_credit_notes WHERE id=?`, [id]);
}

function listDebitNotes(actor) {
  requireAccUser(actor);
  return dbAll(`SELECT * FROM acc_debit_notes ORDER BY id DESC LIMIT 200`);
}

function saveDebitNote(data = {}, actor) {
  const user = requireAccWrite(actor);
  const total = round2(num(data.total) || num(data.amount));
  const taxTotal = round2(num(data.tax_total));
  const noteDate = data.note_date || data.date || today();
  const reason = textOrNull(data.reason || data.notes || data.reference);
  let supplierId = data.supplier_id || null;
  if (!supplierId && data.supplier) {
    const n = Number(data.supplier);
    if (Number.isFinite(n) && n > 0) supplierId = n;
    else {
      const row = dbGet(`SELECT id FROM suppliers WHERE name LIKE ? LIMIT 1`, [`%${String(data.supplier).trim()}%`]);
      supplierId = row?.id || null;
    }
  }
  const number = data.id ? null : nextNumber('debit_note_prefix', 'debit_note_next');
  if (data.id) {
    dbRun(`UPDATE acc_debit_notes SET bill_id=?, supplier_id=?, note_date=?, reason=?, total=?, tax_total=?, status=? WHERE id=?`,
      [data.bill_id || null, supplierId, noteDate, reason,
        total, taxTotal, data.status || 'draft', data.id]);
    return dbGet(`SELECT * FROM acc_debit_notes WHERE id=?`, [data.id]);
  }
  const r = dbRun(
    `INSERT INTO acc_debit_notes (debit_note_number, bill_id, supplier_id, note_date, reason, total, tax_total, status, created_by)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [number, data.bill_id || null, supplierId, noteDate, reason,
      total, taxTotal, 'draft', user.id]
  );
  const newId = r.lastInsertRowid || dbGet(`SELECT id FROM acc_debit_notes WHERE debit_note_number=?`, [number])?.id;
  return dbGet(`SELECT * FROM acc_debit_notes WHERE id=?`, [newId]);
}

function postDebitNote(id, actor) {
  const user = requireAccWrite(actor);
  const dn = dbGet(`SELECT * FROM acc_debit_notes WHERE id=?`, [id]);
  if (!dn) throw new Error('Debit note not found');
  const existing = dbGet(
    `SELECT id FROM acc_journals WHERE source_type='debit_note' AND source_id=? AND event_key='dn_post' AND status='posted'`,
    [id]
  );
  if (existing) return dbGet(`SELECT * FROM acc_debit_notes WHERE id=?`, [id]);
  const d = defaults();
  const net = round2(num(dn.total) - num(dn.tax_total));
  const lines = [
    { account_id: d.ap, debit: num(dn.total), credit: 0, description: dn.debit_note_number, supplier_id: dn.supplier_id },
    { account_id: d.expense, debit: 0, credit: net, description: 'Debit note expense' }
  ];
  if (dn.tax_total > 0) {
    lines.splice(1, 0, { account_id: d.vatIn, debit: 0, credit: num(dn.tax_total), description: 'Input VAT reverse' });
  }
  const j = postJournal({
    date: dn.note_date, type: 'debit_note', description: dn.debit_note_number,
    source_type: 'debit_note', source_id: id, event_key: 'dn_post', lines, status: 'posted'
  }, user);
  dbRun(`UPDATE acc_debit_notes SET status='posted', journal_id=? WHERE id=?`, [j.id, id]);
  return dbGet(`SELECT * FROM acc_debit_notes WHERE id=?`, [id]);
}

function listBills(filters = {}, actor) {
  requireAccUser(actor);
  return dbAll(`SELECT * FROM acc_bills ORDER BY bill_date DESC LIMIT 200`);
}

function saveBill(data = {}, actor) {
  const user = requireAccWrite(actor);
  let lines = data.lines || [];
  const amount = num(data.amount);
  if (!lines.length && amount > 0) {
    lines = [{ description: data.notes || 'Bill line', quantity: 1, unit_price: amount, tax_amount: 0 }];
  }
  let subtotal = 0; let taxTotal = 0;
  lines.forEach((l) => {
    const lt = round2(num(l.quantity, 1) * num(l.unit_price));
    subtotal += lt; taxTotal += num(l.tax_amount);
  });
  subtotal = round2(subtotal); taxTotal = round2(taxTotal);
  const total = round2(subtotal + taxTotal);
  const supplierName = textOrNull(data.supplier_name || data.supplier);
  const billDate = data.bill_date || data.date || today();
  if (data.id) {
    dbRun(`UPDATE acc_bills SET supplier_id=?, supplier_name=?, bill_date=?, due_date=?, status=?, subtotal=?, tax_total=?, total=?, balance=?, notes=?, updated_at=datetime('now') WHERE id=?`,
      [data.supplier_id || null, supplierName, billDate, data.due_date || null,
        data.status || 'draft', subtotal, taxTotal, total, total - num(data.amount_paid), textOrNull(data.notes), data.id]);
    dbRun(`DELETE FROM acc_bill_lines WHERE bill_id=?`, [data.id]);
    lines.forEach((l) => {
      const lt = round2(num(l.quantity, 1) * num(l.unit_price));
      dbRun(`INSERT INTO acc_bill_lines (bill_id, product_id, description, quantity, unit_price, tax_rate_id, tax_amount, line_total, is_inventory)
             VALUES (?,?,?,?,?,?,?,?,?)`,
        [data.id, l.product_id || null, l.description || 'Item', num(l.quantity, 1), num(l.unit_price),
          l.tax_rate_id || null, num(l.tax_amount), lt, l.is_inventory === 0 ? 0 : 1]);
    });
    return dbGet(`SELECT * FROM acc_bills WHERE id=?`, [data.id]);
  }
  const number = nextNumber('bill_prefix', 'bill_next');
  const r = dbRun(
    `INSERT INTO acc_bills (bill_number, supplier_id, supplier_name, bill_date, due_date, status, subtotal, tax_total, total, balance, po_id, notes, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [number, data.supplier_id || null, supplierName, billDate, data.due_date || null,
      'draft', subtotal, taxTotal, total, total, data.po_id || null, textOrNull(data.notes), user.id]
  );
  lines.forEach((l) => {
    const lt = round2(num(l.quantity, 1) * num(l.unit_price));
    dbRun(`INSERT INTO acc_bill_lines (bill_id, product_id, description, quantity, unit_price, tax_rate_id, tax_amount, line_total, is_inventory)
           VALUES (?,?,?,?,?,?,?,?,?)`,
      [r.lastInsertRowid, l.product_id || null, l.description || 'Item', num(l.quantity, 1), num(l.unit_price),
        l.tax_rate_id || null, num(l.tax_amount), lt, l.is_inventory === 0 ? 0 : 1]);
  });
  return dbGet(`SELECT * FROM acc_bills WHERE id=?`, [r.lastInsertRowid]);
}

function postBill(id, actor) {
  const user = requireAccWrite(actor);
  const bill = dbGet(`SELECT * FROM acc_bills WHERE id=?`, [id]);
  if (!bill) throw new Error('Bill not found');
  const linesDb = dbAll(`SELECT * FROM acc_bill_lines WHERE bill_id=?`, [id]);
  const d = defaults();
  const invAmt = round2(linesDb.filter((l) => l.is_inventory).reduce((s, l) => s + num(l.line_total), 0));
  const expAmt = round2(linesDb.filter((l) => !l.is_inventory).reduce((s, l) => s + num(l.line_total), 0));
  const lines = [];
  if (invAmt) lines.push({ account_id: d.inventory, debit: invAmt, credit: 0, description: bill.bill_number, supplier_id: bill.supplier_id });
  if (expAmt) lines.push({ account_id: d.expense, debit: expAmt, credit: 0, description: bill.bill_number, supplier_id: bill.supplier_id });
  if (bill.tax_total > 0) lines.push({ account_id: d.vatIn, debit: bill.tax_total, credit: 0, description: 'Input VAT' });
  lines.push({ account_id: d.ap, debit: 0, credit: bill.total, description: 'Accounts payable', supplier_id: bill.supplier_id });
  const j = postJournal({
    date: bill.bill_date, type: 'bill', description: `Bill ${bill.bill_number}`,
    source_type: 'bill', source_id: id, event_key: 'bill_post', lines, status: 'posted'
  }, user);
  dbRun(`UPDATE acc_bills SET status='open', journal_id=?, updated_at=datetime('now') WHERE id=?`, [j.id, id]);
  return dbGet(`SELECT * FROM acc_bills WHERE id=?`, [id]);
}

function listPayments(filters = {}, actor) {
  requireAccUser(actor);
  return dbAll(`SELECT * FROM acc_payments ORDER BY payment_date DESC LIMIT 200`);
}

function savePayment(data = {}, actor) {
  const user = requireAccWrite(actor);
  const partyType = data.party_type
    || (data.type === 'supplier' || data.supplier ? 'supplier' : (data.type === 'refund' ? 'customer' : 'customer'));
  const partyName = data.party || data.customer || data.supplier || null;
  const id = data.id ? num(data.id) : null;
  if (id) {
    dbRun(
      `UPDATE acc_payments SET payment_date=?, party_type=?, customer_id=?, supplier_id=?, amount=?,
       payment_method=?, bank_account_id=?, cash_account_id=?, reference=?, notes=? WHERE id=? AND status='draft'`,
      [
        data.payment_date || today(),
        data.party_type || (data.supplier_id ? 'supplier' : 'customer'),
        data.customer_id || null, data.supplier_id || null, num(data.amount),
        data.payment_method || 'eft', data.bank_account_id || null, data.cash_account_id || null,
        textOrNull(data.reference), textOrNull(data.notes), id
      ]
    );
    return dbGet(`SELECT * FROM acc_payments WHERE id=?`, [id]);
  }
  const r = dbRun(
    `INSERT INTO acc_payments (payment_number, payment_date, party_type, customer_id, supplier_id, amount,
      payment_method, bank_account_id, cash_account_id, reference, status, notes, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?, 'draft',?,?)`,
    [
      data.payment_number || `PAY-${Date.now()}`, data.payment_date || data.date || today(),
      partyType,
      data.customer_id || (partyType === 'customer' ? null : null),
      data.supplier_id || (partyType === 'supplier' ? null : null),
      num(data.amount),
      data.payment_method || data.method || 'eft', data.bank_account_id || null, data.cash_account_id || null,
      textOrNull(data.reference || partyName), textOrNull(data.notes), user.id
    ]
  );
  const paymentId = r.lastInsertRowid;
  (data.allocations || []).forEach((a) => {
    dbRun(`INSERT INTO acc_payment_allocations (payment_id, doc_type, doc_id, amount) VALUES (?,?,?,?)`,
      [paymentId, a.doc_type, a.doc_id, num(a.amount)]);
  });
  return dbGet(`SELECT * FROM acc_payments WHERE id=?`, [paymentId]);
}

function postPayment(data, actor) {
  const user = requireAccWrite(actor);
  const id = num(typeof data === 'object' ? data.id : data);
  const payment = dbGet(`SELECT * FROM acc_payments WHERE id=?`, [id]);
  if (!payment) throw new Error('Payment not found');
  if (payment.status === 'posted' && payment.journal_id) return payment;
  (data?.allocations || dbAll(`SELECT * FROM acc_payment_allocations WHERE payment_id=?`, [id])).forEach((a) => {
    if (a.doc_type === 'invoice') {
      const inv = dbGet(`SELECT * FROM acc_invoices WHERE id=?`, [a.doc_id]);
      if (inv) {
        const paid = round2(num(inv.amount_paid) + num(a.amount));
        const bal = round2(num(inv.total) - paid);
        dbRun(`UPDATE acc_invoices SET amount_paid=?, balance=?, status=? WHERE id=?`,
          [paid, bal, bal <= 0.01 ? 'paid' : 'partially_paid', a.doc_id]);
      }
    }
    if (a.doc_type === 'bill') {
      const bill = dbGet(`SELECT * FROM acc_bills WHERE id=?`, [a.doc_id]);
      if (bill) {
        const paid = round2(num(bill.amount_paid) + num(a.amount));
        const bal = round2(num(bill.total) - paid);
        dbRun(`UPDATE acc_bills SET amount_paid=?, balance=?, status=? WHERE id=?`,
          [paid, bal, bal <= 0.01 ? 'paid' : 'partial', a.doc_id]);
      }
    }
  });
  const d = defaults();
  const amt = num(payment.amount);
  const lines = payment.party_type === 'supplier' || payment.supplier_id
    ? [
      { account_id: d.ap, debit: amt, credit: 0, description: 'Supplier payment', supplier_id: payment.supplier_id },
      { account_id: tenderAccount(payment.payment_method), debit: 0, credit: amt, description: 'Payment' }
    ]
    : [
      { account_id: tenderAccount(payment.payment_method), debit: amt, credit: 0, description: 'Customer receipt', customer_id: payment.customer_id },
      { account_id: d.ar, debit: 0, credit: amt, description: 'AR receipt', customer_id: payment.customer_id }
    ];
  const j = postJournal({
    date: payment.payment_date || today(), type: 'payment', description: payment.payment_number || 'Payment',
    source_type: 'payment', source_id: id, event_key: 'payment_post', lines, status: 'posted'
  }, user);
  dbRun(`UPDATE acc_payments SET status='posted', journal_id=? WHERE id=?`, [j.id, id]);
  return dbGet(`SELECT * FROM acc_payments WHERE id=?`, [id]);
}

function listRefunds(actor) {
  requireAccUser(actor);
  return dbAll(`SELECT * FROM acc_refunds ORDER BY id DESC LIMIT 200`);
}

function saveRefund(data = {}, actor) {
  const user = requireAccWrite(actor);
  const existing = data.sale_id
    ? dbGet(`SELECT id FROM acc_refunds WHERE sale_id=? AND status='posted'`, [data.sale_id])
    : null;
  if (existing) throw new Error('Refund already recorded for this sale');
  const r = dbRun(
    `INSERT INTO acc_refunds (refund_number, sale_id, invoice_id, customer_id, refund_date, amount, payment_method, reason, status, created_by)
     VALUES (?,?,?,?,?,?,?,?, 'posted',?)`,
    [`REF-${Date.now()}`, data.sale_id || null, data.invoice_id || null, data.customer_id || null,
      data.refund_date || today(), num(data.amount), data.payment_method || 'cash', textOrNull(data.reason), user.id]
  );
  if (data.sale_id) {
    try { reverseSaleAccounting(data.sale_id, data.reason || 'Refund'); } catch (_) { /* ignore */ }
  }
  return dbGet(`SELECT * FROM acc_refunds WHERE id=?`, [r.lastInsertRowid]);
}

function agingBuckets(rows, dateField, amountField) {
  const todayD = new Date(today());
  const buckets = { current: 0, d30: 0, d60: 0, d90: 0, d120: 0, rows: [] };
  rows.forEach((r) => {
    const due = new Date(String(r[dateField] || r.due_date || r.invoice_date || today()).slice(0, 10));
    const days = Math.floor((todayD - due) / 86400000);
    const amt = num(r[amountField] ?? r.balance);
    let bucket = 'current';
    if (days > 120) bucket = 'd120';
    else if (days > 90) bucket = 'd90';
    else if (days > 60) bucket = 'd60';
    else if (days > 30) bucket = 'd30';
    buckets[bucket] = round2(buckets[bucket] + amt);
    buckets.rows.push({ ...r, days_overdue: Math.max(0, days), bucket });
  });
  return buckets;
}

function arAging(asOf, actor) {
  requireAccUser(actor);
  const rows = dbAll(`SELECT * FROM acc_invoices WHERE balance > 0.01 AND status NOT IN ('cancelled','draft')`);
  return agingBuckets(rows, 'due_date', 'balance');
}

function apAging(asOf, actor) {
  requireAccUser(actor);
  const rows = dbAll(`SELECT * FROM acc_bills WHERE balance > 0.01 AND status NOT IN ('cancelled','draft')`);
  return agingBuckets(rows, 'due_date', 'balance');
}

function customerStatement(customerId, from, to, actor) {
  requireAccUser(actor);
  const customer = dbGet(`SELECT * FROM customers WHERE id=?`, [customerId]);
  const invoices = dbAll(`SELECT * FROM acc_invoices WHERE customer_id=? AND date(invoice_date) BETWEEN date(?) AND date(?) ORDER BY invoice_date`,
    [customerId, from || '2000-01-01', to || today()]);
  const payments = dbAll(`SELECT * FROM acc_payments WHERE customer_id=? AND date(payment_date) BETWEEN date(?) AND date(?) ORDER BY payment_date`,
    [customerId, from || '2000-01-01', to || today()]);
  const opening = 0;
  const closing = round2(invoices.reduce((s, i) => s + num(i.total), 0) - payments.reduce((s, p) => s + num(p.amount), 0));
  return { customer, from, to, opening_balance: opening, invoices, payments, closing_balance: closing };
}

function saveStatementHistory(data = {}, actor) {
  const user = requireAccWrite(actor);
  const stmt = data.statement || data;
  const partyType = data.party_type || stmt.party_type || 'customer';
  const partyId = data.party_id || stmt.customer?.id || stmt.supplier?.id;
  if (!partyId) throw new Error('Party ID required');
  const partyName = stmt.customer?.name || stmt.supplier?.name || data.party_name || null;
  const r = dbRun(
    `INSERT INTO acc_statements (party_type, party_id, party_name, from_date, to_date, opening_balance, closing_balance, statement_json, created_by)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [partyType, partyId, partyName, stmt.from || data.from_date, stmt.to || data.to_date,
      num(stmt.opening_balance), num(stmt.closing_balance), JSON.stringify(stmt), user.id]
  );
  audit(user, 'save_statement', partyType, partyId, null, { from: stmt.from, to: stmt.to, closing: stmt.closing_balance });
  return dbGet(`SELECT * FROM acc_statements WHERE id=?`, [r.lastInsertRowid]);
}

function listStatementHistory(filters = {}, actor) {
  requireAccUser(actor);
  let sql = `SELECT * FROM acc_statements WHERE 1=1`;
  const params = [];
  if (filters.party_type) { sql += ` AND party_type=?`; params.push(filters.party_type); }
  if (filters.party_id) { sql += ` AND party_id=?`; params.push(filters.party_id); }
  sql += ` ORDER BY created_at DESC, id DESC LIMIT 200`;
  return dbAll(sql, params);
}

function getStatementHistory(id, actor) {
  requireAccUser(actor);
  const row = dbGet(`SELECT * FROM acc_statements WHERE id=?`, [id]);
  if (!row) return null;
  row.statement = parseJson(row.statement_json, {});
  return row;
}

function supplierStatement(supplierId, from, to, actor) {
  requireAccUser(actor);
  const supplier = dbGet(`SELECT * FROM suppliers WHERE id=?`, [supplierId]);
  const bills = dbAll(`SELECT * FROM acc_bills WHERE supplier_id=? AND date(bill_date) BETWEEN date(?) AND date(?) ORDER BY bill_date`,
    [supplierId, from || '2000-01-01', to || today()]);
  const payments = dbAll(`SELECT * FROM acc_payments WHERE supplier_id=? AND date(payment_date) BETWEEN date(?) AND date(?) ORDER BY payment_date`,
    [supplierId, from || '2000-01-01', to || today()]);
  const closing = round2(bills.reduce((s, i) => s + num(i.total), 0) - payments.reduce((s, p) => s + num(p.amount), 0));
  return { supplier, from, to, opening_balance: 0, bills, payments, closing_balance: closing };
}

/* Banking / cash */
function listBankAccounts(actor) {
  requireAccUser(actor);
  return dbAll(`SELECT * FROM acc_bank_accounts WHERE is_active=1`).map((a) => {
    const mov = dbGet(`SELECT COALESCE(SUM(CASE WHEN direction='in' THEN amount ELSE -amount END),0) AS bal FROM acc_bank_txns WHERE bank_account_id=?`, [a.id]);
    return { ...a, current_balance: round2(num(a.opening_balance) + num(mov?.bal)) };
  });
}

function saveBankAccount(data = {}, actor) {
  requireAccWrite(actor);
  if (data.id) {
    dbRun(`UPDATE acc_bank_accounts SET name=?, bank_name=?, account_number=?, account_type=?, opening_balance=?, gl_account_id=?, is_active=?, notes=? WHERE id=?`,
      [data.name, textOrNull(data.bank_name), textOrNull(data.account_number), data.account_type || 'cheque',
        num(data.opening_balance), data.gl_account_id || 3, data.is_active === 0 ? 0 : 1, textOrNull(data.notes), data.id]);
    return dbGet(`SELECT * FROM acc_bank_accounts WHERE id=?`, [data.id]);
  }
  const r = dbRun(`INSERT INTO acc_bank_accounts (name, bank_name, account_number, account_type, opening_balance, gl_account_id, notes)
                   VALUES (?,?,?,?,?,?,?)`,
    [data.name, textOrNull(data.bank_name), textOrNull(data.account_number), data.account_type || 'cheque',
      num(data.opening_balance), data.gl_account_id || 3, textOrNull(data.notes)]);
  return dbGet(`SELECT * FROM acc_bank_accounts WHERE id=?`, [r.lastInsertRowid]);
}

function listBankTxns(filters = {}, actor) {
  requireAccUser(actor);
  let sql = `SELECT * FROM acc_bank_txns WHERE 1=1`;
  const params = [];
  if (filters.bank_account_id) { sql += ` AND bank_account_id=?`; params.push(filters.bank_account_id); }
  sql += ` ORDER BY txn_date DESC, id DESC LIMIT 300`;
  return dbAll(sql, params);
}

function saveBankTxn(data = {}, actor) {
  if (data.action === 'create_account') {
    return saveBankAccount({
      name: data.name,
      bank_name: data.name,
      account_number: data.account_number,
      account_type: 'cheque',
      opening_balance: 0
    }, actor);
  }
  const user = requireAccWrite(actor);
  const r = dbRun(
    `INSERT INTO acc_bank_txns (bank_account_id, txn_date, description, reference, amount, direction, txn_type, status, created_by)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [data.bank_account_id, data.txn_date || today(), textOrNull(data.description), textOrNull(data.reference),
      num(data.amount), data.direction || 'in', data.txn_type || 'transfer', 'unreconciled', user.id]
  );
  const d = defaults();
  const amt = num(data.amount);
  const lines = data.direction === 'out'
    ? [
      { account_id: data.contra_account_id || d.expense, debit: amt, credit: 0, description: data.description },
      { account_id: d.bank, debit: 0, credit: amt, description: 'Bank out' }
    ]
    : [
      { account_id: d.bank, debit: amt, credit: 0, description: 'Bank in' },
      { account_id: data.contra_account_id || 24, debit: 0, credit: amt, description: data.description }
    ];
  const j = postJournal({
    date: data.txn_date || today(), type: 'bank', description: data.description || 'Bank transaction',
    source_type: 'bank_txn', source_id: r.lastInsertRowid, event_key: 'bank_txn', lines, status: 'posted'
  }, user);
  dbRun(`UPDATE acc_bank_txns SET journal_id=? WHERE id=?`, [j.id, r.lastInsertRowid]);
  return dbGet(`SELECT * FROM acc_bank_txns WHERE id=?`, [r.lastInsertRowid]);
}

function importBankStatement(bankAccountId, lines = [], actor) {
  requireAccWrite(actor);
  const batch = `IMP-${Date.now()}`;
  let n = 0;
  (lines || []).forEach((l) => {
    dbRun(
      `INSERT INTO acc_bank_stmt_lines (bank_account_id, statement_date, line_date, description, reference, amount, match_status, import_batch)
       VALUES (?,?,?,?,?,?, 'unmatched', ?)`,
      [bankAccountId, l.statement_date || today(), l.line_date || l.date || today(),
        textOrNull(l.description), textOrNull(l.reference), num(l.amount), batch]
    );
    n += 1;
  });
  return { imported: n, batch, lines: n };
}

function parseBankStatement(text, filename, format) {
  const { parseBankStatementFile } = require('./bank-statement-parser');
  const lines = parseBankStatementFile({ text, filename, format });
  return { lines, count: lines.length, format: format || (String(filename || '').toLowerCase().endsWith('.ofx') ? 'ofx' : 'csv') };
}

function matchBankStmtLine(stmtLineId, bankTxnId, actor) {
  requireAccWrite(actor);
  dbRun(`UPDATE acc_bank_stmt_lines SET match_status='matched', matched_txn_id=? WHERE id=?`, [bankTxnId, stmtLineId]);
  dbRun(`UPDATE acc_bank_txns SET status='reconciled' WHERE id=?`, [bankTxnId]);
  return dbGet(`SELECT * FROM acc_bank_stmt_lines WHERE id=?`, [stmtLineId]);
}

function createReconciliation(data = {}, actor) {
  requireAccWrite(actor);
  const r = dbRun(
    `INSERT INTO acc_reconciliations (bank_account_id, statement_date, statement_balance, book_balance, difference, status, notes)
     VALUES (?,?,?,?,?, 'in_progress', ?)`,
    [data.bank_account_id, data.statement_date || today(), num(data.statement_balance),
      num(data.book_balance), round2(num(data.statement_balance) - num(data.book_balance)), textOrNull(data.notes)]
  );
  return dbGet(`SELECT * FROM acc_reconciliations WHERE id=?`, [r.lastInsertRowid]);
}

function completeReconciliation(id, actor) {
  const user = requireAccWrite(actor);
  const row = dbGet(`SELECT * FROM acc_reconciliations WHERE id=?`, [id]);
  if (!row) throw new Error('Reconciliation not found');
  if (Math.abs(num(row.difference)) > 0.01 && !row.notes) {
    throw new Error('Difference must be zero or explained in notes');
  }
  dbRun(`UPDATE acc_reconciliations SET status='completed', completed_by=?, completed_at=datetime('now') WHERE id=?`, [user.id, id]);
  return dbGet(`SELECT * FROM acc_reconciliations WHERE id=?`, [id]);
}

function listCashAccounts(actor) {
  requireAccUser(actor);
  return dbAll(`SELECT * FROM acc_cash_accounts WHERE is_active=1`);
}

function listCashTxns(filters = {}, actor) {
  requireAccUser(actor);
  let sql = `SELECT * FROM acc_cash_txns WHERE 1=1`;
  const params = [];
  if (filters.cash_account_id) { sql += ` AND cash_account_id=?`; params.push(filters.cash_account_id); }
  sql += ` ORDER BY txn_date DESC LIMIT 300`;
  return dbAll(sql, params);
}

function listBankStatementLines(filters = {}, actor) {
  requireAccUser(actor);
  let sql = `SELECT * FROM acc_bank_stmt_lines WHERE 1=1`;
  const params = [];
  if (filters.status) { sql += ` AND match_status=?`; params.push(filters.status); }
  else { sql += ` AND match_status='unmatched'`; }
  if (filters.bank_account_id) { sql += ` AND bank_account_id=?`; params.push(filters.bank_account_id); }
  sql += ` ORDER BY line_date DESC, id DESC LIMIT 300`;
  const lines = dbAll(sql, params);
  const summary = {
    statement: round2(lines.reduce((s, l) => s + num(l.amount), 0)),
    ledger: 0,
    difference: 0
  };
  return { lines, summary };
}

function listCashupFinance(filters = {}, actor) {
  requireAccUser(actor);
  let sql = `SELECT * FROM acc_cashup_finance WHERE 1=1`;
  const params = [];
  if (filters.from) { sql += ` AND date(cashup_date) >= date(?)`; params.push(filters.from); }
  if (filters.to) { sql += ` AND date(cashup_date) <= date(?)`; params.push(filters.to); }
  sql += ` ORDER BY cashup_date DESC, id DESC LIMIT 200`;
  return { sessions: dbAll(sql, params) };
}

function postFromReturn(returnId) {
  ensureReady();
  try {
    const ret = dbGet(`SELECT * FROM returns WHERE id=?`, [returnId]);
    if (!ret) throw new Error('Return not found');
    const existing = dbGet(`SELECT id FROM acc_journals WHERE source_type='return' AND source_id=? AND event_key='return_main'`, [returnId]);
    if (existing) return existing;
    const sale = dbGet(`SELECT * FROM sales WHERE id=?`, [ret.sale_id]);
    const d = defaults();
    const amt = round2(ret.total_refund);
    if (amt <= 0) return null;
    const method = ret.refund_method || 'cash';
    const lines = [
      { account_id: d.sales, debit: amt, credit: 0, description: `Refund ${ret.return_number || returnId}` },
      { account_id: tenderAccount(method), debit: 0, credit: amt, description: 'Refund paid out' }
    ];
    return postJournal({
      date: String(ret.created_at || today()).slice(0, 10),
      type: 'refund',
      description: `POS Return ${ret.return_number || returnId}`,
      reference: ret.return_number || String(returnId),
      source_type: 'return', source_id: returnId, event_key: 'return_main',
      lines, status: 'posted'
    }, SYSTEM_ACTOR);
  } catch (err) {
    queueIntegrationError('pos', 'return', returnId, err);
    throw err;
  }
}

function syncPosReceipts() {
  let synced = 0;
  try {
    const sales = dbAll(
      `SELECT s.*, c.name AS customer_name FROM sales s
       LEFT JOIN acc_invoices i ON i.sale_id = s.id
       LEFT JOIN customers c ON c.id = s.customer_id
       WHERE i.id IS NULL AND s.status IN ('completed','partial_return')
       ORDER BY s.id DESC LIMIT 500`
    );
    sales.forEach((s) => {
      try {
        const total = round2(s.total);
        const tax = round2(s.tax_amount || 0);
        const sub = round2(total - tax);
        const number = `RCP-${s.receipt_number || s.id}`;
        dbRun(
          `INSERT INTO acc_invoices (invoice_number, customer_id, customer_name, invoice_date, due_date, status,
            subtotal, tax_total, total, amount_paid, balance, sale_id, notes, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            number, s.customer_id || null, s.customer_name || 'Walk-in', String(s.created_at || today()).slice(0, 10),
            String(s.created_at || today()).slice(0, 10), 'paid', sub, tax, total, total, 0, s.id,
            `POS receipt ${s.receipt_number || s.id}`, s.created_at || null
          ]
        );
        synced += 1;
      } catch (_) { /* duplicate number etc */ }
    });
  } catch (_) { /* ignore */ }
  return synced;
}

function syncMissingIntegrations(actor) {
  requireAccWrite(actor);
  let synced = 0;
  synced += syncPosReceipts();
  const sales = dbAll(
    `SELECT s.id FROM sales s
     LEFT JOIN acc_journals j ON j.source_type='sale' AND j.source_id=s.id AND j.event_key='sale_main'
     WHERE j.id IS NULL AND s.status IN ('completed','partial_return')
     ORDER BY s.id DESC LIMIT 500`
  );
  sales.forEach((s) => { try { postFromSale(s.id); synced += 1; } catch (_) { /* queued */ } });
  const expenses = dbAll(
    `SELECT e.id FROM expenses e
     LEFT JOIN acc_journals j ON j.source_type='expense' AND j.source_id=e.id AND j.event_key='expense_main'
     WHERE j.id IS NULL ORDER BY e.id DESC LIMIT 300`
  );
  expenses.forEach((e) => { try { postFromExpense(e.id); synced += 1; } catch (_) { /* queued */ } });
  try {
    const pos = dbAll(
      `SELECT id FROM purchase_orders WHERE status='received'
       AND id NOT IN (SELECT source_id FROM acc_journals WHERE source_type='purchase_order' AND event_key='po_receive') LIMIT 200`
    );
    pos.forEach((p) => { try { postFromPurchaseReceive(p.id); synced += 1; } catch (_) { /* queued */ } });
  } catch (_) { /* ignore */ }
  try {
    const returns = dbAll(
      `SELECT r.id FROM returns r
       LEFT JOIN acc_journals j ON j.source_type='return' AND j.source_id=r.id
       WHERE j.id IS NULL AND r.status IN ('completed','reopened') LIMIT 200`
    );
    returns.forEach((r) => { try { postFromReturn(r.id); synced += 1; } catch (_) { /* queued */ } });
  } catch (_) { /* ignore */ }
  try {
    const pays = dbAll(
      `SELECT id FROM supplier_payments
       WHERE id NOT IN (SELECT source_id FROM acc_journals WHERE source_type='supplier_payment') LIMIT 200`
    );
    pays.forEach((p) => { try { postFromSupplierPayment(p.id); synced += 1; } catch (_) { /* queued */ } });
  } catch (_) { /* ignore */ }
  try {
    const payrolls = dbAll(
      `SELECT id FROM employee_payroll WHERE status='paid'
       AND id NOT IN (SELECT source_id FROM acc_journals WHERE source_type='employee_payroll' AND event_key='payroll_main') LIMIT 200`
    );
    payrolls.forEach((p) => { try { postFromPayroll(p.id); synced += 1; } catch (_) { /* queued */ } });
  } catch (_) { /* ignore */ }
  try {
    const cashups = dbAll(
      `SELECT cf.* FROM acc_cashup_finance cf
       LEFT JOIN acc_journals j ON j.source_type='cashup' AND j.source_id=cf.cashup_id AND j.event_key='cashup_var'
       WHERE cf.journal_id IS NULL AND ABS(cf.difference) >= 0.01 LIMIT 100`
    );
    cashups.forEach((c) => {
      try {
        postFromCashup(c.cashup_id, {
          shift_id: c.shift_id, cashup_date: c.cashup_date, cashier_name: c.cashier_name,
          expected_cash: c.expected_cash, expected_card: c.expected_card, expected_eft: c.expected_eft,
          actual_cash: c.actual_cash, actual_card: c.actual_card, actual_eft: c.actual_eft,
          reason: c.reason, cashup_id: c.cashup_id
        });
        synced += 1;
      } catch (_) { /* ignore */ }
    });
  } catch (_) { /* ignore */ }
  try {
    const credits = dbAll(
      `SELECT cl.id FROM customer_credit_ledger cl
       LEFT JOIN acc_journals j ON j.source_type='customer_credit' AND j.source_id=cl.id AND j.event_key='ccp_pay'
       WHERE j.id IS NULL AND cl.type='payment' ORDER BY cl.id DESC LIMIT 200`
    );
    credits.forEach((c) => { try { postFromCustomerCreditPayment(c.id); synced += 1; } catch (_) { /* queued */ } });
  } catch (_) { /* ignore */ }
  return { synced };
}

function saveCashTxn(data = {}, actor) {
  const user = requireAccWrite(actor);
  if (data.action === 'create' || data.inflow != null || data.outflow != null) {
    const inflow = num(data.inflow);
    const outflow = num(data.outflow);
    if (inflow > 0) {
      return saveCashTxn({
        cash_account_id: data.cash_account_id || 1,
        txn_date: data.date || data.txn_date || today(),
        description: data.description || 'Cash in',
        amount: inflow,
        direction: 'in',
        txn_type: data.txn_type || 'receipt',
        reference: data.reference
      }, user);
    }
    if (outflow > 0) {
      return saveCashTxn({
        cash_account_id: data.cash_account_id || 1,
        txn_date: data.date || data.txn_date || today(),
        description: data.description || 'Cash out',
        amount: outflow,
        direction: 'out',
        txn_type: data.txn_type || 'expense',
        reference: data.reference
      }, user);
    }
  }
  const r = dbRun(
    `INSERT INTO acc_cash_txns (cash_account_id, txn_date, description, amount, direction, txn_type, reference, created_by)
     VALUES (?,?,?,?,?,?,?,?)`,
    [data.cash_account_id || 1, data.txn_date || today(), textOrNull(data.description), num(data.amount),
      data.direction || 'out', data.txn_type || 'expense', textOrNull(data.reference), user.id]
  );
  return dbGet(`SELECT * FROM acc_cash_txns WHERE id=?`, [r.lastInsertRowid]);
}

function listPettyCash(actor) {
  requireAccUser(actor);
  return listCashTxns({ cash_account_id: 2 }, actor);
}

function savePettyCashExpense(data = {}, actor) {
  return saveCashTxn({ ...data, cash_account_id: 2, direction: 'out', txn_type: 'petty' }, actor);
}

function saveCashupFinance(data = {}, actor) {
  requireAccWrite(actor);
  return postFromCashup(data.cashup_id, data);
}

function listAccExpenses(filters = {}, actor) {
  requireAccUser(actor);
  try {
    return dbAll(`SELECT * FROM expenses ORDER BY expense_date DESC, id DESC LIMIT 200`);
  } catch (_) {
    return [];
  }
}

function recordExpenseViaAccounting(data = {}, actor) {
  const user = requireAccWrite(actor);
  const threshold = num(getSettings().approval_expense_threshold, 5000);
  if (num(data.amount) >= threshold) {
    const r = dbRun(
      `INSERT INTO acc_approvals (entity_type, entity_id, action, amount, status, requested_by, requested_by_name, notes)
       VALUES ('expense', 0, 'create', ?, 'pending', ?, ?, ?)`,
      [num(data.amount), user.id, user.full_name || user.username, textOrNull(data.description)]
    );
    return { pending_approval: true, approval_id: r.lastInsertRowid };
  }
  let expenseId = data.expense_id;
  if (!expenseId) {
    try {
      const r = dbRun(
        `INSERT INTO expenses (category, description, amount, expense_date, payment_method, created_by)
         VALUES (?,?,?,?,?,?)`,
        [data.category || 'Other', data.description || 'Expense', num(data.amount), data.expense_date || today(),
          data.payment_method || 'cash', user.id]
      );
      expenseId = r.lastInsertRowid;
    } catch (_) {
      /* expenses table shape may differ */
    }
  }
  if (expenseId) return postFromExpense(expenseId);
  const d = defaults();
  return postJournal({
    date: data.expense_date || today(), type: 'expense', description: data.description || 'Expense',
    lines: [
      { account_id: data.account_id || d.expense, debit: num(data.amount), credit: 0 },
      { account_id: tenderAccount(data.payment_method), debit: 0, credit: num(data.amount) }
    ],
    status: 'posted'
  }, user);
}

function listRecurring(actor) {
  requireAccUser(actor);
  return dbAll(`SELECT * FROM acc_recurring ORDER BY next_due`);
}

function saveRecurring(data = {}, actor) {
  requireAccWrite(actor);
  if (data.id) {
    dbRun(`UPDATE acc_recurring SET name=?, expense_account_id=?, payee=?, amount=?, tax_rate_id=?, frequency=?, next_due=?, auto_post=?, is_active=?, notes=? WHERE id=?`,
      [data.name, data.expense_account_id || 43, textOrNull(data.payee), num(data.amount), data.tax_rate_id || null,
        data.frequency || 'monthly', data.next_due || null, data.auto_post ? 1 : 0, data.is_active === 0 ? 0 : 1,
        textOrNull(data.notes), data.id]);
    return dbGet(`SELECT * FROM acc_recurring WHERE id=?`, [data.id]);
  }
  const r = dbRun(
    `INSERT INTO acc_recurring (name, expense_account_id, payee, amount, tax_rate_id, frequency, next_due, auto_post, notes)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [data.name, data.expense_account_id || 43, textOrNull(data.payee), num(data.amount), data.tax_rate_id || null,
      data.frequency || 'monthly', data.next_due || today(), data.auto_post ? 1 : 0, textOrNull(data.notes)]
  );
  return dbGet(`SELECT * FROM acc_recurring WHERE id=?`, [r.lastInsertRowid]);
}

function processDueRecurring(actor) {
  requireAccWrite(actor);
  const due = dbAll(`SELECT * FROM acc_recurring WHERE is_active=1 AND next_due IS NOT NULL AND date(next_due) <= date('now')`);
  const results = [];
  due.forEach((r) => {
    if (r.auto_post) {
      results.push(recordExpenseViaAccounting({
        category: r.name, description: `Recurring: ${r.name}`, amount: r.amount,
        account_id: r.expense_account_id, payment_method: 'eft'
      }, actor));
      dbRun(`UPDATE acc_recurring SET last_posted=date('now'), next_due=date(next_due, '+1 month') WHERE id=?`, [r.id]);
    } else {
      dbRun(`INSERT INTO acc_notifications (title, body, severity, link_section) VALUES (?,?, 'warn', 'recurring-expenses')`,
        [`Recurring due: ${r.name}`, `Amount ${r.amount} is due. Auto-post is off — confirm to post.`]);
      results.push({ notified: true, id: r.id });
    }
  });
  return results;
}

function listOtherIncome(actor) {
  requireAccUser(actor);
  return dbAll(`SELECT * FROM acc_other_income ORDER BY income_date DESC LIMIT 200`);
}

function saveOtherIncome(data = {}, actor) {
  const user = requireAccWrite(actor);
  const r = dbRun(
    `INSERT INTO acc_other_income (income_date, income_type, account_id, description, amount, tax_amount, payment_method, created_by)
     VALUES (?,?,?,?,?,?,?,?)`,
    [data.income_date || today(), data.income_type || 'other', data.account_id || 24, textOrNull(data.description),
      num(data.amount), num(data.tax_amount), data.payment_method || 'cash', user.id]
  );
  const d = defaults();
  const j = postJournal({
    date: data.income_date || today(), type: 'income', description: data.description || 'Other income',
    source_type: 'other_income', source_id: r.lastInsertRowid, event_key: 'other_income',
    lines: [
      { account_id: tenderAccount(data.payment_method), debit: num(data.amount), credit: 0 },
      { account_id: data.account_id || 24, debit: 0, credit: num(data.amount) }
    ],
    status: 'posted'
  }, user);
  dbRun(`UPDATE acc_other_income SET journal_id=? WHERE id=?`, [j.id, r.lastInsertRowid]);
  return dbGet(`SELECT * FROM acc_other_income WHERE id=?`, [r.lastInsertRowid]);
}

function listAssets(actor) {
  requireAccUser(actor);
  return dbAll(`SELECT * FROM acc_assets ORDER BY id DESC`);
}

function saveAsset(data = {}, actor) {
  requireAccWrite(actor);
  const book = round2(num(data.purchase_cost) - num(data.accumulated_depreciation));
  if (data.id) {
    dbRun(`UPDATE acc_assets SET asset_code=?, description=?, category=?, purchase_date=?, purchase_cost=?, supplier_id=?,
      useful_life_months=?, depreciation_method=?, salvage_value=?, accumulated_depreciation=?, book_value=?, status=? WHERE id=?`,
      [textOrNull(data.asset_code), data.description, textOrNull(data.category), data.purchase_date || null,
        num(data.purchase_cost), data.supplier_id || null, num(data.useful_life_months, 60), data.depreciation_method || 'straight_line',
        num(data.salvage_value), num(data.accumulated_depreciation), book, data.status || 'active', data.id]);
    return dbGet(`SELECT * FROM acc_assets WHERE id=?`, [data.id]);
  }
  const r = dbRun(
    `INSERT INTO acc_assets (asset_code, description, category, purchase_date, purchase_cost, supplier_id, useful_life_months,
      depreciation_method, salvage_value, accumulated_depreciation, book_value, gl_asset_account_id, gl_accum_account_id, gl_expense_account_id)
     VALUES (?,?,?,?,?,?,?,?,?,0,?,?,?,?)`,
    [textOrNull(data.asset_code), data.description, textOrNull(data.category), data.purchase_date || today(),
      num(data.purchase_cost), data.supplier_id || null, num(data.useful_life_months, 60), data.depreciation_method || 'straight_line',
      num(data.salvage_value), num(data.purchase_cost), data.gl_asset_account_id || 7, 11, 42]
  );
  return dbGet(`SELECT * FROM acc_assets WHERE id=?`, [r.lastInsertRowid]);
}

function runDepreciation(asOf, actor) {
  const user = requireAccWrite(actor);
  const assets = dbAll(`SELECT * FROM acc_assets WHERE status='active'`);
  const posted = [];
  assets.forEach((a) => {
    const life = Math.max(1, num(a.useful_life_months, 60));
    const depreciable = Math.max(0, num(a.purchase_cost) - num(a.salvage_value));
    const monthly = round2(depreciable / life);
    if (monthly < 0.01) return;
    const newAccum = round2(num(a.accumulated_depreciation) + monthly);
    const book = round2(num(a.purchase_cost) - newAccum);
    const j = postJournal({
      date: asOf || today(), type: 'depreciation', description: `Depreciation ${a.description}`,
      source_type: 'asset', source_id: a.id, event_key: `dep_${(asOf || today()).slice(0, 7)}`,
      lines: [
        { account_id: a.gl_expense_account_id || 42, debit: monthly, credit: 0 },
        { account_id: a.gl_accum_account_id || 11, debit: 0, credit: monthly }
      ],
      status: 'posted'
    }, user);
    dbRun(`UPDATE acc_assets SET accumulated_depreciation=?, book_value=? WHERE id=?`, [newAccum, book, a.id]);
    posted.push(j);
  });
  return { count: posted.length, journals: posted };
}

function listLoans(actor) {
  requireAccUser(actor);
  return dbAll(`SELECT * FROM acc_loans ORDER BY id DESC`);
}

function saveLoan(data = {}, actor) {
  requireAccWrite(actor);
  if (data.id) {
    dbRun(`UPDATE acc_loans SET lender=?, principal=?, interest_rate=?, start_date=?, term_months=?, installment_amount=?, outstanding_balance=?, status=?, notes=? WHERE id=?`,
      [data.lender, num(data.principal), num(data.interest_rate), data.start_date || null, data.term_months || null,
        num(data.installment_amount), num(data.outstanding_balance, data.principal), data.status || 'active', textOrNull(data.notes), data.id]);
    return dbGet(`SELECT * FROM acc_loans WHERE id=?`, [data.id]);
  }
  const r = dbRun(
    `INSERT INTO acc_loans (lender, principal, interest_rate, start_date, term_months, installment_amount, outstanding_balance, gl_liability_account_id, gl_interest_account_id, notes)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [data.lender, num(data.principal), num(data.interest_rate), data.start_date || today(), data.term_months || null,
      num(data.installment_amount), num(data.principal), 14, 38, textOrNull(data.notes)]
  );
  return dbGet(`SELECT * FROM acc_loans WHERE id=?`, [r.lastInsertRowid]);
}

function recordLoanPayment(data = {}, actor) {
  const user = requireAccWrite(actor);
  const loan = dbGet(`SELECT * FROM acc_loans WHERE id=?`, [data.loan_id]);
  if (!loan) throw new Error('Loan not found');
  const principal = num(data.principal_amount);
  const interest = num(data.interest_amount);
  const total = round2(principal + interest);
  const r = dbRun(
    `INSERT INTO acc_loan_payments (loan_id, payment_date, principal_amount, interest_amount, total_amount) VALUES (?,?,?,?,?)`,
    [loan.id, data.payment_date || today(), principal, interest, total]
  );
  const lines = [
    { account_id: 14, debit: principal, credit: 0, description: 'Loan principal' },
    { account_id: 38, debit: interest, credit: 0, description: 'Loan interest' },
    { account_id: tenderAccount(data.payment_method || 'eft'), debit: 0, credit: total, description: 'Loan payment' }
  ].filter((l) => num(l.debit) + num(l.credit) > 0);
  const j = postJournal({
    date: data.payment_date || today(), type: 'loan', description: `Loan payment ${loan.lender}`,
    source_type: 'loan_payment', source_id: r.lastInsertRowid, event_key: 'loan_pay', lines, status: 'posted'
  }, user);
  dbRun(`UPDATE acc_loan_payments SET journal_id=? WHERE id=?`, [j.id, r.lastInsertRowid]);
  dbRun(`UPDATE acc_loans SET outstanding_balance=? WHERE id=?`, [round2(num(loan.outstanding_balance) - principal), loan.id]);
  return dbGet(`SELECT * FROM acc_loan_payments WHERE id=?`, [r.lastInsertRowid]);
}

function listOwnerTxns(actor) {
  requireAccUser(actor);
  return dbAll(`SELECT * FROM acc_owner_txns ORDER BY txn_date DESC`);
}

function saveOwnerTxn(data = {}, actor) {
  const user = requireAccWrite(actor);
  const r = dbRun(
    `INSERT INTO acc_owner_txns (txn_date, txn_type, amount, description, created_by) VALUES (?,?,?,?,?)`,
    [data.txn_date || today(), data.txn_type || 'capital', num(data.amount), textOrNull(data.description), user.id]
  );
  const amt = num(data.amount);
  const d = defaults();
  let lines;
  if (data.txn_type === 'drawing') {
    lines = [
      { account_id: 18, debit: amt, credit: 0, description: 'Owner drawing' },
      { account_id: tenderAccount(data.payment_method), debit: 0, credit: amt, description: 'Drawing payout' }
    ];
  } else if (data.txn_type === 'loan_to_owner') {
    lines = [
      { account_id: 4, debit: amt, credit: 0, description: 'Loan to owner' },
      { account_id: tenderAccount(data.payment_method), debit: 0, credit: amt, description: 'Loan to owner' }
    ];
  } else {
    lines = [
      { account_id: tenderAccount(data.payment_method), debit: amt, credit: 0, description: 'Owner capital in' },
      { account_id: 17, debit: 0, credit: amt, description: 'Owner capital' }
    ];
  }
  const j = postJournal({
    date: data.txn_date || today(), type: 'owner', description: data.description || data.txn_type,
    source_type: 'owner_txn', source_id: r.lastInsertRowid, event_key: 'owner_txn', lines, status: 'posted'
  }, user);
  dbRun(`UPDATE acc_owner_txns SET journal_id=? WHERE id=?`, [j.id, r.lastInsertRowid]);
  return dbGet(`SELECT * FROM acc_owner_txns WHERE id=?`, [r.lastInsertRowid]);
}

function listTaxRates(actor) {
  requireAccUser(actor);
  return dbAll(`SELECT * FROM acc_tax_rates ORDER BY is_default DESC, id`);
}

function saveTaxRate(data = {}, actor) {
  requireAccWrite(actor);
  if (data.is_default) dbRun(`UPDATE acc_tax_rates SET is_default=0`);
  if (data.id) {
    dbRun(`UPDATE acc_tax_rates SET name=?, rate=?, tax_type=?, is_default=?, is_active=? WHERE id=?`,
      [data.name, num(data.rate), data.tax_type || 'vat', data.is_default ? 1 : 0, data.is_active === 0 ? 0 : 1, data.id]);
    return dbGet(`SELECT * FROM acc_tax_rates WHERE id=?`, [data.id]);
  }
  const r = dbRun(`INSERT INTO acc_tax_rates (name, rate, tax_type, is_default, is_active) VALUES (?,?,?,?,1)`,
    [data.name, num(data.rate), data.tax_type || 'vat', data.is_default ? 1 : 0]);
  return dbGet(`SELECT * FROM acc_tax_rates WHERE id=?`, [r.lastInsertRowid]);
}

function sumAccountType(type, from, to) {
  const row = dbGet(
    `SELECT COALESCE(SUM(jl.debit),0) AS debits, COALESCE(SUM(jl.credit),0) AS credits
     FROM acc_journal_lines jl
     JOIN acc_journals j ON j.id = jl.journal_id
     JOIN acc_accounts a ON a.id = jl.account_id
     WHERE j.status='posted' AND a.type=? AND date(j.journal_date) BETWEEN date(?) AND date(?)`,
    [type, from, to]
  );
  if (type === 'income') return round2(num(row?.credits) - num(row?.debits));
  return round2(num(row?.debits) - num(row?.credits));
}

function taxSummary(from, to, actor) {
  requireAccUser(actor);
  const d = defaults();
  const output = round2(Math.max(0, -accountBalance(d.vatOut, to) + accountBalance(d.vatOut, from) /* simplified */));
  const outRow = dbGet(
    `SELECT COALESCE(SUM(jl.credit-jl.debit),0) AS amt FROM acc_journal_lines jl
     JOIN acc_journals j ON j.id=jl.journal_id WHERE j.status='posted' AND jl.account_id=? AND date(j.journal_date) BETWEEN date(?) AND date(?)`,
    [d.vatOut, from || '2000-01-01', to || today()]
  );
  const inRow = dbGet(
    `SELECT COALESCE(SUM(jl.debit-jl.credit),0) AS amt FROM acc_journal_lines jl
     JOIN acc_journals j ON j.id=jl.journal_id WHERE j.status='posted' AND jl.account_id=? AND date(j.journal_date) BETWEEN date(?) AND date(?)`,
    [d.vatIn, from || '2000-01-01', to || today()]
  );
  const outputVat = round2(outRow?.amt);
  const inputVat = round2(inRow?.amt);
  return {
    from, to,
    output_vat: outputVat,
    input_vat: inputVat,
    vat_payable: round2(outputVat - inputVat),
    disclaimer: 'Preparation aid only — not an official tax filing.'
  };
}

function profitAndLoss(from, to, actor) {
  requireAccUser(actor);
  const f = from || `${new Date().getFullYear()}-01-01`;
  const t = to || today();
  const revenue = sumAccountType('income', f, t);
  const cogs = sumAccountType('cogs', f, t);
  const expenses = sumAccountType('expense', f, t);
  const gross = round2(revenue - cogs);
  const net = round2(gross - expenses);
  const accounts = listAccounts({}, actor).filter((a) => ['income', 'cogs', 'expense'].includes(a.type)).map((a) => ({
    ...a,
    period_amount: (() => {
      const row = dbGet(
        `SELECT COALESCE(SUM(jl.debit),0) AS d, COALESCE(SUM(jl.credit),0) AS c FROM acc_journal_lines jl
         JOIN acc_journals j ON j.id=jl.journal_id WHERE j.status='posted' AND jl.account_id=? AND date(j.journal_date) BETWEEN date(?) AND date(?)`,
        [a.id, f, t]
      );
      if (a.type === 'income') return round2(num(row?.c) - num(row?.d));
      return round2(num(row?.d) - num(row?.c));
    })()
  }));
  return { from: f, to: t, revenue, cogs, gross_profit: gross, expenses, net_profit: net, accounts };
}

function balanceSheet(asOf, actor) {
  requireAccUser(actor);
  const asOfDate = asOf || today();
  const assets = listAccounts({ type: 'asset', as_of: asOfDate }, actor);
  const liabilities = listAccounts({ type: 'liability', as_of: asOfDate }, actor);
  const equity = listAccounts({ type: 'equity', as_of: asOfDate }, actor);
  const totalAssets = round2(assets.reduce((s, a) => s + num(a.balance), 0));
  const totalLiab = round2(liabilities.reduce((s, a) => s + num(a.balance), 0));
  const totalEq = round2(equity.reduce((s, a) => s + num(a.balance), 0));
  return {
    as_of: asOfDate,
    assets, liabilities, equity,
    total_assets: totalAssets,
    total_liabilities: totalLiab,
    total_equity: totalEq,
    balanced: Math.abs(totalAssets - (totalLiab + totalEq)) < 0.05
  };
}

function cashFlow(from, to, actor) {
  requireAccUser(actor);
  const f = from || `${new Date().getFullYear()}-01-01`;
  const t = to || today();
  const d = defaults();
  const cashIn = dbGet(
    `SELECT COALESCE(SUM(jl.debit),0) AS amt FROM acc_journal_lines jl JOIN acc_journals j ON j.id=jl.journal_id
     WHERE j.status='posted' AND jl.account_id IN (?,?) AND date(j.journal_date) BETWEEN date(?) AND date(?)`,
    [d.cash, d.bank, f, t]
  );
  const cashOut = dbGet(
    `SELECT COALESCE(SUM(jl.credit),0) AS amt FROM acc_journal_lines jl JOIN acc_journals j ON j.id=jl.journal_id
     WHERE j.status='posted' AND jl.account_id IN (?,?) AND date(j.journal_date) BETWEEN date(?) AND date(?)`,
    [d.cash, d.bank, f, t]
  );
  const opening = round2(accountBalance(d.cash, f) + accountBalance(d.bank, f));
  const net = round2(num(cashIn?.amt) - num(cashOut?.amt));
  return {
    from: f, to: t,
    operating: net,
    investing: 0,
    financing: 0,
    net_change: net,
    opening_cash: opening,
    closing_cash: round2(opening + net)
  };
}

function trialBalance(asOf, actor) {
  requireAccUser(actor);
  const asOfDate = asOf || today();
  const accounts = listAccounts({ as_of: asOfDate }, actor);
  let debit = 0; let credit = 0;
  const rows = accounts.map((a) => {
    const bal = num(a.balance);
    const row = {
      id: a.id, code: a.code, name: a.name, type: a.type,
      debit: bal >= 0 && ['asset', 'expense', 'cogs'].includes(a.type) ? bal : (bal < 0 && !['asset', 'expense', 'cogs'].includes(a.type) ? Math.abs(bal) : 0),
      credit: bal >= 0 && !['asset', 'expense', 'cogs'].includes(a.type) ? bal : (bal < 0 && ['asset', 'expense', 'cogs'].includes(a.type) ? Math.abs(bal) : 0)
    };
    // Normalize: show natural balances
    if (['asset', 'expense', 'cogs'].includes(a.type)) {
      row.debit = bal >= 0 ? bal : 0;
      row.credit = bal < 0 ? Math.abs(bal) : 0;
    } else {
      row.credit = bal >= 0 ? bal : 0;
      row.debit = bal < 0 ? Math.abs(bal) : 0;
    }
    debit += row.debit; credit += row.credit;
    return row;
  }).filter((r) => r.debit || r.credit);
  return { as_of: asOfDate, rows, total_debit: round2(debit), total_credit: round2(credit), balanced: Math.abs(debit - credit) < 0.05 };
}

function salesReport(from, to, actor) {
  requireAccUser(actor);
  try {
    return dbAll(
      `SELECT date(created_at) AS day, COUNT(*) AS sales_count, SUM(total) AS revenue, SUM(tax_amount) AS tax
       FROM sales WHERE date(created_at) BETWEEN date(?) AND date(?) GROUP BY date(created_at) ORDER BY day`,
      [from || today(), to || today()]
    );
  } catch (_) { return []; }
}

function purchaseReport(from, to, actor) {
  requireAccUser(actor);
  return dbAll(`SELECT * FROM acc_bills WHERE date(bill_date) BETWEEN date(?) AND date(?) ORDER BY bill_date`, [from || '2000-01-01', to || today()]);
}

function expenseReport(from, to, actor) {
  requireAccUser(actor);
  return listAccExpenses({ from, to }, actor);
}

function stockValueReport(actor) {
  requireAccUser(actor);
  try {
    // Prefer branch_stock when present (cloud multi-branch); fall back to products.stock_quantity.
    let row = null;
    try {
      row = dbGet(`
        SELECT COALESCE(SUM(COALESCE(bs.quantity, p.stock_quantity, 0) * COALESCE(p.buying_price,0)),0) AS value,
               COALESCE(SUM(COALESCE(bs.quantity, p.stock_quantity, 0)),0) AS units
        FROM products p
        LEFT JOIN (
          SELECT product_id, SUM(quantity) AS quantity FROM branch_stock GROUP BY product_id
        ) bs ON bs.product_id = p.id
        WHERE COALESCE(p.is_active,1) = 1`);
    } catch (_) {
      row = dbGet(`SELECT COALESCE(SUM(stock_quantity * COALESCE(buying_price,0)),0) AS value,
        COALESCE(SUM(stock_quantity),0) AS units FROM products WHERE COALESCE(is_active,1)=1`);
    }
    return { stock_value: round2(row?.value), units: num(row?.units) };
  } catch (_) {
    return { stock_value: 0, units: 0 };
  }
}

function drillDown(metric, from, to, actor) {
  requireAccUser(actor);
  const f = from || `${new Date().getFullYear()}-01-01`;
  const t = to || today();
  const pnl = profitAndLoss(f, t, actor);
  if (metric === 'gross_profit') {
    return { metric, title: 'Gross Profit', sales: pnl.revenue, cogs: pnl.cogs, gross_profit: pnl.gross_profit };
  }
  if (metric === 'cogs' || metric === 'net_profit' || metric === 'revenue') {
    return { metric, title: metric.replace(/_/g, ' '), ...pnl };
  }
  if (metric === 'sales_report') {
    const rows = salesReport(f, t, actor) || [];
    return {
      metric, title: 'Sales Report', summary: `Sales from ${f} to ${t}`,
      rows: rows.map((r) => ({ label: r.day, amount: r.revenue, count: r.sales_count, tax: r.tax }))
    };
  }
  if (metric === 'purchases_report') {
    const rows = purchaseReport(f, t, actor) || [];
    return {
      metric, title: 'Purchases Report', summary: `Purchases from ${f} to ${t}`,
      rows: rows.map((r) => ({ label: r.bill_number || r.id, amount: r.total, party: r.supplier_name }))
    };
  }
  if (metric === 'stock_value') {
    const stock = stockValueReport(actor);
    let products = [];
    try {
      products = dbAll(
        `SELECT p.name,
           COALESCE(bs.quantity, p.stock_quantity, 0) AS qty,
           COALESCE(p.buying_price,0) AS unit_cost,
           (COALESCE(bs.quantity, p.stock_quantity, 0) * COALESCE(p.buying_price,0)) AS value
         FROM products p
         LEFT JOIN (
           SELECT product_id, SUM(quantity) AS quantity FROM branch_stock GROUP BY product_id
         ) bs ON bs.product_id = p.id
         WHERE COALESCE(p.is_active,1)=1 AND COALESCE(bs.quantity, p.stock_quantity, 0) > 0
         ORDER BY value DESC LIMIT 200`
      );
    } catch (_) {
      try {
        products = dbAll(
          `SELECT name, stock_quantity AS qty, COALESCE(buying_price,0) AS unit_cost,
            (stock_quantity * COALESCE(buying_price,0)) AS value
           FROM products WHERE COALESCE(is_active,1)=1 AND stock_quantity > 0 ORDER BY value DESC LIMIT 200`
        );
      } catch (_) { /* ignore */ }
    }
    return {
      metric, title: 'Stock Value', total: stock.stock_value, count: products.length,
      rows: products.map((p) => ({ name: p.name, qty: p.qty, unit_cost: p.unit_cost, value: p.value }))
    };
  }
  if (metric === 'expenses_report') {
    const rows = expenseReport(f, t, actor) || [];
    return {
      metric, title: 'Expenses Report',
      rows: rows.map((r) => ({ label: r.category || r.description, amount: r.amount, date: r.expense_date }))
    };
  }
  return { metric, title: 'Ledger', rows: listLedger({ from: f, to: t, limit: 100 }, actor) };
}

function getDashboard(filters = {}, actor) {
  requireAccUser(actor);
  const day = filters.from && filters.to && filters.from === filters.to ? filters.from : today();
  const from = filters.from || day;
  const to = filters.to || day;
  let salesToday = { total: 0, cash: 0, card: 0, eft: 0, count: 0 };
  try {
    const s = dbGet(`SELECT COUNT(*) AS c, COALESCE(SUM(total),0) AS t FROM sales WHERE date(created_at)=date(?)`, [day]);
    salesToday.count = num(s?.c); salesToday.total = round2(s?.t);
    try {
      const pays = dbAll(
        `SELECT LOWER(COALESCE(sp.method, sp.payment_method, 'cash')) AS m, SUM(sp.amount) AS amt
         FROM sale_payments sp JOIN sales s ON s.id=sp.sale_id WHERE date(s.created_at)=date(?) GROUP BY m`,
        [day]
      );
      pays.forEach((p) => {
        if (p.m.includes('card')) salesToday.card += num(p.amt);
        else if (p.m.includes('eft') || p.m.includes('bank')) salesToday.eft += num(p.amt);
        else salesToday.cash += num(p.amt);
      });
    } catch (_) {
      salesToday.cash = salesToday.total;
    }
  } catch (_) { /* ignore */ }
  let expensesToday = 0;
  try {
    expensesToday = num(dbGet(`SELECT COALESCE(SUM(amount),0) AS t FROM expenses WHERE date(expense_date)=date(?)`, [day])?.t);
  } catch (_) { /* ignore */ }
  const pnl = profitAndLoss(from, to, actor);
  const stock = stockValueReport(actor);
  const ar = arAging(to, actor);
  const ap = apAging(to, actor);
  const banks = listBankAccounts(actor);
  const bankBal = round2(banks.reduce((s, b) => s + num(b.current_balance), 0));
  const tax = taxSummary(from, to, actor);
  const salesSeries = (salesReport(from, to, actor) || []).map((r) => ({
    label: r.day,
    value: r.revenue,
    date: r.day,
    amount: r.revenue,
    total: r.revenue
  }));
  let expenseSeries = [];
  try {
    expenseSeries = dbAll(
      `SELECT category AS label, SUM(amount) AS value, SUM(amount) AS amount
       FROM expenses WHERE date(expense_date) BETWEEN date(?) AND date(?) GROUP BY category ORDER BY value DESC LIMIT 8`,
      [from, to]
    );
  } catch (_) { /* ignore */ }
  return {
    from, to,
    revenue: pnl.revenue,
    expenses: pnl.expenses,
    receivable: round2(ar.current + ar.d30 + ar.d60 + ar.d90 + ar.d120),
    payable: round2(ap.current + ap.d30 + ap.d60 + ap.d90 + ap.d120),
    cash: bankBal,
    today_sales: salesToday.total,
    today_expenses: expensesToday,
    today_cash: round2(salesToday.cash),
    today_card: round2(salesToday.card),
    today_eft: round2(salesToday.eft),
    ar_outstanding: round2(ar.current + ar.d30 + ar.d60 + ar.d90 + ar.d120),
    ap_outstanding: round2(ap.current + ap.d30 + ap.d60 + ap.d90 + ap.d120),
    bank_balance: bankBal,
    stock_value: stock.stock_value,
    gross_profit: pnl.gross_profit,
    net_profit: pnl.net_profit,
    vat_payable: tax.vat_payable,
    sales_count: salesToday.count,
    pnl,
    kpis: [
      { label: 'Revenue', value: pnl.revenue, format: 'money', hint: 'Period sales', metric: 'revenue' },
      { label: 'Expenses', value: pnl.expenses, format: 'money', hint: 'Operating costs', metric: 'expenses', tone: 'warn' },
      { label: 'Net Profit', value: pnl.net_profit, format: 'money', hint: 'After tax', metric: 'net_profit', tone: 'good' },
      { label: 'Cash & Bank', value: bankBal, format: 'money', hint: 'Liquid position', metric: 'cash', tone: 'slate' },
      { label: 'Receivable', value: round2(ar.current + ar.d30 + ar.d60 + ar.d90 + ar.d120), format: 'money', hint: 'Customer AR', metric: 'receivable', tone: 'info' },
      { label: 'Payable', value: round2(ap.current + ap.d30 + ap.d60 + ap.d90 + ap.d120), format: 'money', hint: 'Supplier AP', metric: 'payable', tone: 'info' }
    ],
    charts: {
      sales: salesSeries,
      expenses: expenseSeries
    }
  };
}

function globalSearch(q, actor) {
  requireAccUser(actor);
  const query = `%${String(q || '').trim()}%`;
  if (!String(q || '').trim()) return { invoices: [], bills: [], journals: [], payments: [] };
  return {
    invoices: dbAll(`SELECT id, invoice_number AS ref, customer_name AS name, total, status, 'invoice' AS kind FROM acc_invoices WHERE invoice_number LIKE ? OR customer_name LIKE ? LIMIT 20`, [query, query]),
    bills: dbAll(`SELECT id, bill_number AS ref, supplier_name AS name, total, status, 'bill' AS kind FROM acc_bills WHERE bill_number LIKE ? OR supplier_name LIKE ? LIMIT 20`, [query, query]),
    journals: dbAll(`SELECT id, journal_number AS ref, description AS name, total_debit AS total, status, 'journal' AS kind FROM acc_journals WHERE journal_number LIKE ? OR description LIKE ? OR reference LIKE ? LIMIT 20`, [query, query, query]),
    payments: dbAll(`SELECT id, payment_number AS ref, reference AS name, amount AS total, status, 'payment' AS kind FROM acc_payments WHERE payment_number LIKE ? OR reference LIKE ? LIMIT 20`, [query, query])
  };
}

function listApprovals(filters = {}, actor) {
  requireAccUser(actor);
  let sql = `SELECT * FROM acc_approvals WHERE 1=1`;
  const params = [];
  if (filters.status) { sql += ` AND status=?`; params.push(filters.status); }
  sql += ` ORDER BY id DESC LIMIT 100`;
  return dbAll(sql, params);
}

function decideApproval(id, decision, notes, actor) {
  const user = requireAccWrite(actor);
  const row = dbGet(`SELECT * FROM acc_approvals WHERE id=?`, [id]);
  if (!row) throw new Error('Approval not found');
  const status = decision === 'approve' ? 'approved' : 'rejected';
  dbRun(`UPDATE acc_approvals SET status=?, decided_by=?, decided_by_name=?, decided_at=datetime('now'), notes=COALESCE(?, notes) WHERE id=?`,
    [status, user.id, user.full_name || user.username, textOrNull(notes), id]);
  return dbGet(`SELECT * FROM acc_approvals WHERE id=?`, [id]);
}

function listDocuments(filters = {}, actor) {
  requireAccUser(actor);
  let sql = `SELECT * FROM acc_documents WHERE 1=1`;
  const params = [];
  if (filters.status || filters.ocr_status) {
    sql += ` AND ocr_status=?`;
    params.push(filters.status || filters.ocr_status);
  }
  if (filters.category) { sql += ` AND category=?`; params.push(filters.category); }
  if (filters.linked_type) { sql += ` AND linked_type=?`; params.push(filters.linked_type); }
  if (filters.linked_id) { sql += ` AND linked_id=?`; params.push(filters.linked_id); }
  sql += ` ORDER BY id DESC LIMIT 200`;
  const rows = dbAll(sql, params);
  const todayStr = today();
  return rows.map((d) => {
    const expired = d.expiry_date && String(d.expiry_date).slice(0, 10) < todayStr;
    return { ...d, is_expired: expired ? 1 : 0, ocr: parseJson(d.ocr_json, null) };
  });
}

function extractOcrFromText(text) {
  const raw = String(text || '');
  const result = {
    supplier: null, invoice_date: null, invoice_number: null, description: null,
    total: null, vat: null, items: [], confidence: 0, raw_excerpt: raw.slice(0, 2000)
  };
  if (!raw.trim()) return result;
  let hits = 0;
  const inv = raw.match(/(?:invoice|tax\s*invoice|inv)\s*(?:no|number|#)?\s*:?\s*([A-Z0-9][A-Z0-9\-\/]{2,})/i);
  if (inv) { result.invoice_number = inv[1].trim(); hits += 1; }
  const sup = raw.match(/(?:from|supplier|vendor)\s*:?\s*([^\n\r]{3,80})/i);
  if (sup) { result.supplier = sup[1].trim(); hits += 1; }
  const dt = raw.match(/(?:date|issued)\s*:?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}-\d{2}-\d{2})/i)
    || raw.match(/(\d{4}-\d{2}-\d{2})/);
  if (dt) { result.invoice_date = dt[1]; hits += 1; }
  const total = raw.match(/(?:total|amount\s*due|balance\s*due|grand\s*total)\s*:?\s*(?:R|ZAR)?\s*([\d,]+\.?\d*)/i);
  if (total) { result.total = round2(total[1].replace(/,/g, '')); hits += 1; }
  const vat = raw.match(/(?:vat|tax)\s*:?\s*(?:R|ZAR)?\s*([\d,]+\.?\d*)/i);
  if (vat) { result.vat = round2(vat[1].replace(/,/g, '')); hits += 1; }
  result.confidence = Math.min(95, Math.round((hits / 5) * 100));
  result.description = result.supplier ? `Invoice from ${result.supplier}` : 'Scanned document';
  return result;
}

function saveDocument(data = {}, actor) {
  const user = requireAccWrite(actor);
  const fs = require('fs');
  const path = require('path');
  let filePath = textOrNull(data.file_path || data.file);
  let mime = textOrNull(data.mime_type);
  let fileSize = null;
  let ocrJson = data.ocr_json || null;
  let ocrStatus = data.ocr_status || null;

  if (data.file_base64 && data.filename) {
    const docsDir = path.join(process.env.SHOP_POS_DATA_DIR || path.join(require('os').homedir(), '.shop-pos'), 'acc-documents');
    try { fs.mkdirSync(docsDir, { recursive: true }); } catch (_) { /* */ }
    const safeName = String(data.filename).replace(/[^\w.\-]+/g, '_');
    filePath = path.join(docsDir, `${Date.now()}-${safeName}`);
    const buf = Buffer.from(String(data.file_base64), 'base64');
    fs.writeFileSync(filePath, buf);
    fileSize = buf.length;
    mime = mime || data.mime_type || 'application/octet-stream';
    if (!ocrJson && /^text\/|csv|json/.test(mime) || /\.(txt|csv)$/i.test(safeName)) {
      ocrJson = extractOcrFromText(buf.toString('utf8'));
      ocrStatus = ocrJson.confidence >= 40 ? 'ocr_pending' : 'manual_review';
    } else if (/\.(ofx|qfx|csv)$/i.test(safeName)) {
      try {
        const { parseBankStatementFile } = require('./bank-statement-parser');
        const lines = parseBankStatementFile({ text: buf.toString('utf8'), filename: safeName });
        ocrJson = { kind: 'bank_statement', line_count: lines.length, preview: lines.slice(0, 5) };
        ocrStatus = 'ocr_pending';
      } catch (_) { ocrStatus = 'manual_review'; }
    } else {
      const { extractTextFromFile, isImagePath, isPdfPath } = require('./ocr-engine');
      const tmpPath = filePath;
      if (isImagePath(safeName, mime) || isPdfPath(safeName, mime)) {
        const ocr = extractTextFromFile(tmpPath, mime);
        if (ocr.text && ocr.text.trim()) {
          ocrJson = extractOcrFromText(ocr.text);
          ocrJson.ocr_engine = ocr.engine;
          ocrStatus = ocrJson.confidence >= 40 ? 'ocr_pending' : 'manual_review';
        } else {
          ocrStatus = 'manual_review';
          ocrJson = {
            note: ocr.available
              ? 'OCR ran but no text was detected — enter details manually'
              : 'Install Tesseract OCR for automatic extraction, or enter details manually',
            confidence: 0,
            ocr_engine: ocr.engine || 'none'
          };
        }
      } else {
        ocrStatus = ocrStatus || 'manual_review';
        ocrJson = ocrJson || { note: 'Upload a text, CSV, image or PDF for automatic extraction', confidence: 0 };
      }
    }
  }

  const r = dbRun(
    `INSERT INTO acc_documents (title, category, file_path, mime_type, linked_type, linked_id, customer_id, supplier_id, employee_id,
      document_number, issue_date, expiry_date, is_required, file_size, ocr_json, ocr_status, uploaded_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [textOrNull(data.title || data.reference), textOrNull(data.category || data.type), filePath, mime,
      textOrNull(data.linked_type), data.linked_id || null, data.customer_id || null, data.supplier_id || null, data.employee_id || null,
      textOrNull(data.document_number), textOrNull(data.issue_date), textOrNull(data.expiry_date),
      data.is_required ? 1 : 0, fileSize, ocrJson ? JSON.stringify(ocrJson) : null, ocrStatus, user.id]
  );
  audit(user, 'upload_document', 'acc_document', r.lastInsertRowid, null, { title: data.title, category: data.category });
  const newId = r.lastInsertRowid || dbGet(`SELECT id FROM acc_documents WHERE title=? ORDER BY id DESC LIMIT 1`, [textOrNull(data.title || data.reference)])?.id;
  const doc = dbGet(`SELECT * FROM acc_documents WHERE id=?`, [newId]);
  if (doc?.ocr_json) doc.ocr = parseJson(doc.ocr_json, {});
  return doc;
}

function getDocumentFile(id, actor) {
  requireAccUser(actor);
  const doc = dbGet(`SELECT id, title, file_path, mime_type, file_size FROM acc_documents WHERE id=?`, [id]);
  if (!doc?.file_path) throw new Error('Document file not found');
  const fs = require('fs');
  if (!fs.existsSync(doc.file_path)) throw new Error('File missing on disk');
  const data = fs.readFileSync(doc.file_path);
  return { ...doc, file_base64: data.toString('base64') };
}

function processOcrDocument(id, actor) {
  const user = requireAccWrite(actor);
  const doc = dbGet(`SELECT * FROM acc_documents WHERE id=?`, [id]);
  if (!doc) throw new Error('Document not found');
  const fs = require('fs');
  let extracted = parseJson(doc.ocr_json, {});
  if (doc.file_path && fs.existsSync(doc.file_path)) {
    const ext = String(doc.file_path).toLowerCase();
    if (ext.endsWith('.txt') || ext.endsWith('.csv') || (doc.mime_type || '').startsWith('text/')) {
      extracted = extractOcrFromText(fs.readFileSync(doc.file_path, 'utf8'));
    } else {
      const { extractTextFromFile } = require('./ocr-engine');
      const ocr = extractTextFromFile(doc.file_path, doc.mime_type);
      if (ocr.text && ocr.text.trim()) {
        extracted = extractOcrFromText(ocr.text);
        extracted.ocr_engine = ocr.engine;
      } else if (!extracted.note) {
        extracted = {
          ...extracted,
          note: ocr.available ? 'OCR found no readable text' : 'Install Tesseract for image/PDF OCR',
          ocr_engine: ocr.engine || 'none'
        };
      }
    }
  }
  dbRun(`UPDATE acc_documents SET ocr_json=?, ocr_status=?, updated_at=datetime('now') WHERE id=?`,
    [JSON.stringify(extracted), extracted.confidence >= 40 ? 'ocr_pending' : 'manual_review', id]);
  audit(user, 'ocr_extract', 'acc_document', id, null, { confidence: extracted.confidence });
  return { document: dbGet(`SELECT * FROM acc_documents WHERE id=?`, [id]), extracted };
}

function confirmOcrDocument(id, confirmedData = {}, actor) {
  const user = requireAccWrite(actor);
  const doc = dbGet(`SELECT * FROM acc_documents WHERE id=?`, [id]);
  if (!doc) throw new Error('Document not found');
  dbRun(`UPDATE acc_documents SET ocr_json=?, ocr_status='confirmed' WHERE id=?`, [JSON.stringify(confirmedData), id]);
  // Never auto-post — return draft bill/invoice suggestion only
  let draft = null;
  if (confirmedData.create === 'bill') {
    draft = saveBill({
      supplier_name: confirmedData.supplier,
      bill_date: confirmedData.invoice_date || today(),
      due_date: confirmedData.due_date,
      lines: (confirmedData.items || [{ description: confirmedData.description || 'OCR item', quantity: 1, unit_price: confirmedData.total || 0 }]),
      notes: `From OCR document #${id}`
    }, user);
  }
  return { document: dbGet(`SELECT * FROM acc_documents WHERE id=?`, [id]), draft };
}

function listNotifications(actor) {
  requireAccUser(actor);
  return dbAll(`SELECT * FROM acc_notifications ORDER BY id DESC LIMIT 100`);
}

function markNotificationRead(id, actor) {
  requireAccUser(actor);
  dbRun(`UPDATE acc_notifications SET is_read=1 WHERE id=?`, [id]);
  return true;
}

function listAudit(filters = {}, actor) {
  requireAccUser(actor);
  return dbAll(`SELECT * FROM acc_audit ORDER BY id DESC LIMIT 300`);
}

function getFinancialHealth(filters = {}, actor) {
  const dash = getDashboard(filters, actor);
  const revenue = num(dash.pnl?.revenue);
  const gm = revenue ? round2((num(dash.gross_profit) / revenue) * 100) : 0;
  const nm = revenue ? round2((num(dash.net_profit) / revenue) * 100) : 0;
  const score = Math.max(0, Math.min(100, Math.round((gm * 0.45) + (nm * 0.35) + (dash.bank_balance > 0 ? 20 : 0))));
  return {
    score,
    label: score >= 75 ? 'Healthy' : (score >= 50 ? 'Stable' : 'Needs attention'),
    summary: `Gross margin ${gm}% · Net margin ${nm}% · Cash ${round2(dash.bank_balance)}`,
    revenue_growth: null,
    gross_margin: gm,
    net_margin: nm,
    cash_position: dash.bank_balance,
    ar: dash.ar_outstanding,
    ap: dash.ap_outstanding,
    inventory: dash.stock_value,
    items: [
      { label: 'Cash', value: dash.bank_balance > 0 ? 'Positive' : 'Low', tone: dash.bank_balance > 0 ? 'good' : 'warn' },
      { label: 'Margin', value: `${gm}%`, tone: gm >= 25 ? 'good' : (gm >= 10 ? 'warn' : 'bad') },
      { label: 'Receivables', value: dash.ar_outstanding > revenue ? 'High' : 'OK', tone: dash.ar_outstanding > revenue ? 'warn' : 'good' }
    ],
    indicators: {
      cash: dash.bank_balance > 0 ? 'good' : 'warn',
      margin: gm >= 25 ? 'good' : gm >= 10 ? 'warn' : 'bad',
      ar: dash.ar_outstanding > revenue ? 'warn' : 'good'
    }
  };
}

function listReconcileCentre(actor) {
  requireAccUser(actor);
  const unmatched = dbAll(`SELECT COUNT(*) AS c FROM acc_bank_stmt_lines WHERE match_status='unmatched'`)[0]?.c || 0;
  const failed = dbAll(`SELECT COUNT(*) AS c FROM acc_integration_errors WHERE status='failed'`)[0]?.c || 0;
  const pending = dbAll(`SELECT COUNT(*) AS c FROM acc_approvals WHERE status='pending'`)[0]?.c || 0;
  const tb = trialBalance(today(), actor);
  const arOpen = round2(num(dbGet(`SELECT COALESCE(SUM(total - amount_paid),0) AS t FROM acc_invoices WHERE status IN ('posted','partial')`)?.t));
  const apOpen = round2(num(dbGet(`SELECT COALESCE(SUM(total - amount_paid),0) AS t FROM acc_bills WHERE status IN ('posted','partial')`)?.t));
  return {
    bank_unmatched: unmatched,
    integration_errors: failed,
    pending_approvals: pending,
    trial_balance_ok: tb.balanced,
    ar_open: arOpen,
    ap_open: apOpen,
    stock_variance: 0,
    items: [
      { area: 'Bank', status: unmatched ? 'warn' : 'ok', detail: `${unmatched} unmatched statement lines` },
      { area: 'POS sync', status: failed ? 'bad' : 'ok', detail: `${failed} failed integrations` },
      { area: 'Approvals', status: pending ? 'warn' : 'ok', detail: `${pending} pending` },
      { area: 'Trial balance', status: tb.balanced ? 'ok' : 'bad', detail: tb.balanced ? 'Balanced' : 'Out of balance' }
    ]
  };
}

function accountingSessionFromPos(actor) {
  ensureReady();
  if (!actor?.id) throw new Error('Sign in to Admin or POS first');
  const role = String(actor.role || '').toLowerCase();
  if (!['owner', 'manager', 'supervisor', 'assistant_manager'].includes(role) && !ACC_ROLES.has(role)) {
    throw new Error('Accounting access requires owner, manager or finance role');
  }
  try { session.setUserSession?.(actor); } catch (_) { /* optional */ }
  try { syncMissingIntegrations(actor); } catch (_) { /* best effort */ }
  const { password_hash, pin, ...safe } = actor;
  return safe;
}

function accountingLogin(username, password) {
  ensureReady();
  const u = String(username || '').trim();
  const p = String(password || '');
  const fail = (reason) => {
    dbRun(`INSERT INTO acc_login_audit (username, success, reason) VALUES (?,0,?)`, [u, reason]);
    const recent = dbGet(
      `SELECT COUNT(*) AS c FROM acc_login_audit WHERE username=? AND success=0 AND created_at >= datetime('now','-15 minutes')`,
      [u]
    );
    if (num(recent?.c) >= 5) throw new Error('Account temporarily locked after failed attempts. Try again in 15 minutes.');
    throw new Error(reason || 'Invalid username or password');
  };
  if (!u || !p) fail('Username and password required');
  const user = dbGet(`SELECT * FROM users WHERE lower(username)=lower(?) AND (is_active=1 OR is_active IS NULL)`, [u]);
  if (!user) fail('Invalid username or password');
  let ok = false;
  try { ok = bcrypt.compareSync(p, user.password_hash || ''); } catch (_) { ok = false; }
  if (!ok) fail('Invalid username or password');
  const role = String(user.role || '').toLowerCase();
  if (!ACC_ROLES.has(role) && !role.includes('account') && !role.includes('finance')) {
    fail('This user does not have accounting access');
  }
  dbRun(`INSERT INTO acc_login_audit (username, success, reason) VALUES (?,1,'ok')`, [u]);
  const { password_hash, pin, ...safe } = user;
  try { session.setUserSession?.(safe); } catch (_) { /* optional */ }
  try { syncMissingIntegrations(safe); } catch (_) { /* best effort backfill */ }
  return safe;
}

function accountingLogout() {
  try { session.clearUserSession?.(); } catch (_) { /* ignore */ }
  return true;
}

function listPurchaseOrders(actor) {
  requireAccUser(actor);
  try { return dbAll(`SELECT * FROM purchase_orders ORDER BY id DESC LIMIT 100`); }
  catch (_) { return []; }
}

function listPayrollSummary(actor) {
  requireAccUser(actor);
  try {
    const records = dbAll(`
      SELECT p.id, p.employee_id, e.full_name, e.employee_code, p.period_start, p.period_end,
        p.gross_salary, p.net_salary, p.paye, p.uif_employee, p.uif_employer, p.sdl, p.bonus, p.commission,
        p.status, p.paid_at, p.payment_method
      FROM employee_payroll p JOIN employees e ON e.id=p.employee_id
      ORDER BY p.period_end DESC, p.id DESC LIMIT 200`);
    const monthTotals = dbGet(`
      SELECT SUM(COALESCE(paye,0)) AS paye,
        SUM(COALESCE(uif_employee,0) + COALESCE(uif_employer,0)) AS uif,
        SUM(COALESCE(sdl,0)) AS sdl,
        SUM(CASE WHEN status='paid' THEN COALESCE(net_salary,0) ELSE 0 END) AS paid_net
      FROM employee_payroll WHERE date(period_end) >= date('now','start of month')`) || {};
    return {
      records,
      recent: records.slice(0, 50),
      rows: records,
      employees: records,
      liabilities: accountBalance(16),
      month_totals: monthTotals
    };
  } catch (_) {
    return { records: [], recent: [], rows: [], employees: [], liabilities: 0, month_totals: {} };
  }
}

module.exports = {
  ensureReady,
  getSettings,
  saveSettings,
  accountingLogin,
  accountingSessionFromPos,
  accountingLogout,
  postJournal,
  publishJournal,
  reverseJournal,
  listJournals,
  getJournal,
  listLedger,
  listAccounts,
  saveAccount,
  setAccountActive,
  listPeriods,
  closePeriod,
  reopenPeriod,
  lockPeriod,
  runYearEnd,
  postFromSale,
  postFromSaleSnapshot,
  reverseSaleAccounting,
  reverseSaleAccountingSnapshot,
  postFromExpense,
  postFromExpenseSnapshot,
  postFromReturnSnapshot,
  postFromPurchaseReceiveSnapshot,
  postFromSupplierPaymentSnapshot,
  postFromCustomerCreditPaymentSnapshot,
  postFromPayroll,
  postFromPayrollSnapshot,
  postFromPurchaseReceive,
  postFromSupplierPayment,
  postFromCustomerCreditPayment,
  postFromCashup,
  retryIntegrationError,
  listIntegrationErrors,
  listInvoices,
  getInvoice,
  saveInvoice,
  postInvoice,
  listCreditNotes,
  saveCreditNote,
  postCreditNote,
  listDebitNotes,
  saveDebitNote,
  postDebitNote,
  listBills,
  saveBill,
  postBill,
  listPayments,
  savePayment,
  listRefunds,
  saveRefund,
  arAging,
  apAging,
  customerStatement,
  supplierStatement,
  saveStatementHistory,
  listStatementHistory,
  getStatementHistory,
  parseBankStatement,
  listBankAccounts,
  saveBankAccount,
  listBankTxns,
  saveBankTxn,
  importBankStatement,
  matchBankStmtLine,
  createReconciliation,
  completeReconciliation,
  listBankStatementLines,
  listCashupFinance,
  postFromReturn,
  syncPosReceipts,
  syncMissingIntegrations,
  listCashAccounts,
  listCashTxns,
  saveCashTxn,
  listPettyCash,
  savePettyCashExpense,
  saveCashupFinance,
  listAccExpenses,
  recordExpenseViaAccounting,
  listRecurring,
  saveRecurring,
  processDueRecurring,
  listOtherIncome,
  saveOtherIncome,
  listAssets,
  saveAsset,
  runDepreciation,
  listLoans,
  saveLoan,
  recordLoanPayment,
  listOwnerTxns,
  saveOwnerTxn,
  listTaxRates,
  saveTaxRate,
  taxSummary,
  profitAndLoss,
  balanceSheet,
  cashFlow,
  trialBalance,
  salesReport,
  purchaseReport,
  expenseReport,
  stockValueReport,
  drillDown,
  getDashboard,
  globalSearch,
  listApprovals,
  decideApproval,
  listDocuments,
  saveDocument,
  getDocumentFile,
  processOcrDocument,
  extractOcrFromText,
  confirmOcrDocument,
  listNotifications,
  markNotificationRead,
  listAudit,
  getFinancialHealth,
  listReconcileCentre,
  listPurchaseOrders,
  listPayrollSummary,
  accountBalance
};

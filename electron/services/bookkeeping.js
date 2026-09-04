const { getDb } = require('../database/db');
const branchesSvc = require('./branches');

function branchLabelForId(branchId) {
  if (branchId == null || branchId === '') {
    try {
      const tillId = getDb().prepare('SELECT branch_id FROM shop_settings WHERE id = 1').get()?.branch_id || 1;
      return branchLabelForId(tillId);
    } catch (_) {
      return 'MAIN';
    }
  }
  const b = getDb().prepare('SELECT code, name FROM branches WHERE id = ?').get(Number(branchId));
  return (b?.code || b?.name || String(branchId)).toUpperCase();
}

function ledgerBranchClause(branchId, alias = '') {
  if (branchId == null || branchId === '' || branchId === 'all') return { sql: '', params: [] };
  const col = alias ? `${alias}.branch` : 'branch';
  return { sql: ` AND ${col} = ?`, params: [branchLabelForId(branchId)] };
}

const EXPENSE_CATEGORIES = [
  'Stock Purchases', 'Rent', 'Electricity', 'Water', 'Fuel', 'Transport', 'Salaries',
  'UIF', 'PAYE', 'SDL', 'COIDA', 'Internet', 'Telephone', 'Equipment', 'Marketing',
  'Repairs & Maintenance', 'Other Expenses'
];

const INCOME_TYPES = [
  'Sales Income', 'Other Income', 'Owner Investment', 'Customer Payments', 'Miscellaneous Income'
];

function accountTypeForPayment(method) {
  const m = String(method || 'cash').toLowerCase();
  if (m === 'eft' || m === 'card' || m === 'bank') return 'bank';
  return 'cash';
}

function logFinancialAudit(entityType, entityId, action, field, oldVal, newVal, actor) {
  getDb().prepare(`
    INSERT INTO financial_audit_trail (entity_type, entity_id, action, field_name, previous_value, new_value, user_id, user_name)
    VALUES (?,?,?,?,?,?,?,?)`).run(
    entityType, entityId || null, action, field || null,
    oldVal != null ? String(oldVal) : null, newVal != null ? String(newVal) : null,
    actor?.id || null, actor?.full_name || actor?.username || null
  );
}

function getBookkeepingSettings() {
  return getDb().prepare('SELECT * FROM bookkeeping_settings WHERE id = 1').get() || {};
}

function saveBookkeepingSettings(data, actor) {
  const prev = getBookkeepingSettings();
  getDb().prepare(`
    UPDATE bookkeeping_settings SET
      cash_opening_balance=?, bank_opening_balance=?, bank_name=?, bank_account_number=?,
      vat_rate=?, vat_registered=?, fiscal_year_start=?, low_cash_threshold=?,
      notification_settings=?, updated_at=datetime('now') WHERE id=1`).run(
    Number(data.cash_opening_balance) || 0,
    Number(data.bank_opening_balance) || 0,
    data.bank_name || null, data.bank_account_number || null,
    Number(data.vat_rate) || 15, data.vat_registered ? 1 : 0,
    data.fiscal_year_start || '03-01',
    Number(data.low_cash_threshold) || 500,
    typeof data.notification_settings === 'string' ? data.notification_settings : JSON.stringify(data.notification_settings || {}),
  );
  logFinancialAudit('bookkeeping_settings', 1, 'update', 'settings', JSON.stringify(prev), JSON.stringify(data), actor);
  return getBookkeepingSettings();
}

function upsertLedger(entry) {
  const db = getDb();
  const existing = db.prepare(`
    SELECT id FROM ledger_entries WHERE reference_type=? AND reference_id=? AND txn_type=? AND COALESCE(subcategory,'')=COALESCE(?, '')
  `).get(entry.reference_type, entry.reference_id, entry.txn_type, entry.subcategory || '');
  if (existing) return existing.id;
  const r = db.prepare(`
    INSERT INTO ledger_entries (txn_number, txn_date, txn_type, category, subcategory, description, amount, direction,
      payment_method, account_type, reference_type, reference_id, employee_id, customer_id, supplier_id, branch,
      is_auto, created_by, created_by_name, notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    entry.txn_number, entry.txn_date, entry.txn_type, entry.category || null, entry.subcategory || null,
    entry.description || null, Number(entry.amount) || 0, entry.direction,
    entry.payment_method || null, entry.account_type || 'cash',
    entry.reference_type || null, entry.reference_id || null,
    entry.employee_id || null, entry.customer_id || null, entry.supplier_id || null,
    entry.branch || 'main', entry.is_auto ? 1 : 0,
    entry.created_by || null, entry.created_by_name || null, entry.notes || null
  );
  return r.lastInsertRowid;
}

function syncLedger(from, to) {
  // Legacy bookkeeping ledger is disabled — acc_* journals are the single source of truth.
  return { synced: 0, skipped: true, message: 'Legacy bookkeeping sync disabled. Use Accounting Command Centre.' };
}

function _syncLedgerLegacy(from, to) {
  const db = getDb();
  const range = [from, to];

  const run = (label, fn) => {
    try { fn(); } catch (err) { console.error('syncLedger:', label, err.message); }
  };

  run('sales', () => {
    db.prepare(`
      SELECT sp.*, s.receipt_number, s.created_at, s.branch_id, u.full_name as cashier_name FROM sale_payments sp
      JOIN sales s ON s.id=sp.sale_id
      LEFT JOIN users u ON u.id=s.user_id
      WHERE s.status IN ('completed','partial_return') AND date(s.created_at, 'localtime') BETWEEN date(?) AND date(?)`).all(...range).forEach(sp => {
      upsertLedger({
        txn_number: `SP-${sp.id}`, txn_date: (sp.created_at || '').slice(0, 10), txn_type: 'sale',
        category: 'Sales Income', subcategory: sp.payment_type,
        description: `Sale ${sp.receipt_number} (${sp.payment_type})`, amount: sp.amount, direction: 'in',
        payment_method: sp.payment_type, account_type: accountTypeForPayment(sp.payment_type),
        reference_type: 'sale_payment', reference_id: sp.id, is_auto: 1, created_by_name: sp.cashier_name,
        branch: branchLabelForId(sp.branch_id)
      });
    });
  });

  run('returns', () => {
    db.prepare(`
      SELECT r.*, s.receipt_number, s.branch_id FROM returns r LEFT JOIN sales s ON s.id=r.sale_id
      WHERE date(r.created_at) BETWEEN date(?) AND date(?)`).all(...range).forEach(r => {
      upsertLedger({
        txn_number: `RET-${r.id}`, txn_date: (r.created_at || '').slice(0, 10), txn_type: 'return',
        category: 'Refunds & Returns', description: `Return ${r.return_number || r.id} — ${r.reason || ''}`,
        amount: r.total_refund || 0, direction: 'out',
        payment_method: r.refund_method || 'cash', account_type: accountTypeForPayment(r.refund_method),
        reference_type: 'return', reference_id: r.id, customer_id: r.customer_id, is_auto: 1,
        branch: branchLabelForId(s.branch_id)
      });
    });
  });

  run('expenses', () => {
    db.prepare(`SELECT * FROM expenses WHERE expense_date BETWEEN ? AND ?`).all(...range).forEach(e => {
      upsertLedger({
        txn_number: `EXP-${e.id}`, txn_date: e.expense_date, txn_type: 'expense',
        category: e.category || 'Other Expenses', description: e.description || e.category,
        amount: e.amount, direction: 'out', payment_method: 'cash', account_type: 'cash',
        reference_type: 'expense', reference_id: e.id, is_auto: 1,
        branch: branchLabelForId(e.branch_id)
      });
    });
  });

  run('supplier_payments', () => {
    db.prepare(`
      SELECT sp.*, s.name as supplier_name FROM supplier_payments sp JOIN suppliers s ON s.id=sp.supplier_id
      WHERE date(sp.created_at) BETWEEN date(?) AND date(?)`).all(...range).forEach(sp => {
      upsertLedger({
        txn_number: sp.payment_number || `SUP-${sp.id}`, txn_date: (sp.created_at || '').slice(0, 10),
        txn_type: 'supplier_payment', category: 'Stock Purchases', subcategory: 'Supplier Payment',
        description: `Payment to ${sp.supplier_name}`, amount: sp.amount, direction: 'out',
        payment_method: sp.payment_method, account_type: accountTypeForPayment(sp.payment_method),
        reference_type: 'supplier_payment', reference_id: sp.id, supplier_id: sp.supplier_id, is_auto: 1
      });
    });
  });

  run('purchase_orders', () => {
    db.prepare(`
      SELECT po.*, s.name as supplier_name FROM purchase_orders po LEFT JOIN suppliers s ON s.id=po.supplier_id
      WHERE po.status='received' AND date(po.receiving_date) BETWEEN date(?) AND date(?)`).all(...range).forEach(po => {
      upsertLedger({
        txn_number: `PO-${po.id}`, txn_date: po.receiving_date || (po.updated_at || '').slice(0, 10),
        txn_type: 'purchase', category: 'Stock Purchases', description: `PO ${po.po_number || po.id} — ${po.supplier_name || ''}`,
        amount: po.total || 0, direction: 'out', payment_method: 'account', account_type: 'cash',
        reference_type: 'purchase_order', reference_id: po.id, supplier_id: po.supplier_id, is_auto: 1
      });
    });
  });

  run('payroll', () => {
    db.prepare(`
      SELECT p.*, e.full_name FROM employee_payroll p JOIN employees e ON e.id=p.employee_id
      WHERE p.status='paid' AND date(COALESCE(p.paid_at, p.period_end)) BETWEEN date(?) AND date(?)`).all(...range).forEach(p => {
      syncPayrollRow(p);
    });
  });

  run('owner_salary', () => {
    db.prepare(`
      SELECT op.*, pr.owner_name FROM owner_salary_payments op
      JOIN owner_salary_profile pr ON pr.id=op.profile_id
      WHERE date(op.payment_date) BETWEEN date(?) AND date(?)`).all(...range).forEach(op => {
      upsertLedger({
        txn_number: op.payment_reference || `OS-${op.id}`, txn_date: op.payment_date, txn_type: 'owner_salary',
        category: 'Owner Salary', description: `Owner salary — ${op.owner_name || 'Owner'}`, amount: op.total_amount, direction: 'out',
        payment_method: op.payment_method || 'cash', account_type: accountTypeForPayment(op.payment_method),
        reference_type: 'owner_salary_payment', reference_id: op.id, is_auto: 1
      });
    });
  });

  run('advances', () => {
    db.prepare(`
      SELECT * FROM employee_advances WHERE date(advance_date) BETWEEN date(?) AND date(?)`).all(...range).forEach(a => {
      upsertLedger({
        txn_number: `ADV-${a.id}`, txn_date: a.advance_date, txn_type: 'salary_advance',
        category: 'Salary Advances', description: a.reason || a.notes || 'Salary advance', amount: a.amount, direction: 'out',
        reference_type: 'employee_advance', reference_id: a.id, employee_id: a.employee_id, is_auto: 1
      });
    });
  });

  run('customer_credit', () => {
    db.prepare(`
      SELECT ccl.*, c.name as customer_name FROM customer_credit_ledger ccl JOIN customers c ON c.id=ccl.customer_id
      WHERE ccl.type='payment' AND date(ccl.created_at) BETWEEN date(?) AND date(?)`).all(...range).forEach(c => {
      upsertLedger({
        txn_number: `CCP-${c.id}`, txn_date: (c.created_at || '').slice(0, 10), txn_type: 'customer_credit',
        category: 'Customer Payments', description: `Credit payment — ${c.customer_name}`, amount: Math.abs(c.amount), direction: 'in',
        reference_type: 'customer_credit', reference_id: c.id, customer_id: c.customer_id, is_auto: 1
      });
    });
  });

  run('income_entries', () => {
    db.prepare(`SELECT * FROM income_entries WHERE income_date BETWEEN ? AND ?`).all(...range).forEach(inc => {
      upsertLedger({
        txn_number: `INC-${inc.id}`, txn_date: inc.income_date, txn_type: 'income',
        category: inc.income_type || inc.category || 'Other Income', description: inc.description || inc.income_type,
        amount: inc.amount, direction: 'in', payment_method: inc.payment_method, account_type: inc.account_type || 'cash',
        reference_type: 'income_entry', reference_id: inc.id, customer_id: inc.customer_id, is_auto: 1,
        created_by_name: inc.created_by_name
      });
    });
  });

  run('bank_transactions', () => {
    db.prepare(`SELECT * FROM bank_transactions WHERE txn_date BETWEEN ? AND ?`).all(...range).forEach(bt => {
      upsertLedger({
        txn_number: `BNK-${bt.id}`, txn_date: bt.txn_date, txn_type: 'bank_' + bt.txn_type,
        category: bt.txn_type, description: bt.description || bt.txn_type, amount: bt.amount,
        direction: bt.direction, account_type: 'bank', reference_type: 'bank_transaction', reference_id: bt.id,
        is_auto: 1, created_by_name: bt.created_by_name
      });
    });
  });
}

function eName(p) { return p.full_name || p.employee_id; }

function syncPayrollRow(p) {
  if (!p || p.status !== 'paid') return;
  const txnDate = (p.paid_at || p.period_end || '').slice(0, 10);
  upsertLedger({
    txn_number: `PAY-${p.id}`, txn_date: txnDate,
    txn_type: 'payroll', category: 'Salaries', subcategory: 'Net Salary',
    description: `Payroll ${eName(p)} ${p.period_start}–${p.period_end}`, amount: p.net_salary, direction: 'out',
    payment_method: p.payment_method || 'cash', account_type: accountTypeForPayment(p.payment_method),
    reference_type: 'employee_payroll', reference_id: p.id, employee_id: p.employee_id, is_auto: 1
  });
  if (p.uif_employee) upsertLedger({
    txn_number: `UIF-E-${p.id}`, txn_date: txnDate,
    txn_type: 'payroll', category: 'UIF', subcategory: 'UIF-Employee',
    description: `UIF employee — ${eName(p)}`, amount: p.uif_employee, direction: 'out',
    reference_type: 'employee_payroll', reference_id: p.id, employee_id: p.employee_id, is_auto: 1
  });
  if (p.paye) upsertLedger({
    txn_number: `PAYE-${p.id}`, txn_date: txnDate,
    txn_type: 'payroll', category: 'PAYE', subcategory: 'PAYE',
    description: `PAYE — ${eName(p)}`, amount: p.paye, direction: 'out',
    reference_type: 'employee_payroll', reference_id: p.id, employee_id: p.employee_id, is_auto: 1
  });
  if (p.sdl) upsertLedger({
    txn_number: `SDL-${p.id}`, txn_date: txnDate,
    txn_type: 'payroll', category: 'SDL', subcategory: 'SDL',
    description: `SDL — ${eName(p)}`, amount: p.sdl, direction: 'out',
    reference_type: 'employee_payroll', reference_id: p.id, employee_id: p.employee_id, is_auto: 1
  });
  if (p.coida) upsertLedger({
    txn_number: `COIDA-${p.id}`, txn_date: txnDate,
    txn_type: 'payroll', category: 'COIDA', subcategory: 'COIDA',
    description: `COIDA — ${eName(p)}`, amount: p.coida, direction: 'out',
    reference_type: 'employee_payroll', reference_id: p.id, employee_id: p.employee_id, is_auto: 1
  });
}

function syncPayrollEntry(payrollId, actor) {
  const p = getDb().prepare(`
    SELECT p.*, e.full_name FROM employee_payroll p JOIN employees e ON e.id=p.employee_id WHERE p.id=?`).get(payrollId);
  if (!p) throw new Error('Payroll record not found');
  if (p.status !== 'paid') throw new Error('Payroll must be marked as paid before syncing to accounting');
  syncPayrollRow(p);
  logFinancialAudit('employee_payroll', payrollId, 'sync', 'payroll', null, JSON.stringify({ net: p.net_salary }), actor);
  return { synced: true, payroll_id: payrollId };
}

function sumLedger(sql, params) {
  return Number(getDb().prepare(sql).get(...params)?.v || 0);
}

function getFinancialDashboard(from, to, branchId = null) {
  syncLedger(from, to);
  const db = getDb();
  const settings = getBookkeepingSettings();
  const branchSql = ledgerBranchClause(branchId, 'l');

  const totalIncome = sumLedger(`SELECT COALESCE(SUM(amount),0) as v FROM ledger_entries l WHERE direction='in' AND txn_date BETWEEN ? AND ?${branchSql.sql}`, [from, to, ...branchSql.params]);
  const totalExpenses = sumLedger(`SELECT COALESCE(SUM(amount),0) as v FROM ledger_entries l WHERE direction='out' AND txn_date BETWEEN ? AND ?${branchSql.sql}`, [from, to, ...branchSql.params]);
  let revenueSql = `SELECT COALESCE(SUM(total),0) as v FROM sales WHERE status='completed' AND date(created_at) BETWEEN date(?) AND date(?)`;
  const revenueParams = [from, to];
  if (branchId != null && branchId !== '' && branchId !== 'all') {
    revenueSql += ' AND branch_id = ?';
    revenueParams.push(Number(branchId));
  }
  const revenue = db.prepare(revenueSql).get(...revenueParams)?.v || 0;
  let cogsSql = `
    SELECT COALESCE(SUM(si.quantity * si.buying_price),0) as v FROM sale_items si
    JOIN sales s ON si.sale_id=s.id WHERE s.status='completed' AND date(s.created_at) BETWEEN date(?) AND date(?)`;
  const cogsParams = [from, to];
  if (branchId != null && branchId !== '' && branchId !== 'all') {
    cogsSql += ' AND s.branch_id = ?';
    cogsParams.push(Number(branchId));
  }
  const cogs = db.prepare(cogsSql).get(...cogsParams)?.v || 0;
  const grossProfit = revenue - cogs;
  const netProfit = grossProfit - totalExpenses;

  const cashIn = sumLedger(`SELECT COALESCE(SUM(amount),0) as v FROM ledger_entries l WHERE direction='in' AND account_type='cash' AND txn_date<=?${branchSql.sql}`, [to, ...branchSql.params]);
  const cashOut = sumLedger(`SELECT COALESCE(SUM(amount),0) as v FROM ledger_entries l WHERE direction='out' AND account_type='cash' AND txn_date<=?${branchSql.sql}`, [to, ...branchSql.params]);
  const bankIn = sumLedger(`SELECT COALESCE(SUM(amount),0) as v FROM ledger_entries l WHERE direction='in' AND account_type='bank' AND txn_date<=?${branchSql.sql}`, [to, ...branchSql.params]);
  const bankOut = sumLedger(`SELECT COALESCE(SUM(amount),0) as v FROM ledger_entries l WHERE direction='out' AND account_type='bank' AND txn_date<=?${branchSql.sql}`, [to, ...branchSql.params]);

  const cashBalance = (settings.cash_opening_balance || 0) + cashIn - cashOut;
  const bankBalance = (settings.bank_opening_balance || 0) + bankIn - bankOut;

  const accountsReceivable = db.prepare(`SELECT COALESCE(SUM(balance),0) as v FROM customers WHERE balance > 0`).get()?.v || 0;
  const accountsPayable = db.prepare(`SELECT COALESCE(SUM(balance_owed),0) as v FROM suppliers WHERE balance_owed > 0`).get()?.v || 0;
  const payrollPending = db.prepare(`SELECT COALESCE(SUM(net_salary),0) as v FROM employee_payroll WHERE status='pending'`).get()?.v || 0;
  const ownerOutstanding = db.prepare(`SELECT COALESCE(SUM(outstanding_balance),0) as v FROM owner_salary_periods WHERE outstanding_balance > 0`).get()?.v || 0;
  const outstandingPayments = accountsPayable + payrollPending + ownerOutstanding;

  const inventoryValue = db.prepare(`SELECT COALESCE(SUM(stock_quantity * buying_price),0) as v FROM products WHERE is_active=1`).get()?.v || 0;

  return {
    totalIncome, totalExpenses, grossProfit, netProfit, revenue, cogs,
    cashBalance, bankBalance, accountsReceivable, accountsPayable, outstandingPayments,
    payrollPending, ownerOutstanding, inventoryValue,
    grossMargin: revenue > 0 ? (grossProfit / revenue * 100) : 0,
    netMargin: revenue > 0 ? (netProfit / revenue * 100) : 0,
    branch_id: branchId != null && branchId !== '' && branchId !== 'all' ? Number(branchId) : null,
    branch_label: branchId != null && branchId !== '' && branchId !== 'all' ? branchLabelForId(branchId) : 'All branches'
  };
}

function searchLedger(filters = {}) {
  syncLedger(filters.from || '2000-01-01', filters.to || '2099-12-31');
  let sql = `SELECT l.*, e.full_name as employee_name, c.name as customer_name, s.name as supplier_name
    FROM ledger_entries l
    LEFT JOIN employees e ON e.id=l.employee_id
    LEFT JOIN customers c ON c.id=l.customer_id
    LEFT JOIN suppliers s ON s.id=l.supplier_id WHERE 1=1`;
  const params = [];
  if (filters.from) { sql += ' AND l.txn_date >= ?'; params.push(filters.from); }
  if (filters.to) { sql += ' AND l.txn_date <= ?'; params.push(filters.to); }
  if (filters.txn_type) { sql += ' AND l.txn_type = ?'; params.push(filters.txn_type); }
  if (filters.category) { sql += ' AND l.category = ?'; params.push(filters.category); }
  if (filters.payment_method) { sql += ' AND l.payment_method = ?'; params.push(filters.payment_method); }
  if (filters.account_type) { sql += ' AND l.account_type = ?'; params.push(filters.account_type); }
  if (filters.branch) { sql += ' AND l.branch = ?'; params.push(filters.branch); }
  if (filters.q) {
    sql += ' AND (l.txn_number LIKE ? OR l.description LIKE ? OR l.category LIKE ? OR l.txn_type LIKE ?)';
    const q = `%${filters.q}%`; params.push(q, q, q, q);
  }
  if (filters.min_amount) { sql += ' AND l.amount >= ?'; params.push(Number(filters.min_amount)); }
  if (filters.max_amount) { sql += ' AND l.amount <= ?'; params.push(Number(filters.max_amount)); }
  if (filters.employee_id) { sql += ' AND l.employee_id = ?'; params.push(filters.employee_id); }
  if (filters.customer_id) { sql += ' AND l.customer_id = ?'; params.push(filters.customer_id); }
  if (filters.supplier_id) { sql += ' AND l.supplier_id = ?'; params.push(filters.supplier_id); }
  sql += ' ORDER BY l.txn_date DESC, l.id DESC LIMIT 500';
  return getDb().prepare(sql).all(...params);
}

function getIncomeEntries(filters = {}) {
  let sql = 'SELECT * FROM income_entries WHERE 1=1';
  const params = [];
  if (filters.from) { sql += ' AND income_date >= ?'; params.push(filters.from); }
  if (filters.to) { sql += ' AND income_date <= ?'; params.push(filters.to); }
  if (filters.income_type) { sql += ' AND income_type = ?'; params.push(filters.income_type); }
  sql += ' ORDER BY income_date DESC';
  return getDb().prepare(sql).all(...params);
}

function saveIncomeEntry(data, actor) {
  const db = getDb();
  if (data.id) {
    const prev = db.prepare('SELECT * FROM income_entries WHERE id=?').get(data.id);
    db.prepare(`UPDATE income_entries SET income_type=?, category=?, description=?, amount=?, income_date=?, payment_method=?, account_type=?, customer_id=?, reference=?, notes=? WHERE id=?`)
      .run(data.income_type, data.category, data.description, Number(data.amount), data.income_date,
        data.payment_method || 'cash', data.account_type || 'cash', data.customer_id || null, data.reference || null, data.notes || null, data.id);
    logFinancialAudit('income_entry', data.id, 'update', 'amount', prev?.amount, data.amount, actor);
    syncLedger(data.income_date, data.income_date);
    return db.prepare('SELECT * FROM income_entries WHERE id=?').get(data.id);
  }
  const r = db.prepare(`
    INSERT INTO income_entries (income_type, category, description, amount, income_date, payment_method, account_type, customer_id, reference, created_by, created_by_name, notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    data.income_type, data.category || data.income_type, data.description, Number(data.amount), data.income_date,
    data.payment_method || 'cash', data.account_type || 'cash', data.customer_id || null, data.reference || null,
    actor?.id, actor?.full_name || actor?.username, data.notes || null
  );
  logFinancialAudit('income_entry', r.lastInsertRowid, 'create', null, null, data.amount, actor);
  syncLedger(data.income_date, data.income_date);
  return db.prepare('SELECT * FROM income_entries WHERE id=?').get(r.lastInsertRowid);
}

function deleteIncomeEntry(id, actor) {
  const prev = getDb().prepare('SELECT * FROM income_entries WHERE id=?').get(id);
  getDb().prepare('DELETE FROM income_entries WHERE id=?').run(id);
  getDb().prepare(`DELETE FROM ledger_entries WHERE reference_type='income_entry' AND reference_id=?`).run(id);
  logFinancialAudit('income_entry', id, 'delete', null, prev?.amount, null, actor);
}

function getBankTransactions(filters = {}) {
  let sql = 'SELECT * FROM bank_transactions WHERE 1=1';
  const params = [];
  if (filters.from) { sql += ' AND txn_date >= ?'; params.push(filters.from); }
  if (filters.to) { sql += ' AND txn_date <= ?'; params.push(filters.to); }
  if (filters.txn_type) { sql += ' AND txn_type = ?'; params.push(filters.txn_type); }
  sql += ' ORDER BY txn_date DESC';
  return getDb().prepare(sql).all(...params);
}

function saveBankTransaction(data, actor) {
  const db = getDb();
  if (data.id) {
    const prev = db.prepare('SELECT * FROM bank_transactions WHERE id=?').get(data.id);
    db.prepare(`UPDATE bank_transactions SET txn_date=?, txn_type=?, description=?, amount=?, direction=?, bank_reference=?, reconciled=?, reconciled_date=?, notes=? WHERE id=?`)
      .run(data.txn_date, data.txn_type, data.description, Number(data.amount), data.direction,
        data.bank_reference || null, data.reconciled ? 1 : 0, data.reconciled_date || null, data.notes || null, data.id);
    logFinancialAudit('bank_transaction', data.id, 'update', 'amount', prev?.amount, data.amount, actor);
    syncLedger(data.txn_date, data.txn_date);
    return db.prepare('SELECT * FROM bank_transactions WHERE id=?').get(data.id);
  }
  const r = db.prepare(`
    INSERT INTO bank_transactions (txn_date, txn_type, description, amount, direction, bank_reference, reconciled, reconciled_date, created_by, created_by_name, notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    data.txn_date, data.txn_type, data.description, Number(data.amount), data.direction,
    data.bank_reference || null, data.reconciled ? 1 : 0, data.reconciled_date || null,
    actor?.id, actor?.full_name || actor?.username, data.notes || null
  );
  logFinancialAudit('bank_transaction', r.lastInsertRowid, 'create', null, null, data.amount, actor);
  syncLedger(data.txn_date, data.txn_date);
  return db.prepare('SELECT * FROM bank_transactions WHERE id=?').get(r.lastInsertRowid);
}

function getCashBook(from, to) {
  syncLedger(from, to);
  const settings = getBookkeepingSettings();
  const days = getDb().prepare(`
    SELECT txn_date as day,
      SUM(CASE WHEN direction='in' AND account_type='cash' THEN amount ELSE 0 END) as cash_in,
      SUM(CASE WHEN direction='out' AND account_type='cash' THEN amount ELSE 0 END) as cash_out
    FROM ledger_entries WHERE account_type='cash' AND txn_date BETWEEN ? AND ?
    GROUP BY txn_date ORDER BY txn_date`).all(from, to);

  let running = settings.cash_opening_balance || 0;
  const priorIn = sumLedger(`SELECT COALESCE(SUM(amount),0) as v FROM ledger_entries WHERE direction='in' AND account_type='cash' AND txn_date<?`, [from]);
  const priorOut = sumLedger(`SELECT COALESCE(SUM(amount),0) as v FROM ledger_entries WHERE direction='out' AND account_type='cash' AND txn_date<?`, [from]);
  running += priorIn - priorOut;

  const rows = days.map(d => {
    const opening = running;
    running += (d.cash_in || 0) - (d.cash_out || 0);
    return { ...d, opening_balance: opening, closing_balance: running };
  });

  const totalIn = rows.reduce((s, r) => s + (r.cash_in || 0), 0);
  const totalOut = rows.reduce((s, r) => s + (r.cash_out || 0), 0);
  const openingBalance = (settings.cash_opening_balance || 0) + priorIn - priorOut;
  return { openingBalance, totalIn, totalOut, closingBalance: openingBalance + totalIn - totalOut, days: rows };
}

function getBankBook(from, to) {
  syncLedger(from, to);
  const settings = getBookkeepingSettings();
  const txns = getBankTransactions({ from, to });
  const ledgerBank = getDb().prepare(`
    SELECT * FROM ledger_entries WHERE account_type='bank' AND txn_date BETWEEN ? AND ? ORDER BY txn_date`).all(from, to);
  const deposits = txns.filter(t => t.direction === 'in').reduce((s, t) => s + t.amount, 0)
    + ledgerBank.filter(l => l.direction === 'in').reduce((s, l) => s + l.amount, 0);
  const withdrawals = txns.filter(t => t.direction === 'out').reduce((s, t) => s + t.amount, 0)
    + ledgerBank.filter(l => l.direction === 'out').reduce((s, l) => s + l.amount, 0);
  const priorIn = sumLedger(`SELECT COALESCE(SUM(amount),0) as v FROM ledger_entries WHERE direction='in' AND account_type='bank' AND txn_date<?`, [from]);
  const priorOut = sumLedger(`SELECT COALESCE(SUM(amount),0) as v FROM ledger_entries WHERE direction='out' AND account_type='bank' AND txn_date<?`, [from]);
  const opening = (settings.bank_opening_balance || 0) + priorIn - priorOut;
  return {
    openingBalance: opening, deposits, withdrawals, closingBalance: opening + deposits - withdrawals,
    transactions: txns, unreconciled: txns.filter(t => !t.reconciled).length,
    bankName: settings.bank_name, accountNumber: settings.bank_account_number
  };
}

function getPayrollAccounting(from, to) {
  syncLedger(from, to);
  const db = getDb();
  const payroll = db.prepare(`
    SELECT COALESCE(SUM(basic_salary),0) as basic, COALESCE(SUM(net_salary),0) as net,
      COALESCE(SUM(paye),0) as paye, COALESCE(SUM(uif_employee),0) as uif_emp, COALESCE(SUM(uif_employer),0) as uif_er,
      COALESCE(SUM(sdl),0) as sdl, COALESCE(SUM(coida),0) as coida,
      COALESCE(SUM(advance_recovery),0) as advances, COALESCE(SUM(loan_recovery),0) as loans,
      COALESCE(SUM(damage_recovery),0) as damage, COALESCE(SUM(pension_deduction),0) as pension,
      COALESCE(SUM(medical_deduction),0) as medical
    FROM employee_payroll WHERE date(period_end) BETWEEN date(?) AND date(?)`).get(from, to);
  const ownerPaid = db.prepare(`
    SELECT COALESCE(SUM(total_amount),0) as v FROM owner_salary_payments WHERE date(payment_date) BETWEEN date(?) AND date(?)`).get(from, to)?.v || 0;
  return { ...payroll, ownerSalary: ownerPaid };
}

function getTaxSummary(from, to, branchId) {
  syncLedger(from, to);
  const db = getDb();
  const settings = getBookkeepingSettings();
  const shop = (() => {
    try {
      return db.prepare('SELECT tax_enabled, tax_rate, tax_inclusive, vat_number FROM shop_settings WHERE id = 1').get() || {};
    } catch (_) {
      return {};
    }
  })();
  const vatRate = Number(settings.vat_rate) || Number(shop.tax_rate) || 15;
  const vatRegistered = settings.vat_registered != null
    ? !!settings.vat_registered
    : !!(shop.tax_enabled);

  let branchSql = '';
  const params = [from, to];
  if (branchId != null && branchId !== '' && branchId !== 'all') {
    branchSql = ' AND branch_id = ?';
    params.push(Number(branchId));
  }

  const salesRow = db.prepare(`
    SELECT COALESCE(SUM(total),0) as sales,
      COALESCE(SUM(tax_amount),0) as output_vat,
      COALESCE(SUM(subtotal),0) as excl
    FROM sales WHERE status='completed' AND date(created_at) BETWEEN date(?) AND date(?)${branchSql}
  `).get(...params) || {};

  let outputVat = Number(salesRow.output_vat) || 0;
  const sales = Number(salesRow.sales) || 0;
  if (vatRegistered && !outputVat && sales) {
    outputVat = sales * vatRate / (100 + vatRate);
  }

  let inputVat = 0;
  try {
    const pParams = [from, to];
    let pSql = `
      SELECT COALESCE(SUM(tax_amount),0) as v FROM purchase_orders
      WHERE status IN ('received','partial') AND date(COALESCE(receiving_date, created_at)) BETWEEN date(?) AND date(?)`;
    // POs don't have branch_id yet — keep global input VAT
    inputVat = db.prepare(pSql).get(...pParams)?.v || 0;
  } catch (_) {
    inputVat = 0;
  }

  const paye = db.prepare(`SELECT COALESCE(SUM(paye),0) as v FROM employee_payroll WHERE date(period_end) BETWEEN date(?) AND date(?)`).get(from, to)?.v || 0;
  const uif = db.prepare(`SELECT COALESCE(SUM(uif_employee+uif_employer),0) as v FROM employee_payroll WHERE date(period_end) BETWEEN date(?) AND date(?)`).get(from, to)?.v || 0;
  const sdl = db.prepare(`SELECT COALESCE(SUM(sdl),0) as v FROM employee_payroll WHERE date(period_end) BETWEEN date(?) AND date(?)`).get(from, to)?.v || 0;
  const coida = db.prepare(`SELECT COALESCE(SUM(coida),0) as v FROM employee_payroll WHERE date(period_end) BETWEEN date(?) AND date(?)`).get(from, to)?.v || 0;
  const netVat = Math.round((outputVat - inputVat) * 100) / 100;

  const salesList = db.prepare(`
    SELECT s.id, s.receipt_number, s.created_at, s.subtotal, s.tax_amount, s.total, s.branch_id,
      s.order_type, s.order_source,
      COALESCE(u.full_name, '—') AS cashier_name, b.name as branch_name
    FROM sales s
    LEFT JOIN users u ON s.user_id = u.id
    LEFT JOIN branches b ON s.branch_id = b.id
    WHERE s.status='completed' AND date(s.created_at) BETWEEN date(?) AND date(?)${branchSql.replace(/branch_id/g, 's.branch_id')}
    ORDER BY s.created_at DESC
    LIMIT 2000
  `).all(...params).map((s) => ({
    ...s,
    channel: s.order_type === 'online' || String(s.order_source || '').toUpperCase() === 'ONLINE' ? 'Online' : 'POS'
  }));

  return {
    vat: outputVat,
    outputVat,
    inputVat,
    netVat,
    paye, uif, sdl, coida,
    vatRate,
    vatRegistered,
    taxableSales: sales,
    salesExcl: Number(salesRow.excl) || 0,
    salesAfterTax: Math.round((sales - outputVat) * 100) / 100,
    salesCount: salesList.length,
    sales: salesList,
    branchId: branchId != null && branchId !== 'all' ? Number(branchId) : null,
    from,
    to
  };
}

function getFinancialReport(type, from, to) {
  syncLedger(from, to);
  const db = getDb();
  const dash = getFinancialDashboard(from, to);

  if (type === 'profit_loss' || type === 'income_statement') {
    const byCategory = db.prepare(`
      SELECT category, direction, COALESCE(SUM(amount),0) as total FROM ledger_entries
      WHERE txn_date BETWEEN ? AND ? GROUP BY category, direction ORDER BY total DESC`).all(from, to);
    return { type, from, to, summary: dash, lines: byCategory };
  }
  if (type === 'balance_sheet') {
    return {
      type, from, to,
      assets: { cash: dash.cashBalance, bank: dash.bankBalance, inventory: dash.inventoryValue, receivable: dash.accountsReceivable },
      liabilities: { payable: dash.accountsPayable, payrollPending: dash.payrollPending, ownerOutstanding: dash.ownerOutstanding },
      equity: dash.netProfit
    };
  }
  if (type === 'cash_flow') {
    const cash = getCashBook(from, to);
    const bank = getBankBook(from, to);
    return { type, from, to, cash, bank };
  }
  if (type === 'trial_balance') {
    return db.prepare(`
      SELECT category, direction, COALESCE(SUM(amount),0) as total, COUNT(*) as count
      FROM ledger_entries WHERE txn_date BETWEEN ? AND ? GROUP BY category, direction ORDER BY category`).all(from, to);
  }
  if (type === 'general_ledger') {
    return searchLedger({ from, to });
  }
  if (type === 'expense_report') {
    return db.prepare(`
      SELECT category, COALESCE(SUM(amount),0) as total, COUNT(*) as count FROM ledger_entries
      WHERE direction='out' AND txn_date BETWEEN ? AND ? GROUP BY category ORDER BY total DESC`).all(from, to);
  }
  if (type === 'income_report') {
    return db.prepare(`
      SELECT category, COALESCE(SUM(amount),0) as total, COUNT(*) as count FROM ledger_entries
      WHERE direction='in' AND txn_date BETWEEN ? AND ? GROUP BY category ORDER BY total DESC`).all(from, to);
  }
  if (type === 'payroll_report') return getPayrollAccounting(from, to);
  if (type === 'tax_report') return getTaxSummary(from, to);
  if (type === 'supplier_report') {
    return db.prepare(`
      SELECT s.name, s.balance_owed, COALESCE(SUM(sp.amount),0) as paid
      FROM suppliers s LEFT JOIN supplier_payments sp ON sp.supplier_id=s.id AND date(sp.created_at) BETWEEN date(?) AND date(?)
      GROUP BY s.id ORDER BY s.balance_owed DESC`).all(from, to);
  }
  if (type === 'customer_report') {
    return db.prepare(`SELECT name, phone, balance FROM customers WHERE balance > 0 ORDER BY balance DESC`).all();
  }
  return { type, from, to, data: [] };
}

function getBusinessPerformance(from, to) {
  syncLedger(from, to);
  const db = getDb();
  const revenueTrend = db.prepare(`
    SELECT date(created_at) as day, COALESCE(SUM(total),0) as revenue FROM sales
    WHERE status='completed' AND date(created_at) BETWEEN date(?) AND date(?)
    GROUP BY date(created_at) ORDER BY day`).all(from, to);
  const expenseTrend = db.prepare(`
    SELECT txn_date as day, COALESCE(SUM(amount),0) as expenses FROM ledger_entries
    WHERE direction='out' AND txn_date BETWEEN ? AND ? GROUP BY txn_date ORDER BY txn_date`).all(from, to);
  const bestProducts = db.prepare(`
    SELECT si.product_name, SUM(si.quantity) as qty, SUM(si.total) as revenue FROM sale_items si
    JOIN sales s ON s.id=si.sale_id WHERE s.status='completed' AND date(s.created_at) BETWEEN date(?) AND date(?)
    GROUP BY si.product_name ORDER BY revenue DESC LIMIT 10`).all(from, to);
  const highestExpenses = db.prepare(`
    SELECT category, COALESCE(SUM(amount),0) as total FROM ledger_entries
    WHERE direction='out' AND txn_date BETWEEN ? AND ? GROUP BY category ORDER BY total DESC LIMIT 10`).all(from, to);
  const employeeCosts = db.prepare(`
    SELECT e.full_name, COALESCE(SUM(p.net_salary),0) as cost FROM employee_payroll p
    JOIN employees e ON e.id=p.employee_id WHERE date(p.period_end) BETWEEN date(?) AND date(?)
    GROUP BY e.id ORDER BY cost DESC`).all(from, to);
  const dash = getFinancialDashboard(from, to);
  return { revenueTrend, expenseTrend, bestProducts, highestExpenses, employeeCosts, ...dash };
}

function getBudgets(month) {
  return getDb().prepare('SELECT * FROM budgets WHERE budget_month=? ORDER BY category').all(month);
}

function saveBudget(data, actor) {
  const db = getDb();
  if (data.id) {
    db.prepare('UPDATE budgets SET budget_month=?, category=?, department=?, amount=?, notes=? WHERE id=?')
      .run(data.budget_month, data.category, data.department || 'general', Number(data.amount), data.notes || null, data.id);
    logFinancialAudit('budget', data.id, 'update', 'amount', null, data.amount, actor);
    return db.prepare('SELECT * FROM budgets WHERE id=?').get(data.id);
  }
  const r = db.prepare('INSERT INTO budgets (budget_month, category, department, amount, notes, created_by) VALUES (?,?,?,?,?,?)')
    .run(data.budget_month, data.category, data.department || 'general', Number(data.amount), data.notes || null, actor?.id);
  logFinancialAudit('budget', r.lastInsertRowid, 'create', null, null, data.amount, actor);
  return db.prepare('SELECT * FROM budgets WHERE id=?').get(r.lastInsertRowid);
}

function deleteBudget(id, actor) {
  getDb().prepare('DELETE FROM budgets WHERE id=?').run(id);
  logFinancialAudit('budget', id, 'delete', null, null, null, actor);
}

function getBudgetVsActual(month) {
  const budgets = getBudgets(month);
  const from = `${month}-01`;
  const to = month + '-31';
  syncLedger(from, to);
  const actuals = getDb().prepare(`
    SELECT category, COALESCE(SUM(amount),0) as actual FROM ledger_entries
    WHERE direction='out' AND txn_date LIKE ? GROUP BY category`).all(`${month}%`);
  const actualMap = Object.fromEntries(actuals.map(a => [a.category, a.actual]));
  return budgets.map(b => {
    const actual = actualMap[b.category] || 0;
    const variance = b.amount - actual;
    return { ...b, actual, variance, overspent: actual > b.amount };
  });
}

function getFinancialDocuments(filters = {}) {
  let sql = 'SELECT * FROM financial_documents WHERE 1=1';
  const params = [];
  if (filters.doc_type) { sql += ' AND doc_type = ?'; params.push(filters.doc_type); }
  if (filters.from) { sql += ' AND doc_date >= ?'; params.push(filters.from); }
  if (filters.to) { sql += ' AND doc_date <= ?'; params.push(filters.to); }
  sql += ' ORDER BY created_at DESC LIMIT 200';
  return getDb().prepare(sql).all(...params);
}

function saveFinancialDocument(data, actor) {
  const r = getDb().prepare(`
    INSERT INTO financial_documents (doc_type, title, file_path, file_name, amount, doc_date, reference_type, reference_id,
      employee_id, customer_id, supplier_id, uploaded_by, uploaded_by_name, notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    data.doc_type, data.title || null, data.file_path || null, data.file_name || null,
    data.amount != null ? Number(data.amount) : null, data.doc_date || null,
    data.reference_type || null, data.reference_id || null,
    data.employee_id || null, data.customer_id || null, data.supplier_id || null,
    actor?.id, actor?.full_name || actor?.username, data.notes || null
  );
  logFinancialAudit('financial_document', r.lastInsertRowid, 'create', null, null, data.title, actor);
  return getDb().prepare('SELECT * FROM financial_documents WHERE id=?').get(r.lastInsertRowid);
}

function deleteFinancialDocument(id, actor) {
  getDb().prepare('DELETE FROM financial_documents WHERE id=?').run(id);
  logFinancialAudit('financial_document', id, 'delete', null, null, null, actor);
}

function getFinancialAuditTrail(filters = {}) {
  let sql = 'SELECT * FROM financial_audit_trail WHERE 1=1';
  const params = [];
  if (filters.from) { sql += ' AND date(created_at) >= date(?)'; params.push(filters.from); }
  if (filters.to) { sql += ' AND date(created_at) <= date(?)'; params.push(filters.to); }
  if (filters.entity_type) { sql += ' AND entity_type = ?'; params.push(filters.entity_type); }
  sql += ' ORDER BY created_at DESC LIMIT 300';
  return getDb().prepare(sql).all(...params);
}

function getFinancialNotifications() {
  const notes = [];
  const db = getDb();
  const settings = getBookkeepingSettings();
  const month = new Date().toISOString().slice(0, 7);
  const dash = getFinancialDashboard(month + '-01', Utils_today());

  if (dash.cashBalance < (settings.low_cash_threshold || 500)) {
    notes.push({ type: 'low_cash', title: 'Low Cash Balance', message: `Cash balance ${dash.cashBalance.toFixed(2)} is below threshold` });
  }
  if (dash.accountsReceivable > 0) {
    notes.push({ type: 'ar', title: 'Accounts Receivable', message: `Customers owe ${dash.accountsReceivable.toFixed(2)}` });
  }
  if (dash.accountsPayable > 0) {
    notes.push({ type: 'ap', title: 'Supplier Payments Due', message: `Suppliers owed ${dash.accountsPayable.toFixed(2)}` });
  }
  if (dash.payrollPending > 0) {
    notes.push({ type: 'salary', title: 'Salary Due', message: `Pending payroll: ${dash.payrollPending.toFixed(2)}` });
  }
  if (dash.ownerOutstanding > 0) {
    notes.push({ type: 'owner_salary', title: 'Owner Salary Outstanding', message: `${dash.ownerOutstanding.toFixed(2)} outstanding` });
  }

  const payrollSettings = require('./payroll-compliance').getPayrollSettings();
  const schemeEnabled = {
    uif: payrollSettings.uif_enabled !== false,
    paye: payrollSettings.paye_enabled !== false,
    sdl: payrollSettings.sdl_enabled !== false,
    coida: !!payrollSettings.coida_enabled
  };
  for (const t of ['uif', 'paye', 'sdl', 'coida']) {
    if (!schemeEnabled[t]) continue;
    const row = db.prepare(`SELECT id FROM payroll_compliance_submissions WHERE submission_type=? AND period_month=? AND status='submitted'`).get(t, month);
    if (!row) notes.push({ type: t, title: `${t.toUpperCase()} Due`, message: `Submit ${t.toUpperCase()} for ${month}` });
  }

  const overspent = getBudgetVsActual(month).filter(b => b.overspent);
  overspent.forEach(b => notes.push({ type: 'budget', title: 'Budget Overspent', message: `${b.category}: budget ${b.amount}, actual ${b.actual.toFixed(2)}` }));

  const overdueCustomers = db.prepare(`SELECT name, balance FROM customers WHERE balance > 0 ORDER BY balance DESC LIMIT 5`).all();
  overdueCustomers.forEach(c => notes.push({ type: 'customer_overdue', title: 'Customer Overdue', message: `${c.name} owes ${c.balance.toFixed(2)}` }));

  return notes;
}

function Utils_today() {
  return new Date().toLocaleDateString('en-CA');
}

function buildFinancialReportPdf(type, from, to, shopName, currency) {
  const exportSvc = require('./export');
  const report = getFinancialReport(type, from, to);
  let headers, rows;
  if (type === 'profit_loss' || type === 'income_statement') {
    headers = ['Category', 'Direction', 'Amount'];
    rows = (report.lines || []).map(l => [l.category, l.direction, `${currency}${Number(l.total).toFixed(2)}`]);
  } else if (type === 'trial_balance' || type === 'expense_report' || type === 'income_report') {
    headers = ['Category', 'Direction', 'Total', 'Count'];
    rows = (report || []).map(l => [l.category, l.direction || '—', `${currency}${Number(l.total).toFixed(2)}`, l.count || '']);
  } else if (type === 'general_ledger') {
    headers = ['Date', 'Txn#', 'Type', 'Category', 'Amount', 'Direction'];
    rows = (report || []).slice(0, 100).map(l => [l.txn_date, l.txn_number, l.txn_type, l.category, `${currency}${Number(l.amount).toFixed(2)}`, l.direction]);
  } else {
    headers = ['Metric', 'Value'];
    rows = [['Net Profit', `${currency}${Number(report.summary?.netProfit || 0).toFixed(2)}`]];
  }
  return exportSvc.buildPdfBuffer(`${type.replace(/_/g, ' ').toUpperCase()} (${from} – ${to})`, headers, rows, { shop_name: shopName, dateRange: `${from} – ${to}` });
}

module.exports = {
  EXPENSE_CATEGORIES, INCOME_TYPES,
  getBookkeepingSettings, saveBookkeepingSettings,
  syncLedger, syncPayrollEntry, getFinancialDashboard, searchLedger,
  getIncomeEntries, saveIncomeEntry, deleteIncomeEntry,
  getBankTransactions, saveBankTransaction,
  getCashBook, getBankBook, getPayrollAccounting, getTaxSummary,
  getFinancialReport, getBusinessPerformance,
  getBudgets, saveBudget, deleteBudget, getBudgetVsActual,
  getFinancialDocuments, saveFinancialDocument, deleteFinancialDocument,
  getFinancialAuditTrail, getFinancialNotifications,
  buildFinancialReportPdf
};

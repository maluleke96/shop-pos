/**
 * Taken / Unpaid (“Pay Later”) orders — food taken now, paid when customer returns.
 * Integrates with existing sales, stock (via completeSale), cash-up, and accounting.
 */
const { getDb } = require('../database/db');

function now() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function money(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function text(v) {
  const s = String(v == null ? '' : v).trim();
  return s || null;
}

function ensureSchema() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS taken_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL,
      receipt_number TEXT,
      customer_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      contact_extra TEXT,
      order_summary TEXT,
      amount_owed REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'UNPAID',
      taken_at TEXT NOT NULL,
      paid_at TEXT,
      payment_method TEXT,
      staff_user_id INTEGER,
      staff_name TEXT,
      branch_id INTEGER,
      notes TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_taken_orders_status ON taken_orders(status);
    CREATE INDEX IF NOT EXISTS idx_taken_orders_sale ON taken_orders(sale_id);
    CREATE INDEX IF NOT EXISTS idx_taken_orders_taken_at ON taken_orders(taken_at);
  `);
}

function assertStaff(actor) {
  if (!actor?.id) throw new Error('Sign in required');
  return actor;
}

function orderSummaryFromSale(saleId) {
  const rows = getDb().prepare(
    `SELECT quantity, product_name FROM sale_items WHERE sale_id=? ORDER BY id`
  ).all(saleId);
  if (!rows.length) return '';
  return rows.map((r) => `${r.quantity}× ${r.product_name || 'Item'}`).join(', ');
}

/** Called inside/after completeSale when payment_type includes taken. */
function recordTakenSale(saleId, saleData, actor) {
  ensureSchema();
  const meta = saleData?.taken_order || {};
  const customer_name = text(meta.customer_name || saleData?.customer_name);
  const phone = text(meta.phone || saleData?.customer_phone);
  if (!customer_name) throw new Error('Customer name is required for Taken – Pay Later');
  if (!phone) throw new Error('Mobile / WhatsApp number is required for Taken – Pay Later');

  const db = getDb();
  const sale = db.prepare('SELECT * FROM sales WHERE id=?').get(saleId);
  if (!sale) throw new Error('Sale not found');

  const amount = money(
    (saleData.payments || [])
      .filter((p) => (p.type || p.payment_type) === 'taken')
      .reduce((s, p) => s + (Number(p.amount) || 0), 0)
  ) || money(sale.total);

  const existing = db.prepare(`SELECT id FROM taken_orders WHERE sale_id=?`).get(saleId);
  if (existing) return getById(existing.id);

  const takenAt = text(meta.taken_at) || sale.created_at || now();
  const summary = text(meta.order_summary) || orderSummaryFromSale(saleId);
  const r = db.prepare(`
    INSERT INTO taken_orders (
      sale_id, receipt_number, customer_name, phone, contact_extra, order_summary,
      amount_owed, status, taken_at, staff_user_id, staff_name, branch_id, notes, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,'UNPAID',?,?,?,?,?,?,?)
  `).run(
    saleId,
    sale.receipt_number || null,
    customer_name,
    phone,
    text(meta.contact_extra),
    summary,
    amount,
    takenAt,
    actor?.id || sale.user_id || null,
    actor?.full_name || actor?.username || null,
    sale.branch_id || null,
    text(meta.notes),
    now(),
    now()
  );
  const row = getById(r.lastInsertRowid);
  try {
    const store = require('./store');
    const cashier = actor?.full_name || actor?.username || 'Cashier';
    store.addNotification(
      'taken_unpaid',
      'Unpaid / Taken order',
      `${cashier} recorded Taken – Pay Later for ${customer_name}: R${amount.toFixed(2)} · ${phone}`,
      {
        entity_type: 'taken_order',
        entity_id: row.id,
        action_page: 'admin:taken-orders',
        audience_roles: ['owner', 'manager', 'assistant_manager', 'supervisor']
      }
    );
  } catch (err) {
    console.warn('[taken] notify:', err.message);
  }
  return row;
}

function getById(id) {
  ensureSchema();
  return getDb().prepare('SELECT * FROM taken_orders WHERE id=?').get(id) || null;
}

function listTakenOrders(filters = {}, actor) {
  assertStaff(actor);
  ensureSchema();
  const status = text(filters.status)?.toUpperCase();
  let sql = `SELECT * FROM taken_orders WHERE 1=1`;
  const params = [];
  if (status && status !== 'ALL') {
    sql += ` AND UPPER(status)=?`;
    params.push(status);
  } else if (!filters.include_paid) {
    sql += ` AND UPPER(status)='UNPAID'`;
  }
  if (filters.branch_id) {
    sql += ` AND branch_id=?`;
    params.push(Number(filters.branch_id));
  }
  sql += ` ORDER BY datetime(taken_at) DESC, id DESC LIMIT ?`;
  params.push(Math.min(Number(filters.limit) || 200, 500));
  return getDb().prepare(sql).all(...params);
}

function getAdminSummary(actor) {
  assertStaff(actor);
  ensureSchema();
  const db = getDb();
  const unpaid = db.prepare(
    `SELECT COALESCE(SUM(amount_owed),0) AS total, COUNT(*) AS count FROM taken_orders WHERE UPPER(status)='UNPAID'`
  ).get();
  const paid = db.prepare(
    `SELECT COALESCE(SUM(amount_owed),0) AS total, COUNT(*) AS count FROM taken_orders WHERE UPPER(status)='PAID'`
  ).get();
  return {
    outstanding_total: money(unpaid?.total),
    outstanding_count: Number(unpaid?.count) || 0,
    paid_total: money(paid?.total),
    paid_count: Number(paid?.count) || 0,
    orders: listTakenOrders({ status: 'ALL', include_paid: true, limit: 300 }, actor)
  };
}

/**
 * Customer returns and pays. Converts the taken tender on the sale to cash/card/eft
 * and marks the taken order PAID — so cash-up and accounting see real money.
 */
function payTakenOrder(id, data = {}, actor) {
  assertStaff(actor);
  ensureSchema();
  const method = String(data.payment_method || data.method || 'cash').toLowerCase();
  const allowed = new Set(['cash', 'card', 'eft', 'mobile', 'giftcard', 'account', 'snapscan', 'zapper', 'other']);
  // Allow any POS custom method id (letters/numbers/underscore)
  if (!allowed.has(method) && !/^[a-z0-9_]{2,40}$/i.test(method)) {
    throw new Error('Choose a valid payment method');
  }
  if (method === 'taken') throw new Error('Choose a real payment method');
  const db = getDb();
  const row = db.prepare('SELECT * FROM taken_orders WHERE id=?').get(id);
  if (!row) throw new Error('Taken order not found');
  if (String(row.status).toUpperCase() !== 'UNPAID') {
    throw new Error('This order is already paid or closed');
  }

  const paidAt = now();
  db.transaction(() => {
    const takenPay = db.prepare(
      `SELECT id FROM sale_payments WHERE sale_id=? AND LOWER(payment_type)='taken' LIMIT 1`
    ).get(row.sale_id);
    if (takenPay) {
      db.prepare(`UPDATE sale_payments SET payment_type=? WHERE id=?`).run(method, takenPay.id);
    } else {
      db.prepare(`INSERT INTO sale_payments (sale_id, payment_type, amount) VALUES (?,?,?)`)
        .run(row.sale_id, method, money(row.amount_owed));
    }
    db.prepare(`
      UPDATE taken_orders SET status='PAID', paid_at=?, payment_method=?, updated_at=?,
        staff_name=COALESCE(staff_name, ?)
      WHERE id=?
    `).run(paidAt, method, paidAt, actor.full_name || actor.username || null, id);

    // Keep sale.amount_paid consistent (already full for soft tender)
    db.prepare(`UPDATE sales SET amount_paid=total, change_amount=0 WHERE id=?`).run(row.sale_id);
  })();

  try {
    const acc = require('./accounting-platform');
    if (typeof acc.postTakenOrderPayment === 'function') {
      acc.postTakenOrderPayment(row.sale_id, method, money(row.amount_owed), actor);
    } else if (typeof acc.postFromSale === 'function') {
      // Fallback: no-op if helper missing — sale was already posted to AR via taken tender
    }
  } catch (err) {
    console.warn('[taken] accounting pay:', err.message);
  }

  try {
    const { audit } = require('./store');
    if (typeof audit === 'function') {
      audit(actor.id, actor.username, 'taken_order_paid', 'taken_order', id, {
        sale_id: row.sale_id, method, amount: row.amount_owed
      });
    }
  } catch (_) { /* ignore */ }

  return getById(id);
}

/** Keep admin bell aware of outstanding Taken – Pay Later balances. */
function ensureUnpaidNotifications() {
  ensureSchema();
  const db = getDb();
  try {
    db.prepare(`DELETE FROM notifications WHERE type='taken_unpaid' AND title='Unpaid Taken orders outstanding'`).run();
  } catch (_) { /* ignore */ }
  const unpaid = db.prepare(
    `SELECT COUNT(*) AS c, COALESCE(SUM(amount_owed),0) AS t FROM taken_orders WHERE UPPER(status)='UNPAID'`
  ).get();
  const count = Number(unpaid?.c) || 0;
  if (!count) return;
  try {
    const store = require('./store');
    const total = Number(unpaid?.t) || 0;
    store.addNotification(
      'taken_unpaid',
      'Unpaid Taken orders outstanding',
      `${count} Taken – Pay Later order(s) still unpaid (R${total.toFixed(2)}). Open Admin → Taken / Unpaid Orders.`,
      {
        entity_type: 'taken_orders',
        entity_id: 0,
        action_page: 'admin:taken-orders',
        audience_roles: ['owner', 'manager', 'assistant_manager', 'supervisor']
      }
    );
  } catch (err) {
    console.warn('[taken] unpaid notify:', err.message);
  }
}

module.exports = {
  ensureSchema,
  recordTakenSale,
  listTakenOrders,
  getAdminSummary,
  getById,
  payTakenOrder,
  ensureUnpaidNotifications
};

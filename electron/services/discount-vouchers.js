/**
 * Discount vouchers — custom codes for POS, Order Online, and Kiosk.
 */
const { getDb } = require('../database/db');

function ensureVoucherSchema() {
  const db = getDb();
  db.prepare(`CREATE TABLE IF NOT EXISTS discount_vouchers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    discount_type TEXT NOT NULL DEFAULT 'percent',
    discount_value REAL NOT NULL DEFAULT 0,
    product_id INTEGER,
    customer_id INTEGER,
    customer_name TEXT,
    max_uses INTEGER DEFAULT 1,
    uses_count INTEGER DEFAULT 0,
    expires_at TEXT,
    status TEXT DEFAULT 'active',
    notes TEXT,
    created_by INTEGER,
    created_by_name TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    last_used_at TEXT,
    last_used_channel TEXT
  )`).run();
  try { db.prepare('CREATE INDEX IF NOT EXISTS idx_discount_vouchers_code ON discount_vouchers(code)').run(); } catch (_) { /* */ }
}

function normalizeCode(code) {
  return String(code || '').trim().toUpperCase().replace(/\s+/g, '');
}

function listVouchers(filters = {}) {
  ensureVoucherSchema();
  let sql = `SELECT v.*, p.name AS product_name, c.name AS linked_customer_name
    FROM discount_vouchers v
    LEFT JOIN products p ON p.id = v.product_id
    LEFT JOIN customers c ON c.id = v.customer_id
    WHERE 1=1`;
  const params = [];
  if (filters.status) { sql += ' AND v.status = ?'; params.push(filters.status); }
  if (filters.search) {
    sql += ' AND (v.code LIKE ? OR v.customer_name LIKE ? OR c.name LIKE ? OR p.name LIKE ?)';
    const q = `%${filters.search}%`;
    params.push(q, q, q, q);
  }
  sql += ' ORDER BY v.created_at DESC LIMIT ?';
  params.push(Math.min(Number(filters.limit) || 200, 1000));
  return getDb().prepare(sql).all(...params);
}

function createVoucher(data, actor) {
  ensureVoucherSchema();
  const code = normalizeCode(data.code);
  if (!code || code.length < 3) throw new Error('Voucher code must be at least 3 characters');
  if (!/^[A-Z0-9._\-]+$/.test(code)) throw new Error('Voucher code: letters, numbers, . _ - only');
  const discountType = data.discount_type === 'amount' ? 'amount' : 'percent';
  const discountValue = Math.round((Number(data.discount_value) || 0) * 100) / 100;
  if (!(discountValue > 0)) throw new Error('Discount value must be greater than zero');
  if (discountType === 'percent' && discountValue > 100) throw new Error('Percent cannot exceed 100');
  const db = getDb();
  if (db.prepare('SELECT id FROM discount_vouchers WHERE code = ?').get(code)) {
    throw new Error(`Voucher code ${code} already exists`);
  }
  // Also block colliding gift-card codes
  try {
    if (db.prepare('SELECT id FROM gift_cards WHERE upper(code) = ?').get(code)) {
      throw new Error(`Code ${code} is already used by a gift card`);
    }
  } catch (err) {
    if (/already used/i.test(err.message)) throw err;
  }
  const maxUses = Math.max(1, parseInt(data.max_uses, 10) || 1);
  const r = db.prepare(`INSERT INTO discount_vouchers
    (code, discount_type, discount_value, product_id, customer_id, customer_name, max_uses, expires_at, status, notes, created_by, created_by_name)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    code,
    discountType,
    discountValue,
    data.product_id || null,
    data.customer_id || null,
    data.customer_name || null,
    maxUses,
    data.expires_at || null,
    'active',
    data.notes || null,
    actor?.id || null,
    actor?.full_name || actor?.username || null
  );
  try {
    db.prepare('INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, details) VALUES (?,?,?,?,?,?)')
      .run(actor?.id || null, actor?.full_name || actor?.username || null, 'create_discount_voucher', 'discount_voucher', r.lastInsertRowid,
        JSON.stringify({ code, discount_type: discountType, discount_value: discountValue, product_id: data.product_id || null, customer_id: data.customer_id || null }));
  } catch (_) { /* audit optional */ }
  return db.prepare('SELECT * FROM discount_vouchers WHERE id = ?').get(r.lastInsertRowid);
}

function computeDiscount(voucher, subtotal) {
  const sub = Math.max(0, Number(subtotal) || 0);
  if (!(sub > 0)) return 0;
  let disc = 0;
  if (voucher.discount_type === 'amount') disc = Number(voucher.discount_value) || 0;
  else disc = Math.round(sub * (Number(voucher.discount_value) || 0) / 100 * 100) / 100;
  return Math.min(disc, sub);
}

function validateVoucher(code, opts = {}) {
  ensureVoucherSchema();
  const normalized = normalizeCode(code);
  if (!normalized) return { error: 'Voucher code required', discount: 0 };
  const row = getDb().prepare(`SELECT v.*, p.name AS product_name
    FROM discount_vouchers v
    LEFT JOIN products p ON p.id = v.product_id
    WHERE upper(v.code) = ?`).get(normalized);
  if (!row) return { error: 'Invalid voucher code', discount: 0 };
  if (row.status !== 'active') return { error: 'Voucher is not active', discount: 0 };
  if (row.expires_at && String(row.expires_at).slice(0, 10) < new Date().toLocaleDateString('en-CA')) {
    return { error: 'Voucher has expired', discount: 0 };
  }
  if ((Number(row.uses_count) || 0) >= (Number(row.max_uses) || 1)) {
    return { error: 'Voucher has already been used', discount: 0 };
  }
  if (row.customer_id && opts.customerId && Number(row.customer_id) !== Number(opts.customerId)) {
    return { error: 'This voucher is for a different customer', discount: 0 };
  }
  if (row.customer_id && !opts.customerId && opts.requireCustomer !== false) {
    // Allow validation without customer for preview; redeem can still check
  }
  let subtotal = Number(opts.subtotal) || 0;
  if (row.product_id && Array.isArray(opts.items) && opts.items.length) {
    const lineTotal = opts.items
      .filter((i) => Number(i.product_id) === Number(row.product_id))
      .reduce((s, i) => s + (Number(i.total) || Number(i.line_total) || (Number(i.price) || Number(i.unit_price) || 0) * (Number(i.quantity) || 1)), 0);
    if (!(lineTotal > 0)) return { error: `Voucher only applies to ${row.product_name || 'the linked product'}`, discount: 0 };
    subtotal = lineTotal;
  }
  const discount = computeDiscount(row, subtotal);
  return {
    ok: true,
    type: 'discount_voucher',
    code: row.code,
    discount,
    discount_type: row.discount_type,
    discount_value: row.discount_value,
    product_id: row.product_id || null,
    customer_id: row.customer_id || null,
    voucher_id: row.id,
    message: row.discount_type === 'percent'
      ? `${row.discount_value}% off${row.product_name ? ` on ${row.product_name}` : ''}`
      : `R${Number(row.discount_value).toFixed(2)} off`
  };
}

function redeemVoucher(code, opts = {}) {
  const v = validateVoucher(code, opts);
  if (!v.ok) return v;
  const db = getDb();
  const row = db.prepare('SELECT * FROM discount_vouchers WHERE id = ?').get(v.voucher_id);
  if (!row) return { error: 'Voucher not found', discount: 0 };
  const uses = (Number(row.uses_count) || 0) + 1;
  const max = Number(row.max_uses) || 1;
  const status = uses >= max ? 'used' : 'active';
  db.prepare(`UPDATE discount_vouchers SET uses_count = ?, status = ?, last_used_at = datetime('now'), last_used_channel = ? WHERE id = ?`)
    .run(uses, status, opts.channel || null, row.id);
  try {
    db.prepare('INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, details) VALUES (?,?,?,?,?,?)')
      .run(opts.actorId || null, opts.actorName || null, 'redeem_discount_voucher', 'discount_voucher', row.id,
        JSON.stringify({ code: row.code, discount: v.discount, channel: opts.channel || null }));
  } catch (_) { /* */ }
  return { ...v, uses_count: uses, status };
}

module.exports = {
  ensureVoucherSchema,
  listVouchers,
  createVoucher,
  validateVoucher,
  redeemVoucher,
  normalizeCode,
  computeDiscount
};

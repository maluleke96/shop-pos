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
  for (const col of ['min_order_total REAL', 'max_discount REAL', 'branch_id INTEGER', 'campaign_id INTEGER']) {
    try { db.prepare(`ALTER TABLE discount_vouchers ADD COLUMN ${col}`).run(); } catch (_) { /* exists */ }
  }
  try {
    db.prepare(`CREATE TABLE IF NOT EXISTS discount_voucher_redemptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      voucher_id INTEGER,
      code TEXT NOT NULL,
      campaign_id INTEGER,
      customer_id INTEGER,
      sale_id INTEGER,
      online_order_id INTEGER,
      channel TEXT,
      discount REAL DEFAULT 0,
      created_at TEXT
    )`).run();
  } catch (_) { /* exists */ }
  try { db.prepare('CREATE INDEX IF NOT EXISTS idx_dv_redemptions_code ON discount_voucher_redemptions(code)').run(); } catch (_) { /* */ }
}

const DISCOUNT_TYPES = ['percent', 'amount', 'free_delivery'];

function nowSql() {
  return new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
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
  const discountType = DISCOUNT_TYPES.includes(data.discount_type) ? data.discount_type : 'percent';
  const discountValue = discountType === 'free_delivery' ? 0 : Math.round((Number(data.discount_value) || 0) * 100) / 100;
  if (discountType !== 'free_delivery' && !(discountValue > 0)) throw new Error('Discount value must be greater than zero');
  if (discountType === 'percent' && discountValue > 100) throw new Error('Percent cannot exceed 100');
  const minOrder = Number(data.min_order_total) > 0 ? Math.round(Number(data.min_order_total) * 100) / 100 : null;
  const maxDiscount = Number(data.max_discount) > 0 ? Math.round(Number(data.max_discount) * 100) / 100 : null;
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
  const newId = Number(r.lastInsertRowid) || db.prepare('SELECT id FROM discount_vouchers WHERE code = ?').get(code)?.id;
  if (minOrder != null || maxDiscount != null || data.branch_id || data.campaign_id) {
    db.prepare('UPDATE discount_vouchers SET min_order_total = ?, max_discount = ?, branch_id = ?, campaign_id = ? WHERE id = ?')
      .run(minOrder, maxDiscount, data.branch_id || null, data.campaign_id || null, newId);
  }
  try {
    db.prepare('INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, details) VALUES (?,?,?,?,?,?)')
      .run(actor?.id || null, actor?.full_name || actor?.username || null, 'create_discount_voucher', 'discount_voucher', newId,
        JSON.stringify({ code, discount_type: discountType, discount_value: discountValue, product_id: data.product_id || null, customer_id: data.customer_id || null }));
  } catch (_) { /* audit optional */ }
  return db.prepare('SELECT * FROM discount_vouchers WHERE id = ?').get(newId);
}

function computeDiscount(voucher, subtotal) {
  const sub = Math.max(0, Number(subtotal) || 0);
  if (!(sub > 0)) return 0;
  if (voucher.discount_type === 'free_delivery') return 0;
  let disc = 0;
  if (voucher.discount_type === 'amount') disc = Number(voucher.discount_value) || 0;
  else disc = Math.round(sub * (Number(voucher.discount_value) || 0) / 100 * 100) / 100;
  const cap = Number(voucher.max_discount) || 0;
  if (cap > 0) disc = Math.min(disc, cap);
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
  if (row.branch_id && opts.branchId && Number(row.branch_id) !== Number(opts.branchId)) {
    return { error: 'This voucher is not valid at this branch', discount: 0 };
  }
  if (row.discount_type === 'free_delivery' && !opts.forDelivery) {
    return { error: 'Free-delivery vouchers apply to online delivery orders only', discount: 0 };
  }
  const minOrder = Number(row.min_order_total) || 0;
  if (minOrder > 0 && (Number(opts.subtotal) || 0) < minOrder) {
    return { error: `Minimum order for this voucher is ${minOrder.toFixed(2)}`, discount: 0 };
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
    campaign_id: row.campaign_id || null,
    message: row.discount_type === 'free_delivery'
      ? 'Free delivery'
      : row.discount_type === 'percent'
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
    db.prepare(`INSERT INTO discount_voucher_redemptions
      (voucher_id, code, campaign_id, customer_id, sale_id, online_order_id, channel, discount, created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(row.id, row.code, row.campaign_id || null, opts.customerId || null,
      opts.saleId || null, opts.orderId || null, opts.channel || null, v.discount || 0, nowSql());
  } catch (_) { /* redemption log optional */ }
  try {
    db.prepare('INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, details) VALUES (?,?,?,?,?,?)')
      .run(opts.actorId || null, opts.actorName || null, 'redeem_discount_voucher', 'discount_voucher', row.id,
        JSON.stringify({ code: row.code, discount: v.discount, channel: opts.channel || null }));
  } catch (_) { /* */ }
  return { ...v, uses_count: uses, status };
}

/** POS redeems when the discount is applied; the sale id is only known once the sale completes. */
function linkRedemptionToSale(code, saleId) {
  const normalized = normalizeCode(code);
  if (!normalized || !saleId) return false;
  ensureVoucherSchema();
  const db = getDb();
  const row = db.prepare(`SELECT id FROM discount_voucher_redemptions
    WHERE upper(code) = ? AND sale_id IS NULL AND online_order_id IS NULL ORDER BY id DESC LIMIT 1`).get(normalized);
  if (!row) return false;
  db.prepare('UPDATE discount_voucher_redemptions SET sale_id = ? WHERE id = ?').run(saleId, row.id);
  return true;
}

module.exports = {
  ensureVoucherSchema,
  linkRedemptionToSale,
  listVouchers,
  createVoucher,
  validateVoucher,
  redeemVoucher,
  normalizeCode,
  computeDiscount
};

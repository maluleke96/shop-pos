const { getDb } = require('../database/db');
const fs = require('fs');
const { buildPdfBuffer } = require('./export');

function audit(userId, username, action, entityType, entityId, details) {
  try {
    getDb().prepare(`
      INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, details)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(userId, username, action, entityType, entityId, details ? JSON.stringify(details) : null);
  } catch (_) {}
}

function log(level, source, message, details) {
  try {
    getDb().prepare(`INSERT INTO system_logs (level, source, message, details) VALUES (?, ?, ?, ?)`)
      .run(level, source, message, details ? JSON.stringify(details) : null);
  } catch (_) {}
}

function coerceCounterValue(raw) {
  if (raw == null || raw === '') return 0;
  if (typeof raw === 'bigint') {
    if (raw < 0n) return 0;
    if (raw > BigInt(Number.MAX_SAFE_INTEGER)) return 0;
    return Number(raw);
  }
  const s = String(raw).trim();
  if (/^\d+$/.test(s) && s.length > 15) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  if (n > Number.MAX_SAFE_INTEGER) return 0;
  return Math.floor(n);
}

function nextNumber(table, prefix) {
  const db = getDb();
  const row = db.prepare(`SELECT last_number FROM ${table} WHERE id = 1`).get();
  const next = coerceCounterValue(row?.last_number) + 1;
  db.prepare(`UPDATE ${table} SET last_number = ? WHERE id = 1`).run(next);
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `${prefix}-${date}-${String(next).padStart(5, '0')}`;
}

function parseJson(val, fallback = {}) {
  if (!val) return fallback;
  try { return JSON.parse(val); } catch { return fallback; }
}

function getBranchId() {
  const row = getDb().prepare('SELECT branch_id FROM shop_settings WHERE id = 1').get();
  return row?.branch_id || 1;
}

function getQuotePrefix() {
  const row = getDb().prepare('SELECT quote_prefix FROM shop_settings WHERE id = 1').get();
  return (row?.quote_prefix || 'QT').trim() || 'QT';
}

// ─── Database Manager ─────────────────────────────────────────────────────────

function getDatabaseHealth() {
  const db = getDb();
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
  const counts = {};
  for (const t of tables) {
    try { counts[t.name] = db.prepare(`SELECT COUNT(*) as c FROM "${t.name}"`).get().c; } catch { counts[t.name] = -1; }
  }
  let integrity = 'ok';
  try { db.prepare('PRAGMA integrity_check').get(); } catch { integrity = 'error'; }
  const dbPath = require('../database/db').getDbPathForBackup();
  let sizeMb = 0;
  try { sizeMb = Math.round(fs.statSync(dbPath).size / 1024 / 1024 * 100) / 100; } catch {}
  return { tables: tables.length, counts, integrity, sizeMb, path: dbPath };
}

function optimizeDatabase() {
  getDb().exec('VACUUM');
  getDb().exec('ANALYZE');
  log('info', 'db', 'Database optimized');
  return { success: true };
}

function repairDatabase() {
  getDb().exec('REINDEX');
  log('info', 'db', 'Database reindexed');
  return { success: true };
}

function resetDemoData(actorId, actorName) {
  const db = getDb();
  const txn = db.transaction(() => {
    ['sale_payments','sale_items','sales','return_items','returns','expenses','held_orders',
     'quote_items','quotes','layby_payments','layby_items','laybyes','gift_card_transactions',
     'gift_cards','loyalty_transactions','customer_credit_ledger','stock_count_lines','stock_counts',
     'waste_records','kitchen_order_items','kitchen_orders','po_receipt_items','po_receipts'].forEach(t => {
      try { db.prepare(`DELETE FROM ${t}`).run(); } catch (_) {}
    });
    db.prepare('UPDATE products SET stock_quantity = 0').run();
    db.prepare('UPDATE receipt_counter SET last_number = 0 WHERE id = 1').run();
    db.prepare('UPDATE quote_counter SET last_number = 0 WHERE id = 1').run();
    db.prepare('UPDATE layby_counter SET last_number = 0 WHERE id = 1').run();
  });
  txn();
  log('warn', 'db', 'Demo data reset', { actorId, actorName });
  return { success: true };
}

function archiveOldRecords(daysOld = 365) {
  const db = getDb();
  const cutoff = new Date(Date.now() - daysOld * 86400000).toISOString();
  const oldSales = db.prepare('SELECT * FROM sales WHERE created_at < ?').all(cutoff);
  let archived = 0;
  for (const s of oldSales) {
    db.prepare('INSERT INTO archived_records (entity_type, entity_id, archived_data) VALUES (?, ?, ?)')
      .run('sale', s.id, JSON.stringify(s));
    archived++;
  }
  return { archived };
}

function getSystemLogs(limit = 100) {
  return getDb().prepare('SELECT * FROM system_logs ORDER BY created_at DESC LIMIT ?').all(limit);
}

function recalculateStock() {
  const db = getDb();
  const products = db.prepare('SELECT id FROM products').all();
  let fixed = 0;
  for (const p of products) {
    const mov = db.prepare(`SELECT COALESCE(SUM(CASE WHEN movement_type IN ('sale','remove','waste') THEN -quantity WHEN movement_type IN ('purchase','add','return') THEN quantity ELSE 0 END), 0) as net FROM stock_movements WHERE product_id = ?`).get(p.id);
    const current = db.prepare('SELECT stock_quantity FROM products WHERE id = ?').get(p.id);
    const expected = mov?.net || 0;
    if (Math.abs((current?.stock_quantity || 0) - expected) > 0.001) {
      db.prepare(`UPDATE products SET stock_quantity = ? WHERE id = ?`).run(expected, p.id);
      fixed++;
    }
  }
  return { fixed };
}

// ─── Quotes ─────────────────────────────────────────────────────────────────

function getQuoteExpirySettings() {
  const row = getDb().prepare('SELECT quote_expiry_hours, quote_expiry_unit FROM shop_settings WHERE id = 1').get() || {};
  const unit = row.quote_expiry_unit === 'days' ? 'days' : 'hours';
  const raw = Number(row.quote_expiry_hours);
  const amount = Number.isFinite(raw) && raw > 0 ? raw : (unit === 'days' ? 7 : 168);
  return { amount, unit };
}

function computeQuoteExpiresAt(fromDate = new Date()) {
  const { amount, unit } = getQuoteExpirySettings();
  const ms = unit === 'days' ? amount * 86400000 : amount * 3600000;
  return new Date(fromDate.getTime() + ms).toISOString();
}

function expireDueQuotes() {
  const now = new Date().toISOString();
  getDb().prepare(`
    UPDATE quotes SET status = 'expired'
    WHERE status = 'open' AND expires_at IS NOT NULL AND expires_at <= ?
  `).run(now);
}

function purgeOrphanedQuotes() {
  const db = getDb();
  db.prepare(`
    DELETE FROM quote_items WHERE quote_id NOT IN (SELECT id FROM quotes)
  `).run();
  const orphaned = db.prepare(`
    SELECT q.id FROM quotes q
    LEFT JOIN quote_items qi ON qi.quote_id = q.id
    WHERE qi.id IS NULL AND q.status NOT IN ('converted')
  `).all();
  for (const row of orphaned) {
    db.prepare('DELETE FROM quotes WHERE id = ?').run(row.id);
  }
  return { purged: orphaned.length };
}

function quoteItemsSummary(quoteId) {
  const items = getDb().prepare('SELECT product_name, quantity FROM quote_items WHERE quote_id = ? ORDER BY id LIMIT 5').all(quoteId);
  if (!items.length) return '';
  const preview = items.map(i => `${i.quantity}× ${i.product_name}`).join(', ');
  const total = getDb().prepare('SELECT COUNT(*) AS c FROM quote_items WHERE quote_id = ?').get(quoteId).c;
  return total > 5 ? `${preview} +${total - 5} more` : preview;
}

function getQuotes(filters = {}) {
  purgeOrphanedQuotes();
  if (filters.pos_open) expireDueQuotes();
  else if (!filters.include_all_statuses) expireDueQuotes();
  let sql = `SELECT q.*, c.name as customer_name, c.phone as customer_phone, u.full_name as user_name FROM quotes q
    LEFT JOIN customers c ON q.customer_id = c.id LEFT JOIN users u ON q.user_id = u.id WHERE 1=1`;
  const params = [];
  if (filters.status) { sql += ' AND q.status = ?'; params.push(filters.status); }
  if (filters.pos_open) {
    sql += ` AND q.status = 'open' AND (q.expires_at IS NULL OR q.expires_at > ?)`;
    params.push(new Date().toISOString());
  }
  if (filters.search) {
    const q = `%${filters.search}%`;
    sql += ' AND (q.quote_number LIKE ? OR c.name LIKE ? OR c.phone LIKE ? OR q.notes LIKE ?)';
    params.push(q, q, q, q);
  }
  if (filters.from) { sql += ' AND date(q.created_at) >= date(?)'; params.push(filters.from); }
  if (filters.to) { sql += ' AND date(q.created_at) <= date(?)'; params.push(filters.to); }
  sql += ' ORDER BY q.created_at DESC';
  if (filters.limit) { sql += ' LIMIT ?'; params.push(filters.limit); }
  const rows = getDb().prepare(sql).all(...params);
  return rows.map(q => ({ ...q, items_summary: quoteItemsSummary(q.id) }));
}

function getQuote(id) {
  expireDueQuotes();
  const quote = getDb().prepare(`SELECT q.*, c.name as customer_name, c.phone as customer_phone, u.full_name as user_name
    FROM quotes q LEFT JOIN customers c ON q.customer_id = c.id LEFT JOIN users u ON q.user_id = u.id WHERE q.id = ?`).get(id);
  if (!quote) return null;
  quote.items = getDb().prepare('SELECT * FROM quote_items WHERE quote_id = ?').all(id);
  return quote;
}

function saveQuote(data, actorId) {
  const db = getDb();
  const branchId = getBranchId();
  const expiresAt = data.expires_at || (data.status === 'open' || !data.status ? computeQuoteExpiresAt() : null);
  if (data.id) {
    db.prepare(`UPDATE quotes SET customer_id=?, subtotal=?, discount=?, tax_amount=?, total=?, valid_until=?, expires_at=?, notes=?, status=? WHERE id=?`)
      .run(data.customer_id || null, data.subtotal, data.discount || 0, data.tax_amount || 0, data.total, data.valid_until || null, data.expires_at ?? expiresAt, data.notes || null, data.status || 'open', data.id);
    db.prepare('DELETE FROM quote_items WHERE quote_id = ?').run(data.id);
    for (const item of data.items) {
      db.prepare('INSERT INTO quote_items (quote_id, product_id, product_name, quantity, unit_price, discount, total) VALUES (?,?,?,?,?,?,?)')
        .run(data.id, item.product_id, item.product_name, item.quantity, item.unit_price, item.discount || 0, item.total);
    }
    return getQuote(data.id);
  }
  const quoteNumber = nextNumber('quote_counter', getQuotePrefix());
  const r = db.prepare(`INSERT INTO quotes (quote_number, customer_id, user_id, branch_id, subtotal, discount, tax_amount, total, valid_until, expires_at, notes, status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(quoteNumber, data.customer_id || null, actorId, branchId, data.subtotal, data.discount || 0, data.tax_amount || 0, data.total, data.valid_until || null, expiresAt, data.notes || null, data.status || 'open');
  for (const item of data.items) {
    db.prepare('INSERT INTO quote_items (quote_id, product_id, product_name, quantity, unit_price, discount, total) VALUES (?,?,?,?,?,?,?)')
      .run(r.lastInsertRowid, item.product_id, item.product_name, item.quantity, item.unit_price, item.discount || 0, item.total);
  }
  return getQuote(r.lastInsertRowid);
}

function reactivateQuote(id, actorId, actorName) {
  const quote = getQuote(id);
  if (!quote) throw new Error('Quote not found');
  if (!['expired', 'converted', 'held_admin'].includes(quote.status)) {
    throw new Error('Only expired or converted quotes can be returned to saved quotes');
  }
  const expiresAt = computeQuoteExpiresAt();
  getDb().prepare(`UPDATE quotes SET status='open', converted_sale_id=NULL, expires_at=? WHERE id=?`).run(expiresAt, id);
  audit(actorId, actorName, 'reactivate_quote', 'quote', id, { quote_number: quote.quote_number });
  return getQuote(id);
}

function deleteQuote(id, actorId, actorName) {
  const q = getQuote(id);
  if (!q) throw new Error('Quote not found');
  getDb().prepare('DELETE FROM quote_items WHERE quote_id = ?').run(id);
  getDb().prepare('DELETE FROM quotes WHERE id = ?').run(id);
  audit(actorId, actorName, 'delete_quote', 'quote', id, { quote_number: q.quote_number, status: q.status });
  return { success: true };
}

function convertQuoteToSale(quoteId, completeSaleFn, actorId, actorName, paymentOpts = null) {
  expireDueQuotes();
  const quote = getQuote(quoteId);
  if (!quote || quote.status !== 'open') throw new Error('Quote not available');
  if (quote.expires_at && quote.expires_at <= new Date().toISOString()) throw new Error('Quote has expired');
  const payType = String(paymentOpts?.payment_type || paymentOpts?.type || 'cash').toLowerCase();
  const amount = Number(paymentOpts?.amount != null ? paymentOpts.amount : quote.total) || Number(quote.total) || 0;
  const saleData = {
    customer_id: quote.customer_id,
    items: quote.items.map(i => ({ product_id: i.product_id, product_name: i.product_name, quantity: i.quantity, unit_price: i.unit_price, buying_price: 0, discount: i.discount, total: i.total })),
    subtotal: quote.subtotal, discount: quote.discount, tax_amount: quote.tax_amount, total: quote.total,
    amount_paid: amount, change_amount: 0,
    payments: [{ type: payType, amount }],
    notes: `From quote ${quote.quote_number}`
  };
  const result = completeSaleFn(saleData, actorId, actorName);
  markQuoteConverted(quoteId, result.saleId, actorId, actorName);
  return result;
}

function markQuoteConverted(quoteId, saleId, actorId, actorName) {
  const quote = getQuote(quoteId);
  if (!quote) throw new Error('Quote not found');
  if (quote.status === 'converted') return quote;
  if (quote.status !== 'open') throw new Error('Quote not available');
  getDb().prepare(`UPDATE quotes SET status='converted', converted_sale_id=? WHERE id=?`).run(saleId || null, quoteId);
  audit(actorId, actorName, 'convert_quote', 'quote', quoteId, { quote_number: quote.quote_number, sale_id: saleId || null });
  return getQuote(quoteId);
}

function buildQuotePdf(quoteId, shopSettings = {}) {
  const quote = getQuote(quoteId);
  if (!quote) throw new Error('Quote not found');
  const { buildQuotePdf: buildPdf } = require('./export');
  return buildPdf(quote, {
    shop_name: shopSettings.shop_name,
    address: shopSettings.address,
    phone: shopSettings.phone,
    email: shopSettings.email,
    vat_number: shopSettings.vat_number,
    currency: shopSettings.currency || 'R'
  });
}

// ─── Lay-Bye ────────────────────────────────────────────────────────────────

function getLaybyes(filters = {}) {
  let sql = `SELECT l.*, c.name as customer_name, c.phone as customer_phone,
    (SELECT GROUP_CONCAT(product_name || ' x' || quantity, ', ') FROM layby_items WHERE layby_id = l.id) as item_summary
    FROM laybyes l JOIN customers c ON l.customer_id = c.id WHERE 1=1`;
  const params = [];
  if (filters.status) { sql += ' AND l.status = ?'; params.push(filters.status); }
  if (filters.from) { sql += ' AND date(l.created_at) >= date(?)'; params.push(filters.from); }
  if (filters.to) { sql += ' AND date(l.created_at) <= date(?)'; params.push(filters.to); }
  sql += ' ORDER BY l.created_at DESC';
  if (filters.limit) { sql += ' LIMIT ?'; params.push(Number(filters.limit) || 500); }
  return getDb().prepare(sql).all(...params);
}

function getLayby(id) {
  const layby = getDb().prepare(`SELECT l.*, c.name as customer_name, c.phone as customer_phone
    FROM laybyes l JOIN customers c ON l.customer_id = c.id WHERE l.id = ?`).get(id);
  if (!layby) return null;
  layby.items = getDb().prepare('SELECT * FROM layby_items WHERE layby_id = ?').all(id);
  layby.payments = getDb().prepare('SELECT * FROM layby_payments WHERE layby_id = ? ORDER BY created_at').all(id);
  layby.item_summary = (layby.items || []).map(i => `${i.product_name} x${i.quantity}`).join(', ');
  return layby;
}

function getLaybySettings() {
  const row = getDb().prepare('SELECT layby_settings FROM shop_settings WHERE id = 1').get();
  let raw = {};
  try {
    if (row?.layby_settings) {
      raw = typeof row.layby_settings === 'string' ? JSON.parse(row.layby_settings) : row.layby_settings;
    }
  } catch (_) {}
  return {
    duration_days: Math.max(1, parseInt(raw.duration_days, 10) || 30),
    refund_fee_type: raw.refund_fee_type === 'fixed' ? 'fixed' : 'percent',
    refund_fee_value: Math.max(0, Number(raw.refund_fee_value) || 10),
    allow_partial_payments: raw.allow_partial_payments !== false
  };
}

function saveLaybySettings(data, actorId, actorName) {
  const next = {
    duration_days: Math.max(1, parseInt(data.duration_days, 10) || 30),
    refund_fee_type: data.refund_fee_type === 'fixed' ? 'fixed' : 'percent',
    refund_fee_value: Math.max(0, Number(data.refund_fee_value) || 0),
    allow_partial_payments: data.allow_partial_payments !== false
  };
  getDb().prepare(`UPDATE shop_settings SET layby_settings = ?, updated_at = datetime('now') WHERE id = 1`)
    .run(JSON.stringify(next));
  getDb().prepare(`INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, details) VALUES (?,?,?,?,?,?)`)
    .run(actorId || null, actorName || 'system', 'save_layby_settings', 'settings', 1, JSON.stringify(next));
  return next;
}

function createLayby(data, actorId) {
  const db = getDb();
  const settings = getLaybySettings();
  const laybyNumber = nextNumber('layby_counter', 'LB');
  if (!data.customer_id) throw new Error('Customer is required for lay-bye');
  const items = Array.isArray(data.items) ? data.items : [];
  if (!items.length) throw new Error('Lay-bye must include at least one item');
  let total = 0;
  const pricedItems = [];
  for (const item of items) {
    const qty = Number(item.quantity) || 0;
    if (qty <= 0) throw new Error(`Invalid quantity for ${item.product_name || 'item'}`);
    let unitPrice = Number(item.unit_price) || 0;
    let productName = item.product_name || 'Item';
    if (item.product_id) {
      const product = db.prepare('SELECT name, selling_price FROM products WHERE id = ?').get(item.product_id);
      if (!product) throw new Error(`Product not found: ${item.product_name || item.product_id}`);
      unitPrice = Number(product.selling_price) || 0;
      productName = product.name || productName;
    }
    const lineTotal = Math.round(unitPrice * qty * 100) / 100;
    total += lineTotal;
    pricedItems.push({
      product_id: item.product_id || null,
      product_name: productName,
      quantity: qty,
      unit_price: unitPrice,
      total: lineTotal
    });
  }
  total = Math.round(total * 100) / 100;
  if (!(total > 0)) throw new Error('Lay-bye total must be greater than zero');
  const deposit = Math.round((Number(data.deposit) || 0) * 100) / 100;
  if (deposit < 0) throw new Error('Deposit cannot be negative');
  if (deposit > total + 0.02) throw new Error('Deposit cannot exceed lay-bye total');
  const balance = Math.round((total - deposit) * 100) / 100;
  const days = Math.max(1, parseInt(data.duration_days, 10) || settings.duration_days);
  const expires = new Date();
  expires.setDate(expires.getDate() + days);
  const expiresAt = expires.toLocaleDateString('en-CA');
  const r = db.prepare(`INSERT INTO laybyes (layby_number, customer_id, user_id, branch_id, total, amount_paid, balance, notes, expires_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    laybyNumber, data.customer_id, actorId, getBranchId(), total, deposit, balance, data.notes || null, expiresAt
  );
  for (const item of pricedItems) {
    db.prepare('INSERT INTO layby_items (layby_id, product_id, product_name, quantity, unit_price, total) VALUES (?,?,?,?,?,?)')
      .run(r.lastInsertRowid, item.product_id, item.product_name, item.quantity, item.unit_price, item.total);
  }
  if (deposit > 0) {
    db.prepare('INSERT INTO layby_payments (layby_id, amount, payment_type, user_id) VALUES (?,?,?,?)')
      .run(r.lastInsertRowid, deposit, data.payment_type || 'cash', actorId);
  }
  return { id: r.lastInsertRowid, laybyNumber, expires_at: expiresAt, total, balance };
}

function addLaybyPayment(laybyId, amount, paymentType, actorId) {
  const db = getDb();
  const layby = db.prepare('SELECT * FROM laybyes WHERE id = ?').get(laybyId);
  if (!layby || layby.status !== 'active') throw new Error('Lay-bye not active');
  const amt = Number(amount) || 0;
  if (amt <= 0) throw new Error('Payment amount must be greater than zero');
  if (amt > Number(layby.balance) + 0.02) throw new Error('Payment exceeds remaining balance');
  db.prepare('INSERT INTO layby_payments (layby_id, amount, payment_type, user_id) VALUES (?,?,?,?)').run(laybyId, amt, paymentType || 'cash', actorId);
  const newPaid = Number(layby.amount_paid) + amt;
  const newBalance = Number(layby.total) - newPaid;
  const status = newBalance <= 0.02 ? 'completed' : 'active';
  db.prepare(`UPDATE laybyes SET amount_paid=?, balance=?, status=?, completed_at=? WHERE id=?`)
    .run(newPaid, Math.max(0, newBalance), status, status === 'completed' ? new Date().toISOString() : null, laybyId);
  return { balance: Math.max(0, newBalance), status, amount_paid: newPaid };
}

/** Cancel laybuy and refund money paid minus admin fee (percent or fixed) */
function refundLayby(laybyId, actorId, actorName) {
  const db = getDb();
  const layby = db.prepare('SELECT * FROM laybyes WHERE id = ?').get(laybyId);
  if (!layby) throw new Error('Lay-bye not found');
  if (layby.status === 'completed') throw new Error('Completed lay-bye cannot be refunded this way');
  if (layby.status === 'cancelled') throw new Error('Lay-bye already cancelled');
  const settings = getLaybySettings();
  const paid = Number(layby.amount_paid) || 0;
  let fee = 0;
  if (settings.refund_fee_type === 'fixed') fee = Number(settings.refund_fee_value) || 0;
  else fee = paid * ((Number(settings.refund_fee_value) || 0) / 100);
  fee = Math.min(paid, Math.round(fee * 100) / 100);
  const refunded = Math.max(0, Math.round((paid - fee) * 100) / 100);
  db.prepare(`UPDATE laybyes SET status='cancelled', balance=0, refund_fee=?, refunded_amount=?, cancelled_at=datetime('now') WHERE id=?`)
    .run(fee, refunded, laybyId);
  if (refunded > 0) {
    db.prepare('INSERT INTO layby_payments (layby_id, amount, payment_type, user_id) VALUES (?,?,?,?)')
      .run(laybyId, -refunded, 'refund', actorId);
  }
  getDb().prepare(`INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, details) VALUES (?,?,?,?,?,?)`)
    .run(actorId || null, actorName || 'system', 'refund_layby', 'layby', laybyId, JSON.stringify({ fee, refunded, paid }));
  return getLayby(laybyId);
}

// ─── Gift Cards ─────────────────────────────────────────────────────────────

const adminOverride = require('./admin-override');

function giftCardAudit(actorId, actorName, action, entityId, details) {
  getDb().prepare(`INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, details) VALUES (?,?,?,?,?,?)`)
    .run(actorId || null, actorName || 'system', action, 'gift_card', entityId || null, details ? JSON.stringify(details) : null);
}

function getGiftCardCreatorId(cardId, cardRow) {
  if (cardRow?.created_by) return cardRow.created_by;
  const tx = getDb().prepare(`SELECT user_id FROM gift_card_transactions WHERE gift_card_id = ? AND type = 'issue' ORDER BY id LIMIT 1`).get(cardId);
  return tx?.user_id || null;
}

function getGiftCardSettings() {
  try {
    const row = getDb().prepare('SELECT gift_card_settings FROM shop_settings WHERE id = 1').get();
    if (row?.gift_card_settings) {
      const parsed = typeof row.gift_card_settings === 'string' ? JSON.parse(row.gift_card_settings) : row.gift_card_settings;
      if (parsed && typeof parsed === 'object') return { auto_approve: parsed.auto_approve !== false, ...parsed };
    }
  } catch (_) { /* column may be missing until migration */ }
  return { auto_approve: true };
}

function saveGiftCardSettings(data, actorId, actorName) {
  const current = getGiftCardSettings();
  const next = { ...current, auto_approve: data.auto_approve !== false && data.auto_approve !== 0 };
  try {
    getDb().prepare('UPDATE shop_settings SET gift_card_settings = ?, updated_at = datetime(\'now\') WHERE id = 1')
      .run(JSON.stringify(next));
  } catch (_) {
    // Column may not exist yet — store via saveJsonSetting pattern if available
    try {
      getDb().exec('ALTER TABLE shop_settings ADD COLUMN gift_card_settings TEXT');
      getDb().prepare('UPDATE shop_settings SET gift_card_settings = ? WHERE id = 1').run(JSON.stringify(next));
    } catch (e2) {
      throw new Error('Could not save gift card settings');
    }
  }
  giftCardAudit(actorId, actorName, 'save_gift_card_settings', 1, next);
  return next;
}

function giftCardEffectiveStatus(card) {
  if (!card) return 'unknown';
  const approval = card.approval_status || 'approved';
  if (approval === 'pending') return 'pending';
  if (approval === 'rejected') return 'rejected';
  if (card.status === 'cancelled') return 'cancelled';
  if (card.expires_at && String(card.expires_at).slice(0, 10) < new Date().toISOString().slice(0, 10)) return 'expired';
  if (Number(card.balance) <= 0) return 'used';
  return 'active';
}

function assertGiftCardRedeemable(card) {
  if (!card) throw new Error('Gift card not found');
  const approval = card.approval_status || 'approved';
  if (approval === 'pending') throw new Error('Gift card is pending admin approval');
  if (approval === 'rejected') throw new Error('Gift card was rejected');
  const status = giftCardEffectiveStatus(card);
  if (status === 'expired') throw new Error('This gift card has expired and cannot be used');
  if (status === 'used') throw new Error('This gift card has no balance remaining');
  if (status === 'cancelled') throw new Error('This gift card has been cancelled');
  if (Number(card.balance) <= 0) throw new Error('This gift card has no balance remaining');
}

function getGiftCards(searchOrFilters) {
  const filters = typeof searchOrFilters === 'object' && searchOrFilters !== null
    ? searchOrFilters
    : { search: searchOrFilters };
  let sql = `SELECT g.*, c.name AS customer_name,
    COALESCE(g.created_by, (SELECT user_id FROM gift_card_transactions t WHERE t.gift_card_id = g.id AND t.type = 'issue' ORDER BY t.id LIMIT 1)) AS created_by,
    u.full_name AS created_by_name,
    au.full_name AS approved_by_name
    FROM gift_cards g
    LEFT JOIN customers c ON c.id = g.customer_id
    LEFT JOIN users u ON u.id = COALESCE(g.created_by, (SELECT user_id FROM gift_card_transactions t WHERE t.gift_card_id = g.id AND t.type = 'issue' ORDER BY t.id LIMIT 1))
    LEFT JOIN users au ON au.id = g.approved_by
    WHERE 1=1`;
  const params = [];
  if (filters.search) { sql += ' AND (g.code LIKE ? OR c.name LIKE ? OR g.customer_phone LIKE ?)'; params.push(`%${filters.search}%`, `%${filters.search}%`, `%${filters.search}%`); }
  if (filters.from) { sql += ' AND date(g.created_at) >= date(?)'; params.push(filters.from); }
  if (filters.to) { sql += ' AND date(g.created_at) <= date(?)'; params.push(filters.to); }
  if (filters.approval_status) { sql += ' AND COALESCE(g.approval_status, \'approved\') = ?'; params.push(filters.approval_status); }
  sql += ' ORDER BY g.created_at DESC';
  if (filters.limit) { sql += ' LIMIT ?'; params.push(Number(filters.limit) || 500); }
  return getDb().prepare(sql).all(...params).map(row => ({
    ...row,
    display_status: giftCardEffectiveStatus(row)
  }));
}

function createGiftCard(data, actorId, actorName) {
  const code = data.code || `GC-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const amount = Math.round((Number(data.amount) || 0) * 100) / 100;
  if (!(amount > 0)) throw new Error('Gift card amount must be greater than zero');
  if (amount > 100000) throw new Error('Gift card amount is too large');
  const settings = getGiftCardSettings();
  const auto = data.auto_approve != null ? !!data.auto_approve : settings.auto_approve !== false;
  const approval = auto ? 'approved' : 'pending';
  const r = getDb().prepare(`INSERT INTO gift_cards (code, initial_balance, balance, customer_id, customer_phone, branch_id, expires_at, created_by, notes, approval_status, approved_by, approved_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(
      code, amount, amount, data.customer_id || null, data.customer_phone || null, getBranchId(),
      data.expires_at || null, actorId || null, data.notes || null,
      approval, approval === 'approved' ? actorId : null,
      approval === 'approved' ? new Date().toISOString() : null
    );
  getDb().prepare('INSERT INTO gift_card_transactions (gift_card_id, amount, type, user_id) VALUES (?,?,?,?)')
    .run(r.lastInsertRowid, amount, 'issue', actorId);
  giftCardAudit(actorId, actorName, 'create_gift_card', r.lastInsertRowid, { code, amount, approval_status: approval });
  return {
    id: r.lastInsertRowid, code, customer_phone: data.customer_phone || null,
    balance: amount, customer_id: data.customer_id || null, approval_status: approval
  };
}

function approveGiftCard(id, actorId, actorName) {
  const card = getDb().prepare('SELECT * FROM gift_cards WHERE id = ?').get(id);
  if (!card) throw new Error('Gift card not found');
  if ((card.approval_status || 'approved') === 'approved') throw new Error('Already approved');
  getDb().prepare(`UPDATE gift_cards SET approval_status='approved', approved_by=?, approved_at=datetime('now'), status='active' WHERE id=?`)
    .run(actorId, id);
  giftCardAudit(actorId, actorName, 'approve_gift_card', id, { code: card.code });
  return getGiftCards({ search: card.code })[0] || { ...card, approval_status: 'approved' };
}

function rejectGiftCard(id, actorId, actorName, notes) {
  const card = getDb().prepare('SELECT * FROM gift_cards WHERE id = ?').get(id);
  if (!card) throw new Error('Gift card not found');
  getDb().prepare(`UPDATE gift_cards SET approval_status='rejected', approved_by=?, approved_at=datetime('now'),
    status='cancelled', notes=COALESCE(?, notes) WHERE id=?`)
    .run(actorId, notes || 'Rejected', id);
  giftCardAudit(actorId, actorName, 'reject_gift_card', id, { code: card.code, notes });
  return { id, approval_status: 'rejected' };
}

function canManageGiftCard(actor, creatorId) {
  const { assertUserActor } = require('./authz');
  const user = assertUserActor(actor, ['owner', 'manager', 'supervisor', 'assistant_manager']);
  if (creatorId == null || Number(creatorId) === Number(user.id)) return { override: false, user };
  if (user.role === 'manager' || user.role === 'owner') return { override: false, user };
  if (adminOverride.isOwner(user)) {
    return {
      ...adminOverride.assertCanModify(user, creatorId, { override_reason: actor?.override_reason }),
      user
    };
  }
  throw new Error('Not authorized to modify this gift card');
}

function updateGiftCard(id, data, actor) {
  const card = getDb().prepare('SELECT * FROM gift_cards WHERE id = ?').get(id);
  if (!card) throw new Error('Gift card not found');
  const creatorId = getGiftCardCreatorId(id, card);
  const overrideMeta = canManageGiftCard(actor, creatorId);
  if (overrideMeta.override) {
    adminOverride.logAdminOverride(actor, 'admin_override_update_gift_card', 'gift_card', id, {
      reason: overrideMeta.reason,
      record_owner_id: creatorId,
      code: card.code
    });
  }
  // Balance may only change via audited top-up / redeem — not arbitrary client edits
  const nextStatus = data.status || card.status;
  getDb().prepare('UPDATE gift_cards SET status = ?, expires_at = ?, customer_phone = ? WHERE id = ?')
    .run(nextStatus, data.expires_at ?? card.expires_at, data.customer_phone ?? card.customer_phone, id);
  if (data.balance != null && Number(data.balance) !== Number(card.balance)) {
    const newBal = Math.round((Number(data.balance) || 0) * 100) / 100;
    if (newBal < 0) throw new Error('Gift card balance cannot be negative');
    const delta = Math.round((newBal - Number(card.balance)) * 100) / 100;
    if (Math.abs(delta) > 0.001) {
      if (!['owner', 'manager'].includes(actor?.role)) {
        throw new Error('Only owner/manager can adjust gift card balance');
      }
      getDb().prepare('UPDATE gift_cards SET balance = ? WHERE id = ?').run(newBal, id);
      getDb().prepare('INSERT INTO gift_card_transactions (gift_card_id, amount, type, user_id) VALUES (?,?,?,?)')
        .run(id, delta, delta >= 0 ? 'topup' : 'adjust', actor?.id || null);
    }
  }
  giftCardAudit(actor?.id, actor?.username, 'update_gift_card', id, { code: card.code, status: nextStatus });
  return { id, code: card.code };
}

function deleteGiftCard(id, actor) {
  const card = getDb().prepare('SELECT * FROM gift_cards WHERE id = ?').get(id);
  if (!card) throw new Error('Gift card not found');
  const creatorId = getGiftCardCreatorId(id, card);
  const overrideMeta = canManageGiftCard(actor, creatorId);
  if (overrideMeta.override) {
    adminOverride.logAdminOverride(actor, 'admin_override_delete_gift_card', 'gift_card', id, {
      reason: overrideMeta.reason,
      record_owner_id: creatorId,
      code: card.code,
      balance: card.balance
    });
  } else if (card.balance > 0 && card.status === 'active') {
    throw new Error('Cannot delete active gift card with balance. Set status to cancelled first.');
  }
  getDb().prepare('DELETE FROM gift_card_transactions WHERE gift_card_id = ?').run(id);
  getDb().prepare('DELETE FROM gift_cards WHERE id = ?').run(id);
  giftCardAudit(actor?.id, actor?.username, 'delete_gift_card', id, { code: card.code, override: overrideMeta.override || false });
  return { success: true };
}

function redeemGiftCard(code, amount, saleId, actorId) {
  const card = getDb().prepare('SELECT * FROM gift_cards WHERE code = ?').get(code);
  assertGiftCardRedeemable(card);
  if (card.balance < amount) throw new Error('Insufficient gift card balance');
  const newBal = card.balance - amount;
  getDb().prepare('UPDATE gift_cards SET balance = ?, status = ? WHERE id = ?').run(newBal, newBal <= 0 ? 'redeemed' : 'active', card.id);
  getDb().prepare('INSERT INTO gift_card_transactions (gift_card_id, amount, type, sale_id, user_id) VALUES (?,?,?,?,?)')
    .run(card.id, -amount, 'redeem', saleId, actorId);
  return { balance: newBal };
}

function checkGiftCardBalance(code) {
  const card = getDb().prepare('SELECT code, balance, status, expires_at, approval_status FROM gift_cards WHERE code = ?').get(code);
  if (!card) throw new Error('Gift card not found');
  const displayStatus = giftCardEffectiveStatus(card);
  if (displayStatus === 'expired') throw new Error('This gift card has expired');
  if (displayStatus === 'cancelled') throw new Error('This gift card has been cancelled');
  if (displayStatus === 'pending') throw new Error('This gift card is pending approval');
  if (displayStatus === 'rejected') throw new Error('This gift card was rejected');
  if (Number(card.balance) <= 0) throw new Error('This gift card has no balance remaining');
  return { ...card, balance: Number(card.balance) || 0, display_status: displayStatus };
}

// ─── Loyalty ────────────────────────────────────────────────────────────────

function getLoyaltySettings() {
  const row = getDb().prepare('SELECT loyalty_settings FROM shop_settings WHERE id = 1').get();
  let raw = {};
  try {
    if (row?.loyalty_settings) {
      raw = typeof row.loyalty_settings === 'string' ? JSON.parse(row.loyalty_settings) : row.loyalty_settings;
    }
  } catch (_) {}
  return {
    enabled: raw.enabled !== false,
    spend_amount: Number(raw.spend_amount) > 0 ? Number(raw.spend_amount) : 10,
    points_earned: Number(raw.points_earned) > 0 ? Number(raw.points_earned) : 1,
    min_sale_total: Number(raw.min_sale_total) || 0,
    point_value: Number(raw.point_value) > 0 ? Number(raw.point_value) : 1
  };
}

function calcLoyaltyRedemption(customerId, pointsToRedeem, saleTotal) {
  if (!customerId || !pointsToRedeem || pointsToRedeem <= 0) {
    return { points: 0, discount: 0, pointValue: getLoyaltySettings().point_value };
  }
  const settings = getLoyaltySettings();
  if (!settings.enabled) return { points: 0, discount: 0, pointValue: settings.point_value };
  const c = getDb().prepare('SELECT loyalty_points FROM customers WHERE id = ?').get(customerId);
  const available = Math.floor(Number(c?.loyalty_points) || 0);
  const pointValue = settings.point_value;
  const total = Number(saleTotal) || 0;
  const maxByTotal = Math.floor(total / pointValue);
  const points = Math.min(Math.floor(Number(pointsToRedeem) || 0), available, maxByTotal);
  return { points, discount: points * pointValue, pointValue };
}

function earnLoyaltyPoints(customerId, saleTotal, saleId) {
  if (!customerId) return 0;
  const settings = getLoyaltySettings();
  if (!settings.enabled) return 0;
  const total = Number(saleTotal) || 0;
  if (total < settings.min_sale_total) return 0;
  const points = Math.floor((total / settings.spend_amount) * settings.points_earned);
  if (points <= 0) return 0;
  getDb().prepare('UPDATE customers SET loyalty_points = COALESCE(loyalty_points, 0) + ? WHERE id = ?').run(points, customerId);
  getDb().prepare('INSERT INTO loyalty_transactions (customer_id, points, type, sale_id) VALUES (?,?,?,?)').run(customerId, points, 'earn', saleId);
  return points;
}

function redeemLoyaltyPoints(customerId, points, saleId) {
  const c = getDb().prepare('SELECT loyalty_points FROM customers WHERE id = ?').get(customerId);
  if (!c || c.loyalty_points < points) throw new Error('Insufficient points');
  getDb().prepare('UPDATE customers SET loyalty_points = loyalty_points - ? WHERE id = ?').run(points, customerId);
  getDb().prepare('INSERT INTO loyalty_transactions (customer_id, points, type, sale_id) VALUES (?,?,?,?)').run(customerId, -points, 'redeem', saleId);
  return points;
}

function getLoyaltyHistory(customerId) {
  return getDb().prepare('SELECT * FROM loyalty_transactions WHERE customer_id = ? ORDER BY created_at DESC').all(customerId);
}

/** Reverse loyalty points, gift card balance, and on-account charges after void/refund. */
function reverseSaleBenefits(saleId, actorId, refundRatio = 1) {
  const db = getDb();
  const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId);
  if (!sale) return;
  const ratio = Math.min(1, Math.max(0, Number(refundRatio) || 0));
  if (ratio <= 0) return;

  const customerId = sale.customer_id;
  if (customerId) {
    const earned = Number(db.prepare(`
      SELECT COALESCE(SUM(points), 0) as v FROM loyalty_transactions
      WHERE sale_id = ? AND type = 'earn'`).get(saleId)?.v) || 0;
    const redeemed = Number(db.prepare(`
      SELECT COALESCE(SUM(ABS(points)), 0) as v FROM loyalty_transactions
      WHERE sale_id = ? AND type = 'redeem'`).get(saleId)?.v) || 0;
    const earnRevoked = Number(db.prepare(`
      SELECT COALESCE(SUM(ABS(points)), 0) as v FROM loyalty_transactions
      WHERE sale_id = ? AND type = 'adjust' AND notes = 'void_reversal' AND points < 0`).get(saleId)?.v) || 0;
    const redeemRestored = Number(db.prepare(`
      SELECT COALESCE(SUM(points), 0) as v FROM loyalty_transactions
      WHERE sale_id = ? AND type = 'adjust' AND notes = 'void_reversal' AND points > 0`).get(saleId)?.v) || 0;

    const earnDelta = Math.max(0, Math.floor(earned * ratio) - earnRevoked);
    const redeemDelta = Math.max(0, Math.floor(redeemed * ratio) - redeemRestored);

    if (earnDelta > 0) {
      db.prepare(`
        UPDATE customers SET loyalty_points = MAX(0, COALESCE(loyalty_points, 0) - ?) WHERE id = ?`).run(earnDelta, customerId);
      db.prepare(`
        INSERT INTO loyalty_transactions (customer_id, points, type, sale_id, notes)
        VALUES (?, ?, 'adjust', ?, 'void_reversal')`).run(customerId, -earnDelta, saleId);
    }
    if (redeemDelta > 0) {
      db.prepare(`
        UPDATE customers SET loyalty_points = COALESCE(loyalty_points, 0) + ? WHERE id = ?`).run(redeemDelta, customerId);
      db.prepare(`
        INSERT INTO loyalty_transactions (customer_id, points, type, sale_id, notes)
        VALUES (?, ?, 'adjust', ?, 'void_reversal')`).run(customerId, redeemDelta, saleId);
    }
  }

  const gcRedeems = db.prepare(`
    SELECT * FROM gift_card_transactions WHERE sale_id = ? AND type = 'redeem'`).all(saleId);
  for (const t of gcRedeems) {
    const original = Math.abs(Number(t.amount) || 0);
    const target = original * ratio;
    const restored = Number(db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as v FROM gift_card_transactions
      WHERE sale_id = ? AND gift_card_id = ? AND type = 'reload'`).get(saleId, t.gift_card_id)?.v) || 0;
    const delta = Math.max(0, target - restored);
    if (delta <= 0) continue;
    const card = db.prepare('SELECT * FROM gift_cards WHERE id = ?').get(t.gift_card_id);
    if (!card) continue;
    const newBal = Number(card.balance) + delta;
    db.prepare('UPDATE gift_cards SET balance = ?, status = ? WHERE id = ?')
      .run(newBal, 'active', card.id);
    db.prepare(`
      INSERT INTO gift_card_transactions (gift_card_id, amount, type, sale_id, user_id)
      VALUES (?, ?, 'reload', ?, ?)`).run(card.id, delta, saleId, actorId);
  }

  if (customerId) {
    const onAccount = Number(db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as v FROM sale_payments
      WHERE sale_id = ? AND payment_type = 'account'`).get(saleId)?.v) || 0;
    const acctTarget = onAccount * ratio;
    const acctReversed = Number(db.prepare(`
      SELECT COALESCE(SUM(ABS(amount)), 0) as v FROM customer_credit_ledger
      WHERE sale_id = ? AND type = 'payment' AND notes LIKE 'void_reversal%'`).get(saleId)?.v) || 0;
    const acctDelta = Math.max(0, acctTarget - acctReversed);
    if (acctDelta > 0) {
      const c = db.prepare('SELECT balance FROM customers WHERE id = ?').get(customerId);
      const newBal = Math.max(0, (Number(c?.balance) || 0) - acctDelta);
      db.prepare('UPDATE customers SET balance = ? WHERE id = ?').run(newBal, customerId);
      db.prepare(`
        INSERT INTO customer_credit_ledger (customer_id, amount, type, balance_after, sale_id, notes, user_id)
        VALUES (?, ?, 'payment', ?, ?, ?, ?)`).run(
        customerId, -acctDelta, newBal, saleId, `void_reversal ${sale.receipt_number}`, actorId
      );
    }
  }
}

// ─── Customer Credit ────────────────────────────────────────────────────────

function addCustomerCreditCharge(customerId, amount, saleId, notes, actorId) {
  const db = getDb();
  const c = db.prepare('SELECT balance FROM customers WHERE id = ?').get(customerId);
  const newBal = (c?.balance || 0) + amount;
  db.prepare('UPDATE customers SET balance = ? WHERE id = ?').run(newBal, customerId);
  db.prepare('INSERT INTO customer_credit_ledger (customer_id, amount, type, balance_after, sale_id, notes, user_id) VALUES (?,?,?,?,?,?,?)')
    .run(customerId, amount, 'charge', newBal, saleId, notes, actorId);
  return newBal;
}

function addCustomerCreditPayment(customerId, amount, notes, actorId, paymentMethod) {
  const db = getDb();
  const c = db.prepare('SELECT balance FROM customers WHERE id = ?').get(customerId);
  const newBal = Math.max(0, (c?.balance || 0) - amount);
  db.prepare('UPDATE customers SET balance = ? WHERE id = ?').run(newBal, customerId);
  const r = db.prepare('INSERT INTO customer_credit_ledger (customer_id, amount, type, balance_after, notes, user_id) VALUES (?,?,?,?,?,?)')
    .run(customerId, -amount, 'payment', newBal, notes, actorId);
  const ledgerId = Number(r.lastInsertRowid) || Number(db.prepare('SELECT id FROM customer_credit_ledger ORDER BY id DESC LIMIT 1').get()?.id) || 0;
  if (ledgerId && paymentMethod) {
    try { db.prepare('UPDATE customer_credit_ledger SET payment_method=? WHERE id=?').run(paymentMethod, ledgerId); } catch (_) { /* optional column */ }
  }
  try {
    const { runIntegration } = require('./accounting-central');
    runIntegration('postFromCustomerCreditPayment', ledgerId);
  } catch (err) {
    console.warn('[customer credit] accounting:', err.message);
  }
  return { balance: newBal, ledger_id: ledgerId };
}

function getCustomerCreditLedger(customerId) {
  return getDb().prepare('SELECT * FROM customer_credit_ledger WHERE customer_id = ? ORDER BY created_at DESC').all(customerId);
}

// ─── Stock Count ────────────────────────────────────────────────────────────

function getStockCounts() {
  return getDb().prepare(`SELECT sc.*, u.full_name as user_name FROM stock_counts sc LEFT JOIN users u ON sc.user_id = u.id ORDER BY sc.created_at DESC`).all();
}

function createStockCount(actorId, notes) {
  const countNumber = `CNT-${Date.now().toString(36).toUpperCase()}`;
  const r = getDb().prepare('INSERT INTO stock_counts (count_number, user_id, branch_id, notes) VALUES (?,?,?,?)')
    .run(countNumber, actorId, getBranchId(), notes || null);
  const products = getDb().prepare('SELECT id, stock_quantity FROM products WHERE is_active = 1').all();
  for (const p of products) {
    getDb().prepare('INSERT INTO stock_count_lines (count_id, product_id, system_qty, counted_qty, difference) VALUES (?,?,?,?,?)')
      .run(r.lastInsertRowid, p.id, p.stock_quantity, p.stock_quantity, 0);
  }
  const user = getDb().prepare('SELECT full_name FROM users WHERE id = ?').get(actorId);
  try {
    require('./store').addNotification('stock_count', 'Stock count started',
      `${user?.full_name || 'Staff'} started stock count ${countNumber} (${products.length} products).`, {
        entity_type: 'stock_count',
        entity_id: r.lastInsertRowid,
        action_page: `operations:stockcount:${r.lastInsertRowid}`,
        audience_roles: ['owner', 'manager', 'assistant_manager', 'supervisor']
      });
  } catch (_) { /* ignore */ }
  return { id: r.lastInsertRowid, countNumber, productCount: products.length, user_name: user?.full_name || null };
}

function updateStockCountLine(lineId, countedQty) {
  const line = getDb().prepare('SELECT * FROM stock_count_lines WHERE id = ?').get(lineId);
  if (!line) throw new Error('Line not found');
  const diff = countedQty - line.system_qty;
  getDb().prepare('UPDATE stock_count_lines SET counted_qty = ?, difference = ? WHERE id = ?').run(countedQty, diff, lineId);
  return diff;
}

function completeStockCount(countId, adjustStockFn, actorId) {
  const db = getDb();
  const count = db.prepare(`SELECT sc.*, u.full_name as user_name FROM stock_counts sc LEFT JOIN users u ON sc.user_id = u.id WHERE sc.id = ?`).get(countId);
  const lines = db.prepare('SELECT * FROM stock_count_lines WHERE count_id = ? AND difference != 0').all(countId);
  for (const line of lines) {
    adjustStockFn(line.product_id, line.counted_qty, 'set', `Stock count ${countId}`, actorId, 'count', countId);
  }
  db.prepare(`UPDATE stock_counts SET status='completed', completed_at=datetime('now') WHERE id=?`).run(countId);
  const completer = db.prepare('SELECT full_name FROM users WHERE id = ?').get(actorId);
  try {
    require('./store').addNotification('stock_count', 'Stock count completed',
      `${completer?.full_name || 'Staff'} completed ${count?.count_number || '#' + countId} (started by ${count?.user_name || '—'}). ${lines.length} product(s) adjusted.`, {
        entity_type: 'stock_count',
        entity_id: countId,
        action_page: `operations:stockcount:${countId}`,
        audience_roles: ['owner', 'manager', 'assistant_manager', 'supervisor']
      });
  } catch (_) { /* ignore */ }
  return { adjusted: lines.length, count_number: count?.count_number, started_by: count?.user_name };
}

function getStockCount(id) {
  const count = getDb().prepare(`SELECT sc.*, u.full_name as user_name FROM stock_counts sc LEFT JOIN users u ON sc.user_id = u.id WHERE sc.id = ?`).get(id);
  if (!count) return null;
  count.lines = getDb().prepare(`SELECT scl.*, p.name as product_name FROM stock_count_lines scl JOIN products p ON scl.product_id = p.id WHERE scl.count_id = ?`).all(id);
  return count;
}

// ─── Waste ──────────────────────────────────────────────────────────────────

function recordWaste(data, adjustStockFn, actorId) {
  const db = getDb();
  const product = db.prepare('SELECT buying_price, name, item_type FROM products WHERE id = ?').get(data.product_id);
  if (!product) throw new Error('Product not found');
  if (product.item_type !== 'ingredient') {
    throw new Error('Waste / damage is for ingredients only — select an ingredient from inventory');
  }
  const qty = Number(data.quantity) || 0;
  if (qty <= 0) throw new Error('Quantity must be greater than zero');
  const photos = [data.photo_path_1, data.photo_path_2].filter(Boolean);
  if (!photos.length) throw new Error('Upload at least one photo of the damaged/waste item');
  if (photos.length > 2) throw new Error('Maximum two photos allowed');
  const cost = (product.buying_price || 0) * qty;
  // Never honor client-approved status — stock only moves via approveWaste
  const status = 'pending';
  const r = db.prepare(`
    INSERT INTO waste_records (product_id, quantity, reason, employee_id, branch_id, notes, cost_value,
      status, photo_path_1, photo_path_2)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `).run(
    data.product_id, qty, data.reason || 'Damaged', data.employee_id || actorId, getBranchId(),
    data.notes || null, cost, status, photos[0] || null, photos[1] || null
  );
  return r.lastInsertRowid;
}

function getWasteRecords(from, to, filters = {}) {
  let sql = `SELECT w.*, p.name as product_name, u.full_name as employee_name,
      au.full_name as approved_by_name
    FROM waste_records w
    JOIN products p ON w.product_id = p.id
    LEFT JOIN users u ON w.employee_id = u.id
    LEFT JOIN users au ON w.approved_by = au.id
    WHERE 1=1`;
  const params = [];
  if (from) { sql += ' AND date(w.created_at) >= date(?)'; params.push(from); }
  if (to) { sql += ' AND date(w.created_at) <= date(?)'; params.push(to); }
  if (filters.status) { sql += ' AND COALESCE(w.status, \'pending\') = ?'; params.push(filters.status); }
  sql += ' ORDER BY w.created_at DESC';
  return getDb().prepare(sql).all(...params);
}

function approveWaste(id, actorId, notes) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM waste_records WHERE id = ?').get(id);
  if (!row) throw new Error('Waste record not found');
  const status = row.status || 'pending';
  if (status === 'approved') throw new Error('Already approved');
  if (status === 'rejected') throw new Error('Cannot approve a rejected record');
  db.prepare(`
    UPDATE waste_records SET status='approved', approved_by=?, approved_at=datetime('now'),
      rejection_notes=COALESCE(?, rejection_notes) WHERE id=?
  `).run(actorId, notes || null, id);
  return row;
}

function rejectWaste(id, actorId, notes) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM waste_records WHERE id = ?').get(id);
  if (!row) throw new Error('Waste record not found');
  if ((row.status || 'pending') === 'approved') throw new Error('Cannot reject an approved record');
  db.prepare(`
    UPDATE waste_records SET status='rejected', approved_by=?, approved_at=datetime('now'),
      rejection_notes=? WHERE id=?
  `).run(actorId, notes || 'Rejected', id);
  return getDb().prepare('SELECT * FROM waste_records WHERE id = ?').get(id);
}

function returnWasteToStock(id, actorId) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM waste_records WHERE id = ?').get(id);
  if (!row) throw new Error('Waste record not found');
  if ((row.status || '') !== 'approved') throw new Error('Only approved waste can be returned to stock');
  if (row.returned_to_stock) throw new Error('Already returned to stock');
  db.prepare(`UPDATE waste_records SET returned_to_stock = 1, returned_at = datetime('now'), returned_by = ? WHERE id = ?`)
    .run(actorId, id);
  return getDb().prepare('SELECT * FROM waste_records WHERE id = ?').get(id);
}

// ─── Partial PO Receiving ───────────────────────────────────────────────────

function receivePurchaseOrderPartial(poId, items, actorId, actorName, adjustStockFn) {
  const db = getDb();
  const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(poId);
  if (!po) throw new Error('PO not found');
  if (po.status === 'received') throw new Error('Purchase order has already been received');
  const r = db.prepare('INSERT INTO po_receipts (po_id, user_id) VALUES (?,?)').run(poId, actorId);
  const txn = db.transaction(() => {
    for (const item of items || []) {
      const poItem = db.prepare('SELECT * FROM purchase_order_items WHERE id = ? AND purchase_order_id = ?')
        .get(item.po_item_id, poId);
      if (!poItem) throw new Error('PO line item not found');
      const already = Number(poItem.received_qty) || 0;
      const ordered = Number(poItem.quantity) || 0;
      const remaining = Math.max(0, ordered - already);
      const requested = Number(item.quantity) || 0;
      if (requested <= 0) continue;
      const received = Math.min(requested, remaining);
      const backordered = Math.max(0, requested - received);
      db.prepare('INSERT INTO po_receipt_items (receipt_id, po_item_id, product_id, quantity_received, quantity_backordered) VALUES (?,?,?,?,?)')
        .run(r.lastInsertRowid, item.po_item_id, poItem.product_id, received, backordered);
      if (received > 0) {
        db.prepare('UPDATE purchase_order_items SET received_qty = COALESCE(received_qty,0) + ? WHERE id = ?')
          .run(received, item.po_item_id);
        if (poItem.product_id && typeof adjustStockFn === 'function') {
          adjustStockFn(poItem.product_id, received, 'purchase', `PO ${po.po_number} partial`, actorId, 'purchase_order', poId);
          if (poItem.buying_price != null) {
            db.prepare('UPDATE products SET buying_price = ? WHERE id = ?').run(poItem.buying_price, poItem.product_id);
          }
        }
      }
    }
    const allLines = db.prepare('SELECT quantity, received_qty FROM purchase_order_items WHERE purchase_order_id = ?').all(poId);
    const allReceived = allLines.length > 0 && allLines.every(line =>
      (Number(line.received_qty) || 0) >= (Number(line.quantity) || 0) - 0.001
    );
    if (allReceived) {
      db.prepare("UPDATE purchase_orders SET status = 'received', receiving_date = date('now') WHERE id = ?").run(poId);
    } else {
      db.prepare(`UPDATE purchase_orders SET status='partial' WHERE id=?`).run(poId);
    }
    return allReceived;
  });
  const complete = txn();
  return { receiptId: r.lastInsertRowid, complete };
}

// ─── Cash-Up ────────────────────────────────────────────────────────────────

function hasCashUpForShift(shiftId) {
  if (!shiftId) return false;
  return !!getDb().prepare('SELECT id FROM cashup_sessions WHERE shift_id = ? LIMIT 1').get(shiftId);
}

function createCashUp(shiftId, data, actorId) {
  if (shiftId && hasCashUpForShift(shiftId)) {
    throw new Error('This shift has already been cashed out');
  }
  const db = getDb();
  let expectedCash = Number(data.expected_cash);
  let managerApproved = !!data.manager_approved;
  let actorRole = null;
  try {
    const u = db.prepare('SELECT role FROM users WHERE id = ?').get(actorId);
    actorRole = u?.role || null;
  } catch (_) { /* ignore */ }
  // Never trust client-editable expected cash when a shift is linked — recompute from sales
  if (shiftId) {
    try {
      const preview = require('./store').getShiftClosePreview(shiftId, actorId);
      expectedCash = Number(preview.expectedCash) || 0;
      data = {
        ...data,
        opening_cash: preview.openingFloat,
        cash_sales: preview.expectedPayments?.cash || 0,
        card_sales: preview.expectedPayments?.card || 0,
        eft_sales: preview.expectedPayments?.eft || 0,
        mobile_sales: preview.expectedPayments?.mobile || 0,
        refunds: preview.refunds || 0,
        expected_cash: expectedCash
      };
    } catch (_) { /* keep provided expected if preview fails */ }
  }
  // Only owner/manager/supervisor may mark manager_approved at create (prefer approve flow instead)
  if (!['owner', 'manager', 'assistant_manager', 'supervisor'].includes(actorRole)) {
    managerApproved = false;
  }
  // Cash-ups from POS/close always start unapproved — managers confirm later
  if (data.force_pending) managerApproved = false;
  const actual = Number(data.actual_cash) || 0;
  const r = db.prepare(`INSERT INTO cashup_sessions (shift_id, user_id, branch_id, opening_cash, cash_sales, card_sales, eft_sales, mobile_sales, expenses, refunds, expected_cash, actual_cash, difference, manager_approved, notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    shiftId, actorId, getBranchId(), data.opening_cash || 0, data.cash_sales || 0, data.card_sales || 0,
    data.eft_sales || 0, data.mobile_sales || 0, data.expenses || 0, data.refunds || 0,
    expectedCash || 0, actual, actual - (expectedCash || 0),
    managerApproved ? 1 : 0, data.notes || null);
  if (!managerApproved) {
    try {
      const cashier = db.prepare('SELECT full_name FROM users WHERE id = ?').get(actorId);
      require('./store').addNotification('cashup', 'Cash-up pending approval',
        `${cashier?.full_name || 'Cashier'} submitted a cash-out — approve in Operations → Cash-Up.`, {
          entity_type: 'cashup',
          entity_id: r.lastInsertRowid,
          action_page: 'operations:cashup',
          audience_roles: ['owner', 'manager', 'assistant_manager', 'supervisor']
        });
    } catch (_) { /* ignore */ }
  }
  return r.lastInsertRowid;
}

function approveCashUp(id, actorId, notes) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM cashup_sessions WHERE id = ?').get(id);
  if (!row) throw new Error('Cash-up not found');
  if (Number(row.manager_approved) === 1) throw new Error('Cash-up already approved');
  try {
    db.prepare(`
      UPDATE cashup_sessions SET manager_approved=1, approved_by=?, approved_at=datetime('now'),
        approval_notes=?
      WHERE id=?
    `).run(actorId, notes || null, id);
  } catch (err) {
    // Older DBs without approval columns
    if (String(err.message || '').toLowerCase().includes('no such column')) {
      db.prepare('UPDATE cashup_sessions SET manager_approved=1 WHERE id=?').run(id);
    } else {
      throw err;
    }
  }
  try {
    const approver = db.prepare('SELECT full_name FROM users WHERE id = ?').get(actorId);
    require('./store').addNotification('cashup', 'Cash-up approved',
      `Cash-up #${id} approved by ${approver?.full_name || 'manager'}.`, {
        entity_type: 'cashup',
        entity_id: id,
        action_page: 'operations:cashup',
        audience_roles: ['owner', 'manager', 'assistant_manager', 'supervisor', 'cashier']
      });
  } catch (_) { /* ignore */ }
  return getCashUp(id);
}

function updateCashUp(id, data, actorId) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM cashup_sessions WHERE id = ?').get(id);
  if (!row) throw new Error('Cash-up not found');
  const actor = db.prepare('SELECT role FROM users WHERE id = ?').get(actorId);
  if (!['owner', 'manager', 'assistant_manager'].includes(actor?.role)) {
    throw new Error('Only owner or manager can edit cash-outs');
  }
  const opening = data.opening_cash != null ? Number(data.opening_cash) : Number(row.opening_cash) || 0;
  const expected = data.expected_cash != null ? Number(data.expected_cash) : Number(row.expected_cash) || 0;
  const actual = data.actual_cash != null ? Number(data.actual_cash) : Number(row.actual_cash) || 0;
  const notes = data.notes != null ? String(data.notes) : (row.notes || null);
  const difference = actual - expected;
  const amountsChanged = actual !== Number(row.actual_cash) || expected !== Number(row.expected_cash)
    || opening !== Number(row.opening_cash);
  try {
    db.prepare(`
      UPDATE cashup_sessions SET opening_cash=?, expected_cash=?, actual_cash=?, difference=?, notes=?,
        manager_approved = CASE WHEN ? THEN 0 ELSE manager_approved END,
        approved_by = CASE WHEN ? THEN NULL ELSE approved_by END,
        approved_at = CASE WHEN ? THEN NULL ELSE approved_at END
      WHERE id=?
    `).run(opening, expected, actual, difference, notes, amountsChanged ? 1 : 0, amountsChanged ? 1 : 0, amountsChanged ? 1 : 0, id);
  } catch (err) {
    if (String(err.message || '').toLowerCase().includes('no such column')) {
      db.prepare(`
        UPDATE cashup_sessions SET opening_cash=?, expected_cash=?, actual_cash=?, difference=?, notes=?,
          manager_approved = CASE WHEN ? THEN 0 ELSE manager_approved END
        WHERE id=?
      `).run(opening, expected, actual, difference, notes, amountsChanged ? 1 : 0, id);
    } else {
      throw err;
    }
  }
  try {
    require('./store').audit?.(actorId, actor?.role || 'manager', 'update_cashup', 'cashup', id, {
      expected, actual, difference, amountsChanged
    });
  } catch (_) { /* ignore */ }
  return getCashUp(id);
}

function deleteCashUp(id, actorId) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM cashup_sessions WHERE id = ?').get(id);
  if (!row) throw new Error('Cash-up not found');
  const actor = db.prepare('SELECT role FROM users WHERE id = ?').get(actorId);
  if (!['owner', 'manager', 'assistant_manager'].includes(actor?.role)) {
    throw new Error('Only owner or manager can delete cash-outs');
  }
  db.prepare('DELETE FROM cashup_sessions WHERE id = ?').run(id);
  try {
    require('./store').audit?.(actorId, actor?.role || 'manager', 'delete_cashup', 'cashup', id, {
      shift_id: row.shift_id, actual_cash: row.actual_cash
    });
  } catch (_) { /* ignore */ }
  return { success: true, id };
}

function getCashUp(id) {
  return getDb().prepare(`
    SELECT c.*, u.full_name as user_name, sh.opened_at as shift_opened_at, sh.closed_at as shift_closed_at,
      au.full_name as approved_by_name
    FROM cashup_sessions c
    LEFT JOIN users u ON c.user_id = u.id
    LEFT JOIN users au ON c.approved_by = au.id
    LEFT JOIN shifts sh ON c.shift_id = sh.id
    WHERE c.id = ?`).get(id);
}

function getCashUpByShift(shiftId) {
  if (!shiftId) return null;
  return getDb().prepare(`
    SELECT c.*, u.full_name as user_name, sh.opened_at as shift_opened_at, sh.closed_at as shift_closed_at,
      au.full_name as approved_by_name
    FROM cashup_sessions c
    LEFT JOIN users u ON c.user_id = u.id
    LEFT JOIN users au ON c.approved_by = au.id
    LEFT JOIN shifts sh ON c.shift_id = sh.id
    WHERE c.shift_id = ? ORDER BY c.created_at DESC LIMIT 1`).get(shiftId);
}

function getCashUps(limitOrFilters = 30) {
  const filters = typeof limitOrFilters === 'object' && limitOrFilters !== null
    ? limitOrFilters
    : { limit: limitOrFilters };
  let sql = `
    SELECT c.*, u.full_name as user_name, sh.opened_at as shift_opened_at, sh.closed_at as shift_closed_at,
      au.full_name as approved_by_name
    FROM cashup_sessions c
    LEFT JOIN users u ON c.user_id = u.id
    LEFT JOIN users au ON c.approved_by = au.id
    LEFT JOIN shifts sh ON c.shift_id = sh.id
    WHERE 1=1`;
  const params = [];
  if (filters.from) { sql += ' AND date(c.created_at) >= date(?)'; params.push(filters.from); }
  if (filters.to) { sql += ' AND date(c.created_at) <= date(?)'; params.push(filters.to); }
  if (filters.approved === true || filters.approved === 1) sql += ' AND c.manager_approved = 1';
  if (filters.approved === false || filters.approved === 0) sql += ' AND c.manager_approved = 0';
  sql += ' ORDER BY c.created_at DESC';
  const limit = Number(filters.limit) || 200;
  sql += ' LIMIT ?';
  params.push(limit);
  return getDb().prepare(sql).all(...params);
}

function buildCashUpPdf(cashupId, shopName, currency) {
  const cu = getCashUp(cashupId);
  if (!cu) throw new Error('Cash-out record not found');
  const c = currency || 'R';
  const fmt = (n) => `${c}${Number(n || 0).toFixed(2)}`;
  const headers = ['Field', 'Value'];
  const rows = [
    ['Cashier', cu.user_name || '—'],
    ['Shift opened', cu.shift_opened_at || '—'],
    ['Shift closed', cu.shift_closed_at || '—'],
    ['Recorded', cu.created_at || '—'],
    ['Opening cash', fmt(cu.opening_cash)],
    ['Cash sales', fmt(cu.cash_sales)],
    ['Card sales', fmt(cu.card_sales)],
    ['EFT sales', fmt(cu.eft_sales)],
    ['Mobile sales', fmt(cu.mobile_sales)],
    ['Expenses', fmt(cu.expenses)],
    ['Refunds', fmt(cu.refunds)],
    ['Expected cash', fmt(cu.expected_cash)],
    ['Actual cash', fmt(cu.actual_cash)],
    ['Difference', fmt(cu.difference)],
    ['Manager approved', cu.manager_approved ? 'Yes' : 'Pending'],
    ['Approved by', cu.approved_by_name || '—'],
    ['Approved at', cu.approved_at || '—'],
    ['Approval notes', cu.approval_notes || '—'],
    ['Notes', cu.notes || '—']
  ];
  return buildPdfBuffer('Shift Cash-Out', headers, rows, { shop_name: shopName });
}

function getCashUpSummary(from, to) {
  const db = getDb();
  return {
    sales: db.prepare(`SELECT COALESCE(SUM(total),0) as total, COUNT(*) as count FROM sales WHERE date(created_at) BETWEEN date(?) AND date(?) AND status='completed'`).get(from, to),
    cash: db.prepare(`SELECT COALESCE(SUM(sp.amount),0) as total FROM sale_payments sp JOIN sales s ON sp.sale_id=s.id WHERE sp.payment_type='cash' AND date(s.created_at) BETWEEN date(?) AND date(?)`).get(from, to),
    expenses: db.prepare(`SELECT COALESCE(SUM(amount),0) as total FROM expenses WHERE date(expense_date) BETWEEN date(?) AND date(?)`).get(from, to),
    refunds: db.prepare(`SELECT COALESCE(SUM(total_refund),0) as total FROM returns WHERE date(created_at) BETWEEN date(?) AND date(?)`).get(from, to)
  };
}

// ─── Automation Rules ───────────────────────────────────────────────────────

function getAutomationRules() {
  return getDb().prepare('SELECT * FROM automation_rules ORDER BY created_at DESC').all();
}

function saveAutomationRule(data) {
  if (data.id) {
    getDb().prepare('UPDATE automation_rules SET name=?, trigger_type=?, condition_json=?, action_json=?, is_active=? WHERE id=?')
      .run(data.name, data.trigger_type, JSON.stringify(data.condition || {}), JSON.stringify(data.action || {}), data.is_active ? 1 : 0, data.id);
    return data.id;
  }
  const r = getDb().prepare('INSERT INTO automation_rules (name, trigger_type, condition_json, action_json, is_active) VALUES (?,?,?,?,?)')
    .run(data.name, data.trigger_type, JSON.stringify(data.condition || {}), JSON.stringify(data.action || {}), data.is_active !== false ? 1 : 0);
  return r.lastInsertRowid;
}

function deleteAutomationRule(id) {
  getDb().prepare('DELETE FROM automation_rules WHERE id = ?').run(id);
}

function evaluateAutomation(triggerType, context) {
  const rules = getDb().prepare('SELECT * FROM automation_rules WHERE trigger_type = ? AND is_active = 1').all(triggerType);
  const results = [];
  const ctx = context || {};
  for (const rule of rules) {
    const cond = parseJson(rule.condition_json);
    const action = parseJson(rule.action_json);
    let match = true;
    if (cond.min_amount && Number(ctx.amount || 0) < Number(cond.min_amount)) match = false;
    if (cond.max_discount_pct && Number(ctx.discount_pct || 0) > Number(cond.max_discount_pct)) match = false;
    if (cond.min_stock != null && cond.min_stock !== '' && Number(ctx.stock) >= Number(cond.min_stock)) match = false;
    if (match) results.push({ rule: rule.name, action, trigger_type: triggerType });
  }
  return results;
}

// ─── Custom Fields ──────────────────────────────────────────────────────────

function getCustomFields(entityType) {
  return getDb().prepare('SELECT * FROM custom_fields WHERE entity_type = ? ORDER BY sort_order').all(entityType);
}

function saveCustomField(data) {
  if (data.id) {
    getDb().prepare('UPDATE custom_fields SET field_name=?, field_label=?, field_type=?, options_json=?, is_required=?, sort_order=? WHERE id=?')
      .run(data.field_name, data.field_label, data.field_type || 'text', JSON.stringify(data.options || []), data.is_required ? 1 : 0, data.sort_order || 0, data.id);
    return data.id;
  }
  const r = getDb().prepare('INSERT INTO custom_fields (entity_type, field_name, field_label, field_type, options_json, is_required, sort_order) VALUES (?,?,?,?,?,?,?)')
    .run(data.entity_type, data.field_name, data.field_label, data.field_type || 'text', JSON.stringify(data.options || []), data.is_required ? 1 : 0, data.sort_order || 0);
  return r.lastInsertRowid;
}

function deleteCustomField(id) {
  getDb().prepare('DELETE FROM custom_field_values WHERE field_id = ?').run(id);
  getDb().prepare('DELETE FROM custom_fields WHERE id = ?').run(id);
}

function getCustomFieldValues(entityType, entityId) {
  return getDb().prepare(`
    SELECT cf.id as field_id, cf.field_name, cf.field_label, cf.field_type, cf.is_required, cf.sort_order, cfv.value
    FROM custom_fields cf
    LEFT JOIN custom_field_values cfv ON cfv.field_id = cf.id AND cfv.entity_id = ?
    WHERE cf.entity_type = ? ORDER BY cf.sort_order, cf.id
  `).all(entityId, entityType);
}

function saveCustomFieldValues(entityType, entityId, values) {
  const db = getDb();
  const fields = getCustomFields(entityType);
  const map = values && typeof values === 'object' && !Array.isArray(values)
    ? values
    : Object.fromEntries((values || []).map(v => [String(v.field_id || v.field_name), v.value]));
  for (const f of fields) {
    const raw = map[f.id] ?? map[String(f.id)] ?? map[f.field_name];
    if (raw == null) continue;
    const existing = db.prepare('SELECT id FROM custom_field_values WHERE field_id = ? AND entity_id = ?').get(f.id, entityId);
    if (existing) db.prepare('UPDATE custom_field_values SET value = ? WHERE id = ?').run(String(raw), existing.id);
    else db.prepare('INSERT INTO custom_field_values (field_id, entity_id, value) VALUES (?,?,?)').run(f.id, entityId, String(raw));
  }
  return getCustomFieldValues(entityType, entityId);
}

// ─── Restaurant ─────────────────────────────────────────────────────────────

function getTables() {
  const db = getDb();
  const tables = db.prepare(`SELECT t.*, u.full_name as waiter_name FROM restaurant_tables t LEFT JOIN users u ON t.waiter_id = u.id ORDER BY t.table_number`).all();
  for (const t of tables) {
    const openKo = db.prepare(`
      SELECT 1 FROM kitchen_orders WHERE table_id = ? AND status NOT IN ('done', 'completed', 'cancelled') LIMIT 1
    `).get(t.id);
    t.has_open_order = !!openKo;
    t.is_occupied = t.status === 'occupied' || t.has_open_order;
  }
  return tables;
}

function deleteTable(id) {
  getDb().prepare('DELETE FROM restaurant_tables WHERE id = ?').run(id);
}

function getOrderTypeReport(from, to) {
  const db = getDb();
  try {
    const rows = db.prepare(`
      SELECT COALESCE(order_type, 'unknown') as order_type, COUNT(*) as orders, COALESCE(SUM(total), 0) as revenue
      FROM sales WHERE status = 'completed' AND date(created_at) BETWEEN date(?) AND date(?)
      GROUP BY COALESCE(order_type, 'unknown') ORDER BY revenue DESC
    `).all(from, to);
    const totals = db.prepare(`
      SELECT COUNT(*) as orders, COALESCE(SUM(total), 0) as revenue
      FROM sales WHERE status = 'completed' AND date(created_at) BETWEEN date(?) AND date(?)
    `).get(from, to);
    return { by_type: rows, totals: totals || { orders: 0, revenue: 0 } };
  } catch (err) {
    if (String(err.message || '').toLowerCase().includes('order_type')) {
      const rows = db.prepare(`
        SELECT 'unknown' as order_type, COUNT(*) as orders, COALESCE(SUM(total), 0) as revenue
        FROM sales WHERE status = 'completed' AND date(created_at) BETWEEN date(?) AND date(?)
      `).get(from, to);
      return {
        by_type: rows?.orders ? [{ order_type: 'unknown', orders: rows.orders, revenue: rows.revenue }] : [],
        totals: { orders: rows?.orders || 0, revenue: rows?.revenue || 0 }
      };
    }
    throw err;
  }
}

function saveTable(data) {
  if (data.id) {
    getDb().prepare('UPDATE restaurant_tables SET table_number=?, seats=?, status=?, waiter_id=?, notes=? WHERE id=?')
      .run(data.table_number, data.seats || 4, data.status || 'available', data.waiter_id || null, data.notes || null, data.id);
    return data.id;
  }
  const r = getDb().prepare('INSERT INTO restaurant_tables (table_number, seats, status, waiter_id, branch_id, notes) VALUES (?,?,?,?,?,?)')
    .run(data.table_number, data.seats || 4, data.status || 'available', data.waiter_id || null, getBranchId(), data.notes || null);
  return r.lastInsertRowid;
}

function getKitchenOrders(status) {
  let sql = `SELECT ko.*, rt.table_number FROM kitchen_orders ko LEFT JOIN restaurant_tables rt ON ko.table_id = rt.id WHERE 1=1`;
  const params = [];
  if (status) {
    if (String(status).includes(',')) {
      const statuses = String(status).split(',').map(s => s.trim()).filter(Boolean);
      sql += ` AND ko.status IN (${statuses.map(() => '?').join(',')})`;
      params.push(...statuses);
    } else {
      sql += ' AND ko.status = ?';
      params.push(status);
    }
  }
  sql += ' ORDER BY ko.created_at DESC LIMIT 50';
  const orders = getDb().prepare(sql).all(...params);
  if (!orders.length) return orders;
  const ids = orders.map((o) => o.id);
  const placeholders = ids.map(() => '?').join(',');
  const items = getDb().prepare(
    `SELECT * FROM kitchen_order_items WHERE kitchen_order_id IN (${placeholders}) ORDER BY id`
  ).all(...ids);
  const byOrder = {};
  for (const it of items) {
    if (!byOrder[it.kitchen_order_id]) byOrder[it.kitchen_order_id] = [];
    byOrder[it.kitchen_order_id].push(it);
  }
  for (const o of orders) {
    o.items = byOrder[o.id] || [];
  }
  return orders;
}

function updateKitchenOrderStatus(id, status) {
  // Schema: pending|preparing|ready|collection|completed|cancelled
  let st = String(status || 'pending');
  if (st === 'done') st = 'completed';
  const allowed = ['pending', 'preparing', 'ready', 'collection', 'completed', 'cancelled'];
  if (!allowed.includes(st)) st = 'pending';
  getDb().prepare(`UPDATE kitchen_orders SET status=?, updated_at=datetime('now') WHERE id=?`).run(st, id);
  return { id, status: st };
}

function createKitchenOrder(data, actorId) {
  const db = getDb();
  let orderNumber = data.order_number || null;
  if (!orderNumber && data.sale_id) {
    try {
      const sale = db.prepare('SELECT order_number, receipt_number FROM sales WHERE id = ?').get(data.sale_id);
      orderNumber = sale?.order_number || sale?.receipt_number || null;
    } catch (_) {}
  }
  if (!orderNumber) orderNumber = `KOT-${Date.now().toString(36).toUpperCase()}`;
  const r = db.prepare(`INSERT INTO kitchen_orders (order_number, sale_id, table_id, waiter_id, station, branch_id) VALUES (?,?,?,?,?,?)`)
    .run(orderNumber, data.sale_id || null, data.table_id || null, data.waiter_id || actorId, data.station || 'kitchen', getBranchId());
  for (const item of data.items || []) {
    db.prepare('INSERT INTO kitchen_order_items (kitchen_order_id, product_name, quantity, modifiers, notes) VALUES (?,?,?,?,?)')
      .run(r.lastInsertRowid, item.product_name, item.quantity, item.modifiers || null, item.notes || null);
  }
  return { id: r.lastInsertRowid, orderNumber };
}

// ─── Extended Reports ─────────────────────────────────────────────────────────

function getHourlySalesReport(from, to) {
  return getDb().prepare(`
    SELECT strftime('%H', created_at) as hour, COUNT(*) as transactions, SUM(total) as revenue
    FROM sales WHERE date(created_at) BETWEEN date(?) AND date(?) AND status='completed'
    GROUP BY hour ORDER BY hour`).all(from, to);
}

function getCategorySalesReport(from, to) {
  return getDb().prepare(`
    SELECT c.name as category, SUM(si.total) as revenue, SUM(si.quantity) as qty
    FROM sale_items si JOIN products p ON si.product_id=p.id LEFT JOIN categories c ON p.category_id=c.id
    JOIN sales s ON si.sale_id=s.id WHERE date(s.created_at) BETWEEN date(?) AND date(?) AND s.status='completed'
    GROUP BY c.name ORDER BY revenue DESC`).all(from, to);
}

function getBrandSalesReport(from, to) {
  return getDb().prepare(`
    SELECT p.brand, SUM(si.total) as revenue, SUM(si.quantity) as qty
    FROM sale_items si JOIN products p ON si.product_id=p.id
    JOIN sales s ON si.sale_id=s.id WHERE date(s.created_at) BETWEEN date(?) AND date(?) AND s.status='completed' AND p.brand IS NOT NULL
    GROUP BY p.brand ORDER BY revenue DESC`).all(from, to);
}

function getPaymentMethodReport(from, to) {
  return getDb().prepare(`
    SELECT sp.payment_type, COUNT(*) as count, SUM(sp.amount) as total
    FROM sale_payments sp JOIN sales s ON sp.sale_id=s.id
    WHERE date(s.created_at) BETWEEN date(?) AND date(?) GROUP BY sp.payment_type`).all(from, to);
}

function getEmployeePerformanceReport(from, to) {
  return getDb().prepare(`
    SELECT u.full_name, COUNT(s.id) as sales_count, SUM(s.total) as revenue
    FROM sales s JOIN users u ON s.user_id=u.id
    WHERE date(s.created_at) BETWEEN date(?) AND date(?) AND s.status='completed'
    GROUP BY u.id, u.full_name ORDER BY revenue DESC`).all(from, to);
}

function getDiscountReport(from, to) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT s.id, s.receipt_number, s.discount, s.total, s.subtotal, s.created_at, s.notes,
      s.order_type, s.order_source, u.full_name AS cashier_name,
      CASE WHEN s.order_type = 'online' OR UPPER(COALESCE(s.order_source, '')) = 'ONLINE' THEN 'Online'
           ELSE 'POS' END AS channel,
      (SELECT COALESCE(SUM(sp.amount), 0) FROM sale_payments sp
        WHERE sp.sale_id = s.id AND sp.payment_type = 'giftcard') AS gift_card_amount
    FROM sales s
    LEFT JOIN users u ON u.id = s.user_id
    WHERE s.status = 'completed'
      AND date(s.created_at) BETWEEN date(?) AND date(?)
      AND (
        COALESCE(s.discount, 0) > 0
        OR s.notes LIKE '%Coupon%'
        OR s.notes LIKE '%Loyalty%'
        OR s.notes LIKE '%Gift card%'
        OR EXISTS (SELECT 1 FROM sale_payments sp WHERE sp.sale_id = s.id AND sp.payment_type = 'giftcard' AND sp.amount > 0)
      )
    ORDER BY s.created_at DESC`).all(from, to);
  return rows.map((row) => {
    const giftAmt = Number(row.gift_card_amount) || 0;
    const notes = String(row.notes || '');
    let discountType = 'Cart discount';
    let authorizedBy = row.cashier_name || '—';
    let reportDiscount = Number(row.discount) || 0;
    if (row.channel === 'Online') {
      if (notes.includes('Coupon')) discountType = 'Online coupon';
      else if (notes.includes('Loyalty')) discountType = 'Online loyalty';
      else if (giftAmt > 0 || notes.includes('Gift card')) discountType = 'Online gift card';
      else discountType = 'Online order discount';
      authorizedBy = 'Online customer';
    } else if (giftAmt > 0 && reportDiscount <= giftAmt + 0.01) {
      discountType = 'Gift card (POS)';
      reportDiscount = giftAmt;
    } else if (notes.includes('Loyalty')) {
      discountType = 'Loyalty redemption';
    } else if (notes.includes('Coupon')) {
      discountType = 'Coupon';
    }
    if (giftAmt > 0 && row.channel === 'Online') reportDiscount = Math.max(reportDiscount, giftAmt);
    return {
      ...row,
      report_discount: Math.round(reportDiscount * 100) / 100,
      discount_type: discountType,
      authorized_by: authorizedBy,
      channel: row.channel || 'POS'
    };
  });
}

function getVoidReport(from, to) {
  return getDb().prepare(`
    SELECT receipt_number, total, void_reason, created_at FROM sales
    WHERE status IN ('void', 'voided') AND date(created_at) BETWEEN date(?) AND date(?) ORDER BY created_at DESC`).all(from, to);
}

function getStockMovementReport(from, to) {
  return getDb().prepare(`
    SELECT sm.*, p.name as product_name, u.full_name as user_name FROM stock_movements sm
    JOIN products p ON sm.product_id=p.id LEFT JOIN users u ON sm.user_id=u.id
    WHERE date(sm.created_at) BETWEEN date(?) AND date(?) ORDER BY sm.created_at DESC`).all(from, to);
}

function getProfitDashboard(from, to) {
  const db = getDb();
  const revenue = db.prepare(`SELECT COALESCE(SUM(total),0) as v FROM sales WHERE date(created_at) BETWEEN date(?) AND date(?) AND status='completed'`).get(from, to)?.v || 0;
  const cost = db.prepare(`
    SELECT COALESCE(SUM(si.quantity * si.buying_price),0) as v FROM sale_items si
    JOIN sales s ON si.sale_id=s.id WHERE date(s.created_at) BETWEEN date(?) AND date(?) AND s.status='completed'`).get(from, to)?.v || 0;
  const expenses = db.prepare(`SELECT COALESCE(SUM(amount),0) as v FROM expenses WHERE date(expense_date) BETWEEN date(?) AND date(?)`).get(from, to)?.v || 0;
  const profit = revenue - cost - expenses;
  const margin = revenue > 0 ? (profit / revenue * 100) : 0;
  return { revenue, cost, expenses, profit, margin };
}

// ─── Developer / License ────────────────────────────────────────────────────

function getDeveloperInfo() {
  let version = '2.3.2';
  try { version = require('../../package.json').version || version; } catch (_) { /* ignore */ }
  const settings = getDb().prepare('SELECT license_settings, device_settings FROM shop_settings WHERE id = 1').get();
  return {
    version,
    license: parseJson(settings?.license_settings),
    device: parseJson(settings?.device_settings),
    logs: getSystemLogs(20)
  };
}

function activateLicense(key) {
  getDb().prepare(`UPDATE shop_settings SET license_settings = ? WHERE id = 1`)
    .run(JSON.stringify({ key, activated_at: new Date().toISOString(), status: 'active' }));
  return { success: true };
}

function resetTrial() {
  getDb().prepare(`UPDATE shop_settings SET license_settings = ? WHERE id = 1`)
    .run(JSON.stringify({ status: 'trial', started_at: new Date().toISOString(), days: 30 }));
  return { success: true };
}

function generateSupervisorCode(actorId, purpose = 'void') {
  const today = new Date().toISOString().slice(0, 10);
  const code = String(Math.floor(100000 + Math.random() * 900000));
  getDb().prepare('DELETE FROM supervisor_codes WHERE code_date = ? AND purpose = ?').run(today, purpose);
  getDb().prepare('INSERT INTO supervisor_codes (code, code_date, purpose, created_by) VALUES (?,?,?,?)')
    .run(code, today, purpose, actorId);
  return { code, code_date: today, purpose };
}

function getTodaySupervisorCode(purpose = 'void') {
  const today = new Date().toISOString().slice(0, 10);
  return getDb().prepare('SELECT * FROM supervisor_codes WHERE code_date = ? AND purpose = ? ORDER BY id DESC LIMIT 1').get(today, purpose);
}

function verifySupervisorCode(code, purpose = 'void') {
  if (!code) throw new Error('Supervisor code required');
  const today = new Date().toISOString().slice(0, 10);
  const row = getDb().prepare('SELECT * FROM supervisor_codes WHERE code = ? AND code_date = ? AND purpose = ?').get(code, today, purpose);
  if (row) return { valid: true, type: 'daily_code' };
  try {
    const mgr = require('./audit').verifyManagerPin(code);
    return { valid: true, type: 'manager_pin', user: mgr };
  } catch {
    throw new Error('Invalid supervisor code — ask admin for today\'s code');
  }
}

function submitSettingsChangeRequest(data, actorId, actorName) {
  const r = getDb().prepare(`
    INSERT INTO settings_change_requests (requested_by, requested_by_name, settings_json, status)
    VALUES (?, ?, ?, 'pending')
  `).run(actorId, actorName, JSON.stringify(data));
  try {
    getDb().prepare(`INSERT INTO notifications (type, title, message) VALUES (?, ?, ?)`)
      .run('settings', 'Settings approval needed',
        `${actorName || 'User'} submitted shop settings changes — review in Admin → Settings Approvals.`);
  } catch (_) { /* notifications optional */ }
  return { id: r.lastInsertRowid, pending_approval: true };
}

function getPendingSettingsRequests() {
  return getDb().prepare(`
    SELECT * FROM settings_change_requests WHERE status = 'pending' ORDER BY created_at DESC
  `).all();
}

function getSettingsRequestHistory(limit = 20) {
  return getDb().prepare(`
    SELECT * FROM settings_change_requests ORDER BY created_at DESC LIMIT ?
  `).all(limit);
}

function approveSettingsRequest(id, actorId, actorName) {
  const db = getDb();
  const req = db.prepare('SELECT * FROM settings_change_requests WHERE id = ? AND status = ?').get(id, 'pending');
  if (!req) throw new Error('Request not found or already processed');
  const data = typeof req.settings_json === 'string' ? parseJson(req.settings_json) : (req.settings_json || {});
  if (!data || !Object.keys(data).length) throw new Error('Settings request has no changes to apply');
  const { saveSettings } = require('./store');
  saveSettings(data, actorId, actorName);
  db.prepare(`
    UPDATE settings_change_requests SET status = 'approved', reviewed_by = ?, reviewed_by_name = ?, reviewed_at = datetime('now')
    WHERE id = ?
  `).run(actorId, actorName, id);
  try {
    db.prepare(`INSERT INTO notifications (type, title, message) VALUES (?, ?, ?)`)
      .run('settings', 'Settings approved', `Settings requested by ${req.requested_by_name || 'user'} were approved and applied.`);
  } catch (_) { /* ignore */ }
  return { success: true, applied: data };
}

function rejectSettingsRequest(id, actorId, actorName, notes) {
  const db = getDb();
  const req = db.prepare('SELECT * FROM settings_change_requests WHERE id = ? AND status = ?').get(id, 'pending');
  if (!req) throw new Error('Request not found or already processed');
  db.prepare(`
    UPDATE settings_change_requests SET status = 'rejected', reviewed_by = ?, reviewed_by_name = ?, review_notes = ?, reviewed_at = datetime('now')
    WHERE id = ?
  `).run(actorId, actorName, notes || null, id);
  return { success: true };
}

function updateSettingsRequest(id, settingsData, actorId, actorName) {
  const db = getDb();
  const req = db.prepare('SELECT * FROM settings_change_requests WHERE id = ?').get(id);
  if (!req) throw new Error('Request not found');
  if (req.status !== 'pending') throw new Error('Only pending settings requests can be edited');
  const data = typeof settingsData === 'string' ? settingsData : JSON.stringify(settingsData || {});
  db.prepare(`
    UPDATE settings_change_requests SET settings_json = ?, requested_by_name = COALESCE(?, requested_by_name)
    WHERE id = ?
  `).run(data, actorName || null, id);
  return db.prepare('SELECT * FROM settings_change_requests WHERE id = ?').get(id);
}

function deleteSettingsRequest(id) {
  const db = getDb();
  const req = db.prepare('SELECT * FROM settings_change_requests WHERE id = ?').get(id);
  if (!req) throw new Error('Request not found');
  db.prepare('DELETE FROM settings_change_requests WHERE id = ?').run(id);
  return true;
}

function getGiftCardReport(from, to) {
  return getDb().prepare(`
    SELECT g.code, g.initial_value, g.balance, g.status, g.created_at,
      COALESCE((SELECT SUM(ABS(amount)) FROM gift_card_transactions t WHERE t.gift_card_id = g.id AND t.type = 'redeem' AND date(t.created_at) BETWEEN date(?) AND date(?)), 0) as redeemed
    FROM gift_cards g ORDER BY g.created_at DESC
  `).all(from, to);
}

function getLaybyReport(from, to) {
  return getDb().prepare(`
    SELECT l.layby_number, c.name as customer_name, l.total, l.amount_paid, l.balance, l.status, l.created_at
    FROM laybyes l LEFT JOIN customers c ON l.customer_id = c.id
    WHERE date(l.created_at) BETWEEN date(?) AND date(?) ORDER BY l.created_at DESC
  `).all(from, to);
}

function getQuotesReport(from, to) {
  return getDb().prepare(`
    SELECT q.quote_number, c.name as customer_name, q.total, q.status, q.created_at
    FROM quotes q LEFT JOIN customers c ON q.customer_id = c.id
    WHERE date(q.created_at) BETWEEN date(?) AND date(?) ORDER BY q.created_at DESC
  `).all(from, to);
}

function getOnAccountReport(from, to) {
  return getDb().prepare(`
    SELECT c.name, c.phone, c.balance,
      COALESCE((SELECT SUM(amount) FROM customer_credit_ledger cl WHERE cl.customer_id = c.id AND cl.type = 'charge' AND date(cl.created_at) BETWEEN date(?) AND date(?)), 0) as charged,
      COALESCE((SELECT SUM(ABS(amount)) FROM customer_credit_ledger cl WHERE cl.customer_id = c.id AND cl.type = 'payment' AND date(cl.created_at) BETWEEN date(?) AND date(?)), 0) as paid
    FROM customers c WHERE c.balance != 0 OR EXISTS (SELECT 1 FROM customer_credit_ledger cl WHERE cl.customer_id = c.id AND date(cl.created_at) BETWEEN date(?) AND date(?))
    ORDER BY c.balance DESC
  `).all(from, to, from, to, from, to);
}

function getCashUpReport(from, to) {
  return getDb().prepare(`
    SELECT cu.id, cu.created_at, u.full_name as user_name, cu.opening_cash, cu.expected_cash, cu.actual_cash, cu.difference as variance, cu.notes
    FROM cashup_sessions cu LEFT JOIN users u ON cu.user_id = u.id
    WHERE date(cu.created_at) BETWEEN date(?) AND date(?) ORDER BY cu.created_at DESC
  `).all(from, to);
}

module.exports = {
  log, getBranchId,
  getDatabaseHealth, optimizeDatabase, repairDatabase, resetDemoData, archiveOldRecords, getSystemLogs, recalculateStock,
  getQuotes, getQuote, saveQuote, deleteQuote, convertQuoteToSale, markQuoteConverted, reactivateQuote, getQuoteExpirySettings, buildQuotePdf,
  getLaybyes, getLayby, createLayby, addLaybyPayment, refundLayby, getLaybySettings, saveLaybySettings,
  getGiftCards, createGiftCard, updateGiftCard, deleteGiftCard, redeemGiftCard, checkGiftCardBalance,
  approveGiftCard, rejectGiftCard, getGiftCardSettings, saveGiftCardSettings,
  earnLoyaltyPoints, redeemLoyaltyPoints, reverseSaleBenefits, getLoyaltyHistory, getLoyaltySettings, calcLoyaltyRedemption,
  addCustomerCreditCharge, addCustomerCreditPayment, getCustomerCreditLedger,
  getStockCounts, createStockCount, updateStockCountLine, completeStockCount, getStockCount,
  recordWaste, getWasteRecords, approveWaste, rejectWaste, returnWasteToStock,
  receivePurchaseOrderPartial,
  createCashUp, hasCashUpForShift, getCashUp, getCashUpByShift, getCashUps, getCashUpSummary, buildCashUpPdf, approveCashUp, updateCashUp, deleteCashUp,
  getAutomationRules, saveAutomationRule, deleteAutomationRule, evaluateAutomation,
  getCustomFields, saveCustomField, deleteCustomField, getCustomFieldValues, saveCustomFieldValues,
  getTables, saveTable, getKitchenOrders, updateKitchenOrderStatus, createKitchenOrder,
  getHourlySalesReport, getCategorySalesReport, getBrandSalesReport, getPaymentMethodReport,
  getEmployeePerformanceReport, getDiscountReport, getVoidReport, getStockMovementReport, getProfitDashboard,
  getOrderTypeReport, deleteTable,
  getDeveloperInfo, activateLicense, resetTrial,
  generateSupervisorCode, getTodaySupervisorCode, verifySupervisorCode,
  submitSettingsChangeRequest, getPendingSettingsRequests, getSettingsRequestHistory,
  approveSettingsRequest, rejectSettingsRequest, updateSettingsRequest, deleteSettingsRequest,
  getGiftCardReport, getLaybyReport, getQuotesReport, getOnAccountReport, getCashUpReport
};

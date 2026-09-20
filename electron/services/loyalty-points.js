/**
 * Loyalty point lots — expiry, FIFO redemption, reminders, message templates.
 */
const { getDb } = require('../database/db');

const DEFAULT_GIFT_TEMPLATE = `Hi {{CustomerName}},

Great news from {{ShopName}}!

We have added {{PointsAdded}} loyalty points to your account (worth {{PointsAddedValue}}).

Your total balance is now {{PointsBalance}} points (worth {{PointsBalanceValue}}).

Please use your points before {{ExpiryDate}} — you have {{DaysRemaining}} day(s) remaining.

Order online anytime: {{OrderOnlineLink}}

Thank you for choosing {{ShopName}}. We look forward to serving you again!`;

const DEFAULT_REMINDER_TEMPLATE = `Hi {{CustomerName}},

This is a friendly reminder from {{ShopName}}.

You currently have {{PointsBalance}} loyalty points (worth {{PointsBalanceValue}}).

{{DaysRemaining}} day(s) remain before {{PointsExpiring}} points expire on {{ExpiryDate}}.

Visit us in-store or order online: {{OrderOnlineLink}}

Do not miss out — come claim your reward!

Warm regards,
{{ShopName}}`;

let _schemaReady = false;

function ensureSchema() {
  if (_schemaReady) return;
  const db = getDb();
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS loyalty_point_lots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER NOT NULL,
        transaction_id INTEGER,
        points_remaining REAL NOT NULL,
        points_original REAL NOT NULL,
        earned_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        last_reminder_at TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_loyalty_lots_customer ON loyalty_point_lots(customer_id, expires_at);
      CREATE INDEX IF NOT EXISTS idx_loyalty_lots_expiry ON loyalty_point_lots(expires_at);
    `);
  } catch (_) { /* PG may already have table from migration */ }
  _schemaReady = true;
}

function parseJson(val, fallback = {}) {
  if (!val) return fallback;
  try { return typeof val === 'string' ? JSON.parse(val) : val; } catch { return fallback; }
}

function getExtendedLoyaltySettings() {
  const row = getDb().prepare('SELECT loyalty_settings, shop_name FROM shop_settings WHERE id = 1').get() || {};
  const raw = parseJson(row.loyalty_settings, {});
  const pointValue = Number(raw.point_value) > 0 ? Number(raw.point_value) : 1;
  const expiry = resolveExpiryConfig(raw);
  return {
    enabled: raw.enabled !== false,
    spend_amount: Number(raw.spend_amount) > 0 ? Number(raw.spend_amount) : 10,
    points_earned: Number(raw.points_earned) > 0 ? Number(raw.points_earned) : 1,
    min_sale_total: Number(raw.min_sale_total) || 0,
    point_value: pointValue,
    expiry_period_value: expiry.value,
    expiry_period_unit: expiry.unit,
    points_expiry_days: expiry.daysApprox,
    reminder_interval_days: Math.max(1, Math.floor(Number(raw.reminder_interval_days) ?? 3)),
    expiry_enabled: raw.expiry_enabled !== false,
    gift_message_template: String(raw.gift_message_template || '').trim() || DEFAULT_GIFT_TEMPLATE,
    reminder_message_template: String(raw.reminder_message_template || '').trim() || DEFAULT_REMINDER_TEMPLATE,
    shop_name: row.shop_name || 'Our shop'
  };
}

/** Resolve expiry period from settings (days or months). Backward compatible with points_expiry_days. */
function resolveExpiryConfig(raw = {}) {
  const unit = raw.expiry_period_unit === 'months' ? 'months' : 'days';
  let value;
  if (raw.expiry_period_value != null && Number(raw.expiry_period_value) > 0) {
    value = Math.max(1, Math.floor(Number(raw.expiry_period_value)));
  } else {
    value = Math.max(1, Math.floor(Number(raw.points_expiry_days) ?? 30));
  }
  const daysApprox = unit === 'months' ? value * 30 : value;
  return { unit, value, daysApprox };
}

function isoNow() {
  return new Date().toISOString();
}

function computeExpiresAt(fromDate, config) {
  const d = fromDate instanceof Date ? new Date(fromDate.getTime()) : new Date(fromDate || Date.now());
  const v = Math.max(1, Math.floor(Number(config?.value) || 30));
  const unit = config?.unit === 'months' ? 'months' : 'days';
  if (unit === 'months') {
    d.setMonth(d.getMonth() + v);
  } else {
    d.setDate(d.getDate() + v);
  }
  return d.toISOString();
}

function addDaysIso(days) {
  return computeExpiresAt(new Date(), { unit: 'days', value: Math.max(1, Number(days) || 0) });
}

function daysUntil(isoDate) {
  if (!isoDate) return null;
  const end = new Date(isoDate);
  if (Number.isNaN(end.getTime())) return null;
  const diff = end.getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / 86400000));
}

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch {
    return String(iso).slice(0, 10);
  }
}

function getOrderOnlineLink() {
  try {
    const { getPublicUrl } = require('../../lib/public-url');
    const base = getPublicUrl();
    return `${base.replace(/\/$/, '')}/order/`;
  } catch {
    return '';
  }
}

function moneyValue(points, pointValue, currency) {
  const c = currency || 'R';
  return `${c}${(Math.floor(Number(points) || 0) * Number(pointValue || 1)).toFixed(2)}`;
}

function buildMessageVars(customer, opts = {}) {
  const settings = getExtendedLoyaltySettings();
  const currency = opts.currency || 'R';
  const balance = Math.floor(Number(opts.balance ?? customer?.loyalty_points) || 0);
  const delta = Math.floor(Number(opts.delta) || 0);
  const expiry = opts.expires_at || opts.nearest_expiry || null;
  const daysRem = expiry ? daysUntil(expiry) : null;
  const first = String(customer?.name || 'Customer').trim().split(/\s+/)[0] || 'Customer';
  return {
    CustomerName: first,
    FullName: customer?.name || 'Customer',
    ShopName: settings.shop_name,
    PointsAdded: String(Math.abs(delta)),
    PointsAddedValue: moneyValue(Math.abs(delta), settings.point_value, currency),
    PointsBalance: String(balance),
    PointsBalanceValue: moneyValue(balance, settings.point_value, currency),
    PointsExpiring: String(Math.floor(Number(opts.points_expiring) || 0)),
    ExpiryDate: formatDate(expiry),
    DaysRemaining: daysRem != null ? String(daysRem) : '—',
    OrderOnlineLink: getOrderOnlineLink(),
    PointValue: String(settings.point_value)
  };
}

function renderTemplate(template, vars) {
  let out = String(template || '');
  for (const [key, val] of Object.entries(vars || {})) {
    out = out.split(`{{${key}}}`).join(String(val ?? ''));
  }
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

function buildGiftMessage(customer, delta, balance, opts = {}) {
  const settings = getExtendedLoyaltySettings();
  const vars = buildMessageVars(customer, { ...opts, delta, balance });
  return renderTemplate(settings.gift_message_template, vars);
}

function buildReminderMessage(customer, opts = {}) {
  const settings = getExtendedLoyaltySettings();
  const vars = buildMessageVars(customer, opts);
  return renderTemplate(settings.reminder_message_template, vars);
}

function addPointLot(customerId, points, transactionId, expiryOverride) {
  ensureSchema();
  const settings = getExtendedLoyaltySettings();
  const pts = Math.floor(Number(points) || 0);
  if (pts <= 0) return null;
  if (!settings.expiry_enabled) return null;
  let expiryConfig;
  if (expiryOverride != null && typeof expiryOverride === 'object') {
    expiryConfig = resolveExpiryConfig(expiryOverride);
  } else if (expiryOverride != null) {
    expiryConfig = { unit: 'days', value: Math.max(1, Math.floor(Number(expiryOverride))), daysApprox: Math.max(1, Math.floor(Number(expiryOverride))) };
  } else {
    expiryConfig = resolveExpiryConfig(settings);
  }
  const now = isoNow();
  const earnedAt = new Date();
  const expiresAt = computeExpiresAt(earnedAt, expiryConfig);
  const db = getDb();
  const r = db.prepare(`INSERT INTO loyalty_point_lots
    (customer_id, transaction_id, points_remaining, points_original, earned_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run(customerId, transactionId || null, pts, pts, now, expiresAt);
  return {
    lot_id: r.lastInsertRowid,
    expires_at: expiresAt,
    expiry_days: expiryConfig.daysApprox,
    expiry_period_value: expiryConfig.value,
    expiry_period_unit: expiryConfig.unit
  };
}

function consumeLotsFifo(customerId, points) {
  ensureSchema();
  let remaining = Math.floor(Number(points) || 0);
  if (remaining <= 0) return;
  const db = getDb();
  const lots = db.prepare(`
    SELECT id, points_remaining FROM loyalty_point_lots
    WHERE customer_id = ? AND points_remaining > 0
    ORDER BY expires_at ASC, id ASC`).all(customerId);
  for (const lot of lots) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, Math.floor(Number(lot.points_remaining) || 0));
    if (take <= 0) continue;
    const left = Math.floor(Number(lot.points_remaining) - take);
    db.prepare('UPDATE loyalty_point_lots SET points_remaining = ? WHERE id = ?').run(left, lot.id);
    remaining -= take;
  }
}

function getCustomerPointsSummary(customerId) {
  ensureSchema();
  const db = getDb();
  const customer = db.prepare('SELECT id, name, phone, email, loyalty_points FROM customers WHERE id = ?').get(customerId);
  if (!customer) return null;
  const balance = Math.floor(Number(customer.loyalty_points) || 0);
  const lots = db.prepare(`
    SELECT id, points_remaining, points_original, earned_at, expires_at, last_reminder_at
    FROM loyalty_point_lots WHERE customer_id = ? AND points_remaining > 0
    ORDER BY expires_at ASC`).all(customerId);
  const activeLots = lots.map((l) => ({
    ...l,
    points_remaining: Math.floor(Number(l.points_remaining) || 0),
    days_remaining: daysUntil(l.expires_at)
  }));
  const nearest = activeLots[0] || null;
  const expiringSoon = activeLots.filter((l) => l.days_remaining != null && l.days_remaining <= 14);
  return {
    customer,
    balance,
    active_lots: activeLots,
    nearest_expiry: nearest?.expires_at || null,
    days_until_expiry: nearest ? nearest.days_remaining : null,
    points_expiring_next: nearest ? nearest.points_remaining : 0,
    expiring_soon_count: expiringSoon.length
  };
}

function expireDueLots() {
  ensureSchema();
  const settings = getExtendedLoyaltySettings();
  if (!settings.expiry_enabled) return { expired_customers: 0, expired_points: 0 };
  const db = getDb();
  const now = isoNow();
  const due = db.prepare(`
    SELECT l.*, c.loyalty_points, c.name FROM loyalty_point_lots l
    JOIN customers c ON c.id = l.customer_id
    WHERE l.points_remaining > 0 AND l.expires_at <= ?
    ORDER BY l.customer_id, l.id`).all(now);
  let expiredPoints = 0;
  const byCustomer = new Map();
  for (const lot of due) {
    const pts = Math.floor(Number(lot.points_remaining) || 0);
    if (pts <= 0) continue;
    expiredPoints += pts;
    db.prepare('UPDATE loyalty_point_lots SET points_remaining = 0 WHERE id = ?').run(lot.id);
    const cur = byCustomer.get(lot.customer_id) || { name: lot.name, points: 0 };
    cur.points += pts;
    byCustomer.set(lot.customer_id, cur);
  }
  for (const [customerId, info] of byCustomer) {
    const current = Math.floor(Number(db.prepare('SELECT loyalty_points FROM customers WHERE id = ?').get(customerId)?.loyalty_points) || 0);
    const next = Math.max(0, current - info.points);
    db.prepare('UPDATE customers SET loyalty_points = ?, updated_at = datetime(\'now\') WHERE id = ?').run(next, customerId);
    try { db.prepare('UPDATE web_customers SET loyalty_points = ? WHERE customer_id = ?').run(next, customerId); } catch (_) { /* optional */ }
    db.prepare(`INSERT INTO loyalty_transactions (customer_id, points, type, notes)
      VALUES (?, ?, 'expire', ?)`).run(customerId, -info.points, `Expired ${info.points} points`);
  }
  return { expired_customers: byCustomer.size, expired_points: expiredPoints };
}

function listCustomersNeedingReminder() {
  ensureSchema();
  const settings = getExtendedLoyaltySettings();
  if (!settings.expiry_enabled || settings.points_expiry_days <= 0) return [];
  const db = getDb();
  const now = isoNow();
  const intervalDays = settings.reminder_interval_days;
  const rows = db.prepare(`
    SELECT l.id AS lot_id, l.customer_id, l.points_remaining, l.expires_at, l.last_reminder_at,
      c.name, c.phone, c.email, c.loyalty_points
    FROM loyalty_point_lots l
    JOIN customers c ON c.id = l.customer_id
    WHERE l.points_remaining > 0 AND l.expires_at > ?
      AND c.phone IS NOT NULL AND TRIM(c.phone) != ''
    ORDER BY l.expires_at ASC`).all(now);
  const due = [];
  const seen = new Set();
  for (const row of rows) {
    const daysRem = daysUntil(row.expires_at);
    if (daysRem == null) continue;
    const last = row.last_reminder_at ? new Date(row.last_reminder_at) : null;
    const daysSinceReminder = last && !Number.isNaN(last.getTime())
      ? Math.floor((Date.now() - last.getTime()) / 86400000)
      : intervalDays;
    if (daysSinceReminder < intervalDays) continue;
    const key = `${row.customer_id}:${row.lot_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    due.push({
      ...row,
      points_remaining: Math.floor(Number(row.points_remaining) || 0),
      days_remaining: daysRem,
      balance: Math.floor(Number(row.loyalty_points) || 0)
    });
  }
  return due;
}

function markLotReminderSent(lotId) {
  ensureSchema();
  getDb().prepare('UPDATE loyalty_point_lots SET last_reminder_at = ? WHERE id = ?').run(isoNow(), lotId);
}

/** Remove point lots tied to loyalty transactions for a sale (required before deleting transactions). */
function purgeLotsForSale(saleId) {
  ensureSchema();
  const id = Number(saleId);
  if (!id) return;
  try {
    getDb().prepare(`
      DELETE FROM loyalty_point_lots
      WHERE transaction_id IN (SELECT id FROM loyalty_transactions WHERE sale_id = ?)
    `).run(id);
  } catch (_) { /* optional */ }
}

function purgeLotsForCustomer(customerId) {
  ensureSchema();
  const id = Number(customerId);
  if (!id) return;
  try {
    getDb().prepare('DELETE FROM loyalty_point_lots WHERE customer_id = ?').run(id);
  } catch (_) { /* optional */ }
}

function ensureLoyaltyReminderNotifications(addNotification) {
  if (typeof addNotification !== 'function') return { count: 0 };
  const due = listCustomersNeedingReminder();
  for (const row of due) {
    const msg = `${row.name} — ${row.points_remaining} pts expire in ${row.days_remaining} day(s) (${formatDate(row.expires_at)})`;
    addNotification('loyalty_reminder', 'Loyalty Points Reminder', msg, {
      entity_type: 'customer',
      entity_id: row.customer_id,
      action_page: `loyalty:whatsapp:${row.customer_id}:${row.lot_id}`,
      audience_roles: 'owner,manager,assistant_manager,supervisor'
    });
  }
  if (due.length > 1) {
    addNotification('loyalty_reminder_summary', 'Loyalty Reminders Due',
      `${due.length} customers need loyalty point expiry reminders today. Open notifications to message them on WhatsApp.`,
      { action_page: 'admin:loyalty', audience_roles: 'owner,manager,assistant_manager,supervisor' });
  }
  return { count: due.length };
}

const RESTORE_REF_PREFIX = 'ref expire:';

function restoreRefNote(expireTxnId) {
  return `Admin restored expired points (${RESTORE_REF_PREFIX}${expireTxnId})`;
}

function isExpireTxnRestored(expireTxnId, customerId) {
  const db = getDb();
  const pattern = `%${RESTORE_REF_PREFIX}${Number(expireTxnId)}%`;
  return !!db.prepare(`
    SELECT id FROM loyalty_transactions
    WHERE customer_id = ? AND type = 'adjust' AND points > 0 AND notes LIKE ?
    LIMIT 1
  `).get(Number(customerId), pattern);
}

/** Expire transactions that have not yet been manually restored by admin. */
function listRestorableExpiredPoints(opts = {}) {
  ensureSchema();
  const db = getDb();
  const limit = Math.min(Math.max(1, Number(opts.limit) || 100), 500);
  const customerId = opts.customerId ? Number(opts.customerId) : null;
  let sql = `
    SELECT e.id, e.customer_id, ABS(e.points) AS points_expired, e.created_at, e.notes AS expire_notes,
      c.name AS customer_name, c.phone, c.loyalty_points AS current_balance
    FROM loyalty_transactions e
    JOIN customers c ON c.id = e.customer_id
    WHERE e.type = 'expire' AND e.points < 0
  `;
  const params = [];
  if (customerId) {
    sql += ' AND e.customer_id = ?';
    params.push(customerId);
  }
  sql += ' ORDER BY e.created_at DESC LIMIT ?';
  params.push(limit * 4);
  const rows = db.prepare(sql).all(...params);
  const out = [];
  for (const row of rows) {
    if (isExpireTxnRestored(row.id, row.customer_id)) continue;
    out.push({
      ...row,
      points_expired: Math.floor(Number(row.points_expired) || 0)
    });
    if (out.length >= limit) break;
  }
  return out;
}

/** Owner/admin manual restore of a specific expired-points ledger entry. */
function restoreExpiredPoints(expireTransactionId, actorName) {
  ensureSchema();
  const db = getDb();
  const expireId = Number(expireTransactionId);
  if (!expireId) throw new Error('Expire transaction id is required');

  const ex = db.prepare(`
    SELECT id, customer_id, points, created_at, notes FROM loyalty_transactions
    WHERE id = ? AND type = 'expire' AND points < 0
  `).get(expireId);
  if (!ex) throw new Error('Expired points record not found');

  const pts = Math.floor(Math.abs(Number(ex.points) || 0));
  if (!pts) throw new Error('Nothing to restore');
  if (isExpireTxnRestored(ex.id, ex.customer_id)) {
    throw new Error('These points were already restored');
  }

  const customer = db.prepare('SELECT id, name, phone, email, loyalty_points FROM customers WHERE id = ?').get(ex.customer_id);
  if (!customer) throw new Error('Customer not found');

  const current = Math.floor(Number(customer.loyalty_points) || 0);
  const next = current + pts;
  db.prepare('UPDATE customers SET loyalty_points = ?, updated_at = datetime(\'now\') WHERE id = ?').run(next, ex.customer_id);

  const actorSuffix = actorName ? ` by ${String(actorName).trim()}` : '';
  const note = restoreRefNote(ex.id) + actorSuffix;
  const txn = db.prepare(`INSERT INTO loyalty_transactions (customer_id, points, type, notes)
    VALUES (?, ?, 'adjust', ?)`).run(ex.customer_id, pts, note);

  let lotInfo = null;
  const settings = getExtendedLoyaltySettings();
  if (settings.expiry_enabled) {
    lotInfo = addPointLot(ex.customer_id, pts, txn.lastInsertRowid);
  }
  try {
    db.prepare('UPDATE web_customers SET loyalty_points = ? WHERE customer_id = ?').run(next, ex.customer_id);
  } catch (_) { /* optional */ }

  const summary = getCustomerPointsSummary(ex.customer_id);
  return {
    customer_id: ex.customer_id,
    name: customer.name,
    expire_transaction_id: ex.id,
    points_restored: pts,
    previous_balance: current,
    balance: next,
    expires_at: lotInfo?.expires_at || summary?.nearest_expiry || null,
    days_until_expiry: lotInfo?.expires_at ? daysUntil(lotInfo.expires_at) : summary?.days_until_expiry ?? null,
    expiry_period_value: settings.expiry_period_value,
    expiry_period_unit: settings.expiry_period_unit
  };
}

function getReminderWhatsAppPayload(customerId, lotId) {
  const summary = getCustomerPointsSummary(customerId);
  if (!summary?.customer) throw new Error('Customer not found');
  const lot = summary.active_lots.find((l) => String(l.id) === String(lotId)) || summary.active_lots[0];
  if (!lot) throw new Error('No active point balance with expiry');
  const message = buildReminderMessage(summary.customer, {
    balance: summary.balance,
    expires_at: lot.expires_at,
    points_expiring: lot.points_remaining
  });
  return {
    customer: summary.customer,
    lot_id: lot.id,
    phone: summary.customer.phone,
    message
  };
}

module.exports = {
  DEFAULT_GIFT_TEMPLATE,
  DEFAULT_REMINDER_TEMPLATE,
  ensureSchema,
  getExtendedLoyaltySettings,
  resolveExpiryConfig,
  computeExpiresAt,
  buildGiftMessage,
  buildReminderMessage,
  renderTemplate,
  buildMessageVars,
  addPointLot,
  consumeLotsFifo,
  getCustomerPointsSummary,
  expireDueLots,
  listCustomersNeedingReminder,
  markLotReminderSent,
  purgeLotsForSale,
  purgeLotsForCustomer,
  ensureLoyaltyReminderNotifications,
  getReminderWhatsAppPayload,
  listRestorableExpiredPoints,
  restoreExpiredPoints,
  isExpireTxnRestored,
  daysUntil,
  formatDate
};

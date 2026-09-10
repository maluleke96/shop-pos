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
  return {
    enabled: raw.enabled !== false,
    spend_amount: Number(raw.spend_amount) > 0 ? Number(raw.spend_amount) : 10,
    points_earned: Number(raw.points_earned) > 0 ? Number(raw.points_earned) : 1,
    min_sale_total: Number(raw.min_sale_total) || 0,
    point_value: pointValue,
    points_expiry_days: Math.max(0, Math.floor(Number(raw.points_expiry_days) ?? 30)),
    reminder_interval_days: Math.max(1, Math.floor(Number(raw.reminder_interval_days) ?? 3)),
    expiry_enabled: raw.expiry_enabled !== false,
    gift_message_template: String(raw.gift_message_template || '').trim() || DEFAULT_GIFT_TEMPLATE,
    reminder_message_template: String(raw.reminder_message_template || '').trim() || DEFAULT_REMINDER_TEMPLATE,
    shop_name: row.shop_name || 'Our shop'
  };
}

function isoNow() {
  return new Date().toISOString();
}

function addDaysIso(days) {
  const d = new Date();
  d.setDate(d.getDate() + Math.max(0, Number(days) || 0));
  return d.toISOString();
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

function addPointLot(customerId, points, transactionId, expiryDaysOverride) {
  ensureSchema();
  const settings = getExtendedLoyaltySettings();
  const pts = Math.floor(Number(points) || 0);
  if (pts <= 0) return null;
  const expiryDays = expiryDaysOverride != null
    ? Math.max(0, Math.floor(Number(expiryDaysOverride)))
    : settings.points_expiry_days;
  if (!settings.expiry_enabled || expiryDays <= 0) return null;
  const now = isoNow();
  const expiresAt = addDaysIso(expiryDays);
  const db = getDb();
  const r = db.prepare(`INSERT INTO loyalty_point_lots
    (customer_id, transaction_id, points_remaining, points_original, earned_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run(customerId, transactionId || null, pts, pts, now, expiresAt);
  return { lot_id: r.lastInsertRowid, expires_at: expiresAt, expiry_days: expiryDays };
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
  ensureLoyaltyReminderNotifications,
  getReminderWhatsAppPayload,
  daysUntil,
  formatDate
};

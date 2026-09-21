/**
 * Customer online ordering — branch-scoped menu, cart validation, orders, web customers.
 * Integrates with existing products, modifiers, branch_stock, loyalty, sales/POS.
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { getDb } = require('../database/db');
const { publicProductImageUrl, publicAssetImageUrl } = require('../../lib/product-images');
const promoPricing = require('../../lib/promo-pricing');

function dbGet(sql, p = []) { return getDb().prepare(sql).get(...p); }
function dbAll(sql, p = []) { return getDb().prepare(sql).all(...p); }
function dbRun(sql, p = []) { return getDb().prepare(sql).run(...p); }

function parseJson(v, fallback = null) {
  if (v == null || v === '') return fallback;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch (_) { return fallback; }
}

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

function nowIso() { return new Date().toISOString(); }
function nowPlusMin(min) { return new Date(Date.now() + min * 60000).toISOString(); }

function isPgCloud() {
  try {
    return typeof process !== 'undefined' && process.env &&
      !!(process.env.SHOP_POS_DATABASE_URL || process.env.DATABASE_URL);
  } catch (_) { return false; }
}

function ensureSchema() {
  try { getDb().prepare('SELECT 1 FROM branch_online_settings LIMIT 1').get(); } catch (_) {
    if (!isPgCloud()) {
      const fs = require('fs');
      const path = require('path');
      const mig = path.join(__dirname, '../database/migrations-v79.sql');
      if (fs.existsSync(mig)) getDb().exec(fs.readFileSync(mig, 'utf8'));
    }
  }
  ensureOrderGiftColumns();
  ensureOrderTrackingColumns();
  ensureOrderRejectColumns();
  ensurePasswordResetSchema();
  ensureIssueSchema();
}

function getLoyaltyPublicSettings() {
  try {
    const features = require('./features');
    const ls = features.getLoyaltySettings();
    return {
      enabled: ls.enabled !== false,
      spend_amount: ls.spend_amount,
      points_earned: ls.points_earned,
      point_value: ls.point_value,
      min_sale_total: ls.min_sale_total
    };
  } catch (_) {
    return { enabled: true, spend_amount: 10, points_earned: 1, point_value: 1, min_sale_total: 0 };
  }
}

/** Build online checkout payment options from POS payment_settings (no DB write) */
function buildMethodsFromPaymentSettings(paymentSettings = {}) {
  const enabled = Array.isArray(paymentSettings.enabled_methods) ? paymentSettings.enabled_methods : [];
  const custom = Array.isArray(paymentSettings.custom_methods) ? paymentSettings.custom_methods : [];
  if (!enabled.length) return [];

  const methods = [];
  const add = (m) => {
    if (!m || !m.id) return;
    if (methods.some((x) => String(x.id).toLowerCase() === String(m.id).toLowerCase())) return;
    methods.push({ ...m, enabled: m.enabled !== false });
  };

  const posToOnline = {
    card: { id: 'card', label: 'Card (pay now)', status: 'pending_payment', fulfillment: 'any' },
    eft: { id: 'eft', label: 'EFT / Bank transfer', status: 'pending', fulfillment: 'any' },
    mobile: { id: 'mobile', label: 'Mobile payment', status: 'pending', fulfillment: 'any' },
    snapscan: { id: 'snapscan', label: 'SnapScan / QR', status: 'pending', fulfillment: 'any' },
    other: { id: 'other', label: 'Other payment', status: 'pending', fulfillment: 'any' },
    pay_online: { id: 'pay_online', label: 'Pay Online', status: 'pending_payment', fulfillment: 'any' }
  };

  for (const id of enabled) {
    const key = String(id).toLowerCase();
    if (key === 'cash') {
      add({ id: 'cash_on_collection', label: 'Cash on collection', status: 'pending', fulfillment: 'collection' });
      add({ id: 'cash_on_delivery', label: 'Cash on delivery', status: 'pending', fulfillment: 'delivery' });
    } else if (posToOnline[key]) {
      add(posToOnline[key]);
    } else {
      const customDef = custom.find((c) => String(c.id).toLowerCase() === key);
      add({
        id: key,
        label: customDef?.label || key.replace(/_/g, ' '),
        status: 'pending',
        fulfillment: 'any',
        enabled: customDef ? customDef.enabled !== false : true
      });
    }
  }

  for (const c of custom) {
    if (!c.id || !c.label) continue;
    if (!enabled.includes(c.id) && c.enabled === false) continue;
    add({ id: String(c.id).toLowerCase(), label: c.label, status: 'pending', fulfillment: 'any', enabled: c.enabled !== false });
  }

  return methods;
}

/** Map admin Payment Methods (POS) → online checkout options and persist */
function syncPaymentMethodsFromPos(paymentSettings = {}) {
  ensureSchema();
  const methods = buildMethodsFromPaymentSettings(paymentSettings);
  if (!methods.length) return null;
  const global = getGlobalSettings();
  const online = { ...(global.online || {}), payment_methods: methods };
  saveGlobalOnlineSettings(online, null);
  return methods;
}

function buildOnlineMethodsFromPosSettings() {
  try {
    const row = dbGet('SELECT payment_settings, online_settings_json FROM shop_settings WHERE id = 1') || {};
    const online = parseJson(row.online_settings_json, {});
    if (Array.isArray(online?.payment_methods) && online.payment_methods.length) {
      return online.payment_methods;
    }
    const pm = parseJson(row.payment_settings, {});
    const built = buildMethodsFromPaymentSettings(pm);
    return built.length ? built : null;
  } catch (_) { /* ignore */ }
  return null;
}

function calcOnlineTaxTotals(grossTotal, discount, taxRatePct, taxEnabled, taxInclusive) {
  const afterDiscount = round2(Math.max(0, (Number(grossTotal) || 0) - Math.max(0, Number(discount) || 0)));
  const rate = Number(taxRatePct) || 0;
  if (!taxEnabled || !rate) return { subtotal: afterDiscount, tax_amount: 0, total: afterDiscount };
  const inclusive = taxInclusive !== false && taxInclusive !== 0 && taxInclusive !== '0';
  if (!inclusive) {
    const tax_amount = round2(afterDiscount * rate / 100);
    return { subtotal: afterDiscount, tax_amount, total: round2(afterDiscount + tax_amount) };
  }
  const tax_amount = round2(afterDiscount - afterDiscount / (1 + rate / 100));
  const total = afterDiscount;
  const subtotal = round2(total - tax_amount);
  return { subtotal, tax_amount, total };
}

function getGlobalSettings() {
  ensureSchema();
  let shop;
  try {
    shop = dbGet('SELECT shop_name, logo_path, address, phone, currency, tax_rate, tax_enabled, tax_inclusive, tax_show_on_pos, online_settings_json, operating_hours_settings, payment_settings, whatsapp_settings_json FROM shop_settings WHERE id = 1') || {};
  } catch (_) {
    try { dbRun('ALTER TABLE shop_settings ADD COLUMN online_settings_json TEXT'); } catch (__) { /* */ }
    shop = dbGet('SELECT shop_name, logo_path, address, phone, currency, tax_rate, tax_enabled, tax_inclusive FROM shop_settings WHERE id = 1') || {};
  }
  const online = parseJson(shop.online_settings_json, null);
  const loyalty = getLoyaltyPublicSettings();
  const defaultPaymentMethods = [
    { id: 'card', label: 'Card (pay now)', status: 'pending_payment', fulfillment: 'any', enabled: true },
    { id: 'eft', label: 'EFT / Bank transfer', status: 'pending', fulfillment: 'any', enabled: true },
    { id: 'cash_on_collection', label: 'Cash on collection', status: 'pending', fulfillment: 'collection', enabled: true },
    { id: 'cash_on_delivery', label: 'Cash on delivery', status: 'pending', fulfillment: 'delivery', enabled: true },
    { id: 'snapscan', label: 'SnapScan / QR', status: 'pending', fulfillment: 'any', enabled: true }
  ];
  const fromPos = buildOnlineMethodsFromPosSettings();
  let paymentMethods = fromPos?.length
    ? fromPos
    : (Array.isArray(online?.payment_methods) && online.payment_methods.length
      ? online.payment_methods
      : defaultPaymentMethods);
  try {
    const gwMethods = require('./payment-gateway').getEnabledOnlineMethods();
    for (const gm of gwMethods || []) {
      if (!paymentMethods.some((m) => String(m.id).toLowerCase() === String(gm.id).toLowerCase())) {
        paymentMethods = [gm, ...paymentMethods];
      } else {
        paymentMethods = paymentMethods.map((m) =>
          String(m.id).toLowerCase() === String(gm.id).toLowerCase() ? { ...m, ...gm, enabled: true } : m
        );
      }
    }
  } catch (_) { /* optional until schema ready */ }
  const operatingHours = parseOperatingHours(shop.operating_hours_settings);
  const whatsapp = parseJson(shop.whatsapp_settings_json, {});
  return {
    shop_name: shop.shop_name || 'Shop',
    logo_path: shop.logo_path,
    address: shop.address,
    phone: shop.phone,
    whatsapp_number: whatsapp.business_number || whatsapp.phone || shop.phone || null,
    currency: shop.currency || 'R',
    tax_rate: Number(shop.tax_rate) || 0,
    tax_enabled: !!Number(shop.tax_enabled),
    tax_inclusive: shop.tax_inclusive !== 0 && shop.tax_inclusive !== '0' && shop.tax_inclusive !== false,
    tax_show_on_pos: shop.tax_show_on_pos !== 0 && shop.tax_show_on_pos !== '0' && shop.tax_show_on_pos !== false,
    operating_hours: operatingHours,
    online: {
      enabled: online?.enabled !== false,
      loyalty_enabled: online?.loyalty_enabled !== false,
      coupons_enabled: online?.coupons_enabled !== false,
      gift_cards_enabled: online?.gift_cards_enabled !== false,
      reviews_enabled: online?.reviews_enabled !== false,
      scheduled_enabled: online?.scheduled_enabled !== false,
      pos_reminder_minutes: Number(online?.pos_reminder_minutes) > 0 ? Number(online.pos_reminder_minutes) : 2,
      payment_methods: paymentMethods,
      ...(online || {}),
      payment_methods: paymentMethods
    },
    loyalty: {
      ...loyalty,
      enabled: loyalty.enabled && (online?.loyalty_enabled !== false)
    }
  };
}

function parseOperatingHours(raw) {
  const operatingHours = parseJson(raw, {
    enabled: false,
    apply_to_online: true,
    open_time: '08:00',
    close_time: '18:00',
    weekly: []
  });
  if (operatingHours.apply_to_online === undefined) operatingHours.apply_to_online = true;
  if (!operatingHours.open_time) operatingHours.open_time = '08:00';
  if (!operatingHours.close_time) operatingHours.close_time = '18:00';
  if (!operatingHours.force_online) operatingHours.force_online = 'auto';
  if (!operatingHours.force_pos) operatingHours.force_pos = 'auto';
  if (!operatingHours.hours_revision) operatingHours.hours_revision = 0;
  return operatingHours;
}

function parseClockToday(timeStr) {
  const now = new Date();
  const [h, m] = String(timeStr || '08:00').split(':').map(Number);
  const d = new Date(now);
  d.setHours(h || 0, m || 0, 0, 0);
  return d;
}

function isOnlineOpenFromHours(oh) {
  const hours = oh || {};
  if (hours.force_online === 'open') return true;
  if (hours.force_online === 'closed') return false;
  if (hours.apply_to_online === false || hours.apply_to_online === 0 || hours.apply_to_online === '0') return true;
  const weekly = Array.isArray(hours.weekly) ? hours.weekly : [];
  const now = new Date();
  const day = weekly.find((w) => Number(w.day) === now.getDay())
    || { open: hours.open_time || '08:00', close: hours.close_time || '18:00', closed: false };
  if (day.closed) return false;
  const openAt = parseClockToday(day.open || hours.open_time || '08:00');
  const closeAt = parseClockToday(day.close || hours.close_time || '18:00');
  if (closeAt.getTime() <= openAt.getTime()) {
    return now >= openAt || now < closeAt;
  }
  return now >= openAt && now < closeAt;
}

function getHoursStatus() {
  ensureSchema();
  let shop = {};
  try {
    shop = dbGet('SELECT operating_hours_settings FROM shop_settings WHERE id = 1') || {};
  } catch (_) { /* */ }
  const operating_hours = parseOperatingHours(shop.operating_hours_settings);
  return {
    force_online: operating_hours.force_online,
    force_pos: operating_hours.force_pos,
    hours_revision: operating_hours.hours_revision || 0,
    online_open: isOnlineOpenFromHours(operating_hours),
    operating_hours
  };
}

function getOnlinePaymentMethods(fulfillment) {
  const methods = getGlobalSettings().online.payment_methods || [];
  const f = String(fulfillment || 'collection').toLowerCase();
  return methods.filter((m) => m.enabled !== false).filter((m) => {
    const mf = String(m.fulfillment || 'any').toLowerCase();
    return mf === 'any' || mf === f;
  });
}

const ONLINE_ORDER_TRANSITIONS = {
  pending: ['accepted', 'rejected', 'cancelled', 'pending_payment', 'preparing'],
  pending_payment: ['pending', 'accepted', 'cancelled', 'rejected'],
  paid: ['accepted', 'cancelled', 'preparing'],
  accepted: ['preparing', 'ready', 'completed', 'cancelled', 'rejected'],
  preparing: ['ready', 'completed', 'cancelled'],
  ready: ['completed', 'cancelled'],
  completed: [],
  rejected: [],
  cancelled: []
};

function assertOnlineOrderTransition(fromStatus, toStatus) {
  const from = String(fromStatus || 'pending').toLowerCase();
  const to = String(toStatus || '').toLowerCase();
  if (from === to) return;
  const allowed = ONLINE_ORDER_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw new Error(`Invalid online order status change: ${from} → ${to}`);
  }
}

function ensurePaymentIntentsSchema() {
  if (isPgCloud()) {
    try {
      const fs = require('fs');
      const path = require('path');
      const mig = path.join(__dirname, '../../supabase/migrations/20260910_online_payment_intents.sql');
      if (fs.existsSync(mig)) {
        const { splitSqlStatements } = require('../database/ensure-pg-schema');
        const sql = fs.readFileSync(mig, 'utf8');
        for (const stmt of splitSqlStatements(sql)) {
          try { getDb().exec(stmt); } catch (e) {
            if (!/already exists|duplicate column/i.test(String(e.message || e))) {
              console.warn('[online-ordering] payment intents:', String(e.message || e).slice(0, 120));
            }
          }
        }
      }
    } catch (_) { /* optional */ }
    return;
  }
  try {
    dbRun(`CREATE TABLE IF NOT EXISTS online_payment_intents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      intent_token TEXT NOT NULL UNIQUE,
      amount REAL NOT NULL,
      branch_id INTEGER,
      web_customer_id INTEGER,
      payment_method TEXT,
      status TEXT DEFAULT 'pending',
      payment_reference TEXT,
      verified_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`);
  } catch (_) { /* exists */ }
}

function createCardPaymentIntent(amount, branchId, webCustomerId, paymentMethod = 'card') {
  ensurePaymentIntentsSchema();
  const token = crypto.randomBytes(16).toString('hex');
  dbRun(`INSERT INTO online_payment_intents (intent_token, amount, branch_id, web_customer_id, payment_method, status)
    VALUES (?,?,?,?,?, 'pending')`, [token, Number(amount) || 0, branchId || null, webCustomerId || null, paymentMethod]);
  return { intent_token: token, amount: Number(amount) || 0, expires_in: 900 };
}

function verifyCardPaymentIntent(intentToken, reference) {
  ensurePaymentIntentsSchema();
  const row = dbGet('SELECT * FROM online_payment_intents WHERE intent_token=?', [intentToken]);
  if (!row) throw new Error('Payment intent not found');
  if (row.status === 'paid') return { verified: true, intent_token: intentToken, payment_reference: row.payment_reference };
  const ref = String(reference || '').trim();
  if (!ref) throw new Error('Payment reference required');
  const gateway = getGlobalSettings().online?.payment_gateway || { mode: 'test' };
  if (gateway.mode === 'live' && gateway.provider) {
    if (ref.length < 8) throw new Error('Invalid payment reference');
  } else if (!/^TEST-[A-Za-z0-9-]{6,}$/.test(ref) && ref.length < 8) {
    throw new Error('Invalid payment reference — use TEST- prefix in test mode or a gateway reference in live mode');
  }
  dbRun(`UPDATE online_payment_intents SET status='paid', payment_reference=?, verified_at=? WHERE intent_token=?`,
    [ref, nowIso(), intentToken]);
  return { verified: true, intent_token: intentToken, payment_reference: ref };
}

function resolvePaymentForOrder(payload = {}, fulfillment) {
  const methods = getOnlinePaymentMethods(fulfillment);
  const methodId = String(payload.payment_method || 'card').toLowerCase();
  const method = methods.find((m) => String(m.id).toLowerCase() === methodId);
  if (!method) throw new Error('Selected payment method is not available');
  let payment_status = payload.payment_status || method.status || 'pending';
  const mid = String(method.id).toLowerCase();

  // Gateway-hosted online pay (Yoco etc.) — never mark paid from the browser
  let gatewayPay = false;
  try {
    gatewayPay = require('./payment-gateway').isGatewayPaymentMethod(mid);
  } catch (_) { /* optional */ }
  if (gatewayPay || mid === 'pay_online') {
    return {
      payment_method: method.id,
      payment_status: 'PENDING',
      payment_intent_token: null,
      gateway_checkout: true
    };
  }

  const cardLike = ['card', 'snapscan', 'mobile'].includes(mid);
  if (cardLike && payload.payment_intent_token) {
    const intent = dbGet('SELECT * FROM online_payment_intents WHERE intent_token=? AND status=\'paid\'', [payload.payment_intent_token]);
    if (!intent) throw new Error('Card payment not verified — complete payment first');
    if (Math.abs(Number(intent.amount) - Number(payload.expected_total || intent.amount)) > 0.02) {
      throw new Error('Payment amount mismatch');
    }
    payment_status = 'paid';
  } else if (cardLike && String(method.status || '').toLowerCase() === 'pending_payment') {
    payment_status = 'pending_payment';
  }
  return {
    payment_method: method.id,
    payment_status,
    payment_intent_token: payload.payment_intent_token || null
  };
}

function saveGlobalOnlineSettings(data = {}, actor) {
  ensureSchema();
  const payload = JSON.stringify({ ...getGlobalSettings().online, ...data, updated_at: new Date().toISOString() });
  try {
    dbRun(`UPDATE shop_settings SET online_settings_json = ?, updated_at = ? WHERE id = 1`, [payload, nowIso()]);
  } catch (_) {
    try { dbRun('ALTER TABLE shop_settings ADD COLUMN online_settings_json TEXT'); } catch (__) { /* */ }
    dbRun(`UPDATE shop_settings SET online_settings_json = ? WHERE id = 1`, [payload]);
  }
  return getGlobalSettings();
}

function getBranchOnlineSettings(branchId) {
  ensureSchema();
  const global = getGlobalSettings();
  const row = dbGet('SELECT * FROM branch_online_settings WHERE branch_id = ?', [branchId]);
  const delRow = dbGet('SELECT delivery_fee, free_delivery_above, min_order, delivery_enabled, zones_json FROM delivery_branch_settings WHERE branch_id = ?', [branchId]);
  let branch = dbGet('SELECT * FROM branches WHERE id = ?', [branchId]);
  if (!branch) {
    branch = {
      id: branchId,
      name: global.shop_name || 'Main Branch',
      code: 'MAIN',
      address: global.address || null,
      phone: global.phone || null,
      is_active: 1
    };
  }
  const base = {
    branch_id: branchId,
    branch_name: branch.name,
    branch_code: branch.code,
    address: branch.address,
    phone: branch.phone,
    ...(row || {
      online_enabled: 1, delivery_enabled: 1, collection_enabled: 1, status: 'open',
      min_delivery_order: 0, delivery_fee: 0, free_delivery_above: 0, prep_minutes: 25
    }),
    opening_hours: parseJson(row?.opening_hours_json, {}),
    delivery_zones: parseJson(row?.delivery_zones_json, []),
    extra: parseJson(row?.settings_json, {})
  };
  if (delRow) {
    if (delRow.delivery_fee != null) base.delivery_fee = Number(delRow.delivery_fee) || 0;
    if (delRow.free_delivery_above != null) base.free_delivery_above = Number(delRow.free_delivery_above) || 0;
    if (delRow.min_order != null) base.min_delivery_order = Number(delRow.min_order) || 0;
    if (delRow.delivery_enabled != null) base.delivery_enabled = delRow.delivery_enabled ? 1 : 0;
    try {
      const places = require('./delivery-platform').normalizePlaces(delRow.zones_json);
      if (places.length) {
        base.delivery_zones = places;
        base.delivery_places = places;
      }
    } catch (_) { /* optional */ }
  }
  if (!base.delivery_places) base.delivery_places = Array.isArray(base.delivery_zones) ? base.delivery_zones : [];
  return base;
}

function saveBranchOnlineSettings(branchId, data = {}, actor) {
  ensureSchema();
  const existing = dbGet('SELECT branch_id FROM branch_online_settings WHERE branch_id = ?', [branchId]);
  const fields = {
    online_enabled: data.online_enabled != null ? (data.online_enabled ? 1 : 0) : undefined,
    delivery_enabled: data.delivery_enabled != null ? (data.delivery_enabled ? 1 : 0) : undefined,
    collection_enabled: data.collection_enabled != null ? (data.collection_enabled ? 1 : 0) : undefined,
    scheduled_enabled: data.scheduled_enabled != null ? (data.scheduled_enabled ? 1 : 0) : undefined,
    status: data.status,
    min_delivery_order: data.min_delivery_order,
    delivery_fee: data.delivery_fee,
    free_delivery_above: data.free_delivery_above,
    prep_minutes: data.prep_minutes,
    max_active_orders: data.max_active_orders,
    busy_mode: data.busy_mode != null ? (data.busy_mode ? 1 : 0) : undefined,
    opening_hours_json: data.opening_hours != null ? JSON.stringify(data.opening_hours) : undefined,
    delivery_zones_json: data.delivery_zones != null ? JSON.stringify(data.delivery_zones) : undefined,
    settings_json: data.extra != null ? JSON.stringify(data.extra) : undefined
  };
  if (existing) {
    const sets = [];
    const vals = [];
    for (const [k, v] of Object.entries(fields)) {
      if (v !== undefined) { sets.push(`${k} = ?`); vals.push(v); }
    }
    if (sets.length) {
      sets.push('updated_at = ?');
      vals.push(nowIso());
      dbRun(`UPDATE branch_online_settings SET ${sets.join(', ')} WHERE branch_id = ?`, [...vals, branchId]);
    }
  } else {
    dbRun(`INSERT INTO branch_online_settings (branch_id, online_enabled, delivery_enabled, collection_enabled, status, min_delivery_order, delivery_fee, free_delivery_above, prep_minutes)
      VALUES (?,?,?,?,?,?,?,?,?)`,
      [branchId, 1, 1, 1, data.status || 'open', data.min_delivery_order || 0, data.delivery_fee || 0, data.free_delivery_above || 0, data.prep_minutes || 25]);
  }
  return getBranchOnlineSettings(branchId);
}

function getPublicBranches() {
  ensureSchema();
  const global = getGlobalSettings();
  if (!global.online.enabled) return [];
  let rows = dbAll(`SELECT b.*, bos.online_enabled, bos.delivery_enabled, bos.collection_enabled, bos.status AS online_status,
    bos.min_delivery_order, bos.delivery_fee, bos.free_delivery_above, bos.prep_minutes, bos.busy_mode
    FROM branches b
    LEFT JOIN branch_online_settings bos ON bos.branch_id = b.id
    WHERE COALESCE(b.is_active, 1) != 0
    ORDER BY b.name`);

  // Single-shop installs may only have shop_settings — synthesize one branch for ordering.
  if (!rows.length) {
    const settings = dbGet('SELECT branch_id FROM shop_settings WHERE id = 1') || {};
    const branchId = Number(settings.branch_id) || 1;
    let branch = dbGet('SELECT * FROM branches WHERE id = ?', [branchId]);
    if (!branch) {
      branch = {
        id: branchId,
        name: global.shop_name || 'Main Branch',
        code: 'MAIN',
        address: global.address || null,
        phone: global.phone || null,
        is_active: 1
      };
    }
    try {
      dbRun(`INSERT INTO branch_online_settings (branch_id, online_enabled, delivery_enabled, collection_enabled, status)
        VALUES (?,?,?,?,?)`, [branchId, 1, 1, 1, 'open']);
    } catch (_) {
      try {
        dbRun(`INSERT OR IGNORE INTO branch_online_settings (branch_id, online_enabled, delivery_enabled, collection_enabled, status)
          VALUES (?,?,?,?,?)`, [branchId, 1, 1, 1, 'open']);
      } catch (__) { /* already exists */ }
    }
    const bos = dbGet('SELECT * FROM branch_online_settings WHERE branch_id = ?', [branchId]) || {};
    rows = [{
      ...branch,
      online_enabled: bos.online_enabled ?? 1,
      delivery_enabled: bos.delivery_enabled ?? 1,
      collection_enabled: bos.collection_enabled ?? 1,
      online_status: bos.status || 'open',
      min_delivery_order: bos.min_delivery_order,
      delivery_fee: bos.delivery_fee,
      free_delivery_above: bos.free_delivery_above,
      prep_minutes: bos.prep_minutes,
      busy_mode: bos.busy_mode
    }];
  }

  return rows
    .filter((b) => b.online_enabled == null || Number(b.online_enabled) !== 0)
    .map((b) => {
      let places = [];
      try {
        const full = getBranchOnlineSettings(b.id);
        places = full.delivery_places || full.delivery_zones || [];
      } catch (_) { places = []; }
      return {
    id: b.id,
    name: b.name,
    code: b.code,
    address: b.address,
    phone: b.phone,
    online_enabled: b.online_enabled == null ? true : Number(b.online_enabled) !== 0,
    delivery_enabled: b.delivery_enabled == null ? true : Number(b.delivery_enabled) !== 0,
    collection_enabled: b.collection_enabled == null ? true : Number(b.collection_enabled) !== 0,
    status: b.online_status || 'open',
    busy_mode: !!b.busy_mode,
    min_delivery_order: Number(b.min_delivery_order) || 0,
    delivery_fee: Number(b.delivery_fee) || 0,
    free_delivery_above: Number(b.free_delivery_above) || 0,
    prep_minutes: Number(b.prep_minutes) || 25,
    delivery_places: places,
    is_open: (b.online_status || 'open') === 'open' && (b.online_enabled == null || Number(b.online_enabled) !== 0)
  };
    });
}

function branchStockQty(productId, branchId) {
  const bs = dbGet('SELECT quantity FROM branch_stock WHERE product_id = ? AND branch_id = ?', [productId, branchId]);
  if (bs) return Number(bs.quantity) || 0;
  const p = dbGet('SELECT stock_quantity FROM products WHERE id = ?', [productId]);
  return Number(p?.stock_quantity) || 0;
}

function productAvailableAtBranch(product, branchId) {
  if (!product || product.is_active === 0) return false;
  if (product.online_enabled === 0) return false;
  if (product.branch_id && Number(product.branch_id) !== Number(branchId)) {
    const bs = dbGet('SELECT 1 FROM branch_stock WHERE product_id = ? AND branch_id = ?', [product.id, branchId]);
    if (!bs) return false;
  }
  const hasRecipe = Number(product.has_recipe) === 1;
  if (hasRecipe && String(product.production_mode || '') !== 'make_to_stock') {
    try {
      const snap = require('./production-availability').calculateProductCapacity(product.id, { forOnline: true });
      return Number(snap?.available_meals) > 0;
    } catch (_) {
      const cap = Number(product.production_capacity);
      if (Number.isFinite(cap)) return cap > 0;
      return false;
    }
  }
  return branchStockQty(product.id, branchId) > 0;
}

function getModifiersForProduct(productId, branchId) {
  const mods = dbAll('SELECT * FROM product_modifiers WHERE product_id = ? ORDER BY option_group, id', [productId]);
  const inventory = require('./inventory');
  let recipeItems = [];
  try { recipeItems = inventory.getProductRecipe(productId) || []; } catch (_) { recipeItems = []; }
  const optionOut = (optionName) => {
    const key = String(optionName || '').trim().toLowerCase();
    if (!key) return false;
    for (const item of recipeItems) {
      const opt = String(item.option_name || '').trim().toLowerCase();
      if (opt !== key) continue;
      const rule = inventory.normalizeIncludeRule(item.include_rule);
      if (rule === 'when_selected' && !(Number(item.ingredient_stock_quantity) > 0)) return true;
    }
    return false;
  };
  const groups = {};
  for (const m of mods) {
    const isRemoval = String(m.modifier_type || '').toLowerCase() === 'removal';
    const g = isRemoval ? 'Without / Remove' : (m.option_group || m.modifier_type || 'Options');
    if (!groups[g]) {
      groups[g] = { name: g, required: false, options: [], type: isRemoval ? 'checkbox' : 'radio' };
    }
    if (m.is_required && !isRemoval) groups[g].required = true;
    groups[g].options.push({
      id: m.id,
      name: m.name,
      extra_price: Number(m.extra_price) || 0,
      modifier_type: m.modifier_type || 'extra',
      is_required: !!m.is_required,
      out_of_stock: optionOut(m.name)
    });
  }
  return Object.values(groups);
}

function mapProductForWeb(p, branchId, promos = [], productPromo = null, modifierIds = null) {
  const price = Number(p.selling_price) || 0;
  const promo = promos.find((pr) => String(pr.product_id) === String(p.id));
  let salePrice = promo ? round2(price * (1 - (Number(promo.discount_percent) || 0) / 100)) : null;
  let displayPrice = price;
  if (productPromo) {
    displayPrice = Number(productPromo.original_price) || price;
    salePrice = Number(productPromo.proposed_price) || salePrice;
  }
  const qty = branchStockQty(p.id, branchId);
  const available = productAvailableAtBranch(p, branchId);
  const pic = p.picture_path || p.image_path || p.image;
  const imageUrl = pic ? publicProductImageUrl(p.id, false, p.updated_at || p.picture_updated_at) : null;
  const todayStr = new Date().toLocaleDateString('en-CA');
  const badges = [];
  if (Number(p.available_today) === 1) badges.push({ key: 'available_today', label: 'Available Today', color: '#2dd4bf' });
  if (Number(p.is_new_arrival) === 1 && (!p.new_arrival_until || p.new_arrival_until >= todayStr)) {
    badges.push({ key: 'new_arrival', label: 'New Arrival', color: '#38bdf8' });
  }
  if (Number(p.is_best_seller) === 1) badges.push({ key: 'best_seller', label: 'Best Seller', color: '#fbbf24' });
  if (productPromo || (salePrice && salePrice < displayPrice)) badges.push({ key: 'promo', label: 'SALE', color: '#ef4444' });
  return {
    id: p.id,
    name: p.name,
    description: p.online_description || p.description || '',
    category_id: p.category_id,
    image: imageUrl,
    price: displayPrice,
    sale_price: salePrice && salePrice < displayPrice ? salePrice : null,
    on_sale: !!(salePrice && salePrice < displayPrice),
    available,
    stock_qty: qty,
    has_modifiers: modifierIds ? modifierIds.has(p.id) : !!dbGet('SELECT 1 FROM product_modifiers WHERE product_id = ? LIMIT 1', [p.id]),
    is_combo: false,
    available_today: Number(p.available_today) === 1,
    is_new_arrival: Number(p.is_new_arrival) === 1 && (!p.new_arrival_until || p.new_arrival_until >= todayStr),
    is_best_seller: Number(p.is_best_seller) === 1,
    badges
  };
}

function comboPendingOnlineQty(comboId, branchId) {
  let pending = 0;
  try {
    const rows = dbAll('SELECT items_json FROM online_orders_local WHERE status = ? AND branch_id = ?', ['pending', branchId]);
    for (const row of rows) {
      let lines = [];
      try { lines = JSON.parse(row.items_json || '[]'); } catch (_) { lines = []; }
      for (const line of lines) {
        if (Number(line.combo_id) === Number(comboId)) pending += Number(line.quantity) || 1;
      }
    }
  } catch (_) { /* optional */ }
  return pending;
}

function comboAvailableAtBranch(combo, branchId) {
  if (!combo) return false;
  const combosSvc = require('./combos');
  if (!combosSvc.isComboActive(combo)) return false;
  return combosSvc.comboAvailableUnits(combo, branchId) > 0;
}

function comboItemImageUrl(ci) {
  if (ci.custom_image_path) return publicAssetImageUrl(ci.custom_image_path);
  if (ci.product_id) return publicProductImageUrl(ci.product_id, false);
  return null;
}

function mapComboForWeb(combo, branchId, modifierIds = null) {
  const combosSvc = require('./combos');
  const availUnits = combosSvc.comboAvailableUnits(combo, branchId);
  const normal = Number(combo.normal_price) || 0;
  const finalPrice = Number(combo.final_price) || normal;
  const pic = combo.image_path || combo.picture_path;
  const items = combo.items || [];
  const thumbs = items.map(comboItemImageUrl).filter(Boolean);
  const gallery = (combo.gallery_paths || []).map(publicAssetImageUrl).filter(Boolean);
  let hasModifiers = combo.combo_kind === 'custom' ? false : false;
  for (const ci of items) {
    if (ci.allow_pap_choice || (ci.product_id && (modifierIds ? modifierIds.has(ci.product_id) : dbGet('SELECT 1 FROM product_modifiers WHERE product_id = ? LIMIT 1', [ci.product_id])))) {
      hasModifiers = true;
      break;
    }
  }
  return {
    id: `combo-${combo.id}`,
    combo_id: combo.id,
    is_combo: true,
    combo_kind: combo.combo_kind || 'standard',
    name: combo.name,
    description: combo.description || '',
    category_id: 'combos',
    image: pic ? publicProductImageUrl(combo.id, true) : (thumbs[0] || gallery[0] || null),
    combo_thumbs: [
      ...(pic ? [publicProductImageUrl(combo.id, true)] : []),
      ...gallery,
      ...thumbs
    ].filter(Boolean).filter((u, i, arr) => arr.indexOf(u) === i).slice(0, 12),
    price: normal,
    sale_price: finalPrice < normal ? finalPrice : null,
    on_sale: finalPrice < normal,
    available: availUnits > 0,
    stock_qty: combo.combo_kind === 'custom' && combo.stock_quantity != null && combo.stock_quantity !== ''
      ? Math.max(0, Number(combo.stock_quantity) || 0)
      : (availUnits > 9999 ? 99 : availUnits),
    has_modifiers: hasModifiers,
    combo_items: items.map((ci) => ({
      product_id: ci.product_id,
      product_name: ci.product_name || ci.custom_name || 'Item',
      quantity: ci.quantity,
      allow_pap_choice: !!ci.allow_pap_choice,
      image: comboItemImageUrl(ci)
    }))
  };
}

function getActiveCombos(branchId) {
  try {
    const combosSvc = require('./combos');
    let list = combosSvc.getCombos({
      active_only: true, branch_id: branchId, approval_status: 'approved'
    }, null) || [];
    if (!list.length) {
      list = combosSvc.getCombos({ active_only: true, approval_status: 'approved' }, null) || [];
    }
    return list.filter((c) => combosSvc.isComboActive(c));
  } catch (_) { return []; }
}

function parseComboRef(productId) {
  const raw = String(productId || '');
  if (raw.startsWith('combo-')) return Number(raw.slice(6)) || null;
  return null;
}

function ensureOrderGiftColumns() {
  for (const col of ['gift_card_code TEXT', 'gift_card_amount REAL DEFAULT 0']) {
    try { dbRun(`ALTER TABLE online_orders_local ADD COLUMN ${col}`); } catch (_) { /* exists */ }
  }
}

function ensureOrderServiceFeeColumns() {
  for (const col of [
    'service_fee REAL DEFAULT 0',
    'service_fee_label TEXT DEFAULT \'\'',
    'service_fee_config_json TEXT DEFAULT \'{}\''
  ]) {
    try { dbRun(`ALTER TABLE online_orders_local ADD COLUMN ${col}`); } catch (_) { /* exists */ }
  }
}

function ensureOrderTrackingColumns() {
  for (const col of ['confirmation_code TEXT', 'tracking_token TEXT']) {
    try { dbRun(`ALTER TABLE online_orders_local ADD COLUMN ${col}`); } catch (_) { /* exists */ }
  }
}

function ensureOrderRejectColumns() {
  if (isPgCloud()) {
    try { dbRun('ALTER TABLE online_orders_local ADD COLUMN IF NOT EXISTS rejected_by BIGINT'); } catch (_) { /* */ }
    try { dbRun('ALTER TABLE online_orders_local ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ'); } catch (_) { /* */ }
  } else {
    for (const col of ['rejected_by INTEGER', 'rejected_at TEXT']) {
      try { dbRun(`ALTER TABLE online_orders_local ADD COLUMN ${col}`); } catch (_) { /* exists */ }
    }
  }
}

function sendCustomerWhatsApp(phone, body, branchId) {
  if (!phone || !body) return;
  try {
    const whatsapp = require('./whatsapp');
    const url = whatsapp.buildWaUrl(phone, body);
    dbRun(`INSERT INTO whatsapp_messages (recipient_type, phone, message_type, body, status, sender_name, branch_id, metadata_json)
      VALUES ('customer',?,?,?,'pending','online-order',?,?)`, [
      phone.trim(), 'online_order', body, branchId || null, JSON.stringify({ url, via: 'wa.me' })
    ]);
  } catch (_) { /* optional */ }
}

function buildTrackingSteps(order, deliveryRow) {
  const status = String(order.status || 'pending').toLowerCase();
  const ds = deliveryRow?.status || '';
  const step = (key, label, done, active) => ({ key, label, done: !!done, active: !!active });
  const accepted = ['accepted', 'preparing', 'ready', 'completed', 'delivered'].includes(status);
  const preparing = ['preparing', 'ready', 'completed', 'delivered'].includes(status);
  const driverAssigned = ['assigned', 'driver_accepted', 'picked_up', 'on_way', 'delivered'].includes(ds);
  const pickedUp = ['picked_up', 'on_way', 'delivered'].includes(ds);
  const onWay = ['on_way', 'delivered'].includes(ds);
  const delivered = status === 'completed' || status === 'delivered' || ds === 'delivered';
  const steps = [
    step('pending', 'Order placed', true, status === 'pending'),
    step('accepted', 'Accepted', accepted, status === 'accepted'),
    step('preparing', 'Preparing', preparing, status === 'preparing'),
    step('driver_assigned', 'Driver assigned', driverAssigned, ['assigned', 'driver_accepted'].includes(ds)),
    step('picked_up', 'Picked up from store', pickedUp, ds === 'picked_up'),
    step('on_way', 'On the way', onWay, ds === 'on_way'),
    step('delivered', 'Delivered', delivered, delivered && !onWay)
  ];
  if (!deliveryRow && order.fulfillment_type !== 'delivery' && order.fulfillment !== 'delivery') {
    return steps.filter((s) => !['driver_assigned', 'picked_up', 'on_way'].includes(s.key));
  }
  return steps;
}

function getActivePromotions(_branchId) {
  // Marketing platform promotions removed — use promo-requests only
  return [];
}

function getBranchMenu(branchId, filters = {}) {
  ensureSchema();
  const settings = getBranchOnlineSettings(branchId);
  if (!settings || Number(settings.online_enabled) === 0) throw new Error('Online ordering is not available at this branch');
  const store = require('./store');
  const menuHl = require('../../lib/menu-highlights');
  try { menuHl.syncAutoBestSellers(getDb(), store.getSettingsParsed()); } catch (_) { /* optional */ }
  const promos = getActivePromotions(branchId);
  let productPromoMap = {};
  try {
    const promoRequestsSvc = require('./promo-requests');
    productPromoMap = promoRequestsSvc.getActivePromosMap('online');
  } catch (_) { /* optional */ }
  const categories = dbAll('SELECT * FROM categories WHERE is_active = 1 ORDER BY sort_order, name');
  let products = dbAll(`SELECT p.* FROM products p
    WHERE p.is_active = 1 AND COALESCE(p.online_enabled, 1) = 1
    AND COALESCE(p.item_type, 'retail') != 'ingredient'
    AND (p.branch_id IS NULL OR p.branch_id = ? OR EXISTS (SELECT 1 FROM branch_stock bs WHERE bs.product_id = p.id AND bs.branch_id = ?))
    ORDER BY p.name`, [branchId, branchId]);
  if (filters.category_id) {
    const cat = String(filters.category_id);
    if (cat.startsWith('__')) {
      products = menuHl.filterProductsByTab(products, cat, productPromoMap);
    } else {
      products = products.filter((p) => String(p.category_id) === cat);
    }
  }
  if (filters.q) {
    const q = String(filters.q).toLowerCase();
    products = products.filter((p) => p.name.toLowerCase().includes(q));
  }
  if (filters.specials_only) {
    const promoIds = new Set(promos.map((pr) => String(pr.product_id)));
    products = products.filter((p) => promoIds.has(String(p.id)) || productPromoMap[p.id]);
  }
  const modifierIds = new Set(
    dbAll('SELECT DISTINCT product_id FROM product_modifiers WHERE product_id IS NOT NULL').map((r) => r.product_id)
  );
  const mapped = products.map((p) => mapProductForWeb(p, branchId, promos, productPromoMap[p.id], modifierIds));
  const combos = getActiveCombos(branchId);
  let comboMapped = combos.map((c) => mapComboForWeb(c, branchId, modifierIds));
  if (filters.q) {
    const q = String(filters.q).toLowerCase();
    comboMapped = comboMapped.filter((c) => c.name.toLowerCase().includes(q));
  }
  let allProducts = [...mapped, ...comboMapped];
  const catFilter = filters.category_id ? String(filters.category_id) : '';
  if (catFilter && !catFilter.startsWith('__')) {
    if (catFilter === 'combos') allProducts = comboMapped;
    else allProducts = allProducts.filter((p) => String(p.category_id) === catFilter);
  } else if (catFilter.startsWith('__')) {
    allProducts = mapped;
  }
  const catList = categories.map((c) => ({ id: c.id, name: c.name, color: c.color, image: c.image }));
  const allRaw = dbAll(`SELECT p.* FROM products p
    WHERE p.is_active = 1 AND COALESCE(p.online_enabled, 1) = 1
    AND COALESCE(p.item_type, 'retail') != 'ingredient'
    AND (p.branch_id IS NULL OR p.branch_id = ? OR EXISTS (SELECT 1 FROM branch_stock bs WHERE bs.product_id = p.id AND bs.branch_id = ?))`,
  [branchId, branchId]);
  const menuTabs = menuHl.buildMenuTabs(allRaw, productPromoMap, 'online', store.getSettingsParsed());
  if (comboMapped.length) {
    menuTabs.unshift({
      id: 'combos',
      name: 'Combos & Deals',
      count: comboMapped.length,
      color: '#f59e0b',
      saleStyle: true
    });
  }
  return {
    branch: settings,
    categories: catList,
    menu_tabs: menuTabs,
    products: allProducts,
    combos: comboMapped,
    specials: allProducts.filter((p) => p.on_sale)
  };
}

function getProductDetail(branchId, productId) {
  const comboId = parseComboRef(productId);
  if (comboId) {
    const combosSvc = require('./combos');
    const combo = combosSvc.getCombo(comboId);
    if (!combo) throw new Error('Combo not found');
    const items = (combo.items || []).map((ci) => {
      let groups = ci.product_id ? getModifiersForProduct(ci.product_id, branchId) : [];
      if (ci.allow_pap_choice && ci.product_id) {
        const hasRemoval = groups.some((g) => (g.options || []).some((o) => o.modifier_type === 'removal'));
        if (!hasRemoval) {
          groups = [...groups, {
            name: 'Pap choice',
            required: false,
            type: 'checkbox',
            options: [{
              id: `pap-${ci.product_id}`,
              name: 'Without pap',
              extra_price: 0,
              modifier_type: 'removal'
            }]
          }];
        }
      }
      return {
        ...ci,
        modifier_groups: groups,
        has_modifiers: groups.length > 0,
        image: ci.custom_image_path ? publicAssetImageUrl(ci.custom_image_path) : (ci.picture_path ? publicProductImageUrl(ci.product_id, false) : null)
      };
    });
    return {
      ...mapComboForWeb(combo, branchId),
      has_modifiers: items.some((i) => i.has_modifiers),
      combo_items: items,
      modifier_groups: []
    };
  }
  const p = dbGet('SELECT * FROM products WHERE id = ? AND is_active = 1', [productId]);
  if (!p) throw new Error('Product not found');
  const promos = getActivePromotions(branchId);
  let productPromo = null;
  try {
    productPromo = require('./promo-requests').getActivePromosMap('online')[productId] || null;
  } catch (_) { /* optional */ }
  return {
    ...mapProductForWeb(p, branchId, promos, productPromo),
    modifier_groups: getModifiersForProduct(productId, branchId)
  };
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function phoneDigits(phone) {
  if (!phone) return '';
  let d = String(phone).replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('27') && d.length >= 11) d = d.slice(2);
  else if (d.startsWith('27') && d.length === 10) d = d.slice(2);
  if (d.startsWith('0')) d = d.slice(1);
  return d.slice(-9);
}

function phonesMatch(a, b) {
  const na = phoneDigits(a);
  const nb = phoneDigits(b);
  if (na && nb && na.length >= 9 && na === nb) return true;
  const da = String(a || '').replace(/\D/g, '');
  const db = String(b || '').replace(/\D/g, '');
  if (da && db && da.length >= 9 && db.length >= 9 && (da === db || da.endsWith(db.slice(-9)) || db.endsWith(da.slice(-9)))) {
    return true;
  }
  return false;
}

function maskPhone(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  return d.length >= 4 ? `***${d.slice(-4)}` : '***';
}

function ensureRegistrationSchema() {
  try {
    dbRun(`CREATE TABLE IF NOT EXISTS web_registration_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL,
      email TEXT,
      customer_id INTEGER NOT NULL,
      code_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )`);
  } catch (_) { /* table may exist on PG */ }
}

function findPosCustomerByContact(phone, email) {
  const emailLower = String(email || '').trim().toLowerCase();
  const rows = dbAll(`SELECT * FROM customers WHERE
    (phone IS NOT NULL AND TRIM(phone) != '') OR (email IS NOT NULL AND TRIM(email) != '')`);
  if (phone) {
    for (const c of rows) {
      if (c.phone && phonesMatch(phone, c.phone)) return c;
    }
  }
  if (emailLower) {
    for (const c of rows) {
      if (c.email && String(c.email).trim().toLowerCase() === emailLower) return c;
    }
  }
  return null;
}

function webAccountExists(phone, email) {
  const emailLower = String(email || '').trim().toLowerCase();
  if (emailLower && dbGet('SELECT id FROM web_customers WHERE lower(email) = ? AND is_active = 1', [emailLower])) {
    return { exists: true, message: 'This email already has an online account. Please sign in.' };
  }
  if (phone) {
    const rows = dbAll('SELECT id, phone FROM web_customers WHERE is_active = 1 AND phone IS NOT NULL');
    for (const r of rows) {
      if (phonesMatch(phone, r.phone)) {
        return { exists: true, message: 'This mobile number already has an online account. Please sign in.' };
      }
    }
  }
  return { exists: false };
}

function isUniqueViolation(err) {
  return /duplicate key|unique constraint|UNIQUE constraint/i.test(String(err?.message || err || ''));
}

function findWebCustomerRow(phone, email, customerId) {
  if (customerId) {
    const row = dbGet('SELECT * FROM web_customers WHERE customer_id = ? ORDER BY id DESC LIMIT 1', [Number(customerId)]);
    if (row) return row;
  }
  const emailLower = String(email || '').trim().toLowerCase();
  if (emailLower) {
    const row = dbGet('SELECT * FROM web_customers WHERE lower(email) = ? ORDER BY id DESC LIMIT 1', [emailLower]);
    if (row) return row;
  }
  if (phone) {
    const rows = dbAll("SELECT * FROM web_customers WHERE phone IS NOT NULL AND TRIM(phone) != ''");
    for (const r of rows) {
      if (phonesMatch(phone, r.phone)) return r;
    }
  }
  return null;
}

function isWebRowActive(row) {
  return !!(row && row.is_active !== 0 && row.is_active !== false);
}

function upsertWebCustomer({ existing, customerId, first, last, email, phone, hash, referral, loyaltyPoints }) {
  if (existing) {
    if (isWebRowActive(existing) && existing.customer_id && Number(existing.customer_id) !== Number(customerId)) {
      throw new Error('This email or mobile already has an online account. Please sign in.');
    }
    let nextEmail = email || existing.email || null;
    let nextPhone = phone || existing.phone || null;
    if (nextEmail) {
      const taken = dbGet('SELECT id FROM web_customers WHERE lower(email) = ? AND id != ?', [String(nextEmail).toLowerCase(), existing.id]);
      if (taken) nextEmail = existing.email || null;
    }
    if (nextPhone) {
      const others = dbAll("SELECT id, phone FROM web_customers WHERE id != ? AND phone IS NOT NULL AND TRIM(phone) != ''", [existing.id]);
      if (others.some((r) => phonesMatch(nextPhone, r.phone))) nextPhone = existing.phone || null;
    }
    dbRun(`UPDATE web_customers SET
      customer_id = ?, first_name = ?, last_name = ?, email = ?, phone = ?,
      password_hash = ?, referred_by_code = COALESCE(?, referred_by_code),
      loyalty_points = ?, is_active = 1, updated_at = ?
      WHERE id = ?`, [
      customerId || existing.customer_id, first, last, nextEmail, nextPhone,
      hash, referral || null, loyaltyPoints, nowIso(), existing.id
    ]);
    return existing.id;
  }
  try {
    const r = dbRun(`INSERT INTO web_customers (customer_id, first_name, last_name, email, phone, password_hash, referred_by_code, loyalty_points)
      VALUES (?,?,?,?,?,?,?,?)`, [
      customerId || null, first, last, email || null, phone || null, hash, referral || null, loyaltyPoints
    ]);
    return r.lastInsertRowid
      || dbGet('SELECT id FROM web_customers WHERE customer_id = ? ORDER BY id DESC LIMIT 1', [customerId])?.id
      || dbGet('SELECT id FROM web_customers ORDER BY id DESC LIMIT 1')?.id;
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const again = findWebCustomerRow(phone, email, customerId)
      || (email ? dbGet('SELECT * FROM web_customers WHERE lower(email) = ?', [String(email).toLowerCase()]) : null)
      || (phone ? dbGet('SELECT * FROM web_customers WHERE phone = ?', [phone]) : null);
    if (!again) throw new Error('Could not activate account — please sign in or try again.');
    return upsertWebCustomer({
      existing: again, customerId, first, last, email, phone, hash, referral, loyaltyPoints
    });
  }
}

function checkWebRegistration(data = {}) {
  ensureSchema();
  ensureRegistrationSchema();
  const email = String(data.email || '').trim().toLowerCase();
  const phone = String(data.phone || data.mobile || '').trim();
  if (!email && !phone) throw new Error('Email or phone is required');

  const exists = webAccountExists(phone, email);
  if (exists.exists) return { status: 'already_online', message: exists.message };

  const pos = findPosCustomerByContact(phone, email);
  if (pos) {
    const verifyPhone = String(pos.phone || phone || '').trim();
    if (!verifyPhone) {
      return {
        status: 'pos_no_phone',
        message: 'We found your in-store profile but have no mobile number on file. Please contact the shop to add your number first.'
      };
    }
    const points = Math.floor(Number(pos.loyalty_points) || 0);
    return {
      status: 'link_existing',
      customer_id: pos.id,
      name: pos.name,
      points,
      phone_masked: maskPhone(verifyPhone),
      message: `We found your account (${pos.name}). Verify your mobile via WhatsApp, then choose a password to order online${points ? ` and use your ${points} loyalty points` : ''}.`
    };
  }
  return { status: 'new' };
}

async function sendWebRegistrationCode(data = {}) {
  ensureSchema();
  ensureRegistrationSchema();
  const check = checkWebRegistration(data);
  if (check.status === 'already_online') throw new Error(check.message);
  if (check.status !== 'link_existing') throw new Error('No existing in-store account to link — continue with normal registration');
  const pos = dbGet('SELECT * FROM customers WHERE id = ?', [check.customer_id]);
  if (!pos) throw new Error('Customer record not found');
  const verifyPhone = String(pos.phone || data.phone || '').trim();
  if (!verifyPhone) throw new Error('No mobile number on file for verification');

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const hash = bcrypt.hashSync(code, 10);
  const expires = nowPlusMin(15);
  try { dbRun('DELETE FROM web_registration_codes WHERE customer_id = ?', [pos.id]); } catch (_) { /* */ }
  dbRun(`INSERT INTO web_registration_codes (phone, email, customer_id, code_hash, expires_at)
    VALUES (?,?,?,?,?)`, [verifyPhone, String(data.email || '').trim().toLowerCase() || null, pos.id, hash, expires]);

  const shopName = dbGet('SELECT shop_name FROM shop_settings WHERE id = 1')?.shop_name || 'Shop';
  const body = `${shopName} — Your online ordering verification code is: ${code}\n\nEnter this code to activate your account. Valid for 15 minutes.\n\nDo not share this code with anyone.`;
  let sentViaApi = false;
  let url = null;
  try {
    const whatsapp = require('./whatsapp');
    const r = await whatsapp.sendMessage({
      phone: verifyPhone,
      body,
      message_type: 'verification',
      recipient_type: 'customer',
      customer_id: pos.id,
      recipient_name: pos.name,
      otp_code: code
    }, { role: 'system' });
    sentViaApi = r?.status === 'sent' || r?.via === 'cloud_api';
    if (!sentViaApi) {
      url = whatsapp.buildWaUrl(verifyPhone, body);
    }
  } catch (err) {
    console.warn('[web-reg] WhatsApp API send skipped', err.message || err);
    try {
      const whatsapp = require('./whatsapp');
      url = whatsapp.buildWaUrl(verifyPhone, body);
    } catch (_) { /* */ }
  }
  if (!sentViaApi && !url) {
    url = `https://wa.me/?text=${encodeURIComponent(body)}`;
  }

  return {
    sent: true,
    via: sentViaApi ? 'cloud_api' : 'whatsapp_open',
    whatsapp_url: sentViaApi ? null : url,
    phone_masked: maskPhone(verifyPhone),
    message: sentViaApi
      ? `Verification code sent to WhatsApp ${maskPhone(verifyPhone)}`
      : `WhatsApp is ready with your code for ${maskPhone(verifyPhone)}. Tap Send, then enter the 6-digit code here.`
  };
}

function verifyRegistrationCode(customerId, code) {
  ensureRegistrationSchema();
  const row = dbGet('SELECT * FROM web_registration_codes WHERE customer_id = ? AND expires_at > ? ORDER BY id DESC LIMIT 1',
    [Number(customerId), nowIso()]);
  if (!row) throw new Error('Verification code expired — request a new code');
  if (!bcrypt.compareSync(String(code || '').trim(), row.code_hash)) throw new Error('Incorrect verification code');
  dbRun('DELETE FROM web_registration_codes WHERE id = ?', [row.id]);
  return row;
}

function createWebSession(customerId) {
  const token = crypto.randomBytes(32).toString('hex');
  const hash = hashToken(token);
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  dbRun('INSERT INTO web_customer_sessions (web_customer_id, token_hash, expires_at) VALUES (?,?,?)', [customerId, hash, expires]);
  return { token, expires_at: expires };
}

function resolveWebCustomer(token) {
  if (!token) return null;
  ensureSchema();
  const hash = hashToken(token);
  const row = dbGet(`SELECT wc.* FROM web_customer_sessions s
    JOIN web_customers wc ON wc.id = s.web_customer_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND wc.is_active = 1`, [hash, nowIso()]);
  if (!row) return null;
  const { password_hash, ...safe } = row;
  return safe;
}

function tryAttributeReferral(customerId, webCustomerId, referralCode) {
  if (!referralCode) return;
  try {
    require('./referral-commission').attributeCustomer({
      customerId: customerId || null,
      webCustomerId: webCustomerId || null,
      code: referralCode,
      source: 'online_link'
    });
  } catch (err) {
    console.warn('[referral] register attribute:', err.message);
  }
}

function registerWebCustomer(data = {}) {
  ensureSchema();
  ensureRegistrationSchema();
  const first = String(data.first_name || data.name || '').trim();
  const last = String(data.last_name || data.surname || '').trim();
  const email = String(data.email || '').trim().toLowerCase();
  const phone = String(data.phone || data.mobile || '').trim();
  const password = String(data.password || '');
  const verificationCode = String(data.verification_code || data.code || '').trim();
  if (!first) throw new Error('First name is required');
  if (!password || password.length < 6) throw new Error('Password must be at least 6 characters');
  if (!email && !phone) throw new Error('Email or phone is required');

  const exists = webAccountExists(phone, email);
  if (exists.exists) throw new Error(exists.message);

  const posMatch = findPosCustomerByContact(phone, email);
  if (posMatch) {
    if (!verificationCode) {
      throw new Error('Your phone or email is already on our system. Verify with the WhatsApp code before choosing a password.');
    }
    verifyRegistrationCode(posMatch.id, verificationCode);
    const pos = dbGet('SELECT * FROM customers WHERE id = ?', [posMatch.id]);
    const verifyPhone = String(pos.phone || phone || '').trim();
    const hash = bcrypt.hashSync(password, 10);
    const referral = (data.referral_code || data.referred_by_code || '').trim().toUpperCase() || null;
    const loyaltyPoints = Math.floor(Number(pos.loyalty_points) || 0);
    if (email && pos.email && String(pos.email).trim().toLowerCase() !== email) {
      dbRun('UPDATE customers SET email = ?, updated_at = ? WHERE id = ?', [email, nowIso(), pos.id]);
    }
    if (verifyPhone && pos.phone !== verifyPhone) {
      dbRun('UPDATE customers SET phone = ?, updated_at = ? WHERE id = ?', [verifyPhone, nowIso(), pos.id]);
    }
    const existingWeb = findWebCustomerRow(verifyPhone || phone, email || pos.email, pos.id);
    const webId = upsertWebCustomer({
      existing: existingWeb,
      customerId: pos.id,
      first,
      last,
      email: email || pos.email || null,
      phone: verifyPhone || null,
      hash,
      referral,
      loyaltyPoints
    });
    const session = createWebSession(webId);
    const customer = resolveWebCustomer(session.token);
    tryAttributeReferral(pos.id, webId, referral);
    return { customer, token: session.token, linked: true, loyalty_points: loyaltyPoints };
  }

  const existingWeb = findWebCustomerRow(phone, email, null);
  if (existingWeb && isWebRowActive(existingWeb)) {
    throw new Error('This email or mobile already has an online account. Please sign in.');
  }

  let customerId = null;
  if (phone) {
    const existing = findPosCustomerByContact(phone, email);
    if (existing) customerId = existing.id;
    else {
      try {
        const ins = dbRun('INSERT INTO customers (name, phone, email) VALUES (?,?,?)', [`${first} ${last}`.trim(), phone, email || null]);
        customerId = ins.lastInsertRowid;
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        const again = findPosCustomerByContact(phone, email);
        customerId = again?.id || null;
      }
    }
  }

  const hash = bcrypt.hashSync(password, 10);
  const referral = (data.referral_code || data.referred_by_code || '').trim().toUpperCase() || null;
  const webId = upsertWebCustomer({
    existing: existingWeb,
    customerId,
    first,
    last,
    email: email || null,
    phone: phone || null,
    hash,
    referral,
    loyaltyPoints: 0
  });
  const session = createWebSession(webId);
  const customer = resolveWebCustomer(session.token);
  tryAttributeReferral(customerId, webId, referral);
  return { customer, token: session.token };
}

function findWebCustomerByLogin(login) {
  ensureSchema();
  const id = String(login || '').trim();
  if (!id) return null;
  const active = (r) => !!(r && r.is_active !== 0 && r.is_active !== false && r.is_active !== '0');
  if (id.includes('@')) {
    const byEmail = dbGet('SELECT * FROM web_customers WHERE lower(email) = lower(?) ORDER BY id DESC LIMIT 1', [id]);
    if (byEmail && active(byEmail)) return byEmail;
  }
  // Digits-only match first (handles spaces / +27 / leading 0). Avoid SQL is_active=1 (PG boolean vs int).
  const digits = id.replace(/\D/g, '');
  const rows = dbAll("SELECT * FROM web_customers WHERE phone IS NOT NULL AND TRIM(phone) != ''");
  for (const r of rows) {
    if (!active(r)) continue;
    if (phonesMatch(id, r.phone)) return r;
    if (digits && phonesMatch(digits, r.phone)) return r;
  }
  const exact = dbGet('SELECT * FROM web_customers WHERE (lower(email) = lower(?) OR phone = ?) ORDER BY id DESC LIMIT 1', [id, id]);
  if (exact && active(exact)) return exact;
  try {
    const pos = findPosCustomerByContact(id.includes('@') ? '' : id, id.includes('@') ? id : '');
    if (pos?.id) {
      const linked = dbGet('SELECT * FROM web_customers WHERE customer_id = ? ORDER BY id DESC LIMIT 1', [pos.id]);
      if (linked && active(linked)) return linked;
    }
  } catch (_) { /* optional POS link */ }
  return null;
}

function loginWebCustomer(login, password) {
  ensureSchema();
  const id = String(login || '').trim();
  const pass = String(password || '');
  if (!id || !pass) throw new Error('Check your email or phone and password');
  let row = findWebCustomerByLogin(id);
  // Soft fallback: inactive accounts with a password still get a clear message
  if (!row) {
    let inactive = null;
    if (id.includes('@')) {
      inactive = dbGet('SELECT * FROM web_customers WHERE lower(email) = lower(?) LIMIT 1', [id]);
    } else {
      const digits = id.replace(/\D/g, '');
      const all = dbAll("SELECT * FROM web_customers WHERE phone IS NOT NULL AND TRIM(phone) != ''");
      inactive = (all || []).find((r) => phonesMatch(id, r.phone) || (digits && phonesMatch(digits, r.phone))) || null;
    }
    if (inactive && Number(inactive.is_active) === 0) {
      throw new Error('This online account is deactivated — contact the shop');
    }
  }
  if (!row || !row.password_hash || !bcrypt.compareSync(pass, row.password_hash)) {
    throw new Error('Check your email or phone and password');
  }
  const session = createWebSession(row.id);
  const { password_hash, ...safe } = row;
  return { customer: safe, token: session.token };
}

function ensurePasswordResetSchema() {
  const sqliteSql = `CREATE TABLE IF NOT EXISTS web_password_resets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      web_customer_id INTEGER NOT NULL,
      contact TEXT,
      channel TEXT,
      code_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )`;
  const pgSql = `CREATE TABLE IF NOT EXISTS web_password_resets (
      id SERIAL PRIMARY KEY,
      web_customer_id INTEGER NOT NULL,
      contact TEXT,
      channel TEXT,
      code_hash TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`;
  try {
    dbRun(isPgCloud() ? pgSql : sqliteSql);
  } catch (err) {
    const msg = String(err.message || err);
    if (!/already exists/i.test(msg)) {
      try { dbRun(isPgCloud() ? sqliteSql : pgSql); } catch (err2) {
        const msg2 = String(err2.message || err2);
        if (!/already exists/i.test(msg2)) {
          console.warn('[online-ordering] web_password_resets:', msg2.slice(0, 200));
        }
      }
    }
  }
  try {
    dbRun('CREATE INDEX IF NOT EXISTS idx_web_password_resets_customer ON web_password_resets(web_customer_id)');
  } catch (_) { /* index may exist */ }
}

function maskEmail(email) {
  const e = String(email || '').trim();
  const at = e.indexOf('@');
  if (at < 1) return '***';
  const name = e.slice(0, at);
  const domain = e.slice(at);
  return `${name.slice(0, 2)}***${domain}`;
}

async function sendCustomerWhatsApp(phone, body, opts = {}) {
  let sentViaApi = false;
  let url = null;
  try {
    const whatsapp = require('./whatsapp');
    const r = await whatsapp.sendMessage({
      phone,
      body,
      message_type: opts.message_type || 'verification',
      recipient_type: 'customer',
      customer_id: opts.customer_id || null,
      recipient_name: opts.recipient_name || '',
      otp_code: opts.otp_code
    }, { role: 'system' });
    sentViaApi = r?.status === 'sent' || r?.via === 'cloud_api';
    // Always keep a wa.me link so the customer can open WhatsApp and send the code to themselves.
    url = whatsapp.buildWaUrl(phone, body);
  } catch (_) {
    try {
      const whatsapp = require('./whatsapp');
      url = whatsapp.buildWaUrl(phone, body);
    } catch (__) { /* */ }
  }
  if (!url && phone) {
    url = `https://wa.me/?text=${encodeURIComponent(body)}`;
  }
  return { sentViaApi, url };
}

async function sendWebPasswordReset(data = {}) {
  ensureSchema();
  ensurePasswordResetSchema();
  const email = String(data.email || '').trim().toLowerCase();
  const phone = String(data.phone || data.login || '').trim();
  const login = email || phone;
  if (!login) throw new Error('Enter the email or phone on your account');
  const row = findWebCustomerByLogin(login);
  if (!row) throw new Error('No online account found for that email or phone');

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const hash = bcrypt.hashSync(code, 10);
  try { dbRun('DELETE FROM web_password_resets WHERE web_customer_id = ?', [row.id]); } catch (_) { /* */ }
  const channel = (email || login.includes('@')) ? 'email' : 'phone';
  dbRun(`INSERT INTO web_password_resets (web_customer_id, contact, channel, code_hash, expires_at)
    VALUES (?,?,?,?,?)`, [row.id, row.phone || row.email || login, channel, hash, nowPlusMin(15)]);

  const shopName = dbGet('SELECT shop_name FROM shop_settings WHERE id = 1')?.shop_name || 'Shop';
  const body = `${shopName} — Your password reset code is: ${code}\n\nEnter this code on Order Online, then type your new password. Valid for 15 minutes.\n\nDo not share this code.`;
  const waPhone = row.phone || (!login.includes('@') ? phone : '');
  let via = 'none';
  let whatsappUrl = null;
  let emailUrl = null;
  if (waPhone) {
    const sent = await sendCustomerWhatsApp(waPhone, body, {
      customer_id: row.customer_id || null,
      recipient_name: `${row.first_name || ''} ${row.last_name || ''}`.trim(),
      otp_code: code,
      message_type: 'password_reset'
    });
    via = sent.sentViaApi ? 'whatsapp' : 'whatsapp_open';
    // Always expose wa.me so the customer can open WhatsApp and send the code to themselves (same as Order Online UX).
    whatsappUrl = sent.url || null;
    if (!whatsappUrl && waPhone) {
      try {
        const whatsapp = require('./whatsapp');
        whatsappUrl = whatsapp.buildWaUrl(waPhone, body);
      } catch (_) { /* */ }
    }
  }
  // Also route through Communication Center using configured recovery channels (SMS/Email/WhatsApp)
  try {
    const cc = require('./communication-center');
    const recovery = cc.getSettings()?.recovery || {};
    const channels = Array.isArray(recovery.channels) && recovery.channels.length
      ? recovery.channels
      : ['whatsapp'];
    cc.emit('auth.password_recovery', {
      customer_name: `${row.first_name || ''} ${row.last_name || ''}`.trim(),
      customer_phone: waPhone || row.phone,
      customer_email: row.email,
      phone: waPhone || row.phone,
      email: row.email,
      verification_code: code,
      expiry: 15
    }, {
      channels,
      recipients: ['customer'],
      body,
      transactional: true,
      source_module: 'online-ordering',
      priority: 5,
      dedupe_key: `pwdreset:${row.id}:${new Date().toISOString().slice(0, 16)}`
    });
  } catch (_) { /* CC optional */ }
  if (row.email && (channel === 'email' || !waPhone)) {
    emailUrl = `mailto:${encodeURIComponent(row.email)}?subject=${encodeURIComponent(`${shopName} password reset`)}&body=${encodeURIComponent(body)}`;
    if (via === 'none') via = 'email_open';
  }
  if (via === 'none') throw new Error('This account has no WhatsApp number or email to send a reset code');

  const bits = [];
  if (waPhone) bits.push(`WhatsApp ${maskPhone(waPhone)}`);
  if (row.email && (channel === 'email' || !waPhone)) bits.push(maskEmail(row.email));
  return {
    sent: true,
    via,
    whatsapp_url: whatsappUrl,
    email_url: emailUrl,
    phone_masked: waPhone ? maskPhone(waPhone) : '',
    email_masked: row.email ? maskEmail(row.email) : '',
    login_hint: login,
    message: via === 'whatsapp'
      ? `Reset code sent to ${bits.join(' and ')}`
      : `Your reset code is ready for ${bits.join(' and ')}. Open the message, then enter the 6-digit code here.`
  };
}

function resetWebPassword(data = {}) {
  ensureSchema();
  ensurePasswordResetSchema();
  const login = String(data.email || data.phone || data.login || '').trim();
  const code = String(data.code || data.verification_code || '').trim();
  const password = String(data.password || data.new_password || '');
  if (!login) throw new Error('Enter your email or phone');
  if (code.length < 4) throw new Error('Enter the reset code');
  if (password.length < 6) throw new Error('New password must be at least 6 characters');
  const row = findWebCustomerByLogin(login);
  if (!row) throw new Error('No online account found for that email or phone');
  const reset = dbGet('SELECT * FROM web_password_resets WHERE web_customer_id = ? AND expires_at > ? ORDER BY id DESC LIMIT 1',
    [row.id, nowIso()]);
  if (!reset) throw new Error('Reset code expired — request a new code');
  if (!bcrypt.compareSync(code, reset.code_hash)) throw new Error('Incorrect reset code');
  dbRun('UPDATE web_customers SET password_hash = ?, updated_at = ? WHERE id = ?', [bcrypt.hashSync(password, 10), nowIso(), row.id]);
  dbRun('DELETE FROM web_password_resets WHERE web_customer_id = ?', [row.id]);
  try { dbRun('UPDATE web_customer_sessions SET expires_at = ? WHERE web_customer_id = ?', [nowIso(), row.id]); } catch (_) { /* */ }
  return { success: true, message: 'Password updated. Sign in with your new password.' };
}

function validateCart(branchId, cart = {}) {
  ensureSchema();
  const items = Array.isArray(cart.items) ? cart.items : [];
  const lines = [];
  let subtotal = 0;
  const errors = [];

  if (!items.length) {
    errors.push('Your cart is empty — add at least one item');
  }

  for (const item of items) {
    const comboId = Number(item.combo_id) || parseComboRef(item.product_id);
    const qty = Math.max(1, Number(item.quantity) || 1);
    if (comboId) {
      const combosSvc = require('./combos');
      const combo = combosSvc.getCombo(comboId);
      if (!combo) { errors.push(`Combo #${comboId} not found`); continue; }
      if (!comboAvailableAtBranch(combo, branchId)) {
        errors.push(`${combo.name} is not available at this branch`);
        continue;
      }
      const components = Array.isArray(item.combo_components) ? item.combo_components : [];
      const avail = combosSvc.comboAvailableUnits(combo, branchId)
        - (combo.combo_kind === 'custom' && combo.stock_quantity != null ? comboPendingOnlineQty(comboId, branchId) : 0);
      if (qty > avail) {
        errors.push(avail > 0 ? `Only ${avail} of ${combo.name} available` : `${combo.name} is out of stock`);
        continue;
      }
      const unitPrice = round2(combosSvc.comboSaleUnitPrice(combo, components));
      const lineTotal = round2(unitPrice * qty);
      subtotal = round2(subtotal + lineTotal);
      const modText = components.length
        ? components.map((c) => {
          const base = `${c.product_name || 'Item'}`;
          return c.modifiers_text ? `${base} (${c.modifiers_text})` : base;
        }).join('; ')
        : (combo.items || []).map((ci) => ci.product_name).join(', ');
      lines.push({
        combo_id: comboId,
        product_id: null,
        remote_id: null,
        name: combo.name,
        quantity: qty,
        unit_price: unitPrice,
        line_total: lineTotal,
        modifiers: [],
        combo_components: components,
        modifiers_text: modText
      });
      continue;
    }
    const productId = Number(item.product_id);
    const product = dbGet('SELECT * FROM products WHERE id = ?', [productId]);
    if (!product) { errors.push(`Product #${productId} not found`); continue; }
    if (!productAvailableAtBranch(product, branchId)) {
      errors.push(`${product.name} is out of stock at this branch`);
      continue;
    }
    const promos = getActivePromotions(branchId);
    let productPromo = null;
    try {
      productPromo = require('./promo-requests').getActivePromosMap('online')[productId] || null;
    } catch (_) { /* optional */ }
    const mapped = mapProductForWeb(product, branchId, promos, productPromo);
    const selectedMods = [];
    let modExtra = 0;
    const modGroups = getModifiersForProduct(productId, branchId);
    const chosen = Array.isArray(item.modifiers) ? item.modifiers : [];
    for (const g of modGroups) {
      const picks = chosen.filter((c) => g.options.some((o) => String(o.id) === String(c.id) || o.name === c.name));
      if (g.required && !picks.length) errors.push(`${product.name}: please choose ${g.name}`);
      for (const pick of picks) {
        const mod = g.options.find((o) => String(o.id) === String(pick.id) || o.name === pick.name);
        if (!mod || mod.out_of_stock) { errors.push(`${pick.name || 'Option'} unavailable`); continue; }
        modExtra += Number(mod.extra_price) || 0;
        selectedMods.push({
          id: mod.id, name: mod.name, extra_price: mod.extra_price,
          modifier_type: mod.modifier_type, group: g.name
        });
      }
    }
    const hasRecipe = Number(product.has_recipe) === 1;
    const makeToOrder = hasRecipe && String(product.production_mode || '') !== 'make_to_stock';
    if (makeToOrder) {
      try {
        const snap = require('./production-availability').calculateProductCapacity(productId, {
          selectedModifiers: selectedMods,
          forOnline: !selectedMods.length
        });
        const meals = Number(snap?.available_meals) || 0;
        if (qty > meals) {
          errors.push(meals > 0 ? `Only ${meals} of ${product.name} available` : `${product.name} is out of stock`);
          continue;
        }
      } catch (_) {
        errors.push(`${product.name} is out of stock at this branch`);
        continue;
      }
    } else {
      const stock = branchStockQty(productId, branchId);
      if (qty > stock) {
        errors.push(`Only ${stock} of ${product.name} available`);
        continue;
      }
    }
    const unitPrice = promoPricing.calcPromoAwareUnitPrice({
      promoActive: mapped.on_sale,
      normalPrice: mapped.price,
      salePrice: mapped.sale_price ?? mapped.price,
      modifiers: selectedMods,
      modifierExtraTotal: modExtra
    });
    const lineTotal = round2(unitPrice * qty);
    subtotal = round2(subtotal + lineTotal);
    lines.push({
      product_id: productId,
      remote_id: productId,
      name: product.name,
      quantity: qty,
      unit_price: unitPrice,
      line_total: lineTotal,
      modifiers: selectedMods,
      modifiers_text: selectedMods.map((m) => m.name).join(', ')
    });
  }

  const fulfillment = cart.fulfillment_type || 'collection';
  const branchSettings = getBranchOnlineSettings(branchId);
  let deliveryFee = 0;
  let deliveryPlace = null;
  if (fulfillment === 'delivery') {
    if (!branchSettings.delivery_enabled) errors.push('Delivery is not available at this branch');
    const places = branchSettings.delivery_places || branchSettings.delivery_zones || [];
    const placeKey = cart.delivery_place_id || cart.delivery_place || cart.delivery_place_name || '';
    if (places.length) {
      deliveryPlace = places.find((p) =>
        String(p.id) === String(placeKey) || String(p.name || '').toLowerCase() === String(placeKey).toLowerCase()
      ) || null;
      if (!deliveryPlace && placeKey) {
        errors.push('Select a valid delivery place');
      } else if (!deliveryPlace) {
        errors.push('Choose a delivery place');
      } else {
        const minOrd = Number(deliveryPlace.min_order) || 0;
        if (subtotal < minOrd) errors.push(`Minimum delivery order for ${deliveryPlace.name} is ${minOrd}`);
        const freeAbove = Number(deliveryPlace.free_delivery_above) || 0;
        const fee = Number(deliveryPlace.delivery_fee) || 0;
        deliveryFee = freeAbove > 0 && subtotal >= freeAbove ? 0 : fee;
      }
    } else {
      if (subtotal < (branchSettings.min_delivery_order || 0)) {
        errors.push(`Minimum delivery order is ${branchSettings.min_delivery_order}`);
      }
      deliveryFee = subtotal >= (branchSettings.free_delivery_above || 0) && branchSettings.free_delivery_above > 0
        ? 0 : Number(branchSettings.delivery_fee) || 0;
    }
  }

  let discount = 0;
  let couponApplied = null;
  if (cart.coupon_code) {
    const couponResult = validateCoupon(cart.coupon_code, branchId, { subtotal, items: lines }, cart.web_customer_id);
    const isReferral = couponResult && (couponResult.type === 'referral' || couponResult.ok);
    if (isReferral) {
      discount = Number(couponResult.discount) || 0;
      couponApplied = {
        code: couponResult.code,
        type: 'referral',
        discount_type: couponResult.discount_percent ? 'percent' : 'amount',
        discount_percent: couponResult.discount_percent || 0,
        agent_id: couponResult.agent_id || null,
        message: couponResult.message
      };
    } else if (getGlobalSettings().online?.coupons_enabled === false) {
      errors.push('Coupon codes are disabled for online orders');
    } else if (couponResult.error) {
      errors.push(couponResult.error);
    } else {
      discount = Number(couponResult.discount) || 0;
      couponApplied = couponResult.coupon || couponResult;
    }
  }

  let loyaltyDiscount = 0;
  let pointsUsed = 0;
  const requestedPoints = Math.max(0, Number(cart.loyalty_points_used) || 0);
  if (requestedPoints > 0) {
    const settings = getGlobalSettings();
    if (!settings.online.loyalty_enabled || !settings.loyalty.enabled) {
      errors.push('Loyalty redemption is disabled');
    } else if (cart.web_customer_id) {
      const wc = dbGet('SELECT loyalty_points, customer_id FROM web_customers WHERE id = ?', [cart.web_customer_id]);
      let customerId = wc?.customer_id || null;
      let balance = Number(wc?.loyalty_points) || 0;
      if (customerId) {
        const c = dbGet('SELECT loyalty_points FROM customers WHERE id = ?', [customerId]);
        balance = Math.max(balance, Number(c?.loyalty_points) || 0);
      }
      const preTaxTotal = Math.max(0, subtotal - (discount || 0));
      if (customerId) {
        try {
          const features = require('./features');
          const redemption = features.calcLoyaltyRedemption(customerId, requestedPoints, preTaxTotal + deliveryFee);
          pointsUsed = redemption.points;
          loyaltyDiscount = round2(redemption.discount);
        } catch (err) {
          errors.push(err.message || 'Invalid loyalty redemption');
        }
      } else if (requestedPoints > balance) {
        errors.push('Insufficient loyalty points');
      } else {
        const rate = Number(settings.loyalty.point_value) || 1;
        pointsUsed = Math.min(requestedPoints, balance, Math.floor(preTaxTotal / rate));
        loyaltyDiscount = round2(pointsUsed * rate);
      }
    } else {
      errors.push('Sign in to use loyalty points');
    }
  }

  const shop = getGlobalSettings();
  const cartDiscount = round2(discount + loyaltyDiscount);
  const taxTotals = calcOnlineTaxTotals(
    subtotal,
    cartDiscount,
    shop.tax_rate,
    shop.tax_enabled,
    shop.tax_inclusive
  );

  // Platform service fee (visible — never silent). Snapshot config for the quote.
  let serviceFee = 0;
  let serviceFeeLabel = '';
  let serviceFeeDisplay = null;
  let serviceFeeConfig = null;
  try {
    const cp = require('./platform-control-plane');
    const entitlements = require('./entitlements');
    const shopKey = entitlements.shopKey?.() || process.env.SHOP_ENTITLEMENT_KEY || null;
    let packageId = process.env.SHOP_PACKAGE_ID || null;
    if (shopKey) {
      try {
        const { getDb } = require('../database/db');
        const row = getDb().prepare('SELECT package_id FROM platform_shops WHERE id = ?').get(shopKey);
        if (row?.package_id) packageId = row.package_id;
      } catch (_) { /* */ }
    }
    const feeBase = round2(Math.max(0, taxTotals.total + deliveryFee));
    const fee = cp.calculateServiceFee(feeBase, { package_id: packageId, shop_id: shopKey });
    if (fee.enabled && fee.amount > 0) {
      serviceFee = fee.amount;
      serviceFeeLabel = fee.label || 'Platform service fee';
      serviceFeeDisplay = fee.display;
      serviceFeeConfig = fee.config;
    }
  } catch (_) { /* control plane optional */ }

  const totalBeforeGift = round2(Math.max(0, taxTotals.total + deliveryFee + serviceFee));
  let giftCardAmount = 0;
  let giftCardCode = null;
  if (cart.gift_card_code) {
    if (shop.online?.gift_cards_enabled === false) {
      errors.push('Gift card redemption is disabled for online orders');
    } else {
    try {
      const features = require('./features');
      const card = features.checkGiftCardBalance(String(cart.gift_card_code).trim().toUpperCase());
      if (cart.web_customer_id) {
        const wc = dbGet('SELECT * FROM web_customers WHERE id = ?', [cart.web_customer_id]);
        if (wc) require('./first-online-gift').assertGiftOwnedByWebCustomer(card.code, wc);
      }
      giftCardAmount = round2(Math.min(Number(card.balance) || 0, totalBeforeGift));
      giftCardCode = card.code;
      if (!giftCardAmount) errors.push('Gift card has no balance to apply');
    } catch (err) {
      errors.push(err.message || 'Invalid gift card');
    }
    }
  }
  const total = round2(Math.max(0, totalBeforeGift - giftCardAmount));

  return {
    valid: errors.length === 0,
    errors,
    lines,
    subtotal,
    discount: cartDiscount,
    coupon: couponApplied,
    loyalty_points_used: pointsUsed,
    loyalty_discount: loyaltyDiscount,
    gift_card_code: giftCardCode,
    gift_card_amount: giftCardAmount,
    delivery_fee: deliveryFee,
    delivery_place: deliveryPlace ? deliveryPlace.name : null,
    delivery_place_id: deliveryPlace ? deliveryPlace.id : null,
    delivery_place_fee: deliveryPlace ? Number(deliveryPlace.delivery_fee) || 0 : null,
    service_fee: serviceFee,
    service_fee_label: serviceFeeLabel,
    service_fee_display: serviceFeeDisplay,
    service_fee_config: serviceFeeConfig,
    tax_amount: taxTotals.tax_amount,
    total,
    total_before_gift: totalBeforeGift,
    branch_id: branchId,
    fulfillment_type: fulfillment
  };
}

function validateCoupon(code, branchId, cartCtx = {}, webCustomerId = null) {
  const value = String(code || '').trim();
  if (!value) return { error: 'Coupon code required', discount: 0 };
  try {
    const ref = require('./referral-commission').validateReferralCode(value);
    if (ref && ref.type === 'referral') {
      // Attribute if we know the web customer / linked POS customer
      try {
        const wc = webCustomerId ? dbGet('SELECT * FROM web_customers WHERE id = ?', [webCustomerId]) : null;
        if (wc?.customer_id || webCustomerId) {
          require('./referral-commission').attributeCustomer({
            customerId: wc?.customer_id || null,
            webCustomerId: webCustomerId || null,
            code: value,
            source: 'online_code'
          });
        }
      } catch (_) { /* first-referrer-wins or self-ref */ }
      const discount = Number(ref.discount_amount) || 0;
      const pct = Number(ref.discount_percent) || 0;
      let disc = discount;
      if (!disc && pct > 0 && cartCtx.subtotal) disc = Math.round((Number(cartCtx.subtotal) * pct) / 100 * 100) / 100;
      return {
        ok: true,
        type: 'referral',
        code: ref.code,
        agent_id: ref.agent_id,
        discount: disc,
        discount_percent: pct,
        message: `Referral code ${ref.code} applied`
      };
    }
  } catch (_) { /* not a referral code */ }
  try {
    const vouchers = require('./discount-vouchers');
    let customerId = null;
    try {
      if (webCustomerId) {
        const wc = dbGet('SELECT customer_id FROM web_customers WHERE id = ?', [webCustomerId]);
        customerId = wc?.customer_id || null;
      }
    } catch (_) { /* */ }
    const v = vouchers.validateVoucher(value, {
      subtotal: Number(cartCtx.subtotal) || 0,
      items: cartCtx.items || [],
      customerId,
      requireCustomer: false
    });
    if (v.ok) {
      if (v.customer_id && customerId && Number(v.customer_id) !== Number(customerId)) {
        return { error: 'This voucher is for a different customer', discount: 0 };
      }
      return {
        ok: true,
        type: 'discount_voucher',
        code: v.code,
        discount: v.discount,
        discount_percent: v.discount_type === 'percent' ? v.discount_value : 0,
        voucher_id: v.voucher_id,
        product_id: v.product_id,
        message: v.message || `Voucher ${v.code} applied`
      };
    }
    if (v.error && v.error !== 'Invalid voucher code') return { error: v.error, discount: 0 };
  } catch (_) { /* no voucher table yet */ }
  return { error: 'Invalid coupon code', discount: 0 };
}

function nextOnlineOrderNumber() {
  const prefix = 'ONLINE-';
  const row = dbGet(`SELECT order_number FROM online_orders_local WHERE order_number LIKE ? ORDER BY id DESC LIMIT 1`, [`${prefix}%`]);
  let n = 1000;
  if (row?.order_number) {
    const m = String(row.order_number).match(/(\d+)$/);
    if (m) n = parseInt(m[1], 10) + 1;
  }
  return `${prefix}${n}`;
}

function logOrderEvent(orderId, status, note, actorType = 'system', actorId = null) {
  try {
    dbRun('INSERT INTO online_order_events (order_id, status, note, actor_type, actor_id) VALUES (?,?,?,?,?)',
      [orderId, status, note || null, actorType, actorId]);
    const order = dbGet('SELECT audit_json FROM online_orders_local WHERE id = ?', [orderId]);
    const audit = parseJson(order?.audit_json, []);
    audit.push({ status, note, at: new Date().toISOString(), actor_type: actorType, actor_id: actorId });
    dbRun('UPDATE online_orders_local SET audit_json = ? WHERE id = ?', [JSON.stringify(audit), orderId]);
  } catch (_) { /* */ }
}

function submitOrder(branchId, payload = {}, webToken = null, idempotencyKey = null) {
  ensureSchema();
  const global = getGlobalSettings();
  if (!global.online.enabled) throw new Error('Online ordering is currently disabled');

  if (idempotencyKey) {
    const existing = dbGet('SELECT * FROM online_orders_local WHERE idempotency_key = ?', [idempotencyKey]);
    if (existing) return formatOrder(existing);
  }

  const customer = resolveWebCustomer(webToken);
  if (!customer) throw new Error('Please sign in to place an order');

  const branchSettings = getBranchOnlineSettings(branchId);
  if (!branchSettings?.online_enabled || branchSettings.status === 'closed') {
    throw new Error('This branch is not accepting online orders');
  }
  if (branchSettings.busy_mode && branchSettings.status === 'busy') {
    throw new Error('Branch is busy — please try again shortly');
  }

  const cart = validateCart(branchId, {
    ...payload,
    web_customer_id: customer.id,
    fulfillment_type: payload.fulfillment_type || 'collection',
    coupon_code: payload.coupon_code || payload.referral_code || null,
    loyalty_points_used: payload.loyalty_points_used,
    gift_card_code: payload.gift_card_code
  });
  if (!cart.valid) throw new Error(cart.errors.join('; '));
  if (!cart.lines.length) throw new Error('Your cart is empty — add at least one item');

  const referralCodeUsed = String(
    payload.referral_code || payload.coupon_code || cart.coupon?.code || ''
  ).trim().toUpperCase() || null;
  if (referralCodeUsed) {
    tryAttributeReferral(customer.customer_id, customer.id, referralCodeUsed);
  }

  ensureOrderGiftColumns();
  ensureOrderTrackingColumns();
  ensureOrderServiceFeeColumns();
  const orderNumber = nextOnlineOrderNumber();
  const fulfillment = payload.fulfillment_type || 'collection';
  const payment = resolvePaymentForOrder({ ...payload, expected_total: cart.total }, fulfillment);
  const payNorm = String(payment.payment_status || '').toLowerCase();
  const initialStatus = (payNorm === 'paid')
    ? 'pending'
    : ((payNorm === 'pending_payment' || payNorm === 'pending' || payment.gateway_checkout)
      ? 'pending_payment'
      : 'pending');
  const itemsJson = JSON.stringify(cart.lines);
  let confirmationCode = null;
  let trackingToken = null;
  if (fulfillment === 'delivery') {
    try {
      const delivery = require('./delivery-platform');
      confirmationCode = delivery.nextConfirmationCode();
      trackingToken = crypto.randomBytes(16).toString('hex');
    } catch (_) { /* optional */ }
  }
  const r = dbRun(`INSERT INTO online_orders_local (
    order_number, branch_id, order_source, web_customer_id, customer_id, customer_name, customer_phone, customer_email,
    items_json, subtotal, discount, delivery_fee, tax_amount, total, coupon_code, loyalty_points_used,
    gift_card_code, gift_card_amount,
    payment_method, payment_status, fulfillment_type, fulfillment, delivery_address, scheduled_for, notes, status, idempotency_key,
    confirmation_code, tracking_token
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
    orderNumber, branchId, 'ONLINE', customer.id, customer.customer_id,
    `${customer.first_name} ${customer.last_name || ''}`.trim(),
    customer.phone, customer.email, itemsJson,
    cart.subtotal, cart.discount, cart.delivery_fee, cart.tax_amount, cart.total,
    referralCodeUsed || payload.coupon_code || null, cart.loyalty_points_used || 0,
    cart.gift_card_code || null, cart.gift_card_amount || 0,
    payment.payment_method, payment.payment_status,
    fulfillment, fulfillment,
    (() => {
      const place = cart.delivery_place || payload.delivery_place || null;
      const addr = String(payload.delivery_address || '').trim();
      if (place && addr) return `${place} — ${addr}`;
      return addr || place || null;
    })(),
    payload.scheduled_for || null,
    [
      payload.notes || null,
      cart.delivery_place ? `Delivery place: ${cart.delivery_place}` : null,
      cart.delivery_place_id ? `Place ID: ${cart.delivery_place_id}` : null
    ].filter(Boolean).join(' · ') || null,
    initialStatus, idempotencyKey || null,
    confirmationCode, trackingToken
  ]);

  const orderId = r.lastInsertRowid;
  try {
    dbRun(
      `UPDATE online_orders_local SET service_fee=?, service_fee_label=?, service_fee_config_json=? WHERE id=?`,
      [
        cart.service_fee || 0,
        cart.service_fee_label || '',
        JSON.stringify(cart.service_fee_config || {}),
        orderId
      ]
    );
  } catch (_) { /* column optional */ }
  logOrderEvent(orderId, 'received', 'Order placed online', 'customer', customer.id);

  for (const line of cart.lines) {
    if (line.combo_id) {
      const combo = require('./combos').getCombo(Number(line.combo_id));
      if (combo?.combo_kind === 'custom') continue;
      for (const ci of combo?.items || []) {
        if (!ci.product_id) continue;
        const reserveQty = (Number(line.quantity) || 1) * (Number(ci.quantity) || 1);
        try {
          dbRun(`INSERT INTO web_stock_reservations (order_id, product_id, branch_id, quantity, status, expires_at)
            VALUES (?,?,?,?, 'reserved', ?)`,
            [orderId, ci.product_id, branchId, reserveQty, nowPlusMin(30)]);
        } catch (_) { /* */ }
      }
      continue;
    }
    try {
      dbRun(`INSERT INTO web_stock_reservations (order_id, product_id, branch_id, quantity, status, expires_at)
        VALUES (?,?,?,?, 'reserved', ?)`,
        [orderId, line.product_id, branchId, line.quantity, nowPlusMin(30)]);
    } catch (_) { /* */ }
  }

  if (referralCodeUsed || payload.coupon_code) {
    try {
      dbRun('INSERT INTO web_coupon_redemptions (order_id, coupon_code, web_customer_id, branch_id, discount_amount) VALUES (?,?,?,?,?)',
        [orderId, referralCodeUsed || payload.coupon_code, customer.id, branchId, cart.discount]);
    } catch (_) { /* */ }
    try {
      if (cart.coupon?.type === 'discount_voucher' || cart.coupon?.voucher_id) {
        require('./discount-vouchers').redeemVoucher(cart.coupon.code || payload.coupon_code, {
          subtotal: cart.subtotal,
          items: cart.lines || cart.items || [],
          channel: 'order_online',
          customerId: customer?.customer_id || null
        });
      }
    } catch (_) { /* voucher already used or missing */ }
  }

  if (cart.loyalty_points_used > 0 && customer.customer_id) {
    try {
      const features = require('./features');
      features.redeemLoyaltyPoints(customer.customer_id, cart.loyalty_points_used, null);
    } catch (err) {
      dbRun('DELETE FROM online_orders_local WHERE id = ?', [orderId]);
      throw new Error(err.message || 'Could not redeem loyalty points');
    }
  }

  if (cart.gift_card_amount > 0 && cart.gift_card_code) {
    try {
      const features = require('./features');
      features.redeemGiftCard(cart.gift_card_code, cart.gift_card_amount, null, null);
    } catch (err) {
      if (cart.loyalty_points_used > 0 && customer.customer_id) {
        try {
          const features = require('./features');
          const db = getDb();
          db.prepare('UPDATE customers SET loyalty_points = COALESCE(loyalty_points, 0) + ? WHERE id = ?').run(cart.loyalty_points_used, customer.customer_id);
        } catch (_) { /* */ }
      }
      dbRun('DELETE FROM online_orders_local WHERE id = ?', [orderId]);
      throw new Error(err.message || 'Could not redeem gift card');
    }
  }

  const order = dbGet('SELECT * FROM online_orders_local WHERE id = ?', [orderId]);
  if (fulfillment === 'delivery') {
    try {
      const delivery = require('./delivery-platform');
      delivery.upsertFromOnlineOrder(order);
    } catch (err) {
      console.warn('[delivery] online order upsert:', err.message || err);
    }
  }
  if (confirmationCode && customer.phone) {
    const waBody = `Hi ${`${customer.first_name}`.trim()}! Your order ${orderNumber} is confirmed.\n\nYour delivery code: *${confirmationCode}*\n\nGive this code to the driver when they arrive. Thank you!`;
    sendCustomerWhatsApp(customer.phone, waBody, branchId);
  }
  try { require('./store').notifyPosOnlineOrder(order); } catch (_) { /* */ }
  try { require('./mobile-manager').notifyOnlineOrder(orderId); } catch (_) { /* */ }
  try {
    const cc = require('./communication-center');
    const total = order.total != null ? order.total : order.grand_total;
    cc.emit('order.new', {
      customer_name: `${customer.first_name || ''} ${customer.last_name || ''}`.trim() || 'Customer',
      customer_phone: customer.phone,
      customer_email: customer.email,
      customer_id: customer.customer_id || customer.id,
      order_number: orderNumber,
      order_total: total,
      branch: order.branch_name || '',
      branch_id: branchId,
      announcement: `New order ${orderNumber}`
    }, {
      template_slug: 'cc_order_new_customer',
      source_module: 'online-ordering',
      transactional: true,
      dedupe_key: `order.new:${orderId}`
    });
  } catch (_) { /* CC optional */ }
  let firstGift = null;
  try {
    firstGift = require('./first-online-gift').maybeAwardFromSubmit(order, customer);
  } catch (_) { /* optional */ }
  return formatOrder(order, firstGift);
}

function formatOrder(row, firstGiftAward = null) {
  if (!row) return null;
  const events = dbAll('SELECT * FROM online_order_events WHERE order_id = ? ORDER BY id', [row.id]);
  let confirmationCode = row.confirmation_code || null;
  let deliveryRow = null;
  try {
    deliveryRow = dbGet('SELECT * FROM delivery_assignments WHERE source_type=? AND source_id=?', ['online_order', row.id]);
    if (!confirmationCode && deliveryRow?.confirmation_code) confirmationCode = deliveryRow.confirmation_code;
    if (confirmationCode && deliveryRow && deliveryRow.confirmation_code !== confirmationCode) {
      try {
        dbRun('UPDATE delivery_assignments SET confirmation_code=? WHERE id=?', [confirmationCode, deliveryRow.id]);
      } catch (_) { /* optional */ }
    }
  } catch (_) { /* optional */ }
  if (!confirmationCode && (row.fulfillment_type === 'delivery' || row.fulfillment === 'delivery')) {
    try {
      const delivery = require('./delivery-platform');
      confirmationCode = delivery.nextConfirmationCode();
      dbRun('UPDATE online_orders_local SET confirmation_code=? WHERE id=?', [confirmationCode, row.id]);
      if (deliveryRow?.id) {
        dbRun('UPDATE delivery_assignments SET confirmation_code=? WHERE id=?', [confirmationCode, deliveryRow.id]);
      }
    } catch (_) { /* optional */ }
  }
  const trackingSteps = buildTrackingSteps(row, deliveryRow);
  const activeStep = trackingSteps.find((s) => s.active) || trackingSteps.filter((s) => s.done).pop();
  let driver = null;
  if (deliveryRow?.driver_id) {
    try {
      const dp = require('./delivery-platform');
      driver = dp.driverPublicInfo(deliveryRow.driver_id);
    } catch (_) { /* optional */ }
  }
  let acceptedBy = null;
  if (row.sale_id) {
    try {
      const linked = dbGet(`SELECT u.full_name AS cashier_name FROM sales s LEFT JOIN users u ON u.id = s.user_id WHERE s.id = ?`, [row.sale_id]);
      acceptedBy = linked?.cashier_name || null;
    } catch (_) { /* optional */ }
  }
  return {
    ...row,
    items: parseJson(row.items_json, []),
    audit: parseJson(row.audit_json, []),
    events,
    order_source: row.order_source || 'ONLINE',
    confirmation_code: confirmationCode,
    tracking_steps: trackingSteps,
    status_label: activeStep?.label || String(row.status || 'pending'),
    driver,
    accepted_by: acceptedBy,
    cashier: acceptedBy,
    first_online_gift: (() => {
      if (firstGiftAward && firstGiftAward.gift_card_code) {
        return require('./first-online-gift').publicAwardView(firstGiftAward);
      }
      try {
        const award = require('./first-online-gift').awardForOrder(row.id);
        return award ? require('./first-online-gift').publicAwardView(award) : null;
      } catch (_) { return null; }
    })()
  };
}

function getOrder(orderId, webToken = null) {
  const order = dbGet('SELECT * FROM online_orders_local WHERE id = ? OR order_number = ?', [orderId, orderId]);
  if (!order) throw new Error('Order not found');
  if (webToken) {
    const customer = resolveWebCustomer(webToken);
    if (!customer || Number(customer.id) !== Number(order.web_customer_id)) throw new Error('Not authorised');
  }
  return formatOrder(order);
}

function listCustomerOrders(webToken, limit = 50) {
  const customer = resolveWebCustomer(webToken);
  if (!customer) throw new Error('Not signed in');
  const rows = dbAll(`SELECT * FROM online_orders_local WHERE web_customer_id = ? ORDER BY id DESC LIMIT ?`, [customer.id, limit]);
  return rows.map(formatOrder);
}

function listAdminOrders(filters = {}, actor) {
  ensureSchema();
  const { applyActorBranchScope } = require('./authz');
  filters = applyActorBranchScope(actor, filters || {});
  let sql = 'SELECT * FROM online_orders_local WHERE 1=1';
  const p = [];
  if (filters.branch_id) { sql += ' AND branch_id = ?'; p.push(filters.branch_id); }
  if (filters.status) { sql += ' AND status = ?'; p.push(filters.status); }
  if (filters.from) { sql += " AND date(created_at, 'localtime') >= date(?)"; p.push(filters.from); }
  if (filters.to) { sql += " AND date(created_at, 'localtime') <= date(?)"; p.push(filters.to); }
  sql += ' ORDER BY id DESC LIMIT ?';
  p.push(Math.min(Number(filters.limit) || 200, 500));
  return dbAll(sql, p).map(formatOrder);
}

function assertAdminOrderAccess(actor, order) {
  if (!order) throw new Error('Order not found');
  const { applyActorBranchScope } = require('./authz');
  const scoped = applyActorBranchScope(actor, { branch_id: order.branch_id });
  if (scoped.branch_id != null && Number(scoped.branch_id) !== Number(order.branch_id)) {
    throw new Error('Not authorized for this branch');
  }
}

function getAdminOrderDetail(orderId, actor) {
  const order = resolveOrderRef(orderId);
  assertAdminOrderAccess(actor, order);
  const branch = dbGet('SELECT name FROM branches WHERE id = ?', [order.branch_id]);
  const formatted = formatOrder(order);
  return { ...formatted, branch_name: branch?.name || `Branch ${order.branch_id}` };
}

function updateAdminOrder(orderId, patch = {}, actor) {
  const order = resolveOrderRef(orderId);
  assertAdminOrderAccess(actor, order);
  const allowed = ['customer_name', 'customer_phone', 'customer_email', 'delivery_address', 'notes', 'scheduled_for', 'fulfillment_type', 'payment_method'];
  const updates = {};
  for (const key of allowed) {
    if (patch[key] !== undefined) updates[key] = patch[key];
  }
  if (patch.fulfillment_type != null) {
    updates.fulfillment = patch.fulfillment_type;
  }
  if (patch.items != null) {
    updates.items_json = JSON.stringify(Array.isArray(patch.items) ? patch.items : parseJson(patch.items, []));
  }
  if (patch.total != null) updates.total = round2(patch.total);
  if (patch.subtotal != null) updates.subtotal = round2(patch.subtotal);
  if (patch.discount != null) updates.discount = round2(patch.discount);
  if (patch.status && String(patch.status) !== String(order.status)) {
    return updateOrderStatus(orderId, patch.status, actor, {
      reject_reason: patch.reject_reason || patch.status_note || null,
      note: patch.status_note || `Status changed to ${patch.status} by admin`
    });
  }
  if (Object.keys(updates).length) {
    const cols = Object.keys(updates).map((k) => `${k} = ?`).join(', ');
    dbRun(`UPDATE online_orders_local SET ${cols}, updated_at = ? WHERE id = ?`,
      [...Object.values(updates), nowIso(), order.id]);
    logOrderEvent(order.id, order.status, `Admin updated: ${Object.keys(updates).join(', ')}`, 'staff', actor?.id || null);
  }
  return getAdminOrderDetail(order.id, actor);
}

function deleteAdminOrder(orderId, reason, actor) {
  const order = resolveOrderRef(orderId);
  assertAdminOrderAccess(actor, order);
  const status = String(order.status || '').toLowerCase();
  if (!['rejected', 'cancelled'].includes(status)) {
    restoreOrderLoyaltyPoints(order);
    restoreOrderGiftCard(order);
  }
  dbRun(`UPDATE web_stock_reservations SET status = 'released' WHERE order_id = ?`, [order.id]);
  try { require('./first-online-gift').maybeRevokeFromStatus({ ...order, status: 'cancelled' }); } catch (_) { /* */ }
  try { dbRun('DELETE FROM online_order_events WHERE order_id = ?', [order.id]); } catch (_) { /* */ }
  dbRun('DELETE FROM online_orders_local WHERE id = ?', [order.id]);
  try {
    const mobileMgr = require('./mobile-manager');
    mobileMgr.purgeAlertsForOnlineOrder(order.id);
    if (order.sale_id) mobileMgr.purgeAlertsForSale(order.sale_id);
  } catch (_) { /* optional */ }
  try {
    const store = require('./store');
    store.purgeNotificationsForEntity?.('online_order', order.id);
    if (order.sale_id) store.purgeNotificationsForEntity?.('sale', order.sale_id);
    store.audit(actor?.id, actor?.full_name || actor?.username || 'admin', 'delete_online_order', 'online_order', order.id,
      JSON.stringify({ order_number: order.order_number, reason: reason || null, total: order.total, sale_id: order.sale_id || null, status: order.status }));
  } catch (_) { /* */ }
  return { success: true, order_number: order.order_number };
}

function resolveOrderRef(orderRef) {
  const ref = Number(orderRef);
  if (!ref) throw new Error('Invalid order id');
  let order = dbGet('SELECT * FROM online_orders_local WHERE id = ?', [ref]);
  if (!order) order = dbGet('SELECT * FROM online_orders_local WHERE remote_id = ?', [ref]);
  if (!order) throw new Error('Order not found');
  return order;
}

function updateOrderStatus(orderId, status, actor, opts = {}) {
  const order = resolveOrderRef(orderId);
  const localId = order.id;
  if (opts.skipFsm !== true) assertOnlineOrderTransition(order.status, status);
  const rejectExtras = status === 'rejected' && actor?.id
    ? `, rejected_by = ${Number(actor.id)}, rejected_at = '${nowIso()}'`
    : '';
  dbRun(`UPDATE online_orders_local SET status = ?, reject_reason = COALESCE(?, reject_reason), updated_at = ?${rejectExtras} WHERE id = ?`,
    [status, opts.reject_reason || null, nowIso(), localId]);
  logOrderEvent(localId, status, opts.note || opts.reject_reason || '', actor ? 'staff' : 'system', actor?.id || null);
  if (status === 'rejected' || status === 'cancelled') {
    dbRun(`UPDATE web_stock_reservations SET status = 'released' WHERE order_id = ?`, [localId]);
    try { require('./first-online-gift').maybeRevokeFromStatus({ ...order, status }); } catch (_) { /* */ }
    try {
      const saleId = order.sale_id;
      if (saleId) {
        require('./referral-commission').reverseCommissionForSale(
          saleId, 1, status === 'rejected' ? 'Order rejected' : 'Order cancelled', actor
        );
      }
    } catch (err) {
      console.warn('[online] referral commission reverse:', err?.message || err);
    }
  } else if (status === 'accepted' || status === 'completed' || status === 'pending') {
    dbRun(`UPDATE web_stock_reservations SET status = 'fulfilled' WHERE order_id = ? AND status = 'reserved'`, [localId]);
    if (String(order.status).toLowerCase() === 'pending_payment') {
      try {
        const wc = order.web_customer_id ? dbGet('SELECT * FROM web_customers WHERE id = ?', [order.web_customer_id]) : null;
        if (wc) require('./first-online-gift').maybeAwardFromSubmit({ ...order, status }, wc);
      } catch (_) { /* */ }
    }
    if (status === 'completed' && order.sale_id) {
      try {
        const ot = String(order.order_type || order.fulfillment || '').toLowerCase();
        const isDelivery = ot === 'delivery' || Number(order.delivery_fee) > 0;
        if (!isDelivery) {
          require('./referral-commission').confirmCommissionOnDelivery(order.sale_id);
        }
      } catch (err) {
        console.warn('[online] referral commission confirm:', err?.message || err);
      }
    }
  }
  return formatOrder(dbGet('SELECT * FROM online_orders_local WHERE id = ?', [localId]));
}

function restoreOrderGiftCard(order) {
  const code = order?.gift_card_code;
  const amount = Math.max(0, Number(order?.gift_card_amount) || 0);
  if (!code || !amount) return;
  try {
    const db = getDb();
    const card = db.prepare('SELECT * FROM gift_cards WHERE code = ?').get(code);
    if (!card) return;
    const newBal = round2((Number(card.balance) || 0) + amount);
    db.prepare('UPDATE gift_cards SET balance = ?, status = ? WHERE id = ?')
      .run(newBal, newBal > 0 ? 'active' : card.status, card.id);
    db.prepare('INSERT INTO gift_card_transactions (gift_card_id, amount, type, notes) VALUES (?,?,?,?)')
      .run(card.id, amount, 'reload', `Online order ${order.order_number} cancelled — balance restored`);
  } catch (_) { /* */ }
}

function restoreOrderLoyaltyPoints(order) {
  const pts = Math.max(0, Number(order?.loyalty_points_used) || 0);
  if (!pts || !order?.customer_id) return;
  try {
    const features = require('./features');
    const db = getDb();
    db.prepare('UPDATE customers SET loyalty_points = COALESCE(loyalty_points, 0) + ? WHERE id = ?').run(pts, order.customer_id);
    db.prepare('INSERT INTO loyalty_transactions (customer_id, points, type, notes) VALUES (?,?,?,?)')
      .run(order.customer_id, pts, 'adjust', `Online order ${order.order_number} cancelled — points restored`);
  } catch (_) { /* */ }
}

function rejectOrder(orderId, reason, actor) {
  const order = resolveOrderRef(orderId);
  const result = updateOrderStatus(orderId, 'rejected', actor, { reject_reason: reason, note: reason });
  restoreOrderLoyaltyPoints(order);
  restoreOrderGiftCard(order);
  return result;
}

function getCustomerGiftCards(customer) {
  const rows = [];
  if (customer.customer_id) {
    rows.push(...dbAll(`SELECT code, balance, status, expires_at FROM gift_cards
      WHERE customer_id = ? AND COALESCE(balance, 0) > 0 ORDER BY expires_at ASC NULLS LAST`, [customer.customer_id]));
  }
  if (customer.phone) {
    rows.push(...dbAll(`SELECT code, balance, status, expires_at FROM gift_cards
      WHERE customer_phone = ? AND COALESCE(balance, 0) > 0 ORDER BY expires_at ASC NULLS LAST`, [customer.phone]));
  }
  try {
    rows.push(...require('./first-online-gift').walletCardsForWebCustomer(customer));
  } catch (_) { /* */ }
  const seen = new Set();
  return rows.filter((c) => {
    if (seen.has(c.code)) return false;
    seen.add(c.code);
    if (c.status === 'cancelled') return false;
    try {
      if (require('./features').giftCardIsExpired(c)) return false;
    } catch (_) {
      if (c.expires_at && String(c.expires_at).slice(0, 10) < new Date().toISOString().slice(0, 10)) return false;
    }
    return Number(c.balance) > 0;
  }).map((c) => ({
    code: c.code,
    balance: round2(c.balance),
    expires_at: c.expires_at || null,
    status: c.status
  }));
}

function checkGiftCardForWeb(code, webToken) {
  const features = require('./features');
  const card = features.checkGiftCardBalance(String(code || '').trim().toUpperCase());
  if (webToken) {
    const customer = resolveWebCustomer(webToken);
    if (customer) require('./first-online-gift').assertGiftOwnedByWebCustomer(card.code, customer);
  }
  return {
    code: card.code,
    balance: round2(card.balance),
    expires_at: card.expires_at || null,
    display_status: card.display_status
  };
}

function deleteWebCustomerAccount(webToken, password) {
  const customer = resolveWebCustomer(webToken);
  if (!customer) throw new Error('Not signed in');
  const pass = String(password || '').trim();
  if (!pass) throw new Error('Enter your password to delete this account');
  const row = dbGet('SELECT password_hash FROM web_customers WHERE id = ?', [customer.id]);
  if (!row?.password_hash || !bcrypt.compareSync(pass, row.password_hash)) {
    throw new Error('Password is incorrect');
  }
  dbRun('UPDATE web_customer_sessions SET expires_at = ? WHERE web_customer_id = ?', [nowIso(), customer.id]);
  dbRun('UPDATE web_customers SET is_active = 0, updated_at = ? WHERE id = ?', [nowIso(), customer.id]);
  return { success: true, message: 'Your online account has been deleted. In-store purchase history remains linked to your phone number.' };
}

function getCustomerAccount(webToken) {
  const customer = resolveWebCustomer(webToken);
  if (!customer) throw new Error('Not signed in');
  const addresses = dbAll('SELECT * FROM web_customer_addresses WHERE web_customer_id = ? ORDER BY is_default DESC, id DESC', [customer.id]);
  const favorites = dbAll(`SELECT f.*, p.name AS product_name FROM web_customer_favorites f JOIN products p ON p.id = f.product_id WHERE f.web_customer_id = ?`, [customer.id]);
  let loyaltyBalance = Number(customer.loyalty_points) || 0;
  let posProfile = null;
  if (customer.customer_id) {
    const c = dbGet('SELECT id, name, phone, email, loyalty_points, address FROM customers WHERE id = ?', [customer.customer_id]);
    if (c) {
      loyaltyBalance = Math.max(loyaltyBalance, Number(c.loyalty_points) || 0);
      posProfile = { id: c.id, name: c.name, phone: c.phone, email: c.email, address: c.address };
    }
  }
  const settings = getGlobalSettings();
  const pointValue = Number(settings.loyalty?.point_value) || 1;
  const pointsValue = round2(loyaltyBalance * pointValue);
  const wallet = getCustomerGiftCards(customer);
  return {
    profile: {
      id: customer.id,
      first_name: customer.first_name,
      last_name: customer.last_name,
      email: customer.email,
      phone: customer.phone,
      customer_id: customer.customer_id || null,
      marketing_opt_in: customer.marketing_opt_in !== 0 && customer.marketing_opt_in !== false && customer.marketing_opt_in !== '0'
    },
    pos_profile: posProfile,
    loyalty: { balance: loyaltyBalance, value: pointsValue },
    wallet,
    addresses,
    favorites
  };
}

function toggleFavorite(webToken, productId, branchId) {
  const customer = resolveWebCustomer(webToken);
  if (!customer) throw new Error('Not signed in');
  const existing = dbGet('SELECT id FROM web_customer_favorites WHERE web_customer_id = ? AND product_id = ? AND branch_id = ?',
    [customer.id, productId, branchId]);
  if (existing) {
    dbRun('DELETE FROM web_customer_favorites WHERE id = ?', [existing.id]);
    return { favorited: false };
  }
  dbRun('INSERT INTO web_customer_favorites (web_customer_id, product_id, branch_id) VALUES (?,?,?)', [customer.id, productId, branchId]);
  return { favorited: true };
}

function listRejectedOrdersReport(filters = {}) {
  ensureSchema();
  let sql = `SELECT o.*, u.full_name AS rejected_by_name, u.username AS rejected_by_username
    FROM online_orders_local o
    LEFT JOIN users u ON u.id = COALESCE(o.rejected_by, (
      SELECT e.actor_id FROM online_order_events e
      WHERE e.order_id = o.id AND e.status = 'rejected' AND e.actor_type = 'staff'
      ORDER BY e.id DESC LIMIT 1
    ))
    WHERE o.status = 'rejected'`;
  const p = [];
  if (filters.branch_id) { sql += ' AND o.branch_id = ?'; p.push(filters.branch_id); }
  if (filters.from) { sql += ' AND date(o.created_at) >= date(?)'; p.push(filters.from); }
  if (filters.to) { sql += ' AND date(o.created_at) <= date(?)'; p.push(filters.to); }
  sql += ' ORDER BY o.created_at DESC LIMIT 500';
  const rows = dbAll(sql, p);
  const byCashier = {};
  const byWeek = {};
  for (const r of rows) {
    const cashier = r.rejected_by_name || r.rejected_by_username || `Staff #${r.rejected_by || '?'}`;
    const dt = r.rejected_at || r.updated_at || r.created_at;
    const weekKey = dt ? String(dt).slice(0, 10) : 'unknown';
    const wkStart = (() => {
      try {
        const d = new Date(dt);
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        const mon = new Date(d.setDate(diff));
        return mon.toISOString().slice(0, 10);
      } catch (_) { return weekKey; }
    })();
    if (!byCashier[cashier]) byCashier[cashier] = { cashier, count: 0, total: 0, reasons: {} };
    byCashier[cashier].count += 1;
    byCashier[cashier].total += Number(r.total) || 0;
    const reason = r.reject_reason || 'No reason';
    byCashier[cashier].reasons[reason] = (byCashier[cashier].reasons[reason] || 0) + 1;
    if (!byWeek[wkStart]) byWeek[wkStart] = { week_start: wkStart, count: 0, total: 0 };
    byWeek[wkStart].count += 1;
    byWeek[wkStart].total += Number(r.total) || 0;
  }
  return {
    orders: rows.map(formatOrder),
    by_cashier: Object.values(byCashier).sort((a, b) => b.count - a.count),
    by_week: Object.values(byWeek).sort((a, b) => b.week_start.localeCompare(a.week_start)),
    total_rejected: rows.length
  };
}

function getOnlineAnalytics(filters = {}) {
  ensureSchema();
  const branchClause = filters.branch_id ? ' AND branch_id = ?' : '';
  const params = filters.branch_id ? [filters.branch_id] : [];
  const totals = dbGet(`SELECT COUNT(*) AS orders, COALESCE(SUM(total),0) AS revenue
    FROM online_orders_local WHERE order_source = 'ONLINE' AND status NOT IN ('rejected','cancelled')${branchClause}`, params);
  const rejected = dbGet(`SELECT COUNT(*) AS c FROM online_orders_local WHERE status = 'rejected'${branchClause}`, params)?.c || 0;
  return {
    orders: totals?.orders || 0,
    revenue: round2(totals?.revenue || 0),
    rejected,
    avg_order: totals?.orders ? round2((totals.revenue || 0) / totals.orders) : 0
  };
}

function syncOnlineOrderFromKitchenStatus(kitchenOrderId, kitchenStatus) {
  try {
    ensureSchema();
    const ko = dbGet('SELECT id, sale_id FROM kitchen_orders WHERE id=?', [kitchenOrderId]);
    if (!ko?.sale_id) return null;
    let online = dbGet('SELECT * FROM online_orders_local WHERE sale_id=?', [ko.sale_id]);
    if (!online) {
      const sale = dbGet('SELECT order_number FROM sales WHERE id=?', [ko.sale_id]);
      if (sale?.order_number) online = dbGet('SELECT * FROM online_orders_local WHERE order_number=?', [sale.order_number]);
    }
    if (!online) return null;
    const map = { preparing: 'preparing', ready: 'ready', completed: 'ready', collection: 'ready' };
    const target = map[String(kitchenStatus || '').toLowerCase()];
    if (!target || String(online.status).toLowerCase() === target) return null;
    return updateOrderStatus(online.id, target, { id: 0, role: 'system', full_name: 'Kitchen' }, { note: 'Synced from kitchen display' });
  } catch (_) {
    return null;
  }
}

function ensureIssueSchema() {
  const sqliteSql = `CREATE TABLE IF NOT EXISTS customer_issue_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      web_customer_id INTEGER,
      order_id INTEGER,
      sale_id INTEGER,
      name TEXT,
      phone TEXT,
      message TEXT NOT NULL,
      photo_data TEXT,
      photo_name TEXT,
      status TEXT DEFAULT 'new',
      pos_cashier_name TEXT,
      pos_user_id INTEGER,
      admin_reply TEXT,
      replied_by INTEGER,
      replied_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`;
  const pgSql = `CREATE TABLE IF NOT EXISTS customer_issue_reports (
      id SERIAL PRIMARY KEY,
      web_customer_id INTEGER,
      order_id INTEGER,
      sale_id INTEGER,
      name TEXT,
      phone TEXT,
      message TEXT NOT NULL,
      photo_data TEXT,
      photo_name TEXT,
      status TEXT DEFAULT 'new',
      pos_cashier_name TEXT,
      pos_user_id INTEGER,
      admin_reply TEXT,
      replied_by INTEGER,
      replied_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`;
  try {
    getDb().exec(isPgCloud() ? pgSql : sqliteSql);
  } catch (err) {
    const msg = String(err.message || err);
    if (!/already exists/i.test(msg)) {
      try { getDb().exec(isPgCloud() ? sqliteSql : pgSql); } catch (err2) {
        const msg2 = String(err2.message || err2);
        if (!/already exists/i.test(msg2)) {
          console.warn('[online-ordering] customer_issue_reports:', msg2.slice(0, 200));
        }
      }
    }
  }
}

function cashierFromSale(saleId) {
  if (!saleId) return { sale_id: null, pos_user_id: null, pos_cashier_name: null };
  try {
    const row = dbGet(`SELECT s.id, s.user_id, u.full_name, u.username
      FROM sales s LEFT JOIN users u ON u.id = s.user_id WHERE s.id = ?`, [saleId]);
    if (!row) return { sale_id: saleId, pos_user_id: null, pos_cashier_name: null };
    return {
      sale_id: row.id,
      pos_user_id: row.user_id || null,
      pos_cashier_name: row.full_name || row.username || null
    };
  } catch (_) {
    return { sale_id: saleId, pos_user_id: null, pos_cashier_name: null };
  }
}

function resolveIssueCashier(webCustomerId, orderId) {
  let order = null;
  if (orderId) {
    order = dbGet('SELECT * FROM online_orders_local WHERE id = ? OR order_number = ?', [orderId, orderId]);
  }
  if (!order && webCustomerId) {
    order = dbGet(`SELECT * FROM online_orders_local WHERE web_customer_id = ? ORDER BY id DESC LIMIT 1`, [webCustomerId]);
  }
  if (!order) return { order_id: null, ...cashierFromSale(null) };
  const fromSale = cashierFromSale(order.sale_id);
  return {
    order_id: order.id,
    sale_id: fromSale.sale_id || order.sale_id || null,
    pos_user_id: fromSale.pos_user_id,
    pos_cashier_name: fromSale.pos_cashier_name || order.accepted_by || null
  };
}

function publicIssueView(row, { includePhoto = false } = {}) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    message: row.message,
    photo_name: row.photo_name || null,
    has_photo: !!(row.photo_data),
    photo_data: includePhoto ? row.photo_data : undefined,
    status: row.status,
    order_id: row.order_id,
    pos_cashier_name: row.pos_cashier_name || null,
    admin_reply: row.admin_reply || null,
    replied_at: row.replied_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function submitCustomerIssue(data = {}, token = null) {
  ensureIssueSchema();
  const message = String(data.message || '').trim();
  if (!message) throw new Error('Please describe the problem');
  let customer = null;
  try { if (token) customer = resolveWebCustomer(token); } catch (_) { customer = null; }
  const name = String(data.name || customer?.first_name || '').trim();
  const phone = String(data.phone || customer?.phone || '').trim();
  if (!name) throw new Error('Your name is required');
  let photoData = null;
  let photoName = null;
  if (data.photo_data) {
    const raw = String(data.photo_data);
    if (raw.length > 6 * 1024 * 1024) throw new Error('Photo must be under 4MB');
    if (!raw.startsWith('data:image/')) throw new Error('Please attach a photo, not another file type');
    photoData = raw;
    photoName = data.photo_name || 'issue.jpg';
  }
  const cashier = resolveIssueCashier(customer?.id, data.order_id);
  const r = dbRun(`INSERT INTO customer_issue_reports
    (web_customer_id, order_id, sale_id, name, phone, message, photo_data, photo_name, status, pos_cashier_name, pos_user_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [customer?.id || null, cashier.order_id, cashier.sale_id, name, phone || null, message,
      photoData, photoName, 'new', cashier.pos_cashier_name, cashier.pos_user_id]);
  const id = r.lastInsertRowid;
  try {
    getDb().prepare(`INSERT INTO notifications (type, title, message, entity_type, entity_id, action_page, audience_roles)
      VALUES (?,?,?,?,?,?,?)`)
      .run('customer_issue', 'Customer report',
        `${name} reported a problem${cashier.pos_cashier_name ? ` · POS: ${cashier.pos_cashier_name}` : ''}`,
        'customer_issue', id, 'admin:customer-reports', 'owner,manager');
  } catch (_) { /* ignore */ }
  return publicIssueView(dbGet('SELECT * FROM customer_issue_reports WHERE id = ?', [id]));
}

function listMyCustomerIssues(token) {
  ensureIssueSchema();
  const customer = resolveWebCustomer(token);
  if (!customer) throw new Error('Sign in to see your reports');
  return dbAll(`SELECT * FROM customer_issue_reports WHERE web_customer_id = ? ORDER BY id DESC LIMIT 50`, [customer.id])
    .map((row) => publicIssueView(row));
}

function listCustomerIssues(filters = {}, actor) {
  ensureIssueSchema();
  require('./authz').assertUserActor(actor, ['owner', 'manager', 'supervisor', 'assistant_manager']);
  let sql = 'SELECT * FROM customer_issue_reports WHERE 1=1';
  const params = [];
  if (filters.status) { sql += ' AND status = ?'; params.push(filters.status); }
  sql += ' ORDER BY CASE status WHEN \'new\' THEN 0 WHEN \'in_progress\' THEN 1 ELSE 2 END, id DESC LIMIT 200';
  return dbAll(sql, params).map((row) => publicIssueView(row));
}

function getCustomerIssue(id, actor) {
  ensureIssueSchema();
  require('./authz').assertUserActor(actor, ['owner', 'manager', 'supervisor', 'assistant_manager']);
  const row = dbGet('SELECT * FROM customer_issue_reports WHERE id = ?', [id]);
  if (!row) throw new Error('Report not found');
  return publicIssueView(row, { includePhoto: true });
}

function replyCustomerIssue(id, reply, actor) {
  ensureIssueSchema();
  const user = require('./authz').assertUserActor(actor, ['owner', 'manager']);
  const text = String(reply || '').trim();
  if (!text) throw new Error('Reply is required');
  const row = dbGet('SELECT * FROM customer_issue_reports WHERE id = ?', [id]);
  if (!row) throw new Error('Report not found');
  dbRun(`UPDATE customer_issue_reports SET admin_reply=?, replied_by=?, replied_at=datetime('now'),
    status='resolved', updated_at=datetime('now') WHERE id=?`, [text, user.id, id]);
  return publicIssueView(dbGet('SELECT * FROM customer_issue_reports WHERE id = ?', [id]));
}

module.exports = {
  getGlobalSettings,
  getHoursStatus,
  getOnlinePaymentMethods,
  syncPaymentMethodsFromPos,
  saveGlobalOnlineSettings,
  getBranchOnlineSettings,
  saveBranchOnlineSettings,
  getPublicBranches,
  getBranchMenu,
  getProductDetail,
  checkWebRegistration,
  sendWebRegistrationCode,
  registerWebCustomer,
  loginWebCustomer,
  sendWebPasswordReset,
  resetWebPassword,
  resolveWebCustomer,
  validateCart,
  validateCoupon,
  submitOrder,
  getOrder,
  listCustomerOrders,
  listAdminOrders,
  getAdminOrderDetail,
  updateAdminOrder,
  deleteAdminOrder,
  updateOrderStatus,
  rejectOrder,
  getCustomerAccount,
  checkGiftCardForWeb,
  deleteWebCustomerAccount,
  toggleFavorite,
  getOnlineAnalytics,
  listRejectedOrdersReport,
  formatOrder,
  logOrderEvent,
  resolvePaymentForOrder,
  createCardPaymentIntent,
  verifyCardPaymentIntent,
  syncOnlineOrderFromKitchenStatus,
  submitCustomerIssue,
  listMyCustomerIssues,
  listCustomerIssues,
  getCustomerIssue,
  replyCustomerIssue
};

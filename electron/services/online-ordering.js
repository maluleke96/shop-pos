/**
 * Customer online ordering — branch-scoped menu, cart validation, orders, web customers.
 * Integrates with existing products, modifiers, branch_stock, loyalty, mkt_coupons, sales/POS.
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
    card: { id: 'card', label: 'Card (pay now)', status: 'paid', fulfillment: 'any' },
    eft: { id: 'eft', label: 'EFT / Bank transfer', status: 'pending', fulfillment: 'any' },
    mobile: { id: 'mobile', label: 'Mobile payment', status: 'pending', fulfillment: 'any' },
    snapscan: { id: 'snapscan', label: 'SnapScan / QR', status: 'pending', fulfillment: 'any' },
    other: { id: 'other', label: 'Other payment', status: 'pending', fulfillment: 'any' }
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
    { id: 'card', label: 'Card (pay now)', status: 'paid', fulfillment: 'any', enabled: true },
    { id: 'eft', label: 'EFT / Bank transfer', status: 'pending', fulfillment: 'any', enabled: true },
    { id: 'cash_on_collection', label: 'Cash on collection', status: 'pending', fulfillment: 'collection', enabled: true },
    { id: 'cash_on_delivery', label: 'Cash on delivery', status: 'pending', fulfillment: 'delivery', enabled: true },
    { id: 'snapscan', label: 'SnapScan / QR', status: 'pending', fulfillment: 'any', enabled: true }
  ];
  const fromPos = buildOnlineMethodsFromPosSettings();
  const paymentMethods = fromPos?.length
    ? fromPos
    : (Array.isArray(online?.payment_methods) && online.payment_methods.length
      ? online.payment_methods
      : defaultPaymentMethods);
  const operatingHours = parseJson(shop.operating_hours_settings, { enabled: false, weekly: [] });
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

function getOnlinePaymentMethods(fulfillment) {
  const methods = getGlobalSettings().online.payment_methods || [];
  const f = String(fulfillment || 'collection').toLowerCase();
  return methods.filter((m) => m.enabled !== false).filter((m) => {
    const mf = String(m.fulfillment || 'any').toLowerCase();
    return mf === 'any' || mf === f;
  });
}

function resolvePaymentForOrder(payload = {}, fulfillment) {
  const methods = getOnlinePaymentMethods(fulfillment);
  const methodId = String(payload.payment_method || 'card').toLowerCase();
  const method = methods.find((m) => String(m.id).toLowerCase() === methodId);
  if (!method) throw new Error('Selected payment method is not available');
  return {
    payment_method: method.id,
    payment_status: payload.payment_status || method.status || 'pending'
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
  const delRow = dbGet('SELECT delivery_fee, free_delivery_above, min_order, delivery_enabled FROM delivery_branch_settings WHERE branch_id = ?', [branchId]);
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
  }
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
    .map((b) => ({
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
    is_open: (b.online_status || 'open') === 'open' && (b.online_enabled == null || Number(b.online_enabled) !== 0)
  }));
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
  return branchStockQty(product.id, branchId) > 0;
}

function getModifiersForProduct(productId, branchId) {
  const mods = dbAll('SELECT * FROM product_modifiers WHERE product_id = ? ORDER BY option_group, id', [productId]);
  const groups = {};
  for (const m of mods) {
    const isRemoval = String(m.modifier_type || '').toLowerCase() === 'removal';
    const g = isRemoval ? 'Without / Remove' : (m.option_group || m.modifier_type || 'Options');
    if (!groups[g]) {
      groups[g] = { name: g, required: false, options: [], type: isRemoval ? 'checkbox' : 'radio' };
    }
    if (m.is_required && !isRemoval) groups[g].required = true;
    const outOfStock = false;
    groups[g].options.push({
      id: m.id,
      name: m.name,
      extra_price: Number(m.extra_price) || 0,
      modifier_type: m.modifier_type || 'extra',
      is_required: !!m.is_required,
      out_of_stock: outOfStock
    });
  }
  return Object.values(groups);
}

function mapProductForWeb(p, branchId, promos = [], productPromo = null) {
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
  const imageUrl = pic ? publicProductImageUrl(p.id, false) : null;
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
    has_modifiers: !!dbGet('SELECT 1 FROM product_modifiers WHERE product_id = ? LIMIT 1', [p.id]),
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

function mapComboForWeb(combo, branchId) {
  const combosSvc = require('./combos');
  const availUnits = combosSvc.comboAvailableUnits(combo, branchId);
  const normal = Number(combo.normal_price) || 0;
  const finalPrice = Number(combo.final_price) || normal;
  const pic = combo.image_path || combo.picture_path;
  const items = combo.items || [];
  const thumbs = items.map(comboItemImageUrl).filter(Boolean).slice(0, 6);
  const gallery = (combo.gallery_paths || []).map(publicAssetImageUrl).filter(Boolean).slice(0, 6);
  let hasModifiers = combo.combo_kind === 'custom' ? false : false;
  for (const ci of items) {
    if (ci.allow_pap_choice || (ci.product_id && dbGet('SELECT 1 FROM product_modifiers WHERE product_id = ? LIMIT 1', [ci.product_id]))) {
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
    image: pic ? publicAssetImageUrl(pic) || publicProductImageUrl(combo.id, true) : (thumbs[0] || gallery[0] || null),
    combo_thumbs: [...gallery, ...thumbs].filter(Boolean).slice(0, 6),
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
    return combosSvc.getCombos({
      active_only: true, branch_id: branchId, approval_status: 'approved', for_online: true
    }, null) || [];
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

function ensureOrderTrackingColumns() {
  for (const col of ['confirmation_code TEXT', 'tracking_token TEXT']) {
    try { dbRun(`ALTER TABLE online_orders_local ADD COLUMN ${col}`); } catch (_) { /* exists */ }
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

function getActivePromotions(branchId) {
  try {
    return dbAll(`SELECT * FROM mkt_promotions WHERE status = 'active'
      AND (branch_id IS NULL OR branch_id = ? OR branch_id = 0)
      AND (starts_at IS NULL OR starts_at <= ?)
      AND (ends_at IS NULL OR ends_at >= ?)`, [branchId, nowIso(), nowIso()]);
  } catch (_) { return []; }
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
    productPromoMap = promoRequestsSvc.getActivePromosMap();
  } catch (_) { /* optional */ }
  const categories = dbAll('SELECT * FROM categories WHERE is_active = 1 ORDER BY sort_order, name');
  let products = dbAll(`SELECT p.* FROM products p
    WHERE p.is_active = 1 AND COALESCE(p.online_enabled, 1) = 1
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
  const mapped = products.map((p) => mapProductForWeb(p, branchId, promos, productPromoMap[p.id]));
  const combos = getActiveCombos(branchId);
  let comboMapped = combos.map((c) => mapComboForWeb(c, branchId));
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
    productPromo = require('./promo-requests').getActivePromosMap()[productId] || null;
  } catch (_) { /* optional */ }
  return {
    ...mapProductForWeb(p, branchId, promos, productPromo),
    modifier_groups: getModifiersForProduct(productId, branchId)
  };
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
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

function registerWebCustomer(data = {}) {
  ensureSchema();
  const first = String(data.first_name || data.name || '').trim();
  const last = String(data.last_name || data.surname || '').trim();
  const email = String(data.email || '').trim().toLowerCase();
  const phone = String(data.phone || data.mobile || '').trim();
  const password = String(data.password || '');
  if (!first) throw new Error('First name is required');
  if (!password || password.length < 6) throw new Error('Password must be at least 6 characters');
  if (!email && !phone) throw new Error('Email or phone is required');
  if (email && dbGet('SELECT id FROM web_customers WHERE lower(email) = ?', [email])) throw new Error('Email already registered');
  if (phone && dbGet('SELECT id FROM web_customers WHERE phone = ?', [phone])) throw new Error('Phone already registered');

  let customerId = null;
  if (phone) {
    const existing = dbGet('SELECT id FROM customers WHERE phone = ?', [phone]);
    if (existing) customerId = existing.id;
    else {
      const r = dbRun('INSERT INTO customers (name, phone, email) VALUES (?,?,?)', [`${first} ${last}`.trim(), phone, email || null]);
      customerId = r.lastInsertRowid;
    }
  }

  const hash = bcrypt.hashSync(password, 10);
  const referral = (data.referral_code || '').trim().toUpperCase() || null;
  const r = dbRun(`INSERT INTO web_customers (customer_id, first_name, last_name, email, phone, password_hash, referred_by_code)
    VALUES (?,?,?,?,?,?,?)`, [customerId, first, last, email || null, phone || null, hash, referral]);
  const session = createWebSession(r.lastInsertRowid);
  return { customer: resolveWebCustomer(session.token), token: session.token };
}

function loginWebCustomer(login, password) {
  ensureSchema();
  const id = String(login || '').trim();
  const row = dbGet(`SELECT * FROM web_customers WHERE (lower(email) = lower(?) OR phone = ?) AND is_active = 1`, [id, id]);
  if (!row || !bcrypt.compareSync(String(password), row.password_hash)) throw new Error('Invalid login or password');
  const session = createWebSession(row.id);
  const { password_hash, ...safe } = row;
  return { customer: safe, token: session.token };
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
    const stock = branchStockQty(productId, branchId);
    if (qty > stock) {
      errors.push(`Only ${stock} of ${product.name} available`);
      continue;
    }
    const promos = getActivePromotions(branchId);
    let productPromo = null;
    try {
      productPromo = require('./promo-requests').getActivePromosMap()[productId] || null;
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
  if (fulfillment === 'delivery') {
    if (!branchSettings.delivery_enabled) errors.push('Delivery is not available at this branch');
    if (subtotal < (branchSettings.min_delivery_order || 0)) {
      errors.push(`Minimum delivery order is ${branchSettings.min_delivery_order}`);
    }
    deliveryFee = subtotal >= (branchSettings.free_delivery_above || 0) && branchSettings.free_delivery_above > 0
      ? 0 : Number(branchSettings.delivery_fee) || 0;
  }

  let discount = 0;
  let couponApplied = null;
  if (cart.coupon_code) {
    if (getGlobalSettings().online?.coupons_enabled === false) {
      errors.push('Coupon codes are disabled for online orders');
    } else {
    const couponResult = validateCoupon(cart.coupon_code, branchId, { subtotal, items: lines }, cart.web_customer_id);
    if (couponResult.error) errors.push(couponResult.error);
    else { discount = couponResult.discount; couponApplied = couponResult.coupon; }
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
  const totalBeforeGift = round2(Math.max(0, taxTotals.total + deliveryFee));
  let giftCardAmount = 0;
  let giftCardCode = null;
  if (cart.gift_card_code) {
    if (shop.online?.gift_cards_enabled === false) {
      errors.push('Gift card redemption is disabled for online orders');
    } else {
    try {
      const features = require('./features');
      const card = features.checkGiftCardBalance(String(cart.gift_card_code).trim().toUpperCase());
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
    const coupon = dbGet(`SELECT * FROM mkt_coupons WHERE UPPER(code) = UPPER(?) AND status IN ('active','issued','generated')`, [value]);
    if (!coupon) return { error: 'Invalid coupon code', discount: 0 };
    if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) return { error: 'Coupon expired', discount: 0 };
    if (coupon.branch_id && Number(coupon.branch_id) !== Number(branchId)) return { error: 'Coupon not valid at this branch', discount: 0 };
    const maxUses = Number(coupon.max_uses) || 0;
    const used = Number(coupon.used_count) || 0;
    if (maxUses > 0 && used >= maxUses) return { error: 'Coupon usage limit reached', discount: 0 };
    const minSpend = Number(coupon.min_order_amount) || 0;
    if (cartCtx.subtotal < minSpend) return { error: `Minimum order ${minSpend} required`, discount: 0 };
    let discount = 0;
    const subtotal = Number(cartCtx.subtotal) || 0;
    if (coupon.discount_type === 'percent' || coupon.discount_type === 'percentage') {
      discount = round2(subtotal * (Number(coupon.discount_value) || 0) / 100);
    } else {
      discount = round2(Number(coupon.discount_value) || 0);
    }
    return { discount: Math.min(discount, subtotal), coupon: { code: coupon.code, id: coupon.id, discount_type: coupon.discount_type, discount_value: coupon.discount_value } };
  } catch (_) {
    return { error: 'Coupon validation unavailable', discount: 0 };
  }
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
    coupon_code: payload.coupon_code,
    loyalty_points_used: payload.loyalty_points_used,
    gift_card_code: payload.gift_card_code
  });
  if (!cart.valid) throw new Error(cart.errors.join('; '));
  if (!cart.lines.length) throw new Error('Your cart is empty — add at least one item');

  ensureOrderGiftColumns();
  ensureOrderTrackingColumns();
  const orderNumber = nextOnlineOrderNumber();
  const fulfillment = payload.fulfillment_type || 'collection';
  const payment = resolvePaymentForOrder(payload, fulfillment);
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
    payload.coupon_code || null, cart.loyalty_points_used || 0,
    cart.gift_card_code || null, cart.gift_card_amount || 0,
    payment.payment_method, payment.payment_status,
    fulfillment, fulfillment,
    payload.delivery_address || null, payload.scheduled_for || null,
    payload.notes || null, 'pending', idempotencyKey || null,
    confirmationCode, trackingToken
  ]);

  const orderId = r.lastInsertRowid;
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

  if (payload.coupon_code) {
    try {
      dbRun('INSERT INTO web_coupon_redemptions (order_id, coupon_code, web_customer_id, branch_id, discount_amount) VALUES (?,?,?,?,?)',
        [orderId, payload.coupon_code, customer.id, branchId, cart.discount]);
    } catch (_) { /* */ }
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
  return formatOrder(order);
}

function formatOrder(row) {
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
    cashier: acceptedBy
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

function listAdminOrders(filters = {}) {
  ensureSchema();
  let sql = 'SELECT * FROM online_orders_local WHERE 1=1';
  const p = [];
  if (filters.branch_id) { sql += ' AND branch_id = ?'; p.push(filters.branch_id); }
  if (filters.status) { sql += ' AND status = ?'; p.push(filters.status); }
  if (filters.from) { sql += ' AND created_at >= ?'; p.push(filters.from); }
  if (filters.to) { sql += ' AND created_at <= ?'; p.push(filters.to); }
  sql += ' ORDER BY id DESC LIMIT ?';
  p.push(Math.min(Number(filters.limit) || 200, 500));
  return dbAll(sql, p).map(formatOrder);
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
  const rejectExtras = status === 'rejected' && actor?.id
    ? `, rejected_by = ${Number(actor.id)}, rejected_at = '${nowIso()}'`
    : '';
  dbRun(`UPDATE online_orders_local SET status = ?, reject_reason = COALESCE(?, reject_reason), updated_at = ?${rejectExtras} WHERE id = ?`,
    [status, opts.reject_reason || null, nowIso(), localId]);
  logOrderEvent(localId, status, opts.note || opts.reject_reason || '', actor ? 'staff' : 'system', actor?.id || null);
  if (status === 'rejected' || status === 'cancelled') {
    dbRun(`UPDATE web_stock_reservations SET status = 'released' WHERE order_id = ?`, [localId]);
  } else if (status === 'accepted' || status === 'completed') {
    dbRun(`UPDATE web_stock_reservations SET status = 'fulfilled' WHERE order_id = ? AND status = 'reserved'`, [localId]);
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
  const seen = new Set();
  return rows.filter((c) => {
    if (seen.has(c.code)) return false;
    seen.add(c.code);
    if (c.status === 'cancelled') return false;
    if (c.expires_at && String(c.expires_at).slice(0, 10) < new Date().toISOString().slice(0, 10)) return false;
    return Number(c.balance) > 0;
  }).map((c) => ({
    code: c.code,
    balance: round2(c.balance),
    expires_at: c.expires_at || null,
    status: c.status
  }));
}

function checkGiftCardForWeb(code) {
  const features = require('./features');
  const card = features.checkGiftCardBalance(String(code || '').trim().toUpperCase());
  return {
    code: card.code,
    balance: round2(card.balance),
    expires_at: card.expires_at || null,
    display_status: card.display_status
  };
}

function deleteWebCustomerAccount(webToken) {
  const customer = resolveWebCustomer(webToken);
  if (!customer) throw new Error('Not signed in');
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
      referral_code: customer.referral_code,
      customer_id: customer.customer_id || null
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

module.exports = {
  getGlobalSettings,
  getOnlinePaymentMethods,
  syncPaymentMethodsFromPos,
  saveGlobalOnlineSettings,
  getBranchOnlineSettings,
  saveBranchOnlineSettings,
  getPublicBranches,
  getBranchMenu,
  getProductDetail,
  registerWebCustomer,
  loginWebCustomer,
  resolveWebCustomer,
  validateCart,
  validateCoupon,
  submitOrder,
  getOrder,
  listCustomerOrders,
  listAdminOrders,
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
  resolvePaymentForOrder
};

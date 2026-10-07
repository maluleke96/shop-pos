/**
 * Marketing Center — campaigns, promotions, decision center, budget and AI assistant.
 * Integrates existing engines only: customers/sales/products (analytics), combos + discount vouchers
 * (promotions), Communication Center (delivery + consent), expenses (accounting), loyalty and referrals.
 */
const { getDb } = require('../database/db');
const A = require('./marketing-analytics');

const { num, money, pct, sqlDate } = A;

const CAMPAIGN_STATUSES = ['draft', 'awaiting_approval', 'approved', 'scheduled', 'active', 'paused', 'completed', 'cancelled', 'archived'];
const OBJECTIVES = {
  increase_sales: 'Increase sales',
  increase_aov: 'Increase average order value',
  win_back: 'Win back customers',
  acquire: 'Acquire customers',
  promote_product: 'Promote product',
  clear_stock: 'Clear slow-moving stock',
  increase_delivery: 'Increase delivery orders',
  loyalty_engagement: 'Increase loyalty engagement',
  increase_referrals: 'Increase referrals',
  new_product: 'Promote new product',
  quiet_period: 'Increase quiet-period sales'
};
const PROMOTION_KINDS = ['voucher', 'free_delivery', 'bundle', 'bogo', 'buy_x_get_y', 'time_based', 'referral_code', 'loyalty', 'none'];
const MESSAGE_CHANNELS = ['whatsapp', 'sms', 'email'];
const EDITABLE = new Set(['draft', 'awaiting_approval', 'approved']);

const DEFAULT_SETTINGS = {
  analysis_days: 180,
  new_customer_days: 30,
  inactivity_days: 30,
  high_value_top_pct: 10,
  slow_weekly_units: 2,
  overstock_weeks: 6,
  high_margin_pct: 60,
  low_margin_pct: 25,
  min_pair_support: 3,
  quiet_threshold_pct: 25,
  hour_offset: 0,
  reward_points_target: null,
  near_reward_points: 20,
  ab_min_orders: 30,
  budget_warn_pct: 80,
  birthday_offer: { enabled: false, discount_type: 'percent', discount_value: null, min_order_total: null, max_discount: null, valid_days: 7, product_id: null, branch_id: null, days_ahead: 7 },
  anniversary_offer: { enabled: false, discount_type: 'percent', discount_value: null, min_order_total: null, max_discount: null, valid_days: 7, product_id: null, branch_id: null, days_ahead: 7 }
};

let _schemaReady = false;

function run(sql, params = []) { return getDb().prepare(sql).run(...params); }
function get(sql, params = []) { return getDb().prepare(sql).get(...params) || null; }
function all(sql, params = []) { return getDb().prepare(sql).all(...params) || []; }
function tryRun(sql) {
  try { run(sql); return true; } catch (err) {
    if (!/already exists|duplicate column/i.test(String(err.message || err))) console.warn('[marketing] schema:', String(err.message || err).slice(0, 160));
    return false;
  }
}
function nowSql() { return sqlDate(Date.now()); }
function parseJson(v, fb) {
  if (v == null || v === '') return fb;
  try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return fb; }
}
function insertId(r, table) {
  const id = Number(r?.lastInsertRowid) || 0;
  if (id) return id;
  return Number(get(`SELECT MAX(id) AS id FROM ${table}`)?.id) || 0;
}

function ensureSchema() {
  if (_schemaReady) return;
  tryRun(`CREATE TABLE IF NOT EXISTS mkt_center_settings (
    id INTEGER PRIMARY KEY,
    settings_json TEXT,
    updated_by INTEGER,
    updated_at TEXT
  )`);
  tryRun(`CREATE TABLE IF NOT EXISTS mkt_campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    objective TEXT,
    audience_json TEXT,
    branch_id INTEGER,
    products_json TEXT,
    promotion_type TEXT,
    promotion_ref_id INTEGER,
    promotion_code TEXT,
    channels_json TEXT,
    content_json TEXT,
    start_at TEXT,
    end_at TEXT,
    scheduled_at TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    budget REAL,
    estimated_cost REAL,
    expected_redemptions INTEGER,
    preview_json TEXT,
    ab_group TEXT,
    variant_label TEXT,
    source_json TEXT,
    owner_id INTEGER,
    created_by INTEGER,
    created_at TEXT,
    updated_at TEXT,
    submitted_at TEXT,
    approved_by INTEGER,
    approved_at TEXT,
    launched_at TEXT,
    paused_at TEXT,
    cancelled_at TEXT,
    completed_at TEXT,
    recipients_count INTEGER,
    queued_count INTEGER,
    last_error TEXT
  )`);
  tryRun('CREATE INDEX IF NOT EXISTS idx_mkt_campaigns_status ON mkt_campaigns(status)');
  tryRun(`CREATE TABLE IF NOT EXISTS mkt_campaign_costs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER,
    expense_id INTEGER,
    amount REAL NOT NULL,
    channel TEXT,
    description TEXT,
    created_by INTEGER,
    created_at TEXT
  )`);
  tryRun(`CREATE TABLE IF NOT EXISTS mkt_budgets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    period TEXT NOT NULL,
    scope TEXT NOT NULL,
    scope_ref TEXT,
    amount REAL NOT NULL,
    notes TEXT,
    created_by INTEGER,
    created_at TEXT,
    updated_at TEXT
  )`);
  tryRun(`CREATE TABLE IF NOT EXISTS mkt_recommendations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT,
    question TEXT,
    engine TEXT,
    facts_json TEXT,
    analysis_json TEXT,
    suggestions_json TEXT,
    status TEXT NOT NULL DEFAULT 'generated',
    decided_by INTEGER,
    decided_at TEXT,
    decision_note TEXT,
    campaign_id INTEGER,
    created_by INTEGER,
    created_at TEXT
  )`);
  tryRun(`CREATE TABLE IF NOT EXISTS mkt_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    event_date TEXT NOT NULL,
    end_date TEXT,
    branch_id INTEGER,
    notes TEXT,
    created_by INTEGER,
    created_at TEXT
  )`);
  tryRun(`CREATE TABLE IF NOT EXISTS mkt_suppressions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER,
    reason TEXT,
    created_by INTEGER,
    created_at TEXT
  )`);
  tryRun(`CREATE TABLE IF NOT EXISTS mkt_content (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    kind TEXT,
    channel TEXT,
    body TEXT,
    subject TEXT,
    media_url TEXT,
    media_type TEXT,
    product_ids_json TEXT,
    campaign_id INTEGER,
    branch_id INTEGER,
    scheduled_at TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    source TEXT,
    created_by INTEGER,
    created_at TEXT,
    updated_at TEXT
  )`);
  tryRun('ALTER TABLE mkt_campaigns ADD COLUMN archived_at TEXT');
  for (const col of ['anniversary_date TEXT', 'anniversary_type TEXT']) tryRun(`ALTER TABLE customers ADD COLUMN ${col}`);
  try { require('./discount-vouchers').ensureVoucherSchema(); } catch (_) { /* optional */ }
  _schemaReady = true;
}

/* ─────────────────────────── Auth / audit ─────────────────────────── */

const ALL_ROLES = ['owner', 'manager', 'assistant_manager', 'supervisor'];

function requirePerm(actor, key) {
  const authz = require('./authz');
  return authz.assertUserPermission(actor, key, ALL_ROLES);
}

function scopeBranch(actor, branchId) {
  try {
    const locked = require('./branches').resolveBranchScope(actor, {});
    if (locked && locked.role !== 'owner' && !locked.allBranches && locked.branchId != null) return Number(locked.branchId);
  } catch (_) { /* optional */ }
  try {
    const scoped = require('./authz').applyActorBranchScope(actor, { branch_id: branchId });
    return scoped.branch_id != null && scoped.branch_id !== '' && scoped.branch_id !== 'all' ? Number(scoped.branch_id) : null;
  } catch (_) {
    return branchId != null && branchId !== '' && branchId !== 'all' ? Number(branchId) : null;
  }
}

function audit(actor, action, entityType, entityId, details = {}) {
  try {
    run('INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, details) VALUES (?,?,?,?,?,?)', [
      actor?.id || null, actor?.full_name || actor?.username || 'system', action, entityType, entityId || null,
      JSON.stringify(details || {})
    ]);
  } catch (err) {
    console.warn('[marketing] audit:', err.message);
  }
}

function listAudit(limit = 200) {
  ensureSchema();
  return all(`SELECT id, user_id, username, action, entity_type, entity_id, details, created_at FROM audit_log
    WHERE entity_type LIKE 'marketing%' ORDER BY id DESC LIMIT ?`, [Math.min(500, Math.max(1, Number(limit) || 200))])
    .map((r) => ({ ...r, details: parseJson(r.details, {}) }));
}

/* ─────────────────────────── Settings ─────────────────────────── */

function getSettings() {
  ensureSchema();
  const row = get('SELECT settings_json FROM mkt_center_settings WHERE id = 1');
  const saved = parseJson(row?.settings_json, {});
  return {
    ...DEFAULT_SETTINGS, ...saved,
    birthday_offer: { ...DEFAULT_SETTINGS.birthday_offer, ...(saved.birthday_offer || {}) },
    anniversary_offer: { ...DEFAULT_SETTINGS.anniversary_offer, ...(saved.anniversary_offer || {}) }
  };
}

function saveSettings(data, actor) {
  ensureSchema();
  const before = getSettings();
  const next = { ...before };
  const numeric = ['analysis_days', 'new_customer_days', 'inactivity_days', 'high_value_top_pct', 'slow_weekly_units', 'overstock_weeks',
    'high_margin_pct', 'low_margin_pct', 'min_pair_support', 'quiet_threshold_pct', 'hour_offset', 'near_reward_points', 'ab_min_orders', 'budget_warn_pct'];
  for (const k of numeric) if (data[k] != null && data[k] !== '') next[k] = Number(data[k]);
  if ('reward_points_target' in data) next.reward_points_target = Number(data.reward_points_target) > 0 ? Number(data.reward_points_target) : null;
  next.analysis_days = Math.min(730, Math.max(14, next.analysis_days));
  next.hour_offset = Math.min(14, Math.max(-14, Math.round(next.hour_offset)));
  for (const k of ['birthday_offer', 'anniversary_offer']) {
    if (data[k] && typeof data[k] === 'object') next[k] = { ...before[k], ...data[k], enabled: !!data[k].enabled };
  }
  const json = JSON.stringify(next);
  if (get('SELECT id FROM mkt_center_settings WHERE id = 1')) {
    run('UPDATE mkt_center_settings SET settings_json = ?, updated_by = ?, updated_at = ? WHERE id = 1', [json, actor?.id || null, nowSql()]);
  } else {
    run('INSERT INTO mkt_center_settings (id, settings_json, updated_by, updated_at) VALUES (1, ?, ?, ?)', [json, actor?.id || null, nowSql()]);
  }
  A.invalidate();
  audit(actor, 'marketing_settings_updated', 'marketing_settings', 1, { before, after: next });
  return next;
}

function dataFor(filters = {}) {
  const s = getSettings();
  return A.loadData({ days: filters.days || s.analysis_days, branchId: filters.branch_id, fresh: !!filters.fresh });
}

/* ─────────────────────────── Communication channels ─────────────────────────── */

function channelStatus() {
  const out = {};
  let providers = {};
  let control = { channels: {}, emergency_off: false };
  let moduleOn = true;
  try { providers = require('./cc-providers').providerStatus(); } catch (_) { /* */ }
  try { control = require('./cc-control').getControl(); } catch (_) { /* */ }
  try { moduleOn = require('./entitlements').shouldRunJob(['mod.communication']); } catch (_) { /* */ }
  for (const ch of MESSAGE_CHANNELS) {
    const p = providers[ch] || {};
    const switchedOn = !!control.channels?.[ch];
    const ready = !!p.ready && switchedOn && !control.emergency_off && moduleOn;
    let message = null;
    if (!moduleOn) message = 'Communication Center is not included in this shop\'s plan — messages cannot be delivered.';
    else if (control.emergency_off) message = 'Communication Center Emergency OFF is active — nothing can be sent.';
    else if (!p.ready) {
      message = ch === 'sms'
        ? 'SMS is not available — the Vodacom SMS integration is UNVERIFIED and disabled until the official API specification is supplied.'
        : `${ch === 'whatsapp' ? 'WhatsApp' : 'Email'} is not configured. Connect ${ch === 'whatsapp' ? 'WhatsApp' : 'Email'} in Communication Center before sending this campaign.`;
    } else if (!switchedOn) message = `${ch.toUpperCase()} is switched off in Communication Center.`;
    out[ch] = { ready, configured: !!p.configured || !!p.ready, switched_on: switchedOn, message };
  }
  out._module_enabled = moduleOn;
  out._emergency_off = !!control.emergency_off;
  return out;
}

/* ─────────────────────────── Audience ─────────────────────────── */

function suppressedIds() {
  return new Set(all('SELECT customer_id FROM mkt_suppressions WHERE customer_id IS NOT NULL').map((r) => Number(r.customer_id)));
}

function resolveAudience(audience = {}, branchId = null) {
  const settings = getSettings();
  const data = A.loadData({ days: settings.analysis_days, branchId });
  let ids = [];
  if (audience.type === 'customers') {
    ids = (audience.ids || []).map(Number).filter(Boolean);
  } else if (audience.type === 'segment') {
    const profiles = A.customerProfiles(data);
    ids = A.segmentMembers(data, profiles, audience.segment, audience.params || {}, settings).map((p) => p.id);
  } else if (audience.type === 'all_customers') {
    ids = data.customers.map((c) => Number(c.id));
  }
  const exclude = new Set((audience.exclude_ids || []).map(Number));
  const suppressed = suppressedIds();
  const rows = [];
  let suppressedCount = 0;
  for (const id of [...new Set(ids)]) {
    if (exclude.has(id)) continue;
    if (suppressed.has(id)) { suppressedCount += 1; continue; }
    const c = data.customerById.get(id);
    if (!c) continue;
    rows.push({ id, name: c.name, phone: c.phone || null, email: c.email || null });
  }
  return { customers: rows, suppressed: suppressedCount };
}

function consentCounts(customers, channels) {
  let cc = null;
  try { cc = require('./communication-center'); } catch (_) { /* */ }
  const out = {};
  for (const ch of channels) {
    let ok = 0; let noAddress = 0; let optedOut = 0;
    for (const c of customers) {
      const addr = ch === 'email' ? c.email : c.phone;
      if (!addr || (ch !== 'email' && !c.phone)) { noAddress += 1; continue; }
      const allowed = cc ? cc.prefsAllow(addr, ch, 'marketing') && (ch !== 'email' || !c.phone || cc.prefsAllow(c.phone, ch, 'marketing')) : true;
      if (allowed) ok += 1; else optedOut += 1;
    }
    out[ch] = { reachable: ok, no_address: noAddress, opted_out: optedOut };
  }
  return out;
}

function previewAudience(audience, branchId, channels = []) {
  ensureSchema();
  const r = resolveAudience(audience || {}, branchId);
  const chans = (channels || []).filter((c) => MESSAGE_CHANNELS.includes(c));
  return {
    count: r.customers.length, suppressed: r.suppressed,
    consent: consentCounts(r.customers, chans),
    sample: r.customers.slice(0, 20).map((c) => ({ id: c.id, name: c.name, phone_masked: A.maskPhone(c.phone), has_email: !!c.email }))
  };
}

/* ─────────────────────────── Promotions ─────────────────────────── */

function productRow(id) {
  return get('SELECT * FROM products WHERE id = ?', [Number(id)]);
}

function stockOf(p, branchId) {
  if (!p) return null;
  if (A.isMadeToOrder(p)) return null;
  if (branchId) {
    const bs = get('SELECT quantity FROM branch_stock WHERE product_id = ? AND branch_id = ?', [p.id, branchId]);
    if (bs) return num(bs.quantity);
  }
  return num(p.stock_quantity);
}

/** Financial impact of a promotion per redemption, from real prices and costs. */
function previewPromotion(spec = {}) {
  ensureSchema();
  const kind = PROMOTION_KINDS.includes(spec.kind) ? spec.kind : 'voucher';
  const branchId = spec.branch_id ? Number(spec.branch_id) : null;
  const warnings = [];
  const lines = [];
  const addLine = (pid, qty, paid = true) => {
    const p = productRow(pid);
    if (!p) throw new Error(`Product #${pid} not found`);
    const cost = A.productCost(p);
    const stock = stockOf(p, branchId);
    if (cost == null) warnings.push(`Promotion margin cannot be calculated because ${p.name} has no cost data.`);
    if (stock != null && stock <= 0) warnings.push(`${p.name} is out of stock${branchId ? ' at this branch' : ''}.`);
    lines.push({ product_id: p.id, name: p.name, quantity: qty, unit_price: num(p.selling_price), unit_cost: cost, stock, paid });
    return p;
  };
  let promoPrice = null;
  let basis = 'per redemption';
  if (kind === 'bundle' || kind === 'time_based') {
    const items = (spec.items || []).filter((i) => Number(i.product_id));
    if (!items.length) throw new Error('Choose at least one product');
    items.forEach((i) => addLine(i.product_id, Math.max(1, Number(i.quantity) || 1)));
    const normal = lines.reduce((a, l) => a + l.unit_price * l.quantity, 0);
    if (spec.pricing_type === 'percent') promoPrice = normal * (1 - num(spec.discount_value) / 100);
    else if (spec.pricing_type === 'fixed_discount') promoPrice = Math.max(0, normal - num(spec.discount_value));
    else promoPrice = num(spec.final_price) || normal;
  } else if (kind === 'bogo') {
    const buy = Math.max(1, Number(spec.buy_qty) || 1);
    const free = Math.max(1, Number(spec.get_qty) || 1);
    const p = addLine(spec.product_id, buy + free);
    promoPrice = num(p.selling_price) * buy;
  } else if (kind === 'buy_x_get_y') {
    const buy = Math.max(1, Number(spec.buy_qty) || 1);
    const getQ = Math.max(1, Number(spec.get_qty) || 1);
    const px = addLine(spec.product_id, buy);
    const py = addLine(spec.get_product_id, getQ);
    const yDisc = spec.get_discount_pct != null && spec.get_discount_pct !== '' ? Math.min(100, num(spec.get_discount_pct)) : 100;
    promoPrice = num(px.selling_price) * buy + num(py.selling_price) * getQ * (1 - yDisc / 100);
  } else if (kind === 'voucher') {
    const value = num(spec.discount_value);
    if (!(value > 0)) throw new Error('Enter a discount value');
    if (spec.product_id) {
      const p = addLine(spec.product_id, 1);
      const price = num(p.selling_price);
      let disc = spec.discount_type === 'amount' ? value : price * value / 100;
      if (num(spec.max_discount) > 0) disc = Math.min(disc, num(spec.max_discount));
      promoPrice = Math.max(0, price - disc);
    } else {
      const d = A.loadData({ days: 90, branchId });
      const orders = d.sales.length;
      if (!orders) {
        return { kind, insufficient: true, message: 'Insufficient data — no sales in the last 90 days to base an order-level estimate on.', warnings };
      }
      const aov = d.sales.reduce((a, s) => a + A.netRevenue(s), 0) / orders;
      let costed = 0; let costedRevenue = 0;
      for (const it of d.items) if (num(it.buying_price) > 0) { costed += num(it.buying_price) * (num(it.quantity) || 1); costedRevenue += num(it.total); }
      const costRatio = costedRevenue > 0 ? costed / costedRevenue : null;
      if (costRatio == null) warnings.push('Promotion margin cannot be calculated because no sale items have recorded cost data.');
      const base = Math.max(aov, num(spec.min_order_total));
      let disc = spec.discount_type === 'amount' ? value : base * value / 100;
      if (num(spec.max_discount) > 0) disc = Math.min(disc, num(spec.max_discount));
      disc = Math.min(disc, base);
      const net = base - disc;
      const cogs = costRatio != null ? base * costRatio : null;
      return {
        kind, basis: `per order at ${num(spec.min_order_total) > aov ? 'the minimum order' : 'the 90-day average order value'} (R${money(base)})`,
        normal_price: money(base), discount: money(disc), promo_price: money(net),
        cogs: cogs != null ? money(cogs) : null, gross_profit: cogs != null ? money(net - cogs) : null,
        gross_margin_pct: cogs != null && net > 0 ? Math.round(((net - cogs) / net) * 1000) / 10 : null,
        cost_basis: costRatio != null ? `Cost ratio ${Math.round(costRatio * 1000) / 10}% from recorded sale-item costs (90 days)` : null,
        lines: [], warnings
      };
    }
  } else if (kind === 'free_delivery') {
    const d = A.loadData({ days: 90, branchId });
    const del = d.sales.filter((s) => A.num(s.delivery_fee) > 0);
    if (!del.length) return { kind, insufficient: true, message: 'Insufficient data — no delivery orders with a delivery fee in the last 90 days.', warnings };
    const avgFee = del.reduce((a, s) => a + num(s.delivery_fee), 0) / del.length;
    return {
      kind, basis: `per delivery order (average fee over ${del.length} delivery orders, 90 days)`,
      normal_price: money(avgFee), discount: money(avgFee), promo_price: 0, cogs: null, gross_profit: null, gross_margin_pct: null,
      note: 'The waived delivery fee is the cost of this promotion. Delivery fees do not earn loyalty points, so loyalty is unaffected.',
      lines: [], warnings
    };
  } else {
    return { kind, lines: [], warnings, note: 'No price change — no promotion financials apply.' };
  }
  const normal = lines.reduce((a, l) => a + l.unit_price * l.quantity, 0);
  const costKnown = lines.every((l) => l.unit_cost != null);
  const cogs = costKnown ? lines.reduce((a, l) => a + l.unit_cost * l.quantity, 0) : null;
  const price = money(promoPrice);
  if (cogs != null && price < cogs) warnings.push(`Promotion price R${price} is below cost R${money(cogs)} — this sells at a loss.`);
  return {
    kind, basis, lines, normal_price: money(normal), promo_price: price, discount: money(normal - price),
    discount_pct: pct(normal - price, normal), cogs: cogs != null ? money(cogs) : null,
    gross_profit: cogs != null ? money(price - cogs) : null,
    gross_margin_pct: cogs != null && price > 0 ? Math.round(((price - cogs) / price) * 1000) / 10 : null,
    normal_gross_profit: cogs != null ? money(normal - cogs) : null,
    warnings, out_of_stock: lines.some((l) => l.stock != null && l.stock <= 0)
  };
}

function randomCode(prefix) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `${prefix}${s}`;
}

/** Create a real promotion in the existing engines (combos or discount vouchers). */
function createPromotion(spec = {}, actor) {
  ensureSchema();
  const user = requirePerm(actor, 'mkt_promotions');
  const kind = spec.kind;
  if (!PROMOTION_KINDS.includes(kind) || ['none', 'loyalty'].includes(kind)) throw new Error('Choose a promotion type');
  const campaign = spec.campaign_id ? getCampaignRow(spec.campaign_id) : null;
  if (spec.campaign_id && !campaign) throw new Error('Campaign not found');
  const branchId = spec.branch_id ? Number(spec.branch_id) : (campaign?.branch_id || null);
  let preview = null;
  if (kind !== 'referral_code') {
    preview = previewPromotion({ ...spec, branch_id: branchId });
    if (preview.out_of_stock && !spec.proceed_without_stock) {
      throw new Error('A selected product is out of stock. Confirm "proceed without stock" to create this promotion anyway.');
    }
  }
  const startDate = String(spec.start_date || campaign?.start_at || '').slice(0, 10) || null;
  const endDate = String(spec.end_date || campaign?.end_at || '').slice(0, 10) || null;
  let result;
  if (['bundle', 'bogo', 'buy_x_get_y', 'time_based'].includes(kind)) {
    const combos = require('./combos');
    let items = [];
    let pricingType = 'fixed';
    let finalPrice = preview.promo_price;
    let discountValue = preview.promo_price;
    if (kind === 'bundle' || kind === 'time_based') {
      items = (spec.items || []).filter((i) => Number(i.product_id)).map((i) => ({ product_id: Number(i.product_id), quantity: Math.max(1, Number(i.quantity) || 1) }));
      pricingType = ['percent', 'fixed_discount', 'fixed'].includes(spec.pricing_type) ? spec.pricing_type : 'fixed';
      discountValue = pricingType === 'fixed' ? preview.promo_price : num(spec.discount_value);
    } else if (kind === 'bogo') {
      items = [{ product_id: Number(spec.product_id), quantity: Math.max(1, Number(spec.buy_qty) || 1) + Math.max(1, Number(spec.get_qty) || 1) }];
    } else {
      items = [
        { product_id: Number(spec.product_id), quantity: Math.max(1, Number(spec.buy_qty) || 1) },
        { product_id: Number(spec.get_product_id), quantity: Math.max(1, Number(spec.get_qty) || 1) }
      ];
    }
    if (kind === 'time_based' && !(spec.valid_time_start && spec.valid_time_end)) throw new Error('Time-based promotions need a start and end time');
    const combo = combos.saveCombo({
      name: String(spec.name || campaign?.name || 'Marketing promotion').slice(0, 120),
      description: spec.description || (campaign ? `Marketing campaign #${campaign.id}` : 'Marketing Center promotion'),
      category: 'Marketing', branch_id: branchId, start_date: startDate, end_date: endDate,
      pricing_type: pricingType, discount_value: discountValue, final_price: finalPrice,
      max_uses: spec.max_uses ? Number(spec.max_uses) : null, promo_type: `marketing_${kind}`,
      valid_time_start: spec.valid_time_start || null, valid_time_end: spec.valid_time_end || null,
      items
    }, user);
    result = { engine: 'combos', type: kind, id: combo.id, code: combo.combo_code, status: combo.status, approval_status: combo.approval_status, name: combo.name };
  } else if (kind === 'voucher' || kind === 'free_delivery') {
    const vouchers = require('./discount-vouchers');
    const code = vouchers.normalizeCode(spec.code) || randomCode(campaign ? `MKT${campaign.id}` : 'MKT');
    const v = vouchers.createVoucher({
      code, discount_type: kind === 'free_delivery' ? 'free_delivery' : (spec.discount_type === 'amount' ? 'amount' : 'percent'),
      discount_value: kind === 'free_delivery' ? 0 : spec.discount_value, product_id: spec.product_id || null,
      customer_id: spec.customer_id || null, max_uses: spec.max_uses || 1000, expires_at: endDate,
      min_order_total: spec.min_order_total, max_discount: spec.max_discount, branch_id: branchId,
      campaign_id: campaign?.id || null, notes: campaign ? `Marketing campaign #${campaign.id}` : 'Marketing Center'
    }, user);
    result = { engine: 'discount_vouchers', type: kind, id: v.id, code: v.code, status: v.status, name: v.code };
  } else if (kind === 'referral_code') {
    const code = String(spec.code || '').trim().toUpperCase();
    const row = code ? get('SELECT code, agent_id, status FROM referral_codes WHERE upper(code) = ?', [code]) : null;
    const agent = row ? null : (code ? get('SELECT id, referral_code FROM referral_agents WHERE upper(referral_code) = ?', [code]) : null);
    if (!row && !agent) throw new Error('Referral code not found in the referral system');
    result = { engine: 'referral', type: kind, id: row ? Number(row.agent_id) : Number(agent.id), code, status: row?.status || 'active', name: code };
  }
  if (campaign) {
    const before = { promotion_type: campaign.promotion_type, promotion_ref_id: campaign.promotion_ref_id, promotion_code: campaign.promotion_code };
    run('UPDATE mkt_campaigns SET promotion_type = ?, promotion_ref_id = ?, promotion_code = ?, updated_at = ? WHERE id = ?',
      [kind, result.id, result.code, nowSql(), campaign.id]);
    audit(user, 'campaign_edited', 'marketing_campaign', campaign.id, { campaign_id: campaign.id, before, after: { promotion_type: kind, promotion_ref_id: result.id, promotion_code: result.code } });
  }
  audit(user, 'promotion_created', 'marketing_promotion', result.id, { campaign_id: campaign?.id || null, promotion: result, preview });
  return { ...result, preview };
}

/* ─────────────────────────── Campaigns ─────────────────────────── */

function getCampaignRow(id) {
  ensureSchema();
  return get('SELECT * FROM mkt_campaigns WHERE id = ?', [Number(id)]);
}

function presentCampaign(r) {
  if (!r) return r;
  return {
    ...r,
    objective_label: OBJECTIVES[r.objective] || r.objective,
    audience: parseJson(r.audience_json, {}),
    products: parseJson(r.products_json, []),
    channels: parseJson(r.channels_json, []),
    content: parseJson(r.content_json, {}),
    preview: parseJson(r.preview_json, null),
    source: parseJson(r.source_json, null)
  };
}

function toSqlStamp(v) {
  if (!v) return null;
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s} 00:00:00`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return sqlDate(d.getTime());
}

/** Scheduled campaigns become active at their start; active campaigns complete after their end date. */
function refreshStatuses() {
  const now = nowSql();
  const rows = all("SELECT id, status, scheduled_at, start_at, end_at FROM mkt_campaigns WHERE status IN ('scheduled','active')");
  for (const r of rows) {
    if (r.status === 'scheduled' && (r.scheduled_at || r.start_at) && (r.scheduled_at || r.start_at) <= now) {
      run("UPDATE mkt_campaigns SET status = 'active', updated_at = ? WHERE id = ? AND status = 'scheduled'", [now, r.id]);
      audit(null, 'campaign_started', 'marketing_campaign', r.id, { campaign_id: r.id, before: { status: 'scheduled' }, after: { status: 'active' } });
    } else if (r.status === 'active' && r.end_at && r.end_at < now) {
      run("UPDATE mkt_campaigns SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ? AND status = 'active'", [now, now, r.id]);
      audit(null, 'campaign_completed', 'marketing_campaign', r.id, { campaign_id: r.id, before: { status: 'active' }, after: { status: 'completed' } });
    }
  }
}

function listCampaigns(filters = {}, actor) {
  ensureSchema();
  refreshStatuses();
  const branchId = actor ? scopeBranch(actor, filters.branch_id) : (filters.branch_id ? Number(filters.branch_id) : null);
  let sql = 'SELECT * FROM mkt_campaigns WHERE 1=1';
  const params = [];
  if (filters.status) { sql += ' AND status = ?'; params.push(filters.status); } else if (!filters.include_archived) sql += " AND status <> 'archived'";
  if (branchId) { sql += ' AND (branch_id IS NULL OR branch_id = ?)'; params.push(branchId); }
  if (filters.ab_group) { sql += ' AND ab_group = ?'; params.push(filters.ab_group); }
  sql += ' ORDER BY id DESC LIMIT 500';
  return all(sql, params).map(presentCampaign);
}

function getCampaign(id) {
  refreshStatuses();
  const c = presentCampaign(getCampaignRow(id));
  if (!c) throw new Error('Campaign not found');
  return { ...c, delivery: deliveryStats(c.id), costs: all('SELECT * FROM mkt_campaign_costs WHERE campaign_id = ? ORDER BY id', [c.id]) };
}

function validateCampaign(d) {
  const name = String(d.name || '').trim();
  if (!name) throw new Error('Campaign name is required');
  if (d.objective && !OBJECTIVES[d.objective]) throw new Error('Unknown campaign goal');
  const channels = (Array.isArray(d.channels) ? d.channels : []).filter((c) => MESSAGE_CHANNELS.includes(c));
  const start = toSqlStamp(d.start_at);
  const end = toSqlStamp(d.end_at);
  if (start && end && end < start) throw new Error('End date must be after start date');
  if (d.promotion_type && !PROMOTION_KINDS.includes(d.promotion_type)) throw new Error('Unknown promotion type');
  return { name: name.slice(0, 160), channels, start, end };
}

function saveCampaign(d = {}, actor) {
  ensureSchema();
  const isEdit = !!d.id;
  const user = requirePerm(actor, isEdit ? 'mkt_campaign_edit' : 'mkt_campaign_create');
  const v = validateCampaign(d);
  const branchId = scopeBranch(user, d.branch_id);
  const content = { body: String(d.content?.body || '').slice(0, 2000), subject: String(d.content?.subject || '').slice(0, 200), media_url: d.content?.media_url || null, personal_codes: d.content?.personal_codes || undefined };
  const fields = {
    name: v.name, objective: d.objective || null, audience_json: JSON.stringify(d.audience || { type: 'segment', segment: 'returning' }),
    branch_id: branchId, products_json: JSON.stringify((d.products || []).map(Number).filter(Boolean)),
    promotion_type: d.promotion_type || null, promotion_ref_id: d.promotion_ref_id ? Number(d.promotion_ref_id) : null,
    promotion_code: d.promotion_code || null, channels_json: JSON.stringify(v.channels), content_json: JSON.stringify(content),
    start_at: v.start, end_at: v.end, scheduled_at: toSqlStamp(d.scheduled_at),
    budget: d.budget != null && d.budget !== '' ? num(d.budget) : null,
    estimated_cost: d.estimated_cost != null && d.estimated_cost !== '' ? num(d.estimated_cost) : null,
    expected_redemptions: d.expected_redemptions != null && d.expected_redemptions !== '' ? Math.max(0, Math.floor(num(d.expected_redemptions))) : null,
    ab_group: d.ab_group || null, variant_label: d.variant_label || null,
    source_json: d.source ? JSON.stringify(d.source) : null
  };
  if (isEdit) {
    const before = getCampaignRow(d.id);
    if (!before) throw new Error('Campaign not found');
    if (!EDITABLE.has(before.status)) throw new Error(`A ${before.status} campaign cannot be edited — duplicate it instead`);
    const status = before.status === 'approved' ? 'draft' : before.status;
    const cols = Object.keys(fields);
    run(`UPDATE mkt_campaigns SET ${cols.map((c) => `${c} = ?`).join(', ')}, status = ?, updated_at = ? WHERE id = ?`,
      [...cols.map((c) => fields[c]), status, nowSql(), before.id]);
    const after = getCampaignRow(before.id);
    audit(user, 'campaign_edited', 'marketing_campaign', before.id, {
      campaign_id: before.id, before, after, note: before.status === 'approved' ? 'Edited after approval — returned to draft for re-approval' : undefined
    });
    return getCampaign(before.id);
  }
  const cols = Object.keys(fields);
  const r = run(`INSERT INTO mkt_campaigns (${cols.join(', ')}, status, owner_id, created_by, created_at, updated_at)
    VALUES (${cols.map(() => '?').join(', ')}, 'draft', ?, ?, ?, ?)`,
  [...cols.map((c) => fields[c]), user.id, user.id, nowSql(), nowSql()]);
  const id = insertId(r, 'mkt_campaigns');
  audit(user, 'campaign_created', 'marketing_campaign', id, { campaign_id: id, after: fields });
  if (d.recommendation_id) {
    try { run('UPDATE mkt_recommendations SET campaign_id = ? WHERE id = ?', [id, Number(d.recommendation_id)]); } catch (_) { /* */ }
  }
  return getCampaign(id);
}

function setStatus(c, status, user, action, extra = {}) {
  const now = nowSql();
  const col = { awaiting_approval: 'submitted_at', approved: 'approved_at', paused: 'paused_at', cancelled: 'cancelled_at', completed: 'completed_at' }[status];
  run(`UPDATE mkt_campaigns SET status = ?, updated_at = ?${col ? `, ${col} = ?` : ''}${status === 'approved' ? ', approved_by = ?' : ''} WHERE id = ?`,
    [status, now, ...(col ? [now] : []), ...(status === 'approved' ? [user?.id || null] : []), c.id]);
  audit(user, action, 'marketing_campaign', c.id, { campaign_id: c.id, before: { status: c.status }, after: { status }, ...extra });
}

function submitCampaign(id, actor) {
  const user = requirePerm(actor, 'mkt_campaign_edit');
  const c = getCampaignRow(id);
  if (!c) throw new Error('Campaign not found');
  if (c.status !== 'draft') throw new Error(`Only draft campaigns can be submitted (status: ${c.status})`);
  const content = parseJson(c.content_json, {});
  const channels = parseJson(c.channels_json, []);
  if (channels.length && !String(content.body || '').trim()) throw new Error('Add message content before submitting');
  const preview = financialPreview(c.id);
  run('UPDATE mkt_campaigns SET preview_json = ? WHERE id = ?', [JSON.stringify(preview), c.id]);
  setStatus(c, 'awaiting_approval', user, 'campaign_submitted', { preview });
  return getCampaign(c.id);
}

function approveCampaign(id, actor) {
  const user = requirePerm(actor, 'mkt_campaign_approve');
  const c = getCampaignRow(id);
  if (!c) throw new Error('Campaign not found');
  if (c.status !== 'awaiting_approval') throw new Error(`Only campaigns awaiting approval can be approved (status: ${c.status})`);
  setStatus(c, 'approved', user, 'campaign_approved');
  return getCampaign(c.id);
}

function rejectCampaign(id, note, actor) {
  const user = requirePerm(actor, 'mkt_campaign_approve');
  const c = getCampaignRow(id);
  if (!c) throw new Error('Campaign not found');
  if (c.status !== 'awaiting_approval') throw new Error('Only campaigns awaiting approval can be rejected');
  setStatus(c, 'draft', user, 'campaign_rejected', { note: String(note || '').slice(0, 500) });
  return getCampaign(c.id);
}

function dedupePrefix(id) { return `mkt:${Number(id)}:`; }

function deliveryStats(id) {
  const rows = (() => {
    try {
      return all('SELECT status, channel, COUNT(*) AS n FROM cc_queue WHERE dedupe_key LIKE ? GROUP BY status, channel', [`${dedupePrefix(id)}%`]);
    } catch (_) { return []; }
  })();
  const out = { total: 0, by_status: {}, by_channel: {}, note: 'Clicks and replies are not tracked by the Communication Center.' };
  for (const r of rows) {
    const n = num(r.n);
    out.total += n;
    out.by_status[r.status] = (out.by_status[r.status] || 0) + n;
    out.by_channel[r.channel] = out.by_channel[r.channel] || {};
    out.by_channel[r.channel][r.status] = (out.by_channel[r.channel][r.status] || 0) + n;
  }
  out.sent = (out.by_status.sent || 0) + (out.by_status.delivered || 0) + (out.by_status.read || 0);
  out.delivered = (out.by_status.delivered || 0) + (out.by_status.read || 0);
  out.failed = out.by_status.failed || 0;
  out.pending = (out.by_status.pending || 0) + (out.by_status.retrying || 0) + (out.by_status.processing || 0);
  return out;
}

function launchCampaign(id, actor) {
  const user = requirePerm(actor, 'mkt_campaign_send');
  const c = getCampaignRow(id);
  if (!c) throw new Error('Campaign not found');
  if (c.status !== 'approved') throw new Error(`Only approved campaigns can be launched (status: ${c.status})`);
  const channels = parseJson(c.channels_json, []);
  const content = parseJson(c.content_json, {});
  const status = channelStatus();
  const blocked = channels.filter((ch) => !status[ch]?.ready).map((ch) => status[ch]?.message || `${ch} is not ready`);
  if (blocked.length) throw new Error(blocked.join(' '));
  const now = nowSql();
  const scheduledAt = c.scheduled_at && c.scheduled_at > now ? c.scheduled_at : null;
  let queued = 0;
  let recipients = 0;
  let skippedNoPhone = 0;
  if (channels.length) {
    if (!String(content.body || '').trim()) throw new Error('Campaign has no message content');
    const { customers } = resolveAudience(parseJson(c.audience_json, {}), c.branch_id);
    recipients = customers.length;
    if (!recipients) throw new Error('The campaign audience is empty — nobody to send to.');
    const cc = require('./communication-center');
    const codes = content.personal_codes || {};
    for (const cust of customers) {
      if (!cust.phone && !(channels.includes('email') && cust.email)) { skippedNoPhone += 1; continue; }
      const code = codes[cust.id] || c.promotion_code || '';
      const r = cc.emit('promo.publish', {
        customer_id: cust.id, customer_name: cust.name, customer_phone: cust.phone, customer_email: cust.email,
        branch_id: c.branch_id || null, promotion_name: c.name, announcement: content.body, code, vars: { code }
      }, {
        channels, recipients: ['customer'], body: content.body, subject: content.subject || c.name,
        media_url: content.media_url || null, scheduled_at: scheduledAt, source_module: 'marketing',
        dedupe_key: `${dedupePrefix(c.id)}c${cust.id}`, actor: user, priority: 60
      });
      if (r && r.ok === false && r.reason === 'missing_shop_details') {
        throw new Error(`Message uses shop details that are not set: ${(r.missing || []).join(', ')}`);
      }
      queued += Number(r?.queued) || 0;
    }
  }
  const nextStatus = scheduledAt || (c.start_at && c.start_at > now) ? 'scheduled' : 'active';
  run('UPDATE mkt_campaigns SET status = ?, launched_at = ?, recipients_count = ?, queued_count = ?, updated_at = ? WHERE id = ?',
    [nextStatus, now, recipients, queued, now, c.id]);
  audit(user, 'campaign_sent', 'marketing_campaign', c.id, {
    campaign_id: c.id, before: { status: c.status }, after: { status: nextStatus }, recipients, queued, skipped_no_phone: skippedNoPhone, channels, scheduled_at: scheduledAt
  });
  return {
    ...getCampaign(c.id), launch: {
      recipients, queued, skipped_no_phone: skippedNoPhone, scheduled_at: scheduledAt,
      note: queued < recipients * channels.length ? 'Some messages were not queued — opted-out customers, missing addresses or duplicates are skipped by the Communication Center.' : null
    }
  };
}

function setPromotionState(c, state, user) {
  const notes = [];
  if (!c.promotion_ref_id) return notes;
  try {
    if (['voucher', 'free_delivery'].includes(c.promotion_type)) {
      if (state === 'pause') run("UPDATE discount_vouchers SET status = 'paused' WHERE id = ? AND status = 'active'", [c.promotion_ref_id]);
      else if (state === 'resume') run("UPDATE discount_vouchers SET status = 'active' WHERE id = ? AND status = 'paused'", [c.promotion_ref_id]);
      else if (state === 'cancel') run("UPDATE discount_vouchers SET status = 'cancelled' WHERE id = ? AND status IN ('active','paused')", [c.promotion_ref_id]);
      notes.push(`Voucher ${c.promotion_code} ${state === 'resume' ? 'reactivated' : state === 'pause' ? 'paused' : 'cancelled'}`);
    } else if (['bundle', 'bogo', 'buy_x_get_y', 'time_based'].includes(c.promotion_type)) {
      require('./combos').setComboStatus(c.promotion_ref_id, state === 'resume' ? 'active' : 'inactive', user);
      notes.push(`Combo ${c.promotion_code} ${state === 'resume' ? 'reactivated' : 'deactivated'}`);
    }
  } catch (err) {
    notes.push(`Promotion could not be ${state}d: ${err.message}`);
  }
  return notes;
}

function pauseCampaign(id, actor) {
  const user = requirePerm(actor, 'mkt_campaign_send');
  const c = getCampaignRow(id);
  if (!c) throw new Error('Campaign not found');
  if (!['active', 'scheduled'].includes(c.status)) throw new Error(`Only active or scheduled campaigns can be paused (status: ${c.status})`);
  let held = 0;
  try {
    held = Number(run("UPDATE cc_queue SET status = 'paused' WHERE dedupe_key LIKE ? AND status IN ('pending','retrying')", [`${dedupePrefix(c.id)}%`])?.changes) || 0;
  } catch (_) { /* no queue */ }
  const notes = setPromotionState(c, 'pause', user);
  setStatus(c, 'paused', user, 'campaign_paused', { messages_paused: held, promotion: notes });
  return { ...getCampaign(c.id), messages_paused: held, promotion_notes: notes };
}

function resumeCampaign(id, actor) {
  const user = requirePerm(actor, 'mkt_campaign_send');
  const c = getCampaignRow(id);
  if (!c) throw new Error('Campaign not found');
  if (c.status !== 'paused') throw new Error('Only paused campaigns can be resumed');
  const status = channelStatus();
  const channels = parseJson(c.channels_json, []);
  const blocked = channels.filter((ch) => !status[ch]?.ready).map((ch) => status[ch]?.message);
  if (blocked.length) throw new Error(blocked.join(' '));
  let released = 0;
  try {
    released = Number(run("UPDATE cc_queue SET status = 'pending' WHERE dedupe_key LIKE ? AND status = 'paused'", [`${dedupePrefix(c.id)}%`])?.changes) || 0;
  } catch (_) { /* */ }
  const notes = setPromotionState(c, 'resume', user);
  const next = c.scheduled_at && c.scheduled_at > nowSql() ? 'scheduled' : 'active';
  setStatus(c, next, user, 'campaign_resumed', { messages_released: released, promotion: notes });
  return { ...getCampaign(c.id), messages_released: released, promotion_notes: notes };
}

function cancelCampaign(id, actor) {
  const c = getCampaignRow(id);
  if (!c) throw new Error('Campaign not found');
  const launched = ['active', 'scheduled', 'paused'].includes(c.status);
  const user = requirePerm(actor, launched ? 'mkt_campaign_send' : 'mkt_campaign_edit');
  if (['cancelled', 'completed'].includes(c.status)) throw new Error(`Campaign is already ${c.status}`);
  let cancelled = 0;
  try {
    cancelled = Number(run("UPDATE cc_queue SET status = 'cancelled' WHERE dedupe_key LIKE ? AND status IN ('pending','retrying','paused')", [`${dedupePrefix(c.id)}%`])?.changes) || 0;
  } catch (_) { /* */ }
  const notes = launched ? setPromotionState(c, 'cancel', user) : [];
  setStatus(c, 'cancelled', user, 'campaign_cancelled', { messages_cancelled: cancelled, promotion: notes });
  return { ...getCampaign(c.id), messages_cancelled: cancelled, promotion_notes: notes };
}

function duplicateCampaign(id, actor) {
  const user = requirePerm(actor, 'mkt_campaign_create');
  const c = presentCampaign(getCampaignRow(id));
  if (!c) throw new Error('Campaign not found');
  const reusable = ['bundle', 'bogo', 'buy_x_get_y', 'time_based', 'referral_code'].includes(c.promotion_type);
  const copy = saveCampaign({
    name: `${c.name} (copy)`, objective: c.objective, audience: c.audience, branch_id: c.branch_id, products: c.products,
    promotion_type: reusable ? c.promotion_type : null, promotion_ref_id: reusable ? c.promotion_ref_id : null,
    promotion_code: reusable ? c.promotion_code : null, channels: c.channels,
    content: { body: c.content.body, subject: c.content.subject, media_url: c.content.media_url },
    budget: c.budget, estimated_cost: c.estimated_cost, expected_redemptions: c.expected_redemptions,
    source: { duplicated_from: c.id }
  }, user);
  audit(user, 'campaign_duplicated', 'marketing_campaign', copy.id, { campaign_id: copy.id, from_campaign_id: c.id, voucher_not_copied: !reusable && !!c.promotion_code });
  return copy;
}

function archiveCampaign(id, actor) {
  const user = requirePerm(actor, 'mkt_campaign_edit');
  const c = getCampaignRow(id);
  if (!c) throw new Error('Campaign not found');
  if (!['draft', 'completed', 'cancelled'].includes(c.status)) throw new Error(`Only draft, completed or cancelled campaigns can be archived (status: ${c.status}) — cancel it first`);
  run('UPDATE mkt_campaigns SET status = ?, archived_at = ?, updated_at = ?, last_error = ? WHERE id = ?', ['archived', nowSql(), nowSql(), `archived_from:${c.status}`, c.id]);
  audit(user, 'campaign_archived', 'marketing_campaign', c.id, { campaign_id: c.id, before: { status: c.status }, after: { status: 'archived' } });
  return getCampaign(c.id);
}

function unarchiveCampaign(id, actor) {
  const user = requirePerm(actor, 'mkt_campaign_edit');
  const c = getCampaignRow(id);
  if (!c) throw new Error('Campaign not found');
  if (c.status !== 'archived') throw new Error('Campaign is not archived');
  const m = String(c.last_error || '').match(/^archived_from:(\w+)$/);
  const back = m && ['draft', 'completed', 'cancelled'].includes(m[1]) ? m[1] : 'draft';
  run('UPDATE mkt_campaigns SET status = ?, archived_at = NULL, last_error = NULL, updated_at = ? WHERE id = ?', [back, nowSql(), c.id]);
  audit(user, 'campaign_unarchived', 'marketing_campaign', c.id, { campaign_id: c.id, before: { status: 'archived' }, after: { status: back } });
  return getCampaign(c.id);
}

function campaignHistory(id) {
  ensureSchema();
  const cid = Number(id);
  return all(`SELECT id, user_id, username, action, entity_type, entity_id, details, created_at FROM audit_log
    WHERE entity_type LIKE 'marketing%' ORDER BY id DESC LIMIT 2000`)
    .map((r) => ({ ...r, details: parseJson(r.details, {}) }))
    .filter((r) => (r.entity_type === 'marketing_campaign' && Number(r.entity_id) === cid) || Number(r.details?.campaign_id) === cid);
}

/* ─────────────────────────── Content library ─────────────────────────── */

const CONTENT_KINDS = ['message', 'caption', 'poster', 'video_script', 'email', 'product_copy', 'image', 'video'];
const CONTENT_CHANNELS = ['whatsapp', 'sms', 'email', 'facebook', 'instagram', 'tiktok', 'youtube', 'x', 'linkedin', 'print', 'in_store'];

function presentContent(r) {
  return r ? { ...r, product_ids: parseJson(r.product_ids_json, []) } : r;
}

function listContent(filters = {}) {
  ensureSchema();
  let sql = 'SELECT * FROM mkt_content WHERE 1=1';
  const params = [];
  if (filters.campaign_id) { sql += ' AND campaign_id = ?'; params.push(Number(filters.campaign_id)); }
  if (filters.channel) { sql += ' AND channel = ?'; params.push(String(filters.channel)); }
  if (filters.status) { sql += ' AND status = ?'; params.push(String(filters.status)); }
  sql += ' ORDER BY id DESC LIMIT 500';
  return all(sql, params).map(presentContent);
}

function saveContent(d = {}, actor) {
  ensureSchema();
  const user = requirePerm(actor, d.id ? 'mkt_campaign_edit' : 'mkt_campaign_create');
  const title = String(d.title || '').trim();
  if (!title) throw new Error('Content title is required');
  const body = String(d.body || '').slice(0, 5000);
  if (!body.trim() && !d.media_url) throw new Error('Add text or a media URL');
  const kind = CONTENT_KINDS.includes(d.kind) ? d.kind : 'message';
  const channel = d.channel && CONTENT_CHANNELS.includes(d.channel) ? d.channel : null;
  if (d.campaign_id && !getCampaignRow(d.campaign_id)) throw new Error('Campaign not found');
  const media = d.media_url ? String(d.media_url).trim() : null;
  if (media && !/^https?:\/\//i.test(media) && !/^\/(uploads|media|api)\//.test(media)) throw new Error('Media must be an http(s) URL or an uploaded media path');
  const fields = {
    title: title.slice(0, 160), kind, channel, body, subject: d.subject ? String(d.subject).slice(0, 200) : null,
    media_url: media, media_type: media ? (d.media_type === 'video' || /\.(mp4|webm|mov)(\?|$)/i.test(media) ? 'video' : 'image') : null,
    product_ids_json: JSON.stringify((d.product_ids || []).map(Number).filter(Boolean)),
    campaign_id: d.campaign_id ? Number(d.campaign_id) : null, branch_id: scopeBranch(user, d.branch_id),
    scheduled_at: toSqlStamp(d.scheduled_at), status: ['draft', 'ready', 'scheduled', 'used'].includes(d.status) ? d.status : (d.scheduled_at ? 'scheduled' : 'draft'),
    source: d.source ? String(d.source).slice(0, 60) : 'manual'
  };
  const cols = Object.keys(fields);
  if (d.id) {
    const before = get('SELECT * FROM mkt_content WHERE id = ?', [Number(d.id)]);
    if (!before) throw new Error('Content not found');
    run(`UPDATE mkt_content SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, [...cols.map((c) => fields[c]), nowSql(), before.id]);
    audit(user, 'content_updated', 'marketing_content', before.id, { campaign_id: fields.campaign_id, before: { title: before.title, status: before.status }, after: { title: fields.title, status: fields.status } });
    return presentContent(get('SELECT * FROM mkt_content WHERE id = ?', [before.id]));
  }
  const r = run(`INSERT INTO mkt_content (${cols.join(', ')}, created_by, created_at, updated_at) VALUES (${cols.map(() => '?').join(', ')}, ?, ?, ?)`,
    [...cols.map((c) => fields[c]), user.id, nowSql(), nowSql()]);
  const id = insertId(r, 'mkt_content');
  audit(user, 'content_created', 'marketing_content', id, { campaign_id: fields.campaign_id, after: { title: fields.title, kind, channel } });
  return presentContent(get('SELECT * FROM mkt_content WHERE id = ?', [id]));
}

function deleteContent(id, actor) {
  const user = requirePerm(actor, 'mkt_campaign_edit');
  const before = get('SELECT * FROM mkt_content WHERE id = ?', [Number(id)]);
  if (!before) throw new Error('Content not found');
  run('DELETE FROM mkt_content WHERE id = ?', [before.id]);
  audit(user, 'content_deleted', 'marketing_content', before.id, { before: { title: before.title } });
  return { ok: true };
}

/** Apply a library item to a campaign's message content (campaign edit rules apply). */
function useContentInCampaign(contentId, campaignId, actor) {
  const ct = get('SELECT * FROM mkt_content WHERE id = ?', [Number(contentId)]);
  if (!ct) throw new Error('Content not found');
  const c = presentCampaign(getCampaignRow(campaignId));
  if (!c) throw new Error('Campaign not found');
  const saved = saveCampaign({
    id: c.id, name: c.name, objective: c.objective, audience: c.audience, branch_id: c.branch_id, products: c.products,
    promotion_type: c.promotion_type, promotion_ref_id: c.promotion_ref_id, promotion_code: c.promotion_code, channels: c.channels,
    content: { ...c.content, body: ct.body, subject: ct.subject || c.content.subject, media_url: ct.media_url || c.content.media_url },
    start_at: c.start_at, end_at: c.end_at, scheduled_at: c.scheduled_at, budget: c.budget, estimated_cost: c.estimated_cost,
    expected_redemptions: c.expected_redemptions, ab_group: c.ab_group, variant_label: c.variant_label, source: c.source
  }, actor);
  run("UPDATE mkt_content SET campaign_id = ?, status = 'used', updated_at = ? WHERE id = ?", [c.id, nowSql(), ct.id]);
  return saved;
}

/** Hand content to the Communication Center as a draft (the Communication Center controls sending, consent and limits). */
function sendContentToCommunication(contentId, d = {}, actor) {
  const user = requirePerm(actor, 'mkt_campaign_create');
  const ct = get('SELECT * FROM mkt_content WHERE id = ?', [Number(contentId)]);
  if (!ct) throw new Error('Content not found');
  const channels = (Array.isArray(d.channels) && d.channels.length ? d.channels : [ct.channel]).filter((ch) => ['whatsapp', 'sms', 'email', 'inapp'].includes(ch));
  if (!channels.length) throw new Error('Choose a message channel (WhatsApp, SMS, email or in-app)');
  const cc = require('./communication-center');
  const draftName = `[Marketing] ${ct.title}`;
  const r = cc.createMessage({ mode: 'draft', name: draftName, body: ct.body, subject: ct.subject, channels, audience: d.audience || { type: 'all_eligible' } }, user);
  if (!Number(r.draft_id)) r.draft_id = Number(get("SELECT id FROM cc_campaigns WHERE name = ? AND status = 'draft' ORDER BY id DESC LIMIT 1", [draftName])?.id) || null;
  audit(user, 'content_sent_to_communication', 'marketing_content', ct.id, { campaign_id: ct.campaign_id, cc_draft_id: r.draft_id, channels });
  return { ...r, note: 'Saved as a Communication Center draft. Review and send it from Communication Center → Campaigns.' };
}

/* ─────────────────────────── Financial preview & results ─────────────────────────── */

function historicalResponseRate() {
  const rows = all("SELECT id, recipients_count FROM mkt_campaigns WHERE status = 'completed' AND recipients_count > 0");
  if (!rows.length) return null;
  let recipients = 0; let orders = 0;
  for (const r of rows) {
    const res = attribution(r.id);
    recipients += num(r.recipients_count);
    orders += res.orders;
  }
  return recipients > 0 ? { rate: orders / recipients, campaigns: rows.length, recipients, orders } : null;
}

function financialPreview(id) {
  const c = presentCampaign(getCampaignRow(id));
  if (!c) throw new Error('Campaign not found');
  const audience = resolveAudience(c.audience || {}, c.branch_id);
  const out = {
    audience_size: audience.customers.length, suppressed: audience.suppressed,
    consent: consentCounts(audience.customers, c.channels || []), promotion: null, warnings: []
  };
  if (c.promotion_type && !['none', 'loyalty', 'referral_code'].includes(c.promotion_type) && c.promotion_ref_id) {
    try {
      let spec = null;
      if (['voucher', 'free_delivery'].includes(c.promotion_type)) {
        const v = get('SELECT * FROM discount_vouchers WHERE id = ?', [c.promotion_ref_id]);
        if (v) spec = { kind: v.discount_type === 'free_delivery' ? 'free_delivery' : 'voucher', discount_type: v.discount_type, discount_value: v.discount_value, product_id: v.product_id, min_order_total: v.min_order_total, max_discount: v.max_discount, branch_id: v.branch_id };
      } else {
        const combo = require('./combos').getCombo(c.promotion_ref_id);
        if (combo) spec = { kind: 'bundle', items: (combo.items || []).filter((i) => i.product_id).map((i) => ({ product_id: i.product_id, quantity: i.quantity })), pricing_type: 'fixed', final_price: combo.final_price, branch_id: combo.branch_id };
      }
      if (spec) out.promotion = previewPromotion(spec);
    } catch (err) { out.warnings.push(`Promotion preview failed: ${err.message}`); }
  }
  const hist = historicalResponseRate();
  out.historical_response = hist ? { rate_pct: Math.round(hist.rate * 1000) / 10, campaigns: hist.campaigns, recipients: hist.recipients, orders: hist.orders } : null;
  const expected = c.expected_redemptions != null ? num(c.expected_redemptions) : null;
  out.expected_redemptions = expected;
  out.expected_basis = expected != null ? 'Owner estimate entered on the campaign' : null;
  if (expected == null) out.warnings.push('Expected revenue unavailable — enter an expected number of redemptions (owner estimate).');
  const p = out.promotion;
  if (expected != null && p && !p.insufficient) {
    out.expected = {
      revenue: money(num(p.promo_price) * expected),
      discount: money(num(p.discount) * expected),
      cogs: p.cogs != null ? money(p.cogs * expected) : null,
      gross_profit: p.gross_profit != null ? money(p.gross_profit * expected) : null,
      label: 'ESTIMATE based on the owner\'s expected redemptions and real product prices/costs'
    };
  }
  out.campaign_cost = c.estimated_cost != null ? money(c.estimated_cost) : null;
  if (out.campaign_cost == null) out.warnings.push('Campaign cost not entered — ROI cannot be estimated.');
  if (out.expected && out.expected.gross_profit != null && out.campaign_cost != null) {
    out.expected.contribution = money(out.expected.gross_profit - out.campaign_cost);
    out.expected.roi_pct = out.campaign_cost > 0 ? Math.round((out.expected.contribution / out.campaign_cost) * 1000) / 10 : null;
  }
  const chs = channelStatus();
  for (const ch of c.channels || []) if (!chs[ch]?.ready) out.warnings.push(chs[ch]?.message);
  if (p?.warnings?.length) out.warnings.push(...p.warnings);
  return out;
}

function chunk(arr, n = 400) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

function salesByIds(ids) {
  const rows = [];
  for (const part of chunk([...new Set(ids.map(Number).filter(Boolean))])) {
    rows.push(...all(`SELECT * FROM sales WHERE id IN (${part.map(() => '?').join(',')})`, part));
  }
  return rows.filter(A.isValidSale);
}

function itemsForSales(ids) {
  const rows = [];
  for (const part of chunk([...new Set(ids.map(Number).filter(Boolean))])) {
    rows.push(...all(`SELECT * FROM sale_items WHERE sale_id IN (${part.map(() => '?').join(',')})`, part));
  }
  return rows;
}

/** Evidence-based attribution: only sales linked through the campaign's voucher, combo or referral code. */
function attribution(id) {
  const c = getCampaignRow(id);
  if (!c) throw new Error('Campaign not found');
  const evidence = [];
  const saleIds = new Set();
  const pendingOnline = [];
  const from = c.launched_at || c.start_at || c.created_at;
  const to = c.end_at || null;
  const inWindow = (stamp) => (!from || String(stamp || '') >= from) && (!to || String(stamp || '').slice(0, 10) <= String(to).slice(0, 10));
  const vouchers = all('SELECT id, code FROM discount_vouchers WHERE campaign_id = ? OR id = ?', [c.id, ['voucher', 'free_delivery'].includes(c.promotion_type) ? (c.promotion_ref_id || -1) : -1]);
  if (vouchers.length) {
    const codes = vouchers.map((v) => String(v.code).toUpperCase());
    const reds = all(`SELECT * FROM discount_voucher_redemptions WHERE upper(code) IN (${codes.map(() => '?').join(',')})`, codes);
    for (const r of reds) {
      if (r.sale_id) saleIds.add(Number(r.sale_id));
      else if (r.online_order_id) {
        const o = get('SELECT id, sale_id, total, delivery_fee, discount, status, created_at, customer_id FROM online_orders_local WHERE id = ?', [r.online_order_id]);
        if (o?.sale_id) saleIds.add(Number(o.sale_id));
        else if (o && !/cancel|reject/i.test(String(o.status || ''))) pendingOnline.push(o);
      }
    }
    evidence.push(`${reds.length} redemption(s) of voucher code${codes.length > 1 ? 's' : ''} ${codes.slice(0, 5).join(', ')}`);
  }
  if (['bundle', 'bogo', 'buy_x_get_y', 'time_based'].includes(c.promotion_type) && c.promotion_ref_id) {
    const logs = all('SELECT sale_id FROM combo_sale_log WHERE combo_id = ?', [c.promotion_ref_id]);
    let n = 0;
    for (const l of logs) { if (l.sale_id) { saleIds.add(Number(l.sale_id)); n += 1; } }
    evidence.push(`${n} sale(s) containing combo ${c.promotion_code || `#${c.promotion_ref_id}`}`);
  }
  if (c.promotion_type === 'referral_code' && c.promotion_code) {
    const rows = all('SELECT id, created_at FROM sales WHERE upper(referral_code) = ?', [String(c.promotion_code).toUpperCase()]);
    let n = 0;
    for (const r of rows) if (inWindow(r.created_at)) { saleIds.add(Number(r.id)); n += 1; }
    evidence.push(`${n} sale(s) using referral code ${c.promotion_code} during the campaign`);
  }
  const sales = salesByIds([...saleIds]).filter((s) => ['voucher', 'free_delivery'].includes(c.promotion_type) || inWindow(s.created_at));
  const items = itemsForSales(sales.map((s) => s.id));
  let cogs = 0; let cogsIncomplete = false;
  for (const it of items) {
    const bp = num(it.buying_price);
    if (bp > 0) cogs += bp * (num(it.quantity) || 1);
    else if (num(it.total) > 0) cogsIncomplete = true;
  }
  const net = sales.reduce((a, s) => a + A.netRevenue(s), 0) + pendingOnline.reduce((a, o) => a + num(o.total) - num(o.delivery_fee), 0);
  const discount = sales.reduce((a, s) => a + num(s.discount), 0) + pendingOnline.reduce((a, o) => a + num(o.discount), 0);
  if (pendingOnline.length) cogsIncomplete = true;
  const customers = new Set([...sales.map((s) => Number(s.customer_id)).filter(Boolean), ...pendingOnline.map((o) => Number(o.customer_id)).filter(Boolean)]);
  let newCustomers = 0;
  let repeat = 0;
  for (const cid of customers) {
    const first = get('SELECT MIN(created_at) AS f FROM sales WHERE customer_id = ?', [cid]);
    const firstAttributed = sales.filter((s) => Number(s.customer_id) === cid).map((s) => s.created_at).sort()[0];
    if (first?.f && firstAttributed && String(first.f) >= String(firstAttributed)) newCustomers += 1;
    if (firstAttributed) {
      const after = get('SELECT COUNT(*) AS n FROM sales WHERE customer_id = ? AND created_at > ?', [cid, firstAttributed]);
      if (num(after?.n) > 0) repeat += 1;
    }
  }
  return {
    evidence, orders: sales.length + pendingOnline.length, pending_online_orders: pendingOnline.length,
    sale_ids: sales.map((s) => Number(s.id)), customers: customers.size,
    gross_revenue: money(net + discount), discount: money(discount), revenue: money(net),
    cogs: money(cogs), cogs_incomplete: cogsIncomplete, gross_profit: money(net - cogs),
    new_customers: newCustomers, repeat_customers: repeat,
    has_evidence: evidence.length > 0
  };
}

function campaignResults(id) {
  const c = presentCampaign(getCampaignRow(id));
  if (!c) throw new Error('Campaign not found');
  const att = attribution(c.id);
  const costs = all('SELECT * FROM mkt_campaign_costs WHERE campaign_id = ?', [c.id]);
  const cost = money(costs.reduce((a, r) => a + num(r.amount), 0));
  const from = c.launched_at || c.start_at;
  let totalDuring = null;
  if (from) {
    const to = c.end_at || nowSql();
    const rows = all('SELECT * FROM sales WHERE created_at >= ? AND created_at <= ?', [from, to.length === 10 ? `${to} 23:59:59` : to])
      .filter(A.isValidSale).filter((s) => !c.branch_id || Number(s.branch_id || 1) === Number(c.branch_id));
    totalDuring = { revenue: money(rows.reduce((a, s) => a + A.netRevenue(s), 0)), orders: rows.length, from, to };
  }
  const contribution = money(att.gross_profit - cost);
  return {
    campaign_id: c.id, name: c.name, status: c.status,
    attributed: {
      ...att,
      label: 'Attributed revenue — orders linked to this campaign by voucher redemption, combo sale or referral code',
      note: att.has_evidence ? (att.cogs_incomplete ? 'COGS is incomplete — some sold items have no recorded cost, so gross profit is overstated.' : null)
        : 'No attribution evidence — this campaign has no voucher, combo or referral code to link sales to.'
    },
    total_revenue_during_campaign: totalDuring ? { ...totalDuring, label: 'Total revenue during the campaign period (not attributed)' } : null,
    marketing_cost: cost, cost_records: costs,
    contribution,
    roi_pct: cost > 0 ? Math.round((contribution / cost) * 1000) / 10 : null,
    roi_note: cost > 0 ? (att.cogs_incomplete ? 'ROI uses incomplete COGS.' : null) : 'ROI unavailable — marketing cost data required.',
    delivery: deliveryStats(c.id)
  };
}

function campaignReport(id) {
  const c = presentCampaign(getCampaignRow(id));
  if (!c) throw new Error('Campaign not found');
  const r = campaignResults(id);
  const facts = [
    `Offer: ${c.promotion_type ? `${c.promotion_type}${c.promotion_code ? ` (${c.promotion_code})` : ''}` : 'no promotion linked'}`,
    `Audience: ${describeAudience(c.audience)}; ${c.recipients_count ?? 0} recipients, ${c.queued_count ?? 0} messages queued`,
    `Attributed orders: ${r.attributed.orders}; revenue R${r.attributed.revenue}; discounts R${r.attributed.discount}`,
    `COGS R${r.attributed.cogs}${r.attributed.cogs_incomplete ? ' (incomplete)' : ''}; gross profit R${r.attributed.gross_profit}`,
    `Marketing cost R${r.marketing_cost}; contribution R${r.contribution}; ROI ${r.roi_pct != null ? `${r.roi_pct}%` : 'unavailable'}`,
    `New customers acquired: ${r.attributed.new_customers}; customers who purchased again after: ${r.attributed.repeat_customers}`
  ];
  const analysis = [];
  if (!r.attributed.has_evidence) analysis.push('Results cannot be attributed: no voucher, combo or referral code was linked.');
  else if (r.attributed.orders === 0) analysis.push('No orders used the campaign promotion during the measured period.');
  else {
    if (c.recipients_count > 0) analysis.push(`${pct(r.attributed.orders, c.recipients_count)}% of recipients placed an attributed order.`);
    if (r.roi_pct != null) analysis.push(r.roi_pct >= 0 ? 'Gross profit covered the recorded marketing cost.' : 'Gross profit did not cover the recorded marketing cost.');
  }
  analysis.push('Causes are not inferred — only linked orders are counted.');
  return { campaign: c, results: r, facts, analysis };
}

function describeAudience(a = {}) {
  if (a.type === 'customers') return `${(a.ids || []).length} selected customers`;
  if (a.type === 'all_customers') return 'all customers';
  const seg = A.SEGMENTS.find((s) => s.key === a.segment);
  return seg ? seg.label : 'segment';
}

function abReport(group) {
  const settings = getSettings();
  const rows = all('SELECT id FROM mkt_campaigns WHERE ab_group = ? ORDER BY id', [String(group || '')]);
  if (rows.length < 2) throw new Error('An A/B test needs at least two campaigns in the same group');
  const variants = rows.map((r) => {
    const c = presentCampaign(getCampaignRow(r.id));
    const res = campaignResults(r.id);
    return {
      campaign_id: c.id, variant: c.variant_label || `#${c.id}`, name: c.name, status: c.status,
      orders: res.attributed.orders, revenue: res.attributed.revenue, aov: res.attributed.orders ? money(res.attributed.revenue / res.attributed.orders) : null,
      discount: res.attributed.discount, cogs: res.attributed.cogs, gross_profit: res.attributed.gross_profit,
      repeat_customers: res.attributed.repeat_customers, cogs_incomplete: res.attributed.cogs_incomplete
    };
  });
  const min = num(settings.ab_min_orders) || 30;
  const enough = variants.every((v) => v.orders >= min);
  let winner = null;
  if (enough) {
    const sorted = [...variants].sort((a, b) => b.gross_profit - a.gross_profit);
    if (sorted[0].gross_profit > sorted[1].gross_profit * 1.1) winner = sorted[0].variant;
  }
  return {
    group, variants, min_orders_per_variant: min, winner,
    conclusion: !enough ? `Insufficient data — each variant needs at least ${min} attributed orders before a winner can be declared.`
      : winner ? `Variant ${winner} produced at least 10% more gross profit.` : 'No clear winner — variants are within 10% on gross profit.'
  };
}

/* ─────────────────────────── Costs & budget ─────────────────────────── */

function addCampaignCost(id, d = {}, actor) {
  const user = requirePerm(actor, 'mkt_budget');
  const c = getCampaignRow(id);
  if (!c) throw new Error('Campaign not found');
  const amount = money(d.amount);
  if (!(amount > 0)) throw new Error('Cost amount must be greater than zero');
  const description = String(d.description || '').trim() || `Marketing: ${c.name}`;
  try { require('./expense-app-platform').ensureSchema?.(); } catch (_) { /* optional */ }
  const store = require('./store');
  const exp = store.saveExpense({
    category: 'Marketing', description: `[Campaign #${c.id}] ${description}`.slice(0, 500), amount,
    expense_date: d.expense_date || new Date().toLocaleDateString('en-CA'), branch_id: c.branch_id || d.branch_id || undefined,
    payment_method: d.payment_method || 'cash', vendor_name: d.vendor_name || null
  }, user.id, user.full_name || user.username);
  const expenseId = Number(exp?.id || exp?.expense_id || exp) || null;
  const r = run('INSERT INTO mkt_campaign_costs (campaign_id, expense_id, amount, channel, description, created_by, created_at) VALUES (?,?,?,?,?,?,?)',
    [c.id, expenseId, amount, d.channel || null, description, user.id, nowSql()]);
  const costId = insertId(r, 'mkt_campaign_costs');
  audit(user, 'campaign_cost_recorded', 'marketing_campaign', c.id, { campaign_id: c.id, cost_id: costId, expense_id: expenseId, amount, channel: d.channel || null });
  return { id: costId, expense_id: expenseId, amount, note: 'Recorded as a Marketing expense — it flows into the existing accounting ledger.' };
}

function marketingExpenses(from, to, branchId) {
  let rows = [];
  try {
    rows = all('SELECT id, category, description, amount, expense_date, branch_id FROM expenses WHERE expense_date >= ? AND expense_date <= ?', [from, to]);
  } catch (_) { rows = []; }
  return rows.filter((r) => /market|advert|promot/i.test(String(r.category || '')))
    .filter((r) => !branchId || Number(r.branch_id) === Number(branchId));
}

function monthRange(period) {
  const m = String(period || '').match(/^(\d{4})-(\d{2})$/);
  const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, 1)) : new Date();
  const y = d.getUTCFullYear(); const mo = d.getUTCMonth();
  const from = new Date(Date.UTC(y, mo, 1)).toISOString().slice(0, 10);
  const to = new Date(Date.UTC(y, mo + 1, 0)).toISOString().slice(0, 10);
  return { period: from.slice(0, 7), from, to };
}

function saveBudget(d = {}, actor) {
  const user = requirePerm(actor, 'mkt_budget');
  ensureSchema();
  const scope = ['monthly', 'campaign', 'branch', 'channel'].includes(d.scope) ? d.scope : 'monthly';
  const amount = money(d.amount);
  if (!(amount > 0)) throw new Error('Budget amount must be greater than zero');
  const { period } = monthRange(d.period);
  const scopeRef = scope === 'monthly' ? null : String(d.scope_ref || '').trim();
  if (scope !== 'monthly' && !scopeRef) throw new Error('Choose what this budget applies to');
  const existing = get('SELECT * FROM mkt_budgets WHERE period = ? AND scope = ? AND COALESCE(scope_ref, \'\') = ?', [period, scope, scopeRef || '']);
  if (existing) {
    run('UPDATE mkt_budgets SET amount = ?, notes = ?, updated_at = ? WHERE id = ?', [amount, d.notes || null, nowSql(), existing.id]);
    audit(user, 'marketing_budget_updated', 'marketing_budget', existing.id, { before: existing, after: { amount, notes: d.notes || null } });
    return get('SELECT * FROM mkt_budgets WHERE id = ?', [existing.id]);
  }
  const r = run('INSERT INTO mkt_budgets (period, scope, scope_ref, amount, notes, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
    [period, scope, scopeRef, amount, d.notes || null, user.id, nowSql(), nowSql()]);
  const id = insertId(r, 'mkt_budgets');
  audit(user, 'marketing_budget_created', 'marketing_budget', id, { after: { period, scope, scope_ref: scopeRef, amount } });
  return get('SELECT * FROM mkt_budgets WHERE id = ?', [id]);
}

function deleteBudget(id, actor) {
  const user = requirePerm(actor, 'mkt_budget');
  const before = get('SELECT * FROM mkt_budgets WHERE id = ?', [Number(id)]);
  if (!before) throw new Error('Budget not found');
  run('DELETE FROM mkt_budgets WHERE id = ?', [before.id]);
  audit(user, 'marketing_budget_deleted', 'marketing_budget', before.id, { before });
  return { ok: true };
}

function budgetStatus(period) {
  ensureSchema();
  const settings = getSettings();
  const { period: p, from, to } = monthRange(period);
  const budgets = all('SELECT * FROM mkt_budgets WHERE period = ? ORDER BY scope, id', [p]);
  const expenses = marketingExpenses(from, to, null);
  const costs = all('SELECT cc.*, c.branch_id FROM mkt_campaign_costs cc LEFT JOIN mkt_campaigns c ON c.id = cc.campaign_id WHERE cc.created_at >= ? AND cc.created_at <= ?', [`${from} 00:00:00`, `${to} 23:59:59`]);
  const warnPct = num(settings.budget_warn_pct) || 80;
  const rows = budgets.map((b) => {
    let actual = 0;
    if (b.scope === 'monthly') actual = expenses.reduce((a, e) => a + num(e.amount), 0);
    else if (b.scope === 'branch') actual = expenses.filter((e) => String(e.branch_id) === String(b.scope_ref)).reduce((a, e) => a + num(e.amount), 0);
    else if (b.scope === 'campaign') actual = all('SELECT COALESCE(SUM(amount),0) AS s FROM mkt_campaign_costs WHERE campaign_id = ?', [Number(b.scope_ref)])[0]?.s || 0;
    else if (b.scope === 'channel') actual = costs.filter((x) => String(x.channel || '') === String(b.scope_ref)).reduce((a, x) => a + num(x.amount), 0);
    actual = money(actual);
    const used = b.amount > 0 ? Math.round((actual / b.amount) * 1000) / 10 : null;
    return {
      ...b, actual, remaining: money(b.amount - actual), used_pct: used,
      alert: used == null ? null : used >= 100 ? 'exceeded' : used >= warnPct ? 'approaching' : null
    };
  });
  return {
    period: p, from, to, budgets: rows, warn_pct: warnPct,
    marketing_expenses: { total: money(expenses.reduce((a, e) => a + num(e.amount), 0)), count: expenses.length },
    note: 'Actual spend comes from expenses whose category contains "marketing", "advertising" or "promotion", including campaign costs recorded here.'
  };
}

/* ─────────────────────────── Dashboard ─────────────────────────── */

function dashboard(filters = {}, actor) {
  ensureSchema();
  refreshStatuses();
  const branchId = actor ? scopeBranch(actor, filters.branch_id) : null;
  const settings = getSettings();
  const data = A.loadData({ days: filters.days || settings.analysis_days, branchId, fresh: !!filters.fresh });
  const profiles = A.customerProfiles(data);
  const seg = (k, params) => A.segmentMembers(data, profiles, k, params || {}, settings).length;
  const campaigns = all('SELECT status, COUNT(*) AS n FROM mkt_campaigns GROUP BY status');
  const byStatus = Object.fromEntries(CAMPAIGN_STATUSES.map((s) => [s, 0]));
  for (const r of campaigns) byStatus[r.status] = num(r.n);
  const orders = data.sales.length;
  const revenue = data.sales.reduce((a, s) => a + A.netRevenue(s), 0);
  const repeatOrders = profiles.filter((p) => p.orders >= 2).reduce((a, p) => a + p.orders - 1, 0);
  const campaignIds = all("SELECT id FROM mkt_campaigns WHERE status IN ('active','scheduled','paused','completed')").map((r) => r.id);
  let attributed = { revenue: 0, orders: 0, discount: 0, cogs: 0, gross_profit: 0, new_customers: 0, cogs_incomplete: false };
  for (const id of campaignIds) {
    const a = attribution(id);
    attributed.revenue += a.revenue; attributed.orders += a.orders; attributed.discount += a.discount;
    attributed.cogs += a.cogs; attributed.gross_profit += a.gross_profit; attributed.new_customers += a.new_customers;
    attributed.cogs_incomplete = attributed.cogs_incomplete || a.cogs_incomplete;
  }
  const costTotal = num(all('SELECT COALESCE(SUM(amount),0) AS s FROM mkt_campaign_costs')[0]?.s);
  const since = data.since.slice(0, 10);
  const mktExp = marketingExpenses(since, new Date().toISOString().slice(0, 10), branchId);
  const contribution = attributed.gross_profit - costTotal;
  const loyalty = A.loyaltySummary(data, settings);
  const idsCustomers = new Set(profiles.map((p) => p.id));
  const launchedRows = all("SELECT id, recipients_count FROM mkt_campaigns WHERE launched_at IS NOT NULL AND status NOT IN ('archived')");
  const recipientsTotal = launchedRows.reduce((a, r) => a + num(r.recipients_count), 0);
  let redemptions = { total: 0, in_window: 0, discount_in_window: 0 };
  try {
    const rr = all('SELECT created_at, discount FROM discount_voucher_redemptions');
    redemptions = {
      total: rr.length,
      in_window: rr.filter((r) => String(r.created_at || '') >= data.since).length,
      discount_in_window: money(rr.filter((r) => String(r.created_at || '') >= data.since).reduce((a, r) => a + num(r.discount), 0))
    };
  } catch (_) { /* redemption log not initialised */ }
  const prod = A.productPerformance(data, settings);
  const ref = A.referralSummary(data);
  const quiet = A.quietPeriods(data, settings);
  const today = new Date().toISOString().slice(0, 10);
  const in30 = new Date(Date.now() + 30 * A.DAY).toISOString().slice(0, 10);
  const upcoming = all("SELECT id, name, status, start_at, scheduled_at, end_at FROM mkt_campaigns WHERE status IN ('approved','scheduled','active','awaiting_approval')")
    .map((c) => ({ id: c.id, name: c.name, status: c.status, date: String(c.scheduled_at || c.start_at || '').slice(0, 10), end: String(c.end_at || '').slice(0, 10) }))
    .filter((c) => c.date && c.date >= today && c.date <= in30)
    .concat(all('SELECT id, title, event_date FROM mkt_events WHERE event_date >= ? AND event_date <= ?', [today, in30]).map((e) => ({ id: e.id, name: e.title, status: 'event', date: e.event_date, type: 'business_event' })))
    .sort((a, b) => a.date.localeCompare(b.date)).slice(0, 15);
  return {
    window: { days: data.days, since, branch_id: branchId },
    campaigns: {
      active: byStatus.active, scheduled: byStatus.scheduled, draft: byStatus.draft, completed: byStatus.completed,
      paused: byStatus.paused, awaiting_approval: byStatus.awaiting_approval, approved: byStatus.approved, cancelled: byStatus.cancelled
    },
    customers: {
      total: data.customers.length, purchasing_in_window: idsCustomers.size,
      new: seg('new'), returning: seg('returning'), inactive: seg('inactive'), high_value: seg('high_value'),
      loyalty: loyalty.members, referral: seg('referral'),
      approaching_reward: loyalty.approaching_reward ? loyalty.approaching_reward.length : null,
      approaching_reward_note: loyalty.approaching_note,
      at_risk: seg('declining'), overdue: seg('overdue'),
      anonymous_orders: data.sales.filter((s) => !s.customer_id).length
    },
    sales: {
      orders, revenue: money(revenue), aov: orders ? money(revenue / orders) : null,
      repeat_purchases: repeatOrders,
      marketing_attributed_revenue: money(attributed.revenue), orders_from_campaigns: attributed.orders,
      new_customers_from_campaigns: attributed.new_customers,
      note: orders ? null : 'Insufficient data — no sales in the analysis window.'
    },
    financial: {
      campaign_revenue: money(attributed.revenue), discounts: money(attributed.discount), cogs: money(attributed.cogs),
      cogs_incomplete: attributed.cogs_incomplete, gross_profit: money(attributed.gross_profit),
      campaign_costs: money(costTotal), marketing_expenses_in_window: money(mktExp.reduce((a, e) => a + num(e.amount), 0)),
      contribution: money(contribution), roi_pct: costTotal > 0 ? Math.round((contribution / costTotal) * 1000) / 10 : null,
      roi_note: costTotal > 0 ? null : 'ROI unavailable — marketing cost data required.',
      shop_discounts_in_window: money(data.sales.reduce((a, s) => a + num(s.discount), 0)),
      roas: costTotal > 0 ? Math.round((attributed.revenue / costTotal) * 100) / 100 : null
    },
    campaign_conversion: {
      recipients: recipientsTotal, attributed_orders: attributed.orders,
      rate_pct: recipientsTotal > 0 ? pct(attributed.orders, recipientsTotal) : null,
      note: recipientsTotal > 0 ? 'Attributed orders ÷ campaign recipients (evidence-linked orders only).' : 'No campaign recipients yet — conversion unavailable.'
    },
    vouchers: redemptions,
    loyalty_activity: { earned: loyalty.earned_in_window, redeemed: loyalty.redeemed_in_window, members: loyalty.members, expiring_14d: loyalty.expiring_14d.length },
    referrals: {
      agents: ref.agents.length, referral_orders: ref.agents.reduce((a, x) => a + x.orders_in_window, 0),
      referral_revenue: money(ref.agents.reduce((a, x) => a + x.revenue_in_window, 0)), online_signups: ref.online_signups_with_referral_code
    },
    top_products: prod.best_sellers.slice(0, 5).map((p) => ({ product_id: p.product_id, name: p.name, units: p.units_sold, revenue: p.revenue })),
    segments: A.segmentSummary(data, settings),
    branches: A.branchComparison(data),
    quiet: quiet.insufficient ? { insufficient: true, message: quiet.message } : { quiet_periods: quiet.quiet_periods.slice(0, 3), hourly_mean: quiet.hourly_mean },
    upcoming,
    channels: channelStatus()
  };
}

/* ─────────────────────────── Decision Center ─────────────────────────── */

function decisionCenter(filters = {}, actor) {
  ensureSchema();
  const branchId = actor ? scopeBranch(actor, filters.branch_id) : null;
  const settings = getSettings();
  const data = A.loadData({ days: filters.days || settings.analysis_days, branchId, fresh: !!filters.fresh });
  const profiles = A.customerProfiles(data);
  const cards = [];
  const productNamesOf = (list) => {
    const counts = new Map();
    for (const p of list) for (const t of p.top_products) counts.set(t.name, (counts.get(t.name) || 0) + t.orders);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([n]) => n);
  };
  const branchName = (id) => data.branches.find((b) => Number(b.id) === Number(id))?.name || (id ? `Branch ${id}` : '—');

  const inactiveDays = num(filters.inactivity_days || settings.inactivity_days) || 30;
  const inactive = A.segmentMembers(data, profiles, 'inactive', { days: inactiveDays }, settings);
  if (inactive.length) {
    const intervals = inactive.map((p) => p.avg_interval_days).filter((x) => x != null);
    const branchCounts = new Map();
    inactive.forEach((p) => branchCounts.set(p.preferred_branch_id, (branchCounts.get(p.preferred_branch_id) || 0) + 1));
    cards.push({
      kind: 'win_back', title: 'Win-back opportunity',
      headline: `${inactive.length} customer${inactive.length === 1 ? ' has' : 's have'} not purchased for ${inactiveDays}+ days.`,
      facts: {
        customers: inactive.length,
        historical_spend: money(inactive.reduce((a, p) => a + p.spend, 0)),
        median_last_purchase_days: median(inactive.map((p) => p.days_since_last)),
        typical_interval_days: intervals.length ? median(intervals) : null,
        common_products: productNamesOf(inactive),
        branches: [...branchCounts.entries()].map(([b, n]) => `${branchName(b)}: ${n}`)
      },
      why: `Customers with at least one order in the last ${data.days} days whose latest order is ${inactiveDays}+ days ago.`,
      actions: ['view_customers', 'create_campaign', 'create_promotion'],
      audience: { type: 'segment', segment: 'inactive', params: { days: inactiveDays } }, objective: 'win_back'
    });
  }
  const overdueList = A.segmentMembers(data, profiles, 'overdue', {}, settings);
  if (overdueList.length) {
    cards.push({
      kind: 'overdue', title: 'Overdue for usual purchase',
      headline: `${overdueList.length} regular customer${overdueList.length === 1 ? ' is' : 's are'} past 1.5× their usual purchase interval.`,
      facts: { customers: overdueList.length, historical_spend: money(overdueList.reduce((a, p) => a + p.spend, 0)), common_products: productNamesOf(overdueList) },
      why: 'Based on previous purchasing behaviour (3+ orders); this is a pattern, not a certainty.',
      actions: ['view_customers', 'create_campaign'], audience: { type: 'segment', segment: 'overdue' }, objective: 'win_back'
    });
  }
  const decliningList = A.segmentMembers(data, profiles, 'declining', {}, settings);
  if (decliningList.length) {
    cards.push({
      kind: 'declining', title: 'Declining activity',
      headline: `${decliningList.length} customer${decliningList.length === 1 ? '\'s' : 's\''} purchase frequency has decreased.`,
      facts: { customers: decliningList.length, examples: decliningList.slice(0, 3).map((p) => { const d = A.declining(p, data.nowMs); return `${p.name}: ${d.prior_monthly}/month before, ${d.recent_30d} in the last 30 days`; }) },
      why: 'Last 30 days compared with the average of the previous 90 days (3+ prior orders). No reasons are inferred.',
      actions: ['view_customers', 'create_campaign'], audience: { type: 'segment', segment: 'declining' }, objective: 'win_back'
    });
  }
  const prod = A.productPerformance(data, settings);
  for (const p of prod.overstock.slice(0, 3).concat(prod.slow_moving.filter((s) => !prod.overstock.find((o) => o.product_id === s.product_id)).slice(0, 3))) {
    cards.push({
      kind: 'product', title: 'Stock opportunity',
      headline: `${p.name} has ${p.stock} in stock and sells about ${p.weekly_units_28d} per week.`,
      facts: {
        product_id: p.product_id, product: p.name, stock: p.stock, weekly_sales_28d: p.weekly_units_28d, weekly_sales_window: p.weekly_units,
        weeks_of_cover: p.weeks_of_cover, selling_price: p.price, cost: p.cost, margin_pct: p.margin_pct,
        cost_note: p.cost_missing ? 'Promotion margin cannot be calculated because this product has no cost data.' : null
      },
      why: p.weeks_of_cover != null ? `Stock covers ${p.weeks_of_cover} weeks at the last-28-day sales rate (threshold ${prod.thresholds.overstock_weeks}).`
        : `Sold below ${prod.thresholds.slow_weekly_units} per week over the last 28 days while stock is on hand.`,
      actions: ['create_promotion', 'open_menu_builder', 'open_promo_video_builder', 'create_campaign'],
      products: [p.product_id], objective: 'clear_stock'
    });
  }
  const cs = A.crossSell(data, settings);
  for (const pair of cs.pairs.filter((x) => x.product_a_id < x.product_b_id || !cs.pairs.find((y) => y.product_a_id === x.product_b_id && y.product_b_id === x.product_a_id)).slice(0, 3)) {
    cards.push({
      kind: 'cross_sell', title: 'Cross-sell opportunity',
      headline: `${pair.pct_of_a_orders}% of orders with ${pair.product_a} also include ${pair.product_b}.`,
      facts: pair, why: `${pair.orders_with_both} orders contained both products out of ${pair.orders_with_a} orders with ${pair.product_a}.`,
      actions: ['create_bundle', 'create_campaign'], products: [pair.product_a_id, pair.product_b_id], objective: 'increase_aov'
    });
  }
  const up = A.upsell(data, settings);
  for (const u of up.suggestions.slice(0, 2)) {
    cards.push({
      kind: 'upsell', title: 'Upsell pattern',
      headline: `${u.customers_buying_both} of ${u.customers_buying_from} customers who buy ${u.from_product} also buy ${u.to_product} (+R${u.price_step}).`,
      facts: u, why: 'Same category, higher price, bought by the same customers.',
      actions: ['create_bundle', 'create_campaign'], products: [u.from_product_id, u.to_product_id], objective: 'increase_aov'
    });
  }
  const q = A.quietPeriods(data, settings);
  if (!q.insufficient) {
    for (const qp of q.quiet_periods.slice(0, 2)) {
      cards.push({
        kind: 'quiet_period', title: 'Quiet period',
        headline: `Sales from ${qp.label} are ${qp.pct_below_mean}% below the average trading hour.`,
        facts: { ...qp, hourly_mean: q.hourly_mean, trading_days: q.trading_days },
        why: `Average revenue per hour across ${q.trading_days} trading days (recorded sale times).`,
        actions: ['create_time_campaign'], time_window: { start: `${String(qp.start_hour).padStart(2, '0')}:00`, end: `${String(qp.end_hour).padStart(2, '0')}:00` },
        objective: 'quiet_period'
      });
    }
  }
  const loyalty = A.loyaltySummary(data, settings);
  if (loyalty.approaching_reward && loyalty.approaching_reward.length) {
    cards.push({
      kind: 'loyalty', title: 'Loyalty opportunity',
      headline: `${loyalty.approaching_reward.length} customers are within ${settings.near_reward_points} points of the ${settings.reward_points_target}-point reward target.`,
      facts: { customers: loyalty.approaching_reward.length, target: settings.reward_points_target },
      why: 'Current balances from the existing loyalty engine.', actions: ['create_loyalty_campaign', 'view_customers'],
      audience: { type: 'customers', ids: loyalty.approaching_reward.map((c) => c.id) }, objective: 'loyalty_engagement'
    });
  }
  if (loyalty.expiring_14d.length) {
    cards.push({
      kind: 'loyalty_expiry', title: 'Points expiring soon',
      headline: `${loyalty.expiring_14d.length} customer${loyalty.expiring_14d.length === 1 ? ' has' : 's have'} ${loyalty.expiring_14d.reduce((a, c) => a + c.points, 0)} points expiring within 14 days.`,
      facts: { customers: loyalty.expiring_14d.length, examples: loyalty.expiring_14d.slice(0, 5) },
      why: 'Point lots from the loyalty engine with an expiry date in the next 14 days.',
      actions: ['create_loyalty_campaign', 'view_customers'],
      audience: { type: 'customers', ids: loyalty.expiring_14d.map((c) => c.id) }, objective: 'loyalty_engagement'
    });
  }
  const ref = A.referralSummary(data);
  const topRef = ref.agents.filter((a) => a.orders_in_window > 0 || a.referred_customers > 0).slice(0, 2);
  for (const a of topRef) {
    cards.push({
      kind: 'referral', title: 'Referral opportunity',
      headline: `${a.name} has ${a.referred_customers} referred customer${a.referred_customers === 1 ? '' : 's'} and ${a.orders_in_window} referral order${a.orders_in_window === 1 ? '' : 's'} in the window.`,
      facts: a, why: 'From the existing referral system (attributions and sales carrying the agent\'s code).',
      actions: ['create_referral_campaign'], referral_code: a.code, objective: 'increase_referrals'
    });
  }
  const upcoming = A.upcomingDates(data, 14);
  if (upcoming.length) {
    cards.push({
      kind: 'dates', title: 'Upcoming birthdays & anniversaries',
      headline: `${upcoming.length} customer date${upcoming.length === 1 ? '' : 's'} in the next 14 days.`,
      facts: { upcoming: upcoming.slice(0, 8) }, why: 'Optional dates saved on customer profiles.',
      actions: ['create_birthday_offers', 'view_customers'], objective: 'loyalty_engagement'
    });
  }
  const missing = [];
  if (!data.sales.length) missing.push(`No sales in the last ${data.days} days.`);
  if (data.sales.length && !profiles.length) missing.push('No sales are linked to customers — customer opportunities need customer-linked sales.');
  if (prod.missing_cost.length) missing.push(`${prod.missing_cost.length} active product(s) have no cost data — margins cannot be calculated for them.`);
  return { window: { days: data.days, branch_id: branchId }, cards, insufficient: missing, generated_at: nowSql() };
}

function median(arr) {
  const a = arr.filter((x) => x != null).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : Math.round(((a[m - 1] + a[m]) / 2) * 10) / 10;
}

/* ─────────────────────────── Customers / products views ─────────────────────────── */

function customersView(filters = {}, actor) {
  const branchId = actor ? scopeBranch(actor, filters.branch_id) : null;
  const settings = getSettings();
  const data = A.loadData({ days: filters.days || settings.analysis_days, branchId });
  const profiles = A.customerProfiles(data);
  const list = filters.segment ? A.segmentMembers(data, profiles, filters.segment, filters.params || {}, settings) : profiles;
  const ids = Array.isArray(filters.ids) ? new Set(filters.ids.map(Number)) : null;
  const rows = (ids ? profiles.filter((p) => ids.has(p.id)) : list)
    .sort((a, b) => b.spend - a.spend).slice(0, Math.min(1000, Number(filters.limit) || 300))
    .map((p) => ({
      ...A.publicProfile(p), lifetime: A.customerLifetime(p), overdue: A.overdue(p), declining: A.declining(p, data.nowMs),
      branch: data.branches.find((b) => Number(b.id) === Number(p.preferred_branch_id))?.name || null
    }));
  return { window: { days: data.days, branch_id: branchId }, total: ids ? rows.length : list.length, customers: rows };
}

function customerDetail(id, filters = {}) {
  const settings = getSettings();
  const data = A.loadData({ days: filters.days || settings.analysis_days });
  const p = A.customerProfiles(data).find((x) => x.id === Number(id));
  const c = data.customerById.get(Number(id));
  if (!c) throw new Error('Customer not found');
  let prefs = null;
  try { prefs = require('./communication-center').getCustomerPrefs(c.phone || c.email); } catch (_) { /* */ }
  return {
    id: Number(c.id), name: c.name, phone_masked: A.maskPhone(c.phone), has_email: !!c.email, loyalty_points: num(c.loyalty_points),
    birthday: c.birthday || null, anniversary_date: c.anniversary_date || null, anniversary_type: c.anniversary_type || null,
    behaviour: p ? A.publicProfile(p) : null, lifetime: p ? A.customerLifetime(p) : null,
    overdue: p ? A.overdue(p) : null, declining: p ? A.declining(p, data.nowMs) : null,
    loyalty_history: all('SELECT points, type, sale_id, notes, created_at FROM loyalty_transactions WHERE customer_id = ? ORDER BY id DESC LIMIT 50', [c.id]),
    referral: get('SELECT agent_id, referral_code, source, attributed_at FROM referral_customer_attributions WHERE customer_id = ?', [c.id]),
    consent: prefs, suppressed: !!get('SELECT id FROM mkt_suppressions WHERE customer_id = ?', [c.id]),
    note: p ? null : `No purchases linked to this customer in the last ${data.days} days.`
  };
}

function simpleView(fn) {
  return (filters = {}, actor) => {
    const branchId = actor ? scopeBranch(actor, filters.branch_id) : null;
    const settings = getSettings();
    const data = A.loadData({ days: filters.days || settings.analysis_days, branchId });
    return { window: { days: data.days, branch_id: branchId }, ...fn(data, settings, filters) };
  };
}

const segmentsView = simpleView((data, settings) => ({ segments: A.segmentSummary(data, settings), definitions: A.SEGMENTS }));
const productsView = simpleView((data, settings) => A.productPerformance(data, settings));
const patternsView = simpleView((data, settings) => ({ cross_sell: A.crossSell(data, settings), upsell: A.upsell(data, settings) }));
const quietView = simpleView((data, settings) => A.quietPeriods(data, settings));
const branchesView = simpleView((data) => ({ branches: A.branchComparison(data) }));
const loyaltyView = simpleView((data, settings) => A.loyaltySummary(data, settings));
const referralsView = simpleView((data) => A.referralSummary(data));
const datesView = simpleView((data, settings, f) => ({ upcoming: A.upcomingDates(data, Math.min(60, Number(f.days_ahead) || 14)), offers: { birthday: settings.birthday_offer, anniversary: settings.anniversary_offer } }));

/* ─────────────────────────── Birthday / anniversary offers ─────────────────────────── */

function createDateOffers(d = {}, actor) {
  const user = requirePerm(actor, 'mkt_promotions');
  requirePerm(actor, 'mkt_campaign_create');
  const kind = d.kind === 'anniversary' ? 'anniversary' : 'birthday';
  const settings = getSettings();
  const offer = { ...settings[`${kind}_offer`], ...(d.offer || {}) };
  if (!(num(offer.discount_value) > 0) && offer.discount_type !== 'free_delivery') throw new Error(`Configure the ${kind} offer (discount value) first`);
  const data = A.loadData({ days: settings.analysis_days });
  const ahead = Math.min(60, Math.max(1, Number(offer.days_ahead) || 7));
  const upcoming = A.upcomingDates(data, ahead).filter((u) => u.kind === kind && u.has_phone);
  const cc = require('./communication-center');
  const suppressed = suppressedIds();
  const eligible = upcoming.filter((u) => {
    if (suppressed.has(u.customer_id)) return false;
    const c = data.customerById.get(u.customer_id);
    return ['whatsapp', 'sms', 'email'].some((ch) => {
      const addr = ch === 'email' ? c?.email : c?.phone;
      return addr && cc.prefsAllow(addr, ch, 'marketing');
    });
  });
  if (!eligible.length) throw new Error(`No opted-in customers with a ${kind} in the next ${ahead} days`);
  const campaign = saveCampaign({
    name: d.name || `${kind === 'birthday' ? 'Birthday' : 'Anniversary'} offers ${new Date().toISOString().slice(0, 10)}`,
    objective: 'loyalty_engagement', audience: { type: 'customers', ids: eligible.map((u) => u.customer_id) },
    branch_id: offer.branch_id || null, channels: d.channels || ['whatsapp'],
    content: { body: d.body || '', subject: d.subject || '' }, promotion_type: offer.discount_type === 'free_delivery' ? 'free_delivery' : 'voucher',
    source: { kind: `${kind}_offers`, days_ahead: ahead }
  }, user);
  const vouchers = require('./discount-vouchers');
  const codes = {};
  const created = [];
  const validDays = Math.max(1, Number(offer.valid_days) || 7);
  for (const u of eligible) {
    const code = randomCode(kind === 'birthday' ? 'BDAY' : 'ANNIV');
    const expires = new Date(Date.parse(u.date) + validDays * A.DAY).toISOString().slice(0, 10);
    const v = vouchers.createVoucher({
      code, discount_type: offer.discount_type, discount_value: offer.discount_value, product_id: offer.product_id || null,
      customer_id: u.customer_id, customer_name: u.name, max_uses: 1, expires_at: expires,
      min_order_total: offer.min_order_total, max_discount: offer.max_discount, branch_id: offer.branch_id || null,
      campaign_id: campaign.id, notes: `${kind} offer — campaign #${campaign.id}`
    }, user);
    codes[u.customer_id] = v.code;
    created.push({ customer_id: u.customer_id, name: u.name, code: v.code, date: u.date, expires_at: expires });
  }
  const content = { ...campaign.content, personal_codes: codes };
  run('UPDATE mkt_campaigns SET content_json = ? WHERE id = ?', [JSON.stringify(content), campaign.id]);
  audit(user, 'promotion_created', 'marketing_promotion', campaign.id, { campaign_id: campaign.id, kind: `${kind}_vouchers`, vouchers: created.length });
  return { campaign: getCampaign(campaign.id), vouchers: created, skipped_not_opted_in: upcoming.length - eligible.length };
}

/* ─────────────────────────── Calendar & events ─────────────────────────── */

function calendar(filters = {}) {
  ensureSchema();
  const { from, to, period } = monthRange(filters.month);
  const events = [];
  for (const c of all('SELECT id, name, status, start_at, end_at, scheduled_at, launched_at, created_at FROM mkt_campaigns WHERE status NOT IN (\'cancelled\', \'archived\')')) {
    const planned = String(c.scheduled_at || c.start_at || '').slice(0, 10);
    const s = planned || String(c.launched_at || c.created_at || '').slice(0, 10);
    const e = String(c.end_at || (['active', 'paused'].includes(c.status) && !c.end_at ? to : s)).slice(0, 10);
    if (!s || e < from || s > to) continue;
    events.push({
      type: c.status === 'scheduled' ? 'scheduled_campaign' : 'campaign', campaign_type: 'campaign', id: c.id, title: c.name, status: c.status,
      start: s, end: e < s ? s : e, undated: !planned, date_basis: planned ? 'planned' : (c.launched_at ? 'launched' : 'created')
    });
  }
  try {
    for (const sc of all("SELECT id, name, send_at, status, channels_json FROM cc_schedules WHERE status NOT IN ('cancelled') AND send_at >= ? AND send_at <= ?", [`${from} 00:00:00`, `${to} 23:59:59`])) {
      events.push({ type: 'scheduled_message', id: sc.id, title: `Message: ${sc.name}`, status: sc.status, channels: parseJson(sc.channels_json, []), start: String(sc.send_at).slice(0, 10), end: String(sc.send_at).slice(0, 10) });
    }
  } catch (_) { /* Communication Center schedules not initialised */ }
  try {
    for (const ct of all('SELECT id, title, channel, scheduled_at, status, campaign_id FROM mkt_content WHERE scheduled_at IS NOT NULL AND scheduled_at >= ? AND scheduled_at <= ?', [`${from} 00:00:00`, `${to} 23:59:59`])) {
      events.push({ type: 'content', id: ct.id, title: `Content: ${ct.title}`, status: ct.status, channel: ct.channel, campaign_id: ct.campaign_id, start: String(ct.scheduled_at).slice(0, 10), end: String(ct.scheduled_at).slice(0, 10) });
    }
  } catch (_) { /* content library not initialised */ }
  for (const k of all('SELECT id, name, status, start_date, end_date FROM combos WHERE start_date IS NOT NULL OR end_date IS NOT NULL')) {
    const s = String(k.start_date || from).slice(0, 10);
    const e = String(k.end_date || to).slice(0, 10);
    if (e < from || s > to) continue;
    events.push({ type: 'promotion', id: k.id, title: `Combo: ${k.name}`, status: k.status, start: s, end: e });
  }
  for (const v of all("SELECT id, code, expires_at, status FROM discount_vouchers WHERE expires_at IS NOT NULL AND expires_at >= ? AND expires_at <= ? AND customer_id IS NULL", [from, to])) {
    events.push({ type: 'voucher_expiry', id: v.id, title: `Voucher ${v.code} expires`, status: v.status, start: String(v.expires_at).slice(0, 10), end: String(v.expires_at).slice(0, 10) });
  }
  for (const ev of all('SELECT * FROM mkt_events WHERE event_date <= ? AND COALESCE(end_date, event_date) >= ?', [to, from])) {
    events.push({ type: 'business_event', id: ev.id, title: ev.title, notes: ev.notes, start: ev.event_date, end: ev.end_date || ev.event_date });
  }
  const custs = all('SELECT id, name, birthday, anniversary_date, anniversary_type FROM customers WHERE birthday IS NOT NULL OR anniversary_date IS NOT NULL');
  const mm = period.slice(5, 7);
  for (const c of custs) {
    for (const [field, label] of [['birthday', 'Birthday'], ['anniversary_date', c.anniversary_type || 'Anniversary']]) {
      const m = String(c[field] || '').match(/^\d{4}-(\d{2})-(\d{2})/);
      if (m && m[1] === mm) events.push({ type: field === 'birthday' ? 'birthday' : 'anniversary', id: Number(c.id), title: `${label}: ${c.name}`, start: `${period}-${m[2]}`, end: `${period}-${m[2]}` });
    }
  }
  return { period, from, to, events: events.sort((a, b) => String(a.start).localeCompare(String(b.start))) };
}

function saveEvent(d = {}, actor) {
  const user = requirePerm(actor, 'mkt_campaign_create');
  ensureSchema();
  const title = String(d.title || '').trim();
  if (!title) throw new Error('Event title is required');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d.event_date || ''))) throw new Error('Event date is required');
  const r = run('INSERT INTO mkt_events (title, event_date, end_date, branch_id, notes, created_by, created_at) VALUES (?,?,?,?,?,?,?)',
    [title.slice(0, 160), d.event_date, d.end_date || null, d.branch_id || null, d.notes || null, user.id, nowSql()]);
  const id = insertId(r, 'mkt_events');
  audit(user, 'marketing_event_created', 'marketing_event', id, { after: { title, event_date: d.event_date } });
  return get('SELECT * FROM mkt_events WHERE id = ?', [id]);
}

function deleteEvent(id, actor) {
  const user = requirePerm(actor, 'mkt_campaign_edit');
  const before = get('SELECT * FROM mkt_events WHERE id = ?', [Number(id)]);
  if (!before) throw new Error('Event not found');
  run('DELETE FROM mkt_events WHERE id = ?', [before.id]);
  audit(user, 'marketing_event_deleted', 'marketing_event', before.id, { before });
  return { ok: true };
}

/* ─────────────────────────── Suppressions ─────────────────────────── */

function listSuppressions() {
  ensureSchema();
  return all('SELECT s.*, c.name FROM mkt_suppressions s LEFT JOIN customers c ON c.id = s.customer_id ORDER BY s.id DESC');
}

function addSuppression(d = {}, actor) {
  const user = requirePerm(actor, 'mkt_campaign_edit');
  const cid = Number(d.customer_id);
  if (!cid || !get('SELECT id FROM customers WHERE id = ?', [cid])) throw new Error('Customer not found');
  if (get('SELECT id FROM mkt_suppressions WHERE customer_id = ?', [cid])) return { ok: true, already: true };
  const r = run('INSERT INTO mkt_suppressions (customer_id, reason, created_by, created_at) VALUES (?,?,?,?)', [cid, String(d.reason || '').slice(0, 200) || null, user.id, nowSql()]);
  audit(user, 'marketing_suppression_added', 'marketing_suppression', insertId(r, 'mkt_suppressions'), { customer_id: cid, reason: d.reason || null });
  return { ok: true };
}

function removeSuppression(id, actor) {
  const user = requirePerm(actor, 'mkt_campaign_edit');
  const before = get('SELECT * FROM mkt_suppressions WHERE id = ?', [Number(id)]);
  if (!before) throw new Error('Not found');
  run('DELETE FROM mkt_suppressions WHERE id = ?', [before.id]);
  audit(user, 'marketing_suppression_removed', 'marketing_suppression', before.id, { before });
  return { ok: true };
}

/* ─────────────────────────── AI assistant ─────────────────────────── */

const INTENTS = [
  { key: 'today', re: /today|market (right )?now|what should i market/i },
  { key: 'products', re: /promot|which product|slow|stock|overstock|margin|best sell/i },
  { key: 'customers', re: /which customers|target|inactive|win .*back|churn|becoming inactive|lapsed|overdue/i },
  { key: 'basket', re: /bought together|purchased together|usually buy|bundle|cross|upsell|average order|aov/i },
  { key: 'branch', re: /branch/i },
  { key: 'quiet', re: /quiet|slow hour|time of day|period/i },
  { key: 'campaigns', re: /campaign|performed|worked|result|roi/i },
  { key: 'loyalty', re: /loyal|points|reward/i },
  { key: 'referral', re: /referr/i }
];

function detectIntents(q) {
  const hits = INTENTS.filter((i) => i.re.test(q)).map((i) => i.key);
  return hits.length ? hits : ['today'];
}

function gatherFacts(intents, data, settings) {
  const facts = [];
  const profiles = A.customerProfiles(data);
  const want = (k) => intents.includes(k) || intents.includes('today');
  facts.push({ topic: 'window', text: `Analysis window: last ${data.days} days; ${data.sales.length} valid sales; ${profiles.length} identified customers.` });
  if (want('customers')) {
    const inactive = A.segmentMembers(data, profiles, 'inactive', {}, settings);
    const overdue = A.segmentMembers(data, profiles, 'overdue', {}, settings);
    const declining = A.segmentMembers(data, profiles, 'declining', {}, settings);
    facts.push({ topic: 'customers', text: `${inactive.length} customers have not purchased for ${settings.inactivity_days}+ days (historical spend R${money(inactive.reduce((a, p) => a + p.spend, 0))}).`, data: { inactive: inactive.length } });
    facts.push({ topic: 'customers', text: `${overdue.length} regular customers are past 1.5× their usual purchase interval; ${declining.length} show declining purchase frequency.` });
    const top = [...profiles].sort((a, b) => b.spend - a.spend).slice(0, 5);
    if (top.length) facts.push({ topic: 'customers', text: `Top customers by spend: ${top.map((p) => `${p.name} (R${p.spend}, ${p.orders} orders)`).join('; ')}.` });
  }
  if (want('products')) {
    const prod = A.productPerformance(data, settings);
    if (prod.best_sellers.length) facts.push({ topic: 'products', text: `Best sellers: ${prod.best_sellers.slice(0, 5).map((p) => `${p.name} (${p.units_sold} sold)`).join('; ')}.` });
    if (prod.overstock.length) facts.push({ topic: 'products', text: `Overstocked: ${prod.overstock.slice(0, 5).map((p) => `${p.name} (stock ${p.stock}, ${p.weekly_units_28d}/week, ${p.weeks_of_cover} weeks cover)`).join('; ')}.` });
    if (prod.slow_moving.length) facts.push({ topic: 'products', text: `Slow-moving with stock: ${prod.slow_moving.slice(0, 5).map((p) => `${p.name} (stock ${p.stock}, ${p.weekly_units_28d}/week)`).join('; ')}.` });
    if (prod.high_margin.length) facts.push({ topic: 'products', text: `Highest margins: ${prod.high_margin.slice(0, 5).map((p) => `${p.name} ${p.margin_pct}%`).join('; ')}.` });
    if (prod.low_margin.length) facts.push({ topic: 'products', text: `Lowest margins: ${prod.low_margin.slice(0, 5).map((p) => `${p.name} ${p.margin_pct}%`).join('; ')}.` });
    if (prod.missing_cost.length) facts.push({ topic: 'products', text: `${prod.missing_cost.length} products have no cost data (margins unknown).` });
  }
  if (want('basket')) {
    const cs = A.crossSell(data, settings);
    if (cs.pairs.length) facts.push({ topic: 'basket', text: `Frequently bought together: ${cs.pairs.slice(0, 5).map((p) => `${p.product_a} → ${p.product_b} (${p.orders_with_both} orders, ${p.pct_of_a_orders}%)`).join('; ')}.` });
    const orders = data.sales.length;
    if (orders) facts.push({ topic: 'basket', text: `Average order value: R${money(data.sales.reduce((a, s) => a + A.netRevenue(s), 0) / orders)} over ${orders} orders.` });
    const up = A.upsell(data, settings);
    if (up.suggestions.length) facts.push({ topic: 'basket', text: `Upsell patterns: ${up.suggestions.slice(0, 3).map((u) => `${u.from_product} → ${u.to_product} (${u.customers_buying_both}/${u.customers_buying_from} customers)`).join('; ')}.` });
  }
  if (want('quiet')) {
    const q = A.quietPeriods(data, settings);
    if (q.insufficient) facts.push({ topic: 'quiet', text: q.message });
    else if (q.quiet_periods.length) facts.push({ topic: 'quiet', text: `Quiet hours: ${q.quiet_periods.map((x) => `${x.label} (${x.pct_below_mean}% below average)`).join('; ')}.` });
    else facts.push({ topic: 'quiet', text: `No trading hour is ${settings.quiet_threshold_pct}%+ below the hourly average.` });
  }
  if (intents.includes('branch')) {
    const b = A.branchComparison(data);
    if (b.length) facts.push({ topic: 'branch', text: `Branch revenue: ${b.map((x) => `${x.branch} R${x.revenue} (${x.orders} orders, AOV R${x.aov})`).join('; ')}.` });
  }
  if (want('loyalty')) {
    const l = A.loyaltySummary(data, settings);
    facts.push({ topic: 'loyalty', text: `${l.members} loyalty members hold ${l.points_outstanding} points (value R${l.points_outstanding_value}); ${l.earned_in_window} earned and ${l.redeemed_in_window} redeemed in the window.` });
    if (l.expiring_14d.length) facts.push({ topic: 'loyalty', text: `${l.expiring_14d.length} customers have points expiring within 14 days.` });
  }
  if (intents.includes('referral')) {
    const r = A.referralSummary(data);
    if (r.agents.length) facts.push({ topic: 'referral', text: `Referral agents: ${r.agents.slice(0, 5).map((a) => `${a.name} (${a.referred_customers} referred, ${a.orders_in_window} orders)`).join('; ')}.` });
    else facts.push({ topic: 'referral', text: 'No referral agents exist in the referral system.' });
  }
  if (intents.includes('campaigns')) {
    const rows = all("SELECT id, name, status FROM mkt_campaigns WHERE status IN ('active','completed','paused') ORDER BY id DESC LIMIT 10");
    if (!rows.length) facts.push({ topic: 'campaigns', text: 'No launched campaigns yet — campaign performance cannot be assessed.' });
    for (const c of rows) {
      const r = campaignResults(c.id);
      facts.push({ topic: 'campaigns', text: `Campaign "${c.name}" (${c.status}): ${r.attributed.orders} attributed orders, revenue R${r.attributed.revenue}, gross profit R${r.attributed.gross_profit}, ROI ${r.roi_pct != null ? `${r.roi_pct}%` : 'unavailable'}.` });
    }
  }
  return facts;
}

function ruleBasedAnalysis(intents, data, settings) {
  const analysis = [];
  const suggestions = [];
  const dc = decisionCenter({ days: data.days, branch_id: data.branchId });
  const byKind = (k) => dc.cards.filter((c) => c.kind === k);
  const want = (k) => intents.includes(k) || intents.includes('today');
  if (want('customers')) {
    for (const c of byKind('win_back')) {
      analysis.push(`${c.facts.customers} lapsed customers represent R${c.facts.historical_spend} of historical spend.`);
      suggestions.push({ text: `Consider a win-back campaign for customers inactive ${settings.inactivity_days}+ days${c.facts.common_products.length ? ` featuring ${c.facts.common_products.slice(0, 2).join(' and ')}` : ''}.`, action: 'create_campaign', audience: c.audience, objective: 'win_back' });
    }
  }
  if (want('products')) {
    for (const c of byKind('product').slice(0, 2)) {
      analysis.push(c.headline + (c.facts.margin_pct != null ? ` Current margin ${c.facts.margin_pct}%.` : ' Margin unknown (no cost data).'));
      suggestions.push({ text: `Consider a promotion or bundle for ${c.facts.product}${c.facts.margin_pct != null ? ` — keep the promotional price above cost (R${c.facts.cost})` : ''}.`, action: 'create_promotion', products: c.products, objective: 'clear_stock' });
    }
  }
  if (want('basket')) {
    for (const c of byKind('cross_sell').slice(0, 2)) {
      analysis.push(c.headline);
      suggestions.push({ text: `Consider bundling ${c.facts.product_a} with ${c.facts.product_b} to raise average order value.`, action: 'create_bundle', products: c.products, objective: 'increase_aov' });
    }
  }
  if (want('quiet')) {
    for (const c of byKind('quiet_period')) {
      analysis.push(c.headline);
      suggestions.push({ text: `Consider a time-based offer valid ${c.facts.label} only.`, action: 'create_time_campaign', time_window: c.time_window, objective: 'quiet_period' });
    }
  }
  if (want('loyalty')) {
    for (const c of [...byKind('loyalty'), ...byKind('loyalty_expiry')]) {
      analysis.push(c.headline);
      suggestions.push({ text: 'Consider reminding these loyalty customers about their points (existing loyalty rules apply).', action: 'create_loyalty_campaign', audience: c.audience, objective: 'loyalty_engagement' });
    }
  }
  if (intents.includes('referral')) {
    for (const c of byKind('referral')) {
      analysis.push(c.headline);
      suggestions.push({ text: `Consider a referral campaign using code ${c.referral_code}.`, action: 'create_referral_campaign', referral_code: c.referral_code, objective: 'increase_referrals' });
    }
  }
  if (!analysis.length) analysis.push('The available data does not show a clear opportunity for this question.');
  return { analysis, suggestions, insufficient: dc.insufficient };
}

async function llmAnalysis(question, facts) {
  const apiKey = process.env.SHOP_POS_AI_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const prompt = `You are a marketing analyst for a small food shop. Answer the owner's question using ONLY the FACTS below.
Never invent customers, revenue, costs, products, prices, stock, loyalty balances, referral results or ROI.
If the facts are insufficient, say so. Suggestions are proposals for the owner to approve; never state they have been done.
Return JSON: {"analysis": [string], "suggestions": [{"text": string, "action": one of ["create_campaign","create_promotion","create_bundle","create_time_campaign","create_loyalty_campaign","create_referral_campaign","none"]}]}

QUESTION: ${question}

FACTS:
${facts.map((f, i) => `${i + 1}. ${f.text}`).join('\n')}`;
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: process.env.SHOP_POS_AI_MODEL || 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }], response_format: { type: 'json_object' }, temperature: 0.2 })
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error?.message || `AI API HTTP ${res.status}`);
  const content = parseJson(json.choices?.[0]?.message?.content, {});
  return {
    engine: `openai:${process.env.SHOP_POS_AI_MODEL || 'gpt-4o-mini'}`,
    analysis: (Array.isArray(content.analysis) ? content.analysis : []).map(String).slice(0, 10),
    suggestions: (Array.isArray(content.suggestions) ? content.suggestions : []).slice(0, 8).map((s) => ({ text: String(s.text || ''), action: String(s.action || 'none') }))
  };
}

async function aiAsk(question, filters = {}, actor) {
  const user = requirePerm(actor, 'mkt_ai');
  ensureSchema();
  const q = String(question || '').trim().slice(0, 500) || 'What should I market today?';
  const settings = getSettings();
  const branchId = scopeBranch(user, filters.branch_id);
  const data = A.loadData({ days: filters.days || settings.analysis_days, branchId });
  const intents = detectIntents(q);
  const facts = gatherFacts(intents, data, settings);
  const rule = ruleBasedAnalysis(intents, data, settings);
  let engine = 'rule_based';
  let analysis = rule.analysis;
  let suggestions = rule.suggestions;
  let aiError = null;
  try {
    const llm = await llmAnalysis(q, facts);
    if (llm) {
      engine = llm.engine;
      analysis = llm.analysis.length ? llm.analysis : rule.analysis;
      suggestions = llm.suggestions.length ? llm.suggestions : rule.suggestions;
    }
  } catch (err) {
    aiError = `AI service unavailable (${err.message}) — showing rule-based analysis.`;
  }
  const r = run(`INSERT INTO mkt_recommendations (source, question, engine, facts_json, analysis_json, suggestions_json, status, created_by, created_at)
    VALUES ('ai_assistant', ?, ?, ?, ?, ?, 'generated', ?, ?)`,
  [q, engine, JSON.stringify(facts), JSON.stringify(analysis), JSON.stringify(suggestions), user.id, nowSql()]);
  const id = insertId(r, 'mkt_recommendations');
  audit(user, 'ai_recommendation_generated', 'marketing_recommendation', id, { question: q, engine, suggestions: suggestions.length });
  return {
    id, question: q, engine,
    engine_note: engine === 'rule_based'
      ? (aiError || 'Rule-based analysis — no AI model is configured (set SHOP_POS_AI_API_KEY on the server to enable AI wording). Facts are identical either way.')
      : 'AI wording over database facts. FACTS are produced by the system, not the AI.',
    facts, analysis, suggestions, insufficient: rule.insufficient,
    approval_note: 'Nothing has been changed. Suggestions require your approval and are executed only through the normal campaign/promotion flow.'
  };
}

function decideRecommendation(id, decision, note, actor) {
  const user = requirePerm(actor, 'mkt_ai');
  const r = get('SELECT * FROM mkt_recommendations WHERE id = ?', [Number(id)]);
  if (!r) throw new Error('Recommendation not found');
  if (!['accepted', 'rejected'].includes(decision)) throw new Error('Decision must be accepted or rejected');
  if (r.status !== 'generated') throw new Error(`Recommendation already ${r.status}`);
  run('UPDATE mkt_recommendations SET status = ?, decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ?',
    [decision, user.id, nowSql(), String(note || '').slice(0, 500) || null, r.id]);
  audit(user, decision === 'accepted' ? 'ai_recommendation_accepted' : 'ai_recommendation_rejected', 'marketing_recommendation', r.id,
    { before: { status: r.status }, after: { status: decision }, note: note || null });
  return get('SELECT * FROM mkt_recommendations WHERE id = ?', [r.id]);
}

function listRecommendations(limit = 50) {
  ensureSchema();
  return all('SELECT * FROM mkt_recommendations ORDER BY id DESC LIMIT ?', [Math.min(200, Number(limit) || 50)]).map((r) => ({
    ...r, facts: parseJson(r.facts_json, []), analysis: parseJson(r.analysis_json, []), suggestions: parseJson(r.suggestions_json, [])
  }));
}

/* ─────────────────────────── Content Studio ─────────────────────────── */

function shopInfo(branchId) {
  const s = get('SELECT shop_name, phone, address FROM shop_settings WHERE id = 1') || {};
  const b = branchId ? get('SELECT name, phone, address FROM branches WHERE id = ?', [branchId]) : null;
  return { shop: s.shop_name || '', phone: b?.phone || s.phone || '', branch: b?.name || '', address: b?.address || s.address || '' };
}

async function generateContent(spec = {}, actor) {
  requirePerm(actor, 'mkt_campaign_create');
  const info = shopInfo(spec.branch_id);
  const products = (spec.product_ids || []).map((id) => productRow(id)).filter(Boolean);
  let promo = null;
  if (spec.campaign_id) {
    const c = getCampaignRow(spec.campaign_id);
    if (c?.promotion_type && c.promotion_ref_id) {
      if (['voucher', 'free_delivery'].includes(c.promotion_type)) {
        const v = get('SELECT * FROM discount_vouchers WHERE id = ?', [c.promotion_ref_id]);
        if (v) promo = { code: v.code, text: v.discount_type === 'free_delivery' ? 'free delivery' : v.discount_type === 'percent' ? `${num(v.discount_value)}% off` : `R${money(v.discount_value)} off`, expires: v.expires_at };
      } else if (c.promotion_type !== 'referral_code') {
        const k = require('./combos').getCombo(c.promotion_ref_id);
        if (k) promo = { code: k.combo_code, text: `${k.name} for R${money(k.final_price)} (normally R${money(k.normal_price)})`, expires: k.end_date };
      } else promo = { code: c.promotion_code, text: `use referral code ${c.promotion_code}` };
    }
  }
  const missing = [];
  if (!info.shop) missing.push('Shop name is not set in settings.');
  if (!products.length && !promo) missing.push('Choose at least one product or a campaign with a promotion — content is only generated from real data.');
  if (missing.length && !products.length && !promo) return { ok: false, missing };
  const productLine = products.map((p) => `${p.name} R${money(p.selling_price)}`).join(', ');
  const offerLine = promo ? `${promo.text}${promo.code ? ` — code ${promo.code}` : ''}${promo.expires ? ` (valid until ${String(promo.expires).slice(0, 10)})` : ''}` : '';
  const where = [info.shop, info.branch].filter(Boolean).join(' · ');
  const templates = {
    whatsapp: `Hi {{customer_name}}! ${offerLine ? `${offerLine} at ${where}. ` : ''}${productLine ? `Try: ${productLine}. ` : ''}${info.phone ? `Order: ${info.phone}` : ''}`.trim(),
    sms: `${where}: ${offerLine || productLine}${info.phone ? `. ${info.phone}` : ''}`.slice(0, 300),
    email_subject: `${offerLine ? offerLine.split(' — ')[0] : 'This week'} at ${info.shop || 'our shop'}`,
    email_body: `Hi {{customer_name}},\n\n${offerLine ? `${offerLine}.\n\n` : ''}${products.map((p) => `• ${p.name} — R${money(p.selling_price)}`).join('\n')}\n\n${where}${info.address ? `\n${info.address}` : ''}${info.phone ? `\n${info.phone}` : ''}`,
    social_caption: `${offerLine ? `${offerLine}! ` : ''}${productLine}${where ? ` 📍 ${where}` : ''}`.trim(),
    poster_text: `${promo ? promo.text.toUpperCase() : (products[0]?.name || '').toUpperCase()}\n${productLine}\n${where}`,
    video_script: `Scene 1: ${products[0]?.name || 'Hero product'} close-up.\nScene 2: ${offerLine || productLine}.\nScene 3: ${where}${info.phone ? ` — ${info.phone}` : ''}.`,
    product_copy: products.map((p) => `${p.name}${p.description ? ` — ${p.description}` : ''}. R${money(p.selling_price)}.`).join('\n')
  };
  let engine = 'template';
  const apiKey = process.env.SHOP_POS_AI_API_KEY || process.env.OPENAI_API_KEY;
  if (apiKey && spec.use_ai) {
    try {
      const prompt = `Rewrite these marketing texts to be friendly and concise. Keep EVERY product name, price, code and date exactly as given; do not add prices, products or claims. Keep {{customer_name}} placeholders. Return JSON with the same keys.\n${JSON.stringify(templates)}`;
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: process.env.SHOP_POS_AI_MODEL || 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }], response_format: { type: 'json_object' }, temperature: 0.4 })
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        const out = parseJson(json.choices?.[0]?.message?.content, {});
        const prices = products.map((p) => `R${money(p.selling_price)}`);
        const keepsPrices = (t) => prices.every((pr) => !templates.whatsapp.includes(pr) || String(t || '').includes(pr));
        for (const k of Object.keys(templates)) if (typeof out[k] === 'string' && out[k].trim() && keepsPrices(out[k])) templates[k] = out[k];
        engine = `openai:${process.env.SHOP_POS_AI_MODEL || 'gpt-4o-mini'}`;
      }
    } catch (_) { /* keep templates */ }
  }
  return { ok: true, engine, content: templates, sources: { products: products.map((p) => ({ id: p.id, name: p.name, price: num(p.selling_price) })), promotion: promo, shop: info }, missing };
}

module.exports = {
  CAMPAIGN_STATUSES, OBJECTIVES, PROMOTION_KINDS, ensureSchema, getSettings, saveSettings, channelStatus,
  dashboard, decisionCenter, customersView, customerDetail, segmentsView, productsView, patternsView, quietView,
  branchesView, loyaltyView, referralsView, datesView, previewAudience, resolveAudience,
  previewPromotion, createPromotion, listCampaigns, getCampaign, saveCampaign, submitCampaign, approveCampaign,
  rejectCampaign, launchCampaign, pauseCampaign, resumeCampaign, cancelCampaign, duplicateCampaign,
  financialPreview, attribution, campaignResults, campaignReport, abReport, addCampaignCost,
  saveBudget, deleteBudget, budgetStatus, createDateOffers, calendar, saveEvent, deleteEvent,
  listSuppressions, addSuppression, removeSuppression, aiAsk, decideRecommendation, listRecommendations,
  generateContent, listAudit, requirePerm, refreshStatuses,
  archiveCampaign, unarchiveCampaign, campaignHistory, CONTENT_KINDS, CONTENT_CHANNELS,
  listContent, saveContent, deleteContent, useContentInCampaign, sendContentToCommunication
};

/**
 * Marketing Center analytics — read-only analysis of existing sales, customers, products,
 * loyalty and referral data. Uses portable SQL (SQLite + Postgres) and computes in JS.
 * Every figure is derived from database rows; missing inputs are reported, never estimated silently.
 */
const { getDb } = require('../database/db');

const DAY = 86400000;
const INVALID_SALE_STATUSES = new Set(['voided', 'returned', 'cancelled', 'void', 'deleted']);

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const money = (v) => Math.round(num(v) * 100) / 100;
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

function all(sql, params = []) {
  try { return getDb().prepare(sql).all(...params) || []; } catch (_) { return null; }
}
function get(sql, params = []) {
  try { return getDb().prepare(sql).get(...params) || null; } catch (_) { return null; }
}

function sqlDate(ms) {
  return new Date(ms).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

/** Sale timestamps are stored as "YYYY-MM-DD HH:MM:SS" text; parse as wall-clock components. */
function parseStamp(v) {
  const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) {
    const d = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!d) return null;
    return { ms: Date.UTC(+d[1], +d[2] - 1, +d[3]), hour: null, dow: new Date(Date.UTC(+d[1], +d[2] - 1, +d[3])).getUTCDay(), day: `${d[1]}-${d[2]}-${d[3]}` };
  }
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  return { ms, hour: +m[4], dow: new Date(ms).getUTCDay(), day: `${m[1]}-${m[2]}-${m[3]}` };
}

function saleStamp(s) {
  return parseStamp(s.sale_datetime) || parseStamp(s.created_at);
}

function isValidSale(s) {
  return !INVALID_SALE_STATUSES.has(String(s.status || 'completed').toLowerCase());
}

function saleChannel(s) {
  const src = String(s.order_source || '').toLowerCase();
  if (src.includes('online') || src.includes('web')) return 'online';
  if (src.includes('kiosk')) return 'kiosk';
  return 'pos';
}

function isDelivery(s) {
  return String(s.order_type || '').toLowerCase() === 'delivery' || num(s.delivery_fee) > 0;
}

function netRevenue(s) {
  return money(num(s.total) - num(s.delivery_fee));
}

function productCost(p) {
  if (!p) return null;
  const recipe = num(p.recipe_cost);
  if (Number(p.has_recipe) === 1 && recipe > 0) return recipe;
  const buy = num(p.buying_price);
  if (buy > 0) return buy;
  if (recipe > 0) return recipe;
  return null;
}

/** Same rule as the POS stock deduction: recipe items not made to stock have no shelf stock. */
function isMadeToOrder(p) {
  return Number(p?.has_recipe) === 1 && String(p?.production_mode || '') !== 'make_to_stock';
}

function maskPhone(v) {
  const d = String(v || '').replace(/\D/g, '');
  if (!d) return '';
  return d.length > 4 ? `${'*'.repeat(d.length - 4)}${d.slice(-4)}` : '****';
}

let _cache = null;
const CACHE_MS = 60000;

function invalidate() { _cache = null; }

/**
 * Load the analysis window. `days` bounds history; `branchId` restricts sales to one branch.
 */
function loadData(opts = {}) {
  const days = Math.min(730, Math.max(14, Math.floor(num(opts.days) || 180)));
  const branchId = opts.branchId != null && opts.branchId !== '' && opts.branchId !== 'all' ? Number(opts.branchId) : null;
  const key = `${days}:${branchId || 'all'}`;
  if (!opts.fresh && _cache && _cache.key === key && Date.now() - _cache.at < CACHE_MS) return _cache.data;

  const nowMs = Date.now();
  const since = sqlDate(nowMs - days * DAY);
  const rawSales = all('SELECT * FROM sales WHERE created_at >= ? ORDER BY id', [since]) || [];
  const sales = rawSales.filter(isValidSale)
    .filter((s) => branchId == null || Number(s.branch_id || 1) === branchId)
    .map((s) => ({ ...s, _t: saleStamp(s) }))
    .filter((s) => s._t);
  const saleIds = new Set(sales.map((s) => Number(s.id)));
  const items = (all(`SELECT si.* FROM sale_items si WHERE si.sale_id IN (SELECT id FROM sales WHERE created_at >= ?)`, [since]) || [])
    .filter((i) => saleIds.has(Number(i.sale_id)));
  const itemsBySale = new Map();
  for (const i of items) {
    const k = Number(i.sale_id);
    if (!itemsBySale.has(k)) itemsBySale.set(k, []);
    itemsBySale.get(k).push(i);
  }
  const customers = all('SELECT * FROM customers') || [];
  const products = (all('SELECT * FROM products') || []).filter((p) => Number(p.is_archived || 0) !== 1);
  const branches = all('SELECT id, name FROM branches ORDER BY id') || [];
  let branchStock = null;
  if (branchId != null) {
    const rows = all('SELECT product_id, quantity FROM branch_stock WHERE branch_id = ?', [branchId]);
    if (rows && rows.length) {
      branchStock = new Map(rows.map((r) => [Number(r.product_id), num(r.quantity)]));
    }
  }
  const data = {
    days, branchId, since, nowMs, sales, items, itemsBySale, customers, products, branches, branchStock,
    productById: new Map(products.map((p) => [Number(p.id), p])),
    customerById: new Map(customers.map((c) => [Number(c.id), c]))
  };
  _cache = { key, at: Date.now(), data };
  return data;
}

/* ─────────────────────────── Customers ─────────────────────────── */

function customerProfiles(data) {
  const map = new Map();
  const sorted = [...data.sales].sort((a, b) => a._t.ms - b._t.ms);
  for (const s of sorted) {
    const cid = Number(s.customer_id);
    if (!cid) continue;
    let p = map.get(cid);
    if (!p) {
      const c = data.customerById.get(cid) || {};
      p = {
        id: cid, name: c.name || `Customer #${cid}`, phone_masked: maskPhone(c.phone), has_phone: !!c.phone, has_email: !!c.email,
        orders: 0, spend: 0, first_ms: s._t.ms, last_ms: s._t.ms, stamps: [], products: new Map(),
        branches: new Map(), channels: new Map(), delivery_orders: 0, referral_orders: 0,
        loyalty_points: num(c.loyalty_points), birthday: c.birthday || null, anniversary_date: c.anniversary_date || null
      };
      map.set(cid, p);
    }
    p.orders += 1;
    p.spend = money(p.spend + netRevenue(s));
    p.last_ms = s._t.ms;
    p.stamps.push(s._t.ms);
    const b = Number(s.branch_id || 1);
    p.branches.set(b, (p.branches.get(b) || 0) + 1);
    const ch = saleChannel(s);
    p.channels.set(ch, (p.channels.get(ch) || 0) + 1);
    if (isDelivery(s)) p.delivery_orders += 1;
    if (s.referral_code || s.referral_agent_id) p.referral_orders += 1;
    for (const it of data.itemsBySale.get(Number(s.id)) || []) {
      const pid = Number(it.product_id) || 0;
      const k = pid || `n:${it.product_name}`;
      const cur = p.products.get(k) || { product_id: pid || null, name: it.product_name, qty: 0, orders: 0 };
      cur.qty += num(it.quantity) || 1;
      cur.orders += 1;
      p.products.set(k, cur);
    }
  }
  const out = [];
  for (const p of map.values()) {
    const intervals = [];
    for (let i = 1; i < p.stamps.length; i++) intervals.push((p.stamps[i] - p.stamps[i - 1]) / DAY);
    const avgInterval = intervals.length ? intervals.reduce((a, b) => a + b, 0) / intervals.length : null;
    const top = [...p.products.values()].sort((a, b) => b.orders - a.orders || b.qty - a.qty).slice(0, 3);
    const topBranch = [...p.branches.entries()].sort((a, b) => b[1] - a[1])[0];
    const topChannel = [...p.channels.entries()].sort((a, b) => b[1] - a[1])[0];
    out.push({
      id: p.id, name: p.name, phone_masked: p.phone_masked, has_phone: p.has_phone, has_email: p.has_email,
      orders: p.orders, spend: p.spend, aov: money(p.spend / p.orders),
      first_purchase: sqlDate(p.first_ms).slice(0, 10), last_purchase: sqlDate(p.last_ms).slice(0, 10),
      days_since_last: Math.floor((data.nowMs - p.last_ms) / DAY),
      avg_interval_days: avgInterval != null ? Math.round(avgInterval * 10) / 10 : null,
      top_products: top.map((t) => ({ product_id: t.product_id, name: t.name, orders: t.orders, qty: t.qty })),
      preferred_branch_id: topBranch ? topBranch[0] : null,
      preferred_channel: topChannel ? topChannel[0] : null,
      delivery_orders: p.delivery_orders, referral_orders: p.referral_orders,
      loyalty_points: p.loyalty_points, birthday: p.birthday, anniversary_date: p.anniversary_date,
      _stamps: p.stamps, _first_ms: p.first_ms, _last_ms: p.last_ms
    });
  }
  return out;
}

function publicProfile(p) {
  if (!p) return p;
  const { _stamps, _first_ms, _last_ms, ...rest } = p;
  return rest;
}

function referralCustomerIds() {
  const ids = new Set();
  for (const r of all('SELECT customer_id FROM referral_customer_attributions WHERE customer_id IS NOT NULL') || []) ids.add(Number(r.customer_id));
  for (const r of all("SELECT customer_id FROM web_customers WHERE customer_id IS NOT NULL AND referred_by_code IS NOT NULL AND referred_by_code <> ''") || []) ids.add(Number(r.customer_id));
  return ids;
}

const SEGMENTS = [
  { key: 'new', label: 'New customers' },
  { key: 'returning', label: 'Returning customers' },
  { key: 'inactive', label: 'Inactive customers' },
  { key: 'high_value', label: 'High-value customers' },
  { key: 'loyalty', label: 'Loyalty members' },
  { key: 'referral', label: 'Referral customers' },
  { key: 'online', label: 'Online customers' },
  { key: 'pos', label: 'POS customers' },
  { key: 'delivery', label: 'Delivery customers' },
  { key: 'product', label: 'Buyers of a product' },
  { key: 'branch', label: 'Customers of a branch' },
  { key: 'spend_band', label: 'Spending band' },
  { key: 'frequency_band', label: 'Order frequency band' },
  { key: 'declining', label: 'Declining activity' },
  { key: 'overdue', label: 'Overdue for usual purchase' }
];

function highValueThreshold(profiles, topPct) {
  if (!profiles.length) return null;
  const spends = profiles.map((p) => p.spend).sort((a, b) => b - a);
  const n = Math.max(1, Math.ceil(spends.length * (Math.min(50, Math.max(1, topPct)) / 100)));
  return spends[n - 1];
}

function declining(p, nowMs) {
  const recentFrom = nowMs - 30 * DAY;
  const priorFrom = nowMs - 120 * DAY;
  const recent = p._stamps.filter((t) => t >= recentFrom).length;
  const prior = p._stamps.filter((t) => t >= priorFrom && t < recentFrom).length;
  if (prior < 3) return null;
  const priorMonthly = prior / 3;
  if (recent >= priorMonthly * 0.5) return null;
  return { prior_monthly: Math.round(priorMonthly * 10) / 10, recent_30d: recent };
}

function overdue(p) {
  if (p.orders < 3 || !p.avg_interval_days || p.avg_interval_days <= 0) return null;
  if (p.days_since_last <= p.avg_interval_days * 1.5) return null;
  return { usual_interval_days: p.avg_interval_days, days_since_last: p.days_since_last };
}

function segmentMembers(data, profiles, segment, params = {}, settings = {}) {
  const nowMs = data.nowMs;
  const newDays = num(params.days || settings.new_customer_days) || 30;
  const inactiveDays = num(params.days || settings.inactivity_days) || 30;
  switch (segment) {
    case 'new': return profiles.filter((p) => p._first_ms >= nowMs - newDays * DAY);
    case 'returning': return profiles.filter((p) => p.orders >= 2);
    case 'inactive': return profiles.filter((p) => p.days_since_last >= inactiveDays);
    case 'high_value': {
      const t = highValueThreshold(profiles, num(params.top_pct || settings.high_value_top_pct) || 10);
      return t == null ? [] : profiles.filter((p) => p.spend >= t && p.spend > 0);
    }
    case 'loyalty': {
      const ids = new Set(data.customers.filter((c) => num(c.loyalty_points) > 0).map((c) => Number(c.id)));
      for (const r of all("SELECT DISTINCT customer_id FROM loyalty_transactions WHERE created_at >= ?", [data.since]) || []) ids.add(Number(r.customer_id));
      return profiles.filter((p) => ids.has(p.id));
    }
    case 'referral': {
      const ids = referralCustomerIds();
      return profiles.filter((p) => p.referral_orders > 0 || ids.has(p.id));
    }
    case 'online': return profiles.filter((p) => p.preferred_channel === 'online');
    case 'pos': return profiles.filter((p) => p.preferred_channel === 'pos');
    case 'delivery': return profiles.filter((p) => p.delivery_orders > 0);
    case 'product': {
      const pid = Number(params.product_id);
      if (!pid) return [];
      const buyers = new Set();
      for (const s of data.sales) {
        if (!s.customer_id) continue;
        if ((data.itemsBySale.get(Number(s.id)) || []).some((i) => Number(i.product_id) === pid)) buyers.add(Number(s.customer_id));
      }
      return profiles.filter((p) => buyers.has(p.id));
    }
    case 'branch': return profiles.filter((p) => Number(p.preferred_branch_id) === Number(params.branch_id));
    case 'spend_band': {
      const min = num(params.min);
      const max = params.max != null && params.max !== '' ? num(params.max) : Infinity;
      return profiles.filter((p) => p.spend >= min && p.spend <= max);
    }
    case 'frequency_band': {
      const min = num(params.min) || 1;
      const max = params.max != null && params.max !== '' ? num(params.max) : Infinity;
      return profiles.filter((p) => p.orders >= min && p.orders <= max);
    }
    case 'declining': return profiles.filter((p) => declining(p, nowMs));
    case 'overdue': return profiles.filter((p) => overdue(p));
    default: return [];
  }
}

function segmentSummary(data, settings) {
  const profiles = customerProfiles(data);
  return SEGMENTS.filter((s) => !['product', 'branch', 'spend_band', 'frequency_band'].includes(s.key)).map((s) => {
    const members = segmentMembers(data, profiles, s.key, {}, settings);
    return {
      key: s.key, label: s.label, count: members.length,
      spend: money(members.reduce((a, p) => a + p.spend, 0)),
      share_pct: pct(members.length, profiles.length)
    };
  });
}

function customerLifetime(p) {
  const spanDays = (p._last_ms - p._first_ms) / DAY;
  if (p.orders < 3 || spanDays < 30) {
    return { total_spend: p.spend, orders: p.orders, aov: p.aov, estimate: null, note: 'Insufficient data — needs at least 3 orders over 30+ days' };
  }
  const monthly = p.orders / (spanDays / 30);
  return {
    total_spend: p.spend, orders: p.orders, aov: p.aov,
    orders_per_month: Math.round(monthly * 100) / 100,
    estimate: money(p.aov * monthly * 12),
    note: 'ESTIMATE: 12-month value if the observed order frequency and average order value continue'
  };
}

/* ─────────────────────────── Products ─────────────────────────── */

function productPerformance(data, settings = {}) {
  const now = data.nowMs;
  const recentFrom = now - 28 * DAY;
  const stats = new Map();
  const touch = (pid) => {
    if (!stats.has(pid)) stats.set(pid, { units: 0, units_28d: 0, revenue: 0, orders: 0, cost_recorded: 0, cost_units: 0 });
    return stats.get(pid);
  };
  const saleById = new Map(data.sales.map((s) => [Number(s.id), s]));
  for (const it of data.items) {
    const pid = Number(it.product_id);
    if (!pid) continue;
    const s = saleById.get(Number(it.sale_id));
    if (!s) continue;
    const st = touch(pid);
    const q = num(it.quantity) || 1;
    st.units += q;
    st.revenue += num(it.total);
    st.orders += 1;
    if (s._t.ms >= recentFrom) st.units_28d += q;
    if (num(it.buying_price) > 0) { st.cost_recorded += num(it.buying_price) * q; st.cost_units += q; }
  }
  const weeks = Math.max(1, data.days / 7);
  const out = [];
  for (const p of data.products) {
    if (Number(p.is_active ?? 1) === 0) continue;
    const pid = Number(p.id);
    const st = stats.get(pid) || { units: 0, units_28d: 0, revenue: 0, orders: 0 };
    const cost = productCost(p);
    const price = num(p.selling_price);
    const stock = data.branchStock ? (data.branchStock.has(pid) ? data.branchStock.get(pid) : null) : num(p.stock_quantity);
    const weekly = st.units / weeks;
    const weekly28 = st.units_28d / 4;
    const margin = cost != null && price > 0 ? Math.round(((price - cost) / price) * 1000) / 10 : null;
    out.push({
      product_id: pid, name: p.name, price, cost, cost_missing: cost == null, margin_pct: margin,
      stock, units_sold: Math.round(st.units * 100) / 100, units_28d: Math.round(st.units_28d * 100) / 100,
      weekly_units: Math.round(weekly * 100) / 100, weekly_units_28d: Math.round(weekly28 * 100) / 100,
      revenue: money(st.revenue), orders: st.orders,
      weeks_of_cover: stock != null && weekly28 > 0 ? Math.round((stock / weekly28) * 10) / 10 : null,
      production_mode: p.production_mode || null, item_type: p.item_type || null,
      made_to_order: isMadeToOrder(p)
    });
  }
  const slowWeekly = num(settings.slow_weekly_units) || 2;
  const overWeeks = num(settings.overstock_weeks) || 6;
  const hi = num(settings.high_margin_pct) || 60;
  const lo = num(settings.low_margin_pct) || 25;
  const tracked = (p) => p.stock != null && !p.made_to_order;
  return {
    all: out,
    best_sellers: [...out].filter((p) => p.units_sold > 0).sort((a, b) => b.units_sold - a.units_sold).slice(0, 15),
    slow_moving: out.filter((p) => tracked(p) && p.stock > 0 && p.weekly_units_28d < slowWeekly)
      .sort((a, b) => (b.stock || 0) - (a.stock || 0)).slice(0, 30),
    overstock: out.filter((p) => tracked(p) && p.stock > 0 && p.weekly_units_28d > 0 && p.weeks_of_cover != null && p.weeks_of_cover > overWeeks)
      .sort((a, b) => b.weeks_of_cover - a.weeks_of_cover).slice(0, 30),
    high_margin: out.filter((p) => p.margin_pct != null && p.margin_pct >= hi).sort((a, b) => b.margin_pct - a.margin_pct).slice(0, 30),
    low_margin: out.filter((p) => p.margin_pct != null && p.margin_pct < lo).sort((a, b) => a.margin_pct - b.margin_pct).slice(0, 30),
    missing_cost: out.filter((p) => p.cost_missing).map((p) => ({ product_id: p.product_id, name: p.name })),
    thresholds: { slow_weekly_units: slowWeekly, overstock_weeks: overWeeks, high_margin_pct: hi, low_margin_pct: lo },
    note: data.branchStock == null && data.branchId != null ? 'No branch stock records for this branch — stock figures unavailable.' : null
  };
}

/* ─────────────────────────── Basket patterns ─────────────────────────── */

function crossSell(data, settings = {}) {
  const minSupport = Math.max(2, num(settings.min_pair_support) || 3);
  const countA = new Map();
  const pair = new Map();
  const names = new Map();
  for (const s of data.sales) {
    const pids = [...new Set((data.itemsBySale.get(Number(s.id)) || []).map((i) => {
      const pid = Number(i.product_id);
      if (pid) names.set(pid, i.product_name);
      return pid;
    }).filter(Boolean))];
    for (const a of pids) countA.set(a, (countA.get(a) || 0) + 1);
    for (let i = 0; i < pids.length; i++) {
      for (let j = 0; j < pids.length; j++) {
        if (i === j) continue;
        const k = `${pids[i]}>${pids[j]}`;
        pair.set(k, (pair.get(k) || 0) + 1);
      }
    }
  }
  const out = [];
  for (const [k, together] of pair) {
    if (together < minSupport) continue;
    const [a, b] = k.split('>').map(Number);
    const base = countA.get(a) || 0;
    out.push({
      product_a_id: a, product_a: data.productById.get(a)?.name || names.get(a),
      product_b_id: b, product_b: data.productById.get(b)?.name || names.get(b),
      orders_with_a: base, orders_with_both: together, pct_of_a_orders: pct(together, base)
    });
  }
  return {
    min_support: minSupport,
    pairs: out.sort((x, y) => y.orders_with_both - x.orders_with_both || (y.pct_of_a_orders || 0) - (x.pct_of_a_orders || 0)).slice(0, 40)
  };
}

function upsell(data, settings = {}) {
  const minSupport = Math.max(2, num(settings.min_pair_support) || 3);
  const buyers = new Map();
  for (const s of data.sales) {
    const cid = Number(s.customer_id);
    if (!cid) continue;
    for (const i of data.itemsBySale.get(Number(s.id)) || []) {
      const pid = Number(i.product_id);
      if (!pid) continue;
      if (!buyers.has(pid)) buyers.set(pid, new Set());
      buyers.get(pid).add(cid);
    }
  }
  const out = [];
  const pids = [...buyers.keys()];
  for (const a of pids) {
    const pa = data.productById.get(a);
    if (!pa) continue;
    for (const b of pids) {
      if (a === b) continue;
      const pb = data.productById.get(b);
      if (!pb || num(pb.selling_price) <= num(pa.selling_price)) continue;
      if (pa.category_id != null && pb.category_id != null && Number(pa.category_id) !== Number(pb.category_id)) continue;
      const setA = buyers.get(a);
      let both = 0;
      for (const c of buyers.get(b)) if (setA.has(c)) both += 1;
      if (both < minSupport) continue;
      out.push({
        from_product_id: a, from_product: pa.name, from_price: num(pa.selling_price),
        to_product_id: b, to_product: pb.name, to_price: num(pb.selling_price),
        customers_buying_from: setA.size, customers_buying_both: both, pct: pct(both, setA.size),
        price_step: money(num(pb.selling_price) - num(pa.selling_price))
      });
    }
  }
  return { min_support: minSupport, suggestions: out.sort((x, y) => y.customers_buying_both - x.customers_buying_both).slice(0, 30) };
}

/* ─────────────────────────── Time analysis ─────────────────────────── */

function quietPeriods(data, settings = {}) {
  const offset = Math.round(num(settings.hour_offset));
  const threshold = num(settings.quiet_threshold_pct) || 25;
  const byHour = new Map();
  const byDow = new Map();
  const days = new Set();
  const byMonth = new Map();
  for (const s of data.sales) {
    if (s._t.hour == null) continue;
    const h = ((s._t.hour + offset) % 24 + 24) % 24;
    const rev = netRevenue(s);
    days.add(s._t.day);
    const hv = byHour.get(h) || { revenue: 0, orders: 0 };
    hv.revenue += rev; hv.orders += 1; byHour.set(h, hv);
    const dv = byDow.get(s._t.dow) || { revenue: 0, orders: 0, days: new Set() };
    dv.revenue += rev; dv.orders += 1; dv.days.add(s._t.day); byDow.set(s._t.dow, dv);
    const m = s._t.day.slice(0, 7);
    const mv = byMonth.get(m) || { revenue: 0, orders: 0 };
    mv.revenue += rev; mv.orders += 1; byMonth.set(m, mv);
  }
  const dayCount = days.size;
  if (dayCount < 7) {
    return { insufficient: true, message: `Insufficient data — only ${dayCount} trading day(s) in the window; at least 7 are needed.`, trading_days: dayCount };
  }
  const hours = [...byHour.entries()].sort((a, b) => a[0] - b[0]).map(([h, v]) => ({
    hour: h, label: `${String(h).padStart(2, '0')}:00–${String((h + 1) % 24).padStart(2, '0')}:00`,
    avg_revenue_per_day: money(v.revenue / dayCount), orders: v.orders
  }));
  const trading = hours.filter((h) => h.orders >= Math.max(3, dayCount * 0.1));
  const mean = trading.length ? trading.reduce((a, h) => a + h.avg_revenue_per_day, 0) / trading.length : 0;
  const quiet = [];
  let run = null;
  for (const h of trading) {
    const below = mean > 0 ? ((mean - h.avg_revenue_per_day) / mean) * 100 : 0;
    if (below >= threshold) {
      if (run && run.end === h.hour) { run.end = h.hour + 1; run.hours.push(h); } else {
        if (run) quiet.push(run);
        run = { start: h.hour, end: h.hour + 1, hours: [h] };
      }
    } else if (run) { quiet.push(run); run = null; }
  }
  if (run) quiet.push(run);
  const dowNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dows = [...byDow.entries()].sort((a, b) => a[0] - b[0]).map(([d, v]) => ({
    dow: d, day: dowNames[d], trading_days: v.days.size, avg_revenue_per_trading_day: money(v.revenue / Math.max(1, v.days.size)), orders: v.orders
  }));
  const dowMean = dows.length ? dows.reduce((a, d) => a + d.avg_revenue_per_trading_day, 0) / dows.length : 0;
  return {
    insufficient: false, trading_days: dayCount, threshold_pct: threshold, hour_offset: offset,
    hourly_mean: money(mean), hours, days_of_week: dows,
    months: [...byMonth.entries()].sort().map(([m, v]) => ({ month: m, revenue: money(v.revenue), orders: v.orders })),
    quiet_periods: quiet.map((q) => {
      const avg = q.hours.reduce((a, h) => a + h.avg_revenue_per_day, 0) / q.hours.length;
      return {
        start_hour: q.start, end_hour: q.end % 24,
        label: `${String(q.start).padStart(2, '0')}:00–${String(q.end % 24).padStart(2, '0')}:00`,
        avg_revenue_per_hour: money(avg), pct_below_mean: Math.round(((mean - avg) / mean) * 1000) / 10
      };
    }),
    quiet_days: dows.filter((d) => dowMean > 0 && ((dowMean - d.avg_revenue_per_trading_day) / dowMean) * 100 >= threshold)
      .map((d) => ({ ...d, pct_below_mean: Math.round(((dowMean - d.avg_revenue_per_trading_day) / dowMean) * 1000) / 10 })),
    note: 'Hours are taken from the recorded sale time. Adjust "hour offset" in Marketing Settings if recorded times are not local shop time.'
  };
}

function branchComparison(data) {
  const byBranch = new Map();
  const custs = new Map();
  for (const s of data.sales) {
    const b = Number(s.branch_id || 1);
    const v = byBranch.get(b) || { revenue: 0, orders: 0, discount: 0, delivery_orders: 0, online_orders: 0 };
    v.revenue += netRevenue(s); v.orders += 1; v.discount += num(s.discount);
    if (isDelivery(s)) v.delivery_orders += 1;
    if (saleChannel(s) === 'online') v.online_orders += 1;
    byBranch.set(b, v);
    if (s.customer_id) {
      if (!custs.has(b)) custs.set(b, new Set());
      custs.get(b).add(Number(s.customer_id));
    }
  }
  const names = new Map(data.branches.map((b) => [Number(b.id), b.name]));
  return [...byBranch.entries()].map(([b, v]) => ({
    branch_id: b, branch: names.get(b) || `Branch ${b}`, revenue: money(v.revenue), orders: v.orders,
    aov: money(v.revenue / Math.max(1, v.orders)), discount: money(v.discount),
    identified_customers: custs.get(b)?.size || 0, delivery_orders: v.delivery_orders, online_orders: v.online_orders
  })).sort((a, b) => b.revenue - a.revenue);
}

/* ─────────────────────────── Loyalty & referrals ─────────────────────────── */

function loyaltySummary(data, settings = {}) {
  const earned = get("SELECT COALESCE(SUM(points),0) AS p, COUNT(*) AS n FROM loyalty_transactions WHERE type = 'earn' AND created_at >= ?", [data.since]);
  const redeemed = get("SELECT COALESCE(SUM(points),0) AS p, COUNT(*) AS n FROM loyalty_transactions WHERE type = 'redeem' AND created_at >= ?", [data.since]);
  const members = data.customers.filter((c) => num(c.loyalty_points) > 0);
  let loyaltySettings = {};
  try { loyaltySettings = require('./loyalty-points').getExtendedLoyaltySettings(); } catch (_) { /* optional */ }
  const soon = new Date(data.nowMs + 14 * DAY).toISOString();
  const expiring = all(`SELECT customer_id, SUM(points_remaining) AS pts, MIN(expires_at) AS first_expiry
    FROM loyalty_point_lots WHERE points_remaining > 0 AND expires_at >= ? AND expires_at <= ? GROUP BY customer_id`,
  [new Date(data.nowMs).toISOString(), soon]) || [];
  const target = num(settings.reward_points_target);
  const window = num(settings.near_reward_points) || 20;
  const approaching = target > 0
    ? data.customers.filter((c) => { const pts = num(c.loyalty_points); return pts < target && pts >= target - window; })
      .map((c) => ({ id: Number(c.id), name: c.name, points: num(c.loyalty_points), points_to_target: money(target - num(c.loyalty_points)) }))
    : null;
  return {
    enabled: loyaltySettings.enabled !== false,
    rules: loyaltySettings.spend_amount ? {
      spend_amount: loyaltySettings.spend_amount, points_earned: loyaltySettings.points_earned,
      point_value: loyaltySettings.point_value, expiry_enabled: loyaltySettings.expiry_enabled,
      expiry: `${loyaltySettings.expiry_period_value} ${loyaltySettings.expiry_period_unit}`,
      note: 'Existing loyalty rules are authoritative. Delivery fees do not earn points; void/refund/redemption/expiry rules are enforced by the loyalty engine.'
    } : null,
    members: members.length,
    points_outstanding: Math.round(members.reduce((a, c) => a + num(c.loyalty_points), 0)),
    points_outstanding_value: money(members.reduce((a, c) => a + num(c.loyalty_points), 0) * (num(loyaltySettings.point_value) || 1)),
    earned_in_window: Math.round(num(earned?.p)), earn_transactions: num(earned?.n),
    redeemed_in_window: Math.round(Math.abs(num(redeemed?.p))), redeem_transactions: num(redeemed?.n),
    expiring_14d: expiring.map((r) => {
      const c = data.customerById.get(Number(r.customer_id)) || {};
      return { id: Number(r.customer_id), name: c.name || `Customer #${r.customer_id}`, points: Math.round(num(r.pts)), first_expiry: String(r.first_expiry || '').slice(0, 10) };
    }).sort((a, b) => b.points - a.points),
    approaching_reward: approaching,
    approaching_note: target > 0 ? null : 'Not configured — the loyalty engine has no reward threshold. Set "Reward points target" in Marketing Settings to track customers approaching a reward.'
  };
}

function referralSummary(data) {
  const agents = all("SELECT id, full_name, referral_code, status FROM referral_agents") || [];
  const codes = all('SELECT code, agent_id, usage_count, campaign_name, status FROM referral_codes') || [];
  const attributions = all('SELECT agent_id, COUNT(*) AS n FROM referral_customer_attributions GROUP BY agent_id') || [];
  const commissions = all('SELECT agent_id, COUNT(*) AS n, COALESCE(SUM(commission_amount),0) AS amt, COALESCE(SUM(qualifying_amount),0) AS sales FROM referral_commissions GROUP BY agent_id') || [];
  const salesByAgent = new Map();
  for (const s of data.sales) {
    const a = Number(s.referral_agent_id);
    if (!a) continue;
    const v = salesByAgent.get(a) || { orders: 0, revenue: 0, customers: new Set() };
    v.orders += 1; v.revenue += netRevenue(s);
    if (s.customer_id) v.customers.add(Number(s.customer_id));
    salesByAgent.set(a, v);
  }
  const attr = new Map(attributions.map((r) => [Number(r.agent_id), num(r.n)]));
  const comm = new Map(commissions.map((r) => [Number(r.agent_id), r]));
  const rows = agents.map((a) => {
    const s = salesByAgent.get(Number(a.id));
    const c = comm.get(Number(a.id));
    return {
      agent_id: Number(a.id), name: a.full_name, code: a.referral_code, status: a.status,
      referred_customers: attr.get(Number(a.id)) || 0,
      orders_in_window: s?.orders || 0, revenue_in_window: money(s?.revenue || 0), buying_customers: s?.customers.size || 0,
      commissions: num(c?.n), commission_amount: money(c?.amt), qualifying_sales: money(c?.sales)
    };
  }).sort((a, b) => b.orders_in_window - a.orders_in_window || b.referred_customers - a.referred_customers);
  const webReferred = get("SELECT COUNT(*) AS n FROM web_customers WHERE referred_by_code IS NOT NULL AND referred_by_code <> ''");
  return {
    agents: rows,
    codes: codes.map((c) => ({ code: c.code, agent_id: Number(c.agent_id), usage_count: num(c.usage_count), campaign_name: c.campaign_name, status: c.status })),
    online_signups_with_referral_code: num(webReferred?.n),
    note: rows.length ? null : 'No referral agents exist in the referral system.'
  };
}

/* ─────────────────────────── Birthdays / anniversaries ─────────────────────────── */

function upcomingDates(data, daysAhead = 14) {
  const today = new Date(data.nowMs);
  const out = [];
  const check = (c, field, kind) => {
    const m = String(c[field] || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return;
    for (let add = 0; add <= daysAhead; add++) {
      const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + add));
      if (d.getUTCMonth() + 1 === +m[2] && d.getUTCDate() === +m[3]) {
        out.push({
          customer_id: Number(c.id), name: c.name, kind, type: kind === 'anniversary' ? (c.anniversary_type || 'Anniversary') : 'Birthday',
          date: d.toISOString().slice(0, 10), in_days: add, has_phone: !!c.phone, has_email: !!c.email, phone_masked: maskPhone(c.phone)
        });
        break;
      }
    }
  };
  for (const c of data.customers) {
    check(c, 'birthday', 'birthday');
    check(c, 'anniversary_date', 'anniversary');
  }
  return out.sort((a, b) => a.in_days - b.in_days);
}

module.exports = {
  DAY, num, money, pct, sqlDate, parseStamp, saleStamp, isValidSale, saleChannel, isDelivery, netRevenue, productCost, maskPhone, isMadeToOrder,
  loadData, invalidate, customerProfiles, publicProfile, SEGMENTS, segmentMembers, segmentSummary, highValueThreshold,
  declining, overdue, customerLifetime, productPerformance, crossSell, upsell, quietPeriods, branchComparison,
  loyaltySummary, referralSummary, upcomingDates, referralCustomerIds
};

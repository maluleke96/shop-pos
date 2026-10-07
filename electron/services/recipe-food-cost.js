/**
 * Recipe food cost, profitability, variance and advisor — an analysis layer over the existing
 * Recipe & Production data. Recipes (product_recipe_items), ingredient costs (products.buying_price
 * per stock unit), product conversions, POS sales, production batches, waste logs and stock movements
 * remain the source of truth. This module only reads them, plus additive tables for cost history,
 * targets and the advisor log. Nothing here changes prices, recipes or stock.
 *
 * Sales use the same rules as the Financial Intelligence Center: business day =
 * date(COALESCE(sale_datetime, created_at), 'localtime') with the shared revenue-status filter.
 */
const { getDb, isPgMode } = require('../database/db');
const inventory = require('./inventory');

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const numOrNull = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const money = (v) => Math.round((num(v) + Number.EPSILON) * 100) / 100;
const round3 = (v) => Math.round((num(v) + Number.EPSILON) * 1000) / 1000;
const pct1 = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

function run(sql, params = []) { return getDb().prepare(sql).run(...params); }
function get(sql, params = []) { return getDb().prepare(sql).get(...params) || null; }
function all(sql, params = []) { return getDb().prepare(sql).all(...params) || []; }
function tryAll(sql, params = []) { try { return all(sql, params); } catch (_) { return null; } }
function tryRun(sql) {
  try { run(sql); return true; } catch (err) {
    if (!/already exists|duplicate column/i.test(String(err.message || err))) console.warn('[recipe-food-cost] schema:', String(err.message || err).slice(0, 160));
    return false;
  }
}
function nowSql() { return new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ''); }
function parseJson(v, fb) {
  if (v == null || v === '') return fb;
  try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return fb; }
}
function insertId(r, table) {
  const id = Number(r?.lastInsertRowid) || 0;
  if (id) return id;
  return Number(get(`SELECT MAX(id) AS id FROM ${table}`)?.id) || 0;
}
function normDay(v) {
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  const m = String(v || '').match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}
const _colCache = new Map();
function columnExists(table, col) {
  const k = `${table}.${col}`;
  if (_colCache.has(k)) return _colCache.get(k);
  let ok = false;
  try { getDb().prepare(`SELECT ${col} FROM ${table} WHERE 1=0`).all(); ok = true; } catch (_) { ok = false; }
  _colCache.set(k, ok);
  return ok;
}

const fin = () => require('./financial-intelligence');
const rp = () => require('./recipe-production');
const todayYmd = () => fin().todayYmd();
const resolveRange = (f) => fin().resolveRange(f || {});
function revenueStatusSql() {
  try { return require('./store').getSaleRevenueStatusesSql('s'); } catch (_) { return "s.status IN ('completed', 'partial_return')"; }
}
const SALE_DAY = "strftime('%Y-%m-%d', COALESCE(s.sale_datetime, s.created_at), 'localtime')";
const localDay = (col) => `strftime('%Y-%m-%d', ${col}, 'localtime')`;

/* ─────────────────────────── Schema (additive only) ─────────────────────────── */

let _schemaReady = false;
function ensureSchema() {
  if (_schemaReady) return;
  tryRun(`CREATE TABLE IF NOT EXISTS rfc_ingredient_cost_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    unit_cost REAL NOT NULL,
    stock_unit TEXT,
    source TEXT,
    note TEXT,
    observed_at TEXT,
    created_by INTEGER
  )`);
  tryRun('CREATE INDEX IF NOT EXISTS idx_rfc_ich_product ON rfc_ingredient_cost_history(product_id, id)');
  tryRun(`CREATE TABLE IF NOT EXISTS rfc_recipe_cost_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    snap_date TEXT NOT NULL,
    recipe_cost REAL,
    complete INTEGER DEFAULT 1,
    selling_price REAL,
    food_cost_pct REAL,
    lines_json TEXT,
    created_at TEXT,
    updated_at TEXT
  )`);
  tryRun('CREATE INDEX IF NOT EXISTS idx_rfc_rch_product ON rfc_recipe_cost_history(product_id, snap_date)');
  tryRun(`CREATE TABLE IF NOT EXISTS rfc_settings (
    id INTEGER PRIMARY KEY,
    settings_json TEXT,
    updated_by INTEGER,
    updated_at TEXT
  )`);
  tryRun(`CREATE TABLE IF NOT EXISTS rfc_product_targets (
    product_id INTEGER PRIMARY KEY,
    food_cost_target_pct REAL,
    contribution_target REAL,
    daily_qty_target REAL,
    monthly_qty_target REAL,
    updated_by INTEGER,
    updated_at TEXT
  )`);
  tryRun(`CREATE TABLE IF NOT EXISTS rfc_ai_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question TEXT,
    product_id INTEGER,
    engine TEXT,
    facts_json TEXT,
    analysis_json TEXT,
    recommendations_json TEXT,
    insufficient_json TEXT,
    created_by INTEGER,
    created_at TEXT
  )`);
  _schemaReady = true;
}

/* ─────────────────────────── Access ─────────────────────────── */

function sessionUser() {
  const session = require('./session');
  const u = session.getUserSession?.();
  if (!u?.id) throw new Error('Authentication required');
  return u;
}

/** Cost figures: recipe roles with costing, or full (not "limited") reports. */
function requireCostAccess(actor) {
  const user = rp().canAccessRecipeModule(actor || sessionUser());
  const m = rp().ROLE_PERMS[user.recipe_role] || {};
  if (user.recipe_role === 'administrator' || m.costing === true || m.reports === true) return user;
  throw new Error(`Recipe role "${user.recipe_role}" cannot view food cost and profitability figures`);
}
function canSeeCosts(user) {
  const m = rp().ROLE_PERMS[user?.recipe_role] || {};
  return user?.recipe_role === 'administrator' || m.costing === true || m.reports === true;
}
function requireProduceAccess(actor) {
  return rp().requireRecipePerm(actor || sessionUser(), 'produce');
}
function requireTargetsAccess(actor) {
  const user = rp().canAccessRecipeModule(actor || sessionUser());
  const m = rp().ROLE_PERMS[user.recipe_role] || {};
  if (user.recipe_role === 'administrator' || m.settings || m.prices) return user;
  throw new Error(`Recipe role "${user.recipe_role}" cannot change food cost targets`);
}

/** Branch-locked staff only ever see their own branch. */
function scopeBranch(user, branchId) {
  const want = branchId != null && branchId !== '' && branchId !== 'all' ? Number(branchId) : null;
  if (user?.role !== 'owner' && user?.recipe_role !== 'administrator' && user?.branch_id != null) return Number(user.branch_id);
  return Number.isFinite(want) ? want : null;
}

function logActivity(user, action, entityType, entityId, details) {
  try {
    run(`INSERT INTO recipe_activity_log (user_id, user_name, action, entity_type, entity_id, old_value, new_value)
      VALUES (?,?,?,?,?,?,?)`, [user?.id || null, user?.full_name || user?.username || null, action, entityType, entityId || null, null, details ? JSON.stringify(details) : null]);
  } catch (_) { /* audit is best effort */ }
}

/* ─────────────────────────── Units ─────────────────────────── */

const UNIT_ALIAS = new Map();
[
  ['kg', ['kg', 'kgs', 'kilo', 'kilos', 'kilogram', 'kilograms']],
  ['g', ['g', 'gr', 'grs', 'gram', 'grams', 'gm', 'gms']],
  ['l', ['l', 'lt', 'ltr', 'ltrs', 'litre', 'litres', 'liter', 'liters']],
  ['ml', ['ml', 'mls', 'millilitre', 'millilitres', 'milliliter', 'milliliters']],
  ['each', ['each', 'ea', 'unit', 'units', 'piece', 'pieces', 'pc', 'pcs', 'item', 'items']],
  ['dozen', ['dozen', 'dz', 'doz', 'dozens']],
  ['pack', ['pack', 'packs', 'pk', 'pkt', 'pkts', 'packet', 'packets']],
  ['box', ['box', 'boxes']],
  ['crate', ['crates', 'crate']],
  ['bag', ['bag', 'bags']],
  ['bottle', ['bottle', 'bottles']],
  ['tin', ['tin', 'tins']],
  ['tray', ['tray', 'trays']],
  ['bunch', ['bunch', 'bunches']],
  ['roll', ['roll', 'rolls']],
  ['portion', ['portion', 'portions', 'serving', 'servings']]
].forEach(([canon, list]) => list.forEach((a) => UNIT_ALIAS.set(a, canon)));
const BASE_UNITS = { kg: ['mass', 1000], g: ['mass', 1], l: ['volume', 1000], ml: ['volume', 1] };

function normUnit(u) {
  const k = String(u || '').trim().toLowerCase().replace(/\.$/, '');
  return UNIT_ALIAS.get(k) || k;
}

/**
 * Convert between units. Mass and volume use exact metric factors; anything else needs a
 * conversion configured on the ingredient. Unknown paths are reported, never guessed.
 */
function convertUnits(productId, qty, from, to) {
  const f = normUnit(from);
  const t = normUnit(to);
  const q = num(qty);
  if (!f || !t) return { ok: false, qty: null, reason: 'Unit is missing' };
  if (f === t) return { ok: true, qty: q };
  if (f === 'dozen' && t === 'each') return { ok: true, qty: q * 12 };
  if (f === 'each' && t === 'dozen') return { ok: true, qty: q / 12 };
  if (BASE_UNITS[f] && BASE_UNITS[t]) {
    if (BASE_UNITS[f][0] === BASE_UNITS[t][0]) return { ok: true, qty: (q * BASE_UNITS[f][1]) / BASE_UNITS[t][1] };
    return { ok: false, qty: null, reason: `Cannot convert ${from} (${BASE_UNITS[f][0]}) to ${to} (${BASE_UNITS[t][0]})` };
  }
  const edges = [];
  for (const c of (productId ? inventory.getProductConversions(productId) : []) || []) {
    const fq = num(c.from_qty) || 1;
    const tq = num(c.to_qty);
    if (!(tq > 0)) continue;
    const a = normUnit(c.from_unit); const b = normUnit(c.to_unit);
    if (!a || !b || a === b) continue;
    edges.push([a, b, tq / fq], [b, a, fq / tq]);
  }
  for (const [a, [da, fa]] of Object.entries(BASE_UNITS)) {
    for (const [b, [db, fb]] of Object.entries(BASE_UNITS)) if (a !== b && da === db) edges.push([a, b, fa / fb]);
  }
  const seen = new Set([f]);
  const queue = [[f, 1]];
  while (queue.length) {
    const [u, factor] = queue.shift();
    if (u === t) return { ok: true, qty: q * factor };
    for (const [a, b, k] of edges) {
      if (a === u && !seen.has(b)) { seen.add(b); queue.push([b, factor * k]); }
    }
  }
  return { ok: false, qty: null, reason: `No conversion from "${from}" to "${to}" is configured for this ingredient` };
}

/* ─────────────────────────── Data context ─────────────────────────── */

/** One read of recipes, BOM lines and ingredients for a computation. */
function loadContext() {
  ensureSchema();
  try { inventory.ensureRecipeItemSchema(); } catch (_) { /* older schema */ }
  const hasMode = columnExists('products', 'production_mode');
  const products = all(`SELECT p.id, p.name, p.selling_price, ${hasMode ? 'p.production_mode' : 'NULL AS production_mode'}, c.name AS category
    FROM products p LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.id IN (SELECT DISTINCT product_id FROM product_recipe_items) AND COALESCE(p.is_active, 1) = 1
    ORDER BY p.name`);
  const profileModes = new Map((tryAll('SELECT product_id, production_mode FROM recipe_profiles WHERE product_id IS NOT NULL ORDER BY id') || [])
    .map((r) => [Number(r.product_id), r.production_mode]));
  const bomRows = all(`SELECT r.id, r.product_id, r.ingredient_product_id, r.quantity, r.unit, r.waste_pct,
      COALESCE(NULLIF(r.include_rule, ''), 'always') AS include_rule, r.option_name, r.sort_order
    FROM product_recipe_items r ORDER BY r.product_id, r.sort_order, r.id`);
  const bom = new Map();
  for (const r of bomRows) {
    const k = Number(r.product_id);
    if (!bom.has(k)) bom.set(k, []);
    bom.get(k).push(r);
  }
  const ingIds = [...new Set(bomRows.map((r) => Number(r.ingredient_product_id)).filter(Boolean))];
  const ings = new Map();
  if (ingIds.length) {
    for (const p of all(`SELECT id, name, buying_price, stock_unit, unit, stock_quantity, supplier_id, is_active FROM products WHERE id IN (${ingIds.map(() => '?').join(',')})`, ingIds)) {
      ings.set(Number(p.id), p);
    }
  }
  const prodMap = new Map(products.map((p) => [Number(p.id), {
    ...p, id: Number(p.id), selling_price: num(p.selling_price),
    production_mode: profileModes.get(Number(p.id)) || p.production_mode || 'make_to_order'
  }]));
  return { products: prodMap, bom, ings };
}

function stockUnitOf(ing) { return ing?.stock_unit || ing?.unit || 'each'; }

/**
 * Cost one BOM line: quantity × (1 + waste%) converted to the ingredient stock unit × unit cost.
 * opts.costOverride / opts.qtyOverride (Map by ingredient id) drive what-if simulations only.
 */
function costLine(item, ctx, opts = {}) {
  const ingId = Number(item.ingredient_product_id);
  const ing = ctx.ings.get(ingId);
  const qo = opts.qtyOverride?.get(ingId);
  const qty = qo ? num(qo.quantity) : num(item.quantity);
  const unit = qo ? (qo.unit || item.unit) : (item.unit || stockUnitOf(ing));
  const wastePct = num(item.waste_pct);
  const base = {
    line_id: item.id != null ? Number(item.id) : null,
    ingredient_product_id: ingId,
    name: ing?.name || `Ingredient #${ingId}`,
    quantity: round3(qty), unit, waste_pct: wastePct,
    include_rule: item.include_rule || 'always', option_name: item.option_name || null,
    optional: (item.include_rule || 'always') === 'when_selected'
  };
  if (!ing) return { ...base, stock_unit: null, qty_stock: null, unit_cost: null, line_cost: null, cost_ok: false, issue: 'Ingredient record not found' };
  const stockUnit = stockUnitOf(ing);
  const conv = convertUnits(ingId, qty * (1 + wastePct / 100), unit, stockUnit);
  const hasOverride = opts.costOverride?.has(ingId);
  const unitCost = hasOverride ? num(opts.costOverride.get(ingId)) : num(ing.buying_price);
  const out = { ...base, stock_unit: stockUnit, qty_stock: conv.ok ? round3(conv.qty) : null, unit_cost: unitCost, unit_cost_simulated: !!hasOverride };
  if (!conv.ok) return { ...out, line_cost: null, cost_ok: false, issue: `INSUFFICIENT DATA: ${conv.reason}` };
  if (!(unitCost > 0)) return { ...out, line_cost: null, cost_ok: false, issue: 'INSUFFICIENT DATA: no reliable purchase cost is recorded for this ingredient' };
  return { ...out, line_cost: conv.qty * unitCost, cost_ok: true, issue: null };
}

/** Cost card for one recipe product (base recipe = always + unless_selected lines). */
function costRecipe(ctx, productId, opts = {}) {
  const p = ctx.products.get(Number(productId));
  if (!p) return null;
  const lines = (ctx.bom.get(Number(productId)) || []).map((it) => costLine(it, ctx, opts));
  const baseLines = lines.filter((l) => !l.optional);
  const complete = baseLines.length > 0 && baseLines.every((l) => l.cost_ok);
  const knownCost = baseLines.reduce((a, l) => a + (l.cost_ok ? l.line_cost : 0), 0);
  const price = opts.price != null ? num(opts.price) : p.selling_price;
  const issues = [];
  if (!baseLines.length) issues.push('INSUFFICIENT DATA: the recipe has no base ingredient lines');
  for (const l of lines) if (l.issue) issues.push(`${l.name}: ${l.issue}`);
  if (!(price > 0)) issues.push('INSUFFICIENT DATA: the product has no selling price');
  const recipeCost = complete ? knownCost : null;
  const costliest = baseLines.filter((l) => l.cost_ok).sort((a, b) => b.line_cost - a.line_cost)[0] || null;
  return {
    product_id: p.id, name: p.name, category: p.category || null, production_mode: p.production_mode,
    selling_price: money(price), price_source: opts.price != null ? 'What-if price (simulation only)' : 'Product selling price (POS catalogue)',
    lines: lines.map((l) => ({ ...l, line_cost: l.line_cost == null ? null : round3(l.line_cost), share_pct: complete && l.cost_ok && !l.optional ? pct1(l.line_cost, knownCost) : null })),
    complete,
    recipe_cost: recipeCost == null ? null : money(recipeCost),
    known_cost: money(knownCost),
    recipe_cost_raw: recipeCost,
    food_cost_pct: complete && price > 0 ? Math.round((knownCost / price) * 1000) / 10 : null,
    gross_contribution: complete && price > 0 ? money(price - knownCost) : null,
    optional_lines: lines.filter((l) => l.optional).map((l) => ({ name: l.name, option_name: l.option_name, cost: l.line_cost == null ? null : money(l.line_cost), cost_ok: l.cost_ok })),
    costliest: costliest ? { ingredient_product_id: costliest.ingredient_product_id, name: costliest.name, cost: money(costliest.line_cost), share_pct: pct1(costliest.line_cost, knownCost) } : null,
    issues
  };
}

/* ─────────────────────────── Allocations (from FIC) ─────────────────────────── */

/**
 * Allocation percentages configured in the Financial Intelligence Center. Stock allocations are
 * left out (the recipe cost already represents ingredient cost) and owner/savings distributions
 * are not costs. Percentages apply to the selling price as FIC applies them to revenue.
 */
function allocationInfo(branchId) {
  let cats = [];
  try { cats = fin().listCategories(); } catch (_) { return { available: false, total_pct: 0, categories: [], note: 'Financial Intelligence allocation settings are not available.' }; }
  const applicable = cats.filter((c) => c.is_active && (c.branch_id == null || c.branch_id === branchId) && c.current_pct > 0 && !['stock', 'owner', 'savings'].includes(c.kind));
  const total = applicable.reduce((a, c) => a + num(c.current_pct), 0);
  return {
    available: true,
    configured: applicable.length > 0,
    total_pct: Math.round(total * 10000) / 10000,
    categories: applicable.map((c) => ({ id: c.id, name: c.name, kind: c.kind, pct: num(c.current_pct) })),
    note: applicable.length
      ? 'Configured in Financial Intelligence → Allocation. Stock allocations are excluded because the recipe cost already covers ingredients; owner and savings distributions are not costs.'
      : 'No cost allocations are configured in Financial Intelligence.'
  };
}

function withAllocations(card, alloc) {
  if (!card || !alloc?.configured || card.gross_contribution == null) return { ...card, allocated_costs: null, contribution_after_allocations: null };
  const allocated = card.selling_price * alloc.total_pct / 100;
  return {
    ...card,
    allocated_costs: money(allocated),
    allocation_lines: alloc.categories.map((c) => ({ name: c.name, pct: c.pct, amount: money(card.selling_price * c.pct / 100) })),
    contribution_after_allocations: money(card.selling_price - card.recipe_cost_raw - allocated)
  };
}

/* ─────────────────────────── Cost history ─────────────────────────── */

/** Latest `n` rows per key in one read (history tables only grow when something changes). */
function lastRowsBy(sql, key, n = 2, params = []) {
  const m = new Map();
  for (const r of all(sql, params)) {
    const k = Number(r[key]);
    if (!m.has(k)) m.set(k, []);
    if (m.get(k).length < n) m.get(k).push(r);
  }
  return m;
}
const lastIngredientCosts = () => lastRowsBy('SELECT product_id, unit_cost, observed_at, source FROM rfc_ingredient_cost_history ORDER BY product_id, id DESC', 'product_id');
const lastRecipeSnapshots = () => lastRowsBy('SELECT product_id, snap_date, recipe_cost, complete, lines_json FROM rfc_recipe_cost_history ORDER BY product_id, snap_date DESC, id DESC', 'product_id');

function latestObservations() {
  ensureSchema();
  const rows = all(`SELECT h.* FROM rfc_ingredient_cost_history h
    WHERE h.id IN (SELECT MAX(id) FROM rfc_ingredient_cost_history GROUP BY product_id)`);
  return new Map(rows.map((r) => [Number(r.product_id), r]));
}

/**
 * Record an observation whenever an ingredient's purchase cost differs from the last one seen.
 * Costs are captured from now on; earlier changes cannot be reconstructed and are not invented.
 */
function observeIngredientCosts(ctx, { source = 'detected', user = null, onlyIds = null, note = null } = {}) {
  const last = latestObservations();
  const changed = [];
  const ids = onlyIds ? onlyIds.map(Number) : [...ctx.ings.keys()];
  for (const id of ids) {
    const ing = ctx.ings.get(id) || get('SELECT id, name, buying_price, stock_unit, unit FROM products WHERE id = ?', [id]);
    if (!ing) continue;
    const cur = num(ing.buying_price);
    if (!(cur > 0)) continue;
    const prev = last.get(id);
    if (prev && Math.abs(num(prev.unit_cost) - cur) < 1e-9) continue;
    run('INSERT INTO rfc_ingredient_cost_history (product_id, unit_cost, stock_unit, source, note, observed_at, created_by) VALUES (?,?,?,?,?,?,?)',
      [id, cur, stockUnitOf(ing), prev ? source : 'baseline', note, nowSql(), user?.id || null]);
    if (prev) changed.push({ product_id: id, old: num(prev.unit_cost), new: cur });
  }
  return changed;
}

function snapshotLines(card) {
  return card.lines.map((l) => ({ i: l.ingredient_product_id, n: l.name, q: l.quantity, u: l.unit, w: l.waste_pct, r: l.include_rule, o: l.option_name, uc: l.unit_cost, c: l.line_cost, ok: l.cost_ok ? 1 : 0 }));
}

/**
 * One row per recipe per day on which its cost, price or lines changed. Only today's row is ever
 * updated; earlier rows are never rewritten, so past periods keep the cost that applied then.
 */
function upsertSnapshot(card, ymd = todayYmd(), preloaded) {
  if (!card) return null;
  const linesJson = JSON.stringify(snapshotLines(card));
  const cost = card.complete ? card.recipe_cost_raw : card.known_cost;
  const last = preloaded !== undefined ? preloaded
    : get('SELECT * FROM rfc_recipe_cost_history WHERE product_id = ? AND snap_date <= ? ORDER BY snap_date DESC, id DESC LIMIT 1', [card.product_id, ymd]);
  const same = last && Math.abs(num(last.recipe_cost) - num(cost)) < 0.00005 && Math.abs(num(last.selling_price) - card.selling_price) < 0.005
    && Number(last.complete) === (card.complete ? 1 : 0) && String(last.lines_json || '') === linesJson;
  if (same) return last.id;
  if (last && normDay(last.snap_date) === ymd) {
    run('UPDATE rfc_recipe_cost_history SET recipe_cost = ?, complete = ?, selling_price = ?, food_cost_pct = ?, lines_json = ?, updated_at = ? WHERE id = ?',
      [cost, card.complete ? 1 : 0, card.selling_price, card.food_cost_pct, linesJson, nowSql(), last.id]);
    return last.id;
  }
  const r = run('INSERT INTO rfc_recipe_cost_history (product_id, snap_date, recipe_cost, complete, selling_price, food_cost_pct, lines_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
    [card.product_id, ymd, cost, card.complete ? 1 : 0, card.selling_price, card.food_cost_pct, linesJson, nowSql(), nowSql()]);
  return insertId(r, 'rfc_recipe_cost_history');
}

let _lastRefreshAt = 0;
/** Capture cost observations and recipe snapshots (throttled unless forced). */
function refreshHistory(ctx, { force = false, user = null, productIds = null, source = 'detected' } = {}) {
  if (!force && Date.now() - _lastRefreshAt < 5 * 60 * 1000) return;
  try {
    observeIngredientCosts(ctx, { source, user });
    const ids = productIds || [...ctx.products.keys()];
    const today = todayYmd();
    const latest = lastRowsBy(`SELECT id, product_id, snap_date, recipe_cost, complete, selling_price, lines_json FROM rfc_recipe_cost_history
      WHERE snap_date <= ? ORDER BY product_id, snap_date DESC, id DESC`, 'product_id', 1, [today]);
    for (const id of ids) upsertSnapshot(costRecipe(ctx, id), today, (latest.get(Number(id)) || [])[0] || null);
    if (!productIds) _lastRefreshAt = Date.now();
  } catch (err) {
    console.warn('[recipe-food-cost] history refresh:', err.message);
  }
}

/** Called after an ingredient purchase cost is written (restock, ingredient edit). Never throws. */
function noteIngredientCostChange(productId, source, actor, previousCost) {
  try {
    const ctx = loadContext();
    const id = Number(productId);
    const prev = num(previousCost);
    if (prev > 0 && !get('SELECT id FROM rfc_ingredient_cost_history WHERE product_id = ? LIMIT 1', [id])) {
      const ing = ctx.ings.get(id) || get('SELECT stock_unit, unit FROM products WHERE id = ?', [id]);
      run('INSERT INTO rfc_ingredient_cost_history (product_id, unit_cost, stock_unit, source, note, observed_at, created_by) VALUES (?,?,?,?,?,?,?)',
        [id, prev, stockUnitOf(ing), 'baseline', 'Cost before the first recorded change', nowSql(), actor?.id || null]);
    }
    observeIngredientCosts(ctx, { source: source || 'detected', user: actor, onlyIds: [id] });
    const affected = [...ctx.bom.entries()].filter(([, lines]) => lines.some((l) => Number(l.ingredient_product_id) === id)).map(([pid]) => pid);
    for (const pid of affected) upsertSnapshot(costRecipe(ctx, pid));
  } catch (err) {
    console.warn('[recipe-food-cost] cost hook:', err.message);
  }
}

function loadSnapshots(productIds, toDay) {
  ensureSchema();
  if (!productIds.length) return new Map();
  const rows = all(`SELECT product_id, snap_date, recipe_cost, complete, selling_price, lines_json FROM rfc_recipe_cost_history
    WHERE product_id IN (${productIds.map(() => '?').join(',')}) AND snap_date <= ? ORDER BY product_id, snap_date, id`, [...productIds, toDay]);
  const m = new Map();
  for (const r of rows) {
    const k = Number(r.product_id);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push({ day: normDay(r.snap_date), complete: Number(r.complete) === 1, lines: parseJson(r.lines_json, []), cost: num(r.recipe_cost) });
  }
  return m;
}
function snapshotAt(list, day) {
  let found = null;
  for (const s of list || []) { if (s.day <= day) found = s; else break; }
  return found;
}

/** Cost of one sold plate for the selected options, from snapshot lines or current lines. */
function plateCost(lines, modsText, fromSnapshot) {
  const selected = inventory.selectedModifierNames(String(modsText || '').split(',').map((s) => ({ name: s.trim() })).filter((m) => m.name));
  let total = 0;
  let ok = true;
  let any = false;
  for (const l of lines) {
    const item = fromSnapshot ? { include_rule: l.r, option_name: l.o } : l;
    if (!inventory.recipeItemApplies(item, selected)) continue;
    any = true;
    const okLine = fromSnapshot ? Number(l.ok) === 1 : l.cost_ok;
    const c = fromSnapshot ? l.c : l.line_cost;
    if (!okLine || c == null) { ok = false; continue; }
    total += num(c);
  }
  return { ok: ok && any, cost: total };
}

/* ─────────────────────────── Sales & profitability ─────────────────────────── */

function salesRows(from, to, branchId) {
  const hasMods = columnExists('sale_items', 'modifiers_text');
  const hasCombo = columnExists('sale_items', 'combo_id');
  return all(`SELECT ${SALE_DAY} AS day, si.product_id AS product_id, ${hasMods ? 'COALESCE(si.modifiers_text, \'\')' : "''"} AS mods,
      SUM(si.quantity) AS qty, SUM(si.total) AS revenue
    FROM sale_items si JOIN sales s ON s.id = si.sale_id
    WHERE ${SALE_DAY} BETWEEN ? AND ? AND ${revenueStatusSql()}
      AND si.product_id IN (SELECT DISTINCT product_id FROM product_recipe_items)${hasCombo ? ' AND si.combo_id IS NULL' : ''}${branchId ? ' AND COALESCE(s.branch_id, 1) = ?' : ''}
    GROUP BY 1, 2, 3`, [from, to, ...(branchId ? [branchId] : [])])
    .map((r) => ({ day: normDay(r.day), product_id: Number(r.product_id), mods: r.mods || '', qty: num(r.qty), revenue: num(r.revenue) }));
}

/**
 * Per-recipe sales, recipe cost and contribution for a period. Each sale day is costed with the
 * recipe snapshot in effect that day; days before the first snapshot use the current cost and are
 * counted separately so the basis is always visible.
 */
function periodRecipeCosts(from, to, branchId, ctx = loadContext()) {
  const rows = salesRows(from, to, branchId);
  const ids = [...new Set(rows.map((r) => r.product_id))];
  const snaps = loadSnapshots(ids, to);
  const current = new Map(ids.map((id) => [id, costRecipe(ctx, id)]));
  const out = new Map();
  for (const r of rows) {
    if (!out.has(r.product_id)) {
      const card = current.get(r.product_id);
      out.set(r.product_id, { product_id: r.product_id, name: card?.name || `Product #${r.product_id}`, qty: 0, revenue: 0, recipe_cost: 0, qty_costed: 0, qty_historical: 0, qty_current_basis: 0, qty_uncosted: 0, revenue_costed: 0, by_day: new Map() });
    }
    const o = out.get(r.product_id);
    o.qty += r.qty; o.revenue += r.revenue;
    const d = o.by_day.get(r.day) || { day: r.day, qty: 0, revenue: 0, cost: 0 };
    d.qty += r.qty; d.revenue += r.revenue;
    const snap = snapshotAt(snaps.get(r.product_id), r.day);
    const card = current.get(r.product_id);
    const pc = snap ? plateCost(snap.lines, r.mods, true) : (card ? plateCost(card.lines, r.mods, false) : { ok: false });
    if (pc.ok) {
      o.recipe_cost += pc.cost * r.qty; o.qty_costed += r.qty; o.revenue_costed += r.revenue;
      d.cost += pc.cost * r.qty;
      if (snap) o.qty_historical += r.qty; else o.qty_current_basis += r.qty;
    } else o.qty_uncosted += r.qty;
    o.by_day.set(r.day, d);
  }
  for (const o of out.values()) {
    o.fully_costed = o.qty_uncosted === 0;
    o.contribution = o.fully_costed ? o.revenue - o.recipe_cost : null;
    o.food_cost_pct = o.fully_costed ? pct1(o.recipe_cost, o.revenue) : null;
    o.cost_basis = o.qty_uncosted > 0 ? 'INSUFFICIENT DATA for part of the quantity'
      : o.qty_current_basis > 0 && o.qty_historical > 0 ? 'Mixed: historical snapshots and current cost'
        : o.qty_current_basis > 0 ? 'Current recipe cost (no snapshot on or before the sale dates)' : 'Recipe cost in effect on each sale day';
  }
  return out;
}

function presentPeriod(o) {
  return {
    product_id: o.product_id, name: o.name, qty: round3(o.qty), revenue: money(o.revenue),
    recipe_cost: o.fully_costed ? money(o.recipe_cost) : null, known_recipe_cost: money(o.recipe_cost),
    contribution: o.contribution == null ? null : money(o.contribution), food_cost_pct: o.food_cost_pct,
    average_price: o.qty > 0 ? money(o.revenue / o.qty) : null, cost_basis: o.cost_basis,
    qty_uncosted: round3(o.qty_uncosted), qty_current_basis: round3(o.qty_current_basis)
  };
}

/* ─────────────────────────── Targets & settings ─────────────────────────── */

const SETTING_KEYS = {
  food_cost_target_pct: [0, 100], contribution_target_per_plate: [0, 1e7], daily_sales_target_qty: [0, 1e7], monthly_sales_target_qty: [0, 1e8],
  ingredient_increase_alert_pct: [0, 1000], recipe_cost_increase_alert_pct: [0, 1000], consumption_variance_alert_pct: [0, 1000], waste_increase_alert_pct: [0, 1000]
};

function getSettings() {
  ensureSchema();
  const saved = parseJson(get('SELECT settings_json FROM rfc_settings WHERE id = 1')?.settings_json, {});
  const out = {};
  for (const k of Object.keys(SETTING_KEYS)) out[k] = numOrNull(saved[k]);
  return out;
}

function getProductTargets() {
  ensureSchema();
  return new Map(all('SELECT * FROM rfc_product_targets').map((r) => [Number(r.product_id), {
    food_cost_target_pct: numOrNull(r.food_cost_target_pct), contribution_target: numOrNull(r.contribution_target),
    daily_qty_target: numOrNull(r.daily_qty_target), monthly_qty_target: numOrNull(r.monthly_qty_target)
  }]));
}

function cleanBounded(v, [lo, hi], label) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < lo || n > hi) throw new Error(`${label} must be between ${lo} and ${hi}`);
  return n;
}

function getTargets(actor) {
  requireCostAccess(actor);
  const ctx = loadContext();
  const pt = getProductTargets();
  return {
    settings: getSettings(),
    products: [...ctx.products.values()].map((p) => ({ product_id: p.id, name: p.name, ...(pt.get(p.id) || { food_cost_target_pct: null, contribution_target: null, daily_qty_target: null, monthly_qty_target: null }) })),
    note: 'Targets are empty until you set them. Product targets override the general targets.'
  };
}

function saveTargets(d = {}, actor) {
  const user = requireTargetsAccess(actor);
  ensureSchema();
  const before = getSettings();
  if (d.settings && typeof d.settings === 'object') {
    const next = { ...before };
    for (const [k, range] of Object.entries(SETTING_KEYS)) {
      if (Object.prototype.hasOwnProperty.call(d.settings, k)) next[k] = cleanBounded(d.settings[k], range, k.replace(/_/g, ' '));
    }
    const json = JSON.stringify(next);
    if (get('SELECT id FROM rfc_settings WHERE id = 1')) run('UPDATE rfc_settings SET settings_json = ?, updated_by = ?, updated_at = ? WHERE id = 1', [json, user.id, nowSql()]);
    else run('INSERT INTO rfc_settings (id, settings_json, updated_by, updated_at) VALUES (1, ?, ?, ?)', [json, user.id, nowSql()]);
    logActivity(user, 'food_cost_targets_updated', 'recipe_food_cost_settings', 1, { before, after: next });
  }
  if (d.product && d.product.product_id) {
    const pid = Number(d.product.product_id);
    if (!get('SELECT id FROM products WHERE id = ?', [pid])) throw new Error('Product not found');
    const vals = [
      cleanBounded(d.product.food_cost_target_pct, [0, 100], 'Food cost target'),
      cleanBounded(d.product.contribution_target, [0, 1e7], 'Contribution target'),
      cleanBounded(d.product.daily_qty_target, [0, 1e7], 'Daily sales target'),
      cleanBounded(d.product.monthly_qty_target, [0, 1e8], 'Monthly sales target')
    ];
    if (get('SELECT product_id FROM rfc_product_targets WHERE product_id = ?', [pid])) {
      run('UPDATE rfc_product_targets SET food_cost_target_pct = ?, contribution_target = ?, daily_qty_target = ?, monthly_qty_target = ?, updated_by = ?, updated_at = ? WHERE product_id = ?', [...vals, user.id, nowSql(), pid]);
    } else {
      run('INSERT INTO rfc_product_targets (product_id, food_cost_target_pct, contribution_target, daily_qty_target, monthly_qty_target, updated_by, updated_at) VALUES (?,?,?,?,?,?,?)', [pid, ...vals, user.id, nowSql()]);
    }
    logActivity(user, 'food_cost_product_target_updated', 'product', pid, { food_cost_target_pct: vals[0], contribution_target: vals[1], daily_qty_target: vals[2], monthly_qty_target: vals[3] });
  }
  return getTargets(user);
}

function targetFor(productId, settings, pt) {
  const t = pt.get(Number(productId)) || {};
  return {
    food_cost_target_pct: t.food_cost_target_pct ?? settings.food_cost_target_pct,
    contribution_target: t.contribution_target ?? settings.contribution_target_per_plate,
    daily_qty_target: t.daily_qty_target ?? settings.daily_sales_target_qty,
    monthly_qty_target: t.monthly_qty_target ?? settings.monthly_sales_target_qty
  };
}

function targetStatus(card, target) {
  const out = [];
  if (target.food_cost_target_pct != null && card.food_cost_pct != null) {
    out.push({ key: 'food_cost', ok: card.food_cost_pct <= target.food_cost_target_pct, text: `Food cost ${card.food_cost_pct}% vs target ${target.food_cost_target_pct}%` });
  }
  if (target.contribution_target != null && card.gross_contribution != null) {
    out.push({ key: 'contribution', ok: card.gross_contribution >= target.contribution_target, text: `Contribution ${money(card.gross_contribution)} per plate vs target ${money(target.contribution_target)}` });
  }
  return out;
}

/* ─────────────────────────── Views ─────────────────────────── */

function overview(f = {}, actor) {
  const user = requireCostAccess(actor);
  const ctx = loadContext();
  refreshHistory(ctx, { user });
  const branchId = scopeBranch(user, f.branch_id);
  const alloc = allocationInfo(branchId);
  const settings = getSettings();
  const pt = getProductTargets();
  const range = resolveRange(f.preset || f.from ? f : { preset: 'this_month' });
  const period = periodRecipeCosts(range.from, range.to, branchId, ctx);
  const cards = [...ctx.products.keys()].map((id) => {
    const card = withAllocations(costRecipe(ctx, id), alloc);
    const target = targetFor(id, settings, pt);
    const sales = period.get(id);
    return { ...card, target, target_status: targetStatus(card, target), period: sales ? presentPeriod(sales) : { qty: 0, revenue: 0, recipe_cost: 0, contribution: 0, food_cost_pct: null, cost_basis: null } };
  });
  const complete = cards.filter((c) => c.complete && c.selling_price > 0);
  const totals = [...period.values()].reduce((a, o) => {
    a.qty += o.qty; a.revenue += o.revenue; a.cost += o.recipe_cost; if (!o.fully_costed) a.incomplete += 1; return a;
  }, { qty: 0, revenue: 0, cost: 0, incomplete: 0 });
  return {
    range, branch_id: branchId, allocation: alloc, settings,
    price_note: 'Prices are the product selling price from the POS catalogue. Branch-specific prices are not configured in this system, so every branch uses the same price.',
    cards,
    summary: {
      recipes: cards.length, complete: complete.length, incomplete: cards.length - complete.length,
      average_food_cost_pct: complete.length ? Math.round(complete.reduce((a, c) => a + c.food_cost_pct, 0) / complete.length * 10) / 10 : null,
      period_qty: round3(totals.qty), period_revenue: money(totals.revenue),
      period_recipe_cost: totals.incomplete ? null : money(totals.cost),
      period_contribution: totals.incomplete ? null : money(totals.revenue - totals.cost),
      period_food_cost_pct: totals.incomplete ? null : pct1(totals.cost, totals.revenue),
      period_incomplete_recipes: totals.incomplete
    }
  };
}

function costCard(productId, f = {}, actor) {
  const user = requireCostAccess(actor);
  const ctx = loadContext();
  refreshHistory(ctx, { user });
  const branchId = scopeBranch(user, f.branch_id);
  const card = costRecipe(ctx, productId);
  if (!card) throw new Error('Recipe product not found (the product needs ingredient lines in Recipe Builder)');
  const target = targetFor(card.product_id, getSettings(), getProductTargets());
  const presets = ['today', 'this_week', 'this_month'];
  const sales = {};
  for (const p of presets) {
    const r = resolveRange({ preset: p });
    const o = periodRecipeCosts(r.from, r.to, branchId, ctx).get(card.product_id);
    sales[p] = o ? presentPeriod(o) : { qty: 0, revenue: 0, recipe_cost: 0, contribution: 0, food_cost_pct: null };
  }
  if (f.from || (f.preset && !presets.includes(f.preset))) {
    const r = resolveRange(f);
    const o = periodRecipeCosts(r.from, r.to, branchId, ctx).get(card.product_id);
    sales.range = { ...(o ? presentPeriod(o) : { qty: 0, revenue: 0, recipe_cost: 0, contribution: 0, food_cost_pct: null }), label: r.label };
  }
  return { ...withAllocations(card, allocationInfo(branchId)), target, target_status: targetStatus(card, target), sales, history: costHistory(card.product_id, user).rows.slice(-12) };
}

/** Sales performance per recipe for a period (best and worst sellers, contribution). */
function salesPerformance(f = {}, actor) {
  const user = requireCostAccess(actor);
  const ctx = loadContext();
  refreshHistory(ctx, { user });
  const branchId = scopeBranch(user, f.branch_id);
  const range = resolveRange(f.preset || f.from ? f : { preset: 'this_month' });
  const period = periodRecipeCosts(range.from, range.to, branchId, ctx);
  const rows = [...period.values()].map(presentPeriod).sort((a, b) => b.qty - a.qty);
  const sold = new Set(rows.map((r) => r.product_id));
  const notSold = [...ctx.products.values()].filter((p) => !sold.has(p.id)).map((p) => ({ product_id: p.id, name: p.name }));
  const settings = getSettings();
  const pt = getProductTargets();
  const days = Math.max(1, Math.round((Date.parse(range.to) - Date.parse(range.from)) / 86400000) + 1);
  const withTargets = rows.map((r) => {
    const t = targetFor(r.product_id, settings, pt);
    return {
      ...r,
      daily_average_qty: round3(r.qty / days),
      daily_target: t.daily_qty_target, monthly_target: t.monthly_qty_target,
      daily_target_met: t.daily_qty_target != null ? r.qty / days >= t.daily_qty_target : null
    };
  });
  const tot = rows.reduce((a, r) => { a.qty += r.qty; a.revenue += r.revenue; if (r.recipe_cost == null) a.inc = true; else a.cost += r.recipe_cost; return a; }, { qty: 0, revenue: 0, cost: 0, inc: false });
  return {
    range, branch_id: branchId, rows: withTargets, not_sold: notSold,
    totals: { qty: round3(tot.qty), revenue: money(tot.revenue), recipe_cost: tot.inc ? null : money(tot.cost), contribution: tot.inc ? null : money(tot.revenue - tot.cost), food_cost_pct: tot.inc ? null : pct1(tot.cost, tot.revenue) },
    best: withTargets.slice(0, 5), worst: withTargets.slice().reverse().slice(0, 5),
    note: 'Revenue is the sale-line total for completed POS sales (same rules as Financial Intelligence). Refunds are reported in Financial Intelligence and are not deducted per recipe here. Combo meals are not included.'
  };
}

/** Required ingredients and expected cost to produce N portions. Read-only. */
function productionCalculator(productId, qty, f = {}, actor) {
  const user = requireProduceAccess(actor);
  const showCosts = canSeeCosts(user);
  const n = Number(qty);
  if (!(n > 0) || n > 1e6) throw new Error('Enter a quantity greater than 0');
  const ctx = loadContext();
  const card = costRecipe(ctx, productId);
  if (!card) throw new Error('Recipe product not found');
  const branchId = scopeBranch(user, f.branch_id);
  const hasBranchStock = !!tryAll('SELECT 1 FROM branch_stock WHERE 1=0');
  const lines = card.lines.filter((l) => !l.optional).map((l) => {
    let stock = num(ctx.ings.get(l.ingredient_product_id)?.stock_quantity);
    if (branchId && hasBranchStock) stock = num(get('SELECT quantity FROM branch_stock WHERE product_id = ? AND branch_id = ?', [l.ingredient_product_id, branchId])?.quantity);
    const required = l.qty_stock == null ? null : l.qty_stock * n;
    return {
      ingredient_product_id: l.ingredient_product_id, name: l.name,
      per_portion: l.quantity, per_portion_unit: l.unit, waste_pct: l.waste_pct,
      required_qty: required == null ? null : round3(required), stock_unit: l.stock_unit,
      required_in_recipe_unit: round3(l.quantity * (1 + l.waste_pct / 100) * n),
      in_stock: round3(stock), shortfall: required == null ? null : round3(Math.max(0, required - stock)),
      enough: required == null ? null : stock >= required - 1e-9,
      unit_cost: showCosts ? l.unit_cost : undefined, expected_cost: showCosts && l.cost_ok ? money(l.line_cost * n) : undefined,
      issue: l.issue
    };
  });
  return {
    product_id: card.product_id, name: card.name, quantity: n, branch_id: branchId,
    stock_scope: branchId && hasBranchStock ? 'Branch stock' : 'Total stock',
    lines,
    expected_cost: showCosts && card.complete ? money(card.recipe_cost_raw * n) : null,
    cost_per_portion: showCosts && card.complete ? money(card.recipe_cost_raw) : null,
    can_produce: lines.every((l) => l.enough === true),
    issues: card.issues,
    note: 'Calculation only — nothing is deducted. Use Production to record an actual batch.'
  };
}

function simCostOverrides(ctx, list) {
  const costOverride = new Map();
  const issues = [];
  for (const c of list || []) {
    const id = Number(c.ingredient_product_id);
    const ing = ctx.ings.get(id);
    if (!ing) { issues.push(`Ingredient #${id} is not used in any recipe`); continue; }
    const su = stockUnitOf(ing);
    const unit = c.unit || su;
    const per = convertUnits(id, 1, unit, su);
    if (!per.ok || !(per.qty > 0)) { issues.push(`${ing.name}: ${per.reason || 'cannot convert'}`); continue; }
    if (c.unit_cost != null && c.unit_cost !== '') {
      const v = Number(c.unit_cost);
      if (!(v >= 0)) { issues.push(`${ing.name}: cost must be 0 or more`); continue; }
      costOverride.set(id, v / per.qty);
    } else if (c.change != null && c.change !== '') {
      const delta = Number(c.change);
      if (!Number.isFinite(delta)) { issues.push(`${ing.name}: change must be a number`); continue; }
      costOverride.set(id, num(ing.buying_price) + delta / per.qty);
    } else if (c.change_pct != null && c.change_pct !== '') {
      costOverride.set(id, num(ing.buying_price) * (1 + Number(c.change_pct) / 100));
    }
  }
  return { costOverride, issues };
}

/** What-if simulation. Nothing is saved and the POS price is never changed. */
function whatIf(d = {}, actor) {
  const user = requireCostAccess(actor);
  const ctx = loadContext();
  const pid = Number(d.product_id);
  const current = costRecipe(ctx, pid);
  if (!current) throw new Error('Recipe product not found');
  const { costOverride, issues } = simCostOverrides(ctx, d.ingredient_costs);
  const qtyOverride = new Map();
  for (const q of d.portions || []) {
    const id = Number(q.ingredient_product_id);
    const v = Number(q.quantity);
    if (!(v >= 0)) { issues.push(`Portion for ingredient #${id} must be 0 or more`); continue; }
    qtyOverride.set(id, { quantity: v, unit: q.unit || null });
  }
  const price = d.price != null && d.price !== '' ? Number(d.price) : null;
  if (price != null && !(price >= 0)) throw new Error('What-if price must be 0 or more');
  const sim = costRecipe(ctx, pid, { costOverride, qtyOverride, price });
  const branchId = scopeBranch(user, d.branch_id);
  const alloc = allocationInfo(branchId);
  let qtySold = d.quantity != null && d.quantity !== '' ? Number(d.quantity) : null;
  let qtyBasis = 'entered';
  if (qtySold == null) {
    const r = resolveRange({ preset: 'this_month' });
    qtySold = num(periodRecipeCosts(r.from, r.to, branchId, ctx).get(pid)?.qty);
    qtyBasis = 'quantity sold this month';
  }
  const goal = d.target_contribution != null && d.target_contribution !== '' ? Number(d.target_contribution) : null;
  const pack = (c) => {
    const a = withAllocations(c, alloc);
    return {
      selling_price: c.selling_price, recipe_cost: c.recipe_cost, food_cost_pct: c.food_cost_pct, gross_contribution: c.gross_contribution,
      contribution_after_allocations: a.contribution_after_allocations, complete: c.complete,
      total_contribution: c.gross_contribution == null ? null : money(c.gross_contribution * qtySold),
      plates_for_target: goal != null && c.gross_contribution > 0 ? Math.ceil(goal / c.gross_contribution - 1e-9) : null,
      lines: c.lines.map((l) => ({ name: l.name, quantity: l.quantity, unit: l.unit, unit_cost: l.unit_cost, line_cost: l.line_cost, simulated: l.unit_cost_simulated || qtyOverride.has(l.ingredient_product_id), issue: l.issue }))
    };
  };
  const cur = pack(current);
  const nxt = pack(sim);
  const diff = (a, b) => (a == null || b == null ? null : money(b - a));
  return {
    product_id: pid, name: current.name, quantity: qtySold, quantity_basis: qtyBasis, target_contribution: goal,
    current: cur, simulation: nxt,
    difference: {
      selling_price: diff(cur.selling_price, nxt.selling_price), recipe_cost: diff(cur.recipe_cost, nxt.recipe_cost),
      food_cost_pct: cur.food_cost_pct == null || nxt.food_cost_pct == null ? null : Math.round((nxt.food_cost_pct - cur.food_cost_pct) * 10) / 10,
      gross_contribution: diff(cur.gross_contribution, nxt.gross_contribution), total_contribution: diff(cur.total_contribution, nxt.total_contribution)
    },
    issues: [...issues, ...sim.issues],
    note: 'Simulation only. The POS price, recipe and ingredient costs have not been changed.'
  };
}

/** Ingredient-level price change: recipes affected, with old and new cost and food cost %. */
function ingredientImpact(ctx, ingredientId, newUnitCost) {
  const id = Number(ingredientId);
  const affected = [];
  for (const [pid, lines] of ctx.bom.entries()) {
    if (!lines.some((l) => Number(l.ingredient_product_id) === id)) continue;
    const before = costRecipe(ctx, pid);
    if (!before) continue;
    const after = costRecipe(ctx, pid, { costOverride: new Map([[id, newUnitCost]]) });
    affected.push({
      product_id: pid, name: before.name, selling_price: before.selling_price,
      old_cost: before.recipe_cost, new_cost: after.recipe_cost, cost_change: before.recipe_cost == null || after.recipe_cost == null ? null : money(after.recipe_cost - before.recipe_cost),
      old_food_cost_pct: before.food_cost_pct, new_food_cost_pct: after.food_cost_pct,
      old_contribution: before.gross_contribution, new_contribution: after.gross_contribution,
      complete: before.complete && after.complete
    });
  }
  return affected.sort((a, b) => num(b.cost_change) - num(a.cost_change));
}

/** Observed ingredient cost changes and the recipes they affect (old vs current cost). */
function priceChanges(f = {}, actor) {
  const user = requireCostAccess(actor);
  const ctx = loadContext();
  refreshHistory(ctx, { user, force: true });
  const days = Math.min(3650, Math.max(1, Number(f.days) || 90));
  const since = new Date(Date.now() - days * 86400000).toISOString().replace('T', ' ').slice(0, 19);
  const rows = [];
  const lastCosts = lastIngredientCosts();
  for (const [id, ing] of ctx.ings.entries()) {
    const hist = lastCosts.get(id) || [];
    if (hist.length < 2) continue;
    const [latest, prev] = hist;
    if (String(latest.observed_at || '') < since) continue;
    const oldCost = num(prev.unit_cost); const newCost = num(latest.unit_cost);
    if (Math.abs(newCost - oldCost) < 1e-9) continue;
    // Old recipe cost = the same recipe with the previous ingredient cost; current = live cost.
    const oldCtxCost = new Map([[id, oldCost]]);
    const affected = [];
    for (const [pid, lines] of ctx.bom.entries()) {
      if (!lines.some((l) => Number(l.ingredient_product_id) === id)) continue;
      const before = costRecipe(ctx, pid, { costOverride: oldCtxCost });
      const now = costRecipe(ctx, pid);
      affected.push({
        product_id: pid, name: now.name, old_cost: before.recipe_cost, new_cost: now.recipe_cost,
        cost_change: before.recipe_cost == null || now.recipe_cost == null ? null : money(now.recipe_cost - before.recipe_cost),
        old_food_cost_pct: before.food_cost_pct, new_food_cost_pct: now.food_cost_pct
      });
    }
    rows.push({
      ingredient_product_id: id, name: ing.name, stock_unit: stockUnitOf(ing),
      old_unit_cost: oldCost, new_unit_cost: newCost, change_pct: oldCost > 0 ? Math.round(((newCost - oldCost) / oldCost) * 1000) / 10 : null,
      changed_at: latest.observed_at, source: latest.source, affected
    });
  }
  rows.sort((a, b) => String(b.changed_at).localeCompare(String(a.changed_at)));
  return {
    days, rows,
    note: 'Ingredient purchase costs are recorded from the moment this upgrade was installed, whenever they change (restock, ingredient edit, or detected on the next costing run). Earlier changes are not known and are not estimated.'
  };
}

function costHistory(productId, actor) {
  requireCostAccess(actor);
  ensureSchema();
  const rows = all('SELECT snap_date, recipe_cost, complete, selling_price, food_cost_pct FROM rfc_recipe_cost_history WHERE product_id = ? ORDER BY snap_date, id', [Number(productId)])
    .map((r) => ({ date: normDay(r.snap_date), recipe_cost: money(r.recipe_cost), complete: Number(r.complete) === 1, selling_price: money(r.selling_price), food_cost_pct: numOrNull(r.food_cost_pct) }));
  return {
    product_id: Number(productId), rows,
    note: 'One entry per day on which the recipe cost, price or ingredients changed. Past entries are never rewritten. History starts when this feature was first used; sales before the first entry are costed at the current recipe cost and labelled as such.'
  };
}

/* ─────────────────────────── Variance ─────────────────────────── */

function movementRows(from, to, branchId, ingIds) {
  if (!ingIds.length) return [];
  const hasBranch = columnExists('stock_movements', 'branch_id');
  const day = localDay('sm.created_at');
  return all(`SELECT sm.product_id, sm.movement_type, COALESCE(sm.reference_type, '') AS reference_type,
      SUM(CASE WHEN sm.previous_stock IS NOT NULL AND sm.new_stock IS NOT NULL THEN sm.previous_stock - sm.new_stock
               WHEN sm.movement_type IN ('sale', 'remove') THEN sm.quantity ELSE -sm.quantity END) AS used
    FROM stock_movements sm
    WHERE ${day} BETWEEN ? AND ? AND sm.movement_type IN ('sale', 'remove', 'adjust', 'return')
      AND sm.product_id IN (${ingIds.map(() => '?').join(',')})${branchId && hasBranch ? ' AND sm.branch_id = ?' : ''}
    GROUP BY sm.product_id, sm.movement_type, COALESCE(sm.reference_type, '')`,
  [from, to, ...ingIds, ...(branchId && hasBranch ? [branchId] : [])]);
}

function movementCategory(type, ref) {
  const r = String(ref || '').toLowerCase();
  if (type === 'return' || r.startsWith('return')) return 'returns';
  if (r === 'sale' || r === 'sale_edit') return 'pos_sales';
  if (r === 'production') return 'production';
  if (r === 'recipe_waste' || r === 'waste') return 'waste';
  return 'adjustments';
}

/**
 * Expected consumption = recipe quantities × POS sales (make-to-order meals deduct ingredients
 * when sold) + planned quantities of completed make-to-stock production batches.
 * Actual consumption = net stock reductions recorded in stock movements for the same period.
 */
function variance(f = {}, actor) {
  const user = requireCostAccess(actor);
  const ctx = loadContext();
  const branchId = scopeBranch(user, f.branch_id);
  const range = resolveRange(f.preset || f.from ? f : { preset: 'this_month' });
  const settings = getSettings();
  const exp = new Map();
  const bump = (id, k, v) => {
    if (!exp.has(id)) exp.set(id, { sales: 0, production: 0, issues: new Set() });
    exp.get(id)[k] += v;
  };
  for (const r of salesRows(range.from, range.to, branchId)) {
    const p = ctx.products.get(r.product_id);
    if (!p || p.production_mode === 'make_to_stock') continue;
    const selected = inventory.selectedModifierNames(String(r.mods || '').split(',').map((s) => ({ name: s.trim() })).filter((m) => m.name));
    for (const item of ctx.bom.get(r.product_id) || []) {
      if (!inventory.recipeItemApplies(item, selected)) continue;
      const l = costLine(item, ctx);
      if (l.qty_stock == null) { bump(l.ingredient_product_id, 'sales', 0); exp.get(l.ingredient_product_id).issues.add(l.issue); continue; }
      bump(l.ingredient_product_id, 'sales', l.qty_stock * r.qty);
    }
  }
  const hasPlanned = columnExists('production_batch_items', 'planned_quantity');
  const prodRows = tryAll(`SELECT pbi.ingredient_product_id AS id, SUM(${hasPlanned ? 'COALESCE(pbi.planned_quantity, pbi.quantity)' : 'pbi.quantity'}) AS planned, SUM(pbi.quantity) AS actual
    FROM production_batch_items pbi JOIN production_batches b ON b.id = pbi.batch_id
    LEFT JOIN recipe_profiles rp ON rp.id = b.recipe_profile_id
    WHERE b.status = 'completed' AND COALESCE(rp.production_mode, 'make_to_order') = 'make_to_stock'
      AND ${localDay('COALESCE(b.completed_at, b.created_at)')} BETWEEN ? AND ?${branchId ? ' AND b.branch_id = ?' : ''}
    GROUP BY pbi.ingredient_product_id`, [range.from, range.to, ...(branchId ? [branchId] : [])]) || [];
  const prodActual = new Map();
  for (const r of prodRows) { bump(Number(r.id), 'production', num(r.planned)); prodActual.set(Number(r.id), num(r.actual)); }

  const ingIds = [...ctx.ings.keys()];
  const act = new Map();
  for (const m of movementRows(range.from, range.to, branchId, ingIds)) {
    const id = Number(m.product_id);
    if (!act.has(id)) act.set(id, { pos_sales: 0, production: 0, waste: 0, adjustments: 0, returns: 0 });
    const cat = movementCategory(m.movement_type, m.reference_type);
    const used = num(m.used);
    act.get(id)[cat] += cat === 'returns' ? -used : used;
  }
  const wasteRecorded = new Map((tryAll(`SELECT product_id, SUM(quantity) AS q, COUNT(*) AS n FROM recipe_waste_logs
    WHERE status = 'approved' AND ${localDay('COALESCE(approved_at, created_at)')} BETWEEN ? AND ? GROUP BY product_id`, [range.from, range.to]) || [])
    .map((r) => [Number(r.product_id), { qty: num(r.q), n: num(r.n) }]));
  const changedRecipes = new Set((tryAll('SELECT DISTINCT product_id FROM rfc_recipe_cost_history WHERE snap_date > ? AND snap_date <= ?', [range.from, range.to]) || []).map((r) => Number(r.product_id)));

  const threshold = settings.consumption_variance_alert_pct;
  const rows = [];
  for (const id of new Set([...exp.keys(), ...act.keys()])) {
    const ing = ctx.ings.get(id);
    if (!ing) continue;
    const e = exp.get(id) || { sales: 0, production: 0, issues: new Set() };
    const a = act.get(id) || { pos_sales: 0, production: 0, waste: 0, adjustments: 0, returns: 0 };
    const expected = e.sales + e.production;
    const actual = a.pos_sales + a.production + a.waste + a.adjustments - a.returns;
    if (Math.abs(expected) < 1e-9 && Math.abs(actual) < 1e-9) continue;
    const v = actual - expected;
    const vp = expected > 0 ? Math.round((v / expected) * 1000) / 10 : null;
    const unitCost = num(ing.buying_price);
    let category;
    if (e.issues.size) category = 'insufficient_data';
    else if (expected <= 0) category = 'no_expected_usage';
    else if (Math.abs(vp) <= (threshold ?? 0) + 1e-9 || Math.abs(v) < 1e-6) category = 'within_tolerance';
    else category = v > 0 ? 'above_expected' : 'below_expected';
    const explanations = [];
    if (a.waste > 0 || wasteRecorded.get(id)) explanations.push(`Approved waste recorded: ${round3(a.waste || wasteRecorded.get(id)?.qty)} ${stockUnitOf(ing)}`);
    if (Math.abs(a.adjustments) > 1e-9) explanations.push(`Manual stock adjustments / stock counts: ${round3(a.adjustments)} ${stockUnitOf(ing)}`);
    if (prodActual.has(id) && Math.abs(prodActual.get(id) - e.production) > 1e-9) explanations.push(`Production used ${round3(prodActual.get(id))} vs planned ${round3(e.production)} ${stockUnitOf(ing)}`);
    if (a.returns > 0) explanations.push(`Returned to stock from refunds or sale edits: ${round3(a.returns)} ${stockUnitOf(ing)}`);
    const usedIn = [...ctx.bom.entries()].filter(([, ls]) => ls.some((l) => Number(l.ingredient_product_id) === id)).map(([pid]) => pid);
    if (usedIn.some((pid) => changedRecipes.has(pid))) explanations.push('A recipe using this ingredient changed during the period (expected usage uses the current recipe)');
    rows.push({
      ingredient_product_id: id, name: ing.name, unit: stockUnitOf(ing),
      expected_qty: round3(expected), expected_from_sales: round3(e.sales), expected_from_production: round3(e.production),
      actual_qty: round3(actual), actual_breakdown: { pos_sales: round3(a.pos_sales), production: round3(a.production), waste: round3(a.waste), adjustments: round3(a.adjustments), returns: round3(a.returns) },
      variance_qty: round3(v), variance_pct: vp, variance_cost: unitCost > 0 ? money(v * unitCost) : null,
      category, issues: [...e.issues],
      potential_explanations: explanations.length ? explanations.map((x) => `Potential explanation — requires review: ${x}`) : (category === 'above_expected' || category === 'below_expected' ? ['No recorded waste, adjustment or production difference explains this — requires review.'] : [])
    });
  }
  rows.sort((a, b) => Math.abs(num(b.variance_cost)) - Math.abs(num(a.variance_cost)));
  return {
    range, branch_id: branchId, rows, tolerance_pct: threshold,
    note: 'Expected usage uses the current recipe quantities. Causes are never assumed; listed explanations are records that need review. Combo meals and stock transfers are not included.'
  };
}

/* ─────────────────────────── Waste ─────────────────────────── */

function waste(f = {}, actor) {
  const user = requireCostAccess(actor);
  const ctx = loadContext();
  const branchId = scopeBranch(user, f.branch_id);
  const range = resolveRange(f.preset || f.from ? f : { preset: 'this_month' });
  const rows = tryAll(`SELECT w.id, w.waste_type, w.product_id, w.recipe_profile_id, w.quantity, w.unit, w.cost, w.reason, w.status, w.branch_id, w.created_at,
      p.name AS product_name, p.stock_unit, p.unit AS product_unit, p.buying_price, u.full_name AS recorded_by_name
    FROM recipe_waste_logs w LEFT JOIN products p ON p.id = w.product_id LEFT JOIN users u ON u.id = w.recorded_by
    WHERE ${localDay('w.created_at')} BETWEEN ? AND ? AND w.status != 'rejected'${branchId ? ' AND w.branch_id = ?' : ''}
    ORDER BY w.created_at DESC`, [range.from, range.to, ...(branchId ? [branchId] : [])]) || [];
  const consumption = new Map((variance({ ...f, from: range.from, to: range.to, preset: undefined }, user).rows || []).map((r) => [r.ingredient_product_id, r.actual_qty]));
  const items = rows.map((w) => {
    const pid = Number(w.product_id);
    const isMeal = ctx.products.has(pid);
    let qtyStock = null; let cost = null; let basis = '';
    if (isMeal) {
      const card = costRecipe(ctx, pid);
      qtyStock = num(w.quantity);
      cost = card?.complete ? card.recipe_cost_raw * qtyStock : null;
      basis = card?.complete ? 'Meal waste × current recipe cost' : 'INSUFFICIENT DATA: recipe cost incomplete';
    } else {
      const su = w.stock_unit || w.product_unit || 'each';
      const conv = convertUnits(pid, w.quantity, w.unit || su, su);
      qtyStock = conv.ok ? conv.qty : null;
      cost = conv.ok && num(w.buying_price) > 0 ? conv.qty * num(w.buying_price) : null;
      basis = !conv.ok ? `INSUFFICIENT DATA: ${conv.reason}` : num(w.buying_price) > 0 ? 'Quantity × current ingredient cost' : 'INSUFFICIENT DATA: no purchase cost';
    }
    const used = consumption.get(pid);
    return {
      id: Number(w.id), date: normDay(w.created_at), name: w.product_name || `Product #${pid}`, product_id: pid, kind: isMeal ? 'meal' : 'ingredient',
      waste_type: w.waste_type, quantity: num(w.quantity), unit: w.unit, quantity_stock_unit: qtyStock == null ? null : round3(qtyStock),
      recorded_cost: money(w.cost), cost: cost == null ? null : money(cost), cost_basis: basis,
      waste_pct_of_usage: !isMeal && used > 0 && qtyStock != null && w.status === 'approved' ? pct1(qtyStock, used) : null,
      reason: w.reason || '', status: w.status, branch_id: w.branch_id == null ? null : Number(w.branch_id), recorded_by: w.recorded_by_name || ''
    };
  });
  const sum = (pred) => money(items.filter(pred).reduce((a, i) => a + num(i.cost), 0));
  const byReason = new Map();
  for (const i of items) {
    const k = i.reason || i.waste_type || 'unspecified';
    byReason.set(k, money((byReason.get(k) || 0) + num(i.cost)));
  }
  return {
    range, branch_id: branchId, rows: items,
    totals: { approved_cost: sum((i) => i.status === 'approved'), pending_cost: sum((i) => i.status === 'pending'), records: items.length, uncosted: items.filter((i) => i.cost == null).length },
    by_reason: [...byReason.entries()].map(([reason, cost]) => ({ reason, cost })).sort((a, b) => b.cost - a.cost),
    note: branchId ? 'Waste records saved without a branch are only shown under All branches.' : 'Waste % is the approved waste quantity divided by the actual usage of that ingredient in the period.'
  };
}

/* ─────────────────────────── Alerts ─────────────────────────── */

function alerts(f = {}, actor) {
  const user = requireCostAccess(actor);
  const ctx = loadContext();
  refreshHistory(ctx, { user });
  const branchId = scopeBranch(user, f.branch_id);
  const settings = getSettings();
  const pt = getProductTargets();
  const out = [];
  const add = (type, severity, text, extra = {}) => out.push({ type, severity, text, ...extra });
  const snaps = lastRecipeSnapshots();
  const lastCosts = lastIngredientCosts();
  for (const id of ctx.products.keys()) {
    const card = costRecipe(ctx, id);
    const t = targetFor(id, settings, pt);
    if (!card.complete) add('insufficient_data', 'info', `${card.name}: recipe cost cannot be fully calculated — ${card.issues[0] || 'missing data'}`, { product_id: id });
    if (t.food_cost_target_pct != null && card.food_cost_pct != null && card.food_cost_pct > t.food_cost_target_pct) {
      add('food_cost_above_target', 'warning', `${card.name}: food cost ${card.food_cost_pct}% is above the ${t.food_cost_target_pct}% target. Price review suggested.`, { product_id: id });
    }
    if (t.contribution_target != null && card.gross_contribution != null && card.gross_contribution < t.contribution_target) {
      add('price_review', 'warning', `${card.name}: contribution ${money(card.gross_contribution)} per plate is below the ${money(t.contribution_target)} target. Price review suggested.`, { product_id: id });
    }
    const hist = snaps.get(id) || [];
    if (hist.length === 2 && Number(hist[0].complete) === 1 && Number(hist[1].complete) === 1 && num(hist[1].recipe_cost) > 0) {
      const ch = ((num(hist[0].recipe_cost) - num(hist[1].recipe_cost)) / num(hist[1].recipe_cost)) * 100;
      const lim = settings.recipe_cost_increase_alert_pct ?? 0;
      if (ch > lim + 1e-9) add('recipe_cost_up', 'warning', `${card.name}: recipe cost rose ${Math.round(ch * 10) / 10}% (${money(hist[1].recipe_cost)} → ${money(hist[0].recipe_cost)}) on ${normDay(hist[0].snap_date)}.`, { product_id: id });
    }
  }
  const since = new Date(Date.now() - 30 * 86400000).toISOString().replace('T', ' ').slice(0, 19);
  for (const [id, ing] of ctx.ings.entries()) {
    const h = lastCosts.get(id) || [];
    if (h.length < 2 || String(h[0].observed_at || '') < since || !(num(h[1].unit_cost) > 0)) continue;
    const ch = ((num(h[0].unit_cost) - num(h[1].unit_cost)) / num(h[1].unit_cost)) * 100;
    const lim = settings.ingredient_increase_alert_pct ?? 0;
    if (ch > lim + 1e-9) add('ingredient_price_up', 'warning', `${ing.name}: purchase cost rose ${Math.round(ch * 10) / 10}% (${num(h[1].unit_cost)} → ${num(h[0].unit_cost)} per ${stockUnitOf(ing)}).`, { ingredient_product_id: id });
  }
  try {
    const v = variance({ preset: 'this_month', branch_id: branchId }, user);
    for (const r of v.rows.filter((x) => x.category === 'above_expected')) {
      add('consumption_above_expected', 'warning', `${r.name}: actual usage ${r.actual_qty} ${r.unit} is ${r.variance_pct}% above expected ${r.expected_qty} ${r.unit} this month.`, { ingredient_product_id: r.ingredient_product_id });
    }
  } catch (_) { /* variance needs data */ }
  try {
    const cur = resolveRange({ preset: 'this_month' });
    const dayOfMonth = Number(cur.to.slice(8, 10));
    const last = resolveRange({ preset: 'last_month' });
    const lastTo = `${last.from.slice(0, 8)}${String(Math.min(dayOfMonth, Number(last.to.slice(8, 10)))).padStart(2, '0')}`;
    const a = waste({ from: cur.from, to: cur.to, branch_id: branchId }, user).totals.approved_cost;
    const b = waste({ from: last.from, to: lastTo, branch_id: branchId }, user).totals.approved_cost;
    const lim = settings.waste_increase_alert_pct ?? 0;
    if (b > 0 && ((a - b) / b) * 100 > lim + 1e-9) add('waste_up', 'warning', `Approved waste cost this month (${money(a)}) is ${Math.round(((a - b) / b) * 1000) / 10}% higher than the same days last month (${money(b)}).`);
    else if (b === 0 && a > 0 && lim === 0) add('waste_up', 'info', `Approved waste cost this month is ${money(a)} (none in the same days last month).`);
  } catch (_) { /* waste needs data */ }
  const rank = { warning: 0, info: 1 };
  out.sort((x, y) => rank[x.severity] - rank[y.severity]);
  return { alerts: out, note: 'Alerts only inform. Nothing is changed automatically. Thresholds come from Targets; where none is set, any increase is reported.' };
}

/* ─────────────────────────── Reports ─────────────────────────── */

const REPORTS = {
  cost_cards: 'Recipe Cost Cards',
  food_cost: 'Food Cost % by Recipe',
  sales: 'Recipe Sales & Contribution',
  variance: 'Expected vs Actual Ingredient Usage',
  waste: 'Waste Report',
  price_changes: 'Ingredient Price Changes',
  history: 'Recipe Cost History'
};

/** Table data for the existing CSV / PDF / print export helpers in the Recipe app. */
function report(type, f = {}, actor) {
  const user = requireCostAccess(actor);
  const fmt = (v) => (v == null ? 'INSUFFICIENT DATA' : v);
  const title = REPORTS[type];
  if (!title) throw new Error('Unknown report');
  let headers = []; let rows = []; let period = null;
  if (type === 'cost_cards' || type === 'food_cost') {
    const o = overview(f, user);
    period = o.range;
    if (type === 'cost_cards') {
      headers = ['Recipe', 'Ingredient', 'Qty', 'Unit', 'Waste %', 'Unit cost', 'Line cost', 'Note'];
      for (const c of o.cards) {
        for (const l of c.lines) rows.push([c.name, l.name, l.quantity, l.unit, l.waste_pct, l.unit_cost == null ? '' : `${l.unit_cost} / ${l.stock_unit || ''}`, fmt(l.line_cost == null ? null : money(l.line_cost)), l.optional ? `Optional (${l.option_name || 'option'})` : (l.issue || '')]);
        rows.push([c.name, 'TOTAL', '', '', '', '', fmt(c.recipe_cost), `Price ${c.selling_price} · Food cost ${fmt(c.food_cost_pct)}% · Contribution ${fmt(c.gross_contribution)}`]);
      }
    } else {
      headers = ['Recipe', 'Selling price', 'Recipe cost', 'Food cost %', 'Gross contribution', 'After allocations', 'Target', 'Status'];
      rows = o.cards.map((c) => [c.name, c.selling_price, fmt(c.recipe_cost), fmt(c.food_cost_pct), fmt(c.gross_contribution), c.contribution_after_allocations ?? '', c.target.food_cost_target_pct ?? '', c.target_status.map((s) => (s.ok ? 'OK: ' : 'REVIEW: ') + s.text).join('; ')]);
    }
  } else if (type === 'sales') {
    const s = salesPerformance(f, user);
    period = s.range;
    headers = ['Recipe', 'Qty sold', 'Revenue', 'Recipe cost', 'Food cost %', 'Contribution', 'Cost basis'];
    rows = s.rows.map((r) => [r.name, r.qty, r.revenue, fmt(r.recipe_cost), fmt(r.food_cost_pct), fmt(r.contribution), r.cost_basis]);
    rows.push(['TOTAL', s.totals.qty, s.totals.revenue, fmt(s.totals.recipe_cost), fmt(s.totals.food_cost_pct), fmt(s.totals.contribution), '']);
  } else if (type === 'variance') {
    const v = variance(f, user);
    period = v.range;
    headers = ['Ingredient', 'Unit', 'Expected', 'Actual', 'Variance', 'Variance %', 'Variance cost', 'Category', 'Potential explanations (require review)'];
    rows = v.rows.map((r) => [r.name, r.unit, r.expected_qty, r.actual_qty, r.variance_qty, r.variance_pct ?? '', r.variance_cost ?? '', r.category.replace(/_/g, ' '), r.potential_explanations.join(' | ')]);
  } else if (type === 'waste') {
    const w = waste(f, user);
    period = w.range;
    headers = ['Date', 'Item', 'Type', 'Qty', 'Unit', 'Cost', 'Waste % of usage', 'Reason', 'Status', 'Branch'];
    rows = w.rows.map((r) => [r.date, r.name, r.kind, r.quantity, r.unit, fmt(r.cost), r.waste_pct_of_usage ?? '', r.reason, r.status, r.branch_id ?? '']);
  } else if (type === 'price_changes') {
    const p = priceChanges(f, user);
    headers = ['Ingredient', 'Old cost', 'New cost', 'Change %', 'Changed', 'Recipe', 'Old recipe cost', 'New recipe cost', 'Old food cost %', 'New food cost %'];
    for (const r of p.rows) {
      if (!r.affected.length) rows.push([r.name, r.old_unit_cost, r.new_unit_cost, r.change_pct ?? '', r.changed_at, '', '', '', '', '']);
      for (const a of r.affected) rows.push([r.name, r.old_unit_cost, r.new_unit_cost, r.change_pct ?? '', r.changed_at, a.name, fmt(a.old_cost), fmt(a.new_cost), fmt(a.old_food_cost_pct), fmt(a.new_food_cost_pct)]);
    }
  } else if (type === 'history') {
    const ctx = loadContext();
    headers = ['Recipe', 'Date', 'Recipe cost', 'Selling price', 'Food cost %', 'Complete'];
    for (const id of ctx.products.keys()) {
      for (const h of costHistory(id, user).rows) rows.push([ctx.products.get(id).name, h.date, h.recipe_cost, h.selling_price, h.food_cost_pct ?? '', h.complete ? 'Yes' : 'No']);
    }
  }
  logActivity(user, 'food_cost_report', 'recipe_food_cost_report', null, { type, rows: rows.length });
  return { type, title, headers, rows, period, generated_at: nowSql(), generated_by: user.full_name || user.username };
}

/* ─────────────────────────── AI advisor ─────────────────────────── */

function findByName(list, text) {
  const t = ` ${String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
  let best = null;
  for (const x of list) {
    const n = String(x.name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!n) continue;
    if (t.includes(` ${n} `) || (n.split(' ').length > 1 && t.includes(n))) { if (!best || n.length > best.n.length) best = { x, n }; }
  }
  if (best) return best.x;
  for (const x of list) {
    const words = String(x.name || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
    if (words.some((w) => t.includes(` ${w} `) || t.includes(` ${w}s `))) return x;
  }
  return null;
}

function parseMoney(text) {
  const m = String(text).match(/(?:^|[^a-z])r\s?(\d[\d\s,]*(?:\.\d+)?)/i);
  if (!m) return null;
  const v = Number(m[1].replace(/[\s,]/g, ''));
  return Number.isFinite(v) ? v : null;
}

function detectIntents(q) {
  const s = q.toLowerCase();
  const out = [];
  const has = (re) => re.test(s);
  if (has(/\b(\d+(?:\.\d+)?)\s*(kg|g|ml|l|litre|gram|grams)\b.*\bto\b\s*(\d+(?:\.\d+)?)\s*(kg|g|ml|l|litre|gram|grams)\b/)) out.push('portion_change');
  if (has(/[+]\s*r\s?\d|increase[sd]? by r\s?\d|goes up by r\s?\d|up by r\s?\d|rises? by r\s?\d|\br\s?\d+(?:\.\d+)?\s*(?:\/|per)\s*(kg|g|l|litre|ml|unit|each)\b/)) out.push('ingredient_delta');
  if (has(/how many (plates|meals|portions|units).*(r\s?\d|contribution|make)/) || has(/plates? .*for r\s?\d/)) out.push('plates_for_target');
  if (has(/(which|what) recipes?.*(affected|use|contain)|affected if/)) out.push('recipes_affected');
  if (has(/why.*(cost|price).*(increase|up|higher|rise)|cost.*increase.*why/)) out.push('cost_increase');
  if (has(/(which|what) ingredients?.*(increase|went up|price.*up|more expensive)|ingredient price/)) out.push('ingredient_price_up');
  if (has(/highest food cost|worst food cost|food cost.*highest/)) out.push('highest_food_cost');
  if (has(/highest contribution|most contribution|most profitable|best contribution|makes? the most/)) out.push('highest_contribution');
  if (has(/best[- ]?sell|sell(s|ing)? (the )?most|top sell|most popular/)) out.push('best_sellers');
  if (has(/worst[- ]?sell|sell(s|ing)? (the )?least|slow(est)?[- ]mov|least popular|not selling/)) out.push('worst_sellers');
  if (has(/(above|more than|over) expected|consumption|over[- ]?usage|usage variance|variance/)) out.push('consumption_above');
  if (has(/most expensive ingredient|costliest|biggest cost|expensive ingredient/)) out.push('costliest_ingredient');
  if (has(/food cost ?%|food cost percent|food cost of|food cost for|what.*food cost/) && !out.includes('highest_food_cost')) out.push('food_cost');
  if (has(/per plate|per meal|per portion|make on|make from|margin|contribution/) && !out.some((i) => ['plates_for_target', 'highest_contribution'].includes(i))) out.push('per_plate');
  if (has(/cost to make|how much does .* cost|cost of (a |the |one )?|recipe cost|meal cost|what does .* cost/) && !out.some((i) => ['cost_increase', 'ingredient_delta', 'portion_change'].includes(i))) out.push('meal_cost');
  if (has(/what should i review|review|attention|problem|issues?|alerts?/) || !out.length) out.push('review');
  return [...new Set(out)];
}

function buildAdvice(q, productId, branchId, user) {
  const ctx = loadContext();
  refreshHistory(ctx, { user });
  const facts = []; const analysis = []; const recs = []; const insufficient = [];
  const fact = (topic, text, source) => facts.push({ topic, text, source: source || 'recipe' });
  const productList = [...ctx.products.values()];
  const ingList = [...ctx.ings.values()].map((i) => ({ ...i, id: Number(i.id) }));
  const product = productId ? ctx.products.get(Number(productId)) : findByName(productList, q);
  const ingredient = findByName(ingList, q);
  const intents = detectIntents(q);
  const month = resolveRange({ preset: 'this_month' });
  const needProduct = (label) => {
    if (product) return costRecipe(ctx, product.id);
    insufficient.push(`INSUFFICIENT DATA: select a meal (or name it in the question) to answer "${label}".`);
    return null;
  };
  const cardFacts = (card) => {
    if (!card.complete) {
      insufficient.push(`INSUFFICIENT DATA: I cannot calculate the current cost of ${card.name} because ${card.issues.filter((i) => /INSUFFICIENT|not found/.test(i)).join('; ') || 'some ingredient data is missing'}.`);
      return false;
    }
    fact('cost', `${card.name}: recipe cost ${money(card.recipe_cost_raw)} per plate from ${card.lines.filter((l) => !l.optional).length} ingredient lines (current purchase costs).`, 'recipe lines × ingredient purchase cost');
    return true;
  };
  const allCards = () => productList.map((p) => costRecipe(ctx, p.id));

  for (const intent of intents) {
    if (intent === 'meal_cost') {
      const card = needProduct('meal cost');
      if (card && cardFacts(card)) {
        for (const l of card.lines.filter((x) => !x.optional && x.cost_ok)) fact('cost', `${l.name}: ${l.quantity} ${l.unit}${l.waste_pct ? ` (+${l.waste_pct}% waste)` : ''} × ${l.unit_cost} per ${l.stock_unit} = ${money(l.line_cost)}`, 'recipe line');
      }
    } else if (intent === 'per_plate' || intent === 'food_cost') {
      const card = needProduct(intent === 'food_cost' ? 'food cost %' : 'contribution per plate');
      if (card && cardFacts(card)) {
        if (card.selling_price > 0) {
          fact('price', `${card.name}: selling price ${money(card.selling_price)} (POS catalogue).`, 'products.selling_price');
          fact('food_cost', `Food cost % = ${money(card.recipe_cost_raw)} ÷ ${money(card.selling_price)} × 100 = ${card.food_cost_pct}%.`, 'calculation');
          fact('contribution', `Gross contribution per plate = ${money(card.selling_price)} − ${money(card.recipe_cost_raw)} = ${money(card.gross_contribution)} (before staff, rent and other operating expenses).`, 'calculation');
          const a = withAllocations(card, allocationInfo(branchId));
          if (a.contribution_after_allocations != null) fact('contribution', `Estimated contribution after configured allocations (${allocationInfo(branchId).total_pct}% of price): ${money(a.contribution_after_allocations)}.`, 'Financial Intelligence allocations');
          const t = targetFor(card.product_id, getSettings(), getProductTargets());
          if (t.food_cost_target_pct != null) {
            fact('target', `Food cost target: ${t.food_cost_target_pct}%.`, 'targets');
            if (card.food_cost_pct > t.food_cost_target_pct) {
              analysis.push(`${card.name} is ${Math.round((card.food_cost_pct - t.food_cost_target_pct) * 10) / 10} percentage points above the food cost target.`);
              const priceForTarget = card.recipe_cost_raw / (t.food_cost_target_pct / 100);
              recs.push({ text: `Review the price of ${card.name}: a price of about ${money(priceForTarget)} would meet the ${t.food_cost_target_pct}% target at today's cost, or review the portion of ${card.costliest?.name || 'the costliest ingredient'}. Use What-If to test before changing anything.` });
            }
          }
        } else insufficient.push(`INSUFFICIENT DATA: ${card.name} has no selling price, so food cost % and contribution cannot be calculated.`);
      }
    } else if (intent === 'costliest_ingredient') {
      const card = needProduct('most expensive ingredient');
      if (card && cardFacts(card) && card.costliest) {
        fact('ingredient', `Most expensive ingredient in ${card.name}: ${card.costliest.name} at ${money(card.costliest.cost)} per plate (${card.costliest.share_pct}% of the recipe cost).`, 'recipe lines');
        analysis.push(`${card.costliest.name} drives the largest share of the cost of ${card.name}; its portion size and purchase price have the most effect on food cost.`);
      }
    } else if (intent === 'cost_increase') {
      const card = needProduct('why the cost increased');
      if (card) {
        const hist = all('SELECT snap_date, recipe_cost, lines_json, complete FROM rfc_recipe_cost_history WHERE product_id = ? ORDER BY snap_date DESC, id DESC LIMIT 2', [card.product_id]);
        if (hist.length < 2) insufficient.push(`INSUFFICIENT DATA: only one cost record exists for ${card.name} so far, so I cannot compare it with an earlier cost.`);
        else {
          const [now, prev] = hist;
          fact('history', `${card.name}: recipe cost ${money(prev.recipe_cost)} on ${normDay(prev.snap_date)} → ${money(now.recipe_cost)} on ${normDay(now.snap_date)}.`, 'recipe cost history');
          const a = new Map(parseJson(prev.lines_json, []).map((l) => [l.i, l]));
          for (const l of parseJson(now.lines_json, [])) {
            const o = a.get(l.i);
            if (!o) { fact('history', `${l.n} was added to the recipe (${money(l.c)}).`, 'recipe cost history'); continue; }
            if (Math.abs(num(o.uc) - num(l.uc)) > 1e-9) fact('history', `${l.n}: purchase cost ${o.uc} → ${l.uc} per stock unit; line cost ${money(o.c)} → ${money(l.c)}.`, 'recipe cost history');
            if (Math.abs(num(o.q) - num(l.q)) > 1e-9 || o.u !== l.u || num(o.w) !== num(l.w)) fact('history', `${l.n}: portion ${o.q} ${o.u} → ${l.q} ${l.u}${num(o.w) !== num(l.w) ? `, waste ${o.w}% → ${l.w}%` : ''}.`, 'recipe cost history');
            a.delete(l.i);
          }
          for (const o of a.values()) fact('history', `${o.n} was removed from the recipe.`, 'recipe cost history');
          if (num(now.recipe_cost) > num(prev.recipe_cost)) analysis.push('The increase is explained by the ingredient cost or portion changes listed above.');
        }
      }
    } else if (intent === 'ingredient_price_up') {
      const pc = priceChanges({ days: 90 }, user).rows.filter((r) => r.new_unit_cost > r.old_unit_cost);
      if (!pc.length) insufficient.push('INSUFFICIENT DATA: no ingredient price increases have been recorded in the last 90 days (prices are recorded from when this feature was installed).');
      for (const r of pc.slice(0, 10)) fact('ingredient', `${r.name}: ${r.old_unit_cost} → ${r.new_unit_cost} per ${r.stock_unit} (${r.change_pct}%) on ${String(r.changed_at).slice(0, 10)}; affects ${r.affected.length} recipe(s).`, 'ingredient cost history');
    } else if (intent === 'highest_food_cost' || intent === 'highest_contribution') {
      const cards = allCards().filter((c) => c.complete && c.selling_price > 0);
      if (!cards.length) insufficient.push('INSUFFICIENT DATA: no recipe has a complete cost and a selling price.');
      else if (intent === 'highest_food_cost') {
        cards.sort((a, b) => b.food_cost_pct - a.food_cost_pct);
        cards.slice(0, 5).forEach((c, i) => fact('ranking', `${i + 1}. ${c.name}: food cost ${c.food_cost_pct}% (cost ${money(c.recipe_cost_raw)}, price ${money(c.selling_price)}).`, 'recipe cost cards'));
      } else {
        cards.sort((a, b) => b.gross_contribution - a.gross_contribution);
        cards.slice(0, 5).forEach((c, i) => fact('ranking', `${i + 1}. ${c.name}: gross contribution ${money(c.gross_contribution)} per plate.`, 'recipe cost cards'));
        const per = periodRecipeCosts(month.from, month.to, branchId, ctx);
        const tot = [...per.values()].filter((o) => o.contribution != null).sort((a, b) => b.contribution - a.contribution)[0];
        if (tot) fact('ranking', `Highest total contribution this month: ${tot.name} with ${money(tot.contribution)} from ${round3(tot.qty)} sold.`, 'POS sales × recipe cost');
      }
    } else if (intent === 'best_sellers' || intent === 'worst_sellers') {
      const per = [...periodRecipeCosts(month.from, month.to, branchId, ctx).values()].sort((a, b) => b.qty - a.qty);
      if (!per.length) insufficient.push('INSUFFICIENT DATA: no recipe meals have been sold this month.');
      const list = intent === 'best_sellers' ? per.slice(0, 5) : per.slice().reverse().slice(0, 5);
      list.forEach((o, i) => fact('sales', `${i + 1}. ${o.name}: ${round3(o.qty)} sold this month, revenue ${money(o.revenue)}${o.contribution != null ? `, contribution ${money(o.contribution)}` : ''}.`, 'POS sales'));
      if (intent === 'worst_sellers') {
        const sold = new Set(per.map((o) => o.product_id));
        const none = productList.filter((p) => !sold.has(p.id));
        if (none.length) fact('sales', `Not sold this month: ${none.slice(0, 10).map((p) => p.name).join(', ')}.`, 'POS sales');
      }
    } else if (intent === 'plates_for_target') {
      const card = needProduct('plates needed');
      const goal = parseMoney(q);
      if (goal == null) insufficient.push('INSUFFICIENT DATA: include the contribution amount, for example "R1,000".');
      else if (card && cardFacts(card)) {
        if (card.gross_contribution > 0) {
          const plates = Math.ceil(goal / card.gross_contribution - 1e-9);
          fact('calculation', `${money(goal)} ÷ ${money(card.gross_contribution)} contribution per plate = ${Math.round((goal / card.gross_contribution) * 100) / 100} → ${plates} plates of ${card.name}.`, 'calculation');
          analysis.push('This is gross contribution before staff, rent and other operating expenses.');
        } else insufficient.push(`${card.name} has no positive contribution per plate at the current price, so no number of plates reaches ${money(goal)}.`);
      }
    } else if (intent === 'ingredient_delta' || intent === 'recipes_affected') {
      if (!ingredient) { insufficient.push('INSUFFICIENT DATA: name an ingredient that is used in a recipe (for example "fish").'); continue; }
      const su = stockUnitOf(ingredient);
      let newCost = null;
      if (intent === 'ingredient_delta') {
        const m = q.toLowerCase().match(/(?:^|[^a-z])r\s?(\d+(?:\.\d+)?)\s*(?:\/|per)?\s*(kg|g|l|litre|ml|unit|each|piece)?\b/);
        const delta = m ? Number(m[1]) : null;
        const unit = (m && m[2]) || su;
        const per = convertUnits(ingredient.id, 1, unit, su);
        if (delta == null || !per.ok) insufficient.push(`INSUFFICIENT DATA: ${per.reason || 'could not read the price change'}.`);
        else if (!(num(ingredient.buying_price) > 0)) insufficient.push(`INSUFFICIENT DATA: I cannot calculate the current ingredient cost because a reliable purchase cost is not available for ${ingredient.name}.`);
        else {
          newCost = num(ingredient.buying_price) + delta / per.qty;
          fact('ingredient', `${ingredient.name}: current cost ${num(ingredient.buying_price)} per ${su}; +${money(delta)} per ${unit} = ${round3(newCost)} per ${su}.`, 'ingredient purchase cost');
        }
      }
      const impact = ingredientImpact(ctx, ingredient.id, newCost != null ? newCost : num(ingredient.buying_price));
      if (!impact.length) insufficient.push(`${ingredient.name} is not used in any recipe.`);
      for (const r of impact) {
        if (newCost != null) {
          if (r.old_cost == null || r.new_cost == null) { insufficient.push(`INSUFFICIENT DATA: ${r.name} has incomplete ingredient data.`); continue; }
          fact('impact', `${r.name}: cost ${money(r.old_cost)} → ${money(r.new_cost)} (+${money(r.cost_change)}); food cost ${r.old_food_cost_pct ?? '—'}% → ${r.new_food_cost_pct ?? '—'}%; contribution ${r.old_contribution ?? '—'} → ${r.new_contribution ?? '—'}.`, 'simulation');
        } else fact('impact', `${r.name} uses ${ingredient.name} (current recipe cost ${r.old_cost == null ? 'INSUFFICIENT DATA' : money(r.old_cost)}, food cost ${r.old_food_cost_pct ?? '—'}%).`, 'recipe lines');
      }
      if (newCost != null && impact.length) recs.push({ text: 'This is a simulation only. Prices and recipes have not changed. Use What-If to test a new selling price for the affected meals.' });
    } else if (intent === 'portion_change') {
      const card = needProduct('portion change');
      const m = q.toLowerCase().match(/(\d+(?:\.\d+)?)\s*(kg|g|ml|l|litre|gram|grams)\b.*?\bto\b\s*(\d+(?:\.\d+)?)\s*(kg|g|ml|l|litre|gram|grams)\b/);
      if (card && m) {
        const line = (ingredient && card.lines.find((l) => l.ingredient_product_id === ingredient.id && !l.optional))
          || card.lines.filter((l) => !l.optional).find((l) => { const c = convertUnits(l.ingredient_product_id, l.quantity, l.unit, m[2]); return c.ok && Math.abs(c.qty - Number(m[1])) < 1e-6; });
        if (!line) insufficient.push(`INSUFFICIENT DATA: I could not find which ingredient of ${card.name} is ${m[1]} ${m[2]}. Name the ingredient in the question.`);
        else {
          const sim = costRecipe(ctx, card.product_id, { qtyOverride: new Map([[line.ingredient_product_id, { quantity: Number(m[3]), unit: m[4] }]]) });
          if (!card.complete || !sim.complete) insufficient.push(`INSUFFICIENT DATA: ${card.name} has incomplete ingredient data.`);
          else {
            fact('simulation', `${card.name}: ${line.name} ${m[1]} ${m[2]} → ${m[3]} ${m[4]}; recipe cost ${money(card.recipe_cost_raw)} → ${money(sim.recipe_cost_raw)} (${money(sim.recipe_cost_raw - card.recipe_cost_raw)}).`, 'simulation');
            if (card.selling_price > 0) fact('simulation', `Food cost ${card.food_cost_pct}% → ${sim.food_cost_pct}%; contribution per plate ${money(card.gross_contribution)} → ${money(sim.gross_contribution)}.`, 'simulation');
            recs.push({ text: 'Simulation only — the recipe has not been changed. A smaller portion can affect customer satisfaction; review before changing the recipe.' });
          }
        }
      } else if (card) insufficient.push('INSUFFICIENT DATA: describe the portion change as, for example, "500g to 400g".');
    } else if (intent === 'consumption_above') {
      const v = variance({ preset: 'this_month', branch_id: branchId }, user);
      const above = v.rows.filter((r) => r.category === 'above_expected');
      if (!v.rows.length) insufficient.push('INSUFFICIENT DATA: no recipe sales, production or stock usage was recorded this month.');
      else if (!above.length) fact('variance', 'No ingredient usage is above expected this month.', 'stock movements vs recipes');
      for (const r of above.slice(0, 8)) {
        fact('variance', `${r.name}: expected ${r.expected_qty} ${r.unit}, actual ${r.actual_qty} ${r.unit} (${r.variance_pct}% above${r.variance_cost != null ? `, about ${money(r.variance_cost)}` : ''}).`, 'stock movements vs recipes');
        r.potential_explanations.forEach((e) => analysis.push(`${r.name}: ${e}`));
      }
      if (above.length) recs.push({ text: 'Review portioning, waste records and stock counts for the ingredients above. The cause has not been determined.' });
    } else if (intent === 'review') {
      const al = alerts({ branch_id: branchId }, user).alerts;
      if (!al.length) fact('review', 'No alerts: no recipe is above its targets and no cost increases or usage variances were found.', 'alerts');
      al.slice(0, 10).forEach((a) => fact('review', a.text, 'alerts'));
      if (al.some((a) => a.type === 'insufficient_data')) recs.push({ text: 'Complete the missing ingredient costs or unit conversions first so every recipe can be costed.' });
      if (al.some((a) => a.type === 'food_cost_above_target' || a.type === 'price_review')) recs.push({ text: 'Review the prices or portions of meals above target using What-If before changing anything.' });
    }
  }
  if (!analysis.length && facts.length) analysis.push('See the facts above — they are calculated from the recipes, ingredient purchase costs and POS sales.');
  return { intents, product_id: product?.id || null, facts, analysis, recommendations: recs, insufficient };
}

async function llmWording(question, facts) {
  const apiKey = process.env.SHOP_POS_AI_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey || !facts.length) return null;
  const prompt = `You are a food cost analyst for a restaurant. Answer using ONLY the FACTS below (amounts in South African Rand).
Never invent costs, prices, sales or quantities. "Gross contribution" is selling price minus recipe cost and is NOT profit — never call it profit.
Never state the cause of a variance as fact. Recommendations are proposals only; never say a change has been made.
Return JSON: {"analysis": [string], "recommendations": [string]}

QUESTION: ${question}

FACTS:
${facts.map((f, i) => `${i + 1}. ${f.text}`).join('\n')}`;
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: process.env.SHOP_POS_AI_MODEL || 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }], response_format: { type: 'json_object' }, temperature: 0.1 })
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error?.message || `AI API HTTP ${res.status}`);
  const c = parseJson(json.choices?.[0]?.message?.content, {});
  return { engine: `openai:${process.env.SHOP_POS_AI_MODEL || 'gpt-4o-mini'}`, analysis: (c.analysis || []).map(String).slice(0, 10), recommendations: (c.recommendations || []).map(String).slice(0, 8) };
}

async function aiAsk(question, f = {}, actor) {
  const user = requireCostAccess(actor);
  ensureSchema();
  const q = String(question || '').trim().slice(0, 500) || 'What should I review?';
  const branchId = scopeBranch(user, f.branch_id);
  const advice = buildAdvice(q, f.product_id ? Number(f.product_id) : null, branchId, user);
  let engine = 'rule_based'; let aiError = null;
  let analysis = advice.analysis; let recommendations = advice.recommendations;
  try {
    const llm = await llmWording(q, advice.facts);
    if (llm) {
      engine = llm.engine;
      if (llm.analysis.length) analysis = llm.analysis;
      if (llm.recommendations.length) recommendations = llm.recommendations.map((text) => ({ text }));
    }
  } catch (err) { aiError = `AI service unavailable (${err.message}) — showing rule-based analysis.`; }
  const r = run('INSERT INTO rfc_ai_log (question, product_id, engine, facts_json, analysis_json, recommendations_json, insufficient_json, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    [q, advice.product_id, engine, JSON.stringify(advice.facts), JSON.stringify(analysis), JSON.stringify(recommendations), JSON.stringify(advice.insufficient), user.id, nowSql()]);
  const id = insertId(r, 'rfc_ai_log');
  logActivity(user, 'food_cost_ai_question', 'recipe_food_cost_ai', id, { question: q, engine, facts: advice.facts.length });
  return {
    id, question: q, engine, product_id: advice.product_id, intents: advice.intents,
    engine_note: engine === 'rule_based' ? (aiError || 'Rule-based analysis (no AI model configured — set SHOP_POS_AI_API_KEY on the server for AI wording). FACTS are identical either way.') : 'AI wording over system facts. FACTS come from the database, not the AI.',
    facts: advice.facts, analysis, recommendations, insufficient: advice.insufficient,
    approval_note: 'Nothing has been changed. Recipes, prices and stock are only changed by a person in the normal screens.'
  };
}

function aiHistory(limit = 30, actor) {
  requireCostAccess(actor);
  ensureSchema();
  return all('SELECT * FROM rfc_ai_log ORDER BY id DESC LIMIT ?', [Math.min(200, Math.max(1, Number(limit) || 30))]).map((r) => ({
    id: Number(r.id), question: r.question, product_id: r.product_id == null ? null : Number(r.product_id), engine: r.engine, created_at: r.created_at,
    facts: parseJson(r.facts_json, []), analysis: parseJson(r.analysis_json, []), recommendations: parseJson(r.recommendations_json, []), insufficient: parseJson(r.insufficient_json, [])
  }));
}

function meta(actor) {
  const user = requireCostAccess(actor);
  const ctx = loadContext();
  return {
    user: { id: user.id, name: user.full_name || user.username, recipe_role: user.recipe_role, branch_id: user.branch_id ?? null },
    can_edit_targets: (() => { try { requireTargetsAccess(user); return true; } catch (_) { return false; } })(),
    products: [...ctx.products.values()].map((p) => ({ id: p.id, name: p.name, category: p.category })),
    ingredients: [...ctx.ings.values()].map((i) => ({ id: Number(i.id), name: i.name, stock_unit: stockUnitOf(i), unit_cost: num(i.buying_price) })),
    reports: Object.entries(REPORTS).map(([id, title]) => ({ id, title })),
    ai_engine: process.env.SHOP_POS_AI_API_KEY || process.env.OPENAI_API_KEY ? 'ai' : 'rule_based',
    pg: !!isPgMode()
  };
}

module.exports = {
  REPORTS, ensureSchema, normUnit, convertUnits, loadContext, costRecipe, allocationInfo,
  observeIngredientCosts, upsertSnapshot, refreshHistory, noteIngredientCostChange, periodRecipeCosts,
  meta, overview, costCard, salesPerformance, productionCalculator, whatIf, priceChanges, costHistory,
  variance, waste, alerts, getTargets, saveTargets, report, aiAsk, aiHistory, detectIntents
};

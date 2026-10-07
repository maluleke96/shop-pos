/**
 * Financial Intelligence Center — read-only analysis of the existing sales, sale items, payments,
 * returns, products, branches, expenses and employees. Configuration (allocation categories with
 * dated rates, planned positions, settings, report history) lives in additive fin_* tables.
 *
 * Day buckets use the same rule as the existing reports: date(COALESCE(sale_datetime, created_at), 'localtime')
 * with the shared sale-revenue status filter, so figures reconcile with Reports and the dashboard.
 * Money is summed unrounded and rounded to cents only when presented.
 */
const { getDb, isPgMode } = require('../database/db');

const ALL_ROLES = ['owner', 'manager', 'assistant_manager', 'supervisor'];
const KINDS = ['stock', 'salary', 'rent', 'utilities', 'operating', 'marketing', 'transport', 'maintenance', 'tax', 'owner', 'savings', 'other'];
const DISTRIBUTION_KINDS = new Set(['owner', 'savings']);
const FREQUENCIES = ['monthly', 'weekly', 'fortnightly', 'daily', 'hourly', 'annual'];
const REPORT_TYPES = {
  daily: 'Daily Financial Report',
  monthly: 'Monthly Financial Report',
  annual: 'Annual Financial Report',
  historical: 'Historical Financial Report',
  branch: 'Branch Financial Report',
  product: 'Product Performance Report',
  allocation: 'Cost Allocation Report',
  salary: 'Employee / Salary Report',
  breakeven: 'Break-Even Report',
  ai: 'AI Financial Analysis Report'
};
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DEFAULT_SETTINGS = {
  exclude_tax: false,
  exclude_delivery_fees: false,
  work_days_per_month: 26,
  hours_per_month: 195,
  fixed_expense_categories: ['rent', 'electricity', 'water', 'insurance', 'internet', 'security', 'telephone'],
  excluded_employee_ids: [],
  min_cost_coverage_pct: 80,
  break_even_months: 3
};

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const money = (v) => Math.round((num(v) + Number.EPSILON) * 100) / 100;
const pct1 = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

let _schemaReady = false;

function run(sql, params = []) { return getDb().prepare(sql).run(...params); }
function get(sql, params = []) { return getDb().prepare(sql).get(...params) || null; }
function all(sql, params = []) { return getDb().prepare(sql).all(...params) || []; }
function tryAll(sql, params = []) { try { return all(sql, params); } catch (_) { return null; } }
function tryRun(sql) {
  try { run(sql); return true; } catch (err) {
    if (!/already exists|duplicate column/i.test(String(err.message || err))) console.warn('[financial] schema:', String(err.message || err).slice(0, 160));
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

/** Normalise a DB date value (text, or a Postgres Date) to YYYY-MM-DD. */
function normDay(v) {
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  const m = String(v || '').match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}
const isYmd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

/** "Today" under the same timezone the SQL day buckets use. */
function todayYmd() {
  const tz = isPgMode() ? (process.env.SHOP_TIMEZONE || 'Africa/Johannesburg') : undefined;
  return new Date().toLocaleDateString('en-CA', tz ? { timeZone: tz } : undefined);
}
function ymdToUtc(ymd) { const [y, m, d] = ymd.split('-').map(Number); return Date.UTC(y, m - 1, d); }
function utcToYmd(ms) { return new Date(ms).toISOString().slice(0, 10); }
function addDays(ymd, n) { return utcToYmd(ymdToUtc(ymd) + n * 86400000); }
function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
function dayCount(from, to) { return Math.round((ymdToUtc(to) - ymdToUtc(from)) / 86400000) + 1; }
function dowOf(ymd) { return new Date(ymdToUtc(ymd)).getUTCDay(); }

/** Resolve a preset or custom range to inclusive YYYY-MM-DD bounds. */
function resolveRange(f = {}) {
  const today = todayYmd();
  const [ty, tm] = today.split('-').map(Number);
  const preset = String(f.preset || '').toLowerCase();
  const monday = (ymd) => addDays(ymd, -((dowOf(ymd) + 6) % 7));
  const r = (from, to, label) => ({ from, to, label, preset: preset || 'custom' });
  switch (preset) {
    case 'today': return r(today, today, 'Today');
    case 'yesterday': { const y = addDays(today, -1); return r(y, y, 'Yesterday'); }
    case 'this_week': return r(monday(today), today, 'This week');
    case 'last_week': { const s = addDays(monday(today), -7); return r(s, addDays(s, 6), 'Last week'); }
    case 'this_month': return r(`${today.slice(0, 7)}-01`, today, 'This month');
    case 'last_month': {
      const y = tm === 1 ? ty - 1 : ty; const m = tm === 1 ? 12 : tm - 1;
      const mm = String(m).padStart(2, '0');
      return r(`${y}-${mm}-01`, `${y}-${mm}-${String(daysInMonth(y, m)).padStart(2, '0')}`, 'Last month');
    }
    case 'this_year': return r(`${ty}-01-01`, today, 'This year');
    case 'last_year': return r(`${ty - 1}-01-01`, `${ty - 1}-12-31`, 'Last year');
    default: break;
  }
  const from = isYmd(f.from) ? f.from : (isYmd(f.date) ? f.date : today);
  let to = isYmd(f.to) ? f.to : from;
  if (to < from) to = from;
  if (dayCount(from, to) > 3700) throw new Error('Date range is too long (maximum about 10 years)');
  return { from, to, label: from === to ? from : `${from} to ${to}`, preset: 'custom' };
}

/* ─────────────────────────── Schema ─────────────────────────── */

function ensureSchema() {
  if (_schemaReady) return;
  tryRun(`CREATE TABLE IF NOT EXISTS fin_allocation_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    kind TEXT DEFAULT 'other',
    branch_id INTEGER,
    is_active INTEGER DEFAULT 1,
    notes TEXT,
    sort_order INTEGER DEFAULT 0,
    created_by INTEGER,
    created_at TEXT,
    updated_at TEXT
  )`);
  tryRun(`CREATE TABLE IF NOT EXISTS fin_allocation_rates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL,
    pct REAL NOT NULL DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    effective_from TEXT NOT NULL,
    note TEXT,
    created_by INTEGER,
    created_at TEXT
  )`);
  tryRun('CREATE INDEX IF NOT EXISTS idx_fin_rates_cat ON fin_allocation_rates(category_id, effective_from)');
  tryRun(`CREATE TABLE IF NOT EXISTS fin_planned_workers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    role TEXT,
    salary REAL NOT NULL DEFAULT 0,
    frequency TEXT DEFAULT 'monthly',
    branch_id INTEGER,
    is_active INTEGER DEFAULT 1,
    notes TEXT,
    created_by INTEGER,
    created_at TEXT,
    updated_at TEXT
  )`);
  tryRun(`CREATE TABLE IF NOT EXISTS fin_settings (
    id INTEGER PRIMARY KEY,
    settings_json TEXT,
    updated_by INTEGER,
    updated_at TEXT
  )`);
  tryRun(`CREATE TABLE IF NOT EXISTS fin_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reference TEXT,
    report_type TEXT NOT NULL,
    title TEXT,
    period_from TEXT,
    period_to TEXT,
    branch_id INTEGER,
    filters_json TEXT,
    snapshot_json TEXT,
    generated_by INTEGER,
    generated_by_name TEXT,
    export_count INTEGER DEFAULT 0,
    last_export_format TEXT,
    created_at TEXT
  )`);
  tryRun('CREATE INDEX IF NOT EXISTS idx_fin_reports_created ON fin_reports(created_at)');
  tryRun(`CREATE TABLE IF NOT EXISTS fin_ai_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question TEXT,
    engine TEXT,
    facts_json TEXT,
    analysis_json TEXT,
    recommendations_json TEXT,
    status TEXT DEFAULT 'generated',
    created_by INTEGER,
    created_at TEXT,
    decided_by INTEGER,
    decided_at TEXT
  )`);
  _schemaReady = true;
}

/* ─────────────────────────── Access, audit ─────────────────────────── */

function requirePerm(actor, key) {
  return require('./authz').assertUserPermission(actor, key, ALL_ROLES);
}

/** Branch-locked staff only ever see their own branch. */
function scopeBranch(actor, branchId) {
  const want = branchId != null && branchId !== '' && branchId !== 'all' ? Number(branchId) : null;
  try {
    const locked = require('./branches').resolveBranchScope(actor, {});
    if (locked && actor?.role !== 'owner' && !locked.allBranches && locked.branchId != null) return Number(locked.branchId);
  } catch (_) { /* optional */ }
  return want;
}

function audit(actor, action, entityType, entityId, details = {}) {
  try {
    run('INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, details) VALUES (?,?,?,?,?,?)', [
      actor?.id || null, actor?.full_name || actor?.username || 'system', action, entityType, entityId || null, JSON.stringify(details || {})
    ]);
  } catch (err) { console.warn('[financial] audit:', err.message); }
}

function listAudit(limit = 200, actor) {
  requirePerm(actor, 'fin_view');
  return all(`SELECT id, user_id, username, action, entity_type, entity_id, details, created_at FROM audit_log
    WHERE entity_type LIKE 'financial%' ORDER BY id DESC LIMIT ?`, [Math.min(500, Math.max(1, Number(limit) || 200))])
    .map((r) => ({ ...r, details: parseJson(r.details, {}) }));
}

/* ─────────────────────────── Settings ─────────────────────────── */

function getSettings() {
  ensureSchema();
  const saved = parseJson(get('SELECT settings_json FROM fin_settings WHERE id = 1')?.settings_json, {});
  return { ...DEFAULT_SETTINGS, ...saved };
}

function saveSettings(d = {}, actor) {
  const user = requirePerm(actor, 'fin_manage');
  ensureSchema();
  const before = getSettings();
  const next = { ...before };
  if (d.exclude_tax != null) next.exclude_tax = !!d.exclude_tax;
  if (d.exclude_delivery_fees != null) next.exclude_delivery_fees = !!d.exclude_delivery_fees;
  const bounded = (k, lo, hi) => {
    if (d[k] == null || d[k] === '') return;
    const v = Number(d[k]);
    if (!Number.isFinite(v) || v < lo || v > hi) throw new Error(`${k.replace(/_/g, ' ')} must be between ${lo} and ${hi}`);
    next[k] = v;
  };
  bounded('work_days_per_month', 1, 31);
  bounded('hours_per_month', 1, 744);
  bounded('min_cost_coverage_pct', 0, 100);
  bounded('break_even_months', 1, 12);
  if (Array.isArray(d.fixed_expense_categories)) next.fixed_expense_categories = d.fixed_expense_categories.map((s) => String(s).trim().toLowerCase()).filter(Boolean).slice(0, 50);
  if (Array.isArray(d.excluded_employee_ids)) next.excluded_employee_ids = [...new Set(d.excluded_employee_ids.map(Number).filter(Boolean))];
  const json = JSON.stringify(next);
  if (get('SELECT id FROM fin_settings WHERE id = 1')) run('UPDATE fin_settings SET settings_json = ?, updated_by = ?, updated_at = ? WHERE id = 1', [json, user.id, nowSql()]);
  else run('INSERT INTO fin_settings (id, settings_json, updated_by, updated_at) VALUES (1, ?, ?, ?)', [json, user.id, nowSql()]);
  audit(user, 'financial_settings_updated', 'financial_settings', 1, { before, after: next });
  return next;
}

/* ─────────────────────────── Company / branches ─────────────────────────── */

function companyInfo(branchId) {
  let s = {};
  try { s = require('./store').getSettings() || {}; } catch (_) { s = get('SELECT * FROM shop_settings WHERE id = 1') || {}; }
  const b = branchId ? (tryAll('SELECT * FROM branches WHERE id = ?', [branchId]) || [])[0] : null;
  return {
    name: s.shop_name || s.app_display_name || '',
    logo_path: s.logo_path || '',
    address: s.address || '',
    phone: s.phone || '',
    email: s.email || '',
    website: s.website || '',
    vat_number: s.vat_number || '',
    registration_number: s.registration_number || s.company_registration || '',
    currency: s.currency || 'R',
    currency_name: s.currency_name || '',
    branch: b ? { id: b.id, name: b.name || '', address: b.address || '', phone: b.phone || '' } : null
  };
}

function listBranches() {
  return (tryAll('SELECT id, name, code, address, phone, is_active FROM branches ORDER BY id') || []).map((b) => ({ ...b, id: Number(b.id) }));
}

/* ─────────────────────────── Allocation categories ─────────────────────────── */

function listCategories() {
  ensureSchema();
  const cats = all('SELECT * FROM fin_allocation_categories ORDER BY sort_order, id');
  const rates = all('SELECT * FROM fin_allocation_rates ORDER BY category_id, effective_from, id');
  const today = todayYmd();
  const byCat = new Map();
  for (const r of rates) {
    const k = Number(r.category_id);
    if (!byCat.has(k)) byCat.set(k, []);
    byCat.get(k).push({ id: Number(r.id), pct: num(r.pct), is_active: Number(r.is_active) !== 0, effective_from: normDay(r.effective_from), note: r.note || null, created_at: r.created_at });
  }
  return cats.map((c) => {
    const hist = byCat.get(Number(c.id)) || [];
    const current = rateAt(hist, today);
    const upcoming = hist.filter((h) => h.effective_from > today);
    return {
      id: Number(c.id), name: c.name, description: c.description || '', kind: c.kind || 'other', branch_id: c.branch_id == null ? null : Number(c.branch_id),
      is_active: Number(c.is_active) !== 0, notes: c.notes || '', sort_order: Number(c.sort_order || 0),
      current_pct: current ? (current.is_active ? current.pct : 0) : 0,
      effective_from: hist.length ? hist[0].effective_from : null,
      current_effective_from: current ? current.effective_from : null,
      upcoming, history: hist, created_at: c.created_at, updated_at: c.updated_at
    };
  });
}

/** Latest rate whose effective date is on or before `ymd`. */
function rateAt(hist, ymd) {
  let found = null;
  for (const h of hist) { if (h.effective_from <= ymd) found = h; else break; }
  return found;
}

function validateTotals(cats, ymd) {
  const at = ymd || todayYmd();
  const active = cats.map((c) => ({ c, r: rateAt(c.history, at) })).filter(({ r }) => r && r.is_active && r.pct > 0);
  const scopes = [{ branch_id: null, name: 'All branches' }];
  const branchIds = [...new Set(active.map(({ c }) => c.branch_id).filter((b) => b != null))];
  for (const b of branchIds) scopes.push({ branch_id: b, name: listBranches().find((x) => x.id === b)?.name || `Branch #${b}` });
  return scopes.map((s) => {
    const total = active.filter(({ c }) => c.branch_id == null || c.branch_id === s.branch_id).reduce((a, { r }) => a + r.pct, 0);
    const t = Math.round(total * 10000) / 10000;
    return {
      branch_id: s.branch_id, scope: s.name, total_pct: t, unallocated_pct: Math.round((100 - t) * 10000) / 10000,
      exceeds: t > 100,
      message: t > 100 ? 'Allocation percentages exceed 100%. Please review your configuration.'
        : t < 100 ? `${Math.round((100 - t) * 100) / 100}% of the allocation base is not allocated (shown as Unallocated Amount).` : 'Allocations total exactly 100%.'
    };
  });
}

function cleanPct(v) {
  const p = Number(v);
  if (!Number.isFinite(p) || p < 0 || p > 100) throw new Error('Percentage must be between 0 and 100');
  return Math.round(p * 10000) / 10000;
}

function saveCategory(d = {}, actor) {
  const user = requirePerm(actor, 'fin_manage');
  ensureSchema();
  const name = String(d.name || '').trim();
  if (!name) throw new Error('Category name is required');
  const kind = KINDS.includes(d.kind) ? d.kind : 'other';
  const branchId = d.branch_id != null && d.branch_id !== '' && d.branch_id !== 'all' ? Number(d.branch_id) : null;
  if (branchId && !listBranches().some((b) => b.id === branchId)) throw new Error('Branch not found');
  const fields = [name.slice(0, 80), String(d.description || '').slice(0, 300) || null, kind, branchId, String(d.notes || '').slice(0, 500) || null, Number(d.sort_order) || 0];
  if (d.id) {
    const id = Number(d.id);
    const before = get('SELECT * FROM fin_allocation_categories WHERE id = ?', [id]);
    if (!before) throw new Error('Category not found');
    run('UPDATE fin_allocation_categories SET name = ?, description = ?, kind = ?, branch_id = ?, notes = ?, sort_order = ?, updated_at = ? WHERE id = ?', [...fields, nowSql(), id]);
    audit(user, 'financial_category_updated', 'financial_allocation_category', id, { before, after: { name: fields[0], description: fields[1], kind, branch_id: branchId, notes: fields[4] } });
    if (d.pct != null && d.pct !== '') setRate(id, { pct: d.pct, effective_from: d.effective_from, note: d.rate_note }, user);
    return listCategories().find((c) => c.id === id);
  }
  const pct = cleanPct(d.pct ?? 0);
  const eff = isYmd(d.effective_from) ? d.effective_from : todayYmd();
  const r = run('INSERT INTO fin_allocation_categories (name, description, kind, branch_id, notes, sort_order, is_active, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,1,?,?,?)',
    [...fields, user.id, nowSql(), nowSql()]);
  const id = insertId(r, 'fin_allocation_categories');
  run('INSERT INTO fin_allocation_rates (category_id, pct, is_active, effective_from, note, created_by, created_at) VALUES (?,?,1,?,?,?,?)', [id, pct, eff, 'created', user.id, nowSql()]);
  audit(user, 'financial_category_created', 'financial_allocation_category', id, { name: fields[0], kind, pct, effective_from: eff, branch_id: branchId });
  return listCategories().find((c) => c.id === id);
}

/**
 * Change a category's percentage from an effective date. History is kept so earlier periods
 * keep the percentage that applied to them; a rate on the same date is corrected in place.
 */
function setRate(categoryId, d = {}, actor, auditAction = 'financial_allocation_pct_changed') {
  const user = requirePerm(actor, 'fin_manage');
  ensureSchema();
  const id = Number(categoryId);
  const cat = get('SELECT * FROM fin_allocation_categories WHERE id = ?', [id]);
  if (!cat) throw new Error('Category not found');
  const pct = cleanPct(d.pct);
  const eff = isYmd(d.effective_from) ? d.effective_from : todayYmd();
  const hist = listCategories().find((c) => c.id === id)?.history || [];
  const before = rateAt(hist, eff);
  const active = Number(cat.is_active) !== 0 ? 1 : 0;
  const same = hist.find((h) => h.effective_from === eff);
  if (same) run('UPDATE fin_allocation_rates SET pct = ?, is_active = ?, note = ?, created_by = ?, created_at = ? WHERE id = ?', [pct, active, d.note || null, user.id, nowSql(), same.id]);
  else run('INSERT INTO fin_allocation_rates (category_id, pct, is_active, effective_from, note, created_by, created_at) VALUES (?,?,?,?,?,?,?)', [id, pct, active, eff, d.note || null, user.id, nowSql()]);
  run('UPDATE fin_allocation_categories SET updated_at = ? WHERE id = ?', [nowSql(), id]);
  audit(user, auditAction, 'financial_allocation_category', id, { name: cat.name, before: before ? { pct: before.pct, effective_from: before.effective_from } : null, after: { pct, effective_from: eff }, note: d.note || null });
  return listCategories().find((c) => c.id === id);
}

function setCategoryActive(categoryId, active, effectiveFrom, actor) {
  const user = requirePerm(actor, 'fin_manage');
  ensureSchema();
  const id = Number(categoryId);
  const cat = get('SELECT * FROM fin_allocation_categories WHERE id = ?', [id]);
  if (!cat) throw new Error('Category not found');
  const eff = isYmd(effectiveFrom) ? effectiveFrom : todayYmd();
  const hist = listCategories().find((c) => c.id === id)?.history || [];
  const last = rateAt(hist, eff) || hist[hist.length - 1] || { pct: 0 };
  const same = hist.find((h) => h.effective_from === eff);
  const flag = active ? 1 : 0;
  if (same) run('UPDATE fin_allocation_rates SET is_active = ?, created_by = ?, created_at = ? WHERE id = ?', [flag, user.id, nowSql(), same.id]);
  else run('INSERT INTO fin_allocation_rates (category_id, pct, is_active, effective_from, note, created_by, created_at) VALUES (?,?,?,?,?,?,?)', [id, num(last.pct), flag, eff, active ? 'activated' : 'deactivated', user.id, nowSql()]);
  run('UPDATE fin_allocation_categories SET is_active = ?, updated_at = ? WHERE id = ?', [flag, nowSql(), id]);
  audit(user, active ? 'financial_category_activated' : 'financial_category_deactivated', 'financial_allocation_category', id, { name: cat.name, effective_from: eff, pct: num(last.pct) });
  return listCategories().find((c) => c.id === id);
}

function deleteRate(rateId, actor) {
  const user = requirePerm(actor, 'fin_manage');
  ensureSchema();
  const r = get('SELECT * FROM fin_allocation_rates WHERE id = ?', [Number(rateId)]);
  if (!r) throw new Error('Rate not found');
  const count = Number(get('SELECT COUNT(*) AS n FROM fin_allocation_rates WHERE category_id = ?', [r.category_id])?.n || 0);
  if (count <= 1) throw new Error('A category needs at least one rate — deactivate the category instead');
  if (normDay(r.effective_from) <= todayYmd()) throw new Error('Only future-dated rate changes can be removed; past rates keep historical reports reproducible');
  run('DELETE FROM fin_allocation_rates WHERE id = ?', [r.id]);
  audit(user, 'financial_allocation_rate_removed', 'financial_allocation_category', Number(r.category_id), { rate: { pct: num(r.pct), effective_from: normDay(r.effective_from) } });
  return { removed: true };
}

/* ─────────────────────────── Aggregation (database) ─────────────────────────── */

function revenueStatusSql() {
  try { return require('./store').getSaleRevenueStatusesSql('s'); } catch (_) { return "s.status IN ('completed', 'partial_return')"; }
}
const SALE_DAY = "strftime('%Y-%m-%d', COALESCE(s.sale_datetime, s.created_at), 'localtime')";

function columnExists(table, col) {
  try { getDb().prepare(`SELECT ${col} FROM ${table} WHERE 1=0`).all(); return true; } catch (_) { return false; }
}

/**
 * Per (day, branch) sales, refunds, items and expenses for an inclusive date range.
 * One aggregate query per source — the frontend never receives raw sale rows here.
 */
function aggregate(from, to, branchId) {
  const bsql = branchId ? ' AND COALESCE(s.branch_id, 1) = ?' : '';
  const bp = branchId ? [branchId] : [];
  const hasDelivery = columnExists('sales', 'delivery_fee');
  const sales = all(`SELECT ${SALE_DAY} AS day, COALESCE(s.branch_id, 1) AS branch_id, COUNT(*) AS orders,
      SUM(s.total) AS gross, SUM(COALESCE(s.discount, 0)) AS discount, SUM(COALESCE(s.tax_amount, 0)) AS tax,
      ${hasDelivery ? 'SUM(COALESCE(s.delivery_fee, 0))' : '0'} AS delivery
    FROM sales s WHERE ${SALE_DAY} BETWEEN ? AND ? AND ${revenueStatusSql()}${bsql}
    GROUP BY 1, 2`, [from, to, ...bp]);
  const items = all(`SELECT ${SALE_DAY} AS day, COALESCE(s.branch_id, 1) AS branch_id, SUM(si.quantity) AS qty,
      SUM(si.total) AS item_revenue, SUM(COALESCE(si.buying_price, 0) * si.quantity) AS cost,
      SUM(CASE WHEN COALESCE(si.buying_price, 0) > 0 THEN si.total ELSE 0 END) AS costed_revenue
    FROM sale_items si JOIN sales s ON s.id = si.sale_id
    WHERE ${SALE_DAY} BETWEEN ? AND ? AND ${revenueStatusSql()}${bsql}
    GROUP BY 1, 2`, [from, to, ...bp]);
  const refundDay = "strftime('%Y-%m-%d', r.created_at, 'localtime')";
  const refundSql = (withStatus) => `SELECT ${refundDay} AS day, COALESCE(s.branch_id, 1) AS branch_id, SUM(r.total_refund) AS refunds, COUNT(*) AS n
    FROM returns r LEFT JOIN sales s ON s.id = r.sale_id
    WHERE ${refundDay} BETWEEN ? AND ?${withStatus ? " AND r.status IN ('completed','reopened')" : ''}${bsql}
    GROUP BY 1, 2`;
  const refunds = tryAll(refundSql(true), [from, to, ...bp]) || tryAll(refundSql(false), [from, to, ...bp]) || [];
  const hasExpBranch = columnExists('expenses', 'branch_id');
  const expenses = tryAll(`SELECT expense_date AS day, ${hasExpBranch ? 'branch_id' : 'NULL AS branch_id'}, category, SUM(amount) AS amount, COUNT(*) AS n
    FROM expenses WHERE expense_date BETWEEN ? AND ?${branchId && hasExpBranch ? ' AND branch_id = ?' : ''}
    GROUP BY expense_date, ${hasExpBranch ? 'branch_id, ' : ''}category`, [from, to, ...(branchId && hasExpBranch ? [branchId] : [])]) || [];

  const cells = new Map();
  const cell = (day, b) => {
    const k = `${day}|${b}`;
    if (!cells.has(k)) cells.set(k, { day, branch_id: b, orders: 0, gross: 0, discount: 0, tax: 0, delivery: 0, refunds: 0, refund_count: 0, qty: 0, item_revenue: 0, cost: 0, costed_revenue: 0 });
    return cells.get(k);
  };
  for (const r of sales) { const d = normDay(r.day); if (!d) continue; const c = cell(d, Number(r.branch_id) || 1); c.orders += num(r.orders); c.gross += num(r.gross); c.discount += num(r.discount); c.tax += num(r.tax); c.delivery += num(r.delivery); }
  for (const r of items) { const d = normDay(r.day); if (!d) continue; const c = cell(d, Number(r.branch_id) || 1); c.qty += num(r.qty); c.item_revenue += num(r.item_revenue); c.cost += num(r.cost); c.costed_revenue += num(r.costed_revenue); }
  for (const r of refunds) { const d = normDay(r.day); if (!d) continue; const c = cell(d, Number(r.branch_id) || 1); c.refunds += num(r.refunds); c.refund_count += num(r.n); }
  const exp = expenses.map((e) => ({ day: normDay(e.day), branch_id: e.branch_id == null ? null : Number(e.branch_id), category: String(e.category || 'other').toLowerCase(), amount: num(e.amount), n: num(e.n) })).filter((e) => e.day);
  return { cells: [...cells.values()], expenses: exp };
}

/** Load categories with rate history once per computation. */
function allocationModel() {
  const cats = listCategories();
  return { cats, applicable: (branchId) => cats.filter((c) => c.branch_id == null || c.branch_id === branchId) };
}

function baseOf(c, settings) {
  let b = c.gross - c.refunds;
  if (settings.exclude_tax) b -= c.tax;
  if (settings.exclude_delivery_fees) b -= c.delivery;
  return b;
}

/** Summarise a set of cells: revenue, quantities, allocations (per day/branch rate), actual costs. */
function summarize(cells, expenses, model, settings) {
  const t = { orders: 0, gross: 0, discount: 0, tax: 0, delivery: 0, refunds: 0, refund_count: 0, qty: 0, item_revenue: 0, cost: 0, costed_revenue: 0, base: 0 };
  const alloc = new Map(model.cats.map((c) => [c.id, 0]));
  for (const c of cells) {
    for (const k of ['orders', 'gross', 'discount', 'tax', 'delivery', 'refunds', 'refund_count', 'qty', 'item_revenue', 'cost', 'costed_revenue']) t[k] += c[k];
    const base = baseOf(c, settings);
    t.base += base;
    for (const cat of model.applicable(c.branch_id)) {
      const r = rateAt(cat.history, c.day);
      if (r && r.is_active && r.pct > 0) alloc.set(cat.id, alloc.get(cat.id) + (base * r.pct) / 100);
    }
  }
  const allocations = model.cats.map((c) => ({ id: c.id, name: c.name, kind: c.kind, branch_id: c.branch_id, amount: money(alloc.get(c.id)), effective_pct: t.base > 0 ? Math.round((alloc.get(c.id) / t.base) * 100000) / 1000 : null }))
    .filter((a) => a.amount !== 0 || model.cats.find((c) => c.id === a.id)?.is_active);
  const rawCost = model.cats.filter((c) => !DISTRIBUTION_KINDS.has(c.kind)).reduce((a, c) => a + alloc.get(c.id), 0);
  const rawOwner = model.cats.filter((c) => c.kind === 'owner').reduce((a, c) => a + alloc.get(c.id), 0);
  const rawSavings = model.cats.filter((c) => c.kind === 'savings').reduce((a, c) => a + alloc.get(c.id), 0);
  const rawAll = [...alloc.values()].reduce((a, v) => a + v, 0);
  const expTotal = expenses.reduce((a, e) => a + e.amount, 0);
  const expByCat = new Map();
  for (const e of expenses) expByCat.set(e.category, (expByCat.get(e.category) || 0) + e.amount);
  const netSales = t.gross - t.refunds;
  return {
    orders: t.orders, quantity: Math.round(t.qty * 1000) / 1000,
    gross_sales: money(t.gross), discounts: money(t.discount), refunds: money(t.refunds), refund_count: t.refund_count,
    tax: money(t.tax), delivery_fees: money(t.delivery), net_sales: money(netSales),
    allocation_base: money(t.base), average_order: t.orders ? money(t.gross / t.orders) : null,
    average_item_price: t.qty > 0 ? money(t.item_revenue / t.qty) : null,
    allocations, allocated_costs: money(rawCost), owner_allocation: money(rawOwner), savings_allocation: money(rawSavings),
    total_allocated: money(rawAll), unallocated: money(t.base - rawAll),
    operating_contribution: money(t.base - rawCost),
    actual: {
      recorded_stock_cost: money(t.cost),
      stock_cost_coverage_pct: t.item_revenue > 0 ? pct1(t.costed_revenue, t.item_revenue) : null,
      expenses: money(expTotal),
      expenses_by_category: [...expByCat.entries()].map(([category, amount]) => ({ category, amount: money(amount) })).sort((a, b) => b.amount - a.amount),
      net_sales_less_recorded_costs: money(netSales - t.cost - expTotal)
    },
    has_data: t.orders > 0 || t.refunds > 0 || expTotal > 0
  };
}

function compute(from, to, branchId) {
  const settings = getSettings();
  const model = allocationModel();
  const agg = aggregate(from, to, branchId);
  return { settings, model, agg };
}

const filterExp = (expenses, pred) => expenses.filter(pred);

/* ─────────────────────────── Views ─────────────────────────── */

function periodSummary(f = {}, actor) {
  const user = requirePerm(actor, 'fin_view');
  const range = resolveRange(f);
  const branchId = scopeBranch(user, f.branch_id);
  const { settings, model, agg } = compute(range.from, range.to, branchId);
  return { range, branch_id: branchId, summary: summarize(agg.cells, agg.expenses, model, settings), validation: validateTotals(model.cats, range.to) };
}

function productRows(from, to, branchId, totalSummary) {
  const bsql = branchId ? ' AND COALESCE(s.branch_id, 1) = ?' : '';
  const rows = all(`SELECT si.product_id AS product_id, MAX(si.product_name) AS name, SUM(si.quantity) AS qty, SUM(si.total) AS revenue,
      SUM(COALESCE(si.buying_price, 0) * si.quantity) AS cost, SUM(CASE WHEN COALESCE(si.buying_price, 0) > 0 THEN si.quantity ELSE 0 END) AS costed_qty,
      COUNT(DISTINCT si.sale_id) AS orders
    FROM sale_items si JOIN sales s ON s.id = si.sale_id
    WHERE ${SALE_DAY} BETWEEN ? AND ? AND ${revenueStatusSql()}${bsql}
    GROUP BY si.product_id`, [from, to, ...(branchId ? [branchId] : [])]);
  const prods = new Map((tryAll('SELECT id, name, selling_price, buying_price, is_active FROM products') || []).map((p) => [Number(p.id), p]));
  const itemRevenue = rows.reduce((a, r) => a + num(r.revenue), 0);
  const base = totalSummary.allocation_base;
  // Each category's allocated total is shared across products by their share of item revenue.
  const shares = (totalSummary.allocations || []).filter((a) => a.amount);
  return rows.map((r) => {
    const p = prods.get(Number(r.product_id));
    const revenue = num(r.revenue);
    const share = itemRevenue > 0 ? revenue / itemRevenue : 0;
    const alloc = shares.map((a) => ({ id: a.id, name: a.name, kind: a.kind, amount: money(a.amount * share) }));
    const costAlloc = alloc.filter((a) => !DISTRIBUTION_KINDS.has(a.kind)).reduce((s, a) => s + a.amount, 0);
    const byKind = (k) => money(alloc.filter((a) => a.kind === k).reduce((s, a) => s + a.amount, 0));
    const fullCost = num(r.costed_qty) >= num(r.qty) && num(r.qty) > 0;
    return {
      product_id: r.product_id == null ? null : Number(r.product_id), name: r.name || p?.name || 'Unknown item',
      price: p ? money(p.selling_price) : (num(r.qty) ? money(revenue / num(r.qty)) : null), price_source: p ? 'catalogue' : 'average sold',
      quantity: Math.round(num(r.qty) * 1000) / 1000, orders: num(r.orders), revenue: money(revenue), revenue_share_pct: pct1(revenue, itemRevenue),
      allocated_stock: byKind('stock'), allocated_salary: byKind('salary'), allocated_rent: byKind('rent'),
      allocated_other: money(costAlloc - byKind('stock') - byKind('salary') - byKind('rent')),
      allocations: alloc, allocated_costs: money(costAlloc), contribution: money(revenue - costAlloc),
      recorded_stock_cost: fullCost ? money(r.cost) : null,
      gross_margin: fullCost ? money(revenue - num(r.cost)) : null,
      cost_note: fullCost ? null : 'Recorded stock cost missing on some sales'
    };
  }).sort((a, b) => b.revenue - a.revenue).map((x) => ({ ...x, base_note: base !== itemRevenue ? 'Allocations shared by item revenue share' : null }));
}

function paymentRows(from, to, branchId) {
  const bsql = branchId ? ' AND COALESCE(s.branch_id, 1) = ?' : '';
  return (tryAll(`SELECT sp.payment_type AS method, SUM(sp.amount) AS amount, COUNT(DISTINCT sp.sale_id) AS orders
    FROM sale_payments sp JOIN sales s ON s.id = sp.sale_id
    WHERE ${SALE_DAY} BETWEEN ? AND ? AND ${revenueStatusSql()}${bsql}
    GROUP BY sp.payment_type ORDER BY 2 DESC`, [from, to, ...(branchId ? [branchId] : [])]) || [])
    .map((r) => ({ method: r.method || 'other', amount: money(r.amount), orders: num(r.orders) }));
}

function branchRows(agg, model, settings, branchFilter) {
  const branches = listBranches();
  const ids = [...new Set(agg.cells.map((c) => c.branch_id))];
  for (const b of branches) if (!ids.includes(b.id) && (!branchFilter || b.id === branchFilter)) ids.push(b.id);
  return ids.sort((a, b) => a - b).map((id) => {
    const s = summarize(agg.cells.filter((c) => c.branch_id === id), filterExp(agg.expenses, (e) => e.branch_id === id), model, settings);
    return { branch_id: id, branch: branches.find((b) => b.id === id)?.name || `Branch #${id}`, ...s };
  });
}

function daily(f = {}, actor) {
  const user = requirePerm(actor, 'fin_view');
  const range = resolveRange({ preset: f.preset || (f.date ? 'custom' : 'today'), from: f.date || f.from, to: f.date || f.to || f.from });
  const branchId = scopeBranch(user, f.branch_id);
  const { settings, model, agg } = compute(range.from, range.to, branchId);
  const summary = summarize(agg.cells, agg.expenses, model, settings);
  return {
    range, branch_id: branchId, summary,
    products: productRows(range.from, range.to, branchId, summary).slice(0, 20),
    payments: paymentRows(range.from, range.to, branchId),
    branches: branchRows(agg, model, settings, branchId),
    validation: validateTotals(model.cats, range.to),
    empty_message: summary.orders ? null : 'NO DATA AVAILABLE FOR THIS PERIOD'
  };
}

function monthly(f = {}, actor) {
  const user = requirePerm(actor, 'fin_view');
  const [ty, tm] = todayYmd().split('-').map(Number);
  const y = Number(f.year) || ty; const m = Number(f.month) || tm;
  if (m < 1 || m > 12) throw new Error('Month must be 1-12');
  const mm = String(m).padStart(2, '0');
  const n = daysInMonth(y, m);
  const from = `${y}-${mm}-01`; const to = `${y}-${mm}-${String(n).padStart(2, '0')}`;
  const branchId = scopeBranch(user, f.branch_id);
  const { settings, model, agg } = compute(from, to, branchId);
  const days = [];
  for (let d = 1; d <= n; d += 1) {
    const day = `${y}-${mm}-${String(d).padStart(2, '0')}`;
    const s = summarize(agg.cells.filter((c) => c.day === day), filterExp(agg.expenses, (e) => e.day === day), model, settings);
    days.push({ date: day, day_name: DOW[dowOf(day)], ...pick(s), no_sales: s.orders === 0 });
  }
  const total = summarize(agg.cells, agg.expenses, model, settings);
  return { year: y, month: m, month_name: MONTHS[m - 1], days_in_month: n, from, to, branch_id: branchId, days, total, validation: validateTotals(model.cats, to) };
}

function pick(s) {
  return {
    orders: s.orders, quantity: s.quantity, gross_sales: s.gross_sales, refunds: s.refunds, net_sales: s.net_sales, allocation_base: s.allocation_base,
    allocated_costs: s.allocated_costs, operating_contribution: s.operating_contribution, owner_allocation: s.owner_allocation,
    unallocated: s.unallocated, recorded_stock_cost: s.actual.recorded_stock_cost, expenses: s.actual.expenses
  };
}

function annual(f = {}, actor) {
  const user = requirePerm(actor, 'fin_view');
  const y = Number(f.year) || Number(todayYmd().slice(0, 4));
  const branchId = scopeBranch(user, f.branch_id);
  const { settings, model, agg } = compute(`${y}-01-01`, `${y}-12-31`, branchId);
  const months = MONTHS.map((name, i) => {
    const prefix = `${y}-${String(i + 1).padStart(2, '0')}`;
    const s = summarize(agg.cells.filter((c) => c.day.startsWith(prefix)), filterExp(agg.expenses, (e) => e.day.startsWith(prefix)), model, settings);
    return { month: i + 1, month_name: name, ...pick(s), no_data: !s.has_data };
  });
  return { year: y, branch_id: branchId, months, total: summarize(agg.cells, agg.expenses, model, settings), validation: validateTotals(model.cats, `${y}-12-31`) };
}

function dataYears() {
  const r = get(`SELECT MIN(${SALE_DAY}) AS mn, MAX(${SALE_DAY}) AS mx FROM sales s WHERE ${revenueStatusSql()}`);
  const mn = normDay(r?.mn); const mx = normDay(r?.mx);
  if (!mn || !mx) return [];
  const out = [];
  for (let y = Number(mn.slice(0, 4)); y <= Number(mx.slice(0, 4)); y += 1) out.push(y);
  return out;
}

function history(f = {}, actor) {
  const user = requirePerm(actor, 'fin_view');
  const branchId = scopeBranch(user, f.branch_id);
  const years = dataYears();
  if (!years.length) return { branch_id: branchId, years: [], total: null, empty_message: 'NO DATA AVAILABLE — no completed sales recorded yet.' };
  const { settings, model, agg } = compute(`${years[0]}-01-01`, `${years[years.length - 1]}-12-31`, branchId);
  const rows = years.map((y) => {
    const s = summarize(agg.cells.filter((c) => c.day.startsWith(`${y}-`)), filterExp(agg.expenses, (e) => e.day.startsWith(`${y}-`)), model, settings);
    return { year: y, ...pick(s), no_data: !s.has_data };
  });
  return { branch_id: branchId, years: rows, total: summarize(agg.cells, agg.expenses, model, settings) };
}

function branchPerformance(f = {}, actor) {
  const user = requirePerm(actor, 'fin_view');
  const range = resolveRange(f.preset || f.from ? f : { preset: 'this_month' });
  const branchId = scopeBranch(user, f.branch_id);
  const { settings, model, agg } = compute(range.from, range.to, branchId);
  const rows = branchRows(agg, model, settings, branchId);
  return { range, branch_id: branchId, branches: rows, total: summarize(agg.cells, agg.expenses, model, settings), unassigned_expenses: money(agg.expenses.filter((e) => e.branch_id == null).reduce((a, e) => a + e.amount, 0)) };
}

function products(f = {}, actor) {
  const user = requirePerm(actor, 'fin_view');
  const range = resolveRange(f.preset || f.from ? f : { preset: 'this_month' });
  const branchId = scopeBranch(user, f.branch_id);
  const { settings, model, agg } = compute(range.from, range.to, branchId);
  const summary = summarize(agg.cells, agg.expenses, model, settings);
  const rows = productRows(range.from, range.to, branchId, summary);
  try {
    const recipe = require('./recipe-food-cost').periodRecipeCosts(range.from, range.to, branchId);
    for (const r of rows) {
      const rc = recipe.get(r.product_id);
      if (!rc) continue;
      r.recipe_cost = rc.fully_costed ? money(rc.recipe_cost) : null;
      r.recipe_contribution = rc.contribution == null ? null : money(rc.contribution);
      r.recipe_food_cost_pct = rc.food_cost_pct;
      r.recipe_cost_basis = rc.cost_basis;
    }
  } catch (err) { console.warn('[financial] recipe costs:', err.message); }
  const sold = new Set(rows.map((r) => r.product_id).filter(Boolean));
  const unsold = (tryAll('SELECT id, name, selling_price FROM products WHERE COALESCE(is_active, 1) = 1') || [])
    .filter((p) => !sold.has(Number(p.id))).map((p) => ({ product_id: Number(p.id), name: p.name, price: money(p.selling_price) })).slice(0, 200);
  return { range, branch_id: branchId, summary, products: rows, not_sold: unsold, note: 'Allocated amounts share each category\'s period total by the product\'s share of item revenue. Recorded stock cost is the buying price captured on each sale line.' };
}

/** Sales on one day (or range) for drill-down. Returns at most 500 rows. */
function salesList(f = {}, actor) {
  const user = requirePerm(actor, 'fin_view');
  const range = resolveRange({ from: f.date || f.from, to: f.date || f.to || f.from });
  const branchId = scopeBranch(user, f.branch_id);
  const rows = all(`SELECT s.id, s.receipt_number, COALESCE(s.sale_datetime, s.created_at) AS sold_at, s.total, s.discount, s.status, COALESCE(s.branch_id, 1) AS branch_id,
      (SELECT SUM(si.quantity) FROM sale_items si WHERE si.sale_id = s.id) AS qty
    FROM sales s WHERE ${SALE_DAY} BETWEEN ? AND ? AND ${revenueStatusSql()}${branchId ? ' AND COALESCE(s.branch_id, 1) = ?' : ''}
    ORDER BY COALESCE(s.sale_datetime, s.created_at) LIMIT 500`, [range.from, range.to, ...(branchId ? [branchId] : [])]);
  const branches = listBranches();
  return {
    range, branch_id: branchId,
    sales: rows.map((r) => ({ id: Number(r.id), receipt_number: r.receipt_number, sold_at: r.sold_at instanceof Date ? r.sold_at.toISOString() : String(r.sold_at), total: money(r.total), discount: money(r.discount), quantity: num(r.qty), status: r.status, branch: branches.find((b) => b.id === Number(r.branch_id))?.name || `#${r.branch_id}` })),
    truncated: rows.length >= 500
  };
}

function saleDetail(id, actor) {
  const user = requirePerm(actor, 'fin_view');
  const s = get('SELECT id, receipt_number, COALESCE(sale_datetime, created_at) AS sold_at, subtotal, discount, tax_amount, total, status, COALESCE(branch_id, 1) AS branch_id FROM sales WHERE id = ?', [Number(id)]);
  if (!s) throw new Error('Sale not found');
  const locked = scopeBranch(user, null);
  if (locked && Number(s.branch_id) !== locked) throw new Error('This sale belongs to another branch');
  const items = all('SELECT product_id, product_name, quantity, unit_price, total FROM sale_items WHERE sale_id = ? ORDER BY id', [s.id]);
  const payments = tryAll('SELECT payment_type, amount FROM sale_payments WHERE sale_id = ?', [s.id]) || [];
  return { ...s, sold_at: s.sold_at instanceof Date ? s.sold_at.toISOString() : String(s.sold_at), total: money(s.total), items: items.map((i) => ({ ...i, quantity: num(i.quantity), unit_price: money(i.unit_price), total: money(i.total) })), payments: payments.map((p) => ({ method: p.payment_type, amount: money(p.amount) })) };
}

/* ─────────────────────────── Employees & salaries ─────────────────────────── */

function monthlyEquivalent(amount, frequency, settings) {
  const f = String(frequency || 'monthly').toLowerCase();
  const a = num(amount);
  if (f.startsWith('week')) return { monthly: (a * 52) / 12, known: true };
  if (f.startsWith('fort') || f.startsWith('bi')) return { monthly: (a * 26) / 12, known: true };
  if (f.startsWith('dai') || f === 'day') return { monthly: a * settings.work_days_per_month, known: true };
  if (f.startsWith('hour')) return { monthly: a * settings.hours_per_month, known: true };
  if (f.startsWith('ann') || f.startsWith('year')) return { monthly: a / 12, known: true };
  return { monthly: a, known: f.startsWith('month') || f === '' };
}

function employeeRoster(branchId, settings) {
  const s = settings || getSettings();
  const hasBranchId = columnExists('employees', 'branch_id');
  const rows = tryAll(`SELECT id, full_name, position, status, salary_type, basic_salary, allowances, ${hasBranchId ? 'branch_id' : 'NULL AS branch_id'}, branch FROM employees ORDER BY full_name`) || [];
  const branches = listBranches();
  const excluded = new Set((s.excluded_employee_ids || []).map(Number));
  const employees = rows.map((e) => {
    const active = !e.status || /^active$/i.test(String(e.status));
    const bId = e.branch_id != null ? Number(e.branch_id) : (branches.find((b) => String(b.name || '').toLowerCase() === String(e.branch || '').toLowerCase())?.id ?? null);
    const pay = num(e.basic_salary) + num(e.allowances);
    const eq = monthlyEquivalent(pay, e.salary_type, s);
    return {
      source: 'employee', id: Number(e.id), name: e.full_name, role: e.position || '', status: e.status || 'Active', active,
      branch_id: bId, branch: branches.find((b) => b.id === bId)?.name || e.branch || '', frequency: e.salary_type || 'Monthly',
      salary: money(num(e.basic_salary)), allowances: money(num(e.allowances)), monthly_cost: money(eq.monthly), frequency_known: eq.known,
      included: active && !excluded.has(Number(e.id))
    };
  });
  const planned = all('SELECT * FROM fin_planned_workers ORDER BY id').map((p) => {
    const eq = monthlyEquivalent(p.salary, p.frequency, s);
    const bId = p.branch_id == null ? null : Number(p.branch_id);
    return {
      source: 'planned', id: Number(p.id), name: p.name, role: p.role || '', active: Number(p.is_active) !== 0, branch_id: bId,
      branch: branches.find((b) => b.id === bId)?.name || '', frequency: p.frequency || 'monthly', salary: money(p.salary), allowances: 0,
      monthly_cost: money(eq.monthly), frequency_known: eq.known, included: Number(p.is_active) !== 0, notes: p.notes || ''
    };
  });
  const inScope = (w) => !branchId || w.branch_id == null || w.branch_id === branchId;
  return { employees: employees.filter(inScope), planned: planned.filter(inScope) };
}

function savePlannedWorker(d = {}, actor) {
  const user = requirePerm(actor, 'fin_manage');
  ensureSchema();
  const name = String(d.name || '').trim();
  if (!name) throw new Error('Name or position title is required');
  const salary = Number(d.salary);
  if (!Number.isFinite(salary) || salary < 0) throw new Error('Salary must be zero or more');
  const freq = FREQUENCIES.includes(String(d.frequency || '').toLowerCase()) ? String(d.frequency).toLowerCase() : 'monthly';
  const branchId = d.branch_id != null && d.branch_id !== '' && d.branch_id !== 'all' ? Number(d.branch_id) : null;
  const vals = [name.slice(0, 80), String(d.role || '').slice(0, 80) || null, money(salary), freq, branchId, d.is_active === false || d.is_active === 0 ? 0 : 1, String(d.notes || '').slice(0, 300) || null];
  if (d.id) {
    const before = get('SELECT * FROM fin_planned_workers WHERE id = ?', [Number(d.id)]);
    if (!before) throw new Error('Planned worker not found');
    run('UPDATE fin_planned_workers SET name = ?, role = ?, salary = ?, frequency = ?, branch_id = ?, is_active = ?, notes = ?, updated_at = ? WHERE id = ?', [...vals, nowSql(), before.id]);
    audit(user, 'financial_planned_worker_updated', 'financial_planned_worker', before.id, { before, after: { name: vals[0], salary: vals[2], frequency: freq, branch_id: branchId, is_active: vals[5] } });
    return { id: Number(before.id) };
  }
  const r = run('INSERT INTO fin_planned_workers (name, role, salary, frequency, branch_id, is_active, notes, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)', [...vals, user.id, nowSql(), nowSql()]);
  const id = insertId(r, 'fin_planned_workers');
  audit(user, 'financial_planned_worker_created', 'financial_planned_worker', id, { name: vals[0], salary: vals[2], frequency: freq, branch_id: branchId });
  return { id };
}

function deletePlannedWorker(id, actor) {
  const user = requirePerm(actor, 'fin_manage');
  const before = get('SELECT * FROM fin_planned_workers WHERE id = ?', [Number(id)]);
  if (!before) throw new Error('Planned worker not found');
  run('DELETE FROM fin_planned_workers WHERE id = ?', [before.id]);
  audit(user, 'financial_planned_worker_deleted', 'financial_planned_worker', before.id, { before });
  return { deleted: true };
}

function setEmployeeIncluded(employeeId, included, actor) {
  const user = requirePerm(actor, 'fin_manage');
  const s = getSettings();
  const set = new Set((s.excluded_employee_ids || []).map(Number));
  if (included) set.delete(Number(employeeId)); else set.add(Number(employeeId));
  saveSettings({ excluded_employee_ids: [...set] }, user);
  audit(user, included ? 'financial_employee_included' : 'financial_employee_excluded', 'financial_settings', Number(employeeId), {});
  return { included: !!included };
}

/** Full calendar month → 1; otherwise days ÷ average month length. */
function monthsInRange(range) {
  const [y, m, d] = range.from.split('-').map(Number);
  if (d === 1 && range.to === `${y}-${String(m).padStart(2, '0')}-${String(daysInMonth(y, m)).padStart(2, '0')}`) return 1;
  return dayCount(range.from, range.to) / (365.25 / 12);
}

/**
 * Salary affordability for a period. `scenario` ({workers, salary, frequency}) replaces the roster
 * with a hypothetical requirement — used for "Can I afford N workers?".
 */
function affordability(f = {}, actor) {
  const user = requirePerm(actor, 'fin_salaries');
  const range = resolveRange(f.preset || f.from ? f : { preset: 'last_month' });
  const branchId = scopeBranch(user, f.branch_id);
  const { settings, model, agg } = compute(range.from, range.to, branchId);
  const summary = summarize(agg.cells, agg.expenses, model, settings);
  const roster = employeeRoster(branchId, settings);
  const workers = [...roster.employees, ...roster.planned].filter((w) => w.included);
  let monthlyRequired = workers.reduce((a, w) => a + w.monthly_cost, 0);
  let scenario = null;
  if (f.workers != null && f.salary != null && f.workers !== '' && f.salary !== '') {
    const n = Math.max(0, Math.floor(Number(f.workers)));
    const eq = monthlyEquivalent(Number(f.salary), f.frequency || 'monthly', settings);
    scenario = { workers: n, salary: money(f.salary), frequency: f.frequency || 'monthly', monthly_per_worker: money(eq.monthly) };
    monthlyRequired = n * eq.monthly;
  }
  const months = monthsInRange(range);
  const required = monthlyRequired * months;
  const salaryAlloc = summary.allocations.filter((a) => a.kind === 'salary').reduce((s, a) => s + a.amount, 0);
  const effPct = summary.allocation_base > 0 ? salaryAlloc / summary.allocation_base : 0;
  const diff = salaryAlloc - required;
  const shortfall = diff < 0 ? -diff : 0;
  const additionalRevenue = shortfall > 0 && effPct > 0 ? shortfall / effPct : (shortfall > 0 ? null : 0);
  const asp = summary.average_item_price;
  const top = productRows(range.from, range.to, branchId, summary).filter((p) => p.price > 0).slice(0, 5);
  const insufficient = [];
  if (!summary.orders) insufficient.push('INSUFFICIENT DATA — no sales in this period.');
  if (!salaryAlloc && !effPct) insufficient.push('No salary allocation is configured (create an allocation category of type "Salary" in Cost Allocation).');
  if (!monthlyRequired) insufficient.push('No salary requirement — add employees (Staff/HR) or planned positions, or enter a scenario.');
  return {
    range, branch_id: branchId, months_in_period: Math.round(months * 10000) / 10000, scenario,
    workers: scenario ? [] : workers, worker_count: scenario ? scenario.workers : workers.length,
    monthly_salary_requirement: money(monthlyRequired), required_for_period: money(required),
    cost_per_employee_monthly: (scenario ? scenario.workers : workers.length) ? money(monthlyRequired / (scenario ? scenario.workers : workers.length)) : null,
    revenue: summary.allocation_base, salary_allocation: money(salaryAlloc), salary_allocation_pct: summary.allocation_base > 0 ? Math.round(effPct * 100000) / 1000 : null,
    difference: money(diff), coverage_pct: required > 0 ? pct1(salaryAlloc, required) : null, status: required <= 0 ? 'no_requirement' : diff >= 0 ? 'covered' : 'shortfall',
    shortfall: money(shortfall), surplus: money(diff > 0 ? diff : 0),
    revenue_needed_to_cover: effPct > 0 ? money(required / effPct) : null,
    additional_revenue_needed: additionalRevenue == null ? null : money(additionalRevenue),
    average_item_price: asp,
    additional_units_needed: additionalRevenue && asp ? Math.ceil(additionalRevenue / asp) : (additionalRevenue === 0 ? 0 : null),
    by_product: additionalRevenue ? top.map((p) => ({ product_id: p.product_id, name: p.name, price: p.price, units_needed: Math.ceil(additionalRevenue / p.price) })) : [],
    insufficient,
    note: 'Salary coverage compares the salary allocation (revenue × salary allocation %) with the salary requirement for the period. Employee salaries come from Staff/HR records; planned positions are not employee records.'
  };
}

function employees(f = {}, actor) {
  const user = requirePerm(actor, 'fin_salaries');
  const branchId = scopeBranch(user, f.branch_id);
  const settings = getSettings();
  const roster = employeeRoster(branchId, settings);
  const included = [...roster.employees, ...roster.planned].filter((w) => w.included);
  const total = included.reduce((a, w) => a + w.monthly_cost, 0);
  return {
    branch_id: branchId, ...roster,
    included_count: included.length, monthly_total: money(total), cost_per_employee: included.length ? money(total / included.length) : null,
    unknown_frequency: included.filter((w) => !w.frequency_known).map((w) => w.name),
    settings: { work_days_per_month: settings.work_days_per_month, hours_per_month: settings.hours_per_month },
    affordability: affordability({ ...f, branch_id: branchId }, user)
  };
}

/* ─────────────────────────── Break-even ─────────────────────────── */

function lastFullMonths(n) {
  const [ty, tm] = todayYmd().split('-').map(Number);
  let y = ty; let m = tm - 1;
  if (m === 0) { m = 12; y -= 1; }
  const endY = y; const endM = m;
  let sy = endY; let sm = endM - (n - 1);
  while (sm <= 0) { sm += 12; sy -= 1; }
  return { from: `${sy}-${String(sm).padStart(2, '0')}-01`, to: `${endY}-${String(endM).padStart(2, '0')}-${String(daysInMonth(endY, endM)).padStart(2, '0')}`, months: n };
}

function breakEven(f = {}, actor) {
  const user = requirePerm(actor, 'fin_view');
  const settings = getSettings();
  const branchId = scopeBranch(user, f.branch_id);
  const win = lastFullMonths(Math.max(1, Math.min(12, Number(f.months) || settings.break_even_months)));
  const { model, agg } = compute(win.from, win.to, branchId);
  const s = summarize(agg.cells, agg.expenses, model, settings);
  const roster = employeeRoster(branchId, settings);
  const salaryMonthly = [...roster.employees, ...roster.planned].filter((w) => w.included).reduce((a, w) => a + w.monthly_cost, 0);
  const salaryCats = new Set(['salary', 'salaries', 'wages', 'payroll']);
  const fixedCats = new Set((settings.fixed_expense_categories || []).map((c) => String(c).toLowerCase()));
  const fixedExpenseRows = s.actual.expenses_by_category.filter((e) => fixedCats.has(e.category) && !(salaryMonthly > 0 && salaryCats.has(e.category)));
  const fixedExpMonthly = fixedExpenseRows.reduce((a, e) => a + e.amount, 0) / win.months;
  const fixedMonthly = salaryMonthly + fixedExpMonthly;
  const itemRev = agg.cells.reduce((a, c) => a + c.item_revenue, 0);
  const costedRev = agg.cells.reduce((a, c) => a + c.costed_revenue, 0);
  const coverage = itemRev > 0 ? (costedRev / itemRev) * 100 : 0;
  const variableRatio = costedRev > 0 ? agg.cells.reduce((a, c) => a + c.cost, 0) / costedRev : null;
  const asp = s.average_item_price;
  const [ty, tm] = todayYmd().split('-').map(Number);
  const dim = daysInMonth(ty, tm);
  const insufficient = [];
  if (!s.orders) insufficient.push(`INSUFFICIENT DATA — no sales in ${win.from} to ${win.to}.`);
  if (fixedMonthly <= 0) insufficient.push('No fixed costs found — add employees/planned positions or record fixed expenses (categories set in Settings).');
  if (coverage < settings.min_cost_coverage_pct) insufficient.push(`Recorded stock cost covers only ${Math.round(coverage)}% of item revenue (minimum ${settings.min_cost_coverage_pct}%). Capture buying prices / recipe costs to calculate actual-cost break-even.`);
  let actual = null;
  if (fixedMonthly > 0 && variableRatio != null && coverage >= settings.min_cost_coverage_pct && variableRatio < 1) {
    const rev = fixedMonthly / (1 - variableRatio);
    actual = {
      variable_cost_ratio_pct: Math.round(variableRatio * 100000) / 1000, required_monthly_revenue: money(rev),
      required_daily_revenue: money(rev / dim), required_trading_day_revenue: money(rev / settings.work_days_per_month), required_weekly_revenue: money((rev * 12) / 52),
      required_monthly_units: asp ? Math.ceil(rev / asp) : null, required_daily_units: asp ? Math.ceil(rev / asp / dim) : null, required_weekly_units: asp ? Math.ceil(((rev * 12) / 52) / asp) : null,
      current_monthly_revenue: money(s.net_sales / win.months), gap_monthly: money(rev - s.net_sales / win.months)
    };
  } else if (variableRatio != null && variableRatio >= 1) insufficient.push('Recorded stock cost is equal to or above sales revenue — no break-even point exists at current prices.');
  // Allocation basis: revenue at which each allocation covers its matching monthly cost.
  const eff = new Map(s.allocations.map((a) => [a.id, s.allocation_base > 0 ? a.amount / s.allocation_base : 0]));
  const allocationRows = [];
  for (const c of model.cats.filter((x) => x.is_active && !DISTRIBUTION_KINDS.has(x.kind))) {
    const pctNow = c.current_pct / 100 || eff.get(c.id) || 0;
    let monthlyCost = null; let source = null;
    if (c.kind === 'salary' && salaryMonthly > 0) { monthlyCost = salaryMonthly; source = 'Employees and planned positions'; }
    else {
      const match = s.actual.expenses_by_category.find((e) => e.category === String(c.name).toLowerCase() || e.category === c.kind);
      if (match) { monthlyCost = match.amount / win.months; source = `Recorded "${match.category}" expenses (average of ${win.months} month${win.months > 1 ? 's' : ''})`; }
    }
    if (monthlyCost == null) continue;
    allocationRows.push({ category_id: c.id, name: c.name, kind: c.kind, pct: c.current_pct, monthly_cost: money(monthlyCost), cost_source: source, required_monthly_revenue: pctNow > 0 ? money(monthlyCost / pctNow) : null });
  }
  const allocReq = allocationRows.filter((r) => r.required_monthly_revenue != null).reduce((m, r) => Math.max(m, r.required_monthly_revenue), 0);
  const prods = (tryAll('SELECT * FROM products WHERE COALESCE(is_active, 1) = 1') || []).map((p) => {
    const recipe = num(p.recipe_cost); const buy = num(p.buying_price);
    const cost = Number(p.has_recipe) === 1 && recipe > 0 ? recipe : (buy > 0 ? buy : (recipe > 0 ? recipe : null));
    const price = num(p.selling_price);
    const margin = cost != null ? price - cost : null;
    return {
      product_id: Number(p.id), name: p.name, price: money(price), unit_cost: cost == null ? null : money(cost), cost_source: cost == null ? null : (Number(p.has_recipe) === 1 && recipe > 0 ? 'recipe' : 'buying price'),
      unit_margin: margin == null ? null : money(margin),
      units_to_cover_fixed: margin != null && margin > 0 && fixedMonthly > 0 ? Math.ceil(fixedMonthly / margin) : null,
      note: cost == null ? 'Insufficient data to calculate product-level break-even.' : margin <= 0 ? 'Price does not cover unit cost' : null
    };
  });
  const costed = prods.filter((p) => p.unit_cost != null);
  return {
    branch_id: branchId, window: win, fixed_costs: { monthly_total: money(fixedMonthly), salaries_monthly: money(salaryMonthly), fixed_expenses_monthly: money(fixedExpMonthly), fixed_expense_categories: fixedExpenseRows.map((e) => ({ ...e, monthly: money(e.amount / win.months) })) },
    average_selling_price: asp, stock_cost_coverage_pct: itemRev > 0 ? Math.round(coverage * 10) / 10 : null,
    actual_basis: actual, allocation_basis: { rows: allocationRows, required_monthly_revenue: allocReq ? money(allocReq) : null, required_daily_revenue: allocReq ? money(allocReq / dim) : null, required_weekly_revenue: allocReq ? money((allocReq * 12) / 52) : null, required_monthly_units: allocReq && asp ? Math.ceil(allocReq / asp) : null },
    products: prods.sort((a, b) => (a.units_to_cover_fixed ?? 1e12) - (b.units_to_cover_fixed ?? 1e12)).slice(0, 100),
    product_level_message: costed.length ? null : 'Insufficient data to calculate product-level break-even.',
    insufficient
  };
}

/* ─────────────────────────── Dashboard ─────────────────────────── */

function dashboard(f = {}, actor) {
  const user = requirePerm(actor, 'fin_view');
  const branchId = scopeBranch(user, f.branch_id);
  const today = todayYmd();
  const y = today.slice(0, 4);
  const { settings, model, agg } = compute(`${y}-01-01`, today, branchId);
  const sum = (pred, epred) => summarize(agg.cells.filter(pred), filterExp(agg.expenses, epred), model, settings);
  const t = sum((c) => c.day === today, (e) => e.day === today);
  const mPrefix = today.slice(0, 7);
  const mo = sum((c) => c.day.startsWith(mPrefix), (e) => e.day.startsWith(mPrefix));
  const yr = summarize(agg.cells, agg.expenses, model, settings);
  const top = productRows(`${mPrefix}-01`, today, branchId, mo).slice(0, 5);
  let salary = null;
  try { salary = affordability({ preset: 'this_month', branch_id: branchId }, user); } catch (_) { salary = null; }
  let be = null;
  try { const b = breakEven({ branch_id: branchId }, user); be = { actual: b.actual_basis?.required_monthly_revenue ?? null, allocation: b.allocation_basis.required_monthly_revenue, insufficient: b.insufficient }; } catch (_) { be = null; }
  return {
    today, branch_id: branchId, currency: companyInfo(null).currency,
    today_summary: pick(t), month: { from: `${mPrefix}-01`, to: today, ...pick(mo), allocations: mo.allocations },
    year: { from: `${y}-01-01`, to: today, ...pick(yr) },
    best_sellers: top, branches: branchRows(agg, model, settings, branchId).map((b) => ({ branch_id: b.branch_id, branch: b.branch, net_sales: b.net_sales, orders: b.orders, quantity: b.quantity, operating_contribution: b.operating_contribution })),
    salary: salary ? { coverage_pct: salary.coverage_pct, status: salary.status, required: salary.required_for_period, allocated: salary.salary_allocation, months_in_period: salary.months_in_period } : null,
    break_even: be, allocation: listCategories().filter((c) => c.is_active).map((c) => ({ id: c.id, name: c.name, kind: c.kind, pct: c.current_pct, branch_id: c.branch_id })),
    validation: validateTotals(model.cats, today), has_data: yr.has_data
  };
}

/* ─────────────────────────── AI Financial Advisor ─────────────────────────── */

const WORD_NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const R = (v) => `R${money(v).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function parseScenario(q) {
  const lower = q.toLowerCase();
  const wm = lower.match(/(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(workers?|employees?|staff|people)/);
  const workers = wm ? (WORD_NUM[wm[1]] || Number(wm[1])) : null;
  const am = q.replace(/,/g, '').match(/R\s?(\d+(?:\.\d+)?)/i) || lower.replace(/,/g, '').match(/(\d{3,}(?:\.\d+)?)\s*(rand|per month|a month|each|monthly)/);
  const salary = am ? Number(am[1]) : null;
  const pm = lower.match(/(\w[\w\s]*?)\s+allocation\s+from\s+(\d+(?:\.\d+)?)\s*%?\s+to\s+(\d+(?:\.\d+)?)\s*%?/) || lower.match(/change\s+(\w[\w\s]*?)\s+(?:from\s+(\d+(?:\.\d+)?)\s*%?\s+)?to\s+(\d+(?:\.\d+)?)\s*%/);
  return { workers, salary, pctChange: pm ? { name: pm[1].replace(/^(my|the|our)\s+/, '').trim(), from: pm[2] != null ? Number(pm[2]) : null, to: Number(pm[3]) } : null };
}

function detectIntents(q) {
  const l = q.toLowerCase();
  const i = new Set();
  if (/afford|worker|employee|staff|salar|wage/.test(l)) i.add('salary');
  if (/plate|units?|how many .*sell|cover salar/.test(l)) i.add('units');
  if (/make|made|revenue|sales|earn|turnover/.test(l) && /month|this month|so far/.test(l)) i.add('month');
  if (/day|days|weekday|best day|perform best/.test(l)) i.add('days');
  if (/product|item|meal|menu|selling poorly|slow|best.?sell|most revenue/.test(l)) i.add('products');
  if (/branch/.test(l)) i.add('branch');
  if (/allocat|percentage|%/.test(l)) i.add('allocation');
  if (/what happens|change .* to|from \d+%? to/.test(l)) i.add('scenario');
  if (/why|different|compare|last month|versus|vs\.?/.test(l)) i.add('compare');
  if (/consum|cost categor|biggest cost|most cost|expens/.test(l)) i.add('costs');
  if (/review|check|should i|advice|recommend/.test(l)) i.add('review');
  if (!i.size) { i.add('month'); i.add('review'); }
  return [...i];
}

function buildAdvice(q, branchId, user, canSalaries = true) {
  const intents = detectIntents(q).filter((i) => canSalaries || (i !== 'salary' && i !== 'units'));
  const sc = parseScenario(q);
  const facts = []; const analysis = []; const recs = []; const insufficient = [];
  const fact = (topic, text) => facts.push({ topic, text });
  const thisMonth = resolveRange({ preset: 'this_month' });
  const lastMonth = resolveRange({ preset: 'last_month' });
  const { settings, model, agg } = compute(lastMonth.from, thisMonth.to, branchId);
  const inR = (r) => (c) => c.day >= r.from && c.day <= r.to;
  const cur = summarize(agg.cells.filter(inR(thisMonth)), agg.expenses.filter(inR(thisMonth)), model, settings);
  const prev = summarize(agg.cells.filter(inR(lastMonth)), agg.expenses.filter(inR(lastMonth)), model, settings);
  if (!cur.has_data && !prev.has_data) insufficient.push('INSUFFICIENT DATA — no sales, refunds or expenses recorded this month or last month.');

  if (intents.includes('month') || intents.includes('compare')) {
    fact('month', `This month (${thisMonth.from} to ${thisMonth.to}): ${cur.orders} orders, ${cur.quantity} items, net sales ${R(cur.net_sales)} (gross ${R(cur.gross_sales)}, refunds ${R(cur.refunds)}).`);
    fact('month', `Last month (${lastMonth.from} to ${lastMonth.to}): ${prev.orders} orders, ${prev.quantity} items, net sales ${R(prev.net_sales)}.`);
    if (model.cats.length) fact('month', `This month: allocated costs ${R(cur.allocated_costs)}, operating contribution ${R(cur.operating_contribution)}, owner allocation ${R(cur.owner_allocation)}, unallocated ${R(cur.unallocated)}.`);
  }
  if (intents.includes('compare')) {
    const daysCur = dayCount(thisMonth.from, thisMonth.to); const daysPrev = dayCount(lastMonth.from, lastMonth.to);
    const perDayCur = cur.net_sales / daysCur; const perDayPrev = prev.net_sales / daysPrev;
    fact('compare', `Net sales per calendar day: this month ${R(perDayCur)} over ${daysCur} days; last month ${R(perDayPrev)} over ${daysPrev} days.`);
    fact('compare', `Average order: this month ${cur.average_order == null ? 'n/a' : R(cur.average_order)}; last month ${prev.average_order == null ? 'n/a' : R(prev.average_order)}.`);
    if (prev.orders && cur.orders) {
      const ordDelta = pct1(cur.orders / daysCur - prev.orders / daysPrev, prev.orders / daysPrev);
      const aovDelta = pct1(num(cur.average_order) - num(prev.average_order), num(prev.average_order));
      analysis.push(`Per day, order count changed by ${ordDelta}% and average order value by ${aovDelta}%. ${Math.abs(ordDelta) >= Math.abs(aovDelta) ? 'The change is driven mainly by the number of orders.' : 'The change is driven mainly by order value.'}`);
      analysis.push('This month is compared per calendar day because it may not be complete yet.');
    }
  }
  if (intents.includes('days')) {
    const byDow = new Map();
    for (const c of agg.cells) { const d = dowOf(c.day); const v = byDow.get(d) || { rev: 0, days: new Set() }; v.rev += c.gross - c.refunds; v.days.add(c.day); byDow.set(d, v); }
    const ranked = [...byDow.entries()].map(([d, v]) => ({ day: DOW[d], avg: v.rev / v.days.size, n: v.days.size })).sort((a, b) => b.avg - a.avg);
    if (ranked.length) {
      fact('days', `Average net sales per trading day (${lastMonth.from} to ${thisMonth.to}): ${ranked.map((r) => `${r.day} ${R(r.avg)} (${r.n} day${r.n > 1 ? 's' : ''})`).join('; ')}.`);
      analysis.push(`${ranked[0].day} is the strongest trading day and ${ranked[ranked.length - 1].day} the weakest in this window.`);
      if (ranked.some((r) => r.n < 3)) analysis.push('Some weekdays have fewer than 3 trading days in the window — treat their averages with caution.');
    } else insufficient.push('No trading days in the last two months.');
  }
  if (intents.includes('products')) {
    const rows = productRows(lastMonth.from, thisMonth.to, branchId, summarize(agg.cells, agg.expenses, model, settings));
    if (rows.length) {
      fact('products', `Top products by revenue (${lastMonth.from} to ${thisMonth.to}): ${rows.slice(0, 5).map((p) => `${p.name} ${R(p.revenue)} (${p.quantity} sold)`).join('; ')}.`);
      const low = rows.slice(-5).reverse();
      fact('products', `Lowest-revenue products that sold: ${low.map((p) => `${p.name} ${R(p.revenue)} (${p.quantity} sold)`).join('; ')}.`);
      const zero = (tryAll('SELECT COUNT(*) AS n FROM products WHERE COALESCE(is_active, 1) = 1') || [])[0];
      const unsold = num(zero?.n) - rows.filter((r) => r.product_id).length;
      if (unsold > 0) fact('products', `${unsold} active catalogue products had no sales in this window.`);
      recs.push({ text: `Review the lowest-selling products (${low.slice(0, 3).map((p) => p.name).join(', ')}) — consider repositioning, bundling or removing them. Prices are not changed automatically.` });
    } else insufficient.push('No product sales in the last two months.');
  }
  if (intents.includes('branch')) {
    const rows = branchRows({ cells: agg.cells.filter(inR(thisMonth)), expenses: agg.expenses.filter(inR(thisMonth)) }, model, settings, branchId).filter((b) => b.orders > 0).sort((a, b) => b.net_sales - a.net_sales);
    if (rows.length) {
      fact('branch', `Branch net sales this month: ${rows.map((b) => `${b.branch} ${R(b.net_sales)} (${b.orders} orders)`).join('; ')}.`);
      if (rows.length > 1) analysis.push(`${rows[0].branch} generated the most revenue this month.`);
    } else insufficient.push('No branch sales this month.');
  }
  if (intents.includes('allocation') || intents.includes('costs')) {
    const allocs = cur.allocations.filter((a) => a.amount).sort((a, b) => b.amount - a.amount);
    if (allocs.length) {
      fact('allocation', `This month's allocations: ${allocs.map((a) => `${a.name} ${R(a.amount)} (${a.effective_pct}%)`).join('; ')}.`);
      analysis.push(`${allocs[0].name} takes the largest share of revenue under the current allocation.`);
    } else if (!model.cats.length) insufficient.push('No allocation categories are configured yet (Cost Allocation).');
    if (cur.actual.expenses_by_category.length) {
      fact('costs', `Recorded expenses this month: ${cur.actual.expenses_by_category.map((e) => `${e.category} ${R(e.amount)}`).join('; ')} (total ${R(cur.actual.expenses)}).`);
      analysis.push(`The largest recorded expense category this month is ${cur.actual.expenses_by_category[0].category}.`);
    }
    const salaryAlloc = cur.allocations.filter((a) => a.kind === 'salary').reduce((s, a) => s + a.amount, 0);
    if (intents.includes('allocation') && model.cats.some((c) => c.kind === 'salary')) fact('allocation', `Allocated to salaries this month: ${R(salaryAlloc)}.`);
  }
  if (intents.includes('salary') || intents.includes('units')) {
    const a = affordability({ preset: 'last_month', branch_id: branchId, ...(sc.workers && sc.salary ? { workers: sc.workers, salary: sc.salary } : {}) }, user);
    if (sc.workers && !sc.salary) insufficient.push(`You asked about ${sc.workers} workers but no salary amount was given (e.g. "two workers at R2500").`);
    fact('salary', `Salary requirement for ${a.range.from} to ${a.range.to}: ${R(a.required_for_period)} (${a.worker_count} worker${a.worker_count === 1 ? '' : 's'}${a.scenario ? `, scenario at ${R(a.scenario.salary)} ${a.scenario.frequency}` : ''}).`);
    fact('salary', `Salary allocation in that period: ${R(a.salary_allocation)}${a.salary_allocation_pct != null ? ` (${a.salary_allocation_pct}% of ${R(a.revenue)})` : ''}. Coverage: ${a.coverage_pct == null ? 'n/a' : `${a.coverage_pct}%`}.`);
    a.insufficient.forEach((x) => insufficient.push(x));
    if (a.status === 'covered') analysis.push(`Last month's salary allocation covered the requirement with ${R(a.surplus)} to spare.`);
    if (a.status === 'shortfall') {
      analysis.push(`Last month's salary allocation fell ${R(a.shortfall)} short.${a.additional_revenue_needed != null ? ` About ${R(a.additional_revenue_needed)} more revenue would be needed at the current salary allocation.` : ''}`);
      if (a.additional_units_needed != null) fact('units', `At the average item price of ${R(a.average_item_price)}, that is about ${a.additional_units_needed} more items/plates.`);
      a.by_product.slice(0, 3).forEach((p) => fact('units', `Or ${p.units_needed} more of ${p.name} at ${R(p.price)}.`));
      recs.push({ text: 'Either raise sales (see Break-Even and Product Profitability), adjust the salary allocation % (requires your approval), or revisit the staffing plan.' });
    }
    if (a.revenue_needed_to_cover != null) fact('units', `Revenue needed for the salary allocation to cover salaries: ${R(a.revenue_needed_to_cover)} for the period.`);
  }
  if (intents.includes('scenario') && sc.pctChange) {
    const name = sc.pctChange.name.toLowerCase();
    const cat = model.cats.find((c) => c.name.toLowerCase() === name) || model.cats.find((c) => c.name.toLowerCase().includes(name) || name.includes(c.name.toLowerCase())) || model.cats.find((c) => c.kind === name);
    if (!cat) insufficient.push(`No allocation category matching "${sc.pctChange.name}" — create it in Cost Allocation first.`);
    else {
      const base = prev.allocation_base;
      const curPct = cat.current_pct;
      const delta = (base * (sc.pctChange.to - curPct)) / 100;
      fact('scenario', `${cat.name} is currently ${curPct}%. Last month's allocation base was ${R(base)}.`);
      analysis.push(`At ${sc.pctChange.to}%, ${cat.name} would have received ${R((base * sc.pctChange.to) / 100)} last month instead of ${R((base * curPct) / 100)} — a change of ${R(delta)}. Operating contribution would move by ${R(-delta)}${DISTRIBUTION_KINDS.has(cat.kind) ? ' (this is a distribution, not an operating cost)' : ''}.`);
      const totals = validateTotals(model.cats, todayYmd());
      const scopeTotal = totals[0].total_pct - curPct + sc.pctChange.to;
      if (scopeTotal > 100) analysis.push(`Warning: the all-branches allocation total would become ${Math.round(scopeTotal * 100) / 100}% — above 100%.`);
      recs.push({ text: `Change ${cat.name} allocation from ${curPct}% to ${sc.pctChange.to}% from today.`, action: { type: 'set_allocation_pct', category_id: cat.id, category: cat.name, from_pct: curPct, pct: sc.pctChange.to } });
    }
  }
  if (intents.includes('review')) {
    const totals = validateTotals(model.cats, todayYmd());
    totals.filter((t) => t.exceeds).forEach((t) => recs.push({ text: `${t.scope}: allocation percentages total ${t.total_pct}% — above 100%. Review Cost Allocation.` }));
    if (!model.cats.length) recs.push({ text: 'Set up allocation categories (stock, salaries, rent, …) so revenue can be divided according to your plan.' });
    if (cur.actual.stock_cost_coverage_pct != null && cur.actual.stock_cost_coverage_pct < settings.min_cost_coverage_pct) recs.push({ text: `Only ${cur.actual.stock_cost_coverage_pct}% of item revenue this month has a recorded buying price — capture product costs so margins are reliable.` });
    if (cur.gross_sales > 0 && cur.refunds / cur.gross_sales > 0.05) recs.push({ text: `Refunds are ${pct1(cur.refunds, cur.gross_sales)}% of gross sales this month — review the reasons in Returns.` });
    const days = dayCount(thisMonth.from, thisMonth.to);
    const traded = new Set(agg.cells.filter(inR(thisMonth)).filter((c) => c.orders > 0).map((c) => c.day)).size;
    fact('review', `This month: ${traded} of ${days} days had sales.`);
  }
  if (!analysis.length && facts.length) analysis.push('See the facts above — no further pattern stands out in the available data.');
  return { intents, facts, analysis, recommendations: recs, insufficient };
}

async function llmWording(question, facts) {
  const apiKey = process.env.SHOP_POS_AI_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey || !facts.length) return null;
  const prompt = `You are a financial analyst for a small business. Answer using ONLY the FACTS below (all amounts in South African Rand).
Never invent revenue, sales, costs, expenses, employees, profits or dates. Do not call anything "profit" unless a fact says so.
If facts are insufficient, say so. Recommendations are proposals only; never say a change has been made.
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
  const user = requirePerm(actor, 'fin_ai');
  ensureSchema();
  const q = String(question || '').trim().slice(0, 500) || 'What should I review?';
  const branchId = scopeBranch(user, f.branch_id);
  const canSalaries = require('./authz').hasUserPermission(user, 'fin_salaries');
  const advice = buildAdvice(q, branchId, user, canSalaries);
  if (!canSalaries && detectIntents(q).some((i) => i === 'salary' || i === 'units')) {
    advice.insufficient.push('Salary figures need the "Financial — Employees & salaries" permission.');
  }
  let engine = 'rule_based'; let aiError = null;
  let analysis = advice.analysis;
  let recommendations = advice.recommendations;
  try {
    const llm = await llmWording(q, advice.facts);
    if (llm) {
      engine = llm.engine;
      if (llm.analysis.length) analysis = llm.analysis;
      const actionable = advice.recommendations.filter((r) => r.action);
      recommendations = [...llm.recommendations.map((text) => ({ text })), ...actionable];
    }
  } catch (err) { aiError = `AI service unavailable (${err.message}) — showing rule-based analysis.`; }
  const r = run('INSERT INTO fin_ai_log (question, engine, facts_json, analysis_json, recommendations_json, status, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)',
    [q, engine, JSON.stringify(advice.facts), JSON.stringify(analysis), JSON.stringify(recommendations), 'generated', user.id, nowSql()]);
  const id = insertId(r, 'fin_ai_log');
  audit(user, 'financial_ai_question', 'financial_ai', id, { question: q, engine, facts: advice.facts.length, recommendations: recommendations.length });
  return {
    id, question: q, engine, branch_id: branchId,
    engine_note: engine === 'rule_based' ? (aiError || 'Rule-based analysis (no AI model configured — set SHOP_POS_AI_API_KEY on the server for AI wording). FACTS are identical either way.') : 'AI wording over system facts. FACTS come from the database, not the AI.',
    facts: advice.facts, analysis, recommendations, insufficient: advice.insufficient,
    approval_note: 'Nothing has been changed. Configuration changes are applied only if you approve them.'
  };
}

/** Apply an AI-proposed configuration change after explicit administrator approval. */
function aiApprove(logId, index, actor) {
  const user = requirePerm(actor, 'fin_manage');
  ensureSchema();
  const log = get('SELECT * FROM fin_ai_log WHERE id = ?', [Number(logId)]);
  if (!log) throw new Error('Advice not found');
  const recs = parseJson(log.recommendations_json, []);
  const rec = recs[Number(index)];
  if (!rec?.action) throw new Error('This recommendation has no configuration change to apply');
  if (rec.action.type !== 'set_allocation_pct') throw new Error('Unsupported change type');
  const cat = setRate(rec.action.category_id, { pct: rec.action.pct, effective_from: todayYmd(), note: `AI recommendation #${log.id} approved` }, user, 'financial_ai_change_approved');
  rec.applied_at = nowSql(); rec.applied_by = user.id;
  run('UPDATE fin_ai_log SET recommendations_json = ?, status = ?, decided_by = ?, decided_at = ? WHERE id = ?', [JSON.stringify(recs), 'approved', user.id, nowSql(), log.id]);
  return { applied: true, category: cat };
}

function aiHistory(limit = 30, actor) {
  requirePerm(actor, 'fin_ai');
  ensureSchema();
  return all('SELECT * FROM fin_ai_log ORDER BY id DESC LIMIT ?', [Math.min(200, Number(limit) || 30)]).map((r) => ({
    id: Number(r.id), question: r.question, engine: r.engine, status: r.status, created_at: r.created_at,
    facts: parseJson(r.facts_json, []), analysis: parseJson(r.analysis_json, []), recommendations: parseJson(r.recommendations_json, [])
  }));
}

/* ─────────────────────────── Reports ─────────────────────────── */

const fmtR = (v) => (v == null ? '—' : R(v));
const fmtN = (v) => (v == null ? '—' : String(Math.round(num(v) * 1000) / 1000));

function kpisFor(s) {
  return [
    ['Orders', fmtN(s.orders)], ['Quantity sold', fmtN(s.quantity)], ['Gross sales', fmtR(s.gross_sales)], ['Discounts', fmtR(s.discounts)],
    ['Refunds', fmtR(s.refunds)], ['Net sales', fmtR(s.net_sales)], ['Allocation base', fmtR(s.allocation_base)], ['Allocated costs', fmtR(s.allocated_costs)],
    ['Operating contribution', fmtR(s.operating_contribution)], ['Owner allocation', fmtR(s.owner_allocation)], ['Unallocated amount', fmtR(s.unallocated)],
    ['Recorded stock cost', fmtR(s.actual?.recorded_stock_cost)], ['Actual expenses', fmtR(s.actual?.expenses)]
  ];
}
const periodRowHead = ['Orders', 'Qty sold', 'Net sales', 'Allocated costs', 'Contribution', 'Recorded stock cost', 'Expenses'];
const periodRowVals = (r) => [fmtN(r.orders), fmtN(r.quantity), fmtR(r.net_sales), fmtR(r.allocated_costs), fmtR(r.operating_contribution), fmtR(r.recorded_stock_cost), fmtR(r.expenses)];
const allocTable = (s) => ({ head: ['Category', 'Type', 'Effective %', 'Amount'], rows: (s.allocations || []).map((a) => [a.name, a.kind, a.effective_pct == null ? '—' : `${a.effective_pct}%`, fmtR(a.amount)]) });

async function buildSnapshot(type, f, user) {
  const branchId = scopeBranch(user, f.branch_id);
  const fx = { ...f, branch_id: branchId };
  const sections = []; let period = { from: null, to: null, label: '' };
  if (type === 'daily') {
    const d = daily(fx, user);
    period = d.range;
    sections.push({ title: 'Summary', kpis: kpisFor(d.summary), notes: d.empty_message ? [d.empty_message] : [] });
    sections.push({ title: 'Best-selling products', table: { head: ['Product', 'Qty', 'Revenue'], rows: d.products.map((p) => [p.name, fmtN(p.quantity), fmtR(p.revenue)]) } });
    sections.push({ title: 'Payment methods', table: { head: ['Method', 'Orders', 'Amount'], rows: d.payments.map((p) => [p.method, fmtN(p.orders), fmtR(p.amount)]) } });
    sections.push({ title: 'Allocations', table: allocTable(d.summary) });
  } else if (type === 'monthly') {
    const m = monthly(fx, user);
    period = { from: m.from, to: m.to, label: `${m.month_name} ${m.year}` };
    sections.push({ title: 'Month summary', kpis: kpisFor(m.total) });
    sections.push({ title: 'Daily breakdown', table: { head: ['Date', 'Day', ...periodRowHead], rows: [...m.days.map((d) => [d.date, d.day_name, ...(d.no_sales ? ['0 sales / No sales', '', '', '', '', '', ''] : periodRowVals(d))]), ['MONTH TOTAL', '', ...periodRowVals(pick(m.total))]] } });
    sections.push({ title: 'Allocations', table: allocTable(m.total) });
  } else if (type === 'annual') {
    const a = annual(fx, user);
    period = { from: `${a.year}-01-01`, to: `${a.year}-12-31`, label: String(a.year) };
    sections.push({ title: 'Year summary', kpis: kpisFor(a.total) });
    sections.push({ title: 'January – December', table: { head: ['Month', ...periodRowHead], rows: [...a.months.map((m) => [m.month_name, ...(m.no_data ? ['NO DATA', '', '', '', '', '', ''] : periodRowVals(m))]), ['YEAR TOTAL', ...periodRowVals(pick(a.total))]] } });
    sections.push({ title: 'Allocations', table: allocTable(a.total) });
  } else if (type === 'historical') {
    const h = history(fx, user);
    period = h.years.length ? { from: `${h.years[0].year}-01-01`, to: `${h.years[h.years.length - 1].year}-12-31`, label: 'All years' } : { label: 'All years' };
    sections.push({ title: 'Years', table: { head: ['Year', ...periodRowHead], rows: [...h.years.map((y) => [String(y.year), ...(y.no_data ? ['NO DATA', '', '', '', '', '', ''] : periodRowVals(y))]), ...(h.total ? [['ALL YEARS TOTAL', ...periodRowVals(pick(h.total))]] : [])] }, notes: h.empty_message ? [h.empty_message] : [] });
  } else if (type === 'branch') {
    const b = branchPerformance(fx, user);
    period = b.range;
    sections.push({ title: 'Branch performance', table: { head: ['Branch', ...periodRowHead], rows: b.branches.map((x) => [x.branch, ...periodRowVals(pick(x))]) }, notes: b.unassigned_expenses ? [`Expenses not linked to a branch: ${fmtR(b.unassigned_expenses)}`] : [] });
    sections.push({ title: 'Total', kpis: kpisFor(b.total) });
  } else if (type === 'product') {
    const p = products(fx, user);
    period = p.range;
    sections.push({ title: 'Product profitability', table: { head: ['Product', 'Price', 'Qty', 'Revenue', 'Stock alloc.', 'Salary alloc.', 'Rent alloc.', 'Other alloc.', 'Contribution', 'Recorded cost'], rows: p.products.map((x) => [x.name, fmtR(x.price), fmtN(x.quantity), fmtR(x.revenue), fmtR(x.allocated_stock), fmtR(x.allocated_salary), fmtR(x.allocated_rent), fmtR(x.allocated_other), fmtR(x.contribution), fmtR(x.recorded_stock_cost)]) }, notes: [p.note] });
    if (p.not_sold.length) sections.push({ title: 'Active products with no sales', table: { head: ['Product', 'Price'], rows: p.not_sold.map((x) => [x.name, fmtR(x.price)]) } });
  } else if (type === 'allocation') {
    const s = periodSummary(fx, user);
    period = s.range;
    sections.push({ title: 'Allocation result', kpis: [['Allocation base', fmtR(s.summary.allocation_base)], ['Allocated costs', fmtR(s.summary.allocated_costs)], ['Owner allocation', fmtR(s.summary.owner_allocation)], ['Savings', fmtR(s.summary.savings_allocation)], ['Unallocated amount', fmtR(s.summary.unallocated)]] });
    sections.push({ title: 'By category', table: allocTable(s.summary) });
    sections.push({ title: 'Configuration (current)', table: { head: ['Category', 'Type', 'Branch', 'Current %', 'Active', 'Effective from'], rows: listCategories().map((c) => [c.name, c.kind, c.branch_id ? (listBranches().find((b) => b.id === c.branch_id)?.name || `#${c.branch_id}`) : 'All', `${c.current_pct}%`, c.is_active ? 'Yes' : 'No', c.current_effective_from || '—']) }, notes: s.validation.map((v) => `${v.scope}: ${v.message}`) });
  } else if (type === 'salary') {
    const e = employees(fx, user);
    const a = e.affordability;
    period = a.range;
    sections.push({ title: 'Salary coverage', kpis: [['Workers', fmtN(a.worker_count)], ['Monthly salary requirement', fmtR(a.monthly_salary_requirement)], ['Required for period', fmtR(a.required_for_period)], ['Salary allocation', fmtR(a.salary_allocation)], ['Coverage', a.coverage_pct == null ? '—' : `${a.coverage_pct}%`], ['Shortfall', fmtR(a.shortfall)], ['Surplus', fmtR(a.surplus)], ['Additional revenue needed', fmtR(a.additional_revenue_needed)], ['Additional items needed', fmtN(a.additional_units_needed)]], notes: a.insufficient });
    sections.push({ title: 'Workers', table: { head: ['Name', 'Source', 'Role', 'Branch', 'Frequency', 'Salary', 'Monthly cost', 'Included'], rows: [...e.employees, ...e.planned].map((w) => [w.name, w.source === 'planned' ? 'Planned' : 'Employee', w.role, w.branch || 'All', w.frequency, fmtR(w.salary), fmtR(w.monthly_cost), w.included ? 'Yes' : 'No']) } });
  } else if (type === 'breakeven') {
    const b = breakEven(fx, user);
    period = { from: b.window.from, to: b.window.to, label: `Based on ${b.window.from} to ${b.window.to}` };
    sections.push({ title: 'Fixed costs (monthly)', kpis: [['Total fixed costs', fmtR(b.fixed_costs.monthly_total)], ['Salaries', fmtR(b.fixed_costs.salaries_monthly)], ['Fixed expenses', fmtR(b.fixed_costs.fixed_expenses_monthly)], ['Average selling price', fmtR(b.average_selling_price)], ['Stock cost coverage', b.stock_cost_coverage_pct == null ? '—' : `${b.stock_cost_coverage_pct}%`]], notes: b.insufficient });
    if (b.actual_basis) sections.push({ title: 'Break-even (actual cost basis)', kpis: [['Variable cost ratio', `${b.actual_basis.variable_cost_ratio_pct}%`], ['Required monthly revenue', fmtR(b.actual_basis.required_monthly_revenue)], ['Required weekly revenue', fmtR(b.actual_basis.required_weekly_revenue)], ['Required daily revenue', fmtR(b.actual_basis.required_daily_revenue)], ['Required monthly units', fmtN(b.actual_basis.required_monthly_units)], ['Required daily units', fmtN(b.actual_basis.required_daily_units)], ['Current monthly revenue', fmtR(b.actual_basis.current_monthly_revenue)]] });
    sections.push({ title: 'Break-even (allocation basis)', table: { head: ['Category', '%', 'Monthly cost', 'Cost source', 'Revenue needed'], rows: b.allocation_basis.rows.map((r) => [r.name, `${r.pct}%`, fmtR(r.monthly_cost), r.cost_source, fmtR(r.required_monthly_revenue)]) } });
    sections.push({ title: 'Product-level', table: { head: ['Product', 'Price', 'Unit cost', 'Unit margin', 'Units to cover fixed costs', 'Note'], rows: b.products.map((p) => [p.name, fmtR(p.price), fmtR(p.unit_cost), fmtR(p.unit_margin), fmtN(p.units_to_cover_fixed), p.note || '']) }, notes: b.product_level_message ? [b.product_level_message] : [] });
  } else if (type === 'ai') {
    const q = String(f.question || 'What should I review?');
    const a = await aiAsk(q, fx, user);
    period = { label: `This month and last month (asked ${todayYmd()})` };
    sections.push({ title: `Question: ${q}`, notes: [a.engine_note] });
    sections.push({ title: 'FACT', table: { head: ['Fact'], rows: a.facts.map((x) => [x.text]) } });
    sections.push({ title: 'ANALYSIS', table: { head: ['Analysis'], rows: a.analysis.map((x) => [x]) } });
    sections.push({ title: 'RECOMMENDATION', table: { head: ['Recommendation'], rows: a.recommendations.map((x) => [x.text]) }, notes: [a.approval_note, ...a.insufficient] });
  } else throw new Error('Unknown report type');
  return { branchId, period, sections };
}

function makeReference() {
  const d = todayYmd().replace(/-/g, '');
  const n = Number(get('SELECT COUNT(*) AS n FROM fin_reports')?.n || 0) + 1;
  return `FIN-${d}-${String(n).padStart(4, '0')}`;
}

async function generateReport(type, f = {}, actor) {
  const user = requirePerm(actor, 'fin_reports');
  ensureSchema();
  if (!REPORT_TYPES[type]) throw new Error('Unknown report type');
  if (type === 'salary') requirePerm(user, 'fin_salaries');
  if (type === 'ai') requirePerm(user, 'fin_ai');
  const { branchId, period, sections } = await buildSnapshot(type, f, user);
  const company = companyInfo(branchId);
  const reference = makeReference();
  const snapshot = {
    reference, type, title: REPORT_TYPES[type], company, period, branch: company.branch ? company.branch.name : 'All branches',
    generated_at: new Date().toISOString(), generated_by: user.full_name || user.username, filters: f, sections,
    definitions: 'Net sales = gross sales − refunds. Allocated costs = allocation base × configured cost percentages. Operating contribution = allocation base − allocated costs (before owner and savings allocations). Unallocated amount = base − all allocations. Not an accounting profit figure.'
  };
  const r = run(`INSERT INTO fin_reports (reference, report_type, title, period_from, period_to, branch_id, filters_json, snapshot_json, generated_by, generated_by_name, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [reference, type, snapshot.title, period.from || null, period.to || null, branchId, JSON.stringify(f), JSON.stringify(snapshot), user.id, snapshot.generated_by, nowSql()]);
  const id = insertId(r, 'fin_reports');
  audit(user, 'financial_report_generated', 'financial_report', id, { reference, type, period, branch_id: branchId });
  return { id, ...snapshot };
}

function listReports(limit = 100, actor) {
  requirePerm(actor, 'fin_reports');
  ensureSchema();
  return all('SELECT id, reference, report_type, title, period_from, period_to, branch_id, generated_by_name, export_count, last_export_format, created_at FROM fin_reports ORDER BY id DESC LIMIT ?', [Math.min(500, Number(limit) || 100)])
    .map((r) => ({ ...r, id: Number(r.id), period_from: normDay(r.period_from), period_to: normDay(r.period_to), branch: r.branch_id ? (listBranches().find((b) => b.id === Number(r.branch_id))?.name || `#${r.branch_id}`) : 'All branches' }));
}

function getReport(id, actor) {
  const user = requirePerm(actor, 'fin_reports');
  ensureSchema();
  const r = get('SELECT * FROM fin_reports WHERE id = ?', [Number(id)]);
  if (!r) throw new Error('Report not found');
  const locked = scopeBranch(user, null);
  if (locked && Number(r.branch_id) !== locked) throw new Error('This report belongs to another branch');
  return { id: Number(r.id), ...parseJson(r.snapshot_json, {}) };
}

function loadLogo(logoPath) {
  try {
    const p = String(logoPath || '');
    if (/^data:image\/(png|jpe?g);base64,/i.test(p)) return { data: p, fmt: /png/i.test(p) ? 'PNG' : 'JPEG' };
    if (!p || /^https?:/i.test(p)) return null;
    const fs = require('fs'); const path = require('path');
    const candidates = [p, path.join(process.env.SHOP_POS_DATA || '', p.replace(/^\/+/, '')), path.join(__dirname, '..', '..', p.replace(/^\/+/, ''))];
    for (const c of candidates) {
      if (c && fs.existsSync(c) && fs.statSync(c).isFile() && /\.(png|jpe?g)$/i.test(c)) {
        const buf = fs.readFileSync(c);
        if (buf.length > 1500000) return null;
        return { data: `data:image/${/png$/i.test(c) ? 'png' : 'jpeg'};base64,${buf.toString('base64')}`, fmt: /png$/i.test(c) ? 'PNG' : 'JPEG' };
      }
    }
  } catch (_) { /* logo optional */ }
  return null;
}

function headerLines(snap) {
  const c = snap.company || {};
  return [
    c.name, [c.address, c.phone, c.email].filter(Boolean).join(' · '),
    [c.vat_number ? `VAT: ${c.vat_number}` : '', c.registration_number ? `Reg: ${c.registration_number}` : ''].filter(Boolean).join(' · '),
    c.branch ? `Branch: ${c.branch.name}${c.branch.address ? ` — ${c.branch.address}` : ''}${c.branch.phone ? ` · ${c.branch.phone}` : ''}` : 'Branch: All branches'
  ].filter(Boolean);
}

function renderPdf(snap) {
  const { jsPDF } = require('jspdf');
  const at = require('jspdf-autotable');
  const autoTable = at.default || at.autoTable || at;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  let y = 40;
  const logo = loadLogo(snap.company?.logo_path);
  if (logo) { try { doc.addImage(logo.data, logo.fmt, 40, y - 6, 60, 60); } catch (_) { /* skip bad logo */ } }
  const x = logo ? 110 : 40;
  doc.setFontSize(14); doc.setFont(undefined, 'bold');
  const lines = headerLines(snap);
  doc.text(lines[0] || '', x, y + 6);
  doc.setFontSize(9); doc.setFont(undefined, 'normal');
  lines.slice(1).forEach((l, i) => doc.text(String(l), x, y + 22 + i * 12));
  y += Math.max(70, 22 + lines.length * 12);
  doc.setFontSize(16); doc.setFont(undefined, 'bold');
  doc.text(snap.title, 40, y); y += 18;
  doc.setFontSize(9); doc.setFont(undefined, 'normal');
  doc.text(`Period: ${snap.period?.label || `${snap.period?.from || ''} to ${snap.period?.to || ''}`}   ·   Reference: ${snap.reference}`, 40, y); y += 12;
  doc.text(`Generated: ${snap.generated_at.replace('T', ' ').slice(0, 19)} UTC by ${snap.generated_by}`, 40, y); y += 16;
  for (const s of snap.sections || []) {
    if (y > 760) { doc.addPage(); y = 40; }
    doc.setFontSize(11); doc.setFont(undefined, 'bold'); doc.text(String(s.title).slice(0, 110), 40, y); y += 6;
    doc.setFont(undefined, 'normal');
    if (s.kpis?.length) {
      autoTable(doc, { startY: y, head: [['Measure', 'Value']], body: s.kpis, theme: 'grid', styles: { fontSize: 8 }, headStyles: { fillColor: [31, 41, 55] }, margin: { left: 40, right: 40 }, tableWidth: 320 });
      y = doc.lastAutoTable.finalY + 10;
    }
    if (s.table) {
      if (s.table.rows.length) {
        autoTable(doc, { startY: y, head: [s.table.head], body: s.table.rows, theme: 'striped', styles: { fontSize: 7, cellPadding: 2 }, headStyles: { fillColor: [31, 41, 55] }, margin: { left: 40, right: 40 } });
        y = doc.lastAutoTable.finalY + 10;
      } else { doc.setFontSize(8); doc.text('NO DATA AVAILABLE FOR THIS PERIOD', 40, y + 10); y += 22; }
    }
    for (const n of s.notes || []) {
      if (!n) continue;
      doc.setFontSize(8);
      const wrapped = doc.splitTextToSize(String(n), W - 80);
      if (y + wrapped.length * 10 > 800) { doc.addPage(); y = 40; }
      doc.text(wrapped, 40, y + 8); y += wrapped.length * 10 + 4;
    }
    y += 6;
  }
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i += 1) {
    doc.setPage(i); doc.setFontSize(7);
    doc.text(doc.splitTextToSize(snap.definitions, W - 80), 40, 815);
    doc.text(`Page ${i} of ${pages}`, W - 80, 832);
  }
  return Buffer.from(doc.output('arraybuffer'));
}

function renderXlsx(snap) {
  const X = require('xlsx');
  const wb = X.utils.book_new();
  const head = [[snap.title], ...headerLines(snap).map((l) => [l]), [`Period: ${snap.period?.label || ''}`], [`Reference: ${snap.reference}`], [`Generated: ${snap.generated_at} by ${snap.generated_by}`], [snap.definitions]];
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(head), 'Report');
  const used = new Set(['Report']);
  (snap.sections || []).forEach((s, i) => {
    const aoa = [[s.title]];
    if (s.kpis?.length) { aoa.push(['Measure', 'Value']); s.kpis.forEach((k) => aoa.push(k)); aoa.push([]); }
    if (s.table) { aoa.push(s.table.head); s.table.rows.forEach((r) => aoa.push(r)); if (!s.table.rows.length) aoa.push(['NO DATA AVAILABLE FOR THIS PERIOD']); }
    (s.notes || []).filter(Boolean).forEach((n) => aoa.push([n]));
    let name = String(s.title).replace(/[\\/?*[\]:]/g, ' ').slice(0, 28).trim() || `Section ${i + 1}`;
    while (used.has(name)) name = `${name.slice(0, 25)} ${i + 1}`;
    used.add(name);
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(aoa), name);
  });
  return X.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function exportReport(id, format, actor) {
  const user = requirePerm(actor, 'fin_reports');
  const snap = getReport(id, user);
  const fmt = String(format || '').toLowerCase();
  if (!['pdf', 'xlsx'].includes(fmt)) throw new Error('Format must be pdf or xlsx');
  const buf = fmt === 'pdf' ? renderPdf(snap) : renderXlsx(snap);
  run('UPDATE fin_reports SET export_count = COALESCE(export_count, 0) + 1, last_export_format = ? WHERE id = ?', [fmt, Number(id)]);
  audit(user, 'financial_report_exported', 'financial_report', Number(id), { reference: snap.reference, format: fmt, bytes: buf.length });
  return {
    filename: `${snap.reference}-${snap.type}.${fmt}`,
    mime: fmt === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    base64: buf.toString('base64'), bytes: buf.length
  };
}

/** Concise text for WhatsApp; the admin chooses the recipient and presses Send. */
function reportSummaryText(id, actor) {
  const user = requirePerm(actor, 'fin_reports');
  const snap = getReport(id, user);
  const lines = [`*${snap.company?.name || ''} — ${snap.title}*`, `${snap.branch} · ${snap.period?.label || ''}`, `Ref ${snap.reference}`, ''];
  const first = (snap.sections || []).find((s) => s.kpis?.length);
  if (first) first.kpis.slice(0, 9).forEach(([k, v]) => lines.push(`${k}: ${v}`));
  else (snap.sections || []).slice(0, 3).forEach((s) => lines.push(`${s.title}: ${(s.table?.rows || []).length} rows`));
  lines.push('', 'Contribution and allocations are management figures, not accounting profit.');
  audit(user, 'financial_report_shared', 'financial_report', Number(id), { reference: snap.reference, channel: 'whatsapp_summary' });
  return { text: lines.join('\n') };
}

function meta(actor) {
  const user = requirePerm(actor, 'fin_view');
  ensureSchema();
  const authz = require('./authz');
  return {
    branches: listBranches(), locked_branch_id: scopeBranch(user, null), kinds: KINDS, distribution_kinds: [...DISTRIBUTION_KINDS], frequencies: FREQUENCIES,
    report_types: REPORT_TYPES, years: dataYears(), today: todayYmd(), company: companyInfo(null), settings: getSettings(),
    permissions: Object.fromEntries(['fin_view', 'fin_manage', 'fin_salaries', 'fin_reports', 'fin_ai'].map((k) => [k, authz.hasUserPermission(user, k)])),
    expense_categories: (tryAll('SELECT DISTINCT LOWER(category) AS c FROM expenses ORDER BY 1') || []).map((r) => r.c).filter(Boolean)
  };
}

function allocationOverview(f = {}, actor) {
  const user = requirePerm(actor, 'fin_view');
  const s = periodSummary(f.preset || f.from ? f : { ...f, preset: 'this_month' }, user);
  return { ...s, categories: listCategories(), branches: listBranches() };
}

module.exports = {
  KINDS, REPORT_TYPES, ensureSchema, resolveRange, todayYmd, daysInMonth, monthlyEquivalent,
  meta, getSettings, saveSettings, companyInfo, listCategories, validateTotals, saveCategory, setRate, setCategoryActive, deleteRate,
  allocationOverview, periodSummary, dashboard, daily, monthly, annual, history, branchPerformance, products, salesList, saleDetail,
  employees, affordability, savePlannedWorker, deletePlannedWorker, setEmployeeIncluded, breakEven,
  aiAsk, aiApprove, aiHistory, generateReport, listReports, getReport, exportReport, reportSummaryText, listAudit
};

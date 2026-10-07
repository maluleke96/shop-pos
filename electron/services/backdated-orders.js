/**
 * Backdated / Missed Order Recovery — auth, duplicate checks, listing.
 */
const { getDb } = require('../database/db');
const { hasUserPermission, loadUserById } = require('./authz');
const { verifyPinWithUpgrade } = require('./pin');

function nowIso() {
  return new Date().toISOString();
}

function parseSaleDatetime(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  // Accept "YYYY-MM-DDTHH:mm" or "YYYY-MM-DD HH:mm:ss" or ISO
  const normalized = s.includes('T') ? s : s.replace(' ', 'T');
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function toSqlDatetime(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function getBackdatedMaxDays() {
  try {
    const row = getDb().prepare('SELECT backdated_max_days FROM shop_settings WHERE id = 1').get();
    if (row && row.backdated_max_days != null) {
      const n = Number(row.backdated_max_days);
      if (n > 0) return Math.min(30, Math.max(1, Math.floor(n)));
    }
  } catch (_) { /* column may not exist */ }
  try {
    const raw = getDb().prepare('SELECT settings_json FROM shop_settings WHERE id = 1').get()?.settings_json;
    if (raw) {
      const j = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const n = Number(j?.backdated_max_days);
      if (n > 0) return Math.min(30, Math.max(1, Math.floor(n)));
    }
  } catch (_) { /* */ }
  return 7;
}

function ensureBackdatedColumns() {
  const db = getDb();
  const cols = [
    ['sale_datetime', 'TEXT'],
    ['is_backdated', 'INTEGER DEFAULT 0'],
    ['backdated_reason', 'TEXT'],
    ['entered_by_user_id', 'INTEGER'],
    ['authorized_by_user_id', 'INTEGER'],
    ['authorized_at', 'TEXT'],
    ['pos_terminal_id', 'TEXT'],
    ['backdated_correction_of', 'INTEGER']
  ];
  for (const [name, type] of cols) {
    try { db.exec(`ALTER TABLE sales ADD COLUMN IF NOT EXISTS ${name} ${type}`); } catch (_) {
      try { db.exec(`ALTER TABLE sales ADD COLUMN ${name} ${type}`); } catch (__) { /* exists */ }
    }
  }
}

function canAuthorizeBackdated(user) {
  if (!user || user.is_active === false || user.is_active === 0) return false;
  if (user.role === 'owner') return true;
  return hasUserPermission(user, 'authorize_backdated_order')
    || ['manager', 'assistant_manager'].includes(String(user.role || '').toLowerCase());
}

function canRequestBackdated(user) {
  if (!user || user.is_active === false || user.is_active === 0) return false;
  if (user.role === 'owner') return true;
  return hasUserPermission(user, 'request_backdated_order')
    || canAuthorizeBackdated(user)
    || ['cashier', 'supervisor', 'assistant_manager', 'manager'].includes(String(user.role || '').toLowerCase());
}

/**
 * Verify authorizer PIN. Must be a different user than enteredByUserId (unless allowSelfAuth for owner/manager admin path).
 */
function verifyBackdatedAuthorizer(pin, enteredByUserId, { allowSelfAuth = false } = {}) {
  if (!pin) throw new Error('Authorization PIN is required');
  const db = getDb();
  const users = db.prepare(`
    SELECT id, full_name, username, role, pin, permissions, is_active
    FROM users WHERE is_active = 1 AND pin IS NOT NULL AND pin != ''
  `).all();
  for (const u of users) {
    if (!canAuthorizeBackdated(u)) continue;
    const check = verifyPinWithUpgrade(u.pin, pin);
    if (!check.ok) continue;
    if (check.needsUpgrade && check.hash) {
      try { db.prepare('UPDATE users SET pin = ? WHERE id = ?').run(check.hash, u.id); } catch (_) { /* */ }
    }
    if (!allowSelfAuth && Number(u.id) === Number(enteredByUserId)) {
      throw new Error('You cannot authorize your own backdated order. Ask a manager.');
    }
    return {
      id: u.id,
      full_name: u.full_name,
      username: u.username,
      role: u.role
    };
  }
  throw new Error('Invalid authorization PIN — must be an authorized manager/admin');
}

function validateSaleDatetime(raw, { offlineQueued = false } = {}) {
  const d = parseSaleDatetime(raw);
  if (!d) throw new Error('Original sale date/time is required');
  const now = new Date();
  if (d.getTime() > now.getTime() + 60_000) {
    throw new Error('Sale date/time cannot be in the future');
  }
  const maxDays = offlineQueued ? 2 : getBackdatedMaxDays();
  const oldest = new Date(now.getTime() - maxDays * 24 * 60 * 60 * 1000);
  if (d.getTime() < oldest.getTime()) {
    throw new Error(`Sale date cannot be more than ${maxDays} day(s) ago`);
  }
  return { date: d, sql: toSqlDatetime(d) };
}

function productFingerprint(items = []) {
  return (items || [])
    .map((i) => `${i.product_id || i.combo_id || i.product_name || ''}:${Number(i.quantity) || 0}`)
    .sort()
    .join('|')
    .slice(0, 200);
}

function findSimilarSales(filters = {}) {
  ensureBackdatedColumns();
  const db = getDb();
  const saleDt = parseSaleDatetime(filters.sale_datetime);
  const total = Number(filters.total);
  const branchId = filters.branch_id || null;
  if (!saleDt || !(total >= 0)) return [];

  const windowMin = 30;
  const from = new Date(saleDt.getTime() - windowMin * 60 * 1000);
  const to = new Date(saleDt.getTime() + windowMin * 60 * 1000);
  const params = [toSqlDatetime(from), toSqlDatetime(to), total - 0.5, total + 0.5];
  let sql = `
    SELECT s.id, s.receipt_number, s.order_number, s.total, s.created_at, s.sale_datetime,
      s.is_backdated, s.user_id, u.full_name AS cashier_name, s.branch_id
    FROM sales s
    LEFT JOIN users u ON u.id = s.user_id
    WHERE s.status IN ('completed', 'partial_return')
      AND COALESCE(s.sale_datetime, s.created_at) BETWEEN ? AND ?
      AND s.total BETWEEN ? AND ?
  `;
  if (branchId) {
    sql += ' AND s.branch_id = ?';
    params.push(branchId);
  }
  if (filters.user_id) {
    sql += ' AND s.user_id = ?';
    params.push(filters.user_id);
  }
  sql += ' ORDER BY COALESCE(s.sale_datetime, s.created_at) DESC LIMIT 10';
  return db.prepare(sql).all(...params);
}

function listBackdatedOrders(filters = {}) {
  ensureBackdatedColumns();
  const db = getDb();
  const params = [];
  let sql = `
    SELECT s.*,
      eu.full_name AS entered_by_name, eu.username AS entered_by_username,
      au.full_name AS authorized_by_name, au.username AS authorized_by_username
    FROM sales s
    LEFT JOIN users eu ON eu.id = COALESCE(s.entered_by_user_id, s.user_id)
    LEFT JOIN users au ON au.id = s.authorized_by_user_id
    WHERE COALESCE(s.is_backdated, 0) = 1
  `;
  if (filters.entered_from) {
    sql += ' AND date(s.created_at, \'localtime\') >= date(?)';
    params.push(filters.entered_from);
  }
  if (filters.entered_to) {
    sql += ' AND date(s.created_at, \'localtime\') <= date(?)';
    params.push(filters.entered_to);
  }
  if (filters.sale_from) {
    sql += ' AND date(COALESCE(s.sale_datetime, s.created_at), \'localtime\') >= date(?)';
    params.push(filters.sale_from);
  }
  if (filters.sale_to) {
    sql += ' AND date(COALESCE(s.sale_datetime, s.created_at), \'localtime\') <= date(?)';
    params.push(filters.sale_to);
  }
  if (filters.branch_id) {
    sql += ' AND s.branch_id = ?';
    params.push(filters.branch_id);
  }
  if (filters.entered_by) {
    sql += ' AND COALESCE(s.entered_by_user_id, s.user_id) = ?';
    params.push(filters.entered_by);
  }
  if (filters.authorized_by) {
    sql += ' AND s.authorized_by_user_id = ?';
    params.push(filters.authorized_by);
  }
  if (filters.min_amount != null) {
    sql += ' AND s.total >= ?';
    params.push(Number(filters.min_amount));
  }
  if (filters.max_amount != null) {
    sql += ' AND s.total <= ?';
    params.push(Number(filters.max_amount));
  }
  if (filters.status) {
    sql += ' AND s.status = ?';
    params.push(filters.status);
  }
  sql += ' ORDER BY s.created_at DESC LIMIT ?';
  params.push(Math.min(Number(filters.limit) || 200, 500));
  return db.prepare(sql).all(...params);
}

function backdatedOrdersSummary(filters = {}) {
  ensureBackdatedColumns();
  const db = getDb();
  const today = new Date().toLocaleDateString('en-CA');
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 6);
  const weekFrom = weekStart.toLocaleDateString('en-CA');
  const monthStart = new Date();
  monthStart.setDate(1);
  const monthFrom = monthStart.toLocaleDateString('en-CA');

  const agg = (from, to) => {
    const params = [from, to];
    let branchSql = '';
    if (filters.branch_id) {
      branchSql = ' AND branch_id = ?';
      params.push(filters.branch_id);
    }
    return db.prepare(`
      SELECT COUNT(*) AS count, COALESCE(SUM(total), 0) AS total
      FROM sales
      WHERE COALESCE(is_backdated, 0) = 1
        AND status IN ('completed', 'partial_return')
        AND date(created_at, 'localtime') BETWEEN date(?) AND date(?)
        ${branchSql}
    `).get(...params);
  };

  return {
    today: agg(today, today),
    week: agg(weekFrom, today),
    month: agg(monthFrom, today),
    max_days: getBackdatedMaxDays()
  };
}

/** SQL expression for business sale date filtering */
const SALE_BUSINESS_DT = "COALESCE(s.sale_datetime, s.created_at)";

module.exports = {
  nowIso,
  parseSaleDatetime,
  toSqlDatetime,
  getBackdatedMaxDays,
  ensureBackdatedColumns,
  canAuthorizeBackdated,
  canRequestBackdated,
  verifyBackdatedAuthorizer,
  validateSaleDatetime,
  productFingerprint,
  findSimilarSales,
  listBackdatedOrders,
  backdatedOrdersSummary,
  SALE_BUSINESS_DT,
  loadUserById
};

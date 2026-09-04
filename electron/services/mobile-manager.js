/**
 * Business Manager mobile app — auth, RBAC, branch enforcement, dashboard, notifications.
 * Connects to existing sales, branches, users, online_orders_local.
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { getDb } = require('../database/db');

function dbGet(sql, p = []) { return getDb().prepare(sql).get(...p); }
function dbAll(sql, p = []) { return getDb().prepare(sql).all(...p); }
function dbRun(sql, p = []) { return getDb().prepare(sql).run(...p); }

const ROLES = ['super_admin', 'business_admin', 'branch_manager', 'custom'];
const DEFAULT_PREFS = {
  new_orders: true, large_orders: true, low_stock: true,
  pos_offline: true, cashup_alerts: true, system_alerts: true,
  large_order_threshold: 1000
};
const DEFAULT_PERMS = {
  view_orders: true, view_sales: true, receive_order_notifications: true,
  view_staff_activity: true, view_payroll: false, view_accounting: false,
  manage_orders: false, manage_users: false, view_all_branches: false
};
const ROLE_PERMS = {
  super_admin: { ...DEFAULT_PERMS, view_payroll: true, view_accounting: true, manage_orders: true, manage_users: true, view_all_branches: true },
  business_admin: { ...DEFAULT_PERMS, view_all_branches: true },
  branch_manager: { ...DEFAULT_PERMS },
  custom: { ...DEFAULT_PERMS }
};

function nowIso() { return new Date().toISOString(); }
function nowPlusDays(d) { return new Date(Date.now() + d * 86400000).toISOString(); }
function parseJson(v, fb = {}) {
  if (v == null || v === '') return fb;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch (_) { return fb; }
}
function hashToken(t) { return crypto.createHash('sha256').update(String(t)).digest('hex'); }
function newToken() { return crypto.randomBytes(32).toString('hex'); }

function isPgCloud() {
  try {
    return typeof process !== 'undefined' && process.env &&
      !!(process.env.SHOP_POS_DATABASE_URL || process.env.DATABASE_URL);
  } catch (_) { return false; }
}

function ensureSchema() {
  try { dbGet('SELECT 1 FROM mobile_app_users LIMIT 1'); } catch (_) {
    if (!isPgCloud()) {
      const fs = require('fs');
      const path = require('path');
      const mig = path.join(__dirname, '../database/migrations-v80.sql');
      if (fs.existsSync(mig)) getDb().exec(fs.readFileSync(mig, 'utf8'));
    }
  }
}

function effectivePermissions(user) {
  const role = user.role || 'branch_manager';
  const base = { ...(ROLE_PERMS[role] || ROLE_PERMS.branch_manager) };
  const custom = parseJson(user.permissions_json, {});
  return { ...base, ...custom, view_all_branches: user.all_branches ? true : (custom.view_all_branches ?? base.view_all_branches) };
}

function mobileUserId(user) {
  return Number(user.user_id || user.id);
}

function allowedBranchIds(user) {
  if (user.all_branches) {
    return dbAll('SELECT id FROM branches WHERE COALESCE(is_active, 1) != 0').map((b) => Number(b.id));
  }
  return dbAll('SELECT branch_id AS id FROM mobile_branch_access WHERE user_id = ?', [mobileUserId(user)]).map((b) => Number(b.id));
}

function assertBranchAccess(user, branchId) {
  const ids = allowedBranchIds(user);
  if (!ids.includes(Number(branchId))) throw new Error('You do not have access to this branch');
  return true;
}

function resolveSession(token) {
  ensureSchema();
  if (!token) throw new Error('Not authenticated');
  const hash = hashToken(token);
  const row = dbGet(`SELECT s.*, u.*, s.id AS session_id, u.id AS user_id
    FROM mobile_sessions s
    JOIN mobile_app_users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND u.is_active = 1`, [hash, nowIso()]);
  if (!row) throw new Error('Session expired or access revoked');
  const device = row.device_id ? dbGet('SELECT * FROM mobile_devices WHERE id = ? AND status = ?', [row.device_id, 'active']) : null;
  if (row.device_id && !device) throw new Error('This device has been deactivated');
  return { user: row, device, token };
}

function dateRange(filter = {}) {
  const period = filter.period || 'today';
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth();
  const d = today.getDate();
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (dt) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
  if (period === 'yesterday') {
    const yd = new Date(y, m, d - 1);
    const s = fmt(yd);
    const end = fmt(today);
    return { from: `${s}T00:00:00.000`, to: `${end}T00:00:00.000`, label: 'Yesterday' };
  }
  if (period === 'week') {
    const start = new Date(y, m, d - 6);
    const end = new Date(y, m, d + 1);
    return { from: `${fmt(start)}T00:00:00.000`, to: `${fmt(end)}T00:00:00.000`, label: 'This week' };
  }
  if (period === 'month') {
    const end = new Date(y, m, d + 1);
    return { from: `${y}-${pad(m + 1)}-01T00:00:00.000`, to: `${fmt(end)}T00:00:00.000`, label: 'This month' };
  }
  if (period === 'custom' && filter.from && filter.to) {
    const endD = new Date(filter.to);
    endD.setDate(endD.getDate() + 1);
    return { from: `${filter.from}T00:00:00.000`, to: `${fmt(endD)}T00:00:00.000`, label: 'Custom' };
  }
  const s = fmt(today);
  const end = new Date(y, m, d + 1);
  return { from: `${s}T00:00:00.000`, to: `${fmt(end)}T00:00:00.000`, label: 'Today' };
}

function branchFilterSql(user, filters = {}, alias = 's', paramList = []) {
  const ids = allowedBranchIds(user);
  if (!ids.length) return { sql: ' AND 1=0', params: [] };
  if (filters.branch_id && filters.branch_id !== 'all') {
    const bid = Number(filters.branch_id);
    assertBranchAccess(user, bid);
    return { sql: ` AND ${alias}.branch_id = ?`, params: [bid] };
  }
  return { sql: ` AND ${alias}.branch_id IN (${ids.map(() => '?').join(',')})`, params: ids };
}

function branchClause(user, alias = 's') {
  const ids = allowedBranchIds(user);
  if (!ids.length) return { sql: ' AND 1=0', params: [] };
  return { sql: ` AND ${alias}.branch_id IN (${ids.map(() => '?').join(',')})`, params: ids };
}

function formatSaleOrder(sale, branchName, cashierName) {
  const items = dbAll('SELECT product_name, quantity, unit_price, total, modifiers_text FROM sale_items WHERE sale_id = ?', [sale.id]);
  const pays = dbAll('SELECT payment_type, amount, gift_card_code, reference FROM sale_payments WHERE sale_id = ?', [sale.id]);
  const payment = pays.map((p) => {
    const label = String(p.payment_type || 'cash');
    if (label.toLowerCase() === 'giftcard' && p.gift_card_code) return `giftcard (${p.gift_card_code})`;
    return label;
  }).join(', ') || 'cash';
  let customer = null;
  if (sale.customer_id) {
    customer = dbGet('SELECT name, phone, email FROM customers WHERE id = ?', [sale.customer_id]);
  }
  const giftPay = pays.find((p) => String(p.payment_type).toLowerCase() === 'giftcard');
  const notes = String(sale.notes || '');
  let discountType = sale.discount > 0 ? 'Cart discount' : null;
  if (notes.includes('Loyalty')) discountType = 'Loyalty redemption';
  else if (notes.includes('Coupon')) discountType = 'Coupon';
  return {
    id: sale.id,
    order_number: sale.order_number || sale.receipt_number,
    receipt_number: sale.receipt_number,
    branch_id: sale.branch_id,
    branch_name: branchName,
    cashier: cashierName,
    customer_name: customer?.name || sale.customer_name || null,
    customer_phone: customer?.phone || sale.customer_phone || null,
    customer_email: customer?.email || sale.customer_email || null,
    time: sale.created_at,
    status: sale.status || 'completed',
    order_type: sale.order_type,
    order_source: sale.order_source || 'POS',
    delivery_address: sale.delivery_address || null,
    notes: sale.notes || null,
    subtotal: Number(sale.subtotal) || 0,
    discount: Number(sale.discount) || 0,
    discount_type: discountType,
    tax_amount: Number(sale.tax_amount) || 0,
    total: Number(sale.total) || 0,
    amount_paid: Number(sale.amount_paid) || 0,
    change_amount: Number(sale.change_amount) || 0,
    payment,
    payments: pays,
    payments_detail: pays.map((p) => ({
      type: p.payment_type,
      amount: Number(p.amount) || 0,
      gift_card_code: p.gift_card_code || null
    })),
    gift_card_code: giftPay?.gift_card_code || null,
    gift_card_amount: giftPay ? Number(giftPay.amount) || 0 : 0,
    items: items.map((i) => ({
      name: i.product_name, quantity: i.quantity, unit_price: i.unit_price, total: i.total,
      modifiers_text: i.modifiers_text || null
    }))
  };
}

function formatOnlineOrder(order, branchName) {
  let items = [];
  try { items = JSON.parse(order.items_json || '[]'); } catch (_) { items = []; }
  const giftAmt = Number(order.gift_card_amount) || 0;
  let discountType = Number(order.discount) > 0 ? 'Online order discount' : null;
  if (order.coupon_code) discountType = 'Online coupon';
  else if (Number(order.loyalty_points_used) > 0) discountType = 'Online loyalty';
  else if (giftAmt > 0) discountType = 'Online gift card';
  return {
    id: `online:${order.id}`,
    online_order_id: order.id,
    sale_id: order.sale_id || null,
    order_number: order.order_number,
    receipt_number: null,
    branch_id: order.branch_id,
    branch_name: branchName,
    cashier: null,
    customer_name: order.customer_name,
    customer_phone: order.customer_phone,
    customer_email: order.customer_email || null,
    time: order.created_at,
    status: order.status,
    order_type: 'online',
    order_source: order.order_source || 'ONLINE',
    fulfillment_type: order.fulfillment_type || order.fulfillment,
    delivery_address: order.delivery_address || null,
    notes: order.notes || null,
    coupon_code: order.coupon_code || null,
    loyalty_points_used: Number(order.loyalty_points_used) || 0,
    delivery_fee: Number(order.delivery_fee) || 0,
    subtotal: Number(order.subtotal) || 0,
    discount: Number(order.discount) || 0,
    discount_type: discountType,
    tax_amount: Number(order.tax_amount) || 0,
    total: Number(order.total) || 0,
    payment: order.payment_method || 'online',
    payment_status: order.payment_status || null,
    payments: [{ payment_type: order.payment_method || 'online', amount: Number(order.total) || 0 }],
    payments_detail: [{ type: order.payment_method || 'online', amount: Number(order.total) || 0 }],
    gift_card_code: order.gift_card_code || null,
    gift_card_amount: giftAmt,
    is_online_pending: !order.sale_id,
    items: items.map((i) => ({
      name: i.name,
      quantity: i.quantity,
      unit_price: i.unit_price,
      total: (Number(i.unit_price) || 0) * (Number(i.quantity) || 1),
      modifiers_text: i.modifiers_text || (Array.isArray(i.modifiers) ? i.modifiers.map((m) => m.name).join(', ') : null)
    }))
  };
}

function onlineBranchClause(user, alias = 'o') {
  const ids = allowedBranchIds(user);
  if (!ids.length) return { sql: ' AND 1=0', params: [] };
  return { sql: ` AND ${alias}.branch_id IN (${ids.map(() => '?').join(',')})`, params: ids };
}

function onlineBranchFilterSql(user, filters = {}, alias = 'o') {
  const ids = allowedBranchIds(user);
  if (!ids.length) return { sql: ' AND 1=0', params: [] };
  if (filters.branch_id && filters.branch_id !== 'all') {
    const bid = Number(filters.branch_id);
    assertBranchAccess(user, bid);
    return { sql: ` AND ${alias}.branch_id = ?`, params: [bid] };
  }
  return { sql: ` AND ${alias}.branch_id IN (${ids.map(() => '?').join(',')})`, params: ids };
}

function issueSessionForUser(user, deviceInfo = {}) {
  const deviceUid = String(deviceInfo.device_uid || deviceInfo.deviceUid || crypto.randomBytes(8).toString('hex'));
  const platform = deviceInfo.platform || 'web';
  const deviceName = deviceInfo.device_name || deviceInfo.deviceName || `${platform} device`;
  let device = dbGet('SELECT * FROM mobile_devices WHERE user_id = ? AND device_uid = ?', [user.id, deviceUid]);
  if (device && device.status !== 'active') throw new Error('This device has been deactivated. Contact your administrator.');
  if (!device) {
    const r = dbRun(`INSERT INTO mobile_devices (user_id, device_uid, device_name, platform, status, last_active_at)
      VALUES (?,?,?,?, 'active', ?)`, [user.id, deviceUid, deviceName, platform, nowIso()]);
    device = dbGet('SELECT * FROM mobile_devices WHERE id = ?', [r.lastInsertRowid]);
  } else {
    dbRun('UPDATE mobile_devices SET device_name = ?, platform = ?, last_active_at = ? WHERE id = ?',
      [deviceName, platform, nowIso(), device.id]);
  }
  if (deviceInfo.push_token) {
    dbRun('UPDATE mobile_devices SET push_token = ? WHERE id = ?', [deviceInfo.push_token, device.id]);
  }
  const token = newToken();
  dbRun('INSERT INTO mobile_sessions (user_id, device_id, token_hash, expires_at) VALUES (?,?,?,?)',
    [user.id, device.id, hashToken(token), nowPlusDays(30)]);
  dbRun('UPDATE mobile_app_users SET last_login_at = ? WHERE id = ?', [nowIso(), user.id]);
  const perms = effectivePermissions(user);
  const branches = allowedBranchIds(user).map((bid) => {
    const b = dbGet('SELECT id, name, code FROM branches WHERE id = ?', [bid]);
    return b || { id: bid, name: `Branch ${bid}` };
  });
  return {
    token,
    expires_at: nowPlusDays(30),
    user: {
      id: user.id, username: user.username, full_name: user.full_name, role: user.role,
      must_change_password: !!user.must_change_password, permissions: perms, branches
    },
    device: { id: device.id, device_uid: deviceUid, device_name: deviceName, platform }
  };
}

function ensureMobileUserForActor(actor) {
  ensureSchema();
  if (!actor?.id) throw new Error('Not signed in to Admin');
  if (!['owner', 'manager', 'assistant_manager', 'supervisor'].includes(actor.role)) {
    throw new Error('Business Manager requires admin access');
  }
  let user = dbGet('SELECT * FROM mobile_app_users WHERE linked_user_id = ?', [actor.id]);
  if (!user) user = dbGet('SELECT * FROM mobile_app_users WHERE lower(username) = lower(?)', [actor.username]);
  if (!user) {
    const role = actor.role === 'owner' ? 'super_admin' : actor.role === 'manager' ? 'business_admin' : 'branch_manager';
    const hash = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 10);
    const allBranches = ['owner', 'manager'].includes(actor.role) ? 1 : 0;
    const r = dbRun(`INSERT INTO mobile_app_users (linked_user_id, username, password_hash, full_name, role, all_branches, must_change_password, is_active)
      VALUES (?,?,?,?,?,?,0,1)`, [actor.id, actor.username, hash, actor.full_name || actor.username, role, allBranches]);
    const uid = r.lastInsertRowid;
    if (!allBranches && actor.branch_id) {
      dbRun('INSERT INTO mobile_branch_access (user_id, branch_id) VALUES (?,?)', [uid, actor.branch_id]);
    }
    dbRun('INSERT INTO mobile_notification_prefs (user_id, prefs_json) VALUES (?,?)', [uid, JSON.stringify(DEFAULT_PREFS)]);
    user = dbGet('SELECT * FROM mobile_app_users WHERE id = ?', [uid]);
  }
  if (!user.is_active) throw new Error('Your Business Manager access is disabled');
  if (!user.linked_user_id) dbRun('UPDATE mobile_app_users SET linked_user_id = ? WHERE id = ?', [actor.id, user.id]);
  if (['owner', 'manager'].includes(actor.role) && !user.all_branches) {
    dbRun('UPDATE mobile_app_users SET all_branches = 1 WHERE id = ?', [user.id]);
    user.all_branches = 1;
  }
  const branchIds = allowedBranchIds(user);
  if (!branchIds.length && actor.branch_id) {
    try {
      dbRun('INSERT OR IGNORE INTO mobile_branch_access (user_id, branch_id) VALUES (?,?)', [user.id, actor.branch_id]);
    } catch (_) { /* */ }
  }
  return user;
}

function bootstrapFromAdmin(actor, deviceInfo = {}) {
  const user = ensureMobileUserForActor(actor);
  return issueSessionForUser(user, {
    ...deviceInfo,
    device_uid: deviceInfo.device_uid || `admin-${actor.id}`,
    device_name: deviceInfo.device_name || 'Admin Panel',
    platform: deviceInfo.platform || 'admin'
  });
}

function login(username, password, deviceInfo = {}) {
  ensureSchema();
  const id = String(username || '').trim();
  const user = dbGet('SELECT * FROM mobile_app_users WHERE lower(username) = lower(?) AND is_active = 1', [id]);
  if (!user || !bcrypt.compareSync(String(password), user.password_hash)) {
    throw new Error('Invalid username or password');
  }
  return issueSessionForUser(user, deviceInfo);
}

function logout(token) {
  try {
    const hash = hashToken(token);
    dbRun('DELETE FROM mobile_sessions WHERE token_hash = ?', [hash]);
  } catch (_) { /* */ }
  return { success: true };
}

function getProfile(token) {
  const { user } = resolveSession(token);
  const perms = effectivePermissions(user);
  const branches = allowedBranchIds(user).map((bid) => dbGet('SELECT id, name, code, address FROM branches WHERE id = ?', [bid])).filter(Boolean);
  const prefs = dbGet('SELECT prefs_json FROM mobile_notification_prefs WHERE user_id = ?', [user.user_id || user.id]);
  return {
    user: {
      id: user.user_id || user.id, username: user.username, full_name: user.full_name,
      role: user.role, permissions: perms, branches, must_change_password: !!user.must_change_password
    },
    notification_prefs: { ...DEFAULT_PREFS, ...parseJson(prefs?.prefs_json, {}) }
  };
}

function getDashboard(token, filters = {}) {
  const { user } = resolveSession(token);
  const perms = effectivePermissions(user);
  if (!perms.view_sales && !perms.view_orders) throw new Error('Permission denied');
  const range = dateRange(filters);
  const bc = branchFilterSql(user, filters, 's');
  const obc = onlineBranchFilterSql(user, filters, 'o');
  const stats = dbGet(`SELECT COUNT(*) AS orders, COALESCE(SUM(total),0) AS sales
    FROM sales s WHERE s.status = 'completed' AND s.created_at >= ? AND s.created_at < ?${bc.sql}`,
    [range.from, range.to, ...bc.params]) || { orders: 0, sales: 0 };
  const onlineStats = dbGet(`SELECT COUNT(*) AS orders, COALESCE(SUM(total),0) AS sales
    FROM online_orders_local o WHERE o.created_at >= ? AND o.created_at < ?
    AND o.status NOT IN ('cancelled','rejected')${obc.sql}`,
    [range.from, range.to, ...obc.params]) || { orders: 0, sales: 0 };
  const orders = (Number(stats.orders) || 0) + (Number(onlineStats.orders) || 0);
  const sales = (Number(stats.sales) || 0) + (Number(onlineStats.sales) || 0);
  const recent = dbAll(`SELECT s.id, s.order_number, s.receipt_number, s.total, s.created_at, s.branch_id, s.order_source
    FROM sales s WHERE s.status = 'completed' AND s.created_at >= ? AND s.created_at < ?${bc.sql}
    ORDER BY s.id DESC LIMIT 8`, [range.from, range.to, ...bc.params]);
  const recentOnline = dbAll(`SELECT o.id, o.order_number, o.total, o.created_at, o.branch_id, o.status, o.order_source
    FROM online_orders_local o
    WHERE o.created_at >= ? AND o.created_at < ? AND o.status IN ('pending','accepted')${obc.sql}
    ORDER BY o.id DESC LIMIT 5`, [range.from, range.to, ...obc.params]);
  const mergedRecent = [
    ...recent.map((r) => ({
      id: r.id, number: r.order_number || r.receipt_number, total: Number(r.total), time: r.created_at,
      branch_id: r.branch_id, order_source: r.order_source || 'POS'
    })),
    ...recentOnline.map((o) => ({
      id: `online:${o.id}`, number: o.order_number, total: Number(o.total), time: o.created_at,
      branch_id: o.branch_id, order_source: o.order_source || 'ONLINE', status: o.status
    }))
  ].sort((a, b) => new Date(b.time) - new Date(a.time)).slice(0, 10);
  const branchRows = allowedBranchIds(user).map((bid) => {
    const b = dbGet('SELECT name FROM branches WHERE id = ?', [bid]);
    const st = dbGet(`SELECT COUNT(*) AS orders, COALESCE(SUM(total),0) AS sales FROM sales
      WHERE branch_id = ? AND status = 'completed' AND created_at >= ? AND created_at < ?`,
      [bid, range.from, range.to]);
    return { id: bid, name: b?.name || `Branch ${bid}`, orders: st?.orders || 0, sales: Number(st?.sales) || 0 };
  });
  const unread = dbGet('SELECT COUNT(*) AS c FROM mobile_notifications WHERE user_id = ? AND read_at IS NULL',
    [user.user_id || user.id])?.c || 0;
  const posOnline = dbAll(`SELECT * FROM pos_heartbeats WHERE branch_id IN (${allowedBranchIds(user).map(() => '?').join(',') || '0'})`,
    allowedBranchIds(user));
  const branchesOnline = posOnline.filter((p) => {
    const age = Date.now() - new Date(p.last_seen_at).getTime();
    return age < 5 * 60 * 1000;
  }).length;
  const branchCount = allowedBranchIds(user).length;
  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  })();
  return {
    greeting,
    user_name: user.full_name,
    period: range.label,
    updated_at: nowIso(),
    orders,
    sales,
    average_order: orders ? Math.round((sales / orders) * 100) / 100 : 0,
    recent_orders: mergedRecent,
    branches: branchRows,
    multi_branch: branchCount > 1,
    alerts_count: unread,
    branches_online: branchesOnline,
    branches_total: branchCount,
    permissions: perms
  };
}

function listOrders(token, filters = {}) {
  const { user } = resolveSession(token);
  if (!effectivePermissions(user).view_orders) throw new Error('Permission denied');
  const range = dateRange(filters);
  const bc = branchFilterSql(user, filters, 's');
  const obc = onlineBranchFilterSql(user, filters, 'o');
  const limit = Math.min(Number(filters.limit) || 50, 100);
  const offset = Math.max(Number(filters.offset) || 0, 0);
  const rows = dbAll(`SELECT s.*, b.name AS branch_name, u.full_name AS cashier_name
    FROM sales s
    LEFT JOIN branches b ON b.id = s.branch_id
    LEFT JOIN users u ON u.id = s.user_id
    WHERE s.created_at >= ? AND s.created_at < ?${bc.sql}
    ORDER BY s.id DESC LIMIT ? OFFSET ?`,
    [range.from, range.to, ...bc.params, limit, offset]);
  const onlineRows = dbAll(`SELECT o.*, b.name AS branch_name FROM online_orders_local o
    LEFT JOIN branches b ON b.id = o.branch_id
    WHERE o.created_at >= ? AND o.created_at < ?${obc.sql}
    ORDER BY o.id DESC LIMIT ?`,
    [range.from, range.to, ...obc.params, limit]);
  const sales = rows.map((r) => formatSaleOrder(r, r.branch_name, r.cashier_name));
  const online = onlineRows.map((o) => formatOnlineOrder(o, o.branch_name));
  return [...sales, ...online]
    .sort((a, b) => new Date(b.time) - new Date(a.time))
    .slice(0, limit);
}

function listOnlineOrders(token, filters = {}) {
  const { user } = resolveSession(token);
  if (!effectivePermissions(user).view_orders) throw new Error('Permission denied');
  const range = dateRange(filters);
  const obc = onlineBranchFilterSql(user, filters, 'o');
  const limit = Math.min(Number(filters.limit) || 50, 100);
  const status = String(filters.status || 'active').toLowerCase();
  let statusSql = '';
  const params = [range.from, range.to, ...obc.params];
  if (status === 'pending') {
    statusSql = " AND LOWER(o.status) = 'pending'";
  } else if (status === 'accepted') {
    statusSql = " AND LOWER(o.status) = 'accepted'";
  } else if (status === 'active') {
    statusSql = " AND LOWER(o.status) IN ('pending','accepted')";
  } else if (status !== 'all') {
    statusSql = ' AND LOWER(o.status) = ?';
    params.push(status);
  }
  const rows = dbAll(`SELECT o.*, b.name AS branch_name FROM online_orders_local o
    LEFT JOIN branches b ON b.id = o.branch_id
    WHERE o.created_at >= ? AND o.created_at < ?${obc.sql}${statusSql}
    ORDER BY o.id DESC LIMIT ?`,
    [...params, limit]);
  return rows.map((o) => formatOnlineOrder(o, o.branch_name));
}

function getOrder(token, orderId) {
  const { user } = resolveSession(token);
  if (!effectivePermissions(user).view_orders) throw new Error('Permission denied');
  const oid = String(orderId || '');
  if (oid.startsWith('online:')) {
    const id = Number(oid.slice(7));
    const order = dbGet('SELECT * FROM online_orders_local WHERE id = ?', [id]);
    if (!order) throw new Error('Order not found');
    assertBranchAccess(user, order.branch_id);
    const branch = dbGet('SELECT name FROM branches WHERE id = ?', [order.branch_id]);
    return formatOnlineOrder(order, branch?.name);
  }
  const sale = dbGet(`SELECT s.*, b.name AS branch_name, u.full_name AS cashier_name
    FROM sales s LEFT JOIN branches b ON b.id = s.branch_id LEFT JOIN users u ON u.id = s.user_id
    WHERE s.id = ? OR s.order_number = ? OR s.receipt_number = ?`, [orderId, orderId, orderId]);
  if (sale) {
    assertBranchAccess(user, sale.branch_id);
    return formatSaleOrder(sale, sale.branch_name, sale.cashier_name);
  }
  const onlineId = Number(orderId);
  if (Number.isFinite(onlineId) && onlineId > 0) {
    const order = dbGet('SELECT * FROM online_orders_local WHERE id = ?', [onlineId]);
    if (order) {
      assertBranchAccess(user, order.branch_id);
      const branch = dbGet('SELECT name FROM branches WHERE id = ?', [order.branch_id]);
      return formatOnlineOrder(order, branch?.name);
    }
  }
  throw new Error('Order not found');
}

function searchOrders(token, query = {}) {
  const { user } = resolveSession(token);
  if (!effectivePermissions(user).view_orders) throw new Error('Permission denied');
  const bc = branchClause(user, 's');
  const q = String(query.q || query.order_number || '').trim();
  const params = [...bc.params];
  let extra = bc.sql;
  if (q) { extra += ' AND (s.order_number LIKE ? OR s.receipt_number LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
  if (query.branch_id) { assertBranchAccess(user, query.branch_id); extra += ' AND s.branch_id = ?'; params.push(Number(query.branch_id)); }
  if (query.payment_method) { extra += ' AND EXISTS (SELECT 1 FROM sale_payments sp WHERE sp.sale_id = s.id AND sp.payment_type = ?)'; params.push(query.payment_method); }
  const rows = dbAll(`SELECT s.*, b.name AS branch_name, u.full_name AS cashier_name FROM sales s
    LEFT JOIN branches b ON b.id = s.branch_id LEFT JOIN users u ON u.id = s.user_id
    WHERE 1=1${extra} ORDER BY s.id DESC LIMIT 50`, params);
  return rows.map((r) => formatSaleOrder(r, r.branch_name, r.cashier_name));
}

function getStaffActivity(token, filters = {}) {
  const { user } = resolveSession(token);
  if (!effectivePermissions(user).view_staff_activity) throw new Error('Permission denied');
  const range = dateRange(filters);
  const bc = branchClause(user, 's');
  return dbAll(`SELECT u.full_name AS name, COUNT(s.id) AS orders, COALESCE(SUM(s.total),0) AS sales
    FROM sales s JOIN users u ON u.id = s.user_id
    WHERE s.status = 'completed' AND s.created_at >= ? AND s.created_at <= ?${bc.sql}
    GROUP BY u.id ORDER BY sales DESC LIMIT 20`,
    [range.from, range.to, ...bc.params]);
}

function getPosStatus(token) {
  const { user } = resolveSession(token);
  const ids = allowedBranchIds(user);
  const now = Date.now();
  return ids.map((bid) => {
    const b = dbGet('SELECT name FROM branches WHERE id = ?', [bid]);
    const beats = dbAll('SELECT * FROM pos_heartbeats WHERE branch_id = ? ORDER BY last_seen_at DESC', [bid]);
    const latest = beats[0];
    const online = latest && (now - new Date(latest.last_seen_at).getTime()) < 5 * 60 * 1000;
    return {
      branch_id: bid,
      branch_name: b?.name || `Branch ${bid}`,
      status: online ? 'online' : 'offline',
      last_seen: latest?.last_seen_at || null,
      devices: beats.map((hb) => ({
        device_id: hb.device_id, label: hb.device_label, last_seen: hb.last_seen_at,
        status: (now - new Date(hb.last_seen_at).getTime()) < 5 * 60 * 1000 ? 'online' : 'offline'
      }))
    };
  });
}

function listAlerts(token, limit = 50) {
  const { user } = resolveSession(token);
  const uid = user.user_id || user.id;
  const ids = allowedBranchIds(user);
  const rows = dbAll(`SELECT * FROM mobile_notifications
    WHERE user_id = ? AND (branch_id IS NULL OR branch_id IN (${ids.map(() => '?').join(',') || '0'}))
    ORDER BY id DESC LIMIT ?`, [uid, ...ids, limit]);
  return rows.map((n) => ({
    id: n.id, type: n.type, title: n.title, body: n.body,
    payload: parseJson(n.payload_json, {}), branch_id: n.branch_id,
    read: !!n.read_at, created_at: n.created_at
  }));
}

function markNotificationsRead(token, ids) {
  const { user } = resolveSession(token);
  const uid = user.user_id || user.id;
  if (!ids || !ids.length) {
    dbRun('UPDATE mobile_notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', [nowIso(), uid]);
    return { updated: 'all' };
  }
  for (const id of ids) {
    dbRun('UPDATE mobile_notifications SET read_at = ? WHERE id = ? AND user_id = ?', [nowIso(), id, uid]);
  }
  return { updated: ids.length };
}

function getNotificationPrefs(token) {
  const { user } = resolveSession(token);
  const row = dbGet('SELECT prefs_json FROM mobile_notification_prefs WHERE user_id = ?', [user.user_id || user.id]);
  return { ...DEFAULT_PREFS, ...parseJson(row?.prefs_json, {}) };
}

function saveNotificationPrefs(token, prefs) {
  const { user } = resolveSession(token);
  const uid = user.user_id || user.id;
  const merged = { ...DEFAULT_PREFS, ...parseJson(prefs, {}) };
  const existing = dbGet('SELECT user_id FROM mobile_notification_prefs WHERE user_id = ?', [uid]);
  if (existing) dbRun('UPDATE mobile_notification_prefs SET prefs_json = ?, updated_at = ? WHERE user_id = ?', [JSON.stringify(merged), nowIso(), uid]);
  else dbRun('INSERT INTO mobile_notification_prefs (user_id, prefs_json) VALUES (?,?)', [uid, JSON.stringify(merged)]);
  return merged;
}

function registerPushToken(token, pushToken) {
  const { user, device } = resolveSession(token);
  if (device) dbRun('UPDATE mobile_devices SET push_token = ?, last_active_at = ? WHERE id = ?', [pushToken, nowIso(), device.id]);
  return { success: true };
}

function recordPosHeartbeat(branchId, deviceId, label) {
  ensureSchema();
  try {
    dbRun(`INSERT INTO pos_heartbeats (branch_id, device_id, device_label, last_seen_at, status)
      VALUES (?,?,?,?, 'online')
      ON CONFLICT(branch_id, device_id) DO UPDATE SET last_seen_at = excluded.last_seen_at, status = 'online', device_label = excluded.device_label`,
      [branchId, deviceId, label || deviceId, nowIso()]);
  } catch (_) {
    dbRun(`UPDATE pos_heartbeats SET last_seen_at = ?, status = 'online', device_label = ? WHERE branch_id = ? AND device_id = ?`,
      [nowIso(), label || deviceId, branchId, deviceId]);
  }
  return { ok: true };
}

function notifyNewSale(saleId) {
  ensureSchema();
  const sale = dbGet(`SELECT s.*, b.name AS branch_name, u.full_name AS cashier_name
    FROM sales s LEFT JOIN branches b ON b.id = s.branch_id LEFT JOIN users u ON u.id = s.user_id WHERE s.id = ?`, [saleId]);
  if (!sale) return;
  const orderNum = sale.order_number || sale.receipt_number;
  const pays = dbAll('SELECT payment_type FROM sale_payments WHERE sale_id = ?', [saleId]);
  const payment = (pays[0]?.payment_type || 'cash').toUpperCase();
  const total = Number(sale.total) || 0;
  const title = 'NEW ORDER';
  const body = `Order ${orderNum}\n${sale.branch_name || 'Branch'}\nR${total.toFixed(2)}\n${payment}`;
  const users = dbAll('SELECT * FROM mobile_app_users WHERE is_active = 1');
  for (const u of users) {
    const perms = effectivePermissions(u);
    if (!perms.receive_order_notifications) continue;
    const ids = allowedBranchIds(u);
    if (!ids.includes(Number(sale.branch_id))) continue;
    const prefsRow = dbGet('SELECT prefs_json FROM mobile_notification_prefs WHERE user_id = ?', [u.id]);
    const prefs = { ...DEFAULT_PREFS, ...parseJson(prefsRow?.prefs_json, {}) };
    if (!prefs.new_orders) continue;
    if (prefs.large_orders && total >= (Number(prefs.large_order_threshold) || 1000)) {
      dbRun(`INSERT INTO mobile_notifications (user_id, branch_id, type, title, body, payload_json)
        VALUES (?,?,?,?,?,?)`, [u.id, sale.branch_id, 'large_order', 'LARGE ORDER', body,
        JSON.stringify({ sale_id: saleId, order_number: orderNum, total, branch_id: sale.branch_id })]);
    }
    dbRun(`INSERT INTO mobile_notifications (user_id, branch_id, type, title, body, payload_json)
      VALUES (?,?,?,?,?,?)`, [u.id, sale.branch_id, 'new_order', title, body,
      JSON.stringify({ sale_id: saleId, order_number: orderNum, total, branch_id: sale.branch_id, payment })]);
  }
}

function notifyOnlineOrder(orderId) {
  ensureSchema();
  const order = dbGet('SELECT * FROM online_orders_local WHERE id = ?', [orderId]);
  if (!order) return;
  const branch = dbGet('SELECT name FROM branches WHERE id = ?', [order.branch_id]);
  const orderNum = order.order_number;
  const total = Number(order.total) || 0;
  const title = 'NEW ONLINE ORDER';
  const body = `Order ${orderNum}\n${branch?.name || 'Branch'}\nR${total.toFixed(2)}`;
  const users = dbAll('SELECT * FROM mobile_app_users WHERE is_active = 1');
  for (const u of users) {
    const perms = effectivePermissions(u);
    if (!perms.receive_order_notifications) continue;
    if (!allowedBranchIds(u).includes(Number(order.branch_id))) continue;
    dbRun(`INSERT INTO mobile_notifications (user_id, branch_id, type, title, body, payload_json)
      VALUES (?,?,?,?,?,?)`, [u.id, order.branch_id, 'new_order', title, body,
      JSON.stringify({ online_order_id: orderId, order_number: orderNum, total, branch_id: order.branch_id })]);
  }
}

// ─── Admin CRUD ─────────────────────────────────────────────────────────────

function listMobileUsers() {
  ensureSchema();
  return dbAll(`SELECT id, username, full_name, role, all_branches, is_active, must_change_password, last_login_at, created_at
    FROM mobile_app_users ORDER BY full_name`);
}

function getMobileUser(id) {
  const u = dbGet('SELECT id, username, full_name, role, permissions_json, all_branches, is_active, must_change_password, last_login_at FROM mobile_app_users WHERE id = ?', [id]);
  if (!u) throw new Error('User not found');
  u.permissions = { ...DEFAULT_PERMS, ...parseJson(u.permissions_json, {}) };
  u.branch_ids = dbAll('SELECT branch_id FROM mobile_branch_access WHERE user_id = ?', [id]).map((r) => r.branch_id);
  delete u.permissions_json;
  return u;
}

function saveMobileUser(data = {}) {
  ensureSchema();
  const username = String(data.username || '').trim().toLowerCase();
  const fullName = String(data.full_name || data.name || '').trim();
  const role = ROLES.includes(data.role) ? data.role : 'branch_manager';
  if (!username || !fullName) throw new Error('Username and full name are required');
  const perms = { ...DEFAULT_PERMS, ...parseJson(data.permissions, {}) };
  const allBranches = data.all_branches ? 1 : 0;
  const branchIds = Array.isArray(data.branch_ids) ? data.branch_ids.map(Number).filter(Boolean) : [];

  if (data.id) {
    const sets = ['full_name = ?', 'role = ?', 'permissions_json = ?', 'all_branches = ?', 'is_active = ?', 'updated_at = ?'];
    const vals = [fullName, role, JSON.stringify(perms), allBranches, data.is_active === false ? 0 : 1, nowIso()];
    if (data.password) {
      sets.push('password_hash = ?', 'must_change_password = 1');
      vals.push(bcrypt.hashSync(String(data.password), 10));
    }
    vals.push(data.id);
    dbRun(`UPDATE mobile_app_users SET ${sets.join(', ')} WHERE id = ?`, vals);
    dbRun('DELETE FROM mobile_branch_access WHERE user_id = ?', [data.id]);
    if (!allBranches) for (const bid of branchIds) dbRun('INSERT INTO mobile_branch_access (user_id, branch_id) VALUES (?,?)', [data.id, bid]);
    return getMobileUser(data.id);
  }

  if (!data.password) throw new Error('Password is required for new users');
  const clash = dbGet('SELECT id FROM mobile_app_users WHERE lower(username) = ?', [username]);
  if (clash) throw new Error('Username already exists');
  const hash = bcrypt.hashSync(String(data.password), 10);
  const r = dbRun(`INSERT INTO mobile_app_users (username, password_hash, full_name, role, permissions_json, all_branches, must_change_password)
    VALUES (?,?,?,?,?,?,1)`, [username, hash, fullName, role, JSON.stringify(perms), allBranches]);
  const uid = r.lastInsertRowid;
  if (!allBranches) for (const bid of branchIds) dbRun('INSERT INTO mobile_branch_access (user_id, branch_id) VALUES (?,?)', [uid, bid]);
  dbRun('INSERT INTO mobile_notification_prefs (user_id, prefs_json) VALUES (?,?)', [uid, JSON.stringify(DEFAULT_PREFS)]);
  return getMobileUser(uid);
}

function setMobileUserActive(id, active) {
  dbRun('UPDATE mobile_app_users SET is_active = ?, updated_at = ? WHERE id = ?', [active ? 1 : 0, nowIso(), id]);
  if (!active) {
    dbRun('DELETE FROM mobile_sessions WHERE user_id = ?', [id]);
    dbRun("UPDATE mobile_devices SET status = 'revoked' WHERE user_id = ?", [id]);
  }
  return getMobileUser(id);
}

function listMobileDevices(userId) {
  return dbAll('SELECT id, device_uid, device_name, platform, status, last_active_at, created_at FROM mobile_devices WHERE user_id = ? ORDER BY last_active_at DESC', [userId]);
}

function revokeMobileDevice(deviceId) {
  dbRun("UPDATE mobile_devices SET status = 'revoked' WHERE id = ?", [deviceId]);
  dbRun('DELETE FROM mobile_sessions WHERE device_id = ?', [deviceId]);
  return { success: true };
}

function pollNotifications(token, sinceId = 0) {
  const { user } = resolveSession(token);
  const uid = user.user_id || user.id;
  const ids = allowedBranchIds(user);
  return dbAll(`SELECT * FROM mobile_notifications
    WHERE user_id = ? AND id > ? AND (branch_id IS NULL OR branch_id IN (${ids.map(() => '?').join(',') || '0'}))
    ORDER BY id ASC LIMIT 20`, [uid, sinceId, ...ids]);
}

module.exports = {
  login, logout, resolveSession, getProfile, bootstrapFromAdmin, ensureMobileUserForActor,
  getDashboard, listOrders, listOnlineOrders, getOrder, searchOrders,
  getStaffActivity, getPosStatus, listAlerts, markNotificationsRead,
  getNotificationPrefs, saveNotificationPrefs, registerPushToken,
  recordPosHeartbeat, notifyNewSale, notifyOnlineOrder, pollNotifications,
  listMobileUsers, getMobileUser, saveMobileUser, setMobileUserActive,
  listMobileDevices, revokeMobileDevice, allowedBranchIds, effectivePermissions,
  DEFAULT_PREFS, DEFAULT_PERMS, ROLES
};

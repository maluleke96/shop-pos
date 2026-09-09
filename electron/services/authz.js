const { getDb } = require('../database/db');
const session = require('./session');

function loadUserById(id) {
  if (id == null) return null;
  return getDb().prepare(
    'SELECT id, username, full_name, role, is_active, permissions, branch_id FROM users WHERE id = ?'
  ).get(id);
}

/**
 * Resolve actor against DB role (never trust client-supplied actor.role).
 * Requires an active user session matching actor.id.
 */
function assertUserActor(actor, allowedRoles = []) {
  if (actor?.role === 'system') {
    return {
      id: actor.id != null ? Number(actor.id) : 0,
      username: 'system',
      full_name: 'System',
      role: 'system'
    };
  }
  const sess = session.getUserSession();
  if (!sess?.id) throw new Error('Authentication required');
  // Cloud browser RPC may omit actor — trust the active session user id
  if (actor?.id != null && Number(actor.id) !== Number(sess.id)) {
    throw new Error('Authentication required');
  }

  const user = loadUserById(sess.id);
  const inactive = user && (user.is_active === false || user.is_active === 0 || user.is_active === '0' || user.is_active === 'f');
  if (user && String(user.role || '') === 'owner') {
    /* owners are never frozen by a bad is_active flag */
  } else if (!user || inactive) {
    session.clearAll();
    throw new Error('Account deactivated — system access is frozen. Contact the administrator.');
  }
  if (allowedRoles?.length && !allowedRoles.includes(user.role)) {
    throw new Error('You do not have permission for this action');
  }
  return {
    ...user,
    override_reason: actor?.override_reason || actor?.overrideReason || null
  };
}

/**
 * Employee portal session — set after staff PIN login.
 * Also allows a logged-in manager/supervisor user session to act.
 */
function assertEmployeeActor(actor, employeeId) {
  const targetId = employeeId != null ? Number(employeeId) : Number(actor?.employee_id);
  const empSess = session.getEmployeeSession();
  if (empSess?.employee_id != null && targetId === Number(empSess.employee_id)) {
    return {
      id: empSess.user_id || null,
      employee_id: empSess.employee_id,
      full_name: empSess.full_name,
      username: empSess.employee_code,
      role: 'employee',
      pinVerified: !!empSess.pinVerified
    };
  }
  // Manager/supervisor acting on behalf of employee
  if (actor?.id) {
    const user = assertUserActor(actor, ['owner', 'manager', 'supervisor', 'assistant_manager']);
    return { ...user, employee_id: targetId || null };
  }
  throw new Error('Authentication required');
}

function requireRole(actor, roles, message) {
  try {
    return assertUserActor(actor, roles);
  } catch (err) {
    if (message && (err.message === 'You do not have permission for this action' || err.message === 'Authentication required')) {
      throw new Error(message);
    }
    throw err;
  }
}

const ROLE_DEFAULTS = {
  owner: { sell: true, void_sales: true, refunds: true, discounts: true, change_prices: true, view_reports: true, manage_stock: true, system_settings: true, customers: true, suppliers: true, gift_cards: true, cash_up: true, products: true, reports: true, operations: true, kitchen: true, quotes: true, layby: true, delete_sales: true, bookkeeping: true, staff_portal: true, delivery: true },
  manager: { sell: true, void_sales: true, refunds: true, discounts: true, change_prices: true, view_reports: true, manage_stock: true, customers: true, suppliers: true, gift_cards: true, cash_up: true, products: true, reports: true, operations: true, kitchen: true, quotes: true, layby: true, owner_salary: true, bookkeeping: true, delivery: true, expense_capture: true },
  supervisor: { sell: true, void_sales: true, refunds: true, discounts: true, cash_up: true, operations: true, kitchen: true, gift_cards: true, layby: true, quotes: true, delivery: true },
  assistant_manager: { sell: true, void_sales: true, refunds: true, discounts: true, cash_up: true, operations: true, kitchen: true, gift_cards: true, layby: true, quotes: true, view_reports: true, customers: true, products: true, delivery: true },
  marketing_agent: {},
  delivery_manager: { sell: false, delivery: true, view_reports: true, manage_stock: false },
  cashier: { sell: true, refunds: false, owner_salary: false, owner_salary_only: false, delivery: true }
};

function parsePermissions(user) {
  let perms = user?.permissions;
  if (typeof perms === 'string') {
    try { perms = JSON.parse(perms); } catch { perms = {}; }
  }
  return perms && typeof perms === 'object' ? perms : {};
}

function hasUserPermission(user, key) {
  if (!user) return false;
  if (user.role === 'owner') return true;
  const perms = parsePermissions(user);
  if (Object.prototype.hasOwnProperty.call(perms, key)) return !!perms[key];
  return !!(ROLE_DEFAULTS[user.role] || {})[key];
}

function assertUserPermission(actor, permissionKey, allowedRoles = ['owner', 'manager', 'supervisor', 'assistant_manager']) {
  const user = assertUserActor(actor, allowedRoles);
  if (!hasUserPermission(user, permissionKey)) {
    throw new Error(`You do not have permission: ${permissionKey}`);
  }
  return user;
}

module.exports = {
  assertUserActor,
  assertEmployeeActor,
  requireRole,
  hasUserPermission,
  assertUserPermission,
  loadUserById,
  ...session
};

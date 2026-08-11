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
  const sess = session.getUserSession();
  if (!sess?.id) throw new Error('Authentication required');
  if (!actor?.id || Number(actor.id) !== Number(sess.id)) {
    throw new Error('Authentication required');
  }

  const user = loadUserById(sess.id);
  if (!user || !user.is_active) {
    session.clearAll();
    throw new Error('Account deactivated — system access is frozen. Contact the administrator.');
  }
  if (allowedRoles?.length && !allowedRoles.includes(user.role)) {
    throw new Error('You do not have permission for this action');
  }
  return {
    ...user,
    override_reason: actor.override_reason || actor.overrideReason || null
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

module.exports = {
  assertUserActor,
  assertEmployeeActor,
  requireRole,
  loadUserById,
  ...session
};

/** In-process session state for Electron / mobile / cloud (AsyncLocalStorage). */

const { AsyncLocalStorage } = require('async_hooks');

const als = new AsyncLocalStorage();

let userSession = null;
let employeeSession = null;

function bucket() {
  return als.getStore() || null;
}

function runWithContext(ctx, fn) {
  return als.run(ctx || { userSession: null, employeeSession: null }, fn);
}

function setUserSession(user) {
  const value = !user?.id ? null : {
    id: user.id,
    username: user.username,
    full_name: user.full_name,
    role: user.role,
    branch_id: user.branch_id ?? null,
    permissions: user.permissions ?? null
  };
  const b = bucket();
  if (b) {
    b.userSession = value;
    return value;
  }
  userSession = value;
  return value;
}

function getUserSession() {
  const b = bucket();
  if (b) return b.userSession ?? null;
  return userSession;
}

function clearUserSession() {
  const b = bucket();
  if (b) {
    b.userSession = null;
    return;
  }
  userSession = null;
}

function setEmployeeSession(emp) {
  const id = emp?.id ?? emp?.employee_id;
  const value = !id ? null : {
    id: Number(id),
    employee_id: Number(id),
    employee_code: emp.employee_code || null,
    full_name: emp.full_name || null,
    user_id: emp.user_id ?? null,
    pinVerified: true
  };
  const b = bucket();
  if (b) {
    b.employeeSession = value;
    return value;
  }
  employeeSession = value;
  return value;
}

function getEmployeeSession() {
  const b = bucket();
  if (b) return b.employeeSession ?? null;
  return employeeSession;
}

function clearEmployeeSession() {
  const b = bucket();
  if (b) {
    b.employeeSession = null;
    return;
  }
  employeeSession = null;
}

function clearAllSessions() {
  clearUserSession();
  clearEmployeeSession();
}

/** Alias used by store.logout */
function clearAll() {
  return clearAllSessions();
}

function snapshotContext() {
  return {
    userSession: getUserSession(),
    employeeSession: getEmployeeSession()
  };
}

module.exports = {
  setUserSession,
  getUserSession,
  clearUserSession,
  setEmployeeSession,
  getEmployeeSession,
  clearEmployeeSession,
  clearAllSessions,
  clearAll,
  runWithContext,
  snapshotContext
};

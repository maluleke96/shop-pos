/**
 * Central staff identity on the existing users table.
 * Blocking and archiving never delete sales, expenses, stock, or audit rows.
 * A transfer records current ownership without replacing the original person.
 */
const bcrypt = require('bcryptjs');
const { getDb } = require('../database/db');

const LOCKED = new Set(['BLOCKED', 'INACTIVE', 'TERMINATED', 'DELETED']);
const STATUSES = ['ACTIVE', 'BLOCKED', 'INACTIVE', 'TERMINATED', 'DELETED'];

const COUNT_SOURCES = [
  { key: 'sales', table: 'sales', column: 'user_id' },
  { key: 'refunds', table: 'returns', column: 'user_id' },
  { key: 'expenses', table: 'expenses', column: 'user_id' },
  { key: 'stock_adjustments', table: 'stock_movements', column: 'user_id' },
  { key: 'wastage', table: 'waste_records', column: 'user_id' },
  { key: 'purchases', table: 'purchase_orders', column: 'user_id' },
  { key: 'deliveries', table: 'deliveries', column: 'user_id' },
  { key: 'discounts', table: 'sales', column: 'user_id', where: 'discount > 0' }
];

let ready = false;

function db() { return getDb(); }

function execIgnore(sql) {
  try { db().exec(sql); } catch (_) { /* column or table already there */ }
}

function isInactiveFlag(v) {
  return v === false || v === 0 || v === '0' || v === 'f' || v === 'false' || v === 'n';
}

function statusOf(user) {
  return String(user?.access_status || '').trim().toUpperCase();
}

function denialMessage(user) {
  if (!user) return 'ACCOUNT BLOCKED BY ADMIN';
  const status = statusOf(user);
  if (status === 'BLOCKED' || status === 'DELETED' || status === 'TERMINATED') return 'ACCOUNT BLOCKED BY ADMIN';
  if (status === 'INACTIVE' || isInactiveFlag(user.is_active)) {
    if (String(user.role || '') === 'owner' && !status) return null;
    if (String(user.role || '') === 'owner' && status === 'ACTIVE') return null;
    return 'Account deactivated — system access is frozen. Contact the administrator.';
  }
  if (status && status !== 'ACTIVE' && LOCKED.has(status)) return 'ACCOUNT BLOCKED BY ADMIN';
  return null;
}

function ensureStaffIdentity() {
  if (ready) return;
  const cols = [
    'staff_code TEXT',
    'access_status TEXT',
    'pos_terminal TEXT',
    'modules_json TEXT',
    'blocked_at TEXT',
    'blocked_by INTEGER',
    'blocked_by_name TEXT',
    'block_reason TEXT',
    'status_changed_at TEXT',
    'status_changed_by INTEGER',
    'status_reason TEXT',
    'deleted_at TEXT',
    'deleted_by INTEGER',
    'deleted_by_name TEXT',
    'delete_reason TEXT',
    'session_epoch INTEGER DEFAULT 0'
  ];
  for (const col of cols) execIgnore(`ALTER TABLE users ADD COLUMN ${col}`);
  execIgnore(`CREATE TABLE IF NOT EXISTS staff_ownership_transfers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_user_id INTEGER NOT NULL,
    from_staff_code TEXT,
    from_name_snapshot TEXT,
    to_user_id INTEGER,
    to_name_snapshot TEXT,
    transferred_by INTEGER,
    transferred_by_name TEXT,
    transferred_at TEXT,
    reason TEXT,
    mode TEXT,
    counts_json TEXT
  )`);
  execIgnore(`CREATE TABLE IF NOT EXISTS staff_status_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    from_status TEXT,
    to_status TEXT,
    actor_id INTEGER,
    actor_name TEXT,
    reason TEXT,
    details_json TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  backfill();
  ready = true;
}

function backfill() {
  let rows = [];
  try {
    rows = db().prepare('SELECT id, role, is_active, access_status, staff_code FROM users ORDER BY id').all();
  } catch (_) {
    return;
  }
  let next = 1;
  for (const row of rows) {
    const m = String(row.staff_code || '').match(/^EMP-(\d+)$/i);
    if (m) next = Math.max(next, Number(m[1]) + 1);
  }
  const setStatus = db().prepare('UPDATE users SET access_status = ? WHERE id = ?');
  const setCode = db().prepare('UPDATE users SET staff_code = ? WHERE id = ?');
  for (const row of rows) {
    if (!statusOf(row)) {
      const inactive = isInactiveFlag(row.is_active);
      const status = String(row.role || '') === 'owner' ? 'ACTIVE' : (inactive ? 'INACTIVE' : 'ACTIVE');
      try { setStatus.run(status, row.id); } catch (_) { /* */ }
    }
    if (!row.staff_code) {
      try { setCode.run(`EMP-${String(next).padStart(5, '0')}`, row.id); next += 1; } catch (_) { /* */ }
    }
  }
}

function nextStaffCode() {
  ensureStaffIdentity();
  const rows = db().prepare("SELECT staff_code FROM users WHERE staff_code LIKE 'EMP-%'").all();
  let next = 1;
  for (const row of rows) {
    const m = String(row.staff_code || '').match(/^EMP-(\d+)$/i);
    if (m) next = Math.max(next, Number(m[1]) + 1);
  }
  return `EMP-${String(next).padStart(5, '0')}`;
}

function assignStaffCode(userId) {
  ensureStaffIdentity();
  const row = db().prepare('SELECT staff_code FROM users WHERE id = ?').get(userId);
  if (row?.staff_code) return row.staff_code;
  const code = nextStaffCode();
  db().prepare("UPDATE users SET staff_code = ?, access_status = COALESCE(NULLIF(access_status, ''), 'ACTIVE') WHERE id = ?").run(code, userId);
  return code;
}

function loadUser(userId) {
  ensureStaffIdentity();
  const user = db().prepare('SELECT * FROM users WHERE id = ?').get(Number(userId));
  if (!user) throw new Error('Staff profile not found');
  return user;
}

function loadActor(actorId) {
  let actor = null;
  try {
    actor = db().prepare('SELECT id, username, full_name, role, password_hash, is_active, access_status FROM users WHERE id = ?').get(Number(actorId));
  } catch (_) {
    actor = db().prepare('SELECT id, username, full_name, role, password_hash, is_active FROM users WHERE id = ?').get(Number(actorId));
  }
  if (!actor) throw new Error('Admin session not found');
  return actor;
}

function requireOwner(actor) {
  if (String(actor?.role || '') !== 'owner') throw new Error('Only the Main Admin can do this');
  if (denialMessage(actor)) throw new Error(denialMessage(actor));
  return actor;
}

function confirmPassword(actor, password) {
  const pass = String(password || '');
  if (!pass) throw new Error('Enter the Main Admin password to confirm');
  let ok = false;
  try { ok = !!(actor.password_hash && bcrypt.compareSync(pass, actor.password_hash)); } catch (_) { ok = false; }
  if (!ok) throw new Error('Admin password confirmation failed');
}

function activeOwnerCount(exceptId) {
  const rows = db().prepare("SELECT id, is_active, access_status FROM users WHERE role = 'owner'").all();
  return rows.filter((r) => Number(r.id) !== Number(exceptId) && !denialMessage({ ...r, role: 'owner' }) && !LOCKED.has(statusOf(r))).length;
}

function assertCanLock(actor, user) {
  if (Number(user.id) === Number(actor.id)) throw new Error('You cannot lock your own Main Admin account');
  if (String(user.role) === 'owner') {
    if (activeOwnerCount(user.id) < 1) throw new Error('The Main Admin account cannot be blocked or deleted');
  }
}

function writeEvent(userId, action, fromStatus, toStatus, actor, reason, details) {
  try {
    db().prepare(`INSERT INTO staff_status_events (user_id, action, from_status, to_status, actor_id, actor_name, reason, details_json)
      VALUES (?,?,?,?,?,?,?,?)`).run(
      userId, action, fromStatus || null, toStatus || null, actor?.id || null, actor?.full_name || actor?.username || null,
      reason || null, details ? JSON.stringify(details) : null
    );
  } catch (_) { /* timeline is best-effort */ }
}

function audit(actor, action, userId, details) {
  try {
    db().prepare(`INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, details)
      VALUES (?,?,?,?,?,?)`).run(
      actor?.id || null, actor?.full_name || actor?.username || 'admin', action, 'user', userId,
      details ? JSON.stringify(details) : null
    );
  } catch (_) { /* */ }
}

function revokeModuleSessions(userId) {
  let names = [];
  try {
    const pg = require('../database/pg-db');
    if (pg.isPgMode?.()) {
      names = db().prepare(
        "SELECT table_name AS name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'user_id'"
      ).all().map((r) => r.name);
    } else {
      const tables = db().prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all();
      names = tables.map((t) => t.name).filter((name) => {
        try {
          return db().prepare(`PRAGMA table_info(${name})`).all().some((c) => c.name === 'user_id');
        } catch (_) { return false; }
      });
    }
  } catch (_) { names = []; }
  for (const name of names) {
    if (!/session/i.test(String(name))) continue;
    if (!/^[a-zA-Z0-9_]+$/.test(name)) continue;
    try { db().prepare(`DELETE FROM ${name} WHERE user_id = ?`).run(userId); } catch (_) { /* */ }
  }
}

function bumpEpoch(userId) {
  try {
    db().prepare('UPDATE users SET session_epoch = COALESCE(session_epoch, 0) + 1 WHERE id = ?').run(userId);
  } catch (_) { /* */ }
}

function syncEmployeeStatus(userId, employeeStatus) {
  try {
    db().prepare('UPDATE employees SET status = ? WHERE user_id = ?').run(employeeStatus, userId);
  } catch (_) { /* HR profile is optional */ }
}

function invalidateLogin(userId) {
  const dead = bcrypt.hashSync(`revoked-${Date.now()}-${Math.random()}`, 8);
  try { db().prepare('UPDATE users SET password_hash = ?, pin = NULL WHERE id = ?').run(dead, userId); } catch (_) { /* */ }
}

function emptyCounts() {
  const counts = {};
  for (const src of COUNT_SOURCES) counts[src.key] = 0;
  return counts;
}

function historyCounts(userId) {
  ensureStaffIdentity();
  const counts = emptyCounts();
  for (const src of COUNT_SOURCES) {
    try {
      const where = src.where ? ` AND ${src.where}` : '';
      const row = db().prepare(`SELECT COUNT(*) AS c FROM ${src.table} WHERE ${src.column} = ?${where}`).get(userId);
      counts[src.key] = Number(row?.c) || 0;
    } catch (_) {
      counts[src.key] = 0;
    }
  }
  return counts;
}

function batchHistory(userIds) {
  const wanted = new Set(userIds.map((id) => Number(id)));
  const byUser = {};
  for (const id of wanted) byUser[id] = emptyCounts();
  for (const src of COUNT_SOURCES) {
    try {
      const where = src.where ? ` WHERE ${src.where}` : '';
      const rows = db().prepare(`SELECT ${src.column} AS uid, COUNT(*) AS c FROM ${src.table}${where} GROUP BY ${src.column}`).all();
      for (const row of rows) {
        const id = Number(row.uid);
        if (!byUser[id]) continue;
        byUser[id][src.key] = Number(row.c) || 0;
      }
    } catch (_) { /* table may not exist on this shop */ }
  }
  return byUser;
}

function latestTransfersMap() {
  const map = {};
  try {
    const rows = db().prepare('SELECT * FROM staff_ownership_transfers ORDER BY id DESC').all();
    for (const row of rows) {
      const id = Number(row.from_user_id);
      if (!map[id]) map[id] = row;
    }
  } catch (_) { /* archive table is created on first use */ }
  return map;
}

function lastLogins() {
  const map = {};
  try {
    const rows = db().prepare('SELECT user_id, MAX(event_at) AS last_login FROM user_login_events GROUP BY user_id').all();
    for (const row of rows) map[Number(row.user_id)] = row.last_login || null;
  } catch (_) { /* login history is optional */ }
  return map;
}

function shapeTransfer(transfer) {
  if (!transfer) return null;
  let counts = {};
  try { counts = JSON.parse(transfer.counts_json || '{}'); } catch (_) { counts = {}; }
  return {
    mode: transfer.mode,
    to_name: transfer.to_name_snapshot,
    by_name: transfer.transferred_by_name,
    at: transfer.transferred_at,
    reason: transfer.reason,
    counts
  };
}

function latestTransfer(userId) {
  ensureStaffIdentity();
  try {
    return db().prepare(`SELECT * FROM staff_ownership_transfers WHERE from_user_id = ? ORDER BY id DESC LIMIT 1`).get(Number(userId)) || null;
  } catch (_) {
    return null;
  }
}

function decorateRecord(record, userIdField = 'user_id') {
  if (!record) return record;
  const id = record[userIdField];
  if (!id) return record;
  const transfer = latestTransfer(id);
  if (!transfer || transfer.mode !== 'transfer') return record;
  record.ownership_transferred = 1;
  record.original_staff_id = transfer.from_user_id;
  record.original_staff_name = transfer.from_name_snapshot;
  record.original_staff_code = transfer.from_staff_code;
  record.current_owner_id = transfer.to_user_id;
  record.current_owner_name = transfer.to_name_snapshot;
  record.transferred_by_name = transfer.transferred_by_name;
  record.transferred_at = transfer.transferred_at;
  record.transfer_reason = transfer.reason;
  return record;
}

function publicUser(row, extras) {
  if (!row) return null;
  const { password_hash, pin, ...safe } = row;
  let modules = [];
  try { modules = JSON.parse(safe.modules_json || '[]'); } catch (_) { modules = []; }
  if (!Array.isArray(modules)) modules = [];
  const transferRow = extras && Object.prototype.hasOwnProperty.call(extras, 'transfer')
    ? extras.transfer
    : latestTransfer(safe.id);
  const history = extras?.history ? { ...emptyCounts(), ...extras.history } : historyCounts(safe.id);
  return {
    ...safe,
    modules,
    has_pin: !!(row.pin),
    last_login: extras?.last_login || null,
    history,
    transfer: shapeTransfer(transferRow)
  };
}

function listStaff() {
  ensureStaffIdentity();
  let rows = [];
  try {
    rows = db().prepare(`SELECT u.*, b.name AS branch_name
      FROM users u LEFT JOIN branches b ON b.id = u.branch_id
      ORDER BY u.full_name`).all();
  } catch (_) {
    rows = db().prepare('SELECT * FROM users ORDER BY full_name').all();
  }
  const histories = batchHistory(rows.map((row) => row.id));
  const transfers = latestTransfersMap();
  const logins = lastLogins();
  return rows.map((row) => publicUser(row, {
    history: histories[Number(row.id)] || emptyCounts(),
    transfer: transfers[Number(row.id)] || null,
    last_login: logins[Number(row.id)] || null
  }));
}

function mainAdmin() {
  return db().prepare("SELECT id, full_name, username, staff_code FROM users WHERE role = 'owner' AND (access_status IS NULL OR access_status = '' OR upper(access_status) = 'ACTIVE') ORDER BY id LIMIT 1").get();
}

function setStatus({ userId, status, reason, actorId, actorName, password }) {
  ensureStaffIdentity();
  const next = String(status || '').toUpperCase();
  if (!STATUSES.includes(next)) throw new Error('Unknown staff status');
  const actor = loadActor(actorId);
  const user = loadUser(userId);
  if (next === 'BLOCKED' || next === 'TERMINATED' || next === 'DELETED') requireOwner(actor);
  else if (!['owner', 'manager'].includes(actor.role)) throw new Error('Only the Main Admin can do this');
  if (next !== 'ACTIVE') assertCanLock(actor, user);
  if (next === 'DELETED') throw new Error('Use archive to delete a staff profile');
  if (statusOf(user) === 'DELETED' && next === 'ACTIVE') {
    throw new Error('A deleted profile stays in the archive. Historical records remain available.');
  }
  if (String(user.role) === 'owner' && actor.role !== 'owner') {
    throw new Error('Only the Main Admin can change an owner account');
  }
  const from = statusOf(user) || (isInactiveFlag(user.is_active) ? 'INACTIVE' : 'ACTIVE');
  const now = new Date().toISOString();
  const active = next === 'ACTIVE' ? 1 : 0;
  const fields = ['access_status = ?', 'is_active = ?', 'status_changed_at = ?', 'status_changed_by = ?', 'status_reason = ?', "updated_at = datetime('now')"];
  const values = [next, active, now, actor.id, reason || null];
  if (next === 'BLOCKED') {
    fields.push('blocked_at = ?', 'blocked_by = ?', 'blocked_by_name = ?', 'block_reason = ?');
    values.push(now, actor.id, actor.full_name || actor.username, reason || null);
  }
  if (next === 'ACTIVE') {
    fields.push('blocked_at = NULL', 'block_reason = NULL');
  }
  values.push(user.id);
  db().prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  if (next !== 'ACTIVE') {
    bumpEpoch(user.id);
    revokeModuleSessions(user.id);
    syncEmployeeStatus(user.id, next === 'BLOCKED' ? 'Suspended' : 'Inactive');
  } else {
    syncEmployeeStatus(user.id, 'Active');
  }
  const action = next === 'BLOCKED' ? 'staff_blocked' : (next === 'ACTIVE' ? 'staff_unblocked' : 'staff_status');
  writeEvent(user.id, action, from, next, actor, reason, null);
  audit(actor, action, user.id, {
    staff_code: user.staff_code, name: user.full_name, from, to: next, reason: reason || null
  });
  return publicUser(loadUser(user.id));
}

function forceLogout({ userId, actorId }) {
  ensureStaffIdentity();
  const actor = requireOwner(loadActor(actorId));
  const user = loadUser(userId);
  bumpEpoch(user.id);
  revokeModuleSessions(user.id);
  writeEvent(user.id, 'force_logout', statusOf(user), statusOf(user), actor, 'Force logout', null);
  audit(actor, 'staff_force_logout', user.id, { staff_code: user.staff_code, name: user.full_name });
  return { success: true };
}

function recordTransfer(user, actor, mode, reason) {
  const counts = historyCounts(user.id);
  const admin = mainAdmin();
  const toId = mode === 'transfer' ? (admin?.id || actor.id) : user.id;
  const toName = mode === 'transfer' ? (admin?.full_name || actor.full_name || 'Main Admin') : user.full_name;
  const now = new Date().toISOString();
  db().prepare(`INSERT INTO staff_ownership_transfers (
      from_user_id, from_staff_code, from_name_snapshot, to_user_id, to_name_snapshot,
      transferred_by, transferred_by_name, transferred_at, reason, mode, counts_json
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    user.id, user.staff_code, user.full_name, toId, toName,
    actor.id, actor.full_name || actor.username, now, reason || null, mode, JSON.stringify(counts)
  );
  return { counts, toId, toName, at: now };
}

function archiveStaff({ userId, mode, reason, password, confirmUsername, actorId, actorName }) {
  ensureStaffIdentity();
  const actor = requireOwner(loadActor(actorId));
  confirmPassword(actor, password);
  const user = loadUser(userId);
  assertCanLock(actor, user);
  if (confirmUsername && String(confirmUsername).trim() !== String(user.username)) {
    throw new Error('Type the exact username to confirm');
  }
  const chosen = mode === 'transfer' ? 'transfer' : 'preserve';
  if (!reason || !String(reason).trim()) throw new Error('A reason is required');
  const from = statusOf(user) || 'ACTIVE';
  const moved = recordTransfer(user, actor, chosen, String(reason).trim());
  const now = new Date().toISOString();
  db().prepare(`UPDATE users SET access_status = 'DELETED', is_active = 0, deleted_at = ?, deleted_by = ?, deleted_by_name = ?,
      delete_reason = ?, status_changed_at = ?, status_changed_by = ?, status_reason = ?, updated_at = datetime('now')
      WHERE id = ?`).run(now, actor.id, actor.full_name || actor.username, String(reason).trim(), now, actor.id, String(reason).trim(), user.id);
  invalidateLogin(user.id);
  bumpEpoch(user.id);
  revokeModuleSessions(user.id);
  syncEmployeeStatus(user.id, 'Inactive');
  writeEvent(user.id, 'staff_archived', from, 'DELETED', actor, reason, { mode: chosen, counts: moved.counts, to: moved.toName });
  audit(actor, 'staff_archived', user.id, {
    staff_code: user.staff_code,
    name: user.full_name,
    mode: chosen,
    historical_records: 'preserved',
    current_owner: moved.toName,
    originally_performed_by: user.full_name,
    counts: moved.counts,
    reason: String(reason).trim()
  });
  return publicUser(loadUser(user.id));
}

function transferHistory({ userId, reason, password, actorId }) {
  ensureStaffIdentity();
  const actor = requireOwner(loadActor(actorId));
  confirmPassword(actor, password);
  const user = loadUser(userId);
  if (!reason || !String(reason).trim()) throw new Error('A reason is required');
  const moved = recordTransfer(user, actor, 'transfer', String(reason).trim());
  writeEvent(user.id, 'history_transferred', statusOf(user), statusOf(user), actor, reason, moved.counts);
  audit(actor, 'staff_history_transferred', user.id, {
    staff_code: user.staff_code,
    originally_performed_by: user.full_name,
    current_owner: moved.toName,
    counts: moved.counts,
    reason: String(reason).trim()
  });
  return publicUser(loadUser(user.id));
}

function profile(userId) {
  const user = publicUser(loadUser(userId));
  let events = [];
  try {
    events = db().prepare('SELECT * FROM staff_status_events WHERE user_id = ? ORDER BY id DESC LIMIT 100').all(userId);
  } catch (_) { events = []; }
  return { user, events };
}

function board() {
  const users = listStaff();
  const blocked = users.filter((u) => statusOf(u) === 'BLOCKED');
  const archived = users.filter((u) => statusOf(u) === 'DELETED');
  let transfers = [];
  try {
    transfers = db().prepare('SELECT * FROM staff_ownership_transfers ORDER BY id DESC LIMIT 200').all();
  } catch (_) { transfers = []; }
  return { users, blocked, archived, transfers };
}

const PURGE_TABLES = {
  sales: 'id',
  returns: 'id',
  expenses: 'id',
  stock_movements: 'id',
  waste_records: 'id',
  purchase_orders: 'id'
};

function purgeHistoricalRecord({ table, recordId, reason, password, actorId }) {
  ensureStaffIdentity();
  const actor = requireOwner(loadActor(actorId));
  confirmPassword(actor, password);
  const idCol = PURGE_TABLES[table];
  if (!idCol) throw new Error('This record type cannot be purged');
  if (!reason || !String(reason).trim()) throw new Error('A reason is required');
  const id = Number(recordId);
  if (!id) throw new Error('Record id required');
  const before = db().prepare(`SELECT * FROM ${table} WHERE ${idCol} = ?`).get(id);
  if (!before) throw new Error('Record not found');
  audit(actor, 'historical_record_purged', id, {
    table, record_id: id, reason: String(reason).trim(),
    warning: 'This action permanently removes historical business data and cannot be undone.',
    before
  });
  db().prepare(`DELETE FROM ${table} WHERE ${idCol} = ?`).run(id);
  return { success: true, table, record_id: id };
}

function command(actor, payload = {}) {
  ensureStaffIdentity();
  const action = String(payload.action || '');
  const actorId = actor?.id;
  const actorName = actor?.username;
  let role = actor?.role;
  try { role = loadActor(actorId).role || role; } catch (_) { /* use the session role */ }
  if (action === 'board' || action === 'profile') {
    if (!['owner', 'manager', 'supervisor', 'assistant_manager'].includes(role)) {
      throw new Error('You do not have permission for this action');
    }
    return action === 'board' ? board() : profile(payload.userId);
  }
  if (action === 'block') {
    return setStatus({ userId: payload.userId, status: 'BLOCKED', reason: payload.reason, actorId, actorName });
  }
  if (action === 'unblock') {
    return setStatus({ userId: payload.userId, status: 'ACTIVE', reason: payload.reason || 'Unblocked', actorId, actorName });
  }
  if (action === 'deactivate') {
    return setStatus({ userId: payload.userId, status: 'INACTIVE', reason: payload.reason || 'Deactivated', actorId, actorName });
  }
  if (action === 'terminate') {
    return setStatus({ userId: payload.userId, status: 'TERMINATED', reason: payload.reason, actorId, actorName });
  }
  if (action === 'archive') {
    return archiveStaff({
      userId: payload.userId, mode: payload.mode, reason: payload.reason,
      password: payload.password, confirmUsername: payload.confirmUsername, actorId, actorName
    });
  }
  if (action === 'transfer') {
    return transferHistory({ userId: payload.userId, reason: payload.reason, password: payload.password, actorId });
  }
  if (action === 'logout') return forceLogout({ userId: payload.userId, actorId });
  if (action === 'purge') {
    return purgeHistoricalRecord({
      table: payload.table, recordId: payload.recordId, reason: payload.reason,
      password: payload.password, actorId
    });
  }
  throw new Error('Unknown staff action');
}

module.exports = {
  ensureStaffIdentity,
  denialMessage,
  statusOf,
  assignStaffCode,
  decorateRecord,
  listStaff,
  historyCounts,
  command,
  LOCKED
};

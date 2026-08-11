const { getDb } = require('../database/db');

function audit(actorId, actorName, action, entityType, entityId, details) {
  getDb().prepare(`INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, details) VALUES (?,?,?,?,?,?)`)
    .run(actorId || null, actorName || 'system', action, entityType, entityId || null, details ? JSON.stringify(details) : null);
}

function today() {
  return new Date().toLocaleDateString('en-CA');
}

function getStaffSelfies(filters = {}) {
  let sql = `SELECT s.*, e.full_name as employee_name, e.employee_code, e.branch, e.position
    FROM staff_login_selfies s
    JOIN employees e ON e.id = s.employee_id WHERE 1=1`;
  const params = [];
  if (filters.employee_id) { sql += ' AND s.employee_id = ?'; params.push(filters.employee_id); }
  if (filters.login_date) { sql += ' AND s.login_date = ?'; params.push(filters.login_date); }
  if (filters.from) { sql += ' AND s.login_date >= ?'; params.push(filters.from); }
  if (filters.to) { sql += ' AND s.login_date <= ?'; params.push(filters.to); }
  if (filters.branch) { sql += ' AND e.branch = ?'; params.push(filters.branch); }
  sql += ' ORDER BY s.login_at DESC';
  if (filters.limit) { sql += ' LIMIT ?'; params.push(filters.limit); }
  return getDb().prepare(sql).all(...params);
}

function getStaffSelfie(id) {
  return getDb().prepare(`
    SELECT s.*, e.full_name as employee_name, e.employee_code, e.branch, e.position
    FROM staff_login_selfies s JOIN employees e ON e.id = s.employee_id WHERE s.id = ?`).get(id);
}

function saveStaffSelfie(data) {
  const db = getDb();
  const loginDate = data.login_date || today();
  if (!data.employee_id || !data.photo_data) throw new Error('Employee and photo required');
  const existing = db.prepare(
    'SELECT id FROM staff_login_selfies WHERE employee_id = ? AND login_date = ? AND is_edited = 0 ORDER BY login_at DESC LIMIT 1'
  ).get(data.employee_id, loginDate);
  const r = db.prepare(`
    INSERT INTO staff_login_selfies (employee_id, photo_data, login_date, device_info)
    VALUES (?,?,?,?)`).run(data.employee_id, data.photo_data, loginDate, data.device_info || null);
  audit(null, data.employee_name || 'staff', 'staff_selfie_login', 'staff_login_selfie', r.lastInsertRowid, {
    employee_id: data.employee_id, login_date: loginDate
  });
  return getStaffSelfie(r.lastInsertRowid);
}

function updateStaffSelfie(id, photoData, actorId, actorName, notes) {
  const db = getDb();
  const row = getStaffSelfie(id);
  if (!row) throw new Error('Selfie not found');
  const original = row.is_edited ? row.original_photo_data : row.photo_data;
  db.prepare(`
    UPDATE staff_login_selfies SET photo_data=?, is_edited=1, edited_at=datetime('now'),
      edited_by=?, edited_by_name=?, edit_notes=?, original_photo_data=?
    WHERE id=?`).run(photoData, actorId || null, actorName || null, notes || null, original, id);
  audit(actorId, actorName, 'edit_staff_selfie', 'staff_login_selfie', id, { notes });
  return getStaffSelfie(id);
}

function deleteStaffSelfie(id, actorId, actorName) {
  getDb().prepare('DELETE FROM staff_login_selfies WHERE id = ?').run(id);
  audit(actorId, actorName, 'delete_staff_selfie', 'staff_login_selfie', id, null);
  return true;
}

module.exports = {
  getStaffSelfies, getStaffSelfie, saveStaffSelfie, updateStaffSelfie, deleteStaffSelfie
};

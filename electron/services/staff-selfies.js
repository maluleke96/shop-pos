const { getDb } = require('../database/db');

function audit(actorId, actorName, action, entityType, entityId, details) {
  getDb().prepare(`INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, details) VALUES (?,?,?,?,?,?)`)
    .run(actorId || null, actorName || 'system', action, entityType, entityId || null, details ? JSON.stringify(details) : null);
}

function today() {
  return new Date().toLocaleDateString('en-CA');
}

function ensureSelfieEventTypeColumn() {
  try {
    getDb().prepare(`ALTER TABLE staff_login_selfies ADD COLUMN event_type TEXT DEFAULT 'login'`).run();
  } catch (_) { /* already exists */ }
}

function selfieEventType(row) {
  if (row?.event_type) return row.event_type;
  try {
    const parsed = JSON.parse(row?.device_info || '');
    if (parsed && typeof parsed === 'object' && parsed.event_type) return parsed.event_type;
  } catch (_) { /* plain string */ }
  const m = String(row?.device_info || '').match(/^event:([^|]+)/);
  return m ? m[1] : 'login';
}

function getStaffSelfies(filters = {}) {
  ensureSelfieEventTypeColumn();
  let sql = `SELECT s.*, e.full_name as employee_name, e.employee_code, e.branch, e.position
    FROM staff_login_selfies s
    JOIN employees e ON e.id = s.employee_id WHERE 1=1`;
  const params = [];
  if (filters.employee_id) { sql += ' AND s.employee_id = ?'; params.push(filters.employee_id); }
  if (filters.login_date) { sql += ' AND s.login_date = ?'; params.push(filters.login_date); }
  if (filters.from) { sql += ' AND s.login_date >= ?'; params.push(filters.from); }
  if (filters.to) { sql += ' AND s.login_date <= ?'; params.push(filters.to); }
  if (filters.branch) { sql += ' AND e.branch = ?'; params.push(filters.branch); }
  if (filters.event_type) { sql += ' AND COALESCE(s.event_type, \'login\') = ?'; params.push(filters.event_type); }
  sql += ' ORDER BY s.login_at DESC';
  if (filters.limit) { sql += ' LIMIT ?'; params.push(filters.limit); }
  return getDb().prepare(sql).all(...params).map((row) => ({ ...row, event_type: selfieEventType(row) }));
}

function getStaffSelfie(id) {
  const row = getDb().prepare(`
    SELECT s.*, e.full_name as employee_name, e.employee_code, e.branch, e.position
    FROM staff_login_selfies s JOIN employees e ON e.id = s.employee_id WHERE s.id = ?`).get(id);
  return row ? { ...row, event_type: selfieEventType(row) } : null;
}

function saveStaffSelfie(data) {
  const db = getDb();
  ensureSelfieEventTypeColumn();
  const loginDate = data.login_date || today();
  if (!data.employee_id || !data.photo_data) throw new Error('Employee and photo required');
  const eventType = data.event_type || 'login';
  let deviceInfo = data.device_info || null;
  if (deviceInfo && typeof deviceInfo === 'object') deviceInfo = JSON.stringify(deviceInfo);
  if (!deviceInfo) deviceInfo = JSON.stringify({ event_type: eventType });
  else if (typeof deviceInfo === 'string' && !deviceInfo.includes(eventType)) {
    try {
      const parsed = JSON.parse(deviceInfo);
      if (parsed && typeof parsed === 'object') {
        parsed.event_type = eventType;
        deviceInfo = JSON.stringify(parsed);
      }
    } catch {
      deviceInfo = `event:${eventType}|${deviceInfo}`;
    }
  }
  let insertId;
  try {
    const r = db.prepare(`
      INSERT INTO staff_login_selfies (employee_id, photo_data, login_date, device_info, event_type)
      VALUES (?,?,?,?,?)`).run(data.employee_id, data.photo_data, loginDate, deviceInfo, eventType);
    insertId = r.lastInsertRowid;
  } catch (_) {
    const r = db.prepare(`
      INSERT INTO staff_login_selfies (employee_id, photo_data, login_date, device_info)
      VALUES (?,?,?,?)`).run(data.employee_id, data.photo_data, loginDate, deviceInfo);
    insertId = r.lastInsertRowid;
  }
  audit(null, data.employee_name || 'staff', `staff_selfie_${eventType}`, 'staff_login_selfie', insertId, {
    employee_id: data.employee_id, login_date: loginDate, event_type: eventType
  });
  return getStaffSelfie(insertId);
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

const { getDb } = require('../database/db');

function getBranches() {
  return getDb().prepare('SELECT * FROM branches ORDER BY name').all();
}

function getBranch(id) {
  return getDb().prepare('SELECT * FROM branches WHERE id = ?').get(id);
}

function getBranchByCode(code) {
  return getDb().prepare('SELECT * FROM branches WHERE code = ?').get(String(code).toUpperCase());
}

function saveBranch(data) {
  const db = getDb();
  if (data.id) {
    db.prepare('UPDATE branches SET name=?, code=?, address=?, phone=?, is_active=? WHERE id=?')
      .run(data.name, String(data.code).toUpperCase(), data.address || null, data.phone || null, data.is_active !== false ? 1 : 0, data.id);
    return getBranch(data.id);
  }
  const r = db.prepare('INSERT INTO branches (name, code, address, phone) VALUES (?, ?, ?, ?)')
    .run(data.name, String(data.code).toUpperCase(), data.address || null, data.phone || null);
  return getBranch(r.lastInsertRowid);
}

function setActiveBranch(branchId) {
  getDb().prepare('UPDATE shop_settings SET branch_id = ? WHERE id = 1').run(branchId);
  return getBranch(branchId);
}

function getActiveBranch() {
  const settings = getDb().prepare('SELECT branch_id FROM shop_settings WHERE id = 1').get();
  const id = settings?.branch_id || 1;
  return getBranch(id) || { id: 1, name: 'Main Branch', code: 'MAIN' };
}

module.exports = {
  getBranches, getBranch, getBranchByCode, saveBranch, setActiveBranch, getActiveBranch
};

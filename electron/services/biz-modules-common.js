/**
 * Shared helpers for Business Modules (Investor, Release, Meeting).
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { getDb } = require('../database/db');

function dbGet(sql, p = []) { return getDb().prepare(sql).get(...p); }
function dbAll(sql, p = []) { return getDb().prepare(sql).all(...p); }
function dbRun(sql, p = []) { return getDb().prepare(sql).run(...p); }
function nowIso() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }
function nowPlusDays(d) { return new Date(Date.now() + d * 86400000).toISOString().slice(0, 19).replace('T', ' '); }
function parseJson(v, fb = null) {
  if (v == null || v === '') return fb;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch (_) { return fb; }
}
function hashToken(t) { return crypto.createHash('sha256').update(String(t)).digest('hex'); }
function newToken() { return crypto.randomBytes(32).toString('hex'); }
function uid(prefix) {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function ensureMigration() {
  try { dbGet('SELECT 1 FROM biz_module_settings LIMIT 1'); } catch (_) {
    try {
      const fs = require('fs');
      const path = require('path');
      const p = path.join(__dirname, '../database/migrations-v85.sql');
      if (fs.existsSync(p)) getDb().exec(fs.readFileSync(p, 'utf8'));
    } catch (err) {
      console.warn('[biz-modules] schema ensure failed:', err.message || err);
    }
  }
  try { dbRun('INSERT OR IGNORE INTO biz_module_settings (id) VALUES (1)'); } catch (_) {
    try { dbRun('INSERT INTO biz_module_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING'); } catch (__) { /* */ }
  }
}

function getModuleSettings() {
  ensureMigration();
  return dbGet('SELECT * FROM biz_module_settings WHERE id = 1') || {};
}

function saveModuleSettings(data, actor) {
  ensureMigration();
  const fields = ['investor_enabled', 'release_enabled', 'meeting_enabled', 'meeting_retention_days', 'release_preview_url'];
  const sets = [];
  const vals = [];
  for (const f of fields) {
    if (data[f] !== undefined) { sets.push(`${f} = ?`); vals.push(data[f]); }
  }
  if (!sets.length) return getModuleSettings();
  dbRun(`UPDATE biz_module_settings SET ${sets.join(', ')}, updated_at = ? WHERE id = 1`, [...vals, nowIso()]);
  return getModuleSettings();
}

function moduleAudit(table, row) {
  ensureMigration();
  const cols = [];
  const vals = [];
  const add = (c, v) => { cols.push(c); vals.push(v); };
  if (table === 'investor_audit_logs' && row.investor_id != null) add('investor_id', row.investor_id);
  if (table === 'meeting_audit_logs' && row.meeting_id != null) add('meeting_id', row.meeting_id);
  add('user_id', row.user_id || null);
  add('user_name', row.user_name || null);
  add('action', row.action);
  add('module', row.module || 'system');
  add('entity_type', row.entity_type || null);
  add('entity_id', row.entity_id || null);
  add('details_json', JSON.stringify(row.details || {}));
  add('result', row.result || 'ok');
  try {
    dbRun(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, vals);
  } catch (_) { /* */ }
}

function createModuleSession(table, userId, days = 14) {
  const token = newToken();
  dbRun(`INSERT INTO ${table} (user_id, token_hash, expires_at) VALUES (?,?,?)`,
    [userId, hashToken(token), nowPlusDays(days)]);
  return { token, expires_at: nowPlusDays(days) };
}

function resolveModuleSession(table, usersTable, token) {
  if (!token) throw new Error('Not authenticated');
  const row = dbGet(`SELECT s.*, u.*, s.id AS session_id, u.id AS portal_user_id
    FROM ${table} s JOIN ${usersTable} u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND u.is_active = 1`,
    [hashToken(token), nowIso()]);
  if (!row) throw new Error('Session expired or access revoked');
  return row;
}

function hashPassword(p) { return bcrypt.hashSync(String(p), 10); }
function verifyPassword(p, hash) { return bcrypt.compareSync(String(p), hash); }

module.exports = {
  dbGet, dbAll, dbRun, nowIso, nowPlusDays, parseJson, hashToken, newToken, uid,
  ensureMigration, getModuleSettings, saveModuleSettings, moduleAudit,
  createModuleSession, resolveModuleSession, hashPassword, verifyPassword
};

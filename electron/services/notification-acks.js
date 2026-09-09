/**
 * Cross-device notification dedup — once an event is acked, no panel replays it.
 */
const { getDb } = require('../database/db');

const PANELS = ['pos', 'admin', 'driver', 'manager', 'online', 'delivery', 'staff', 'recipe'];

function ensureSchema() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS notification_acks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      panel TEXT NOT NULL,
      event_key TEXT NOT NULL,
      device_id TEXT,
      user_id INTEGER,
      ack_type TEXT DEFAULT 'handled',
      acked_at TEXT DEFAULT (datetime('now')),
      UNIQUE(panel, event_key)
    );
    CREATE INDEX IF NOT EXISTS idx_notification_acks_panel ON notification_acks(panel);
  `);
}

function ackEvent(panel, eventKey, meta = {}) {
  ensureSchema();
  const p = String(panel || '').trim();
  const key = String(eventKey || '').trim();
  if (!p || !key) throw new Error('Panel and event key required');
  getDb().prepare(`
    INSERT INTO notification_acks (panel, event_key, device_id, user_id, ack_type, acked_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(panel, event_key) DO UPDATE SET
      device_id=excluded.device_id, user_id=excluded.user_id,
      ack_type=excluded.ack_type, acked_at=datetime('now')
  `).run(
    p, key,
    meta.device_id || null,
    meta.user_id != null ? Number(meta.user_id) : null,
    meta.ack_type || 'handled'
  );
  return { panel: p, event_key: key, acked: true };
}

function ackEvents(panel, eventKeys = [], meta = {}) {
  return (eventKeys || []).map((k) => ackEvent(panel, k, meta));
}

function isAcked(panel, eventKey) {
  ensureSchema();
  const row = getDb().prepare(
    'SELECT 1 FROM notification_acks WHERE panel=? AND event_key=? LIMIT 1'
  ).get(String(panel), String(eventKey));
  return !!row;
}

function listAckedKeys(panel, limit = 500) {
  ensureSchema();
  const lim = Math.min(Number(limit) || 500, 2000);
  const rows = getDb().prepare(
    'SELECT event_key, acked_at FROM notification_acks WHERE panel=? ORDER BY id DESC LIMIT ?'
  ).all(String(panel), lim);
  return rows.map((r) => r.event_key);
}

function listAckedSince(panel, sinceIso) {
  ensureSchema();
  if (!sinceIso) return listAckedKeys(panel);
  return getDb().prepare(
    'SELECT event_key FROM notification_acks WHERE panel=? AND acked_at >= ? ORDER BY id DESC'
  ).all(String(panel), sinceIso).map((r) => r.event_key);
}

module.exports = {
  PANELS, ensureSchema, ackEvent, ackEvents, isAcked, listAckedKeys, listAckedSince
};

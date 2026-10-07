/**
 * Order SLA engine — one timeline per master order (the existing sale / online order),
 * stage + total timers, escalation through the Communication Center, delay reasons,
 * exceptions, pauses, performance incidents and reports. Timing rows are append-only.
 */
const { getDb, isPgMode } = require('../database/db');

const STAGES = ['accept', 'kitchen', 'pack', 'handover', 'delivery'];
const ORDER_TYPES = ['delivery', 'takeaway', 'dine_in', 'drive_thru', 'kiosk', 'online'];
const STATUS_RANK = { awaiting_payment: -1, new: 0, accepted: 1, preparing: 2, ready: 3, packed: 4, out_for_delivery: 5, completed: 6, cancelled: 6 };

const KITCHEN_REASONS = ['stock_shortage', 'equipment_problem', 'staff_shortage', 'large_order', 're_cooking', 'wrong_preparation',
  'customer_modification', 'system_issue', 'other'];
const DELIVERY_REASONS = ['traffic', 'customer_unavailable', 'wrong_address', 'vehicle_problem', 'restaurant_delay', 'weather', 'driver_delay', 'other'];
const EXCEPTION_TYPES = ['large_order', 'equipment_failure', 'power_outage', 'network_failure', 'stock_shortage', 'customer_requested_delay',
  'rework', 'emergency', 'other'];
const INCIDENT_LEVELS = {
  1: 'Coaching',
  2: 'Documented verbal warning',
  3: 'Written warning',
  4: 'Formal disciplinary process',
  5: 'Further lawful action per company policy'
};

const DEFAULT_SETTINGS = {
  enabled: true,
  targets: { delivery: 60, takeaway: 20, dine_in: 30, drive_thru: 10, kiosk: 20, online: 30 },
  stages: { accept: 5, kitchen: 25, pack: 5, handover: 10, delivery: 35 },
  thresholds: { warning: 75, supervisor: 90, breach: 100, escalation: 125, critical: 150 },
  escalate: true,
  create_incidents: true,
  pause_roles: ['owner', 'manager'],
  exception_roles: ['owner', 'manager'],
  settings_roles: ['owner', 'manager'],
  counter_sale_complete_minutes: 3,
  late_sync_hours: 3,
  kiosk_offline_minutes: 3
};

const LEVEL_KEYS = ['on_time', 'on_time', 'warning', 'overdue', 'overdue', 'critical'];
const LEVEL_LABELS = { on_time: 'ON TIME', warning: 'WARNING', overdue: 'OVERDUE', critical: 'CRITICAL', new: 'NEW', completed: 'COMPLETED', cancelled: 'CANCELLED' };

let _schemaDb = null;
let _settingsCache = null;

function db() { return getDb(); }
function q(sql, params = []) { return db().prepare(sql).get(...params); }
function qa(sql, params = []) { return db().prepare(sql).all(...params); }
function run(sql, params = []) { return db().prepare(sql).run(...params); }
function nowIso() { return new Date().toISOString(); }
function round1(n) { return Math.round((Number(n) || 0) * 10) / 10; }

function shopTz() { return process.env.SHOP_TIMEZONE || 'Africa/Johannesburg'; }
function localDate(ms = Date.now()) {
  try { return new Date(ms).toLocaleDateString('en-CA', { timeZone: shopTz() }); } catch (_) { return new Date(ms).toISOString().slice(0, 10); }
}

/** Timestamps may be ISO, "YYYY-MM-DD HH:MM:SS" (UTC) or a Date from Postgres. */
function ms(v) {
  if (!v) return null;
  if (v instanceof Date) return v.getTime();
  const s = String(v).trim();
  if (!s) return null;
  const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s.replace(' ', 'T') : `${s.replace(' ', 'T')}Z`);
  return Number.isFinite(t) ? t : null;
}
function minutesBetween(a, b) {
  const x = ms(a); const y = ms(b);
  if (x == null || y == null) return null;
  return Math.max(0, (y - x) / 60000);
}

function ensureSchema() {
  const handle = db();
  if (_schemaDb === handle) return;
  const stmts = [
    `CREATE TABLE IF NOT EXISTS order_sla (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_key TEXT NOT NULL UNIQUE,
      sale_id INTEGER, online_order_id INTEGER, kitchen_order_id INTEGER, delivery_id INTEGER,
      kiosk_order_id INTEGER, kiosk_device_id INTEGER, drive_thru_order_id INTEGER,
      order_number TEXT, branch_id INTEGER, source TEXT, order_type TEXT, customer_id INTEGER, total REAL,
      target_minutes REAL, original_target_minutes REAL, stage_targets_json TEXT,
      status TEXT DEFAULT 'new', tracked INTEGER DEFAULT 1, order_date TEXT,
      created_at TEXT, accepted_at TEXT, prep_started_at TEXT, ready_at TEXT, packed_at TEXT,
      handed_over_at TEXT, departed_at TEXT, delivered_at TEXT, completed_at TEXT, cancelled_at TEXT,
      accepted_by INTEGER, accepted_by_name TEXT, prepared_by INTEGER, prepared_by_name TEXT,
      packed_by_name TEXT, handed_over_by_name TEXT, driver_id INTEGER, driver_name TEXT, station TEXT,
      paused_ms REAL DEFAULT 0, paused_at TEXT, pause_reason TEXT,
      alert_level INTEGER DEFAULT 0, final_status TEXT, total_minutes REAL, delay_minutes REAL,
      stage_minutes_json TEXT, bottleneck TEXT, needs_reason INTEGER DEFAULT 0,
      delay_stage TEXT, delay_reason TEXT, delay_note TEXT, delay_by_name TEXT,
      exception_type TEXT, exception_note TEXT, exception_by_name TEXT, exception_at TEXT,
      updated_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS order_sla_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_sla_id INTEGER NOT NULL,
      event_uid TEXT UNIQUE,
      event_type TEXT NOT NULL,
      stage TEXT, from_status TEXT, to_status TEXT,
      actor_id INTEGER, actor_name TEXT, actor_role TEXT,
      source_module TEXT, branch_id INTEGER, note TEXT, data_json TEXT,
      occurred_at TEXT, created_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS order_sla_incidents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_sla_id INTEGER NOT NULL,
      order_number TEXT, branch_id INTEGER,
      employee_id INTEGER, employee_name TEXT, stage TEXT,
      delay_minutes REAL, incident_type TEXT DEFAULT 'sla_breach',
      level INTEGER, status TEXT DEFAULT 'open',
      evidence_json TEXT, employee_explanation TEXT, manager_explanation TEXT,
      action_taken TEXT, follow_up_date TEXT,
      adjustment_amount REAL, adjustment_reason TEXT, adjustment_status TEXT DEFAULT 'none',
      manager_approved_by TEXT, manager_approved_at TEXT, payroll_approved_by TEXT, payroll_approved_at TEXT,
      created_at TEXT, updated_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS order_sla_settings (
      id INTEGER PRIMARY KEY,
      settings_json TEXT,
      updated_by TEXT,
      updated_at TEXT
    )`,
    'CREATE INDEX IF NOT EXISTS idx_order_sla_sale ON order_sla (sale_id)',
    'CREATE INDEX IF NOT EXISTS idx_order_sla_online ON order_sla (online_order_id)',
    'CREATE INDEX IF NOT EXISTS idx_order_sla_kitchen ON order_sla (kitchen_order_id)',
    'CREATE INDEX IF NOT EXISTS idx_order_sla_date ON order_sla (order_date)',
    'CREATE INDEX IF NOT EXISTS idx_order_sla_open ON order_sla (completed_at, cancelled_at)',
    'CREATE INDEX IF NOT EXISTS idx_order_sla_events_order ON order_sla_events (order_sla_id)',
    'CREATE INDEX IF NOT EXISTS idx_order_sla_incidents_order ON order_sla_incidents (order_sla_id)'
  ];
  for (const s of stmts) {
    try { run(s); } catch (err) {
      if (!/already exists|duplicate/i.test(String(err.message))) console.warn('[sla] schema:', err.message);
    }
  }
  _schemaDb = handle;
}

// ─── Settings ────────────────────────────────────────────────────────────────

function mergeSettings(raw) {
  const s = { ...DEFAULT_SETTINGS, ...(raw || {}) };
  s.targets = { ...DEFAULT_SETTINGS.targets, ...((raw && raw.targets) || {}) };
  s.stages = { ...DEFAULT_SETTINGS.stages, ...((raw && raw.stages) || {}) };
  s.thresholds = { ...DEFAULT_SETTINGS.thresholds, ...((raw && raw.thresholds) || {}) };
  return s;
}

function getSettings() {
  if (_settingsCache && _settingsCache.exp > Date.now() && _settingsCache.db === db()) return _settingsCache.value;
  ensureSchema();
  let raw = null;
  try { raw = JSON.parse(q('SELECT settings_json FROM order_sla_settings WHERE id = 1')?.settings_json || 'null'); } catch (_) { raw = null; }
  const value = mergeSettings(raw);
  _settingsCache = { value, exp: Date.now() + 30000, db: db() };
  return value;
}

function posNum(v, fallback, max = 1440) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(max, Math.round(n * 10) / 10) : fallback;
}

function saveSettings(input, actor) {
  const cur = getSettings();
  if (!cur.settings_roles.includes(actor?.role)) throw new Error('Only an owner or manager can change Order SLA settings');
  const next = mergeSettings(cur);
  if (input.enabled != null) next.enabled = !!input.enabled;
  for (const t of ORDER_TYPES) if (input.targets && input.targets[t] != null) next.targets[t] = posNum(input.targets[t], cur.targets[t]);
  for (const st of STAGES) if (input.stages && input.stages[st] != null) next.stages[st] = posNum(input.stages[st], cur.stages[st]);
  const th = { ...cur.thresholds };
  for (const k of Object.keys(th)) if (input.thresholds && input.thresholds[k] != null) th[k] = posNum(input.thresholds[k], th[k], 1000);
  const order = ['warning', 'supervisor', 'breach', 'escalation', 'critical'];
  for (let i = 1; i < order.length; i++) {
    if (th[order[i]] <= th[order[i - 1]]) throw new Error('Warning thresholds must increase: warning < supervisor < breach < escalation < critical');
  }
  next.thresholds = th;
  if (input.escalate != null) next.escalate = !!input.escalate;
  if (input.create_incidents != null) next.create_incidents = !!input.create_incidents;
  if (Array.isArray(input.pause_roles)) {
    next.pause_roles = input.pause_roles.filter((r) => ['owner', 'manager', 'assistant_manager', 'supervisor'].includes(r));
    if (!next.pause_roles.includes('owner')) next.pause_roles.unshift('owner');
  }
  if (Array.isArray(input.exception_roles)) {
    next.exception_roles = input.exception_roles.filter((r) => ['owner', 'manager', 'assistant_manager', 'supervisor'].includes(r));
    if (!next.exception_roles.includes('owner')) next.exception_roles.unshift('owner');
  }
  if (input.counter_sale_complete_minutes != null) next.counter_sale_complete_minutes = posNum(input.counter_sale_complete_minutes, cur.counter_sale_complete_minutes, 120);
  if (input.late_sync_hours != null) next.late_sync_hours = posNum(input.late_sync_hours, cur.late_sync_hours, 72);
  if (input.kiosk_offline_minutes != null) next.kiosk_offline_minutes = posNum(input.kiosk_offline_minutes, cur.kiosk_offline_minutes, 120);
  const json = JSON.stringify(next);
  const by = actor?.full_name || actor?.username || null;
  const exists = q('SELECT id FROM order_sla_settings WHERE id = 1');
  if (exists) run('UPDATE order_sla_settings SET settings_json = ?, updated_by = ?, updated_at = ? WHERE id = 1', [json, by, nowIso()]);
  else run('INSERT INTO order_sla_settings (id, settings_json, updated_by, updated_at) VALUES (1, ?, ?, ?)', [json, by, nowIso()]);
  try {
    run('INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, details) VALUES (?,?,?,?,?,?)',
      [actor?.id || null, by, 'order_sla_settings', 'order_sla_settings', 1, JSON.stringify({ before: { targets: cur.targets, stages: cur.stages, thresholds: cur.thresholds }, after: { targets: next.targets, stages: next.stages, thresholds: next.thresholds } })]);
  } catch (_) { /* */ }
  _settingsCache = null;
  return getSettings();
}

// ─── Classification ──────────────────────────────────────────────────────────

function sourceFrom(orderSource, fallback = 'pos') {
  const s = String(orderSource || '').toUpperCase();
  if (s.includes('KIOSK')) return 'kiosk';
  if (s.includes('DRIVE')) return 'drive_thru';
  if (s.includes('ONLINE') || s.includes('WEB') || s.includes('APP')) return 'online';
  if (s.includes('PHONE')) return 'phone';
  return fallback;
}

function typeFrom(orderType, source, fulfillment) {
  const t = String(orderType || '').toLowerCase();
  const f = String(fulfillment || '').toLowerCase();
  if (t === 'delivery' || f === 'delivery') return 'delivery';
  if (source === 'drive_thru') return 'drive_thru';
  if (t === 'sit_in' || t === 'dine_in' || t === 'table' || t === 'seating') return 'dine_in';
  if (source === 'kiosk') return 'kiosk';
  if (source === 'online' || t === 'online') return 'online';
  return 'takeaway';
}

function stageTargetsFor(type, settings) {
  const st = { ...settings.stages };
  if (type !== 'delivery') delete st.delivery;
  return st;
}

/** Elapsed minutes on the master timer (never reset between stages), excluding authorised pauses. */
function elapsedMinutes(row, atMs = Date.now()) {
  const start = ms(row.created_at);
  if (start == null) return 0;
  const end = ms(row.completed_at) || ms(row.cancelled_at) || atMs;
  let paused = Number(row.paused_ms) || 0;
  if (row.paused_at && !row.completed_at && !row.cancelled_at) paused += Math.max(0, atMs - (ms(row.paused_at) || atMs));
  return Math.max(0, (end - start - paused) / 60000);
}

function levelFor(pct, th) {
  if (pct >= th.critical) return 5;
  if (pct >= th.escalation) return 4;
  if (pct >= th.breach) return 3;
  if (pct >= th.supervisor) return 2;
  if (pct >= th.warning) return 1;
  return 0;
}

function currentStage(row) {
  if (row.completed_at || row.cancelled_at) return null;
  if (row.order_type === 'delivery' && row.handed_over_at) return 'delivery';
  if (row.packed_at) return 'handover';
  if (row.ready_at) return 'handover';
  if (row.accepted_at || row.prep_started_at) return 'kitchen';
  return 'accept';
}

function stageStart(row, stage) {
  switch (stage) {
    case 'accept': return row.created_at;
    case 'kitchen': return row.prep_started_at || row.accepted_at || row.created_at;
    case 'pack': return row.ready_at;
    case 'handover': return row.packed_at || row.ready_at;
    case 'delivery': return row.handed_over_at;
    default: return null;
  }
}

function stageEnd(row, stage) {
  switch (stage) {
    case 'accept': return row.accepted_at;
    case 'kitchen': return row.ready_at;
    case 'pack': return row.packed_at;
    case 'handover': return row.handed_over_at || (row.order_type !== 'delivery' ? row.completed_at : null);
    case 'delivery': return row.delivered_at;
    default: return null;
  }
}

function stageBreakdown(row, settings, atMs = Date.now()) {
  const targets = (() => { try { return JSON.parse(row.stage_targets_json || 'null'); } catch (_) { return null; } })() || stageTargetsFor(row.order_type, settings);
  const out = [];
  for (const stage of STAGES) {
    if (targets[stage] == null) continue;
    const start = stageStart(row, stage);
    const skipped = stage === 'pack' && !row.packed_at;
    if (!start || skipped) { out.push({ stage, target: targets[stage], minutes: null, over: 0, done: false }); continue; }
    const end = stageEnd(row, stage);
    const endMs = ms(end) || (row.completed_at || row.cancelled_at ? ms(row.completed_at || row.cancelled_at) : atMs);
    const minutes = Math.max(0, (endMs - ms(start)) / 60000);
    out.push({ stage, target: targets[stage], minutes: round1(minutes), over: round1(Math.max(0, minutes - targets[stage])), done: !!end });
  }
  return out;
}

function responsibleFor(row, stage) {
  switch (stage) {
    case 'accept': return { id: row.accepted_by, name: row.accepted_by_name };
    case 'kitchen': return { id: row.prepared_by, name: row.prepared_by_name || (row.station ? `Station: ${row.station}` : null) };
    case 'pack': return { id: null, name: row.packed_by_name };
    case 'handover': return { id: row.order_type === 'delivery' ? row.driver_id : null, name: row.order_type === 'delivery' ? row.driver_name : row.handed_over_by_name };
    case 'delivery': return { id: row.driver_id, name: row.driver_name, driver: true };
    default: return { id: null, name: null };
  }
}

/** Live view of one row: timer text, level, current stage, stage clocks. Never exposes incidents. */
function present(row, settings = getSettings(), atMs = Date.now()) {
  const target = Number(row.target_minutes) || settings.targets[row.order_type] || 30;
  const elapsed = elapsedMinutes(row, atMs);
  const pct = target > 0 ? (elapsed / target) * 100 : 0;
  const level = levelFor(pct, settings.thresholds);
  const done = !!(row.completed_at || row.cancelled_at);
  let state = LEVEL_KEYS[level];
  if (!done && row.status === 'new') state = level >= 3 ? state : 'new';
  if (row.status === 'awaiting_payment') state = 'new';
  const stage = currentStage(row);
  const stages = stageBreakdown(row, settings, atMs);
  const cur = stages.find((s) => s.stage === stage) || null;
  return {
    id: row.id,
    order_key: row.order_key,
    sale_id: row.sale_id,
    online_order_id: row.online_order_id,
    kitchen_order_id: row.kitchen_order_id,
    order_number: row.order_number,
    branch_id: row.branch_id,
    source: row.source,
    order_type: row.order_type,
    kiosk_device_id: row.kiosk_device_id,
    status: row.status,
    total: Number(row.total) || 0,
    created_at: row.created_at,
    elapsed_seconds: Math.round(elapsed * 60),
    target_minutes: target,
    original_target_minutes: row.original_target_minutes != null ? Number(row.original_target_minutes) : null,
    percent: Math.round(pct),
    level,
    state: done ? (row.cancelled_at ? 'cancelled' : (row.final_status || state)) : state,
    state_label: LEVEL_LABELS[done ? (row.cancelled_at ? 'cancelled' : (row.final_status || state)) : state] || String(state).toUpperCase(),
    timer_text: `${clock(elapsed)} / ${clock(target)}`,
    stage,
    stage_elapsed_seconds: cur && cur.minutes != null ? Math.round(cur.minutes * 60) : null,
    stage_target_minutes: cur ? cur.target : null,
    stage_timer_text: cur && cur.minutes != null ? `${clock(cur.minutes)} / ${clock(cur.target)}` : null,
    stages,
    paused: !!row.paused_at,
    station: row.station || null,
    responsible: stage ? responsibleFor(row, stage).name || null : null,
    driver_name: row.driver_name || null,
    needs_reason: Number(row.needs_reason) === 1 || (!done && level >= 3 && !row.delay_reason),
    delay_reason: row.delay_reason || null,
    exception_type: row.exception_type || null,
    completed_at: row.completed_at || null,
    total_minutes: row.total_minutes != null ? Number(row.total_minutes) : null,
    bottleneck: row.bottleneck || null
  };
}

function clock(minutes) {
  const total = Math.max(0, Math.round((Number(minutes) || 0) * 60));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// ─── Rows + events ───────────────────────────────────────────────────────────

function getByKey(key) { return q('SELECT * FROM order_sla WHERE order_key = ?', [key]); }
function getById(id) { return q('SELECT * FROM order_sla WHERE id = ?', [Number(id)]); }
function getBySale(saleId) {
  if (!saleId) return null;
  return q('SELECT * FROM order_sla WHERE sale_id = ? ORDER BY id DESC LIMIT 1', [Number(saleId)]);
}

function addEvent(row, type, data = {}) {
  if (!row?.id) return;
  const uid = data.uid || null;
  if (uid && q('SELECT id FROM order_sla_events WHERE event_uid = ?', [uid])) return;
  try {
    run(`INSERT INTO order_sla_events (order_sla_id, event_uid, event_type, stage, from_status, to_status,
      actor_id, actor_name, actor_role, source_module, branch_id, note, data_json, occurred_at, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
      row.id, uid, type, data.stage || null, data.from || null, data.to || null,
      data.actor?.id || null, data.actor?.name || data.actor?.full_name || data.actor?.username || null, data.actor?.role || null,
      data.module || null, row.branch_id || null, data.note ? String(data.note).slice(0, 1000) : null,
      data.data ? JSON.stringify(data.data).slice(0, 4000) : null, data.at || nowIso(), nowIso()
    ]);
  } catch (err) {
    if (!/unique|duplicate/i.test(String(err.message))) console.warn('[sla] event:', err.message);
  }
}

function createRow(fields, actor, module) {
  ensureSchema();
  const settings = getSettings();
  if (!settings.enabled) return null;
  const existing = getByKey(fields.order_key);
  if (existing) return existing;
  const type = fields.order_type;
  const target = settings.targets[type] || 30;
  const stageTargets = stageTargetsFor(type, settings);
  const createdAt = fields.created_at || nowIso();
  const cols = {
    ...fields,
    target_minutes: target,
    original_target_minutes: target,
    stage_targets_json: JSON.stringify(stageTargets),
    status: fields.status || 'new',
    tracked: fields.tracked == null ? 1 : fields.tracked,
    order_date: localDate(ms(createdAt) || Date.now()),
    created_at: createdAt,
    updated_at: nowIso()
  };
  const keys = Object.keys(cols).filter((k) => cols[k] !== undefined);
  try {
    run(`INSERT INTO order_sla (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`, keys.map((k) => cols[k]));
  } catch (err) {
    if (!/unique|duplicate/i.test(String(err.message))) throw err;
  }
  const row = getByKey(fields.order_key);
  if (row) {
    addEvent(row, 'created', {
      uid: `${row.id}:created`, to: row.status, actor, module, at: createdAt,
      note: `${String(row.source || '').toUpperCase()} order · ${row.order_type} · target ${target} min`
    });
  }
  return row;
}

function patch(row, fields) {
  const keys = Object.keys(fields).filter((k) => fields[k] !== undefined);
  if (!keys.length) return row;
  run(`UPDATE order_sla SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
    [...keys.map((k) => fields[k]), nowIso(), row.id]);
  return { ...row, ...fields };
}

/**
 * Moves a master order forward. Stage timestamps are written once (first occurrence wins) so history is never rewritten.
 */
function advance(row, toStatus, actor, opts = {}) {
  if (!row) return null;
  if (row.completed_at || row.cancelled_at) {
    if (toStatus !== 'completed' && toStatus !== 'cancelled') addEvent(row, 'late_status', { to: toStatus, actor, module: opts.module, note: opts.note });
    return row;
  }
  const at = opts.at || nowIso();
  const f = {};
  const name = actor?.name || actor?.full_name || actor?.username || null;
  const actorId = actor?.id && actor.role !== 'driver' ? actor.id : null;
  if (toStatus === 'accepted' && !row.accepted_at) { f.accepted_at = at; f.accepted_by = actorId; f.accepted_by_name = name; }
  if (toStatus === 'preparing') {
    if (!row.accepted_at) f.accepted_at = at;
    if (!row.prep_started_at) f.prep_started_at = at;
    if (!row.prepared_by && actorId) { f.prepared_by = actorId; f.prepared_by_name = name; }
  }
  if (toStatus === 'ready') {
    if (!row.accepted_at) f.accepted_at = at;
    if (!row.ready_at) f.ready_at = at;
    if (!row.prepared_by && actorId) { f.prepared_by = actorId; f.prepared_by_name = name; }
  }
  if (toStatus === 'packed') {
    if (!row.ready_at) f.ready_at = at;
    if (!row.packed_at) { f.packed_at = at; f.packed_by_name = name; }
  }
  if (toStatus === 'out_for_delivery') {
    if (!row.ready_at) f.ready_at = at;
    if (!row.handed_over_at) { f.handed_over_at = at; f.handed_over_by_name = name; }
  }
  if (toStatus === 'completed') {
    if (!row.accepted_at) f.accepted_at = row.created_at;
    if (row.order_type !== 'delivery' && !row.handed_over_at) { f.handed_over_at = at; f.handed_over_by_name = name; }
    if (row.order_type === 'delivery' && opts.delivered && !row.delivered_at) f.delivered_at = at;
    f.completed_at = at;
  }
  if (toStatus === 'cancelled') f.cancelled_at = at;
  const curRank = STATUS_RANK[row.status] ?? 0;
  const nextRank = STATUS_RANK[toStatus] ?? 0;
  if (nextRank > curRank || toStatus === 'cancelled' || (row.status === 'awaiting_payment' && toStatus === 'new')) f.status = toStatus;
  const fromStatus = row.status;
  let next = Object.keys(f).length ? patch(row, f) : row;
  addEvent(next, opts.eventType || 'status', {
    uid: opts.uid || null, stage: opts.stage || null, from: fromStatus, to: toStatus, actor, module: opts.module, note: opts.note, at, data: opts.data
  });
  if (toStatus === 'completed' || toStatus === 'cancelled') next = finalize(next, actor);
  return next;
}

/** Final metrics + bottleneck + (if late, no approved exception) a performance incident for review. */
function finalize(row, actor) {
  const settings = getSettings();
  if (row.cancelled_at) return patch(row, { final_status: 'cancelled' });
  const target = Number(row.target_minutes) || settings.targets[row.order_type] || 30;
  const total = elapsedMinutes(row);
  const pct = target > 0 ? (total / target) * 100 : 0;
  const level = levelFor(pct, settings.thresholds);
  const stages = stageBreakdown(row, settings);
  const worst = stages.filter((s) => s.over > 0).sort((a, b) => b.over - a.over)[0] || null;
  const finalStatus = LEVEL_KEYS[level];
  const delay = Math.max(0, total - target);
  const late = level >= 3;
  const next = patch(row, {
    total_minutes: round1(total),
    delay_minutes: round1(delay),
    final_status: finalStatus,
    stage_minutes_json: JSON.stringify(stages),
    bottleneck: late && worst ? worst.stage : null,
    needs_reason: late && !row.delay_reason && !row.exception_type ? 1 : 0,
    alert_level: Math.max(Number(row.alert_level) || 0, level)
  });
  if (late && settings.create_incidents && !row.exception_type && Number(row.tracked) === 1) {
    const stage = worst ? worst.stage : 'kitchen';
    const who = responsibleFor(next, stage);
    if (!q('SELECT id FROM order_sla_incidents WHERE order_sla_id = ?', [row.id])) {
      run(`INSERT INTO order_sla_incidents (order_sla_id, order_number, branch_id, employee_id, employee_name, stage, delay_minutes,
        incident_type, status, evidence_json, adjustment_status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
        row.id, row.order_number, row.branch_id, who.id || null, who.name || null, stage, round1(worst ? worst.over : delay),
        'sla_breach', 'open', JSON.stringify({ target_minutes: target, actual_minutes: round1(total), stages, order_type: row.order_type, source: row.source }),
        'none', nowIso(), nowIso()
      ]);
      addEvent(next, 'incident_opened', { stage, note: `Performance review opened (${stage} +${round1(worst ? worst.over : delay)} min)`, actor: { name: 'System', role: 'system' } });
    }
  }
  return next;
}

// ─── Hooks from existing modules ─────────────────────────────────────────────

function isLateSync(startMs, settings) {
  return startMs != null && Date.now() - startMs > settings.late_sync_hours * 3600000;
}

function onSaleCompleted(saleId, saleData = {}, actor = {}) {
  if (!saleId) return null;
  ensureSchema();
  const settings = getSettings();
  if (!settings.enabled) return null;
  if (saleData.is_backdated || saleData.backdated_reason || saleData.sale_datetime_backdated) return null;
  if (getBySale(saleId)) return null;
  const sale = q(`SELECT id, order_number, receipt_number, order_type, order_source, branch_id, customer_id, total FROM sales WHERE id = ?`, [saleId]);
  if (!sale) return null;
  const who = { id: actor.id, name: actor.name, role: actor.role };

  if (saleData.online_order_id) {
    const online = getByKey(`online:${Number(saleData.online_order_id)}`);
    if (online) {
      let row = patch(online, { sale_id: saleId, customer_id: online.customer_id || sale.customer_id || null });
      row = advance(row, 'accepted', who, { module: 'pos', note: `Accepted on POS as sale ${sale.order_number || sale.receipt_number}` });
      return row;
    }
  }

  const source = sourceFrom(sale.order_source, 'pos');
  const type = typeFrom(sale.order_type, source, null);
  const startIso = saleData.sla_started_at && ms(saleData.sla_started_at) ? new Date(ms(saleData.sla_started_at)).toISOString() : null;
  const startedMs = ms(startIso) || Date.now();
  const lateSync = isLateSync(startedMs, settings);
  let row = createRow({
    order_key: `sale:${saleId}`,
    sale_id: saleId,
    order_number: sale.order_number || sale.receipt_number || String(saleId),
    branch_id: sale.branch_id || null,
    source: saleData.online_order_id ? 'online' : source,
    order_type: type,
    customer_id: sale.customer_id || null,
    total: Number(sale.total) || 0,
    kiosk_device_id: saleData.kiosk_device_id || null,
    drive_thru_order_id: saleData.drive_thru_order_id || null,
    created_at: startIso || nowIso(),
    tracked: lateSync ? 0 : 1
  }, who, 'pos');
  if (!row) return null;
  // Paid at the counter / kiosk / window → accepted the moment the sale exists.
  row = advance(row, 'accepted', who, { module: source, note: source === 'kiosk' ? 'Paid at kiosk' : 'Sale completed', at: nowIso() });
  if (lateSync) row = advance(row, 'completed', who, { module: 'sync', note: 'Synced after the fact — excluded from SLA statistics' });
  return row;
}

function onKitchenCreated(kitchenOrderId, saleId, station, actorId, orderNumber) {
  if (!kitchenOrderId) return;
  ensureSchema();
  let row = saleId ? getBySale(saleId) : null;
  if (!row) return;
  const actor = actorId ? userActor(actorId) : null;
  row = patch(row, { kitchen_order_id: kitchenOrderId, station: station || row.station || 'kitchen' });
  addEvent(row, 'sent_to_kitchen', { uid: `${row.id}:kot:${kitchenOrderId}`, stage: 'kitchen', actor, module: 'kitchen', note: `Kitchen ticket ${orderNumber || kitchenOrderId} · station ${station || 'kitchen'}` });
}

function userActor(userId) {
  try {
    const u = q('SELECT id, full_name, username, role FROM users WHERE id = ?', [Number(userId)]);
    return u ? { id: u.id, name: u.full_name || u.username, role: u.role } : { id: userId };
  } catch (_) { return { id: userId }; }
}

function rowForKitchen(kitchenOrderId) {
  let row = q('SELECT * FROM order_sla WHERE kitchen_order_id = ? ORDER BY id DESC LIMIT 1', [Number(kitchenOrderId)]);
  if (row) return row;
  const ko = q('SELECT sale_id FROM kitchen_orders WHERE id = ?', [Number(kitchenOrderId)]);
  row = ko?.sale_id ? getBySale(ko.sale_id) : null;
  return row;
}

function onKitchenStatus(kitchenOrderId, status, actor) {
  ensureSchema();
  const row = rowForKitchen(kitchenOrderId);
  if (!row) return;
  const who = actor ? { id: actor.id, name: actor.full_name || actor.username || actor.name, role: actor.role } : null;
  const map = { pending: null, preparing: 'preparing', ready: 'ready', collection: 'packed', completed: row.order_type === 'delivery' ? 'packed' : 'completed', cancelled: 'cancelled' };
  const to = map[status];
  if (!to) return;
  advance(row, to, who, { module: 'kitchen', stage: 'kitchen', note: `Kitchen: ${status}` });
}

function onOnlineEvent(orderId, status, actorType, actorId, note) {
  ensureSchema();
  const settings = getSettings();
  if (!settings.enabled) return;
  const key = `online:${Number(orderId)}`;
  let row = getByKey(key);
  const actor = actorType === 'staff' && actorId ? userActor(actorId) : { name: actorType === 'customer' ? 'Customer' : 'System', role: actorType || 'system' };
  if (!row) {
    if (!['received', 'pending', 'pending_payment', 'paid'].includes(status)) return;
    const o = q(`SELECT id, order_number, branch_id, customer_id, total, status, fulfillment, fulfillment_type, scheduled_for, order_source
      FROM online_orders_local WHERE id = ?`, [Number(orderId)]);
    if (!o) return;
    const type = typeFrom(null, 'online', o.fulfillment || o.fulfillment_type);
    const awaiting = String(o.status || '').toLowerCase() === 'pending_payment';
    let start = nowIso();
    const sched = ms(o.scheduled_for);
    if (sched && sched > Date.now() + 5 * 60000) {
      const t = (settings.targets[type] || 30) * 60000;
      start = new Date(Math.max(Date.now(), sched - t)).toISOString();
    }
    row = createRow({
      order_key: key, online_order_id: o.id, order_number: o.order_number, branch_id: o.branch_id || null,
      source: sourceFrom(o.order_source, 'online'), order_type: type, customer_id: o.customer_id || null,
      total: Number(o.total) || 0, created_at: start, status: awaiting ? 'awaiting_payment' : 'new'
    }, actor, 'online');
    return;
  }
  if (status === 'pending' || status === 'paid') {
    if (row.status === 'awaiting_payment') {
      // The SLA clock starts when payment is confirmed.
      run('UPDATE order_sla SET created_at = ?, status = ?, order_date = ?, updated_at = ? WHERE id = ?', [nowIso(), 'new', localDate(), nowIso(), row.id]);
      addEvent(row, 'payment_confirmed', { to: 'new', actor, module: 'online', note: 'Payment confirmed — timer started' });
    }
    return;
  }
  const map = { accepted: 'accepted', preparing: 'preparing', ready: 'ready', completed: 'completed', rejected: 'cancelled', cancelled: 'cancelled' };
  const to = map[status];
  if (!to) return;
  if (to === 'completed' && row.order_type === 'delivery' && !row.delivered_at) {
    advance(row, 'completed', actor, { module: 'online', note: note || 'Completed', delivered: true });
    return;
  }
  advance(row, to, actor, { module: 'online', note: note || status });
}

function onDeliveryStatus(deliveryId, fromStatus, toStatus, actor, notes) {
  ensureSchema();
  const a = q('SELECT id, source_type, source_id, sale_id, driver_id, driver_name FROM delivery_assignments WHERE id = ?', [Number(deliveryId)]);
  if (!a) return;
  let row = null;
  if (String(a.source_type || '').toLowerCase().includes('online')) row = getByKey(`online:${Number(a.source_id)}`);
  if (!row && a.sale_id) row = getBySale(a.sale_id);
  if (!row && String(a.source_type || '').toLowerCase() === 'sale') row = getBySale(a.source_id);
  if (!row) return;
  const who = actor ? { id: actor.id, name: actor.full_name || actor.name || null, role: actor.type === 'driver' || actor.role === 'driver' ? 'driver' : (actor.role || actor.type || 'system') } : null;
  const f = { delivery_id: a.id };
  if (a.driver_id && a.driver_id !== row.driver_id) { f.driver_id = a.driver_id; f.driver_name = a.driver_name || null; }
  row = patch(row, f);
  const at = nowIso();
  const event = (type, note) => addEvent(row, type, { stage: 'delivery', from: fromStatus, to: toStatus, actor: who, module: 'delivery', note: note || notes, at });
  switch (toStatus) {
    case 'assigned': event('driver_assigned', `Driver assigned: ${a.driver_name || '—'}`); break;
    case 'driver_accepted': event('driver_accepted', 'Driver accepted'); break;
    case 'awaiting_driver': event('awaiting_driver', notes || 'Waiting for a driver'); break;
    case 'picked_up': advance(row, 'out_for_delivery', who, { module: 'delivery', stage: 'delivery', note: 'Collected by driver', at }); break;
    case 'on_way':
      if (!row.departed_at) row = patch(row, { departed_at: at });
      if (!row.handed_over_at) row = advance(row, 'out_for_delivery', who, { module: 'delivery', stage: 'delivery', note: 'Driver departed', at });
      else event('departed', 'Driver departed');
      break;
    case 'delivered': advance(row, 'completed', who, { module: 'delivery', stage: 'delivery', note: 'Delivered', delivered: true, at }); break;
    case 'failed': event('delivery_failed', notes || 'Delivery failed'); break;
    case 'cancelled': advance(row, 'cancelled', who, { module: 'delivery', note: notes || 'Delivery cancelled', at }); break;
    default: break;
  }
}

/** Used by modules that track their own lifecycle against a sale (e.g. drive-thru window). */
function recordSaleStage(saleId, status, actor, module) {
  ensureSchema();
  const row = getBySale(saleId);
  if (!row) return null;
  return advance(row, status, actor, { module });
}

function linkKioskOrder(saleId, kioskOrderId, deviceId) {
  ensureSchema();
  const row = getBySale(saleId);
  if (row && (!row.kiosk_order_id || !row.kiosk_device_id)) patch(row, { kiosk_order_id: kioskOrderId || null, kiosk_device_id: deviceId || row.kiosk_device_id });
}

/** Adds `sla` (timer text, level, stage clock) to KDS tickets with one query. */
function attachToKitchenOrders(orders) {
  if (!orders?.length) return orders;
  ensureSchema();
  const settings = getSettings();
  if (!settings.enabled) return orders;
  const saleIds = [...new Set(orders.map((o) => Number(o.sale_id)).filter(Boolean))];
  if (!saleIds.length) return orders;
  const rows = qa(`SELECT * FROM order_sla WHERE sale_id IN (${saleIds.map(() => '?').join(',')})`, saleIds);
  const bySale = {};
  for (const r of rows) bySale[r.sale_id] = r;
  const now = Date.now();
  for (const o of orders) {
    const r = bySale[o.sale_id];
    if (r) {
      const p = present(r, settings, now);
      o.sla = {
        id: p.id, timer_text: p.timer_text, state: p.state, state_label: p.state_label, level: p.level,
        elapsed_seconds: p.elapsed_seconds, target_minutes: p.target_minutes, stage: p.stage,
        stage_timer_text: p.stage_timer_text, source: p.source, order_type: p.order_type, needs_reason: p.needs_reason,
        paused: p.paused, created_at: p.created_at, completed: !!r.completed_at
      };
    }
  }
  return orders;
}

/** Adds `sla` (customer-order timer + delivery stage clock) to driver delivery rows. No incidents or discipline data. */
function attachToDeliveries(rows) {
  if (!rows?.length) return rows;
  ensureSchema();
  const settings = getSettings();
  if (!settings.enabled) return rows;
  const now = Date.now();
  for (const d of rows) {
    let r = null;
    if (String(d.source_type || '').toLowerCase().includes('online') && d.source_id) r = getByKey(`online:${Number(d.source_id)}`);
    if (!r && d.sale_id) r = getBySale(d.sale_id);
    if (!r) continue;
    const p = present(r, settings, now);
    const del = p.stages.find((s) => s.stage === 'delivery');
    d.sla = {
      id: p.id, timer_text: p.timer_text, state: p.state, state_label: p.state_label, elapsed_seconds: p.elapsed_seconds,
      target_minutes: p.target_minutes, paused: p.paused, completed: !!r.completed_at,
      delivery_minutes: del ? del.minutes : null, delivery_target: del ? del.target : null,
      needs_reason: p.level >= 3 && !r.delay_reason
    };
  }
  return rows;
}

// ─── Staff actions (permission-checked by callers + here) ───────────────────

function requireRole(actor, roles, msg) {
  if (!actor || !roles.includes(actor.role)) throw new Error(msg || 'Permission denied');
}

function actorName(actor) { return actor?.full_name || actor?.username || actor?.name || null; }

function setDelayReason(id, data = {}, actor) {
  requireRole(actor, ['owner', 'manager', 'assistant_manager', 'supervisor', 'cashier'], 'Sign in to record a delay reason');
  const row = getById(id);
  if (!row) throw new Error('Order not found');
  const stage = data.stage === 'delivery' ? 'delivery' : 'kitchen';
  const list = stage === 'delivery' ? DELIVERY_REASONS : KITCHEN_REASONS;
  const reason = String(data.reason || '').toLowerCase();
  if (!list.includes(reason)) throw new Error('Choose a delay reason from the list');
  const note = String(data.note || '').trim();
  if (reason === 'other' && note.length < 3) throw new Error('"Other" needs a short explanation');
  const next = patch(row, { delay_stage: stage, delay_reason: reason, delay_note: note || null, delay_by_name: actorName(actor), needs_reason: 0 });
  addEvent(next, 'delay_reason', { stage, actor: { id: actor.id, name: actorName(actor), role: actor.role }, module: 'sla', note: `${reason}${note ? ` — ${note}` : ''}` });
  return present(next);
}

function driverDelayReason(deliveryId, data = {}, driver) {
  const a = q('SELECT id, source_type, source_id, sale_id, driver_id FROM delivery_assignments WHERE id = ?', [Number(deliveryId)]);
  if (!a) throw new Error('Delivery not found');
  if (driver?.id && a.driver_id && Number(a.driver_id) !== Number(driver.id)) throw new Error('This delivery is not assigned to you');
  let row = String(a.source_type || '').toLowerCase().includes('online') ? getByKey(`online:${Number(a.source_id)}`) : null;
  if (!row && a.sale_id) row = getBySale(a.sale_id);
  if (!row) throw new Error('No timer for this delivery');
  const reason = String(data.reason || '').toLowerCase();
  if (!DELIVERY_REASONS.includes(reason)) throw new Error('Choose a delay reason from the list');
  const note = String(data.note || '').trim();
  if (reason === 'other' && note.length < 3) throw new Error('"Other" needs a short explanation');
  const next = patch(row, { delay_stage: 'delivery', delay_reason: reason, delay_note: note || null, delay_by_name: driver?.full_name || 'Driver', needs_reason: 0 });
  addEvent(next, 'delay_reason', { stage: 'delivery', actor: { id: null, name: driver?.full_name || 'Driver', role: 'driver' }, module: 'driver', note: `${reason}${note ? ` — ${note}` : ''}` });
  return { ok: true };
}

function setException(id, data = {}, actor) {
  const settings = getSettings();
  requireRole(actor, settings.exception_roles, 'Only an owner or manager can approve an SLA exception');
  const row = getById(id);
  if (!row) throw new Error('Order not found');
  const type = String(data.type || '').toLowerCase();
  if (!EXCEPTION_TYPES.includes(type)) throw new Error('Choose an exception type');
  const why = String(data.note || '').trim();
  if (why.length < 3) throw new Error('Explain why this is a legitimate exception');
  const f = { exception_type: type, exception_note: why, exception_by_name: actorName(actor), exception_at: nowIso(), needs_reason: 0 };
  let changed = null;
  if (data.new_target_minutes != null && Number(data.new_target_minutes) > 0) {
    const nt = posNum(data.new_target_minutes, row.target_minutes);
    changed = { from: Number(row.target_minutes), to: nt };
    f.target_minutes = nt;
  }
  let next = patch(row, f);
  addEvent(next, 'exception', {
    actor: { id: actor.id, name: actorName(actor), role: actor.role }, module: 'sla',
    note: `${type}: ${why}${changed ? ` · SLA ${changed.from} → ${changed.to} min (original ${row.original_target_minutes} min)` : ''}`,
    data: { type, note: why, target_change: changed, original_target_minutes: row.original_target_minutes }
  });
  if (next.completed_at) next = patch(next, { ...recalcFinal(next) });
  try {
    run(`UPDATE order_sla_incidents SET status = 'closed_exception', manager_explanation = COALESCE(manager_explanation, ?), updated_at = ?
      WHERE order_sla_id = ? AND status IN ('open', 'explained')`, [`Approved exception: ${type} — ${why}`, nowIso(), row.id]);
  } catch (_) { /* */ }
  return present(next);
}

function recalcFinal(row) {
  const settings = getSettings();
  const target = Number(row.target_minutes) || 30;
  const total = elapsedMinutes(row);
  const level = levelFor(target > 0 ? (total / target) * 100 : 0, settings.thresholds);
  return { final_status: LEVEL_KEYS[level], delay_minutes: round1(Math.max(0, total - target)) };
}

function pauseTimer(id, reason, actor) {
  const settings = getSettings();
  requireRole(actor, settings.pause_roles, 'You are not authorised to pause order timers');
  const row = getById(id);
  if (!row) throw new Error('Order not found');
  if (row.completed_at || row.cancelled_at) throw new Error('Order is already finished');
  if (row.paused_at) throw new Error('Timer is already paused');
  const why = String(reason || '').trim();
  if (why.length < 3) throw new Error('A reason is required to pause the timer');
  const next = patch(row, { paused_at: nowIso(), pause_reason: why });
  addEvent(next, 'timer_paused', { actor: { id: actor.id, name: actorName(actor), role: actor.role }, module: 'sla', note: why });
  return present(next);
}

function resumeTimer(id, actor) {
  const settings = getSettings();
  requireRole(actor, settings.pause_roles, 'You are not authorised to resume order timers');
  const row = getById(id);
  if (!row) throw new Error('Order not found');
  if (!row.paused_at) throw new Error('Timer is not paused');
  const pausedFor = Math.max(0, Date.now() - (ms(row.paused_at) || Date.now()));
  const next = patch(row, { paused_ms: (Number(row.paused_ms) || 0) + pausedFor, paused_at: null });
  addEvent(next, 'timer_resumed', { actor: { id: actor.id, name: actorName(actor), role: actor.role }, module: 'sla', note: `Paused ${round1(pausedFor / 60000)} min · ${row.pause_reason || ''}`, data: { paused_ms: pausedFor, started: row.paused_at } });
  return present(next);
}

// ─── Live board, timeline, scanner ──────────────────────────────────────────

function liveBoard(filters = {}) {
  ensureSchema();
  const settings = getSettings();
  const since = new Date(Date.now() - 24 * 3600000).toISOString();
  const params = [since];
  let sql = `SELECT * FROM order_sla WHERE completed_at IS NULL AND cancelled_at IS NULL AND created_at >= ? AND tracked = 1`;
  if (filters.branch_id) { sql += ' AND branch_id = ?'; params.push(Number(filters.branch_id)); }
  if (filters.source) { sql += ' AND source = ?'; params.push(String(filters.source)); }
  if (filters.order_type) { sql += ' AND order_type = ?'; params.push(String(filters.order_type)); }
  sql += ' ORDER BY created_at LIMIT 300';
  const now = Date.now();
  const orders = qa(sql, params).filter((r) => r.status !== 'awaiting_payment').map((r) => present(r, settings, now));
  const counts = { active: orders.length, new: 0, on_time: 0, warning: 0, overdue: 0, critical: 0 };
  for (const o of orders) counts[o.state] = (counts[o.state] || 0) + 1;
  const stations = {};
  for (const o of orders) {
    if (o.stage === 'kitchen' || o.stage === 'handover') {
      const key = o.station || 'kitchen';
      stations[key] = (stations[key] || 0) + 1;
    }
  }
  return {
    generated_at: new Date(now).toISOString(),
    enabled: settings.enabled,
    counts,
    stations: Object.entries(stations).map(([station, active]) => ({ station, active })).sort((a, b) => b.active - a.active),
    orders: orders.sort((a, b) => b.percent - a.percent)
  };
}

function findRow(ref) {
  ensureSchema();
  if (ref == null || ref === '') return null;
  if (typeof ref === 'object') {
    if (ref.id) return getById(ref.id);
    if (ref.sale_id) return getBySale(ref.sale_id);
    if (ref.online_order_id) return getByKey(`online:${Number(ref.online_order_id)}`);
    if (ref.order_number) return q('SELECT * FROM order_sla WHERE order_number = ? ORDER BY id DESC LIMIT 1', [String(ref.order_number)]);
    return null;
  }
  return getById(ref);
}

function timeline(ref, opts = {}) {
  const row = findRow(ref);
  if (!row) throw new Error('No timeline for this order yet');
  const events = qa('SELECT * FROM order_sla_events WHERE order_sla_id = ? ORDER BY occurred_at, id', [row.id]);
  const out = { order: present(row), events, stages: stageBreakdown(row, getSettings()) };
  out.order.delay_note = row.delay_note || null;
  out.order.delay_by_name = row.delay_by_name || null;
  out.order.exception_note = row.exception_note || null;
  out.order.exception_by_name = row.exception_by_name || null;
  out.order.accepted_by_name = row.accepted_by_name || null;
  out.order.prepared_by_name = row.prepared_by_name || null;
  out.order.handed_over_by_name = row.handed_over_by_name || null;
  if (opts.includeIncidents) out.incidents = qa('SELECT * FROM order_sla_incidents WHERE order_sla_id = ? ORDER BY id', [row.id]);
  out.integration = integrationCheck(row);
  return out;
}

/** Did this order reach inventory, accounting, loyalty, kitchen and reporting? Read-only checks on real rows. */
function integrationCheck(row) {
  const out = { sale: false, kitchen: false, stock: null, accounting: null, loyalty: null, payment: null };
  if (!row.sale_id) return out;
  const safe = (fn) => { try { return fn(); } catch (_) { return null; } };
  const sale = safe(() => q('SELECT id, status, customer_id, total FROM sales WHERE id = ?', [row.sale_id]));
  out.sale = !!sale;
  out.sale_status = sale?.status || null;
  out.kitchen = !!row.kitchen_order_id || !!safe(() => q('SELECT id FROM kitchen_orders WHERE sale_id = ? LIMIT 1', [row.sale_id]));
  const pay = safe(() => q('SELECT COALESCE(SUM(amount),0) AS t, COUNT(*) AS c FROM sale_payments WHERE sale_id = ?', [row.sale_id]));
  out.payment = pay ? { recorded: Number(pay.c) > 0, amount: Number(pay.t) || 0 } : null;
  const stock = safe(() => q(`SELECT COUNT(*) AS c FROM stock_movements WHERE reference_type = 'sale' AND reference_id = ?`, [row.sale_id]));
  out.stock = stock ? { movements: Number(stock.c) || 0 } : null;
  const acc = safe(() => q(`SELECT id, reference FROM acc_journals WHERE source_type = 'sale' AND source_id = ? LIMIT 1`, [row.sale_id]));
  out.accounting = acc ? { posted: true, journal_id: acc.id, reference: acc.reference } : (acc === null ? null : { posted: false });
  if (sale?.customer_id) {
    const pts = safe(() => q(`SELECT COUNT(*) AS c FROM loyalty_transactions WHERE sale_id = ?`, [row.sale_id]));
    out.loyalty = pts ? { customer_id: sale.customer_id, transactions: Number(pts.c) || 0 } : { customer_id: sale.customer_id };
  }
  return out;
}

let _lastScan = 0;

/**
 * Raises alert levels, escalates through the Communication Center, auto-completes counter sales that never
 * went to a kitchen, and reports kiosks that stopped sending heartbeats. Cheap: one query for open orders.
 */
function scan() {
  if (Date.now() - _lastScan < 20000) return { skipped: true };
  _lastScan = Date.now();
  ensureSchema();
  const settings = getSettings();
  if (!settings.enabled) return { enabled: false };
  const since = new Date(Date.now() - 24 * 3600000).toISOString();
  const rows = qa(`SELECT * FROM order_sla WHERE completed_at IS NULL AND cancelled_at IS NULL AND created_at >= ? AND tracked = 1 LIMIT 500`, [since]);
  const now = Date.now();
  let escalated = 0;
  let autoCompleted = 0;
  for (const r of rows) {
    if (r.status === 'awaiting_payment') continue;
    if (!r.kitchen_order_id && !r.delivery_id && r.order_type !== 'delivery' && r.source !== 'online' && r.status === 'accepted'
      && now - (ms(r.created_at) || now) > settings.counter_sale_complete_minutes * 60000) {
      const done = patch(r, { tracked: 0 });
      advance(done, 'completed', { name: 'System', role: 'system' }, { module: 'sla', note: 'Counter sale — no kitchen or delivery step', at: r.accepted_at || r.created_at });
      autoCompleted++;
      continue;
    }
    if (r.paused_at) continue;
    const p = present(r, settings, now);
    const prev = Number(r.alert_level) || 0;
    if (p.level > prev) {
      patch(r, { alert_level: p.level, needs_reason: p.level >= 3 && !r.delay_reason ? 1 : Number(r.needs_reason) || 0 });
      addEvent(r, 'sla_level', { uid: `${r.id}:level:${p.level}`, stage: p.stage, module: 'sla', note: `${p.state_label} — ${p.timer_text} (${p.percent}%)`, actor: { name: 'System', role: 'system' } });
      if (settings.escalate && p.level >= 2) { escalate(r, p); escalated++; }
    }
  }
  let kiosks = 0;
  try {
    const stale = require('./kiosk-platform').staleKiosksToNotify(settings.kiosk_offline_minutes);
    for (const k of stale) {
      kiosks++;
      emitCc('kiosk.offline', {
        kiosk_name: k.name, kiosk_location: k.location || '', branch_id: k.branch_id || null,
        last_heartbeat: String(k.last_heartbeat || ''),
        announcement: `🔴 KIOSK OFFLINE — ${k.name}${k.location ? ` (${k.location})` : ''}. Last heartbeat ${k.last_heartbeat}.`
      }, `kiosk-offline:${k.id}:${String(k.last_heartbeat || '').slice(0, 16)}`);
    }
  } catch (_) { /* kiosk module optional */ }
  return { open: rows.length, escalated, auto_completed: autoCompleted, kiosks_offline: kiosks };
}

function escalate(row, p) {
  const key = p.level >= 5 ? 'order.sla_critical' : p.level === 4 ? 'order.sla_escalation' : p.level === 3 ? 'order.sla_overdue' : 'order.sla_warning';
  const over = Math.max(0, Math.round((p.elapsed_seconds / 60) - p.target_minutes));
  const stageName = p.stage ? ({ accept: 'Acceptance', kitchen: 'Kitchen', pack: 'Packing', handover: 'Handover', delivery: 'Delivery' }[p.stage]) : 'Order';
  const icon = p.level >= 5 ? '⚫' : p.level >= 3 ? '🔴' : '🟡';
  const lines = [
    `${icon} ORDER #${row.order_number} ${p.state_label}`,
    over > 0 ? `${stageName} SLA exceeded by ${over} minute${over === 1 ? '' : 's'}.` : `${stageName} at ${p.percent}% of SLA (${p.timer_text}).`,
    row.station ? `Station: ${row.station}` : null,
    p.responsible ? `Assigned: ${p.responsible}` : null,
    `Source: ${String(row.source || '').toUpperCase()} · ${row.order_type}`
  ].filter(Boolean);
  emitCc(key, {
    order_number: row.order_number, branch_id: row.branch_id || null, sla_state: p.state_label, timer: p.timer_text,
    overdue_minutes: over, stage: stageName, station: row.station || '', assigned: p.responsible || '',
    announcement: lines.join('\n')
  }, `sla:${row.id}:${p.level}`);
}

function emitCc(eventKey, payload, dedupe) {
  try {
    const cc = require('./communication-center');
    cc.emit(eventKey, payload, {
      body: payload.announcement,
      source_module: 'order-sla',
      transactional: true,
      priority: 3,
      dedupe_key: dedupe
    });
  } catch (err) {
    console.warn('[sla] escalate:', err.message);
  }
}

let _timer = null;
function startScanner(intervalMs = 60000) {
  if (_timer) return;
  _timer = setInterval(() => {
    try { scan(); } catch (err) { console.warn('[sla] scan:', err.message); }
  }, Math.max(20000, intervalMs));
  if (_timer.unref) _timer.unref();
}

// ─── Reports ─────────────────────────────────────────────────────────────────

function dateRange(filters) {
  const today = localDate();
  let from = String(filters.from || filters.date || today).slice(0, 10);
  let to = String(filters.to || filters.date || from).slice(0, 10);
  if (to < from) [from, to] = [to, from];
  return { from, to };
}

function reportRows(filters = {}) {
  ensureSchema();
  const { from, to } = dateRange(filters);
  const params = [from, to];
  let sql = `SELECT * FROM order_sla WHERE order_date >= ? AND order_date <= ? AND tracked = 1 AND completed_at IS NOT NULL AND cancelled_at IS NULL`;
  if (filters.branch_id) { sql += ' AND branch_id = ?'; params.push(Number(filters.branch_id)); }
  if (filters.order_type) { sql += ' AND order_type = ?'; params.push(String(filters.order_type)); }
  if (filters.source) { sql += ' AND source = ?'; params.push(String(filters.source)); }
  if (filters.station) { sql += ' AND station = ?'; params.push(String(filters.station)); }
  if (filters.driver_id) { sql += ' AND driver_id = ?'; params.push(Number(filters.driver_id)); }
  if (filters.employee_id) {
    sql += ' AND (accepted_by = ? OR prepared_by = ?)';
    params.push(Number(filters.employee_id), Number(filters.employee_id));
  }
  sql += ' ORDER BY created_at LIMIT 20000';
  return { from, to, rows: qa(sql, params) };
}

function avg(list) {
  const v = list.filter((x) => x != null && Number.isFinite(x));
  return v.length ? round1(v.reduce((s, x) => s + x, 0) / v.length) : null;
}

function summarise(rows, settings) {
  const n = rows.length;
  const parsed = rows.map((r) => {
    let stages = [];
    try { stages = JSON.parse(r.stage_minutes_json || '[]'); } catch (_) { stages = []; }
    return { r, stages };
  });
  const stageAvg = (name) => avg(parsed.map(({ stages }) => stages.find((s) => s.stage === name && s.done)?.minutes ?? null));
  const late = rows.filter((r) => r.final_status === 'overdue' || r.final_status === 'critical');
  const critical = rows.filter((r) => r.final_status === 'critical');
  const onTime = rows.filter((r) => r.final_status === 'on_time' || r.final_status === 'warning' || r.exception_type);
  const reasons = {};
  for (const r of rows) if (r.delay_reason) reasons[r.delay_reason] = (reasons[r.delay_reason] || 0) + 1;
  const bottlenecks = {};
  for (const r of late) if (r.bottleneck) bottlenecks[r.bottleneck] = (bottlenecks[r.bottleneck] || 0) + 1;
  const stageOver = {};
  for (const { r, stages } of parsed) {
    if (!(r.final_status === 'overdue' || r.final_status === 'critical')) continue;
    for (const s of stages) if (s.over > 0) stageOver[s.stage] = round1((stageOver[s.stage] || 0) + s.over);
  }
  const mainBottleneck = Object.entries(stageOver).sort((a, b) => b[1] - a[1])[0];
  return {
    insufficient_data: n === 0,
    total_orders: n,
    on_time: onTime.length,
    late: late.length,
    critical: critical.length,
    exceptions: rows.filter((r) => r.exception_type).length,
    compliance_pct: n ? round1((onTime.length / n) * 100) : null,
    avg_acceptance_min: stageAvg('accept'),
    avg_preparation_min: stageAvg('kitchen'),
    avg_handover_min: stageAvg('handover'),
    avg_delivery_min: stageAvg('delivery'),
    avg_completion_min: avg(rows.map((r) => (r.total_minutes != null ? Number(r.total_minutes) : null))),
    avg_delay_min: avg(late.map((r) => Number(r.delay_minutes) || 0)),
    delay_reasons: Object.entries(reasons).map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    missing_reasons: rows.filter((r) => Number(r.needs_reason) === 1).length,
    bottlenecks: Object.entries(bottlenecks).map(([stage, count]) => ({ stage, count })).sort((a, b) => b.count - a.count),
    stage_delay_minutes: stageOver,
    main_bottleneck: mainBottleneck ? mainBottleneck[0] : null,
    targets: settings.targets
  };
}

function groupSummary(rows, keyFn, settings) {
  const groups = {};
  for (const r of rows) {
    const k = keyFn(r);
    if (k == null || k === '') continue;
    (groups[k] = groups[k] || []).push(r);
  }
  return Object.entries(groups).map(([key, list]) => {
    const s = summarise(list, settings);
    return { key, total_orders: s.total_orders, on_time: s.on_time, late: s.late, critical: s.critical, compliance_pct: s.compliance_pct,
      avg_completion_min: s.avg_completion_min, avg_preparation_min: s.avg_preparation_min, avg_delivery_min: s.avg_delivery_min, avg_delay_min: s.avg_delay_min };
  }).sort((a, b) => b.total_orders - a.total_orders);
}

function slaReport(filters = {}) {
  const settings = getSettings();
  const { from, to, rows } = reportRows(filters);
  const branchNames = {};
  try { for (const b of qa('SELECT id, name FROM branches')) branchNames[b.id] = b.name; } catch (_) { /* */ }
  const late = rows.filter((r) => r.final_status === 'overdue' || r.final_status === 'critical');
  return {
    from, to, filters,
    summary: summarise(rows, settings),
    by_type: groupSummary(rows, (r) => r.order_type, settings),
    by_source: groupSummary(rows, (r) => r.source, settings),
    by_branch: groupSummary(rows, (r) => (r.branch_id ? branchNames[r.branch_id] || `Branch ${r.branch_id}` : null), settings),
    by_station: groupSummary(rows, (r) => r.station, settings),
    by_employee: groupSummary(rows, (r) => r.prepared_by_name || r.accepted_by_name, settings),
    by_driver: groupSummary(rows.filter((r) => r.order_type === 'delivery'), (r) => r.driver_name, settings),
    late_orders: late.slice(-200).reverse().map((r) => {
      let stages = [];
      try { stages = JSON.parse(r.stage_minutes_json || '[]'); } catch (_) { stages = []; }
      return {
        id: r.id, order_number: r.order_number, source: r.source, order_type: r.order_type, branch_id: r.branch_id,
        created_at: r.created_at, total_minutes: Number(r.total_minutes) || 0, target_minutes: Number(r.target_minutes) || 0,
        delay_minutes: Number(r.delay_minutes) || 0, final_status: r.final_status, bottleneck: r.bottleneck,
        stage_over: stages.filter((s) => s.over > 0).map((s) => ({ stage: s.stage, over: s.over })),
        delay_reason: r.delay_reason, exception_type: r.exception_type, station: r.station, driver_name: r.driver_name
      };
    })
  };
}

/** Daily order report: real sales by channel/type plus SLA performance for the same days. */
function dailyOrderReport(filters = {}) {
  const settings = getSettings();
  const { from, to } = dateRange(filters);
  const params = [from, to];
  let branchSql = '';
  if (filters.branch_id) { branchSql = ' AND s.branch_id = ?'; params.push(Number(filters.branch_id)); }
  const dateExpr = "date(COALESCE(s.sale_datetime, s.created_at), 'localtime')";
  let sales = [];
  try {
    sales = qa(`SELECT ${dateExpr} AS d, s.order_source, s.order_type, COUNT(*) AS c, COALESCE(SUM(s.total),0) AS t
      FROM sales s WHERE ${dateExpr} >= ? AND ${dateExpr} <= ? AND s.status IN ('completed','partial_return')${branchSql}
      GROUP BY ${dateExpr}, s.order_source, s.order_type`, params);
  } catch (_) { sales = []; }
  const channels = { pos: { orders: 0, sales: 0 }, online: { orders: 0, sales: 0 }, kiosk: { orders: 0, sales: 0 }, drive_thru: { orders: 0, sales: 0 }, phone: { orders: 0, sales: 0 } };
  const types = { delivery: { orders: 0, sales: 0 }, takeaway: { orders: 0, sales: 0 }, dine_in: { orders: 0, sales: 0 }, drive_thru: { orders: 0, sales: 0 }, kiosk: { orders: 0, sales: 0 }, online: { orders: 0, sales: 0 } };
  let totalOrders = 0;
  let totalSales = 0;
  for (const r of sales) {
    const src = sourceFrom(r.order_source, 'pos');
    const type = typeFrom(r.order_type, src, null);
    const c = Number(r.c) || 0;
    const t = Number(r.t) || 0;
    totalOrders += c; totalSales += t;
    channels[src] = channels[src] || { orders: 0, sales: 0 };
    channels[src].orders += c; channels[src].sales = Math.round((channels[src].sales + t) * 100) / 100;
    types[type].orders += c; types[type].sales = Math.round((types[type].sales + t) * 100) / 100;
  }
  const { rows } = reportRows({ ...filters, from, to });
  return {
    from, to,
    insufficient_data: totalOrders === 0,
    total_orders: totalOrders,
    total_sales: Math.round(totalSales * 100) / 100,
    channels, types,
    sla: summarise(rows, settings)
  };
}

/** Kiosk report from kiosk_orders, sales, error log and heartbeat reconnect records. */
function kioskReport(filters = {}) {
  const { from, to } = dateRange(filters);
  let devices = [];
  try { devices = qa('SELECT id, name, location, branch_id FROM kiosk_devices WHERE is_revoked = 0 ORDER BY name'); } catch (_) { return { from, to, insufficient_data: true, kiosks: [] }; }
  const day = 'substr(CAST(ko.created_at AS TEXT), 1, 10)';
  let orders = [];
  try {
    orders = qa(`SELECT ko.device_id, COUNT(*) AS c, COALESCE(SUM(ko.total),0) AS revenue, AVG(ko.txn_seconds) AS txn,
      SUM(CASE WHEN s.status IN ('voided','returned') THEN 1 ELSE 0 END) AS cancelled,
      SUM(CASE WHEN ko.sync_status = 'synced_after_offline' THEN 1 ELSE 0 END) AS offline_synced
      FROM kiosk_orders ko LEFT JOIN sales s ON s.id = ko.sale_id
      WHERE ${day} >= ? AND ${day} <= ? GROUP BY ko.device_id`, [from, to]);
  } catch (_) {
    try {
      orders = qa(`SELECT ko.device_id, COUNT(*) AS c, COALESCE(SUM(ko.total),0) AS revenue FROM kiosk_orders ko
        WHERE ${day} >= ? AND ${day} <= ? GROUP BY ko.device_id`, [from, to]);
    } catch (__) { orders = []; }
  }
  let errs = [];
  try {
    errs = qa(`SELECT device_id, error_type, COUNT(*) AS c, COALESCE(SUM(CAST(COALESCE(json_extract(context_json, '$.offline_seconds'), 0) AS REAL)), 0) AS secs
      FROM kiosk_error_log WHERE substr(CAST(created_at AS TEXT), 1, 10) >= ? AND substr(CAST(created_at AS TEXT), 1, 10) <= ?
      GROUP BY device_id, error_type`, [from, to]);
  } catch (_) {
    try {
      errs = qa(`SELECT device_id, error_type, COUNT(*) AS c FROM kiosk_error_log
        WHERE substr(CAST(created_at AS TEXT), 1, 10) >= ? AND substr(CAST(created_at AS TEXT), 1, 10) <= ? GROUP BY device_id, error_type`, [from, to]);
    } catch (__) { errs = []; }
  }
  const sla = reportRows({ from, to, source: 'kiosk' }).rows;
  const kiosks = devices.map((d) => {
    const o = orders.find((x) => Number(x.device_id) === Number(d.id)) || {};
    const e = errs.filter((x) => Number(x.device_id) === Number(d.id));
    const count = (types) => e.filter((x) => types.includes(x.error_type)).reduce((s, x) => s + (Number(x.c) || 0), 0);
    const reconnects = e.filter((x) => x.error_type === 'reconnected');
    const downtimeSecs = reconnects.reduce((s, x) => s + (Number(x.secs) || 0), 0);
    const c = Number(o.c) || 0;
    const revenue = Math.round((Number(o.revenue) || 0) * 100) / 100;
    const kSla = sla.filter((r) => Number(r.kiosk_device_id) === Number(d.id));
    return {
      id: d.id, name: d.name, location: d.location, branch_id: d.branch_id,
      orders: c, revenue,
      avg_order_value: c ? Math.round((revenue / c) * 100) / 100 : null,
      avg_transaction_seconds: o.txn != null ? Math.round(Number(o.txn)) : null,
      cancelled_orders: Number(o.cancelled) || 0,
      offline_synced_orders: Number(o.offline_synced) || 0,
      failed_orders: count(['order_submission_failure']),
      payment_failures: count(['payment_failure']),
      sync_failures: count(['sync_failure', 'kitchen_sync_failure']),
      errors: e.filter((x) => x.error_type !== 'reconnected').reduce((s, x) => s + (Number(x.c) || 0), 0),
      downtime_minutes: reconnects.length ? round1(downtimeSecs / 60) : null,
      sla_compliance_pct: kSla.length ? summarise(kSla, getSettings()).compliance_pct : null
    };
  });
  return { from, to, insufficient_data: !kiosks.some((k) => k.orders > 0), kiosks };
}

// ─── Performance incidents (review workflow — never touches payroll) ─────────

function listIncidents(filters = {}) {
  ensureSchema();
  const params = [];
  let sql = 'SELECT i.*, s.source, s.order_type, s.total_minutes, s.target_minutes, s.delay_reason FROM order_sla_incidents i LEFT JOIN order_sla s ON s.id = i.order_sla_id WHERE 1=1';
  if (filters.status) { sql += ' AND i.status = ?'; params.push(String(filters.status)); }
  if (filters.employee_id) { sql += ' AND i.employee_id = ?'; params.push(Number(filters.employee_id)); }
  if (filters.branch_id) { sql += ' AND i.branch_id = ?'; params.push(Number(filters.branch_id)); }
  if (filters.adjustment_status) { sql += ' AND i.adjustment_status = ?'; params.push(String(filters.adjustment_status)); }
  sql += ' ORDER BY i.id DESC LIMIT ?';
  params.push(Math.min(Number(filters.limit) || 200, 1000));
  return qa(sql, params).map((r) => ({ ...r, level_label: r.level ? INCIDENT_LEVELS[r.level] : null }));
}

function updateIncident(id, data = {}, actor) {
  requireRole(actor, ['owner', 'manager', 'assistant_manager', 'supervisor'], 'Only supervisors and managers can update performance incidents');
  const inc = q('SELECT * FROM order_sla_incidents WHERE id = ?', [Number(id)]);
  if (!inc) throw new Error('Incident not found');
  if (String(inc.status).startsWith('closed') && !['owner', 'manager'].includes(actor.role)) throw new Error('This incident is closed');
  const f = {};
  const changes = [];
  if (data.employee_explanation != null) { f.employee_explanation = String(data.employee_explanation).slice(0, 2000); changes.push('employee explanation'); }
  if (data.manager_explanation != null) { f.manager_explanation = String(data.manager_explanation).slice(0, 2000); changes.push('manager explanation'); }
  if (data.level != null) {
    const lv = Number(data.level);
    if (!INCIDENT_LEVELS[lv]) throw new Error('Level must be 1–5');
    if (lv >= 3 && !['owner', 'manager'].includes(actor.role)) throw new Error('Only an owner or manager can issue a written warning or higher');
    f.level = lv; changes.push(`level ${lv} (${INCIDENT_LEVELS[lv]})`);
  }
  if (data.action_taken != null) { f.action_taken = String(data.action_taken).slice(0, 2000); changes.push('action'); }
  if (data.follow_up_date != null) { f.follow_up_date = String(data.follow_up_date).slice(0, 10) || null; changes.push('follow-up'); }
  if (data.status) {
    const st = String(data.status);
    if (!['open', 'explained', 'actioned', 'closed'].includes(st)) throw new Error('Invalid status');
    f.status = st; changes.push(`status ${st}`);
  }
  if (!Object.keys(f).length) return inc;
  const keys = Object.keys(f);
  run(`UPDATE order_sla_incidents SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, [...keys.map((k) => f[k]), nowIso(), inc.id]);
  const row = getById(inc.order_sla_id);
  if (row) addEvent(row, 'incident_updated', { actor: { id: actor.id, name: actorName(actor), role: actor.role }, module: 'sla', note: changes.join(', '), data: { incident_id: inc.id } });
  return q('SELECT * FROM order_sla_incidents WHERE id = ?', [inc.id]);
}

/** Adjustment request → manager approval → payroll approval. Approved items are listed for payroll; payroll is never changed here. */
function adjustmentAction(id, action, data = {}, actor) {
  const inc = q('SELECT * FROM order_sla_incidents WHERE id = ?', [Number(id)]);
  if (!inc) throw new Error('Incident not found');
  const who = actorName(actor);
  const row = getById(inc.order_sla_id);
  const log = (note) => row && addEvent(row, 'adjustment', { actor: { id: actor?.id, name: who, role: actor?.role }, module: 'sla', note, data: { incident_id: inc.id } });
  if (action === 'request') {
    requireRole(actor, ['owner', 'manager', 'assistant_manager', 'supervisor'], 'Only supervisors and managers can request an adjustment');
    const amount = Math.round((Number(data.amount) || 0) * 100) / 100;
    const reason = String(data.reason || '').trim();
    if (!(amount > 0)) throw new Error('Enter the adjustment amount');
    if (reason.length < 5) throw new Error('Give the reason for the adjustment');
    if (!inc.employee_explanation && !data.no_explanation_reason) throw new Error('Record the employee explanation first (or why it could not be obtained)');
    run(`UPDATE order_sla_incidents SET adjustment_amount = ?, adjustment_reason = ?, adjustment_status = 'requested',
      employee_explanation = COALESCE(employee_explanation, ?), updated_at = ? WHERE id = ?`,
      [amount, reason, data.no_explanation_reason ? `Not obtained: ${String(data.no_explanation_reason).slice(0, 500)}` : null, nowIso(), inc.id]);
    log(`Adjustment requested: ${amount.toFixed(2)} — ${reason}`);
  } else if (action === 'manager_approve') {
    requireRole(actor, ['owner', 'manager'], 'Only an owner or manager can approve');
    if (inc.adjustment_status !== 'requested') throw new Error('Nothing waiting for manager approval');
    run(`UPDATE order_sla_incidents SET adjustment_status = 'manager_approved', manager_approved_by = ?, manager_approved_at = ?, updated_at = ? WHERE id = ?`, [who, nowIso(), nowIso(), inc.id]);
    log('Adjustment approved by manager');
  } else if (action === 'payroll_approve') {
    requireRole(actor, ['owner'], 'Payroll approval requires the owner');
    if (inc.adjustment_status !== 'manager_approved') throw new Error('Manager approval is required first');
    if (inc.manager_approved_by && inc.manager_approved_by === who) throw new Error('Payroll approval must be done by a different person than the manager approval');
    run(`UPDATE order_sla_incidents SET adjustment_status = 'payroll_approved', payroll_approved_by = ?, payroll_approved_at = ?, updated_at = ? WHERE id = ?`, [who, nowIso(), nowIso(), inc.id]);
    log('Adjustment approved for payroll (apply through the normal payroll run)');
  } else if (action === 'reject') {
    requireRole(actor, ['owner', 'manager'], 'Only an owner or manager can reject');
    if (!['requested', 'manager_approved'].includes(inc.adjustment_status)) throw new Error('Nothing to reject');
    run(`UPDATE order_sla_incidents SET adjustment_status = 'rejected', updated_at = ? WHERE id = ?`, [nowIso(), inc.id]);
    log(`Adjustment rejected${data.reason ? `: ${String(data.reason).slice(0, 300)}` : ''}`);
  } else {
    throw new Error('Unknown adjustment action');
  }
  try {
    run('INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, details) VALUES (?,?,?,?,?,?)',
      [actor?.id || null, who, `sla_adjustment_${action}`, 'order_sla_incident', inc.id, JSON.stringify({ amount: data.amount, reason: data.reason })]);
  } catch (_) { /* */ }
  return q('SELECT * FROM order_sla_incidents WHERE id = ?', [inc.id]);
}

/** Kiosk orders for the POS Kiosk tab: real kiosk sales with timer + kitchen state. */
function kioskOrdersForPos(filters = {}) {
  ensureSchema();
  const settings = getSettings();
  const since = String(filters.date || localDate()).slice(0, 10);
  const params = [since];
  let sql = `SELECT s.*, ko.status AS kitchen_status FROM order_sla s LEFT JOIN kitchen_orders ko ON ko.id = s.kitchen_order_id
    WHERE s.source = 'kiosk' AND s.order_date >= ?`;
  if (filters.branch_id) { sql += ' AND s.branch_id = ?'; params.push(Number(filters.branch_id)); }
  sql += ' ORDER BY s.created_at DESC LIMIT 150';
  const rows = qa(sql, params);
  let devices = {};
  try { for (const d of qa('SELECT id, name FROM kiosk_devices')) devices[d.id] = d.name; } catch (_) { devices = {}; }
  const saleIds = rows.map((r) => r.sale_id).filter(Boolean);
  const items = {};
  const sales = {};
  if (saleIds.length) {
    const ph = saleIds.map(() => '?').join(',');
    try {
      for (const it of qa(`SELECT sale_id, product_name, quantity FROM sale_items WHERE sale_id IN (${ph})`, saleIds)) {
        (items[it.sale_id] = items[it.sale_id] || []).push(`${it.product_name} ×${Number(it.quantity) || 1}`);
      }
      for (const sRow of qa(`SELECT s.id, s.status, s.customer_id, c.name AS customer_name FROM sales s LEFT JOIN customers c ON c.id = s.customer_id WHERE s.id IN (${ph})`, saleIds)) {
        sales[sRow.id] = sRow;
      }
    } catch (_) { /* */ }
  }
  const now = Date.now();
  let failed = [];
  try {
    failed = qa(`SELECT id, device_id, error_type, message, context_json, created_at FROM kiosk_error_log
      WHERE error_type IN ('order_submission_failure', 'payment_failure') AND substr(CAST(created_at AS TEXT), 1, 10) >= ?
      ORDER BY id DESC LIMIT 50`, [since]).map((e) => {
      let ctx = {};
      try { ctx = JSON.parse(e.context_json || '{}'); } catch (_) { ctx = {}; }
      return {
        id: `err-${e.id}`, group: 'failed', order_number: ctx.client_request_id || null, source: 'kiosk',
        kiosk_name: devices[e.device_id] || (e.device_id ? `Kiosk ${e.device_id}` : 'Kiosk'),
        items: [], total: Number(ctx.total) || 0, payment_status: e.error_type === 'payment_failure' ? 'failed' : 'unknown',
        state: 'failed', state_label: 'FAILED', timer_text: null, created_at: e.created_at, error: e.message || e.error_type
      };
    });
  } catch (_) { failed = []; }
  return rows.map((r) => {
    const p = present(r, settings, now);
    const sale = sales[r.sale_id] || {};
    let group = 'active';
    if (r.cancelled_at || ['voided', 'returned'].includes(sale.status)) group = 'cancelled';
    else if (r.completed_at) group = 'completed';
    else if (r.ready_at || r.packed_at) group = 'ready';
    else if (r.prep_started_at) group = 'preparing';
    else group = 'new';
    return {
      ...p,
      group,
      kiosk_name: devices[r.kiosk_device_id] || (r.kiosk_device_id ? `Kiosk ${r.kiosk_device_id}` : 'Kiosk'),
      customer_name: sale.customer_name || null,
      items: items[r.sale_id] || [],
      payment_status: sale.status && ['voided', 'returned'].includes(sale.status) ? 'refunded' : 'paid',
      kitchen_status: r.kitchen_status || null,
      responsible_employee: r.prepared_by_name || r.accepted_by_name || null
    };
  }).concat(failed);
}

module.exports = {
  STAGES, ORDER_TYPES, KITCHEN_REASONS, DELIVERY_REASONS, EXCEPTION_TYPES, INCIDENT_LEVELS,
  ensureSchema, getSettings, saveSettings,
  onSaleCompleted, onKitchenCreated, onKitchenStatus, onOnlineEvent, onDeliveryStatus, recordSaleStage, linkKioskOrder,
  attachToKitchenOrders, attachToDeliveries, present, liveBoard, timeline, findRow, scan, startScanner,
  setDelayReason, driverDelayReason, setException, pauseTimer, resumeTimer,
  slaReport, dailyOrderReport, kioskReport, listIncidents, updateIncident, adjustmentAction, kioskOrdersForPos,
  _internal: { levelFor, elapsedMinutes, stageBreakdown, typeFrom, sourceFrom, clock, isPgMode }
};

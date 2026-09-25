/**
 * Manager Operations & Daily Tasks — mod.manager_operations
 * Entitlement-gated. Disabling the module never deletes historical data.
 */
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const {
  dbGet, dbAll, dbRun, nowIso, nowPlusDays, hashToken, newToken, parseJson
} = require('./biz-modules-common');
const { assetsDir, fileDataUrl } = require('./local-assets');
const { getDb } = require('../database/db');

const MODULE_ID = 'mod.manager_operations';
const MANAGER_ROLES = new Set(['owner', 'manager', 'assistant_manager', 'supervisor']);
const WORKER_ROLES = new Set(['kitchen', 'kitchen_worker', 'cashier', 'staff', 'operations']);

const INCIDENT_CATEGORIES = [
  'Customer complaint', 'Stock problem', 'Equipment problem', 'Staff problem',
  'Food quality', 'Supplier problem', 'Internet/POS problem', 'Cleaning problem',
  'Security problem', 'Other'
];

const DEFAULT_CHECKLISTS = [
  {
    code: 'opening', name: 'Opening Checklist', category: 'opening', assigned_role: 'assistant_manager',
    items: [
      'Shop opened on time', 'Shop clean', 'Kitchen ready', 'Staff present', 'POS working',
      'Internet working', 'Cash drawer checked', 'Products available', 'Food preparation started',
      "Today's promotion confirmed", "Today's sales target checked"
    ]
  },
  {
    code: 'kitchen', name: 'Kitchen Checklist', category: 'kitchen', assigned_role: 'kitchen',
    items: [
      'Kitchen clean', 'Equipment clean', 'Ingredients available', 'Food prepared',
      'Food quality checked', 'Storage checked', 'Waste checked'
    ]
  },
  {
    code: 'customer', name: 'Customer Service Check', category: 'customers', assigned_role: 'assistant_manager',
    items: [
      'Customers greeted', 'Orders handled correctly', 'Waiting times checked',
      'Complaints checked', 'Customer requests recorded'
    ]
  },
  {
    code: 'marketing', name: 'Marketing Checklist', category: 'marketing', assigned_role: 'assistant_manager',
    items: [
      'WhatsApp Status posted', 'Facebook post completed', "Today's promotion posted",
      'Product photos taken where required', 'Customer responses checked', 'Marketing result recorded'
    ]
  },
  {
    code: 'closing', name: 'Closing Checklist', category: 'closing', assigned_role: 'assistant_manager',
    items: [
      'Kitchen cleaned', 'Equipment cleaned', 'Food stored', 'Stock checked', 'Waste checked',
      'POS closed', 'Cash-up completed', 'Shop secured', "Tomorrow's preparation identified"
    ]
  },
  {
    code: 'stock', name: 'Stock Check', category: 'stock', assigned_role: 'assistant_manager',
    items: ['Stock levels checked', 'Low stock noted', 'Damaged stock reported']
  },
  {
    code: 'sales_check', name: 'Sales Check', category: 'sales', assigned_role: 'assistant_manager',
    items: ['Sales vs target reviewed', 'Best sellers noted', 'Slow movers noted']
  }
];

const DEFAULT_TASK_TEMPLATES = [
  { code: 'opening', name: 'Opening Checklist', category: 'opening', assigned_role: 'assistant_manager', photo_mode: 'optional', schedule_anchor: 'open', schedule_offset_minutes: 0, sort_order: 10, checklist_code: 'opening' },
  { code: 'sales', name: 'Sales Check', category: 'sales', assigned_role: 'assistant_manager', photo_mode: 'none', schedule_anchor: 'open', schedule_offset_minutes: 120, sort_order: 20, checklist_code: 'sales_check' },
  { code: 'customers', name: 'Customer Check', category: 'customers', assigned_role: 'assistant_manager', photo_mode: 'none', schedule_anchor: 'open', schedule_offset_minutes: 240, sort_order: 30, checklist_code: 'customer' },
  { code: 'marketing', name: 'Marketing Tasks', category: 'marketing', assigned_role: 'assistant_manager', photo_mode: 'optional', schedule_anchor: 'open', schedule_offset_minutes: 60, sort_order: 40, checklist_code: 'marketing' },
  { code: 'kitchen', name: 'Kitchen Check', category: 'kitchen', assigned_role: 'kitchen', photo_mode: 'required', schedule_anchor: 'open', schedule_offset_minutes: 30, sort_order: 50, checklist_code: 'kitchen' },
  { code: 'stock', name: 'Stock Check', category: 'stock', assigned_role: 'assistant_manager', photo_mode: 'optional', schedule_anchor: 'open', schedule_offset_minutes: 420, sort_order: 60, checklist_code: 'stock' },
  { code: 'closing', name: 'Closing Checklist', category: 'closing', assigned_role: 'assistant_manager', photo_mode: 'required', schedule_anchor: 'close', schedule_offset_minutes: -30, sort_order: 90, checklist_code: 'closing' },
  { code: 'attendance', name: 'Staff Attendance', category: 'attendance', assigned_role: 'assistant_manager', photo_mode: 'none', schedule_anchor: 'open', schedule_offset_minutes: 15, sort_order: 15 },
  { code: 'whatsapp', name: 'Post WhatsApp Status', category: 'marketing', assigned_role: 'assistant_manager', photo_mode: 'optional', schedule_anchor: 'open', schedule_offset_minutes: 90, sort_order: 41, is_primary: 1 },
  { code: 'facebook', name: 'Post Facebook', category: 'marketing', assigned_role: 'assistant_manager', photo_mode: 'optional', schedule_anchor: 'open', schedule_offset_minutes: 100, sort_order: 42 }
];

function dbInsert(sql, params = []) {
  let table = null;
  const m = String(sql).match(/INSERT\s+INTO\s+(\w+)/i);
  if (m) table = m[1];
  let maxBefore = 0;
  if (table) {
    try { maxBefore = Number(dbGet(`SELECT MAX(id) AS m FROM ${table}`)?.m) || 0; } catch (_) { maxBefore = 0; }
  }
  const r = dbRun(sql, params);
  let id = Number(r?.lastInsertRowid) || 0;
  if ((!id || id <= maxBefore) && table) {
    try {
      const after = Number(dbGet(`SELECT MAX(id) AS m FROM ${table}`)?.m) || 0;
      if (after > maxBefore) id = after;
    } catch (_) { /* */ }
  }
  return id;
}

function assertModuleEnabled() {
  try {
    const entitlements = require('./entitlements');
    if (entitlements.enforcementEnabled() && !entitlements.isModuleEnabled(MODULE_ID) && !entitlements.isModuleEnabled('manager_operations')) {
      const err = new Error('Manager Operations is not included in your package. Upgrade or enable the add-on in Platform Control.');
      err.code = 'MODULE_LOCKED';
      throw err;
    }
  } catch (e) {
    if (e.code === 'MODULE_LOCKED') throw e;
  }
}

function ensureSchema() {
  try {
    dbGet('SELECT 1 FROM mo_daily_tasks LIMIT 1');
  } catch (_) {
    try {
      const p = path.join(__dirname, '../database/migrations-v130.sql');
      if (fs.existsSync(p)) {
        const sql = fs.readFileSync(p, 'utf8');
        for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) {
          try { getDb().exec(stmt + ';'); } catch (e) {
            if (!/already exists|duplicate column/i.test(String(e.message || ''))) {
              console.warn('[manager-ops] migrate:', e.message);
            }
          }
        }
      }
    } catch (e) {
      console.warn('[manager-ops] schema:', e.message || e);
    }
  }
  ensureMoColumns();
}

function ensureMoColumns() {
  const cols = [
    ['mo_daily_tasks', 'manager_user_id', 'INTEGER'],
    ['mo_daily_tasks', 'assigned_user_name', 'TEXT'],
    ['mo_daily_tasks', 'manager_user_name', 'TEXT'],
    ['mo_task_templates', 'default_assigned_user_id', 'INTEGER'],
    ['mo_task_templates', 'manager_user_id', 'INTEGER'],
    ['mo_incidents', 'owner_seen_at', 'TEXT'],
    ['mo_incidents', 'resolved_notes', 'TEXT']
  ];
  for (const [table, col, typ] of cols) {
    try {
      getDb().exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${typ}`);
    } catch (_) { /* already exists */ }
  }
  try {
    getDb().exec(`CREATE TABLE IF NOT EXISTS mo_task_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER,
      user_id INTEGER,
      channel TEXT NOT NULL DEFAULT 'in_app',
      title TEXT,
      message TEXT,
      status TEXT NOT NULL DEFAULT 'sent',
      detail_json TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`);
  } catch (_) { /* */ }
  try {
    getDb().exec('CREATE INDEX IF NOT EXISTS idx_mo_task_notif_task ON mo_task_notifications(task_id)');
  } catch (_) { /* */ }
}

/** Avoid Postgres "could not determine data type of parameter" from `? IS NULL`. */
function countTasksForDay(day, branchId) {
  if (branchId == null || branchId === '' || branchId === 'all') {
    return Number(dbGet(
      'SELECT COUNT(*) AS c FROM mo_daily_tasks WHERE work_date = ? AND branch_id IS NULL',
      [day]
    )?.c) || 0;
  }
  return Number(dbGet(
    'SELECT COUNT(*) AS c FROM mo_daily_tasks WHERE work_date = ? AND branch_id = ?',
    [day, Number(branchId)]
  )?.c) || 0;
}

function findReportForDay(day, branchId) {
  if (branchId == null || branchId === '' || branchId === 'all') {
    return dbGet(
      'SELECT id FROM mo_daily_reports WHERE work_date = ? AND branch_id IS NULL',
      [day]
    );
  }
  return dbGet(
    'SELECT id FROM mo_daily_reports WHERE work_date = ? AND branch_id = ?',
    [day, Number(branchId)]
  );
}

function phoneForUser(userId) {
  if (!userId) return null;
  try {
    const emp = dbGet('SELECT phone FROM employees WHERE user_id = ? LIMIT 1', [Number(userId)]);
    if (emp?.phone) return emp.phone;
  } catch (_) { /* */ }
  try {
    const u = dbGet('SELECT phone FROM users WHERE id = ?', [Number(userId)]);
    if (u?.phone) return u.phone;
  } catch (_) { /* */ }
  return null;
}

function logTaskNotification(taskId, userId, channel, title, message, status, detail) {
  ensureSchema();
  try {
    dbRun(
      `INSERT INTO mo_task_notifications (task_id, user_id, channel, title, message, status, detail_json, created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      [taskId || null, userId || null, channel || 'in_app', title || null, message || null,
        status || 'sent', JSON.stringify(detail || {}), nowIso()]
    );
  } catch (e) {
    console.warn('[manager-ops] notification log:', e.message || e);
  }
}

function listTaskNotifications(filters = {}) {
  ensureSchema();
  let sql = 'SELECT * FROM mo_task_notifications WHERE 1=1';
  const params = [];
  if (filters.task_id) { sql += ' AND task_id = ?'; params.push(Number(filters.task_id)); }
  if (filters.user_id) { sql += ' AND user_id = ?'; params.push(Number(filters.user_id)); }
  sql += ' ORDER BY id DESC LIMIT ?';
  params.push(Math.min(Number(filters.limit) || 100, 500));
  return dbAll(sql, params) || [];
}

function notifyAssignee(task, assignee, actor, opts = {}) {
  if (!assignee?.id || !task) return { portal: false, in_app: false, whatsapp: false };
  const title = opts.title || 'Manager Ops task assigned';
  const message = opts.message || `${task.title} is assigned to you for ${task.work_date || todayLocal()}`;
  const out = { portal: false, in_app: false, whatsapp: false };

  try {
    pushStaffPortalFeed(assignee.id, title, message, task.id);
    out.portal = true;
    logTaskNotification(task.id, assignee.id, 'staff_portal', title, message, 'sent', {});
  } catch (_) { /* */ }

  try {
    notify('mo_task_assigned', title, message, {
      entity_type: 'mo_daily_task',
      entity_id: task.id,
      action_page: 'manager-ops',
      audience_user_ids: String(assignee.id)
    });
    out.in_app = true;
    logTaskNotification(task.id, assignee.id, 'in_app', title, message, 'sent', {});
  } catch (_) { /* */ }

  if (opts.whatsapp !== false) {
    const phone = phoneForUser(assignee.id);
    if (phone) {
      try {
        const wa = require('./whatsapp');
        const body = `Manager Operations\n\nHi ${assignee.full_name || assignee.username},\n\n${message}\n\nOpen Manager Ops or Staff Portal to complete it.`;
        const sendActor = actor && ['owner', 'manager', 'assistant_manager', 'supervisor'].includes(String(actor.role || '').toLowerCase())
          ? actor
          : { id: actor?.id || 0, role: 'owner', username: actor?.username || 'system', full_name: actor?.full_name || 'System' };
        Promise.resolve(wa.sendMessage({
          phone,
          body,
          message_type: 'custom',
          recipient_name: assignee.full_name || assignee.username,
          recipient_type: 'staff',
          prefer_wa_me: !!opts.prefer_wa_me
        }, sendActor)).then((r) => {
          logTaskNotification(task.id, assignee.id, 'whatsapp', title, body, r?.status || 'sent', {
            phone,
            via: r?.via || r?.meta?.via || null,
            url: r?.url || r?.meta?.url || null
          });
        }).catch((e) => {
          // Fallback: create wa.me pending message so WhatsApp still works offline API
          try {
            Promise.resolve(wa.sendMessage({
              phone,
              body,
              message_type: 'custom',
              recipient_name: assignee.full_name || assignee.username,
              recipient_type: 'staff',
              prefer_wa_me: true,
              force_wa_me: true
            }, sendActor)).then((r2) => {
              logTaskNotification(task.id, assignee.id, 'whatsapp', title, body, r2?.status || 'pending', {
                phone, fallback: true, url: r2?.url || r2?.meta?.url || null
              });
            }).catch((e2) => {
              logTaskNotification(task.id, assignee.id, 'whatsapp', title, body, 'failed', {
                phone, error: String(e2.message || e2 || e.message || e)
              });
            });
          } catch (e2) {
            logTaskNotification(task.id, assignee.id, 'whatsapp', title, body, 'failed', {
              phone, error: String(e2.message || e2 || e.message || e)
            });
          }
        });
        out.whatsapp = true;
      } catch (e) {
        logTaskNotification(task.id, assignee.id, 'whatsapp', title, message, 'failed', { error: String(e.message || e) });
      }
    } else {
      logTaskNotification(task.id, assignee.id, 'whatsapp', title, message, 'skipped', { reason: 'no_phone' });
    }
  }
  return out;
}

function shopKey() {
  try {
    return require('./entitlements').shopKey();
  } catch (_) {
    return String(process.env.SHOP_ENTITLEMENT_KEY || 'lab').trim() || 'lab';
  }
}

function todayLocal() {
  return new Date().toLocaleDateString('en-CA');
}

function moAudit(actor, action, entityType, entityId, detail) {
  ensureSchema();
  try {
    dbRun(
      `INSERT INTO mo_audit (actor_id, actor_name, action, entity_type, entity_id, detail_json, created_at)
       VALUES (?,?,?,?,?,?,?)`,
      [actor?.id || null, actor?.full_name || actor?.username || 'system', action, entityType || null,
        entityId != null ? String(entityId) : null, JSON.stringify(detail || {}), nowIso()]
    );
  } catch (_) { /* */ }
  try {
    const store = require('./store');
    store.audit?.(actor?.id, actor?.username || actor?.full_name, action, entityType, entityId, detail);
  } catch (_) { /* */ }
}

function notify(type, title, message, opts = {}) {
  try {
    const store = require('./store');
    store.addNotification?.(type, title, message, opts);
  } catch (_) { /* */ }
}

function mapUserRoleToMoRole(role) {
  const r = String(role || '').toLowerCase();
  if (r === 'owner' || r === 'manager') return 'manager';
  if (r === 'assistant_manager' || r === 'supervisor') return 'assistant_manager';
  if (r.includes('kitchen') || r === 'chef' || r === 'cook') return 'kitchen';
  if (r.includes('market') || r === 'operations') return 'operations';
  return r || 'staff';
}

function rolesForUser(user) {
  const mo = mapUserRoleToMoRole(user?.role);
  const set = new Set([mo, String(user?.role || '').toLowerCase()]);
  if (MANAGER_ROLES.has(String(user?.role || '').toLowerCase()) || mo === 'manager' || mo === 'assistant_manager') {
    set.add('assistant_manager');
    set.add('manager');
  }
  return [...set];
}

function canSeeAllShop(user) {
  const r = String(user?.role || '').toLowerCase();
  return r === 'owner' || r === 'manager' || r === 'assistant_manager' || r === 'supervisor';
}

function seedDefaults(actor) {
  ensureSchema();
  const count = dbGet('SELECT COUNT(*) AS c FROM mo_checklist_templates')?.c || 0;
  if (count > 0) return { seeded: false };

  for (const cl of DEFAULT_CHECKLISTS) {
    const r = dbInsert(
      `INSERT INTO mo_checklist_templates (code, name, category, assigned_role, description, sort_order, is_active)
       VALUES (?,?,?,?,?,?,1)`,
      [cl.code, cl.name, cl.category, cl.assigned_role, cl.name, DEFAULT_CHECKLISTS.indexOf(cl) * 10]
    );
    const tid = r;
    cl.items.forEach((label, i) => {
      dbRun(
        `INSERT INTO mo_checklist_items (template_id, label, is_required, photo_mode, sort_order, is_active)
         VALUES (?,?,1,'none',?,1)`,
        [tid, label, i]
      );
    });
  }

  for (const t of DEFAULT_TASK_TEMPLATES) {
    const cl = t.checklist_code
      ? dbGet('SELECT id FROM mo_checklist_templates WHERE code = ?', [t.checklist_code])
      : null;
    dbRun(
      `INSERT INTO mo_task_templates (
        code, name, category, description, assigned_role, is_primary, is_required, photo_mode,
        verification_required, priority, sort_order, schedule_offset_minutes, schedule_anchor, recurrence, is_active
      ) VALUES (?,?,?,?,?,?,1,?,?,?,?,?,?,?,1)`,
      [
        t.code, t.name, t.category, t.name, t.assigned_role, t.is_primary != null ? t.is_primary : 1,
        t.photo_mode || 'none', t.verification_required || 0, 'medium', t.sort_order || 0,
        t.schedule_offset_minutes != null ? t.schedule_offset_minutes : null,
        t.schedule_anchor || 'open', 'daily'
      ]
    );
    // Store checklist link via code match at generation time
  }
  moAudit(actor || { username: 'system' }, 'template_seeded', 'mo_task_templates', null, {});
  return { seeded: true };
}

function getMoSettings() {
  ensureSchema();
  const row = dbGet('SELECT * FROM mo_settings WHERE id = 1') || {};
  const settings = parseJson(row.settings_json, {});
  return {
    ...row,
    settings,
    allowed_user_ids: Array.isArray(settings.allowed_user_ids)
      ? settings.allowed_user_ids.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)
      : []
  };
}

function saveMoSettings(data, actor) {
  assertModuleEnabled();
  ensureSchema();
  requireAdmin(actor);
  const cur = getMoSettings();
  const nextSettings = { ...(cur.settings || {}) };
  if (data.settings && typeof data.settings === 'object') Object.assign(nextSettings, data.settings);
  if (Array.isArray(data.allowed_user_ids)) {
    const r = String(actor?.role || '').toLowerCase();
    if (!['owner', 'manager'].includes(r)) {
      throw new Error('Only owners and managers can change staff access');
    }
    nextSettings.allowed_user_ids = data.allowed_user_ids
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id) && id > 0);
  }
  const next = {
    daily_sales_target_override: data.daily_sales_target_override !== undefined
      ? data.daily_sales_target_override : cur.daily_sales_target_override,
    notify_owner_on_report: data.notify_owner_on_report !== undefined ? (data.notify_owner_on_report ? 1 : 0) : cur.notify_owner_on_report,
    notify_owner_on_urgent: data.notify_owner_on_urgent !== undefined ? (data.notify_owner_on_urgent ? 1 : 0) : cur.notify_owner_on_urgent,
    notify_manager_remaining: data.notify_manager_remaining !== undefined ? (data.notify_manager_remaining ? 1 : 0) : cur.notify_manager_remaining,
    auto_generate_tasks: data.auto_generate_tasks !== undefined ? (data.auto_generate_tasks ? 1 : 0) : cur.auto_generate_tasks,
    verification_role: data.verification_role != null ? data.verification_role : cur.verification_role,
    settings_json: JSON.stringify(nextSettings)
  };
  dbRun(
    `UPDATE mo_settings SET daily_sales_target_override=?, notify_owner_on_report=?, notify_owner_on_urgent=?,
     notify_manager_remaining=?, auto_generate_tasks=?, verification_role=?, settings_json=?, updated_at=? WHERE id=1`,
    [next.daily_sales_target_override, next.notify_owner_on_report, next.notify_owner_on_urgent,
      next.notify_manager_remaining, next.auto_generate_tasks, next.verification_role, next.settings_json, nowIso()]
  );
  moAudit(actor, 'settings_changed', 'mo_settings', 1, next);
  return getMoSettings();
}

/** Owners/managers always allowed (same Admin/POS password). Other staff only when granted. */
function assertPortalAccess(user) {
  if (!user?.id) throw new Error('Authentication required');
  const role = String(user.role || '').toLowerCase();
  if (role === 'owner' || role === 'manager') return true;
  const allowed = getMoSettings().allowed_user_ids || [];
  if (allowed.includes(Number(user.id))) return true;
  const err = new Error('No Manager Operations access. Ask an owner or manager to grant you access in Admin → Manager Operations → Staff Access.');
  err.code = 'MO_ACCESS_DENIED';
  throw err;
}

function listAccessCandidates() {
  ensureSchema();
  const users = dbAll(`
    SELECT id, username, full_name, role, is_active
    FROM users
    WHERE COALESCE(is_active, 1) = 1
      AND lower(role) IN ('owner','manager','assistant_manager','supervisor','cashier','kitchen','staff','operations')
    ORDER BY
      CASE lower(role)
        WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 WHEN 'assistant_manager' THEN 2
        WHEN 'supervisor' THEN 3 ELSE 4
      END,
      full_name COLLATE NOCASE, username COLLATE NOCASE
  `) || [];
  const allowed = new Set((getMoSettings().allowed_user_ids || []).map(Number));
  return users.map((u) => {
    const role = String(u.role || '').toLowerCase();
    const always = role === 'owner' || role === 'manager';
    return {
      id: u.id,
      username: u.username,
      full_name: u.full_name,
      role: u.role,
      always_allowed: always,
      allowed: always || allowed.has(Number(u.id))
    };
  });
}

function requireAdmin(actor) {
  const r = String(actor?.role || '').toLowerCase();
  if (!['owner', 'manager', 'assistant_manager', 'supervisor'].includes(r)) {
    throw new Error('Admin access required');
  }
}

function requireUser(actor) {
  if (!actor?.id) throw new Error('Authentication required');
  return actor;
}

function parseClock(hhmm, baseDate) {
  const m = String(hhmm || '08:00').match(/^(\d{1,2}):(\d{2})$/);
  const d = new Date(baseDate);
  if (!m) return d;
  d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  return d;
}

function getOpenCloseTimes(workDate) {
  let open = '08:00';
  let close = '18:00';
  try {
    const store = require('./store');
    const oh = store.getOperatingHoursSettings?.() || {};
    if (oh.open_time) open = oh.open_time;
    if (oh.close_time) close = oh.close_time;
    const dayKey = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date(workDate + 'T12:00:00').getDay()];
    const days = oh.days || oh.week || {};
    const day = days[dayKey] || days[workDate] || null;
    if (day && !day.closed) {
      if (day.open) open = day.open;
      if (day.close) close = day.close;
    }
  } catch (_) { /* */ }
  return { open, close };
}

function dueAtForTemplate(tpl, workDate) {
  const { open, close } = getOpenCloseTimes(workDate);
  const anchor = String(tpl.schedule_anchor || 'open');
  const base = parseClock(anchor === 'close' ? close : open, workDate + 'T00:00:00');
  const off = Number(tpl.schedule_offset_minutes);
  if (Number.isFinite(off)) base.setMinutes(base.getMinutes() + off);
  return base.toISOString().slice(0, 19).replace('T', ' ');
}

function generateDailyTasks(workDate, actor, branchId = null) {
  assertModuleEnabled();
  ensureSchema();
  seedDefaults(actor);
  const day = workDate || todayLocal();
  const settings = getMoSettings();
  if (settings.auto_generate_tasks === 0 && !actor) return { created: 0, day };

  const bid = branchId == null || branchId === '' || branchId === 'all' ? null : Number(branchId);
  const existingCount = countTasksForDay(day, bid);

  // Only create templates that are not already present for this day (fill missing)
  let existingTemplateIds = new Set();
  try {
    const rows = bid == null
      ? dbAll('SELECT template_id FROM mo_daily_tasks WHERE work_date = ? AND branch_id IS NULL', [day])
      : dbAll('SELECT template_id FROM mo_daily_tasks WHERE work_date = ? AND branch_id = ?', [day, bid]);
    existingTemplateIds = new Set((rows || []).map((r) => Number(r.template_id)).filter(Boolean));
  } catch (_) { existingTemplateIds = new Set(); }

  const templates = dbAll('SELECT * FROM mo_task_templates WHERE is_active = 1 ORDER BY sort_order, id') || [];
  let created = 0;
  for (const tpl of templates) {
    if (tpl.id && existingTemplateIds.has(Number(tpl.id))) continue;
    const checklist = tpl.code
      ? dbGet('SELECT id FROM mo_checklist_templates WHERE code = ? AND is_active = 1', [tpl.code])
        || dbGet('SELECT id FROM mo_checklist_templates WHERE category = ? AND is_active = 1', [tpl.category])
      : null;
    const due = dueAtForTemplate(tpl, day);
    const assignee = lookupUser(tpl.default_assigned_user_id);
    const manager = lookupUser(tpl.manager_user_id);
    const taskId = dbInsert(
      `INSERT INTO mo_daily_tasks (
        shop_key, branch_id, work_date, template_id, checklist_template_id, title, category,
        assigned_role, assigned_user_id, assigned_user_name, manager_user_id, manager_user_name,
        is_primary, is_required, photo_mode, verification_required, priority, status, due_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'not_started',?)`,
      [
        shopKey(), bid, day, tpl.id || null, checklist?.id || null, tpl.name, tpl.category || 'general',
        tpl.assigned_role || 'assistant_manager',
        assignee?.id || null,
        assignee ? (assignee.full_name || assignee.username) : null,
        manager?.id || null,
        manager ? (manager.full_name || manager.username) : null,
        tpl.is_primary ? 1 : 0, tpl.is_required ? 1 : 0, tpl.photo_mode || 'none',
        tpl.verification_required ? 1 : 0, tpl.priority || 'medium', due
      ]
    );
    if (!taskId) continue;
    if (checklist?.id) {
      const items = dbAll(
        'SELECT * FROM mo_checklist_items WHERE template_id = ? AND is_active = 1 ORDER BY sort_order, id',
        [checklist.id]
      ) || [];
      for (const it of items) {
        dbRun(
          `INSERT INTO mo_checklist_progress (task_id, checklist_item_id, label, is_required, photo_mode, sort_order)
           VALUES (?,?,?,?,?,?)`,
          [taskId, it.id, it.label, it.is_required ? 1 : 0, it.photo_mode || 'none', it.sort_order || 0]
        );
      }
    }
    if (assignee?.id) {
      const task = dbGet('SELECT * FROM mo_daily_tasks WHERE id = ?', [taskId]);
      notifyAssignee(task, assignee, actor, { whatsapp: false });
    }
    created += 1;
  }
  moAudit(actor || { username: 'system' }, 'tasks_generated', 'mo_daily_tasks', day, { created, branchId: bid, existing: existingCount });
  return {
    created,
    day,
    existing: existingCount,
    message: created
      ? `Created ${created} task(s) for ${day}`
      : (existingCount ? `Already have ${existingCount} task(s) for today` : 'No active templates to generate')
  };
}

function ensureTodayTasks(actor, branchId) {
  ensureSchema();
  seedDefaults(actor);
  try {
    return generateDailyTasks(todayLocal(), actor, branchId);
  } catch (e) {
    console.warn('[manager-ops] generateDailyTasks:', e.message || e);
    return { created: 0, day: todayLocal(), error: String(e.message || e) };
  }
}

function markOverdue() {
  ensureSchema();
  const day = todayLocal();
  const now = nowIso();
  const rows = dbAll(
    `SELECT id, title FROM mo_daily_tasks
     WHERE work_date = ? AND is_required = 1
       AND status IN ('not_started','in_progress')
       AND due_at IS NOT NULL AND due_at < ?
       AND overdue_notified = 0`,
    [day, now]
  );
  for (const row of rows) {
    dbRun('UPDATE mo_daily_tasks SET status = CASE WHEN status = ? THEN ? ELSE status END, overdue_notified = 1, updated_at = ? WHERE id = ?',
      ['not_started', 'not_started', now, row.id]);
    notify('mo_task_overdue', 'Task overdue', `⚠️ ${row.title} is overdue`, {
      entity_type: 'mo_daily_task', entity_id: row.id, action_page: 'manager-ops', audience_roles: 'owner,manager,assistant_manager'
    });
  }
  return rows.length;
}

function lookupUser(id) {
  if (id == null || id === '') return null;
  try {
    return dbGet('SELECT id, username, full_name, role FROM users WHERE id = ?', [Number(id)]);
  } catch (_) {
    return null;
  }
}

function employeeIdForUser(userId) {
  if (!userId) return null;
  try {
    return dbGet('SELECT id FROM employees WHERE user_id = ? LIMIT 1', [Number(userId)])?.id || null;
  } catch (_) {
    return null;
  }
}

function pushStaffPortalFeed(userId, title, message, refId) {
  const empId = employeeIdForUser(userId);
  if (!empId) return;
  try {
    dbRun(
      `INSERT INTO employee_portal_feed (employee_id, feed_type, title, message, ref_id, is_read)
       VALUES (?,?,?,?,?,0)`,
      [empId, 'manager_ops_task', title, message, refId != null ? Number(refId) : null]
    );
  } catch (_) { /* portal feed optional */ }
}

function touchEmployeeOfMonth(userId) {
  if (!userId) return;
  try {
    const eom = require('./employee-of-month');
    const my = eom.monthYearFromDate();
    eom.computeEmployeeScores(my);
  } catch (_) { /* EOM optional */ }
}

function getSalesSummary(branchId) {
  const store = require('./store');
  const settings = getMoSettings();
  const prog = store.getTodayTargetProgress?.(branchId === 0 ? null : branchId) || {};
  // Live from Admin Sales Targets — override only when explicitly set in MO settings
  let target = Number(prog.daily_target ?? prog.dailyTarget ?? prog.target ?? 0) || 0;
  const usingOverride = settings.daily_sales_target_override != null
    && Number(settings.daily_sales_target_override) > 0;
  if (usingOverride) target = Number(settings.daily_sales_target_override);
  const sales = Number(prog.sales_achieved ?? prog.todaySales ?? prog.sales ?? prog.amount ?? 0) || 0;
  const remaining = Math.max(0, Number(prog.remaining != null ? prog.remaining : (target - sales)));
  const progress = Number(prog.percentage ?? prog.progress ?? (target > 0 ? Math.min(100, Math.round((sales / target) * 1000) / 10) : 0));
  let orderCount = 0;
  try {
    const day = todayLocal();
    let sql = `SELECT COUNT(*) AS c FROM sales WHERE date(created_at) = date(?) AND status IN ('completed','paid','partial')`;
    const params = [day];
    if (branchId != null && branchId !== '' && branchId !== 'all') {
      sql += ' AND branch_id = ?';
      params.push(Number(branchId));
    }
    orderCount = dbGet(sql, params)?.c || 0;
  } catch (_) { /* */ }
  const products = Array.isArray(prog.products) ? prog.products : [];
  return {
    target,
    sales,
    remaining,
    progress,
    order_count: orderCount,
    currency: (store.getSettingsParsed?.()?.currency) || 'R',
    daily_active: !!prog.daily_active || target > 0,
    product_targets_active: !!prog.product_targets_active,
    product_target_qty: prog.product_target_qty || 0,
    product_sold_qty: prog.product_sold_qty || 0,
    product_target_value: prog.product_target_value || 0,
    product_sold_value: prog.product_sold_value || 0,
    products,
    source: 'admin_sales_targets',
    override_active: usingOverride,
    // read-only from POS — never writable from this module
    read_only: true
  };
}

function enrichTask(row) {
  if (!row) return null;
  const evidence = dbAll('SELECT id, caption, created_at, user_id FROM mo_evidence WHERE task_id = ? ORDER BY id', [row.id]);
  const checklist = dbAll('SELECT * FROM mo_checklist_progress WHERE task_id = ? ORDER BY sort_order, id', [row.id]);
  const now = nowIso();
  const overdue = row.is_required && row.due_at && row.due_at < now
    && !['completed', 'verified'].includes(row.status);
  return {
    ...row,
    evidence,
    checklist,
    overdue: !!overdue,
    photo_required: row.photo_mode === 'required',
    photo_optional: row.photo_mode === 'optional'
  };
}

function listTasks(filters = {}, actor) {
  assertModuleEnabled();
  ensureSchema();
  ensureTodayTasks(actor, filters.branch_id || null);
  markOverdue();
  const day = filters.work_date || todayLocal();
  let sql = 'SELECT * FROM mo_daily_tasks WHERE work_date = ?';
  const params = [day];
  if (filters.branch_id != null && filters.branch_id !== '') {
    sql += ' AND (branch_id = ? OR branch_id IS NULL)';
    params.push(Number(filters.branch_id));
  }
  if (filters.category) {
    sql += ' AND category = ?';
    params.push(filters.category);
  }
  if (filters.status) {
    sql += ' AND status = ?';
    params.push(filters.status);
  }
  sql += ' ORDER BY sort_order IS NULL, id';
  // SQLite has no sort_order on daily tasks — order by id / due_at
  sql = sql.replace('ORDER BY sort_order IS NULL, id', 'ORDER BY due_at, id');

  let rows = dbAll(sql, params);
  if (actor && !canSeeAllShop(actor) && !filters.admin_view) {
    const roles = rolesForUser(actor);
    rows = rows.filter((t) => {
      if (t.assigned_user_id && Number(t.assigned_user_id) === Number(actor.id)) return true;
      if (roles.includes(String(t.assigned_role || '').toLowerCase())) return true;
      if (!t.is_primary) return true; // team support visible
      return false;
    });
  }
  return rows.map(enrichTask);
}

function getTask(id, actor) {
  assertModuleEnabled();
  ensureSchema();
  const row = dbGet('SELECT * FROM mo_daily_tasks WHERE id = ?', [id]);
  if (!row) throw new Error('Task not found');
  if (actor && !canSeeAllShop(actor)) {
    const roles = rolesForUser(actor);
    const ok = (row.assigned_user_id && Number(row.assigned_user_id) === Number(actor.id))
      || roles.includes(String(row.assigned_role || '').toLowerCase())
      || !row.is_primary;
    if (!ok) throw new Error('You do not have access to this task');
  }
  return enrichTask(row);
}

function saveEvidenceFile(dataUrl, meta = {}) {
  const match = String(dataUrl || '').match(/^data:([\w/+.-]+);base64,(.+)$/);
  if (!match) throw new Error('Invalid image data');
  const mime = match[1];
  if (!/^image\//i.test(mime)) throw new Error('Only image evidence is accepted');
  const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
  const dir = assetsDir('manager-ops', todayLocal());
  const filePath = path.join(dir, `ev-${meta.task_id || 0}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`);
  fs.writeFileSync(filePath, Buffer.from(match[2], 'base64'));
  const id = dbInsert(
    `INSERT INTO mo_evidence (shop_key, task_id, incident_id, report_id, user_id, file_path, mime_type, caption, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [shopKey(), meta.task_id || null, meta.incident_id || null, meta.report_id || null,
      meta.user_id || null, filePath, mime, meta.caption || null, nowIso()]
  );
  return { id, file_path: filePath, mime_type: mime };
}

function getEvidenceDataUrl(evidenceId, actor) {
  assertModuleEnabled();
  requireUser(actor);
  const row = dbGet('SELECT * FROM mo_evidence WHERE id = ?', [evidenceId]);
  if (!row) throw new Error('Evidence not found');
  // Never return a public URL — only authenticated data URL
  return {
    id: row.id,
    mime_type: row.mime_type,
    caption: row.caption,
    created_at: row.created_at,
    data_url: fileDataUrl(row.file_path)
  };
}

function startTask(taskId, actor) {
  assertModuleEnabled();
  requireUser(actor);
  const task = getTask(taskId, actor);
  if (['completed', 'verified'].includes(task.status)) return task;
  dbRun(
    `UPDATE mo_daily_tasks SET status='in_progress', started_at=COALESCE(started_at,?), updated_at=? WHERE id=?`,
    [nowIso(), nowIso(), taskId]
  );
  moAudit(actor, 'task_started', 'mo_daily_task', taskId, {});
  return getTask(taskId, actor);
}

function completeChecklistItem(progressId, data, actor) {
  assertModuleEnabled();
  requireUser(actor);
  const item = dbGet('SELECT * FROM mo_checklist_progress WHERE id = ?', [progressId]);
  if (!item) throw new Error('Checklist item not found');
  getTask(item.task_id, actor);
  if (data?.photo_data_url) {
    saveEvidenceFile(data.photo_data_url, { task_id: item.task_id, user_id: actor.id, caption: item.label });
  }
  dbRun(
    `UPDATE mo_checklist_progress SET completed=1, completed_at=?, completed_by=?, notes=COALESCE(?, notes) WHERE id=?`,
    [nowIso(), actor.id, data?.notes || null, progressId]
  );
  startTask(item.task_id, actor);
  return getTask(item.task_id, actor);
}

function completeTask(taskId, data, actor) {
  assertModuleEnabled();
  requireUser(actor);
  const task = getTask(taskId, actor);
  if (task.photo_mode === 'required') {
    const ev = dbGet('SELECT COUNT(*) AS c FROM mo_evidence WHERE task_id = ?', [taskId])?.c || 0;
    if (!ev && !data?.photo_data_url) throw new Error('Photo evidence is required for this task');
  }
  if (data?.photo_data_url) {
    saveEvidenceFile(data.photo_data_url, { task_id: taskId, user_id: actor.id, caption: data.caption || task.title });
  }
  const checklist = dbAll('SELECT * FROM mo_checklist_progress WHERE task_id = ?', [taskId]);
  if (checklist.length) {
    const missing = checklist.filter((c) => c.is_required && !c.completed);
    if (missing.length) throw new Error(`Complete required checklist items first (${missing.length} remaining)`);
  }
  const status = task.verification_required ? 'completed' : 'completed';
  dbRun(
    `UPDATE mo_daily_tasks SET status=?, completed_at=?, completed_by=?, completed_by_name=?, notes=COALESCE(?, notes), updated_at=? WHERE id=?`,
    [status, nowIso(), actor.id, actor.full_name || actor.username, data?.notes || null, nowIso(), taskId]
  );
  if (task.verification_required) {
    // stays completed until verified
  }
  moAudit(actor, 'task_completed', 'mo_daily_task', taskId, { notes: data?.notes });
  touchEmployeeOfMonth(actor.id);
  return getTask(taskId, actor);
}

function verifyTask(taskId, data, actor) {
  assertModuleEnabled();
  requireAdmin(actor);
  const task = getTask(taskId, actor);
  if (data?.reject) {
    dbRun(
      `UPDATE mo_daily_tasks SET status='in_progress', completed_at=NULL, completed_by=NULL, notes=COALESCE(?, notes), updated_at=? WHERE id=?`,
      [data.notes || 'Rejected — please redo', nowIso(), taskId]
    );
    moAudit(actor, 'task_rejected', 'mo_daily_task', taskId, data);
    notify('mo_task_rejected', 'Task needs redo', `${task.title} was rejected by owner/manager`, {
      entity_type: 'mo_daily_task', entity_id: taskId, action_page: 'manager-ops'
    });
    return getTask(taskId, actor);
  }
  dbRun(
    `UPDATE mo_daily_tasks SET status='verified', verified_at=?, verified_by=?, verified_by_name=?, updated_at=? WHERE id=?`,
    [nowIso(), actor.id, actor.full_name || actor.username, nowIso(), taskId]
  );
  moAudit(actor, 'task_verified', 'mo_daily_task', taskId, {});
  return getTask(taskId, actor);
}

function primaryDutiesDone(actor, workDate) {
  const day = workDate || todayLocal();
  const roles = rolesForUser(actor);
  const rows = dbAll(
    `SELECT * FROM mo_daily_tasks WHERE work_date = ? AND is_primary = 1`,
    [day]
  ).filter((t) => roles.includes(String(t.assigned_role || '').toLowerCase())
    || (t.assigned_user_id && Number(t.assigned_user_id) === Number(actor.id)));
  if (!rows.length) return true;
  return rows.every((t) => ['completed', 'verified'].includes(t.status));
}

function listTeamHelp(workDate) {
  ensureSchema();
  const day = workDate || todayLocal();
  return dbAll('SELECT * FROM mo_team_help WHERE work_date = ? ORDER BY id DESC', [day]);
}

function requestHelp(data, actor) {
  assertModuleEnabled();
  requireUser(actor);
  const day = todayLocal();
  const id = dbInsert(
    `INSERT INTO mo_team_help (work_date, requester_user_id, requester_name, requester_role, task_id, need_label, status, notes)
     VALUES (?,?,?,?,?,?, 'needed', ?)`,
    [day, actor.id, actor.full_name || actor.username, mapUserRoleToMoRole(actor.role),
      data?.task_id || null, data?.need_label || 'Needs help', data?.notes || null]
  );
  moAudit(actor, 'help_requested', 'mo_team_help', id, data);
  return dbGet('SELECT * FROM mo_team_help WHERE id = ?', [id]);
}

function offerHelp(helpId, actor) {
  assertModuleEnabled();
  requireUser(actor);
  if (!primaryDutiesDone(actor)) {
    throw new Error('Complete your primary duties first, then you can help the team');
  }
  const row = dbGet('SELECT * FROM mo_team_help WHERE id = ?', [helpId]);
  if (!row) throw new Error('Help request not found');
  dbRun(
    `UPDATE mo_team_help SET helper_user_id=?, helper_name=?, status='helping', helped_at=? WHERE id=?`,
    [actor.id, actor.full_name || actor.username, nowIso(), helpId]
  );
  if (row.task_id) {
    dbRun(
      `UPDATE mo_daily_tasks SET helper_user_id=?, helper_name=?, updated_at=? WHERE id=?`,
      [actor.id, actor.full_name || actor.username, nowIso(), row.task_id]
    );
  }
  moAudit(actor, 'help_offered', 'mo_team_help', helpId, {});
  return dbGet('SELECT * FROM mo_team_help WHERE id = ?', [helpId]);
}

function reportIncident(data, actor) {
  assertModuleEnabled();
  requireUser(actor);
  const category = String(data?.category || 'Other').trim();
  if (!data?.description) throw new Error('Describe the problem');
  const priority = String(data?.priority || 'medium').toLowerCase();
  if (!['low', 'medium', 'high', 'urgent'].includes(priority)) throw new Error('Invalid priority');
  const id = dbInsert(
    `INSERT INTO mo_incidents (
      shop_key, branch_id, work_date, category, description, priority, action_taken,
      requires_owner, status, reported_by, reported_by_name, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?, 'open', ?,?,?,?)`,
    [
      shopKey(), data.branch_id || null, todayLocal(), category, String(data.description).trim(),
      priority, data.action_taken || null, data.requires_owner ? 1 : 0,
      actor.id, actor.full_name || actor.username, nowIso(), nowIso()
    ]
  );
  if (!id) throw new Error('Failed to save incident');
  if (data.photo_data_url) {
    saveEvidenceFile(data.photo_data_url, { incident_id: id, user_id: actor.id, caption: category });
  }
  moAudit(actor, 'problem_reported', 'mo_incident', id, { category, priority });
  const settings = getMoSettings();
  const alertOwner = settings.notify_owner_on_urgent !== 0
    || priority === 'urgent' || priority === 'high' || data.requires_owner;
  // Always alert owners/managers so Admin Incidents inbox stays live
  notify(
    priority === 'urgent' || priority === 'high' ? 'mo_urgent_problem' : 'mo_problem_reported',
    priority === 'urgent' || priority === 'high' ? 'Urgent problem reported' : 'Problem reported',
    `${category}: ${String(data.description).slice(0, 140)}`,
    {
      entity_type: 'mo_incident',
      entity_id: id,
      action_page: 'manager-ops',
      audience_roles: 'owner,manager'
    }
  );
  if (!alertOwner && settings.notify_owner_on_urgent === 0) {
    /* still notified above for inbox — settings only muted “urgent” label historically */
  }
  return dbGet('SELECT * FROM mo_incidents WHERE id = ?', [id]);
}

function resolveIncident(id, data, actor) {
  assertModuleEnabled();
  requireAdmin(actor);
  ensureSchema();
  const row = dbGet('SELECT * FROM mo_incidents WHERE id = ?', [id]);
  if (!row) throw new Error('Incident not found');
  dbRun(
    `UPDATE mo_incidents SET status=?, resolved_at=?, resolved_by=?, resolved_notes=?, owner_seen_at=COALESCE(owner_seen_at, ?), updated_at=? WHERE id=?`,
    [
      data?.status || 'resolved',
      nowIso(),
      actor.id,
      data?.notes || data?.resolved_notes || null,
      nowIso(),
      nowIso(),
      id
    ]
  );
  moAudit(actor, 'incident_resolved', 'mo_incident', id, data || {});
  return dbGet('SELECT * FROM mo_incidents WHERE id = ?', [id]);
}

function markIncidentSeen(id, actor) {
  assertModuleEnabled();
  requireAdmin(actor);
  ensureSchema();
  dbRun(
    `UPDATE mo_incidents SET owner_seen_at=COALESCE(owner_seen_at, ?), updated_at=? WHERE id=?`,
    [nowIso(), nowIso(), id]
  );
  return dbGet('SELECT * FROM mo_incidents WHERE id = ?', [id]);
}

function listIncidents(filters = {}) {
  assertModuleEnabled();
  ensureSchema();
  let sql = 'SELECT * FROM mo_incidents WHERE 1=1';
  const params = [];
  if (filters.work_date) { sql += ' AND work_date = ?'; params.push(filters.work_date); }
  if (filters.status) { sql += ' AND status = ?'; params.push(filters.status); }
  sql += ' ORDER BY id DESC LIMIT ?';
  params.push(Math.min(Number(filters.limit) || 100, 500));
  return dbAll(sql, params).map((row) => ({
    ...row,
    evidence: dbAll('SELECT id, caption, created_at FROM mo_evidence WHERE incident_id = ?', [row.id])
  }));
}

function getAttendanceSnapshot() {
  try {
    const staff = require('./staff');
    const emps = staff.getEmployees?.({ status: 'Active' }) || [];
    return emps.map((e) => {
      let att = null;
      try { att = staff.getTodayAttendance?.(e.id); } catch (_) { /* */ }
      const status = !att ? 'absent'
        : att.clock_in && !att.clock_out ? 'present'
          : att.clock_out ? 'departed'
            : att.status || 'scheduled';
      return {
        employee_id: e.id,
        user_id: e.user_id || null,
        name: e.full_name,
        role: e.role || e.job_title || e.position,
        branch: e.branch || null,
        status,
        clock_in: att?.clock_in || null,
        clock_out: att?.clock_out || null,
        late: !!(att?.late || (att?.clock_in && att?.is_late)),
        source: 'staff_hr'
      };
    });
  } catch (_) {
    return [];
  }
}

function listAssignablePeople() {
  ensureSchema();
  const users = dbAll(`
    SELECT u.id, u.username, u.full_name, u.role,
      (SELECT e.id FROM employees e WHERE e.user_id = u.id LIMIT 1) AS employee_id
    FROM users u
    WHERE COALESCE(u.is_active, 1) = 1
    ORDER BY
      CASE lower(u.role)
        WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 WHEN 'assistant_manager' THEN 2
        WHEN 'supervisor' THEN 3 ELSE 4
      END,
      u.full_name COLLATE NOCASE, u.username COLLATE NOCASE
  `) || [];
  return users.map((u) => ({
    id: u.id,
    username: u.username,
    full_name: u.full_name,
    role: u.role,
    employee_id: u.employee_id || null,
    linked_to_hr: !!u.employee_id
  }));
}

function createDailyTask(data, actor) {
  assertModuleEnabled();
  requireAdmin(actor);
  ensureSchema();
  const title = String(data?.title || '').trim();
  if (!title) throw new Error('Task name is required');
  const day = data?.work_date || todayLocal();
  const assignee = lookupUser(data.assigned_user_id);
  const manager = lookupUser(data.manager_user_id);
  const checklistId = data.checklist_template_id || null;
  const taskId = dbInsert(
    `INSERT INTO mo_daily_tasks (
      shop_key, branch_id, work_date, template_id, checklist_template_id, title, category,
      assigned_role, assigned_user_id, assigned_user_name, manager_user_id, manager_user_name,
      is_primary, is_required, photo_mode, verification_required, priority, status, due_at, notes
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'not_started',?,?)`,
    [
      shopKey(), data.branch_id || null, day, data.template_id || null, checklistId, title,
      data.category || 'general',
      data.assigned_role || assignee?.role || 'assistant_manager',
      assignee?.id || null, assignee?.full_name || assignee?.username || null,
      manager?.id || null, manager?.full_name || manager?.username || null,
      data.is_primary !== false ? 1 : 0, data.is_required !== false ? 1 : 0,
      data.photo_mode || 'none', data.verification_required ? 1 : 0,
      data.priority || 'medium', data.due_at || null, data.notes || null
    ]
  );
  if (checklistId) {
    const items = dbAll(
      'SELECT * FROM mo_checklist_items WHERE template_id = ? AND is_active = 1 ORDER BY sort_order, id',
      [checklistId]
    );
    for (const it of items) {
      dbRun(
        `INSERT INTO mo_checklist_progress (task_id, checklist_item_id, label, is_required, photo_mode, sort_order)
         VALUES (?,?,?,?,?,?)`,
        [taskId, it.id, it.label, it.is_required ? 1 : 0, it.photo_mode || 'none', it.sort_order || 0]
      );
    }
  }
  if (assignee?.id) {
    const created = dbGet('SELECT * FROM mo_daily_tasks WHERE id = ?', [taskId]);
    notifyAssignee(created, assignee, actor, {
      whatsapp: data.notify_whatsapp !== false,
      title: 'New Manager Ops task',
      message: `${title} assigned for ${day}`
    });
  }
  moAudit(actor, 'task_created', 'mo_daily_task', taskId, data);
  return getTask(taskId, actor);
}

function assignDailyTask(taskId, data, actor) {
  assertModuleEnabled();
  requireAdmin(actor);
  ensureSchema();
  const task = dbGet('SELECT * FROM mo_daily_tasks WHERE id = ?', [taskId]);
  if (!task) throw new Error('Task not found');
  const assignee = data.assigned_user_id != null && data.assigned_user_id !== ''
    ? lookupUser(data.assigned_user_id) : null;
  const manager = data.manager_user_id != null && data.manager_user_id !== ''
    ? lookupUser(data.manager_user_id) : null;
  const clearAssignee = data.assigned_user_id === null || data.assigned_user_id === '';
  const clearManager = data.manager_user_id === null || data.manager_user_id === '';
  dbRun(
    `UPDATE mo_daily_tasks SET
      assigned_user_id=?, assigned_user_name=?, manager_user_id=?, manager_user_name=?,
      assigned_role=COALESCE(?, assigned_role), updated_at=?
     WHERE id=?`,
    [
      assignee ? assignee.id : (clearAssignee ? null : task.assigned_user_id),
      assignee ? (assignee.full_name || assignee.username) : (clearAssignee ? null : task.assigned_user_name),
      manager ? manager.id : (clearManager ? null : task.manager_user_id),
      manager ? (manager.full_name || manager.username) : (clearManager ? null : task.manager_user_name),
      data.assigned_role || (assignee?.role) || null,
      nowIso(),
      taskId
    ]
  );
  const updated = getTask(taskId, actor);
  if (assignee?.id) {
    notifyAssignee(updated, assignee, actor, {
      whatsapp: data.notify_whatsapp !== false,
      title: 'New daily task assigned',
      message: `${task.title} was assigned to you. Open Manager Operations or Staff Portal to complete it.`
    });
  }
  moAudit(actor, 'task_assigned', 'mo_daily_task', taskId, data);
  return updated;
}

/** Assign many tasks to one person in one call (fast Assign Staff board). */
function assignManyTasks(data, actor) {
  assertModuleEnabled();
  requireAdmin(actor);
  ensureSchema();
  const ids = (data.task_ids || []).map(Number).filter((id) => Number.isFinite(id) && id > 0);
  if (!ids.length) throw new Error('Select at least one task');
  const userId = data.assigned_user_id;
  if (userId == null || userId === '') throw new Error('Select a staff member');
  const assignee = lookupUser(userId);
  if (!assignee) throw new Error('Staff member not found');
  const manager = data.manager_user_id != null && data.manager_user_id !== ''
    ? lookupUser(data.manager_user_id) : null;
  const titles = [];
  for (const id of ids) {
    const task = dbGet('SELECT * FROM mo_daily_tasks WHERE id = ?', [id]);
    if (!task) continue;
    dbRun(
      `UPDATE mo_daily_tasks SET
        assigned_user_id=?, assigned_user_name=?, manager_user_id=COALESCE(?, manager_user_id),
        manager_user_name=COALESCE(?, manager_user_name),
        assigned_role=COALESCE(?, assigned_role), updated_at=?
       WHERE id=?`,
      [
        assignee.id,
        assignee.full_name || assignee.username,
        manager?.id || null,
        manager ? (manager.full_name || manager.username) : null,
        data.assigned_role || assignee.role || null,
        nowIso(),
        id
      ]
    );
    titles.push(task.title);
    moAudit(actor, 'task_assigned', 'mo_daily_task', id, { assigned_user_id: assignee.id, batch: true });
  }
  const sample = dbGet('SELECT * FROM mo_daily_tasks WHERE id = ?', [ids[0]]);
  if (sample) {
    notifyAssignee(sample, assignee, actor, {
      whatsapp: data.notify_whatsapp !== false,
      title: titles.length > 1 ? `${titles.length} tasks assigned` : 'New daily task assigned',
      message: titles.length > 1
        ? `You have ${titles.length} tasks today:\n• ${titles.slice(0, 8).join('\n• ')}${titles.length > 8 ? '\n…' : ''}\n\nOpen Manager Ops or Staff Portal.`
        : `${titles[0]} was assigned to you. Open Manager Operations or Staff Portal to complete it.`
    });
  }
  return {
    assigned: titles.length,
    user: { id: assignee.id, full_name: assignee.full_name, username: assignee.username },
    titles
  };
}

/** Admin marks a staff task complete (optionally on their behalf) — photo required when task needs evidence. */
function adminCompleteTask(taskId, data, actor) {
  assertModuleEnabled();
  requireAdmin(actor);
  ensureSchema();
  const task = getTask(taskId, actor);
  if (!task) throw new Error('Task not found');
  const needsPhoto = task.photo_mode === 'required' || data?.require_photo;
  if (needsPhoto && !data?.photo_data_url) {
    const err = new Error('Photo evidence is required to mark this task complete');
    err.code = 'PHOTO_REQUIRED';
    throw err;
  }
  if (data?.photo_data_url) {
    saveEvidenceFile(data.photo_data_url, {
      task_id: taskId,
      user_id: actor.id,
      caption: data.caption || `Completed by admin for ${task.assigned_user_name || 'staff'}`
    });
  }
  const checklist = dbAll('SELECT * FROM mo_checklist_progress WHERE task_id = ?', [taskId]) || [];
  for (const c of checklist) {
    if (!c.completed) {
      dbRun(
        `UPDATE mo_checklist_progress SET completed=1, completed_at=?, completed_by=?, notes=? WHERE id=?`,
        [nowIso(), actor.id, data?.notes || 'Completed by admin', c.id]
      );
    }
  }
  dbRun(
    `UPDATE mo_daily_tasks SET status='completed', completed_at=?, completed_by=?, completed_by_name=?, notes=COALESCE(?, notes), updated_at=? WHERE id=?`,
    [
      nowIso(),
      actor.id,
      `${actor.full_name || actor.username} (admin)`,
      data?.notes || null,
      nowIso(),
      taskId
    ]
  );
  moAudit(actor, 'task_admin_completed', 'mo_daily_task', taskId, {
    for_user: task.assigned_user_id,
    photo: !!data?.photo_data_url
  });
  touchEmployeeOfMonth(task.assigned_user_id || actor.id);
  return getTask(taskId, actor);
}

function ownerDashboard(workDate, branchId) {
  assertModuleEnabled();
  ensureSchema();
  try {
    ensureTodayTasks({ role: 'owner', id: 0, username: 'system' }, branchId);
  } catch (e) {
    console.warn('[manager-ops] ensureTodayTasks:', e.message || e);
  }
  const day = workDate || todayLocal();
  let sales = { target: 0, sales: 0, remaining: 0, progress: 0, order_count: 0, currency: 'R', read_only: true };
  try {
    sales = getSalesSummary(branchId);
  } catch (e) {
    console.warn('[manager-ops] getSalesSummary:', e.message || e);
  }
  const tasks = dbAll('SELECT * FROM mo_daily_tasks WHERE work_date = ?', [day]) || [];
  const byCat = {};
  for (const t of tasks) {
    const c = t.category || 'general';
    if (!byCat[c]) byCat[c] = { total: 0, completed: 0 };
    byCat[c].total += 1;
    if (['completed', 'verified'].includes(t.status)) byCat[c].completed += 1;
  }
  let incidents = [];
  try {
    incidents = dbAll('SELECT * FROM mo_incidents WHERE work_date = ?', [day]) || [];
  } catch (_) { incidents = []; }
  let photos = 0;
  try {
    photos = dbGet(
      `SELECT COUNT(*) AS c FROM mo_evidence e
       LEFT JOIN mo_daily_tasks t ON t.id = e.task_id
       WHERE date(e.created_at) = date(?) OR t.work_date = ?`,
      [day, day]
    )?.c || 0;
  } catch (_) { photos = 0; }
  const outstanding = tasks.filter((t) => !['completed', 'verified'].includes(t.status)).length;
  let report = null;
  try {
    report = dbGet('SELECT * FROM mo_daily_reports WHERE work_date = ? ORDER BY id DESC LIMIT 1', [day]);
  } catch (_) { report = null; }
  return {
    work_date: day,
    sales,
    tasks: {
      total: tasks.length,
      completed: tasks.filter((t) => ['completed', 'verified'].includes(t.status)).length,
      overdue: tasks.filter((t) => t.overdue_notified || (t.due_at && t.due_at < nowIso() && !['completed', 'verified'].includes(t.status))).length,
      by_category: byCat
    },
    incidents: {
      total: incidents.length,
      complaints: incidents.filter((i) => /complaint/i.test(i.category)).length,
      urgent: incidents.filter((i) => i.priority === 'urgent' || i.requires_owner).length
    },
    photos,
    outstanding,
    report,
    attendance: getAttendanceSnapshot()
  };
}

function mobileHome(actor, branchId) {
  assertModuleEnabled();
  requireUser(actor);
  ensureTodayTasks(actor, branchId);
  markOverdue();
  const tasks = listTasks({ branch_id: branchId }, actor);
  const primary = tasks.filter((t) => t.is_primary);
  const team = tasks.filter((t) => !t.is_primary);
  const remaining = primary.filter((t) => !['completed', 'verified'].includes(t.status));
  const completed = primary.filter((t) => ['completed', 'verified'].includes(t.status));
  const help = listTeamHelp();
  const messages = dbAll(
    `SELECT * FROM mo_owner_messages WHERE (to_user_id = ? OR to_user_id IS NULL) AND acknowledged = 0 ORDER BY id DESC LIMIT 20`,
    [actor.id]
  );
  const settings = getMoSettings();
  if (settings.notify_manager_remaining && remaining.length && MANAGER_ROLES.has(String(actor.role || '').toLowerCase())) {
    // soft reminder only when loading home — avoid spam via existing notification dedupe
    notify('mo_tasks_remaining', 'Tasks remaining', `You have ${remaining.length} tasks remaining.`, {
      entity_type: 'mo_daily_tasks', entity_id: todayLocal(), action_page: 'manager-ops',
      audience_roles: 'manager,assistant_manager'
    });
  }
  return {
    work_date: todayLocal(),
    sales: getSalesSummary(branchId),
    my_primary: primary,
    team_tasks: team,
    counts: { remaining: remaining.length, completed: completed.length, total: primary.length },
    primary_duties_done: primaryDutiesDone(actor),
    team_help: help,
    owner_messages: messages,
    categories: [...new Set(tasks.map((t) => t.category))],
    attendance: canSeeAllShop(actor) ? getAttendanceSnapshot() : [],
    shop_name: (() => {
      try { return require('./store').getSettingsParsed?.()?.shop_name || 'Shop'; } catch (_) { return 'Shop'; }
    })()
  };
}

function submitDailyReport(data, actor) {
  assertModuleEnabled();
  requireUser(actor);
  if (!MANAGER_ROLES.has(String(actor.role || '').toLowerCase()) && mapUserRoleToMoRole(actor.role) !== 'assistant_manager') {
    throw new Error('Only managers can submit the daily report');
  }
  const day = data?.work_date || todayLocal();
  const branchId = data?.branch_id ?? null;
  const dash = ownerDashboard(day, branchId);
  const sales = dash.sales;
  const tasks = dbAll('SELECT * FROM mo_daily_tasks WHERE work_date = ?', [day]);
  const marketing = tasks.filter((t) => t.category === 'marketing');
  const kitchen = tasks.filter((t) => t.category === 'kitchen');
  const closing = tasks.filter((t) => t.category === 'closing');
  const incidents = dbAll('SELECT * FROM mo_incidents WHERE work_date = ?', [day]);
  const photos = dash.photos;
  const payload = {
    shop_name: dash.shop_name || (() => {
      try { return require('./store').getSettingsParsed?.()?.shop_name; } catch (_) { return null; }
    })(),
    work_date: day,
    sales,
    tasks: dash.tasks,
    incidents: dash.incidents,
    manager_comments: data?.manager_comments || '',
    submitted_by: actor.full_name || actor.username
  };
  const existing = findReportForDay(day, branchId);
  let id;
  const fields = [
    shopKey(), branchId, day, actor.id, actor.full_name || actor.username,
    sales.sales, sales.target, sales.progress >= 100 ? 1 : 0, sales.order_count,
    tasks.length, tasks.filter((t) => ['completed', 'verified'].includes(t.status)).length,
    marketing.length, marketing.filter((t) => ['completed', 'verified'].includes(t.status)).length,
    incidents.length,
    incidents.filter((i) => /complaint/i.test(i.category)).length,
    incidents.filter((i) => /stock/i.test(i.category)).length,
    photos, dash.outstanding,
    kitchen.length && kitchen.every((t) => ['completed', 'verified'].includes(t.status)) ? 'Completed' : 'In progress',
    closing.length && closing.every((t) => ['completed', 'verified'].includes(t.status)) ? 'Completed' : 'In progress',
    data?.manager_comments || null, JSON.stringify(payload), 'submitted', nowIso()
  ];
  if (existing) {
    dbRun(
      `UPDATE mo_daily_reports SET submitted_by=?, submitted_by_name=?, sales_amount=?, sales_target=?, target_achieved=?,
       order_count=?, tasks_total=?, tasks_completed=?, marketing_total=?, marketing_completed=?,
       incidents_count=?, complaints_count=?, stock_problems=?, photos_count=?, outstanding_count=?,
       kitchen_status=?, closing_status=?, manager_comments=?, report_json=?, status='submitted', submitted_at=?
       WHERE id=?`,
      [fields[3], fields[4], fields[5], fields[6], fields[7], fields[8], fields[9], fields[10],
        fields[11], fields[12], fields[13], fields[14], fields[15], fields[16], fields[17],
        fields[18], fields[19], fields[20], fields[21], fields[22], existing.id]
    );
    id = existing.id;
  } else {
    id = dbInsert(
      `INSERT INTO mo_daily_reports (
        shop_key, branch_id, work_date, submitted_by, submitted_by_name, sales_amount, sales_target,
        target_achieved, order_count, tasks_total, tasks_completed, marketing_total, marketing_completed,
        incidents_count, complaints_count, stock_problems, photos_count, outstanding_count,
        kitchen_status, closing_status, manager_comments, report_json, status, submitted_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      fields
    );
  }
  moAudit(actor, 'report_submitted', 'mo_daily_report', id, { work_date: day });
  const settings = getMoSettings();
  if (settings.notify_owner_on_report) {
    notify('mo_daily_report', 'Daily report submitted', `Daily Manager Report for ${day} was submitted by ${actor.full_name || actor.username}`, {
      entity_type: 'mo_daily_report', entity_id: id, action_page: 'manager-ops', audience_roles: 'owner,manager'
    });
  }
  // Bridge to communication center if available (email/WhatsApp) without exposing secrets
  try {
    const cc = require('./communication-center');
    if (typeof cc.enqueueSystemMessage === 'function') {
      cc.enqueueSystemMessage({
        channel: 'auto',
        subject: `Daily Manager Report — ${day}`,
        body: `Sales: ${sales.currency || 'R'}${sales.sales} / ${sales.currency || 'R'}${sales.target}\nTasks: ${payload.tasks.completed}/${payload.tasks.total}\nProblems: ${incidents.length}`,
        tags: ['manager_operations', 'daily_report']
      });
    }
  } catch (_) { /* optional */ }
  return getReport(id, actor);
}

function getReport(id, actor) {
  assertModuleEnabled();
  const row = dbGet('SELECT * FROM mo_daily_reports WHERE id = ?', [id]);
  if (!row) throw new Error('Report not found');
  if (canSeeAllShop(actor) || String(actor?.role).toLowerCase() === 'owner') {
    if (!row.owner_viewed_at && ['owner', 'manager'].includes(String(actor?.role || '').toLowerCase())) {
      dbRun('UPDATE mo_daily_reports SET owner_viewed_at = ? WHERE id = ?', [nowIso(), id]);
      moAudit(actor, 'report_viewed', 'mo_daily_report', id, {});
    }
  }
  const messages = dbAll('SELECT * FROM mo_owner_messages WHERE report_id = ? ORDER BY id', [id]);
  const evidence = dbAll(
    `SELECT id, caption, created_at, task_id, incident_id FROM mo_evidence
     WHERE report_id = ? OR task_id IN (SELECT id FROM mo_daily_tasks WHERE work_date = ?)
        OR incident_id IN (SELECT id FROM mo_incidents WHERE work_date = ?)`,
    [id, row.work_date, row.work_date]
  );
  return { ...row, report: parseJson(row.report_json, {}), messages, evidence };
}

function listReports(filters = {}) {
  assertModuleEnabled();
  ensureSchema();
  let sql = 'SELECT * FROM mo_daily_reports WHERE 1=1';
  const params = [];
  if (filters.from) { sql += ' AND work_date >= ?'; params.push(filters.from); }
  if (filters.to) { sql += ' AND work_date <= ?'; params.push(filters.to); }
  sql += ' ORDER BY work_date DESC, id DESC LIMIT ?';
  params.push(Math.min(Number(filters.limit) || 60, 200));
  return dbAll(sql, params);
}

function ownerRespond(reportId, message, actor) {
  assertModuleEnabled();
  requireAdmin(actor);
  if (!message || !String(message).trim()) throw new Error('Enter a message');
  const report = dbGet('SELECT * FROM mo_daily_reports WHERE id = ?', [reportId]);
  if (!report) throw new Error('Report not found');
  const id = dbInsert(
    `INSERT INTO mo_owner_messages (report_id, work_date, from_user_id, from_name, to_user_id, message, created_at)
     VALUES (?,?,?,?,?,?,?)`,
    [reportId, report.work_date, actor.id, actor.full_name || actor.username, report.submitted_by, String(message).trim(), nowIso()]
  );
  moAudit(actor, 'owner_response', 'mo_owner_message', id, { report_id: reportId });
  notify('mo_owner_message', 'Owner has sent you a message', String(message).slice(0, 140), {
    entity_type: 'mo_owner_message', entity_id: id, action_page: 'manager-ops',
    audience_roles: 'manager,assistant_manager'
  });
  return dbGet('SELECT * FROM mo_owner_messages WHERE id = ?', [id]);
}

function acknowledgeOwnerMessage(messageId, actor) {
  assertModuleEnabled();
  requireUser(actor);
  dbRun(
    `UPDATE mo_owner_messages SET acknowledged=1, acknowledged_at=? WHERE id=?`,
    [nowIso(), messageId]
  );
  moAudit(actor, 'owner_message_ack', 'mo_owner_message', messageId, {});
  return dbGet('SELECT * FROM mo_owner_messages WHERE id = ?', [messageId]);
}

/* —— Templates / checklists admin —— */

function listTaskTemplates() {
  ensureSchema();
  seedDefaults();
  return dbAll('SELECT * FROM mo_task_templates ORDER BY sort_order, id');
}

function saveTaskTemplate(data, actor) {
  assertModuleEnabled();
  requireAdmin(actor);
  ensureSchema();
  const defaultAssignee = data.default_assigned_user_id != null ? Number(data.default_assigned_user_id) : null;
  const managerId = data.manager_user_id != null ? Number(data.manager_user_id) : null;
  if (data.id) {
    dbRun(
      `UPDATE mo_task_templates SET name=?, category=?, description=?, assigned_role=?, is_primary=?, is_required=?,
       photo_mode=?, verification_required=?, priority=?, sort_order=?, schedule_offset_minutes=?, schedule_anchor=?,
       recurrence=?, is_active=?, default_assigned_user_id=?, manager_user_id=?, updated_at=? WHERE id=?`,
      [
        data.name, data.category || 'general', data.description || null, data.assigned_role || 'assistant_manager',
        data.is_primary ? 1 : 0, data.is_required !== false ? 1 : 0, data.photo_mode || 'none',
        data.verification_required ? 1 : 0, data.priority || 'medium', data.sort_order || 0,
        data.schedule_offset_minutes != null ? data.schedule_offset_minutes : null,
        data.schedule_anchor || 'open', data.recurrence || 'daily', data.is_active !== false ? 1 : 0,
        defaultAssignee, managerId,
        nowIso(), data.id
      ]
    );
    moAudit(actor, 'template_changed', 'mo_task_template', data.id, data);
    return dbGet('SELECT * FROM mo_task_templates WHERE id = ?', [data.id]);
  }
  const id = dbInsert(
    `INSERT INTO mo_task_templates (
      code, name, category, description, assigned_role, is_primary, is_required, photo_mode,
      verification_required, priority, sort_order, schedule_offset_minutes, schedule_anchor, recurrence, is_active,
      default_assigned_user_id, manager_user_id
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
    [
      data.code || null, data.name, data.category || 'general', data.description || null,
      data.assigned_role || 'assistant_manager', data.is_primary !== false ? 1 : 0,
      data.is_required !== false ? 1 : 0, data.photo_mode || 'none', data.verification_required ? 1 : 0,
      data.priority || 'medium', data.sort_order || 0,
      data.schedule_offset_minutes != null ? data.schedule_offset_minutes : null,
      data.schedule_anchor || 'open', data.recurrence || 'daily',
      defaultAssignee, managerId
    ]
  );
  moAudit(actor, 'template_created', 'mo_task_template', id, data);
  return dbGet('SELECT * FROM mo_task_templates WHERE id = ?', [id]);
}

function listChecklistTemplates() {
  ensureSchema();
  seedDefaults();
  return dbAll('SELECT * FROM mo_checklist_templates ORDER BY sort_order, id').map((t) => ({
    ...t,
    items: dbAll('SELECT * FROM mo_checklist_items WHERE template_id = ? ORDER BY sort_order, id', [t.id])
  }));
}

function saveChecklistTemplate(data, actor) {
  assertModuleEnabled();
  requireAdmin(actor);
  ensureSchema();
  let id = data.id != null && data.id !== '' ? Number(data.id) : null;
  if (id && !Number.isFinite(id)) id = null;
  if (id) {
    const existing = dbGet('SELECT id FROM mo_checklist_templates WHERE id = ?', [id]);
    if (!existing) throw new Error('Checklist not found');
    dbRun(
      `UPDATE mo_checklist_templates SET name=?, category=?, assigned_role=?, description=?, is_active=?, sort_order=?, updated_at=? WHERE id=?`,
      [data.name, data.category || 'general', data.assigned_role || 'assistant_manager', data.description || null,
        data.is_active !== false ? 1 : 0, data.sort_order || 0, nowIso(), id]
    );
  } else {
    id = dbInsert(
      `INSERT INTO mo_checklist_templates (code, name, category, assigned_role, description, sort_order, is_active)
       VALUES (?,?,?,?,?,?,1)`,
      [data.code || null, data.name, data.category || 'general', data.assigned_role || 'assistant_manager',
        data.description || null, data.sort_order || 0]
    );
  }
  if (Array.isArray(data.items)) {
    dbRun('DELETE FROM mo_checklist_items WHERE template_id = ?', [id]);
    data.items.forEach((it, i) => {
      const label = typeof it === 'string' ? it : it.label;
      if (!label) return;
      dbRun(
        `INSERT INTO mo_checklist_items (template_id, label, is_required, photo_mode, sort_order, is_active)
         VALUES (?,?,?,?,?,1)`,
        [id, label, (typeof it === 'object' && it.is_required === false) ? 0 : 1,
          (typeof it === 'object' && it.photo_mode) || 'none', typeof it === 'object' ? (it.sort_order ?? i) : i]
      );
    });
  }
  moAudit(actor, 'checklist_changed', 'mo_checklist_template', id, { name: data.name });
  return listChecklistTemplates().find((t) => Number(t.id) === Number(id));
}

function deleteChecklistTemplate(id, actor) {
  assertModuleEnabled();
  requireAdmin(actor);
  ensureSchema();
  const tid = Number(id);
  if (!Number.isFinite(tid) || tid <= 0) throw new Error('Checklist not found');
  const row = dbGet('SELECT * FROM mo_checklist_templates WHERE id = ?', [tid]);
  if (!row) throw new Error('Checklist not found');
  dbRun('DELETE FROM mo_checklist_items WHERE template_id = ?', [tid]);
  dbRun('DELETE FROM mo_checklist_templates WHERE id = ?', [tid]);
  moAudit(actor, 'checklist_deleted', 'mo_checklist_template', tid, { name: row.name });
  return { ok: true, id: tid, name: row.name };
}

/* —— Portal sessions (mobile) —— */

function portalLogin(username, password, device = {}) {
  ensureSchema();
  assertModuleEnabled();
  seedDefaults();
  const user = dbGet('SELECT * FROM users WHERE lower(username) = lower(?)', [String(username || '').trim()]);
  if (!user) throw new Error('Invalid username or password');
  if (user.is_active === false || user.is_active === 0) throw new Error('Account deactivated');
  if (!bcrypt.compareSync(String(password || ''), user.password_hash || '')) {
    throw new Error('Invalid username or password');
  }
  // Same password as Admin / POS — then check who the admin has granted
  assertPortalAccess(user);
  const token = newToken();
  dbRun(
    `INSERT INTO mo_sessions (user_id, token_hash, device_label, expires_at) VALUES (?,?,?,?)`,
    [user.id, hashToken(token), device.label || device.userAgent || null, nowPlusDays(14)]
  );
  try { ensureTodayTasks(user, null); } catch (e) {
    console.warn('[manager-ops] ensureTodayTasks:', e.message || e);
  }
  return {
    token,
    user: { id: user.id, username: user.username, full_name: user.full_name, role: user.role }
  };
}

function portalLogout(token) {
  ensureSchema();
  if (!token) return { ok: true };
  dbRun('DELETE FROM mo_sessions WHERE token_hash = ?', [hashToken(token)]);
  return { ok: true };
}

function resolvePortalSession(token) {
  ensureSchema();
  if (!token) throw new Error('Not authenticated');
  const row = dbGet(`
    SELECT s.id AS session_id, s.expires_at, u.*
    FROM mo_sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `, [hashToken(token), nowIso()]);
  if (!row) throw new Error('Session expired — please sign in again');
  assertModuleEnabled();
  assertPortalAccess(row);
  return row;
}

function listAudit(filters = {}) {
  ensureSchema();
  let sql = 'SELECT * FROM mo_audit WHERE 1=1';
  const params = [];
  if (filters.action) { sql += ' AND action = ?'; params.push(filters.action); }
  sql += ' ORDER BY id DESC LIMIT ?';
  params.push(Math.min(Number(filters.limit) || 100, 500));
  return dbAll(sql, params);
}

function getReportPrintPayload(reportId, actor) {
  assertModuleEnabled();
  ensureSchema();
  const report = getReport(reportId, actor);
  if (!report) throw new Error('Report not found');
  const day = report.work_date;
  const sales = getSalesSummary(report.branch_id);
  const tasks = dbAll('SELECT * FROM mo_daily_tasks WHERE work_date = ? ORDER BY due_at, id', [day]) || [];
  const incidents = listIncidents({ work_date: day, limit: 200 });
  const attendance = getAttendanceSnapshot();
  let shop = {};
  try { shop = require('./store').getSettingsParsed?.() || {}; } catch (_) { /* */ }
  return {
    shop_name: shop.shop_name || report.shop_name || 'Shop',
    address: shop.address || '',
    phone: shop.phone || '',
    currency: shop.currency || sales.currency || 'R',
    work_date: day,
    submitted_by: report.submitted_by_name,
    submitted_at: report.submitted_at,
    manager_comments: report.manager_comments || '',
    sales,
    tasks: tasks.map((t) => ({
      title: t.title,
      category: t.category,
      assigned_to: t.assigned_user_name || t.assigned_role,
      manager: t.manager_user_name || '',
      status: t.status,
      due_at: t.due_at
    })),
    incidents: incidents.map((i) => ({
      category: i.category,
      priority: i.priority,
      description: i.description,
      status: i.status,
      reported_by: i.reported_by_name
    })),
    attendance,
    summary: {
      tasks_total: report.tasks_total,
      tasks_completed: report.tasks_completed,
      incidents_count: report.incidents_count,
      photos_count: report.photos_count,
      outstanding_count: report.outstanding_count
    }
  };
}

function buildDailyReportPdf(reportId, actor) {
  const payload = getReportPrintPayload(reportId, actor);
  const { jsPDF } = require('jspdf');
  require('jspdf-autotable');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const cur = payload.currency || 'R';
  const money = (n) => `${cur}${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  let y = 16;
  doc.setFontSize(16);
  doc.setFont(undefined, 'bold');
  doc.text(payload.shop_name || 'Shop', 105, y, { align: 'center' });
  y += 7;
  doc.setFontSize(11);
  doc.text('Manager Operations — Daily Report', 105, y, { align: 'center' });
  y += 6;
  doc.setFontSize(9);
  doc.setFont(undefined, 'normal');
  doc.text(`Date: ${payload.work_date}  ·  Submitted by: ${payload.submitted_by || '—'}`, 105, y, { align: 'center' });
  y += 8;
  doc.setDrawColor(180);
  doc.line(14, y, 196, y);
  y += 8;

  doc.setFont(undefined, 'bold');
  doc.setFontSize(11);
  doc.text('Sales (live from POS + Admin Sales Targets)', 14, y);
  y += 6;
  doc.setFont(undefined, 'normal');
  doc.setFontSize(9);
  const s = payload.sales || {};
  doc.text(`Target: ${money(s.target)}   Sales: ${money(s.sales)}   Progress: ${s.progress || 0}%   Orders: ${s.order_count || 0}`, 14, y);
  y += 5;
  if (s.products && s.products.length) {
    doc.autoTable({
      startY: y,
      head: [['Product target', 'Target qty', 'Sold', 'Remaining']],
      body: s.products.slice(0, 20).map((p) => [
        p.name || p.product_name || `#${p.product_id}`,
        String(p.target_qty || 0),
        String(p.sold_qty || 0),
        String(p.remaining_qty || 0)
      ]),
      styles: { fontSize: 8 },
      margin: { left: 14, right: 14 }
    });
    y = doc.lastAutoTable.finalY + 8;
  } else {
    y += 4;
  }

  doc.setFont(undefined, 'bold');
  doc.setFontSize(11);
  doc.text('Daily tasks', 14, y);
  y += 2;
  doc.autoTable({
    startY: y + 2,
    head: [['Task', 'Category', 'Assigned', 'Manager', 'Status']],
    body: (payload.tasks || []).map((t) => [t.title, t.category, t.assigned_to || '—', t.manager || '—', t.status]),
    styles: { fontSize: 8 },
    margin: { left: 14, right: 14 }
  });
  y = doc.lastAutoTable.finalY + 8;

  doc.setFont(undefined, 'bold');
  doc.setFontSize(11);
  doc.text('Incidents / problems', 14, y);
  y += 2;
  doc.autoTable({
    startY: y + 2,
    head: [['Category', 'Priority', 'By', 'Status', 'Description']],
    body: (payload.incidents || []).length
      ? payload.incidents.map((i) => [i.category, i.priority, i.reported_by || '—', i.status, String(i.description || '').slice(0, 80)])
      : [['—', '—', '—', '—', 'None']],
    styles: { fontSize: 8 },
    margin: { left: 14, right: 14 }
  });
  y = doc.lastAutoTable.finalY + 8;

  doc.setFont(undefined, 'bold');
  doc.setFontSize(11);
  doc.text('Attendance (Staff HR)', 14, y);
  y += 2;
  doc.autoTable({
    startY: y + 2,
    head: [['Name', 'Role', 'Status', 'In', 'Out']],
    body: (payload.attendance || []).map((a) => [a.name, a.role || '—', a.status, a.clock_in || '—', a.clock_out || '—']),
    styles: { fontSize: 8 },
    margin: { left: 14, right: 14 }
  });
  y = doc.lastAutoTable.finalY + 10;

  if (payload.manager_comments) {
    doc.setFont(undefined, 'bold');
    doc.text('Manager comments', 14, y);
    y += 5;
    doc.setFont(undefined, 'normal');
    const lines = doc.splitTextToSize(payload.manager_comments, 180);
    doc.text(lines, 14, y);
    y += lines.length * 4 + 6;
  }

  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text(`Generated ${new Date().toLocaleString()} · Manager Operations linked to POS, Sales Targets, Staff HR`, 14, 285);
  const buf = Buffer.from(doc.output('arraybuffer'));
  return {
    filename: `manager-ops-report-${payload.work_date}.pdf`,
    mime: 'application/pdf',
    base64: buf.toString('base64'),
    payload
  };
}

module.exports = {
  MODULE_ID,
  INCIDENT_CATEGORIES,
  ensureSchema,
  seedDefaults,
  assertModuleEnabled,
  getSettings: getMoSettings,
  saveSettings: saveMoSettings,
  getMoSettings,
  saveMoSettings,
  generateDailyTasks,
  ensureTodayTasks,
  markOverdue,
  getSalesSummary,
  listTasks,
  getTask,
  startTask,
  completeChecklistItem,
  completeTask,
  verifyTask,
  saveEvidenceFile,
  getEvidenceDataUrl,
  primaryDutiesDone,
  listTeamHelp,
  requestHelp,
  offerHelp,
  reportIncident,
  listIncidents,
  resolveIncident,
  markIncidentSeen,
  getAttendanceSnapshot,
  ownerDashboard,
  mobileHome,
  submitDailyReport,
  getReport,
  listReports,
  ownerRespond,
  acknowledgeOwnerMessage,
  listTaskTemplates,
  saveTaskTemplate,
  listChecklistTemplates,
  saveChecklistTemplate,
  deleteChecklistTemplate,
  createDailyTask,
  assignDailyTask,
  assignManyTasks,
  adminCompleteTask,
  listAssignablePeople,
  listTaskNotifications,
  getReportPrintPayload,
  buildDailyReportPdf,
  portalLogin,
  portalLogout,
  resolvePortalSession,
  assertPortalAccess,
  listAccessCandidates,
  listAudit
};

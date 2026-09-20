/**
 * Referral & Commission — new department (v109+)
 * Permanent customer→agent attribution; commission on every qualifying sale.
 */
const bcrypt = require('bcryptjs');
const { getDb } = require('../database/db');

function db() { return getDb(); }
function dbAll(sql, p = []) { return db().prepare(sql).all(...p); }
function dbGet(sql, p = []) { return db().prepare(sql).get(...p); }
function dbRun(sql, p = []) { return db().prepare(sql).run(...p); }

function now() { return new Date().toISOString().replace('T', ' ').slice(0, 19); }
function num(v, d = 0) { const n = Number(v); return Number.isFinite(n) ? n : d; }
function money(v) { return Math.round(num(v) * 100) / 100; }
function text(v) { const s = String(v ?? '').trim(); return s || null; }
function isAdmin(actor) {
  return ['owner', 'manager', 'admin', 'assistant_manager', 'supervisor'].includes(String(actor?.role || '').toLowerCase());
}
function assertAdmin(actor) {
  if (!isAdmin(actor)) throw new Error('Admin access required');
}
/** Owner/admin may award directly; managers/supervisors submit for owner approval. */
function canDirectAward(actor) {
  return ['owner', 'admin', 'assistant_manager'].includes(String(actor?.role || '').toLowerCase());
}
function assertDirectAwardAdmin(actor) {
  if (!canDirectAward(actor)) throw new Error('Only the owner/admin can approve or finalise award commissions');
}
function maskAccount(n) {
  const s = String(n || '').replace(/\s/g, '');
  if (s.length <= 4) return '****';
  return `${'*'.repeat(Math.max(4, s.length - 4))}${s.slice(-4)}`;
}

let _schemaReady = false;

function ensureSchema() {
  if (_schemaReady) {
    try {
      if (dbGet('SELECT id FROM referral_settings WHERE id = 1')) return;
    } catch (_) {
      _schemaReady = false;
    }
  }
  if (_schemaReady) return;

  const stmts = [
    `CREATE TABLE IF NOT EXISTS referral_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      default_commission_percent REAL NOT NULL DEFAULT 5,
      commission_basis TEXT NOT NULL DEFAULT 'after_discount_ex_delivery',
      public_apply_enabled INTEGER NOT NULL DEFAULT 1,
      pos_referral_enabled INTEGER NOT NULL DEFAULT 1,
      payout_frequency TEXT NOT NULL DEFAULT 'monthly',
      payout_day INTEGER NOT NULL DEFAULT 15,
      minimum_payout REAL NOT NULL DEFAULT 100,
      auto_approve_commissions INTEGER NOT NULL DEFAULT 0,
      settings_json TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS referral_agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE,
      full_name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      address TEXT,
      username TEXT,
      password_hash TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
      referral_code TEXT UNIQUE,
      referral_link TEXT,
      commission_percent REAL,
      preferred_contact TEXT,
      other_payout_info TEXT,
      terms_accepted_at TEXT,
      approved_at TEXT,
      approved_by INTEGER,
      rejected_at TEXT,
      rejection_reason TEXT,
      suspended_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_referral_agents_status ON referral_agents(status)`,
    `CREATE INDEX IF NOT EXISTS idx_referral_agents_code ON referral_agents(referral_code)`,
    `CREATE TABLE IF NOT EXISTS referral_bank_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id INTEGER NOT NULL,
      bank_name TEXT NOT NULL,
      account_holder TEXT NOT NULL,
      account_number TEXT NOT NULL,
      account_type TEXT NOT NULL DEFAULT 'cheque',
      branch_code TEXT NOT NULL,
      is_current INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS referral_bank_change_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id INTEGER NOT NULL,
      old_bank_json TEXT,
      new_bank_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      requested_at TEXT DEFAULT (datetime('now')),
      reviewed_at TEXT,
      reviewed_by INTEGER,
      review_note TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS referral_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id INTEGER NOT NULL,
      code TEXT NOT NULL UNIQUE,
      is_primary INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'active',
      commission_percent REAL,
      customer_discount_percent REAL,
      customer_discount_amount REAL,
      usage_limit INTEGER,
      usage_count INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT,
      campaign_name TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS referral_link_clicks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT,
      agent_id INTEGER,
      ip_hash TEXT,
      user_agent TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS referral_customer_attributions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER UNIQUE,
      web_customer_id INTEGER,
      agent_id INTEGER NOT NULL,
      referral_code TEXT,
      source TEXT,
      attributed_at TEXT DEFAULT (datetime('now')),
      changed_by INTEGER,
      change_reason TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_referral_attr_agent ON referral_customer_attributions(agent_id)`,
    `CREATE INDEX IF NOT EXISTS idx_referral_attr_web ON referral_customer_attributions(web_customer_id)`,
    `CREATE TABLE IF NOT EXISTS referral_commissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id INTEGER NOT NULL,
      customer_id INTEGER,
      sale_id INTEGER NOT NULL UNIQUE,
      order_id INTEGER,
      referral_code TEXT,
      commission_percent REAL NOT NULL,
      qualifying_amount REAL NOT NULL,
      commission_amount REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      created_at TEXT DEFAULT (datetime('now')),
      approved_at TEXT,
      approved_by INTEGER,
      available_at TEXT,
      paid_at TEXT,
      payout_id INTEGER,
      reversal_reason TEXT,
      reversed_at TEXT,
      notes TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_referral_comm_agent ON referral_commissions(agent_id)`,
    `CREATE INDEX IF NOT EXISTS idx_referral_comm_status ON referral_commissions(status)`,
    `CREATE TABLE IF NOT EXISTS referral_commission_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      commission_id INTEGER,
      agent_id INTEGER NOT NULL,
      entry_type TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      actor_id INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS referral_payouts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payout_number TEXT UNIQUE,
      period_from TEXT,
      period_to TEXT,
      status TEXT NOT NULL DEFAULT 'DRAFT',
      total_amount REAL NOT NULL DEFAULT 0,
      payment_method TEXT,
      payment_reference TEXT,
      processed_by INTEGER,
      approved_by INTEGER,
      paid_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      notes TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS referral_payout_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payout_id INTEGER NOT NULL,
      agent_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      commission_ids_json TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING'
    )`,
    `CREATE TABLE IF NOT EXISTS referral_audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_id INTEGER,
      actor_name TEXT,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id INTEGER,
      before_json TEXT,
      after_json TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS referral_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id INTEGER,
      audience TEXT NOT NULL DEFAULT 'agent',
      title TEXT NOT NULL,
      message TEXT,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS referral_award_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id INTEGER NOT NULL,
      requested_amount REAL NOT NULL,
      final_amount REAL,
      note TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING',
      requested_by INTEGER,
      requested_by_name TEXT,
      requested_by_role TEXT,
      reviewed_by INTEGER,
      reviewed_by_name TEXT,
      reviewed_at TEXT,
      review_decision TEXT,
      review_note TEXT,
      commission_id INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_referral_award_req_status ON referral_award_requests(status)`
  ];

  for (const sql of stmts) {
    try {
      db().exec(sql);
    } catch (err) {
      console.warn('[referral] ensureSchema:', err.message);
    }
  }

  try {
    dbRun(`ALTER TABLE sales ADD COLUMN referral_code TEXT`);
  } catch (_) { /* exists */ }
  try {
    dbRun(`ALTER TABLE sales ADD COLUMN referral_agent_id INTEGER`);
  } catch (_) { /* exists */ }
  try {
    dbRun(`ALTER TABLE referral_payout_items ADD COLUMN payslip_html TEXT`);
  } catch (_) { /* exists */ }
  try {
    dbRun(`ALTER TABLE referral_payout_items ADD COLUMN bank_snapshot_json TEXT`);
  } catch (_) { /* exists */ }
  try {
    dbRun(`ALTER TABLE referral_payouts ADD COLUMN claimed_by_agent INTEGER NOT NULL DEFAULT 0`);
  } catch (_) { /* exists */ }
  try {
    dbRun(`ALTER TABLE referral_agents ADD COLUMN commission_category_id TEXT`);
  } catch (_) { /* exists */ }
  try {
    dbRun(`ALTER TABLE referral_agents ADD COLUMN commission_category_mode TEXT DEFAULT 'auto'`);
  } catch (_) { /* exists */ }

  try {
    const row = dbGet('SELECT id FROM referral_settings WHERE id = 1');
    if (!row) dbRun('INSERT OR IGNORE INTO referral_settings (id) VALUES (1)');
    dbGet('SELECT id FROM referral_settings WHERE id = 1');
    _schemaReady = true;
  } catch (err) {
    _schemaReady = false;
    console.warn('[referral] ensureSchema seed/verify:', err.message);
    throw err;
  }
}

function defaultCommissionCategories() {
  return [
    { id: 'cat_starter', name: 'Starter', percent: 3, min_sales: 0, is_custom: false },
    { id: 'cat_rising', name: 'Rising', percent: 5, min_sales: 5000, is_custom: false },
    { id: 'cat_pro', name: 'Pro', percent: 7, min_sales: 20000, is_custom: false },
    { id: 'cat_elite', name: 'Elite', percent: 10, min_sales: 50000, is_custom: false },
    { id: 'cat_custom', name: 'Custom', percent: null, min_sales: null, is_custom: true }
  ];
}

function normalizeCommissionCategories(list) {
  const raw = Array.isArray(list) ? list : [];
  const defaults = defaultCommissionCategories();
  if (!raw.length) return defaults;
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const row = raw[i] || {};
    const isCustom = !!row.is_custom || String(row.id || '').toLowerCase() === 'cat_custom' || String(row.name || '').toLowerCase() === 'custom';
    const id = text(row.id) || (isCustom ? 'cat_custom' : `cat_${i + 1}`);
    out.push({
      id,
      name: text(row.name) || (isCustom ? 'Custom' : `Category ${i + 1}`),
      percent: isCustom ? (row.percent != null && row.percent !== '' ? num(row.percent) : null) : num(row.percent, defaults[i]?.percent ?? 5),
      min_sales: isCustom ? null : num(row.min_sales, defaults[i]?.min_sales ?? 0),
      is_custom: isCustom
    });
  }
  if (!out.some((c) => c.is_custom)) {
    out.push(defaults.find((c) => c.is_custom) || { id: 'cat_custom', name: 'Custom', percent: null, min_sales: null, is_custom: true });
  }
  // Keep exactly 4 fixed + 1 custom when possible
  const fixed = out.filter((c) => !c.is_custom).slice(0, 4);
  while (fixed.length < 4) {
    const d = defaults[fixed.length];
    fixed.push({ ...d });
  }
  const custom = out.find((c) => c.is_custom) || defaults[4];
  return [...fixed, custom];
}

function agentLifetimeSales(agentId) {
  return money(dbGet(
    `SELECT COALESCE(SUM(qualifying_amount),0) AS s FROM referral_commissions
     WHERE agent_id=? AND status NOT IN ('REVERSED','PENDING_DELIVERY')`,
    [agentId]
  )?.s);
}

function resolveAgentCategory(agent, settings = null) {
  const s = settings || getSettings();
  const cats = normalizeCommissionCategories(s.commission_categories);
  const mode = String(agent?.commission_category_mode || 'auto').toLowerCase() === 'manual' ? 'manual' : 'auto';
  if (mode === 'manual' && agent?.commission_category_id) {
    const cat = cats.find((c) => c.id === agent.commission_category_id) || null;
    if (cat) return { category: cat, mode, sales: agentLifetimeSales(agent.id) };
  }
  const sales = agentLifetimeSales(agent?.id);
  const fixed = cats.filter((c) => !c.is_custom).sort((a, b) => num(a.min_sales) - num(b.min_sales));
  let chosen = fixed[0] || null;
  for (const c of fixed) {
    if (sales >= num(c.min_sales)) chosen = c;
  }
  return { category: chosen, mode: 'auto', sales };
}

function resolveAgentCommissionPercent(agent, settings = null) {
  const s = settings || getSettings();
  const fallback = num(agent?.commission_percent, s.default_commission_percent);
  const { category, mode } = resolveAgentCategory(agent, s);
  if (!category) return fallback;
  if (category.is_custom) {
    // Custom: admin-chosen % stored on the agent
    return num(agent?.commission_percent, category.percent != null ? num(category.percent) : s.default_commission_percent);
  }
  if (mode === 'manual' || mode === 'auto') {
    return num(category.percent, fallback);
  }
  return fallback;
}

function getPublicBase() {
  try {
    const { getPublicUrl } = require('../../../lib/public-url');
    return String(getPublicUrl()).replace(/\/$/, '');
  } catch (_) {
    return String(process.env.SHOP_POS_PUBLIC_URL || 'https://chisafood.up.railway.app').replace(/\/$/, '');
  }
}

function buildReferralLink(code) {
  if (!code) return null;
  return `${getPublicBase()}/order/?ref=${encodeURIComponent(code)}`;
}

function audit(action, entityType, entityId, before, after, actor) {
  try {
    dbRun(
      `INSERT INTO referral_audit_logs (actor_id, actor_name, action, entity_type, entity_id, before_json, after_json, created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        actor?.id || null,
        actor?.full_name || actor?.username || null,
        action,
        entityType || null,
        entityId || null,
        before != null ? JSON.stringify(before) : null,
        after != null ? JSON.stringify(after) : null,
        now()
      ]
    );
  } catch (err) {
    console.warn('[referral] audit:', err.message);
  }
}

function notifyAgent(agentId, title, message) {
  try {
    dbRun(
      `INSERT INTO referral_notifications (agent_id, audience, title, message, created_at) VALUES (?,?,?,?,?)`,
      [agentId, 'agent', title, message, now()]
    );
  } catch (_) { /* ignore */ }
  try {
    const agent = dbGet('SELECT user_id, full_name FROM referral_agents WHERE id = ?', [agentId]);
    if (agent?.user_id) {
      const store = require('./store');
      store.addNotification('referral', title, message, {
        entity_type: 'referral_agent',
        entity_id: agentId,
        audience_user_ids: [agent.user_id]
      });
    }
  } catch (_) { /* ignore */ }
}

function notifyAdmins(title, message) {
  try {
    dbRun(
      `INSERT INTO referral_notifications (agent_id, audience, title, message, created_at) VALUES (NULL,'admin',?,?,?)`,
      [title, message, now()]
    );
    const store = require('./store');
    store.addNotification('referral', title, message, {
      action_page: 'admin:referral-dept',
      audience_roles: ['owner', 'manager', 'assistant_manager']
    });
  } catch (_) { /* ignore */ }
}

function notifyUser(userId, title, message) {
  if (!userId) return;
  try {
    const store = require('./store');
    store.addNotification('referral', title, message, {
      action_page: 'admin:referral-dept',
      audience_user_ids: [Number(userId)]
    });
  } catch (_) { /* ignore */ }
}

/** Unread phone/inbox alerts for Referral Agent or Referral Commission apps. */
function listUnreadNotifications(filters = {}, actor) {
  ensureSchema();
  const audience = String(filters.audience || 'agent').toLowerCase() === 'admin' ? 'admin' : 'agent';
  if (audience === 'admin') {
    assertAdmin(actor);
    return dbAll(
      `SELECT * FROM referral_notifications WHERE audience='admin' AND COALESCE(is_read,0)=0
       ORDER BY created_at DESC LIMIT 50`
    );
  }
  const agent = agentByUser(actor);
  if (!agent) throw new Error('Referral agent login required');
  return dbAll(
    `SELECT * FROM referral_notifications WHERE agent_id=? AND audience='agent' AND COALESCE(is_read,0)=0
     ORDER BY created_at DESC LIMIT 50`,
    [agent.id]
  );
}

/** Mark referral notification read/dismissed so sound + tray stop. */
function ackReferralNotification(id, meta = {}, actor) {
  ensureSchema();
  const row = dbGet('SELECT * FROM referral_notifications WHERE id=?', [id]);
  if (!row) return { success: false, error: 'Notification not found' };
  const audience = String(row.audience || 'agent').toLowerCase();
  if (audience === 'admin') {
    assertAdmin(actor);
  } else {
    const agent = agentByUser(actor);
    if (!agent || Number(agent.id) !== Number(row.agent_id)) throw new Error('Access denied');
  }
  dbRun(`UPDATE referral_notifications SET is_read=1 WHERE id=?`, [id]);
  return { success: true, id: Number(id), ack_type: meta.ack_type || 'read' };
}

function ackAllReferralNotifications(filters = {}, actor) {
  ensureSchema();
  const audience = String(filters.audience || 'agent').toLowerCase() === 'admin' ? 'admin' : 'agent';
  if (audience === 'admin') {
    assertAdmin(actor);
    dbRun(`UPDATE referral_notifications SET is_read=1 WHERE audience='admin' AND COALESCE(is_read,0)=0`);
    return { success: true };
  }
  const agent = agentByUser(actor);
  if (!agent) throw new Error('Referral agent login required');
  dbRun(
    `UPDATE referral_notifications SET is_read=1 WHERE agent_id=? AND audience='agent' AND COALESCE(is_read,0)=0`,
    [agent.id]
  );
  return { success: true };
}

/* ─── Settings ─────────────────────────────────────────────────────────── */

function getSettings() {
  ensureSchema();
  const row = dbGet('SELECT * FROM referral_settings WHERE id = 1') || {};
  const json = (() => { try { return JSON.parse(row.settings_json || '{}'); } catch (_) { return {}; } })();
  const commission_categories = normalizeCommissionCategories(json.commission_categories);
  const minEnabled = json.minimum_payout_enabled !== undefined
    ? !!json.minimum_payout_enabled
    : num(row.minimum_payout, 100) > 0;
  const payoutDayText = text(json.payout_day_text)
    || (row.payout_day != null ? String(row.payout_day) : '15');
  const rawFreq = row.payout_frequency || 'monthly';
  const knownFreq = ['daily', 'every_3_days', 'weekly', 'biweekly', 'monthly'];
  const isCustomFreq = !knownFreq.includes(String(rawFreq).toLowerCase());
  const { payout_day_text: _pdt, payout_frequency_custom: _pfc, minimum_payout_enabled: _mpe, ...restJson } = json;
  return {
    ...restJson,
    default_commission_percent: num(row.default_commission_percent, 5),
    commission_basis: row.commission_basis || 'after_discount_ex_delivery',
    public_apply_enabled: Number(row.public_apply_enabled) !== 0,
    pos_referral_enabled: Number(row.pos_referral_enabled) !== 0,
    payout_frequency: isCustomFreq ? 'custom' : String(rawFreq).toLowerCase(),
    payout_frequency_custom: isCustomFreq ? rawFreq : (text(json.payout_frequency_custom) || ''),
    payout_frequency_label: isCustomFreq ? rawFreq : String(rawFreq).toLowerCase(),
    payout_day: num(row.payout_day, 15),
    payout_day_text: payoutDayText,
    minimum_payout: minEnabled ? num(row.minimum_payout, 100) : 0,
    minimum_payout_enabled: minEnabled,
    auto_approve_commissions: Number(row.auto_approve_commissions) === 1,
    commission_categories
  };
}

function updateSettings(data = {}, actor) {
  assertAdmin(actor);
  ensureSchema();
  const cur = getSettings();
  let freq = data.payout_frequency !== undefined ? text(data.payout_frequency) : cur.payout_frequency_label || cur.payout_frequency;
  if (String(data.payout_frequency || '').toLowerCase() === 'custom'
    || (data.payout_frequency_custom !== undefined && String(data.payout_frequency || cur.payout_frequency) === 'custom')) {
    const custom = text(data.payout_frequency_custom) || text(cur.payout_frequency_custom);
    if (!custom) throw new Error('Enter your custom payout frequency');
    freq = custom;
  } else if (data.payout_frequency !== undefined) {
    const known = ['daily', 'every_3_days', 'weekly', 'biweekly', 'monthly'];
    const f = String(data.payout_frequency).toLowerCase();
    freq = known.includes(f) ? f : (text(data.payout_frequency) || cur.payout_frequency);
  }

  let payoutDayText = cur.payout_day_text;
  let payoutDayNum = cur.payout_day;
  if (data.payout_day_text !== undefined || data.payout_day !== undefined) {
    payoutDayText = text(data.payout_day_text != null ? data.payout_day_text : data.payout_day) || '';
    if (!payoutDayText) throw new Error('Enter a payout day (e.g. 1, 15, or Monday)');
    const parsed = parseInt(String(payoutDayText).replace(/[^\d]/g, ''), 10);
    payoutDayNum = Number.isFinite(parsed) && parsed > 0 ? parsed : num(cur.payout_day, 1);
  }

  let minEnabled = cur.minimum_payout_enabled;
  let minPay = cur.minimum_payout;
  if (data.minimum_payout_enabled !== undefined) {
    minEnabled = !!data.minimum_payout_enabled;
  }
  if (data.minimum_payout !== undefined) {
    const raw = String(data.minimum_payout ?? '').trim();
    if (raw === '' && data.minimum_payout_enabled === false) {
      minPay = 0;
      minEnabled = false;
    } else {
      const n = money(data.minimum_payout);
      if (!(n >= 0) || !Number.isFinite(n)) throw new Error('Enter a valid minimum payout amount, or turn minimum off');
      minPay = n;
      if (data.minimum_payout_enabled === undefined) minEnabled = n > 0;
    }
  }
  if (!minEnabled) minPay = 0;

  const next = {
    default_commission_percent: data.default_commission_percent !== undefined ? num(data.default_commission_percent, 5) : cur.default_commission_percent,
    commission_basis: data.commission_basis || cur.commission_basis,
    public_apply_enabled: data.public_apply_enabled !== undefined ? (data.public_apply_enabled ? 1 : 0) : (cur.public_apply_enabled ? 1 : 0),
    pos_referral_enabled: data.pos_referral_enabled !== undefined ? (data.pos_referral_enabled ? 1 : 0) : (cur.pos_referral_enabled ? 1 : 0),
    payout_frequency: freq || cur.payout_frequency,
    payout_day: payoutDayNum,
    minimum_payout: minPay,
    auto_approve_commissions: data.auto_approve_commissions !== undefined ? (data.auto_approve_commissions ? 1 : 0) : (cur.auto_approve_commissions ? 1 : 0)
  };
  const prevJson = (() => {
    try {
      const raw = dbGet('SELECT settings_json FROM referral_settings WHERE id=1')?.settings_json;
      return JSON.parse(raw || '{}');
    } catch (_) { return {}; }
  })();
  const nextJson = { ...prevJson };
  if (data.commission_categories !== undefined) {
    nextJson.commission_categories = normalizeCommissionCategories(data.commission_categories);
  } else if (!nextJson.commission_categories) {
    nextJson.commission_categories = normalizeCommissionCategories(cur.commission_categories);
  }
  nextJson.payout_day_text = payoutDayText;
  nextJson.minimum_payout_enabled = minEnabled;
  if (String(data.payout_frequency || '').toLowerCase() === 'custom' || !['daily', 'every_3_days', 'weekly', 'biweekly', 'monthly'].includes(String(freq).toLowerCase())) {
    nextJson.payout_frequency_custom = text(data.payout_frequency_custom) || freq;
  } else if (data.payout_frequency !== undefined) {
    nextJson.payout_frequency_custom = null;
  }

  dbRun(
    `UPDATE referral_settings SET default_commission_percent=?, commission_basis=?, public_apply_enabled=?,
      pos_referral_enabled=?, payout_frequency=?, payout_day=?, minimum_payout=?, auto_approve_commissions=?,
      settings_json=?, updated_at=? WHERE id=1`,
    [next.default_commission_percent, next.commission_basis, next.public_apply_enabled, next.pos_referral_enabled,
      next.payout_frequency, next.payout_day, next.minimum_payout, next.auto_approve_commissions,
      JSON.stringify(nextJson), now()]
  );
  audit('settings_updated', 'referral_settings', 1, cur, {
    ...next,
    payout_day_text: payoutDayText,
    minimum_payout_enabled: minEnabled,
    commission_categories: nextJson.commission_categories
  }, actor);
  return getSettings();
}

/* ─── Codes ────────────────────────────────────────────────────────────── */

function uniqueCodeFromName(fullName) {
  const base = String(fullName || 'AGENT').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6) || 'AGENT';
  for (let i = 0; i < 40; i++) {
    const code = `${base}${Math.floor(10 + Math.random() * 89)}`;
    if (!dbGet('SELECT id FROM referral_codes WHERE UPPER(code)=?', [code])
      && !dbGet('SELECT id FROM referral_agents WHERE UPPER(referral_code)=?', [code])) {
      return code;
    }
  }
  return `REF${Date.now().toString().slice(-8)}`;
}

function resolveCode(code) {
  const value = text(code);
  if (!value) return null;
  const upper = value.toUpperCase();
  const row = dbGet(
    `SELECT c.*, a.status AS agent_status, a.full_name AS agent_name, a.id AS agent_id_resolved,
            a.commission_percent AS agent_commission_percent, a.phone AS agent_phone, a.email AS agent_email
     FROM referral_codes c
     JOIN referral_agents a ON a.id = c.agent_id
     WHERE UPPER(c.code)=? AND c.status='active'`,
    [upper]
  ) || dbGet(
    `SELECT NULL AS id, a.id AS agent_id, a.referral_code AS code, 1 AS is_primary, 'active' AS status,
            a.commission_percent, NULL AS customer_discount_percent, NULL AS customer_discount_amount,
            a.status AS agent_status, a.full_name AS agent_name, a.id AS agent_id_resolved,
            a.commission_percent AS agent_commission_percent, a.phone AS agent_phone, a.email AS agent_email
     FROM referral_agents a WHERE UPPER(a.referral_code)=? AND a.status='APPROVED'`,
    [upper]
  );
  if (!row || row.agent_status !== 'APPROVED') return null;
  if (row.expires_at && String(row.expires_at) < now().slice(0, 10)) return null;
  if (row.usage_limit != null && num(row.usage_count) >= num(row.usage_limit)) return null;
  return row;
}

/* ─── Bank masking ─────────────────────────────────────────────────────── */

function currentBank(agentId, reveal) {
  const b = dbGet('SELECT * FROM referral_bank_accounts WHERE agent_id=? AND is_current=1 ORDER BY id DESC LIMIT 1', [agentId]);
  if (!b) return null;
  return {
    id: b.id,
    bank_name: b.bank_name,
    account_holder: b.account_holder,
    account_type: b.account_type,
    branch_code: reveal ? b.branch_code : (b.branch_code ? '****' : null),
    account_number: reveal ? b.account_number : maskAccount(b.account_number),
    status: b.status
  };
}

/* ─── Applications ─────────────────────────────────────────────────────── */

function applyAsAgent(data = {}) {
  ensureSchema();
  const settings = getSettings();
  if (!settings.public_apply_enabled) throw new Error('Applications are currently closed');

  const full_name = text(data.full_name);
  const phone = text(data.phone);
  const email = text(data.email);
  const address = text(data.address);
  if (!full_name || !phone) throw new Error('Full name and mobile number are required');
  if (!email) throw new Error('Email is required');
  if (!address) throw new Error('Address is required');
  if (!data.agreement_accepted && !data.terms_accepted) throw new Error('You must accept the Terms & Conditions');

  const bank = data.bank || {};
  if (!text(bank.bank_name) || !text(bank.account_holder) || !text(bank.account_number) || !text(bank.branch_code)) {
    throw new Error('Complete all bank payout fields');
  }

  const username = text(data.username);
  if (username) {
    const taken = dbGet('SELECT id FROM users WHERE LOWER(username)=?', [username.toLowerCase()])
      || dbGet('SELECT id FROM referral_agents WHERE LOWER(username)=?', [username.toLowerCase()]);
    if (taken) throw new Error('Username already taken');
  }
  const password = text(data.password);
  if (!password || password.length < 6) throw new Error('Password must be at least 6 characters');

  const password_hash = bcrypt.hashSync(password, 10);
  const r = dbRun(
    `INSERT INTO referral_agents (full_name, phone, email, address, username, password_hash, status,
      preferred_contact, other_payout_info, terms_accepted_at, created_at, updated_at)
     VALUES (?,?,?,?,?,?, 'PENDING_APPROVAL',?,?,?,?,?)`,
    [full_name, phone, email, address, username, password_hash,
      text(data.preferred_contact) || 'whatsapp', text(data.other_payout_info),
      now(), now(), now()]
  );
  const agentId = r.lastInsertRowid;
  dbRun(
    `INSERT INTO referral_bank_accounts (agent_id, bank_name, account_holder, account_number, account_type, branch_code, is_current, status)
     VALUES (?,?,?,?,?,?,1,'ACTIVE')`,
    [agentId, text(bank.bank_name), text(bank.account_holder), text(bank.account_number),
      text(bank.account_type) || 'cheque', text(bank.branch_code)]
  );
  audit('agent_applied', 'referral_agent', agentId, null, { full_name, phone, email }, null);
  notifyAdmins('New referral application', `${full_name} applied to become a referral agent`);
  return { id: agentId, status: 'PENDING_APPROVAL', message: 'Application submitted. An admin will review it shortly.' };
}

function listApplications(filters = {}, actor) {
  assertAdmin(actor);
  ensureSchema();
  const status = text(filters.status);
  let sql = `SELECT id, full_name, phone, email, address, username, status, preferred_contact, created_at, approved_at, rejected_at, rejection_reason
             FROM referral_agents WHERE 1=1`;
  const params = [];
  if (status) {
    sql += ' AND status=?';
    params.push(status);
  } else {
    sql += ` AND status IN ('PENDING_APPROVAL','UNDER_REVIEW')`;
  }
  sql += ' ORDER BY created_at DESC LIMIT 200';
  return dbAll(sql, params);
}

function getAgent(id, actor, opts = {}) {
  assertAdmin(actor);
  ensureSchema();
  const a = dbGet('SELECT * FROM referral_agents WHERE id=?', [id]);
  if (!a) throw new Error('Agent not found');
  const reveal = !!opts.revealBank && isAdmin(actor);
  const { password_hash, ...safe } = a;
  const wallet = getAgentWallet(id);
  const settings = getSettings();
  const resolved = resolveAgentCategory(a, settings);
  const effective_percent = resolveAgentCommissionPercent(a, settings);
  return {
    ...safe,
    bank: currentBank(id, reveal),
    wallet,
    commission_categories: settings.commission_categories,
    resolved_category: resolved.category,
    category_mode: resolved.mode,
    lifetime_sales: resolved.sales,
    effective_commission_percent: effective_percent,
    customers_count: num(dbGet('SELECT COUNT(*) AS c FROM referral_customer_attributions WHERE agent_id=?', [id])?.c),
    orders_count: num(dbGet('SELECT COUNT(*) AS c FROM referral_commissions WHERE agent_id=? AND status NOT IN (?,?)', [id, 'REVERSED', 'PENDING_DELIVERY'])?.c),
    sales_total: money(dbGet('SELECT COALESCE(SUM(qualifying_amount),0) AS s FROM referral_commissions WHERE agent_id=? AND status NOT IN (?,?)', [id, 'REVERSED', 'PENDING_DELIVERY'])?.s)
  };
}

function approveAgent(id, actor, opts = {}) {
  assertAdmin(actor);
  ensureSchema();
  const a = dbGet('SELECT * FROM referral_agents WHERE id=?', [id]);
  if (!a) throw new Error('Agent not found');
  if (!['PENDING_APPROVAL', 'UNDER_REVIEW', 'REJECTED'].includes(a.status)) {
    throw new Error(`Cannot approve agent in status ${a.status}`);
  }

  let code = text(opts.referral_code)?.toUpperCase() || a.referral_code || uniqueCodeFromName(a.full_name);
  if (dbGet('SELECT id FROM referral_codes WHERE UPPER(code)=? AND agent_id!=?', [code, id])
    || dbGet('SELECT id FROM referral_agents WHERE UPPER(referral_code)=? AND id!=?', [code, id])) {
    code = uniqueCodeFromName(a.full_name);
  }
  const link = buildReferralLink(code);

  let passwordHash = a.password_hash;
  let tempPassword = null;
  if (!passwordHash) {
    tempPassword = String(Math.floor(100000 + Math.random() * 900000));
    passwordHash = bcrypt.hashSync(tempPassword, 10);
    dbRun(`UPDATE referral_agents SET password_hash=? WHERE id=?`, [passwordHash, id]);
  }

  const userId = ensureAgentUserAccount({ ...a, password_hash: passwordHash });

  dbRun(
    `UPDATE referral_agents SET status='APPROVED', referral_code=?, referral_link=?, user_id=COALESCE(?, user_id),
      password_hash=COALESCE(password_hash, ?), approved_at=?, approved_by=?, updated_at=? WHERE id=?`,
    [code, link, userId || null, passwordHash, now(), actor?.id || null, now(), id]
  );
  const existingCode = dbGet('SELECT id FROM referral_codes WHERE agent_id=? AND is_primary=1', [id]);
  if (existingCode) {
    dbRun(`UPDATE referral_codes SET code=?, status='active' WHERE id=?`, [code, existingCode.id]);
  } else {
    dbRun(
      `INSERT INTO referral_codes (agent_id, code, is_primary, status, commission_percent) VALUES (?,?,1,'active',?)`,
      [id, code, a.commission_percent]
    );
  }
  audit('agent_approved', 'referral_agent', id, { status: a.status }, { status: 'APPROVED', code }, actor);
  notifyAgent(id, 'Application approved', `Welcome! Your referral code is ${code}. Share your link to start earning.`);

  if (tempPassword && a.phone) {
    try {
      const recovery = require('./panel-password-recovery');
      // reuse WhatsApp helper via recover path messaging
      const whatsapp = require('./whatsapp');
      const shopName = dbGet('SELECT shop_name FROM shop_settings WHERE id=1')?.shop_name || 'Shop';
      whatsapp.sendMessage({
        phone: a.phone,
        body: `${shopName} Referral Agent approved.\nUsername: ${a.username || '—'}\nTemporary password: ${tempPassword}\n\nSign in at your Referral Agent link and change your password.`,
        message_type: 'password_recovery',
        recipient_type: 'staff'
      });
    } catch (err) {
      console.warn('[referral] approve temp password WA:', err.message);
    }
  }
  return getAgent(id, actor);
}

/** Repair login rows for all approved agents that already have a password on file. */
function syncApprovedAgentLogins() {
  ensureSchema();
  const rows = dbAll(
    `SELECT * FROM referral_agents
     WHERE UPPER(status) IN ('APPROVED','ACTIVE')
       AND username IS NOT NULL AND TRIM(username)!=''
       AND password_hash IS NOT NULL AND TRIM(password_hash)!=''`
  ) || [];
  let fixed = 0;
  for (const agent of rows) {
    try {
      ensureAgentUserAccount(agent);
      fixed += 1;
    } catch (err) {
      console.warn('[referral] sync login', agent.username, err.message);
    }
  }
  return { success: true, fixed };
}

/** Ensure approved agent has a users row with matching password (login fix). */
function ensureAgentUserAccount(agent) {
  if (!agent) return null;
  const username = text(agent.username);
  if (!username) throw new Error('Agent has no username — ask them to re-register with a username');
  const hash = agent.password_hash;
  if (!hash) throw new Error('Agent has no password on file — use Reset password (WhatsApp)');

  let userId = agent.user_id || null;
  const existing = dbGet('SELECT * FROM users WHERE LOWER(username)=LOWER(?)', [username]);
  if (existing) {
    if (existing.role && existing.role !== 'referral_agent' && Number(existing.id) !== Number(agent.user_id || 0)) {
      // Username belongs to another staff role — still allow if already linked
      if (!agent.user_id) {
        throw new Error(`Username "${username}" is already used by another account. Ask the agent to pick a new username.`);
      }
    }
    userId = existing.id;
    // Postgres shop `users` has no phone/email columns — keep updates to known columns only.
    dbRun(
      `UPDATE users SET password_hash=?, role='referral_agent', full_name=?, is_active=1, pin=NULL WHERE id=?`,
      [hash, agent.full_name || username, userId]
    );
  } else {
    const ins = dbRun(
      `INSERT INTO users (username, password_hash, full_name, role, is_active, created_at)
       VALUES (?,?,?,?,1,?)`,
      [username, hash, agent.full_name || username, 'referral_agent', now()]
    );
    userId = ins.lastInsertRowid;
  }
  if (userId) {
    dbRun(`UPDATE referral_agents SET user_id=?, updated_at=? WHERE id=?`, [userId, now(), agent.id]);
  }
  return userId;
}

/**
 * Login path for approved referral agents when users row is missing or password was out of sync.
 */
function agentLoginBlockMessage(status) {
  const s = String(status || '').toUpperCase();
  if (s === 'SUSPENDED') {
    return 'You have been suspended. Contact the administrator.';
  }
  if (s === 'DELETED' || s === 'TERMINATED') {
    return 'This referral agent account has been deleted and can no longer sign in.';
  }
  if (s === 'REJECTED') {
    return 'Your application was rejected. Contact the administrator.';
  }
  if (s && !['APPROVED', 'ACTIVE'].includes(s)) {
    return 'Your application is not approved yet. Wait for admin approval.';
  }
  return null;
}

/** Block POS/admin login when the users row is linked to a suspended/deleted referral agent. */
function assertLinkedAgentMayLogin(user) {
  if (!user) return { ok: true };
  ensureSchema();
  const agent = dbGet(
    `SELECT id, status FROM referral_agents
     WHERE user_id=? OR LOWER(COALESCE(username,''))=LOWER(?)
     LIMIT 1`,
    [user.id, user.username || '']
  );
  if (!agent) return { ok: true };
  const msg = agentLoginBlockMessage(agent.status);
  if (msg) return { ok: false, error: msg };
  return { ok: true };
}

function loginApprovedAgent(username, password) {
  ensureSchema();
  const u = String(username || '').trim();
  const p = String(password || '');
  if (!u || !p) return { success: false, error: 'Invalid username or password' };

  const agent = dbGet(
    `SELECT * FROM referral_agents
     WHERE LOWER(COALESCE(username,''))=LOWER(?)
        OR LOWER(COALESCE(email,''))=LOWER(?)
        OR phone=?
     LIMIT 1`,
    [u, u, u]
  );
  if (!agent) return { success: false, error: 'Invalid username or password' };
  const status = String(agent.status || '').toUpperCase();
  const block = agentLoginBlockMessage(status);
  if (block) return { success: false, error: block };
  if (!['APPROVED', 'ACTIVE'].includes(status)) {
    return { success: false, error: 'Your application is not approved yet. Wait for admin approval.' };
  }

  let passOk = false;
  try {
    if (agent.password_hash) passOk = bcrypt.compareSync(p, agent.password_hash);
  } catch (_) { passOk = false; }
  if (!passOk && agent.user_id) {
    const user = dbGet('SELECT password_hash FROM users WHERE id=?', [agent.user_id]);
    try {
      if (user?.password_hash) passOk = bcrypt.compareSync(p, user.password_hash);
    } catch (_) { passOk = false; }
    if (passOk && user.password_hash) {
      dbRun(`UPDATE referral_agents SET password_hash=? WHERE id=?`, [user.password_hash, agent.id]);
      agent.password_hash = user.password_hash;
    }
  }
  if (!passOk) return { success: false, error: 'Invalid username or password' };

  // Sync hash onto agent if login used users hash path already handled; ensure users row matches agent hash
  if (agent.password_hash) {
    try {
      ensureAgentUserAccount(agent);
    } catch (err) {
      return { success: false, error: err.message || 'Could not prepare agent login' };
    }
  }

  const session = require('./session');
  const user = dbGet('SELECT * FROM users WHERE id=? OR LOWER(username)=LOWER(?)', [agent.user_id, agent.username]);
  if (!user) return { success: false, error: 'Invalid username or password' };
  const { password_hash, pin: _pin, ...safe } = user;
  session.setUserSession(safe);
  session.clearEmployeeSession();
  return { success: true, user: safe };
}

/** Admin: send WhatsApp temporary password and ensure login account exists. */
function adminResetAgentPassword(id, actor, opts = {}) {
  assertAdmin(actor);
  ensureSchema();
  const agent = dbGet('SELECT * FROM referral_agents WHERE id=?', [id]);
  if (!agent) throw new Error('Agent not found');
  const phone = text(agent.phone);
  if (!phone) throw new Error('No phone on file for this agent');

  const temp = text(opts.password) || String(Math.floor(100000 + Math.random() * 900000));
  if (temp.length < 6) throw new Error('Password must be at least 6 characters');
  const hash = bcrypt.hashSync(temp, 10);
  dbRun(`UPDATE referral_agents SET password_hash=?, updated_at=? WHERE id=?`, [hash, now(), id]);
  ensureAgentUserAccount({ ...agent, password_hash: hash });

  const shopName = dbGet('SELECT shop_name FROM shop_settings WHERE id=1')?.shop_name || 'Shop';
  let wa = { sent: false, url: null };
  try {
    const whatsapp = require('./whatsapp');
    try {
      const r = whatsapp.sendMessage({
        phone,
        body: `${shopName} Referral Agent — temporary password: ${temp}\nUsername: ${agent.username || '—'}\n\nSign in on your Referral Agent link and change your password.`,
        message_type: 'password_recovery',
        recipient_type: 'staff'
      });
      wa = { sent: true, url: r?.url || null };
    } catch (err) {
      wa = { sent: false, url: whatsapp.buildWaUrl?.(phone, `${shopName} Referral Agent temp password: ${temp}`) || null, error: err.message };
    }
  } catch (err) {
    wa = { sent: false, error: err.message };
  }
  audit('agent_password_reset', 'referral_agent', id, null, { by: actor?.username }, actor);
  notifyAgent(id, 'Password reset', 'An admin reset your password. Check WhatsApp for the temporary password.');
  return {
    success: true,
    message: wa.sent ? 'Temporary password sent to agent WhatsApp.' : 'Password updated. Open WhatsApp link if needed.',
    whatsapp_url: wa.url || null,
    username: agent.username
  };
}

function rejectAgent(id, reason, actor) {
  assertAdmin(actor);
  const a = dbGet('SELECT * FROM referral_agents WHERE id=?', [id]);
  if (!a) throw new Error('Agent not found');
  dbRun(
    `UPDATE referral_agents SET status='REJECTED', rejection_reason=?, rejected_at=?, updated_at=? WHERE id=?`,
    [text(reason) || 'Rejected', now(), now(), id]
  );
  audit('agent_rejected', 'referral_agent', id, { status: a.status }, { status: 'REJECTED', reason }, actor);
  notifyAgent(id, 'Application rejected', text(reason) || 'Your application was not approved.');
  return { success: true };
}

function setUnderReview(id, actor) {
  assertAdmin(actor);
  dbRun(`UPDATE referral_agents SET status='UNDER_REVIEW', updated_at=? WHERE id=?`, [now(), id]);
  audit('agent_under_review', 'referral_agent', id, null, { status: 'UNDER_REVIEW' }, actor);
  return { success: true };
}

function suspendAgent(id, actor) {
  assertAdmin(actor);
  const a = dbGet('SELECT * FROM referral_agents WHERE id=?', [id]);
  if (!a) throw new Error('Agent not found');
  dbRun(`UPDATE referral_agents SET status='SUSPENDED', suspended_at=?, updated_at=? WHERE id=?`, [now(), now(), id]);
  dbRun(`UPDATE referral_codes SET status='disabled' WHERE agent_id=?`, [id]);
  if (a.user_id) {
    try { dbRun(`UPDATE users SET is_active=0 WHERE id=? AND role='referral_agent'`, [a.user_id]); } catch (_) { /* optional */ }
  }
  audit('agent_suspended', 'referral_agent', id, { status: a.status }, { status: 'SUSPENDED' }, actor);
  notifyAgent(id, 'Account suspended', 'Your referral agent account has been suspended. You cannot sign in until an admin unsuspends you.');
  return { success: true };
}

function unsuspendAgent(id, actor) {
  assertAdmin(actor);
  const a = dbGet('SELECT * FROM referral_agents WHERE id=?', [id]);
  if (!a) throw new Error('Agent not found');
  if (String(a.status).toUpperCase() !== 'SUSPENDED') throw new Error('Agent is not suspended');
  dbRun(`UPDATE referral_agents SET status='APPROVED', suspended_at=NULL, updated_at=? WHERE id=?`, [now(), id]);
  dbRun(`UPDATE referral_codes SET status='active' WHERE agent_id=?`, [id]);
  if (a.user_id) {
    try { dbRun(`UPDATE users SET is_active=1 WHERE id=?`, [a.user_id]); } catch (_) { /* optional */ }
  } else if (a.password_hash) {
    try { ensureAgentUserAccount(a); } catch (_) { /* optional */ }
  }
  audit('agent_unsuspended', 'referral_agent', id, { status: 'SUSPENDED' }, { status: 'APPROVED' }, actor);
  notifyAgent(id, 'Account restored', 'Your referral agent account is active again. You can sign in.');
  return getAgent(id, actor);
}

function updateAgent(id, data = {}, actor) {
  assertAdmin(actor);
  ensureSchema();
  const a = dbGet('SELECT * FROM referral_agents WHERE id=?', [id]);
  if (!a) throw new Error('Agent not found');
  if (['DELETED', 'TERMINATED'].includes(String(a.status || '').toUpperCase())) {
    throw new Error('Cannot edit a deleted agent');
  }

  const full_name = text(data.full_name) || a.full_name;
  const phone = text(data.phone) || a.phone;
  const email = text(data.email) || a.email;
  const address = data.address != null ? text(data.address) : a.address;
  const preferred_contact = data.preferred_contact != null ? text(data.preferred_contact) : a.preferred_contact;
  const commission_percent = data.commission_percent != null && data.commission_percent !== ''
    ? num(data.commission_percent)
    : a.commission_percent;
  const commission_category_id = data.commission_category_id !== undefined
    ? (text(data.commission_category_id) || null)
    : a.commission_category_id;
  const commission_category_mode = data.commission_category_mode !== undefined
    ? (String(data.commission_category_mode || 'auto').toLowerCase() === 'manual' ? 'manual' : 'auto')
    : (a.commission_category_mode || 'auto');
  let username = text(data.username) || a.username;
  if (username && username.toLowerCase() !== String(a.username || '').toLowerCase()) {
    const taken = dbGet('SELECT id FROM users WHERE LOWER(username)=? AND id!=?', [username.toLowerCase(), a.user_id || 0])
      || dbGet('SELECT id FROM referral_agents WHERE LOWER(username)=? AND id!=?', [username.toLowerCase(), id]);
    if (taken) throw new Error('Username already taken');
  }

  let code = text(data.referral_code)?.toUpperCase() || a.referral_code;
  if (code && code !== a.referral_code) {
    const clash = dbGet('SELECT id FROM referral_codes WHERE UPPER(code)=? AND agent_id!=?', [code, id])
      || dbGet('SELECT id FROM referral_agents WHERE UPPER(referral_code)=? AND id!=?', [code, id]);
    if (clash) throw new Error('Referral code already in use');
  }
  const link = code ? buildReferralLink(code) : a.referral_link;

  dbRun(
    `UPDATE referral_agents SET full_name=?, phone=?, email=?, address=?, username=?, preferred_contact=?,
      commission_percent=?, commission_category_id=?, commission_category_mode=?, referral_code=?, referral_link=?, updated_at=? WHERE id=?`,
    [full_name, phone, email, address, username, preferred_contact, commission_percent,
      commission_category_id, commission_category_mode, code, link, now(), id]
  );

  if (a.user_id) {
    try {
      dbRun(`UPDATE users SET full_name=?, username=COALESCE(?, username) WHERE id=?`,
        [full_name, username || null, a.user_id]);
    } catch (_) { /* optional */ }
  }

  if (code) {
    const existingCode = dbGet('SELECT id FROM referral_codes WHERE agent_id=? AND is_primary=1', [id]);
    if (existingCode) {
      dbRun(`UPDATE referral_codes SET code=?, commission_percent=?, status=CASE WHEN status='disabled' THEN status ELSE 'active' END WHERE id=?`,
        [code, commission_percent, existingCode.id]);
    } else if (String(a.status).toUpperCase() === 'APPROVED') {
      dbRun(`INSERT INTO referral_codes (agent_id, code, is_primary, status, commission_percent) VALUES (?,?,1,'active',?)`,
        [id, code, commission_percent]);
    }
  }

  const bank = data.bank || {};
  if (text(bank.bank_name) || text(bank.account_number) || text(bank.account_holder) || text(bank.branch_code)) {
    const cur = dbGet('SELECT * FROM referral_bank_accounts WHERE agent_id=? AND is_current=1 ORDER BY id DESC LIMIT 1', [id]);
    const next = {
      bank_name: text(bank.bank_name) || cur?.bank_name || '',
      account_holder: text(bank.account_holder) || cur?.account_holder || '',
      account_number: text(bank.account_number) || cur?.account_number || '',
      account_type: text(bank.account_type) || cur?.account_type || 'cheque',
      branch_code: text(bank.branch_code) || cur?.branch_code || ''
    };
    if (cur) {
      dbRun(
        `UPDATE referral_bank_accounts SET bank_name=?, account_holder=?, account_number=?, account_type=?, branch_code=? WHERE id=?`,
        [next.bank_name, next.account_holder, next.account_number, next.account_type, next.branch_code, cur.id]
      );
    } else {
      dbRun(
        `INSERT INTO referral_bank_accounts (agent_id, bank_name, account_holder, account_number, account_type, branch_code, is_current, status)
         VALUES (?,?,?,?,?,?,1,'ACTIVE')`,
        [id, next.bank_name, next.account_holder, next.account_number, next.account_type, next.branch_code]
      );
    }
  }

  audit('agent_updated', 'referral_agent', id, { full_name: a.full_name, phone: a.phone }, { full_name, phone, email, code }, actor);
  return getAgent(id, actor, { revealBank: !!data.revealBank });
}

function deleteAgent(id, actor) {
  assertAdmin(actor);
  ensureSchema();
  const a = dbGet('SELECT * FROM referral_agents WHERE id=?', [id]);
  if (!a) throw new Error('Agent not found');
  if (String(a.status).toUpperCase() === 'DELETED') return { success: true, already: true };

  const tombUsername = `deleted_${id}_${Date.now().toString(36)}`;
  dbRun(
    `UPDATE referral_agents SET status='DELETED', username=?, referral_link=NULL, suspended_at=?, updated_at=? WHERE id=?`,
    [tombUsername, now(), now(), id]
  );
  dbRun(`UPDATE referral_codes SET status='disabled' WHERE agent_id=?`, [id]);
  if (a.user_id) {
    try {
      dbRun(
        `UPDATE users SET is_active=0, username=?, full_name=COALESCE(full_name,'Deleted agent') WHERE id=? AND role='referral_agent'`,
        [tombUsername, a.user_id]
      );
    } catch (_) {
      try { dbRun(`UPDATE users SET is_active=0 WHERE id=?`, [a.user_id]); } catch (__) { /* optional */ }
    }
  }
  audit('agent_deleted', 'referral_agent', id, { status: a.status, username: a.username }, { status: 'DELETED' }, actor);
  return { success: true };
}

/**
 * Apply a manual award into the agent wallet (AVAILABLE). Used by owner direct award
 * and after an award request is approved/reduced by the owner.
 */
function applyManualAward(agentId, data = {}, actor) {
  ensureSchema();
  const agent = dbGet('SELECT * FROM referral_agents WHERE id=?', [agentId]);
  if (!agent) throw new Error('Agent not found');
  if (!['APPROVED', 'SUSPENDED'].includes(String(agent.status || '').toUpperCase())) {
    throw new Error('Can only award commission to approved (or suspended) agents');
  }
  const amount = money(data.amount);
  if (!(amount > 0)) throw new Error('Enter a commission amount greater than zero');
  const note = text(data.note) || text(data.reason) || 'Manual admin award';
  const percent = num(data.commission_percent, agent.commission_percent || getSettings().default_commission_percent || 0);
  const qual = data.qualifying_amount != null ? money(data.qualifying_amount) : amount;
  const fakeSaleId = -(Number(String(Date.now()) + String(agentId % 1000).padStart(3, '0')));

  const r = dbRun(
    `INSERT INTO referral_commissions (agent_id, customer_id, sale_id, referral_code, commission_percent,
      qualifying_amount, commission_amount, status, created_at, approved_at, available_at, notes)
     VALUES (?,?,?,?,?,?,?,'AVAILABLE',?,?,?,?)`,
    [agentId, data.customer_id || null, fakeSaleId, agent.referral_code || null, percent,
      qual, amount, now(), now(), now(), note]
  );
  let commissionId = Number(r?.lastInsertRowid) || 0;
  if (!commissionId) {
    commissionId = Number(dbGet('SELECT id FROM referral_commissions WHERE sale_id=?', [fakeSaleId])?.id) || 0;
  }
  if (!commissionId) throw new Error('Failed to create commission award');
  dbRun(
    `INSERT INTO referral_commission_ledger (commission_id, agent_id, entry_type, amount, note, actor_id, created_at)
     VALUES (?,?,?,?,?,?,?)`,
    [commissionId, agentId, 'ACCRUE', amount, note, actor?.id || null, now()]
  );
  tryPostCommissionAccounting(commissionId, agentId, amount, 'manual_award');
  audit('commission_manual_award', 'referral_commission', commissionId, null, { agent_id: agentId, amount, note }, actor);
  notifyAgent(agentId, 'Commission awarded', `You were awarded R${amount.toFixed(2)}: ${note}`);
  return dbGet('SELECT * FROM referral_commissions WHERE id=?', [commissionId]);
}

/**
 * Manual commission award.
 * Owner/assistant_manager → agent wallet immediately.
 * Manager/supervisor → pending Admin Award Approvals queue (agent is NOT notified yet).
 */
function awardManualCommission(id, data = {}, actor) {
  assertAdmin(actor);
  ensureSchema();
  const agent = dbGet('SELECT * FROM referral_agents WHERE id=?', [id]);
  if (!agent) throw new Error('Agent not found');
  if (!['APPROVED', 'SUSPENDED'].includes(String(agent.status || '').toUpperCase())) {
    throw new Error('Can only award commission to approved (or suspended) agents');
  }
  const amount = money(data.amount);
  if (!(amount > 0)) throw new Error('Enter a commission amount greater than zero');
  const note = text(data.note) || text(data.reason);
  if (!note) throw new Error('Enter a reason / note for the award');

  if (canDirectAward(actor)) {
    const row = applyManualAward(id, { ...data, amount, note }, actor);
    return { ...row, pending_approval: false, awarded_directly: true };
  }

  const r = dbRun(
    `INSERT INTO referral_award_requests
      (agent_id, requested_amount, note, status, requested_by, requested_by_name, requested_by_role, created_at, updated_at)
     VALUES (?,?,?,'PENDING',?,?,?,?,?)`,
    [id, amount, note, actor?.id || null, actor?.full_name || actor?.username || 'Staff',
      String(actor?.role || ''), now(), now()]
  );
  let requestId = Number(r?.lastInsertRowid) || 0;
  if (!requestId) {
    requestId = Number(dbGet(
      `SELECT id FROM referral_award_requests WHERE agent_id=? AND requested_by=? AND status='PENDING'
       ORDER BY id DESC LIMIT 1`,
      [id, actor?.id || null]
    )?.id) || 0;
  }
  audit('commission_award_requested', 'referral_award_request', requestId, null, {
    agent_id: id, amount, note
  }, actor);
  try {
    const store = require('./store');
    store.addNotification('referral', 'Award commission needs approval',
      `${actor?.full_name || 'Staff'} requested R${amount.toFixed(2)} for ${agent.full_name}: ${note}`, {
        action_page: 'admin:referral-dept',
        audience_roles: ['owner', 'admin', 'assistant_manager']
      });
    dbRun(
      `INSERT INTO referral_notifications (agent_id, audience, title, message, created_at) VALUES (NULL,'admin',?,?,?)`,
      ['Award commission needs approval',
        `${actor?.full_name || 'Staff'} requested R${amount.toFixed(2)} for ${agent.full_name}: ${note}`, now()]
    );
  } catch (_) {
    notifyAdmins(
      'Award commission needs approval',
      `${actor?.full_name || 'Staff'} requested R${amount.toFixed(2)} for ${agent.full_name}: ${note}`
    );
  }
  return {
    pending_approval: true,
    awarded_directly: false,
    request_id: requestId,
    agent_id: id,
    requested_amount: amount,
    note,
    status: 'PENDING',
    message: 'Submitted for owner/admin approval. The agent will only see this after approval.'
  };
}

function formatAwardRequest(row) {
  if (!row) return null;
  return {
    ...row,
    requested_amount: money(row.requested_amount),
    final_amount: row.final_amount != null ? money(row.final_amount) : null,
    agent_name: row.agent_name || null,
    agent_code: row.agent_code || null
  };
}

function listAwardRequests(filters = {}, actor) {
  assertAdmin(actor);
  ensureSchema();
  const status = text(filters.status) || 'PENDING';
  const where = status === 'ALL' ? '1=1' : 'r.status=?';
  const params = status === 'ALL' ? [] : [status];
  return dbAll(
    `SELECT r.*, a.full_name AS agent_name, a.referral_code AS agent_code, a.phone AS agent_phone
     FROM referral_award_requests r
     LEFT JOIN referral_agents a ON a.id = r.agent_id
     WHERE ${where}
     ORDER BY CASE WHEN r.status='PENDING' THEN 0 ELSE 1 END, r.id DESC
     LIMIT 200`,
    params
  ).map(formatAwardRequest);
}

function getAwardRequest(id, actor) {
  assertAdmin(actor);
  ensureSchema();
  const row = dbGet(
    `SELECT r.*, a.full_name AS agent_name, a.referral_code AS agent_code, a.phone AS agent_phone
     FROM referral_award_requests r
     LEFT JOIN referral_agents a ON a.id = r.agent_id
     WHERE r.id=?`,
    [id]
  );
  return formatAwardRequest(row);
}

/**
 * Owner/admin decides on a pending award:
 * - approve: pay original amount to agent
 * - reduce: set lower amount + required reason (visible to requester); then pay agent
 * - reject: no agent payout; reason returned to requester
 */
function decideAwardRequest(id, data = {}, actor) {
  assertDirectAwardAdmin(actor);
  ensureSchema();
  const row = dbGet('SELECT * FROM referral_award_requests WHERE id=?', [id]);
  if (!row) throw new Error('Award request not found');
  if (String(row.status) !== 'PENDING') throw new Error('This award request was already decided');

  const decision = String(data.decision || data.action || '').toLowerCase();
  if (!['approve', 'reject', 'reduce'].includes(decision)) {
    throw new Error('Choose approve, reject, or reduce');
  }

  const reviewNote = text(data.review_note) || text(data.reason) || text(data.note);
  let finalAmount = money(row.requested_amount);

  if (decision === 'reject') {
    if (!reviewNote) throw new Error('Enter a reason for rejecting this award');
    dbRun(
      `UPDATE referral_award_requests SET status='REJECTED', review_decision='reject', review_note=?,
        reviewed_by=?, reviewed_by_name=?, reviewed_at=?, updated_at=? WHERE id=?`,
      [reviewNote, actor.id, actor.full_name || actor.username, now(), now(), id]
    );
    audit('commission_award_rejected', 'referral_award_request', id, row, { reviewNote }, actor);
    notifyUser(
      row.requested_by,
      'Award commission rejected',
      `Your award of R${money(row.requested_amount).toFixed(2)} for agent #${row.agent_id} was rejected. Reason: ${reviewNote}`
    );
    return getAwardRequest(id, actor);
  }

  if (decision === 'reduce') {
    finalAmount = money(data.final_amount != null ? data.final_amount : data.amount);
    if (!(finalAmount > 0)) throw new Error('Enter the reduced award amount');
    if (finalAmount >= money(row.requested_amount)) {
      throw new Error('Reduced amount must be less than the requested amount (or use Approve)');
    }
    if (!reviewNote) throw new Error('Enter a reason for reducing the award — this is shown to the person who requested it');
  }

  const agent = dbGet('SELECT * FROM referral_agents WHERE id=?', [row.agent_id]);
  const awardNote = decision === 'reduce'
    ? `${row.note || 'Manual award'} (Admin reduced from R${money(row.requested_amount).toFixed(2)} to R${finalAmount.toFixed(2)}: ${reviewNote})`
    : (row.note || 'Manual award (admin approved)');

  const commission = applyManualAward(row.agent_id, {
    amount: finalAmount,
    note: awardNote
  }, actor);

  dbRun(
    `UPDATE referral_award_requests SET status='APPROVED', review_decision=?, review_note=?,
      final_amount=?, commission_id=?, reviewed_by=?, reviewed_by_name=?, reviewed_at=?, updated_at=? WHERE id=?`,
    [decision, reviewNote || (decision === 'approve' ? 'Approved' : null), finalAmount,
      commission.id, actor.id, actor.full_name || actor.username, now(), now(), id]
  );
  audit('commission_award_approved', 'referral_award_request', id, row, {
    decision, finalAmount, reviewNote, commission_id: commission.id
  }, actor);

  if (decision === 'reduce') {
    notifyUser(
      row.requested_by,
      'Award commission reduced & approved',
      `Your award for ${agent?.full_name || 'the agent'} was reduced from R${money(row.requested_amount).toFixed(2)} to R${finalAmount.toFixed(2)}. Reason: ${reviewNote}. The agent has been credited the reduced amount.`
    );
  } else {
    notifyUser(
      row.requested_by,
      'Award commission approved',
      `Your award of R${finalAmount.toFixed(2)} for ${agent?.full_name || 'the agent'} was approved. The agent has been credited.`
    );
  }

  return getAwardRequest(id, actor);
}

/** POS typeahead: match referral code / agent name / phone while typing. */
function searchReferralCodes(query, limit = 12) {
  ensureSchema();
  const q = text(query);
  if (!q || q.length < 1) return [];
  const like = `%${q}%`;
  const upper = q.toUpperCase();
  const likeUpper = `%${upper}%`;
  const rows = dbAll(
    `SELECT a.id AS agent_id, a.full_name AS agent_name, a.phone AS agent_phone, a.referral_code AS code,
            a.commission_percent
     FROM referral_agents a
     WHERE a.status='APPROVED'
       AND (
         UPPER(COALESCE(a.referral_code,'')) LIKE ?
         OR UPPER(a.full_name) LIKE ?
         OR COALESCE(a.phone,'') LIKE ?
       )
     ORDER BY
       CASE WHEN UPPER(COALESCE(a.referral_code,''))= ? THEN 0 ELSE 1 END,
       a.full_name
     LIMIT ?`,
    [likeUpper, likeUpper, like, upper, Math.min(40, Number(limit) || 12)]
  );
  const settings = getSettings();
  return rows.map((r) => ({
    type: 'referral',
    code: r.code,
    agent_id: r.agent_id,
    agent_name: r.agent_name,
    agent_phone: r.agent_phone,
    commission_percent: num(r.commission_percent, settings.default_commission_percent)
  })).filter((r) => r.code);
}

function listAgents(filters = {}, actor) {
  assertAdmin(actor);
  ensureSchema();
  const status = text(filters.status);
  let sql = `SELECT id, full_name, phone, email, status, referral_code, referral_link, commission_percent, created_at, approved_at
             FROM referral_agents WHERE 1=1`;
  const params = [];
  if (status) { sql += ' AND status=?'; params.push(status); }
  else { sql += ` AND status NOT IN ('DELETED','TERMINATED')`; }
  sql += ' ORDER BY created_at DESC LIMIT 500';
  return dbAll(sql, params).map((a) => ({
    ...a,
    wallet: getAgentWallet(a.id),
    customers_count: num(dbGet('SELECT COUNT(*) AS c FROM referral_customer_attributions WHERE agent_id=?', [a.id])?.c)
  }));
}

/* ─── Attribution ──────────────────────────────────────────────────────── */

function attributeCustomer({ customerId, webCustomerId, code, source, actor } = {}) {
  ensureSchema();
  const resolved = resolveCode(code);
  if (!resolved) throw new Error('Invalid or inactive referral code');
  const agentId = resolved.agent_id || resolved.agent_id_resolved;

  // Self-referral protection
  const agent = dbGet('SELECT * FROM referral_agents WHERE id=?', [agentId]);
  if (customerId) {
    const cust = dbGet('SELECT * FROM customers WHERE id=?', [customerId]);
    if (cust && agent) {
      const p1 = String(cust.phone || '').replace(/\D/g, '');
      const p2 = String(agent.phone || '').replace(/\D/g, '');
      if (p1 && p2 && p1 === p2) throw new Error('Self-referral is not allowed');
      if (cust.email && agent.email && String(cust.email).toLowerCase() === String(agent.email).toLowerCase()) {
        throw new Error('Self-referral is not allowed');
      }
    }
  }

  if (customerId) {
    const existing = dbGet('SELECT * FROM referral_customer_attributions WHERE customer_id=?', [customerId]);
    if (existing) {
      if (isAdmin(actor) && actor && text(actor.force_reassign)) {
        // admin override path
      } else {
        return existing; // first referrer wins
      }
    }
  }

  if (webCustomerId && !customerId) {
    const existingW = dbGet('SELECT * FROM referral_customer_attributions WHERE web_customer_id=? AND customer_id IS NULL', [webCustomerId]);
    if (existingW) return existingW;
  }

  const r = dbRun(
    `INSERT INTO referral_customer_attributions (customer_id, web_customer_id, agent_id, referral_code, source, attributed_at)
     VALUES (?,?,?,?,?,?)`,
    [customerId || null, webCustomerId || null, agentId, resolved.code || code, source || 'online_code', now()]
  );
  try {
    dbRun(`UPDATE referral_codes SET usage_count = COALESCE(usage_count,0)+1 WHERE id=?`, [resolved.id]);
  } catch (_) { /* optional */ }
  audit('customer_attributed', 'referral_attribution', r.lastInsertRowid, null, { customerId, agentId, code }, actor);
  notifyAgent(agentId, 'New referred customer', `A customer joined with your code ${resolved.code || code}`);
  return dbGet('SELECT * FROM referral_customer_attributions WHERE id=?', [r.lastInsertRowid]);
}

function resolveAgentForCustomer(customerId, webCustomerId = null) {
  if (customerId) {
    const row = dbGet(
      `SELECT attr.*, a.status AS agent_status, a.referral_code AS agent_code, a.commission_percent AS agent_percent
       FROM referral_customer_attributions attr
       JOIN referral_agents a ON a.id = attr.agent_id
       WHERE attr.customer_id=? AND a.status='APPROVED'`,
      [customerId]
    );
    if (row) return row;
  }
  if (webCustomerId) {
    return dbGet(
      `SELECT attr.*, a.status AS agent_status, a.referral_code AS agent_code, a.commission_percent AS agent_percent
       FROM referral_customer_attributions attr
       JOIN referral_agents a ON a.id = attr.agent_id
       WHERE attr.web_customer_id=? AND a.status='APPROVED'
       ORDER BY attr.id DESC LIMIT 1`,
      [webCustomerId]
    );
  }
  return null;
}

function recordClick(code, meta = {}) {
  const resolved = resolveCode(code);
  if (!resolved) return { ok: false };
  dbRun(
    `INSERT INTO referral_link_clicks (code, agent_id, ip_hash, user_agent, created_at) VALUES (?,?,?,?,?)`,
    [resolved.code || code, resolved.agent_id || resolved.agent_id_resolved, text(meta.ip_hash), text(meta.user_agent), now()]
  );
  return { ok: true, code: resolved.code };
}

function validateReferralCode(code) {
  const resolved = resolveCode(code);
  if (!resolved) return { type: 'invalid', error: 'Invalid referral code' };
  const settings = getSettings();
  const percent = num(resolved.commission_percent ?? resolved.agent_commission_percent, settings.default_commission_percent);
  return {
    type: 'referral',
    code: resolved.code || String(code).toUpperCase(),
    agent_id: resolved.agent_id || resolved.agent_id_resolved,
    agent_name: resolved.agent_name,
    commission_percent: percent,
    discount_percent: num(resolved.customer_discount_percent),
    discount_amount: num(resolved.customer_discount_amount),
    discount: num(resolved.customer_discount_amount) || 0,
    error: null
  };
}

/* ─── Commission on sales ──────────────────────────────────────────────── */

function qualifyingAmount(sale) {
  // Agents earn only on discounted item amount — never delivery fees, tax, or other charges.
  const discount = money(sale.discount);
  const delivery = money(sale.delivery_fee);
  const tax = money(sale.tax_amount);
  const total = money(sale.total);
  const subtotal = money(sale.subtotal != null ? sale.subtotal : (total - delivery - tax + discount));
  return Math.max(0, money(subtotal - discount));
}

function processSale(saleId) {
  ensureSchema();
  const sale = dbGet('SELECT * FROM sales WHERE id=?', [saleId]);
  if (!sale || String(sale.status || '').toLowerCase() === 'void') return null;
  if (dbGet('SELECT id FROM referral_commissions WHERE sale_id=?', [saleId])) return null; // idempotent

  let code = text(sale.referral_code);
  let attr = null;
  if (code) {
    try {
      if (sale.customer_id) {
        attr = resolveAgentForCustomer(sale.customer_id);
        if (!attr) {
          attributeCustomer({ customerId: sale.customer_id, code, source: 'pos' });
          attr = resolveAgentForCustomer(sale.customer_id);
        }
      }
    } catch (err) {
      console.warn('[referral] attribute on sale:', err.message);
    }
  }
  if (!attr && sale.customer_id) attr = resolveAgentForCustomer(sale.customer_id);
  // Online orders may have attributed the web customer before a POS customer_id existed
  if (!attr) {
    try {
      const online = dbGet('SELECT web_customer_id, coupon_code FROM online_orders_local WHERE sale_id=?', [saleId]);
      if (online?.web_customer_id) {
        attr = resolveAgentForCustomer(null, online.web_customer_id);
        if (!code && online.coupon_code) code = text(online.coupon_code);
      }
      if (!attr && online?.web_customer_id && (code || online.coupon_code)) {
        try {
          attributeCustomer({
            customerId: sale.customer_id || null,
            webCustomerId: online.web_customer_id,
            code: code || online.coupon_code,
            source: 'online_order'
          });
          attr = resolveAgentForCustomer(sale.customer_id, online.web_customer_id);
        } catch (err) {
          console.warn('[referral] online attribute on sale:', err.message);
        }
      }
    } catch (_) { /* optional online link */ }
  }
  // Direct sale attribution via referral_agent_id or code lookup (POS pick)
  if (!attr && sale.referral_agent_id) {
    const direct = dbGet('SELECT id AS agent_id, status AS agent_status, referral_code FROM referral_agents WHERE id=?', [sale.referral_agent_id]);
    if (direct) attr = direct;
  }
  if (!attr && code) {
    const codeRowEarly = resolveCode(code);
    if (codeRowEarly) {
      attr = {
        agent_id: codeRowEarly.agent_id_resolved || codeRowEarly.agent_id,
        agent_status: codeRowEarly.agent_status,
        referral_code: codeRowEarly.code
      };
    }
  }
  if (!attr) return null;
  if (attr.agent_status && attr.agent_status !== 'APPROVED') return null;

  const agentId = attr.agent_id;
  const agent = dbGet('SELECT * FROM referral_agents WHERE id=? AND status=?', [agentId, 'APPROVED']);
  if (!agent) return null;

  const settings = getSettings();
  const codeRow = code ? resolveCode(code) : (agent.referral_code ? resolveCode(agent.referral_code) : null);
  // Category % wins; per-code override only when code has an explicit percent set
  let percent = resolveAgentCommissionPercent(agent, settings);
  if (codeRow?.commission_percent != null && codeRow.commission_percent !== '') {
    percent = num(codeRow.commission_percent, percent);
  }
  const qual = qualifyingAmount(sale);
  if (qual <= 0) return null;
  const amount = money((qual * percent) / 100);
  if (amount <= 0) return null;

  const isDelivery = String(sale.order_type || '').toLowerCase() === 'delivery'
    || money(sale.delivery_fee) > 0;
  const status = isDelivery
    ? 'PENDING_DELIVERY'
    : (settings.auto_approve_commissions ? 'APPROVED' : 'PENDING');
  const r = dbRun(
    `INSERT INTO referral_commissions (agent_id, customer_id, sale_id, referral_code, commission_percent,
      qualifying_amount, commission_amount, status, created_at, approved_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [agentId, sale.customer_id || null, saleId, code || agent.referral_code || attr.referral_code,
      percent, qual, amount, status, now(), status === 'APPROVED' ? now() : null]
  );
  const commissionId = r.lastInsertRowid;
  dbRun(
    `INSERT INTO referral_commission_ledger (commission_id, agent_id, entry_type, amount, note, created_at)
     VALUES (?,?,?,?,?,?)`,
    [commissionId, agentId, 'ACCRUE', amount,
      isDelivery ? `Sale #${saleId} — pending successful delivery` : `Sale #${saleId}`, now()]
  );
  try {
    dbRun(`UPDATE sales SET referral_code=?, referral_agent_id=? WHERE id=?`,
      [code || agent.referral_code, agentId, saleId]);
  } catch (_) { /* columns may be missing until ensureSchema */ }

  if (status === 'PENDING_DELIVERY') {
    notifyAgent(agentId, 'Commission pending delivery',
      `R${amount.toFixed(2)} (${percent}%) reserved for sale #${saleId}. You earn it only when the order is successfully delivered.`);
  } else {
    notifyAgent(agentId, 'Commission earned', `You earned R${amount.toFixed(2)} (${percent}%) from a referral sale`);
    tryPostCommissionAccounting(commissionId, agentId, amount, 'accrue');
  }
  audit('commission_created', 'referral_commission', commissionId, null, { saleId, amount, percent, status }, null);
  return dbGet('SELECT * FROM referral_commissions WHERE id=?', [commissionId]);
}

function confirmCommissionOnDelivery(saleId) {
  ensureSchema();
  if (!saleId) return null;
  let c = dbGet('SELECT * FROM referral_commissions WHERE sale_id=?', [saleId]);
  if (!c) {
    // Sale may have been created without delivery flag; create then release
    c = processSale(saleId);
    if (!c) return null;
    if (c.status !== 'PENDING_DELIVERY') return c;
  }
  if (c.status === 'REVERSED') return null;
  if (c.status !== 'PENDING_DELIVERY') return c;

  const settings = getSettings();
  const next = settings.auto_approve_commissions ? 'APPROVED' : 'PENDING';
  dbRun(`UPDATE referral_commissions SET status=?, approved_at=? WHERE id=?`,
    [next, next === 'APPROVED' ? now() : null, c.id]);
  dbRun(
    `INSERT INTO referral_commission_ledger (commission_id, agent_id, entry_type, amount, note, created_at)
     VALUES (?,?,?,?,?,?)`,
    [c.id, c.agent_id, 'RELEASE', c.commission_amount, `Delivered — sale #${saleId}`, now()]
  );
  notifyAgent(c.agent_id, 'Commission confirmed',
    `Order delivered. You earned R${money(c.commission_amount).toFixed(2)} (${num(c.commission_percent)}%) on sale #${saleId}.`);
  tryPostCommissionAccounting(c.id, c.agent_id, money(c.commission_amount), 'accrue');
  audit('commission_delivered', 'referral_commission', c.id, { status: 'PENDING_DELIVERY' }, { status: next }, null);
  return dbGet('SELECT * FROM referral_commissions WHERE id=?', [c.id]);
}

function tryPostCommissionAccounting(commissionId, agentId, amount, eventKey) {
  try {
    const acc = require('./accounting-platform');
    const expense = dbGet(`SELECT id FROM acc_accounts WHERE LOWER(name) LIKE '%commission%' AND type IN ('expense','Expense') LIMIT 1`)
      || dbGet(`SELECT id FROM acc_accounts WHERE account_type='expense' LIMIT 1`);
    const liability = dbGet(`SELECT id FROM acc_accounts WHERE LOWER(name) LIKE '%payable%' LIMIT 1`)
      || dbGet(`SELECT id FROM acc_accounts WHERE account_type='liability' LIMIT 1`);
    if (!expense || !liability || !acc.postJournal) return;
    const abs = Math.abs(amount);
    const isReverse = amount < 0 || String(eventKey || '').includes('reverse');
    acc.postJournal({
      description: `Referral commission #${commissionId}`,
      reference: `REF-COMM-${commissionId}${isReverse ? '-REV' : ''}`,
      source_type: 'referral_commission',
      source_id: commissionId,
      event_key: eventKey,
      journal_type: 'general',
      status: 'posted',
      lines: isReverse
        ? [
          { account_id: liability.id, debit: abs, credit: 0 },
          { account_id: expense.id, debit: 0, credit: abs }
        ]
        : [
          { account_id: expense.id, debit: abs, credit: 0 },
          { account_id: liability.id, debit: 0, credit: abs }
        ]
    }, { role: 'owner', id: 0, username: 'system' });
  } catch (err) {
    console.warn('[referral] accounting:', err.message);
  }
}

function reverseCommissionForSale(saleId, ratio = 1, reason = 'refund', actor = null) {
  ensureSchema();
  const c = dbGet('SELECT * FROM referral_commissions WHERE sale_id=?', [saleId]);
  if (!c || c.status === 'REVERSED') return null;
  const wasPendingDelivery = c.status === 'PENDING_DELIVERY';  const amt = money(num(c.commission_amount) * Math.min(1, Math.max(0, num(ratio, 1))));
  const reasonText = text(reason) || 'cancelled';
  dbRun(
    `UPDATE referral_commissions SET status='REVERSED', reversal_reason=?, reversed_at=?, commission_amount=? WHERE id=?`,
    [reasonText, now(), amt, c.id]
  );
  dbRun(
    `INSERT INTO referral_commission_ledger (commission_id, agent_id, entry_type, amount, note, actor_id, created_at)
     VALUES (?,?,?,?,?,?,?)`,
    [c.id, c.agent_id, 'REVERSE', -amt, reasonText, actor?.id || null, now()]
  );
  const lower = reasonText.toLowerCase();
  let title = 'Commission reversed';
  let message = `Commission on sale #${saleId} was reversed (${reasonText}).`;
  if (lower.includes('void')) {
    title = 'Order voided — commission cancelled';
    message = `Sale #${saleId} was voided. Your commission of R${amt.toFixed(2)} has been cancelled.`;
  } else if (lower.includes('return') || lower.includes('refund')) {
    title = 'Order returned — commission cancelled';
    message = `Sale #${saleId} was returned/refunded. Your commission of R${amt.toFixed(2)} has been cancelled.`;
  } else if (lower.includes('cancel')) {
    title = 'Order cancelled — commission cancelled';
    message = `Sale #${saleId} was cancelled. Your commission of R${amt.toFixed(2)} has been cancelled.`;
  } else if (lower.includes('fail') || lower.includes('delivery')) {
    title = 'Delivery failed — commission cancelled';
    message = `Delivery for sale #${saleId} did not complete. Your commission of R${amt.toFixed(2)} has been cancelled.`;
  } else if (wasPendingDelivery) {
    title = 'Commission cancelled';
    message = `Sale #${saleId} did not complete successfully (${reasonText}). Reserved commission of R${amt.toFixed(2)} will not be paid.`;
  }
  notifyAgent(c.agent_id, title, message);
  if (!wasPendingDelivery) {
    try {
      // Best-effort reverse of accounting only if it was accrued
      tryPostCommissionAccounting(c.id, c.agent_id, -amt, 'reverse');
    } catch (_) { /* */ }
  }
  audit('commission_reversed', 'referral_commission', c.id, c, { status: 'REVERSED', reason: reasonText }, actor);
  return { success: true };
}

function approveCommission(id, actor) {
  assertAdmin(actor);
  const c = dbGet('SELECT * FROM referral_commissions WHERE id=?', [id]);
  if (!c) throw new Error('Commission not found');
  if (c.status === 'REVERSED' || c.status === 'PAID') throw new Error('Cannot approve this commission');
  if (c.status === 'PENDING_DELIVERY') throw new Error('Cannot approve until the order is successfully delivered');
  dbRun(`UPDATE referral_commissions SET status='APPROVED', approved_at=?, approved_by=? WHERE id=?`,
    [now(), actor?.id || null, id]);
  dbRun(`INSERT INTO referral_commission_ledger (commission_id, agent_id, entry_type, amount, note, actor_id, created_at)
         VALUES (?,?,?,?,?,?,?)`, [id, c.agent_id, 'APPROVE', c.commission_amount, 'Approved', actor?.id || null, now()]);
  notifyAgent(c.agent_id, 'Commission approved', `R${money(c.commission_amount).toFixed(2)} approved`);
  return dbGet('SELECT * FROM referral_commissions WHERE id=?', [id]);
}

function markCommissionsAvailable(actor) {
  assertAdmin(actor);
  dbRun(`UPDATE referral_commissions SET status='AVAILABLE', available_at=? WHERE status='APPROVED'`, [now()]);
  return { success: true };
}

function listCommissions(filters = {}, actor) {
  assertAdmin(actor);
  ensureSchema();
  let sql = `SELECT c.*, a.full_name AS agent_name, a.referral_code AS agent_code
             FROM referral_commissions c JOIN referral_agents a ON a.id=c.agent_id WHERE 1=1`;
  const params = [];
  if (filters.agent_id) { sql += ' AND c.agent_id=?'; params.push(filters.agent_id); }
  if (filters.status) { sql += ' AND c.status=?'; params.push(filters.status); }
  if (filters.from) { sql += ' AND date(c.created_at)>=date(?)'; params.push(filters.from); }
  if (filters.to) { sql += ' AND date(c.created_at)<=date(?)'; params.push(filters.to); }
  sql += ' ORDER BY c.created_at DESC LIMIT 500';
  return dbAll(sql, params);
}

/* ─── Wallet ───────────────────────────────────────────────────────────── */

function getAgentWallet(agentId) {
  const rows = dbAll('SELECT status, commission_amount FROM referral_commissions WHERE agent_id=?', [agentId]);
  const sum = (statuses) => money(rows.filter((r) => statuses.includes(r.status)).reduce((s, r) => s + num(r.commission_amount), 0));
  const pending = sum(['PENDING', 'UNDER_REVIEW']);
  const pending_delivery = sum(['PENDING_DELIVERY']);
  const approved = sum(['APPROVED']);
  const available = sum(['AVAILABLE']);
  const claimed = sum(['CLAIMED']);
  const paid = sum(['PAID']);
  const reversed = sum(['REVERSED']);
  const total = money(pending + approved + available + claimed + paid);
  return {
    total_earned: total,
    pending,
    pending_delivery,
    approved,
    available,
    claimed,
    paid,
    reversed,
    available_for_payout: available
  };
}

/* ─── Payouts ──────────────────────────────────────────────────────────── */

function generatePayoutBatch(data = {}, actor) {
  assertAdmin(actor);
  ensureSchema();
  const settings = getSettings();
  const minPay = settings.minimum_payout_enabled === false ? 0 : num(settings.minimum_payout, 0);
  const agents = dbAll(`SELECT id, full_name FROM referral_agents WHERE status='APPROVED'`);
  const items = [];
  let total = 0;
  for (const a of agents) {
    const comms = dbAll(`SELECT * FROM referral_commissions WHERE agent_id=? AND status='AVAILABLE'`, [a.id]);
    const amount = money(comms.reduce((s, c) => s + num(c.commission_amount), 0));
    if (amount <= 0 || amount < minPay) continue;
    items.push({ agent_id: a.id, full_name: a.full_name, amount, commission_ids: comms.map((c) => c.id) });
    total += amount;
  }
  if (!items.length) {
    throw new Error(minPay > 0
      ? 'No agents meet the minimum payout threshold'
      : 'No agents have available commission to pay');
  }
  const payoutNumber = `PAY-${now().slice(0, 10).replace(/-/g, '')}-${String(Date.now()).slice(-4)}`;
  const r = dbRun(
    `INSERT INTO referral_payouts (payout_number, period_from, period_to, status, total_amount, processed_by, created_at, notes)
     VALUES (?,?,?,'DRAFT',?,?,?,?)`,
    [payoutNumber, data.period_from || null, data.period_to || null, total, actor?.id || null, now(), data.notes || null]
  );
  const payoutId = r.lastInsertRowid;
  for (const it of items) {
    dbRun(
      `INSERT INTO referral_payout_items (payout_id, agent_id, amount, commission_ids_json, status) VALUES (?,?,?,?,?)`,
      [payoutId, it.agent_id, it.amount, JSON.stringify(it.commission_ids), 'PENDING']
    );
  }
  audit('payout_generated', 'referral_payout', payoutId, null, { payoutNumber, total, count: items.length }, actor);
  return getPayout(payoutId, actor);
}

function getPayout(id, actor) {
  assertAdmin(actor);
  const p = dbGet('SELECT * FROM referral_payouts WHERE id=?', [id]);
  if (!p) throw new Error('Payout not found');
  const items = dbAll(
    `SELECT i.*, a.full_name, a.referral_code FROM referral_payout_items i
     JOIN referral_agents a ON a.id=i.agent_id WHERE i.payout_id=?`,
    [id]
  ).map((it) => {
    let bankSnap = null;
    try { bankSnap = it.bank_snapshot_json ? JSON.parse(it.bank_snapshot_json) : null; } catch (_) { bankSnap = null; }
    return { ...it, bank: bankSnap || currentBank(it.agent_id, true) };
  });
  return { ...p, items };
}

function listPayouts(filters = {}, actor) {
  assertAdmin(actor);
  return dbAll(`SELECT * FROM referral_payouts ORDER BY created_at DESC LIMIT 100`);
}

function approvePayout(id, actor) {
  assertAdmin(actor);
  dbRun(`UPDATE referral_payouts SET status='APPROVED', approved_by=? WHERE id=? AND status='DRAFT'`, [actor?.id || null, id]);
  audit('payout_approved', 'referral_payout', id, null, { status: 'APPROVED' }, actor);
  return getPayout(id, actor);
}

function buildAgentPayslipHtml(agent, payout, item, bank, shop = {}, commissions = []) {
  const shopName = shop.shop_name || 'Referral Commission';
  const currency = shop.currency || 'R';
  const ref = payout.payment_reference || payout.payout_number || '—';
  const rows = (commissions || []).map((c, i) => `<tr>
      <td>${i + 1}</td>
      <td>${String(c.created_at || '').slice(0, 16) || '—'}</td>
      <td>#${c.sale_id || '—'}</td>
      <td>${c.customer_name || '—'}</td>
      <td style="text-align:right">${currency}${money(c.qualifying_amount).toFixed(2)}</td>
      <td style="text-align:right">${currency}${money(c.commission_amount).toFixed(2)}</td>
    </tr>`).join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Commission payslip</title>
    <style>body{font-family:Arial,sans-serif;padding:24px;color:#111}table{width:100%;border-collapse:collapse;margin-top:16px;font-size:12px}
    th,td{border:1px solid #ccc;padding:6px 8px;text-align:left}th{background:#f3f4f6}
    h1{margin:0 0 8px}.muted{color:#555;font-size:13px}.box{border:1px solid #ddd;padding:12px;border-radius:8px;margin-top:12px}</style></head><body>
    <h1>${shopName}</h1>
    <p class="muted">Referral commission payslip</p>
    <div class="box">
      <p><strong>Agent:</strong> ${agent?.full_name || '—'}<br>
      <strong>Code:</strong> ${agent?.referral_code || '—'}<br>
      <strong>Phone:</strong> ${agent?.phone || '—'}<br>
      <strong>Email:</strong> ${agent?.email || '—'}<br>
      <strong>Payout:</strong> ${payout.payout_number || '—'}<br>
      <strong>Paid:</strong> ${payout.paid_at ? String(payout.paid_at).slice(0, 16) : '—'}<br>
      <strong>Payment reference:</strong> ${ref}<br>
      <strong>Paid to bank:</strong> ${bank?.bank_name || '—'} · ${bank?.account_holder || '—'} · ${bank?.account_number || '—'} · branch ${bank?.branch_code || '—'}<br>
      <strong>Total paid:</strong> ${currency}${money(item.amount).toFixed(2)}</p>
    </div>
    <table><thead><tr><th>#</th><th>Date</th><th>Sale</th><th>Customer</th><th>Sale amt</th><th>Commission</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="6">No commission lines</td></tr>'}</tbody>
    <tfoot><tr><td colspan="5" style="text-align:right"><strong>Total</strong></td><td style="text-align:right"><strong>${currency}${money(item.amount).toFixed(2)}</strong></td></tr></tfoot></table>
    <p class="muted" style="margin-top:16px">Money was sent to the bank account details on file for this agent.</p>
    </body></html>`;
}

function claimWalletPayout(actor) {
  ensureSchema();
  const agent = agentByUser(actor);
  if (!agent || agent.status !== 'APPROVED') throw new Error('Approved agent account required');
  const settings = getSettings();
  const minPay = settings.minimum_payout_enabled === false ? 0 : num(settings.minimum_payout, 0);
  const bank = currentBank(agent.id, true);
  if (!bank?.account_number || !bank?.bank_name) {
    throw new Error('Add complete bank details before claiming');
  }
  const open = dbGet(
    `SELECT i.id FROM referral_payout_items i
     JOIN referral_payouts p ON p.id=i.payout_id
     WHERE i.agent_id=? AND p.status IN ('DRAFT','APPROVED') LIMIT 1`,
    [agent.id]
  );
  if (open) throw new Error('You already have a claim waiting for admin payment');
  const comms = dbAll(`SELECT * FROM referral_commissions WHERE agent_id=? AND status='AVAILABLE'`, [agent.id]);
  const amount = money(comms.reduce((s, c) => s + num(c.commission_amount), 0));
  if (amount <= 0) throw new Error('No available commission to claim');
  if (minPay > 0 && amount < minPay) throw new Error(`Minimum claim is R${minPay.toFixed(2)}. Available: R${amount.toFixed(2)}`);
  const payoutNumber = `CLM-${now().slice(0, 10).replace(/-/g, '')}-${String(Date.now()).slice(-4)}`;
  const r = dbRun(
    `INSERT INTO referral_payouts (payout_number, period_from, period_to, status, total_amount, processed_by, created_at, notes, claimed_by_agent)
     VALUES (?,?,?,'DRAFT',?,?,?,?,1)`,
    [payoutNumber, null, null, amount, actor?.id || null, now(), `Claimed by ${agent.full_name}`, 1]
  );
  const payoutId = r.lastInsertRowid;
  const ids = comms.map((c) => c.id);
  dbRun(
    `INSERT INTO referral_payout_items (payout_id, agent_id, amount, commission_ids_json, status, bank_snapshot_json)
     VALUES (?,?,?,?,?,?)`,
    [payoutId, agent.id, amount, JSON.stringify(ids), 'CLAIMED', JSON.stringify(bank)]
  );
  for (const c of comms) {
    dbRun(`UPDATE referral_commissions SET status='CLAIMED', payout_id=? WHERE id=?`, [payoutId, c.id]);
  }
  notifyAdmins(
    'Referral claim submitted',
    `${agent.full_name} claimed R${amount.toFixed(2)} · ${payoutNumber}. Pay to ${bank.bank_name} ${bank.account_number}.`
  );
  notifyAgent(agent.id, 'Claim submitted', `You claimed R${amount.toFixed(2)}. Admin will pay to your bank account on file.`);
  audit('wallet_claimed', 'referral_payout', payoutId, null, { amount, payoutNumber }, actor);
  return getAgentDashboard(actor);
}

function markPayoutPaid(id, data = {}, actor) {
  assertAdmin(actor);
  const p = getPayout(id, actor);
  if (!['DRAFT', 'APPROVED'].includes(p.status)) throw new Error('Payout cannot be marked paid');
  const paidAt = now();
  const payRef = text(data.payment_reference) || p.payout_number;
  dbRun(
    `UPDATE referral_payouts SET status='PAID', payment_method=?, payment_reference=?, paid_at=?, processed_by=? WHERE id=?`,
    [text(data.payment_method) || 'bank_transfer', payRef, paidAt, actor?.id || null, id]
  );
  const shop = dbGet('SELECT shop_name, currency, phone, address FROM shop_settings WHERE id=1') || {};
  const paidPayout = { ...p, status: 'PAID', payment_reference: payRef, paid_at: paidAt };
  for (const it of p.items) {
    let ids = [];
    try { ids = JSON.parse(it.commission_ids_json || '[]'); } catch (_) { ids = []; }
    const commissionRows = ids.length
      ? dbAll(
        `SELECT c.*, cu.name AS customer_name FROM referral_commissions c
         LEFT JOIN customers cu ON cu.id=c.customer_id WHERE c.id IN (${ids.map(() => '?').join(',')})`,
        ids
      )
      : [];
    for (const c of commissionRows) {
      dbRun(`UPDATE referral_commissions SET status='PAID', paid_at=?, payout_id=? WHERE id=?`, [paidAt, id, c.id]);
      dbRun(
        `INSERT INTO referral_commission_ledger (commission_id, agent_id, entry_type, amount, note, actor_id, created_at)
         VALUES (?,?,?,?,?,?,?)`,
        [c.id, it.agent_id, 'PAY', money(c.commission_amount), `Payout ${p.payout_number}`, actor?.id || null, paidAt]
      );
    }
    const agent = dbGet('SELECT * FROM referral_agents WHERE id=?', [it.agent_id]) || {};
    let bank = null;
    try { bank = it.bank_snapshot_json ? JSON.parse(it.bank_snapshot_json) : null; } catch (_) { bank = null; }
    if (!bank) bank = currentBank(it.agent_id, true) || it.bank || {};
    const payslipHtml = buildAgentPayslipHtml(agent, paidPayout, it, bank, shop, commissionRows);
    dbRun(`UPDATE referral_payout_items SET status='PAID', payslip_html=? WHERE id=?`, [payslipHtml, it.id]);
    notifyAgent(
      it.agent_id,
      'Commission paid — payslip ready',
      `R${money(it.amount).toFixed(2)} paid to your bank · ref ${payRef}. Open Recent commissions for your payslip.`
    );
  }
  audit('payout_paid', 'referral_payout', id, { status: p.status }, { status: 'PAID', reference: payRef }, actor);
  return getPayout(id, actor);
}

function getAgentPayslip(payoutItemId, actor) {
  ensureSchema();
  const agent = agentByUser(actor);
  const isAdm = isAdmin(actor);
  const row = dbGet(
    `SELECT i.*, p.payout_number, p.paid_at, p.payment_reference, p.status AS payout_status, a.full_name
     FROM referral_payout_items i
     JOIN referral_payouts p ON p.id=i.payout_id
     JOIN referral_agents a ON a.id=i.agent_id
     WHERE i.id=?`,
    [payoutItemId]
  );
  if (!row) throw new Error('Payslip not found');
  if (!isAdm && (!agent || Number(agent.id) !== Number(row.agent_id))) throw new Error('Access denied');
  if (!row.payslip_html) throw new Error('Payslip not ready yet');
  return row;
}

/* ─── Dashboards ───────────────────────────────────────────────────────── */

function getAdminDashboard(filters = {}, actor) {
  assertAdmin(actor);
  ensureSchema();
  try { syncApprovedAgentLogins(); } catch (_) { /* non-fatal */ }
  const settings = getSettings();
  const totalAgents = num(dbGet(`SELECT COUNT(*) AS c FROM referral_agents`)?.c);
  const pending = num(dbGet(`SELECT COUNT(*) AS c FROM referral_agents WHERE status IN ('PENDING_APPROVAL','UNDER_REVIEW')`)?.c);
  const active = num(dbGet(`SELECT COUNT(*) AS c FROM referral_agents WHERE status='APPROVED'`)?.c);
  const suspended = num(dbGet(`SELECT COUNT(*) AS c FROM referral_agents WHERE status='SUSPENDED'`)?.c);
  const customers = num(dbGet(`SELECT COUNT(*) AS c FROM referral_customer_attributions`)?.c);
  const orders = num(dbGet(`SELECT COUNT(*) AS c FROM referral_commissions WHERE status NOT IN ('REVERSED','PENDING_DELIVERY')`)?.c);
  const sales = money(dbGet(`SELECT COALESCE(SUM(qualifying_amount),0) AS s FROM referral_commissions WHERE status NOT IN ('REVERSED','PENDING_DELIVERY')`)?.s);
  const generated = money(dbGet(`SELECT COALESCE(SUM(commission_amount),0) AS s FROM referral_commissions WHERE status NOT IN ('REVERSED','PENDING_DELIVERY')`)?.s);
  const commPending = money(dbGet(`SELECT COALESCE(SUM(commission_amount),0) AS s FROM referral_commissions WHERE status IN ('PENDING','UNDER_REVIEW')`)?.s);
  const pendingDelivery = money(dbGet(`SELECT COALESCE(SUM(commission_amount),0) AS s FROM referral_commissions WHERE status='PENDING_DELIVERY'`)?.s);
  const available = money(dbGet(`SELECT COALESCE(SUM(commission_amount),0) AS s FROM referral_commissions WHERE status IN ('APPROVED','AVAILABLE')`)?.s);
  const paid = money(dbGet(`SELECT COALESCE(SUM(commission_amount),0) AS s FROM referral_commissions WHERE status='PAID'`)?.s);

  const pendingAwards = num(dbGet(`SELECT COUNT(*) AS c FROM referral_award_requests WHERE status='PENDING'`)?.c);
  const applications = listApplications({}, actor).slice(0, 8);
  const topAgents = getTopAgents({}, actor).slice(0, 5);
  const recentCommissions = listCommissions({ ...(filters || {}) }, actor).slice(0, 8);
  const unreadNotifications = dbAll(
    `SELECT * FROM referral_notifications WHERE audience='admin' AND COALESCE(is_read,0)=0
     ORDER BY created_at DESC LIMIT 50`
  );

  return {
    settings,
    kpis: {
      total_agents: totalAgents,
      pending_applications: pending,
      pending_award_requests: pendingAwards,
      active_agents: active,
      suspended_agents: suspended,
      customers_referred: customers,
      referral_orders: orders,
      sales_generated: sales,
      commission_generated: generated,
      commission_pending: commPending,
      commission_pending_delivery: pendingDelivery,
      commission_available: available,
      commission_paid: paid
    },
    applications,
    top_agents: topAgents,
    recent_commissions: recentCommissions,
    unread_notifications: unreadNotifications,
    payout_schedule: {
      frequency: settings.payout_frequency_label || settings.payout_frequency,
      payout_day: settings.payout_day_text || settings.payout_day,
      minimum_payout: settings.minimum_payout,
      minimum_payout_enabled: settings.minimum_payout_enabled !== false
    }
  };
}

function getTopAgents(filters = {}, actor) {
  assertAdmin(actor);
  const rows = dbAll(
    `SELECT a.id, a.full_name, a.referral_code,
      (SELECT COUNT(*) FROM referral_customer_attributions x WHERE x.agent_id=a.id) AS customers,
      (SELECT COUNT(*) FROM referral_commissions c WHERE c.agent_id=a.id AND c.status!='REVERSED') AS orders,
      (SELECT COALESCE(SUM(qualifying_amount),0) FROM referral_commissions c WHERE c.agent_id=a.id AND c.status!='REVERSED') AS sales,
      (SELECT COALESCE(SUM(commission_amount),0) FROM referral_commissions c WHERE c.agent_id=a.id AND c.status!='REVERSED') AS commission
     FROM referral_agents a WHERE a.status='APPROVED'
     ORDER BY commission DESC LIMIT 50`
  );
  return rows.map((r, i) => ({ ...r, rank: i + 1, sales: money(r.sales), commission: money(r.commission) }));
}

function agentByUser(actor) {
  if (!actor?.id) return null;
  return dbGet(`SELECT * FROM referral_agents WHERE user_id=?`, [actor.id])
    || dbGet(`SELECT * FROM referral_agents WHERE LOWER(username)=LOWER(?)`, [actor.username || '']);
}

function getAgentDashboard(actor) {
  ensureSchema();
  const agent = agentByUser(actor);
  if (!agent) throw new Error('No referral agent profile linked to this account');
  if (agent.status !== 'APPROVED' && agent.status !== 'SUSPENDED') {
    return { agent: { id: agent.id, full_name: agent.full_name, status: agent.status }, pending: true };
  }
  const wallet = getAgentWallet(agent.id);
  const customers = num(dbGet('SELECT COUNT(*) AS c FROM referral_customer_attributions WHERE agent_id=?', [agent.id])?.c);
  const orders = num(dbGet(`SELECT COUNT(*) AS c FROM referral_commissions WHERE agent_id=? AND status NOT IN ('REVERSED','PENDING_DELIVERY')`, [agent.id])?.c);
  const sales = money(dbGet(`SELECT COALESCE(SUM(qualifying_amount),0) AS s FROM referral_commissions WHERE agent_id=? AND status NOT IN ('REVERSED','PENDING_DELIVERY')`, [agent.id])?.s);
  const clicks = num(dbGet('SELECT COUNT(*) AS c FROM referral_link_clicks WHERE agent_id=?', [agent.id])?.c);
  const conversion = clicks > 0 ? Math.round((customers / clicks) * 100) : (customers ? 100 : 0);
  const recent = dbAll(
    `SELECT c.*, cu.name AS customer_name FROM referral_commissions c
     LEFT JOIN customers cu ON cu.id=c.customer_id
     WHERE c.agent_id=? ORDER BY c.created_at DESC LIMIT 20`,
    [agent.id]
  );
  const payslips = dbAll(
    `SELECT i.id AS payout_item_id, i.amount AS commission_amount, i.payslip_html, i.status,
      p.payout_number, p.paid_at AS created_at, p.payment_reference, p.status AS payout_status
     FROM referral_payout_items i
     JOIN referral_payouts p ON p.id=i.payout_id
     WHERE i.agent_id=? AND p.status='PAID' AND i.payslip_html IS NOT NULL
     ORDER BY p.paid_at DESC LIMIT 20`,
    [agent.id]
  ).map((row) => ({
    ...row,
    entry_type: 'PAYSLIP',
    sale_id: row.payout_number,
    customer_name: 'Payslip — bank payout',
    qualifying_amount: row.commission_amount,
    commission_percent: '',
    status: 'PAID'
  }));
  const recentCombined = [...payslips, ...recent]
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    .slice(0, 30);
  const referred = dbAll(
    `SELECT attr.*, cu.name AS customer_name, cu.phone,
      (SELECT COUNT(*) FROM referral_commissions c WHERE c.customer_id=attr.customer_id AND c.agent_id=attr.agent_id) AS orders,
      (SELECT COALESCE(SUM(qualifying_amount),0) FROM referral_commissions c WHERE c.customer_id=attr.customer_id AND c.agent_id=attr.agent_id AND c.status!='REVERSED') AS sales,
      (SELECT COALESCE(SUM(commission_amount),0) FROM referral_commissions c WHERE c.customer_id=attr.customer_id AND c.agent_id=attr.agent_id AND c.status!='REVERSED') AS commission,
      (SELECT MAX(created_at) FROM referral_commissions c WHERE c.customer_id=attr.customer_id AND c.agent_id=attr.agent_id) AS last_order_at
     FROM referral_customer_attributions attr
     LEFT JOIN customers cu ON cu.id=attr.customer_id
     WHERE attr.agent_id=? ORDER BY attr.attributed_at DESC LIMIT 100`,
    [agent.id]
  );
  const payouts = dbAll(
    `SELECT p.payout_number, p.paid_at, p.status AS payout_status, p.notes, p.claimed_by_agent, p.payment_reference,
      i.id AS payout_item_id, i.amount, i.status, i.payslip_html
     FROM referral_payout_items i JOIN referral_payouts p ON p.id=i.payout_id
     WHERE i.agent_id=? ORDER BY p.created_at DESC LIMIT 50`,
    [agent.id]
  );
  const openClaim = payouts.find((p) => ['DRAFT', 'APPROVED'].includes(p.payout_status) && ['CLAIMED', 'PENDING'].includes(String(p.status || '').toUpperCase()));
  const notes = dbAll(
    `SELECT * FROM referral_notifications WHERE agent_id=? ORDER BY created_at DESC LIMIT 50`,
    [agent.id]
  );
  const unread = notes.filter((n) => !Number(n.is_read));
  const settings = getSettings();
  const resolved = resolveAgentCategory(agent, settings);
  const effectivePercent = resolveAgentCommissionPercent(agent, settings);
  return {
    agent: {
      id: agent.id,
      full_name: agent.full_name,
      status: agent.status,
      referral_code: agent.referral_code,
      referral_link: agent.referral_link || buildReferralLink(agent.referral_code),
      email: agent.email,
      phone: agent.phone,
      commission_percent: effectivePercent,
      commission_category_id: agent.commission_category_id,
      commission_category_mode: resolved.mode,
      category_name: resolved.category?.name || null,
      lifetime_sales: resolved.sales
    },
    bank: currentBank(agent.id, false),
    wallet,
    kpis: {
      customers_referred: customers,
      total_orders: orders,
      sales_generated: sales,
      total_commission: wallet.total_earned,
      pending_commission: wallet.pending,
      pending_delivery: wallet.pending_delivery,
      available_balance: wallet.available,
      claimed_balance: wallet.claimed,
      paid_to_date: wallet.paid,
      conversion_rate: conversion
    },
    recent_commissions: recentCombined,
    customers: referred,
    payouts,
    open_claim: openClaim || null,
    minimum_payout: settings.minimum_payout,
    minimum_payout_enabled: settings.minimum_payout_enabled !== false,
    notifications: notes,
    unread_notifications: unread,
    settings: {
      default_commission_percent: settings.default_commission_percent,
      minimum_payout: settings.minimum_payout,
      minimum_payout_enabled: settings.minimum_payout_enabled !== false,
      commission_categories: settings.commission_categories
    }
  };
}

function listAttributions(filters = {}, actor) {
  assertAdmin(actor);
  return dbAll(
    `SELECT attr.*, a.full_name AS agent_name, a.referral_code AS agent_code, cu.name AS customer_name, cu.phone AS customer_phone
     FROM referral_customer_attributions attr
     JOIN referral_agents a ON a.id=attr.agent_id
     LEFT JOIN customers cu ON cu.id=attr.customer_id
     ORDER BY attr.attributed_at DESC LIMIT 300`
  );
}

function listCodes(actor) {
  assertAdmin(actor);
  return dbAll(
    `SELECT c.*, a.full_name AS agent_name, a.status AS agent_status
     FROM referral_codes c JOIN referral_agents a ON a.id=c.agent_id
     ORDER BY c.created_at DESC LIMIT 300`
  );
}

function listAudit(filters = {}, actor) {
  assertAdmin(actor);
  return dbAll(`SELECT * FROM referral_audit_logs ORDER BY created_at DESC LIMIT 300`);
}

function listFraud(actor) {
  assertAdmin(actor);
  return {
    under_review: dbAll(`SELECT * FROM referral_commissions WHERE status='UNDER_REVIEW' ORDER BY created_at DESC LIMIT 100`),
    suspended_agents: dbAll(`SELECT id, full_name, phone, email, status, suspended_at FROM referral_agents WHERE status='SUSPENDED'`),
    notes: 'Self-referrals are blocked at attribution. Duplicate commissions are prevented by unique sale_id.'
  };
}

function requestBankChange(data = {}, actor) {
  const agent = agentByUser(actor);
  if (!agent) throw new Error('Agent profile required');
  const bank = data.bank || data;
  if (!text(bank.bank_name) || !text(bank.account_number) || !text(bank.branch_code) || !text(bank.account_holder)) {
    throw new Error('Complete bank details');
  }
  const old = currentBank(agent.id, true);
  const r = dbRun(
    `INSERT INTO referral_bank_change_requests (agent_id, old_bank_json, new_bank_json, status, requested_at)
     VALUES (?,?,?,'PENDING',?)`,
    [agent.id, JSON.stringify(old), JSON.stringify({
      bank_name: text(bank.bank_name),
      account_holder: text(bank.account_holder),
      account_number: text(bank.account_number),
      account_type: text(bank.account_type) || 'cheque',
      branch_code: text(bank.branch_code)
    }), now()]
  );
  audit('bank_change_requested', 'referral_bank_change', r.lastInsertRowid, old, bank, actor);
  notifyAdmins('Bank change request', `${agent.full_name} requested a bank details change`);
  return { success: true, id: r.lastInsertRowid, status: 'PENDING' };
}

function approveBankChange(id, actor) {
  assertAdmin(actor);
  const req = dbGet('SELECT * FROM referral_bank_change_requests WHERE id=?', [id]);
  if (!req || req.status !== 'PENDING') throw new Error('Request not found');
  const neu = JSON.parse(req.new_bank_json || '{}');
  dbRun(`UPDATE referral_bank_accounts SET is_current=0 WHERE agent_id=?`, [req.agent_id]);
  dbRun(
    `INSERT INTO referral_bank_accounts (agent_id, bank_name, account_holder, account_number, account_type, branch_code, is_current, status)
     VALUES (?,?,?,?,?,?,1,'ACTIVE')`,
    [req.agent_id, neu.bank_name, neu.account_holder, neu.account_number, neu.account_type || 'cheque', neu.branch_code]
  );
  dbRun(`UPDATE referral_bank_change_requests SET status='APPROVED', reviewed_at=?, reviewed_by=? WHERE id=?`,
    [now(), actor?.id || null, id]);
  audit('bank_change_approved', 'referral_bank_change', id, JSON.parse(req.old_bank_json || 'null'), neu, actor);
  notifyAgent(req.agent_id, 'Bank details updated', 'Your new bank details were approved.');
  return { success: true };
}

module.exports = {
  ensureSchema,
  getSettings,
  updateSettings,
  applyAsAgent,
  listApplications,
  getAgent,
  approveAgent,
  rejectAgent,
  setUnderReview,
  suspendAgent,
  unsuspendAgent,
  updateAgent,
  deleteAgent,
  awardManualCommission,
  listAwardRequests,
  getAwardRequest,
  decideAwardRequest,
  canDirectAward,
  searchReferralCodes,
  assertLinkedAgentMayLogin,
  ensureAgentUserAccount,
  syncApprovedAgentLogins,
  loginApprovedAgent,
  adminResetAgentPassword,
  listAgents,
  attributeCustomer,
  resolveAgentForCustomer,
  resolveCode,
  recordClick,
  validateReferralCode,
  processSale,
  confirmCommissionOnDelivery,
  reverseCommissionForSale,
  approveCommission,
  markCommissionsAvailable,
  listCommissions,
  getAgentWallet,
  generatePayoutBatch,
  getPayout,
  listPayouts,
  approvePayout,
  markPayoutPaid,
  claimWalletPayout,
  getAgentPayslip,
  buildAgentPayslipHtml,
  getAdminDashboard,
  getTopAgents,
  getAgentDashboard,
  listAttributions,
  listCodes,
  listAudit,
  listFraud,
  listUnreadNotifications,
  ackReferralNotification,
  ackAllReferralNotifications,
  requestBankChange,
  approveBankChange,
  buildReferralLink,
  maskAccount
};

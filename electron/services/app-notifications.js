/**
 * App Notifications, Promotions & Ratings — customer mobile channel backend.
 */
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { getDb } = require('../database/db');

const CATEGORIES = [
  'special_offers',
  'loyalty_rewards',
  'new_products',
  'branch_announcements',
  'order_updates'
];

const CATEGORY_PREF_COL = {
  special_offers: 'special_offers',
  loyalty_rewards: 'loyalty_rewards',
  new_products: 'new_products',
  branch_announcements: 'branch_announcements',
  order_updates: 'order_updates'
};

const DEFAULT_PREFS = {
  special_offers: 1,
  loyalty_rewards: 1,
  new_products: 1,
  branch_announcements: 1,
  order_updates: 1,
  os_permission: 0,
  prompt_shown: 0
};

let _schemaReady = false;
let _schedulerTimer = null;

function parseJson(v, fb) {
  if (v == null || v === '') return fb;
  try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return fb; }
}

function nowIso() {
  return new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

function dbRun(sql, params = []) {
  return getDb().prepare(sql).run(...params);
}
function dbGet(sql, params = []) {
  return getDb().prepare(sql).get(...params);
}
function dbAll(sql, params = []) {
  return getDb().prepare(sql).all(...params);
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function getAppSettings() {
  try {
    const row = dbGet('SELECT online_settings_json, settings_json FROM shop_settings WHERE id = 1') || {};
    const online = parseJson(row.online_settings_json, {});
    const extra = parseJson(row.settings_json, {});
    return {
      ...extra,
      ...online,
      push_api_url: online.push_api_url || extra.push_api_url || null
    };
  } catch {
    return {};
  }
}

function ensureSchema() {
  if (_schemaReady) return;
  try {
    const row = dbGet(`SELECT name FROM sqlite_master WHERE type='table' AND name='app_campaigns'`);
    if (!row) {
      const candidates = [
        path.join(__dirname, '../database/migrations-v134-app-notifications.sql'),
        path.join(__dirname, '../database/migrations-v134.sql')
      ];
      for (const mig of candidates) {
        if (fs.existsSync(mig)) {
          getDb().exec(fs.readFileSync(mig, 'utf8'));
          break;
        }
      }
    }
  } catch (_) { /* idempotent */ }
  _schemaReady = true;
  startScheduler();
}

function startScheduler() {
  if (_schedulerTimer) return;
  _schedulerTimer = setInterval(() => {
    try { processScheduledCampaigns(); } catch (_) { /* */ }
  }, 60 * 1000);
  if (_schedulerTimer.unref) _schedulerTimer.unref();
}

function resolveWebCustomer(token) {
  if (!token) return null;
  ensureSchema();
  const raw = String(token).trim();
  if (!raw) return null;
  const hash = hashToken(raw);
  const row = dbGet(
    `SELECT wc.* FROM web_customer_sessions s
     JOIN web_customers wc ON wc.id = s.web_customer_id
     WHERE s.token_hash = ? AND s.expires_at > ? AND wc.is_active = 1`,
    [hash, nowIso()]
  );
  if (!row) return null;
  const { password_hash, ...safe } = row;
  return safe;
}

function requireCustomer(token) {
  const wc = resolveWebCustomer(token);
  if (!wc) throw new Error('Invalid or expired session');
  return wc;
}

function canAuthorize(actor, action) {
  const role = String(actor?.role || '').toLowerCase();
  if (role === 'owner') return true;
  const viewOnly = ['getNotificationPrefs', 'listPromotions', 'listCampaigns', 'listReviews', 'getChannelDashboard', 'listAudit', 'getOverallRating', 'getCampaignAnalytics'];
  const draftOps = ['saveCampaign', 'savePromotion', 'previewCampaignAudience'];
  const managerOps = [...draftOps, 'scheduleCampaign', 'cancelCampaign', 'publishPromotion', 'replyToReview', 'resolveReviewReport'];
  const restricted = ['sendCampaign', 'moderateReview'];
  if (restricted.includes(action)) {
    if (['owner', 'manager'].includes(role)) return true;
    if (role.includes('marketing') && action === 'moderateReview') return true;
    throw new Error('Permission denied');
  }
  if (managerOps.includes(action)) {
    if (['manager', 'assistant_manager', 'supervisor'].includes(role) || role.includes('marketing')) return true;
    if (viewOnly.includes(action)) return true;
    throw new Error('Permission denied');
  }
  if (draftOps.includes(action)) {
    if (role.includes('marketing') || ['manager', 'assistant_manager', 'supervisor', 'cashier'].includes(role)) return true;
    throw new Error('Permission denied');
  }
  if (role === 'cashier') return viewOnly.includes(action);
  if (['manager', 'assistant_manager', 'supervisor'].includes(role)) return true;
  return viewOnly.includes(action);
}

function audit(actor, action, entityType, entityId, detail) {
  ensureSchema();
  try {
    dbRun(
      `INSERT INTO app_audit_log (actor_id, actor_name, action, entity_type, entity_id, detail_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        actor?.id || null,
        actor?.full_name || actor?.username || 'system',
        action,
        entityType || null,
        entityId != null ? Number(entityId) : null,
        detail != null ? JSON.stringify(detail) : null
      ]
    );
  } catch (_) { /* */ }
}

function listAudit(limit = 100) {
  ensureSchema();
  return dbAll('SELECT * FROM app_audit_log ORDER BY id DESC LIMIT ?', [Math.min(Number(limit) || 100, 500)]);
}

function prefsRowToObject(row) {
  if (!row) return { ...DEFAULT_PREFS };
  return {
    special_offers: row.special_offers != null ? !!row.special_offers : 1,
    loyalty_rewards: row.loyalty_rewards != null ? !!row.loyalty_rewards : 1,
    new_products: row.new_products != null ? !!row.new_products : 1,
    branch_announcements: row.branch_announcements != null ? !!row.branch_announcements : 1,
    order_updates: row.order_updates != null ? !!row.order_updates : 1,
    os_permission: row.os_permission != null ? !!row.os_permission : 0,
    prompt_shown: row.prompt_shown != null ? !!row.prompt_shown : 0,
    updated_at: row.updated_at
  };
}

function getOrCreatePrefs(webCustomerId, customerId, phone) {
  let row = dbGet('SELECT * FROM app_notification_prefs WHERE web_customer_id = ?', [webCustomerId]);
  if (!row) {
    dbRun(
      `INSERT INTO app_notification_prefs (web_customer_id, customer_id, phone, updated_at)
       VALUES (?, ?, ?, ?)`,
      [webCustomerId, customerId || null, phone || null, nowIso()]
    );
    row = dbGet('SELECT * FROM app_notification_prefs WHERE web_customer_id = ?', [webCustomerId]);
  }
  return row;
}

function registerDevice({ token, device_token, platform, device_name }) {
  ensureSchema();
  const wc = requireCustomer(token);
  const dt = String(device_token || '').trim();
  if (!dt) throw new Error('device_token required');
  const existing = dbGet('SELECT id FROM app_devices WHERE device_token = ?', [dt]);
  if (existing) {
    dbRun(
      `UPDATE app_devices SET web_customer_id = ?, customer_id = ?, platform = ?, device_name = ?,
       is_active = 1, last_seen_at = ?, updated_at = ? WHERE id = ?`,
      [wc.id, wc.customer_id || null, platform || 'web', device_name || null, nowIso(), nowIso(), existing.id]
    );
    return dbGet('SELECT * FROM app_devices WHERE id = ?', [existing.id]);
  }
  dbRun(
    `INSERT INTO app_devices (web_customer_id, customer_id, device_token, platform, device_name, is_active, last_seen_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    [wc.id, wc.customer_id || null, dt, platform || 'web', device_name || null, nowIso(), nowIso(), nowIso()]
  );
  const id = dbGet('SELECT id FROM app_devices ORDER BY id DESC LIMIT 1')?.id;
  return dbGet('SELECT * FROM app_devices WHERE id = ?', [id]);
}

function unregisterDevice({ token, device_token }) {
  ensureSchema();
  const wc = requireCustomer(token);
  const dt = String(device_token || '').trim();
  dbRun(
    'UPDATE app_devices SET is_active = 0, updated_at = ? WHERE device_token = ? AND web_customer_id = ?',
    [nowIso(), dt, wc.id]
  );
  return { ok: true };
}

function getNotificationPrefs(token) {
  ensureSchema();
  const wc = requireCustomer(token);
  const row = getOrCreatePrefs(wc.id, wc.customer_id, wc.phone);
  return prefsRowToObject(row);
}

function saveNotificationPrefs(token, prefs) {
  ensureSchema();
  const wc = requireCustomer(token);
  getOrCreatePrefs(wc.id, wc.customer_id, wc.phone);
  const p = prefs || {};
  dbRun(
    `UPDATE app_notification_prefs SET
      special_offers = ?, loyalty_rewards = ?, new_products = ?, branch_announcements = ?,
      order_updates = ?, os_permission = ?, prompt_shown = ?, updated_at = ?
     WHERE web_customer_id = ?`,
    [
      p.special_offers != null ? (p.special_offers ? 1 : 0) : 1,
      p.loyalty_rewards != null ? (p.loyalty_rewards ? 1 : 0) : 1,
      p.new_products != null ? (p.new_products ? 1 : 0) : 1,
      p.branch_announcements != null ? (p.branch_announcements ? 1 : 0) : 1,
      p.order_updates != null ? (p.order_updates ? 1 : 0) : 1,
      p.os_permission != null ? (p.os_permission ? 1 : 0) : 0,
      p.prompt_shown != null ? (p.prompt_shown ? 1 : 0) : 0,
      nowIso(),
      wc.id
    ]
  );
  return getNotificationPrefs(token);
}

function getInbox(token, { limit } = {}) {
  ensureSchema();
  const wc = requireCustomer(token);
  const lim = Math.min(Number(limit) || 50, 200);
  return dbAll(
    'SELECT * FROM app_inbox WHERE web_customer_id = ? ORDER BY datetime(created_at) DESC LIMIT ?',
    [wc.id, lim]
  );
}

function getUnreadCount(token) {
  ensureSchema();
  const wc = requireCustomer(token);
  const row = dbGet(
    'SELECT COUNT(*) AS c FROM app_inbox WHERE web_customer_id = ? AND read_at IS NULL',
    [wc.id]
  );
  return Number(row?.c || 0);
}

function bumpCampaignOpensForInbox(webCustomerId, inboxId, ts) {
  try {
    let rows = [];
    if (inboxId != null) {
      const msg = dbGet(
        'SELECT campaign_id FROM app_inbox WHERE id = ? AND web_customer_id = ?',
        [inboxId, webCustomerId]
      );
      if (msg?.campaign_id) rows = [{ campaign_id: msg.campaign_id }];
    } else {
      rows = dbAll(
        `SELECT DISTINCT campaign_id FROM app_inbox
         WHERE web_customer_id = ? AND read_at IS NULL AND campaign_id IS NOT NULL`,
        [webCustomerId]
      );
    }
    for (const row of rows) {
      const cid = row.campaign_id;
      if (!cid) continue;
      const delivery = dbGet(
        `SELECT id, opened_at FROM app_campaign_deliveries
         WHERE campaign_id = ? AND web_customer_id = ? ORDER BY id DESC LIMIT 1`,
        [cid, webCustomerId]
      );
      if (delivery && delivery.opened_at == null) {
        dbRun('UPDATE app_campaign_deliveries SET opened_at = ? WHERE id = ?', [ts, delivery.id]);
        dbRun('UPDATE app_campaigns SET opened_count = COALESCE(opened_count, 0) + 1 WHERE id = ?', [cid]);
      }
    }
  } catch (_) { /* */ }
}

function markInboxRead(token, id) {
  ensureSchema();
  const wc = requireCustomer(token);
  const ts = nowIso();
  if (id == null) {
    bumpCampaignOpensForInbox(wc.id, null, ts);
    dbRun('UPDATE app_inbox SET read_at = ? WHERE web_customer_id = ? AND read_at IS NULL', [ts, wc.id]);
  } else {
    bumpCampaignOpensForInbox(wc.id, id, ts);
    dbRun('UPDATE app_inbox SET read_at = ? WHERE id = ? AND web_customer_id = ?', [ts, id, wc.id]);
  }
  return { ok: true };
}

function markInboxClicked(token, id) {
  ensureSchema();
  const wc = requireCustomer(token);
  const ts = nowIso();
  dbRun(
    'UPDATE app_inbox SET clicked_at = ?, read_at = COALESCE(read_at, ?) WHERE id = ? AND web_customer_id = ?',
    [ts, ts, id, wc.id]
  );
  try {
    const msg = dbGet('SELECT campaign_id FROM app_inbox WHERE id = ?', [id]);
    if (msg?.campaign_id) {
      dbRun('UPDATE app_campaigns SET clicked_count = clicked_count + 1 WHERE id = ?', [msg.campaign_id]);
      dbRun(
        'UPDATE app_campaign_deliveries SET clicked_at = ? WHERE campaign_id = ? AND web_customer_id = ?',
        [ts, msg.campaign_id, wc.id]
      );
    }
  } catch (_) { /* */ }
  return { ok: true };
}

function listActivePromotions({ branch_id, placement } = {}) {
  ensureSchema();
  const now = nowIso();
  let sql = `SELECT * FROM app_promotions
    WHERE status IN ('published', 'active')
      AND COALESCE(show_in_promotions, 1) = 1
      AND (start_date IS NULL OR start_date <= ?)
      AND (end_date IS NULL OR end_date >= ?)`;
  const params = [now, now];
  const place = placement != null ? String(placement).toLowerCase() : '';
  if (place === 'home') sql += ' AND COALESCE(show_on_home, 0) = 1';
  else if (place === 'branch') sql += ' AND COALESCE(show_on_branch, 0) = 1';
  if (branch_id != null) {
    sql += ' AND (branch_id IS NULL OR branch_id = ? OR branch_ids_json LIKE ?)';
    params.push(Number(branch_id), `%${Number(branch_id)}%`);
  }
  sql += ' ORDER BY datetime(COALESCE(published_at, created_at)) DESC';
  return dbAll(sql, params);
}

function orderCompleted(orderId, saleId) {
  if (orderId) {
    try {
      const o = dbGet('SELECT status FROM online_orders_local WHERE id = ?', [orderId]);
      if (o && ['completed', 'delivered'].includes(String(o.status).toLowerCase())) return true;
    } catch (_) { /* */ }
  }
  if (saleId) {
    const s = dbGet('SELECT status FROM sales WHERE id = ?', [saleId]);
    if (s && String(s.status).toLowerCase() === 'completed') return true;
  }
  return false;
}

function submitReview(token, { order_id, sale_id, rating, liked, review_text, branch_id }) {
  ensureSchema();
  const wc = requireCustomer(token);
  const r = Number(rating);
  if (!r || r < 1 || r > 5) throw new Error('Rating must be 1–5');
  if (!orderCompleted(order_id, sale_id)) throw new Error('Order must be completed before reviewing');
  if (order_id) {
    const dup = dbGet(
      'SELECT id FROM app_reviews WHERE order_id = ? AND web_customer_id = ?',
      [order_id, wc.id]
    );
    if (dup) throw new Error('You already reviewed this order');
  }
  const name = [wc.first_name, wc.last_name].filter(Boolean).join(' ').trim() || 'Customer';
  dbRun(
    `INSERT INTO app_reviews (order_id, sale_id, web_customer_id, customer_id, customer_name, branch_id,
      rating, liked_json, review_text, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    [
      order_id || null,
      sale_id || null,
      wc.id,
      wc.customer_id || null,
      name,
      branch_id || null,
      r,
      liked != null ? JSON.stringify(liked) : null,
      review_text || null,
      nowIso(),
      nowIso()
    ]
  );
  const id = dbGet('SELECT id FROM app_reviews ORDER BY id DESC LIMIT 1')?.id;
  return dbGet('SELECT * FROM app_reviews WHERE id = ?', [id]);
}

function listMyReviews(token) {
  ensureSchema();
  const wc = requireCustomer(token);
  return dbAll('SELECT * FROM app_reviews WHERE web_customer_id = ? ORDER BY id DESC', [wc.id]);
}

function reportReview(token, review_id, reason) {
  ensureSchema();
  const wc = requireCustomer(token);
  const review = dbGet('SELECT * FROM app_reviews WHERE id = ?', [review_id]);
  if (!review) throw new Error('Review not found');
  dbRun(
    `INSERT INTO app_review_reports (review_id, reported_by_web_customer_id, reason, status, created_at)
     VALUES (?, ?, ?, 'open', datetime('now'))`,
    [review_id, wc.id, reason || null]
  );
  dbRun('UPDATE app_reviews SET report_count = COALESCE(report_count, 0) + 1, updated_at = ? WHERE id = ?', [nowIso(), review_id]);
  return { ok: true };
}

function distinctAppUserIds() {
  return dbAll(
    `SELECT DISTINCT web_customer_id AS id FROM app_devices
     WHERE is_active = 1 AND web_customer_id IS NOT NULL`
  ).map((r) => r.id).filter(Boolean);
}

function expandAudienceRaw(campaign) {
  let type = campaign.audience_type || 'all_app_users';
  const aud = parseJson(campaign.audience_json, {});
  if (type === 'recent') {
    type = 'ordered_period';
    if (aud.days == null && !aud.from && !aud.start_date) aud.days = 30;
  } else if (type === 'inactive') {
    type = 'not_ordered_recently';
    if (aud.days == null && aud.inactive_days == null) aud.inactive_days = 60;
  }
  let ids = [];

  if (type === 'all_app_users') {
    ids = distinctAppUserIds();
  } else if (type === 'custom') {
    ids = (aud.web_customer_ids || aud.ids || []).map(Number).filter(Boolean);
  } else if (type === 'branch') {
    const bid = campaign.branch_id || aud.branch_id;
    ids = distinctAppUserIds();
    if (bid) {
      const ordered = new Set();
      try {
        dbAll(
          'SELECT DISTINCT web_customer_id AS id FROM online_orders_local WHERE branch_id = ? AND web_customer_id IS NOT NULL',
          [bid]
        ).forEach((r) => { if (r.id) ordered.add(r.id); });
      } catch (_) { /* */ }
      ids = ids.filter((id) => ordered.has(id));
    }
  } else if (type === 'branches') {
    const branchIds = parseJson(campaign.branch_ids_json, aud.branch_ids || []);
    const set = new Set(branchIds.map(Number));
    ids = distinctAppUserIds();
    if (set.size) {
      const ordered = new Set();
      try {
        dbAll('SELECT DISTINCT web_customer_id AS id, branch_id FROM online_orders_local WHERE web_customer_id IS NOT NULL')
          .forEach((r) => { if (set.has(Number(r.branch_id))) ordered.add(r.id); });
      } catch (_) { /* */ }
      ids = ids.filter((id) => ordered.has(id));
    }
  } else if (type === 'loyalty') {
    const minPts = Number(aud.min_points) || 1;
    ids = dbAll(
      'SELECT id FROM web_customers WHERE is_active = 1 AND COALESCE(loyalty_points, 0) >= ?',
      [minPts]
    ).map((r) => r.id);
    ids = ids.filter((id) => distinctAppUserIds().includes(id));
  } else if (type === 'purchased_product') {
    const productId = Number(aud.product_id);
    const custIds = new Set();
    if (productId) {
      try {
        dbAll(
          `SELECT DISTINCT wc.id FROM web_customers wc
           JOIN customers c ON c.id = wc.customer_id
           JOIN sales s ON s.customer_id = c.id
           JOIN sale_items si ON si.sale_id = s.id AND si.product_id = ?
           WHERE wc.is_active = 1`,
          [productId]
        ).forEach((r) => custIds.add(r.id));
      } catch (_) { /* */ }
      try {
        dbAll(
          `SELECT DISTINCT o.web_customer_id AS id FROM online_orders_local o
           WHERE o.web_customer_id IS NOT NULL AND o.items_json LIKE ?`,
          [`%"product_id":${productId}%`]
        ).forEach((r) => { if (r.id) custIds.add(r.id); });
      } catch (_) { /* */ }
    }
    ids = [...custIds];
    ids = ids.filter((id) => distinctAppUserIds().includes(id));
  } else if (type === 'ordered_period') {
    const from = aud.from || aud.start_date;
    const to = aud.to || aud.end_date;
    const days = Number(aud.days) || null;
    const set = new Set();
    try {
      let sql = 'SELECT DISTINCT web_customer_id AS id FROM online_orders_local WHERE web_customer_id IS NOT NULL';
      const params = [];
      if (from) { sql += ' AND date(created_at) >= date(?)'; params.push(from); }
      else if (days) { sql += ` AND date(created_at) >= date('now', ?)`; params.push(`-${days} days`); }
      if (to) { sql += ' AND date(created_at) <= date(?)'; params.push(to); }
      dbAll(sql, params).forEach((r) => { if (r.id) set.add(r.id); });
    } catch (_) { /* */ }
    ids = [...set].filter((id) => distinctAppUserIds().includes(id));
  } else if (type === 'not_ordered_recently') {
    const days = Number(aud.days || aud.inactive_days) || 30;
    const recent = new Set();
    try {
      dbAll(
        `SELECT DISTINCT web_customer_id AS id FROM online_orders_local
         WHERE web_customer_id IS NOT NULL AND date(created_at) >= date('now', ?)`,
        [`-${days} days`]
      ).forEach((r) => { if (r.id) recent.add(r.id); });
    } catch (_) { /* */ }
    ids = distinctAppUserIds().filter((id) => !recent.has(id));
  } else if (type === 'segment') {
    ids = (aud.web_customer_ids || []).map(Number).filter(Boolean);
    if (!ids.length) ids = distinctAppUserIds();
  } else {
    ids = distinctAppUserIds();
  }

  return [...new Set(ids.map(Number).filter(Boolean))];
}

function analyzeAudiencePrefs(webCustomerIds, category) {
  const col = CATEGORY_PREF_COL[category] || 'special_offers';
  const eligible = [];
  const marketingExcluded = [];
  const permissionExcluded = [];
  const reasons = [];
  for (const wid of webCustomerIds) {
    const prefs = getOrCreatePrefs(wid);
    if (!prefs[col]) {
      marketingExcluded.push(wid);
      if (reasons.length < 8) reasons.push({ web_customer_id: wid, reason: 'category_disabled' });
      continue;
    }
    eligible.push(wid);
    if (!prefs.os_permission) {
      permissionExcluded.push(wid);
      if (reasons.length < 8) reasons.push({ web_customer_id: wid, reason: 'os_permission_off' });
    }
  }
  return {
    eligible,
    marketingExcluded,
    permissionExcluded,
    excluded: [...marketingExcluded],
    reasons
  };
}

function previewCampaignAudience(data) {
  ensureSchema();
  const campaign = {
    audience_type: data.audience_type || 'all_app_users',
    audience_json: typeof data.audience_json === 'string' ? data.audience_json : JSON.stringify(data.audience_json || {}),
    branch_id: data.branch_id,
    branch_ids_json: typeof data.branch_ids_json === 'string' ? data.branch_ids_json : JSON.stringify(data.branch_ids_json || []),
    category: data.category || 'special_offers'
  };
  const audience = expandAudienceRaw(campaign);
  const { eligible, marketingExcluded, permissionExcluded, excluded, reasons } = analyzeAudiencePrefs(
    audience,
    campaign.category
  );
  return {
    audience: audience.length,
    eligible: eligible.length,
    permission: permissionExcluded.length,
    marketing: marketingExcluded.length,
    excluded: excluded.length,
    reasons_sample: reasons
  };
}

function getChannelDashboard() {
  ensureSchema();
  const appUsers = dbGet(
    `SELECT COUNT(DISTINCT web_customer_id) AS c FROM app_devices WHERE is_active = 1 AND web_customer_id IS NOT NULL`
  )?.c || 0;
  const activeDevices = dbGet('SELECT COUNT(*) AS c FROM app_devices WHERE is_active = 1')?.c || 0;
  const notificationEnabled = dbGet(
    'SELECT COUNT(*) AS c FROM app_notification_prefs WHERE os_permission = 1'
  )?.c || 0;
  const marketingOn = dbGet(
    `SELECT COUNT(*) AS c FROM app_notification_prefs
     WHERE special_offers = 1 OR loyalty_rewards = 1 OR new_products = 1`
  )?.c || 0;
  const marketingOff = dbGet(
    `SELECT COUNT(*) AS c FROM app_notification_prefs
     WHERE special_offers = 0 AND loyalty_rewards = 0 AND new_products = 0
       AND branch_announcements = 0 AND order_updates = 0`
  )?.c || 0;
  const pendingReviews = dbGet("SELECT COUNT(*) AS c FROM app_reviews WHERE status = 'pending'")?.c || 0;
  const activePromotions = dbGet(
    "SELECT COUNT(*) AS c FROM app_promotions WHERE status IN ('published', 'active')"
  )?.c || 0;
  const scheduledCampaigns = dbGet(
    "SELECT COUNT(*) AS c FROM app_campaigns WHERE status IN ('scheduled', 'draft')"
  )?.c || 0;
  const mobileApp = activeDevices > 0 ? 'Connected' : 'Not connected';
  return {
    app_users: Number(appUsers),
    active_devices: Number(activeDevices),
    notification_enabled: Number(notificationEnabled),
    marketing_prefs_on: Number(marketingOn),
    marketing_prefs_off: Number(marketingOff),
    pending_reviews: Number(pendingReviews),
    active_promotions: Number(activePromotions),
    scheduled_campaigns: Number(scheduledCampaigns),
    channels: { mobile_app: mobileApp }
  };
}

function saveCampaign(data, actor) {
  ensureSchema();
  canAuthorize(actor, 'saveCampaign');
  const audJson = data.audience_json != null
    ? (typeof data.audience_json === 'string' ? data.audience_json : JSON.stringify(data.audience_json))
    : '{}';
  const branchIdsJson = data.branch_ids_json != null
    ? (typeof data.branch_ids_json === 'string' ? data.branch_ids_json : JSON.stringify(data.branch_ids_json))
    : null;
  const contentJson = data.content_json != null
    ? (typeof data.content_json === 'string' ? data.content_json : JSON.stringify(data.content_json))
    : null;

  if (data.id) {
    dbRun(
      `UPDATE app_campaigns SET name=?, title=?, body=?, image_url=?, button_text=?,
        destination_type=?, destination_id=?, destination_url=?, category=?,
        audience_type=?, audience_json=?, branch_id=?, branch_ids_json=?,
        promotion_id=?, status=COALESCE(?, status), scheduled_at=?, content_json=?, updated_at=?
       WHERE id=?`,
      [
        data.name, data.title, data.body, data.image_url || null, data.button_text || null,
        data.destination_type || 'home', data.destination_id || null, data.destination_url || null,
        data.category || 'special_offers', data.audience_type || 'all_app_users', audJson,
        data.branch_id || null, branchIdsJson, data.promotion_id || null,
        data.status || null, data.scheduled_at || null, contentJson, nowIso(), data.id
      ]
    );
    audit(actor, 'update_campaign', 'app_campaigns', data.id);
    return dbGet('SELECT * FROM app_campaigns WHERE id = ?', [data.id]);
  }

  dbRun(
    `INSERT INTO app_campaigns (name, title, body, image_url, button_text, destination_type, destination_id,
      destination_url, category, audience_type, audience_json, branch_id, branch_ids_json, promotion_id,
      status, scheduled_at, created_by, created_by_name, content_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.name || 'Campaign', data.title || '', data.body || '', data.image_url || null, data.button_text || null,
      data.destination_type || 'home', data.destination_id || null, data.destination_url || null,
      data.category || 'special_offers', data.audience_type || 'all_app_users', audJson,
      data.branch_id || null, branchIdsJson, data.promotion_id || null,
      data.status || 'draft', data.scheduled_at || null, actor?.id || null, actor?.full_name || null,
      contentJson, nowIso(), nowIso()
    ]
  );
  const id = dbGet('SELECT id FROM app_campaigns ORDER BY id DESC LIMIT 1')?.id;
  audit(actor, 'create_campaign', 'app_campaigns', id);
  return dbGet('SELECT * FROM app_campaigns WHERE id = ?', [id]);
}

function tryPushDelivery(payload) {
  const url = getAppSettings().push_api_url;
  if (!url) return;
  try {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? require('https') : require('http');
    const data = JSON.stringify(payload);
    const req = lib.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: `${u.pathname}${u.search}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, () => {});
    req.on('error', () => {});
    req.write(data);
    req.end();
  } catch (_) { /* never fail send */ }
}

function deliverCampaignToCustomer(campaign, webCustomerId, { allowPush = true } = {}) {
  const ts = nowIso();
  let deviceId = null;
  let deviceToken = null;
  const prefs = getOrCreatePrefs(webCustomerId);
  const device = dbGet(
    'SELECT id, device_token FROM app_devices WHERE web_customer_id = ? AND is_active = 1 ORDER BY datetime(last_seen_at) DESC LIMIT 1',
    [webCustomerId]
  );
  if (device) {
    deviceId = device.id;
    deviceToken = device.device_token;
  }

  dbRun(
    `INSERT INTO app_campaign_deliveries (campaign_id, web_customer_id, device_id, status, delivered_at, created_at)
     VALUES (?, ?, ?, 'delivered', ?, ?)`,
    [campaign.id, webCustomerId, deviceId, ts, ts]
  );

  dbRun(
    `INSERT INTO app_inbox (web_customer_id, campaign_id, category, title, body, image_url, button_text,
      destination_type, destination_id, destination_url, status, delivered_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sent', ?, ?)`,
    [
      webCustomerId, campaign.id, campaign.category || 'special_offers', campaign.title, campaign.body,
      campaign.image_url || null, campaign.button_text || null,
      campaign.destination_type || null, campaign.destination_id || null, campaign.destination_url || null,
      ts, ts
    ]
  );

  if (deviceToken && allowPush && prefs.os_permission) {
    tryPushDelivery({
      device_token: deviceToken,
      title: campaign.title,
      body: campaign.body,
      image_url: campaign.image_url,
      destination_type: campaign.destination_type,
      destination_id: campaign.destination_id,
      destination_url: campaign.destination_url,
      campaign_id: campaign.id
    });
  }
}

function sendCampaign(id, actor) {
  ensureSchema();
  canAuthorize(actor, 'sendCampaign');
  return sendCampaignInternal(id, actor);
}

function sendCampaignInternal(id, actor) {
  const campaign = dbGet('SELECT * FROM app_campaigns WHERE id = ?', [id]);
  if (!campaign) throw new Error('Campaign not found');
  if (campaign.status === 'sent') throw new Error('Campaign already sent');
  if (campaign.status === 'cancelled') throw new Error('Campaign cancelled');

  const audience = expandAudienceRaw(campaign);
  const { eligible, excluded } = analyzeAudiencePrefs(audience, campaign.category || 'special_offers');
  let delivered = 0;
  for (const wid of eligible) {
    try {
      deliverCampaignToCustomer(campaign, wid);
      delivered += 1;
    } catch (_) { /* continue */ }
  }

  const ts = nowIso();
  dbRun(
    `UPDATE app_campaigns SET status = 'sent', sent_at = ?, recipients_count = ?, eligible_count = ?,
      excluded_count = ?, delivered_count = ?, updated_at = ? WHERE id = ?`,
    [ts, audience.length, eligible.length, excluded.length, delivered, ts, id]
  );
  audit(actor, 'send_campaign', 'app_campaigns', id, {
    audience: audience.length,
    eligible: eligible.length,
    delivered
  });
  return dbGet('SELECT * FROM app_campaigns WHERE id = ?', [id]);
}

function scheduleCampaign(id, scheduled_at, actor) {
  ensureSchema();
  canAuthorize(actor, 'scheduleCampaign');
  dbRun(
    `UPDATE app_campaigns SET status = 'scheduled', scheduled_at = ?, updated_at = ? WHERE id = ?`,
    [scheduled_at, nowIso(), id]
  );
  audit(actor, 'schedule_campaign', 'app_campaigns', id, { scheduled_at });
  return dbGet('SELECT * FROM app_campaigns WHERE id = ?', [id]);
}

function cancelCampaign(id, actor) {
  ensureSchema();
  canAuthorize(actor, 'cancelCampaign');
  dbRun(
    `UPDATE app_campaigns SET status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE id = ?`,
    [nowIso(), nowIso(), id]
  );
  audit(actor, 'cancel_campaign', 'app_campaigns', id);
  return dbGet('SELECT * FROM app_campaigns WHERE id = ?', [id]);
}

function listCampaigns(filters = {}) {
  ensureSchema();
  let sql = 'SELECT * FROM app_campaigns WHERE 1=1';
  const params = [];
  if (filters.status) {
    sql += ' AND status = ?';
    params.push(filters.status);
  }
  sql += ' ORDER BY id DESC';
  return dbAll(sql, params);
}

function safeRate(num, den) {
  const n = Number(num) || 0;
  const d = Number(den) || 0;
  if (d <= 0) return 0;
  return Math.round((n / d) * 10000) / 10000;
}

function getCampaignAnalytics(id) {
  ensureSchema();
  const campaign = dbGet('SELECT * FROM app_campaigns WHERE id = ?', [id]);
  if (!campaign) throw new Error('Campaign not found');
  let deliveryStats = {};
  try {
    deliveryStats = dbGet(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) AS delivered,
         SUM(CASE WHEN opened_at IS NOT NULL THEN 1 ELSE 0 END) AS opened,
         SUM(CASE WHEN clicked_at IS NOT NULL THEN 1 ELSE 0 END) AS clicked
       FROM app_campaign_deliveries WHERE campaign_id = ?`,
      [id]
    ) || {};
  } catch (_) { /* */ }
  const delivered = Number(deliveryStats.delivered ?? campaign.delivered_count ?? 0);
  const openedLive = Number(deliveryStats.opened ?? 0);
  const clicked = Number(deliveryStats.clicked ?? campaign.clicked_count ?? 0);
  const opened = Math.max(Number(campaign.opened_count ?? 0), openedLive);
  const orders = Number(campaign.orders_count ?? 0);
  const revenue = Number(campaign.revenue_total ?? 0);
  const recipients = Number(campaign.recipients_count ?? campaign.eligible_count ?? deliveryStats.total ?? 0);
  const eligible = Number(campaign.eligible_count ?? delivered);
  return {
    campaign,
    deliveries: deliveryStats,
    inbox: dbGet('SELECT COUNT(*) AS c FROM app_inbox WHERE campaign_id = ?', [id])?.c || 0,
    opened_count: opened,
    orders_count: orders,
    revenue_total: revenue,
    delivery_rate: safeRate(delivered, recipients || eligible),
    open_rate: safeRate(opened, delivered),
    click_rate: safeRate(clicked, opened || delivered),
    conversion_rate: safeRate(orders, clicked || delivered)
  };
}

function processScheduledCampaigns() {
  ensureSchema();
  const due = dbAll(
    `SELECT id FROM app_campaigns WHERE status = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= ?`,
    [nowIso()]
  );
  const systemActor = { id: null, full_name: 'scheduler', role: 'owner' };
  for (const row of due) {
    try {
      sendCampaignInternal(row.id, systemActor);
    } catch (_) { /* */ }
  }
  return { processed: due.length };
}

function savePromotion(data, actor) {
  ensureSchema();
  canAuthorize(actor, 'savePromotion');
  const branchIdsJson = data.branch_ids_json != null
    ? (typeof data.branch_ids_json === 'string' ? data.branch_ids_json : JSON.stringify(data.branch_ids_json))
    : null;

  if (data.id) {
    dbRun(
      `UPDATE app_promotions SET name=?, product_id=?, product_name=?, price=?, description=?, image_url=?,
        branch_id=?, branch_ids_json=?, start_date=?, end_date=?, terms=?, button_text=?,
        destination_type=?, destination_id=?, destination_url=?, status=COALESCE(?, status),
        show_in_promotions=?, show_on_home=?, show_on_branch=?, send_push=?, add_to_inbox=?, updated_at=?
       WHERE id=?`,
      [
        data.name, data.product_id || null, data.product_name || null, data.price ?? null,
        data.description || null, data.image_url || null, data.branch_id || null, branchIdsJson,
        data.start_date || null, data.end_date || null, data.terms || null, data.button_text || 'ORDER NOW',
        data.destination_type || 'product', data.destination_id || null, data.destination_url || null,
        data.status || null,
        data.show_in_promotions != null ? (data.show_in_promotions ? 1 : 0) : 1,
        data.show_on_home != null ? (data.show_on_home ? 1 : 0) : 0,
        data.show_on_branch != null ? (data.show_on_branch ? 1 : 0) : 0,
        data.send_push != null ? (data.send_push ? 1 : 0) : 0,
        data.add_to_inbox != null ? (data.add_to_inbox ? 1 : 0) : 1,
        nowIso(), data.id
      ]
    );
    audit(actor, 'update_promotion', 'app_promotions', data.id);
    return dbGet('SELECT * FROM app_promotions WHERE id = ?', [data.id]);
  }

  dbRun(
    `INSERT INTO app_promotions (name, product_id, product_name, price, description, image_url, branch_id,
      branch_ids_json, start_date, end_date, terms, button_text, destination_type, destination_id, destination_url,
      status, show_in_promotions, show_on_home, show_on_branch, send_push, add_to_inbox, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.name || 'Promotion', data.product_id || null, data.product_name || null, data.price ?? null,
      data.description || null, data.image_url || null, data.branch_id || null, branchIdsJson,
      data.start_date || null, data.end_date || null, data.terms || null, data.button_text || 'ORDER NOW',
      data.destination_type || 'product', data.destination_id || null, data.destination_url || null,
      data.status || 'draft',
      data.show_in_promotions != null ? (data.show_in_promotions ? 1 : 0) : 1,
      data.show_on_home != null ? (data.show_on_home ? 1 : 0) : 0,
      data.show_on_branch != null ? (data.show_on_branch ? 1 : 0) : 0,
      data.send_push != null ? (data.send_push ? 1 : 0) : 0,
      data.add_to_inbox != null ? (data.add_to_inbox ? 1 : 0) : 1,
      actor?.id || null, nowIso(), nowIso()
    ]
  );
  const id = dbGet('SELECT id FROM app_promotions ORDER BY id DESC LIMIT 1')?.id;
  audit(actor, 'create_promotion', 'app_promotions', id);
  return dbGet('SELECT * FROM app_promotions WHERE id = ?', [id]);
}

function publishPromotion(id, options = {}, actor) {
  ensureSchema();
  canAuthorize(actor, 'publishPromotion');
  const promo = dbGet('SELECT * FROM app_promotions WHERE id = ?', [id]);
  if (!promo) throw new Error('Promotion not found');

  const opts = options || {};
  dbRun(
    `UPDATE app_promotions SET status = 'published', published_at = ?,
      show_in_promotions = ?, show_on_home = ?, show_on_branch = ?, send_push = ?, add_to_inbox = ?, updated_at = ?
     WHERE id = ?`,
    [
      nowIso(),
      opts.show_in_promotions != null ? (opts.show_in_promotions ? 1 : 0) : promo.show_in_promotions,
      opts.show_on_home != null ? (opts.show_on_home ? 1 : 0) : promo.show_on_home,
      opts.show_on_branch != null ? (opts.show_on_branch ? 1 : 0) : promo.show_on_branch,
      opts.send_push != null ? (opts.send_push ? 1 : 0) : promo.send_push,
      opts.add_to_inbox != null ? (opts.add_to_inbox ? 1 : 0) : promo.add_to_inbox,
      nowIso(),
      id
    ]
  );
  const updated = dbGet('SELECT * FROM app_promotions WHERE id = ?', [id]);

  if (opts.send_push || updated.send_push) {
    const campaign = saveCampaign({
      name: `Promo: ${updated.name}`,
      title: updated.name,
      body: updated.description || updated.name,
      image_url: updated.image_url,
      button_text: updated.button_text,
      destination_type: updated.destination_type,
      destination_id: updated.destination_id,
      destination_url: updated.destination_url,
      category: 'special_offers',
      audience_type: 'all_app_users',
      promotion_id: id,
      status: 'draft'
    }, actor);
    sendCampaignInternal(campaign.id, actor);
  } else if (opts.add_to_inbox || updated.add_to_inbox) {
    const audience = distinctAppUserIds();
    const { eligible } = analyzeAudiencePrefs(audience, 'special_offers');
    for (const wid of eligible) {
      try {
        dbRun(
          `INSERT INTO app_inbox (web_customer_id, promotion_id, category, title, body, image_url, button_text,
            destination_type, destination_id, destination_url, status, delivered_at, created_at)
           VALUES (?, ?, 'special_offers', ?, ?, ?, ?, ?, ?, ?, 'sent', ?, ?)`,
          [
            wid, id, updated.name, updated.description || null, updated.image_url || null,
            updated.button_text || null, updated.destination_type, updated.destination_id,
            updated.destination_url, nowIso(), nowIso()
          ]
        );
      } catch (_) { /* */ }
    }
  }

  audit(actor, 'publish_promotion', 'app_promotions', id, opts);
  return updated;
}

function listPromotions(filters = {}) {
  ensureSchema();
  let sql = 'SELECT * FROM app_promotions WHERE 1=1';
  const params = [];
  if (filters.status) { sql += ' AND status = ?'; params.push(filters.status); }
  if (filters.branch_id != null) {
    sql += ' AND (branch_id IS NULL OR branch_id = ?)';
    params.push(Number(filters.branch_id));
  }
  sql += ' ORDER BY id DESC';
  return dbAll(sql, params);
}

function listReviews(filters = {}) {
  ensureSchema();
  let sql = 'SELECT * FROM app_reviews WHERE 1=1';
  const params = [];
  if (filters.status) { sql += ' AND status = ?'; params.push(filters.status); }
  sql += ' ORDER BY id DESC';
  return dbAll(sql, params);
}

function moderateReview(id, action, actor, reason) {
  ensureSchema();
  canAuthorize(actor, 'moderateReview');
  const review = dbGet('SELECT * FROM app_reviews WHERE id = ?', [id]);
  if (!review) throw new Error('Review not found');
  const act = String(action || '').toLowerCase();
  let status = review.status;
  if (act === 'approve') status = 'approved';
  else if (act === 'hide') status = 'hidden';
  else if (act === 'report') status = 'reported';
  else throw new Error('Invalid moderation action');
  dbRun(
    `UPDATE app_reviews SET status = ?, moderation_reason = ?, moderated_by = ?, moderated_at = ?, updated_at = ? WHERE id = ?`,
    [status, reason || null, actor?.id || null, nowIso(), nowIso(), id]
  );
  audit(actor, 'moderate_review', 'app_reviews', id, { action: act, reason });
  return dbGet('SELECT * FROM app_reviews WHERE id = ?', [id]);
}

function replyToReview(id, reply, actor) {
  ensureSchema();
  canAuthorize(actor, 'replyToReview');
  dbRun(
    `UPDATE app_reviews SET admin_reply = ?, admin_reply_by = ?, admin_reply_at = ?, updated_at = ? WHERE id = ?`,
    [reply || null, actor?.id || null, nowIso(), nowIso(), id]
  );
  audit(actor, 'reply_review', 'app_reviews', id);
  return dbGet('SELECT * FROM app_reviews WHERE id = ?', [id]);
}

function resolveReviewReport(reportId, resolution, actor) {
  ensureSchema();
  canAuthorize(actor, 'resolveReviewReport');
  dbRun(
    `UPDATE app_review_reports SET status = 'resolved', resolution_note = ?, resolved_by = ?, resolved_at = ? WHERE id = ?`,
    [resolution || null, actor?.id || null, nowIso(), reportId]
  );
  audit(actor, 'resolve_review_report', 'app_review_reports', reportId, { resolution });
  return dbGet('SELECT * FROM app_review_reports WHERE id = ?', [reportId]);
}

function getOverallRating() {
  ensureSchema();
  const row = dbGet(
    `SELECT AVG(rating) AS avg_rating, COUNT(*) AS count FROM app_reviews WHERE status = 'approved'`
  );
  return {
    average: row?.avg_rating != null ? Math.round(Number(row.avg_rating) * 10) / 10 : null,
    count: Number(row?.count || 0)
  };
}

function listPublicReviews(limit = 10) {
  ensureSchema();
  const lim = Math.min(Number(limit) || 10, 50);
  return dbAll(
    `SELECT id, customer_name, rating, review_text, admin_reply, created_at
     FROM app_reviews WHERE status = 'approved' ORDER BY id DESC LIMIT ?`,
    [lim]
  );
}

module.exports = {
  CATEGORIES,
  ensureSchema,
  resolveWebCustomer,
  registerDevice,
  unregisterDevice,
  getNotificationPrefs,
  saveNotificationPrefs,
  getInbox,
  getUnreadCount,
  markInboxRead,
  markInboxClicked,
  listActivePromotions,
  submitReview,
  listMyReviews,
  reportReview,
  getChannelDashboard,
  previewCampaignAudience,
  saveCampaign,
  sendCampaign,
  scheduleCampaign,
  cancelCampaign,
  listCampaigns,
  getCampaignAnalytics,
  processScheduledCampaigns,
  savePromotion,
  publishPromotion,
  listPromotions,
  listReviews,
  moderateReview,
  replyToReview,
  resolveReviewReport,
  getOverallRating,
  listPublicReviews,
  listAudit,
  audit,
  canAuthorize
};

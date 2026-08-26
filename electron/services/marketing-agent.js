/**
 * Marketing Agent System — offline-first CRM, tasks, campaigns, menus, sync queue.
 * Reads products from POS; does not mutate product catalog by default.
 */
const crypto = require('crypto');
const { getDb } = require('../database/db');
const session = require('./session');
const { assertUserActor } = require('./authz');

function uid() {
  return `mkt_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

function today() {
  return new Date().toLocaleDateString('en-CA');
}

function parseJson(v, fallback) {
  if (v == null || v === '') return fallback;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return fallback; }
}

function money(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function requireMarketingAdmin(actor) {
  return assertUserActor(actor || session.getUserSession(), ['owner', 'manager']);
}

function requireAgentOrAdmin(actor) {
  const sess = session.getUserSession();
  const a = actor || sess;
  if (!a?.id) throw new Error('Authentication required');
  const user = getDb().prepare('SELECT * FROM users WHERE id = ?').get(a.id);
  if (!user || !user.is_active) throw new Error('Authentication required');
  if (['owner', 'manager'].includes(user.role)) return { ...user, isAdmin: true };
  if (user.role === 'marketing_agent') {
    const agent = getAgentByUserId(user.id);
    if (!agent || agent.status !== 'active') throw new Error('Marketing agent access revoked');
    return { ...user, isAdmin: false, agent };
  }
  throw new Error('You do not have permission for this action');
}

function audit(actor, action, entityType, entityId, details) {
  try {
    getDb().prepare(`
      INSERT INTO marketing_audit_log (user_id, username, agent_id, action, entity_type, entity_id, details_json, device_id)
      VALUES (?,?,?,?,?,?,?,?)`).run(
      actor?.id || null, actor?.username || actor?.full_name || null,
      actor?.agent?.id || null, action, entityType || null, entityId || null,
      JSON.stringify(details || {}), actor?.device_id || null
    );
  } catch (_) { /* ignore */ }
}

function notify(userId, agentId, title, body, kind = 'info') {
  getDb().prepare(`
    INSERT INTO marketing_notifications (user_id, agent_id, title, body, kind)
    VALUES (?,?,?,?,?)`).run(userId || null, agentId || null, title, body || null, kind);
}

function enqueueSync(entityType, entityUid, payload, op = 'upsert') {
  getDb().prepare(`
    INSERT INTO marketing_sync_queue (entity_type, entity_uid, payload_json, op, status)
    VALUES (?,?,?,?, 'pending')`).run(entityType, entityUid, JSON.stringify(payload || {}), op);
}

function genReferralCode(userId, name) {
  const base = String(name || 'AGT').replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase() || 'AGT';
  return `${base}${String(userId).padStart(3, '0')}${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

function getAgentByUserId(userId) {
  return getDb().prepare(`
    SELECT a.*, u.full_name, u.username, u.is_active as user_active, u.role
    FROM marketing_agents a JOIN users u ON u.id = a.user_id WHERE a.user_id = ?`).get(userId);
}

function getAgent(id) {
  return getDb().prepare(`
    SELECT a.*, u.full_name, u.username, u.is_active as user_active, u.role
    FROM marketing_agents a JOIN users u ON u.id = a.user_id WHERE a.id = ?`).get(id);
}

function listAgents(filters = {}) {
  let sql = `
    SELECT a.*, u.full_name, u.username, u.is_active as user_active, u.role,
      (SELECT COUNT(*) FROM marketing_customers c WHERE c.agent_id = a.id) as customers_recruited,
      (SELECT COUNT(*) FROM marketing_tasks t WHERE t.agent_id = a.id AND t.status = 'completed') as tasks_completed
    FROM marketing_agents a JOIN users u ON u.id = a.user_id WHERE 1=1`;
  const params = [];
  if (filters.status) { sql += ' AND a.status = ?'; params.push(filters.status); }
  if (filters.branch_id != null) { sql += ' AND a.branch_id = ?'; params.push(filters.branch_id); }
  sql += ' ORDER BY u.full_name';
  return getDb().prepare(sql).all(...params).map(a => ({
    ...a,
    permissions: parseJson(a.permissions_json, {}),
    targets: parseJson(a.targets_json, {})
  }));
}

function ensureAgentForUser(userId, data = {}, actor) {
  const admin = requireMarketingAdmin(actor);
  const user = getDb().prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) throw new Error('User not found');
  if (user.role !== 'marketing_agent') {
    getDb().prepare(`UPDATE users SET role = 'marketing_agent', updated_at = datetime('now') WHERE id = ?`).run(userId);
  }
  let agent = getAgentByUserId(userId);
  if (!agent) {
    const code = data.referral_code || genReferralCode(userId, user.full_name);
    const r = getDb().prepare(`
      INSERT INTO marketing_agents (user_id, branch_id, referral_code, status, permissions_json, targets_json, notes, created_by)
      VALUES (?,?,?,?,?,?,?,?)`).run(
      userId, data.branch_id || null, code, data.status || 'active',
      JSON.stringify(data.permissions || {}), JSON.stringify(data.targets || defaultTargets()),
      data.notes || null, admin.id
    );
    agent = getAgent(r.lastInsertRowid);
    audit(admin, 'create_marketing_agent', 'marketing_agent', agent.id, { user_id: userId });
  } else {
    getDb().prepare(`
      UPDATE marketing_agents SET branch_id=?, status=?, permissions_json=?, targets_json=?, notes=?, updated_at=datetime('now')
      WHERE id=?`).run(
      data.branch_id != null ? data.branch_id : agent.branch_id,
      data.status || agent.status,
      JSON.stringify(data.permissions || parseJson(agent.permissions_json, {})),
      JSON.stringify(data.targets || parseJson(agent.targets_json, defaultTargets())),
      data.notes != null ? data.notes : agent.notes,
      agent.id
    );
    agent = getAgent(agent.id);
    audit(admin, 'update_marketing_agent', 'marketing_agent', agent.id, data);
  }
  return { ...agent, permissions: parseJson(agent.permissions_json, {}), targets: parseJson(agent.targets_json, {}) };
}

function defaultTargets() {
  return {
    customers_recruit_month: 100,
    customers_recruit_week: 25,
    campaigns_month: 4,
    flyers_month: 8,
    menus_month: 2,
    referrals_month: 20,
    tasks_week: 10
  };
}

function setAgentStatus(agentId, status, actor) {
  const admin = requireMarketingAdmin(actor);
  if (!['active', 'inactive', 'revoked'].includes(status)) throw new Error('Invalid status');
  getDb().prepare(`UPDATE marketing_agents SET status=?, updated_at=datetime('now') WHERE id=?`).run(status, agentId);
  if (status !== 'active') {
    getDb().prepare(`UPDATE marketing_access_tokens SET revoked_at=datetime('now') WHERE agent_id=? AND revoked_at IS NULL`).run(agentId);
  }
  audit(admin, 'set_agent_status', 'marketing_agent', agentId, { status });
  return getAgent(agentId);
}

function issueAccessToken(agentId, hours, actor, deviceId) {
  const admin = requireMarketingAdmin(actor);
  const agent = getAgent(agentId);
  if (!agent) throw new Error('Agent not found');
  const raw = crypto.randomBytes(24).toString('hex');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const expires = new Date(Date.now() + Math.max(1, Number(hours) || 24) * 3600 * 1000).toISOString();
  getDb().prepare(`
    INSERT INTO marketing_access_tokens (agent_id, token_hash, expires_at, device_id, created_by)
    VALUES (?,?,?,?,?)`).run(agentId, hash, expires, deviceId || null, admin.id);
  audit(admin, 'issue_access_token', 'marketing_agent', agentId, { expires, deviceId });
  return { token: raw, expires_at: expires, agent_id: agentId };
}

function revokeAccessToken(tokenId, actor) {
  const admin = requireMarketingAdmin(actor);
  getDb().prepare(`UPDATE marketing_access_tokens SET revoked_at=datetime('now') WHERE id=?`).run(tokenId);
  audit(admin, 'revoke_access_token', 'marketing_access_token', tokenId, {});
  return true;
}

function listAccessTokens(agentId, actor) {
  requireMarketingAdmin(actor);
  let sql = `SELECT id, agent_id, expires_at, revoked_at, device_id, created_at, created_by
    FROM marketing_access_tokens WHERE 1=1`;
  const params = [];
  if (agentId != null) { sql += ' AND agent_id = ?'; params.push(agentId); }
  sql += ' ORDER BY created_at DESC LIMIT 100';
  return getDb().prepare(sql).all(...params);
}

/** Redeem temporary agent token → session user (device-aware when device_id set) */
function loginWithAccessToken(rawToken, deviceId) {
  if (!rawToken || String(rawToken).trim().length < 16) throw new Error('Invalid token');
  const hash = crypto.createHash('sha256').update(String(rawToken).trim()).digest('hex');
  const row = getDb().prepare(`
    SELECT t.*, a.user_id, a.status as agent_status
    FROM marketing_access_tokens t
    JOIN marketing_agents a ON a.id = t.agent_id
    WHERE t.token_hash = ?`).get(hash);
  if (!row) throw new Error('Invalid or unknown token');
  if (row.revoked_at) throw new Error('Token revoked');
  if (row.agent_status !== 'active') throw new Error('Agent access revoked');
  if (new Date(row.expires_at).getTime() < Date.now()) throw new Error('Token expired');
  if (row.device_id && deviceId && row.device_id !== deviceId) {
    throw new Error('Token is bound to a different device');
  }
  if (row.device_id && !deviceId) {
    throw new Error('This token requires the assigned device');
  }
  if (!row.device_id && deviceId) {
    getDb().prepare(`UPDATE marketing_access_tokens SET device_id=? WHERE id=? AND device_id IS NULL`)
      .run(deviceId, row.id);
  }
  const user = getDb().prepare('SELECT * FROM users WHERE id = ?').get(row.user_id);
  if (!user || !user.is_active) throw new Error('Agent user inactive');
  const { password_hash, pin: _pin, ...safe } = user;
  session.setUserSession(safe);
  session.clearEmployeeSession();
  touchAgent(row.agent_id);
  audit({ id: user.id, username: user.username, agent: { id: row.agent_id }, device_id: deviceId },
    'token_login', 'marketing_access_token', row.id, { deviceId });
  return { user: safe, token_id: row.id, expires_at: row.expires_at };
}

function touchAgent(agentId) {
  getDb().prepare(`UPDATE marketing_agents SET last_activity_at=datetime('now') WHERE id=?`).run(agentId);
}

function agentDashboard(actor) {
  const user = requireAgentOrAdmin(actor);
  let agent = user.isAdmin && !user.agent ? null : (user.agent || getAgentByUserId(user.id));
  if (!agent && !user.isAdmin && user.role === 'marketing_agent') {
    const code = genReferralCode(user.id, user.full_name);
    const r = getDb().prepare(`
      INSERT INTO marketing_agents (user_id, referral_code, status, permissions_json, targets_json, created_by)
      VALUES (?,?, 'active', '{}', ?, ?)`).run(user.id, code, JSON.stringify(defaultTargets()), user.id);
    agent = getAgent(r.lastInsertRowid);
  }
  if (!agent && !user.isAdmin) throw new Error('Marketing agent profile missing — ask Admin to assign you');
  const agentId = agent?.id;
  const targets = parseJson(agent?.targets_json, defaultTargets());
  const monthStart = new Date();
  monthStart.setDate(1);
  const from = monthStart.toLocaleDateString('en-CA');
  const weekStart = (() => {
    const d = new Date();
    d.setDate(d.getDate() - d.getDay());
    return d.toLocaleDateString('en-CA');
  })();

  const count = (sql, ...p) => Number(getDb().prepare(sql).get(...p)?.c || 0);

  const customersMonth = agentId ? count(
    `SELECT COUNT(*) as c FROM marketing_customers WHERE agent_id=? AND date(created_at) >= date(?)`, agentId, from
  ) : 0;
  const customersWeek = agentId ? count(
    `SELECT COUNT(*) as c FROM marketing_customers WHERE agent_id=? AND date(created_at) >= date(?)`, agentId, weekStart
  ) : 0;
  const converted = agentId ? count(
    `SELECT COUNT(*) as c FROM marketing_customers WHERE agent_id=? AND conversion_status='converted'`, agentId
  ) : 0;
  const referrals = agentId ? count(`SELECT COUNT(*) as c FROM marketing_referrals WHERE agent_id=?`, agentId) : 0;
  const flyers = agentId ? count(
    `SELECT COUNT(*) as c FROM promotion_flyers WHERE created_by=? AND date(created_at) >= date(?)`, user.id, from
  ) : 0;
  const menus = agentId ? count(
    `SELECT COUNT(*) as c FROM marketing_menus WHERE agent_id=? AND date(created_at) >= date(?)`, agentId, from
  ) : 0;
  const campaigns = agentId ? count(
    `SELECT COUNT(*) as c FROM marketing_campaigns WHERE agent_id=? AND date(created_at) >= date(?)`, agentId, from
  ) : 0;
  const tasksOpen = agentId ? count(
    `SELECT COUNT(*) as c FROM marketing_tasks WHERE agent_id=? AND status IN ('not_started','in_progress')`, agentId
  ) : 0;
  const tasksDone = agentId ? count(
    `SELECT COUNT(*) as c FROM marketing_tasks WHERE agent_id=? AND status='completed' AND date(updated_at) >= date(?)`, agentId, weekStart
  ) : 0;
  const pendingApprovals = agentId ? count(
    `SELECT COUNT(*) as c FROM marketing_menus WHERE agent_id=? AND approval_status='pending'`
    , agentId
  ) + count(
    `SELECT COUNT(*) as c FROM promotion_flyers WHERE created_by=? AND approval_status='pending'`, user.id
  ) : 0;
  const messages = agentId ? count(
    `SELECT COUNT(*) as c FROM marketing_messages WHERE agent_id=? AND date(created_at) >= date(?)`, agentId, from
  ) : 0;
  const revenue = agentId ? money(getDb().prepare(
    `SELECT COALESCE(SUM(revenue),0) as t FROM marketing_referrals WHERE agent_id=?`
  ).get(agentId)?.t) : 0;

  const pct = (actual, target) => {
    const t = Number(target) || 0;
    if (!t) return 0;
    return Math.round((Number(actual) / t) * 1000) / 10;
  };

  const kpis = [
    { key: 'customers_month', label: 'Customers to recruit (month)', target: targets.customers_recruit_month, actual: customersMonth },
    { key: 'customers_week', label: 'Customers to recruit (week)', target: targets.customers_recruit_week, actual: customersWeek },
    { key: 'campaigns', label: 'Campaigns (month)', target: targets.campaigns_month, actual: campaigns },
    { key: 'flyers', label: 'Flyers (month)', target: targets.flyers_month, actual: flyers },
    { key: 'menus', label: 'Menus (month)', target: targets.menus_month, actual: menus },
    { key: 'referrals', label: 'Referrals (month)', target: targets.referrals_month, actual: referrals },
    { key: 'tasks', label: 'Tasks completed (week)', target: targets.tasks_week, actual: tasksDone }
  ].map(k => ({ ...k, achievement: pct(k.actual, k.target) }));

  if (agentId) touchAgent(agentId);

  return {
    agent: agent ? { ...agent, targets, permissions: parseJson(agent.permissions_json, {}) } : null,
    kpis,
    summary: {
      customers_recruited: customersMonth,
      customers_converted: converted,
      conversion_rate: customersMonth ? Math.round((converted / Math.max(1, count(
        `SELECT COUNT(*) as c FROM marketing_customers WHERE agent_id=?`, agentId
      ))) * 1000) / 10 : 0,
      referrals,
      attributed_sales: revenue,
      campaigns,
      flyers,
      menus,
      messages,
      tasks_open: tasksOpen,
      pending_approvals: pendingApprovals
    },
    today_tasks: agentId ? listTasks({ agent_id: agentId, status_in: ['not_started', 'in_progress'] }).slice(0, 8) : [],
    sync: getSyncStatus()
  };
}

function adminMarketingSummary(filters = {}, actor) {
  requireMarketingAdmin(actor);
  const db = getDb();
  const from = filters.from || today();
  const to = filters.to || today();
  return {
    active_agents: Number(db.prepare(`SELECT COUNT(*) as c FROM marketing_agents WHERE status='active'`).get()?.c || 0),
    customers_recruited: Number(db.prepare(
      `SELECT COUNT(*) as c FROM marketing_customers WHERE date(created_at) BETWEEN date(?) AND date(?)`
    ).get(from, to)?.c || 0),
    active_campaigns: Number(db.prepare(
      `SELECT COUNT(*) as c FROM marketing_campaigns WHERE status IN ('approved','active')`
    ).get()?.c || 0),
    tasks_completed: Number(db.prepare(
      `SELECT COUNT(*) as c FROM marketing_tasks WHERE status='completed' AND date(updated_at) BETWEEN date(?) AND date(?)`
    ).get(from, to)?.c || 0),
    referrals: Number(db.prepare(
      `SELECT COUNT(*) as c FROM marketing_referrals WHERE date(created_at) BETWEEN date(?) AND date(?)`
    ).get(from, to)?.c || 0),
    attributed_sales: money(db.prepare(
      `SELECT COALESCE(SUM(revenue),0) as t FROM marketing_referrals WHERE date(updated_at) BETWEEN date(?) AND date(?)`
    ).get(from, to)?.t),
    pending_approvals: Number(db.prepare(
      `SELECT COUNT(*) as c FROM marketing_menus WHERE approval_status='pending'`
    ).get()?.c || 0) + Number(db.prepare(
      `SELECT COUNT(*) as c FROM promotion_flyers WHERE approval_status='pending'`
    ).get()?.c || 0),
    agents: listAgents(filters),
    pending_designs: listPendingDesigns()
  };
}

function listPendingDesigns() {
  const menus = getDb().prepare(`
    SELECT id, title as name, 'menu' as design_type, approval_status, agent_id, created_at, submitted_at
    FROM marketing_menus WHERE approval_status='pending' ORDER BY submitted_at DESC`).all();
  const flyers = getDb().prepare(`
    SELECT id, title as name, 'flyer' as design_type, approval_status, created_by, created_at, submitted_at
    FROM promotion_flyers WHERE approval_status='pending' ORDER BY submitted_at DESC`).all();
  return [...menus, ...flyers];
}

/* ─── Tasks ─── */
function listTasks(filters = {}) {
  let sql = `SELECT t.*, a.user_id, u.full_name as agent_name FROM marketing_tasks t
    LEFT JOIN marketing_agents a ON a.id = t.agent_id
    LEFT JOIN users u ON u.id = a.user_id WHERE 1=1`;
  const params = [];
  if (filters.agent_id != null) { sql += ' AND t.agent_id = ?'; params.push(filters.agent_id); }
  if (filters.status) { sql += ' AND t.status = ?'; params.push(filters.status); }
  if (filters.status_in?.length) {
    sql += ` AND t.status IN (${filters.status_in.map(() => '?').join(',')})`;
    params.push(...filters.status_in);
  }
  sql += ' ORDER BY t.due_date IS NULL, t.due_date, t.created_at DESC';
  return getDb().prepare(sql).all(...params);
}

function saveTask(data, actor) {
  const user = requireAgentOrAdmin(actor);
  const db = getDb();
  if (data.id) {
    const row = db.prepare('SELECT * FROM marketing_tasks WHERE id=?').get(data.id);
    if (!row) throw new Error('Task not found');
    if (!user.isAdmin && row.agent_id !== user.agent?.id) throw new Error('Not your task');
    const status = data.status || row.status;
    db.prepare(`
      UPDATE marketing_tasks SET title=?, description=?, task_type=?, target_value=?, actual_value=?, status=?,
        due_date=?, completed_at=?, updated_at=datetime('now'), sync_status='pending'
      WHERE id=?`).run(
      data.title || row.title, data.description != null ? data.description : row.description,
      data.task_type || row.task_type, data.target_value != null ? data.target_value : row.target_value,
      data.actual_value != null ? data.actual_value : row.actual_value, status,
      data.due_date != null ? data.due_date : row.due_date,
      status === 'completed' ? (row.completed_at || new Date().toISOString()) : null,
      data.id
    );
    const updated = db.prepare('SELECT * FROM marketing_tasks WHERE id=?').get(data.id);
    enqueueSync('marketing_task', updated.uid || String(data.id), updated);
    audit(user, 'update_task', 'marketing_task', data.id, { status });
    return updated;
  }
  requireMarketingAdmin(actor);
  const taskUid = uid();
  const r = db.prepare(`
    INSERT INTO marketing_tasks (uid, agent_id, title, description, task_type, branch_id, target_value, status, due_date, assigned_by, sync_status)
    VALUES (?,?,?,?,?,?,?,?,?,?, 'pending')`).run(
    taskUid, data.agent_id, data.title, data.description || null, data.task_type || 'general',
    data.branch_id || null, Number(data.target_value) || 0, 'not_started', data.due_date || null, user.id
  );
  const task = db.prepare('SELECT * FROM marketing_tasks WHERE id=?').get(r.lastInsertRowid);
  enqueueSync('marketing_task', taskUid, task);
  notify(null, data.agent_id, 'New task', data.title, 'task');
  audit(user, 'create_task', 'marketing_task', task.id, data);
  return task;
}

function digitsPhone(p) {
  return String(p || '').replace(/\D/g, '').replace(/^27/, '').replace(/^0/, '');
}

function phonesMatchSimple(a, b) {
  const x = digitsPhone(a);
  const y = digitsPhone(b);
  if (!x || !y) return false;
  return x === y || x.endsWith(y) || y.endsWith(x);
}

function linkPosCustomer(fullName, phone, actor) {
  const db = getDb();
  let pos = null;
  if (phone?.trim()) {
    const all = db.prepare(`SELECT * FROM customers WHERE phone IS NOT NULL AND TRIM(phone) != ''`).all();
    pos = all.find((c) => phonesMatchSimple(phone, c.phone)) || null;
  }
  if (!pos && fullName?.trim()) {
    pos = db.prepare(`SELECT * FROM customers WHERE LOWER(name) = LOWER(?)`).get(fullName.trim()) || null;
  }
  if (!pos && fullName?.trim()) {
    try {
      pos = require('./store').saveCustomer({
        name: fullName.trim(),
        phone: phone || null,
        notes: 'Created from Marketing Agent'
      }, actor?.id, actor?.username || actor?.full_name);
    } catch (_) {
      if (phone?.trim()) {
        const all = db.prepare(`SELECT * FROM customers WHERE phone IS NOT NULL AND TRIM(phone) != ''`).all();
        pos = all.find((c) => phonesMatchSimple(phone, c.phone)) || null;
      }
      if (!pos && fullName?.trim()) {
        pos = db.prepare(`SELECT * FROM customers WHERE LOWER(name) = LOWER(?)`).get(fullName.trim()) || null;
      }
    }
  }
  return pos?.id || null;
}

function attachPosCustomerId(rowId, posId) {
  if (!rowId || !posId) return;
  const db = getDb();
  db.prepare(`UPDATE marketing_customers SET customer_id=? WHERE id=?`).run(posId, rowId);
  db.prepare(`UPDATE marketing_referrals SET customer_id=? WHERE marketing_customer_id=?`).run(posId, rowId);
}

/* ─── Customers / recruitment ─── */
function listMarketingCustomers(filters = {}, actor) {
  const user = requireAgentOrAdmin(actor);
  let sql = `SELECT * FROM marketing_customers WHERE 1=1`;
  const params = [];
  if (!user.isAdmin) {
    sql += ' AND agent_id = ?';
    params.push(user.agent.id);
  } else if (filters.agent_id != null) {
    sql += ' AND agent_id = ?';
    params.push(filters.agent_id);
  }
  if (filters.group_tag) { sql += ' AND group_tag = ?'; params.push(filters.group_tag); }
  if (filters.conversion_status) { sql += ' AND conversion_status = ?'; params.push(filters.conversion_status); }
  if (filters.search) {
    sql += ' AND (full_name LIKE ? OR phone LIKE ?)';
    params.push(`%${filters.search}%`, `%${filters.search}%`);
  }
  sql += ' ORDER BY created_at DESC LIMIT 500';
  return getDb().prepare(sql).all(...params);
}

function saveMarketingCustomer(data, actor) {
  const user = requireAgentOrAdmin(actor);
  const agentId = user.isAdmin ? (data.agent_id || user.agent?.id) : user.agent.id;
  if (!agentId) throw new Error('Assign a marketing agent first');
  if (!data.full_name?.trim()) throw new Error('Customer name is required');
  if (data.marketing_consent === 0 || data.marketing_consent === false) {
    /* allowed — consent recorded */
  }
  const db = getDb();
  const agent = getAgent(agentId);
  if (data.id) {
    const row = db.prepare('SELECT * FROM marketing_customers WHERE id=?').get(data.id);
    if (!row) throw new Error('Customer not found');
    if (!user.isAdmin && row.agent_id !== user.agent.id) throw new Error('Not your customer');
    db.prepare(`
      UPDATE marketing_customers SET full_name=?, phone=?, branch_id=?, source=?, customer_type=?, group_tag=?,
        marketing_consent=?, notes=?, conversion_status=?, updated_at=datetime('now'), updated_by=?, sync_status='pending', version=version+1
      WHERE id=?`).run(
      data.full_name.trim(), data.phone || null, data.branch_id != null ? data.branch_id : row.branch_id,
      data.source || row.source, data.customer_type || row.customer_type, data.group_tag || row.group_tag,
      data.marketing_consent === 0 || data.marketing_consent === false ? 0 : 1,
      data.notes != null ? data.notes : row.notes, data.conversion_status || row.conversion_status,
      user.id, data.id
    );
    const updated = db.prepare('SELECT * FROM marketing_customers WHERE id=?').get(data.id);
    const posId = data.customer_id || updated.customer_id || linkPosCustomer(data.full_name, data.phone || updated.phone, user);
    if (posId && Number(updated.customer_id) !== Number(posId)) attachPosCustomerId(updated.id, posId);
    const linked = db.prepare('SELECT * FROM marketing_customers WHERE id=?').get(data.id);
    enqueueSync('marketing_customer', linked.uid, linked);
    audit(user, 'update_marketing_customer', 'marketing_customer', data.id, {});
    return linked;
  }
  const customerUid = uid();
  const r = db.prepare(`
    INSERT INTO marketing_customers (uid, agent_id, full_name, phone, branch_id, source, customer_type, group_tag,
      marketing_consent, referral_code, notes, conversion_status, created_by, updated_by, device_id, sync_status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'pending')`).run(
    customerUid, agentId, data.full_name.trim(), data.phone || null,
    data.branch_id || agent?.branch_id || null, data.source || 'agent_recruit',
    data.customer_type || 'new', data.group_tag || 'New Customers',
    data.marketing_consent === 0 || data.marketing_consent === false ? 0 : 1,
    agent?.referral_code || null, data.notes || null, 'recruited', user.id, user.id, data.device_id || null
  );
  const created = db.prepare('SELECT * FROM marketing_customers WHERE id=?').get(r.lastInsertRowid);
  db.prepare(`
    INSERT INTO marketing_referrals (uid, agent_id, referral_code, marketing_customer_id, status, sync_status)
    VALUES (?,?,?,?, 'pending', 'pending')`).run(uid(), agentId, agent?.referral_code || '', created.id);
  const posId = data.customer_id || linkPosCustomer(data.full_name, data.phone, user);
  if (posId) attachPosCustomerId(created.id, posId);
  const linked = db.prepare('SELECT * FROM marketing_customers WHERE id=?').get(created.id);
  enqueueSync('marketing_customer', customerUid, linked);
  audit(user, 'create_marketing_customer', 'marketing_customer', created.id, { phone: data.phone, customer_id: posId });
  touchAgent(agentId);
  return linked;
}

function markCustomerConverted(id, purchaseTotal, actor) {
  const user = requireAgentOrAdmin(actor);
  const db = getDb();
  const row = db.prepare('SELECT * FROM marketing_customers WHERE id=?').get(id);
  if (!row) throw new Error('Customer not found');
  if (!user.isAdmin && row.agent_id !== user.agent.id) throw new Error('Not your customer');
  let total = money(purchaseTotal);
  let firstAt = null;
  let lastAt = null;
  if (row.customer_id) {
    const sales = db.prepare(`
      SELECT COALESCE(SUM(total),0) as t, MIN(created_at) as first_at, MAX(created_at) as last_at
      FROM sales WHERE customer_id=? AND IFNULL(status,'completed') NOT IN ('void','voided')
    `).get(row.customer_id);
    if (sales && Number(sales.t) > 0) total = money(sales.t);
    firstAt = sales?.first_at || null;
    lastAt = sales?.last_at || null;
  }
  db.prepare(`
    UPDATE marketing_customers SET conversion_status='converted',
      first_purchase_at=COALESCE(?, first_purchase_at, datetime('now')),
      last_purchase_at=COALESCE(?, last_purchase_at, datetime('now')),
      updated_at=datetime('now'), sync_status='pending' WHERE id=?`).run(firstAt, lastAt, id);
  const ref = db.prepare('SELECT * FROM marketing_referrals WHERE marketing_customer_id=?').get(id);
  if (ref) {
    db.prepare(`
      UPDATE marketing_referrals SET status='converted', first_purchase_total=?, revenue=?, updated_at=datetime('now'), sync_status='pending'
      WHERE id=?`).run(total, total, ref.id);
  }
  return db.prepare('SELECT * FROM marketing_customers WHERE id=?').get(id);
}

function recruitmentStats(actor, filters = {}) {
  const user = requireAgentOrAdmin(actor);
  const agentId = user.isAdmin ? filters.agent_id : user.agent?.id;
  let where = '1=1';
  const params = [];
  if (agentId) { where += ' AND agent_id = ?'; params.push(agentId); }
  const recruited = Number(getDb().prepare(`SELECT COUNT(*) as c FROM marketing_customers WHERE ${where}`).get(...params)?.c || 0);
  const converted = Number(getDb().prepare(`SELECT COUNT(*) as c FROM marketing_customers WHERE ${where} AND conversion_status='converted'`).get(...params)?.c || 0);
  const revenue = money(getDb().prepare(
    `SELECT COALESCE(SUM(r.revenue),0) as t FROM marketing_referrals r WHERE ${agentId ? 'r.agent_id = ?' : '1=1'}`
  ).get(...(agentId ? [agentId] : []))?.t);
  return {
    customers_recruited: recruited,
    customers_converted: converted,
    revenue_attributed: revenue,
    conversion_rate: recruited ? Math.round((converted / recruited) * 1000) / 10 : 0
  };
}

/* ─── Campaigns ─── */
function listCampaigns(filters = {}, actor) {
  const user = requireAgentOrAdmin(actor);
  let sql = 'SELECT * FROM marketing_campaigns WHERE 1=1';
  const params = [];
  if (!user.isAdmin) { sql += ' AND agent_id = ?'; params.push(user.agent.id); }
  else if (filters.agent_id != null) { sql += ' AND agent_id = ?'; params.push(filters.agent_id); }
  if (filters.status) { sql += ' AND status = ?'; params.push(filters.status); }
  sql += ' ORDER BY created_at DESC';
  return getDb().prepare(sql).all(...params);
}

function saveCampaign(data, actor) {
  const user = requireAgentOrAdmin(actor);
  const agentId = user.isAdmin ? (data.agent_id || user.agent?.id) : user.agent.id;
  const db = getDb();
  if (data.id) {
    const row = db.prepare('SELECT * FROM marketing_campaigns WHERE id=?').get(data.id);
    if (!row) throw new Error('Campaign not found');
    if (!user.isAdmin && row.agent_id !== user.agent.id) throw new Error('Not your campaign');
    const status = data.status || row.status;
    if (!user.isAdmin && ['approved', 'active'].includes(status) && row.status !== status) {
      throw new Error('Only Admin can approve or activate campaigns');
    }
    db.prepare(`
      UPDATE marketing_campaigns SET name=?, objective=?, start_date=?, end_date=?, branch_id=?, products_json=?,
        target_group=?, offer_text=?, flyer_id=?, menu_id=?, status=?, updated_at=datetime('now'), updated_by=?, sync_status='pending', version=version+1
      WHERE id=?`).run(
      data.name || row.name, data.objective != null ? data.objective : row.objective,
      data.start_date || row.start_date, data.end_date || row.end_date,
      data.branch_id != null ? data.branch_id : row.branch_id,
      data.products_json != null ? (typeof data.products_json === 'string' ? data.products_json : JSON.stringify(data.products_json)) : row.products_json,
      data.target_group || row.target_group, data.offer_text != null ? data.offer_text : row.offer_text,
      data.flyer_id != null ? data.flyer_id : row.flyer_id, data.menu_id != null ? data.menu_id : row.menu_id,
      status, user.id, data.id
    );
    return db.prepare('SELECT * FROM marketing_campaigns WHERE id=?').get(data.id);
  }
  const campaignUid = uid();
  const r = db.prepare(`
    INSERT INTO marketing_campaigns (uid, name, objective, start_date, end_date, branch_id, agent_id, products_json,
      target_group, offer_text, flyer_id, menu_id, status, created_by, updated_by, sync_status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'draft', ?, ?, 'pending')`).run(
    campaignUid, data.name, data.objective || null, data.start_date || null, data.end_date || null,
    data.branch_id || null, agentId,
    JSON.stringify(data.products || data.products_json || []),
    data.target_group || null, data.offer_text || null, data.flyer_id || null, data.menu_id || null,
    user.id, user.id
  );
  const created = db.prepare('SELECT * FROM marketing_campaigns WHERE id=?').get(r.lastInsertRowid);
  enqueueSync('marketing_campaign', campaignUid, created);
  audit(user, 'create_campaign', 'marketing_campaign', created.id, { name: data.name });
  return created;
}

function submitCampaign(id, actor) {
  const user = requireAgentOrAdmin(actor);
  const row = getDb().prepare('SELECT * FROM marketing_campaigns WHERE id=?').get(id);
  if (!row) throw new Error('Campaign not found');
  if (!user.isAdmin && row.agent_id !== user.agent.id) throw new Error('Not your campaign');
  getDb().prepare(`UPDATE marketing_campaigns SET status='pending_approval', updated_at=datetime('now') WHERE id=?`).run(id);
  notifyOwners('Campaign awaiting approval', `${row.name} submitted by ${user.full_name || user.username}`);
  return getDb().prepare('SELECT * FROM marketing_campaigns WHERE id=?').get(id);
}

function approveCampaign(id, approve, notes, actor) {
  const admin = requireMarketingAdmin(actor);
  const status = approve ? 'approved' : 'draft';
  getDb().prepare(`UPDATE marketing_campaigns SET status=?, updated_at=datetime('now'), updated_by=? WHERE id=?`)
    .run(status, admin.id, id);
  const row = getDb().prepare('SELECT * FROM marketing_campaigns WHERE id=?').get(id);
  if (row?.agent_id) {
    notify(null, row.agent_id, approve ? 'Campaign approved' : 'Campaign rejected', notes || row.name, approve ? 'approval' : 'rejection');
  }
  audit(admin, approve ? 'approve_campaign' : 'reject_campaign', 'marketing_campaign', id, { notes });
  return row;
}

function notifyOwners(title, body) {
  const owners = getDb().prepare(`SELECT id FROM users WHERE role IN ('owner','manager') AND is_active=1`).all();
  owners.forEach(o => notify(o.id, null, title, body, 'admin'));
}

/* ─── Menus ─── */
function listMenus(filters = {}, actor) {
  const user = requireAgentOrAdmin(actor);
  let sql = 'SELECT * FROM marketing_menus WHERE 1=1';
  const params = [];
  if (!user.isAdmin) { sql += ' AND agent_id = ?'; params.push(user.agent.id); }
  else if (filters.agent_id != null) { sql += ' AND agent_id = ?'; params.push(filters.agent_id); }
  if (filters.approval_status) { sql += ' AND approval_status = ?'; params.push(filters.approval_status); }
  sql += ' ORDER BY updated_at DESC';
  return getDb().prepare(sql).all(...params);
}

function getMenu(id, actor) {
  requireAgentOrAdmin(actor);
  return getDb().prepare('SELECT * FROM marketing_menus WHERE id=?').get(id);
}

function buildProductCards(productIds) {
  const db = getDb();
  const cards = [];
  for (const id of productIds || []) {
    const p = db.prepare(`
      SELECT id, name, selling_price, description, image_path, category_id, is_active, stock_quantity,
        updated_at, has_recipe FROM products WHERE id = ?`).get(id);
    if (!p) continue;
    cards.push({
      product_id: p.id,
      name: p.name,
      selling_price: p.selling_price,
      description: p.description || '',
      image_path: p.image_path || null,
      is_active: p.is_active,
      stock_quantity: p.stock_quantity,
      price_last_updated: p.updated_at || null
    });
  }
  return cards;
}

function detectMenuPriceChanges(menu) {
  const products = parseJson(menu.products_json, []);
  const snapshot = parseJson(menu.price_snapshot_json, {});
  const alerts = [];
  for (const p of products) {
    const pid = p.product_id || p.id;
    if (!pid) continue;
    const live = getDb().prepare('SELECT id, name, selling_price, updated_at FROM products WHERE id=?').get(pid);
    if (!live) continue;
    const oldPrice = snapshot[pid] != null ? Number(snapshot[pid]) : Number(p.selling_price);
    const newPrice = Number(live.selling_price);
    if (Math.abs(oldPrice - newPrice) > 0.009) {
      alerts.push({
        product_id: pid,
        name: live.name,
        old_price: oldPrice,
        new_price: newPrice,
        price_last_updated: live.updated_at
      });
    }
  }
  return alerts;
}

function saveMenu(data, actor) {
  const user = requireAgentOrAdmin(actor);
  const agentId = user.isAdmin ? (data.agent_id || user.agent?.id) : user.agent.id;
  const db = getDb();
  const productIds = (data.products || parseJson(data.products_json, [])).map(p => p.product_id || p.id).filter(Boolean);
  const cards = buildProductCards(productIds.length ? productIds : (parseJson(data.products_json, []).map(p => p.product_id).filter(Boolean)));
  const snapshot = {};
  cards.forEach(c => { snapshot[c.product_id] = c.selling_price; });
  const pages = data.pages || parseJson(data.pages_json, defaultMenuPages(data.menu_type));
  const allowOverride = !!parseJson(user.agent?.permissions_json || '{}', {}).allow_price_override
    || user.isAdmin;
  let productsJson = cards;
  if (data.products && allowOverride) {
    productsJson = (data.products || []).map(p => {
      const card = cards.find(c => c.product_id === (p.product_id || p.id)) || {};
      return { ...card, ...p, selling_price: p.selling_price != null ? p.selling_price : card.selling_price };
    });
  }

  if (data.id) {
    const row = db.prepare('SELECT * FROM marketing_menus WHERE id=?').get(data.id);
    if (!row) throw new Error('Menu not found');
    if (!user.isAdmin && row.agent_id !== user.agent.id) throw new Error('Not your menu');
    db.prepare(`
      UPDATE marketing_menus SET title=?, menu_type=?, branch_id=?, pages_json=?, products_json=?, branding_json=?,
        price_snapshot_json=?, status=?, updated_at=datetime('now'), updated_by=?, sync_status='pending', version=version+1
      WHERE id=?`).run(
      data.title || row.title, data.menu_type || row.menu_type,
      data.branch_id != null ? data.branch_id : row.branch_id,
      JSON.stringify(pages), JSON.stringify(productsJson),
      JSON.stringify(data.branding || parseJson(data.branding_json, parseJson(row.branding_json, {}))),
      JSON.stringify(snapshot), data.status || row.status, user.id, data.id
    );
    const updated = db.prepare('SELECT * FROM marketing_menus WHERE id=?').get(data.id);
    updated.price_alerts = detectMenuPriceChanges(updated);
    return updated;
  }
  const menuUid = uid();
  const num = `MN-${Date.now().toString(36).toUpperCase()}`;
  const r = db.prepare(`
    INSERT INTO marketing_menus (uid, menu_number, title, menu_type, branch_id, agent_id, pages_json, products_json,
      branding_json, price_snapshot_json, status, approval_status, created_by, updated_by, sync_status)
    VALUES (?,?,?,?,?,?,?,?,?,?, 'draft', 'draft', ?, ?, 'pending')`).run(
    menuUid, num, data.title || 'New Menu', data.menu_type || 'main',
    data.branch_id || null, agentId, JSON.stringify(pages), JSON.stringify(productsJson),
    JSON.stringify(data.branding || {}), JSON.stringify(snapshot), user.id, user.id
  );
  const created = db.prepare('SELECT * FROM marketing_menus WHERE id=?').get(r.lastInsertRowid);
  enqueueSync('marketing_menu', menuUid, created);
  audit(user, 'create_menu', 'marketing_menu', created.id, { title: created.title });
  return created;
}

function defaultMenuPages(menuType) {
  const type = menuType || 'main';
  return [
    { id: 'p1', title: 'Cover', layout: 'cover', elements: [{ type: 'headline', text: `${String(type).toUpperCase()} MENU` }] },
    { id: 'p2', title: 'Items', layout: 'grid', elements: [] }
  ];
}

function submitMenu(id, actor) {
  const user = requireAgentOrAdmin(actor);
  const row = getDb().prepare('SELECT * FROM marketing_menus WHERE id=?').get(id);
  if (!row) throw new Error('Menu not found');
  if (!user.isAdmin && row.agent_id !== user.agent.id) throw new Error('Not your menu');
  const alerts = detectMenuPriceChanges(row);
  getDb().prepare(`
    UPDATE marketing_menus SET approval_status='pending', submitted_at=datetime('now'), status='pending', updated_at=datetime('now')
    WHERE id=?`).run(id);
  notifyOwners('Menu awaiting approval', `${row.title} submitted`);
  return { ...getDb().prepare('SELECT * FROM marketing_menus WHERE id=?').get(id), price_alerts: alerts };
}

function reviewMenu(id, approve, notes, actor) {
  const admin = requireMarketingAdmin(actor);
  const row = getDb().prepare('SELECT * FROM marketing_menus WHERE id=?').get(id);
  if (!row) throw new Error('Menu not found');
  if (approve) {
    const slug = `menu-${row.id}-${crypto.randomBytes(3).toString('hex')}`;
    const qr = JSON.stringify({ type: 'digital_menu', menu_id: row.id, slug });
    getDb().prepare(`
      UPDATE marketing_menus SET approval_status='approved', status='approved', approved_by=?, approved_at=datetime('now'),
        approval_notes=?, digital_slug=?, qr_payload=?, updated_at=datetime('now') WHERE id=?`)
      .run(admin.id, notes || null, slug, qr, id);
  } else {
    getDb().prepare(`
      UPDATE marketing_menus SET approval_status='rejected', status='draft', approved_by=?, approved_at=datetime('now'),
        approval_notes=?, updated_at=datetime('now') WHERE id=?`).run(admin.id, notes || 'Please revise', id);
  }
  if (row.agent_id) {
    notify(null, row.agent_id, approve ? 'Menu approved' : 'Menu rejected', notes || row.title, approve ? 'approval' : 'rejection');
  }
  audit(admin, approve ? 'approve_menu' : 'reject_menu', 'marketing_menu', id, { notes });
  return getDb().prepare('SELECT * FROM marketing_menus WHERE id=?').get(id);
}

function updateMenuPricesFromPos(id, actor) {
  const user = requireAgentOrAdmin(actor);
  const row = getDb().prepare('SELECT * FROM marketing_menus WHERE id=?').get(id);
  if (!row) throw new Error('Menu not found');
  if (!user.isAdmin && row.agent_id !== user.agent.id) throw new Error('Not your menu');
  const products = parseJson(row.products_json, []);
  const ids = products.map(p => p.product_id || p.id).filter(Boolean);
  const cards = buildProductCards(ids);
  const snapshot = {};
  cards.forEach(c => { snapshot[c.product_id] = c.selling_price; });
  getDb().prepare(`
    UPDATE marketing_menus SET products_json=?, price_snapshot_json=?, updated_at=datetime('now') WHERE id=?`)
    .run(JSON.stringify(cards), JSON.stringify(snapshot), id);
  return getDb().prepare('SELECT * FROM marketing_menus WHERE id=?').get(id);
}

/* ─── Messaging ─── */
function listMessageTemplates() {
  return getDb().prepare('SELECT * FROM marketing_message_templates WHERE is_active=1 ORDER BY title').all();
}

function listMessages(filters = {}, actor) {
  const user = requireAgentOrAdmin(actor);
  let sql = 'SELECT * FROM marketing_messages WHERE 1=1';
  const params = [];
  if (!user.isAdmin) { sql += ' AND agent_id = ?'; params.push(user.agent.id); }
  sql += ' ORDER BY created_at DESC LIMIT 200';
  return getDb().prepare(sql).all(...params);
}

async function saveMessage(data, actor) {
  const user = requireAgentOrAdmin(actor);
  const agentId = user.isAdmin ? (data.agent_id || user.agent?.id) : user.agent.id;
  const audience = data.audience || parseJson(data.audience_json, {});
  let recipients = listMarketingCustomers({
    agent_id: agentId,
    group_tag: audience.group_tag,
    conversion_status: audience.conversion_status
  }, user);
  recipients = recipients.filter(c => c.marketing_consent !== 0 && c.phone);
  const body = data.message_body || data.body;
  if (!body?.trim()) throw new Error('Message body is required');
  const msgUid = uid();
  const r = getDb().prepare(`
    INSERT INTO marketing_messages (uid, agent_id, campaign_id, template_key, audience_json, message_body, recipient_count, status, sync_status)
    VALUES (?,?,?,?,?,?,?, ?, 'pending')`).run(
    msgUid, agentId, data.campaign_id || null, data.template_key || null,
    JSON.stringify(audience), body.trim(), recipients.length,
    data.status === 'queued' ? 'queued' : 'draft'
  );
  const created = getDb().prepare('SELECT * FROM marketing_messages WHERE id=?').get(r.lastInsertRowid);
  enqueueSync('marketing_message', msgUid, { ...created, recipients: recipients.map(rec => ({ id: rec.id, phone: rec.phone, name: rec.full_name })) });
  audit(user, 'create_message', 'marketing_message', created.id, { recipients: recipients.length });

  if (data.status === 'queued' && recipients.length) {
    const whatsapp = require('./whatsapp');
    let sent = 0;
    let failed = 0;
    const urls = [];
    for (const rec of recipients) {
      try {
        const wr = await whatsapp.sendMessage({
          phone: rec.phone,
          body: body.trim(),
          message_type: 'custom',
          customer_id: rec.customer_id || null,
          customer_name: rec.full_name
        }, user);
        sent++;
        if (wr?.url) urls.push({ phone: rec.phone, name: rec.full_name, url: wr.url });
      } catch (_) { failed++; }
    }
    const status = sent ? 'sent' : 'queued';
    getDb().prepare(`UPDATE marketing_messages SET status=? WHERE id=?`).run(status, created.id);
    return { ...created, status, recipients, _sent: sent, _failed: failed, urls };
  }
  return { ...created, recipients };
}

/* ─── Reports / feedback / media / notifications ─── */
function saveProgressReport(data, actor) {
  const user = requireAgentOrAdmin(actor);
  const agentId = user.isAdmin ? (data.agent_id || user.agent?.id) : user.agent.id;
  if (!agentId) throw new Error('Agent required');
  const reportUid = uid();
  const r = getDb().prepare(`
    INSERT INTO marketing_reports (uid, agent_id, period_label, work_completed, customers_recruited, campaigns_count,
      flyers_count, menus_count, messages_count, referrals_count, customer_feedback, problems, recommendations, next_steps,
      attachments_json, status, sync_status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'submitted', 'pending')`).run(
    reportUid, agentId, data.period_label || today(), data.work_completed || '',
    Number(data.customers_recruited) || 0, Number(data.campaigns_count) || 0, Number(data.flyers_count) || 0,
    Number(data.menus_count) || 0, Number(data.messages_count) || 0, Number(data.referrals_count) || 0,
    data.customer_feedback || null, data.problems || null, data.recommendations || null, data.next_steps || null,
    JSON.stringify(data.attachments || [])
  );
  notifyOwners('Agent progress report', `Report from agent #${agentId}`);
  return getDb().prepare('SELECT * FROM marketing_reports WHERE id=?').get(r.lastInsertRowid);
}

function listProgressReports(filters = {}, actor) {
  requireAgentOrAdmin(actor);
  let sql = `SELECT r.*, u.full_name as agent_name FROM marketing_reports r
    LEFT JOIN marketing_agents a ON a.id = r.agent_id
    LEFT JOIN users u ON u.id = a.user_id WHERE 1=1`;
  const params = [];
  if (filters.agent_id != null) { sql += ' AND r.agent_id = ?'; params.push(filters.agent_id); }
  sql += ' ORDER BY r.created_at DESC LIMIT 100';
  return getDb().prepare(sql).all(...params);
}

function respondProgressReport(id, response, actor) {
  const admin = requireMarketingAdmin(actor);
  getDb().prepare(`
    UPDATE marketing_reports SET admin_response=?, reviewed_by=?, reviewed_at=datetime('now'), status='reviewed' WHERE id=?`)
    .run(response || '', admin.id, id);
  const row = getDb().prepare('SELECT * FROM marketing_reports WHERE id=?').get(id);
  if (row?.agent_id) notify(null, row.agent_id, 'Admin feedback on your report', response || '', 'feedback');
  return row;
}

function saveFeedback(data, actor) {
  const user = requireAgentOrAdmin(actor);
  const agentId = user.isAdmin ? (data.agent_id || user.agent?.id) : user.agent.id;
  const r = getDb().prepare(`
    INSERT INTO marketing_feedback (uid, agent_id, customer_name, phone, feedback_type, product_request, notes, branch_id, sync_status)
    VALUES (?,?,?,?,?,?,?,?, 'pending')`).run(
    uid(), agentId, data.customer_name || null, data.phone || null,
    data.feedback_type || 'suggestion', data.product_request || null, data.notes || null, data.branch_id || null
  );
  return getDb().prepare('SELECT * FROM marketing_feedback WHERE id=?').get(r.lastInsertRowid);
}

function listFeedback(filters = {}, actor) {
  const user = requireAgentOrAdmin(actor);
  let sql = 'SELECT * FROM marketing_feedback WHERE 1=1';
  const params = [];
  if (!user.isAdmin && user.agent?.id) {
    sql += ' AND agent_id = ?';
    params.push(user.agent.id);
  } else if (filters.agent_id != null) {
    sql += ' AND agent_id = ?';
    params.push(filters.agent_id);
  }
  if (filters.feedback_type) { sql += ' AND feedback_type = ?'; params.push(filters.feedback_type); }
  if (filters.branch_id != null) { sql += ' AND branch_id = ?'; params.push(filters.branch_id); }
  sql += ' ORDER BY created_at DESC LIMIT 300';
  return getDb().prepare(sql).all(...params);
}

function listMedia(actor) {
  requireAgentOrAdmin(actor);
  return getDb().prepare('SELECT * FROM marketing_media ORDER BY created_at DESC LIMIT 300').all();
}

function saveMedia(data, actor) {
  const user = requireAgentOrAdmin(actor);
  if (data.id) {
    requireMarketingAdmin(actor);
    const row = getDb().prepare('SELECT * FROM marketing_media WHERE id=?').get(data.id);
    if (!row) throw new Error('Media not found');
    getDb().prepare(`
      UPDATE marketing_media SET title=?, approval_status=?, tags_json=? WHERE id=?`)
      .run(
        data.title != null ? data.title : row.title,
        data.approval_status || row.approval_status,
        data.tags != null ? JSON.stringify(data.tags) : row.tags_json,
        data.id
      );
    audit(user, 'update_media', 'marketing_media', data.id, { approval_status: data.approval_status });
    return getDb().prepare('SELECT * FROM marketing_media WHERE id=?').get(data.id);
  }
  if (!data.file_path) throw new Error('File path required');
  const r = getDb().prepare(`
    INSERT INTO marketing_media (uid, title, file_path, media_type, tags_json, approval_status, uploaded_by, sync_status)
    VALUES (?,?,?,?,?,?,?, 'pending')`).run(
    uid(), data.title || 'Media', data.file_path, data.media_type || 'image',
    JSON.stringify(data.tags || []), user.isAdmin ? 'approved' : 'pending', user.id
  );
  return getDb().prepare('SELECT * FROM marketing_media WHERE id=?').get(r.lastInsertRowid);
}

function setMediaStatus(id, status, actor) {
  const admin = requireMarketingAdmin(actor);
  if (!['approved', 'restricted', 'archived', 'pending'].includes(status)) throw new Error('Invalid media status');
  getDb().prepare(`UPDATE marketing_media SET approval_status=? WHERE id=?`).run(status, id);
  audit(admin, 'set_media_status', 'marketing_media', id, { status });
  return getDb().prepare('SELECT * FROM marketing_media WHERE id=?').get(id);
}

function listNotifications(actor) {
  const user = requireAgentOrAdmin(actor);
  const agentId = user.agent?.id;
  return getDb().prepare(`
    SELECT * FROM marketing_notifications
    WHERE user_id = ? OR agent_id = ?
    ORDER BY created_at DESC LIMIT 100`).all(user.id, agentId || -1);
}

function markNotificationRead(id, actor) {
  requireAgentOrAdmin(actor);
  getDb().prepare('UPDATE marketing_notifications SET is_read=1 WHERE id=?').run(id);
  return true;
}

function getSyncStatus() {
  const pending = Number(getDb().prepare(`SELECT COUNT(*) as c FROM marketing_sync_queue WHERE status='pending'`).get()?.c || 0);
  const failed = Number(getDb().prepare(`SELECT COUNT(*) as c FROM marketing_sync_queue WHERE status='failed'`).get()?.c || 0);
  const last = getDb().prepare(`SELECT updated_at FROM marketing_sync_queue WHERE status='synced' ORDER BY updated_at DESC LIMIT 1`).get();
  return {
    pending,
    failed,
    last_sync: last?.updated_at || null,
    status: failed ? 'Sync Failed' : pending ? 'Pending Sync' : 'Synced'
  };
}

function processSyncQueue(actor) {
  requireAgentOrAdmin(actor);
  const db = getDb();
  const rows = db.prepare(`SELECT * FROM marketing_sync_queue WHERE status='pending' ORDER BY id LIMIT 100`).all();
  let synced = 0;
  let conflicts = 0;
  for (const row of rows) {
    try {
      const payload = parseJson(row.payload_json, {});
      const entityUid = row.entity_uid;
      // Conflict detection: if same uid appears twice with different versions, keep both & flag
      const sibling = db.prepare(`
        SELECT * FROM marketing_sync_queue
        WHERE entity_type=? AND entity_uid=? AND id!=? AND status='pending' ORDER BY id DESC LIMIT 1`)
        .get(row.entity_type, entityUid, row.id);
      if (sibling) {
        const a = parseJson(sibling.payload_json, {});
        const vLocal = Number(payload.version) || 0;
        const vRemote = Number(a.version) || 0;
        if (vLocal && vRemote && vLocal !== vRemote) {
          db.prepare(`
            INSERT INTO marketing_sync_conflicts (entity_type, entity_uid, local_version, remote_version, local_json, remote_json, status)
            VALUES (?,?,?,?,?,?, 'open')`).run(
            row.entity_type, entityUid, vLocal, vRemote,
            JSON.stringify(payload), JSON.stringify(a)
          );
          conflicts++;
          db.prepare(`UPDATE marketing_sync_queue SET status='failed', attempts=attempts+1, last_error=?, updated_at=datetime('now') WHERE id=?`)
            .run('Version conflict — review in sync conflicts', row.id);
          continue;
        }
      }
      // Apply local entity sync_status when possible
      const tableMap = {
        marketing_customer: 'marketing_customers',
        marketing_task: 'marketing_tasks',
        marketing_campaign: 'marketing_campaigns',
        marketing_menu: 'marketing_menus',
        marketing_message: 'marketing_messages',
        marketing_report: 'marketing_reports'
      };
      const table = tableMap[row.entity_type];
      if (table && entityUid) {
        try {
          db.prepare(`UPDATE ${table} SET sync_status='synced', updated_at=datetime('now') WHERE uid=?`).run(entityUid);
        } catch (_) { /* table/column may differ */ }
      }
      db.prepare(`UPDATE marketing_sync_queue SET status='synced', updated_at=datetime('now'), last_error=NULL WHERE id=?`).run(row.id);
      synced++;
    } catch (err) {
      db.prepare(`UPDATE marketing_sync_queue SET status='failed', attempts=attempts+1, last_error=?, updated_at=datetime('now') WHERE id=?`)
        .run(err.message, row.id);
    }
  }
  return { synced, conflicts, ...getSyncStatus() };
}

function listSyncConflicts(actor) {
  requireMarketingAdmin(actor);
  return getDb().prepare(`SELECT * FROM marketing_sync_conflicts WHERE status='open' ORDER BY created_at DESC LIMIT 100`).all();
}

function resolveSyncConflict(id, keep, actor) {
  const admin = requireMarketingAdmin(actor);
  const row = getDb().prepare('SELECT * FROM marketing_sync_conflicts WHERE id=?').get(id);
  if (!row) throw new Error('Conflict not found');
  getDb().prepare(`
    UPDATE marketing_sync_conflicts SET status=?, resolved_at=datetime('now'), resolved_by=? WHERE id=?`)
    .run(keep === 'remote' ? 'resolved_remote' : 'resolved_local', admin.id, id);
  getDb().prepare(`
    UPDATE marketing_sync_queue SET status='synced', last_error=NULL, updated_at=datetime('now')
    WHERE entity_type=? AND entity_uid=? AND status='failed'`).run(row.entity_type, row.entity_uid);
  audit(admin, 'resolve_sync_conflict', 'marketing_sync_conflict', id, { keep });
  return true;
}

function listAudit(filters = {}, actor) {
  requireMarketingAdmin(actor);
  let sql = 'SELECT * FROM marketing_audit_log WHERE 1=1';
  const params = [];
  if (filters.agent_id != null) { sql += ' AND agent_id = ?'; params.push(filters.agent_id); }
  if (filters.action) { sql += ' AND action LIKE ?'; params.push(`%${filters.action}%`); }
  if (filters.entity_type) { sql += ' AND entity_type = ?'; params.push(filters.entity_type); }
  if (filters.date_from) { sql += ' AND date(created_at) >= date(?)'; params.push(filters.date_from); }
  if (filters.date_to) { sql += ' AND date(created_at) <= date(?)'; params.push(filters.date_to); }
  sql += ' ORDER BY created_at DESC LIMIT 500';
  return getDb().prepare(sql).all(...params);
}

function getDigitalMenu(slugOrId, actor) {
  // Public-ish read for approved digital menus (agents/admins still authenticated in-app)
  if (actor) requireAgentOrAdmin(actor);
  const db = getDb();
  let row = null;
  if (typeof slugOrId === 'number' || /^\d+$/.test(String(slugOrId))) {
    row = db.prepare('SELECT * FROM marketing_menus WHERE id=?').get(Number(slugOrId));
  } else {
    row = db.prepare('SELECT * FROM marketing_menus WHERE digital_slug=?').get(String(slugOrId));
  }
  if (!row) throw new Error('Digital menu not found');
  if (row.approval_status !== 'approved' && actor) {
    const user = requireAgentOrAdmin(actor);
    if (!user.isAdmin && row.agent_id !== user.agent?.id) throw new Error('Menu not approved');
  } else if (row.approval_status !== 'approved' && !actor) {
    throw new Error('Menu not approved');
  }
  const products = parseJson(row.products_json, []);
  const pages = parseJson(row.pages_json, []);
  let brand = {};
  try {
    const s = getDb().prepare('SELECT marketing_brand_kit, shop_name, logo_path, phone, address FROM shop_settings WHERE id=1').get();
    brand = { ...(parseJson(s?.marketing_brand_kit, {})), shop_name: s?.shop_name, logo_path: s?.logo_path, phone: s?.phone, address: s?.address };
  } catch (_) { /* ignore */ }
  return {
    ...row,
    products,
    pages,
    brand,
    digital_url: `shoppos://digital-menu/${row.digital_slug || row.id}`,
    qr_payload: parseJson(row.qr_payload, { type: 'digital_menu', menu_id: row.id, slug: row.digital_slug })
  };
}

function buildMenuPrintHtml(id, actor) {
  const menu = getDigitalMenu(id, actor);
  const currency = 'R';
  const products = menu.products || [];
  const pages = menu.pages || [];
  const cards = products.map(p => `
    <div class="card">
      <strong>${String(p.name || '').replace(/</g, '&lt;')}</strong>
      <div class="desc">${String(p.description || '').replace(/</g, '&lt;')}</div>
      <div class="price">${currency}${Number(p.selling_price || 0).toFixed(2)}</div>
    </div>`).join('');
  const pageNav = pages.map((p, i) => `<div class="page"><h2>Page ${i + 1}: ${String(p.title || '').replace(/</g, '&lt;')}</h2></div>`).join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${String(menu.title).replace(/</g, '&lt;')}</title>
    <style>
      body{font-family:Segoe UI,Arial,sans-serif;margin:24px;color:#0f172a}
      h1{margin:0 0 8px} .muted{color:#64748b}
      .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;margin-top:16px}
      .card{border:1px solid #e2e8f0;border-radius:12px;padding:12px}
      .price{font-weight:700;margin-top:8px;color:#0f766e}
      .desc{font-size:12px;color:#64748b;margin-top:4px}
      .page{margin-top:20px;padding-top:12px;border-top:1px dashed #cbd5e1}
      @media print{button{display:none}}
    </style></head><body>
    <h1>${String(menu.title).replace(/</g, '&lt;')}</h1>
    <p class="muted">${String(menu.menu_type || '')} · ${menu.approval_status || ''} · ${menu.digital_slug || ''}</p>
    ${pageNav}
    <div class="grid">${cards || '<p class="muted">No products</p>'}</div>
    <script>window.onload=function(){setTimeout(function(){window.print()},300)}</script>
    </body></html>`;
}

function listMenuTemplates(actor) {
  requireAgentOrAdmin(actor);
  return getDb().prepare('SELECT * FROM marketing_menu_templates ORDER BY updated_at DESC LIMIT 100').all();
}

function saveMenuTemplate(data, actor) {
  const user = requireAgentOrAdmin(actor);
  const pages = data.pages || [];
  const products = data.products || [];
  if (data.id) {
    const row = getDb().prepare('SELECT * FROM marketing_menu_templates WHERE id=?').get(data.id);
    if (!row) throw new Error('Template not found');
    if (row.is_locked && !user.isAdmin) throw new Error('Locked template — Admin only');
    getDb().prepare(`
      UPDATE marketing_menu_templates SET title=?, menu_type=?, pages_json=?, products_json=?, branding_json=?, page_size=?,
        is_locked=?, updated_at=datetime('now') WHERE id=?`).run(
      data.title || row.title, data.menu_type || row.menu_type,
      JSON.stringify(pages.length ? pages : parseJson(row.pages_json, [])),
      JSON.stringify(products.length ? products : parseJson(row.products_json, [])),
      JSON.stringify(data.branding || parseJson(row.branding_json, {})),
      data.page_size || row.page_size || 'A4',
      user.isAdmin && data.is_locked != null ? (data.is_locked ? 1 : 0) : row.is_locked,
      data.id
    );
    return getDb().prepare('SELECT * FROM marketing_menu_templates WHERE id=?').get(data.id);
  }
  const r = getDb().prepare(`
    INSERT INTO marketing_menu_templates (uid, title, menu_type, pages_json, products_json, branding_json, page_size, is_locked, created_by, agent_id)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    uid(), data.title || 'Menu Template', data.menu_type || 'main',
    JSON.stringify(pages), JSON.stringify(products), JSON.stringify(data.branding || {}),
    data.page_size || 'A4', user.isAdmin && data.is_locked ? 1 : 0,
    user.id, user.agent?.id || null
  );
  return getDb().prepare('SELECT * FROM marketing_menu_templates WHERE id=?').get(r.lastInsertRowid);
}

function searchProductsForMarketing(filters = {}, actor) {
  requireAgentOrAdmin(actor);
  let sql = `SELECT id, name, selling_price, buying_price, description, image_path, category_id, is_active, stock_quantity, barcode, updated_at
    FROM products WHERE 1=1`;
  const params = [];
  if (filters.active_only !== false) sql += ' AND is_active = 1';
  if (filters.category_id) { sql += ' AND category_id = ?'; params.push(filters.category_id); }
  if (filters.search) { sql += ' AND (name LIKE ? OR barcode LIKE ?)'; params.push(`%${filters.search}%`, `%${filters.search}%`); }
  if (filters.in_stock) sql += ' AND stock_quantity > 0';
  sql += ' ORDER BY name LIMIT 200';
  return getDb().prepare(sql).all(...params);
}

function getBrandKitForAgent(actor) {
  requireAgentOrAdmin(actor);
  try {
    const flyers = require('./flyers');
    return flyers.getBrandKit();
  } catch {
    const s = getDb().prepare('SELECT marketing_brand_kit, shop_name, logo_path, phone, address FROM shop_settings WHERE id=1').get();
    return {
      ...(parseJson(s?.marketing_brand_kit, {})),
      shop_name: s?.shop_name,
      logo_path: s?.logo_path,
      phone: s?.phone,
      address: s?.address
    };
  }
}

function performanceScorecard(agentId, actor) {
  const user = requireAgentOrAdmin(actor);
  const id = user.isAdmin ? (agentId || user.agent?.id) : user.agent?.id;
  const agent = getAgent(id);
  if (!agent) throw new Error('Agent not found');
  const targets = parseJson(agent.targets_json, defaultTargets());
  const from = (() => { const d = new Date(); d.setDate(1); return d.toLocaleDateString('en-CA'); })();
  const count = (sql, ...p) => Number(getDb().prepare(sql).get(...p)?.c || 0);
  const customersMonth = count(`SELECT COUNT(*) as c FROM marketing_customers WHERE agent_id=? AND date(created_at) >= date(?)`, id, from);
  const converted = count(`SELECT COUNT(*) as c FROM marketing_customers WHERE agent_id=? AND conversion_status='converted'`, id);
  const referrals = count(`SELECT COUNT(*) as c FROM marketing_referrals WHERE agent_id=?`, id);
  const flyers = count(`SELECT COUNT(*) as c FROM promotion_flyers WHERE created_by=? AND date(created_at) >= date(?)`, agent.user_id, from);
  const menus = count(`SELECT COUNT(*) as c FROM marketing_menus WHERE agent_id=? AND date(created_at) >= date(?)`, id, from);
  const campaigns = count(`SELECT COUNT(*) as c FROM marketing_campaigns WHERE agent_id=? AND date(created_at) >= date(?)`, id, from);
  const tasksDone = count(`SELECT COUNT(*) as c FROM marketing_tasks WHERE agent_id=? AND status='completed'`, id);
  const pct = (a, t) => (!Number(t) ? 0 : Math.round((Number(a) / Number(t)) * 1000) / 10);
  const kpis = [
    { key: 'customers', label: 'Customers recruited', target: targets.customers_recruit_month, actual: customersMonth },
    { key: 'campaigns', label: 'Campaigns', target: targets.campaigns_month, actual: campaigns },
    { key: 'flyers', label: 'Flyers', target: targets.flyers_month, actual: flyers },
    { key: 'menus', label: 'Menus', target: targets.menus_month, actual: menus },
    { key: 'referrals', label: 'Referrals', target: targets.referrals_month, actual: referrals },
    { key: 'tasks', label: 'Tasks completed', target: targets.tasks_week, actual: tasksDone }
  ].map(k => ({ ...k, achievement: pct(k.actual, k.target) }));
  const revenue = money(getDb().prepare(`SELECT COALESCE(SUM(revenue),0) as t FROM marketing_referrals WHERE agent_id=?`).get(id)?.t);
  return {
    agent: { ...agent, targets },
    kpis,
    recruitment: {
      customers_recruited: customersMonth,
      customers_converted: converted,
      revenue_attributed: revenue,
      conversion_rate: customersMonth ? Math.round((converted / customersMonth) * 1000) / 10 : 0
    },
    summary: { customers_recruited: customersMonth, referrals, attributed_sales: revenue, campaigns, flyers, menus }
  };
}

module.exports = {
  listAgents, ensureAgentForUser, setAgentStatus, getAgent, getAgentByUserId,
  issueAccessToken, revokeAccessToken, listAccessTokens, loginWithAccessToken,
  agentDashboard, adminMarketingSummary, performanceScorecard,
  listTasks, saveTask,
  listMarketingCustomers, saveMarketingCustomer, markCustomerConverted, recruitmentStats,
  listCampaigns, saveCampaign, submitCampaign, approveCampaign,
  listMenus, getMenu, saveMenu, submitMenu, reviewMenu, updateMenuPricesFromPos, detectMenuPriceChanges, buildProductCards,
  listMessageTemplates, listMessages, saveMessage,
  saveProgressReport, listProgressReports, respondProgressReport,
  saveFeedback, listFeedback, listMedia, saveMedia, setMediaStatus,
  listNotifications, markNotificationRead,
  getSyncStatus, processSyncQueue, listSyncConflicts, resolveSyncConflict, listAudit,
  getDigitalMenu, buildMenuPrintHtml, listMenuTemplates, saveMenuTemplate,
  searchProductsForMarketing, getBrandKitForAgent, defaultTargets
};

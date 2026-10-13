/**
 * Chisanyama Connect communication module.
 * Identity, branches, orders, drivers and permissions come from the existing
 * platform. This file writes only its own connect_* tables. It never updates
 * sales, orders, customers, drivers or marketing campaigns.
 */
const crypto = require('crypto');
const { getDb } = require('../database/db');

function now() { return new Date().toISOString(); }
function num(v) { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; }
function hash(value) { return crypto.createHash('sha256').update(String(value || '')).digest('hex'); }

function ensure() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS connect_profiles (
      actor_key TEXT PRIMARY KEY,
      chisanyama_user_id INTEGER,
      customer_id INTEGER,
      web_customer_id INTEGER,
      role TEXT,
      display_name TEXT,
      about TEXT,
      settings_json TEXT,
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS connect_threads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      title TEXT,
      branch_id INTEGER,
      order_id INTEGER,
      order_number TEXT,
      created_by TEXT,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS connect_members (
      thread_id INTEGER NOT NULL,
      actor_key TEXT NOT NULL,
      role TEXT,
      joined_at TEXT,
      PRIMARY KEY (thread_id, actor_key)
    );
    CREATE TABLE IF NOT EXISTS connect_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id INTEGER NOT NULL,
      actor_key TEXT NOT NULL,
      body TEXT,
      context_json TEXT,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS connect_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_key TEXT NOT NULL,
      body TEXT,
      media_data TEXT,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS connect_stories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_key TEXT NOT NULL,
      body TEXT,
      media_data TEXT,
      expires_at TEXT,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS connect_calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id INTEGER,
      kind TEXT,
      started_by TEXT,
      peer_key TEXT,
      status TEXT,
      started_at TEXT,
      ended_at TEXT
    );
    CREATE TABLE IF NOT EXISTS connect_signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      call_id INTEGER NOT NULL,
      from_key TEXT,
      payload TEXT,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS connect_notices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_key TEXT NOT NULL,
      kind TEXT,
      title TEXT,
      body TEXT,
      read_at TEXT,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS connect_access (
      token_hash TEXT PRIMARY KEY,
      actor_key TEXT NOT NULL,
      role TEXT,
      expires_at TEXT,
      created_at TEXT
    );
  `);
  addColumn(db, 'connect_profiles', 'connect_code', 'TEXT');
  addColumn(db, 'connect_profiles', 'blocked', 'INTEGER DEFAULT 0');
  addColumn(db, 'connect_profiles', 'approved', 'INTEGER DEFAULT 1');
  addColumn(db, 'connect_posts', 'media_kind', 'TEXT');
  addColumn(db, 'connect_posts', 'hidden', 'INTEGER DEFAULT 0');
  addColumn(db, 'connect_posts', 'flagged', 'INTEGER DEFAULT 0');
  addColumn(db, 'connect_stories', 'media_kind', 'TEXT');
  addColumn(db, 'connect_stories', 'hidden', 'INTEGER DEFAULT 0');
  addColumn(db, 'connect_stories', 'flagged', 'INTEGER DEFAULT 0');
  addColumn(db, 'connect_messages', 'hidden', 'INTEGER DEFAULT 0');
  addColumn(db, 'connect_messages', 'flagged', 'INTEGER DEFAULT 0');
  try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_connect_profiles_code ON connect_profiles(connect_code)'); } catch (_) {}
  return db;
}

function addColumn(db, table, column, type) {
  try { db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`).run(); } catch (_) {}
}

function assignCode(db, key) {
  const row = db.prepare('SELECT connect_code FROM connect_profiles WHERE actor_key = ?').get(key);
  if (row && row.connect_code) return row.connect_code;
  for (let i = 0; i < 8; i++) {
    const code = `CC-${crypto.randomInt(100000, 999999)}`;
    const taken = db.prepare('SELECT 1 AS ok FROM connect_profiles WHERE connect_code = ?').get(code);
    if (taken) continue;
    try {
      db.prepare('UPDATE connect_profiles SET connect_code = ? WHERE actor_key = ? AND (connect_code IS NULL OR connect_code = \'\')').run(code, key);
    } catch (_) { continue; }
    const saved = db.prepare('SELECT connect_code FROM connect_profiles WHERE actor_key = ?').get(key);
    if (saved && saved.connect_code) return saved.connect_code;
  }
  throw new Error('Could not create a Connect number');
}

function normalizeCode(value) {
  const raw = String(value || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!raw) return '';
  if (/^CC-\d{6}$/.test(raw)) return raw;
  if (/^\d{6}$/.test(raw)) return `CC-${raw}`;
  return raw;
}

function shopName(db) {
  try {
    const row = db.prepare('SELECT shop_name FROM shop_settings WHERE id = 1').get();
    if (row && row.shop_name) return String(row.shop_name);
  } catch (_) {}
  return 'Chisanyama Connect';
}

function customerById(db, id) {
  const cid = num(id);
  if (!cid) return null;
  return db.prepare('SELECT id, name, phone, email FROM customers WHERE id = ?').get(cid) || null;
}

function profileFor(db, actor) {
  const row = db.prepare('SELECT * FROM connect_profiles WHERE actor_key = ?').get(actor.key);
  return {
    key: actor.key,
    name: (row && row.display_name) || actor.name,
    role: actor.role,
    phone: actor.phone || '',
    email: actor.email || '',
    customerId: actor.customerId || null,
    userId: actor.userId || null,
    branchId: actor.branchId || null,
    about: (row && row.about) || '',
    shop: shopName(db),
    marketingOptIn: marketingChoice(db, actor),
    connectCode: (row && row.connect_code) || '',
    blocked: !!(row && Number(row.blocked) === 1),
    approved: !(row && Number(row.approved) === 0),
    canModerate: seesAllBranches(actor.role),
  };
}

function marketingChoice(db, actor) {
  if (!actor.webCustomerId) return null;
  try {
    const row = db.prepare('SELECT marketing_opt_in FROM web_customers WHERE id = ?').get(actor.webCustomerId);
    return row ? Number(row.marketing_opt_in) === 1 : null;
  } catch (_) { return null; }
}

function touch(db, actor) {
  db.prepare(`INSERT INTO connect_profiles (actor_key, chisanyama_user_id, customer_id, web_customer_id, role, display_name, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(actor_key) DO UPDATE SET role=excluded.role, display_name=excluded.display_name, updated_at=excluded.updated_at`)
    .run(actor.key, actor.userId || null, actor.customerId || null, actor.webCustomerId || null, actor.role, actor.name, now());
}

function actorFromWeb(db, token) {
  const online = require('./online-ordering');
  const web = online.resolveWebCustomer(token);
  if (!web) return null;
  const customer = customerById(db, web.customer_id);
  const name = customer
    ? (customer.name || 'Customer')
    : [web.first_name, web.last_name].filter(Boolean).join(' ') || 'Customer';
  return {
    key: customer ? `c:${customer.id}` : `w:${web.id}`,
    name,
    phone: (customer && customer.phone) || web.phone || '',
    email: (customer && customer.email) || web.email || '',
    role: 'customer',
    customerId: customer ? customer.id : null,
    webCustomerId: web.id,
    userId: null,
    branchId: null,
  };
}

function actorFromStaffToken(db, token) {
  const row = db.prepare('SELECT actor_key, role, expires_at FROM connect_access WHERE token_hash = ?').get(hash(token));
  if (!row) return null;
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return null;
  const userId = num(String(row.actor_key).replace(/^u:/, ''));
  let user = null;
  try {
    user = db.prepare('SELECT id, full_name, username, role, branch_id FROM users WHERE id = ?').get(userId);
  } catch (_) {
    user = db.prepare('SELECT id, full_name, username, role FROM users WHERE id = ?').get(userId);
  }
  if (!user) return null;
  return {
    key: `u:${user.id}`,
    name: user.full_name || user.username || 'Staff',
    phone: '',
    email: '',
    role: user.role || row.role || 'staff',
    customerId: null,
    webCustomerId: null,
    userId: user.id,
    branchId: num(user.branch_id) || null,
  };
}

function actorFromToken(token) {
  const db = ensure();
  const raw = String(token || '').trim();
  if (!raw) throw new Error('Sign in with your Chisanyama account');
  const staff = actorFromStaffToken(db, raw);
  const actor = staff || actorFromWeb(db, raw);
  if (!actor) throw new Error('This Chisanyama sign-in is no longer valid');
  touch(db, actor);
  actor.connectCode = assignCode(db, actor.key);
  return { db, actor };
}

function requireActive(db, actor) {
  const row = db.prepare('SELECT blocked, approved FROM connect_profiles WHERE actor_key = ?').get(actor.key);
  if (row && Number(row.blocked) === 1) throw new Error('This Connect account is blocked');
  if (row && Number(row.approved) === 0) throw new Error('This Connect account is waiting for approval');
}

function personByCode(db, code) {
  return db.prepare('SELECT * FROM connect_profiles WHERE connect_code = ?').get(normalizeCode(code));
}

function linkedKeys(db, key) {
  const rows = db.prepare(`SELECT m2.actor_key FROM connect_threads t
    JOIN connect_members m1 ON m1.thread_id = t.id AND m1.actor_key = ?
    JOIN connect_members m2 ON m2.thread_id = t.id AND m2.actor_key != ?
    WHERE t.kind = 'direct'`).all(key, key);
  return new Set(rows.map((row) => row.actor_key));
}

function seesAllBranches(role) {
  return ['owner', 'manager', 'admin', 'administrator'].includes(String(role || '').toLowerCase());
}

function memberOf(db, threadId, key) {
  return !!db.prepare('SELECT 1 AS ok FROM connect_members WHERE thread_id = ? AND actor_key = ?').get(num(threadId), key);
}

function join(db, threadId, actor) {
  db.prepare(`INSERT INTO connect_members (thread_id, actor_key, role, joined_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(thread_id, actor_key) DO NOTHING`).run(num(threadId), actor.key, actor.role, now());
}

function ensureBranchThreads(db) {
  let branches = [];
  try { branches = db.prepare('SELECT id, name FROM branches ORDER BY name').all(); } catch (_) { branches = []; }
  for (const branch of branches) {
    const existing = db.prepare("SELECT id FROM connect_threads WHERE kind = 'branch' AND branch_id = ?").get(branch.id);
    if (existing) continue;
    db.prepare(`INSERT INTO connect_threads (kind, title, branch_id, created_by, created_at) VALUES ('branch', ?, ?, 'system', ?)`)
      .run(`${branch.name} branch`, branch.id, now());
  }
  return branches;
}

function notice(db, key, kind, title, body) {
  db.prepare('INSERT INTO connect_notices (actor_key, kind, title, body, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(key, kind, title, String(body || '').slice(0, 240), now());
}

function home(token) {
  const { db, actor } = actorFromToken(token);
  const branches = ensureBranchThreads(db);
  const profile = profileFor(db, actor);
  const unread = db.prepare('SELECT COUNT(*) AS n FROM connect_notices WHERE actor_key = ? AND read_at IS NULL').get(actor.key);
  return {
    profile,
    branches: branches.map((b) => ({ id: b.id, name: b.name })),
    unread: Number(unread && unread.n) || 0,
    marketingSeparate: true,
  };
}

function threads(token) {
  const { db, actor } = actorFromToken(token);
  ensureBranchThreads(db);
  const rows = db.prepare(`
    SELECT t.*, (SELECT body FROM connect_messages m WHERE m.thread_id = t.id ORDER BY m.id DESC LIMIT 1) AS last_body,
      (SELECT COUNT(*) FROM connect_members mb WHERE mb.thread_id = t.id) AS members
    FROM connect_threads t
    JOIN connect_members me ON me.thread_id = t.id AND me.actor_key = ?
    ORDER BY t.id DESC
  `).all(actor.key);
  const visible = rows.filter((row) => {
    if (row.kind !== 'branch') return true;
    if (seesAllBranches(actor.role) || actor.role === 'customer') return true;
    return !actor.branchId || Number(row.branch_id) === Number(actor.branchId);
  });
  return visible.map((row) => {
    let title = row.title;
    let code = '';
    if (row.kind === 'direct') {
      const other = db.prepare(`SELECT p.display_name, p.connect_code FROM connect_members m
        LEFT JOIN connect_profiles p ON p.actor_key = m.actor_key
        WHERE m.thread_id = ? AND m.actor_key != ? LIMIT 1`).get(row.id, actor.key);
      if (other) {
        title = other.display_name || 'Private chat';
        code = other.connect_code || '';
      }
    }
    return {
      id: row.id,
      kind: row.kind,
      title,
      code,
      branchId: row.branch_id,
      orderNumber: row.order_number || '',
      last: row.last_body || '',
      members: Number(row.members) || 0,
    };
  });
}

function openBranch(token, branchId) {
  const { db, actor } = actorFromToken(token);
  ensureBranchThreads(db);
  const id = num(branchId);
  const thread = db.prepare("SELECT * FROM connect_threads WHERE kind = 'branch' AND branch_id = ?").get(id);
  if (!thread) throw new Error('That branch is not on this Chisanyama account');
  if (actor.role !== 'customer' && !seesAllBranches(actor.role) && actor.branchId && actor.branchId !== id) {
    throw new Error('Your Chisanyama role does not include this branch');
  }
  join(db, thread.id, actor);
  return { id: thread.id, title: thread.title, branchId: thread.branch_id };
}

function messages(token, threadId) {
  const { db, actor } = actorFromToken(token);
  const id = num(threadId);
  if (!memberOf(db, id, actor.key)) throw new Error('You are not in this conversation');
  const thread = db.prepare('SELECT * FROM connect_threads WHERE id = ?').get(id);
  let title = thread ? thread.title : 'Chat';
  if (thread && thread.kind === 'direct') {
    const other = db.prepare(`SELECT p.display_name FROM connect_members m
      LEFT JOIN connect_profiles p ON p.actor_key = m.actor_key
      WHERE m.thread_id = ? AND m.actor_key != ? LIMIT 1`).get(id, actor.key);
    if (other && other.display_name) title = other.display_name;
  }
  const rows = db.prepare(`SELECT m.*, p.display_name FROM connect_messages m
    LEFT JOIN connect_profiles p ON p.actor_key = m.actor_key
    WHERE m.thread_id = ? ORDER BY m.id ASC LIMIT 200`).all(id);
  return {
    thread: thread ? { id: thread.id, title, kind: thread.kind, orderNumber: thread.order_number || '' } : null,
    messages: rows.map((row) => ({
      id: row.id,
      mine: row.actor_key === actor.key,
      name: row.display_name || 'Chisanyama',
      body: Number(row.hidden) === 1 ? 'Removed by the shop' : (row.body || ''),
      at: row.created_at,
    })),
  };
}

function send(token, threadId, text) {
  const { db, actor } = actorFromToken(token);
  requireActive(db, actor);
  const id = num(threadId);
  const body = String(text || '').trim().slice(0, 2000);
  if (!body) throw new Error('Type a message first');
  if (!memberOf(db, id, actor.key)) throw new Error('You are not in this conversation');
  const thread = db.prepare('SELECT * FROM connect_threads WHERE id = ?').get(id);
  const context = thread && thread.order_number ? { orderNumber: thread.order_number, orderId: thread.order_id || null } : null;
  db.prepare('INSERT INTO connect_messages (thread_id, actor_key, body, context_json, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, actor.key, body, context ? JSON.stringify(context) : null, now());
  const others = db.prepare('SELECT actor_key FROM connect_members WHERE thread_id = ? AND actor_key != ?').all(id, actor.key);
  for (const other of others) notice(db, other.actor_key, 'message', thread ? thread.title : 'New message', `${actor.name}: ${body}`);
  return { ok: true };
}

function orderContext(token) {
  const { db, actor } = actorFromToken(token);
  if (!actor.webCustomerId && !actor.customerId) return [];
  let rows = [];
  try {
    if (actor.webCustomerId) {
      rows = db.prepare(`SELECT id, order_number, status, total, branch_id FROM online_orders_local
        WHERE web_customer_id = ? ORDER BY id DESC LIMIT 8`).all(actor.webCustomerId);
    } else {
      rows = db.prepare(`SELECT id, order_number, status, total, branch_id FROM online_orders_local
        WHERE customer_id = ? ORDER BY id DESC LIMIT 8`).all(actor.customerId);
    }
  } catch (_) { rows = []; }
  return rows.map((row) => {
    let driver = '';
    try {
      const job = db.prepare(`SELECT driver_name, status FROM delivery_assignments
        WHERE order_number = ? ORDER BY id DESC LIMIT 1`).get(row.order_number);
      if (job) driver = job.driver_name || '';
    } catch (_) {}
    return {
      id: row.id,
      orderNumber: row.order_number,
      status: row.status,
      total: row.total,
      branchId: row.branch_id,
      driver,
    };
  });
}

function openOrder(token, orderId) {
  const { db, actor } = actorFromToken(token);
  const orders = orderContext(token);
  const order = orders.find((row) => Number(row.id) === num(orderId));
  if (!order) throw new Error('That order is not on your Chisanyama account');
  let thread = db.prepare("SELECT * FROM connect_threads WHERE kind = 'order' AND order_id = ?").get(order.id);
  if (!thread) {
    const info = db.prepare('INSERT INTO connect_threads (kind, title, branch_id, order_id, order_number, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('order', `Order ${order.orderNumber}`, order.branchId || null, order.id, order.orderNumber, actor.key, now());
    thread = { id: info.lastInsertRowid, title: `Order ${order.orderNumber}` };
  }
  join(db, thread.id, actor);
  try {
    const staff = db.prepare('SELECT id, role, branch_id FROM users WHERE is_active = 1').all();
    for (const person of staff) {
      const sameBranch = order.branchId && Number(person.branch_id) === Number(order.branchId);
      if (seesAllBranches(person.role) || sameBranch) join(db, thread.id, { key: `u:${person.id}`, role: person.role });
    }
  } catch (_) {}
  return { id: thread.id, title: thread.title || `Order ${order.orderNumber}`, orderNumber: order.orderNumber };
}

function visibleTo(db, actor, authorKey, hidden, authorBlocked) {
  if (Number(hidden) === 1 || Number(authorBlocked) === 1) return false;
  if (authorKey === actor.key) return true;
  return linkedKeys(db, actor.key).has(authorKey);
}

function mediaOf(row) {
  return {
    media: row.media_data || '',
    mediaKind: row.media_kind || (row.media_data ? 'image' : ''),
  };
}

function posts(token) {
  const { db, actor } = actorFromToken(token);
  const rows = db.prepare(`SELECT p.*, pr.display_name, pr.blocked AS author_blocked, pr.connect_code FROM connect_posts p
    LEFT JOIN connect_profiles pr ON pr.actor_key = p.actor_key
    ORDER BY p.id DESC LIMIT 80`).all();
  return rows.filter((row) => visibleTo(db, actor, row.actor_key, row.hidden, row.author_blocked)).slice(0, 40).map((row) => ({
    id: row.id, mine: row.actor_key === actor.key, name: row.display_name || 'Chisanyama',
    code: row.connect_code || '', body: row.body || '', ...mediaOf(row), at: row.created_at,
  }));
}

function storeMedia(media, kind) {
  const pic = String(media || '');
  const mediaKind = kind === 'video' ? 'video' : (pic ? 'image' : '');
  const limit = mediaKind === 'video' ? 1200000 : 180000;
  if (pic && pic.length > limit) throw new Error(mediaKind === 'video' ? 'That video is too large. Use a shorter clip.' : 'That photo is too large. Use a smaller one.');
  return { pic, mediaKind };
}

function reviewText(text) {
  const low = String(text || '').toLowerCase();
  return ['porn', 'xxx', 'nude', 'nudes'].some((word) => low.includes(word));
}

function publish(token, text, media, kind) {
  const { db, actor } = actorFromToken(token);
  requireActive(db, actor);
  const body = String(text || '').trim().slice(0, 1000);
  const stored = storeMedia(media, kind);
  if (!body && !stored.pic) throw new Error('Write something or add a photo or video');
  const flagged = reviewText(body) ? 1 : 0;
  db.prepare('INSERT INTO connect_posts (actor_key, body, media_data, media_kind, flagged, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(actor.key, body, stored.pic || null, stored.mediaKind || null, flagged, now());
  if (flagged) notifyModerators(db, 'Post needs a look', `${actor.name} posted something for review`);
  return { ok: true, flagged: !!flagged };
}

function stories(token) {
  const { db, actor } = actorFromToken(token);
  const rows = db.prepare(`SELECT s.*, p.display_name, p.blocked AS author_blocked, p.connect_code FROM connect_stories s
    LEFT JOIN connect_profiles p ON p.actor_key = s.actor_key
    WHERE s.expires_at > ? ORDER BY s.id DESC LIMIT 80`).all(now());
  return rows.filter((row) => visibleTo(db, actor, row.actor_key, row.hidden, row.author_blocked)).slice(0, 40).map((row) => ({
    id: row.id, mine: row.actor_key === actor.key, name: row.display_name || 'Chisanyama',
    code: row.connect_code || '', body: row.body || '', ...mediaOf(row), at: row.created_at,
  }));
}

function addStory(token, text, media, kind) {
  const { db, actor } = actorFromToken(token);
  requireActive(db, actor);
  const body = String(text || '').trim().slice(0, 280);
  const stored = storeMedia(media, kind);
  if (!body && !stored.pic) throw new Error('Add a status first');
  const flagged = reviewText(body) ? 1 : 0;
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO connect_stories (actor_key, body, media_data, media_kind, flagged, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(actor.key, body, stored.pic || null, stored.mediaKind || null, flagged, expires, now());
  if (flagged) notifyModerators(db, 'Status needs a look', `${actor.name} added a status for review`);
  return { ok: true, flagged: !!flagged };
}

function calls(token) {
  const { db, actor } = actorFromToken(token);
  const rows = db.prepare(`SELECT * FROM connect_calls
    WHERE started_by = ? OR peer_key = ? OR thread_id IN (SELECT thread_id FROM connect_members WHERE actor_key = ?)
    ORDER BY id DESC LIMIT 40`).all(actor.key, actor.key, actor.key);
  return rows.map((row) => ({
    id: row.id, kind: row.kind, status: row.status, mine: row.started_by === actor.key,
    at: row.started_at, ended: row.ended_at || '',
  }));
}

function startCall(token, threadId, kind) {
  const { db, actor } = actorFromToken(token);
  requireActive(db, actor);
  const id = num(threadId);
  if (!memberOf(db, id, actor.key)) throw new Error('You are not in this conversation');
  const mode = kind === 'video' || kind === 'group' ? kind : 'voice';
  const peer = db.prepare('SELECT actor_key FROM connect_members WHERE thread_id = ? AND actor_key != ? LIMIT 1').get(id, actor.key);
  const info = db.prepare(`INSERT INTO connect_calls (thread_id, kind, started_by, peer_key, status, started_at)
    VALUES (?, ?, ?, ?, 'ringing', ?)`).run(id, mode, actor.key, peer ? peer.actor_key : null, now());
  const others = db.prepare('SELECT actor_key FROM connect_members WHERE thread_id = ? AND actor_key != ?').all(id, actor.key);
  for (const other of others) notice(db, other.actor_key, 'call', 'Incoming call', `${actor.name} is calling`);
  return { id: info.lastInsertRowid, kind: mode, status: 'ringing' };
}

function signal(token, callId, payload) {
  const { db, actor } = actorFromToken(token);
  const call = db.prepare('SELECT * FROM connect_calls WHERE id = ?').get(num(callId));
  if (!call || !memberOf(db, call.thread_id, actor.key)) throw new Error('That call is not yours');
  const body = JSON.stringify(payload || {}).slice(0, 20000);
  const info = db.prepare('INSERT INTO connect_signals (call_id, from_key, payload, created_at) VALUES (?, ?, ?, ?)')
    .run(call.id, actor.key, body, now());
  return { id: info.lastInsertRowid };
}

function signals(token, callId, afterId) {
  const { db, actor } = actorFromToken(token);
  const call = db.prepare('SELECT * FROM connect_calls WHERE id = ?').get(num(callId));
  if (!call || !memberOf(db, call.thread_id, actor.key)) throw new Error('That call is not yours');
  const rows = db.prepare('SELECT * FROM connect_signals WHERE call_id = ? AND id > ? AND from_key != ? ORDER BY id ASC LIMIT 20')
    .all(call.id, num(afterId), actor.key);
  return {
    status: call.status,
    signals: rows.map((row) => ({ id: row.id, payload: JSON.parse(row.payload || '{}') })),
  };
}

function setCall(token, callId, status) {
  const { db, actor } = actorFromToken(token);
  const call = db.prepare('SELECT * FROM connect_calls WHERE id = ?').get(num(callId));
  if (!call || !memberOf(db, call.thread_id, actor.key)) throw new Error('That call is not yours');
  const next = ['answered', 'declined', 'missed', 'ended'].includes(status) ? status : 'ended';
  const ended = next === 'ended' || next === 'declined' || next === 'missed' ? now() : null;
  db.prepare('UPDATE connect_calls SET status = ?, ended_at = COALESCE(?, ended_at) WHERE id = ?').run(next, ended, call.id);
  if (next === 'missed' && call.started_by !== actor.key) notice(db, call.started_by, 'missed', 'Missed call', 'A call was missed');
  return { ok: true, status: next };
}

function notices(token) {
  const { db, actor } = actorFromToken(token);
  return db.prepare('SELECT id, kind, title, body, read_at, created_at FROM connect_notices WHERE actor_key = ? ORDER BY id DESC LIMIT 40')
    .all(actor.key);
}

function readNotice(token, id) {
  const { db, actor } = actorFromToken(token);
  db.prepare('UPDATE connect_notices SET read_at = ? WHERE id = ? AND actor_key = ?').run(now(), num(id), actor.key);
  return { ok: true };
}

function saveProfile(token, about) {
  const { db, actor } = actorFromToken(token);
  db.prepare('UPDATE connect_profiles SET about = ?, updated_at = ? WHERE actor_key = ?')
    .run(String(about || '').trim().slice(0, 180), now(), actor.key);
  return profileFor(db, actor);
}

function staffEnter(sessionUser) {
  const db = ensure();
  if (!sessionUser || !sessionUser.id) throw new Error('Sign in to Chisanyama admin first');
  const role = String(sessionUser.role || 'staff');
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO connect_access (token_hash, actor_key, role, expires_at, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(hash(token), `u:${sessionUser.id}`, role, expires, now());
  const key = `u:${sessionUser.id}`;
  touch(db, {
    key,
    name: sessionUser.full_name || sessionUser.name || sessionUser.username || 'Staff',
    role,
    userId: sessionUser.id,
  });
  return { token, url: '/connect/', connectCode: assignCode(db, key) };
}

function lookup(token, code) {
  const { db, actor } = actorFromToken(token);
  const person = personByCode(db, code);
  if (!person || person.actor_key === actor.key) throw new Error('That Connect number was not found');
  if (Number(person.blocked) === 1) throw new Error('That person is not available on Connect');
  return { name: person.display_name || 'Chisanyama', code: person.connect_code, role: person.role || '' };
}

function saveContact(token, code) {
  const { db, actor } = actorFromToken(token);
  requireActive(db, actor);
  const person = personByCode(db, code);
  if (!person || person.actor_key === actor.key) throw new Error('That Connect number was not found');
  if (Number(person.blocked) === 1) throw new Error('That person is not available on Connect');
  let thread = db.prepare(`SELECT t.id, t.title FROM connect_threads t
    JOIN connect_members a ON a.thread_id = t.id AND a.actor_key = ?
    JOIN connect_members b ON b.thread_id = t.id AND b.actor_key = ?
    WHERE t.kind = 'direct'`).get(actor.key, person.actor_key);
  if (!thread) {
    const info = db.prepare(`INSERT INTO connect_threads (kind, title, created_by, created_at) VALUES ('direct', 'Private', ?, ?)`)
      .run(actor.key, now());
    thread = { id: info.lastInsertRowid };
    join(db, thread.id, actor);
    join(db, thread.id, { key: person.actor_key, role: person.role });
    notice(db, person.actor_key, 'contact', 'New private chat', `${actor.name} saved your Connect number ${actor.connectCode || ''}`);
  }
  return { id: thread.id, name: person.display_name || 'Private chat', code: person.connect_code };
}

function report(token, kind, id) {
  const { db, actor } = actorFromToken(token);
  const table = kind === 'story' ? 'connect_stories' : kind === 'message' ? 'connect_messages' : 'connect_posts';
  const row = db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(num(id));
  if (!row) throw new Error('That item was not found');
  db.prepare(`UPDATE ${table} SET flagged = 1 WHERE id = ?`).run(row.id);
  notifyModerators(db, 'Something was reported', `${actor.name} reported a ${kind || 'post'}`);
  return { ok: true };
}

function notifyModerators(db, title, body) {
  const mods = db.prepare("SELECT actor_key FROM connect_profiles WHERE lower(role) IN ('owner', 'manager', 'admin', 'administrator')").all();
  for (const mod of mods) notice(db, mod.actor_key, 'moderation', title, body);
}

function assertMonitor(actor) {
  if (!seesAllBranches(actor.role)) throw new Error('Only a Chisanyama owner or manager can monitor Connect');
}

function adminPeople(token) {
  const { db, actor } = actorFromToken(token);
  assertMonitor(actor);
  try {
    const users = db.prepare('SELECT id, full_name, username, role FROM users WHERE is_active = 1').all();
    for (const user of users) {
      const key = `u:${user.id}`;
      touch(db, { key, name: user.full_name || user.username || 'Staff', role: user.role, userId: user.id });
      assignCode(db, key);
    }
  } catch (_) {}
  return db.prepare(`SELECT display_name, role, connect_code, blocked, approved FROM connect_profiles
    ORDER BY display_name`).all().map((row) => ({
    name: row.display_name || 'Chisanyama',
    role: row.role || '',
    code: row.connect_code || '',
    blocked: Number(row.blocked) === 1,
    approved: Number(row.approved) !== 0,
  }));
}

function adminPerson(token, code, action) {
  const { db, actor } = actorFromToken(token);
  assertMonitor(actor);
  const person = personByCode(db, code);
  if (!person) throw new Error('That Connect number was not found');
  if (person.actor_key === actor.key && action === 'block') throw new Error('You cannot block your own Connect number');
  const next = { blocked: Number(person.blocked) === 1 ? 1 : 0, approved: Number(person.approved) === 0 ? 0 : 1 };
  if (action === 'block') next.blocked = 1;
  if (action === 'unblock') next.blocked = 0;
  if (action === 'hold') next.approved = 0;
  if (action === 'approve') { next.approved = 1; next.blocked = 0; }
  db.prepare('UPDATE connect_profiles SET blocked = ?, approved = ?, updated_at = ? WHERE actor_key = ?')
    .run(next.blocked, next.approved, now(), person.actor_key);
  return { ok: true, code: person.connect_code, blocked: next.blocked === 1, approved: next.approved !== 0 };
}

function adminFeed(token) {
  const { db, actor } = actorFromToken(token);
  assertMonitor(actor);
  const posts = db.prepare(`SELECT p.id, p.body, p.media_kind, p.hidden, p.flagged, p.created_at, pr.display_name, pr.connect_code
    FROM connect_posts p LEFT JOIN connect_profiles pr ON pr.actor_key = p.actor_key
    ORDER BY p.flagged DESC, p.id DESC LIMIT 30`).all();
  const stories = db.prepare(`SELECT s.id, s.body, s.media_kind, s.hidden, s.flagged, s.created_at, pr.display_name, pr.connect_code
    FROM connect_stories s LEFT JOIN connect_profiles pr ON pr.actor_key = s.actor_key
    ORDER BY s.flagged DESC, s.id DESC LIMIT 30`).all();
  const messages = db.prepare(`SELECT m.id, m.body, m.hidden, m.flagged, m.created_at, pr.display_name, pr.connect_code
    FROM connect_messages m LEFT JOIN connect_profiles pr ON pr.actor_key = m.actor_key
    ORDER BY m.flagged DESC, m.id DESC LIMIT 30`).all();
  const map = (kind, row) => ({
    kind, id: row.id, name: row.display_name || 'Chisanyama', code: row.connect_code || '',
    body: String(row.body || '').slice(0, 280), mediaKind: row.media_kind || '',
    hidden: Number(row.hidden) === 1, flagged: Number(row.flagged) === 1, at: row.created_at,
  });
  return {
    posts: posts.map((row) => map('post', row)),
    stories: stories.map((row) => map('story', row)),
    messages: messages.map((row) => map('message', row)),
  };
}

function adminHide(token, kind, id, hidden) {
  const { db, actor } = actorFromToken(token);
  assertMonitor(actor);
  const table = kind === 'story' ? 'connect_stories' : kind === 'message' ? 'connect_messages' : 'connect_posts';
  const row = db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(num(id));
  if (!row) throw new Error('That item was not found');
  db.prepare(`UPDATE ${table} SET hidden = ? WHERE id = ?`).run(hidden ? 1 : 0, row.id);
  return { ok: true };
}

module.exports = {
  ensure, home, threads, openBranch, messages, send, orderContext, openOrder,
  posts, publish, stories, addStory, calls, startCall, signal, signals, setCall,
  notices, readNotice, saveProfile, staffEnter, lookup, saveContact, report,
  adminPeople, adminPerson, adminFeed, adminHide,
};

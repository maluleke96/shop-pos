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
  return db;
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
  return { db, actor };
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
  return visible.map((row) => ({
    id: row.id,
    kind: row.kind,
    title: row.title,
    branchId: row.branch_id,
    orderNumber: row.order_number || '',
    last: row.last_body || '',
    members: Number(row.members) || 0,
  }));
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
  const rows = db.prepare(`SELECT m.*, p.display_name FROM connect_messages m
    LEFT JOIN connect_profiles p ON p.actor_key = m.actor_key
    WHERE m.thread_id = ? ORDER BY m.id ASC LIMIT 200`).all(id);
  return {
    thread: thread ? { id: thread.id, title: thread.title, kind: thread.kind, orderNumber: thread.order_number || '' } : null,
    messages: rows.map((row) => ({
      id: row.id,
      mine: row.actor_key === actor.key,
      name: row.display_name || 'Chisanyama',
      body: row.body || '',
      at: row.created_at,
    })),
  };
}

function send(token, threadId, text) {
  const { db, actor } = actorFromToken(token);
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

function posts(token) {
  const { db, actor } = actorFromToken(token);
  const rows = db.prepare(`SELECT p.*, pr.display_name FROM connect_posts p
    LEFT JOIN connect_profiles pr ON pr.actor_key = p.actor_key
    ORDER BY p.id DESC LIMIT 40`).all();
  return rows.map((row) => ({
    id: row.id, mine: row.actor_key === actor.key, name: row.display_name || 'Chisanyama',
    body: row.body || '', media: row.media_data || '', at: row.created_at,
  }));
}

function publish(token, text, media) {
  const { db, actor } = actorFromToken(token);
  const body = String(text || '').trim().slice(0, 1000);
  const pic = String(media || '');
  if (pic && pic.length > 180000) throw new Error('That photo is too large. Use a smaller one.');
  if (!body && !pic) throw new Error('Write something or add a photo');
  db.prepare('INSERT INTO connect_posts (actor_key, body, media_data, created_at) VALUES (?, ?, ?, ?)')
    .run(actor.key, body, pic || null, now());
  return { ok: true };
}

function stories(token) {
  const { db, actor } = actorFromToken(token);
  const rows = db.prepare(`SELECT s.*, p.display_name FROM connect_stories s
    LEFT JOIN connect_profiles p ON p.actor_key = s.actor_key
    WHERE s.expires_at > ? ORDER BY s.id DESC LIMIT 40`).all(now());
  return rows.map((row) => ({
    id: row.id, mine: row.actor_key === actor.key, name: row.display_name || 'Chisanyama',
    body: row.body || '', media: row.media_data || '', at: row.created_at,
  }));
}

function addStory(token, text, media) {
  const { db, actor } = actorFromToken(token);
  const body = String(text || '').trim().slice(0, 280);
  const pic = String(media || '');
  if (pic && pic.length > 180000) throw new Error('That photo is too large. Use a smaller one.');
  if (!body && !pic) throw new Error('Add a status first');
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO connect_stories (actor_key, body, media_data, expires_at, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(actor.key, body, pic || null, expires, now());
  return { ok: true };
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
  touch(db, {
    key: `u:${sessionUser.id}`,
    name: sessionUser.full_name || sessionUser.name || sessionUser.username || 'Staff',
    role,
    userId: sessionUser.id,
  });
  return { token, url: '/connect/' };
}

module.exports = {
  ensure, home, threads, openBranch, messages, send, orderContext, openOrder,
  posts, publish, stories, addStory, calls, startCall, signal, signals, setCall,
  notices, readNotice, saveProfile, staffEnter,
};

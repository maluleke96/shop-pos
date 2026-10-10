/**
 * Chisanyama Games & Rewards.
 * Uses existing customers, web accounts, loyalty points, products and branches.
 * The server decides points, prizes and redemptions. Clients cannot set the result.
 * Paid cash wagering stays off until a legal flag is set.
 */
const crypto = require('crypto');
const { getDb } = require('../database/db');

const PERMISSIONS = [
  'games.view', 'games.play', 'games.manage', 'games.prizes.manage', 'games.rules.manage',
  'games.analytics', 'games.devices.manage', 'games.rewards.redeem', 'games.online.toggle', 'games.pos.access'
];

const CHANCE_TYPES = new Set(['wheel', 'mystery', 'scratch', 'cups', 'lucky']);
const SKILL_TYPES = new Set(['catcher', 'reaction', 'memory']);

let ready = false;

function db() { return getDb(); }

function execIgnore(sql) {
  try { db().exec(sql); } catch (_) { /* already present */ }
}

function nowIso() { return new Date().toISOString(); }

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function parseJson(value, fallback) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (_) { return fallback; }
}

function num(value) { return Math.floor(Number(value) || 0); }

function ensureGames() {
  if (ready) return;
  execIgnore(`CREATE TABLE IF NOT EXISTS game_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    settings_json TEXT
  )`);
  execIgnore(`CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    game_type TEXT NOT NULL,
    description TEXT,
    icon TEXT,
    image_url TEXT,
    point_cost INTEGER DEFAULT 0,
    daily_limit INTEGER DEFAULT 0,
    weekly_limit INTEGER DEFAULT 0,
    monthly_limit INTEGER DEFAULT 0,
    starts_at TEXT,
    ends_at TEXT,
    is_active INTEGER DEFAULT 1,
    archived INTEGER DEFAULT 0,
    branch_ids_json TEXT,
    config_json TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT,
    updated_at TEXT
  )`);
  execIgnore(`CREATE TABLE IF NOT EXISTS game_configurations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL,
    config_json TEXT,
    updated_by INTEGER,
    updated_at TEXT
  )`);
  execIgnore(`CREATE TABLE IF NOT EXISTS game_prizes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    prize_type TEXT NOT NULL,
    product_id INTEGER,
    voucher_cents INTEGER DEFAULT 0,
    bonus_points INTEGER DEFAULT 0,
    probability INTEGER DEFAULT 0,
    stock_total INTEGER,
    stock_awarded INTEGER DEFAULT 0,
    score_min INTEGER,
    is_active INTEGER DEFAULT 1
  )`);
  execIgnore(`CREATE TABLE IF NOT EXISTS game_plays (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL,
    customer_id INTEGER,
    web_customer_id INTEGER,
    device_id TEXT,
    branch_id INTEGER,
    channel TEXT,
    idempotency_key TEXT,
    points_spent INTEGER DEFAULT 0,
    credit_used INTEGER DEFAULT 0,
    status TEXT,
    score INTEGER,
    duration_ms INTEGER,
    result_json TEXT,
    reward_code TEXT,
    go_at TEXT,
    created_at TEXT,
    completed_at TEXT
  )`);
  execIgnore('CREATE UNIQUE INDEX IF NOT EXISTS idx_game_plays_idem ON game_plays(idempotency_key)');
  execIgnore(`CREATE TABLE IF NOT EXISTS game_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    play_id INTEGER NOT NULL,
    game_id INTEGER NOT NULL,
    customer_id INTEGER,
    prize_id INTEGER,
    result_json TEXT,
    created_at TEXT
  )`);
  execIgnore(`CREATE TABLE IF NOT EXISTS game_rewards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    play_id INTEGER,
    customer_id INTEGER,
    web_customer_id INTEGER,
    prize_id INTEGER,
    prize_name TEXT,
    prize_type TEXT,
    product_id INTEGER,
    voucher_cents INTEGER DEFAULT 0,
    bonus_points INTEGER DEFAULT 0,
    status TEXT DEFAULT 'UNUSED',
    redeemed_at TEXT,
    redeemed_by INTEGER,
    redeemed_by_name TEXT,
    branch_id INTEGER,
    sale_id INTEGER,
    created_at TEXT
  )`);
  execIgnore(`CREATE TABLE IF NOT EXISTS game_devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL UNIQUE,
    name TEXT,
    branch_id INTEGER,
    platform TEXT,
    version TEXT,
    last_online TEXT,
    kiosk_mode INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active',
    force_logout INTEGER DEFAULT 0
  )`);
  execIgnore(`CREATE TABLE IF NOT EXISTS game_audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    user_name TEXT,
    device_id TEXT,
    branch_id INTEGER,
    action TEXT NOT NULL,
    previous_json TEXT,
    next_json TEXT,
    reference_id TEXT,
    created_at TEXT
  )`);
  execIgnore(`CREATE TABLE IF NOT EXISTS game_eligibility_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER,
    rule_type TEXT NOT NULL,
    spend_amount REAL,
    plays_awarded INTEGER DEFAULT 1,
    product_id INTEGER,
    tiers_json TEXT,
    is_active INTEGER DEFAULT 1
  )`);
  execIgnore(`CREATE TABLE IF NOT EXISTS game_play_credits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER,
    web_customer_id INTEGER,
    game_id INTEGER,
    sale_id INTEGER,
    rule_id INTEGER,
    plays_total INTEGER DEFAULT 0,
    plays_used INTEGER DEFAULT 0,
    created_at TEXT
  )`);
  execIgnore('CREATE UNIQUE INDEX IF NOT EXISTS idx_game_credits_sale_rule ON game_play_credits(sale_id, rule_id)');
  execIgnore(`CREATE TABLE IF NOT EXISTS game_point_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER,
    web_customer_id INTEGER,
    play_id INTEGER,
    points INTEGER NOT NULL,
    direction TEXT NOT NULL,
    balance_after INTEGER,
    note TEXT,
    created_at TEXT
  )`);
  execIgnore(`CREATE TABLE IF NOT EXISTS game_customer_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash TEXT NOT NULL UNIQUE,
    customer_id INTEGER,
    web_customer_id INTEGER,
    expires_at TEXT NOT NULL,
    created_at TEXT
  )`);
  execIgnore(`CREATE TABLE IF NOT EXISTS game_entry_codes (
    code TEXT PRIMARY KEY,
    customer_id INTEGER,
    web_customer_id INTEGER,
    expires_at TEXT NOT NULL,
    used INTEGER DEFAULT 0
  )`);
  execIgnore(`CREATE TABLE IF NOT EXISTS game_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER,
    web_customer_id INTEGER,
    device_id TEXT,
    channel TEXT,
    started_at TEXT,
    ended_at TEXT
  )`);
  execIgnore(`CREATE TABLE IF NOT EXISTS game_leaderboards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    period TEXT,
    period_key TEXT,
    rank INTEGER,
    display_name TEXT,
    customer_id INTEGER,
    score INTEGER,
    created_at TEXT
  )`);
  seedIfEmpty();
  ready = true;
}

function defaultSettings() {
  return {
    games_button: false,
    games_online: false,
    games_app: true,
    games_pos: true,
    games_kiosk: true,
    kiosk_timeout_sec: 60,
    physical_legal_approved: false
  };
}

function getSettings() {
  ensureGames();
  const row = db().prepare('SELECT settings_json FROM game_settings WHERE id = 1').get();
  return { ...defaultSettings(), ...parseJson(row?.settings_json, {}) };
}

function saveSettings(next, actor) {
  ensureGames();
  requireStaff(actor, 'games.online.toggle');
  const prev = getSettings();
  const merged = { ...prev, ...next, physical_legal_approved: prev.physical_legal_approved };
  if (next.physical_legal_approved === true && actor?.role === 'owner') merged.physical_legal_approved = true;
  if (next.physical_legal_approved === false) merged.physical_legal_approved = false;
  const json = JSON.stringify(merged);
  const existing = db().prepare('SELECT id FROM game_settings WHERE id = 1').get();
  if (existing) db().prepare('UPDATE game_settings SET settings_json = ? WHERE id = 1').run(json);
  else db().prepare('INSERT INTO game_settings (id, settings_json) VALUES (1, ?)').run(json);
  audit(actor, 'games_settings', prev, merged, 'settings');
  return merged;
}

function publicConfig() {
  const s = getSettings();
  let shop = 'Chisanyama';
  try {
    shop = db().prepare('SELECT shop_name FROM shop_settings WHERE id = 1').get()?.shop_name || shop;
  } catch (_) { /* settings optional */ }
  return {
    show_button: !!(s.games_button && s.games_online),
    games_online: !!s.games_online,
    games_app: !!s.games_app,
    games_pos: !!s.games_pos,
    games_kiosk: !!s.games_kiosk,
    kiosk_timeout_sec: Math.max(15, num(s.kiosk_timeout_sec) || 60),
    shop_name: shop
  };
}

function seedIfEmpty() {
  const count = db().prepare('SELECT COUNT(*) AS c FROM games').get();
  if (num(count?.c) > 0) return;
  if (!db().prepare('SELECT id FROM game_settings WHERE id = 1').get()) {
    db().prepare('INSERT INTO game_settings (id, settings_json) VALUES (1, ?)').run(JSON.stringify(defaultSettings()));
  }
  const catalog = [
    ['wheel', 'Spin the Wheel', 'wheel', 'Spin for chips, a drink, or a voucher.', '🎡', 10, 0],
    ['mystery', 'Mystery Box', 'mystery', 'Pick a box and reveal the reward.', '🎁', 15, 1],
    ['scratch', 'Scratch & Win', 'scratch', 'Scratch the card with your finger.', '🪙', 10, 2],
    ['cups', 'Pick a Cup', 'cups', 'Choose a cup. A loyalty reward is revealed.', '🥤', 10, 3],
    ['catcher', 'Food Catcher', 'catcher', 'Catch the falling food. Your score sets the reward.', '🍗', 5, 4],
    ['reaction', 'Reaction Challenge', 'reaction', 'Wait for GO, then tap as fast as you can.', '⚡', 5, 5],
    ['memory', 'Memory Game', 'memory', 'Match the food pairs before time runs out.', '🧠', 8, 6],
    ['lucky', 'Lucky Number', 'lucky', 'Pick a number from 1 to 20.', '🔢', 10, 7],
    ['physical', 'Physical Cup Challenge', 'physical', 'Not available. Paid chance games stay off until legal approval.', '🎯', 0, 8]
  ];
  const insert = db().prepare(`INSERT INTO games
    (code, name, game_type, description, icon, point_cost, is_active, archived, config_json, sort_order, daily_limit, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const now = nowIso();
  for (const row of catalog) {
    const active = row[0] === 'physical' ? 0 : 1;
    const config = row[0] === 'catcher'
      ? { seconds: 20, tiers: [{ min: 300, prize: 'Free chips' }, { min: 200, prize: 'R5 voucher' }, { min: 100, prize: 'Bonus points' }] }
      : row[0] === 'reaction'
        ? { win_ms: 500 }
        : row[0] === 'memory'
          ? { pairs: 6, seconds: 60 }
          : row[0] === 'mystery' || row[0] === 'cups'
            ? { choices: 3 }
            : row[0] === 'lucky'
              ? { max: 20 }
              : {};
    insert.run(row[0], row[1], row[2], row[3], row[4], row[5], active, 0, JSON.stringify(config), row[6], 30, now, now);
  }
  const games = db().prepare('SELECT id, code FROM games').all();
  const byCode = Object.fromEntries(games.map((g) => [g.code, g.id]));
  const prize = db().prepare(`INSERT INTO game_prizes
    (game_id, name, prize_type, voucher_cents, bonus_points, probability, stock_total, stock_awarded, is_active)
    VALUES (?,?,?,?,?,?,?,?,1)`);
  const wheel = [
    ['Free chips', 'product', 0, 0, 12, 100],
    ['Free Russian', 'product', 0, 0, 8, 50],
    ['Free drink', 'product', 0, 0, 15, 100],
    ['R5 voucher', 'voucher', 500, 0, 10, 200],
    ['R10 voucher', 'voucher', 1000, 0, 6, 100],
    ['Bonus points', 'points', 0, 20, 18, null],
    ['Free meal', 'product', 0, 0, 3, 20],
    ['Try again', 'try_again', 0, 0, 26, null],
    ['Jackpot', 'jackpot', 0, 0, 2, 5]
  ];
  for (const code of ['wheel', 'mystery', 'scratch', 'cups', 'lucky']) {
    for (const p of wheel) prize.run(byCode[code], p[0], p[1], p[2], p[3], p[4], p[5], 0);
  }
  for (const code of ['catcher', 'reaction', 'memory']) {
    prize.run(byCode[code], 'Free chips', 'product', 0, 0, 0, 100, 0);
    prize.run(byCode[code], 'R5 voucher', 'voucher', 500, 0, 0, 200, 0);
    prize.run(byCode[code], 'Bonus points', 'points', 0, 5, 0, null, 0);
    prize.run(byCode[code], 'Try again', 'try_again', 0, 0, 0, null, 0);
  }
  db().prepare(`INSERT INTO game_eligibility_rules (game_id, rule_type, tiers_json, is_active)
    VALUES (NULL, 'spend_tiers', ?, 1)`).run(JSON.stringify([
    { min: 200, plays: 5 },
    { min: 100, plays: 2 },
    { min: 50, plays: 1 }
  ]));
}

function audit(actor, action, previous, next, reference, extra) {
  try {
    db().prepare(`INSERT INTO game_audit_logs
      (user_id, user_name, device_id, branch_id, action, previous_json, next_json, reference_id, created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(
      actor?.id || extra?.customer_id || null,
      actor?.full_name || actor?.username || extra?.name || 'customer',
      extra?.device_id || null,
      extra?.branch_id || null,
      action,
      previous == null ? null : JSON.stringify(previous),
      next == null ? null : JSON.stringify(next),
      reference == null ? null : String(reference),
      nowIso()
    );
  } catch (_) { /* audit must not break play */ }
}

function staffRow(actor) {
  if (!actor?.id) return null;
  try {
    return db().prepare('SELECT id, username, full_name, role, permissions, is_active FROM users WHERE id = ?').get(Number(actor.id));
  } catch (_) {
    return actor;
  }
}

function staffCan(actor, perm) {
  const row = staffRow(actor);
  if (!row) return false;
  if (String(row.role) === 'owner') return true;
  let perms = {};
  try { perms = parseJson(row.permissions, {}); } catch (_) { perms = {}; }
  if (perms[perm] === false || perms[perm] === 0) return false;
  if (perms[perm] === true || perms[perm] === 1) return true;
  if (String(row.role) === 'manager' && perm !== 'games.online.toggle') return true;
  if (['games.pos.access', 'games.rewards.redeem'].includes(perm)
    && ['cashier', 'supervisor', 'assistant_manager', 'manager'].includes(String(row.role))) return true;
  return false;
}

function requireStaff(actor, perm) {
  if (!staffCan(actor, perm)) throw new Error('You do not have permission for this Games action');
  return staffRow(actor) || actor;
}

function maskPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 6) return '';
  return `${digits.slice(0, 3)} *** ${digits.slice(-3)}`;
}

function maskEmail(email) {
  const value = String(email || '').trim();
  const at = value.indexOf('@');
  if (at < 1) return '';
  return `${value.slice(0, 1)}***${value.slice(at)}`;
}

function displayName(row) {
  const full = String(row?.first_name || row?.name || row?.full_name || 'Player').trim();
  const first = full.split(/\s+/)[0] || 'Player';
  const last = String(row?.last_name || '').trim() || (full.split(/\s+/)[1] || '');
  return last ? `${first} ${last[0].toUpperCase()}.` : first;
}

function linkFromWeb(web) {
  return {
    customer_id: web.customer_id ? Number(web.customer_id) : null,
    web_customer_id: web.id ? Number(web.id) : null,
    first_name: web.first_name || '',
    last_name: web.last_name || '',
    name: `${web.first_name || ''} ${web.last_name || ''}`.trim(),
    phone: web.phone || '',
    email: web.email || ''
  };
}

function customerFromToken(token) {
  ensureGames();
  if (!token) throw new Error('Sign in required');
  try {
    const web = require('./online-ordering').resolveWebCustomer(token);
    if (web) return linkFromWeb(web);
  } catch (_) { /* online accounts optional in tests */ }
  const row = db().prepare(`SELECT * FROM game_customer_sessions WHERE token_hash = ? AND expires_at > ?`).get(hashToken(token), nowIso());
  if (!row) throw new Error('Sign in required');
  let person = { name: 'Customer' };
  if (row.customer_id) {
    try { person = db().prepare('SELECT id, name, phone, email FROM customers WHERE id = ?').get(row.customer_id) || person; } catch (_) { /* */ }
  }
  if (row.web_customer_id) {
    try {
      const web = db().prepare('SELECT id, first_name, last_name, phone, email, customer_id FROM web_customers WHERE id = ?').get(row.web_customer_id);
      if (web) return linkFromWeb(web);
    } catch (_) { /* */ }
  }
  return {
    customer_id: row.customer_id || null,
    web_customer_id: row.web_customer_id || null,
    name: person.name || 'Customer',
    first_name: person.name || 'Customer',
    phone: person.phone || '',
    email: person.email || ''
  };
}

function pointsOf(link) {
  if (link.customer_id) {
    const row = db().prepare('SELECT loyalty_points FROM customers WHERE id = ?').get(link.customer_id);
    return Math.max(0, num(row?.loyalty_points));
  }
  if (link.web_customer_id) {
    const row = db().prepare('SELECT loyalty_points FROM web_customers WHERE id = ?').get(link.web_customer_id);
    return Math.max(0, num(row?.loyalty_points));
  }
  return 0;
}

function writeLoyalty(link, delta, note) {
  if (!link.customer_id || !delta) return;
  try {
    db().prepare('INSERT INTO loyalty_transactions (customer_id, points, type, notes) VALUES (?,?,?,?)')
      .run(link.customer_id, delta, delta > 0 ? 'earn' : 'redeem', note);
  } catch (_) {
    try {
      db().prepare('INSERT INTO loyalty_transactions (customer_id, points, type) VALUES (?,?,?)')
        .run(link.customer_id, delta, delta > 0 ? 'earn' : 'redeem');
    } catch (__) { /* ledger shape varies */ }
  }
}

function setPoints(link, next) {
  const balance = Math.max(0, num(next));
  if (link.customer_id) {
    db().prepare('UPDATE customers SET loyalty_points = ? WHERE id = ?').run(balance, link.customer_id);
    try { db().prepare('UPDATE web_customers SET loyalty_points = ? WHERE customer_id = ?').run(balance, link.customer_id); } catch (_) { /* */ }
    return balance;
  }
  db().prepare('UPDATE web_customers SET loyalty_points = ? WHERE id = ?').run(balance, link.web_customer_id);
  return balance;
}

function changePoints(link, delta, playId, note) {
  const before = pointsOf(link);
  if (delta < 0 && before < Math.abs(delta)) throw new Error('Insufficient points');
  const after = setPoints(link, before + delta);
  if (delta < 0 && after !== before + delta) throw new Error('Insufficient points');
  writeLoyalty(link, delta, note);
  if (delta < 0 && link.customer_id) {
    try { require('./loyalty-points').consumeLotsFifo(link.customer_id, Math.abs(delta)); } catch (_) { /* lots optional */ }
  }
  if (delta > 0 && link.customer_id) {
    try { require('./loyalty-points').addPointLot(link.customer_id, delta, null); } catch (_) { /* lots optional */ }
  }
  db().prepare(`INSERT INTO game_point_transactions
    (customer_id, web_customer_id, play_id, points, direction, balance_after, note, created_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(
    link.customer_id, link.web_customer_id, playId || null, delta, delta < 0 ? 'spend' : 'award', after, note || null, nowIso()
  );
  return after;
}

function availablePlays(link, gameId) {
  const rows = db().prepare(`SELECT plays_total, plays_used FROM game_play_credits
    WHERE plays_used < plays_total AND (customer_id = ? OR web_customer_id = ?)
    AND (game_id IS NULL OR game_id = ?)`).all(link.customer_id || 0, link.web_customer_id || 0, gameId || 0);
  return rows.reduce((sum, row) => sum + Math.max(0, num(row.plays_total) - num(row.plays_used)), 0);
}

function takeCredit(link, gameId) {
  const row = db().prepare(`SELECT * FROM game_play_credits
    WHERE plays_used < plays_total AND (customer_id = ? OR web_customer_id = ?)
    AND (game_id IS NULL OR game_id = ?)
    ORDER BY id LIMIT 1`).get(link.customer_id || 0, link.web_customer_id || 0, gameId || 0);
  if (!row) return null;
  db().prepare('UPDATE game_play_credits SET plays_used = plays_used + 1 WHERE id = ? AND plays_used < plays_total').run(row.id);
  const after = db().prepare('SELECT plays_used FROM game_play_credits WHERE id = ?').get(row.id);
  if (num(after?.plays_used) !== num(row.plays_used) + 1) return null;
  return row;
}

function refundCredit(credit) {
  if (!credit?.id) return;
  db().prepare('UPDATE game_play_credits SET plays_used = CASE WHEN plays_used > 0 THEN plays_used - 1 ELSE 0 END WHERE id = ?').run(credit.id);
}

function loadGame(idOrCode) {
  const game = typeof idOrCode === 'number' || /^\d+$/.test(String(idOrCode || ''))
    ? db().prepare('SELECT * FROM games WHERE id = ?').get(Number(idOrCode))
    : db().prepare('SELECT * FROM games WHERE code = ?').get(String(idOrCode || ''));
  if (!game) throw new Error('Game not found');
  game.config = parseJson(game.config_json, {});
  return game;
}

function assertPlayable(game, channel) {
  const settings = getSettings();
  if (game.game_type === 'physical' && !settings.physical_legal_approved) {
    throw new Error('This game is not available. Paid chance play stays off until it is legally approved.');
  }
  if (num(game.archived) || !num(game.is_active)) throw new Error('This game is turned off');
  const now = nowIso();
  if (game.starts_at && now < game.starts_at) throw new Error('This game has not started');
  if (game.ends_at && now > game.ends_at) throw new Error('This game has ended');
  const ch = String(channel || 'app');
  if (ch === 'online' && !settings.games_online) throw new Error('Games are turned off on the website');
  if (ch === 'app' && !settings.games_app) throw new Error('The Games app is turned off');
  if (ch === 'kiosk' && !settings.games_kiosk) throw new Error('Customer kiosk games are turned off');
  if (ch === 'pos' && !settings.games_pos) throw new Error('POS games are turned off');
}

function countPlays(link, gameId, sinceIso) {
  const row = db().prepare(`SELECT COUNT(*) AS c FROM game_plays
    WHERE game_id = ? AND status = 'completed' AND created_at >= ?
    AND (customer_id = ? OR web_customer_id = ?)`).get(gameId, sinceIso, link.customer_id || 0, link.web_customer_id || 0);
  return num(row?.c);
}

function assertLimits(game, link) {
  const now = new Date();
  const day = new Date(now); day.setHours(0, 0, 0, 0);
  const week = new Date(day); week.setDate(week.getDate() - week.getDay());
  const month = new Date(now.getFullYear(), now.getMonth(), 1);
  if (num(game.daily_limit) && countPlays(link, game.id, day.toISOString()) >= num(game.daily_limit)) {
    throw new Error('Daily play limit reached');
  }
  if (num(game.weekly_limit) && countPlays(link, game.id, week.toISOString()) >= num(game.weekly_limit)) {
    throw new Error('Weekly play limit reached');
  }
  if (num(game.monthly_limit) && countPlays(link, game.id, month.toISOString()) >= num(game.monthly_limit)) {
    throw new Error('Monthly play limit reached');
  }
}

function activePrizes(gameId) {
  return db().prepare('SELECT * FROM game_prizes WHERE game_id = ? AND is_active = 1').all(gameId).filter((prize) => {
    if (prize.stock_total == null || prize.stock_total === '') return true;
    return num(prize.stock_awarded) < num(prize.stock_total);
  });
}

function claimPrize(prize) {
  if (!prize) return false;
  const before = num(prize.stock_awarded);
  if (prize.stock_total != null && prize.stock_total !== '' && before >= num(prize.stock_total)) return false;
  db().prepare(`UPDATE game_prizes SET stock_awarded = COALESCE(stock_awarded, 0) + 1
    WHERE id = ? AND (stock_total IS NULL OR COALESCE(stock_awarded, 0) < stock_total)`).run(prize.id);
  const after = db().prepare('SELECT stock_awarded FROM game_prizes WHERE id = ?').get(prize.id);
  return num(after?.stock_awarded) === before + 1;
}

function releasePrize(prizeId) {
  if (!prizeId) return;
  db().prepare('UPDATE game_prizes SET stock_awarded = CASE WHEN stock_awarded > 0 THEN stock_awarded - 1 ELSE 0 END WHERE id = ?').run(prizeId);
}

function pickWeighted(prizes) {
  const pool = prizes.filter((prize) => num(prize.probability) > 0);
  const source = pool.length ? pool : prizes;
  if (!source.length) throw new Error('No prizes are available');
  const total = source.reduce((sum, prize) => sum + Math.max(1, num(prize.probability) || 1), 0);
  let roll = crypto.randomInt(total);
  for (const prize of source) {
    roll -= Math.max(1, num(prize.probability) || 1);
    if (roll < 0) return prize;
  }
  return source[source.length - 1];
}

function pickAvailable(gameId, filter) {
  let pool = activePrizes(gameId);
  if (filter) pool = pool.filter(filter);
  if (!pool.length) pool = activePrizes(gameId);
  for (let i = 0; i < 6 && pool.length; i += 1) {
    const prize = pickWeighted(pool);
    if (claimPrize(prize)) return prize;
    pool = pool.filter((item) => item.id !== prize.id);
  }
  throw new Error('No prizes are available');
}

function takeNamed(gameId, name) {
  const preferred = prizeByName(gameId, name);
  if (preferred && (preferred.prize_type === 'try_again' || claimPrize(preferred))) return preferred;
  const fallback = prizeByName(gameId, 'Try again');
  if (fallback && fallback !== preferred) claimPrize(fallback);
  return fallback || preferred;
}

function prizeByName(gameId, name) {
  const wanted = String(name || '').trim().toLowerCase();
  return db().prepare('SELECT * FROM game_prizes WHERE game_id = ? AND is_active = 1').all(gameId)
    .find((prize) => String(prize.name || '').trim().toLowerCase() === wanted) || null;
}

function rewardCode() {
  for (let i = 0; i < 6; i += 1) {
    const code = `GAME-${crypto.randomInt(100000, 1000000)}`;
    if (!db().prepare('SELECT id FROM game_rewards WHERE code = ?').get(code)) return code;
  }
  throw new Error('Could not create a reward code');
}

function issueReward(link, playId, prize) {
  if (!prize || prize.prize_type === 'try_again') return null;
  const code = rewardCode();
  db().prepare(`INSERT INTO game_rewards
    (code, play_id, customer_id, web_customer_id, prize_id, prize_name, prize_type, product_id, voucher_cents, bonus_points, status, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?, 'UNUSED', ?)`).run(
    code, playId, link.customer_id, link.web_customer_id, prize.id, prize.name, prize.prize_type,
    prize.product_id || null, num(prize.voucher_cents), num(prize.bonus_points), nowIso()
  );
  if (prize.prize_type === 'points' && num(prize.bonus_points) > 0) {
    changePoints(link, num(prize.bonus_points), playId, `Games reward ${code}`);
  }
  return code;
}

function publicPrize(prize, code) {
  if (!prize) return { name: 'Try again', prize_type: 'try_again', code: null };
  return {
    name: prize.name,
    prize_type: prize.prize_type,
    product_id: prize.product_id || null,
    voucher_cents: num(prize.voucher_cents),
    bonus_points: num(prize.bonus_points),
    code: code || null
  };
}

function finishRecord(link, playId, game, prize, extra, pointsSpent, creditUsed) {
  const code = issueReward(link, playId, prize);
  const result = {
    play_id: playId,
    game_id: game.id,
    game_code: game.code,
    game_name: game.name,
    points_spent: pointsSpent,
    credit_used: creditUsed ? 1 : 0,
    points_balance: pointsOf(link),
    available_plays: availablePlays(link, game.id),
    prize: publicPrize(prize, code),
    ...extra
  };
  db().prepare(`UPDATE game_plays SET status = 'completed', result_json = ?, reward_code = ?, completed_at = ?, score = ?, duration_ms = ? WHERE id = ?`)
    .run(JSON.stringify(result), code, nowIso(), extra.score == null ? null : num(extra.score), extra.duration_ms || null, playId);
  db().prepare(`INSERT INTO game_results (play_id, game_id, customer_id, prize_id, result_json, created_at)
    VALUES (?,?,?,?,?,?)`).run(playId, game.id, link.customer_id, prize?.id || null, JSON.stringify(result), nowIso());
  audit(null, code ? 'customer_won_reward' : 'customer_played', null, { code, prize: prize?.name || 'Try again', points: pointsSpent }, playId, {
    customer_id: link.customer_id, name: displayName(link), device_id: extra.device_id, branch_id: extra.branch_id
  });
  if (pointsSpent) {
    audit(null, 'customer_spent_points', null, { points: pointsSpent, balance: result.points_balance }, playId, { customer_id: link.customer_id, name: displayName(link) });
  }
  return result;
}

function replay(existing) {
  if (!existing) return null;
  if (existing.status === 'completed' && existing.result_json) return parseJson(existing.result_json, null);
  if (existing.status === 'open') {
    return { play_id: existing.id, phase: 'play', game_id: existing.game_id, points_balance: null };
  }
  return null;
}

function play(token, body) {
  ensureGames();
  const payload = body || {};
  const link = customerFromToken(token);
  if (payload.play_id) return finishSkill(link, payload);
  const game = loadGame(payload.game_id || payload.code);
  assertPlayable(game, payload.channel);
  assertDevice(payload.device_id);
  const key = String(payload.idempotency_key || '').trim();
  if (!key) throw new Error('Play request is missing an id');
  const existing = db().prepare('SELECT * FROM game_plays WHERE idempotency_key = ?').get(key);
  const again = replay(existing);
  if (again) return again;
  assertLimits(game, link);
  const cost = Math.max(0, num(game.point_cost));
  let credit = null;
  let spent = 0;
  if (cost > 0) {
    credit = takeCredit(link, game.id);
    if (!credit) {
      if (pointsOf(link) < cost) throw new Error('Insufficient points');
      spent = cost;
    }
  }
  let playId = null;
  try {
    const inserted = db().prepare(`INSERT INTO game_plays
      (game_id, customer_id, web_customer_id, device_id, branch_id, channel, idempotency_key, points_spent, credit_used, status, created_at)
      VALUES (?,?,?,?,?,?,?,?,?, 'pending', ?)`).run(
      game.id, link.customer_id, link.web_customer_id, payload.device_id || null, payload.branch_id || null,
      payload.channel || 'app', key, spent, credit ? 1 : 0, nowIso()
    );
    playId = inserted.lastInsertRowid;
    if (spent) changePoints(link, -spent, playId, `Games play ${game.name}`);
  } catch (err) {
    if (credit) refundCredit(credit);
    const raced = db().prepare('SELECT * FROM game_plays WHERE idempotency_key = ?').get(key);
    const racedResult = replay(raced);
    if (racedResult) return racedResult;
    if (raced) throw new Error('This play is already in progress');
    throw err;
  }
  try {
    if (SKILL_TYPES.has(game.game_type)) {
      db().prepare(`UPDATE game_plays SET status = 'open' WHERE id = ?`).run(playId);
      return {
        play_id: playId,
        phase: 'play',
        game_id: game.id,
        game_code: game.code,
        game_type: game.game_type,
        config: customerConfig(game),
        points_spent: spent,
        points_balance: pointsOf(link)
      };
    }
    return resolveChance(link, game, playId, payload, spent, !!credit);
  } catch (err) {
    if (spent) {
      try { changePoints(link, spent, playId, 'Games play refund'); } catch (_) { /* keep the error */ }
    }
    if (credit) refundCredit(credit);
    db().prepare(`UPDATE game_plays SET status = 'failed', result_json = ? WHERE id = ?`).run(JSON.stringify({ error: err.message }), playId);
    throw err;
  }
}

function customerConfig(game) {
  const config = game.config || {};
  return {
    seconds: config.seconds || null,
    pairs: config.pairs || null,
    choices: config.choices || 3,
    max: config.max || 20
  };
}

function resolveChance(link, game, playId, payload, spent, creditUsed) {
  const prizes = activePrizes(game.id);
  let prize;
  const extra = { device_id: payload.device_id, branch_id: payload.branch_id };
  if (game.game_type === 'lucky') {
    const max = Math.max(2, num(game.config.max) || 20);
    const picked = num(payload.number);
    if (picked < 1 || picked > max) throw new Error(`Choose a number from 1 to ${max}`);
    const drawn = crypto.randomInt(1, max + 1);
    extra.drawn = drawn;
    extra.picked = picked;
    extra.matched = picked === drawn;
    prize = extra.matched
      ? pickAvailable(game.id, (item) => item.prize_type !== 'try_again')
      : pickAvailable(game.id, (item) => item.prize_type === 'try_again' || item.prize_type === 'points');
  } else {
    if (!prizes.length) throw new Error('No prizes are available');
    prize = pickAvailable(game.id);
  }
  const prizesOrdered = db().prepare('SELECT id FROM game_prizes WHERE game_id = ? AND is_active = 1 ORDER BY id').all(game.id);
  extra.segment = Math.max(0, prizesOrdered.findIndex((item) => item.id === prize.id));
  extra.segment_count = prizesOrdered.length;
  extra.choice = payload.choice == null ? null : num(payload.choice);
  return finishRecord(link, playId, game, prize, extra, spent, creditUsed);
}

function finishSkill(link, payload) {
  const row = db().prepare('SELECT * FROM game_plays WHERE id = ?').get(num(payload.play_id));
  if (!row || row.status !== 'open') throw new Error('This play is already finished');
  if (Number(row.customer_id || 0) !== Number(link.customer_id || 0) && Number(row.web_customer_id || 0) !== Number(link.web_customer_id || 0)) {
    throw new Error('This play belongs to another customer');
  }
  const game = loadGame(row.game_id);
  const started = new Date(row.created_at).getTime();
  const elapsed = Math.max(0, Date.now() - started);
  let prize;
  const extra = { device_id: row.device_id, branch_id: row.branch_id, duration_ms: elapsed };
  if (game.game_type === 'reaction') {
    if (payload.action === 'arm') {
      if (!row.go_at) db().prepare('UPDATE game_plays SET go_at = ? WHERE id = ?').run(nowIso(), row.id);
      return { play_id: row.id, phase: 'armed' };
    }
    if (!row.go_at) throw new Error('Wait for GO');
    const reaction = Math.max(0, Date.now() - new Date(row.go_at).getTime());
    if (reaction < 80) throw new Error('That reaction time is not valid');
    extra.duration_ms = reaction;
    extra.reaction_ms = reaction;
    const win = reaction <= (num(game.config.win_ms) || 500);
    prize = takeNamed(game.id, win ? 'Bonus points' : 'Try again');
  } else if (game.game_type === 'catcher') {
    const reported = Math.max(0, num(payload.score));
    const cap = Math.floor(elapsed / 30);
    const score = Math.min(reported, cap);
    extra.score = score;
    const tiers = Array.isArray(game.config.tiers) ? [...game.config.tiers].sort((a, b) => num(b.min) - num(a.min)) : [];
    const tier = tiers.find((item) => score >= num(item.min));
    prize = takeNamed(game.id, tier ? tier.prize : 'Try again');
  } else if (game.game_type === 'memory') {
    const pairs = num(game.config.pairs) || 6;
    const matched = num(payload.matches);
    const fastEnough = elapsed >= pairs * 400;
    const within = elapsed <= ((num(game.config.seconds) || 60) * 1000) + 2000;
    extra.score = matched;
    const won = matched >= pairs && fastEnough && within;
    prize = takeNamed(game.id, won ? 'Bonus points' : 'Try again');
  } else {
    throw new Error('This game does not take a score');
  }
  if (prize && prize.prize_type === 'try_again') {
    /* stock is unlimited for try again */
  }
  return finishRecord(link, row.id, game, prize, extra, num(row.points_spent), num(row.credit_used));
}

function assertDevice(deviceId) {
  if (!deviceId) return;
  const device = db().prepare('SELECT status FROM game_devices WHERE device_id = ?').get(String(deviceId));
  if (device && String(device.status) === 'disabled') throw new Error('This device is disabled');
}

function catalog(token, channel) {
  ensureGames();
  const link = token ? safeLink(token) : null;
  const settings = getSettings();
  const games = db().prepare('SELECT * FROM games WHERE archived = 0 ORDER BY sort_order, id').all().filter((game) => {
    if (game.game_type === 'physical' && !settings.physical_legal_approved) return false;
    if (!num(game.is_active)) return false;
    const now = nowIso();
    if (game.starts_at && now < game.starts_at) return false;
    if (game.ends_at && now > game.ends_at) return false;
    return true;
  }).map((game) => ({
    id: game.id,
    code: game.code,
    name: game.name,
    game_type: game.game_type,
    description: game.description,
    icon: game.icon,
    point_cost: num(game.point_cost),
    free_plays: link ? availablePlays(link, game.id) : 0,
    status: 'ACTIVE',
    config: customerConfig({ ...game, config: parseJson(game.config_json, {}) })
  }));
  return { games, channel: channel || 'app', config: publicConfig() };
}

function safeLink(token) {
  try { return customerFromToken(token); } catch (_) { return null; }
}

function home(token) {
  const link = customerFromToken(token);
  const rewards = listRewards(link).filter((reward) => reward.status === 'UNUSED');
  return {
    name: displayName(link),
    full_name: link.name || `${link.first_name || ''} ${link.last_name || ''}`.trim(),
    customer_id: link.customer_id,
    points: pointsOf(link),
    available_plays: availablePlays(link, null),
    rewards: rewards.length,
    games: catalog(token).games
  };
}

function listRewards(link) {
  return db().prepare(`SELECT code, prize_name, prize_type, status, voucher_cents, bonus_points, product_id, created_at, redeemed_at
    FROM game_rewards WHERE customer_id = ? OR web_customer_id = ? ORDER BY id DESC LIMIT 100`)
    .all(link.customer_id || 0, link.web_customer_id || 0);
}

function history(token) {
  const link = customerFromToken(token);
  const plays = db().prepare(`SELECT p.created_at, p.points_spent, p.reward_code, p.status, g.name AS game_name, p.result_json
    FROM game_plays p JOIN games g ON g.id = p.game_id
    WHERE p.customer_id = ? OR p.web_customer_id = ?
    ORDER BY p.id DESC LIMIT 50`).all(link.customer_id || 0, link.web_customer_id || 0).map((row) => {
    const result = parseJson(row.result_json, {});
    return {
      at: row.created_at,
      game: row.game_name,
      points: num(row.points_spent),
      prize: result?.prize?.name || null,
      code: row.reward_code || null,
      status: row.status
    };
  });
  return { plays, rewards: listRewards(link) };
}

function leaderboard(period) {
  ensureGames();
  const key = ['day', 'week', 'month'].includes(period) ? period : 'week';
  const start = new Date();
  if (key === 'day') start.setHours(0, 0, 0, 0);
  else if (key === 'week') { start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - start.getDay()); }
  else start.setDate(1);
  const rows = db().prepare(`SELECT customer_id, web_customer_id, COUNT(*) AS plays
    FROM game_plays WHERE status = 'completed' AND created_at >= ?
    GROUP BY customer_id, web_customer_id
    ORDER BY plays DESC LIMIT 20`).all(start.toISOString());
  const board = rows.map((row, index) => {
    let person = {};
    if (row.web_customer_id) {
      try { person = db().prepare('SELECT first_name, last_name FROM web_customers WHERE id = ?').get(row.web_customer_id) || {}; } catch (_) { /* */ }
    } else if (row.customer_id) {
      try { person = db().prepare('SELECT name FROM customers WHERE id = ?').get(row.customer_id) || {}; } catch (_) { /* */ }
    }
    return { rank: index + 1, name: displayName(person), score: num(row.plays) };
  });
  try {
    db().prepare('DELETE FROM game_leaderboards WHERE period = ? AND period_key = ?').run(key, start.toISOString().slice(0, 10));
    const insert = db().prepare(`INSERT INTO game_leaderboards (period, period_key, rank, display_name, score, created_at) VALUES (?,?,?,?,?,?)`);
    for (const row of board) insert.run(key, start.toISOString().slice(0, 10), row.rank, row.name, row.score, nowIso());
  } catch (_) { /* snapshot is optional */ }
  return { period: key, players: board, insufficient: board.length === 0 };
}

function profile(token) {
  const link = customerFromToken(token);
  const board = leaderboard('month').players;
  const mine = board.find((row) => row.name === displayName(link));
  return {
    name: displayName(link),
    customer_id: link.customer_id,
    points: pointsOf(link),
    available_plays: availablePlays(link, null),
    rewards: listRewards(link),
    phone_masked: maskPhone(link.phone),
    email_masked: maskEmail(link.email),
    leaderboard_position: mine ? mine.rank : null
  };
}

function registerDevice(body) {
  ensureGames();
  const deviceId = String(body?.device_id || '').trim();
  if (!deviceId) throw new Error('Device id required');
  const existing = db().prepare('SELECT * FROM game_devices WHERE device_id = ?').get(deviceId);
  const now = nowIso();
  if (!existing) {
    db().prepare(`INSERT INTO game_devices (device_id, name, branch_id, platform, version, last_online, kiosk_mode, status)
      VALUES (?,?,?,?,?,?,?, 'active')`).run(deviceId, body.name || 'Games device', body.branch_id || null, body.platform || '', body.version || '', now, body.kiosk ? 1 : 0);
    audit(null, 'device_registered', null, { device_id: deviceId, name: body.name || '' }, deviceId);
  } else {
    db().prepare(`UPDATE game_devices SET name = COALESCE(?, name), platform = COALESCE(?, platform), version = COALESCE(?, version),
      last_online = ?, kiosk_mode = ?, branch_id = COALESCE(?, branch_id) WHERE device_id = ?`).run(
      body.name || null, body.platform || null, body.version || null, now, body.kiosk ? 1 : 0, body.branch_id || null, deviceId
    );
  }
  const device = db().prepare('SELECT device_id, name, status, force_logout, kiosk_mode, branch_id FROM game_devices WHERE device_id = ?').get(deviceId);
  if (num(device?.force_logout)) {
    db().prepare('UPDATE game_devices SET force_logout = 0 WHERE device_id = ?').run(deviceId);
    device.force_logout = 1;
  }
  return device;
}

function grantPlaysForSale(sale) {
  ensureGames();
  const customerId = num(sale?.customerId || sale?.customer_id);
  const saleId = num(sale?.saleId || sale?.id);
  if (!customerId || !saleId) return { granted: 0 };
  const total = Number(sale.total) || 0;
  const items = Array.isArray(sale.items) ? sale.items : [];
  const rules = db().prepare('SELECT * FROM game_eligibility_rules WHERE is_active = 1').all();
  let granted = 0;
  for (const rule of rules) {
    let plays = 0;
    if (rule.rule_type === 'spend_tiers') {
      const tiers = parseJson(rule.tiers_json, []).sort((a, b) => num(b.min) - num(a.min));
      const tier = tiers.find((item) => total + 0.001 >= Number(item.min));
      plays = tier ? num(tier.plays) : 0;
    } else if (rule.rule_type === 'spend' && total + 0.001 >= Number(rule.spend_amount)) {
      plays = num(rule.plays_awarded) || 1;
    } else if (rule.rule_type === 'product' && items.some((item) => num(item.product_id) === num(rule.product_id))) {
      plays = num(rule.plays_awarded) || 1;
    }
    if (plays <= 0) continue;
    const exists = db().prepare('SELECT id FROM game_play_credits WHERE sale_id = ? AND rule_id = ?').get(saleId, rule.id);
    if (exists) continue;
    db().prepare(`INSERT INTO game_play_credits (customer_id, game_id, sale_id, rule_id, plays_total, plays_used, created_at)
      VALUES (?,?,?,?,?,0,?)`).run(customerId, rule.game_id || null, saleId, rule.id, plays, nowIso());
    granted += plays;
  }
  if (granted) audit(null, 'purchase_plays_granted', null, { sale_id: saleId, plays: granted }, saleId, { customer_id: customerId });
  return { granted };
}

function revokePlaysForSale(saleId, ratio) {
  ensureGames();
  if (Number(ratio) < 0.999) return { revoked: 0 };
  const rows = db().prepare('SELECT * FROM game_play_credits WHERE sale_id = ?').all(num(saleId));
  let revoked = 0;
  for (const row of rows) {
    const unused = num(row.plays_total) - num(row.plays_used);
    if (unused > 0) {
      db().prepare('UPDATE game_play_credits SET plays_total = plays_used WHERE id = ?').run(row.id);
      revoked += unused;
    }
  }
  if (revoked) audit(null, 'purchase_plays_revoked', null, { sale_id: saleId, plays: revoked }, saleId);
  return { revoked };
}

function dashboard(actor) {
  requireStaff(actor, 'games.manage');
  const players = db().prepare(`SELECT COUNT(DISTINCT COALESCE(customer_id, web_customer_id)) AS c FROM game_plays WHERE status = 'completed'`).get();
  const day = new Date(); day.setHours(0, 0, 0, 0);
  const today = db().prepare(`SELECT COUNT(*) AS c, COALESCE(SUM(points_spent), 0) AS points FROM game_plays WHERE status = 'completed' AND created_at >= ?`).get(day.toISOString());
  const awarded = db().prepare(`SELECT COUNT(*) AS c FROM game_rewards`).get();
  const redeemed = db().prepare(`SELECT COUNT(*) AS c FROM game_rewards WHERE status = 'REDEEMED'`).get();
  const activeGames = db().prepare(`SELECT COUNT(*) AS c FROM games WHERE is_active = 1 AND archived = 0 AND game_type != 'physical'`).get();
  const devices = db().prepare(`SELECT COUNT(*) AS c FROM game_devices WHERE status = 'active'`).get();
  const topGame = db().prepare(`SELECT g.name, COUNT(*) AS c FROM game_plays p JOIN games g ON g.id = p.game_id
    WHERE p.status = 'completed' GROUP BY p.game_id ORDER BY c DESC LIMIT 1`).get();
  let topBranch = null;
  try {
    const top = db().prepare(`SELECT branch_id, COUNT(*) AS c FROM game_plays
      WHERE status = 'completed' AND branch_id IS NOT NULL
      GROUP BY branch_id ORDER BY c DESC LIMIT 1`).get();
    if (top?.branch_id) {
      topBranch = db().prepare('SELECT name FROM branches WHERE id = ?').get(top.branch_id)?.name || null;
    }
  } catch (_) { topBranch = null; }
  const plays = num(today?.c);
  return {
    total_players: num(players?.c),
    todays_plays: plays,
    points_spent: num(today?.points),
    rewards_awarded: num(awarded?.c),
    rewards_redeemed: num(redeemed?.c),
    active_games: num(activeGames?.c),
    active_devices: num(devices?.c),
    top_game: topGame?.name || null,
    top_branch: topBranch,
    insufficient: plays === 0,
    settings: getSettings()
  };
}

function adminGames(actor) {
  requireStaff(actor, 'games.manage');
  return db().prepare('SELECT * FROM games ORDER BY sort_order, id').all().map((game) => ({
    ...game,
    config: parseJson(game.config_json, {}),
    prizes: db().prepare('SELECT * FROM game_prizes WHERE game_id = ? ORDER BY id').all(game.id)
  }));
}

function saveGame(actor, body) {
  requireStaff(actor, 'games.manage');
  const data = body || {};
  const now = nowIso();
  if (data.game_type === 'physical' && !getSettings().physical_legal_approved) data.is_active = 0;
  if (data.id) {
    const prev = db().prepare('SELECT * FROM games WHERE id = ?').get(num(data.id));
    if (!prev) throw new Error('Game not found');
    db().prepare(`UPDATE games SET name = ?, description = ?, icon = ?, point_cost = ?, daily_limit = ?, weekly_limit = ?, monthly_limit = ?,
      starts_at = ?, ends_at = ?, is_active = ?, branch_ids_json = ?, config_json = ?, updated_at = ? WHERE id = ?`).run(
      data.name || prev.name, data.description ?? prev.description, data.icon || prev.icon, num(data.point_cost ?? prev.point_cost),
      num(data.daily_limit ?? prev.daily_limit), num(data.weekly_limit ?? prev.weekly_limit), num(data.monthly_limit ?? prev.monthly_limit),
      data.starts_at || null, data.ends_at || null, data.is_active ? 1 : 0, JSON.stringify(data.branch_ids || parseJson(prev.branch_ids_json, [])),
      JSON.stringify(data.config || parseJson(prev.config_json, {})), now, prev.id
    );
    db().prepare('INSERT INTO game_configurations (game_id, config_json, updated_by, updated_at) VALUES (?,?,?,?)')
      .run(prev.id, JSON.stringify(data.config || parseJson(prev.config_json, {})), actor.id, now);
    audit(actor, data.is_active ? 'game_activated' : 'game_disabled', { is_active: prev.is_active, point_cost: prev.point_cost }, data, prev.id);
    return loadGame(prev.id);
  }
  const code = String(data.code || data.name || 'game').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `game-${Date.now()}`;
  const inserted = db().prepare(`INSERT INTO games (code, name, game_type, description, icon, point_cost, daily_limit, is_active, config_json, sort_order, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(code, data.name || 'New game', data.game_type || 'wheel', data.description || '', data.icon || '🎮', num(data.point_cost), num(data.daily_limit), data.is_active ? 1 : 0, JSON.stringify(data.config || {}), 20, now, now);
  audit(actor, 'game_created', null, { name: data.name, code }, inserted.lastInsertRowid);
  return loadGame(inserted.lastInsertRowid);
}

function archiveGame(actor, gameId) {
  requireStaff(actor, 'games.manage');
  const prev = loadGame(gameId);
  db().prepare('UPDATE games SET archived = 1, is_active = 0, updated_at = ? WHERE id = ?').run(nowIso(), prev.id);
  audit(actor, 'game_archived', { archived: 0 }, { archived: 1 }, prev.id);
  return { success: true };
}

function savePrize(actor, body) {
  requireStaff(actor, 'games.prizes.manage');
  const data = body || {};
  const game = loadGame(data.game_id);
  if (data.id) {
    const prev = db().prepare('SELECT * FROM game_prizes WHERE id = ?').get(num(data.id));
    db().prepare(`UPDATE game_prizes SET name = ?, prize_type = ?, product_id = ?, voucher_cents = ?, bonus_points = ?, probability = ?, stock_total = ?, is_active = ? WHERE id = ?`)
      .run(data.name || prev.name, data.prize_type || prev.prize_type, data.product_id || null, num(data.voucher_cents), num(data.bonus_points), num(data.probability), data.stock_total === '' || data.stock_total == null ? null : num(data.stock_total), data.is_active ? 1 : 0, prev.id);
    audit(actor, 'prize_updated', prev, data, prev.id);
    return db().prepare('SELECT * FROM game_prizes WHERE id = ?').get(prev.id);
  }
  const inserted = db().prepare(`INSERT INTO game_prizes (game_id, name, prize_type, product_id, voucher_cents, bonus_points, probability, stock_total, stock_awarded, is_active)
    VALUES (?,?,?,?,?,?,?,?,0,1)`).run(game.id, data.name || 'Prize', data.prize_type || 'product', data.product_id || null, num(data.voucher_cents), num(data.bonus_points), num(data.probability), data.stock_total == null || data.stock_total === '' ? null : num(data.stock_total));
  audit(actor, 'prize_created', null, data, inserted.lastInsertRowid);
  return db().prepare('SELECT * FROM game_prizes WHERE id = ?').get(inserted.lastInsertRowid);
}

function listInventory(actor) {
  requireStaff(actor, 'games.prizes.manage');
  return db().prepare(`SELECT p.*, g.name AS game_name FROM game_prizes p JOIN games g ON g.id = p.game_id ORDER BY g.sort_order, p.id`).all().map((row) => ({
    ...row,
    remaining: row.stock_total == null ? null : Math.max(0, num(row.stock_total) - num(row.stock_awarded))
  }));
}

function listRules(actor) {
  requireStaff(actor, 'games.rules.manage');
  return db().prepare('SELECT * FROM game_eligibility_rules ORDER BY id').all().map((row) => ({ ...row, tiers: parseJson(row.tiers_json, []) }));
}

function saveRule(actor, body) {
  requireStaff(actor, 'games.rules.manage');
  const data = body || {};
  if (data.id) {
    const prev = db().prepare('SELECT * FROM game_eligibility_rules WHERE id = ?').get(num(data.id));
    db().prepare(`UPDATE game_eligibility_rules SET game_id = ?, rule_type = ?, spend_amount = ?, plays_awarded = ?, product_id = ?, tiers_json = ?, is_active = ? WHERE id = ?`)
      .run(data.game_id || null, data.rule_type || prev.rule_type, data.spend_amount || null, num(data.plays_awarded || prev.plays_awarded), data.product_id || null, JSON.stringify(data.tiers || parseJson(prev.tiers_json, [])), data.is_active ? 1 : 0, prev.id);
    audit(actor, 'rule_updated', prev, data, prev.id);
    return db().prepare('SELECT * FROM game_eligibility_rules WHERE id = ?').get(prev.id);
  }
  const inserted = db().prepare(`INSERT INTO game_eligibility_rules (game_id, rule_type, spend_amount, plays_awarded, product_id, tiers_json, is_active)
    VALUES (?,?,?,?,?,?,1)`).run(data.game_id || null, data.rule_type || 'spend', data.spend_amount || null, num(data.plays_awarded) || 1, data.product_id || null, JSON.stringify(data.tiers || []));
  audit(actor, 'rule_created', null, data, inserted.lastInsertRowid);
  return db().prepare('SELECT * FROM game_eligibility_rules WHERE id = ?').get(inserted.lastInsertRowid);
}

function adminRewards(actor) {
  requireStaff(actor, 'games.manage');
  return db().prepare(`SELECT id, code, prize_name, prize_type, status, customer_id, created_at, redeemed_at, redeemed_by_name, branch_id, sale_id
    FROM game_rewards ORDER BY id DESC LIMIT 200`).all();
}

function adminPlays(actor) {
  requireStaff(actor, 'games.analytics');
  return db().prepare(`SELECT p.id, p.created_at, p.status, p.points_spent, p.reward_code, p.channel, g.name AS game_name, p.customer_id
    FROM game_plays p JOIN games g ON g.id = p.game_id ORDER BY p.id DESC LIMIT 200`).all();
}

function adminAudit(actor) {
  requireStaff(actor, 'games.analytics');
  return db().prepare('SELECT * FROM game_audit_logs ORDER BY id DESC LIMIT 200').all();
}

function adminDevices(actor) {
  requireStaff(actor, 'games.devices.manage');
  return db().prepare('SELECT * FROM game_devices ORDER BY last_online DESC').all();
}

function updateDevice(actor, body) {
  requireStaff(actor, 'games.devices.manage');
  const device = db().prepare('SELECT * FROM game_devices WHERE id = ? OR device_id = ?').get(num(body.id), String(body.device_id || ''));
  if (!device) throw new Error('Device not found');
  const prev = { status: device.status, name: device.name, branch_id: device.branch_id };
  db().prepare('UPDATE game_devices SET name = ?, branch_id = ?, status = ?, force_logout = ? WHERE id = ?')
    .run(body.name || device.name, body.branch_id || null, body.status || device.status, body.force_logout ? 1 : device.force_logout, device.id);
  audit(actor, body.status === 'disabled' ? 'device_disabled' : 'device_updated', prev, body, device.device_id);
  return db().prepare('SELECT * FROM game_devices WHERE id = ?').get(device.id);
}

function listBranches() {
  try { return db().prepare('SELECT id, name, code FROM branches ORDER BY name').all(); } catch (_) { return []; }
}

function listProducts() {
  try {
    return db().prepare('SELECT id, name FROM products ORDER BY name LIMIT 300').all();
  } catch (_) { return []; }
}

function searchCustomers(actor, query) {
  requireStaff(actor, 'games.pos.access');
  const q = String(query || '').trim();
  if (q.length < 2) return [];
  const like = `%${q}%`;
  let rows = [];
  try {
    rows = db().prepare(`SELECT id, name, phone, email, loyalty_points FROM customers
      WHERE name LIKE ? OR phone LIKE ? OR email LIKE ? OR CAST(id AS TEXT) = ? ORDER BY name LIMIT 20`).all(like, like, like, q);
  } catch (_) { rows = []; }
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    phone_masked: maskPhone(row.phone),
    email_masked: maskEmail(row.email),
    points: num(row.loyalty_points)
  }));
}

function posCustomer(actor, customerId) {
  requireStaff(actor, 'games.pos.access');
  const customer = db().prepare('SELECT id, name, phone, email, loyalty_points FROM customers WHERE id = ?').get(num(customerId));
  if (!customer) throw new Error('Customer not found');
  let web = null;
  try { web = db().prepare('SELECT id FROM web_customers WHERE customer_id = ? ORDER BY id DESC LIMIT 1').get(customer.id); } catch (_) { web = null; }
  const link = { customer_id: customer.id, web_customer_id: web?.id || null, name: customer.name };
  const rewards = db().prepare(`SELECT code, prize_name, prize_type, status, created_at FROM game_rewards
    WHERE customer_id = ? ORDER BY id DESC LIMIT 30`).all(customer.id);
  const plays = db().prepare(`SELECT p.created_at, g.name AS game_name, p.points_spent, p.reward_code
    FROM game_plays p JOIN games g ON g.id = p.game_id WHERE p.customer_id = ? ORDER BY p.id DESC LIMIT 20`).all(customer.id);
  return {
    id: customer.id,
    name: customer.name,
    phone_masked: maskPhone(customer.phone),
    points: pointsOf(link),
    available_plays: availablePlays(link, null),
    rewards,
    plays
  };
}

function redeem(actor, code, extra) {
  requireStaff(actor, 'games.rewards.redeem');
  const reward = db().prepare('SELECT * FROM game_rewards WHERE code = ?').get(String(code || '').trim().toUpperCase());
  if (!reward) throw new Error('Reward not found');
  if (reward.status === 'REDEEMED') throw new Error('This reward was already redeemed');
  if (reward.status !== 'UNUSED') throw new Error('This reward cannot be redeemed');
  db().prepare(`UPDATE game_rewards SET status = 'REDEEMED', redeemed_at = ?, redeemed_by = ?, redeemed_by_name = ?, branch_id = ?, sale_id = ? WHERE id = ? AND status = 'UNUSED'`)
    .run(nowIso(), actor.id, actor.full_name || actor.username || '', extra?.branch_id || null, extra?.sale_id || null, reward.id);
  const after = db().prepare('SELECT status FROM game_rewards WHERE id = ?').get(reward.id);
  if (after?.status !== 'REDEEMED') throw new Error('This reward was already redeemed');
  audit(actor, 'reward_redeemed', { status: 'UNUSED' }, { status: 'REDEEMED', code: reward.code }, reward.code, { branch_id: extra?.branch_id || null });
  return { code: reward.code, prize_name: reward.prize_name, prize_type: reward.prize_type, product_id: reward.product_id, status: 'REDEEMED' };
}

function posEntry(actor, customerId) {
  requireStaff(actor, 'games.pos.access');
  const customer = db().prepare('SELECT id, name FROM customers WHERE id = ?').get(num(customerId));
  if (!customer) throw new Error('Customer not found');
  let web = null;
  try { web = db().prepare('SELECT id FROM web_customers WHERE customer_id = ? ORDER BY id DESC LIMIT 1').get(customer.id); } catch (_) { web = null; }
  const token = crypto.randomBytes(24).toString('hex');
  const expires = new Date(Date.now() + 20 * 60 * 1000).toISOString();
  db().prepare(`INSERT INTO game_customer_sessions (token_hash, customer_id, web_customer_id, expires_at, created_at) VALUES (?,?,?,?,?)`)
    .run(hashToken(token), customer.id, web?.id || null, expires, nowIso());
  audit(actor, 'pos_customer_play', null, { customer_id: customer.id }, customer.id);
  return { token, expires_at: expires, name: customer.name };
}

module.exports = {
  PERMISSIONS,
  ensureGames,
  publicConfig,
  getSettings,
  saveSettings,
  catalog,
  home,
  play,
  history,
  leaderboard,
  profile,
  registerDevice,
  grantPlaysForSale,
  revokePlaysForSale,
  dashboard,
  adminGames,
  saveGame,
  archiveGame,
  savePrize,
  listInventory,
  listRules,
  saveRule,
  adminRewards,
  adminPlays,
  adminAudit,
  adminDevices,
  updateDevice,
  listBranches,
  listProducts,
  searchCustomers,
  posCustomer,
  redeem,
  posEntry,
  staffCan
};

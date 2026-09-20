/**
 * First Online Customer Gift — issues real gift cards from the existing
 * gift_cards table. One authenticated web account can win once per campaign.
 * Daily winner positions are allocated inside a database transaction.
 */
const { getDb } = require('../database/db');

const CAMPAIGN_KEY = 'first_online_gift';
const TEST_CUSTOMER_FLOOR = 900000000;

function dbGet(sql, p = []) { return getDb().prepare(sql).get(...p); }
function dbAll(sql, p = []) { return getDb().prepare(sql).all(...p); }
function dbRun(sql, p = []) { return getDb().prepare(sql).run(...p); }

function shopToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' });
}

function nowIso() { return new Date().toISOString(); }

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

function defaultCampaign() {
  return {
    id: 1,
    campaign_key: CAMPAIGN_KEY,
    name: 'First Online Customer Gift',
    enabled: 0,
    daily_limit: 10,
    gift_amount: 10,
    min_order_amount: 0,
    start_date: null,
    end_date: null,
    expiry_days: 30,
    online_only: 1,
    one_per_account: 1
  };
}

function isPgCloud() {
  try {
    return !!(process.env.SHOP_POS_DATABASE_URL || process.env.DATABASE_URL);
  } catch (_) { return false; }
}

function ensureFirstOnlineGiftSchema() {
  const db = getDb();
  const pg = isPgCloud();
  const awardsId = pg ? 'id SERIAL PRIMARY KEY' : 'id INTEGER PRIMARY KEY AUTOINCREMENT';
  db.exec(`
    CREATE TABLE IF NOT EXISTS first_online_gift_campaigns (
      id INTEGER PRIMARY KEY,
      campaign_key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 0,
      daily_limit INTEGER NOT NULL DEFAULT 10,
      gift_amount REAL NOT NULL DEFAULT 10,
      min_order_amount REAL NOT NULL DEFAULT 0,
      start_date TEXT,
      end_date TEXT,
      expiry_days INTEGER,
      online_only INTEGER NOT NULL DEFAULT 1,
      one_per_account INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS first_online_gift_days (
      campaign_id INTEGER NOT NULL,
      award_date TEXT NOT NULL,
      awarded_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (campaign_id, award_date)
    );
    CREATE TABLE IF NOT EXISTS first_online_gift_awards (
      ${awardsId},
      campaign_id INTEGER NOT NULL,
      award_date TEXT NOT NULL,
      position INTEGER NOT NULL,
      web_customer_id INTEGER NOT NULL,
      customer_id INTEGER,
      customer_name TEXT,
      order_id INTEGER,
      order_number TEXT,
      gift_card_id INTEGER,
      gift_card_code TEXT,
      amount REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'issued',
      created_at TEXT
    );
  `);
  try {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_fog_award_account
      ON first_online_gift_awards (campaign_id, web_customer_id) WHERE status = 'issued'`);
  } catch (_) { /* */ }
  try {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_fog_award_day_pos
      ON first_online_gift_awards (campaign_id, award_date, position) WHERE status = 'issued'`);
  } catch (_) { /* */ }
  try {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_fog_award_order
      ON first_online_gift_awards (order_id) WHERE order_id IS NOT NULL AND status = 'issued'`);
  } catch (_) { /* */ }
  const existing = dbGet('SELECT id FROM first_online_gift_campaigns WHERE id = 1');
  if (!existing) {
    const d = defaultCampaign();
    dbRun(`INSERT INTO first_online_gift_campaigns
      (id, campaign_key, name, enabled, daily_limit, gift_amount, min_order_amount, start_date, end_date, expiry_days, online_only, one_per_account, updated_at)
      VALUES (1,?,?,0,?,?,?,?,?,?,1,1,?)`,
      [d.campaign_key, d.name, d.daily_limit, d.gift_amount, d.min_order_amount, d.start_date, d.end_date, d.expiry_days, nowIso()]);
  }
}

function normalizeCampaign(row) {
  const d = defaultCampaign();
  const r = row || {};
  return {
    id: Number(r.id) || 1,
    campaign_key: r.campaign_key || CAMPAIGN_KEY,
    name: r.name || d.name,
    enabled: Number(r.enabled) === 1 || r.enabled === true,
    daily_limit: Math.max(1, parseInt(r.daily_limit, 10) || 10),
    gift_amount: round2(r.gift_amount != null ? r.gift_amount : 10),
    min_order_amount: round2(r.min_order_amount || 0),
    start_date: r.start_date || null,
    end_date: r.end_date || null,
    expiry_days: r.expiry_days != null && r.expiry_days !== '' ? Math.max(1, parseInt(r.expiry_days, 10) || 30) : null,
    online_only: true,
    one_per_account: true,
    updated_at: r.updated_at || null
  };
}

function getCampaign(actor) {
  if (actor) {
    const { assertUserActor } = require('./authz');
    assertUserActor(actor, ['owner', 'manager']);
  }
  ensureFirstOnlineGiftSchema();
  return normalizeCampaign(dbGet('SELECT * FROM first_online_gift_campaigns WHERE id = 1'));
}

function saveCampaign(data, actor) {
  const { assertUserActor } = require('./authz');
  const user = assertUserActor(actor, ['owner', 'manager']);
  ensureFirstOnlineGiftSchema();
  const next = normalizeCampaign({ ...getCampaign(), ...data });
  if (!(next.gift_amount > 0)) throw new Error('Gift card value must be greater than zero');
  if (!(next.daily_limit > 0)) throw new Error('Daily winner limit must be at least 1');
  if (next.start_date && next.end_date && next.start_date > next.end_date) {
    throw new Error('End date must be on or after the start date');
  }
  dbRun(`UPDATE first_online_gift_campaigns SET
    enabled=?, daily_limit=?, gift_amount=?, min_order_amount=?, start_date=?, end_date=?,
    expiry_days=?, updated_at=? WHERE id = 1`,
    [next.enabled ? 1 : 0, next.daily_limit, next.gift_amount, next.min_order_amount,
      next.start_date || null, next.end_date || null, next.expiry_days, nowIso()]);
  try {
    require('./store').audit(user.id, user.username || user.full_name, 'save_first_online_gift',
      'first_online_gift_campaign', 1, next);
  } catch (_) { /* */ }
  return getCampaign();
}

function campaignIsLive(campaign, day) {
  if (!campaign?.enabled) return false;
  if (campaign.start_date && day < String(campaign.start_date).slice(0, 10)) return false;
  if (campaign.end_date && day > String(campaign.end_date).slice(0, 10)) return false;
  return true;
}

function makeGiftCode() {
  const chunk = () => Math.random().toString(36).slice(2, 6).toUpperCase().replace(/[^A-Z0-9]/g, 'X');
  return `CHISA-${chunk()}${chunk().slice(0, 1)}-${chunk()}`;
}

function qualifyingOrderValue(order) {
  return round2((Number(order.total) || 0) + (Number(order.gift_card_amount) || 0));
}

function isFailedStatus(status) {
  const s = String(status || '').toLowerCase();
  return s === 'rejected' || s === 'cancelled' || s === 'pending_payment';
}

function todayProgress(day = shopToday()) {
  ensureFirstOnlineGiftSchema();
  const campaign = getCampaign();
  const issued = dbAll(`SELECT * FROM first_online_gift_awards
    WHERE campaign_id = 1 AND award_date = ? AND status = 'issued' ORDER BY position ASC`, [day]);
  const remaining = Math.max(0, campaign.daily_limit - issued.length);
  return {
    date: day,
    live: campaignIsLive(campaign, day),
    daily_limit: campaign.daily_limit,
    winners_awarded: issued.length,
    remaining,
    gift_amount: campaign.gift_amount,
    issued_value: round2(issued.reduce((n, a) => n + Number(a.amount || 0), 0)),
    next_position: issued.length + 1,
    liability: round2(campaign.daily_limit * campaign.gift_amount)
  };
}

function listWinners(filters = {}, actor) {
  if (actor) {
    const { assertUserActor } = require('./authz');
    assertUserActor(actor, ['owner', 'manager']);
  }
  ensureFirstOnlineGiftSchema();
  const day = filters.date || shopToday();
  return dbAll(`SELECT a.*, g.status AS gift_status, g.balance AS gift_balance,
      g.approval_status, g.expires_at AS gift_expires_at
    FROM first_online_gift_awards a
    LEFT JOIN gift_cards g ON g.id = a.gift_card_id
    WHERE a.campaign_id = 1 AND a.award_date = ?
    ORDER BY a.position ASC, a.id ASC`, [day]);
}

function awardForOrder(orderId) {
  if (!orderId) return null;
  ensureFirstOnlineGiftSchema();
  return dbGet(`SELECT * FROM first_online_gift_awards WHERE order_id = ? AND status = 'issued'`, [orderId]);
}

function walletCardsForWebCustomer(customer) {
  if (!customer?.id) return [];
  ensureFirstOnlineGiftSchema();
  return dbAll(`SELECT g.code, g.balance, g.status, g.expires_at
    FROM first_online_gift_awards a
    JOIN gift_cards g ON g.id = a.gift_card_id
    WHERE a.web_customer_id = ? AND a.status = 'issued'`, [customer.id]);
}

function getDashboard(filters = {}, actor) {
  const campaign = getCampaign(actor);
  const day = filters.date || shopToday();
  const progress = todayProgress(day);
  const winners = listWinners({ date: day });
  return { campaign, progress, winners };
}

function assertGiftOwnedByWebCustomer(code, webCustomer) {
  if (!code || !webCustomer?.id) return;
  ensureFirstOnlineGiftSchema();
  const award = dbGet(`SELECT * FROM first_online_gift_awards
    WHERE gift_card_code = ? AND status = 'issued'`, [String(code).trim().toUpperCase()]);
  if (!award) return;
  if (Number(award.web_customer_id) !== Number(webCustomer.id)) {
    throw new Error('This gift card belongs to another customer account');
  }
}

function revokeAwardForOrder(order) {
  if (!order?.id) return null;
  ensureFirstOnlineGiftSchema();
  const award = dbGet(`SELECT * FROM first_online_gift_awards WHERE order_id = ? AND status = 'issued'`, [order.id]);
  if (!award) return null;
  const db = getDb();
  return db.transaction(() => {
    if (award.gift_card_id) {
      const card = db.prepare('SELECT * FROM gift_cards WHERE id = ?').get(award.gift_card_id);
      const unused = card && Number(card.balance) >= Number(card.initial_balance) - 0.001;
      if (card && !unused) {
        return { revoked: false, reason: 'gift_already_used' };
      }
      if (unused) {
        db.prepare(`UPDATE gift_cards SET status = 'cancelled', balance = 0 WHERE id = ?`).run(card.id);
        try {
          db.prepare('INSERT INTO gift_card_transactions (gift_card_id, amount, type) VALUES (?,?,?)')
            .run(card.id, 0, 'reload');
        } catch (_) { /* */ }
      }
    }
    db.prepare(`UPDATE first_online_gift_awards SET status = 'revoked' WHERE id = ?`).run(award.id);
    db.prepare(`UPDATE first_online_gift_days
      SET awarded_count = CASE WHEN awarded_count > 0 THEN awarded_count - 1 ELSE 0 END
      WHERE campaign_id = ? AND award_date = ?`).run(award.campaign_id, award.award_date);
    try {
      require('./store').audit(null, 'system', 'revoke_first_online_gift', 'first_online_gift_award', award.id, {
        order_id: order.id, web_customer_id: award.web_customer_id, position: award.position
      });
    } catch (_) { /* */ }
    return { revoked: true, id: award.id };
  }, { savepoints: false })();
}

function tryAwardForOrder(order, webCustomer, opts = {}) {
  if (!order?.id || !webCustomer?.id) return null;
  if (isFailedStatus(order.status)) return null;
  if (String(order.order_source || 'ONLINE').toUpperCase() !== 'ONLINE') return null;
  ensureFirstOnlineGiftSchema();
  const campaign = getCampaign();
  const day = opts.awardDate || shopToday();
  if (!campaignIsLive(campaign, day)) return null;
  const orderValue = qualifyingOrderValue(order);
  if (campaign.min_order_amount > 0 && orderValue < campaign.min_order_amount) return null;

  const db = getDb();
  return db.transaction(() => {
    db.prepare(`INSERT INTO first_online_gift_days (campaign_id, award_date, awarded_count)
      VALUES (1, ?, 0) ON CONFLICT (campaign_id, award_date) DO NOTHING`).run(day);
    db.prepare(`UPDATE first_online_gift_days SET awarded_count = awarded_count WHERE campaign_id = 1 AND award_date = ?`).run(day);

    const alreadyAccount = db.prepare(`SELECT id FROM first_online_gift_awards
      WHERE campaign_id = 1 AND web_customer_id = ? AND status = 'issued'`).get(webCustomer.id);
    if (alreadyAccount) return { skipped: 'already_claimed' };

    const alreadyOrder = db.prepare(`SELECT id FROM first_online_gift_awards
      WHERE order_id = ? AND status = 'issued'`).get(order.id);
    if (alreadyOrder) return { skipped: 'order_awarded' };

    const issued = db.prepare(`SELECT COUNT(*) AS c FROM first_online_gift_awards
      WHERE campaign_id = 1 AND award_date = ? AND status = 'issued'`).get(day)?.c || 0;
    if (Number(issued) >= campaign.daily_limit) return { skipped: 'daily_limit' };

    const used = new Set((db.prepare(`SELECT position FROM first_online_gift_awards
      WHERE campaign_id = 1 AND award_date = ? AND status = 'issued'`).all(day) || [])
      .map((r) => Number(r.position)));
    let position = 1;
    while (used.has(position)) position += 1;

    const features = require('./features');
    let code = makeGiftCode();
    for (let i = 0; i < 6; i++) {
      if (!db.prepare('SELECT id FROM gift_cards WHERE code = ?').get(code)) break;
      code = makeGiftCode();
    }
    const expiresAt = campaign.expiry_days
      ? new Date(Date.now() + campaign.expiry_days * 86400000).toISOString().slice(0, 10)
      : null;
    const customerName = `${webCustomer.first_name || ''} ${webCustomer.last_name || ''}`.trim()
      || order.customer_name || 'Customer';
    const gift = features.createGiftCard({
      code,
      amount: campaign.gift_amount,
      customer_id: webCustomer.customer_id || order.customer_id || null,
      customer_phone: webCustomer.phone || order.customer_phone || null,
      expires_at: expiresAt,
      auto_approve: true,
      notes: `First Online Customer Gift · Winner #${position} · ${order.order_number || order.id}`
    }, null, 'system');
    if (!gift.id) {
      gift.id = db.prepare('SELECT id FROM gift_cards WHERE code = ?').get(gift.code)?.id || null;
    }

    const ins = db.prepare(`INSERT INTO first_online_gift_awards
      (campaign_id, award_date, position, web_customer_id, customer_id, customer_name, order_id, order_number,
       gift_card_id, gift_card_code, amount, status, created_at)
      VALUES (1,?,?,?,?,?,?,?,?,?,?, 'issued', ?)`).run(
      day, position, webCustomer.id, webCustomer.customer_id || order.customer_id || null,
      customerName, order.id, order.order_number || null,
      gift.id, gift.code, campaign.gift_amount, nowIso()
    );
    db.prepare(`UPDATE first_online_gift_days SET awarded_count = ? WHERE campaign_id = 1 AND award_date = ?`)
      .run(Number(issued) + 1, day);

    const saved = db.prepare(`SELECT * FROM first_online_gift_awards WHERE order_id = ? AND status = 'issued'`).get(order.id);
    const award = {
      id: saved?.id || ins.lastInsertRowid,
      position,
      amount: campaign.gift_amount,
      gift_card_code: gift.code,
      gift_card_id: gift.id,
      order_id: order.id,
      order_number: order.order_number,
      award_date: day,
      status: 'issued',
      expires_at: expiresAt,
      customer_name: customerName
    };
    try {
      require('./store').audit(null, 'system', 'issue_first_online_gift', 'first_online_gift_award', award.id, {
        campaign: CAMPAIGN_KEY,
        date: day,
        winner: position,
        customer_id: webCustomer.customer_id || null,
        web_customer_id: webCustomer.id,
        order: order.order_number || order.id,
        gift: campaign.gift_amount,
        gift_card: gift.code,
        issued: nowIso(),
        status: 'ACTIVE'
      });
    } catch (_) { /* */ }
    return award;
  }, { savepoints: false })();
}

function maybeAwardFromSubmit(order, webCustomer) {
  try {
    return tryAwardForOrder(order, webCustomer);
  } catch (err) {
    console.warn('[first-online-gift] award failed:', err.message || err);
    return null;
  }
}

function maybeRevokeFromStatus(order) {
  try {
    if (!isFailedStatus(order?.status) && String(order?.status || '').toLowerCase() !== 'rejected'
      && String(order?.status || '').toLowerCase() !== 'cancelled') return null;
    return revokeAwardForOrder(order);
  } catch (err) {
    console.warn('[first-online-gift] revoke failed:', err.message || err);
    return null;
  }
}

function publicAwardView(award) {
  if (!award || award.skipped) return null;
  return {
    winner: true,
    position: award.position,
    amount: award.amount,
    gift_card_code: award.gift_card_code,
    expires_at: award.expires_at || null,
    message: `You are one of today's first online customers! You've received a R${round2(award.amount)} Gift Card.`
  };
}

function runSelfTest(actor) {
  const { assertUserActor } = require('./authz');
  assertUserActor(actor, ['owner']);
  ensureFirstOnlineGiftSchema();
  const previous = getCampaign();
  const findings = [];
  const mark = (name, ok, detail) => findings.push({ name, ok: !!ok, detail: detail || null });
  const cleanup = () => {
    const rows = dbAll(`SELECT * FROM first_online_gift_awards WHERE web_customer_id >= ?`, [TEST_CUSTOMER_FLOOR]);
    for (const row of rows) {
      try {
        if (row.gift_card_id) {
          dbRun('DELETE FROM gift_card_transactions WHERE gift_card_id = ?', [row.gift_card_id]);
          dbRun('DELETE FROM gift_cards WHERE id = ?', [row.gift_card_id]);
        }
      } catch (_) { /* */ }
    }
    dbRun(`DELETE FROM first_online_gift_awards WHERE web_customer_id >= ?`, [TEST_CUSTOMER_FLOOR]);
    try {
      dbRun(`UPDATE first_online_gift_campaigns SET enabled=?, daily_limit=?, gift_amount=?, min_order_amount=?,
        start_date=?, end_date=?, expiry_days=?, updated_at=? WHERE id=1`,
        [previous.enabled ? 1 : 0, previous.daily_limit, previous.gift_amount, previous.min_order_amount,
          previous.start_date, previous.end_date, previous.expiry_days, nowIso()]);
    } catch (_) { /* */ }
  };
  try {
    saveCampaign({
      enabled: false,
      daily_limit: 2,
      gift_amount: 5,
      min_order_amount: 0,
      start_date: null,
      end_date: null,
      expiry_days: 14
    }, actor);
    const off = tryAwardForOrder(
      { id: 910000001, order_number: 'TEST-OFF', order_source: 'ONLINE', status: 'pending', total: 50, gift_card_amount: 0 },
      { id: TEST_CUSTOMER_FLOOR + 1, first_name: 'Test', last_name: 'Off' }
    );
    mark('campaign_off', !off || off.skipped, off?.skipped || 'no award');

    saveCampaign({ enabled: true, daily_limit: 2, gift_amount: 5, min_order_amount: 0 }, actor);
    const w1 = tryAwardForOrder(
      { id: 910000002, order_number: 'TEST-W1', order_source: 'ONLINE', status: 'pending', total: 50, gift_card_amount: 0 },
      { id: TEST_CUSTOMER_FLOOR + 1, first_name: 'Test', last_name: 'One', phone: '0800000001' }
    );
    mark('winner_1', w1?.position === 1 && w1?.gift_card_code, w1?.gift_card_code);

    const w2 = tryAwardForOrder(
      { id: 910000003, order_number: 'TEST-W2', order_source: 'ONLINE', status: 'pending', total: 40, gift_card_amount: 0 },
      { id: TEST_CUSTOMER_FLOOR + 2, first_name: 'Test', last_name: 'Two', phone: '0800000002' }
    );
    mark('winner_2', w2?.position === 2 && w2?.gift_card_code, w2?.gift_card_code);

    const again = tryAwardForOrder(
      { id: 910000004, order_number: 'TEST-AGAIN', order_source: 'ONLINE', status: 'pending', total: 40, gift_card_amount: 0 },
      { id: TEST_CUSTOMER_FLOOR + 1, first_name: 'Test', last_name: 'One' }
    );
    mark('same_account_blocked', again?.skipped === 'already_claimed', again?.skipped);

    const eleventh = tryAwardForOrder(
      { id: 910000005, order_number: 'TEST-LIMIT', order_source: 'ONLINE', status: 'pending', total: 40, gift_card_amount: 0 },
      { id: TEST_CUSTOMER_FLOOR + 3, first_name: 'Test', last_name: 'Three' }
    );
    mark('daily_limit', eleventh?.skipped === 'daily_limit', eleventh?.skipped);

    const failed = tryAwardForOrder(
      { id: 910000006, order_number: 'TEST-FAIL', order_source: 'ONLINE', status: 'pending_payment', total: 40, gift_card_amount: 0 },
      { id: TEST_CUSTOMER_FLOOR + 4, first_name: 'Test', last_name: 'Fail' }
    );
    mark('failed_order_skipped', !failed || failed.skipped, failed?.skipped || 'no award');

    saveCampaign({ enabled: true, daily_limit: 10, end_date: '2000-01-01' }, actor);
    const ended = tryAwardForOrder(
      { id: 910000007, order_number: 'TEST-END', order_source: 'ONLINE', status: 'pending', total: 40, gift_card_amount: 0 },
      { id: TEST_CUSTOMER_FLOOR + 5, first_name: 'Test', last_name: 'End' }
    );
    mark('end_date_blocks', !ended || ended.skipped, ended?.skipped || 'no award');

    saveCampaign({ enabled: true, daily_limit: 10, end_date: null }, actor);
    const revoke = revokeAwardForOrder({ id: 910000002, order_number: 'TEST-W1', status: 'cancelled' });
    mark('cancel_revokes', revoke?.revoked, revoke);
    const afterRevoke = tryAwardForOrder(
      { id: 910000008, order_number: 'TEST-REOPEN', order_source: 'ONLINE', status: 'pending', total: 40, gift_card_amount: 0 },
      { id: TEST_CUSTOMER_FLOOR + 1, first_name: 'Test', last_name: 'One' }
    );
    mark('slot_freed_after_cancel', afterRevoke?.position > 0, afterRevoke?.position);

    saveCampaign({ enabled: true, daily_limit: 2, gift_amount: 5, end_date: null }, actor);
    const dayA = tryAwardForOrder(
      { id: 910000011, order_number: 'TEST-DAYA', order_source: 'ONLINE', status: 'pending', total: 40, gift_card_amount: 0 },
      { id: TEST_CUSTOMER_FLOOR + 11, first_name: 'Test', last_name: 'DayA' },
      { awardDate: '1999-01-01' }
    );
    const dayB = tryAwardForOrder(
      { id: 910000012, order_number: 'TEST-DAYB', order_source: 'ONLINE', status: 'pending', total: 40, gift_card_amount: 0 },
      { id: TEST_CUSTOMER_FLOOR + 12, first_name: 'Test', last_name: 'DayB' },
      { awardDate: '1999-01-02' }
    );
    mark('daily_reset', dayA?.position === 1 && dayB?.position === 1, `A=${dayA?.position} B=${dayB?.position}`);

    let dupBlocked = false;
    try {
      dbRun(`INSERT INTO first_online_gift_awards
        (campaign_id, award_date, position, web_customer_id, customer_name, order_id, amount, status, created_at)
        VALUES (1,?,?,?,?,?,?, 'issued', ?)`,
        ['1999-01-01', 1, TEST_CUSTOMER_FLOOR + 99, 'Dup', 910000099, 5, nowIso()]);
    } catch (err) {
      dupBlocked = /unique|duplicate|constraint/i.test(String(err.message || err));
    }
    mark('atomic_position_unique', dupBlocked, dupBlocked ? 'unique index blocked duplicate winner #' : 'index missing');

    mark('gift_card_created', !!w1?.gift_card_code && /^CHISA-/.test(w1.gift_card_code), w1?.gift_card_code);
  } catch (err) {
    mark('self_test_error', false, err.message || String(err));
  } finally {
    cleanup();
  }
  return { ok: findings.every((f) => f.ok), findings };
}

module.exports = {
  CAMPAIGN_KEY,
  ensureFirstOnlineGiftSchema,
  getCampaign,
  saveCampaign,
  getDashboard,
  listWinners,
  todayProgress,
  tryAwardForOrder,
  maybeAwardFromSubmit,
  maybeRevokeFromStatus,
  revokeAwardForOrder,
  assertGiftOwnedByWebCustomer,
  publicAwardView,
  awardForOrder,
  walletCardsForWebCustomer,
  runSelfTest,
  shopToday
};

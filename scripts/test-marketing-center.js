/**
 * Marketing Center checks against a throwaway SQLite file.
 * Does not read or write Chisa, Lab, or any configured Postgres database.
 * Seeds test-only customers/products/sales inside the temp DB, then exercises analytics,
 * promotions, the campaign lifecycle, attribution, budget, permissions, AI and audit.
 */
const fs = require('fs');
const path = require('path');

const DB_KEYS = [
  'SHOP_POS_DATABASE_URL', 'DATABASE_URL',
  'SHOP_POS_DB_HOST', 'SUPABASE_DB_HOST', 'PGHOST',
  'SHOP_POS_DB_PASSWORD', 'SUPABASE_DB_PASSWORD', 'PGPASSWORD',
  'SHOP_POS_DB_USER', 'SUPABASE_DB_USER', 'PGUSER',
  'SHOP_POS_DB_NAME', 'SUPABASE_DB_NAME', 'PGDATABASE',
  'SHOP_POS_DB_PORT', 'SUPABASE_DB_PORT', 'PGPORT'
];
DB_KEYS.forEach((k) => { delete process.env[k]; });
['SHOP_POS_AI_API_KEY', 'OPENAI_API_KEY', 'WHATSAPP_TOKEN', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID'].forEach((k) => { delete process.env[k]; });

const dataDir = path.join(__dirname, '..', `.tmp-mkt-sqlite-${process.pid}`);
fs.rmSync(dataDir, { recursive: true, force: true });
fs.mkdirSync(dataDir, { recursive: true });
process.on('exit', () => { try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (_) { /* best effort */ } });
process.env.SHOP_POS_LOCAL_INSTALLER = '1';
process.env.SHOP_POS_DATA = dataDir;

const failures = [];
function check(name, cond, extra) {
  if (cond) console.log('PASS', name);
  else {
    failures.push(name);
    console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 600));
  }
}
function throws(fn) {
  try { fn(); return null; } catch (err) { return err.message || String(err); }
}

const DAY = 86400000;
const stamp = (daysAgo, hour = 12) => {
  const d = new Date(Date.now() - daysAgo * DAY);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString().replace('T', ' ').slice(0, 19);
};

(async () => {
  const dbMod = require('../electron/database/db');
  await dbMod.initDatabase();
  const db = dbMod.getDb();
  const session = require('../electron/services/session');
  const mc = require('../electron/services/marketing-center');
  const A = require('../electron/services/marketing-analytics');
  const vouchers = require('../electron/services/discount-vouchers');
  mc.ensureSchema();

  db.prepare("UPDATE shop_settings SET shop_name = 'MKT Test Shop', phone = '0110000000', address = '1 Test Street' WHERE id = 1").run();
  const mkUser = (username, role, perms = '{}') => {
    db.prepare('INSERT INTO users (username, password_hash, full_name, role, is_active, permissions) VALUES (?,?,?,?,1,?)').run(username, 'x', `${username} name`, role, perms);
    return db.prepare('SELECT id, username, full_name, role, is_active, permissions FROM users WHERE username = ?').get(username);
  };
  const owner = mkUser('mktowner', 'owner');
  const manager = mkUser('mktmgr', 'manager');
  const supervisor = mkUser('mktsup', 'supervisor');
  const as = (u) => { session.setUserSession(u); return u; };

  // Products
  db.prepare("INSERT INTO categories (name) VALUES ('MktFood')").run();
  const cat = db.prepare("SELECT id FROM categories WHERE name = 'MktFood'").get().id;
  const addP = (name, price, cost, stock) => {
    db.prepare('INSERT INTO products (name, category_id, selling_price, buying_price, stock_quantity) VALUES (?,?,?,?,?)').run(name, cat, price, cost, stock);
    return db.prepare('SELECT id FROM products WHERE name = ?').get(name).id;
  };
  const burger = addP('Test Burger', 50, 20, 100);
  const chips = addP('Test Chips', 20, 5, 200);
  const coke = addP('Test Cola', 15, 7, 500);
  const deluxe = addP('Test Deluxe Burger', 70, 30, 50);
  const nocost = addP('Test NoCost Pie', 30, 0, 40);
  const oos = addP('Test OutOfStock Wrap', 25, 10, 0);

  // Customers
  const addC = (name, phone, extra = {}) => {
    db.prepare('INSERT INTO customers (name, phone, email) VALUES (?,?,?)').run(name, phone, extra.email || null);
    const id = db.prepare('SELECT id FROM customers WHERE name = ?').get(name).id;
    if (extra.birthday) { try { db.prepare('UPDATE customers SET birthday = ? WHERE id = ?').run(extra.birthday, id); } catch (_) { /* column */ } }
    if (extra.points) { try { db.prepare('UPDATE customers SET loyalty_points = ? WHERE id = ?').run(extra.points, id); } catch (_) { /* column */ } }
    return id;
  };
  const inTwoDays = new Date(Date.now() + 2 * DAY);
  const bday = `1990-${String(inTwoDays.getUTCMonth() + 1).padStart(2, '0')}-${String(inTwoDays.getUTCDate()).padStart(2, '0')}`;
  const regulars = [1, 2, 3, 4].map((i) => addC(`Mkt Regular ${i}`, `08200000${10 + i}`, { email: `r${i}@example.test`, birthday: i === 1 ? bday : null, points: 40 }));
  const lapsed = addC('Mkt Lapsed', '0820000020');
  const fresh = addC('Mkt New', '0820000021');

  let rn = 0;
  const sale = (customerId, daysAgo, hour, items, extra = {}) => {
    const subtotal = items.reduce((a, it) => a + it.price * it.qty, 0);
    const discount = extra.discount || 0;
    rn += 1;
    db.prepare('INSERT INTO sales (receipt_number, user_id, customer_id, subtotal, discount, total, amount_paid, status, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(`MKT-${rn}`, owner.id, customerId, subtotal, discount, subtotal - discount, subtotal - discount, 'completed', stamp(daysAgo, hour));
    const id = db.prepare('SELECT id FROM sales WHERE receipt_number = ?').get(`MKT-${rn}`).id;
    for (const it of items) {
      db.prepare('INSERT INTO sale_items (sale_id, product_id, product_name, quantity, unit_price, buying_price, total) VALUES (?,?,?,?,?,?,?)')
        .run(id, it.id, it.name, it.qty, it.price, it.cost, it.price * it.qty);
    }
    return id;
  };
  const B = { id: burger, name: 'Test Burger', price: 50, cost: 20, qty: 1 };
  const C = { id: chips, name: 'Test Chips', price: 20, cost: 5, qty: 1 };
  const D = { id: deluxe, name: 'Test Deluxe Burger', price: 70, cost: 30, qty: 1 };
  const K = { id: coke, name: 'Test Cola', price: 15, cost: 7, qty: 1 };
  const seedSales = () => {
    for (const [idx, cid] of regulars.entries()) {
      for (let d = 3 + idx; d < 120; d += 7) sale(cid, d, 11 + (d % 3), [B, C]);
      if (idx < 3) { sale(cid, 40 + idx, 12, [D]); sale(cid, 20 + idx, 13, [D, C]); }
    }
    for (let d = 70; d < 95; d += 5) sale(lapsed, d, 12, [B, C]);
    sale(fresh, 5, 15, [B]);
    sale(null, 10, 16, [K]);
    sale(null, 2, 20, [K]);
  };
  if (typeof db.transaction === 'function') db.transaction(seedSales)(); else seedSales();
  A.invalidate();

  as(owner);

  // ── Analytics ──
  const data = A.loadData({ days: 180, fresh: true });
  const profiles = A.customerProfiles(data);
  check('loadData finds seeded sales', data.sales.length > 50, { sales: data.sales.length });
  const settings = mc.getSettings();
  const seg = (k, p) => A.segmentMembers(data, profiles, k, p || {}, settings).map((x) => x.id);
  check('inactive segment contains lapsed customer', seg('inactive').includes(lapsed) && !seg('inactive').includes(regulars[0]));
  check('win-back 60-day window contains lapsed', seg('inactive', { days: 60 }).includes(lapsed));
  check('new segment contains new customer only', seg('new').includes(fresh) && !seg('new').includes(regulars[0]));
  check('returning segment has regulars', regulars.every((r) => seg('returning').includes(r)));
  check('product segment (buyers of Deluxe)', seg('product', { product_id: deluxe }).length === 3);
  const cs = A.crossSell(data, settings);
  check('cross-sell Burger → Chips detected', cs.pairs.some((p) => p.product_a_id === burger && p.product_b_id === chips && p.orders_with_both > 10), cs.pairs.slice(0, 3));
  const up = A.upsell(data, settings);
  check('upsell Burger → Deluxe detected', up.suggestions.some((u) => u.from_product_id === burger && u.to_product_id === deluxe), up.suggestions.slice(0, 3));
  const prod = A.productPerformance(data, settings);
  check('overstock detects Cola', prod.overstock.some((p) => p.product_id === coke), prod.overstock.map((p) => p.name));
  check('missing cost lists NoCost Pie', prod.missing_cost.some((p) => p.product_id === nocost));
  check('best seller is Chips (most units)', prod.best_sellers[0]?.product_id === chips, prod.best_sellers[0]);
  const q = A.quietPeriods(data, settings);
  check('quiet-period analysis has enough trading days', q.insufficient === false && q.trading_days >= 7, { td: q.trading_days });
  const clv = A.customerLifetime(profiles.find((p) => p.id === regulars[0]));
  check('CLV labelled as estimate', clv.estimate > 0 && /ESTIMATE/.test(clv.note), clv);
  const clvNew = A.customerLifetime(profiles.find((p) => p.id === fresh));
  check('CLV insufficient for single-order customer', clvNew.estimate === null && /Insufficient/.test(clvNew.note));
  const lapsedProfile = profiles.find((p) => p.id === lapsed);
  check('overdue detects lapsed regular', !!A.overdue(lapsedProfile));
  check('upcoming birthday found', A.upcomingDates(data, 7).some((u) => u.customer_id === regulars[0] && u.kind === 'birthday'));
  const emptyWindow = A.quietPeriods({ sales: [] }, settings);
  check('quiet periods report INSUFFICIENT on no data', emptyWindow.insufficient === true && /Insufficient data/.test(emptyWindow.message));

  // ── Views ──
  const dash = mc.dashboard({ fresh: true }, owner);
  check('dashboard revenue from real sales', dash.sales.orders === data.sales.length && dash.sales.revenue > 0);
  check('dashboard ROI unavailable without cost', dash.financial.roi_pct === null && /marketing cost data required/.test(dash.financial.roi_note));
  check('dashboard approaching reward not configured', dash.customers.approaching_reward === null && /Not configured/.test(dash.customers.approaching_reward_note));
  const dc = mc.decisionCenter({ fresh: true }, owner);
  const kinds = new Set(dc.cards.map((c) => c.kind));
  check('decision center: win-back card', kinds.has('win_back'));
  check('decision center: cross-sell card', kinds.has('cross_sell'));
  check('decision center: product/stock card', kinds.has('product'));
  check('decision center: upsell card', kinds.has('upsell'));
  check('decision center: dates card', kinds.has('dates'));
  check('decision center: missing cost flagged', dc.insufficient.some((m) => /no cost data/.test(m)));
  const cv = mc.customersView({ segment: 'returning' }, owner);
  check('customers view masks phones', cv.customers.length >= 4 && cv.customers.every((c) => !c.phone && /\*/.test(c.phone_masked)));

  // ── Promotion previews ──
  const pv = mc.previewPromotion({ kind: 'bundle', items: [{ product_id: burger, quantity: 1 }, { product_id: chips, quantity: 1 }], pricing_type: 'fixed', final_price: 60 });
  check('bundle preview figures', pv.normal_price === 70 && pv.promo_price === 60 && pv.discount === 10 && pv.cogs === 25 && pv.gross_profit === 35, pv);
  const pvLoss = mc.previewPromotion({ kind: 'bundle', items: [{ product_id: burger, quantity: 1 }], pricing_type: 'fixed', final_price: 15 });
  check('below-cost warning', pvLoss.warnings.some((w) => /below cost/.test(w)));
  const pvNoCost = mc.previewPromotion({ kind: 'voucher', discount_type: 'percent', discount_value: 10, product_id: nocost });
  check('missing-cost warning', pvNoCost.gross_profit === null && pvNoCost.warnings.some((w) => /no cost data/.test(w)));
  const pvBogo = mc.previewPromotion({ kind: 'bogo', product_id: burger, buy_qty: 1, get_qty: 1 });
  check('buy-X-get-X preview', pvBogo.normal_price === 100 && pvBogo.promo_price === 50 && pvBogo.cogs === 40);
  const pvXY = mc.previewPromotion({ kind: 'buy_x_get_y', product_id: burger, buy_qty: 1, get_product_id: chips, get_qty: 1, get_discount_pct: 50 });
  check('buy-X-get-Y preview', pvXY.promo_price === 60 && pvXY.discount === 10);
  const pvOrder = mc.previewPromotion({ kind: 'voucher', discount_type: 'amount', discount_value: 10 });
  check('order-level voucher uses 90-day AOV', pvOrder.discount === 10 && /average order value/.test(pvOrder.basis));
  const pvFd = mc.previewPromotion({ kind: 'free_delivery' });
  check('free delivery preview INSUFFICIENT without delivery orders', pvFd.insufficient === true);
  const oosMsg = throws(() => mc.createPromotion({ kind: 'bundle', items: [{ product_id: oos, quantity: 1 }], pricing_type: 'fixed', final_price: 20 }, owner));
  check('out-of-stock promotion needs confirmation', /out of stock/.test(oosMsg || ''), oosMsg);

  // ── Permissions ──
  as(supervisor);
  check('supervisor lacks marketing permission by default', /permission: mkt_campaign_create/.test(throws(() => mc.saveCampaign({ name: 'x' }, supervisor)) || ''));
  as(manager);
  const mgrCamp = mc.saveCampaign({ name: 'Manager draft', objective: 'win_back', audience: { type: 'segment', segment: 'inactive' } }, manager);
  check('manager can create campaign', mgrCamp.status === 'draft');
  mc.submitCampaign(mgrCamp.id, manager);
  check('manager cannot approve', /permission: mkt_campaign_approve/.test(throws(() => mc.approveCampaign(mgrCamp.id, manager)) || ''));
  check('manager cannot manage budget', /permission: mkt_budget/.test(throws(() => mc.saveBudget({ amount: 10 }, manager)) || ''));
  as(owner);

  // ── Campaign lifecycle ──
  const camp = mc.saveCampaign({
    name: 'Regulars 10% off', objective: 'increase_sales', audience: { type: 'segment', segment: 'returning' },
    channels: ['whatsapp'], content: { body: 'Hi {{customer_name}}, use {{code}} for 10% off!' },
    estimated_cost: 50, expected_redemptions: 5
  }, owner);
  check('campaign draft created', camp.status === 'draft' && camp.id > 0);
  const promo = mc.createPromotion({ kind: 'voucher', discount_type: 'percent', discount_value: 10, campaign_id: camp.id, max_uses: 100 }, owner);
  check('voucher created in existing engine and linked', promo.engine === 'discount_vouchers' && /^MKT/.test(promo.code) && mc.getCampaign(camp.id).promotion_code === promo.code);
  mc.submitCampaign(camp.id, owner);
  const fp = mc.getCampaign(camp.id).preview;
  check('financial preview stored on submit', fp && fp.audience_size >= 4 && fp.consent.whatsapp);
  check('preview warns WhatsApp not configured', (fp.warnings || []).some((w) => /WhatsApp is not configured\. Connect WhatsApp in Communication Center before sending this campaign\./.test(w)), fp.warnings);
  mc.approveCampaign(camp.id, owner);
  const launchErr = throws(() => mc.launchCampaign(camp.id, owner));
  check('launch blocked with honest WhatsApp message', /WhatsApp is not configured/.test(launchErr || ''), launchErr);

  // Simulate a configured + switched-on WhatsApp provider (no network is used: messages only queue).
  const providers = require('../electron/services/cc-providers');
  const ctl = require('../electron/services/cc-control');
  const origStatus = providers.providerStatus;
  const origControl = ctl.getControl;
  providers.providerStatus = () => ({ ...origStatus(), whatsapp: { ready: true, configured: true } });
  ctl.getControl = () => ({ ...origControl(), channels: { ...(origControl().channels || {}), whatsapp: true }, emergency_off: false });
  const launched = mc.launchCampaign(camp.id, owner);
  check('launch queues messages through Communication Center', launched.status === 'active' && launched.launch.recipients >= 4 && launched.launch.queued >= 4, launched.launch);
  const queuedRows = db.prepare('SELECT body, status FROM cc_queue WHERE dedupe_key LIKE ?').all(`mkt:${camp.id}:%`);
  check('queued body personalised with voucher code', queuedRows.length >= 4 && queuedRows.every((r) => r.body.includes(promo.code) && !r.body.includes('{{')), queuedRows[0]);
  const again = throws(() => mc.launchCampaign(camp.id, owner));
  check('cannot relaunch an active campaign', /Only approved/.test(again || ''));
  const paused = mc.pauseCampaign(camp.id, owner);
  check('pause holds queued messages and voucher', paused.status === 'paused' && paused.messages_paused >= 4 && db.prepare('SELECT status FROM discount_vouchers WHERE id = ?').get(promo.id).status === 'paused', { mp: paused.messages_paused });
  const resumed = mc.resumeCampaign(camp.id, owner);
  check('resume releases messages and voucher', resumed.status === 'active' && resumed.messages_released >= 4 && db.prepare('SELECT status FROM discount_vouchers WHERE id = ?').get(promo.id).status === 'active');

  // ── Attribution (evidence only) ──
  const res0 = mc.campaignResults(camp.id);
  check('no attributed orders before redemption', res0.attributed.orders === 0 && res0.roi_pct === null && res0.roi_note === 'ROI unavailable — marketing cost data required.');
  const saleId = sale(regulars[0], 0, 12, [B, C], { discount: 7 });
  const red = vouchers.redeemVoucher(promo.code, { subtotal: 70, saleId, customerId: regulars[0], channel: 'pos' });
  check('voucher redeemed with sale link', red.ok !== false && !red.error, red);
  const res1 = mc.campaignResults(camp.id);
  check('attributed revenue from redemption only', res1.attributed.orders === 1 && res1.attributed.revenue === 63 && res1.attributed.discount === 7 && res1.attributed.cogs === 25, res1.attributed);
  check('total revenue kept separate from attributed', res1.total_revenue_during_campaign && /not attributed/.test(res1.total_revenue_during_campaign.label));
  const saleId2 = sale(regulars[1], 0, 13, [B], { discount: 5 });
  vouchers.redeemVoucher(promo.code, { subtotal: 50 });
  vouchers.linkRedemptionToSale(promo.code, saleId2);
  check('POS link (linkRedemptionToSale) attributes sale', mc.campaignResults(camp.id).attributed.orders === 2);

  // ── Costs, budget, accounting ──
  const cost = mc.addCampaignCost(camp.id, { amount: 100, channel: 'whatsapp', description: 'Test WhatsApp spend' }, owner);
  const exp = db.prepare('SELECT * FROM expenses WHERE id = ?').get(cost.expense_id);
  check('campaign cost recorded as Marketing expense', exp && exp.category === 'Marketing' && Number(exp.amount) === 100 && /\[Campaign #/.test(exp.description), exp);
  const res2 = mc.campaignResults(camp.id);
  check('ROI computed once cost exists', res2.marketing_cost === 100 && typeof res2.roi_pct === 'number', { roi: res2.roi_pct });
  mc.saveBudget({ scope: 'monthly', amount: 120 }, owner);
  mc.saveBudget({ scope: 'channel', scope_ref: 'whatsapp', amount: 80 }, owner);
  const bs = mc.budgetStatus();
  const monthly = bs.budgets.find((b) => b.scope === 'monthly');
  const chan = bs.budgets.find((b) => b.scope === 'channel');
  check('monthly budget approaching warning', monthly.actual === 100 && monthly.alert === 'approaching', monthly);
  check('channel budget exceeded warning', chan.actual === 100 && chan.alert === 'exceeded', chan);

  // ── Voucher engine extensions ──
  const fd = vouchers.createVoucher({ code: 'MKTFREEDEL', discount_type: 'free_delivery', max_uses: 5 }, owner);
  check('free-delivery voucher rejected for non-delivery', !!vouchers.validateVoucher(fd.code, { subtotal: 100 }).error);
  const fdOk = vouchers.validateVoucher(fd.code, { subtotal: 100, forDelivery: true });
  check('free-delivery voucher valid for delivery', fdOk.ok && fdOk.discount === 0 && fdOk.discount_type === 'free_delivery', fdOk);
  const minV = vouchers.createVoucher({ code: 'MKTMIN100', discount_type: 'amount', discount_value: 20, min_order_total: 100, branch_id: 2 }, owner);
  check('minimum order enforced', !!vouchers.validateVoucher(minV.code, { subtotal: 50, branchId: 2 }).error);
  check('branch-specific voucher rejected at other branch', !!vouchers.validateVoucher(minV.code, { subtotal: 150, branchId: 1 }).error);
  check('branch-specific voucher valid at its branch', vouchers.validateVoucher(minV.code, { subtotal: 150, branchId: 2 }).discount === 20);
  const capV = vouchers.createVoucher({ code: 'MKTCAP', discount_type: 'percent', discount_value: 50, max_discount: 30 }, owner);
  check('max discount cap applied', vouchers.validateVoucher(capV.code, { subtotal: 200 }).discount === 30);
  const plain = vouchers.createVoucher({ code: 'MKTPLAIN', discount_type: 'percent', discount_value: 10 }, owner);
  check('existing-style voucher unchanged (no min/cap/branch)', vouchers.validateVoucher(plain.code, { subtotal: 100 }).discount === 10);

  // ── Combos promotion, duplicate, cancel ──
  const camp2 = mc.saveCampaign({ name: 'Burger combo', objective: 'increase_aov', audience: { type: 'segment', segment: 'returning' } }, owner);
  const combo = mc.createPromotion({ kind: 'bundle', campaign_id: camp2.id, items: [{ product_id: burger, quantity: 1 }, { product_id: chips, quantity: 1 }], pricing_type: 'fixed', final_price: 60 }, owner);
  check('bundle created in existing combos engine', combo.engine === 'combos' && combo.id > 0 && !!db.prepare('SELECT id FROM combos WHERE id = ?').get(combo.id));
  check('combo items saved', db.prepare('SELECT COUNT(*) AS n FROM combo_items WHERE combo_id = ?').get(combo.id).n === 2);
  const dup = mc.duplicateCampaign(camp.id, owner);
  check('duplicate does not copy single voucher', dup.status === 'draft' && !dup.promotion_code);
  const dup2 = mc.duplicateCampaign(camp2.id, owner);
  check('duplicate keeps reusable combo', Number(dup2.promotion_ref_id) === Number(combo.id));
  const cancelled = mc.cancelCampaign(camp.id, owner);
  check('cancel deactivates voucher', cancelled.status === 'cancelled' && db.prepare('SELECT status FROM discount_vouchers WHERE id = ?').get(promo.id).status === 'cancelled');
  check('edit of cancelled campaign refused', /cannot be edited/.test(throws(() => mc.saveCampaign({ id: camp.id, name: 'x' }, owner)) || ''));
  providers.providerStatus = origStatus;
  ctl.getControl = origControl;

  // ── A/B ──
  mc.saveCampaign({ name: 'AB variant A', ab_group: 'T1', variant_label: 'A' }, owner);
  mc.saveCampaign({ name: 'AB variant B', ab_group: 'T1', variant_label: 'B' }, owner);
  const ab = mc.abReport('T1');
  check('A/B declares no winner with insufficient data', ab.winner === null && /Insufficient data/.test(ab.conclusion));

  // ── Birthday offers ──
  mc.saveSettings({ birthday_offer: { enabled: true, discount_type: 'percent', discount_value: 15, days_ahead: 7, valid_days: 7 } }, owner);
  const bo = mc.createDateOffers({ kind: 'birthday', body: 'Happy birthday {{customer_name}} — {{code}}' }, owner);
  check('birthday offers create personal one-time vouchers', bo.vouchers.length === 1 && bo.vouchers[0].customer_id === regulars[0] && bo.campaign.status === 'draft');
  const bv = db.prepare('SELECT * FROM discount_vouchers WHERE code = ?').get(bo.vouchers[0].code);
  check('birthday voucher limited to that customer, 1 use', Number(bv.customer_id) === regulars[0] && Number(bv.max_uses) === 1);
  const legacy = db.prepare('SELECT * FROM mkt_settings WHERE id = 1').get();
  check('legacy mkt_settings row untouched', !legacy || !/birthday_offer/.test(String(legacy.settings_json || '')));

  // ── Calendar, events, suppression ──
  const ev = mc.saveEvent({ title: 'Heritage Day', event_date: new Date().toISOString().slice(0, 10) }, owner);
  const cal = mc.calendar({});
  check('calendar shows campaigns and events', cal.events.some((e) => e.type === 'business_event' && Number(e.id) === Number(ev.id)) && cal.events.some((e) => e.type === 'campaign'));
  mc.addSuppression({ customer_id: regulars[3], reason: 'asked not to be contacted' }, owner);
  const aud = mc.previewAudience({ type: 'segment', segment: 'returning' }, null, ['whatsapp']);
  check('suppressed customer excluded from audience', aud.suppressed === 1 && !aud.sample.some((s) => s.id === regulars[3]));

  // ── AI assistant (no key → rule-based, facts from DB) ──
  const ai = await mc.aiAsk('Which products are usually bought together?', {}, owner);
  check('AI assistant rule-based without key', ai.engine === 'rule_based' && /no AI model is configured/.test(ai.engine_note));
  check('AI facts come from data', ai.facts.some((f) => /Test Burger → Test Chips/.test(f.text)), ai.facts.map((f) => f.text));
  check('AI does not change anything', /Nothing has been changed/.test(ai.approval_note) && ai.suggestions.length > 0);
  const decided = mc.decideRecommendation(ai.id, 'rejected', 'not now', owner);
  check('recommendation rejection recorded', decided.status === 'rejected');
  const content = await mc.generateContent({ product_ids: [burger, chips] }, owner);
  check('content uses real prices', content.ok && content.content.whatsapp.includes('R50') && content.content.whatsapp.includes('R20'), content.content && content.content.whatsapp);
  const noContent = await mc.generateContent({}, owner);
  check('content refuses without real data', noContent.ok === false && noContent.missing.length > 0);

  // ── Archive, content library, Communication hand-off ──
  const arch = mc.archiveCampaign(camp.id, owner);
  check('cancelled campaign can be archived', arch.status === 'archived');
  check('archived campaigns hidden from default list', !mc.listCampaigns({}, owner).some((c) => c.id === camp.id) && mc.listCampaigns({ status: 'archived' }, owner).some((c) => c.id === camp.id));
  check('campaign awaiting approval cannot be archived', /cancel it first/.test(throws(() => mc.archiveCampaign(mgrCamp.id, owner)) || ''));
  const unarch = mc.unarchiveCampaign(camp.id, owner);
  check('unarchive restores previous status', unarch.status === 'cancelled');
  const hist = mc.campaignHistory(camp.id);
  check('campaign history lists its audit trail', hist.some((h) => h.action === 'campaign_created') && hist.some((h) => h.action === 'campaign_archived'));
  const futureDay = new Date(Date.now() + DAY).toISOString().slice(0, 10);
  const ct = mc.saveContent({ title: 'Burger post', kind: 'caption', channel: 'whatsapp', body: content.content.whatsapp, product_ids: [burger], campaign_id: camp2.id, scheduled_at: `${futureDay} 09:00` }, owner);
  check('content saved to library', ct.id > 0 && ct.status === 'scheduled' && ct.product_ids[0] === burger);
  check('content rejects unsafe media URL', /http\(s\) URL/.test(throws(() => mc.saveContent({ title: 'bad', body: 'x', media_url: 'javascript:alert(1)' }, owner)) || ''));
  const calMonth = futureDay.slice(0, 7);
  check('calendar shows scheduled content', mc.calendar({ month: calMonth }).events.some((e) => e.type === 'content' && Number(e.id) === Number(ct.id)));
  const used = mc.useContentInCampaign(ct.id, dup2.id, owner);
  check('library content reused in a campaign', used.content.body === ct.body && mc.listContent({ campaign_id: dup2.id }).some((x) => x.id === ct.id));
  const handoff = mc.sendContentToCommunication(ct.id, { channels: ['whatsapp'] }, owner);
  check('content handed to Communication Center as a draft (not sent)', handoff.ok && handoff.status === 'draft' && !!db.prepare("SELECT id FROM cc_campaigns WHERE id = ? AND status = 'draft'").get(handoff.draft_id));
  as(supervisor);
  check('supervisor cannot save content without permission', /permission/.test(throws(() => mc.saveContent({ title: 'x', body: 'y' }, supervisor)) || ''));
  as(owner);

  // ── Audit ──
  const auditRows = mc.listAudit(500);
  const actions = new Set(auditRows.map((r) => r.action));
  for (const a of ['campaign_created', 'campaign_submitted', 'campaign_approved', 'campaign_sent', 'campaign_paused', 'campaign_resumed', 'campaign_cancelled', 'campaign_duplicated',
    'promotion_created', 'campaign_cost_recorded', 'marketing_budget_created', 'marketing_settings_updated', 'ai_recommendation_generated', 'ai_recommendation_rejected', 'marketing_suppression_added', 'campaign_archived', 'campaign_unarchived', 'content_created', 'content_sent_to_communication']) {
    check(`audit: ${a}`, actions.has(a));
  }
  const approvedAudit = auditRows.find((r) => r.action === 'campaign_approved');
  check('audit records before/after', approvedAudit?.details?.before?.status === 'awaiting_approval' && approvedAudit?.details?.after?.status === 'approved');

  // ── RPC handlers registered ──
  try {
    const { buildHandlers } = require('../mobile/handlers');
    const store = require('../electron/services/store');
    const h = buildHandlers(store);
    const keys = Object.keys(h || {});
    const mktKeys = keys.filter((k) => /^mkt[:_]/.test(k));
    check('mkt RPC handlers registered', mktKeys.length >= 50, { count: mktKeys.length });
    const fn = h['mkt:dashboard'] || h.mkt_dashboard;
    const r = fn ? await fn({}) : null;
    check('mkt:dashboard RPC returns data for owner session', r && r.success === true && r.data.sales.orders > 0, r && r.error);
    session.clearAll?.();
    const r2 = fn ? await fn({}) : null;
    check('mkt:dashboard RPC requires authentication', r2 && r2.success === false && /Authentication required/.test(r2.error), r2);
  } catch (err) {
    check('mkt RPC handlers load', false, err.message);
  }

  console.log(failures.length ? `\n${failures.length} FAILED: ${failures.join(', ')}` : '\nALL MARKETING CENTER CHECKS PASSED');
  process.exit(failures.length ? 1 : 0);
})().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});

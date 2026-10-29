/**
 * Customer app access settings, lookup, and first-order checkout saving.
 * Usage: node scripts/test-access-and-first-order.js
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'access-first-'));
  process.env.SHOP_POS_DATA = tmp;
  process.env.SHOP_POS_LOCAL_INSTALLER = '1';
  process.env.ENTITLEMENTS_ENFORCE = 'false';
  process.env.CC_DEV_RETURN_CODES = '1';
  delete process.env.DATABASE_URL;
  delete process.env.SHOP_POS_DATABASE_URL;

  await require('../electron/database/db').initDatabase();
  const db = require('../electron/database/db').getDb();
  const access = require('../electron/services/customer-access');
  const gift = require('../electron/services/first-online-gift');
  const actor = { role: 'system', id: 0 };

  const saved = access.saveAccessSettings({
    mode: 'guest',
    phone_matching: false,
    require_otp: true,
    allow_new_customers: false,
    allow_guest_ordering: true,
    allow_guest_browsing: true,
    otp_expiry_minutes: 7
  });
  assert(saved.mode === 'guest', 'mode did not save');
  assert(saved.phone_matching === false, 'phone matching did not turn off');
  assert(saved.require_otp === true, 'otp toggle did not turn on');
  assert(saved.allow_new_customers === false, 'new customers toggle did not turn off');
  assert(saved.allow_guest_ordering === true, 'guest ordering did not turn on');
  assert(saved.allow_guest_browsing === true, 'guest browsing did not turn on');
  assert(saved.otp_expiry_minutes === 7, 'otp expiry did not save');
  const again = access.getAccessSettings();
  assert(again.otp_expiry_minutes === 7 && again.mode === 'guest', 'settings did not reload');

  const plusId = db.prepare('INSERT INTO customers (name, phone) VALUES (?,?)').run('Sipho Dlamini', '+27821234567').lastInsertRowid;
  const exactId = db.prepare('INSERT INTO customers (name, phone) VALUES (?,?)').run('Amahle Nkosi', '0829998888').lastInsertRowid;
  access.saveAccessSettings({ phone_matching: false });
  assert(!access.findCustomerByPhone('0821234567').customer, 'phone matching off still treated 082 and +27 as the same');
  assert(access.findCustomerByPhone('0829998888').customer?.id === exactId, 'exact phone was not found');
  access.saveAccessSettings({ phone_matching: true, mode: 'phone', require_otp: false, allow_new_customers: true });
  assert(access.findCustomerByPhone('0821234567').customer?.id === plusId, 'phone matching on did not recognise 082 as +27');

  db.prepare(`INSERT INTO online_orders_local (order_number, customer_id, customer_name, delivery_address, total, status)
    VALUES (?,?,?,?,?,?)`).run('ON-441', plusId, 'Sipho Dlamini', '14 Masingita Street, Giyani', 80, 'pending');
  const byName = access.adminSearch('Sipho');
  assert(byName.some((c) => c.id === plusId), 'name search missed Sipho');
  const byId = access.adminSearch(`#${plusId}`);
  assert(byId.some((c) => c.id === plusId), 'customer id search missed');
  const byPhone = access.adminSearch('0821234567');
  assert(byPhone.some((c) => c.id === plusId), 'phone search missed the +27 record');
  const byAddress = access.adminSearch('Masingita Street');
  assert(byAddress.some((c) => c.id === plusId), 'delivery address search missed');
  const byOrder = access.adminSearch('ON-441');
  assert(byOrder.some((c) => c.id === plusId), 'order number search missed');

  const fullBlocked = await access.start({ phone: '0821110000' }).then(() => 'opened').catch((err) => err.message);
  access.saveAccessSettings({ mode: 'full', allow_guest_ordering: false, allow_guest_browsing: false });
  let fullError = '';
  try { await access.start({ phone: '0821110000' }); } catch (err) { fullError = err.message; }
  assert(/not enabled/i.test(fullError), `full mode still allowed phone access: ${fullError || fullBlocked}`);
  access.saveAccessSettings({ mode: 'full', allow_guest_ordering: true, allow_new_customers: false, require_otp: false });
  const guestOrder = await access.start({ phone: '0820001111' });
  assert(guestOrder.status === 'not_allowed', `guest ordering did not stop a new customer: ${guestOrder.status}`);
  access.saveAccessSettings({ mode: 'phone', allow_new_customers: true, require_otp: true, otp_expiry_minutes: 4 });
  const otp = await access.start({ phone: '0820002222' });
  assert(otp.status === 'otp_sent' && otp.expires_in_minutes === 4, `otp expiry was not used: ${JSON.stringify(otp)}`);

  const webId = db.prepare(`INSERT INTO web_customers (customer_id, first_name, last_name, phone, password_hash, is_active)
    VALUES (?,?,?,?,?,1)`).run(plusId, 'Sipho', 'Dlamini', '+27821234567', 'x').lastInsertRowid;
  const freshWeb = db.prepare(`INSERT INTO web_customers (first_name, last_name, phone, password_hash, is_active)
    VALUES (?,?,?,?,1)`).run('New', 'Buyer', '0830001111', 'x').lastInsertRowid;
  gift.saveCampaign({
    enabled: true,
    gift_amount: 10,
    daily_limit: 5,
    min_order_amount: 0,
    expiry_days: 30,
    start_date: null,
    end_date: null,
    first_discount_enabled: true,
    first_discount_amount: 15,
    first_discount_start: null,
    first_discount_end: null
  }, actor);
  const kept = gift.getCampaign();
  assert(kept.enabled === true && kept.gift_amount === 10 && kept.daily_limit === 5, 'gift campaign fields were dropped');
  assert(kept.first_discount_enabled === true && kept.first_discount_amount === 15, 'first-order saving did not save');
  const first = gift.previewFirstOrderOffer(freshWeb, 100);
  assert(first.eligible && first.amount === 15 && first.gift_possible, `first order was not reduced: ${JSON.stringify(first)}`);
  db.prepare(`INSERT INTO online_orders_local (order_number, web_customer_id, customer_name, total, status)
    VALUES (?,?,?,?,?)`).run('ON-OLD', freshWeb, 'New Buyer', 40, 'completed');
  const second = gift.previewFirstOrderOffer(freshWeb, 100);
  assert(!second.eligible && second.amount === 0, 'second order still received the first-order saving');
  gift.saveCampaign({ first_discount_end: '2000-01-01' }, actor);
  const otherFresh = db.prepare(`INSERT INTO web_customers (first_name, phone, password_hash, is_active)
    VALUES (?,?,?,1)`).run('Late', '0830002222', 'x').lastInsertRowid;
  const expired = gift.previewFirstOrderOffer(otherFresh, 100);
  assert(!expired.eligible, 'expired saving still applied');
  gift.saveCampaign({ first_discount_end: null, enabled: true, gift_amount: 10, daily_limit: 5 }, actor);
  const stillGift = gift.getCampaign();
  assert(stillGift.gift_amount === 10 && stillGift.first_discount_amount === 15 && stillGift.enabled, 'saving the date cleared the gift campaign');

  const awarded = gift.tryAwardForOrder(
    { id: 880001, order_number: 'ON-GIFT', order_source: 'ONLINE', status: 'pending', total: 50, gift_card_amount: 0 },
    { id: webId, first_name: 'Sipho', last_name: 'Dlamini', phone: '+27821234567' }
  );
  assert(awarded?.gift_card_code && awarded.amount === 10, `gift after purchase did not issue: ${JSON.stringify(awarded)}`);

  console.log('ACCESS_AND_FIRST_ORDER_OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

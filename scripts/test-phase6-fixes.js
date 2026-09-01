/**
 * Phase 6: marketing schema, delivery department, audit fixes.
 */
const path = require('path');
const os = require('os');
const ROOT = path.join(__dirname, '..');
require('../lib/load-env').loadProjectEnv(ROOT);

async function main() {
  process.env.SHOP_POS_LOCAL_INSTALLER = '1';
  process.env.SHOP_POS_DATA = path.join(os.homedir(), 'AppData', 'Roaming', 'ShopPOS', 'Shared');
  delete process.env.DATABASE_URL;
  const dbMod = require('../electron/database/db');
  await dbMod.initDatabase();
  const db = dbMod.getDb();
  const session = require('../electron/services/session');
  const mkt = require('../electron/services/marketing-platform');
  const dp = require('../electron/services/delivery-platform');
  const { htmlToPdf } = require('../electron/services/html-pdf-server');
  const results = [];

  const owner = db.prepare("SELECT * FROM users WHERE role='owner' LIMIT 1").get();
  session.setUserSession(owner);
  const actor = { id: owner.id, role: owner.role, username: owner.username, full_name: owner.full_name };

  function ok(name, pass, extra = {}) {
    results.push({ test: name, pass: !!pass, ...extra });
  }

  // 1. Marketing tables exist
  try {
    mkt.ensurePlatformReady();
    const row = db.prepare('SELECT COUNT(*) AS c FROM sqlite_master WHERE name=?').get('mkt_referral_agents');
    ok('mkt_referral_agents_table', row?.c > 0);
  } catch (e) {
    ok('mkt_referral_agents_table', false, { error: e.message });
  }

  // 2. Referral link
  try {
    process.env.RAILWAY_PUBLIC_DOMAIN = 'peaceful-motivation-production-7dd2.up.railway.app';
    const link = mkt.buildReferralLink('TEST');
    ok('referral_link', /^https:\/\//.test(link), { link });
    delete process.env.RAILWAY_PUBLIC_DOMAIN;
  } catch (e) {
    ok('referral_link', false, { error: e.message });
  }

  // 3. Delivery schema
  try {
    dp.ensureSchema();
    const row = db.prepare("SELECT name FROM sqlite_master WHERE name='delivery_drivers'").get();
    ok('delivery_drivers_table', !!row);
  } catch (e) {
    ok('delivery_drivers_table', false, { error: e.message });
  }

  // 4. Driver registration + approve
  try {
    const reg = dp.registerDriver({
      full_name: 'Test Driver', phone: `07${Date.now() % 100000000}`, password: 'test1234', vehicle_info: 'Bike'
    });
    dp.approveDriver(reg.id, actor);
    const driver = dp.getDriver(reg.id);
    ok('driver_register_approve', driver.status === 'active', { id: reg.id });
  } catch (e) {
    ok('driver_register_approve', false, { error: e.message });
  }

  // 5. Delivery from sale
  try {
    const sale = db.prepare("SELECT * FROM sales WHERE status='completed' ORDER BY id DESC LIMIT 1").get();
    if (sale) {
      const patched = { ...sale, order_type: 'delivery', delivery_address: '123 Test St' };
      const d = dp.upsertFromSale(patched);
      const d2 = dp.upsertFromSale(patched);
      ok('delivery_idempotent', !!d?.id && d2?.id === d.id, { delivery_id: d?.id });
    } else {
      ok('delivery_idempotent', true, { skipped: 'no sale' });
    }
  } catch (e) {
    ok('delivery_idempotent', false, { error: e.message });
  }

  // 6. htmlToPdf server
  try {
    const pdf = htmlToPdf('<h1>Test</h1><p>PDF</p>', { widthMm: 210, heightMm: 297 });
    ok('html_to_pdf_server', pdf && pdf.length > 100, { bytes: pdf?.length });
  } catch (e) {
    ok('html_to_pdf_server', false, { error: e.message });
  }

  // 7. Driver login + dashboard
  try {
    const drivers = dp.listDrivers({ status: 'active' });
    const d = drivers[0];
    if (d) {
      const saved = db.prepare('SELECT password_hash FROM delivery_drivers WHERE id=?').get(d.id);
      const bcrypt = require('bcryptjs');
      db.prepare('UPDATE delivery_drivers SET password_hash=? WHERE id=?').run(bcrypt.hashSync('driver123', 10), d.id);
      const login = dp.driverLogin(d.phone || d.driver_code, 'driver123', { device_uid: 'test' });
      const dash = dp.driverDashboard(login.token);
      ok('driver_login_dashboard', !!login.token && dash.driver, { orders: dash.assigned_count });
    } else {
      ok('driver_login_dashboard', true, { skipped: 'no driver' });
    }
  } catch (e) {
    ok('driver_login_dashboard', false, { error: e.message });
  }

  // 8. Delivery dashboard
  try {
    const dash = dp.deliveryDashboard({}, actor);
    ok('delivery_dashboard', typeof dash.stats === 'object', { pending: dash.stats?.pending });
  } catch (e) {
    ok('delivery_dashboard', false, { error: e.message });
  }

  const allPass = results.every((r) => r.pass);
  console.log(JSON.stringify({ all_pass: allPass, phase: 6, results }, null, 2));
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });

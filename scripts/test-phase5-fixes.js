/**
 * Phase 5 verification: stock POS sync, referral landing, manager mobile.
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
  const store = require('../electron/services/store');
  const mkt = require('../electron/services/marketing-platform');
  const mm = require('../electron/services/mobile-manager');
  const results = [];

  const owner = db.prepare("SELECT * FROM users WHERE role='owner' LIMIT 1").get();
  session.setUserSession(owner);
  const actor = { id: owner.id, role: owner.role, username: owner.username, full_name: owner.full_name };

  function ok(name, pass, extra = {}) {
    results.push({ test: name, pass: !!pass, ...extra });
  }

  const product = db.prepare('SELECT id, name FROM products WHERE is_active = 1 LIMIT 1').get();

  // 1. Stock adjust add → POS sees it
  try {
    const before = store.getProducts({ for_pos: true, actor }).find((p) => p.id === product.id)?.stock_quantity;
    const addQty = 3;
    store.recordStockAdjustment({ product_id: product.id, qty: addQty, direction: 'add', reason: 'phase5 test' }, actor);
    const after = store.getProducts({ for_pos: true, actor }).find((p) => p.id === product.id)?.stock_quantity;
    ok('stock_add_pos_sync', after === before + addQty, { before, after });
  } catch (e) {
    ok('stock_add_pos_sync', false, { error: e.message });
  }

  // 2. Stock adjust "adjust" direction (set absolute)
  try {
    const setQty = 77;
    const r = store.recordStockAdjustment({ product_id: product.id, qty: setQty, direction: 'adjust', reason: 'phase5 set' }, actor);
    const posQty = store.getProducts({ for_pos: true, actor }).find((p) => p.id === product.id)?.stock_quantity;
    const reportQty = store.getStockReport().find((p) => p.id === product.id)?.stock_quantity;
    ok('stock_set_all_views', r.new_stock === setQty && posQty === setQty && reportQty === setQty, { posQty, reportQty });
  } catch (e) {
    ok('stock_set_all_views', false, { error: e.message });
  }

  // 3. Product edit form reads branch stock
  try {
    const p = store.getProduct(product.id);
    const posQty = store.getProducts({ for_pos: true, actor }).find((x) => x.id === product.id)?.stock_quantity;
    ok('get_product_branch_stock', p.stock_quantity === posQty, { product_qty: p.stock_quantity, pos_qty: posQty });
  } catch (e) {
    ok('get_product_branch_stock', false, { error: e.message });
  }

  // 4. Product save stock quantity
  try {
    store.saveProduct({ id: product.id, name: product.name, stock_quantity: 88 }, owner.id, owner.full_name);
    const posQty = store.getProducts({ for_pos: true, actor }).find((p) => p.id === product.id)?.stock_quantity;
    ok('product_save_stock', posQty === 88, { posQty });
  } catch (e) {
    ok('product_save_stock', false, { error: e.message });
  }

  // 5. Referral link builds full URL on cloud env
  try {
    process.env.RAILWAY_PUBLIC_DOMAIN = 'chisafood.up.railway.app';
    const link = mkt.buildReferralLink('TESTCODE');
    ok('referral_link_full_url', /^https:\/\//.test(link) && link.includes('/r/TESTCODE'), { link });
    delete process.env.RAILWAY_PUBLIC_DOMAIN;
  } catch (e) {
    delete process.env.RAILWAY_PUBLIC_DOMAIN;
    ok('referral_link_full_url', false, { error: e.message });
  }

  // 6. Public agent profile
  try {
    const agent = db.prepare("SELECT referral_code FROM mkt_referral_agents WHERE status='active' AND referral_code IS NOT NULL LIMIT 1").get();
    if (agent) {
      const profile = mkt.getAgentPublicProfile(agent.referral_code);
      ok('referral_public_profile', !!profile.full_name && !!profile.referral_code, { code: agent.referral_code });
    } else {
      ok('referral_public_profile', true, { skipped: 'no active agents' });
    }
  } catch (e) {
    ok('referral_public_profile', false, { error: e.message });
  }

  // 7. Referral click tracking
  try {
    const agent = db.prepare("SELECT referral_code FROM mkt_referral_agents WHERE referral_code IS NOT NULL LIMIT 1").get();
    if (agent) {
      const click = mkt.recordReferralClick(agent.referral_code, { source: 'phase5-test' });
      ok('referral_click', click.recognised === true, { code: agent.referral_code });
    } else {
      ok('referral_click', true, { skipped: 'no agents' });
    }
  } catch (e) {
    ok('referral_click', false, { error: e.message });
  }

  // 8. Manager mobile bootstrap + dashboard
  try {
    const boot = mm.bootstrapFromAdmin(actor, { platform: 'test', device_name: 'phase5' });
    const dash = mm.getDashboard(boot.token, { period: 'today' });
    ok('manager_mobile_dashboard', boot.token && typeof dash.orders === 'number' && Array.isArray(dash.recent_orders), {
      orders: dash.orders,
      sales: dash.sales,
      branches: dash.branches_total
    });
  } catch (e) {
    ok('manager_mobile_dashboard', false, { error: e.message });
  }

  const allPass = results.every((r) => r.pass);
  console.log(JSON.stringify({ all_pass: allPass, phase: 5, results }, null, 2));
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

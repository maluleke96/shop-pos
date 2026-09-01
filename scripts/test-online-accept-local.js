/** Test online order accept on local installer DB. */
const path = require('path');
const os = require('os');
process.env.SHOP_POS_LOCAL_INSTALLER = '1';
process.env.SHOP_POS_DATA = path.join(os.homedir(), 'AppData', 'Roaming', 'ShopPOS', 'Shared');
process.env.SHOP_POS_SYNC_URL = 'https://peaceful-motivation-production-7dd2.up.railway.app';
require('../lib/load-env').loadProjectEnv(path.join(__dirname, '..'));

(async () => {
  const dbMod = require('../electron/database/db');
  await dbMod.initDatabase();
  const store = require('../electron/services/store');
  const session = require('../electron/services/session');
  const sync = require('../electron/services/sync');
  const central = require('../electron/services/accounting-central');
  const raw = dbMod.getDb();
  const owner = raw.prepare("SELECT * FROM users WHERE role='owner' LIMIT 1").get();
  session.setUserSession(owner);

  const product = raw.prepare('SELECT * FROM products WHERE is_active=1 ORDER BY id LIMIT 1').get();
  const stockBefore = Number(product.stock_quantity);
  const items = [{ remote_id: product.id, name: product.name, quantity: 1, unit_price: Number(product.selling_price) }];

  sync.importCloudOrders([{
    id: 9999,
    remote_id: 9999,
    order_number: 'ONLINE-VERIFY-1003',
    branch_id: 1,
    customer_name: 'Verify Customer',
    customer_phone: '0821111111',
    items,
    items_json: JSON.stringify(items),
    total: Number(product.selling_price),
    status: 'pending',
    order_source: 'ONLINE',
    fulfillment_type: 'pickup',
    payment_method: 'online',
    payment_status: 'paid',
    created_at: new Date().toISOString()
  }]);

  const local = raw.prepare("SELECT * FROM online_orders_local WHERE order_number='ONLINE-VERIFY-1003'").get();
  const accept = await store.acceptOnlineOrderAsSale(local.id, owner, { fulfillment: 'pickup' });
  const sale = raw.prepare('SELECT * FROM sales WHERE id = ?').get(accept.saleId);
  const stockAfter = Number(raw.prepare('SELECT stock_quantity FROM products WHERE id = ?').get(product.id).stock_quantity);
  const flush = await central.flushIntegrationOutbox();

  const dup = await central.flushIntegrationOutbox();
  console.log(JSON.stringify({
    local_order_id: local.id,
    order_number: local.order_number,
    order_source: sale.order_source,
    order_type: sale.order_type,
    pos_sale_id: sale.id,
    receipt: sale.receipt_number,
    stock_before: stockBefore,
    stock_after: stockAfter,
    flush,
    dup_flush: dup,
    notes: sale.notes
  }, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });

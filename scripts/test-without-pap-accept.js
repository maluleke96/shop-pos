const path = require('path');
const fs = require('fs');
process.env.SHOP_POS_DATA_DIR = path.join(__dirname, '..', 'tmp-test-accept');
const p = process.env.SHOP_POS_DATA_DIR;
if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
const { getDb } = require('../electron/database/db');
getDb();
const store = require('../electron/services/store');
const db = getDb();
db.exec("INSERT INTO users (id,username,password_hash,full_name,role,is_active) VALUES (1,'t','x','Test','owner',1)");
db.exec("INSERT INTO products (id,name,selling_price,is_active,stock_quantity) VALUES (1,'chicken',130,1,100)");
db.exec("INSERT INTO product_modifiers (id,product_id,name,option_group,modifier_type,extra_price) VALUES (2,1,'Hot','sauce','extra',0),(6,1,'Without Pap','removal','removal',-10)");
const items = [{
  product_id: 1, remote_id: 1, name: 'chicken', quantity: 1, unit_price: 120,
  modifiers: [{ id: 6, name: 'Without Pap' }, { id: 2, name: 'Hot' }],
  modifiers_text: 'Hot, Without Pap'
}];
db.prepare(`INSERT INTO online_orders_local (order_number,branch_id,customer_name,items_json,subtotal,discount,total,status,order_source,payment_method)
  VALUES ('ONLINE-T1',1,'Test',?,130,0,120,'pending','ONLINE','online')`).run(JSON.stringify(items));
try {
  const r = store.acceptOnlineOrderAsSale(1, { id: 1, username: 't', full_name: 'Test', role: 'owner' });
  console.log(JSON.stringify({ ok: true, saleId: r.saleId, total: r.sale?.total }, null, 2));
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: e.message }, null, 2));
  process.exit(1);
}

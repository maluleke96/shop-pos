const path = require('path');
const os = require('os');
process.env.SHOP_POS_LOCAL_INSTALLER = '1';
process.env.SHOP_POS_DATA = path.join(os.homedir(), 'AppData', 'Roaming', 'ShopPOS', 'Shared');
delete process.env.DATABASE_URL;
require('../lib/load-env').loadProjectEnv(path.join(__dirname, '..'));

(async () => {
  const dbMod = require('../electron/database/db');
  await dbMod.initDatabase();
  const store = require('../electron/services/store');
  const session = require('../electron/services/session');
  const owner = dbMod.getDb().prepare("SELECT * FROM users WHERE role='owner' LIMIT 1").get();
  session.setUserSession(owner);
  const actor = { id: owner.id, role: owner.role, username: owner.username, full_name: owner.full_name };
  const p = store.getProducts({})[0];
  if (!p) throw new Error('No products');
  const marker = 'SAVEFIX-' + Date.now();
  const saved = store.saveProduct({
    id: p.id,
    name: p.name,
    selling_price: p.selling_price,
    description: marker,
    stock_quantity: p.stock_quantity
  }, actor.id, actor.username);
  const again = store.getProduct(p.id);
  const ok = again.description === marker && saved && (saved.id === p.id || saved === p.id);
  console.log(JSON.stringify({
    pass: !!ok,
    productId: p.id,
    description: again.description,
    savedIsObject: saved && typeof saved === 'object',
    savedName: saved?.name
  }, null, 2));
  store.saveProduct({
    id: p.id,
    name: p.name,
    selling_price: p.selling_price,
    description: p.description || '',
    stock_quantity: p.stock_quantity
  }, actor.id, actor.username);
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

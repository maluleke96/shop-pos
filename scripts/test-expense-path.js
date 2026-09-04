process.env.SHOP_POS_LOCAL_INSTALLER = '1';
process.env.SHOP_POS_DATA = require('path').join(require('os').homedir(), 'AppData', 'Roaming', 'ShopPOS', 'Shared');
process.env.SHOP_POS_SYNC_URL = 'https://chisafood.up.railway.app';
require('../lib/load-env').loadProjectEnv(require('path').join(__dirname, '..'));
(async () => {
  const dbMod = require('../electron/database/db');
  await dbMod.initDatabase();
  const store = require('../electron/services/store');
  const session = require('../electron/services/session');
  const owner = dbMod.getDb().prepare("SELECT * FROM users WHERE role='owner' LIMIT 1").get();
  session.setUserSession(owner);
  const exp = store.saveExpense({
    category: 'other', description: 'VERIFY-EXP-PATH', amount: 15,
    expense_date: '2026-08-29', payment_method: 'cash'
  }, owner.id, owner.full_name);
  const central = require('../electron/services/accounting-central');
  const flush = await central.flushIntegrationOutbox();
  console.log(JSON.stringify({ expense_id: exp.id || exp, flush }, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });

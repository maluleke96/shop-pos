const path = require('path');
const os = require('os');
const ROOT = path.join(__dirname, '..');
require('../lib/load-env').loadProjectEnv(ROOT);
const BASE = (process.env.SMOKE_URL || 'https://chisafood.up.railway.app').replace(/\/$/, '');
const SHARED = path.join(os.homedir(), 'AppData', 'Roaming', 'ShopPOS', 'Shared');

(async () => {
  process.env.SHOP_POS_LOCAL_INSTALLER = '1';
  process.env.SHOP_POS_DATA = SHARED;
  const dbMod = require('../electron/database/db');
  await dbMod.initDatabase();
  const central = require('../electron/services/accounting-central');
  const cashupId = Number(process.argv[2] || 7);
  const payload = central.buildIntegrationPayload('postFromCashup', [cashupId, {}]);
  const res = await fetch(`${BASE}/rpc`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method: 'acc:integrate', args: [payload] })
  });
  const json = await res.json();
  console.log(JSON.stringify({ cashupId, payload_data: payload?.snapshot?.data, result: json }, null, 2));
})();

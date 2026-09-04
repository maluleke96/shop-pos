/**
 * Safe one-time migration for historical local journal JE-00001 (RCP-20260826-00002).
 * Idempotent: skips if central already has sale_main journal for stable source id.
 * Does NOT migrate JE-00002 / RCP-20260826-00001 (already central JE-00002).
 */
const path = require('path');
const os = require('os');
const initSqlJs = require('sql.js/dist/sql-asm.js');

const ROOT = path.join(__dirname, '..');
require('../lib/load-env').loadProjectEnv(ROOT);
const BASE = (process.env.SMOKE_URL || 'https://chisafood.up.railway.app').replace(/\/$/, '');
const SHARED = path.join(os.homedir(), 'AppData', 'Roaming', 'ShopPOS', 'Shared');
const RECEIPT = 'RCP-20260826-00002';
const SKIP_RECEIPT = 'RCP-20260826-00001';

async function rpc(method, args) {
  const r = await fetch(`${BASE}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, args: args || [] })
  });
  return r.json();
}

async function main() {
  process.env.SHOP_POS_LOCAL_INSTALLER = '1';
  process.env.SHOP_POS_DATA = SHARED;
  const SQL = await initSqlJs();
  const db = new SQL.Database(require('fs').readFileSync(path.join(SHARED, 'shop-pos.db')));
  const q = (sql) => {
    const r = db.exec(sql);
    if (!r[0]) return [];
    return r[0].values.map((v) => Object.fromEntries(r[0].columns.map((c, i) => [c, v[i]])));
  };

  if (RECEIPT === SKIP_RECEIPT) throw new Error('Refusing to migrate journal #2');

  const sale = q(`SELECT * FROM sales WHERE receipt_number='${RECEIPT}'`)[0];
  if (!sale) throw new Error(`Sale not found: ${RECEIPT}`);

  const items = q(`SELECT si.*, p.buying_price FROM sale_items si LEFT JOIN products p ON p.id=si.product_id WHERE sale_id=${sale.id}`);
  const payments = q(`SELECT * FROM sale_payments WHERE sale_id=${sale.id}`);
  const localJournal = q(`SELECT * FROM acc_journals WHERE reference='${RECEIPT}'`)[0];

  const central = require('../electron/services/accounting-central');
  const deviceUid = process.env.SHOP_POS_DEVICE_UID || 'installer';
  const stableSourceId = central.stableSourceId(deviceUid, sale.id, sale.receipt_number);

  let integrationKey = process.env.SHOP_POS_INTEGRATE_KEY || process.env.SHOP_POS_ORG_API_KEY || '';
  if (!integrationKey) {
    try {
      const syncRow = q("SELECT sync_settings FROM shop_settings WHERE id=1")[0];
      const sync = syncRow?.sync_settings ? JSON.parse(syncRow.sync_settings) : {};
      integrationKey = sync.org_api_key || '';
    } catch (_) { /* ignore */ }
  }

  const payload = central.withIntegrationKey({
    hook: 'postFromSale',
    device_uid: deviceUid,
    local_id: sale.id,
    stable_source_id: stableSourceId,
    snapshot: { sale, items, payments },
    migrated_historical: true,
    original_journal_number: localJournal?.journal_number || 'JE-00001',
    original_posted_at: localJournal?.posted_at || sale.created_at
  });

  const dry = process.argv.includes('--dry-run');
  if (dry) {
    console.log(JSON.stringify({ dry_run: true, payload, sale_total: sale.total, integration_key_set: !!integrationKey }, null, 2));
    return;
  }

  const first = await rpc('acc:integrate', [payload]);
  const second = await rpc('acc:integrate', [payload]);
  console.log(JSON.stringify({
    receipt: RECEIPT,
    sale_total: sale.total,
    stable_source_id: stableSourceId,
    original_journal: localJournal?.journal_number || 'JE-00001',
    first,
    duplicate: second,
    success: first?.success !== false && first?.data?.success !== false
  }, null, 2));
  if (first?.success === false || first?.error) process.exit(1);
}

main().catch((e) => {
  console.error(e.stack || e);
  process.exit(1);
});

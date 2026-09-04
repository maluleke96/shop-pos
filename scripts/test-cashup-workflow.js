/**
 * End-to-end cash-up workflow test: POS close → local record → accounting outbox → central ledger.
 */
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
require('../lib/load-env').loadProjectEnv(ROOT);

const BASE = (process.env.SMOKE_URL || 'https://chisafood.up.railway.app').replace(/\/$/, '');
const SHARED = path.join(os.homedir(), 'AppData', 'Roaming', 'ShopPOS', 'Shared');

async function rpc(method, args, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['X-Session-Token'] = token;
  const r = await fetch(`${BASE}/rpc`, {
    method: 'POST', headers,
    body: JSON.stringify({ method, args: args || [] })
  });
  const data = await r.json().catch(() => ({}));
  return { data, token: r.headers.get('X-Session-Token') || data.sessionToken || token };
}

async function main() {
  process.env.SHOP_POS_LOCAL_INSTALLER = '1';
  process.env.SHOP_POS_DATA = SHARED;
  process.env.SHOP_POS_SYNC_URL = BASE;

  const dbMod = require('../electron/database/db');
  await dbMod.initDatabase();
  const raw = dbMod.getDb();
  const store = require('../electron/services/store');
  const session = require('../electron/services/session');
  const central = require('../electron/services/accounting-central');

  const owner = raw.prepare("SELECT * FROM users WHERE role='owner' LIMIT 1").get();
  session.setUserSession(owner);

  // Recover stuck shifts (open but already cashed out)
  const stuck = raw.prepare(`
    SELECT sh.id FROM shifts sh
    INNER JOIN cashup_sessions cu ON cu.shift_id = sh.id
    WHERE sh.status = 'open'
  `).all();
  for (const row of stuck) {
    raw.prepare(`
      UPDATE shifts SET status='closed', closed_at=COALESCE(closed_at, datetime('now'))
      WHERE id=?
    `).run(row.id);
  }

  const open = raw.prepare("SELECT id FROM shifts WHERE user_id=? AND status='open'").get(owner.id);
  if (open) {
    store.closeShift(open.id, {
      cash_counted: 0,
      actual_payments: { cash: 0, card: 0, eft: 0 },
      notes: 'AUTO-CLOSE before cash-up test'
    }, owner.id);
  }

  const shift = store.openShift(owner.id, 100);
  let product = raw.prepare('SELECT * FROM products WHERE is_active=1 AND stock_quantity > 0 LIMIT 1').get();
  if (!product) {
    product = raw.prepare('SELECT * FROM products WHERE is_active=1 LIMIT 1').get();
    if (product) raw.prepare('UPDATE products SET stock_quantity = COALESCE(stock_quantity,0) + 10 WHERE id=?').run(product.id);
  }
  const price = Number(product.selling_price) || 100;
  const cashAmt = Math.round(price * 0.5);
  const cardAmt = Math.round(price * 0.3);
  const eftAmt = price - cashAmt - cardAmt;
  const total = price;

  store.completeSale({
    items: [{
      product_id: product.id,
      product_name: product.name,
      quantity: 1,
      unit_price: total,
      buying_price: Number(product.buying_price) || 0
    }],
    discount: 0,
    amount_paid: total,
    payments: [
      { type: 'cash', amount: cashAmt },
      { type: 'card', amount: cardAmt },
      { type: 'eft', amount: eftAmt }
    ],
    notes: 'CASHUP-VERIFY-TEST'
  }, owner.id, owner.full_name, owner.role);

  const preview = store.getShiftClosePreview(shift.id, owner.id);
  const actualPayments = { cash: cashAmt, card: cardAmt, eft: eftAmt };
  let close;
  try {
    close = store.closeShift(shift.id, {
      cash_counted: cashAmt,
      closing_balance: cashAmt,
      actual_payments: actualPayments,
      notes: 'CASHUP-VERIFY-TEST'
    }, owner.id);
  } catch (e) {
    console.error('closeShift failed', e.stack || e);
    throw e;
  }

  console.log('step: close', close);
  const cashup = raw.prepare('SELECT * FROM cashup_sessions WHERE shift_id=? ORDER BY id DESC LIMIT 1').get(shift.id);
  console.log('step: cashup', cashup?.id);
  const cashupId = close.cashupId || close.cashup_id || cashup?.id;
  const outboxBefore = raw.prepare(
    "SELECT COUNT(*) c FROM sync_outbox WHERE entity_type='acc_integrate' AND synced_at IS NULL"
  ).get().c;

  const flush1 = await central.flushIntegrationOutbox();
  const flush2 = await central.flushIntegrationOutbox();

  const login = await rpc('auth:login', [owner.username, process.env.SMOKE_PASS || process.env.SHOP_POS_DB_PASSWORD || '']);
  const token = login.token;
  const journals = await rpc('acc:journals', [{ limit: 100, source_type: 'cashup' }], token);
  const finance = await rpc('acc:cashupFinance', [{}], token).catch(() => ({ data: {} }));

  const cashupJournals = (journals.data?.data || []).filter((j) =>
    Number(j.source_id) === Number(close.cashupId) || String(j.description || '').includes('Cash-up')
  );

  const result = {
    shift_id: shift.id,
    cashup_id: cashupId,
    local_cashup: cashup,
    amounts: {
      cash_sales: cashup?.cash_sales,
      card_sales: cashup?.card_sales,
      eft_sales: cashup?.eft_sales,
      expected_cash: cashup?.expected_cash,
      actual_cash: cashup?.actual_cash,
      preview_total_sales: preview.totalSales
    },
    reconcile: {
      cash_ok: Number(cashup?.cash_sales) === cashAmt,
      card_ok: Number(cashup?.card_sales) === cardAmt,
      eft_ok: Number(cashup?.eft_sales) === eftAmt,
      sales_ok: Number(preview.totalSales) === total
    },
    outbox_pending_before_flush: outboxBefore,
    flush1,
    flush2,
    duplicate_flush_blocked: flush2.flushed === 0,
    central_cashup_journals: cashupJournals.length,
    central_finance_rows: finance.data?.data?.length ?? null,
    pass: cashup
      && Number(cashup.cash_sales) === cashAmt
      && Number(cashup.card_sales) === cardAmt
      && Number(cashup.eft_sales) === eftAmt
      && flush1.flushed >= 1
      && flush2.flushed === 0
  };

  console.log(JSON.stringify(result, null, 2));
  process.exit(result.pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e.stack || e);
  process.exit(1);
});

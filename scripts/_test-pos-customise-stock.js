/** Ensure Customise items are not false-OOS when capacity default is 0. */
const path = require('path');
const fs = require('fs');
const os = require('os');

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-cust-'));
  process.env.SHOP_POS_DATA = tmp;
  process.env.ENTITLEMENTS_ENFORCE = 'false';
  delete process.env.DATABASE_URL;
  delete process.env.SHOP_POS_DATABASE_URL;

  await require('../electron/database/db').initDatabase();
  const db = require('../electron/database/db').getDb();
  const store = require('../electron/services/store');
  const { applyCapacityToProducts, validateSaleCapacity } = require('../electron/services/production-availability');

  db.prepare(`INSERT INTO products (name, selling_price, buying_price, stock_quantity, is_active, has_recipe, requires_options, production_capacity)
    VALUES ('Pap Plate', 50, 10, 0, 1, 1, 1, 0)`).run();
  const id = db.prepare(`SELECT id FROM products WHERE name = 'Pap Plate'`).get().id;
  db.prepare(`INSERT INTO product_modifiers (product_id, name, extra_price, modifier_type, option_group)
    VALUES (?, 'Large', 10, 'option', 'Size')`).run(id);

  const rows = store.getProducts({ for_pos: true });
  const p = rows.find((x) => Number(x.id) === Number(id));
  if (!p) throw new Error('product missing from for_pos');
  if (p.available_meals != null && Number(p.available_meals) === 0 && p.is_production_based) {
    throw new Error('applyCapacity still forces false OOS meals=0');
  }

  const enriched = applyCapacityToProducts([p]);
  if (enriched[0].is_production_based === true && Number(enriched[0].available_meals) === 0) {
    throw new Error('enriched still production-based at 0');
  }

  // Fake POS getStockInfo rules
  const mode = String(enriched[0].production_mode || '').trim();
  const rawCap = enriched[0].available_meals ?? enriched[0].production_capacity;
  const capNum = rawCap == null || rawCap === '' ? null : Number(rawCap);
  const limiting = enriched[0].limiting_ingredient_name || null;
  const enforced = !!limiting || (capNum != null && Number.isFinite(capNum) && capNum > 0);
  const isMeal = !!(enriched[0].has_recipe && mode !== 'make_to_stock' && enforced);
  if (isMeal) throw new Error('getStockInfo would still treat as meal OOS');

  validateSaleCapacity([{ product_id: id, quantity: 1, modifiers: [{ name: 'Large' }] }], { allowOversell: false });

  console.log('POS_CUSTOMISE_STOCK_OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

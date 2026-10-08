/**
 * Recipe food cost & profitability checks against a throwaway SQLite file.
 * Does not read or write Chisa, Lab, or any configured Postgres database.
 * Test-only ingredients, meals, sales, production and waste are seeded in the temp DB on fixed
 * past dates so every expected figure can be verified by hand.
 */
const fs = require('fs');
const path = require('path');

const DB_KEYS = [
  'SHOP_POS_DATABASE_URL', 'DATABASE_URL',
  'SHOP_POS_DB_HOST', 'SUPABASE_DB_HOST', 'PGHOST',
  'SHOP_POS_DB_PASSWORD', 'SUPABASE_DB_PASSWORD', 'PGPASSWORD',
  'SHOP_POS_DB_USER', 'SUPABASE_DB_USER', 'PGUSER',
  'SHOP_POS_DB_NAME', 'SUPABASE_DB_NAME', 'PGDATABASE',
  'SHOP_POS_DB_PORT', 'SUPABASE_DB_PORT', 'PGPORT'
];
DB_KEYS.forEach((k) => { delete process.env[k]; });
['SHOP_POS_AI_API_KEY', 'OPENAI_API_KEY'].forEach((k) => { delete process.env[k]; });

const dataDir = path.join(__dirname, '..', `.tmp-rfc-sqlite-${process.pid}`);
fs.rmSync(dataDir, { recursive: true, force: true });
fs.mkdirSync(dataDir, { recursive: true });
process.on('exit', () => { try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (_) { /* best effort */ } });
process.env.SHOP_POS_LOCAL_INSTALLER = '1';
process.env.SHOP_POS_DATA = dataDir;

const failures = [];
function check(name, cond, extra) {
  if (cond) console.log('PASS', name);
  else {
    failures.push(name);
    console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 700));
  }
}
function throws(fn) {
  try { fn(); return null; } catch (err) { return err.message || String(err); }
}
const near = (a, b, eps = 0.005) => a != null && Math.abs(Number(a) - Number(b)) < eps;

(async () => {
  const dbMod = require('../electron/database/db');
  await dbMod.initDatabase();
  const db = dbMod.getDb();
  const session = require('../electron/services/session');
  const rfc = require('../electron/services/recipe-food-cost');
  const rp = require('../electron/services/recipe-production');
  const fin = require('../electron/services/financial-intelligence');
  rfc.ensureSchema();

  try { db.prepare("INSERT INTO branches (id, name, code) VALUES (2, 'Second Branch', 'SEC')").run(); } catch (_) { /* exists */ }

  const mkUser = (username, role) => {
    db.prepare('INSERT INTO users (username, password_hash, full_name, role, is_active, permissions) VALUES (?,?,?,?,1,?)').run(username, 'x', `${username} name`, role, '{}');
    return db.prepare('SELECT id, username, full_name, role, is_active, permissions, branch_id FROM users WHERE username = ?').get(username);
  };
  const owner = mkUser('rfcowner', 'owner');
  const viewer = mkUser('rfcviewer', 'manager');
  const kitchen = mkUser('rfckitchen', 'supervisor');
  const outsider = mkUser('rfcoutsider', 'manager');
  db.prepare('INSERT INTO recipe_user_access (user_id, recipe_role, enabled) VALUES (?, ?, 1)').run(viewer.id, 'viewer');
  db.prepare('INSERT INTO recipe_user_access (user_id, recipe_role, enabled) VALUES (?, ?, 1)').run(kitchen.id, 'kitchen_manager');
  const as = (u) => { session.setUserSession(u); return u; };

  db.prepare("INSERT INTO categories (name) VALUES ('RFC Meals')").run();
  const cat = db.prepare("SELECT id FROM categories WHERE name = 'RFC Meals'").get().id;
  const addIng = (name, cost, stockUnit, stock = 1000) => {
    db.prepare("INSERT INTO products (name, category_id, selling_price, buying_price, stock_quantity, unit, stock_unit, item_type) VALUES (?,?,0,?,?,?,?,'ingredient')").run(name, cat, cost, stock, stockUnit, stockUnit);
    return db.prepare('SELECT id FROM products WHERE name = ?').get(name).id;
  };
  const fish = addIng('Test Fish', 40, 'kg', 100);
  const pap = addIng('Test Pap', 8, 'kg', 100);
  const cabbage = addIng('Test Cabbage', 15, 'kg', 100);
  const chicken = addIng('Test Chicken', 0.09, 'g', 10000);
  const sauce = addIng('Test Sauce', 12, 'each', 50);
  const oil = addIng('Test Oil', 0, 'l', 20);
  const rolls = addIng('Test Rolls', 2.5, 'each', 200);
  db.prepare("INSERT INTO product_conversions (product_id, from_qty, from_unit, to_qty, to_unit) VALUES (?, 1, 'pack', 12, 'each')").run(rolls);

  const addMeal = (name, price, items, mode = 'make_to_order') => {
    db.prepare('INSERT INTO products (name, category_id, selling_price, buying_price, stock_quantity) VALUES (?,?,?,0,0)').run(name, cat, price);
    const id = db.prepare('SELECT id FROM products WHERE name = ?').get(name).id;
    require('../electron/services/inventory').saveProductRecipe(id, items);
    try { db.prepare('UPDATE products SET production_mode = ? WHERE id = ?').run(mode, id); } catch (_) { /* optional column */ }
    return id;
  };
  const fishPap = addMeal('Test Fish & Pap', 60, [
    { ingredient_product_id: fish, quantity: 500, unit: 'g' },
    { ingredient_product_id: pap, quantity: 0.25, unit: 'kg' },
    { ingredient_product_id: cabbage, quantity: 100, unit: 'grams' },
    { ingredient_product_id: pap, quantity: 0.25, unit: 'kg', include_rule: 'when_selected', option_name: 'Extra Pap' }
  ]);
  const chickenPlate = addMeal('Test Chicken Plate', 50, [
    { ingredient_product_id: chicken, quantity: 0.25, unit: 'kg' },
    { ingredient_product_id: pap, quantity: 250, unit: 'g' }
  ]);
  const broken = addMeal('Test Broken Meal', 30, [
    { ingredient_product_id: sauce, quantity: 50, unit: 'ml' },
    { ingredient_product_id: oil, quantity: 0.1, unit: 'L' }
  ]);
  const rollMeal = addMeal('Test Roll Basket', 40, [{ ingredient_product_id: rolls, quantity: 0.5, unit: 'pack' }]);
  const fishCakes = addMeal('Test Fish Cakes', 25, [{ ingredient_product_id: fish, quantity: 0.5, unit: 'kg' }], 'make_to_stock');
  db.prepare("INSERT INTO recipe_profiles (product_id, name, status, production_mode, yield_qty) VALUES (?, 'Test Fish Cakes', 'approved', 'make_to_stock', 1)").run(fishCakes);
  const fishCakesProfile = db.prepare('SELECT id FROM recipe_profiles WHERE product_id = ?').get(fishCakes).id;

  let rn = 0;
  const sale = (at, branchId, items, status = 'completed') => {
    const total = Math.round(items.reduce((a, it) => a + it.total, 0) * 100) / 100;
    rn += 1;
    db.prepare('INSERT INTO sales (receipt_number, user_id, subtotal, discount, total, amount_paid, status, created_at, branch_id) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(`RFC-${rn}`, owner.id, total, 0, total, total, status, at, branchId);
    const id = db.prepare('SELECT id FROM sales WHERE receipt_number = ?').get(`RFC-${rn}`).id;
    for (const it of items) {
      db.prepare('INSERT INTO sale_items (sale_id, product_id, product_name, quantity, unit_price, buying_price, total, modifiers_text) VALUES (?,?,?,?,?,?,?,?)')
        .run(id, it.id, it.name, it.qty, it.total / it.qty, 0, it.total, it.mods || null);
    }
    return id;
  };

  // ── Permissions ──
  session.clearAll();
  check('no session is rejected', /Authentication required/.test(throws(() => rfc.overview({})) || ''));
  as(outsider);
  check('user without Recipe access is rejected', /not authorized/i.test(throws(() => rfc.overview({}, outsider)) || ''));
  as(kitchen);
  check('kitchen role cannot view costs', /cannot view food cost/i.test(throws(() => rfc.overview({}, kitchen)) || ''));
  const kpc = rfc.productionCalculator(fishPap, 10, {}, kitchen);
  check('kitchen role can use production calculator without costs', kpc.lines.length === 3 && kpc.expected_cost === null && kpc.lines[0].expected_cost === undefined, kpc);
  as(viewer);
  check('viewer role can view costs', !!rfc.overview({}, viewer).cards.length);
  check('viewer role cannot change targets', /cannot change food cost targets/i.test(throws(() => rfc.saveTargets({ settings: { food_cost_target_pct: 30 } }, viewer)) || ''));
  as(owner);

  // ── Units ──
  check('500 g → 0.5 kg', near(rfc.convertUnits(fish, 500, 'g', 'kg').qty, 0.5, 1e-9));
  check('alias "Kilograms" → g', near(rfc.convertUnits(fish, 1.5, 'Kilograms', 'g').qty, 1500, 1e-9));
  check('250 ml → 0.25 litre', near(rfc.convertUnits(oil, 250, 'ml', 'litre').qty, 0.25, 1e-9));
  check('piece = each', near(rfc.convertUnits(sauce, 3, 'pieces', 'each').qty, 3, 1e-9));
  check('product conversion 2 pack → 24 each', near(rfc.convertUnits(rolls, 2, 'pack', 'each').qty, 24, 1e-9));
  check('kg → ml is refused', rfc.convertUnits(fish, 1, 'kg', 'ml').ok === false);
  check('ml → each without conversion is refused', rfc.convertUnits(sauce, 50, 'ml', 'each').ok === false);

  // ── Cost cards ──
  const ctx = rfc.loadContext();
  const fp = rfc.costRecipe(ctx, fishPap);
  check('fish line 500 g × R40/kg = R20', near(fp.lines[0].line_cost, 20), fp.lines[0]);
  check('pap line 0.25 kg × R8 = R2', near(fp.lines[1].line_cost, 2));
  check('cabbage line 100 g × R15/kg = R1.50', near(fp.lines[2].line_cost, 1.5));
  check('recipe cost R23.50 (optional line excluded)', near(fp.recipe_cost, 23.5), fp.recipe_cost);
  check('optional Extra Pap shown at R2', fp.optional_lines.length === 1 && near(fp.optional_lines[0].cost, 2));
  check('food cost % = 23.5 ÷ 60 × 100 = 39.2%', fp.food_cost_pct === 39.2, fp.food_cost_pct);
  check('gross contribution = 60 − 23.5 = R36.50', near(fp.gross_contribution, 36.5));
  check('costliest ingredient is fish (85.1%)', fp.costliest?.name === 'Test Fish' && fp.costliest.share_pct === 85.1, fp.costliest);
  const cp = rfc.costRecipe(ctx, chickenPlate);
  check('chicken 0.25 kg at R0.09/g = R22.50; plate R24.50', near(cp.lines[0].line_cost, 22.5) && near(cp.recipe_cost, 24.5), cp.lines);
  const rb = rfc.costRecipe(ctx, rollMeal);
  check('half a pack of 12 rolls × R2.50 = R15', near(rb.recipe_cost, 15), rb);
  const br = rfc.costRecipe(ctx, broken);
  check('missing conversion → INSUFFICIENT DATA, no cost', br.complete === false && br.recipe_cost === null && br.food_cost_pct === null && br.issues.some((i) => /No conversion/.test(i)), br.issues);
  check('missing purchase cost → INSUFFICIENT DATA', br.issues.some((i) => /no reliable purchase cost/.test(i)));

  // ── Allocations from Financial Intelligence ──
  fin.saveCategory({ name: 'Rent', kind: 'rent', pct: 10, effective_from: '2020-01-01' }, owner);
  fin.saveCategory({ name: 'Stock', kind: 'stock', pct: 40, effective_from: '2020-01-01' }, owner);
  fin.saveCategory({ name: 'Owner', kind: 'owner', pct: 5, effective_from: '2020-01-01' }, owner);
  const card = rfc.costCard(fishPap, {}, owner);
  check('allocations use FIC rent 10% only (stock/owner excluded)', card.allocated_costs === 6 && card.contribution_after_allocations === 30.5, { a: card.allocated_costs, c: card.contribution_after_allocations });

  // ── Production calculator ──
  const pc = rfc.productionCalculator(fishPap, 100, {}, owner);
  check('produce 100: fish 50 kg', near(pc.lines[0].required_qty, 50) && pc.lines[0].stock_unit === 'kg', pc.lines[0]);
  check('produce 100: expected cost R2,350', near(pc.expected_cost, 2350), pc.expected_cost);
  check('produce 100: stock 100 kg fish is enough', pc.lines[0].enough === true && pc.can_produce === true);
  check('production calculator does not deduct stock', Number(db.prepare('SELECT stock_quantity FROM products WHERE id = ?').get(fish).stock_quantity) === 100);

  // ── Sales & history ──
  rfc.upsertSnapshot(rfc.costRecipe(rfc.loadContext(), fishPap), '2024-03-01');
  sale('2024-03-05 10:00:00', 1, [{ id: fishPap, name: 'Test Fish & Pap', qty: 10, total: 600 }]);
  sale('2024-03-05 11:00:00', 1, [{ id: fishPap, name: 'Test Fish & Pap', qty: 2, total: 140, mods: 'Extra Pap' }]);
  sale('2024-03-06 10:00:00', 1, [{ id: chickenPlate, name: 'Test Chicken Plate', qty: 4, total: 200 }]);
  sale('2024-03-07 10:00:00', 2, [{ id: fishPap, name: 'Test Fish & Pap', qty: 3, total: 180 }]);
  sale('2024-03-08 10:00:00', 1, [{ id: fishPap, name: 'Test Fish & Pap', qty: 50, total: 3000 }], 'voided');
  const MAR = { from: '2024-03-01', to: '2024-03-31' };
  const sp = rfc.salesPerformance(MAR, owner);
  const fpRow = sp.rows.find((r) => r.product_id === fishPap);
  check('March Fish & Pap qty 15 (voided excluded)', fpRow?.qty === 15, fpRow);
  check('March Fish & Pap revenue R920', near(fpRow?.revenue, 920));
  check('March Fish & Pap recipe cost R356.50 (incl. Extra Pap option)', near(fpRow?.recipe_cost, 356.5), fpRow);
  check('March Fish & Pap contribution R563.50', near(fpRow?.contribution, 563.5));
  check('March Fish & Pap costed from historical snapshot', /each sale day/.test(fpRow?.cost_basis || ''), fpRow?.cost_basis);
  const cpRow = sp.rows.find((r) => r.product_id === chickenPlate);
  check('Chicken Plate cost R98 at current cost, labelled', near(cpRow?.recipe_cost, 98) && /Current recipe cost/.test(cpRow?.cost_basis || ''), cpRow);
  check('best seller is Fish & Pap', sp.best[0]?.product_id === fishPap);
  check('unsold recipes listed', sp.not_sold.some((p) => p.product_id === rollMeal));
  const b1 = rfc.salesPerformance({ ...MAR, branch_id: 1 }, owner).rows.find((r) => r.product_id === fishPap);
  check('branch 1 filter: qty 12, revenue R740, cost R286', b1?.qty === 12 && near(b1.revenue, 740) && near(b1.recipe_cost, 286), b1);
  const b2 = rfc.salesPerformance({ ...MAR, branch_id: 2 }, owner).rows.find((r) => r.product_id === fishPap);
  check('branch 2 filter: qty 3, revenue R180', b2?.qty === 3 && near(b2.revenue, 180), b2);
  const d5 = rfc.salesPerformance({ from: '2024-03-05', to: '2024-03-05' }, owner).rows.find((r) => r.product_id === fishPap);
  check('date filter 5 March: qty 12', d5?.qty === 12, d5);
  check('empty period has no rows', rfc.salesPerformance({ from: '2023-01-01', to: '2023-01-31' }, owner).rows.length === 0);

  // ── What-if ──
  const wi = rfc.whatIf({ product_id: fishPap, price: 70, quantity: 100, target_contribution: 1000 }, owner);
  check('what-if price R70: food cost 33.6%, contribution R46.50', wi.simulation.food_cost_pct === 33.6 && near(wi.simulation.gross_contribution, 46.5), wi.simulation);
  check('what-if: plates for R1,000 = 28 now, 22 at R70', wi.current.plates_for_target === 28 && wi.simulation.plates_for_target === 22, [wi.current.plates_for_target, wi.simulation.plates_for_target]);
  check('what-if: total contribution difference R1,000 for 100 plates', near(wi.difference.total_contribution, 1000));
  check('what-if never changes the POS price', Number(db.prepare('SELECT selling_price FROM products WHERE id = ?').get(fishPap).selling_price) === 60);
  const wf = rfc.whatIf({ product_id: fishPap, ingredient_costs: [{ ingredient_product_id: fish, change: 10, unit: 'kg' }] }, owner);
  check('fish +R10/kg: cost R28.50', near(wf.simulation.recipe_cost, 28.5), wf.simulation.recipe_cost);
  const wg = rfc.whatIf({ product_id: fishPap, ingredient_costs: [{ ingredient_product_id: chicken, change: 10, unit: 'kg' }] }, owner);
  check('chicken change does not affect Fish & Pap', near(wg.simulation.recipe_cost, 23.5));
  const wcp = rfc.whatIf({ product_id: chickenPlate, ingredient_costs: [{ ingredient_product_id: chicken, change: 10, unit: 'kg' }] }, owner);
  check('chicken +R10/kg (stock in g): plate +R2.50', near(wcp.difference.recipe_cost, 2.5), wcp.difference);
  const wp = rfc.whatIf({ product_id: fishPap, portions: [{ ingredient_product_id: fish, quantity: 400, unit: 'g' }] }, owner);
  check('portion 500 g → 400 g: cost R19.50', near(wp.simulation.recipe_cost, 19.5));
  check('what-if never changes the recipe', Number(db.prepare('SELECT quantity FROM product_recipe_items WHERE product_id = ? AND ingredient_product_id = ?').get(fishPap, fish).quantity) === 500);

  // ── Expected vs actual (variance) ──
  const vMar = rfc.variance(MAR, owner);
  const vFish = vMar.rows.find((r) => r.ingredient_product_id === fish);
  check('March expected fish from sales = 15 × 0.5 = 7.5 kg', near(vFish?.expected_from_sales, 7.5, 1e-6), vFish);
  const vPap = vMar.rows.find((r) => r.ingredient_product_id === pap);
  check('March expected pap = 15×0.25 + 2×0.25 (Extra Pap) + 4×0.25 = 5.25 kg', near(vPap?.expected_qty, 5.25, 1e-6), vPap);
  const hasSmBranch = (() => { try { db.prepare('SELECT branch_id FROM stock_movements WHERE 1=0').all(); return true; } catch (_) { return false; } })();
  const move = (pid, type, qty, prev, next, ref, refId, at) => {
    if (hasSmBranch) db.prepare('INSERT INTO stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, reference_type, reference_id, notes, user_id, created_at, branch_id) VALUES (?,?,?,?,?,?,?,?,?,?,1)').run(pid, type, qty, prev, next, ref, refId, 'rfc test', owner.id, at);
    else db.prepare('INSERT INTO stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, reference_type, reference_id, notes, user_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(pid, type, qty, prev, next, ref, refId, 'rfc test', owner.id, at);
  };
  db.prepare("INSERT INTO production_batches (recipe_profile_id, product_id, planned_qty, produced_qty, status, production_cost, branch_id, completed_at, created_at) VALUES (?, ?, 100, 100, 'completed', 2000, 1, '2024-04-10 10:00:00', '2024-04-10 10:00:00')").run(fishCakesProfile, fishCakes);
  const batchId = db.prepare('SELECT MAX(id) AS id FROM production_batches').get().id;
  try {
    db.prepare("INSERT INTO production_batch_items (batch_id, ingredient_product_id, quantity, unit, unit_cost, line_cost, planned_quantity) VALUES (?, ?, 55, 'kg', 40, 2200, 50)").run(batchId, fish);
  } catch (_) {
    db.prepare("INSERT INTO production_batch_items (batch_id, ingredient_product_id, quantity, unit, unit_cost, line_cost) VALUES (?, ?, 55, 'kg', 40, 2200)").run(batchId, fish);
  }
  move(fish, 'remove', 55, 100, 45, 'production', batchId, '2024-04-10 10:00:00');
  const vApr = rfc.variance({ from: '2024-04-01', to: '2024-04-30' }, owner).rows.find((r) => r.ingredient_product_id === fish);
  check('April expected 50 kg vs actual 55 kg', near(vApr?.expected_qty, 50) && near(vApr?.actual_qty, 55), vApr);
  check('April variance +5 kg = +10%', near(vApr?.variance_qty, 5) && vApr?.variance_pct === 10, vApr);
  check('April variance cost 5 × R40 = R200', near(vApr?.variance_cost, 200));
  check('variance category above expected', vApr?.category === 'above_expected');
  check('variance explanation is "requires review", not a cause', vApr?.potential_explanations.length > 0 && vApr.potential_explanations.every((e) => /requires review/.test(e)), vApr?.potential_explanations);

  // ── Waste ──
  db.prepare("INSERT INTO recipe_waste_logs (waste_type, product_id, quantity, unit, cost, reason, status, recorded_by, approved_by, approved_at, branch_id, created_at) VALUES ('spoilage', ?, 2, 'kg', 80, 'Spoiled', 'approved', ?, ?, '2024-05-03 10:00:00', 1, '2024-05-03 10:00:00')").run(fish, owner.id, owner.id);
  move(fish, 'remove', 2, 45, 43, 'recipe_waste', 1, '2024-05-03 10:00:00');
  db.prepare("INSERT INTO recipe_waste_logs (waste_type, product_id, quantity, unit, cost, reason, status, recorded_by, branch_id, created_at) VALUES ('prep', ?, 500, 'g', 0, 'Trim', 'pending', ?, 2, '2024-05-04 10:00:00')").run(cabbage, owner.id);
  const MAY = { from: '2024-05-01', to: '2024-05-31' };
  const w = rfc.waste(MAY, owner);
  const wf1 = w.rows.find((r) => r.product_id === fish);
  check('waste 2 kg fish × R40 = R80', near(wf1?.cost, 80), wf1);
  check('waste is 100% of May fish usage', wf1?.waste_pct_of_usage === 100, wf1);
  const wc = w.rows.find((r) => r.product_id === cabbage);
  check('waste 500 g cabbage converted to 0.5 kg × R15 = R7.50 (pending)', near(wc?.cost, 7.5) && wc.status === 'pending', wc);
  check('waste totals approved R80, pending R7.50', near(w.totals.approved_cost, 80) && near(w.totals.pending_cost, 7.5), w.totals);
  check('waste branch filter', rfc.waste({ ...MAY, branch_id: 1 }, owner).rows.length === 1);
  const vMay = rfc.variance(MAY, owner).rows.find((r) => r.ingredient_product_id === fish);
  check('waste appears in actual usage breakdown', near(vMay?.actual_breakdown.waste, 2) && vMay.category === 'no_expected_usage', vMay);

  // ── Ingredient price change → recalculation & history ──
  rfc.overview({}, owner);
  rp.restockIngredient({ product_id: fish, quantity: 10, unit: 'kg', unit_cost: 48, _skipBatchRecord: true }, owner);
  const fpNew = rfc.costRecipe(rfc.loadContext(), fishPap);
  check('fish R40 → R48: Fish & Pap cost +R4 (R27.50)', near(fpNew.recipe_cost, 27.5), fpNew.recipe_cost);
  const pch = rfc.priceChanges({ days: 30 }, owner);
  const fishChange = pch.rows.find((r) => r.ingredient_product_id === fish);
  check('price change recorded 40 → 48 (+20%)', fishChange?.old_unit_cost === 40 && fishChange.new_unit_cost === 48 && fishChange.change_pct === 20, fishChange);
  const aff = fishChange?.affected.find((a) => a.product_id === fishPap);
  check('affected recipe old R23.50 / new R27.50, food cost 39.2% → 45.8%', near(aff?.old_cost, 23.5) && near(aff?.new_cost, 27.5) && aff.old_food_cost_pct === 39.2 && aff.new_food_cost_pct === 45.8, aff);
  check('price change also lists Fish Cakes', fishChange?.affected.some((a) => a.product_id === fishCakes));
  const spAfter = rfc.salesPerformance(MAR, owner).rows.find((r) => r.product_id === fishPap);
  check('history not rewritten: March cost stays R356.50', near(spAfter?.recipe_cost, 356.5), spAfter);
  const hist = rfc.costHistory(fishPap, owner).rows;
  check('cost history keeps 2024-03-01 R23.50 and today R27.50', hist[0]?.date === '2024-03-01' && near(hist[0].recipe_cost, 23.5) && near(hist[hist.length - 1].recipe_cost, 27.5), hist);

  // ── Targets & alerts ──
  rfc.saveTargets({ settings: { food_cost_target_pct: 35 } }, owner);
  rfc.saveTargets({ product: { product_id: fishPap, contribution_target: 40 } }, owner);
  check('targets saved', rfc.getTargets(owner).settings.food_cost_target_pct === 35);
  check('invalid target rejected', /between 0 and 100/.test(throws(() => rfc.saveTargets({ settings: { food_cost_target_pct: 150 } }, owner)) || ''));
  const al = rfc.alerts({}, owner).alerts;
  check('alert: Fish & Pap food cost above 35% target', al.some((a) => a.type === 'food_cost_above_target' && a.product_id === fishPap), al.map((a) => a.type));
  check('alert: contribution below target → price review', al.some((a) => a.type === 'price_review' && a.product_id === fishPap));
  check('alert: fish purchase cost increase', al.some((a) => a.type === 'ingredient_price_up' && a.ingredient_product_id === fish));
  check('alert: recipe cost rose', al.some((a) => a.type === 'recipe_cost_up' && a.product_id === fishPap));
  check('alert: incomplete recipe flagged', al.some((a) => a.type === 'insufficient_data' && a.product_id === broken));
  check('alerts never change prices', Number(db.prepare('SELECT selling_price FROM products WHERE id = ?').get(fishPap).selling_price) === 60);

  // ── AI advisor ──
  const ai1 = await rfc.aiAsk('What happens if fish increases by R10 per kg?', {}, owner);
  check('AI fish +R10/kg: Fish & Pap 27.50 → 32.50', ai1.facts.some((f) => /Test Fish & Pap: cost R ?27[.,]50 → R ?32[.,]50|27\.5.*32\.5/.test(f.text.replace(/\s/g, ' '))), ai1.facts.map((f) => f.text));
  const ai2 = await rfc.aiAsk('How many plates do I need to sell to make R1,000 contribution?', { product_id: fishPap }, owner);
  check('AI plates for R1,000 at R32.50 contribution = 31', ai2.facts.some((f) => /31 plates/.test(f.text)), ai2.facts.map((f) => f.text));
  const ai3 = await rfc.aiAsk('What does this meal cost to make?', { product_id: broken }, owner);
  check('AI says INSUFFICIENT DATA for incomplete recipe', ai3.insufficient.some((x) => /INSUFFICIENT DATA/.test(x)) && !ai3.facts.some((f) => f.topic === 'cost'), ai3);
  const ai4 = await rfc.aiAsk('What happens if I reduce the portion from 500g to 400g?', { product_id: fishPap }, owner);
  check('AI portion 500g → 400g: cost 27.50 → 22.70', ai4.facts.some((f) => /27\.5 → 22\.7\b/.test(f.text)), ai4.facts.map((f) => f.text));
  const ai5 = await rfc.aiAsk('Which recipes are affected if chicken price increases?', {}, owner);
  check('AI chicken affects Chicken Plate only', ai5.facts.some((f) => /Test Chicken Plate/.test(f.text)) && !ai5.facts.some((f) => /Fish & Pap/.test(f.text)), ai5.facts.map((f) => f.text));
  const ai6 = await rfc.aiAsk('Which meal has the highest food cost?', {}, owner);
  check('AI highest food cost answers from cost cards', ai6.facts.length > 0 && /1\. /.test(ai6.facts[0].text), ai6.facts.map((f) => f.text));
  const ai7 = await rfc.aiAsk('Why did this meal cost increase?', { product_id: fishPap }, owner);
  check('AI explains increase via fish purchase cost', ai7.facts.some((f) => /Test Fish: purchase cost 40 → 48/.test(f.text)), ai7.facts.map((f) => f.text));
  const ai8 = await rfc.aiAsk('What should I review?', {}, owner);
  check('AI review lists alerts with FACT/ANALYSIS/RECOMMENDATION fields', ai8.facts.length > 0 && Array.isArray(ai8.analysis) && Array.isArray(ai8.recommendations), ai8);
  check('AI is rule-based without an API key and logs the question', ai1.engine === 'rule_based' && rfc.aiHistory(20, owner).length === 8);
  check('AI made no changes', Number(db.prepare('SELECT selling_price FROM products WHERE id = ?').get(fishPap).selling_price) === 60
    && Number(db.prepare('SELECT buying_price FROM products WHERE id = ?').get(fish).buying_price) === 48);

  // ── Reports ──
  const rep = rfc.report('food_cost', {}, owner);
  check('food cost report has a row per recipe', rep.rows.length === 5 && rep.headers.includes('Food cost %'), rep.rows.length);
  check('report marks incomplete recipes INSUFFICIENT DATA', rep.rows.some((r) => r[0] === 'Test Broken Meal' && r[2] === 'INSUFFICIENT DATA'));
  check('sales report totals', rfc.report('sales', MAR, owner).rows.slice(-1)[0][0] === 'TOTAL');
  check('unknown report rejected', /Unknown report/.test(throws(() => rfc.report('nope', {}, owner)) || ''));

  // ── Financial Intelligence connection ──
  const fp2 = fin.products(MAR, owner).products.find((r) => r.product_id === fishPap);
  check('FIC products show recipe cost R356.50 and contribution R563.50', near(fp2?.recipe_cost, 356.5) && near(fp2?.recipe_contribution, 563.5), fp2);

  // ── Existing recipe costing still works ──
  const legacy = rp.computeRecipeCosting(require('../electron/services/inventory').getProductRecipe(chickenPlate), { override_price: 50 });
  check('existing computeRecipeCosting unchanged (R24.50)', near(legacy.recipe_cost, 24.5), legacy.recipe_cost);

  if (failures.length) {
    console.log(`\n${failures.length} FAILED:`, failures);
    process.exit(1);
  }
  console.log('\nALL RECIPE FOOD COST CHECKS PASSED');
  process.exit(0);
})().catch((err) => {
  console.error('TEST CRASH', err);
  process.exit(1);
});

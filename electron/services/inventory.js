const { getDb } = require('../database/db');

const GLOBAL_CONVERSIONS = [
  { from_qty: 1, from_unit: 'kg', to_qty: 1000, to_unit: 'g' },
  { from_qty: 1, from_unit: 'L', to_qty: 1000, to_unit: 'ml' },
  { from_qty: 1, from_unit: 'litre', to_qty: 1000, to_unit: 'ml' },
  { from_qty: 1, from_unit: 'm', to_qty: 100, to_unit: 'cm' },
  { from_qty: 1, from_unit: 'cm', to_qty: 10, to_unit: 'mm' }
];

let _conversionsCache = new Map();
let _conversionsCacheAt = 0;
function getProductConversions(productId) {
  const id = Number(productId) || 0;
  if (Date.now() - _conversionsCacheAt > 60 * 1000) {
    _conversionsCache.clear();
    _conversionsCacheAt = Date.now();
  }
  if (_conversionsCache.has(id)) return _conversionsCache.get(id);
  const rows = getDb().prepare('SELECT * FROM product_conversions WHERE product_id = ? ORDER BY id').all(id);
  _conversionsCache.set(id, rows);
  return rows;
}

function saveProductConversions(productId, conversions = []) {
  const db = getDb();
  db.prepare('DELETE FROM product_conversions WHERE product_id = ?').run(productId);
  for (const c of conversions) {
    if (!c.from_unit?.trim() || !c.to_unit?.trim() || !c.to_qty) continue;
    db.prepare(`
      INSERT INTO product_conversions (product_id, from_qty, from_unit, to_qty, to_unit, label)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(productId, c.from_qty || 1, c.from_unit.trim(), c.to_qty, c.to_unit.trim(), c.label?.trim() || null);
  }
}

let _recipeItemSchemaReady = false;
function ensureRecipeItemSchema() {
  if (_recipeItemSchemaReady) return;
  const db = getDb();
  try {
    const pg = require('../database/pg-db');
    if (pg.isPgMode?.()) {
      const col = db.prepare(`
        SELECT 1 AS ok FROM information_schema.columns
        WHERE table_schema='public' AND table_name='product_recipe_items' AND column_name='include_rule'
        LIMIT 1
      `).get();
      if (col) {
        _recipeItemSchemaReady = true;
        return;
      }
    }
  } catch (_) { /* fall through */ }
  for (const sql of [
    "ALTER TABLE product_recipe_items ADD COLUMN include_rule TEXT DEFAULT 'always'",
    'ALTER TABLE product_recipe_items ADD COLUMN option_name TEXT',
    'ALTER TABLE product_recipe_items ADD COLUMN is_primary INTEGER DEFAULT 0'
  ]) {
    try { db.exec(sql); } catch (_) { /* exists */ }
  }
  _recipeItemSchemaReady = true;
}

function normalizeIncludeRule(rule) {
  const r = String(rule || 'always').toLowerCase().trim();
  if (r === 'when_selected' || r === 'unless_selected' || r === 'always') return r;
  return 'always';
}

/** Build set of selected option/modifier names (lowercase). */
function selectedModifierNames(selectedModifiers) {
  const names = new Set();
  for (const m of selectedModifiers || []) {
    if (m == null) continue;
    if (typeof m === 'string') {
      String(m).split(',').forEach(part => {
        const n = part.trim().toLowerCase();
        if (n) names.add(n);
      });
      continue;
    }
    const n = String(m.name || m.modifier_name || '').trim().toLowerCase();
    if (n) names.add(n);
  }
  return names;
}

/**
 * Should this BOM line be used for this sale?
 * - always: always deduct / count for capacity
 * - when_selected: only if customer chose option_name (e.g. "With Pap")
 * - unless_selected: skip if customer chose option_name (e.g. "Without Pap")
 */
function recipeItemApplies(item, selectedNames) {
  const rule = normalizeIncludeRule(item.include_rule);
  const opt = String(item.option_name || '').trim().toLowerCase();
  if (rule === 'always' || !opt) return true;
  const has = selectedNames instanceof Set
    ? selectedNames.has(opt)
    : selectedModifierNames(selectedNames).has(opt);
  if (rule === 'when_selected') return has;
  if (rule === 'unless_selected') return !has;
  return true;
}

function getProductRecipe(productId) {
  ensureRecipeItemSchema();
  return getDb().prepare(`
    SELECT r.*, p.name AS ingredient_name, p.buying_price, p.unit AS ingredient_stock_unit,
           COALESCE(p.stock_unit, p.unit, 'each') AS ingredient_unit,
           COALESCE(p.stock_quantity, 0) AS ingredient_stock_quantity,
           p.stock_quantity AS stock_quantity,
           p.stock_unit, p.unit AS product_unit,
           COALESCE(NULLIF(r.include_rule, ''), 'always') AS include_rule,
           r.option_name,
           COALESCE(r.is_primary, 0) AS is_primary
    FROM product_recipe_items r
    JOIN products p ON p.id = r.ingredient_product_id
    WHERE r.product_id = ?
    ORDER BY CASE WHEN COALESCE(r.is_primary, 0) = 1 THEN 0 ELSE 1 END, r.sort_order, r.id
  `).all(productId);
}

function saveProductRecipe(productId, items = []) {
  ensureRecipeItemSchema();
  const db = getDb();
  db.prepare('DELETE FROM product_recipe_items WHERE product_id = ?').run(productId);
  let sort = 0;
  let primarySet = false;
  for (const item of items) {
    const ingId = Number(item.ingredient_product_id);
    const qty = Number(item.quantity);
    // Allow fractional usage (0.25 / 0.5 chicken) — only skip missing id or non-positive qty
    if (!ingId || !(qty > 0)) continue;
    const rule = normalizeIncludeRule(item.include_rule);
    const optionName = rule === 'always' ? null : ((item.option_name || '').toString().trim() || null);
    const wantPrimary = !!(item.is_primary || item.is_main) && rule === 'always' && !primarySet;
    if (wantPrimary) primarySet = true;
    db.prepare(`
      INSERT INTO product_recipe_items (
        product_id, ingredient_product_id, quantity, unit, waste_pct, sort_order, include_rule, option_name, is_primary
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      productId,
      ingId,
      qty,
      (item.unit || 'each').toString().trim() || 'each',
      Number(item.waste_pct) || 0,
      sort++,
      rule,
      optionName,
      wantPrimary ? 1 : 0
    );
  }
  const hasRecipe = sort > 0;
  db.prepare('UPDATE products SET has_recipe = ? WHERE id = ?').run(hasRecipe ? 1 : 0, productId);
}

function hasRecipe(productId) {
  const row = getDb().prepare('SELECT COUNT(*) AS c FROM product_recipe_items WHERE product_id = ?').get(productId);
  return (row?.c || 0) > 0;
}

function convertQuantity(productId, qty, fromUnit, toUnit) {
  if (!fromUnit || !toUnit || fromUnit === toUnit) return qty;
  const productConversions = productId ? getProductConversions(productId) : [];
  const all = [...productConversions, ...GLOBAL_CONVERSIONS];
  const visited = new Set();
  const queue = [{ unit: fromUnit, qty }];
  while (queue.length) {
    const { unit, qty: currentQty } = queue.shift();
    if (unit === toUnit) return currentQty;
    if (visited.has(unit)) continue;
    visited.add(unit);
    for (const c of all) {
      if (c.from_unit === unit && c.to_qty) {
        queue.push({ unit: c.to_unit, qty: currentQty * (c.to_qty / (c.from_qty || 1)) });
      }
      if (c.to_unit === unit && c.from_qty) {
        queue.push({ unit: c.from_unit, qty: currentQty * (c.from_qty / c.to_qty) });
      }
    }
  }
  return qty;
}

function getIngredientCost(ingredientProduct, recipeQty, recipeUnit, wastePct) {
  const waste = 1 + (wastePct || 0) / 100;
  const qtyNeeded = recipeQty * waste;
  const stockUnit = ingredientProduct.stock_unit || ingredientProduct.unit || 'each';
  const qtyInStockUnit = convertQuantity(ingredientProduct.id, qtyNeeded, recipeUnit, stockUnit);
  return qtyInStockUnit * (ingredientProduct.buying_price || 0);
}

function calculateRecipeMetrics(productId, sellingPrice, inlineRecipe) {
  const items = inlineRecipe || getProductRecipe(productId);
  let recipeCost = 0;
  for (const item of items) {
    const ing = getDb().prepare('SELECT * FROM products WHERE id = ?').get(item.ingredient_product_id);
    if (!ing) continue;
    recipeCost += getIngredientCost(ing, item.quantity, item.unit, item.waste_pct);
  }
  const sp = Number(sellingPrice) || 0;
  const foodCostPct = sp > 0 ? (recipeCost / sp) * 100 : 0;
  const grossProfit = sp - recipeCost;
  const profitMargin = sp > 0 ? (grossProfit / sp) * 100 : 0;
  return {
    recipe_cost: Math.round(recipeCost * 100) / 100,
    food_cost_pct: Math.round(foodCostPct * 10) / 10,
    gross_profit: Math.round(grossProfit * 100) / 100,
    profit_margin: Math.round(profitMargin * 10) / 10,
    has_recipe: items.length > 0
  };
}

function updateProductRecipeMetrics(productId, sellingPrice) {
  const metrics = calculateRecipeMetrics(productId, sellingPrice);
  getDb().prepare(`
    UPDATE products SET recipe_cost = ?, food_cost_pct = ?, gross_profit = ?, profit_margin = ?, has_recipe = ?
    WHERE id = ?
  `).run(metrics.recipe_cost, metrics.food_cost_pct, metrics.gross_profit, metrics.profit_margin,
    metrics.has_recipe ? 1 : 0, productId);
  return metrics;
}

function deductRecipeIngredients(productId, saleQty, notes, userId, refType, refId, adjustStockFn, selectedModifiers = [], substitutions = null) {
  const items = getProductRecipe(productId);
  if (!items.length) return false;
  const selected = selectedModifierNames(selectedModifiers);
  const subMap = substitutions && typeof substitutions === 'object' ? substitutions : {};
  let deducted = false;
  for (const item of items) {
    if (!recipeItemApplies(item, selected)) continue;
    const fromId = Number(item.ingredient_product_id);
    const useId = Number(subMap[fromId] || subMap[String(fromId)] || fromId);
    const ing = getDb().prepare('SELECT * FROM products WHERE id = ?').get(useId);
    if (!ing) {
      throw new Error(
        useId !== fromId
          ? `Ingredient substitute #${useId} not found for recipe product #${productId}`
          : `Recipe ingredient #${fromId} not found for product #${productId}`
      );
    }
    const waste = 1 + (item.waste_pct || 0) / 100;
    let deductQty = item.quantity * saleQty * waste;
    const stockUnit = ing.stock_unit || ing.unit || 'each';
    if (item.unit !== stockUnit) {
      deductQty = convertQuantity(ing.id, deductQty, item.unit, stockUnit);
    }
    adjustStockFn(useId, deductQty, 'sale', notes, userId, refType, refId);
    deducted = true;
  }
  return deducted;
}

function restoreRecipeIngredients(productId, returnQty, notes, userId, refType, refId, adjustStockFn, selectedModifiers = [], substitutions = null) {
  const items = getProductRecipe(productId);
  if (!items.length) return false;
  const selected = selectedModifierNames(selectedModifiers);
  const subMap = substitutions && typeof substitutions === 'object' ? substitutions : {};
  for (const item of items) {
    if (!recipeItemApplies(item, selected)) continue;
    const fromId = Number(item.ingredient_product_id);
    const useId = Number(subMap[fromId] || subMap[String(fromId)] || fromId);
    const ing = getDb().prepare('SELECT * FROM products WHERE id = ?').get(useId);
    if (!ing) continue;
    const waste = 1 + (item.waste_pct || 0) / 100;
    let restoreQty = item.quantity * returnQty * waste;
    const stockUnit = ing.stock_unit || ing.unit || 'each';
    if (item.unit !== stockUnit) {
      restoreQty = convertQuantity(ing.id, restoreQty, item.unit, stockUnit);
    }
    adjustStockFn(useId, restoreQty, 'return', notes, userId, refType, refId);
  }
  return true;
}

module.exports = {
  getProductConversions,
  saveProductConversions,
  getProductRecipe,
  saveProductRecipe,
  hasRecipe,
  convertQuantity,
  getIngredientCost,
  calculateRecipeMetrics,
  updateProductRecipeMetrics,
  deductRecipeIngredients,
  restoreRecipeIngredients,
  recipeItemApplies,
  selectedModifierNames,
  normalizeIncludeRule,
  ensureRecipeItemSchema,
  GLOBAL_CONVERSIONS
};

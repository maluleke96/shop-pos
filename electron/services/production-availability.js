/**
 * Production Availability Engine
 * Calculates how many complete meals can be made from ingredient stock
 * (not finished-good stock). Supports fractional BOM usage (e.g. 0.25 chicken).
 */
const { getDb } = require('../database/db');
const inventory = require('./inventory');

let _refreshPaused = 0;
let _schemaReady = false;

function ensureSchema() {
  if (_schemaReady) return;
  const db = getDb();
  // Postgres: columns already exist after import — skip ALTER storm (7 failed round-trips).
  try {
    const pg = require('../database/pg-db');
    if (pg.isPgMode?.()) {
      const cols = db.prepare(`
        SELECT column_name AS name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'products'
      `).all();
      const have = new Set((cols || []).map((c) => String(c.name || c.NAME || '').toLowerCase()));
      if (
        have.has('production_capacity') &&
        have.has('limiting_ingredient_name') &&
        have.has('production_capacity_updated_at')
      ) {
        _schemaReady = true;
        return;
      }
    }
  } catch (_) { /* fall through */ }
  for (const sql of [
    'ALTER TABLE products ADD COLUMN production_capacity REAL DEFAULT 0',
    'ALTER TABLE products ADD COLUMN limiting_ingredient_id INTEGER',
    'ALTER TABLE products ADD COLUMN limiting_ingredient_name TEXT',
    'ALTER TABLE products ADD COLUMN production_oos INTEGER DEFAULT 0',
    'ALTER TABLE products ADD COLUMN production_oos_reason TEXT',
    'ALTER TABLE products ADD COLUMN production_breakdown_json TEXT',
    'ALTER TABLE products ADD COLUMN production_capacity_updated_at TEXT'
  ]) {
    try { db.exec(sql); } catch (_) { /* exists */ }
  }
  _schemaReady = true;
}

function pauseRefresh() {
  _refreshPaused += 1;
}

function resumeRefresh(opts = {}) {
  _refreshPaused = Math.max(0, _refreshPaused - 1);
  if (_refreshPaused === 0 && opts.refresh !== false) {
    const seenProducts = new Set();
    if (opts.ingredientIds?.length) {
      for (const id of opts.ingredientIds) {
        const results = refreshAffectedByIngredient(id) || [];
        for (const r of results) {
          if (r?.product_id != null) seenProducts.add(Number(r.product_id));
        }
      }
    }
    if (opts.productIds?.length) {
      for (const id of opts.productIds) {
        const pid = Number(id);
        if (seenProducts.has(pid)) continue;
        const row = getDb().prepare(
          'SELECT has_recipe, production_mode FROM products WHERE id = ?'
        ).get(pid);
        // Finished-goods / non-recipe SKUs need no meal capacity recalc
        // Note: PG may return has_recipe as string "0"/"1" — never use bare truthiness
        if (!Number(row?.has_recipe) && row?.production_mode !== 'make_to_stock') {
          seenProducts.add(pid);
          continue;
        }
        refreshProductCapacity(pid);
        seenProducts.add(pid);
      }
    }
    if (!opts.ingredientIds?.length && !opts.productIds?.length) {
      refreshAllMealCapacities();
    }
  }
}

/** Core calc for one meal product from its recipe BOM.
 *  @param {object} [opts]
 *  @param {Array} [opts.selectedModifiers] — when set, capacity uses only BOM lines that apply to those choices
 */
function calculateProductCapacity(productId, opts = {}) {
  ensureSchema();
  const db = getDb();
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
  if (!product) {
    return emptyResult(productId, 'Product not found');
  }

  // make_to_stock sells finished goods already produced
  if (product.production_mode === 'make_to_stock') {
    const qty = Math.max(0, Math.floor(Number(product.stock_quantity) || 0));
    return {
      product_id: productId,
      product_name: product.name,
      max_meals: qty,
      available_meals: qty,
      limiting_ingredient_id: null,
      limiting_ingredient: null,
      limiting_ingredient_name: null,
      out_of_stock: qty <= 0,
      out_of_stock_reason: qty <= 0 ? `${product.name} finished stock is empty` : null,
      breakdown: [],
      remaining_by_ingredient: [],
      restock_recommendation: null,
      mode: 'make_to_stock'
    };
  }

  const allItems = inventory.getProductRecipe(productId);
  if (!allItems.length) {
    // No recipe — fall back to finished stock
    const qty = Math.max(0, Math.floor(Number(product.stock_quantity) || 0));
    return {
      product_id: productId,
      product_name: product.name,
      max_meals: qty,
      available_meals: qty,
      limiting_ingredient_id: null,
      limiting_ingredient: null,
      limiting_ingredient_name: null,
      out_of_stock: qty <= 0,
      out_of_stock_reason: qty <= 0 ? `${product.name} is out of stock` : null,
      breakdown: [],
      remaining_by_ingredient: [],
      restock_recommendation: null,
      mode: 'retail'
    };
  }

  // Base POS capacity = always-required ingredients only.
  // Optional lines (With/Without Pap, etc.) are validated at sale time when chosen.
  const selectedNames = opts.selectedModifiers
    ? inventory.selectedModifierNames(opts.selectedModifiers)
    : null;
  const items = allItems.filter((item) => {
    if (selectedNames) return inventory.recipeItemApplies(item, selectedNames);
    const rule = inventory.normalizeIncludeRule(item.include_rule);
    return rule === 'always' || !String(item.option_name || '').trim();
  });

  let maxMeals = Infinity;
  let limitingId = null;
  let limitingName = null;
  const breakdown = [];
  // Optional main ingredient: POS available meals follow this item only;
  // other lines report how many times they can support that main.
  const primaryItem = items.find(i => Number(i.is_primary) === 1) || null;
  const usePrimaryOnly = !!primaryItem;

  for (const item of items) {
    const rule = inventory.normalizeIncludeRule(item.include_rule);
    const optional = rule !== 'always' && !!String(item.option_name || '').trim();
    const isPrimary = Number(item.is_primary) === 1;
    // Recipe JOIN already carries ingredient stock — avoid per-ingredient SELECT round-trips.
    const hasIng = item.ingredient_product_id != null && item.ingredient_name != null;
    const ing = hasIng
      ? {
          id: item.ingredient_product_id,
          name: item.ingredient_name,
          stock_quantity: Number(item.ingredient_stock_quantity ?? item.stock_quantity) || 0,
          stock_unit: item.stock_unit || item.ingredient_unit || item.ingredient_stock_unit || 'each',
          unit: item.product_unit || item.ingredient_stock_unit || 'each'
        }
      : null;
    if (!ing) {
      breakdown.push({
        ingredient_product_id: item.ingredient_product_id,
        name: item.ingredient_name || 'Missing ingredient',
        stock: 0,
        per_meal: Number(item.quantity) || 0,
        unit: item.unit || 'each',
        recipe_unit: item.unit || 'each',
        can_make: 0,
        missing: true,
        optional,
        is_primary: isPrimary,
        include_rule: rule,
        option_name: item.option_name || null
      });
      if (!usePrimaryOnly || isPrimary) {
        maxMeals = 0;
        limitingId = item.ingredient_product_id;
        limitingName = item.ingredient_name || 'Missing ingredient';
      }
      continue;
    }

    const waste = 1 + (Number(item.waste_pct) || 0) / 100;
    const perMealRecipe = (Number(item.quantity) || 0) * waste;
    const stockUnit = ing.stock_unit || ing.unit || 'each';
    const recipeUnit = item.unit || stockUnit;
    const perMealStock = inventory.convertQuantity(ing.id, perMealRecipe, recipeUnit, stockUnit);
    const stock = Number(ing.stock_quantity) || 0;
    let canMake = 0;
    if (perMealStock > 0) {
      canMake = Math.floor(stock / perMealStock);
    } else if (perMealStock === 0) {
      canMake = Infinity; // free / zero-qty line
    }

    breakdown.push({
      ingredient_product_id: ing.id,
      name: ing.name,
      stock,
      per_meal: Math.round(perMealStock * 10000) / 10000,
      unit: stockUnit,
      recipe_unit: recipeUnit,
      recipe_qty: Number(item.quantity) || 0,
      can_make: canMake === Infinity ? null : canMake,
      missing: stock <= 0 && perMealStock > 0,
      optional,
      is_primary: isPrimary,
      include_rule: rule,
      option_name: item.option_name || null
    });

    if (usePrimaryOnly) {
      if (isPrimary && canMake < maxMeals) {
        maxMeals = canMake;
        limitingId = ing.id;
        limitingName = ing.name;
      }
    } else if (canMake < maxMeals) {
      maxMeals = canMake;
      limitingId = ing.id;
      limitingName = ing.name;
    }
  }

  // Also surface optional BOM lines on the dashboard (informational; not limiting base capacity)
  if (!selectedNames) {
    for (const item of allItems) {
      const rule = inventory.normalizeIncludeRule(item.include_rule);
      if (rule === 'always' || !String(item.option_name || '').trim()) continue;
      if (breakdown.some(b => b.ingredient_product_id === item.ingredient_product_id && b.option_name === item.option_name)) continue;
      const ing = db.prepare('SELECT * FROM products WHERE id = ?').get(item.ingredient_product_id);
      if (!ing) continue;
      const waste = 1 + (Number(item.waste_pct) || 0) / 100;
      const perMealRecipe = (Number(item.quantity) || 0) * waste;
      const stockUnit = ing.stock_unit || ing.unit || 'each';
      const recipeUnit = item.unit || stockUnit;
      const perMealStock = inventory.convertQuantity(ing.id, perMealRecipe, recipeUnit, stockUnit);
      const stock = Number(ing.stock_quantity) || 0;
      const canMake = perMealStock > 0 ? Math.floor(stock / perMealStock) : (perMealStock === 0 ? null : 0);
      breakdown.push({
        ingredient_product_id: ing.id,
        name: ing.name,
        stock,
        per_meal: Math.round(perMealStock * 10000) / 10000,
        unit: stockUnit,
        recipe_unit: recipeUnit,
        recipe_qty: Number(item.quantity) || 0,
        can_make: canMake,
        missing: stock <= 0 && perMealStock > 0,
        optional: true,
        include_rule: rule,
        option_name: item.option_name || null
      });
    }
  }

  // No always-required lines (all optional) → base meal is not ingredient-limited
  if (maxMeals === Infinity) maxMeals = items.length === 0 ? 9999 : 0;
  maxMeals = Math.max(0, maxMeals);

  const outOfStock = maxMeals <= 0;
  const oosReason = outOfStock
    ? (limitingName ? `${limitingName} is unavailable` : 'Required ingredients are unavailable')
    : null;

  // Remaining capacity each ingredient could support (even if another is out).
  // When a main ingredient is set, non-main lines show how many times they cover the main.
  const primaryMeals = usePrimaryOnly && maxMeals !== Infinity ? maxMeals : null;
  const remainingByIngredient = breakdown
    .filter(b => b.can_make != null)
    .map(b => {
      const coversMain = primaryMeals != null && primaryMeals > 0
        ? Math.round((b.can_make / primaryMeals) * 100) / 100
        : null;
      return {
        ingredient_product_id: b.ingredient_product_id,
        name: b.name,
        meals_remaining: b.can_make,
        stock: b.stock,
        unit: b.unit,
        is_primary: !!b.is_primary,
        is_limiting: b.ingredient_product_id === limitingId,
        is_missing: !!b.missing || b.can_make === 0,
        covers_main_times: b.is_primary ? 1 : coversMain
      };
    })
    .sort((a, b) => {
      if (a.is_primary && !b.is_primary) return -1;
      if (!a.is_primary && b.is_primary) return 1;
      return a.meals_remaining - b.meals_remaining;
    });

  const restock = buildRestockRecommendation(product, breakdown, maxMeals, 10);

  return {
    product_id: productId,
    product_name: product.name,
    max_meals: maxMeals,
    available_meals: maxMeals,
    limiting_ingredient_id: limitingId,
    limiting_ingredient: limitingName,
    limiting_ingredient_name: limitingName,
    out_of_stock: outOfStock,
    out_of_stock_reason: oosReason,
    breakdown,
    remaining_by_ingredient: remainingByIngredient,
    restock_recommendation: restock,
    mode: 'make_to_order'
  };
}

function emptyResult(productId, reason) {
  return {
    product_id: productId,
    product_name: null,
    max_meals: 0,
    available_meals: 0,
    limiting_ingredient_id: null,
    limiting_ingredient: null,
    limiting_ingredient_name: null,
    out_of_stock: true,
    out_of_stock_reason: reason,
    breakdown: [],
    remaining_by_ingredient: [],
    restock_recommendation: null,
    mode: null
  };
}

function buildRestockRecommendation(product, breakdown, currentMeals, targetExtra = 10) {
  const target = Math.max(currentMeals + targetExtra, targetExtra);
  const purchase = [];
  for (const b of breakdown) {
    if (b.can_make == null) continue;
    if (b.can_make >= target) continue; // enough remains — do not recommend
    const needMeals = target - b.can_make;
    const qtyNeeded = Math.ceil(needMeals * (b.per_meal || 0) * 1000) / 1000;
    if (qtyNeeded <= 0) continue;
    purchase.push({
      ingredient_product_id: b.ingredient_product_id,
      name: b.name,
      quantity: qtyNeeded,
      unit: b.unit,
      current_stock: b.stock,
      current_meals: b.can_make,
      target_meals: target,
      reason: b.can_make <= 0
        ? `${b.name} is out — limits ${product.name}`
        : `${b.name} only supports ${b.can_make} meals (target ${target})`
    });
  }
  // Prefer the limiting / zero-stock items first
  purchase.sort((a, b) => a.current_meals - b.current_meals);
  return {
    product_id: product.id,
    product_name: product.name,
    current_meals: currentMeals,
    target_meals: target,
    purchase,
    skip: breakdown
      .filter(b => b.can_make != null && b.can_make >= target)
      .map(b => ({ name: b.name, meals_remaining: b.can_make, unit: b.unit }))
  };
}

function persistCapacity(cap) {
  ensureSchema();
  const db = getDb();
  db.prepare(`
    UPDATE products SET
      production_capacity = ?,
      limiting_ingredient_id = ?,
      limiting_ingredient_name = ?,
      production_oos = ?,
      production_oos_reason = ?,
      production_breakdown_json = ?,
      production_capacity_updated_at = datetime('now'),
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    cap.max_meals,
    cap.limiting_ingredient_id,
    cap.limiting_ingredient_name,
    cap.out_of_stock ? 1 : 0,
    cap.out_of_stock_reason,
    JSON.stringify({
      breakdown: cap.breakdown,
      remaining_by_ingredient: cap.remaining_by_ingredient,
      restock_recommendation: cap.restock_recommendation,
      mode: cap.mode
    }),
    cap.product_id
  );
  return cap;
}

function refreshProductCapacity(productId) {
  if (_refreshPaused > 0) return null;
  const id = Number(productId);
  if (!id) return null;
  const cap = calculateProductCapacity(id);
  return persistCapacity(cap);
}

function refreshAffectedByIngredient(ingredientProductId) {
  if (_refreshPaused > 0) return [];
  ensureSchema();
  const id = Number(ingredientProductId);
  if (!id) return [];
  const db = getDb();
  const rows = db.prepare(`
    SELECT DISTINCT product_id FROM product_recipe_items WHERE ingredient_product_id = ?
  `).all(id);
  // Also refresh if this product itself is a meal with a recipe
  const self = db.prepare('SELECT id, has_recipe FROM products WHERE id = ?').get(id);
  const ids = new Set(rows.map(r => r.product_id));
  if (self && Number(self.has_recipe)) ids.add(self.id);
  const results = [];
  for (const pid of ids) {
    results.push(refreshProductCapacity(pid));
  }
  return results;
}

function refreshAllMealCapacities() {
  if (_refreshPaused > 0) return [];
  ensureSchema();
  const db = getDb();
  const meals = db.prepare(`
    SELECT id FROM products
    WHERE is_active = 1
      AND (has_recipe = 1 OR id IN (SELECT DISTINCT product_id FROM product_recipe_items))
      AND (item_type IS NULL OR item_type != 'ingredient')
  `).all();
  return meals.map(m => refreshProductCapacity(m.id));
}

/** Enrich POS product rows with production capacity fields. */
function applyCapacityToProducts(products) {
  ensureSchema();
  const list = products || [];
  // Refresh uncached recipe meals once up front (persists to products.*) so list map stays O(1).
  const need = list.filter(
    (p) =>
      p?.has_recipe &&
      p.production_mode !== 'make_to_stock' &&
      (p.production_capacity_updated_at == null || p.production_capacity_updated_at === '')
  );
  for (const p of need) {
    try {
      refreshProductCapacity(p.id);
      // Pull refreshed fields onto the in-memory row so map below does not re-hit DB.
      const row = getDb()
        .prepare(
          `SELECT production_capacity, limiting_ingredient_name, production_oos_reason, production_capacity_updated_at
           FROM products WHERE id = ?`
        )
        .get(p.id);
      if (row) {
        p.production_capacity = row.production_capacity;
        p.limiting_ingredient_name = row.limiting_ingredient_name;
        p.production_oos_reason = row.production_oos_reason;
        p.production_capacity_updated_at = row.production_capacity_updated_at;
      }
    } catch (_) { /* keep row as-is */ }
  }

  return list.map((p) => {
    if (!p?.has_recipe) return p;
    if (p.production_mode === 'make_to_stock') {
      return {
        ...p,
        available_meals: Math.max(0, Math.floor(Number(p.stock_quantity) || 0)),
        is_production_based: false,
        production_display_unit: 'meals'
      };
    }
    const capacity = Number(p.production_capacity);
    const limiting = p.limiting_ingredient_name;
    const reason = p.production_oos_reason;
    const meals = Math.max(0, Math.floor(capacity || 0));
    return {
      ...p,
      finished_stock_quantity: p.stock_quantity,
      available_meals: meals,
      production_capacity: meals,
      limiting_ingredient: limiting,
      limiting_ingredient_name: limiting,
      out_of_stock_reason: reason,
      is_production_based: true,
      production_display_unit: 'meals'
    };
  });
}

function modifiersFromSaleItem(item) {
  if (item?.modifiers?.length) return item.modifiers;
  const text = item?.modifiers_text || '';
  if (!text) return [];
  return String(text).split(',').map(s => ({ name: s.trim() })).filter(m => m.name);
}

/**
 * Validate cart lines can be produced. Throws Error with Sale Blocked message.
 * Optional BOM lines (e.g. Pap) are checked only when the cart choice includes them.
 */
function validateSaleCapacity(items, opts = {}) {
  ensureSchema();
  const allowOversell = !!opts.allowOversell;
  if (allowOversell) return { ok: true, lines: [] };

  const db = getDb();
  const lines = [];
  // Aggregate by product + modifier set (same meal with/without pap are different)
  const needByKey = new Map();
  for (const item of items || []) {
    const qty = Number(item.quantity) || 0;
    if (!(qty > 0)) continue;

    // Expand combos into component product lines for capacity / stock checks
    if (item.combo_id) {
      let comboItems = item.combo_items;
      if (!comboItems || !comboItems.length) {
        try {
          const combo = require('./combos').getCombo(item.combo_id);
          comboItems = combo?.items || [];
        } catch (_) {
          comboItems = [];
        }
      }
      for (const ci of comboItems) {
        const pid = Number(ci.product_id);
        if (!pid) continue;
        const need = qty * (Number(ci.quantity) || 1);
        const key = `${pid}::combo::${item.combo_id}`;
        const prev = needByKey.get(key);
        if (prev) prev.need += need;
        else {
          needByKey.set(key, {
            productId: pid,
            need,
            modifiers: [],
            hasSubstitution: false
          });
        }
      }
      continue;
    }

    if (!item?.product_id) continue;
    const pid = Number(item.product_id);
    const mods = modifiersFromSaleItem(item);
    const modKey = [...inventory.selectedModifierNames(mods)].sort().join('|');
    const subKey = item.substitutions ? JSON.stringify(item.substitutions) : '';
    const key = `${pid}::${modKey}::${subKey}`;
    const prev = needByKey.get(key);
    if (prev) prev.need += qty;
    else {
      needByKey.set(key, {
        productId: pid,
        need: qty,
        modifiers: mods,
        hasSubstitution: !!(item.substitutions && Object.keys(item.substitutions).length)
      });
    }
  }

  for (const group of needByKey.values()) {
    const { productId, need, modifiers } = group;
    const product = db.prepare(`
      SELECT id, name, stock_quantity, has_recipe, production_mode,
        production_capacity, production_capacity_updated_at,
        limiting_ingredient_name, production_oos_reason
      FROM products WHERE id = ?
    `).get(productId);
    if (!product) continue;
    if (!Number(product.has_recipe)) {
      if ((Number(product.stock_quantity) || 0) < need) {
        throw new Error(`Sale Blocked — ${product.name} has insufficient stock. Available: ${product.stock_quantity}`);
      }
      continue;
    }
    if (product.production_mode === 'make_to_stock') {
      if ((Number(product.stock_quantity) || 0) < need) {
        throw new Error(`Sale Blocked — ${product.name} finished stock is insufficient. Available: ${product.stock_quantity}`);
      }
      continue;
    }

    // POS approved ingredient swap — allow sale; deduction uses substitute
    if (group.hasSubstitution) {
      lines.push({ product_id: productId, need, substituted: true });
      continue;
    }

    // Prefer fresh persisted capacity when cart has no modifiers (avoids full BOM recalc)
    const hasMods = (modifiers || []).length > 0;
    let cap;
    if (!hasMods) {
      const updatedAt = product.production_capacity_updated_at
        ? new Date(product.production_capacity_updated_at).getTime()
        : 0;
      const ageOk = updatedAt > 0 && (Date.now() - updatedAt) < 5 * 60 * 1000;
      if (ageOk && product.production_capacity != null) {
        cap = {
          max_meals: Math.max(0, Math.floor(Number(product.production_capacity) || 0)),
          limiting_ingredient_name: product.limiting_ingredient_name || null
        };
      }
    }
    if (!cap) {
      cap = calculateProductCapacity(productId, { selectedModifiers: modifiers });
    }
    lines.push({ product_id: productId, need, ...cap });
    if (cap.max_meals < need) {
      const reason = cap.limiting_ingredient_name
        ? `${cap.limiting_ingredient_name} is Out of Stock`
        : 'Required ingredients are Out of Stock';
      throw new Error(
        `Sale Blocked — ${reason}. ${product.name}: can make ${cap.max_meals}, cart needs ${need}.`
      );
    }
  }
  return { ok: true, lines };
}

function getAvailabilitySnapshot(productId) {
  return calculateProductCapacity(productId);
}

function getLiveProductionDashboard(opts = {}) {
  ensureSchema();
  const db = getDb();
  // Prefer persisted capacity on products. Only refresh meals with missing/stale cache.
  // Full refreshAllMealCapacities() on every dashboard open caused ~18s / 50+ queries.
  const maxAgeMs = opts.maxAgeMs != null ? Number(opts.maxAgeMs) : 5 * 60 * 1000;
  const mealRows = Array.isArray(opts.mealRows)
    ? opts.mealRows
    : db.prepare(`
    SELECT id, name, production_mode, stock_quantity, has_recipe,
      production_capacity, limiting_ingredient_id, limiting_ingredient_name,
      production_oos, production_oos_reason, production_breakdown_json,
      production_capacity_updated_at
    FROM products
    WHERE is_active = 1
      AND (has_recipe = 1 OR id IN (SELECT DISTINCT product_id FROM product_recipe_items))
      AND (item_type IS NULL OR item_type != 'ingredient')
  `).all();

  const caps = [];
  for (const p of mealRows) {
    const updatedMs = p.production_capacity_updated_at
      ? Date.parse(String(p.production_capacity_updated_at).replace(' ', 'T') + 'Z') ||
        Date.parse(String(p.production_capacity_updated_at)) ||
        0
      : 0;
    const stale = !updatedMs || (Date.now() - updatedMs) > maxAgeMs;
    if (stale && !opts.skipRefresh) {
      const fresh = refreshProductCapacity(p.id);
      if (fresh) caps.push(fresh);
      continue;
    }
    let breakdown = [];
    let remaining = [];
    let restock = null;
    let mode = p.production_mode === 'make_to_stock' ? 'make_to_stock' : 'make_to_order';
    try {
      const parsed = JSON.parse(p.production_breakdown_json || '{}');
      breakdown = parsed.breakdown || [];
      remaining = parsed.remaining_by_ingredient || [];
      restock = parsed.restock_recommendation || null;
      if (parsed.mode) mode = parsed.mode;
    } catch (_) { /* ignore */ }
    const maxMeals = Math.max(0, Math.floor(Number(p.production_capacity) || 0));
    caps.push({
      product_id: p.id,
      product_name: p.name,
      max_meals: maxMeals,
      available_meals: maxMeals,
      limiting_ingredient_id: p.limiting_ingredient_id,
      limiting_ingredient: p.limiting_ingredient_name,
      limiting_ingredient_name: p.limiting_ingredient_name,
      out_of_stock: !!p.production_oos || maxMeals <= 0,
      out_of_stock_reason: p.production_oos_reason,
      breakdown,
      remaining_by_ingredient: remaining,
      restock_recommendation: restock,
      mode
    });
  }

  const meals = caps.filter(c => c.mode === 'make_to_order' || c.mode === 'make_to_stock' || c.mode === 'retail');

  const totalMealsAvailable = meals.reduce((s, c) => s + (c.max_meals || 0), 0);
  const outOfStock = meals.filter(c => c.out_of_stock);
  const almostOut = meals.filter(c => !c.out_of_stock && c.max_meals > 0 && c.max_meals <= 5);

  // One query for low + out ingredient lists (or reuse preloaded rows from recipe dashboard batch)
  const ingredientRows = Array.isArray(opts.ingredientRows)
    ? opts.ingredientRows
    : db.prepare(`
    SELECT id, name, stock_quantity, stock_unit, unit, min_stock,
      CASE WHEN stock_quantity <= 0 THEN 1 ELSE 0 END AS is_out
    FROM products
    WHERE is_active = 1
      AND (
        item_type = 'ingredient'
        OR id IN (SELECT ingredient_product_id FROM product_recipe_items)
      )
      AND stock_quantity <= COALESCE(NULLIF(min_stock, 0), 5)
    ORDER BY stock_quantity ASC, name
    LIMIT 80
  `).all();
  const outIngredients = ingredientRows.filter((r) => Number(r.is_out) === 1).slice(0, 40);
  const lowIngredients = ingredientRows.slice(0, 40);

  const restock = meals
    .filter(c => c.restock_recommendation?.purchase?.length)
    .map(c => c.restock_recommendation);

  const byIngredient = {};
  for (const c of meals) {
    for (const r of c.remaining_by_ingredient || []) {
      if (!byIngredient[r.ingredient_product_id]) {
        byIngredient[r.ingredient_product_id] = {
          ingredient_product_id: r.ingredient_product_id,
          name: r.name,
          stock: r.stock,
          unit: r.unit,
          supports: []
        };
      }
      byIngredient[r.ingredient_product_id].supports.push({
        product_id: c.product_id,
        product_name: c.product_name,
        meals: r.meals_remaining
      });
    }
  }

  return {
    total_meals_available: totalMealsAvailable,
    meal_count: meals.length,
    products: meals.map(c => ({
      product_id: c.product_id,
      name: c.product_name,
      available_meals: c.max_meals,
      limiting_ingredient: c.limiting_ingredient_name,
      out_of_stock: c.out_of_stock,
      out_of_stock_reason: c.out_of_stock_reason,
      remaining_by_ingredient: c.remaining_by_ingredient,
      restock: c.restock_recommendation
    })),
    limiting_summary: meals
      .filter(c => c.limiting_ingredient_name)
      .map(c => ({
        product: c.product_name,
        available: c.max_meals,
        limiting_ingredient: c.limiting_ingredient_name
      })),
    ingredients_running_low: lowIngredients,
    ingredients_out: outIngredients,
    almost_out_meals: almostOut.map(c => ({
      product_id: c.product_id,
      name: c.product_name,
      available_meals: c.max_meals,
      limiting_ingredient: c.limiting_ingredient_name
    })),
    out_of_stock_meals: outOfStock.map(c => ({
      product_id: c.product_id,
      name: c.product_name,
      reason: c.out_of_stock_reason
    })),
    restock_recommendations: restock,
    ingredients_supporting_meals: Object.values(byIngredient),
    remaining_capacity_by_ingredient: Object.values(byIngredient),
    products_disabled: outOfStock.map(c => ({
      name: c.product_name,
      reason: c.out_of_stock_reason,
      limiting_ingredient: c.limiting_ingredient_name,
      remaining_by_ingredient: c.remaining_by_ingredient
    })),
    meals_almost_out: almostOut.map(c => ({
      name: c.product_name,
      available_meals: c.max_meals,
      limiting_ingredient: c.limiting_ingredient_name
    })),
    ingredients_out_of_stock: outIngredients,
    updated_at: new Date().toISOString()
  };
}

function getSmartRestockForProduct(productId, targetQty = 10) {
  const cap = calculateProductCapacity(productId);
  const product = getDb().prepare('SELECT * FROM products WHERE id = ?').get(productId);
  if (!product) throw new Error('Product not found');
  return buildRestockRecommendation(product, cap.breakdown || [], cap.max_meals, Number(targetQty) || 10);
}

module.exports = {
  ensureSchema,
  pauseRefresh,
  resumeRefresh,
  calculateProductCapacity,
  refreshProductCapacity,
  refreshAffectedByIngredient,
  refreshAllMealCapacities,
  applyCapacityToProducts,
  validateSaleCapacity,
  getAvailabilitySnapshot,
  getLiveProductionDashboard,
  getSmartRestockForProduct,
  buildRestockRecommendation
};

/**
 * Recipe & Production Management System — backend service
 * Inventory (products) remains the master stock database.
 */
const { getDb } = require('../database/db');
const { assertUserActor } = require('./authz');
const inventory = require('./inventory');
const branchesSvc = require('./branches');

function resolveRecipeBranchScope(actor, opts = {}) {
  const raw = opts.branchId != null && opts.branchId !== '' ? opts.branchId : opts.branch_id;
  const scope = branchesSvc.resolveBranchScope(actor, {
    ...opts,
    branchId: raw != null && raw !== '' && raw !== 'all' ? raw : opts.branchId
  });
  if (scope.allBranches) {
    const bid = raw != null && raw !== '' && raw !== 'all' ? Number(raw) : null;
    return { branchId: Number.isFinite(bid) ? bid : null, allBranches: !Number.isFinite(bid) };
  }
  return { branchId: scope.branchId || scope.tillId || 1, allBranches: false };
}

function appendRecipeBranchSql(sql, params, scope, { alias = '' } = {}) {
  if (scope.allBranches) return sql;
  const col = alias ? `${alias}.branch_id` : 'branch_id';
  sql += ` AND ${col} = ?`;
  params.push(scope.branchId);
  return sql;
}

function stampBranchId(actor, data = {}) {
  const scope = resolveRecipeBranchScope(actor, data);
  if (data.branch_id != null && data.branch_id !== '' && data.branch_id !== 'all') {
    return Number(data.branch_id);
  }
  if (!scope.allBranches) return scope.branchId;
  try {
    return branchesSvc.resolveBranchScope(actor, { forceTill: true }).stampId || 1;
  } catch (_) {
    return 1;
  }
}

const RECIPE_ROLES = ['administrator', 'production_manager', 'kitchen_manager', 'supervisor', 'viewer'];

const ROLE_PERMS = {
  administrator: {
    view: true, create: true, edit: true, delete: true, approve: true, produce: true,
    costing: true, prices: true, users: true, settings: true, reports: true, waste_approve: true, promotions: true
  },
  production_manager: {
    view: true, create: true, edit: true, delete: false, approve: false, produce: true,
    costing: true, prices: false, request_price: true, users: false, settings: false, reports: true, waste_approve: false, promotions: false
  },
  kitchen_manager: {
    view: true, create: false, edit: false, delete: false, approve: false, produce: true,
    costing: false, prices: false, users: false, settings: false, reports: 'limited', waste_approve: false, promotions: false
  },
  supervisor: {
    view: true, create: false, edit: false, delete: false, approve: false, produce: true,
    costing: false, prices: false, users: false, settings: false, reports: 'limited', waste_approve: false, promotions: false
  },
  viewer: {
    view: true, create: false, edit: false, delete: false, approve: false, produce: false,
    costing: false, prices: false, users: false, settings: false, reports: true, waste_approve: false, promotions: false
  }
};

function today() {
  return new Date().toLocaleDateString('en-CA');
}

function logActivity(actor, action, entityType, entityId, oldVal, newVal, meta = {}) {
  try {
    getDb().prepare(`
      INSERT INTO recipe_activity_log (user_id, user_name, action, entity_type, entity_id, old_value, new_value, branch_id, device_id, ip_address)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run(
      actor?.id || null,
      actor?.full_name || actor?.username || null,
      action,
      entityType || null,
      entityId || null,
      oldVal != null ? JSON.stringify(oldVal) : null,
      newVal != null ? JSON.stringify(newVal) : null,
      meta.branch_id ?? actor?.branch_id ?? null,
      meta.device_id || actor?.device_id || null,
      meta.ip_address || actor?.ip_address || null
    );
  } catch (_) { /* ignore */ }
}

function getRecipeAccess(userId) {
  if (!userId) return null;
  return getDb().prepare('SELECT * FROM recipe_user_access WHERE user_id = ?').get(userId) || null;
}

function canAccessRecipeModule(actor) {
  const user = assertUserActor(actor, null);
  if (user.role === 'owner') {
    return { ...user, recipe_role: 'administrator', recipe_enabled: true };
  }
  const access = getRecipeAccess(user.id);
  if (!access || !access.enabled) {
    throw new Error('You are not authorized for the Recipe & Production Management System. Ask the Admin to grant access in Users.');
  }
  return { ...user, recipe_role: access.recipe_role, recipe_enabled: true };
}

/** Enter Recipe module using an already-logged-in POS session (no re-password). */
function sessionFromPosUser(actor) {
  return canAccessRecipeModule(actor);
}

function requireRecipePerm(actor, perm) {
  const user = canAccessRecipeModule(actor);
  const matrix = ROLE_PERMS[user.recipe_role] || ROLE_PERMS.viewer;
  const allowed = matrix[perm];
  if (!allowed) throw new Error(`Recipe role "${user.recipe_role}" cannot perform: ${perm}`);
  return user;
}

function getRecipeAccessList() {
  return getDb().prepare(`
    SELECT a.*, u.username, u.full_name, u.role AS pos_role, u.is_active
    FROM recipe_user_access a
    JOIN users u ON u.id = a.user_id
    ORDER BY u.full_name
  `).all();
}

/** Active POS users for Recipe access grant UI (excludes owners — they use username/password only). */
function listUsersForRecipeAccess(actor) {
  assertCanManageRecipeAccess(actor);
  return getDb().prepare(`
    SELECT id, username, full_name, role, is_active
    FROM users WHERE is_active = 1 AND role != 'owner'
    ORDER BY full_name COLLATE NOCASE
  `).all();
}

/** POS owner/manager or Recipe Administrator may grant Recipe System access. */
function assertCanManageRecipeAccess(actor) {
  const user = assertUserActor(actor, null);
  if (user.role === 'owner') {
    return { ...user, recipe_role: 'administrator', recipe_enabled: true };
  }
  throw new Error('Only the owner (Admin) can grant Recipe & Production access.');
}

function setRecipeUserAccess(data, actor) {
  const granter = assertCanManageRecipeAccess(actor);
  if (!data.user_id) throw new Error('user_id required');
  const target = getDb().prepare('SELECT id, role FROM users WHERE id = ?').get(data.user_id);
  if (!target) throw new Error('User not found');
  if (target.role === 'owner') {
    throw new Error('Owner signs into Recipe with their username and password — do not grant Recipe access.');
  }
  const role = RECIPE_ROLES.includes(data.recipe_role) ? data.recipe_role : 'viewer';
  const enabled = data.enabled === false || data.enabled === 0 ? 0 : 1;
  const branchId = data.branch_id != null ? Number(data.branch_id) : null;
  const db = getDb();
  const existing = db.prepare('SELECT id FROM recipe_user_access WHERE user_id = ?').get(data.user_id);
  if (existing) {
    try {
      db.prepare(`
        UPDATE recipe_user_access SET recipe_role=?, enabled=?, granted_by=?, branch_id=?, updated_at=datetime('now') WHERE user_id=?
      `).run(role, enabled, granter?.id || null, branchId, data.user_id);
    } catch (_) {
      db.prepare(`
        UPDATE recipe_user_access SET recipe_role=?, enabled=?, granted_by=?, updated_at=datetime('now') WHERE user_id=?
      `).run(role, enabled, granter?.id || null, data.user_id);
    }
  } else {
    try {
      db.prepare(`
        INSERT INTO recipe_user_access (user_id, recipe_role, enabled, granted_by, branch_id) VALUES (?,?,?,?,?)
      `).run(data.user_id, role, enabled, granter?.id || null, branchId);
    } catch (_) {
      db.prepare(`
        INSERT INTO recipe_user_access (user_id, recipe_role, enabled, granted_by) VALUES (?,?,?,?)
      `).run(data.user_id, role, enabled, granter?.id || null);
    }
  }
  logActivity(granter, 'set_recipe_access', 'user', data.user_id, null, { role, enabled });
  return getRecipeAccess(data.user_id);
}

function removeRecipeUserAccess(userId, actor) {
  const granter = assertCanManageRecipeAccess(actor);
  getDb().prepare('DELETE FROM recipe_user_access WHERE user_id = ?').run(userId);
  logActivity(granter, 'remove_recipe_access', 'user', userId, null, null);
  return true;
}

function loginToRecipeModule(username, password, pin) {
  const store = require('./store');
  const result = store.login(username, password, pin);
  if (!result?.success || !result.user) {
    throw new Error(result?.error || 'Login failed');
  }
  const user = result.user;
  if (user.role === 'owner') {
    return { ...user, recipe_role: 'administrator', recipe_enabled: true };
  }
  const access = getRecipeAccess(user.id);
  if (!access || !access.enabled) {
    try { store.logout(); } catch (_) {}
    throw new Error('You are not authorized for the Recipe & Production Management System. Ask an Admin to grant access.');
  }
  return { ...user, recipe_role: access.recipe_role, recipe_enabled: true };
}

/* ─── Ingredients (Inventory master) ─────────────────────────────────────── */

function listIngredients(filters = {}, actor) {
  canAccessRecipeModule(actor);
  let sql = `
    SELECT p.*, c.name AS category_name, s.name AS supplier_name
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN suppliers s ON s.id = p.supplier_id
    WHERE p.is_active = 1
  `;
  const params = [];
  if (filters.search) {
    sql += ' AND (p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)';
    const q = `%${filters.search}%`;
    params.push(q, q, q);
  }
  if (filters.category_id) {
    sql += ' AND p.category_id = ?';
    params.push(filters.category_id);
  }
  if (filters.low_stock) {
    sql += ' AND p.stock_quantity <= COALESCE(p.min_stock, 5)';
  }
  if (filters.out_of_stock) {
    sql += ' AND p.stock_quantity <= 0';
  }
  sql += ' ORDER BY p.name';
  const rows = getDb().prepare(sql).all(...params);
  // Batch conversions — avoid N+1 getProductConversions per ingredient
  let conversionsByProduct = new Map();
  try {
    const ids = rows.map((p) => Number(p.id)).filter(Boolean);
    if (ids.length) {
      const ph = ids.map(() => '?').join(',');
      const convRows = getDb().prepare(
        `SELECT * FROM product_conversions WHERE product_id IN (${ph})`
      ).all(...ids);
      for (const c of convRows) {
        const pid = Number(c.product_id);
        if (!conversionsByProduct.has(pid)) conversionsByProduct.set(pid, []);
        conversionsByProduct.get(pid).push(c);
      }
    }
  } catch (_) {
    conversionsByProduct = null;
  }
  return rows.map(p => ({
    ...p,
    conversions: conversionsByProduct
      ? (conversionsByProduct.get(Number(p.id)) || [])
      : inventory.getProductConversions(p.id),
    purchase_unit: p.purchase_unit || p.unit,
    recipe_unit: p.stock_unit || p.unit || 'each'
  }));
}

function getIngredient(id, actor) {
  canAccessRecipeModule(actor);
  const p = getDb().prepare(`
    SELECT p.*, c.name AS category_name, s.name AS supplier_name
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN suppliers s ON s.id = p.supplier_id
    WHERE p.id = ?
  `).get(id);
  if (!p) throw new Error('Ingredient not found');
  return {
    ...p,
    conversions: inventory.getProductConversions(p.id),
    purchase_unit: p.purchase_unit || p.unit,
    recipe_unit: p.stock_unit || p.unit || 'each'
  };
}

/* ─── Costing helpers ────────────────────────────────────────────────────── */

function calcProfitFromCost(recipeCost, mode, targetPct, overridePrice) {
  const cost = Number(recipeCost) || 0;
  let suggested = cost;
  const pct = Number(targetPct) || 40;
  if (mode === 'markup_pct') {
    suggested = cost * (1 + pct / 100);
  } else if (mode === 'gross_margin') {
    // sell so that margin = pct: profit/sell = pct => sell = cost / (1 - pct/100)
    const denom = 1 - pct / 100;
    suggested = denom > 0 ? cost / denom : cost;
  } else {
    // profit_pct: sell = cost * (1 + pct/100) same as markup for “desired profit on cost”
    suggested = cost * (1 + pct / 100);
  }
  suggested = Math.round(suggested * 100) / 100;
  const selling = overridePrice != null && overridePrice !== '' ? Number(overridePrice) : suggested;
  const grossProfit = selling - cost;
  const foodCostPct = selling > 0 ? (cost / selling) * 100 : 0;
  const profitMargin = selling > 0 ? (grossProfit / selling) * 100 : 0;
  const markup = cost > 0 ? (grossProfit / cost) * 100 : 0;
  return {
    recipe_cost: Math.round(cost * 100) / 100,
    suggested_price: suggested,
    selling_price: Math.round(selling * 100) / 100,
    gross_profit: Math.round(grossProfit * 100) / 100,
    food_cost_pct: Math.round(foodCostPct * 10) / 10,
    profit_margin: Math.round(profitMargin * 10) / 10,
    markup_pct: Math.round(markup * 10) / 10
  };
}

function findIngredientByName(name) {
  const trimmed = (name || '').trim();
  if (!trimmed) return null;
  return getDb().prepare(`
    SELECT p.*, s.name AS supplier_name FROM products p
    LEFT JOIN suppliers s ON s.id = p.supplier_id
    WHERE p.is_active = 1 AND lower(trim(p.name)) = lower(?)
    ORDER BY CASE WHEN p.item_type = 'ingredient' THEN 0 ELSE 1 END, p.id
    LIMIT 1
  `).get(trimmed);
}

/** Create or reuse an Inventory product for a typed recipe ingredient name. */
/** Create or return a saved ingredient (Ingredient Master / picker). */
function ensureIngredient(data, actor) {
  canAccessRecipeModule(actor);
  const name = (data?.name || data?.ingredient_name || '').trim();
  const unit = (data?.unit || data?.stock_unit || 'each').toString().trim() || 'each';
  return findOrCreateIngredientByName(name, unit, actor);
}

function updateIngredient(data, actor) {
  requireRecipePerm(actor, 'edit');
  const id = Number(data?.id);
  if (!id) throw new Error('Ingredient required');
  const db = getDb();
  const row = db.prepare(`SELECT * FROM products WHERE id = ? AND is_active = 1`).get(id);
  if (!row) throw new Error('Ingredient not found');
  const name = (data.name || row.name || '').trim();
  if (!name) throw new Error('Name required');
  const clash = db.prepare(`
    SELECT id FROM products WHERE LOWER(TRIM(name)) = LOWER(?) AND id != ? AND is_active = 1
  `).get(name, id);
  if (clash) throw new Error(`Another item already uses the name "${name}"`);
  const unit = (data.unit || data.stock_unit || row.stock_unit || row.unit || 'each').toString().trim() || 'each';
  const minStock = data.min_stock != null ? Number(data.min_stock) : (row.min_stock ?? 5);
  const buying = data.buying_price != null ? Number(data.buying_price) : (row.buying_price || 0);
  const packLabel = (data.purchase_unit_label != null ? data.purchase_unit_label : row.purchase_unit_label) || null;
  const packQty = data.purchase_unit_qty != null ? Number(data.purchase_unit_qty) : (Number(row.purchase_unit_qty) || 1);
  const purchaseUnit = (data.purchase_unit || packLabel || row.purchase_unit || unit || '').toString().trim() || unit;
  try {
    db.prepare(`
      UPDATE products SET name=?, unit=?, stock_unit=?, purchase_unit=?, purchase_unit_qty=?, purchase_unit_label=?,
        min_stock=?, buying_price=?, item_type=COALESCE(NULLIF(item_type,''), 'ingredient'),
        updated_at=datetime('now') WHERE id=?
    `).run(name, unit, unit, purchaseUnit, packQty > 0 ? packQty : 1, packLabel, minStock, buying, id);
  } catch (_) {
    try {
      db.prepare(`
        UPDATE products SET name=?, unit=?, stock_unit=?, purchase_unit=COALESCE(?, purchase_unit),
          min_stock=?, buying_price=?, item_type=COALESCE(item_type, 'ingredient'),
          updated_at=datetime('now') WHERE id=?
      `).run(name, unit, unit, purchaseUnit, minStock, buying, id);
    } catch (__) {
      db.prepare(`UPDATE products SET name=?, unit=?, updated_at=datetime('now') WHERE id=?`)
        .run(name, unit, id);
    }
  }
  if (Array.isArray(data.conversions)) {
    const conversions = data.conversions
      .filter(c => c.from_unit?.trim() && c.to_unit?.trim() && Number(c.to_qty) > 0)
      .map(c => ({
        from_qty: Number(c.from_qty) > 0 ? Number(c.from_qty) : 1,
        from_unit: String(c.from_unit).trim(),
        to_qty: Number(c.to_qty),
        to_unit: String(c.to_unit).trim(),
        label: (c.label || '').trim() || null
      }));
    if (packLabel && packQty > 0) {
      const code = String(purchaseUnit || packLabel).toLowerCase();
      if (!conversions.some(c => String(c.from_unit).toLowerCase() === code && String(c.to_unit).toLowerCase() === String(unit).toLowerCase())) {
        conversions.unshift({
          from_qty: 1,
          from_unit: purchaseUnit || packLabel,
          to_qty: packQty,
          to_unit: unit,
          label: packLabel
        });
      }
    }
    inventory.saveProductConversions(id, conversions);
  }
  logActivity(actor, 'update_ingredient', 'product', id, { name: row.name }, { name, unit, purchaseUnit, packQty, packLabel });
  try { require('./production-availability').refreshAffectedByIngredient(id); } catch (_) { /* ignore */ }
  const updated = db.prepare('SELECT * FROM products WHERE id=?').get(id);
  return { ...updated, conversions: inventory.getProductConversions(id) };
}

function deleteIngredient(id, actor) {
  try { requireRecipePerm(actor, 'delete'); }
  catch (_) { requireRecipePerm(actor, 'edit'); }
  const ingId = Number(id);
  if (!ingId) throw new Error('Ingredient required');
  const db = getDb();
  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(ingId);
  if (!row) throw new Error('Ingredient not found');
  const used = db.prepare(`
    SELECT COUNT(*) AS c, GROUP_CONCAT(DISTINCT meal.name) AS meals
    FROM product_recipe_items pri
    JOIN products meal ON meal.id = pri.product_id AND meal.is_active = 1
    WHERE pri.ingredient_product_id = ?
  `).get(ingId);
  if ((used?.c || 0) > 0) {
    throw new Error(`Cannot delete — used on: ${used.meals || 'meals'}. Remove it from those recipes first.`);
  }
  db.prepare(`UPDATE products SET is_active = 0, updated_at=datetime('now') WHERE id = ?`).run(ingId);
  logActivity(actor, 'delete_ingredient', 'product', ingId, { name: row.name }, null);
  return true;
}

/** Auto-calc restock buy qty for shared ingredients to support N meals (uses main when set). */
function calculateRestockPlan(targetMeals, actor) {
  canAccessRecipeModule(actor);
  const target = Math.max(1, Math.floor(Number(targetMeals) || 0));
  const db = getDb();
  const meals = db.prepare(`
    SELECT DISTINCT p.id, p.name FROM products p
    JOIN product_recipe_items pri ON pri.product_id = p.id
    WHERE p.is_active = 1 AND p.has_recipe = 1
  `).all();
  const needByIng = new Map();
  for (const meal of meals) {
    const items = inventory.getProductRecipe(meal.id).filter(i => {
      const rule = inventory.normalizeIncludeRule(i.include_rule);
      return rule === 'always' || !String(i.option_name || '').trim();
    });
    if (!items.length) continue;
    for (const item of items) {
      const ingId = Number(item.ingredient_product_id);
      const waste = 1 + (Number(item.waste_pct) || 0) / 100;
      const perMeal = (Number(item.quantity) || 0) * waste;
      const need = perMeal * target;
      const prev = needByIng.get(ingId) || { need: 0, unit: item.unit, name: item.ingredient_name, meals: [] };
      prev.need = Math.max(prev.need, need);
      prev.unit = item.unit || prev.unit;
      prev.name = item.ingredient_name || prev.name;
      if (!prev.meals.includes(meal.name)) prev.meals.push(meal.name);
      needByIng.set(ingId, prev);
    }
  }
  const plan = [];
  for (const [ingId, info] of needByIng.entries()) {
    const ing = db.prepare('SELECT * FROM products WHERE id=? AND is_active=1').get(ingId);
    if (!ing) continue;
    const stockUnit = ing.stock_unit || ing.unit || 'each';
    const recipeUnit = info.unit || stockUnit;
    const needStock = inventory.convertQuantity(ingId, info.need, recipeUnit, stockUnit);
    const have = Number(ing.stock_quantity) || 0;
    const buy = Math.max(0, Math.ceil((needStock - have) * 1000) / 1000);
    plan.push({
      id: ing.id,
      name: ing.name,
      stock_quantity: have,
      buy_qty: buy,
      unit: ing.purchase_unit || stockUnit,
      stock_unit: stockUnit,
      recipe_unit: recipeUnit,
      need_for_target: Math.round(needStock * 1000) / 1000,
      used_in_meals: info.meals.join(', '),
      buying_price: Number(ing.buying_price) || 0,
      est_cost: Math.round(buy * (Number(ing.buying_price) || 0) * 100) / 100
    });
  }
  return { target_meals: target, lines: plan.sort((a, b) => a.name.localeCompare(b.name)) };
}

/** Control which meals appear under Available Today / New Arrival / Best Seller / Sell on POS. */
function setPosMenuFlags(data, actor) {
  requireRecipePerm(actor, 'edit');
  const db = getDb();
  const avail = new Set((data.available_today || []).map(Number).filter(Boolean));
  const neu = new Set((data.new_arrival || []).map(Number).filter(Boolean));
  const best = new Set((data.best_seller || []).map(Number).filter(Boolean));
  const sell = data.show_on_pos || {};
  // Reset flags on recipe meals, then apply selections
  db.prepare(`
    UPDATE products SET available_today = 0
    WHERE has_recipe = 1 OR item_type = 'restaurant' OR production_mode IS NOT NULL
  `).run();
  db.prepare(`
    UPDATE products SET is_new_arrival = 0
    WHERE has_recipe = 1 OR item_type = 'restaurant' OR production_mode IS NOT NULL
  `).run();
  db.prepare(`
    UPDATE products SET is_best_seller = 0
    WHERE has_recipe = 1 OR item_type = 'restaurant' OR production_mode IS NOT NULL
  `).run();
  const until = new Date();
  until.setDate(until.getDate() + 14);
  const untilStr = until.toISOString().slice(0, 10);
  for (const id of avail) {
    db.prepare('UPDATE products SET available_today = 1 WHERE id = ?').run(id);
    db.prepare('UPDATE recipe_profiles SET available_today = 1 WHERE product_id = ?').run(id);
  }
  for (const id of neu) {
    db.prepare('UPDATE products SET is_new_arrival = 1, new_arrival_until = ? WHERE id = ?').run(untilStr, id);
  }
  for (const id of best) {
    try { db.prepare('UPDATE products SET is_best_seller = 1 WHERE id = ?').run(id); }
    catch (_) { /* column missing until migrate */ }
  }
  for (const [pid, on] of Object.entries(sell)) {
    try {
      db.prepare('UPDATE products SET show_on_pos = ? WHERE id = ?').run(on ? 1 : 0, Number(pid));
    } catch (_) { /* ignore */ }
  }
  logActivity(actor, 'set_pos_menu_flags', 'product', null, null, {
    available_today: [...avail], new_arrival: [...neu], best_seller: [...best]
  });
  return true;
}

function findOrCreateIngredientByName(name, unit, actor) {
  const trimmed = (name || '').trim();
  if (!trimmed) throw new Error('Type an ingredient name');
  const existing = findIngredientByName(trimmed);
  if (existing) {
    const u = (unit || '').trim();
    if (u && (!existing.stock_unit || existing.stock_unit === 'each') && u !== 'each') {
      getDb().prepare(`
        UPDATE products SET stock_unit=?, unit=COALESCE(NULLIF(unit,''), ?), purchase_unit=COALESCE(purchase_unit, ?),
          updated_at=datetime('now') WHERE id=?
      `).run(u, u, u, existing.id);
      return getDb().prepare('SELECT * FROM products WHERE id=?').get(existing.id);
    }
    return existing;
  }
  // Insert directly (do not call store.saveProduct — circular export + retail price rules)
  const u = (unit || '').trim() || 'each';
  const db = getDb();
  // Ensure extended columns exist (same alters as Inventory)
  for (const sql of [
    "ALTER TABLE products ADD COLUMN stock_unit TEXT DEFAULT 'each'",
    'ALTER TABLE products ADD COLUMN purchase_unit TEXT',
    "ALTER TABLE products ADD COLUMN item_type TEXT DEFAULT 'retail'",
    'ALTER TABLE products ADD COLUMN opening_stock REAL DEFAULT 0',
    'ALTER TABLE products ADD COLUMN min_stock REAL DEFAULT 5'
  ]) {
    try { db.exec(sql); } catch (_) { /* already exists */ }
  }
  let newId = 0;
  try {
    const r = db.prepare(`
      INSERT INTO products (
        name, selling_price, buying_price, stock_quantity, min_stock,
        unit, stock_unit, purchase_unit, item_type, description, opening_stock, is_active
      ) VALUES (?, 0, 0, 0, 0, ?, ?, ?, 'ingredient', ?, 0, 1)
    `).run(trimmed, u, u, u, 'Recipe ingredient (typed in Recipe Builder)');
    newId = parseInt(r.lastInsertRowid, 10) || 0;
  } catch (err) {
    const r = db.prepare(`
      INSERT INTO products (name, selling_price, buying_price, stock_quantity, unit, is_active)
      VALUES (?, 0, 0, 0, ?, 1)
    `).run(trimmed, u);
    newId = parseInt(r.lastInsertRowid, 10) || 0;
    if (newId) {
      try {
        db.prepare(`UPDATE products SET stock_unit=?, purchase_unit=?, item_type='ingredient',
          description=?, min_stock=0, updated_at=datetime('now') WHERE id=?`)
          .run(u, u, 'Recipe ingredient (typed in Recipe Builder)', newId);
      } catch (_) { /* older schema */ }
    }
  }
  if (!newId) {
    const row = db.prepare('SELECT id FROM products WHERE name = ? ORDER BY id DESC LIMIT 1').get(trimmed);
    newId = row?.id ? parseInt(row.id, 10) : 0;
  }
  if (!newId) throw new Error('Could not create ingredient — try again');
  logActivity(actor, 'create_ingredient', 'product', newId, null, { name: trimmed, unit: u });
  return db.prepare('SELECT * FROM products WHERE id=?').get(newId);
}

function enrichRecipeLines(items) {
  return (items || []).map(item => {
    let ing = null;
    if (item.ingredient_product_id) {
      ing = getDb().prepare(`
        SELECT p.*, s.name AS supplier_name FROM products p
        LEFT JOIN suppliers s ON s.id = p.supplier_id WHERE p.id = ?
      `).get(item.ingredient_product_id);
    }
    if (!ing && item.ingredient_name) {
      ing = findIngredientByName(item.ingredient_name);
    }
    if (!ing) {
      return {
        ...item,
        ingredient_name: (item.ingredient_name || '').trim() || 'Missing',
        current_stock: 0,
        unit_cost: 0,
        cost_used: 0,
        available: false,
        supplier_name: null
      };
    }
    const waste = 1 + (Number(item.waste_pct) || 0) / 100;
    const qtyNeeded = (Number(item.quantity) || 0) * waste;
    const stockUnit = ing.stock_unit || ing.unit || 'each';
    const qtyInStock = inventory.convertQuantity(ing.id, qtyNeeded, item.unit || stockUnit, stockUnit);
    const lineCost = qtyInStock * (ing.buying_price || 0);
    return {
      ...item,
      ingredient_product_id: ing.id,
      ingredient_name: ing.name,
      current_stock: ing.stock_quantity,
      stock_unit: stockUnit,
      unit_cost: ing.buying_price || 0,
      cost_used: Math.round(lineCost * 100) / 100,
      supplier_id: ing.supplier_id,
      supplier_name: ing.supplier_name || null,
      available: (ing.stock_quantity || 0) >= qtyInStock,
      available_qty: ing.stock_quantity || 0,
      picture_path: ing.picture_path,
      conversions: inventory.getProductConversions(ing.id)
    };
  });
}

function computeRecipeCosting(items, opts = {}) {
  const lines = enrichRecipeLines(items);
  const recipeCost = lines.reduce((s, l) => s + (l.cost_used || 0), 0);
  const pricing = calcProfitFromCost(
    recipeCost,
    opts.price_mode || 'profit_pct',
    opts.target_profit_pct ?? 40,
    opts.override_price
  );
  return { lines, ...pricing };
}

/* ─── Recipes ────────────────────────────────────────────────────────────── */

function getRecipeProfile(id) {
  const r = getDb().prepare('SELECT * FROM recipe_profiles WHERE id = ?').get(id);
  if (!r) return null;
  let items = [];
  if (r.product_id) {
    items = inventory.getProductRecipe(r.product_id);
  }
  const costing = computeRecipeCosting(items, {
    price_mode: r.price_mode,
    target_profit_pct: r.target_profit_pct,
    override_price: r.override_price
  });
  return { ...r, items: costing.lines, costing };
}

function listRecipes(filters = {}, actor) {
  canAccessRecipeModule(actor);
  const scope = resolveRecipeBranchScope(actor, filters);
  let sql = 'SELECT * FROM recipe_profiles WHERE 1=1';
  const params = [];
  if (filters.status) {
    sql += ' AND status = ?';
    params.push(filters.status);
  }
  if (filters.search) {
    sql += ' AND (name LIKE ? OR category LIKE ?)';
    params.push(`%${filters.search}%`, `%${filters.search}%`);
  }
  if (filters.available_today) sql += ' AND available_today = 1';
  sql = appendRecipeBranchSql(sql, params, scope);
  sql += ' ORDER BY updated_at DESC';
  return getDb().prepare(sql).all(...params);
}

function saveRecipeSnapshot(profileId, actor, notes) {
  const profile = getDb().prepare('SELECT * FROM recipe_profiles WHERE id = ?').get(profileId);
  if (!profile) return;
  const items = profile.product_id ? inventory.getProductRecipe(profile.product_id) : [];
  const snapshot = { profile, items };
  getDb().prepare(`
    INSERT INTO recipe_versions (recipe_profile_id, version, snapshot_json, recipe_cost, selling_price, changed_by, change_notes)
    VALUES (?,?,?,?,?,?,?)
  `).run(
    profileId,
    profile.version,
    JSON.stringify(snapshot),
    profile.recipe_cost,
    profile.selling_price,
    actor?.id || null,
    notes || null
  );
}

function saveRecipe(data, actor) {
  const isNew = !data.id;
  if (isNew) requireRecipePerm(actor, 'create');
  else requireRecipePerm(actor, 'edit');

  const db = getDb();
  const items = data.items || data.recipe || [];
  const costing = computeRecipeCosting(items, {
    price_mode: data.price_mode || 'profit_pct',
    target_profit_pct: data.target_profit_pct ?? 40,
    override_price: data.override_price
  });

  const fields = {
    name: (data.name || '').trim(),
    category: data.category || null,
    description: data.description || null,
    prep_time_minutes: Number(data.prep_time_minutes) || 0,
    cook_time_minutes: Number(data.cook_time_minutes) || 0,
    serving_size: Number(data.serving_size) || 1,
    yield_qty: Number(data.yield_qty) || 1,
    yield_unit: data.yield_unit || 'portion',
    image_path: data.image_path || null,
    instructions: data.instructions || null,
    video_url: data.video_url || null,
    notes: data.notes || null,
    allergens: data.allergens !== undefined ? (String(data.allergens || '').trim() || null) : undefined,
    production_mode: data.production_mode === 'make_to_stock' ? 'make_to_stock' : 'make_to_order',
    price_mode: data.price_mode || 'profit_pct',
    target_profit_pct: Number(data.target_profit_pct) || 40,
    suggested_price: costing.suggested_price,
    override_price: data.override_price != null && data.override_price !== '' ? Number(data.override_price) : null,
    selling_price: costing.selling_price,
    recipe_cost: costing.recipe_cost,
    food_cost_pct: costing.food_cost_pct,
    gross_profit: costing.gross_profit,
    profit_margin: costing.profit_margin,
    available_today: data.available_today ? 1 : 0,
    new_arrival_days: Number(data.new_arrival_days) || 14,
    status: data.status || 'draft'
  };
  if (!fields.name) throw new Error('Recipe name is required');

  const recipeScope = resolveRecipeBranchScope(actor, data);
  let branchId = stampBranchId(actor, data);

  let profileId = data.id;
  let productId = data.product_id || null;

  if (profileId) {
    const prev = db.prepare('SELECT * FROM recipe_profiles WHERE id = ?').get(profileId);
    if (!prev) throw new Error('Recipe not found');
    if (['approved', 'pending'].includes(prev.status) && data.bump_version !== false) {
      saveRecipeSnapshot(profileId, actor, 'Pre-edit snapshot');
      db.prepare('UPDATE recipe_profiles SET version = version + 1 WHERE id = ?').run(profileId);
    }
    productId = prev.product_id || productId;
    const allergensVal = fields.allergens !== undefined ? fields.allergens : (prev.allergens || null);
    try {
      db.prepare(`
        UPDATE recipe_profiles SET
          name=?, category=?, description=?, prep_time_minutes=?, cook_time_minutes=?,
          serving_size=?, yield_qty=?, yield_unit=?, image_path=?, instructions=?, video_url=?, notes=?, allergens=?,
          production_mode=?, price_mode=?, target_profit_pct=?, suggested_price=?, override_price=?,
          selling_price=?, recipe_cost=?, food_cost_pct=?, gross_profit=?, profit_margin=?,
          available_today=?, new_arrival_days=?, status=?, updated_by=?, updated_at=datetime('now')
        WHERE id=?
      `).run(
        fields.name, fields.category, fields.description, fields.prep_time_minutes, fields.cook_time_minutes,
        fields.serving_size, fields.yield_qty, fields.yield_unit, fields.image_path, fields.instructions, fields.video_url, fields.notes, allergensVal,
        fields.production_mode, fields.price_mode, fields.target_profit_pct, fields.suggested_price, fields.override_price,
        fields.selling_price, fields.recipe_cost, fields.food_cost_pct, fields.gross_profit, fields.profit_margin,
        fields.available_today, fields.new_arrival_days, fields.status === 'approved' ? prev.status : fields.status,
        actor?.id || null, profileId
      );
    } catch (_) {
      db.prepare(`
        UPDATE recipe_profiles SET
          name=?, category=?, description=?, prep_time_minutes=?, cook_time_minutes=?,
          serving_size=?, yield_qty=?, yield_unit=?, image_path=?, instructions=?, video_url=?, notes=?,
          production_mode=?, price_mode=?, target_profit_pct=?, suggested_price=?, override_price=?,
          selling_price=?, recipe_cost=?, food_cost_pct=?, gross_profit=?, profit_margin=?,
          available_today=?, new_arrival_days=?, status=?, updated_by=?, updated_at=datetime('now')
        WHERE id=?
      `).run(
        fields.name, fields.category, fields.description, fields.prep_time_minutes, fields.cook_time_minutes,
        fields.serving_size, fields.yield_qty, fields.yield_unit, fields.image_path, fields.instructions, fields.video_url, fields.notes,
        fields.production_mode, fields.price_mode, fields.target_profit_pct, fields.suggested_price, fields.override_price,
        fields.selling_price, fields.recipe_cost, fields.food_cost_pct, fields.gross_profit, fields.profit_margin,
        fields.available_today, fields.new_arrival_days, fields.status === 'approved' ? prev.status : fields.status,
        actor?.id || null, profileId
      );
    }
    if (branchId != null) {
      try { db.prepare('UPDATE recipe_profiles SET branch_id = ? WHERE id = ?').run(branchId, profileId); } catch (_) { /* ignore */ }
    }
  } else {
    let r;
    try {
      r = db.prepare(`
        INSERT INTO recipe_profiles (
          product_id, name, category, description, prep_time_minutes, cook_time_minutes,
          serving_size, yield_qty, yield_unit, image_path, instructions, video_url, notes, allergens,
          status, production_mode, price_mode, target_profit_pct, suggested_price, override_price,
          selling_price, recipe_cost, food_cost_pct, gross_profit, profit_margin,
          available_today, new_arrival_days, branch_id, created_by, updated_by
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        productId, fields.name, fields.category, fields.description, fields.prep_time_minutes, fields.cook_time_minutes,
        fields.serving_size, fields.yield_qty, fields.yield_unit, fields.image_path, fields.instructions, fields.video_url, fields.notes, fields.allergens,
        'draft', fields.production_mode, fields.price_mode, fields.target_profit_pct, fields.suggested_price, fields.override_price,
        fields.selling_price, fields.recipe_cost, fields.food_cost_pct, fields.gross_profit, fields.profit_margin,
        fields.available_today, fields.new_arrival_days, branchId, actor?.id || null, actor?.id || null
      );
    } catch (_) {
      r = db.prepare(`
        INSERT INTO recipe_profiles (
          product_id, name, category, description, prep_time_minutes, cook_time_minutes,
          serving_size, yield_qty, yield_unit, image_path, instructions, video_url, notes,
          status, production_mode, price_mode, target_profit_pct, suggested_price, override_price,
          selling_price, recipe_cost, food_cost_pct, gross_profit, profit_margin,
          available_today, new_arrival_days, created_by, updated_by
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        productId, fields.name, fields.category, fields.description, fields.prep_time_minutes, fields.cook_time_minutes,
        fields.serving_size, fields.yield_qty, fields.yield_unit, fields.image_path, fields.instructions, fields.video_url, fields.notes,
        'draft', fields.production_mode, fields.price_mode, fields.target_profit_pct, fields.suggested_price, fields.override_price,
        fields.selling_price, fields.recipe_cost, fields.food_cost_pct, fields.gross_profit, fields.profit_margin,
        fields.available_today, fields.new_arrival_days, actor?.id || null, actor?.id || null
      );
    }
    profileId = r.lastInsertRowid;
  }
  if (productId && fields.allergens !== undefined) {
    try { db.prepare('UPDATE products SET allergens = ? WHERE id = ?').run(fields.allergens, productId); } catch (_) { /* until migrate */ }
  }

  if (productId && items.length) {
    inventory.saveProductRecipe(productId, items);
    if (data.conversions) inventory.saveProductConversions(productId, data.conversions);
    inventory.updateProductRecipeMetrics(productId, costing.selling_price);
    db.prepare('UPDATE products SET production_mode = ?, available_today = ? WHERE id = ?')
      .run(fields.production_mode, fields.available_today, productId);
  }

  // Store draft BOM on profile via a linked draft product if none yet — keep items in version snapshot
  if (!productId && items.length) {
    saveRecipeSnapshot(profileId, actor, 'Draft BOM');
    // stash items in latest version only; createProduct will materialize
    db.prepare(`
      UPDATE recipe_versions SET snapshot_json = ? WHERE id = (
        SELECT id FROM recipe_versions WHERE recipe_profile_id = ? ORDER BY id DESC LIMIT 1
      )
    `).run(JSON.stringify({ profile: getDb().prepare('SELECT * FROM recipe_profiles WHERE id = ?').get(profileId), items }), profileId);
  } else if (items.length) {
    // Always keep a working snapshot of current items
    const profile = db.prepare('SELECT * FROM recipe_profiles WHERE id = ?').get(profileId);
    const latest = db.prepare('SELECT id FROM recipe_versions WHERE recipe_profile_id = ? AND version = ?').get(profileId, profile.version);
    if (!latest) {
      db.prepare(`
        INSERT INTO recipe_versions (recipe_profile_id, version, snapshot_json, recipe_cost, selling_price, changed_by, change_notes)
        VALUES (?,?,?,?,?,?,?)
      `).run(profileId, profile.version, JSON.stringify({ profile, items }), costing.recipe_cost, costing.selling_price, actor?.id || null, 'Working BOM');
    } else {
      db.prepare('UPDATE recipe_versions SET snapshot_json=?, recipe_cost=?, selling_price=? WHERE id=?')
        .run(JSON.stringify({ profile, items }), costing.recipe_cost, costing.selling_price, latest.id);
    }
  }

  logActivity(actor, isNew ? 'create_recipe' : 'update_recipe', 'recipe', profileId, null, { name: fields.name });
  return getRecipeWithItems(profileId);
}

function getRecipeWithItems(id) {
  const r = getDb().prepare('SELECT * FROM recipe_profiles WHERE id = ?').get(id);
  if (!r) return null;
  let items = [];
  if (r.product_id) {
    items = inventory.getProductRecipe(r.product_id);
  } else {
    const ver = getDb().prepare(`
      SELECT snapshot_json FROM recipe_versions WHERE recipe_profile_id = ? ORDER BY id DESC LIMIT 1
    `).get(id);
    if (ver?.snapshot_json) {
      try {
        const snap = JSON.parse(ver.snapshot_json);
        items = snap.items || [];
      } catch (_) {}
    }
  }
  const costing = computeRecipeCosting(items, {
    price_mode: r.price_mode,
    target_profit_pct: r.target_profit_pct,
    override_price: r.override_price
  });
  const versionsRaw = getDb().prepare(`
    SELECT id, version, recipe_cost, selling_price, changed_by, change_notes, created_at, snapshot_json
    FROM recipe_versions WHERE recipe_profile_id = ? ORDER BY version ASC, id ASC LIMIT 50
  `).all(id);
  const versions = [];
  let prev = null;
  for (const v of versionsRaw) {
    const entry = {
      id: v.id,
      version: v.version,
      recipe_cost: v.recipe_cost,
      selling_price: v.selling_price,
      changed_by: v.changed_by,
      change_notes: v.change_notes,
      created_at: v.created_at,
      cost_diff: prev ? Math.round(((v.recipe_cost || 0) - (prev.recipe_cost || 0)) * 100) / 100 : 0,
      price_diff: prev ? Math.round(((v.selling_price || 0) - (prev.selling_price || 0)) * 100) / 100 : 0
    };
    versions.push(entry);
    prev = v;
  }
  versions.reverse();
  return { ...r, items: costing.lines, costing, versions };
}

function submitRecipeForApproval(id, actor) {
  requireRecipePerm(actor, 'edit');
  const r = getDb().prepare('SELECT * FROM recipe_profiles WHERE id = ?').get(id);
  if (!r) throw new Error('Recipe not found');
  if (!['draft', 'rejected'].includes(r.status)) throw new Error('Only draft or rejected recipes can be submitted');
  getDb().prepare(`UPDATE recipe_profiles SET status='pending', updated_at=datetime('now'), updated_by=? WHERE id=?`)
    .run(actor?.id || null, id);
  logActivity(actor, 'submit_recipe', 'recipe', id, { status: r.status }, { status: 'pending' });
  return getRecipeWithItems(id);
}

function approveRecipe(id, actor) {
  requireRecipePerm(actor, 'approve');
  const r = getDb().prepare('SELECT * FROM recipe_profiles WHERE id = ?').get(id);
  if (!r) throw new Error('Recipe not found');
  if (r.status !== 'pending') throw new Error('Only pending recipes can be approved');
  saveRecipeSnapshot(id, actor, 'Approved version');
  getDb().prepare(`
    UPDATE recipe_profiles SET status='approved', approved_by=?, approved_at=datetime('now'),
      rejection_notes=NULL, updated_at=datetime('now') WHERE id=?
  `).run(actor?.id || null, id);
  logActivity(actor, 'approve_recipe', 'recipe', id, { status: 'pending' }, { status: 'approved' });
  return getRecipeWithItems(id);
}

function rejectRecipe(id, notes, actor) {
  requireRecipePerm(actor, 'approve');
  const r = getDb().prepare('SELECT * FROM recipe_profiles WHERE id = ?').get(id);
  if (!r) throw new Error('Recipe not found');
  getDb().prepare(`
    UPDATE recipe_profiles SET status='rejected', rejection_notes=?, updated_at=datetime('now'), updated_by=? WHERE id=?
  `).run(notes || null, actor?.id || null, id);
  logActivity(actor, 'reject_recipe', 'recipe', id, null, { notes });
  return getRecipeWithItems(id);
}

function archiveRecipe(id, actor) {
  requireRecipePerm(actor, 'delete');
  getDb().prepare(`UPDATE recipe_profiles SET status='archived', updated_at=datetime('now') WHERE id=?`).run(id);
  logActivity(actor, 'archive_recipe', 'recipe', id, null, null);
  return getRecipeWithItems(id);
}

function deleteRecipe(id, actor) {
  requireRecipePerm(actor, 'delete');
  const r = getDb().prepare('SELECT * FROM recipe_profiles WHERE id = ?').get(id);
  if (!r) throw new Error('Recipe not found');
  if (r.status === 'approved' && r.product_id) {
    throw new Error('Archive approved recipes linked to POS products instead of deleting');
  }
  getDb().prepare('DELETE FROM recipe_versions WHERE recipe_profile_id = ?').run(id);
  getDb().prepare('DELETE FROM recipe_profiles WHERE id = ?').run(id);
  logActivity(actor, 'delete_recipe', 'recipe', id, { name: r.name }, null);
  return true;
}

function createProductFromRecipe(id, data, actor) {
  requireRecipePerm(actor, 'approve');
  const store = require('./store');
  const recipe = getRecipeWithItems(id);
  if (!recipe) throw new Error('Recipe not found');
  if (recipe.status !== 'approved') throw new Error('Only approved recipes can become POS products');

  const items = (recipe.items || []).map(i => ({
    ingredient_product_id: i.ingredient_product_id,
    quantity: i.quantity,
    unit: i.unit || 'each',
    waste_pct: i.waste_pct || 0
  }));
  if (!items.length) throw new Error('Recipe has no ingredients');

  const days = Number(data?.new_arrival_days || recipe.new_arrival_days || 14);
  const until = new Date();
  until.setDate(until.getDate() + days);
  const newArrivalUntil = until.toLocaleDateString('en-CA');
  const sellingPrice = Number(data?.selling_price ?? recipe.selling_price) || recipe.suggested_price;

  let productId;
  const taxRate = data?.tax_rate != null ? Number(data.tax_rate) : null;
  const barcode = data?.barcode || null;
  const sku = data?.sku || null;
  const modifiers = data?.modifiers || null;
  const menuTags = data?.menu_tags || data?.categories || [recipe.category].filter(Boolean);
  const productPayloadBase = {
    name: recipe.name,
    category_id: data?.category_id || null,
    selling_price: sellingPrice,
    buying_price: recipe.recipe_cost,
    description: recipe.description,
    picture_path: recipe.image_path || data?.image_path || null,
    barcode,
    sku,
    item_type: 'restaurant',
    is_active: 1,
    recipe: items,
    modifiers: modifiers || undefined
  };
  if (taxRate != null && !Number.isNaN(taxRate)) {
    productPayloadBase.tax_rate = taxRate;
  }

  if (recipe.product_id) {
    productId = store.saveProduct({
      id: recipe.product_id,
      ...productPayloadBase
    }, actor?.id, actor?.username || actor?.full_name);
  } else {
    productId = store.saveProduct({
      ...productPayloadBase,
      stock_quantity: recipe.production_mode === 'make_to_stock' ? 0 : 0
    }, actor?.id, actor?.username || actor?.full_name);
  }
  productId = typeof productId === 'object' ? productId.id : productId;

  getDb().prepare(`
    UPDATE recipe_profiles SET product_id=?, selling_price=?, new_arrival_until=?, updated_at=datetime('now') WHERE id=?
  `).run(productId, sellingPrice, newArrivalUntil, id);

  const flags = {
    new_arrival: true,
    available_today: !!recipe.available_today,
    featured: !!(data?.featured),
    on_sale: !!(data?.on_sale),
    popular: !!(data?.popular),
    seasonal: !!(data?.seasonal),
    special: !!(data?.special),
    categories: menuTags
  };
  getDb().prepare(`
    UPDATE products SET production_mode=?, available_today=?, is_new_arrival=1, new_arrival_until=?,
      menu_flags=? WHERE id=?
  `).run(
    recipe.production_mode,
    recipe.available_today ? 1 : 0,
    newArrivalUntil,
    JSON.stringify(flags),
    productId
  );

  const product = store.getProduct(productId);
  logActivity(actor, 'create_product_from_recipe', 'recipe', id, null, { product_id: productId, flags });
  return { recipe: getRecipeWithItems(id), product };
}

/* ─── Production ─────────────────────────────────────────────────────────── */

function calcProductionCapacity(recipeId, actor) {
  canAccessRecipeModule(actor);
  const recipe = getRecipeWithItems(recipeId);
  if (!recipe) throw new Error('Recipe not found');
  const scope = resolveRecipeBranchScope(actor, { branch_id: recipe.branch_id });
  const branchId = recipe.branch_id || scope.branchId || 1;
  const items = recipe.items || [];
  let maxMeals = Infinity;
  let limiting = null;
  const breakdown = [];
  for (const item of items) {
    const ing = getDb().prepare('SELECT * FROM products WHERE id = ?').get(item.ingredient_product_id);
    if (!ing) continue;
    const waste = 1 + (Number(item.waste_pct) || 0) / 100;
    const perMeal = (Number(item.quantity) || 0) * waste;
    const stockUnit = ing.stock_unit || ing.unit || 'each';
    const perMealStock = inventory.convertQuantity(ing.id, perMeal, item.unit || stockUnit, stockUnit);
    let stockQty = Number(ing.stock_quantity) || 0;
    try {
      stockQty = Number(branchesSvc.getBranchStockQuantity(ing.id, branchId)) || 0;
    } catch (_) { /* fall back to global */ }
    const canMake = perMealStock > 0 ? Math.floor(stockQty / perMealStock) : Infinity;
    breakdown.push({
      ingredient_product_id: ing.id,
      name: ing.name,
      stock: stockQty,
      per_meal: perMealStock,
      unit: stockUnit,
      can_make: canMake === Infinity ? null : canMake,
      branch_id: branchId
    });
    if (canMake < maxMeals) {
      maxMeals = canMake;
      limiting = ing.name;
    }
  }
  if (maxMeals === Infinity) maxMeals = 0;
  return { recipe_id: recipeId, max_meals: maxMeals, limiting_ingredient: limiting, breakdown, recipe_cost: recipe.recipe_cost, branch_id: branchId };
}

function planProduction(data, actor) {
  requireRecipePerm(actor, 'produce');
  let recipeId = data.recipe_profile_id;
  if (!recipeId && data.product_id) {
    const ensured = ensureApprovedProfileForMeal(Number(data.product_id), actor, { autoApprove: true });
    recipeId = ensured.id;
  }
  const recipe = getRecipeWithItems(recipeId);
  if (!recipe) throw new Error('Recipe not found');
  if (recipe.status !== 'approved') throw new Error('Only approved recipes can be produced — check Approvals');
  const qty = Number(data.planned_qty) || 1;
  const capacity = calcProductionCapacity(recipe.id, actor);
  const missing = (capacity.breakdown || []).filter(b => b.can_make != null && b.can_make < qty);
  const productionCost = (recipe.recipe_cost || 0) * qty;
  return {
    recipe,
    planned_qty: qty,
    capacity,
    missing,
    can_produce: missing.length === 0 && capacity.max_meals >= qty,
    production_cost: Math.round(productionCost * 100) / 100,
    ingredients_required: (recipe.items || []).map(i => ({
      ...i,
      required_qty: (Number(i.quantity) || 0) * qty * (1 + (Number(i.waste_pct) || 0) / 100)
    }))
  };
}

function completeProduction(data, actor) {
  requireRecipePerm(actor, 'produce');
  const store = require('./store');
  const plan = planProduction(data, actor);
  if (!plan.can_produce) throw new Error('Insufficient ingredients for this production quantity');
  const recipe = plan.recipe;
  const qty = plan.planned_qty;
  const actualQty = data.actual_qty != null && data.actual_qty !== ''
    ? Number(data.actual_qty)
    : (data.produced_qty != null && data.produced_qty !== '' ? Number(data.produced_qty) : qty);
  if (!(actualQty > 0)) throw new Error('Actual yield must be greater than zero');
  const variancePct = qty > 0
    ? Math.round(((actualQty - qty) / qty) * 1000) / 10
    : 0;
  const db = getDb();
  const actualOverrides = new Map();
  for (const row of data.actual_ingredients || data.ingredient_actuals || []) {
    const id = Number(row.ingredient_product_id || row.product_id || row.id);
    if (!id) continue;
    if (row.actual_qty != null && row.actual_qty !== '') actualOverrides.set(id, Number(row.actual_qty));
  }

  const batchBranchId = stampBranchId(actor, { branch_id: recipe.branch_id });
  let batch;
  try {
    batch = db.prepare(`
      INSERT INTO production_batches (
        recipe_profile_id, product_id, planned_qty, produced_qty, status, production_cost,
        limiting_ingredient, max_capacity, notes, yield_variance_pct, branch_id, created_by, completed_by, started_at, completed_at
      ) VALUES (?,?,?,?, 'completed', ?,?,?,?,?,?,?,?, datetime('now'), datetime('now'))
    `).run(
      recipe.id, recipe.product_id || null, qty, actualQty, plan.production_cost,
      plan.capacity.limiting_ingredient, plan.capacity.max_meals, data.notes || null, variancePct, batchBranchId,
      actor?.id || null, actor?.id || null
    );
  } catch (_) {
    batch = db.prepare(`
      INSERT INTO production_batches (
        recipe_profile_id, product_id, planned_qty, produced_qty, status, production_cost,
        limiting_ingredient, max_capacity, notes, created_by, completed_by, started_at, completed_at
      ) VALUES (?,?,?,?, 'completed', ?,?,?,?,?,?,?, datetime('now'), datetime('now'))
    `).run(
      recipe.id, recipe.product_id || null, qty, actualQty, plan.production_cost,
      plan.capacity.limiting_ingredient, plan.capacity.max_meals, data.notes || null,
      actor?.id || null, actor?.id || null
    );
  }
  const batchId = batch.lastInsertRowid;

  const deductOnProduce = recipe.production_mode === 'make_to_stock';
  for (const item of recipe.items || []) {
    const ing = db.prepare('SELECT * FROM products WHERE id = ?').get(item.ingredient_product_id);
    if (!ing) continue;
    const waste = 1 + (Number(item.waste_pct) || 0) / 100;
    let plannedDeduct = (Number(item.quantity) || 0) * qty * waste;
    const stockUnit = ing.stock_unit || ing.unit || 'each';
    if ((item.unit || stockUnit) !== stockUnit) {
      plannedDeduct = inventory.convertQuantity(ing.id, plannedDeduct, item.unit || stockUnit, stockUnit);
    }
    let deductQty = actualOverrides.has(ing.id) ? actualOverrides.get(ing.id) : plannedDeduct;
    if (!(deductQty >= 0)) deductQty = plannedDeduct;
    const lineCost = deductQty * (ing.buying_price || 0);
    try {
      db.prepare(`
        INSERT INTO production_batch_items (batch_id, ingredient_product_id, quantity, unit, unit_cost, line_cost, planned_quantity)
        VALUES (?,?,?,?,?,?,?)
      `).run(batchId, ing.id, deductQty, stockUnit, ing.buying_price || 0, lineCost, plannedDeduct);
    } catch (_) {
      db.prepare(`
        INSERT INTO production_batch_items (batch_id, ingredient_product_id, quantity, unit, unit_cost, line_cost)
        VALUES (?,?,?,?,?,?)
      `).run(batchId, ing.id, deductQty, stockUnit, ing.buying_price || 0, lineCost);
    }
    if (deductOnProduce) {
      store.adjustStock(ing.id, deductQty, 'remove', `Production batch #${batchId}`, actor?.id, 'production', batchId, batchBranchId);
    }
  }

  if (recipe.product_id && recipe.production_mode === 'make_to_stock') {
    store.adjustStock(recipe.product_id, actualQty, 'add', `Production batch #${batchId} yield`, actor?.id, 'production', batchId, batchBranchId);
  }

  logActivity(actor, 'complete_production', 'production_batch', batchId, null, {
    qty, actual_qty: actualQty, yield_variance_pct: variancePct, recipe_id: recipe.id
  });
  return db.prepare('SELECT * FROM production_batches WHERE id = ?').get(batchId);
}

/** One-click apply AI / costing suggested sell price onto linked POS product + recipe profile. */
function applySuggestedSellPrice(data, actor) {
  requireRecipePerm(actor, 'edit');
  const db = getDb();
  const recipeId = Number(data?.recipe_id || data?.id);
  let recipe = recipeId ? db.prepare('SELECT * FROM recipe_profiles WHERE id = ?').get(recipeId) : null;
  if (!recipe && data?.product_id) {
    recipe = db.prepare('SELECT * FROM recipe_profiles WHERE product_id = ? ORDER BY id DESC LIMIT 1')
      .get(Number(data.product_id));
  }
  if (!recipe) throw new Error('Recipe not found');
  const price = data?.suggested_price != null && data.suggested_price !== ''
    ? Number(data.suggested_price)
    : Number(recipe.suggested_price);
  if (!(price > 0)) throw new Error('No suggested sell price to apply');
  const productId = recipe.product_id || Number(data?.product_id) || null;
  if (!productId) throw new Error('Recipe is not linked to a POS product yet');
  const product = db.prepare('SELECT id, name, selling_price FROM products WHERE id = ?').get(productId);
  if (!product) throw new Error('Product not found');
  db.prepare(`UPDATE products SET selling_price=?, updated_at=datetime('now') WHERE id=?`).run(price, productId);
  db.prepare(`
    UPDATE recipe_profiles SET selling_price=?, override_price=?, suggested_price=?,
      updated_at=datetime('now'), updated_by=? WHERE id=?
  `).run(price, price, price, actor?.id || null, recipe.id);
  try { inventory.updateProductRecipeMetrics(productId, price); } catch (_) { /* ignore */ }
  try {
    const auditSvc = require('./audit');
    auditSvc.logPriceChange?.(productId, product.name, product.selling_price, price, actor?.id, actor?.full_name || actor?.name);
  } catch (_) { /* ignore */ }
  logActivity(actor, 'apply_suggested_price', 'recipe', recipe.id, { selling_price: recipe.selling_price }, { selling_price: price });
  return { recipe_id: recipe.id, product_id: productId, selling_price: price };
}

function listProductionBatches(filters = {}, actor) {
  canAccessRecipeModule(actor);
  const scope = resolveRecipeBranchScope(actor, filters);
  let sql = `
    SELECT b.*, r.name AS recipe_name FROM production_batches b
    LEFT JOIN recipe_profiles r ON r.id = b.recipe_profile_id WHERE 1=1
  `;
  const params = [];
  if (filters.from) { sql += ' AND date(b.created_at) >= ?'; params.push(filters.from); }
  if (filters.to) { sql += ' AND date(b.created_at) <= ?'; params.push(filters.to); }
  if (!scope.allBranches) {
    sql += ' AND b.branch_id = ?';
    params.push(scope.branchId);
  }
  sql += ' ORDER BY b.created_at DESC LIMIT 200';
  return getDb().prepare(sql).all(...params);
}

function smartRestock(recipeId, targetQty, actor) {
  canAccessRecipeModule(actor);
  const recipe = getRecipeWithItems(recipeId);
  if (!recipe) throw new Error('Recipe not found');
  const qty = Number(targetQty) || 1;
  const suggestions = [];
  for (const item of recipe.items || []) {
    const ing = getDb().prepare('SELECT * FROM products WHERE id = ?').get(item.ingredient_product_id);
    if (!ing) continue;
    const waste = 1 + (Number(item.waste_pct) || 0) / 100;
    let needed = (Number(item.quantity) || 0) * qty * waste;
    const stockUnit = ing.stock_unit || ing.unit || 'each';
    needed = inventory.convertQuantity(ing.id, needed, item.unit || stockUnit, stockUnit);
    const have = Number(ing.stock_quantity) || 0;
    const buy = Math.max(0, Math.ceil(needed - have));
    suggestions.push({
      ingredient_product_id: ing.id,
      name: ing.name,
      unit: stockUnit,
      needed,
      have,
      buy_qty: buy,
      est_cost: buy * (ing.buying_price || 0)
    });
  }
  return { recipe_id: recipeId, target_qty: qty, suggestions, total_est_cost: suggestions.reduce((s, x) => s + x.est_cost, 0) };
}

/* ─── Waste ──────────────────────────────────────────────────────────────── */

function ensureRecipeWastePhotoSchema() {
  try {
    getDb().exec('ALTER TABLE recipe_waste_logs ADD COLUMN photo_path TEXT');
  } catch (_) { /* column may already exist */ }
}

function saveRecipeWastePhoto(imageData, wasteId) {
  const fs = require('fs');
  const path = require('path');
  const { getDbPathForBackup } = require('../database/db');
  if (!imageData) return null;
  // Already a saved file path
  if (typeof imageData === 'string' && !imageData.startsWith('data:') && (imageData.includes('\\') || imageData.includes('/') || imageData.includes(':'))) {
    if (fs.existsSync(imageData)) return imageData;
  }
  const dir = path.join(path.dirname(getDbPathForBackup()), 'assets', 'recipe-waste');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  let ext = '.jpg';
  let raw = imageData;
  const match = String(imageData).match(/^data:image\/(\w+);base64,(.+)$/);
  if (match) {
    ext = match[1] === 'png' ? '.png' : '.jpg';
    raw = match[2];
  } else if (typeof imageData === 'string' && !imageData.includes(',')) {
    raw = imageData;
  } else {
    return null;
  }
  const file = path.join(dir, `waste-${wasteId || 'new'}-${Date.now()}${ext}`);
  fs.writeFileSync(file, Buffer.from(raw, 'base64'));
  return file;
}

function recordRecipeWaste(data, actor) {
  requireRecipePerm(actor, 'produce');
  ensureRecipeWastePhotoSchema();
  const productId = data.product_id;
  if (!productId || !data.quantity) throw new Error('Product and quantity required');
  const photoSrc = data.photo_path || data.photo_image || data.proof_image || null;
  if (!photoSrc) throw new Error('Photo of the wasted item is required');
  const p = getDb().prepare('SELECT * FROM products WHERE id = ?').get(productId);
  if (!p) throw new Error('Product not found');
  const cost = (Number(data.quantity) || 0) * (p.buying_price || 0);
  const r = getDb().prepare(`
    INSERT INTO recipe_waste_logs (waste_type, product_id, recipe_profile_id, quantity, unit, cost, reason, status, recorded_by, photo_path)
    VALUES (?,?,?,?,?,?,?, 'pending', ?, ?)
  `).run(
    data.waste_type || 'other', productId, data.recipe_profile_id || null,
    data.quantity, data.unit || p.stock_unit || p.unit, cost, data.reason || null, actor?.id || null, null
  );
  const wasteId = r.lastInsertRowid;
  let photoPath = null;
  try {
    photoPath = saveRecipeWastePhoto(photoSrc, wasteId);
  } catch (err) {
    getDb().prepare('DELETE FROM recipe_waste_logs WHERE id = ?').run(wasteId);
    throw new Error(err.message || 'Could not save waste photo');
  }
  if (!photoPath) {
    getDb().prepare('DELETE FROM recipe_waste_logs WHERE id = ?').run(wasteId);
    throw new Error('Photo of the wasted item is required');
  }
  getDb().prepare('UPDATE recipe_waste_logs SET photo_path = ? WHERE id = ?').run(photoPath, wasteId);
  logActivity(actor, 'record_waste', 'recipe_waste', wasteId, null, { ...data, photo_path: photoPath });
  return getDb().prepare(`
    SELECT w.*, p.name AS product_name, u.full_name AS recorded_by_name
    FROM recipe_waste_logs w
    JOIN products p ON p.id = w.product_id
    LEFT JOIN users u ON u.id = w.recorded_by
    WHERE w.id = ?
  `).get(wasteId);
}

function listRecipeWaste(filters = {}, actor) {
  canAccessRecipeModule(actor);
  ensureRecipeWastePhotoSchema();
  let sql = `
    SELECT w.*, p.name AS product_name, u.full_name AS recorded_by_name,
      rp.name AS meal_name, rp.id AS linked_recipe_id
    FROM recipe_waste_logs w
    JOIN products p ON p.id = w.product_id
    LEFT JOIN users u ON u.id = w.recorded_by
    LEFT JOIN recipe_profiles rp ON rp.id = w.recipe_profile_id
    WHERE 1=1
  `;
  const params = [];
  if (filters.status) { sql += ' AND w.status = ?'; params.push(filters.status); }
  if (filters.from) { sql += ' AND date(w.created_at) >= ?'; params.push(filters.from); }
  sql += ' ORDER BY w.created_at DESC LIMIT 200';
  return getDb().prepare(sql).all(...params);
}

function approveRecipeWaste(id, actor) {
  requireRecipePerm(actor, 'waste_approve');
  const store = require('./store');
  const row = getDb().prepare('SELECT * FROM recipe_waste_logs WHERE id = ?').get(id);
  if (!row) throw new Error('Waste record not found');
  if (row.status !== 'pending') throw new Error('Already processed');
  getDb().prepare(`UPDATE recipe_waste_logs SET status='approved', approved_by=?, approved_at=datetime('now') WHERE id=?`)
    .run(actor?.id || null, id);
  store.adjustStock(row.product_id, row.quantity, 'remove', `Recipe waste #${id}: ${row.waste_type}`, actor?.id, 'recipe_waste', id);
  logActivity(actor, 'approve_waste', 'recipe_waste', id, null, null);
  return getDb().prepare('SELECT w.*, p.name AS product_name FROM recipe_waste_logs w JOIN products p ON p.id = w.product_id WHERE w.id = ?').get(id);
}

function rejectRecipeWaste(id, actor) {
  requireRecipePerm(actor, 'waste_approve');
  getDb().prepare(`UPDATE recipe_waste_logs SET status='rejected', approved_by=?, approved_at=datetime('now') WHERE id=?`)
    .run(actor?.id || null, id);
  return true;
}

function updateRecipeWaste(id, data, actor) {
  requireRecipePerm(actor, 'produce');
  ensureRecipeWastePhotoSchema();
  const row = getDb().prepare('SELECT * FROM recipe_waste_logs WHERE id = ?').get(id);
  if (!row) throw new Error('Waste record not found');
  if (row.status !== 'pending') throw new Error('Only pending waste requests can be edited');
  const productId = data.product_id != null ? Number(data.product_id) : row.product_id;
  const p = getDb().prepare('SELECT * FROM products WHERE id = ?').get(productId);
  if (!p) throw new Error('Product not found');
  const qty = data.quantity != null ? Number(data.quantity) : Number(row.quantity);
  if (!(qty > 0)) throw new Error('Quantity required');
  const cost = qty * (p.buying_price || 0);
  let photoPath = row.photo_path || null;
  const photoSrc = data.photo_path || data.photo_image || data.proof_image || null;
  if (photoSrc) {
    photoPath = saveRecipeWastePhoto(photoSrc, id) || photoPath;
  }
  if (!photoPath) throw new Error('Photo of the wasted item is required');
  getDb().prepare(`
    UPDATE recipe_waste_logs SET waste_type=?, product_id=?, recipe_profile_id=?, quantity=?, unit=?, cost=?, reason=?, photo_path=?
    WHERE id=?
  `).run(
    data.waste_type || row.waste_type || 'other',
    productId,
    data.recipe_profile_id != null ? (Number(data.recipe_profile_id) || null) : row.recipe_profile_id,
    qty,
    data.unit || row.unit || p.stock_unit || p.unit,
    cost,
    data.reason != null ? data.reason : row.reason,
    photoPath,
    id
  );
  logActivity(actor, 'update_waste', 'recipe_waste', id, row, data);
  return getDb().prepare(`
    SELECT w.*, p.name AS product_name, u.full_name AS recorded_by_name
    FROM recipe_waste_logs w
    JOIN products p ON p.id = w.product_id
    LEFT JOIN users u ON u.id = w.recorded_by
    WHERE w.id = ?
  `).get(id);
}

function deleteRecipeWaste(id, actor) {
  const user = canAccessRecipeModule(actor);
  const row = getDb().prepare('SELECT * FROM recipe_waste_logs WHERE id = ?').get(id);
  if (!row) throw new Error('Waste record not found');
  const canAdmin = user.role === 'owner' || user.role === 'manager' || user.recipe_role === 'administrator';
  if (row.status !== 'pending' && !canAdmin) {
    throw new Error('Only pending waste can be deleted (or ask an admin)');
  }
  if (row.status === 'pending' && !canAdmin) {
    requireRecipePerm(actor, 'produce');
  }
  getDb().prepare('DELETE FROM recipe_waste_logs WHERE id = ?').run(id);
  logActivity(actor, 'delete_waste', 'recipe_waste', id, row, null);
  return true;
}

/** Ensure a meal's BOM is linked to an approved recipe_profile for Production / Approvals. */
function ensureApprovedProfileForMeal(productId, actor, { autoApprove = false } = {}) {
  requireRecipePerm(actor, 'produce');
  const product = getDb().prepare('SELECT * FROM products WHERE id = ?').get(productId);
  if (!product) throw new Error('Meal not found');
  const items = inventory.getProductRecipe(productId);
  if (!items.length) throw new Error('Save meal ingredients in Recipe Builder first');
  let profile = getDb().prepare('SELECT * FROM recipe_profiles WHERE product_id = ? ORDER BY id DESC LIMIT 1').get(productId);
  const payload = {
    product_id: productId,
    name: product.name,
    production_mode: product.production_mode === 'make_to_stock' ? 'make_to_stock' : 'make_to_order',
    items: items.map(i => ({
      ingredient_product_id: i.ingredient_product_id,
      quantity: i.quantity,
      unit: i.unit,
      waste_pct: i.waste_pct || 0,
      include_rule: i.include_rule || 'always',
      option_name: i.option_name || null,
      is_primary: !!i.is_primary
    })),
    id: profile?.id,
    bump_version: false,
    status: profile?.status || 'draft'
  };
  try {
    saveRecipe(payload, actor);
  } catch (_) { /* profile may already exist */ }
  profile = getDb().prepare('SELECT * FROM recipe_profiles WHERE product_id = ? ORDER BY id DESC LIMIT 1').get(productId);
  if (!profile) throw new Error('Could not create recipe profile for this meal');
  if (profile.status === 'approved') return getRecipeWithItems(profile.id);
  if (autoApprove || actor?.role === 'owner' || actor?.role === 'manager') {
    try {
      if (['draft', 'rejected'].includes(profile.status)) submitRecipeForApproval(profile.id, actor);
    } catch (_) { /* may already be pending */ }
    try {
      if (getDb().prepare('SELECT status FROM recipe_profiles WHERE id=?').get(profile.id)?.status === 'pending') {
        approveRecipe(profile.id, actor);
      } else if (getDb().prepare('SELECT status FROM recipe_profiles WHERE id=?').get(profile.id)?.status !== 'approved') {
        getDb().prepare(`UPDATE recipe_profiles SET status='approved', approved_by=?, approved_at=datetime('now') WHERE id=?`)
          .run(actor?.id || null, profile.id);
      }
    } catch (err) {
      // If user cannot approve, leave as pending for Approvals page
      if (['draft', 'rejected'].includes(profile.status)) {
        try { submitRecipeForApproval(profile.id, actor); } catch (_) {}
      }
      throw new Error(err.message || 'Meal needs Recipe Approval before production');
    }
  } else if (['draft', 'rejected'].includes(profile.status)) {
    submitRecipeForApproval(profile.id, actor);
    throw new Error('Meal submitted for approval — approve it under Approvals, then produce');
  } else if (profile.status === 'pending') {
    throw new Error('Meal is pending approval — approve it under Approvals, then produce');
  }
  return getRecipeWithItems(profile.id);
}

function listProductionMeals(actor, filters = {}) {
  canAccessRecipeModule(actor);
  const scope = resolveRecipeBranchScope(actor, filters || {});
  let profileSql = `
    SELECT r.id, r.name, r.status, r.product_id, r.recipe_cost, r.production_mode, r.branch_id, p.name AS product_name
    FROM recipe_profiles r
    LEFT JOIN products p ON p.id = r.product_id
    WHERE r.status = 'approved'
  `;
  const profileParams = [];
  if (!scope.allBranches) {
    profileSql += ' AND r.branch_id = ?';
    profileParams.push(scope.branchId);
  }
  profileSql += ' ORDER BY r.name COLLATE NOCASE';
  const profiles = getDb().prepare(profileSql).all(...profileParams);

  let mealSql = `
    SELECT p.id AS product_id, p.name, p.production_mode, p.recipe_cost, p.has_recipe,
      (SELECT id FROM recipe_profiles rp WHERE rp.product_id = p.id
        ${scope.allBranches ? '' : 'AND rp.branch_id = ?'}
        ORDER BY rp.id DESC LIMIT 1) AS profile_id,
      (SELECT status FROM recipe_profiles rp WHERE rp.product_id = p.id
        ${scope.allBranches ? '' : 'AND rp.branch_id = ?'}
        ORDER BY rp.id DESC LIMIT 1) AS profile_status
    FROM products p
    WHERE p.is_active=1 AND p.has_recipe=1
      AND (p.item_type IS NULL OR p.item_type != 'ingredient')
    ORDER BY p.name COLLATE NOCASE
  `;
  const mealParams = [];
  if (!scope.allBranches) mealParams.push(scope.branchId, scope.branchId);
  const meals = getDb().prepare(mealSql).all(...mealParams);
  return { approved_profiles: profiles, meals, branch_id: scope.branchId, all_branches: scope.allBranches };
}

function getIngredientStockHistory(filters = {}, actor) {
  canAccessRecipeModule(actor);
  const from = filters.from || null;
  const to = filters.to || null;
  const productId = filters.product_id ? Number(filters.product_id) : null;
  let sql = `
    SELECT sm.*, p.name AS product_name, p.stock_quantity AS stock_left,
      p.stock_unit, p.unit, u.full_name AS user_name
    FROM stock_movements sm
    JOIN products p ON p.id = sm.product_id
    LEFT JOIN users u ON u.id = sm.user_id
    WHERE (p.item_type = 'ingredient' OR EXISTS (
      SELECT 1 FROM product_recipe_items pri WHERE pri.ingredient_product_id = p.id
    ))
  `;
  const params = [];
  if (productId) { sql += ' AND sm.product_id = ?'; params.push(productId); }
  if (from) { sql += ' AND date(sm.created_at) >= date(?)'; params.push(from); }
  if (to) { sql += ' AND date(sm.created_at) <= date(?)'; params.push(to); }
  sql += ' ORDER BY sm.created_at DESC LIMIT 500';
  const rows = getDb().prepare(sql).all(...params);
  const usedTypes = new Set(['sale', 'remove', 'production', 'recipe_waste', 'waste']);
  const summaryMap = {};
  for (const r of rows) {
    const key = r.product_id;
    if (!summaryMap[key]) {
      summaryMap[key] = {
        product_id: r.product_id,
        product_name: r.product_name,
        stock_left: r.stock_left,
        unit: r.stock_unit || r.unit || 'each',
        qty_used: 0,
        qty_added: 0,
        movements: 0
      };
    }
    summaryMap[key].movements++;
    const q = Number(r.quantity) || 0;
    if (usedTypes.has(r.movement_type) || usedTypes.has(r.reference_type)) {
      summaryMap[key].qty_used += q;
    } else {
      summaryMap[key].qty_added += q;
    }
  }
  return { from, to, movements: rows, summary: Object.values(summaryMap) };
}

function getProfitsLosses(filters = {}, actor) {
  canAccessRecipeModule(actor);
  const from = filters.from || today();
  const to = filters.to || today();
  const meals = getRecipeReports('meal_profit', { ...filters, from, to }, actor) || [];
  const ingredients = getDb().prepare(`
    SELECT p.id, p.name, p.buying_price, p.stock_quantity, p.stock_unit, p.unit,
      COALESCE((
        SELECT SUM(sm.quantity) FROM stock_movements sm
        WHERE sm.product_id = p.id AND date(sm.created_at) BETWEEN date(?) AND date(?)
          AND sm.movement_type IN ('sale','remove')
      ), 0) AS qty_used,
      COALESCE((
        SELECT SUM(sm.quantity) FROM stock_movements sm
        WHERE sm.product_id = p.id AND date(sm.created_at) BETWEEN date(?) AND date(?)
          AND sm.movement_type IN ('purchase','add','return')
      ), 0) AS qty_added
    FROM products p
    WHERE p.is_active=1 AND (
      p.item_type = 'ingredient' OR EXISTS (
        SELECT 1 FROM product_recipe_items pri WHERE pri.ingredient_product_id = p.id
      )
    )
    ORDER BY p.name COLLATE NOCASE
  `).all(from, to, from, to).map(p => {
    const used = Number(p.qty_used) || 0;
    const costUsed = used * (Number(p.buying_price) || 0);
    return {
      ...p,
      qty_used: used,
      cost_of_usage: Math.round(costUsed * 100) / 100,
      estimated_line_value: Math.round((Number(p.stock_quantity) || 0) * (Number(p.buying_price) || 0) * 100) / 100
    };
  });
  const waste = getDb().prepare(`
    SELECT w.*, p.name AS product_name FROM recipe_waste_logs w
    JOIN products p ON p.id = w.product_id
    WHERE date(w.created_at) BETWEEN date(?) AND date(?)
    ORDER BY w.created_at DESC LIMIT 200
  `).all(from, to);
  const wasteLoss = waste.filter(w => w.status === 'approved').reduce((s, w) => s + (Number(w.cost) || 0), 0);
  const mealProfitTotal = (Array.isArray(meals) ? meals : []).reduce((s, m) => s + (Number(m.profit_per_meal) || 0), 0);
  const ingredientUsageCost = ingredients.reduce((s, i) => s + (Number(i.cost_of_usage) || 0), 0);
  return {
    from,
    to,
    meals,
    ingredients,
    waste,
    totals: {
      meal_profit_per_unit_sum: Math.round(mealProfitTotal * 100) / 100,
      ingredient_usage_cost: Math.round(ingredientUsageCost * 100) / 100,
      waste_loss: Math.round(wasteLoss * 100) / 100,
      net_estimate: Math.round((mealProfitTotal - wasteLoss) * 100) / 100
    }
  };
}

function listRecipePurchaseOrders(filters = {}, actor) {
  canAccessRecipeModule(actor);
  const store = require('./store');
  const list = store.getPurchaseOrders() || [];
  const recipeOnly = filters.all
    ? list
    : list.filter(po => /recipe/i.test(po.notes || '') || /restock/i.test(po.notes || ''));
  return recipeOnly.slice(0, filters.limit || 100);
}

/* ─── Promotions ─────────────────────────────────────────────────────────── */

function listRecipePromotions(actor) {
  canAccessRecipeModule(actor);
  return getDb().prepare('SELECT * FROM recipe_promotions ORDER BY created_at DESC LIMIT 100').all();
}

function saveRecipePromotion(data, actor) {
  requireRecipePerm(actor, 'promotions');
  const db = getDb();
  const payload = {
    name: (data.name || '').trim(),
    promo_type: data.promo_type || 'percent',
    discount_value: Number(data.discount_value) || 0,
    start_date: data.start_date || null,
    end_date: data.end_date || null,
    start_time: data.start_time || null,
    end_time: data.end_time || null,
    product_ids_json: JSON.stringify(data.product_ids || []),
    recipe_ids_json: JSON.stringify(data.recipe_ids || []),
    branch_ids_json: JSON.stringify(data.branch_ids || []),
    customer_groups_json: JSON.stringify(data.customer_groups || []),
    status: data.status || 'active'
  };
  if (!payload.name) throw new Error('Promotion name required');
  if (data.id) {
    db.prepare(`
      UPDATE recipe_promotions SET name=?, promo_type=?, discount_value=?, start_date=?, end_date=?,
        start_time=?, end_time=?, product_ids_json=?, recipe_ids_json=?, branch_ids_json=?,
        customer_groups_json=?, status=?, updated_at=datetime('now') WHERE id=?
    `).run(
      payload.name, payload.promo_type, payload.discount_value, payload.start_date, payload.end_date,
      payload.start_time, payload.end_time, payload.product_ids_json, payload.recipe_ids_json, payload.branch_ids_json,
      payload.customer_groups_json, payload.status, data.id
    );
    logActivity(actor, 'update_promotion', 'recipe_promo', data.id, null, payload);
    return db.prepare('SELECT * FROM recipe_promotions WHERE id = ?').get(data.id);
  }
  const r = db.prepare(`
    INSERT INTO recipe_promotions (
      name, promo_type, discount_value, start_date, end_date, start_time, end_time,
      product_ids_json, recipe_ids_json, branch_ids_json, customer_groups_json, status, created_by
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    payload.name, payload.promo_type, payload.discount_value, payload.start_date, payload.end_date,
    payload.start_time, payload.end_time, payload.product_ids_json, payload.recipe_ids_json,
    payload.branch_ids_json, payload.customer_groups_json, payload.status, actor?.id || null
  );
  logActivity(actor, 'create_promotion', 'recipe_promo', r.lastInsertRowid, null, payload);
  return db.prepare('SELECT * FROM recipe_promotions WHERE id = ?').get(r.lastInsertRowid);
}

/* ─── Dashboard / Reports / AI ───────────────────────────────────────────── */

function getRecipeDashboard(actor) {
  canAccessRecipeModule(actor);
  const db = getDb();
  const t = today();
  const softGet = (sql, params = [], fallback = null) => {
    try { return db.prepare(sql).get(...params); }
    catch (e) { console.warn('[recipe-dashboard]', e.message || e); return fallback; }
  };
  const softAll = (sql, params = [], fallback = []) => {
    try { return db.prepare(sql).all(...params); }
    catch (e) { console.warn('[recipe-dashboard]', e.message || e); return fallback; }
  };

  // Single worker round-trip: KPIs + lists + production meal/ingredient rows.
  const dashQueries = [
    {
      method: 'get',
      sql: `SELECT
        (SELECT COALESCE(SUM(produced_qty),0) FROM production_batches
          WHERE status='completed' AND date(completed_at)=?) AS produced_qty,
        (SELECT COUNT(*) FROM production_batches
          WHERE status='completed' AND date(completed_at)=?) AS produced_batches,
        (SELECT COALESCE(SUM(si.quantity),0) FROM sale_items si
          JOIN sales s ON s.id = si.sale_id
          JOIN recipe_profiles r ON r.product_id = si.product_id
          WHERE s.status='completed' AND date(s.created_at)=?) AS sold_qty,
        (SELECT COUNT(*) FROM recipe_profiles WHERE status='pending') AS recipes_pending,
        (SELECT COUNT(*) FROM recipe_profiles) AS recipes_created,
        (SELECT COALESCE(SUM(cost),0) FROM recipe_waste_logs WHERE date(created_at)=?) AS waste_cost,
        (SELECT COALESCE(SUM(quantity),0) FROM recipe_waste_logs WHERE date(created_at)=?) AS waste_qty,
        (SELECT COUNT(*) FROM products WHERE is_active=1 AND stock_quantity <= COALESCE(min_stock,5)) AS low_stock,
        (SELECT COUNT(*) FROM products WHERE is_active=1 AND stock_quantity <= 0) AS out_of_stock,
        (SELECT COUNT(*) FROM recipe_promotions WHERE status='active') AS active_promotions`,
      params: [t, t, t, t, t]
    },
    {
      method: 'all',
      sql: `SELECT si.product_id, MAX(si.product_name) AS product_name, SUM(si.quantity) AS sold, SUM(si.total) AS revenue
            FROM sale_items si JOIN sales s ON s.id = si.sale_id
            JOIN recipe_profiles r ON r.product_id = si.product_id
            WHERE s.status='completed' AND date(s.created_at) >= date('now','-30 day')
            GROUP BY si.product_id ORDER BY sold DESC LIMIT 5`,
      params: []
    },
    {
      method: 'all',
      sql: `SELECT id, name, profit_margin, selling_price, recipe_cost FROM recipe_profiles
            WHERE status='approved' ORDER BY profit_margin DESC LIMIT 5`,
      params: []
    },
    {
      method: 'all',
      sql: `SELECT id, name, profit_margin, selling_price, recipe_cost, food_cost_pct FROM recipe_profiles
            WHERE status='approved' ORDER BY profit_margin ASC LIMIT 5`,
      params: []
    },
    {
      method: 'all',
      sql: `SELECT id, user_id, user_name, action, entity_type, entity_id, created_at
            FROM recipe_activity_log ORDER BY created_at DESC LIMIT 15`,
      params: []
    },
    {
      method: 'all',
      sql: `SELECT id, name, production_mode, stock_quantity, has_recipe,
              production_capacity, limiting_ingredient_id, limiting_ingredient_name,
              production_oos, production_oos_reason, production_breakdown_json,
              production_capacity_updated_at
            FROM products
            WHERE is_active = 1
              AND (has_recipe = 1 OR id IN (SELECT DISTINCT product_id FROM product_recipe_items))
              AND (item_type IS NULL OR item_type != 'ingredient')`,
      params: []
    },
    {
      method: 'all',
      sql: `SELECT id, name, stock_quantity, stock_unit, unit, min_stock,
              CASE WHEN stock_quantity <= 0 THEN 1 ELSE 0 END AS is_out
            FROM products
            WHERE is_active = 1
              AND (
                item_type = 'ingredient'
                OR id IN (SELECT ingredient_product_id FROM product_recipe_items)
              )
              AND stock_quantity <= COALESCE(NULLIF(min_stock, 0), 5)
            ORDER BY stock_quantity ASC, name
            LIMIT 80`,
      params: []
    }
  ];

  let kpis = {};
  let bestSellers = [];
  let highProfit = [];
  let lowProfit = [];
  let activity = [];
  let mealRows = [];
  let ingredientRows = [];
  try {
    if (typeof db.batch === 'function') {
      const packed = db.batch(dashQueries);
      kpis = packed[0] || {};
      bestSellers = packed[1] || [];
      highProfit = packed[2] || [];
      lowProfit = packed[3] || [];
      activity = packed[4] || [];
      mealRows = packed[5] || [];
      ingredientRows = packed[6] || [];
    } else {
      throw new Error('no-batch');
    }
  } catch (_) {
    kpis = softGet(dashQueries[0].sql, dashQueries[0].params, {}) || {};
    bestSellers = softAll(dashQueries[1].sql, dashQueries[1].params, []);
    highProfit = softAll(dashQueries[2].sql, dashQueries[2].params, []);
    lowProfit = softAll(dashQueries[3].sql, dashQueries[3].params, []);
    activity = softAll(dashQueries[4].sql, dashQueries[4].params, []);
    mealRows = softAll(dashQueries[5].sql, dashQueries[5].params, []);
    ingredientRows = softAll(dashQueries[6].sql, dashQueries[6].params, []);
  }

  let production = null;
  try {
    production = require('./production-availability').getLiveProductionDashboard({
      mealRows,
      ingredientRows,
      // Prefer cached capacity columns; avoid N refresh queries on every open.
      maxAgeMs: 5 * 60 * 1000
    });
  } catch (e) {
    console.warn('[recipe-dashboard] production', e.message || e);
  }

  const capacitySamples = (production?.products || []).slice(0, 8).map((p) => ({
    id: p.product_id,
    name: p.name,
    max_meals: p.available_meals,
    limiting_ingredient: p.limiting_ingredient,
    recipe_id: null,
    breakdown: p.remaining_by_ingredient || []
  }));

  return {
    produced_today: { qty: kpis?.produced_qty || 0, batches: kpis?.produced_batches || 0 },
    sold_today: { qty: kpis?.sold_qty || 0 },
    recipes_created: kpis?.recipes_created || 0,
    recipes_pending: kpis?.recipes_pending || 0,
    waste_today: { cost: kpis?.waste_cost || 0, qty: kpis?.waste_qty || 0 },
    low_stock: kpis?.low_stock || 0,
    out_of_stock: kpis?.out_of_stock || 0,
    active_promotions: kpis?.active_promotions || 0,
    best_sellers: bestSellers || [],
    highest_profit: highProfit || [],
    lowest_profit: lowProfit || [],
    capacity: capacitySamples,
    production,
    recent_activity: activity || []
  };
}

function getRecipeReports(type, filters = {}, actor) {
  const perm = requireRecipePerm(actor, 'reports');
  const db = getDb();
  const from = filters.from || today();
  const to = filters.to || today();

  if (type === 'recipe_cost' || type === 'food_cost') {
    return listRecipes({ status: 'approved' }, actor).map(r => {
      const full = getRecipeWithItems(r.id);
      return {
        id: r.id,
        name: r.name,
        recipe_cost: full?.costing?.recipe_cost ?? r.recipe_cost,
        selling_price: full?.costing?.selling_price ?? r.selling_price,
        food_cost_pct: full?.costing?.food_cost_pct ?? r.food_cost_pct,
        gross_profit: full?.costing?.gross_profit ?? r.gross_profit,
        profit_margin: full?.costing?.profit_margin ?? r.profit_margin,
        markup_pct: full?.costing?.markup_pct,
        status: r.status
      };
    });
  }
  if (type === 'production') {
    return listProductionBatches({ from, to }, actor);
  }
  if (type === 'waste') {
    return listRecipeWaste({ from, to }, actor);
  }
  if (type === 'profit' || type === 'margin' || type === 'most_profitable' || type === 'least_profitable') {
    const order = type === 'least_profitable' ? 'ASC' : 'DESC';
    return db.prepare(`
      SELECT id, name, recipe_cost, selling_price, food_cost_pct, gross_profit, profit_margin, status
      FROM recipe_profiles WHERE status IN ('approved','pending')
      ORDER BY profit_margin ${order}
    `).all();
  }
  if (type === 'best_sellers') {
    return db.prepare(`
      SELECT si.product_id, MAX(si.product_name) AS product_name, SUM(si.quantity) AS sold, SUM(si.total) AS revenue
      FROM sale_items si JOIN sales s ON s.id = si.sale_id
      WHERE s.status='completed' AND date(s.created_at) BETWEEN ? AND ?
      GROUP BY si.product_id ORDER BY sold DESC LIMIT 50
    `).all(from, to);
  }
  if (type === 'daily_item_profits' || type === 'item_profits_daily') {
    const day = filters.day || filters.date || from || today();
    const dayEnd = filters.day_to || filters.to || day;
    const sold = db.prepare(`
      SELECT si.product_id, MAX(si.product_name) AS meal,
        SUM(si.quantity) AS qty_sold,
        SUM(si.total) AS revenue,
        AVG(si.unit_price) AS avg_sell_price,
        MAX(p.selling_price) AS selling_price,
        MAX(p.buying_price) AS buying_price,
        MAX(p.has_recipe) AS has_recipe,
        MAX(p.recipe_cost) AS recipe_cost,
        MAX(c.name) AS category_name
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      LEFT JOIN products p ON p.id = si.product_id
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE s.status='completed' AND date(s.created_at) BETWEEN ? AND ?
      GROUP BY si.product_id
      ORDER BY revenue DESC
    `).all(day, dayEnd);
    return sold.map((row) => {
      let unitCost = Number(row.recipe_cost) || 0;
      let unitSell = Number(row.avg_sell_price) || Number(row.selling_price) || 0;
      let source = row.has_recipe ? 'recipe' : 'product';
      if (row.has_recipe) {
        try {
          const costing = computeRecipeCosting(inventory.getProductRecipe(row.product_id), {
            price_mode: 'profit_pct',
            target_profit_pct: 40,
            override_price: unitSell || row.selling_price
          });
          unitCost = Number(costing.recipe_cost) || unitCost;
          if (!unitSell) unitSell = Number(costing.selling_price) || unitSell;
          source = 'recipe_costing';
        } catch (_) {
          if (!unitCost && row.buying_price != null) {
            unitCost = Number(row.buying_price) || 0;
            source = 'buying_price';
          }
        }
      } else if (row.buying_price != null) {
        unitCost = Number(row.buying_price) || 0;
        source = 'buying_price';
      }
      const qty = Number(row.qty_sold) || 0;
      const revenue = Math.round((Number(row.revenue) || 0) * 100) / 100;
      const totalCost = Math.round(unitCost * qty * 100) / 100;
      const profit = Math.round((revenue - totalCost) * 100) / 100;
      const margin = revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : 0;
      return {
        day: day === dayEnd ? day : `${day} → ${dayEnd}`,
        product_id: row.product_id,
        meal: row.meal,
        category: row.category_name || '—',
        qty_sold: qty,
        unit_sell: Math.round(unitSell * 100) / 100,
        unit_cost: Math.round(unitCost * 100) / 100,
        revenue,
        total_cost: totalCost,
        profit,
        profit_margin_pct: margin,
        cost_source: source
      };
    });
  }
  if (type === 'sales_by_recipe') {
    return db.prepare(`
      SELECT r.id AS recipe_id, r.name AS recipe_name, si.product_id,
        SUM(si.quantity) AS sold, SUM(si.total) AS revenue,
        SUM(si.quantity * COALESCE(r.recipe_cost,0)) AS estimated_cost
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      JOIN recipe_profiles r ON r.product_id = si.product_id
      WHERE s.status='completed' AND date(s.created_at) BETWEEN ? AND ?
      GROUP BY r.id ORDER BY sold DESC
    `).all(from, to);
  }
  if (type === 'ingredient_usage' || type === 'inventory_consumption') {
    return db.prepare(`
      SELECT p.name, SUM(i.quantity) AS qty_used, SUM(i.line_cost) AS cost, p.stock_quantity AS current_stock
      FROM production_batch_items i
      JOIN production_batches b ON b.id = i.batch_id
      JOIN products p ON p.id = i.ingredient_product_id
      WHERE b.status='completed' AND date(b.completed_at) BETWEEN ? AND ?
      GROUP BY i.ingredient_product_id ORDER BY cost DESC
    `).all(from, to);
  }
  if (type === 'capacity' || type === 'production_capacity') {
    return listRecipes({ status: 'approved' }, actor).slice(0, 40).map(r => {
      try {
        const cap = calcProductionCapacity(r.id, actor);
        return { recipe_id: r.id, name: r.name, max_meals: cap.max_meals, limiting_ingredient: cap.limiting_ingredient, breakdown: cap.breakdown };
      } catch (e) {
        return { recipe_id: r.id, name: r.name, error: e.message };
      }
    });
  }
  if (type === 'restock') {
    const approved = listRecipes({ status: 'approved' }, actor);
    return approved.slice(0, 20).map(r => smartRestock(r.id, filters.target_qty || 50, actor));
  }
  if (type === 'promotions' || type === 'promo_performance') {
    const promos = listRecipePromotions(actor);
    return promos.map(p => {
      let productIds = [];
      try { productIds = JSON.parse(p.product_ids_json || '[]'); } catch (_) {}
      let sold = 0;
      let revenue = 0;
      if (productIds.length) {
        const ph = productIds.map(() => '?').join(',');
        const row = db.prepare(`
          SELECT COALESCE(SUM(si.quantity),0) AS sold, COALESCE(SUM(si.total),0) AS revenue
          FROM sale_items si JOIN sales s ON s.id = si.sale_id
          WHERE s.status='completed' AND si.product_id IN (${ph})
            AND date(s.created_at) BETWEEN ? AND ?
        `).get(...productIds, p.start_date || from, p.end_date || to);
        sold = row?.sold || 0;
        revenue = row?.revenue || 0;
      }
      return { ...p, sold, revenue };
    });
  }
  if (type === 'slow_movers') {
    return db.prepare(`
      SELECT p.id, p.name, p.selling_price, p.stock_quantity,
        COALESCE(SUM(CASE WHEN date(s.created_at) BETWEEN ? AND ? THEN si.quantity ELSE 0 END),0) AS sold
      FROM products p
      LEFT JOIN sale_items si ON si.product_id = p.id
      LEFT JOIN sales s ON s.id = si.sale_id AND s.status='completed'
      WHERE p.is_active=1 AND p.has_recipe=1
      GROUP BY p.id
      HAVING sold < 5
      ORDER BY sold ASC, p.stock_quantity DESC
      LIMIT 50
    `).all(from, to);
  }
  // Meal profit: cost to make (from ingredient buy prices) vs sell price vs desired profit
  if (type === 'meal_profit' || type === 'meal_cost_profit') {
    const meals = db.prepare(`
      SELECT p.id, p.name, p.selling_price, p.recipe_cost, p.food_cost_pct, p.gross_profit, p.profit_margin,
        c.name AS category_name
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.is_active=1 AND p.has_recipe=1
        AND (p.item_type IS NULL OR p.item_type != 'ingredient')
      ORDER BY p.name COLLATE NOCASE
    `).all();
    const targetPct = Number(filters.target_profit_pct) || 40;
    return meals.map(m => {
      const costing = computeRecipeCosting(inventory.getProductRecipe(m.id), {
        price_mode: 'profit_pct',
        target_profit_pct: targetPct,
        override_price: m.selling_price
      });
      return {
        meal: m.name,
        category: m.category_name || '—',
        cost_to_make: costing.recipe_cost,
        you_sell_for: costing.selling_price,
        profit_per_meal: costing.gross_profit,
        profit_margin_pct: costing.profit_margin,
        food_cost_pct: costing.food_cost_pct,
        suggested_sell_for_target_profit: costing.suggested_price,
        target_profit_pct: targetPct,
        ingredients: (costing.lines || []).map(l =>
          `${l.ingredient_name}: ${l.quantity} ${l.unit} (${l.cost_used})`
        ).join('; ')
      };
    });
  }
  if (type === 'modifier_costing' || type === 'option_costing') {
    return getModifierCostingReport(actor, filters);
  }
  return { type, from, to, note: 'Report type not recognized', limited: perm === 'limited' };
}

function nowTime() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function isPromoActiveNow(p) {
  if (!p || p.status !== 'active') return false;
  const t = today();
  if (p.start_date && p.start_date > t) return false;
  if (p.end_date && p.end_date < t) return false;
  const tm = nowTime();
  if (p.start_time && p.end_time) {
    if (tm < p.start_time || tm > p.end_time) return false;
  }
  return true;
}

/** Apply active Recipe promotions onto POS product prices (after POS promo requests). */
function applyRecipePromoPricesToProducts(products, preloaded) {
  if (!products?.length) return products || [];
  const promos = (preloaded?.promos
    ? preloaded.promos
    : getDb().prepare(`SELECT * FROM recipe_promotions WHERE status='active'`).all()
  ).filter(isPromoActiveNow);
  if (!promos.length) return products;

  let recipeProductMap = preloaded?.recipeProductMap || null;
  if (!recipeProductMap) {
    recipeProductMap = {};
    getDb().prepare(`SELECT id, product_id FROM recipe_profiles WHERE product_id IS NOT NULL`).all()
      .forEach(r => { recipeProductMap[r.id] = r.product_id; });
  }

  return products.map(p => {
    if (p.promo_active) return p; // POS promo request wins
    for (const promo of promos) {
      let productIds = [];
      let recipeIds = [];
      try { productIds = JSON.parse(promo.product_ids_json || '[]'); } catch (_) {}
      try { recipeIds = JSON.parse(promo.recipe_ids_json || '[]'); } catch (_) {}
      const fromRecipes = recipeIds.map(id => recipeProductMap[id]).filter(Boolean);
      const targets = new Set([...productIds, ...fromRecipes].map(Number));
      if (!targets.has(Number(p.id))) continue;

      const original = Number(p.selling_price) || 0;
      let price = original;
      if (promo.promo_type === 'percent') {
        price = original * (1 - (Number(promo.discount_value) || 0) / 100);
      } else if (promo.promo_type === 'fixed') {
        price = Number(promo.discount_value) || original;
      } else if (promo.promo_type === 'bogo') {
        // price unchanged; flagged for cart logic — still mark promo
        price = original;
      } else {
        price = original * (1 - (Number(promo.discount_value) || 0) / 100);
      }
      price = Math.round(Math.max(0, price) * 100) / 100;
      return {
        ...p,
        selling_price: price,
        original_price: original,
        promo_active: true,
        recipe_promo_id: promo.id,
        recipe_promo_type: promo.promo_type,
        promo_end_date: promo.end_date
      };
    }
    return p;
  });
}

function requestSubstitution(data, actor) {
  requireRecipePerm(actor, 'edit');
  if (!data?.from_product_id || !data?.to_product_id) throw new Error('from_product_id and to_product_id required');
  const r = getDb().prepare(`
    INSERT INTO recipe_substitutions (recipe_profile_id, from_product_id, to_product_id, quantity, unit, reason, status, requested_by)
    VALUES (?,?,?,?,?,?, 'pending', ?)
  `).run(
    data.recipe_profile_id || null,
    data.from_product_id,
    data.to_product_id,
    data.quantity || null,
    data.unit || null,
    data.reason || null,
    actor?.id || null
  );
  logActivity(actor, 'request_substitution', 'recipe_substitution', r.lastInsertRowid, null, data);
  return getDb().prepare(`
    SELECT s.*, pf.name AS from_name, pt.name AS to_name
    FROM recipe_substitutions s
    JOIN products pf ON pf.id = s.from_product_id
    JOIN products pt ON pt.id = s.to_product_id
    WHERE s.id = ?
  `).get(r.lastInsertRowid);
}

function listSubstitutions(filters = {}, actor) {
  canAccessRecipeModule(actor);
  let sql = `
    SELECT s.*, pf.name AS from_name, pt.name AS to_name, r.name AS recipe_name
    FROM recipe_substitutions s
    JOIN products pf ON pf.id = s.from_product_id
    JOIN products pt ON pt.id = s.to_product_id
    LEFT JOIN recipe_profiles r ON r.id = s.recipe_profile_id
    WHERE 1=1
  `;
  const params = [];
  if (filters.status) { sql += ' AND s.status = ?'; params.push(filters.status); }
  sql += ' ORDER BY s.created_at DESC LIMIT 100';
  return getDb().prepare(sql).all(...params);
}

function approveSubstitution(id, actor) {
  requireRecipePerm(actor, 'approve');
  const row = getDb().prepare('SELECT * FROM recipe_substitutions WHERE id = ?').get(id);
  if (!row) throw new Error('Substitution not found');
  if (row.status !== 'pending') throw new Error('Already processed');

  if (row.recipe_profile_id) {
    const recipe = getRecipeWithItems(row.recipe_profile_id);
    if (recipe?.product_id) {
      const items = (recipe.items || []).map(i => ({
        ingredient_product_id: Number(i.ingredient_product_id) === Number(row.from_product_id)
          ? row.to_product_id
          : i.ingredient_product_id,
        quantity: i.quantity,
        unit: i.unit || 'each',
        waste_pct: i.waste_pct || 0
      }));
      inventory.saveProductRecipe(recipe.product_id, items);
      inventory.updateProductRecipeMetrics(recipe.product_id, recipe.selling_price);
      saveRecipeSnapshot(row.recipe_profile_id, actor, `Substitution approved: ${row.from_product_id} → ${row.to_product_id}`);
    }
  }

  getDb().prepare(`
    UPDATE recipe_substitutions SET status='approved', approved_by=?, approved_at=datetime('now') WHERE id=?
  `).run(actor?.id || null, id);
  logActivity(actor, 'approve_substitution', 'recipe_substitution', id, null, null);
  return listSubstitutions({ status: 'approved' }, actor).find(s => s.id === id) || { id, status: 'approved' };
}

function rejectSubstitution(id, actor) {
  requireRecipePerm(actor, 'approve');
  getDb().prepare(`
    UPDATE recipe_substitutions SET status='rejected', approved_by=?, approved_at=datetime('now') WHERE id=?
  `).run(actor?.id || null, id);
  logActivity(actor, 'reject_substitution', 'recipe_substitution', id, null, null);
  return true;
}

function getStockForecast(actor, days = 14) {
  canAccessRecipeModule(actor);
  const db = getDb();
  const horizon = Number(days) || 14;
  const usage = db.prepare(`
    SELECT i.ingredient_product_id AS id, p.name, p.stock_quantity, p.min_stock, p.buying_price,
      SUM(i.quantity)/14.0 AS daily_use
    FROM production_batch_items i
    JOIN production_batches b ON b.id = i.batch_id
    JOIN products p ON p.id = i.ingredient_product_id
    WHERE b.status='completed' AND date(b.completed_at) >= date('now','-14 day')
    GROUP BY i.ingredient_product_id
    HAVING daily_use > 0
  `).all();
  return usage.map(u => {
    const need = u.daily_use * horizon;
    const have = Number(u.stock_quantity) || 0;
    const buy = Math.max(0, Math.ceil(need - have));
    const daysLeft = u.daily_use > 0 ? have / u.daily_use : 999;
    return {
      ...u,
      forecast_days: horizon,
      forecast_need: Math.round(need * 100) / 100,
      buy_qty: buy,
      days_left: Math.round(daysLeft * 10) / 10,
      est_cost: buy * (u.buying_price || 0)
    };
  }).sort((a, b) => a.days_left - b.days_left);
}

function getAiSuggestions(actor) {
  canAccessRecipeModule(actor);
  const db = getDb();
  const suggestions = [];

  const lowProfit = db.prepare(`
    SELECT id, product_id, name, recipe_cost, selling_price, food_cost_pct, profit_margin, target_profit_pct
    FROM recipe_profiles WHERE status='approved' AND (food_cost_pct > 35 OR profit_margin < 25)
    ORDER BY food_cost_pct DESC LIMIT 10
  `).all();
  for (const r of lowProfit) {
    const suggested = calcProfitFromCost(r.recipe_cost, 'profit_pct', r.target_profit_pct || 40, null);
    suggestions.push({
      type: 'price_review',
      severity: r.food_cost_pct > 40 ? 'high' : 'medium',
      recipe_id: r.id,
      product_id: r.product_id || null,
      title: `Review price for ${r.name}`,
      message: `Food cost ${r.food_cost_pct}% / margin ${r.profit_margin}%. Suggested sell price R${suggested.suggested_price.toFixed(2)} for ${r.target_profit_pct || 40}% profit on cost.`,
      suggested_price: suggested.suggested_price
    });
  }

  const lowStock = db.prepare(`
    SELECT id, name, stock_quantity, min_stock, buying_price FROM products
    WHERE is_active=1 AND stock_quantity <= COALESCE(min_stock,5) ORDER BY stock_quantity ASC LIMIT 10
  `).all();
  for (const p of lowStock) {
    suggestions.push({
      type: 'restock',
      severity: p.stock_quantity <= 0 ? 'high' : 'medium',
      product_id: p.id,
      title: `Restock ${p.name}`,
      message: `Stock ${p.stock_quantity} (min ${p.min_stock || 5}).`
    });
  }

  // Velocity runout: avg daily usage from production last 14 days
  const usage = db.prepare(`
    SELECT i.ingredient_product_id, p.name, p.stock_quantity,
      SUM(i.quantity)/14.0 AS daily_use
    FROM production_batch_items i
    JOIN production_batches b ON b.id = i.batch_id
    JOIN products p ON p.id = i.ingredient_product_id
    WHERE b.status='completed' AND date(b.completed_at) >= date('now','-14 day')
    GROUP BY i.ingredient_product_id
    HAVING daily_use > 0
  `).all();
  for (const u of usage) {
    const daysLeft = u.daily_use > 0 ? (u.stock_quantity || 0) / u.daily_use : 999;
    if (daysLeft <= 7) {
      suggestions.push({
        type: 'runout_prediction',
        severity: daysLeft <= 2 ? 'high' : 'medium',
        product_id: u.ingredient_product_id,
        title: `${u.name} may run out`,
        message: `At current production usage (~${u.daily_use.toFixed(2)}/day), stock lasts ~${Math.max(0, Math.floor(daysLeft))} days.`
      });
    }
  }

  // Substitution ideas for out-of-stock ingredients used in recipes
  const out = db.prepare(`SELECT id, name, category_id FROM products WHERE is_active=1 AND stock_quantity <= 0 LIMIT 5`).all();
  for (const o of out) {
    const alt = db.prepare(`
      SELECT id, name, stock_quantity FROM products
      WHERE is_active=1 AND stock_quantity > 0 AND category_id IS NOT NULL AND category_id = ? AND id != ?
      ORDER BY stock_quantity DESC LIMIT 3
    `).all(o.category_id, o.id);
    if (alt.length) {
      suggestions.push({
        type: 'substitution',
        severity: 'medium',
        product_id: o.id,
        title: `Substitute for ${o.name}`,
        message: `Consider: ${alt.map(a => a.name).join(', ')} (requires approval before changing recipes).`,
        alternatives: alt
      });
    }
  }

  // Promo candidates: high margin + decent sales
  const promo = db.prepare(`
    SELECT r.id, r.name, r.profit_margin, COALESCE(SUM(si.quantity),0) AS sold
    FROM recipe_profiles r
    LEFT JOIN sale_items si ON si.product_id = r.product_id
    LEFT JOIN sales s ON s.id = si.sale_id AND s.status='completed' AND date(s.created_at) >= date('now','-30 day')
    WHERE r.status='approved' AND r.profit_margin >= 35
    GROUP BY r.id
    ORDER BY r.profit_margin * COALESCE(SUM(si.quantity),1) DESC LIMIT 5
  `).all();
  for (const p of promo) {
    suggestions.push({
      type: 'promote',
      severity: 'low',
      recipe_id: p.id,
      title: `Promote ${p.name}`,
      message: `Strong margin (${p.profit_margin}%) with ${p.sold} sold in 30 days — good promo candidate.`
    });
  }

  try {
    const forecast = getStockForecast(actor, 14).slice(0, 8);
    for (const f of forecast) {
      if (f.days_left <= 10) {
        suggestions.push({
          type: 'forecast',
          severity: f.days_left <= 3 ? 'high' : 'medium',
          product_id: f.id,
          title: `Forecast: buy ${f.buy_qty} × ${f.name}`,
          message: `Next 14 days need ~${f.forecast_need} (have ${f.stock_quantity}). Est. ${f.days_left} days left.`
        });
      }
    }
  } catch (_) { /* ignore */ }

  // Cost-increase price review: buying price rose vs last version recipe cost
  const costRise = db.prepare(`
    SELECT r.id, r.name, r.recipe_cost, r.selling_price, r.target_profit_pct
    FROM recipe_profiles r WHERE r.status='approved' AND r.food_cost_pct > 32
    ORDER BY r.food_cost_pct DESC LIMIT 5
  `).all();
  for (const r of costRise) {
    const suggested = calcProfitFromCost(r.recipe_cost, 'profit_pct', r.target_profit_pct || 40, null);
    if (suggested.suggested_price > (r.selling_price || 0) * 1.02) {
      suggestions.push({
        type: 'price_review',
        severity: 'medium',
        recipe_id: r.id,
        title: `Menu price review: ${r.name}`,
        message: `Ingredient costs imply sell ~${suggested.suggested_price.toFixed(2)} (current ${Number(r.selling_price || 0).toFixed(2)}).`
      });
    }
  }

  return suggestions;
}

function getRecipeActivity(limit = 50, actor, filters = {}) {
  canAccessRecipeModule(actor);
  const scope = resolveRecipeBranchScope(actor, filters);
  let sql = 'SELECT * FROM recipe_activity_log WHERE 1=1';
  const params = [];
  if (!scope.allBranches) {
    sql += ' AND (branch_id = ? OR branch_id IS NULL)';
    params.push(scope.branchId);
  }
  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);
  return getDb().prepare(sql).all(...params);
}

let _lastClearExpiredAt = 0;
function clearExpiredNewArrivals() {
  // Throttle: at most once per 5 minutes per process (same SQL result).
  if (Date.now() - _lastClearExpiredAt < 5 * 60 * 1000) return;
  getDb().prepare(`
    UPDATE products SET is_new_arrival = 0
    WHERE is_new_arrival = 1 AND new_arrival_until IS NOT NULL AND date(new_arrival_until) < date('now')
  `).run();
  _lastClearExpiredAt = Date.now();
}

function setAvailableToday(recipeIds, actor) {
  requireRecipePerm(actor, 'edit');
  const scope = resolveRecipeBranchScope(actor);
  const db = getDb();
  if (scope.allBranches) {
    db.prepare('UPDATE recipe_profiles SET available_today = 0').run();
  } else {
    db.prepare('UPDATE recipe_profiles SET available_today = 0 WHERE branch_id = ? OR branch_id IS NULL').run(scope.branchId);
  }
  db.prepare('UPDATE products SET available_today = 0 WHERE has_recipe = 1 OR production_mode IS NOT NULL').run();
  for (const id of recipeIds || []) {
    db.prepare('UPDATE recipe_profiles SET available_today = 1 WHERE id = ?').run(id);
    const r = db.prepare('SELECT product_id FROM recipe_profiles WHERE id = ?').get(id);
    if (r?.product_id) db.prepare('UPDATE products SET available_today = 1 WHERE id = ?').run(r.product_id);
  }
  logActivity(actor, 'set_available_today', 'recipe', null, null, { ids: recipeIds });
  return true;
}

function getBestSellers(period, actor) {
  canAccessRecipeModule(actor);
  clearExpiredNewArrivals();
  let days = 1;
  if (period === 'week') days = 7;
  else if (period === 'month') days = 30;
  else if (period === 'year') days = 365;
  else if (period === 'all') days = 3650;
  return getDb().prepare(`
    SELECT si.product_id, MAX(si.product_name) AS product_name, SUM(si.quantity) AS sold, SUM(si.total) AS revenue
    FROM sale_items si JOIN sales s ON s.id = si.sale_id
    JOIN recipe_profiles r ON r.product_id = si.product_id
    WHERE s.status='completed' AND date(s.created_at) >= date('now', ?)
    GROUP BY si.product_id ORDER BY sold DESC LIMIT 20
  `).all(`-${days} day`);
}

function listMealProducts(filters = {}, actor) {
  canAccessRecipeModule(actor);
  const scope = resolveRecipeBranchScope(actor, filters);
  let sql = `
    SELECT p.*, c.name AS category_name,
      (SELECT COUNT(*) FROM product_recipe_items pri WHERE pri.product_id = p.id) AS ingredient_count,
      r.id AS recipe_profile_id, r.status AS recipe_status, r.branch_id AS recipe_branch_id
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN recipe_profiles r ON r.product_id = p.id
      ${scope.allBranches ? '' : 'AND r.branch_id = ?'}
    WHERE p.is_active = 1 AND (p.is_archived = 0 OR p.is_archived IS NULL)
      AND (p.item_type IS NULL OR p.item_type != 'ingredient')
  `;
  const params = [];
  if (!scope.allBranches) params.push(scope.branchId);
  if (filters.search) {
    sql += ' AND (p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)';
    const q = `%${filters.search}%`;
    params.push(q, q, q);
  }
  if (filters.with_recipe === true) {
    sql += scope.allBranches
      ? ' AND EXISTS (SELECT 1 FROM product_recipe_items pri WHERE pri.product_id = p.id)'
      : ' AND r.id IS NOT NULL';
  }
  if (filters.with_recipe === false) {
    sql += scope.allBranches
      ? ' AND NOT EXISTS (SELECT 1 FROM product_recipe_items pri WHERE pri.product_id = p.id)'
      : ' AND r.id IS NULL';
  }
  sql += ' ORDER BY p.name COLLATE NOCASE LIMIT 500';
  return getDb().prepare(sql).all(...params);
}

/**
 * Ingredients for Restock / Ingredient Master.
 * Always reflects the latest saved meal recipes (names, units, which meals use them).
 * Re-editing a recipe updates this list on the next open — no manual refresh needed beyond opening the tab.
 */
function listRestockIngredients(actor) {
  canAccessRecipeModule(actor);
  const db = getDb();

  // Primary source of truth: ingredients currently on saved product recipes
  const onRecipes = db.prepare(`
    SELECT
      p.id,
      MAX(p.name) AS name,
      MAX(p.stock_quantity) AS stock_quantity,
      MAX(p.stock_unit) AS stock_unit,
      MAX(p.unit) AS unit,
      MAX(p.purchase_unit) AS purchase_unit,
      MAX(p.buying_price) AS buying_price,
      MAX(p.min_stock) AS min_stock,
      MAX(p.item_type) AS item_type,
      MAX(p.is_active) AS is_active,
      MAX(c.name) AS category_name,
      GROUP_CONCAT(DISTINCT meal.name) AS used_in_meals,
      COUNT(DISTINCT pri.product_id) AS meal_count,
      (
        SELECT pri2.unit FROM product_recipe_items pri2
        WHERE pri2.ingredient_product_id = p.id
        ORDER BY pri2.id DESC LIMIT 1
      ) AS recipe_unit,
      1 AS from_recipe
    FROM product_recipe_items pri
    JOIN products p ON p.id = pri.ingredient_product_id AND p.is_active = 1
    JOIN products meal ON meal.id = pri.product_id AND meal.is_active = 1
    LEFT JOIN categories c ON c.id = p.category_id
    GROUP BY p.id
    ORDER BY MAX(p.name)
  `).all();

  const onRecipeIds = new Set(onRecipes.map(r => r.id));

  // Typed ingredients created in Recipe Builder but not currently on any meal (e.g. removed after re-edit)
  const orphans = db.prepare(`
    SELECT p.*, c.name AS category_name,
      NULL AS used_in_meals, 0 AS meal_count,
      COALESCE(p.stock_unit, p.unit, 'each') AS recipe_unit,
      0 AS from_recipe
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.is_active = 1 AND p.item_type = 'ingredient'
    ORDER BY p.name
  `).all().filter(p => !onRecipeIds.has(p.id));

  return [...onRecipes, ...orphans].map(p => {
    const stockUnit = p.stock_unit || p.unit || 'each';
    const recipeUnit = p.recipe_unit || stockUnit;
    // Restock buys in bulk — prefer purchase/stock unit, not tsp/g recipe measure
    const restockUnit = p.purchase_unit || stockUnit;
    return {
      ...p,
      used_in_meals: p.used_in_meals || '',
      meal_count: Number(p.meal_count) || 0,
      from_recipe: !!p.from_recipe,
      stock_unit: stockUnit,
      recipe_unit: recipeUnit,
      purchase_unit: restockUnit,
      restock_unit: restockUnit,
      display_unit: stockUnit
    };
  });
}

/** Ensure POS options/removals exist for optional recipe lines (With Pap / Without Pap). */
function ensureMealOptionModifiers(productId, items) {
  const store = require('./store');
  const existing = store.getProductModifiers(productId) || [];
  const byName = new Map(existing.map(m => [String(m.name || '').trim().toLowerCase(), m]));
  let changed = false;
  const next = existing.map(m => ({
    name: m.name,
    extra_price: m.extra_price || 0,
    modifier_type: m.modifier_type || 'extra',
    option_group: m.option_group || null
  }));
  for (const item of items || []) {
    const rule = inventory.normalizeIncludeRule(item.include_rule);
    const optName = (item.option_name || '').toString().trim();
    if (rule === 'always' || !optName) continue;
    const key = optName.toLowerCase();
    if (byName.has(key)) continue;
    const modType = rule === 'unless_selected' ? 'removal' : 'option';
    const group = rule === 'unless_selected' ? null : 'Serving options';
    next.push({
      name: optName,
      extra_price: 0,
      modifier_type: modType,
      option_group: group
    });
    byName.set(key, true);
    changed = true;
  }
  if (changed) {
    store.saveProductModifiers(productId, next);
    const needsRequiredChoice = next.some(m => m.modifier_type === 'option');
    if (needsRequiredChoice) {
      try {
        getDb().prepare('UPDATE products SET requires_options = 1 WHERE id = ?').run(productId);
      } catch (_) { /* ignore */ }
    }
  }
}

/** Open an existing POS product and its per-meal ingredient list. */
function getProductMealRecipe(productId, actor) {
  canAccessRecipeModule(actor);
  const p = getDb().prepare(`
    SELECT p.*, c.name AS category_name FROM products p
    LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = ?
  `).get(productId);
  if (!p) throw new Error('Product not found');
  const items = inventory.getProductRecipe(productId);
  const costing = computeRecipeCosting(items, {
    price_mode: 'profit_pct',
    target_profit_pct: 40,
    override_price: p.selling_price
  });
  const profile = getDb().prepare('SELECT * FROM recipe_profiles WHERE product_id = ? ORDER BY id DESC LIMIT 1').get(productId);
  let availability = null;
  try {
    availability = require('./production-availability').calculateProductCapacity(productId);
  } catch (_) { /* ignore */ }
  const modifiers = require('./store').getProductModifiers(productId) || [];
  return {
    product: p,
    items: costing.lines,
    costing,
    recipe_profile: profile || null,
    availability,
    modifiers,
    options: modifiers.filter(m => m.modifier_type === 'option'),
    removals: modifiers.filter(m => m.modifier_type === 'removal')
  };
}

/**
 * Attach ingredients (with amounts for ONE meal) to an existing POS product.
 * Reuse a saved ingredient by ingredient_product_id (preferred) and set a different
 * quantity per meal. New names create Inventory products (item_type = ingredient).
 * POS sale of 1 meal deducts those amounts from the shared ingredient stock.
 */
function saveProductMealRecipe(data, actor) {
  const productId = Number(data.product_id);
  if (!productId) throw new Error('Select a product first');
  const hasExisting = !!getDb().prepare(
    'SELECT 1 FROM product_recipe_items WHERE product_id=? LIMIT 1'
  ).get(productId);
  // Owner / admin can always create or edit meal recipes
  try {
    requireRecipePerm(actor, hasExisting ? 'edit' : 'create');
  } catch (err) {
    // Allow create if they have edit, and edit if they have create
    try { requireRecipePerm(actor, hasExisting ? 'create' : 'edit'); }
    catch (_) { throw err; }
  }

  const product = getDb().prepare('SELECT * FROM products WHERE id = ?').get(productId);
  if (!product) throw new Error('Product not found');

  const items = [];
  const seenIds = new Set();
  for (const i of (data.items || [])) {
    const qty = Number(i.quantity);
    if (!(qty > 0)) continue;
    const unit = (i.unit || 'each').toString().trim() || 'each';
    const typedName = (i.ingredient_name || '').trim();
    let ingId = Number(i.ingredient_product_id) || null;
    let displayName = typedName;

    // Prefer stable ID so the same saved ingredient can be reused with a different amount per meal
    if (ingId) {
      const row = getDb().prepare('SELECT id, name FROM products WHERE id=? AND is_active=1').get(ingId);
      if (!row) throw new Error(`Saved ingredient not found (id ${ingId}). Pick it again from the list.`);
      displayName = row.name || typedName || `Ingredient ${ingId}`;
      // Keep stock unit in sync when recipe line uses a real measure and product still says "each"
      if (unit && unit !== 'each') {
        findOrCreateIngredientByName(displayName, unit, actor);
      }
    } else if (typedName) {
      ingId = findOrCreateIngredientByName(typedName, unit, actor).id;
      displayName = typedName;
    } else {
      continue;
    }

    if (seenIds.has(Number(ingId))) {
      throw new Error(`"${displayName}" is already on this meal — use one line and set the amount for 1 meal`);
    }
    seenIds.add(Number(ingId));

    if (Number(ingId) === productId) {
      throw new Error('A meal cannot use itself as an ingredient');
    }
    const rule = inventory.normalizeIncludeRule(i.include_rule);
    const optionName = rule === 'always' ? null : ((i.option_name || '').toString().trim() || null);
    if (rule !== 'always' && !optionName) {
      throw new Error(`"${displayName || 'Ingredient'}" is optional — enter the POS option name (e.g. Without Pap or With Pap)`);
    }
    items.push({
      ingredient_product_id: Number(ingId),
      quantity: qty,
      unit,
      waste_pct: Number(i.waste_pct) || 0,
      include_rule: rule,
      option_name: optionName,
      is_primary: !!(i.is_primary || i.is_main)
    });
  }
  if (!items.length) throw new Error('Add at least one ingredient: pick or type the name, then set amount and unit');
  // At most one main ingredient (always-required)
  const primaries = items.filter(i => i.is_primary && i.include_rule === 'always');
  if (primaries.length > 1) {
    items.forEach((i, idx) => { i.is_primary = idx === items.findIndex(x => x.is_primary); });
  }

  const costing = computeRecipeCosting(items, {
    price_mode: data.price_mode || 'profit_pct',
    target_profit_pct: data.target_profit_pct ?? 40,
    override_price: data.override_price != null && data.override_price !== ''
      ? data.override_price
      : product.selling_price
  });

  // Persist BOM first (source of truth for POS / capacity / re-edit)
  inventory.saveProductRecipe(productId, items);
  ensureMealOptionModifiers(productId, items);
  inventory.updateProductRecipeMetrics(productId, costing.selling_price || product.selling_price);

  const mode = data.production_mode === 'make_to_stock' ? 'make_to_stock' : 'make_to_order';
  getDb().prepare(`
    UPDATE products SET production_mode=?, recipe_cost=?, food_cost_pct=?, gross_profit=?, profit_margin=?,
      has_recipe=1, updated_at=datetime('now') WHERE id=?
  `).run(mode, costing.recipe_cost, costing.food_cost_pct, costing.gross_profit, costing.profit_margin, productId);

  if (data.description !== undefined) {
    getDb().prepare('UPDATE products SET description=? WHERE id=?').run(
      data.description == null ? null : String(data.description), productId
    );
  }
  if (data.picture_path !== undefined) {
    getDb().prepare('UPDATE products SET picture_path=? WHERE id=?').run(data.picture_path || null, productId);
  }
  if (data.allergens !== undefined) {
    try {
      getDb().prepare('UPDATE products SET allergens=? WHERE id=?').run(
        String(data.allergens || '').trim() || null, productId
      );
    } catch (_) { /* until migrate */ }
  }

  // Keep / create recipe_profile linked to this product for approvals & dashboard
  let profile = getDb().prepare('SELECT * FROM recipe_profiles WHERE product_id = ? ORDER BY id DESC LIMIT 1').get(productId);
  const profilePayload = {
    product_id: productId,
    name: product.name,
    category: data.category || product.category_name || null,
    production_mode: mode,
    price_mode: data.price_mode || 'profit_pct',
    target_profit_pct: data.target_profit_pct ?? 40,
    override_price: data.override_price != null && data.override_price !== '' ? Number(data.override_price) : null,
    items,
    instructions: data.instructions != null ? String(data.instructions) : (profile?.instructions || null),
    notes: data.kitchen_notes != null ? String(data.kitchen_notes) : (profile?.notes || null),
    allergens: data.allergens !== undefined ? String(data.allergens || '').trim() || null : (profile?.allergens || null),
    description: data.description != null ? String(data.description) : (profile?.description || null),
    image_path: data.picture_path !== undefined ? (data.picture_path || null) : (profile?.image_path || null),
    status: profile?.status === 'approved' ? 'approved' : (data.status || profile?.status || 'draft'),
    id: profile?.id,
    bump_version: false
  };
  try {
    saveRecipe(profilePayload, actor);
    profile = getDb().prepare('SELECT * FROM recipe_profiles WHERE product_id = ? ORDER BY id DESC LIMIT 1').get(productId);
    // Owner/manager (or explicit submit): keep Approvals + Production in sync with meal BOM
    if (profile && profile.status !== 'approved') {
      const canApprove = (() => {
        try { requireRecipePerm(actor, 'approve'); return true; } catch (_) { return false; }
      })();
      if (data.submit_for_approval || data.auto_approve || canApprove) {
        try {
          if (['draft', 'rejected'].includes(profile.status)) submitRecipeForApproval(profile.id, actor);
        } catch (_) { /* ignore */ }
        if (canApprove || data.auto_approve) {
          try {
            const st = getDb().prepare('SELECT status FROM recipe_profiles WHERE id=?').get(profile.id)?.status;
            if (st === 'pending') approveRecipe(profile.id, actor);
          } catch (_) { /* leave pending for Approvals */ }
        }
      }
    }
  } catch (err) {
    // BOM already saved — do not fail the whole meal save on profile bookkeeping
    console.error('recipe profile save warning:', err.message);
  }

  // Re-read from DB to guarantee what we return is what was stored
  const stored = inventory.getProductRecipe(productId);
  if (!stored.length) {
    throw new Error('Save failed — ingredients were not stored. Try again.');
  }

  logActivity(actor, 'save_product_meal_recipe', 'product', productId, null, {
    ingredient_count: stored.length,
    recipe_cost: costing.recipe_cost
  });

  try {
    require('./production-availability').refreshProductCapacity(productId);
    for (const it of items) {
      require('./production-availability').refreshAffectedByIngredient(it.ingredient_product_id);
    }
  } catch (_) { /* ignore */ }

  const meal = getProductMealRecipe(productId, actor);
  return {
    ...meal,
    saved: true,
    saved_count: stored.length,
    saved_items: stored.map(s => ({
      ingredient_product_id: s.ingredient_product_id,
      ingredient_name: s.ingredient_name,
      quantity: s.quantity,
      unit: s.unit,
      include_rule: s.include_rule || 'always',
      option_name: s.option_name || null
    }))
  };
}

/**
 * Restock an ingredient (buy in bulk) — e.g. Cooking Oil 5 litres, Spice 200 g.
 * Stock is shared with Inventory; POS sales deduct recipe amounts from this stock.
 */
function restockIngredient(data, actor) {
  requireRecipePerm(actor, 'produce');
  const store = require('./store');
  const productId = Number(data.product_id);
  if (!productId) throw new Error('Ingredient required');
  const product = getDb().prepare('SELECT * FROM products WHERE id = ?').get(productId);
  if (!product) throw new Error('Ingredient not found');

  let qty = Number(data.quantity);
  if (!(qty > 0)) throw new Error('Quantity must be greater than 0');
  const stockUnit = product.stock_unit || product.unit || 'each';
  const unit = (data.unit || product.purchase_unit || stockUnit || 'each').toString().trim() || 'each';
  // Convert purchase unit → stock unit when needed (kg→g, L→ml, etc.)
  const qtyInStock = inventory.convertQuantity(productId, qty, unit, stockUnit);
  if (unit !== stockUnit && qtyInStock === qty && !['each', 'piece'].includes(unit.toLowerCase())) {
    // Conversion missing — still accept but warn via note; prefer storing purchase unit for next time
    console.warn(`Restock: no conversion ${unit} → ${stockUnit} for product ${productId}; storing as-is`);
  }
  qty = qtyInStock;

  const note = data.notes || `Recipe restock: +${data.quantity} ${unit}` +
    (unit !== stockUnit ? ` (= ${qty} ${stockUnit})` : '');
  store.adjustStock(productId, qty, 'purchase', note, actor?.id, 'recipe_restock', productId);

  // Remember how this ingredient is bought + keep stock unit correct
  try {
    getDb().prepare(`
      UPDATE products SET
        purchase_unit = ?,
        stock_unit = COALESCE(NULLIF(stock_unit,''), ?),
        unit = COALESCE(NULLIF(unit,''), ?),
        updated_at=datetime('now')
      WHERE id = ?
    `).run(unit, stockUnit, stockUnit, productId);
  } catch (_) { /* ignore */ }

  // Optional: update average buying price if cost provided (per stock unit)
  if (data.total_cost != null && Number(data.total_cost) > 0 && qty > 0) {
    const unitCost = Number(data.total_cost) / qty;
    getDb().prepare(`UPDATE products SET buying_price = ?, updated_at=datetime('now') WHERE id = ?`)
      .run(Math.round(unitCost * 1000) / 1000, productId);
  } else if (data.unit_cost != null && Number(data.unit_cost) > 0) {
    getDb().prepare(`UPDATE products SET buying_price = ?, updated_at=datetime('now') WHERE id = ?`)
      .run(Number(data.unit_cost), productId);
  }

  logActivity(actor, 'restock_ingredient', 'product', productId, null, {
    quantity: qty, unit: stockUnit, purchased_as: `${data.quantity} ${unit}`
  });

  return getIngredient(productId, actor);
}

/** Create a draft Purchase Order from restock lines / smart restock suggestions. */
function createRestockPurchaseOrder(data, actor) {
  requireRecipePerm(actor, 'produce');
  const store = require('./store');
  const lines = (data?.items || []).filter(i => Number(i.product_id) && Number(i.quantity) > 0);
  if (!lines.length) throw new Error('Add at least one ingredient quantity to create a purchase order');
  const poItems = lines.map(i => {
    const p = getDb().prepare('SELECT id, name, buying_price FROM products WHERE id=?').get(Number(i.product_id));
    if (!p) throw new Error(`Ingredient #${i.product_id} not found`);
    const qty = Number(i.quantity);
    const price = i.buying_price != null ? Number(i.buying_price) : (Number(p.buying_price) || 0);
    return {
      product_id: p.id,
      product_name: p.name,
      quantity: qty,
      buying_price: price,
      total: Math.round(qty * price * 100) / 100
    };
  });
  const result = store.savePurchaseOrder({
    supplier_id: data.supplier_id || null,
    status: 'pending',
    notes: data.notes || 'Created from Recipe Restock',
    items: poItems
  }, actor?.id, actor?.username || actor?.full_name || 'Recipe');
  logActivity(actor, 'create_restock_po', 'purchase_order', result?.id, null, { lines: poItems.length });
  return result;
}

/** Daily prep board: Available Today meals + low capacity. */
function getPrepBoard(actor) {
  canAccessRecipeModule(actor);
  const db = getDb();
  let meals = [];
  try {
    meals = db.prepare(`
      SELECT p.id, p.name, p.picture_path, p.available_today, p.selling_price,
        p.production_capacity, p.limiting_ingredient_name, p.production_oos,
        p.food_cost_pct, p.gross_profit, p.allergens AS product_allergens,
        rp.instructions, rp.notes AS kitchen_notes, rp.allergens AS allergens,
        rp.prep_time_minutes, rp.cook_time_minutes, rp.id AS recipe_profile_id
      FROM products p
      LEFT JOIN recipe_profiles rp ON rp.product_id = p.id
      WHERE p.is_active=1 AND p.has_recipe=1
        AND (p.item_type IS NULL OR p.item_type != 'ingredient')
      ORDER BY CASE WHEN p.available_today=1 THEN 0 ELSE 1 END,
        COALESCE(p.production_capacity,0) ASC, p.name COLLATE NOCASE
    `).all().map(m => ({
      ...m,
      allergens: m.allergens || m.product_allergens || null
    }));
  } catch (_) {
    meals = db.prepare(`
      SELECT p.id, p.name, p.picture_path, p.available_today, p.selling_price,
        p.production_capacity, p.limiting_ingredient_name, p.production_oos,
        p.food_cost_pct, p.gross_profit, rp.instructions, rp.notes AS kitchen_notes,
        rp.prep_time_minutes, rp.cook_time_minutes, rp.id AS recipe_profile_id
      FROM products p
      LEFT JOIN recipe_profiles rp ON rp.product_id = p.id
      WHERE p.is_active=1 AND p.has_recipe=1
        AND (p.item_type IS NULL OR p.item_type != 'ingredient')
      ORDER BY CASE WHEN p.available_today=1 THEN 0 ELSE 1 END,
        COALESCE(p.production_capacity,0) ASC, p.name COLLATE NOCASE
    `).all().map(m => ({ ...m, allergens: null }));
  }
  const availableToday = meals.filter(m => Number(m.available_today) === 1);
  const lowCapacity = meals.filter(m => !m.production_oos && (m.production_capacity || 0) > 0 && (m.production_capacity || 0) <= 5);
  const outOfStock = meals.filter(m => m.production_oos || (m.production_capacity || 0) <= 0);
  let forecast = [];
  try { forecast = getStockForecast(actor, 7).slice(0, 12); } catch (_) { forecast = []; }
  const prepSchedule = [];
  for (let d = 0; d < 7; d++) {
    const day = new Date();
    day.setDate(day.getDate() + d);
    const dateStr = day.toLocaleDateString('en-CA');
    const weekday = day.toLocaleDateString(undefined, { weekday: 'short' });
    prepSchedule.push({
      date: dateStr,
      weekday,
      meals: availableToday.slice(0, 8).map(m => ({
        id: m.id,
        name: m.name,
        prep_time_minutes: m.prep_time_minutes || 0,
        cook_time_minutes: m.cook_time_minutes || 0,
        picture_path: m.picture_path || null,
        allergens: m.allergens || null
      })),
      restock_focus: forecast.filter(f => f.days_left <= (d + 2)).slice(0, 4)
    });
  }
  return {
    date: today(),
    available_today: availableToday,
    low_capacity: lowCapacity,
    out_of_stock: outOfStock,
    all_meals: meals,
    prep_schedule: prepSchedule,
    forecast,
    totals: {
      available_today: availableToday.length,
      low: lowCapacity.length,
      oos: outOfStock.length,
      meals: meals.length
    }
  };
}

/** Food-cost alerts for Admin Dashboard. */
function getFoodCostAlerts(actor, opts = {}) {
  // Allow Admin overview without full recipe login — owner/manager only
  const user = assertUserActor(actor, null);
  if (!['owner', 'manager'].includes(user.role)) {
    try { canAccessRecipeModule(actor); } catch (_) { return []; }
  }
  const maxFood = Number(opts.max_food_cost_pct) || 35;
  const minMargin = Number(opts.min_profit_margin) || 25;
  return getDb().prepare(`
    SELECT id, name, selling_price, recipe_cost, food_cost_pct, gross_profit, profit_margin,
      limiting_ingredient_name, production_capacity
    FROM products
    WHERE is_active=1 AND has_recipe=1
      AND (item_type IS NULL OR item_type != 'ingredient')
      AND (food_cost_pct > ? OR profit_margin < ?)
    ORDER BY food_cost_pct DESC
    LIMIT 30
  `).all(maxFood, minMargin).map(p => ({
    ...p,
    alert: (p.food_cost_pct || 0) > maxFood ? 'high_food_cost' : 'low_margin',
    message: (p.food_cost_pct || 0) > maxFood
      ? `Food cost ${p.food_cost_pct}% is above ${maxFood}%`
      : `Profit margin ${p.profit_margin}% is below ${minMargin}%`
  }));
}

/** With vs Without option costing for meals with optional BOM lines. */
function getModifierCostingReport(actor, filters = {}) {
  canAccessRecipeModule(actor);
  const meals = getDb().prepare(`
    SELECT p.id, p.name, p.selling_price FROM products p
    WHERE p.is_active=1 AND p.has_recipe=1
      AND (p.item_type IS NULL OR p.item_type != 'ingredient')
    ORDER BY p.name COLLATE NOCASE
  `).all();
  const rows = [];
  for (const m of meals) {
    const items = inventory.getProductRecipe(m.id);
    const optional = items.filter(i => inventory.normalizeIncludeRule(i.include_rule) !== 'always' && i.option_name);
    if (!optional.length) continue;
    const alwaysItems = items.filter(i => inventory.normalizeIncludeRule(i.include_rule) === 'always' || !i.option_name);
    const base = computeRecipeCosting(alwaysItems, { override_price: m.selling_price, price_mode: 'profit_pct', target_profit_pct: 40 });
    const full = computeRecipeCosting(items, { override_price: m.selling_price, price_mode: 'profit_pct', target_profit_pct: 40 });
    const optionNames = [...new Set(optional.map(o => o.option_name))];
    rows.push({
      meal: m.name,
      sell_price: m.selling_price,
      cost_without_options: base.recipe_cost,
      profit_without_options: base.gross_profit,
      cost_with_all_options: full.recipe_cost,
      profit_with_all_options: full.gross_profit,
      option_lines: optional.map(o => `${o.ingredient_name} (${o.include_rule}: ${o.option_name})`).join('; '),
      options: optionNames.join(', ')
    });
  }
  return rows;
}

/** Approved substitutions usable at POS for a limiting ingredient. */
function listPosSubstitutionsForIngredient(ingredientProductId, actor) {
  // Soft auth — POS may call with logged-in cashier
  assertUserActor(actor, null);
  const id = Number(ingredientProductId);
  if (!id) return [];
  return getDb().prepare(`
    SELECT s.*, pf.name AS from_name, pt.name AS to_name, pt.stock_quantity AS to_stock
    FROM recipe_substitutions s
    JOIN products pf ON pf.id = s.from_product_id
    JOIN products pt ON pt.id = s.to_product_id
    WHERE s.status='approved' AND s.from_product_id=? AND pt.stock_quantity > 0
    ORDER BY pt.stock_quantity DESC LIMIT 20
  `).all(id);
}

/** Export meal recipes + BOM + modifiers for branch transfer. */
function exportRecipeBundle(actor) {
  canAccessRecipeModule(actor);
  const db = getDb();
  const meals = db.prepare(`
    SELECT p.id, p.name, p.barcode, p.sku, p.selling_price, p.buying_price, p.description,
      p.picture_path, p.production_mode, p.has_recipe, p.available_today, p.item_type
    FROM products p
    WHERE p.is_active=1 AND p.has_recipe=1
      AND (p.item_type IS NULL OR p.item_type != 'ingredient')
  `).all();
  const bundle = {
    version: 1,
    exported_at: new Date().toISOString(),
    meals: meals.map(m => ({
      product: m,
      recipe: inventory.getProductRecipe(m.id),
      modifiers: require('./store').getProductModifiers(m.id),
      profile: db.prepare('SELECT name, instructions, notes, description, image_path, production_mode, target_profit_pct FROM recipe_profiles WHERE product_id=? ORDER BY id DESC LIMIT 1').get(m.id) || null
    })),
    ingredients: listRestockIngredients(actor)
  };
  logActivity(actor, 'export_recipe_bundle', 'recipe_bundle', null, null, { meals: meals.length });
  return bundle;
}

/** Import recipe bundle — match meals by barcode then name; create missing ingredients. */
function importRecipeBundle(bundle, actor) {
  requireRecipePerm(actor, 'edit');
  if (!bundle?.meals?.length) throw new Error('No meals in recipe bundle');
  const db = getDb();
  let imported = 0;
  for (const meal of bundle.meals) {
    const src = meal.product || {};
    let local = null;
    if (src.barcode) local = db.prepare('SELECT * FROM products WHERE barcode=?').get(src.barcode);
    if (!local && src.name) local = db.prepare('SELECT * FROM products WHERE lower(trim(name))=lower(?)').get(String(src.name).trim());
    if (!local) {
      const r = db.prepare(`
        INSERT INTO products (name, barcode, sku, selling_price, buying_price, stock_quantity, description, picture_path, has_recipe, production_mode, is_active)
        VALUES (?,?,?,?,?,0,?,?,1,?,1)
      `).run(
        src.name, src.barcode || null, src.sku || null,
        src.selling_price || 0, src.buying_price || 0,
        src.description || null, src.picture_path || null,
        src.production_mode || 'make_to_order'
      );
      local = db.prepare('SELECT * FROM products WHERE id=?').get(r.lastInsertRowid);
    }
    const items = [];
    for (const line of (meal.recipe || [])) {
      const ing = findOrCreateIngredientByName(line.ingredient_name || 'Ingredient', line.unit || 'each', actor);
      items.push({
        ingredient_product_id: ing.id,
        quantity: line.quantity,
        unit: line.unit || 'each',
        waste_pct: line.waste_pct || 0,
        include_rule: line.include_rule || 'always',
        option_name: line.option_name || null
      });
    }
    if (items.length) {
      inventory.saveProductRecipe(local.id, items);
      ensureMealOptionModifiers(local.id, items);
      if (meal.modifiers?.length) {
        try { require('./store').saveProductModifiers(local.id, meal.modifiers); } catch (_) { /* ignore */ }
      }
      inventory.updateProductRecipeMetrics(local.id, local.selling_price);
      imported++;
    }
  }
  try { require('./production-availability').refreshAllMealCapacities(); } catch (_) { /* ignore */ }
  logActivity(actor, 'import_recipe_bundle', 'recipe_bundle', null, null, { imported });
  return { imported, total: bundle.meals.length };
}

module.exports = {
  RECIPE_ROLES,
  ROLE_PERMS,
  canAccessRecipeModule,
  sessionFromPosUser,
  requireRecipePerm,
  assertCanManageRecipeAccess,
  getRecipeAccess,
  getRecipeAccessList,
  listUsersForRecipeAccess,
  setRecipeUserAccess,
  removeRecipeUserAccess,
  loginToRecipeModule,
  createRestockPurchaseOrder,
  getPrepBoard,
  getFoodCostAlerts,
  getModifierCostingReport,
  listPosSubstitutionsForIngredient,
  exportRecipeBundle,
  importRecipeBundle,
  listIngredients,
  getIngredient,
  calcProfitFromCost,
  computeRecipeCosting,
  listRecipes,
  getRecipeWithItems,
  saveRecipe,
  submitRecipeForApproval,
  approveRecipe,
  rejectRecipe,
  archiveRecipe,
  deleteRecipe,
  createProductFromRecipe,
  calcProductionCapacity,
  planProduction,
  completeProduction,
  applySuggestedSellPrice,
  listProductionBatches,
  smartRestock,
  recordRecipeWaste,
  listRecipeWaste,
  approveRecipeWaste,
  rejectRecipeWaste,
  updateRecipeWaste,
  deleteRecipeWaste,
  ensureApprovedProfileForMeal,
  listProductionMeals,
  getIngredientStockHistory,
  getProfitsLosses,
  listRecipePurchaseOrders,
  listRecipePromotions,
  saveRecipePromotion,
  getRecipeDashboard,
  getRecipeReports,
  getAiSuggestions,
  getRecipeActivity,
  setAvailableToday,
  getBestSellers,
  clearExpiredNewArrivals,
  applyRecipePromoPricesToProducts,
  requestSubstitution,
  listSubstitutions,
  approveSubstitution,
  rejectSubstitution,
  getStockForecast,
  listMealProducts,
  getProductMealRecipe,
  saveProductMealRecipe,
  restockIngredient,
  listRestockIngredients,
  findOrCreateIngredientByName,
  ensureIngredient,
  updateIngredient,
  deleteIngredient,
  calculateRestockPlan,
  setPosMenuFlags,
  // Production Availability Engine
  getProductionAvailability: (productId, actor) => {
    canAccessRecipeModule(actor);
    return require('./production-availability').getAvailabilitySnapshot(productId);
  },
  getLiveProductionDashboard: (actor) => {
    canAccessRecipeModule(actor);
    return require('./production-availability').getLiveProductionDashboard();
  },
  refreshProductionAvailability: (actor) => {
    canAccessRecipeModule(actor);
    return require('./production-availability').refreshAllMealCapacities();
  },
  getProductRestockRecommendation: (productId, targetQty, actor) => {
    canAccessRecipeModule(actor);
    return require('./production-availability').getSmartRestockForProduct(productId, targetQty);
  }
};

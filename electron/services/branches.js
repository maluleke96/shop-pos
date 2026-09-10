const { getDb } = require('../database/db');

function softAlter(sql) {
  const db = getDb();
  try {
    db.exec(sql);
    return true;
  } catch (_) {
    return false;
  }
}

function isPgMode() {
  try {
    return require('../database/pg-db').isPgMode();
  } catch (_) {
    return false;
  }
}

function tableExists(name) {
  const db = getDb();
  const tbl = String(name || '').toLowerCase();
  try {
    if (isPgMode()) {
      const row = db.prepare(
        "SELECT 1 AS v FROM information_schema.tables WHERE table_schema = 'public' AND lower(table_name) = ? LIMIT 1"
      ).get(tbl);
      if (row?.v) return true;
    } else {
      const row = db.prepare(
        "SELECT 1 AS v FROM sqlite_master WHERE type='table' AND name = ? LIMIT 1"
      ).get(name);
      if (row?.v) return true;
    }
  } catch (_) { /* fall through */ }
  try {
    db.prepare(`SELECT 1 AS v FROM ${name} LIMIT 1`).get();
    return true;
  } catch (__) {
    return false;
  }
}

function hasColumn(table, column) {
  const col = String(column || '').toLowerCase();
  try {
    if (isPgMode()) {
      const row = getDb().prepare(
        "SELECT 1 AS v FROM information_schema.columns WHERE table_schema = 'public' AND lower(table_name) = ? AND lower(column_name) = ? LIMIT 1"
      ).get(String(table).toLowerCase(), col);
      return !!row?.v;
    }
    const rows = getDb().prepare(`PRAGMA table_info(${table})`).all();
    return rows.some((r) => String(r.name || '').toLowerCase() === col);
  } catch (_) {
    return false;
  }
}

let branchSchemaReady = false;
let branchSchemaFlags = null;

/** Soft-add multi-branch columns/tables so dashboards never die with "no such column: branch_id". */
function ensureBranchSchema() {
  if (branchSchemaReady && branchSchemaFlags) return branchSchemaFlags;
  softAlter('ALTER TABLE sales ADD COLUMN branch_id INTEGER DEFAULT 1');
  softAlter('ALTER TABLE products ADD COLUMN branch_id INTEGER DEFAULT 1');
  softAlter('ALTER TABLE users ADD COLUMN branch_id INTEGER');
  softAlter('ALTER TABLE expenses ADD COLUMN branch_id INTEGER');
  softAlter('ALTER TABLE employees ADD COLUMN branch_id INTEGER');
  softAlter('ALTER TABLE shop_settings ADD COLUMN branch_id INTEGER DEFAULT 1');
  softAlter('ALTER TABLE shop_settings ADD COLUMN view_branch_id INTEGER');
  softAlter('ALTER TABLE stock_movements ADD COLUMN branch_id INTEGER');
  softAlter('ALTER TABLE shifts ADD COLUMN branch_id INTEGER DEFAULT 1');
  softAlter('ALTER TABLE branches ADD COLUMN business_id INTEGER');
  if (!tableExists('branches')) {
    softAlter(`CREATE TABLE IF NOT EXISTS branches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      code TEXT UNIQUE,
      address TEXT,
      phone TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    )`);
  }
  if (!tableExists('branch_stock')) {
    softAlter(`CREATE TABLE IF NOT EXISTS branch_stock (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      branch_id INTEGER NOT NULL,
      quantity REAL NOT NULL DEFAULT 0,
      min_stock REAL DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(product_id, branch_id)
    )`);
  }
  if (!tableExists('branch_settings')) {
    softAlter(`CREATE TABLE IF NOT EXISTS branch_settings (
      branch_id INTEGER PRIMARY KEY,
      tax_enabled INTEGER DEFAULT 0,
      tax_rate REAL DEFAULT 0,
      tax_inclusive INTEGER DEFAULT 1,
      tax_show_on_pos INTEGER DEFAULT 1,
      vat_number TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    )`);
  }
  try {
    getDb().prepare(`
      INSERT OR IGNORE INTO branch_stock (product_id, branch_id, quantity, min_stock)
      SELECT p.id, COALESCE((SELECT branch_id FROM shop_settings WHERE id = 1), 1),
        COALESCE(p.stock_quantity, 0), COALESCE(p.min_stock, 0)
      FROM products p
    `).run();
  } catch (_) { /* optional seed */ }
  try {
    getDb().prepare(`
      UPDATE expenses SET branch_id = COALESCE((SELECT branch_id FROM shop_settings WHERE id = 1), 1)
      WHERE branch_id IS NULL
    `).run();
  } catch (_) { /* ignore */ }
  branchSchemaFlags = {
    sales: hasColumn('sales', 'branch_id'),
    expenses: hasColumn('expenses', 'branch_id'),
    users: hasColumn('users', 'branch_id'),
    branch_stock: tableExists('branch_stock')
  };
  branchSchemaReady = true;
  try { ensureDefaultBranch(); } catch (_) { /* optional on first boot */ }
  return branchSchemaFlags;
}

function syncBranchesIdSequence() {
  try {
    const { isPgMode } = require('../database/pg-db');
    if (!isPgMode()) return;
    getDb().prepare(
      "SELECT setval(pg_get_serial_sequence('branches', 'id'), GREATEST(1, (SELECT COALESCE(MAX(id), 1) FROM branches)))"
    ).get();
  } catch (_) { /* optional on SQLite */ }
}

/** Move branch_stock rows off deleted/missing branch ids onto the active branch. */
function repairOrphanBranchStock(validBranchId, orphanBranchId = null) {
  if (!validBranchId) return;
  const db = getDb();
  let orphanIds = [];
  if (orphanBranchId && !getBranch(orphanBranchId)) orphanIds.push(Number(orphanBranchId));
  try {
    const rows = db.prepare(`
      SELECT DISTINCT bs.branch_id AS id
      FROM branch_stock bs
      LEFT JOIN branches b ON b.id = bs.branch_id
      WHERE b.id IS NULL
    `).all();
    orphanIds = [...new Set([...orphanIds, ...rows.map((r) => Number(r.id)).filter(Boolean)])];
  } catch (_) { /* branch_stock may not exist */ }
  for (const badId of orphanIds) {
    if (!badId || badId === validBranchId) continue;
    try {
      db.prepare(`
        INSERT INTO branch_stock (product_id, branch_id, quantity, min_stock)
        SELECT product_id, ?, quantity, min_stock FROM branch_stock WHERE branch_id = ?
        ON CONFLICT (product_id, branch_id) DO UPDATE SET
          quantity = COALESCE(branch_stock.quantity, 0) + COALESCE(excluded.quantity, 0),
          min_stock = COALESCE(excluded.min_stock, branch_stock.min_stock)
      `).run(validBranchId, badId);
      db.prepare('DELETE FROM branch_stock WHERE branch_id = ?').run(badId);
    } catch (_) {
      try {
        db.prepare('UPDATE branch_stock SET branch_id = ? WHERE branch_id = ?').run(validBranchId, badId);
      } catch (__) { /* ignore */ }
    }
  }
}

/** Point shop_settings.branch_id at a real branch when it references a missing row. */
function repairShopSettingsBranchId() {
  const db = getDb();
  let configured = 0;
  try {
    configured = Number(db.prepare('SELECT branch_id FROM shop_settings WHERE id = 1').get()?.branch_id) || 0;
  } catch (_) {
    return null;
  }
  if (configured && getBranch(configured)) return configured;
  const first = db.prepare('SELECT id FROM branches ORDER BY id LIMIT 1').get();
  if (!first?.id) return null;
  const id = Number(first.id);
  try {
    db.prepare('UPDATE shop_settings SET branch_id = ? WHERE id = 1').run(id);
  } catch (_) { /* optional */ }
  repairOrphanBranchStock(id, configured || 1);
  return id;
}

function getBranches() {
  ensureDefaultBranch();
  return getDb().prepare('SELECT * FROM branches ORDER BY name').all();
}

function getBranch(id) {
  return getDb().prepare('SELECT * FROM branches WHERE id = ?').get(id);
}

function getBranchByCode(code) {
  return getDb().prepare('SELECT * FROM branches WHERE code = ?').get(String(code).toUpperCase());
}

/** Create the first real branch from shop settings (shop name, address, phone). */
function bootstrapInitialBranch() {
  ensureBranchSchema();
  const db = getDb();
  const existing = db.prepare('SELECT id FROM branches ORDER BY id LIMIT 1').get();
  if (existing?.id) return Number(existing.id);

  let shopName = 'Main Branch';
  let shopAddress = null;
  let shopPhone = null;
  try {
    const shop = db.prepare('SELECT shop_name, address, phone FROM shop_settings WHERE id = 1').get() || {};
    if (shop.shop_name?.trim()) shopName = shop.shop_name.trim();
    shopAddress = shop.address?.trim() || null;
    shopPhone = shop.phone?.trim() || null;
  } catch (_) { /* optional */ }

  let baseCode = String(shopName).replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toUpperCase() || 'MAIN';
  let code = baseCode;
  let n = 1;
  while (getBranchByCode(code)) {
    code = `${baseCode.slice(0, 6)}${n}`;
    n += 1;
  }

  let id = 0;
  if (!isPgMode()) {
    try {
      db.prepare(
        "INSERT INTO branches (id, name, code, address, phone, is_active) VALUES (1, ?, ?, ?, ?, 1)"
      ).run(shopName, code, shopAddress, shopPhone);
      id = 1;
    } catch (_) { /* fall through to auto id */ }
  }
  if (!id) {
    const r = db.prepare(
      'INSERT INTO branches (name, code, address, phone, is_active) VALUES (?, ?, ?, ?, 1)'
    ).run(shopName, code, shopAddress, shopPhone);
    id = Number(r.lastInsertRowid) || 0;
  }
  if (!id) throw new Error('Could not create initial branch');

  syncBranchesIdSequence();
  try {
    db.prepare('UPDATE shop_settings SET branch_id = ? WHERE id = 1').run(id);
  } catch (_) { /* optional */ }
  repairOrphanBranchStock(id);
  try {
    db.prepare(`
      INSERT INTO branch_stock (product_id, branch_id, quantity, min_stock)
      SELECT p.id, ?, COALESCE(p.stock_quantity, 0), COALESCE(p.min_stock, 0)
      FROM products p
      WHERE NOT EXISTS (
        SELECT 1 FROM branch_stock bs WHERE bs.product_id = p.id AND bs.branch_id = ?
      )
    `).run(id, id);
  } catch (_) { /* optional seed */ }
  try {
    const shop = db.prepare('SELECT tax_enabled, tax_rate, tax_inclusive, tax_show_on_pos, vat_number FROM shop_settings WHERE id = 1').get() || {};
    db.prepare(`
      INSERT INTO branch_settings (branch_id, tax_enabled, tax_rate, tax_inclusive, tax_show_on_pos, vat_number)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (branch_id) DO NOTHING
    `).run(
      id,
      shop.tax_enabled ? 1 : 0,
      Number(shop.tax_rate) || 0,
      shop.tax_inclusive !== 0 ? 1 : 0,
      shop.tax_show_on_pos !== 0 ? 1 : 0,
      shop.vat_number || null
    );
  } catch (_) {
    try {
      const shop = db.prepare('SELECT tax_enabled, tax_rate, tax_inclusive, tax_show_on_pos, vat_number FROM shop_settings WHERE id = 1').get() || {};
      db.prepare(`
        INSERT OR IGNORE INTO branch_settings (branch_id, tax_enabled, tax_rate, tax_inclusive, tax_show_on_pos, vat_number)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        id,
        shop.tax_enabled ? 1 : 0,
        Number(shop.tax_rate) || 0,
        shop.tax_inclusive !== 0 ? 1 : 0,
        shop.tax_show_on_pos !== 0 ? 1 : 0,
        shop.vat_number || null
      );
    } catch (__) { /* ignore */ }
  }
  return id;
}

/** Ensure a real branch exists and shop_settings.branch_id points at it (fixes Railway stock overlay). */
function ensureDefaultBranch() {
  ensureBranchSchema();
  const db = getDb();

  const repaired = repairShopSettingsBranchId();
  if (repaired) return repaired;

  let count = 0;
  try {
    count = Number(db.prepare('SELECT COUNT(*) AS c FROM branches').get()?.c) || 0;
  } catch (_) {
    count = 0;
  }
  if (count === 0) {
    try {
      return bootstrapInitialBranch();
    } catch (_) {
      /* fall through */
    }
  }

  let row = null;
  try {
    row = db.prepare('SELECT id FROM branches ORDER BY id LIMIT 1').get();
  } catch (_) { /* table missing */ }
  if (row?.id) {
    const id = Number(row.id);
    try {
      db.prepare('UPDATE shop_settings SET branch_id = ? WHERE id = 1').run(id);
    } catch (_) { /* optional */ }
    repairOrphanBranchStock(id);
    return id;
  }

  try {
    return bootstrapInitialBranch();
  } catch (_) {
    return 1;
  }
}

/** Resolve till branch for sales/shifts — prefers explicit till_branch_id from client (multi-POS cloud). */
function resolveTillBranchId(actor = null, opts = {}) {
  const explicit = opts.tillBranchId ?? opts.till_branch_id ?? opts.branch_id;
  if (explicit != null && explicit !== '' && getBranch(Number(explicit))) {
    return Number(explicit);
  }
  return resolveBranchScope(actor, { forceTill: true }).stampId;
}

function saveBranch(data) {
  const db = getDb();
  if (data.id) {
    db.prepare('UPDATE branches SET name=?, code=?, address=?, phone=?, is_active=? WHERE id=?')
      .run(data.name, String(data.code).toUpperCase(), data.address || null, data.phone || null, data.is_active !== false && data.is_active !== 0 ? 1 : 0, data.id);
    return getBranchDetail(data.id);
  }
  const r = db.prepare('INSERT INTO branches (name, code, address, phone) VALUES (?, ?, ?, ?)')
    .run(data.name, String(data.code).toUpperCase(), data.address || null, data.phone || null);
  const id = r.lastInsertRowid;
  try {
    const shop = db.prepare('SELECT tax_enabled, tax_rate, tax_inclusive, tax_show_on_pos, vat_number FROM shop_settings WHERE id = 1').get() || {};
    db.prepare(`
      INSERT OR IGNORE INTO branch_settings (branch_id, tax_enabled, tax_rate, tax_inclusive, tax_show_on_pos, vat_number)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, shop.tax_enabled ? 1 : 0, Number(shop.tax_rate) || 0, shop.tax_inclusive !== 0 ? 1 : 0, shop.tax_show_on_pos !== 0 ? 1 : 0, shop.vat_number || null);
  } catch (_) { /* ignore */ }
  return getBranchDetail(id);
}

function setActiveBranch(branchId) {
  const id = Number(branchId);
  if (!getBranch(id)) throw new Error('Branch not found');
  getDb().prepare('UPDATE shop_settings SET branch_id = ? WHERE id = 1').run(id);
  return getBranchDetail(id);
}

function getActiveBranch() {
  const id = ensureDefaultBranch();
  return getBranchDetail(id) || { id, name: 'Main Branch', code: 'MAIN' };
}

function setViewBranch(branchId) {
  const db = getDb();
  try {
    db.exec('ALTER TABLE shop_settings ADD COLUMN view_branch_id INTEGER');
  } catch (_) { /* exists */ }
  const v = branchId == null || branchId === '' || branchId === 'all' ? null : Number(branchId);
  if (v != null && !getBranch(v)) throw new Error('Branch not found');
  db.prepare('UPDATE shop_settings SET view_branch_id = ? WHERE id = 1').run(v);
  return { view_branch_id: v, branch: v ? getBranchDetail(v) : null };
}

function getViewBranch() {
  const db = getDb();
  let row;
  try {
    row = db.prepare('SELECT branch_id, view_branch_id FROM shop_settings WHERE id = 1').get();
  } catch (_) {
    row = db.prepare('SELECT branch_id FROM shop_settings WHERE id = 1').get();
  }
  const viewId = row?.view_branch_id != null ? Number(row.view_branch_id) : null;
  return {
    till_branch_id: row?.branch_id || 1,
    view_branch_id: viewId,
    view_all: viewId == null,
    branch: viewId ? getBranchDetail(viewId) : null,
    till_branch: getBranchDetail(row?.branch_id || 1)
  };
}

function resolveBranchScope(actor = null, opts = {}) {
  ensureBranchSchema();
  const db = getDb();
  const tillId = (() => {
    const fallback = ensureDefaultBranch();
    try {
      const fromSettings = Number(db.prepare('SELECT branch_id FROM shop_settings WHERE id = 1').get()?.branch_id) || fallback;
      return getBranch(fromSettings) ? fromSettings : fallback;
    } catch (_) {
      return fallback;
    }
  })();

  let viewId = null;
  try {
    viewId = db.prepare('SELECT view_branch_id FROM shop_settings WHERE id = 1').get()?.view_branch_id;
    if (viewId != null) viewId = Number(viewId);
  } catch (_) {
    viewId = null;
  }

  let user = null;
  if (actor?.id) {
    try {
      user = db.prepare('SELECT id, role, branch_id FROM users WHERE id = ?').get(actor.id);
    } catch (_) {
      try {
        user = db.prepare('SELECT id, role FROM users WHERE id = ?').get(actor.id);
      } catch (__) {
        user = null;
      }
    }
  }
  const role = user?.role || actor?.role || null;

  if (role === 'marketing_agent') {
    return { branchId: null, allBranches: true, tillId, role, stampId: tillId };
  }

  if (role === 'owner' || !role) {
    if (opts.forceTill) {
      return { branchId: tillId, allBranches: false, tillId, role: role || 'owner', stampId: tillId };
    }
    if (opts.branchId != null && opts.branchId !== '' && opts.branchId !== 'all') {
      return { branchId: Number(opts.branchId), allBranches: false, tillId, role: role || 'owner', stampId: Number(opts.branchId) };
    }
    if (viewId != null) {
      return { branchId: viewId, allBranches: false, tillId, role: role || 'owner', stampId: tillId };
    }
    return { branchId: null, allBranches: true, tillId, role: role || 'owner', stampId: tillId };
  }

  const bound = user?.branch_id != null ? Number(user.branch_id) : tillId;
  if (opts.forceTill && user?.branch_id != null && Number(user.branch_id) === Number(tillId)) {
    return { branchId: tillId, allBranches: false, tillId, role, stampId: tillId };
  }
  return { branchId: bound, allBranches: false, tillId, role, stampId: bound };
}

function assertUserTillBranch(user) {
  if (!user || user.role === 'owner') return { ok: true };
  const till = getActiveBranch();
  const tillId = Number(till?.id || 1);
  if (user.branch_id == null || user.branch_id === '') return { ok: true };
  if (Number(user.branch_id) === tillId) return { ok: true };
  const userBranch = getBranch(user.branch_id);
  const tillBranch = till || getBranch(tillId);
  return {
    ok: false,
    error: `This till is connected to "${tillBranch?.name || 'another branch'}". Your account belongs to "${userBranch?.name || 'a different branch'}". Ask Admin to connect this computer to your branch, or sign in with an account for this branch.`
  };
}

function getBranchStaffSummary(branchId) {
  const db = getDb();
  const users = db.prepare(`
    SELECT id, username, full_name, role, is_active, branch_id
    FROM users WHERE is_active = 1 AND branch_id = ?
    ORDER BY
      CASE role WHEN 'manager' THEN 1 WHEN 'supervisor' THEN 2 WHEN 'cashier' THEN 3 ELSE 4 END,
      full_name
  `).all(branchId);
  const managers = users.filter((u) => u.role === 'manager');
  const supervisors = users.filter((u) => u.role === 'supervisor');
  const cashiers = users.filter((u) => u.role === 'cashier');
  const others = users.filter((u) => !['manager', 'supervisor', 'cashier'].includes(u.role));
  return { managers, supervisors, cashiers, others, users };
}

function getBranchDetail(id) {
  const b = getBranch(id);
  if (!b) return null;
  const staff = getBranchStaffSummary(id);
  let settings = null;
  try {
    settings = getDb().prepare('SELECT * FROM branch_settings WHERE branch_id = ?').get(id) || null;
  } catch (_) { /* ignore */ }
  let stockSku = 0;
  try {
    stockSku = getDb().prepare('SELECT COUNT(*) as c FROM branch_stock WHERE branch_id = ? AND quantity > 0').get(id)?.c || 0;
  } catch (_) { /* ignore */ }
  let salesToday = 0;
  try {
    salesToday = getDb().prepare(`
      SELECT COALESCE(SUM(total),0) as v FROM sales
      WHERE branch_id = ? AND status='completed' AND date(created_at,'localtime') = date('now','localtime')
    `).get(id)?.v || 0;
  } catch (_) { /* ignore */ }
  return {
    ...b,
    staff,
    settings,
    stock_skus: stockSku,
    sales_today: salesToday,
    manager: staff.managers[0] || null,
    supervisor: staff.supervisors[0] || null,
    cashier_count: staff.cashiers.length
  };
}

function getBranchesDetailed() {
  return getBranches().map((b) => getBranchDetail(b.id));
}

function saveBranchSettings(branchId, data) {
  const id = Number(branchId);
  if (!getBranch(id)) throw new Error('Branch not found');
  const db = getDb();
  const existing = db.prepare('SELECT branch_id FROM branch_settings WHERE branch_id = ?').get(id);
  const patch = {
    tax_enabled: data.tax_enabled ? 1 : 0,
    tax_rate: Number(data.tax_rate) || 0,
    tax_inclusive: data.tax_inclusive !== false && data.tax_inclusive !== 0 ? 1 : 0,
    tax_show_on_pos: data.tax_show_on_pos !== false && data.tax_show_on_pos !== 0 ? 1 : 0,
    vat_number: data.vat_number || null
  };
  if (existing) {
    db.prepare(`
      UPDATE branch_settings SET tax_enabled=?, tax_rate=?, tax_inclusive=?, tax_show_on_pos=?, vat_number=?, updated_at=datetime('now')
      WHERE branch_id=?
    `).run(patch.tax_enabled, patch.tax_rate, patch.tax_inclusive, patch.tax_show_on_pos, patch.vat_number, id);
  } else {
    db.prepare(`
      INSERT INTO branch_settings (branch_id, tax_enabled, tax_rate, tax_inclusive, tax_show_on_pos, vat_number)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, patch.tax_enabled, patch.tax_rate, patch.tax_inclusive, patch.tax_show_on_pos, patch.vat_number);
  }
  return getBranchDetail(id);
}

function ensureBranchStockRow(productId, branchId) {
  ensureBranchSchema();
  const db = getDb();
  const pid = Number(productId);
  let bid = Number(branchId) || ensureDefaultBranch();
  if (!getBranch(bid)) bid = ensureDefaultBranch();
  let row = null;
  try {
    row = db.prepare('SELECT * FROM branch_stock WHERE product_id = ? AND branch_id = ?').get(pid, bid);
  } catch (_) {
    return { product_id: pid, branch_id: bid, quantity: 0, min_stock: 0 };
  }
  if (row) return row;
  const product = db.prepare('SELECT stock_quantity, min_stock FROM products WHERE id = ?').get(pid);
  const qty = Number(product?.stock_quantity) || 0;
  const min = Number(product?.min_stock) || 0;
  try {
    db.prepare(`
      INSERT INTO branch_stock (product_id, branch_id, quantity, min_stock) VALUES (?, ?, ?, ?)
    `).run(pid, bid, qty, min);
  } catch (_) {
    try {
      db.prepare(`
        UPDATE branch_stock SET quantity = ?, min_stock = ?, updated_at = datetime('now')
        WHERE product_id = ? AND branch_id = ?
      `).run(qty, min, pid, bid);
    } catch (__) { /* fall through */ }
  }
  row = db.prepare('SELECT * FROM branch_stock WHERE product_id = ? AND branch_id = ?').get(pid, bid);
  if (row) return row;
  throw new Error(`Could not create branch stock row for product #${pid} (branch ${bid})`);
}

function getBranchStockQuantity(productId, branchId) {
  const row = ensureBranchStockRow(productId, branchId);
  return Number(row?.quantity) || 0;
}

function adjustBranchStock(productId, quantity, type, notes, userId, refType, refId, branchId) {
  const db = getDb();
  const bid = ensureDefaultBranch(Number(branchId) || resolveBranchScope(null, { forceTill: true }).stampId);
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
  if (!product) throw new Error('Product not found');
  const row = ensureBranchStockRow(productId, bid);
  const prev = Number(row.quantity) || 0;
  let newStock;
  let moveQty = Math.abs(Number(quantity) || 0);
  if (type === 'set') {
    newStock = Number(quantity) || 0;
    moveQty = Math.abs(newStock - prev);
  } else if (type === 'remove' || type === 'sale') {
    newStock = prev - (Number(quantity) || 0);
  } else {
    newStock = prev + (Number(quantity) || 0);
  }
  try {
    db.prepare(`
      INSERT INTO branch_stock (product_id, branch_id, quantity, min_stock, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(product_id, branch_id) DO UPDATE SET
        quantity = excluded.quantity,
        updated_at = datetime('now')
    `).run(productId, bid, newStock, row.min_stock ?? product.min_stock ?? 0);
  } catch (_) {
    db.prepare(`
      UPDATE branch_stock SET quantity = ?, updated_at = datetime('now') WHERE product_id = ? AND branch_id = ?
    `).run(newStock, productId, bid);
  }
  let total = newStock;
  try {
    const sum = Number(db.prepare('SELECT COALESCE(SUM(quantity),0) AS v FROM branch_stock WHERE product_id = ?').get(productId)?.v);
    if (Number.isFinite(sum) && sum > 0) total = sum;
  } catch (_) { /* keep newStock */ }
  db.prepare(`UPDATE products SET stock_quantity = ?, updated_at = datetime('now') WHERE id = ?`).run(total, productId);
  try {
    db.prepare(`
      INSERT INTO stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, reference_type, reference_id, notes, user_id, branch_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(productId, type === 'set' ? 'adjust' : type, moveQty, prev, newStock, refType, refId, notes, userId, bid);
  } catch (_) {
    db.prepare(`
      INSERT INTO stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, reference_type, reference_id, notes, user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(productId, type === 'set' ? 'adjust' : type, moveQty, prev, newStock, refType, refId, notes, userId);
  }
  const verified = db.prepare('SELECT quantity FROM branch_stock WHERE product_id = ? AND branch_id = ?').get(productId, bid);
  const finalQty = Number(verified?.quantity);
  if (!Number.isFinite(finalQty)) {
    throw new Error(`Branch stock row missing after update for product #${productId} (branch ${bid})`);
  }
  if (Math.abs(finalQty - newStock) > 0.0001) {
    throw new Error(`Branch stock save failed for product #${productId} (expected ${newStock}, got ${finalQty})`);
  }
  return finalQty;
}

function assertBranchRoleSlot(role, branchId, excludeUserId = null) {
  if (!branchId) return;
  if (role !== 'manager' && role !== 'supervisor') return;
  const db = getDb();
  let sql = `SELECT COUNT(*) as c FROM users WHERE role = ? AND is_active = 1 AND branch_id = ?`;
  const params = [role, branchId];
  if (excludeUserId) {
    sql += ' AND id != ?';
    params.push(excludeUserId);
  }
  const c = db.prepare(sql).get(...params)?.c || 0;
  if (c >= 1) {
    throw new Error(`This branch already has a ${role}. Only one is allowed per branch.`);
  }
}

module.exports = {
  getBranches,
  getBranch,
  getBranchByCode,
  saveBranch,
  setActiveBranch,
  getActiveBranch,
  setViewBranch,
  getViewBranch,
  resolveBranchScope,
  assertUserTillBranch,
  getBranchStaffSummary,
  getBranchDetail,
  getBranchesDetailed,
  saveBranchSettings,
  ensureBranchStockRow,
  getBranchStockQuantity,
  adjustBranchStock,
  ensureDefaultBranch,
  bootstrapInitialBranch,
  resolveTillBranchId,
  assertBranchRoleSlot,
  ensureBranchSchema,
  hasColumn,
  tableExists
};

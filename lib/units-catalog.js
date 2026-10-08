/**
 * Units of measure — admin-extensible catalog + helpers.
 * Conversions delegate to recipe-food-cost (single source for mass/volume/count paths).
 */
const { getDb } = require('../electron/database/db');

const DEFAULT_UNITS = [
  { code: 'kg', label: 'Kilogram (kg)', kind: 'mass' },
  { code: 'g', label: 'Gram (g)', kind: 'mass' },
  { code: 'mg', label: 'Milligram (mg)', kind: 'mass' },
  { code: 'L', label: 'Litre (L)', kind: 'volume' },
  { code: 'mL', label: 'Millilitre (mL)', kind: 'volume' },
  { code: 'each', label: 'Each', kind: 'count' },
  { code: 'piece', label: 'Piece', kind: 'count' },
  { code: 'unit', label: 'Unit', kind: 'count' },
  { code: 'dozen', label: 'Dozen', kind: 'count' },
  { code: 'pack', label: 'Pack', kind: 'packaging' },
  { code: 'packet', label: 'Packet', kind: 'packaging' },
  { code: 'box', label: 'Box', kind: 'packaging' },
  { code: 'crate', label: 'Crate', kind: 'packaging' },
  { code: 'bag', label: 'Bag', kind: 'packaging' },
  { code: 'bottle', label: 'Bottle', kind: 'packaging' },
  { code: 'tin', label: 'Tin', kind: 'packaging' },
  { code: 'tray', label: 'Tray', kind: 'packaging' },
  { code: 'bunch', label: 'Bunch', kind: 'packaging' },
  { code: 'roll', label: 'Roll', kind: 'packaging' }
];

function ensureSchema() {
  const db = getDb();
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS units_catalog (
      code TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'count',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    )`);
  } catch (_) { /* pg */ }
  for (const u of DEFAULT_UNITS) {
    try {
      db.prepare(`INSERT OR IGNORE INTO units_catalog (code, label, kind, is_active) VALUES (?,?,?,1)`)
        .run(u.code, u.label, u.kind);
    } catch (_) {
      try {
        db.prepare(`INSERT INTO units_catalog (code, label, kind, is_active) VALUES (?,?,?,1) ON CONFLICT (code) DO NOTHING`)
          .run(u.code, u.label, u.kind);
      } catch (__) { /* */ }
    }
  }
}

function listUnits(activeOnly = true) {
  ensureSchema();
  let sql = 'SELECT code, label, kind, is_active FROM units_catalog';
  if (activeOnly) sql += ' WHERE is_active = 1';
  sql += ' ORDER BY kind, label';
  try {
    return getDb().prepare(sql).all();
  } catch (_) {
    return DEFAULT_UNITS.map((u) => ({ ...u, is_active: 1 }));
  }
}

function saveUnit(data, actor) {
  ensureSchema();
  const code = String(data.code || '').trim();
  const label = String(data.label || code).trim();
  const kind = String(data.kind || 'count').trim();
  if (!code) throw new Error('Unit code is required');
  const db = getDb();
  const exists = db.prepare('SELECT code FROM units_catalog WHERE code = ?').get(code);
  if (exists) {
    db.prepare('UPDATE units_catalog SET label = ?, kind = ?, is_active = ? WHERE code = ?')
      .run(label, kind, data.is_active === false || data.is_active === 0 ? 0 : 1, code);
  } else {
    db.prepare('INSERT INTO units_catalog (code, label, kind, is_active) VALUES (?,?,?,1)')
      .run(code, label, kind);
  }
  try {
    getDb().prepare(`INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, details)
      VALUES (?,?,?,?,?,?)`).run(actor?.id || null, actor?.username || 'system', 'save_unit', 'units_catalog', code,
      JSON.stringify({ code, label, kind }));
  } catch (_) { /* */ }
  return { code, label, kind, is_active: 1 };
}

function convertForProduct(productId, qty, fromUnit, toUnit) {
  const rfc = require('../electron/services/recipe-food-cost');
  return rfc.convertUnits(productId, qty, fromUnit, toUnit);
}

function stockUnitOfProduct(productId) {
  const row = getDb().prepare('SELECT stock_unit, unit FROM products WHERE id = ?').get(Number(productId));
  return row?.stock_unit || row?.unit || 'each';
}

module.exports = {
  ensureSchema,
  listUnits,
  saveUnit,
  convertForProduct,
  stockUnitOfProduct,
  DEFAULT_UNITS
};

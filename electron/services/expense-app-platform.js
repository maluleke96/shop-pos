/**
 * Mobile Expenses app — token sessions for POS users with expense_capture permission.
 */
const bcrypt = require('bcryptjs');
const {
  dbGet, dbAll, dbRun, nowIso, nowPlusDays, hashToken, newToken, parseJson
} = require('./biz-modules-common');
const { hasUserPermission, loadUserById } = require('./authz');

const PERM = 'expense_capture';

function ensureSchema() {
  const runMigration = (file) => {
    try {
      const fs = require('fs');
      const path = require('path');
      const p = path.join(__dirname, '../database', file);
      if (!fs.existsSync(p)) return;
      const sql = fs.readFileSync(p, 'utf8');
      for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) {
        try { require('../database/db').getDb().exec(stmt + ';'); } catch (e) {
          if (!/already exists|duplicate column/i.test(String(e.message))) { /* */ }
        }
      }
    } catch (_) { /* */ }
  };
  try { dbGet('SELECT 1 FROM expense_app_sessions LIMIT 1'); } catch (_) {
    runMigration('migrations-v97-expense-app.sql');
  }
  try { dbGet('SELECT invoice_path FROM expenses LIMIT 1'); } catch (_) {
    runMigration('migrations-v98-expense-invoice.sql');
  }
  try { dbGet('SELECT line_items_json FROM expenses LIMIT 1'); } catch (_) {
    runMigration('migrations-v99-expense-line-items.sql');
  }
  try { dbGet('SELECT expense_categories FROM shop_settings LIMIT 1'); } catch (_) {
    runMigration('migrations-v100-expense-settings.sql');
  }
  try { dbGet('SELECT 1 FROM expense_permission_grants LIMIT 1'); } catch (_) {
    runMigration('migrations-v102-expense-permission-grants.sql');
  }
  try { dbGet('SELECT 1 FROM expense_invoices LIMIT 1'); } catch (_) {
    runMigration('migrations-v103-expense-invoice-data.sql');
  }
  try {
    const db = require('../database/db').getDb();
    db.prepare("INSERT INTO expenses (category, description, amount, user_id) VALUES ('__test_cat__', 'test', 0.01, NULL)").run();
    db.prepare("DELETE FROM expenses WHERE category = '__test_cat__'").run();
  } catch (_) {
    runMigration('migrations-v101-expense-category-free.sql');
  }
}

function userCanCaptureExpenses(user) {
  if (!user || user.is_active === false || user.is_active === 0) return false;
  return hasUserPermission(user, PERM);
}

function resolveSession(token) {
  ensureSchema();
  if (!token) throw new Error('Not authenticated');
  const row = dbGet(`
    SELECT s.id AS session_id, s.expires_at, u.*
    FROM expense_app_sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `, [hashToken(token), nowIso()]);
  if (!row) throw new Error('Session expired — please sign in again');
  if (!userCanCaptureExpenses(row)) {
    dbRun('DELETE FROM expense_app_sessions WHERE id = ?', [row.session_id]);
    throw new Error('Your account is not allowed to capture expenses. Ask your administrator.');
  }
  return row;
}

function expenseLogin(username, password, device = {}) {
  ensureSchema();
  const user = dbGet('SELECT * FROM users WHERE lower(username) = lower(?)', [String(username || '').trim()]);
  if (!user) throw new Error('Invalid username or password');
  if (user.is_active === false || user.is_active === 0) {
    throw new Error('Account deactivated — contact your administrator.');
  }
  if (!user.password_hash || !bcrypt.compareSync(String(password || ''), user.password_hash)) {
    throw new Error('Invalid username or password');
  }
  if (!userCanCaptureExpenses(user)) {
    throw new Error('You do not have permission to use the Expenses app. Ask your administrator to enable "Capture expenses (mobile app)".');
  }
  const token = newToken();
  const exp = nowPlusDays(30);
  dbRun(`
    INSERT INTO expense_app_sessions (user_id, token_hash, device_name, platform, expires_at)
    VALUES (?,?,?,?,?)
  `, [user.id, hashToken(token), device.device_name || null, device.platform || 'web', exp]);
  return {
    token,
    user: {
      id: user.id,
      username: user.username,
      full_name: user.full_name,
      role: user.role,
      branch_id: user.branch_id || null
    }
  };
}

function expenseLogout(token) {
  ensureSchema();
  dbRun('DELETE FROM expense_app_sessions WHERE token_hash = ?', [hashToken(token)]);
  return { success: true };
}

function expenseProfile(token) {
  const u = resolveSession(token);
  return {
    id: u.id,
    username: u.username,
    full_name: u.full_name,
    role: u.role,
    branch_id: u.branch_id || null
  };
}

function mapExpenseRow(row) {
  const ed = require('../../lib/expense-documents');
  const li = require('../../lib/expense-line-items');
  let line_items = li.parseLineItems(row.line_items_json);
  if (row?.id && line_items.length) {
    line_items = line_items.map((r, idx) => {
      if (r.photo_path || r.photo_url) {
        return {
          ...r,
          photo_url: r.photo_url || `/api/expense-line-photo/${row.id}/${idx}`
        };
      }
      return r;
    });
  }
  const { invoice_data, ...rest } = row || {};
  return {
    ...rest,
    line_items,
    has_invoice: ed.hasInvoice(row),
    invoice_url: ed.resolveInvoiceUrl(row)
  };
}

function expenseList(token, filters = {}) {
  const u = resolveSession(token);
  const store = require('./store');
  const from = filters.from || null;
  const to = filters.to || null;
  let rows = store.getExpenses({
    from,
    to,
    category: filters.category || null,
    actor: { id: u.id, role: u.role, branch_id: u.branch_id }
  });
  if (!['owner', 'manager'].includes(u.role)) {
    rows = rows.filter((r) => Number(r.user_id) === Number(u.id));
  }
  const limit = Math.min(Math.max(Number(filters.limit) || 50, 1), 200);
  return rows.slice(0, limit).map(mapExpenseRow);
}

function onceForClient(data, method, u, fn) {
  return require('./expense-extras').idempotent(data && data.client_request_id, method, u.id, fn);
}

function expenseSave(token, data = {}) {
  const u = resolveSession(token);
  return onceForClient(data, 'save', u, () => _expenseSave(u, data));
}

function _expenseSave(u, data) {
  const store = require('./store');
  const payload = {
    category: data.category,
    description: data.description || data.notes || '',
    notes: data.notes || data.description || '',
    amount: data.amount,
    expense_date: data.expense_date,
    branch_id: data.branch_id != null ? data.branch_id : u.branch_id,
    line_items: data.line_items || [],
    payment_method: data.payment_method || 'cash',
    funding_source: data.funding_source || 'business',
    cash_source: data.cash_source || 'today',
    invoice_image: data.invoice_image || null,
    stock_edit_reason: data.stock_edit_reason || null
  };
  if (data.id && ['owner', 'manager'].includes(u.role)) payload.id = Number(data.id);
  const id = store.saveExpense(payload, u.id, u.username);
  const row = store.getExpenseById(id) || { id, user_id: u.id, user_name: u.full_name || u.username };
  if (data.invoice_image && !row.invoice_path) {
    row.invoice_path = `expense-docs/${id}/invoice.jpg`;
    row.has_invoice = true;
  }
  return mapExpenseRow(row);
}

function requireOwnerOrManager(u, what) {
  if (!['owner', 'manager'].includes(u.role)) {
    throw new Error(`Only owners and managers can ${what}`);
  }
}

function expenseRecordWithdrawal(token, data = {}) {
  const u = resolveSession(token);
  requireOwnerOrManager(u, 'record money withdrawals');
  return onceForClient(data, 'recordWithdrawal', u, () => require('./store').recordMoneyWithdrawal(data || {}, actorFromSession(u)));
}

function expenseWithdrawals(token, filters = {}) {
  const u = resolveSession(token);
  requireOwnerOrManager(u, 'view money withdrawals');
  return require('./store').listMoneyWithdrawals(filters || {});
}

function dailyMoneyFilters(u, filters) {
  requireOwnerOrManager(u, 'view the daily money report');
  const f = { ...(filters || {}) };
  if (u.role === 'manager' && u.branch_id && (f.branch_id == null || f.branch_id === 'all' || f.branch_id === '')) {
    f.branch_id = u.branch_id;
  }
  return f;
}

function ownerWhatsAppNumber() {
  try {
    const s = require('./store').getSettingsParsed() || {};
    let ws = s.whatsapp_settings || {};
    if (typeof ws === 'string') ws = JSON.parse(ws);
    return String(ws.cashout_whatsapp_phone || s.phone || '').trim();
  } catch (_) {
    return '';
  }
}

function expenseDailyMoney(token, filters = {}) {
  const u = resolveSession(token);
  const report = require('./store').dailyMoneyReport(dailyMoneyFilters(u, filters));
  return { ...report, shop: expenseShopSettings(), owner_whatsapp: ownerWhatsAppNumber() };
}

function expenseDailyMoneyPdf(token, filters = {}) {
  const u = resolveSession(token);
  const out = require('./store').dailyMoneyPdf(dailyMoneyFilters(u, filters), { by: u.full_name || u.username });
  return { filename: out.filename, base64: out.base64 };
}

function expenseBranches(token) {
  resolveSession(token);
  try {
    return require('../database/db').getDb().prepare('SELECT * FROM branches ORDER BY id').all()
      .filter((b) => b.is_active == null || Number(b.is_active) === 1 || b.is_active === true);
  } catch (_) {
    return [];
  }
}

function expenseOwnerFundings(token, filters = {}) {
  const u = resolveSession(token);
  if (!['owner', 'manager'].includes(u.role)) {
    throw new Error('Only owners and managers can view owner funding');
  }
  const store = require('./store');
  return store.listOwnerFundings(filters || {});
}

function expenseRecordOwnerFunding(token, data = {}) {
  const u = resolveSession(token);
  if (!['owner', 'manager'].includes(u.role)) {
    throw new Error('Only owners and managers can record cash injections');
  }
  const store = require('./store');
  return onceForClient(data, 'recordOwnerFunding', u, () => store.recordOwnerFunding(data || {}, {
    id: u.id,
    username: u.username,
    full_name: u.full_name || u.username,
    role: u.role
  }));
}

function expenseCategories() {
  const store = require('./store');
  return store.getExpenseCategories();
}

function expenseGet(token, id) {
  const u = resolveSession(token);
  const store = require('./store');
  const row = store.getExpenseById(id);
  if (!row) throw new Error('Expense not found');
  if (!['owner', 'manager'].includes(u.role) && Number(row.user_id) !== Number(u.id)) {
    throw new Error('You do not have access to this expense');
  }
  return mapExpenseRow(row);
}

function parsePermissions(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch (_) { return {}; }
}

function expenseGrantAccess(data = {}) {
  ensureSchema();
  const store = require('./store');
  const grantsLib = require('../../lib/expense-permission-grants');
  const granteeUsername = String(data.grantee_username || '').trim();
  const granteePassword = String(data.grantee_password || '');
  const approverUsername = String(data.approver_username || '').trim();
  const approverPassword = String(data.approver_password || '');
  if (!granteeUsername || !granteePassword) throw new Error('Worker username and password are required');
  if (!approverUsername || !approverPassword) throw new Error('Supervisor username and password are required');
  if (!data.photo_data) throw new Error('Supervisor photo is required');
  if (!data.audio_data) throw new Error('Supervisor voice recording is required');

  const approver = dbGet('SELECT * FROM users WHERE lower(username) = lower(?)', [approverUsername]);
  if (!approver || !approver.password_hash || !bcrypt.compareSync(approverPassword, approver.password_hash)) {
    throw new Error('Invalid supervisor username or password');
  }
  if (!['owner', 'manager', 'supervisor', 'assistant_manager'].includes(approver.role)) {
    throw new Error('Only a supervisor or manager can grant expense permission');
  }

  const grantee = dbGet('SELECT * FROM users WHERE lower(username) = lower(?)', [granteeUsername]);
  if (!grantee) throw new Error('Worker account not found');
  if (!grantee.password_hash || !bcrypt.compareSync(granteePassword, grantee.password_hash)) {
    throw new Error('Worker password does not match');
  }

  const ins = dbRun(`
    INSERT INTO expense_permission_grants (
      grantee_user_id, grantee_username, grantee_full_name,
      approver_user_id, approver_username, approver_full_name, approver_role, approver_branch_id,
      device_info
    ) VALUES (?,?,?,?,?,?,?,?,?)
  `, [
    grantee.id, grantee.username, grantee.full_name || grantee.username,
    approver.id, approver.username, approver.full_name || approver.username, approver.role, approver.branch_id || null,
    JSON.stringify(data.device || {})
  ]);
  const grantId = ins?.lastInsertRowid || dbGet('SELECT MAX(id) AS id FROM expense_permission_grants')?.id;
  if (!grantId) throw new Error('Could not save permission grant');

  const media = grantsLib.saveGrantMedia(grantId, data.photo_data, data.audio_data);
  dbRun('UPDATE expense_permission_grants SET photo_path = ?, recording_path = ? WHERE id = ?', [
    media.photoPath, media.recordingPath, grantId
  ]);

  const perms = parsePermissions(grantee.permissions);
  perms.expense_capture = true;
  store.updateUser(grantee.id, { permissions: perms }, approver.id, approver.username || approver.full_name);

  try {
    store.audit(approver.id, approver.username || approver.full_name, 'expense_permission_granted', 'expense_permission_grant', grantId, {
      grantee_id: grantee.id,
      grantee_username: grantee.username,
      grantee_full_name: grantee.full_name,
      approver_id: approver.id,
      approver_full_name: approver.full_name,
      approver_role: approver.role,
      photo_url: grantsLib.publicGrantPhotoUrl(grantId),
      recording_url: grantsLib.publicGrantRecordingUrl(grantId)
    });
  } catch (_) { /* audit optional */ }

  return expenseLogin(granteeUsername, granteePassword, data.device || {});
}

function expenseShopSettings() {
  ensureSchema();
  const store = require('./store');
  let settings = {};
  try { settings = store.getSettingsParsed?.() || store.getSettings?.() || {}; } catch (_) { /* */ }
  if (typeof settings === 'string') {
    try { settings = JSON.parse(settings); } catch (_) { settings = {}; }
  }
  return {
    shop_name: settings.shop_name || 'Shop POS',
    currency: settings.currency || 'R',
    logo_path: settings.logo_path || null,
    address: settings.address || '',
    phone: settings.phone || '',
    email: settings.email || '',
    vat_number: settings.vat_number || ''
  };
}

function expenseWasteProducts(token) {
  resolveSession(token);
  try {
    const store = require('./store');
    if (typeof store.getExpenseProductCatalog === 'function') {
      return store.getExpenseProductCatalog();
    }
    return require('../database/db').getDb().prepare(`
      SELECT id, name, stock_quantity, stock_unit AS unit, buying_price, item_type
      FROM products WHERE COALESCE(is_active,1)=1 AND name != '__Property Damage__'
      ORDER BY name`).all();
  } catch (_) {
    return [];
  }
}

function expenseWasteList(token, filters = {}) {
  const u = resolveSession(token);
  const store = require('./store');
  const from = filters.from || null;
  const to = filters.to || null;
  let rows = store.getWasteRecords(from, to, { status: filters.status || null });
  if (!['owner', 'manager'].includes(u.role)) {
    rows = rows.filter((r) => Number(r.employee_id) === Number(u.id));
  }
  return rows.slice(0, 80);
}

function expenseWasteRecord(token, data = {}) {
  const u = resolveSession(token);
  return onceForClient(data, 'wasteRecord', u, () => _expenseWasteRecord(u, data));
}

function _expenseWasteRecord(u, data) {
  const store = require('./store');
  const id = store.recordWaste({
    damage_kind: data.damage_kind || (data.product_id ? 'ingredient' : 'property'),
    product_id: data.product_id || null,
    property_name: data.property_name || data.description || null,
    quantity: data.quantity,
    reason: data.reason || 'Damaged',
    notes: data.notes || '',
    photo_image: data.photo_image || data.photo_data || null,
    photo_path_1: data.photo_path_1 || null
  }, u.id);
  return { id, status: 'pending' };
}

function actorFromSession(u) {
  return {
    id: u.id,
    username: u.username,
    full_name: u.full_name,
    role: u.role
  };
}

function expenseStockBatchProducts(token) {
  resolveSession(token);
  try {
    return require('../database/db').getDb().prepare(`
      SELECT id, name, selling_price, unit, stock_unit, stock_quantity
      FROM products WHERE COALESCE(is_active,1)=1 AND name != '__Property Damage__'
      ORDER BY name LIMIT 800`).all();
  } catch (_) {
    return [];
  }
}

function expenseStockBatchDashboard(token, filters = {}) {
  resolveSession(token);
  return require('./stock-batch-yield').dashboard(filters || {});
}

function expenseStockBatchList(token, filters = {}) {
  resolveSession(token);
  return require('./stock-batch-yield').listBatches(filters || {});
}

function expenseStockBatchGet(token, id) {
  resolveSession(token);
  return require('./stock-batch-yield').getBatch(id);
}

function expenseStockBatchCreate(token, data = {}) {
  const u = resolveSession(token);
  return onceForClient(data, 'stockBatchCreate', u, () => require('./stock-batch-yield').createBatch(data || {}, actorFromSession(u)));
}

function expenseStockBatchUpdate(token, id, data = {}) {
  const u = resolveSession(token);
  return require('./stock-batch-yield').updateBatch(id, data || {}, actorFromSession(u));
}

function expenseStockBatchWaste(token, id, data = {}) {
  const u = resolveSession(token);
  return require('./stock-batch-yield').recordWaste(id, data || {}, actorFromSession(u));
}

function expenseStockBatchSetActualYield(token, id, yieldVal) {
  const u = resolveSession(token);
  return require('./stock-batch-yield').setActualYield(id, yieldVal, actorFromSession(u));
}

function expenseStockBatchClose(token, id, reason) {
  const u = resolveSession(token);
  return require('./stock-batch-yield').closeBatch(id, actorFromSession(u), reason);
}

function expenseStockBatchReopen(token, id) {
  const u = resolveSession(token);
  return require('./stock-batch-yield').reopenBatch(id, actorFromSession(u));
}

function expenseStockBatchCancel(token, id, reason) {
  const u = resolveSession(token);
  return require('./stock-batch-yield').cancelBatch(id, actorFromSession(u), reason);
}

function expenseStockBatchEvents(token, id, limit) {
  resolveSession(token);
  return require('./stock-batch-yield').listEvents(id, limit);
}

function expenseStockBatchMealsUsing(token, stockProductId) {
  resolveSession(token);
  return require('./stock-batch-yield').listMealsUsingIngredient(stockProductId);
}

module.exports = {
  ensureSchema,
  expenseLogin,
  expenseLogout,
  expenseGrantAccess,
  expenseProfile,
  expenseList,
  expenseSave,
  expenseGet,
  expenseCategories,
  expenseShopSettings,
  expenseOwnerFundings,
  expenseRecordOwnerFunding,
  expenseRecordWithdrawal,
  expenseWithdrawals,
  expenseDailyMoney,
  expenseDailyMoneyPdf,
  ownerWhatsAppNumber,
  expenseBranches,
  expenseWasteProducts,
  expenseWasteList,
  expenseWasteRecord,
  expenseStockBatchProducts,
  expenseStockBatchDashboard,
  expenseStockBatchList,
  expenseStockBatchGet,
  expenseStockBatchCreate,
  expenseStockBatchUpdate,
  expenseStockBatchWaste,
  expenseStockBatchSetActualYield,
  expenseStockBatchClose,
  expenseStockBatchReopen,
  expenseStockBatchCancel,
  expenseStockBatchEvents,
  expenseStockBatchMealsUsing,
  expenseUnitsList: (token) => {
    resolveSession(token);
    return require('../../lib/units-catalog').listUnits(true);
  },
  expenseSearchIngredients: (token, q, limit) => {
    resolveSession(token);
    return require('./expense-stock').searchIngredients(q, limit);
  }
};

const bcrypt = require('bcryptjs');
const fs = require('fs');
const deviceSettings = require('./deviceSettings');
const { hashPin, verifyPin, verifyPinWithUpgrade } = require('./pin');
const { getDb } = require('../database/db');
const session = require('./session');
const { assertUserActor } = require('./authz');
const staff = require('./staff');
const hrContracts = require('./hr-contracts');
const staffSelfies = require('./staff-selfies');
const ownerSalary = require('./owner-salary');
const bookkeeping = require('./bookkeeping');
const features = require('./features');
const auditSvc = require('./audit');
const inventory = require('./inventory');
const syncSvc = require('./sync');
const branchesSvc = require('./branches');
const donationsSvc = require('./donations');
const opsComplianceSvc = require('./operations-compliance');
const promoRequestsSvc = require('./promo-requests');
const combosSvc = require('./combos');
const flyersSvc = require('./flyers');
const marketingAgentSvc = require('./marketing-agent');
const marketingPlatformRaw = require('./marketing-platform');
const { adjustLoyaltyPoints: adjustMarketingLoyaltyPoints, ...marketingPlatformSvc } = marketingPlatformRaw;
const whatsappSvc = require('./whatsapp');
const documentHubSvc = require('./document-hub');
const customerRewardsSvc = require('./customer-rewards');
const employeeOfMonthSvc = require('./employee-of-month');
const hrTrainingSvc = require('./hr-training');
const recruitmentSvc = require('./recruitment');

function accHook(fn, ...args) {
  try {
    const central = require('./accounting-central');
    if (central.isLocalInstallerProcess() || central.isServerPostgresMode()) {
      return central.runIntegration(fn, ...args);
    }
    const accountingPlatformSvc = require('./accounting-platform');
    if (typeof accountingPlatformSvc[fn] === 'function') accountingPlatformSvc[fn](...args);
  } catch (err) {
    console.warn(`[acc] ${fn}:`, err.message);
  }
}

const {
  getDocuments: getEmployeeDocuments,
  saveDocument: saveEmployeeDocument,
  ...staffExports
} = staff;
const {
  getDocument: getDonationDocument,
  ...donationsExports
} = donationsSvc;
const {
  getTemplates: getFlyerTemplates,
  ...flyersExports
} = flyersSvc;
const {
  getTemplates: getWhatsAppTemplates,
  ...whatsappExports
} = whatsappSvc;
const {
  getDocuments: getHubDocuments,
  getDocument: getHubDocument,
  saveDocument: saveHubDocument,
  deleteDocument: deleteHubDocument,
  processScheduledDocuments: _documentHubProcessScheduled,
  ...documentHubExports
} = documentHubSvc;

function audit(userId, username, action, entityType, entityId, details) {
  getDb().prepare(`
    INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, details)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(userId, username, action, entityType, entityId, details ? JSON.stringify(details) : null);
}

function coerceCounterValue(raw) {
  // node-pg returns int8/bigint as strings — `"35" + 1` becomes `"351"` (string concat) and corrupts counters.
  // Oversized / non-numeric values return Infinity so callers can repair from sales history.
  if (raw == null || raw === '') return 0;
  if (typeof raw === 'bigint') {
    if (raw < 0n) return 0;
    if (raw > BigInt(Number.MAX_SAFE_INTEGER)) return Number.POSITIVE_INFINITY;
    return Number(raw);
  }
  const s = String(raw).trim();
  if (!/^\d+$/.test(s)) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return 0;
    if (n > Number.MAX_SAFE_INTEGER) return Number.POSITIVE_INFINITY;
    return Math.floor(n);
  }
  if (s.length > 15) return Number.POSITIVE_INFINITY;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function repairCounterFromSales(db, kind) {
  try {
    const col = kind === 'receipt' ? 'receipt_number' : 'order_number';
    const rows = db.prepare(`SELECT ${col} AS num FROM sales WHERE ${col} IS NOT NULL`).all();
    let max = 0;
    for (const r of rows) {
      const m = String(r.num || '').match(/(\d+)\s*$/);
      if (!m) continue;
      const digits = m[1];
      // Ignore string-concat corruption (e.g. 35111111 from `"35"+1` bigint strings)
      if (digits.length > 6) continue;
      if (/1{3,}$/.test(digits) && digits.length >= 4) continue;
      max = Math.max(max, coerceCounterValue(digits));
    }
    return max;
  } catch (_) {
    return 0;
  }
}

function nextReceiptNumber() {
  const db = getDb();
  const settings = getSettingsParsed();
  const rd = settings.receipt_design || {};
  const prefix = (rd.receipt_prefix || 'RCP').trim() || 'RCP';
  const pad = Math.max(1, Math.min(12, parseInt(rd.receipt_number_pad, 10) || 5));
  const includeDate = rd.receipt_include_date !== false;

  let current = 0;
  try {
    const row = db.prepare('SELECT last_number FROM receipt_counter WHERE id = 1').get();
    current = coerceCounterValue(row?.last_number);
  } catch (_) {
    current = 0;
  }
  // Corrupted by string-concat bumps (e.g. 35111111111111111111) — rebuild from existing sales
  if (!Number.isFinite(current) || current > 99999999) {
    current = repairCounterFromSales(db, 'receipt');
    try {
      db.prepare('UPDATE receipt_counter SET last_number = ? WHERE id = 1').run(current);
    } catch (_) { /* ignore */ }
  }

  const next = current + 1;
  try {
    db.prepare('UPDATE receipt_counter SET last_number = ? WHERE id = 1').run(next);
  } catch (_) {
    try {
      const bumped = db.prepare(
        `UPDATE receipt_counter SET last_number = ? WHERE id = 1 RETURNING last_number`
      ).get(next);
      if (bumped) { /* ok */ }
    } catch (__) { /* ignore */ }
  }

  const numPart = String(next).padStart(pad, '0');
  if (includeDate) {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return `${prefix}-${date}-${numPart}`;
  }
  return `${prefix}-${numPart}`;
}

/** Customer-facing order number (admin-configured) — printed on receipts, KDS, customer board, WhatsApp */
function nextOrderNumber() {
  const db = getDb();
  const settings = getSettingsParsed();
  const rd = settings.receipt_design || {};
  const prefix = (rd.order_prefix || 'ORD').trim() || 'ORD';
  const pad = Math.max(1, Math.min(12, parseInt(rd.order_number_pad, 10) || 4));
  const includeDate = rd.order_include_date !== false;
  try {
    db.prepare(`CREATE TABLE IF NOT EXISTS order_counter (
      id INTEGER PRIMARY KEY CHECK (id = 1), last_number INTEGER DEFAULT 0)`).run();
    db.prepare('INSERT OR IGNORE INTO order_counter (id, last_number) VALUES (1, 0)').run();
  } catch (_) { /* exists */ }

  let current = 0;
  try {
    const row = db.prepare('SELECT last_number FROM order_counter WHERE id = 1').get();
    current = coerceCounterValue(row?.last_number);
  } catch (_) {
    current = 0;
  }
  if (!Number.isFinite(current) || current > 99999999) {
    current = repairCounterFromSales(db, 'order');
    try {
      db.prepare('UPDATE order_counter SET last_number = ? WHERE id = 1').run(current);
    } catch (_) { /* ignore */ }
  }

  const next = current + 1;
  try {
    db.prepare('UPDATE order_counter SET last_number = ? WHERE id = 1').run(next);
  } catch (_) { /* ignore */ }

  const numPart = String(next).padStart(pad, '0');
  if (includeDate) {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return `${prefix}-${date}-${numPart}`;
  }
  return `${prefix}-${numPart}`;
}

function money(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function calcTaxInclusiveTotals(grossTotal, discount, taxRatePct) {
  const afterDiscount = money(Math.max(0, (Number(grossTotal) || 0) - Math.max(0, Number(discount) || 0)));
  const rate = Number(taxRatePct) || 0;
  if (!rate) return { subtotal: afterDiscount, tax_amount: 0, total: afterDiscount };
  const tax_amount = money(afterDiscount - afterDiscount / (1 + rate / 100));
  const total = afterDiscount;
  const subtotal = money(total - tax_amount);
  return { subtotal, tax_amount, total };
}

/** Match POS Utils.calcTaxTotals — supports tax-inclusive and tax-exclusive modes. */
function calcSaleTaxTotals(grossTotal, discount, taxRatePct, taxInclusive) {
  const afterDiscount = money(Math.max(0, (Number(grossTotal) || 0) - Math.max(0, Number(discount) || 0)));
  const rate = Number(taxRatePct) || 0;
  if (!rate) return { subtotal: afterDiscount, tax_amount: 0, total: afterDiscount };
  const inclusive = taxInclusive !== false && taxInclusive !== 0 && taxInclusive !== '0';
  if (!inclusive) {
    const tax_amount = money(afterDiscount * rate / 100);
    return { subtotal: afterDiscount, tax_amount, total: money(afterDiscount + tax_amount) };
  }
  return calcTaxInclusiveTotals(afterDiscount, 0, rate);
}

/** Active sales that still contribute to revenue (excludes fully returned / voided). */
const SALE_REVENUE_STATUSES_SQL = `s.status IN ('completed', 'partial_return')`;

function restoreProductStockAfterSale(productId, quantity, note, actorId, refType, refId, selectedMods) {
  const db = getDb();
  const prodMeta = db.prepare('SELECT has_recipe, production_mode FROM products WHERE id = ?').get(productId);
  if (!prodMeta) {
    adjustStock(productId, quantity, 'return', note, actorId, refType, refId);
    return;
  }
  const makeToStock = prodMeta.production_mode === 'make_to_stock';
  // Mirror completeSale: make-to-stock adjusts finished goods; make-to-order restores ingredients
  if (makeToStock || !prodMeta.has_recipe) {
    adjustStock(productId, quantity, 'return', note, actorId, refType, refId);
    return;
  }
  const recipeRestored = inventory.restoreRecipeIngredients(
    productId, quantity, `${note} (recipe)`, actorId, refType, refId, adjustStock, selectedMods || []
  );
  if (!recipeRestored) {
    adjustStock(productId, quantity, 'return', note, actorId, refType, refId);
  }
}

function nextPONumber() {
  const count = getDb().prepare('SELECT COUNT(*) as c FROM purchase_orders').get().c;
  return `PO-${String(count + 1).padStart(5, '0')}`;
}

// ─── Auth ───────────────────────────────────────────────────────────────────

function userAccountIsActive(user) {
  if (!user) return false;
  if (String(user.role || '') === 'owner') return true;
  const v = user.is_active;
  if (v === false || v === 0 || v === '0' || v === 'f' || v === 'false' || v === 'n') return false;
  return true;
}

function login(username, password, pin) {
  const userAny = getDb().prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!userAny) return { success: false, error: 'Invalid username or password' };
  if (!userAccountIsActive(userAny)) {
    session.clearAll();
    return { success: false, error: 'Account deactivated — system access is frozen. Contact the administrator.' };
  }
  const user = userAny;

  const passOk = bcrypt.compareSync(password, user.password_hash);
  if (!passOk) return { success: false, error: 'Invalid username or password' };
  if (user.pin) {
    if (!pin) return { success: false, error: 'Invalid PIN' };
    const pinCheck = verifyPinWithUpgrade(user.pin, pin);
    if (!pinCheck.ok) return { success: false, error: 'Invalid PIN' };
    if (pinCheck.needsUpgrade && pinCheck.hash) {
      try { getDb().prepare('UPDATE users SET pin = ? WHERE id = ?').run(pinCheck.hash, user.id); } catch (_) { /* ignore */ }
    }
  }

  const shiftBlock = checkCashierShiftAccess(user);
  if (!shiftBlock.ok) return { success: false, error: shiftBlock.error };

  const branchBlock = ['cashier', 'supervisor', 'assistant_manager'].includes(user.role)
    ? branchesSvc.assertUserTillBranch(user)
    : { ok: true };
  if (!branchBlock.ok) return { success: false, error: branchBlock.error };

  const { password_hash, pin: _pin, ...safe } = user;
  session.setUserSession(safe);
  session.clearEmployeeSession();
  // Audit after session is set — never block the login response
  const defer = typeof setImmediate === 'function' ? setImmediate : (fn) => setTimeout(fn, 0);
  defer(() => {
    try { audit(user.id, user.username, 'login', 'user', user.id, null); } catch (_) { /* ignore */ }
    try { staff.recordUserLoginEvent(user, 'login'); } catch (_) { /* ignore */ }
  });
  return { success: true, user: safe };
}

function logout() {
  const user = session.getUserSession();
  if (user) {
    audit(user.id, user.username, 'logout', 'user', user.id, null);
    try { staff.recordUserLoginEvent(user, 'logout'); } catch (_) { /* ignore */ }
  }
  session.clearAll();
  return { success: true };
}

function checkCashierShiftAccess(user) {
  if (['owner', 'manager', 'supervisor', 'assistant_manager'].includes(user.role)) return { ok: true };
  const sec = getSecuritySettingsRaw();
  if (!sec.shift_login_enforcement) return { ok: true };
  const emp = getDb().prepare('SELECT id FROM employees WHERE user_id = ? AND status = ?').get(user.id, 'Active');
  if (!emp) return { ok: true };
  const today = new Date().toLocaleDateString('en-CA');
  const onLeave = getDb().prepare(`
    SELECT 1 FROM employee_leave WHERE employee_id = ? AND status = 'approved'
    AND date(?) BETWEEN date(start_date) AND date(COALESCE(end_date, start_date))`).get(emp.id, today);
  if (onLeave) return { ok: false, error: 'You are on approved leave and cannot sign in until you return.' };
  const sched = getDb().prepare(`
    SELECT 1 FROM employee_schedules WHERE employee_id = ? AND shift_date = ? AND is_rest_day = 0`).get(emp.id, today);
  if (!sched) return { ok: false, error: 'You are not scheduled for a shift today. Contact your manager.' };
  return { ok: true };
}

let bookkeepingUnlockUntil = 0;

function verifyBookkeepingPassword(password) {
  const sec = getSecuritySettingsRaw();
  if (!sec.bookkeeping_password_hash) {
    bookkeepingUnlockUntil = Date.now() + 30 * 60 * 1000;
    return { required: false, unlocked: true };
  }
  if (!password) throw new Error('Bookkeeping password required');
  if (!bcrypt.compareSync(String(password), sec.bookkeeping_password_hash)) {
    throw new Error('Incorrect bookkeeping password');
  }
  bookkeepingUnlockUntil = Date.now() + 30 * 60 * 1000;
  return { required: true, unlocked: true };
}

function isBookkeepingUnlocked() {
  const sec = getSecuritySettingsRaw();
  if (!sec.bookkeeping_password_hash) return true;
  return Date.now() < bookkeepingUnlockUntil;
}

function requireBookkeepingAccess(actor) {
  const user = requireActor(actor || session.getUserSession(), ['owner', 'manager']);
  if (!isBookkeepingUnlocked()) throw new Error('Bookkeeping password required');
  return user;
}

function setBookkeepingPassword(password, actorId, actorName) {
  if (password && String(password).length < 6) throw new Error('Password must be at least 6 characters');
  const hash = password ? bcrypt.hashSync(String(password), 10) : null;
  patchSecuritySettings({ bookkeeping_password_hash: hash }, actorId, actorName);
  return true;
}

const RECOVERY_MAX_ATTEMPTS = 5;
const RECOVERY_LOCKOUT_MS = 30 * 60 * 1000;

function getSecuritySettingsRaw() {
  const row = getDb().prepare('SELECT security_settings FROM shop_settings WHERE id = 1').get();
  return parseJsonField(row?.security_settings, {});
}

function getAllowOversell() {
  return getSecuritySettingsRaw().allow_oversell === true;
}

function isVoidedStatus(status) {
  return status === 'voided' || status === 'void';
}

function requireActor(actor, allowedRoles = ['owner']) {
  return assertUserActor(actor, allowedRoles);
}

function sanitizeSettingsResponse(s) {
  if (!s) return s;
  const copy = { ...s };
  let security = parseJsonField(copy.security_settings, {});
  if (security.recovery_secret_hash) {
    security = { ...security, recovery_configured: true };
    delete security.recovery_secret_hash;
  }
  if (security.bookkeeping_password_hash) {
    security = { ...security, bookkeeping_password_configured: true };
    delete security.bookkeeping_password_hash;
  }
  copy.security_settings = typeof s.security_settings === 'string'
    ? JSON.stringify(security)
    : security;
  return copy;
}

function patchSecuritySettings(partial, actorId, actorName) {
  const merged = { ...getSecuritySettingsRaw(), ...partial };
  saveJsonSetting('security_settings', merged, actorId, actorName);
  return merged;
}

function hasRecoverySecret() {
  return !!getSecuritySettingsRaw().recovery_secret_hash;
}

function getRecoveryStatus() {
  const sec = getSecuritySettingsRaw();
  return {
    configured: !!sec.recovery_secret_hash,
    failed_attempts: Number(sec.recovery_failed_attempts) || 0,
    lock_until: sec.recovery_lock_until || null
  };
}

function setRecoverySecret(secret, actorId, actorName) {
  if (!secret || String(secret).trim().length < 8) {
    throw new Error('Private recovery phrase must be at least 8 characters');
  }
  const hash = bcrypt.hashSync(String(secret).trim(), 12);
  patchSecuritySettings({
    recovery_secret_hash: hash,
    recovery_failed_attempts: 0,
    recovery_lock_until: null
  }, actorId, actorName || 'system');
  audit(actorId, actorName || 'system', 'set_recovery_secret', 'security', 1, null);
  return { success: true };
}

function assertRecoveryNotLocked(sec) {
  if (!sec.recovery_lock_until) return;
  const lockUntil = new Date(sec.recovery_lock_until);
  if (lockUntil > new Date()) {
    const mins = Math.max(1, Math.ceil((lockUntil - new Date()) / 60000));
    throw new Error(`Too many failed attempts. Try again in ${mins} minute(s).`);
  }
}

function verifyRecoverySecret(secret) {
  const sec = getSecuritySettingsRaw();
  if (!sec.recovery_secret_hash) {
    throw new Error('Recovery is not set up. The shop owner must configure a Private Recovery Phrase in Admin → Security.');
  }
  assertRecoveryNotLocked(sec);
  if (!bcrypt.compareSync(String(secret).trim(), sec.recovery_secret_hash)) {
    const attempts = (sec.recovery_failed_attempts || 0) + 1;
    const patch = { recovery_failed_attempts: attempts };
    if (attempts >= RECOVERY_MAX_ATTEMPTS) {
      patch.recovery_lock_until = new Date(Date.now() + RECOVERY_LOCKOUT_MS).toISOString();
      patch.recovery_failed_attempts = 0;
    }
    patchSecuritySettings(patch, null, 'system');
    audit(null, 'unknown', 'recovery_failed', 'security', 1, { attempts });
    throw new Error('Incorrect private recovery phrase');
  }
  patchSecuritySettings({ recovery_failed_attempts: 0, recovery_lock_until: null }, null, 'system');
  return true;
}

function getUsernamesForRecovery(secret) {
  verifyRecoverySecret(secret);
  audit(null, 'recovery', 'recovery_verify_ok', 'security', 1, null);
  return getDb().prepare(`
    SELECT username, full_name, role FROM users WHERE is_active = 1
    ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END, username
  `).all();
}

function resetPasswordViaRecovery(secret, username, newPassword) {
  verifyRecoverySecret(secret);
  if (!username?.trim()) throw new Error('Username is required');
  if (!newPassword || newPassword.length < 6) throw new Error('New password must be at least 6 characters');
  const user = getDb().prepare('SELECT id, username FROM users WHERE username = ? AND is_active = 1').get(username.trim());
  if (!user) throw new Error('User not found');
  getDb().prepare(`UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(bcrypt.hashSync(newPassword, 10), user.id);
  audit(user.id, user.username, 'password_recovery', 'user', user.id, { method: 'recovery_phrase' });
  return { success: true, username: user.username };
}

/**
 * Seed / update a local installer account after a successful Railway (Supabase Postgres) login.
 * Applies cloud shop settings + catalog so Windows/Android match the browser shop.
 */
function seedInstallerAccountFromCloud(payload = {}) {
  const username = String(payload.username || '').trim();
  const password = payload.password;
  if (!username) throw new Error('Username is required');
  if (!password || String(password).length < 1) throw new Error('Password is required');

  const cloudUser = payload.cloudUser || payload.user || {};
  const settings = payload.settings || {};
  const hash = bcrypt.hashSync(String(password), 10);
  const pinRaw = payload.pin != null && String(payload.pin).trim() !== '' ? String(payload.pin).trim() : null;
  const pinHash = pinRaw ? hashPin(pinRaw) : null;
  const role = VALID_USER_ROLES.includes(cloudUser.role) ? cloudUser.role : 'owner';
  const fullName = String(cloudUser.full_name || username).trim() || username;
  const db = getDb();
  const existing = db.prepare('SELECT id, pin FROM users WHERE username = ?').get(username);

  if (existing) {
    db.prepare(`
      UPDATE users SET password_hash = ?, pin = COALESCE(?, pin), full_name = ?, role = ?, is_active = 1,
        updated_at = datetime('now') WHERE id = ?
    `).run(hash, pinHash, fullName, role, existing.id);
  } else {
    db.prepare(`
      INSERT INTO users (username, password_hash, pin, full_name, role, is_active)
      VALUES (?, ?, ?, ?, ?, 1)
    `).run(username, hash, pinHash, fullName, role);
  }

  const before = db.prepare('SELECT shop_name FROM shop_settings WHERE id = 1').get();
  const productCountBefore = db.prepare('SELECT COUNT(*) as c FROM products').get()?.c || 0;

  const JSON_SETTING_KEYS = new Set([
    'printer_settings', 'receipt_design', 'security_settings', 'customization',
    'device_settings', 'discount_settings', 'backup_settings', 'loyalty_settings',
    'payment_settings', 'account_settings', 'operating_hours_settings',
    'notification_settings', 'staff_portal_settings', 'sync_settings', 'whatsapp_settings',
    'sales_targets', 'shift_settings', 'eom_settings', 'account_settings_v2', 'social_media'
  ]);

  const patch = { setup_complete: 1 };
  for (const k of SHOP_SETTING_FIELDS) {
    if (k === 'setup_complete') continue;
    if (settings[k] == null || settings[k] === '') continue;
    let v = settings[k];
    if (JSON_SETTING_KEYS.has(k) && typeof v === 'object') {
      try { v = JSON.stringify(v); } catch (_) { continue; }
    }
    patch[k] = v;
  }
  if (!patch.shop_name && settings.shop_name) patch.shop_name = settings.shop_name;
  if (!patch.shop_name) {
    if (!before?.shop_name || before.shop_name === 'My Shop') {
      patch.shop_name = settings.app_display_name || settings.shop_name || before?.shop_name || 'My Shop';
    }
  }
  try { saveSettings(patch, null, 'cloud-login'); } catch (_) { /* ignore */ }

  // Align catalog with cloud shop when local is empty or was a different / placeholder shop
  try {
    if (payload.skipCatalog) {
      audit(null, username, 'seed_installer_from_cloud', 'user', null, {
        username, role, shop_name: patch.shop_name || settings.shop_name || null, skipCatalog: true
      });
      return { success: true, username, shop_name: patch.shop_name || settings.shop_name || null };
    }

    const cloudName = String(patch.shop_name || settings.shop_name || '').trim();
    const localNameBefore = String(before?.shop_name || '').trim();
    const needCatalog =
      productCountBefore === 0 ||
      !localNameBefore ||
      localNameBefore === 'My Shop' ||
      (cloudName && localNameBefore && cloudName !== localNameBefore);

    const categories = Array.isArray(payload.categories) ? payload.categories : [];
    const products = Array.isArray(payload.products) ? payload.products : [];

    if (needCatalog && (categories.length || products.length)) {
      const nameToId = new Map();
      for (const c of categories) {
        const name = String(c?.name || '').trim();
        if (!name) continue;
        let row = db.prepare('SELECT id FROM categories WHERE lower(name) = lower(?)').get(name);
        if (!row) {
          try {
            const newId = saveCategory({
              name,
              sort_order: c.sort_order ?? 0,
              show_on_pos: c.show_on_pos !== 0 && c.show_on_pos !== false ? 1 : 0,
              color: c.color || null
            }, null, 'cloud-login');
            row = { id: newId || db.prepare('SELECT id FROM categories WHERE lower(name) = lower(?)').get(name)?.id };
          } catch (_) {
            row = db.prepare('SELECT id FROM categories WHERE lower(name) = lower(?)').get(name);
          }
        }
        if (row?.id) nameToId.set(name.toLowerCase(), row.id);
        if (c.id != null) nameToId.set(`cloud:${c.id}`, row?.id);
      }

      for (const p of products) {
        const name = String(p?.name || '').trim();
        if (!name) continue;
        const price = Number(p.selling_price ?? p.price);
        if (!(price > 0)) continue;
        let categoryId = p.category_id != null ? nameToId.get(`cloud:${p.category_id}`) : null;
        if (!categoryId && p.category_name) categoryId = nameToId.get(String(p.category_name).toLowerCase());
        const barcode = p.barcode ? String(p.barcode) : null;
        let existingProd = null;
        if (barcode) {
          existingProd = db.prepare('SELECT id FROM products WHERE barcode = ?').get(barcode);
        }
        if (!existingProd) {
          existingProd = db.prepare('SELECT id FROM products WHERE lower(name) = lower(?)').get(name);
        }
        const row = {
          id: existingProd?.id,
          name,
          selling_price: price,
          buying_price: Number(p.buying_price || p.cost) || 0,
          barcode,
          sku: p.sku || null,
          stock_quantity: Number(p.stock_quantity ?? p.stock) || 0,
          unit: p.unit || p.stock_unit || 'each',
          stock_unit: p.stock_unit || p.unit || 'each',
          category_id: categoryId || null,
          item_type: p.item_type || 'retail',
          is_active: p.is_active === 0 || p.is_active === false ? 0 : 1,
          min_stock: p.min_stock ?? 5,
          description: p.description || null,
          brand: p.brand || null
        };
        try { saveProduct(row, null, 'cloud-login'); } catch (_) { /* skip bad rows */ }
      }
    }
  } catch (err) {
    console.warn('[seedInstallerAccountFromCloud] catalog', err?.message || err);
  }

  audit(null, username, 'seed_installer_from_cloud', 'user', null, {
    username,
    role,
    shop_name: patch.shop_name || settings.shop_name || null
  });
  return { success: true, username, shop_name: patch.shop_name || settings.shop_name || null };
}

async function clearOperationalData(password, actorId, actorName) {
  const user = getDb().prepare('SELECT * FROM users WHERE id = ?').get(actorId);
  if (!user || user.role !== 'owner') throw new Error('Only the owner can clear operational data');
  if (!password || !bcrypt.compareSync(String(password), user.password_hash)) {
    throw new Error('Incorrect administrator password');
  }
  const { getDbPathForBackup } = require('../database/db');
  const autoBackup = getDbPathForBackup().replace(/\.db$/, `-auto-before-clear-${Date.now()}.db`);
  fs.copyFileSync(getDbPathForBackup(), autoBackup);

  const db = getDb();
  const operationalTables = [
    'sale_items', 'sale_payments', 'sales', 'returns', 'return_items',
    'held_orders', 'quotes', 'quote_items', 'layby_payments', 'laybyes',
    'gift_card_transactions', 'customer_credit_ledger', 'customer_loyalty',
    'cash_drawer_log', 'cash_ups', 'kitchen_orders', 'online_orders_local',
    'notifications', 'audit_log', 'system_logs', 'stock_movements',
    'purchase_order_items', 'purchase_orders', 'supplier_payments',
    'expenses', 'bookkeeping_transactions', 'shifts', 'shop_operating_log',
    'user_login_events', 'employee_attendance', 'employee_payroll',
    'employee_payroll_deductions', 'stock_counts', 'stock_count_lines', 'waste_records'
  ];
  const run = db.transaction(() => {
    for (const table of operationalTables) {
      try { db.exec(`DELETE FROM ${table}`); } catch (_) {}
    }
    try { db.exec('UPDATE receipt_counter SET last_number = 0 WHERE id = 1'); } catch (_) {}
    try { db.exec('UPDATE quote_counter SET last_number = 0 WHERE id = 1'); } catch (_) {}
  });
  run();
  saveSettings({ last_backup: new Date().toISOString() }, actorId, actorName);
  audit(actorId, actorName, 'clear_operational_data', 'system', null, { backup: autoBackup });
  return { success: true, backup_path: autoBackup };
}

async function factoryResetBusiness(recoverySecret, confirmText) {
  verifyRecoverySecret(recoverySecret);
  const shopName = (getSettings()?.shop_name || '').trim();
  const typed = (confirmText || '').trim();
  if (typed !== 'DELETE' && typed !== shopName) {
    throw new Error('Type DELETE or your exact shop name to confirm erasure');
  }
  const { resetDatabaseFile } = require('../database/db');
  await resetDatabaseFile();
  try {
    deviceSettings.clear();
  } catch (_) {}
  return { success: true };
}

const VALID_USER_ROLES = ['owner', 'manager', 'assistant_manager', 'supervisor', 'marketing_agent', 'cashier', 'delivery_manager'];

function createUser(data, actorId, actorName) {
  const actor = requireActor({ id: actorId }, ['owner', 'manager']);
  if (!VALID_USER_ROLES.includes(data.role)) throw new Error('Invalid role');
  if (data.role === 'owner' && actor.role !== 'owner') {
    throw new Error('Only the owner can create owner accounts');
  }
  if (!data.password || data.password.length < 6) throw new Error('Password must be at least 6 characters');
  // Managers/supervisors/cashiers must belong to a branch; marketing agents may be shared (null)
  let branchId = data.branch_id != null && data.branch_id !== '' ? Number(data.branch_id) : null;
  if (['manager', 'supervisor', 'cashier', 'assistant_manager'].includes(data.role)) {
    if (!branchId) {
      if (actor.role === 'manager' && actor.branch_id) branchId = Number(actor.branch_id);
      else throw new Error('Select a branch for this user');
    }
    if (actor.role === 'manager' && Number(actor.branch_id) !== Number(branchId)) {
      throw new Error('Managers can only create staff for their own branch');
    }
    branchesSvc.assertBranchRoleSlot(data.role, branchId, null);
  }
  if (data.role === 'marketing_agent') {
    // Shared across branches — branch_id optional
    branchId = branchId || null;
  }
  if (data.role === 'delivery_manager') {
    branchId = branchId || null;
  }
  const hash = bcrypt.hashSync(data.password, 10);
  const pinHash = data.pin ? hashPin(data.pin) : null;
  const result = getDb().prepare(`
    INSERT INTO users (username, password_hash, pin, full_name, role, permissions, branch_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(data.username, hash, pinHash, data.full_name, data.role, JSON.stringify(data.permissions || {}), branchId);
  audit(actorId, actorName, 'create_user', 'user', result.lastInsertRowid, { username: data.username, role: data.role, branch_id: branchId });
  return result.lastInsertRowid;
}

function updateUser(id, data, actorId, actorName) {
  const actor = requireActor({ id: actorId }, ['owner', 'manager']);
  const userId = Number(id);
  const existing = getDb().prepare('SELECT id, role, is_active, branch_id FROM users WHERE id = ?').get(userId);
  if (!existing) throw new Error('User not found');
  if (actor.role === 'manager' && existing.role === 'owner') {
    throw new Error('Managers cannot edit owner accounts');
  }
  const fields = [];
  const values = [];
  if (data.full_name) { fields.push('full_name = ?'); values.push(data.full_name.trim()); }
  if (data.username) {
    const dup = getDb().prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(data.username.trim(), userId);
    if (dup) throw new Error('Username already in use');
    fields.push('username = ?'); values.push(data.username.trim());
  }
  if (data.role) {
    if (!VALID_USER_ROLES.includes(data.role)) throw new Error('Invalid role');
    if (data.role === 'owner' && actor.role !== 'owner') {
      throw new Error('Only the owner can assign the owner role');
    }
    if (existing.role === 'owner' && data.role !== 'owner') {
      const owners = getDb().prepare(`SELECT COUNT(*) AS c FROM users WHERE role = 'owner' AND is_active = 1 AND id != ?`).get(userId).c;
      if (owners < 1) throw new Error('Cannot change role — at least one active owner is required');
    }
    fields.push('role = ?'); values.push(data.role);
  }
  const nextRole = data.role || existing.role;
  let nextBranch = existing.branch_id;
  if (data.branch_id !== undefined) {
    nextBranch = data.branch_id || null;
    fields.push('branch_id = ?'); values.push(nextBranch);
  }
  if (['manager', 'supervisor'].includes(nextRole) && nextBranch) {
    branchesSvc.assertBranchRoleSlot(nextRole, nextBranch, userId);
  }
  if (['manager', 'supervisor', 'cashier', 'assistant_manager'].includes(nextRole) && !nextBranch) {
    throw new Error('Select a branch for this user');
  }
  if (nextRole === 'delivery_manager' && actor.role === 'manager' && nextBranch && Number(actor.branch_id) !== Number(nextBranch)) {
    throw new Error('Managers can only assign delivery staff for their own branch');
  }
  if (data.clear_pin) {
    fields.push('pin = ?'); values.push(null);
  } else if (data.pin !== undefined && data.pin !== null && data.pin !== '') {
    fields.push('pin = ?'); values.push(hashPin(data.pin));
  }
  if (data.is_active !== undefined) {
    if (userId === actorId && !data.is_active) throw new Error('You cannot deactivate your own account');
    if (existing.role === 'owner' && !data.is_active) {
      const owners = getDb().prepare(`SELECT COUNT(*) AS c FROM users WHERE role = 'owner' AND is_active = 1 AND id != ?`).get(userId).c;
      if (owners < 1) throw new Error('Cannot deactivate the last active owner');
    }
    fields.push('is_active = ?'); values.push(data.is_active ? 1 : 0);
  }
  if (data.password) {
    if (data.password.length < 6) throw new Error('Password must be at least 6 characters');
    fields.push('password_hash = ?'); values.push(bcrypt.hashSync(data.password, 10));
  }
  if (data.permissions) { fields.push('permissions = ?'); values.push(JSON.stringify(data.permissions)); }
  if (fields.length === 0) throw new Error('No changes to save');
  fields.push("updated_at = datetime('now')");
  values.push(userId);
  getDb().prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  audit(actorId, actorName, 'update_user', 'user', userId, data);
}

function deleteUser(id, actorId, actorName) {
  requireActor({ id: actorId }, ['owner']);
  const userId = Number(id);
  if (userId === actorId) throw new Error('You cannot deactivate your own account');
  const user = getDb().prepare('SELECT id, role, is_active FROM users WHERE id = ?').get(userId);
  if (!user) throw new Error('User not found');
  if (user.role === 'owner') {
    const owners = getDb().prepare(`SELECT COUNT(*) AS c FROM users WHERE role = 'owner' AND is_active = 1 AND id != ?`).get(userId).c;
    if (owners < 1) throw new Error('Cannot deactivate the last active owner');
  }
  getDb().prepare(`UPDATE users SET is_active = 0, updated_at = datetime('now') WHERE id = ?`).run(userId);
  audit(actorId, actorName, 'delete_user', 'user', userId, null);
}

function permanentlyDeleteUser(id, confirmUsername, actorId, actorName) {
  requireActor({ id: actorId }, ['owner']);
  const userId = Number(id);
  if (userId === actorId) throw new Error('You cannot permanently delete your own account');
  const user = getDb().prepare('SELECT id, username, role, full_name FROM users WHERE id = ?').get(userId);
  if (!user) throw new Error('User not found');
  if ((confirmUsername || '').trim() !== user.username) {
    throw new Error('Type the exact username to confirm permanent deletion');
  }
  if (user.role === 'owner') {
    const owners = getDb().prepare(`SELECT COUNT(*) AS c FROM users WHERE role = 'owner' AND id != ?`).get(userId).c;
    if (owners < 1) throw new Error('Cannot permanently delete the only owner account');
  }
  const db = getDb();
  const unlink = (sql) => { try { db.prepare(sql).run(userId); } catch (_) {} };
  const tx = db.transaction(() => {
    try { db.prepare('DELETE FROM user_login_events WHERE user_id = ?').run(userId); } catch (_) {}
    try { db.prepare('DELETE FROM held_orders WHERE user_id = ?').run(userId); } catch (_) {}
    unlink('UPDATE sales SET user_id = NULL WHERE user_id = ?');
    unlink('UPDATE returns SET user_id = NULL WHERE user_id = ?');
    unlink('UPDATE expenses SET user_id = NULL WHERE user_id = ?');
    unlink('UPDATE stock_movements SET user_id = NULL WHERE user_id = ?');
    unlink('UPDATE purchase_orders SET user_id = NULL WHERE user_id = ?');
    unlink('UPDATE audit_log SET user_id = NULL WHERE user_id = ?');
    unlink('UPDATE employees SET user_id = NULL WHERE user_id = ?');
    unlink('UPDATE shop_operating_log SET user_id = NULL WHERE user_id = ?');
    unlink('UPDATE quotes SET user_id = NULL WHERE user_id = ?');
    unlink('UPDATE laybyes SET user_id = NULL WHERE user_id = ?');
    unlink('UPDATE layby_payments SET user_id = NULL WHERE user_id = ?');
    unlink('UPDATE gift_card_transactions SET user_id = NULL WHERE user_id = ?');
    unlink('UPDATE customer_credit_ledger SET user_id = NULL WHERE user_id = ?');
    unlink('UPDATE exchanges SET user_id = NULL WHERE user_id = ?');
    unlink('UPDATE supplier_payments SET user_id = NULL WHERE user_id = ?');
    unlink('UPDATE po_receipts SET user_id = NULL WHERE user_id = ?');
    unlink('UPDATE shifts SET user_id = NULL WHERE user_id = ?');
    unlink('UPDATE company_rules SET created_by = NULL WHERE created_by = ?');
    unlink('UPDATE employee_disciplinary SET created_by = NULL WHERE created_by = ?');
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  });
  tx();
  audit(actorId, actorName, 'permanently_delete_user', 'user', userId, { username: user.username, full_name: user.full_name });
}

function verifyUserSession(userId) {
  if (userId == null || userId === '') return { active: true, skipped: true };
  let user = null;
  try {
    user = getDb().prepare(`
      SELECT id, username, full_name, role, is_active, permissions, branch_id FROM users WHERE id = ?`).get(userId);
  } catch (_) {
    return { active: true, skipped: true };
  }
  if (user && !userAccountIsActive(user)) {
    const sess = session.getUserSession();
    if (sess?.id && Number(sess.id) === Number(userId)) session.clearAll();
    return { active: false, frozen: true, error: 'Account deactivated — system access is frozen.' };
  }
  if (user && userAccountIsActive(user)) {
    const sess = session.getUserSession();
    if (!sess?.id || Number(sess.id) !== Number(userId)) {
      try { session.setUserSession(user); } catch (_) { /* ignore */ }
    }
    try { enforceShiftCashoutDeadlines(); } catch (_) { /* ignore */ }
    return { active: true, user };
  }
  return { active: true, skipped: true };
}

function getUsers() {
  return getDb().prepare(`
    SELECT id, username, full_name, role,
      CASE WHEN pin IS NOT NULL AND pin != '' THEN 1 ELSE 0 END as has_pin,
      is_active, permissions, branch_id, created_at FROM users`).all();
}

// ─── Shop Setup ─────────────────────────────────────────────────────────────

const SHOP_SETTING_FIELDS = [
  'shop_name', 'logo_path', 'address', 'phone', 'email', 'website', 'currency', 'currency_name',
  'decimal_places', 'thousands_sep', 'receipt_footer', 'thank_you_message', 'return_policy',
  'social_media', 'vat_number', 'tax_rate', 'tax_enabled', 'tax_inclusive', 'tax_show_on_pos', 'receipt_width',
  'theme', 'language', 'business_type', 'setup_complete', 'license_expiry', 'last_backup',
  'printer_settings', 'receipt_design', 'security_settings', 'customization',
  'device_settings', 'discount_settings', 'backup_settings', 'loyalty_settings',
  'payment_settings', 'account_settings', 'operating_hours_settings',
  'notification_settings', 'staff_portal_settings', 'sync_settings', 'whatsapp_settings', 'branch_id',
  'date_format', 'time_format', 'invoice_prefix', 'quote_prefix', 'receipt_prefix', 'sales_targets',
  'shift_settings', 'admin_signature_path', 'app_display_name', 'eom_settings', 'account_settings_v2',
  'expense_categories'
];

const DEFAULT_EXPENSE_CATEGORIES = ['rent', 'transport', 'electricity', 'salary', 'fuel', 'maintenance', 'stock', 'other'];

function parseJsonField(val, fallback = {}) {
  if (!val) return fallback;
  try { return typeof val === 'string' ? JSON.parse(val) : val; } catch { return fallback; }
}

function getSettingsParsed() {
  const s = getSettings();
  if (!s) return s;
  const security = parseJsonField(s.security_settings);
  if (security.recovery_secret_hash) {
    security.recovery_configured = true;
    delete security.recovery_secret_hash;
  }
  if (security.bookkeeping_password_hash) {
    security.bookkeeping_password_configured = true;
    delete security.bookkeeping_password_hash;
  }
  return {
    ...s,
    tax_enabled: !!Number(s.tax_enabled),
    tax_rate: Number(s.tax_rate) || 0,
    tax_inclusive: s.tax_inclusive !== 0 && s.tax_inclusive !== '0' && s.tax_inclusive !== false,
    tax_show_on_pos: s.tax_show_on_pos !== 0 && s.tax_show_on_pos !== '0' && s.tax_show_on_pos !== false,
    printer_settings: parseJsonField(s.printer_settings),
    receipt_design: parseJsonField(s.receipt_design),
    security_settings: security,
    customization: parseJsonField(s.customization),
    device_settings: parseJsonField(s.device_settings),
    discount_settings: parseJsonField(s.discount_settings),
    backup_settings: parseJsonField(s.backup_settings),
    loyalty_settings: parseJsonField(s.loyalty_settings, {
      enabled: true, spend_amount: 10, points_earned: 1, min_sale_total: 0, point_value: 1,
      points_expiry_days: 30, reminder_interval_days: 3, expiry_enabled: true
    }),
    payment_settings: parseJsonField(s.payment_settings, {
      enabled_methods: ['cash', 'card', 'eft', 'mobile', 'account', 'giftcard', 'other'],
      allow_mixed: true, giftcard_enabled: true, account_enabled: true, eft_enabled: true
    }),
    account_settings: (() => {
      const base = parseJsonField(s.account_settings, {
        enabled: true, require_allowlist: true, default_credit_limit: 0
      });
      const v2 = parseJsonField(s.account_settings_v2, {});
      return {
        ...base,
        ...v2,
        require_approval: v2.require_approval !== false,
        default_period_days: Number(v2.default_period_days) || 30,
        late_fee_percent: Number(v2.late_fee_percent) || 0
      };
    })(),
    eom_settings: parseJsonField(s.eom_settings, { auto_select: true }),
    operating_hours_settings: parseJsonField(s.operating_hours_settings, {
      enabled: false, close_time: '18:00', open_time: '08:00', warn_minutes: 15, alert_at_close: true,
      weekly: [
        { day: 0, name: 'Sunday', open: '08:00', close: '18:00', closed: false },
        { day: 1, name: 'Monday', open: '08:00', close: '18:00', closed: false },
        { day: 2, name: 'Tuesday', open: '08:00', close: '18:00', closed: false },
        { day: 3, name: 'Wednesday', open: '08:00', close: '18:00', closed: false },
        { day: 4, name: 'Thursday', open: '08:00', close: '18:00', closed: false },
        { day: 5, name: 'Friday', open: '08:00', close: '18:00', closed: false },
        { day: 6, name: 'Saturday', open: '08:00', close: '18:00', closed: false }
      ]
    }),
    notification_settings: parseJsonField(s.notification_settings, {
      sound_enabled: true, loop_until_read: true, sound_path: null,
      panel_sounds: {
        pos: { enabled: true, sound_path: null },
        admin: { enabled: true, sound_path: null },
        driver: { enabled: true, sound_path: null },
        manager: { enabled: true, sound_path: null },
        online: { enabled: true, sound_path: null },
        delivery: { enabled: true, sound_path: null },
        staff: { enabled: true, sound_path: null },
        recipe: { enabled: true, sound_path: null }
      }
    }),
    staff_portal_settings: parseJsonField(s.staff_portal_settings, {
      leave_types: ['Annual Leave', 'Sick Leave', 'Family Responsibility', 'Unpaid Leave'],
      leave_requires_approval: true, min_leave_notice_days: 1,
      leave_requests_open: true,
      max_leave_requests_per_month: null,
      max_leave_requests_per_year: null,
      leave_blackouts: [],
      show_disciplinary: true, require_disciplinary_response: true
    }),
    sync_settings: parseJsonField(s.sync_settings, {}),
    whatsapp_settings: parseJsonField(s.whatsapp_settings, {
      api_key: '', phone_number_id: '', business_account_id: '',
      default_branch_phone: '', default_branch_id: null,
      cashout_whatsapp_phone: ''
    }),
    sales_targets: parseJsonField(s.sales_targets, { daily: 0, weekly: 0, monthly: 0, yearly: 0 }),
    shift_settings: normalizeShiftSettings(parseJsonField(s.shift_settings, {})),
    expense_categories: (() => {
      try {
        const cats = parseJsonField(s.expense_categories, null);
        if (Array.isArray(cats) && cats.length) return cats.map((c) => String(c).trim()).filter(Boolean);
      } catch (_) { /* */ }
      return [...DEFAULT_EXPENSE_CATEGORIES];
    })(),
    online: (() => {
      if (getSettingsParsed._onlineCache) return getSettingsParsed._onlineCache;
      try {
        const web = require('./online-ordering');
        getSettingsParsed._onlineCache = web.getGlobalSettings().online || {};
      } catch (_) {
        getSettingsParsed._onlineCache = { pos_reminder_minutes: 2 };
      }
      return getSettingsParsed._onlineCache;
    })()
  };
}
getSettingsParsed._onlineCache = null;

function saveJsonSetting(key, value, actorId, actorName) {
  saveSettings({ [key]: JSON.stringify(value) }, actorId, actorName);
  if (key === 'payment_settings') {
    try { require('./online-ordering').syncPaymentMethodsFromPos(value); } catch (_) { /* optional */ }
  }
}

function getSettings() {
  return getDb().prepare('SELECT * FROM shop_settings WHERE id = 1').get();
}

function saveMenuHighlightSettings(data, actorId, actorName) {
  const s = getSettingsParsed();
  const customization = { ...(s.customization || {}), menu_highlight_settings: data };
  saveJsonSetting('customization', customization, actorId, actorName);
  return parseSettingsFromStore();
}

function getMenuHighlightSettings() {
  return parseSettingsFromStore();
}

function parseSettingsFromStore() {
  try {
    return require('../../lib/menu-highlights').parseSettings(getSettingsParsed());
  } catch (_) {
    return require('../../lib/menu-highlights').DEFAULTS;
  }
}

function saveSettings(data, actorId, actorName) {
  getSettingsParsed._onlineCache = null;
  const normalized = { ...data };
  if ('tax_enabled' in normalized) normalized.tax_enabled = normalized.tax_enabled ? 1 : 0;
  if ('tax_inclusive' in normalized) normalized.tax_inclusive = normalized.tax_inclusive ? 1 : 0;
  if ('tax_show_on_pos' in normalized) normalized.tax_show_on_pos = normalized.tax_show_on_pos ? 1 : 0;
  if ('tax_rate' in normalized) normalized.tax_rate = Number(normalized.tax_rate) || 0;
  const fields = Object.keys(normalized).filter(k => k !== 'id' && SHOP_SETTING_FIELDS.includes(k));
  if (!fields.length) return;
  const sets = fields.map(f => `${f} = ?`).join(', ');
  getDb().prepare(`UPDATE shop_settings SET ${sets}, updated_at = datetime('now') WHERE id = 1`).run(...fields.map(f => normalized[f]));
  audit(actorId, actorName, 'update_settings', 'shop_settings', 1, normalized);
}

function completeSetup(data) {
  const probe = detectExistingBusiness();
  if (probe.exists && (probe.counts.users > 0 || probe.counts.products > 0 || probe.counts.sales > 0)) {
    throw new Error('This device already has a shop. Login instead of registering a new one.');
  }
  const existing = getDb().prepare('SELECT setup_complete FROM shop_settings WHERE id = 1').get();
  if (existing?.setup_complete) throw new Error('Setup already completed');
  if (!data.shop_name?.trim()) throw new Error('Shop name is required');
  if (!data.owner_username?.trim()) throw new Error('Username is required');
  if (!data.owner_password) throw new Error('Password is required');
  if (data.owner_password.length < 6) throw new Error('Password must be at least 6 characters');
  if (!data.recovery_secret?.trim()) throw new Error('Private recovery phrase is required');
  if (data.recovery_secret.trim().length < 8) throw new Error('Recovery phrase must be at least 8 characters');
  if (data.recovery_secret !== data.recovery_secret_confirm) throw new Error('Recovery phrases do not match');

  saveSettings({
    shop_name: data.shop_name.trim(),
    phone: data.phone?.trim() || '',
    address: data.address?.trim() || '',
    currency: data.currency || 'R',
    tax_rate: data.tax_rate || 0,
    tax_enabled: data.tax_enabled ? 1 : 0,
    receipt_footer: data.receipt_footer?.trim() || 'Thank you for your purchase!',
    setup_complete: 1
  }, null, 'system');

  const hash = bcrypt.hashSync(data.owner_password, 10);
  getDb().prepare(`
    INSERT INTO users (username, password_hash, pin, full_name, role)
    VALUES (?, ?, ?, ?, 'owner')
  `).run(data.owner_username.trim(), hash, data.owner_pin ? hashPin(data.owner_pin) : null, data.owner_name?.trim() || 'Owner');

  setRecoverySecret(data.recovery_secret.trim(), null, 'system');

  ['Food', 'Drinks', 'Snacks'].forEach((name, i) => {
    getDb().prepare('INSERT OR IGNORE INTO categories (name, sort_order) VALUES (?, ?)').run(name, i);
  });

  try {
    branchesSvc.ensureBranchSchema();
    branchesSvc.bootstrapInitialBranch();
  } catch (err) {
    console.warn('[completeSetup] branch bootstrap:', err.message || err);
  }

  return { success: true };
}

function detectExistingBusiness() {
  const db = getDb();
  let settings = {};
  let userCount = 0;
  let productCount = 0;
  let saleCount = 0;
  try {
    settings = db.prepare('SELECT shop_name, setup_complete FROM shop_settings WHERE id = 1').get() || {};
    userCount = db.prepare('SELECT COUNT(*) as c FROM users WHERE is_active = 1').get()?.c || 0;
    productCount = db.prepare('SELECT COUNT(*) as c FROM products WHERE is_active = 1').get()?.c || 0;
    saleCount = db.prepare('SELECT COUNT(*) as c FROM sales').get()?.c || 0;
  } catch (err) {
    return { exists: false, setup_complete: false, shop_name: null, counts: { users: 0, products: 0, sales: 0 }, error: 'schema_incomplete' };
  }
  const exists = userCount > 0 || productCount > 0 || saleCount > 0 || !!Number(settings.setup_complete);
  return {
    exists,
    setup_complete: !!Number(settings.setup_complete),
    shop_name: settings.shop_name || null,
    counts: { users: userCount, products: productCount, sales: saleCount }
  };
}

function adoptExistingBusiness() {
  const info = detectExistingBusiness();
  if (!info.exists || (!info.counts.users && !info.counts.products && !info.counts.sales && !info.setup_complete)) {
    return { adopted: false, reason: 'no_business' };
  }
  const settings = getSettingsParsed();
  if (Number(settings.setup_complete)) {
    return { adopted: false, already_complete: true, setup_complete: 1, shop_name: settings.shop_name };
  }
  saveSettings({ setup_complete: 1 }, null, 'system');
  const shopName = settings.shop_name || getSettings().shop_name;
  return { adopted: true, setup_complete: 1, shop_name: shopName, business_id: 1, counts: info.counts };
}

// ─── Categories ─────────────────────────────────────────────────────────────

function ensureCategoryPosSchema() {
  const db = getDb();
  for (const sql of [
    'ALTER TABLE categories ADD COLUMN show_on_pos INTEGER DEFAULT 1',
    'ALTER TABLE products ADD COLUMN is_best_seller INTEGER DEFAULT 0',
    'ALTER TABLE products ADD COLUMN show_on_pos INTEGER DEFAULT 1',
    'ALTER TABLE products ADD COLUMN online_enabled INTEGER DEFAULT 1'
  ]) {
    try { db.exec(sql); } catch (_) { /* exists */ }
  }
}

function syncProductChannelFlags(productId, data, existing) {
  const showOnPos = data.show_on_pos !== undefined
    ? (data.show_on_pos ? 1 : 0)
    : (existing?.show_on_pos != null ? (Number(existing.show_on_pos) !== 0 ? 1 : 0) : 1);
  const onlineEnabled = data.online_enabled !== undefined
    ? (data.online_enabled ? 1 : 0)
    : (existing?.online_enabled != null ? (Number(existing.online_enabled) !== 0 ? 1 : 0) : 1);
  try {
    getDb().prepare('UPDATE products SET show_on_pos = ?, online_enabled = ? WHERE id = ?').run(showOnPos, onlineEnabled, productId);
  } catch (_) { /* columns may not exist on older DBs */ }
}

function getCategories(filters = {}) {
  ensureCategoryPosSchema();
  let sql = 'SELECT * FROM categories WHERE is_active = 1';
  if (filters.for_pos) sql += ' AND COALESCE(show_on_pos, 1) = 1';
  sql += ' ORDER BY sort_order, name';
  return getDb().prepare(sql).all();
}

function saveCategory(data, actorId, actorName) {
  ensureCategoryPosSchema();
  const name = data.name?.trim();
  if (!name) throw new Error('Category name is required');
  const showOnPos = data.show_on_pos === undefined || data.show_on_pos === null
    ? 1
    : (data.show_on_pos ? 1 : 0);

  if (data.id) {
    const clash = getDb().prepare('SELECT id FROM categories WHERE name = ? AND is_active = 1 AND id != ?').get(name, data.id);
    if (clash) throw new Error('A category with this name already exists');
    getDb().prepare('UPDATE categories SET name = ?, color = ?, sort_order = ?, image_path = ?, show_on_pos = ? WHERE id = ?')
      .run(name, data.color, data.sort_order ?? 0, data.image_path || null, showOnPos, data.id);
    audit(actorId, actorName, 'update_category', 'category', data.id, { name, show_on_pos: showOnPos });
    return data.id;
  }

  const inactive = getDb().prepare('SELECT id FROM categories WHERE name = ? AND is_active = 0').get(name);
  if (inactive) {
    getDb().prepare('UPDATE categories SET color = ?, sort_order = ?, image_path = ?, is_active = 1, show_on_pos = ? WHERE id = ?')
      .run(data.color || '#3b82f6', data.sort_order ?? 0, data.image_path || null, showOnPos, inactive.id);
    audit(actorId, actorName, 'create_category', 'category', inactive.id, { name, reactivated: true });
    return inactive.id;
  }

  const clash = getDb().prepare('SELECT id FROM categories WHERE name = ? AND is_active = 1').get(name);
  if (clash) throw new Error('A category with this name already exists');

  const sortOrder = data.sort_order ?? getDb().prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM categories').get()?.next ?? 0;
  const r = getDb().prepare('INSERT INTO categories (name, color, sort_order, image_path, show_on_pos) VALUES (?, ?, ?, ?, ?)')
    .run(name, data.color || '#3b82f6', sortOrder, data.image_path || null, showOnPos);
  audit(actorId, actorName, 'create_category', 'category', r.lastInsertRowid, { name });
  return r.lastInsertRowid;
}

/** Ensure POS "Other Items" category exists for ad-hoc sell lines. */
function ensureOtherItemsCategory() {
  ensureCategoryPosSchema();
  const db = getDb();
  let cat = db.prepare(`SELECT * FROM categories WHERE LOWER(name) = 'other items' LIMIT 1`).get();
  if (cat) {
    if (!cat.is_active) {
      db.prepare('UPDATE categories SET is_active = 1, show_on_pos = 1 WHERE id = ?').run(cat.id);
    } else {
      try { db.prepare('UPDATE categories SET show_on_pos = 1 WHERE id = ?').run(cat.id); } catch (_) { /* ignore */ }
    }
    return db.prepare('SELECT * FROM categories WHERE id = ?').get(cat.id);
  }
  const sortOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM categories').get()?.next ?? 0;
  const r = db.prepare(`
    INSERT INTO categories (name, color, sort_order, image_path, show_on_pos, is_active)
    VALUES ('Other Items', '#64748b', ?, NULL, 1, 1)
  `).run(sortOrder);
  return db.prepare('SELECT * FROM categories WHERE id = ?').get(r.lastInsertRowid);
}

/**
 * Create/update an ad-hoc sell item under Other Items and return the product.
 * Suggests selling price from cost + target profit % when requested.
 */
function saveOtherSellItem(data, actorId, actorName) {
  ensureCategoryPosSchema();
  const cat = ensureOtherItemsCategory();
  const name = (data.name || '').trim();
  if (!name) throw new Error('Item name is required');
  const cost = Math.max(0, Number(data.buying_price || data.cost) || 0);
  const targetProfit = Math.max(0, Number(data.target_profit_pct) || 40);
  let sell = Number(data.selling_price);
  const suggested = cost > 0
    ? Math.round((cost / (1 - Math.min(targetProfit, 95) / 100)) * 100) / 100
    : (Number.isFinite(sell) ? sell : 0);
  if (!(sell > 0)) sell = suggested;
  if (cost > 0 && sell < cost) {
    throw new Error(`Selling price cannot go below cost (${cost}). Suggested: ${suggested}`);
  }
  const margin = sell > 0 ? Math.round(((sell - cost) / sell) * 10000) / 100 : 0;
  if (cost > 0 && margin + 0.01 < targetProfit && !data.force_below_profit) {
    return {
      needs_confirm: true,
      error: `Price is below ${targetProfit}% profit (margin ${margin}%). Suggested best price: ${suggested}`,
      suggested_price: suggested,
      cost,
      margin
    };
  }
  const db = getDb();
  let existing = null;
  if (data.id) existing = db.prepare('SELECT * FROM products WHERE id = ?').get(data.id);
  if (!existing) {
    existing = db.prepare(`
      SELECT * FROM products WHERE category_id = ? AND LOWER(TRIM(name)) = LOWER(?) AND is_active = 1 LIMIT 1
    `).get(cat.id, name);
  }
  if (existing) {
    db.prepare(`
      UPDATE products SET name=?, selling_price=?, buying_price=?, category_id=?, show_on_pos=1,
        item_type=COALESCE(item_type,'retail'), updated_at=datetime('now') WHERE id=?
    `).run(name, sell, cost, cat.id, existing.id);
    audit(actorId, actorName, 'update_other_item', 'product', existing.id, { name, sell, cost });
    return db.prepare('SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.id=?').get(existing.id);
  }
  const r = db.prepare(`
    INSERT INTO products (
      name, selling_price, buying_price, stock_quantity, min_stock, unit, category_id,
      item_type, show_on_pos, is_active, description
    ) VALUES (?, ?, ?, 999999, 0, 'each', ?, 'retail', 1, 1, ?)
  `).run(name, sell, cost, cat.id, 'Other sell item (POS)');
  const id = r.lastInsertRowid;
  audit(actorId, actorName, 'create_other_item', 'product', id, { name, sell, cost });
  return db.prepare('SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.id=?').get(id);
}

function suggestSellPrice(cost, targetProfitPct = 40) {
  const c = Math.max(0, Number(cost) || 0);
  const t = Math.min(95, Math.max(0, Number(targetProfitPct) || 40));
  if (c <= 0) return 0;
  return Math.round((c / (1 - t / 100)) * 100) / 100;
}

/** Min cart total that keeps line items above cost (profit floor for discounts). */
function cartProfitFloor(items) {
  let floor = 0;
  for (const it of items || []) {
    const qty = Number(it.quantity) || 0;
    const buy = Number(it.buying_price);
    const recipe = Number(it.recipe_cost);
    // Prefer real food cost when buying_price is missing/zero (typical for recipe meals)
    const cost =
      Number.isFinite(buy) && buy > 0
        ? buy
        : Number.isFinite(recipe) && recipe > 0
          ? recipe
          : Number.isFinite(buy)
            ? buy
            : 0;
    floor += cost * qty;
  }
  return Math.round(floor * 100) / 100;
}

function lineCostForProduct(product, comboBuyingFallback) {
  if (comboBuyingFallback != null && Number(comboBuyingFallback) > 0) return Number(comboBuyingFallback);
  if (!product) return 0;
  const buy = Number(product.buying_price) || 0;
  const recipe = Number(product.recipe_cost) || 0;
  if (Number(product.has_recipe) && recipe > 0) return recipe;
  if (buy > 0) return buy;
  return recipe > 0 ? recipe : buy;
}

function deleteCategory(id, actorId, actorName) {
  getDb().prepare('UPDATE categories SET is_active = 0 WHERE id = ?').run(id);
  audit(actorId, actorName, 'delete_category', 'category', id, null);
}

// ─── Products ───────────────────────────────────────────────────────────────

let _menuHighlightsLastSync = 0;
const MENU_HIGHLIGHTS_SYNC_MS = 15 * 60 * 1000;

/** Best-seller / new-arrival sync is expensive — debounce off the POS hot path. */
function maybeSyncMenuHighlights(force = false) {
  const now = Date.now();
  if (!force && now - _menuHighlightsLastSync < MENU_HIGHLIGHTS_SYNC_MS) return;
  _menuHighlightsLastSync = now;
  try { require('./recipe-production').clearExpiredNewArrivals(); } catch (_) { /* ignore */ }
  try {
    const menuHl = require('../../lib/menu-highlights');
    menuHl.syncAutoBestSellers(getDb(), getSettingsParsed());
  } catch (_) { /* optional */ }
}

function getProducts(filters = {}) {
  ensureCategoryPosSchema();
  let sql = `
    SELECT p.*, c.name as category_name FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE p.is_active = 1 AND (p.is_archived = 0 OR p.is_archived IS NULL)
  `;
  const params = [];
  // Recipe ingredients (typed in Recipe Builder) stay in Inventory but are not sold on POS
  if (filters.ingredients_only) {
    sql += ` AND p.item_type = 'ingredient'`;
  } else if (!filters.include_ingredients) {
    sql += ` AND (p.item_type IS NULL OR p.item_type != 'ingredient')`;
  }
  if (filters.for_pos) {
    sql += ' AND COALESCE(p.show_on_pos, 1) = 1';
    sql += ' AND (c.id IS NULL OR COALESCE(c.show_on_pos, 1) = 1)';
  }
  // Branch catalog: shared (NULL) + this branch's products
  const scope = branchesSvc.resolveBranchScope(filters.actor || null, {
    branchId: filters.branch_id,
    forceTill: !!filters.for_pos
  });
  const branchForStock = scope.branchId || scope.tillId || 1;
  if (!scope.allBranches && branchForStock) {
    sql += ' AND (p.branch_id IS NULL OR p.branch_id = ?)';
    params.push(branchForStock);
  } else if (filters.branch_id != null && filters.branch_id !== '' && filters.branch_id !== 'all') {
    sql += ' AND (p.branch_id IS NULL OR p.branch_id = ?)';
    params.push(Number(filters.branch_id));
  }
  if (filters.category_id) { sql += ' AND p.category_id = ?'; params.push(filters.category_id); }
  if (filters.search) {
    sql += ' AND (p.name LIKE ? OR p.barcode LIKE ? OR p.sku LIKE ?)';
    const q = `%${filters.search}%`;
    params.push(q, q, q);
  }
  if (filters.low_stock) sql += ' AND p.stock_quantity <= p.min_stock';
  sql += ' ORDER BY p.name';
  const products = getDb().prepare(sql).all(...params);
  const adminList = !!filters.admin_list;
  const liteProductFetch = !!(filters.combo_picker || filters.menu_flags_only || filters.ids_only);
  if (!liteProductFetch && !adminList) {
    maybeSyncMenuHighlights();
  }

  if (filters.menu_flags_only) {
    return products.map((p) => ({
      id: p.id,
      name: p.name,
      selling_price: p.selling_price,
      available_today: p.available_today,
      is_new_arrival: p.is_new_arrival,
      is_best_seller: p.is_best_seller,
      new_arrival_until: p.new_arrival_until
    }));
  }

  if (filters.combo_picker) {
    const modRows = products.length
      ? getDb().prepare(`SELECT product_id, modifier_type FROM product_modifiers WHERE product_id IN (${products.map(() => '?').join(',')})`).all(...products.map(p => p.id))
      : [];
    const hasRemoval = {};
    for (const m of modRows) {
      if (m.modifier_type === 'removal') hasRemoval[m.product_id] = true;
    }
    return products.map((p) => ({
      id: p.id,
      name: p.name,
      picture_path: p.picture_path,
      selling_price: p.selling_price,
      has_pap_option: !!hasRemoval[p.id]
    }));
  }

  const byProduct = {};
  if (products.length) {
    const placeholders = products.map(() => '?').join(',');
    const allMods = getDb().prepare(`SELECT * FROM product_modifiers WHERE product_id IN (${placeholders}) ORDER BY id`).all(...products.map(p => p.id));
    for (const m of allMods) {
      if (!byProduct[m.product_id]) byProduct[m.product_id] = [];
      byProduct[m.product_id].push(m);
    }
  }
  // Overlay per-branch stock when branch_stock exists
  let stockMap = {};
  try {
    if (products.length && branchForStock) {
      const placeholders = products.map(() => '?').join(',');
      const rows = getDb().prepare(`
        SELECT product_id, quantity, min_stock FROM branch_stock
        WHERE branch_id = ? AND product_id IN (${placeholders})
      `).all(branchForStock, ...products.map((p) => p.id));
      stockMap = Object.fromEntries(rows.map((r) => [r.product_id, r]));
    }
  } catch (_) { /* migration not applied yet */ }

  let enriched = products.map(p => {
    const bs = stockMap[p.id];
    return {
      ...p,
      stock_quantity: bs ? Number(bs.quantity) : p.stock_quantity,
      min_stock: bs && bs.min_stock != null ? Number(bs.min_stock) : p.min_stock,
      branch_stock_id: branchForStock,
      modifiers: byProduct[p.id] || [],
      options: (byProduct[p.id] || []).filter(m => m.modifier_type === 'option'),
      extras: (byProduct[p.id] || []).filter(m => m.modifier_type === 'extra'),
      removals: (byProduct[p.id] || []).filter(m => m.modifier_type === 'removal')
    };
  });
  if (adminList) return enriched;
  enriched = promoRequestsSvc.applyPromoPricesToProducts(enriched);
  try {
    enriched = require('./recipe-production').applyRecipePromoPricesToProducts(enriched);
  } catch (_) { /* ignore */ }
  try {
    enriched = require('./production-availability').applyCapacityToProducts(enriched);
  } catch (_) { /* ignore */ }
  return flyersSvc.applyFlyerPromoOverlay(enriched);
}

function getProductModifiers(productId) {
  return getDb().prepare('SELECT * FROM product_modifiers WHERE product_id = ? ORDER BY id').all(productId);
}

function ensureProductSchema() {
  const db = getDb();
  const alters = [
    'ALTER TABLE products ADD COLUMN brand TEXT',
    'ALTER TABLE products ADD COLUMN subcategory TEXT',
    'ALTER TABLE products ADD COLUMN supplier_id INTEGER',
    'ALTER TABLE products ADD COLUMN max_stock REAL',
    'ALTER TABLE products ADD COLUMN reorder_level REAL',
    'ALTER TABLE products ADD COLUMN opening_stock REAL DEFAULT 0',
    'ALTER TABLE products ADD COLUMN stock_location TEXT',
    'ALTER TABLE products ADD COLUMN batch_number TEXT',
    'ALTER TABLE products ADD COLUMN expiry_date TEXT',
    'ALTER TABLE products ADD COLUMN item_type TEXT DEFAULT \'retail\'',
    'ALTER TABLE products ADD COLUMN is_archived INTEGER DEFAULT 0',
    'ALTER TABLE products ADD COLUMN qr_code TEXT',
    'ALTER TABLE products ADD COLUMN stock_unit_type TEXT DEFAULT \'piece\'',
    'ALTER TABLE products ADD COLUMN stock_unit TEXT DEFAULT \'each\'',
    'ALTER TABLE products ADD COLUMN purchase_unit TEXT',
    'ALTER TABLE products ADD COLUMN purchase_unit_qty REAL DEFAULT 1',
    'ALTER TABLE products ADD COLUMN purchase_unit_label TEXT',
    'ALTER TABLE products ADD COLUMN recipe_cost REAL DEFAULT 0',
    'ALTER TABLE products ADD COLUMN food_cost_pct REAL DEFAULT 0',
    'ALTER TABLE products ADD COLUMN gross_profit REAL DEFAULT 0',
    'ALTER TABLE products ADD COLUMN profit_margin REAL DEFAULT 0',
    'ALTER TABLE products ADD COLUMN alert_out_of_stock INTEGER DEFAULT 1',
    'ALTER TABLE products ADD COLUMN has_recipe INTEGER DEFAULT 0',
    'ALTER TABLE products ADD COLUMN option_groups_meta TEXT',
    'ALTER TABLE products ADD COLUMN requires_options INTEGER DEFAULT 0',
    "ALTER TABLE products ADD COLUMN options_style TEXT DEFAULT 'radio'",
    'ALTER TABLE product_modifiers ADD COLUMN option_group TEXT',
    "ALTER TABLE product_modifiers ADD COLUMN modifier_type TEXT DEFAULT 'extra'",
    'ALTER TABLE products ADD COLUMN show_on_pos INTEGER DEFAULT 1',
    'ALTER TABLE products ADD COLUMN online_enabled INTEGER DEFAULT 1'
  ];
  for (const sql of alters) {
    try { db.exec(sql); } catch (_) {}
  }
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS product_modifiers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        extra_price REAL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS product_conversions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        from_qty REAL NOT NULL DEFAULT 1,
        from_unit TEXT NOT NULL,
        to_qty REAL NOT NULL,
        to_unit TEXT NOT NULL,
        label TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS product_recipe_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        ingredient_product_id INTEGER NOT NULL REFERENCES products(id),
        quantity REAL NOT NULL,
        unit TEXT NOT NULL DEFAULT 'each',
        waste_pct REAL DEFAULT 0,
        sort_order INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      );
    `);
  } catch (_) {}
}

function saveProductModifiers(productId, modifiers = []) {
  const db = getDb();
  ensureProductSchema();
  const pid = parseInt(productId, 10);
  if (!pid) return;
  const list = (modifiers || []).filter(m => m?.name?.trim());
  const run = db.transaction(() => {
    db.prepare('DELETE FROM product_modifiers WHERE product_id = ?').run(pid);
    if (!list.length) return;
    const insert = db.prepare('INSERT INTO product_modifiers (product_id, name, extra_price, modifier_type, option_group) VALUES (?,?,?,?,?)');
    for (const m of list) {
      insert.run(
        pid,
        m.name.trim(),
        Number(m.extra_price) || 0,
        m.modifier_type === 'option' ? 'option' : (m.modifier_type === 'removal' ? 'removal' : 'extra'),
        m.option_group?.trim() || null
      );
    }
  });
  run();
}

function resolveTillBranchId() {
  try {
    const scope = branchesSvc.resolveBranchScope(null, { forceTill: true });
    return scope.stampId || scope.branchId || scope.tillId || 1;
  } catch (_) {
    return 1;
  }
}

function overlayBranchStockOnProducts(products, branchId) {
  if (!Array.isArray(products) || !products.length || !branchId) return products;
  try {
    getDb().prepare('SELECT 1 FROM branch_stock LIMIT 1').get();
    const placeholders = products.map(() => '?').join(',');
    const rows = getDb().prepare(`
      SELECT product_id, quantity, min_stock FROM branch_stock
      WHERE branch_id = ? AND product_id IN (${placeholders})
    `).all(branchId, ...products.map((p) => p.id));
    const stockMap = Object.fromEntries(rows.map((r) => [r.product_id, r]));
    return products.map((p) => {
      const bs = stockMap[p.id];
      if (!bs) return p;
      return {
        ...p,
        stock_quantity: Number(bs.quantity),
        min_stock: bs.min_stock != null ? Number(bs.min_stock) : p.min_stock
      };
    });
  } catch (_) {
    return products;
  }
}

function getProduct(id) {
  const p = getDb().prepare(`
    SELECT p.*, c.name AS category_name FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE p.id = ?
  `).get(id);
  if (!p) return null;
  const mods = getProductModifiers(id);
  const recipe = inventory.getProductRecipe(id);
  const metrics = inventory.calculateRecipeMetrics(id, p.selling_price);
  const base = {
    ...p,
    modifiers: mods,
    options: mods.filter(m => m.modifier_type === 'option'),
    extras: mods.filter(m => m.modifier_type === 'extra'),
    removals: mods.filter(m => m.modifier_type === 'removal'),
    conversions: inventory.getProductConversions(id),
    recipe,
    recipe_metrics: metrics
  };
  const [decorated] = flyersSvc.applyFlyerPromoOverlay(
    promoRequestsSvc.applyPromoPricesToProducts([base])
  );
  const bid = resolveTillBranchId();
  const [withStock] = overlayBranchStockOnProducts([decorated || base], bid);
  return withStock || decorated || base;
}

function getProductByBarcode(barcode) {
  const code = String(barcode || '').trim();
  if (!code) return null;
  let p = getDb().prepare('SELECT * FROM products WHERE barcode = ? AND is_active = 1').get(code);
  if (!p) p = getDb().prepare('SELECT * FROM products WHERE sku = ? AND is_active = 1').get(code);
  if (!p) return null;
  const decorated = getProduct(p.id);
  if (!decorated) return null;
  try {
    const [withCap] = require('./production-availability').applyCapacityToProducts([decorated]);
    return withCap || decorated;
  } catch (_) {
    return decorated;
  }
}

function saveProduct(data, actorId, actorName) {
  ensureProductSchema();
  if (!data.name?.trim() && !data.id) throw new Error('Product name is required');

  if (data.id) {
    const existing = getDb().prepare('SELECT * FROM products WHERE id = ?').get(data.id);
    if (!existing) throw new Error('Product not found');

    const pick = (key, fallback) => (data[key] !== undefined ? data[key] : fallback);
    const name = data.name !== undefined ? String(data.name).trim() : existing.name;
    if (!name) throw new Error('Product name is required');
    const sellingPrice = pick('selling_price', existing.selling_price);
    if (sellingPrice == null || Number(sellingPrice) <= 0) throw new Error('Selling price must be greater than 0');

    const fields = {
      name,
      category_id: pick('category_id', existing.category_id),
      selling_price: Number(sellingPrice),
      buying_price: pick('buying_price', existing.buying_price) || 0,
      barcode: pick('barcode', existing.barcode),
      sku: pick('sku', existing.sku),
      stock_quantity: data.stock_quantity !== undefined ? data.stock_quantity : existing.stock_quantity,
      min_stock: pick('min_stock', existing.min_stock) ?? 5,
      max_stock: pick('max_stock', existing.max_stock),
      reorder_level: pick('reorder_level', existing.reorder_level),
      unit: data.stock_unit || data.unit || existing.stock_unit || existing.unit || 'each',
      stock_unit_type: pick('stock_unit_type', existing.stock_unit_type) || 'piece',
      stock_unit: data.stock_unit || data.unit || existing.stock_unit || existing.unit || 'each',
      purchase_unit: pick('purchase_unit', existing.purchase_unit),
      purchase_unit_qty: pick('purchase_unit_qty', existing.purchase_unit_qty) ?? 1,
      purchase_unit_label: pick('purchase_unit_label', existing.purchase_unit_label),
      alert_out_of_stock: data.alert_out_of_stock !== undefined
        ? (data.alert_out_of_stock !== false ? 1 : 0)
        : (existing.alert_out_of_stock !== 0 ? 1 : 0),
      picture_path: pick('picture_path', existing.picture_path),
      description: pick('description', existing.description),
      brand: pick('brand', existing.brand),
      subcategory: pick('subcategory', existing.subcategory),
      supplier_id: pick('supplier_id', existing.supplier_id),
      item_type: pick('item_type', existing.item_type) || 'retail',
      stock_location: pick('stock_location', existing.stock_location),
      expiry_date: pick('expiry_date', existing.expiry_date),
      qr_code: pick('qr_code', existing.qr_code),
      is_archived: data.is_archived !== undefined ? (data.is_archived ? 1 : 0) : (existing.is_archived ? 1 : 0),
      is_active: data.is_active !== undefined ? (data.is_active ? 1 : 0) : existing.is_active,
      requires_options: data.requires_options !== undefined ? (data.requires_options ? 1 : 0) : (existing.requires_options ? 1 : 0),
      options_style: pick('options_style', existing.options_style) || 'radio',
      option_groups_meta: data.option_groups_meta !== undefined
        ? (data.option_groups_meta ? (typeof data.option_groups_meta === 'string' ? data.option_groups_meta : JSON.stringify(data.option_groups_meta)) : null)
        : existing.option_groups_meta
    };

    getDb().prepare(`
      UPDATE products SET name=?, category_id=?, selling_price=?, buying_price=?, barcode=?, sku=?,
      stock_quantity=?, min_stock=?, max_stock=?, reorder_level=?, unit=?, stock_unit_type=?, stock_unit=?,
      purchase_unit=?, purchase_unit_qty=?, purchase_unit_label=?, alert_out_of_stock=?,
      picture_path=?, description=?, brand=?, subcategory=?, supplier_id=?, item_type=?, stock_location=?,
      expiry_date=?, qr_code=?, is_archived=?, is_active=?, requires_options=?, options_style=?, option_groups_meta=?, updated_at=datetime('now')
      WHERE id=?
    `).run(fields.name, fields.category_id, fields.selling_price, fields.buying_price,
      fields.barcode, fields.sku, fields.stock_quantity, fields.min_stock, fields.max_stock,
      fields.reorder_level, fields.unit, fields.stock_unit_type, fields.stock_unit,
      fields.purchase_unit, fields.purchase_unit_qty, fields.purchase_unit_label, fields.alert_out_of_stock,
      fields.picture_path, fields.description, fields.brand, fields.subcategory, fields.supplier_id,
      fields.item_type, fields.stock_location, fields.expiry_date, fields.qr_code,
      fields.is_archived, fields.is_active, fields.requires_options, fields.options_style, fields.option_groups_meta, data.id);

    if (data.modifiers !== undefined) {
      try { saveProductModifiers(data.id, data.modifiers || []); } catch (err) {
        console.error('Product modifiers save warning:', err.message);
      }
    }
    if (data.conversions !== undefined || data.recipe !== undefined) {
      try {
        if (data.conversions !== undefined) inventory.saveProductConversions(data.id, data.conversions || []);
        if (data.recipe !== undefined) inventory.saveProductRecipe(data.id, data.recipe || []);
        inventory.updateProductRecipeMetrics(data.id, fields.selling_price);
      } catch (err) {
        console.error('Product inventory extras save warning:', err.message);
      }
    } else if (existing.selling_price !== fields.selling_price) {
      try { inventory.updateProductRecipeMetrics(data.id, fields.selling_price); } catch (_) { /* ignore */ }
    }
    if (existing.selling_price !== fields.selling_price) {
      auditSvc.logPriceChange(data.id, fields.name, existing.selling_price, fields.selling_price, actorId, actorName);
    }
    audit(actorId, actorName, 'update_product', 'product', data.id, { name: fields.name });
    if (data.branch_id !== undefined) {
      try {
        getDb().prepare('UPDATE products SET branch_id = ? WHERE id = ?').run(data.branch_id || null, data.id);
      } catch (_) { /* column may not exist */ }
    }
    if (data.stock_quantity !== undefined) {
      syncProductBranchStock(data.id, data.stock_quantity, actorId, 'Product edit');
    }
    syncProductChannelFlags(data.id, data, existing);
    checkLowStock(data.id);
    try { require('../database/db').persistNow?.(); } catch (_) { /* optional */ }
    try { require('../../lib/product-images').invalidateProductImage(data.id); } catch (_) { /* optional */ }
    return getProduct(data.id) || data.id;
  }

  if (!data.name?.trim()) throw new Error('Product name is required');
  const isIngredient = data.item_type === 'ingredient';
  if (!isIngredient && (!(Number(data.selling_price) > 0))) {
    throw new Error('Selling price must be greater than 0');
  }
  const fields = {
    name: data.name.trim(),
    category_id: data.category_id || null,
    selling_price: data.selling_price,
    buying_price: data.buying_price || 0,
    barcode: data.barcode || null,
    sku: data.sku || null,
    stock_quantity: data.stock_quantity ?? 0,
    min_stock: data.min_stock ?? 5,
    max_stock: data.max_stock || null,
    reorder_level: data.reorder_level || null,
    unit: data.stock_unit || data.unit || 'each',
    stock_unit_type: data.stock_unit_type || 'piece',
    stock_unit: data.stock_unit || data.unit || 'each',
    purchase_unit: data.purchase_unit || null,
    purchase_unit_qty: data.purchase_unit_qty ?? 1,
    purchase_unit_label: data.purchase_unit_label || null,
    alert_out_of_stock: data.alert_out_of_stock !== false ? 1 : 0,
    picture_path: data.picture_path || null,
    description: data.description || null,
    brand: data.brand || null,
    subcategory: data.subcategory || null,
    supplier_id: data.supplier_id || null,
    item_type: data.item_type || 'retail',
    stock_location: data.stock_location || null,
    expiry_date: data.expiry_date || null,
    qr_code: data.qr_code || null,
    is_archived: data.is_archived ? 1 : 0,
    is_active: data.is_active !== undefined ? (data.is_active ? 1 : 0) : 1,
    requires_options: data.requires_options ? 1 : 0,
    options_style: data.options_style || 'radio',
    option_groups_meta: data.option_groups_meta ? (typeof data.option_groups_meta === 'string' ? data.option_groups_meta : JSON.stringify(data.option_groups_meta)) : null
  };

  const r = getDb().prepare(`
    INSERT INTO products (name, category_id, selling_price, buying_price, barcode, sku,
    stock_quantity, min_stock, max_stock, reorder_level, unit, stock_unit_type, stock_unit,
    purchase_unit, purchase_unit_qty, purchase_unit_label, alert_out_of_stock,
    picture_path, description, brand, subcategory, supplier_id, item_type, stock_location,
    expiry_date, qr_code, opening_stock, is_active, requires_options, options_style, option_groups_meta)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(fields.name, fields.category_id, fields.selling_price, fields.buying_price,
    fields.barcode, fields.sku, fields.stock_quantity, fields.min_stock, fields.max_stock,
    fields.reorder_level, fields.unit, fields.stock_unit_type, fields.stock_unit,
    fields.purchase_unit, fields.purchase_unit_qty, fields.purchase_unit_label, fields.alert_out_of_stock,
    fields.picture_path, fields.description, fields.brand, fields.subcategory, fields.supplier_id,
    fields.item_type, fields.stock_location, fields.expiry_date, fields.qr_code,
    fields.stock_quantity, fields.is_active, fields.requires_options, fields.options_style, fields.option_groups_meta);

  let newId = parseInt(r.lastInsertRowid, 10);
  if (!newId) {
    const row = getDb().prepare('SELECT id FROM products WHERE name = ? ORDER BY id DESC LIMIT 1').get(fields.name);
    newId = row?.id ? parseInt(row.id, 10) : 0;
  }
  if (!newId) throw new Error('Failed to add product — database did not return a product ID. Restart the app and try again.');

  try { saveProductModifiers(newId, data.modifiers || []); } catch (err) {
    console.error('Product modifiers save warning:', err.message);
  }
  try {
    inventory.saveProductConversions(newId, data.conversions || []);
    inventory.saveProductRecipe(newId, data.recipe || []);
    inventory.updateProductRecipeMetrics(newId, fields.selling_price);
  } catch (err) {
    console.error('Product inventory extras save warning:', err.message);
  }

  audit(actorId, actorName, 'create_product', 'product', newId, { name: fields.name });
  if (data.branch_id !== undefined) {
    try {
      getDb().prepare('UPDATE products SET branch_id = ? WHERE id = ?').run(data.branch_id || null, newId);
    } catch (_) { /* ignore */ }
  }
  if (fields.stock_quantity != null) {
    syncProductBranchStock(newId, fields.stock_quantity, actorId, 'Product create');
  }
  syncProductChannelFlags(newId, data, null);
  checkLowStock(newId);
  try {
    if (fields.item_type !== 'ingredient') {
      require('../../lib/menu-highlights').markNewArrival(getDb(), newId, getSettingsParsed());
    }
  } catch (_) { /* optional */ }
  try { require('../database/db').persistNow?.(); } catch (_) { /* optional */ }
  return getProduct(newId) || newId;
}

function deleteProduct(id, actorId, actorName) {
  getDb().prepare('UPDATE products SET is_active = 0 WHERE id = ?').run(id);
  audit(actorId, actorName, 'delete_product', 'product', id, null);
  try { require('../../lib/product-images').invalidateProductImage(id); } catch (_) { /* optional */ }
}

function checkLowStock(productId, prevStock = null) {
  const p = getDb().prepare('SELECT * FROM products WHERE id = ?').get(productId);
  if (!p || p.alert_out_of_stock === 0) return;
  const qty = Number(p.stock_quantity) || 0;
  const prev = prevStock != null ? Number(prevStock) : qty;
  const minStock = Number(p.min_stock) || 0;
  const reorderLevel = p.reorder_level != null ? Number(p.reorder_level) : null;
  const unit = p.stock_unit || p.unit || 'each';
  if (qty <= 0 && prev > 0) {
    addNotification('out_of_stock', 'Out of Stock', `${p.name} is out of stock`, {
      entity_type: 'product', entity_id: productId, action_page: 'stock:inventory'
    });
  } else if (reorderLevel != null && qty <= reorderLevel && prev > reorderLevel) {
    addNotification('reorder', 'Reorder Level', `${p.name}: ${qty} ${unit} — reorder needed`, {
      entity_type: 'product', entity_id: productId, action_page: 'stock:inventory'
    });
  } else if (minStock > 0 && qty < minStock && prev >= minStock) {
    addNotification('low_stock', 'Low Stock', `${p.name}: ${qty} ${unit} (below minimum ${minStock})`, {
      entity_type: 'product', entity_id: productId, action_page: 'stock:inventory'
    });
  }
}

function notifyPosOnlineOrder(order) {
  if (!order) return;
  const total = Number(order.total) || 0;
  addNotification(
    'online_order',
    'New Online Order',
    `${order.order_number || 'Online order'} — ${order.customer_name || 'Customer'} — ${fmtMoney(total)}`,
    { entity_type: 'online_order', entity_id: order.id, action_page: 'pos' }
  );
}

/** Default audience roles for a notification type / action page (who should see it). */
function defaultNotificationAudience(type, actionPage) {
  const t = String(type || '').toLowerCase();
  const page = String(actionPage || '').toLowerCase();
  const ops = ['owner', 'manager', 'assistant_manager', 'supervisor'];
  const admins = ['owner', 'manager'];
  const stockRoles = ['owner', 'manager', 'assistant_manager', 'supervisor'];
  if (page.startsWith('operations:cashup') || ['cashout', 'cashup', 'target_met', 'target_missed', 'cash_drop'].includes(t)) {
    return ops;
  }
  if (page.startsWith('operations:stockcount') || t === 'stock_count') return stockRoles;
  if (page === 'staff' || t === 'compliance' || t === 'checklist_reminder' || t === 'checklist_overdue') {
    return ['owner', 'manager', 'assistant_manager', 'supervisor', 'cashier'];
  }
  if (page.startsWith('admin:opscompliance')) return ops;
  if (page.startsWith('admin:recruitment') || t.startsWith('recruitment')) return ops;
  if (['low_stock', 'out_of_stock', 'reorder'].includes(t) || page.includes('inventory') || page.includes('stock')) {
    return stockRoles;
  }
  if (t.startsWith('owner_salary')) return admins;
  if (['payroll_due', 'uif', 'paye', 'sdl', 'coida'].includes(t)) return admins;
  if (page.startsWith('admin:approvals') || t === 'pending' || t.includes('approval')) return admins;
  if (page.startsWith('admin:')) return ops;
  if (page === 'pos') return ['owner', 'manager', 'cashier', 'supervisor', 'assistant_manager'];
  return ops;
}

function addNotification(type, title, message, opts = {}) {
  const entityType = opts.entity_type || null;
  const entityId = opts.entity_id != null ? opts.entity_id : null;
  const actionPage = opts.action_page || null;
  let audience = opts.audience_roles || opts.roles || null;
  if (Array.isArray(audience)) audience = audience.join(',');
  if (!audience) audience = defaultNotificationAudience(type, actionPage).join(',');
  const existing = getDb().prepare(
    'SELECT id FROM notifications WHERE type = ? AND message = ? AND is_read = 0 AND date(created_at) = date(\'now\')'
  ).get(type, message);
  if (!existing) {
    try {
      getDb().prepare(
        'INSERT INTO notifications (type, title, message, entity_type, entity_id, action_page, audience_roles) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(type, title, message, entityType, entityId, actionPage, audience);
    } catch (err) {
      if (String(err.message || '').toLowerCase().includes('no such column')) {
        getDb().prepare(
          'INSERT INTO notifications (type, title, message, entity_type, entity_id, action_page) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(type, title, message, entityType, entityId, actionPage);
      } else {
        throw err;
      }
    }
  }
}

function fmtMoney(amount, currency) {
  const c = currency || 'R';
  return `${c}${Number(amount || 0).toFixed(2)}`;
}

function notifyShiftClose(shiftId, userId, preview, result) {
  const db = getDb();
  const user = db.prepare('SELECT full_name FROM users WHERE id = ?').get(userId);
  const branch = branchesSvc.getActiveBranch();
  const currency = getSettingsParsed().currency || 'R';
  const cashierName = user?.full_name || 'Unknown';
  const branchName = branch?.name || 'Main Branch';
  const targetMet = !!preview.targetMet;
  const parts = [
    `${cashierName} closed shift at ${branchName}`,
    `Total sales: ${fmtMoney(preview.totalSales, currency)}`
  ];
  if (preview.dailyTarget > 0) {
    parts.push(targetMet
      ? `Target met (${fmtMoney(preview.todaySales, currency)} / ${fmtMoney(preview.dailyTarget, currency)})`
      : `Target missed — ${fmtMoney(preview.targetRemaining, currency)} short`);
  }
  const cashDiff = result.difference;
  if (Math.abs(cashDiff) > 0.009) {
    parts.push(`Cash variance: ${fmtMoney(cashDiff, currency)}`);
  }
  addNotification('cashout', 'Shift Cash-Out', parts.join(' · '), {
    entity_type: 'shift',
    entity_id: shiftId,
    action_page: 'operations:cashup'
  });

  if (preview.dailyTarget > 0) {
    if (targetMet) {
      addNotification('target_met', 'Daily Target Met',
        `${branchName}: ${fmtMoney(preview.todaySales, currency)} reached (target ${fmtMoney(preview.dailyTarget, currency)})`, {
          entity_type: 'shift',
          entity_id: shiftId,
          action_page: 'operations:cashup'
        });
    } else {
      addNotification('target_missed', 'Daily Target Missed',
        `${branchName}: ${fmtMoney(preview.todaySales, currency)} of ${fmtMoney(preview.dailyTarget, currency)} — ${fmtMoney(preview.targetRemaining, currency)} short`, {
          entity_type: 'shift',
          entity_id: shiftId,
          action_page: 'operations:cashup'
        });
    }
  }
}

function notifyCashUpSession(cashupId, shiftId, data, actorId) {
  const db = getDb();
  const user = db.prepare('SELECT full_name FROM users WHERE id = ?').get(actorId);
  const branch = branchesSvc.getActiveBranch();
  const currency = getSettingsParsed().currency || 'R';
  const cashierName = user?.full_name || 'Unknown';
  const branchName = branch?.name || 'Main Branch';
  const variance = (data.actual_cash || 0) - (data.expected_cash || 0);
  const today = new Date().toLocaleDateString('en-CA');
  const todaySales = db.prepare(`
    SELECT COALESCE(SUM(total),0) as total FROM sales
    WHERE date(created_at, 'localtime') = date(?) AND status = 'completed'
  `).get(today).total;
  const dailyTarget = getActiveDailyTargetAmount(getSalesTargets());
  const parts = [
    `${cashierName} completed cash-up at ${branchName}`,
    `Expected: ${fmtMoney(data.expected_cash, currency)} · Actual: ${fmtMoney(data.actual_cash, currency)}`
  ];
  if (Math.abs(variance) > 0.009) {
    parts.push(`Variance: ${fmtMoney(variance, currency)}`);
  }
  if (dailyTarget > 0) {
    const met = todaySales >= dailyTarget;
    const remaining = Math.max(0, dailyTarget - todaySales);
    parts.push(met
      ? `Target met (${fmtMoney(todaySales, currency)} / ${fmtMoney(dailyTarget, currency)})`
      : `Target missed — ${fmtMoney(remaining, currency)} short`);
  }
  addNotification('cashout', 'Cash-Up Completed', parts.join(' · '), {
    entity_type: 'cashup',
    entity_id: cashupId,
    action_page: 'operations:cashup'
  });
}

function createTestNotification() {
  addNotification('test', 'Test Notification', 'This is a test alert. Open notifications and mark as read to stop the sound.');
}

// ─── Stock ──────────────────────────────────────────────────────────────────

function branchStockTableExists() {
  try {
    getDb().prepare('SELECT 1 FROM branch_stock LIMIT 1').get();
    return true;
  } catch (_) {
    return false;
  }
}

/** Keep branch_stock in sync when products.stock_quantity is edited (UI reads branch overlay). */
function syncProductBranchStock(productId, quantity, actorId, note = 'Product stock update') {
  if (!branchStockTableExists()) return;
  const scope = branchesSvc.resolveBranchScope({ id: actorId }, { forceTill: true });
  branchesSvc.ensureBranchStockRow(productId, scope.stampId);
  branchesSvc.adjustBranchStock(
    productId,
    Number(quantity) || 0,
    'set',
    note,
    actorId,
    'product',
    productId,
    scope.stampId
  );
}

function adjustStock(productId, quantity, type, notes, userId, refType, refId, branchId) {
  const scope = branchesSvc.resolveBranchScope(
    userId ? { id: userId } : null,
    { forceTill: true, branchId }
  );
  const bid = branchId != null ? Number(branchId) : scope.stampId;
  try {
    // Prefer per-branch stock when table exists
    getDb().prepare('SELECT 1 FROM branch_stock LIMIT 1').get();
    const productBefore = getDb().prepare('SELECT stock_quantity FROM products WHERE id = ?').get(productId);
    const prevStock = productBefore?.stock_quantity;
    const newStock = branchesSvc.adjustBranchStock(productId, quantity, type, notes, userId, refType, refId, bid);
    checkLowStock(productId, prevStock);
    try {
      require('./production-availability').refreshAffectedByIngredient(productId);
    } catch (_) { /* ignore */ }
    return newStock;
  } catch (err) {
    if (String(err.message || '').includes('Insufficient')) throw err;
    // Fallback to legacy single-stock
  }
  const db = getDb();
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
  if (!product) throw new Error('Product not found');
  const prev = product.stock_quantity;
  let newStock;
  if (type === 'set') {
    newStock = quantity;
    quantity = Math.abs(newStock - prev);
  } else if (type === 'remove' || type === 'sale') {
    newStock = prev - quantity;
    if (!getAllowOversell() && newStock < 0) {
      throw new Error(`Insufficient stock for ${product.name}. Available: ${prev}, requested: ${quantity}`);
    }
  } else {
    newStock = prev + quantity;
  }
  db.prepare('UPDATE products SET stock_quantity = ?, updated_at = datetime(\'now\') WHERE id = ?').run(newStock, productId);
  checkLowStock(productId, prev);
  db.prepare(`
    INSERT INTO stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, reference_type, reference_id, notes, user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(productId, type === 'set' ? 'adjust' : type, quantity, prev, newStock, refType, refId, notes, userId);
  try {
    require('./production-availability').refreshAffectedByIngredient(productId);
  } catch (_) { /* ignore */ }
  return newStock;
}

function getStockHistory(productId) {
  return getDb().prepare(`
    SELECT sm.*, u.full_name as user_name, p.name as product_name
    FROM stock_movements sm
    LEFT JOIN users u ON sm.user_id = u.id
    LEFT JOIN products p ON sm.product_id = p.id
    WHERE sm.product_id = ?
    ORDER BY sm.created_at DESC LIMIT 100
  `).all(productId);
}

function getAllStockHistory(limit = 100) {
  return getDb().prepare(`
    SELECT sm.*, u.full_name as user_name, p.name as product_name
    FROM stock_movements sm
    LEFT JOIN users u ON sm.user_id = u.id
    LEFT JOIN products p ON sm.product_id = p.id
    ORDER BY sm.created_at DESC LIMIT ?
  `).all(limit);
}

function resolveProductRef(ref) {
  const db = getDb();
  const id = Number(ref);
  if (id) {
    const byId = db.prepare('SELECT * FROM products WHERE id = ? AND is_active = 1').get(id);
    if (byId) return byId;
  }
  const term = String(ref || '').trim();
  if (!term) throw new Error('Product is required');
  let product = db.prepare('SELECT * FROM products WHERE barcode = ? AND is_active = 1').get(term);
  if (product) return product;
  product = db.prepare("SELECT * FROM products WHERE lower(trim(name)) = lower(trim(?)) AND is_active = 1").get(term);
  if (product) return product;
  product = db.prepare('SELECT * FROM products WHERE name LIKE ? AND is_active = 1 ORDER BY id LIMIT 1').get(`%${term}%`);
  if (product) return product;
  throw new Error(`Product not found: ${term}`);
}

function recordStockAdjustment(data = {}, actor) {
  const { assertUserActor } = require('./authz');
  const user = assertUserActor(actor, ['owner', 'manager', 'supervisor', 'assistant_manager']);
  const product = resolveProductRef(data.product_id || data.product);
  const rawQty = Number(data.qty ?? data.quantity ?? data.qty_change ?? 0);
  const directionRaw = String(data.direction || data.adjustment_type || '').toLowerCase();
  const direction = directionRaw === 'adjust' ? 'set' : directionRaw;
  if (!rawQty && direction !== 'set') throw new Error('Quantity is required');
  let type;
  let amount;
  if (direction === 'set') {
    type = 'set';
    amount = Math.abs(rawQty);
  } else if (rawQty < 0 || direction === 'remove' || direction === 'deduct' || direction === 'out') {
    type = 'remove';
    amount = Math.abs(rawQty || data.qty);
  } else {
    type = 'add';
    amount = Math.abs(rawQty);
  }
  if (!amount && type !== 'set') throw new Error('Quantity must be greater than zero');
  const notes = data.reason || data.notes || `Stock adjustment (${type})`;
  const branchId = data.branch_id || null;
  const newStock = adjustStock(product.id, amount, type, notes, user.id, 'stock_adjustment', null, branchId);
  try { require('../database/db').persistNow?.(); } catch (_) { /* optional */ }
  try {
    const sync = require('./sync');
    if (sync.getSyncSettings?.().device_token) {
      sync.publishProducts(() => getProducts(), () => getCategories()).catch(() => {});
    }
  } catch (_) { /* optional hub publish */ }
  return {
    product_id: product.id,
    product_name: product.name,
    movement_type: type,
    quantity: amount,
    new_stock: newStock,
    notes,
    created_at: new Date().toISOString()
  };
}

function listStockAdjustments(filters = {}) {
  const limit = Math.min(Number(filters.limit) || 200, 500);
  return getDb().prepare(`
    SELECT sm.*, p.name AS product_name, u.full_name AS user_name
    FROM stock_movements sm
    LEFT JOIN products p ON p.id = sm.product_id
    LEFT JOIN users u ON u.id = sm.user_id
    WHERE sm.reference_type = 'stock_adjustment'
       OR (sm.reference_type = 'manual' AND sm.movement_type IN ('add', 'remove', 'adjust'))
    ORDER BY sm.created_at DESC LIMIT ?
  `).all(limit);
}

// ─── Sales / POS ────────────────────────────────────────────────────────────

function resolveModifierExtras(productId, modifiers) {
  if (!productId || !modifiers?.length) return 0;
  const db = getDb();
  let extra = 0;
  for (const m of modifiers) {
    let mod = null;
    if (m.id) {
      mod = db.prepare('SELECT extra_price, modifier_type FROM product_modifiers WHERE id = ? AND product_id = ?').get(m.id, productId);
    }
    if (!mod && m.name) {
      mod = db.prepare('SELECT extra_price, modifier_type FROM product_modifiers WHERE product_id = ? AND name = ?').get(productId, m.name);
    }
    extra += Number(mod?.extra_price) || Number(m.extra_price) || 0;
  }
  return extra;
}

function serverPromoUnitPrice(product, modifiers) {
  const promoPricing = require('../../lib/promo-pricing');
  const enriched = promoRequestsSvc.applyPromoPricesToProducts([product])[0] || product;
  const modExtra = resolveModifierExtras(product.id, modifiers);
  return {
    unitPrice: promoPricing.calcPromoAwareUnitPrice({
      promoActive: !!enriched.promo_active,
      normalPrice: enriched.original_price ?? enriched.selling_price,
      salePrice: enriched.selling_price,
      modifiers,
      modifierExtraTotal: modExtra
    }),
    promoRequestId: promoPricing.promoOptedOut(enriched.promo_active, modifiers) ? null : (enriched.promo_request_id || null),
    originalUnitPrice: promoPricing.promoOptedOut(enriched.promo_active, modifiers)
      ? null
      : (enriched.promo_active ? (enriched.original_price ?? null) : null)
  };
}

function completeSale(saleData, actorId, actorName, actorRole) {
  const db = getDb();
  const actorUser = db.prepare('SELECT id, role, full_name, is_active FROM users WHERE id = ?').get(actorId);
  if (!actorUser || !actorUser.is_active) throw new Error('Invalid or inactive user');
  const dbRole = actorUser.role || actorRole;
  if (roleRequiresShift(dbRole)) {
    const shift = getOpenShift(actorId);
    if (!shift) throw new Error('You must open a shift before completing sales');
  }
  const branchId = (() => {
    try {
      const actor = actorId ? getDb().prepare('SELECT id, role, branch_id FROM users WHERE id = ?').get(actorId) : null;
      return branchesSvc.resolveTillBranchId(actor, {
        till_branch_id: saleData?.till_branch_id ?? saleData?.branch_id,
        branch_id: saleData?.branch_id
      });
    } catch (_) {
      return features.getBranchId();
    }
  })();
  const deviceId = syncSvc.resolveDeviceUid();

  // Offline replay: same client_request_id must not create a duplicate sale
  const clientRequestId = saleData && saleData.client_request_id
    ? String(saleData.client_request_id).trim()
    : '';
  if (clientRequestId) {
    try {
      db.exec('ALTER TABLE sales ADD COLUMN client_request_id TEXT');
    } catch (_) { /* exists */ }
    try {
      db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_client_request_id ON sales(client_request_id)');
    } catch (_) { /* exists / PG variant */ }
    const existing = db.prepare(
      'SELECT id FROM sales WHERE client_request_id = ? LIMIT 1'
    ).get(clientRequestId);
    if (existing && existing.id) {
      const sale = getSale(existing.id);
      return {
        saleId: existing.id,
        receiptNumber: sale?.receipt_number,
        orderNumber: sale?.order_number,
        sale,
        replayed: true,
        automation: [],
        loyaltyPointsEarned: 0,
        loyaltyPointsRedeemed: 0,
        loyaltyDiscount: 0,
        customerReward: null
      };
    }
  }

  const items = Array.isArray(saleData.items) ? saleData.items : [];
  if (!items.length) throw new Error('Sale must include at least one item');

  const discountAuthorized = !!(saleData.discount_authorized || saleData.discount_approver_id);
  const pricedItems = [];
  let undercharge = 0;

  for (const item of items) {
    const qty = Number(item.quantity) || 0;
    if (qty <= 0) throw new Error(`Invalid quantity for ${item.product_name || 'item'}`);
    if (!item.product_id && !item.combo_id) {
      throw new Error(`Invalid cart line "${item.product_name || 'item'}" — product or combo required`);
    }
    const clientUnit = Number(item.unit_price) || 0;
    let unitPrice = clientUnit;
    let buyingPrice = Number(item.buying_price) || 0;
    let productName = item.product_name;
    let promoRequestId = item.promo_request_id || null;
    let originalUnitPrice = item.original_unit_price ?? null;

    if (item.combo_id) {
      const combo = combosSvc.getCombo(item.combo_id);
      if (!combo) throw new Error(`Combo not found for ${item.product_name || 'combo item'}`);
      unitPrice = Number(combo.final_price) || 0;
      productName = combo.name || productName;
      buyingPrice = (combo.items || []).reduce((s, ci) => {
        const p = db.prepare('SELECT buying_price, recipe_cost, has_recipe FROM products WHERE id = ?').get(ci.product_id);
        const unitCost = lineCostForProduct(p);
        return s + unitCost * (Number(ci.quantity) || 1);
      }, 0);
      originalUnitPrice = Number(combo.normal_price) || null;
    } else if (item.product_id) {
      const product = getProduct(item.product_id);
      if (!product) throw new Error(`Product not found: ${item.product_name || item.product_id}`);
      const priced = serverPromoUnitPrice(product, item.modifiers);
      if (saleData.order_type === 'online' && item.unit_price != null && discountAuthorized) {
        unitPrice = Number(item.unit_price);
      } else {
        unitPrice = priced.unitPrice;
      }
      buyingPrice = lineCostForProduct(product);
      productName = product.name || productName;
      promoRequestId = priced.promoRequestId ?? promoRequestId;
      originalUnitPrice = priced.originalUnitPrice;
    }

    const lineTotal = Math.round(unitPrice * qty * 100) / 100;
    if (item.product_id || item.combo_id) {
      const expectedClient = Math.round(clientUnit * qty * 100) / 100;
      if (expectedClient < lineTotal - 0.02) {
        undercharge += (lineTotal - expectedClient);
      }
    }

    pricedItems.push({
      ...item,
      product_name: productName,
      quantity: qty,
      unit_price: unitPrice,
      buying_price: buyingPrice,
      discount: Number(item.discount) || 0,
      total: lineTotal,
      promo_request_id: promoRequestId,
      original_unit_price: originalUnitPrice
    });
  }

  if (undercharge > 0.02 && !discountAuthorized) {
    throw new Error('Line prices do not match catalog — manager authorization required for discount');
  }

  saleData.items = pricedItems;

  // Automation: check discount / amount rules
  const autoRules = features.evaluateAutomation('before_sale', {
    amount: saleData.total,
    discount_pct: saleData.subtotal > 0 ? (saleData.discount / saleData.subtotal * 100) : 0
  });
  if (autoRules.some(r => r.action?.require_manager)) {
    throw new Error('Manager approval required for this sale');
  }

  const settingsParsed = getSettingsParsed();
  const accountPayments = (saleData.payments || []).filter(p => p.type === 'account' || p.payment_type === 'account');
  if (accountPayments.length) {
    if (!saleData.customer_id) throw new Error('Select a customer for On Account payment');
    const accountTotal = accountPayments.reduce((s, p) => s + Number(p.amount), 0);
    const check = staff.validateOnAccount(saleData.customer_id, accountTotal, settingsParsed.account_settings);
    if (!check.ok) throw new Error(check.error);
  }

  const settingsForTax = getSettingsParsed();
  const grossSubtotal = pricedItems.reduce((s, i) => s + (Number(i.total) || 0), 0);
  const cartDiscount = Number(saleData.discount) || 0;
  if (cartDiscount < -0.001) throw new Error('Invalid cart discount');
  if (cartDiscount > grossSubtotal + 0.02) throw new Error('Cart discount cannot exceed subtotal');
  if (cartDiscount > 0.02) {
    const isMgr = ['owner', 'manager'].includes(dbRole);
    if (!isMgr) {
      const pin = saleData.discount_manager_pin || saleData.manager_pin;
      if (!pin) throw new Error('Manager PIN required for cart discount');
      try {
        auditSvc.verifyManagerPin(pin);
      } catch {
        throw new Error('Invalid manager PIN for cart discount');
      }
    }
    // Discount must not push sale below total cost (profit floor)
    const floor = cartProfitFloor(pricedItems.map(i => {
      if (i.combo_id) {
        return { quantity: i.quantity, buying_price: i.buying_price, recipe_cost: i.buying_price };
      }
      const p = getDb().prepare('SELECT buying_price, recipe_cost, has_recipe FROM products WHERE id=?').get(i.product_id);
      return {
        quantity: i.quantity,
        buying_price: p?.buying_price,
        recipe_cost: p?.recipe_cost
      };
    }));
    if (grossSubtotal - cartDiscount + 0.02 < floor) {
      throw new Error(`Discount too high — would sell below cost (min total ${floor}). Reduce discount to protect profit.`);
    }
  }
  const taxRate = settingsForTax.tax_enabled ? (settingsForTax.tax_rate || 0) : 0;
  const taxInclusive = settingsForTax.tax_inclusive;
  const preLoyaltyTotal = calcSaleTaxTotals(grossSubtotal, cartDiscount, taxRate, taxInclusive).total;
  const loyaltyRedemption = saleData.customer_id && saleData.loyalty_redeem > 0
    ? features.calcLoyaltyRedemption(saleData.customer_id, saleData.loyalty_redeem, preLoyaltyTotal)
    : { points: 0, discount: 0 };
  const saleDiscount = money(cartDiscount + (loyaltyRedemption.discount || 0));
  const taxTotals = calcSaleTaxTotals(grossSubtotal, saleDiscount, taxRate, taxInclusive);
  const deliveryFee = (saleData.order_type === 'delivery' || (saleData.delivery_address && String(saleData.delivery_address).trim()))
    ? money(Number(saleData.delivery_fee) || 0) : 0;
  saleData.delivery_fee = deliveryFee;
  saleData.subtotal = taxTotals.subtotal;
  saleData.tax_amount = taxTotals.tax_amount;
  saleData.total = money(taxTotals.total + deliveryFee);
  const saleTotal = saleData.total;
  const amountPaid = money(saleData.amount_paid);
  if (amountPaid < saleTotal - 0.01) {
    throw new Error('Payment incomplete — amount paid is less than total after loyalty redemption');
  }
  let payments = Array.isArray(saleData.payments) ? saleData.payments : [];
  if (!payments.length && amountPaid >= saleTotal - 0.01) {
    payments = [{ type: 'cash', amount: amountPaid }];
  }
  if (!payments.length) {
    throw new Error('No payment recorded for this sale');
  }
  // Cap all tenders to amount still due so change is not booked as revenue
  let dueLeft = saleTotal;
  const cappedPayments = [];
  let cashTendered = 0;
  for (const payment of payments) {
    const pType = payment.type || payment.payment_type || 'cash';
    let amt = money(payment.amount);
    if (amt <= 0) continue;
    if (pType === 'cash') cashTendered = money(cashTendered + amt);
    if (dueLeft <= 0.009) {
      if (pType === 'cash') continue; // excess cash is change only
      continue;
    }
    if (amt > dueLeft + 0.02) amt = money(dueLeft);
    dueLeft = money(dueLeft - amt);
    cappedPayments.push({ ...payment, type: pType, amount: amt });
  }
  payments = cappedPayments;
  const softSum = payments
    .filter(p => p.type === 'account' || p.type === 'giftcard')
    .reduce((s, p) => s + (Number(p.amount) || 0), 0);
  if (softSum > saleTotal + 0.02) {
    throw new Error('Account/gift card payments exceed sale total');
  }
  const paymentsSum = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  if (paymentsSum < saleTotal - 0.02) {
    throw new Error('Payment incomplete — sum of payments is less than sale total');
  }
  const changeAmount = money(Math.max(0, cashTendered - Math.max(0, saleTotal - softSum)));
  for (const payment of payments) {
    const pType = payment.type || payment.payment_type || 'cash';
    if (pType === 'giftcard' && !payment.gift_card_code) {
      throw new Error('Gift card code required for gift card payment');
    }
  }

  const receiptNumber = nextReceiptNumber();
  const orderNumber = nextOrderNumber();

  // Validate combo stock before transaction
  for (const item of saleData.items || []) {
    if (!item.combo_id) continue;
    const combo = combosSvc.getCombo(item.combo_id);
    if (!combo) throw new Error(`Combo not found for ${item.product_name || 'combo item'}`);
    const need = Number(item.quantity) || 1;
    const avail = combosSvc.comboAvailableUnits(combo, branchId);
    if (need > avail) {
      throw new Error(`Insufficient stock for combo "${combo.name}": need ${need}, have ${avail}`);
    }
  }

  // Production Availability Engine — block sales that cannot be produced
  try {
    require('./production-availability').validateSaleCapacity(saleData.items || [], {
      allowOversell: getAllowOversell()
    });
  } catch (err) {
    throw err;
  }
  if (!getAllowOversell()) {
    for (const item of saleData.items) {
      if (item.combo_id) continue;
      if (!item.product_id) continue;
      const product = db.prepare('SELECT id, name, stock_quantity, has_recipe, production_mode FROM products WHERE id = ?').get(item.product_id);
      if (!product) continue;
      // make_to_order validated above via production capacity
      if (product.has_recipe && product.production_mode !== 'make_to_stock') continue;
      if (product.stock_quantity < item.quantity) {
        throw new Error(`Insufficient stock for ${product.name}. Available: ${product.stock_quantity}, in cart: ${item.quantity}`);
      }
    }
  }

  const paEngine = require('./production-availability');
  paEngine.pauseRefresh();
  let result;
  try {
  // Schema patches must run OUTSIDE the sale transaction (Postgres aborts the whole txn on ALTER errors)
  try { db.exec('ALTER TABLE sales ADD COLUMN IF NOT EXISTS delivery_address TEXT'); } catch (_) {
    try { db.exec('ALTER TABLE sales ADD COLUMN delivery_address TEXT'); } catch (_) { /* exists */ }
  }
  try { db.exec('ALTER TABLE sales ADD COLUMN IF NOT EXISTS client_request_id TEXT'); } catch (_) {
    try { db.exec('ALTER TABLE sales ADD COLUMN client_request_id TEXT'); } catch (_) { /* exists */ }
  }
  try { db.exec('ALTER TABLE sales ADD COLUMN order_source TEXT'); } catch (_) { /* exists */ }
  try { db.exec('ALTER TABLE sales ADD COLUMN delivery_fee REAL DEFAULT 0'); } catch (_) { /* exists */ }
  const txn = db.transaction(() => {
    let saleResult;
    try {
      saleResult = db.prepare(`
      INSERT INTO sales (receipt_number, order_number, user_id, customer_id, subtotal, discount, tax_amount, total, amount_paid, change_amount, notes, branch_id, device_id, status, order_type, table_id, table_name, delivery_address, delivery_fee, client_request_id, order_source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?)
    `).run(receiptNumber, orderNumber, actorId, saleData.customer_id || null,
        saleData.subtotal, saleDiscount, saleData.tax_amount || 0,
        saleTotal, amountPaid, changeAmount, saleData.notes || null, branchId, deviceId,
        saleData.order_type || null, saleData.table_id || null, saleData.table_name || null,
        saleData.delivery_address || null, deliveryFee,
        clientRequestId || null, saleData.order_source || null);
    } catch (_) {
      saleResult = db.prepare(`
      INSERT INTO sales (receipt_number, order_number, user_id, customer_id, subtotal, discount, tax_amount, total, amount_paid, change_amount, notes, branch_id, device_id, status, order_type, table_id, table_name, delivery_address, client_request_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?)
    `).run(receiptNumber, orderNumber, actorId, saleData.customer_id || null,
        saleData.subtotal, saleDiscount, saleData.tax_amount || 0,
        saleTotal, amountPaid, changeAmount, saleData.notes || null, branchId, deviceId,
        saleData.order_type || null, saleData.table_id || null, saleData.table_name || null,
        saleData.delivery_address || null,
        clientRequestId || null);
    }

    const saleId = saleResult.lastInsertRowid;

    if (saleData.table_id && saleData.order_type === 'sit_in') {
      try {
        db.prepare(`UPDATE restaurant_tables SET status = 'occupied' WHERE id = ?`).run(saleData.table_id);
      } catch (_) { /* ignore */ }
    }

    for (const item of saleData.items) {
      const modText = item.modifiers_text || (item.modifiers ? item.modifiers.map(m => m.name).join(', ') : null);
      const promoRequestId = item.promo_request_id || null;
      const originalUnitPrice = item.original_unit_price ?? null;
      const itemResult = db.prepare(`
        INSERT INTO sale_items (sale_id, product_id, product_name, quantity, unit_price, buying_price, discount, total, modifiers_text, item_type, combo_id, original_unit_price, promo_request_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(saleId, item.product_id || null, item.product_name, item.quantity,
        item.unit_price, item.buying_price || 0, item.discount || 0, item.total, modText, item.item_type || null, item.combo_id || null,
        originalUnitPrice, promoRequestId);
      const saleItemId = itemResult.lastInsertRowid;
      if (item.combo_id) {
        combosSvc.processComboSale(item.combo_id, item.quantity, saleId, saleItemId, adjustStock, actorId, receiptNumber);
      } else if (item.product_id) {
        const prodMeta = db.prepare('SELECT has_recipe, production_mode, stock_quantity FROM products WHERE id = ?').get(item.product_id);
        const makeToStock = prodMeta?.production_mode === 'make_to_stock';
        if (makeToStock) {
          adjustStock(item.product_id, item.quantity, 'sale', `Sale ${receiptNumber}`, actorId, 'sale', saleId);
        } else {
          const saleNote = `Sale ${receiptNumber} (recipe)`;
          const selectedMods = item.modifiers?.length
            ? item.modifiers
            : String(item.modifiers_text || modText || '')
              .split(',')
              .map(s => ({ name: s.trim() }))
              .filter(m => m.name);
          const recipeDeducted = inventory.deductRecipeIngredients(
            item.product_id, item.quantity, saleNote, actorId, 'sale', saleId, adjustStock, selectedMods, item.substitutions || null
          );
          if (!recipeDeducted) {
            adjustStock(item.product_id, item.quantity, 'sale', `Sale ${receiptNumber}`, actorId, 'sale', saleId);
          }
        }
        db.prepare('UPDATE products SET last_sale_date = date(\'now\') WHERE id = ?').run(item.product_id);
      }
    }

    for (const payment of payments) {
      const pType = payment.type || payment.payment_type || 'cash';
      db.prepare('INSERT INTO sale_payments (sale_id, payment_type, amount) VALUES (?, ?, ?)')
        .run(saleId, pType, Number(payment.amount) || 0);
      if (pType === 'account' && saleData.customer_id) {
        features.addCustomerCreditCharge(saleData.customer_id, payment.amount, saleId, `Sale ${receiptNumber}`, actorId);
        const acct = settingsParsed.account_settings || {};
        const cust = db.prepare('SELECT on_account_period_days FROM customers WHERE id = ?').get(saleData.customer_id);
        const days = cust?.on_account_period_days || acct.default_period_days || 30;
        const due = new Date();
        due.setDate(due.getDate() + Number(days));
        db.prepare('UPDATE customers SET on_account_due_date = ? WHERE id = ?')
          .run(due.toLocaleDateString('en-CA'), saleData.customer_id);
      }
      if (pType === 'giftcard') {
        if (!payment.gift_card_code) throw new Error('Gift card code required for gift card payment');
        if (!payment.gift_card_pre_redeemed) {
          features.redeemGiftCard(payment.gift_card_code, payment.amount, saleId, actorId);
        }
      }
    }

    if (loyaltyRedemption.points > 0 && saleData.customer_id) {
      features.redeemLoyaltyPoints(saleData.customer_id, loyaltyRedemption.points, saleId);
    }

    return { saleId, receiptNumber, orderNumber };
  });

  result = txn();
  } finally {
    paEngine.resumeRefresh({ refresh: true });
  }

  let loyaltyPointsEarned = 0;
  let customerReward = null;
  if (saleData.customer_id) {
    try { loyaltyPointsEarned = features.earnLoyaltyPoints(saleData.customer_id, saleTotal, result.saleId); } catch (_) {}
    try {
      customerReward = customerRewardsSvc.processCustomerRewards(
        saleData.customer_id,
        result.saleId,
        saleTotal,
        (data, aId, aName) => features.createGiftCard(data, aId, aName),
        actorId,
        actorName
      );
    } catch (_) {}
  }

  audit(actorId, actorName, 'complete_sale', 'sale', result.saleId, { receipt_number: result.receiptNumber, order_number: result.orderNumber, total: saleTotal });
  features.log('info', 'sale', `Sale ${result.receiptNumber} completed`, { total: saleTotal, actorId });
  try { syncSvc.enqueueSale(result.saleId); } catch (_) {}
  try {
    if (saleData.referral_code || saleData.marketing_agent_id || saleData.mkt_campaign_id || saleData.mkt_coupon_code) {
      for (const sql of [
        'ALTER TABLE sales ADD COLUMN referral_code TEXT',
        'ALTER TABLE sales ADD COLUMN marketing_agent_id INTEGER',
        'ALTER TABLE sales ADD COLUMN mkt_campaign_id INTEGER',
        'ALTER TABLE sales ADD COLUMN mkt_coupon_code TEXT'
      ]) {
        try { getDb().exec(sql); } catch (_) { /* exists */ }
      }
      getDb().prepare(`
        UPDATE sales SET referral_code = COALESCE(?, referral_code),
          marketing_agent_id = COALESCE(?, marketing_agent_id),
          mkt_campaign_id = COALESCE(?, mkt_campaign_id),
          mkt_coupon_code = COALESCE(?, mkt_coupon_code)
        WHERE id = ?`).run(
        saleData.referral_code || null,
        saleData.marketing_agent_id || null,
        saleData.mkt_campaign_id || null,
        saleData.mkt_coupon_code || null,
        result.saleId
      );
    }
  } catch (_) { /* ignore */ }
  try { marketingPlatformSvc.processSaleForMarketing(result.saleId); } catch (err) {
    console.warn('[mkt] sale attribution:', err.message);
  }
  try {
    accHook('postFromSale', result.saleId);
  } catch (err) {
    console.warn('[acc] sale post:', err.message);
  }
  try {
    const mobileMgr = require('./mobile-manager');
    mobileMgr.notifyNewSale(result.saleId);
    const branchId = saleData.branch_id || getDb().prepare('SELECT branch_id FROM shop_settings WHERE id = 1').get()?.branch_id || 1;
    mobileMgr.recordPosHeartbeat(branchId, deviceId || 'pos', 'POS Till');
  } catch (err) {
    console.warn('[mobile] sale notify:', err.message);
  }
  try {
    const delivery = require('./delivery-platform');
    const saleRow = getSale(result.saleId);
    if (saleRow) delivery.upsertFromSale(saleRow);
  } catch (_) { /* optional */ }
  return {
    ...result,
    sale: getSale(result.saleId),
    automation: autoRules,
    loyaltyPointsEarned,
    loyaltyPointsRedeemed: loyaltyRedemption.points,
    loyaltyDiscount: loyaltyRedemption.discount,
    customerReward
  };
}

function getSale(id) {
  const sale = getDb().prepare(`
    SELECT s.*, u.full_name as cashier_name, c.name as customer_name, c.phone as customer_phone
    FROM sales s
    LEFT JOIN users u ON s.user_id = u.id
    LEFT JOIN customers c ON s.customer_id = c.id
    WHERE s.id = ?
  `).get(id);
  if (!sale) return null;
  sale.items = getDb().prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(id);
  sale.payments = getDb().prepare('SELECT * FROM sale_payments WHERE sale_id = ?').all(id);
  const loyaltyRedeem = getDb().prepare(`
    SELECT COALESCE(SUM(ABS(points)), 0) as points FROM loyalty_transactions
    WHERE sale_id = ? AND type = 'redeem'`).get(id);
  const loyaltyEarn = getDb().prepare(`
    SELECT COALESCE(SUM(points), 0) as points FROM loyalty_transactions
    WHERE sale_id = ? AND type = 'earn'`).get(id);
  sale.loyalty_points_redeemed = Number(loyaltyRedeem?.points) || 0;
  sale.loyalty_points_earned = Number(loyaltyEarn?.points) || 0;
  sale.gift_card_amount = sale.payments
    .filter(p => p.payment_type === 'giftcard')
    .reduce((s, p) => s + Number(p.amount), 0);
  return sale;
}

function getSaleByReceipt(receiptNumber) {
  const sale = getDb().prepare('SELECT id FROM sales WHERE receipt_number = ?').get(receiptNumber);
  return sale ? getSale(sale.id) : null;
}

function holdOrder(name, cartData, userId) {
  const r = getDb().prepare('INSERT INTO held_orders (name, user_id, cart_data) VALUES (?, ?, ?)')
    .run(name || `Hold ${new Date().toLocaleTimeString()}`, userId, JSON.stringify(cartData));
  return r.lastInsertRowid;
}

function getHeldOrders() {
  return getDb().prepare(`
    SELECT h.*, u.full_name as user_name FROM held_orders h
    LEFT JOIN users u ON h.user_id = u.id ORDER BY h.created_at DESC
  `).all().map(h => {
    let cart_data = [];
    try { cart_data = JSON.parse(h.cart_data); } catch { cart_data = []; }
    return { ...h, cart_data };
  });
}

function deleteHeldOrder(id) {
  getDb().prepare('DELETE FROM held_orders WHERE id = ?').run(id);
}

// ─── Returns ────────────────────────────────────────────────────────────────

function processReturn(data, actorId, actorName) {
  const db = getDb();
  try {
    db.prepare('ALTER TABLE return_items ADD COLUMN sale_item_id INTEGER').run();
  } catch (_) { /* exists */ }
  try {
    db.prepare('ALTER TABLE return_items ADD COLUMN combo_id INTEGER').run();
  } catch (_) { /* exists */ }

  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(actorId);
  const secRow = db.prepare('SELECT security_settings FROM shop_settings WHERE id = 1').get();
  let sec = {};
  try { sec = JSON.parse(secRow?.security_settings || '{}'); } catch (_) {}
  const cashierMax = sec.return_cashier_max ?? 100;
  const managerMax = sec.return_manager_max ?? 1000;

  if (user?.role === 'cashier') {
    if (!data.supervisor_code) {
      throw new Error('Supervisor code required for cashier returns');
    }
    try { features.verifySupervisorCode(data.supervisor_code, 'refund'); }
    catch { features.verifySupervisorCode(data.supervisor_code, 'void'); }
  }

  const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(data.sale_id);
  if (!sale) throw new Error('Sale not found');
  if (isVoidedStatus(sale.status)) throw new Error('Cannot return a voided sale');
  if (sale.status !== 'completed' && sale.status !== 'partial_return') {
    throw new Error('This sale is not eligible for return');
  }

  const returnItems = [];
  let totalRefund = 0;

  for (const item of data.items || []) {
    const returnQty = Number(item.quantity) || 0;
    if (returnQty <= 0) throw new Error(`Invalid return quantity for ${item.product_name || 'item'}`);

    const saleItemId = item.sale_item_id || item.id || null;
    let saleItem = null;
    if (saleItemId) {
      saleItem = db.prepare('SELECT * FROM sale_items WHERE id = ? AND sale_id = ?').get(saleItemId, data.sale_id);
      if (!saleItem) throw new Error(`Sale line not found for return item ${item.product_name || saleItemId}`);
    } else if (item.product_id) {
      saleItem = db.prepare(`
        SELECT * FROM sale_items WHERE sale_id = ? AND product_id = ? ORDER BY id LIMIT 1
      `).get(data.sale_id, item.product_id);
    } else if (item.combo_id) {
      saleItem = db.prepare(`
        SELECT * FROM sale_items WHERE sale_id = ? AND combo_id = ? ORDER BY id LIMIT 1
      `).get(data.sale_id, item.combo_id);
    }
    if (!saleItem) {
      throw new Error(`Cannot match return line: ${item.product_name || 'item'} — provide sale_item_id`);
    }

    const soldQty = Number(saleItem.quantity) || 0;
    const returnedByLine = db.prepare(`
      SELECT COALESCE(SUM(ri.quantity), 0) as qty FROM return_items ri
      JOIN returns r ON r.id = ri.return_id
      WHERE r.sale_id = ? AND r.status IN ('completed', 'reopened') AND ri.sale_item_id = ?
    `).get(data.sale_id, saleItem.id);
    let returnedQty = Number(returnedByLine?.qty) || 0;
    if (!returnedQty && saleItem.product_id) {
      const legacy = db.prepare(`
        SELECT COALESCE(SUM(ri.quantity), 0) as qty FROM return_items ri
        JOIN returns r ON r.id = ri.return_id
        WHERE r.sale_id = ? AND r.status IN ('completed', 'reopened') AND ri.sale_item_id IS NULL AND ri.product_id = ?
      `).get(data.sale_id, saleItem.product_id);
      returnedQty = Number(legacy?.qty) || 0;
    } else if (!returnedQty && saleItem.combo_id) {
      const legacyCombo = db.prepare(`
        SELECT COALESCE(SUM(ri.quantity), 0) as qty FROM return_items ri
        JOIN returns r ON r.id = ri.return_id
        WHERE r.sale_id = ? AND r.status IN ('completed', 'reopened') AND ri.sale_item_id IS NULL AND ri.combo_id = ?
      `).get(data.sale_id, saleItem.combo_id);
      returnedQty = Number(legacyCombo?.qty) || 0;
    }
    if (returnedQty + returnQty > soldQty + 0.001) {
      throw new Error(`Return quantity exceeds sold amount for ${saleItem.product_name}. Sold: ${soldQty}, already returned: ${returnedQty}`);
    }

    const unitPrice = Number(saleItem.unit_price) || 0;
    const lineGross = unitPrice * soldQty;
    // Allocate sale-level discounts so refunds never exceed what was paid
    const saleGrossAll = (db.prepare(`
      SELECT COALESCE(SUM(unit_price * quantity), 0) as g FROM sale_items WHERE sale_id = ?
    `).get(data.sale_id)?.g) || 0;
    const salePaid = Number(sale.total) || 0;
    const itemPaidTotal = saleGrossAll > 0.001
      ? (lineGross / saleGrossAll) * salePaid
      : lineGross;
    const lineRefund = Math.round((itemPaidTotal * (returnQty / soldQty)) * 100) / 100;
    totalRefund += lineRefund;
    returnItems.push({
      sale_item_id: saleItem.id,
      product_id: saleItem.product_id || null,
      combo_id: saleItem.combo_id || null,
      product_name: saleItem.product_name,
      quantity: returnQty,
      unit_price: soldQty > 0 ? Math.round((itemPaidTotal / soldQty) * 100) / 100 : unitPrice,
      total: lineRefund
    });
  }

  if (!returnItems.length) throw new Error('No items to return');

  const priorRefunds = db.prepare(`
    SELECT COALESCE(SUM(total_refund), 0) as t FROM returns
    WHERE sale_id = ? AND status IN ('completed', 'reopened')
  `).get(data.sale_id);
  const alreadyRefunded = Number(priorRefunds?.t) || 0;
  if (alreadyRefunded + totalRefund > (Number(sale.total) || 0) + 0.05) {
    throw new Error(`Refund would exceed amount paid for this sale (paid R${Number(sale.total) || 0}, already refunded R${alreadyRefunded})`);
  }

  if (user?.role === 'cashier' && totalRefund > cashierMax) {
    throw new Error(`Manager approval required for refunds over R${cashierMax}`);
  }
  const needsOwnerApproval = totalRefund > managerMax && user?.role !== 'owner';
  if (needsOwnerApproval) {
    const pin = data.owner_pin || data.approver_pin || data.supervisor_code;
    if (!pin) throw new Error(`Owner PIN required for refunds over R${managerMax}`);
    try {
      auditSvc.verifyManagerPin(pin);
    } catch {
      throw new Error(`Owner/manager PIN required for refunds over R${managerMax}`);
    }
  }

  let returnType = data.return_type || 'refund';
  if (returnType === 'exchange') returnType = 'replace';

  const txn = db.transaction(() => {
    // Re-check quantities inside the transaction to avoid concurrent over-refund
    for (const item of returnItems) {
      const soldQty = Number(db.prepare('SELECT quantity FROM sale_items WHERE id = ?').get(item.sale_item_id)?.quantity) || 0;
      const returnedByLine = db.prepare(`
        SELECT COALESCE(SUM(ri.quantity), 0) as qty FROM return_items ri
        JOIN returns r ON r.id = ri.return_id
        WHERE r.sale_id = ? AND r.status IN ('completed', 'reopened') AND ri.sale_item_id = ?
      `).get(data.sale_id, item.sale_item_id);
      if ((Number(returnedByLine?.qty) || 0) + item.quantity > soldQty + 0.001) {
        throw new Error(`Return quantity exceeds sold amount for ${item.product_name}`);
      }
    }
    const priorInTxn = db.prepare(`
      SELECT COALESCE(SUM(total_refund), 0) as t FROM returns
      WHERE sale_id = ? AND status IN ('completed', 'reopened')
    `).get(data.sale_id);
    if ((Number(priorInTxn?.t) || 0) + totalRefund > (Number(sale.total) || 0) + 0.05) {
      throw new Error('Refund would exceed amount paid for this sale');
    }

    const row = db.prepare('SELECT last_number FROM return_counter WHERE id = 1').get();
    const next = coerceCounterValue(row?.last_number) + 1;
    db.prepare('UPDATE return_counter SET last_number = ? WHERE id = 1').run(next);
    const returnNumber = `RET-${String(next).padStart(5, '0')}`;

    const r = db.prepare(`
      INSERT INTO returns (sale_id, receipt_number, user_id, return_type, reason, total_refund, return_number, approved_by, approved_by_name, return_to_stock, stock_reason, refund_method, customer_id, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed')
    `).run(data.sale_id, data.receipt_number, actorId, returnType, data.reason, totalRefund,
      returnNumber, actorId, actorName,
      data.return_to_stock !== false ? 1 : 0, data.stock_reason || null, data.refund_method || 'cash', data.customer_id || null);

    for (const item of returnItems) {
      db.prepare(`
        INSERT INTO return_items (return_id, product_id, product_name, quantity, unit_price, total, sale_item_id, combo_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(r.lastInsertRowid, item.product_id, item.product_name, item.quantity, item.unit_price, item.total,
        item.sale_item_id, item.combo_id);
      if (data.return_to_stock !== false) {
        const returnNote = `Return ${returnNumber}`;
        if (item.combo_id) {
          combosSvc.restoreComboSale(item.combo_id, item.quantity, returnNote, actorId, 'return', r.lastInsertRowid, adjustStock);
        } else if (item.product_id) {
          let selectedMods = [];
          if (item.sale_item_id) {
            const si = db.prepare('SELECT modifiers_text FROM sale_items WHERE id = ?').get(item.sale_item_id);
            if (si?.modifiers_text) {
              selectedMods = String(si.modifiers_text).split(',').map(s => ({ name: s.trim() })).filter(m => m.name);
            }
          }
          restoreProductStockAfterSale(
            item.product_id, item.quantity, returnNote, actorId, 'return', r.lastInsertRowid, selectedMods
          );
        }
      }
    }

    if (data.return_type === 'exchange' && data.exchange) {
      db.prepare(`INSERT INTO exchanges (return_id, sale_id, original_product_id, new_product_id, original_product_name, new_product_name, price_difference, notes, user_id)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(
        r.lastInsertRowid, data.sale_id, data.exchange.original_product_id || null, data.exchange.new_product_id || null,
        data.exchange.original_product_name || '', data.exchange.new_product_name || '',
        data.exchange.price_difference || 0, data.exchange.notes || data.reason, actorId);
    }

    const allSaleItems = db.prepare('SELECT id, quantity FROM sale_items WHERE sale_id = ?').all(data.sale_id);
    let fullyReturned = true;
    for (const si of allSaleItems) {
      const retQty = db.prepare(`
        SELECT COALESCE(SUM(ri.quantity), 0) as qty FROM return_items ri
        JOIN returns r ON r.id = ri.return_id
        WHERE r.sale_id = ? AND r.status IN ('completed', 'reopened') AND ri.sale_item_id = ?
      `).get(data.sale_id, si.id);
      if ((Number(retQty?.qty) || 0) < (Number(si.quantity) || 0) - 0.001) {
        fullyReturned = false;
        break;
      }
    }
    db.prepare(`UPDATE sales SET status = ? WHERE id = ?`)
      .run(fullyReturned ? 'returned' : 'partial_return', data.sale_id);

    return { id: r.lastInsertRowid, returnNumber };
  });
  const result = txn();
  const refundRatio = sale.total > 0 ? Math.min(1, totalRefund / Number(sale.total)) : 0;
  if (refundRatio > 0) {
    try { features.reverseSaleBenefits(data.sale_id, actorId, refundRatio); } catch (_) { /* best effort */ }
    try {
      marketingPlatformSvc.reverseCommissionsForSale(data.sale_id, { id: actorId, full_name: actorName, role: 'owner' }, 'Sale refunded');
    } catch (_) { /* best effort */ }
  }
  audit(actorId, actorName, 'process_return', 'return', result.id, { ...data, total_refund: totalRefund, return_number: result.returnNumber });
  features.log('info', 'return', `Return ${result.returnNumber} processed`, { refund: totalRefund });
  accHook('postFromReturn', result.id);
  return result.id;
}

function getReturns(filters = {}) {
  let sql = `
    SELECT r.*, u.full_name as user_name FROM returns r
    LEFT JOIN users u ON r.user_id = u.id WHERE 1=1
  `;
  const params = [];
  if (filters.from) { sql += ' AND date(r.created_at) >= ?'; params.push(filters.from); }
  if (filters.to) { sql += ' AND date(r.created_at) <= ?'; params.push(filters.to); }
  sql += ' ORDER BY r.created_at DESC';
  return getDb().prepare(sql).all(...params);
}

// ─── Expenses ───────────────────────────────────────────────────────────────

function ensureExpenseSettingsColumn() {
  try { getDb().prepare('SELECT expense_categories FROM shop_settings WHERE id = 1').get(); } catch (_) {
    try { getDb().exec('ALTER TABLE shop_settings ADD COLUMN expense_categories TEXT'); } catch (_2) { /* */ }
  }
}

function getExpenseCategories() {
  ensureExpenseSettingsColumn();
  const row = getDb().prepare('SELECT expense_categories FROM shop_settings WHERE id = 1').get();
  let cats = [];
  try {
    const raw = row?.expense_categories;
    cats = typeof raw === 'string' ? JSON.parse(raw) : (Array.isArray(raw) ? raw : []);
  } catch (_) { cats = []; }
  cats = [...new Set((cats || []).map((c) => String(c).trim()).filter(Boolean))];
  return cats.length ? cats : [...DEFAULT_EXPENSE_CATEGORIES];
}

function saveExpenseCategories(categories, actorId, actorName) {
  ensureExpenseSettingsColumn();
  const cats = [...new Set((categories || []).map((c) => String(c).trim()).filter(Boolean))];
  if (!cats.length) throw new Error('Add at least one expense category');
  saveSettings({ expense_categories: JSON.stringify(cats) }, actorId, actorName);
  return cats;
}

function getExpenseById(id) {
  return getDb().prepare(`
    SELECT e.*, u.full_name as user_name FROM expenses e
    LEFT JOIN users u ON e.user_id = u.id WHERE e.id = ?
  `).get(id);
}

function getExpenseDashboardStats(actor, filters = {}) {
  requireActor(actor, ['owner', 'manager', 'supervisor', 'assistant_manager', 'accountant', 'bookkeeper']);
  const analytics = require('../../lib/expense-analytics');
  const db = getDb();
  const today = new Date().toLocaleDateString('en-CA');
  const from = filters.from || (() => {
    const d = new Date();
    d.setDate(d.getDate() - 120);
    return d.toLocaleDateString('en-CA');
  })();
  const to = filters.to || today;
  let sql = `
    SELECT e.*, u.full_name AS user_name, b.name AS branch_name
    FROM expenses e
    LEFT JOIN users u ON e.user_id = u.id
    LEFT JOIN branches b ON b.id = e.branch_id
    WHERE e.expense_date >= ? AND e.expense_date <= ?`;
  const params = [from, to];
  const scope = branchesSvc.resolveBranchScope(actor || null, { branchId: filters.branch_id });
  if (!scope.allBranches && scope.branchId) {
    sql += ' AND (e.branch_id = ? OR e.branch_id IS NULL)';
    params.push(scope.branchId);
  }
  sql += ' ORDER BY e.expense_date DESC';
  const rows = db.prepare(sql).all(...params).map((r) => ({ ...r, amount: Number(r.amount) || 0 }));
  const branchNames = {};
  try {
    for (const b of branchesSvc.getBranches()) branchNames[b.id] = b.name;
  } catch (_) { /* optional */ }
  return analytics.computeExpenseDashboard(rows, branchNames);
}

function getExpenses(filters = {}) {
  let sql = 'SELECT e.*, u.full_name as user_name, b.name as branch_name FROM expenses e LEFT JOIN users u ON e.user_id = u.id LEFT JOIN branches b ON b.id = e.branch_id WHERE 1=1';
  const params = [];
  if (filters.from) { sql += ' AND e.expense_date >= ?'; params.push(filters.from); }
  if (filters.to) { sql += ' AND e.expense_date <= ?'; params.push(filters.to); }
  if (filters.category) { sql += ' AND e.category = ?'; params.push(filters.category); }
  const scope = branchesSvc.resolveBranchScope(filters.actor || null, { branchId: filters.branch_id });
  if (!scope.allBranches && scope.branchId) {
    try {
      sql += ' AND (e.branch_id = ? OR e.branch_id IS NULL)';
      params.push(scope.branchId);
    } catch (_) { /* ignore */ }
  }
  sql += ' ORDER BY e.expense_date DESC';
  const rows = getDb().prepare(sql).all(...params);
  return rows.map((r) => ({ ...r, amount: Number(r.amount) || 0 }));
}

function resolveInsertId(runResult, tableName) {
  let id = Number(runResult?.lastInsertRowid) || 0;
  const allowed = new Set(['expenses', 'supplier_payments', 'returns', 'sales', 'purchase_orders']);
  if (!id && allowed.has(tableName)) {
    const row = getDb().prepare(`SELECT id FROM ${tableName} ORDER BY id DESC LIMIT 1`).get();
    id = Number(row?.id) || 0;
  }
  return id;
}

function saveExpense(data, actorId, actorName) {
  const li = require('../../lib/expense-line-items');
  let lineItems = li.normalizeLineItems(data.line_items);
  let amount = lineItems.length ? li.lineItemsTotal(lineItems) : li.roundMoney(money(data.amount));
  if (!(amount > 0)) throw new Error('Expense amount must be greater than zero');
  if (!data.category || !String(data.category).trim()) throw new Error('Expense category is required');
  const expenseDate = data.expense_date || new Date().toLocaleDateString('en-CA');
  const description = String(data.description || data.notes || '').trim()
    || (lineItems.length ? li.lineItemsSummary(lineItems, 5) : '');
  const lineItemsJson = lineItems.length ? JSON.stringify(lineItems) : null;
  const scope = branchesSvc.resolveBranchScope({ id: actorId }, { forceTill: true, branchId: data.branch_id });
  const branchId = data.branch_id != null ? Number(data.branch_id) : scope.stampId;
  let expenseId;
  if (data.id) {
    expenseId = data.id;
    try {
      getDb().prepare('UPDATE expenses SET category=?, description=?, amount=?, expense_date=?, branch_id=?, line_items_json=? WHERE id=?')
        .run(data.category, description, amount, expenseDate, branchId, lineItemsJson, data.id);
    } catch (_) {
      try {
        getDb().prepare('UPDATE expenses SET category=?, description=?, amount=?, expense_date=?, branch_id=? WHERE id=?')
          .run(data.category, description, amount, expenseDate, branchId, data.id);
      } catch (_2) {
        getDb().prepare('UPDATE expenses SET category=?, description=?, amount=?, expense_date=? WHERE id=?')
          .run(data.category, description, amount, expenseDate, data.id);
      }
    }
    audit(actorId, actorName, 'update_expense', 'expense', data.id, data);
    accHook('postFromExpense', data.id, { repost: true });
  } else {
    let r;
    try {
      r = getDb().prepare(`
        INSERT INTO expenses (category, description, amount, user_id, expense_date, branch_id, line_items_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(data.category, description, amount, actorId, expenseDate, branchId, lineItemsJson);
    } catch (_) {
      try {
        r = getDb().prepare(`
          INSERT INTO expenses (category, description, amount, user_id, expense_date, branch_id)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(data.category, description, amount, actorId, expenseDate, branchId);
      } catch (_2) {
        r = getDb().prepare(`
          INSERT INTO expenses (category, description, amount, user_id, expense_date)
          VALUES (?, ?, ?, ?, ?)
        `).run(data.category, description, amount, actorId, expenseDate);
      }
    }
    expenseId = resolveInsertId(r, 'expenses');
    audit(actorId, actorName, 'create_expense', 'expense', expenseId, data);
    if (expenseId) accHook('postFromExpense', expenseId);
  }
  if (expenseId && data.invoice_image) {
    try {
      const ed = require('../../lib/expense-documents');
      const invoicePath = ed.saveDataUrl(expenseId, data.invoice_image);
      if (invoicePath) {
        try {
          getDb().prepare('UPDATE expenses SET invoice_path = ? WHERE id = ?').run(invoicePath, expenseId);
        } catch (_) { /* column may not exist yet */ }
      }
    } catch (_) { /* invoice optional */ }
  }
  return expenseId;
}

function deleteExpense(id, actorId, actorName) {
  accHook('postFromExpenseVoid', id);
  getDb().prepare('DELETE FROM expenses WHERE id = ?').run(id);
  audit(actorId, actorName, 'delete_expense', 'expense', id, null);
}

// ─── Customers ──────────────────────────────────────────────────────────────

function normalizePhone(phone) {
  if (!phone) return '';
  let digits = String(phone).replace(/\D/g, '');
  if (digits.startsWith('27') && digits.length >= 11) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = digits.slice(1);
  return digits.slice(-9);
}

function phonesMatch(a, b) {
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  return !!(na && nb && na.length >= 9 && na === nb);
}

function getCustomers(search) {
  const pgDb = require('../database/pg-db');
  const isPg = pgDb.isPgMode();
  let sql = 'SELECT * FROM customers WHERE 1=1';
  const params = [];
  const q = typeof search === 'string' ? search.trim() : '';
  if (q) {
    const like = `%${q}%`;
    const digits = q.replace(/\D/g, '');
    if (isPg) {
      sql += ` AND (name ILIKE ? OR phone ILIKE ? OR email ILIKE ?`;
      params.push(like, like, like);
      if (digits.length >= 2) {
        sql += ` OR regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') LIKE ?`;
        params.push(`%${digits}%`);
      }
      sql += ')';
    } else if (digits.length >= 2) {
      sql += ` AND (name LIKE ? COLLATE NOCASE OR phone LIKE ? OR email LIKE ? COLLATE NOCASE
        OR REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(phone, ''), ' ', ''), '-', ''), '+', ''), '(', '') LIKE ?)`;
      params.push(like, like, like, `%${digits}%`);
    } else {
      sql += ' AND (name LIKE ? COLLATE NOCASE OR phone LIKE ? OR email LIKE ? COLLATE NOCASE)';
      params.push(like, like, like);
    }
  }
  sql += ' ORDER BY name LIMIT 500';
  return getDb().prepare(sql).all(...params);
}

function getCustomer(id) {
  if (id == null || id === '') return null;
  return getDb().prepare('SELECT * FROM customers WHERE id = ?').get(id) || null;
}

function saveCustomer(data, actorId, actorName) {
  const dup = findDuplicateCustomer(data);
  if (dup) {
    const label = dup.field === 'phone' ? 'phone number' : dup.field === 'email' ? 'email address' : 'name';
    throw new Error(`A customer with this ${label} already exists: ${dup.customer.name}${dup.customer.phone ? ` (${dup.customer.phone})` : ''}`);
  }
  if (data.id) {
    getDb().prepare(`UPDATE customers SET name=?, phone=?, email=?, address=?, balance=?, notes=?,
      birthday=?, is_vip=?, allow_on_account=?, credit_limit=?, on_account_frozen=?, on_account_approved=?,
      on_account_period_days=?, on_account_due_date=?, updated_at=datetime('now') WHERE id=?`)
      .run(data.name, data.phone, data.email, data.address, data.balance || 0, data.notes || null,
        data.birthday || null, data.is_vip ? 1 : 0,
        data.allow_on_account ? 1 : 0, data.credit_limit != null ? data.credit_limit : null,
        data.on_account_frozen ? 1 : 0, data.on_account_approved ? 1 : 0,
        data.on_account_period_days != null ? data.on_account_period_days : null,
        data.on_account_due_date || null, data.id);
    try {
      const parts = String(data.name || '').trim().split(/\s+/);
      const first = parts[0] || data.name;
      const last = parts.slice(1).join(' ') || '';
      getDb().prepare(`UPDATE web_customers SET first_name=?, last_name=?, email=?, phone=?, updated_at=datetime('now')
        WHERE customer_id=? AND is_active=1`).run(first, last, data.email || null, data.phone || null, data.id);
    } catch (_) { /* optional */ }
    audit(actorId, actorName, 'update_customer', 'customer', data.id, { name: data.name });
    return getDb().prepare('SELECT * FROM customers WHERE id = ?').get(data.id);
  }
  const r = getDb().prepare(`INSERT INTO customers (name, phone, email, address, balance, notes, birthday, is_vip,
    allow_on_account, credit_limit, on_account_frozen, on_account_approved, on_account_period_days, on_account_due_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(data.name, data.phone, data.email, data.address, data.balance || 0, data.notes || null,
      data.birthday || null, data.is_vip ? 1 : 0,
      data.allow_on_account ? 1 : 0, data.credit_limit != null ? data.credit_limit : null,
      data.on_account_frozen ? 1 : 0, data.on_account_approved ? 1 : 0,
      data.on_account_period_days != null ? data.on_account_period_days : null,
      data.on_account_due_date || null);
  audit(actorId, actorName, 'create_customer', 'customer', r.lastInsertRowid, { name: data.name });
  return getDb().prepare('SELECT * FROM customers WHERE id = ?').get(r.lastInsertRowid);
}

function findDuplicateCustomer(data) {
  const db = getDb();
  const excludeId = data.id || 0;
  if (data.phone && data.phone.trim()) {
    const withPhone = db.prepare('SELECT * FROM customers WHERE phone IS NOT NULL AND TRIM(phone) != \'\' AND id != ?').all(excludeId);
    for (const c of withPhone) {
      if (phonesMatch(data.phone, c.phone)) return { field: 'phone', customer: c };
    }
  }
  if (data.email && data.email.trim()) {
    const byEmail = db.prepare('SELECT * FROM customers WHERE LOWER(email) = LOWER(?) AND id != ?').get(data.email.trim(), excludeId);
    if (byEmail) return { field: 'email', customer: byEmail };
  }
  return null;
}

function deleteCustomer(id, actorId, actorName) {
  const db = getDb();
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
  if (!customer) throw new Error('Customer not found');

  const run = () => {
    db.prepare('UPDATE sales SET customer_id = NULL WHERE customer_id = ?').run(id);
    for (const sql of [
      'UPDATE quotes SET customer_id = NULL WHERE customer_id = ?',
      'UPDATE online_orders_local SET customer_id = NULL WHERE customer_id = ?',
      'UPDATE gift_cards SET customer_id = NULL WHERE customer_id = ?',
      'UPDATE held_orders SET customer_id = NULL WHERE customer_id = ?',
      'UPDATE returns SET customer_id = NULL WHERE customer_id = ?'
    ]) {
      try { db.prepare(sql).run(id); } catch (_) { /* table may not exist */ }
    }
    try {
      const laybyIds = db.prepare('SELECT id FROM laybyes WHERE customer_id = ?').all(id).map((r) => r.id);
      for (const lid of laybyIds) {
        db.prepare('DELETE FROM layby_payments WHERE layby_id = ?').run(lid);
        db.prepare('DELETE FROM layby_items WHERE layby_id = ?').run(lid);
      }
      db.prepare('DELETE FROM laybyes WHERE customer_id = ?').run(id);
    } catch (_) { /* optional */ }
    for (const sql of [
      'DELETE FROM customer_reward_grants WHERE customer_id = ?',
      'DELETE FROM web_registration_codes WHERE customer_id = ?'
    ]) {
      try { db.prepare(sql).run(id); } catch (_) { /* optional */ }
    }
    try {
      db.prepare(`UPDATE web_customers SET is_active = 0, customer_id = NULL, updated_at = datetime('now') WHERE customer_id = ?`).run(id);
    } catch (_) { /* optional */ }
    db.prepare('DELETE FROM customer_credit_ledger WHERE customer_id = ?').run(id);
    db.prepare('DELETE FROM loyalty_transactions WHERE customer_id = ?').run(id);
    db.prepare('DELETE FROM customers WHERE id = ?').run(id);
  };

  if (typeof db.transaction === 'function') {
    db.transaction(run)();
  } else {
    run();
  }

  audit(actorId, actorName, 'delete_customer', 'customer', id, {
    name: customer.name,
    balance: customer.balance,
    loyalty_points: customer.loyalty_points
  });
  return { success: true };
}

function getCustomerHistory(customerId) {
  return getDb().prepare(`
    SELECT s.* FROM sales s WHERE s.customer_id = ? ORDER BY s.created_at DESC LIMIT 50
  `).all(customerId);
}

// ─── Suppliers ──────────────────────────────────────────────────────────────

function getSuppliers(search) {
  let sql = 'SELECT * FROM suppliers WHERE 1=1';
  const params = [];
  if (search) { sql += ' AND (name LIKE ? OR phone LIKE ?)'; const q = `%${search}%`; params.push(q, q); }
  sql += ' ORDER BY name';
  return getDb().prepare(sql).all(...params);
}

function ensureSupplierSchema() {
  const db = getDb();
  for (const sql of [
    'ALTER TABLE suppliers ADD COLUMN bank_name TEXT',
    'ALTER TABLE suppliers ADD COLUMN bank_account_name TEXT',
    'ALTER TABLE suppliers ADD COLUMN bank_account_number TEXT',
    'ALTER TABLE suppliers ADD COLUMN bank_branch_code TEXT'
  ]) {
    try { db.exec(sql); } catch (_) { /* exists */ }
  }
}

function saveSupplier(data, actorId, actorName) {
  ensureSupplierSchema();
  if (data.id) {
    getDb().prepare(`UPDATE suppliers SET name=?, phone=?, email=?, address=?, balance_owed=?, notes=?,
      bank_name=?, bank_account_name=?, bank_account_number=?, bank_branch_code=?, updated_at=datetime('now') WHERE id=?`)
      .run(
        data.name, data.phone, data.email, data.address, data.balance_owed || 0, data.notes || null,
        data.bank_name || null, data.bank_account_name || null, data.bank_account_number || null, data.bank_branch_code || null,
        data.id
      );
    audit(actorId, actorName, 'update_supplier', 'supplier', data.id, { name: data.name });
    return data.id;
  }
  const r = getDb().prepare(`
    INSERT INTO suppliers (name, phone, email, address, balance_owed, notes, bank_name, bank_account_name, bank_account_number, bank_branch_code)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.name, data.phone, data.email, data.address, data.balance_owed || 0, data.notes || null,
    data.bank_name || null, data.bank_account_name || null, data.bank_account_number || null, data.bank_branch_code || null
  );
  audit(actorId, actorName, 'create_supplier', 'supplier', r.lastInsertRowid, { name: data.name });
  return r.lastInsertRowid;
}

function recordSupplierPayment(supplierId, data, actorId, actorName) {
  ensureSupplierSchema();
  const db = getDb();
  const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(supplierId);
  if (!supplier) throw new Error('Supplier not found');
  const amount = Number(data.amount) || 0;
  if (amount <= 0) throw new Error('Payment amount must be greater than zero');
  const paymentNumber = `SPY-${Date.now().toString(36).toUpperCase()}`;
  const newBalance = Math.max(0, (supplier.balance_owed || 0) - amount);
  const ins = db.prepare('INSERT INTO supplier_payments (supplier_id, payment_number, amount, payment_method, notes, user_id) VALUES (?,?,?,?,?,?)')
    .run(supplierId, paymentNumber, amount, data.payment_method || 'cash', data.notes || null, actorId);
  const paymentId = resolveInsertId(ins, 'supplier_payments');
  db.prepare('UPDATE suppliers SET balance_owed = ?, updated_at = datetime(\'now\') WHERE id = ?').run(newBalance, supplierId);
  audit(actorId, actorName, 'supplier_payment', 'supplier', supplierId, { amount, payment_number: paymentNumber, balance_after: newBalance });
  accHook('postFromSupplierPayment', paymentId);
  return {
    id: paymentId,
    payment_number: paymentNumber,
    amount,
    balance_before: supplier.balance_owed || 0,
    balance_after: newBalance,
    supplier_name: supplier.name,
    supplier_phone: supplier.phone,
    supplier_email: supplier.email,
    supplier_address: supplier.address,
    bank_name: supplier.bank_name,
    bank_account_name: supplier.bank_account_name,
    bank_account_number: supplier.bank_account_number,
    bank_branch_code: supplier.bank_branch_code,
    payment_method: data.payment_method || 'cash',
    notes: data.notes || null,
    created_at: new Date().toISOString()
  };
}

function getSupplierPayments(supplierId) {
  return getDb().prepare(`
    SELECT sp.*, u.full_name as user_name, s.name as supplier_name
    FROM supplier_payments sp
    LEFT JOIN users u ON sp.user_id = u.id
    LEFT JOIN suppliers s ON sp.supplier_id = s.id
    WHERE sp.supplier_id = ?
    ORDER BY sp.created_at DESC
  `).all(supplierId);
}

// ─── Purchase Orders ────────────────────────────────────────────────────────

function getPurchaseOrders() {
  return getDb().prepare(`
    SELECT po.*, s.name as supplier_name, u.full_name as user_name
    FROM purchase_orders po
    LEFT JOIN suppliers s ON po.supplier_id = s.id
    LEFT JOIN users u ON po.user_id = u.id
    ORDER BY po.created_at DESC
  `).all();
}

function getPurchaseOrder(id) {
  const po = getDb().prepare(`
    SELECT po.*, s.name as supplier_name FROM purchase_orders po
    LEFT JOIN suppliers s ON po.supplier_id = s.id WHERE po.id = ?
  `).get(id);
  if (!po) return null;
  const items = getDb().prepare('SELECT * FROM purchase_order_items WHERE purchase_order_id = ?').all(id);
  return { ...po, items };
}

function calcPurchaseLineTax(qty, buyingPrice, taxRate, taxEnabled, inclusive) {
  const line = Math.round((Number(qty) || 0) * (Number(buyingPrice) || 0) * 100) / 100;
  if (!taxEnabled || !(Number(taxRate) > 0)) {
    return { lineExcl: line, tax: 0, lineTotal: line };
  }
  const rate = Number(taxRate) || 0;
  if (inclusive) {
    const tax = Math.round((line - line / (1 + rate / 100)) * 100) / 100;
    return { lineExcl: Math.round((line - tax) * 100) / 100, tax, lineTotal: line };
  }
  const tax = Math.round(line * rate / 100 * 100) / 100;
  return { lineExcl: line, tax, lineTotal: Math.round((line + tax) * 100) / 100 };
}

function savePurchaseOrder(data, actorId, actorName) {
  const db = getDb();
  const poNumber = nextPONumber();
  const settings = getSettings() || {};
  const taxEnabled = !!(settings.tax_enabled || data.tax_enabled);
  const taxRate = taxEnabled ? (Number(data.tax_rate != null ? data.tax_rate : settings.tax_rate) || 0) : 0;
  const inclusive = data.tax_inclusive != null
    ? !!(data.tax_inclusive)
    : (settings.tax_inclusive !== false && settings.tax_inclusive !== 0 && settings.tax_inclusive !== '0');
  const txn = db.transaction(() => {
    let subtotal = 0;
    let taxAmount = 0;
    let total = 0;
    const pricedItems = (data.items || []).map((item) => {
      const br = calcPurchaseLineTax(item.quantity, item.buying_price, taxRate, taxEnabled, inclusive);
      subtotal += br.lineExcl;
      taxAmount += br.tax;
      total += br.lineTotal;
      return { ...item, total: br.lineTotal, tax_amount: br.tax };
    });
    subtotal = Math.round(subtotal * 100) / 100;
    taxAmount = Math.round(taxAmount * 100) / 100;
    total = Math.round(total * 100) / 100;

    let r;
    try {
      r = db.prepare(`
        INSERT INTO purchase_orders (po_number, supplier_id, user_id, total, status, receiving_date, notes, subtotal, tax_amount, tax_rate)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(poNumber, data.supplier_id, actorId, total, data.status || 'pending', data.receiving_date, data.notes, subtotal, taxAmount, taxRate);
    } catch (_) {
      r = db.prepare(`
        INSERT INTO purchase_orders (po_number, supplier_id, user_id, total, status, receiving_date, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(poNumber, data.supplier_id, actorId, total, data.status || 'pending', data.receiving_date, data.notes);
    }

    for (const item of pricedItems) {
      try {
        db.prepare(`
          INSERT INTO purchase_order_items (purchase_order_id, product_id, product_name, quantity, buying_price, total, tax_amount)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(r.lastInsertRowid, item.product_id, item.product_name, item.quantity, item.buying_price, item.total, item.tax_amount || 0);
      } catch (_) {
        db.prepare(`
          INSERT INTO purchase_order_items (purchase_order_id, product_id, product_name, quantity, buying_price, total)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(r.lastInsertRowid, item.product_id, item.product_name, item.quantity, item.buying_price, item.total);
      }

      if (data.status === 'received' && item.product_id) {
        adjustStock(item.product_id, item.quantity, 'purchase', `PO ${poNumber}`, actorId, 'purchase_order', r.lastInsertRowid);
        db.prepare('UPDATE products SET buying_price = ? WHERE id = ?').run(item.buying_price, item.product_id);
      }
    }
    return { id: r.lastInsertRowid, po_number: poNumber, subtotal, tax_amount: taxAmount, total };
  });
  const result = txn();
  audit(actorId, actorName, 'create_purchase_order', 'purchase_order', result.id, { po_number: result.po_number });
  return result;
}

function receivePurchaseOrder(id, actorId, actorName) {
  const db = getDb();
  const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(id);
  if (!po) throw new Error('Purchase order not found');
  if (po.status === 'received') throw new Error('Purchase order has already been received');
  const items = db.prepare('SELECT * FROM purchase_order_items WHERE purchase_order_id = ?').all(id);
  db.transaction(() => {
    for (const item of items) {
      const remaining = Math.max(0, (Number(item.quantity) || 0) - (Number(item.received_qty) || 0));
      if (item.product_id && remaining > 0) {
        adjustStock(item.product_id, remaining, 'purchase', `PO ${po.po_number}`, actorId, 'purchase_order', id);
        db.prepare('UPDATE products SET buying_price = ? WHERE id = ?').run(item.buying_price, item.product_id);
      }
      db.prepare('UPDATE purchase_order_items SET received_qty = quantity WHERE id = ?').run(item.id);
    }
    db.prepare("UPDATE purchase_orders SET status = 'received', receiving_date = date('now') WHERE id = ?").run(id);
  })();
  audit(actorId, actorName, 'receive_purchase_order', 'purchase_order', id, null);
  accHook('postFromPurchaseReceive', id);
}

// ─── Dashboard & Reports ────────────────────────────────────────────────────

function getDashboardStats(from, to, branchId) {
  const db = getDb();
  const flags = branchesSvc.ensureBranchSchema();
  const rangeFrom = from || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  const rangeTo = to || new Date().toLocaleDateString('en-CA');
  const canScopeSales = !!(branchId && flags.sales);
  const canScopeExpenses = !!(branchId && flags.expenses);
  const branchSql = canScopeSales ? ' AND branch_id = ?' : '';
  const branchParams = canScopeSales ? [branchId] : [];
  const soft = (fn, fallback) => {
    try { return fn(); }
    catch (err) {
      console.warn('[dashboard-stats]', err.message || err);
      return fallback;
    }
  };

  const salesInRange = soft(() => db.prepare(`
    SELECT COALESCE(SUM(total),0) as total, COUNT(*) as count FROM sales
    WHERE date(created_at, 'localtime') BETWEEN ? AND ? AND status IN ('completed','partial_return')${branchSql}
  `).get(rangeFrom, rangeTo, ...branchParams), { total: 0, count: 0 });

  const refundsInRange = soft(() => db.prepare(`
    SELECT COALESCE(SUM(r.total_refund),0) as total FROM returns r
    LEFT JOIN sales s ON s.id = r.sale_id
    WHERE date(r.created_at, 'localtime') BETWEEN ? AND ? AND r.status IN ('completed','reopened')
    ${canScopeSales ? ' AND s.branch_id = ?' : ''}
  `).get(...(canScopeSales ? [rangeFrom, rangeTo, branchId] : [rangeFrom, rangeTo])), { total: 0 });

  const expensesInRange = soft(() => db.prepare(`
    SELECT COALESCE(SUM(amount),0) as total FROM expenses WHERE expense_date BETWEEN ? AND ?
    ${canScopeExpenses ? ' AND branch_id = ?' : ''}
  `).get(...(canScopeExpenses ? [rangeFrom, rangeTo, branchId] : [rangeFrom, rangeTo])), { total: 0 });

  const profitData = soft(() => db.prepare(`
    SELECT COALESCE(SUM(line_profit), 0) as profit FROM (
      SELECT s.id,
        (SELECT COALESCE(SUM(si.total - si.buying_price * si.quantity), 0) FROM sale_items si WHERE si.sale_id = s.id)
        - COALESCE((SELECT SUM(r.total_refund) FROM returns r WHERE r.sale_id = s.id AND r.status IN ('completed','reopened')), 0) as line_profit
      FROM sales s
      WHERE date(s.created_at, 'localtime') BETWEEN ? AND ? AND s.status IN ('completed','partial_return')${branchSql.replace('branch_id', 's.branch_id')}
    )
  `).get(rangeFrom, rangeTo, ...branchParams), { profit: 0 });

  const lowStock = soft(() => db.prepare('SELECT COUNT(*) as count FROM products WHERE is_active=1 AND stock_quantity <= min_stock').get(), { count: 0 });
  const salesBranchSql = canScopeSales ? ' AND s.branch_id = ?' : '';
  const salesOnlyBranchSql = canScopeSales ? ' AND branch_id = ?' : '';

  const bestSeller = soft(() => db.prepare(`
    SELECT si.product_name, SUM(si.quantity) as qty FROM sale_items si
    JOIN sales s ON si.sale_id = s.id
    WHERE date(s.created_at, 'localtime') BETWEEN ? AND ? AND s.status IN ('completed','partial_return')${salesBranchSql}
    GROUP BY si.product_name ORDER BY qty DESC LIMIT 1
  `).get(rangeFrom, rangeTo, ...branchParams), null);

  const salesGraph = soft(() => db.prepare(`
    SELECT date(created_at, 'localtime') as day, SUM(total) as total FROM sales
    WHERE date(created_at, 'localtime') BETWEEN ? AND ? AND status IN ('completed','partial_return')${salesOnlyBranchSql}
    GROUP BY date(created_at, 'localtime') ORDER BY day
  `).all(rangeFrom, rangeTo, ...branchParams), []);

  const paymentBreakdown = soft(() => db.prepare(`
    SELECT sp.payment_type, SUM(sp.amount) as total FROM sale_payments sp
    JOIN sales s ON sp.sale_id = s.id
    WHERE date(s.created_at, 'localtime') BETWEEN ? AND ? AND s.status IN ('completed','partial_return')${salesBranchSql}
    GROUP BY sp.payment_type
  `).all(rangeFrom, rangeTo, ...branchParams), []);

  const netSales = money((salesInRange.total || 0) - (refundsInRange.total || 0));

  return {
    from: rangeFrom, to: rangeTo,
    todaySales: netSales,
    todayCount: salesInRange.count,
    monthlyExpenses: expensesInRange.total,
    profit: money((profitData.profit || 0) - expensesInRange.total),
    lowStockCount: lowStock.count,
    bestSeller: bestSeller?.product_name || '—',
    bestSellerQty: bestSeller?.qty || 0,
    productsSoldToday: salesInRange.count,
    salesGraph,
    paymentBreakdown
  };
}

function getInventoryStats(branchId) {
  const db = getDb();
  const branchesSvc = require('./branches');
  const flags = branchesSvc.ensureBranchSchema();
  const useBranch = branchId != null && branchId !== '' && branchId !== 'all' && flags.branch_stock;

  let totalValue = { val: 0 };
  let lowStock = { c: 0 };
  let outOfStock = { c: 0 };
  let lowStockItems = [];
  let outOfStockItems = [];

  if (useBranch) {
    totalValue = db.prepare(`
      SELECT COALESCE(SUM(bs.quantity * COALESCE(p.buying_price, 0)), 0) AS val
      FROM branch_stock bs JOIN products p ON p.id = bs.product_id
      WHERE bs.branch_id = ? AND p.is_active = 1
    `).get(Number(branchId)) || { val: 0 };
    lowStock = db.prepare(`
      SELECT COUNT(*) AS c FROM branch_stock bs JOIN products p ON p.id = bs.product_id
      WHERE bs.branch_id = ? AND p.is_active = 1 AND bs.quantity <= bs.min_stock AND bs.quantity > 0
    `).get(Number(branchId)) || { c: 0 };
    outOfStock = db.prepare(`
      SELECT COUNT(*) AS c FROM branch_stock bs JOIN products p ON p.id = bs.product_id
      WHERE bs.branch_id = ? AND p.is_active = 1 AND bs.quantity <= 0
    `).get(Number(branchId)) || { c: 0 };
    lowStockItems = db.prepare(`
      SELECT p.name, bs.quantity AS stock_quantity, bs.min_stock AS min_stock
      FROM branch_stock bs JOIN products p ON p.id = bs.product_id
      WHERE bs.branch_id = ? AND p.is_active = 1 AND bs.quantity <= bs.min_stock AND bs.quantity > 0
      ORDER BY bs.quantity ASC LIMIT 15
    `).all(Number(branchId));
    outOfStockItems = db.prepare(`
      SELECT p.name, bs.quantity AS stock_quantity
      FROM branch_stock bs JOIN products p ON p.id = bs.product_id
      WHERE bs.branch_id = ? AND p.is_active = 1 AND bs.quantity <= 0
      ORDER BY p.name LIMIT 15
    `).all(Number(branchId));
  } else {
    totalValue = db.prepare(`
      SELECT COALESCE(SUM(stock_quantity * COALESCE(buying_price, 0)), 0) AS val FROM products WHERE is_active = 1
    `).get() || { val: 0 };
    lowStock = db.prepare(`
      SELECT COUNT(*) AS c FROM products WHERE is_active = 1 AND stock_quantity <= min_stock AND stock_quantity > 0
    `).get() || { c: 0 };
    outOfStock = db.prepare(`
      SELECT COUNT(*) AS c FROM products WHERE is_active = 1 AND stock_quantity <= 0
    `).get() || { c: 0 };
    lowStockItems = db.prepare(`
      SELECT name, stock_quantity, min_stock FROM products
      WHERE is_active = 1 AND stock_quantity <= min_stock AND stock_quantity > 0
      ORDER BY stock_quantity ASC LIMIT 15
    `).all();
    outOfStockItems = db.prepare(`
      SELECT name, stock_quantity FROM products WHERE is_active = 1 AND stock_quantity <= 0 ORDER BY name LIMIT 15
    `).all();
  }

  const fastMoving = db.prepare(`
    SELECT si.product_name, SUM(si.quantity) AS qty FROM sale_items si
    JOIN sales s ON si.sale_id = s.id WHERE date(s.created_at) >= date('now', '-30 days') AND s.status = 'completed'
    GROUP BY si.product_name ORDER BY qty DESC LIMIT 5
  `).all();
  const slowMoving = db.prepare(`
    SELECT p.name, p.stock_quantity FROM products p WHERE p.is_active = 1
    AND p.id NOT IN (
      SELECT DISTINCT si.product_id FROM sale_items si
      JOIN sales s ON s.id = si.sale_id WHERE s.status = 'completed' AND date(s.created_at) >= date('now', '-30 days')
    )
    ORDER BY p.stock_quantity DESC LIMIT 5
  `).all();

  return {
    totalValue: totalValue.val,
    lowStock: lowStock.c,
    outOfStock: outOfStock.c,
    lowStockItems,
    outOfStockItems,
    fastMoving,
    slowMoving
  };
}

function getSalesAnalytics(from, to) {
  const db = getDb();
  const rangeFrom = from || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  const rangeTo = to || new Date().toLocaleDateString('en-CA');
  return {
    byHour: db.prepare(`
      SELECT strftime('%H', created_at) as hour, SUM(total) as total, COUNT(*) as count
      FROM sales WHERE date(created_at) BETWEEN ? AND ? AND status='completed'
      GROUP BY hour ORDER BY hour
    `).all(rangeFrom, rangeTo),
    byProduct: db.prepare(`
      SELECT si.product_name, SUM(si.quantity) as qty, SUM(si.total) as revenue,
        SUM(si.total - si.buying_price * si.quantity) as profit
      FROM sale_items si JOIN sales s ON si.sale_id = s.id
      WHERE date(s.created_at) BETWEEN ? AND ? AND s.status='completed'
      GROUP BY si.product_name ORDER BY revenue DESC LIMIT 20
    `).all(rangeFrom, rangeTo),
    byCategory: db.prepare(`
      SELECT c.name as category, SUM(si.total) as revenue FROM sale_items si
      JOIN sales s ON si.sale_id = s.id
      LEFT JOIN products p ON si.product_id = p.id
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE date(s.created_at) BETWEEN ? AND ? AND s.status='completed'
      GROUP BY c.name ORDER BY revenue DESC
    `).all(rangeFrom, rangeTo)
  };
}

function normalizeTargetPeriod(raw, defaultActive) {
  if (raw != null && typeof raw === 'object' && !Array.isArray(raw)) {
    return {
      amount: Number(raw.amount) || 0,
      active: raw.active !== false,
      expires_at: raw.expires_at || null
    };
  }
  const amount = Number(raw) || 0;
  return {
    amount,
    active: defaultActive != null ? !!defaultActive : amount > 0,
    expires_at: null
  };
}

function normalizeSalesTargets(raw) {
  const src = raw || {};
  return {
    daily: normalizeTargetPeriod(src.daily, src.daily?.active !== false),
    weekly: normalizeTargetPeriod(src.weekly, false),
    monthly: normalizeTargetPeriod(src.monthly, false),
    yearly: normalizeTargetPeriod(src.yearly, false)
  };
}

function isTargetPeriodActive(period) {
  if (!period || !period.active) return false;
  if (!(Number(period.amount) > 0)) return false;
  if (period.expires_at) {
    const today = new Date().toLocaleDateString('en-CA');
    if (String(period.expires_at).slice(0, 10) < today) return false;
  }
  return true;
}

function getActiveDailyTargetAmount(targets) {
  const norm = normalizeSalesTargets(targets);
  return isTargetPeriodActive(norm.daily) ? norm.daily.amount : 0;
}

function getActiveSalesTargets(targets) {
  const norm = normalizeSalesTargets(targets);
  const out = [];
  for (const key of ['daily', 'weekly', 'monthly', 'yearly']) {
    const p = norm[key];
    if (isTargetPeriodActive(p)) {
      out.push({ period: key, amount: p.amount, expires_at: p.expires_at || null });
    }
  }
  return out;
}

function getSalesTargets() {
  const row = getDb().prepare('SELECT sales_targets FROM shop_settings WHERE id = 1').get();
  return normalizeSalesTargets(parseJsonField(row?.sales_targets, {}));
}

function saveSalesTargets(targets, actorId, actorName) {
  requireActor({ id: actorId }, ['owner', 'manager']);
  const data = normalizeSalesTargets(targets);
  for (const period of ['daily', 'weekly', 'monthly', 'yearly']) {
    if (targets[period] != null) {
      data[period] = normalizeTargetPeriod(targets[period], period === 'daily');
    }
  }
  saveSettings({ sales_targets: JSON.stringify(data) }, actorId, actorName);
  return data;
}

const DEFAULT_SHIFT_REQUIRED_ROLES = ['cashier', 'manager', 'assistant_manager', 'owner'];
const SHIFT_ROLE_OPTIONS = ['owner', 'manager', 'assistant_manager', 'cashier'];

function normalizeShiftSettings(raw) {
  const src = raw || {};
  let roles = src.required_roles;
  if (!Array.isArray(roles) || !roles.length) {
    roles = [...DEFAULT_SHIFT_REQUIRED_ROLES];
  }
  const penalty = Number(src.cashout_late_penalty);
  return {
    required_roles: roles.filter(r => SHIFT_ROLE_OPTIONS.includes(r)),
    cashout_deadline_time: String(src.cashout_deadline_time || '22:00').slice(0, 5),
    cashout_late_penalty: Number.isFinite(penalty) && penalty >= 0 ? penalty : 0,
    cashout_deadline_enabled: src.cashout_deadline_enabled !== false && src.cashout_deadline_enabled !== 0
  };
}

function getShiftSettings() {
  const row = getDb().prepare('SELECT shift_settings FROM shop_settings WHERE id = 1').get();
  return normalizeShiftSettings(parseJsonField(row?.shift_settings, {}));
}

function saveShiftSettings(data, actorId, actorName) {
  requireActor({ id: actorId }, ['owner', 'manager']);
  const merged = normalizeShiftSettings({ ...getShiftSettings(), ...data });
  saveSettings({ shift_settings: JSON.stringify(merged) }, actorId, actorName);
  return merged;
}

function roleRequiresShift(role, settings) {
  const s = settings || getShiftSettings();
  return (s.required_roles || DEFAULT_SHIFT_REQUIRED_ROLES).includes(role);
}

function isAdminExemptFromCashoutPenalty(role) {
  return ['owner', 'manager'].includes(role);
}

function enforceShiftCashoutDeadlines() {
  const settings = getShiftSettings();
  if (!settings.cashout_deadline_enabled) return { closed: 0 };
  const deadline = settings.cashout_deadline_time || '22:00';
  const penaltyAmt = Number(settings.cashout_late_penalty) || 0;
  const now = new Date();
  const todayStr = now.toLocaleDateString('en-CA');
  const [hh, mm] = deadline.split(':').map(Number);
  const deadlineDate = new Date(`${todayStr}T${String(hh || 0).padStart(2, '0')}:${String(mm || 0).padStart(2, '0')}:00`);
  if (Number.isNaN(deadlineDate.getTime()) || now < deadlineDate) return { closed: 0 };

  const db = getDb();
  const openShifts = db.prepare(`
    SELECT sh.*, u.role, u.full_name, u.username, e.id AS employee_id
    FROM shifts sh
    JOIN users u ON u.id = sh.user_id
    LEFT JOIN employees e ON e.user_id = u.id AND e.status = 'Active'
    WHERE sh.status = 'open'
  `).all();
  let closed = 0;
  for (const sh of openShifts) {
    const openedDay = String(sh.opened_at || '').slice(0, 10);
    // Only auto-close shifts opened today (or earlier still open after today's deadline)
    if (openedDay > todayStr) continue;
    const exempt = isAdminExemptFromCashoutPenalty(sh.role);
    try {
      closeShift(sh.id, {
        cash_counted: null,
        notes: exempt
          ? `[Auto-closed at cash-out deadline ${deadline} — admin exempt, no charge]`
          : `[Auto-closed at cash-out deadline ${deadline} — late cash-out penalty may apply]`,
        actual_payments: {},
        auto_closed: true
      }, sh.user_id);
      closed += 1;
      if (!exempt && penaltyAmt > 0 && sh.employee_id) {
        db.prepare(`
          INSERT INTO cashout_penalties (user_id, employee_id, shift_id, work_date, amount, reason, status, created_by_name)
          VALUES (?,?,?,?,?,?, 'pending', ?)`).run(
          sh.user_id, sh.employee_id, sh.id, todayStr, penaltyAmt,
          `Missed POS cash-out by ${deadline}`,
          'system'
        );
        try {
          addNotification('cashout_penalty', 'Late cash-out penalty',
            `${sh.full_name || sh.username}: R${penaltyAmt.toFixed(2)} will be deducted on next payroll (missed cash-out by ${deadline}).`, {
              entity_type: 'cashout_penalty',
              entity_id: sh.employee_id,
              action_page: 'staffhr:payroll',
              audience_roles: ['owner', 'manager']
            });
        } catch (_) { /* ignore */ }
      } else if (exempt) {
        try {
          addNotification('cashout', 'Admin shift auto-closed',
            `${sh.full_name || 'Admin'} shift auto-closed at ${deadline} (no charge).`, {
              action_page: 'operations:cashup',
              audience_roles: ['owner', 'manager']
            });
        } catch (_) { /* ignore */ }
      }
    } catch (err) {
      console.error('[enforceShiftCashoutDeadlines]', sh.id, err.message);
    }
  }
  return { closed };
}

function getShiftClosePreview(shiftId, userId) {
  const db = getDb();
  const shift = db.prepare('SELECT * FROM shifts WHERE id = ? AND status = \'open\'').get(shiftId);
  if (!shift) throw new Error('Shift not found or already closed');

  const sales = db.prepare(`
    SELECT COALESCE(SUM(s.total),0) as total, COUNT(*) as count FROM sales s
    WHERE s.user_id = ? AND s.created_at >= ? AND s.status IN ('completed', 'partial_return', 'returned')
  `).get(userId, shift.opened_at);

  const refunds = db.prepare(`
    SELECT COALESCE(SUM(r.total_refund),0) as total FROM returns r
    JOIN sales s ON s.id = r.sale_id
    WHERE s.user_id = ? AND s.created_at >= ? AND r.status IN ('completed', 'reopened')
  `).get(userId, shift.opened_at);

  const payments = db.prepare(`
    SELECT sp.payment_type, SUM(sp.amount) as total FROM sale_payments sp
    JOIN sales s ON sp.sale_id = s.id
    WHERE s.user_id = ? AND s.created_at >= ? AND s.status IN ('completed', 'partial_return', 'returned')
    GROUP BY sp.payment_type
  `).all(userId, shift.opened_at);

  const paymentMap = {};
  for (const p of payments) paymentMap[p.payment_type] = p.total || 0;

  const refundTotal = Number(refunds?.total) || 0;
  const cash = paymentMap.cash || 0;
  let cashDropsTotal = 0;
  let cashDrops = [];
  try {
    cashDrops = db.prepare(`
      SELECT * FROM cash_drops WHERE shift_id = ? ORDER BY id
    `).all(shiftId);
    cashDropsTotal = cashDrops.reduce((s, d) => s + (Number(d.amount) || 0), 0);
  } catch (_) { /* table may be missing before v59 */ }
  const expectedCash = (shift.opening_float || 0) + cash - refundTotal - cashDropsTotal;
  const targets = getSalesTargets();
  const today = new Date().toLocaleDateString('en-CA');
  const todaySales = db.prepare(`
    SELECT COALESCE(SUM(total),0) as total FROM sales
    WHERE date(created_at, 'localtime') = date(?) AND status IN ('completed', 'partial_return', 'returned')
  `).get(today).total;

  const dailyTarget = getActiveDailyTargetAmount(targets);
  const netSales = Math.max(0, (Number(sales.total) || 0) - refundTotal);
  const targetRemaining = Math.max(0, dailyTarget - todaySales);
  const targetMet = dailyTarget > 0 && todaySales >= dailyTarget ? 1 : 0;

  const methods = ['cash', 'card', 'eft', 'mobile', 'account', 'giftcard', 'other'];
  const expectedPayments = {};
  for (const m of methods) expectedPayments[m] = paymentMap[m] || 0;

  return {
    shift,
    totalSales: netSales,
    saleCount: sales.count,
    expectedPayments,
    expectedCash,
    refunds: refundTotal,
    cashDropsTotal,
    cashDrops,
    openingFloat: shift.opening_float || 0,
    dailyTarget,
    todaySales,
    shiftSales: netSales,
    targetRemaining,
    targetMet
  };
}

function saveCashDropProofImage(imageData, dropId) {
  const fs = require('fs');
  const path = require('path');
  const { getDbPathForBackup } = require('../database/db');
  if (!imageData) return null;
  const dir = path.join(path.dirname(getDbPathForBackup()), 'assets', 'cash-drops');
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
  const file = path.join(dir, `drop-${dropId || 'new'}-${Date.now()}${ext}`);
  fs.writeFileSync(file, Buffer.from(raw, 'base64'));
  return file;
}

function recordCashDrop(data, actor) {
  const user = assertUserActor(actor, ['owner', 'manager', 'cashier', 'supervisor', 'assistant_manager']);
  const amount = Number(data?.amount);
  if (!(amount > 0)) throw new Error('Enter a valid amount to send to admin');
  const db = getDb();
  const shift = data?.shift_id
    ? db.prepare(`SELECT * FROM shifts WHERE id = ? AND status = 'open'`).get(data.shift_id)
    : db.prepare(`SELECT * FROM shifts WHERE user_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1`).get(user.id);
  if (!shift) throw new Error('Open a shift first before sending cash to admin');
  const r = db.prepare(`
    INSERT INTO cash_drops (shift_id, user_id, user_name, amount, proof_path, notes, status)
    VALUES (?,?,?,?,?,?, 'pending')
  `).run(
    shift.id, user.id, user.full_name || user.username,
    amount, null, data?.notes || null
  );
  const dropId = r.lastInsertRowid;
  let proofPath = data?.proof_path || null;
  if (data?.proof_image) {
    proofPath = saveCashDropProofImage(data.proof_image, dropId) || proofPath;
  }
  if (proofPath) {
    db.prepare('UPDATE cash_drops SET proof_path = ? WHERE id = ?').run(proofPath, dropId);
  }
  addNotification('cashup', 'Cash sent to admin',
    `${user.full_name || user.username} sent ${amount.toFixed(2)} to admin/safe (shift #${shift.id}).`);
  audit(user.id, user.username, 'cash_drop', 'cash_drop', dropId, { amount, shift_id: shift.id });
  return db.prepare('SELECT * FROM cash_drops WHERE id = ?').get(dropId);
}

function getCashDrops(filters = {}) {
  const db = getDb();
  let sql = 'SELECT * FROM cash_drops WHERE 1=1';
  const params = [];
  if (filters.shift_id) { sql += ' AND shift_id = ?'; params.push(filters.shift_id); }
  if (filters.status) { sql += ' AND status = ?'; params.push(filters.status); }
  if (filters.from) { sql += ' AND date(created_at) >= date(?)'; params.push(filters.from); }
  if (filters.to) { sql += ' AND date(created_at) <= date(?)'; params.push(filters.to); }
  sql += ' ORDER BY id DESC LIMIT 200';
  try {
    return db.prepare(sql).all(...params);
  } catch (_) {
    return [];
  }
}

function confirmCashDrop(id, actor) {
  const user = assertUserActor(actor, ['owner', 'manager', 'supervisor', 'assistant_manager']);
  const db = getDb();
  const row = db.prepare('SELECT * FROM cash_drops WHERE id = ?').get(id);
  if (!row) throw new Error('Cash drop not found');
  db.prepare(`
    UPDATE cash_drops SET status='confirmed', confirmed_by=?, confirmed_at=datetime('now') WHERE id=?
  `).run(user.id, id);
  audit(user.id, user.username, 'cash_drop_confirm', 'cash_drop', id, { amount: row.amount });
  return db.prepare('SELECT * FROM cash_drops WHERE id = ?').get(id);
}

function openShift(userId, openingFloat, opts = {}) {
  const existing = getDb().prepare("SELECT id FROM shifts WHERE user_id = ? AND status = 'open'").get(userId);
  if (existing) return getOpenShift(userId);
  branchesSvc.ensureBranchSchema();
  const user = getDb().prepare('SELECT id, role, branch_id FROM users WHERE id = ?').get(userId);
  const branchId = branchesSvc.resolveTillBranchId(user, {
    till_branch_id: opts?.till_branch_id ?? opts?.branch_id,
    branch_id: opts?.branch_id
  });
  if (branchesSvc.hasColumn('shifts', 'branch_id')) {
    getDb().prepare('INSERT INTO shifts (user_id, opening_float, branch_id) VALUES (?, ?, ?)')
      .run(userId, openingFloat || 0, branchId);
  } else {
    getDb().prepare('INSERT INTO shifts (user_id, opening_float) VALUES (?, ?)').run(userId, openingFloat || 0);
  }
  return getOpenShift(userId);
}

function closeShift(shiftId, data, userId) {
  if (features.hasCashUpForShift(shiftId)) {
    throw new Error('This shift has already been cashed out');
  }
  const preview = getShiftClosePreview(shiftId, userId);
  const shift = preview.shift;
  const paymentMap = preview.expectedPayments;
  const cash = paymentMap.cash || 0;
  const card = paymentMap.card || 0;
  const eft = paymentMap.eft || 0;
  const mobile = paymentMap.mobile || 0;
  const giftcard = paymentMap.giftcard || 0;
  const account = paymentMap.account || 0;
  const other = paymentMap.other || 0;

  const actualPayments = data.actual_payments || {};
  const shortages = {};
  for (const [type, expected] of Object.entries(paymentMap)) {
    const actual = Number(actualPayments[type]);
    shortages[type] = Number.isFinite(actual) ? actual - expected : 0;
  }
  // Auto-close: use expected cash as counted so difference is zero unless already counted
  const cashCounted = data.cash_counted != null
    ? Number(data.cash_counted)
    : (data.auto_closed
      ? Number(preview.expectedCash) || 0
      : (Number(actualPayments.cash) || 0));
  const expected = preview.expectedCash;
  const diff = cashCounted - expected;

  getDb().prepare(`
    UPDATE shifts SET closed_at=datetime('now'), status='closed', closing_balance=?, cash_counted=?,
    expected_cash=?, cash_difference=?, total_sales=?, total_cash=?, total_card=?, total_eft=?,
    total_mobile=?, mobile_sales=?, other_sales=?, giftcard_sales=?, account_sales=?,
    actual_payments_json=?, payment_shortages_json=?,
    daily_target=?, sales_at_close=?, target_remaining=?, target_met=?,
    customer_count=?, notes=? WHERE id=?
  `).run(
    data.closing_balance != null ? data.closing_balance : cashCounted,
    cashCounted, expected, diff,
    preview.totalSales, cash, card, eft, mobile, mobile, other, giftcard, account,
    JSON.stringify(actualPayments),
    JSON.stringify(data.payment_shortages || shortages),
    preview.dailyTarget, preview.todaySales, preview.targetRemaining, preview.targetMet,
    preview.saleCount, data.notes || null, shiftId
  );
  const cashupData = {
    opening_cash: shift.opening_float || 0,
    cash_sales: cash,
    card_sales: card,
    eft_sales: eft,
    mobile_sales: mobile,
    expenses: 0,
    refunds: preview.refunds || 0,
    expected_cash: expected,
    actual_cash: cashCounted,
    actual_payments: actualPayments,
    manager_approved: false,
    force_pending: true,
    notes: data.notes || null
  };
  let cashupId = null;
  try {
    cashupId = createCashUp(shiftId, cashupData, userId);
  } catch (err) {
    console.error('[closeShift] cashup record failed:', err.message);
    throw err;
  }

  const result = { expected, difference: diff, totalSales: preview.totalSales, payments: paymentMap, shortages, targetMet: preview.targetMet, cashupId };
  try {
    notifyShiftClose(shiftId, userId, preview, result);
  } catch (err) {
    console.error('[closeShift] notification failed:', err.message);
  }
  return result;
}

function createCashUp(shiftId, data, actorId) {
  const cashupId = features.createCashUp(shiftId, data, actorId);
  try {
    notifyCashUpSession(cashupId, shiftId, data, actorId);
  } catch (err) {
    console.error('[createCashUp] notification failed:', err.message);
  }
  accHook('postFromCashup', cashupId, data);
  return cashupId;
}

function getShifts(limit = 50) {
  return getDb().prepare(`
    SELECT sh.*, u.full_name as user_name FROM shifts sh
    LEFT JOIN users u ON sh.user_id = u.id ORDER BY sh.opened_at DESC LIMIT ?
  `).all(limit);
}

function getOpenShift(userId) {
  return getDb().prepare("SELECT * FROM shifts WHERE user_id = ? AND status = 'open'").get(userId);
}

function getAnyOpenShifts() {
  return getDb().prepare(`
    SELECT sh.*, u.full_name as user_name, u.username FROM shifts sh
    LEFT JOIN users u ON sh.user_id = u.id
    WHERE sh.status = 'open' ORDER BY sh.opened_at DESC
  `).all();
}

function adminForceCloseShift(shiftId, data, actor) {
  const user = requireActor(actor, ['owner', 'manager']);
  const shift = getDb().prepare('SELECT * FROM shifts WHERE id = ?').get(shiftId);
  if (!shift) throw new Error('Shift not found');
  if (shift.status !== 'open') throw new Error('Shift is not open');
  const notes = [String(data?.notes || '').trim(), '[Admin force close]'].filter(Boolean).join(' ');
  const result = closeShift(shiftId, { ...data, auto_closed: true, notes }, shift.user_id);
  audit(user.id, user.full_name || user.username, 'force_close_shift', 'shift', shiftId, null);
  return result;
}

function updateShiftRecord(shiftId, data, actor) {
  const user = requireActor(actor, ['owner', 'manager']);
  const shift = getDb().prepare('SELECT * FROM shifts WHERE id = ?').get(shiftId);
  if (!shift) throw new Error('Shift not found');
  const fields = [];
  const params = [];
  if (data?.notes != null) { fields.push('notes = ?'); params.push(String(data.notes)); }
  if (data?.opening_float != null) { fields.push('opening_float = ?'); params.push(Number(data.opening_float) || 0); }
  if (data?.closing_balance != null) { fields.push('closing_balance = ?'); params.push(Number(data.closing_balance) || 0); }
  if (data?.cash_counted != null) { fields.push('cash_counted = ?'); params.push(Number(data.cash_counted) || 0); }
  if (!fields.length) return getDb().prepare(`
    SELECT sh.*, u.full_name as user_name FROM shifts sh LEFT JOIN users u ON sh.user_id = u.id WHERE sh.id = ?
  `).get(shiftId);
  getDb().prepare(`UPDATE shifts SET ${fields.join(', ')} WHERE id = ?`).run(...params, shiftId);
  audit(user.id, user.full_name || user.username, 'update_shift', 'shift', shiftId, data);
  return getDb().prepare(`
    SELECT sh.*, u.full_name as user_name FROM shifts sh LEFT JOIN users u ON sh.user_id = u.id WHERE sh.id = ?
  `).get(shiftId);
}

function deleteShiftRecord(shiftId, actor) {
  const user = requireActor(actor, ['owner']);
  const shift = getDb().prepare('SELECT * FROM shifts WHERE id = ?').get(shiftId);
  if (!shift) throw new Error('Shift not found');
  if (shift.status === 'open') throw new Error('Close the shift before deleting it');
  getDb().prepare('DELETE FROM shifts WHERE id = ?').run(shiftId);
  audit(user.id, user.full_name || user.username, 'delete_shift', 'shift', shiftId, null);
  return { deleted: true, id: shiftId };
}

function updatePurchaseOrder(id, data, actorId, actorName) {
  const db = getDb();
  const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(id);
  if (!po) throw new Error('Purchase order not found');
  if (po.status === 'received') throw new Error('Cannot edit a received purchase order');
  db.transaction(() => {
    if (data.supplier_id != null || data.receiving_date != null || data.notes != null || data.status != null) {
      db.prepare(`
        UPDATE purchase_orders SET
          supplier_id = COALESCE(?, supplier_id),
          receiving_date = COALESCE(?, receiving_date),
          notes = COALESCE(?, notes),
          status = COALESCE(?, status)
        WHERE id = ?
      `).run(
        data.supplier_id ?? null,
        data.receiving_date ?? null,
        data.notes ?? null,
        data.status ?? null,
        id
      );
    }
    if (Array.isArray(data.items)) {
      db.prepare('DELETE FROM purchase_order_items WHERE purchase_order_id = ?').run(id);
      for (const item of data.items) {
        db.prepare(`
          INSERT INTO purchase_order_items (purchase_order_id, product_id, product_name, quantity, buying_price, total)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(id, item.product_id || null, item.product_name, item.quantity, item.buying_price, item.total || (item.quantity * item.buying_price));
      }
      const total = data.items.reduce((sum, item) => sum + (Number(item.total) || Number(item.quantity) * Number(item.buying_price) || 0), 0);
      db.prepare('UPDATE purchase_orders SET total = ? WHERE id = ?').run(Math.round(total * 100) / 100, id);
    }
  })();
  audit(actorId, actorName, 'update_purchase_order', 'purchase_order', id, null);
  return getPurchaseOrder(id);
}

function deletePurchaseOrder(id, actorId, actorName) {
  const db = getDb();
  const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(id);
  if (!po) throw new Error('Purchase order not found');
  if (po.status === 'received') throw new Error('Cannot delete a received purchase order');
  db.transaction(() => {
    db.prepare('DELETE FROM purchase_order_items WHERE purchase_order_id = ?').run(id);
    db.prepare('DELETE FROM purchase_orders WHERE id = ?').run(id);
  })();
  audit(actorId, actorName, 'delete_purchase_order', 'purchase_order', id, { po_number: po.po_number });
  return { deleted: true, id };
}

function importProducts(rows, actorId, actorName) {
  let count = 0;
  const errors = [];
  for (const row of rows) {
    if (!row.name) continue;
    const selling_price = parseFloat(row.selling_price || row.price);
    if (!selling_price || selling_price <= 0) {
      errors.push(`${row.name}: invalid price`);
      continue;
    }
    try {
      saveProduct({
        name: row.name,
        selling_price,
        buying_price: parseFloat(row.buying_price || row.cost) || 0,
        barcode: row.barcode || null,
        sku: row.sku || null,
        stock_quantity: parseFloat(row.stock_quantity || row.stock) || 0,
        unit: row.unit || 'each',
        stock_unit: row.unit || 'each',
        category_id: row.category_id || null
      }, actorId, actorName);
      count++;
    } catch (err) {
      errors.push(`${row.name}: ${err.message}`);
    }
  }
  if (!count && errors.length) throw new Error(errors.slice(0, 3).join('; '));
  return { count, errors };
}

function getSalesReport(from, to) {
  return getDb().prepare(`
    SELECT s.*, u.full_name as cashier_name,
      COALESCE((SELECT SUM(r.total_refund) FROM returns r WHERE r.sale_id = s.id AND r.status IN ('completed','reopened')), 0) as refunded_total
    FROM sales s
    LEFT JOIN users u ON s.user_id = u.id
    WHERE date(s.created_at, 'localtime') BETWEEN ? AND ? AND ${SALE_REVENUE_STATUSES_SQL}
    ORDER BY s.created_at DESC
  `).all(from, to);
}

function getProfitReport(from, to) {
  return getDb().prepare(`
    SELECT day,
      SUM(revenue) as revenue,
      SUM(cost) as cost,
      SUM(revenue) - SUM(cost) as profit
    FROM (
      SELECT date(s.created_at, 'localtime') as day,
        s.total - COALESCE((
          SELECT SUM(r.total_refund) FROM returns r
          WHERE r.sale_id = s.id AND r.status IN ('completed','reopened')
        ), 0) as revenue,
        (SELECT COALESCE(SUM(si.buying_price * si.quantity), 0) FROM sale_items si WHERE si.sale_id = s.id) as cost
      FROM sales s
      WHERE date(s.created_at, 'localtime') BETWEEN ? AND ? AND ${SALE_REVENUE_STATUSES_SQL}
    )
    GROUP BY day ORDER BY day
  `).all(from, to);
}

function getCashierReport(from, to, userId) {
  const params = [from, to];
  let filter = '';
  if (userId != null && userId !== '' && Number(userId) > 0) {
    filter = ' AND s.user_id = ?';
    params.push(Number(userId));
  }
  return getDb().prepare(`
    SELECT u.id as user_id, u.full_name, u.username, u.role,
      COUNT(s.id) as sales_count,
      COALESCE(SUM(s.total), 0) as total,
      COALESCE(SUM(s.subtotal), 0) as subtotal,
      COALESCE(SUM(s.tax_amount), 0) as tax_total,
      COALESCE(SUM(s.discount), 0) as discount_total
    FROM sales s JOIN users u ON s.user_id = u.id
    WHERE date(s.created_at, 'localtime') BETWEEN ? AND ? AND ${SALE_REVENUE_STATUSES_SQL}${filter}
    GROUP BY s.user_id ORDER BY total DESC
  `).all(...params);
}

function getCashierSalesDetail(from, to, userId) {
  if (!userId) return [];
  return getDb().prepare(`
    SELECT s.id, s.receipt_number, s.created_at, s.subtotal, s.tax_amount, s.discount, s.total, s.status,
      s.payment_method
    FROM sales s
    WHERE s.user_id = ? AND date(s.created_at, 'localtime') BETWEEN ? AND ? AND ${SALE_REVENUE_STATUSES_SQL}
    ORDER BY s.created_at DESC
    LIMIT 500
  `).all(Number(userId), from, to);
}

function getProductReport(from, to) {
  return getDb().prepare(`
    SELECT si.product_name, SUM(si.quantity) as qty, SUM(si.total) as revenue
    FROM sale_items si JOIN sales s ON si.sale_id = s.id
    WHERE date(s.created_at, 'localtime') BETWEEN ? AND ? AND ${SALE_REVENUE_STATUSES_SQL}
    GROUP BY si.product_name ORDER BY revenue DESC
  `).all(from, to);
}

function getStockReport() {
  const bid = resolveTillBranchId();
  let products = getDb().prepare(`
    SELECT p.*, c.name as category_name
    FROM products p LEFT JOIN categories c ON p.category_id = c.id
    WHERE p.is_active = 1 ORDER BY p.name
  `).all();
  products = overlayBranchStockOnProducts(products, bid);
  return products.map((p) => ({
    ...p,
    status: p.stock_quantity <= 0 ? 'out' : (p.stock_quantity <= p.min_stock ? 'low' : 'ok')
  }));
}

// ─── Audit & Notifications ──────────────────────────────────────────────────

function getAuditLog(filters = {}) {
  let sql = 'SELECT * FROM audit_log WHERE 1=1';
  const params = [];
  if (filters.from) { sql += ' AND date(created_at) >= date(?)'; params.push(filters.from); }
  if (filters.to) { sql += ' AND date(created_at) <= date(?)'; params.push(filters.to); }
  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(filters.limit || 500);
  return getDb().prepare(sql).all(...params);
}

function notificationVisibleToRole(row, role) {
  if (!role) return false;
  const raw = row.audience_roles;
  if (!raw) {
    // Legacy rows: infer from type/action_page
    const allowed = defaultNotificationAudience(row.type, row.action_page);
    return allowed.includes(role);
  }
  const roles = String(raw).split(',').map(s => s.trim()).filter(Boolean);
  if (!roles.length) return true;
  return roles.includes(role);
}

function getNotifications(actorOrRole) {
  const rows = getDb().prepare('SELECT * FROM notifications WHERE is_read = 0 ORDER BY created_at DESC LIMIT 80').all();
  let role = null;
  if (typeof actorOrRole === 'string') role = actorOrRole;
  else if (actorOrRole?.role) role = actorOrRole.role;
  else {
    try { role = session.getUserSession()?.role || null; } catch (_) { role = null; }
  }
  if (!role) return rows;
  return rows.filter(r => notificationVisibleToRole(r, role));
}

function markNotificationRead(id) {
  getDb().prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').run(id);
}

function markAllNotificationsRead(actorOrRole) {
  const visible = getNotifications(actorOrRole);
  if (!visible.length) return;
  const ids = visible.map(n => n.id).filter(Boolean);
  if (!ids.length) return;
  const placeholders = ids.map(() => '?').join(',');
  getDb().prepare(`UPDATE notifications SET is_read = 1 WHERE id IN (${placeholders})`).run(...ids);
}

const PAYROLL_WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function refreshPaymentDueNotifications() {
  const now = new Date().toLocaleDateString('en-CA');
  const profile = ownerSalary.getOwnerProfile();
  if (profile?.is_active) {
    try { ownerSalary.ensureCurrentPeriod(profile); } catch (_) { /* ignore */ }
    const periods = getDb().prepare(`
      SELECT * FROM owner_salary_periods WHERE profile_id = ?
        AND status IN ('unpaid','partially_paid') AND outstanding_balance > 0
        AND due_date <= date('now') ORDER BY due_date`).all(profile.id);
    for (const p of periods) {
      const isToday = p.due_date === now;
      const title = isToday ? 'Owner Salary Due Today' : 'Owner Salary Overdue';
      const msg = `${profile.owner_name}: ${p.payslip_number} — ${Number(p.outstanding_balance).toFixed(2)} ${isToday ? 'due today' : `overdue since ${p.due_date}`}`;
      addNotification(isToday ? 'owner_salary_due' : 'owner_salary_overdue', title, msg);
    }
  }
  const settings = staff.getPayrollSettings();
  if (staff.isPayrollDueToday(settings)) {
    const freq = settings.pay_frequency || 'monthly';
    const dayLabel = freq === 'monthly'
      ? `day ${settings.payday || 25} of the month`
      : PAYROLL_WEEKDAYS[Number(settings.payday_weekday ?? 5)] || 'Friday';
    addNotification('payroll_due', 'Staff Pay Day', `Today is staff ${freq} pay day (${dayLabel}). Process payroll in Admin → Payroll.`);
  }
  try { hrContracts.ensureProbationNotifications(); } catch (_) { /* ignore */ }
  try { opsComplianceSvc.ensureChecklistDeadlineWarnings(); } catch (_) { /* ignore */ }
  try { hrContracts.ensureDefaultTemplates(); } catch (_) { /* ignore */ }
  try { hrTrainingSvc.ensureDefaultHrTemplates(); } catch (_) { /* ignore */ }
  try { opsComplianceSvc.ensureChecklistReminderNotifications(); } catch (_) { /* ignore */ }
  try { flyersSvc.syncFlyerStatuses(); } catch (_) { /* ignore */ }
  try { documentHubSvc.processScheduledDocuments(); } catch (_) { /* ignore */ }
  try { promoRequestsSvc.syncPromoStatuses(); } catch (_) { /* ignore */ }
  try { features.expireLoyaltyPoints(); } catch (_) { /* ignore */ }
  try { features.ensureLoyaltyReminderNotifications?.(addNotification); } catch (_) { /* ignore */ }
}

function processScheduledDocuments() {
  const processed = _documentHubProcessScheduled();
  for (const p of processed) {
    if (p.error) {
      addNotification('document_share', 'Scheduled Share Failed',
        `"${p.title}": ${p.error}`, {
          entity_type: 'document_hub',
          entity_id: p.id,
          action_page: `document-hub:share:${p.id}`
        });
      continue;
    }
    const parts = [`"${p.title}" scheduled share is ready`];
    const res = p.results || {};
    if (res.group_link) parts.push('WhatsApp group link included');
    if (res.urls?.length) parts.push(`${res.urls.length} customer wa.me link(s)`);
    if (res.status_export?.path) parts.push('Status export (1080×1920) ready');
    addNotification('document_share', 'Document Share Ready', parts.join(' · '), {
      entity_type: 'document_hub',
      entity_id: p.id,
      action_page: `document-hub:share:${p.id}`
    });
  }
  return processed;
}

function runStartupTasks() {
  try {
    branchesSvc.ensureBranchSchema();
    branchesSvc.ensureDefaultBranch();
  } catch (err) {
    console.warn('[startup] branch bootstrap:', err.message || err);
  }
  try { maybeSyncMenuHighlights(true); } catch (_) { /* ignore */ }
  try { processScheduledDocuments(); } catch (_) { /* ignore */ }
  try { if (typeof staffExports.autoCloseOpenAttendance === 'function') staffExports.autoCloseOpenAttendance(); } catch (_) { /* ignore */ }
  try { enforceShiftCashoutDeadlines(); } catch (_) { /* ignore */ }
  try { features.expireLoyaltyPoints(); } catch (_) { /* ignore */ }
  try { features.ensureLoyaltyReminderNotifications?.(addNotification); } catch (_) { /* ignore */ }
  try {
    if (process.env.SHOP_POS_LOCAL_INSTALLER === '1') {
      const central = require('./accounting-central');
      central.reflushFailedIntegrations().catch(() => {});
    }
  } catch (_) { /* ignore */ }
}

function saveKdsNotificationSound(soundPath, actorId, actorName) {
  getDb().prepare('UPDATE shop_settings SET kds_notification_sound = ?, updated_at = datetime(\'now\') WHERE id = 1')
    .run(soundPath || null);
  audit(actorId, actorName, 'update_kds_sound', 'settings', 1, { sound_path: soundPath || null });
  return getSettingsParsed();
}

// ─── Search ─────────────────────────────────────────────────────────────────

function globalSearch(query) {
  const pgDb = require('../database/pg-db');
  const isPg = pgDb.isPgMode();
  const raw = String(query || '').trim();
  const q = `%${raw}%`;
  const ql = raw.toLowerCase();
  const digits = raw.replace(/\D/g, '');
  const db = getDb();
  const settings = db.prepare('SELECT shop_name, address, phone, email FROM shop_settings WHERE id = 1').get();
  const settingsMatches = [];
  if (settings) {
    for (const [key, label, section] of [
      ['shop_name', 'Shop Name', 'customize'],
      ['address', 'Address', 'customize'],
      ['phone', 'Phone', 'customize'],
      ['email', 'Email', 'customize']
    ]) {
      const val = settings[key];
      if (val && String(val).toLowerCase().includes(ql)) {
        settingsMatches.push({ key, label, value: val, section });
      }
    }
  }
  const safe = (fn, fallback = []) => {
    try { return fn(); } catch (_) { return fallback; }
  };
  return {
    products: db.prepare('SELECT id, name, barcode, sku, selling_price, stock_quantity FROM products WHERE is_active=1 AND (name LIKE ? OR barcode LIKE ? OR sku LIKE ?) LIMIT 20').all(q, q, q),
    customers: (() => {
      if (isPg) {
        const params = [q, q, q];
        let sql = 'SELECT id, name, phone, email FROM customers WHERE name ILIKE ? OR phone ILIKE ? OR email ILIKE ?';
        if (digits.length >= 2) {
          sql += ` OR regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') LIKE ?`;
          params.push(`%${digits}%`);
        }
        return db.prepare(`${sql} ORDER BY name LIMIT 15`).all(...params);
      }
      if (digits.length >= 2) {
        return db.prepare(`SELECT id, name, phone, email FROM customers WHERE name LIKE ? COLLATE NOCASE OR phone LIKE ? OR email LIKE ? COLLATE NOCASE
          OR REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(phone, ''), ' ', ''), '-', ''), '+', ''), '(', '') LIKE ? ORDER BY name LIMIT 15`).all(q, q, q, `%${digits}%`);
      }
      return db.prepare('SELECT id, name, phone, email FROM customers WHERE name LIKE ? COLLATE NOCASE OR phone LIKE ? OR email LIKE ? COLLATE NOCASE ORDER BY name LIMIT 15').all(q, q, q);
    })(),
    suppliers: db.prepare('SELECT id, name, phone FROM suppliers WHERE name LIKE ? OR phone LIKE ? LIMIT 10').all(q, q),
    receipts: db.prepare('SELECT id, receipt_number, order_number, total, created_at FROM sales WHERE receipt_number LIKE ? OR order_number LIKE ? LIMIT 10').all(q, q),
    employees: db.prepare(`SELECT id, full_name, employee_code, phone, position FROM employees WHERE status = 'Active' AND (full_name LIKE ? OR employee_code LIKE ? OR phone LIKE ? OR email LIKE ?) LIMIT 10`).all(q, q, q, q),
    combos: safe(() => db.prepare('SELECT id, name, final_price AS selling_price, status FROM combos WHERE name LIKE ? LIMIT 10').all(q)),
    donations: safe(() => db.prepare('SELECT id, donation_number, recipient_org, amount, donation_date FROM donations WHERE donation_number LIKE ? OR recipient_org LIKE ? LIMIT 10').all(q, q)),
    categories: safe(() => db.prepare('SELECT id, name FROM categories WHERE name LIKE ? LIMIT 10').all(q)),
    giftcards: safe(() => db.prepare(`SELECT g.id, g.code, g.balance, g.status, c.name AS customer_name FROM gift_cards g LEFT JOIN customers c ON c.id = g.customer_id WHERE g.code LIKE ? OR c.name LIKE ? OR g.customer_phone LIKE ? LIMIT 10`).all(q, q, q)),
    laybyes: safe(() => db.prepare(`SELECT l.id, l.layby_number, l.balance, l.status, c.name AS customer_name FROM laybyes l LEFT JOIN customers c ON c.id = l.customer_id WHERE l.layby_number LIKE ? OR c.name LIKE ? OR c.phone LIKE ? LIMIT 10`).all(q, q, q)),
    expenses: safe(() => db.prepare('SELECT id, description, amount, expense_date FROM expenses WHERE description LIKE ? OR category LIKE ? LIMIT 10').all(q, q)),
    quotes: safe(() => db.prepare('SELECT id, quote_number, total, status FROM quotes WHERE quote_number LIKE ? LIMIT 10').all(q)),
    users: safe(() => db.prepare(`SELECT id, username, full_name, role FROM users WHERE is_active=1 AND (username LIKE ? OR full_name LIKE ? OR role LIKE ?) LIMIT 10`).all(q, q, q)),
    settings: settingsMatches
  };
}

function logOperatingEvent(eventType, user) {
  const type = eventType === 'close' ? 'close' : 'open';
  const uid = user?.id ?? null;
  const uname = user?.username ?? user?.full_name ?? null;
  const fname = user?.full_name ?? null;
  getDb().prepare(`
    INSERT INTO shop_operating_log (event_type, user_id, username, full_name, notes)
    VALUES (?, ?, ?, ?, ?)
  `).run(type, uid, uname, fname, null);
  if (uid && uname) {
    audit(uid, uname, type === 'open' ? 'shop_open' : 'shop_close', 'operating', null, null);
  }
  return { success: true };
}

function getOperatingLogReport(from, to) {
  return getDb().prepare(`
    SELECT event_type, user_id, username, full_name, event_at, notes
    FROM shop_operating_log
    WHERE date(event_at) >= date(?) AND date(event_at) <= date(?)
    ORDER BY event_at DESC
  `).all(from, to);
}

/**
 * Accept a hub online order: create a POS sale (order_type=online), deduct stock, sync sale, mark order accepted.
 */
async function acceptOnlineOrderAsSale(localId, actor, opts = {}) {
  const db = getDb();
  const order = db.prepare('SELECT * FROM online_orders_local WHERE id = ?').get(localId);
  if (!order) throw new Error('Online order not found');
  if (order.status !== 'pending') throw new Error(`Order is already ${order.status}`);
  if (order.sale_id) throw new Error('Order already linked to a sale');

  let lines = [];
  try { lines = JSON.parse(order.items_json || '[]'); } catch (_) {
    throw new Error('Order items are invalid');
  }
  if (!lines.length) throw new Error('Order has no items');

  const saleItems = [];
  for (const line of lines) {
    if (line.combo_id) {
      const combosSvc = require('./combos');
      const combo = combosSvc.getCombo(Number(line.combo_id));
      if (!combo) throw new Error(`Cannot match combo on this POS: ${line.name || line.combo_id}`);
      const components = Array.isArray(line.combo_components) ? line.combo_components : [];
      const unitPrice = line.unit_price != null
        ? Number(line.unit_price)
        : combosSvc.comboSaleUnitPrice(combo, components);
      saleItems.push({
        combo_id: combo.id,
        product_name: line.name || combo.name,
        quantity: Number(line.quantity) || 1,
        unit_price: unitPrice,
        buying_price: combo.combo_kind === 'custom'
          ? 0
          : (combo.items || []).reduce((s, ci) => s + (Number(ci.buying_price) || 0) * (Number(ci.quantity) || 1), 0),
        modifiers: [],
        modifiers_text: line.modifiers_text || null,
        combo_components: components.length ? components : null,
        item_type: 'combo'
      });
      continue;
    }
    let product = null;
    const remoteId = line.remote_id != null ? Number(line.remote_id) : (line.product_id != null ? Number(line.product_id) : null);
    if (remoteId) product = db.prepare('SELECT * FROM products WHERE id = ? AND is_active = 1').get(remoteId);
    if (!product && line.barcode) {
      product = db.prepare('SELECT * FROM products WHERE barcode = ? AND is_active = 1').get(String(line.barcode).trim());
    }
    if (!product && line.name) {
      product = db.prepare('SELECT * FROM products WHERE lower(trim(name)) = lower(trim(?)) AND is_active = 1')
        .get(String(line.name));
    }
    if (!product) {
      throw new Error(`Cannot match product on this POS: ${line.name || line.barcode || line.remote_id || 'unknown'}. Publish products from this till, then sync.`);
    }
    const unitPrice = line.unit_price != null ? Number(line.unit_price) : (Number(product.selling_price) || 0);
    const lineModifiers = Array.isArray(line.modifiers) ? line.modifiers : [];
    saleItems.push({
      product_id: product.id,
      product_name: line.name || product.name,
      quantity: Number(line.quantity) || 1,
      unit_price: unitPrice,
      buying_price: Number(product.buying_price) || 0,
      modifiers: lineModifiers.map((m) => ({ id: m.id, name: m.name })),
      modifiers_text: line.modifiers_text || (lineModifiers.length ? lineModifiers.map((m) => m.name).join(', ') : null)
    });
  }

  const fulfillment = opts.fulfillment || order.fulfillment || order.fulfillment_type || 'pickup';
  const orderDiscount = Number(order.discount) || 0;
  const deliveryFee = Number(order.delivery_fee) || 0;
  const orderTax = Number(order.tax_amount) || 0;
  const orderTotal = Number(order.total) || 0;
  const loyaltyPts = Number(order.loyalty_points_used) || 0;
  const giftCardAmt = Number(order.gift_card_amount) || 0;
  const giftCardCode = order.gift_card_code || null;
  const saleDiscount = orderDiscount;
  const discountParts = [];
  if (order.coupon_code) discountParts.push(`Coupon ${order.coupon_code}`);
  if (loyaltyPts > 0) discountParts.push(`Loyalty ${loyaltyPts} pts`);
  if (giftCardAmt > 0 && giftCardCode) discountParts.push(`Gift card ${giftCardCode} (-${giftCardAmt.toFixed(2)})`);
  const notes = [
    `Online order ${order.order_number}`,
    order.order_source ? `Source: ${order.order_source}` : 'Source: ONLINE',
    order.customer_name ? `Customer: ${order.customer_name}` : null,
    order.customer_phone ? `Phone: ${order.customer_phone}` : null,
    fulfillment ? `Fulfillment: ${fulfillment}` : null,
    discountParts.length ? `Discounts: ${discountParts.join(' · ')}` : null,
    order.notes || null
  ].filter(Boolean).join(' · ');

  const payments = [];
  if (giftCardAmt > 0 && giftCardCode) {
    payments.push({
      type: 'giftcard',
      amount: giftCardAmt,
      gift_card_code: giftCardCode,
      gift_card_pre_redeemed: true
    });
  }
  const remainder = money(orderTotal);
  if (remainder > 0.009) {
    payments.push({ type: order.payment_method || 'online', amount: remainder });
  } else if (!payments.length) {
    payments.push({ type: order.payment_method || 'online', amount: orderTotal || 0 });
  }
  const tender = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);

  const saleData = {
    items: saleItems,
    discount: saleDiscount,
    tax_amount: orderTax,
    delivery_fee: fulfillment === 'delivery' ? deliveryFee : 0,
    amount_paid: tender > 0 ? tender : orderTotal,
    payments,
    order_type: fulfillment === 'delivery' ? 'delivery' : 'online',
    order_source: order.order_source || 'ONLINE',
    customer_id: order.customer_id || null,
    delivery_address: fulfillment === 'delivery' ? (opts.delivery_address || order.delivery_address || null) : null,
    notes,
    discount_authorized: true,
    gift_card_code: giftCardCode,
    gift_card_amount: giftCardAmt
  };

  const actorId = actor?.id;
  if (!actorId) throw new Error('Login required to accept online orders');

  const actorRole = actor.role || db.prepare('SELECT role FROM users WHERE id = ?').get(actorId)?.role;
  if (roleRequiresShift(actorRole) && !getOpenShift(actorId)) {
    try { openShift(actorId, 0); } catch (err) {
      throw new Error(err.message || 'You must open a shift before accepting online orders');
    }
  }

  const sale = completeSale(saleData, actorId, actor.full_name || actor.username, actorRole);
  const saleId = sale.saleId || sale.sale?.id;
  if (!saleId) throw new Error('Sale was created but id is missing');

  // Update local order status immediately — do not block on slow/unreachable hub sync
  try {
    getDb().prepare(`UPDATE online_orders_local SET status = ?, sale_id = ?, fulfillment = COALESCE(?, fulfillment), updated_at = datetime('now') WHERE id = ?`)
      .run(opts.mark_completed ? 'completed' : 'accepted', saleId, fulfillment, localId);
  } catch (_) {
    try {
      db.exec('ALTER TABLE online_orders_local ADD COLUMN sale_id INTEGER');
      db.exec('ALTER TABLE online_orders_local ADD COLUMN fulfillment TEXT');
      db.prepare('UPDATE online_orders_local SET status = ?, sale_id = ?, fulfillment = ? WHERE id = ?')
        .run(opts.mark_completed ? 'completed' : 'accepted', saleId, fulfillment, localId);
    } catch (__) { /* ignore */ }
  }
  try {
    db.prepare(`UPDATE web_stock_reservations SET status = 'fulfilled' WHERE order_id = ? AND status = 'reserved'`).run(localId);
  } catch (_) { /* optional */ }

  syncSvc.updateOnlineOrderStatus(localId, opts.mark_completed ? 'completed' : 'accepted').catch(() => {});

  try {
    const delivery = require('./delivery-platform');
    const saleRow = getSale(saleId);
    if (saleRow) {
      if (fulfillment === 'delivery') {
        delivery.releaseOnlineDeliveryAfterPosAccept(localId, saleId);
      } else {
        delivery.upsertFromSale(saleRow);
      }
    }
  } catch (_) { /* optional */ }

  try {
    const kitchenItems = [];
    for (const si of saleItems) {
      const prod = db.prepare('SELECT item_type FROM products WHERE id = ?').get(si.product_id);
      const t = String(prod?.item_type || 'food').toLowerCase();
      if (['food', 'drink', 'combo', 'side'].includes(t)) {
        kitchenItems.push({
          product_name: si.product_name,
          quantity: si.quantity,
          modifiers: si.modifiers_text || null
        });
      }
    }
    if (kitchenItems.length) {
      const features = require('./features');
      features.createKitchenOrder({
        sale_id: saleId,
        order_number: order.order_number || sale.order_number,
        items: kitchenItems
      }, actorId);
    }
  } catch (_) { /* KDS optional */ }

  return {
    order: db.prepare('SELECT * FROM online_orders_local WHERE id = ?').get(localId),
    sale: sale.sale || getSale(saleId),
    saleId
  };
}

module.exports = {
  ...features,
  ...auditSvc,
  audit, login, logout, createUser, updateUser, deleteUser, permanentlyDeleteUser, verifyUserSession, getUsers, requireActor,
  sanitizeSettingsResponse,
  getUserSession: session.getUserSession,
  getEmployeeSession: session.getEmployeeSession,
  clearAllSessions: session.clearAll,
  setUserSession: session.setUserSession,
  setEmployeeSession: session.setEmployeeSession,
  verifyBookkeepingPassword, setBookkeepingPassword, isBookkeepingUnlocked, requireBookkeepingAccess,
  hasRecoverySecret, getRecoveryStatus, setRecoverySecret, getUsernamesForRecovery, resetPasswordViaRecovery, seedInstallerAccountFromCloud, factoryResetBusiness, clearOperationalData,
  getSettings, getSettingsParsed, saveSettings, saveJsonSetting, getMenuHighlightSettings, saveMenuHighlightSettings, completeSetup,
  detectExistingBusiness, adoptExistingBusiness, parseJsonField,
  getCategories, saveCategory, deleteCategory, ensureOtherItemsCategory, saveOtherSellItem, suggestSellPrice, cartProfitFloor,
  getProducts, getProduct, getProductByBarcode, getProductModifiers, saveProductModifiers, saveProduct, deleteProduct,
  calcRecipeMetrics: (data) => inventory.calculateRecipeMetrics(null, data.selling_price, data.recipe),
  adjustStock, restoreProductStockAfterSale, getStockHistory, getAllStockHistory,
  recordStockAdjustment, listStockAdjustments, resolveProductRef, resolveModifierExtras,
  completeSale, getSale, getSaleByReceipt, holdOrder, getHeldOrders, deleteHeldOrder,
  processReturn, getReturns,
  getExpenses, getExpenseById, getExpenseCategories, getExpenseDashboardStats, saveExpenseCategories, saveExpense, deleteExpense,
  getCustomers, getCustomer, saveCustomer, deleteCustomer, getCustomerHistory,
  getSuppliers, saveSupplier, recordSupplierPayment, getSupplierPayments,
  getPurchaseOrders, getPurchaseOrder, savePurchaseOrder, receivePurchaseOrder, updatePurchaseOrder, deletePurchaseOrder,
  getDashboardStats, getInventoryStats, getSalesAnalytics,
  getSalesReport, getProfitReport, getCashierReport, getCashierSalesDetail, getProductReport, getStockReport,
  openShift, closeShift, getShiftClosePreview, getShifts, getOpenShift, getAnyOpenShifts, adminForceCloseShift, updateShiftRecord, deleteShiftRecord, getSalesTargets, saveSalesTargets,
  recordCashDrop, getCashDrops, confirmCashDrop,
  getShiftSettings, saveShiftSettings, roleRequiresShift, enforceShiftCashoutDeadlines, createCashUp,
  normalizePhone, phonesMatch, importProducts,
  getAuditLog, getNotifications, markNotificationRead, markAllNotificationsRead, createTestNotification, notifyPosOnlineOrder, refreshPaymentDueNotifications,
  globalSearch,
  convertQuoteToSale: (quoteId, actorId, actorName, paymentOpts) =>
    features.convertQuoteToSale(quoteId, completeSale, actorId, actorName, paymentOpts),
  completeStockCount: (countId, actorId) => features.completeStockCount(countId, adjustStock, actorId),
  recordWaste: (data, actorId) => features.recordWaste(data, adjustStock, actorId),
  approveWaste: (id, actorId, notes) => {
    const row = features.approveWaste(id, actorId, notes);
    adjustStock(row.product_id, row.quantity, 'remove', `Waste approved: ${row.reason}`, actorId, 'waste', id);
    return getDb().prepare(`
      SELECT w.*, p.name as product_name FROM waste_records w
      JOIN products p ON w.product_id = p.id WHERE w.id = ?`).get(id);
  },
  rejectWaste: (id, actorId, notes) => features.rejectWaste(id, actorId, notes),
  returnWasteToStock: (id, actorId) => {
    const row = features.returnWasteToStock(id, actorId);
    adjustStock(row.product_id, row.quantity, 'add', `Waste returned to stock #${id}`, actorId, 'waste_return', id);
    return getDb().prepare(`
      SELECT w.*, p.name as product_name FROM waste_records w
      JOIN products p ON w.product_id = p.id WHERE w.id = ?`).get(id);
  },
  approveCashUp: (id, actorId, notes) => features.approveCashUp(id, actorId, notes),
  receivePurchaseOrderPartial: (poId, items, actorId, actorName) => features.receivePurchaseOrderPartial(poId, items, actorId, actorName, adjustStock),
  logOperatingEvent, getOperatingLogReport,
  ...branchesSvc,
  getSyncSettings: () => syncSvc.getSyncSettings(),
  saveSyncSettings: (data) => syncSvc.saveSyncSettings(data),
  getSyncStatus: () => syncSvc.getSyncStatus(),
  registerSyncDevice: (role, name) => syncSvc.registerDevice(role, name),
  syncNow: () => syncSvc.syncNow(),
  publishProductsToHub: () => syncSvc.publishProducts(getProducts, getCategories),
  syncBranchesToHub: () => syncSvc.syncBranchesToHub(),
  getOnlineOrdersLocal: (status) => syncSvc.getOnlineOrdersLocal(status),
  importCloudOrders: (orders) => syncSvc.importCloudOrders(orders),
  updateOnlineOrderStatus: (id, status, opts) => syncSvc.updateOnlineOrderStatus(id, status, opts),
  rejectOnlineOrder: (id, reason, actor) => syncSvc.rejectOnlineOrder(id, reason, actor),
  ...(() => {
    const dp = require('./delivery-platform');
    const { getSettings: getDeliverySettings, saveSettings: saveDeliverySettings, ...dpRest } = dp;
    return { ...dpRest, getDeliverySettings, saveDeliverySettings };
  })(),
  acceptOnlineOrderAsSale,
  ...staffExports,
  getEmployeeDocuments,
  saveEmployeeDocument,
  ...hrContracts,
  ...staffSelfies,
  ...ownerSalary,
  ...bookkeeping,
  ...donationsExports,
  getDonationDocument,
  ...require('./salary-claims'),
  ...opsComplianceSvc,
  ...promoRequestsSvc,
  getNonSellingProducts: (filters) => promoRequestsSvc.enrichNonSellingProducts(opsComplianceSvc.getNonSellingProducts(filters)),
  ...combosSvc,
  ...flyersExports,
  getFlyerTemplates,
  ...marketingAgentSvc,
  ...marketingPlatformSvc,
  adjustMarketingLoyaltyPoints,
  adjustLoyaltyPoints: features.adjustLoyaltyPoints,
  ...(() => {
    const acc = require('./accounting-platform');
    const { getSettings: _gs, saveSettings: _ss, getDashboard: getAccDashboard, ...rest } = acc;
    return {
      ...rest,
      getAccSettings: _gs,
      saveAccSettings: _ss,
      getAccDashboard: getAccDashboard,
      getDashboard: getAccDashboard
    };
  })(),
  ...(() => {
    const hr = require('./hr-platform');
    const { getDashboard, getSettings, saveSettings, globalSearch, ...hrRest } = hr;
    return {
      ...hrRest,
      getHrDashboard: getDashboard,
      getHrSettings: getSettings,
      saveHrSettings: saveSettings,
      hrGlobalSearch: globalSearch
    };
  })(),
  ...(() => {
    const biz = require('./biz-modules-common');
    const inv = require('./investor-platform');
    const rel = require('./release-platform');
    const mtg = require('./meeting-platform');
    const sig = require('./signage-platform');
    const kiosk = require('./kiosk-platform');
    const driveThru = require('./drive-thru-platform');
    return {
      ...inv,
      ...rel,
      ...mtg,
      ...sig,
      getBizModuleSettings: biz.getModuleSettings,
      saveBizModuleSettings: biz.saveModuleSettings,
      bizModulesSummary: () => ({
        settings: biz.getModuleSettings(),
        investor: inv.investorSummary(),
        release: rel.releaseSummary(),
        meeting: mtg.meetingSummary(),
        signage: sig.signageSummary(),
        kiosk: kiosk.kioskSummary(),
        drive_thru: driveThru.driveThruSummary()
      })
    };
  })(),
  ...whatsappExports,
  getWhatsAppTemplates,
  ...documentHubExports,
  getHubDocuments,
  getHubDocument,
  saveHubDocument,
  deleteHubDocument,
  processScheduledDocuments,
  runStartupTasks,
  saveKdsNotificationSound,
  ...customerRewardsSvc,
  ...employeeOfMonthSvc,
  ...hrTrainingSvc,
  ...recruitmentSvc,
  ...require('./recipe-production')
};

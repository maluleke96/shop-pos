const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// Load .env for Supabase URL/anon key (Electron tills share the same cloud backend).
(function loadDotEnv() {
  const isLocalInstaller = process.env.SHOP_POS_LOCAL_INSTALLER === '1';
  const skipDbKeys = new Set([
    'SHOP_POS_DATABASE_URL', 'DATABASE_URL',
    'SHOP_POS_DB_HOST', 'SHOP_POS_DB_PORT', 'SHOP_POS_DB_NAME', 'SHOP_POS_DB_USER', 'SHOP_POS_DB_PASSWORD',
    'SUPABASE_DB_HOST', 'SUPABASE_DB_PORT', 'SUPABASE_DB_NAME', 'SUPABASE_DB_USER', 'SUPABASE_DB_PASSWORD',
    'PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD'
  ]);
  try {
    const envPath = path.join(__dirname, '..', '.env');
    if (!fs.existsSync(envPath)) return;
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const key = m[1];
      if (isLocalInstaller && skipDbKeys.has(key)) continue;
      let val = m[2];
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (process.env[key] == null || process.env[key] === '') process.env[key] = val;
    }
  } catch (_) { /* optional */ }
  if (isLocalInstaller) {
    for (const key of skipDbKeys) delete process.env[key];
  }
})();

const { initDatabase, closeDatabase, getDbPathForBackup, validateDatabaseFile } = require('./database/db');
const store = require('./services/store');
const { assertEmployeeActor } = require('./services/authz');
const { buildExcelBuffer, buildPdfBuffer } = require('./services/export');
const printService = require('./services/printService');
const deviceSettings = require('./services/deviceSettings');

let mainWindow = null;
let allowAppQuit = false;
const isDev = process.argv.includes('--dev');
const useSupabase = !!(process.env.SHOP_POS_SUPABASE_URL && process.env.SHOP_POS_SUPABASE_ANON_KEY);

function buildDemoNotificationWav() {
  const sampleRate = 44100;
  const duration = 0.45;
  const frequency = 880;
  const numSamples = Math.floor(sampleRate * duration);
  const dataSize = numSamples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const fade = 1 - (t / duration);
    const sample = Math.sin(2 * Math.PI * frequency * t) * 0.35 * fade;
    buffer.writeInt16LE(Math.max(-32767, Math.min(32767, Math.floor(sample * 32767))), 44 + i * 2);
  }
  return buffer;
}

function ensureDemoNotificationSound() {
  if (MODE === 'pos') return;
  try {
    const settings = store.getSettingsParsed();
    const ns = settings?.notification_settings || {};
    const destDir = path.join(path.dirname(getDbPathForBackup()), 'assets', 'sounds');
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    const dest = path.join(destDir, 'notification-demo.wav');
    if (!fs.existsSync(dest)) {
      const src = path.join(__dirname, '../src/assets/notification-demo.wav');
      if (fs.existsSync(src)) fs.copyFileSync(src, dest);
      else fs.writeFileSync(dest, buildDemoNotificationWav());
    }
    const soundPath = fs.existsSync(dest) ? dest : null;
    if (!soundPath) return;
    const needsUpdate = !ns.sound_path || !fs.existsSync(ns.sound_path);
    if (needsUpdate) {
      store.saveJsonSetting('notification_settings', {
        ...ns,
        sound_path: soundPath,
        sound_enabled: ns.sound_enabled !== false,
        loop_until_read: ns.loop_until_read !== false
      }, null, 'system');
    }
  } catch (err) {
    console.error('Demo notification sound setup failed:', err);
  }
}

const MODE = String(process.env.SHOP_POS_APP_MODE || 'admin').toLowerCase();
process.env.SHOP_POS_LOCAL_INSTALLER = '1';

const TITLES = {
  admin: 'Shop POS Admin',
  pos: 'Shop POS',
  staff: 'Staff Portal',
  recipe: 'Recipe & Production'
};

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 360,
    minHeight: 560,
    fullscreenable: true,
    title: TITLES[MODE] || 'Shop POS',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, '../src/index.html'), { query: { app: MODE || 'admin' } });
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (!process.env.SHOP_POS_APP_MODE) mainWindow.setFullScreen(true);
  });
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F11' && input.type === 'keyDown') {
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
    }
    if (!isDev && input.type === 'keyDown') {
      if (input.alt && input.key === 'F4') event.preventDefault();
      if (input.control && (input.key === 'w' || input.key === 'W' || input.key === 'q' || input.key === 'Q')) {
        event.preventDefault();
      }
    }
  });
  mainWindow.on('close', (e) => {
    if (!allowAppQuit && !isDev) {
      e.preventDefault();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('app:close-blocked');
      }
    }
  });
  if (isDev) mainWindow.webContents.openDevTools();
  mainWindow.on('closed', () => { mainWindow = null; });
}

function registerIpc() {
  ipcMain.handle('app:quit', () => {
    allowAppQuit = true;
    closeDatabase();
    app.quit();
    return { success: true };
  });

  const wrap = (fn) => async (_e, ...args) => {
    try {
      return { success: true, data: await fn(...args) };
    } catch (err) {
      console.error(err);
      return { success: false, error: err.message };
    }
  };

  const wrapSync = (fn) => (_e, ...args) => {
    try {
      return { success: true, data: fn(...args) };
    } catch (err) {
      console.error(err);
      return { success: false, error: err.message };
    }
  };
  const wrapF = (fn) => wrapSync(fn);

  function requireSession() {
    const u = store.getUserSession();
    if (u?.id) return u;
    const e = store.getEmployeeSession();
    if (e?.employee_id != null) return e;
    throw new Error('Authentication required');
  }

  function requireUserSession(roles) {
    return store.requireActor(store.getUserSession(), roles || []);
  }

  function scopedEmployeeId(requestedId) {
    const empSess = store.getEmployeeSession();
    const userSess = store.getUserSession();
    if (empSess?.adminOverride && userSess?.id) {
      requireSession();
      return requestedId != null ? Number(requestedId) : null;
    }
    if (empSess?.employee_id != null) {
      const sid = Number(empSess.employee_id);
      if (requestedId != null && Number(requestedId) !== sid) {
        throw new Error('Authentication required');
      }
      return sid;
    }
    requireSession();
    return requestedId != null ? Number(requestedId) : null;
  }

  function portalEmployeeId(requestedId, actor) {
    const empSess = store.getEmployeeSession?.();
    if (empSess?.employee_id != null) {
      if (requestedId != null && Number(requestedId) !== Number(empSess.employee_id)) {
        throw new Error('Not authorised');
      }
      return Number(empSess.employee_id);
    }
    const actorEmp = actor?.employee_id != null ? Number(actor.employee_id) : null;
    if (actorEmp != null) {
      if (requestedId != null && Number(requestedId) !== actorEmp) throw new Error('Not authorised');
      return actorEmp;
    }
    if (requestedId != null) {
      store.requireActor(actor, ['owner', 'manager', 'supervisor', 'assistant_manager']);
      return Number(requestedId);
    }
    throw new Error('Authentication required');
  }

  function assertSafeAppPath(filePath) {
    if (!filePath || typeof filePath !== 'string') throw new Error('Invalid path');
    const resolved = path.resolve(filePath);
    const dataRoot = path.resolve(path.dirname(getDbPathForBackup()));
    const appRoot = path.resolve(path.join(__dirname, '..'));
    const ok = resolved === dataRoot || resolved.startsWith(dataRoot + path.sep)
      || resolved === appRoot || resolved.startsWith(appRoot + path.sep);
    if (!ok) throw new Error('Path not allowed');
    if (!fs.existsSync(resolved)) throw new Error('File not found');
    return resolved;
  }

  // Auth — local SQLite first; if credentials only exist on Railway, seed local and allow login
  const cloudAuth = require('../lib/installer-cloud-auth');
  ipcMain.handle('auth:login', async (_e, u, p, pin) => cloudAuth.loginWithOnlineFallback(store, u, p, pin));
  ipcMain.handle('auth:logout', wrapSync(() => store.logout()));
  ipcMain.handle('auth:getUsers', wrapSync((actor) => {
    store.requireActor(actor, ['owner', 'manager']);
    return store.getUsers();
  }));
  ipcMain.handle('auth:createUser', wrapSync((data, actor) => {
    store.requireActor(actor, ['owner', 'manager']);
    return store.createUser(data, actor.id, actor.username);
  }));
  ipcMain.handle('auth:updateUser', wrapSync((id, data, actor) => {
    store.requireActor(actor, ['owner', 'manager']);
    store.updateUser(id, data, actor.id, actor.username);
    return true;
  }));
  ipcMain.handle('auth:deleteUser', wrapSync((id, actor) => {
    store.requireActor(actor, ['owner', 'manager']);
    store.deleteUser(id, actor.id, actor.username);
    return true;
  }));
  ipcMain.handle('auth:permanentlyDeleteUser', wrapSync((id, confirmUsername, actor) => {
    store.requireActor(actor, ['owner', 'manager']);
    store.permanentlyDeleteUser(id, confirmUsername, actor.id, actor.username);
    return true;
  }));
  ipcMain.handle('auth:verifySession', wrapSync((userId) => store.verifyUserSession(userId)));
  ipcMain.handle('auth:session', wrapSync(() => {
    const u = store.getUserSession?.();
    if (!u?.id) throw new Error('Not authenticated');
    return u;
  }));
  ipcMain.handle('auth:hasRecovery', async () => {
    try {
      const data = await cloudAuth.hasRecoveryWithOnlineFallback(store);
      return { success: true, data: !!data };
    } catch (_) {
      return { success: true, data: !!store.hasRecoverySecret() };
    }
  });
  ipcMain.handle('auth:getRecoveryStatus', wrapSync((actor) => {
    store.requireActor(actor, ['owner']);
    return store.getRecoveryStatus();
  }));
  ipcMain.handle('auth:recoverVerify', async (_e, secret) => cloudAuth.recoverVerifyWithOnlineFallback(store, secret));
  ipcMain.handle('auth:recoverReset', async (_e, secret, username, newPassword) =>
    cloudAuth.recoverResetWithOnlineFallback(store, secret, username, newPassword));
  ipcMain.handle('auth:seedInstallerAccount', wrapSync((payload) => store.seedInstallerAccountFromCloud(payload || {})));
  ipcMain.handle('auth:setRecoverySecret', wrapSync((secret, actor) => {
    store.requireActor(actor, ['owner']);
    return store.setRecoverySecret(secret, actor.id, actor.username || 'owner');
  }));
  ipcMain.handle('auth:factoryReset', async (_e, secret, confirmText) => {
    try {
      await store.factoryResetBusiness(secret, confirmText);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
  ipcMain.handle('auth:clearOperationalData', wrap(async (_e, password, actor, categories) => {
    store.requireActor(actor, ['owner']);
    return store.clearOperationalData(password, actor.id, actor.username || actor.full_name || 'owner', categories);
  }));
  ipcMain.handle('auth:listClearDataCategories', wrapSync(() => store.listClearDataCategories()));
  ipcMain.handle('auth:verifyBookkeepingPassword', wrapSync((password) => store.verifyBookkeepingPassword(password)));
  ipcMain.handle('auth:setBookkeepingPassword', wrapSync((password, actor) => {
    store.requireActor(actor, ['owner', 'manager']);
    return store.setBookkeepingPassword(password, actor.id, actor.username);
  }));

  // Settings
  ipcMain.handle('settings:getParsed', wrapSync(() => store.getSettingsParsed()));
  ipcMain.handle('settings:getOperatingHours', wrapSync(() => store.getOperatingHoursSettings()));
  ipcMain.handle('settings:getMenuHighlights', wrapSync(() => store.getMenuHighlightSettings()));
  ipcMain.handle('settings:saveMenuHighlights', wrapF((data, actor) => store.saveMenuHighlightSettings(data, actor?.id, actor?.username || actor?.full_name)));
  ipcMain.handle('settings:get', wrapSync(() => store.sanitizeSettingsResponse(store.getSettings())));
  ipcMain.handle('settings:detectExistingBusiness', wrapSync(() => store.detectExistingBusiness()));
  ipcMain.handle('settings:adoptExistingBusiness', wrapSync(() => store.adoptExistingBusiness()));
  ipcMain.handle('settings:save', wrapSync((data, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager']);
    store.saveSettings(data, user.id, user.username || user.full_name);
    try { require('./database/db').persistNow(); } catch (_) { /* */ }
    return true;
  }));
  ipcMain.handle('settings:saveJson', wrapSync((key, value, actor) => {
    const roles = key === 'staff_portal_settings'
      ? ['owner', 'manager', 'supervisor', 'assistant_manager']
      : ['owner', 'manager'];
    const user = store.requireActor(actor, roles);
    store.saveJsonSetting(key, value, user.id, user.username || user.full_name);
    try { require('./database/db').persistNow(); } catch (_) { /* */ }
    return true;
  }));
  ipcMain.handle('settings:completeSetup', async (_e, data) => {
    try {
      return store.completeSetup(data);
    } catch (err) {
      console.error('Setup failed:', err);
      return { success: false, error: err.message };
    }
  });

  // Categories
  ipcMain.handle('categories:get', wrapSync((filters) => store.getCategories(filters || {})));
  ipcMain.handle('categories:save', wrapSync((data, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager', 'supervisor', 'assistant_manager']);
    return store.saveCategory(data, user.id, user.username);
  }));
  ipcMain.handle('categories:delete', wrapSync((id, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager']);
    store.deleteCategory(id, user.id, user.username);
    return true;
  }));

  // Products
  ipcMain.handle('products:get', wrapSync((filters) => store.getProducts(filters)));
  ipcMain.handle('products:getOne', wrapSync((id) => store.getProduct(id)));
  ipcMain.handle('products:getByBarcode', wrapSync((barcode) => store.getProductByBarcode(barcode)));
  ipcMain.handle('products:calcRecipe', wrapSync((data) => store.calcRecipeMetrics(data)));
  ipcMain.handle('products:save', wrapSync((data, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager', 'supervisor', 'assistant_manager']);
    const out = store.saveProduct(data, user.id, user.username);
    try { require('./database/db').persistNow(); } catch (_) { /* */ }
    return out;
  }));
  ipcMain.handle('products:delete', wrapSync((id, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager']);
    store.deleteProduct(id, user.id, user.username);
    try { require('./database/db').persistNow(); } catch (_) { /* */ }
    return true;
  }));
  ipcMain.handle('products:saveOtherSell', wrapSync((data, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager', 'supervisor', 'assistant_manager', 'cashier']);
    return store.saveOtherSellItem(data || {}, user.id, user.username || user.full_name);
  }));
  ipcMain.handle('products:suggestPrice', wrapSync((cost, pct) => store.suggestSellPrice(cost, pct)));
  ipcMain.handle('products:import', wrapSync((rows, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager']);
    return store.importProducts(rows, user.id, user.username);
  }));

  // Stock
  ipcMain.handle('stock:adjust', wrapSync((productId, qty, type, notes, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager', 'supervisor', 'assistant_manager']);
    const out = store.recordStockAdjustment({ product_id: productId, qty, direction: type, reason: notes }, user);
    try { require('./database/db').persistNow(); } catch (_) { /* */ }
    return out;
  }));
  ipcMain.handle('stock:recordAdjustment', wrapSync((data, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager', 'supervisor', 'assistant_manager']);
    const out = store.recordStockAdjustment(data || {}, user);
    try { require('./database/db').persistNow(); } catch (_) { /* */ }
    return out;
  }));
  ipcMain.handle('stock:listAdjustments', wrapSync((filters) => store.listStockAdjustments(filters || {})));
  ipcMain.handle('stock:history', wrap((arg) => {
    if (arg && typeof arg === 'object' && !Array.isArray(arg)) {
      return store.getAllStockHistory(arg.limit || 500, arg.from || null, arg.to || null);
    }
    return arg ? store.getStockHistory(arg) : store.getAllStockHistory();
  }));

  // Sales
  ipcMain.handle('sales:complete', wrapSync((data, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager', 'cashier', 'supervisor', 'assistant_manager']);
    return store.completeSale(data, user.id, user.full_name, user.role);
  }));
  ipcMain.handle('sales:hold', wrapSync((name, cart, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager', 'cashier', 'supervisor', 'assistant_manager']);
    return store.holdOrder(name, cart, user.id);
  }));
  ipcMain.handle('sales:get', wrapSync((id) => { requireSession(); return store.getSale(id); }));
  ipcMain.handle('sales:getByReceipt', wrapSync((num) => { requireSession(); return store.getSaleByReceipt(num); }));
  ipcMain.handle('sales:getHeld', wrapSync(() => { requireSession(); return store.getHeldOrders(); }));
  ipcMain.handle('sales:deleteHeld', wrapSync((id, actor) => {
    store.requireActor(actor, ['owner', 'manager', 'cashier', 'supervisor', 'assistant_manager']);
    store.deleteHeldOrder(id);
    return true;
  }));

  // Returns
  ipcMain.handle('returns:process', wrapSync((data, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager', 'supervisor', 'assistant_manager', 'cashier']);
    return store.processReturn(data, user.id, user.full_name);
  }));
  ipcMain.handle('returns:get', wrap((filters) => store.getReturns(filters)));

  // Expenses
  ipcMain.handle('expenses:get', wrap((filters) => { requireSession(); return store.getExpenses(filters); }));
  ipcMain.handle('expenses:getOne', wrap((id) => { requireSession(); return store.getExpenseById(id); }));
  ipcMain.handle('expenses:getCategories', wrap(() => { requireSession(); return store.getExpenseCategories(); }));
  ipcMain.handle('expenses:saveCategories', wrapSync((cats, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager']);
    return store.saveExpenseCategories(cats, user.id, user.username);
  }));
  ipcMain.handle('expenses:dashboardStats', wrap((filters, actor) => {
    const user = store.getUserSession?.() || actor;
    return store.getExpenseDashboardStats(user, filters || {});
  }));
  ipcMain.handle('expenses:save', wrapSync((data, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager', 'supervisor', 'assistant_manager']);
    return store.saveExpense(data, user.id, user.username);
  }));
  ipcMain.handle('expenses:delete', wrapSync((id, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager']);
    store.deleteExpense(id, user.id, user.username);
    return true;
  }));
  ipcMain.handle('expenses:parseReceipt', wrapSync((text) => {
    requireSession();
    return store.parseExpenseReceipt(text);
  }));
  ipcMain.handle('expenses:budgets', wrap((filters) => {
    requireSession();
    return store.listExpenseBudgets(filters || {});
  }));
  ipcMain.handle('expenses:budgetStatus', wrap((monthKey) => {
    requireSession();
    return store.expenseBudgetStatus(monthKey);
  }));
  ipcMain.handle('expenses:saveBudget', wrapSync((data, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager']);
    return store.saveExpenseBudget(data, user);
  }));
  ipcMain.handle('expenses:deleteBudget', wrapSync((id, actor) => {
    store.requireActor(actor, ['owner', 'manager']);
    return store.deleteExpenseBudget(id);
  }));
  ipcMain.handle('expenses:recurring', wrap(() => {
    requireSession();
    return store.listExpenseRecurring();
  }));
  ipcMain.handle('expenses:saveRecurring', wrapSync((data, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager']);
    return store.saveExpenseRecurring(data, user);
  }));
  ipcMain.handle('expenses:deleteRecurring', wrapSync((id, actor) => {
    store.requireActor(actor, ['owner', 'manager']);
    return store.deleteExpenseRecurring(id);
  }));
  ipcMain.handle('expenses:postRecurring', wrapSync((actor) => {
    const user = store.requireActor(actor, ['owner', 'manager', 'supervisor', 'assistant_manager']);
    return store.postExpenseRecurringDue(user);
  }));
  ipcMain.handle('expenses:ownerFundings', wrap((filters) => {
    requireSession();
    return store.listOwnerFundings(filters || {});
  }));
  ipcMain.handle('expenses:recordOwnerFunding', wrapSync((data, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager']);
    return store.recordOwnerFunding(data, user);
  }));

  // Customers
  ipcMain.handle('customers:get', wrap((search) => store.getCustomers(search)));
  ipcMain.handle('customers:getOne', wrap((id) => store.getCustomer(id)));
  ipcMain.handle('customers:save', wrap((data, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager', 'cashier', 'supervisor', 'assistant_manager']);
    return store.saveCustomer(data, user.id, user.username);
  }));
  ipcMain.handle('customers:delete', wrap((id, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager']);
    return store.deleteCustomer(id, user.id, user.username);
  }));
  ipcMain.handle('customers:history', wrap((id) => store.getCustomerHistory(id)));

  // Suppliers
  ipcMain.handle('suppliers:get', wrap((search) => store.getSuppliers(search)));
  ipcMain.handle('suppliers:save', wrapSync((data, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager', 'supervisor', 'assistant_manager']);
    return store.saveSupplier(data, user.id, user.username);
  }));
  ipcMain.handle('suppliers:delete', wrapSync((id, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager']);
    return store.deleteSupplier(id, user.id, user.username);
  }));
  ipcMain.handle('suppliers:pay', wrap((supplierId, data, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager', 'supervisor', 'assistant_manager']);
    return store.recordSupplierPayment(supplierId, data, user.id, user.username);
  }));
  ipcMain.handle('suppliers:payments', wrap((supplierId) => store.getSupplierPayments(supplierId)));

  // Purchase Orders
  ipcMain.handle('po:get', wrap(() => store.getPurchaseOrders()));
  ipcMain.handle('po:getDetail', wrap((id) => store.getPurchaseOrder(id)));
  ipcMain.handle('po:save', wrapSync((data, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager', 'supervisor', 'assistant_manager']);
    return store.savePurchaseOrder(data, user.id, user.username);
  }));
  ipcMain.handle('po:receive', wrapSync((id, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager', 'supervisor', 'assistant_manager']);
    return store.receivePurchaseOrder(id, user.id, user.username);
  }));

  // Dashboard & Reports
  ipcMain.handle('dashboard:stats', wrapSync((from, to) => {
    requireSession();
    try { require('./database/db').maybeReloadFromDisk?.(true); } catch (_) { /* ignore */ }
    const sess = store.getUserSession();
    const scope = store.resolveBranchScope(sess || null);
    const branchId = scope.allBranches ? null : scope.branchId;
    return store.getDashboardStats(from, to, branchId);
  }));
  ipcMain.handle('inventory:stats', wrapSync((branchId) => store.getInventoryStats(branchId)));
  ipcMain.handle('analytics:sales', wrapSync((from, to) => store.getSalesAnalytics(from, to)));
  ipcMain.handle('shifts:open', wrapSync((float, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager', 'cashier', 'supervisor', 'assistant_manager']);
    return store.openShift(user.id, float);
  }));
  ipcMain.handle('shifts:close', wrapSync((id, data, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager', 'cashier', 'supervisor', 'assistant_manager']);
    return store.closeShift(id, data, user.id);
  }));
  ipcMain.handle('shifts:closePreview', wrapSync((id, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager', 'cashier', 'supervisor', 'assistant_manager']);
    return store.getShiftClosePreview(id, user.id);
  }));
  ipcMain.handle('shifts:get', wrapSync((limit) => store.getShifts(limit)));
  ipcMain.handle('shifts:getOpenAll', wrapSync((actor) => {
    store.requireActor(actor, ['owner', 'manager']);
    return store.getAnyOpenShifts();
  }));
  ipcMain.handle('shifts:forceClose', wrapSync((id, data, actor) => store.adminForceCloseShift(id, data || {}, actor)));
  ipcMain.handle('shifts:update', wrapSync((id, data, actor) => store.updateShiftRecord(id, data || {}, actor)));
  ipcMain.handle('shifts:delete', wrapSync((id, actor) => store.deleteShiftRecord(id, actor)));
  ipcMain.handle('shifts:current', wrapSync((actor) => {
    const user = store.requireActor(actor, ['owner', 'manager', 'cashier', 'supervisor', 'assistant_manager']);
    return store.getOpenShift(user.id);
  }));
  ipcMain.handle('shifts:cashDrop', wrapSync((data, actor) => store.recordCashDrop(data, actor)));
  ipcMain.handle('shifts:cashDrops', wrapSync((filters) => store.getCashDrops(filters || {})));
  ipcMain.handle('shifts:confirmCashDrop', wrapSync((id, actor) => store.confirmCashDrop(id, actor)));
  ipcMain.handle('settings:getSalesTargets', wrapSync(() => store.getSalesTargets()));
  ipcMain.handle('settings:saveSalesTargets', wrapSync((data, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager']);
    return store.saveSalesTargets(data, user.id, user.username || user.full_name);
  }));
  ipcMain.handle('settings:getTodayTargetProgress', wrapSync((branchId) => store.getTodayTargetProgress(branchId)));
  ipcMain.handle('settings:getSalesTargetHistory', wrapSync((opts) => store.getSalesTargetHistory(opts || {})));
  ipcMain.handle('settings:getSalesTargetInsights', wrapSync((opts) => store.getSalesTargetInsights(opts || {})));
  ipcMain.handle('settings:saveSalesTargetAlertSettings', wrapSync((alerts, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager']);
    return store.saveSalesTargetAlertSettings(alerts, user.id, user.username || user.full_name);
  }));
  ipcMain.handle('settings:saveSalesTargetDayNote', wrapSync((payload, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager']);
    return store.saveSalesTargetDayNote(payload, user.id, user.username || user.full_name);
  }));
  ipcMain.handle('settings:getShiftSettings', wrapSync(() => store.getShiftSettings()));
  ipcMain.handle('settings:enforceCashoutDeadlines', wrapSync(() => store.enforceShiftCashoutDeadlines()));
  ipcMain.handle('settings:saveShiftSettings', wrapSync((data, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager']);
    return store.saveShiftSettings(data, user.id, user.username || user.full_name);
  }));
  ipcMain.handle('reports:sales', wrap((from, to) => { requireSession(); return store.getSalesReport(from, to); }));
  ipcMain.handle('reports:profit', wrap((from, to) => { requireSession(); return store.getProfitReport(from, to); }));
  ipcMain.handle('reports:cashier', wrap((from, to, userId) => { requireSession(); return store.getCashierReport(from, to, userId); }));
  ipcMain.handle('reports:cashierDetail', wrap((from, to, userId) => { requireSession(); return store.getCashierSalesDetail(from, to, userId); }));
  ipcMain.handle('reports:product', wrap((from, to) => { requireSession(); return store.getProductReport(from, to); }));
  ipcMain.handle('reports:stock', wrap(() => { requireSession(); return store.getStockReport(); }));
  ipcMain.handle('reports:expenses', wrap((from, to) => { requireSession(); return store.getExpenses({ from, to }); }));

  // Audit & Notifications
  ipcMain.handle('audit:get', wrap((filters) => {
    requireSession();
    return store.getAuditLog(typeof filters === 'object' ? filters : { limit: filters || 200 });
  }));
  ipcMain.handle('notifications:get', wrapSync((actor) => {
    const sess = store.getUserSession();
    const role = actor?.role || sess?.role || null;
    return store.getNotifications(role);
  }));
  ipcMain.handle('notifications:read', wrap((id) => { store.markNotificationRead(id); return true; }));
  ipcMain.handle('notifications:readAll', wrapSync((actor) => {
    const sess = store.getUserSession();
    const role = actor?.role || sess?.role || null;
    return store.markAllNotificationsRead(role || actor || sess);
  }));
  ipcMain.handle('notifications:createTest', wrap(() => {
    store.requireActor(store.getUserSession(), ['owner', 'manager']);
    return store.createTestNotification();
  }));
  ipcMain.handle('notifications:refreshPaymentDue', wrap(() => store.refreshPaymentDueNotifications()));
  ipcMain.handle('notifications:ensureDemoSound', wrap(() => {
    ensureDemoNotificationSound();
    return store.getSettingsParsed()?.notification_settings || {};
  }));
  ipcMain.handle('notifications:ackEvent', wrap((_e, panel, eventKey, meta) => {
    const na = require('./electron/services/notification-acks');
    const sess = store.getUserSession?.();
    return na.ackEvent(panel, eventKey, { ...(meta || {}), user_id: meta?.user_id || sess?.id });
  }));
  ipcMain.handle('notifications:ackEvents', wrap((_e, panel, keys, meta) => {
    const na = require('./electron/services/notification-acks');
    const sess = store.getUserSession?.();
    return na.ackEvents(panel, keys || [], { ...(meta || {}), user_id: meta?.user_id || sess?.id });
  }));
  ipcMain.handle('notifications:listAcked', wrap((_e, panel, limit) => {
    const na = require('./electron/services/notification-acks');
    return na.listAckedKeys(panel, limit || 500);
  }));

  // Search
  ipcMain.handle('search:global', wrap((q) => store.globalSearch(q)));

  // Backup & Restore
  ipcMain.handle('backup:create', async (_e, actor) => {
    try {
      store.requireActor(actor, ['owner']);
      const dbPath = getDbPathForBackup();
      const { filePath } = await dialog.showSaveDialog(mainWindow, {
        title: 'Save Backup',
        defaultPath: `shop-pos-backup-${new Date().toISOString().slice(0, 10)}.db`,
        filters: [{ name: 'Database', extensions: ['db'] }]
      });
      if (!filePath) return { success: false, cancelled: true };
      fs.copyFileSync(dbPath, filePath);
      store.saveSettings({ last_backup: new Date().toISOString() }, null, 'system');
      return { success: true, path: filePath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('backup:restore', async (_e, actor) => {
    store.requireActor(actor, ['owner']);
    const { filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Restore Backup',
      filters: [{ name: 'Database', extensions: ['db'] }],
      properties: ['openFile']
    });
    if (!filePaths?.length) return { success: false, cancelled: true };
    await validateDatabaseFile(filePaths[0]);
    closeDatabase();
    fs.copyFileSync(filePaths[0], getDbPathForBackup());
    await initDatabase();
    return { success: true };
  });

  ipcMain.handle('backup:restoreSetup', async () => {
    try {
      const info = store.detectExistingBusiness();
      if (info?.exists || info?.setup_complete) {
        return {
          success: false,
          error: 'This device already has shop data. Sign in as owner and use Admin → Backup & Restore.'
        };
      }
      const { filePaths } = await dialog.showOpenDialog(mainWindow, {
        title: 'Restore Shop Database',
        filters: [{ name: 'Database', extensions: ['db'] }],
        properties: ['openFile']
      });
      if (!filePaths?.length) return { success: false, cancelled: true };
      await validateDatabaseFile(filePaths[0]);
      closeDatabase();
      fs.copyFileSync(filePaths[0], getDbPathForBackup());
      await initDatabase();
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle('backup:export', async (_e, actor) => {
    try {
      store.requireActor(actor, ['owner']);
      const dbPath = getDbPathForBackup();
      const { filePath } = await dialog.showSaveDialog(mainWindow, {
        title: 'Export Database',
        defaultPath: 'shop-pos-export.db',
        filters: [{ name: 'Database', extensions: ['db'] }]
      });
      if (!filePath) return { success: false, cancelled: true };
      fs.copyFileSync(dbPath, filePath);
      return { success: true, path: filePath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('backup:getInfo', wrapF(() => {
    const settings = store.getSettings();
    const parsed = store.getSettingsParsed();
    return {
      folder: path.dirname(getDbPathForBackup()),
      last_backup: settings?.last_backup || null,
      auto_backup: !!parsed?.backup_settings?.auto_backup,
      last_auto_date: null
    };
  }));

  // Print receipt / kitchen / A4 — device settings override global admin defaults
  ipcMain.handle('deviceSettings:get', wrapSync(() => deviceSettings.load()));
  ipcMain.handle('deviceSettings:save', wrapSync((data) => deviceSettings.save(data)));

  ipcMain.handle('print:receipt', async (_e, html, options = {}) => {
    try {
      const settings = store.getSettingsParsed();
      const localDevice = deviceSettings.load();
      const cfg = printService.mergePrintSettings(settings, options, localDevice);
      const deviceName = options.useInvoice ? cfg.invoicePrinter : cfg.receiptPrinter;
      await printService.printHtml(html, {
        deviceName,
        silent: cfg.silent,
        copies: cfg.copies,
        paperSize: options.useInvoice ? 'A4' : cfg.paperSize,
        printDuplicate: cfg.printDuplicate
      });
      return { success: true, printer: deviceName, paperSize: options.useInvoice ? 'A4' : cfg.paperSize };
    } catch (err) {
      return { success: false, error: err.message, offline: true };
    }
  });

  ipcMain.handle('print:kitchen', async (_e, html, options = {}) => {
    try {
      const settings = store.getSettingsParsed();
      const localDevice = deviceSettings.load();
      const cfg = printService.mergePrintSettings(settings, options, localDevice);
      const deviceName = cfg.kitchenPrinter;
      if (!deviceName) throw new Error('No kitchen printer configured for this computer');
      await printService.printHtml(html, {
        deviceName,
        silent: true,
        copies: 1,
        paperSize: cfg.paperSize === '58mm' ? '58mm' : '80mm'
      });
      return { success: true, printer: deviceName };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('print:a4', async (_e, html, opts = {}) => {
    try {
      const settings = store.getSettingsParsed();
      const localDevice = deviceSettings.load();
      const cfg = printService.mergePrintSettings(settings, opts || {}, localDevice);
      if (cfg.invoicePrinter) {
        await printService.printHtml(html, {
          deviceName: cfg.invoicePrinter,
          silent: opts?.silent ?? cfg.silent,
          copies: 1,
          paperSize: 'A4'
        });
        return { success: true, printer: cfg.invoicePrinter };
      }
      await printService.openPreviewWindow(html, 'A4 Print');
      return { success: true, printer: 'Print preview', fallback: true };
    } catch (err) {
      try {
        await printService.openPreviewWindow(html, 'A4 Print');
        return { success: true, printer: 'Print preview', fallback: true };
      } catch (_) {
        return { success: false, error: err.message };
      }
    }
  });

  ipcMain.handle('print:htmlToPdf', async (_e, html, opts = {}) => {
    try {
      const pdf = await printService.htmlToPdf(html, opts || {});
      return { success: true, data: pdf };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('printers:status', async (_e, names = {}) => {
    const printers = await printService.getPrintersFromWindow(mainWindow);
    return {
      receipt: printService.printerStatus(names.receipt, printers),
      kitchen: printService.printerStatus(names.kitchen, printers),
      invoice: printService.printerStatus(names.invoice, printers)
    };
  });

  ipcMain.handle('kitchen:openDisplay', async () => {
    printService.openKitchenDisplay(
      mainWindow,
      path.join(__dirname, 'preload.js'),
      path.join(__dirname, '../src/kitchen-display.html')
    );
    return { success: true };
  });

  ipcMain.handle('kitchen:closeDisplay', async () => {
    printService.closeKitchenDisplay();
    return { success: true };
  });

  ipcMain.handle('kitchen:refreshDisplay', async () => {
    printService.refreshKitchenDisplay();
    return { success: true };
  });

  ipcMain.handle('customer:openDisplay', async () => {
    printService.openCustomerDisplay(
      mainWindow,
      path.join(__dirname, 'preload.js'),
      path.join(__dirname, '../src/customer-display.html')
    );
    return { success: true };
  });

  ipcMain.handle('customer:closeDisplay', async () => {
    printService.closeCustomerDisplay();
    return { success: true };
  });

  ipcMain.handle('customer:refreshDisplay', async () => {
    printService.refreshCustomerDisplay();
    return { success: true };
  });

  ipcMain.handle('export:excel', async (_e, filename, sheets) => {
    const buf = buildExcelBuffer(sheets);
    const { filePath } = await dialog.showSaveDialog(mainWindow, {
      defaultPath: filename,
      filters: [{ name: 'Excel', extensions: ['xlsx'] }]
    });
    if (!filePath) return { success: false, cancelled: true };
    fs.writeFileSync(filePath, buf);
    shell.showItemInFolder(filePath);
    return { success: true, path: filePath };
  });

  ipcMain.handle('export:pdf', async (_e, filename, title, headers, rows, company) => {
    const buf = buildPdfBuffer(title, headers, rows, company || {});
    const { filePath } = await dialog.showSaveDialog(mainWindow, {
      defaultPath: filename,
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    });
    if (!filePath) return { success: false, cancelled: true };
    fs.writeFileSync(filePath, buf);
    shell.showItemInFolder(filePath);
    return { success: true, path: filePath };
  });

  ipcMain.handle('export:print', async (_e, title, headers, rows, company) => {
    const buf = buildPdfBuffer(title, headers, rows, company || {});
    const settings = store.getSettingsParsed();
    const localDevice = deviceSettings.load();
    const cfg = printService.mergePrintSettings(settings, {}, localDevice);
    const invoicePrinter = cfg.invoicePrinter || '';
    try {
      return await printService.printPdfBuffer(buf, `report-${Date.now()}.pdf`, {
        deviceName: invoicePrinter || undefined,
        silent: !!invoicePrinter && cfg.silent !== false
      });
    } catch (err) {
      const tmpPath = path.join(app.getPath('temp'), `report-${Date.now()}.pdf`);
      fs.writeFileSync(tmpPath, buf);
      await shell.openPath(tmpPath);
      return { success: true, fallback: true, error: err.message };
    }
  });

  ipcMain.handle('file:openPdf', async (_e, buffer, filename) => {
    const tmpPath = path.join(app.getPath('temp'), filename || `doc-${Date.now()}.pdf`);
    fs.writeFileSync(tmpPath, Buffer.from(buffer));
    await shell.openPath(tmpPath);
    return { success: true, path: tmpPath };
  });

  ipcMain.handle('file:printPdf', async (_e, buffer, filename) => {
    const settings = store.getSettingsParsed();
    const localDevice = deviceSettings.load();
    const cfg = printService.mergePrintSettings(settings, {}, localDevice);
    const invoicePrinter = cfg.invoicePrinter || '';
    try {
      return await printService.printPdfBuffer(buffer, filename || `doc-${Date.now()}.pdf`, {
        deviceName: invoicePrinter || undefined,
        silent: !!invoicePrinter && cfg.silent !== false
      });
    } catch (err) {
      // Fallback: open in system PDF viewer so the user can still print
      try {
        const tmpPath = path.join(app.getPath('temp'), filename || `doc-${Date.now()}.pdf`);
        fs.writeFileSync(tmpPath, Buffer.from(buffer));
        await shell.openPath(tmpPath);
        return { success: true, path: tmpPath, fallback: true };
      } catch (err2) {
        return { success: false, error: err.message || err2.message };
      }
    }
  });

  ipcMain.handle('printers:list', async () => {
    if (!mainWindow) return [];
    const printers = await printService.getPrintersFromWindow(mainWindow);
    return printService.enrichPrinters(printers);
  });

  ipcMain.handle('printers:listByConnection', async (_e, connection) => {
    if (!mainWindow) return [];
    const printers = await printService.getPrintersFromWindow(mainWindow);
    return printService.filterPrintersByConnection(printers, connection);
  });

  ipcMain.handle('printers:connect', async (_e, connection, options = {}) => {
    try {
      const result = await printService.connectPrinter(connection, options, mainWindow);
      return { success: true, data: result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('print:preview', async (_e, html, title) => {
    await printService.openPreviewWindow(html, title || 'Print Preview');
    return { success: true };
  });

  ipcMain.handle('print:openDrawer', async () => {
    try {
      const settings = store.getSettingsParsed();
      const localDevice = deviceSettings.load();
      const cfg = printService.mergePrintSettings(settings, {}, localDevice);
      if (!cfg.receiptPrinter) throw new Error('No receipt printer configured');
      const result = await printService.openCashDrawer(cfg.receiptPrinter);
      return { success: true, ...result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('print:barcode', async (_e, product) => {
    try {
      const settings = store.getSettingsParsed();
      const localDevice = deviceSettings.load();
      const result = await printService.printBarcodeLabel(product, settings, localDevice);
      return { success: true, ...result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Save file (for general exports from renderer)
  ipcMain.handle('file:save', async (_e, defaultName, filters, buffer) => {
    const { filePath } = await dialog.showSaveDialog(mainWindow, {
      defaultPath: defaultName,
      filters
    });
    if (!filePath) return { success: false, cancelled: true };
    fs.writeFileSync(filePath, Buffer.from(buffer));
    shell.showItemInFolder(filePath);
    return { success: true, path: filePath };
  });

  ipcMain.handle('file:selectDocument', async (_e, prefix = 'document') => {
    try {
      const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : BrowserWindow.getFocusedWindow();
      const { filePaths, canceled } = await dialog.showOpenDialog(win || undefined, {
        filters: [
          { name: 'Documents', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'webp'] }
        ],
        properties: ['openFile']
      });
      if (canceled || !filePaths?.length) return { success: false, cancelled: true };
      const destDir = path.join(path.dirname(getDbPathForBackup()), 'assets', 'document-hub');
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
      const ext = path.extname(filePaths[0]) || '.pdf';
      const dest = path.join(destDir, `${prefix}-${Date.now()}${ext}`);
      fs.copyFileSync(filePaths[0], dest);
      return { success: true, path: dest, is_image: ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext.toLowerCase()) };
    } catch (err) {
      return { success: false, error: err.message || 'Could not import document' };
    }
  });

  ipcMain.handle('file:persistMobileDocument', async (_e, filePath) => {
    return { success: true, path: filePath };
  });

  ipcMain.handle('file:openExternal', wrap(async (url) => {
    const href = String(url || '').trim();
    if (!/^https?:\/\//i.test(href) && !/^mailto:/i.test(href) && !/^tel:/i.test(href)) {
      throw new Error('Only http(s), mailto, and tel links can be opened');
    }
    await shell.openExternal(href);
    return true;
  }));

  ipcMain.handle('file:openPath', async (_e, filePath) => {
    try {
      const safePath = assertSafeAppPath(filePath);
      await shell.openPath(safePath);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('file:copyImageToClipboard', async (_e, filePath) => {
    try {
      const safePath = assertSafeAppPath(filePath);
      // Prefer file-on-clipboard so WhatsApp Desktop pastes as an attachment (not just a bitmap)
      if (process.platform === 'win32') {
        try {
          const { execFile } = require('child_process');
          const { promisify } = require('util');
          const execFileAsync = promisify(execFile);
          await execFileAsync('powershell.exe', [
            '-NoProfile', '-NonInteractive', '-Command',
            'Set-Clipboard -Path $env:SHOPPOS_CLIP_PATH'
          ], { windowsHide: true, timeout: 8000, env: { ...process.env, SHOPPOS_CLIP_PATH: safePath } });
          return { success: true, mode: 'file' };
        } catch (_) { /* fall through to image clipboard */ }
      }
      const { nativeImage, clipboard } = require('electron');
      const img = nativeImage.createFromPath(safePath);
      if (img.isEmpty()) return { success: false, error: 'Could not read image' };
      clipboard.writeImage(img);
      return { success: true, mode: 'image' };
    } catch (err) {
      return { success: false, error: err.message || 'Clipboard failed' };
    }
  });

  ipcMain.handle('file:shareNative', async (_e, filePath, title) => {
    try {
      const safePath = assertSafeAppPath(filePath);
      // Put file on clipboard first (WhatsApp paste), then reveal/open for drag-drop fallback
      if (process.platform === 'win32') {
        try {
          const { execFile } = require('child_process');
          const { promisify } = require('util');
          const execFileAsync = promisify(execFile);
          await execFileAsync('powershell.exe', [
            '-NoProfile', '-NonInteractive', '-Command',
            'Set-Clipboard -Path $env:SHOPPOS_CLIP_PATH'
          ], { windowsHide: true, timeout: 8000, env: { ...process.env, SHOPPOS_CLIP_PATH: safePath } });
        } catch (_) {}
        shell.showItemInFolder(safePath);
      }
      await shell.openPath(safePath);
      return { success: true, path: safePath, title: title || path.basename(safePath) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('file:selectImage', async (_e, prefix = 'image') => {
    try {
      const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
        properties: ['openFile']
      });
      if (canceled || !filePaths?.length) return { success: false, cancelled: true };
      const destDir = path.join(path.dirname(getDbPathForBackup()), 'assets');
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
      const ext = path.extname(filePaths[0]) || '.jpg';
      const dest = path.join(destDir, `${prefix}-${Date.now()}${ext}`);
      fs.copyFileSync(filePaths[0], dest);
      return { success: true, path: dest };
    } catch (err) {
      return { success: false, error: err.message || 'Could not save image' };
    }
  });

  ipcMain.handle('file:getImageDataUrl', async (_e, filePath) => {
    try {
      const safePath = assertSafeAppPath(filePath);
      const ext = path.extname(safePath).toLowerCase();
      const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }[ext] || 'image/jpeg';
      const data = await fs.promises.readFile(safePath);
      const dataUrl = `data:${mime};base64,${data.toString('base64')}`;
      return { success: true, dataUrl, data: dataUrl };
    } catch (err) {
      return { success: false, error: err.message || 'Could not read image' };
    }
  });

  ipcMain.handle('file:selectAudio', async (_e, prefix = 'notification') => {
    try {
      const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
        filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'ogg', 'm4a'] }],
        properties: ['openFile']
      });
      if (canceled || !filePaths?.length) return { success: false, cancelled: true };
      const destDir = path.join(path.dirname(getDbPathForBackup()), 'assets', 'sounds');
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
      const ext = path.extname(filePaths[0]) || '.wav';
      const dest = path.join(destDir, `${prefix}-${Date.now()}${ext}`);
      fs.copyFileSync(filePaths[0], dest);
      return { success: true, path: dest };
    } catch (err) {
      return { success: false, error: err.message || 'Could not save audio' };
    }
  });

  ipcMain.handle('file:getAudioDataUrl', async (_e, filePath) => {
    try {
      const safePath = assertSafeAppPath(filePath);
      const ext = path.extname(safePath).toLowerCase();
      const mime = { '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4' }[ext] || 'audio/wav';
      const data = fs.readFileSync(safePath);
      return { success: true, dataUrl: `data:${mime};base64,${data.toString('base64')}` };
    } catch (err) {
      return { success: false, error: err.message || 'Could not read audio' };
    }
  });

  // Database manager
  ipcMain.handle('db:health', wrapF(() => { requireSession(); return store.getDatabaseHealth(); }));
  ipcMain.handle('db:storageMonitor', wrap(async (opts, actor) => {
    const a = actor || store.getUserSession();
    store.requireActor(a, ['owner', 'manager', 'assistant_manager']);
    const storage = require('./services/system-storage');
    storage.ensureSchema();
    return storage.getStorageMonitor(opts || {});
  }));
  ipcMain.handle('db:storageSnapshot', wrap(async (actor) => {
    const a = actor || store.getUserSession();
    store.requireActor(a, ['owner', 'manager', 'assistant_manager']);
    const storage = require('./services/system-storage');
    return storage.recordStorageSnapshot();
  }));
  ipcMain.handle('db:optimize', wrapF((actor) => {
    store.requireActor(actor || store.getUserSession(), ['owner']);
    return store.optimizeDatabase();
  }));
  ipcMain.handle('db:repair', wrapF((actor) => {
    store.requireActor(actor || store.getUserSession(), ['owner']);
    return store.repairDatabase();
  }));
  ipcMain.handle('db:resetDemo', wrapF((actor) => {
    const user = store.requireActor(actor, ['owner']);
    return store.resetDemoData(user.id, user.username);
  }));
  ipcMain.handle('db:archive', wrapF((days, actor) => {
    store.requireActor(actor || store.getUserSession(), ['owner']);
    return store.archiveOldRecords(days);
  }));
  ipcMain.handle('db:recalcStock', wrapF((actor) => {
    store.requireActor(actor || store.getUserSession(), ['owner']);
    return store.recalculateStock();
  }));
  ipcMain.handle('db:logs', wrapF((limit) => { requireSession(); return store.getSystemLogs(limit); }));
  // Quotes
  ipcMain.handle('quotes:get', wrapF((f) => store.getQuotes(f)));
  ipcMain.handle('quotes:getOne', wrapF((id) => store.getQuote(id)));
  ipcMain.handle('quotes:save', wrapF((data, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager', 'cashier', 'supervisor', 'assistant_manager']);
    return store.saveQuote(data, user.id);
  }));
  ipcMain.handle('quotes:convert', wrapF((id, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager', 'cashier', 'supervisor', 'assistant_manager']);
    return store.convertQuoteToSale(id, user.id, user.full_name);
  }));
  ipcMain.handle('quotes:delete', wrapF((id, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager']);
    return store.deleteQuote(id, user.id, user.username);
  }));
  ipcMain.handle('quotes:markConverted', wrapF((id, saleId, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager', 'cashier', 'supervisor', 'assistant_manager']);
    return store.markQuoteConverted(id, saleId, user.id, user.full_name || user.username);
  }));
  ipcMain.handle('quotes:reactivate', wrapF((id, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager']);
    return store.reactivateQuote(id, user.id, user.full_name || user.username);
  }));
  ipcMain.handle('quotes:pdf', wrapF((id) => {
    const s = store.getSettings();
    return store.buildQuotePdf(id, s);
  }));
  // Lay-bye
  ipcMain.handle('layby:get', wrapF((f) => { requireSession(); return store.getLaybyes(f); }));
  ipcMain.handle('layby:getOne', wrapF((id) => store.getLayby(id)));
  ipcMain.handle('layby:getSettings', wrapF((actor) => {
    store.requireActor(actor || store.getUserSession(), ['owner', 'manager', 'assistant_manager', 'supervisor', 'cashier']);
    return store.getLaybySettings();
  }));
  ipcMain.handle('layby:saveSettings', wrapF((data, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager']);
    return store.saveLaybySettings(data, user.id, user.username);
  }));
  ipcMain.handle('layby:refund', wrapF((id, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager', 'assistant_manager', 'supervisor']);
    return store.refundLayby(id, user.id, user.username);
  }));
  ipcMain.handle('layby:create', wrapF((data, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager', 'cashier', 'supervisor', 'assistant_manager']);
    return store.createLayby(data, user.id);
  }));
  ipcMain.handle('layby:pay', wrapF((id, amount, type, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager', 'cashier', 'supervisor', 'assistant_manager']);
    return store.addLaybyPayment(id, amount, type, user.id);
  }));
  ipcMain.handle('taken:list', wrapF((filters, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager', 'cashier', 'supervisor', 'assistant_manager']);
    return require('./services/taken-orders').listTakenOrders(filters || {}, user);
  }));
  ipcMain.handle('taken:summary', wrapF((actor) => {
    const user = store.requireActor(actor, ['owner', 'manager', 'assistant_manager', 'supervisor']);
    return require('./services/taken-orders').getAdminSummary(user);
  }));
  ipcMain.handle('taken:pay', wrapF((id, data, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager', 'cashier', 'supervisor', 'assistant_manager']);
    return require('./services/taken-orders').payTakenOrder(id, data || {}, user);
  }));
  // Gift cards
  ipcMain.handle('giftcards:get', wrapF((s) => { requireSession(); return store.getGiftCards(s); }));
  ipcMain.handle('giftcards:create', wrapF((data, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager', 'supervisor', 'assistant_manager']);
    return store.createGiftCard(data, user.id, user.username);
  }));
  ipcMain.handle('giftcards:update', wrapF((id, data, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager']);
    return store.updateGiftCard(id, data, user);
  }));
  ipcMain.handle('giftcards:delete', wrapF((id, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager']);
    return store.deleteGiftCard(id, user);
  }));
  ipcMain.handle('giftcards:check', wrapF((code) => store.checkGiftCardBalance(code)));
  ipcMain.handle('giftcards:approve', wrapF((id, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager', 'assistant_manager', 'supervisor']);
    return store.approveGiftCard(id, user.id, user.username);
  }));
  ipcMain.handle('giftcards:reject', wrapF((id, notes, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager', 'assistant_manager', 'supervisor']);
    return store.rejectGiftCard(id, user.id, user.username, notes);
  }));
  // Discount vouchers (Stock Discount → POS / Online / Kiosk)
  ipcMain.handle('vouchers:list', wrapF((filters) => {
    requireSession();
    return require('./services/discount-vouchers').listVouchers(filters || {});
  }));
  ipcMain.handle('vouchers:create', wrapF((data, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager']);
    return require('./services/discount-vouchers').createVoucher(data || {}, user);
  }));
  ipcMain.handle('vouchers:validate', wrapF((code, opts) =>
    require('./services/discount-vouchers').validateVoucher(code, opts || {})));
  ipcMain.handle('vouchers:redeem', wrapF((code, opts, actor) => {
    const user = actor ? store.requireActor(actor, ['owner', 'manager', 'cashier', 'assistant_manager', 'supervisor']) : null;
    return require('./services/discount-vouchers').redeemVoucher(code, {
      ...(opts || {}),
      actorId: user?.id,
      actorName: user?.full_name || user?.username
    });
  }));
  ipcMain.handle('giftcards:getSettings', wrapF((actor) => {
    store.requireActor(actor || store.getUserSession(), ['owner', 'manager', 'assistant_manager', 'supervisor']);
    return store.getGiftCardSettings();
  }));
  ipcMain.handle('giftcards:saveSettings', wrapF((data, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager']);
    return store.saveGiftCardSettings(data, user.id, user.username);
  }));
  // Loyalty & credit
  ipcMain.handle('loyalty:history', wrapF((id) => store.getLoyaltyHistory(id)));
  ipcMain.handle('loyalty:syncMissing', wrapF((actor) => {
    store.requireActor(actor, ['owner', 'manager']);
    return store.syncMissingLoyaltyPoints({ limit: 2000 });
  }));
  ipcMain.handle('loyalty:listRestorable', wrapF((opts, actor) => {
    store.requireActor(actor, ['owner']);
    return store.listRestorableExpiredPoints(opts || {});
  }));
  ipcMain.handle('loyalty:restoreExpired', wrapF((expireTxnId, actor) => {
    const user = store.requireActor(actor, ['owner']);
    return store.restoreExpiredLoyaltyPoints(expireTxnId, user.username || user.name || 'owner');
  }));
  ipcMain.handle('loyalty:adjust', wrapF((customerId, pointsDelta, notes, actor) => store.adjustLoyaltyPoints(customerId, pointsDelta, notes, actor?.id)));
  ipcMain.handle('loyalty:pointsSummary', wrapF((id) => store.getCustomerPointsSummary(id)));
  ipcMain.handle('loyalty:reminders', wrapF(() => store.listLoyaltyReminders()));
  ipcMain.handle('loyalty:reminderWhatsApp', wrapF((customerId, lotId) => store.getLoyaltyReminderWhatsApp(customerId, lotId)));
  ipcMain.handle('loyalty:markReminderSent', wrapF((lotId, actor) => {
    store.requireActor(actor, ['owner', 'manager', 'supervisor', 'assistant_manager']);
    return store.markLoyaltyReminderSent(lotId);
  }));
  ipcMain.handle('credit:ledger', wrapF((id) => { requireSession(); return store.getCustomerCreditLedger(id); }));
  ipcMain.handle('credit:pay', wrapF((id, amount, notes, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager', 'cashier', 'supervisor', 'assistant_manager']);
    return store.addCustomerCreditPayment(id, amount, notes, user.id);
  }));
  // Stock count & waste
  ipcMain.handle('stockcount:get', wrapF(() => store.getStockCounts()));
  ipcMain.handle('stockcount:getOne', wrapF((id) => store.getStockCount(id)));
  ipcMain.handle('stockcount:create', wrapF((notes, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager', 'supervisor', 'assistant_manager']);
    return store.createStockCount(user.id, notes);
  }));
  ipcMain.handle('stockcount:updateLine', wrapF((lineId, qty, actor) => {
    store.requireActor(actor || store.getUserSession(), ['owner', 'manager', 'supervisor', 'assistant_manager']);
    return store.updateStockCountLine(lineId, qty);
  }));
  ipcMain.handle('stockcount:complete', wrapF((id, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager', 'supervisor', 'assistant_manager']);
    return store.completeStockCount(id, user.id);
  }));
  ipcMain.handle('waste:get', wrapF((from, to, filters) => { requireSession(); return store.getWasteRecords(from, to, filters || {}); }));
  ipcMain.handle('waste:record', wrapF((data, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager', 'supervisor', 'assistant_manager', 'cashier']);
    return store.recordWaste(data, user.id);
  }));
  ipcMain.handle('waste:approve', wrapF((id, notes, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager', 'assistant_manager', 'supervisor']);
    return store.approveWaste(id, user.id, notes);
  }));
  ipcMain.handle('waste:reject', wrapF((id, notes, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager', 'assistant_manager', 'supervisor']);
    return store.rejectWaste(id, user.id, notes);
  }));
  ipcMain.handle('waste:returnStock', wrapF((id, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager', 'assistant_manager', 'supervisor']);
    return store.returnWasteToStock(id, user.id);
  }));
  // Cash-up
  ipcMain.handle('cashup:get', wrapF((limitOrFilters) => { requireSession(); return store.getCashUps(limitOrFilters); }));
  ipcMain.handle('cashup:getOne', wrapF((id) => { requireSession(); return store.getCashUp(id); }));
  ipcMain.handle('cashup:byShift', wrapF((shiftId) => { requireSession(); return store.getCashUpByShift(shiftId); }));
  ipcMain.handle('cashup:create', wrapF((shiftId, data, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager', 'cashier', 'supervisor', 'assistant_manager']);
    // Always save pending — managers approve separately
    return store.createCashUp(shiftId, { ...data, manager_approved: false, force_pending: true }, user.id);
  }));
  ipcMain.handle('cashup:approve', wrapF((id, notes, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager', 'assistant_manager', 'supervisor']);
    return store.approveCashUp(id, user.id, notes);
  }));
  ipcMain.handle('cashup:update', wrapF((id, data, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager', 'assistant_manager']);
    return store.updateCashUp(id, data || {}, user.id);
  }));
  ipcMain.handle('cashup:delete', wrapF((id, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager', 'assistant_manager']);
    return store.deleteCashUp(id, user.id);
  }));
  ipcMain.handle('cashup:summary', wrapF((from, to) => { requireSession(); return store.getCashUpSummary(from, to); }));
  ipcMain.handle('cashup:pdf', wrapF((id) => {
    requireSession();
    const st = store.getSettingsParsed();
    return store.buildCashUpPdf(id, st.shop_name, st.currency || 'R');
  }));
  // Automation & custom fields
  ipcMain.handle('automation:get', wrapF(() => store.getAutomationRules()));
  ipcMain.handle('automation:save', wrapF((data, actor) => {
    store.requireActor(actor || store.getUserSession(), ['owner', 'manager']);
    return store.saveAutomationRule(data);
  }));
  ipcMain.handle('automation:delete', wrapF((id, actor) => {
    store.requireActor(actor || store.getUserSession(), ['owner', 'manager']);
    return store.deleteAutomationRule(id);
  }));
  ipcMain.handle('customfields:get', wrapF((type) => store.getCustomFields(type)));
  ipcMain.handle('customfields:save', wrapF((data, actor) => {
    store.requireActor(actor || store.getUserSession(), ['owner', 'manager']);
    return store.saveCustomField(data);
  }));
  ipcMain.handle('customfields:delete', wrapF((id, actor) => {
    store.requireActor(actor || store.getUserSession(), ['owner', 'manager']);
    return store.deleteCustomField(id);
  }));
  ipcMain.handle('customfields:values', wrapF((type, entityId) => store.getCustomFieldValues(type, entityId)));
  ipcMain.handle('customfields:saveValues', wrapF((type, entityId, values, actor) => {
    store.requireActor(actor || store.getUserSession(), ['owner', 'manager', 'assistant_manager']);
    return store.saveCustomFieldValues(type, entityId, values);
  }));
  // Restaurant
  ipcMain.handle('tables:get', wrapF(() => store.getTables()));
  ipcMain.handle('tables:save', wrapF((data, actor) => {
    // Cashiers may mark tables available after sit-in; create/edit still via Restaurant
    store.requireActor(actor || store.getUserSession(), [
      'owner', 'manager', 'assistant_manager', 'supervisor', 'cashier'
    ]);
    return store.saveTable(data);
  }));
  ipcMain.handle('tables:release', wrapF((tableId, actor) => {
    store.requireActor(actor || store.getUserSession(), [
      'owner', 'manager', 'assistant_manager', 'supervisor', 'cashier'
    ]);
    return store.releaseRestaurantTable(tableId);
  }));
  ipcMain.handle('tables:delete', wrapF((id, actor) => {
    store.requireActor(actor || store.getUserSession(), ['owner', 'manager']);
    store.deleteTable(id);
    return true;
  }));
  ipcMain.handle('reports:orderTypes', wrapF((from, to) => { requireSession(); return store.getOrderTypeReport(from, to); }));
  ipcMain.handle('store:runStartupTasks', wrapF(() => store.runStartupTasks()));
  ipcMain.handle('employeeOfMonth:getScores', wrapF((monthYear, actor) => {
    store.requireActor(actor, ['owner', 'manager', 'supervisor']);
    return store.getScores(monthYear);
  }));
  ipcMain.handle('employeeOfMonth:getRecord', wrapF((monthYear, actor) => {
    store.requireActor(actor, ['owner', 'manager', 'supervisor']);
    return store.getRecord(monthYear);
  }));
  ipcMain.handle('employeeOfMonth:save', wrapF((data, actor) => store.saveRecord(data, actor)));
  ipcMain.handle('employeeOfMonth:certificate', wrapF((monthYear, actor) => store.generateCertificate(monthYear, actor)));
  ipcMain.handle('employeeOfMonth:notifyWhatsApp', wrapF((monthYear, actor) => store.notifyWhatsApp(monthYear, actor)));
  ipcMain.handle('employeeOfMonth:sendCertificateWhatsApp', wrapF((employeeId, actor) => store.sendSelfCertificateWhatsApp(employeeId, actor)));
  ipcMain.handle('employeeOfMonth:getHistory', wrapF((filters, actor) => {
    store.requireActor(actor, ['owner', 'manager', 'supervisor']);
    return store.getAllRecords(filters || {});
  }));
  ipcMain.handle('employeeOfMonth:delete', wrapF((id, actor) => store.deleteRecord(id, actor)));
  ipcMain.handle('settings:saveKdsSound', wrapF((soundPath, actor) => {
    store.requireActor(actor, ['owner', 'manager']);
    return store.saveKdsNotificationSound(soundPath, actor.id, actor.username);
  }));
  ipcMain.handle('kitchen:get', wrapF((status) => store.getKitchenOrders(status)));
  ipcMain.handle('kitchen:status', wrapF((id, status, actor) => {
    store.requireActor(actor || store.getUserSession(), ['owner', 'manager', 'cashier', 'supervisor', 'assistant_manager']);
    return store.updateKitchenOrderStatus(id, status);
  }));
  ipcMain.handle('kitchen:create', wrapF((data, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager', 'cashier', 'supervisor', 'assistant_manager']);
    return store.createKitchenOrder(data, user.id);
  }));
  // Extended reports
  ipcMain.handle('reports:hourly', wrapF((from, to) => { requireSession(); return store.getHourlySalesReport(from, to); }));
  ipcMain.handle('reports:category', wrapF((from, to) => { requireSession(); return store.getCategorySalesReport(from, to); }));
  ipcMain.handle('reports:brand', wrapF((from, to) => { requireSession(); return store.getBrandSalesReport(from, to); }));
  ipcMain.handle('reports:payments', wrapF((from, to) => { requireSession(); return store.getPaymentMethodReport(from, to); }));
  ipcMain.handle('reports:employee', wrapF((from, to) => { requireSession(); return store.getEmployeePerformanceReport(from, to); }));
  ipcMain.handle('reports:discounts', wrapF((from, to) => { requireSession(); return store.getDiscountReport(from, to); }));
  ipcMain.handle('reports:voids', wrapF((from, to) => { requireSession(); return store.getVoidReport(from, to); }));
  ipcMain.handle('reports:movements', wrapF((from, to) => { requireSession(); return store.getStockMovementReport(from, to); }));
  ipcMain.handle('reports:profitDash', wrapF((from, to) => { requireSession(); return store.getProfitDashboard(from, to); }));
  ipcMain.handle('reports:giftcards', wrapF((from, to) => { requireSession(); return store.getGiftCardReport(from, to); }));
  ipcMain.handle('reports:layby', wrapF((from, to) => { requireSession(); return store.getLaybyReport(from, to); }));
  ipcMain.handle('reports:quotes', wrapF((from, to) => { requireSession(); return store.getQuotesReport(from, to); }));
  ipcMain.handle('reports:onaccount', wrapF((from, to) => { requireSession(); return store.getOnAccountReport(from, to); }));
  ipcMain.handle('reports:cashup', wrapF((from, to) => { requireSession(); return store.getCashUpReport(from, to); }));
  ipcMain.handle('operating:log', wrapSync((type, user) => store.logOperatingEvent(type, user)));
  ipcMain.handle('reports:operating', wrapF((from, to) => { requireSession(); return store.getOperatingLogReport(from, to); }));
  // Developer
  ipcMain.handle('dev:info', wrapF((actor) => {
    store.requireActor(actor, ['owner']);
    return store.getDeveloperInfo();
  }));
  ipcMain.handle('dev:activate', wrapF((key, actor) => {
    store.requireActor(actor, ['owner']);
    return store.activateLicense(key);
  }));
  ipcMain.handle('dev:resetTrial', wrapF((actor) => {
    store.requireActor(actor, ['owner']);
    return store.resetTrial();
  }));
  ipcMain.handle('po:receivePartial', wrapF((id, items, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager', 'supervisor', 'assistant_manager']);
    return store.receivePurchaseOrderPartial(id, items, user.id, user.username);
  }));
  ipcMain.handle('po:delete', wrapF((id, actor) => {
    const user = store.requireActor(actor, ['owner']);
    return store.deletePurchaseOrder(id, user.id, user.username);
  }));
  ipcMain.handle('po:update', wrapF((id, data, actor) => {
    const user = store.requireActor(actor, ['owner']);
    return store.updatePurchaseOrder(id, data, user.id, user.username);
  }));
  // Audit & sales management
  ipcMain.handle('audit:salesList', wrapF((f) => { requireSession(); return store.getUnifiedSalesList(f); }));
  ipcMain.handle('audit:searchSales', wrapF((f) => store.searchSalesExplorer(f)));
  ipcMain.handle('audit:voidSale', wrapF((id, reason, actor, supervisorCode) => {
    const user = store.requireActor(actor, ['owner', 'manager', 'cashier', 'supervisor', 'assistant_manager']);
    if (user.role === 'cashier') store.verifySupervisorCode(supervisorCode, 'void');
    return store.voidSale(id, reason, user.id, user.full_name);
  }));
  ipcMain.handle('audit:updateSale', wrapF((id, patch, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager']);
    return store.updateSaleRecord(id, patch || {}, user.id, user.full_name);
  }));
  ipcMain.handle('audit:deleteSale', wrapF((id, reason, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager']);
    if (user.role !== 'owner') {
      let perms = {};
      try { perms = JSON.parse(user.permissions || '{}'); } catch (_) { /* ignore */ }
      if (!perms.delete_sales) throw new Error('Permission denied — delete sales');
    }
    return store.deleteSaleRecord(id, reason, user.id, user.full_name);
  }));
  ipcMain.handle('audit:deleteSalesBulk', wrapF((ids, reason, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager']);
    if (user.role !== 'owner') {
      let perms = {};
      try { perms = JSON.parse(user.permissions || '{}'); } catch (_) { /* ignore */ }
      if (!perms.delete_sales) throw new Error('Permission denied — delete sales');
    }
    return store.deleteSalesBulk(ids, reason, user.id, user.full_name);
  }));
  ipcMain.handle('security:generateCode', wrapF((actor, purpose) => {
    const user = store.requireActor(actor, ['owner', 'manager']);
    return store.generateSupervisorCode(user.id, purpose || 'void');
  }));
  ipcMain.handle('security:getTodayCode', wrapF((actor, purpose) => {
    store.requireActor(actor, ['owner', 'manager']);
    return store.getTodaySupervisorCode(purpose || 'void');
  }));
  ipcMain.handle('security:verifyCode', wrapF((code, purpose) => store.verifySupervisorCode(code, purpose || 'void')));

  ipcMain.handle('settings:submitRequest', wrapF((data, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager', 'supervisor', 'assistant_manager', 'cashier']);
    return store.submitSettingsChangeRequest(data, user.id, user.full_name || user.username);
  }));
  ipcMain.handle('settings:getPendingRequests', wrapF(() => store.getPendingSettingsRequests()));
  ipcMain.handle('settings:getRequestHistory', wrapF((limit) => store.getSettingsRequestHistory(limit || 20)));
  ipcMain.handle('settings:approveRequest', wrapF((id, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager']);
    return store.approveSettingsRequest(id, user.id, user.full_name || user.username);
  }));
  ipcMain.handle('settings:rejectRequest', wrapF((id, notes, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager']);
    return store.rejectSettingsRequest(id, user.id, user.full_name || user.username, notes);
  }));
  ipcMain.handle('settings:updateRequest', wrapF((id, data, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager']);
    return store.updateSettingsRequest(id, data, user.id, user.full_name || user.username);
  }));
  ipcMain.handle('settings:deleteRequest', wrapF((id, actor) => {
    store.requireActor(actor, ['owner', 'manager']);
    return store.deleteSettingsRequest(id);
  }));
  ipcMain.handle('audit:soldProducts', wrapF((from, to) => store.getSoldProductsReport(from, to)));
  ipcMain.handle('audit:lowPerformance', wrapF((days) => store.getLowPerformanceProducts(days)));
  ipcMain.handle('audit:returnDetail', wrapF((id) => store.getReturnDetail(id)));
  ipcMain.handle('audit:returnsList', wrapF((f) => store.getReturnsList(f)));
  ipcMain.handle('audit:priceHistory', wrapF((limit) => store.getPriceChangeHistory(limit)));
  ipcMain.handle('audit:timeline', wrapF((from, to) => store.getActivityTimeline(from, to)));
  ipcMain.handle('audit:exceptions', wrapF((from, to) => store.getExceptionReport(from, to)));
  ipcMain.handle('audit:alerts', wrapF(() => store.getAdminAlerts()));
  ipcMain.handle('audit:dashboard', wrapF((from, to) => {
    try { require('./database/db').maybeReloadFromDisk?.(true); } catch (_) { /* ignore */ }
    const sess = store.getUserSession();
    const scope = store.resolveBranchScope(sess);
    const branchId = scope.allBranches ? null : scope.branchId;
    return store.getAdminDashboardFull(from, to, branchId);
  }));
  ipcMain.handle('audit:dailyClosing', wrapF((date) => store.getDailyClosingReport(date)));
  ipcMain.handle('audit:customerSummary', wrapF((id) => store.getCustomerPurchaseSummary(id)));
  ipcMain.handle('audit:topCustomers', wrapF((from, to, limit) => store.getTopCustomers(from, to, limit)));
  ipcMain.handle('audit:returnReasons', wrapF((from, to) => store.getReturnReasonsReport(from, to)));
  ipcMain.handle('audit:reopenReturn', wrapF((id, actor) => {
    const user = store.requireActor(actor, ['owner']);
    return store.reopenReturn(id, user.id, user.full_name);
  }));
  ipcMain.handle('auth:verifyManagerPin', wrapF((pin) => store.verifyManagerPin(pin)));

  // Staff / HR
  ipcMain.handle('staff:getEmployees', wrapF((filters, actor) => {
    store.requireActor(actor || store.getUserSession(), []);
    return store.getEmployees(filters);
  }));
  ipcMain.handle('staff:getEmployee', wrapF((id, actor) => {
    const empSess = store.getEmployeeSession();
    const sessEmpId = empSess ? Number(empSess.id || empSess.employee_id) : null;
    if (sessEmpId != null && sessEmpId === Number(id)) {
      return store.getEmployee(id);
    }
    store.requireActor(actor || store.getUserSession(), []);
    return store.getEmployee(id);
  }));
  ipcMain.handle('staff:getEmployeeByUserId', wrapF((userId) => store.getEmployeeByUserId(userId)));
  ipcMain.handle('staff:saveEmployee', wrapF((data, actor) => {
    store.requireActor(actor, ['owner', 'manager']);
    return store.saveEmployee(data, actor.id);
  }));
  ipcMain.handle('staff:deleteEmployee', wrapF((id, actor) => {
    store.requireActor(actor, ['owner', 'manager']);
    return store.deleteEmployee(id, actor.id, actor.username || actor.full_name);
  }));
  ipcMain.handle('staff:login', wrapF((code, pin) => store.verifyEmployeeCodePin(code, pin)));
  ipcMain.handle('staff:adminOpen', wrapF((employeeId, actor) => store.adminOpenEmployeePortal(employeeId, actor || store.getUserSession())));
  ipcMain.handle('staff:logout', wrapF(() => {
    store.clearEmployeeSession();
    return { ok: true };
  }));
  ipcMain.handle('staff:validateLinks', wrapF((data) => store.validateEmployeeLinks(data || {})));
  ipcMain.handle('staff:saveSelfie', wrapF((data, actor) => {
    const empSess = store.getEmployeeSession();
    const sessEmpId = empSess ? Number(empSess.id || empSess.employee_id) : null;
    if (sessEmpId != null && sessEmpId === Number(data?.employee_id)) {
      return store.saveStaffSelfie(data);
    }
    if (data?.pin && data?.employee_id) {
      store.verifyEmployeePin(Number(data.employee_id), data.pin);
      return store.saveStaffSelfie(data);
    }
    store.requireActor(actor || store.getUserSession(), ['owner', 'manager']);
    return store.saveStaffSelfie(data);
  }));
  ipcMain.handle('staff:getSelfies', wrapF((filters, actor) => {
    store.requireActor(actor, ['owner', 'manager']);
    return store.getStaffSelfies(filters || {});
  }));
  ipcMain.handle('staff:getSelfie', wrapF((id, actor) => {
    store.requireActor(actor, ['owner', 'manager']);
    return store.getStaffSelfie(id);
  }));
  ipcMain.handle('staff:updateSelfie', wrapF((id, photoData, notes, actor) => {
    store.requireActor(actor, ['owner', 'manager']);
    return store.updateStaffSelfie(id, photoData, actor?.id, actor?.username || actor?.full_name, notes);
  }));
  ipcMain.handle('staff:deleteSelfie', wrapF((id, actor) => {
    store.requireActor(actor, ['owner', 'manager']);
    return store.deleteStaffSelfie(id, actor?.id, actor?.username || actor?.full_name);
  }));
  ipcMain.handle('staff:clock', wrapF((employeeId, action, auth) => {
    const pin = typeof auth === 'string' || typeof auth === 'number'
      ? String(auth)
      : (auth?.pin != null ? String(auth.pin) : null);
    const actor = auth && typeof auth === 'object' && !Array.isArray(auth)
      ? (auth.actor || (auth.id && auth.pin == null && auth.clientRequestId == null ? auth : null))
      : null;
    const clientRequestId = auth && typeof auth === 'object' && !Array.isArray(auth)
      ? (auth.clientRequestId || auth.client_request_id || null)
      : null;
    const empId = Number(employeeId);
    const empSess = store.getEmployeeSession();
    const sessEmpId = empSess ? Number(empSess.id || empSess.employee_id) : null;

    if (pin) {
      if (sessEmpId != null && sessEmpId !== empId) throw new Error('Authentication required');
      return store.clockAction(empId, action, pin, clientRequestId);
    }
    if (sessEmpId != null) {
      if (sessEmpId !== empId) throw new Error('Authentication required');
      if (!empSess.pinVerified) throw new Error('PIN required to clock');
      // Session already PIN-verified at login — do not keep raw PIN in the renderer
      return store.clockActionVerified(empId, action, clientRequestId);
    }
    const userActor = actor || store.getUserSession();
    store.requireActor(userActor, ['owner', 'manager', 'supervisor', 'assistant_manager']);
    return store.clockActionVerified(empId, action, clientRequestId);
  }));
  ipcMain.handle('staff:getAttendance', wrapF((filters) => { requireSession(); return store.getAttendance(filters); }));
  ipcMain.handle('staff:getTodayAttendance', wrapF((id) => store.getTodayAttendance(scopedEmployeeId(id))));
  ipcMain.handle('staff:getPortalFeed', wrapF((employeeId) => store.getPortalFeed(scopedEmployeeId(employeeId))));
  ipcMain.handle('staff:getLeave', wrapF((id) => store.getLeave(scopedEmployeeId(id))));
  ipcMain.handle('staff:getAllLeave', wrapF((status) => { requireSession(); return store.getAllLeave(status); }));
  ipcMain.handle('staff:saveLeave', wrapF((data, actor) => {
    const empSess = store.getEmployeeSession();
    const userSess = store.getUserSession();
    if (empSess?.adminOverride && userSess?.id) {
      return store.saveLeave(data, userSess);
    }
    const sessEmpId = empSess ? Number(empSess.id || empSess.employee_id) : null;
    if (sessEmpId != null && sessEmpId === Number(data?.employee_id)) {
      return store.saveLeave(data, null);
    }
    const user = store.requireActor(actor || userSess, []);
    return store.saveLeave(data, user);
  }));
  ipcMain.handle('staff:approveLeave', wrapF((id, actor, approve) => {
    const user = store.requireActor(actor, ['owner', 'manager', 'supervisor', 'assistant_manager']);
    return store.approveLeave(id, user.id, approve !== false, user.full_name || user.username, user);
  }));
  ipcMain.handle('staff:leavePdf', wrapF((id) => {
    requireSession();
    const empSess = store.getEmployeeSession();
    if (empSess?.employee_id != null) {
      const mine = store.getLeave(Number(empSess.employee_id)) || [];
      if (!mine.some((l) => Number(l.id) === Number(id))) throw new Error('Authentication required');
    }
    return store.buildLeavePdf(id);
  }));
  ipcMain.handle('staff:submitLeaveProof', wrapF((leaveId, employeeId, imageData, actor) => {
    const empSess = store.getEmployeeSession();
    const sessEmpId = empSess ? Number(empSess.id || empSess.employee_id) : null;
    if (sessEmpId != null && sessEmpId === Number(employeeId)) {
      return store.submitLeaveProof(leaveId, employeeId, imageData);
    }
    store.requireActor(actor || store.getUserSession(), ['owner', 'manager', 'supervisor']);
    return store.submitLeaveProof(leaveId, employeeId, imageData);
  }));
  ipcMain.handle('staff:confirmLeaveProof', wrapF((leaveId, actor) => {
    store.requireActor(actor, ['owner', 'manager']);
    return store.confirmLeaveProof(leaveId, actor?.id);
  }));
  ipcMain.handle('staff:getPendingLeaveProofs', wrapF(() => { requireSession(); return store.getPendingLeaveProofs(); }));
  ipcMain.handle('staff:getLeaveBalance', wrapF((id) => store.getLeaveBalance(scopedEmployeeId(id))));
  ipcMain.handle('staff:getLeavePolicy', wrapF((employeeId) => store.getLeavePolicyForEmployee(scopedEmployeeId(employeeId))));
  ipcMain.handle('staff:getPayroll', wrapF((id) => store.getPayroll(scopedEmployeeId(id))));
  ipcMain.handle('staff:generatePayroll', wrapF((start, end, ids, actor) => {
    store.requireActor(actor, ['owner', 'manager']);
    return store.generatePayroll(start, end, ids);
  }));
  ipcMain.handle('staff:paySalary', wrapF((id, method, actor) => {
    store.requireActor(actor, ['owner', 'manager']);
    store.paySalary(id, method);
    const to = new Date().toLocaleDateString('en-CA');
    const from = new Date(Date.now() - 90 * 86400000).toLocaleDateString('en-CA');
    store.syncLedger(from, to);
    store.refreshPaymentDueNotifications();
    return true;
  }));
  ipcMain.handle('salaryClaims:list', wrapF((filters, actor) => {
    try {
      if (store.getEmployeeSession?.()?.employee_id != null || actor?.employee_id != null) {
        const id = portalEmployeeId((filters && filters.employee_id) || actor?.employee_id, actor);
        return store.listSalaryClaims({ ...(filters || {}), employee_id: id });
      }
      store.requireActor(actor, ['owner', 'manager']);
      return store.listSalaryClaims(filters || {});
    } catch (err) {
      if (/no such table|does not exist/i.test(String(err.message || ''))) return [];
      throw err;
    }
  }));
  ipcMain.handle('salaryClaims:get', wrapF((id, actor) => {
    const c = store.getSalaryClaim(id);
    if (!c) throw new Error('Claim not found');
    const empSess = store.getEmployeeSession?.();
    if (empSess?.employee_id != null) {
      if (Number(c.employee_id) !== Number(empSess.employee_id)) throw new Error('Not authorised');
      return c;
    }
    store.requireActor(actor, ['owner', 'manager']);
    return c;
  }));
  ipcMain.handle('salaryClaims:save', wrapF((data, actor) => {
    store.requireActor(actor, ['owner', 'manager']);
    return store.saveSalaryClaim(data, actor.id, actor.username || actor.full_name);
  }));
  ipcMain.handle('salaryClaims:delete', wrapF((id, actor) => {
    store.requireActor(actor, ['owner', 'manager']);
    return store.deleteSalaryClaim(id, actor.id, actor.username || actor.full_name);
  }));
  ipcMain.handle('salaryClaims:claim', wrapF((id, notes, actor) => {
    const empSess = store.getEmployeeSession?.();
    const empId = empSess?.employee_id ?? actor?.employee_id;
    if (empId == null) throw new Error('Employee login required to claim salary');
    return store.claimSalaryByEmployee(id, notes, empId);
  }));
  ipcMain.handle('salaryClaims:approve', wrapF((id, notes, actor) => {
    store.requireActor(actor, ['owner', 'manager']);
    return store.approveSalaryClaim(id, notes, actor.id, actor.username || actor.full_name);
  }));
  ipcMain.handle('salaryClaims:reject', wrapF((id, notes, actor) => {
    store.requireActor(actor, ['owner', 'manager']);
    return store.rejectSalaryClaim(id, notes, actor.id, actor.username || actor.full_name);
  }));
  ipcMain.handle('salaryClaims:markPaid', wrapF((id, actor) => {
    store.requireActor(actor, ['owner', 'manager']);
    return store.markSalaryClaimPaid(id, actor.id, actor.username || actor.full_name);
  }));
  ipcMain.handle('salaryClaims:pdf', wrapF((id, actor) => {
    const c = store.getSalaryClaim(id);
    if (!c) throw new Error('Claim not found');
    const empSess = store.getEmployeeSession?.();
    if (empSess?.employee_id != null) {
      if (Number(c.employee_id) !== Number(empSess.employee_id)) throw new Error('Not authorised');
    } else {
      store.requireActor(actor, ['owner', 'manager']);
    }
    return store.buildSalaryClaimPdf(id, store.getSettingsParsed());
  }));
  ipcMain.handle('salaryClaims:fromPayroll', wrapF((start, end, deadline, paymentDate, opensAt, actor) => {
    store.requireActor(actor, ['owner', 'manager']);
    return store.createClaimsFromPayroll(start, end, deadline, paymentDate, opensAt, actor.id, actor.username || actor.full_name);
  }));
  ipcMain.handle('staff:getPayrollDashboard', wrapF((filters, actor) => {
    store.requireActor(actor, ['owner', 'manager']);
    return store.getPayrollDashboard(filters || {});
  }));
  ipcMain.handle('staff:previewPayroll', wrapF((start, end, filters, actor) => {
    store.requireActor(actor, ['owner', 'manager']);
    return store.previewPayroll(start, end, filters || {});
  }));
  ipcMain.handle('staff:getMissedClockOutInbox', wrapF((filters, actor) => {
    store.requireActor(actor, ['owner', 'manager', 'supervisor', 'assistant_manager']);
    return store.getMissedClockOutInbox(filters || {});
  }));
  ipcMain.handle('staff:resolveMissedClockOut', wrapF((id, action, actor) => store.resolveMissedClockOut(id, action, actor)));
  ipcMain.handle('staff:saveWorkSchedule', wrapF((employeeId, schedule, actor) => {
    store.requireActor(actor, ['owner', 'manager']);
    return store.saveEmployeeWorkSchedule(employeeId, schedule, actor.id, actor.username || actor.full_name || 'manager');
  }));
  ipcMain.handle('staff:saveHrDocument', wrapF((data, actor) => {
    store.requireActor(actor, ['owner', 'manager']);
    return store.saveHrDocument(data, actor.id, actor.username || actor.full_name || 'manager');
  }));
  ipcMain.handle('staff:getHrDocuments', wrapF((employeeId, actor) => {
    const user = actor || store.getUserSession();
    const empSess = store.getEmployeeSession?.();
    const isHrAdmin = ['owner', 'manager', 'supervisor', 'assistant_manager'].includes(user?.role);
    const selfId = empSess?.employee_id ?? user?.employee_id;
    if (!isHrAdmin && selfId != null) {
      return store.getHrDocuments(Number(selfId));
    }
    store.requireActor(user, ['owner', 'manager', 'supervisor', 'assistant_manager']);
    return store.getHrDocuments(employeeId);
  }));
  ipcMain.handle('staff:getHrDocument', wrapF((id, actor) => {
    const doc = store.getHrDocument(id);
    if (!doc) throw new Error('Document not found');
    const user = actor || store.getUserSession();
    const empSess = store.getEmployeeSession?.();
    if (['owner', 'manager', 'supervisor', 'assistant_manager'].includes(user?.role)) return doc;
    const selfId = empSess?.employee_id ?? user?.employee_id;
    if (selfId != null && Number(selfId) === Number(doc.employee_id)) return doc;
    throw new Error('Not authorised');
  }));
  ipcMain.handle('staff:buildHrDocumentHtml', wrapF((data, actor) => {
    store.requireActor(actor, ['owner', 'manager']);
    const emp = store.getEmployee(data.employee_id);
    const s = store.getSettingsParsed();
    return store.buildHrDocumentHtml({
      ...data,
      employee_name: emp?.full_name,
      employee_code: emp?.employee_code,
      position: emp?.position,
      branch: emp?.branch
    }, s);
  }));
  ipcMain.handle('staff:updateAttendance', wrapF((id, data, actor) => {
    store.requireActor(actor, ['owner', 'manager']);
    return store.updateAttendance(id, data, actor.id, actor.username || actor.full_name || 'manager');
  }));
  ipcMain.handle('staff:deleteAttendance', wrapF((id, actor) => store.deleteAttendance(id, actor)));
  ipcMain.handle('staff:createAttendance', wrapF((data, actor) => store.createManualAttendance(data, actor)));
  ipcMain.handle('staff:addAttendancePenalty', wrapF((data, actor) => store.addAttendancePenalty(data, actor)));
  ipcMain.handle('staff:getAttendancePenalties', wrapF((filters, actor) => {
    const user = actor || store.getUserSession();
    const empSess = store.getEmployeeSession?.();
    const isHrAdmin = ['owner', 'manager', 'supervisor', 'assistant_manager'].includes(user?.role);
    if (!isHrAdmin && empSess?.employee_id != null) {
      return store.getAttendancePenalties({ ...(filters || {}), employee_id: empSess.employee_id });
    }
    store.requireActor(user, ['owner', 'manager', 'supervisor', 'assistant_manager']);
    return store.getAttendancePenalties(filters || {});
  }));
  ipcMain.handle('staff:cancelAttendancePenalty', wrapF((id, actor) => store.cancelAttendancePenalty(id, actor)));
  ipcMain.handle('staff:getAttendanceSummary', wrapF((employeeId, from, to) => store.getAttendanceSummary(scopedEmployeeId(employeeId), from, to)));
  ipcMain.handle('staff:getSchedules', wrapF((from, to, empId) => {
    const empSess = store.getEmployeeSession();
    const userSess = store.getUserSession();
    if (empSess?.adminOverride && userSess?.id) {
      requireSession();
      return store.getSchedules(from, to, empId);
    }
    if (empSess?.employee_id != null) return store.getSchedules(from, to, empSess.employee_id);
    requireSession();
    return store.getSchedules(from, to, empId);
  }));
  ipcMain.handle('staff:saveSchedule', wrapF((data, actor) => {
    store.requireActor(actor || store.getUserSession(), ['owner', 'manager', 'supervisor', 'assistant_manager']);
    return store.saveSchedule(data);
  }));
  ipcMain.handle('staff:deleteSchedule', wrapF((id, actor) => {
    store.requireActor(actor || store.getUserSession(), ['owner', 'manager', 'supervisor', 'assistant_manager']);
    return store.deleteSchedule(id);
  }));
  ipcMain.handle('staff:autoShifts', wrapF((weekStart, templates, employeeIds, employeeOverrides, actor, options) => {
    store.requireActor(actor || store.getUserSession(), ['owner', 'manager', 'supervisor', 'assistant_manager']);
    return store.autoGenerateShifts(weekStart, templates, employeeIds, employeeOverrides, options || {});
  }));
  ipcMain.handle('staff:getDocuments', wrapF((id, actor) => {
    const user = actor || store.getUserSession();
    const empSess = store.getEmployeeSession?.();
    const isHrAdmin = ['owner', 'manager', 'supervisor', 'assistant_manager'].includes(user?.role);
    const selfId = empSess?.employee_id ?? user?.employee_id;
    if (!isHrAdmin && selfId != null) {
      return store.getEmployeeDocuments(Number(selfId));
    }
    if (isHrAdmin) return store.getEmployeeDocuments(id);
    throw new Error('Authentication required');
  }));
  ipcMain.handle('staff:saveDocument', wrapF((data, actor) => {
    const user = actor || store.getUserSession();
    const empSess = store.getEmployeeSession?.();
    const isHrAdmin = ['owner', 'manager', 'supervisor', 'assistant_manager'].includes(user?.role);
    if (!isHrAdmin) {
      const selfId = empSess?.employee_id ?? user?.employee_id;
      if (selfId == null) throw new Error('Authentication required');
      return store.saveEmployeeDocument({ ...data, employee_id: Number(selfId) });
    }
    store.requireActor(user, ['owner', 'manager', 'supervisor', 'assistant_manager']);
    return store.saveEmployeeDocument(data);
  }));
  ipcMain.handle('staff:getDisciplinary', wrapF((id) => store.getDisciplinary(scopedEmployeeId(id))));
  ipcMain.handle('staff:saveDisciplinary', wrapF((data, actor) => {
    store.requireActor(actor, ['owner', 'manager']);
    return store.saveDisciplinary(data, actor.id);
  }));
  ipcMain.handle('staff:respondDisciplinary', wrapF((id, employeeId, response, actor) => {
    assertEmployeeActor(actor || store.getUserSession(), employeeId);
    return store.respondDisciplinary(id, employeeId, response);
  }));
  ipcMain.handle('staff:getAllDisciplinary', wrapF((filters, actor) => {
    store.requireActor(actor || store.getUserSession(), ['owner', 'manager', 'supervisor']);
    return store.getAllDisciplinary(filters || {});
  }));
  ipcMain.handle('staff:disciplinaryPdf', wrapF((id, copyType) => store.buildDisciplinaryPdfBuffer(id, copyType || 'staff')));
  ipcMain.handle('staff:markDisciplinaryWa', wrapF((id, actor) => {
    store.requireActor(actor || store.getUserSession(), ['owner', 'manager', 'supervisor']);
    return store.markDisciplinaryWhatsAppSent(id);
  }));
  ipcMain.handle('staff:getCustomerPhoneReport', wrapF((filters) => store.getCustomerPhoneReport(filters || {})));
  ipcMain.handle('staff:customerPhoneReportPdf', wrapF((filters) => {
    const s = store.getSettingsParsed();
    return store.buildCustomerPhoneReportPdf(filters || {}, s?.shop_name, s?.currency || 'R');
  }));
  ipcMain.handle('staff:getPerformance', wrapF((id, from, to) => store.getEmployeePerformance(id, from, to)));
  ipcMain.handle('staff:getNotifications', wrapF(() => store.getStaffNotifications()));
  ipcMain.handle('staff:payslipPdf', wrapF((id, auth) => {
    const pin = auth?.pin != null ? String(auth.pin) : null;
    if (pin) {
      const owner = store.getDb().prepare('SELECT employee_id FROM employee_payroll WHERE id = ?').get(id);
      if (!owner) throw new Error('Payroll record not found');
      store.verifyEmployeePin(owner.employee_id, pin);
    }
    const s = store.getSettingsParsed();
    const sess = store.getUserSession?.();
    return store.buildPayslipPdf(id, s?.shop_name, s?.currency || 'R', { skipAuth: !!pin || !!sess?.id });
  }));
  ipcMain.handle('staff:schedulePdf', wrapF((from, to) => {
    const s = store.getSettingsParsed();
    return store.buildSchedulePdf(from, to, s?.shop_name);
  }));
  ipcMain.handle('staff:schedulePrintHtml', wrapF((from, to) => {
    const s = store.getSettingsParsed();
    return store.buildSchedulePrintHtml(from, to, s?.shop_name);
  }));
  ipcMain.handle('staff:getLoginEvents', wrapF((filters) => store.getUserLoginEvents(filters || {})));
  ipcMain.handle('staff:recordLogout', wrapF((user) => {
    store.recordUserLoginEvent(user, 'logout');
    return true;
  }));
  ipcMain.handle('staff:reportPdf', wrapF((type, data) => {
    const s = store.getSettingsParsed();
    return store.buildStaffReportPdf(type, data, s?.shop_name, s?.currency || 'R');
  }));
  ipcMain.handle('staff:validateAccount', wrapF((customerId, amount) => {
    const s = store.getSettingsParsed();
    return store.validateOnAccount(customerId, amount, s?.account_settings);
  }));

  // HR Contracts & Probation
  const hrActor = (actor) => actor?.username || actor?.full_name || 'manager';
  const hrReadRoles = ['owner', 'manager', 'supervisor'];
  const hrWriteRoles = ['owner', 'manager'];
  ipcMain.handle('hr:getEvalCategories', wrapF(() => store.EVAL_CATEGORIES));
  ipcMain.handle('hr:populateContract', wrapF((employeeId, templateId, actor) => {
    store.requireActor(actor, hrWriteRoles);
    return store.populateContractFromEmployee(employeeId, templateId);
  }));
  ipcMain.handle('hr:fillContractBody', wrapF((data, actor) => {
    store.requireActor(actor, hrWriteRoles);
    return store.fillContractTemplate(data?.body_template || store.CHISANYAMA_BODY, data || {});
  }));
  ipcMain.handle('hr:getContractTemplates', wrapF((actor) => {
    store.requireActor(actor, hrReadRoles);
    return store.getContractTemplates();
  }));
  ipcMain.handle('hr:saveContractTemplate', wrapF((data, actor) => {
    store.requireActor(actor, hrWriteRoles);
    return store.saveContractTemplate(data, actor.id, hrActor(actor));
  }));
  ipcMain.handle('hr:deleteContractTemplate', wrapF((id, actor) => {
    store.requireActor(actor, hrWriteRoles);
    return store.deleteContractTemplate(id, actor.id, hrActor(actor));
  }));
  ipcMain.handle('hr:getContracts', wrapF((filters, actor) => {
    store.requireActor(actor, hrReadRoles);
    return store.getContracts(filters || {});
  }));
  ipcMain.handle('hr:getContract', wrapF((id, actor) => {
    store.requireActor(actor, hrReadRoles);
    return store.getContract(id);
  }));
  ipcMain.handle('hr:saveContract', wrapF((data, actor) => {
    store.requireActor(actor, hrWriteRoles);
    return store.saveContract(data, actor.id, hrActor(actor));
  }));
  ipcMain.handle('hr:signContract', wrapF((contractId, role, sig, actor) => {
    const empSess = store.getEmployeeSession?.();
    if (empSess?.employee_id != null) {
      return store.signContract(contractId, 'employee', sig, null, empSess.full_name || `employee:${empSess.employee_id}`);
    }
    store.requireActor(actor, hrWriteRoles);
    return store.signContract(contractId, role, sig, actor.id, hrActor(actor));
  }));
  ipcMain.handle('hr:openContractResign', wrapF((id, opensAt, closesAt, actor) => {
    store.requireActor(actor, hrWriteRoles);
    return store.openContractResign(id, opensAt, closesAt, actor.id, hrActor(actor));
  }));
  ipcMain.handle('hr:attachContractDoc', wrapF((contractId, filePath, fileName, actor) => {
    const empSess = store.getEmployeeSession?.();
    const empId = empSess?.employee_id ?? actor?.employee_id;
    if (empId == null) {
      store.requireActor(actor, hrWriteRoles);
      const c = store.getContract(contractId);
      return store.attachContractResignDoc(contractId, filePath, fileName, c.employee_id);
    }
    return store.attachContractResignDoc(contractId, filePath, fileName, empId);
  }));
  ipcMain.handle('hr:getContractsForEmployee', wrapF((employeeId, actor) => {
    const empId = portalEmployeeId(employeeId, actor);
    try { store.ensureContractExpiry?.(); } catch (_) { /* ignore */ }
    try {
      return store.getContracts({ employee_id: empId });
    } catch (err) {
      if (/no such table|does not exist/i.test(String(err.message || ''))) return [];
      throw err;
    }
  }));
  ipcMain.handle('hr:listLeases', wrapF((actor) => store.listLeaseAgreements(actor)));
  ipcMain.handle('hr:getLease', wrapF((id, actor) => store.getLeaseAgreement(id, actor)));
  ipcMain.handle('hr:saveLease', wrapF((data, actor) => store.saveLeaseAgreement(data, actor)));
  ipcMain.handle('hr:deleteLease', wrapF((id, actor) => store.deleteLeaseAgreement(id, actor)));
  ipcMain.handle('hr:uploadLease', wrapF((id, fileName, dataUrl, actor) => store.uploadLeaseFile(id, fileName, dataUrl, actor)));
  ipcMain.handle('hr:leasePdf', wrapF((id, actor) => store.buildLeasePdf(id, actor)));
  ipcMain.handle('hr:contractPdf', wrapF((id, actor) => {
    const empSess = store.getEmployeeSession?.();
    if (empSess?.employee_id != null) {
      const c = store.getContract(id);
      if (!c || Number(c.employee_id) !== Number(empSess.employee_id)) throw new Error('Not authorised');
      return store.buildContractPdf(id, store.getSettingsParsed());
    }
    store.requireActor(actor, hrReadRoles);
    return store.buildContractPdf(id, store.getSettingsParsed());
  }));
  ipcMain.handle('hr:getProbations', wrapF((filters, actor) => {
    const empSess = store.getEmployeeSession?.();
    const userRole = actor?.role || store.getUserSession?.()?.role;
    const isHr = ['owner', 'manager', 'supervisor', 'assistant_manager'].includes(userRole);
    const selfId = empSess?.employee_id ?? actor?.employee_id;
    if (!isHr && selfId != null) {
      return store.getProbations({ ...(filters || {}), employee_id: Number(selfId) });
    }
    store.requireActor(actor, hrReadRoles);
    return store.getProbations(filters || {});
  }));
  ipcMain.handle('hr:getProbation', wrapF((id, actor) => {
    store.requireActor(actor, hrReadRoles);
    return store.getProbation(id);
  }));
  ipcMain.handle('hr:saveProbation', wrapF((data, actor) => {
    store.requireActor(actor, hrWriteRoles);
    return store.saveProbation(data, actor.id, hrActor(actor));
  }));
  ipcMain.handle('hr:deleteProbation', wrapF((id, actor) => {
    store.requireActor(actor, ['owner', 'manager']);
    return store.deleteProbation(id, actor.id, hrActor(actor));
  }));
  ipcMain.handle('hr:getDecisionRules', wrapF((actor) => {
    store.requireActor(actor, hrReadRoles);
    return store.getDecisionRules();
  }));
  ipcMain.handle('hr:saveDecisionRule', wrapF((data, actor) => {
    store.requireActor(actor, hrWriteRoles);
    return store.saveDecisionRule(data, actor.id, hrActor(actor));
  }));
  ipcMain.handle('hr:saveDailyEvaluation', wrapF((data, actor) => {
    store.requireActor(actor, hrReadRoles);
    return store.saveDailyEvaluation(data, actor.id, hrActor(actor));
  }));
  ipcMain.handle('hr:getEvaluationHistory', wrapF((filters, actor) => {
    const empSess = store.getEmployeeSession?.();
    const userRole = actor?.role || store.getUserSession?.()?.role;
    const isHr = ['owner', 'manager', 'supervisor', 'assistant_manager'].includes(userRole);
    const selfId = empSess?.employee_id ?? actor?.employee_id;
    if (!isHr && selfId != null) {
      return store.getEvaluationHistory({ ...(filters || {}), employee_id: Number(selfId) });
    }
    store.requireActor(actor, hrReadRoles);
    return store.getEvaluationHistory(filters || {});
  }));
  ipcMain.handle('hr:getRecommendation', wrapF((probationId, actor) => {
    store.requireActor(actor, hrReadRoles);
    return store.getRecommendation(probationId);
  }));
  ipcMain.handle('hr:finalProbationDecision', wrapF((probationId, decision, reason, extendDays, actor) => {
    store.requireActor(actor, hrWriteRoles);
    return store.finalProbationDecision(probationId, decision, reason, actor.id, hrActor(actor), extendDays);
  }));
  ipcMain.handle('hr:getProbationDashboard', wrapF((filters, actor) => {
    store.requireActor(actor, hrReadRoles);
    return store.getProbationDashboard(filters || {});
  }));
  ipcMain.handle('hr:probationPdf', wrapF((id, actor) => {
    const empSess = store.getEmployeeSession?.();
    if (empSess?.employee_id != null) {
      const p = store.getProbation(id);
      if (!p || Number(p.employee_id) !== Number(empSess.employee_id)) throw new Error('Not authorised');
      return store.buildProbationPdf(id, store.getSettingsParsed());
    }
    store.requireActor(actor, hrReadRoles);
    return store.buildProbationPdf(id, store.getSettingsParsed());
  }));
  ipcMain.handle('hr:evaluationReportPdf', wrapF((id, actor) => {
    store.requireActor(actor, hrReadRoles);
    return store.buildEvaluationReportPdf(id, store.getSettingsParsed());
  }));
  ipcMain.handle('hr:probationLetterPdf', wrapF((id, decision, actor) => {
    store.requireActor(actor, hrReadRoles);
    return store.buildProbationLetterPdf(id, decision, store.getSettingsParsed());
  }));
  ipcMain.handle('hr:getPersonnelFile', wrapF((employeeId, actor) => {
    store.requireActor(actor, hrReadRoles);
    return store.getEmployeePersonnelFile(employeeId);
  }));

  // HR Training / Staff Submissions (v2.8.1)
  ipcMain.handle('hrTraining:getTemplates', wrapF((type, actor) => store.getHrContractTemplates(type, actor)));
  ipcMain.handle('hrTraining:saveTemplate', wrapF((data, actor) => store.saveHrContractTemplate(data, actor)));
  ipcMain.handle('hrTraining:deleteTemplate', wrapF((id, actor) => store.deleteHrContractTemplate(id, actor)));
  ipcMain.handle('hrTraining:getRecords', wrapF((filters, actor) => store.getTrainingRecords(filters, actor)));
  ipcMain.handle('hrTraining:saveRecord', wrapF((data, actor) => store.saveTrainingRecord(data, actor)));
  ipcMain.handle('hrTraining:deleteRecord', wrapF((id, actor) => store.deleteTrainingRecord(id, actor)));
  ipcMain.handle('hrTraining:saveEvaluation', wrapF((recordId, data, actor) => store.saveTrainingEvaluation(recordId, data, actor)));
  ipcMain.handle('hrTraining:evalPdf', wrapF((id, actor) => {
    const buf = store.buildTrainingEvalPdf(id, actor);
    return Array.from(buf);
  }));
  ipcMain.handle('hrTraining:getSubmissions', wrapF((filters, actor) => store.getStaffSubmissions(filters, actor)));
  ipcMain.handle('hrTraining:assignTemplate', wrapF((data, actor) => store.assignStaffTemplate(data, actor)));
  ipcMain.handle('hrTraining:submitForm', wrapF((data, actor) => store.submitStaffForm(data, actor)));
  ipcMain.handle('hrTraining:reviewSubmission', wrapF((id, decision, notes, actor) => store.reviewStaffSubmission(id, decision, notes, actor)));
  ipcMain.handle('hrTraining:updateSubmission', wrapF((id, data, actor) => store.updateStaffSubmission(id, data, actor)));
  ipcMain.handle('hrTraining:deleteSubmission', wrapF((id, actor) => store.deleteStaffSubmission(id, actor)));
  ipcMain.handle('hrTraining:attachDoc', wrapF((submissionId, filePath, actor) => {
    const dest = store.copyStaffDocToAssets(filePath, submissionId, 'upload');
    return store.saveStaffSubmissionDoc(submissionId, dest, actor);
  }));

  // Recruitment / Jobs (v2.8.1)
  ipcMain.handle('jobs:getPostings', wrapF((filters, actor) => store.getJobPostings(filters, actor)));
  ipcMain.handle('jobs:savePosting', wrapF((data, actor) => store.saveJobPosting(data, actor)));
  ipcMain.handle('jobs:approvePosting', wrapF((id, actor) => store.approveJobPosting(id, actor)));
  ipcMain.handle('jobs:closePosting', wrapF((id, actor) => store.closeJobPosting(id, actor)));
  ipcMain.handle('jobs:deletePosting', wrapF((id, actor) => store.deleteJobPosting(id, actor)));
  ipcMain.handle('jobs:getCandidates', wrapF((filters, actor) => store.getJobCandidates(filters, actor)));
  ipcMain.handle('jobs:saveCandidate', wrapF((data, actor) => store.saveJobCandidate(data, actor)));
  ipcMain.handle('jobs:requestEmploy', wrapF((id, actor) => store.requestEmployCandidate(id, actor)));
  ipcMain.handle('jobs:decideCandidate', wrapF((id, decision, notes, actor) => store.decideJobCandidate(id, decision, notes, actor)));
  ipcMain.handle('jobs:attachCv', wrapF((candidateId, filePath, actor) => store.attachJobCandidateCv(candidateId, filePath, actor)));
  ipcMain.handle('jobs:attachPic', wrapF((candidateId, filePath, actor) => store.attachJobCandidatePicture(candidateId, filePath, actor)));
  ipcMain.handle('jobs:getCandidate', wrapF((id, actor) => store.getJobCandidate(id, actor)));
  ipcMain.handle('jobs:scheduleInterview', wrapF((data, actor) => store.scheduleInterview(data, actor)));
  ipcMain.handle('jobs:waCandidate', wrapF((id, messageType, actor, body) => store.buildCandidateWhatsApp(id, messageType, actor, body)));
  ipcMain.handle('jobs:waInterviewBulk', wrapF((ids, actor, body) => store.sendBulkInterviewWhatsApp(ids, actor, body)));
  ipcMain.handle('jobs:interviewDoc', wrapF((id, actor) => {
    const r = store.createInterviewDocument(id, actor);
    return { path: r.path, buffer: Array.from(r.buffer), candidate: r.candidate };
  }));
  ipcMain.handle('jobs:uploadInterviewResult', wrapF((id, filePath, actor) => store.uploadInterviewResult(id, filePath, actor)));
  ipcMain.handle('jobs:approveInterview', wrapF((id, decision, notes, actor) => store.approveInterviewOutcome(id, decision, notes, actor)));
  ipcMain.handle('jobs:getSettings', wrapF((actor) => {
    store.requireActor(actor, ['owner', 'manager', 'supervisor', 'assistant_manager']);
    return store.getRecruitmentSettings();
  }));
  ipcMain.handle('jobs:saveSettings', wrapF((data, actor) => store.saveRecruitmentSettings(data, actor)));
  ipcMain.handle('jobs:getPublicPosting', wrapF((token) => store.getPublicPosting(token)));
  ipcMain.handle('jobs:listPublicPostings', wrapF(() => store.listPublicOpenPostings()));
  ipcMain.handle('jobs:getPublicApplication', wrapF((editToken) => store.getPublicApplication(editToken)));
  ipcMain.handle('jobs:lookupPublicApplication', wrapF((token, phone) => store.lookupPublicApplication(token, phone)));
  ipcMain.handle('jobs:submitPublicApplication', wrapF((token, data) => store.submitPublicApplication(token, data)));
  ipcMain.handle('jobs:updatePublicApplication', wrapF((editToken, data) => store.updatePublicApplication(editToken, data)));
  ipcMain.handle('jobs:deletePublicApplication', wrapF((editToken) => store.deletePublicApplication(editToken)));
  ipcMain.handle('jobs:deleteCandidate', wrapF((id, actor) => store.deleteJobCandidate(id, actor)));
  ipcMain.handle('jobs:downloadCv', wrapF((id, actor) => store.downloadCandidateCv(id, actor)));
  ipcMain.handle('jobs:posterPdf', wrapF((id, actor) => {
    const r = store.buildJobPosterPdf(id, actor);
    return {
      buffer: r.buffer, apply_url: r.apply_url, order_url: r.order_url, posting: r.posting,
      shop: r.shop, logo_data_url: r.logo_data_url, share: r.share
    };
  }));
  ipcMain.handle('jobs:shareMessage', wrapF((id, actor) => store.buildJobShareMessage(id, actor)));
  ipcMain.handle('jobs:previewWa', wrapF((id, messageType, actor) => store.previewCandidateWhatsApp(id, messageType, actor)));

  // Payroll & Compliance
  ipcMain.handle('payroll:getSettings', wrapF(() => store.getPayrollSettings()));
  ipcMain.handle('payroll:saveSettings', wrapF((data, actor) => {
    const user = store.requireActor(actor, ['owner', 'manager']);
    const r = store.savePayrollSettings(data, user.id, user.username);
    store.refreshPaymentDueNotifications();
    return r;
  }));
  ipcMain.handle('payroll:getAdvances', wrapF((filters) => store.getAdvances(filters)));
  ipcMain.handle('payroll:issueAdvance', wrapF((data, actor) => {
    store.requireActor(actor, ['owner', 'manager']);
    return store.issueAdvance(data, actor);
  }));
  ipcMain.handle('payroll:getLoans', wrapF((filters) => store.getLoans(filters)));
  ipcMain.handle('payroll:saveLoan', wrapF((data, actor) => {
    store.requireActor(actor, ['owner', 'manager']);
    return store.saveLoan(data);
  }));
  ipcMain.handle('payroll:settleLoan', wrapF((id, actor) => {
    store.requireActor(actor, ['owner', 'manager']);
    return store.settleLoanEarly(id);
  }));
  ipcMain.handle('payroll:getDamageCosts', wrapF((filters) => store.getDamageCosts(filters)));
  ipcMain.handle('payroll:saveDamageCost', wrapF((data, actor) => {
    store.requireActor(actor, ['owner', 'manager']);
    return store.saveDamageCost(data, actor);
  }));
  ipcMain.handle('payroll:approveDamageCost', wrapF((id, actor) => {
    store.requireActor(actor, ['owner', 'manager']);
    return store.approveDamageCost(id, actor);
  }));
  ipcMain.handle('payroll:getComplianceSubmissions', wrapF((type) => store.getComplianceSubmissions(type)));
  ipcMain.handle('payroll:saveComplianceSubmission', wrapF((data, actor) => {
    store.requireActor(actor, ['owner', 'manager']);
    return store.saveComplianceSubmission(data, actor);
  }));
  ipcMain.handle('payroll:getComplianceCertificates', wrapF(() => store.getComplianceCertificates()));
  ipcMain.handle('payroll:saveComplianceCertificate', wrapF((data, actor) => {
    store.requireActor(actor, ['owner', 'manager']);
    return store.saveComplianceCertificate(data);
  }));
  ipcMain.handle('payroll:deleteComplianceCertificate', wrapF((id, actor) => {
    store.requireActor(actor, ['owner', 'manager']);
    return store.deleteComplianceCertificate(id);
  }));
  ipcMain.handle('payroll:getComplianceReminders', wrapF(() => store.getComplianceReminders()));
  ipcMain.handle('payroll:getReport', wrapF((from, to) => store.getPayrollReport(from, to)));
  ipcMain.handle('payroll:getStatutoryReport', wrapF((type, from, to) => store.getStatutoryReport(type, from, to)));
  ipcMain.handle('payroll:compliancePdf', wrapF((type, from, to) => {
    const s = store.getSettingsParsed();
    return store.buildComplianceReportPdf(type, from, to, s?.shop_name, s?.currency || 'R');
  }));

  // Owner Salary
  ipcMain.handle('ownerSalary:sync', wrapF(() => {
    const r = store.syncOwnerSalaryPeriods();
    store.refreshPaymentDueNotifications();
    return r;
  }));
  ipcMain.handle('ownerSalary:getProfile', wrapF(() => store.getOwnerProfile()));
  ipcMain.handle('ownerSalary:saveProfile', wrapF((data, actor) => {
    store.requireActor(actor, ['owner', 'manager']);
    const r = store.saveOwnerProfile(data);
    store.refreshPaymentDueNotifications();
    return r;
  }));
  ipcMain.handle('ownerSalary:deleteProfile', wrapF((actor) => {
    store.requireActor(actor, ['owner', 'manager']);
    const r = store.deleteOwnerProfile(actor.id, actor.username || actor.full_name || 'owner');
    store.refreshPaymentDueNotifications();
    return r;
  }));
  ipcMain.handle('ownerSalary:getPeriods', wrapF((profileId, filters) => store.getOwnerSalaryPeriods(profileId, filters)));
  ipcMain.handle('ownerSalary:getPayments', wrapF((profileId) => store.getOwnerSalaryPayments(profileId)));
  ipcMain.handle('ownerSalary:pay', wrapF((data, actor) => {
    store.requireActor(actor, ['owner', 'manager']);
    const r = store.payOwnerSalary(data, actor);
    const to = new Date().toLocaleDateString('en-CA');
    const from = new Date(Date.now() - 90 * 86400000).toLocaleDateString('en-CA');
    store.syncLedger(from, to);
    store.refreshPaymentDueNotifications();
    return r;
  }));
  ipcMain.handle('ownerSalary:getNotifications', wrapF(() => {
    const p = store.getOwnerProfile();
    return store.getOwnerSalaryNotifications(p);
  }));
  ipcMain.handle('ownerSalary:getReport', wrapF((type, from, to) => store.getOwnerSalaryReport(type, from, to)));
  ipcMain.handle('ownerSalary:payslipPdf', wrapF((periodId) => {
    const s = store.getSettingsParsed();
    return store.buildOwnerPayslipPdf(periodId, s?.shop_name, s?.currency || 'R');
  }));
  ipcMain.handle('ownerSalary:reportPdf', wrapF((type, from, to) => {
    const s = store.getSettingsParsed();
    return store.buildOwnerSalaryReportPdf(type, from, to, s?.shop_name, s?.currency || 'R');
  }));
  ipcMain.handle('ownerSalary:getDraws', wrapF((filters) => {
    const profile = store.getOwnerProfile();
    if (!profile) return [];
    return store.getOwnerDraws(profile.id, filters || {});
  }));
  ipcMain.handle('ownerSalary:addDraw', wrapF((data, actor) => {
    store.requireActor(actor, ['owner', 'manager']);
    return store.addOwnerDraw(data, actor);
  }));
  ipcMain.handle('ownerSalary:deleteDraw', wrapF((id, actor) => {
    store.requireActor(actor, ['owner', 'manager']);
    return store.deleteOwnerDraw(id, actor);
  }));

  // Bookkeeping & Financial Management
  ipcMain.handle('bookkeeping:getSettings', wrapF(() => {
    store.requireBookkeepingAccess(store.getUserSession());
    return store.getBookkeepingSettings();
  }));
  ipcMain.handle('bookkeeping:saveSettings', wrapF((data, actor) => {
    store.requireActor(actor, ['owner', 'manager']);
    return store.saveBookkeepingSettings(data, actor);
  }));
  ipcMain.handle('bookkeeping:sync', wrapF((from, to) => {
    store.requireBookkeepingAccess(store.getUserSession());
    store.syncLedger(from, to);
    return true;
  }));
  ipcMain.handle('bookkeeping:dashboard', wrapF((from, to, branchId) => {
    store.requireBookkeepingAccess(store.getUserSession());
    let bid = branchId;
    if (bid == null || bid === '' || bid === 'all') {
      const scope = store.resolveBranchScope(store.getUserSession());
      bid = scope.allBranches ? null : scope.branchId;
    }
    return store.getFinancialDashboard(from, to, bid);
  }));
  ipcMain.handle('bookkeeping:search', wrapF((filters) => {
    store.requireBookkeepingAccess(store.getUserSession());
    return store.searchLedger(filters);
  }));
  ipcMain.handle('bookkeeping:getIncome', wrapF((filters) => {
    store.requireBookkeepingAccess(store.getUserSession());
    return store.getIncomeEntries(filters);
  }));
  ipcMain.handle('bookkeeping:saveIncome', wrapF((data, actor) => {
    store.requireActor(actor, ['owner', 'manager']);
    return store.saveIncomeEntry(data, actor);
  }));
  ipcMain.handle('bookkeeping:deleteIncome', wrapF((id, actor) => {
    store.requireActor(actor, ['owner', 'manager']);
    store.deleteIncomeEntry(id, actor);
    return true;
  }));
  ipcMain.handle('bookkeeping:getBank', wrapF((filters) => {
    store.requireBookkeepingAccess(store.getUserSession());
    return store.getBankTransactions(filters);
  }));
  ipcMain.handle('bookkeeping:saveBank', wrapF((data, actor) => {
    store.requireActor(actor, ['owner', 'manager']);
    return store.saveBankTransaction(data, actor);
  }));
  ipcMain.handle('bookkeeping:cashBook', wrapF((from, to) => {
    store.requireBookkeepingAccess(store.getUserSession());
    return store.getCashBook(from, to);
  }));
  ipcMain.handle('bookkeeping:bankBook', wrapF((from, to) => {
    store.requireBookkeepingAccess(store.getUserSession());
    return store.getBankBook(from, to);
  }));
  ipcMain.handle('bookkeeping:payrollAccounting', wrapF((from, to) => {
    store.requireBookkeepingAccess(store.getUserSession());
    return store.getPayrollAccounting(from, to);
  }));
  ipcMain.handle('bookkeeping:taxSummary', wrapF((from, to, branchId) => {
    store.requireBookkeepingAccess(store.getUserSession());
    return store.getTaxSummary(from, to, branchId);
  }));
  ipcMain.handle('bookkeeping:report', wrapF((type, from, to) => {
    store.requireBookkeepingAccess(store.getUserSession());
    return store.getFinancialReport(type, from, to);
  }));
  ipcMain.handle('bookkeeping:yearEndPack', wrapF((from, to) => {
    store.requireBookkeepingAccess(store.getUserSession());
    return store.getYearEndPack(from, to);
  }));
  ipcMain.handle('bookkeeping:performance', wrapF((from, to) => {
    store.requireBookkeepingAccess(store.getUserSession());
    return store.getBusinessPerformance(from, to);
  }));
  ipcMain.handle('bookkeeping:getBudgets', wrapF((month) => {
    store.requireBookkeepingAccess(store.getUserSession());
    return store.getBudgets(month);
  }));
  ipcMain.handle('bookkeeping:saveBudget', wrapF((data, actor) => {
    store.requireActor(actor, ['owner', 'manager']);
    return store.saveBudget(data, actor);
  }));
  ipcMain.handle('bookkeeping:deleteBudget', wrapF((id, actor) => {
    store.requireActor(actor, ['owner', 'manager']);
    store.deleteBudget(id, actor);
    return true;
  }));
  ipcMain.handle('bookkeeping:budgetVsActual', wrapF((month) => {
    store.requireBookkeepingAccess(store.getUserSession());
    return store.getBudgetVsActual(month);
  }));
  ipcMain.handle('bookkeeping:getDocuments', wrapF((filters) => {
    store.requireBookkeepingAccess(store.getUserSession());
    return store.getFinancialDocuments(filters);
  }));
  ipcMain.handle('bookkeeping:saveDocument', wrapF((data, actor) => {
    store.requireActor(actor, ['owner', 'manager']);
    return store.saveFinancialDocument(data, actor);
  }));
  ipcMain.handle('bookkeeping:deleteDocument', wrapF((id, actor) => {
    store.requireActor(actor, ['owner', 'manager']);
    store.deleteFinancialDocument(id, actor);
    return true;
  }));
  ipcMain.handle('bookkeeping:auditTrail', wrapF((filters) => {
    store.requireBookkeepingAccess(store.getUserSession());
    return store.getFinancialAuditTrail(filters);
  }));
  ipcMain.handle('bookkeeping:notifications', wrapF(() => {
    store.requireBookkeepingAccess(store.getUserSession());
    return store.getFinancialNotifications();
  }));
  ipcMain.handle('bookkeeping:categories', wrapF(() => {
    store.requireBookkeepingAccess(store.getUserSession());
    return { expense: store.EXPENSE_CATEGORIES, income: store.INCOME_TYPES };
  }));
  ipcMain.handle('bookkeeping:reportPdf', wrapF((type, from, to) => {
    store.requireBookkeepingAccess(store.getUserSession());
    const s = store.getSettingsParsed();
    return store.buildFinancialReportPdf(type, from, to, s?.shop_name, s?.currency || 'R');
  }));
  ipcMain.handle('bookkeeping:yearEndPackPdf', wrapF((from, to) => {
    store.requireBookkeepingAccess(store.getUserSession());
    const s = store.getSettingsParsed();
    return store.buildYearEndPackPdf(from, to, s?.shop_name, s?.currency || 'R');
  }));

  // Donations & SARS tax records
  ipcMain.handle('donations:get', wrapF((filters) => { requireSession(); return store.getDonations(filters); }));
  ipcMain.handle('donations:getOne', wrapF((id) => store.getDonation(id)));
  ipcMain.handle('donations:save', wrapF((data, actor) => {
    store.requireActor(actor, ['owner', 'manager']);
    return store.saveDonation(data, actor);
  }));
  ipcMain.handle('donations:delete', wrapF((id, actor) => {
    store.requireActor(actor, ['owner', 'manager']);
    store.deleteDonation(id, actor);
    return true;
  }));
  ipcMain.handle('donations:uploadDoc', wrapF((donationId, doc, actor) => {
    store.requireActor(actor, ['owner', 'manager']);
    return store.uploadDocument(donationId, doc, actor);
  }));
  ipcMain.handle('donations:getDoc', wrapF((id) => store.getDonationDocument(id)));
  ipcMain.handle('donations:submit', wrapF((id, actor) => {
    store.requireActor(actor, ['owner', 'manager']);
    return store.submitForApproval(id, actor);
  }));
  ipcMain.handle('donations:approve', wrapF((id, data, actor) => {
    store.requireActor(actor, ['owner', 'manager']);
    return store.approveDonation(id, data, actor);
  }));
  ipcMain.handle('donations:dashboard', wrapF((filters) => store.getDonationsDashboardStats(filters)));
  ipcMain.handle('donations:report', wrapF((filters) => store.getDonationReport(filters)));
  ipcMain.handle('donations:reportPdf', wrapF((filters) => {
    const s = store.getSettingsParsed();
    return store.buildDonationReportPdf(filters, s?.shop_name, s?.currency || 'R');
  }));
  ipcMain.handle('donations:reportExcel', wrapF((filters) => store.buildDonationReportExcel(filters)));
  ipcMain.handle('donations:types', wrapF(() => ({ types: store.DONATION_TYPES, payments: store.PAYMENT_METHODS, statuses: store.STATUSES })));

  // Operations & Compliance
  ipcMain.handle('ops:getRules', wrapF((filters) => store.getRules(filters)));
  ipcMain.handle('ops:getRule', wrapF((id) => store.getRule(id)));
  ipcMain.handle('ops:saveRule', wrapF((data, actor) => store.saveRule(data, actor)));
  ipcMain.handle('ops:archiveRule', wrapF((id, actor) => store.archiveRule(id, actor)));
  ipcMain.handle('ops:rulePdf', wrapF((id) => {
    const s = store.getSettingsParsed();
    return store.buildRulePdf(id, s?.shop_name);
  }));
  ipcMain.handle('ops:allRulesPdf', wrapF(() => {
    const s = store.getSettingsParsed();
    return store.buildAllRulesPdf(s?.shop_name);
  }));
  ipcMain.handle('ops:openingTemplates', wrapF(() => store.getOpeningTemplates()));
  ipcMain.handle('ops:closingTemplates', wrapF(() => store.getClosingTemplates()));
  ipcMain.handle('ops:saveOpeningTemplate', wrapF((data, actor) => store.saveOpeningTemplate(data, actor)));
  ipcMain.handle('ops:saveClosingTemplate', wrapF((data, actor) => store.saveClosingTemplate(data, actor)));
  ipcMain.handle('ops:deleteOpeningTemplate', wrapF((id, actor) => { store.deleteOpeningTemplate(id, actor); return true; }));
  ipcMain.handle('ops:deleteClosingTemplate', wrapF((id, actor) => { store.deleteClosingTemplate(id, actor); return true; }));
  ipcMain.handle('ops:getChecklistRuns', wrapF((filters) => store.getChecklistRuns(filters)));
  ipcMain.handle('ops:getChecklistRun', wrapF((id) => store.getChecklistRun(id)));
  ipcMain.handle('ops:startChecklist', wrapF((data, actor) => store.startChecklistRun(data, actor)));
  ipcMain.handle('ops:completeChecklistItem', wrapF((itemId, data, actor) => store.completeChecklistItem(itemId, data, actor)));
  ipcMain.handle('ops:finishChecklist', wrapF((runId, actor) => store.finishChecklistRun(runId, actor)));
  ipcMain.handle('ops:submitChecklist', wrapF((runId, actor) => store.submitChecklistRun(runId, actor)));
  ipcMain.handle('ops:confirmChecklist', wrapF((runId, data, actor) => store.confirmChecklistRun(runId, data, actor)));
  ipcMain.handle('ops:reopenChecklist', wrapF((runId, actor) => store.reopenChecklistRun(runId, actor)));
  ipcMain.handle('ops:adminUpdateChecklist', wrapF((runId, data, actor) => store.adminUpdateChecklistRun(runId, data, actor)));
  ipcMain.handle('ops:deleteChecklist', wrapF((runId, actor) => { store.deleteChecklistRun(runId, actor); return true; }));
  ipcMain.handle('ops:pendingChecklists', wrapF(() => store.getPendingChecklistSubmissions()));
  ipcMain.handle('ops:getAdminSignature', wrapF(() => store.getAdminSignature()));
  ipcMain.handle('ops:saveAdminSignature', wrapF((path, actor) => store.saveAdminSignature(path, actor)));
  ipcMain.handle('ops:saveAdminSignatureData', wrapF((dataUrl, actor) => store.saveAdminSignatureFromData(dataUrl, actor)));
  ipcMain.handle('ops:getRuleCategories', wrapF(() => store.getRuleCategories()));
  ipcMain.handle('ops:saveRuleCategory', wrapF((name, actor) => store.saveRuleCategory(name, actor)));
  ipcMain.handle('ops:getRuleAcks', wrapF((filters) => store.getRuleAcknowledgements(filters || {})));
  ipcMain.handle('ops:signRule', wrapF((ruleId, employeeId, signatureData, actor) => store.signCompanyRule(ruleId, employeeId, signatureData, actor)));
  ipcMain.handle('ops:getChecklistSettings', wrapF(() => store.getChecklistSettings()));
  ipcMain.handle('ops:saveChecklistSettings', wrapF((data, actor) => store.saveChecklistSettings(data, actor)));
  ipcMain.handle('ops:checklistWarnings', wrapF((filters) => store.getChecklistWarnings(filters)));
  ipcMain.handle('ops:staffChecklistWarnings', wrapF((userId, employeeId) => store.getStaffPortalChecklistWarnings(userId, employeeId)));
  ipcMain.handle('ops:ackChecklistWarning', wrapF((id, actor) => store.acknowledgeChecklistWarning(id, actor)));
  ipcMain.handle('ops:checklistPdf', wrapF((runId) => {
    const s = store.getSettingsParsed();
    return store.buildChecklistReportPdf(runId, s?.shop_name);
  }));
  ipcMain.handle('ops:nonSellingProducts', wrapF((filters) => store.getNonSellingProducts(filters)));
  ipcMain.handle('ops:nonSellingExcel', wrapF((filters) => store.exportNonSellingExcel(filters)));
  ipcMain.handle('ops:nonSellingPdf', wrapF((filters) => {
    const s = store.getSettingsParsed();
    return store.exportNonSellingPdf(filters, s.shop_name, s.currency);
  }));
  ipcMain.handle('ops:markProductPromo', wrapF((productId, data, actor) => store.markProductPromo(productId, data, actor)));
  ipcMain.handle('ops:dashboard', wrapF(() => store.getComplianceDashboard()));
  ipcMain.handle('ops:proposePromo', wrapF((productId, data, actor) => store.proposeProductPromo(productId, data, actor)));
  ipcMain.handle('ops:pendingPromos', wrapF(() => store.getPendingPromoRequests()));
  ipcMain.handle('ops:promoHistory', wrapF((filters) => store.getPromoRequestHistory(filters)));
  ipcMain.handle('ops:approvePromo', wrapF((id, actor) => store.approvePromoRequest(id, actor)));
  ipcMain.handle('ops:rejectPromo', wrapF((id, notes, actor) => store.rejectPromoRequest(id, notes, actor)));
  ipcMain.handle('ops:cancelPromo', wrapF((id, actor) => store.cancelPromoRequest(id, actor)));
  ipcMain.handle('ops:deletePromo', wrapF((id, actor) => store.deletePromoRequest(id, actor)));
  ipcMain.handle('ops:updatePromo', wrapF((id, data, actor) => store.updatePromoRequest(id, data, actor)));
  ipcMain.handle('ops:promoSalesLog', wrapF((filters) => store.getPromoSalesLog(filters)));
  ipcMain.handle('ops:syncPromoStatuses', wrapF(() => { store.syncPromoStatuses(); return true; }));

  // Manager Operations & Daily Tasks
  ipcMain.handle('mo:dashboard', wrapF((f) => store.ownerDashboard(f?.work_date, f?.branch_id)));
  ipcMain.handle('mo:home', wrapF((f, a) => store.mobileHome(a, f?.branch_id)));
  ipcMain.handle('mo:listTasks', wrapF((f, a) => store.listTasks(f || {}, a)));
  ipcMain.handle('mo:getTask', wrapF((id, a) => store.getTask(id, a)));
  ipcMain.handle('mo:startTask', wrapF((id, a) => store.startTask(id, a)));
  ipcMain.handle('mo:completeChecklistItem', wrapF((id, d, a) => store.completeChecklistItem(id, d || {}, a)));
  ipcMain.handle('mo:completeTask', wrapF((id, d, a) => store.completeTask(id, d || {}, a)));
  ipcMain.handle('mo:verifyTask', wrapF((id, d, a) => store.verifyTask(id, d || {}, a)));
  ipcMain.handle('mo:sales', wrapF((branchId) => store.getSalesSummary(branchId)));
  ipcMain.handle('mo:reportProblem', wrapF((d, a) => store.reportIncident(d || {}, a)));
  ipcMain.handle('mo:listIncidents', wrapF((f) => store.listIncidents(f || {})));
  ipcMain.handle('mo:teamHelp', wrapF((f) => store.listTeamHelp(f?.work_date)));
  ipcMain.handle('mo:requestHelp', wrapF((d, a) => store.requestHelp(d || {}, a)));
  ipcMain.handle('mo:offerHelp', wrapF((id, a) => store.offerHelp(id, a)));
  ipcMain.handle('mo:submitReport', wrapF((d, a) => store.submitDailyReport(d || {}, a)));
  ipcMain.handle('mo:listReports', wrapF((f) => store.listReports(f || {})));
  ipcMain.handle('mo:getReport', wrapF((id, a) => store.getReport(id, a)));
  ipcMain.handle('mo:ownerRespond', wrapF((id, msg, a) => store.ownerRespond(id, msg, a)));
  ipcMain.handle('mo:ackMessage', wrapF((id, a) => store.acknowledgeOwnerMessage(id, a)));
  ipcMain.handle('mo:evidence', wrapF((id, a) => store.getEvidenceDataUrl(id, a)));
  ipcMain.handle('mo:attendance', wrapF(() => store.getAttendanceSnapshot()));
  ipcMain.handle('mo:templates', wrapF(() => store.listTaskTemplates()));
  ipcMain.handle('mo:saveTemplate', wrapF((d, a) => store.saveTaskTemplate(d || {}, a)));
  ipcMain.handle('mo:checklists', wrapF(() => store.listChecklistTemplates()));
  ipcMain.handle('mo:saveChecklist', wrapF((d, a) => store.saveChecklistTemplate(d || {}, a)));
  ipcMain.handle('mo:getSettings', wrapF(() => store.getMoSettings()));
  ipcMain.handle('mo:saveSettings', wrapF((d, a) => store.saveMoSettings(d || {}, a)));
  ipcMain.handle('mo:listAccess', wrapF((a) => {
    const user = store.requireActor(a, ['owner', 'manager']);
    return store.listAccessCandidates();
  }));
  ipcMain.handle('mo:listPeople', wrapF((a) => { store.requireActor(a, ['owner', 'manager', 'assistant_manager', 'supervisor']); return store.listAssignablePeople(); }));
  ipcMain.handle('mo:createTask', wrapF((d, a) => store.createDailyTask(d || {}, a)));
  ipcMain.handle('mo:assignTask', wrapF((id, d, a) => store.assignDailyTask(id, d || {}, a)));
  ipcMain.handle('mo:adminComplete', wrapF((id, d, a) => store.adminCompleteTask(id, d || {}, a)));
  ipcMain.handle('mo:listNotifications', wrapF((f) => store.listTaskNotifications(f || {})));
  ipcMain.handle('mo:resolveIncident', wrapF((id, d, a) => store.resolveIncident(id, d || {}, a)));
  ipcMain.handle('mo:markIncidentSeen', wrapF((id, a) => store.markIncidentSeen(id, a)));
  ipcMain.handle('mo:reportPdf', wrapF((id, a) => store.buildDailyReportPdf(id, a)));
  ipcMain.handle('mo:reportPrint', wrapF((id, a) => store.getReportPrintPayload(id, a)));
  ipcMain.handle('mo:generateTasks', wrapF((d, a) => store.generateDailyTasks(d?.work_date, a, d?.branch_id)));
  ipcMain.handle('mo:audit', wrapF((f) => store.listAudit(f || {})));
  ipcMain.handle('mo:categories', wrapF(() => store.MO_INCIDENT_CATEGORIES || []));

  // Combos & Promotions
  ipcMain.handle('combos:get', wrapF((filters) => store.getCombos(filters)));
  ipcMain.handle('combos:getActive', wrapF((filters) => store.getCombos({ ...filters, active_only: true })));
  ipcMain.handle('combos:getOne', wrapF((id) => store.getCombo(id)));
  ipcMain.handle('combos:save', wrapF((data, actor) => store.saveCombo(data, actor)));
  ipcMain.handle('combos:setStatus', wrapF((id, status, actor) => store.setComboStatus(id, status, actor)));
  ipcMain.handle('combos:approve', wrapF((id, actor) => store.approveCombo(id, actor)));
  ipcMain.handle('combos:reject', wrapF((id, notes, actor) => store.rejectCombo(id, notes, actor)));
  ipcMain.handle('combos:delete', wrapF((id, actor) => { store.deleteCombo(id, actor); return true; }));
  ipcMain.handle('combos:calcPrices', wrapF((items, pricingType, discountValue) => store.calcComboPrices(items, pricingType, discountValue)));
  ipcMain.handle('combos:report', wrapF((filters) => store.getComboReports(filters)));
  ipcMain.handle('combos:reportPdf', wrapF((filters) => {
    const s = store.getSettingsParsed();
    return store.buildComboReportPdf(filters, s?.shop_name, s?.currency || 'R');
  }));
  ipcMain.handle('combos:reportExcel', wrapF((filters) => store.buildComboReportExcel(filters)));

  // Recipe & Production Management
  ipcMain.handle('recipe:login', wrapF((username, password, pin) => store.loginToRecipeModule(username, password, pin)));
  ipcMain.handle('recipe:sessionFromPos', wrapF((actor) => store.sessionFromPosUser(actor)));
  ipcMain.handle('recipe:createRestockPo', wrapF((data, actor) => store.createRestockPurchaseOrder(data || {}, actor)));
  ipcMain.handle('recipe:prepBoard', wrapF((actor) => store.getPrepBoard(actor)));
  ipcMain.handle('recipe:foodCostAlerts', wrapF((actor, opts) => store.getFoodCostAlerts(actor, opts || {})));
  ipcMain.handle('recipe:posSubs', wrapF((ingredientId, actor) => store.listPosSubstitutionsForIngredient(ingredientId, actor)));
  ipcMain.handle('recipe:exportBundle', wrapF((actor) => store.exportRecipeBundle(actor)));
  ipcMain.handle('recipe:importBundle', wrapF((bundle, actor) => store.importRecipeBundle(bundle || {}, actor)));
  ipcMain.handle('recipe:accessList', wrapF((actor) => { store.assertCanManageRecipeAccess(actor); return store.getRecipeAccessList(); }));
  ipcMain.handle('recipe:listUsers', wrapF((actor) => store.listUsersForRecipeAccess(actor)));
  ipcMain.handle('recipe:setAccess', wrapF((data, actor) => store.setRecipeUserAccess(data, actor)));
  ipcMain.handle('recipe:removeAccess', wrapF((userId, actor) => { store.removeRecipeUserAccess(userId, actor); return true; }));
  ipcMain.handle('recipe:ingredients', wrapF((filters, actor) => store.listIngredients(filters || {}, actor)));
  ipcMain.handle('recipe:ingredient', wrapF((id, actor) => store.getIngredient(id, actor)));
  ipcMain.handle('recipe:list', wrapF((filters, actor) => store.listRecipes(filters || {}, actor)));
  ipcMain.handle('recipe:get', wrapF((id, actor) => { store.canAccessRecipeModule(actor); return store.getRecipeWithItems(id); }));
  ipcMain.handle('recipe:save', wrapF((data, actor) => store.saveRecipe(data, actor)));
  ipcMain.handle('recipe:submit', wrapF((id, actor) => store.submitRecipeForApproval(id, actor)));
  ipcMain.handle('recipe:approve', wrapF((id, actor) => store.approveRecipe(id, actor)));
  ipcMain.handle('recipe:reject', wrapF((id, notes, actor) => store.rejectRecipe(id, notes, actor)));
  ipcMain.handle('recipe:archive', wrapF((id, actor) => store.archiveRecipe(id, actor)));
  ipcMain.handle('recipe:delete', wrapF((id, actor) => { store.deleteRecipe(id, actor); return true; }));
  ipcMain.handle('recipe:createProduct', wrapF((id, data, actor) => store.createProductFromRecipe(id, data || {}, actor)));
  ipcMain.handle('recipe:calcCosting', wrapF((items, opts, actor) => { store.canAccessRecipeModule(actor); return store.computeRecipeCosting(items || [], opts || {}); }));
  ipcMain.handle('recipe:capacity', wrapF((id, actor) => store.calcProductionCapacity(id, actor)));
  ipcMain.handle('recipe:planProduction', wrapF((data, actor) => store.planProduction(data, actor)));
  ipcMain.handle('recipe:completeProduction', wrapF((data, actor) => store.completeProduction(data, actor)));
  ipcMain.handle('recipe:batches', wrapF((filters, actor) => store.listProductionBatches(filters || {}, actor)));
  ipcMain.handle('recipe:restock', wrapF((id, qty, actor) => store.smartRestock(id, qty, actor)));
  ipcMain.handle('recipe:wasteList', wrapF((filters, actor) => store.listRecipeWaste(filters || {}, actor)));
  ipcMain.handle('recipe:wasteRecord', wrapF((data, actor) => store.recordRecipeWaste(data, actor)));
  ipcMain.handle('recipe:wasteApprove', wrapF((id, actor) => store.approveRecipeWaste(id, actor)));
  ipcMain.handle('recipe:wasteReject', wrapF((id, actor) => { store.rejectRecipeWaste(id, actor); return true; }));
  ipcMain.handle('recipe:wasteUpdate', wrapF((id, data, actor) => store.updateRecipeWaste(id, data || {}, actor)));
  ipcMain.handle('recipe:wasteDelete', wrapF((id, actor) => { store.deleteRecipeWaste(id, actor); return true; }));
  ipcMain.handle('recipe:productionMeals', wrapF((actor, filters) => store.listProductionMeals(actor, filters || {})));
  ipcMain.handle('recipe:ingredientStockHistory', wrapF((filters, actor) => store.getIngredientStockHistory(filters || {}, actor)));
  ipcMain.handle('recipe:restockPreview', wrapF((data, actor) => store.computeRestockPreview(data || {}, actor)));
  ipcMain.handle('recipe:restockBatchHistory', wrapF((filters, actor) => store.listRestockBatches(filters || {}, actor)));
  ipcMain.handle('recipe:restockBatchDetail', wrapF((id, actor) => store.getRestockBatchDetail(id, actor)));
  ipcMain.handle('recipe:restockBatchSave', wrapF((data, actor) => store.restockIngredientsBatch(data || {}, actor)));
  ipcMain.handle('recipe:profitsLosses', wrapF((filters, actor) => store.getProfitsLosses(filters || {}, actor)));
  ipcMain.handle('recipe:listPurchaseOrders', wrapF((filters, actor) => store.listRecipePurchaseOrders(filters || {}, actor)));
  ipcMain.handle('recipe:ensureMealProfile', wrapF((productId, actor) => store.ensureApprovedProfileForMeal(productId, actor, { autoApprove: true })));
  ipcMain.handle('recipe:promos', wrapF((actor) => store.listRecipePromotions(actor)));
  ipcMain.handle('recipe:promoSave', wrapF((data, actor) => store.saveRecipePromotion(data, actor)));
  ipcMain.handle('recipe:dashboard', wrapF((actor) => store.getRecipeDashboard(actor)));
  ipcMain.handle('recipe:reports', wrapF((type, filters, actor) => store.getRecipeReports(type, filters || {}, actor)));
  ipcMain.handle('recipe:ai', wrapF((actor) => store.getAiSuggestions(actor)));
  ipcMain.handle('recipe:applySuggestedPrice', wrapF((data, actor) => store.applySuggestedSellPrice(data || {}, actor)));
  ipcMain.handle('recipe:activity', wrapF((limit, actor) => store.getRecipeActivity(limit || 50, actor)));
  ipcMain.handle('recipe:bestSellers', wrapF((period, actor) => store.getBestSellers(period || 'month', actor)));
  ipcMain.handle('recipe:setAvailableToday', wrapF((ids, actor) => { store.setAvailableToday(ids || [], actor); return true; }));
  ipcMain.handle('recipe:requestSub', wrapF((data, actor) => store.requestSubstitution(data || {}, actor)));
  ipcMain.handle('recipe:listSubs', wrapF((filters, actor) => store.listSubstitutions(filters || {}, actor)));
  ipcMain.handle('recipe:approveSub', wrapF((id, actor) => store.approveSubstitution(id, actor)));
  ipcMain.handle('recipe:rejectSub', wrapF((id, actor) => { store.rejectSubstitution(id, actor); return true; }));
  ipcMain.handle('recipe:forecast', wrapF((days, actor) => store.getStockForecast(actor, days || 14)));
  ipcMain.handle('recipe:mealProducts', wrapF((filters, actor) => store.listMealProducts(filters || {}, actor)));
  ipcMain.handle('recipe:getMeal', wrapF((id, actor, opts) => store.getProductMealRecipe(id, actor, opts || { for_editor: true })));
  ipcMain.handle('recipe:saveMeal', wrapF((data, actor) => store.saveProductMealRecipe(data || {}, actor)));
  ipcMain.handle('recipe:ingredientCatalog', wrapF((actor) => store.listIngredientCatalog(actor)));
  ipcMain.handle('recipe:restockIngredient', wrapF((data, actor) => store.restockIngredient(data || {}, actor)));
  ipcMain.handle('recipe:ensureIngredient', wrapF((data, actor) => store.ensureIngredient(data || {}, actor)));
  ipcMain.handle('recipe:updateIngredient', wrapF((data, actor) => store.updateIngredient(data || {}, actor)));
  ipcMain.handle('recipe:deleteIngredient', wrapF((id, actor) => { store.deleteIngredient(id, actor); return true; }));
  ipcMain.handle('recipe:restockPlan', wrapF((target, actor) => store.calculateRestockPlan(target, actor)));
  ipcMain.handle('recipe:setPosMenuFlags', wrapF((data, actor) => { store.setPosMenuFlags(data || {}, actor); return true; }));
  ipcMain.handle('recipe:restockList', wrapF((actor) => store.listRestockIngredients(actor)));
  ipcMain.handle('recipe:ingredientGroups', wrapF((actor) => store.listIngredientGroups(actor)));
  ipcMain.handle('recipe:ingredientGroup', wrapF((id, actor) => store.getIngredientGroup(id, actor)));
  ipcMain.handle('recipe:saveIngredientGroup', wrapF((data, actor) => store.saveIngredientGroup(data || {}, actor)));
  ipcMain.handle('recipe:deleteIngredientGroup', wrapF((id, actor) => store.deleteIngredientGroup(id, actor)));
  ipcMain.handle('recipe:expandIngredientGroups', wrapF((ids, actor) => store.expandIngredientGroups(ids || [], actor)));
  ipcMain.handle('recipe:productionAvailability', wrapF((productId, actor) => store.getProductionAvailability(productId, actor)));
  ipcMain.handle('recipe:productionDashboard', wrapF((actor) => store.getLiveProductionDashboard(actor)));
  ipcMain.handle('recipe:refreshProduction', wrapF((actor) => store.refreshProductionAvailability(actor)));
  ipcMain.handle('recipe:productRestock', wrapF((productId, targetQty, actor) => store.getProductRestockRecommendation(productId, targetQty, actor)));

  // Accounting Command Centre (acc:*)
  const acc = (fn) => wrapF((...args) => {
    store.ensureReady?.();
    return fn(...args);
  });
  const accA = (a) => a || null;
  ipcMain.handle('acc:login', wrapF((username, password) => store.accountingLogin(username, password)));
  ipcMain.handle('acc:sessionFromPos', wrapF((actor) => store.accountingSessionFromPos(actor || store.getUserSession())));
  ipcMain.handle('acc:logout', wrapF(() => store.accountingLogout()));
  ipcMain.handle('acc:dashboard', acc((f, actor) => store.getAccDashboard(f || {}, accA(actor))));
  ipcMain.handle('acc:search', acc((q, actor) => store.globalSearch(q, accA(actor))));
  ipcMain.handle('acc:settings', acc(() => store.getAccSettings()));
  ipcMain.handle('acc:saveSettings', acc((data, actor) => store.saveAccSettings(data || {}, accA(actor))));
  ipcMain.handle('acc:accounts', acc((f, actor) => store.listAccounts(f || {}, accA(actor))));
  ipcMain.handle('acc:saveAccount', acc((data, actor) => store.saveAccount(data || {}, accA(actor))));
  ipcMain.handle('acc:setAccountActive', acc((id, active, actor) => store.setAccountActive(id, active, accA(actor))));
  ipcMain.handle('acc:journals', acc((f, actor) => store.listJournals(f || {}, accA(actor))));
  ipcMain.handle('acc:getJournal', acc((id) => store.getJournal(id)));
  ipcMain.handle('acc:postJournal', acc((data, actor) => store.postJournal(data || {}, accA(actor))));
  ipcMain.handle('acc:publishJournal', acc((id, actor) => store.publishJournal(id, accA(actor))));
  ipcMain.handle('acc:reverseJournal', acc((id, actor) => store.reverseJournal(id, accA(actor))));
  ipcMain.handle('acc:ledger', acc((f, actor) => store.listLedger(f || {}, accA(actor))));
  ipcMain.handle('acc:trialBalance', acc((asOf, actor) => store.trialBalance(asOf, accA(actor))));
  ipcMain.handle('acc:profitLoss', acc((from, to, actor) => store.profitAndLoss(from, to, accA(actor))));
  ipcMain.handle('acc:balanceSheet', acc((asOf, actor) => store.balanceSheet(asOf, accA(actor))));
  ipcMain.handle('acc:cashFlow', acc((from, to, actor) => store.cashFlow(from, to, accA(actor))));
  ipcMain.handle('acc:periods', acc((actor) => store.listPeriods(accA(actor))));
  ipcMain.handle('acc:closePeriod', acc((id, actor) => store.closePeriod(id, accA(actor))));
  ipcMain.handle('acc:reopenPeriod', acc((id, actor) => store.reopenPeriod(id, accA(actor))));
  ipcMain.handle('acc:lockPeriod', acc((id, actor) => store.lockPeriod(id, accA(actor))));
  ipcMain.handle('acc:yearEnd', acc((actor) => store.runYearEnd(accA(actor))));
  ipcMain.handle('acc:invoices', acc((f, actor) => store.listInvoices(f || {}, accA(actor))));
  ipcMain.handle('acc:getInvoice', acc((id) => store.getInvoice(id)));
  ipcMain.handle('acc:saveInvoice', acc((data, actor) => store.saveInvoice(data || {}, accA(actor))));
  ipcMain.handle('acc:postInvoice', acc((id, actor) => store.postInvoice(id, accA(actor))));
  ipcMain.handle('acc:creditNotes', acc((f, actor) => store.listCreditNotes(f || {}, accA(actor))));
  ipcMain.handle('acc:saveCreditNote', acc((data, actor) => store.saveCreditNote(data || {}, accA(actor))));
  ipcMain.handle('acc:postCreditNote', acc((id, actor) => store.postCreditNote(id, accA(actor))));
  ipcMain.handle('acc:debitNotes', acc((actor) => store.listDebitNotes(accA(actor))));
  ipcMain.handle('acc:saveDebitNote', acc((data, actor) => store.saveDebitNote(data || {}, accA(actor))));
  ipcMain.handle('acc:bills', acc((f, actor) => store.listBills(f || {}, accA(actor))));
  ipcMain.handle('acc:saveBill', acc((data, actor) => store.saveBill(data || {}, accA(actor))));
  ipcMain.handle('acc:postBill', acc((id, actor) => store.postBill(id, accA(actor))));
  ipcMain.handle('acc:payments', acc((f, actor) => store.listPayments(f || {}, accA(actor))));
  ipcMain.handle('acc:savePayment', acc((data, actor) => store.savePayment(data || {}, accA(actor))));
  ipcMain.handle('acc:refunds', acc((actor) => store.listRefunds(accA(actor))));
  ipcMain.handle('acc:saveRefund', acc((data, actor) => store.saveRefund(data || {}, accA(actor))));
  ipcMain.handle('acc:agingAr', acc((asOf, actor) => store.arAging(asOf, accA(actor))));
  ipcMain.handle('acc:agingAp', acc((asOf, actor) => store.apAging(asOf, accA(actor))));
  ipcMain.handle('acc:customerStatement', acc((id, from, to, actor) => store.customerStatement(id, from, to, accA(actor))));
  ipcMain.handle('acc:supplierStatement', acc((id, from, to, actor) => store.supplierStatement(id, from, to, accA(actor))));
  ipcMain.handle('acc:bankAccounts', acc((actor) => store.listBankAccounts(accA(actor))));
  ipcMain.handle('acc:saveBankAccount', acc((data, actor) => store.saveBankAccount(data || {}, accA(actor))));
  ipcMain.handle('acc:bankTxns', acc((f, actor) => store.listBankTxns(f || {}, accA(actor))));
  ipcMain.handle('acc:saveBankTxn', acc((data, actor) => store.saveBankTxn(data || {}, accA(actor))));
  ipcMain.handle('acc:importBankStmt', acc((bankId, lines, actor) => store.importBankStatement(bankId, lines || [], accA(actor))));
  ipcMain.handle('acc:matchBankStmt', acc((lineId, txnId, actor) => store.matchBankStmtLine(lineId, txnId, accA(actor))));
  ipcMain.handle('acc:createReconciliation', acc((data, actor) => store.createReconciliation(data || {}, accA(actor))));
  ipcMain.handle('acc:completeReconciliation', acc((id, actor) => store.completeReconciliation(id, accA(actor))));
  ipcMain.handle('acc:cashAccounts', acc((actor) => store.listCashAccounts(accA(actor))));
  ipcMain.handle('acc:cashTxns', acc((f, actor) => store.listCashTxns(f || {}, accA(actor))));
  ipcMain.handle('acc:saveCashTxn', acc((data, actor) => store.saveCashTxn(data || {}, accA(actor))));
  ipcMain.handle('acc:pettyCash', acc((actor) => store.listPettyCash(accA(actor))));
  ipcMain.handle('acc:savePettyCash', acc((data, actor) => store.savePettyCashExpense(data || {}, accA(actor))));
  ipcMain.handle('acc:cashupFinance', acc((data, actor) => store.saveCashupFinance(data || {}, accA(actor))));
  ipcMain.handle('acc:expenses', acc((f, actor) => store.listAccExpenses(f || {}, accA(actor))));
  ipcMain.handle('acc:recordExpense', acc((data, actor) => store.recordExpenseViaAccounting(data || {}, accA(actor))));
  ipcMain.handle('acc:recurring', acc((actor) => store.listRecurring(accA(actor))));
  ipcMain.handle('acc:saveRecurring', acc((data, actor) => store.saveRecurring(data || {}, accA(actor))));
  ipcMain.handle('acc:processRecurring', acc((actor) => store.processDueRecurring(accA(actor))));
  ipcMain.handle('acc:otherIncome', acc((actor) => store.listOtherIncome(accA(actor))));
  ipcMain.handle('acc:saveOtherIncome', acc((data, actor) => store.saveOtherIncome(data || {}, accA(actor))));
  ipcMain.handle('acc:assets', acc((actor) => store.listAssets(accA(actor))));
  ipcMain.handle('acc:saveAsset', acc((data, actor) => store.saveAsset(data || {}, accA(actor))));
  ipcMain.handle('acc:runDepreciation', acc((asOf, actor) => store.runDepreciation(asOf, accA(actor))));
  ipcMain.handle('acc:loans', acc((actor) => store.listLoans(accA(actor))));
  ipcMain.handle('acc:saveLoan', acc((data, actor) => store.saveLoan(data || {}, accA(actor))));
  ipcMain.handle('acc:loanPayment', acc((data, actor) => store.recordLoanPayment(data || {}, accA(actor))));
  ipcMain.handle('acc:ownerTxns', acc((actor) => store.listOwnerTxns(accA(actor))));
  ipcMain.handle('acc:saveOwnerTxn', acc((data, actor) => store.saveOwnerTxn(data || {}, accA(actor))));
  ipcMain.handle('acc:taxRates', acc((actor) => store.listTaxRates(accA(actor))));
  ipcMain.handle('acc:saveTaxRate', acc((data, actor) => store.saveTaxRate(data || {}, accA(actor))));
  ipcMain.handle('acc:taxSummary', acc((from, to, actor) => store.taxSummary(from, to, accA(actor))));
  ipcMain.handle('acc:salesReport', acc((from, to, actor) => store.salesReport(from, to, accA(actor))));
  ipcMain.handle('acc:purchaseReport', acc((from, to, actor) => store.purchaseReport(from, to, accA(actor))));
  ipcMain.handle('acc:expenseReport', acc((from, to, actor) => store.expenseReport(from, to, accA(actor))));
  ipcMain.handle('acc:stockValue', acc((actor) => store.stockValueReport(accA(actor))));
  ipcMain.handle('acc:drillDown', acc((metric, from, to, actor) => store.drillDown(metric, from, to, accA(actor))));
  ipcMain.handle('acc:documents', acc((f, actor) => store.listDocuments(f || {}, accA(actor))));
  ipcMain.handle('acc:saveDocument', acc((data, actor) => store.saveDocument(data || {}, accA(actor))));
  ipcMain.handle('acc:recordStockAdjustment', acc((data, actor) => store.recordStockAdjustment(data || {}, accA(actor))));
  ipcMain.handle('acc:stockAdjustments', acc((f, actor) => { accA(actor); return store.listStockAdjustments(f || {}); }));
  ipcMain.handle('acc:getDocumentFile', acc((id, actor) => store.getDocumentFile(id, accA(actor))));
  ipcMain.handle('acc:processOcr', acc((id, actor) => store.processOcrDocument(id, accA(actor))));
  ipcMain.handle('acc:confirmOcr', acc((id, data, actor) => store.confirmOcrDocument(id, data || {}, accA(actor))));
  ipcMain.handle('acc:approvals', acc((f, actor) => store.listApprovals(f || {}, accA(actor))));
  ipcMain.handle('acc:decideApproval', acc((id, decision, notes, actor) => store.decideApproval(id, decision, notes, accA(actor))));
  ipcMain.handle('acc:notifications', acc((actor) => store.listNotifications(accA(actor))));
  ipcMain.handle('acc:readNotification', acc((id, actor) => store.markNotificationRead(id, accA(actor))));
  ipcMain.handle('acc:audit', acc((f, actor) => store.listAudit(f || {}, accA(actor))));
  ipcMain.handle('acc:integrations', acc((f, actor) => store.listIntegrationErrors(f || {}, accA(actor))));
  ipcMain.handle('acc:retryIntegration', acc((id, actor) => store.retryIntegrationError(id, accA(actor))));
  ipcMain.handle('acc:financialHealth', acc((f, actor) => store.getFinancialHealth(f || {}, accA(actor))));
  ipcMain.handle('acc:reconcileCentre', acc((actor) => store.listReconcileCentre(accA(actor))));
  ipcMain.handle('acc:bankStmtLines', acc((f, actor) => store.listBankStatementLines(f || {}, accA(actor))));
  ipcMain.handle('acc:listCashupFinance', acc((f, actor) => store.listCashupFinance(f || {}, accA(actor))));
  ipcMain.handle('acc:syncMissing', acc((actor) => store.syncMissingIntegrations(accA(actor))));
  ipcMain.handle('acc:purchaseOrders', acc((actor) => store.listPurchaseOrders(accA(actor))));
  ipcMain.handle('acc:payroll', acc((actor) => store.listPayrollSummary(accA(actor))));
  ipcMain.handle('acc:integrate', acc((payload) => {
    const central = require('./services/accounting-central');
    return central.runIntegratePayload(payload || {});
  }));
  ipcMain.handle('acc:flushIntegrations', acc(() => {
    requireUserSession(['owner', 'manager']);
    const central = require('./services/accounting-central');
    return central.flushIntegrationOutbox();
  }));
  ipcMain.handle('acc:reflushFailedIntegrations', acc(() => {
    requireUserSession(['owner', 'manager']);
    const central = require('./services/accounting-central');
    return central.reflushFailedIntegrations();
  }));

  const delivery = require('./services/delivery-platform');
  const deliveryActor = () => requireUserSession(['owner', 'manager', 'supervisor', 'assistant_manager', 'delivery_manager', 'cashier']);
  ipcMain.handle('delivery:dashboard', wrap((filters, actor) => {
    const user = actor || deliveryActor();
    return delivery.deliveryDashboard(filters || {}, user);
  }));
  ipcMain.handle('delivery:list', wrap((filters, actor) => {
    const user = actor || deliveryActor();
    const { assertUserPermission } = require('./services/authz');
    assertUserPermission(user, 'delivery', ['owner', 'manager', 'supervisor', 'assistant_manager', 'cashier', 'delivery_manager']);
    return delivery.listDeliveries(filters || {}, user);
  }));
  ipcMain.handle('delivery:get', wrap((id, actor) => {
    deliveryActor();
    return delivery.getDelivery(id);
  }));
  ipcMain.handle('delivery:drivers', wrap((filters, actor) => {
    deliveryActor();
    return delivery.listDrivers(filters || {});
  }));
  ipcMain.handle('delivery:getDriver', wrap((id) => {
    deliveryActor();
    return delivery.getDriver(id);
  }));
  ipcMain.handle('delivery:saveDriver', wrap((data, actor) => {
    const user = actor || deliveryActor();
    return delivery.saveDriver(data || {}, user);
  }));
  ipcMain.handle('delivery:approveDriver', wrap((id, actor) => {
    const user = actor || deliveryActor();
    return delivery.approveDriver(id, user);
  }));
  ipcMain.handle('delivery:rejectDriver', wrap((id, reason, actor) => {
    const user = actor || deliveryActor();
    return delivery.rejectDriver(id, reason, user);
  }));
  ipcMain.handle('delivery:registerDriver', wrap((data) => delivery.registerDriver(data || {})));
  ipcMain.handle('delivery:adminRegisterDriver', wrap((data, actor) => {
    const user = actor || deliveryActor();
    return delivery.adminRegisterDriver(data || {}, user);
  }));
  ipcMain.handle('delivery:releaseToPool', wrap((id, actor) => {
    const user = actor || deliveryActor();
    return delivery.releaseToDriverPool(id, user);
  }));
  ipcMain.handle('delivery:assign', wrap((id, driverId, actor, opts) => {
    const user = actor || deliveryActor();
    return delivery.assignDriver(id, driverId, user, opts || {});
  }));
  ipcMain.handle('delivery:autoAssign', wrap((id, actor) => {
    const user = actor || deliveryActor();
    return delivery.autoAssignDriver(id, user);
  }));
  ipcMain.handle('delivery:assignMultiple', wrap((ids, driverId, actor, opts) => {
    const user = actor || deliveryActor();
    return delivery.assignMultipleOrders(ids, driverId, user, opts || {});
  }));
  ipcMain.handle('delivery:updateStatus', wrap((id, status, notes, actor) => {
    const user = actor || deliveryActor();
    return delivery.updateDeliveryStatus(id, status, user, { notes });
  }));
  ipcMain.handle('delivery:updateDelivery', wrap((id, data, actor) => {
    const user = actor || deliveryActor();
    return delivery.updateDeliveryAdmin(id, data || {}, user);
  }));
  ipcMain.handle('delivery:cancelDelivery', wrap((id, actor) => {
    const user = actor || deliveryActor();
    return delivery.cancelDeliveryAdmin(id, user);
  }));
  ipcMain.handle('delivery:settings', wrap((actor) => {
    const user = actor || deliveryActor();
    return delivery.getSettings(user);
  }));
  ipcMain.handle('delivery:saveSettings', wrap((data, actor) => {
    const user = actor || deliveryActor();
    return delivery.saveSettings(data || {}, user);
  }));
  ipcMain.handle('delivery:branchSettings', wrap((branchId, actor) => {
    deliveryActor();
    return delivery.getBranchSettings(branchId);
  }));
  ipcMain.handle('delivery:saveBranchSettings', wrap((branchId, data, actor) => {
    const user = actor || deliveryActor();
    return delivery.saveBranchSettings(branchId, data || {}, user);
  }));
  ipcMain.handle('delivery:listBranchSettings', wrap((actor) => {
    deliveryActor();
    return delivery.listAllBranchSettings();
  }));
  ipcMain.handle('delivery:deleteBranchSettings', wrap((branchId, actor) => {
    const user = actor || deliveryActor();
    return delivery.deleteBranchSettings(branchId, user);
  }));
  ipcMain.handle('delivery:suspendDriver', wrap((id, actor) => {
    const user = actor || deliveryActor();
    return delivery.suspendDriver(id, user);
  }));
  ipcMain.handle('delivery:deleteDriver', wrap((id, actor) => {
    const user = actor || deliveryActor();
    return delivery.deleteDriver(id, user);
  }));
  ipcMain.handle('delivery:driverEarnings', wrap((driverId, filters, actor) => {
    deliveryActor();
    return delivery.driverEarningsReport(driverId, filters || {});
  }));
  ipcMain.handle('delivery:reports', wrap((filters, actor) => {
    const user = actor || deliveryActor();
    return delivery.deliveryReports(filters || {}, user);
  }));
  ipcMain.handle('delivery:tracking', wrap((token) => delivery.getDeliveryByTracking(token)));
  ipcMain.handle('delivery:driverPaymentSummary', wrap((actor) => {
    const user = actor || deliveryActor();
    return delivery.listDriverPaymentSummary(user);
  }));
  ipcMain.handle('delivery:previewDriverPayout', wrap((driverId, data, actor) => {
    const user = actor || deliveryActor();
    return delivery.previewDriverPayout(driverId, data?.period_from || data?.from, data?.period_to || data?.to, user);
  }));
  ipcMain.handle('delivery:recordDriverPayout', wrap((driverId, data, actor) => {
    const user = actor || deliveryActor();
    return delivery.recordDriverPayout(driverId, data || {}, user);
  }));
  ipcMain.handle('delivery:driverPayoutHistory', wrap((driverId, filters, actor) => {
    const user = actor || deliveryActor();
    return delivery.getDriverPayoutHistory(driverId, filters || {}, user);
  }));
  ipcMain.handle('delivery:listPayoutClaims', wrap((filters, actor) => {
    const user = actor || deliveryActor();
    return delivery.listPayoutClaims(filters || {}, user);
  }));
  ipcMain.handle('delivery:approvePayoutClaim', wrap((id, notes, actor) => {
    const user = actor || deliveryActor();
    return delivery.approvePayoutClaim(id, notes, user);
  }));
  ipcMain.handle('delivery:rejectPayoutClaim', wrap((id, reason, actor) => {
    const user = actor || deliveryActor();
    return delivery.rejectPayoutClaim(id, reason, user);
  }));
  ipcMain.handle('driver:login', wrap((username, password, device) => delivery.driverLogin(username, password, device || {})));
  ipcMain.handle('driver:logout', wrap((token) => delivery.driverLogout(token)));
  ipcMain.handle('driver:dashboard', wrap((token) => delivery.driverDashboard(token)));
  ipcMain.handle('driver:orders', wrap((token, filters) => delivery.driverListOrders(token, filters || {})));
  ipcMain.handle('driver:accept', wrap((token, id) => delivery.driverAcceptDelivery(token, id)));
  ipcMain.handle('driver:reject', wrap((token, id, reason) => delivery.driverRejectDelivery(token, id, reason)));
  ipcMain.handle('driver:release', wrap((token, id, reason) => delivery.driverReleaseDelivery(token, id, reason)));
  ipcMain.handle('driver:updateStatus', wrap((token, id, status, notes) => delivery.driverUpdateStatus(token, id, status, { notes })));
  ipcMain.handle('driver:availability', wrap((token, availability) => delivery.setDriverAvailability(token, availability)));
  ipcMain.handle('driver:history', wrap((token, filters) => delivery.driverHistory(token, filters || {})));
  ipcMain.handle('driver:earnings', wrap((token, filters) => delivery.driverEarnings(token, filters || {})));
  ipcMain.handle('driver:payments', wrap((token, filters) => delivery.driverPayments(token, filters || {})));
  ipcMain.handle('driver:profile', wrap((token) => delivery.driverGetProfile(token)));
  ipcMain.handle('driver:updateProfile', wrap((token, data) => delivery.driverUpdateProfile(token, data || {})));
  ipcMain.handle('driver:submitClaim', wrap((token) => delivery.submitPayoutClaim(token)));

  const referral = require('./services/referral-commission');
  const refAdmin = () => requireUserSession(['owner', 'manager', 'assistant_manager']);
  const refAny = () => requireUserSession(['owner', 'manager', 'assistant_manager', 'referral_agent']);
  ipcMain.handle('referral:dashboard', wrap((filters, actor) => referral.getAdminDashboard(filters || {}, actor || refAdmin())));
  ipcMain.handle('referral:applications', wrap((filters, actor) => referral.listApplications(filters || {}, actor || refAdmin())));
  ipcMain.handle('referral:getAgent', wrap((id, actor, opts) => referral.getAgent(id, actor || refAdmin(), opts || {})));
  ipcMain.handle('referral:approveAgent', wrap((id, actor, opts) => referral.approveAgent(id, actor || refAdmin(), opts || {})));
  ipcMain.handle('referral:rejectAgent', wrap((id, reason, actor) => referral.rejectAgent(id, reason, actor || refAdmin())));
  ipcMain.handle('referral:underReview', wrap((id, actor) => referral.setUnderReview(id, actor || refAdmin())));
  ipcMain.handle('referral:suspendAgent', wrap((id, actor) => referral.suspendAgent(id, actor || refAdmin())));
  ipcMain.handle('referral:unsuspendAgent', wrap((id, actor) => referral.unsuspendAgent(id, actor || refAdmin())));
  ipcMain.handle('referral:updateAgent', wrap((id, data, actor) => referral.updateAgent(id, data || {}, actor || refAdmin())));
  ipcMain.handle('referral:deleteAgent', wrap((id, actor) => referral.deleteAgent(id, actor || refAdmin())));
  ipcMain.handle('referral:clearAttribution', wrap((data, actor) => referral.clearCustomerAttribution(data || {}, actor || refAdmin())));
  ipcMain.handle('referral:clearSaleReferral', wrap((saleId, actor) => referral.clearSaleReferral(saleId, actor || refAdmin())));
  ipcMain.handle('referral:awardCommission', wrap((id, data, actor) => referral.awardManualCommission(id, data || {}, actor || refAdmin())));
  ipcMain.handle('referral:listAwardRequests', wrap((filters, actor) => referral.listAwardRequests(filters || {}, actor || refAdmin())));
  ipcMain.handle('referral:getAwardRequest', wrap((id, actor) => referral.getAwardRequest(id, actor || refAdmin())));
  ipcMain.handle('referral:decideAwardRequest', wrap((id, data, actor) => referral.decideAwardRequest(id, data || {}, actor || requireUserSession(['owner', 'assistant_manager']))));
  ipcMain.handle('referral:searchCodes', wrap((q) => referral.searchReferralCodes(q)));
  ipcMain.handle('referral:agents', wrap((filters, actor) => referral.listAgents(filters || {}, actor || refAdmin())));
  ipcMain.handle('referral:commissions', wrap((filters, actor) => referral.listCommissions(filters || {}, actor || refAdmin())));
  ipcMain.handle('referral:approveCommission', wrap((id, actor) => referral.approveCommission(id, actor || refAdmin())));
  ipcMain.handle('referral:markAvailable', wrap((actor) => referral.markCommissionsAvailable(actor || refAdmin())));
  ipcMain.handle('referral:payouts', wrap((filters, actor) => referral.listPayouts(filters || {}, actor || refAdmin())));
  ipcMain.handle('referral:getPayout', wrap((id, actor) => referral.getPayout(id, actor || refAdmin())));
  ipcMain.handle('referral:generatePayout', wrap((data, actor) => referral.generatePayoutBatch(data || {}, actor || refAdmin())));
  ipcMain.handle('referral:approvePayout', wrap((id, actor) => referral.approvePayout(id, actor || refAdmin())));
  ipcMain.handle('referral:markPayoutPaid', wrap((id, data, actor) => referral.markPayoutPaid(id, data || {}, actor || refAdmin())));
  ipcMain.handle('referral:claimWallet', wrap((actor) => referral.claimWalletPayout(actor || refAny())));
  ipcMain.handle('referral:getPayslip', wrap((id, actor) => referral.getAgentPayslip(id, actor || refAny())));
  ipcMain.handle('referral:settings', wrap((actor) => { refAdmin(); return referral.getSettings(); }));
  ipcMain.handle('referral:updateSettings', wrap((data, actor) => referral.updateSettings(data || {}, actor || refAdmin())));
  ipcMain.handle('referral:attributions', wrap((filters, actor) => referral.listAttributions(filters || {}, actor || refAdmin())));
  ipcMain.handle('referral:codes', wrap((actor) => referral.listCodes(actor || refAdmin())));
  ipcMain.handle('referral:topAgents', wrap((filters, actor) => referral.getTopAgents(filters || {}, actor || refAdmin())));
  ipcMain.handle('referral:audit', wrap((filters, actor) => referral.listAudit(filters || {}, actor || refAdmin())));
  ipcMain.handle('referral:fraud', wrap((actor) => referral.listFraud(actor || refAdmin())));
  ipcMain.handle('referral:approveBankChange', wrap((id, actor) => referral.approveBankChange(id, actor || refAdmin())));
  ipcMain.handle('referral:apply', wrap((data) => referral.applyAsAgent(data || {})));
  ipcMain.handle('referral:agentDashboard', wrap((actor) => referral.getAgentDashboard(actor || refAny())));
  ipcMain.handle('referral:unreadNotifications', wrap((filters, actor) => referral.listUnreadNotifications(filters || {}, actor || refAny())));
  ipcMain.handle('referral:ackNotification', wrap((id, meta, actor) => referral.ackReferralNotification(id, meta || {}, actor || refAny())));
  ipcMain.handle('referral:ackAllNotifications', wrap((filters, actor) => referral.ackAllReferralNotifications(filters || {}, actor || refAny())));
  ipcMain.handle('referral:requestBankChange', wrap((data, actor) => referral.requestBankChange(data || {}, actor || refAny())));
  ipcMain.handle('referral:validateCode', wrap((code) => referral.validateReferralCode(code)));
  ipcMain.handle('referral:recordClick', wrap((code, meta) => referral.recordClick(code, meta || {})));
  ipcMain.handle('referral:attribute', wrap((data, actor) => referral.attributeCustomer({ ...(data || {}), actor: actor || refAdmin() })));
  ipcMain.handle('referral:resetAgentPassword', wrap((id, actor, opts) => referral.adminResetAgentPassword(id, actor || refAdmin(), opts || {})));
  ipcMain.handle('referral:ensureAgentLogin', wrap((id, actor) => {
    const admin = actor || refAdmin();
    const { getDb } = require('./database/db');
    const agent = getDb().prepare('SELECT * FROM referral_agents WHERE id=?').get(id);
    if (!agent) throw new Error('Agent not found');
    if (!agent.password_hash) throw new Error('No password on file — use Reset password (WhatsApp) first');
    referral.ensureAgentUserAccount(agent);
    return { success: true, username: agent.username, fixed_by: admin?.username || null };
  }));

  const hrA = (actor) => actor || store.getUserSession();
  const hr = (fn) => wrapF((...args) => {
    try { return fn(...args); }
    catch (err) { return { success: false, error: err.message || String(err) }; }
  });
  ipcMain.handle('hr:login', (_e, username, password) => {
    try {
      const r = store.hrLogin(username, password);
      if (!r || r.success === false) return { success: false, error: r?.error || 'Login failed' };
      return { success: true, data: r.data ?? r.user };
    } catch (err) {
      return { success: false, error: err.message || String(err) };
    }
  });
  ipcMain.handle('hr:dashboard', hr((f, actor) => store.getHrDashboard(f || {}, hrA(actor))));
  ipcMain.handle('hr:search', hr((q, actor) => store.hrGlobalSearch(q, hrA(actor))));
  ipcMain.handle('hr:settings', hr((actor) => store.getHrSettings(hrA(actor))));
  ipcMain.handle('hr:saveSettings', hr((data, actor) => store.saveHrSettings(data || {}, hrA(actor))));
  ipcMain.handle('hr:people', hr((f, actor) => store.listPeople(f || {}, hrA(actor))));
  ipcMain.handle('hr:listPayroll', hr((f, actor) => store.listPayrollRecords(f || {}, hrA(actor))));
  ipcMain.handle('hr:attendanceHub', hr((f, actor) => store.listAttendanceHub(f || {}, hrA(actor))));
  ipcMain.handle('hr:schedules', hr((f, actor) => store.listShiftSchedules(f || {}, hrA(actor))));
  ipcMain.handle('hr:leaveBalances', hr((actor) => store.listLeaveBalances(hrA(actor))));
  ipcMain.handle('hr:employeeDocuments', hr((f, actor) => store.listAllEmployeeDocuments(f || {}, hrA(actor))));
  ipcMain.handle('hr:offboardingList', hr((f, actor) => store.listOffboardingRecords(f || {}, hrA(actor))));
  ipcMain.handle('hr:onboardingList', hr((actor) => store.listOnboardingProgressAll(hrA(actor))));
  ipcMain.handle('hr:payrollDeductions', hr((f, actor) => store.listPayrollDeductions(f || {}, hrA(actor))));
  ipcMain.handle('hr:statutorySummary', hr((f, actor) => store.getStatutorySummary(f || {}, hrA(actor))));
  ipcMain.handle('hr:performanceHub', hr((f, actor) => store.getPerformanceHub(f || {}, hrA(actor))));
  ipcMain.handle('hr:staffWarnings', hr((f, actor) => store.listStaffWarnings(f || {}, hrA(actor))));
  ipcMain.handle('hr:employeeProfile', hr((id, actor) => store.getEmployeeProfile(id, hrA(actor))));
  ipcMain.handle('hr:employeeTimeline', hr((id, actor) => store.getEmployeeTimeline(id, hrA(actor))));
  ipcMain.handle('hr:approvals', hr((f, actor) => store.listApprovals(f || {}, hrA(actor))));
  ipcMain.handle('hr:submitForApproval', hr((data, actor) => store.submitHrForApproval(data || {}, hrA(actor))));
  ipcMain.handle('hr:complianceCentre', hr((actor) => store.getComplianceCentre(hrA(actor))));
  ipcMain.handle('hr:complianceEvents', hr((f, actor) => store.listComplianceEvents(f || {}, hrA(actor))));
  ipcMain.handle('hr:saveComplianceEvent', hr((data, actor) => store.saveComplianceEvent(data || {}, hrA(actor))));
  ipcMain.handle('hr:policies', hr((f, actor) => store.listPolicies(f || {}, hrA(actor))));
  ipcMain.handle('hr:savePolicy', hr((data, actor) => store.savePolicy(data || {}, hrA(actor))));
  ipcMain.handle('hr:acknowledgePolicy', hr((policyId, employeeId, data, actor) => store.acknowledgePolicy(policyId, employeeId, data || {}, hrA(actor))));
  ipcMain.handle('hr:businessRules', hr((f, actor) => store.listBusinessRules(f || {}, hrA(actor))));
  ipcMain.handle('hr:saveBusinessRule', hr((data, actor) => store.saveBusinessRule(data || {}, hrA(actor))));
  ipcMain.handle('hr:incidents', hr((f, actor) => store.listIncidents(f || {}, hrA(actor))));
  ipcMain.handle('hr:saveIncident', hr((data, actor) => store.saveIncident(data || {}, hrA(actor))));
  ipcMain.handle('hr:disciplinaryCases', hr((f, actor) => store.listDisciplinaryCases(f || {}, hrA(actor))));
  ipcMain.handle('hr:saveDisciplinaryCase', hr((data, actor) => store.saveDisciplinaryCase(data || {}, hrA(actor))));

  const mgrHr = require('./services/mgr-hr-portal');
  const mgrHrA = (actor) => actor || store.getUserSession();
  const mgrHrWrap = (fn) => wrap((...args) => {
    try { mgrHr.ensureSchema(); return fn(...args); }
    catch (err) { return { success: false, error: err.message || String(err) }; }
  });
  ipcMain.handle('mgrHr:listAssignments', mgrHrWrap((actor) => mgrHr.listAssignments(mgrHrA(actor))));
  ipcMain.handle('mgrHr:getAssignment', mgrHrWrap((id, actor) => mgrHr.getAssignment(id, mgrHrA(actor))));
  ipcMain.handle('mgrHr:saveAssignment', mgrHrWrap((data, actor) => mgrHr.saveAssignment(data || {}, mgrHrA(actor))));
  ipcMain.handle('mgrHr:setAssignmentActive', mgrHrWrap((id, active, actor) => mgrHr.setAssignmentActive(id, active, mgrHrA(actor))));
  ipcMain.handle('mgrHr:listEligibleUsers', mgrHrWrap((actor) => mgrHr.listEligibleUsers(mgrHrA(actor))));
  ipcMain.handle('mgrHr:listActivity', mgrHrWrap((f, actor) => mgrHr.listActivity(f || {}, mgrHrA(actor))));
  ipcMain.handle('mgrHr:portalContext', mgrHrWrap((actor) => mgrHr.getPortalContext(mgrHrA(actor))));
  ipcMain.handle('mgrHr:dashboard', mgrHrWrap((actor) => mgrHr.dashboard(mgrHrA(actor))));
  ipcMain.handle('mgrHr:listMyStaff', mgrHrWrap((actor) => mgrHr.listMyStaff(mgrHrA(actor))));
  ipcMain.handle('mgrHr:listCases', mgrHrWrap((f, actor) => mgrHr.listCases(f || {}, mgrHrA(actor))));
  ipcMain.handle('mgrHr:getCase', mgrHrWrap((id, actor) => mgrHr.getCase(id, mgrHrA(actor))));
  ipcMain.handle('mgrHr:createCase', mgrHrWrap((data, actor) => mgrHr.createCase(data || {}, mgrHrA(actor))));
  ipcMain.handle('mgrHr:updateStatus', mgrHrWrap((id, status, notes, actor) => mgrHr.updateCaseStatus(id, status, notes, mgrHrA(actor))));
  ipcMain.handle('mgrHr:requestResponse', mgrHrWrap((id, notes, actor) => mgrHr.requestEmployeeResponse(id, notes, mgrHrA(actor))));
  ipcMain.handle('mgrHr:addRecommendation', mgrHrWrap((id, data, actor) => mgrHr.addRecommendation(id, data || {}, mgrHrA(actor))));
  ipcMain.handle('mgrHr:createWarning', mgrHrWrap((id, data, actor) => mgrHr.createWarningFromCase(id, data || {}, mgrHrA(actor))));
  ipcMain.handle('mgrHr:adminDecide', mgrHrWrap((id, data, actor) => mgrHr.adminDecide(id, data || {}, mgrHrA(actor))));
  ipcMain.handle('mgrHr:deleteCase', mgrHrWrap((id, actor) => mgrHr.deleteCase(id, mgrHrA(actor))));
  ipcMain.handle('mgrHr:listNotifications', mgrHrWrap((audience, actor) => mgrHr.listNotifications(mgrHrA(actor), audience)));
  ipcMain.handle('mgrHr:markNotificationRead', mgrHrWrap((id, actor) => mgrHr.markNotificationRead(id, mgrHrA(actor))));
  ipcMain.handle('mgrHr:listEmployeeCases', mgrHrWrap((actor) => mgrHr.listEmployeeCases(actor || store.getEmployeeSession() || store.getUserSession())));
  ipcMain.handle('mgrHr:getEmployeeCase', mgrHrWrap((id, actor) => mgrHr.getEmployeeCase(id, actor || store.getEmployeeSession() || store.getUserSession())));
  ipcMain.handle('mgrHr:submitEmployeeResponse', mgrHrWrap((id, data, actor) => mgrHr.submitEmployeeResponse(id, data || {}, actor || store.getEmployeeSession() || store.getUserSession())));
  ipcMain.handle('mgrHr:listRecordings', mgrHrWrap((f, actor) => mgrHr.listRecordings(f || {}, mgrHrA(actor))));
  ipcMain.handle('mgrHr:getRecording', mgrHrWrap((id, actor) => mgrHr.getRecording(id, mgrHrA(actor))));
  ipcMain.handle('mgrHr:createRecording', mgrHrWrap((data, actor) => mgrHr.createRecording(data || {}, mgrHrA(actor))));
  ipcMain.handle('mgrHr:updateRecording', mgrHrWrap((id, data, actor) => mgrHr.updateRecording(id, data || {}, mgrHrA(actor))));
  ipcMain.handle('mgrHr:deleteRecording', mgrHrWrap((id, actor) => mgrHr.deleteRecording(id, mgrHrA(actor))));
  ipcMain.handle('mgrHr:analyzeRecording', mgrHrWrap((id, data, actor) => mgrHr.analyzeRecording(id, data || {}, mgrHrA(actor))));
  ipcMain.handle('mgrHr:recordingDocumentHtml', mgrHrWrap((id, actor) => {
    const rec = mgrHr.getRecording(id, mgrHrA(actor));
    let shop = 'Company';
    try {
      shop = require('./database/db').getDb().prepare('SELECT shop_name FROM shop_settings WHERE id=1').get()?.shop_name || shop;
    } catch (_) { /* ignore */ }
    return { html: mgrHr.buildRecordingDocumentHtml(rec, shop), recording: { ...rec, audio_data: undefined } };
  }));
  ipcMain.handle('mgrHr:caseDocumentHtml', mgrHrWrap((id, actor) => {
    const c = mgrHr.getCase(id, mgrHrA(actor));
    let shop = { shop_name: 'Company' };
    try {
      shop = require('./database/db').getDb().prepare(
        'SELECT shop_name, address, phone, email FROM shop_settings WHERE id=1'
      ).get() || shop;
    } catch (_) { /* ignore */ }
    return { html: mgrHr.buildCaseDocumentHtml(c, shop), case: { ...c, evidence_paths: undefined } };
  }));

  ipcMain.handle('hr:onboardingTemplates', hr((actor) => store.listOnboardingTemplates(hrA(actor))));
  ipcMain.handle('hr:onboardingProgress', hr((employeeId, actor) => store.getOnboardingProgress(employeeId, hrA(actor))));
  ipcMain.handle('hr:saveOnboardingProgress', hr((data, actor) => store.saveOnboardingProgress(data || {}, hrA(actor))));
  ipcMain.handle('hr:forms', hr((f, actor) => store.listForms(f || {}, hrA(actor))));
  ipcMain.handle('hr:saveForm', hr((data, actor) => store.saveForm(data || {}, hrA(actor))));
  ipcMain.handle('hr:createExternalLink', hr((data, actor) => store.createExternalLink(data || {}, hrA(actor))));
  ipcMain.handle('hr:requests', hr((f, actor) => store.listRequests(f || {}, hrA(actor))));
  ipcMain.handle('hr:saveRequest', hr((data, actor) => store.saveRequest(data || {}, hrA(actor))));
  ipcMain.handle('hr:decideRequest', hr((id, decision, notes, actor) => store.decideRequest(id, decision, notes, hrA(actor))));
  ipcMain.handle('hr:employerRecords', hr((f, actor) => store.listEmployerRecords(f || {}, hrA(actor))));
  ipcMain.handle('hr:saveEmployerRecord', hr((data, actor) => store.saveEmployerRecord(data || {}, hrA(actor))));
  ipcMain.handle('hr:salaryHistory', hr((employeeId, actor) => store.listSalaryHistory(employeeId, hrA(actor))));
  ipcMain.handle('hr:saveSalaryChange', hr((data, actor) => store.saveSalaryChange(data || {}, hrA(actor))));
  ipcMain.handle('hr:saveOffboarding', hr((data, actor) => store.saveOffboarding(data || {}, hrA(actor))));
  ipcMain.handle('hr:postPayrollAccounting', hr((payrollId, actor) => store.postPayrollToAccounting(payrollId, hrA(actor))));

  ipcMain.handle('whatsapp:getTemplates', wrapF((filters) => store.getWhatsAppTemplates(filters)));
  ipcMain.handle('whatsapp:getTemplate', wrapF((id) => store.getTemplate(id)));
  ipcMain.handle('whatsapp:saveTemplate', wrapF((data, actor) => store.saveTemplate(data, actor)));
  ipcMain.handle('whatsapp:deleteTemplate', wrapF((id, actor) => { store.deleteTemplate(id, actor); return true; }));
  ipcMain.handle('whatsapp:getMessages', wrapF((filters) => store.getMessages(filters)));
  ipcMain.handle('whatsapp:send', wrap((data, actor) => store.sendMessage(data, actor)));
  ipcMain.handle('whatsapp:markOpened', wrapF((id, actor) => store.markMessageOpened(id, actor)));
  ipcMain.handle('whatsapp:getAudience', wrapF((filter) => store.getAudience(filter)));
  ipcMain.handle('whatsapp:getCampaigns', wrapF((filters) => store.getCampaigns(filters)));
  ipcMain.handle('whatsapp:getCampaign', wrapF((id) => store.getCampaign(id)));
  ipcMain.handle('whatsapp:saveCampaign', wrapF((data, actor) => store.saveCampaign(data, actor)));
  ipcMain.handle('whatsapp:deleteCampaign', wrapF((id, actor) => { store.deleteCampaign(id, actor); return true; }));
  ipcMain.handle('whatsapp:sendCampaign', wrap((id, actor) => store.sendCampaign(id, actor)));
  ipcMain.handle('whatsapp:getSettings', wrapF(() => store.getWhatsAppSettings()));
  ipcMain.handle('whatsapp:saveSettings', wrapF((data, actor) => store.saveWhatsAppSettings(data, actor)));

  ipcMain.handle('documentHub:get', wrapF((filters) => store.getHubDocuments(filters)));
  ipcMain.handle('documentHub:getOne', wrapF((id) => store.getHubDocument(id)));
  ipcMain.handle('documentHub:save', wrapF((data, actor) => store.saveHubDocument(data, actor)));
  ipcMain.handle('documentHub:delete', wrapF((id, actor) => { store.deleteHubDocument(id, actor); return true; }));
  ipcMain.handle('documentHub:share', wrapF((id, options, actor) => store.shareDocument(id, options, actor)));
  ipcMain.handle('documentHub:exportStatus', wrapF((id, actor) => store.exportDocumentStatus(id, actor)));
  ipcMain.handle('documentHub:processScheduled', wrapF(() => store.processScheduledDocuments()));

  ipcMain.handle('firstOnlineGift:get', wrapF((actor) => {
    return require('./services/first-online-gift').getCampaign(actor || store.getUserSession());
  }));
  ipcMain.handle('firstOnlineGift:save', wrapF((data, actor) => {
    return require('./services/first-online-gift').saveCampaign(data || {}, actor || store.getUserSession());
  }));
  ipcMain.handle('firstOnlineGift:dashboard', wrapF((filters, actor) => {
    return require('./services/first-online-gift').getDashboard(filters || {}, actor || store.getUserSession());
  }));
  ipcMain.handle('firstOnlineGift:winners', wrapF((filters, actor) => {
    return require('./services/first-online-gift').listWinners(filters || {}, actor || store.getUserSession());
  }));
  ipcMain.handle('firstOnlineGift:selfTest', wrapF((actor) => {
    return require('./services/first-online-gift').runSelfTest(actor || store.getUserSession());
  }));

  ipcMain.handle('paymentGateways:list', wrapF((actor) => {
    store.requireActor(actor || store.getUserSession(), ['owner', 'manager']);
    return require('./services/payment-gateway').listGateways(actor || store.getUserSession());
  }));
  ipcMain.handle('paymentGateways:save', wrapF((provider, data, actor) => {
    store.requireActor(actor || store.getUserSession(), ['owner', 'manager']);
    return require('./services/payment-gateway').saveGateway(provider, data || {}, actor || store.getUserSession());
  }));
  ipcMain.handle('paymentGateways:test', wrap(async (provider, actor) => {
    store.requireActor(actor || store.getUserSession(), ['owner', 'manager']);
    return require('./services/payment-gateway').testConnection(provider, actor || store.getUserSession());
  }));
  ipcMain.handle('paymentGateways:registerWebhook', wrap(async (provider, actor) => {
    store.requireActor(actor || store.getUserSession(), ['owner', 'manager']);
    return require('./services/payment-gateway').registerWebhook(provider, actor || store.getUserSession());
  }));
  ipcMain.handle('paymentGateways:listTransactions', wrapF((filters, actor) => {
    store.requireActor(actor || store.getUserSession(), ['owner', 'manager']);
    return require('./services/payment-gateway').listTransactions(filters || {}, actor || store.getUserSession());
  }));
  ipcMain.handle('paymentGateways:refund', wrap(async (txnId, amount, actor) => {
    store.requireActor(actor || store.getUserSession(), ['owner', 'manager']);
    return require('./services/payment-gateway').refundTransaction(txnId, amount, actor || store.getUserSession());
  }));

  ipcMain.handle('rewards:getRules', wrapF(() => store.getRewardRules()));
  ipcMain.handle('rewards:saveRule', wrapF((data, actor) => {
    store.requireActor(actor || store.getUserSession(), ['owner', 'manager']);
    return store.saveRewardRule(data);
  }));
  ipcMain.handle('rewards:deleteRule', wrapF((id, actor) => {
    store.requireActor(actor || store.getUserSession(), ['owner', 'manager']);
    return store.deleteRewardRule(id);
  }));

  // Branches & Sync Hub
  ipcMain.handle('branches:get', wrap(() => store.getBranchesDetailed ? store.getBranchesDetailed() : store.getBranches()));
  ipcMain.handle('branches:getActive', wrap(() => store.getActiveBranch()));
  ipcMain.handle('branches:getView', wrap(() => store.getViewBranch()));
  ipcMain.handle('branches:setView', wrap((branchId, actor) => {
    store.requireActor(actor || store.getUserSession(), ['owner', 'manager']);
    return store.setViewBranch(branchId);
  }));
  ipcMain.handle('branches:save', wrap((data, actor) => {
    store.requireActor(actor || store.getUserSession(), ['owner', 'manager']);
    return store.saveBranch(data);
  }));
  ipcMain.handle('branches:setActive', wrap((branchId, actor) => {
    store.requireActor(actor || store.getUserSession(), ['owner', 'manager']);
    return store.setActiveBranch(branchId);
  }));
  ipcMain.handle('branches:saveSettings', wrap((branchId, data, actor) => {
    store.requireActor(actor || store.getUserSession(), ['owner', 'manager']);
    return store.saveBranchSettings(branchId, data || {});
  }));
  ipcMain.handle('branches:delete', wrap((id, actor) => {
    store.requireActor(actor || store.getUserSession(), ['owner']);
    return store.deleteBranch(id, actor);
  }));
  ipcMain.handle('branches:listTills', wrap((branchId) => store.listBranchTills(branchId)));
  ipcMain.handle('branches:saveTill', wrap((branchId, data, actor) => {
    store.requireActor(actor || store.getUserSession(), ['owner', 'manager']);
    return store.saveBranchTill(branchId, data || {});
  }));
  ipcMain.handle('branches:updateTill', wrap((branchId, deviceId, patch, actor) => {
    store.requireActor(actor || store.getUserSession(), ['owner', 'manager']);
    return store.updateBranchTill(branchId, deviceId, patch || {});
  }));
  ipcMain.handle('branches:deleteTill', wrap((branchId, deviceId, actor) => {
    store.requireActor(actor || store.getUserSession(), ['owner', 'manager']);
    return store.deleteBranchTill(branchId, deviceId);
  }));
  ipcMain.handle('sync:getStatus', wrap(() => store.getSyncStatus()));
  ipcMain.handle('sync:saveSettings', wrap((data, actor) => {
    store.requireActor(actor, ['owner', 'manager']);
    store.saveSyncSettings(data);
    return store.getSyncSettings();
  }));
  ipcMain.handle('sync:register', wrap((role, name) => {
    requireUserSession(['owner', 'manager']);
    return store.registerSyncDevice(role, name);
  }));
  ipcMain.handle('sync:now', wrap(() => {
    requireUserSession(['owner', 'manager']);
    return store.syncNow();
  }));
  ipcMain.handle('sync:publishProducts', wrap(() => store.publishProductsToHub()));
  ipcMain.handle('sync:branchesToHub', wrap(() => store.syncBranchesToHub()));
  ipcMain.handle('sync:getOnlineOrders', wrap((status) => store.getOnlineOrdersLocal(status)));
  ipcMain.handle('sync:importCloudOrders', wrap((orders) => store.importCloudOrders(orders || [])));
  ipcMain.handle('sync:updateOnlineOrder', wrap((id, status, opts) => {
    requireUserSession(['owner', 'manager', 'supervisor', 'cashier']);
    return store.updateOnlineOrderStatus(id, status, opts || {});
  }));
  ipcMain.handle('sync:rejectOnlineOrder', wrap((id, reason) => {
    const user = requireUserSession(['owner', 'manager', 'supervisor', 'cashier']);
    return store.rejectOnlineOrder(id, reason, user);
  }));
  ipcMain.handle('sync:acceptOnlineOrder', wrap((id, opts) => {
    const user = requireUserSession(['owner', 'manager', 'supervisor', 'cashier']);
    return store.acceptOnlineOrderAsSale(id, user, opts || {});
  }));

  const web = require('./services/online-ordering');
  ipcMain.handle('web:getSettings', wrap(() => web.getGlobalSettings()));
  ipcMain.handle('web:getHoursStatus', wrap(() => web.getHoursStatus()));
  ipcMain.handle('web:trackEvents', wrap((payload) => {
    return require('./services/web-analytics').trackEvents(payload || {});
  }));
  ipcMain.handle('web:visitorDashboard', wrap((filters, actor) => {
    requireUserSession(['owner', 'manager', 'supervisor']);
    return require('./services/web-analytics').getVisitorDashboard(filters || {}, actor);
  }));
  ipcMain.handle('web:onlineCustomers', wrap((filters, actor) => {
    requireUserSession(['owner', 'manager', 'supervisor']);
    return require('./services/web-analytics').listOnlineCustomers(filters || {}, actor);
  }));
  ipcMain.handle('web:getBranches', wrap(() => web.getPublicBranches()));
  ipcMain.handle('web:getMenu', wrap((branchId, filters) => web.getBranchMenu(branchId, filters || {})));
  ipcMain.handle('web:getProduct', wrap((branchId, productId) => web.getProductDetail(branchId, productId)));
  ipcMain.handle('web:register', wrap((data) => web.registerWebCustomer(data || {})));
  ipcMain.handle('web:login', wrap((login, password) => web.loginWebCustomer(login, password)));
  ipcMain.handle('web:sendPasswordReset', wrap((data) => web.sendWebPasswordReset(data || {})));
  ipcMain.handle('web:resetPassword', wrap((data) => web.resetWebPassword(data || {})));
  ipcMain.handle('web:account', wrap((token) => web.getCustomerAccount(token)));
  ipcMain.handle('web:validateCart', wrap((branchId, cart) => web.validateCart(branchId, cart || {})));
  ipcMain.handle('web:validateCoupon', wrap((code, branchId, cart, customerId) => web.validateCoupon(code, branchId, cart || {}, customerId)));
  ipcMain.handle('web:submitOrder', wrap((branchId, payload, token, idem) => web.submitOrder(branchId, payload || {}, token, idem)));
  ipcMain.handle('web:getOrder', wrap((orderId, token) => web.getOrder(orderId, token)));
  ipcMain.handle('web:listOrders', wrap((token, limit) => web.listCustomerOrders(token, limit)));
  ipcMain.handle('web:toggleFavorite', wrap((token, productId, branchId) => web.toggleFavorite(token, productId, branchId)));
  ipcMain.handle('web:checkGiftCard', wrap((code, token) => web.checkGiftCardForWeb(code, token)));
  ipcMain.handle('web:deleteAccount', wrap((token, password) => web.deleteWebCustomerAccount(token, password)));
  ipcMain.handle('web:submitIssue', wrap((data, token) => web.submitCustomerIssue(data || {}, token)));
  ipcMain.handle('web:listMyIssues', wrap((token) => web.listMyCustomerIssues(token)));
  ipcMain.handle('web:listIssues', wrap((filters, actor) => web.listCustomerIssues(filters || {}, actor)));
  ipcMain.handle('web:getIssue', wrap((id, actor) => web.getCustomerIssue(id, actor)));
  ipcMain.handle('web:replyIssue', wrap((id, reply, actor) => web.replyCustomerIssue(id, reply, actor)));
  ipcMain.handle('web:adminOrders', wrap((filters, actor) => {
    requireUserSession(['owner', 'manager', 'supervisor']);
    return web.listAdminOrders(filters || {}, actor);
  }));
  ipcMain.handle('web:adminOrderDetail', wrap((orderId, actor) => {
    requireUserSession(['owner', 'manager', 'supervisor', 'assistant_manager']);
    return web.getAdminOrderDetail(orderId, actor);
  }));
  ipcMain.handle('web:adminUpdateOrder', wrap((orderId, patch, actor) => {
    const user = requireUserSession(['owner', 'manager']);
    return web.updateAdminOrder(orderId, patch || {}, actor || user);
  }));
  ipcMain.handle('web:adminDeleteOrder', wrap((orderId, reason, actor) => {
    const user = requireUserSession(['owner', 'manager']);
    return web.deleteAdminOrder(orderId, reason, actor || user);
  }));
  
ipcMain.handle('web:adminAnalytics', wrap((filters, actor) => {
    requireUserSession(['owner', 'manager']);
    return web.getOnlineAnalytics(filters || {});
  }));
  ipcMain.handle('web:rejectedOrdersReport', wrap((filters, actor) => {
    requireUserSession(['owner', 'manager', 'supervisor']);
    return web.listRejectedOrdersReport(filters || {});
  }));
  ipcMain.handle('auth:recoverDriverPassword', wrap((identifier) => {
    const recovery = require('./services/panel-password-recovery');
    return recovery.recoverDriverPassword(identifier);
  }));
  ipcMain.handle('auth:recoverReferralAgentPassword', wrap((identifier) => {
    const recovery = require('./services/panel-password-recovery');
    return recovery.sendReferralAgentResetCode(identifier);
  }));
  ipcMain.handle('auth:resetReferralAgentPassword', wrap((data) => {
    const recovery = require('./services/panel-password-recovery');
    return recovery.resetReferralAgentPassword(data || {});
  }));
  ipcMain.handle('auth:recoverAdminPassword', wrap((identifier) => {
    const recovery = require('./services/panel-password-recovery');
    return recovery.recoverAdminPassword(identifier);
  }));
  ipcMain.handle('web:saveGlobalSettings', wrap((data, actor) => {
    requireUserSession(['owner', 'manager']);
    return web.saveGlobalOnlineSettings(data || {}, actor);
  }));
  ipcMain.handle('web:saveBranchSettings', wrap((branchId, data, actor) => {
    requireUserSession(['owner', 'manager']);
    return web.saveBranchOnlineSettings(branchId, data || {}, actor);
  }));
  ipcMain.handle('web:getBranchSettings', wrap((branchId) => web.getBranchOnlineSettings(branchId)));
  ipcMain.handle('web:rejectOrder', wrap((orderId, reason, actor) => {
    const user = requireUserSession(['owner', 'manager', 'supervisor', 'cashier']);
    return web.rejectOrder(orderId, reason, user);
  }));
  ipcMain.handle('web:updateOrderStatus', wrap((orderId, status, actor, opts) => {
    const user = requireUserSession(['owner', 'manager', 'supervisor', 'cashier']);
    return web.updateOrderStatus(orderId, status, user, opts || {});
  }));

  const bizActor = (a) => a || store.getUserSession?.();

  ipcMain.handle('bizModules:settings', wrap(() => {
    requireUserSession(['owner', 'manager']);
    return store.getBizModuleSettings?.();
  }));
  ipcMain.handle('bizModules:saveSettings', wrap((data, actor) => {
    requireUserSession(['owner']);
    return store.saveBizModuleSettings?.(data || {}, bizActor(actor));
  }));
  ipcMain.handle('bizModules:summary', wrap((actor) => {
    requireUserSession(['owner', 'manager']);
    return store.bizModulesSummary?.();
  }));

  ipcMain.handle('investor:login', wrap((u, p) => store.investorLogin(u, p)));
  ipcMain.handle('investor:logout', wrap((tok) => store.investorLogout(tok)));
  ipcMain.handle('investor:dashboard', wrap((tok) => store.investorDashboard(tok)));
  ipcMain.handle('investor:list', wrap((f, actor) => store.listInvestors(bizActor(actor), f || {})));
  ipcMain.handle('investor:get', wrap((id, actor) => store.getInvestor(id, bizActor(actor))));
  ipcMain.handle('investor:save', wrap((d, actor) => store.saveInvestor(d || {}, bizActor(actor))));
  ipcMain.handle('investor:createPortalUser', wrap((invId, d, actor) => store.createInvestorPortalUser(invId, d || {}, bizActor(actor))));
  ipcMain.handle('investor:saveProposal', wrap((d, actor) => store.saveProposal(d || {}, bizActor(actor))));
  ipcMain.handle('investor:listProposals', wrap((f, actor) => store.listProposals(bizActor(actor), f || {})));
  ipcMain.handle('investor:proposalPdf', wrap((id, actor) => store.buildProposalPdf(id, bizActor(actor))));
  ipcMain.handle('investor:saveAgreement', wrap((d, actor) => store.saveAgreement(d || {}, bizActor(actor))));
  ipcMain.handle('investor:uploadDocument', wrap((d, actor) => store.uploadInvestorDocument(d || {}, bizActor(actor))));
  ipcMain.handle('investor:recordPayment', wrap((d, actor) => store.recordPayment(d || {}, bizActor(actor))));
  ipcMain.handle('investor:recordDistribution', wrap((d, actor) => store.recordDistribution(d || {}, bizActor(actor))));
  ipcMain.handle('investor:summary', wrap((actor) => {
    requireUserSession(['owner', 'manager']);
    return store.investorSummary?.();
  }));

  ipcMain.handle('release:login', wrap((u, p) => store.releaseLogin(u, p)));
  ipcMain.handle('release:logout', wrap((tok) => store.releaseLogout(tok)));
  ipcMain.handle('release:dashboard', wrap((tok) => store.releaseDashboard(tok)));
  ipcMain.handle('release:runTests', wrap(async (tok, verId) => store.runFullSystemTest(tok, verId || null)));
  ipcMain.handle('release:createVersion', wrap((tok, d) => store.createReleaseVersion(d || {}, tok)));
  ipcMain.handle('release:approve', wrap(async (tok, verId, confirm) => store.approveRelease(verId, tok, !!confirm)));
  ipcMain.handle('release:publish', wrap(async (tok, verId, confirm) => store.publishRelease(verId, tok, !!confirm)));
  ipcMain.handle('release:listUsers', wrap((actor) => store.listReleaseUsers(bizActor(actor))));
  ipcMain.handle('release:saveUser', wrap((d, actor) => store.saveReleaseUser(d || {}, bizActor(actor))));
  ipcMain.handle('release:summary', wrap((actor) => {
    requireUserSession(['owner', 'manager']);
    return store.releaseSummary?.();
  }));

  ipcMain.handle('meeting:login', wrap((u, p) => store.meetingLogin(u, p)));
  ipcMain.handle('meeting:logout', wrap((tok) => store.meetingLogout(tok)));
  ipcMain.handle('meeting:list', wrap((tok, f) => store.listMeetings(tok, f || {})));
  ipcMain.handle('meeting:get', wrap((tok, id) => store.getMeeting(id, tok)));
  ipcMain.handle('meeting:save', wrap((tok, d) => store.saveMeeting(d || {}, tok)));
  ipcMain.handle('meeting:start', wrap((tok, id) => store.startMeeting(id, tok)));
  ipcMain.handle('meeting:stop', wrap((tok, id) => store.stopMeeting(id, tok)));
  ipcMain.handle('meeting:saveRecording', wrap((tok, id, d) => store.saveRecording(id, tok, d || {})));
  ipcMain.handle('meeting:saveTranscript', wrap((tok, id, segs) => store.saveTranscript(id, tok, segs)));
  ipcMain.handle('meeting:processAi', wrap(async (tok, id) => store.processMeetingAi(id, tok)));
  ipcMain.handle('meeting:finalizeMinutes', wrap((tok, id) => store.finalizeMinutes(id, tok)));
  ipcMain.handle('meeting:search', wrap((tok, q) => store.searchMeetings(tok, q)));
  ipcMain.handle('meeting:ask', wrap(async (tok, id, q) => store.askMeetingAi(id, tok, q)));
  ipcMain.handle('meeting:listUsers', wrap((actor) => store.listMeetingUsers(bizActor(actor))));
  ipcMain.handle('meeting:saveUser', wrap((d, actor) => store.saveMeetingUser(d || {}, bizActor(actor))));
  ipcMain.handle('meeting:summary', wrap((actor) => {
    requireUserSession(['owner', 'manager']);
    return store.meetingSummary?.();
  }));

  ipcMain.handle('signage:login', wrap((u, p) => store.signageLogin(u, p)));
  ipcMain.handle('signage:loginAsAdmin', wrap((actor) => store.signageLoginAsAdmin(bizActor(actor))));
  ipcMain.handle('signage:logout', wrap((tok) => store.signageLogout(tok)));
  ipcMain.handle('signage:dashboard', wrap((tok) => store.signageDashboard(tok)));
  ipcMain.handle('signage:summary', wrap((actor) => {
    requireUserSession(['owner', 'manager']);
    return store.signageSummary?.();
  }));
  ipcMain.handle('signage:requestPairing', wrap((meta) => store.requestPairing(meta || {})));
  ipcMain.handle('signage:pairingStatus', wrap((code) => store.pairingStatus(code)));
  ipcMain.handle('signage:pendingPairings', wrap((tok) => store.listPendingPairings(tok)));
  ipcMain.handle('signage:pendingPairingsAdmin', wrap((actor) => store.listPendingPairingsAdmin(bizActor(actor))));
  ipcMain.handle('signage:approvePairing', wrap((tok, code, data) => store.approvePairing(code, data || {}, tok)));
  ipcMain.handle('signage:approvePairingAdmin', wrap((code, data, actor) => store.approvePairingAdmin(code, data || {}, bizActor(actor))));
  ipcMain.handle('signage:rejectPairing', wrap((tok, code) => store.rejectPairing(code, tok)));
  ipcMain.handle('signage:revokeDevice', wrap((tok, id) => store.revokeDevice(id, tok)));
  ipcMain.handle('signage:listDevices', wrap((tok) => store.listDevices(tok)));
  ipcMain.handle('signage:saveDevice', wrap((tok, d) => store.saveDevice(d || {}, tok)));
  ipcMain.handle('signage:listMedia', wrap((tok, f) => store.listMedia(tok, f || {})));
  ipcMain.handle('signage:uploadMedia', wrap((tok, d) => store.uploadMedia(d || {}, tok)));
  ipcMain.handle('signage:deleteMedia', wrap((tok, id) => store.deleteMedia(id, tok)));
  ipcMain.handle('signage:listPlaylists', wrap((tok) => store.listPlaylists(tok)));

  const mm = require('./services/mobile-manager');
  ipcMain.handle('mobile:login', wrap((username, password, deviceInfo) => mm.login(username, password, deviceInfo || {})));
  ipcMain.handle('mobile:bootstrapAdmin', wrap((actor) => {
    const user = requireUserSession(['owner', 'manager', 'supervisor', 'assistant_manager']);
    return mm.bootstrapFromAdmin(user, { platform: 'admin', device_name: 'Admin Panel' });
  }));
  ipcMain.handle('mobile:logout', wrap((token) => mm.logout(token)));
  ipcMain.handle('mobile:profile', wrap((token) => mm.getProfile(token)));
  ipcMain.handle('mobile:dashboard', wrap((token, filters) => mm.getDashboard(token, filters || {})));
  ipcMain.handle('mobile:orders', wrap((token, filters) => mm.listOrders(token, filters || {})));
  ipcMain.handle('mobile:order', wrap((token, orderId) => mm.getOrder(token, orderId)));
  ipcMain.handle('mobile:searchOrders', wrap((token, query) => mm.searchOrders(token, query || {})));
  ipcMain.handle('mobile:staffActivity', wrap((token, filters) => mm.getStaffActivity(token, filters || {})));
  ipcMain.handle('mobile:posStatus', wrap((token) => mm.getPosStatus(token)));
  ipcMain.handle('mobile:alerts', wrap((token, arg) => {
    const opts = typeof arg === 'object' && arg !== null ? arg : { limit: arg || 50 };
    return mm.listAlerts(token, opts.limit || 50, opts);
  }));
  ipcMain.handle('mobile:heartbeat', wrap((branchId, deviceId, label) => mm.recordPosHeartbeat(branchId, deviceId, label)));
  ipcMain.handle('mobile:markRead', wrap((token, ids) => mm.markNotificationsRead(token, ids)));
  ipcMain.handle('mobile:getPrefs', wrap((token) => mm.getNotificationPrefs(token)));
  ipcMain.handle('mobile:savePrefs', wrap((token, prefs) => mm.saveNotificationPrefs(token, prefs)));
  ipcMain.handle('mobile:registerPush', wrap((token, pushToken) => mm.registerPushToken(token, pushToken)));
  ipcMain.handle('mobile:poll', wrap((token, sinceId) => mm.pollNotifications(token, sinceId)));
  ipcMain.handle('mobile:adminListUsers', wrap((actor) => {
    requireUserSession(['owner', 'manager']);
    return mm.listMobileUsers();
  }));
  ipcMain.handle('mobile:adminGetUser', wrap((id, actor) => {
    requireUserSession(['owner', 'manager']);
    return mm.getMobileUser(id);
  }));
  ipcMain.handle('mobile:adminSaveUser', wrap((data, actor) => {
    requireUserSession(['owner', 'manager']);
    return mm.saveMobileUser(data || {});
  }));
  ipcMain.handle('mobile:adminSetActive', wrap((id, active, actor) => {
    requireUserSession(['owner', 'manager']);
    return mm.setMobileUserActive(id, !!active);
  }));
  ipcMain.handle('mobile:adminListDevices', wrap((userId, actor) => {
    requireUserSession(['owner', 'manager']);
    return mm.listMobileDevices(userId);
  }));
  ipcMain.handle('mobile:adminRevokeDevice', wrap((deviceId, actor) => {
    requireUserSession(['owner', 'manager']);
    return mm.revokeMobileDevice(deviceId);
  }));
}

app.whenReady().then(async () => {
  try {
    await initDatabase();
    ensureDemoNotificationSound();
    registerIpc();
    try { store.runStartupTasks(); } catch (_) { /* ignore */ }
    try { require('./services/production-availability').refreshAllMealCapacities(); } catch (_) { /* ignore */ }
    createWindow();
  } catch (err) {
    console.error('Startup failed:', err);
    dialog.showErrorBox('Shop POS failed to start', err?.message || String(err));
    app.quit();
  }
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  if (app.isReady()) {
    dialog.showErrorBox('Shop POS error', err?.message || String(err));
  }
});

app.on('window-all-closed', () => {
  closeDatabase();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (!mainWindow) createWindow();
});

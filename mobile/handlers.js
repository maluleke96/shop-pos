/**
 * Mobile / Capacitor handlers always use the local sql.js database (./db).
 * Cloud/RPC mode never loads this module — supabase-bootstrap owns posAPI there.
 * Do NOT read process.env here: this file is bundled into the browser renderer
 * where Node's `process` global does not exist.
 */
const { initDatabase, persistNow, schedulePersist } = require('./db');

function wrapSync(fn) {
  return async (...args) => {
    try { return { success: true, data: fn(...args) }; }
    catch (err) { return { success: false, error: err.message }; }
  };
}

function wrapAsync(fn) {
  return async (...args) => {
    try { return { success: true, data: await fn(...args) }; }
    catch (err) { return { success: false, error: err.message }; }
  };
}

function stub(msg) {
  return async () => ({ success: false, error: msg || 'Not available on mobile' });
}

function buildHandlers(store) {
  const s = store;
  const H = {};

  const add = (ch, fn) => { H[ch.replace(/[:]/g, '_')] = fn; };

  function requireSession() {
    const u = s.getUserSession?.();
    if (u?.id) return u;
    const e = s.getEmployeeSession?.();
    if (e?.employee_id != null) return e;
    throw new Error('Authentication required');
  }

  function requireUserSession(roles) {
    return s.requireActor(s.getUserSession?.(), roles || []);
  }

  function scopedEmployeeId(requestedId) {
    const empSess = s.getEmployeeSession?.();
    const userSess = s.getUserSession?.();
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
    const empSess = s.getEmployeeSession?.();
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
      try {
        s.requireActor(actor, ['owner', 'manager', 'supervisor', 'assistant_manager']);
        return Number(requestedId);
      } catch (_) { /* fall through */ }
    }
    throw new Error('Authentication required');
  }

  function persistCritical() {
    try { schedulePersist(); } catch (_) { try { persistNow(); } catch (_) { /* ignore */ } }
  }

  add('app:quit', async () => ({ success: true }));

  const CLOUD_SYNC =
    (typeof window !== 'undefined' &&
      (window.__SHOP_POS_ENV__?.SHOP_POS_SYNC_URL || window.__SHOP_POS_ENV__?.SHOP_POS_CLOUD_URL)) ||
    'https://peaceful-motivation-production-7dd2.up.railway.app';

  async function mobileCloudRpc(method, args) {
    const base = String(CLOUD_SYNC).replace(/\/$/, '');
    const r = await fetch(base + '/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, args: args || [] })
    });
    return r.json();
  }

  add('auth:login', async (u, p, pin) => {
    let local;
    try {
      local = s.login(u, p, pin);
    } catch (e) {
      local = { success: false, error: e.message || String(e) };
    }
    if (local && local.success) return local;
    const err = String(local?.error || '');
    if (err && !/invalid username or password/i.test(err)) return local;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return local;
    try {
      const cloud = await mobileCloudRpc('auth_login', [u, p, pin || null]);
      if (!cloud || cloud.success === false) return cloud && cloud.error ? cloud : local;
      const user = cloud.user || cloud.data?.user || {};
      let settings = {};
      let categories = [];
      let products = [];
      try {
        const sRes = await mobileCloudRpc('settings_getParsed', []);
        if (sRes && sRes.success !== false) settings = sRes.data || {};
      } catch (_) { /* ignore */ }
      try {
        const cRes = await mobileCloudRpc('categories_get', [{}]);
        categories = Array.isArray(cRes?.data) ? cRes.data : (Array.isArray(cRes) ? cRes : []);
      } catch (_) { /* ignore */ }
      try {
        const pRes = await mobileCloudRpc('products_get', [{}]);
        products = Array.isArray(pRes?.data) ? pRes.data : (Array.isArray(pRes) ? pRes : []);
      } catch (_) { /* ignore */ }
      try {
        s.seedInstallerAccountFromCloud({
          username: u,
          password: p,
          pin: pin || null,
          cloudUser: user,
          settings,
          categories,
          products
        });
      } catch (seedErr) {
        return { success: false, error: seedErr.message || 'Could not save online account on this device' };
      }
      const again = s.login(u, p, pin);
      if (again && again.success) return { ...again, cloudLinked: true };
      if (user && user.username) return { success: true, user, cloudLinked: true };
      return again || local;
    } catch (e) {
      return {
        success: false,
        error: `${local?.error || 'Invalid username or password'} (online: ${e.message || e})`
      };
    }
  });
  add('auth:logout', wrapSync(() => s.logout()));
  add('auth:getUsers', wrapSync((a) => {
    s.requireActor(a, ['owner', 'manager']);
    return s.getUsers();
  }));
  add('auth:createUser', wrapSync((d, a) => {
    s.requireActor(a, ['owner', 'manager']);
    return s.createUser(d, a.id, a.username);
  }));
  add('auth:updateUser', wrapSync((id, d, a) => {
    s.requireActor(a, ['owner', 'manager']);
    s.updateUser(id, d, a.id, a.username);
    return true;
  }));
  add('auth:deleteUser', wrapSync((id, a) => {
    s.requireActor(a, ['owner']);
    s.deleteUser(id, a.id, a.username);
    return true;
  }));
  add('auth:permanentlyDeleteUser', wrapSync((id, confirm, a) => {
    s.requireActor(a, ['owner']);
    return s.permanentlyDeleteUser(id, confirm, a.id, a.username);
  }));
  add('auth:verifySession', wrapSync(userId => s.verifyUserSession(userId)));
  add('auth:hasRecovery', async () => {
    try {
      if (s.hasRecoverySecret()) return { success: true, data: true };
    } catch (_) { /* ignore */ }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return { success: true, data: false };
    try {
      const cloud = await mobileCloudRpc('auth_hasRecovery', []);
      const on = !!(cloud && cloud.success !== false && (cloud.data === true || cloud === true));
      return { success: true, data: on, fromCloud: on };
    } catch (_) {
      return { success: true, data: false };
    }
  });
  add('auth:getRecoveryStatus', wrapSync((a) => {
    s.requireActor(a, ['owner']);
    return s.getRecoveryStatus();
  }));
  add('auth:recoverVerify', async (sec) => {
    try {
      return { success: true, data: s.getUsernamesForRecovery(sec) };
    } catch (localErr) {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        return { success: false, error: localErr.message };
      }
      try {
        const cloud = await mobileCloudRpc('auth_recoverVerify', [sec]);
        if (cloud && cloud.success !== false) {
          return cloud.data != null ? { success: true, data: cloud.data, fromCloud: true } : cloud;
        }
        return cloud || { success: false, error: localErr.message };
      } catch (e) {
        return { success: false, error: localErr.message || e.message };
      }
    }
  });
  add('auth:recoverReset', async (sec, u, p) => {
    try {
      return s.resetPasswordViaRecovery(sec, u, p);
    } catch (localErr) {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        return { success: false, error: localErr.message };
      }
      try {
        const cloud = await mobileCloudRpc('auth_recoverReset', [sec, u, p]);
        if (cloud && cloud.success !== false) {
          try {
            s.seedInstallerAccountFromCloud({
              username: u,
              password: p,
              cloudUser: { username: u, role: 'owner', full_name: u },
              settings: {}
            });
          } catch (_) { /* ignore */ }
          return cloud;
        }
        return cloud || { success: false, error: localErr.message };
      } catch (e) {
        return { success: false, error: localErr.message || e.message };
      }
    }
  });
  add('auth:seedInstallerAccount', wrapSync((payload) => s.seedInstallerAccountFromCloud(payload || {})));
  add('auth:setRecoverySecret', wrapSync((sec, a) => {
    s.requireActor(a, ['owner']);
    return s.setRecoverySecret(sec, a.id, a.username || 'owner');
  }));
  add('auth:factoryReset', wrapAsync((sec, t) => {
    // Server session only — never trust a client-supplied actor for wipe.
    s.requireActor(s.getUserSession?.(), ['owner']);
    return s.factoryResetBusiness(sec, t);
  }));
  add('auth:clearOperationalData', wrapAsync((pw, a, categories) => {
    s.requireActor(a, ['owner']);
    return s.clearOperationalData(pw, a.id, a.username || a.full_name || 'owner', categories);
  }));
  add('auth:listClearDataCategories', wrapSync(() => s.listClearDataCategories()));
  add('auth:verifyBookkeepingPassword', wrapSync(p => s.verifyBookkeepingPassword(p)));
  add('auth:setBookkeepingPassword', wrapSync((p, a) => {
    s.requireActor(a, ['owner', 'manager']);
    return s.setBookkeepingPassword(p, a.id, a.username);
  }));
  add('auth:verifyManagerPin', wrapSync(p => s.verifyManagerPin(p)));

  add('settings:get', wrapSync(() => s.sanitizeSettingsResponse(s.getSettings())));
  add('settings:getParsed', wrapSync(() => s.getSettingsParsed()));
  add('settings:detectExistingBusiness', wrapSync(() => s.detectExistingBusiness()));
  add('settings:adoptExistingBusiness', wrapSync(() => s.adoptExistingBusiness()));
  add('settings:save', wrapSync((d, a) => {
    s.requireActor(a, ['owner', 'manager']);
    s.saveSettings(d, a.id, a.username || a.full_name);
    return true;
  }));
  add('settings:saveJson', wrapSync((k, v, a) => {
    const roles = k === 'staff_portal_settings'
      ? ['owner', 'manager', 'supervisor', 'assistant_manager']
      : ['owner', 'manager'];
    s.requireActor(a, roles);
    s.saveJsonSetting(k, v, a.id, a.username || a.full_name);
    return true;
  }));
  add('settings:completeSetup', wrapAsync(d => s.completeSetup(d)));
  add('settings:submitRequest', wrapSync((d, a) => {
    const user = s.requireActor(a, ['owner', 'manager', 'supervisor', 'assistant_manager', 'cashier']);
    return s.submitSettingsChangeRequest(d, user.id, user.full_name || user.username);
  }));
  add('settings:getPendingRequests', wrapSync(() => s.getPendingSettingsRequests()));
  add('settings:getRequestHistory', wrapSync((limit) => s.getSettingsRequestHistory(limit || 40)));
  add('settings:approveRequest', wrapSync((id, a) => {
    const user = s.requireActor(a, ['owner', 'manager']);
    return s.approveSettingsRequest(id, user.id, user.full_name || user.username);
  }));
  add('settings:rejectRequest', wrapSync((id, n, a) => {
    const user = s.requireActor(a, ['owner', 'manager']);
    return s.rejectSettingsRequest(id, user.id, user.full_name || user.username, n);
  }));
  add('settings:updateRequest', wrapSync((id, d, a) => {
    const user = s.requireActor(a, ['owner', 'manager']);
    return s.updateSettingsRequest(id, d, user.id, user.full_name || user.username);
  }));
  add('settings:deleteRequest', wrapSync((id, a) => {
    s.requireActor(a, ['owner', 'manager']);
    return s.deleteSettingsRequest(id);
  }));

  add('categories:get', wrapSync((f) => s.getCategories(f || {})));
  add('categories:save', wrapSync((d, a) => {
    const user = s.requireActor(a, ['owner', 'manager', 'supervisor', 'assistant_manager']);
    return s.saveCategory(d, user.id, user.username);
  }));
  add('categories:delete', wrapSync((id, a) => {
    const user = s.requireActor(a, ['owner', 'manager']);
    s.deleteCategory(id, user.id, user.username);
    return true;
  }));

  add('products:get', wrapSync(f => s.getProducts(f)));
  add('products:getOne', wrapSync(id => s.getProduct(id)));
  add('products:getByBarcode', wrapSync(b => s.getProductByBarcode(b)));
  add('products:calcRecipe', wrapSync(d => s.calcRecipeMetrics(d)));
  add('products:save', wrapSync((d, a) => {
    const user = s.requireActor(a, ['owner', 'manager', 'supervisor', 'assistant_manager']);
    return s.saveProduct(d, user.id, user.username);
  }));
  add('products:delete', wrapSync((id, a) => {
    const user = s.requireActor(a, ['owner', 'manager']);
    s.deleteProduct(id, user.id, user.username);
    return true;
  }));
  add('products:saveOtherSell', wrapSync((d, a) => {
    const user = s.requireActor(a, ['owner', 'manager', 'supervisor', 'assistant_manager', 'cashier']);
    return s.saveOtherSellItem(d || {}, user.id, user.username || user.full_name);
  }));
  add('products:suggestPrice', wrapSync((cost, pct) => s.suggestSellPrice(cost, pct)));
  add('products:import', wrapSync((rows, a) => {
    const user = s.requireActor(a, ['owner', 'manager']);
    return s.importProducts(rows, user.id, user.username);
  }));

  add('stock:adjust', wrapSync((pid, q, t, n, a) => {
    const user = s.requireActor(a, ['owner', 'manager', 'supervisor', 'assistant_manager']);
    return s.adjustStock(pid, q, t, n, user.id, 'manual', null);
  }));
  add('stock:history', wrapSync(pid => pid ? s.getStockHistory(pid) : s.getAllStockHistory()));

  add('sales:complete', wrapSync((d, a) => {
    const user = s.requireActor(a, ['owner', 'manager', 'cashier', 'supervisor', 'assistant_manager']);
    const result = s.completeSale(d, user.id, user.full_name, user.role);
    persistCritical();
    return result;
  }));
  add('sales:get', wrapSync(id => { requireSession(); return s.getSale(id); }));
  add('sales:getByReceipt', wrapSync(n => { requireSession(); return s.getSaleByReceipt(n); }));
  add('sales:hold', wrapSync((name, cart, a) => {
    const user = s.requireActor(a, ['owner', 'manager', 'cashier', 'supervisor', 'assistant_manager']);
    return s.holdOrder(name, cart, user.id);
  }));
  add('sales:getHeld', wrapSync(() => { requireSession(); return s.getHeldOrders(); }));
  add('sales:deleteHeld', wrapSync((id, a) => {
    s.requireActor(a, ['owner', 'manager', 'cashier', 'supervisor', 'assistant_manager']);
    s.deleteHeldOrder(id);
    return true;
  }));

  add('returns:process', wrapSync((d, a) => {
    const user = s.requireActor(a, ['owner', 'manager', 'supervisor', 'assistant_manager', 'cashier']);
    const result = s.processReturn(d, user.id, user.full_name);
    persistCritical();
    return result;
  }));
  add('returns:get', wrapSync((f) => { requireSession(); return s.getReturns(f || {}); }));

  add('expenses:get', wrapSync((f) => { requireSession(); return s.getExpenses(f || {}); }));
  add('expenses:save', wrapSync((d, a) => {
    const user = s.requireActor(a, ['owner', 'manager', 'supervisor', 'assistant_manager']);
    return s.saveExpense(d, user.id, user.username);
  }));
  add('expenses:delete', wrapSync((id, a) => {
    const user = s.requireActor(a, ['owner', 'manager']);
    s.deleteExpense(id, user.id, user.username);
    return true;
  }));

  add('customers:get', wrapSync(q => s.getCustomers(q)));
  add('customers:getOne', wrapSync(id => s.getCustomer(id)));
  add('customers:save', wrapSync((d, a) => {
    const user = s.requireActor(a, ['owner', 'manager', 'cashier', 'supervisor', 'assistant_manager']);
    return s.saveCustomer(d, user.id, user.username);
  }));
  add('customers:delete', wrapSync((id, a) => {
    const user = s.requireActor(a, ['owner', 'manager']);
    return s.deleteCustomer(id, user.id, user.username);
  }));
  add('customers:history', wrapSync(id => s.getCustomerHistory(id)));

  add('suppliers:get', wrapSync(() => s.getSuppliers()));
  add('suppliers:save', wrapSync((d, a) => {
    const user = s.requireActor(a, ['owner', 'manager', 'supervisor', 'assistant_manager']);
    return s.saveSupplier(d, user.id, user.username);
  }));
  add('suppliers:pay', wrapSync((supplierId, data, actor) => {
    const user = s.requireActor(actor, ['owner', 'manager']);
    return s.recordSupplierPayment(supplierId, data, user.id, user.username);
  }));
  add('suppliers:payments', wrapSync(id => s.getSupplierPayments(id)));

  add('po:get', wrapSync(() => s.getPurchaseOrders()));
  add('po:getDetail', wrapSync(id => s.getPurchaseOrder(id)));
  add('po:save', wrapSync((d, a) => {
    const user = s.requireActor(a, ['owner', 'manager', 'supervisor', 'assistant_manager']);
    return s.savePurchaseOrder(d, user.id, user.username);
  }));
  add('po:receive', wrapSync((id, a) => {
    const user = s.requireActor(a, ['owner', 'manager', 'supervisor', 'assistant_manager']);
    return s.receivePurchaseOrder(id, user.id, user.username);
  }));
  add('po:receivePartial', wrapSync((id, items, a) => {
    const user = s.requireActor(a, ['owner', 'manager', 'supervisor', 'assistant_manager']);
    return s.receivePurchaseOrderPartial(id, items, user.id, user.username);
  }));
  add('po:delete', wrapSync((id, a) => {
    const user = s.requireActor(a, ['owner']);
    return s.deletePurchaseOrder(id, user.id, user.username);
  }));
  add('po:update', wrapSync((id, data, a) => {
    const user = s.requireActor(a, ['owner']);
    return s.updatePurchaseOrder(id, data, user.id, user.username);
  }));

  add('dashboard:stats', wrapSync((f, t, actor) => {
    requireSession();
    const sess = s.getUserSession?.() || actor;
    const branchId = sess?.role === 'manager' && sess?.branch_id ? sess.branch_id : null;
    return s.getDashboardStats(f, t, branchId);
  }));
  add('inventory:stats', wrapSync(() => s.getInventoryStats()));
  add('analytics:sales', wrapSync((f, t) => s.getSalesAnalytics(f, t)));

  add('shifts:open', wrapSync((f, a) => {
    const user = s.requireActor(a, ['owner', 'manager', 'cashier', 'supervisor', 'assistant_manager']);
    return s.openShift(user.id, f);
  }));
  add('shifts:close', wrapSync((id, d, a) => {
    const user = s.requireActor(a, ['owner', 'manager', 'cashier', 'supervisor', 'assistant_manager']);
    return s.closeShift(id, d, user.id);
  }));
  add('shifts:closePreview', wrapSync((id, a) => {
    const user = s.requireActor(a, ['owner', 'manager', 'cashier', 'supervisor', 'assistant_manager']);
    return s.getShiftClosePreview(id, user.id);
  }));
  add('shifts:get', wrapSync(l => s.getShifts(l)));
  add('shifts:getOpenAll', wrapSync((a) => {
    s.requireActor(a, ['owner', 'manager']);
    return s.getAnyOpenShifts();
  }));
  add('shifts:forceClose', wrapSync((id, d, a) => s.adminForceCloseShift(id, d || {}, a)));
  add('shifts:update', wrapSync((id, d, a) => s.updateShiftRecord(id, d || {}, a)));
  add('shifts:delete', wrapSync((id, a) => s.deleteShiftRecord(id, a)));
  add('shifts:current', wrapSync(a => {
    const user = s.requireActor(a, ['owner', 'manager', 'cashier', 'supervisor', 'assistant_manager']);
    return s.getOpenShift(user.id);
  }));
  add('shifts:cashDrop', wrapSync((d, a) => s.recordCashDrop(d, a)));
  add('shifts:cashDrops', wrapSync(f => s.getCashDrops(f || {})));
  add('shifts:confirmCashDrop', wrapSync((id, a) => s.confirmCashDrop(id, a)));
  add('settings:getSalesTargets', wrapSync(() => s.getSalesTargets()));
  add('settings:saveSalesTargets', wrapSync((d, a) => {
    const user = s.requireActor(a, ['owner', 'manager']);
    return s.saveSalesTargets(d, user.id, user.username || user.full_name);
  }));
  add('settings:getShiftSettings', wrapSync(() => s.getShiftSettings()));
  add('settings:enforceCashoutDeadlines', wrapSync(() => s.enforceShiftCashoutDeadlines()));
  add('settings:saveShiftSettings', wrapSync((d, a) => {
    const user = s.requireActor(a, ['owner', 'manager']);
    return s.saveShiftSettings(d, user.id, user.username || user.full_name);
  }));

  add('reports:sales', wrapSync((f, t) => { requireSession(); return s.getSalesReport(f, t); }));
  add('reports:profit', wrapSync((f, t) => { requireSession(); return s.getProfitReport(f, t); }));
  add('reports:cashier', wrapSync((f, t) => { requireSession(); return s.getCashierReport(f, t); }));
  add('reports:product', wrapSync((f, t) => { requireSession(); return s.getProductReport(f, t); }));
  add('reports:stock', wrapSync(() => { requireSession(); return s.getStockReport(); }));
  add('reports:expenses', wrapSync((f, t) => { requireSession(); return s.getExpenses({ from: f, to: t }); }));
  add('reports:hourly', wrapSync((f, t) => { requireSession(); return s.getHourlySalesReport(f, t); }));
  add('reports:category', wrapSync((f, t) => { requireSession(); return s.getCategorySalesReport(f, t); }));
  add('reports:brand', wrapSync((f, t) => { requireSession(); return s.getBrandSalesReport(f, t); }));
  add('reports:payments', wrapSync((f, t) => { requireSession(); return s.getPaymentMethodReport(f, t); }));
  add('reports:employee', wrapSync((f, t) => { requireSession(); return s.getEmployeePerformanceReport(f, t); }));
  add('reports:discounts', wrapSync((f, t) => { requireSession(); return s.getDiscountReport(f, t); }));
  add('reports:voids', wrapSync((f, t) => { requireSession(); return s.getVoidReport(f, t); }));
  add('reports:movements', wrapSync((f, t) => { requireSession(); return s.getStockMovementReport(f, t); }));
  add('reports:profitDash', wrapSync((f, t) => { requireSession(); return s.getProfitDashboard(f, t); }));
  add('reports:giftcards', wrapSync((f, t) => { requireSession(); return s.getGiftCardReport(f, t); }));
  add('reports:layby', wrapSync((f, t) => { requireSession(); return s.getLaybyReport(f, t); }));
  add('reports:quotes', wrapSync((f, t) => { requireSession(); return s.getQuotesReport(f, t); }));
  add('reports:onaccount', wrapSync((f, t) => { requireSession(); return s.getOnAccountReport(f, t); }));
  add('reports:cashup', wrapSync((f, t) => { requireSession(); return s.getCashUpReport(f, t); }));
  add('reports:operating', wrapSync((f, t) => { requireSession(); return s.getOperatingLogReport(f, t); }));

  add('operating:log', wrapSync((type, user) => s.logOperatingEvent(type, user)));

  add('audit:get', wrapSync(f => {
    requireSession();
    return s.getAuditLog(typeof f === 'object' ? f : { limit: f || 200 });
  }));
  add('notifications:get', wrapSync(() => s.getNotifications()));
  add('notifications:read', wrapSync(id => { s.markNotificationRead(id); return true; }));
  add('notifications:readAll', wrapSync((actor) => {
    const sess = s.getUserSession?.() || null;
    const role = actor?.role || sess?.role || null;
    return s.markAllNotificationsRead(role || actor || sess);
  }));
  add('notifications:createTest', wrapSync(() => {
    s.requireActor(s.getUserSession?.(), ['owner', 'manager']);
    s.createTestNotification();
    return true;
  }));
  add('notifications:refreshPaymentDue', wrapSync(() => { s.refreshPaymentDueNotifications(); return true; }));
  add('notifications:ensureDemoSound', wrapSync(() => s.getSettingsParsed()?.notification_settings || {}));
  add('search:global', wrapSync(q => s.globalSearch(q)));

  add('deviceSettings:get', wrapSync(() => require('./shims/deviceSettings').load()));
  add('deviceSettings:save', wrapSync(d => require('./shims/deviceSettings').save(d)));

  add('print:receipt', async (html, options = {}) => {
    try {
      const printService = require('./shims/printService');
      const localDevice = require('./shims/deviceSettings').load();
      const settings = s.getSettingsParsed();
      const cfg = printService.mergePrintSettings(settings, options, localDevice);
      await printService.printHtml(html, {
        paperSize: options.useInvoice ? 'A4' : cfg.paperSize,
        copies: cfg.copies,
        printDuplicate: cfg.printDuplicate
      });
      return { success: true, printer: 'System Print', paperSize: options.useInvoice ? 'A4' : cfg.paperSize };
    } catch (err) {
      return { success: false, error: err.message, offline: true };
    }
  });
  add('print:kitchen', async (html, options = {}) => {
    try {
      const printService = require('./shims/printService');
      const localDevice = require('./shims/deviceSettings').load();
      const settings = s.getSettingsParsed();
      const cfg = printService.mergePrintSettings(settings, options, localDevice);
      await printService.printHtml(html, { paperSize: cfg.paperSize === '58mm' ? '58mm' : '80mm' });
      return { success: true, printer: 'System Print' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
  add('print:a4', async (html) => {
    try {
      const printService = require('./shims/printService');
      await printService.printHtml(html, { paperSize: 'A4' });
      return { success: true, printer: 'System Print' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
  add('print:preview', async (html, title) => {
    try {
      const printService = require('./shims/printService');
      await printService.openPreviewWindow(html, title || 'Print Preview');
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
  add('print:openDrawer', async () => {
    const printService = require('./shims/printService');
    return printService.openCashDrawer();
  });
  add('print:barcode', async (product) => {
    try {
      const printService = require('./shims/printService');
      const settings = s.getSettingsParsed();
      const result = await printService.printBarcodeLabel(product, settings);
      return { success: true, ...result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
  add('printers:list', wrapSync(() => require('./shims/printService').enrichPrinters([])));
  add('printers:listByConnection', wrapSync(conn => require('./shims/printService').filterPrintersByConnection([], conn)));
  add('printers:connect', async (connection, options) => {
    try {
      const result = await require('./shims/printService').connectPrinter(connection, options);
      return { success: true, data: result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
  add('printers:status', wrapSync(names => ({
    receipt: require('./shims/printService').printerStatus(names?.receipt || 'System Print'),
    kitchen: require('./shims/printService').printerStatus(names?.kitchen || 'System Print'),
    invoice: require('./shims/printService').printerStatus(names?.invoice || 'System Print')
  })));

  add('customer:openDisplay', async () => {
    require('./shims/printService').openCustomerDisplay();
    return { success: true };
  });
  add('customer:closeDisplay', async () => {
    require('./shims/printService').closeCustomerDisplay();
    return { success: true };
  });
  add('customer:refreshDisplay', async () => {
    require('./shims/printService').refreshCustomerDisplay();
    return { success: true };
  });
  add('kitchen:openDisplay', async () => {
    if (typeof window === 'undefined') {
      return { success: true, client: true };
    }
    require('./shims/printService').openKitchenDisplay();
    return { success: true };
  });
  add('kitchen:closeDisplay', async () => {
    if (typeof window === 'undefined') return { success: true };
    require('./shims/printService').closeKitchenDisplay();
    return { success: true };
  });
  add('kitchen:refreshDisplay', async () => {
    if (typeof window === 'undefined') return { success: true };
    require('./shims/printService').refreshKitchenDisplay();
    return { success: true };
  });

  const mobileFiles = require('./files');
  const capFiles = require('./capacitorFiles');
  const { getBackupInfo, scheduleDailyBackup } = require('./backup');
  add('file:selectImage', (...a) => {
    if (typeof document === 'undefined') return Promise.resolve({ success: false, error: 'Select the file in the browser' });
    return mobileFiles.selectImage(...a);
  });
  add('file:selectDocument', (...a) => {
    if (typeof document === 'undefined') return Promise.resolve({ success: false, error: 'Select the file in the browser' });
    return mobileFiles.selectDocument(...a);
  });
  add('file:persistMobileDocument', (...a) => mobileFiles.persistMobileDocument(...a));
  add('file:save', (...a) => mobileFiles.saveFile(...a));
  add('file:openPdf', async (buffer, filename) => mobileFiles.saveFile(filename || 'document.pdf', [{ name: 'PDF', extensions: ['pdf'] }], buffer));
  add('file:printPdf', async (buffer, filename) => {
    try {
      const printService = require('./shims/printService');
      if (typeof printService.printPdfBuffer === 'function') {
        return await printService.printPdfBuffer(buffer, filename || 'document.pdf');
      }
    } catch (_) { /* fall through */ }
    // Fallback: share/save so the user can open and print from a PDF app
    return mobileFiles.saveFile(filename || 'document.pdf', [{ name: 'PDF', extensions: ['pdf'] }], buffer);
  });
  add('file:openPath', (...a) => mobileFiles.openPath(...a));
  add('file:getImageDataUrl', (...a) => mobileFiles.getImageDataUrl(...a));
  add('file:selectAudio', (...a) => mobileFiles.selectAudio(...a));
  add('file:getAudioDataUrl', (...a) => mobileFiles.getAudioDataUrl(...a));
  add('file:copyImageToClipboard', async (filePath) => {
    // Mobile: native share sheet (clipboard images are limited) — open share with the file
    try {
      const path = String(filePath || '');
      if (!path) return { success: false, error: 'No file' };
      const fs = require('fs');
      if (!fs.existsSync(path)) return { success: false, error: 'File not found' };
      const { Capacitor } = require('@capacitor/core');
      if (Capacitor?.isNativePlatform?.()) {
        const capFiles = require('./capacitorFiles');
        const bytes = fs.readFileSync(path);
        const name = require('path').basename(path);
        await capFiles.saveAndShare(name, bytes);
        return { success: true, shared: true };
      }
      return { success: false, error: 'Clipboard image not available on this device' };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
  add('file:shareNative', async (filePath, title) => {
    try {
      const fs = require('fs');
      const pathMod = require('path');
      const path = String(filePath || '');
      if (!path || !fs.existsSync(path)) return { success: false, error: 'File not found' };
      const capFiles = require('./capacitorFiles');
      const bytes = fs.readFileSync(path);
      await capFiles.saveAndShare(title || pathMod.basename(path), bytes);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  add('backup:create', async (actor) => {
    try {
      s.requireActor(actor, ['owner']);
      const { exportDatabaseBytes } = require('./db');
      const bytes = exportDatabaseBytes();
      const name = capFiles.backupFilename();
      const r = capFiles.isNative()
        ? await capFiles.saveAndShare(name, new Uint8Array(bytes), capFiles.BACKUP_DIR)
        : await mobileFiles.saveFile(name, [{ name: 'Database', extensions: ['db'] }], bytes);
      if (r.success) s.saveSettings({ last_backup: new Date().toISOString() }, null, 'system');
      return r;
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
  add('backup:restore', async (actor) => {
    try {
      s.requireActor(actor, ['owner']);
      const picked = await mobileFiles.selectDbFile();
      if (!picked.success) return picked;
      const { importDatabaseBytes, validateDatabaseBytes } = require('./db');
      await validateDatabaseBytes(picked.bytes);
      await importDatabaseBytes(picked.bytes);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
  add('backup:restoreSetup', async () => {
    try {
      const info = s.detectExistingBusiness();
      if (info?.exists || info?.setup_complete) {
        return {
          success: false,
          error: 'This device already has shop data. Sign in as owner and use Admin → Backup & Restore.'
        };
      }
      const picked = await mobileFiles.selectDbFile();
      if (!picked.success) return picked;
      const { importDatabaseBytes, validateDatabaseBytes } = require('./db');
      await validateDatabaseBytes(picked.bytes);
      await importDatabaseBytes(picked.bytes);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
  add('backup:export', async (actor) => {
    try {
      s.requireActor(actor, ['owner']);
      const { exportDatabaseBytes } = require('./db');
      const bytes = exportDatabaseBytes();
      const name = `shop-pos-export-${new Date().toISOString().slice(0, 10)}.db`;
      return mobileFiles.saveFile(name, [{ name: 'Database', extensions: ['db'] }], bytes);
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
  add('backup:getInfo', wrapSync(() => getBackupInfo(s)));

  add('export:excel', async (filename, sheets) => {
    try {
      const buf = require('../electron/services/export').buildExcelBuffer(sheets);
      const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
      if (typeof document === 'undefined') {
        return { success: true, data: bytes, filename: filename || 'export.xlsx' };
      }
      const name = filename || `export-${new Date().toISOString().slice(0, 10)}.xlsx`;
      return mobileFiles.saveFile(name, [{ name: 'Excel', extensions: ['xlsx'] }], bytes);
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
  add('export:pdf', async (filename, title, headers, rows, company) => {
    try {
      const buf = require('../electron/services/export').buildPdfBuffer(title, headers, rows, company || {});
      const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
      if (typeof document === 'undefined') {
        return { success: true, data: bytes, filename: filename || 'report.pdf' };
      }
      const name = filename || `${String(title || 'report').replace(/[^\w\-]+/g, '-')}.pdf`;
      return mobileFiles.saveFile(name, [{ name: 'PDF', extensions: ['pdf'] }], bytes);
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
  add('export:print', async (title, headers, rows, company) => {
    try {
      const { buildReportHtml } = require('../electron/services/export');
      const html = buildReportHtml(title, headers, rows, company || {});
      if (typeof document === 'undefined' || (typeof window !== 'undefined' && window.__SHOP_POS_CLOUD__)) {
        return { success: true, data: html, html };
      }
      const printService = require('./shims/printService');
      await printService.openPreviewWindow(html, title || 'Print Report');
      return { success: true, preview: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  add('quotes:get', wrapSync(f => s.getQuotes(f || {})));
  add('quotes:getOne', wrapSync(id => s.getQuote(id)));
  add('quotes:save', wrapSync((d, a) => {
    const user = s.requireActor(a, ['owner', 'manager', 'cashier', 'supervisor', 'assistant_manager']);
    return s.saveQuote(d, user.id);
  }));
  add('quotes:convert', wrapSync((id, a, paymentOpts) => {
    const user = s.requireActor(a, ['owner', 'manager', 'cashier', 'supervisor', 'assistant_manager']);
    return s.convertQuoteToSale(id, user.id, user.full_name, paymentOpts || null);
  }));
  add('quotes:delete', wrapSync((id, a) => {
    const user = s.requireActor(a, ['owner', 'manager']);
    return s.deleteQuote(id, user.id, user.username);
  }));
  add('quotes:markConverted', wrapSync((id, saleId, a) => {
    const user = s.requireActor(a, ['owner', 'manager', 'cashier', 'supervisor', 'assistant_manager']);
    return s.markQuoteConverted(id, saleId, user.id, user.full_name || user.username);
  }));
  add('quotes:reactivate', wrapSync((id, a) => {
    const user = s.requireActor(a, ['owner', 'manager']);
    return s.reactivateQuote(id, user.id, user.full_name || user.username);
  }));
  add('quotes:pdf', wrapSync(id => {
    const st = s.getSettings();
    return s.buildQuotePdf(id, st);
  }));

  add('layby:get', wrapSync((filters) => { requireSession(); return s.getLaybyes(filters || {}); }));
  add('layby:getOne', wrapSync(id => s.getLayby(id)));
  add('layby:create', wrapSync((d, a) => {
    const user = s.requireActor(a, ['owner', 'manager', 'cashier', 'supervisor', 'assistant_manager']);
    return s.createLayby(d, user.id);
  }));
  add('layby:pay', wrapSync((id, amount, type, actor) => {
    const user = s.requireActor(actor, ['owner', 'manager', 'cashier', 'supervisor', 'assistant_manager']);
    return s.addLaybyPayment(id, amount, type, user.id);
  }));
  add('layby:refund', wrapSync((id, actor) => {
    const user = s.requireActor(actor, ['owner', 'manager', 'assistant_manager', 'supervisor']);
    return s.refundLayby(id, user.id, user.username);
  }));
  add('layby:getSettings', wrapSync((actor) => {
    s.requireActor(actor || s.getUserSession?.(), ['owner', 'manager', 'assistant_manager', 'supervisor', 'cashier']);
    return s.getLaybySettings();
  }));
  add('layby:saveSettings', wrapSync((data, actor) => {
    const user = s.requireActor(actor, ['owner', 'manager']);
    return s.saveLaybySettings(data, user.id, user.username);
  }));

  add('giftcards:get', wrapSync((filters) => { requireSession(); return s.getGiftCards(filters || {}); }));
  add('giftcards:create', wrapSync((d, a) => {
    const user = s.requireActor(a, ['owner', 'manager', 'supervisor', 'assistant_manager', 'cashier']);
    return s.createGiftCard(d, user.id, user.username);
  }));
  add('giftcards:update', wrapSync((id, data, actor) => {
    const user = s.requireActor(actor, ['owner', 'manager']);
    return s.updateGiftCard(id, data, user);
  }));
  add('giftcards:delete', wrapSync((id, a) => {
    const user = s.requireActor(a, ['owner', 'manager']);
    return s.deleteGiftCard(id, user);
  }));
  add('giftcards:check', wrapSync(c => s.checkGiftCardBalance(c)));
  add('giftcards:approve', wrapSync((id, actor) => {
    const user = s.requireActor(actor, ['owner', 'manager', 'assistant_manager', 'supervisor']);
    return s.approveGiftCard(id, user.id, user.username);
  }));
  add('giftcards:reject', wrapSync((id, notes, actor) => {
    const user = s.requireActor(actor, ['owner', 'manager', 'assistant_manager', 'supervisor']);
    return s.rejectGiftCard(id, user.id, user.username, notes);
  }));
  add('giftcards:getSettings', wrapSync((actor) => {
    s.requireActor(actor || s.getUserSession?.(), ['owner', 'manager', 'assistant_manager', 'supervisor']);
    return s.getGiftCardSettings();
  }));
  add('giftcards:saveSettings', wrapSync((data, actor) => {
    const user = s.requireActor(actor, ['owner', 'manager']);
    return s.saveGiftCardSettings(data, user.id, user.username);
  }));

  add('loyalty:history', wrapSync(id => s.getLoyaltyHistory(id)));
  add('credit:ledger', wrapSync(id => { requireSession(); return s.getCustomerCreditLedger(id); }));
  add('credit:pay', wrapSync((id, amt, n, a) => {
    const user = s.requireActor(a, ['owner', 'manager', 'cashier', 'supervisor', 'assistant_manager']);
    return s.addCustomerCreditPayment(id, amt, n, user.id);
  }));

  add('stockcount:get', wrapSync(() => s.getStockCounts()));
  add('stockcount:getOne', wrapSync(id => s.getStockCount(id)));
  add('stockcount:create', wrapSync((notes, actor) => {
    const user = s.requireActor(actor, ['owner', 'manager', 'supervisor', 'assistant_manager']);
    return s.createStockCount(user.id, notes);
  }));
  add('stockcount:updateLine', wrapSync((lineId, qty, a) => {
    s.requireActor(a || s.getUserSession?.(), ['owner', 'manager', 'supervisor', 'assistant_manager']);
    return s.updateStockCountLine(lineId, qty);
  }));
  add('stockcount:complete', wrapSync((id, a) => {
    const user = s.requireActor(a, ['owner', 'manager', 'supervisor', 'assistant_manager']);
    return s.completeStockCount(id, user.id);
  }));

  add('waste:get', wrapSync((from, to, filters) => { requireSession(); return s.getWasteRecords(from, to, filters || {}); }));
  add('waste:record', wrapSync((d, a) => {
    const user = s.requireActor(a, ['owner', 'manager', 'supervisor', 'assistant_manager', 'cashier']);
    return s.recordWaste(d, user.id);
  }));
  add('waste:approve', wrapSync((id, notes, a) => {
    const user = s.requireActor(a, ['owner', 'manager', 'assistant_manager', 'supervisor']);
    return s.approveWaste(id, user.id, notes);
  }));
  add('waste:reject', wrapSync((id, notes, a) => {
    const user = s.requireActor(a, ['owner', 'manager', 'assistant_manager', 'supervisor']);
    return s.rejectWaste(id, user.id, notes);
  }));
  add('waste:returnStock', wrapSync((id, a) => {
    const user = s.requireActor(a, ['owner', 'manager', 'assistant_manager', 'supervisor']);
    return s.returnWasteToStock(id, user.id);
  }));

  add('cashup:get', wrapSync(l => { requireSession(); return s.getCashUps(l); }));
  add('cashup:getOne', wrapSync(id => { requireSession(); return s.getCashUp(id); }));
  add('cashup:byShift', wrapSync(shiftId => { requireSession(); return s.getCashUpByShift(shiftId); }));
  add('cashup:create', wrapSync((shiftId, data, actor) => {
    const user = s.requireActor(actor, ['owner', 'manager', 'cashier', 'supervisor', 'assistant_manager']);
    return s.createCashUp(shiftId, { ...data, manager_approved: false, force_pending: true }, user.id);
  }));
  add('cashup:approve', wrapSync((id, notes, a) => {
    const user = s.requireActor(a, ['owner', 'manager', 'assistant_manager', 'supervisor']);
    return s.approveCashUp(id, user.id, notes);
  }));
  add('cashup:update', wrapSync((id, data, a) => {
    const user = s.requireActor(a, ['owner', 'manager', 'assistant_manager']);
    return s.updateCashUp(id, data || {}, user.id);
  }));
  add('cashup:delete', wrapSync((id, a) => {
    const user = s.requireActor(a, ['owner', 'manager', 'assistant_manager']);
    return s.deleteCashUp(id, user.id);
  }));
  add('cashup:summary', wrapSync((from, to) => { requireSession(); return s.getCashUpSummary(from, to); }));
  add('cashup:pdf', wrapSync(id => {
    requireSession();
    const st = s.getSettingsParsed?.() || {};
    return s.buildCashUpPdf(id, st.shop_name, st.currency || 'R');
  }));

  add('automation:get', wrapSync(() => s.getAutomationRules()));
  add('automation:save', wrapSync((data, actor) => {
    s.requireActor(actor || s.getUserSession?.(), ['owner', 'manager']);
    return s.saveAutomationRule(data);
  }));
  add('automation:delete', wrapSync((id, actor) => {
    s.requireActor(actor || s.getUserSession?.(), ['owner', 'manager']);
    return s.deleteAutomationRule(id);
  }));

  add('customfields:get', wrapSync(t => s.getCustomFields(t)));
  add('customfields:save', wrapSync((d, actor) => {
    s.requireActor(actor || s.getUserSession?.(), ['owner', 'manager']);
    return s.saveCustomField(d);
  }));
  add('customfields:delete', wrapSync((id, actor) => {
    s.requireActor(actor || s.getUserSession?.(), ['owner', 'manager']);
    return s.deleteCustomField(id);
  }));
  add('customfields:values', wrapSync((t, id) => s.getCustomFieldValues(t, id)));
  add('customfields:saveValues', wrapSync((t, id, values, actor) => {
    s.requireActor(actor || s.getUserSession?.(), ['owner', 'manager', 'assistant_manager']);
    return s.saveCustomFieldValues(t, id, values);
  }));
  add('file:openExternal', wrapAsync(async (url) => {
    const href = String(url || '').trim();
    if (!href) throw new Error('No URL');
    window.open(href, '_blank', 'noopener,noreferrer');
    return true;
  }));

  add('tables:get', wrapSync(() => s.getTables()));
  add('tables:save', wrapSync((d, a) => {
    s.requireActor(a || s.getUserSession(), ['owner', 'manager', 'assistant_manager', 'supervisor', 'cashier']);
    return s.saveTable(d);
  }));
  add('tables:delete', wrapSync((id, a) => {
    s.requireActor(a || s.getUserSession(), ['owner', 'manager']);
    s.deleteTable(id);
    return true;
  }));
  add('reports:orderTypes', wrapSync((f, t) => { requireSession(); return s.getOrderTypeReport(f, t); }));
  add('store:runStartupTasks', wrapSync(() => s.runStartupTasks()));
  add('employeeOfMonth:getScores', wrapSync((my, a) => { s.requireActor(a, ['owner', 'manager', 'supervisor']); return s.getScores(my); }));
  add('employeeOfMonth:getRecord', wrapSync((my, a) => { s.requireActor(a, ['owner', 'manager', 'supervisor']); return s.getRecord(my); }));
  add('employeeOfMonth:save', wrapSync((d, a) => s.saveRecord(d, a)));
  add('employeeOfMonth:certificate', wrapSync((my, a) => s.generateCertificate(my, a)));
  add('employeeOfMonth:notifyWhatsApp', wrapSync((my, a) => s.notifyWhatsApp(my, a)));
  add('employeeOfMonth:sendCertificateWhatsApp', wrapSync((empId, a) => s.sendSelfCertificateWhatsApp(empId, a)));
  add('employeeOfMonth:getHistory', wrapSync((f, a) => { s.requireActor(a, ['owner', 'manager', 'supervisor']); return s.getAllRecords(f || {}); }));
  add('employeeOfMonth:delete', wrapSync((id, a) => s.deleteRecord(id, a)));
  add('settings:saveKdsSound', wrapSync((p, a) => {
    const user = s.requireActor(a, ['owner', 'manager']);
    return s.saveKdsNotificationSound(p, user.id, user.username);
  }));
  add('kitchen:get', wrapSync(st => s.getKitchenOrders(st)));
  add('kitchen:status', wrapSync((id, st, a) => {
    s.requireActor(a || s.getUserSession?.(), ['owner', 'manager', 'cashier', 'supervisor', 'assistant_manager']);
    return s.updateKitchenOrderStatus(id, st);
  }));
  add('kitchen:create', wrapSync((d, a) => {
    const user = s.requireActor(a, ['owner', 'manager', 'cashier', 'supervisor', 'assistant_manager']);
    return s.createKitchenOrder(d, user.id);
  }));

  add('security:generateCode', wrapSync((a, p) => {
    const user = s.requireActor(a, ['owner', 'manager']);
    return s.generateSupervisorCode(user.id, p || 'void');
  }));
  add('security:getTodayCode', wrapSync((actor, purpose) => {
    s.requireActor(actor, ['owner', 'manager']);
    return s.getTodaySupervisorCode(purpose || 'void');
  }));
  add('security:verifyCode', wrapSync((c, p) => { s.verifySupervisorCode(c, p || 'void'); return true; }));

  add('staff:getEmployees', wrapSync((f, a) => {
    s.requireActor(a || s.getUserSession?.(), []);
    return s.getEmployees(f);
  }));
  add('staff:getEmployee', wrapSync(id => s.getEmployee(id)));
  add('staff:getEmployeeByUserId', wrapSync(userId => s.getEmployeeByUserId(userId)));
  add('staff:saveEmployee', wrapSync((d, a) => {
    s.requireActor(a, ['owner', 'manager']);
    return s.saveEmployee(d, a.id);
  }));
  add('staff:deleteEmployee', wrapSync((id, actor) => {
    s.requireActor(actor, ['owner', 'manager']);
    return s.deleteEmployee(id, actor.id, actor.username || actor.full_name);
  }));
  add('staff:login', wrapSync((c, p) => s.verifyEmployeeCodePin(c, p)));
  add('staff:adminOpen', wrapSync((id, a) => s.adminOpenEmployeePortal(id, a || s.getUserSession?.())));
  add('staff:logout', wrapSync(() => {
    s.clearEmployeeSession?.();
    return { ok: true };
  }));
  add('staff:validateLinks', wrapSync((data) => s.validateEmployeeLinks(data || {})));
  add('staff:saveSelfie', wrapSync((d, a) => {
    const empSess = s.getEmployeeSession?.();
    const sessEmpId = empSess ? Number(empSess.id || empSess.employee_id) : null;
    if (sessEmpId != null && sessEmpId === Number(d?.employee_id)) return s.saveStaffSelfie(d);
    s.requireActor(a || s.getUserSession?.(), ['owner', 'manager']);
    return s.saveStaffSelfie(d);
  }));
  add('staff:getSelfies', wrapSync((f, a) => {
    s.requireActor(a, ['owner', 'manager']);
    return s.getStaffSelfies(f || {});
  }));
  add('staff:getSelfie', wrapSync((id, a) => {
    s.requireActor(a, ['owner', 'manager']);
    return s.getStaffSelfie(id);
  }));
  add('staff:updateSelfie', wrapSync((id, photo, notes, a) => {
    s.requireActor(a, ['owner', 'manager']);
    return s.updateStaffSelfie(id, photo, a?.id, a?.username || a?.full_name, notes);
  }));
  add('staff:deleteSelfie', wrapSync((id, a) => {
    s.requireActor(a, ['owner', 'manager']);
    return s.deleteStaffSelfie(id, a?.id, a?.username || a?.full_name);
  }));
  add('staff:clock', wrapSync((employeeId, act, auth) => {
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
    const empSess = s.getEmployeeSession?.();
    const sessEmpId = empSess ? Number(empSess.id || empSess.employee_id) : null;
    if (pin) {
      if (sessEmpId != null && sessEmpId !== empId) throw new Error('Authentication required');
      return s.clockAction(empId, act, pin, clientRequestId);
    }
    if (sessEmpId != null) {
      if (sessEmpId !== empId) throw new Error('Authentication required');
      if (empSess && !empSess.pinVerified) throw new Error('PIN required to clock');
      return s.clockActionVerified(empId, act, clientRequestId);
    }
    const userActor = actor || s.getUserSession?.();
    s.requireActor(userActor, ['owner', 'manager', 'supervisor', 'assistant_manager']);
    return s.clockActionVerified(empId, act, clientRequestId);
  }));
  add('staff:getAttendance', wrapSync(f => { requireSession(); return s.getAttendance(f); }));
  add('staff:getTodayAttendance', wrapSync(id => s.getTodayAttendance(scopedEmployeeId(id))));
  add('staff:getLeave', wrapSync(id => s.getLeave(scopedEmployeeId(id))));
  add('staff:getAllLeave', wrapSync(st => { requireSession(); return s.getAllLeave(st); }));
  add('staff:saveLeave', wrapSync((d, a) => {
    const empSess = s.getEmployeeSession?.();
    const userSess = s.getUserSession?.();
    if (empSess?.adminOverride && userSess?.id) {
      return s.saveLeave(d, userSess);
    }
    const sessEmpId = empSess ? Number(empSess.id || empSess.employee_id) : null;
    if (sessEmpId != null && sessEmpId === Number(d?.employee_id)) {
      return s.saveLeave(d, null);
    }
    const user = s.requireActor(a || userSess, []);
    return s.saveLeave(d, user);
  }));
  add('staff:approveLeave', wrapSync((id, a, ok) => {
    const user = s.requireActor(a, ['owner', 'manager', 'supervisor', 'assistant_manager']);
    return s.approveLeave(id, user.id, ok !== false, user.full_name || user.username, user);
  }));
  add('staff:leavePdf', wrapSync(id => {
    requireSession();
    const empSess = s.getEmployeeSession?.();
    if (empSess?.employee_id != null) {
      const mine = s.getLeave(Number(empSess.employee_id)) || [];
      if (!mine.some((l) => Number(l.id) === Number(id))) throw new Error('Authentication required');
    }
    return s.buildLeavePdf(id);
  }));
  add('staff:submitLeaveProof', wrapSync((leaveId, empId, img, a) => {
    const empSess = s.getEmployeeSession?.();
    const sessEmpId = empSess ? Number(empSess.id || empSess.employee_id) : null;
    if (sessEmpId != null && sessEmpId === Number(empId)) {
      return s.submitLeaveProof(leaveId, empId, img);
    }
    s.requireActor(a || s.getUserSession?.(), ['owner', 'manager', 'supervisor']);
    return s.submitLeaveProof(leaveId, empId, img);
  }));
  add('staff:confirmLeaveProof', wrapSync((leaveId, a) => {
    s.requireActor(a, ['owner', 'manager']);
    return s.confirmLeaveProof(leaveId, a?.id);
  }));
  add('staff:getPendingLeaveProofs', wrapSync(() => { requireSession(); return s.getPendingLeaveProofs(); }));
  add('staff:getLeaveBalance', wrapSync(id => s.getLeaveBalance(scopedEmployeeId(id))));
  add('staff:getLeavePolicy', wrapSync(id => s.getLeavePolicyForEmployee(scopedEmployeeId(id))));
  add('staff:getPayroll', wrapSync((id) => s.getPayroll(scopedEmployeeId(id))));
  add('staff:generatePayroll', wrapSync((start, end, ids, a) => {
    s.requireActor(a, ['owner', 'manager']);
    return s.generatePayroll(start, end, ids);
  }));
  add('staff:paySalary', wrapSync((id, m, a) => {
    s.requireActor(a, ['owner', 'manager']);
    s.paySalary(id, m);
    const to = new Date().toLocaleDateString('en-CA');
    const from = new Date(Date.now() - 90 * 86400000).toLocaleDateString('en-CA');
    s.syncLedger(from, to);
    s.refreshPaymentDueNotifications();
    return true;
  }));
  add('salaryClaims:list', wrapSync((f, a) => {
    try {
      const empId = (f && f.employee_id) || a?.employee_id;
      if (s.getEmployeeSession?.()?.employee_id != null || a?.employee_id != null) {
        const id = portalEmployeeId(empId, a);
        return s.listSalaryClaims({ ...(f || {}), employee_id: id });
      }
      s.requireActor(a, ['owner', 'manager']);
      return s.listSalaryClaims(f || {});
    } catch (err) {
      if (/no such table|does not exist/i.test(String(err.message || ''))) return [];
      throw err;
    }
  }));
  add('salaryClaims:get', wrapSync((id, a) => {
    const c = s.getSalaryClaim(id);
    if (!c) throw new Error('Claim not found');
    const emp = s.getEmployeeSession?.();
    if (emp?.employee_id != null && Number(c.employee_id) !== Number(emp.employee_id)) throw new Error('Not authorised');
    if (emp?.employee_id == null) s.requireActor(a, ['owner', 'manager']);
    return c;
  }));
  add('salaryClaims:save', wrapSync((d, a) => { s.requireActor(a, ['owner', 'manager']); return s.saveSalaryClaim(d, a.id, a.username || a.full_name); }));
  add('salaryClaims:delete', wrapSync((id, a) => { s.requireActor(a, ['owner', 'manager']); return s.deleteSalaryClaim(id, a.id, a.username || a.full_name); }));
  add('salaryClaims:claim', wrapSync((id, notes, a) => {
    const emp = s.getEmployeeSession?.();
    const empId = emp?.employee_id ?? a?.employee_id;
    if (empId == null) throw new Error('Employee login required');
    return s.claimSalaryByEmployee(id, notes, empId);
  }));
  add('salaryClaims:approve', wrapSync((id, notes, a) => { s.requireActor(a, ['owner', 'manager']); return s.approveSalaryClaim(id, notes, a.id, a.username || a.full_name); }));
  add('salaryClaims:reject', wrapSync((id, notes, a) => { s.requireActor(a, ['owner', 'manager']); return s.rejectSalaryClaim(id, notes, a.id, a.username || a.full_name); }));
  add('salaryClaims:markPaid', wrapSync((id, a) => { s.requireActor(a, ['owner', 'manager']); return s.markSalaryClaimPaid(id, a.id, a.username || a.full_name); }));
  add('salaryClaims:pdf', wrapSync((id, a) => {
    const c = s.getSalaryClaim(id);
    if (!c) throw new Error('Claim not found');
    const emp = s.getEmployeeSession?.();
    if (emp?.employee_id != null && Number(c.employee_id) !== Number(emp.employee_id)) throw new Error('Not authorised');
    if (emp?.employee_id == null) s.requireActor(a, ['owner', 'manager']);
    return s.buildSalaryClaimPdf(id, s.getSettingsParsed());
  }));
  add('salaryClaims:fromPayroll', wrapSync((start, end, deadline, payDate, opensAt, a) => {
    s.requireActor(a, ['owner', 'manager']);
    return s.createClaimsFromPayroll(start, end, deadline, payDate, opensAt, a.id, a.username || a.full_name);
  }));
  add('staff:getPayrollDashboard', wrapSync((f, a) => {
    s.requireActor(a, ['owner', 'manager']);
    return s.getPayrollDashboard(f || {});
  }));
  add('staff:previewPayroll', wrapSync((start, end, f, a) => {
    s.requireActor(a, ['owner', 'manager']);
    return s.previewPayroll(start, end, f || {});
  }));
  add('staff:getMissedClockOutInbox', wrapSync((f, a) => {
    s.requireActor(a, ['owner', 'manager', 'supervisor', 'assistant_manager']);
    return s.getMissedClockOutInbox(f || {});
  }));
  add('staff:resolveMissedClockOut', wrapSync((id, action, a) => s.resolveMissedClockOut(id, action, a)));
  add('staff:saveWorkSchedule', wrapSync((empId, sched, a) => {
    s.requireActor(a, ['owner', 'manager']);
    return s.saveEmployeeWorkSchedule(empId, sched, a.id, a.username || a.full_name || 'manager');
  }));
  add('staff:saveHrDocument', wrapSync((d, a) => {
    s.requireActor(a, ['owner', 'manager']);
    return s.saveHrDocument(d, a.id, a.username || a.full_name || 'manager');
  }));
  add('staff:getHrDocuments', wrapSync((empId, a) => {
    s.requireActor(a, ['owner', 'manager']);
    return s.getHrDocuments(empId);
  }));
  add('staff:getHrDocument', wrapSync((id, a) => {
    s.requireActor(a, ['owner', 'manager']);
    return s.getHrDocument(id);
  }));
  add('staff:buildHrDocumentHtml', wrapSync((d, a) => {
    s.requireActor(a, ['owner', 'manager']);
    const emp = s.getEmployee(d.employee_id);
    const st = s.getSettingsParsed();
    return s.buildHrDocumentHtml({
      ...d,
      employee_name: emp?.full_name,
      employee_code: emp?.employee_code,
      position: emp?.position,
      branch: emp?.branch
    }, st);
  }));
  add('staff:updateAttendance', wrapSync((id, d, a) => {
    s.requireActor(a, ['owner', 'manager']);
    return s.updateAttendance(id, d, a.id, a.username || a.full_name || 'manager');
  }));
  add('staff:deleteAttendance', wrapSync((id, a) => s.deleteAttendance(id, a)));
  add('staff:createAttendance', wrapSync((d, a) => s.createManualAttendance(d, a)));
  add('staff:addAttendancePenalty', wrapSync((d, a) => s.addAttendancePenalty(d, a)));
  add('staff:getAttendancePenalties', wrapSync((f, a) => {
    s.requireActor(a, ['owner', 'manager', 'supervisor', 'assistant_manager']);
    return s.getAttendancePenalties(f || {});
  }));
  add('staff:cancelAttendancePenalty', wrapSync((id, a) => s.cancelAttendancePenalty(id, a)));
  add('staff:getAttendanceSummary', wrapSync((id, f, t) => s.getAttendanceSummary(scopedEmployeeId(id), f, t)));
  add('staff:getSchedules', wrapSync((f, t, e) => {
    const empSess = s.getEmployeeSession?.();
    const userSess = s.getUserSession?.();
    if (empSess?.adminOverride && userSess?.id) {
      requireSession();
      return s.getSchedules(f, t, e);
    }
    if (empSess?.employee_id != null) return s.getSchedules(f, t, empSess.employee_id);
    requireSession();
    return s.getSchedules(f, t, e);
  }));
  add('staff:saveSchedule', wrapSync((d, a) => {
    s.requireActor(a, ['owner', 'manager', 'supervisor', 'assistant_manager']);
    return s.saveSchedule(d);
  }));
  add('staff:deleteSchedule', wrapSync((id, a) => {
    s.requireActor(a, ['owner', 'manager', 'supervisor', 'assistant_manager']);
    return s.deleteSchedule(id);
  }));
  add('staff:autoShifts', wrapSync((w, t, ids, overrides, a, options) => {
    s.requireActor(a, ['owner', 'manager', 'supervisor', 'assistant_manager']);
    return s.autoGenerateShifts(w, t, ids, overrides, options || {});
  }));
  add('staff:getDocuments', wrapSync(id => s.getEmployeeDocuments(id)));
  add('staff:saveDocument', wrapSync((d, a) => {
    s.requireActor(a, ['owner', 'manager']);
    return s.saveEmployeeDocument(d);
  }));
  add('staff:getDisciplinary', wrapSync(id => s.getDisciplinary(scopedEmployeeId(id))));
  add('staff:saveDisciplinary', wrapSync((d, a) => {
    s.requireActor(a, ['owner', 'manager']);
    return s.saveDisciplinary(d, a.id);
  }));
  add('staff:respondDisciplinary', wrapSync((id, empId, resp, a) => {
    const empSess = s.getEmployeeSession?.();
    const sessEmpId = empSess ? Number(empSess.id || empSess.employee_id) : null;
    if (sessEmpId != null && sessEmpId === Number(empId)) return s.respondDisciplinary(id, empId, resp);
    s.requireActor(a || s.getUserSession?.(), ['owner', 'manager', 'supervisor']);
    return s.respondDisciplinary(id, empId, resp);
  }));
  add('staff:getAllDisciplinary', wrapSync((f, a) => {
    s.requireActor(a || s.getUserSession?.(), ['owner', 'manager', 'supervisor']);
    return s.getAllDisciplinary(f || {});
  }));
  add('staff:disciplinaryPdf', wrapSync((id, copyType) => s.buildDisciplinaryPdfBuffer(id, copyType || 'staff')));
  add('staff:markDisciplinaryWa', wrapSync(id => { s.markDisciplinaryWhatsAppSent(id); return true; }));
  add('staff:getCustomerPhoneReport', wrapSync(f => s.getCustomerPhoneReport(f || {})));
  add('staff:customerPhoneReportPdf', wrapSync(f => {
    const settings = s.getSettingsParsed?.() || {};
    return s.buildCustomerPhoneReportPdf(f || {}, settings.shop_name, settings.currency || 'R');
  }));
  add('staff:getPerformance', wrapSync((id, f, t) => s.getEmployeePerformance(id, f, t)));
  add('staff:getNotifications', wrapSync(() => s.getStaffNotifications()));
  add('staff:payslipPdf', wrapSync(id => {
    const st = s.getSettingsParsed();
    return s.buildPayslipPdf(id, st?.shop_name, st?.currency || 'R');
  }));
  add('staff:schedulePdf', wrapSync((f, t) => {
    const st = s.getSettingsParsed();
    return s.buildSchedulePdf(f, t, st?.shop_name);
  }));
  add('staff:schedulePrintHtml', wrapSync((f, t) => {
    const st = s.getSettingsParsed();
    return s.buildSchedulePrintHtml(f, t, st?.shop_name);
  }));
  add('staff:getLoginEvents', wrapSync(f => s.getUserLoginEvents(f || {})));
  add('staff:recordLogout', wrapSync(user => {
    s.recordUserLoginEvent(user, 'logout');
    return true;
  }));
  add('staff:reportPdf', wrapSync((type, data) => {
    const st = s.getSettingsParsed();
    return s.buildStaffReportPdf(type, data, st?.shop_name, st?.currency || 'R');
  }));
  add('staff:validateAccount', wrapSync((cid, amt) => {
    const st = s.getSettingsParsed();
    return s.validateOnAccount(cid, amt, st?.account_settings);
  }));
  add('staff:getPortalFeed', wrapSync(id => s.getPortalFeed(scopedEmployeeId(id))));

  const hrActor = (a) => a?.username || a?.full_name || 'manager';
  const hrRead = ['owner', 'manager', 'supervisor'];
  const hrWrite = ['owner', 'manager'];
  add('hr:getEvalCategories', wrapSync(() => s.EVAL_CATEGORIES));
  add('hr:populateContract', wrapSync((eid, tid, a) => { s.requireActor(a, hrWrite); return s.populateContractFromEmployee(eid, tid); }));
  add('hr:fillContractBody', wrapSync((data, a) => { s.requireActor(a, hrWrite); return s.fillContractTemplate(data?.body_template || s.CHISANYAMA_BODY, data || {}); }));
  add('hr:getContractTemplates', wrapSync((a) => { s.requireActor(a, hrRead); return s.getContractTemplates(); }));
  add('hr:saveContractTemplate', wrapSync((d, a) => { s.requireActor(a, hrWrite); return s.saveContractTemplate(d, a.id, hrActor(a)); }));
  add('hr:deleteContractTemplate', wrapSync((id, a) => { s.requireActor(a, hrWrite); return s.deleteContractTemplate(id, a.id, hrActor(a)); }));
  add('hr:getContracts', wrapSync((f, a) => { s.requireActor(a, hrRead); return s.getContracts(f || {}); }));
  add('hr:getContract', wrapSync((id, a) => { s.requireActor(a, hrRead); return s.getContract(id); }));
  add('hr:saveContract', wrapSync((d, a) => { s.requireActor(a, hrWrite); return s.saveContract(d, a.id, hrActor(a)); }));
    add('hr:signContract', wrapSync((cid, role, sig, a) => {
    const emp = s.getEmployeeSession?.();
    if (emp?.employee_id != null) {
      return s.signContract(cid, 'employee', sig, null, emp.full_name || ('employee:' + emp.employee_id));
    }
    s.requireActor(a, hrWrite);
    return s.signContract(cid, role, sig, a.id, hrActor(a));
  }));
  add('hr:openContractResign', wrapSync((id, opens, closes, a) => {
    s.requireActor(a, hrWrite);
    return s.openContractResign(id, opens, closes, a.id, hrActor(a));
  }));
  add('hr:attachContractDoc', wrapSync((cid, fp, fn, a) => {
    const emp = s.getEmployeeSession?.();
    const empId = emp?.employee_id ?? a?.employee_id;
    if (empId == null) {
      s.requireActor(a, hrWrite);
      return s.attachContractResignDoc(cid, fp, fn, s.getContract(cid).employee_id);
    }
    return s.attachContractResignDoc(cid, fp, fn, empId);
  }));
  add('hr:getContractsForEmployee', wrapSync((eid, a) => {
    const empId = portalEmployeeId(eid, a);
    try { s.ensureContractExpiry?.(); } catch (_) {}
    try {
      return s.getContracts({ employee_id: empId });
    } catch (err) {
      if (/no such table|does not exist/i.test(String(err.message || ''))) return [];
      throw err;
    }
  }));
  add('hr:contractPdf', wrapSync((id, a) => {
    const emp = s.getEmployeeSession?.();
    if (emp?.employee_id != null) {
      const c = s.getContract(id);
      if (!c || Number(c.employee_id) !== Number(emp.employee_id)) throw new Error('Not authorised');
      return s.buildContractPdf(id, s.getSettingsParsed());
    }
    s.requireActor(a, hrRead);
    return s.buildContractPdf(id, s.getSettingsParsed());
  }));
  add('hr:getProbations', wrapSync((f, a) => { s.requireActor(a, hrRead); return s.getProbations(f || {}); }));
  add('hr:getProbation', wrapSync((id, a) => { s.requireActor(a, hrRead); return s.getProbation(id); }));
  add('hr:saveProbation', wrapSync((d, a) => { s.requireActor(a, hrWrite); return s.saveProbation(d, a.id, hrActor(a)); }));
  add('hr:deleteProbation', wrapSync((id, a) => { s.requireActor(a, ['owner', 'manager']); return s.deleteProbation(id, a.id, hrActor(a)); }));
  add('hr:getDecisionRules', wrapSync((a) => { s.requireActor(a, hrRead); return s.getDecisionRules(); }));
  add('hr:saveDecisionRule', wrapSync((d, a) => { s.requireActor(a, hrWrite); return s.saveDecisionRule(d, a.id, hrActor(a)); }));
  add('hr:saveDailyEvaluation', wrapSync((d, a) => { s.requireActor(a, hrRead); return s.saveDailyEvaluation(d, a.id, hrActor(a)); }));
  add('hr:getEvaluationHistory', wrapSync((f, a) => { s.requireActor(a, hrRead); return s.getEvaluationHistory(f || {}); }));
  add('hr:getRecommendation', wrapSync((pid, a) => { s.requireActor(a, hrRead); return s.getRecommendation(pid); }));
  add('hr:finalProbationDecision', wrapSync((pid, dec, reason, ext, a) => { s.requireActor(a, hrWrite); return s.finalProbationDecision(pid, dec, reason, a.id, hrActor(a), ext); }));
  add('hr:getProbationDashboard', wrapSync((f, a) => { s.requireActor(a, hrRead); return s.getProbationDashboard(f || {}); }));
  add('hr:probationPdf', wrapSync((id, a) => { s.requireActor(a, hrRead); return s.buildProbationPdf(id, s.getSettingsParsed()); }));
  add('hr:evaluationReportPdf', wrapSync((id, a) => { s.requireActor(a, hrRead); return s.buildEvaluationReportPdf(id, s.getSettingsParsed()); }));
  add('hr:probationLetterPdf', wrapSync((id, dec, a) => { s.requireActor(a, hrRead); return s.buildProbationLetterPdf(id, dec, s.getSettingsParsed()); }));
  add('hr:getPersonnelFile', wrapSync((eid, a) => { s.requireActor(a, hrRead); return s.getEmployeePersonnelFile(eid); }));

  add('hrTraining:getTemplates', wrapSync((type, a) => s.getHrContractTemplates(type, a)));
  add('hrTraining:saveTemplate', wrapSync((d, a) => s.saveHrContractTemplate(d, a)));
  add('hrTraining:deleteTemplate', wrapSync((id, a) => s.deleteHrContractTemplate(id, a)));
  add('hrTraining:getRecords', wrapSync((f, a) => s.getTrainingRecords(f, a)));
  add('hrTraining:saveRecord', wrapSync((d, a) => s.saveTrainingRecord(d, a)));
  add('hrTraining:deleteRecord', wrapSync((id, a) => s.deleteTrainingRecord(id, a)));
  add('hrTraining:saveEvaluation', wrapSync((rid, d, a) => s.saveTrainingEvaluation(rid, d, a)));
  add('hrTraining:evalPdf', wrapSync((id, a) => {
    const buf = s.buildTrainingEvalPdf(id, a);
    return Array.from(buf);
  }));
  add('hrTraining:getSubmissions', wrapSync((f, a) => s.getStaffSubmissions(f, a)));
  add('hrTraining:assignTemplate', wrapSync((d, a) => s.assignStaffTemplate(d, a)));
  add('hrTraining:submitForm', wrapSync((d, a) => s.submitStaffForm(d, a)));
  add('hrTraining:reviewSubmission', wrapSync((id, dec, notes, a) => s.reviewStaffSubmission(id, dec, notes, a)));
  add('hrTraining:updateSubmission', wrapSync((id, d, a) => s.updateStaffSubmission(id, d, a)));
  add('hrTraining:deleteSubmission', wrapSync((id, a) => s.deleteStaffSubmission(id, a)));
  add('hrTraining:attachDoc', wrapSync((sid, fp, a) => {
    const dest = s.copyStaffDocToAssets(fp, sid, 'upload');
    return s.saveStaffSubmissionDoc(sid, dest, a);
  }));

  add('jobs:getPostings', wrapSync((f, a) => s.getJobPostings(f, a)));
  add('jobs:savePosting', wrapSync((d, a) => s.saveJobPosting(d, a)));
  add('jobs:approvePosting', wrapSync((id, a) => s.approveJobPosting(id, a)));
  add('jobs:closePosting', wrapSync((id, a) => s.closeJobPosting(id, a)));
  add('jobs:deletePosting', wrapSync((id, a) => s.deleteJobPosting(id, a)));
  add('jobs:getCandidates', wrapSync((f, a) => s.getJobCandidates(f, a)));
  add('jobs:getCandidate', wrapSync((id, a) => s.getJobCandidate(id, a)));
  add('jobs:saveCandidate', wrapSync((d, a) => s.saveJobCandidate(d, a)));
  add('jobs:requestEmploy', wrapSync((id, a) => s.requestEmployCandidate(id, a)));
  add('jobs:decideCandidate', wrapSync((id, dec, notes, a) => s.decideJobCandidate(id, dec, notes, a)));
  add('jobs:attachCv', wrapSync((cid, fp, a) => s.attachJobCandidateCv(cid, fp, a)));
  add('jobs:attachPic', wrapSync((cid, fp, a) => s.attachJobCandidatePicture(cid, fp, a)));
  add('jobs:scheduleInterview', wrapSync((d, a) => s.scheduleInterview(d, a)));
  add('jobs:waCandidate', wrapSync((id, mt, a, body) => s.buildCandidateWhatsApp(id, mt, a, body)));
  add('jobs:waInterviewBulk', wrapSync((ids, a, body) => s.sendBulkInterviewWhatsApp(ids, a, body)));
  add('jobs:interviewDoc', wrapSync((id, a) => {
    const r = s.createInterviewDocument(id, a);
    return { path: r.path, buffer: Array.from(r.buffer), candidate: r.candidate };
  }));
  add('jobs:uploadInterviewResult', wrapSync((id, fp, a) => s.uploadInterviewResult(id, fp, a)));
  add('jobs:approveInterview', wrapSync((id, dec, notes, a) => s.approveInterviewOutcome(id, dec, notes, a)));
  add('jobs:getSettings', wrapSync((a) => {
    s.requireActor(a, ['owner', 'manager', 'supervisor', 'assistant_manager']);
    return s.getRecruitmentSettings();
  }));
  add('jobs:saveSettings', wrapSync((d, a) => s.saveRecruitmentSettings(d, a)));

  add('payroll:getSettings', wrapSync(() => s.getPayrollSettings()));
  add('payroll:saveSettings', wrapSync((d, a) => {
    const user = s.requireActor(a, ['owner', 'manager']);
    const r = s.savePayrollSettings(d, user.id, user.username);
    s.refreshPaymentDueNotifications();
    return r;
  }));
  add('payroll:getAdvances', wrapSync(f => s.getAdvances(f)));
  add('payroll:issueAdvance', wrapSync((d, a) => {
    s.requireActor(a, ['owner', 'manager']);
    return s.issueAdvance(d, a);
  }));
  add('payroll:getLoans', wrapSync(f => s.getLoans(f)));
  add('payroll:saveLoan', wrapSync((d, a) => {
    s.requireActor(a, ['owner', 'manager']);
    return s.saveLoan(d);
  }));
  add('payroll:settleLoan', wrapSync((id, a) => {
    s.requireActor(a, ['owner', 'manager']);
    return s.settleLoanEarly(id);
  }));
  add('payroll:getDamageCosts', wrapSync(f => s.getDamageCosts(f)));
  add('payroll:saveDamageCost', wrapSync((d, a) => {
    s.requireActor(a, ['owner', 'manager']);
    return s.saveDamageCost(d, a);
  }));
  add('payroll:approveDamageCost', wrapSync((id, a) => {
    s.requireActor(a, ['owner', 'manager']);
    return s.approveDamageCost(id, a);
  }));
  add('payroll:getComplianceSubmissions', wrapSync(t => s.getComplianceSubmissions(t)));
  add('payroll:saveComplianceSubmission', wrapSync((d, a) => {
    s.requireActor(a, ['owner', 'manager']);
    return s.saveComplianceSubmission(d, a);
  }));
  add('payroll:getComplianceCertificates', wrapSync(() => s.getComplianceCertificates()));
  add('payroll:saveComplianceCertificate', wrapSync((d, a) => {
    s.requireActor(a, ['owner', 'manager']);
    return s.saveComplianceCertificate(d);
  }));
  add('payroll:deleteComplianceCertificate', wrapSync((id, a) => {
    s.requireActor(a, ['owner', 'manager']);
    s.deleteComplianceCertificate(id);
    return true;
  }));
  add('payroll:getComplianceReminders', wrapSync(() => s.getComplianceReminders()));
  add('payroll:getReport', wrapSync((f, t) => s.getPayrollReport(f, t)));
  add('payroll:getStatutoryReport', wrapSync((type, f, t) => s.getStatutoryReport(type, f, t)));
  add('payroll:compliancePdf', wrapSync((type, f, t) => {
    const st = s.getSettingsParsed();
    return s.buildComplianceReportPdf(type, f, t, st?.shop_name, st?.currency || 'R');
  }));

  add('ownerSalary:sync', wrapSync(() => {
    const r = s.syncOwnerSalaryPeriods();
    s.refreshPaymentDueNotifications();
    return r;
  }));
  add('ownerSalary:getProfile', wrapSync(() => s.getOwnerProfile()));
  add('ownerSalary:saveProfile', wrapSync((d, a) => {
    s.requireActor(a, ['owner', 'manager']);
    const r = s.saveOwnerProfile(d);
    s.refreshPaymentDueNotifications();
    return r;
  }));
  add('ownerSalary:deleteProfile', wrapSync(a => {
    s.requireActor(a, ['owner', 'manager']);
    const r = s.deleteOwnerProfile(a.id, a.username || a.full_name || 'owner');
    s.refreshPaymentDueNotifications();
    return r;
  }));
  add('ownerSalary:getPeriods', wrapSync((pid, f) => s.getOwnerSalaryPeriods(pid, f)));
  add('ownerSalary:getPayments', wrapSync(pid => s.getOwnerSalaryPayments(pid)));
  add('ownerSalary:pay', wrapSync((d, a) => {
    s.requireActor(a, ['owner', 'manager']);
    const r = s.payOwnerSalary(d, a);
    const to = new Date().toLocaleDateString('en-CA');
    const from = new Date(Date.now() - 90 * 86400000).toLocaleDateString('en-CA');
    s.syncLedger(from, to);
    s.refreshPaymentDueNotifications();
    return r;
  }));
  add('ownerSalary:getNotifications', wrapSync(() => {
    const p = s.getOwnerProfile();
    return s.getOwnerSalaryNotifications(p);
  }));
  add('ownerSalary:getReport', wrapSync((type, f, t) => s.getOwnerSalaryReport(type, f, t)));
  add('ownerSalary:payslipPdf', wrapSync(id => {
    const st = s.getSettingsParsed();
    return s.buildOwnerPayslipPdf(id, st?.shop_name, st?.currency || 'R');
  }));
  add('ownerSalary:reportPdf', wrapSync((type, f, t) => {
    const st = s.getSettingsParsed();
    return s.buildOwnerSalaryReportPdf(type, f, t, st?.shop_name, st?.currency || 'R');
  }));
  add('ownerSalary:getDraws', wrapSync(f => {
    const p = s.getOwnerProfile();
    return p ? s.getOwnerDraws(p.id, f || {}) : [];
  }));
  add('ownerSalary:addDraw', wrapSync((d, a) => {
    s.requireActor(a, ['owner', 'manager']);
    return s.addOwnerDraw(d, a);
  }));
  add('ownerSalary:deleteDraw', wrapSync((id, a) => {
    s.requireActor(a, ['owner', 'manager']);
    return s.deleteOwnerDraw(id, a);
  }));

  add('bookkeeping:getSettings', wrapSync(() => {
    s.requireBookkeepingAccess(s.getUserSession?.());
    return s.getBookkeepingSettings();
  }));
  add('bookkeeping:saveSettings', wrapSync((d, a) => {
    s.requireActor(a, ['owner', 'manager']);
    return s.saveBookkeepingSettings(d, a);
  }));
  add('bookkeeping:sync', wrapSync((f, t) => {
    s.requireBookkeepingAccess(s.getUserSession?.());
    s.syncLedger(f, t);
    return true;
  }));
  add('bookkeeping:dashboard', wrapSync((f, t) => {
    s.requireBookkeepingAccess(s.getUserSession?.());
    return s.getFinancialDashboard(f, t);
  }));
  add('bookkeeping:search', wrapSync(f => {
    s.requireBookkeepingAccess(s.getUserSession?.());
    return s.searchLedger(f);
  }));
  add('bookkeeping:getIncome', wrapSync(f => {
    s.requireBookkeepingAccess(s.getUserSession?.());
    return s.getIncomeEntries(f);
  }));
  add('bookkeeping:saveIncome', wrapSync((d, a) => {
    s.requireActor(a, ['owner', 'manager']);
    return s.saveIncomeEntry(d, a);
  }));
  add('bookkeeping:deleteIncome', wrapSync((id, a) => {
    s.requireActor(a, ['owner', 'manager']);
    s.deleteIncomeEntry(id, a);
    return true;
  }));
  add('bookkeeping:getBank', wrapSync(f => {
    s.requireBookkeepingAccess(s.getUserSession?.());
    return s.getBankTransactions(f);
  }));
  add('bookkeeping:saveBank', wrapSync((d, a) => {
    s.requireActor(a, ['owner', 'manager']);
    return s.saveBankTransaction(d, a);
  }));
  add('bookkeeping:cashBook', wrapSync((f, t) => {
    s.requireBookkeepingAccess(s.getUserSession?.());
    return s.getCashBook(f, t);
  }));
  add('bookkeeping:bankBook', wrapSync((f, t) => {
    s.requireBookkeepingAccess(s.getUserSession?.());
    return s.getBankBook(f, t);
  }));
  add('bookkeeping:payrollAccounting', wrapSync((f, t) => {
    s.requireBookkeepingAccess(s.getUserSession?.());
    return s.getPayrollAccounting(f, t);
  }));
  add('bookkeeping:taxSummary', wrapSync((f, t) => {
    s.requireBookkeepingAccess(s.getUserSession?.());
    return s.getTaxSummary(f, t);
  }));
  add('bookkeeping:report', wrapSync((type, f, t) => {
    s.requireBookkeepingAccess(s.getUserSession?.());
    return s.getFinancialReport(type, f, t);
  }));
  add('bookkeeping:performance', wrapSync((f, t) => {
    s.requireBookkeepingAccess(s.getUserSession?.());
    return s.getBusinessPerformance(f, t);
  }));
  add('bookkeeping:getBudgets', wrapSync(m => {
    s.requireBookkeepingAccess(s.getUserSession?.());
    return s.getBudgets(m);
  }));
  add('bookkeeping:saveBudget', wrapSync((d, a) => {
    s.requireActor(a, ['owner', 'manager']);
    return s.saveBudget(d, a);
  }));
  add('bookkeeping:deleteBudget', wrapSync((id, a) => {
    s.requireActor(a, ['owner', 'manager']);
    s.deleteBudget(id, a);
    return true;
  }));
  add('bookkeeping:budgetVsActual', wrapSync(m => {
    s.requireBookkeepingAccess(s.getUserSession?.());
    return s.getBudgetVsActual(m);
  }));
  add('bookkeeping:getDocuments', wrapSync(f => {
    s.requireBookkeepingAccess(s.getUserSession?.());
    return s.getFinancialDocuments(f);
  }));
  add('bookkeeping:saveDocument', wrapSync((d, a) => {
    s.requireActor(a, ['owner', 'manager']);
    return s.saveFinancialDocument(d, a);
  }));
  add('bookkeeping:deleteDocument', wrapSync((id, a) => {
    s.requireActor(a, ['owner', 'manager']);
    s.deleteFinancialDocument(id, a);
    return true;
  }));
  add('bookkeeping:auditTrail', wrapSync(f => {
    s.requireBookkeepingAccess(s.getUserSession?.());
    return s.getFinancialAuditTrail(f);
  }));
  add('bookkeeping:notifications', wrapSync(() => {
    s.requireBookkeepingAccess(s.getUserSession?.());
    return s.getFinancialNotifications();
  }));
  add('bookkeeping:categories', wrapSync(() => {
    s.requireBookkeepingAccess(s.getUserSession?.());
    return { expense: s.EXPENSE_CATEGORIES, income: s.INCOME_TYPES };
  }));
  add('bookkeeping:reportPdf', wrapSync((type, f, t) => {
    s.requireBookkeepingAccess(s.getUserSession?.());
    const st = s.getSettingsParsed();
    return s.buildFinancialReportPdf(type, f, t, st?.shop_name, st?.currency || 'R');
  }));

  add('donations:get', wrapSync(f => { requireSession(); return s.getDonations(f); }));
  add('donations:getOne', wrapSync(id => s.getDonation(id)));
  add('donations:save', wrapSync((d, a) => {
    s.requireActor(a, ['owner', 'manager']);
    return s.saveDonation(d, a);
  }));
  add('donations:delete', wrapSync((id, a) => {
    s.requireActor(a, ['owner', 'manager']);
    s.deleteDonation(id, a);
    return true;
  }));
  add('donations:uploadDoc', wrapSync((did, doc, a) => {
    s.requireActor(a, ['owner', 'manager']);
    return s.uploadDocument(did, doc, a);
  }));
  add('donations:getDoc', wrapSync(id => s.getDonationDocument(id)));
  add('donations:submit', wrapSync((id, a) => {
    s.requireActor(a, ['owner', 'manager']);
    return s.submitForApproval(id, a);
  }));
  add('donations:approve', wrapSync((id, d, a) => {
    s.requireActor(a, ['owner', 'manager']);
    return s.approveDonation(id, d, a);
  }));
  add('donations:dashboard', wrapSync(f => s.getDonationsDashboardStats(f)));
  add('donations:report', wrapSync(f => s.getDonationReport(f)));
  add('donations:reportPdf', wrapSync(f => {
    const st = s.getSettingsParsed();
    return s.buildDonationReportPdf(f, st?.shop_name, st?.currency || 'R');
  }));
  add('donations:reportExcel', wrapSync(f => s.buildDonationReportExcel(f)));
  add('donations:types', wrapSync(() => ({ types: s.DONATION_TYPES, payments: s.PAYMENT_METHODS, statuses: s.STATUSES })));

  add('ops:getRules', wrapSync(f => s.getRules(f)));
  add('ops:getRule', wrapSync(id => s.getRule(id)));
  add('ops:saveRule', wrapSync((d, a) => s.saveRule(d, a)));
  add('ops:archiveRule', wrapSync((id, a) => s.archiveRule(id, a)));
  add('ops:rulePdf', wrapSync(id => s.buildRulePdf(id, s.getSettingsParsed()?.shop_name)));
  add('ops:allRulesPdf', wrapSync(() => s.buildAllRulesPdf(s.getSettingsParsed()?.shop_name)));
  add('ops:openingTemplates', wrapSync(() => s.getOpeningTemplates()));
  add('ops:closingTemplates', wrapSync(() => s.getClosingTemplates()));
  add('ops:saveOpeningTemplate', wrapSync((d, a) => s.saveOpeningTemplate(d, a)));
  add('ops:saveClosingTemplate', wrapSync((d, a) => s.saveClosingTemplate(d, a)));
  add('ops:deleteOpeningTemplate', wrapSync((id, a) => { s.deleteOpeningTemplate(id, a); return true; }));
  add('ops:deleteClosingTemplate', wrapSync((id, a) => { s.deleteClosingTemplate(id, a); return true; }));
  add('ops:getChecklistRuns', wrapSync(f => s.getChecklistRuns(f)));
  add('ops:getChecklistRun', wrapSync(id => s.getChecklistRun(id)));
  add('ops:startChecklist', wrapSync((d, a) => s.startChecklistRun(d, a)));
  add('ops:completeChecklistItem', wrapSync((itemId, d, a) => s.completeChecklistItem(itemId, d, a)));
  add('ops:finishChecklist', wrapSync((runId, a) => s.finishChecklistRun(runId, a)));
  add('ops:submitChecklist', wrapSync((runId, a) => s.submitChecklistRun(runId, a)));
  add('ops:confirmChecklist', wrapSync((runId, d, a) => s.confirmChecklistRun(runId, d, a)));
  add('ops:reopenChecklist', wrapSync((runId, a) => s.reopenChecklistRun(runId, a)));
  add('ops:adminUpdateChecklist', wrapSync((runId, d, a) => s.adminUpdateChecklistRun(runId, d, a)));
  add('ops:deleteChecklist', wrapSync((runId, a) => { s.deleteChecklistRun(runId, a); return true; }));
  add('ops:pendingChecklists', wrapSync(() => s.getPendingChecklistSubmissions()));
  add('ops:getAdminSignature', wrapSync(() => s.getAdminSignature()));
  add('ops:saveAdminSignature', wrapSync((p, a) => s.saveAdminSignature(p, a)));
  add('ops:getChecklistSettings', wrapSync(() => s.getChecklistSettings()));
  add('ops:saveChecklistSettings', wrapSync((d, a) => s.saveChecklistSettings(d, a)));
  add('ops:checklistWarnings', wrapSync(f => s.getChecklistWarnings(f)));
  add('ops:staffChecklistWarnings', wrapSync((uid, eid) => s.getStaffPortalChecklistWarnings(uid, eid)));
  add('ops:ackChecklistWarning', wrapSync((id, a) => s.acknowledgeChecklistWarning(id, a)));
  add('ops:checklistPdf', wrapSync(runId => s.buildChecklistReportPdf(runId, s.getSettingsParsed()?.shop_name)));
  add('ops:nonSellingProducts', wrapSync(f => s.getNonSellingProducts(f)));
  add('ops:nonSellingExcel', wrapSync(f => s.exportNonSellingExcel(f)));
  add('ops:nonSellingPdf', wrapSync(f => {
    const settings = s.getSettingsParsed();
    return s.exportNonSellingPdf(f, settings.shop_name, settings.currency);
  }));
  add('ops:markProductPromo', wrapSync((pid, d, a) => s.markProductPromo(pid, d, a)));
  add('ops:dashboard', wrapSync(() => s.getComplianceDashboard()));
  add('ops:proposePromo', wrapSync((pid, d, a) => s.proposeProductPromo(pid, d, a)));
  add('ops:pendingPromos', wrapSync(() => s.getPendingPromoRequests()));
  add('ops:promoHistory', wrapSync(f => s.getPromoRequestHistory(f)));
  add('ops:approvePromo', wrapSync((id, a) => s.approvePromoRequest(id, a)));
  add('ops:rejectPromo', wrapSync((id, notes, a) => s.rejectPromoRequest(id, notes, a)));
  add('ops:cancelPromo', wrapSync((id, a) => s.cancelPromoRequest(id, a)));
  add('ops:deletePromo', wrapSync((id, a) => s.deletePromoRequest(id, a)));
  add('ops:promoSalesLog', wrapSync(f => s.getPromoSalesLog(f)));
  add('ops:syncPromoStatuses', wrapSync(() => { s.syncPromoStatuses(); return true; }));

  add('combos:get', wrapSync(f => s.getCombos(f)));
  add('combos:getActive', wrapSync(f => s.getCombos({ ...f, active_only: true })));
  add('combos:getOne', wrapSync(id => s.getCombo(id)));
  add('combos:save', wrapSync((d, a) => s.saveCombo(d, a)));
  add('combos:setStatus', wrapSync((id, st, a) => s.setComboStatus(id, st, a)));
  add('combos:approve', wrapSync((id, a) => s.approveCombo(id, a)));
  add('combos:reject', wrapSync((id, notes, a) => s.rejectCombo(id, notes, a)));
  add('combos:delete', wrapSync((id, a) => { s.deleteCombo(id, a); return true; }));
  add('combos:calcPrices', wrapSync((items, pt, dv) => s.calcComboPrices(items, pt, dv)));
  add('combos:report', wrapSync(f => s.getComboReports(f)));
  add('combos:reportPdf', wrapSync(f => {
    const st = s.getSettingsParsed();
    return s.buildComboReportPdf(f, st?.shop_name, st?.currency || 'R');
  }));
  add('combos:reportExcel', wrapSync(f => s.buildComboReportExcel(f)));

  add('recipe:login', wrapSync((u, p, pin) => s.loginToRecipeModule(u, p, pin)));
  add('recipe:sessionFromPos', wrapSync(a => s.sessionFromPosUser(a)));
  add('recipe:createRestockPo', wrapSync((d, a) => s.createRestockPurchaseOrder(d || {}, a)));
  add('recipe:prepBoard', wrapSync(a => s.getPrepBoard(a)));
  add('recipe:foodCostAlerts', wrapSync((a, opts) => s.getFoodCostAlerts(a, opts || {})));
  add('recipe:posSubs', wrapSync((ingredientId, a) => s.listPosSubstitutionsForIngredient(ingredientId, a)));
  add('recipe:exportBundle', wrapSync(a => s.exportRecipeBundle(a)));
  add('recipe:importBundle', wrapSync((bundle, a) => s.importRecipeBundle(bundle || {}, a)));
  add('recipe:accessList', wrapSync(a => { s.assertCanManageRecipeAccess(a); return s.getRecipeAccessList(); }));
  add('recipe:listUsers', wrapSync(a => s.listUsersForRecipeAccess(a)));
  add('recipe:setAccess', wrapSync((d, a) => s.setRecipeUserAccess(d, a)));
  add('recipe:removeAccess', wrapSync((id, a) => { s.removeRecipeUserAccess(id, a); return true; }));
  add('recipe:ingredients', wrapSync((f, a) => s.listIngredients(f || {}, a)));
  add('recipe:ingredient', wrapSync((id, a) => s.getIngredient(id, a)));
  add('recipe:list', wrapSync((f, a) => s.listRecipes(f || {}, a)));
  add('recipe:get', wrapSync((id, a) => { s.canAccessRecipeModule(a); return s.getRecipeWithItems(id); }));
  add('recipe:save', wrapSync((d, a) => s.saveRecipe(d, a)));
  add('recipe:submit', wrapSync((id, a) => s.submitRecipeForApproval(id, a)));
  add('recipe:approve', wrapSync((id, a) => s.approveRecipe(id, a)));
  add('recipe:reject', wrapSync((id, n, a) => s.rejectRecipe(id, n, a)));
  add('recipe:archive', wrapSync((id, a) => s.archiveRecipe(id, a)));
  add('recipe:delete', wrapSync((id, a) => { s.deleteRecipe(id, a); return true; }));
  add('recipe:createProduct', wrapSync((id, d, a) => s.createProductFromRecipe(id, d || {}, a)));
  add('recipe:calcCosting', wrapSync((items, opts, a) => { s.canAccessRecipeModule(a); return s.computeRecipeCosting(items || [], opts || {}); }));
  add('recipe:capacity', wrapSync((id, a) => s.calcProductionCapacity(id, a)));
  add('recipe:planProduction', wrapSync((d, a) => s.planProduction(d, a)));
  add('recipe:completeProduction', wrapSync((d, a) => s.completeProduction(d, a)));
  add('recipe:batches', wrapSync((f, a) => s.listProductionBatches(f || {}, a)));
  add('recipe:restock', wrapSync((id, qty, a) => s.smartRestock(id, qty, a)));
  add('recipe:wasteList', wrapSync((f, a) => s.listRecipeWaste(f || {}, a)));
  add('recipe:wasteRecord', wrapSync((d, a) => s.recordRecipeWaste(d, a)));
  add('recipe:wasteApprove', wrapSync((id, a) => s.approveRecipeWaste(id, a)));
  add('recipe:wasteReject', wrapSync((id, a) => { s.rejectRecipeWaste(id, a); return true; }));
  add('recipe:wasteUpdate', wrapSync((id, d, a) => s.updateRecipeWaste(id, d || {}, a)));
  add('recipe:wasteDelete', wrapSync((id, a) => { s.deleteRecipeWaste(id, a); return true; }));
  add('recipe:productionMeals', wrapSync((a) => s.listProductionMeals(a)));
  add('recipe:ingredientStockHistory', wrapSync((f, a) => s.getIngredientStockHistory(f || {}, a)));
  add('recipe:profitsLosses', wrapSync((f, a) => s.getProfitsLosses(f || {}, a)));
  add('recipe:listPurchaseOrders', wrapSync((f, a) => s.listRecipePurchaseOrders(f || {}, a)));
  add('recipe:ensureMealProfile', wrapSync((pid, a) => s.ensureApprovedProfileForMeal(pid, a, { autoApprove: true })));
  add('recipe:promos', wrapSync(a => s.listRecipePromotions(a)));
  add('recipe:promoSave', wrapSync((d, a) => s.saveRecipePromotion(d, a)));
  add('recipe:dashboard', wrapSync(a => s.getRecipeDashboard(a)));
  add('recipe:reports', wrapSync((type, f, a) => s.getRecipeReports(type, f || {}, a)));
  add('recipe:ai', wrapSync(a => s.getAiSuggestions(a)));
  add('recipe:applySuggestedPrice', wrapSync((d, a) => s.applySuggestedSellPrice(d || {}, a)));
  add('recipe:activity', wrapSync((limit, a) => s.getRecipeActivity(limit || 50, a)));
  add('recipe:bestSellers', wrapSync((period, a) => s.getBestSellers(period || 'month', a)));
  add('recipe:setAvailableToday', wrapSync((ids, a) => { s.setAvailableToday(ids || [], a); return true; }));
  add('recipe:requestSub', wrapSync((d, a) => s.requestSubstitution(d || {}, a)));
  add('recipe:listSubs', wrapSync((f, a) => s.listSubstitutions(f || {}, a)));
  add('recipe:approveSub', wrapSync((id, a) => s.approveSubstitution(id, a)));
  add('recipe:rejectSub', wrapSync((id, a) => { s.rejectSubstitution(id, a); return true; }));
  add('recipe:forecast', wrapSync((days, a) => s.getStockForecast(a, days || 14)));
  add('recipe:mealProducts', wrapSync((f, a) => s.listMealProducts(f || {}, a)));
  add('recipe:getMeal', wrapSync((id, a) => s.getProductMealRecipe(id, a)));
  add('recipe:saveMeal', wrapSync((d, a) => s.saveProductMealRecipe(d || {}, a)));
  add('recipe:restockIngredient', wrapSync((d, a) => s.restockIngredient(d || {}, a)));
  add('recipe:ensureIngredient', wrapSync((d, a) => s.ensureIngredient(d || {}, a)));
  add('recipe:updateIngredient', wrapSync((d, a) => s.updateIngredient(d || {}, a)));
  add('recipe:deleteIngredient', wrapSync((id, a) => { s.deleteIngredient(id, a); return true; }));
  add('recipe:restockPlan', wrapSync((t, a) => s.calculateRestockPlan(t, a)));
  add('recipe:setPosMenuFlags', wrapSync((d, a) => { s.setPosMenuFlags(d || {}, a); return true; }));
  add('recipe:restockList', wrapSync(a => s.listRestockIngredients(a)));
  add('recipe:productionAvailability', wrapSync((productId, a) => s.getProductionAvailability(productId, a)));
  add('recipe:productionDashboard', wrapSync(a => s.getLiveProductionDashboard(a)));
  add('recipe:refreshProduction', wrapSync(a => s.refreshProductionAvailability(a)));
  add('recipe:productRestock', wrapSync((productId, targetQty, a) => s.getProductRestockRecommendation(productId, targetQty, a)));

  add('flyers:get', wrapSync(f => s.getFlyers(f)));
  add('flyers:getOne', wrapSync(id => s.getFlyer(id)));
  add('flyers:save', wrapSync((d, a) => s.saveFlyer(d, a)));
  add('flyers:delete', wrapSync((id, a) => { s.deleteFlyer(id, a); return true; }));
  add('flyers:duplicate', wrapSync((id, a) => s.duplicateFlyer(id, a)));
  add('flyers:templates', wrapSync(() => s.getFlyerTemplates()));
  add('flyers:saveTemplate', wrapSync((d, a) => s.saveFlyerTemplate(d, a)));
  add('flyers:pdf', wrapSync((id, sizeOverride) => {
    const st = s.getSettingsParsed();
    return s.buildFlyerPdf(id, st, sizeOverride || null);
  }));
  add('flyers:applyPosPrices', wrapSync((id, a) => s.applyFlyerPricesToPos(id, a)));
  add('flyers:restorePrices', wrapSync((id, a) => s.restoreFlyerPrices(id, a)));
  add('flyers:submitApproval', wrapSync((id, a) => s.submitFlyerForApproval(id, a)));
  add('flyers:approve', wrapSync((id, a) => s.approveFlyer(id, a)));
  add('flyers:reject', wrapSync((id, a, notes) => s.rejectFlyer(id, a, notes)));
  add('flyers:analytics', wrapSync(id => s.getFlyerAnalytics(id)));
  add('flyers:smartSuggestions', wrapSync((f, a) => s.getSmartPromotionSuggestions(f, a)));
  add('flyers:bulkPrices', wrapSync((id, u, a) => s.bulkUpdateFlyerPrices(id, u, a)));
  add('flyers:recordEvent', wrapSync((id, eventType) => s.recordFlyerEvent(id, eventType)));
  add('flyers:brandKit', wrapSync(() => s.getBrandKit()));
  add('flyers:saveBrandKit', wrapSync((d, a) => s.saveBrandKit(d, a)));
  add('flyers:goLive', wrapSync((id, a) => s.goLiveFlyer(id, a)));
  add('flyers:endCampaign', wrapSync((id, a) => s.endCampaign(id, a)));
  add('flyers:activeCampaigns', wrapSync(branchId => s.getActiveCampaigns(branchId)));
  add('flyers:dashboard', wrapSync(() => s.getCampaignDashboard()));
  add('flyers:share', wrapSync((id, opts, a) => s.shareFlyerCampaign(id, opts, a)));

  const mktA = (a) => a || s.getUserSession();
  add('mkt:agents', wrapSync((f) => s.listAgents(f || {})));
  add('mkt:saveAgent', wrapSync((userId, data, a) => s.ensureAgentForUser(userId, data || {}, mktA(a))));
  add('mkt:setAgentStatus', wrapSync((id, status, a) => s.setAgentStatus(id, status, mktA(a))));
  add('mkt:issueToken', wrapSync((id, hours, deviceId, a) => s.issueAccessToken(id, hours, mktA(a), deviceId)));
  add('mkt:revokeToken', wrapSync((tokenId, a) => s.revokeAccessToken(tokenId, mktA(a))));
  add('mkt:listTokens', wrapSync((agentId, a) => s.listAccessTokens(agentId, mktA(a))));
  add('mkt:loginToken', wrapSync((token, deviceId) => s.loginWithAccessToken(token, deviceId)));
  add('mkt:dashboard', wrapSync((a) => s.agentDashboard(mktA(a))));
  add('mkt:adminSummary', wrapSync((f, a) => s.adminMarketingSummary(f || {}, mktA(a))));
  add('mkt:scorecard', wrapSync((agentId, a) => s.performanceScorecard(agentId, mktA(a))));
  add('mkt:tasks', wrapSync((f) => s.listTasks(f || {})));
  add('mkt:saveTask', wrapSync((data, a) => s.saveTask(data || {}, mktA(a))));
  add('mkt:customers', wrapSync((f, a) => s.listMarketingCustomers(f || {}, mktA(a))));
  add('mkt:saveCustomer', wrapSync((data, a) => s.saveMarketingCustomer(data || {}, mktA(a))));
  add('mkt:convertCustomer', wrapSync((id, total, a) => s.markCustomerConverted(id, total, mktA(a))));
  add('mkt:recruitmentStats', wrapSync((f, a) => s.recruitmentStats(mktA(a), f || {})));
  add('mkt:campaigns', wrapSync((f, a) => s.listCampaigns(f || {}, mktA(a))));
  add('mkt:saveCampaign', wrapSync((data, a) => s.saveCampaign(data || {}, mktA(a))));
  add('mkt:submitCampaign', wrapSync((id, a) => s.submitCampaign(id, mktA(a))));
  add('mkt:approveCampaign', wrapSync((id, approve, notes, a) => s.approveCampaign(id, approve !== false, notes, mktA(a))));
  add('mkt:menus', wrapSync((f, a) => s.listMenus(f || {}, mktA(a))));
  add('mkt:getMenu', wrapSync((id, a) => s.getMenu(id, mktA(a))));
  add('mkt:saveMenu', wrapSync((data, a) => s.saveMenu(data || {}, mktA(a))));
  add('mkt:submitMenu', wrapSync((id, a) => s.submitMenu(id, mktA(a))));
  add('mkt:reviewMenu', wrapSync((id, approve, notes, a) => s.reviewMenu(id, approve !== false, notes, mktA(a))));
  add('mkt:updateMenuPrices', wrapSync((id, a) => s.updateMenuPricesFromPos(id, mktA(a))));
  add('mkt:msgTemplates', wrapSync(() => s.listMessageTemplates()));
  add('mkt:messages', wrapSync((f, a) => s.listMessages(f || {}, mktA(a))));
  add('mkt:saveMessage', wrapAsync((data, a) => s.saveMessage(data || {}, mktA(a))));
  add('mkt:saveReport', wrapSync((data, a) => s.saveProgressReport(data || {}, mktA(a))));
  add('mkt:reports', wrapSync((f, a) => s.listProgressReports(f || {}, mktA(a))));
  add('mkt:respondReport', wrapSync((id, response, a) => s.respondProgressReport(id, response, mktA(a))));
  add('mkt:saveFeedback', wrapSync((data, a) => s.saveFeedback(data || {}, mktA(a))));
  add('mkt:feedback', wrapSync((f, a) => s.listFeedback(f || {}, mktA(a))));
  add('mkt:media', wrapSync((a) => s.listMedia(mktA(a))));
  add('mkt:saveMedia', wrapSync((data, a) => s.saveMedia(data || {}, mktA(a))));
  add('mkt:setMediaStatus', wrapSync((id, status, a) => s.setMediaStatus(id, status, mktA(a))));
  add('mkt:notifications', wrapSync((a) => s.listNotifications(mktA(a))));
  add('mkt:readNotification', wrapSync((id, a) => s.markNotificationRead(id, mktA(a))));
  add('mkt:syncStatus', wrapSync(() => s.getSyncStatus()));
  add('mkt:processSync', wrapSync((a) => s.processSyncQueue(mktA(a))));
  add('mkt:syncConflicts', wrapSync((a) => s.listSyncConflicts(mktA(a))));
  add('mkt:resolveConflict', wrapSync((id, keep, a) => s.resolveSyncConflict(id, keep, mktA(a))));
  add('mkt:audit', wrapSync((f, a) => s.listAudit(f || {}, mktA(a))));
  add('mkt:products', wrapSync((f, a) => s.searchProductsForMarketing(f || {}, mktA(a))));
  add('mkt:brandKit', wrapSync((a) => s.getBrandKitForAgent(mktA(a))));
  add('mkt:productCards', wrapSync((ids) => s.buildProductCards(ids || [])));
  add('mkt:digitalMenu', wrapSync((slug, a) => s.getDigitalMenu(slug, mktA(a))));
  add('mkt:menuPrintHtml', wrapSync((id, a) => s.buildMenuPrintHtml(id, mktA(a))));
  add('mkt:menuTemplates', wrapSync((a) => s.listMenuTemplates(mktA(a))));
  add('mkt:saveMenuTemplate', wrapSync((data, a) => s.saveMenuTemplate(data || {}, mktA(a))));

  add('whatsapp:getTemplates', wrapSync(f => s.getWhatsAppTemplates(f)));
  add('whatsapp:getTemplate', wrapSync(id => s.getTemplate(id)));
  add('whatsapp:saveTemplate', wrapSync((d, a) => s.saveTemplate(d, a)));
  add('whatsapp:deleteTemplate', wrapSync((id, a) => { s.deleteTemplate(id, a); return true; }));
  add('whatsapp:getMessages', wrapSync(f => s.getMessages(f)));
  add('whatsapp:send', wrapAsync((d, a) => s.sendMessage(d, a)));
  add('whatsapp:markOpened', wrapSync((id, a) => s.markMessageOpened(id, a)));
  add('whatsapp:getAudience', wrapSync(f => s.getAudience(f)));
  add('whatsapp:getCampaigns', wrapSync(f => s.getCampaigns(f)));
  add('whatsapp:getCampaign', wrapSync(id => s.getCampaign(id)));
  add('whatsapp:saveCampaign', wrapSync((d, a) => s.saveCampaign(d, a)));
  add('whatsapp:deleteCampaign', wrapSync((id, a) => { s.deleteCampaign(id, a); return true; }));
  add('whatsapp:sendCampaign', wrapAsync((id, a) => s.sendCampaign(id, a)));
  add('whatsapp:getSettings', wrapSync(() => s.getWhatsAppSettings()));
  add('whatsapp:saveSettings', wrapSync((d, a) => s.saveWhatsAppSettings(d, a)));

  add('documentHub:get', wrapSync(f => s.getHubDocuments(f)));
  add('documentHub:getOne', wrapSync(id => s.getHubDocument(id)));
  add('documentHub:save', wrapSync((d, a) => s.saveHubDocument(d, a)));
  add('documentHub:delete', wrapSync((id, a) => { s.deleteHubDocument(id, a); return true; }));
  add('documentHub:share', wrapSync((id, opts, a) => s.shareDocument(id, opts, a)));
  add('documentHub:exportStatus', wrapSync((id, a) => s.exportDocumentStatus(id, a)));
  add('documentHub:processScheduled', wrapSync(() => s.processScheduledDocuments()));
  add('documentHub:syncFlyer', wrapSync((flyerId, opts) => s.syncFlyerToHub(flyerId, opts || {})));

  add('rewards:getRules', wrapSync(() => s.getRewardRules()));
  add('rewards:saveRule', wrapSync((data, a) => s.saveRewardRule(data, a)));
  add('rewards:deleteRule', wrapSync((id, a) => s.deleteRewardRule(id, a)));

  add('branches:get', wrapSync(() => s.getBranches()));
  add('branches:getActive', wrapSync(() => s.getActiveBranch()));
  add('branches:save', wrapSync((data, a) => {
    s.requireActor(a || s.getUserSession?.(), ['owner', 'manager']);
    return s.saveBranch(data);
  }));
  add('branches:setActive', wrapSync((id, a) => {
    s.requireActor(a || s.getUserSession?.(), ['owner', 'manager']);
    return s.setActiveBranch(id);
  }));
  add('sync:getStatus', wrapSync(() => s.getSyncStatus()));
  add('sync:saveSettings', wrapSync((data, actor) => {
    s.requireActor(actor, ['owner', 'manager']);
    s.saveSyncSettings(data);
    return s.getSyncSettings();
  }));
  add('sync:register', wrapAsync(async (role, name) => {
    requireUserSession(['owner', 'manager']);
    return s.registerSyncDevice(role, name);
  }));
  add('sync:now', wrapAsync(async () => {
    requireUserSession(['owner', 'manager']);
    return s.syncNow();
  }));
  add('sync:publishProducts', async () => s.publishProductsToHub());
  add('sync:branchesToHub', async () => s.syncBranchesToHub());
  add('sync:getOnlineOrders', wrapSync(st => s.getOnlineOrdersLocal(st)));
  add('sync:updateOnlineOrder', wrapAsync(async (id, st) => {
    requireUserSession(['owner', 'manager', 'supervisor', 'cashier']);
    return s.updateOnlineOrderStatus(id, st);
  }));
  add('sync:acceptOnlineOrder', wrapAsync(async (id, opts) => {
    const user = requireUserSession(['owner', 'manager', 'supervisor', 'cashier']);
    return s.acceptOnlineOrderAsSale(id, user, opts || {});
  }));

  add('audit:salesList', wrapSync(f => { requireSession(); return s.getSalesList(f); }));
  add('audit:searchSales', wrapSync(f => s.searchSalesExplorer(f)));
  add('audit:voidSale', wrapSync((id, r, a, code) => {
    const user = s.requireActor(a, ['owner', 'manager', 'cashier', 'supervisor', 'assistant_manager']);
    if (user.role === 'cashier') s.verifySupervisorCode(code, 'void');
    return s.voidSale(id, r, user.id, user.full_name);
  }));
  add('audit:soldProducts', wrapSync((f, t) => s.getSoldProductsReport(f, t)));
  add('audit:lowPerformance', wrapSync(d => s.getLowPerformanceProducts(d)));
  add('audit:returnDetail', wrapSync(id => s.getReturnDetail(id)));
  add('audit:returnsList', wrapSync(f => s.getReturnsList(f)));
  add('audit:priceHistory', wrapSync(l => s.getPriceChangeHistory(l)));
  add('audit:timeline', wrapSync((f, t) => s.getActivityTimeline(f, t)));
  add('audit:exceptions', wrapSync((f, t) => s.getExceptionReport(f, t)));
  add('audit:alerts', wrapSync(() => s.getAdminAlerts()));
  add('audit:dashboard', wrapSync((f, t) => s.getAdminDashboardFull(f, t)));
  add('audit:dailyClosing', wrapSync(d => s.getDailyClosingReport(d)));
  add('audit:customerSummary', wrapSync(id => s.getCustomerPurchaseSummary(id)));
  add('audit:topCustomers', wrapSync((f, t, l) => s.getTopCustomers(f, t, l)));
  add('audit:returnReasons', wrapSync((f, t) => s.getReturnReasonsReport(f, t)));
  add('audit:reopenReturn', wrapSync((id, a) => {
    const user = s.requireActor(a, ['owner']);
    return s.reopenReturn(id, user.id, user.full_name);
  }));

  add('db:health', wrapSync(() => { requireSession(); return s.getDatabaseHealth(); }));
  add('db:optimize', wrapSync(() => s.optimizeDatabase()));
  add('db:repair', wrapSync(() => s.repairDatabase()));
  add('db:resetDemo', wrapSync(actor => {
    const user = s.requireActor(actor, ['owner']);
    return s.resetDemoData(user.id, user.username);
  }));
  add('db:archive', wrapSync(days => s.archiveOldRecords(days)));
  add('db:recalcStock', wrapSync(() => s.recalculateStock()));
  add('db:logs', wrapSync(() => { requireSession(); return s.getSystemLogs(); }));

  add('dev:info', wrapSync(actor => {
    s.requireActor(actor, ['owner']);
    return s.getDeveloperInfo();
  }));
  add('dev:activate', wrapSync((key, actor) => {
    s.requireActor(actor, ['owner']);
    return s.activateLicense(key);
  }));
  add('dev:resetTrial', wrapSync(actor => {
    s.requireActor(actor, ['owner']);
    return s.resetTrial();
  }));

  scheduleDailyBackup(store);
  return H;
}

module.exports = { buildHandlers };

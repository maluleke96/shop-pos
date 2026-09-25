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
  const branchesSvc = require('../electron/services/branches');
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

  /** Railway / cloud RPC server — never call cloud fallback (would recurse into self). */
  function isServerCloudRpc() {
    try {
      return typeof process !== 'undefined'
        && process.env
        && process.env.SHOP_POS_CLOUD === '1'
        && process.env.SHOP_POS_LOCAL_INSTALLER !== '1';
    } catch (_) {
      return false;
    }
  }

  add('app:quit', async () => ({ success: true }));

  const CLOUD_SYNC =
    (typeof window !== 'undefined' &&
      (window.__SHOP_POS_ENV__?.SHOP_POS_SYNC_URL || window.__SHOP_POS_ENV__?.SHOP_POS_CLOUD_URL)) ||
    (typeof location !== 'undefined' && location.origin) ||
    '';

  async function mobileCloudRpc(method, args) {
    if (isServerCloudRpc()) {
      throw new Error('Cloud fallback is not available on the server');
    }
    const base = String(CLOUD_SYNC).replace(/\/$/, '');
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 15000) : null;
    try {
      const r = await fetch(base + '/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method, args: args || [] }),
        signal: ctrl ? ctrl.signal : undefined
      });
      return r.json();
    } finally {
      if (timer) clearTimeout(timer);
    }
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
    // Server is authoritative — do not RPC self on failed login (causes hang / recursion).
    if (isServerCloudRpc()) return local;
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
    s.requireActor(a, ['owner', 'manager']);
    s.deleteUser(id, a.id, a.username);
    return true;
  }));
  add('auth:permanentlyDeleteUser', wrapSync((id, confirm, a) => {
    s.requireActor(a, ['owner', 'manager']);
    return s.permanentlyDeleteUser(id, confirm, a.id, a.username);
  }));
  add('auth:verifySession', wrapSync(userId => s.verifyUserSession(userId)));
  add('auth:session', wrapSync(() => {
    const u = requireSession();
    return u;
  }));
  add('auth:hasRecovery', async () => {
    try {
      if (s.hasRecoverySecret()) return { success: true, data: true };
    } catch (_) { /* ignore */ }
    if (isServerCloudRpc()) return { success: true, data: !!s.hasRecoverySecret?.() };
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
      if (isServerCloudRpc()) return { success: false, error: localErr.message };
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
      if (isServerCloudRpc()) return { success: false, error: localErr.message };
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
  add('settings:getOperatingHours', wrapSync(() => s.getOperatingHoursSettings()));
  add('settings:getMenuHighlights', wrapSync(() => s.getMenuHighlightSettings()));
  add('settings:saveMenuHighlights', wrapSync((d, a) => s.saveMenuHighlightSettings(d || {}, a?.id, a?.username || a?.full_name)));
  add('settings:detectExistingBusiness', wrapSync(() => s.detectExistingBusiness()));
  add('settings:adoptExistingBusiness', wrapSync(() => s.adoptExistingBusiness()));
  add('settings:save', wrapSync((d, a) => {
    const user = s.requireActor(a, ['owner', 'manager']);
    const { assertUserPermission } = require('../electron/services/authz');
    if (user.role !== 'owner') assertUserPermission(user, 'system_settings', ['owner', 'manager']);
    s.saveSettings(d, user.id, user.username || user.full_name);
    persistCritical();
    return true;
  }));
  add('settings:saveJson', wrapSync((k, v, a) => {
    const roles = k === 'staff_portal_settings'
      ? ['owner', 'manager', 'supervisor', 'assistant_manager']
      : ['owner', 'manager'];
    const user = s.requireActor(a, roles);
    s.saveJsonSetting(k, v, user.id, user.username || user.full_name);
    persistCritical();
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
    const out = s.saveCategory(d, user.id, user.username);
    persistCritical();
    return out;
  }));
  add('categories:delete', wrapSync((id, a) => {
    const user = s.requireActor(a, ['owner', 'manager']);
    s.deleteCategory(id, user.id, user.username);
    persistCritical();
    return true;
  }));

  add('products:get', wrapSync(f => s.getProducts(f)));
  add('products:getOne', wrapSync(id => s.getProduct(id)));
  add('products:getByBarcode', wrapSync(b => s.getProductByBarcode(b)));
  add('products:calcRecipe', wrapSync(d => s.calcRecipeMetrics(d)));
  add('products:save', wrapSync((d, a) => {
    const user = s.requireActor(a || s.getUserSession?.(), ['owner', 'manager', 'supervisor', 'assistant_manager']);
    const out = s.saveProduct(d, user.id, user.username);
    persistCritical();
    return out;
  }));
  add('products:delete', wrapSync((id, a) => {
    const user = s.requireActor(a, ['owner', 'manager']);
    s.deleteProduct(id, user.id, user.username);
    persistCritical();
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
    const user = s.requireActor(a || s.getUserSession?.(), ['owner', 'manager', 'supervisor', 'assistant_manager']);
    const out = s.recordStockAdjustment({ product_id: pid, qty: q, direction: t, reason: n }, user);
    persistCritical();
    return out;
  }));
  add('stock:recordAdjustment', wrapSync((data, a) => {
    const user = s.requireActor(a || s.getUserSession?.(), ['owner', 'manager', 'supervisor', 'assistant_manager']);
    const out = s.recordStockAdjustment(data || {}, user);
    persistCritical();
    return out;
  }));
  add('stock:listAdjustments', wrapSync((f) => s.listStockAdjustments(f || {})));
  add('stock:history', wrapSync((arg) => {
    if (arg && typeof arg === 'object' && !Array.isArray(arg)) {
      return s.getAllStockHistory(arg.limit || 500, arg.from || null, arg.to || null);
    }
    return arg ? s.getStockHistory(arg) : s.getAllStockHistory();
  }));

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
  add('expenses:dashboardStats', wrapSync((f, a) => {
    const user = s.requireActor(a, ['owner', 'manager', 'supervisor', 'assistant_manager', 'accountant', 'bookkeeper']);
    return s.getExpenseDashboardStats(user, f || {});
  }));
  add('expenses:getOne', wrapSync((id) => { requireSession(); return s.getExpenseById(id); }));
  add('expenses:getCategories', wrapSync(() => { requireSession(); return s.getExpenseCategories(); }));
  add('expenses:saveCategories', wrapSync((cats, a) => {
    const user = s.requireActor(a, ['owner', 'manager']);
    return s.saveExpenseCategories(cats, user.id, user.username);
  }));
  add('expenses:save', wrapSync((d, a) => {
    const user = s.requireActor(a, ['owner', 'manager', 'supervisor', 'assistant_manager']);
    return s.saveExpense(d, user.id, user.username);
  }));
  add('expenses:delete', wrapSync((id, a) => {
    const user = s.requireActor(a, ['owner', 'manager']);
    s.deleteExpense(id, user.id, user.username);
    return true;
  }));
  add('expenses:parseReceipt', wrapSync((text) => { requireSession(); return s.parseExpenseReceipt(text); }));
  add('expenses:budgets', wrapSync((f) => { requireSession(); return s.listExpenseBudgets(f || {}); }));
  add('expenses:budgetStatus', wrapSync((mk) => { requireSession(); return s.expenseBudgetStatus(mk); }));
  add('expenses:saveBudget', wrapSync((d, a) => {
    const user = s.requireActor(a, ['owner', 'manager']);
    return s.saveExpenseBudget(d, user);
  }));
  add('expenses:deleteBudget', wrapSync((id, a) => {
    s.requireActor(a, ['owner', 'manager']);
    return s.deleteExpenseBudget(id);
  }));
  add('expenses:recurring', wrapSync(() => { requireSession(); return s.listExpenseRecurring(); }));
  add('expenses:saveRecurring', wrapSync((d, a) => {
    const user = s.requireActor(a, ['owner', 'manager']);
    return s.saveExpenseRecurring(d, user);
  }));
  add('expenses:deleteRecurring', wrapSync((id, a) => {
    s.requireActor(a, ['owner', 'manager']);
    return s.deleteExpenseRecurring(id);
  }));
  add('expenses:postRecurring', wrapSync((a) => {
    const user = s.requireActor(a, ['owner', 'manager', 'supervisor', 'assistant_manager']);
    return s.postExpenseRecurringDue(user);
  }));
  add('expenses:ownerFundings', wrapSync((f) => { requireSession(); return s.listOwnerFundings(f || {}); }));
  add('expenses:recordOwnerFunding', wrapSync((d, a) => {
    const user = s.requireActor(a, ['owner', 'manager']);
    return s.recordOwnerFunding(d, user);
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
  add('suppliers:delete', wrapSync((id, a) => {
    const user = s.requireActor(a, ['owner', 'manager']);
    return s.deleteSupplier(id, user.id, user.username);
  }));
  add('suppliers:pay', wrapSync((supplierId, data, actor) => {
    const user = s.requireActor(actor, ['owner', 'manager', 'supervisor', 'assistant_manager']);
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
    const scope = s.resolveBranchScope(sess || null);
    const branchId = scope.allBranches ? null : scope.branchId;
    return s.getDashboardStats(f, t, branchId);
  }));
  add('inventory:stats', wrapSync((branchId) => s.getInventoryStats(branchId)));
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
  add('settings:getTodayTargetProgress', wrapSync((branchId) => s.getTodayTargetProgress(branchId)));
  add('settings:getSalesTargetHistory', wrapSync((opts) => s.getSalesTargetHistory(opts || {})));
  add('settings:getSalesTargetInsights', wrapSync((opts) => s.getSalesTargetInsights(opts || {})));
  add('settings:saveSalesTargetAlertSettings', wrapSync((alerts, a) => {
    const user = s.requireActor(a, ['owner', 'manager']);
    return s.saveSalesTargetAlertSettings(alerts, user.id, user.username || user.full_name);
  }));
  add('settings:saveSalesTargetDayNote', wrapSync((payload, a) => {
    const user = s.requireActor(a, ['owner', 'manager']);
    return s.saveSalesTargetDayNote(payload, user.id, user.username || user.full_name);
  }));
  add('settings:getShiftSettings', wrapSync(() => s.getShiftSettings()));
  add('settings:enforceCashoutDeadlines', wrapSync(() => s.enforceShiftCashoutDeadlines()));
  add('settings:saveShiftSettings', wrapSync((d, a) => {
    const user = s.requireActor(a, ['owner', 'manager']);
    return s.saveShiftSettings(d, user.id, user.username || user.full_name);
  }));

  add('reports:sales', wrapSync((f, t) => { requireSession(); return s.getSalesReport(f, t); }));
  add('reports:profit', wrapSync((f, t) => { requireSession(); return s.getProfitReport(f, t); }));
  add('reports:cashier', wrapSync((f, t, userId) => { requireSession(); return s.getCashierReport(f, t, userId); }));
  add('reports:cashierDetail', wrapSync((f, t, userId) => { requireSession(); return s.getCashierSalesDetail(f, t, userId); }));
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
  add('reports:profitDash', wrapSync((f, t, actor) => {
    const user = requireSession();
    const scope = branchesSvc.resolveBranchScope(actor || user, {});
    const branchId = scope.allBranches ? null : scope.branchId;
    return s.getProfitDashboard(f, t, branchId);
  }));
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
  add('notifications:ackEvent', wrapSync((panel, eventKey, meta) => {
    const na = require('../electron/services/notification-acks');
    const sess = s.getUserSession?.();
    return na.ackEvent(panel, eventKey, { ...(meta || {}), user_id: sess?.id || meta?.user_id });
  }));
  add('notifications:ackEvents', wrapSync((panel, keys, meta) => {
    const na = require('../electron/services/notification-acks');
    const sess = s.getUserSession?.();
    return na.ackEvents(panel, keys || [], { ...(meta || {}), user_id: sess?.id || meta?.user_id });
  }));
  add('notifications:listAcked', wrapSync((panel, limit) => {
    const na = require('../electron/services/notification-acks');
    return na.listAckedKeys(panel, limit || 500);
  }));
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
  add('print:htmlToPdf', async (html, options = {}) => {
    try {
      const { htmlToPdf } = require('../electron/services/html-pdf-server');
      const pdf = htmlToPdf(html, options || {});
      return { success: true, data: pdf.toString('base64'), mime: 'application/pdf' };
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
  add('taken:list', wrapSync((filters, a) => {
    const user = s.requireActor(a, ['owner', 'manager', 'cashier', 'supervisor', 'assistant_manager']);
    return require('../electron/services/taken-orders').listTakenOrders(filters || {}, user);
  }));
  add('taken:summary', wrapSync((a) => {
    const user = s.requireActor(a, ['owner', 'manager', 'assistant_manager', 'supervisor']);
    return require('../electron/services/taken-orders').getAdminSummary(user);
  }));
  add('taken:pay', wrapSync((id, data, a) => {
    const user = s.requireActor(a, ['owner', 'manager', 'cashier', 'supervisor', 'assistant_manager']);
    return require('../electron/services/taken-orders').payTakenOrder(id, data || {}, user);
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
  add('vouchers:list', wrapSync((filters) => { requireSession(); return require('../electron/services/discount-vouchers').listVouchers(filters || {}); }));
  add('vouchers:create', wrapSync((d, a) => {
    const user = s.requireActor(a, ['owner', 'manager']);
    return require('../electron/services/discount-vouchers').createVoucher(d || {}, user);
  }));
  add('vouchers:validate', wrapSync((code, opts) => require('../electron/services/discount-vouchers').validateVoucher(code, opts || {})));
  add('vouchers:redeem', wrapSync((code, opts, actor) => {
    const user = actor ? s.requireActor(actor, ['owner', 'manager', 'cashier', 'assistant_manager', 'supervisor']) : null;
    return require('../electron/services/discount-vouchers').redeemVoucher(code, {
      ...(opts || {}),
      actorId: user?.id,
      actorName: user?.full_name || user?.username
    });
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
  add('loyalty:syncMissing', wrapSync((actor) => {
    s.requireActor(actor, ['owner', 'manager']);
    return s.syncMissingLoyaltyPoints({ limit: 2000 });
  }));
  add('loyalty:listRestorable', wrapSync((opts, actor) => {
    s.requireActor(actor, ['owner']);
    return s.listRestorableExpiredPoints(opts || {});
  }));
  add('loyalty:restoreExpired', wrapSync((expireTxnId, actor) => {
    const user = s.requireActor(actor, ['owner']);
    return s.restoreExpiredLoyaltyPoints(expireTxnId, user.username || user.name || 'owner');
  }));
  add('loyalty:adjust', wrapSync((customerId, pointsDelta, notes, actor) => {
    const user = s.requireActor(actor, ['owner', 'manager', 'supervisor', 'assistant_manager']);
    return s.adjustLoyaltyPoints(customerId, pointsDelta, notes, user.id);
  }));
  add('loyalty:pointsSummary', wrapSync(id => s.getCustomerPointsSummary(id)));
  add('loyalty:reminders', wrapSync(() => s.listLoyaltyReminders()));
  add('loyalty:reminderWhatsApp', wrapSync((customerId, lotId) => s.getLoyaltyReminderWhatsApp(customerId, lotId)));
  add('loyalty:markReminderSent', wrapSync((lotId, actor) => {
    s.requireActor(actor, ['owner', 'manager', 'supervisor', 'assistant_manager']);
    return s.markLoyaltyReminderSent(lotId);
  }));
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
  add('tables:release', wrapSync((tableId, a) => {
    s.requireActor(a || s.getUserSession(), ['owner', 'manager', 'assistant_manager', 'supervisor', 'cashier']);
    return s.releaseRestaurantTable(tableId);
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
    if (d?.pin && d?.employee_id) {
      s.verifyEmployeePin(Number(d.employee_id), d.pin);
      return s.saveStaffSelfie(d);
    }
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
    const user = a || s.getUserSession?.();
    const empSess = s.getEmployeeSession?.();
    const isHrAdmin = ['owner', 'manager', 'supervisor', 'assistant_manager'].includes(user?.role);
    const selfId = empSess?.employee_id ?? user?.employee_id;
    if (!isHrAdmin && selfId != null) {
      return s.getHrDocuments(Number(selfId));
    }
    s.requireActor(user, ['owner', 'manager', 'supervisor', 'assistant_manager']);
    return s.getHrDocuments(empId);
  }));
  add('staff:getHrDocument', wrapSync((id, a) => {
    const doc = s.getHrDocument(id);
    if (!doc) throw new Error('Document not found');
    const user = a || s.getUserSession?.();
    const empSess = s.getEmployeeSession?.();
    if (['owner', 'manager', 'supervisor', 'assistant_manager'].includes(user?.role)) return doc;
    const selfId = empSess?.employee_id ?? user?.employee_id;
    if (selfId != null && Number(selfId) === Number(doc.employee_id)) return doc;
    throw new Error('Not authorised');
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
    const user = a || s.getUserSession?.();
    const empSess = s.getEmployeeSession?.();
    const isHrAdmin = ['owner', 'manager', 'supervisor', 'assistant_manager'].includes(user?.role);
    if (!isHrAdmin && empSess?.employee_id != null) {
      return s.getAttendancePenalties({ ...(f || {}), employee_id: empSess.employee_id });
    }
    s.requireActor(user, ['owner', 'manager', 'supervisor', 'assistant_manager']);
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
    s.requireActor(a || s.getUserSession?.(), ['owner', 'manager', 'supervisor', 'assistant_manager']);
    return s.saveSchedule(d);
  }));
  add('staff:deleteSchedule', wrapSync((id, a) => {
    s.requireActor(a || s.getUserSession?.(), ['owner', 'manager', 'supervisor', 'assistant_manager']);
    return s.deleteSchedule(id);
  }));
  add('staff:autoShifts', wrapSync((w, t, ids, overrides, a, options) => {
    s.requireActor(a || s.getUserSession?.(), ['owner', 'manager', 'supervisor', 'assistant_manager']);
    return s.autoGenerateShifts(w, t, ids, overrides, options || {});
  }));
  add('staff:getDocuments', wrapSync((id, a) => {
    const user = a || s.getUserSession?.();
    const empSess = s.getEmployeeSession?.();
    const isHrAdmin = ['owner', 'manager', 'supervisor', 'assistant_manager'].includes(user?.role);
    const selfId = empSess?.employee_id ?? user?.employee_id;
    if (!isHrAdmin && selfId != null) {
      return s.getEmployeeDocuments(Number(selfId));
    }
    if (isHrAdmin) return s.getEmployeeDocuments(id);
    throw new Error('Authentication required');
  }));
  add('staff:saveDocument', wrapSync((d, a) => {
    const user = a || s.getUserSession?.();
    const empSess = s.getEmployeeSession?.();
    const isHrAdmin = ['owner', 'manager', 'supervisor', 'assistant_manager'].includes(user?.role);
    if (!isHrAdmin) {
      const selfId = empSess?.employee_id ?? user?.employee_id;
      if (selfId == null) throw new Error('Authentication required');
      return s.saveEmployeeDocument({ ...d, employee_id: Number(selfId) });
    }
    s.requireActor(user, ['owner', 'manager', 'supervisor', 'assistant_manager']);
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
  add('staff:payslipPdf', wrapSync((id, auth) => {
    const pin = auth?.pin != null ? String(auth.pin) : null;
    if (pin) {
      const owner = s.getDb().prepare('SELECT employee_id FROM employee_payroll WHERE id = ?').get(id);
      if (!owner) throw new Error('Payroll record not found');
      s.verifyEmployeePin(owner.employee_id, pin);
    }
    const st = s.getSettingsParsed();
    return s.buildPayslipPdf(id, st?.shop_name, st?.currency || 'R', { skipAuth: !!pin || !!s.getUserSession?.()?.id });
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
  add('hr:listLeases', wrapSync((a) => s.listLeaseAgreements(a)));
  add('hr:getLease', wrapSync((id, a) => s.getLeaseAgreement(id, a)));
  add('hr:saveLease', wrapSync((d, a) => s.saveLeaseAgreement(d, a)));
  add('hr:deleteLease', wrapSync((id, a) => s.deleteLeaseAgreement(id, a)));
  add('hr:uploadLease', wrapSync((id, name, data, a) => s.uploadLeaseFile(id, name, data, a)));
  add('hr:leasePdf', wrapSync((id, a) => s.buildLeasePdf(id, a)));
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
  add('hr:getProbations', wrapSync((f, a) => {
    const empSess = s.getEmployeeSession?.();
    const userRole = a?.role || s.getUserSession?.()?.role;
    const isHr = ['owner', 'manager', 'supervisor', 'assistant_manager'].includes(userRole);
    const selfId = empSess?.employee_id ?? a?.employee_id;
    if (!isHr && selfId != null) return s.getProbations({ ...(f || {}), employee_id: Number(selfId) });
    s.requireActor(a, hrRead);
    return s.getProbations(f || {});
  }));
  add('hr:getProbation', wrapSync((id, a) => { s.requireActor(a, hrRead); return s.getProbation(id); }));
  add('hr:saveProbation', wrapSync((d, a) => { s.requireActor(a, hrWrite); return s.saveProbation(d, a.id, hrActor(a)); }));
  add('hr:deleteProbation', wrapSync((id, a) => { s.requireActor(a, ['owner', 'manager']); return s.deleteProbation(id, a.id, hrActor(a)); }));
  add('hr:getDecisionRules', wrapSync((a) => { s.requireActor(a, hrRead); return s.getDecisionRules(); }));
  add('hr:saveDecisionRule', wrapSync((d, a) => { s.requireActor(a, hrWrite); return s.saveDecisionRule(d, a.id, hrActor(a)); }));
  add('hr:saveDailyEvaluation', wrapSync((d, a) => { s.requireActor(a, hrRead); return s.saveDailyEvaluation(d, a.id, hrActor(a)); }));
  add('hr:getEvaluationHistory', wrapSync((f, a) => {
    const empSess = s.getEmployeeSession?.();
    const userRole = a?.role || s.getUserSession?.()?.role;
    const isHr = ['owner', 'manager', 'supervisor', 'assistant_manager'].includes(userRole);
    const selfId = empSess?.employee_id ?? a?.employee_id;
    if (!isHr && selfId != null) return s.getEvaluationHistory({ ...(f || {}), employee_id: Number(selfId) });
    s.requireActor(a, hrRead);
    return s.getEvaluationHistory(f || {});
  }));
  add('hr:getRecommendation', wrapSync((pid, a) => { s.requireActor(a, hrRead); return s.getRecommendation(pid); }));
  add('hr:finalProbationDecision', wrapSync((pid, dec, reason, ext, a) => { s.requireActor(a, hrWrite); return s.finalProbationDecision(pid, dec, reason, a.id, hrActor(a), ext); }));
  add('hr:getProbationDashboard', wrapSync((f, a) => { s.requireActor(a, hrRead); return s.getProbationDashboard(f || {}); }));
  add('hr:probationPdf', wrapSync((id, a) => {
    const emp = s.getEmployeeSession?.();
    if (emp?.employee_id != null) {
      const p = s.getProbation(id);
      if (!p || Number(p.employee_id) !== Number(emp.employee_id)) throw new Error('Not authorised');
      return s.buildProbationPdf(id, s.getSettingsParsed());
    }
    s.requireActor(a, hrRead);
    return s.buildProbationPdf(id, s.getSettingsParsed());
  }));
  add('hr:evaluationReportPdf', wrapSync((id, a) => { s.requireActor(a, hrRead); return s.buildEvaluationReportPdf(id, s.getSettingsParsed()); }));
  add('hr:probationLetterPdf', wrapSync((id, dec, a) => { s.requireActor(a, hrRead); return s.buildProbationLetterPdf(id, dec, s.getSettingsParsed()); }));
  add('hr:getPersonnelFile', wrapSync((eid, a) => { s.requireActor(a, hrRead); return s.getEmployeePersonnelFile(eid); }));

  const hrPlatA = (a) => a || s.getUserSession();
  add('hr:login', async (u, p) => {
    try {
      const r = s.hrLogin(u, p);
      if (!r || r.success === false) return { success: false, error: r?.error || 'Login failed' };
      return { success: true, data: r.data ?? r.user };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
  add('hr:dashboard', wrapSync((f, a) => s.getHrDashboard(f || {}, hrPlatA(a))));
  add('hr:search', wrapSync((q, a) => s.hrGlobalSearch(q, hrPlatA(a))));
  add('hr:settings', wrapSync((a) => s.getHrSettings(hrPlatA(a))));
  add('hr:saveSettings', wrapSync((d, a) => s.saveHrSettings(d || {}, hrPlatA(a))));
  add('hr:people', wrapSync((f, a) => s.listPeople(f || {}, hrPlatA(a))));
  add('hr:listPayroll', wrapSync((f, a) => s.listPayrollRecords(f || {}, hrPlatA(a))));
  add('hr:attendanceHub', wrapSync((f, a) => s.listAttendanceHub(f || {}, hrPlatA(a))));
  add('hr:schedules', wrapSync((f, a) => s.listShiftSchedules(f || {}, hrPlatA(a))));
  add('hr:leaveBalances', wrapSync((a) => s.listLeaveBalances(hrPlatA(a))));
  add('hr:employeeDocuments', wrapSync((f, a) => s.listAllEmployeeDocuments(f || {}, hrPlatA(a))));
  add('hr:offboardingList', wrapSync((f, a) => s.listOffboardingRecords(f || {}, hrPlatA(a))));
  add('hr:onboardingList', wrapSync((a) => s.listOnboardingProgressAll(hrPlatA(a))));
  add('hr:payrollDeductions', wrapSync((f, a) => s.listPayrollDeductions(f || {}, hrPlatA(a))));
  add('hr:statutorySummary', wrapSync((f, a) => s.getStatutorySummary(f || {}, hrPlatA(a))));
  add('hr:performanceHub', wrapSync((f, a) => s.getPerformanceHub(f || {}, hrPlatA(a))));
  add('hr:staffWarnings', wrapSync((f, a) => s.listStaffWarnings(f || {}, hrPlatA(a))));
  add('hr:employeeProfile', wrapSync((id, a) => s.getEmployeeProfile(id, hrPlatA(a))));
  add('hr:employeeTimeline', wrapSync((id, a) => s.getEmployeeTimeline(id, hrPlatA(a))));
  add('hr:approvals', wrapSync((f, a) => s.listApprovals(f || {}, hrPlatA(a))));
  add('hr:submitForApproval', wrapSync((d, a) => s.submitHrForApproval(d || {}, hrPlatA(a))));
  add('hr:complianceCentre', wrapSync((a) => s.getComplianceCentre(hrPlatA(a))));
  add('hr:complianceEvents', wrapSync((f, a) => s.listComplianceEvents(f || {}, hrPlatA(a))));
  add('hr:saveComplianceEvent', wrapSync((d, a) => s.saveComplianceEvent(d || {}, hrPlatA(a))));
  add('hr:policies', wrapSync((f, a) => s.listPolicies(f || {}, hrPlatA(a))));
  add('hr:savePolicy', wrapSync((d, a) => s.savePolicy(d || {}, hrPlatA(a))));
  add('hr:acknowledgePolicy', wrapSync((pid, eid, d, a) => s.acknowledgePolicy(pid, eid, d || {}, hrPlatA(a))));
  add('hr:businessRules', wrapSync((f, a) => s.listBusinessRules(f || {}, hrPlatA(a))));
  add('hr:saveBusinessRule', wrapSync((d, a) => s.saveBusinessRule(d || {}, hrPlatA(a))));
  add('hr:incidents', wrapSync((f, a) => s.listIncidents(f || {}, hrPlatA(a))));
  add('hr:saveIncident', wrapSync((d, a) => s.saveIncident(d || {}, hrPlatA(a))));
  add('hr:disciplinaryCases', wrapSync((f, a) => s.listDisciplinaryCases(f || {}, hrPlatA(a))));
  add('hr:saveDisciplinaryCase', wrapSync((d, a) => s.saveDisciplinaryCase(d || {}, hrPlatA(a))));

  const mgrHr = require('../electron/services/mgr-hr-portal');
  // Any authenticated user may use portal APIs; service checks assignment / admin rights.
  const mgrHrUser = (a) => {
    if (a?.id) {
      try { return s.requireActor(a, []); } catch (_) { /* fall through */ }
    }
    return requireUserSession([]);
  };
  add('mgrHr:listAssignments', wrapSync((a) => mgrHr.listAssignments(mgrHrUser(a))));
  add('mgrHr:getAssignment', wrapSync((id, a) => mgrHr.getAssignment(id, mgrHrUser(a))));
  add('mgrHr:saveAssignment', wrapSync((d, a) => mgrHr.saveAssignment(d || {}, mgrHrUser(a))));
  add('mgrHr:setAssignmentActive', wrapSync((id, active, a) => mgrHr.setAssignmentActive(id, active, mgrHrUser(a))));
  add('mgrHr:listEligibleUsers', wrapSync((a) => mgrHr.listEligibleUsers(mgrHrUser(a))));
  add('mgrHr:listActivity', wrapSync((f, a) => mgrHr.listActivity(f || {}, mgrHrUser(a))));
  add('mgrHr:portalContext', wrapSync((a) => mgrHr.getPortalContext(mgrHrUser(a))));
  add('mgrHr:dashboard', wrapSync((a) => mgrHr.dashboard(mgrHrUser(a))));
  add('mgrHr:listMyStaff', wrapSync((a) => mgrHr.listMyStaff(mgrHrUser(a))));
  add('mgrHr:listCases', wrapSync((f, a) => mgrHr.listCases(f || {}, mgrHrUser(a))));
  add('mgrHr:getCase', wrapSync((id, a) => mgrHr.getCase(id, mgrHrUser(a))));
  add('mgrHr:createCase', wrapSync((d, a) => mgrHr.createCase(d || {}, mgrHrUser(a))));
  add('mgrHr:updateStatus', wrapSync((id, status, notes, a) => mgrHr.updateCaseStatus(id, status, notes, mgrHrUser(a))));
  add('mgrHr:requestResponse', wrapSync((id, notes, a) => mgrHr.requestEmployeeResponse(id, notes, mgrHrUser(a))));
  add('mgrHr:addRecommendation', wrapSync((id, d, a) => mgrHr.addRecommendation(id, d || {}, mgrHrUser(a))));
  add('mgrHr:createWarning', wrapSync((id, d, a) => mgrHr.createWarningFromCase(id, d || {}, mgrHrUser(a))));
  add('mgrHr:adminDecide', wrapSync((id, d, a) => mgrHr.adminDecide(id, d || {}, mgrHrUser(a))));
  add('mgrHr:deleteCase', wrapSync((id, a) => mgrHr.deleteCase(id, mgrHrUser(a))));
  add('mgrHr:listNotifications', wrapSync((audience, a) => mgrHr.listNotifications(mgrHrUser(a), audience)));
  add('mgrHr:markNotificationRead', wrapSync((id, a) => mgrHr.markNotificationRead(id, mgrHrUser(a))));
  add('mgrHr:listEmployeeCases', wrapSync((a) => {
    const emp = s.getEmployeeSession?.() || a;
    return mgrHr.listEmployeeCases(emp || requireUserSession([]));
  }));
  add('mgrHr:getEmployeeCase', wrapSync((id, a) => {
    const emp = s.getEmployeeSession?.() || a;
    return mgrHr.getEmployeeCase(id, emp || a);
  }));
  add('mgrHr:submitEmployeeResponse', wrapSync((id, d, a) => {
    const emp = s.getEmployeeSession?.() || a;
    return mgrHr.submitEmployeeResponse(id, d || {}, emp || a);
  }));
  add('mgrHr:listRecordings', wrapSync((f, a) => mgrHr.listRecordings(f || {}, mgrHrUser(a))));
  add('mgrHr:getRecording', wrapSync((id, a) => mgrHr.getRecording(id, mgrHrUser(a))));
  add('mgrHr:createRecording', wrapSync((d, a) => mgrHr.createRecording(d || {}, mgrHrUser(a))));
  add('mgrHr:updateRecording', wrapSync((id, d, a) => mgrHr.updateRecording(id, d || {}, mgrHrUser(a))));
  add('mgrHr:deleteRecording', wrapSync((id, a) => mgrHr.deleteRecording(id, mgrHrUser(a))));
  add('mgrHr:analyzeRecording', wrapAsync(async (id, d, a) => mgrHr.analyzeRecording(id, d || {}, mgrHrUser(a))));
  add('mgrHr:recordingDocumentHtml', wrapSync((id, a) => {
    const rec = mgrHr.getRecording(id, mgrHrUser(a));
    let shop = 'Company';
    try {
      shop = require('../electron/database/db').getDb().prepare('SELECT shop_name FROM shop_settings WHERE id=1').get()?.shop_name || shop;
    } catch (_) { /* ignore */ }
    return { html: mgrHr.buildRecordingDocumentHtml(rec, shop), recording: { ...rec, audio_data: undefined } };
  }));
  add('mgrHr:caseDocumentHtml', wrapSync((id, a) => {
    const c = mgrHr.getCase(id, mgrHrUser(a));
    let shop = { shop_name: 'Company' };
    try {
      shop = require('../electron/database/db').getDb().prepare(
        'SELECT shop_name, address, phone, email FROM shop_settings WHERE id=1'
      ).get() || shop;
    } catch (_) { /* ignore */ }
    return { html: mgrHr.buildCaseDocumentHtml(c, shop), case: { ...c, evidence_paths: undefined } };
  }));

  add('hr:onboardingTemplates', wrapSync((a) => s.listOnboardingTemplates(hrPlatA(a))));
  add('hr:onboardingProgress', wrapSync((eid, a) => s.getOnboardingProgress(eid, hrPlatA(a))));
  add('hr:saveOnboardingProgress', wrapSync((d, a) => s.saveOnboardingProgress(d || {}, hrPlatA(a))));
  add('hr:forms', wrapSync((f, a) => s.listForms(f || {}, hrPlatA(a))));
  add('hr:saveForm', wrapSync((d, a) => s.saveForm(d || {}, hrPlatA(a))));
  add('hr:createExternalLink', wrapSync((d, a) => s.createExternalLink(d || {}, hrPlatA(a))));
  add('hr:requests', wrapSync((f, a) => s.listRequests(f || {}, hrPlatA(a))));
  add('hr:saveRequest', wrapSync((d, a) => s.saveRequest(d || {}, hrPlatA(a))));
  add('hr:decideRequest', wrapSync((id, dec, notes, a) => s.decideRequest(id, dec, notes, hrPlatA(a))));
  add('hr:employerRecords', wrapSync((f, a) => s.listEmployerRecords(f || {}, hrPlatA(a))));
  add('hr:saveEmployerRecord', wrapSync((d, a) => s.saveEmployerRecord(d || {}, hrPlatA(a))));
  add('hr:salaryHistory', wrapSync((eid, a) => s.listSalaryHistory(eid, hrPlatA(a))));
  add('hr:saveSalaryChange', wrapSync((d, a) => s.saveSalaryChange(d || {}, hrPlatA(a))));
  add('hr:saveOffboarding', wrapSync((d, a) => s.saveOffboarding(d || {}, hrPlatA(a))));
  add('hr:postPayrollAccounting', wrapSync((pid, a) => s.postPayrollToAccounting(pid, hrPlatA(a))));

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
  add('jobs:getPublicPosting', wrapSync((token) => s.getPublicPosting(token)));
  add('jobs:listPublicPostings', wrapSync(() => s.listPublicOpenPostings()));
  add('jobs:getPublicApplication', wrapSync((editToken) => s.getPublicApplication(editToken)));
  add('jobs:lookupPublicApplication', wrapSync((token, phone) => s.lookupPublicApplication(token, phone)));
  add('jobs:submitPublicApplication', wrapSync((token, data) => s.submitPublicApplication(token, data)));
  add('jobs:updatePublicApplication', wrapSync((editToken, data) => s.updatePublicApplication(editToken, data)));
  add('jobs:deletePublicApplication', wrapSync((editToken) => s.deletePublicApplication(editToken)));
  add('jobs:deleteCandidate', wrapSync((id, a) => s.deleteJobCandidate(id, a)));
  add('jobs:downloadCv', wrapSync((id, a) => s.downloadCandidateCv(id, a)));
  add('jobs:posterPdf', wrapSync((id, a) => {
    const r = s.buildJobPosterPdf(id, a);
    return {
      buffer: r.buffer, apply_url: r.apply_url, order_url: r.order_url, posting: r.posting,
      shop: r.shop, logo_data_url: r.logo_data_url, share: r.share
    };
  }));
  add('jobs:shareMessage', wrapSync((id, a) => s.buildJobShareMessage(id, a)));
  add('jobs:previewWa', wrapSync((id, mt, a) => s.previewCandidateWhatsApp(id, mt, a)));

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
  add('bookkeeping:dashboard', wrapSync((f, t, branchId) => {
    s.requireBookkeepingAccess(s.getUserSession?.());
    return s.getFinancialDashboard(f, t, branchId);
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
  add('bookkeeping:taxSummary', wrapSync((f, t, branchId) => {
    s.requireBookkeepingAccess(s.getUserSession?.());
    return s.getTaxSummary(f, t, branchId);
  }));
  add('bookkeeping:report', wrapSync((type, f, t) => {
    s.requireBookkeepingAccess(s.getUserSession?.());
    return s.getFinancialReport(type, f, t);
  }));
  add('bookkeeping:yearEndPack', wrapSync((f, t) => {
    s.requireBookkeepingAccess(s.getUserSession?.());
    return s.getYearEndPack(f, t);
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
  add('bookkeeping:yearEndPackPdf', wrapSync((f, t) => {
    s.requireBookkeepingAccess(s.getUserSession?.());
    const st = s.getSettingsParsed();
    return s.buildYearEndPackPdf(f, t, st?.shop_name, st?.currency || 'R');
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
  add('ops:saveAdminSignatureData', wrapSync((dataUrl, a) => s.saveAdminSignatureFromData(dataUrl, a)));
  add('ops:getRuleCategories', wrapSync(() => s.getRuleCategories()));
  add('ops:saveRuleCategory', wrapSync((name, a) => s.saveRuleCategory(name, a)));
  add('ops:getRuleAcks', wrapSync((f) => s.getRuleAcknowledgements(f || {})));
  add('ops:signRule', wrapSync((ruleId, empId, sig, a) => s.signCompanyRule(ruleId, empId, sig, a)));
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
  add('ops:updatePromo', wrapSync((id, data, a) => s.updatePromoRequest(id, data || {}, a)));
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
  add('recipe:productionMeals', wrapSync((a, f) => s.listProductionMeals(a, f || {})));
  add('recipe:ingredientStockHistory', wrapSync((f, a) => s.getIngredientStockHistory(f || {}, a)));
  add('recipe:restockPreview', wrapSync((d, a) => s.computeRestockPreview(d || {}, a)));
  add('recipe:restockBatchHistory', wrapSync((f, a) => s.listRestockBatches(f || {}, a)));
  add('recipe:restockBatchDetail', wrapSync((id, a) => s.getRestockBatchDetail(id, a)));
  add('recipe:restockBatchSave', wrapSync((d, a) => s.restockIngredientsBatch(d || {}, a)));
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
  add('recipe:getMeal', wrapSync((id, a, opts) => s.getProductMealRecipe(id, a, opts || { for_editor: true })));
  add('recipe:saveMeal', wrapSync((d, a) => s.saveProductMealRecipe(d || {}, a)));
  add('recipe:ingredientCatalog', wrapSync((a) => s.listIngredientCatalog(a)));
  add('recipe:restockIngredient', wrapSync((d, a) => s.restockIngredient(d || {}, a)));
  add('recipe:ensureIngredient', wrapSync((d, a) => s.ensureIngredient(d || {}, a)));
  add('recipe:updateIngredient', wrapSync((d, a) => s.updateIngredient(d || {}, a)));
  add('recipe:deleteIngredient', wrapSync((id, a) => { s.deleteIngredient(id, a); return true; }));
  add('recipe:restockPlan', wrapSync((t, a) => s.calculateRestockPlan(t, a)));
  add('recipe:setPosMenuFlags', wrapSync((d, a) => { s.setPosMenuFlags(d || {}, a); return true; }));
  add('recipe:restockList', wrapSync(a => s.listRestockIngredients(a)));
  add('recipe:ingredientGroups', wrapSync(a => s.listIngredientGroups(a)));
  add('recipe:ingredientGroup', wrapSync((id, a) => s.getIngredientGroup(id, a)));
  add('recipe:saveIngredientGroup', wrapSync((d, a) => s.saveIngredientGroup(d || {}, a)));
  add('recipe:deleteIngredientGroup', wrapSync((id, a) => s.deleteIngredientGroup(id, a)));
  add('recipe:expandIngredientGroups', wrapSync((ids, a) => s.expandIngredientGroups(ids || [], a)));
  add('recipe:productionAvailability', wrapSync((productId, a) => s.getProductionAvailability(productId, a)));
  add('recipe:productionDashboard', wrapSync(a => s.getLiveProductionDashboard(a)));
  add('recipe:refreshProduction', wrapSync(a => s.refreshProductionAvailability(a)));
  add('recipe:productRestock', wrapSync((productId, targetQty, a) => s.getProductRestockRecommendation(productId, targetQty, a)));


  const ACC_SESSION_ROLES = ['owner', 'manager', 'accountant', 'bookkeeper', 'auditor', 'finance_manager', 'finance', 'payroll', 'hr', 'admin', 'supervisor', 'assistant_manager', 'viewer', 'read_only'];
  const ACC_WRITE_ROLES = ['owner', 'manager', 'accountant', 'bookkeeper', 'finance_manager', 'finance', 'admin'];
  function accActor(clientActor) {
    if (isServerCloudRpc()) return requireUserSession(ACC_SESSION_ROLES);
    try {
      return requireUserSession(ACC_SESSION_ROLES);
    } catch (e) {
      if (clientActor && clientActor.id != null) return s.requireActor(clientActor, ACC_SESSION_ROLES);
      throw e;
    }
  }
  function accWriteActor(clientActor) {
    const user = accActor(clientActor);
    if (isServerCloudRpc() && !ACC_WRITE_ROLES.includes(user.role)) {
      throw new Error('You do not have permission for this action');
    }
    return user;
  }
  function accAdminActor(clientActor) {
    const user = accActor(clientActor);
    if (isServerCloudRpc() && !['owner', 'manager', 'accountant', 'finance_manager'].includes(user.role)) {
      throw new Error('Owner or finance role required');
    }
    return user;
  }
  add('acc:login', wrapSync((u, p) => s.accountingLogin(u, p)));
  add('acc:sessionFromPos', wrapSync((a) => s.accountingSessionFromPos(a || requireUserSession(['owner', 'manager', 'supervisor', 'assistant_manager']))));
  add('acc:logout', wrapSync(() => s.accountingLogout()));
  add('acc:dashboard', wrapSync((f, a) => s.getAccDashboard(f || {}, accActor(a))));
  add('acc:search', wrapSync((q, a) => s.globalSearch(q, accActor(a))));
  add('acc:settings', wrapSync(() => s.getAccSettings()));
  add('acc:saveSettings', wrapSync((d, a) => s.saveAccSettings(d || {}, accAdminActor(a))));
  add('acc:accounts', wrapSync((f, a) => s.listAccounts(f || {}, accActor(a))));
  add('acc:saveAccount', wrapSync((d, a) => s.saveAccount(d || {}, accActor(a))));
  add('acc:journals', wrapSync((f, a) => s.listJournals(f || {}, accActor(a))));
  add('acc:getJournal', wrapSync((id, a) => { accActor(a); return s.getJournal(id); }));
  add('acc:postJournal', wrapSync((d, a) => s.postJournal(d || {}, accWriteActor(a))));
  add('acc:publishJournal', wrapSync((id, a) => s.publishJournal(id, accWriteActor(a))));
  add('acc:reverseJournal', wrapSync((id, a) => s.reverseJournal(id, accWriteActor(a))));
  add('acc:ledger', wrapSync((f, a) => s.listLedger(f || {}, accActor(a))));
  add('acc:trialBalance', wrapSync((asOf, a) => s.trialBalance(asOf, accActor(a))));
  add('acc:profitLoss', wrapSync((from, to, a) => s.profitAndLoss(from, to, accActor(a))));
  add('acc:balanceSheet', wrapSync((asOf, a) => s.balanceSheet(asOf, accActor(a))));
  add('acc:cashFlow', wrapSync((from, to, a) => s.cashFlow(from, to, accActor(a))));
  add('acc:invoices', wrapSync((f, a) => s.listInvoices(f || {}, accActor(a))));
  add('acc:saveInvoice', wrapSync((d, a) => s.saveInvoice(d || {}, accActor(a))));
  add('acc:postInvoice', wrapSync((id, a) => s.postInvoice(id, accActor(a))));
  add('acc:bills', wrapSync((f, a) => s.listBills(f || {}, accActor(a))));
  add('acc:saveBill', wrapSync((d, a) => s.saveBill(d || {}, accActor(a))));
  add('acc:postBill', wrapSync((id, a) => s.postBill(id, accActor(a))));
  add('acc:payments', wrapSync((f, a) => s.listPayments(f || {}, accActor(a))));
  add('acc:savePayment', wrapSync((d, a) => s.savePayment(d || {}, accActor(a))));
  add('acc:agingAr', wrapSync((asOf, a) => s.arAging(asOf, accActor(a))));
  add('acc:agingAp', wrapSync((asOf, a) => s.apAging(asOf, accActor(a))));
  add('acc:bankAccounts', wrapSync((a) => s.listBankAccounts(accActor(a))));
  add('acc:expenses', wrapSync((f, a) => s.listAccExpenses(f || {}, accActor(a))));
  add('acc:recordExpense', wrapSync((d, a) => s.recordExpenseViaAccounting(d || {}, accActor(a))));
  add('acc:taxSummary', wrapSync((from, to, a) => s.taxSummary(from, to, accActor(a))));
  add('acc:stockValue', wrapSync((a) => s.stockValueReport(accActor(a))));
  add('acc:audit', wrapSync((f, a) => s.listAudit(f || {}, accActor(a))));
  add('acc:integrations', wrapSync((f, a) => s.listIntegrationErrors(f || {}, accActor(a))));
  add('acc:retryIntegration', wrapSync((id, a) => s.retryIntegrationError(id, accActor(a))));
  add('acc:financialHealth', wrapSync((f, a) => s.getFinancialHealth(f || {}, accActor(a))));
  add('acc:reconcileCentre', wrapSync((a) => s.listReconcileCentre(accActor(a))));
  add('acc:bankStmtLines', wrapSync((f, a) => s.listBankStatementLines(f || {}, accActor(a))));
  add('acc:listCashupFinance', wrapSync((f, a) => s.listCashupFinance(f || {}, accActor(a))));
  add('acc:syncMissing', wrapSync((a) => s.syncMissingIntegrations(accActor(a))));
  add('acc:periods', wrapSync((a) => s.listPeriods(accActor(a))));
  add('acc:assets', wrapSync((a) => s.listAssets(accActor(a))));
  add('acc:documents', wrapSync((f, a) => s.listDocuments(f || {}, accActor(a))));
  add('acc:approvals', wrapSync((f, a) => s.listApprovals(f || {}, accActor(a))));
  add('acc:setAccountActive', wrapSync((id, active, a) => s.setAccountActive(id, active, accActor(a))));
  add('acc:closePeriod', wrapSync((id, a) => s.closePeriod(id, accAdminActor(a))));
  add('acc:reopenPeriod', wrapSync((id, a) => s.reopenPeriod(id, accAdminActor(a))));
  add('acc:lockPeriod', wrapSync((id, a) => s.lockPeriod(id, accAdminActor(a))));
  add('acc:yearEnd', wrapSync((a) => s.runYearEnd(accAdminActor(a))));
  add('acc:getInvoice', wrapSync((id) => s.getInvoice(id)));
  add('acc:creditNotes', wrapSync((f, a) => s.listCreditNotes(f || {}, accActor(a))));
  add('acc:saveCreditNote', wrapSync((d, a) => s.saveCreditNote(d || {}, accActor(a))));
  add('acc:postCreditNote', wrapSync((id, a) => s.postCreditNote(id, accActor(a))));
  add('acc:debitNotes', wrapSync((a) => s.listDebitNotes(accActor(a))));
  add('acc:saveDebitNote', wrapSync((d, a) => s.saveDebitNote(d || {}, accActor(a))));
  add('acc:postDebitNote', wrapSync((id, a) => s.postDebitNote(id, accActor(a))));
  add('acc:refunds', wrapSync((a) => s.listRefunds(accActor(a))));
  add('acc:saveRefund', wrapSync((d, a) => s.saveRefund(d || {}, accActor(a))));
  add('acc:customerStatement', wrapSync((id, from, to, a) => s.customerStatement(id, from, to, accActor(a))));
  add('acc:supplierStatement', wrapSync((id, from, to, a) => s.supplierStatement(id, from, to, accActor(a))));
  add('acc:saveBankAccount', wrapSync((d, a) => s.saveBankAccount(d || {}, accActor(a))));
  add('acc:bankTxns', wrapSync((f, a) => s.listBankTxns(f || {}, accActor(a))));
  add('acc:saveBankTxn', wrapSync((d, a) => s.saveBankTxn(d || {}, accActor(a))));
  add('acc:importBankStmt', wrapSync((bankId, lines, a) => s.importBankStatement(bankId, lines || [], accActor(a))));
  add('acc:parseBankStmt', wrapSync((text, filename, format, a) => { accActor(a); return s.parseBankStatement(text, filename, format); }));
  add('acc:matchBankStmt', wrapSync((lineId, txnId, a) => s.matchBankStmtLine(lineId, txnId, accActor(a))));
  add('acc:createReconciliation', wrapSync((d, a) => s.createReconciliation(d || {}, accActor(a))));
  add('acc:completeReconciliation', wrapSync((id, a) => s.completeReconciliation(id, accActor(a))));
  add('acc:cashAccounts', wrapSync((a) => s.listCashAccounts(accActor(a))));
  add('acc:cashTxns', wrapSync((f, a) => s.listCashTxns(f || {}, accActor(a))));
  add('acc:saveCashTxn', wrapSync((d, a) => s.saveCashTxn(d || {}, accActor(a))));
  add('acc:pettyCash', wrapSync((a) => s.listPettyCash(accActor(a))));
  add('acc:savePettyCash', wrapSync((d, a) => s.savePettyCashExpense(d || {}, accActor(a))));
  add('acc:cashupFinance', wrapSync((d, a) => s.saveCashupFinance(d || {}, accActor(a))));
  add('acc:recurring', wrapSync((a) => s.listRecurring(accActor(a))));
  add('acc:saveRecurring', wrapSync((d, a) => s.saveRecurring(d || {}, accActor(a))));
  add('acc:processRecurring', wrapSync((a) => s.processDueRecurring(accActor(a))));
  add('acc:otherIncome', wrapSync((a) => s.listOtherIncome(accActor(a))));
  add('acc:saveOtherIncome', wrapSync((d, a) => s.saveOtherIncome(d || {}, accActor(a))));
  add('acc:saveAsset', wrapSync((d, a) => s.saveAsset(d || {}, accActor(a))));
  add('acc:runDepreciation', wrapSync((asOf, a) => s.runDepreciation(asOf, accActor(a))));
  add('acc:loans', wrapSync((a) => s.listLoans(accActor(a))));
  add('acc:saveLoan', wrapSync((d, a) => s.saveLoan(d || {}, accActor(a))));
  add('acc:loanPayment', wrapSync((d, a) => s.recordLoanPayment(d || {}, accActor(a))));
  add('acc:ownerTxns', wrapSync((a) => s.listOwnerTxns(accActor(a))));
  add('acc:saveOwnerTxn', wrapSync((d, a) => s.saveOwnerTxn(d || {}, accActor(a))));
  add('acc:taxRates', wrapSync((a) => s.listTaxRates(accActor(a))));
  add('acc:saveTaxRate', wrapSync((d, a) => s.saveTaxRate(d || {}, accActor(a))));
  add('acc:salesReport', wrapSync((from, to, a) => s.salesReport(from, to, accActor(a))));
  add('acc:purchaseReport', wrapSync((from, to, a) => s.purchaseReport(from, to, accActor(a))));
  add('acc:expenseReport', wrapSync((from, to, a) => s.expenseReport(from, to, accActor(a))));
  add('acc:drillDown', wrapSync((metric, from, to, a) => s.drillDown(metric, from, to, accActor(a))));
  add('acc:recordStockAdjustment', wrapSync((d, a) => s.recordStockAdjustment(d || {}, accActor(a))));
  add('acc:stockAdjustments', wrapSync((f, a) => { accActor(a); return s.listStockAdjustments(f || {}); }));
  add('acc:getDocumentFile', wrapSync((id, a) => s.getDocumentFile(id, accActor(a))));
  add('acc:processOcr', wrapSync((id, a) => s.processOcrDocument(id, accActor(a))));
  add('acc:statements', wrapSync((f, a) => s.listStatementHistory(f || {}, accActor(a))));
  add('acc:saveStatement', wrapSync((d, a) => s.saveStatementHistory(d || {}, accActor(a))));
  add('acc:getStatement', wrapSync((id, a) => s.getStatementHistory(id, accActor(a))));
  add('acc:confirmOcr', wrapSync((id, d, a) => s.confirmOcrDocument(id, d || {}, accActor(a))));
  add('acc:decideApproval', wrapSync((id, decision, notes, a) => s.decideApproval(id, decision, notes, accActor(a))));
  add('acc:notifications', wrapSync((a) => s.listNotifications(accActor(a))));
  add('acc:readNotification', wrapSync((id, a) => s.markNotificationRead(id, accActor(a))));
  add('acc:purchaseOrders', wrapSync((a) => s.listPurchaseOrders(accActor(a))));
  add('acc:payroll', wrapSync((a) => s.listPayrollSummary(accActor(a))));
  add('acc:integrate', wrapSync((payload) => {
    const central = require('../electron/services/accounting-central');
    return central.runIntegratePayload(payload || {});
  }));
  add('acc:flushIntegrations', wrapSync(() => {
    requireUserSession(['owner', 'manager']);
    const central = require('../electron/services/accounting-central');
    return central.flushIntegrationOutbox();
  }));
  add('acc:reflushFailedIntegrations', wrapSync(() => {
    requireUserSession(['owner', 'manager']);
    const central = require('../electron/services/accounting-central');
    return central.reflushFailedIntegrations();
  }));
  add('acc:ensureSchema', wrapSync(() => {
    requireUserSession(['owner']);
    const { getDb } = require('../electron/database/db');
    const { ensureAccSchema } = require('../electron/database/ensure-pg-schema');
    const { ensurePgMigrations } = require('../electron/database/ensure-pg-migrations');
    const db = getDb();
    try {
      db.prepare(`DELETE FROM pg_schema_migrations WHERE name LIKE '%accounting%'`).run();
    } catch (_) { /* */ }
    const migrations = ensurePgMigrations(db);
    const accounting = ensureAccSchema(db);
    let accOk = false;
    try {
      accOk = !!db.prepare(`
        SELECT 1 AS ok FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'acc_settings' LIMIT 1
      `).get()?.ok;
    } catch (_) { /* */ }
    return { migrations, accounting, acc_settings: accOk };
  }));

  const dp = require('../electron/services/delivery-platform');

  add('delivery:dashboard', wrapSync((f, a) => {
    const user = requireUserSession(['owner', 'manager', 'supervisor', 'assistant_manager', 'delivery_manager']);
    return dp.deliveryDashboard(f || {}, user);
  }));
  add('delivery:list', wrapSync((f, a) => {
    const user = requireUserSession(['owner', 'manager', 'supervisor', 'assistant_manager', 'cashier', 'delivery_manager']);
    const { assertUserPermission } = require('../electron/services/authz');
    assertUserPermission(user, 'delivery', ['owner', 'manager', 'supervisor', 'assistant_manager', 'cashier', 'delivery_manager']);
    return dp.listDeliveries(f || {}, user);
  }));
  add('delivery:get', wrapSync((id, a) => {
    requireUserSession(['owner', 'manager', 'supervisor', 'assistant_manager', 'delivery_manager']);
    return dp.getDelivery(id);
  }));
  add('delivery:drivers', wrapSync((f, a) => {
    requireUserSession(['owner', 'manager', 'supervisor', 'assistant_manager', 'delivery_manager']);
    return dp.listDrivers(f || {});
  }));
  add('delivery:getDriver', wrapSync((id, a) => {
    requireUserSession(['owner', 'manager', 'supervisor', 'assistant_manager', 'delivery_manager']);
    return dp.getDriver(id);
  }));
  add('delivery:saveDriver', wrapSync((d, a) => {
    const user = requireUserSession(['owner', 'manager', 'supervisor', 'delivery_manager']);
    return dp.saveDriver(d || {}, user);
  }));
  add('delivery:approveDriver', wrapSync((id, a) => {
    const user = requireUserSession(['owner', 'manager', 'delivery_manager']);
    return dp.approveDriver(id, user);
  }));
  add('delivery:rejectDriver', wrapSync((id, reason, a) => {
    const user = requireUserSession(['owner', 'manager', 'delivery_manager']);
    return dp.rejectDriver(id, reason, user);
  }));
  add('delivery:registerDriver', wrapSync((d) => dp.registerDriver(d || {})));
  add('delivery:adminRegisterDriver', wrapSync((d, a) => {
    const user = requireUserSession(['owner', 'manager', 'supervisor', 'delivery_manager']);
    return dp.adminRegisterDriver(d || {}, user);
  }));
  add('delivery:releaseToPool', wrapSync((id, a) => {
    const user = requireUserSession(['owner', 'manager', 'supervisor', 'assistant_manager', 'delivery_manager']);
    return dp.releaseToDriverPool(id, user);
  }));
  add('delivery:assign', wrapSync((id, driverId, a, opts) => {
    const user = requireUserSession(['owner', 'manager', 'supervisor', 'assistant_manager', 'delivery_manager']);
    return dp.assignDriver(id, driverId, user, opts || {});
  }));
  add('delivery:autoAssign', wrapSync((id, a) => {
    const user = requireUserSession(['owner', 'manager', 'supervisor', 'assistant_manager', 'delivery_manager']);
    return dp.autoAssignDriver(id, user);
  }));
  add('delivery:updateStatus', wrapSync((id, status, notes, a) => {
    const user = requireUserSession(['owner', 'manager', 'supervisor', 'assistant_manager', 'cashier', 'delivery_manager']);
    return dp.updateDeliveryStatus(id, status, user, { notes });
  }));
  add('delivery:updateDelivery', wrapSync((id, data, a) => {
    const user = requireUserSession(['owner', 'manager', 'supervisor', 'delivery_manager']);
    return dp.updateDeliveryAdmin(id, data || {}, user);
  }));
  add('delivery:cancelDelivery', wrapSync((id, a) => {
    const user = requireUserSession(['owner', 'manager', 'supervisor', 'delivery_manager']);
    return dp.cancelDeliveryAdmin(id, user);
  }));
  add('delivery:settings', wrapSync((a) => {
    requireUserSession(['owner', 'manager', 'delivery_manager']);
    return dp.getSettings();
  }));
  add('delivery:saveSettings', wrapSync((d, a) => {
    const user = requireUserSession(['owner', 'manager', 'delivery_manager']);
    return dp.saveSettings(d || {}, user);
  }));
  add('delivery:branchSettings', wrapSync((branchId, a) => {
    requireUserSession(['owner', 'manager', 'supervisor', 'delivery_manager']);
    return dp.getBranchSettings(branchId);
  }));
  add('delivery:saveBranchSettings', wrapSync((branchId, d, a) => {
    const user = requireUserSession(['owner', 'manager', 'supervisor']);
    return dp.saveBranchSettings(branchId, d || {}, user);
  }));
  add('delivery:listBranchSettings', wrapSync((a) => {
    requireUserSession(['owner', 'manager', 'supervisor', 'delivery_manager']);
    return dp.listAllBranchSettings();
  }));
  add('delivery:deleteBranchSettings', wrapSync((branchId, a) => {
    const user = requireUserSession(['owner', 'manager']);
    return dp.deleteBranchSettings(branchId, user);
  }));
  add('delivery:assignMultiple', wrapSync((orderIds, driverId, a, opts) => {
    const user = requireUserSession(['owner', 'manager', 'supervisor', 'assistant_manager', 'delivery_manager']);
    return dp.assignMultipleOrders(orderIds, driverId, user, opts || {});
  }));
  add('delivery:suspendDriver', wrapSync((id, a) => {
    const user = requireUserSession(['owner', 'manager', 'supervisor']);
    return dp.suspendDriver(id, user);
  }));
  add('delivery:deleteDriver', wrapSync((id, a) => {
    const user = requireUserSession(['owner', 'manager']);
    return dp.deleteDriver(id, user);
  }));
  add('delivery:driverEarnings', wrapSync((driverId, f, a) => {
    requireUserSession(['owner', 'manager', 'delivery_manager']);
    return dp.driverEarningsReport(driverId, f || {});
  }));
  add('delivery:reports', wrapSync((f, a) => {
    const user = requireUserSession(['owner', 'manager', 'delivery_manager']);
    return dp.deliveryReports(f || {}, user);
  }));
  add('delivery:tracking', wrapSync((token) => dp.getDeliveryByTracking(token)));

  add('driver:login', wrapSync((username, password, device) => dp.driverLogin(username, password, device || {})));
  add('driver:logout', wrapSync((token) => dp.driverLogout(token)));
  add('driver:dashboard', wrapSync((token) => dp.driverDashboard(token)));
  add('driver:orders', wrapSync((token, f) => dp.driverListOrders(token, f || {})));
  add('driver:history', wrapSync((token, f) => dp.driverHistory(token, f || {})));
  add('driver:earnings', wrapSync((token, f) => dp.driverEarnings(token, f || {})));
  add('driver:payments', wrapSync((token, f) => dp.driverPayments(token, f || {})));
  add('driver:profile', wrapSync((token) => dp.driverGetProfile(token)));
  add('driver:updateProfile', wrapSync((token, data) => dp.driverUpdateProfile(token, data || {})));
  add('delivery:driverPaymentSummary', wrapSync((actor) => dp.listDriverPaymentSummary(actor)));
  add('delivery:recordDriverPayout', wrapSync((driverId, data, actor) => dp.recordDriverPayout(driverId, data || {}, actor)));
  add('delivery:driverPayoutHistory', wrapSync((driverId, filters, actor) => dp.getDriverPayoutHistory(driverId, filters || {}, actor)));
  add('delivery:previewDriverPayout', wrapSync((driverId, data, actor) => {
    requireUserSession(['owner', 'manager', 'supervisor', 'delivery_manager']);
    const d = data || {};
    return dp.previewDriverPayout(driverId, d.period_from || d.from, d.period_to || d.to, actor);
  }));
  add('delivery:driverPayoutDetail', wrapSync((payoutId, actor) => {
    requireUserSession(['owner', 'manager', 'supervisor', 'delivery_manager']);
    return dp.getDriverPayoutDetail(payoutId, actor);
  }));
  add('delivery:driverPayoutPdf', wrapSync((payoutId, actor) => {
    requireUserSession(['owner', 'manager', 'supervisor', 'delivery_manager']);
    const buf = dp.buildDriverPayoutPdf(payoutId, actor);
    return { pdf: buf.toString('base64'), mime: 'application/pdf', filename: `driver-payment-${payoutId}.pdf` };
  }));
  add('driver:payoutDetail', wrapSync((token, payoutId) => dp.driverPayoutDetailForDriver(token, payoutId)));
  add('driver:payoutPdf', wrapSync((token, payoutId) => {
    const buf = dp.buildDriverPayoutPdfForDriver(token, payoutId);
    return { pdf: buf.toString('base64'), mime: 'application/pdf', filename: `my-payment-${payoutId}.pdf` };
  }));
  add('delivery:driverOwed', wrapSync((driverId, filters, actor) => {
    requireUserSession(['owner', 'manager', 'supervisor', 'delivery_manager']);
    return dp.driverOwedAmount(driverId, filters || {});
  }));
  add('driver:submitClaim', wrapSync((token) => dp.submitPayoutClaim(token)));
  add('delivery:listPayoutClaims', wrapSync((f, a) => {
    const user = requireUserSession(['owner', 'manager', 'supervisor', 'delivery_manager']);
    return dp.listPayoutClaims(f || {}, user);
  }));
  add('delivery:approvePayoutClaim', wrapSync((id, notes, a) => {
    const user = requireUserSession(['owner', 'manager', 'supervisor']);
    return dp.approvePayoutClaim(id, user, notes || '');
  }));
  add('delivery:rejectPayoutClaim', wrapSync((id, reason, a) => {
    const user = requireUserSession(['owner', 'manager', 'supervisor']);
    return dp.rejectPayoutClaim(id, user, reason || '');
  }));
  add('driver:accept', wrapSync((token, id) => dp.driverAcceptDelivery(token, id)));
  add('driver:reject', wrapSync((token, id, reason) => dp.driverRejectDelivery(token, id, reason)));
  add('driver:release', wrapSync((token, id, reason) => dp.driverReleaseDelivery(token, id, reason)));
  add('driver:updateStatus', wrapSync((token, id, status, notes) => dp.driverUpdateStatus(token, id, status, { notes })));
  add('driver:availability', wrapSync((token, availability) => dp.setDriverAvailability(token, availability)));

  const ref = require('../electron/services/referral-commission');
  add('referral:dashboard', wrapSync((f, a) => ref.getAdminDashboard(f || {}, a || requireUserSession(['owner', 'manager', 'assistant_manager']))));
  add('referral:applications', wrapSync((f, a) => ref.listApplications(f || {}, a || requireUserSession(['owner', 'manager', 'assistant_manager']))));
  add('referral:getAgent', wrapSync((id, a, opts) => ref.getAgent(id, a || requireUserSession(['owner', 'manager', 'assistant_manager']), opts || {})));
  add('referral:approveAgent', wrapSync((id, a, opts) => ref.approveAgent(id, a || requireUserSession(['owner', 'manager', 'assistant_manager']), opts || {})));
  add('referral:rejectAgent', wrapSync((id, reason, a) => ref.rejectAgent(id, reason, a || requireUserSession(['owner', 'manager', 'assistant_manager']))));
  add('referral:underReview', wrapSync((id, a) => ref.setUnderReview(id, a || requireUserSession(['owner', 'manager', 'assistant_manager']))));
  add('referral:suspendAgent', wrapSync((id, a) => ref.suspendAgent(id, a || requireUserSession(['owner', 'manager', 'assistant_manager']))));
  add('referral:unsuspendAgent', wrapSync((id, a) => ref.unsuspendAgent(id, a || requireUserSession(['owner', 'manager', 'assistant_manager']))));
  add('referral:updateAgent', wrapSync((id, d, a) => ref.updateAgent(id, d || {}, a || requireUserSession(['owner', 'manager', 'assistant_manager']))));
  add('referral:deleteAgent', wrapSync((id, a) => ref.deleteAgent(id, a || requireUserSession(['owner', 'manager', 'assistant_manager']))));
  add('referral:clearAttribution', wrapSync((d, a) => ref.clearCustomerAttribution(d || {}, a || requireUserSession(['owner', 'manager', 'assistant_manager', 'cashier', 'supervisor']))));
  add('referral:clearSaleReferral', wrapSync((saleId, a) => ref.clearSaleReferral(saleId, a || requireUserSession(['owner', 'manager', 'assistant_manager', 'cashier', 'supervisor']))));
  add('referral:awardCommission', wrapSync((id, d, a) => ref.awardManualCommission(id, d || {}, a || requireUserSession(['owner', 'manager', 'assistant_manager']))));
  add('referral:listAwardRequests', wrapSync((f, a) => ref.listAwardRequests(f || {}, a || requireUserSession(['owner', 'manager', 'assistant_manager']))));
  add('referral:getAwardRequest', wrapSync((id, a) => ref.getAwardRequest(id, a || requireUserSession(['owner', 'manager', 'assistant_manager']))));
  add('referral:decideAwardRequest', wrapSync((id, d, a) => ref.decideAwardRequest(id, d || {}, a || requireUserSession(['owner', 'assistant_manager']))));
  add('referral:searchCodes', wrapSync((q) => ref.searchReferralCodes(q)));
  add('referral:agents', wrapSync((f, a) => ref.listAgents(f || {}, a || requireUserSession(['owner', 'manager', 'assistant_manager']))));
  add('referral:commissions', wrapSync((f, a) => ref.listCommissions(f || {}, a || requireUserSession(['owner', 'manager', 'assistant_manager']))));
  add('referral:approveCommission', wrapSync((id, a) => ref.approveCommission(id, a || requireUserSession(['owner', 'manager', 'assistant_manager']))));
  add('referral:markAvailable', wrapSync((a) => ref.markCommissionsAvailable(a || requireUserSession(['owner', 'manager', 'assistant_manager']))));
  add('referral:payouts', wrapSync((f, a) => ref.listPayouts(f || {}, a || requireUserSession(['owner', 'manager', 'assistant_manager']))));
  add('referral:getPayout', wrapSync((id, a) => ref.getPayout(id, a || requireUserSession(['owner', 'manager', 'assistant_manager']))));
  add('referral:generatePayout', wrapSync((d, a) => ref.generatePayoutBatch(d || {}, a || requireUserSession(['owner', 'manager', 'assistant_manager']))));
  add('referral:approvePayout', wrapSync((id, a) => ref.approvePayout(id, a || requireUserSession(['owner', 'manager', 'assistant_manager']))));
  add('referral:markPayoutPaid', wrapSync((id, d, a) => ref.markPayoutPaid(id, d || {}, a || requireUserSession(['owner', 'manager', 'assistant_manager']))));
  add('referral:claimWallet', wrapSync((a) => ref.claimWalletPayout(a || requireUserSession(['owner', 'manager', 'assistant_manager', 'referral_agent']))));
  add('referral:getPayslip', wrapSync((id, a) => ref.getAgentPayslip(id, a || requireUserSession(['owner', 'manager', 'assistant_manager', 'referral_agent']))));
  add('referral:settings', wrapSync((a) => { requireUserSession(['owner', 'manager', 'assistant_manager']); return ref.getSettings(); }));
  add('referral:updateSettings', wrapSync((d, a) => ref.updateSettings(d || {}, a || requireUserSession(['owner', 'manager', 'assistant_manager']))));
  add('referral:attributions', wrapSync((f, a) => ref.listAttributions(f || {}, a || requireUserSession(['owner', 'manager', 'assistant_manager']))));
  add('referral:codes', wrapSync((a) => ref.listCodes(a || requireUserSession(['owner', 'manager', 'assistant_manager']))));
  add('referral:topAgents', wrapSync((f, a) => ref.getTopAgents(f || {}, a || requireUserSession(['owner', 'manager', 'assistant_manager']))));
  add('referral:audit', wrapSync((f, a) => ref.listAudit(f || {}, a || requireUserSession(['owner', 'manager', 'assistant_manager']))));
  add('referral:fraud', wrapSync((a) => ref.listFraud(a || requireUserSession(['owner', 'manager', 'assistant_manager']))));
  add('referral:approveBankChange', wrapSync((id, a) => ref.approveBankChange(id, a || requireUserSession(['owner', 'manager', 'assistant_manager']))));
  add('referral:apply', wrapSync((d) => ref.applyAsAgent(d || {})));
  add('referral:agentDashboard', wrapSync((a) => ref.getAgentDashboard(a || requireUserSession(['owner', 'manager', 'assistant_manager', 'referral_agent']))));
  add('referral:unreadNotifications', wrapSync((f, a) => ref.listUnreadNotifications(f || {}, a || requireUserSession(['owner', 'manager', 'assistant_manager', 'supervisor', 'referral_agent']))));
  add('referral:ackNotification', wrapSync((id, meta, a) => ref.ackReferralNotification(id, meta || {}, a || requireUserSession(['owner', 'manager', 'assistant_manager', 'supervisor', 'referral_agent']))));
  add('referral:ackAllNotifications', wrapSync((f, a) => ref.ackAllReferralNotifications(f || {}, a || requireUserSession(['owner', 'manager', 'assistant_manager', 'supervisor', 'referral_agent']))));
  add('referral:requestBankChange', wrapSync((d, a) => ref.requestBankChange(d || {}, a || requireUserSession(['referral_agent', 'owner', 'manager']))));
  add('referral:validateCode', wrapSync((code) => ref.validateReferralCode(code)));
  add('referral:recordClick', wrapSync((code, meta) => ref.recordClick(code, meta || {})));
  add('referral:attribute', wrapSync((d, a) => ref.attributeCustomer({ ...(d || {}), actor: a || requireUserSession(['owner', 'manager']) })));
  add('referral:resetAgentPassword', wrapSync((id, a, opts) => ref.adminResetAgentPassword(id, a || requireUserSession(['owner', 'manager', 'assistant_manager']), opts || {})));
  add('referral:ensureAgentLogin', wrapSync((id, a) => {
    a || requireUserSession(['owner', 'manager', 'assistant_manager']);
    const { getDb } = require('../electron/database/db');
    const agent = getDb().prepare('SELECT * FROM referral_agents WHERE id=?').get(id);
    if (!agent) throw new Error('Agent not found');
    if (!agent.password_hash) throw new Error('No password on file — use Reset password (WhatsApp) first');
    ref.ensureAgentUserAccount(agent);
    return { success: true, username: agent.username };
  }));

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

  add('firstOnlineGift:get', wrapSync((actor) => require('../electron/services/first-online-gift').getCampaign(actor || s.getUserSession?.())));
  add('firstOnlineGift:save', wrapSync((data, actor) => require('../electron/services/first-online-gift').saveCampaign(data || {}, actor || s.getUserSession?.())));
  add('firstOnlineGift:dashboard', wrapSync((filters, actor) => require('../electron/services/first-online-gift').getDashboard(filters || {}, actor || s.getUserSession?.())));
  add('firstOnlineGift:winners', wrapSync((filters, actor) => require('../electron/services/first-online-gift').listWinners(filters || {}, actor || s.getUserSession?.())));
  add('firstOnlineGift:selfTest', wrapSync((actor) => require('../electron/services/first-online-gift').runSelfTest(actor || s.getUserSession?.())));

  const payGw = () => require('../electron/services/payment-gateway');
  add('paymentGateways:list', wrapSync((actor) => {
    const user = requireUserSession(['owner', 'manager']);
    return payGw().listGateways(actor || user);
  }));
  add('paymentGateways:save', wrapSync((provider, data, actor) => {
    const user = requireUserSession(['owner', 'manager']);
    return payGw().saveGateway(provider, data || {}, actor || user);
  }));
  add('paymentGateways:test', wrapAsync(async (provider, actor) => {
    const user = requireUserSession(['owner', 'manager']);
    return payGw().testConnection(provider, actor || user);
  }));
  add('paymentGateways:registerWebhook', wrapAsync(async (provider, actor) => {
    const user = requireUserSession(['owner', 'manager']);
    return payGw().registerWebhook(provider, actor || user);
  }));
  add('paymentGateways:listTransactions', wrapSync((filters, actor) => {
    const user = requireUserSession(['owner', 'manager']);
    return payGw().listTransactions(filters || {}, actor || user);
  }));
  add('paymentGateways:refund', wrapAsync(async (txnId, amount, actor) => {
    const user = requireUserSession(['owner', 'manager']);
    return payGw().refundTransaction(txnId, amount, actor || user);
  }));
  add('web:startOnlinePayment', wrapAsync(async (orderId, token, opts) => {
    return payGw().createPaymentForOrder(orderId, token, opts || {});
  }));
  add('web:getPaymentStatus', wrapSync((orderRef, token) => {
    return payGw().publicPaymentStatus(orderRef, token);
  }));

  add('rewards:getRules', wrapSync(() => s.getRewardRules()));
  add('rewards:saveRule', wrapSync((data, a) => s.saveRewardRule(data, a)));
  add('rewards:deleteRule', wrapSync((id, a) => s.deleteRewardRule(id, a)));

  add('branches:get', wrapSync(() => (s.getBranchesDetailed ? s.getBranchesDetailed() : s.getBranches())));
  add('branches:getActive', wrapSync(() => s.getActiveBranch()));
  add('branches:getView', wrapSync(() => s.getViewBranch()));
  add('branches:setView', wrapSync((id, a) => {
    s.requireActor(a || s.getUserSession?.(), ['owner', 'manager']);
    return s.setViewBranch(id);
  }));
  add('branches:delete', wrapSync((id, a) => {
    const user = s.requireActor(a, ['owner']);
    return branchesSvc.deleteBranch(id, user);
  }));
  add('branches:listTills', wrapSync((branchId) => branchesSvc.listBranchTills(branchId)));
  add('branches:saveTill', wrapSync((branchId, data, a) => {
    s.requireActor(a, ['owner', 'manager']);
    return branchesSvc.saveBranchTill(branchId, data || {});
  }));
  add('branches:updateTill', wrapSync((branchId, deviceId, patch, a) => {
    s.requireActor(a, ['owner', 'manager']);
    return branchesSvc.updateBranchTill(branchId, deviceId, patch || {});
  }));
  add('branches:deleteTill', wrapSync((branchId, deviceId, a) => {
    s.requireActor(a, ['owner', 'manager']);
    return branchesSvc.deleteBranchTill(branchId, deviceId);
  }));
  add('web:adminOrderDetail', wrapSync((orderId, actor) => {
    requireUserSession(['owner', 'manager', 'supervisor', 'assistant_manager']);
    return web.getAdminOrderDetail(orderId, actor);
  }));
  add('web:adminUpdateOrder', wrapSync((orderId, patch, actor) => {
    const user = requireUserSession(['owner', 'manager']);
    return web.updateAdminOrder(orderId, patch || {}, actor || user);
  }));
  add('web:adminDeleteOrder', wrapSync((orderId, reason, actor) => {
    const user = requireUserSession(['owner', 'manager']);
    return web.deleteAdminOrder(orderId, reason, actor || user);
  }));
  add('branches:save', wrapSync((data, a) => {
    s.requireActor(a || s.getUserSession?.(), ['owner', 'manager']);
    return s.saveBranch(data);
  }));
  add('branches:setActive', wrapSync((id, a) => {
    s.requireActor(a || s.getUserSession?.(), ['owner', 'manager']);
    return s.setActiveBranch(id);
  }));
  add('branches:saveSettings', wrapSync((id, data, a) => {
    s.requireActor(a || s.getUserSession?.(), ['owner', 'manager']);
    return s.saveBranchSettings(id, data || {});
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
  add('sync:importCloudOrders', wrapSync((orders) => s.importCloudOrders(orders || [])));
  add('sync:updateOnlineOrder', wrapAsync(async (id, st, opts) => {
    requireUserSession(['owner', 'manager', 'supervisor', 'cashier']);
    return s.updateOnlineOrderStatus(id, st, opts || {});
  }));
  add('sync:rejectOnlineOrder', wrapAsync(async (id, reason) => {
    const user = requireUserSession(['owner', 'manager', 'supervisor', 'cashier']);
    return s.rejectOnlineOrder(id, reason, user);
  }));
  add('sync:acceptOnlineOrder', wrapAsync(async (id, opts) => {
    const user = requireUserSession(['owner', 'manager', 'supervisor', 'cashier']);
    return s.acceptOnlineOrderAsSale(id, user, opts || {});
  }));

  add('audit:salesList', wrapSync(f => { requireSession(); return s.getUnifiedSalesList(f); }));
  add('audit:searchSales', wrapSync(f => s.searchSalesExplorer(f)));
  add('audit:voidSale', wrapSync((id, r, a, code) => {
    const user = s.requireActor(a, ['owner', 'manager', 'cashier', 'supervisor', 'assistant_manager']);
    if (user.role === 'cashier') s.verifySupervisorCode(code, 'void');
    return s.voidSale(id, r, user.id, user.full_name);
  }));
  add('audit:updateSale', wrapSync((id, patch, a) => {
    const user = s.requireActor(a, ['owner', 'manager']);
    return s.updateSaleRecord(id, patch || {}, user.id, user.full_name);
  }));
  add('audit:deleteSale', wrapSync((id, reason, a) => {
    const user = s.requireActor(a, ['owner', 'manager']);
    if (user.role !== 'owner') {
      let perms = {};
      try { perms = JSON.parse(user.permissions || '{}'); } catch (_) { /* ignore */ }
      if (!perms.delete_sales) throw new Error('Permission denied — delete sales');
    }
    return s.deleteSaleRecord(id, reason, user.id, user.full_name);
  }));
  add('audit:deleteSalesBulk', wrapSync((ids, reason, a) => {
    const user = s.requireActor(a, ['owner', 'manager']);
    if (user.role !== 'owner') {
      let perms = {};
      try { perms = JSON.parse(user.permissions || '{}'); } catch (_) { /* ignore */ }
      if (!perms.delete_sales) throw new Error('Permission denied — delete sales');
    }
    return s.deleteSalesBulk(ids, reason, user.id, user.full_name);
  }));
  add('audit:soldProducts', wrapSync((f, t) => s.getSoldProductsReport(f, t)));
  add('audit:lowPerformance', wrapSync(d => s.getLowPerformanceProducts(d)));
  add('audit:returnDetail', wrapSync(id => s.getReturnDetail(id)));
  add('audit:returnsList', wrapSync(f => s.getReturnsList(f)));
  add('audit:priceHistory', wrapSync(l => s.getPriceChangeHistory(l)));
  add('audit:timeline', wrapSync((f, t) => s.getActivityTimeline(f, t)));
  add('audit:exceptions', wrapSync((f, t) => s.getExceptionReport(f, t)));
  add('audit:alerts', wrapSync(() => s.getAdminAlerts()));
  add('audit:dashboard', wrapSync((f, t) => {
    const sess = s.getUserSession();
    const scope = s.resolveBranchScope(sess);
    const branchId = scope.allBranches ? null : scope.branchId;
    return s.getAdminDashboardFull(f, t, branchId);
  }));
  add('audit:dailyClosing', wrapSync(d => s.getDailyClosingReport(d)));
  add('audit:customerSummary', wrapSync(id => s.getCustomerPurchaseSummary(id)));
  add('audit:topCustomers', wrapSync((f, t, l) => s.getTopCustomers(f, t, l)));
  add('audit:returnReasons', wrapSync((f, t) => s.getReturnReasonsReport(f, t)));
  add('audit:reopenReturn', wrapSync((id, a) => {
    const user = s.requireActor(a, ['owner']);
    return s.reopenReturn(id, user.id, user.full_name);
  }));

  add('db:health', wrapSync(() => { requireSession(); return s.getDatabaseHealth(); }));
  add('db:storageMonitor', wrapAsync(async (opts, a) => {
    const actor = a || requireSession();
    s.requireActor(actor, ['owner', 'manager', 'assistant_manager']);
    const storage = require('../electron/services/system-storage');
    storage.ensureSchema();
    return storage.getStorageMonitor(opts || {});
  }));
  add('db:storageSnapshot', wrapAsync(async (a) => {
    const actor = a || requireSession();
    s.requireActor(actor, ['owner', 'manager', 'assistant_manager']);
    const storage = require('../electron/services/system-storage');
    return storage.recordStorageSnapshot();
  }));
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

  const web = require('../electron/services/online-ordering');
  add('web:getSettings', wrapSync(() => web.getGlobalSettings()));
  add('web:getHoursStatus', wrapSync(() => web.getHoursStatus()));
  add('web:trackEvents', wrapSync((payload) => {
    const analytics = require('../electron/services/web-analytics');
    return analytics.trackEvents(payload || {});
  }));
  add('web:visitorDashboard', wrapSync((filters, actor) => {
    const user = requireUserSession(['owner', 'manager', 'supervisor']);
    return require('../electron/services/web-analytics').getVisitorDashboard(filters || {}, actor || user);
  }));
  add('web:onlineCustomers', wrapSync((filters, actor) => {
    const user = requireUserSession(['owner', 'manager', 'supervisor']);
    return require('../electron/services/web-analytics').listOnlineCustomers(filters || {}, actor || user);
  }));
  add('web:getBranches', wrapSync(() => web.getPublicBranches()));
  add('web:getMenu', wrapSync((branchId, filters) => web.getBranchMenu(branchId, filters || {})));
  add('web:getProduct', wrapSync((branchId, productId) => web.getProductDetail(branchId, productId)));
  add('web:checkRegistration', wrapSync((data) => web.checkWebRegistration(data || {})));
  add('web:sendRegistrationCode', wrapAsync((data) => web.sendWebRegistrationCode(data || {})));
  add('web:register', wrapSync((data) => web.registerWebCustomer(data || {})));
  add('web:login', wrapSync((login, password) => web.loginWebCustomer(login, password)));
  add('web:sendPasswordReset', wrapAsync((data) => web.sendWebPasswordReset(data || {})));
  add('web:resetPassword', wrapSync((data) => web.resetWebPassword(data || {})));
  add('web:account', wrapSync((token) => web.getCustomerAccount(token)));
  add('web:validateCart', wrapSync((branchId, cart) => web.validateCart(branchId, cart || {})));
  add('web:validateCoupon', wrapSync((code, branchId, cart, customerId) => web.validateCoupon(code, branchId, cart || {}, customerId)));
  add('web:initiateCardPayment', wrapSync((branchId, amount, token, method) => {
    const customer = token ? web.resolveWebCustomer(token) : null;
    return web.createCardPaymentIntent(amount, branchId, customer?.id || null, method || 'card');
  }));
  add('web:confirmCardPayment', wrapSync((intentToken, reference) => web.verifyCardPaymentIntent(intentToken, reference)));
  add('web:submitOrder', wrapSync((branchId, payload, token, idem) => web.submitOrder(branchId, payload || {}, token, idem)));
  add('web:getOrder', wrapSync((orderId, token) => web.getOrder(orderId, token)));
  add('web:listOrders', wrapSync((token, limit) => web.listCustomerOrders(token, limit)));
  add('web:toggleFavorite', wrapSync((token, productId, branchId) => web.toggleFavorite(token, productId, branchId)));
  add('web:checkGiftCard', wrapSync((code, token) => web.checkGiftCardForWeb(code, token)));
  add('web:deleteAccount', wrapSync((token, password) => web.deleteWebCustomerAccount(token, password)));
  add('web:submitIssue', wrapSync((data, token) => web.submitCustomerIssue(data || {}, token)));
  add('web:listMyIssues', wrapSync((token) => web.listMyCustomerIssues(token)));
  add('web:listIssues', wrapSync((f, a) => web.listCustomerIssues(f || {}, a)));
  add('web:getIssue', wrapSync((id, a) => web.getCustomerIssue(id, a)));
  add('web:replyIssue', wrapSync((id, reply, a) => web.replyCustomerIssue(id, reply, a)));
  add('web:adminOrders', wrapSync((filters, actor) => {
    const user = requireUserSession(['owner', 'manager', 'supervisor', 'assistant_manager', 'cashier']);
    return web.listAdminOrders(filters || {}, actor || user);
  }));
  
add('web:adminAnalytics', wrapSync((filters, actor) => {
    requireUserSession(['owner', 'manager']);
    return web.getOnlineAnalytics(filters || {});
  }));
  add('web:rejectedOrdersReport', wrapSync((filters, actor) => {
    requireUserSession(['owner', 'manager', 'supervisor']);
    return web.listRejectedOrdersReport(filters || {});
  }));
  add('auth:recoverDriverPassword', wrapSync((identifier) => {
    const recovery = require('../electron/services/panel-password-recovery');
    return recovery.recoverDriverPassword(identifier);
  }));
  add('auth:recoverReferralAgentPassword', wrapSync((identifier) => {
    const recovery = require('../electron/services/panel-password-recovery');
    return recovery.sendReferralAgentResetCode(identifier);
  }));
  add('auth:resetReferralAgentPassword', wrapSync((data) => {
    const recovery = require('../electron/services/panel-password-recovery');
    return recovery.resetReferralAgentPassword(data || {});
  }));
  add('auth:recoverAdminPassword', wrapSync((identifier) => {
    const recovery = require('../electron/services/panel-password-recovery');
    return recovery.recoverAdminPassword(identifier);
  }));
  add('web:saveGlobalSettings', wrapSync((data, actor) => {
    const user = requireUserSession(['owner', 'manager']);
    if (isServerCloudRpc() && user.role !== 'owner') {
      const { assertUserPermission } = require('../electron/services/authz');
      assertUserPermission(user, 'system_settings');
    }
    return web.saveGlobalOnlineSettings(data || {}, actor);
  }));
  add('web:saveBranchSettings', wrapSync((branchId, data, actor) => {
    const user = requireUserSession(['owner', 'manager']);
    if (isServerCloudRpc() && user.role !== 'owner') {
      const { assertUserPermission } = require('../electron/services/authz');
      assertUserPermission(user, 'system_settings');
    }
    return web.saveBranchOnlineSettings(branchId, data || {}, actor);
  }));
  add('web:getBranchSettings', wrapSync((branchId) => web.getBranchOnlineSettings(branchId)));
  add('web:rejectOrder', wrapAsync(async (orderId, reason, actor) => {
    const user = requireUserSession(['owner', 'manager', 'supervisor', 'cashier']);
    return web.rejectOrder(orderId, reason, user);
  }));
  add('web:updateOrderStatus', wrapAsync(async (orderId, status, actor, opts) => {
    const user = requireUserSession(['owner', 'manager', 'supervisor', 'cashier']);
    return web.updateOrderStatus(orderId, status, user, opts || {});
  }));

  const mm = require('../electron/services/mobile-manager');
  add('mobile:login', wrapSync((username, password, deviceInfo) => mm.login(username, password, deviceInfo || {})));
  add('mobile:bootstrapAdmin', wrapSync((actor) => {
    const user = requireUserSession(['owner', 'manager', 'supervisor', 'assistant_manager']);
    return mm.bootstrapFromAdmin(user, { platform: 'admin', device_name: 'Admin Panel' });
  }));
  add('mobile:logout', wrapSync((token) => mm.logout(token)));
  add('mobile:profile', wrapSync((token) => mm.getProfile(token)));
  add('mobile:dashboard', wrapSync((token, filters) => mm.getDashboard(token, filters || {})));
  add('mobile:orders', wrapSync((token, filters) => mm.listOrders(token, filters || {})));
  add('mobile:onlineOrders', wrapSync((token, filters) => mm.listOnlineOrders(token, filters || {})));
  add('mobile:order', wrapSync((token, orderId) => mm.getOrder(token, orderId)));
  add('mobile:searchOrders', wrapSync((token, query) => mm.searchOrders(token, query || {})));
  add('mobile:staffActivity', wrapSync((token, filters) => mm.getStaffActivity(token, filters || {})));
  add('mobile:posStatus', wrapSync((token) => mm.getPosStatus(token)));
  add('mobile:alerts', wrapSync((token, arg) => {
    const opts = typeof arg === 'object' && arg !== null ? arg : { limit: arg || 50 };
    return mm.listAlerts(token, opts.limit || 50, opts);
  }));
  add('mobile:markRead', wrapSync((token, ids) => mm.markNotificationsRead(token, ids)));
  add('mobile:getPrefs', wrapSync((token) => mm.getNotificationPrefs(token)));
  add('mobile:savePrefs', wrapSync((token, prefs) => mm.saveNotificationPrefs(token, prefs)));
  add('mobile:registerPush', wrapSync((token, pushToken) => mm.registerPushToken(token, pushToken)));
  add('mobile:poll', wrapSync((token, sinceId) => mm.pollNotifications(token, sinceId)));
  add('mobile:heartbeat', wrapSync((branchId, deviceId, label) => mm.recordPosHeartbeat(branchId, deviceId, label)));
  add('mobile:adminListUsers', wrapSync((actor) => {
    requireUserSession(['owner', 'manager']);
    return mm.listMobileUsers();
  }));
  add('mobile:adminGetUser', wrapSync((id, actor) => {
    requireUserSession(['owner', 'manager']);
    return mm.getMobileUser(id);
  }));
  add('mobile:adminSaveUser', wrapSync((data, actor) => {
    requireUserSession(['owner', 'manager']);
    return mm.saveMobileUser(data || {});
  }));
  add('mobile:adminSetActive', wrapSync((id, active, actor) => {
    requireUserSession(['owner', 'manager']);
    return mm.setMobileUserActive(id, !!active);
  }));
  add('mobile:adminListDevices', wrapSync((userId, actor) => {
    requireUserSession(['owner', 'manager']);
    return mm.listMobileDevices(userId);
  }));
  add('mobile:adminRevokeDevice', wrapSync((deviceId, actor) => {
    requireUserSession(['owner', 'manager']);
    return mm.revokeMobileDevice(deviceId);
  }));

  // ─── Business Modules ───────────────────────────────────────────────────────
  const bizActor = (a) => a || requireSession();

  add('bizModules:settings', wrapSync((a) => {
    requireUserSession(['owner', 'manager']);
    return s.getBizModuleSettings?.();
  }));
  add('bizModules:saveSettings', wrapSync((d, a) => {
    requireUserSession(['owner']);
    return s.saveBizModuleSettings?.(d || {}, bizActor(a));
  }));
  add('bizModules:summary', wrapSync((a) => {
    requireUserSession(['owner', 'manager']);
    return s.bizModulesSummary?.();
  }));

  add('investor:login', wrapSync((u, p) => s.investorLogin(u, p)));
  add('investor:logout', wrapSync((tok) => s.investorLogout(tok)));
  add('investor:dashboard', wrapSync((tok) => s.investorDashboard(tok)));
  add('investor:list', wrapSync((f, a) => s.listInvestors(bizActor(a), f || {})));
  add('investor:get', wrapSync((id, a) => s.getInvestor(id, bizActor(a))));
  add('investor:save', wrapSync((d, a) => s.saveInvestor(d || {}, bizActor(a))));
  add('investor:createPortalUser', wrapSync((invId, d, a) => s.createInvestorPortalUser(invId, d || {}, bizActor(a))));
  add('investor:saveProposal', wrapSync((d, a) => s.saveProposal(d || {}, bizActor(a))));
  add('investor:listProposals', wrapSync((f, a) => s.listProposals(bizActor(a), f || {})));
  add('investor:proposalPdf', wrapSync((id, a) => s.buildProposalPdf(id, bizActor(a))));
  add('investor:saveAgreement', wrapSync((d, a) => s.saveAgreement(d || {}, bizActor(a))));
  add('investor:uploadDocument', wrapSync((d, a) => s.uploadInvestorDocument(d || {}, bizActor(a))));
  add('investor:recordPayment', wrapSync((d, a) => s.recordPayment(d || {}, bizActor(a))));
  add('investor:recordDistribution', wrapSync((d, a) => s.recordDistribution(d || {}, bizActor(a))));
  add('investor:summary', wrapSync((a) => {
    requireUserSession(['owner', 'manager']);
    return s.investorSummary?.();
  }));

  add('release:login', wrapSync((u, p) => s.releaseLogin(u, p)));
  add('release:logout', wrapSync((tok) => s.releaseLogout(tok)));
  add('release:dashboard', wrapSync((tok) => s.releaseDashboard(tok)));
  add('release:runTests', wrapAsync((tok, verId) => s.runFullSystemTest(tok, verId || null)));
  add('release:createVersion', wrapSync((tok, d) => s.createReleaseVersion(d || {}, tok)));
  add('release:approve', wrapAsync((tok, verId, confirm) => s.approveRelease(verId, tok, !!confirm)));
  add('release:publish', wrapAsync((tok, verId, confirm) => s.publishRelease(verId, tok, !!confirm)));
  add('release:listUsers', wrapSync((a) => s.listReleaseUsers(bizActor(a))));
  add('release:saveUser', wrapSync((d, a) => s.saveReleaseUser(d || {}, bizActor(a))));
  add('release:summary', wrapSync((a) => {
    requireUserSession(['owner', 'manager']);
    return s.releaseSummary?.();
  }));

  add('meeting:login', wrapSync((u, p) => s.meetingLogin(u, p)));
  add('meeting:logout', wrapSync((tok) => s.meetingLogout(tok)));
  add('meeting:list', wrapSync((tok, f) => s.listMeetings(tok, f || {})));
  add('meeting:get', wrapSync((tok, id) => s.getMeeting(id, tok)));
  add('meeting:save', wrapSync((tok, d) => s.saveMeeting(d || {}, tok)));
  add('meeting:start', wrapSync((tok, id) => s.startMeeting(id, tok)));
  add('meeting:stop', wrapSync((tok, id) => s.stopMeeting(id, tok)));
  add('meeting:saveRecording', wrapSync((tok, id, d) => s.saveRecording(id, tok, d || {})));
  add('meeting:saveTranscript', wrapSync((tok, id, segs) => s.saveTranscript(id, tok, segs)));
  add('meeting:processAi', wrapAsync((tok, id) => s.processMeetingAi(id, tok)));
  add('meeting:finalizeMinutes', wrapSync((tok, id) => s.finalizeMinutes(id, tok)));
  add('meeting:search', wrapSync((tok, q) => s.searchMeetings(tok, q)));
  add('meeting:ask', wrapAsync((tok, id, q) => s.askMeetingAi(id, tok, q)));
  add('meeting:listUsers', wrapSync((a) => s.listMeetingUsers(bizActor(a))));
  add('meeting:saveUser', wrapSync((d, a) => s.saveMeetingUser(d || {}, bizActor(a))));
  add('meeting:summary', wrapSync((a) => {
    requireUserSession(['owner', 'manager']);
    return s.meetingSummary?.();
  }));

  // ─── Platform Control (packages / add-ons) — Phase 3 definitions only ───────
  const platformActor = (tok) => s.platformRequireSession(tok);
  add('platform:status', wrapSync(() => s.platformStatus()));
  add('platform:login', wrapSync((u, p) => s.platformLogin(u, p)));
  add('platform:logout', wrapSync((tok) => s.platformLogout(tok)));
  add('platform:syncCatalog', wrapSync((tok) => {
    platformActor(tok);
    return s.platformSyncCatalog();
  }));
  add('platform:listModules', wrapSync((tok, f) => {
    platformActor(tok);
    return s.platformListModules(f || {});
  }));
  add('platform:validateModules', wrapSync((tok, ids) => {
    platformActor(tok);
    return s.platformValidateModules(ids || []);
  }));
  add('platform:listPackages', wrapSync((tok) => {
    platformActor(tok);
    return s.platformListPackages();
  }));
  add('platform:getPackage', wrapSync((tok, id) => {
    platformActor(tok);
    return s.platformGetPackage(id);
  }));
  add('platform:savePackage', wrapSync((tok, d) => {
    const a = platformActor(tok);
    return s.platformSavePackage(d || {}, a);
  }));
  add('platform:setPackageActive', wrapSync((tok, id, active) => {
    const a = platformActor(tok);
    return s.platformSetPackageActive(id, active, a);
  }));
  add('platform:deletePackage', wrapSync((tok, id) => {
    const a = platformActor(tok);
    return s.platformDeletePackage(id, a);
  }));
  add('platform:listAddons', wrapSync((tok) => {
    platformActor(tok);
    return s.platformListAddons();
  }));
  add('platform:saveAddon', wrapSync((tok, d) => {
    const a = platformActor(tok);
    return s.platformSaveAddon(d || {}, a);
  }));
  add('platform:deleteAddon', wrapSync((tok, id) => {
    const a = platformActor(tok);
    return s.platformDeleteAddon(id, a);
  }));
  add('platform:bootstrapLabSamples', wrapSync((tok) => {
    const a = platformActor(tok);
    return s.platformBootstrapLabSamples(a);
  }));
  add('platform:getShopAssignment', wrapSync((tok, key) => {
    platformActor(tok);
    return s.platformGetShopAssignment(key);
  }));
  add('platform:saveShopAssignment', wrapSync((tok, d) => {
    const a = platformActor(tok);
    return s.platformSaveShopAssignment(d || {}, a);
  }));
  add('platform:getEntitlements', wrapSync((tok) => {
    platformActor(tok);
    return s.platformGetEntitlements();
  }));
  add('platform:listShops', wrapSync((tok, f) => {
    platformActor(tok);
    return s.platformListShops(f || {});
  }));
  add('platform:getShop', wrapSync((tok, id) => {
    platformActor(tok);
    return s.platformGetShop(id);
  }));
  add('platform:createShop', wrapSync((tok, d) => {
    const a = platformActor(tok);
    return s.platformCreateShop(d || {}, a);
  }));
  add('platform:updateShop', wrapSync((tok, id, d) => {
    const a = platformActor(tok);
    return s.platformUpdateShop(id, d || {}, a);
  }));
  add('platform:deleteShop', wrapSync((tok, id) => {
    const a = platformActor(tok);
    return s.platformDeleteShop(id, a);
  }));
  add('platform:assignShop', wrapSync((tok, id, d) => {
    const a = platformActor(tok);
    return s.platformAssignShop(id, d || {}, a);
  }));
  add('platform:setShopOverrides', wrapSync((tok, id, overrides) => {
    const a = platformActor(tok);
    return s.platformSetShopOverrides(id, overrides || [], a);
  }));
  add('platform:setShopStatus', wrapSync((tok, id, status) => {
    const a = platformActor(tok);
    return s.platformSetShopStatus(id, status, a);
  }));
  add('platform:shopHealth', wrapAsync(async (tok, id) => {
    platformActor(tok);
    return s.platformShopHealth(id);
  }));
  add('platform:syncCustomerEntitlements', wrapAsync(async (tok, id) => {
    platformActor(tok);
    return s.platformSyncCustomerEntitlements(id);
  }));
  add('platform:shopAudit', wrapSync((tok, id, limit) => {
    platformActor(tok);
    return s.platformShopAudit(id, limit);
  }));
  add('platform:bootstrapLabCustomers', wrapSync((tok) => {
    const a = platformActor(tok);
    return s.platformBootstrapLabCustomers(a);
  }));
  add('platform:shopSuspension', wrapSync((tok) => {
    platformActor(tok);
    return s.platformShopSuspension();
  }));
  add('platform:provisionStatus', wrapSync((tok) => {
    platformActor(tok);
    return s.platformProvisionStatus();
  }));
  add('platform:provisionDryRun', wrapSync((tok, shopId) => {
    const a = platformActor(tok);
    return s.platformProvisionDryRun(shopId, a);
  }));
  add('platform:provisionRun', wrapAsync(async (tok, shopId) => {
    const a = platformActor(tok);
    return s.platformProvisionRun(shopId, a);
  }));
  add('platform:provisionJob', wrapSync((tok, id) => {
    platformActor(tok);
    return s.platformProvisionJob(id);
  }));
  add('platform:provisionJobs', wrapSync((tok, shopId) => {
    platformActor(tok);
    return s.platformProvisionJobs(shopId);
  }));

  // ─── Control plane (contracts / activation / devices / fees / notifications) ──
  add('platform:customerControl', wrapSync((tok, id) => {
    platformActor(tok);
    return s.platformCustomerControl(id);
  }));
  add('platform:countdown', wrapSync((tok, id) => {
    platformActor(tok);
    return s.platformCountdown(id);
  }));
  add('platform:shopAccess', wrapSync((tok, id) => {
    platformActor(tok);
    return s.platformShopAccess(id);
  }));
  add('platform:currentAccess', wrapSync(() => s.platformCurrentAccess()));
  add('platform:listContractVersions', wrapSync((tok) => {
    platformActor(tok);
    return s.platformListContractVersions();
  }));
  add('platform:getContractVersion', wrapSync((tok, id) => {
    platformActor(tok);
    return s.platformGetContractVersion(id);
  }));
  add('platform:getActiveContract', wrapSync((tok) => {
    platformActor(tok);
    return s.platformGetActiveContract();
  }));
  add('platform:createContractVersion', wrapSync((tok, d) => {
    const a = platformActor(tok);
    return s.platformCreateContractVersion(d || {}, a);
  }));
  add('platform:updateDraftContract', wrapSync((tok, id, d) => {
    const a = platformActor(tok);
    return s.platformUpdateDraftContract(id, d || {}, a);
  }));
  add('platform:publishContract', wrapSync((tok, id, d) => {
    const a = platformActor(tok);
    return s.platformPublishContract(id, d || {}, a);
  }));
  add('platform:previewContract', wrapSync((tok, id, shopId) => {
    platformActor(tok);
    return s.platformPreviewContract(id, shopId);
  }));
  add('platform:listContractAcceptances', wrapSync((tok, f) => {
    platformActor(tok);
    return s.platformListContractAcceptances(f || {});
  }));
  add('platform:contractTemplate', wrapSync((tok) => {
    platformActor(tok);
    return s.platformContractTemplate();
  }));
  add('platform:shopContract', wrapSync((tok, id) => {
    platformActor(tok);
    return s.platformShopContract(id);
  }));
  add('platform:acceptContract', wrapSync((tok, id, d) => {
    platformActor(tok);
    return s.platformAcceptContract(id, { ...(d || {}), require_signature: false }, {});
  }));
  add('platform:printContract', wrapSync((tok, id, acceptanceId) => {
    platformActor(tok);
    return s.platformPrintContract(id, acceptanceId);
  }));
  add('platform:shopFeeReport', wrapAsync(async (tok, id, f) => {
    platformActor(tok);
    return s.platformShopFeeReport(id, f || {});
  }));
  add('platform:createActivation', wrapAsync(async (tok, id, d) => {
    const a = platformActor(tok);
    return s.platformCreateActivation(id, d || {}, a);
  }));
  add('platform:listActivations', wrapSync((tok, id) => {
    platformActor(tok);
    return s.platformListActivations(id);
  }));
  add('platform:revokeActivation', wrapSync((tok, actId) => {
    const a = platformActor(tok);
    return s.platformRevokeActivation(actId, a);
  }));
  add('platform:regenerateActivation', wrapAsync(async (tok, id, d) => {
    const a = platformActor(tok);
    return s.platformRegenerateActivation(id, d || {}, a);
  }));
  // Public redeem — no platform session (installer / app activation). Still shop-scoped + hashed secrets.
  add('activation:redeem', wrapSync((d) => s.platformRedeemActivation(d || {})));
  add('activation:acceptContract', wrapSync((shopId, d) => s.platformAcceptContract(shopId, {
    ...(d || {}),
    require_signature: true
  }, {
    ip_hint: d?.ip_hint,
    user_agent_hint: d?.user_agent_hint
  })));
  add('activation:getContext', wrapSync((d) => s.platformGetActivationContext(d || {})));
  add('license:validate', wrapSync((d) => s.platformValidateLicense(d || {})));
  add('license:evaluateOffline', wrapSync((lease, opts) => s.platformEvaluateOfflineLease(lease, opts || {})));

  // Platform → customer activation + contract bundle (secret-authenticated)
  add('saas:applyActivationBundle', wrapSync((secret, bundle) => {
    const sync = require('../electron/services/saas-customer-sync');
    const expected = sync.getSyncSecret?.() || String(process.env.SAAS_SYNC_SECRET || '').trim();
    if (!expected || String(secret || '') !== expected) {
      const err = new Error('Unauthorized');
      err.status = 401;
      throw err;
    }
    return s.platformApplyActivationBundle(bundle || {});
  }));
  add('saas:listOrderFees', wrapSync((secret, f) => {
    const sync = require('../electron/services/saas-customer-sync');
    const expected = sync.getSyncSecret?.() || String(process.env.SAAS_SYNC_SECRET || '').trim();
    if (!expected || String(secret || '') !== expected) {
      const err = new Error('Unauthorized');
      err.status = 401;
      throw err;
    }
    return s.platformListOrderFeesLocal(f || {});
  }));
  add('platform:listDevices', wrapSync((tok, id) => {
    platformActor(tok);
    return s.platformListDevices(id);
  }));
  add('platform:revokeDevice', wrapSync((tok, devId) => {
    const a = platformActor(tok);
    return s.platformRevokeDevice(devId, a);
  }));
  add('platform:listServiceFees', wrapSync((tok) => {
    platformActor(tok);
    return s.platformListServiceFees();
  }));
  add('platform:upsertServiceFee', wrapSync((tok, d) => {
    const a = platformActor(tok);
    return s.platformUpsertServiceFee(d || {}, a);
  }));
  add('platform:calcServiceFee', wrapSync((tok, subtotal, opts) => {
    platformActor(tok);
    return s.platformCalcServiceFee(subtotal, opts || {});
  }));
  add('platform:listNotificationRules', wrapSync((tok) => {
    platformActor(tok);
    return s.platformListNotificationRules();
  }));
  add('platform:updateNotificationRule', wrapSync((tok, id, d) => {
    const a = platformActor(tok);
    return s.platformUpdateNotificationRule(id, d || {}, a);
  }));
  add('platform:notificationLog', wrapSync((tok, shopId, limit) => {
    platformActor(tok);
    return s.platformNotificationLog(shopId, limit);
  }));
  add('platform:processNotifications', wrapSync((tok, opts) => {
    platformActor(tok);
    return s.platformProcessNotifications(opts || {});
  }));
  add('platform:listAccessMessages', wrapSync((tok) => {
    platformActor(tok);
    return s.platformListAccessMessages();
  }));
  add('platform:setAccessMessage', wrapSync((tok, key, d) => {
    const a = platformActor(tok);
    return s.platformSetAccessMessage(key, d || {}, a);
  }));

  // ─── Public shop registration (APPLICATION only — no auth / no provision) ──
  add('platform:registrationOptions', wrapSync(() => s.platformRegistrationOptions()));
  add('platform:submitShopApplication', wrapSync((d, meta) => {
    // Public: never accept session tokens as authority; ignore any status/approved flags in d
    return s.platformSubmitShopApplication(d || {}, meta || {});
  }));
  add('platform:listApplications', wrapSync((tok, f) => {
    platformActor(tok);
    return s.platformListApplications(f || {});
  }));
  add('platform:getApplication', wrapSync((tok, id) => {
    platformActor(tok);
    return s.platformGetApplication(id);
  }));
  add('platform:setApplicationStatus', wrapSync((tok, id, status, opts) => {
    const a = platformActor(tok);
    // Server rejects APPROVED here — must use approveApplication
    return s.platformSetApplicationStatus(id, status, a, opts || {});
  }));
  add('platform:approveApplication', wrapAsync(async (tok, id, opts) => {
    const a = platformActor(tok);
    return s.platformApproveApplication(id, a, opts || {});
  }));

  // Shop-local entitlement snapshot (ONE source of truth for UI)
  add('entitlements:status', wrapSync(() => s.entitlementsStatus()));
  add('entitlements:get', wrapSync(() => s.entitlementsGet()));
  add('entitlements:featureCatalog', wrapSync(() => s.entitlementsFeatureCatalog()));

  // Platform → customer entitlement sync (secret-authenticated; never from browser without secret)
  add('saas:applyEntitlementSnapshot', wrapSync((secret, snapshot) => {
    const sync = require('../electron/services/saas-customer-sync');
    return sync.applyEntitlementSnapshotAuthenticated(secret, snapshot);
  }));
  add('saas:status', wrapSync(() => {
    const entitlements = require('../electron/services/entitlements');
    return {
      shop_key: entitlements.shopKey(),
      enforcement: entitlements.enforcementEnabled(),
      has_sync_secret: !!String(process.env.SAAS_SYNC_SECRET || '').trim(),
      subscription_status: process.env.SHOP_SUBSCRIPTION_STATUS || null
    };
  }));

  // ─── Digital Signage ────────────────────────────────────────────────────────
  add('signage:login', wrapSync((u, p) => s.signageLogin(u, p)));
  add('signage:loginAsAdmin', wrapSync((a) => {
    const actor = bizActor(a);
    return s.signageLoginAsAdmin(actor);
  }));
  add('signage:logout', wrapSync((tok) => s.signageLogout(tok)));
  add('signage:dashboard', wrapSync((tok) => s.signageDashboard(tok)));
  add('signage:summary', wrapSync((a) => {
    requireUserSession(['owner', 'manager']);
    return s.signageSummary?.();
  }));
  add('signage:requestPairing', wrapSync((meta) => s.requestPairing(meta || {})));
  add('signage:pairingStatus', wrapSync((code) => s.pairingStatus(code)));
  add('signage:pendingPairings', wrapSync((tok) => s.listPendingPairings(tok)));
  add('signage:pendingPairingsAdmin', wrapSync((a) => s.listPendingPairingsAdmin(bizActor(a))));
  add('signage:approvePairing', wrapSync((tok, code, data) => s.approvePairing(code, data || {}, tok)));
  add('signage:approvePairingAdmin', wrapSync((code, data, a) => s.approvePairingAdmin(code, data || {}, bizActor(a))));
  add('signage:rejectPairing', wrapSync((tok, code) => s.rejectPairing(code, tok)));
  add('signage:revokeDevice', wrapSync((tok, id) => s.revokeDevice(id, tok)));
  add('signage:listDevices', wrapSync((tok) => s.listDevices(tok)));
  add('signage:saveDevice', wrapSync((tok, d) => s.saveDevice(d || {}, tok)));
  add('signage:listMedia', wrapSync((tok, f) => s.listMedia(tok, f || {})));
  add('signage:uploadMedia', wrapSync((tok, d) => s.uploadMedia(d || {}, tok)));
  add('signage:deleteMedia', wrapSync((tok, id) => s.deleteMedia(id, tok)));
  add('signage:listPlaylists', wrapSync((tok) => s.listPlaylists(tok)));
  add('signage:getPlaylist', wrapSync((tok, id) => s.getPlaylist(id)));
  add('signage:savePlaylist', wrapSync((tok, d) => s.savePlaylist(d || {}, tok)));
  add('signage:listMenus', wrapSync((tok) => s.listMenus(tok)));
  add('signage:getMenu', wrapSync((tok, id) => s.getMenu(id)));
  add('signage:saveMenu', wrapSync((tok, d) => s.saveMenu(d || {}, tok)));
  add('signage:syncMenuFromProducts', wrapSync((tok, menuId) => s.syncMenuFromProducts(menuId, tok)));
  add('signage:saveAudioPlaylist', wrapSync((tok, d) => s.saveAudioPlaylist(d || {}, tok)));
  add('signage:listAudioPlaylists', wrapSync((tok) => s.listAudioPlaylists(tok)));
  add('signage:saveScreenGroup', wrapSync((tok, d) => s.saveScreenGroup(d || {}, tok)));
  add('signage:publish', wrapSync((tok, d) => s.publishToScreens(d || {}, tok)));
  add('signage:publicationStatus', wrapSync((tok, id) => s.getPublicationStatus(id, tok)));
  add('signage:remoteCommand', wrapSync((tok, deviceId, cmd, payload) => s.remoteCommand(deviceId, cmd, payload || {}, tok)));
  add('signage:saveAnnouncement', wrapSync((tok, d) => s.saveAnnouncement(d || {}, tok)));
  add('signage:playNowAnnouncement', wrapSync((tok, id) => s.playNowAnnouncement(id, tok)));
  add('signage:generateAiVoice', wrapAsync((tok, text) => s.generateAiVoice(text, tok)));
  add('signage:settings', wrapSync((tok) => s.getSignageSettings(tok)));
  add('signage:saveSettings', wrapSync((tok, d) => s.saveSignageSettings(d || {}, tok)));
  add('signage:listUsers', wrapSync((a) => s.listSignageUsers(bizActor(a))));
  add('signage:saveUser', wrapSync((d, a) => s.saveSignageUser(d || {}, bizActor(a))));
  add('signage:heartbeat', wrapSync((deviceTok, payload) => s.deviceHeartbeat(deviceTok, payload || {})));
  add('signage:getCommands', wrapSync((deviceTok) => s.getDeviceCommands(deviceTok)));
  add('signage:ackCommand', wrapSync((deviceTok, cmdId, result) => s.ackCommand(deviceTok, cmdId, result)));
  add('signage:reportSync', wrapSync((deviceTok, pubDevId, status, err) => s.reportSync(deviceTok, pubDevId, status, err)));
  add('signage:manifest', wrapSync((deviceTok) => s.buildPlayerManifest(deviceTok)));
  add('signage:listScreenGroups', wrapSync((tok) => s.listScreenGroups(tok)));
  add('signage:listSchedules', wrapSync((tok) => s.listSchedules(tok)));
  add('signage:saveSchedule', wrapSync((tok, d) => s.saveSchedule(d || {}, tok)));
  add('signage:deleteSchedule', wrapSync((tok, id) => s.deleteSchedule(id, tok)));
  add('signage:publishEmergency', wrapSync((tok, d) => s.publishEmergency(d || {}, tok)));
  add('signage:cancelEmergency', wrapSync((tok, targetType, targetIds) => s.cancelEmergency(tok, targetType, targetIds || [])));
  add('signage:previewPlaylist', wrapSync((tok, playlistId, audioId) => s.previewPlaylist(playlistId, tok, audioId)));
  add('signage:getDeviceDiagnostics', wrapSync((tok, deviceId) => s.getDeviceDiagnostics(deviceId, tok)));
  add('signage:listAuditLogs', wrapSync((tok, limit) => s.listAuditLogs(tok, limit || 100)));
  add('signage:runTests', wrapAsync(() => s.runSignageTests()));
  add('signage:tryThumbnail', wrapSync((tok, mediaId) => s.tryGenerateThumbnail(mediaId)));

  // ─── Kiosk ──────────────────────────────────────────────────────────────────
  const kioskSvc = require('../electron/services/kiosk-platform');
  add('kiosk:login', wrapSync((u, p) => kioskSvc.kioskLogin(u, p)));
  add('kiosk:logout', wrapSync((tok) => kioskSvc.kioskLogout(tok)));
  add('kiosk:dashboard', wrapSync((tok) => kioskSvc.kioskDashboard(tok)));
  add('kiosk:summary', wrapSync((a) => { requireUserSession(['owner', 'manager']); return kioskSvc.kioskSummary(); }));
  add('kiosk:requestPairing', wrapSync((meta) => kioskSvc.requestPairing(meta || {})));
  add('kiosk:pairingStatus', wrapSync((code) => kioskSvc.pairingStatus(code)));
  add('kiosk:pendingPairings', wrapSync((tok) => kioskSvc.listPendingPairings(tok)));
  add('kiosk:approvePairing', wrapSync((code, data, tok) => kioskSvc.approvePairing(code, data || {}, tok)));
  add('kiosk:rejectPairing', wrapSync((code, tok) => kioskSvc.rejectPairing(code, tok)));
  add('kiosk:revokeDevice', wrapSync((id, tok) => kioskSvc.revokeDevice(id, tok)));
  add('kiosk:listDevices', wrapSync((tok) => kioskSvc.listDevices(tok)));
  add('kiosk:saveDevice', wrapSync((tok, d) => kioskSvc.saveDevice(d || {}, tok)));
  add('kiosk:catalog', wrapSync((deviceTok) => kioskSvc.getKioskCatalog(deviceTok)));
  add('kiosk:placeOrder', wrapSync((deviceTok, data) => kioskSvc.placeKioskOrder(deviceTok, data || {})));
  add('kiosk:validateVoucher', wrapSync((deviceTok, code, opts) => {
    kioskSvc.getKioskCatalog(deviceTok); // validates device token
    return require('../electron/services/discount-vouchers').validateVoucher(code, opts || {});
  }));
  add('kiosk:heartbeat', wrapSync((deviceTok, payload) => kioskSvc.deviceHeartbeat(deviceTok, payload || {})));
  add('kiosk:remoteCommand', wrapSync((tok, deviceId, cmd, payload) => kioskSvc.remoteCommand(deviceId, cmd, payload || {}, tok)));
  add('kiosk:listOrders', wrapSync((tok, filters) => kioskSvc.listKioskOrders(tok, filters || {})));
  add('kiosk:settings', wrapSync((tok) => kioskSvc.getKioskSettings(tok)));
  add('kiosk:saveSettings', wrapSync((tok, d) => kioskSvc.saveKioskSettings(d || {}, tok)));
  add('kiosk:runTests', wrapAsync(() => kioskSvc.runKioskTests()));
  add('kiosk:adminListDevices', wrapSync((a) => { requireUserSession(['owner', 'manager']); return kioskSvc.listDevicesAdmin(); }));
  add('kiosk:adminPendingPairings', wrapSync((a) => { requireUserSession(['owner', 'manager']); return kioskSvc.listPendingPairingsAdmin(); }));
  add('kiosk:adminApprovePairing', wrapSync((code, data, a) => {
    const u = requireUserSession(['owner', 'manager']);
    return kioskSvc.approvePairingAdmin(code, data || {}, u.full_name || u.username);
  }));

  // ─── Drive-Thru ─────────────────────────────────────────────────────────────
  const driveThruSvc = require('../electron/services/drive-thru-platform');
  const expenseApp = require('../electron/services/expense-app-platform');
  add('driveThru:login', wrapSync((u, p) => driveThruSvc.driveThruLogin(u, p)));
  add('driveThru:logout', wrapSync((tok) => driveThruSvc.driveThruLogout(tok)));
  add('driveThru:dashboard', wrapSync((tok) => driveThruSvc.driveThruDashboard(tok)));
  add('driveThru:summary', wrapSync((a) => { requireUserSession(['owner', 'manager']); return driveThruSvc.driveThruSummary(); }));
  add('driveThru:listStations', wrapSync((tok) => driveThruSvc.listStations(tok)));
  add('driveThru:saveStation', wrapSync((tok, d) => driveThruSvc.saveStation(d || {}, tok)));
  add('driveThru:stationHeartbeat', wrapSync((stationTok, payload) => driveThruSvc.stationHeartbeat(stationTok, payload || {})));
  add('driveThru:stationLogin', wrapSync((tok, stationTok) => driveThruSvc.stationLogin(stationTok, tok)));
  add('driveThru:catalog', wrapSync((stationTok) => driveThruSvc.getDriveThruCatalog(stationTok)));
  add('driveThru:getAudioConfig', wrapSync((stationTok) => driveThruSvc.getAudioConfig(stationTok)));
  add('driveThru:saveAudioConfig', wrapSync((stationTok, cfg, tok) => driveThruSvc.saveAudioConfig(stationTok, cfg || {}, tok)));
  add('driveThru:postAudioSignal', wrapSync((stationTok, type, payload) => driveThruSvc.postAudioSignal(stationTok, type, payload)));
  add('driveThru:pollAudioSignals', wrapSync((stationTok, sinceId) => driveThruSvc.pollAudioSignals(stationTok, sinceId || 0)));
  add('driveThru:startOrder', wrapSync((tok, stationTok) => driveThruSvc.startOrder(stationTok, tok)));
  add('driveThru:updateOrder', wrapSync((tok, id, data) => driveThruSvc.updateOrder(id, data || {}, tok)));
  add('driveThru:confirmOrder', wrapSync((tok, id) => driveThruSvc.confirmOrder(id, tok)));
  add('driveThru:takePayment', wrapSync((tok, id, data) => driveThruSvc.takePayment(id, data || {}, tok)));
  add('driveThru:sendToKitchen', wrapSync((tok, id) => driveThruSvc.sendToKitchen(id, tok)));
  add('driveThru:markReady', wrapSync((tok, id) => driveThruSvc.markReady(id, tok)));
  add('driveThru:markCollected', wrapSync((tok, id) => driveThruSvc.markCollected(id, tok)));
  add('driveThru:cancelOrder', wrapSync((tok, id, reason) => driveThruSvc.cancelOrder(id, reason, tok)));
  add('driveThru:listOrders', wrapSync((tok, filters) => driveThruSvc.listOrders(tok, filters || {})));
  add('driveThru:settings', wrapSync((tok) => driveThruSvc.getDriveThruSettings(tok)));
  add('driveThru:saveSettings', wrapSync((tok, d) => driveThruSvc.saveDriveThruSettings(d || {}, tok)));
  add('driveThru:listAuditLogs', wrapSync((tok, limit) => driveThruSvc.listAuditLogs(tok, limit || 100)));
  add('driveThru:runTests', wrapAsync(() => driveThruSvc.runDriveThruTests()));
  add('driveThru:adminListStations', wrapSync((a) => { requireUserSession(['owner', 'manager']); return driveThruSvc.listStationsAdmin(); }));
  add('driveThru:adminSaveStation', wrapSync((data, a) => { requireUserSession(['owner', 'manager']); return driveThruSvc.saveStationAdmin(data || {}); }));
  add('driveThru:adminRegenerateStationToken', wrapSync((stationId, a) => { requireUserSession(['owner', 'manager']); return driveThruSvc.regenerateStationTokenAdmin(stationId); }));

  // ─── Expenses mobile app ────────────────────────────────────────────────────
  add('expenseApp:login', wrapSync((u, p, d) => expenseApp.expenseLogin(u, p, d || {})));
  add('expenseApp:logout', wrapSync((tok) => expenseApp.expenseLogout(tok)));
  add('expenseApp:profile', wrapSync((tok) => expenseApp.expenseProfile(tok)));
  add('expenseApp:list', wrapSync((tok, f) => expenseApp.expenseList(tok, f || {})));
  add('expenseApp:save', wrapSync((tok, d) => expenseApp.expenseSave(tok, d || {})));
  add('expenseApp:get', wrapSync((tok, id) => expenseApp.expenseGet(tok, id)));
  add('expenseApp:categories', wrapSync(() => expenseApp.expenseCategories()));
  add('expenseApp:settings', wrapSync(() => expenseApp.expenseShopSettings()));
  add('expenseApp:grantAccess', wrapSync((d) => expenseApp.expenseGrantAccess(d || {})));
  add('expenseApp:wasteProducts', wrapSync((tok) => expenseApp.expenseWasteProducts(tok)));
  add('expenseApp:wasteList', wrapSync((tok, f) => expenseApp.expenseWasteList(tok, f || {})));
  add('expenseApp:wasteRecord', wrapSync((tok, d) => expenseApp.expenseWasteRecord(tok, d || {})));
  add('expenseApp:ownerFundings', wrapSync((tok, f) => expenseApp.expenseOwnerFundings(tok, f || {})));
  add('expenseApp:recordOwnerFunding', wrapSync((tok, d) => expenseApp.expenseRecordOwnerFunding(tok, d || {})));

  // ─── Manager Operations & Daily Tasks ───────────────────────────────────────
  const managerOps = require('../electron/services/manager-operations');
  const moActor = (a) => (a && a.id != null ? a : requireSession());
  const moPortal = (tok) => managerOps.resolvePortalSession(tok);
  add('mo:dashboard', wrapSync((f, a) => { moActor(a); return managerOps.ownerDashboard(f?.work_date, f?.branch_id); }));
  add('mo:home', wrapSync((f, a) => managerOps.mobileHome(moActor(a), f?.branch_id)));
  add('mo:listTasks', wrapSync((f, a) => managerOps.listTasks(f || {}, moActor(a))));
  add('mo:getTask', wrapSync((id, a) => managerOps.getTask(id, moActor(a))));
  add('mo:startTask', wrapSync((id, a) => managerOps.startTask(id, moActor(a))));
  add('mo:completeChecklistItem', wrapSync((id, d, a) => managerOps.completeChecklistItem(id, d || {}, moActor(a))));
  add('mo:completeTask', wrapSync((id, d, a) => managerOps.completeTask(id, d || {}, moActor(a))));
  add('mo:verifyTask', wrapSync((id, d, a) => managerOps.verifyTask(id, d || {}, moActor(a))));
  add('mo:sales', wrapSync((branchId) => { requireSession(); return managerOps.getSalesSummary(branchId); }));
  add('mo:reportProblem', wrapSync((d, a) => managerOps.reportIncident(d || {}, moActor(a))));
  add('mo:listIncidents', wrapSync((f) => { requireSession(); return managerOps.listIncidents(f || {}); }));
  add('mo:teamHelp', wrapSync((f) => { requireSession(); return managerOps.listTeamHelp(f?.work_date); }));
  add('mo:requestHelp', wrapSync((d, a) => managerOps.requestHelp(d || {}, moActor(a))));
  add('mo:offerHelp', wrapSync((id, a) => managerOps.offerHelp(id, moActor(a))));
  add('mo:submitReport', wrapSync((d, a) => managerOps.submitDailyReport(d || {}, moActor(a))));
  add('mo:listReports', wrapSync((f) => { requireSession(); return managerOps.listReports(f || {}); }));
  add('mo:getReport', wrapSync((id, a) => managerOps.getReport(id, moActor(a))));
  add('mo:ownerRespond', wrapSync((id, msg, a) => managerOps.ownerRespond(id, msg, moActor(a))));
  add('mo:ackMessage', wrapSync((id, a) => managerOps.acknowledgeOwnerMessage(id, moActor(a))));
  add('mo:evidence', wrapSync((id, a) => managerOps.getEvidenceDataUrl(id, moActor(a))));
  add('mo:attendance', wrapSync(() => { requireSession(); return managerOps.getAttendanceSnapshot(); }));
  add('mo:templates', wrapSync(() => { requireSession(); return managerOps.listTaskTemplates(); }));
  add('mo:saveTemplate', wrapSync((d, a) => managerOps.saveTaskTemplate(d || {}, moActor(a))));
  add('mo:checklists', wrapSync(() => { requireSession(); return managerOps.listChecklistTemplates(); }));
  add('mo:saveChecklist', wrapSync((d, a) => managerOps.saveChecklistTemplate(d || {}, moActor(a))));
  add('mo:getSettings', wrapSync(() => { requireSession(); return managerOps.getMoSettings(); }));
  add('mo:saveSettings', wrapSync((d, a) => managerOps.saveMoSettings(d || {}, moActor(a))));
  add('mo:generateTasks', wrapSync((d, a) => managerOps.generateDailyTasks(d?.work_date, moActor(a), d?.branch_id)));
  add('mo:audit', wrapSync((f) => { requireSession(); return managerOps.listAudit(f || {}); }));
  add('mo:categories', wrapSync(() => managerOps.INCIDENT_CATEGORIES));
  add('managerOps:login', wrapSync((u, p, d) => managerOps.portalLogin(u, p, d || {})));
  add('managerOps:logout', wrapSync((tok) => managerOps.portalLogout(tok)));
  add('managerOps:home', wrapSync((tok, f) => managerOps.mobileHome(moPortal(tok), f?.branch_id)));
  add('managerOps:listTasks', wrapSync((tok, f) => managerOps.listTasks(f || {}, moPortal(tok))));
  add('managerOps:getTask', wrapSync((tok, id) => managerOps.getTask(id, moPortal(tok))));
  add('managerOps:startTask', wrapSync((tok, id) => managerOps.startTask(id, moPortal(tok))));
  add('managerOps:completeChecklistItem', wrapSync((tok, id, d) => managerOps.completeChecklistItem(id, d || {}, moPortal(tok))));
  add('managerOps:completeTask', wrapSync((tok, id, d) => managerOps.completeTask(id, d || {}, moPortal(tok))));
  add('managerOps:sales', wrapSync((tok, branchId) => { moPortal(tok); return managerOps.getSalesSummary(branchId); }));
  add('managerOps:reportProblem', wrapSync((tok, d) => managerOps.reportIncident(d || {}, moPortal(tok))));
  add('managerOps:teamHelp', wrapSync((tok) => { moPortal(tok); return managerOps.listTeamHelp(); }));
  add('managerOps:requestHelp', wrapSync((tok, d) => managerOps.requestHelp(d || {}, moPortal(tok))));
  add('managerOps:offerHelp', wrapSync((tok, id) => managerOps.offerHelp(id, moPortal(tok))));
  add('managerOps:submitReport', wrapSync((tok, d) => managerOps.submitDailyReport(d || {}, moPortal(tok))));
  add('managerOps:ownerMessages', wrapSync((tok) => {
    const u = moPortal(tok);
    return managerOps.mobileHome(u).owner_messages;
  }));
  add('managerOps:ackMessage', wrapSync((tok, id) => managerOps.acknowledgeOwnerMessage(id, moPortal(tok))));
  add('managerOps:evidence', wrapSync((tok, id) => managerOps.getEvidenceDataUrl(id, moPortal(tok))));
  add('managerOps:attendance', wrapSync((tok) => { moPortal(tok); return managerOps.getAttendanceSnapshot(); }));

  const studioApp = require('../electron/services/studio-app-platform');
  add('studioApp:login', wrapSync((u, p, d) => studioApp.studioLogin(u, p, d || {})));
  add('studioApp:logout', wrapSync((tok) => studioApp.studioLogout(tok)));
  add('studioApp:profile', wrapSync((tok) => studioApp.studioProfile(tok)));
  add('studioApp:check', wrapSync((tok) => studioApp.studioCheck(tok)));
  add('studioApp:beginModule', wrapSync((tok, mod) => studioApp.studioBeginModule(tok, mod)));
  add('studioApp:settings', wrapSync(() => studioApp.studioShopSettings()));

  // ─── Chisanyama Connection Radio ───────────────────────────────────────────
  const radioApp = require('../electron/services/radio-platform');
  add('radio:publicStatus', wrapSync((slug) => radioApp.publicStatus(slug)));
  add('radio:publicChatList', wrapSync((slug, afterId) => radioApp.publicChatList(slug, afterId)));
  add('radio:publicChatPost', wrapSync((slug, payload) => radioApp.publicChatPost(slug, payload || {})));
  add('radio:publicListenerPing', wrapSync((slug, sessionKey, meta) => radioApp.publicListenerPing(slug, sessionKey, meta || {})));
  add('radio:publicRequestCall', wrapSync((slug, payload) => radioApp.publicRequestCall(slug, payload || {})));
  add('radio:login', wrapSync((u, p, d) => radioApp.radioLogin(u, p, d || {})));
  add('radio:logout', wrapSync((tok) => radioApp.radioLogout(tok)));
  add('radio:profile', wrapSync((tok) => radioApp.radioProfile(tok)));
  add('radio:check', wrapSync((tok) => radioApp.radioCheck(tok)));
  add('radio:studioSnapshot', wrapSync((tok) => radioApp.studioSnapshot(tok)));
  add('radio:setGoLive', wrapSync((tok, on) => radioApp.setGoLive(tok, on)));
  add('radio:setMicDuck', wrapSync((tok, payload) => radioApp.setMicDuck(tok, payload || {})));
  add('radio:updateNowPlaying', wrapSync((tok, payload) => radioApp.updateNowPlaying(tok, payload || {})));
  add('radio:playNow', wrapSync((tok, payload) => radioApp.playNow(tok, payload || {})));
  add('radio:playTrack', wrapSync((tok, trackId, opts) => radioApp.playTrack(tok, trackId, opts || {})));
  add('radio:playPlaylist', wrapSync((tok, playlistId) => radioApp.playPlaylist(tok, playlistId)));
  add('radio:advanceQueue', wrapSync((tok) => radioApp.advanceQueue(tok)));
  add('radio:saveSchedule', wrapSync((tok, items) => radioApp.saveSchedule(tok, items || [])));
  add('radio:saveProgramme', wrapSync((tok, items) => radioApp.saveProgramme(tok, items || [])));
  add('radio:addTrack', wrapSync((tok, data) => radioApp.addTrack(tok, data || {})));
  add('radio:updateTrack', wrapSync((tok, id, data) => radioApp.updateTrack(tok, id, data || {})));
  add('radio:deleteTrack', wrapSync((tok, id) => radioApp.deleteTrack(tok, id)));
  add('radio:addAnnouncement', wrapSync((tok, data) => radioApp.addAnnouncement(tok, data || {})));
  add('radio:savePlaylist', wrapSync((tok, data) => radioApp.savePlaylist(tok, data || {})));
  add('radio:deletePlaylist', wrapSync((tok, id) => radioApp.deletePlaylist(tok, id)));
  add('radio:duplicatePlaylist', wrapSync((tok, id) => radioApp.duplicatePlaylist(tok, id)));
  add('radio:saveFolder', wrapSync((tok, data) => radioApp.saveFolder(tok, data || {})));
  add('radio:saveSfx', wrapSync((tok, data) => radioApp.saveSfx(tok, data || {})));
  add('radio:playSfx', wrapSync((tok, id) => radioApp.playSfx(tok, id)));
  add('radio:saveMixer', wrapSync((tok, mixer) => radioApp.saveMixer(tok, mixer || {})));
  add('radio:hideChatMessage', wrapSync((tok, id, hidden) => radioApp.hideChatMessage(tok, id, hidden)));
  add('radio:moderateChat', wrapSync((tok, id, hidden) => radioApp.hideChatMessage(tok, id, hidden)));
  add('radio:pinChatMessage', wrapSync((tok, id, pinned) => radioApp.pinChatMessage(tok, id, pinned)));
  add('radio:handleChatMessage', wrapSync((tok, id, handled) => radioApp.handleChatMessage(tok, id, handled)));
  add('radio:blockChatAuthor', wrapSync((tok, key, reason) => radioApp.blockChatAuthor(tok, key, reason)));
  add('radio:staffChatReply', wrapSync((tok, body) => radioApp.staffChatReply(tok, body)));
  add('radio:upsertCall', wrapSync((tok, data) => radioApp.upsertCall(tok, data || {})));
  add('radio:saveSocialDestination', wrapSync((tok, data) => radioApp.saveSocialDestination(tok, data || {})));
  add('radio:updateStationSettings', wrapSync((tok, data) => radioApp.updateStationSettings(tok, data || {})));
  add('radio:createPromoAnnouncement', wrapSync((tok, productId) => radioApp.createPromoAnnouncement(tok, productId)));
  add('radio:liveJoin', wrapSync((slug, sessionKey) => radioApp.liveJoin(slug, sessionKey)));
  add('radio:liveLeave', wrapSync((slug, sessionKey) => radioApp.liveLeave(slug, sessionKey)));
  add('radio:liveStudioPending', wrapSync((tok) => radioApp.liveStudioPending(tok)));
  add('radio:liveStudioSetOffer', wrapSync((tok, peerId, offer) => radioApp.liveStudioSetOffer(tok, peerId, offer)));
  add('radio:liveStudioSetIce', wrapSync((tok, peerId, cand) => radioApp.liveStudioSetIce(tok, peerId, cand)));
  add('radio:liveStudioConsumeAnswer', wrapSync((tok, peerId) => radioApp.liveStudioConsumeAnswer(tok, peerId)));
  add('radio:liveListenerPoll', wrapSync((slug, sessionKey) => radioApp.liveListenerPoll(slug, sessionKey)));
  add('radio:liveListenerAnswer', wrapSync((slug, sessionKey, answer) => radioApp.liveListenerAnswer(slug, sessionKey, answer)));
  add('radio:liveListenerIce', wrapSync((slug, sessionKey, cand) => radioApp.liveListenerIce(slug, sessionKey, cand)));
  add('radio:liveListenerConsumeIce', wrapSync((slug, sessionKey) => radioApp.liveListenerConsumeIce(slug, sessionKey)));
  add('radio:setPlaybackState', wrapSync((tok, state) => radioApp.setPlaybackState(tok, state)));
  add('radio:playAdvert', wrapSync((tok, data) => radioApp.playAdvert(tok, data || {})));
  add('radio:clearAdvert', wrapSync((tok) => radioApp.clearAdvert(tok)));
  add('radio:pushVoiceChunk', wrapSync((tok, data) => radioApp.pushVoiceChunk(tok, data || {})));
  add('radio:stopVoice', wrapSync((tok) => radioApp.stopVoice(tok)));
  add('radio:publicVoiceChunks', wrapSync((slug, afterSeq) => radioApp.publicVoiceChunks(slug, afterSeq)));
  add('radio:scheduleAdvertJob', wrapSync((tok, data) => radioApp.scheduleAdvertJob(tok, data || {})));
  add('radio:listAdvertJobs', wrapSync((tok) => radioApp.listAdvertJobs(tok)));
  add('radio:adminOverview', wrapSync((a) => { requireUserSession(['owner', 'manager']); return radioApp.adminOverview(); }));
  add('radio:adminSaveSettings', wrapSync((data, a) => { requireUserSession(['owner', 'manager']); return radioApp.adminSaveSettings(data || {}); }));

  // ─── Communication Center ─────────────────────────────────────────────────
  const cc = () => require('../electron/services/communication-center');
  add('cc:dashboard', wrapSync((a) => { requireUserSession(['owner', 'manager', 'supervisor']); return cc().dashboard(); }));
  add('cc:history', wrapSync((f, a) => { requireUserSession(['owner', 'manager', 'supervisor']); return cc().listHistory(f || {}); }));
  add('cc:failed', wrapSync((a) => { requireUserSession(['owner', 'manager']); return cc().listFailed(); }));
  add('cc:scheduled', wrapSync((a) => { requireUserSession(['owner', 'manager']); return cc().listScheduled(); }));
  add('cc:retry', wrapSync((id, a) => { requireUserSession(['owner', 'manager']); return cc().retryJob(id, a); }));
  add('cc:cancel', wrapSync((id, a) => { requireUserSession(['owner', 'manager']); return cc().cancelJob(id, a); }));
  add('cc:sendNow', wrapSync((id, a) => { requireUserSession(['owner', 'manager']); return cc().sendJobNow(id, a); }));
  add('cc:createMessage', wrapSync((d, a) => { requireUserSession(['owner', 'manager']); return cc().createMessage(d || {}, a); }));
  add('cc:sharePublish', wrapSync((d, a) => { requireUserSession(['owner', 'manager', 'supervisor']); return cc().sharePublish(d || {}, a); }));
  add('cc:previewAudience', wrapSync((aud, a) => { requireUserSession(['owner', 'manager']); return { count: cc().previewAudienceCount(aud || {}) }; }));
  add('cc:templates', wrapSync((a) => { requireUserSession(['owner', 'manager']); return cc().listTemplates(); }));
  add('cc:saveTemplate', wrapSync((d, a) => { requireUserSession(['owner', 'manager']); return cc().saveTemplate(d || {}, a); }));
  add('cc:eventTypes', wrapSync((a) => { requireUserSession(['owner', 'manager']); return cc().listEventTypes(); }));
  add('cc:saveEventType', wrapSync((d, a) => { requireUserSession(['owner', 'manager']); return cc().saveEventType(d || {}, a); }));
  add('cc:routingRules', wrapSync((a) => { requireUserSession(['owner', 'manager']); return cc().listRoutingRules(); }));
  add('cc:saveRoutingRule', wrapSync((d, a) => { requireUserSession(['owner', 'manager']); return cc().saveRoutingRule(d || {}, a); }));
  add('cc:automations', wrapSync((a) => { requireUserSession(['owner', 'manager']); return cc().listAutomations(); }));
  add('cc:saveAutomation', wrapSync((d, a) => { requireUserSession(['owner', 'manager']); return cc().saveAutomation(d || {}, a); }));
  add('cc:setAutomationEnabled', wrapSync((id, en, a) => { requireUserSession(['owner', 'manager']); return cc().setAutomationEnabled(id, !!en, a); }));
  add('cc:campaigns', wrapSync((a) => { requireUserSession(['owner', 'manager']); return cc().listCampaigns(); }));
  add('cc:connections', wrapSync((a) => { requireUserSession(['owner', 'manager']); return cc().listConnections(); }));
  add('cc:saveConnection', wrapSync((d, a) => { requireUserSession(['owner', 'manager']); return cc().saveConnection(d || {}, a); }));
  add('cc:media', wrapSync((a) => { requireUserSession(['owner', 'manager', 'supervisor']); return cc().listMedia(); }));
  add('cc:addMedia', wrapSync((d, a) => { requireUserSession(['owner', 'manager']); return cc().addMedia(d || {}, a); }));
  add('cc:settings', wrapSync((a) => { requireUserSession(['owner', 'manager']); return cc().getSettings(); }));
  add('cc:saveSettings', wrapSync((d, a) => { requireUserSession(['owner', 'manager']); return cc().saveSettings(d || {}, a); }));
  add('cc:branches', wrapSync((a) => { requireUserSession(['owner', 'manager']); return cc().getBranchDestinations(); }));
  add('cc:saveBranch', wrapSync((d, a) => { requireUserSession(['owner', 'manager']); return cc().saveBranchDestination(d || {}, a); }));
  add('cc:processQueue', wrapAsync(async (a) => { requireUserSession(['owner', 'manager']); return cc().processQueue(30); }));
  add('cc:emit', wrapSync((key, payload, opts, a) => { requireUserSession(['owner', 'manager']); return cc().emit(key, payload || {}, { ...(opts || {}), actor: a }); }));
  add('cc:createVerification', wrapSync((d, a) => { requireUserSession(['owner', 'manager', 'system']); return cc().createVerificationCode(d || {}, a); }));
  add('cc:verifyCode', wrapSync((d) => cc().verifyCode(d || {})));

  // ─── Legacy RPC aliases (audit scripts & older clients) ───────────────────
  add('delivery:listOrders', H.delivery_list);
  add('delivery:listDrivers', H.delivery_drivers);
  add('delivery:getSettings', H.delivery_settings);
  add('dashboard:admin', H.dashboard_stats);
  add('shifts:list', H.shifts_get);
  add('shifts:getOpen', H.shifts_current);
  add('held:get', H.sales_getHeld);
  add('audit:log', H.audit_get);
  add('audit:activity', wrapSync((f, t) => s.getActivityTimeline(f, t)));
  add('audit:saleDetail', wrapSync((f) => { requireSession(); return s.getUnifiedSalesList({ ...(f || {}), limit: 1 }); }));
  add('staff:list', H.staff_getEmployees);
  add('ops:complianceDashboard', H.ops_dashboard);
  add('payroll:runs', wrapSync((f, a) => s.listPayrollRecords(f || {}, a || s.getUserSession())));
  add('payroll:listRuns', wrapSync((f, a) => s.listPayrollRecords(f || {}, a || s.getUserSession())));
  add('mobile:users', H.mobile_adminListUsers);
  add('mobile:listUsers', H.mobile_adminListUsers);
  add('hr:employees', H.staff_getEmployees);

  scheduleDailyBackup(store);
  return H;
}

module.exports = { buildHandlers };

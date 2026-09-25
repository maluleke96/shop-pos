/**
 * Client-side data cache + in-flight request dedupe for instant navigation.
 * Cache-first reads; mutations invalidate related keys. Does not weaken auth.
 */
const DataCache = {
  mem: new Map(),
  inflight: new Map(),
  stats: { hits: 0, misses: 0, dedupes: 0, refreshes: 0 },
  perf: {
    requests: [],
    maxEntries: 400,
    byNs: {}
  },

  key(ns, args) {
    try {
      return `${ns}:${JSON.stringify(args ?? null)}`;
    } catch {
      return `${ns}:[unserializable]`;
    }
  },

  peek(ns, args) {
    const k = this.key(ns, args);
    const e = this.mem.get(k);
    if (!e) return null;
    if (e.exp < Date.now()) {
      this.mem.delete(k);
      return null;
    }
    return e.data;
  },

  get(ns, args) {
    const data = this.peek(ns, args);
    if (data != null) this.stats.hits += 1;
    else this.stats.misses += 1;
    return data;
  },

  set(ns, args, data, ttlMs = 120000) {
    this.mem.set(this.key(ns, args), {
      data,
      exp: Date.now() + ttlMs,
      at: Date.now()
    });
  },

  invalidate(...prefixes) {
    const prefs = prefixes.flat().filter(Boolean);
    this._invalidateGen = (this._invalidateGen || 0) + 1;
    const dropKey = (k) => !prefs.length || prefs.some((p) => k === p || k.startsWith(`${p}:`) || k.startsWith(p));
    if (!prefs.length) {
      this.mem.clear();
      this.inflight.clear();
    } else {
      for (const k of [...this.mem.keys()]) {
        if (dropKey(k)) this.mem.delete(k);
      }
      // Drop in-flight reads too — otherwise a post-save reload can wait on a
      // pre-save request and re-cache stale product/admin data.
      for (const k of [...this.inflight.keys()]) {
        if (dropKey(k)) this.inflight.delete(k);
      }
    }
    try {
      Utils.sessionCacheClear?.('products_page');
      Utils.sessionCacheClear?.('dash_');
      Utils.sessionCacheClear?.('pos_');
    } catch { /* ignore */ }
  },

  /**
   * Dedupe concurrent identical fetches. Optionally return stale cache immediately
   * while a background refresh updates memory (SWR).
   * opts.force = true skips cache + in-flight reuse (use after mutations).
   */
  async fetch(ns, args, fetcher, opts = {}) {
    const ttl = opts.ttlMs ?? 120000;
    const swr = opts.swr !== false;
    const force = !!opts.force;
    const k = this.key(ns, args);
    if (force) {
      this.mem.delete(k);
      this.inflight.delete(k);
    }
    const cached = force ? null : this.peek(ns, args);
    const genAtStart = this._invalidateGen || 0;

    if (!force && this.inflight.has(k)) {
      this.stats.dedupes += 1;
      this.recordPerf(ns, args, 0, { deduped: true, cached: cached != null });
      if (cached != null && swr) return cached;
      return this.inflight.get(k);
    }

    const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const run = Promise.resolve()
      .then(() => fetcher())
      .then((res) => {
        const ms = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - t0;
        this.recordPerf(ns, args, ms, { cached: false });
        if (this.inflight.get(k) === run) this.inflight.delete(k);
        // Do not re-cache a response that finished after a newer invalidate.
        if ((this._invalidateGen || 0) !== genAtStart && !force) return res;
        if (res && res.success !== false) this.set(ns, args, res, ttl);
        return res;
      })
      .catch((err) => {
        const ms = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - t0;
        this.recordPerf(ns, args, ms, { error: true });
        if (this.inflight.get(k) === run) this.inflight.delete(k);
        throw err;
      });

    this.inflight.set(k, run);

    if (cached != null && swr) {
      this.stats.hits += 1;
      this.stats.refreshes += 1;
      run.catch(() => {});
      return cached;
    }

    this.stats.misses += 1;
    return run;
  },

  /** Prefetch without blocking; shares in-flight with fetch(). */
  prefetch(ns, args, fetcher, opts = {}) {
    const cached = this.peek(ns, args);
    if (cached != null && !opts.force) return Promise.resolve(cached);
    return this.fetch(ns, args, fetcher, { ...opts, swr: false }).catch(() => null);
  },

  showStaleBanner(host, message) {
    if (!host) return;
    let ban = host.querySelector('.soft-refresh-banner');
    if (!ban) {
      ban = document.createElement('div');
      ban.className = 'soft-refresh-banner';
      host.insertBefore(ban, host.firstChild);
    }
    ban.textContent = message || 'Unable to refresh. Showing last updated data.';
    ban.hidden = false;
    clearTimeout(ban._hideTimer);
    ban._hideTimer = setTimeout(() => {
      ban.hidden = true;
    }, 5000);
  },

  clearStaleBanner(host) {
    const ban = host?.querySelector?.('.soft-refresh-banner');
    if (ban) ban.hidden = true;
  },

  getStats() {
    const total = this.stats.hits + this.stats.misses;
    return {
      ...this.stats,
      entries: this.mem.size,
      hitRate: total ? Math.round((this.stats.hits / total) * 100) : null
    };
  },

  recordPerf(ns, args, ms, meta = {}) {
    const entry = {
      ns,
      args,
      ms: Math.round(ms),
      at: Date.now(),
      ...meta
    };
    this.perf.requests.push(entry);
    if (this.perf.requests.length > this.perf.maxEntries) {
      this.perf.requests.splice(0, this.perf.requests.length - this.perf.maxEntries);
    }
    const bucket = this.perf.byNs[ns] || { count: 0, totalMs: 0, maxMs: 0, dedupes: 0 };
    bucket.count += 1;
    bucket.totalMs += entry.ms;
    bucket.maxMs = Math.max(bucket.maxMs, entry.ms);
    if (meta.deduped) bucket.dedupes += 1;
    this.perf.byNs[ns] = bucket;
  },

  getPerfReport() {
    const slowest = [...this.perf.requests].sort((a, b) => b.ms - a.ms).slice(0, 25);
    const modules = Object.entries(this.perf.byNs)
      .map(([ns, s]) => ({
        ns,
        count: s.count,
        avgMs: s.count ? Math.round(s.totalMs / s.count) : 0,
        maxMs: s.maxMs,
        dedupes: s.dedupes
      }))
      .sort((a, b) => b.avgMs - a.avgMs);
    return {
      cache: this.getStats(),
      requestCount: this.perf.requests.length,
      slowest,
      modules,
      nav: window.App?._navPerf || {}
    };
  }
};

/** Wrap selected API read methods with cache + in-flight dedupe. */
function installApiReadCache() {
  if (!window.API || API._dataCacheInstalled) return;
  API._dataCacheInstalled = true;

  const wrap = (name, ns, ttlMs, pickArgs = (a) => a, opts = {}) => {
    const orig = API[name];
    if (typeof orig !== 'function') return;
    const swr = opts.swr !== false;
    const transform = opts.transform;
    API[name] = function (...args) {
      return DataCache.fetch(ns, pickArgs(args), () => {
        return Promise.resolve(orig.apply(API, args)).then((res) => (
          typeof transform === 'function' ? transform(res, args) : res
        ));
      }, { ttlMs, swr });
    };
    API[name]._uncached = orig;
  };

  wrap('getProduct', 'productOne', 600000, (a) => [a[0]]);
  wrap('getProducts', 'products', 300000, (a) => [a[0] || {}], {
    swr: true,
    transform(res, args) {
      if (!args[0]?.for_pos || !Array.isArray(res?.data)) return res;
      return { ...res, data: Utils.slimPosCatalogProducts(res.data) };
    }
  });
  wrap('getCategories', 'categories', 600000, (a) => [a[0] || {}], {
    swr: true,
    transform(res, args) {
      if (!args[0]?.for_pos || !Array.isArray(res?.data)) return res;
      return { ...res, data: res.data.map((c) => Utils.slimPosCatalogItem(c, 'category')) };
    }
  });
  wrap('getCustomers', 'customers', 120000, (a) => [typeof a[0] === 'string' ? a[0] : '']);
  wrap('getSuppliers', 'suppliers', 300000, (a) => [a[0] || '']);
  wrap('getDashboardStats', 'dashboard', 60000, (a) => [a[0], a[1]]);
  wrap('getStockReport', 'stockReport', 60000, () => []);
  wrap('getStockHistory', 'stockHistory', 60000, (a) => [a[0] ?? null]);
  wrap('getSalesReport', 'salesReport', 60000, (a) => [a[0], a[1]]);
  wrap('getEmployees', 'employees', 120000, (a) => [a[0] || {}, a[1]?.id || null]);
  wrap('getOpenShift', 'openShift', 20000, (a) => [a[0]?.id || a[0] || null]);
  wrap('getActiveCombos', 'combos', 300000, (a) => [a[0] || {}], {
    swr: true,
    transform(res, args) {
      if (!args[0]?.for_pos || !Array.isArray(res?.data)) return res;
      return { ...res, data: res.data.map((c) => Utils.slimPosCatalogItem(c, 'combo')) };
    }
  });
  wrap('getKitchenOrders', 'kitchen', 15000, (a) => [a[0] ?? null]);
  wrap('getSettingsParsed', 'settings', 300000, () => []);
  wrap('getNotifications', 'notifications', 12000, (a) => [a?.id || a?.role || a || null], { swr: true });
  wrap('getAdminDashboard', 'adminDashboard', 45000, (a) => [a[0], a[1]]);
  wrap('getSalesList', 'salesList', 30000, (a) => [a[0] || {}]);
  wrap('getSoldProductsReport', 'soldProductsReport', 60000, (a) => [a[0], a[1]]);
  wrap('getPromoRequestHistory', 'promoHistory', 45000, (a) => [a[0] || {}]);
  wrap('getCombos', 'combosList', 60000, (a) => [a[0] || {}]);
  wrap('globalSearch', 'globalSearch', 15000, (a) => [String(a[0] || '').toLowerCase().trim()]);
  wrap('getQuotes', 'quotes', 60000, (a) => [a[0] || {}]);
  wrap('getLaybyes', 'laybyes', 60000, (a) => [a[0] || {}]);
  wrap('getGiftCards', 'giftcards', 60000, (a) => [a[0] || {}]);
  wrap('getExpenseCategories', 'expenseCategories', 300000, () => []);
  wrap('getWhatsAppTemplates', 'waTemplates', 120000, (a) => [a[0] || {}]);

  let catalogBroadcast = null;
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      catalogBroadcast = new BroadcastChannel('shop-pos-catalog');
    }
  } catch (_) { /* ignore */ }

  /** Invalidate menu/catalog caches and notify POS, Recipe, and embedded admin views instantly. */
  const notifyCatalogChanged = (detail = {}) => {
    DataCache.invalidate(
      'products', 'productOne', 'stockReport', 'stockHistory', 'dashboard', 'pos', 'categories',
      'promoHistory', 'combos', 'combosList', 'campaigns'
    );
    try {
      Utils.sessionCacheClear?.('pos_');
    } catch (_) { /* ignore */ }
    const stamp = String(Date.now());
    const payload = { stamp, ...detail };
    try {
      localStorage.setItem('shop-pos-catalog-ts', stamp);
    } catch (_) { /* ignore */ }
    try {
      window.dispatchEvent(new CustomEvent('shop-pos-catalog-updated', { detail: payload }));
      window.dispatchEvent(new CustomEvent('shop-pos-stock-updated', { detail: payload }));
      window.dispatchEvent(new CustomEvent('shop-pos-combos-updated', { detail: payload }));
    } catch (_) { /* ignore */ }
    try {
      catalogBroadcast?.postMessage({ type: 'catalog-updated', ...payload });
    } catch (_) { /* ignore */ }
  };

  DataCache.notifyCatalogChanged = notifyCatalogChanged;

  const invalidateProducts = () => notifyCatalogChanged();
  const invalidateSales = () => {
    DataCache.invalidate('dashboard', 'salesReport', 'stockReport', 'products', 'kitchen');
    try { window.dispatchEvent(new CustomEvent('shop-pos-sales-updated')); } catch (_) { /* */ }
  };

  const after = (name, fn) => {
    const orig = API[name];
    if (typeof orig !== 'function') return;
    API[name] = async function (...args) {
      const res = await (orig._uncached ? orig._uncached.apply(API, args) : orig.apply(API, args));
      try {
        fn(res, args);
      } catch { /* ignore */ }
      return res;
    };
  };

  after('completeSale', (res) => {
    if (res?.success !== false) invalidateSales();
  });
  after('acceptOnlineOrderAsSale', (res) => {
    if (res?.success !== false && !res?.error) invalidateSales();
  });
  after('saveSalesTargets', (res) => {
    if (res?.success !== false) {
      try { window.dispatchEvent(new CustomEvent('shop-pos-targets-updated')); } catch (_) { /* */ }
    }
  });
  after('saveProduct', (res, args) => {
    if (res?.success === false) return;
    const id = res?.data?.id || args?.[0]?.id;
    if (id != null) {
      try { window.Utils?._offlineImageUrls?.delete?.(String(id)); } catch (_) { /* ignore */ }
      try { window.OfflineStore?.revokeImageObjectUrl?.(id); } catch (_) { /* ignore */ }
    }
    invalidateProducts();
  });
  after('saveOtherSellItem', (res) => {
    if (res?.success !== false && res?.data?.id) invalidateProducts();
  });
  after('importProducts', (res) => {
    if (res?.success !== false) invalidateProducts();
  });
  after('deleteProduct', (res) => {
    if (res?.success !== false) invalidateProducts();
  });
  after('recipeSaveMeal', (res) => {
    if (res?.success !== false) invalidateProducts();
  });
  after('recipeUpdateIngredient', (res) => {
    if (res?.success !== false) invalidateProducts();
  });
  after('recipeDeleteIngredient', (res) => {
    if (res?.success !== false) invalidateProducts();
  });
  after('recipeEnsureIngredient', (res) => {
    if (res?.success !== false) invalidateProducts();
  });
  after('recipeRestockIngredient', (res) => {
    if (res?.success !== false) invalidateProducts();
  });
  after('recipeRestockBatchSave', (res) => {
    if (res?.success !== false) invalidateProducts();
  });
  after('recipeRefreshProduction', (res) => {
    if (res?.success !== false) invalidateProducts();
  });
  after('recipeSaveIngredientGroup', (res) => {
    if (res?.success !== false) invalidateProducts();
  });
  after('recipeDeleteIngredientGroup', (res) => {
    if (res?.success !== false) invalidateProducts();
  });
  after('recipeSetAvailableToday', (res) => {
    if (res?.success !== false) invalidateProducts();
  });
  after('recipePromoSave', (res) => {
    if (res?.success !== false) invalidateProducts();
  });
  after('proposeProductPromo', (res) => {
    if (res?.success !== false && !res?.needs_confirm) invalidateProducts();
  });
  after('approvePromoRequest', (res) => {
    if (res?.success !== false) invalidateProducts();
  });
  after('updatePromoRequest', (res) => {
    if (res?.success !== false) invalidateProducts();
  });
  after('deletePromoRequest', (res) => {
    if (res?.success !== false) invalidateProducts();
  });
  after('adjustStock', (res) => {
    if (res?.success !== false) invalidateProducts();
  });
  after('recordStockAdjustment', (res) => {
    if (res?.success !== false) invalidateProducts();
  });
  after('saveCategory', (res) => {
    if (res?.success !== false) notifyCatalogChanged();
  });
  after('deleteCategory', (res) => {
    if (res?.success !== false) notifyCatalogChanged();
  });
  after('saveMenuHighlightSettings', (res) => {
    if (res?.success !== false) notifyCatalogChanged();
  });
  after('recipeSetPosMenuFlags', (res) => {
    if (res?.success !== false) notifyCatalogChanged();
  });
  after('rejectPromoRequest', (res) => {
    if (res?.success !== false) notifyCatalogChanged();
  });
  after('cancelPromoRequest', (res) => {
    if (res?.success !== false) notifyCatalogChanged();
  });
  after('markProductPromo', (res) => {
    if (res?.success !== false) notifyCatalogChanged();
  });
  after('syncPromoStatuses', (res) => {
    if (res?.success !== false) notifyCatalogChanged();
  });
  after('saveCustomer', (res) => {
    if (res?.success !== false) DataCache.invalidate('customers');
  });
  after('deleteCustomer', (res) => {
    if (res?.success !== false) DataCache.invalidate('customers');
  });
  after('adjustLoyaltyPoints', (res) => {
    if (res?.success !== false) DataCache.invalidate('customers');
  });
  after('saveSettings', (res) => {
    if (res?.success !== false) DataCache.invalidate('settings');
  });
  after('saveJsonSetting', (res, args) => {
    if (res?.success !== false) {
      DataCache.invalidate('settings');
      const key = args?.[0];
      if (key === 'customization') notifyCatalogChanged();
    }
  });
  after('markNotificationRead', (res) => {
    if (res?.success !== false) DataCache.invalidate('notifications');
  });
  after('markAllNotificationsRead', (res) => {
    if (res?.success !== false) DataCache.invalidate('notifications');
  });

  const invalidateCombos = () => notifyCatalogChanged();
  after('saveCombo', (res) => { if (res?.success !== false) invalidateCombos(); });
  after('deleteCombo', (res) => { if (res?.success !== false) invalidateCombos(); });
  after('setComboStatus', (res) => { if (res?.success !== false) invalidateCombos(); });
  after('approveCombo', (res) => { if (res?.success !== false) invalidateCombos(); });
  after('rejectCombo', (res) => { if (res?.success !== false) invalidateCombos(); });
}

whenPosAPIReady?.(() => installApiReadCache());
if (window.API) installApiReadCache();
else window.addEventListener('posAPIReady', () => installApiReadCache(), { once: true });
document.addEventListener('DOMContentLoaded', () => installApiReadCache());
setTimeout(() => installApiReadCache(), 0);

window.DataCache = DataCache;
window.AdminPerf = {
  report: () => DataCache.getPerfReport(),
  reset: () => {
    DataCache.perf.requests = [];
    DataCache.perf.byNs = {};
    DataCache.stats = { hits: 0, misses: 0, dedupes: 0, refreshes: 0 };
  },
  logSlowest: (n = 10) => {
    const r = DataCache.getPerfReport();
    console.table(r.slowest.slice(0, n));
    console.table(r.modules.slice(0, n));
    return r;
  }
};

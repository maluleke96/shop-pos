/**
 * Durable offline cache for cloud POS — survives reload, works without network.
 * Catalog, session, RPC read responses, and product image blobs.
 */
(function (root) {
  const DB_NAME = 'shoppos-cache';
  const DB_VER = 1;
  const STORES = ['rpc', 'catalog', 'session', 'images'];

  const READ_METHODS = new Set([
    'auth_session',
    'settings_getParsed',
    'settings_getShiftSettings',
    'categories_get',
    'products_get',
    'products_getOne',
    'combos_getActive',
    'shifts_current',
    'branches_get'
  ]);

  const _blobUrls = new Map();

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const name of STORES) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function rpcKey(method, args) {
    try {
      return `${method}:${JSON.stringify(args ?? [])}`;
    } catch {
      return `${method}:[]`;
    }
  }

  function catalogKey(branchId) {
    const bid = branchId != null && branchId !== '' ? Number(branchId) : 0;
    return `pos_${bid || 'main'}`;
  }

  async function idbGet(store, key) {
    try {
      const db = await openDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readonly');
        const req = tx.objectStore(store).get(key);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => reject(req.error);
      });
    } catch {
      return null;
    }
  }

  async function idbSet(store, key, value) {
    try {
      const db = await openDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put(value, key);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      return false;
    }
  }

  const OfflineStore = {
    isReadMethod(method) {
      const key = String(method || '').replace(/[:.]/g, '_');
      return READ_METHODS.has(key);
    },

    async getRpc(method, args) {
      if (!this.isReadMethod(method)) return null;
      const row = await idbGet('rpc', rpcKey(method, args));
      if (!row?.data) return null;
      return row.data;
    },

    async putRpc(method, args, data) {
      if (!this.isReadMethod(method) || !data?.success) return;
      await idbSet('rpc', rpcKey(method, args), { data, at: Date.now() });
    },

    async saveCatalog(branchId, payload) {
      if (!payload?.products?.length) return;
      const slim = window.Utils?.slimPosCatalogPayload
        ? window.Utils.slimPosCatalogPayload(payload)
        : payload;
      await idbSet('catalog', catalogKey(branchId), { data: slim, at: Date.now() });
    },

    async loadCatalog(branchId) {
      const row = await idbGet('catalog', catalogKey(branchId));
      const snap = row?.data;
      if (!snap?.products?.length) return null;
      return {
        categories: snap.categories || [],
        products: window.Utils?.restorePosCatalogProducts
          ? window.Utils.restorePosCatalogProducts(snap.products)
          : snap.products,
        combos: snap.combos || []
      };
    },

    async saveSession(user, settings) {
      if (!user?.id) return;
      await idbSet('session', 'current', {
        user,
        settings: settings || null,
        at: Date.now()
      });
    },

    async loadSession() {
      return idbGet('session', 'current');
    },

    async cacheImage(id, blob) {
      if (id == null || !blob) return;
      await idbSet('images', String(id), blob);
    },

    async getImageBlob(id) {
      return idbGet('images', String(id));
    },

    async imageObjectUrl(id) {
      const key = String(id);
      if (_blobUrls.has(key)) return _blobUrls.get(key);
      const blob = await this.getImageBlob(id);
      if (!blob) return null;
      const url = URL.createObjectURL(blob);
      _blobUrls.set(key, url);
      return url;
    },

    revokeImageObjectUrl(id) {
      const key = String(id);
      const prev = _blobUrls.get(key);
      if (prev) {
        URL.revokeObjectURL(prev);
        _blobUrls.delete(key);
      }
    },

    async prefetchProductImages(products, opts = {}) {
      const list = (products || []).filter((p) => p?.id != null);
      const limit = opts.limit || 48;
      const batch = list.slice(0, limit);
      const tasks = batch.map(async (p) => {
        const existing = await this.getImageBlob(p.id);
        if (existing) return;
        const url = window.Utils?.productImageUrl?.(p) || `/api/product-image/${p.id}`;
        if (!url) return;
        try {
          const r = await fetch(url, { credentials: 'same-origin' });
          if (r.ok) await this.cacheImage(p.id, await r.blob());
        } catch { /* offline or missing */ }
      });
      await Promise.all(tasks);
      if (list.length > limit && typeof requestIdleCallback === 'function') {
        requestIdleCallback(() => {
          this.prefetchProductImages(list.slice(limit), { limit }).catch(() => {});
        }, { timeout: 8000 });
      }
    },

    pendingQueueCount() {
      return root.ShopPosOfflineQueue?.pendingCount?.() || Promise.resolve(0);
    }
  };

  root.OfflineStore = OfflineStore;
})(typeof window !== 'undefined' ? window : globalThis);

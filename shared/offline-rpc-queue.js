/**
 * Lightweight offline RPC queue for portal apps (Expenses, Driver, etc.).
 * Queues write calls when offline; flushes when connectivity returns.
 */
(function (root) {
  const DEFAULT_DB = 'shoppos-portal-offline';

  function openDb(dbName) {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName || DEFAULT_DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('queue')) {
          db.createObjectStore('queue', { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function newId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'q-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
  }

  function PortalOfflineQueue(opts) {
    this.dbName = (opts && opts.dbName) || DEFAULT_DB;
    this.namespace = (opts && opts.namespace) || 'portal';
    this.isWrite = (opts && opts.isWrite) || (() => false);
    this._flushing = false;
    this._bound = false;
  }

  PortalOfflineQueue.prototype.bind = function (callFn) {
    if (this._bound || typeof callFn !== 'function') return;
    this._bound = true;
    const flush = () => this.flush(callFn).catch(() => {});
    window.addEventListener('online', flush);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && navigator.onLine) flush();
    });
    if (navigator.onLine) setTimeout(flush, 1200);
  };

  PortalOfflineQueue.prototype.pendingCount = async function () {
    const db = await openDb(this.dbName);
    return new Promise((resolve, reject) => {
      const tx = db.transaction('queue', 'readonly');
      const req = tx.objectStore('queue').count();
      req.onsuccess = () => resolve(req.result || 0);
      req.onerror = () => reject(req.error);
    });
  };

  PortalOfflineQueue.prototype.enqueue = async function (method, args) {
    const db = await openDb(this.dbName);
    const clientRequestId = newId();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('queue', 'readwrite');
      tx.objectStore('queue').add({
        namespace: this.namespace,
        method,
        args: args || [],
        clientRequestId,
        createdAt: new Date().toISOString()
      });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
    return { queued: true, clientRequestId };
  };

  PortalOfflineQueue.prototype.flush = async function (callFn) {
    if (this._flushing || !navigator.onLine) return { flushed: 0 };
    this._flushing = true;
    let flushed = 0;
    try {
      const db = await openDb(this.dbName);
      const rows = await new Promise((resolve, reject) => {
        const tx = db.transaction('queue', 'readonly');
        const req = tx.objectStore('queue').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
      for (const row of rows) {
        if (row.namespace !== this.namespace) continue;
        try {
          await callFn(row.method, row.args, { fromQueue: true });
          await new Promise((resolve, reject) => {
            const tx = db.transaction('queue', 'readwrite');
            tx.objectStore('queue').delete(row.id);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error);
          });
          flushed++;
        } catch (_) { /* keep for next flush */ }
      }
    } finally {
      this._flushing = false;
    }
    if (flushed > 0) {
      try {
        window.dispatchEvent(new CustomEvent('portal-offline-flushed', { detail: { count: flushed } }));
      } catch (_) { /* */ }
    }
    return { flushed };
  };

  PortalOfflineQueue.prototype.wrapCall = async function (callFn, method, args) {
    const offline = !navigator.onLine;
    const write = this.isWrite(method);
    if (offline && write) {
      await this.enqueue(method, args);
      return { __offlineQueued: true, method };
    }
    try {
      return await callFn(method, args);
    } catch (err) {
      if (write && (!navigator.onLine || /network|fetch|reach server|failed to fetch/i.test(String(err.message || err)))) {
        await this.enqueue(method, args);
        return { __offlineQueued: true, method };
      }
      throw err;
    }
  };

  root.PortalOfflineQueue = PortalOfflineQueue;
})(typeof window !== 'undefined' ? window : globalThis);

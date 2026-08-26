/**
 * Offline mutation queue (IndexedDB).
 * Queues write RPCs when offline; flushes automatically when connectivity returns.
 * Each item gets a stable clientRequestId so retries do not duplicate sales.
 */
(function (root) {
  const DB_NAME = 'shoppos-offline';
  const STORE = 'queue';
  const WRITE_RE = /^(auth_|sales_|stock_|products_|categories_|customers_|suppliers_|po_|returns_|expenses_|shifts_|staff_|recipe_|hr_|payroll_|held_|quotes_|layby_|giftcards_|waste_|cashup_|combos_|flyers_|mkt_|whatsapp_|bookkeeping_|notifications_read|settings_save|settings_complete|settings_saveJson|branches_|tables_|kitchen_status|kitchen_create|stockcount_|credit_|loyalty_|operating_|ownerSalary_|jobs_|donations_|ops_|automation_|customfields_|documentHub_|rewards_|salaryClaims_)/;

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 3);
      req.onupgradeneeded = () => {
        const db = req.result;
        let store;
        if (!db.objectStoreNames.contains(STORE)) {
          store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        } else {
          store = req.transaction.objectStore(STORE);
        }
        if (store && !store.indexNames.contains('clientRequestId')) {
          try { store.createIndex('clientRequestId', 'clientRequestId', { unique: false }); } catch (_) { /* ignore */ }
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function isWriteMethod(method) {
    const key = String(method || '').replace(/[:.]/g, '_');
    return WRITE_RE.test(key);
  }

  function isQueueMethod(method) {
    return isWriteMethod(method);
  }

  function newRequestId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'offline-' + Date.now() + '-' + Math.random().toString(36).slice(2, 12);
  }

  async function findByClientRequestId(clientRequestId) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const store = tx.objectStore(STORE);
      if (store.indexNames.contains('clientRequestId')) {
        const req = store.index('clientRequestId').get(clientRequestId);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
        return;
      }
      const all = store.getAll();
      all.onsuccess = () => {
        const rows = all.result || [];
        resolve(rows.find((x) => String(x.clientRequestId || '') === clientRequestId) || null);
      };
      all.onerror = () => reject(all.error);
    });
  }

  /**
   * @param {string} method
   * @param {any[]} args
   * @param {{ clientRequestId?: string }} [opts]
   */
  async function enqueue(method, args, opts) {
    const preferred =
      (opts && opts.clientRequestId) ||
      (args && args[0] && typeof args[0] === 'object' && (args[0].client_request_id || args[0].clientRequestId)) ||
      '';
    const clientRequestId = String(preferred || newRequestId()).trim() || newRequestId();

    const hit = await findByClientRequestId(clientRequestId);
    if (hit) {
      return { queued: true, clientRequestId, deduped: true };
    }

    let stampedArgs = args || [];
    if (
      /^sales_complete$/i.test(String(method || '').replace(/[:.]/g, '_')) &&
      stampedArgs[0] &&
      typeof stampedArgs[0] === 'object'
    ) {
      stampedArgs = [{ ...stampedArgs[0], client_request_id: clientRequestId }, ...stampedArgs.slice(1)];
    }

    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).add({
        method,
        args: stampedArgs,
        clientRequestId,
        createdAt: new Date().toISOString()
      });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
    return { queued: true, clientRequestId };
  }

  async function listAll() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function removeId(id) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function pendingCount() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).count();
      req.onsuccess = () => resolve(req.result || 0);
      req.onerror = () => reject(req.error);
    });
  }

  async function flush(sendRpc) {
    const items = await listAll();
    items.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || (a.id - b.id));
    const results = [];
    for (const item of items) {
      try {
        const res = await sendRpc(item.method, item.args, {
          bypassOffline: true,
          clientRequestId: item.clientRequestId || null
        });
        if (res && res.success === false) {
          const err = String(res.error || '');
          if (/duplicate|already|unique|client_request|replayed/i.test(err) || res.replayed) {
            await removeId(item.id);
            results.push({ id: item.id, ok: true, deduped: true });
            continue;
          }
          results.push({ id: item.id, ok: false, error: res.error });
          break;
        }
        await removeId(item.id);
        results.push({ id: item.id, ok: true, data: res });
      } catch (e) {
        results.push({ id: item.id, ok: false, error: e.message });
        break;
      }
    }
    return results;
  }

  root.ShopPosOfflineQueue = {
    isWriteMethod,
    isQueueMethod,
    enqueue,
    listAll,
    pendingCount,
    flush,
    newRequestId
  };
})(typeof window !== 'undefined' ? window : globalThis);

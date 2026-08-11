/**
 * Offline mutation queue (IndexedDB).
 * Queues write RPCs when offline; flushes automatically when connectivity returns.
 * Each item gets a clientRequestId so server-side replay does not duplicate sales.
 */
(function (root) {
  const DB_NAME = 'shoppos-offline';
  const STORE = 'queue';
  const WRITE_RE = /^(auth_|sales_|stock_|products_|categories_|customers_|suppliers_|po_|returns_|expenses_|shifts_|staff_|recipe_|hr_|payroll_|held_|quotes_|layby_|giftcards_|waste_|cashup_|combos_|flyers_|mkt_|whatsapp_|bookkeeping_|notifications_read|settings_save|settings_complete|settings_saveJson|branches_|tables_|kitchen_status|kitchen_create|stockcount_|credit_|loyalty_|operating_|ownerSalary_|jobs_|donations_|ops_|automation_|customfields_|documentHub_|rewards_)/;

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
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

  /** Alias used by supabase-bootstrap.js */
  function isQueueMethod(method) {
    return isWriteMethod(method);
  }

  function newRequestId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'offline-' + Date.now() + '-' + Math.random().toString(36).slice(2, 12);
  }

  async function enqueue(method, args) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).add({
        method,
        args: args || [],
        clientRequestId: newRequestId(),
        createdAt: new Date().toISOString()
      });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
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
    const all = await listAll();
    return all.length;
  }

  async function flush(sendRpc) {
    const items = await listAll();
    // Oldest first — preserve order
    items.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || (a.id - b.id));
    const results = [];
    for (const item of items) {
      try {
        const res = await sendRpc(item.method, item.args, {
          bypassOffline: true,
          clientRequestId: item.clientRequestId || null
        });
        if (res && res.success === false) {
          // Already applied / duplicate treated as success when server says so
          const err = String(res.error || '');
          if (/duplicate|already|unique|client_request/i.test(err)) {
            await removeId(item.id);
            results.push({ id: item.id, ok: true, deduped: true });
            continue;
          }
          results.push({ id: item.id, ok: false, error: res.error });
          break;
        }
        await removeId(item.id);
        results.push({ id: item.id, ok: true });
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
    flush
  };
})(typeof window !== 'undefined' ? window : globalThis);

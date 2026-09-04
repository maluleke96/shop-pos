const { getDb } = require('../database/db');
const branches = require('./branches');
const deviceSettings = require('./deviceSettings');

function parseSyncSettings(raw) {
  if (!raw) return {};
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return {}; }
}

function getSyncSettings() {
  const row = getDb().prepare('SELECT sync_settings FROM shop_settings WHERE id = 1').get();
  return parseSyncSettings(row?.sync_settings);
}

function saveSyncSettings(data) {
  const existing = getSyncSettings();
  const merged = { ...existing, ...data };
  getDb().prepare('UPDATE shop_settings SET sync_settings = ? WHERE id = 1').run(JSON.stringify(merged));
  return merged;
}

function resolveDeviceUid() {
  const row = getDb().prepare('SELECT device_settings FROM shop_settings WHERE id = 1').get();
  let deviceId = null;
  try { deviceId = JSON.parse(row?.device_settings || '{}').device_id; } catch (_) {}
  if (!deviceId) deviceId = deviceSettings.load()?.device_id;
  return deviceId || `POS-${Date.now().toString(36).toUpperCase()}`;
}

function hubUrl() {
  const s = getSyncSettings();
  return (s.server_url || '').replace(/\/$/, '');
}

async function hubFetch(path, options = {}) {
  const base = hubUrl();
  if (!base) throw new Error('Sync server URL not configured');
  const url = `${base}${path}`;
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const timeoutMs = options.timeoutMs != null ? options.timeoutMs : 4000;
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await fetch(url, { ...options, headers, signal: ctrl?.signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) {
      throw new Error(data.error || `Hub error ${res.status}`);
    }
    return data;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function enqueueOutbox(entityType, entityId, payload) {
  getDb().prepare('INSERT INTO sync_outbox (entity_type, entity_id, payload) VALUES (?, ?, ?)')
    .run(entityType, entityId, JSON.stringify(payload));
}

function enqueueSale(saleId) {
  const db = getDb();
  const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId);
  if (!sale) return;
  const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(saleId);
  const payments = db.prepare('SELECT * FROM sale_payments WHERE sale_id = ?').all(saleId);
  enqueueOutbox('sale', saleId, { ...sale, items, payments });
}

async function registerDevice(role = 'pos', deviceName) {
  const sync = getSyncSettings();
  if (!sync.server_url || !sync.org_api_key) throw new Error('Configure hub URL and org API key first');
  const branch = branches.getActiveBranch();
  if (!branch?.code) throw new Error('Select an active branch first');
  const deviceUid = resolveDeviceUid();
  const name = deviceName || deviceSettings.load()?.device_name || `Terminal ${deviceUid}`;
  const data = await hubFetch('/api/devices/register', {
    method: 'POST',
    headers: { 'X-Org-Key': sync.org_api_key },
    body: JSON.stringify({ branch_code: branch.code, device_uid: deviceUid, name, role })
  });
  saveSyncSettings({
    device_token: data.data.device_token,
    remote_branch_id: data.data.branch_id,
    device_role: data.data.role,
    registered_at: new Date().toISOString()
  });
  return { ...data.data, device_uid: deviceUid };
}

async function publishProducts(getProductsFn, getCategoriesFn) {
  const sync = getSyncSettings();
  if (!sync.org_api_key) throw new Error('Org API key required');
  const products = getProductsFn();
  const categories = getCategoriesFn();
  const catMap = Object.fromEntries(categories.map(c => [c.id, c.name]));
  const branch = branches.getActiveBranch();
  const payload = products.filter(p => p.is_active).map(p => ({
    id: p.id,
    name: p.name,
    barcode: p.barcode,
    sku: p.sku,
    selling_price: p.selling_price,
    buying_price: p.buying_price,
    stock_quantity: p.stock_quantity,
    category_name: catMap[p.category_id] || null,
    is_active: p.is_active
  }));
  return hubFetch('/api/products/publish', {
    method: 'POST',
    headers: { 'X-Org-Key': sync.org_api_key },
    body: JSON.stringify({ products: payload, branch_id: sync.remote_branch_id || branch.id })
  });
}

async function pushOutbox() {
  const sync = getSyncSettings();
  if (!sync.device_token) throw new Error('Device not registered with hub');
  const pending = getDb().prepare('SELECT * FROM sync_outbox WHERE synced_at IS NULL ORDER BY id LIMIT 50').all();
  if (!pending.length) return { pushed: 0 };
  const sales = pending.filter(r => r.entity_type === 'sale').map(r => JSON.parse(r.payload));
  if (sales.length) {
    await hubFetch('/api/sync/push', {
      method: 'POST',
      headers: { 'X-Device-Token': sync.device_token },
      body: JSON.stringify({ sales })
    });
    for (const row of pending.filter(r => r.entity_type === 'sale')) {
      getDb().prepare('UPDATE sync_outbox SET synced_at = datetime(\'now\'), error = NULL WHERE id = ?').run(row.id);
    }
  }
  return { pushed: sales.length };
}

function applyPulledProducts(products) {
  const db = getDb();
  let updated = 0;
  for (const p of products) {
    const existing = p.barcode
      ? db.prepare('SELECT id FROM products WHERE barcode = ?').get(p.barcode)
      : db.prepare('SELECT id FROM products WHERE name = ?').get(p.name);
    if (existing) {
      // Never overwrite local stock from hub pull — stock is device-authoritative
      db.prepare(`UPDATE products SET name=?, selling_price=?, buying_price=?, is_active=1 WHERE id=?`)
        .run(p.name, p.selling_price, p.buying_price || 0, existing.id);
    } else {
      db.prepare(`INSERT INTO products (name, barcode, sku, selling_price, buying_price, stock_quantity, is_active) VALUES (?,?,?,?,?,?,1)`)
        .run(p.name, p.barcode || null, p.sku || null, p.selling_price, p.buying_price || 0, p.stock_quantity ?? 0);
    }
    updated++;
  }
  return updated;
}

function storeOnlineOrders(orders) {
  const db = getDb();
  let newCount = 0;
  for (const o of orders) {
    const remoteId = o.remote_id != null ? o.remote_id : o.id;
    const itemsJson = typeof o.items_json === 'string'
      ? o.items_json
      : JSON.stringify(o.items || o.items_json || []);
    const exists = db.prepare('SELECT id, status FROM online_orders_local WHERE remote_id = ?').get(remoteId);
    if (exists) {
      db.prepare(`UPDATE online_orders_local SET status = ?, total = ?, notes = ?, customer_name = ?, customer_phone = ?,
        fulfillment_type = COALESCE(?, fulfillment_type), discount = COALESCE(?, discount),
        delivery_fee = COALESCE(?, delivery_fee), items_json = COALESCE(?, items_json), updated_at = datetime('now')
        WHERE remote_id = ?`).run(
        o.status, o.total, o.notes || null, o.customer_name || null, o.customer_phone || null,
        o.fulfillment_type || o.fulfillment || null, o.discount ?? null, o.delivery_fee ?? null,
        itemsJson, remoteId
      );
      continue;
    }
    db.prepare(`INSERT INTO online_orders_local (remote_id, order_number, branch_id, customer_name, customer_phone, items_json, total, status, notes, created_at, fulfillment_type, discount, delivery_fee, order_source, payment_status, payment_method, delivery_address, subtotal)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      remoteId, o.order_number, o.branch_id || null, o.customer_name || null, o.customer_phone || null,
      itemsJson, o.total, o.status || 'pending', o.notes || null, o.created_at || new Date().toISOString(),
      o.fulfillment_type || o.fulfillment || 'collection', o.discount || 0, o.delivery_fee || 0,
      o.order_source || 'ONLINE', o.payment_status || 'pending', o.payment_method || null,
      o.delivery_address || null, o.subtotal || o.total || 0
    );
    if ((o.status || 'pending') === 'pending') newCount++;
  }
  return newCount;
}

function importCloudOrders(orders) {
  return storeOnlineOrders(orders || []);
}

async function pullUpdates() {
  const sync = getSyncSettings();
  if (!sync.device_token) throw new Error('Device not registered with hub');
  const since = sync.last_pull_at || '1970-01-01T00:00:00';
  const data = await hubFetch(`/api/sync/pull?since=${encodeURIComponent(since)}`, {
    headers: { 'X-Device-Token': sync.device_token }
  });
  const productsUpdated = applyPulledProducts(data.products || []);
  const newOrders = storeOnlineOrders(data.online_orders || []);
  saveSyncSettings({ last_pull_at: data.server_time || new Date().toISOString() });
  return { productsUpdated, newOrders };
}

async function syncNow() {
  let pushResult = { pushed: 0 };
  if (getSyncSettings().device_token) {
    pushResult = await pushOutbox();
  }
  const pullResult = getSyncSettings().device_token ? await pullUpdates() : { productsUpdated: 0, newOrders: 0 };
  saveSyncSettings({ last_sync_at: new Date().toISOString(), last_sync_error: null });
  return { ...pushResult, ...pullResult };
}

async function syncBranchesToHub() {
  const sync = getSyncSettings();
  if (!sync.org_api_key) throw new Error('Org API key required');
  const local = branches.getBranches();
  const remote = await hubFetch('/api/branches', { headers: { 'X-Org-Key': sync.org_api_key } });
  const remoteCodes = new Set((remote.data || []).map(b => b.code));
  let created = 0;
  for (const b of local) {
    if (!remoteCodes.has(b.code)) {
      await hubFetch('/api/branches', {
        method: 'POST',
        headers: { 'X-Org-Key': sync.org_api_key },
        body: JSON.stringify({ name: b.name, code: b.code, address: b.address, phone: b.phone })
      });
      created++;
    }
  }
  return { created, local: local.length, remote: (remote.data || []).length };
}

function getOnlineOrdersLocal(status) {
  let sql = 'SELECT * FROM online_orders_local';
  const params = [];
  if (status) { sql += ' WHERE status = ?'; params.push(status); }
  sql += ' ORDER BY created_at DESC LIMIT 100';
  return getDb().prepare(sql).all(...params);
}

function setReservationStatus(localId, status) {
  try {
    getDb().prepare(`UPDATE web_stock_reservations SET status = ? WHERE order_id = ? AND status = 'reserved'`)
      .run(status, localId);
  } catch (_) { /* table may not exist on older schemas */ }
}

async function updateOnlineOrderStatus(localId, status, opts = {}) {
  const order = getDb().prepare('SELECT * FROM online_orders_local WHERE id = ?').get(localId);
  if (!order) throw new Error('Order not found');
  const sync = getSyncSettings();
  if (sync.device_token && order.remote_id) {
    try {
      await hubFetch(`/api/online/orders/${order.remote_id}`, {
        method: 'PATCH',
        headers: { 'X-Device-Token': sync.device_token },
        body: JSON.stringify({ status, reject_reason: opts.reject_reason || null })
      });
    } catch (_) { /* continue with local update */ }
  }
  const db = getDb();
  if (opts.reject_reason != null) {
    db.prepare(`UPDATE online_orders_local SET status = ?, reject_reason = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(status, opts.reject_reason, localId);
  } else {
    db.prepare('UPDATE online_orders_local SET status = ?, updated_at = datetime(\'now\') WHERE id = ?').run(status, localId);
  }
  if (status === 'rejected' || status === 'cancelled') {
    setReservationStatus(localId, 'released');
  } else if (status === 'accepted' || status === 'completed') {
    setReservationStatus(localId, 'fulfilled');
  }
  return db.prepare('SELECT * FROM online_orders_local WHERE id = ?').get(localId);
}

async function rejectOnlineOrder(localId, reason, actor) {
  const order = getDb().prepare('SELECT * FROM online_orders_local WHERE id = ?').get(localId);
  if (!order) throw new Error('Order not found');
  if (order.status !== 'pending') throw new Error(`Order is already ${order.status}`);
  return updateOnlineOrderStatus(localId, 'rejected', { reject_reason: reason || 'Rejected by staff' });
}

function getSyncStatus() {
  const sync = getSyncSettings();
  const branch = branches.getActiveBranch();
  const pending = getDb().prepare('SELECT COUNT(*) as c FROM sync_outbox WHERE synced_at IS NULL').get().c;
  const onlinePending = getDb().prepare('SELECT COUNT(*) as c FROM online_orders_local WHERE status = \'pending\'').get().c;
  return {
    ...sync,
    branch,
    device_uid: resolveDeviceUid(),
    pending_outbox: pending,
    pending_online_orders: onlinePending,
    configured: !!(sync.server_url && sync.org_api_key),
    registered: !!sync.device_token
  };
}

module.exports = {
  getSyncSettings, saveSyncSettings, resolveDeviceUid,
  registerDevice, publishProducts, pushOutbox, pullUpdates, syncNow,
  syncBranchesToHub, enqueueSale, getSyncStatus,
  getOnlineOrdersLocal, updateOnlineOrderStatus, rejectOnlineOrder, importCloudOrders, storeOnlineOrders
};

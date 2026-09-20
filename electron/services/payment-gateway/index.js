/**
 * Provider-independent payment gateway service.
 * Checkout talks only to this module — never to a specific provider.
 */
const { getDb } = require('../../database/db');
const { ensurePaymentGatewaySchema } = require('./schema');
const { encryptSecret, decryptSecret, maskSecret, hasSecret } = require('./secrets');
const { YocoProvider } = require('./providers/yoco');

const STATUSES = [
  'PENDING',
  'AUTHORIZED',
  'PAID',
  'FAILED',
  'CANCELLED',
  'EXPIRED',
  'REFUNDED',
  'PARTIALLY_REFUNDED'
];

const PROVIDERS = {
  yoco: {
    id: 'yoco',
    name: 'Yoco',
    label: 'Pay Online',
    methodId: 'pay_online',
    factory: (cfg) => new YocoProvider(cfg)
  }
};

function dbGet(sql, p = []) { return getDb().prepare(sql).get(...p); }
function dbAll(sql, p = []) { return getDb().prepare(sql).all(...p); }
function dbRun(sql, p = []) { return getDb().prepare(sql).run(...p); }

function nowIso() { return new Date().toISOString(); }

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

function requireAdmin(actor) {
  try {
    return require('../authz').assertUserActor(actor, ['owner', 'manager']);
  } catch (_) {
    const role = String(actor?.role || '').toLowerCase();
    if (!actor?.id || !['owner', 'manager'].includes(role)) {
      throw new Error('Owner or manager access required');
    }
    return actor;
  }
}

function getPublicBaseUrl() {
  try {
    return require('../../../lib/public-url').getPublicUrl();
  } catch (_) {
    return process.env.SHOP_POS_PUBLIC_URL || 'https://chisafood.up.railway.app';
  }
}

function rowToConfig(row, { includeSecrets = false } = {}) {
  if (!row) return null;
  const secretPlain = decryptSecret(row.secret_key_enc);
  const webhookPlain = decryptSecret(row.webhook_secret_enc);
  const out = {
    id: row.id,
    provider: row.provider,
    name: row.name,
    enabled: !!Number(row.enabled),
    test_mode: row.test_mode !== 0 && row.test_mode !== '0' && row.test_mode !== false,
    public_key: row.public_key || '',
    currency: row.currency || 'ZAR',
    webhook_id: row.webhook_id || null,
    last_successful_connection_at: row.last_successful_connection_at || null,
    last_webhook_at: row.last_webhook_at || null,
    last_error: row.last_error || null,
    status_message: row.status_message || null,
    has_secret_key: hasSecret(row.secret_key_enc),
    has_webhook_secret: hasSecret(row.webhook_secret_enc),
    secret_key_masked: hasSecret(row.secret_key_enc) ? maskSecret(secretPlain || 'sk_live_****') : '',
    webhook_secret_masked: hasSecret(row.webhook_secret_enc) ? maskSecret(webhookPlain || 'whsec_****') : '',
    webhook_url: `${getPublicBaseUrl()}/api/webhooks/payments/${row.provider}`,
    updated_at: row.updated_at || null
  };
  if (includeSecrets) {
    out.secret_key = secretPlain;
    out.webhook_secret = webhookPlain;
  }
  return out;
}

function listGateways(actor) {
  ensurePaymentGatewaySchema();
  requireAdmin(actor);
  // Ensure known providers exist
  for (const p of Object.values(PROVIDERS)) {
    const exists = dbGet('SELECT id FROM payment_gateways WHERE provider = ?', [p.id]);
    if (!exists) {
      dbRun(`INSERT INTO payment_gateways (provider, name, enabled, test_mode, currency, status_message)
        VALUES (?, ?, 0, 1, 'ZAR', ?)`, [p.id, p.name, 'Not configured']);
    }
  }
  return dbAll('SELECT * FROM payment_gateways ORDER BY name').map((r) => rowToConfig(r));
}

function getGatewayRow(provider) {
  ensurePaymentGatewaySchema();
  return dbGet('SELECT * FROM payment_gateways WHERE provider = ?', [String(provider || '').toLowerCase()]);
}

function getProviderInstance(provider, { requireEnabled = false } = {}) {
  const meta = PROVIDERS[String(provider || '').toLowerCase()];
  if (!meta) throw new Error(`Unknown payment provider: ${provider}`);
  const row = getGatewayRow(meta.id);
  if (!row) throw new Error(`${meta.name} is not configured`);
  if (requireEnabled && !Number(row.enabled)) throw new Error(`${meta.name} is disabled`);
  const cfg = rowToConfig(row, { includeSecrets: true });
  return meta.factory({
    name: cfg.name,
    public_key: cfg.public_key,
    secret_key: cfg.secret_key,
    webhook_secret: cfg.webhook_secret,
    currency: cfg.currency,
    test_mode: cfg.test_mode
  });
}

function saveGateway(provider, data = {}, actor) {
  ensurePaymentGatewaySchema();
  requireAdmin(actor);
  const key = String(provider || data.provider || '').toLowerCase();
  const meta = PROVIDERS[key];
  if (!meta) throw new Error(`Unknown payment provider: ${key}`);

  let row = getGatewayRow(key);
  if (!row) {
    dbRun(`INSERT INTO payment_gateways (provider, name, enabled, test_mode, currency, status_message)
      VALUES (?, ?, 0, 1, 'ZAR', ?)`, [key, meta.name, 'Not configured']);
    row = getGatewayRow(key);
  }

  const enabled = data.enabled === true || data.enabled === 1 || data.enabled === '1';
  let testMode = data.test_mode === undefined
    ? (row.test_mode !== 0 && row.test_mode !== '0')
    : (data.test_mode === true || data.test_mode === 1 || data.test_mode === '1');

  if (enabled && !testMode) {
    if (data.confirm_live !== true && data.confirmLive !== true) {
      throw new Error('Confirm LIVE mode before enabling live payments (real money).');
    }
  }

  const publicKey = data.public_key != null ? String(data.public_key).trim() : (row.public_key || '');
  const currency = String(data.currency || row.currency || 'ZAR').toUpperCase() || 'ZAR';

  let secretEnc = row.secret_key_enc;
  if (data.secret_key != null && String(data.secret_key).trim()) {
    const sk = String(data.secret_key).trim();
    if (!sk.includes('••••')) secretEnc = encryptSecret(sk);
  }
  let webhookEnc = row.webhook_secret_enc;
  if (data.webhook_secret != null && String(data.webhook_secret).trim()) {
    const wh = String(data.webhook_secret).trim();
    if (!wh.includes('••••')) webhookEnc = encryptSecret(wh);
  }

  if (enabled && !hasSecret(secretEnc)) {
    throw new Error('Secret key is required before enabling this gateway');
  }

  dbRun(`UPDATE payment_gateways SET
    name = ?, enabled = ?, test_mode = ?, public_key = ?, secret_key_enc = ?,
    webhook_secret_enc = ?, currency = ?, status_message = ?, last_error = NULL, updated_at = ?
    WHERE provider = ?`, [
    data.name || meta.name,
    enabled ? 1 : 0,
    testMode ? 1 : 0,
    publicKey || null,
    secretEnc,
    webhookEnc,
    currency,
    enabled ? (testMode ? 'TEST MODE — NO REAL MONEY' : 'LIVE MODE') : 'Disabled',
    nowIso(),
    key
  ]);

  syncOnlinePayMethod();
  return rowToConfig(getGatewayRow(key));
}

function syncOnlinePayMethod() {
  try {
    const online = require('../online-ordering');
    const global = online.getGlobalSettings();
    const methods = Array.isArray(global.online?.payment_methods) ? [...global.online.payment_methods] : [];
    const enabledGateways = dbAll('SELECT * FROM payment_gateways WHERE enabled = 1');
    const onlineIds = new Set(enabledGateways.map((g) => PROVIDERS[g.provider]?.methodId).filter(Boolean));

    // Remove stale pay_online if no gateway enabled
    let next = methods.filter((m) => {
      if (String(m.id).toLowerCase() !== 'pay_online') return true;
      return onlineIds.has('pay_online');
    });

    for (const g of enabledGateways) {
      const meta = PROVIDERS[g.provider];
      if (!meta) continue;
      const exists = next.some((m) => String(m.id).toLowerCase() === meta.methodId);
      if (!exists) {
        next.unshift({
          id: meta.methodId,
          label: meta.label,
          status: 'pending_payment',
          fulfillment: 'any',
          enabled: true,
          gateway_provider: meta.id
        });
      } else {
        next = next.map((m) => {
          if (String(m.id).toLowerCase() !== meta.methodId) return m;
          return {
            ...m,
            label: meta.label,
            status: 'pending_payment',
            enabled: true,
            gateway_provider: meta.id
          };
        });
      }
    }

    online.saveGlobalOnlineSettings({
      ...(global.online || {}),
      payment_methods: next
    }, null);
  } catch (err) {
    console.warn('[payment-gateway] syncOnlinePayMethod:', err.message || err);
  }
}

async function testConnection(provider, actor) {
  ensurePaymentGatewaySchema();
  requireAdmin(actor);
  const key = String(provider || '').toLowerCase();
  try {
    const instance = getProviderInstance(key);
    const result = await instance.testConnection(getPublicBaseUrl());
    dbRun(`UPDATE payment_gateways SET last_successful_connection_at = ?, last_error = NULL,
      status_message = ?, updated_at = ? WHERE provider = ?`, [
      nowIso(),
      result.message || 'Connection OK',
      nowIso(),
      key
    ]);
    return { success: true, ...result, gateway: rowToConfig(getGatewayRow(key)) };
  } catch (err) {
    dbRun(`UPDATE payment_gateways SET last_error = ?, status_message = ?, updated_at = ? WHERE provider = ?`, [
      String(err.message || err).slice(0, 400),
      'Connection failed',
      nowIso(),
      key
    ]);
    return { success: false, error: err.message || String(err), gateway: rowToConfig(getGatewayRow(key)) };
  }
}

async function registerWebhook(provider, actor) {
  ensurePaymentGatewaySchema();
  requireAdmin(actor);
  const key = String(provider || '').toLowerCase();
  const instance = getProviderInstance(key);
  if (typeof instance.ensureWebhook !== 'function') {
    throw new Error('This provider does not support automatic webhook registration');
  }
  const result = await instance.ensureWebhook(getPublicBaseUrl());
  const patch = {
    webhook_id: result.id || null
  };
  if (result.secret) {
    dbRun(`UPDATE payment_gateways SET webhook_id = ?, webhook_secret_enc = ?,
      status_message = ?, last_error = NULL, updated_at = ? WHERE provider = ?`, [
      result.id,
      encryptSecret(result.secret),
      'Webhook registered — secret saved',
      nowIso(),
      key
    ]);
  } else {
    dbRun(`UPDATE payment_gateways SET webhook_id = ?, status_message = ?, last_error = NULL, updated_at = ? WHERE provider = ?`, [
      result.id,
      result.alreadyRegistered ? 'Webhook already registered' : 'Webhook registered',
      nowIso(),
      key
    ]);
  }
  return {
    success: true,
    webhook_id: result.id,
    webhook_url: result.url,
    secret_returned: !!result.secret,
    already_registered: !!result.alreadyRegistered,
    gateway: rowToConfig(getGatewayRow(key)),
    note: result.secret
      ? 'Webhook secret was returned once and saved securely. It will not be shown again in full.'
      : (result.alreadyRegistered
        ? 'Webhook URL already registered. Paste the webhook secret from Yoco if not saved yet.'
        : null)
  };
}

function getEnabledOnlineMethods() {
  ensurePaymentGatewaySchema();
  const rows = dbAll('SELECT * FROM payment_gateways WHERE enabled = 1');
  return rows.map((r) => {
    const meta = PROVIDERS[r.provider];
    if (!meta) return null;
    return {
      id: meta.methodId,
      label: meta.label,
      status: 'pending_payment',
      fulfillment: 'any',
      enabled: true,
      gateway_provider: meta.id,
      test_mode: r.test_mode !== 0 && r.test_mode !== '0'
    };
  }).filter(Boolean);
}

function resolveGatewayForMethod(paymentMethod) {
  const method = String(paymentMethod || '').toLowerCase();
  if (method === 'pay_online' || method === 'card_online' || method === 'yoco') {
    const row = dbGet('SELECT * FROM payment_gateways WHERE provider = ? AND enabled = 1', ['yoco']);
    if (row) return 'yoco';
  }
  // Generic: look up which enabled gateway owns this method id
  for (const [id, meta] of Object.entries(PROVIDERS)) {
    if (meta.methodId === method) {
      const row = getGatewayRow(id);
      if (row && Number(row.enabled)) return id;
    }
  }
  return null;
}

function isGatewayPaymentMethod(paymentMethod) {
  return !!resolveGatewayForMethod(paymentMethod);
}

function insertTransaction(data = {}) {
  ensurePaymentGatewaySchema();
  const r = dbRun(`INSERT INTO payment_transactions (
    order_id, order_number, customer_name, customer_email, web_customer_id, branch_id,
    gateway_provider, gateway_checkout_id, gateway_payment_id, gateway_transaction_id,
    amount, currency, status, idempotency_key, metadata_json, gateway_response_json, created_at, updated_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
    data.order_id || null,
    data.order_number || null,
    data.customer_name || null,
    data.customer_email || null,
    data.web_customer_id || null,
    data.branch_id || null,
    data.gateway_provider,
    data.gateway_checkout_id || null,
    data.gateway_payment_id || null,
    data.gateway_transaction_id || null,
    round2(data.amount),
    data.currency || 'ZAR',
    data.status || 'PENDING',
    data.idempotency_key || null,
    data.metadata_json ? JSON.stringify(data.metadata_json) : null,
    data.gateway_response_json ? JSON.stringify(data.gateway_response_json) : null,
    nowIso(),
    nowIso()
  ]);
  return dbGet('SELECT * FROM payment_transactions WHERE id = ?', [r.lastInsertRowid]);
}

function updateTransaction(id, patch = {}) {
  const fields = [];
  const vals = [];
  const map = {
    status: 'status',
    gateway_checkout_id: 'gateway_checkout_id',
    gateway_payment_id: 'gateway_payment_id',
    gateway_transaction_id: 'gateway_transaction_id',
    failure_reason: 'failure_reason',
    refund_status: 'refund_status',
    refunded_amount: 'refunded_amount',
    paid_at: 'paid_at',
    accounting_posted: 'accounting_posted',
    gateway_response_json: 'gateway_response_json',
    metadata_json: 'metadata_json'
  };
  for (const [k, col] of Object.entries(map)) {
    if (patch[k] === undefined) continue;
    fields.push(`${col} = ?`);
    let v = patch[k];
    if ((k === 'gateway_response_json' || k === 'metadata_json') && v && typeof v === 'object') {
      v = JSON.stringify(v);
    }
    vals.push(v);
  }
  fields.push('updated_at = ?');
  vals.push(nowIso());
  vals.push(id);
  dbRun(`UPDATE payment_transactions SET ${fields.join(', ')} WHERE id = ?`, vals);
  return dbGet('SELECT * FROM payment_transactions WHERE id = ?', [id]);
}

/**
 * Create payment via configured gateway for an existing online order.
 */
async function createPaymentForOrder(orderId, webToken, opts = {}) {
  ensurePaymentGatewaySchema();
  const online = require('../online-ordering');
  const customer = online.resolveWebCustomer(webToken);
  if (!customer) throw new Error('Please sign in to pay');

  const order = dbGet('SELECT * FROM online_orders_local WHERE id = ?', [Number(orderId)]);
  if (!order) throw new Error('Order not found');
  if (Number(order.web_customer_id) !== Number(customer.id)) throw new Error('Order not found');

  const payStatus = String(order.payment_status || '').toUpperCase();
  if (payStatus === 'PAID' || String(order.payment_status).toLowerCase() === 'paid') {
    return { already_paid: true, order_id: order.id, order_number: order.order_number };
  }

  const providerId = resolveGatewayForMethod(order.payment_method) || opts.provider || 'yoco';
  const instance = getProviderInstance(providerId, { requireEnabled: true });
  const gw = rowToConfig(getGatewayRow(providerId));

  // Reuse pending txn for same order if checkout already created
  const existing = dbGet(
    `SELECT * FROM payment_transactions WHERE order_id = ? AND gateway_provider = ? AND status IN ('PENDING','AUTHORIZED') ORDER BY id DESC LIMIT 1`,
    [order.id, providerId]
  );
  if (existing?.gateway_checkout_id && existing.gateway_response_json) {
    try {
      const prev = JSON.parse(existing.gateway_response_json);
      if (prev.redirectUrl) {
        return {
          order_id: order.id,
          order_number: order.order_number,
          transaction_id: existing.id,
          provider: providerId,
          checkout_id: existing.gateway_checkout_id,
          redirect_url: prev.redirectUrl,
          test_mode: gw.test_mode,
          amount: existing.amount,
          currency: existing.currency,
          reused: true
        };
      }
    } catch (_) { /* create new */ }
  }

  const amount = round2(order.total);
  const currency = gw.currency || 'ZAR';
  const base = getPublicBaseUrl();
  const successUrl = `${base}/order/?payment=return&order=${encodeURIComponent(order.order_number)}&status=success`;
  const cancelUrl = `${base}/order/?payment=return&order=${encodeURIComponent(order.order_number)}&status=cancel`;
  const failureUrl = `${base}/order/?payment=return&order=${encodeURIComponent(order.order_number)}&status=failure`;

  const txn = insertTransaction({
    order_id: order.id,
    order_number: order.order_number,
    customer_name: order.customer_name,
    customer_email: order.customer_email || customer.email,
    web_customer_id: customer.id,
    branch_id: order.branch_id,
    gateway_provider: providerId,
    amount,
    currency,
    status: 'PENDING',
    idempotency_key: opts.idempotency_key || `pay-${order.id}-${Date.now()}`,
    metadata_json: { order_id: order.id, order_number: order.order_number }
  });

  const created = await instance.createPayment({
    amount,
    currency,
    orderId: order.id,
    orderNumber: order.order_number,
    localTxnId: txn.id,
    successUrl,
    cancelUrl,
    failureUrl,
    idempotencyKey: `order-${order.id}-txn-${txn.id}`,
    clientReferenceId: order.order_number,
    externalId: String(order.id),
    metadata: {
      orderId: String(order.id),
      orderNumber: order.order_number,
      localTxnId: String(txn.id)
    }
  });

  updateTransaction(txn.id, {
    gateway_checkout_id: created.checkoutId,
    gateway_payment_id: created.paymentId,
    gateway_transaction_id: created.checkoutId,
    status: created.status || 'PENDING',
    gateway_response_json: created
  });

  dbRun(`UPDATE online_orders_local SET payment_status = ?, updated_at = ? WHERE id = ?`, [
    'PENDING',
    nowIso(),
    order.id
  ]);

  return {
    order_id: order.id,
    order_number: order.order_number,
    transaction_id: txn.id,
    provider: providerId,
    checkout_id: created.checkoutId,
    redirect_url: created.redirectUrl,
    test_mode: gw.test_mode,
    amount,
    currency
  };
}

function getTransactionByOrder(orderRef) {
  ensurePaymentGatewaySchema();
  const ref = String(orderRef || '').trim();
  let order = dbGet('SELECT * FROM online_orders_local WHERE order_number = ?', [ref]);
  if (!order && Number(ref)) order = dbGet('SELECT * FROM online_orders_local WHERE id = ?', [Number(ref)]);
  if (!order) return null;
  const txn = dbGet(
    `SELECT * FROM payment_transactions WHERE order_id = ? ORDER BY id DESC LIMIT 1`,
    [order.id]
  );
  return { order, transaction: txn };
}

function publicPaymentStatus(orderRef, webToken) {
  const online = require('../online-ordering');
  const customer = online.resolveWebCustomer(webToken);
  if (!customer) throw new Error('Please sign in');
  const pack = getTransactionByOrder(orderRef);
  if (!pack?.order) throw new Error('Order not found');
  if (Number(pack.order.web_customer_id) !== Number(customer.id)) throw new Error('Order not found');
  const txn = pack.transaction;
  const status = String(txn?.status || pack.order.payment_status || 'PENDING').toUpperCase();
  return {
    order_id: pack.order.id,
    order_number: pack.order.order_number,
    order_status: pack.order.status,
    payment_status: status,
    paid: status === 'PAID',
    amount: txn?.amount ?? pack.order.total,
    currency: txn?.currency || 'ZAR',
    gateway: txn?.gateway_provider || null,
    test_mode: (() => {
      try {
        const g = getGatewayRow(txn?.gateway_provider || 'yoco');
        return g ? (g.test_mode !== 0 && g.test_mode !== '0') : true;
      } catch (_) { return true; }
    })(),
    paid_at: txn?.paid_at || null,
    failure_reason: txn?.failure_reason || null
  };
}

/**
 * Mark order paid after gateway verification. Idempotent.
 */
async function markOrderPaidFromGateway(opts = {}) {
  ensurePaymentGatewaySchema();
  const {
    orderId,
    checkoutId,
    paymentId,
    amount,
    currency,
    provider = 'yoco',
    rawEvent = null,
    metadata = {}
  } = opts;

  const meta = metadata || rawEvent?.payload?.metadata || rawEvent?.metadata || {};

  let txn = null;
  if (checkoutId) {
    txn = dbGet('SELECT * FROM payment_transactions WHERE gateway_checkout_id = ?', [checkoutId]);
  }
  if (!txn && paymentId) {
    txn = dbGet('SELECT * FROM payment_transactions WHERE gateway_payment_id = ? OR gateway_transaction_id = ?', [paymentId, paymentId]);
  }
  if (!txn && meta.localTxnId) {
    txn = dbGet('SELECT * FROM payment_transactions WHERE id = ?', [Number(meta.localTxnId)]);
  }
  if (!txn && (orderId || meta.orderId)) {
    txn = dbGet(`SELECT * FROM payment_transactions WHERE order_id = ? ORDER BY id DESC LIMIT 1`, [
      Number(orderId || meta.orderId)
    ]);
  }
  if (!txn && meta.orderNumber) {
    txn = dbGet(`SELECT * FROM payment_transactions WHERE order_number = ? ORDER BY id DESC LIMIT 1`, [
      String(meta.orderNumber)
    ]);
  }

  if (!txn) {
    throw new Error('No matching local payment transaction for webhook');
  }

  if (String(txn.status).toUpperCase() === 'PAID') {
    return {
      duplicate: true,
      transaction: txn,
      order: dbGet('SELECT * FROM online_orders_local WHERE id = ?', [txn.order_id])
    };
  }

  const expectedAmount = round2(txn.amount);
  const paidAmount = amount != null ? round2(amount) : expectedAmount;
  if (Math.abs(paidAmount - expectedAmount) > 0.02) {
    updateTransaction(txn.id, {
      status: 'FAILED',
      failure_reason: `Amount mismatch: expected ${expectedAmount}, got ${paidAmount}`
    });
    throw new Error(`Payment amount mismatch (expected ${expectedAmount}, got ${paidAmount})`);
  }
  const expectedCurrency = String(txn.currency || 'ZAR').toUpperCase();
  const paidCurrency = String(currency || expectedCurrency).toUpperCase();
  if (paidCurrency !== expectedCurrency) {
    updateTransaction(txn.id, {
      status: 'FAILED',
      failure_reason: `Currency mismatch: expected ${expectedCurrency}, got ${paidCurrency}`
    });
    throw new Error('Payment currency mismatch');
  }

  const paidAt = nowIso();
  txn = updateTransaction(txn.id, {
    status: 'PAID',
    gateway_payment_id: paymentId || txn.gateway_payment_id,
    gateway_transaction_id: paymentId || txn.gateway_transaction_id || txn.gateway_checkout_id,
    paid_at: paidAt,
    failure_reason: null,
    gateway_response_json: rawEvent || undefined
  });

  const order = dbGet('SELECT * FROM online_orders_local WHERE id = ?', [txn.order_id]);
  if (!order) return { transaction: txn, order: null };

  const wasPendingPayment = String(order.status).toLowerCase() === 'pending_payment';
  dbRun(`UPDATE online_orders_local SET payment_status = ?, updated_at = ? WHERE id = ?`, [
    'paid',
    paidAt,
    order.id
  ]);
  if (wasPendingPayment) {
    try {
      require('../online-ordering').updateOrderStatus(order.id, 'pending', {
        id: 0,
        role: 'system',
        full_name: 'Payment Gateway'
      }, { note: `Paid via ${provider}`, skipFsm: false });
    } catch (_) {
      dbRun(`UPDATE online_orders_local SET status = 'pending', updated_at = ? WHERE id = ?`, [paidAt, order.id]);
    }
  }

  let saleResult = null;
  const fresh = dbGet('SELECT * FROM online_orders_local WHERE id = ?', [order.id]);
  if (fresh && !fresh.sale_id && String(fresh.status).toLowerCase() === 'pending') {
    try {
      saleResult = await autoAcceptPaidOrder(fresh);
      if (saleResult?.saleId) {
        updateTransaction(txn.id, { accounting_posted: 1 });
      }
    } catch (err) {
      console.warn('[payment-gateway] auto-accept after pay:', err.message || err);
    }
  } else if (fresh?.sale_id) {
    updateTransaction(txn.id, { accounting_posted: 1 });
  }

  try {
    require('../store').notifyPosOnlineOrder(dbGet('SELECT * FROM online_orders_local WHERE id = ?', [order.id]));
  } catch (_) { /* */ }

  dbRun(`UPDATE payment_gateways SET last_webhook_at = ?, last_error = NULL, updated_at = ? WHERE provider = ?`, [
    paidAt,
    paidAt,
    provider
  ]);

  return {
    duplicate: false,
    transaction: dbGet('SELECT * FROM payment_transactions WHERE id = ?', [txn.id]),
    order: dbGet('SELECT * FROM online_orders_local WHERE id = ?', [order.id]),
    sale: saleResult
  };
}

async function autoAcceptPaidOrder(order) {
  const owner = dbGet(`SELECT id, username, full_name, role FROM users
    WHERE role IN ('owner','manager') AND COALESCE(is_active,1)=1 ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END, id LIMIT 1`);
  if (!owner) throw new Error('No owner/manager available to confirm paid order');
  const store = require('../store');
  return store.acceptOnlineOrderAsSale(order.id, {
    id: owner.id,
    username: owner.username,
    full_name: owner.full_name || 'System',
    role: owner.role
  }, { fulfillment: order.fulfillment_type || order.fulfillment || 'collection' });
}

function markOrderFailedFromGateway(opts = {}) {
  ensurePaymentGatewaySchema();
  const { checkoutId, paymentId, reason, provider = 'yoco', rawEvent = null } = opts;
  let txn = checkoutId
    ? dbGet('SELECT * FROM payment_transactions WHERE gateway_checkout_id = ?', [checkoutId])
    : null;
  if (!txn && paymentId) txn = dbGet('SELECT * FROM payment_transactions WHERE gateway_payment_id = ?', [paymentId]);
  if (!txn) return { ok: false, error: 'Transaction not found' };
  if (String(txn.status).toUpperCase() === 'PAID') return { ok: true, ignored: true, transaction: txn };

  updateTransaction(txn.id, {
    status: 'FAILED',
    failure_reason: reason || 'Payment failed',
    gateway_response_json: rawEvent || undefined
  });
  if (txn.order_id) {
    dbRun(`UPDATE online_orders_local SET payment_status = ?, updated_at = ? WHERE id = ?`, [
      'FAILED',
      nowIso(),
      txn.order_id
    ]);
  }
  dbRun(`UPDATE payment_gateways SET last_webhook_at = ?, updated_at = ? WHERE provider = ?`, [
    nowIso(),
    nowIso(),
    provider
  ]);
  return { ok: true, transaction: dbGet('SELECT * FROM payment_transactions WHERE id = ?', [txn.id]) };
}

/**
 * Secure webhook entry — raw body + headers.
 */
async function processWebhook(provider, rawBody, headers) {
  ensurePaymentGatewaySchema();
  const key = String(provider || '').toLowerCase();
  const instance = getProviderInstance(key);
  const verified = instance.handleWebhook(rawBody, headers);
  if (!verified.ok) {
    dbRun(`UPDATE payment_gateways SET last_error = ?, updated_at = ? WHERE provider = ?`, [
      verified.error || 'Webhook verification failed',
      nowIso(),
      key
    ]);
    return { status: 401, body: { success: false, error: verified.error || 'Unauthorized' } };
  }

  const event = verified.event;
  // Idempotency on event id
  if (event.id) {
    try {
      dbRun(`INSERT INTO payment_webhook_events (provider, event_id, event_type, payload_json, processed, created_at)
        VALUES (?,?,?,?,0,?)`, [
        key,
        event.id,
        event.type,
        JSON.stringify(event.raw || event),
        nowIso()
      ]);
    } catch (err) {
      // Unique violation = already processed
      if (/unique|duplicate/i.test(String(err.message || err))) {
        return { status: 200, body: { success: true, duplicate: true } };
      }
      throw err;
    }
  }

  try {
    if (event.status === 'PAID' || event.type === 'payment.succeeded') {
      const meta = event.metadata || {};
      const orderId = meta.orderId || meta.order_id || null;
      const checkoutId = meta.checkoutId || meta.checkout_id || null;
      const result = await markOrderPaidFromGateway({
        orderId: orderId ? Number(orderId) : null,
        checkoutId,
        paymentId: event.paymentId,
        amount: event.amount,
        currency: event.currency,
        eventId: event.id,
        provider: key,
        rawEvent: event.raw,
        metadata: meta
      });
      if (event.id) {
        dbRun(`UPDATE payment_webhook_events SET processed = 1 WHERE provider = ? AND event_id = ?`, [key, event.id]);
      }
      return { status: 200, body: { success: true, paid: true, duplicate: !!result.duplicate } };
    }

    if (event.status === 'FAILED' || event.type === 'payment.failed') {
      markOrderFailedFromGateway({
        paymentId: event.paymentId,
        reason: 'Gateway reported payment.failed',
        provider: key,
        rawEvent: event.raw
      });
      if (event.id) {
        dbRun(`UPDATE payment_webhook_events SET processed = 1 WHERE provider = ? AND event_id = ?`, [key, event.id]);
      }
      return { status: 200, body: { success: true, failed: true } };
    }

    // Refunds etc.
    if (event.id) {
      dbRun(`UPDATE payment_webhook_events SET processed = 1 WHERE provider = ? AND event_id = ?`, [key, event.id]);
    }
    return { status: 200, body: { success: true, ignored: true, type: event.type } };
  } catch (err) {
    console.error('[payment-gateway] webhook process:', err.message || err);
    dbRun(`UPDATE payment_gateways SET last_error = ?, updated_at = ? WHERE provider = ?`, [
      String(err.message || err).slice(0, 400),
      nowIso(),
      key
    ]);
    // Return 200 for amount mismatch after recording to avoid endless retries once logged? 
    // Better return 400 so Yoco retries if our matching failed transiently.
    return { status: 400, body: { success: false, error: err.message || 'Processing failed' } };
  }
}

function listTransactions(filters = {}, actor) {
  ensurePaymentGatewaySchema();
  requireAdmin(actor);
  const where = [];
  const params = [];
  if (filters.gateway) {
    where.push('gateway_provider = ?');
    params.push(String(filters.gateway).toLowerCase());
  }
  if (filters.status) {
    where.push('UPPER(status) = ?');
    params.push(String(filters.status).toUpperCase());
  }
  if (filters.order_number) {
    where.push('order_number LIKE ?');
    params.push(`%${String(filters.order_number).trim()}%`);
  }
  if (filters.date_from) {
    where.push('created_at >= ?');
    params.push(String(filters.date_from));
  }
  if (filters.date_to) {
    where.push('created_at <= ?');
    params.push(String(filters.date_to));
  }
  const sql = `SELECT * FROM payment_transactions
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY id DESC LIMIT ?`;
  params.push(Math.min(500, Number(filters.limit) || 100));
  return dbAll(sql, params).map((r) => ({
    ...r,
    amount: round2(r.amount),
    refunded_amount: round2(r.refunded_amount),
    metadata: safeJson(r.metadata_json),
    gateway_response: safeJson(r.gateway_response_json)
  }));
}

function safeJson(s) {
  try { return s ? JSON.parse(s) : null; } catch (_) { return null; }
}

async function refundTransaction(txnId, amount, actor) {
  ensurePaymentGatewaySchema();
  requireAdmin(actor);
  const txn = dbGet('SELECT * FROM payment_transactions WHERE id = ?', [Number(txnId)]);
  if (!txn) throw new Error('Transaction not found');
  if (String(txn.status).toUpperCase() !== 'PAID' && String(txn.status).toUpperCase() !== 'PARTIALLY_REFUNDED') {
    throw new Error('Only paid transactions can be refunded');
  }
  const instance = getProviderInstance(txn.gateway_provider, { requireEnabled: false });
  const checkoutId = txn.gateway_checkout_id;
  if (!checkoutId) throw new Error('Missing gateway checkout id');
  const result = await instance.refundPayment(checkoutId, {
    amount: amount != null ? amount : undefined,
    idempotencyKey: `refund-${txn.id}-${Date.now()}`,
    metadata: { orderNumber: txn.order_number, localTxnId: String(txn.id) }
  });
  const refundAmt = amount != null ? round2(amount) : round2(txn.amount);
  const totalRefunded = round2((Number(txn.refunded_amount) || 0) + refundAmt);
  const full = totalRefunded >= round2(txn.amount) - 0.009;
  updateTransaction(txn.id, {
    status: full ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
    refund_status: full ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
    refunded_amount: totalRefunded,
    gateway_response_json: result
  });
  return { success: true, refund: result, transaction: dbGet('SELECT * FROM payment_transactions WHERE id = ?', [txn.id]) };
}

module.exports = {
  STATUSES,
  PROVIDERS,
  ensurePaymentGatewaySchema,
  listGateways,
  saveGateway,
  testConnection,
  registerWebhook,
  getEnabledOnlineMethods,
  resolveGatewayForMethod,
  isGatewayPaymentMethod,
  createPaymentForOrder,
  publicPaymentStatus,
  processWebhook,
  listTransactions,
  refundTransaction,
  markOrderPaidFromGateway,
  syncOnlinePayMethod,
  getProviderInstance
};

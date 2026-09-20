/**
 * Yoco Checkout API provider (official payments.yoco.com API).
 * Docs: https://yoco.docs.buildwithfern.com/
 */
const crypto = require('crypto');

const YOCO_API = 'https://payments.yoco.com/api';

class YocoProvider {
  constructor(config = {}) {
    this.provider = 'yoco';
    this.name = config.name || 'Yoco';
    this.config = config;
  }

  get secretKey() {
    return String(this.config.secret_key || '').trim();
  }

  get webhookSecret() {
    return String(this.config.webhook_secret || '').trim();
  }

  get publicKey() {
    return String(this.config.public_key || '').trim();
  }

  get currency() {
    return String(this.config.currency || 'ZAR').toUpperCase();
  }

  get testMode() {
    return this.config.test_mode !== false && this.config.test_mode !== 0;
  }

  authHeaders(extra = {}) {
    if (!this.secretKey) throw new Error('Yoco secret key is not configured');
    return {
      Authorization: `Bearer ${this.secretKey}`,
      'Content-Type': 'application/json',
      ...extra
    };
  }

  async api(method, path, body = null, headers = {}) {
    const opts = {
      method,
      headers: this.authHeaders(headers)
    };
    if (body != null) opts.body = JSON.stringify(body);
    const res = await fetch(`${YOCO_API}${path}`, opts);
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { data = { raw: text }; }
    if (!res.ok) {
      const msg = data?.message || data?.error || data?.reason || text || `Yoco API ${res.status}`;
      const err = new Error(String(msg).slice(0, 300));
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  /** Amount in major units → cents (minor units). */
  toMinorUnits(amount) {
    return Math.round((Number(amount) || 0) * 100);
  }

  fromMinorUnits(cents) {
    return Math.round((Number(cents) || 0)) / 100;
  }

  /**
   * Create a hosted checkout and return redirect URL.
   * @param {object} payment
   */
  async createPayment(payment = {}) {
    const amountCents = this.toMinorUnits(payment.amount);
    if (amountCents < 200) throw new Error('Yoco requires a minimum of R2.00');
    const currency = String(payment.currency || this.currency || 'ZAR').toUpperCase();
    if (currency !== 'ZAR') throw new Error('Yoco currently only supports ZAR');

    const body = {
      amount: amountCents,
      currency,
      successUrl: payment.successUrl || payment.success_url || undefined,
      cancelUrl: payment.cancelUrl || payment.cancel_url || undefined,
      failureUrl: payment.failureUrl || payment.failure_url || undefined,
      metadata: {
        ...(payment.metadata || {}),
        orderId: String(payment.orderId || payment.order_id || ''),
        orderNumber: String(payment.orderNumber || payment.order_number || ''),
        localTxnId: String(payment.localTxnId || payment.local_txn_id || '')
      },
      clientReferenceId: String(payment.clientReferenceId || payment.orderNumber || payment.order_number || payment.orderId || ''),
      externalId: String(payment.externalId || payment.orderNumber || payment.order_number || '')
    };

    const headers = {};
    if (payment.idempotencyKey) headers['Idempotency-Key'] = String(payment.idempotencyKey);

    const checkout = await this.api('POST', '/checkouts', body, headers);
    return {
      provider: this.provider,
      checkoutId: checkout.id,
      paymentId: checkout.paymentId || null,
      redirectUrl: checkout.redirectUrl,
      status: mapYocoCheckoutStatus(checkout.status),
      amount: this.fromMinorUnits(checkout.amount),
      currency: checkout.currency || currency,
      processingMode: checkout.processingMode || (this.testMode ? 'test' : 'live'),
      raw: sanitizeCheckoutResponse(checkout)
    };
  }

  async getPaymentStatus(checkoutOrPaymentId) {
    const id = String(checkoutOrPaymentId || '').trim();
    if (!id) throw new Error('Checkout/payment id required');
    // Checkout API does not document a public GET-by-id for all cases;
    // status is confirmed primarily via webhooks. Attempt checkout list is not needed.
    // Return a lightweight probe by re-registering nothing — callers use local DB + webhook.
    return {
      provider: this.provider,
      id,
      status: 'PENDING',
      note: 'Use webhook confirmation for Yoco payment status'
    };
  }

  async verifyPayment(checkoutId, expected = {}) {
    // Yoco docs: do not trust successUrl — rely on webhook.
    // Local verification compares webhook/recorded amounts.
    return {
      verified: false,
      provider: this.provider,
      checkoutId,
      expectedAmount: expected.amount,
      expectedCurrency: expected.currency || 'ZAR',
      note: 'Await webhook payment.succeeded'
    };
  }

  async refundPayment(checkoutId, opts = {}) {
    const id = String(checkoutId || '').trim();
    if (!id) throw new Error('Checkout id required for refund');
    const body = {};
    if (opts.amount != null) body.amount = this.toMinorUnits(opts.amount);
    if (opts.metadata) body.metadata = opts.metadata;
    const headers = {};
    if (opts.idempotencyKey) headers['Idempotency-Key'] = String(opts.idempotencyKey);
    const data = await this.api('POST', `/checkouts/${encodeURIComponent(id)}/refund`, body, headers);
    return {
      provider: this.provider,
      checkoutId: data.id || id,
      refundId: data.refundId,
      status: String(data.status || '').toLowerCase() === 'succeeded' ? 'REFUNDED' : 'PENDING',
      message: data.message || null,
      raw: data
    };
  }

  /**
   * Verify Standard Webhooks signature (Yoco Checkout webhooks).
   * @returns {{ ok: boolean, event?: object, error?: string }}
   */
  handleWebhook(rawBody, headers = {}) {
    const bodyStr = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '');
    const secret = this.webhookSecret;
    if (!secret) {
      return { ok: false, error: 'Webhook secret not configured' };
    }
    try {
      verifyStandardWebhook(secret, bodyStr, headers);
    } catch (err) {
      return { ok: false, error: err.message || 'Invalid webhook signature' };
    }
    let event;
    try {
      event = JSON.parse(bodyStr);
    } catch (_) {
      return { ok: false, error: 'Invalid webhook JSON' };
    }
    const type = String(event.type || '');
    const payload = event.payload || {};
    let status = 'PENDING';
    if (type === 'payment.succeeded') status = 'PAID';
    else if (type === 'payment.failed') status = 'FAILED';
    else if (/refund/i.test(type) && /partial/i.test(type)) status = 'PARTIALLY_REFUNDED';
    else if (/refund/i.test(type)) status = 'REFUNDED';

    return {
      ok: true,
      event: {
        id: event.id,
        type,
        createdDate: event.createdDate,
        status,
        paymentId: payload.id || null,
        amount: payload.amount != null ? this.fromMinorUnits(payload.amount) : null,
        amountCents: payload.amount != null ? Number(payload.amount) : null,
        currency: payload.currency || 'ZAR',
        mode: payload.mode || null,
        metadata: payload.metadata || {},
        paymentMethodDetails: payload.paymentMethodDetails || null,
        raw: event
      }
    };
  }

  /** Test connection: register/list webhooks or create a no-op API call. */
  async testConnection(publicBaseUrl) {
    if (!this.secretKey) throw new Error('Enter a Yoco secret key first');
    // Lightweight authenticated call — list webhooks
    const list = await this.api('GET', '/webhooks');
    const rows = Array.isArray(list) ? list : (list?.subscriptions || list?.data || []);
    const webhookUrl = publicBaseUrl
      ? `${String(publicBaseUrl).replace(/\/$/, '')}/api/webhooks/payments/yoco`
      : null;
    let registered = null;
    if (webhookUrl) {
      registered = (rows || []).find((w) => String(w.url || '') === webhookUrl) || null;
    }
    return {
      ok: true,
      message: 'Connected to Yoco Checkout API',
      webhookUrl,
      webhookRegistered: !!registered,
      webhookId: registered?.id || null,
      mode: this.testMode ? 'test' : 'live',
      rawCount: (rows || []).length
    };
  }

  async ensureWebhook(publicBaseUrl, name = 'Shop POS Payments') {
    const url = `${String(publicBaseUrl).replace(/\/$/, '')}/api/webhooks/payments/yoco`;
    const existing = await this.api('GET', '/webhooks');
    const rows = Array.isArray(existing) ? existing : (existing?.subscriptions || existing?.data || []);
    const found = (rows || []).find((w) => String(w.url || '') === url);
    if (found) {
      return {
        id: found.id,
        url: found.url,
        secret: null,
        alreadyRegistered: true,
        mode: found.mode
      };
    }
    const created = await this.api('POST', '/webhooks', { name, url });
    return {
      id: created.id,
      url: created.url,
      secret: created.secret || null,
      alreadyRegistered: false,
      mode: created.mode
    };
  }
}

function mapYocoCheckoutStatus(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'completed') return 'PAID';
  if (s === 'processing' || s === 'started') return 'AUTHORIZED';
  if (s === 'created') return 'PENDING';
  return 'PENDING';
}

function sanitizeCheckoutResponse(checkout) {
  if (!checkout || typeof checkout !== 'object') return null;
  return {
    id: checkout.id,
    status: checkout.status,
    amount: checkout.amount,
    currency: checkout.currency,
    paymentId: checkout.paymentId || null,
    processingMode: checkout.processingMode,
    merchantId: checkout.merchantId,
    clientReferenceId: checkout.clientReferenceId,
    externalId: checkout.externalId,
    metadata: checkout.metadata
  };
}

/**
 * Standard Webhooks verification (Yoco docs).
 * signed_content = `${webhook-id}.${webhook-timestamp}.${rawBody}`
 * secret = base64-decode(whsec_...)
 */
function verifyStandardWebhook(secret, rawBody, headers) {
  const h = normalizeHeaders(headers);
  const webhookId = h['webhook-id'];
  const timestamp = h['webhook-timestamp'];
  const signatureHeader = h['webhook-signature'];
  if (!webhookId || !timestamp || !signatureHeader) {
    throw new Error('Missing webhook signature headers');
  }

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) throw new Error('Invalid webhook timestamp');
  const skew = Math.abs(Date.now() / 1000 - ts);
  if (skew > 180) throw new Error('Webhook timestamp outside tolerance');

  const secretPart = String(secret).includes('_') ? String(secret).split('_').slice(1).join('_') : String(secret);
  const secretBytes = Buffer.from(secretPart, 'base64');
  const signedContent = `${webhookId}.${timestamp}.${rawBody}`;
  const expected = crypto.createHmac('sha256', secretBytes).update(signedContent, 'utf8').digest('base64');

  const candidates = String(signatureHeader).split(' ').map((part) => {
    const comma = part.indexOf(',');
    return comma >= 0 ? part.slice(comma + 1) : part;
  }).filter(Boolean);

  let match = false;
  for (const sig of candidates) {
    try {
      const a = Buffer.from(expected);
      const b = Buffer.from(sig);
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
        match = true;
        break;
      }
    } catch (_) { /* */ }
  }
  if (!match) throw new Error('Webhook signature mismatch');
  return true;
}

function normalizeHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers || {})) {
    const key = String(k).toLowerCase();
    out[key] = Array.isArray(v) ? v[0] : v;
  }
  return out;
}

module.exports = {
  YocoProvider,
  verifyStandardWebhook
};

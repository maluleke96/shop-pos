/**
 * Meta WhatsApp Cloud API webhooks
 * GET  /api/webhooks/whatsapp  — hub challenge verification
 * POST /api/webhooks/whatsapp  — inbound messages + delivery status
 *
 * Env (Railway / .env — never commit secrets):
 *   WHATSAPP_WEBHOOK_VERIFY_TOKEN  — string you enter in Meta “Verify token”
 *   WHATSAPP_APP_SECRET            — Meta App Secret (X-Hub-Signature-256)
 *   WHATSAPP_ACCESS_TOKEN          — permanent Cloud API token
 *   WHATSAPP_PHONE_NUMBER_ID
 *   WHATSAPP_BUSINESS_ACCOUNT_ID
 */
const crypto = require('crypto');

const DEFAULT_VERIFY_TOKEN = 'ChisaWA_Verify_9f3a2c8e7b1d4e6a';

function getVerifyToken() {
  return String(
    process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN
    || process.env.META_WA_VERIFY_TOKEN
    || DEFAULT_VERIFY_TOKEN
  ).trim();
}

function getAppSecret() {
  return String(
    process.env.WHATSAPP_APP_SECRET
    || process.env.META_APP_SECRET
    || process.env.FACEBOOK_APP_SECRET
    || ''
  ).trim();
}

function parseJson(v, fb) {
  if (v == null || v === '') return fb;
  try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return fb; }
}

/** Meta GET verification */
function handleVerify(query = {}) {
  const mode = String(query['hub.mode'] || query.hub_mode || '').trim();
  const token = String(query['hub.verify_token'] || query.hub_verify_token || '').trim();
  const challenge = String(query['hub.challenge'] || query.hub_challenge || '').trim();
  const expected = getVerifyToken();

  if (mode === 'subscribe' && token && expected && token === expected) {
    return { ok: true, status: 200, body: challenge, contentType: 'text/plain; charset=utf-8' };
  }
  return {
    ok: false,
    status: 403,
    body: JSON.stringify({ error: 'WhatsApp webhook verification failed' }),
    contentType: 'application/json; charset=utf-8'
  };
}

function verifySignature(rawBody, headers = {}) {
  const secret = getAppSecret();
  if (!secret) {
    console.warn('[whatsapp-webhook] WHATSAPP_APP_SECRET not set — skipping signature check');
    return true;
  }
  const header = String(
    headers['x-hub-signature-256']
    || headers['X-Hub-Signature-256']
    || ''
  ).trim();
  if (!header.startsWith('sha256=')) return false;
  const their = header.slice('sha256='.length);
  const raw = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || ''), 'utf8');
  const ours = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(ours, 'hex'), Buffer.from(their, 'hex'));
  } catch {
    return false;
  }
}

function updateOutboundStatus(wamid, status, timestamp, errors) {
  if (!wamid) return;
  try {
    const { getDb } = require('../database/db');
    const db = getDb();
    const rows = db.prepare(`
      SELECT id, status, metadata_json FROM whatsapp_messages
      WHERE metadata_json LIKE ?
      ORDER BY id DESC LIMIT 20
    `).all(`%${String(wamid).replace(/%/g, '')}%`) || [];

    const mapStatus = {
      sent: 'sent',
      delivered: 'opened',
      read: 'opened',
      failed: 'failed'
    };
    const next = mapStatus[status] || (status === 'received' ? 'opened' : 'sent');

    rows.forEach((row) => {
      const meta = parseJson(row.metadata_json, {});
      if (meta.cloud_message_id !== wamid && meta.wamid !== wamid) return;
      meta.webhook_status = status;
      meta.webhook_at = timestamp || new Date().toISOString();
      if (errors) meta.webhook_errors = errors;
      try {
        db.prepare(`UPDATE whatsapp_messages SET status = ?, metadata_json = ? WHERE id = ?`)
          .run(next, JSON.stringify(meta), row.id);
      } catch (_) {
        db.prepare(`UPDATE whatsapp_messages SET metadata_json = ? WHERE id = ?`)
          .run(JSON.stringify(meta), row.id);
      }
    });

    try {
      db.prepare(`
        UPDATE cc_queue SET status = ?,
          delivered_at = CASE WHEN ? IN ('delivered','read') THEN COALESCE(delivered_at, datetime('now')) ELSE delivered_at END,
          last_error = CASE WHEN ? = 'failed' THEN ? ELSE last_error END
        WHERE external_id = ? AND channel = 'whatsapp'
      `).run(
        next === 'failed' ? 'failed' : (next === 'delivered' || next === 'read' ? 'delivered' : 'sent'),
        next,
        next,
        errors ? JSON.stringify(errors).slice(0, 500) : null,
        wamid
      );
    } catch (_) { /* cc_queue may not exist yet */ }
  } catch (err) {
    console.warn('[whatsapp-webhook] status update:', err.message || err);
  }
}

function storeInboundMessage(msg, contacts, metadata) {
  try {
    const { getDb } = require('../database/db');
    const db = getDb();
    const from = msg.from || '';
    const contactName = contacts?.[0]?.profile?.name || from;
    let body = '';
    const type = msg.type || 'text';
    if (type === 'text') body = msg.text?.body || '';
    else if (type === 'button') body = msg.button?.text || msg.button?.payload || '';
    else if (type === 'interactive') {
      body = msg.interactive?.button_reply?.title
        || msg.interactive?.list_reply?.title
        || JSON.stringify(msg.interactive || {}).slice(0, 500);
    } else {
      body = `[${type}]`;
    }
    const meta = {
      direction: 'inbound',
      wamid: msg.id,
      type,
      timestamp: msg.timestamp,
      phone_number_id: metadata?.phone_number_id,
      display_phone: metadata?.display_phone_number,
      raw_type: type
    };
    db.prepare(`
      INSERT INTO whatsapp_messages (
        recipient_type, recipient_id, recipient_name, phone, message_type, template_id,
        campaign_id, body, status, sender_id, sender_name, branch_id, sale_id, metadata_json
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      'customer',
      null,
      contactName,
      from,
      'inbound',
      null,
      null,
      body.slice(0, 4000),
      'opened',
      null,
      'whatsapp-webhook',
      null,
      null,
      JSON.stringify(meta)
    );

    try {
      require('./store').addNotification(
        'whatsapp_inbound',
        'WhatsApp message received',
        `${contactName}: ${body.slice(0, 120)}`,
        { entity_type: 'whatsapp', audience_roles: 'owner,manager' }
      );
    } catch (_) { /* */ }
  } catch (err) {
    console.warn('[whatsapp-webhook] inbound store:', err.message || err);
  }
}

function processPayload(payload) {
  const entries = payload?.entry || [];
  let statuses = 0;
  let messages = 0;
  entries.forEach((entry) => {
    (entry.changes || []).forEach((change) => {
      if (change.field && change.field !== 'messages') return;
      const value = change.value || {};
      const metadata = value.metadata || {};
      const contacts = value.contacts || [];

      (value.statuses || []).forEach((st) => {
        updateOutboundStatus(st.id, st.status, st.timestamp, st.errors);
        statuses += 1;
      });

      (value.messages || []).forEach((msg) => {
        storeInboundMessage(msg, contacts, metadata);
        messages += 1;
      });
    });
  });
  return { statuses, messages };
}

/** Meta POST webhook */
function handleEvent(rawBody, headers = {}) {
  if (!verifySignature(rawBody, headers)) {
    return {
      ok: false,
      status: 401,
      body: { success: false, error: 'Invalid signature' }
    };
  }
  let payload;
  try {
    const text = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '');
    payload = JSON.parse(text || '{}');
  } catch {
    return { ok: false, status: 400, body: { success: false, error: 'Invalid JSON' } };
  }

  try {
    const summary = processPayload(payload);
    return { ok: true, status: 200, body: { success: true, ...summary } };
  } catch (err) {
    console.error('[whatsapp-webhook] process error:', err.message || err);
    return { ok: true, status: 200, body: { success: true, processed: false } };
  }
}

function webhookPublicInfo() {
  const { getPublicUrl } = require('../../lib/public-url');
  const base = getPublicUrl();
  return {
    callback_url: `${base}/api/webhooks/whatsapp`,
    verify_token: getVerifyToken(),
    subscribe_fields: ['messages'],
    env_required: [
      'WHATSAPP_ACCESS_TOKEN',
      'WHATSAPP_PHONE_NUMBER_ID',
      'WHATSAPP_BUSINESS_ACCOUNT_ID',
      'WHATSAPP_WEBHOOK_VERIFY_TOKEN',
      'WHATSAPP_APP_SECRET'
    ]
  };
}

module.exports = {
  DEFAULT_VERIFY_TOKEN,
  getVerifyToken,
  getAppSecret,
  handleVerify,
  handleEvent,
  webhookPublicInfo,
  verifySignature,
  processPayload
};

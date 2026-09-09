/**
 * Communication Centre — provider adapters (server-side only).
 * Credentials never leave this layer unmasked.
 */
const https = require('https');
const http = require('http');

function maskConfig(config = {}) {
  const out = { ...config };
  for (const k of Object.keys(out)) {
    if (/secret|password|api_key|apikey|token|auth/i.test(k) && out[k]) {
      out[k] = '••••••••';
    }
  }
  return out;
}

function httpRequest(url, options = {}, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function sendViaConsole(channel, payload) {
  return {
    ok: true,
    providerMessageId: `console_${Date.now()}`,
    response: { mode: 'console', channel, to: payload.to, preview: String(payload.body || '').slice(0, 120) }
  };
}

async function sendViaHttpSms(config, payload) {
  const endpoint = config.endpoint || config.api_url;
  if (!endpoint) throw new Error('SMS provider endpoint not configured');
  const headers = { 'Content-Type': 'application/json', ...(config.headers || {}) };
  if (config.api_key) headers.Authorization = `Bearer ${config.api_key}`;
  const body = JSON.stringify({
    to: payload.to,
    message: payload.body,
    from: config.sender_id || config.from
  });
  const res = await httpRequest(endpoint, { method: 'POST', headers }, body);
  if (res.status >= 400) throw new Error(`SMS API error (${res.status}): ${res.body.slice(0, 200)}`);
  let parsed = {};
  try { parsed = JSON.parse(res.body); } catch (_) { parsed = { raw: res.body }; }
  return { ok: true, providerMessageId: parsed.messageId || parsed.id || parsed.sid || null, response: parsed };
}

async function sendViaHttpWhatsapp(config, payload) {
  const endpoint = config.endpoint || config.api_url;
  if (!endpoint) {
    const phone = String(payload.to || '').replace(/\D/g, '');
    return {
      ok: true,
      providerMessageId: `wa_link_${phone}`,
      response: { mode: 'deeplink', url: `https://wa.me/${phone}?text=${encodeURIComponent(payload.body || '')}` }
    };
  }
  const headers = { 'Content-Type': 'application/json', ...(config.headers || {}) };
  if (config.api_key) headers.Authorization = `Bearer ${config.api_key}`;
  const body = JSON.stringify({
    to: payload.to,
    type: 'text',
    text: { body: payload.body },
    template: payload.templateName || undefined
  });
  const res = await httpRequest(endpoint, { method: 'POST', headers }, body);
  if (res.status >= 400) throw new Error(`WhatsApp API error (${res.status}): ${res.body.slice(0, 200)}`);
  let parsed = {};
  try { parsed = JSON.parse(res.body); } catch (_) { parsed = { raw: res.body }; }
  return { ok: true, providerMessageId: parsed.messages?.[0]?.id || parsed.id || null, response: parsed };
}

async function sendViaHttpEmail(config, payload) {
  const endpoint = config.endpoint || config.api_url;
  if (!endpoint) throw new Error('Email provider endpoint not configured');
  const headers = { 'Content-Type': 'application/json', ...(config.headers || {}) };
  if (config.api_key) headers.Authorization = `Bearer ${config.api_key}`;
  const body = JSON.stringify({
    to: payload.to,
    from: config.from_email || config.from,
    from_name: config.from_name,
    subject: payload.subject || '(no subject)',
    html: payload.html || payload.body,
    text: payload.text || payload.body
  });
  const res = await httpRequest(endpoint, { method: 'POST', headers }, body);
  if (res.status >= 400) throw new Error(`Email API error (${res.status}): ${res.body.slice(0, 200)}`);
  let parsed = {};
  try { parsed = JSON.parse(res.body); } catch (_) { parsed = { raw: res.body }; }
  return { ok: true, providerMessageId: parsed.id || parsed.messageId || null, response: parsed };
}

async function sendViaInAppPush(dbRun, payload) {
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  dbRun(`
    INSERT INTO notifications (title, message, type, audience_roles, is_read, created_at)
    VALUES (?, ?, 'info', ?, 0, ?)
  `, [payload.subject || 'Notification', payload.body, JSON.stringify(['customer']), now]);
  if (payload.customerId) {
    try {
      dbRun(`
        INSERT INTO mobile_notifications (customer_id, title, body, type, is_read, created_at)
        VALUES (?, ?, ?, 'push', 0, ?)
      `, [payload.customerId, payload.subject || 'Notification', payload.body, now]);
    } catch (_) { /* table optional */ }
  }
  return { ok: true, providerMessageId: `push_${Date.now()}`, response: { mode: 'in_app_push' } };
}

async function testProvider(channel, providerKey, config) {
  const testPayload = {
    to: config.test_recipient || config.test_phone || config.test_email || 'test',
    subject: 'Shop POS Communication Centre — test',
    body: 'This is a test message from your Communication Centre.',
    customerId: null
  };
  if (providerKey === 'console') return sendViaConsole(channel, testPayload);
  if (channel === 'sms') return sendViaHttpSms(config, testPayload);
  if (channel === 'whatsapp') return sendViaHttpWhatsapp(config, testPayload);
  if (channel === 'email') return sendViaHttpEmail(config, testPayload);
  if (channel === 'push') return { ok: true, providerMessageId: 'push_test', response: { mode: 'push_test_ok' } };
  throw new Error(`Unknown provider: ${channel}/${providerKey}`);
}

async function sendMessage({ channel, providerKey, config, payload, dbRun }) {
  if (providerKey === 'console' || !providerKey) return sendViaConsole(channel, payload);
  if (channel === 'sms') return sendViaHttpSms(config, payload);
  if (channel === 'whatsapp') return sendViaHttpWhatsapp(config, payload);
  if (channel === 'email') return sendViaHttpEmail(config, payload);
  if (channel === 'push') return sendViaInAppPush(dbRun, payload);
  throw new Error(`Unsupported channel: ${channel}`);
}

module.exports = {
  maskConfig,
  testProvider,
  sendMessage
};

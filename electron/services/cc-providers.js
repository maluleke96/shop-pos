/**
 * Outbound providers for SMS / WhatsApp / Email.
 * Secrets are read from server environment variables only (Railway variables) —
 * never from the database, source code or the browser.
 */
const control = require('./cc-control');

const SMS_ENV = ['VODACOM_SMS_BASE_URL', 'VODACOM_SMS_CLIENT_ID', 'VODACOM_SMS_CLIENT_SECRET', 'VODACOM_SMS_SENDER'];
const SMTP_ENV = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS'];
const EMAIL_API_PROVIDERS = ['sendgrid', 'brevo', 'mailgun', 'resend'];

// The Vodacom API Pulse "Communication management" specification (Swagger) is only
// downloadable from a logged-in API Pulse account. Until it is supplied, the adapter
// refuses to send instead of guessing endpoints.
const VODACOM_SPEC_READY = false;

function env(name) { return String(process.env[name] || '').trim(); }
function missing(list) { return list.filter((n) => !env(n)); }

function whatsappCreds() {
  try {
    const wa = require('./whatsapp');
    const raw = wa.getWhatsAppSettingsRaw();
    const fromEnv = wa.envWhatsAppCreds();
    return {
      token: String(raw.api_key || '').trim(),
      phoneId: String(raw.phone_number_id || '').trim(),
      tokenSource: fromEnv.api_key ? 'environment' : (raw.api_key ? 'database_legacy' : 'missing'),
      otpTemplate: String(raw.verification_template || raw.otp_template || '').trim(),
      otpTemplateLang: String(raw.verification_template_lang || 'en').trim() || 'en',
      useCloud: raw.use_cloud_api !== false
    };
  } catch (_) {
    return { token: '', phoneId: '', tokenSource: 'missing', otpTemplate: '', otpTemplateLang: 'en', useCloud: false };
  }
}

function emailApiProvider() {
  const p = env('EMAIL_API_PROVIDER').toLowerCase();
  return EMAIL_API_PROVIDERS.includes(p) ? p : '';
}

function emailApiMissing() {
  const p = emailApiProvider();
  const m = [];
  if (!p) m.push('EMAIL_API_PROVIDER');
  if (!env('EMAIL_API_KEY')) m.push('EMAIL_API_KEY');
  if (p === 'mailgun' && !env('EMAIL_API_DOMAIN')) m.push('EMAIL_API_DOMAIN');
  return m;
}

function emailFrom() {
  const c = control.getControl().email || {};
  const email = c.from_email || env('EMAIL_FROM');
  let name = c.from_name || env('EMAIL_FROM_NAME');
  if (!name) {
    try { name = require('../database/db').getDb().prepare('SELECT shop_name FROM shop_settings WHERE id = 1').get()?.shop_name || ''; } catch (_) { /* */ }
  }
  return { email, name, replyTo: c.reply_to || env('EMAIL_REPLY_TO') || '' };
}

function providerStatus() {
  const wa = whatsappCreds();
  const c = control.getControl();
  const from = emailFrom();
  const smtpMissing = missing(SMTP_ENV);
  const apiMissing = emailApiMissing();
  return {
    sms: {
      provider: 'vodacom',
      configured: false,
      ready: false,
      verification: VODACOM_SPEC_READY ? 'pending_live_test' : 'UNVERIFIED',
      env_missing: missing(SMS_ENV),
      spec_ready: VODACOM_SPEC_READY,
      note: VODACOM_SPEC_READY
        ? ''
        : 'UNVERIFIED. The official Vodacom API Pulse specification has not been supplied, so SMS sending is disabled. No API URL, payload or authentication flow is guessed.'
    },
    whatsapp: {
      provider: 'whatsapp_cloud',
      configured: !!(wa.token && wa.phoneId),
      ready: !!(wa.token && wa.phoneId && wa.useCloud),
      token_source: wa.tokenSource,
      phone_number_id_set: !!wa.phoneId,
      otp_template: wa.otpTemplate || null,
      env_missing: ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID'].filter((n) => !env(n)),
      note: wa.tokenSource === 'database_legacy'
        ? 'Access token is still stored in the database (legacy). Add WHATSAPP_ACCESS_TOKEN in Railway variables to move it to the server environment.'
        : (!wa.otpTemplate ? 'No approved WhatsApp authentication template set — OTP uses a session text message, which Meta only delivers inside a 24-hour customer conversation window.' : '')
    },
    email: {
      primary: c.email.primary,
      fallback: c.email.fallback,
      from_email: from.email || null,
      from_name: from.name || null,
      smtp: { configured: !smtpMissing.length, env_missing: smtpMissing, secure: env('SMTP_SECURE') || 'auto' },
      api: { provider: emailApiProvider() || null, configured: !apiMissing.length, env_missing: apiMissing },
      ready: !!from.email && (
        (c.email.primary === 'smtp' ? !smtpMissing.length : !apiMissing.length)
        || (c.email.fallback === 'smtp' && !smtpMissing.length)
        || (c.email.fallback === 'api' && !apiMissing.length)
      ),
      note: !from.email ? 'Set the "From" email address in Communication Center → Providers (or EMAIL_FROM).' : ''
    }
  };
}

// ── SMS ─────────────────────────────────────────────────────────────
async function sendSms({ to }) {
  if (!to) return { ok: false, provider: 'vodacom', error: 'No SMS phone number' };
  if (!VODACOM_SPEC_READY) {
    return { ok: false, provider: 'vodacom', not_configured: true, error: 'Vodacom SMS is not available yet (awaiting official API specification)' };
  }
  return { ok: false, provider: 'vodacom', not_configured: true, error: 'Vodacom SMS adapter not implemented' };
}

// ── WhatsApp ────────────────────────────────────────────────────────
async function sendWhatsApp({ to, text, template, otpCode }) {
  const wa = whatsappCreds();
  if (!to) return { ok: false, provider: 'whatsapp_cloud', error: 'No WhatsApp number' };
  if (!wa.token || !wa.phoneId || !wa.useCloud) {
    return { ok: false, provider: 'whatsapp_cloud', not_configured: true, error: 'WhatsApp Cloud API not configured' };
  }
  const waSvc = require('./whatsapp');
  const digits = waSvc.e164Digits(to);
  if (!digits) return { ok: false, provider: 'whatsapp_cloud', error: 'Invalid WhatsApp number' };
  const post = (payload) => waSvc.postWhatsAppCloud(wa.phoneId, wa.token, { messaging_product: 'whatsapp', to: digits, ...payload });
  try {
    const tplName = template?.name || (otpCode ? wa.otpTemplate : '');
    if (tplName) {
      const lang = template?.language || wa.otpTemplateLang;
      const params = otpCode ? [String(otpCode)] : (template?.params || []);
      const body = { type: 'body', parameters: params.map((p) => ({ type: 'text', text: String(p ?? '') })) };
      let r = await post({ type: 'template', template: { name: tplName, language: { code: lang }, components: params.length ? [body] : [] } });
      if (!r.ok && otpCode) {
        // Authentication templates with a copy-code button also need the code on the button.
        r = await post({
          type: 'template',
          template: {
            name: tplName,
            language: { code: lang },
            components: [body, { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: String(otpCode) }] }]
          }
        });
      }
      if (r.ok) return { ok: true, provider: 'whatsapp_cloud', external_id: r.id || null };
      if (template?.name) return { ok: false, provider: 'whatsapp_cloud', error: r.error };
    }
    const r2 = await post({ type: 'text', text: { preview_url: false, body: String(text || '').slice(0, 4096) } });
    return r2.ok
      ? { ok: true, provider: 'whatsapp_cloud', external_id: r2.id || null }
      : { ok: false, provider: 'whatsapp_cloud', error: r2.error };
  } catch (err) {
    return { ok: false, provider: 'whatsapp_cloud', error: err.message || String(err) };
  }
}

// ── Email ───────────────────────────────────────────────────────────
let _smtp = null;
let _smtpKey = '';
function smtpTransport() {
  const key = SMTP_ENV.map(env).join('|') + env('SMTP_SECURE');
  if (_smtp && _smtpKey === key) return _smtp;
  const nodemailer = require('nodemailer');
  const port = Number(env('SMTP_PORT')) || 587;
  const secureEnv = env('SMTP_SECURE').toLowerCase();
  _smtp = nodemailer.createTransport({
    host: env('SMTP_HOST'),
    port,
    secure: secureEnv ? ['1', 'true', 'yes'].includes(secureEnv) : port === 465,
    auth: { user: env('SMTP_USER'), pass: env('SMTP_PASS') },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000
  });
  _smtpKey = key;
  return _smtp;
}

async function sendViaSmtp(msg, from) {
  if (missing(SMTP_ENV).length) return { ok: false, provider: 'smtp', not_configured: true, error: 'SMTP not configured' };
  try {
    const info = await smtpTransport().sendMail({
      from: from.name ? `"${from.name.replace(/"/g, '')}" <${from.email}>` : from.email,
      to: msg.to,
      replyTo: from.replyTo || undefined,
      subject: msg.subject,
      text: msg.text,
      html: msg.html
    });
    if (Array.isArray(info.rejected) && info.rejected.length) {
      return { ok: false, provider: 'smtp', error: `SMTP rejected recipient: ${info.rejected.join(', ')}` };
    }
    return { ok: true, provider: 'smtp', external_id: info.messageId || null };
  } catch (err) {
    return { ok: false, provider: 'smtp', error: err.message || String(err) };
  }
}

async function postJson(url, headers, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const text = await res.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch (_) { json = { raw: text.slice(0, 200) }; }
  return { res, json };
}

async function sendViaApi(msg, from) {
  const provider = emailApiProvider();
  if (emailApiMissing().length) return { ok: false, provider: `api:${provider || 'none'}`, not_configured: true, error: 'Email API not configured' };
  const key = env('EMAIL_API_KEY');
  const tag = `api:${provider}`;
  try {
    if (provider === 'sendgrid') {
      const { res, json } = await postJson('https://api.sendgrid.com/v3/mail/send', { Authorization: `Bearer ${key}` }, {
        personalizations: [{ to: [{ email: msg.to }] }],
        from: { email: from.email, name: from.name || undefined },
        reply_to: from.replyTo ? { email: from.replyTo } : undefined,
        subject: msg.subject,
        content: [{ type: 'text/plain', value: msg.text || ' ' }, { type: 'text/html', value: msg.html || msg.text || ' ' }]
      });
      if (res.status !== 202 && !res.ok) return { ok: false, provider: tag, error: json?.errors?.[0]?.message || `SendGrid HTTP ${res.status}` };
      return { ok: true, provider: tag, external_id: res.headers.get('x-message-id') || null };
    }
    if (provider === 'brevo') {
      const { res, json } = await postJson('https://api.brevo.com/v3/smtp/email', { 'api-key': key, accept: 'application/json' }, {
        sender: { email: from.email, name: from.name || undefined },
        to: [{ email: msg.to }],
        replyTo: from.replyTo ? { email: from.replyTo } : undefined,
        subject: msg.subject,
        htmlContent: msg.html || undefined,
        textContent: msg.text || undefined
      });
      if (!res.ok) return { ok: false, provider: tag, error: json?.message || `Brevo HTTP ${res.status}` };
      return { ok: true, provider: tag, external_id: json?.messageId || null };
    }
    if (provider === 'resend') {
      const { res, json } = await postJson('https://api.resend.com/emails', { Authorization: `Bearer ${key}` }, {
        from: from.name ? `${from.name} <${from.email}>` : from.email,
        to: [msg.to],
        reply_to: from.replyTo || undefined,
        subject: msg.subject,
        html: msg.html || undefined,
        text: msg.text || undefined
      });
      if (!res.ok) return { ok: false, provider: tag, error: json?.message || `Resend HTTP ${res.status}` };
      return { ok: true, provider: tag, external_id: json?.id || null };
    }
    if (provider === 'mailgun') {
      const host = env('EMAIL_API_REGION').toLowerCase() === 'eu' ? 'api.eu.mailgun.net' : 'api.mailgun.net';
      const form = new URLSearchParams();
      form.set('from', from.name ? `${from.name} <${from.email}>` : from.email);
      form.set('to', msg.to);
      form.set('subject', msg.subject);
      if (msg.text) form.set('text', msg.text);
      if (msg.html) form.set('html', msg.html);
      if (from.replyTo) form.set('h:Reply-To', from.replyTo);
      const res = await fetch(`https://${host}/v3/${encodeURIComponent(env('EMAIL_API_DOMAIN'))}/messages`, {
        method: 'POST',
        headers: { Authorization: `Basic ${Buffer.from(`api:${key}`).toString('base64')}` },
        body: form
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, provider: tag, error: json?.message || `Mailgun HTTP ${res.status}` };
      return { ok: true, provider: tag, external_id: json?.id || null };
    }
    return { ok: false, provider: tag, error: 'Unsupported email API provider' };
  } catch (err) {
    return { ok: false, provider: tag, error: err.message || String(err) };
  }
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Tries the primary email provider, then the optional fallback. */
async function sendEmail({ to, subject, text, html }) {
  if (!to || !String(to).includes('@')) return { ok: false, provider: 'email', error: 'No email address' };
  const from = emailFrom();
  if (!from.email) return { ok: false, provider: 'email', not_configured: true, error: 'Email "From" address not set' };
  const msg = {
    to: String(to).trim(),
    subject: String(subject || 'Message').slice(0, 250),
    text: text || '',
    html: html || `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5">${escapeHtml(text).replace(/\n/g, '<br>')}</div>`
  };
  const cfg = control.getControl().email;
  const order = [cfg.primary, cfg.fallback].filter((p, i, a) => p && p !== 'none' && a.indexOf(p) === i);
  const errors = [];
  let lastNotConfigured = true;
  for (const p of order) {
    const r = p === 'smtp' ? await sendViaSmtp(msg, from) : await sendViaApi(msg, from);
    if (r.ok) return { ...r, used_fallback: p !== cfg.primary, errors };
    errors.push(`${r.provider}: ${r.error}`);
    if (!r.not_configured) lastNotConfigured = false;
  }
  return { ok: false, provider: 'email', not_configured: lastNotConfigured, error: errors.join(' | ') || 'No email provider configured' };
}

async function send(channel, msg) {
  if (channel === 'sms') return sendSms(msg);
  if (channel === 'whatsapp') return sendWhatsApp(msg);
  if (channel === 'email') return sendEmail(msg);
  return { ok: false, error: `Unsupported channel ${channel}` };
}

module.exports = { providerStatus, send, sendSms, sendWhatsApp, sendEmail, whatsappCreds, VODACOM_SPEC_READY };

/**
 * Communication Center phase 2: channel templates, scheduled messages (confirm before send),
 * reminders, loyalty points notifications and customer communication preferences / opt-out.
 * Everything is queued through communication-center.js so switches, limits, dedupe and logs apply.
 */
const crypto = require('crypto');
const { getDb } = require('../database/db');
const control = require('./cc-control');

const cc = () => require('./communication-center');
function dbRun(sql, p = []) { return getDb().prepare(sql).run(...p); }
function dbGet(sql, p = []) { return getDb().prepare(sql).get(...p); }
function dbAll(sql, p = []) { return getDb().prepare(sql).all(...p); }
const nowIso = control.nowIso;
const parseJson = control.parseJson;

const TEMPLATE_VARIABLES = [
  'customer_name', 'shop_name', 'branch_name', 'product_name', 'points_earned', 'points_balance',
  'order_number', 'order_total', 'shop_phone', 'shop_address', 'order_link', 'date', 'time', 'website'
];

const CHANNEL_TEMPLATES = [
  { slug: 'cc_welcome', name: 'Welcome', category: 'marketing',
    body: 'Hi {customer_name}, welcome to {shop_name}! Order online at {order_link}.',
    sms: 'Welcome to {shop_name}, {customer_name}! Order at {order_link}',
    subject: 'Welcome to {shop_name}' },
  { slug: 'cc_points_earned', name: 'Points Earned', category: 'loyalty',
    body: 'Hi {customer_name}, you earned {points_earned} loyalty points at {shop_name} (order {order_number}). Your balance is now {points_balance} points.',
    sms: '{shop_name}: +{points_earned} pts (order {order_number}). Balance {points_balance} pts.',
    subject: 'You earned {points_earned} points at {shop_name}' },
  { slug: 'cc_points_balance', name: 'Points Balance', category: 'loyalty',
    body: 'Hi {customer_name}, you have {points_balance} loyalty points at {shop_name}.',
    sms: '{shop_name}: you have {points_balance} loyalty points.',
    subject: 'Your {shop_name} points balance' },
  { slug: 'cc_order_received', name: 'Order Received', category: 'orders',
    body: 'Hi {customer_name}, {shop_name} received your order {order_number} ({order_total}). Thank you!',
    sms: '{shop_name}: order {order_number} received ({order_total}).',
    subject: 'Order {order_number} received' },
  { slug: 'cc_order_ready_v2', name: 'Order Ready', category: 'orders',
    body: 'Hi {customer_name}, your order {order_number} is ready at {branch_name}.',
    sms: '{shop_name}: order {order_number} is ready.',
    subject: 'Order {order_number} is ready' },
  { slug: 'cc_order_delivered', name: 'Order Delivered', category: 'delivery',
    body: 'Hi {customer_name}, your order {order_number} was delivered. Enjoy! — {shop_name}',
    sms: '{shop_name}: order {order_number} delivered. Enjoy!',
    subject: 'Order {order_number} delivered' },
  { slug: 'cc_payment_confirmed', name: 'Payment Confirmation', category: 'payments',
    body: 'Hi {customer_name}, we received your payment of {order_total} for order {order_number}. — {shop_name}',
    sms: '{shop_name}: payment {order_total} received for {order_number}.',
    subject: 'Payment received — order {order_number}' },
  { slug: 'cc_reminder', name: 'Reminder', category: 'reminder',
    body: 'Hi {customer_name}, a friendly reminder from {shop_name}. Call {shop_phone} or order at {order_link}.',
    sms: '{shop_name} reminder. Order at {order_link}',
    subject: 'A reminder from {shop_name}' },
  { slug: 'cc_birthday', name: 'Birthday', category: 'marketing',
    body: 'Happy birthday {customer_name}! Everyone at {shop_name} wishes you a great day.',
    sms: 'Happy birthday {customer_name}! From {shop_name}',
    subject: 'Happy birthday from {shop_name}' },
  { slug: 'cc_loyalty_reward', name: 'Loyalty Reward', category: 'loyalty',
    body: 'Hi {customer_name}, you have {points_balance} points — enough for a reward at {shop_name}!',
    sms: '{shop_name}: {points_balance} pts — claim a reward!',
    subject: 'You have a reward waiting at {shop_name}' },
  { slug: 'cc_promotion', name: 'Promotion', category: 'marketing',
    body: 'Hi {customer_name}, special offer at {shop_name}! Order at {order_link}.',
    sms: '{shop_name} special offer! {order_link}',
    subject: 'Special offer at {shop_name}' },
  { slug: 'cc_buy_x_get_x', name: 'Buy X Get X Free', category: 'marketing',
    body: 'Hi {customer_name}, buy {product_name} and get one FREE at {shop_name}! Order at {order_link}.',
    sms: '{shop_name}: buy {product_name}, get 1 FREE! {order_link}',
    subject: 'Buy one, get one free at {shop_name}' },
  { slug: 'cc_reengagement', name: 'We Miss You', category: 'marketing',
    body: 'Hi {customer_name}, we miss you at {shop_name}! Come back and order at {order_link}.',
    sms: 'We miss you at {shop_name}! {order_link}',
    subject: 'We miss you at {shop_name}' }
];

let _seeded = false;
function ensureSeeded() {
  cc().ensureSchema();
  if (_seeded) return;
  CHANNEL_TEMPLATES.forEach((t) => {
    try {
      dbRun(`INSERT OR IGNORE INTO cc_templates (slug, name, category, channel, subject, body, is_builtin, enabled, sms_body, email_subject, email_text, wa_language)
        VALUES (?, ?, ?, 'any', ?, ?, 1, 1, ?, ?, ?, 'en')`,
      [t.slug, t.name, t.category, t.subject, t.body, t.sms, t.subject, t.body]);
    } catch (_) { /* */ }
  });
  [
    ['loyalty.points_earned', 'Points Earned', 'loyalty'],
    ['schedule.message', 'Scheduled Message', 'marketing'],
    ['reminder.message', 'Reminder', 'marketing']
  ].forEach(([key, label, cat]) => {
    try {
      dbRun(`INSERT OR IGNORE INTO cc_event_types (event_key, label, category, default_channels_json, default_recipients_json, is_transactional, enabled)
        VALUES (?, ?, ?, '["whatsapp"]', '["customer"]', 0, 1)`, [key, label, cat]);
    } catch (_) { /* */ }
  });
  _seeded = true;
}

// ── Templates ──────────────────────────────────────────────────────
function unknownVariables(...texts) {
  const found = new Set();
  texts.join(' ').replace(/\{\{?([a-z_]+)\}?\}/gi, (_, v) => { found.add(v.toLowerCase()); return ''; });
  return [...found].filter((v) => !TEMPLATE_VARIABLES.includes(v) && !['branch', 'verification_code', 'expiry', 'announcement', 'promotion_name', 'driver_name', 'delivery_address'].includes(v));
}

function saveChannelTemplate(data, actor) {
  ensureSeeded();
  const name = String(data.name || '').trim();
  const body = String(data.body || '').trim();
  if (!name) throw new Error('Template name is required');
  if (!body && !data.sms_body && !data.email_text) throw new Error('Template text is required');
  const smsBody = String(data.sms_body || '').trim();
  const emailSubject = String(data.email_subject || '').trim();
  const emailHtml = String(data.email_html || '');
  const emailText = String(data.email_text || '').trim();
  const bad = unknownVariables(body, smsBody, emailSubject, emailHtml, emailText);
  if (bad.length) throw new Error(`Unknown variable(s): ${bad.map((v) => `{${v}}`).join(', ')}`);
  if (/<script|javascript:|on\w+\s*=/i.test(emailHtml)) throw new Error('Email HTML may not contain scripts or event handlers');
  const waVars = Array.isArray(data.wa_variables) ? data.wa_variables : parseJson(data.wa_variables_json, []);
  const waBad = (waVars || []).filter((v) => !TEMPLATE_VARIABLES.includes(v));
  if (waBad.length) throw new Error(`Unknown WhatsApp variable(s): ${waBad.join(', ')}`);
  const status = ['approved', 'pending', 'rejected', 'not_submitted'].includes(data.wa_approval_status) ? data.wa_approval_status : 'not_submitted';
  const vals = [name, data.category || 'general', emailSubject || null, body || emailText || smsBody,
    data.enabled === false ? 0 : 1, smsBody || null, String(data.wa_template_name || '').trim() || null,
    String(data.wa_language || 'en').trim() || 'en', JSON.stringify(waVars || []), status,
    emailSubject || null, emailHtml || null, emailText || null, nowIso()];
  let id = Number(data.id) || 0;
  if (id) {
    const before = dbGet('SELECT * FROM cc_templates WHERE id = ?', [id]);
    if (!before) throw new Error('Template not found');
    dbRun(`UPDATE cc_templates SET name=?, category=?, subject=?, body=?, enabled=?, sms_body=?, wa_template_name=?, wa_language=?,
      wa_variables_json=?, wa_approval_status=?, email_subject=?, email_html=?, email_text=?, updated_at=? WHERE id=?`, [...vals, id]);
  } else {
    const slug = `tpl_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`;
    dbRun(`INSERT INTO cc_templates (name, category, subject, body, enabled, sms_body, wa_template_name, wa_language,
      wa_variables_json, wa_approval_status, email_subject, email_html, email_text, updated_at, slug, channel, is_builtin)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'any', 0)`, [...vals, slug]);
    id = Number(dbGet('SELECT id FROM cc_templates WHERE slug = ?', [slug])?.id) || 0;
  }
  control.ccAudit(actor, data.id ? 'template_update' : 'template_create', 'cc_templates', id, { name });
  return dbGet('SELECT * FROM cc_templates WHERE id = ?', [id]);
}

function listChannelTemplates() {
  ensureSeeded();
  return dbAll('SELECT * FROM cc_templates ORDER BY category, name') || [];
}

function previewTemplate({ template_id, body, channel, branch_id, customer_id }) {
  ensureSeeded();
  const tpl = template_id ? dbGet('SELECT * FROM cc_templates WHERE id = ?', [template_id]) : null;
  const vars = sampleVars(branch_id, customer_id);
  const pick = channel === 'sms' ? (tpl?.sms_body || tpl?.body || body)
    : channel === 'email' ? (tpl?.email_text || tpl?.body || body) : (tpl?.body || body);
  const svc = cc();
  return {
    text: svc.renderTemplate(pick || '', vars),
    subject: channel === 'email' ? svc.renderTemplate(tpl?.email_subject || tpl?.subject || '', vars) : null,
    missing: missingShop(pick || '', vars),
    sms_segments: channel === 'sms' ? Math.max(1, Math.ceil(svc.renderTemplate(pick || '', vars).length / 153)) : null
  };
}

function missingShop(text, vars) {
  return ['shop_name', 'branch_name', 'shop_phone', 'shop_address', 'website', 'order_link']
    .filter((k) => (String(text).includes(`{${k}}`) || String(text).includes(`{{${k}}}`)) && !String(vars[k] || '').trim());
}

function shopVarsFor(branchId) {
  let s = {};
  try { s = dbGet('SELECT * FROM shop_settings WHERE id = 1') || {}; } catch (_) { s = {}; }
  let online = {};
  try { online = parseJson(s.online_settings_json, {}) || {}; } catch (_) { online = {}; }
  let branch = null;
  if (branchId) { try { branch = dbGet('SELECT * FROM branches WHERE id = ?', [branchId]); } catch (_) { branch = null; } }
  const base = String(process.env.PUBLIC_BASE_URL || process.env.PUBLIC_URL || online.public_url || online.website || '').replace(/\/$/, '');
  return {
    shop_name: s.shop_name || '', branch_name: branch?.name || '', shop_phone: branch?.phone || s.phone || '',
    shop_address: branch?.address || s.address || '', website: base, order_link: base ? `${base}/order` : ''
  };
}

function sampleVars(branchId, customerId) {
  let c = null;
  if (customerId) { try { c = dbGet('SELECT name, loyalty_points FROM customers WHERE id = ?', [customerId]); } catch (_) { c = null; } }
  const now = new Date(Date.now() + 2 * 3600 * 1000);
  return {
    ...shopVarsFor(branchId),
    customer_name: c?.name || 'Customer', points_balance: c ? Math.floor(Number(c.loyalty_points) || 0) : 0,
    points_earned: 0, product_name: '', order_number: '', order_total: '',
    date: now.toISOString().slice(0, 10), time: now.toISOString().slice(11, 16)
  };
}

// ── Audience ──────────────────────────────────────────────────────
function audienceFor(audience, branchId) {
  const aud = { ...(audience || { type: 'all_eligible' }) };
  if (branchId && (!aud.type || aud.type === 'all_eligible' || aud.type === 'all')) {
    aud.type = 'branch';
    aud.branch_id = branchId;
  }
  const list = cc().expandAudience(aud);
  const ids = list.filter((r) => !r.web_customer).map((r) => r.recipient_id).filter(Boolean);
  if (ids.length) {
    const emails = {};
    const points = {};
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      try {
        (dbAll(`SELECT id, email, loyalty_points FROM customers WHERE id IN (${chunk.map(() => '?').join(',')})`, chunk) || [])
          .forEach((r) => { emails[r.id] = r.email; points[r.id] = r.loyalty_points; });
      } catch (_) { /* */ }
    }
    list.forEach((r) => {
      if (r.web_customer) return;
      if (!r.email && emails[r.recipient_id]) r.email = emails[r.recipient_id];
      r.points_balance = Math.floor(Number(points[r.recipient_id]) || 0);
    });
  }
  return list;
}

function channelsFrom(data) {
  const list = (Array.isArray(data.channels) ? data.channels : parseJson(data.channels_json, []))
    .filter((c) => control.MESSAGE_CHANNELS.includes(c));
  if (!list.length) throw new Error('Choose at least one channel');
  return [...new Set(list)];
}

/** 'YYYY-MM-DDTHH:MM' in South African time → UTC 'YYYY-MM-DD HH:MM:SS'. */
function saLocalToUtc(local) {
  const s = String(local || '').trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
  if (!m) throw new Error('Choose a valid date and time');
  const ms = Date.parse(`${m[1]}T${m[2]}:00+02:00`);
  if (!Number.isFinite(ms)) throw new Error('Choose a valid date and time');
  return nowIso(new Date(ms));
}

function utcToSaLocal(utc) {
  const ms = Date.parse(`${String(utc).replace(' ', 'T')}Z`);
  if (!Number.isFinite(ms)) return utc;
  return new Date(ms + 2 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ');
}

// ── Scheduled messages ─────────────────────────────────────────────
function scheduleSummary(row) {
  if (!row) return null;
  return { ...row, channels: parseJson(row.channels_json, []), audience: parseJson(row.audience_json, {}), send_at_local: utcToSaLocal(row.send_at) };
}

function saveSchedule(data, actor) {
  ensureSeeded();
  const name = String(data.name || '').trim();
  if (!name) throw new Error('Give the scheduled message a name');
  const channels = channelsFrom(data);
  const templateId = Number(data.template_id) || null;
  const body = String(data.body || '').trim();
  if (!templateId && !body) throw new Error('Choose a template or type a message');
  const sendAt = saLocalToUtc(data.send_at_local || data.send_at);
  if (sendAt <= nowIso()) throw new Error('The send time must be in the future');
  const category = data.category === 'transaction' ? 'transaction' : (data.category === 'reminder' ? 'reminder' : 'scheduled');
  const audience = data.audience || { type: 'all_eligible' };
  const branchId = Number(data.branch_id) || null;
  const recipients = audienceFor(audience, branchId);
  const vals = [name, templateId, body || null, data.subject || null, JSON.stringify(channels), JSON.stringify(audience),
    branchId, category, sendAt, recipients.length, nowIso()];
  let id = Number(data.id) || 0;
  if (id) {
    const cur = dbGet('SELECT status FROM cc_schedules WHERE id = ?', [id]);
    if (!cur) throw new Error('Scheduled message not found');
    if (!['draft', 'scheduled'].includes(cur.status)) throw new Error('This scheduled message can no longer be edited');
    dbRun(`UPDATE cc_schedules SET name=?, template_id=?, body=?, subject=?, channels_json=?, audience_json=?, branch_id=?, category=?,
      send_at=?, recipient_count=?, updated_at=?, status='draft', confirmed_by=NULL, confirmed_at=NULL WHERE id=?`, [...vals, id]);
  } else {
    dbRun(`INSERT INTO cc_schedules (name, template_id, body, subject, channels_json, audience_json, branch_id, category, send_at,
      recipient_count, updated_at, status, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?, 'draft', ?, ?)`,
    [...vals, actor?.id || null, nowIso()]);
    id = Number(dbGet('SELECT id FROM cc_schedules WHERE name = ? ORDER BY id DESC LIMIT 1', [name])?.id) || 0;
  }
  control.ccAudit(actor, data.id ? 'schedule_update' : 'schedule_create', 'cc_schedules', id, { name, channels, send_at: sendAt, recipients: recipients.length });
  return scheduleConfirmation(id);
}

/** What the admin must confirm before a scheduled message is armed. */
function scheduleConfirmation(id) {
  const row = dbGet('SELECT * FROM cc_schedules WHERE id = ?', [id]);
  if (!row) throw new Error('Scheduled message not found');
  const recipients = audienceFor(parseJson(row.audience_json, {}), row.branch_id);
  const channels = parseJson(row.channels_json, []);
  const reach = {};
  channels.forEach((ch) => { reach[ch] = recipients.filter((r) => (ch === 'email' ? r.email : r.recipient_address)).length; });
  const sample = previewTemplate({ template_id: row.template_id, body: row.body, channel: channels[0], branch_id: row.branch_id, customer_id: recipients[0]?.recipient_id });
  return {
    schedule: scheduleSummary(row),
    recipient_count: recipients.length,
    reach_by_channel: reach,
    channels,
    send_at_local: utcToSaLocal(row.send_at),
    sample,
    marketing_window_note: row.category === 'scheduled' && control.getControl().marketing_window?.enabled
      ? 'Marketing messages outside Mon–Fri 08:00–20:00 / Sat 09:00–13:00 (no Sundays or public holidays) wait for the next allowed time.'
      : null
  };
}

function confirmSchedule(id, actor) {
  ensureSeeded();
  const row = dbGet('SELECT * FROM cc_schedules WHERE id = ?', [id]);
  if (!row) throw new Error('Scheduled message not found');
  if (row.status !== 'draft') throw new Error(`Cannot confirm — status is ${row.status}`);
  if (row.send_at <= nowIso()) throw new Error('The send time has passed — edit the time first');
  const conf = scheduleConfirmation(id);
  if (conf.sample.missing.length) throw new Error(`Missing shop details: ${conf.sample.missing.join(', ')}`);
  if (!conf.recipient_count) throw new Error('No recipients match this audience');
  dbRun(`UPDATE cc_schedules SET status='scheduled', confirmed_by=?, confirmed_at=?, recipient_count=?, updated_at=? WHERE id=?`,
    [actor?.id || null, nowIso(), conf.recipient_count, nowIso(), id]);
  control.ccAudit(actor, 'schedule_confirmed', 'cc_schedules', id, { recipients: conf.recipient_count, channels: conf.channels, send_at: row.send_at });
  return scheduleSummary(dbGet('SELECT * FROM cc_schedules WHERE id = ?', [id]));
}

function cancelSchedule(id, actor) {
  const row = dbGet('SELECT status FROM cc_schedules WHERE id = ?', [id]);
  if (!row) throw new Error('Scheduled message not found');
  if (!['draft', 'scheduled'].includes(row.status)) throw new Error(`Cannot cancel — status is ${row.status}`);
  dbRun(`UPDATE cc_schedules SET status='cancelled', updated_at=? WHERE id=?`, [nowIso(), id]);
  control.ccAudit(actor, 'schedule_cancelled', 'cc_schedules', id, {});
  return { ok: true };
}

function listSchedules() {
  ensureSeeded();
  return (dbAll('SELECT * FROM cc_schedules ORDER BY id DESC LIMIT 200') || []).map(scheduleSummary);
}

function queueToRecipients({ keyPrefix, eventKey, sourceModule, channels, recipients, templateId, body, subject, branchId, extraVars, actorId, fallback }) {
  const svc = cc();
  const tpl = templateId ? dbGet('SELECT * FROM cc_templates WHERE id = ?', [templateId]) : null;
  const shop = shopVarsFor(branchId);
  const category = control.categoryFor(eventKey, sourceModule);
  const marketing = category === 'marketing' || category === 'scheduled';
  let queued = 0;
  const now = new Date(Date.now() + 2 * 3600 * 1000);
  recipients.forEach((r) => {
    const vars = {
      ...shop, customer_name: r.recipient_name || 'Customer', points_balance: r.points_balance ?? '',
      date: now.toISOString().slice(0, 10), time: now.toISOString().slice(11, 16), ...(extraVars || {})
    };
    channels.forEach((ch) => {
      const address = ch === 'email' ? r.email : r.recipient_address;
      if (!address) return;
      const raw = ch === 'sms' ? (tpl?.sms_body || tpl?.body || body)
        : ch === 'email' ? (tpl?.email_text || tpl?.body || body) : (tpl?.body || body);
      let text = svc.renderTemplate(raw || '', vars);
      if (marketing) {
        const link = optOutLink(r.recipient_address);
        if (link) text += `\n\nOpt out: ${link}`;
      }
      const id = svc.enqueue({
        dedupe_key: `${keyPrefix}:${ch}:${r.recipient_id || address}`,
        event_key: eventKey, source_module: sourceModule, channel: ch,
        recipient_type: 'customer', recipient_id: r.recipient_id || null, recipient_name: r.recipient_name,
        recipient_address: address, branch_id: branchId || null,
        subject: ch === 'email' ? svc.renderTemplate(subject || tpl?.email_subject || tpl?.subject || shop.shop_name, vars) : null,
        body: text,
        template_slug: tpl?.slug || null, vars_json: JSON.stringify(vars), priority: 60,
        created_by: actorId || null,
        provider_meta_json: JSON.stringify({
          fallback: fallback && fallback !== ch && fallback !== 'none' ? [fallback] : [],
          phone: r.recipient_address || null, email: r.email || null
        })
      });
      if (id) queued += 1;
    });
  });
  return queued;
}

function runSchedule(row) {
  const claim = dbRun(`UPDATE cc_schedules SET status='sending', run_at=? WHERE id=? AND status='scheduled'`, [nowIso(), row.id]);
  if (!Number(claim?.changes)) return 0;
  try {
    const recipients = audienceFor(parseJson(row.audience_json, {}), row.branch_id);
    const eventKey = row.category === 'transaction' ? 'manual.message' : (row.category === 'reminder' ? 'reminder.message' : 'schedule.message');
    const queued = queueToRecipients({
      keyPrefix: `sched:${row.id}`, eventKey, sourceModule: 'schedule', channels: parseJson(row.channels_json, []),
      recipients, templateId: row.template_id, body: row.body, subject: row.subject, branchId: row.branch_id, actorId: row.confirmed_by
    });
    dbRun(`UPDATE cc_schedules SET status='queued', queued_count=?, recipient_count=?, updated_at=? WHERE id=?`,
      [queued, recipients.length, nowIso(), row.id]);
    control.ccAudit(null, 'schedule_run', 'cc_schedules', row.id, { queued, recipients: recipients.length });
    return queued;
  } catch (err) {
    dbRun(`UPDATE cc_schedules SET status='failed', error=?, updated_at=? WHERE id=?`, [String(err.message || err).slice(0, 400), nowIso(), row.id]);
    return 0;
  }
}

// ── Reminders ─────────────────────────────────────────────────────
const REPEATS = ['once', 'daily', 'weekly', 'monthly'];

function nextRun(fromUtc, repeat) {
  const d = new Date(Date.parse(`${String(fromUtc).replace(' ', 'T')}Z`));
  if (repeat === 'daily') d.setUTCDate(d.getUTCDate() + 1);
  else if (repeat === 'weekly') d.setUTCDate(d.getUTCDate() + 7);
  else if (repeat === 'monthly') d.setUTCMonth(d.getUTCMonth() + 1);
  else return null;
  return nowIso(d);
}

function saveReminder(data, actor) {
  ensureSeeded();
  const name = String(data.name || '').trim();
  if (!name) throw new Error('Give the reminder a name');
  const channels = channelsFrom(data);
  const templateId = Number(data.template_id) || null;
  const body = String(data.body || '').trim();
  if (!templateId && !body) throw new Error('Choose a template or type a message');
  const repeat = REPEATS.includes(data.repeat) ? data.repeat : 'once';
  const first = saLocalToUtc(data.next_run_local || data.next_run_at);
  if (first <= nowIso()) throw new Error('The first reminder time must be in the future');
  const vals = [name, String(data.kind || 'custom').slice(0, 40), templateId, body || null, data.subject || null,
    JSON.stringify(channels), JSON.stringify(data.audience || { type: 'all_eligible' }), Number(data.branch_id) || null,
    repeat, first, data.enabled === false ? 0 : 1, nowIso()];
  let id = Number(data.id) || 0;
  if (id) {
    if (!dbGet('SELECT id FROM cc_reminders WHERE id = ?', [id])) throw new Error('Reminder not found');
    dbRun(`UPDATE cc_reminders SET name=?, kind=?, template_id=?, body=?, subject=?, channels_json=?, audience_json=?, branch_id=?,
      repeat=?, next_run_at=?, enabled=?, updated_at=? WHERE id=?`, [...vals, id]);
  } else {
    dbRun(`INSERT INTO cc_reminders (name, kind, template_id, body, subject, channels_json, audience_json, branch_id, repeat,
      next_run_at, enabled, updated_at, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [...vals, actor?.id || null, nowIso()]);
    id = Number(dbGet('SELECT id FROM cc_reminders WHERE name = ? ORDER BY id DESC LIMIT 1', [name])?.id) || 0;
  }
  control.ccAudit(actor, data.id ? 'reminder_update' : 'reminder_create', 'cc_reminders', id, { name, repeat, channels, next_run_at: first });
  return reminderSummary(dbGet('SELECT * FROM cc_reminders WHERE id = ?', [id]));
}

function reminderSummary(r) {
  if (!r) return null;
  return { ...r, channels: parseJson(r.channels_json, []), audience: parseJson(r.audience_json, {}), next_run_local: r.next_run_at ? utcToSaLocal(r.next_run_at) : null };
}

function setReminderEnabled(id, enabled, actor) {
  if (!dbGet('SELECT id FROM cc_reminders WHERE id = ?', [id])) throw new Error('Reminder not found');
  dbRun('UPDATE cc_reminders SET enabled = ?, updated_at = ? WHERE id = ?', [enabled ? 1 : 0, nowIso(), id]);
  control.ccAudit(actor, enabled ? 'reminder_enabled' : 'reminder_disabled', 'cc_reminders', id, {});
  return reminderSummary(dbGet('SELECT * FROM cc_reminders WHERE id = ?', [id]));
}

function listReminders() {
  ensureSeeded();
  return (dbAll('SELECT * FROM cc_reminders ORDER BY id DESC LIMIT 200') || []).map(reminderSummary);
}

function runReminder(r) {
  const next = nextRun(r.next_run_at, r.repeat);
  const claim = dbRun(`UPDATE cc_reminders SET next_run_at = ?, last_run_at = ?, run_count = run_count + 1, enabled = ?
    WHERE id = ? AND next_run_at = ?`, [next, nowIso(), next ? 1 : 0, r.id, r.next_run_at]);
  if (!Number(claim?.changes)) return 0;
  const recipients = audienceFor(parseJson(r.audience_json, {}), r.branch_id);
  const queued = queueToRecipients({
    keyPrefix: `rem:${r.id}:${Number(r.run_count) + 1}`, eventKey: 'reminder.message', sourceModule: 'reminder',
    channels: parseJson(r.channels_json, []), recipients, templateId: r.template_id, body: r.body, subject: r.subject,
    branchId: r.branch_id, actorId: r.created_by
  });
  control.ccAudit(null, 'reminder_run', 'cc_reminders', r.id, { queued, recipients: recipients.length, next_run_at: next });
  return queued;
}

let _lastRun = 0;
function runDue(force = false) {
  if (!force && Date.now() - _lastRun < 30000) return { skipped: true };
  _lastRun = Date.now();
  ensureSeeded();
  const now = nowIso();
  let schedules = 0;
  let reminders = 0;
  (dbAll(`SELECT * FROM cc_schedules WHERE status = 'scheduled' AND send_at <= ? ORDER BY send_at LIMIT 20`, [now]) || [])
    .forEach((row) => { schedules += runSchedule(row); });
  (dbAll(`SELECT * FROM cc_reminders WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at LIMIT 20`, [now]) || [])
    .forEach((r) => { reminders += runReminder(r); });
  return { schedules, reminders };
}

// ── Loyalty points notification ────────────────────────────────────
function notifyPointsEarned(n) {
  ensureSeeded();
  const ctl = control.getControl();
  if (!ctl.categories.points) return { ok: false, reason: 'points_notifications_off' };
  const c = dbGet('SELECT id, name, phone, email FROM customers WHERE id = ?', [n.customer_id]);
  if (!c || (!c.phone && !c.email)) return { ok: false, reason: 'no_contact' };
  const fmt = (v) => `R${(Math.round(Number(v || 0) * 100) / 100).toFixed(2)}`;
  const recipients = [{ recipient_id: c.id, recipient_name: c.name || 'Customer', recipient_address: c.phone || null, email: c.email || null, points_balance: n.balance }];
  const tpl = dbGet(`SELECT id FROM cc_templates WHERE slug = 'cc_points_earned'`);
  const queued = queueToRecipients({
    keyPrefix: `points:sale:${n.sale_id}`, eventKey: 'loyalty.points_earned', sourceModule: 'loyalty',
    channels: ctl.points.channels, fallback: ctl.points.fallback, recipients, templateId: tpl?.id || null, body: '',
    branchId: n.branch_id || null,
    extraVars: {
      points_earned: n.points, points_balance: n.balance, order_number: n.order_number || '',
      order_total: fmt(n.order_total), product_name: n.product_name || ''
    }
  });
  return { ok: true, queued };
}

// ── Customer preferences / opt-out ─────────────────────────────────
const PREF_FLAGS = ['sms', 'whatsapp', 'email', 'marketing', 'loyalty', 'reminders', 'transactional', 'security'];

function getPrefs({ customer_id, phone }) {
  ensureSeeded();
  let row = null;
  if (customer_id) row = dbGet('SELECT * FROM cc_customer_prefs WHERE customer_id = ? LIMIT 1', [customer_id]);
  const digits = String(phone || '').replace(/\D/g, '');
  if (!row && digits) row = dbGet('SELECT * FROM cc_customer_prefs WHERE phone = ? OR phone = ? LIMIT 1', [digits, digits.slice(-9)]);
  const out = { customer_id: customer_id || row?.customer_id || null, phone: row?.phone || digits || null, email_address: row?.email_address || null, opted_out_at: row?.opted_out_at || null };
  PREF_FLAGS.forEach((k) => { out[k] = row ? (row[k] == null ? 1 : Number(row[k]) ? 1 : 0) : 1; });
  out.security = 1;
  return out;
}

function savePrefs(data, actor) {
  ensureSeeded();
  let customer = null;
  if (data.customer_id) customer = dbGet('SELECT id, phone, email FROM customers WHERE id = ?', [data.customer_id]);
  const phone = String(data.phone || customer?.phone || '').replace(/\D/g, '');
  if (!phone) throw new Error('Customer phone number required');
  const before = getPrefs({ customer_id: customer?.id, phone });
  const next = { ...before };
  PREF_FLAGS.forEach((k) => { if (data[k] != null) next[k] = data[k] ? 1 : 0; });
  next.security = 1;
  const email = String(data.email_address || customer?.email || before.email_address || '').trim().toLowerCase() || null;
  const existing = dbGet('SELECT id, opt_out_token FROM cc_customer_prefs WHERE phone = ? OR phone = ? OR (customer_id IS NOT NULL AND customer_id = ?) LIMIT 1',
    [phone, phone.slice(-9), customer?.id || -1]);
  const token = existing?.opt_out_token || crypto.randomBytes(16).toString('hex');
  const marketingOn = next.marketing ? 1 : 0;
  if (existing) {
    dbRun(`UPDATE cc_customer_prefs SET customer_id = COALESCE(?, customer_id), sms=?, whatsapp=?, email=?, marketing=?, loyalty=?, reminders=?,
      transactional=?, security=1, email_address=?, opt_out_token=?, promotions=?, opted_out_at=?, updated_at=? WHERE id=?`,
    [customer?.id || null, next.sms, next.whatsapp, next.email, next.marketing, next.loyalty, next.reminders, next.transactional,
      email, token, marketingOn, marketingOn ? null : (before.opted_out_at || nowIso()), nowIso(), existing.id]);
  } else {
    dbRun(`INSERT INTO cc_customer_prefs (customer_id, phone, sms, whatsapp, email, marketing, loyalty, reminders, transactional, security,
      email_address, opt_out_token, promotions, whatsapp_marketing, sms_marketing, email_marketing, opted_out_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,1,?,?,?,1,1,1,?,?)`,
    [customer?.id || null, phone, next.sms, next.whatsapp, next.email, next.marketing, next.loyalty, next.reminders, next.transactional,
      email, token, marketingOn, marketingOn ? null : nowIso(), nowIso()]);
  }
  const changes = PREF_FLAGS.filter((k) => before[k] !== next[k]).map((k) => ({ key: k, before: before[k], after: next[k] }));
  control.ccAudit(actor, 'customer_prefs_update', 'cc_customer_prefs', customer?.id || null, { phone: control.maskAddress(phone), changes, via: data.via || 'admin' });
  return getPrefs({ customer_id: customer?.id, phone });
}

function optOutSig(digits) {
  return require('./cc-otp').sign(`optout:${digits}`).slice(0, 32);
}

function optOutLink(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  const base = shopVarsFor(null).website || '';
  return `${base}/cc/unsubscribe?p=${digits}&s=${optOutSig(digits)}`;
}

/** Public unsubscribe link: stops marketing only (orders, points and security messages continue). */
function optOutSigned(p, s) {
  const digits = String(p || '').replace(/\D/g, '');
  const sig = String(s || '');
  const expected = digits ? optOutSig(digits) : '';
  if (!digits || sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    throw new Error('Invalid unsubscribe link');
  }
  const customer = dbGet('SELECT id FROM customers WHERE phone = ? OR phone = ? LIMIT 1', [digits, digits.startsWith('27') ? `0${digits.slice(2)}` : digits]);
  savePrefs({ customer_id: customer?.id || null, phone: digits, marketing: 0, via: 'unsubscribe_link' }, { username: 'customer' });
  return { ok: true };
}

module.exports = {
  TEMPLATE_VARIABLES, ensureSeeded, saveChannelTemplate, listChannelTemplates, previewTemplate,
  saveSchedule, scheduleConfirmation, confirmSchedule, cancelSchedule, listSchedules,
  saveReminder, setReminderEnabled, listReminders, runDue, notifyPointsEarned,
  getPrefs, savePrefs, optOutSigned, optOutLink, saLocalToUtc, utcToSaLocal
};

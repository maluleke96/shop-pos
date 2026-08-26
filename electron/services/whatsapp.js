const { getDb } = require('../database/db');

const DEFAULT_TEMPLATES = [
  {
    slug: 'thank_you', name: 'Thank You', category: 'customer', is_builtin: 1,
    body: 'Hi {{CustomerName}},\n\nThank you for shopping at {{Branch}}!\n\n{{ReceiptLines}}\n\nTotal: {{TotalPurchase}}\n\n⭐ Points earned this visit: {{PointsEarned}} pts (= {{PointsEarnedValue}})\n⭐ Your loyalty balance: {{LoyaltyPoints}} points (= {{LoyaltyPointsValue}})\n{{GiftCardLine}}\n\nWe look forward to serving you again!\n📍 {{Branch}}\n📞 {{Phone}}'
  },
  {
    slug: 'sale_receipt', name: 'Sale Receipt', category: 'customer', is_builtin: 1,
    body: 'Hi {{CustomerName}},\n\nHere is your receipt from {{Branch}}:\n\n🧾 Receipt #{{OrderNumber}}\n{{DeliveryAddressLine}}\n{{ReceiptLines}}\n\n*Total: {{TotalPurchase}}*\n\n⭐ Points earned: {{PointsEarned}} pts (= {{PointsEarnedValue}})\n⭐ Balance: {{LoyaltyPoints}} pts (= {{LoyaltyPointsValue}})\n{{GiftCardLine}}\n\nThank you for your support!'
  },
  {
    slug: 'supplier_payment', name: 'Supplier Payment Receipt', category: 'supplier', is_builtin: 1,
    body: 'Hi {{SupplierName}},\n\nPayment receipt from {{Branch}}:\n\n📄 Ref: {{PaymentNumber}}\n💰 Amount paid: {{AmountPaid}}\n💳 Method: {{PaymentMethod}}\n📉 Previous balance: {{BalanceBefore}}\n📈 Remaining balance: {{BalanceAfter}}\n{{BankDetailsLine}}\n\nThank you for your service.\n📞 {{Phone}}'
  },
  {
    slug: 'review_request', name: 'Review Request', category: 'customer', is_builtin: 1,
    body: 'Hi {{CustomerName}}, we hope you enjoyed your purchase at {{Branch}}! Please leave us a review. Order: {{OrderNumber}} — Total: {{TotalPurchase}}'
  },
  {
    slug: 'promotion', name: 'Promotion', category: 'customer', is_builtin: 1,
    body: 'Hi {{CustomerName}}! {{PromotionName}} — use code {{VoucherCode}} or coupon {{Coupon}} at {{Branch}}. You have {{LoyaltyPoints}} loyalty points!'
  },
  {
    slug: 'birthday', name: 'Birthday Wish', category: 'customer', is_builtin: 1,
    body: 'Happy Birthday {{CustomerName}}! 🎉 Visit {{Branch}} for a special treat. You have {{LoyaltyPoints}} loyalty points waiting!'
  },
  {
    slug: 'gift_card', name: 'Gift Card', category: 'customer', is_builtin: 1,
    body: 'Hi {{CustomerName}}, you have received a gift card from {{Branch}}!\n\nCode: {{GiftCardCode}}\nValue: {{GiftCardValue}}\n\nPresent this code at checkout.'
  },
  {
    slug: 'quotation', name: 'Quotation', category: 'customer', is_builtin: 1,
    body: 'Hi {{CustomerName}},\n\nYour quotation from {{Branch}}:\n\n📄 Quote #{{OrderNumber}}\n{{QuoteLines}}\n\n*Total: {{TotalPurchase}}*\n\n{{ValidUntilLine}}\nContact us to confirm your order.\n📞 {{Phone}}'
  },
  {
    slug: 'flyer_share', name: 'Flyer Campaign Share', category: 'customer', is_builtin: 1,
    body: 'Hi {{CustomerName}}!\n\n🔥 {{PromotionName}} at {{Branch}}\n\n{{AnnouncementText}}\n\nValid until {{Date}}\n📞 {{Phone}}'
  },
  {
    slug: 'campaign', name: 'Marketing Campaign', category: 'customer', is_builtin: 1,
    body: 'Hi {{CustomerName}}!\n\n{{PromotionName}} — {{AnnouncementText}}\n\nVisit {{Branch}} today!\n📞 {{Phone}}'
  },
  {
    slug: 'payslip', name: 'Payslip Notification', category: 'employee', is_builtin: 1,
    body: 'Hi {{EmployeeName}}, your payslip for {{PayPeriod}} is ready.\n\nGross: {{GrossPay}}\nPAYE: {{PayeAmount}}\nUIF: {{UifAmount}}\nNet pay: {{NetPay}}\n\nContact {{Branch}} for your full PDF payslip.'
  },
  {
    slug: 'leave_approval', name: 'Leave Approval', category: 'employee', is_builtin: 1,
    body: 'Hi {{EmployeeName}}, your {{LeaveType}} leave from {{Date}} has been APPROVED.\n\nPeriod: {{PayPeriod}}\nDays: {{Days}}\n\nPlease keep this for your records. Contact {{Branch}} if you have questions.'
  },
  {
    slug: 'attendance', name: 'Attendance Notice', category: 'employee', is_builtin: 1,
    body: 'Hi {{EmployeeName}}, attendance update for {{Date}}: {{AttendanceStatus}} at {{Branch}}.'
  },
  {
    slug: 'warning', name: 'Disciplinary Warning', category: 'employee', is_builtin: 1,
    body: 'Hi {{EmployeeName}}, please contact management at {{Branch}} regarding: {{WarningReason}}.'
  },
  {
    slug: 'announcement', name: 'Staff Announcement', category: 'employee', is_builtin: 1,
    body: 'Team announcement from {{Branch}}: {{AnnouncementText}}'
  },
  {
    slug: 'checklist_overdue', name: 'Checklist Overdue Warning', category: 'employee', is_builtin: 1,
    body: 'Hi {{EmployeeName}},\n\n⚠️ Reminder: The {{ChecklistType}} checklist for {{Date}} at {{Branch}} was not submitted by the deadline.\n\nPlease complete all items and submit to admin in Operations → Daily Routines.\n\n— Management'
  }
];

const OWNER_ONLY_TYPES = new Set([]);
const HR_TYPES = new Set([
  'payslip', 'warning', 'leave_approval', 'salary_advice', 'attendance', 'checklist_overdue',
  'training_eval', 'training_result', 'hr_submission', 'probation_eval', 'probation_result'
]);
const MANAGER_TYPES = new Set(['promotion', 'announcement']);
const STAFF_SEND_TYPES = new Set([
  'sale_receipt', 'review_request', 'gift_card', 'giftcard', 'flyer_share', 'campaign', 'quotation', 'supplier_payment',
  'recruitment_hire', 'recruitment_reject', 'recruitment_interview', 'custom',
  'layby', 'cashout', 'checklist', 'account_receipt', 'thank_you'
]);
const CASHIER_ALLOWED_TYPES = new Set([
  'sale_receipt', 'review_request', 'gift_card', 'giftcard', 'flyer_share', 'campaign', 'quotation',
  'supplier_payment', 'layby', 'cashout', 'thank_you'
]);

function parseJson(v, fb = {}) {
  if (!v) return fb;
  try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return fb; }
}

function audit(actorId, actorName, action, entityId, details) {
  getDb().prepare(`INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, details) VALUES (?,?,?,?,?,?)`)
    .run(actorId || null, actorName || 'system', action, 'whatsapp', entityId || null, details ? JSON.stringify(details) : null);
}

function requireRole(actor, roles = ['owner', 'manager']) {
  const { assertUserActor } = require('./authz');
  return assertUserActor(actor, roles);
}

function requireOwner(actor) {
  const { assertUserActor } = require('./authz');
  return assertUserActor(actor, ['owner']);
}

function today() {
  return new Date().toLocaleDateString('en-CA');
}

function buildWaUrl(phone, message) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) throw new Error('Phone number required');
  const num = digits.startsWith('0') ? `27${digits.slice(1)}` : digits;
  return `https://wa.me/${num}?text=${encodeURIComponent(message || '')}`;
}

function e164Digits(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.startsWith('0') ? `27${digits.slice(1)}` : digits;
}

async function tryWhatsAppCloudSend(phone, body, settings) {
  const token = String(settings?.api_key || '').trim();
  const phoneId = String(settings?.phone_number_id || '').trim();
  if (!token || !phoneId) return null;
  const to = e164Digits(phone);
  if (!to) return null;
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(phoneId)}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { preview_url: false, body: String(body || '').slice(0, 4096) }
      })
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: json?.error?.message || `WhatsApp API ${res.status}` };
    }
    return { ok: true, id: json?.messages?.[0]?.id || null };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

function renderTemplate(body, vars = {}) {
  let out = String(body || '');
  const map = { ...vars };
  Object.keys(map).forEach(k => {
    const val = map[k] != null ? String(map[k]) : '';
    out = out.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'gi'), val);
  });
  out = out.replace(/\{\{[A-Za-z0-9_]+\}\}/g, '');
  return out.trim();
}

function getWhatsAppSettings() {
  const row = getDb().prepare('SELECT whatsapp_settings, phone, branch_id FROM shop_settings WHERE id = 1').get() || {};
  const parsed = parseJson(row.whatsapp_settings, {});
  const apiKey = parsed.api_key || '';
  return {
    api_key_configured: !!apiKey,
    phone_number_id: parsed.phone_number_id || '',
    business_account_id: parsed.business_account_id || '',
    default_branch_phone: parsed.default_branch_phone || row.phone || '',
    default_branch_id: parsed.default_branch_id ?? row.branch_id ?? null,
    enabled: parsed.enabled,
    provider: parsed.provider
  };
}

function getWhatsAppSettingsRaw() {
  const row = getDb().prepare('SELECT whatsapp_settings, phone, branch_id FROM shop_settings WHERE id = 1').get() || {};
  const parsed = parseJson(row.whatsapp_settings, {});
  return {
    api_key: parsed.api_key || '',
    phone_number_id: parsed.phone_number_id || '',
    business_account_id: parsed.business_account_id || '',
    default_branch_phone: parsed.default_branch_phone || row.phone || '',
    default_branch_id: parsed.default_branch_id ?? row.branch_id ?? null,
    ...parsed
  };
}

function saveWhatsAppSettings(data, actor) {
  requireRole(actor);
  const current = getWhatsAppSettingsRaw();
  const merged = { ...current, ...data };
  if (data.api_key === '' || data.api_key === null) {
    // keep existing unless explicitly cleared via clear_api_key
    if (!data.clear_api_key) merged.api_key = current.api_key;
  }
  getDb().prepare(`UPDATE shop_settings SET whatsapp_settings = ?, updated_at = datetime('now') WHERE id = 1`)
    .run(JSON.stringify(merged));
  audit(actor?.id, actor?.username, 'whatsapp_settings_update', null, { keys: Object.keys(data || {}) });
  return getWhatsAppSettings();
}

const ALLOWED_TEMPLATE_CATEGORIES = new Set(['customer', 'employee', 'supplier']);
const ALLOWED_RECIPIENT_TYPES = new Set(['customer', 'employee', 'supplier']);

function normalizeTemplateCategory(category, slug) {
  if (ALLOWED_TEMPLATE_CATEGORIES.has(category)) return category;
  if (slug === 'supplier_payment' || String(slug || '').includes('supplier')) return 'supplier';
  if (['payslip', 'leave_approval', 'attendance', 'warning', 'announcement', 'checklist_overdue'].includes(slug)) {
    return 'employee';
  }
  return 'customer';
}

function normalizeRecipientType(type, messageType) {
  if (ALLOWED_RECIPIENT_TYPES.has(type)) return type;
  if (messageType === 'supplier_payment' || String(messageType || '').includes('supplier')) return 'supplier';
  if (['payslip', 'leave_approval', 'attendance', 'warning', 'announcement', 'checklist_overdue'].includes(messageType)) {
    return 'employee';
  }
  return 'customer';
}

let _defaultTemplatesReady = false;
function ensureDefaultTemplates() {
  if (_defaultTemplatesReady) return;
  const db = getDb();
  for (const t of DEFAULT_TEMPLATES) {
    const category = normalizeTemplateCategory(t.category, t.slug);
    try {
      const ex = db.prepare('SELECT id FROM whatsapp_templates WHERE slug = ?').get(t.slug);
      if (!ex) {
        db.prepare(`INSERT INTO whatsapp_templates (slug, name, category, body, is_builtin) VALUES (?,?,?,?,?)`)
          .run(t.slug, t.name, category, t.body, t.is_builtin ? 1 : 0);
      }
      // Do not UPDATE built-in bodies on every read — that caused ~2 queries × N templates per page open
    } catch (err) {
      // Never block receipt/review/supplier sends if one template row fails
      console.error('[whatsapp] ensureDefaultTemplates', t.slug, err.message);
    }
  }
  _defaultTemplatesReady = true;
}

function getTemplates(filters = {}) {
  ensureDefaultTemplates();
  let sql = 'SELECT * FROM whatsapp_templates WHERE 1=1';
  const params = [];
  if (filters.category) { sql += ' AND category = ?'; params.push(filters.category); }
  if (filters.active_only) { sql += ' AND is_active = 1'; }
  sql += ' ORDER BY is_builtin DESC, category, name';
  return getDb().prepare(sql).all(...params);
}

function getTemplate(id) {
  ensureDefaultTemplates();
  return getDb().prepare('SELECT * FROM whatsapp_templates WHERE id = ?').get(id) || null;
}

function getTemplateBySlug(slug) {
  ensureDefaultTemplates();
  return getDb().prepare('SELECT * FROM whatsapp_templates WHERE slug = ?').get(slug) || null;
}

function saveTemplate(data, actor) {
  const user = requireRole(actor);
  if (!data.name?.trim()) throw new Error('Template name is required');
  if (!data.body?.trim()) throw new Error('Template body is required');
  const category = normalizeTemplateCategory(data.category, data.slug);
  const db = getDb();
  if (data.id) {
    const existing = getTemplate(data.id);
    if (!existing) throw new Error('Template not found');
    if (existing.is_builtin && user.role !== 'owner') {
      throw new Error('Only owner can edit built-in templates');
    }
    db.prepare(`UPDATE whatsapp_templates SET name=?, category=?, body=?, is_active=?, updated_at=datetime('now') WHERE id=?`)
      .run(data.name.trim(), category, data.body.trim(), data.is_active === false ? 0 : 1, data.id);
    audit(user.id, user.username, 'whatsapp_template_update', data.id, { name: data.name });
    return getTemplate(data.id);
  }
  const slug = data.slug || `custom_${Date.now()}`;
  const r = db.prepare(`INSERT INTO whatsapp_templates (slug, name, category, body, is_builtin, created_by) VALUES (?,?,?,?,0,?)`)
    .run(slug, data.name.trim(), category, data.body.trim(), user.id || null);
  audit(user.id, user.username, 'whatsapp_template_create', r.lastInsertRowid, { name: data.name });
  return getTemplate(r.lastInsertRowid);
}

function deleteTemplate(id, actor) {
  requireRole(actor);
  const t = getTemplate(id);
  if (!t) throw new Error('Template not found');
  if (t.is_builtin) throw new Error('Built-in templates cannot be deleted');
  getDb().prepare('DELETE FROM whatsapp_templates WHERE id = ?').run(id);
  audit(actor?.id, actor?.username, 'whatsapp_template_delete', id, { name: t.name });
}

function getMessages(filters = {}) {
  let sql = 'SELECT * FROM whatsapp_messages WHERE 1=1';
  const params = [];
  if (filters.from) { sql += ' AND date(sent_at) >= ?'; params.push(filters.from); }
  if (filters.to) { sql += ' AND date(sent_at) <= ?'; params.push(filters.to); }
  if (filters.message_type) { sql += ' AND message_type = ?'; params.push(filters.message_type); }
  if (filters.status) { sql += ' AND status = ?'; params.push(filters.status); }
  if (filters.branch_id) { sql += ' AND branch_id = ?'; params.push(filters.branch_id); }
  if (filters.recipient_type) { sql += ' AND recipient_type = ?'; params.push(filters.recipient_type); }
  if (filters.search) {
    sql += ' AND (recipient_name LIKE ? OR phone LIKE ? OR body LIKE ?)';
    const q = `%${filters.search}%`;
    params.push(q, q, q);
  }
  sql += ' ORDER BY sent_at DESC LIMIT ?';
  params.push(Math.min(Number(filters.limit) || 200, 500));
  return getDb().prepare(sql).all(...params).map(r => ({
    ...r,
    metadata: parseJson(r.metadata_json, {})
  }));
}

function shopContext() {
  const s = getDb().prepare('SELECT shop_name, phone, currency, branch_id FROM shop_settings WHERE id = 1').get() || {};
  return s;
}

function getAudience(filter = {}) {
  const db = getDb();
  const type = filter.type || filter.audience_filter || 'all';
  const settings = getWhatsAppSettings();
  const shop = shopContext();
  const branchName = filter.branch_name || shop.shop_name || 'Our Store';

  if (type === 'one') {
    const id = filter.customer_id || filter.recipient_id;
    if (!id) return [];
    const c = db.prepare('SELECT id, name, phone, email, loyalty_points, birthday FROM customers WHERE id = ?').get(id);
    return c?.phone ? [{ ...c, recipient_type: 'customer', branch: branchName }] : [];
  }

  if (type === 'selected') {
    const ids = filter.customer_ids || filter.ids || [];
    if (!ids.length) return [];
    const ph = ids.map(() => '?').join(',');
    return db.prepare(`
      SELECT id, name, phone, email, loyalty_points, birthday FROM customers
      WHERE id IN (${ph}) AND phone IS NOT NULL AND TRIM(phone) != ''
    `).all(...ids).map(c => ({ ...c, recipient_type: 'customer', branch: branchName }));
  }

  if (type === 'all') {
    return db.prepare(`
      SELECT id, name, phone, email, loyalty_points, birthday FROM customers
      WHERE phone IS NOT NULL AND TRIM(phone) != '' ORDER BY name
    `).all().map(c => ({ ...c, recipient_type: 'customer', branch: branchName }));
  }

  if (type === 'branch') {
    const branchId = filter.branch_id || settings.default_branch_id;
    if (!branchId) {
      return db.prepare(`
        SELECT DISTINCT c.id, c.name, c.phone, c.email, c.loyalty_points, c.birthday FROM customers c
        JOIN sales s ON s.customer_id = c.id
        WHERE c.phone IS NOT NULL AND TRIM(c.phone) != ''
        ORDER BY c.name
      `).all().map(c => ({ ...c, recipient_type: 'customer', branch: branchName }));
    }
    return db.prepare(`
      SELECT DISTINCT c.id, c.name, c.phone, c.email, c.loyalty_points, c.birthday FROM customers c
      JOIN sales s ON s.customer_id = c.id AND s.branch_id = ?
      WHERE c.phone IS NOT NULL AND TRIM(c.phone) != ''
      ORDER BY c.name
    `).all(branchId).map(c => ({ ...c, recipient_type: 'customer', branch: branchName }));
  }

  if (type === 'loyalty') {
    const minPts = Number(filter.min_points) || 1;
    return db.prepare(`
      SELECT id, name, phone, email, loyalty_points, birthday FROM customers
      WHERE phone IS NOT NULL AND TRIM(phone) != '' AND loyalty_points >= ?
      ORDER BY loyalty_points DESC
    `).all(minPts).map(c => ({ ...c, recipient_type: 'customer', branch: branchName }));
  }

  if (type === 'birthdays') {
    const mmdd = filter.date || today().slice(5);
    return db.prepare(`
      SELECT id, name, phone, email, loyalty_points, birthday FROM customers
      WHERE phone IS NOT NULL AND TRIM(phone) != '' AND birthday IS NOT NULL
        AND (substr(birthday, 6) = ? OR substr(birthday, 6) = ?)
      ORDER BY name
    `).all(mmdd, mmdd.replace(/^0/, '')).map(c => ({ ...c, recipient_type: 'customer', branch: branchName }));
  }

  if (type === 'inactive') {
    const days = Number(filter.inactive_days) || 90;
    return db.prepare(`
      SELECT c.id, c.name, c.phone, c.email, c.loyalty_points, c.birthday FROM customers c
      WHERE c.phone IS NOT NULL AND TRIM(c.phone) != ''
        AND c.id NOT IN (
          SELECT DISTINCT customer_id FROM sales
          WHERE customer_id IS NOT NULL AND date(created_at) >= date('now', ?)
        )
      ORDER BY c.name
    `).all(`-${days} days`).map(c => ({ ...c, recipient_type: 'customer', branch: branchName }));
  }

  if (type === 'employee' || type === 'employees') {
    return db.prepare(`
      SELECT id, full_name AS name, phone, email, position, branch FROM employees
      WHERE status = 'Active' AND phone IS NOT NULL AND TRIM(phone) != ''
      ORDER BY full_name
    `).all().map(e => ({ ...e, recipient_type: 'employee', branch: e.branch || branchName }));
  }

  return [];
}

function buildVars(data = {}) {
  const shop = shopContext();
  const currency = shop.currency || 'R';
  const vars = { ...(data.vars || {}) };
  const giftCardLine = data.gift_card_line || (data.gift_card_code || data.voucher_code
    ? `🎁 Gift card: ${data.gift_card_code || data.voucher_code}`
    : '');
  const map = {
    CustomerName: data.customer_name || data.recipient_name || data.name || vars.CustomerName || '',
    EmployeeName: data.employee_name || data.recipient_name || data.name || vars.EmployeeName || '',
    LoyaltyPoints: data.loyalty_points ?? data.total_points_balance ?? vars.LoyaltyPoints ?? '',
    PointsEarned: data.points_earned ?? vars.PointsEarned ?? '',
    PointsEarnedValue: data.points_earned_value ?? vars.PointsEarnedValue ?? '',
    LoyaltyPointsValue: data.loyalty_points_value ?? vars.LoyaltyPointsValue ?? '',
    ReceiptLines: data.receipt_lines ?? vars.ReceiptLines ?? '',
    QuoteLines: data.quote_lines ?? vars.QuoteLines ?? '',
    ValidUntilLine: data.valid_until_line ?? vars.ValidUntilLine ?? '',
    GiftCardLine: giftCardLine,
    Branch: data.branch || vars.Branch || shop.shop_name || '',
    PromotionName: data.promotion_name || vars.PromotionName || '',
    VoucherCode: data.voucher_code || vars.VoucherCode || '',
    Coupon: data.coupon || vars.Coupon || data.voucher_code || vars.VoucherCode || '',
    OrderNumber: data.order_number || data.receipt_number || vars.OrderNumber || '',
    TotalPurchase: data.total_purchase != null
      ? `${currency}${Number(data.total_purchase).toFixed(2)}`
      : (vars.TotalPurchase || ''),
    Phone: data.phone || vars.Phone || shop.phone || '',
    PayPeriod: data.pay_period || vars.PayPeriod || '',
    NetPay: data.net_pay != null ? `${currency}${Number(data.net_pay).toFixed(2)}` : (vars.NetPay || ''),
    GrossPay: data.gross_pay != null ? `${currency}${Number(data.gross_pay).toFixed(2)}` : (vars.GrossPay || ''),
    PayeAmount: data.paye_amount != null ? `${currency}${Number(data.paye_amount).toFixed(2)}` : (vars.PayeAmount || ''),
    UifAmount: data.uif_amount != null ? `${currency}${Number(data.uif_amount).toFixed(2)}` : (vars.UifAmount || ''),
    LeaveType: data.leave_type || vars.LeaveType || '',
    Days: data.days != null ? String(data.days) : (vars.Days || ''),
    Date: data.date || vars.Date || today(),
    AttendanceStatus: data.attendance_status || vars.AttendanceStatus || '',
    WarningReason: data.warning_reason || vars.WarningReason || '',
    AnnouncementText: data.announcement_text || vars.AnnouncementText || '',
    GiftCardCode: data.gift_card_code || vars.GiftCardCode || '',
    GiftCardValue: data.gift_card_value || vars.GiftCardValue || '',
    ChecklistType: data.checklist_type || vars.ChecklistType || '',
    DeliveryAddress: data.delivery_address || vars.DeliveryAddress || '',
    DeliveryAddressLine: data.delivery_address_line
      || (data.delivery_address ? `📍 Deliver to: ${data.delivery_address}` : '')
      || vars.DeliveryAddressLine || '',
    SupplierName: data.supplier_name || data.recipient_name || vars.SupplierName || '',
    PaymentNumber: data.payment_number || vars.PaymentNumber || '',
    AmountPaid: data.amount_paid != null
      ? `${currency}${Number(data.amount_paid).toFixed(2)}`
      : (vars.AmountPaid || ''),
    PaymentMethod: data.payment_method || vars.PaymentMethod || '',
    BalanceBefore: data.balance_before != null
      ? `${currency}${Number(data.balance_before).toFixed(2)}`
      : (vars.BalanceBefore || ''),
    BalanceAfter: data.balance_after != null
      ? `${currency}${Number(data.balance_after).toFixed(2)}`
      : (vars.BalanceAfter || ''),
    BankDetailsLine: data.bank_details_line || vars.BankDetailsLine || ''
  };
  return { ...map, ...vars };
}

async function sendMessage(data, actor) {
  const msgType = data.message_type || 'custom';
  const slug = data.template_slug || msgType;
  let user;
  if (OWNER_ONLY_TYPES.has(msgType) || OWNER_ONLY_TYPES.has(slug)) {
    user = requireOwner(actor);
  } else if (HR_TYPES.has(msgType) || HR_TYPES.has(slug)) {
    user = requireRole(actor, ['owner', 'manager', 'supervisor', 'assistant_manager']);
  } else if (STAFF_SEND_TYPES.has(msgType) || STAFF_SEND_TYPES.has(slug)) {
    user = requireRole(actor, ['owner', 'manager', 'marketing_agent', 'cashier', 'supervisor', 'assistant_manager']);
  } else if (MANAGER_TYPES.has(msgType) || MANAGER_TYPES.has(slug)) {
    user = requireRole(actor, ['owner', 'manager', 'marketing_agent', 'assistant_manager']);
  } else {
    user = requireRole(actor, ['owner', 'manager', 'marketing_agent', 'assistant_manager', 'supervisor']);
  }
  actor = user;

  const db = getDb();
  const settings = getWhatsAppSettingsRaw();
  let body = data.body || '';
  let templateId = data.template_id || null;

  if (!body && data.template_slug) {
    const t = getTemplateBySlug(data.template_slug);
    if (t) { body = t.body; templateId = t.id; }
  }
  if (!body && msgType === 'flyer_share') {
    const t = getTemplateBySlug('flyer_share');
    if (t) { body = t.body; templateId = t.id; }
  }
  if (!body && templateId) {
    const t = getTemplate(templateId);
    if (t) body = t.body;
  }
  if (!body) throw new Error('Message body or template is required');

  const vars = buildVars(data);
  body = renderTemplate(body, vars);
  const phone = data.phone || vars.Phone;
  if (!phone?.trim()) throw new Error('Phone number is required');

  const branchId = data.branch_id ?? actor?.branch_id ?? settings.default_branch_id ?? null;
  const url = buildWaUrl(phone, body);
  const cloud = await tryWhatsAppCloudSend(phone, body, settings);
  const sentViaApi = !!(cloud && cloud.ok);
  const status = sentViaApi ? 'sent' : 'pending';
  const meta = {
    url: sentViaApi ? null : url,
    vars,
    template_slug: data.template_slug || null,
    via: sentViaApi ? 'cloud_api' : 'wa.me',
    cloud_message_id: cloud?.id || null,
    cloud_error: cloud && !cloud.ok ? cloud.error : null
  };

  const recipientType = normalizeRecipientType(data.recipient_type, msgType);
  const r = db.prepare(`
    INSERT INTO whatsapp_messages (
      recipient_type, recipient_id, recipient_name, phone, message_type, template_id,
      campaign_id, body, status, sender_id, sender_name, branch_id, sale_id, metadata_json
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    recipientType,
    data.recipient_id || data.customer_id || data.employee_id || data.supplier_id || null,
    data.recipient_name || data.customer_name || data.employee_name || data.supplier_name || data.name || null,
    phone.trim(),
    msgType,
    templateId,
    data.campaign_id || null,
    body,
    status,
    actor?.id || null,
    actor?.username || actor?.full_name || null,
    branchId,
    data.sale_id || null,
    JSON.stringify(meta)
  );

  audit(actor?.id, actor?.username, 'whatsapp_send', r.lastInsertRowid, {
    type: msgType, phone: phone.trim(), recipient: data.recipient_name || data.name, via: meta.via
  });

  return {
    id: r.lastInsertRowid,
    url: sentViaApi ? null : url,
    body,
    phone: phone.trim(),
    status,
    via: meta.via,
    cloud_error: meta.cloud_error || null
  };
}

function markMessageOpened(id, actor) {
  getDb().prepare(`UPDATE whatsapp_messages SET status = 'opened', sent_at = datetime('now') WHERE id = ?`).run(id);
  audit(actor?.id, actor?.username, 'whatsapp_opened', id, null);
  return getDb().prepare('SELECT * FROM whatsapp_messages WHERE id = ?').get(id);
}

function getCampaigns(filters = {}) {
  let sql = 'SELECT * FROM whatsapp_campaigns WHERE 1=1';
  const params = [];
  if (filters.status) { sql += ' AND status = ?'; params.push(filters.status); }
  sql += ' ORDER BY updated_at DESC';
  return getDb().prepare(sql).all(...params).map(c => ({
    ...c,
    audience: parseJson(c.audience_json, {})
  }));
}

function getCampaign(id) {
  const r = getDb().prepare('SELECT * FROM whatsapp_campaigns WHERE id = ?').get(id);
  if (!r) return null;
  return { ...r, audience: parseJson(r.audience_json, {}) };
}

function saveCampaign(data, actor) {
  requireRole(actor);
  if (!data.name?.trim()) throw new Error('Campaign name is required');
  const db = getDb();
  const audienceJson = JSON.stringify(data.audience || data.audience_json || {});
  if (data.id) {
    db.prepare(`UPDATE whatsapp_campaigns SET name=?, template_id=?, audience_filter=?, audience_json=?,
      scheduled_at=?, status=?, branch_id=?, updated_at=datetime('now') WHERE id=?`)
      .run(data.name.trim(), data.template_id || null, data.audience_filter || 'all', audienceJson,
        data.scheduled_at || null, data.status || 'draft', data.branch_id || null, data.id);
    audit(actor?.id, actor?.username, 'whatsapp_campaign_update', data.id, { name: data.name });
    return getCampaign(data.id);
  }
  const r = db.prepare(`INSERT INTO whatsapp_campaigns (name, template_id, audience_filter, audience_json,
    scheduled_at, status, branch_id, created_by, created_by_name) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(data.name.trim(), data.template_id || null, data.audience_filter || 'all', audienceJson,
      data.scheduled_at || null, data.status || 'draft', data.branch_id || null,
      actor?.id || null, actor?.username || actor?.full_name || null);
  audit(actor?.id, actor?.username, 'whatsapp_campaign_create', r.lastInsertRowid, { name: data.name });
  return getCampaign(r.lastInsertRowid);
}

function deleteCampaign(id, actor) {
  requireRole(actor);
  getDb().prepare('DELETE FROM whatsapp_campaigns WHERE id = ?').run(id);
  audit(actor?.id, actor?.username, 'whatsapp_campaign_delete', id, null);
}

async function sendCampaign(campaignId, actor) {
  requireRole(actor);
  const campaign = getCampaign(campaignId);
  if (!campaign) throw new Error('Campaign not found');
  const template = campaign.template_id ? getTemplate(campaign.template_id) : null;
  if (!template) throw new Error('Campaign template is required');

  const audienceFilter = { type: campaign.audience_filter, ...(campaign.audience || {}) };
  if (campaign.branch_id) audienceFilter.branch_id = campaign.branch_id;
  const recipients = getAudience(audienceFilter);
  if (!recipients.length) throw new Error('No recipients match this audience');

  const shop = shopContext();
  const settings = getWhatsAppSettingsRaw();
  const results = [];
  for (const r of recipients) {
    const vars = buildVars({
      customer_name: r.name,
      recipient_name: r.name,
      employee_name: r.name,
      loyalty_points: r.loyalty_points,
      branch: r.branch || shop.shop_name,
      phone: r.phone
    });
    const body = renderTemplate(template.body, vars);
    const url = buildWaUrl(r.phone, body);
    const cloud = await tryWhatsAppCloudSend(r.phone, body, settings);
    const sentViaApi = !!(cloud && cloud.ok);
    const ins = getDb().prepare(`
      INSERT INTO whatsapp_messages (
        recipient_type, recipient_id, recipient_name, phone, message_type, template_id,
        campaign_id, body, status, sender_id, sender_name, branch_id, metadata_json
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      r.recipient_type || 'customer', r.id, r.name, r.phone, template.slug || 'campaign',
      template.id, campaignId, body, sentViaApi ? 'sent' : 'pending', actor?.id || null,
      actor?.username || actor?.full_name || null, campaign.branch_id || null,
      JSON.stringify({
        url: sentViaApi ? null : url,
        campaign_id: campaignId,
        via: sentViaApi ? 'cloud_api' : 'wa.me',
        cloud_message_id: cloud?.id || null,
        cloud_error: cloud && !cloud.ok ? cloud.error : null
      })
    );
    results.push({
      id: ins.lastInsertRowid, recipient_id: r.id, name: r.name, phone: r.phone,
      url: sentViaApi ? null : url, body, via: sentViaApi ? 'cloud_api' : 'wa.me'
    });
  }

  getDb().prepare(`UPDATE whatsapp_campaigns SET status='sent', sent_count=?, sent_at=datetime('now'), updated_at=datetime('now') WHERE id=?`)
    .run(results.length, campaignId);
  audit(actor?.id, actor?.username, 'whatsapp_campaign_send', campaignId, { count: results.length });
  return { campaign_id: campaignId, sent_count: results.length, recipients: results };
}

module.exports = {
  DEFAULT_TEMPLATES,
  renderTemplate,
  buildWaUrl,
  getWhatsAppSettings,
  saveWhatsAppSettings,
  ensureDefaultTemplates,
  getTemplates,
  getTemplate,
  getTemplateBySlug,
  saveTemplate,
  deleteTemplate,
  getMessages,
  getAudience,
  buildVars,
  sendMessage,
  markMessageOpened,
  getCampaigns,
  getCampaign,
  saveCampaign,
  deleteCampaign,
  sendCampaign
};

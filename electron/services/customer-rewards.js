const { getDb } = require('../database/db');
const { buildWaUrl } = require('./flyers');

const STAFF_ROLES = ['owner', 'manager', 'assistant_manager'];

function getRewardRules() {
  return getDb().prepare(`
    SELECT * FROM customer_reward_rules ORDER BY spend_threshold ASC, period_days ASC
  `).all();
}

function saveRewardRule(data) {
  const db = getDb();
  if (!data.spend_threshold || data.spend_threshold <= 0) throw new Error('Spend threshold must be greater than zero');
  if (!data.gift_amount || data.gift_amount <= 0) throw new Error('Gift amount must be greater than zero');
  const periodDays = Math.max(1, parseInt(data.period_days, 10) || 30);
  const giftExpiryDays = Math.max(1, parseInt(data.gift_expiry_days, 10) || 365);
  if (data.id) {
    db.prepare(`UPDATE customer_reward_rules SET enabled=?, spend_threshold=?, period_days=?, gift_amount=?,
      gift_expiry_days=?, notes=?, updated_at=datetime('now') WHERE id=?`)
      .run(data.enabled !== false ? 1 : 0, data.spend_threshold, periodDays, data.gift_amount,
        giftExpiryDays, data.notes || null, data.id);
    return db.prepare('SELECT * FROM customer_reward_rules WHERE id = ?').get(data.id);
  }
  const r = db.prepare(`INSERT INTO customer_reward_rules (enabled, spend_threshold, period_days, gift_amount, gift_expiry_days, notes)
    VALUES (?,?,?,?,?,?)`)
    .run(data.enabled !== false ? 1 : 0, data.spend_threshold, periodDays, data.gift_amount, giftExpiryDays, data.notes || null);
  return db.prepare('SELECT * FROM customer_reward_rules WHERE id = ?').get(r.lastInsertRowid);
}

function deleteRewardRule(id) {
  getDb().prepare('DELETE FROM customer_reward_rules WHERE id = ?').run(id);
  return { success: true };
}

function customerSpendInPeriod(customerId, periodDays) {
  const days = Math.max(1, parseInt(periodDays, 10) || 30);
  const row = getDb().prepare(`
    SELECT COALESCE(SUM(total), 0) AS total
    FROM sales
    WHERE customer_id = ? AND status = 'completed'
      AND date(created_at) >= date('now', ?)
  `).get(customerId, `-${days} days`);
  return Number(row?.total) || 0;
}

function alreadyGrantedForPeriod(customerId, ruleId, periodDays) {
  const days = Math.max(1, parseInt(periodDays, 10) || 30);
  const row = getDb().prepare(`
    SELECT id FROM customer_reward_grants
    WHERE customer_id = ? AND rule_id = ?
      AND date(granted_at) >= date('now', ?)
    LIMIT 1
  `).get(customerId, ruleId, `-${days} days`);
  return !!row;
}

function getStaffNotifyUsers() {
  return getDb().prepare(`
    SELECT u.id, u.full_name, u.role, u.username, e.phone
    FROM users u
    LEFT JOIN employees e ON e.user_id = u.id
    WHERE u.is_active = 1 AND u.role IN ('owner', 'manager', 'assistant_manager')
    ORDER BY CASE u.role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END, u.full_name
  `).all();
}

function processCustomerRewards(customerId, saleId, saleTotal, createGiftCardFn, actorId, actorName) {
  if (!customerId) return null;
  const db = getDb();
  const customer = db.prepare('SELECT id, name, phone FROM customers WHERE id = ?').get(customerId);
  if (!customer) return null;

  const rules = getRewardRules().filter(r => r.enabled);
  const shop = db.prepare('SELECT shop_name, phone, currency FROM shop_settings WHERE id = 1').get() || {};
  const currency = shop.currency || 'R';
  const grants = [];

  for (const rule of rules) {
    if (alreadyGrantedForPeriod(customerId, rule.id, rule.period_days)) continue;
    const spendTotal = customerSpendInPeriod(customerId, rule.period_days);
    if (spendTotal < Number(rule.spend_threshold)) continue;

    const expiresAt = new Date(Date.now() + (Number(rule.gift_expiry_days) || 365) * 86400000)
      .toISOString().slice(0, 10);
    const giftCard = createGiftCardFn({
      amount: Number(rule.gift_amount),
      customer_id: customerId,
      customer_phone: customer.phone || null,
      expires_at: expiresAt,
      notes: `Auto reward: ${shop.shop_name || 'Shop'} spend ${rule.spend_threshold} in ${rule.period_days} days`
    }, actorId, actorName);

    db.prepare(`INSERT INTO customer_reward_grants (customer_id, sale_id, gift_card_id, rule_id, spend_total)
      VALUES (?,?,?,?,?)`)
      .run(customerId, saleId || null, giftCard.id, rule.id, spendTotal);

    const customerMsg = customer.phone
      ? `Hi ${customer.name},\n\n🎁 Thank you for your loyalty at ${shop.shop_name || 'our store'}!\n\nYou've earned a gift card:\nCode: ${giftCard.code}\nValue: ${currency}${Number(rule.gift_amount).toFixed(2)}\n\nPresent this code at checkout.${shop.phone ? `\n📞 ${shop.phone}` : ''}`
      : null;
    const staffMsg = `🎁 Auto gift reward created for ${customer.name}\n\nSpend (last ${rule.period_days} days): ${currency}${spendTotal.toFixed(2)}\nGift card: ${giftCard.code} — ${currency}${Number(rule.gift_amount).toFixed(2)}\n${customer.phone ? `Send to customer: ${customer.phone}` : 'Customer has no phone on file'}`;

    const staffNotifications = getStaffNotifyUsers().map(u => ({
      user_id: u.id,
      name: u.full_name,
      role: u.role,
      phone: u.phone || null,
      whatsapp_url: u.phone ? buildWaUrl(u.phone, staffMsg) : null,
      message: staffMsg
    }));

    grants.push({
      rule_id: rule.id,
      spend_total: spendTotal,
      gift_card: giftCard,
      customer_whatsapp_url: customer.phone && customerMsg ? buildWaUrl(customer.phone, customerMsg) : null,
      customer_message: customerMsg,
      staff_notifications: staffNotifications
    });
  }

  return grants.length ? { grants, customer_name: customer.name, customer_phone: customer.phone } : null;
}

module.exports = {
  getRewardRules,
  saveRewardRule,
  deleteRewardRule,
  processCustomerRewards,
  customerSpendInPeriod
};

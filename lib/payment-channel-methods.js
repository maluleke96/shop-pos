/** POS / Kiosk / Online payment method lists from admin payment_settings. */
function normalizeId(id) {
  return String(id || '').trim().toLowerCase();
}

function channelEnabledIds(paymentSettings = {}, channel = 'pos') {
  const pm = paymentSettings || {};
  const map = {
    pos: pm.enabled_methods_pos,
    kiosk: pm.enabled_methods_kiosk,
    online: pm.enabled_methods_online
  };
  let enabled = Array.isArray(map[channel]) && map[channel].length ? map[channel] : null;
  if (!enabled && channel === 'online') {
    enabled = Array.isArray(pm.enabled_methods_online) ? pm.enabled_methods_online : null;
  }
  if (!enabled || !enabled.length) {
    enabled = Array.isArray(pm.enabled_methods) ? pm.enabled_methods : ['cash', 'card'];
  }
  enabled = enabled.map(normalizeId).filter(Boolean);
  if (channel === 'kiosk') {
    enabled = enabled.filter((m) => !['account'].includes(m));
  }
  if (channel === 'online') {
    enabled = enabled.filter((m) => m !== 'account');
  }
  if (!enabled.length) enabled = channel === 'online' ? ['card'] : ['cash', 'card'];
  return [...new Set(enabled)];
}

const DEFAULT_LABELS = {
  cash: 'Cash',
  card: 'Card',
  eft: 'EFT / Bank',
  mobile: 'Mobile',
  giftcard: 'Gift card',
  account: 'On account',
  other: 'Other',
  snapscan: 'SnapScan'
};

function labelForMethod(id, paymentSettings = {}) {
  const key = normalizeId(id);
  const custom = (paymentSettings.custom_methods || []).find((c) => normalizeId(c.id) === key);
  if (custom?.label) return custom.label;
  const fromPm = (paymentSettings.custom_labels || {})[key];
  if (fromPm) return fromPm;
  return DEFAULT_LABELS[key] || key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatMethodOptions(paymentSettings = {}, channel = 'pos') {
  const ids = channelEnabledIds(paymentSettings, channel);
  const pm = paymentSettings || {};
  const options = ids.map((id) => ({ id, label: labelForMethod(id, pm) }));
  const labels = {};
  for (const o of options) labels[o.id] = o.label;
  return { ids, options, labels };
}

module.exports = {
  normalizeId,
  channelEnabledIds,
  labelForMethod,
  formatMethodOptions,
  DEFAULT_LABELS
};

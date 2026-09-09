/** Parse and format expense invoice line items. */
function num(v) {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function roundMoney(n) {
  return Math.round(num(n) * 100) / 100;
}

function parseLineItems(raw) {
  if (!raw) return [];
  try {
    const j = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(j)) return [];
    return normalizeLineItems(j);
  } catch (_) {
    return [];
  }
}

function normalizeLineItems(items) {
  if (!Array.isArray(items)) return [];
  return items.map((row) => {
    const name = String(row.name || row.description || '').trim();
    const quantity = Math.max(num(row.quantity != null ? row.quantity : row.qty) || 1, 0.001);
    const unitPrice = num(row.unit_price != null ? row.unit_price : row.price);
    let amount = num(row.amount);
    if (!(amount > 0) && unitPrice > 0) amount = roundMoney(quantity * unitPrice);
    return {
      name,
      quantity: roundMoney(quantity),
      unit_price: roundMoney(unitPrice),
      amount: roundMoney(amount)
    };
  }).filter((row) => row.name && row.amount > 0);
}

function lineItemsTotal(items) {
  return roundMoney(normalizeLineItems(items).reduce((s, row) => s + num(row.amount), 0));
}

function lineItemsSummary(items, max = 3) {
  const rows = normalizeLineItems(items);
  if (!rows.length) return '';
  const head = rows.slice(0, max).map((r) => r.name).join(', ');
  if (rows.length > max) return `${head} +${rows.length - max} more`;
  return head;
}

function formatLineItemsHtml(items, fmt) {
  const rows = normalizeLineItems(items);
  if (!rows.length) return '';
  return rows.map((r) => {
    const qty = r.quantity > 1 ? `${r.quantity} × ` : '';
    return `<div class="exp-line-row"><span>${escapeHtml(r.name)} <small class="muted">${qty}${escapeHtml(fmt(r.unit_price))}</small></span><strong>${escapeHtml(fmt(r.amount))}</strong></div>`;
  }).join('');
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

module.exports = {
  num,
  roundMoney,
  parseLineItems,
  normalizeLineItems,
  lineItemsTotal,
  lineItemsSummary,
  formatLineItemsHtml,
  escapeHtml
};

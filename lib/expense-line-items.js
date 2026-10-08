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
    const quantity = Math.max(num(row.quantity != null ? row.quantity : row.qty) || 0, 0.0001);
    const unit = String(row.unit || row.uom || '').trim() || null;
    const priceField = num(row.price != null ? row.price : (row.line_total != null ? row.line_total : null));
    let amount = num(row.amount);
    if (!(amount > 0) && priceField > 0) {
      amount = roundMoney(priceField);
    }
    const legacyUnit = num(row.unit_price);
    if (!(amount > 0) && legacyUnit > 0 && row.line_total_mode === 'unit') {
      amount = roundMoney(legacyUnit * quantity);
    }
    if (!(amount > 0) && legacyUnit > 0 && !priceField) {
      amount = roundMoney(legacyUnit * quantity);
    }
    const unit_price = quantity > 0 ? roundMoney(amount / quantity) : 0;
    const out = {
      name,
      quantity: roundMoney(quantity),
      unit,
      unit_price,
      amount: roundMoney(amount),
      line_total_mode: 'line'
    };
    if (row.product_id != null && row.product_id !== '') out.product_id = Number(row.product_id) || row.product_id;
    if (row.photo_path) out.photo_path = String(row.photo_path);
    if (row.photo_url) out.photo_url = String(row.photo_url);
    return out;
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
    const qty = `${r.quantity}${r.unit ? ` ${r.unit}` : ''}`;
    const photo = r.photo_url || r.photo_path
      ? `<img src="${escapeHtml(r.photo_url || r.photo_path)}" alt="" style="width:36px;height:36px;object-fit:cover;border-radius:6px;vertical-align:middle;margin-right:6px">`
      : '';
    return `<div class="exp-line-row">${photo}<span>${escapeHtml(r.name)} <small class="muted">${escapeHtml(qty)} · paid ${escapeHtml(fmt(r.amount))} · ≈ ${escapeHtml(fmt(r.unit_price))} each</small></span><strong>${escapeHtml(fmt(r.amount))}</strong></div>`;
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

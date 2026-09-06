/** Promo vs normal price when customer picks removal modifiers (e.g. Without Pap). */

function isRemovalModifier(mod) {
  if (!mod) return false;
  const t = String(mod.modifier_type || mod.type || '').toLowerCase();
  if (t === 'removal') return true;
  if (Number(mod.extra_price) < 0 && t !== 'extra' && t !== 'option') return true;
  return false;
}

function modifiersIncludeRemoval(modifiers) {
  return (modifiers || []).some(isRemovalModifier);
}

function promoOptedOut(promoActive, modifiers) {
  return !!promoActive && modifiersIncludeRemoval(modifiers);
}

function calcPromoAwareUnitPrice(opts = {}) {
  const promoActive = !!opts.promoActive;
  const normal = Number(opts.normalPrice) || 0;
  const sale = Number(opts.salePrice ?? opts.normalPrice) || normal;
  const extras = opts.modifierExtraTotal != null
    ? Number(opts.modifierExtraTotal) || 0
    : (opts.modifiers || []).reduce((s, m) => s + (Number(m.extra_price) || 0), 0);

  if (promoActive && modifiersIncludeRemoval(opts.modifiers)) {
    return Math.round((normal + extras) * 100) / 100;
  }
  if (promoActive) {
    return Math.round((sale + extras) * 100) / 100;
  }
  const base = sale || normal;
  return Math.round((base + extras) * 100) / 100;
}

module.exports = {
  isRemovalModifier,
  modifiersIncludeRemoval,
  promoOptedOut,
  calcPromoAwareUnitPrice
};

'use strict';

const DEFAULTS = {
  new_arrival_days: 14,
  auto_best_seller: true,
  auto_best_seller_days: 30,
  auto_best_seller_limit: 20,
  tabs: {
    available_today: { pos: true, online: true },
    new_arrival: { pos: true, online: true },
    best_seller: { pos: true, online: true },
    today_special: { pos: true, online: true }
  }
};

function parseSettings(settingsParsed) {
  const raw = settingsParsed?.customization?.menu_highlight_settings || {};
  return {
    new_arrival_days: Number(raw.new_arrival_days) || DEFAULTS.new_arrival_days,
    auto_best_seller: raw.auto_best_seller !== false,
    auto_best_seller_days: Number(raw.auto_best_seller_days) || DEFAULTS.auto_best_seller_days,
    auto_best_seller_limit: Number(raw.auto_best_seller_limit) || DEFAULTS.auto_best_seller_limit,
    tabs: {
      available_today: {
        pos: raw.tabs?.available_today?.pos !== false,
        online: raw.tabs?.available_today?.online !== false
      },
      new_arrival: {
        pos: raw.tabs?.new_arrival?.pos !== false,
        online: raw.tabs?.new_arrival?.online !== false
      },
      best_seller: {
        pos: raw.tabs?.best_seller?.pos !== false,
        online: raw.tabs?.best_seller?.online !== false
      },
      today_special: {
        pos: raw.tabs?.today_special?.pos !== false,
        online: raw.tabs?.today_special?.online !== false
      }
    }
  };
}

function getAutoBestSellerIds(db, limit = 20, days = 30) {
  const from = new Date();
  from.setDate(from.getDate() - days);
  const fromStr = from.toISOString().slice(0, 10);
  try {
    return db.prepare(`
      SELECT si.product_id, SUM(si.quantity) AS qty
      FROM sale_items si
      INNER JOIN sales s ON s.id = si.sale_id
      WHERE si.product_id IS NOT NULL AND date(s.created_at) >= date(?)
      GROUP BY si.product_id
      ORDER BY qty DESC
      LIMIT ?
    `).all(fromStr, limit).map((r) => Number(r.product_id)).filter(Boolean);
  } catch (_) {
    return [];
  }
}

function syncAutoBestSellers(db, settingsParsed) {
  const cfg = parseSettings(settingsParsed);
  if (!cfg.auto_best_seller) return;
  const ids = getAutoBestSellerIds(db, cfg.auto_best_seller_limit, cfg.auto_best_seller_days);
  try {
    db.prepare(`
      UPDATE products SET is_best_seller = 0
      WHERE is_active = 1 AND (item_type IS NULL OR item_type != 'ingredient')
    `).run();
    for (const id of ids) {
      db.prepare('UPDATE products SET is_best_seller = 1 WHERE id = ?').run(id);
    }
  } catch (_) { /* column may be missing */ }
}

function markNewArrival(db, productId, settingsParsed) {
  const cfg = parseSettings(settingsParsed);
  const until = new Date();
  until.setDate(until.getDate() + cfg.new_arrival_days);
  const untilStr = until.toISOString().slice(0, 10);
  try {
    db.prepare('UPDATE products SET is_new_arrival = 1, new_arrival_until = ? WHERE id = ?').run(untilStr, productId);
  } catch (_) { /* ignore */ }
}

function isOnSpecial(product, promoMap) {
  if (promoMap && promoMap[product.id]) return true;
  if (product.promo_active) return true;
  if (Number(product.on_sale) === 1 || product.on_sale === true) return true;
  return false;
}

function buildMenuTabs(products, promoMap, channel, settingsParsed) {
  const cfg = parseSettings(settingsParsed);
  const todayStr = new Date().toLocaleDateString('en-CA');
  const counts = {
    available_today: products.filter((p) => Number(p.available_today) === 1).length,
    new_arrival: products.filter((p) => Number(p.is_new_arrival) === 1
      && (!p.new_arrival_until || p.new_arrival_until >= todayStr)).length,
    best_seller: products.filter((p) => Number(p.is_best_seller) === 1).length,
    today_special: products.filter((p) => isOnSpecial(p, promoMap)).length
  };
  const defs = [
    { key: 'available_today', id: '__available_today', name: 'Available Today', color: '#2dd4bf' },
    { key: 'new_arrival', id: '__new_arrival', name: 'New Arrival', color: '#38bdf8' },
    { key: 'best_seller', id: '__best_seller', name: 'Best Seller', color: '#fbbf24' },
    { key: 'today_special', id: '__today_special', name: "Today's Special", color: '#ef4444', saleStyle: true }
  ];
  return defs
    .filter((d) => cfg.tabs[d.key]?.[channel] !== false)
    .map((d) => ({
      id: d.id,
      name: d.name,
      color: d.color,
      count: counts[d.key] || 0,
      saleStyle: !!d.saleStyle
    }));
}

function filterProductsByTab(products, tabId, promoMap) {
  const todayStr = new Date().toLocaleDateString('en-CA');
  if (tabId === '__available_today') return products.filter((p) => Number(p.available_today) === 1);
  if (tabId === '__new_arrival') {
    return products.filter((p) => Number(p.is_new_arrival) === 1
      && (!p.new_arrival_until || p.new_arrival_until >= todayStr));
  }
  if (tabId === '__best_seller') return products.filter((p) => Number(p.is_best_seller) === 1);
  if (tabId === '__today_special') return products.filter((p) => isOnSpecial(p, promoMap));
  return products;
}

module.exports = {
  DEFAULTS,
  parseSettings,
  getAutoBestSellerIds,
  syncAutoBestSellers,
  markNewArrival,
  buildMenuTabs,
  filterProductsByTab,
  isOnSpecial
};

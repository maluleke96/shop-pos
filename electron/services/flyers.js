const fs = require('fs');
const path = require('path');
const { getDb } = require('../database/db');
const { jsPDF } = require('jspdf');
const adminOverride = require('./admin-override');

const FLYER_SIZES = {
  a4_portrait: { w: 210, h: 297, label: 'A4 Portrait' },
  a4_landscape: { w: 297, h: 210, label: 'A4 Landscape' },
  a3: { w: 297, h: 420, label: 'A3' },
  a2: { w: 420, h: 594, label: 'A2' },
  poster: { w: 420, h: 594, label: 'Poster' },
  social_square: { w: 1080, h: 1080, label: 'Social Square', px: true },
  instagram_post: { w: 1080, h: 1080, label: 'Instagram Post', px: true },
  tiktok: { w: 1080, h: 1920, label: 'TikTok', px: true },
  twitter: { w: 1200, h: 675, label: 'X / Twitter', px: true },
  facebook_cover: { w: 820, h: 312, label: 'Facebook Cover', px: true },
  instagram_story: { w: 1080, h: 1920, label: 'Instagram Story', px: true },
  whatsapp_status: { w: 1080, h: 1920, label: 'WhatsApp Status', px: true }
};

const BUILTIN_TEMPLATES = [
  { name: 'Weekend Specials', category: 'weekend', headline: 'WEEKEND SPECIALS', bg: '#2563eb' },
  { name: 'Monthly Specials', category: 'monthly', headline: 'MONTHLY SPECIALS', bg: '#7c3aed' },
  { name: 'Combo Deals', category: 'combo', headline: 'MEAL COMBO DEALS', bg: '#ea580c' },
  { name: 'Restaurant Specials', category: 'restaurant', headline: 'RESTAURANT SPECIALS', bg: '#b45309' },
  { name: 'Black Friday', category: 'black_friday', headline: 'BLACK FRIDAY DEALS', bg: '#111827' },
  { name: 'Christmas Specials', category: 'christmas', headline: 'CHRISTMAS SPECIALS', bg: '#dc2626' },
  { name: 'Easter Specials', category: 'easter', headline: 'EASTER SPECIALS', bg: '#84cc16' },
  { name: 'New Products', category: 'new_products', headline: 'NEW ARRIVALS', bg: '#0ea5e9' },
  { name: 'Clearance Sale', category: 'clearance', headline: 'CLEARANCE SALE', bg: '#f59e0b' },
  { name: 'Birthday Specials', category: 'birthday', headline: "IT'S OUR BIRTHDAY SPECIALS", bg: '#e11d48' },
  { name: 'Chisanyama Connection', category: 'chisanyama', headline: 'CHISANYAMA CONNECTION SPECIALS', bg: '#c2410c' }
];

const PRICE_TAG_STYLES = {
  shoprite: { bg: '#e30613', color: '#fff' },
  checkers: { bg: '#006633', color: '#fff' },
  picknpay: { bg: '#005baa', color: '#fff' },
  spar: { bg: '#008037', color: '#fff' },
  makro: { bg: '#003087', color: '#ffd200' },
  chisanyama: { bg: '#ea580c', color: '#fff' }
};

const TEXT_STYLES = {
  headline: { fontSize: 22, color: '#ffffff' },
  subheading: { fontSize: 16, color: '#ffffff' },
  body: { fontSize: 11, color: '#ffffff' },
  price: { fontSize: 18, color: '#facc15' },
  caption: { fontSize: 9, color: '#e5e7eb' }
};

function productImagePath(p) {
  return p?.picture_path || p?.image_path || p?.photo_path || '';
}

function loadImageForPdf(src) {
  if (!src) return null;
  if (String(src).startsWith('data:')) {
    const match = String(src).match(/^data:image\/(\w+);base64,(.+)$/);
    if (!match) return null;
    const fmt = match[1].toLowerCase();
    const format = fmt === 'jpg' || fmt === 'jpeg' ? 'JPEG' : fmt.toUpperCase();
    return { format, data: match[2] };
  }
  try {
    if (!fs.existsSync(src)) return null;
    const ext = path.extname(src).slice(1).toLowerCase();
    const format = ext === 'jpg' || ext === 'jpeg' ? 'JPEG' : ext.toUpperCase() || 'JPEG';
    return { format, data: fs.readFileSync(src).toString('base64') };
  } catch (_) {
    return null;
  }
}

function hexToRgb(hex) {
  const h = String(hex || '#ffffff').replace('#', '');
  if (h.length !== 6) return { r: 255, g: 255, b: 255 };
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

function setFillFromHex(doc, hex) {
  const c = hexToRgb(hex);
  doc.setFillColor(c.r, c.g, c.b);
}

function setTextFromHex(doc, hex) {
  const c = hexToRgb(hex);
  doc.setTextColor(c.r, c.g, c.b);
}

function getCanvasElements(f) {
  const canvas = f.canvas || {};
  if (canvas.pages?.length) {
    const page = canvas.pages[0];
    if (page?.elements?.length) return page.elements;
  }
  return canvas.elements || [];
}

function createFlyerPdfDoc(size) {
  // Avoid passing both custom format [w,h] AND orientation — jsPDF can swap axes ("saved the other way round").
  if (size.px) {
    const doc = new jsPDF({ unit: 'px', format: [size.w, size.h], hotfixes: ['px_scaling'] });
    const pw = doc.internal.pageSize.getWidth();
    const ph = doc.internal.pageSize.getHeight();
    if (Math.abs(pw - size.w) > 2 || Math.abs(ph - size.h) > 2) {
      // Recover if a jsPDF version still swapped the page
      return new jsPDF({ unit: 'px', format: [size.h, size.w], hotfixes: ['px_scaling'] });
    }
    return doc;
  }
  // Use exact millimetre page size matching the studio canvas (including A2 / poster)
  return new jsPDF({ unit: 'mm', format: [size.w, size.h] });
}

function withLayerRotation(doc, lyr, x, y, w, h, drawFn) {
  // Rotation for composite shapes is approximate; images/text use native angle APIs.
  drawFn(x, y, w, h);
}

function renderPdfImage(doc, src, x, y, w, h, angle = 0) {
  const img = loadImageForPdf(src);
  if (!img) return;
  try {
    if (angle && typeof doc.addImage === 'function') {
      doc.addImage(
        `data:image/${img.format.toLowerCase()};base64,${img.data}`,
        img.format, x, y, w, h, undefined, 'FAST', angle
      );
    } else {
      doc.addImage(`data:image/${img.format.toLowerCase()};base64,${img.data}`, img.format, x, y, w, h);
    }
  } catch (_) {
    try {
      doc.addImage(`data:image/${img.format.toLowerCase()};base64,${img.data}`, img.format, x, y, w, h);
    } catch { /* ignore */ }
  }
}

function renderCanvasLayer(doc, lyr, f, sizeW, sizeH, currency) {
  if (lyr.hidden) return;
  const x = (Number(lyr.x) || 0) / 100 * sizeW;
  const y = (Number(lyr.y) || 0) / 100 * sizeH;
  const w = (Number(lyr.w) || 0) / 100 * sizeW;
  const h = (Number(lyr.h) || 0) / 100 * sizeH;
  const angle = Number(lyr.rotate) || 0;
  const products = f.products || [];

  if (lyr.type === 'price-tag' || lyr.type === 'product') {
    const p = products[lyr.productIdx ?? 0];
    if (!p) return;
    const normal = Number(p.normal_price ?? p.selling_price) || 0;
    const special = calcPromoPrice({ selling_price: normal }, p);
    const tag = PRICE_TAG_STYLES[lyr.priceStyle || 'chisanyama'] || PRICE_TAG_STYLES.chisanyama;
    const boxW = w || 58;
    const boxH = h || 36;
    withLayerRotation(doc, lyr, x, y, boxW, boxH, (dx, dy, dw, dh) => {
      setFillFromHex(doc, tag.bg);
      doc.roundedRect(dx, dy, dw, dh, 2, 2, 'F');
      const imgSrc = productImagePath(p);
      if (imgSrc) renderPdfImage(doc, imgSrc, dx + 2, dy + 2, Math.min(dw - 4, 18), Math.min(dh * 0.4, 14));
      setTextFromHex(doc, tag.color);
      doc.setFontSize(8);
      doc.text(String(p.name || p.product_name || 'Product').slice(0, 18), dx + 3, dy + (imgSrc ? 20 : 10));
      doc.setFontSize(7);
      doc.text(`Was ${currency}${normal.toFixed(2)}`, dx + 3, dy + (imgSrc ? 26 : 16));
      doc.setFontSize(12);
      doc.text(`${currency}${special.toFixed(2)}`, dx + 3, dy + dh - 6);
    });
    return;
  }

  if (lyr.type === 'product-img' || lyr.type === 'image' || lyr.type === 'logo') {
    const p = products[lyr.productIdx ?? 0];
    const src = lyr.src || productImagePath(p);
    renderPdfImage(doc, src, x, y, w || 40, h || 30, angle);
    return;
  }

  if (lyr.type === 'text' || lyr.type === 'headline') {
    const ts = TEXT_STYLES[lyr.textStyle] || TEXT_STYLES.body;
    setTextFromHex(doc, lyr.color || ts.color);
    doc.setFontSize(lyr.fontSize || ts.fontSize);
    const content = String(lyr.content || lyr.name || '');
    if (angle && typeof doc.text === 'function') {
      doc.text(content, x, y + (lyr.fontSize || ts.fontSize) * 0.35, { angle });
    } else {
      doc.text(content, x, y + (lyr.fontSize || ts.fontSize) * 0.35);
    }
    return;
  }

  if (lyr.type === 'sticker') {
    withLayerRotation(doc, lyr, x, y, w || 30, h || 8, (dx, dy, dw, dh) => {
      setFillFromHex(doc, lyr.fill || '#ef4444');
      doc.roundedRect(dx, dy, dw, dh, 4, 4, 'F');
      setTextFromHex(doc, lyr.color || '#ffffff');
      doc.setFontSize(lyr.fontSize || 10);
      doc.text(String(lyr.content || 'SALE'), dx + 3, dy + 6);
    });
    return;
  }

  if (lyr.type === 'shape') {
    withLayerRotation(doc, lyr, x, y, w || 10, h || 10, (dx, dy, dw, dh) => {
      setFillFromHex(doc, lyr.fill || '#ffffff');
      if (lyr.shape === 'circle') doc.circle(dx + dw / 2, dy + dh / 2, Math.min(dw, dh) / 2, 'F');
      else doc.rect(dx, dy, dw, dh, 'F');
    });
    return;
  }

  if (lyr.type === 'icon') {
    setTextFromHex(doc, lyr.color || '#ffffff');
    doc.setFontSize(lyr.fontSize || 24);
    if (angle) doc.text(String(lyr.content || '⭐'), x, y + (lyr.fontSize || 24) * 0.35, { angle });
    else doc.text(String(lyr.content || '⭐'), x, y + (lyr.fontSize || 24) * 0.35);
    return;
  }

  if (lyr.content || lyr.name) {
    setTextFromHex(doc, lyr.color || '#ffffff');
    doc.setFontSize(lyr.fontSize || 10);
    if (angle) doc.text(String(lyr.content || lyr.name), x, y + 5, { angle });
    else doc.text(String(lyr.content || lyr.name), x, y + 5);
  }
}

function renderLegacyProductGrid(doc, f, sizeW, currency) {
  let y = 58;
  const items = [
    ...(f.products || []).map(p => ({ ...p, kind: 'product' })),
    ...(f.combos || f.canvas?.combos || []).map(c => ({ ...c, kind: 'combo' }))
  ];
  items.forEach((item, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = 14 + col * 62;
    const py = y + row * 42;
    doc.setFillColor('#facc15');
    doc.roundedRect(x, py, 58, 36, 2, 2, 'F');
    const imgSrc = productImagePath(item);
    if (imgSrc) renderPdfImage(doc, imgSrc, x + 3, py + 2, 16, 14);
    doc.setTextColor('#111111');
    doc.setFontSize(9);
    if (item.kind === 'combo') {
      const p1 = Number(item.price || item.selling_price) || 0;
      const p2 = Number(item.combo_price_2 || item.price_2 || p1 * 1.85) || p1 * 2;
      doc.text(String(item.name || 'Combo').slice(0, 20), x + 3, py + (imgSrc ? 20 : 8));
      doc.setFontSize(8);
      doc.text(`1 for ${currency}${p1.toFixed(2)}`, x + 3, py + (imgSrc ? 26 : 16));
      doc.setFontSize(10);
      doc.text(`2 for ${currency}${p2.toFixed(2)}`, x + 3, py + 32);
      return;
    }
    const normal = Number(item.normal_price ?? item.selling_price) || 0;
    const special = calcPromoPrice({ selling_price: normal }, item);
    const save = Math.max(0, normal - special);
    doc.text(String(item.name || item.product_name || 'Product').slice(0, 20), x + 3, py + (imgSrc ? 20 : 8));
    doc.setFontSize(8);
    doc.text(`Was ${currency}${normal.toFixed(2)}`, x + 3, py + (imgSrc ? 26 : 16));
    doc.setFontSize(14);
    doc.text(`${currency}${special.toFixed(2)}`, x + 3, py + 32);
    if (save > 0) doc.setFontSize(8), doc.text(`SAVE ${currency}${save.toFixed(2)}`, x + 3, py + 36);
  });
}

function parseJson(v, fb = {}) {
  if (!v) return fb;
  try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return fb; }
}

function audit(actorId, actorName, action, entityId, details) {
  getDb().prepare(`INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, details) VALUES (?,?,?,?,?,?)`)
    .run(actorId || null, actorName || 'system', action, 'promotion_flyer', entityId || null, details ? JSON.stringify(details) : null);
}

function requireRole(actor, roles = ['owner', 'manager', 'marketing_agent']) {
  const { assertUserActor } = require('./authz');
  return assertUserActor(actor, roles);
}

function requireOwnerOrManager(actor) {
  return requireRole(actor, ['owner', 'manager']);
}

function todayStr() {
  return new Date().toLocaleDateString('en-CA');
}

function getBrandKit() {
  const row = getDb().prepare('SELECT marketing_brand_kit, logo_path FROM shop_settings WHERE id=1').get();
  const kit = parseJson(row?.marketing_brand_kit, {});
  if (row?.logo_path && !kit.logo_path) kit.logo_path = row.logo_path;
  return {
    logo_path: kit.logo_path || '',
    primary_color: kit.primary_color || '#e11d48',
    secondary_color: kit.secondary_color || '#facc15',
    font_style: kit.font_style || 'Arial',
    footer_text: kit.footer_text || '',
    default_terms: kit.default_terms || 'Prices include VAT where applicable. While stocks last.'
  };
}

function saveBrandKit(data, actor) {
  requireRole(actor);
  const kit = {
    logo_path: data.logo_path || '',
    primary_color: data.primary_color || '#e11d48',
    secondary_color: data.secondary_color || '#facc15',
    font_style: data.font_style || 'Arial',
    footer_text: data.footer_text || '',
    default_terms: data.default_terms || 'Prices include VAT where applicable. While stocks last.'
  };
  getDb().prepare(`UPDATE shop_settings SET marketing_brand_kit=?, updated_at=datetime('now') WHERE id=1`)
    .run(JSON.stringify(kit));
  audit(actor?.id, actor?.username, 'save_brand_kit', null, kit);
  return getBrandKit();
}

function countLiveCampaigns(branchId) {
  const today = todayStr();
  let sql = `SELECT COUNT(*) AS c FROM promotion_flyers
    WHERE status='active' AND apply_pos_prices=1
    AND (start_date IS NULL OR start_date <= ?)
    AND (end_date IS NULL OR end_date >= ?)`;
  const params = [today, today];
  if (branchId) { sql += ' AND (branch_id IS NULL OR branch_id = ?)'; params.push(branchId); }
  return getDb().prepare(sql).get(...params).c || 0;
}

function validateCampaignDates(data) {
  if (!data?.end_date?.trim()) throw new Error('End date is required');
  if (data.start_date && data.end_date < data.start_date) {
    throw new Error('End date must be on or after start date');
  }
  return true;
}

function campaignDisplayStatus(f) {
  const today = todayStr();
  if (f.ended_at || f.status === 'expired' || (f.end_date && f.end_date < today)) return 'ended';
  if (f.status === 'active' && f.apply_pos_prices && (!f.end_date || f.end_date >= today)) return 'live';
  if (f.approval_status === 'pending') return 'pending';
  if (f.approval_status === 'approved') return 'approved';
  return 'draft';
}

function nextFlyerNumber() {
  const n = (getDb().prepare('SELECT COUNT(*) AS c FROM promotion_flyers').get().c || 0) + 1;
  return `FLY-${String(n).padStart(5, '0')}`;
}

function ensureBuiltinTemplates() {
  const db = getDb();
  for (const t of BUILTIN_TEMPLATES) {
    const ex = db.prepare('SELECT id FROM flyer_templates WHERE name = ? AND is_builtin = 1').get(t.name);
    if (!ex) {
      db.prepare('INSERT INTO flyer_templates (name, category, canvas_json, is_builtin) VALUES (?,?,?,1)')
        .run(t.name, t.category, JSON.stringify({ headline: t.headline, background: t.bg, elements: [] }));
    }
  }
}

function getFlyers(filters = {}) {
  let sql = 'SELECT * FROM promotion_flyers WHERE 1=1';
  const params = [];
  if (filters.status) { sql += ' AND status = ?'; params.push(filters.status); }
  if (filters.approval_status) { sql += ' AND approval_status = ?'; params.push(filters.approval_status); }
  if (filters.branch_id) { sql += ' AND (branch_id IS NULL OR branch_id = ?)'; params.push(filters.branch_id); }
  if (filters.campaign_goal) { sql += ' AND (campaign_goal = ? OR campaign_goal = \'all\')'; params.push(filters.campaign_goal); }
  sql += ' ORDER BY updated_at DESC';
  return getDb().prepare(sql).all(...params).map(r => {
    const row = {
      ...r,
      products: parseJson(r.products_json, []),
      canvas: parseJson(r.canvas_json, {}),
      branding: parseJson(r.branding_json, {}),
      pages: parseJson(r.pages_json, []),
      analytics: parseJson(r.analytics_json, {})
    };
    row.display_status = campaignDisplayStatus(row);
    return row;
  });
}

function getFlyer(id) {
  const r = getDb().prepare('SELECT * FROM promotion_flyers WHERE id = ?').get(id);
  if (!r) return null;
  const row = {
    ...r,
    products: parseJson(r.products_json, []),
    canvas: parseJson(r.canvas_json, {}),
    branding: parseJson(r.branding_json, {}),
    pages: parseJson(r.pages_json, []),
    analytics: parseJson(r.analytics_json, {}),
    original_prices: parseJson(r.original_prices_json, {})
  };
  row.display_status = campaignDisplayStatus(row);
  row.combos = row.canvas?.combos || [];
  return row;
}

function calcPromoPrice(product, promo) {
  const normal = Number(product.selling_price) || 0;
  const type = promo?.promo_type || 'special';
  if (type === 'special') return Number(promo.special_price) || normal;
  if (type === 'percent') return normal * (1 - (Number(promo.discount_percent) || 0) / 100);
  if (type === 'fixed') return Math.max(0, normal - (Number(promo.discount_amount) || 0));
  return normal;
}

function saveFlyer(data, actor) {
  requireRole(actor);
  const db = getDb();
  const products = data.products || [];
  const canvasObj = { ...(data.canvas || {}), combos: data.canvas?.combos || data.combos || [] };
  const canvas = JSON.stringify(canvasObj);
  const pages = JSON.stringify(data.pages || data.canvas?.pages || []);
  const analytics = JSON.stringify(data.analytics || {});
  const approvalStatus = data.approval_status || null;
  const campaignGoal = data.campaign_goal || 'all';
  const goLiveMode = data.go_live_mode || 'both';
  const autoGoLive = data.auto_go_live !== false && data.auto_go_live !== 0 ? 1 : 0;
  if (data.id) {
    try {
      db.prepare(`UPDATE promotion_flyers SET title=?, promotion_name=?, branch_id=?, start_date=?, end_date=?,
        flyer_size=?, status=?, canvas_json=?, products_json=?, branding_json=?, apply_pos_prices=?,
        pages_json=?, analytics_json=?, approval_status=COALESCE(?, approval_status),
        campaign_goal=?, go_live_mode=?, auto_go_live=?, updated_at=datetime('now') WHERE id=?`)
        .run(data.title, data.promotion_name || null, data.branch_id || null, data.start_date || null, data.end_date || null,
          data.flyer_size || 'a4_portrait', data.status || 'draft', canvas, JSON.stringify(products), JSON.stringify(data.branding || {}),
          data.apply_pos_prices ? 1 : 0, pages, analytics, approvalStatus, campaignGoal, goLiveMode, autoGoLive, data.id);
    } catch (_) {
      db.prepare(`UPDATE promotion_flyers SET title=?, promotion_name=?, branch_id=?, start_date=?, end_date=?,
        flyer_size=?, status=?, canvas_json=?, products_json=?, branding_json=?, apply_pos_prices=?, updated_at=datetime('now') WHERE id=?`)
        .run(data.title, data.promotion_name || null, data.branch_id || null, data.start_date || null, data.end_date || null,
          data.flyer_size || 'a4_portrait', data.status || 'draft', canvas, JSON.stringify(products), JSON.stringify(data.branding || {}),
          data.apply_pos_prices ? 1 : 0, data.id);
    }
    audit(actor?.id, actor?.username, 'update_flyer', data.id, { title: data.title });
    const saved = getFlyer(data.id);
    trySyncFlyerToHub(saved, data);
    return saved;
  }
  const num = nextFlyerNumber();
  try {
    const r = db.prepare(`INSERT INTO promotion_flyers (flyer_number, title, promotion_name, branch_id, start_date, end_date,
      flyer_size, status, canvas_json, products_json, branding_json, apply_pos_prices, pages_json, analytics_json, approval_status,
      campaign_goal, go_live_mode, auto_go_live, created_by, created_by_name)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      num, data.title, data.promotion_name || null, data.branch_id || null, data.start_date || null, data.end_date || null,
      data.flyer_size || 'a4_portrait', data.status || 'draft', canvas, JSON.stringify(products), JSON.stringify(data.branding || {}),
      data.apply_pos_prices ? 1 : 0, pages, analytics, approvalStatus || 'draft',
      campaignGoal, goLiveMode, autoGoLive,
      actor?.id || null, actor?.username || actor?.full_name || null
    );
    audit(actor?.id, actor?.username, 'create_flyer', r.lastInsertRowid, { title: data.title });
    const saved = getFlyer(r.lastInsertRowid);
    trySyncFlyerToHub(saved, data);
    return saved;
  } catch (_) {
    const r = db.prepare(`INSERT INTO promotion_flyers (flyer_number, title, promotion_name, branch_id, start_date, end_date,
      flyer_size, status, canvas_json, products_json, branding_json, apply_pos_prices, created_by, created_by_name)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      num, data.title, data.promotion_name || null, data.branch_id || null, data.start_date || null, data.end_date || null,
      data.flyer_size || 'a4_portrait', data.status || 'draft', canvas, JSON.stringify(products), JSON.stringify(data.branding || {}),
      data.apply_pos_prices ? 1 : 0, actor?.id || null, actor?.username || actor?.full_name || null
    );
    audit(actor?.id, actor?.username, 'create_flyer', r.lastInsertRowid, { title: data.title });
    const saved = getFlyer(r.lastInsertRowid);
    trySyncFlyerToHub(saved, data);
    return saved;
  }
}

function trySyncFlyerToHub(flyer, data) {
  if (!flyer?.id) return;
  if ((flyer.status || data?.status) === 'expired') return;
  try {
    require('./document-hub').syncFlyerToHub(flyer.id, {
      file_path: data?.hub_file_path,
      force: true
    });
  } catch (err) {
    console.warn('[document-hub] syncFlyerToHub failed:', err.message);
  }
}

function deleteFlyer(id, actor) {
  requireRole(actor);
  const f = getFlyer(id);
  if (!f) throw new Error('Flyer not found');
  const ownerOverride = adminOverride.isOwner(actor) && f.created_by && f.created_by !== actor?.id;
  if (ownerOverride) {
    const overrideMeta = adminOverride.assertCanModify(actor, f.created_by, { override_reason: actor?.override_reason });
    adminOverride.logAdminOverride(actor, 'admin_override_delete_flyer', 'promotion_flyer', id, {
      reason: overrideMeta.reason,
      record_owner_id: f.created_by,
      title: f.title
    });
  } else if (require('./authz').loadUserById(actor?.id)?.role === 'marketing_agent') {
    if (f.approval_status === 'approved' || f.approval_status === 'pending') {
      throw new Error('Marketing agents cannot delete submitted or approved campaigns');
    }
    if (f.status === 'active' && f.apply_pos_prices) {
      throw new Error('Marketing agents cannot delete live campaigns');
    }
    if (f.status !== 'draft' && f.approval_status !== 'draft' && f.approval_status !== 'rejected') {
      throw new Error('Marketing agents can only delete draft campaigns');
    }
  }
  getDb().prepare('DELETE FROM promotion_flyers WHERE id = ?').run(id);
  audit(actor?.id, actor?.username, 'delete_flyer', id, ownerOverride ? { admin_override: true } : null);
}

function duplicateFlyer(id, actor) {
  const f = getFlyer(id);
  if (!f) throw new Error('Flyer not found');
  return saveFlyer({
    title: `${f.title} (Copy)`,
    promotion_name: f.promotion_name,
    branch_id: f.branch_id,
    start_date: f.start_date,
    end_date: f.end_date,
    flyer_size: f.flyer_size,
    status: 'draft',
    canvas: f.canvas,
    products: f.products,
    branding: f.branding,
    apply_pos_prices: false,
    campaign_goal: f.campaign_goal || 'all',
    go_live_mode: f.go_live_mode || 'both',
    auto_go_live: f.auto_go_live !== 0
  }, actor);
}

function applyFlyerPricesToPosCore(flyerId, actorLabel = { id: null, username: 'system' }) {
  const f = getFlyer(flyerId);
  if (!f) throw new Error('Flyer not found');
  const linked = (f.products || []).filter(p => p.product_id);
  if (!linked.length) {
    throw new Error('Campaign has no linked products — cannot apply POS prices');
  }
  const db = getDb();
  const originals = {};
  let applied = 0;
  for (const p of linked) {
    const row = db.prepare('SELECT id, selling_price FROM products WHERE id = ?').get(p.product_id);
    if (!row) continue;
    originals[p.product_id] = row.selling_price;
    const special = calcPromoPrice(row, p);
    db.prepare('UPDATE products SET selling_price = ? WHERE id = ?').run(Math.round(special * 100) / 100, p.product_id);
    applied++;
  }
  if (!applied) {
    throw new Error('No matching POS products found for this campaign');
  }
  db.prepare('UPDATE promotion_flyers SET apply_pos_prices=1, original_prices_json=?, status=? WHERE id=?')
    .run(JSON.stringify(originals), 'active', flyerId);
  audit(actorLabel?.id, actorLabel?.username || 'system', 'apply_flyer_prices', flyerId, { count: applied });
  return getFlyer(flyerId);
}

function applyFlyerPricesToPos(flyerId, actor) {
  requireOwnerOrManager(actor);
  return applyFlyerPricesToPosCore(flyerId, actor);
}

function restoreFlyerPricesCore(flyerId, actorLabel = { id: null, username: 'system' }) {
  const f = getFlyer(flyerId);
  if (!f?.original_prices) return f;
  const db = getDb();
  for (const [pid, price] of Object.entries(f.original_prices)) {
    db.prepare('UPDATE products SET selling_price = ? WHERE id = ?').run(price, pid);
  }
  db.prepare('UPDATE promotion_flyers SET apply_pos_prices=0, status=? WHERE id=?').run('expired', flyerId);
  audit(actorLabel?.id, actorLabel?.username || 'system', 'restore_flyer_prices', flyerId, null);
  return getFlyer(flyerId);
}

function restoreFlyerPrices(flyerId, actor) {
  requireOwnerOrManager(actor);
  return restoreFlyerPricesCore(flyerId, actor);
}

function syncFlyerStatuses() {
  const today = todayStr();
  const db = getDb();

  const autoGoLive = db.prepare(`
    SELECT id FROM promotion_flyers
    WHERE approval_status='approved' AND status NOT IN ('active','expired')
    AND start_date <= ? AND (end_date IS NULL OR end_date >= ?)
    AND (auto_go_live=1 OR go_live_mode IN ('auto','both'))
    AND apply_pos_prices=0
  `).all(today, today);
  for (const row of autoGoLive) {
    try {
      if (countLiveCampaigns() < 2) {
        goLiveFlyerSystem(row.id);
      }
    } catch (_) { /* max live or other */ }
  }

  const pending = db.prepare(`SELECT id, canvas_json FROM promotion_flyers WHERE status IN ('scheduled','draft') AND start_date <= ? AND (end_date IS NULL OR end_date >= ?)`)
    .all(today, today);
  for (const row of pending) {
    const canvas = parseJson(row.canvas_json, {});
    const status = isScheduledToday(canvas) ? 'active' : 'scheduled';
    db.prepare(`UPDATE promotion_flyers SET status=?, updated_at=datetime('now') WHERE id=?`).run(status, row.id);
  }
  const active = db.prepare(`SELECT id, canvas_json FROM promotion_flyers WHERE status='active' AND start_date <= ? AND (end_date IS NULL OR end_date >= ?)`)
    .all(today, today);
  for (const row of active) {
    const canvas = parseJson(row.canvas_json, {});
    if (!isScheduledToday(canvas)) {
      db.prepare(`UPDATE promotion_flyers SET status='scheduled', updated_at=datetime('now') WHERE id=?`).run(row.id);
    }
  }
  const expired = db.prepare(`SELECT id FROM promotion_flyers WHERE status IN ('active','scheduled') AND end_date < ? AND apply_pos_prices=1`).all(today);
  for (const row of expired) {
    try { endCampaignSystem(row.id); } catch (_) {}
  }
  db.prepare(`UPDATE promotion_flyers SET status='expired', ended_at=COALESCE(ended_at, datetime('now'))
    WHERE status IN ('active','scheduled') AND end_date < ?`).run(today);
}

function goLiveFlyerCore(id, actorLabel = { id: null, username: 'system' }) {
  const f = getFlyer(id);
  if (!f) throw new Error('Flyer not found');
  if (f.approval_status !== 'approved') throw new Error('Campaign must be approved before going live');
  if (countLiveCampaigns(f.branch_id) >= 2) {
    throw new Error('Maximum 2 live campaigns allowed. End an active campaign first.');
  }
  validateCampaignDates(f);
  applyFlyerPricesToPosCore(id, actorLabel);
  const db = getDb();
  db.prepare(`UPDATE promotion_flyers SET status='active', live_at=datetime('now'), updated_at=datetime('now') WHERE id=?`).run(id);
  audit(actorLabel?.id, actorLabel?.username || 'system', 'go_live_flyer', id, { title: f.title });
  return getFlyer(id);
}

function goLiveFlyer(id, actor) {
  requireOwnerOrManager(actor);
  return goLiveFlyerCore(id, actor);
}

function goLiveFlyerSystem(id) {
  return goLiveFlyerCore(id, { id: null, username: 'system' });
}

function endCampaignCore(id, actorLabel = { id: null, username: 'system' }) {
  const f = getFlyer(id);
  if (!f) throw new Error('Flyer not found');
  if (f.apply_pos_prices) restoreFlyerPricesCore(id, actorLabel);
  const db = getDb();
  db.prepare(`UPDATE promotion_flyers SET status='expired', ended_at=datetime('now'), updated_at=datetime('now') WHERE id=?`).run(id);
  audit(actorLabel?.id, actorLabel?.username || 'system', 'end_campaign', id, { title: f.title });
  return getFlyer(id);
}

function endCampaign(id, actor) {
  requireOwnerOrManager(actor);
  return endCampaignCore(id, actor);
}

function endCampaignSystem(id) {
  return endCampaignCore(id, { id: null, username: 'system' });
}

function getActiveCampaigns(branchId) {
  const today = todayStr();
  let sql = `SELECT id, flyer_number, title, promotion_name, branch_id, start_date, end_date, live_at, campaign_goal
    FROM promotion_flyers
    WHERE status='active' AND apply_pos_prices=1
    AND (start_date IS NULL OR start_date <= ?)
    AND (end_date IS NULL OR end_date >= ?)`;
  const params = [today, today];
  if (branchId) { sql += ' AND (branch_id IS NULL OR branch_id = ?)'; params.push(branchId); }
  sql += ' ORDER BY live_at DESC LIMIT 2';
  return getDb().prepare(sql).all(...params);
}

/** Overlay PROMO badges / original_price for products in live flyer campaigns (prices already mutated on go-live). */
function applyFlyerPromoOverlay(products, preloadedFlyers) {
  if (!products?.length) return products;
  const today = todayStr();
  const live = Array.isArray(preloadedFlyers)
    ? preloadedFlyers
    : getDb().prepare(`
    SELECT id, end_date, original_prices_json, products_json FROM promotion_flyers
    WHERE status='active' AND apply_pos_prices=1
    AND (start_date IS NULL OR start_date <= ?)
    AND (end_date IS NULL OR end_date >= ?)
    ORDER BY live_at DESC
  `).all(today, today);
  if (!live.length) return products;

  const flyerPromo = {};
  for (const f of live) {
    const originals = parseJson(f.original_prices_json, {});
    const productsList = parseJson(f.products_json, []);
    for (const p of productsList) {
      const pid = p.product_id;
      if (!pid || flyerPromo[pid]) continue;
      flyerPromo[pid] = {
        original_price: originals[pid] != null ? Number(originals[pid]) : (Number(p.normal_price) || null),
        end_date: f.end_date || null,
        flyer_id: f.id
      };
    }
    for (const [pid, price] of Object.entries(originals)) {
      if (flyerPromo[pid]) continue;
      flyerPromo[pid] = { original_price: Number(price), end_date: f.end_date || null, flyer_id: f.id };
    }
  }

  return products.map(p => {
    if (p.promo_active) return p;
    const fp = flyerPromo[p.id];
    if (!fp) return p;
    return {
      ...p,
      promo_active: true,
      original_price: fp.original_price != null ? fp.original_price : p.original_price,
      promo_end_date: fp.end_date,
      source_flyer_id: fp.flyer_id
    };
  });
}

function getCampaignDashboard() {
  const db = getDb();
  const today = todayStr();
  const rows = db.prepare(`
    SELECT
      SUM(CASE WHEN status='draft' OR (approval_status='draft' AND status!='expired') THEN 1 ELSE 0 END) AS draft_count,
      SUM(CASE WHEN approval_status='pending' THEN 1 ELSE 0 END) AS pending_count,
      SUM(CASE WHEN approval_status='approved' AND NOT (status='active' AND apply_pos_prices=1) THEN 1 ELSE 0 END) AS approved_count,
      SUM(CASE WHEN status='active' AND apply_pos_prices=1 AND (end_date IS NULL OR end_date >= ?) THEN 1 ELSE 0 END) AS live_count,
      SUM(CASE WHEN status='expired' OR ended_at IS NOT NULL OR (end_date IS NOT NULL AND end_date < ?) THEN 1 ELSE 0 END) AS ended_count
    FROM promotion_flyers
  `).get(today, today);

  const liveFlyers = db.prepare(`
    SELECT id, products_json, start_date, end_date FROM promotion_flyers
    WHERE status='active' AND apply_pos_prices=1 AND (end_date IS NULL OR end_date >= ?)
  `).all(today);
  let totalLiveRevenue = 0;
  for (const f of liveFlyers) {
    try {
      const products = parseJson(f.products_json, []);
      const pids = products.map(p => p.product_id).filter(Boolean);
      if (!pids.length || !f.start_date) continue;
      const ph = pids.map(() => '?').join(',');
      const end = f.end_date || today;
      const row = db.prepare(`
        SELECT COALESCE(SUM(si.line_total), 0) AS revenue
        FROM sale_items si JOIN sales s ON s.id = si.sale_id
        WHERE si.product_id IN (${ph}) AND date(s.created_at) >= ? AND date(s.created_at) <= ?
      `).get(...pids, f.start_date, end);
      totalLiveRevenue += row?.revenue || 0;
    } catch (_) {}
  }

  return {
    draft: rows?.draft_count || 0,
    pending: rows?.pending_count || 0,
    approved: rows?.approved_count || 0,
    live: rows?.live_count || 0,
    ended: rows?.ended_count || 0,
    total_live_revenue: totalLiveRevenue
  };
}

function getTemplates() {
  ensureBuiltinTemplates();
  return getDb().prepare('SELECT * FROM flyer_templates ORDER BY is_builtin DESC, name').all()
    .map(t => ({ ...t, canvas: parseJson(t.canvas_json, {}) }));
}

function saveFlyerTemplate(data, actor) {
  requireRole(actor);
  if (!data?.name?.trim()) throw new Error('Template name is required');
  const db = getDb();
  const canvas = JSON.stringify({
    ...(data.canvas || {}),
    products: data.products || [],
    combos: data.combos || data.canvas?.combos || [],
    flyer_size: data.flyer_size || 'a4_portrait'
  });
  const r = db.prepare('INSERT INTO flyer_templates (name, category, canvas_json, is_builtin) VALUES (?,?,?,0)')
    .run(data.name.trim(), data.category || 'custom', canvas);
  audit(actor?.id, actor?.username, 'save_flyer_template', r.lastInsertRowid, { name: data.name });
  return { id: r.lastInsertRowid, name: data.name.trim(), canvas: parseJson(canvas, {}) };
}

function buildFlyerPdf(flyerId, shopSettings, sizeOverride) {
  const f = getFlyer(flyerId);
  if (!f) throw new Error('Flyer not found');
  const s = shopSettings || getDb().prepare('SELECT shop_name, address, phone, currency, logo_path FROM shop_settings WHERE id=1').get() || {};
  const currency = s.currency || 'R';
  const flyerSize = sizeOverride || f.flyer_size || 'a4_portrait';
  const size = FLYER_SIZES[flyerSize] || FLYER_SIZES.a4_portrait;
  const doc = createFlyerPdfDoc(size);
  // Render using the intended canvas size (not jsPDF's possibly-swapped pageSize)
  const pageW = size.w;
  const pageH = size.h;
  const canvas = f.canvas || {};
  const elements = getCanvasElements(f).filter(e => !e.hidden);
  const useRetail = canvas.useRetailLayout !== false;
  const hasProductLayers = elements.some(e => ['product-img', 'price-tag', 'product'].includes(e.type));
  const itemCount = (f.products?.length || 0) + (f.combos?.length || canvas.combos?.length || 0);

  if (canvas.backgroundImage) {
    renderPdfImage(doc, canvas.backgroundImage, 0, 0, pageW, pageH);
  } else {
    setFillFromHex(doc, canvas.background || '#e11d48');
    doc.rect(0, 0, pageW, pageH, 'F');
  }

  if (useRetail && itemCount && !hasProductLayers) {
    setTextFromHex(doc, '#ffffff');
    doc.setFontSize(22);
    doc.text(canvas.headline || f.title || 'SPECIAL OFFERS', pageW / 2, 24, { align: 'center' });
    if (f.start_date || f.end_date) {
      doc.setFontSize(9);
      doc.text(`Valid: ${f.start_date || '—'} to ${f.end_date || '—'}`, pageW / 2, 32, { align: 'center' });
    }
    renderLegacyProductGrid(doc, f, pageW, currency);
    const overlays = elements.filter(e => !['product-img', 'price-tag', 'product'].includes(e.type));
    overlays.sort((a, b) => (a.z || 0) - (b.z || 0)).forEach(lyr => renderCanvasLayer(doc, lyr, f, pageW, pageH, currency));
  } else if (elements.length) {
    const sorted = [...elements].sort((a, b) => (a.z || 0) - (b.z || 0));
    sorted.forEach(lyr => renderCanvasLayer(doc, lyr, f, pageW, pageH, currency));
    if (!sorted.some(e => e.type === 'headline' || e.type === 'text')) {
      setTextFromHex(doc, '#ffffff');
      doc.setFontSize(22);
      doc.text(canvas.headline || f.title || 'SPECIAL OFFERS', pageW / 2, 24, { align: 'center' });
    }
  } else {
    setTextFromHex(doc, '#ffffff');
    doc.setFontSize(22);
    doc.text(canvas.headline || f.title || 'SPECIAL OFFERS', pageW / 2, 30, { align: 'center' });
    doc.setFontSize(11);
    doc.text(s.shop_name || 'Chisanyama Connection', pageW / 2, 40, { align: 'center' });
    if (f.start_date || f.end_date) {
      doc.setFontSize(9);
      doc.text(`Valid: ${f.start_date || '—'} to ${f.end_date || '—'}`, pageW / 2, 48, { align: 'center' });
    }
    renderLegacyProductGrid(doc, f, pageW, currency);
  }

  setTextFromHex(doc, '#ffffff');
  doc.setFontSize(8);
  doc.text(s.address || '', 14, pageH - 20);
  doc.text(String(s.phone || ''), 14, pageH - 14);
  doc.text(canvas.terms || 'Prices include VAT where applicable. While stocks last.', 14, pageH - 8);
  return doc.output('arraybuffer');
}

function submitFlyerForApproval(flyerId, actor) {
  requireRole(actor);
  const f = getFlyer(flyerId);
  if (!f) throw new Error('Flyer not found');
  validateCampaignDates(f);
  const db = getDb();
  db.prepare(`UPDATE promotion_flyers SET approval_status='pending', submitted_at=datetime('now'), updated_at=datetime('now') WHERE id=?`)
    .run(flyerId);
  audit(actor?.id, actor?.username, 'submit_flyer_approval', flyerId, null);
  return getFlyer(flyerId);
}

function approveFlyer(flyerId, actor) {
  requireOwnerOrManager(actor);
  const db = getDb();
  db.prepare(`UPDATE promotion_flyers SET approval_status='approved', approved_by=?, approved_at=datetime('now'), updated_at=datetime('now') WHERE id=?`)
    .run(actor?.id || null, flyerId);
  audit(actor?.id, actor?.username, 'approve_flyer', flyerId, null);
  return getFlyer(flyerId);
}

function rejectFlyer(flyerId, actor, notes) {
  requireOwnerOrManager(actor);
  const db = getDb();
  db.prepare(`UPDATE promotion_flyers SET approval_status='rejected', rejection_notes=?, updated_at=datetime('now') WHERE id=?`)
    .run(notes || null, flyerId);
  audit(actor?.id, actor?.username, 'reject_flyer', flyerId, { notes });
  return getFlyer(flyerId);
}

function getFlyerAnalytics(flyerId) {
  const f = getFlyer(flyerId);
  if (!f) throw new Error('Flyer not found');
  const analytics = parseJson(f.analytics_json, { views: 0, exports: 0, prints: 0, shares: 0, pdf_downloads: 0 });
  const db = getDb();
  let promoSales = 0;
  let promoRevenue = 0;
  if (f.start_date && f.products?.length) {
    const pids = f.products.map(p => p.product_id).filter(Boolean);
    if (pids.length) {
      const ph = pids.map(() => '?').join(',');
      const end = f.end_date || new Date().toLocaleDateString('en-CA');
      try {
        const row = db.prepare(`
          SELECT COUNT(DISTINCT si.sale_id) AS sales_count, COALESCE(SUM(si.line_total), 0) AS revenue
          FROM sale_items si JOIN sales s ON s.id = si.sale_id
          WHERE si.product_id IN (${ph}) AND date(s.created_at) >= ? AND date(s.created_at) <= ?
        `).get(...pids, f.start_date, end);
        promoSales = row?.sales_count || 0;
        promoRevenue = row?.revenue || 0;
      } catch (_) {}
    }
  }
  return { ...analytics, promo_sales: promoSales, promo_revenue: promoRevenue, product_count: f.products?.length || 0 };
}

function getSmartPromotionSuggestions(filters = {}, actor) {
  requireRole(actor);
  const db = getDb();
  const limit = Math.min(Number(filters.limit) || 12, 50);
  const type = filters.type || 'best_sellers';
  let rows = [];
  if (type === 'best_sellers') {
    rows = db.prepare(`
      SELECT p.id, p.name, p.selling_price, p.buying_price, p.stock_quantity, p.category_id, c.name AS category_name,
        COALESCE(SUM(si.quantity), 0) AS units_sold
      FROM products p LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN sale_items si ON si.product_id = p.id
      LEFT JOIN sales s ON s.id = si.sale_id AND date(s.created_at) >= date('now', '-30 days')
      WHERE p.is_active = 1 GROUP BY p.id ORDER BY units_sold DESC LIMIT ?
    `).all(limit);
  } else if (type === 'slow_movers') {
    rows = db.prepare(`
      SELECT p.id, p.name, p.selling_price, p.buying_price, p.stock_quantity, p.category_id, c.name AS category_name,
        COALESCE(SUM(si.quantity), 0) AS units_sold
      FROM products p LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN sale_items si ON si.product_id = p.id
      WHERE p.is_active = 1 GROUP BY p.id HAVING units_sold <= 2 ORDER BY p.stock_quantity DESC LIMIT ?
    `).all(limit);
  } else if (type === 'low_stock') {
    rows = db.prepare(`
      SELECT p.id, p.name, p.selling_price, p.buying_price, p.stock_quantity, p.category_id, c.name AS category_name
      FROM products p LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.is_active = 1 AND p.stock_quantity <= p.min_stock ORDER BY p.stock_quantity ASC LIMIT ?
    `).all(limit);
  } else if (type === 'high_profit') {
    rows = db.prepare(`
      SELECT p.id, p.name, p.selling_price, p.buying_price, p.stock_quantity, p.category_id, c.name AS category_name,
        (p.selling_price - COALESCE(p.buying_price, 0)) AS margin
      FROM products p LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.is_active = 1 ORDER BY margin DESC LIMIT ?
    `).all(limit);
  } else if (type === 'combos') {
    rows = db.prepare(`
      SELECT p.id, p.name, p.selling_price, p.buying_price, p.stock_quantity, p.category_id, c.name AS category_name
      FROM combo_items ci JOIN products p ON p.id = ci.product_id
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.is_active = 1 GROUP BY p.id LIMIT ?
    `).all(limit);
  } else if (type === 'new') {
    rows = db.prepare(`
      SELECT p.id, p.name, p.selling_price, p.buying_price, p.stock_quantity, p.category_id, c.name AS category_name
      FROM products p LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.is_active = 1 AND date(p.created_at) >= date('now', '-14 days') ORDER BY p.created_at DESC LIMIT ?
    `).all(limit);
  }
  const headline = {
    best_sellers: 'TOP SELLERS — LIMITED TIME',
    slow_movers: 'CLEARANCE — MUST GO',
    low_stock: 'WHILE STOCKS LAST',
    high_profit: 'PREMIUM SPECIALS',
    combos: 'COMBO DEALS',
    new: 'NEW ARRIVALS'
  }[type] || 'SPECIAL OFFERS';
  return {
    type,
    headline,
    suggested_discount_percent: type === 'slow_movers' ? 25 : type === 'low_stock' ? 15 : 10,
    products: rows.map(p => ({
      product_id: p.id, name: p.name, product_name: p.name, category: p.category_name,
      normal_price: p.selling_price, selling_price: p.selling_price,
      picture_path: p.picture_path || null,
      promo_type: 'percent', discount_percent: type === 'slow_movers' ? 25 : 10,
      special_price: p.selling_price
    }))
  };
}

const AI_PALETTES = [
  { keys: ['black friday', 'bf', 'cyber'], template: 'black_friday', bg: '#111827', headline: 'BLACK FRIDAY MEGA DEALS', type: 'high_profit', discount: 25 },
  { keys: ['weekend', 'saturday', 'sunday'], template: 'weekend', bg: '#2563eb', headline: 'WEEKEND SPECIALS', type: 'best_sellers', discount: 15 },
  { keys: ['combo', 'bundle', 'meal'], template: 'combo_products', bg: '#0f766e', headline: 'COMBO DEALS', type: 'combos', discount: 12, layout: 'combo_right', productShape: 'circle' },
  { keys: ['clearance', 'must go', 'end of line'], template: 'clearance', bg: '#f59e0b', headline: 'CLEARANCE — MUST GO', type: 'slow_movers', discount: 30 },
  { keys: ['new', 'arrival', 'launch'], template: 'new_products', bg: '#0ea5e9', headline: 'NEW ARRIVALS', type: 'new', discount: 8 },
  { keys: ['christmas', 'xmas', 'festive'], template: 'christmas', bg: '#dc2626', headline: 'CHRISTMAS SPECIALS', type: 'best_sellers', discount: 15 },
  { keys: ['easter'], template: 'easter', bg: '#84cc16', headline: 'EASTER SPECIALS', type: 'best_sellers', discount: 12 },
  { keys: ['restaurant', 'menu', 'food', 'chisanyama'], template: 'restaurant', bg: '#b45309', headline: 'RESTAURANT SPECIALS', type: 'best_sellers', discount: 10 },
  { keys: ['premium', 'luxury', 'vip'], template: 'monthly', bg: '#7c3aed', headline: 'PREMIUM SELECTION', type: 'high_profit', discount: 8 },
  { keys: ['stock', 'low', 'last'], template: 'clearance', bg: '#ea580c', headline: 'WHILE STOCKS LAST', type: 'low_stock', discount: 20 }
];

function detectAiFlyerPlan(prompt = '', goal = '') {
  const text = `${prompt} ${goal}`.toLowerCase();
  for (const plan of AI_PALETTES) {
    if (plan.keys.some((k) => text.includes(k))) return { ...plan };
  }
  if (text.includes('profit') || text.includes('margin')) {
    return { template: 'monthly', bg: '#7c3aed', headline: 'TOP PROFIT PICKS', type: 'high_profit', discount: 10 };
  }
  return { template: 'classic_grid', bg: '#15803d', headline: 'SPECIAL OFFERS', type: 'best_sellers', discount: 12 };
}

function generateAiFlyer(filters = {}, actor) {
  requireRole(actor);
  const prompt = String(filters.prompt || filters.brief || '').trim();
  const goal = String(filters.goal || filters.campaign_goal || '').trim();
  const limit = Math.min(Number(filters.limit) || 8, 12);
  const plan = detectAiFlyerPlan(prompt, goal);
  const suggestions = getSmartPromotionSuggestions({ type: plan.type || 'best_sellers', limit }, actor);
  const db = getDb();
  let shopName = 'Our Store';
  try {
    shopName = db.prepare('SELECT shop_name FROM shop_settings WHERE id=1').get()?.shop_name || shopName;
  } catch (_) { /* ignore */ }
  const headline = (prompt && prompt.length > 4 && prompt.length < 60) ? prompt.toUpperCase() : (plan.headline || 'SPECIAL OFFERS');
  const discount = Number(filters.discount) || plan.discount || 12;
  const products = (suggestions.products || []).map((p) => {
    const price = Number(p.selling_price || p.normal_price) || 0;
    const special = calcPromoPrice({ selling_price: price }, { promo_type: 'percent', discount_percent: discount });
    return {
      ...p,
      promo_type: 'percent',
      promo_percent: discount,
      discount_percent: discount,
      special_price: special,
      original_price: price
    };
  });
  return {
    promotion_name: prompt ? prompt.slice(0, 80) : 'AI Generated Promotion',
    title: headline,
    headline,
    campaign_goal: goal || plan.type || 'all',
    flyer_size: filters.flyer_size || 'a4_portrait',
    suggested_discount_percent: discount,
    ai_summary: `AI selected ${products.length} products, applied ${discount}% promo pricing, and chose the ${plan.template || 'classic'} layout.`,
    canvas: {
      templateId: plan.template,
      background: plan.bg,
      headline,
      layout: plan.layout || 'grid',
      productShape: plan.productShape || 'square',
      layoutCols: plan.layout === 'combo_right' ? 1 : 3,
      itemSize: products.length <= 4 ? 'large' : 'medium'
    },
    products,
    branding: { accent: plan.bg, shop_name: shopName }
  };
}

function buildWaUrl(phone, message) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) throw new Error('Phone number required');
  const num = digits.startsWith('0') ? `27${digits.slice(1)}` : digits;
  return `https://wa.me/${num}?text=${encodeURIComponent(message || '')}`;
}

function shareFlyerCampaign(flyerId, options = {}, actor) {
  requireRole(actor);
  const f = getFlyer(flyerId);
  if (!f) throw new Error('Flyer not found');
  const shop = getDb().prepare('SELECT shop_name, phone FROM shop_settings WHERE id=1').get() || {};
  const channel = options.channel || 'whatsapp';
  const defaultMsg = `🔥 ${f.title}${f.promotion_name ? ` — ${f.promotion_name}` : ''}\n\nVisit ${shop.shop_name || 'us'} for special deals!${f.end_date ? `\nValid until ${f.end_date}` : ''}\n📞 ${shop.phone || ''}`;
  const message = options.message?.trim() || defaultMsg;
  const phones = Array.isArray(options.phones) ? options.phones.filter(Boolean) : (options.phone ? [options.phone] : []);
  const urls = phones.map(phone => ({ phone, url: buildWaUrl(phone, message) }));
  recordFlyerEvent(flyerId, 'share');
  audit(actor?.id, actor?.username, 'share_flyer_campaign', flyerId, { channel, recipient_count: phones.length });
  return { message, channel, urls, flyer_id: flyerId };
}

function recordFlyerEvent(flyerId, eventType) {
  const f = getFlyer(flyerId);
  if (!f) throw new Error('Flyer not found');
  const analytics = parseJson(f.analytics_json, { views: 0, exports: 0, prints: 0, shares: 0, pdf_downloads: 0 });
  const map = { view: 'views', print: 'prints', export: 'exports', share: 'shares', pdf: 'pdf_downloads' };
  const key = map[eventType];
  if (key) analytics[key] = (analytics[key] || 0) + 1;
  getDb().prepare(`UPDATE promotion_flyers SET analytics_json=?, updated_at=datetime('now') WHERE id=?`)
    .run(JSON.stringify(analytics), flyerId);
  return analytics;
}

function isScheduledToday(canvas) {
  const days = canvas?.schedule_days;
  if (!days?.length) return true;
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const today = dayNames[new Date().getDay()];
  return days.some(d => String(d).trim().toLowerCase().startsWith(today.toLowerCase().slice(0, 3)));
}

function bulkUpdateFlyerPrices(flyerId, updates, actor) {
  requireRole(actor);
  const f = getFlyer(flyerId);
  if (!f) throw new Error('Flyer not found');
  const products = (f.products || []).map(p => {
    const copy = { ...p };
    if (updates.promo_type) copy.promo_type = updates.promo_type;
    if (updates.promo_type === 'percent' && updates.discount_percent != null) {
      copy.discount_percent = Number(updates.discount_percent);
    } else if (updates.promo_type === 'fixed' && updates.discount_amount != null) {
      copy.discount_amount = Number(updates.discount_amount);
    } else if (updates.promo_type === 'special' && updates.special_price != null) {
      copy.special_price = Number(updates.special_price);
    } else if (updates.discount_percent != null) {
      copy.promo_type = 'percent';
      copy.discount_percent = Number(updates.discount_percent);
    }
    return copy;
  });
  const db = getDb();
  db.prepare(`UPDATE promotion_flyers SET products_json=?, updated_at=datetime('now') WHERE id=?`)
    .run(JSON.stringify(products), flyerId);
  audit(actor?.id, actor?.username, 'bulk_update_flyer_prices', flyerId, updates);
  return getFlyer(flyerId);
}

module.exports = {
  FLYER_SIZES, BUILTIN_TEMPLATES,
  getFlyers, getFlyer, saveFlyer, deleteFlyer, duplicateFlyer,
  applyFlyerPricesToPos, restoreFlyerPrices, syncFlyerStatuses,
  getTemplates, saveFlyerTemplate, buildFlyerPdf, calcPromoPrice, ensureBuiltinTemplates,
  submitFlyerForApproval, approveFlyer, rejectFlyer, getFlyerAnalytics,
  getSmartPromotionSuggestions, generateAiFlyer, bulkUpdateFlyerPrices, recordFlyerEvent, isScheduledToday,
  getBrandKit, saveBrandKit, countLiveCampaigns, validateCampaignDates,
  goLiveFlyer, endCampaign, getActiveCampaigns, getCampaignDashboard,
  shareFlyerCampaign, campaignDisplayStatus, buildWaUrl, applyFlyerPromoOverlay
};

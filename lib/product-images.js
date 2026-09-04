/** Resolve product/logo images for public web routes (online order, logo). */
const path = require('path');
const fs = require('fs');

function dataRoot() {
  try {
    const db = require('../electron/database/db');
    return path.dirname(db.getDbPathForBackup?.() || db.getDbPath?.() || path.join(process.cwd(), 'data'));
  } catch (_) {
    return path.join(process.cwd(), 'data');
  }
}

function mimeFromExt(ext) {
  const e = String(ext || '').toLowerCase();
  return { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }[e] || 'image/jpeg';
}

function resolvePicturePath(pic) {
  if (!pic) return null;
  const raw = String(pic);
  if (raw.startsWith('data:image/')) {
    const m = raw.match(/^data:(image\/[^;]+);base64,(.+)$/);
    if (!m) return null;
    return { kind: 'inline', mime: m[1], buffer: Buffer.from(m[2], 'base64') };
  }
  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    return { kind: 'url', url: raw };
  }
  const root = path.resolve(dataRoot());
  const candidates = [
    raw,
    path.join(root, raw),
    path.join(root, 'assets', raw),
    path.join(root, 'assets', path.basename(raw))
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const resolved = path.resolve(candidate);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) continue;
    try {
      if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
        return { kind: 'file', path: resolved, mime: mimeFromExt(path.extname(resolved)) };
      }
    } catch (_) { /* */ }
  }
  return null;
}

function getProductImage(productId) {
  const store = require('../electron/services/store');
  const product = store.getProduct(Number(productId));
  if (!product) throw new Error('Product not found');
  const pic = product.picture_path || product.image_path || product.image;
  const resolved = resolvePicturePath(pic);
  if (!resolved) throw new Error('Image not available');
  if (resolved.kind === 'url') throw new Error('Image not available');
  if (resolved.kind === 'inline') return { mime: resolved.mime, buffer: resolved.buffer };
  return { path: resolved.path, mime: resolved.mime };
}

function getComboImage(comboId) {
  const combosSvc = require('../electron/services/combos');
  const combo = combosSvc.getCombo(Number(comboId));
  if (!combo) throw new Error('Combo not found');
  const resolved = resolvePicturePath(combo.image_path || combo.picture_path);
  if (!resolved) throw new Error('Image not available');
  if (resolved.kind === 'inline') return { mime: resolved.mime, buffer: resolved.buffer };
  return { path: resolved.path, mime: resolved.mime };
}

function getShopLogo() {
  try {
    const db = require('../electron/database/db').getDb();
    const row = db.prepare('SELECT logo_path FROM shop_settings WHERE id=1').get();
    const resolved = resolvePicturePath(row?.logo_path);
    if (!resolved) throw new Error('Logo not available');
    if (resolved.kind === 'inline') return { mime: resolved.mime, buffer: resolved.buffer };
    return { path: resolved.path, mime: resolved.mime };
  } catch (e) {
    throw new Error('Logo not available');
  }
}

function publicProductImageUrl(productId, isCombo = false) {
  if (!productId) return null;
  return isCombo ? `/api/combo-image/${productId}` : `/api/product-image/${productId}`;
}

module.exports = {
  resolvePicturePath, getProductImage, getComboImage, getShopLogo, publicProductImageUrl, mimeFromExt
};

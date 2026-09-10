/** Resolve product/logo images for public web routes (online order, logo). */
const path = require('path');
const fs = require('fs');

const CACHE_MAX = 256;
const imageCache = new Map();

function cacheGet(key) {
  if (!imageCache.has(key)) return null;
  const val = imageCache.get(key);
  imageCache.delete(key);
  imageCache.set(key, val);
  return val;
}

function cacheSet(key, val) {
  if (imageCache.has(key)) imageCache.delete(key);
  imageCache.set(key, val);
  while (imageCache.size > CACHE_MAX) {
    const oldest = imageCache.keys().next().value;
    imageCache.delete(oldest);
  }
}

function invalidateProductImage(productId) {
  if (productId != null) imageCache.delete(`p:${Number(productId)}`);
}

function invalidateComboImage(comboId) {
  if (comboId != null) imageCache.delete(`c:${Number(comboId)}`);
}

function clearImageCache() {
  imageCache.clear();
}

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

function loadImageFromResolved(resolved) {
  if (resolved.kind === 'inline') return { mime: resolved.mime, buffer: resolved.buffer };
  const buffer = fs.readFileSync(resolved.path);
  return { mime: resolved.mime, buffer };
}

function getProductImage(productId) {
  const id = Number(productId);
  const key = `p:${id}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const db = require('../electron/database/db').getDb();
  const row = db.prepare('SELECT picture_path, image_path, image FROM products WHERE id = ?').get(id);
  if (!row) throw new Error('Product not found');
  const pic = row.picture_path || row.image_path || row.image;
  const resolved = resolvePicturePath(pic);
  if (!resolved) throw new Error('Image not available');
  if (resolved.kind === 'url') throw new Error('Image not available');
  const file = loadImageFromResolved(resolved);
  cacheSet(key, file);
  return file;
}

function getComboImage(comboId) {
  const id = Number(comboId);
  const key = `c:${id}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const db = require('../electron/database/db').getDb();
  const row = db.prepare('SELECT image_path, picture_path FROM combos WHERE id = ?').get(id);
  if (!row) throw new Error('Combo not found');
  const raw = row.image_path || row.picture_path;
  const resolved = resolvePicturePath(raw);
  if (!resolved) throw new Error('Image not available');
  if (resolved.kind === 'url') throw new Error('Image not available');
  const file = loadImageFromResolved(resolved);
  cacheSet(key, file);
  return file;
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

function getNotificationSound(panel) {
  try {
    const db = require('../electron/database/db').getDb();
    let row = null;
    try {
      row = db.prepare('SELECT notification_settings, kds_notification_sound FROM shop_settings WHERE id=1').get();
    } catch (_) {
      row = db.prepare('SELECT notification_settings FROM shop_settings WHERE id=1').get();
    }
    let path = null;
    try {
      const ns = row?.notification_settings ? JSON.parse(row.notification_settings) : {};
      const p = String(panel || '').trim();
      if (p && ns?.panel_sounds?.[p]?.sound_path) {
        path = ns.panel_sounds[p].sound_path;
      }
      if (!path) path = ns?.sound_path || null;
    } catch (_) { /* ignore */ }
    if (!path && row?.kds_notification_sound) path = row.kds_notification_sound;
    const resolved = resolvePicturePath(path);
    if (!resolved) throw new Error('Notification sound not available');
    if (resolved.kind === 'inline') return { mime: resolved.mime, buffer: resolved.buffer };
    return { path: resolved.path, mime: resolved.mime || 'audio/mpeg' };
  } catch (e) {
    throw new Error('Notification sound not available');
  }
}

function publicProductImageUrl(productId, isCombo = false) {
  if (!productId) return null;
  return isCombo ? `/api/combo-image/${productId}` : `/api/product-image/${productId}`;
}

function publicAssetImageUrl(pic) {
  if (!pic) return null;
  const raw = String(pic);
  if (raw.startsWith('data:')) return raw;
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  return `/api/app-image?p=${encodeURIComponent(raw)}`;
}

function getAppImage(encodedPath) {
  const decoded = decodeURIComponent(String(encodedPath || ''));
  const key = `a:${decoded}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const resolved = resolvePicturePath(decoded);
  if (!resolved) throw new Error('Image not available');
  if (resolved.kind === 'url') throw new Error('Image not available');
  const file = loadImageFromResolved(resolved);
  cacheSet(key, file);
  return file;
}

module.exports = {
  resolvePicturePath,
  getProductImage,
  getComboImage,
  getAppImage,
  getShopLogo,
  getNotificationSound,
  publicProductImageUrl,
  publicAssetImageUrl,
  mimeFromExt,
  invalidateProductImage,
  invalidateComboImage,
  clearImageCache
};

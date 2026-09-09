/**
 * Android APK storage for remote app updates.
 * Primary: cloud-data/android-downloads (persists on Railway volume at /app/cloud-data)
 * Fallback: public/android-downloads (bundled in deploy)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const APK_CATALOG = [
  { file: 'ShopPOS-POS.apk', label: 'Shop POS' },
  { file: 'ShopPOS-StaffPortal.apk', label: 'Staff Portal' },
  { file: 'ShopPOS-Recipe.apk', label: 'Recipe & Production' },
  { file: 'ShopPOS-Expenses.apk', label: 'Expenses' },
  { file: 'ShopPOS-Driver.apk', label: 'Driver App' },
  { file: 'ShopPOS-Manager.apk', label: 'Business Manager' },
  { file: 'ShopPOS-OnlineOrdering.apk', label: 'Online Ordering' }
];

function primaryDir() {
  if (process.env.SHOP_POS_APK_DIR) return path.resolve(process.env.SHOP_POS_APK_DIR);
  return path.join(ROOT, 'cloud-data', 'android-downloads');
}

function bundledDir() {
  return path.join(ROOT, 'public', 'android-downloads');
}

function ensurePrimaryDir() {
  const dir = primaryDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function isAllowedFileName(fileName) {
  const base = path.basename(String(fileName || ''));
  return APK_CATALOG.some((a) => a.file.toLowerCase() === base.toLowerCase());
}

function resolveApkPath(fileName) {
  const base = path.basename(String(fileName || ''));
  if (!isAllowedFileName(base)) return null;
  const primary = path.join(primaryDir(), base);
  if (fs.existsSync(primary)) return primary;
  const bundled = path.join(bundledDir(), base);
  if (fs.existsSync(bundled)) return bundled;
  return null;
}

function fileInfo(fileName) {
  const base = path.basename(String(fileName || ''));
  const row = APK_CATALOG.find((a) => a.file.toLowerCase() === base.toLowerCase());
  if (!row) return null;
  const resolved = resolveApkPath(base);
  if (!resolved) {
    return { ...row, uploaded: false, size: 0, updatedAt: null };
  }
  const st = fs.statSync(resolved);
  return {
    ...row,
    uploaded: true,
    size: st.size,
    updatedAt: st.mtime.toISOString(),
    source: resolved.startsWith(primaryDir()) ? 'cloud' : 'bundled'
  };
}

function listStatus() {
  return APK_CATALOG.map((row) => fileInfo(row.file));
}

function saveApk(fileName, buffer) {
  const base = path.basename(String(fileName || ''));
  if (!isAllowedFileName(base)) throw new Error('Unknown APK file name');
  if (!buffer || !buffer.length) throw new Error('Empty file');
  if (buffer.length < 10000) throw new Error('File too small to be a valid APK');
  const dir = ensurePrimaryDir();
  const dest = path.join(dir, base);
  fs.writeFileSync(dest, buffer);
  try {
    require('../scripts/write-mobile-releases.js').writeMobileReleases();
  } catch (_) { /* optional at runtime */ }
  return fileInfo(base);
}

module.exports = {
  APK_CATALOG,
  primaryDir,
  bundledDir,
  isAllowedFileName,
  resolveApkPath,
  listStatus,
  saveApk
};

const { Capacitor } = require('@capacitor/core');
const { Filesystem, Directory } = require('@capacitor/filesystem');
const { Share } = require('@capacitor/share');

const EXPORT_DIR = 'ShopPOS/exports';
const BACKUP_DIR = 'ShopPOS/backups';
const DATA_DIR = 'ShopPOS/data';
const LIVE_DB_NAME = 'shop-pos.db';
const LIVE_DB_PATH = `${DATA_DIR}/${LIVE_DB_NAME}`;

function isNative() {
  return typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform();
}

function uint8ToBase64(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < arr.length; i += chunk) {
    binary += String.fromCharCode(...arr.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToUint8(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function safeFilename(name) {
  return String(name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
}

async function writeToDocuments(relativePath, bytes) {
  await Filesystem.writeFile({
    path: relativePath,
    data: uint8ToBase64(bytes),
    directory: Directory.Documents,
    recursive: true
  });
  const { uri } = await Filesystem.getUri({
    directory: Directory.Documents,
    path: relativePath
  });
  return {
    path: relativePath,
    uri,
    displayPath: `Documents/${relativePath}`
  };
}

async function shareUri(uri, title) {
  await Share.share({
    title: title || 'Shop POS',
    url: uri,
    dialogTitle: 'Save or share file'
  });
}

async function saveAndShare(filename, bytes, subdir = EXPORT_DIR) {
  const safeName = safeFilename(filename);
  const relativePath = `${subdir}/${safeName}`;
  const written = await writeToDocuments(relativePath, bytes);
  await shareUri(written.uri, safeName);
  return { success: true, path: written.displayPath, uri: written.uri };
}

async function saveSilent(filename, bytes, subdir = BACKUP_DIR) {
  const safeName = safeFilename(filename);
  const relativePath = `${subdir}/${safeName}`;
  const written = await writeToDocuments(relativePath, bytes);
  return { success: true, path: written.displayPath, uri: written.uri };
}

async function fileExists(relativePath) {
  try {
    await Filesystem.stat({ path: relativePath, directory: Directory.Documents });
    return true;
  } catch {
    return false;
  }
}

async function readFromDocuments(relativePath) {
  const file = await Filesystem.readFile({
    path: relativePath,
    directory: Directory.Documents
  });
  if (file.data instanceof ArrayBuffer) return new Uint8Array(file.data);
  if (typeof file.data === 'string') return base64ToUint8(file.data);
  return null;
}

/** Survives APK uninstall/update — live mirror of the shop database. */
async function saveLiveDatabase(bytes) {
  if (!isNative()) return { skipped: true };
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return writeToDocuments(LIVE_DB_PATH, arr);
}

async function loadLiveDatabase() {
  if (!isNative()) return null;
  try {
    if (!(await fileExists(LIVE_DB_PATH))) return null;
    return await readFromDocuments(LIVE_DB_PATH);
  } catch (err) {
    console.warn('[ShopPOS] live DB read failed:', err?.message || err);
    return null;
  }
}

async function listBackupFiles() {
  if (!isNative()) return [];
  try {
    const listing = await Filesystem.readdir({
      path: BACKUP_DIR,
      directory: Directory.Documents
    });
    const files = (listing.files || [])
      .map(f => (typeof f === 'string' ? f : f.name))
      .filter(name => /\.db$/i.test(name || ''))
      .sort((a, b) => String(b).localeCompare(String(a)));
    return files.map(name => `${BACKUP_DIR}/${name}`);
  } catch {
    return [];
  }
}

/**
 * After update/reinstall IndexedDB is empty. Prefer live Documents mirror,
 * then newest dated backup, so setup/login come back automatically.
 */
async function loadDurableDatabase() {
  if (!isNative()) return null;
  const live = await loadLiveDatabase();
  if (live && live.length > 100) {
    return { bytes: live, source: `Documents/${LIVE_DB_PATH}` };
  }
  const backups = await listBackupFiles();
  for (const path of backups) {
    try {
      const bytes = await readFromDocuments(path);
      if (bytes && bytes.length > 100) {
        return { bytes, source: `Documents/${path}` };
      }
    } catch (_) { /* try next */ }
  }
  return null;
}

function getBackupFolderDisplay() {
  return `Documents/${BACKUP_DIR}`;
}

function getDataFolderDisplay() {
  return `Documents/${DATA_DIR}`;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function backupFilename(dateKey = todayKey()) {
  return `ShopPOS-backup-${dateKey}.db`;
}

module.exports = {
  isNative,
  uint8ToBase64,
  base64ToUint8,
  saveAndShare,
  saveSilent,
  shareUri,
  writeToDocuments,
  readFromDocuments,
  fileExists,
  saveLiveDatabase,
  loadLiveDatabase,
  loadDurableDatabase,
  listBackupFiles,
  getBackupFolderDisplay,
  getDataFolderDisplay,
  backupFilename,
  todayKey,
  EXPORT_DIR,
  BACKUP_DIR,
  DATA_DIR,
  LIVE_DB_PATH
};

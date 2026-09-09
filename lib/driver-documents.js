/** Save and serve driver registration documents (selfie, ID, vehicle photos). */
const path = require('path');
const fs = require('fs');
const { resolvePicturePath, mimeFromExt } = require('./product-images');

function dataRoot() {
  try {
    const db = require('../electron/database/db');
    return path.dirname(db.getDbPathForBackup?.() || db.getDbPath?.() || path.join(process.cwd(), 'data'));
  } catch (_) {
    return path.join(process.cwd(), 'data');
  }
}

function driverDocDir(driverId) {
  return path.join(dataRoot(), 'driver-docs', String(driverId));
}

function saveDataUrl(driverId, key, dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const m = dataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
  if (!m) return null;
  const ext = m[1].includes('png') ? '.png' : '.jpg';
  const dir = driverDocDir(driverId);
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${key}${ext}`;
  const full = path.join(dir, filename);
  fs.writeFileSync(full, Buffer.from(m[2], 'base64'));
  return `driver-docs/${driverId}/${filename}`;
}

function saveRegistrationDocuments(driverId, data) {
  const meta = { vehicle_photos: [] };
  const selfiePath = saveDataUrl(driverId, 'selfie', data.selfie);
  const idPath = saveDataUrl(driverId, 'id_photo', data.id_photo);
  if (selfiePath) meta.selfie = selfiePath;
  if (idPath) meta.id_photo = idPath;
  const vehiclePhotos = Array.isArray(data.vehicle_photos) ? data.vehicle_photos : [];
  vehiclePhotos.slice(0, 5).forEach((photo, i) => {
    const p = saveDataUrl(driverId, `vehicle_${i}`, photo);
    if (p) meta.vehicle_photos.push(p);
  });
  if (data.vehicle_registration) meta.vehicle_registration = String(data.vehicle_registration).trim();
  return {
    meta,
    profile_photo_path: selfiePath || null
  };
}

function getDriverDocument(driverId, docKey) {
  const dir = driverDocDir(driverId);
  const safeKey = String(docKey || '').replace(/[^a-z0-9_]/gi, '');
  if (!safeKey) throw new Error('Invalid document');
  for (const ext of ['.jpg', '.jpeg', '.png', '.webp']) {
    const full = path.join(dir, `${safeKey}${ext}`);
    if (fs.existsSync(full)) {
      return { path: full, mime: mimeFromExt(ext) };
    }
  }
  throw new Error('Document not found');
}

function publicDocUrl(driverId, docKey) {
  if (!driverId || !docKey) return null;
  return `/api/driver-doc/${driverId}/${docKey}`;
}

function driverDocumentUrls(driver) {
  if (!driver?.id) return {};
  const docs = typeof driver.documents_json === 'string'
    ? (() => { try { return JSON.parse(driver.documents_json); } catch (_) { return {}; } })()
    : (driver.documents || driver.documents_json || {});
  return {
    selfie: driver.profile_photo_path || docs.selfie ? publicDocUrl(driver.id, 'selfie') : null,
    id_photo: docs.id_photo ? publicDocUrl(driver.id, 'id_photo') : null,
    vehicle_photos: (docs.vehicle_photos || []).map((_, i) => publicDocUrl(driver.id, `vehicle_${i}`))
  };
}

module.exports = {
  saveRegistrationDocuments, getDriverDocument, publicDocUrl, driverDocumentUrls, dataRoot
};

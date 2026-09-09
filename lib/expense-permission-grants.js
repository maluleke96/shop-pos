/** Persist expense permission grant evidence (photo + audio). */
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

function grantDir(grantId) {
  return path.join(dataRoot(), 'expense-grants', String(grantId));
}

function saveDataUrl(fullPath, dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return null;
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, Buffer.from(m[2], 'base64'));
  return fullPath;
}

function saveGrantMedia(grantId, photoDataUrl, audioDataUrl) {
  const dir = grantDir(grantId);
  fs.mkdirSync(dir, { recursive: true });
  let photoPath = null;
  let recordingPath = null;
  if (photoDataUrl) {
    const rel = `expense-grants/${grantId}/approver.jpg`;
    saveDataUrl(path.join(dataRoot(), rel), photoDataUrl);
    photoPath = rel;
  }
  if (audioDataUrl) {
    const ext = String(audioDataUrl).includes('audio/webm') ? '.webm' : '.m4a';
    const rel = `expense-grants/${grantId}/statement${ext}`;
    saveDataUrl(path.join(dataRoot(), rel), audioDataUrl);
    recordingPath = rel;
  }
  return { photoPath, recordingPath };
}

function publicGrantPhotoUrl(grantId) {
  return grantId ? `/api/expense-grant-photo/${grantId}` : null;
}

function publicGrantRecordingUrl(grantId) {
  return grantId ? `/api/expense-grant-recording/${grantId}` : null;
}

function getGrantPhoto(grantId) {
  const dir = grantDir(grantId);
  for (const ext of ['.jpg', '.jpeg', '.png', '.webp']) {
    const full = path.join(dir, `approver${ext}`);
    if (fs.existsSync(full)) {
      return { path: full, mime: ext === '.png' ? 'image/png' : 'image/jpeg' };
    }
  }
  throw new Error('Photo not found');
}

function getGrantRecording(grantId) {
  const dir = grantDir(grantId);
  for (const name of ['statement.webm', 'statement.m4a', 'statement.mp3']) {
    const full = path.join(dir, name);
    if (fs.existsSync(full)) {
      const mime = name.endsWith('.webm') ? 'audio/webm' : 'audio/mp4';
      return { path: full, mime };
    }
  }
  throw new Error('Recording not found');
}

module.exports = {
  saveGrantMedia,
  publicGrantPhotoUrl,
  publicGrantRecordingUrl,
  getGrantPhoto,
  getGrantRecording,
  dataRoot
};

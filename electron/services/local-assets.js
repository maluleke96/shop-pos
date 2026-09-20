const fs = require('fs');
const path = require('path');
const { getDbDir } = require('../database/db');

function assetsDir(...parts) {
  const dir = path.join(getDbDir(), 'assets', ...parts.filter(Boolean));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function fileDataUrl(filePath) {
  if (!filePath) return null;
  const raw = String(filePath);
  if (raw.startsWith('data:')) return raw;
  try {
    if (!fs.existsSync(raw)) return null;
    const ext = path.extname(raw).toLowerCase();
    const mime = ext === '.png' ? 'image/png'
      : ext === '.webp' ? 'image/webp'
      : ext === '.gif' ? 'image/gif'
      : ext === '.pdf' ? 'application/pdf'
      : 'image/jpeg';
    return `data:${mime};base64,${fs.readFileSync(raw).toString('base64')}`;
  } catch (_) {
    return null;
  }
}

module.exports = { assetsDir, fileDataUrl };

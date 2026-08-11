const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function getFilePath() {
  return path.join(app.getPath('userData'), 'device-settings.json');
}

function load() {
  try {
    const fp = getFilePath();
    if (!fs.existsSync(fp)) return {};
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch {
    return {};
  }
}

function save(data) {
  const merged = { ...load(), ...data };
  fs.writeFileSync(getFilePath(), JSON.stringify(merged, null, 2));
  return merged;
}

function clear() {
  try {
    const fp = getFilePath();
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  } catch (_) {}
}

module.exports = { load, save, clear };

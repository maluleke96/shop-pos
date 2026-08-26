const fs = require('fs');
const path = require('path');
const os = require('os');

// Soft-require Electron so Railway / web (node server.js) can boot without Electron installed.
let electronApp = null;
try {
  electronApp = require('electron').app;
} catch (_) {
  electronApp = null;
}

function getUserDataDir() {
  if (electronApp && typeof electronApp.getPath === 'function') {
    try {
      return electronApp.getPath('userData');
    } catch (_) {
      /* Electron not ready */
    }
  }
  return path.join(os.homedir(), '.shop-pos');
}

function getFilePath() {
  const dir = getUserDataDir();
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (_) {
    /* ignore */
  }
  return path.join(dir, 'device-settings.json');
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

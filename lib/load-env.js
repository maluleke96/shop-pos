/**
 * Minimal .env loader (no dotenv dependency).
 * Does not override variables already set in the process environment.
 */
const fs = require('fs');
const path = require('path');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return false;
  const text = fs.readFileSync(filePath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
  return true;
}

function loadProjectEnv(rootDir) {
  const root = rootDir || path.join(__dirname, '..');
  loadEnvFile(path.join(root, '.env'));
  loadEnvFile(path.join(root, '.env.local'));
}

module.exports = { loadEnvFile, loadProjectEnv };

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const VERSION = pkg.version;

function versionedName(filename) {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  if (base.includes(`-v${VERSION}`)) return filename;
  return `${base}-v${VERSION}${ext}`;
}

function safeCopy(src, dest, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      fs.copyFileSync(src, dest);
      return true;
    } catch (err) {
      if (i === retries - 1) {
        const alt = dest.replace(/(\.\w+)$/, `-alt$1`);
        try { fs.copyFileSync(src, alt); console.warn(`Locked: copied as ${path.basename(alt)}`); return true; } catch (_) {}
        console.warn(`Skipped locked file: ${path.basename(dest)} (${err.code})`);
        return false;
      }
      spawnSync('powershell', ['-Command', 'Start-Sleep -Milliseconds 500'], { stdio: 'ignore' });
    }
  }
  return false;
}

const distDir = path.join(__dirname, '..', 'dist');
const releaseDir = path.join(distDir, 'ShopPOS-Release');
const zipPath = path.join(distDir, `ShopPOS-Release-v${VERSION}.zip`);

if (!fs.existsSync(distDir)) {
  console.error('dist/ folder not found. Run npm run build first.');
  process.exit(1);
}

if (fs.existsSync(releaseDir)) fs.rmSync(releaseDir, { recursive: true, force: true });
fs.mkdirSync(releaseDir, { recursive: true });

const readme = `# Shop POS — Windows & Tablet Install v${VERSION}

## What's new in v${VERSION}
- **Same shop everywhere** — installer login (online) opens the same shop as the browser URL
- **Faster app** — lighter sign-in load; pages load on demand
- **Larger desktop login** — welcome/sign-in card sized for computer screens
- **A4 printer setup** — Admin Printer Setup A4 (USB/Bluetooth) for Reports & Bookkeeping Print
- **UPDATE only** — existing shop data is preserved

## Windows PC (x64)
- **Shop POS Setup x64-v${VERSION}.exe** — installer
- **ShopPOS-Portable-x64-v${VERSION}.exe** — portable, no install

## Tablet (ARM64 — Surface, Windows tablets)
- **Shop POS Setup arm64-v${VERSION}.exe** — installer
- **ShopPOS-Portable-arm64-v${VERSION}.exe** — portable, no install

## First launch
Use the account created during first-time setup. Data stored locally (offline).
`;

fs.writeFileSync(path.join(releaseDir, 'INSTALL.txt'), readme);

for (const file of fs.readdirSync(distDir)) {
  const lower = file.toLowerCase();
  if (lower.endsWith('.exe') || lower.endsWith('.blockmap')) {
    safeCopy(path.join(distDir, file), path.join(releaseDir, versionedName(file)));
  }
}

if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

const zipResult = spawnSync('powershell', [
  '-NoProfile', '-Command',
  `Compress-Archive -Path '${releaseDir.replace(/'/g, "''")}\\*' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`
], { stdio: 'inherit' });

if (zipResult.status !== 0) process.exit(zipResult.status || 1);

const downloadsShop = path.join(require('os').homedir(), 'Downloads', 'ShopPOS');
if (!fs.existsSync(downloadsShop)) fs.mkdirSync(downloadsShop, { recursive: true });
for (const file of fs.readdirSync(distDir)) {
  const lower = file.toLowerCase();
  if (lower.endsWith('.exe')) {
    safeCopy(path.join(distDir, file), path.join(downloadsShop, versionedName(file)));
  }
}
safeCopy(zipPath, path.join(downloadsShop, `ShopPOS-Release-v${VERSION}.zip`));
safeCopy(path.join(releaseDir, 'INSTALL.txt'), path.join(downloadsShop, 'INSTALL-v' + VERSION + '.txt'));

console.log('\nRelease ZIP created:', zipPath);
console.log('Release folder:', releaseDir);
console.log('Copied to Downloads:', downloadsShop);
console.log('Version:', VERSION);

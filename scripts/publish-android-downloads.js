/**
 * Copy built APKs to public/android-downloads/ for remote phone updates.
 * Usage: node scripts/publish-android-downloads.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const srcDir = path.join(process.env.USERPROFILE || process.env.HOME || '', 'Downloads', 'ShopPOS-Installers', 'Android');
const destDir = path.join(root, 'public', 'android-downloads');
const cloudDir = path.join(root, 'cloud-data', 'android-downloads');

if (!fs.existsSync(srcDir)) {
  console.error('No APK folder found:', srcDir);
  console.error('Run: npm run build:all-android');
  process.exit(1);
}

fs.mkdirSync(destDir, { recursive: true });
fs.mkdirSync(cloudDir, { recursive: true });
const apks = fs.readdirSync(srcDir).filter((f) => f.endsWith('.apk'));
if (!apks.length) {
  console.error('No APK files in', srcDir);
  process.exit(1);
}

for (const name of apks) {
  fs.copyFileSync(path.join(srcDir, name), path.join(destDir, name));
  fs.copyFileSync(path.join(srcDir, name), path.join(cloudDir, name));
  const mb = (fs.statSync(path.join(destDir, name)).size / (1024 * 1024)).toFixed(1);
  console.log('Published', name, `(${mb} MB)`);
}

require('./write-mobile-releases.js').writeMobileReleases();
console.log('\nRemote update URLs ready at /downloads/*.apk after deploy.');

/**
 * Write mobile-releases.json — version manifest for installed Android apps.
 * Run after bumping package.json version or building APKs.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version || '2.10.26';
const versionCode = Number(String(version).replace(/\D/g, '')) || 21026;
const cloudUrl = (process.env.SHOP_POS_CLOUD_URL || process.env.SHOP_POS_PUBLIC_URL || 'https://chisafood.up.railway.app').replace(/\/$/, '');

const apps = [
  { id: 'com.shoppos.pos', apk: 'ShopPOS-POS.apk', label: 'Shop POS' },
  { id: 'com.shoppos.staff', apk: 'ShopPOS-StaffPortal.apk', label: 'Staff Portal' },
  { id: 'com.shoppos.recipe', apk: 'ShopPOS-Recipe.apk', label: 'Recipe & Production' },
  { id: 'com.shoppos.expense', apk: 'ShopPOS-Expenses.apk', label: 'Expenses' },
  { id: 'com.shoppos.driver', apk: 'ShopPOS-Driver.apk', label: 'Driver App' },
  { id: 'com.shoppos.manager', apk: 'ShopPOS-Manager.apk', label: 'Business Manager' },
  { id: 'com.shoppos.order', apk: 'ShopPOS-OnlineOrdering.apk', label: 'Online Ordering' }
];

const manifest = {};
for (const app of apps) {
  manifest[app.id] = {
    versionName: version,
    versionCode,
    apkFile: app.apk,
    apkUrl: `${cloudUrl}/downloads/${app.apk}`,
    label: app.label,
    force: false,
    notes: `Shop POS update v${version} — install the latest APK for bug fixes and new features.`
  };
}

function writeMobileReleases() {
  const outPath = path.join(root, 'mobile-releases.json');
  fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2), 'utf8');
  return { outPath, version, versionCode, manifest };
}

if (require.main === module) {
  const { outPath, version, versionCode } = writeMobileReleases();
  console.log('Wrote', outPath, `(v${version}, code ${versionCode})`);
}

module.exports = { writeMobileReleases };

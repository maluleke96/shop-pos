/**
 * Build all Android APKs — each loads the LIVE cloud UI (same as browser).
 * Output: %USERPROFILE%\Downloads\ShopPOS-Installers\Android\
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const destRoot = path.join(process.env.USERPROFILE || process.env.HOME || '', 'Downloads', 'ShopPOS-Installers', 'Android');

function runNode(script, extraArgs = []) {
  const r = spawnSync(process.execPath, [path.join('scripts', script), ...extraArgs], {
    cwd: root,
    stdio: 'inherit',
    shell: false,
    env: process.env
  });
  if (r.status !== 0) throw new Error(`${script} failed (exit ${r.status})`);
}

fs.mkdirSync(destRoot, { recursive: true });
console.log('Building cloud-shell Android installers →', destRoot);
console.log('Cloud URL:', process.env.SHOP_POS_CLOUD_URL || 'https://chisafood.up.railway.app');
console.log('Each APK loads the same live URL as the browser — one database, one UI.\n');

const started = Date.now();
try {
  runNode('build-cloud-shell-android.js', ['all']);
} catch (err) {
  console.error('Build failed:', err.message || err);
  process.exit(1);
}

const apks = fs.existsSync(destRoot)
  ? fs.readdirSync(destRoot).filter((f) => f.endsWith('.apk')).sort()
  : [];

const readme = `Shop POS — Android Installers (Cloud Shell)
============================================

Each app loads the SAME live shop URL as the browser.
Data, products, and screens stay in sync — no separate offline copy.

Apps in this folder:
${apks.map((f) => `  • ${f}`).join('\n')}

  ShopPOS-POS.apk            → ${process.env.SHOP_POS_CLOUD_URL || 'https://chisafood.up.railway.app'}/pos-app.html
  ShopPOS-StaffPortal.apk    → …/staff-app.html
  ShopPOS-Recipe.apk         → …/recipe-app.html
  ShopPOS-Expenses.apk       → …/expenses/
  ShopPOS-Driver.apk         → …/driver/
  ShopPOS-Manager.apk        → …/manager/
  ShopPOS-OnlineOrdering.apk → …/order/

Requires internet. When you update the shop online, Android apps update automatically
(no new APK needed for UI/data changes). APK updates only needed for native shell changes.

Built: ${new Date().toLocaleString()}
`;
fs.writeFileSync(path.join(destRoot, 'README.txt'), readme, 'utf8');

if (apks.length) {
  try {
    require('./publish-android-downloads.js');
  } catch (err) {
    console.warn('Could not publish APKs for remote updates:', err.message || err);
  }
}

const mins = ((Date.now() - started) / 60000).toFixed(1);
console.log(`\nDone in ${mins} min. APKs in:\n  ${destRoot}\n`);
console.log(apks.map((f) => `  ✓ ${f}`).join('\n') || '  (no APKs found)');

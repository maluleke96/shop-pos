/**
 * Build Android APKs for Kiosk, Kitchen, Drive-Thru, Customer Order Display.
 * Uses the same cloud-shell pipeline as other installers (live URL + unique applicationId).
 *
 * Usage:
 *   node scripts/build-ops-apps-android.js kiosk
 *   node scripts/build-ops-apps-android.js all
 * Env: SHOP_POS_CLOUD_URL (default Chisa production URL)
 */
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const mode = (process.argv[2] || 'all').trim().toLowerCase();
const allowed = new Set(['kiosk', 'drive-thru', 'kitchen', 'customer-display', 'all']);
if (!allowed.has(mode)) {
  console.error('Usage: node scripts/build-ops-apps-android.js [kiosk|drive-thru|kitchen|customer-display|all]');
  process.exit(1);
}

const ids = mode === 'all' ? ['kiosk', 'drive-thru', 'kitchen', 'customer-display'] : [mode];

console.log('Ops Android builds delegate to build-cloud-shell-android.js (unique package per app).\n');
for (const id of ids) {
  const r = spawnSync(process.execPath, [path.join('scripts', 'build-cloud-shell-android.js'), id], {
    cwd: root,
    stdio: 'inherit',
    env: process.env
  });
  if (r.status !== 0) process.exit(r.status || 1);
}

console.log('\nDone. APKs in Downloads\\ShopPOS-Ops-Installers\\Android\\ and copies in ShopPOS-Installers\\Android\\');

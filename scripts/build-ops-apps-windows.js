/**
 * Package Windows launchers for Kiosk, Kitchen, Drive-Thru, Customer Order Display.
 * Usage: node scripts/build-ops-apps-windows.js [kiosk|kitchen|drive-thru|customer-display|all]
 * Env: SHOP_POS_CLOUD_URL, SHOP_POS_SYNC_URL, or SHOP_POS_LAB_URL (default Chisa shop URL)
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const cloudUrl = (process.env.SHOP_POS_CLOUD_URL || process.env.SHOP_POS_SYNC_URL || process.env.SHOP_POS_LAB_URL || 'https://chisafood.up.railway.app').replace(/\/$/, '');
const destRoot = path.join(process.env.USERPROFILE || process.env.HOME || '', 'Downloads', 'ShopPOS-Ops-Installers', 'Windows');

const APPS = {
  kiosk: { shell: 'electron/kiosk-shell.js', name: 'ShopPOS-Kiosk', appId: 'com.shoppos.kiosk' },
  kitchen: { shell: 'electron/kitchen-shell.js', name: 'ShopPOS-Kitchen-Display', appId: 'com.shoppos.kitchen' },
  'drive-thru': { shell: 'electron/drive-thru-shell.js', name: 'ShopPOS-Drive-Thru', appId: 'com.shoppos.drivethru' },
  'customer-display': { shell: 'electron/customer-display-shell.js', name: 'ShopPOS-Customer-Order-Display', appId: 'com.shoppos.customerdisplay' }
};

function buildOne(key) {
  const spec = APPS[key];
  if (!spec) throw new Error(`Unknown app: ${key}`);
  const pkgPath = path.join(root, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const backup = { main: pkg.main, build: pkg.build };
  pkg.main = spec.shell;
  pkg.build = {
    appId: spec.appId,
    productName: spec.name,
    directories: { output: path.join(root, 'dist-ops', key) },
    files: ['electron/**/*', 'package.json'],
    win: { target: [{ target: 'nsis', arch: ['x64'] }] }
  };
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
  const env = { ...process.env, SHOP_POS_SYNC_URL: cloudUrl, SHOP_POS_LAB_URL: cloudUrl };
  const r = spawnSync('npx', ['electron-builder', '--win', '--x64'], { cwd: root, stdio: 'inherit', shell: true, env });
  fs.writeFileSync(pkgPath, JSON.stringify({ ...pkg, main: backup.main, build: backup.build }, null, 2));
  if (r.status !== 0) throw new Error(`Build failed: ${key}`);
  fs.mkdirSync(destRoot, { recursive: true });
  const outDir = path.join(root, 'dist-ops', key);
  for (const f of fs.readdirSync(outDir)) {
    if (f.endsWith('.exe')) fs.copyFileSync(path.join(outDir, f), path.join(destRoot, f));
  }
  console.log('Windows installer →', destRoot);
}

const mode = (process.argv[2] || 'all').trim();
const keys = mode === 'all' ? Object.keys(APPS) : [mode];
console.log('Cloud URL baked into shells:', cloudUrl);
for (const k of keys) {
  console.log('\n=== Windows build:', k, '===');
  buildOne(k);
}

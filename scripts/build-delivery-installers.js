/**
 * Build Delivery Department Windows + Android installers into Downloads.
 * Usage: node scripts/build-delivery-installers.js [--windows] [--android] [--all]
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const cloudUrl = (process.env.SHOP_POS_CLOUD_URL || 'https://chisafood.up.railway.app').replace(/\/$/, '');
const installersRoot = path.join(
  process.env.USERPROFILE || process.env.HOME || '',
  'Downloads',
  'ShopPOS-Installers'
);
const args = process.argv.slice(2);
const doWin = args.includes('--windows') || args.includes('--all') || args.length === 0;
const doAndroid = args.includes('--android') || args.includes('--all') || args.length === 0;

function run(cmd, argv, opts = {}) {
  const r = spawnSync(cmd, argv, {
    cwd: opts.cwd || root,
    stdio: 'inherit',
    shell: opts.shell === true,
    env: opts.env || process.env
  });
  if (r.status !== 0) throw new Error(`Failed: ${cmd} ${argv.join(' ')}`);
}

function sleepMs(ms) {
  spawnSync('powershell', ['-NoProfile', '-Command', `Start-Sleep -Milliseconds ${ms}`], { stdio: 'ignore' });
}

function safeCopy(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  let lastErr;
  for (let i = 0; i < 8; i++) {
    try {
      const tmp = `${dest}.new-${Date.now()}`;
      fs.copyFileSync(src, tmp);
      try { fs.renameSync(tmp, dest); } catch (_) {
        try { fs.unlinkSync(dest); } catch (__) { /* */ }
        fs.renameSync(tmp, dest);
      }
      console.log(`  → ${dest}`);
      return;
    } catch (err) {
      lastErr = err;
      sleepMs(700 + i * 400);
    }
  }
  throw lastErr;
}

if (doWin) {
  console.log('\n=== Delivery Department Windows (live shell) ===');
  const bake = path.join(root, 'electron', 'cloud-shell-config-delivery.js');
  fs.writeFileSync(
    bake,
    `process.env.SHOP_POS_APP_MODE = "delivery";\n` +
      `process.env.SHOP_POS_SYNC_URL = ${JSON.stringify(cloudUrl)};\n` +
      `require('./delivery-shell.js');\n`
  );
  const cfg = {
    appId: 'com.shoppos.delivery',
    productName: 'Delivery Department',
    directories: { output: path.join('dist', 'cloud-apps', 'delivery'), buildResources: 'build' },
    files: ['electron/delivery-shell.js', 'package.json'],
    extraMetadata: { main: 'electron/delivery-shell.js', name: 'com.shoppos.delivery' },
    win: {
      target: [
        { target: 'nsis', arch: ['x64'] },
        { target: 'portable', arch: ['x64'] }
      ]
    },
    nsis: {
      oneClick: false,
      allowToChangeInstallationDirectory: true,
      createDesktopShortcut: true,
      createStartMenuShortcut: true,
      artifactName: 'ShopPOS-Delivery-Setup.${ext}',
      shortcutName: 'Delivery Department'
    },
    portable: { artifactName: 'ShopPOS-Delivery-Portable.${ext}' }
  };
  const cfgPath = path.join(root, 'electron-builder.cloud-delivery.json');
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  const ebCli = require.resolve('electron-builder/cli.js');
  run(process.execPath, [ebCli, '--config', cfgPath, '--win', '--x64'], {
    env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' }
  });
  const outDir = path.join(root, 'dist', 'cloud-apps', 'delivery');
  const destDir = path.join(installersRoot, 'Delivery-Department');
  if (fs.existsSync(path.join(outDir, 'ShopPOS-Delivery-Setup.exe'))) {
    safeCopy(path.join(outDir, 'ShopPOS-Delivery-Setup.exe'), path.join(destDir, 'ShopPOS-Delivery-Setup.exe'));
  }
  if (fs.existsSync(path.join(outDir, 'ShopPOS-Delivery-Portable.exe'))) {
    safeCopy(path.join(outDir, 'ShopPOS-Delivery-Portable.exe'), path.join(destDir, 'ShopPOS-Delivery-Portable.exe'));
  }
}

if (doAndroid) {
  console.log('\n=== Delivery Department Android APK ===');
  run(process.execPath, [path.join('scripts', 'build-cloud-shell-android.js'), 'delivery']);
}

console.log(`\nDone. Installers under:\n  ${installersRoot}\\Delivery-Department\\\n  ${installersRoot}\\Android\\ShopPOS-DeliveryDepartment.apk\n`);

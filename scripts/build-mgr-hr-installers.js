/**
 * Build Manager & Supervisor Portal Windows + Android installers into Downloads.
 * Usage: node scripts/build-mgr-hr-installers.js [--windows] [--android] [--all]
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
  console.log('\n=== Manager & Supervisor Portal Windows (live shell) ===');
  const bake = path.join(root, 'electron', 'cloud-shell-config-mgr-hr.js');
  fs.writeFileSync(
    bake,
    `process.env.SHOP_POS_APP_MODE = "mgr-hr";\n` +
      `process.env.SHOP_POS_SYNC_URL = ${JSON.stringify(cloudUrl)};\n` +
      `require('./mgr-hr-shell.js');\n`
  );
  const cfg = {
    appId: 'com.shoppos.mgrhr',
    productName: 'ManagerSupervisorPortal',
    executableName: 'ManagerSupervisorPortal',
    directories: { output: path.join('dist', 'cloud-apps', 'mgr-hr'), buildResources: 'build' },
    files: ['electron/mgr-hr-shell.js', 'electron/cloud-shell-config-mgr-hr.js', 'package.json'],
    extraMetadata: { main: 'electron/cloud-shell-config-mgr-hr.js', name: 'com.shoppos.mgrhr' },
    win: {
      target: [
        { target: 'nsis', arch: ['x64'] },
        { target: 'portable', arch: ['x64'] }
      ]
    },
    nsis: {
      oneClick: false,
      allowToChangeInstallationDirectory: true,
      allowElevation: true,
      createDesktopShortcut: true,
      createStartMenuShortcut: true,
      runAfterFinish: false,
      deleteAppDataOnUninstall: false,
      include: 'nsis-close-mgr-hr.nsh',
      artifactName: 'ShopPOS-ManagerSupervisorPortal-Setup.${ext}',
      shortcutName: 'Manager Supervisor Portal'
    },
    portable: { artifactName: 'ShopPOS-ManagerSupervisorPortal-Portable.${ext}' }
  };
  const cfgPath = path.join(root, 'electron-builder.cloud-mgr-hr.json');
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  const ebCli = require.resolve('electron-builder/cli.js');
  run(process.execPath, [ebCli, '--config', cfgPath, '--win', '--x64'], {
    env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' }
  });
  const outDir = path.join(root, 'dist', 'cloud-apps', 'mgr-hr');
  const destDir = path.join(installersRoot, 'Manager-Supervisor-Portal');
  if (fs.existsSync(path.join(outDir, 'ShopPOS-ManagerSupervisorPortal-Setup.exe'))) {
    safeCopy(path.join(outDir, 'ShopPOS-ManagerSupervisorPortal-Setup.exe'), path.join(destDir, 'ShopPOS-ManagerSupervisorPortal-Setup.exe'));
  }
  if (fs.existsSync(path.join(outDir, 'ShopPOS-ManagerSupervisorPortal-Portable.exe'))) {
    safeCopy(path.join(outDir, 'ShopPOS-ManagerSupervisorPortal-Portable.exe'), path.join(destDir, 'ShopPOS-ManagerSupervisorPortal-Portable.exe'));
  }
}

if (doAndroid) {
  console.log('\n=== Manager & Supervisor Portal Android APK ===');
  run(process.execPath, [path.join('scripts', 'build-cloud-shell-android.js'), 'mgr-hr']);
}

console.log(`\nDone. Installers under:\n  ${installersRoot}\\Manager-Supervisor-Portal\\\n  ${installersRoot}\\Android\\ShopPOS-ManagerSupervisorPortal.apk\n`);

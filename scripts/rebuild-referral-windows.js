/**
 * Rebuild live Referral Agent + Referral & Commission Windows apps
 * into Downloads/ShopPOS-Installers/
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const cloudUrl = process.env.SHOP_POS_CLOUD_URL || 'https://chisafood.up.railway.app';
const installersRoot = path.join(
  process.env.USERPROFILE || process.env.HOME || '',
  'Downloads',
  'ShopPOS-Installers'
);

const apps = [
  {
    mode: 'referral',
    name: 'Referral Agent',
    executableName: 'ReferralAgent',
    appId: 'com.shoppos.referral',
    artifact: 'ShopPOS-ReferralAgent',
    folder: 'Referral-Agent',
    liveShell: 'electron/referral-shell.js'
  },
  {
    mode: 'referral-commission',
    name: 'Referral Commission',
    executableName: 'ReferralCommission',
    appId: 'com.shoppos.referralcommission',
    artifact: 'ShopPOS-ReferralCommission',
    folder: 'Referral-Commission',
    liveShell: 'electron/referral-commission-shell.js'
  }
];

function safeCopy(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.new-${Date.now()}`;
  fs.copyFileSync(src, tmp);
  try {
    fs.renameSync(tmp, dest);
  } catch (_) {
    try { fs.unlinkSync(dest); } catch (_) { /* ignore */ }
    fs.renameSync(tmp, dest);
  }
  console.log(`  → ${dest}`);
}

for (const a of apps) {
  console.log(`\n=== Building ${a.name} ===`);
  const bake = path.join(root, 'electron', `cloud-shell-config-${a.mode}.js`);
  fs.writeFileSync(
    bake,
    `process.env.SHOP_POS_APP_MODE = ${JSON.stringify(a.mode)};\n` +
      `process.env.SHOP_POS_SYNC_URL = ${JSON.stringify(cloudUrl)};\n` +
      `require(${JSON.stringify('./' + path.basename(a.liveShell))});\n`
  );

  const cfg = {
    appId: a.appId,
    productName: a.name,
    executableName: a.executableName,
    directories: { output: path.join('dist', 'cloud-apps', a.mode), buildResources: 'build' },
    files: [a.liveShell, `electron/cloud-shell-config-${a.mode}.js`, 'package.json'],
    extraMetadata: { main: `electron/cloud-shell-config-${a.mode}.js`, name: a.appId },
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
      include: 'nsis-close-running.nsh',
      artifactName: `${a.artifact}-Setup.\${ext}`,
      shortcutName: a.name
    },
    portable: { artifactName: `${a.artifact}-Portable.\${ext}` }
  };
  const cfgPath = path.join(root, `electron-builder.cloud-${a.mode}.json`);
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));

  const ebCli = require.resolve('electron-builder/cli.js');
  const r = spawnSync(process.execPath, [ebCli, '--config', cfgPath, '--win', '--x64'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' }
  });
  if (r.status !== 0) {
    console.error(`Build failed for ${a.mode}`);
    process.exit(r.status || 1);
  }

  const outDir = path.join(root, 'dist', 'cloud-apps', a.mode);
  const destDir = path.join(installersRoot, a.folder);
  for (const f of [`${a.artifact}-Setup.exe`, `${a.artifact}-Portable.exe`]) {
    const src = path.join(outDir, f);
    if (fs.existsSync(src)) safeCopy(src, path.join(destDir, f));
  }
}

console.log(`\nReferral Windows installers updated under:\n  ${installersRoot}\n`);

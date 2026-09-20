/**
 * Rebuild Menu & Promo Studio Windows installer (live Railway shell)
 * into Downloads/ShopPOS-Installers/Menu-Promo-Studio/
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

const app = {
  mode: 'studio',
  name: 'Menu & Promo Studio',
  executableName: 'ShopPOS-Studio',
  appId: 'com.shoppos.studio',
  artifact: 'ShopPOS-Studio',
  folder: 'Menu-Promo-Studio',
  liveShell: 'electron/studio-shell.js'
};

function safeCopy(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.new-${Date.now()}`;
  fs.copyFileSync(src, tmp);
  try {
    fs.renameSync(tmp, dest);
  } catch (_) {
    try { fs.unlinkSync(dest); } catch (_) { /* ignore */ }
    try {
      fs.renameSync(tmp, dest);
    } catch (e2) {
      const alt = dest.replace(/\.exe$/i, '-NEW.exe');
      fs.renameSync(tmp, alt);
      console.log(`  ⚠ locked — wrote ${alt}`);
      return;
    }
  }
  console.log(`  → ${dest}`);
}

console.log(`\n=== Building ${app.name} ===`);
const bake = path.join(root, 'electron', `cloud-shell-config-${app.mode}.js`);
fs.writeFileSync(
  bake,
  `process.env.SHOP_POS_APP_MODE = ${JSON.stringify(app.mode)};\n` +
    `process.env.SHOP_POS_SYNC_URL = ${JSON.stringify(cloudUrl)};\n` +
    `require(${JSON.stringify('./' + path.basename(app.liveShell))});\n`
);

const cfg = {
  appId: app.appId,
  productName: app.name,
  executableName: app.executableName,
  directories: { output: path.join('dist', 'cloud-apps', app.mode), buildResources: 'build' },
  files: [app.liveShell, `electron/cloud-shell-config-${app.mode}.js`, 'package.json'],
  extraMetadata: { main: `electron/cloud-shell-config-${app.mode}.js`, name: app.appId },
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
    artifactName: `${app.artifact}-Setup.\${ext}`,
    shortcutName: app.name
  },
  portable: { artifactName: `${app.artifact}-Portable.\${ext}` }
};

fs.writeFileSync(path.join(root, 'electron-builder.cloud-studio.json'), JSON.stringify(cfg, null, 2));
const eb = require.resolve('electron-builder/cli.js');
const r = spawnSync(process.execPath, [eb, '--config', 'electron-builder.cloud-studio.json', '--win', '--x64'], {
  cwd: root,
  stdio: 'inherit',
  env: process.env
});
if (r.status !== 0) process.exit(r.status || 1);

const outDir = path.join(root, 'dist', 'cloud-apps', app.mode);
const destDir = path.join(installersRoot, app.folder);
fs.mkdirSync(destDir, { recursive: true });
for (const f of fs.readdirSync(outDir)) {
  if (!/\.(exe|yml|yaml|blockmap)$/i.test(f)) continue;
  safeCopy(path.join(outDir, f), path.join(destDir, f));
}
console.log(`\nDone → ${destDir}`);

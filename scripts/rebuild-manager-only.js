/**
 * Business Manager — lightweight Electron shell (loads cloud /manager/).
 * Output: Downloads/ShopPOS-Installers/Manager/
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const cloudUrl = 'https://chisafood.up.railway.app';
const artifact = 'ShopPOS-Manager';
const name = 'Business Manager';

fs.writeFileSync(path.join(root, 'electron', 'manager-shell.js'), `'use strict';
const { app, BrowserWindow } = require('electron');
const url = (process.env.SHOP_POS_SYNC_URL || ${JSON.stringify(cloudUrl)}).replace(/\\/$/, '') + '/manager/';

function createWindow() {
  const win = new BrowserWindow({
    width: 420,
    height: 820,
    minWidth: 360,
    minHeight: 600,
    title: ${JSON.stringify(name)},
    autoHideMenuBar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  });
  win.loadURL(url);
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
`, 'utf8');

const cfg = {
  appId: 'com.shoppos.manager',
  productName: name,
  directories: { output: path.join('dist', 'cloud-apps', 'manager'), buildResources: 'build' },
  files: ['electron/manager-shell.js', 'package.json'],
  extraMetadata: { main: 'electron/manager-shell.js', name: 'com.shoppos.manager' },
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
    artifactName: `${artifact}-Setup.\${ext}`,
    shortcutName: name
  },
  portable: { artifactName: `${artifact}-Portable.\${ext}` }
};
fs.writeFileSync(path.join(root, 'electron-builder.cloud-manager.json'), JSON.stringify(cfg, null, 2));

const eb = require.resolve('electron-builder/cli.js');
const r = spawnSync(process.execPath, [eb, '--config', 'electron-builder.cloud-manager.json', '--win', '--x64'], {
  cwd: root, stdio: 'inherit', env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' }
});
if (r.status) process.exit(r.status || 1);

const dest = path.join(process.env.USERPROFILE || '', 'Downloads', 'ShopPOS-Installers', 'Manager');
fs.mkdirSync(dest, { recursive: true });
for (const f of [`${artifact}-Setup.exe`, `${artifact}-Portable.exe`]) {
  const src = path.join(root, 'dist', 'cloud-apps', 'manager', f);
  if (!fs.existsSync(src)) continue;
  const out = path.join(dest, f);
  try { fs.copyFileSync(src, out); console.log('Updated', out); }
  catch (e) {
    const alt = out.replace(/\.exe$/i, '-NEW.exe');
    fs.copyFileSync(src, alt);
    console.log('Locked — wrote', alt);
  }
}

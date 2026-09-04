/** Rebuild Accounting Command Centre into Downloads/ShopPOS-Installers/Accounting */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const mode = 'accounting';
const name = 'Business Accounting';
const appId = 'com.shoppos.accounting';
const artifact = 'ShopPOS-Accounting';
const cloudUrl = 'https://chisafood.up.railway.app';

fs.writeFileSync(
  path.join(root, 'electron', 'cloud-shell-config-accounting.js'),
  `process.env.SHOP_POS_APP_MODE = ${JSON.stringify(mode)};\n` +
    `process.env.SHOP_POS_LOCAL_INSTALLER = '1';\n` +
    `process.env.SHOP_POS_SYNC_URL = ${JSON.stringify(cloudUrl)};\n` +
    `require('./cloud-shell.js');\n`
);

const cfg = {
  appId,
  productName: name,
  directories: { output: path.join('dist', 'cloud-apps', 'accounting'), buildResources: 'build' },
  files: ['electron/**/*', 'src/**/*', 'mobile/**/*', 'lib/**/*', 'package.json'],
  extraMetadata: { main: 'electron/cloud-shell-config-accounting.js', name: appId },
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
fs.writeFileSync(path.join(root, 'electron-builder.cloud-accounting.json'), JSON.stringify(cfg, null, 2));

const eb = require.resolve('electron-builder/cli.js');
const r = spawnSync(process.execPath, [eb, '--config', 'electron-builder.cloud-accounting.json', '--win', '--x64'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' }
});
if (r.status) process.exit(r.status || 1);

const dest = path.join(process.env.USERPROFILE || '', 'Downloads', 'ShopPOS-Installers', 'Accounting');
fs.mkdirSync(dest, { recursive: true });
for (const f of [`${artifact}-Setup.exe`, `${artifact}-Portable.exe`]) {
  const src = path.join(root, 'dist', 'cloud-apps', 'accounting', f);
  if (!fs.existsSync(src)) continue;
  const out = path.join(dest, f);
  try {
    fs.copyFileSync(src, out);
    console.log('Updated', out);
  } catch (e) {
    const alt = out.replace(/\.exe$/i, '-NEW.exe');
    fs.copyFileSync(src, alt);
    console.log('Locked — wrote', alt);
  }
}

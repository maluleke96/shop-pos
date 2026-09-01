/** Rebuild HR, Payroll & Documents workspace into Downloads/ShopPOS-Installers/HR */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const mode = 'hr';
const name = 'HR, Payroll & Documents';
const appId = 'com.shoppos.hr';
const artifact = 'ShopPOS-HR';
const cloudUrl = 'https://peaceful-motivation-production-7dd2.up.railway.app';

fs.writeFileSync(
  path.join(root, 'electron', 'cloud-shell-config-hr.js'),
  `process.env.SHOP_POS_APP_MODE = ${JSON.stringify(mode)};\n` +
    `process.env.SHOP_POS_LOCAL_INSTALLER = '1';\n` +
    `process.env.SHOP_POS_SYNC_URL = ${JSON.stringify(cloudUrl)};\n` +
    `require('./cloud-shell.js');\n`
);

const buildOut = path.join('dist', 'cloud-apps', 'hr-build');
const cfg = {
  appId,
  productName: name,
  directories: { output: buildOut, buildResources: 'build' },
  files: ['electron/**/*', 'src/**/*', 'mobile/**/*', 'lib/**/*', 'package.json'],
  extraMetadata: { main: 'electron/cloud-shell-config-hr.js', name: appId },
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
fs.writeFileSync(path.join(root, 'electron-builder.cloud-hr.json'), JSON.stringify(cfg, null, 2));

const eb = require.resolve('electron-builder/cli.js');
const r = spawnSync(process.execPath, [eb, '--config', 'electron-builder.cloud-hr.json', '--win', '--x64'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' }
});
if (r.status) process.exit(r.status || 1);

const dest = path.join(process.env.USERPROFILE || '', 'Downloads', 'ShopPOS-Installers', 'HR');
fs.mkdirSync(dest, { recursive: true });
for (const f of [`${artifact}-Setup.exe`, `${artifact}-Portable.exe`]) {
  const src = path.join(root, buildOut, f);
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

/**
 * Build Windows installers for Admin, Staff, Marketing, Recipe.
 * Full local Electron + SQLite (works offline). Syncs to Railway when online.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const apps = [
  { mode: 'admin', name: 'Shop POS Admin', appId: 'com.shoppos.admin', artifact: 'ShopPOS-Admin' },
  { mode: 'staff', name: 'Staff Portal', appId: 'com.shoppos.staff', artifact: 'ShopPOS-StaffPortal' },
  { mode: 'marketing', name: 'Marketing Agent', appId: 'com.shoppos.marketing', artifact: 'ShopPOS-Marketing' },
  { mode: 'recipe', name: 'Recipe & Production', appId: 'com.shoppos.recipe', artifact: 'ShopPOS-Recipe' }
];

const cloudUrl =
  process.env.SHOP_POS_CLOUD_URL ||
  'https://peaceful-motivation-production-7dd2.up.railway.app';

for (const a of apps) {
  console.log(`\n=== Building ${a.name} (${a.mode}) — local-first ===`);
  const bake = path.join(root, 'electron', `cloud-shell-config-${a.mode}.js`);
  fs.writeFileSync(
    bake,
    `process.env.SHOP_POS_APP_MODE = ${JSON.stringify(a.mode)};\n` +
      `process.env.SHOP_POS_LOCAL_INSTALLER = '1';\n` +
      `process.env.SHOP_POS_SYNC_URL = ${JSON.stringify(cloudUrl)};\n` +
      `require('./cloud-shell.js');\n`
  );

  const cfg = {
    appId: a.appId,
    productName: a.name,
    directories: { output: path.join('dist', 'cloud-apps', a.mode), buildResources: 'build' },
    files: ['electron/**/*', 'src/**/*', 'mobile/**/*', 'lib/**/*', 'package.json'],
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
      createDesktopShortcut: true,
      createStartMenuShortcut: true,
      artifactName: `${a.artifact}-Setup.\${ext}`,
      shortcutName: a.name
    },
    portable: {
      artifactName: `${a.artifact}-Portable.\${ext}`
    }
  };
  const cfgPath = path.join(root, `electron-builder.cloud-${a.mode}.json`);
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));

  const ebCli = require.resolve('electron-builder/cli.js');
  const r = spawnSync(process.execPath, [ebCli, '--config', cfgPath, '--win', '--x64'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' }
  });
  if (r.error) console.error(r.error);
  if (r.status !== 0) {
    console.error(`Build failed for ${a.mode}`);
    process.exit(r.status || 1);
  }
}

console.log('\nAll local-first Windows apps built under dist/cloud-apps/');

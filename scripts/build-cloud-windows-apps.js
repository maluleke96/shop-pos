/**
 * Build Windows installers for Admin, Staff, Marketing, Recipe.
 * Full local Electron + SQLite (works offline). Syncs to Railway when online.
 * Copies into the existing Downloads/ShopPOS-Installers folders (not Windows\).
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const installersRoot = path.join(
  process.env.USERPROFILE || process.env.HOME || '',
  'Downloads',
  'ShopPOS-Installers'
);

const apps = [
  {
    mode: 'admin',
    name: 'Shop POS Admin',
    appId: 'com.shoppos.admin',
    artifact: 'ShopPOS-Admin',
    folder: 'Admin'
  },
  {
    mode: 'pos',
    name: 'Shop POS',
    appId: 'com.shoppos.pos',
    artifact: 'ShopPOS-POS',
    folder: 'POS'
  },
  {
    mode: 'staff',
    name: 'Staff Portal',
    appId: 'com.shoppos.staff',
    artifact: 'ShopPOS-StaffPortal',
    folder: 'Staff-Portal'
  },
  {
    mode: 'marketing',
    name: 'Marketing Agent',
    appId: 'com.shoppos.marketing',
    artifact: 'ShopPOS-Marketing',
    folder: 'Marketing-Agent'
  },
  {
    mode: 'recipe',
    name: 'Recipe & Production',
    appId: 'com.shoppos.recipe',
    artifact: 'ShopPOS-Recipe',
    folder: 'Recipe-Production'
  },
  {
    mode: 'hr',
    name: 'HR, Payroll & Documents',
    appId: 'com.shoppos.hr',
    artifact: 'ShopPOS-HR',
    folder: 'HR'
  },
  {
    mode: 'accounting',
    name: 'Business Accounting',
    appId: 'com.shoppos.accounting',
    artifact: 'ShopPOS-Accounting',
    folder: 'Accounting'
  }
];

const cloudUrl =
  process.env.SHOP_POS_CLOUD_URL ||
  'https://chisafood.up.railway.app';

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
      try {
        fs.renameSync(tmp, dest);
      } catch (_) {
        try { fs.unlinkSync(dest); } catch (_) { /* ignore */ }
        fs.renameSync(tmp, dest);
      }
      console.log(`  → ${dest}`);
      return;
    } catch (err) {
      lastErr = err;
      sleepMs(700 + i * 400);
    }
  }
  // Last resort: versioned alt next to locked file
  const alt = dest.replace(/(\.\w+)$/, `-v2.10.21$1`);
  try {
    fs.copyFileSync(src, alt);
    console.warn(`  ⚠ locked — wrote ${path.basename(alt)} (close the old app, then rename)`);
    return;
  } catch (_) {
    throw lastErr;
  }
}

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

  const outDir = path.join(root, 'dist', 'cloud-apps', a.mode);
  const destDir = path.join(installersRoot, a.folder);
  const setupSrc = path.join(outDir, `${a.artifact}-Setup.exe`);
  const portableSrc = path.join(outDir, `${a.artifact}-Portable.exe`);
  if (fs.existsSync(setupSrc)) safeCopy(setupSrc, path.join(destDir, `${a.artifact}-Setup.exe`));
  if (fs.existsSync(portableSrc)) safeCopy(portableSrc, path.join(destDir, `${a.artifact}-Portable.exe`));
}

const readme = `Shop POS — Windows installers
=============================

Each app connects to your online Railway shop:
${cloudUrl}

Folders:
  Admin\\              — Sign in + Set up shop (owner/manager)
  POS\\                 — Till only — use cashier/manager usernames from Admin → Users
  Staff-Portal\\       — Employee ID + PIN login only
  Marketing-Agent\\    — Marketing login only
  Recipe-Production\\  — Recipe & production login only
  HR\\                 — HR, payroll & documents login only
  Accounting\\         — Business accounting login only
  Online-Ordering\\    — Customer ordering app (opens your /order/ site)
  Manager\\             — Business Manager monitoring app

In each folder:
  *-Setup.exe     — Full installer (recommended)
  *-Portable.exe  — No install; double-click to run

Start with Admin\\ShopPOS-Admin-Setup.exe on your main PC.
Create cashiers/managers in Admin → Users, then install POS\\ on tills.

Sign in online once so this PC uses the same shop as the browser.
`;
fs.writeFileSync(path.join(installersRoot, 'README.txt'), readme, 'utf8');
console.log(`\nAll apps updated under:\n  ${installersRoot}\n`);

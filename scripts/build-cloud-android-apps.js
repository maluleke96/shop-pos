/**
 * Build Android APKs for each cloud app (Admin, Staff, Marketing, Recipe).
 * Output: Downloads/ShopPOS-Installers/Android/
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const cloudUrl =
  process.env.SHOP_POS_CLOUD_URL ||
  'https://peaceful-motivation-production-7dd2.up.railway.app';

const apps = [
  { mode: 'admin', config: 'capacitor.admin.json', apkName: 'ShopPOS-Admin.apk', label: 'Shop POS Admin' },
  { mode: 'pos', config: 'capacitor.pos.json', apkName: 'ShopPOS-POS.apk', label: 'Shop POS' },
  { mode: 'staff', config: 'capacitor.staff.json', apkName: 'ShopPOS-StaffPortal.apk', label: 'Staff Portal' },
  { mode: 'marketing', config: 'capacitor.marketing.json', apkName: 'ShopPOS-Marketing.apk', label: 'Marketing Agent' },
  { mode: 'recipe', config: 'capacitor.recipe.json', apkName: 'ShopPOS-Recipe.apk', label: 'Recipe & Production' }
];

const destRoot = path.join(
  process.env.USERPROFILE || process.env.HOME || '',
  'Downloads',
  'ShopPOS-Installers',
  'Android'
);

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd || root,
    stdio: 'inherit',
    shell: true,
    env: opts.env || process.env
  });
  if (r.status !== 0) {
    throw new Error(`Command failed: ${cmd} ${args.join(' ')} (exit ${r.status})`);
  }
}

function ensureMinimalWww() {
  const www = path.join(root, 'www');
  fs.mkdirSync(www, { recursive: true });
  const index = path.join(www, 'index.html');
  if (!fs.existsSync(index)) {
    fs.writeFileSync(
      index,
      '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Shop POS</title></head><body><p>Loading…</p></body></html>',
      'utf8'
    );
  }
}

function writeUtf8NoBom(filePath, content) {
  fs.writeFileSync(filePath, content, { encoding: 'utf8' });
}

function patchStringsXml(appName, appId) {
  const p = path.join(root, 'android', 'app', 'src', 'main', 'res', 'values', 'strings.xml');
  const xml = `<?xml version='1.0' encoding='utf-8'?>\n<resources>\n    <string name="app_name">${appName}</string>\n    <string name="title_activity_main">${appName}</string>\n    <string name="package_name">${appId}</string>\n    <string name="custom_url_scheme">${appId}</string>\n</resources>\n`;
  writeUtf8NoBom(p, xml);
}

function patchBuildGradle(appId) {
  const p = path.join(root, 'android', 'app', 'build.gradle');
  let g = fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
  // Keep Java namespace as com.shoppos.offline (where MainActivity lives).
  // Only applicationId changes so each APK can install side-by-side without crashing.
  if (!/namespace\s+"com\.shoppos\.offline"/.test(g)) {
    g = g.replace(/namespace\s+"[^"]+"/, 'namespace "com.shoppos.offline"');
  }
  g = g.replace(/applicationId\s+"[^"]+"/, `applicationId "${appId}"`);
  // Keep version in sync with package.json when present
  try {
    const ver = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version || '2.10.20';
    const code = String(ver).replace(/\D/g, '') || '21020';
    g = g.replace(/versionCode\s+\d+/, `versionCode ${code}`);
    g = g.replace(/versionName\s+"[^"]+"/, `versionName "${ver}"`);
  } catch (_) { /* ignore */ }
  writeUtf8NoBom(p, g);
}

function findApk() {
  const dir = path.join(root, 'android', 'app', 'build', 'outputs', 'apk', 'debug');
  const names = ['app-debug.apk', 'app-debug-unsigned.apk'];
  for (const n of names) {
    const p = path.join(dir, n);
    if (fs.existsSync(p)) return p;
  }
  throw new Error('APK not found after assembleDebug');
}

function gradleEnv() {
  const env = { ...process.env };
  const bundledJdk = path.join(root, '.tools', 'jdk-17');
  if (fs.existsSync(bundledJdk)) env.JAVA_HOME = bundledJdk;
  if (env.GRADLE_USER_HOME && /cursor-sandbox-cache/i.test(env.GRADLE_USER_HOME)) {
    env.GRADLE_USER_HOME = path.join(require('os').homedir(), '.gradle-shoppos');
  }
  return env;
}

fs.mkdirSync(destRoot, { recursive: true });
run('node', [path.join('scripts', 'write-capacitor-cloud-apps.js')]);
run('node', [path.join('scripts', 'build-mobile-www.js')]);

function bakeAppMode(mode) {
  const bake = path.join(root, 'www', 'js', 'app-mode-bake.js');
  fs.writeFileSync(
    bake,
    `window.__SHOP_POS_APP_MODE__=${JSON.stringify(mode)};\n` +
      'window.__SHOP_POS_LOCAL_INSTALLER__=true;\n' +
      `window.__SHOP_POS_ENV__=Object.assign(window.__SHOP_POS_ENV__||{},{SHOP_POS_SYNC_URL:${JSON.stringify(cloudUrl)}});\n`
  );
}

const results = [];

for (const a of apps) {
  console.log(`\n========== Building ${a.label} (${a.mode}) — local-first ==========`);
  bakeAppMode(a.mode);
  const cfgSrc = path.join(root, 'capacitor-apps', a.config);
  if (!fs.existsSync(cfgSrc)) throw new Error(`Missing ${cfgSrc}`);

  const cfg = JSON.parse(fs.readFileSync(cfgSrc, 'utf8'));
  delete cfg.server;
  fs.writeFileSync(path.join(root, 'capacitor.config.json'), JSON.stringify(cfg, null, 2));

  patchStringsXml(cfg.appName, cfg.appId);
  patchBuildGradle(cfg.appId);

  run('npx', ['cap', 'sync', 'android']);

  const gradle = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
  run(gradle, ['assembleDebug'], { cwd: path.join(root, 'android'), env: gradleEnv() });

  const srcApk = findApk();
  const dest = path.join(destRoot, a.apkName);
  fs.copyFileSync(srcApk, dest);
  const mb = (fs.statSync(dest).size / (1024 * 1024)).toFixed(1);
  console.log(`✓ ${a.apkName} (${mb} MB)`);
  results.push({ name: a.apkName, path: dest, mb });
}

const readme = `Shop POS — Android APKs
=======================

Same apps as before — open and install from this folder.

  ShopPOS-Admin.apk
  ShopPOS-POS.apk
  ShopPOS-StaffPortal.apk
  ShopPOS-Marketing.apk
  ShopPOS-Recipe.apk

Admin          — Sign in + Set up shop
POS            — Till only (cashier/manager usernames from Admin)
StaffPortal    — Employee ID + PIN only
Marketing      — Marketing login only
Recipe         — Recipe & production login only

Works offline. When online, syncs to your Railway shop.
Sign in online once so the phone uses the same shop as the browser.
`;
fs.writeFileSync(path.join(destRoot, 'README.txt'), readme, 'utf8');
console.log(`\nAll APKs ready in Android folder.\n`);

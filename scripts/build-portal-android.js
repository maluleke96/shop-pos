/**
 * Build a bundled Android APK from a *-web folder (works offline; syncs RPC when online).
 * Usage: node scripts/build-portal-android.js expense|driver
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const cloudUrl = (process.env.SHOP_POS_CLOUD_URL || 'https://chisafood.up.railway.app').replace(/\/$/, '');
const destRoot = path.join(process.env.USERPROFILE || process.env.HOME || '', 'Downloads', 'ShopPOS-Installers', 'Android');

const PORTALS = {
  expense: {
    srcDir: 'expense-web',
    config: 'capacitor.expense.json',
    apkName: 'ShopPOS-Expenses.apk',
    appId: 'com.shoppos.expense',
    appName: 'Expenses',
    configGlobal: '__EXPENSE_CONFIG__',
    configBody: {
      rpcUrl: `${cloudUrl}/rpc`,
      apiBase: cloudUrl,
      expensePath: '/expenses/'
    },
    copyShared: true
  },
  driver: {
    srcDir: 'driver-web',
    config: 'capacitor.driver.json',
    apkName: 'ShopPOS-Driver.apk',
    appId: 'com.shoppos.driver',
    appName: 'Driver App',
    configGlobal: '__DRIVER_CONFIG__',
    configBody: {
      rpcUrl: `${cloudUrl}/rpc`,
      apiBase: cloudUrl,
      driverPath: '/driver/'
    },
    copyShared: true
  }
};

const mode = (process.argv[2] || '').trim();
const portal = PORTALS[mode];
if (!portal) {
  console.error('Usage: node scripts/build-portal-android.js expense|driver');
  process.exit(1);
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: opts.cwd || root, stdio: 'inherit', shell: true, env: opts.env || process.env });
  if (r.status !== 0) throw new Error(`Failed: ${cmd} ${args.join(' ')}`);
}

function rimraf(dir) {
  if (!fs.existsSync(dir)) return;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) rimraf(p);
    else fs.unlinkSync(p);
  }
  fs.rmdirSync(dir);
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, ent.name);
    const to = path.join(dest, ent.name);
    if (ent.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

function patchDriverIndex(html) {
  return html.replace(/src="\/shared\//g, 'src="shared/');
}

function prepareWww() {
  const www = path.join(root, 'www');
  rimraf(www);
  fs.mkdirSync(www, { recursive: true });
  copyDir(path.join(root, portal.srcDir), www);
  if (portal.copyShared) {
    copyDir(path.join(root, 'shared'), path.join(www, 'shared'));
  }
  const idx = path.join(www, 'index.html');
  if (fs.existsSync(idx)) {
    fs.writeFileSync(idx, patchDriverIndex(fs.readFileSync(idx, 'utf8')), 'utf8');
  }
  const cfgPath = path.join(www, 'js', 'config.js');
  const cfg = `window.${portal.configGlobal} = ${JSON.stringify(portal.configBody, null, 2)};\n`;
  fs.writeFileSync(cfgPath, cfg, 'utf8');
}

function patchStringsXml() {
  const p = path.join(root, 'android', 'app', 'src', 'main', 'res', 'values', 'strings.xml');
  const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const xml = `<?xml version='1.0' encoding='utf-8'?>\n<resources>
    <string name="app_name">${esc(portal.appName)}</string>
    <string name="title_activity_main">${esc(portal.appName)}</string>
    <string name="package_name">${portal.appId}</string>
    <string name="custom_url_scheme">${portal.appId}</string>
</resources>\n`;
  fs.writeFileSync(p, xml, 'utf8');
}

function patchBuildGradle() {
  const p = path.join(root, 'android', 'app', 'build.gradle');
  let g = fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
  if (!/namespace\s+"com\.shoppos\.offline"/.test(g)) {
    g = g.replace(/namespace\s+"[^"]+"/, 'namespace "com.shoppos.offline"');
  }
  g = g.replace(/applicationId\s+"[^"]+"/, `applicationId "${portal.appId}"`);
  fs.writeFileSync(p, g, 'utf8');
}

function findApk() {
  const dir = path.join(root, 'android', 'app', 'build', 'outputs', 'apk', 'debug');
  for (const n of ['app-debug.apk', 'app-debug-unsigned.apk']) {
    const p = path.join(dir, n);
    if (fs.existsSync(p)) return p;
  }
  throw new Error('APK not found');
}

function gradleEnv() {
  const env = { ...process.env };
  const jdk = path.join(root, '.tools', 'jdk-17');
  if (fs.existsSync(jdk)) env.JAVA_HOME = jdk;
  if (env.GRADLE_USER_HOME && /cursor-sandbox-cache/i.test(env.GRADLE_USER_HOME)) {
    env.GRADLE_USER_HOME = path.join(require('os').homedir(), '.gradle-shoppos');
  }
  return env;
}

fs.mkdirSync(destRoot, { recursive: true });
console.log(`\n========== Building ${portal.appName} (bundled portal) ==========`);
prepareWww();

const cfg = JSON.parse(fs.readFileSync(path.join(root, 'capacitor-apps', portal.config), 'utf8'));
delete cfg.server;
fs.writeFileSync(path.join(root, 'capacitor.config.json'), JSON.stringify(cfg, null, 2));

patchStringsXml();
patchBuildGradle();
run('npx', ['cap', 'sync', 'android']);

const gradle = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
run(gradle, ['assembleDebug'], { cwd: path.join(root, 'android'), env: gradleEnv() });

const dest = path.join(destRoot, portal.apkName);
fs.copyFileSync(findApk(), dest);
const mb = (fs.statSync(dest).size / (1024 * 1024)).toFixed(1);
console.log(`✓ ${portal.apkName} (${mb} MB) → ${dest}`);

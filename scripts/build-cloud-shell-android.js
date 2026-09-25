/**
 * Build Android APKs that load the LIVE cloud UI (same as browser).
 * Single source of truth — no bundled SQLite snapshots.
 *
 * Usage: node scripts/build-cloud-shell-android.js [pos|staff|recipe|expense|studio|driver|delivery|manager|manager-ops|order|referral|referral-commission|mgr-hr|all]
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const cloudUrl = (process.env.SHOP_POS_CLOUD_URL || 'https://chisafood.up.railway.app').replace(/\/$/, '');
const destRoot = path.join(process.env.USERPROFILE || process.env.HOME || '', 'Downloads', 'ShopPOS-Installers', 'Android');
const moDestRoot = path.join(process.env.USERPROFILE || process.env.HOME || '', 'Downloads', 'Manager-Operations');

const APPS = [
  { id: 'pos', config: 'capacitor.pos.json', apkName: 'ShopPOS-POS.apk', appName: 'Shop POS', serverPath: '/pos-app.html' },
  { id: 'staff', config: 'capacitor.staff.json', apkName: 'ShopPOS-StaffPortal.apk', appName: 'Staff Portal', serverPath: '/staff-app.html' },
  { id: 'recipe', config: 'capacitor.recipe.json', apkName: 'ShopPOS-Recipe.apk', appName: 'Recipe & Production', serverPath: '/recipe-app.html' },
  { id: 'expense', config: 'capacitor.expense.json', apkName: 'ShopPOS-Expenses.apk', appName: 'Expenses', serverPath: '/expenses/' },
  { id: 'studio', config: 'capacitor.studio.json', apkName: 'ShopPOS-Studio.apk', appName: 'Menu & Promo Studio', serverPath: '/studio/' },
  { id: 'driver', config: 'capacitor.driver.json', apkName: 'ShopPOS-Driver.apk', appName: 'Driver App', serverPath: '/driver/' },
  { id: 'delivery', config: 'capacitor.delivery.json', apkName: 'ShopPOS-DeliveryDepartment.apk', appName: 'Delivery Department', serverPath: '/delivery-app.html' },
  { id: 'manager', config: 'capacitor.manager.json', apkName: 'ShopPOS-Manager.apk', appName: 'Business Manager', serverPath: '/manager/' },
  { id: 'manager-ops', config: 'capacitor.manager-ops.json', apkName: 'ShopPOS-ManagerOperations.apk', appName: 'Manager Operations', serverPath: '/manager-ops/', destFolder: moDestRoot },
  { id: 'order', config: 'capacitor.order.json', apkName: 'ShopPOS-OnlineOrdering.apk', appName: 'Online Ordering', serverPath: '/order/' },
  { id: 'referral', config: 'capacitor.referral.json', apkName: 'ShopPOS-ReferralAgent.apk', appName: 'Referral Agent', serverPath: '/referral-app.html' },
  { id: 'referral-commission', config: 'capacitor.referral-commission.json', apkName: 'ShopPOS-ReferralCommission.apk', appName: 'Referral Commission', serverPath: '/referral-commission-app.html' },
  { id: 'mgr-hr', config: 'capacitor.mgr-hr.json', apkName: 'ShopPOS-ManagerSupervisorPortal.apk', appName: 'Mgr Supervisor Portal', serverPath: '/mgr-hr-app.html' }
];

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: opts.cwd || root, stdio: 'inherit', shell: true, env: opts.env || process.env });
  if (r.status !== 0) throw new Error(`Failed: ${cmd} ${args.join(' ')}`);
}

function xmlEscape(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function patchStringsXml(appName, appId) {
  const p = path.join(root, 'android', 'app', 'src', 'main', 'res', 'values', 'strings.xml');
  const xml = `<?xml version='1.0' encoding='utf-8'?>\n<resources>
    <string name="app_name">${xmlEscape(appName)}</string>
    <string name="title_activity_main">${xmlEscape(appName)}</string>
    <string name="package_name">${appId}</string>
    <string name="custom_url_scheme">${appId}</string>
</resources>\n`;
  fs.writeFileSync(p, xml, 'utf8');
}

function patchBuildGradle(appId) {
  const p = path.join(root, 'android', 'app', 'build.gradle');
  let g = fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
  if (!/namespace\s+"com\.shoppos\.offline"/.test(g)) {
    g = g.replace(/namespace\s+"[^"]+"/, 'namespace "com.shoppos.offline"');
  }
  g = g.replace(/applicationId\s+"[^"]+"/, `applicationId "${appId}"`);
  try {
    const ver = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version || '2.10.28';
    const base = parseInt(String(ver).replace(/\D/g, '') || '21028', 10);
    // Unique code per build so Android allows reinstall over previous APK
    const code = String(base + Math.floor(Date.now() / 1000) % 100000);
    g = g.replace(/versionCode\s+\d+/, `versionCode ${code}`);
    g = g.replace(/versionName\s+"[^"]+"/, `versionName "${ver}"`);
  } catch (_) { /* ignore */ }
  fs.writeFileSync(p, g, 'utf8');
}

function findApk() {
  const dir = path.join(root, 'android', 'app', 'build', 'outputs', 'apk', 'debug');
  for (const n of ['app-debug.apk', 'app-debug-unsigned.apk']) {
    const p = path.join(dir, n);
    if (fs.existsSync(p)) return p;
  }
  throw new Error('APK not found after assembleDebug');
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

function ensureWww(app) {
  const www = path.join(root, 'www');
  fs.mkdirSync(www, { recursive: true });
  // Prefer dedicated entry HTML (no ?query) — Capacitor Android blanks on server.url / redirects with query strings
  const entryPath = app.serverPath.includes('?')
    ? (app.id === 'referral-commission' ? '/referral-commission-app.html' : app.id === 'referral' ? '/referral-app.html' : app.id === 'mgr-hr' ? '/mgr-hr-app.html' : app.serverPath.split('?')[0])
    : app.serverPath;
  const target = `${cloudUrl}${entryPath}`;
  fs.writeFileSync(path.join(www, 'index.html'), `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
<style>body{font-family:system-ui;background:#0f2744;color:#e2e8f0;text-align:center;padding:32px}a{color:#5eead4}</style>
</head>
<body>
<p>Loading ${xmlEscape(app.appName)}…</p>
<p style="font-size:12px;opacity:.7">Needs internet to reach your shop cloud.</p>
<p><a href="${target}">Open ${xmlEscape(app.appName)}</a></p>
<script>location.replace(${JSON.stringify(target)});</script>
</body></html>`, 'utf8');
}

function buildApp(app) {
  console.log(`\n========== Cloud shell: ${app.appName} → ${cloudUrl}${app.serverPath} ==========`);
  ensureWww(app);
  const cfgSrc = path.join(root, 'capacitor-apps', app.config);
  const cfg = JSON.parse(fs.readFileSync(cfgSrc, 'utf8'));
  const host = (() => {
    try { return new URL(cloudUrl).hostname; } catch (_) { return 'chisafood.up.railway.app'; }
  })();
  // Never put ?query in Capacitor server.url — Android WebView stays blank
  const serverPath = String(app.serverPath || '/').split('?')[0] || '/';
  cfg.server = {
    url: `${cloudUrl}${serverPath}`,
    cleartext: false,
    allowNavigation: [host, `*.${host.split('.').slice(-2).join('.')}`, '*.up.railway.app', 'chisafood.up.railway.app']
  };
  cfg.android = { ...(cfg.android || {}), allowMixedContent: true };
  fs.writeFileSync(path.join(root, 'capacitor.config.json'), JSON.stringify(cfg, null, 2));
  patchStringsXml(app.appName, cfg.appId);
  patchBuildGradle(cfg.appId);
  run('npx', ['cap', 'sync', 'android']);
  const gradle = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
  run(gradle, ['assembleDebug'], { cwd: path.join(root, 'android'), env: gradleEnv() });
  fs.mkdirSync(destRoot, { recursive: true });
  const dest = path.join(destRoot, app.apkName);
  fs.copyFileSync(findApk(), dest);
  if (app.destFolder) {
    fs.mkdirSync(app.destFolder, { recursive: true });
    const moDest = path.join(app.destFolder, app.apkName);
    fs.copyFileSync(dest, moDest);
    const latest = path.join(app.destFolder, 'ShopPOS-ManagerOperations-latest.apk');
    fs.copyFileSync(dest, latest);
    const readme = path.join(app.destFolder, 'README.txt');
    fs.writeFileSync(readme, `Manager Operations — Android installer
=====================================
Install ShopPOS-ManagerOperations.apk on your Android phone.

This app opens the live Manager Operations portal for your shop:
  ${cloudUrl}/manager-ops/

Sign in with the same username and password you use for Admin / POS.
Owners and managers always have access. Other staff need access granted
under Admin → Manager Operations → Staff Access.

Built: ${new Date().toISOString()}
`, 'utf8');
    console.log(`✓ Also copied to ${app.destFolder}`);
  }
  const mb = (fs.statSync(dest).size / (1024 * 1024)).toFixed(1);
  console.log(`✓ ${app.apkName} (${mb} MB) — loads live cloud UI`);
  return dest;
}

const arg = (process.argv[2] || 'all').trim().toLowerCase();
const list = arg === 'all' ? APPS : APPS.filter((a) => a.id === arg);
if (!list.length) {
  console.error('Unknown app:', arg);
  console.error('Usage: node scripts/build-cloud-shell-android.js [pos|staff|recipe|expense|studio|driver|manager|manager-ops|order|referral|referral-commission|mgr-hr|all]');
  process.exit(1);
}

console.log('Cloud URL (same as browser):', cloudUrl);
for (const app of list) {
  buildApp(app);
}

/**
 * Build Online Ordering Android APK (loads cloud /order/ UI).
 * Output: Downloads/ShopPOS-Installers/Android/ShopPOS-OnlineOrdering.apk
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const cloudUrl = (process.env.SHOP_POS_CLOUD_URL || 'https://chisafood.up.railway.app').replace(/\/$/, '');
const destRoot = path.join(process.env.USERPROFILE || process.env.HOME || '', 'Downloads', 'ShopPOS-Installers', 'Android');

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: opts.cwd || root, stdio: 'inherit', shell: true, env: opts.env || process.env });
  if (r.status !== 0) throw new Error(`Failed: ${cmd} ${args.join(' ')}`);
}

function ensureWww() {
  const www = path.join(root, 'www');
  fs.mkdirSync(www, { recursive: true });
  fs.writeFileSync(path.join(www, 'index.html'), `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="refresh" content="0;url=${cloudUrl}/order/"></head>
<body><p>Loading Online Ordering…</p></body></html>`, 'utf8');
}

function patchStringsXml() {
  const p = path.join(root, 'android', 'app', 'src', 'main', 'res', 'values', 'strings.xml');
  const xml = `<?xml version='1.0' encoding='utf-8'?>\n<resources>
    <string name="app_name">Online Ordering</string>
    <string name="title_activity_main">Online Ordering</string>
    <string name="package_name">com.shoppos.order</string>
    <string name="custom_url_scheme">com.shoppos.order</string>
</resources>\n`;
  fs.writeFileSync(p, xml, 'utf8');
}

function patchBuildGradle() {
  const p = path.join(root, 'android', 'app', 'build.gradle');
  let g = fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
  g = g.replace(/applicationId\s+"[^"]+"/, 'applicationId "com.shoppos.order"');
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

fs.mkdirSync(destRoot, { recursive: true });
ensureWww();

const cfg = JSON.parse(fs.readFileSync(path.join(root, 'capacitor-apps', 'capacitor.order.json'), 'utf8'));
cfg.server = { url: `${cloudUrl}/order/`, cleartext: false };
fs.writeFileSync(path.join(root, 'capacitor.config.json'), JSON.stringify(cfg, null, 2));

patchStringsXml();
patchBuildGradle();
run('npx', ['cap', 'sync', 'android']);

const gradle = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
const env = { ...process.env };
const jdk = path.join(root, '.tools', 'jdk-17');
if (fs.existsSync(jdk)) env.JAVA_HOME = jdk;
run(gradle, ['assembleDebug'], { cwd: path.join(root, 'android'), env });

const dest = path.join(destRoot, 'ShopPOS-OnlineOrdering.apk');
fs.copyFileSync(findApk(), dest);
console.log('Created', dest);
